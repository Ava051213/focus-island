# AGENTS.md

AI 编码工具（Codex、Claude Code、Trae、Cursor 等）在本仓库工作时的唯一说明文件。

> 本文件是仓库唯一的架构说明，改架构时只改这一份。迭代计划也放在这里，不另建路线图文档。

## 路线图：1.1.1 → 1.2.0

> 1.1.0 功能已齐，1.1.1 补完课程场景与检查更新。这段之后的主题是**加固与瘦身**：不再堆功能，把已有的做扎实、结构理干净，1.2.0 收口。
> 版本节奏：每批完成发一个 1.1.x patch；全部完成后 `npm version minor` 收 1.2.0。计划不提前钉版本号。

### 1.1.2 质量地基

先补测试，让后面几步改动都有兜底。

1. **useTronTodos 测试**（`src/composables/__tests__/useTronTodos.test.ts`）：3 秒节流窗口内重复刷新只发一次请求；失败保留上一次成功的列表并标 `stale`；勾选归档写进 `tron-todos-done.json`、`restoreTodoDone` 能撤回；`sortedTodos` 排除已归档、按 `due_ts` 升序、无截止排最后。
2. **sanitizeHtml 测试**（安全线）：锁住已知绕过样例——`script` / `iframe` / `svg onload` / `form` / 非 checkbox 的 `input` / `style` 一律清掉；正常富文本（`p` `ul` `li` `strong` `a[href]` `img[src]` `input[type=checkbox]`）保留。
3. **date.ts 测试**：`toLocalDateStr` 的跨零点、跨月、跨年边界；`eventRelativeLabel` 的今天/明天/本周/过期分支。用固定时间戳，不依赖系统时钟。
4. **CI 试跑 cargo check**：加 `rust-cache`，Windows runner 跑 `cargo check --locked`。能压进 5 分钟就并入 `ci.yml`，压不进就撤掉并在本文件记一句结论，维持只跑前端三项。

### 1.1.3 清理与发版流程

5. **.gitignore 补 `.kilo/`、`.zcode/`**，确认 `dist/`、`src-tauri/target/` 已在忽略列表。
6. **README 重写中文**：定位、截图、启动方式（`start-app.vbs` 不再拉 vite、改前端要重新构建）、托盘/快捷键/课程待办的真实行为、AI Key 与数据存在哪。
7. **修本文件滞后处**：MemoEditor.vue 现为 1465 行（本节旧稿写 1242）；useTronTodos 的 5 分钟自动刷新等描述与代码对齐。
8. **发版产物固定英文名**：`productName` 是「专注岛」，NSIS 产物为 `专注岛_x.y.z_x64-setup.exe`，`gh release upload` 会把中文整个吞掉（实测变成 `_x.y.z_x64-setup.exe`）。加 `scripts/bundle-release.mjs`：构建后复制成 `FocusIsland_<version>_x64-setup.exe` 再上传，省掉每次手动改名。
9. **tag 命名收口**：现存 `focus-island-v1.1.0` 与 `v1.0.x` / `v1.1.1` 两种风格，以后一律 `v*`；旧 tag 不改写历史，只在 README 注明。

### 1.1.4 结构：MemoEditor 拆分

10. **拆 MemoEditor.vue（1465 行）**，纯结构重构，不改行为。顺序：工具栏 → 右键菜单 → 分类下拉 → 图片与粘贴处理 → 保存/自动保存（可抽成 `useMemoEditor`）。每步单独跑 `vue-tsc` + 全量测试，目标主文件 < 600 行。
    验收：测试条数不变，粘贴富文本、快捷键、AI 润色行为一致。

### 1.2.0 收口

11. 五项全绿：`vue-tsc`、`npm run test`、`vite:build`、`cargo check`、`cargo test --lib`。
12. `npm version minor` → 1.2.0（Cargo.toml / Cargo.lock / latest.json 自动同步）。
13. tag `v1.2.0` → Release，说明写清这一轮是加固与瘦身，没有新功能。

