use tauri::{
    image::Image,
    menu::{Menu, MenuItem, PredefinedMenuItem},
    tray::{MouseButton, MouseButtonState, TrayIcon, TrayIconBuilder, TrayIconEvent},
    window::Color,
    AppHandle, Emitter, Manager, Runtime, WebviewWindow, WindowEvent,
};
use std::collections::HashMap;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Mutex, OnceLock};
use tauri_plugin_global_shortcut::{GlobalShortcutExt, ShortcutState};

mod autostart;
mod shortcuts;
mod tray;

#[cfg(target_os = "macos")]
use core_graphics::event::CGEvent;
#[cfg(target_os = "macos")]
use core_graphics::event_source::{CGEventSource, CGEventSourceStateID};

#[cfg(target_os = "windows")]
use windows::Win32::Foundation::{POINT, RECT};
#[cfg(target_os = "windows")]
use windows::Win32::Graphics::Gdi::{
    GetMonitorInfoW, MonitorFromPoint, MONITORINFO, MONITOR_DEFAULTTONEAREST,
};
#[cfg(target_os = "windows")]
use windows::Win32::UI::WindowsAndMessaging::{
    AllowSetForegroundWindow, GetCursorPos, GetWindowRect, ASFW_ANY,
};

#[cfg(target_os = "linux")]
use x11::xlib;

const PANEL_GAP_Y: i32 = 6;
// 托盘图标只渲染 16~32px，用小图省掉约 165KB 二进制体积和一次大图解码
const TRAY_ICON_BYTES: &[u8] = include_bytes!("../icons/32x32.png");

/// 用户偏好里需要 Rust 侧即时读取的部分。
/// 关闭窗口时按它决定「隐藏到托盘」还是「直接退出」，默认隐藏到托盘。
struct AppPrefs {
    close_to_tray: AtomicBool,
}

impl Default for AppPrefs {
    fn default() -> Self {
        Self {
            close_to_tray: AtomicBool::new(true),
        }
    }
}

/// 托盘菜单项句柄，供 `update_tray_state` 动态改文案。
struct TrayHandles {
    toggle_timer: MenuItem<tauri::Wry>,
    skip_phase: MenuItem<tauri::Wry>,
    tray_icon: TrayIcon<tauri::Wry>,
}

/// 已注册快捷键的 id → 动作映射。
/// 插件回调只拿到 Shortcut，不知道业务含义，需要通过 id 查这张表。
#[derive(Default)]
struct ShortcutBindings {
    map: Mutex<HashMap<u32, String>>,
}

impl ShortcutBindings {
    fn clear(&self) {
        if let Ok(mut map) = self.map.lock() {
            map.clear();
        }
    }

    fn insert(&self, id: u32, action: &str) {
        if let Ok(mut map) = self.map.lock() {
            map.insert(id, action.to_string());
        }
    }

    fn action_for(&self, id: u32) -> Option<String> {
        self.map.lock().ok()?.get(&id).cloned()
    }
}

static LAST_PANEL_SIZE: OnceLock<Mutex<Option<tauri::PhysicalSize<u32>>>> = OnceLock::new();
static LAST_ISLAND_PLACE: OnceLock<Mutex<Option<IslandPlace>>> = OnceLock::new();

/// 岛贴哪条边；只贴顶/底，不悬空、不贴左右侧。
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum IslandEdge {
    Top,
    Bottom,
}

impl IslandEdge {
    fn parse(value: &str) -> Option<Self> {
        match value {
            "top" => Some(Self::Top),
            "bottom" => Some(Self::Bottom),
            _ => None,
        }
    }
}

/// 贴边摆放参数：边 + 沿边比例（None = 沿边居中）。
#[derive(Debug, Clone, Copy, PartialEq)]
struct IslandPlace {
    edge: IslandEdge,
    ratio: Option<f64>,
}

/// 沿边方向的窗口原点偏移；ratio None = 居中；窗口比区域还大时贴起点。
fn offset_along_edge(area_len: i64, win_len: i64, ratio: Option<f64>) -> i32 {
    let max = area_len - win_len;
    if max <= 0 {
        return 0;
    }
    let offset = match ratio {
        None => max as f64 / 2.0,
        Some(r) => r.clamp(0.0, 1.0) * max as f64,
    };
    offset.round() as i32
}

/// 按贴边语义算窗口左上角物理坐标。area = (left, top, width, height)，
/// 是窗口所在显示器的可用区域（Windows 排除任务栏）。
fn island_position_for_edge(
    area: (i64, i64, i64, i64),
    win: (i64, i64),
    edge: IslandEdge,
    ratio: Option<f64>,
) -> (i32, i32) {
    let (area_x, area_y, area_w, area_h) = area;
    let (win_w, win_h) = win;
    let x = area_x + offset_along_edge(area_w, win_w, ratio) as i64;
    // 贴底且窗口比区域还高时钳回区域起点，别探出屏幕外
    let y = match edge {
        IslandEdge::Top => area_y,
        IslandEdge::Bottom => (area_y + area_h - win_h).max(area_y),
    };
    (x as i32, y as i32)
}

