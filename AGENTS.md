# AGENTS.md

This file provides guidance to Codex (Codex.ai/code) when working with code in this repository.

> 本文件是仓库唯一的架构说明。`CLAUDE.md` 只指向这里，改架构时只改这一份。

## Commands

```bash
# 开发（热更新）
npm run dev          # tauri dev = 启动 vite:dev + Rust 后端
npm run vite:dev     # 仅启动前端 Vite（无 Tauri，用于纯 UI 调试）

# 构建
npm run vite:build   # 仅构建前端到 dist/
cargo tauri build --debug   # 构建调试版（跳过安装包打包）
npm run build        # 完整 Tauri 生产构建

# 检查
npx vue-tsc --noEmit
npm run test         # vitest 单测（不涉及 Tauri 运行时）
cd src-tauri && cargo check
```

> **注意**：`package.json` 中 `build` = `tauri build`，`vite:build` = `vite build`。
> Tauri 的 `beforeBuildCommand` 调用 `vite:build` 以避免递归。

## CI

`.github/workflows/ci.yml`：push 到 clean-main 或开 PR 时跑前端三项检查（`vue-tsc --noEmit`、`npm run test`、`vite:build`）。

故意不跑 Rust：`cargo check` 在 GitHub 的 Windows runner 上要现装工具链、拉几百个 crate，一轮十几分钟还容易超时；前端三项一分多钟，足以拦住绝大多数改坏。

## 架构概览

### 双窗口架构

应用由两个 Tauri 窗口组成，通过事件通信：
- **main 窗口**（灵动岛）：`App.vue` → `Island.vue`，360×42，置顶+透明+无边框，默认鼠标穿透
- **panel 窗口**（专注清单）：`PanelApp.vue`，420×600，从灵动岛弹出的面板，有打开/关闭动画

计时器逻辑运行在 panel 窗口（`useTimerBridge.ts`），在关键状态变化（阶段、运行状态、专注对象、时长）时通过 `emit('timer-state-update')` 广播快照（含 `syncedAt`）。main 窗口收到后用 `syncedAt + remaining` 推算结束时间，本地自行倒计时。main 窗口启动时会发 `timer-state-request` 拉取一次快照。

计时结束时 panel 设置 `pendingNotification` 并广播 `notification-show`，灵动岛显示通知横幅，用户操作通过 `notification-action`（confirm / extend / dismiss）回传 panel。

两个窗口都**不会真正关闭**：Rust 侧拦截 `CloseRequested` 改为 `hide()`，退出只能走托盘菜单。

### 状态机

灵动岛 UI 状态由 `src/composables/useIslandState.ts` 管理，状态值来自 `timer-state-update`：

```
idle → focus / break（收到 running 的计时快照）
focus / break → idle（计时停止且没有专注对象）
idle → alert（useIdle 5 分钟无操作；注意它只统计灵动岛窗口内的事件）
alert → 恢复（窗口内有鼠标/键盘活动）
```

`hide` 仍是遗留定义：没有任何 `setState('hide')` 调用，但 `setInteracting(true)` 保留了从 `hide` 恢复到 `prevState` 的分支，改状态机时别把它当成活代码删掉。

`state`、`prevState` 以及 `useTimer` 的状态都是**模块级单例 ref**，同一窗口内所有组件共享；两个窗口各有一份独立实例。

### 持久化（`src/composables/persistence.ts`）

所有数据存放在 `$APPDATA/focus-island/`，统一通过 `createPersistedStore` 读写：
- 300ms 防抖，单文件串行写入，先写 `<file>.<窗口label>.tmp` 再 `rename`，保证原子性
- 读取或解析失败时先备份为 `<file>.corrupt-<时间戳>`；备份失败则本次会话禁止写入，避免覆盖原文件
- `restore()` 负责校验和迁移数据，数据不合法时应抛错；归一化后与文件内容不同会回写一次
- 传入 `syncEvent` 时，改动通过 `emitTo` 同步到另一个窗口；以"上次快照 JSON"判断是否需要写入，避免回写循环

| 文件 | composable | 跨窗口事件 |
|------|-----------|-----------|
| `settings.json` | `useSettings` | `settings-changed` |
| `events.json` | `useEvents` | —（只有 panel 窗口用） |
| `memos.json` / `memo-categories.json` | `useMemos` | `memos-updated` / `memo-categories-updated` |
| `daily-stats.json` | `useDailyStats` | — |
| `achievements.json` | `useAchievements` | — |
| `ai-insights.json` | `useAiButler` | —（只在 panel 窗口写入） |

