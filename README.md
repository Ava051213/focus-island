# FocusIsland

A small personal desktop utility built with Tauri and Vue 3.

This repository is a trimmed fork of [ipfred/focus-island](https://github.com/ipfred/focus-island), modified for my own workflow. Upstream features unrelated to my needs have been removed.

## Requirements

Node.js 18+ and Rust 1.80+.

## Development

```bash
npm install
npm run dev
```

Build a production bundle:

```bash
npm run build
```

On Windows, `start-app.vbs` starts the local development server and the app without opening a console window.

## Desktop behavior

- The app is single-instance: launching it again focuses the existing window instead of creating a second process or tray icon.
- Tray icon: left click toggles the island; right click opens the menu (start/pause, skip phase, open panel, show/hide island, quit).
- Closing a window hides it to the tray by default. Turn off "关闭窗口时隐藏到托盘" in settings to quit directly instead.
- Global shortcuts: `Ctrl+Alt+Space` on Windows/Linux and `Cmd+Option+Space` on macOS toggle the timer. They can be changed or disabled under Settings → 系统设置.
- Focus/break completion sends a system notification; notification and sound switches live in the same settings section.

## License

Apache License 2.0

Based on [ipfred/focus-island](https://github.com/ipfred/focus-island). Original copyright belongs to the original author; this fork is distributed under the same license.
