# GameBoxPC（Windows 多账号网页游戏盒子）

基于 Electron（内置 64 位完整 Chromium）的 Windows 多账号网页游戏管理端，专为支付宝游戏中心网页版（`wanyiwan.top`）等多账号挂机场景设计。

## 核心特性

- **64 位原生 Chromium**：原生支持 `COOP/COEP`、`SharedArrayBuffer`、`OPFS + createWritable`、大内存 Unity WebGL/Wasm，彻底告别手机 WebView 兼容与内存问题。
- **多账号彻底隔离**：每个账号独立 `persist:acc_<id>` 分区与渲染进程，Cookie / LocalStorage / IndexedDB / OPFS 互不干扰，支持同时在线最多 10 个账号（可在设置中调高）。
- **单窗口秒切 + 多宫格同屏**：支持 `1屏 / 2分屏 / 4宫格 / 6宫格 / 9宫格` 一键切换，双击左侧账号快速放大单看，拖拽左侧账号调整顺序。
- **三层后台保活 + 智能降帧**：
  - Chromium 启动参数禁用后台定时器与遮挡窗口休眠；
  - `gamePreload.js` 在主页面与 `#game-iframe` 内伪装 `document.hidden = false` / `visibilityState = 'visible'`，拦截 `visibilitychange` / `freeze` / `window.blur`；
  - 后台未显示的账号自动降帧到 **10 FPS**（可在设置切换：不限帧 / 15 / 10 / 5 FPS），切回前台瞬间恢复 60 FPS。
- **智能音频控制**：默认仅当前焦点账号发声，后台账号自动静音；支持单号静音与顶栏全局一键静音。
- **系统托盘 + 老板键**：点击关闭按钮默认最小化到系统托盘不断线；默认 `Alt+Q` 全局一键隐藏并静音，再按瞬间恢复。
- **绿色便携数据目录**：所有账号配置和登录态保存在程序同级的 `data/` 目录，换电脑直接打包拷走免重登。

## 使用方法（Windows 免安装绿色版）

1. 解压 `dist/GameBoxPC-1.0.0-win.zip`（或直接拷贝 `dist/win-unpacked` 文件夹）到任意位置；
2. 双击 **`GameBoxPC.exe`** 启动；
3. 所有数据自动保存在同级 `data/` 目录中。

## 开发与打包命令

```bash
cd /root/project/GameBoxPC
npm install
npm run dist:win   # 打包 Windows 64 位绿色版（dist/win-unpacked 与 dist/GameBoxPC-1.0.0-win.zip）
```