### 待定：1.2.0 要不要带一个功能

三个候选都在现有架构内、不加依赖，拍板后插在 1.1.4 之后：

- **数据导出**：把 `$APPDATA/focus-island/` 下的 JSON 打成 zip 存到用户选定目录，换机不丢。只导出不导入也够用。
- **统计热力图**：`sessions.json` 已有逐日数据，画 8 周方格热力图，不需要新数据源。
- **快捷添加**：`useQuickAddFocus` 曾移除，可做成「唤起面板并聚焦输入框」，复用现有面板动画。

### 明确不做（守住精简方向）

- 不加账号/云同步，数据与 AI Key 全本地
- 不向畅课回写任何数据
- 不恢复本周目标进度展示、不恢复全屏自动避让
- 不引入 tauri-plugin-updater，不引入状态管理库

### 发布清单（每个 1.1.x）

1. `npx vue-tsc --noEmit` + `npm run test` + `npm run vite:build` 全绿；`cd src-tauri && cargo check` 通过
2. `npm version patch`（自动同步 Cargo.toml / Cargo.lock / latest.json 并 `git add`，提交并打 `v*` tag）
3. `npx tauri build --bundles nsis`（MSI 要现下 Wix3，代理常被挡，别用 `--bundles all`）
4. 产物改名 `FocusIsland_<version>_x64-setup.exe` 再 `gh release create v<version>`
5. 确认线上 `latest.json` 版本号；旧版客户端会在设置页 ⓘ 上看到红点

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

计时结束时 panel 设置 `pendingNotification` 并广播 `notification-show`，灵动岛显示通知横幅，用户操作通过 `notification-action`（confirm / extend / dismiss）回传 panel。灵动岛胶囊悬停时浮出的暂停/跳过按钮通过 `timer-command`（toggle / skip）回传 panel 执行，真正计时逻辑只在 panel。

两个窗口都**不会真正关闭**：Rust 侧拦截 `CloseRequested`，默认 `hide()` 到托盘；`settings.tray.closeToTray` 关掉后改为直接退出。退出也可以走托盘菜单。

### 系统集成（单实例 / 托盘 / 快捷键 / 通知）

- **单实例**：`tauri-plugin-single-instance` 是第一个注册的 plugin；第二次启动只恢复并聚焦已有 `main` 窗口，不创建新窗口、托盘或快捷键。
- **托盘**：菜单文案由 `src-tauri/src/tray.rs` 的纯函数根据前端推送的状态生成（`update_tray_state`）。菜单动作 `toggle_timer / skip_phase` 通过 `tray-command` 回前端执行；`open_panel / toggle_island / quit` 在 Rust 侧处理。左键单击托盘图标切换灵动岛显示/隐藏，右键出菜单。
- **全局快捷键**：在 Rust 侧注册（`update_shortcuts` 命令），窗口隐藏或重载不影响注册。配置来自 `settings.shortcuts`，触发后 emit `shortcut-command`（`toggle-timer` / `show-window`），前端复用 `useTimer` 动作。注册冲突或解析失败通过命令返回值回传，设置页展示，不崩溃。
- **系统通知**：`useSystemNotify.ts` 走官方 `tauri-plugin-notification`，只在现有 `pendingNotification`（专注/休息结束）时机发送，不新增计时触发点。`settings.notifications.enabled` 关闭时不申请权限、不发送；`permissionAsked` 记录拒绝，避免反复弹窗。首次隐藏到托盘也会通过 `island-hidden-to-tray` 给一次提示。
- **前端事件**：新增 `tray-command`、`shortcut-command`、`island-hidden-to-tray`。

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
- 默认 300ms 防抖（可用 `debounceMs` 覆盖，进行中快照传 0），单文件串行写入，先写 `<file>.<窗口label>.tmp` 再 `rename`，保证原子性
- 读取或解析失败时先备份为 `<file>.corrupt-<时间戳>`；备份失败则本次会话禁止写入，避免覆盖原文件
- `restore()` 负责校验和迁移数据，数据不合法时应抛错；归一化后与文件内容不同会回写一次
- 可选 `schemaVersion`：文件写成 `{ schemaVersion, data }`，旧裸数据按当前结构读取；未知高版本备份原文件、本次会话停止写入，并通过 `restoreWarning` 提示
- 可选 `migrations`：低版本信封按迁移链升级后回写。`settings.json` 当前为 `schemaVersion: 2`，`src/utils/settingsMigration.ts` 负责把旧 `shortcutKey` / `notificationSound` 映射成 `shortcuts` / `notifications` 并补 `tray`
- 传入 `syncEvent` 时，改动通过 `emitTo` 同步到另一个窗口；以"上次快照 JSON"判断是否需要写入，避免回写循环

