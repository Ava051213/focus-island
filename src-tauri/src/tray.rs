//! 托盘菜单文案与 tooltip 的纯逻辑。
//!
//! 前端通过 `update_tray_state` 把计时状态推给 Rust，这里只负责把状态翻译成
//! 菜单文案、跳过项是否可用、tooltip / macOS 标题。保持无副作用，方便单测。

use serde::Deserialize;

/// 前端推来的托盘状态。字段名与 `useTraySync.ts` 的 payload 对齐。
#[derive(Debug, Clone, Default, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TrayMenuState {
    /// idle / focus / focusPaused / break / breakPaused / completed
    pub status: String,
    /// focus / break
    pub phase: String,
    pub running: bool,
    pub remaining_seconds: u64,
    pub task_title: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct TrayLabels {
    pub toggle: String,
    pub skip: String,
    pub skip_enabled: bool,
    pub tooltip: String,
    /// macOS 菜单栏标题（剩余分钟），其它平台不使用。
    pub title: Option<String>,
}

fn is_paused(status: &str) -> bool {
    status == "focusPaused" || status == "breakPaused"
}

fn is_idle(status: &str) -> bool {
    status == "idle" || status.is_empty()
}

fn minutes_left(remaining_seconds: u64) -> u64 {
    // 向上取整：剩 59 秒也算 1 分钟，避免显示 0 分钟
    remaining_seconds.saturating_add(59) / 60
}

fn remaining_text(remaining_seconds: u64) -> String {
    let minutes = minutes_left(remaining_seconds);
    if minutes == 0 {
        "不到 1 分钟".to_string()
    } else {
        format!("剩余 {} 分钟", minutes)
    }
}

pub fn labels(state: &TrayMenuState) -> TrayLabels {
    let idle = is_idle(&state.status);
    let completed = state.status == "completed";
    let paused = is_paused(&state.status);
    let is_break = state.phase == "break";

    let toggle = if state.running {
        if is_break { "暂停休息" } else { "暂停专注" }
    } else if paused {
        if is_break { "继续休息" } else { "继续专注" }
    } else if completed {
        "开始下一轮"
    } else {
        "开始专注"
    };

    // idle / completed 没有进行中的阶段，跳过项不可用
    let skip_enabled = !idle && !completed;
    let skip = if skip_enabled {
        if is_break { "跳过休息" } else { "跳过当前专注" }
    } else {
        "跳过当前阶段"
    };

    let task = state
        .task_title
        .as_deref()
        .map(str::trim)
        .filter(|title| !title.is_empty());

    let tooltip = if idle {
        "专注岛 · 空闲".to_string()
    } else if completed {
        "专注岛 · 一轮结束，等你决定".to_string()
    } else {
        let phase = if is_break { "休息" } else { "专注" };
        let status_word = if paused { "已暂停" } else { "进行中" };
        let remaining = remaining_text(state.remaining_seconds);
        match task {
            Some(title) => format!("{phase} · {status_word} · {remaining} · {title}"),
            None => format!("{phase} · {status_word} · {remaining}"),
        }
    };

    let title = if !idle && !completed {
        Some(format!("{}m", minutes_left(state.remaining_seconds)))
    } else {
        None
    };

    TrayLabels {
        toggle: toggle.to_string(),
        skip: skip.to_string(),
        skip_enabled,
        tooltip,
        title,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn state(status: &str, phase: &str, running: bool, remaining: u64) -> TrayMenuState {
        TrayMenuState {
            status: status.to_string(),
            phase: phase.to_string(),
            running,
            remaining_seconds: remaining,
            task_title: None,
        }
    }

    #[test]
    fn idle_menu_starts_focus_and_disables_skip() {
        let labels = labels(&state("idle", "focus", false, 0));
        assert_eq!(labels.toggle, "开始专注");
        assert_eq!(labels.skip, "跳过当前阶段");
        assert!(!labels.skip_enabled);
        assert_eq!(labels.tooltip, "专注岛 · 空闲");
        assert!(labels.title.is_none());
    }

    #[test]
    fn running_focus_pauses_and_skip_is_enabled() {
        let mut s = state("focus", "focus", true, 25 * 60);
        s.task_title = Some("写测试".to_string());
        let labels = labels(&s);

        assert_eq!(labels.toggle, "暂停专注");
        assert_eq!(labels.skip, "跳过当前专注");
        assert!(labels.skip_enabled);
        assert_eq!(labels.tooltip, "专注 · 进行中 · 剩余 25 分钟 · 写测试");
        assert_eq!(labels.title.as_deref(), Some("25m"));
    }

    #[test]
    fn paused_focus_shows_resume() {
        let labels = labels(&state("focusPaused", "focus", false, 12 * 60));
        assert_eq!(labels.toggle, "继续专注");
        assert!(labels.tooltip.contains("已暂停"));
    }

    #[test]
    fn break_uses_break_labels() {
        let labels = labels(&state("break", "break", true, 5 * 60));
        assert_eq!(labels.toggle, "暂停休息");
        assert_eq!(labels.skip, "跳过休息");
        assert_eq!(labels.tooltip, "休息 · 进行中 · 剩余 5 分钟");
    }

    #[test]
    fn paused_break_shows_resume() {
        let labels = labels(&state("breakPaused", "break", false, 3 * 60));
        assert_eq!(labels.toggle, "继续休息");
        assert_eq!(labels.skip, "跳过休息");
    }

    #[test]
    fn completed_waits_for_next_round() {
        let labels = labels(&state("completed", "focus", false, 0));
        assert_eq!(labels.toggle, "开始下一轮");
        assert!(!labels.skip_enabled);
        assert_eq!(labels.tooltip, "专注岛 · 一轮结束，等你决定");
        assert!(labels.title.is_none());
    }

    #[test]
    fn remaining_under_one_minute_is_not_rounded_to_zero() {
        let labels = labels(&state("focus", "focus", true, 59));
        assert_eq!(labels.tooltip, "专注 · 进行中 · 剩余 1 分钟");
        assert_eq!(labels.title.as_deref(), Some("1m"));
    }

    #[test]
    fn empty_task_title_is_ignored() {
        let mut s = state("focus", "focus", true, 60);
        s.task_title = Some("   ".to_string());
        let labels = labels(&s);
        assert_eq!(labels.tooltip, "专注 · 进行中 · 剩余 1 分钟");
    }
}
