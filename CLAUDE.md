# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

> **重要：每次完成需求變更後，必須同步更新本檔案（CLAUDE.md）及 `CHANGELOG.md`，確保架構描述與實際程式碼一致。**

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

## 檔案結構

```
lottery/
├── index.html          # 主頁面，三欄佈局（名單面板 + Canvas + 中籤面板）
├── physics.js          # Matter.js 物理引擎模組
├── renderer.js         # Canvas 2D 自訂繪製模組
├── app.js              # 狀態機控制器 + UI 綁定
├── style.css           # 深色主題樣式（含三欄面板 + 按鈕樣式）
├── names.json          # 抽獎名單（JSON 字串陣列）
├── background.png      # 背景圖（1344×768，WONDERCORE 尾牙主題）
├── CLAUDE.md           # Claude Code 專案指引（本檔案）
├── CHANGELOG.md        # 變更紀錄
└── README.md           # 使用說明
```

## 架構

三個 IIFE 模組透過全域變數互相溝通，載入順序為 `physics.js` → `renderer.js` → `app.js`（定義於 `index.html` 的 `<script>` 標籤，帶 `?v=N` cache-busting）。

| 模組 | 全域物件 | 職責 |
|------|---------|------|
| `physics.js` | `Physics` | Matter.js 物理模擬：圓形容器（90段弧牆）、出口管、閘門、channelStopper、球體生成、噴泉式雙渦流亂流、彈射出球、RWD 背景對齊 |
| `renderer.js` | `Renderer` | Canvas 2D 自訂繪製：分層渲染（出口管 → 容器填充 → 風場粒子 → 球體 → 容器邊框），安全繪製包裝 |
| `app.js` | `App` | 狀態機控制器（IDLE → LOADING → READY → SPINNING → DRAWING → COMPLETE），UI 綁定、名單面板管理、中獎標記 |

### 頁面佈局（三欄）

```
┌──────────────┬─────────────────────────────┬──────────────┐
│  #names-panel │       #main-area            │ #winner-panel│
│  抽獎名單     │  ┌─────────────────────┐    │  中籤名單     │
│  (340px)      │  │     #canvas         │    │  (240px)     │
│  兩欄式名單   │  │   (物理 + 繪製)      │    │  <ol>中獎者   │
│  中獎→emoji亮  │  └─────────────────────┘    │              │
│               │  ┌─────────────────────┐    │              │
│               │  │     #controls       │    │              │
│               │  └─────────────────────┘    │              │
└──────────────┴─────────────────────────────┴──────────────┘
```

### 狀態機

```
IDLE → LOADING → READY ⇄ SPINNING → DRAWING → READY (有剩餘球，亂流自動停止)
                                              → COMPLETE (無剩餘球)
```

| 狀態 | 說明 | 可用按鈕 |
|------|------|---------|
| IDLE | 初始，可調整球大小 | 入籤筒 |
| LOADING | 球正在掉落 | （無） |
| READY | 球已穩定，容器封閉 | 轉動、重置 |
| SPINNING | 亂流啟動中，球轉動 | 停止（轉動切換）、抽籤、重置 |
| DRAWING | 出球中 | （無） |
| COMPLETE | 所有球抽完 | 重置 |

### 關鍵設計

#### 碰撞分類
- `CAT_BALL (0x0001)` — 普通球體
- `CAT_WALL (0x0002)` — 牆壁、閘門
- `CAT_EXITING (0x0004)` — 出球中的球體

出球時球體從 `CAT_BALL` 切換至 `CAT_EXITING`，使其穿過其他球體，只與出口管壁碰撞。

#### 出球機制
- **選取**：選離出口最近的球（非隨機），視覺更自然
- **階段**：`rising` → `entering` → `upChannel` → `hasExited`，每階段施加不同引導力
- **碰撞切換**：球被選中時立即切換為 `CAT_EXITING`，穿過球堆上升
- **亂流隔離**：出球中的球完全不受亂流影響
- **channelStopper**：出口管入口處的擋板（`mask: CAT_BALL`），防止普通球在亂流中飄入出口管

#### 出口間隙
- 間隙寬度公式：`exitGapHalfAngle = Math.asin((channelWidth / 2 + 24) / containerRadius)`
- `+24` 考慮牆壁段厚度 20px + 旋轉後的額外佔用，確保球不被夾住

