# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

> **重要：每次完成需求變更後，必須同步更新本檔案（CLAUDE.md）及 `CHANGELOG.md`，確保架構描述與實際程式碼一致。**

## 專案概述

尾牙抽獎系統 — 基於 Matter.js 物理引擎的互動式抽獎應用程式，模擬真實球體容器抽獎機制。有兩種版本：

1. **純前端靜態版**（根目錄）— 無框架、無建置工具、無套件管理器
2. **Google Apps Script 版**（`lottery-gas/`）— 整合 Google Sheets 後台 + 多螢幕同步

## 啟動方式

### 靜態版

```bash
# 任意靜態伺服器皆可
python3 -m http.server 8080
# 或
npx -y http-server ./ -p 8080
```

瀏覽器開啟 `http://localhost:8080/`。無 build、無 lint、無測試框架。

### Google Apps Script 版

1. 在 Google Drive 建立 Google Spreadsheet，新增三個 Sheet：「名單」、「設定」、「中獎紀錄」
2. 在 Apps Script 編輯器中建立專案，將 `lottery-gas/` 中的檔案對應建立
3. 部署為 Web App（執行身分：自己，存取權限：任何人）
4. Master 模式：`https://script.google.com/.../exec` 或 `...exec?mode=master`
5. Viewer 模式：`https://script.google.com/.../exec?mode=viewer`
6. Controller 遙控器模式：`https://script.google.com/.../exec?mode=controller`

## 檔案結構

```
lottery/
├── index.html          # 靜態版主頁面
├── physics.js          # 靜態版 Matter.js 物理引擎模組
├── renderer.js         # 靜態版 Canvas 2D 繪製模組
├── app.js              # 靜態版狀態機控制器
├── style.css           # 靜態版深色主題樣式
├── names.json          # 靜態版抽獎名單
├── background.png      # 背景圖（1344×768，WONDERCORE 尾牙主題）
├── CLAUDE.md           # Claude Code 專案指引（本檔案）
├── CHANGELOG.md        # 變更紀錄
├── README.md           # 使用說明
└── lottery-gas/        # Google Apps Script 版
    ├── Code.gs              # doGet() 入口、include() helper、API 函式
    ├── SheetService.gs      # Google Sheets CRUD（名單、設定、中獎紀錄）
    ├── SyncService.gs       # CacheService 同步機制（push/poll）
    ├── Index.html           # GAS 主頁面模板（組裝所有模組）
    ├── Style.html           # <style> 區塊（從 style.css 遷移 + Viewer 樣式）
    ├── Physics.html         # <script> 區塊（從 physics.js 遷移 + ejectSpecificBall）
    ├── Renderer.html        # <script> 區塊（從 renderer.js 遷移，零修改）
    ├── SyncClient.html      # <script> 區塊（同步抽象層：Master push / Viewer poll）
    ├── FirebaseConfig.html  # <script> 區塊（Firebase RTDB SDK 載入 + 初始化）
    ├── App.html             # <script> 區塊（Master/Viewer 雙模式控制器 + Firebase 監聽）
    ├── ControllerIndex.html # Controller 遙控器頁面模板
    ├── ControllerStyle.html # Controller 遙控器 CSS 樣式
    └── ControllerApp.html   # Controller 遙控器 JS 邏輯
```

## 架構

### 靜態版

三個 IIFE 模組透過全域變數互相溝通，載入順序為 `physics.js` → `renderer.js` → `app.js`（定義於 `index.html` 的 `<script>` 標籤，帶 `?v=N` cache-busting）。

| 模組 | 全域物件 | 職責 |
|------|---------|------|
| `physics.js` | `Physics` | Matter.js 物理模擬：圓形容器、出口管、channelStopper、球體生成、噴泉式雙渦流亂流（拆為子函式）、彈射出球、RWD 背景對齊。頂部定義所有命名常數，提供 `normalizeAngle()`/`angularDistance()`/`limitSpeed()` 工具函式 |
| `renderer.js` | `Renderer` | Canvas 2D 自訂繪製：分層渲染（出口管 → 容器填充 → 風場粒子 → 球體 → 容器邊框），風場粒子使用 Physics 導出常數（`VORTEX_OFFSET_RATIO` 等）避免跨檔案重複 |
| `app.js` | `App` | 狀態機控制器（IDLE → LOADING → READY ⇄ SPINNING → DRAWING → READY/COMPLETE），UI 綁定、名單面板管理、中獎標記。`applyUserSettings()` 統一讀取輸入值 |

### Google Apps Script 版

