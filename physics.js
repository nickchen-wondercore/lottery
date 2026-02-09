/**
 * physics.js — Matter.js 物理引擎：圓形邊界、Z字斜坡、亂流、出球機制
 */
const Physics = (() => {
  const { Engine, World, Bodies, Body } = Matter;

  let engine, world;
  let containerCenter = { x: 0, y: 0 };
  let containerRadius = 0;
  let exitGapHalfAngle = 0;   // top gap for exit channel
  let entryGapHalfAngle = 0;  // entry gap half angle
  let entryAngle = Math.PI;   // angle of entry gap center (updated in layout)
  let balls = [];
  let wallBodies = [];
  let rampBodies = [];         // 3 ramp bodies
  let rampGeoms = [];          // 3 ramp geometries {high, low, angle, length}
  let rampGates = [];          // gate at low end of each ramp
  let rampEndWalls = [];       // wall at high end of topmost ramp only
  let transitionWalls = [];    // vertical channel walls between ramps
  let transitionGeoms = [];    // transition geometry for rendering [{x, topY, botY, halfW}]
  let rampCeilings = [];       // ceiling bodies forming tubes above ramps
  let entryGateBodies = [];    // arc segments covering left entry gap
  let lidBodies = [];          // arc segments sealing top gap
  let containerSealed = false;
  let exitChannel = { x: 0, topY: 0, bottomY: 0, width: 46 };
  let configBallRadius = 24;
  let turbulenceActive = false;
  let turbulenceTime = 0;
  let turbulenceDirection = 1;
  let swirlMultiplier = 1.0;
  let drawingQueue = [];
  let onBallExited = null;
  let exitGateBody = null;
  let gateTimers = [];
  let ballCreationInterval = null;

  const CAT_BALL = 0x0001;
  const CAT_WALL = 0x0002;
  const CAT_EXITING = 0x0004;

  function init() {
    engine = Engine.create({
      gravity: { x: 0, y: 1, scale: 0.001 },
      positionIterations: 10,
      velocityIterations: 10
    });
    world = engine.world;
  }

  function getEngine() { return engine; }

  // ───────────── Layout ─────────────

  function layout(canvasW, canvasH) {
    World.clear(world, false);
    balls = [];
    wallBodies = [];
    rampBodies = [];
    rampGeoms = [];
    rampGates = [];
    rampEndWalls = [];
    transitionWalls = [];
    transitionGeoms = [];
    rampCeilings = [];
    entryGateBodies = [];
    lidBodies = [];
    containerSealed = false;
    exitGateBody = null;
    gateTimers.forEach(t => clearTimeout(t));
    gateTimers = [];

    // ── RWD: compute container position relative to background image ──
    // Background image (1344×768) is rendered via CSS background-size:cover + center center.
    // We replicate that math to map an anchor point in the image to screen coords.
    const BG_W = 1344, BG_H = 768;
    const vpW = window.innerWidth;
    const vpH = window.innerHeight;
    const bgScale = Math.max(vpW / BG_W, vpH / BG_H);
    const bgDispW = BG_W * bgScale;
    const bgDispH = BG_H * bgScale;
    const bgOffX = (vpW - bgDispW) / 2;
    const bgOffY = (vpH - bgDispH) / 2;

    // Anchor: container center position in the original image (ratio 0-1)
    const ANCHOR_X = 0.642;   // horizontally aligned with WONDERCORE text
    const ANCHOR_Y = 0.548;   // vertically below WONDERCORE
    const RADIUS_R = 0.270;   // radius as ratio of displayed image height

    // Canvas is offset from viewport left by the names-panel
    // Right panel (winner-panel) is 240px; left panel = remainder
    const canvasOffX = vpW - canvasW - 240;

    let cx = bgOffX + ANCHOR_X * bgDispW - canvasOffX;
    let cy = bgOffY + ANCHOR_Y * bgDispH;
    containerRadius = RADIUS_R * bgDispH;

    // Clamp: ensure container fits within canvas
    const margin = 15;
    const maxR = Math.min((canvasW - margin * 2) / 2, (canvasH - margin * 2) / 2);
    containerRadius = Math.min(containerRadius, maxR);
    cx = Math.max(containerRadius + margin, Math.min(cx, canvasW - containerRadius - margin));
    cy = Math.max(containerRadius + margin, Math.min(cy, canvasH - containerRadius - margin));
    containerCenter = { x: cx, y: cy };

    // Exit channel — vertical tube above container
    const containerTop = containerCenter.y - containerRadius;
    const channelWidth = Math.max(30, configBallRadius * 2 + 8);

    // Two gaps in container wall (exit gap accounts for ball radius + wall thickness 20px)
    exitGapHalfAngle = Math.asin((channelWidth / 2 + 24) / containerRadius);
    entryAngle = Math.PI + 0.4;        // upper-left entry (no gap below center-left)
    entryGapHalfAngle = 0.4;           // entry gap spans from π to π+0.8
    exitChannel = {
      x: containerCenter.x,
      topY: containerTop - Math.min(containerRadius * 0.35, 100),
      bottomY: containerTop,
      width: channelWidth
    };

    buildCircularWall();
    buildExitChannelWalls();
    buildEntryGate();
    // Ramps removed — balls drop directly into container from above
    buildExitGate();
  }

  // ───────────── Circular wall (two gaps: top + left) ─────────────

  function buildCircularWall() {
    const segments = 90;
    const segLen = (2 * Math.PI * containerRadius) / segments;
    const thickness = 20;

    for (let i = 0; i < segments; i++) {
      const angle = (2 * Math.PI * i) / segments;
      const normAngle = ((angle % (2 * Math.PI)) + 2 * Math.PI) % (2 * Math.PI);

      // Skip top gap (exit channel) — centered at 3π/2
      let distFromTop = Math.abs(normAngle - (3 * Math.PI / 2));
      if (distFromTop > Math.PI) distFromTop = 2 * Math.PI - distFromTop;
      if (distFromTop < exitGapHalfAngle) continue;

      // Skip entry gap — centered at entryAngle (upper-left)
      let distFromEntry = Math.abs(normAngle - entryAngle);
      if (distFromEntry > Math.PI) distFromEntry = 2 * Math.PI - distFromEntry;
      if (distFromEntry < entryGapHalfAngle) continue;

      const x = containerCenter.x + containerRadius * Math.cos(angle);
      const y = containerCenter.y + containerRadius * Math.sin(angle);

      const seg = Bodies.rectangle(x, y, segLen + 6, thickness, {
        isStatic: true,
        angle: angle + Math.PI / 2,
        collisionFilter: { category: CAT_WALL, mask: CAT_BALL | CAT_EXITING },
        label: 'wall'
      });
      wallBodies.push(seg);
    }
    World.add(world, wallBodies);
  }

  // ───────────── Exit channel walls ─────────────

  function buildExitChannelWalls() {
    const halfW = exitChannel.width / 2;
    const height = exitChannel.bottomY - exitChannel.topY;
    const midY = (exitChannel.topY + exitChannel.bottomY) / 2;

    const leftWall = Bodies.rectangle(exitChannel.x - halfW - 4, midY, 8, height, {
      isStatic: true,
      collisionFilter: { category: CAT_WALL, mask: CAT_EXITING },
      label: 'exitWall'
    });
    const rightWall = Bodies.rectangle(exitChannel.x + halfW + 4, midY, 8, height, {
      isStatic: true,
      collisionFilter: { category: CAT_WALL, mask: CAT_EXITING },
      label: 'exitWall'
    });

    // Stopper at channel entrance: blocks normal balls from floating into the tube,
    // but exiting balls (CAT_EXITING) pass through
    const stopper = Bodies.rectangle(exitChannel.x, exitChannel.bottomY, exitChannel.width + 16, 8, {
      isStatic: true,
      collisionFilter: { category: CAT_WALL, mask: CAT_BALL },
      label: 'channelStopper'
    });

    World.add(world, [leftWall, rightWall, stopper]);
  }

  // ───────────── Entry gate (arc segments covering left gap) ─────────────

  function buildEntryGate() {
    const segments = 90;
    const segLen = (2 * Math.PI * containerRadius) / segments;
    const thickness = 20;

    for (let i = 0; i < segments; i++) {
      const angle = (2 * Math.PI * i) / segments;
      const normAngle = ((angle % (2 * Math.PI)) + 2 * Math.PI) % (2 * Math.PI);

      let distFromEntry = Math.abs(normAngle - entryAngle);
      if (distFromEntry > Math.PI) distFromEntry = 2 * Math.PI - distFromEntry;

      // Only create in the entry gap area
      if (distFromEntry >= entryGapHalfAngle) continue;

      const x = containerCenter.x + containerRadius * Math.cos(angle);
      const y = containerCenter.y + containerRadius * Math.sin(angle);

      const seg = Bodies.rectangle(x, y, segLen + 6, thickness, {
        isStatic: true,
        angle: angle + Math.PI / 2,
        collisionFilter: { category: CAT_WALL, mask: CAT_BALL | CAT_EXITING },
        label: 'entryGate'
      });
      entryGateBodies.push(seg);
    }
    World.add(world, entryGateBodies);
  }

  // ───────────── Exit gate (top of exit channel) ─────────────

  function buildExitGate() {
    if (exitGateBody) return;
    exitGateBody = Bodies.rectangle(
      exitChannel.x,
      exitChannel.topY,
      exitChannel.width + 16,
      8,
      {
        isStatic: true,
        collisionFilter: { category: CAT_WALL, mask: CAT_EXITING },
        label: 'exitGate'
      }
    );
    World.add(world, exitGateBody);
  }

  function openExitGate() {
    if (exitGateBody) {
      World.remove(world, exitGateBody);
      exitGateBody = null;
    }
  }

  function closeExitGate() {
    if (!exitGateBody) {
      buildExitGate();
    }
  }

  function isExitGateClosed() {
    return exitGateBody !== null;
  }

  // ───────────── Z-shaped zigzag ramps (left side) ─────────────

  function buildRamps(canvasW, canvasH) {
    const rampXLeft = canvasW * 0.04;

    // Compute entry point on container from entryAngle
    const eX = containerCenter.x + containerRadius * Math.cos(entryAngle);
    const eY = containerCenter.y + containerRadius * Math.sin(entryAngle);
    const rampXRight = eX - 5;

    const rampAngle = 0.15; // ~8.6°
    const vertGap = 45;     // vertical gap between ramp levels (wider = less jamming)

    // Work backwards from container entry point
    const entryY = eY;

    // Ramp 3 (bottom, left→right into container)
    const r3Low  = { x: rampXRight, y: entryY };
    const r3High = { x: rampXLeft,  y: entryY - (rampXRight - rampXLeft) * Math.tan(rampAngle) };

    // Ramp 2 (middle, right→left)
    const r2LowY = r3High.y - vertGap;
    const r2Low  = { x: rampXLeft,  y: r2LowY };
    const r2High = { x: rampXRight, y: r2LowY - (rampXRight - rampXLeft) * Math.tan(rampAngle) };

    // Ramp 1 (top, left→right)
    const r1LowY = r2High.y - vertGap;
    const r1Low  = { x: rampXRight, y: r1LowY };
    const r1High = { x: rampXLeft,  y: r1LowY - (rampXRight - rampXLeft) * Math.tan(rampAngle) };

    const defs = [
      { high: r1High, low: r1Low,  angle:  rampAngle }, // slopes right ↘
      { high: r2High, low: r2Low,  angle: -rampAngle }, // slopes left  ↙
      { high: r3High, low: r3Low,  angle:  rampAngle }  // slopes right ↘
    ];

    const tubeHeight = 70;  // internal height of tube (fits ~2 balls stacked)
    const ceilThick = 10;

    defs.forEach((def, idx) => {
      const cx = (def.high.x + def.low.x) / 2;
      const cy = (def.high.y + def.low.y) / 2;
      const len = Math.sqrt((def.low.x - def.high.x) ** 2 + (def.low.y - def.high.y) ** 2);

      // Ramp floor (bottom of tube)
      const rampBody = Bodies.rectangle(cx, cy, len, 10, {
        isStatic: true,
        angle: def.angle,
        collisionFilter: { category: CAT_WALL, mask: CAT_BALL },
        label: 'ramp'
      });
      rampBodies.push(rampBody);
      rampGeoms.push({ ...def, length: len });

      // End wall at high end — tall enough to match tube height
      const ewH = tubeHeight + 20;
      const ewOff = tubeHeight / 2;
      const ewX = def.high.x + (def.angle > 0 ? -8 : 8);
      const endWall = Bodies.rectangle(ewX, def.high.y - ewOff, 8, ewH, {
        isStatic: true,
        collisionFilter: { category: CAT_WALL, mask: CAT_BALL },
        label: 'endWall'
      });
      rampEndWalls.push(endWall);

      // Gate at low end — tall enough to match tube height
      const gX = def.low.x + (def.angle > 0 ? 8 : -8);
      const gate = Bodies.rectangle(gX, def.low.y - tubeHeight / 2, 10, tubeHeight + 10, {
        isStatic: true,
        collisionFilter: { category: CAT_WALL, mask: CAT_BALL },
        label: 'gate'
      });
      rampGates.push(gate);

      // Tube ceiling — parallel to ramp floor, offset perpendicular (upward)
      const normalX = -Math.sin(def.angle);
      const normalY = -Math.cos(def.angle);
      const perpOffset = 5 + tubeHeight + ceilThick / 2;

      // Direction along ramp (high → low)
      const dirX = (def.low.x - def.high.x) / len;
      const dirY = (def.low.y - def.high.y) / len;

      // Ceiling covers 92% of ramp, shifted toward low end (8% opening at high end for ball entry)
      const ceilLen = len * 0.92;
      const shiftAmount = len * 0.04;

      const ceilCx = cx + normalX * perpOffset + dirX * shiftAmount;
      const ceilCy = cy + normalY * perpOffset + dirY * shiftAmount;

      const ceiling = Bodies.rectangle(ceilCx, ceilCy, ceilLen, ceilThick, {
        isStatic: true,
        angle: def.angle,
        collisionFilter: { category: CAT_WALL, mask: CAT_BALL },
        label: 'rampCeiling'
      });
      rampCeilings.push(ceiling);
    });

    // Transition geometry for visual rendering
    const chHalfW = 35;
    for (let i = 0; i < defs.length - 1; i++) {
      const fromLow = defs[i].low;
      const toHigh = defs[i + 1].high;
      const chX = fromLow.x;
      const topY = fromLow.y;
      const botY = toHigh.y;
      transitionGeoms.push({ x: chX, topY, botY, halfW: chHalfW });

      // Physics walls to guide balls between ramps
      const wallHalfW = 45;
      const height = Math.abs(botY - topY) + 20;
      const midY = (topY + botY) / 2;

      const lw = Bodies.rectangle(chX - wallHalfW, midY, 8, height, {
        isStatic: true,
        collisionFilter: { category: CAT_WALL, mask: CAT_BALL },
        label: 'transitionWall'
      });
      const rw = Bodies.rectangle(chX + wallHalfW, midY, 8, height, {
        isStatic: true,
        collisionFilter: { category: CAT_WALL, mask: CAT_BALL },
        label: 'transitionWall'
      });
      transitionWalls.push(lw, rw);
    }

    World.add(world, [...rampBodies, ...rampEndWalls, ...rampGates, ...transitionWalls, ...rampCeilings]);
  }

  // ───────────── Ball creation ─────────────

  function createBalls(names, ballRadius, onAllCreated) {
    balls = [];

    // Spawn point: inside the container, upper area — balls fall to the bottom
    const spawnX = containerCenter.x;
    const spawnY = containerCenter.y - containerRadius * 0.5;

    let idx = 0;
    ballCreationInterval = setInterval(() => {
      if (idx >= names.length) {
        clearInterval(ballCreationInterval);
        ballCreationInterval = null;
        if (onAllCreated) onAllCreated();
        return;
      }

      const name = names[idx];
      const ball = Bodies.circle(
        spawnX + (Math.random() - 0.5) * containerRadius * 0.8,
        spawnY,
        ballRadius,
        {
          restitution: 0.3,
          friction: 0.05,
          frictionAir: 0.01,
          density: 0.002,
          slop: 0.01,
          collisionFilter: { category: CAT_BALL, mask: CAT_BALL | CAT_WALL },
          label: 'ball'
        }
      );
      ball.name = name;
      ball.ballRadius = ballRadius;
      ball.seed = Math.random() * 1000;
      balls.push(ball);
      World.add(world, [ball]);
      idx++;
    }, 80);

    return balls;
  }

  // ───────────── Gate operations ─────────────

  function openGates(onEntryOpen) {
    // Don't open container entry gate yet — delay until gate 2 opens
    // so balls can't fly directly into the container

    // Boost gravity for realistic free-fall cascade (4x normal)
    engine.gravity.scale = 0.004;

    // Reduce friction for smooth flow — simulate polished ramp
    balls.forEach(ball => {
      ball.friction = 0.01;
      ball.frictionAir = 0.001;
      ball.restitution = 0.3;
    });

    // Stagger gate opening: top → middle → bottom (cascade waterfall)
    const removeGate = (idx) => {
      if (rampGates[idx]) {
        World.remove(world, rampGates[idx]);
        rampGates[idx] = null;
      }
    };

    removeGate(0); // ramp 0 (top) — cascade starts, balls fall to ramp 1
    gateTimers.push(setTimeout(() => removeGate(1), 2500)); // ramp 1 — balls fall to ramp 2
    gateTimers.push(setTimeout(() => {
      removeGate(2); // ramp 2 — balls enter container
      // Now open container entry gate
      entryGateBodies.forEach(b => World.remove(world, b));
      entryGateBodies = [];
      if (onEntryOpen) onEntryOpen();
    }, 5000));
  }

  function sealContainer() {
    // Restore normal gravity and ball properties
    engine.gravity.scale = 0.001;
    balls.forEach(ball => {
      ball.friction = 0.1;
      ball.frictionAir = 0.01;
      ball.restitution = 0.4;
    });

    // Close entry gate (rebuild entry gap wall segments)
    if (entryGateBodies.length === 0) {
      buildEntryGate();
    }

    // Seal top gap (add lid segments leaving only exit channel opening)
    if (lidBodies.length === 0) {
      const segments = 90;
      const segLen = (2 * Math.PI * containerRadius) / segments;
      const thickness = 20;
      const exitHalfAngle = Math.asin((exitChannel.width / 2 + 10) / containerRadius);

      for (let i = 0; i < segments; i++) {
        const angle = (2 * Math.PI * i) / segments;
        const normAngle = ((angle % (2 * Math.PI)) + 2 * Math.PI) % (2 * Math.PI);
        let distFromTop = Math.abs(normAngle - (3 * Math.PI / 2));
        if (distFromTop > Math.PI) distFromTop = 2 * Math.PI - distFromTop;

        if (distFromTop >= exitGapHalfAngle) continue; // already has wall
        if (distFromTop < exitHalfAngle) continue;     // keep exit channel open

        const x = containerCenter.x + containerRadius * Math.cos(angle);
        const y = containerCenter.y + containerRadius * Math.sin(angle);

        const seg = Bodies.rectangle(x, y, segLen + 6, thickness, {
          isStatic: true,
          angle: angle + Math.PI / 2,
          collisionFilter: { category: CAT_WALL, mask: CAT_BALL | CAT_EXITING },
          label: 'lid'
        });
        lidBodies.push(seg);
      }
      World.add(world, lidBodies);
    }

    containerSealed = true;
    rescueEscapedBalls();
  }

  function rescueEscapedBalls() {
    const safeRadius = containerRadius * 0.7;
    balls.forEach(ball => {
      if (ball.isExiting || ball.hasExited) return;
      const dx = ball.position.x - containerCenter.x;
      const dy = ball.position.y - containerCenter.y;
      const dist = Math.sqrt(dx * dx + dy * dy);

      if (dist > containerRadius * 0.9) {
        const randAngle = Math.random() * Math.PI * 2;
        const randDist = Math.random() * safeRadius * 0.6;
        Body.setPosition(ball, {
          x: containerCenter.x + randDist * Math.cos(randAngle),
          y: containerCenter.y + randDist * Math.sin(randAngle)
        });
        Body.setVelocity(ball, { x: 0, y: 0 });
      }
    });
  }

  // ───────────── Turbulence ─────────────

  function startTurbulence() {
    turbulenceActive = true;
    turbulenceTime = 0;
    turbulenceDirection = 1;
    engine.gravity.y = 0;
    engine.gravity.scale = 0;

    balls.forEach(ball => {
      if (ball.isExiting) return;
      const angle = Math.random() * Math.PI * 2;
      const speed = (1.5 + Math.random() * 2) * swirlMultiplier;
      Body.setVelocity(ball, {
        x: Math.cos(angle) * speed,
        y: Math.sin(angle) * speed
      });
      ball.frictionAir = 0.005;
      ball.restitution = 0.9;
    });
  }

  function stopTurbulence() {
    turbulenceActive = false;
    engine.gravity.y = 1;
    engine.gravity.scale = 0.001;
    balls.forEach(ball => {
      if (ball.isExiting) return;
      ball.frictionAir = 0.01;
      ball.restitution = 0.4;
    });
  }

  function applyTurbulence(delta) {
    if (!turbulenceActive) return;
    turbulenceTime += delta;

    const ccx = containerCenter.x;
    const ccy = containerCenter.y;
    const R = containerRadius;

    // Twin-vortex centers (left & right halves)
    const vortexOffsetX = R * 0.35;

    balls.forEach(ball => {
      if (ball.isExiting) return;
      const dx = ball.position.x - ccx;
      const dy = ball.position.y - ccy;
      const dist = Math.sqrt(dx * dx + dy * dy);
      if (dist < 1) return;

      const nx = dx / dist;
      const ny = dy / dist;

      // ── Fountain twin-vortex force ──
      // Left half: counterclockwise (visual, Y-down coords)
      // Right half: clockwise (visual, Y-down coords)
      const swirlStrength = 0.0025 * swirlMultiplier;

      // Left vortex (counterclockwise)
      const vdxL = ball.position.x - (ccx - vortexOffsetX);
      const vdyL = ball.position.y - ccy;
      const vdistL = Math.sqrt(vdxL * vdxL + vdyL * vdyL) || 1;
      const txL = (vdyL / vdistL) * swirlStrength;
      const tyL = (-vdxL / vdistL) * swirlStrength;

      // Right vortex (clockwise)
      const vdxR = ball.position.x - (ccx + vortexOffsetX);
      const vdyR = ball.position.y - ccy;
      const vdistR = Math.sqrt(vdxR * vdxR + vdyR * vdyR) || 1;
      const txR = (-vdyR / vdistR) * swirlStrength;
      const tyR = (vdxR / vdistR) * swirlStrength;

      // Smooth blend near center line to avoid abrupt flip
      const blendWidth = R * 0.1;
      const blend = Math.min(1, Math.max(0, (dx + blendWidth) / (2 * blendWidth)));
      const tx = txL * (1 - blend) + txR * blend;
      const ty = tyL * (1 - blend) + tyR * blend;

      // ── Noise perturbation ──
      const t = turbulenceTime * 0.006 * swirlMultiplier;
      const noiseMul = swirlMultiplier;
      const noiseX = (Math.sin(t + ball.seed) * Math.cos(t * 1.7 + ball.seed * 0.7) * 0.002
                    + Math.sin(t * 2.3 + ball.seed * 1.5) * 0.001) * noiseMul;
      const noiseY = (Math.cos(t * 1.1 + ball.seed * 1.2) * Math.sin(t * 1.9 + ball.seed) * 0.002
                    + Math.cos(t * 2.7 + ball.seed * 0.8) * 0.001) * noiseMul;

      // ── Random burst ──
      let burstX = 0, burstY = 0;
      if (Math.random() < 0.008 * swirlMultiplier) {
        const burstAngle = Math.random() * Math.PI * 2;
        const burstForce = (0.005 + Math.random() * 0.005) * swirlMultiplier;
        burstX = Math.cos(burstAngle) * burstForce;
        burstY = Math.sin(burstAngle) * burstForce;
      }

      // ── Centering force ──
      let cfx = 0, cfy = 0;
      const edgeRatio = dist / (containerRadius * 0.85);
      if (edgeRatio > 1) {
        const pushStrength = (edgeRatio - 1) * 0.003;
        cfx = -nx * pushStrength;
        cfy = -ny * pushStrength;
      }

      // ── Fountain upward force (bottom half only) ──
      let fountainY = 0;
      const belowCenter = ball.position.y - ccy;
      if (belowCenter > 0) {
        // Strength ramps from 0 at center to max at bottom edge
        const ratio = Math.min(belowCenter / R, 1);
        fountainY = -ratio * 0.0035 * swirlMultiplier;
      }

      Body.applyForce(ball, ball.position, {
        x: tx + noiseX + cfx + burstX,
        y: ty + noiseY + cfy + burstY + fountainY
      });

      // ── Speed limiter ──
      const speed = Math.sqrt(ball.velocity.x ** 2 + ball.velocity.y ** 2);
      if (speed > 12) {
        const scale = 12 / speed;
        Body.setVelocity(ball, {
          x: ball.velocity.x * scale,
          y: ball.velocity.y * scale
        });
      }
    });
  }

  // ───────────── Drawing / Ejection ─────────────

  function ejectOneBall(callback) {
    const available = balls.filter(b => !b.isExiting && !b.hasExited);
    if (available.length === 0) {
      if (callback) callback(null);
      return;
    }
    // Pick the ball closest to the exit opening
    const exitX = exitChannel.x;
    const exitY = containerCenter.y - containerRadius;
    available.sort((a, b) => {
      const da = (a.position.x - exitX) ** 2 + (a.position.y - exitY) ** 2;
      const db = (b.position.x - exitX) ** 2 + (b.position.y - exitY) ** 2;
      return da - db;
    });
    const ball = available[0];
    ball.isExiting = true;
    ball.exitPhase = 'rising';
    ball.exitTimer = 0;
    // Immediately switch collision so ball passes through other balls
    ball.collisionFilter = { category: CAT_EXITING, mask: CAT_WALL };
    ball.frictionAir = 0.02;
    guideBallToExit(ball, callback);
  }

  function startDrawing(count, callback) {
    onBallExited = callback;
    const available = balls.filter(b => !b.isExiting && !b.hasExited);
    const toDraw = Math.min(count, available.length);
    const shuffled = available.sort(() => Math.random() - 0.5);
    drawingQueue = shuffled.slice(0, toDraw);
    ejectNext();
  }

  function ejectNext() {
    if (drawingQueue.length === 0) {
      stopTurbulence();
      if (onBallExited) onBallExited(null);
      return;
    }
    const ball = drawingQueue.shift();
    ball.isExiting = true;
    ball.exitPhase = 'rising';
    ball.exitTimer = 0;
    guideBallToExit(ball);
  }

  function guideBallToExit(ball, onComplete) {
    const enterY = containerCenter.y - containerRadius;
    const enterRadius = exitChannel.width * 0.8;

    function steer() {
      if (ball.hasExited) {
        clearInterval(ball._steerInterval);
        return;
      }
      const pos = ball.position;
      ball.exitTimer += 16;

      if (ball.exitPhase === 'rising') {
        // Strong upward buoyancy + horizontal centering toward exit
        const targetX = exitChannel.x;
        const targetY = enterY;
        const dxToExit = targetX - pos.x;
        const dyToExit = targetY - pos.y;

        // Progressive force: starts gentle, ramps up over time
        const timeFactor = Math.min(ball.exitTimer / 2000, 1); // 0→1 over 2s
        const baseUp = 0.004 + timeFactor * 0.004;
        const baseHorz = 0.0003 + timeFactor * 0.0005;

        Body.applyForce(ball, pos, {
          x: dxToExit * baseHorz,
          y: -baseUp
        });

        // Limit speed so ball rises visibly, not flying off
        const speed = Math.sqrt(ball.velocity.x ** 2 + ball.velocity.y ** 2);
        if (speed > 6) {
          const scale = 6 / speed;
          Body.setVelocity(ball, {
            x: ball.velocity.x * scale,
            y: ball.velocity.y * scale
          });
        }

        const dx = pos.x - exitChannel.x;
        const dy = pos.y - enterY;
        const distToHole = Math.sqrt(dx * dx + dy * dy);

        if (distToHole < enterRadius) {
          ball.exitPhase = 'entering';
          return;
        }
      }

      if (ball.exitPhase === 'entering') {
        Body.applyForce(ball, pos, {
          x: (exitChannel.x - pos.x) * 0.001,
          y: -0.006
        });
        if (pos.y < containerCenter.y - containerRadius - 5) {
          ball.exitPhase = 'upChannel';
        }
      }

      if (ball.exitPhase === 'upChannel') {
        Body.applyForce(ball, pos, {
          x: (exitChannel.x - pos.x) * 0.001,
          y: -0.006
        });
        if (pos.y < exitChannel.topY - 30) {
          ball.hasExited = true;
          clearInterval(ball._steerInterval);
          World.remove(world, ball);
          const idx = balls.indexOf(ball);
          if (idx > -1) balls.splice(idx, 1);
          if (onComplete) {
            onComplete(ball.name);
          } else {
            if (onBallExited) onBallExited(ball.name);
            setTimeout(ejectNext, 1000);
          }
        }
      }
    }
    ball._steerInterval = setInterval(steer, 16);
  }

  // ───────────── Update loop ─────────────

  function update(delta) {
    Engine.update(engine, delta);
    applyTurbulence(delta);

    // Hard boundary enforcement after container is sealed
    if (containerSealed) {
      balls.forEach(ball => {
        if (ball.isExiting || ball.hasExited) return;
        const dx = ball.position.x - containerCenter.x;
        const dy = ball.position.y - containerCenter.y;
        const dist = Math.sqrt(dx * dx + dy * dy);

        if (dist > containerRadius * 0.92) {
          const nx = dx / dist;
          const ny = dy / dist;
          Body.setPosition(ball, {
            x: containerCenter.x + nx * containerRadius * 0.8,
            y: containerCenter.y + ny * containerRadius * 0.8
          });
          const vDot = ball.velocity.x * nx + ball.velocity.y * ny;
          if (vDot > 0) {
            Body.setVelocity(ball, {
              x: ball.velocity.x - nx * vDot,
              y: ball.velocity.y - ny * vDot
            });
          }
        }
      });
    }
  }

  function cleanup() {
    if (ballCreationInterval) {
      clearInterval(ballCreationInterval);
      ballCreationInterval = null;
    }
    gateTimers.forEach(t => clearTimeout(t));
    gateTimers = [];
    balls.forEach(b => {
      if (b._steerInterval) clearInterval(b._steerInterval);
    });
  }

  // ───────────── Getters ─────────────

  function setSwirlMultiplier(v) { swirlMultiplier = v; }
  function setBallRadius(r) { configBallRadius = r; }

  function getBalls() { return balls; }
  function getContainerCenter() { return containerCenter; }
  function getContainerRadius() { return containerRadius; }
  function getExitGapHalfAngle() { return exitGapHalfAngle; }
  function getEntryGapHalfAngle() { return entryGapHalfAngle; }
  function getEntryAngle() { return entryAngle; }
  function getExitChannel() { return exitChannel; }
  function getRampBodies() { return rampBodies; }
  function getRampGeoms() { return rampGeoms; }
  function getRampGates() { return rampGates; }
  function getRampEndWalls() { return rampEndWalls; }
  function getTransitionGeoms() { return transitionGeoms; }
  function getEntryGateBodies() { return entryGateBodies; }
  function getRampCeilings() { return rampCeilings; }
  function isContainerSealed() { return containerSealed; }
  function isTurbulenceActive() { return turbulenceActive; }
  function getSwirlMultiplier() { return swirlMultiplier; }

  return {
    init, layout, getEngine, createBalls, openGates, sealContainer,
    startTurbulence, stopTurbulence, startDrawing, ejectOneBall,
    openExitGate, closeExitGate, isExitGateClosed,
    setSwirlMultiplier, setBallRadius, update, cleanup,
    getBalls, getContainerCenter, getContainerRadius,
    getExitGapHalfAngle, getEntryGapHalfAngle, getEntryAngle,
    getExitChannel, getRampBodies, getRampGeoms, getRampGates,
    getRampEndWalls, getTransitionGeoms, getEntryGateBodies, getRampCeilings, isContainerSealed,
    isTurbulenceActive, getSwirlMultiplier,
    CAT_BALL, CAT_WALL, CAT_EXITING
  };
})();
