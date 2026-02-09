# CHANGELOG

所有重要變更紀錄。格式基於 [Keep a Changelog](https://keepachangelog.com/)。

---

## 2026-02-09

### Refactored
- **physics.js 重構**（876 行 → 643 行）：
  - 刪除 4 個死函式：`buildRamps()`、`openGates()`、`startDrawing()`、`ejectNext()` 及所有 ramp 相關變數
  - 新增工具函式：`normalizeAngle()`、`angularDistance()`、`limitSpeed()`，消除 4+ 處角度計算重複和 2 處速度限制重複
  - 新增 `createWallSegment()` 共用弧牆段建構，消除 3 處重複
  - 將 `applyTurbulence()` 拆為 5 個子函式：`calcVortexForce()`、`calcNoiseForce()`、`calcBurstForce()`、`calcCenteringForce()`、`calcFountainForce()`
  - 所有魔術數字提取為頂部命名常數（30+ 個），包含物理參數、面板寬度、延遲時間等
  - 導出渦流常數（`VORTEX_OFFSET_RATIO`、`VORTEX_BLEND_RATIO`、`FOUNTAIN_BASE_STRENGTH`）供 renderer 使用
  - 精簡 Public API：移除未使用的 getter（ramp 系列）、合併 getter 為箭頭函式
- **renderer.js 重構**（538 行 → 402 行）：
  - 刪除整個 `drawRamps()` 函式（~110 行，繪製已廢棄的斜坡/天花板/轉接管）
  - `getFlowAt()` 改用 `Physics.VORTEX_OFFSET_RATIO` / `Physics.VORTEX_BLEND_RATIO`，不再硬編碼
  - `getFlowAt()` 新增噴泉向上力模擬，風場粒子更準確反映實際氣流
  - `resize()` 的高度偏移提取為 `CONTROLS_HEIGHT` 常數
- **style.css 重構**（338 行 → 291 行）：
  - 新增 `:root` CSS 變數統一 10 個重複顏色值（`--color-accent`、`--color-panel`、`--color-border` 等）
  - 5 個 input 規則合併為 `#controls input[type="number"]` 一條規則
  - 兩側面板共用樣式合併為 `#names-panel, #winner-panel` 規則
  - 兩側 h2 樣式合併、scrollbar 樣式合併
- **app.js 重構**：
  - 新增命名常數：`MAX_FRAME_DELTA`、`FIRST_EJECT_DELAY`、`SETTLE_DELAY`、`DEFAULT_BALL_RADIUS`
  - 新增 `applyUserSettings()` 統一讀取球大小和字大小輸入值，消除 `initPhysicsAndRenderer()` 與 `handleLoad()` 的重複

### Added
- **左側抽獎名單面板** — `#names-panel`（340px），顯示所有參與者名字
  - **兩欄佈局**（CSS `columns: 2`），適合 ~50 人名單
  - 中籤時 emoji 淡入 + 文字變金色（`.won` class）
  - 自動捲動至中獎者位置
  - 重置時清除標記
- **球大小預設按鈕** — 「小」(26) / 「大」(40) 快捷按鈕，一鍵切換 `input-ball-size`
- **首次出球延遲 3 秒** — 按下「抽籤」後延遲 3 秒才開始第一顆出球，防止讀秒指定中獎者
- **底部噴泉力** — 亂流系統新增專用向上推力，只作用在容器下半部，力量隨深度線性增強（`0.0035 * swirlMultiplier`），與雙渦流疊加形成更明顯的噴泉效果
- **左右面板半透明** — `#names-panel` 與 `#winner-panel` 背景改為 `rgba(22, 33, 62, 0.85)`，可透出背景圖
- **轉動/停止按鈕** — 將「抽籤」拆分為「轉動」（啟動亂流）與「抽籤」（出球）兩個獨立按鈕
  - 「轉動」為開關式 toggle，SPINNING 狀態顯示紅色「停止」
  - 新增 SPINNING 狀態至狀態機（READY ⇄ SPINNING）
- **channelStopper** — 出口管入口處擋板（`mask: CAT_BALL`），防止普通球在亂流中飄入出口管
- **RWD 背景對齊** — 容器位置依 `background-size: cover` 數學公式計算，跟隨 WONDERCORE 背景文字位置
  - 背景圖錨點：`ANCHOR_X=0.642, ANCHOR_Y=0.548, RADIUS_R=0.270`
  - Canvas 偏移修正：`canvasOffX = vpW - canvasW - 240`（左 340px / 右 240px 不對稱面板）

### Fixed
- **出球卡洞口** — 出口間隙 margin 從 `+6` 加大至 `+24`（考慮牆壁段 20px 厚度 + 旋轉佔用）
- **出球突然冒出** — 三項修正：
  1. 出球時立即切換碰撞遮罩為 `CAT_EXITING`（不再等到 entering 階段）
  2. 亂流完全跳過所有 `isExiting` 的球（原本 rising 階段仍受亂流影響）
  3. 引導力大幅增強 + 移除 6 秒硬傳送 fallback
- **球體可飄入出口管** — 新增 channelStopper 阻擋普通球進入出口管

### Changed
- 頁面佈局從兩欄（Canvas + 中籤面板）改為三欄（名單面板 340px + Canvas + 中籤面板 240px）
- 左側名單面板從單欄改為雙欄（`columns: 2`），字體 14px
- 每批抽完後自動停止亂流回到 READY（需手動按「轉動」重新啟動），取代原本維持 SPINNING 的行為
- 間隔預設值從 1 秒改為 2 秒

---

## 2026-02-08

### Added
- **球大小/字大小控制項** — 可調整球體半徑（8-50）及文字大小（0-40，0=自動）
- **噴泉式雙渦流亂流** — 取代單一順時針渦流，底部上吹，頂部分流左逆時針/右順時針
- **風場粒子視覺化** — 200 個帶漸層尾跡的粒子呈現雙渦流氣流方向
- **最近球出球** — 選離出口最近的球彈出（取代隨機選取）
- **背景圖** — `background.png` 作為頁面背景（WONDERCORE 尾牙主題）

### Fixed
- 出口管兩側開口（動態 `exitGapHalfAngle`）
- 入口閘門顏色統一為與圓環一致的藍白色
- 氣流倍率啟動時未讀取預設值
- 球大小在入籤筒時未重新讀取
