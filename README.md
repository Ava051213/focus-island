# 专注岛 FocusIsland

<p align="center">
  <strong>屏幕顶部的灵动岛番茄钟</strong><br>
  <em>专注时在，注意力拉回，从不打扰</em>
</p>

<p align="center">
  <img src="https://img.shields.io/badge/platform-macOS%20%7C%20Windows%20%7C%20Linux-blue" alt="Platform" />
  <img src="https://img.shields.io/badge/license-Apache%202.0-blue" alt="License" />
  <img src="https://img.shields.io/badge/size-~5MB-purple" alt="Size" />
</p>

<p align="center">
  <img src="image/focus-island_v2-ezgif.com-optimize.gif" width="320" alt="专注岛演示" />
</p>

---

## ✨ 核心特性

### 🎯 灵动岛形态

一条贴在屏幕顶部的胶囊，实时显示专注进度。既能随时掌握状态，又不会遮挡工作内容。

灵动岛长驻,时刻提醒,将自己的专注力拉回到任务心流中


### 🚀 功能亮点

- 内置专注清单面板，优先级最高的任务进入核心专注区
- 每个任务自动记录已完成的番茄数
- 每日任务统计
- 备忘录 + todo清单
- 可选的 AI 助手：目标拆解成任务、今日专注建议、备忘录要点整理（智谱 GLM）

### 🎨 高度可定制

- **5 套精美主题** — 经典橙红、海洋蓝绿、薰衣草紫、森林深绿、赛博朋克
- **灵活时长设置** — 专注和休息时长自由调整
- **可调节大小** — 灵动岛尺寸支持 50%~150% 缩放
- **透明度调节** — 适配不同壁纸和视觉偏好
- 随机激励语 为你的专注加油

### ⚡ 轻量高效

基于 Tauri 构建，安装包仅约 5MB，内存占用极低，冷启动秒开。

### 🌍 跨平台支持

支持 macOS、Windows、Linux 三大平台。

---

## 📦 安装

本项目为个人精简版，暂未发布预编译安装包。如需使用，请按下方「本地开发」自行构建：

```bash
npm install
npm run build
```

构建产物位于 `src-tauri/target/release/bundle/`。

### macOS 常见问题

#### 打开提示 “xxx.app 已损坏，无法打开”

1. 确认已将应用拖入 `应用程序` 文件夹。
2. 打开「终端」，执行以下命令（请根据实际应用名替换路径中的 `灵动岛.app`）：

```bash
xattr -cr /Applications/专注岛.app
```

3. 再次从「应用程序」中打开应用；如仍有安全提示，可在「系统设置 → 隐私与安全性」中允许打开来自未认证开发者的 App。

---

## 🚀 使用指南

### 快速开始

1. 通过 **点击灵动岛**、**系统托盘图标** 或全局快捷键 **Ctrl+Alt+Space** 打开专注清单面板（鼠标离开时灵动岛恢复鼠标穿透，不遮挡下方操作；只有计时结束的通知横幅会保留点击）
2. 添加任务，点击任务开始专注（默认 25 分钟）
3. 计时结束后自动进入休息（默认 5 分钟）

### 灵动岛状态

| 状态 | 显示内容 |
|------|----------|
| 待机 | 轮播待办任务和激励语 |
| 专注 | 任务名 + 进度环 + 倒计时 |
| 休息 | 绿色主题 + 休息倒计时 |

### 拖动位置

按住灵动岛左右拖动可调整水平位置：只能沿屏幕顶部移动，松开后位置会自动保存；缩放、通知横幅出现时也会保持原位，不会跳回中间。

### 系统托盘

点击系统托盘图标可以：
- 打开专注清单
- 显示/隐藏灵动岛
- 退出应用

### AI 助手（可选）

在「设置 → AI 助手」填写智谱开放平台 API Key 后启用，默认模型 `glm-4.7-flash`（[模型说明](https://docs.bigmodel.cn/cn/guide/models/free/glm-4.7-flash)，免费）。Key 仅保存在本机的 `settings.json`。

- **目标拆解**：首页输入框右侧的星形按钮，把一句目标拆成 3~6 条任务，预览后可加入今天或收件箱
- **今日建议**：首页「任务清单」标题右侧的「AI 建议」，根据待办、优先级和今日番茄给出先做什么
- **备忘整理**：备忘编辑页工具栏的星形按钮，生成要点清单或摘要，可插入到光标处

### AI 管家

底部导航新增「管家」页，把你的任务、当天更新的备忘录和番茄进度一起交给模型：

- **今日管家**：任务/备忘有变化后 90 秒防抖生成，两次生成至少间隔 10 分钟、每天最多 30 次，仅在 7:00–23:30 工作；结果只在导航显示未读红点，不打断当前工作
- **计划评估**：粘贴一段计划并补充可投入时长/硬性截止，输出「风险评估 + 按天粗略安排」，同时自动带上你现有的任务
- **命名助手**：输入粗糙想法，生成 3 个规范任务标题，点击候选直接创建为今日任务
- **历史记录**：自动与手动生成的内容保留最近 50 条

自动建议可在「设置 → AI 助手 → 后台自动建议」关闭。应用需保持运行（窗口可隐藏到托盘），否则后台不会触发。

请求由本地 Tauri HTTP 插件发出（智谱接口不支持浏览器跨域），不使用 AI 功能时不产生任何网络请求。

> 关闭灵动岛或面板窗口只会隐藏到托盘，不会退出进程；彻底退出请用托盘菜单的「退出」。

---

## 🛠 本地开发

### Windows 一键启动

双击项目根目录的 `start-app.vbs`（推荐，无控制台窗口闪烁）：脚本会检查 vite 开发服务器是否在运行，未运行时在后台拉起（端口 1420），随后启动调试版应用。启动失败时会弹窗提示原因；每次启动的步骤记录在 `%TEMP%\focus-island-launch.log`。

`start-app.cmd` 是同一逻辑的可见控制台版本，用于排查问题。vite 会保持后台运行，方便后续前端改动热更新。

```bash
# 环境要求：Node.js 18+、Rust 1.80+

# 安装依赖
npm install

# 开发模式（热更新）
npm run dev

# 构建生产版本
npm run build
```

## 🔖 版本号同步（package.json -> Cargo.toml）

项目内置脚本 `scripts/sync-version.mjs`，会读取 `package.json` 中的 `version` 并同步到 `src-tauri/Cargo.toml`。

### 推荐发布流程

```bash
# 升级版本并自动同步 Cargo.toml
npm version patch   # 末位版本号 +1 
npm version minor   # 升级中间位 充值末位
npm version major  # 首位升级 重置后两位
npm version 1.8.3 --no-git-tag-version  # 指定版本 不提交到git上
```

---

## Friendship Link

Thanks for the support and feedback from the friends at [LINUX DO](https://linux.do/). 

## 📄 License

Apache License 2.0

本项目基于 [ipfred/focus-island](https://github.com/ipfred/focus-island) 二次开发，已移除原项目的电台音频、自动更新等模块，仅保留番茄计时、任务清单、备忘录与成就统计等核心功能。原始版权归原作者所有，二次开发部分同样以 Apache License 2.0 发布。