```
┌─────────────────┐      ┌──────────────────────────┐      ┌─────────────────┐
│  Google Sheets   │      │   Google Apps Script      │      │   瀏覽器前端     │
│  (後台/資料庫)    │◄────►│   (伺服器端)              │◄────►│  (Master/Viewer) │
│                  │      │                          │      │                  │
│  Sheet: 名單     │      │  Code.gs     - doGet     │      │  Physics.html    │
│  Sheet: 設定     │      │  SheetService.gs - CRUD  │      │  Renderer.html   │
│  Sheet: 中獎紀錄  │      │  SyncService.gs  - 同步  │      │  App.html        │
│                  │      │                          │      │  SyncClient.html │
└─────────────────┘      └──────────────────────────┘      └─────────────────┘
```

五個 IIFE 模組透過全域變數互相溝通，Master 頁面載入順序為 `Physics.html` → `Renderer.html` → `SyncClient.html` → `FirebaseConfig.html` → `App.html`（由 `Index.html` 的 `include()` 組裝）。

| 模組 | 全域物件 | 職責 |
|------|---------|------|
| `Physics.html` | `Physics` | 同靜態版，新增 `ejectSpecificBall(name, cb)` 供 Viewer 按名稱出球 |
| `Renderer.html` | `Renderer` | 同靜態版，零修改 |
| `SyncClient.html` | `Sync` | Master `push()` / Viewer `startPolling()` + 狀態感知 polling 間隔 |
| `FirebaseConfig.html` | `FirebaseDB` | Firebase RTDB 初始化，導出 `commandRef` / `statusRef` |
| `App.html` | `App` | Master/Viewer 雙模式控制器，Sheets 讀寫、同步指令處理、出球隊列、Firebase 遙控器監聽 |

Controller 頁面載入順序為 `FirebaseConfig.html` → `ControllerApp.html`（由 `ControllerIndex.html` 組裝，不含 Physics/Renderer/Canvas）。

| 模組 | 全域物件 | 職責 |
|------|---------|------|
| `FirebaseConfig.html` | `FirebaseDB` | 同上 |
| `ControllerApp.html` | `ControllerApp` | 監聽 Firebase status 更新 UI，按鈕點擊寫入 Firebase command |

#### 伺服器端模組

| 模組 | 職責 |
|------|------|
| `Code.gs` | doGet() 入口（master/viewer/controller 三模式路由）+ include() helper + 暴露 `api_*()` 給前端 `google.script.run` |
| `SheetService.gs` | Google Sheets CRUD：getNames / getAllNamesWithStatus / getSettings / recordWinner / resetWinners |
| `SyncService.gs` | CacheService 同步：pushCommand / getSyncState / clearSync + LockService 防衝突 |

### 頁面佈局（三欄）

```
┌──────────────┬─────────────────────────────┬──────────────┐
│  #names-panel │       #main-area            │ #winner-panel│
│  抽獎名單     │  ┌─────────────────────┐    │  中籤名單     │
│  (340px)      │  │     #canvas         │    │  (240px)     │
│  兩欄式名單   │  │   (物理 + 繪製)      │    │  <ol>中獎者   │
│  中獎→emoji亮  │  └─────────────────────┘    │              │
│               │  ┌─────────────────────┐    │              │
│               │  │  #controls (Master) │    │              │
│               │  │  #viewer-status(V)  │    │              │
│               │  └─────────────────────┘    │              │
└──────────────┴─────────────────────────────┴──────────────┘
```

### 狀態機

```
IDLE → LOADING → READY ⇄ SPINNING → DRAWING → READY (有剩餘球，亂流自動停止)
                                              → COMPLETE (無剩餘球)
```

| 狀態 | 說明 | 可用按鈕（Master） |
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
- **選取（Master）**：選離出口最近的球（非隨機），視覺更自然
- **選取（Viewer）**：`ejectSpecificBall(name)` 按名稱找球彈出（確保與 Master 結果一致）
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
- `Physics` 的 `layout()` 複製 CSS cover 數學公式，計算 WONDERCORE 文字在螢幕上的實際位置
- 容器中心錨點在背景圖中的比例位置：`ANCHOR_X=0.642, ANCHOR_Y=0.548`
- 容器半徑為背景顯示高度的 `0.270` 倍
- Canvas 偏移修正：`canvasOffX = vpW - canvasW - 240`（左側面板 340px、右側面板 240px，canvas 起始 = 左側面板寬度）
- 有 clamp 防止容器超出 canvas 邊界

#### 轉動/停止按鈕
- 「轉動」按鈕是開關式 toggle：READY → 點擊 → SPINNING（綠色→紅色「停止」）
- SPINNING → 點擊 → READY（停止亂流）
- 按鈕樣式透過 `.spinning` CSS class 切換

