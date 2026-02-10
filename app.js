/**
 * app.js — 應用程式控制器
 * 管理狀態機（IDLE → LOADING → READY ⇄ SPINNING → DRAWING → COMPLETE）、
 * UI 按鈕綁定、抽獎流程控制、動畫迴圈。
 */
const App = (() => {
  // ── 狀態機流程 ──
  // IDLE（初始）→ LOADING（入籤筒）→ READY（就緒）⇄ SPINNING（轉動中）→ DRAWING（抽籤中）→ READY（批次完成）/ COMPLETE（全部抽完）

  const MAX_FRAME_DELTA = 32;         // 單幀最大時間差（ms），防止切頁回來後物理大跳
  const FIRST_EJECT_DELAY = 3000;     // 首次出球延遲（ms），防止計時指定中獎者
  const SETTLE_DELAY = 2000;          // 球體落入容器後等待沉澱時間（ms）
  const DEFAULT_BALL_RADIUS = 24;     // 預設球體半徑

  let state = 'IDLE';       // 目前狀態
  let names = [];            // 所有參與者名字（從 names.json 載入）
  let winners = [];          // 已中籤名字
  let animFrameId = null;    // requestAnimationFrame ID
  let lastTime = 0;          // 上一幀時間戳
  let ballRadius = DEFAULT_BALL_RADIUS;

  // ── DOM 元素參考 ──
  const btnLoad = document.getElementById('btn-load');
  const btnSpin = document.getElementById('btn-spin');
  const btnDraw = document.getElementById('btn-draw');
  const btnReset = document.getElementById('btn-reset');
  const inputCount = document.getElementById('input-count');
  const inputInterval = document.getElementById('input-interval');
  const inputSwirl = document.getElementById('input-swirl');
  const namesList = document.getElementById('names-list');
  const winnerList = document.getElementById('winner-list');
  const canvasEl = document.getElementById('canvas');
  const inputBallSize = document.getElementById('input-ball-size');
  const inputFontSize = document.getElementById('input-font-size');

  /** 從 names.json 載入參與者名單，並填充左側名單面板 */
  async function loadNames() {
    try {
      const resp = await fetch('names.json');
      names = await resp.json();
      inputCount.max = names.length;
      inputCount.value = 1;
      populateNamesList();
    } catch (e) {
      alert('無法載入 names.json：' + e.message);
    }
  }

  /** 將名字陣列渲染為左側面板的 <li> 列表（含隱藏的中獎 badge） */
  function populateNamesList() {
    namesList.innerHTML = '';
    names.forEach(name => {
      const li = document.createElement('li');
      li.dataset.name = name;
      const badge = document.createElement('span');
      badge.className = 'badge';
      badge.textContent = '🎯'; // 🏆
      li.appendChild(badge);
      li.appendChild(document.createTextNode(name));
      namesList.appendChild(li);
    });
  }

  /** 計算中獎球體內文字的自適應大小（仿 renderer.js 的 Canvas 球體文字縮放邏輯） */
  function calcBallFontSize(name, ballDiameter) {
    const usableWidth = ballDiameter * 0.78;
    let totalWeight = 0;
    for (const ch of name) {
      totalWeight += ch.charCodeAt(0) > 0x7F ? 1 : 0.6;
    }
    if (totalWeight === 0) return 14;
    const size = usableWidth / totalWeight;
    return Math.max(6, Math.min(14, size));
  }

  /** 建立中獎者 <li> 元素（籤球 + 名字） */
  function createWinnerLi(name) {
    const li = document.createElement('li');
    const ball = document.createElement('span');
    ball.className = 'winner-ball';
    ball.textContent = name;
    ball.style.fontSize = calcBallFontSize(name, 38) + 'px';
    const nameSpan = document.createElement('span');
    nameSpan.className = 'winner-name';
    nameSpan.textContent = name;
    li.appendChild(ball);
    li.appendChild(nameSpan);
    return li;
  }

  /** 在左側名單中標記中獎者（加上 .won class，badge 淡入 + 文字變金色），並自動捲動至該位置 */
  function markWinner(name) {
    const items = namesList.querySelectorAll('li');
    for (const li of items) {
      if (li.dataset.name === name && !li.classList.contains('won')) {
        li.classList.add('won');
        li.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
        break;
      }
    }
  }

  /** 切換狀態並同步更新所有按鈕的 disabled / 文字 / 樣式 */
  function setState(newState) {
    state = newState;
    updateUI();
  }

  /** 根據目前 state 設定各按鈕的啟用/停用狀態與顯示文字 */
  function updateUI() {
    btnLoad.disabled = state !== 'IDLE';
    btnSpin.disabled = (state !== 'READY' && state !== 'SPINNING');
    btnSpin.textContent = state === 'SPINNING' ? '停止' : '轉動';
    btnSpin.classList.toggle('spinning', state === 'SPINNING');
    btnDraw.disabled = state !== 'SPINNING';
    btnReset.disabled = (state === 'IDLE' || state === 'LOADING' || state === 'DRAWING');
    inputCount.disabled = (state !== 'READY' && state !== 'IDLE' && state !== 'SPINNING');
    inputBallSize.disabled = state !== 'IDLE';
  }

  let physicsInited = false;

  /** 讀取 UI 輸入的球大小與字大小，套用至 Physics 和 Renderer */
  function applyUserSettings() {
    ballRadius = parseInt(inputBallSize.value, 10) || DEFAULT_BALL_RADIUS;
    Physics.setBallRadius(ballRadius);
    Renderer.setFontSize(parseInt(inputFontSize.value, 10) || 0);
    Physics.setSwirlMultiplier((parseInt(inputSwirl.value, 10) || 75) / 10);
  }

  /** 初始化物理引擎與繪製器（僅首次建立引擎），並根據 Canvas 尺寸配置版面 */
  function initPhysicsAndRenderer() {
    if (!physicsInited) {
      Physics.init();
      physicsInited = true;
    }
    Renderer.init(canvasEl);
    applyUserSettings();
    const { width, height } = Renderer.getSize();
    Physics.layout(width, height);
  }

  /** 繪製靜態預覽畫面（容器、出口管），不啟動動畫迴圈（用於 IDLE 狀態） */
  function drawPreview() {
    initPhysicsAndRenderer();
    Renderer.drawFrame();
  }

  /** 啟動 requestAnimationFrame 動畫迴圈，每幀更新物理 + 繪製畫面 */
  function stopLoop() {
    if (animFrameId) {
      cancelAnimationFrame(animFrameId);
      animFrameId = null;
    }
  }

  function startLoop() {
    if (animFrameId) return;
    lastTime = performance.now();
    function loop(now) {
      const delta = Math.min(now - lastTime, MAX_FRAME_DELTA);
      lastTime = now;
      Physics.update(delta);
      Renderer.drawFrame();
      animFrameId = requestAnimationFrame(loop);
    }
    animFrameId = requestAnimationFrame(loop);
  }

  /**
   * 「入籤筒」按鈕：讀取設定 → 啟動動畫 → 逐顆生成球體 → 等待沉澱 → 封閉容器。
   * 球體從容器內部上方落下，全部生成後等待 2 秒沉澱再封閉。
   */
  function handleLoad() {
    if (state !== 'IDLE') return;
    setState('LOADING');

    applyUserSettings();
    const { width, height } = Renderer.getSize();
    Physics.layout(width, height);
    startLoop();

    // Balls drop from above the exit channel into the container (~2.4s for 30 balls)
    Physics.createBalls(names, ballRadius, () => {
      // All balls created — wait for them to settle in container
      setTimeout(() => {
        Physics.sealContainer();
        Renderer.setLidSealed(true);
        setState('READY');
      }, SETTLE_DELAY);
    });
  }

  /** 「轉動/停止」切換按鈕：READY 時啟動亂流 → SPINNING，SPINNING 時停止亂流 → READY */
  function handleSpin() {
    if (state === 'READY') {
      Physics.startTurbulence();
      setState('SPINNING');
    } else if (state === 'SPINNING') {
      Physics.stopTurbulence();
      setState('READY');
    }
  }

  /**
   * 「抽籤」按鈕：延遲 3 秒後開始出球循環。
   * 每次出球：開閘門 → 彈出最近的球 → 關閘門 → 記錄中獎 → 等待間隔 → 下一顆。
   * 批次抽完後自動停止亂流回到 READY，全部抽完則進入 COMPLETE。
   */
  function handleDraw() {
    if (state !== 'SPINNING') return;
    const count = parseInt(inputCount.value, 10);
    if (!count || count < 1) return;

    const remainingBalls = Physics.getBalls().length;
    const actualCount = Math.min(count, remainingBalls);
    if (actualCount === 0) return;

    setState('DRAWING');

    const intervalSec = parseInt(inputInterval.value, 10) || 3;
    let drawn = 0;

    function ejectCycle() {
      Physics.openExitGate();
      Physics.ejectOneBall((name) => {
        Physics.closeExitGate();

        if (name === null) {
          finishDrawing();
          return;
        }

        drawn++;
        winners.push(name);
        markWinner(name);
        winnerList.appendChild(createWinnerLi(name));
        winnerList.scrollTop = winnerList.scrollHeight;

        if (drawn >= actualCount) {
          finishDrawing();
        } else {
          setTimeout(ejectCycle, intervalSec * 1000);
        }
      });
    }

    function finishDrawing() {
      Physics.closeExitGate();
      const remaining = Physics.getBalls().length;
      if (remaining === 0) {
        Physics.stopTurbulence();
        setState('COMPLETE');
      } else {
        // Stop turbulence after each batch, user must press 轉動 again
        Physics.stopTurbulence();
        setState('READY');
        inputCount.max = remaining;
        if (parseInt(inputCount.value, 10) > remaining) {
          inputCount.value = remaining;
        }
      }
    }

    setTimeout(ejectCycle, FIRST_EJECT_DELAY);
  }

  /** 「重置」按鈕：停止動畫迴圈、清理物理、清空中獎記錄、恢復 UI 至初始狀態 */
  function handleReset() {
    if (state === 'IDLE' || state === 'LOADING' || state === 'DRAWING') return;

    // Stop turbulence if spinning
    if (state === 'SPINNING') {
      Physics.stopTurbulence();
    }

    stopLoop();
    Physics.cleanup();

    winners = [];
    winnerList.innerHTML = '';
    namesList.querySelectorAll('li.won').forEach(li => li.classList.remove('won'));

    Renderer.setEntryOpen(false);
    Renderer.setLidSealed(false);

    inputCount.max = names.length;
    inputCount.value = 1;

    // Redraw static preview (container, ramps, exit channel)
    drawPreview();

    setState('IDLE');
  }

  /** 氣流倍率輸入變更時，更新 Physics 的亂流強度乘數（輸入值 ÷ 10） */
  function handleSwirlChange() {
    const val = parseInt(inputSwirl.value, 10);
    Physics.setSwirlMultiplier(val / 10);
  }

  /** 字大小輸入變更時，即時更新 Renderer 的文字大小（0 = 自動） */
  function handleFontSizeChange() {
    const val = parseInt(inputFontSize.value, 10) || 0;
    Renderer.setFontSize(val);
  }

  /** 視窗大小變更時重繪（IDLE 狀態重繪預覽，其他狀態只調整 Canvas 尺寸） */
  function handleResize() {
    if (state === 'IDLE') {
      drawPreview();
      return;
    }
    Renderer.resize();
  }

  /** 綁定所有 UI 事件：按鈕點擊、輸入變更、預設按鈕、視窗縮放 */
  function bindEvents() {
    btnLoad.addEventListener('click', handleLoad);
    btnSpin.addEventListener('click', handleSpin);
    btnDraw.addEventListener('click', handleDraw);
    btnReset.addEventListener('click', handleReset);
    inputSwirl.addEventListener('input', handleSwirlChange);
    inputFontSize.addEventListener('input', handleFontSizeChange);
    document.querySelectorAll('.preset-btn[data-ball]').forEach(btn => {
      btn.addEventListener('click', () => {
        inputBallSize.value = btn.dataset.ball;
      });
    });
    window.addEventListener('resize', handleResize);
  }

  /** 應用程式進入點：載入名單 → 綁定事件 → 初始化氣流預設值 → 繪製靜態預覽 */
  async function start() {
    await loadNames();
    bindEvents();
    handleSwirlChange();
    updateUI();
    drawPreview();
  }

  start();
})();
