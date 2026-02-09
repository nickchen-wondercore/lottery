/**
 * app.js — 應用程式控制器：狀態機、UI 綁定、抽獎流程
 */
const App = (() => {
  // States: IDLE → LOADING → READY → TURBULENCE → DRAWING → COMPLETE
  let state = 'IDLE';
  let names = [];
  let winners = [];
  let animFrameId = null;
  let lastTime = 0;
  let ballRadius = 14;

  // DOM
  const btnLoad = document.getElementById('btn-load');
  const btnDraw = document.getElementById('btn-draw');
  const btnReset = document.getElementById('btn-reset');
  const inputCount = document.getElementById('input-count');
  const inputInterval = document.getElementById('input-interval');
  const inputSwirl = document.getElementById('input-swirl');
  const winnerList = document.getElementById('winner-list');
  const canvasEl = document.getElementById('canvas');

  async function loadNames() {
    try {
      const resp = await fetch('names.json');
      names = await resp.json();
      inputCount.max = names.length;
      inputCount.value = 1;
    } catch (e) {
      alert('無法載入 names.json：' + e.message);
    }
  }

  function setState(newState) {
    state = newState;
    updateUI();
  }

  function updateUI() {
    btnLoad.disabled = state !== 'IDLE';
    btnDraw.disabled = state !== 'READY';
    btnReset.disabled = state === 'IDLE' || state === 'LOADING' || state === 'TURBULENCE' || state === 'DRAWING';
    inputCount.disabled = state !== 'READY' && state !== 'IDLE';
  }

  let physicsInited = false;

  function initPhysicsAndRenderer() {
    if (!physicsInited) {
      Physics.init();
      physicsInited = true;
    }
    Renderer.init(canvasEl);
    const { width, height } = Renderer.getSize();
    Physics.layout(width, height);

    // Ball radius: slightly smaller than exit channel width
    const channelWidth = Physics.getExitChannel().width;
    ballRadius = channelWidth / 2 - 4;
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

  function handleDraw() {
    if (state !== 'READY') return;
    const count = parseInt(inputCount.value, 10);
    if (!count || count < 1) return;

    const remainingBalls = Physics.getBalls().length;
    const actualCount = Math.min(count, remainingBalls);
    if (actualCount === 0) return;

    setState('DRAWING');
    Physics.startTurbulence();

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
      Physics.stopTurbulence();
      Physics.closeExitGate();
      const remaining = Physics.getBalls().length;
      if (remaining === 0) {
        setState('COMPLETE');
      } else {
        setState('READY');
        inputCount.max = remaining;
        if (parseInt(inputCount.value, 10) > remaining) {
          inputCount.value = remaining;
        }
      }
    }

    // 2 seconds turbulence mixing, then start ejection cycle
    setTimeout(ejectCycle, 2000);
  }

  function handleReset() {
    if (state === 'IDLE' || state === 'LOADING' || state === 'TURBULENCE' || state === 'DRAWING') return;

    if (animFrameId) {
      cancelAnimationFrame(animFrameId);
      animFrameId = null;
    }
    Physics.cleanup();

    winners = [];
    winnerList.innerHTML = '';

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

  function handleResize() {
    if (state === 'IDLE') {
      drawPreview();
      return;
    }
    Renderer.resize();
  }

  function bindEvents() {
    btnLoad.addEventListener('click', handleLoad);
    btnDraw.addEventListener('click', handleDraw);
    btnReset.addEventListener('click', handleReset);
    inputSwirl.addEventListener('input', handleSwirlChange);
    window.addEventListener('resize', handleResize);
  }

  async function start() {
    await loadNames();
    bindEvents();
    updateUI();
    drawPreview();
  }

  start();
})();