新增持久化数据时请复用 `createPersistedStore`，不要直接调用 `writeTextFile`。

### Composables 职责

- **`useIslandState.ts`**：灵动岛状态 + 闲置检测（`@vueuse/core useIdle`）
- **`useTimer.ts`**：计时器纯逻辑，与 UI 解耦，以 `phaseEndAtMs` 计算剩余时间。`onPhaseDoneCallback` 注册阶段结束回调；提供 `skipToBreak()`、`skipBreak()`、`abandon()` 和通知相关的 `confirm/extend/dismissNotification()`
- **`useTimerBridge.ts`**：panel 窗口专用，包装 useTimer，负责广播状态、记录番茄（累加到对应备忘、每日统计、成就）以及处理通知操作
- **`useEvents.ts`**：日程事件 CRUD。每条只有发生时间（`YYYY-MM-DD` 或 `YYYY-MM-DDTHH:mm`）、标题、描述、单个标签、是否已处理，按时间升序排列，过期的单独归档。`parseQuickEvent()` 负责把「周五 10:00 交报告 #工作」这类一句话解析成事件。
- **`useMemos.ts`**：备忘与分类，同时落 `memos.json` 和 `memo-categories.json`。每条备忘带 `pomodoroCount`，是当前唯一的专注对象
- **`useSettings.ts`**：主题、时长、透明度（`islandOpacity`）、缩放（`islandScale`）、显示模式（常驻/边缘停靠）、顶部位置（`islandXRatio`）、`idleMottos`、快捷键、开机自启、AI Key（硅基主力 / 智谱兜底）/模型/自动建议开关
- **`useDockMode.ts`**：边缘停靠模式，消费主窗口统一的指针轮询结果（`is_mouse_over_window`）决定展开或收起细条
- **`useDailyStats.ts` / `useAchievements.ts`**：每日统计与成就，日期一律用 `src/utils/date.ts` 的本地日期
- **`useShortcut.ts`**：全局快捷键，只在 `Pressed` 时切换面板
- **`useAi.ts` / `useAiButler.ts`**：见下方「AI 模块」

### Panel 页面路由

`PanelApp.vue` 通过 `currentView` ref 切换 5 个视图：`tasks`（HomePage，首页）、`events`（EventsPage，日程）、`memos`（MemoPage）、`stats`（StatsPage）、`settings`（SettingsPage）。底部导航 `navItems` 的顺序与图标也定义在这里。AI 不单独占页面：首页顶部有「小管家说」卡片，备忘与日程各自内嵌整理入口。

### 专注对象

番茄钟现在只挂一条**备忘**：`useTimer()` 的 `activeTaskId` 字段名沿用旧的，实际存的是 `memo.id`，一轮专注结束时 `useTimerBridge` 调 `useMemos().incrementPomodoro()`。日程事件不承担专注，也不统计番茄。

### 备忘录体系

`MemoPage.vue` 负责列表、搜索与分类筛选，`MemoEditor.vue` 是富文本编辑器（1465 行，全项目最大的单文件），`MemoCategoryDialog` / `MemoCategoryDropdown` / `MemoCategoryTag` 是分类相关 UI。

备忘正文是 HTML，渲染或插入 DOM 前**必须**过 `src/utils/sanitizeHtml.ts`（DOMPurify）。

### AI 模块

- **`useAi.ts`**：封装对话请求，所有 prompt 都集中在这里，业务侧只调语义化方法。硅基流动（默认 `Qwen/Qwen3-8B`）是主力，智谱 GLM 是兜底；按顺序逐家尝试，第一家成功即返回，全部失败才抛错。请求走 `@tauri-apps/plugin-http`（Rust 侧发请求），因此不受 CSP 与浏览器跨域限制，也不会产生浏览器网络请求。
  - 两家 Key 都没填时 `configured` 为 false，任何调用直接抛错；只填一家就只用那一家
  - 两家的思考开关参数不同：智谱用 `thinking: {type}`，硅基用 `enable_thinking` 布尔值
  - 每次请求有整体超时（短任务 20 秒，`generatePlan` 40 秒），超时、非 2xx 或空返回都会切下一家
  - 短任务把 `max_tokens` 压到 1024；只有 `generatePlan` 开启思考、给 2048
  - `parseTaskList` / `parseNameList` 先按 JSON 解析，失败后退化为按行拆分，容忍模型返回代码围栏