| 文件 | composable | 跨窗口事件 |
|------|-----------|-----------|
| `settings.json` | `useSettings` | `settings-changed` |
| `events.json` | `useEvents` | —（只有 panel 窗口用） |
| `memos.json` / `memo-categories.json` | `useMemos` | `memos-updated` / `memo-categories-updated` |
| `daily-stats.json` | `useDailyStats` | — |
| `achievements.json` | `useAchievements` | — |
| `ai-insights.json` | `useAiButler` | —（只在 panel 窗口写入） |
| `daily-summaries.json` | `useDailySummaries` | —（团子每日总结，保留最近 30 天） |
| `sessions.json` | `useSessions` | —（焦点轮次账本，只在 panel 窗口写入） |
| `timer-snapshot.json` | `useTimerSnapshot` | —（进行中快照，0 防抖，只在 panel 窗口读写） |
| `tron-todos-done.json` | `useTronTodos` | —（课程待办本地勾选归档，只在 panel 窗口） |
| `tron-memo-links.json` | `useTronMemo` | —（待办转小记的映射，只在 panel 窗口） |

新增持久化数据时请复用 `createPersistedStore`，不要直接调用 `writeTextFile`。

### 计时内核（`src/timer/`）

计时不再用 setInterval 累加秒数，而是「状态机 + deadline + 系统时间」：

- `machine.ts`：纯状态机，状态 `idle / focus / focusPaused / break / breakPaused / completed`，事件 `START / PAUSE / RESUME / SKIP / COMPLETE / RESET / RESTORE`。非法转移返回 `{ ok: false, reason }`，不静默改状态。暂停记录 `pausedAt` 与累计暂停时长，恢复时按当前时间重算 deadline。
- `clock.ts`：剩余时间只认 `deadline - now`；系统时间回拨超过容差时按上次剩余时间重锚 deadline；实际专注时长不含暂停，且钳制到计划时长。
- `snapshot.ts`：生成/校验进行中快照，`planRecovery` 区分 active / expired，`applyRecovery` 决定恢复、记为完成或记为中断，全部是纯函数。
- `sessions.ts`：Session 类型（`completed / skipped / interrupted`）、按 id 去重、按结束日本地日期聚合、旧累加统计与 Session 合并。

`useTimer.ts` 内部由状态机驱动，但对外仍保留原来的 `phase / remaining / running / ...` 接口；`useTimerBridge.ts` 在完成/跳过/放弃时写且只写一条 Session，并维护 `timer-snapshot.json`。面板启动时若读到快照，`RecoveryPrompt.vue` 会询问继续或放弃；放弃一定落一条 interrupted Session。统计以 Session 为主，`daily-stats.json` 只作为升级前的历史基线。

### Composables 职责

