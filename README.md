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

On Windows, `start-app.vbs` launches the built executable without a console window. Frontend changes need a rebuild for the packaged app; use `npm run dev` for hot reload.

## Desktop behavior

- Single instance: launching it again focuses the existing window instead of starting a second process.
- Tray icon: left click toggles the window, right click opens the menu.
- Closing a window hides it to the tray by default. Turn that off under Settings to quit directly.
- Global shortcuts can be changed or disabled in the settings window.
- System notifications are opt-in and can be turned off.

## License

Apache License 2.0

Based on [ipfred/focus-island](https://github.com/ipfred/focus-island). Original copyright belongs to the original author; this fork is distributed under the same license.