/// 闲置收起时沿边露出的细边宽度（物理像素）
const PEEK_REVEAL_PX: i64 = 10;

/// 闲置收起时往屏外滑的距离：窗口在垂直于边方向的长度减去露出的细边
fn peek_outward(win_along: i64) -> i64 {
    (win_along - PEEK_REVEAL_PX).max(0)
}

/// 满贴边位置往屏外方向再滑 outward 像素（沿边方向不动）
fn shift_outward(x: i32, y: i32, edge: IslandEdge, outward: i64) -> (i32, i32) {
    if outward <= 0 {
        return (x, y);
    }
    let shift = outward.min(i64::from(i32::MAX)) as i32;
    match edge {
        IslandEdge::Top => (x, y - shift),
        IslandEdge::Bottom => (x, y + shift),
    }
}

/// 按 give 的贴边参数把主窗口摆到所在显示器的可用区域上；
/// outward > 0 时往屏外方向再滑这么多像素（闲置收起用）。
fn apply_island_place<R: Runtime>(app: &AppHandle<R>, place: IslandPlace, outward: i64) {
    let Some(main) = app.get_webview_window("main") else {
        return;
    };
    let Ok(size) = main.outer_size() else { return };
    let Ok(pos) = main.outer_position() else { return };
    let center = (
        pos.x + size.width as i32 / 2,
        pos.y + size.height as i32 / 2,
    );
    // 先按窗口中心找所在显示器的 work-area；拿不到再退回当前显示器整块屏
    let area = work_area_at(center).or_else(|| {
        main.current_monitor().ok().flatten().map(|m| {
            let p = m.position();
            let s = m.size();
            (p.x as i64, p.y as i64, s.width as i64, s.height as i64)
        })
    });
    let Some(area) = area else { return };
    let (x, y) = island_position_for_edge(
        area,
        (size.width as i64, size.height as i64),
        place.edge,
        place.ratio,
    );
    let (x, y) = shift_outward(x, y, place.edge, outward);
    let _ = main.set_position(tauri::PhysicalPosition::new(x, y));
}

#[tauri::command]
fn place_island<R: Runtime>(app: AppHandle<R>, edge: String, ratio: Option<f64>) -> Result<(), String> {
    let Some(edge) = IslandEdge::parse(&edge) else {
        return Err(format!("未知的贴边方向：{edge}"));
    };
    let place = IslandPlace {
        edge,
        ratio: ratio.map(|r| r.clamp(0.0, 1.0)),
    };
    set_last_island_place(place);
    apply_island_place(&app, place, 0);
    Ok(())
}

/// 闲置收起：沿所在边滑出屏只留一条细边；retract=false 满贴边滑回。
#[tauri::command]
fn peek_island<R: Runtime>(app: AppHandle<R>, retract: bool) {
    let Some(main) = app.get_webview_window("main") else { return };
    let Ok(size) = main.outer_size() else { return };
    let place = get_last_island_place();
    // 上下贴边时外滑距离都按窗口高度算
    let outward = if retract { peek_outward(size.height as i64) } else { 0 };
    apply_island_place(&app, place, outward);
}

/// 窗口中心所在显示器的可用区域。Windows 用 GetMonitorInfoW 拿 work-area
/// （排除任务栏），其他平台退回整块显示器。
#[cfg(target_os = "windows")]
fn work_area_at(center: (i32, i32)) -> Option<(i64, i64, i64, i64)> {
    let hmonitor = unsafe {
        MonitorFromPoint(
            POINT { x: center.0, y: center.1 },
            MONITOR_DEFAULTTONEAREST,
        )
    };
    if hmonitor.is_invalid() {
        return None;
    }
    let mut info = MONITORINFO {
        cbSize: std::mem::size_of::<MONITORINFO>() as u32,
        ..Default::default()
    };
    if unsafe { GetMonitorInfoW(hmonitor, &mut info) }.as_bool() {
        let rc = info.rcWork;
        Some((
            rc.left as i64,
            rc.top as i64,
            (rc.right - rc.left) as i64,
            (rc.bottom - rc.top) as i64,
        ))
    } else {
        None
    }
}

#[cfg(not(target_os = "windows"))]
fn work_area_at(_center: (i32, i32)) -> Option<(i64, i64, i64, i64)> {
    None
}

fn last_island_place_lock() -> &'static Mutex<Option<IslandPlace>> {
    LAST_ISLAND_PLACE.get_or_init(|| Mutex::new(None))
}

fn set_last_island_place(place: IslandPlace) {
    if let Ok(mut slot) = last_island_place_lock().lock() {
        *slot = Some(place);
    }
}

/// 上一次贴边摆放参数；进程启动后还没摆过时按默认（顶边居中）。
fn get_last_island_place() -> IslandPlace {
    last_island_place_lock()
        .lock()
        .ok()
        .and_then(|slot| *slot)
        .unwrap_or(IslandPlace { edge: IslandEdge::Top, ratio: None })
}