- **`useIslandState.ts`**：灵动岛状态 + 闲置检测（`@vueuse/core useIdle`）
- **`useTimer.ts`**：计时器对外接口，内部由 `src/timer/machine.ts` 驱动，以 deadline 计算剩余时间。`onPhaseDoneCallback` 注册阶段结束回调，`onPhaseEventCallback` 接收完成/跳过效果；提供 `restore()`、`getSnapshot()`、`getRoundInfo()`、`skipToBreak()`、`skipBreak()`、`abandon()` 和通知相关的 `confirm/extend/dismissNotification()`
- **`useTimerBridge.ts`**：panel 窗口专用，包装 useTimer，负责广播状态、写入 Session（同时更新备忘番茄数、成就、AI 轮次记录）、维护进行中快照、处理通知操作与启动恢复
- **`useEvents.ts`**：日程事件 CRUD。每条只有发生时间（`YYYY-MM-DD` 或 `YYYY-MM-DDTHH:mm`）、标题、描述、单个标签、是否已处理，按时间升序排列，过期的单独归档。`parseQuickEvent()` 负责把「周五 10:00 交报告 #工作」这类一句话解析成事件。
- **`useMemos.ts`**：备忘与分类，同时落 `memos.json` 和 `memo-categories.json`。每条备忘带 `pomodoroCount`（已完成轮数）和 `estimatedPomodoros`（用户预计要用的番茄数，0 表示没估），是当前唯一的专注对象；`completedAt` 用于完成归档（不物理删除，可恢复），`order` 保存用户拖动后的手动顺序，首页取 `activeMemos` 前三条
- **`useSettings.ts`**：主题、时长、透明度（`islandOpacity`）、缩放（`islandScale`）、显示模式（常驻/边缘停靠）、顶部位置（`islandXRatio`）、`idleMottos`、`shortcuts`（toggleTimer / showWindow / enabled）、`tray.closeToTray`、`notifications`（enabled / sound / permissionAsked）、开机自启、AI Key（硅基主力 / 智谱兜底）/模型/自动建议开关。开机自启以本地设置为准：开关开着就在启动时重新登记系统启动项，不要用系统注册状态反向覆盖开关（否则启动项被清理时开关会被静默关掉）；`syncAutostart` 带 `isTauri()` 守卫，Web 预览与 Vitest 不调用系统接口。同步失败写入 `autostartError`，由设置页展示
- **`useDockMode.ts`**：边缘停靠模式，消费主窗口统一的指针轮询结果（`is_mouse_over_window`）决定展开或收起细条
- **`useIslandBridge.ts`**：main 窗口专用，监听 `timer-state-update` / `notification-show` 等事件，把 panel 推来的计时状态映射进灵动岛状态机
- **`useIslandInteraction.ts`**：main 窗口专用，统一轮询 `is_mouse_over_window` 驱动悬停、拖动与鼠标穿透开关（穿透状态下 webview 收不到 mousemove，只能轮询）；停靠模式复用同一次轮询结果
- **`useSessions.ts` / `useTimerSnapshot.ts`**：Session 账本与进行中快照的持久化封装，都只在 panel 窗口使用。备忘列表用 `aggregateSessionsByTask()` 按 `taskId` 聚合每条小记的累计番茄数与今日番茄数
- **`useDailyStats.ts` / `useAchievements.ts`**：每日统计与成就，日期一律用 `src/utils/date.ts` 的本地日期。`useDailyStats` 对外提供 `effectiveDailyStats`，由旧 `daily-stats.json` 累加值与 Session 聚合合并而成
- **`useWeeklyGoals.ts`**：本周目标（番茄 8 个、专注 3 天、完成 2 条小记）与奖励解锁，进度从 `effectiveDailyStats` 和 `memos.completedAt` 实时计算，周一自动换周，不新增持久化；页面不再展示进度，只保留团子表情和主题奖励的完成度判断
- **`useShortcut.ts`**：panel 窗口专用，调用 Rust `update_shortcuts` 注册快捷键，监听 `shortcut-command` 并复用计时动作；`shortcutError` 对外给设置页展示冲突原因
- **`useTraySync.ts`**：panel 窗口专用，把计时状态按分钟粒度推给 Rust（托盘菜单/tooltip），监听 `tray-command`，并把 `tray.closeToTray` 同步给 Rust
- **`useQuickAddFocus.ts`**：已移除。快捷键 `showWindow` 现在只负责打开清单，不再切换页面或聚焦输入框。
- **`useTimerCommands.ts`**：`toggle-timer` / `skip` 到 `useTimer` 动作的唯一映射，托盘与快捷键共用
- **`useSystemNotify.ts`**：系统通知权限、发送与首次隐藏到托盘提示；不承载计时逻辑
- **`useTronMemo.ts`**：课程待办 → 小记的自动转换与去重。`convert()` 幂等（先认 `tron-memo-links.json` 映射，再按 `课程名·标题` 兜底），只在首页点「开始」时调用一次；小记完成归档后算没转过
- **`useUpdateCheck.ts`**：应用内检查更新。`scheduleStartupCheck()` 在面板启动 10 秒后静默查一次 `latest.json`，关于弹窗在没查过时补一次；`isNewerVersion` 只比数字段（`1.2.10 > 1.2.9`）。设置页 ⓘ 按钮的红点由 `hasUpdate` 驱动，同一时刻只允许一个在途请求
- **`useAi.ts` / `useAiButler.ts`**：见下方「AI 模块」