#### 左側名單面板（340px）
- 從 Google Sheets「名單」Sheet 載入（GAS 版）或 `names.json`（靜態版）
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

### 多螢幕同步設計（GAS 版）

#### 同步策略
- Master 每次狀態變更 → `Sync.push(command)` → `SyncService.pushCommand()` 寫入 CacheService
- Viewer 每 500-1500ms polling `SyncService.getSyncState()` → 執行對應指令
- 各端物理引擎獨立運行，**只同步離散狀態轉換和中獎結果**，不同步球體位置

#### 同步指令類型
| action | payload | 狀態轉換 |
|--------|---------|---------|
| `INIT` | names[], settings | IDLE → LOADING |
| `SEALED` | - | LOADING → READY |
| `START_TURBULENCE` | - | READY → SPINNING |
| `STOP_TURBULENCE` | - | SPINNING → READY |
| `DRAW_START` | - | SPINNING → DRAWING |
| `EJECT` | name | 維持 DRAWING |
| `BATCH_DONE` | hasRemaining | DRAWING → READY/COMPLETE |
| `RESET` | - | any → IDLE |

#### Viewer 出球隊列
- EJECT 指令可能比動畫完成更快到達
- Viewer 維護 `ejectQueue`，逐一處理，確保每顆球完成彈出動畫後才處理下一顆

#### 中途加入（Late-Join Recovery）
- Viewer 首次 polling 時收到完整狀態快照（snapshot）
- 快進建立：只建立剩餘球體（已中獎者跳過）
- 同步亂流狀態和中獎標記

#### Polling 間隔
| 狀態 | 間隔 |
|------|------|
| IDLE | 1500ms |
| LOADING | 1000ms |
| READY | 1500ms |
| SPINNING | 800ms |
| DRAWING | 500ms |
| COMPLETE | 2000ms |

### Firebase 遙控器設計（GAS 版）

#### 架構

```
┌──────────────────┐    Firebase RTDB     ┌──────────────────┐
│  Controller 頁面  │ ──── command ────►  │  Master 頁面      │
│  (?mode=controller)│                     │  (大螢幕球動畫)    │
│                   │ ◄──── status ─────  │                   │
│  三顆按鈕+籤表+數量 │                     │  監聽 command     │
│  監聽 status      │                     │  寫回 status      │
└──────────────────┘                      └──────────────────┘
```

#### Firebase RTDB 資料結構

```
lottery/
  command: {
    action: "LOAD" | "SPIN" | "DRAW" | "RESET",
    timestamp: 1707500000000
  }
  status: {
    state: "IDLE",
    winners: ["Tony", "Jason"],
    remaining: 50
  }
```

#### 通訊流程
1. **Controller → Master**：Controller 寫入 `lottery/command`，Master 用 `onValue` 監聽
2. **Master → Controller**：Master 每次 `setState()` 時寫入 `lottery/status`，Controller 用 `onValue` 監聽
3. Master 收到 command 後比對 `timestamp` 避免重複執行（`lastFirebaseTimestamp`）
4. Master 本機按鈕仍可操作（雙控模式）

#### Controller 頁面
- 獨立頁面（不含 Physics/Renderer/Canvas），適合手機/平板觸控
- 三顆大按鈕：入籤筒（紅）、轉動/停止（綠）、抽籤（金）+ 重置（灰，較小）
- **籤表與數量由 Master 端控制**，Controller 只發送動作指令（不帶參數）
- 按鈕啟用/禁用邏輯與 Master `updateUI()` 一致
- 底部顯示中獎名單（tag 樣式）
- 毛玻璃面板 + 觸控友善按鈕尺寸

#### FirebaseConfig.html
- 載入 Firebase SDK v10 compat（CDN：firebase-app-compat + firebase-database-compat）
- 使用者需填入自己的 Firebase config（apiKey, databaseURL 等）
- 導出 `FirebaseDB` 全域物件：`{ db, commandRef, statusRef }`

### Google Sheets 結構

#### Sheet「名單」
| A: 姓名 | B: 已中獎 |
|---------|----------|
| Jason   |          |
| Tony    | TRUE     |

#### Sheet「設定」
| A: 項目 | B: 值 | C: 說明 |
|---------|------|---------|
| ballSize | 26 | 球大小 (8-50) |
| fontSize | 40 | 字大小 (0=自動) |
| swirl | 75 | 氣流強度 (1-100) |
| interval | 2 | 出球間隔秒數 |
| count | 1 | 每次抽出數量 |
| backgroundUrl | (URL) | 背景圖 URL |

#### Sheet「中獎紀錄」
| A: 姓名 | B: 時間 | C: 輪次 |
|---------|--------|---------|
| Tony | 2026-02-09 19:30 | 1 |

