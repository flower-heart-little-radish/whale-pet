# 🐋 工作鲸娘 · Tauri 版

Rust + Tauri 2 重写版，前端（HTML/CSS/JS）与原 Electron 版一致，主进程用 Rust 重写。

## 启动

双击 **启动桌宠.cmd**（或直接双击 `whale-pet.exe`）。

## 拖拽为什么终于顺了

原 Electron 版靠 JS 每帧 `setPosition` 搬窗口，受限于 Windows 分层窗口的提交开销，高速拖动必然掉帧/漂移。
本版把拖拽交给 Rust：`GetCursorPos` → `SetWindowPos`，4ms 一拍，**不经过 JS、不经过 IPC**——
和 Qt 版 `self.move()` 是同一层的东西。

## 功能

- 透明置顶、无边框、不占任务栏、点击穿透（按 alpha 掩膜判定）
- 单击开气泡：峰谷带 / 余额 / 今日 / 近 7 日 / 7 日柱图 / 刷新
- 滚轮缩放（0.6–1.8，Flash 与 Pro 各自记忆）
- 双击切换 Flash ⇄ Pro，空闲自动切换（默认 90 秒）
- 托盘 / 右键：动作（16 项）、形象、切换间隔、大小、置顶、贴边、开机自启、刷新、快捷方式、说明、**隐藏桌宠**、退出
- 隐藏后从托盘图标点「显示/隐藏桌宠」即可回来
- 右键菜单是**独立弹出窗口**：不受桌宠窗口限制，靠近屏幕边缘会自动翻转/避让，内容过长时可滚动
- 积分自动刷新：客户端开着 120 秒，没开降到 10 分钟

## 目录

- `whale-pet.exe` —— 主程序（约 11 MB）
- `engine/credit_probe.py` —— 取数脚本，**需自己提供**（仓库里只带模板，见 `engine/README.md`）
- `config.json` —— 首次运行的初始配置（之后写到 `%APPDATA%\com.whalepet.desktop\config.json`）

## 从源码构建

```bash
cd src-tauri
cargo build --release   # 需要 Rust + MSVC Build Tools
```

产物在 `src-tauri/target/release/whale-pet.exe`。
