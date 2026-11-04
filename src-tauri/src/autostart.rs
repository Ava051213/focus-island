//! 开机自启。
//!
//! Windows 下写用户启动文件夹里的隐藏启动脚本，而不是注册表 Run 键：
//! 本机的安全软件会实时删除专注岛的 Run 启动项，启动文件夹不受影响。
//! 脚本用 UTF-16LE 保存，避免中文安装路径在 WScript 里乱码。
//! 其它平台继续交给 tauri-plugin-autostart。

use std::path::PathBuf;

#[cfg(target_os = "windows")]
const STARTUP_SCRIPT_NAME: &str = "focus-island.vbs";

#[cfg(target_os = "windows")]
fn startup_dir() -> Result<PathBuf, String> {
    let appdata = std::env::var_os("APPDATA").ok_or_else(|| "找不到 APPDATA 目录".to_string())?;
    Ok(PathBuf::from(appdata)
        .join("Microsoft")
        .join("Windows")
        .join("Start Menu")
        .join("Programs")
        .join("Startup"))
}

#[cfg(target_os = "windows")]
fn startup_script() -> Result<String, String> {
    let exe = std::env::current_exe().map_err(|e| format!("找不到程序路径：{e}"))?;
    let path = exe.to_string_lossy();
    if path.contains('"') {
        return Err("程序路径包含引号，无法注册启动项".into());
    }
    Ok(format!(
        "Set sh = CreateObject(\"WScript.Shell\")\r\nsh.Run \"\"\"{path}\"\"\", 0, False\r\n",
    ))
}

/// WScript 原生识别 UTF-16LE，带 BOM 最稳
#[cfg(target_os = "windows")]
fn utf16le_with_bom(text: &str) -> Vec<u8> {
    let mut bytes = vec![0xFF, 0xFE];
    for unit in text.encode_utf16() {
        bytes.extend_from_slice(&unit.to_le_bytes());
    }
    bytes
}

#[cfg(target_os = "windows")]
fn set_startup_folder(enabled: bool) -> Result<(), String> {
    let dir = startup_dir()?;
    let file = dir.join(STARTUP_SCRIPT_NAME);

    if enabled {
        std::fs::create_dir_all(&dir).map_err(|e| format!("创建启动文件夹失败：{e}"))?;
        let script = startup_script()?;
        std::fs::write(&file, utf16le_with_bom(&script))
            .map_err(|e| format!("写入启动脚本失败：{e}"))?;
    } else if file.exists() {
        std::fs::remove_file(&file).map_err(|e| format!("删除启动脚本失败：{e}"))?;
    }

    Ok(())
}

/// 按本地开关同步系统启动项，失败原因原样交给前端展示。
pub fn set_autostart(app: &tauri::AppHandle, enabled: bool) -> Result<(), String> {
    #[cfg(target_os = "windows")]
    {
        let _ = app;
        set_startup_folder(enabled)
    }

    #[cfg(not(target_os = "windows"))]
    {
        use tauri_plugin_autostart::ManagerExt;

        let autolaunch = app.autolaunch();
        if enabled {
            autolaunch
                .enable()
                .map_err(|e| format!("启用开机自启失败：{e}"))
        } else {
            autolaunch
                .disable()
                .map_err(|e| format!("关闭开机自启失败：{e}"))
        }
    }
}