#[derive(serde::Serialize, Clone, Copy)]
struct PanelTransitionMetrics {
    island_x: i32,
    island_y: i32,
    island_width: u32,
    island_height: u32,
    panel_x: i32,
    panel_y: i32,
    panel_width: u32,
    panel_height: u32,
}

fn mouse_position_raw() -> (f64, f64) {
    #[cfg(target_os = "macos")]
    if let Ok(source) = CGEventSource::new(CGEventSourceStateID::CombinedSessionState) {
        if let Ok(event) = CGEvent::new(source) {
            let point = event.location();
            return (point.x, point.y);
        }
    }

    #[cfg(target_os = "windows")]
    {
        let mut point = POINT::default();
        if unsafe { GetCursorPos(&mut point) }.is_ok() {
            return (point.x as f64, point.y as f64);
        }
    }

    #[cfg(target_os = "linux")]
    unsafe {
        let display = xlib::XOpenDisplay(std::ptr::null());
        if !display.is_null() {
            let mut root_return = 0;
            let mut child_return = 0;
            let mut root_x = 0;
            let mut root_y = 0;
            let mut win_x = 0;
            let mut win_y = 0;
            let mut mask = 0;
            let root = xlib::XDefaultRootWindow(display);
            xlib::XQueryPointer(
                display,
                root,
                &mut root_return,
                &mut child_return,
                &mut root_x,
                &mut root_y,
                &mut win_x,
                &mut win_y,
                &mut mask,
            );
            xlib::XCloseDisplay(display);
            return (root_x as f64, root_y as f64);
        }
    }

    (0.0, 0.0)
}

#[tauri::command]
fn is_mouse_over_window<R: Runtime>(window: WebviewWindow<R>, pad: f64) -> bool {
    let (mx, my) = mouse_position_raw();

    // Windows 直接拿 hwnd 查窗口矩形：outer_position/outer_size 各要
    // 「发消息给事件循环并等回执」一趟，而这个命令被前端 200~400ms 轮询着。
    #[cfg(target_os = "windows")]
    {
        if let Ok(hwnd) = window.hwnd() {
            let mut rect = RECT::default();
            if unsafe { GetWindowRect(hwnd, &mut rect) }.is_ok() {
                let x0 = rect.left as f64 - pad;
                let y0 = rect.top as f64 - pad;
                let x1 = rect.right as f64 + pad;
                let y1 = rect.bottom as f64 + pad;
                return mx >= x0 && mx <= x1 && my >= y0 && my <= y1;
            }
        }
    }

    let Ok(pos) = window.outer_position() else { return false };
    let Ok(size) = window.outer_size() else { return false };

    // macOS: CGEvent location is in points with top-left origin; convert to physical px.
    #[cfg(target_os = "macos")]
    let (mx_px, my_px) = {
        let scale = window.scale_factor().unwrap_or(1.0);
        (mx * scale, my * scale)
    };
    // Windows/Linux: GetCursorPos / XQueryPointer already return physical px.
    #[cfg(not(target_os = "macos"))]
    let (mx_px, my_px) = (mx, my);

    let x0 = pos.x as f64 - pad;
    let y0 = pos.y as f64 - pad;
    let x1 = pos.x as f64 + size.width as f64 + pad;
    let y1 = pos.y as f64 + size.height as f64 + pad;
    mx_px >= x0 && mx_px <= x1 && my_px >= y0 && my_px <= y1
}

#[tauri::command]
fn set_click_through<R: Runtime>(window: WebviewWindow<R>, ignore: bool) {
    let _ = window.set_ignore_cursor_events(ignore);
}

#[tauri::command]
fn set_island_size<R: Runtime>(app: AppHandle<R>, scale: f64) {
    if let Some(main) = app.get_webview_window("main") {
        let base_width = 360.0;
        let base_height = 42.0;
        let _ = main.set_size(tauri::LogicalSize::new(base_width * scale, base_height * scale));
        // 尺寸变化后按最近的贴边参数重摆，岛保持贴在原来的边上
        apply_island_place(&app, get_last_island_place(), 0);
    }
}

#[tauri::command]
fn set_island_custom_size<R: Runtime>(app: AppHandle<R>, width: f64, height: f64) {
    if let Some(main) = app.get_webview_window("main") {
        let _ = main.set_size(tauri::LogicalSize::new(width, height));
        apply_island_place(&app, get_last_island_place(), 0);
    }
}

#[tauri::command]
fn emit_island_panel_motion<R: Runtime>(app: AppHandle<R>, phase: String) {
    if let Some(main) = app.get_webview_window("main") {
        let _ = main.emit("island-panel-motion", phase);
    }
}

fn last_panel_size_lock() -> &'static Mutex<Option<tauri::PhysicalSize<u32>>> {
    LAST_PANEL_SIZE.get_or_init(|| Mutex::new(None))
}