### 資料流

#### 靜態版
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

#### GAS 版（Master）
```
Google Sheets → google.script.run → App.html (names[], settings)
                                      ├→ populateNamesList() → #names-list
                                      ├→ Physics.createBalls(names, radius)
                                      ├→ Sync.push(INIT) → CacheService
                                      ├→ Physics.ejectOneBall(callback)
                                      │    └→ callback(name)
                                      │         ├→ markWinner(name)
                                      │         ├→ google.script.run.api_recordWinner()
                                      │         └→ Sync.push(EJECT)
                                      └→ Renderer.drawFrame() (每幀)
```

#### GAS 版（Viewer）
```
Sync.startPolling() → getSyncState() → commands[]
                                          ├→ INIT → createBalls()
                                          ├→ SEALED → sealContainer()
                                          ├→ START/STOP_TURBULENCE
                                          ├→ EJECT → ejectQueue → ejectSpecificBall(name)
                                          └→ BATCH_DONE / RESET
```

#### GAS 版（Controller → Master）
```
Controller:
  按鈕點擊 → FirebaseDB.commandRef.set({ action, timestamp, params })

Master:
  FirebaseDB.commandRef.on('value') → 比對 timestamp
                                       ├→ LOAD  → handleLoad(params)
                                       ├→ SPIN  → handleSpin()
                                       ├→ DRAW  → handleDraw(params)
                                       └→ RESET → handleReset()

  setState() → FirebaseDB.statusRef.set({ state, winners, remaining, sheetNames })

Controller:
  FirebaseDB.statusRef.on('value') → updateUI(state) + renderWinners()
```

### 控制項預設值

| 控制項 | id | 預設值 | 範圍 |
|-------|----|-------|------|
| 數量 | input-count | 1 | 1 ~ names.length |
| 間隔 | input-interval | 2 秒 | 1-10 |
| 氣流 | input-swirl | 75 | 1-100 |
| 球大小 | input-ball-size | 26 | 8-50 |
| 字大小 | input-font-size | 40 | 0-40（0=自動）|

## 修改須知

### 靜態版
- 修改 `names.json`（JSON 字串陣列）即可自訂抽獎名單
- 外部依賴僅 Matter.js 0.20.0（CDN 載入），無 npm 依賴
- 所有 UI 文字為正體中文（台灣）
- 深色主題樣式定義於 `style.css`，顏色統一使用 `:root` CSS 變數
- 背景圖為 `background.png`（1344×768），body 使用 `background-size: cover`
- 修改 `physics.js` 後需更新 `index.html` 的 `?v=N` cache-busting 版號
- 左側面板 340px、右側面板 240px，若修改需同步更新 `physics.js` 的 `RIGHT_PANEL_WIDTH` 常數
- `physics.js` 所有物理參數集中在頂部常數區，調參只需改常數
- `renderer.js` 透過 `Physics.VORTEX_OFFSET_RATIO` 等導出常數取得渦流參數

### GAS 版
- 名單管理改為 Google Sheets「名單」Sheet，不再使用 `names.json`
- 設定改為 Google Sheets「設定」Sheet
- 背景圖 URL 在「設定」Sheet 的 `backgroundUrl` 欄位設定（可使用 Google Drive 公開連結）
- `Code.gs` 的 `api_*()` 函式是前端 `google.script.run` 的介面
- `SyncService.gs` 使用 CacheService（6 小時過期）+ LockService 防衝突
- GAS 無 ES modules，保留 IIFE 模式
- 前端透過 `Index.html` 的 `include()` 模板函式組裝所有模組
- **Firebase 遙控器**：使用前需在 `FirebaseConfig.html` 填入 Firebase 專案設定
- Controller 頁面（`?mode=controller`）為獨立模板，不含 Physics/Renderer/Canvas
- Master 啟動時自動監聽 Firebase command + 寫入初始 status

### GAS 限制與對策
| 限制 | 對策 |
|------|------|
| 無 WebSocket | Polling（500-1500ms） |
| CacheService 6 小時過期 | 尾牙活動通常 2-3 小時，足夠 |
| CacheService 100KB/key | 50 名 + 100 指令約 5-8KB |
| 無 ES modules | 保留 IIFE 模式 |
| 無靜態檔案託管 | 背景圖放 Google Drive |

## 維護規範

- **每次需求變更完成後**，必須更新：
  1. `CLAUDE.md` — 架構描述、狀態機、關鍵設計等段落
  2. `CHANGELOG.md` — 新增變更紀錄條目
- 靜態版：更新 `index.html` 中對應 JS 檔的 `?v=N` 版號
- GAS 版：在 Apps Script 編輯器中重新部署 Web App
