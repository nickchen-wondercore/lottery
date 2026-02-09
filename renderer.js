/**
 * renderer.js — Canvas 2D 自訂繪製器
 * 分層渲染順序：出口管 → 容器填充 → 風場粒子 → 球體 → 容器邊框
 * 不操作 DOM，僅透過 Canvas API 繪製畫面。
 */
const Renderer = (() => {
  let canvas, ctx;
  let width, height;
  let entryOpen = false;    // 入口閘門是否開啟（視覺上不畫該段弧）
  let lidSealed = false;    // 容器是否已封閉（頂部間隙縮小至出口管寬度）
  let customFontSize = 0;   // 使用者自訂字大小（0 = 依球大小自動）

  // ── 風場粒子系統 ──
  const WIND_PARTICLE_COUNT = 200;  // 粒子數量上限
  let windParticles = [];
  let lastFrameTime = 0;

  // 底部控制列高度（Canvas 需扣除此高度，與 CSS #controls 對應）
  const CONTROLS_HEIGHT = 55;

  /** 在容器內隨機位置生成一個風場粒子（含生命週期與大小） */
  function spawnWindParticle(center, R) {
    const angle = Math.random() * Math.PI * 2;
    const dist = Math.random() * R * 0.85;
    return {
      x: center.x + Math.cos(angle) * dist,
      y: center.y + Math.sin(angle) * dist,
      life: 0,
      maxLife: 1.5 + Math.random() * 2.0,
      size: 1.5 + Math.random() * 1.5
    };
  }

  /**
   * 計算指定位置的氣流方向向量（用於驅動風場粒子）。
   * 模擬雙渦流切線力 + 底部噴泉向上力，與 Physics 端的亂流公式一致。
   * 使用 Physics 導出的常數確保視覺化與實際物理力同步。
   */
  function getFlowAt(x, y, center, R) {
    const vortexOffsetX = R * Physics.VORTEX_OFFSET_RATIO;
    const dx = x - center.x;

    const vdxL = x - (center.x - vortexOffsetX);
    const vdyL = y - center.y;
    const vdistL = Math.sqrt(vdxL * vdxL + vdyL * vdyL) || 1;
    const txL = vdyL / vdistL;
    const tyL = -vdxL / vdistL;

    const vdxR = x - (center.x + vortexOffsetX);
    const vdyR = y - center.y;
    const vdistR = Math.sqrt(vdxR * vdxR + vdyR * vdyR) || 1;
    const txR = -vdyR / vdistR;
    const tyR = vdxR / vdistR;

    const blendW = R * Physics.VORTEX_BLEND_RATIO;
    const blend = Math.min(1, Math.max(0, (dx + blendW) / (2 * blendW)));
    let fx = txL * (1 - blend) + txR * blend;
    let fy = tyL * (1 - blend) + tyR * blend;

    // Fountain upward force (bottom half)
    const belowCenter = y - center.y;
    if (belowCenter > 0) {
      const ratio = Math.min(belowCenter / R, 1);
      fy -= ratio * 0.5;
    }

    return { fx, fy };
  }

  /**
   * 更新風場粒子位置並繪製帶漸層尾跡的粒子線段。
   * 粒子生命週期：淡入 → 全亮 → 淡出，超時或離開容器則重生。
   * 僅在亂流啟動時呼叫。
   */
  function updateAndDrawWind(dt) {
    const center = Physics.getContainerCenter();
    const R = Physics.getContainerRadius();
    const swirl = Physics.getSwirlMultiplier();
    const speed = 60 * swirl;

    while (windParticles.length < WIND_PARTICLE_COUNT) {
      windParticles.push(spawnWindParticle(center, R));
    }

    ctx.save();
    ctx.beginPath();
    ctx.arc(center.x, center.y, R - 2, 0, Math.PI * 2);
    ctx.clip();

    for (let i = 0; i < windParticles.length; i++) {
      const p = windParticles[i];
      p.life += dt;

      const pdx = p.x - center.x;
      const pdy = p.y - center.y;
      if (p.life > p.maxLife || (pdx * pdx + pdy * pdy) > R * R * 0.95) {
        windParticles[i] = spawnWindParticle(center, R);
        continue;
      }

      const flow = getFlowAt(p.x, p.y, center, R);
      const prevX = p.x;
      const prevY = p.y;
      p.x += flow.fx * speed * dt;
      p.y += flow.fy * speed * dt;

      const lifeRatio = p.life / p.maxLife;
      let alpha;
      if (lifeRatio < 0.15) alpha = lifeRatio / 0.15;
      else if (lifeRatio > 0.75) alpha = (1 - lifeRatio) / 0.25;
      else alpha = 1;
      alpha *= 0.55;

      const dx2 = p.x - prevX;
      const dy2 = p.y - prevY;
      const streakLen = Math.sqrt(dx2 * dx2 + dy2 * dy2);
      if (streakLen < 0.5) continue;

      const tailX = p.x + dx2 * 2.5;
      const tailY = p.y + dy2 * 2.5;

      const grad = ctx.createLinearGradient(prevX, prevY, tailX, tailY);
      grad.addColorStop(0, `rgba(160, 210, 255, 0)`);
      grad.addColorStop(0.3, `rgba(160, 210, 255, ${alpha})`);
      grad.addColorStop(1, `rgba(160, 210, 255, ${alpha * 0.3})`);

      ctx.strokeStyle = grad;
      ctx.lineWidth = p.size;
      ctx.lineCap = 'round';
      ctx.beginPath();
      ctx.moveTo(prevX, prevY);
      ctx.lineTo(tailX, tailY);
      ctx.stroke();
    }

    ctx.restore();
  }

  /** 初始化 Canvas 上下文並調整尺寸 */
  function init(canvasEl) {
    canvas = canvasEl;
    ctx = canvas.getContext('2d');
    resize();
    return ctx;
  }

  /** 根據父元素大小重新設定 Canvas 寬高（扣除底部控制列高度） */
  function resize() {
    const rect = canvas.parentElement.getBoundingClientRect();
    width = rect.width;
    height = rect.height - CONTROLS_HEIGHT;
    canvas.width = width;
    canvas.height = height;
    return { width, height };
  }

  function setEntryOpen(v) { entryOpen = v; }
  function setLidSealed(v) { lidSealed = v; }

  /** 清空整個 Canvas */
  function clear() {
    ctx.clearRect(0, 0, width, height);
  }

  // ── 玻璃容器：背景填充 ──

  /** 繪製容器背景：外圈發光暈 + 內部半透明漸層填充，營造玻璃質感 */
  function drawContainerFill() {
    const center = Physics.getContainerCenter();
    const radius = Physics.getContainerRadius();

    ctx.save();

    const glowGrad = ctx.createRadialGradient(
      center.x, center.y, radius * 0.9,
      center.x, center.y, radius * 1.15
    );
    glowGrad.addColorStop(0, 'rgba(100, 180, 255, 0.05)');
    glowGrad.addColorStop(1, 'rgba(100, 180, 255, 0)');
    ctx.fillStyle = glowGrad;
    ctx.beginPath();
    ctx.arc(center.x, center.y, radius * 1.15, 0, Math.PI * 2);
    ctx.fill();

    const bodyGrad = ctx.createRadialGradient(
      center.x - radius * 0.3, center.y - radius * 0.3, radius * 0.1,
      center.x, center.y, radius
    );
    bodyGrad.addColorStop(0, 'rgba(180, 220, 255, 0.08)');
    bodyGrad.addColorStop(0.5, 'rgba(120, 170, 230, 0.04)');
    bodyGrad.addColorStop(1, 'rgba(80, 130, 200, 0.06)');
    ctx.fillStyle = bodyGrad;
    ctx.beginPath();
    ctx.arc(center.x, center.y, radius, 0, Math.PI * 2);
    ctx.fill();

    ctx.restore();
  }

  // ── 玻璃容器：邊框環（含間隙） ──

  /**
   * 繪製容器邊框環：主線 + 外暈線 + 高光弧。
   * 根據 lidSealed / entryOpen 狀態決定頂部和入口間隙大小。
   * 入口關閉時補畫閘門弧段。
   */
  function drawContainerRing() {
    const center = Physics.getContainerCenter();
    const radius = Physics.getContainerRadius();
    const ec = Physics.getExitChannel();

    const gaps = [];
    const topCenter = 3 * Math.PI / 2;
    if (lidSealed) {
      const ecHalf = Math.asin((ec.width / 2 + 10) / radius);
      gaps.push({ center: topCenter, half: ecHalf });
    } else {
      gaps.push({ center: topCenter, half: Physics.getExitGapHalfAngle() });
    }

    if (entryOpen) {
      gaps.push({ center: Physics.getEntryAngle(), half: Physics.getEntryGapHalfAngle() });
    }

    ctx.save();

    ctx.strokeStyle = 'rgba(150, 200, 255, 0.3)';
    ctx.lineWidth = 3;
    drawArcsWithGaps(center.x, center.y, radius, gaps);

    ctx.strokeStyle = 'rgba(180, 190, 210, 0.15)';
    ctx.lineWidth = 6;
    drawArcsWithGaps(center.x, center.y, radius + 3, gaps);

    if (!entryOpen) {
      const ea = Physics.getEntryAngle();
      const entryHalf = Physics.getEntryGapHalfAngle();
      ctx.strokeStyle = 'rgba(150, 200, 255, 0.3)';
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.arc(center.x, center.y, radius, ea - entryHalf, ea + entryHalf);
      ctx.stroke();
    }

    ctx.strokeStyle = 'rgba(255, 255, 255, 0.12)';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(center.x, center.y, radius - 6, Math.PI * 1.6, Math.PI * 2.1);
    ctx.stroke();

    ctx.restore();
  }

  /** 繪製帶有多個間隙的圓弧（將完整圓切成數段，跳過間隙區域） */
  function drawArcsWithGaps(cx, cy, radius, gapDefs) {
    if (gapDefs.length === 0) {
      ctx.beginPath();
      ctx.arc(cx, cy, radius, 0, Math.PI * 2);
      ctx.stroke();
      return;
    }

    const TWO_PI = 2 * Math.PI;
    const gaps = gapDefs.map(g => {
      let s = ((g.center - g.half) % TWO_PI + TWO_PI) % TWO_PI;
      let e = ((g.center + g.half) % TWO_PI + TWO_PI) % TWO_PI;
      return { start: s, end: e };
    });
    gaps.sort((a, b) => a.start - b.start);

    for (let i = 0; i < gaps.length; i++) {
      const arcStart = gaps[i].end;
      const arcEnd = gaps[(i + 1) % gaps.length].start;
      ctx.beginPath();
      ctx.arc(cx, cy, radius, arcStart, arcEnd);
      ctx.stroke();
    }
  }

  // ── 出口管 ──

  /**
   * 繪製出口管：半透明背景 + 左右管壁線 + 頂部標記線。
   * 閘門關閉時額外畫一條金色橫桿。
   */
  function drawExitChannel() {
    const ec = Physics.getExitChannel();
    const center = Physics.getContainerCenter();
    const radius = Physics.getContainerRadius();

    const halfW = ec.width / 2 + 4;
    const topY = ec.topY - 10;
    const botY = center.y - radius;

    ctx.save();

    const chanGrad = ctx.createLinearGradient(ec.x - halfW, 0, ec.x + halfW, 0);
    chanGrad.addColorStop(0, 'rgba(100, 130, 180, 0.12)');
    chanGrad.addColorStop(0.5, 'rgba(120, 160, 210, 0.06)');
    chanGrad.addColorStop(1, 'rgba(100, 130, 180, 0.12)');
    ctx.fillStyle = chanGrad;
    ctx.fillRect(ec.x - halfW, topY, halfW * 2, botY - topY);

    ctx.strokeStyle = 'rgba(150, 180, 220, 0.25)';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(ec.x - halfW, topY);
    ctx.lineTo(ec.x - halfW, botY);
    ctx.moveTo(ec.x + halfW, topY);
    ctx.lineTo(ec.x + halfW, botY);
    ctx.stroke();

    ctx.strokeStyle = 'rgba(255, 200, 100, 0.25)';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(ec.x - halfW - 4, topY);
    ctx.lineTo(ec.x + halfW + 4, topY);
    ctx.stroke();

    if (Physics.isExitGateClosed()) {
      const gateY = ec.topY;
      ctx.fillStyle = '#b08830';
      ctx.fillRect(ec.x - halfW - 2, gateY - 4, (halfW + 2) * 2, 8);
      ctx.strokeStyle = '#d0a848';
      ctx.lineWidth = 1;
      ctx.strokeRect(ec.x - halfW - 2, gateY - 4, (halfW + 2) * 2, 8);
    }

    ctx.restore();
  }

  // ── 球體繪製 ──

  /**
   * 繪製所有球體：漸層填充 + 邊框 + 高光 + 名字文字。
   * 出球中的球體使用較亮的金色配色以示區分。
   * 文字大小依使用者設定或自動依球體半徑縮放，過寬時逐步縮小。
   */
  function drawBalls() {
    const balls = Physics.getBalls();

    balls.forEach(ball => {
      const pos = ball.position;
      const r = ball.ballRadius || 14;

      ctx.save();
      ctx.translate(pos.x, pos.y);

      const grad = ctx.createRadialGradient(-r * 0.3, -r * 0.3, r * 0.1, 0, 0, r);
      if (ball.isExiting) {
        grad.addColorStop(0, '#ffe066');
        grad.addColorStop(0.7, '#f5a623');
        grad.addColorStop(1, '#c07818');
      } else {
        grad.addColorStop(0, '#ffcc44');
        grad.addColorStop(0.7, '#e8941c');
        grad.addColorStop(1, '#b06a10');
      }
      ctx.fillStyle = grad;
      ctx.beginPath();
      ctx.arc(0, 0, r, 0, Math.PI * 2);
      ctx.fill();

      ctx.strokeStyle = 'rgba(180, 120, 40, 0.6)';
      ctx.lineWidth = 1;
      ctx.stroke();

      ctx.fillStyle = 'rgba(255, 255, 255, 0.25)';
      ctx.beginPath();
      ctx.arc(-r * 0.25, -r * 0.25, r * 0.35, 0, Math.PI * 2);
      ctx.fill();

      const name = ball.name || '';
      const maxWidth = r * 1.6;
      let fontSize = customFontSize > 0 ? customFontSize : Math.max(8, r * 0.7);
      ctx.font = `bold ${fontSize}px Arial`;
      while (ctx.measureText(name).width > maxWidth && fontSize > 4) {
        fontSize -= 0.5;
        ctx.font = `bold ${fontSize}px Arial`;
      }
      ctx.fillStyle = '#2a1800';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(name, 0, r * 0.1);

      ctx.restore();
    });
  }

  // ── 主繪製迴圈 ──

  let _drawErrors = [];

  /** 安全執行繪製函式，出錯時記錄錯誤訊息（顯示在 Canvas 左上角） */
  function safeDraw(fn, label) {
    try { fn(); }
    catch (e) {
      if (!_drawErrors.includes(label)) _drawErrors.push(label + ': ' + e.message);
    }
  }

  /**
   * 主繪製入口（每幀呼叫一次）：
   * 清空畫布 → 出口管 → 容器填充 → 風場粒子（亂流時）→ 球體 → 容器邊框
   */
  function drawFrame() {
    const now = performance.now() / 1000;
    const dt = Math.min(now - lastFrameTime, 0.05);
    lastFrameTime = now;

    clear();
    _drawErrors = [];
    safeDraw(drawExitChannel, 'exitCh');
    safeDraw(drawContainerFill, 'fill');

    if (Physics.isTurbulenceActive()) {
      safeDraw(() => updateAndDrawWind(dt), 'wind');
    } else if (windParticles.length > 0) {
      windParticles = [];
    }

    safeDraw(drawBalls, 'balls');
    safeDraw(drawContainerRing, 'ring');

    if (_drawErrors.length > 0) {
      ctx.save();
      ctx.fillStyle = '#ff4444';
      ctx.font = '12px monospace';
      _drawErrors.forEach((msg, i) => {
        ctx.fillText(msg, 10, 20 + i * 16);
      });
      ctx.restore();
    }
  }

  function getSize() {
    return { width, height };
  }

  function setFontSize(size) { customFontSize = size; }

  return { init, resize, drawFrame, getSize, setLidSealed, setEntryOpen, setFontSize };
})();