fn set_last_panel_size(size: tauri::PhysicalSize<u32>) {
    if let Ok(mut slot) = last_panel_size_lock().lock() {
        *slot = Some(size);
    }
}

fn get_last_panel_size(fallback: tauri::PhysicalSize<u32>) -> tauri::PhysicalSize<u32> {
    last_panel_size_lock()
        .lock()
        .ok()
        .and_then(|slot| *slot)
        .unwrap_or(fallback)
}

fn get_main_rect<R: Runtime>(
    app: &AppHandle<R>,
) -> Option<(tauri::PhysicalPosition<i32>, tauri::PhysicalSize<u32>)> {
    let main = app.get_webview_window("main")?;
    let pos = main.outer_position().ok()?;
    let size = main.outer_size().ok()?;
    // In dock/strip mode the actual window height is only the strip height.
    // Panel positioning and animation should use the effective full-capsule
    // height. The window width is always 360 * island_scale * scale_factor,
    // so the full capsule height = width / 360 * 42. Keep the actual height
    // when it is already larger (e.g. notification banner).
    let full_capsule_h = if size.width > 0 {
        size.width * 42 / 360
    } else {
        size.height
    };
    let effective_h = size.height.max(full_capsule_h);
    Some((pos, tauri::PhysicalSize::new(size.width, effective_h)))
}

fn panel_target_position(
    main_pos: tauri::PhysicalPosition<i32>,
    main_size: tauri::PhysicalSize<u32>,
    panel_size: tauri::PhysicalSize<u32>,
    work_area: Option<(i64, i64, i64, i64)>,
) -> tauri::PhysicalPosition<i32> {
    let mut new_x = main_pos.x + ((main_size.width as i32 - panel_size.width as i32) / 2);
    // 岛下方放不下整块面板就朝上弹（岛贴底边时的场景）
    let fits_below = match work_area {
        Some((_, area_top, _, area_height)) => {
            main_pos.y as i64 + main_size.height as i64 + PANEL_GAP_Y as i64
                + panel_size.height as i64
                <= area_top + area_height
        }
        None => true,
    };
    let new_y = if fits_below {
        main_pos.y + main_size.height as i32 + PANEL_GAP_Y
    } else {
        main_pos.y - PANEL_GAP_Y - panel_size.height as i32
    };
    // 面板别探出屏幕左右
    if let Some((area_left, _, area_width, _)) = work_area {
        let area_right = area_left + area_width;
        if panel_size.width as i64 >= area_width {
            new_x = area_left as i32;
        } else {
            new_x = (new_x as i64)
                .max(area_left)
                .min(area_right - panel_size.width as i64) as i32;
        }
    }
    tauri::PhysicalPosition::new(new_x, new_y)
}

/// 岛所在显示器的可用区域；拿不到 work-area 时退回整块屏。
fn island_work_area<R: Runtime>(app: &AppHandle<R>) -> Option<(i64, i64, i64, i64)> {
    let main = app.get_webview_window("main")?;
    let pos = main.outer_position().ok()?;
    let size = main.outer_size().ok()?;
    let center = (
        pos.x + size.width as i32 / 2,
        pos.y + size.height as i32 / 2,
    );
    work_area_at(center).or_else(|| {
        main.current_monitor().ok().flatten().map(|m| {
            let p = m.position();
            let s = m.size();
            (p.x as i64, p.y as i64, s.width as i64, s.height as i64)
        })
    })
}

/// 给前端物理动画用的边界：岛所在屏的 work-area (left, top, width, height)。
#[tauri::command]
fn get_island_work_area<R: Runtime>(app: AppHandle<R>) -> Option<(i64, i64, i64, i64)> {
    island_work_area(&app)
}

fn panel_config_values<R: Runtime>(app: &AppHandle<R>) -> (f64, f64, f64, f64) {
    if let Some(cfg) = app
        .config()
        .app
        .windows
        .iter()
        .find(|w| w.label == "panel")
    {
        let width = cfg.width;
        let height = cfg.height;
        let min_width = cfg.min_width.unwrap_or(width);
        let min_height = cfg.min_height.unwrap_or(height);
        return (width, height, min_width, min_height);
    }
    (480.0, 340.0, 400.0, 300.0)
}

fn position_panel_under_island_inner<R: Runtime>(app: &AppHandle<R>) {
    let Some(panel) = app.get_webview_window("panel") else {
        return;
    };
    let Ok(panel_size) = panel.outer_size() else {
        return;
    };
    let Some((main_pos, main_size)) = get_main_rect(app) else {
        return;
    };
    let target_pos = panel_target_position(main_pos, main_size, panel_size, island_work_area(app));
    let _ = panel.set_position(target_pos);
}