#### 亂流系統（噴泉式雙渦流）
- 關閉重力，從底部往上吹
- **底部噴泉力**：只作用在容器中心線以下的球，力量隨深度線性增強（越底越強，中心線為 0），基礎強度 `0.0035 * swirlMultiplier`
- 頂部分流：左側逆時針、右側順時針（以容器中心為分割線）
- 雙渦流中心在 `±containerRadius * 0.35` 處，中線有平滑混合避免突變
- 搭配噪音擾動 + 隨機爆發力 + 居中力 + 速度限制器
- 強度由「氣流」控制（1-100，對應 `swirlMultiplier = val / 10`）

#### 風場粒子視覺化
- 亂流啟動時顯示 200 個粒子，跟隨雙渦流場
- 帶漸層尾跡的短線段，呈現氣流方向
- 亂流停止後自動清除

#### RWD 背景對齊
- 背景圖（1344×768）以 `background-size: cover` + `center center` 顯示
- `physics.js` 的 `layout()` 複製 CSS cover 數學公式，計算 WONDERCORE 文字在螢幕上的實際位置
- 容器中心錨點在背景圖中的比例位置：`ANCHOR_X=0.642, ANCHOR_Y=0.548`
- 容器半徑為背景顯示高度的 `0.270` 倍
- Canvas 偏移修正：`canvasOffX = vpW - canvasW - 240`（左側面板 340px、右側面板 240px，canvas 起始 = 左側面板寬度）
- 有 clamp 防止容器超出 canvas 邊界

#### 轉動/停止按鈕
- 「轉動」按鈕是開關式 toggle：READY → 點擊 → SPINNING（綠色→紅色「停止」）
- SPINNING → 點擊 → READY（停止亂流）
- 按鈕樣式透過 `.spinning` CSS class 切換

#### 左側名單面板（340px）
- 載入 `names.json` 後自動填入所有名字
- **兩欄佈局**：CSS `columns: 2`，搭配 `break-inside: avoid` 防止名字被截斷
- 每個 `<li>` 含隱藏的 `.badge` span（emoji）
- 中籤時加 `.won` class → emoji 淡入 + 文字變金色 + 自動捲動
- 重置時清除所有 `.won` 標記

#### 首次出球延遲
- 按下「抽籤」後，第一顆球延遲 3 秒才開始彈出（`setTimeout(ejectCycle, 3000)`）
- 後續出球按「間隔」秒數正常執行
- 目的：防止抽獎者透過讀秒按下按鈕來指定中獎者

#### 球大小預設按鈕
- 「小」= 26（適合總名單人多時使用）
- 「大」= 40（適合剩餘名單人少時使用）
- `.preset-btn` 按鈕直接設定 `input-ball-size` 的值

### 資料流

```
names.json → fetch → app.js (names[])
                        ├→ populateNamesList() → #names-list
                        ├→ Physics.createBalls(names, radius)
                        ├→ Physics.startTurbulence() / stopTurbulence()
                        ├→ Physics.ejectOneBall(callback)
                        │    └→ callback(name)
                        │         ├→ markWinner(name) → #names-list .won
                        │         └→ append to #winner-list
                        └→ Renderer.drawFrame() (每幀)
```

### 控制項預設值

| 控制項 | id | 預設值 | 範圍 |
|-------|----|-------|------|
| 數量 | input-count | 1 | 1 ~ names.length |
| 間隔 | input-interval | 2 秒 | 1-10 |
| 氣流 | input-swirl | 66 | 1-100 |
| 球大小 | input-ball-size | 40 | 8-50 |
| 字大小 | input-font-size | 40 | 0-40（0=自動）|

## 修改須知

- 修改 `names.json`（JSON 字串陣列）即可自訂抽獎名單
- 外部依賴僅 Matter.js 0.20.0（CDN 載入），無 npm 依賴
- 所有 UI 文字為正體中文（台灣）
- 深色主題樣式定義於 `style.css`
- 背景圖為 `background.png`（1344×768），body 使用 `background-size: cover`
- 修改 `physics.js` 後需更新 `index.html` 的 `?v=N` cache-busting 版號
- 左側面板 340px、右側面板 240px，若修改需同步更新 `physics.js` 中的 `canvasOffX` 計算（`vpW - canvasW - 右側面板寬度`）

## 維護規範

- **每次需求變更完成後**，必須更新：
  1. `CLAUDE.md` — 架構描述、狀態機、關鍵設計等段落
  2. `CHANGELOG.md` — 新增變更紀錄條目
- 更新 `index.html` 中對應 JS 檔的 `?v=N` 版號
