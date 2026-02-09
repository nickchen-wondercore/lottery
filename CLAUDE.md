# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## 專案概述

尾牙抽獎系統 — 基於 Matter.js 物理引擎的互動式抽獎應用程式，模擬真實球體容器抽獎機制。純前端靜態專案，無框架、無建置工具、無套件管理器。

## 啟動方式

```bash
# 任意靜態伺服器皆可
python3 -m http.server 8080
# 或
npx -y http-server ./ -p 8080
```

瀏覽器開啟 `http://localhost:8080/`。無 build、無 lint、無測試框架。

## 架構

三個 IIFE 模組透過全域變數互相溝通，載入順序為 `physics.js` → `renderer.js` → `app.js`（定義於 `index.html` 的 `<script>` 標籤，帶 `?v=N` cache-busting）。

| 模組 | 職責 |
|------|------|
| `physics.js` → `Physics` | Matter.js 物理模擬：圓形容器（90段弧牆）、出口管、閘門、球體生成、亂流系統、彈射出球 |
| `renderer.js` → `Renderer` | Canvas 2D 自訂繪製：分層渲染（出口管 → 容器填充 → 風場粒子 → 球體 → 容器邊框），安全繪製包裝 |
| `app.js` → `App` | 狀態機控制器（IDLE → LOADING → READY → DRAWING → COMPLETE），UI 綁定與事件處理 |

### 關鍵設計

- **碰撞分類**：`CAT_BALL (0x0001)` / `CAT_WALL (0x0002)` / `CAT_EXITING (0x0004)`，出球時切換碰撞遮罩使球體只與出口管壁碰撞
- **球體出球階段**：`rising` → `entering` → `upChannel` → `hasExited`，每階段施加不同力引導球體通過出口管
- **亂流系統（噴泉式雙渦流）**：關閉重力，從底部往上吹，到頂部分流為左側逆時針、右側順時針雙渦流。搭配噪音擾動 + 隨機爆發力 + 居中力 + 速度限制器，強度由「氣流」控制（1-100）
- **風場粒子視覺化**：亂流啟動時顯示 200 個帶漸層尾跡的粒子，呈現氣流方向，亂流停止後自動清除
- **出球選取**：選離出口最近的球（而非隨機），視覺上更自然
- **球大小 / 字大小可調**：球大小影響物理半徑與出口管寬度（動態計算），字大小可獨立設定（0 = 依球大小自動縮放）
- **繪製分離**：`Renderer` 不操作 DOM，僅透過 Canvas API 繪製；`Physics` 不知道 UI，透過 callback 回傳結果

### 資料流

`app.js` 呼叫 `Physics` API（`createBalls`、`startTurbulence`、`ejectOneBall` 等），每幀呼叫 `Renderer.drawFrame()` 繪製畫面。`names.json` 為純 JSON 陣列，fetch 載入後用於球體生成。

## 修改須知

- 修改 `names.json`（JSON 字串陣列）即可自訂抽獎名單
- 外部依賴僅 Matter.js 0.20.0（CDN 載入），無 npm 依賴
- 所有 UI 文字為正體中文（台灣）
- 深色主題樣式定義於 `style.css`