/// 显示/隐藏灵动岛（托盘左键单击、托盘菜单「显示/隐藏灵动岛」都走这里）。
/// 隐藏不会退出应用，托盘图标继续常驻。
fn toggle_main_window<R: Runtime>(app: &AppHandle<R>) {
    if let Some(main) = app.get_webview_window("main") {
        if main.is_visible().unwrap_or(true) {
            let _ = main.hide();
            // 可见性同步给前端：隐藏期间停掉悬停轮询
            let _ = main.emit("island-visibility-changed", false);
        } else {
            let _ = main.unminimize();
            let _ = main.show();
            let _ = main.set_focus();
            let _ = main.emit("island-visibility-changed", true);
        }
    }
}

/// 第二次启动时恢复已有窗口：显示并聚焦灵动岛，不新建窗口或托盘。
fn restore_main_window<R: Runtime>(app: &AppHandle<R>) {
    if let Some(main) = app.get_webview_window("main") {
        let _ = main.unminimize();
        let _ = main.show();
        let _ = main.set_focus();
        let _ = main.emit("island-visibility-changed", true);
    }

    // 面板已经开着的话也把焦点拿回来，但不额外打开新窗口
    if let Some(panel) = app.get_webview_window("panel") {
        if panel.is_visible().unwrap_or(false) {
            let _ = panel.unminimize();
            let _ = panel.set_focus();
        }
    }

    // Windows 下后台进程抢前台焦点会被系统拦，和第二实例回调配合放行
    #[cfg(target_os = "windows")]
    {
        unsafe {
            let _ = AllowSetForegroundWindow(ASFW_ANY);
        }
    }
}

/// 前端设置加载/变更时同步「关闭窗口是否隐藏到托盘」。
#[tauri::command]
fn set_close_to_tray<R: Runtime>(app: AppHandle<R>, enabled: bool) {
    app.state::<AppPrefs>()
        .close_to_tray
        .store(enabled, Ordering::Relaxed);
}

/// 按本地开关同步系统开机自启，失败原因回传给设置页。
#[tauri::command]
fn set_autostart(app: AppHandle, enabled: bool) -> Result<(), String> {
    autostart::set_autostart(&app, enabled)
}

/// 前端把计时状态推过来，更新托盘菜单文案、tooltip 与 macOS 菜单栏标题。
/// 只改文案，不承载计时逻辑。
#[tauri::command]
fn update_tray_state(app: AppHandle, state: tray::TrayMenuState) {
    let Some(handles) = app.try_state::<TrayHandles>() else {
        return;
    };

    let labels = tray::labels(&state);
    let _ = handles.toggle_timer.set_text(labels.toggle);
    let _ = handles.skip_phase.set_text(labels.skip);
    let _ = handles.skip_phase.set_enabled(labels.skip_enabled);
    let _ = handles.tray_icon.set_tooltip(Some(labels.tooltip));

    // Windows/Linux 的托盘图标没有可用标题区，只有 macOS 菜单栏支持。
    #[cfg(target_os = "macos")]
    {
        let _ = handles.tray_icon.set_title(labels.title);
    }
}

/// 重新注册全局快捷键：先清空旧的，再按配置逐个注册。
/// 单个组合失败只记录下来，不影响另一个，也不让应用崩溃。
#[tauri::command]
fn update_shortcuts(
    app: AppHandle,
    config: shortcuts::ShortcutConfig,
) -> shortcuts::ShortcutUpdateResult {
    let global = app.global_shortcut();
    let bindings = app.state::<ShortcutBindings>();
    bindings.clear();
    let _ = global.unregister_all();

    let (pending, mut errors) = shortcuts::collect(&config);
    for binding in pending {
        match global.register(binding.shortcut.clone()) {
            Ok(_) => bindings.insert(binding.shortcut.id(), binding.action),
            Err(e) => errors.push(shortcuts::ShortcutError {
                action: binding.action.to_string(),
                message: format!("系统拒绝注册这个快捷键：{e}"),
            }),
        }
    }

    shortcuts::ShortcutUpdateResult::from_errors(errors)
}

#[tauri::command]
fn position_panel_under_island<R: Runtime>(app: AppHandle<R>) {
    position_panel_under_island_inner(&app);
}

#[tauri::command]
fn get_panel_transition_metrics<R: Runtime>(app: AppHandle<R>) -> Option<PanelTransitionMetrics> {
    let Some(panel) = app.get_webview_window("panel") else {
        return None;
    };
    let Some((main_pos, main_size)) = get_main_rect(&app) else {
        return None;
    };

    let (cfg_w, cfg_h, cfg_min_w, cfg_min_h) = panel_config_values(&app);
    let scale = panel.scale_factor().unwrap_or(1.0);
    let fallback_size = panel.outer_size().unwrap_or(tauri::PhysicalSize::new(
        (cfg_w * scale).round() as u32,
        (cfg_h * scale).round() as u32,
    ));
    let panel_size = if panel.is_visible().unwrap_or(false) {
        panel.outer_size().unwrap_or(fallback_size)
    } else {
        get_last_panel_size(fallback_size)
    };
    let min_width = (cfg_min_w * scale).round() as u32;
    let min_height = (cfg_min_h * scale).round() as u32;
    let panel_size = tauri::PhysicalSize::new(
        panel_size.width.max(min_width),
        panel_size.height.max(min_height),
    );
    let panel_pos = panel_target_position(main_pos, main_size, panel_size, island_work_area(&app));

    Some(PanelTransitionMetrics {
        island_x: main_pos.x,
        island_y: main_pos.y,
        island_width: main_size.width,
        island_height: main_size.height,
        panel_x: panel_pos.x,
        panel_y: panel_pos.y,
        panel_width: panel_size.width,
        panel_height: panel_size.height,
    })
}

