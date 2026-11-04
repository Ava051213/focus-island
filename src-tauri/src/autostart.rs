//! 开机自启。
//!
//! 启动项本身由 tauri-plugin-autostart 写入；Windows 下额外修正系统
//! 「启动项已禁用」标记（StartupApproved\Run）。联想电脑管家等工具会把
//! 启动项标记成禁用，此时只调用插件 enable 仍不会开机拉起，因此每次
//! 启用都以本地设置为准，重新写一遍批准记录。

#[cfg(target_os = "windows")]
use winreg::enums::{HKEY_CURRENT_USER, REG_BINARY};
#[cfg(target_os = "windows")]
use winreg::RegKey;

#[cfg(target_os = "windows")]
const RUN_KEY: &str = r"Software\Microsoft\Windows\CurrentVersion\Run";
#[cfg(target_os = "windows")]
const APPROVED_KEY: &str =
    r"Software\Microsoft\Windows\CurrentVersion\Explorer\StartupApproved\Run";

#[cfg(target_os = "windows")]
fn set_startup_approved(app_name: &str, enabled: bool) -> Result<(), String> {
    let hkcu = RegKey::predef(HKEY_CURRENT_USER);
    let (approved, _) = hkcu
        .create_subkey(APPROVED_KEY)
        .map_err(|e| format!("打开启动项批准记录失败：{e}"))?;

    // 12 字节：首字节 02 表示启用、03 表示禁用，其余为系统记录的时间戳
    let mut bytes = [0u8; 12];
    bytes[0] = if enabled { 2 } else { 3 };
    approved
        .set_raw_value(
            app_name,
            &winreg::RegValue {
                bytes: bytes.to_vec(),
                vtype: REG_BINARY,
            },
        )
        .map_err(|e| format!("写入启动项批准记录失败：{e}"))?;

    Ok(())
}

#[cfg(target_os = "windows")]
fn startup_entry_exists(app_name: &str) -> bool {
    RegKey::predef(HKEY_CURRENT_USER)
        .open_subkey(RUN_KEY)
        .and_then(|run| run.get_raw_value(app_name))
        .is_ok()
}

/// 按本地开关同步系统启动项，失败原因原样交给前端展示。
pub fn set_autostart(app: &tauri::AppHandle, enabled: bool) -> Result<(), String> {
    use tauri_plugin_autostart::ManagerExt;

    let autolaunch = app.autolaunch();
    if enabled {
        autolaunch
            .enable()
            .map_err(|e| format!("启用开机自启失败：{e}"))?;
    } else {
        autolaunch
            .disable()
            .map_err(|e| format!("关闭开机自启失败：{e}"))?;
    }

    #[cfg(target_os = "windows")]
    {
        let app_name = app.package_info().name.clone();
        set_startup_approved(&app_name, enabled)?;
        if enabled && !startup_entry_exists(&app_name) {
            return Err("启动项没有出现在系统里，可能被安全软件拦截了".into());
        }
    }

    #[cfg(not(target_os = "windows"))]
    let _ = app;

    Ok(())
}
