/**
 * renderer.js — 自訂 Canvas 繪製：玻璃球體、球、Z字斜坡、出球管
 */
const Renderer = (() => {
  let canvas, ctx;
  let width, height;
  let entryOpen = false;
  let lidSealed = false;

  function init(canvasEl) {
    canvas = canvasEl;
    ctx = canvas.getContext('2d');
    resize();
    return ctx;
  }

  function resize() {
    const rect = canvas.parentElement.getBoundingClientRect();
    width = rect.width;
    height = rect.height - 55;
    canvas.width = width;
    canvas.height = height;
    return { width, height };
  }

  function setEntryOpen(v) { entryOpen = v; }
  function setLidSealed(v) { lidSealed = v; }

  function clear() {
    ctx.clearRect(0, 0, width, height);
  }

  // ── Glass container: background fill ──
  function drawContainerFill() {
    const center = Physics.getContainerCenter();
    const radius = Physics.getContainerRadius();

    ctx.save();

    // Outer glow
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

    // Glass body fill
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

  // ── Glass container: ring with gaps ──
  function drawContainerRing() {
    const center = Physics.getContainerCenter();
    const radius = Physics.getContainerRadius();
    const ec = Physics.getExitChannel();

    // Build gap list [{center, half}]
    const gaps = [];

    // Top gap
    const topCenter = 3 * Math.PI / 2;
    if (lidSealed) {
      const ecHalf = Math.asin((ec.width / 2 + 10) / radius);
      gaps.push({ center: topCenter, half: ecHalf });
    } else {
      gaps.push({ center: topCenter, half: Physics.getExitGapHalfAngle() });
    }

    // Entry gap (only when entry is open)
    if (entryOpen) {
      gaps.push({ center: Physics.getEntryAngle(), half: Physics.getEntryGapHalfAngle() });
    }

    ctx.save();

    // Glass edge ring
    ctx.strokeStyle = 'rgba(150, 200, 255, 0.3)';
    ctx.lineWidth = 3;
    drawArcsWithGaps(center.x, center.y, radius, gaps);

    // Metal frame ring
    ctx.strokeStyle = 'rgba(180, 190, 210, 0.15)';
    ctx.lineWidth = 6;
    drawArcsWithGaps(center.x, center.y, radius + 3, gaps);

    // Entry gate highlight (when closed)
    if (!entryOpen) {
      const ea = Physics.getEntryAngle();
      const entryHalf = Physics.getEntryGapHalfAngle();
      ctx.strokeStyle = 'rgba(200, 160, 80, 0.25)';
      ctx.lineWidth = 4;
      ctx.beginPath();
      ctx.arc(center.x, center.y, radius, ea - entryHalf, ea + entryHalf);
      ctx.stroke();
    }

    // Highlight arc (lower-right area)
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.12)';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(center.x, center.y, radius - 6, Math.PI * 1.6, Math.PI * 2.1);
    ctx.stroke();

    ctx.restore();
  }

  function drawArcsWithGaps(cx, cy, radius, gapDefs) {
    if (gapDefs.length === 0) {
      ctx.beginPath();
      ctx.arc(cx, cy, radius, 0, Math.PI * 2);
      ctx.stroke();
      return;
    }

    // Convert to sorted [start, end] ranges
    const gaps = gapDefs.map(g => {
      let s = g.center - g.half;
      let e = g.center + g.half;
      // Normalize to [0, 2π)
      s = ((s % (2 * Math.PI)) + 2 * Math.PI) % (2 * Math.PI);
      e = ((e % (2 * Math.PI)) + 2 * Math.PI) % (2 * Math.PI);
      return { start: s, end: e };
    });
    gaps.sort((a, b) => a.start - b.start);

    // Draw arcs between gap ends and next gap starts
    for (let i = 0; i < gaps.length; i++) {
      const arcStart = gaps[i].end;
      const arcEnd = gaps[(i + 1) % gaps.length].start;
      ctx.beginPath();
      ctx.arc(cx, cy, radius, arcStart, arcEnd);
      ctx.stroke();
    }
  }

  // ── Exit channel ──
  function drawExitChannel() {
    const ec = Physics.getExitChannel();
    const center = Physics.getContainerCenter();
    const radius = Physics.getContainerRadius();

    const halfW = ec.width / 2 + 4;
    const topY = ec.topY - 10;
    const botY = center.y - radius;

    ctx.save();

    // Channel body
    const chanGrad = ctx.createLinearGradient(ec.x - halfW, 0, ec.x + halfW, 0);
    chanGrad.addColorStop(0, 'rgba(100, 130, 180, 0.12)');
    chanGrad.addColorStop(0.5, 'rgba(120, 160, 210, 0.06)');
    chanGrad.addColorStop(1, 'rgba(100, 130, 180, 0.12)');
    ctx.fillStyle = chanGrad;
    ctx.fillRect(ec.x - halfW, topY, halfW * 2, botY - topY);

    // Side walls
    ctx.strokeStyle = 'rgba(150, 180, 220, 0.25)';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(ec.x - halfW, topY);
    ctx.lineTo(ec.x - halfW, botY);
    ctx.moveTo(ec.x + halfW, topY);
    ctx.lineTo(ec.x + halfW, botY);
    ctx.stroke();

    // Top opening
    ctx.strokeStyle = 'rgba(255, 200, 100, 0.25)';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(ec.x - halfW - 4, topY);
    ctx.lineTo(ec.x + halfW + 4, topY);
    ctx.stroke();

    // Exit gate visual (gold bar at top of channel)
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

  // ── Ramps & gates ──
  function drawRamps() {
    const bodies = Physics.getRampBodies();
    const geoms = Physics.getRampGeoms();
    const gates = Physics.getRampGates();
    const endWalls = Physics.getRampEndWalls();

    ctx.save();

    // Draw ramp surfaces
    bodies.forEach((ramp, i) => {
      if (!ramp) return;
      const g = geoms[i];
      if (!g) return;

      ctx.save();
      ctx.translate(ramp.position.x, ramp.position.y);
      ctx.rotate(ramp.angle);

      const hw = g.length / 2;
      const hh = 6;

      // Metal ramp surface
      const rampGrad = ctx.createLinearGradient(0, -hh, 0, hh);
      rampGrad.addColorStop(0, '#8a9aab');
      rampGrad.addColorStop(0.5, '#b0c0d0');
      rampGrad.addColorStop(1, '#6a7a8a');
      ctx.fillStyle = rampGrad;
      ctx.fillRect(-hw, -hh, hw * 2, hh * 2);

      // Highlight on top edge
      ctx.strokeStyle = 'rgba(200, 220, 240, 0.4)';
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(-hw, -hh);
      ctx.lineTo(hw, -hh);
      ctx.stroke();

      ctx.restore();
    });

    // Draw tube ceilings (parallel to ramp floors)
    const ceilings = Physics.getRampCeilings();
    ceilings.forEach((ceil, i) => {
      if (!ceil) return;
      const g = geoms[i];
      if (!g) return;

      ctx.save();
      ctx.translate(ceil.position.x, ceil.position.y);
      ctx.rotate(ceil.angle);

      const hw = g.length * 0.92 / 2;
      const hh = 6;

      // Metal ceiling surface (same style as ramp)
      const ceilGrad = ctx.createLinearGradient(0, -hh, 0, hh);
      ceilGrad.addColorStop(0, '#6a7a8a');
      ceilGrad.addColorStop(0.5, '#8a9aab');
      ceilGrad.addColorStop(1, '#b0c0d0');
      ctx.fillStyle = ceilGrad;
      ctx.fillRect(-hw, -hh, hw * 2, hh * 2);

      // Highlight on bottom edge
      ctx.strokeStyle = 'rgba(200, 220, 240, 0.3)';
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(-hw, hh);
      ctx.lineTo(hw, hh);
      ctx.stroke();

      ctx.restore();
    });

    // Draw gates and end walls (read actual size from physics body bounds)
    [...gates, ...endWalls].forEach(gate => {
      if (!gate) return;
      const bounds = gate.bounds;
      const gw = bounds.max.x - bounds.min.x;
      const gh = bounds.max.y - bounds.min.y;
      ctx.fillStyle = '#b08830';
      ctx.fillRect(bounds.min.x, bounds.min.y, gw, gh);
      ctx.strokeStyle = '#d0a848';
      ctx.lineWidth = 1;
      ctx.strokeRect(bounds.min.x, bounds.min.y, gw, gh);
    });

    // Draw transition channels (vertical tubes between ramps)
    const transitions = Physics.getTransitionGeoms();
    transitions.forEach(t => {
      const halfW = t.halfW;

      // Channel body fill
      const chanGrad = ctx.createLinearGradient(t.x - halfW, 0, t.x + halfW, 0);
      chanGrad.addColorStop(0, 'rgba(100, 130, 180, 0.15)');
      chanGrad.addColorStop(0.5, 'rgba(120, 160, 210, 0.06)');
      chanGrad.addColorStop(1, 'rgba(100, 130, 180, 0.15)');
      ctx.fillStyle = chanGrad;
      ctx.fillRect(t.x - halfW, t.topY, halfW * 2, t.botY - t.topY);

      // Side walls
      ctx.strokeStyle = 'rgba(150, 180, 220, 0.3)';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(t.x - halfW, t.topY);
      ctx.lineTo(t.x - halfW, t.botY);
      ctx.moveTo(t.x + halfW, t.topY);
      ctx.lineTo(t.x + halfW, t.botY);
      ctx.stroke();
    });

    ctx.restore();
  }

  // ── Balls ──
  function drawBalls() {
    const balls = Physics.getBalls();

    balls.forEach(ball => {
      const pos = ball.position;
      const r = ball.ballRadius || 14;

      ctx.save();
      ctx.translate(pos.x, pos.y);

      // Ball body gradient
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

      // Ball edge
      ctx.strokeStyle = 'rgba(180, 120, 40, 0.6)';
      ctx.lineWidth = 1;
      ctx.stroke();

      // Highlight
      ctx.fillStyle = 'rgba(255, 255, 255, 0.25)';
      ctx.beginPath();
      ctx.arc(-r * 0.25, -r * 0.25, r * 0.35, 0, Math.PI * 2);
      ctx.fill();

      // Name text
      const name = ball.name || '';
      const maxWidth = r * 1.6;
      let fontSize = Math.max(8, r * 0.7);
      ctx.font = `bold ${fontSize}px Arial`;
      while (ctx.measureText(name).width > maxWidth && fontSize > 6) {
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

  // ── Main draw loop ──
  let _drawErrors = [];

  function safeDraw(fn, label) {
    try { fn(); }
    catch (e) {
      if (!_drawErrors.includes(label)) _drawErrors.push(label + ': ' + e.message);
    }
  }

  function drawFrame() {
    clear();
    _drawErrors = [];
    safeDraw(drawExitChannel, 'exitCh');
    safeDraw(drawRamps, 'ramps');
    safeDraw(drawContainerFill, 'fill');
    safeDraw(drawBalls, 'balls');
    safeDraw(drawContainerRing, 'ring');

    // Debug: show errors on canvas
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

  return { init, resize, drawFrame, getSize, setLidSealed, setEntryOpen };
})();