#[tauri::command]
fn hide_panel<R: Runtime>(app: AppHandle<R>) {
    if let Some(panel) = app.get_webview_window("panel") {
        if let Ok(size) = panel.outer_size() {
            set_last_panel_size(size);
        }
        let _ = panel.hide();
    }
}

#[tauri::command]
fn toggle_panel<R: Runtime>(app: AppHandle<R>) {
    if let Some(panel) = app.get_webview_window("panel") {
        if panel.is_visible().unwrap_or(false) {
            animate_panel_close(app.clone());
        } else {
            animate_panel_open(app.clone());
        }
    }
}

fn animate_panel_open<R: Runtime>(app: AppHandle<R>) {
    let Some(panel) = app.get_webview_window("panel") else {
        return;
    };
    if panel.is_visible().unwrap_or(false) {
        return;
    }
    let Some((main_pos, main_size)) = get_main_rect(&app) else {
        return;
    };

    let (cfg_w, cfg_h, cfg_min_w, cfg_min_h) = panel_config_values(&app);
    let scale = panel.scale_factor().unwrap_or(1.0);
    let fallback_size = panel.outer_size().unwrap_or(tauri::PhysicalSize::new(
        (cfg_w * scale).round() as u32,
        (cfg_h * scale).round() as u32,
    ));
    let target_size = get_last_panel_size(fallback_size);
    let min_width = (cfg_min_w * scale).round() as u32;
    let min_height = (cfg_min_h * scale).round() as u32;
    let target_size = tauri::PhysicalSize::new(
        target_size.width.max(min_width),
        target_size.height.max(min_height),
    );
    let target_pos = panel_target_position(main_pos, main_size, target_size, island_work_area(&app));

    let _ = panel.set_ignore_cursor_events(false);
    let _ = panel.set_position(target_pos);
    let _ = panel.set_size(target_size);
    let _ = panel.set_min_size(Some(tauri::LogicalSize::new(cfg_min_w, cfg_min_h)));

    if let Some(main) = app.get_webview_window("main") {
        if !main.is_visible().unwrap_or(true) {
            let _ = main.show();
            let _ = main.emit("island-visibility-changed", true);
        }
    }
    let _ = panel.show();
    let _ = panel.emit("panel-window-transition", "open");
}

#[tauri::command]
fn animate_panel_close<R: Runtime>(app: AppHandle<R>) {
    let Some(panel) = app.get_webview_window("panel") else {
        return;
    };
    if !panel.is_visible().unwrap_or(false) {
        return;
    }

    if let Ok(size) = panel.outer_size() {
        set_last_panel_size(size);
    }
    if panel.emit("panel-window-transition", "close").is_err() {
        let _ = panel.hide();
    }
}