### Panel 页面路由

`PanelApp.vue` 通过 `currentView` ref 切换 5 个视图：`tasks`（HomePage，首页）、`events`（EventsPage，日程）、`memos`（MemoPage）、`stats`（StatsPage）、`settings`（SettingsPage）。底部导航 `navItems` 的顺序与图标也定义在这里。AI 不单独占页面：首页顶部是「团子说」情绪卡片，下方「建议做的事」展示团子的 1-3 条安排；日程与备忘各自内嵌整理入口。首页不再展示本周目标、快速输入、上一轮记录和未来日程，这些都在对应页面。

### 专注对象

番茄钟现在只挂一条**备忘**：`useTimer()` 的 `activeTaskId` 字段名沿用旧的，实际存的是 `memo.id`。一轮专注结束时 `useTimerBridge` 先写一条 Session，再调 `useMemos().incrementPomodoro()`；Session 是统计与恢复的唯一来源。日程事件不承担专注，也不统计番茄。

`useTimerBridge` 额外提供 `lastMemo`（从最近一条带 `taskId` 的 Session 推导，任务已删除或已完成时为空）和 `repeatLastRound()`。所有开始入口统一走 `start(taskId, title)`：显式对象失效时回退为空，不传对象时默认带 `lastMemo`；再来一轮只复用 `start`，不额外写 Session。

### 备忘录体系

`MemoPage.vue` 负责列表、搜索与分类筛选，`MemoEditor.vue` 是富文本编辑器（1465 行，全项目最大的单文件），`MemoCategoryDialog` / `MemoCategoryDropdown` / `MemoCategoryTag` 是分类相关 UI。

备忘正文是 HTML，渲染或插入 DOM 前**必须**过 `src/utils/sanitizeHtml.ts`（DOMPurify）。

### 课程待办（畅课 Tron）

- `src/utils/tronApi.ts` 连接本机 `tronclass-picker` 服务（`http://127.0.0.1:8765`，`/api/todos`，8 秒超时）。换端口要**同时**改 `tronApi.ts` 的 `TRON_SERVICE_BASE` 和 `capabilities/default.json` 的 HTTP 白名单
- `useTronTodos.ts` 是模块级单例：3 秒请求节流（服务端有 3 秒缓存，不要比这更频繁）、5 分钟自动刷新；进前台即刷新（window focus / visibilitychange / `panel-window-transition` open——面板页面被 KeepAlive 缓存时窗口事件不一定触发）。失败时保留上一次成功的列表，交给界面标注「可能过期」
- 勾选归档只写本地 `tron-todos-done.json`，**绝不向畅课回写任何数据**。展示在日程页「课程待办」区块（`TronTodoCard.vue`）
- 首页建议点「开始」时 `useTronMemo.convert()` 静默建一条小记（`tron-memo-links.json` 记账），同一条作业只会有一条；日程页卡片只是待办列表，不做转换

