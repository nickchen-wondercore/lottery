/**
 * app.js — 應用程式控制器：狀態機、UI 綁定、抽獎流程
 */
const App = (() => {
  // States: IDLE → LOADING → READY → SPINNING → DRAWING → SPINNING/COMPLETE
  let state = 'IDLE';
  let names = [];
  let winners = [];
  let animFrameId = null;
  let lastTime = 0;
  let ballRadius = 14;

  // DOM
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

  function setState(newState) {
    state = newState;
    updateUI();
  }

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

  function initPhysicsAndRenderer() {
    if (!physicsInited) {
      Physics.init();
      physicsInited = true;
    }
    Renderer.init(canvasEl);

    // Read user-configured ball radius and apply before layout
    ballRadius = parseInt(inputBallSize.value, 10) || 24;
    Physics.setBallRadius(ballRadius);

    const { width, height } = Renderer.getSize();
    Physics.layout(width, height);

    // Apply font size setting
    const fontSize = parseInt(inputFontSize.value, 10) || 0;
    Renderer.setFontSize(fontSize);
  }

  // Draw a static preview frame (no animation loop)
  function drawPreview() {
    initPhysicsAndRenderer();
    Renderer.drawFrame();
  }

  function startLoop() {
    lastTime = performance.now();
    function loop(now) {
      const delta = Math.min(now - lastTime, 32);
      lastTime = now;
      Physics.update(delta);
      Renderer.drawFrame();
      animFrameId = requestAnimationFrame(loop);
    }
    animFrameId = requestAnimationFrame(loop);
  }

  function handleLoad() {
    if (state !== 'IDLE') return;
    setState('LOADING');

    // Re-read ball size and font size before layout
    ballRadius = parseInt(inputBallSize.value, 10) || 24;
    Physics.setBallRadius(ballRadius);
    const fontSize = parseInt(inputFontSize.value, 10) || 0;
    Renderer.setFontSize(fontSize);

    // Re-layout (physics engine already inited in preview)
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
      }, 2000);
    });
  }

  function handleSpin() {
    if (state === 'READY') {
      Physics.startTurbulence();
      setState('SPINNING');
    } else if (state === 'SPINNING') {
      Physics.stopTurbulence();
      setState('READY');
    }
  }

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
        const li = document.createElement('li');
        li.textContent = name;
        winnerList.appendChild(li);
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

    // Delay first ejection 3s to prevent timing manipulation
    setTimeout(ejectCycle, 3000);
  }

  function handleReset() {
    if (state === 'IDLE' || state === 'LOADING' || state === 'DRAWING') return;

    // Stop turbulence if spinning
    if (state === 'SPINNING') {
      Physics.stopTurbulence();
    }

    if (animFrameId) {
      cancelAnimationFrame(animFrameId);
      animFrameId = null;
    }
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

  function handleSwirlChange() {
    const val = parseInt(inputSwirl.value, 10);
    Physics.setSwirlMultiplier(val / 10);
  }

  function handleFontSizeChange() {
    const val = parseInt(inputFontSize.value, 10) || 0;
    Renderer.setFontSize(val);
  }

  function handleResize() {
    if (state === 'IDLE') {
      drawPreview();
      return;
    }
    Renderer.resize();
  }

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

  async function start() {
    await loadNames();
    bindEvents();
    handleSwirlChange();
    updateUI();
    drawPreview();
  }

  start();
})();