#[tauri::command]
fn is_panel_visible<R: Runtime>(app: AppHandle<R>) -> bool {
    if let Some(panel) = app.get_webview_window("panel") {
        return panel.is_visible().unwrap_or(false);
    }
    false
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        // 单实例插件必须最先注册：第二次启动在这里被拦截，不会创建新窗口/托盘/快捷键。
        .plugin(tauri_plugin_single_instance::init(|app, _args, _cwd| {
            restore_main_window(app);
        }))
        // 快捷键在 Rust 侧注册：窗口隐藏/重载都不会掉，冲突也能同步返回给前端。
        .plugin(
            tauri_plugin_global_shortcut::Builder::new()
                .with_handler(|app, shortcut, event| {
                    if event.state != ShortcutState::Pressed {
                        return;
                    }
                    let Some(bindings) = app.try_state::<ShortcutBindings>() else {
                        return;
                    };
                    if let Some(action) = bindings.action_for(shortcut.id()) {
                        let _ = app.emit("shortcut-command", action);
                    }
                })
                .build(),
        )
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_notification::init())
        .plugin(tauri_plugin_http::init())
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_clipboard_manager::init())
        .plugin(tauri_plugin_autostart::init(
            tauri_plugin_autostart::MacosLauncher::LaunchAgent,
            Some(vec!["--hidden"]),
        ))
        .on_window_event(|window, event| {
            if let WindowEvent::CloseRequested { api, .. } = event {
                let close_to_tray = window
                    .app_handle()
                    .state::<AppPrefs>()
                    .close_to_tray
                    .load(Ordering::Relaxed);
                if close_to_tray {
                    // 默认隐藏到托盘，退出请用托盘菜单的「退出」
                    api.prevent_close();
                    let _ = window.hide();
                    if window.label() == "main" {
                        // 首次隐藏时前端会给一次「已藏到托盘」的提示
                        let _ = window.emit("island-hidden-to-tray", ());
                        let _ = window.emit("island-visibility-changed", false);
                    }
                } else {
                    window.app_handle().exit(0);
                }
            }
        })
        .on_tray_icon_event(|app, event| {
            if let TrayIconEvent::Click {
                button,
                button_state,
                ..
            } = event
            {
                if button == MouseButton::Left && button_state == MouseButtonState::Up {
                    // 左键单击：切换灵动岛的显示/隐藏；右键才出菜单。
                    toggle_main_window(app);
                }
            }
        })
        .invoke_handler(tauri::generate_handler![
            is_mouse_over_window,
            set_click_through,
            set_island_size,
            set_island_custom_size,
            place_island,
            peek_island,
            get_island_work_area,
            emit_island_panel_motion,
            position_panel_under_island,
            get_panel_transition_metrics,
            animate_panel_close,
            hide_panel,
            toggle_panel,
            is_panel_visible,
            set_close_to_tray,
            set_autostart,
            update_tray_state,
            update_shortcuts,
        ])
        .setup(|app| {
            // 关闭行为 / 托盘状态都由前端设置驱动；先给出默认值，窗口事件才读得到。
            app.manage(AppPrefs::default());
            app.manage(ShortcutBindings::default());

            if let Some(window) = app.get_webview_window("main") {
                if let Ok(Some(monitor)) = window.current_monitor() {
                    let scale_factor = monitor.scale_factor();
                    let screen_width = monitor.size().width as f64;
                    let win_width = 360.0_f64 * scale_factor;
                    let position = monitor.position();
                    let x = position.x as f64 + (screen_width - win_width) / 2.0;
                    let y = position.y as f64;
                    let _ = window.set_position(tauri::PhysicalPosition::new(x as i32, y as i32));
                }
                let _ = window.set_background_color(Some(Color(0, 0, 0, 0)));
            }

            if let Some(panel) = app.get_webview_window("panel") {
                let _ = panel.set_background_color(Some(Color(0, 0, 0, 0)));
                let _ = panel.set_shadow(false);
                let app_handle = app.handle().clone();
                panel.on_window_event(move |event| {
                    if let WindowEvent::Resized(size) = event {
                        set_last_panel_size(*size);
                        position_panel_under_island_inner(&app_handle);
                    }
                });
            }

            // 托盘菜单顺序固定：计时动作 → 窗口动作 → 退出。
            // 「开始/暂停」和「跳过」只 emit 给前端，真正计时逻辑仍在 panel 窗口。
            let toggle_timer =
                MenuItem::with_id(app, "toggle_timer", "开始专注", true, None::<&str>)?;
            let skip_phase =
                MenuItem::with_id(app, "skip_phase", "跳过当前阶段", false, None::<&str>)?;
            let open_panel =
                MenuItem::with_id(app, "open_panel", "打开专注清单", true, None::<&str>)?;
            let toggle_island =
                MenuItem::with_id(app, "toggle_island", "显示/隐藏灵动岛", true, None::<&str>)?;
            let separator_top = PredefinedMenuItem::separator(app)?;
            let separator_bottom = PredefinedMenuItem::separator(app)?;
            let quit = MenuItem::with_id(app, "quit", "退出", true, None::<&str>)?;

            let menu = Menu::with_items(
                app,
                &[
                    &toggle_timer,
                    &skip_phase,
                    &separator_top,
                    &open_panel,
                    &toggle_island,
                    &separator_bottom,
                    &quit,
                ],
            )?;

            let tray_icon = Image::from_bytes(TRAY_ICON_BYTES)?;

            let tray = TrayIconBuilder::new()
                .icon(tray_icon)
                .menu(&menu)
                .show_menu_on_left_click(false)
                .on_menu_event(|app, event| match event.id.as_ref() {
                    "toggle_timer" => {
                        let _ = app.emit("tray-command", "toggle-timer");
                    }
                    "skip_phase" => {
                        let _ = app.emit("tray-command", "skip");
                    }
                    "open_panel" => {
                        animate_panel_open(app.clone());
                    }
                    "toggle_island" => {
                        toggle_main_window(app);
                    }
                    "quit" => {
                        app.exit(0);
                    }
                    _ => {}
                })
                .build(app)?;

            app.manage(TrayHandles {
                toggle_timer,
                skip_phase,
                tray_icon: tray,
            });

            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}

#[cfg(test)]
mod tests {
    use super::*;

    const AREA: (i64, i64, i64, i64) = (0, 0, 1920, 1080);
    const WIN: (i64, i64) = (360, 42);

    #[test]
    fn top_edge_centers_by_default() {
        assert_eq!(island_position_for_edge(AREA, WIN, IslandEdge::Top, None), (780, 0));
    }

    #[test]
    fn top_edge_ratio_moves_along_and_clamps() {
        assert_eq!(island_position_for_edge(AREA, WIN, IslandEdge::Top, Some(0.0)), (0, 0));
        assert_eq!(island_position_for_edge(AREA, WIN, IslandEdge::Top, Some(1.0)), (1560, 0));
        // 超界比例按 0~1 处理
        assert_eq!(island_position_for_edge(AREA, WIN, IslandEdge::Top, Some(1.5)), (1560, 0));
        assert_eq!(island_position_for_edge(AREA, WIN, IslandEdge::Top, Some(-2.0)), (0, 0));
    }

    #[test]
    fn bottom_edge_sticks_to_work_area_bottom() {
        assert_eq!(island_position_for_edge(AREA, WIN, IslandEdge::Bottom, None), (780, 1038));
        assert_eq!(island_position_for_edge(AREA, WIN, IslandEdge::Bottom, Some(1.0)), (1560, 1038));
    }

    #[test]
    fn window_bigger_than_area_parks_at_origin() {
        // 窗口比区域还高/宽时钳回区域起点，别探出屏幕外
        assert_eq!(island_position_for_edge(AREA, (3000, 1500), IslandEdge::Bottom, Some(0.8)), (0, 0));
        assert_eq!(island_position_for_edge(AREA, (3000, 1500), IslandEdge::Top, None), (0, 0));
    }

    #[test]
    fn offset_rounds_half_up() {
        // 1038 * 0.25 = 259.5
        assert_eq!(offset_along_edge(1080, 42, Some(0.25)), 260);
    }

    #[test]
    fn panel_flips_above_when_no_room_below() {
        // 岛贴底边：下方放不下 340 高的面板，翻到上方
        let main_pos = tauri::PhysicalPosition::new(780, 1038);
        let main_size = tauri::PhysicalSize::new(360, 42);
        let panel_size = tauri::PhysicalSize::new(480, 340);
        let pos = panel_target_position(main_pos, main_size, panel_size, Some(AREA));
        assert_eq!(pos.y, 1038 - 6 - 340);
        assert_eq!(pos.x, 720);
    }

    #[test]
    fn panel_clamps_into_screen_horizontally() {
        // 岛贴左边缘：面板居中于岛会探出左边界，钳回工作区左缘
        let main_pos = tauri::PhysicalPosition::new(0, 500);
        let main_size = tauri::PhysicalSize::new(360, 42);
        let panel_size = tauri::PhysicalSize::new(480, 340);
        let pos = panel_target_position(main_pos, main_size, panel_size, Some(AREA));
        assert_eq!(pos.y, 500 + 42 + 6);
        assert_eq!(pos.x, 0);
    }

    #[test]
    fn panel_stays_below_when_it_fits() {
        let main_pos = tauri::PhysicalPosition::new(780, 500);
        let main_size = tauri::PhysicalSize::new(360, 42);
        let panel_size = tauri::PhysicalSize::new(480, 340);
        let pos = panel_target_position(main_pos, main_size, panel_size, Some(AREA));
        assert_eq!(pos.y, 500 + 42 + 6);
        assert_eq!(pos.x, 720);
    }

    #[test]
    fn panel_without_work_area_keeps_legacy_below() {
        let main_pos = tauri::PhysicalPosition::new(780, 1038);
        let main_size = tauri::PhysicalSize::new(360, 42);
        let panel_size = tauri::PhysicalSize::new(480, 340);
        let pos = panel_target_position(main_pos, main_size, panel_size, None);
        assert_eq!(pos.y, 1038 + 42 + 6);
    }

    #[test]
    fn island_edge_parses_known_directions() {
        assert_eq!(IslandEdge::parse("top"), Some(IslandEdge::Top));
        assert_eq!(IslandEdge::parse("bottom"), Some(IslandEdge::Bottom));
        // 左右贴边已移除
        assert_eq!(IslandEdge::parse("left"), None);
        assert_eq!(IslandEdge::parse("right"), None);
        assert_eq!(IslandEdge::parse("center"), None);
    }
}

#[cfg(test)]
mod peek_tests {
    use super::*;

    #[test]
    fn peek_outward_leaves_a_sliver() {
        // 42 高的窗口收起时滑出 32、露出 10
        assert_eq!(peek_outward(42), 32);
        assert_eq!(peek_outward(14), 4);
        // 窗口比露出宽度还小就原地不动
        assert_eq!(peek_outward(8), 0);
    }

    #[test]
    fn shift_outward_slides_away_from_screen() {
        assert_eq!(shift_outward(780, 0, IslandEdge::Top, 32), (780, -32));
        assert_eq!(shift_outward(780, 1038, IslandEdge::Bottom, 32), (780, 1070));
        // 0 表示不外滑
        assert_eq!(shift_outward(780, 0, IslandEdge::Top, 0), (780, 0));
    }
}
