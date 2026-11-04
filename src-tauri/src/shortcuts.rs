//! 全局快捷键配置的校验与解析（纯逻辑）。
//!
//! 前端把 `{ enabled, toggleTimer, showWindow }` 传进来，这里负责：
//! - 禁用时返回空列表；
//! - 解析失败的组合给出可读错误；
//! - 两个快捷键相同时拒绝注册第二个。
//!
//! 真正的注册/注销在 lib.rs，方便这里做无副作用的单测。

use serde::{Deserialize, Serialize};
use tauri_plugin_global_shortcut::Shortcut;

pub const ACTION_TOGGLE_TIMER: &str = "toggle-timer";
pub const ACTION_SHOW_WINDOW: &str = "show-window";

#[derive(Debug, Clone, Default, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ShortcutConfig {
    pub enabled: bool,
    pub toggle_timer: String,
    pub show_window: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ShortcutError {
    pub action: String,
    pub message: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ShortcutUpdateResult {
    pub ok: bool,
    pub errors: Vec<ShortcutError>,
}

impl ShortcutUpdateResult {
    pub fn from_errors(errors: Vec<ShortcutError>) -> Self {
        Self {
            ok: errors.is_empty(),
            errors,
        }
    }
}

#[derive(Debug, Clone)]
pub struct Binding {
    pub action: &'static str,
    pub shortcut: Shortcut,
}

fn error(action: &str, message: impl Into<String>) -> ShortcutError {
    ShortcutError {
        action: action.to_string(),
        message: message.into(),
    }
}

fn parse(action: &str, raw: &str, errors: &mut Vec<ShortcutError>) -> Option<Shortcut> {
    let text = raw.trim();
    if text.is_empty() {
        return None;
    }
    match text.parse::<Shortcut>() {
        Ok(shortcut) => Some(shortcut),
        Err(_) => {
            errors.push(error(
                action,
                format!("无法识别的快捷键「{text}」，请用 Ctrl+Alt+Space 这种写法"),
            ));
            None
        }
    }
}

/// 把配置翻译成待注册的快捷键列表；错误同时返回给前端展示。
pub fn collect(config: &ShortcutConfig) -> (Vec<Binding>, Vec<ShortcutError>) {
    if !config.enabled {
        return (Vec::new(), Vec::new());
    }

    let mut errors = Vec::new();
    let mut bindings = Vec::new();

    match parse(ACTION_TOGGLE_TIMER, &config.toggle_timer, &mut errors) {
        Some(shortcut) => bindings.push(Binding {
            action: ACTION_TOGGLE_TIMER,
            shortcut,
        }),
        None if config.toggle_timer.trim().is_empty() => errors.push(error(
            ACTION_TOGGLE_TIMER,
            "开始/暂停快捷键不能为空；不想用时可以直接关掉全局快捷键",
        )),
        None => {}
    }

    // 第二个快捷键是可选项，留空不报错
    if let Some(shortcut) = parse(ACTION_SHOW_WINDOW, &config.show_window, &mut errors) {
        if let Some(first) = bindings.first() {
            if first.shortcut.id() == shortcut.id() {
                errors.push(error(
                    ACTION_SHOW_WINDOW,
                    "两个快捷键不能相同，请换一个组合",
                ));
            } else {
                bindings.push(Binding {
                    action: ACTION_SHOW_WINDOW,
                    shortcut,
                });
            }
        } else {
            bindings.push(Binding {
                action: ACTION_SHOW_WINDOW,
                shortcut,
            });
        }
    }

    (bindings, errors)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn config(enabled: bool, toggle: &str, show: &str) -> ShortcutConfig {
        ShortcutConfig {
            enabled,
            toggle_timer: toggle.to_string(),
            show_window: show.to_string(),
        }
    }

    #[test]
    fn disabled_returns_no_bindings_and_no_errors() {
        let (bindings, errors) = collect(&config(false, "Control+Alt+Space", "Control+Shift+P"));
        assert!(bindings.is_empty());
        assert!(errors.is_empty());
    }

    #[test]
    fn empty_toggle_is_reported_when_enabled() {
        let (bindings, errors) = collect(&config(true, "  ", ""));
        assert!(bindings.is_empty());
        assert_eq!(errors.len(), 1);
        assert_eq!(errors[0].action, ACTION_TOGGLE_TIMER);
        assert!(errors[0].message.contains("不能为空"));
    }

    #[test]
    fn valid_config_builds_two_bindings() {
        let (bindings, errors) = collect(&config(true, "Control+Alt+Space", "Control+Shift+P"));
        assert!(errors.is_empty());
        assert_eq!(bindings.len(), 2);
        assert_eq!(bindings[0].action, ACTION_TOGGLE_TIMER);
        assert_eq!(bindings[1].action, ACTION_SHOW_WINDOW);
    }

    #[test]
    fn optional_show_window_can_be_empty() {
        let (bindings, errors) = collect(&config(true, "Control+Alt+Space", ""));
        assert!(errors.is_empty());
        assert_eq!(bindings.len(), 1);
        assert_eq!(bindings[0].action, ACTION_TOGGLE_TIMER);
    }

    #[test]
    fn invalid_shortcut_is_reported_without_panicking() {
        let (bindings, errors) = collect(&config(true, "NotAKey", ""));
        assert!(bindings.is_empty());
        assert_eq!(errors.len(), 1);
        assert_eq!(errors[0].action, ACTION_TOGGLE_TIMER);
        assert!(errors[0].message.contains("无法识别"));
    }

    #[test]
    fn duplicate_shortcuts_keep_only_the_first() {
        let (bindings, errors) = collect(&config(true, "Control+Alt+Space", "ctrl+alt+space"));
        assert_eq!(bindings.len(), 1);
        assert_eq!(errors.len(), 1);
        assert_eq!(errors[0].action, ACTION_SHOW_WINDOW);
        assert!(errors[0].message.contains("不能相同"));
    }
}