### AI 模块

- **`useAi.ts`**：封装对话请求，所有 prompt 都集中在这里，业务侧只调语义化方法。硅基流动（默认 `Qwen/Qwen3-8B`）是主力，智谱 GLM 是兜底；按顺序逐家尝试，第一家成功即返回，全部失败才抛错。请求走 `@tauri-apps/plugin-http`（Rust 侧发请求），因此不受 CSP 与浏览器跨域限制，也不会产生浏览器网络请求。
  - 两家 Key 都没填时 `configured` 为 false，任何调用直接抛错；只填一家就只用那一家
  - 两家的思考开关参数不同：智谱用 `thinking: {type}`，硅基用 `enable_thinking` 布尔值
  - 每次请求有整体超时（短任务 20 秒，`generatePlan` 40 秒），超时、非 2xx 或空返回都会切下一家
  - 短任务把 `max_tokens` 压到 1024；只有 `generatePlan` 开启思考、给 2048
  - `parseTaskList` / `parseNameList` 先按 JSON 解析，失败后退化为按行拆分，容忍模型返回代码围栏
- **`useAiButler.ts`**：后台自动建议调度 + `ai-insights.json`。四道闸门按顺序拦：`aiAutoEnabled` → 7:00–23:00 → 距上次 ≥10 分钟 → 当日 <30 次。触发源是 upcoming 事件 / memos（含完成归档）/ 今日番茄的 `watch`，90 秒防抖；另有一个每小时一次的定时刷新，避免一整天重复同一句。失败也写 `lastAutoAt`，避免网络异常时反复重试。
  - 上下文包含当前时段、最近 5 条进行中小记（已完成番茄轮数、预计番茄数、放置天数、置顶）、未来日程及剩余分钟、今日番茄与专注分钟、今天完成的小记，以及最近 3 条旧建议
  - `coachToday` 返回结构化 JSON（开场关心 / 1-3 条带 `when` 时段的先后安排 / 生活提醒 / 收尾）。模型只给 `memo` 序号，`useAiButler` 在本地映射成真实小记 id。首页把 greeting 留在「团子说」卡片，plans 渲染到下方「建议做的事」，每条可直接开始专注
  - coach 上下文含临近截止的课程待办（48 小时内截止或已过期，`selectUrgentTodos` 按截止升序最多 3 条，来自 useTronTodos）；待办可直接成为建议条目（plan 的 `todo` 字段带课程名快照），首页点「开始」按 `课程·标题` 转成小记并进入专注，已转过则直接开始那条小记。Tron 服务不可用时上下文里就不带待办，不影响其余建议；panel 启动即开始 Tron 轮询（5 分钟一次、仅窗口可见时）
  - 每日总结：当天 20:00 后完成的轮次会生成一次当日总结；白天收工、晚上没再打开的情况，次日首次启动补生成昨天的。内容为当天番茄数、专注分钟、完成的小记和明天一句，无 Key 或请求失败时使用本地规则兜底。总结存在 `daily-summaries.json`，首页团子卡片在当晚或次日展示，当天又完成新轮次时退回普通团子
  - 卡片支持互动：用户可输入一句话（如「我有点累」）、选择「先啃难的 / 先做轻松的」、或逐条换掉。偏好、最近 3 条用户发言、当天换掉的标题都存在 `ai-insights.json`，并随下一次生成传给模型；换掉的条目当天不再出现，跨日清空
  - 结果只取最新一条 coach 建议：greeting 显示在首页「团子说」卡片，plans 显示在下方「建议做的事」；旧格式只存 `content` 时首页退回纯文本展示。旧的 insights 仍保留在 `ai-insights.json` 里，最多 50 条

### Rust 后端（src-tauri/src/lib.rs）

