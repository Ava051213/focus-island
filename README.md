# 专注岛 FocusIsland

屏幕顶部的灵动岛番茄钟。专注时在，需要时隐，从不打扰。

## 功能

- 顶部胶囊实时显示专注进度，鼠标移开即穿透，不挡下方操作
- 备忘即专注对象，每轮番茄自动累计次数
- 日程、每日统计与成就
- 可选 AI：小管家建议、日程解析、备忘整理，Key 只存本机

## 安装

Windows 安装包见 [Releases](https://github.com/Ava051213/focus-island/releases/latest)，下载后双击安装。macOS 与 Linux 需自行构建：

```bash
npm install
npm run build
```

## 使用

1. 点击灵动岛或托盘图标打开面板
2. 选一条备忘开始专注，默认 25 分钟，结束后休息 5 分钟
3. 按住灵动岛左右拖动调整位置，松开自动保存

关闭窗口只隐藏到托盘，彻底退出请用托盘菜单的退出。

## 开发

```bash
npm run dev    # 热更新
npm run test   # 单元测试
npm run build  # 构建 release 安装包
```

发版时同步修改 latest.json 的 version，应用内的检查更新读取它。

## 许可

Apache License 2.0。本项目基于 [ipfred/focus-island](https://github.com/ipfred/focus-island) 二次开发；原始版权归原作者所有，二次开发部分同样以 Apache License 2.0 发布。