- **`useAiButler.ts`**：后台自动建议调度 + `ai-insights.json`。四道闸门按顺序拦：`aiAutoEnabled` → 7:00–23:00 → 距上次 ≥10 分钟 → 当日 <30 次。触发源是 upcoming 事件 / memos / 今日番茄的 `watch`，90 秒防抖；另有一个每小时一次的定时刷新，避免一整天重复同一句。失败也写 `lastAutoAt`，避免网络异常时反复重试。
  - 上下文包含最近 5 条小记（含番茄轮数）、未来日程与离最近一条还有多少分钟、当前时刻、一个番茄的分钟数，以及上一次的建议（要求模型换角度）
  - 结果只取最新一条 coach 建议，显示在首页「小管家说」卡片；旧的 insights 仍保留在 `ai-insights.json` 里，最多 50 条

### Rust 后端（src-tauri/src/lib.rs）

前端会调用的 Tauri commands：
- `is_mouse_over_window(pad)` — 鼠标是否在当前窗口内（macOS: CoreGraphics, Windows: Win32, Linux: X11）
- `set_click_through(ignore)` — 窗口鼠标穿透
- `set_island_size(scale)` / `set_island_custom_size(width, height)` — 调整灵动岛窗口尺寸并水平居中
- `toggle_panel` / `animate_panel_close` / `hide_panel` / `is_panel_visible` / `position_panel_under_island` / `get_panel_transition_metrics` / `emit_island_panel_motion` — panel 显示与动画。Rust 端只负责定位、显示，并发出 `panel-window-transition` 事件，动画由前端完成

拖动的水平位置完全在前端算：`Island.vue` 监听 `pointerdown/move`，把结果写进 `settings.islandXRatio`（0~1，`null` 表示居中），Rust 没有专门的拖动命令。

系统托盘菜单提供"打开专注清单"、"显示/隐藏灵动岛"、"退出"；托盘图标左键点击直接切换面板。

### 安全

- `tauri.conf.json` 配置了 CSP（`csp` / `devCsp`）：脚本只允许同源；`style-src` 关闭了 Tauri 的 nonce 注入，以便内联样式生效。新增外部资源（图片、音频、接口）时需要同步调整 CSP
- 写入 `innerHTML` 的富文本一律先经过 `src/utils/sanitizeHtml.ts`（DOMPurify）
- AI Key 只存在本机 `settings.json`，不上传；无 Key 时整个 AI 模块静默关闭

### 跨平台

- macOS: `core-graphics` crate（鼠标位置），`macos-private-api`（透明窗口）
- Windows: `windows` crate（Win32 GetCursorPos、WinInet 系统代理）
- Linux: `x11` crate（XQueryPointer），需要 X11 compositor 支持透明

### TailwindCSS v4 注意事项

- 全局入口：`src/styles.css` 使用 `@import 'tailwindcss'`（无 `tailwind.config.js`）
- Vue `<style scoped>` 中使用 `@apply` 时，**必须**在块首加 `@reference`，路径按文件位置算（`src/panel/*.vue` 用 `"../styles.css"`，`src/components/*.vue` 同，`src/panel/子目录` 用 `"../../styles.css"`）
- CSS 变量定义在 `styles.css` 的 `:root` 中（`--focus-color`、`--break-color`、`--idle-color`、`--alert-color`），运行时由 `useSettings.ts` 的 `applyThemeToDOM()` 动态设置

## 测试

- 栈：vitest + happy-dom + @vue/test-utils，配置在 `vite.config.ts` 的 `test` 段
- 测试文件放 `src/composables/__tests__/`，命令 `npm run test`
- `useTimer` / `useSettings` / `persistence` 都直接 import 了 Tauri 插件，测试里要先 `vi.mock` 掉 `@tauri-apps/plugin-fs`、`@tauri-apps/api/event`、`@tauri-apps/api/webviewWindow`、`@tauri-apps/plugin-http`
- `useTimer` 全部状态是**模块级单例**，同一个测试文件内多个用例会互相污染。需要独立状态时用 `vi.resetModules()` 配合动态 `import()`
- 时钟相关一律 `vi.useFakeTimers()` + `vi.advanceTimersByTime()`，不要真的等

## Windows 启动脚本

`start-app.vbs`（推荐，无控制台）与 `start-app.cmd`（有控制台，排查用）做同一件事：启动调试版 exe。启动步骤记到 `%TEMP%\focus-island-launch.log`。

- 脚本不再拉起 vite：成品 exe 用内置资源，改前端要重新构建；热更新请用 `npm run dev`
- `main.rs` 固定 `windows_subsystem = "windows"`，调试版也不会弹控制台；需要看 Rust 输出时临时去掉这一行