前端会调用的 Tauri commands：
- `is_mouse_over_window(pad)` — 鼠标是否在当前窗口内（macOS: CoreGraphics, Windows: Win32, Linux: X11）
- `set_click_through(ignore)` — 窗口鼠标穿透
- `set_island_size(scale)` / `set_island_custom_size(width, height)` — 调整灵动岛窗口尺寸并水平居中
- `toggle_panel` / `animate_panel_close` / `hide_panel` / `is_panel_visible` / `position_panel_under_island` / `get_panel_transition_metrics` / `emit_island_panel_motion` — panel 显示与动画。Rust 端只负责定位、显示，并发出 `panel-window-transition` 事件，动画由前端完成
- `set_close_to_tray(enabled)` — 同步关闭窗口行为（隐藏到托盘 / 直接退出）
- `set_autostart(enabled)` — 按本地开关同步系统启动项；Windows 下写用户启动文件夹里的隐藏脚本（注册表 Run 会被安全软件清理），失败原因回传设置页
- `update_tray_state(state)` — 前端推送计时状态，Rust 更新托盘菜单文案、跳过是否可用、tooltip 与 macOS 菜单栏标题
- `update_shortcuts(config)` — 重新注册全局快捷键，返回每个动作的注册错误

拖动的水平位置完全在前端算：`Island.vue` 监听 `pointerdown/move`，把结果写进 `settings.islandXRatio`（0~1，`null` 表示居中），Rust 没有专门的拖动命令。

系统托盘菜单提供"开始专注 / 暂停专注"（随状态变化）、"跳过当前阶段"、"打开专注清单"、"显示/隐藏灵动岛"、"退出"；左键单击托盘图标切换灵动岛，右键出菜单。`src-tauri/src/tray.rs` 的 `labels()` 是纯函数，改动文案时优先改这里并补单测。

### 安全

- `tauri.conf.json` 配置了 CSP（`csp` / `devCsp`）：脚本只允许同源；`style-src` 关闭了 Tauri 的 nonce 注入，以便内联样式生效。新增外部资源（图片、音频、接口）时需要同步调整 CSP
- 写入 `innerHTML` 的富文本一律先经过 `src/utils/sanitizeHtml.ts`（DOMPurify）
- AI Key 只存在本机 `settings.json`，不上传；无 Key 时整个 AI 模块静默关闭
- `capabilities/default.json` 只开实际用到的权限：文件读写、HTTP 白名单、剪贴板、`notification:default`、`autostart:default`。快捷键已改为 Rust 注册，不再需要 `global-shortcut:allow-register/unregister`

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
- 测试文件放 `src/composables/__tests__/` 与 `src/utils/__tests__/`，命令 `npm run test`
- `useTimer` / `useSettings` / `persistence` 都直接 import 了 Tauri 插件，测试里要先 `vi.mock` 掉 `@tauri-apps/plugin-fs`、`@tauri-apps/api/event`、`@tauri-apps/api/webviewWindow`、`@tauri-apps/plugin-http`、`@tauri-apps/plugin-autostart`、`@tauri-apps/plugin-notification`
- `useTimer` 全部状态是**模块级单例**，同一个测试文件内多个用例会互相污染。需要独立状态时用 `vi.resetModules()` 配合动态 `import()`
- 时钟相关一律 `vi.useFakeTimers()` + `vi.advanceTimersByTime()`，不要真的等
- Rust 纯逻辑（`tray.rs` 菜单文案、`shortcuts.rs` 配置校验）有 `#[cfg(test)]` 单测，命令 `cd src-tauri && cargo test --lib`

## Windows 启动脚本

`start-app.vbs`（推荐，无控制台）与 `start-app.cmd`（有控制台，排查用）做同一件事：启动调试版 exe。启动步骤记到 `%TEMP%\focus-island-launch.log`。

- 脚本不再拉起 vite：成品 exe 用内置资源，改前端要重新构建；热更新请用 `npm run dev`
- `main.rs` 固定 `windows_subsystem = "windows"`，调试版也不会弹控制台；需要看 Rust 输出时临时去掉这一行
