/**
 * physics.js — Matter.js 物理引擎：圓形邊界、亂流、出球機制
 */
const Physics = (() => {
  const { Engine, World, Bodies, Body } = Matter;

  // ───────────── 碰撞分類遮罩 ─────────────
  // Matter.js 碰撞篩選：球體、牆壁、出球中球體各一個 bit，透過 mask 控制誰與誰碰撞

  const CAT_BALL = 0x0001;     // 普通球體
  const CAT_WALL = 0x0002;     // 牆壁（圓弧段、出口管壁、閘門）
  const CAT_EXITING = 0x0004;  // 正在被彈出的球體（只與出口管壁碰撞）

  // ── 背景圖 RWD 定位參數 ──
  // 背景圖原始尺寸（background.png），用於計算 background-size: cover 後的實際顯示位置
  const BG_W = 1344;
  const BG_H = 768;

  // 容器錨點：背景圖中圓形容器中心的相對位置（0~1 比例）
  const ANCHOR_X = 0.642;
  const ANCHOR_Y = 0.548;
  const RADIUS_RATIO = 0.270;  // 容器半徑佔背景圖高度的比例

  // 右側中籤面板寬度（需與 CSS #winner-panel width 一致）
  const RIGHT_PANEL_WIDTH = 240;

  // ── 圓弧牆參數 ──
  const WALL_SEGMENTS = 90;   // 圓形容器由 90 個矩形段組成
  const WALL_THICKNESS = 20;  // 每段牆壁厚度（px）
  const EXIT_GAP_MARGIN = 24; // 出口間隙額外留白（考慮牆壁厚度 + 旋轉佔位）

  // ── 亂流物理參數（噴泉式雙渦流系統）──
  const VORTEX_OFFSET_RATIO = 0.35;   // 左右渦流中心偏移量（佔半徑比例）
  const VORTEX_BLEND_RATIO = 0.1;     // 左右渦流混合過渡區寬度比例
  const SWIRL_BASE_STRENGTH = 0.0025; // 渦流基礎力量
  const FOUNTAIN_BASE_STRENGTH = 0.0035; // 底部噴泉向上推力基礎值
  const NOISE_TIME_SCALE = 0.006;     // Perlin-like 噪音時間縮放
  const BURST_PROBABILITY = 0.008;    // 每幀隨機爆發力觸發機率
  const BURST_FORCE_MIN = 0.005;      // 爆發力最小值
  const BURST_FORCE_RANGE = 0.005;    // 爆發力隨機範圍
  const CENTERING_EDGE_RATIO = 0.85;  // 居中力啟動閾值（離中心超過此比例時推回）
  const CENTERING_STRENGTH = 0.003;   // 居中推力強度
  const TURBULENCE_SPEED_LIMIT = 12;  // 亂流中球體最大速度

  // ── 出球引導力參數 ──
  // 球體被彈出時依序經歷 rising → entering → upChannel → hasExited 四階段
  const RISING_SPEED_LIMIT = 6;       // rising 階段速度上限
  const RISING_FORCE_BASE = 0.004;    // rising 向上力初始值
  const RISING_FORCE_RAMP = 0.004;    // rising 向上力隨時間增加量
  const RISING_HORZ_BASE = 0.0003;    // rising 水平對準力初始值
  const RISING_HORZ_RAMP = 0.0005;    // rising 水平對準力隨時間增加量
  const RISING_RAMP_DURATION = 2000;  // rising 力量斜坡持續時間（ms）
  const CHANNEL_FORCE_HORZ = 0.001;   // 出口管內水平校正力
  const CHANNEL_FORCE_UP = 0.006;     // 出口管內向上推力

  // ── 邊界強制修正 ──
  const BOUNDARY_HARD_RATIO = 0.92;      // 超過此比例半徑時強制拉回
  const BOUNDARY_TELEPORT_RATIO = 0.8;   // 拉回後放到此比例位置
  const RESCUE_THRESHOLD_RATIO = 0.9;    // 封閉後超出此範圍的球視為逃脫，傳送回中心

  // ── 球體生成 ──
  const BALL_SPAWN_INTERVAL = 80;        // 每顆球生成間隔（ms）

  // ───────────── 模組狀態 ─────────────

  let engine, world;
  let containerCenter = { x: 0, y: 0 };
  let containerRadius = 0;
  let exitGapHalfAngle = 0;
  let entryGapHalfAngle = 0;
  let entryAngle = Math.PI;
  let balls = [];
  let wallBodies = [];
  let entryGateBodies = [];
  let lidBodies = [];
  let containerSealed = false;
  let exitChannel = { x: 0, topY: 0, bottomY: 0, width: 46 };
  let configBallRadius = 24;
  let turbulenceActive = false;
  let turbulenceTime = 0;
  let swirlMultiplier = 1.0;
  let exitGateBody = null;
  let gateTimers = [];
  let ballCreationInterval = null;

  // ───────────── 工具函式 ─────────────

  /** 將角度正規化至 [0, 2π) 範圍 */
  function normalizeAngle(angle) {
    return ((angle % (2 * Math.PI)) + 2 * Math.PI) % (2 * Math.PI);
  }

  /** 計算兩個角度之間的最短弧度距離（0 ~ π） */
  function angularDistance(a, b) {
    let d = Math.abs(normalizeAngle(a) - normalizeAngle(b));
    return d > Math.PI ? 2 * Math.PI - d : d;
  }

  /** 限制球體速度不超過上限值，超過時等比例縮放速度向量 */
  function limitSpeed(ball, maxSpeed) {
    const speed = Math.sqrt(ball.velocity.x ** 2 + ball.velocity.y ** 2);
    if (speed > maxSpeed) {
      const scale = maxSpeed / speed;
      Body.setVelocity(ball, {
        x: ball.velocity.x * scale,
        y: ball.velocity.y * scale
      });
    }
  }

  // ───────────── 初始化 ─────────────

  /** 建立 Matter.js 物理引擎實例，設定重力與迭代精度 */
  function init() {
    engine = Engine.create({
      gravity: { x: 0, y: 1, scale: 0.001 },
      positionIterations: 10,
      velocityIterations: 10
    });
    world = engine.world;
  }

  // ───────────── 版面配置 ─────────────

  /**
   * 根據 Canvas 尺寸計算容器位置、半徑，並建構所有物理牆壁。
   * 使用 background-size:cover 數學公式讓容器位置對齊背景圖中的目標區域。
   */
  function layout(canvasW, canvasH) {
    World.clear(world, false);
    balls = [];
    wallBodies = [];
    entryGateBodies = [];
    lidBodies = [];
    containerSealed = false;
    exitGateBody = null;
    gateTimers.forEach(t => clearTimeout(t));
    gateTimers = [];

    // ── RWD: compute container position relative to background image ──
    const vpW = window.innerWidth;
    const vpH = window.innerHeight;
    const bgScale = Math.max(vpW / BG_W, vpH / BG_H);
    const bgDispW = BG_W * bgScale;
    const bgDispH = BG_H * bgScale;
    const bgOffX = (vpW - bgDispW) / 2;
    const bgOffY = (vpH - bgDispH) / 2;

    const canvasOffX = vpW - canvasW - RIGHT_PANEL_WIDTH;

    let cx = bgOffX + ANCHOR_X * bgDispW - canvasOffX;
    let cy = bgOffY + ANCHOR_Y * bgDispH;
    containerRadius = RADIUS_RATIO * bgDispH;

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

    exitGapHalfAngle = Math.asin((channelWidth / 2 + EXIT_GAP_MARGIN) / containerRadius);
    entryAngle = Math.PI + 0.4;
    entryGapHalfAngle = 0.4;
    exitChannel = {
      x: containerCenter.x,
      topY: containerTop - Math.min(containerRadius * 0.35, 100),
      bottomY: containerTop,
      width: channelWidth
    };

    buildCircularWall();
    buildExitChannelWalls();
    buildEntryGate();
    buildExitGate();
  }

  // ───────────── 弧牆段建構器 ─────────────

  /**
   * 在指定角度建立一個矩形牆壁段（用於組成圓形容器、閘門、蓋子）。
   * @param {number} angle - 弧度位置（圓心出發）
   * @param {string} label - 物體標籤（用於除錯辨識）
   * @param {number} collisionMask - 碰撞遮罩（決定與哪些分類碰撞）
   */
  function createWallSegment(angle, label, collisionMask) {
    const segLen = (2 * Math.PI * containerRadius) / WALL_SEGMENTS;
    const x = containerCenter.x + containerRadius * Math.cos(angle);
    const y = containerCenter.y + containerRadius * Math.sin(angle);
    return Bodies.rectangle(x, y, segLen + 6, WALL_THICKNESS, {
      isStatic: true,
      angle: angle + Math.PI / 2,
      collisionFilter: { category: CAT_WALL, mask: collisionMask },
      label
    });
  }

  // ───────────── 圓形容器牆壁 ─────────────

  /** 建構圓形容器壁（90 段弧牆），跳過出口（頂部）與入口（左側）間隙 */
  function buildCircularWall() {
    const exitCenter = 3 * Math.PI / 2;

    for (let i = 0; i < WALL_SEGMENTS; i++) {
      const angle = (2 * Math.PI * i) / WALL_SEGMENTS;
      if (angularDistance(angle, exitCenter) < exitGapHalfAngle) continue;
      if (angularDistance(angle, entryAngle) < entryGapHalfAngle) continue;

      wallBodies.push(createWallSegment(angle, 'wall', CAT_BALL | CAT_EXITING));
    }
    World.add(world, wallBodies);
  }

  // ───────────── 出口管牆壁 ─────────────

  /**
   * 建構出口管（容器頂部延伸的垂直管道）。
   * 含左右兩側管壁 + channelStopper（只擋普通球，防止亂流中飄入出口管）。
   */
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

    const stopper = Bodies.rectangle(exitChannel.x, exitChannel.bottomY, exitChannel.width + 16, 8, {
      isStatic: true,
      collisionFilter: { category: CAT_WALL, mask: CAT_BALL },
      label: 'channelStopper'
    });

    World.add(world, [leftWall, rightWall, stopper]);
  }

  // ───────────── 入口閘門 ─────────────

  /** 建構入口閘門段（封住左側入口，球體入筒後用來關閉入口） */
  function buildEntryGate() {
    for (let i = 0; i < WALL_SEGMENTS; i++) {
      const angle = (2 * Math.PI * i) / WALL_SEGMENTS;
      if (angularDistance(angle, entryAngle) >= entryGapHalfAngle) continue;

      entryGateBodies.push(createWallSegment(angle, 'entryGate', CAT_BALL | CAT_EXITING));
    }
    World.add(world, entryGateBodies);
  }

  // ───────────── 出口閘門（出口管頂部橫桿） ─────────────

  /** 建構出口閘門（出口管入口處的橫桿），抽籤時開啟、出球後關閉 */
  function buildExitGate() {
    if (exitGateBody) return;
    exitGateBody = Bodies.rectangle(
      exitChannel.x, exitChannel.topY, exitChannel.width + 16, 8,
      {
        isStatic: true,
        collisionFilter: { category: CAT_WALL, mask: CAT_EXITING },
        label: 'exitGate'
      }
    );
    World.add(world, exitGateBody);
  }

  /** 移除出口閘門，讓球體可通過出口管 */
  function openExitGate() {
    if (exitGateBody) {
      World.remove(world, exitGateBody);
      exitGateBody = null;
    }
  }

  /** 關閉出口閘門（若不存在則重新建立） */
  function closeExitGate() {
    if (!exitGateBody) buildExitGate();
  }

  function isExitGateClosed() {
    return exitGateBody !== null;
  }

  // ───────────── 球體生成 ─────────────

  /**
   * 依序生成所有球體（每 80ms 一顆），球體從容器內部上方落下。
   * @param {string[]} names - 參與者名字陣列
   * @param {number} ballRadius - 球體半徑
   * @param {Function} onAllCreated - 全部球體建立完成後的回呼
   */
  function createBalls(names, ballRadius, onAllCreated) {
    balls = [];
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
      ball.name = names[idx];
      ball.ballRadius = ballRadius;
      ball.seed = Math.random() * 1000;
      balls.push(ball);
      World.add(world, [ball]);
      idx++;
    }, BALL_SPAWN_INTERVAL);

    return balls;
  }

  // ───────────── 容器封閉 ─────────────

  /**
   * 封閉容器：關閉入口閘門 + 補上頂部蓋子段（只留出口管開口）。
   * 同時調整球體物理參數，並救回任何逃出容器的球體。
   */
  function sealContainer() {
    engine.gravity.scale = 0.001;
    balls.forEach(ball => {
      ball.friction = 0.1;
      ball.frictionAir = 0.01;
      ball.restitution = 0.4;
    });

    if (entryGateBodies.length === 0) buildEntryGate();

    // Seal top gap (lid segments, leaving only exit channel opening)
    if (lidBodies.length === 0) {
      const exitCenter = 3 * Math.PI / 2;
      const exitHalfAngle = Math.asin((exitChannel.width / 2 + 10) / containerRadius);

      for (let i = 0; i < WALL_SEGMENTS; i++) {
        const angle = (2 * Math.PI * i) / WALL_SEGMENTS;
        const distFromTop = angularDistance(angle, exitCenter);
        if (distFromTop >= exitGapHalfAngle) continue;
        if (distFromTop < exitHalfAngle) continue;

        lidBodies.push(createWallSegment(angle, 'lid', CAT_BALL | CAT_EXITING));
      }
      World.add(world, lidBodies);
    }

    containerSealed = true;
    rescueEscapedBalls();
  }

  /** 將逃出容器邊界的球體傳送回容器中心附近隨機位置 */
  function rescueEscapedBalls() {
    const safeRadius = containerRadius * 0.7;
    balls.forEach(ball => {
      if (ball.isExiting || ball.hasExited) return;
      const dx = ball.position.x - containerCenter.x;
      const dy = ball.position.y - containerCenter.y;
      const dist = Math.sqrt(dx * dx + dy * dy);

      if (dist > containerRadius * RESCUE_THRESHOLD_RATIO) {
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

  // ───────────── 亂流系統（噴泉式雙渦流） ─────────────

  /**
   * 啟動亂流：關閉重力，給每顆球隨機初速度，降低空氣阻力、提高彈性。
   * 之後由 applyTurbulence() 在每幀施加渦流力、噪音力、爆發力、居中力、噴泉力。
   */
  function startTurbulence() {
    turbulenceActive = true;
    turbulenceTime = 0;
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

  /** 停止亂流：恢復重力與球體原始物理屬性 */
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

  // ── 亂流子力計算函式 ──

  /**
   * 計算雙渦流切線力：左側逆時針 + 右側順時針，中間線性混合。
   * 底部往上吹、頂部分流左右，形成噴泉式氣流。
   */
  function calcVortexForce(ballX, ballY, ccx, ccy, R) {
    const vortexOffsetX = R * VORTEX_OFFSET_RATIO;
    const dx = ballX - ccx;
    const strength = SWIRL_BASE_STRENGTH * swirlMultiplier;

    const vdxL = ballX - (ccx - vortexOffsetX);
    const vdyL = ballY - ccy;
    const vdistL = Math.sqrt(vdxL * vdxL + vdyL * vdyL) || 1;
    const txL = (vdyL / vdistL) * strength;
    const tyL = (-vdxL / vdistL) * strength;

    const vdxR = ballX - (ccx + vortexOffsetX);
    const vdyR = ballY - ccy;
    const vdistR = Math.sqrt(vdxR * vdxR + vdyR * vdyR) || 1;
    const txR = (-vdyR / vdistR) * strength;
    const tyR = (vdxR / vdistR) * strength;

    const blendWidth = R * VORTEX_BLEND_RATIO;
    const blend = Math.min(1, Math.max(0, (dx + blendWidth) / (2 * blendWidth)));
    return {
      x: txL * (1 - blend) + txR * blend,
      y: tyL * (1 - blend) + tyR * blend
    };
  }

  /** 計算 Perlin-like 噪音擾動力，讓球體運動更隨機不規律 */
  function calcNoiseForce(seed) {
    const t = turbulenceTime * NOISE_TIME_SCALE * swirlMultiplier;
    const mul = swirlMultiplier;
    return {
      x: (Math.sin(t + seed) * Math.cos(t * 1.7 + seed * 0.7) * 0.002
         + Math.sin(t * 2.3 + seed * 1.5) * 0.001) * mul,
      y: (Math.cos(t * 1.1 + seed * 1.2) * Math.sin(t * 1.9 + seed) * 0.002
         + Math.cos(t * 2.7 + seed * 0.8) * 0.001) * mul
    };
  }

  /** 計算隨機爆發力（低機率觸發），模擬氣流突然變化 */
  function calcBurstForce() {
    if (Math.random() >= BURST_PROBABILITY * swirlMultiplier) return { x: 0, y: 0 };
    const angle = Math.random() * Math.PI * 2;
    const force = (BURST_FORCE_MIN + Math.random() * BURST_FORCE_RANGE) * swirlMultiplier;
    return { x: Math.cos(angle) * force, y: Math.sin(angle) * force };
  }

  /** 計算居中推力：球體靠近容器邊緣時向中心推回，避免卡牆 */
  function calcCenteringForce(nx, ny, dist) {
    const edgeRatio = dist / (containerRadius * CENTERING_EDGE_RATIO);
    if (edgeRatio <= 1) return { x: 0, y: 0 };
    const push = (edgeRatio - 1) * CENTERING_STRENGTH;
    return { x: -nx * push, y: -ny * push };
  }

  /** 計算噴泉向上力：僅作用於容器下半部，力量隨深度線性增強 */
  function calcFountainForce(ballY, ccy, R) {
    const belowCenter = ballY - ccy;
    if (belowCenter <= 0) return 0;
    const ratio = Math.min(belowCenter / R, 1);
    return -ratio * FOUNTAIN_BASE_STRENGTH * swirlMultiplier;
  }

  /**
   * 每幀對所有普通球體施加亂流合力（渦流 + 噪音 + 爆發 + 居中 + 噴泉），
   * 並限制最大速度。出球中的球體（isExiting）不受亂流影響。
   */
  function applyTurbulence(delta) {
    if (!turbulenceActive) return;
    turbulenceTime += delta;

    const ccx = containerCenter.x;
    const ccy = containerCenter.y;
    const R = containerRadius;

    balls.forEach(ball => {
      if (ball.isExiting) return;
      const dx = ball.position.x - ccx;
      const dy = ball.position.y - ccy;
      const dist = Math.sqrt(dx * dx + dy * dy);
      if (dist < 1) return;

      const nx = dx / dist;
      const ny = dy / dist;

      const vortex = calcVortexForce(ball.position.x, ball.position.y, ccx, ccy, R);
      const noise = calcNoiseForce(ball.seed);
      const burst = calcBurstForce();
      const centering = calcCenteringForce(nx, ny, dist);
      const fountainY = calcFountainForce(ball.position.y, ccy, R);

      Body.applyForce(ball, ball.position, {
        x: vortex.x + noise.x + centering.x + burst.x,
        y: vortex.y + noise.y + centering.y + burst.y + fountainY
      });

      limitSpeed(ball, TURBULENCE_SPEED_LIMIT);
    });
  }

  // ───────────── 出球機制 ─────────────

  /**
   * 選取離出口最近的球體並開始彈射流程。
   * 立即切換碰撞遮罩為 CAT_EXITING（只與出口管壁碰撞），
   * 然後由 guideBallToExit() 分階段引導球體通過出口管。
   * @param {Function} callback - 球體成功彈出後回呼，參數為球體名字
   */
  function ejectOneBall(callback) {
    const available = balls.filter(b => !b.isExiting && !b.hasExited);
    if (available.length === 0) {
      if (callback) callback(null);
      return;
    }

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
    ball.collisionFilter = { category: CAT_EXITING, mask: CAT_WALL };
    ball.frictionAir = 0.02;
    guideBallToExit(ball, callback);
  }

  /**
   * 引導球體通過出口管（四階段）：
   *  1. rising — 向出口施加上升力 + 水平對準力（力量隨時間漸增）
   *  2. entering — 進入出口管入口範圍，施加管內引導力
   *  3. upChannel — 在管道內向上推進
   *  4. hasExited — 超過管頂即視為已出，移除物理體並回呼
   */
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
        const timeFactor = Math.min(ball.exitTimer / RISING_RAMP_DURATION, 1);
        Body.applyForce(ball, pos, {
          x: (exitChannel.x - pos.x) * (RISING_HORZ_BASE + timeFactor * RISING_HORZ_RAMP),
          y: -(RISING_FORCE_BASE + timeFactor * RISING_FORCE_RAMP)
        });
        limitSpeed(ball, RISING_SPEED_LIMIT);

        const dx = pos.x - exitChannel.x;
        const dy = pos.y - enterY;
        if (Math.sqrt(dx * dx + dy * dy) < enterRadius) {
          ball.exitPhase = 'entering';
        }
        return;
      }

      if (ball.exitPhase === 'entering') {
        Body.applyForce(ball, pos, {
          x: (exitChannel.x - pos.x) * CHANNEL_FORCE_HORZ,
          y: -CHANNEL_FORCE_UP
        });
        if (pos.y < enterY - 5) {
          ball.exitPhase = 'upChannel';
        }
        return;
      }

      if (ball.exitPhase === 'upChannel') {
        Body.applyForce(ball, pos, {
          x: (exitChannel.x - pos.x) * CHANNEL_FORCE_HORZ,
          y: -CHANNEL_FORCE_UP
        });
        if (pos.y < exitChannel.topY - 30) {
          ball.hasExited = true;
          clearInterval(ball._steerInterval);
          World.remove(world, ball);
          const idx = balls.indexOf(ball);
          if (idx > -1) balls.splice(idx, 1);
          if (onComplete) onComplete(ball.name);
        }
      }
    }
    ball._steerInterval = setInterval(steer, 16);
  }

  // ───────────── 物理更新主迴圈 ─────────────

  /**
   * 每幀呼叫一次：驅動 Matter.js 引擎 → 施加亂流 → 邊界硬修正。
   * 邊界修正：若球體穿過圓弧牆（超過 92% 半徑），強制拉回並消除徑向速度。
   */
  function update(delta) {
    Engine.update(engine, delta);
    applyTurbulence(delta);

    if (containerSealed) {
      balls.forEach(ball => {
        if (ball.isExiting || ball.hasExited) return;
        const dx = ball.position.x - containerCenter.x;
        const dy = ball.position.y - containerCenter.y;
        const dist = Math.sqrt(dx * dx + dy * dy);

        if (dist > containerRadius * BOUNDARY_HARD_RATIO) {
          const nx = dx / dist;
          const ny = dy / dist;
          Body.setPosition(ball, {
            x: containerCenter.x + nx * containerRadius * BOUNDARY_TELEPORT_RATIO,
            y: containerCenter.y + ny * containerRadius * BOUNDARY_TELEPORT_RATIO
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

  /** 清理所有計時器（球體生成、閘門延遲、出球引導），供重置時呼叫 */
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

  // ───────────── 公開介面 ─────────────

  return {
    init, layout, getEngine: () => engine,
    createBalls, sealContainer,
    startTurbulence, stopTurbulence, ejectOneBall,
    openExitGate, closeExitGate, isExitGateClosed,
    setSwirlMultiplier(v) { swirlMultiplier = v; },
    setBallRadius(r) { configBallRadius = r; },
    update, cleanup,
    getBalls: () => balls,
    getContainerCenter: () => containerCenter,
    getContainerRadius: () => containerRadius,
    getExitGapHalfAngle: () => exitGapHalfAngle,
    getEntryGapHalfAngle: () => entryGapHalfAngle,
    getEntryAngle: () => entryAngle,
    getExitChannel: () => exitChannel,
    getEntryGateBodies: () => entryGateBodies,
    isContainerSealed: () => containerSealed,
    isTurbulenceActive: () => turbulenceActive,
    getSwirlMultiplier: () => swirlMultiplier,
    // 導出常數供 renderer.js 風場粒子使用
    VORTEX_OFFSET_RATIO, VORTEX_BLEND_RATIO, FOUNTAIN_BASE_STRENGTH,
    CAT_BALL, CAT_WALL, CAT_EXITING
  };
})();
