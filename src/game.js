import {
  clamp,
  enemyProfileForTime,
  normalizeVector,
  spawnIntervalForTime,
} from './game-logic.js';

const STEP = 1 / 60;
const MAX_FRAME_DELTA = 0.05;
const MAX_STEPS_PER_FRAME = 3;
const QUALITY = {
  auto: { pixelRatio: 1.8, effects: 1, adaptive: true },
  high: { pixelRatio: 2.25, effects: 1, adaptive: false },
  balanced: { pixelRatio: 1.5, effects: 0.72, adaptive: false },
  smooth: { pixelRatio: 1.05, effects: 0.48, adaptive: false },
};

function makePool(maxIdle = 320) {
  return {
    free: [],
    take() {
      return this.free.pop() || {};
    },
    release(item) {
      if (this.free.length < maxIdle) this.free.push(item);
    },
  };
}

function removePooled(items, index, pool) {
  const last = items.length - 1;
  const removed = items[index];
  if (index !== last) items[index] = items[last];
  items.pop();
  pool.release(removed);
}

function seedRandom(seed) {
  let value = seed >>> 0;
  return () => {
    value = (value * 1664525 + 1013904223) >>> 0;
    return value / 4294967296;
  };
}

export class NeonGame {
  constructor(canvas, callbacks = {}) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d', { alpha: false, desynchronized: true }) || canvas.getContext('2d');
    this.callbacks = callbacks;
    this.width = 1;
    this.height = 1;
    this.dpr = 1;
    this.quality = 'auto';
    this.adaptiveScale = 1;
    this.phase = 'ready';
    this.lastRun = null;
    this.lastFrameTime = 0;
    this.accumulator = 0;
    this.visualTime = 0;
    this.uiTimer = 0;
    this.fps = 60;
    this.performanceTime = 0;
    this.performanceFrames = 0;
    this.slowWindows = 0;
    this.fastWindows = 0;
    this.destroyed = false;

    this.background = document.createElement('canvas');
    this.backgroundContext = this.background.getContext('2d');
    this.stars = [];
    this.particles = [];
    this.bullets = [];
    this.enemies = [];
    this.pickups = [];
    this.particlePool = makePool(420);
    this.bulletPool = makePool(150);
    this.enemyPool = makePool(60);
    this.pickupPool = makePool(30);

    this.player = this.createPlayer();
    this.run = this.createRun();
    this.spawnTimer = 0.6;
    this.autoAim = true;
    this.input = {
      keys: new Set(),
      aim: { x: 0, y: 0, active: false },
      pointerFiring: false,
      touchFire: false,
      touchMoveX: 0,
      touchMoveY: 0,
      touchControls: false,
      dashRequested: false,
    };

    this.handleResize = () => this.resize();
    this.handleKeyDown = (event) => this.onKeyDown(event);
    this.handleKeyUp = (event) => this.onKeyUp(event);
    this.handlePointerMove = (event) => this.onPointerMove(event);
    this.handlePointerDown = (event) => this.onPointerDown(event);
    this.handlePointerUp = () => { this.input.pointerFiring = false; };
    this.handleBlur = () => {
      this.input.keys.clear();
      this.input.pointerFiring = false;
      this.input.touchFire = false;
      this.input.touchMoveX = 0;
      this.input.touchMoveY = 0;
    };
    this.handleVisibility = () => {
      if (document.hidden) {
        if (this.phase === 'playing') this.pause('visibility');
        this.lastFrameTime = 0;
        this.accumulator = 0;
      } else {
        this.lastFrameTime = 0;
      }
    };

    this.canvas.addEventListener('pointermove', this.handlePointerMove, { passive: true });
    this.canvas.addEventListener('pointerdown', this.handlePointerDown, { passive: true });
    window.addEventListener('pointerup', this.handlePointerUp, { passive: true });
    window.addEventListener('pointercancel', this.handlePointerUp, { passive: true });
    window.addEventListener('keydown', this.handleKeyDown, { passive: false });
    window.addEventListener('keyup', this.handleKeyUp, { passive: true });
    window.addEventListener('blur', this.handleBlur);
    document.addEventListener('visibilitychange', this.handleVisibility);

    if (typeof ResizeObserver !== 'undefined') {
      this.resizeObserver = new ResizeObserver(this.handleResize);
      this.resizeObserver.observe(this.canvas.parentElement || this.canvas);
    } else {
      window.addEventListener('resize', this.handleResize, { passive: true });
    }

    this.resize();
    this.emitStats();
    this.frame = this.frame.bind(this);
    this.rafId = requestAnimationFrame(this.frame);
  }

  createPlayer() {
    return {
      x: this.width / 2,
      y: this.height / 2,
      px: this.width / 2,
      py: this.height / 2,
      radius: 13,
      hp: 100,
      maxHp: 100,
      speed: 270,
      angle: -Math.PI / 2,
      fireCooldown: 0,
      dashCooldown: 0,
      dashTimer: 0,
      dashX: 0,
      dashY: -1,
      hurtCooldown: 0,
      trailTimer: 0,
    };
  }

  createRun() {
    return {
      elapsed: 0,
      score: 0,
      kills: 0,
      streak: 0,
      comboTimer: 0,
      pickups: 0,
    };
  }

  setCallbacks(callbacks) {
    this.callbacks = callbacks;
  }

  setQuality(quality) {
    if (!Object.hasOwn(QUALITY, quality) || this.quality === quality) return;
    this.quality = quality;
    this.adaptiveScale = 1;
    this.slowWindows = 0;
    this.fastWindows = 0;
    this.resize();
    this.emitStats();
  }

  setAutoAim(enabled) {
    this.autoAim = Boolean(enabled);
  }

  effectsScale() {
    const config = QUALITY[this.quality] || QUALITY.auto;
    return config.effects * (config.adaptive ? this.adaptiveScale : 1);
  }

  setTouchMove(x, y) {
    this.input.touchControls = true;
    this.input.touchMoveX = clamp(x, -1, 1);
    this.input.touchMoveY = clamp(y, -1, 1);
  }

  setTouchFire(pressed) {
    this.input.touchControls = true;
    this.input.touchFire = Boolean(pressed);
  }

  requestDash() {
    if (this.phase === 'playing') this.input.dashRequested = true;
  }

  start() {
    this.clearEntities();
    this.run = this.createRun();
    this.player = this.createPlayer();
    this.spawnTimer = 0.65;
    this.accumulator = 0;
    this.lastRun = null;
    this.input.keys.clear();
    this.input.pointerFiring = false;
    this.input.touchFire = false;
    this.input.touchMoveX = 0;
    this.input.touchMoveY = 0;
    this.input.touchControls = false;
    this.input.dashRequested = false;
    this.input.aim.active = false;
    this.uiTimer = 0;
    this.setPhase('playing');
    this.emitStats();
  }

  pause(reason = 'manual') {
    if (this.phase !== 'playing') return;
    this.pauseReason = reason;
    this.input.keys.clear();
    this.input.pointerFiring = false;
    this.input.touchFire = false;
    this.input.touchMoveX = 0;
    this.input.touchMoveY = 0;
    this.accumulator = 0;
    this.setPhase('paused');
  }

  resume() {
    if (this.phase !== 'paused') return;
    this.lastFrameTime = 0;
    this.accumulator = 0;
    this.setPhase('playing');
  }

  setPhase(phase) {
    if (this.phase === phase) return;
    this.phase = phase;
    if (typeof this.callbacks.onPhaseChange === 'function') {
      this.callbacks.onPhaseChange(phase, this.lastRun, this.pauseReason);
    }
  }

  resize() {
    const rect = (this.canvas.parentElement || this.canvas).getBoundingClientRect();
    const width = Math.max(1, rect.width || window.innerWidth);
    const height = Math.max(1, rect.height || window.innerHeight);
    const config = QUALITY[this.quality] || QUALITY.auto;
    const deviceRatio = Math.min(window.devicePixelRatio || 1, config.pixelRatio);
    this.dpr = Math.max(0.75, deviceRatio * (config.adaptive ? this.adaptiveScale : 1));
    this.width = width;
    this.height = height;
    this.canvas.width = Math.max(1, Math.round(width * this.dpr));
    this.canvas.height = Math.max(1, Math.round(height * this.dpr));
    this.ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    this.ctx.imageSmoothingEnabled = true;

    if (this.phase === 'ready') {
      this.player.x = width / 2;
      this.player.y = height / 2;
      this.player.px = this.player.x;
      this.player.py = this.player.y;
    } else {
      this.player.x = clamp(this.player.x, this.player.radius + 16, width - this.player.radius - 16);
      this.player.y = clamp(this.player.y, this.player.radius + 16, height - this.player.radius - 16);
    }
    this.buildBackground();
  }

  buildBackground() {
    const width = Math.max(1, Math.ceil(this.width));
    const height = Math.max(1, Math.ceil(this.height));
    this.background.width = width;
    this.background.height = height;
    const ctx = this.backgroundContext;
    if (!ctx) return;

    const base = ctx.createLinearGradient(0, 0, width, height);
    base.addColorStop(0, '#0a1020');
    base.addColorStop(0.48, '#080d19');
    base.addColorStop(1, '#0c0b1a');
    ctx.fillStyle = base;
    ctx.fillRect(0, 0, width, height);

    const hazeA = ctx.createRadialGradient(width * 0.24, height * 0.27, 0, width * 0.24, height * 0.27, Math.max(width, height) * 0.66);
    hazeA.addColorStop(0, 'rgba(41, 104, 132, .22)');
    hazeA.addColorStop(1, 'rgba(41, 104, 132, 0)');
    ctx.fillStyle = hazeA;
    ctx.fillRect(0, 0, width, height);

    const hazeB = ctx.createRadialGradient(width * 0.83, height * 0.72, 0, width * 0.83, height * 0.72, Math.max(width, height) * 0.52);
    hazeB.addColorStop(0, 'rgba(100, 61, 145, .16)');
    hazeB.addColorStop(1, 'rgba(100, 61, 145, 0)');
    ctx.fillStyle = hazeB;
    ctx.fillRect(0, 0, width, height);

    ctx.save();
    ctx.strokeStyle = 'rgba(141, 175, 225, .042)';
    ctx.lineWidth = 1;
    const grid = 48;
    for (let x = (width % grid); x < width; x += grid) {
      ctx.beginPath();
      ctx.moveTo(x + 0.5, 0);
      ctx.lineTo(x + 0.5, height);
      ctx.stroke();
    }
    for (let y = (height % grid); y < height; y += grid) {
      ctx.beginPath();
      ctx.moveTo(0, y + 0.5);
      ctx.lineTo(width, y + 0.5);
      ctx.stroke();
    }
    ctx.restore();

    const centerX = width * 0.52;
    const centerY = height * 0.52;
    ctx.save();
    ctx.lineWidth = 1;
    ctx.strokeStyle = 'rgba(143, 185, 224, .06)';
    [Math.min(width, height) * 0.2, Math.min(width, height) * 0.36, Math.min(width, height) * 0.54].forEach((radius) => {
      ctx.beginPath();
      ctx.arc(centerX, centerY, radius, 0, Math.PI * 2);
      ctx.stroke();
    });
    ctx.restore();

    const random = seedRandom(Math.round(width * 31 + height * 17));
    const starCount = clamp(Math.round(width * height / 3600), 78, 190);
    this.stars = Array.from({ length: starCount }, () => ({
      x: random() * width,
      y: random() * height,
      size: random() > 0.88 ? 1.7 : 0.8 + random() * 0.65,
      alpha: 0.22 + random() * 0.56,
      phase: random() * Math.PI * 2,
      drift: 1.5 + random() * 5,
      tint: random() > 0.84 ? '#9cece5' : '#c8d7ff',
    }));
  }

  onKeyDown(event) {
    if (event.target instanceof HTMLElement && /^(INPUT|SELECT|TEXTAREA|BUTTON)$/.test(event.target.tagName)) {
      if (event.code !== 'Escape') return;
    }
    const movementKeys = ['KeyW', 'KeyA', 'KeyS', 'KeyD', 'ArrowUp', 'ArrowLeft', 'ArrowDown', 'ArrowRight'];
    if (movementKeys.includes(event.code) || event.code === 'Space') event.preventDefault();
    if (event.code === 'Escape') {
      if (this.phase === 'playing') this.pause('manual');
      else if (this.phase === 'paused') this.resume();
      return;
    }
    if (event.code === 'Space' || event.code === 'ShiftLeft' || event.code === 'ShiftRight') {
      if (!event.repeat) this.requestDash();
      return;
    }
    this.input.keys.add(event.code);
  }

  onKeyUp(event) {
    this.input.keys.delete(event.code);
  }

  pointerPosition(event) {
    const rect = this.canvas.getBoundingClientRect();
    return { x: event.clientX - rect.left, y: event.clientY - rect.top };
  }

  onPointerMove(event) {
    if (event.pointerType === 'touch') return;
    const position = this.pointerPosition(event);
    this.input.aim.x = position.x;
    this.input.aim.y = position.y;
    this.input.aim.active = true;
  }

  onPointerDown(event) {
    if (event.pointerType === 'mouse' && event.button !== 0) return;
    const position = this.pointerPosition(event);
    this.input.aim.x = position.x;
    this.input.aim.y = position.y;
    if (event.pointerType !== 'touch') this.input.aim.active = true;
    this.input.pointerFiring = true;
  }

  clearEntities() {
    while (this.particles.length) this.particlePool.release(this.particles.pop());
    while (this.bullets.length) this.bulletPool.release(this.bullets.pop());
    while (this.enemies.length) this.enemyPool.release(this.enemies.pop());
    while (this.pickups.length) this.pickupPool.release(this.pickups.pop());
  }

  frame(timestamp) {
    if (this.destroyed) return;
    if (!this.lastFrameTime) this.lastFrameTime = timestamp;
    const rawDelta = Math.max(0, (timestamp - this.lastFrameTime) / 1000);
    this.lastFrameTime = timestamp;
    const delta = Math.min(rawDelta, MAX_FRAME_DELTA);
    this.visualTime += Math.min(rawDelta, 0.08);
    this.measurePerformance(rawDelta);

    let alpha = 0;
    if (this.phase === 'playing') {
      this.accumulator = Math.min(this.accumulator + delta, STEP * MAX_STEPS_PER_FRAME);
      let steps = 0;
      while (this.accumulator >= STEP && steps < MAX_STEPS_PER_FRAME && this.phase === 'playing') {
        this.update(STEP);
        this.accumulator -= STEP;
        steps += 1;
      }
      alpha = this.accumulator / STEP;
    } else {
      this.accumulator = 0;
    }

    this.render(alpha);
    this.rafId = requestAnimationFrame(this.frame);
  }

  measurePerformance(delta) {
    if (delta <= 0 || delta > 0.25) return;
    this.performanceTime += delta;
    this.performanceFrames += 1;
    if (this.performanceTime < 1.25) return;

    this.fps = Math.round(this.performanceFrames / this.performanceTime);
    this.performanceTime = 0;
    this.performanceFrames = 0;
    const config = QUALITY[this.quality];
    if (config.adaptive) {
      if (this.fps < 48) {
        this.slowWindows += 1;
        this.fastWindows = 0;
      } else if (this.fps > 57) {
        this.fastWindows += 1;
        this.slowWindows = 0;
      } else {
        this.slowWindows = 0;
        this.fastWindows = 0;
      }

      if (this.slowWindows >= 2 && this.adaptiveScale > 0.7) {
        this.adaptiveScale = Math.max(0.7, this.adaptiveScale - 0.1);
        this.slowWindows = 0;
        this.resize();
      } else if (this.fastWindows >= 5 && this.adaptiveScale < 1) {
        this.adaptiveScale = Math.min(1, this.adaptiveScale + 0.05);
        this.fastWindows = 0;
        this.resize();
      }
    }
    this.emitStats();
  }

  update(dt) {
    const player = this.player;
    const keys = this.input.keys;
    this.run.elapsed += dt;
    player.px = player.x;
    player.py = player.y;
    player.dashCooldown = Math.max(0, player.dashCooldown - dt);
    player.hurtCooldown = Math.max(0, player.hurtCooldown - dt);
    player.dashTimer = Math.max(0, player.dashTimer - dt);
    player.trailTimer -= dt;

    let moveX = (keys.has('KeyD') || keys.has('ArrowRight') ? 1 : 0)
      - (keys.has('KeyA') || keys.has('ArrowLeft') ? 1 : 0)
      + this.input.touchMoveX;
    let moveY = (keys.has('KeyS') || keys.has('ArrowDown') ? 1 : 0)
      - (keys.has('KeyW') || keys.has('ArrowUp') ? 1 : 0)
      + this.input.touchMoveY;
    const movement = normalizeVector(moveX, moveY);
    moveX = movement.x;
    moveY = movement.y;

    if (this.input.dashRequested) {
      this.input.dashRequested = false;
      if (player.dashCooldown <= 0) {
        let dashVector = normalizeVector(moveX, moveY);
        if (dashVector.x === 0 && dashVector.y === 0) {
          dashVector = { x: Math.cos(player.angle), y: Math.sin(player.angle) };
        }
        player.dashX = dashVector.x;
        player.dashY = dashVector.y;
        player.dashTimer = 0.22;
        player.dashCooldown = 3.4;
        player.hurtCooldown = Math.max(player.hurtCooldown, 0.28);
        this.sound('dash');
        this.spawnBurst(player.x, player.y, '#74f3e5', 13);
      }
    }

    if (player.dashTimer > 0) {
      player.x += player.dashX * 790 * dt;
      player.y += player.dashY * 790 * dt;
      if (player.trailTimer <= 0) {
        player.trailTimer = 0.035;
        this.spawnParticle(player.x - player.dashX * 11, player.y - player.dashY * 11, -player.dashX * 34, -player.dashY * 34, '#67eadd', 0.28, 2.2);
      }
    } else {
      player.x += moveX * player.speed * dt;
      player.y += moveY * player.speed * dt;
    }
    player.x = clamp(player.x, player.radius + 18, this.width - player.radius - 18);
    player.y = clamp(player.y, player.radius + 18, this.height - player.radius - 18);

    this.updateAimAndWeapon(dt);
    this.spawnTimer -= dt;
    const maxEnemies = this.quality === 'smooth' ? 23 : this.quality === 'balanced' ? 29 : Math.round(38 * this.effectsScale());
    if (this.spawnTimer <= 0 && this.enemies.length < maxEnemies) {
      this.spawnEnemy();
      this.spawnTimer = spawnIntervalForTime(this.run.elapsed) + Math.random() * 0.34;
    } else if (this.spawnTimer <= 0) {
      this.spawnTimer = 0.18;
    }

    this.updateEnemies(dt);
    if (this.phase !== 'playing') return;
    this.updateBullets(dt);
    this.updatePickups(dt);
    this.updateParticles(dt);

    this.run.comboTimer = Math.max(0, this.run.comboTimer - dt);
    if (this.run.comboTimer === 0) this.run.streak = 0;
    this.uiTimer -= dt;
    if (this.uiTimer <= 0) {
      this.uiTimer = 0.12;
      this.emitStats();
    }
  }

  updateAimAndWeapon(dt) {
    const player = this.player;
    const target = this.nearestEnemy();
    const shouldAutoAim = this.input.touchControls || (this.autoAim && !this.input.aim.active);
    if (shouldAutoAim && target) {
      player.angle = Math.atan2(target.y - player.y, target.x - player.x);
    } else if (this.input.aim.active) {
      const dx = this.input.aim.x - player.x;
      const dy = this.input.aim.y - player.y;
      if (dx * dx + dy * dy > 1) player.angle = Math.atan2(dy, dx);
    } else if (target) {
      player.angle = Math.atan2(target.y - player.y, target.x - player.x);
    }

    player.fireCooldown = Math.max(0, player.fireCooldown - dt);
    if ((this.input.pointerFiring || this.input.touchFire) && player.fireCooldown <= 0) {
      this.fireBullet();
      player.fireCooldown = 0.17;
    }
  }

  nearestEnemy() {
    let closest = null;
    let closestDistance = Infinity;
    for (let i = 0; i < this.enemies.length; i += 1) {
      const enemy = this.enemies[i];
      const dx = enemy.x - this.player.x;
      const dy = enemy.y - this.player.y;
      const distance = dx * dx + dy * dy;
      if (distance < closestDistance) {
        closest = enemy;
        closestDistance = distance;
      }
    }
    return closest;
  }

  fireBullet() {
    const bullet = this.bulletPool.take();
    const player = this.player;
    const muzzleX = player.x + Math.cos(player.angle) * 18;
    const muzzleY = player.y + Math.sin(player.angle) * 18;
    bullet.x = muzzleX;
    bullet.y = muzzleY;
    bullet.px = muzzleX;
    bullet.py = muzzleY;
    bullet.vx = Math.cos(player.angle) * 570;
    bullet.vy = Math.sin(player.angle) * 570;
    bullet.life = 1.12;
    bullet.damage = 1;
    this.bullets.push(bullet);
    this.spawnParticle(muzzleX, muzzleY, Math.cos(player.angle) * 24, Math.sin(player.angle) * 24, '#a0fff1', 0.12, 1.8);
    this.sound('shoot');
  }

  spawnEnemy() {
    const profile = enemyProfileForTime(this.run.elapsed);
    const enemy = this.enemyPool.take();
    const edge = Math.floor(Math.random() * 4);
    const margin = 36 + profile.radius;
    let x;
    let y;
    if (edge === 0) {
      x = Math.random() * this.width;
      y = -margin;
    } else if (edge === 1) {
      x = this.width + margin;
      y = Math.random() * this.height;
    } else if (edge === 2) {
      x = Math.random() * this.width;
      y = this.height + margin;
    } else {
      x = -margin;
      y = Math.random() * this.height;
    }
    const scaling = 1 + Math.min(this.run.elapsed / 240, 0.32);
    Object.assign(enemy, profile, {
      x,
      y,
      px: x,
      py: y,
      hp: profile.hp,
      maxHp: profile.hp,
      speed: profile.speed * scaling,
      spin: (Math.random() - 0.5) * 0.65,
      angle: 0,
    });
    this.enemies.push(enemy);
  }

  updateEnemies(dt) {
    const player = this.player;
    for (let i = this.enemies.length - 1; i >= 0; i -= 1) {
      const enemy = this.enemies[i];
      enemy.px = enemy.x;
      enemy.py = enemy.y;
      const dx = player.x - enemy.x;
      const dy = player.y - enemy.y;
      const distance = Math.hypot(dx, dy) || 1;
      enemy.angle = Math.atan2(dy, dx);
      enemy.x += (dx / distance) * enemy.speed * dt;
      enemy.y += (dy / distance) * enemy.speed * dt;

      const contactRadius = enemy.radius + player.radius;
      if (distance < contactRadius + 2 && player.dashTimer <= 0 && player.hurtCooldown <= 0) {
        this.damagePlayer(enemy.damage);
        enemy.x -= (dx / distance) * 18;
        enemy.y -= (dy / distance) * 18;
        if (this.phase !== 'playing') return;
      }
    }
  }

  updateBullets(dt) {
    for (let i = this.bullets.length - 1; i >= 0; i -= 1) {
      const bullet = this.bullets[i];
      bullet.px = bullet.x;
      bullet.py = bullet.y;
      bullet.x += bullet.vx * dt;
      bullet.y += bullet.vy * dt;
      bullet.life -= dt;
      let consumed = bullet.life <= 0
        || bullet.x < -24 || bullet.x > this.width + 24
        || bullet.y < -24 || bullet.y > this.height + 24;

      if (!consumed) {
        for (let enemyIndex = this.enemies.length - 1; enemyIndex >= 0; enemyIndex -= 1) {
          const enemy = this.enemies[enemyIndex];
          const dx = bullet.x - enemy.x;
          const dy = bullet.y - enemy.y;
          const radius = enemy.radius + 4;
          if (dx * dx + dy * dy <= radius * radius) {
            enemy.hp -= bullet.damage;
            consumed = true;
            this.spawnBurst(bullet.x, bullet.y, enemy.color, this.quality === 'smooth' ? 2 : 4);
            if (enemy.hp <= 0) this.killEnemy(enemyIndex);
            break;
          }
        }
      }
      if (consumed) removePooled(this.bullets, i, this.bulletPool);
    }
  }

  updatePickups(dt) {
    const player = this.player;
    for (let i = this.pickups.length - 1; i >= 0; i -= 1) {
      const pickup = this.pickups[i];
      pickup.px = pickup.x;
      pickup.py = pickup.y;
      pickup.life -= dt;
      pickup.phase += dt * 3;
      const dx = player.x - pickup.x;
      const dy = player.y - pickup.y;
      const distance = Math.hypot(dx, dy) || 1;
      if (distance < 110) {
        const pull = (1 - distance / 120) * 185;
        pickup.x += (dx / distance) * pull * dt;
        pickup.y += (dy / distance) * pull * dt;
      }
      if (distance < player.radius + pickup.radius + 6) {
        player.hp = Math.min(player.maxHp, player.hp + 22);
        this.run.score += 50;
        this.run.pickups += 1;
        this.sound('pickup');
        this.spawnBurst(pickup.x, pickup.y, '#b8ff9b', 12);
        removePooled(this.pickups, i, this.pickupPool);
      } else if (pickup.life <= 0) {
        removePooled(this.pickups, i, this.pickupPool);
      }
    }
  }

  updateParticles(dt) {
    for (let i = this.particles.length - 1; i >= 0; i -= 1) {
      const particle = this.particles[i];
      particle.px = particle.x;
      particle.py = particle.y;
      particle.x += particle.vx * dt;
      particle.y += particle.vy * dt;
      particle.vx *= 0.982;
      particle.vy *= 0.982;
      particle.life -= dt;
      if (particle.life <= 0) removePooled(this.particles, i, this.particlePool);
    }
  }

  damagePlayer(amount) {
    if (this.player.hurtCooldown > 0 || this.player.dashTimer > 0) return;
    this.player.hp = Math.max(0, this.player.hp - amount);
    this.player.hurtCooldown = 0.78;
    this.sound('hit');
    this.spawnBurst(this.player.x, this.player.y, '#ff779b', 17);
    if (this.player.hp <= 0) this.finishRun();
  }

  killEnemy(index) {
    const enemy = this.enemies[index];
    this.run.kills += 1;
    this.run.streak += 1;
    this.run.comboTimer = 2.7;
    const comboBonus = Math.min(this.run.streak - 1, 12) * 15;
    this.run.score += enemy.score + comboBonus;
    this.sound('pop');
    this.spawnBurst(enemy.x, enemy.y, enemy.color, enemy.type === 'brute' ? 24 : 14);
    if (this.run.kills % 8 === 0 || Math.random() < 0.12) this.spawnPickup(enemy.x, enemy.y);
    removePooled(this.enemies, index, this.enemyPool);
  }

  spawnPickup(x, y) {
    const pickup = this.pickupPool.take();
    pickup.x = x;
    pickup.y = y;
    pickup.px = x;
    pickup.py = y;
    pickup.radius = 8;
    pickup.life = 13;
    pickup.phase = Math.random() * Math.PI * 2;
    this.pickups.push(pickup);
  }

  spawnParticle(x, y, vx, vy, color, life, radius) {
    const maxParticles = Math.round(300 * this.effectsScale());
    if (this.particles.length >= maxParticles) return;
    const particle = this.particlePool.take();
    particle.x = x;
    particle.y = y;
    particle.px = x;
    particle.py = y;
    particle.vx = vx;
    particle.vy = vy;
    particle.color = color;
    particle.life = life;
    particle.maxLife = life;
    particle.radius = radius;
    this.particles.push(particle);
  }

  spawnBurst(x, y, color, count) {
    const effects = this.effectsScale();
    const adjustedCount = Math.max(1, Math.round(count * effects));
    const available = Math.max(0, Math.round(300 * effects) - this.particles.length);
    for (let i = 0; i < Math.min(adjustedCount, available); i += 1) {
      const angle = Math.random() * Math.PI * 2;
      const speed = 28 + Math.random() * 150;
      const life = 0.2 + Math.random() * 0.48;
      this.spawnParticle(x, y, Math.cos(angle) * speed, Math.sin(angle) * speed, color, life, 1.1 + Math.random() * 2.1);
    }
  }

  sound(name) {
    if (typeof this.callbacks.onSound === 'function') this.callbacks.onSound(name);
  }

  finishRun() {
    if (this.phase !== 'playing') return;
    this.lastRun = {
      elapsed: this.run.elapsed,
      score: this.run.score,
      kills: this.run.kills,
      wave: Math.floor(this.run.elapsed / 20) + 1,
      pickups: this.run.pickups,
    };
    this.setPhase('gameover');
    this.emitStats();
    if (typeof this.callbacks.onGameOver === 'function') this.callbacks.onGameOver(this.lastRun);
  }

  statsSnapshot() {
    return {
      phase: this.phase,
      elapsed: this.run.elapsed,
      score: this.run.score,
      kills: this.run.kills,
      health: this.player.hp,
      maxHealth: this.player.maxHp,
      wave: Math.floor(this.run.elapsed / 20) + 1,
      streak: this.run.streak,
      comboTimer: this.run.comboTimer,
      dashCooldown: this.player.dashCooldown,
      dashDuration: 3.4,
      fps: this.fps,
      quality: this.quality,
      adaptiveScale: this.adaptiveScale,
    };
  }

  emitStats() {
    if (typeof this.callbacks.onStats === 'function') this.callbacks.onStats(this.statsSnapshot());
  }

  render(alpha = 0) {
    if (!this.ctx) return;
    const ctx = this.ctx;
    const width = this.width;
    const height = this.height;
    const smoothAlpha = clamp(alpha, 0, 1);
    ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    ctx.drawImage(this.background, 0, 0, width, height);
    this.drawStars(ctx);

    for (let i = 0; i < this.pickups.length; i += 1) this.drawPickup(ctx, this.pickups[i]);
    for (let i = 0; i < this.enemies.length; i += 1) {
      const enemy = this.enemies[i];
      this.drawEnemy(ctx, enemy, enemy.px + (enemy.x - enemy.px) * smoothAlpha, enemy.py + (enemy.y - enemy.py) * smoothAlpha);
    }
    this.drawBullets(ctx, smoothAlpha);
    this.drawParticles(ctx);
    this.drawPlayer(ctx, smoothAlpha);
    this.drawReticle(ctx);
  }

  drawStars(ctx) {
    for (let i = 0; i < this.stars.length; i += 1) {
      const star = this.stars[i];
      const shimmer = 0.72 + Math.sin(this.visualTime * star.drift + star.phase) * 0.24;
      ctx.globalAlpha = star.alpha * shimmer;
      ctx.fillStyle = star.tint;
      ctx.fillRect(star.x, star.y, star.size, star.size);
    }
    ctx.globalAlpha = 1;
  }

  drawPlayer(ctx, alpha) {
    const player = this.player;
    const x = player.px + (player.x - player.px) * alpha;
    const y = player.py + (player.y - player.py) * alpha;
    if (player.hp <= 0 && this.phase === 'gameover') return;
    if (player.hurtCooldown > 0 && Math.floor(this.visualTime * 22) % 2 === 0 && player.dashTimer <= 0) return;

    ctx.save();
    ctx.translate(x, y);
    ctx.rotate(player.angle);
    const effects = this.effectsScale();
    ctx.shadowColor = '#72f6e6';
    ctx.shadowBlur = 15 * effects;

    if (player.dashTimer > 0) {
      ctx.strokeStyle = 'rgba(129, 255, 236, .76)';
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.ellipse(-8, 0, 23, 15, 0, 0, Math.PI * 2);
      ctx.stroke();
    }

    ctx.fillStyle = '#8ff6e8';
    ctx.beginPath();
    ctx.moveTo(18, 0);
    ctx.lineTo(-10, -10);
    ctx.lineTo(-5, 0);
    ctx.lineTo(-10, 10);
    ctx.closePath();
    ctx.fill();

    ctx.shadowBlur = 0;
    ctx.fillStyle = '#17303b';
    ctx.beginPath();
    ctx.moveTo(8, 0);
    ctx.lineTo(-5, -4.2);
    ctx.lineTo(-2, 0);
    ctx.lineTo(-5, 4.2);
    ctx.closePath();
    ctx.fill();

    const moving = this.input.keys.size > 0 || Math.abs(this.input.touchMoveX) + Math.abs(this.input.touchMoveY) > 0.15 || player.dashTimer > 0;
    if (moving && player.dashTimer <= 0) {
      const flame = 5 + Math.sin(this.visualTime * 34) * 2;
      ctx.fillStyle = 'rgba(113, 240, 229, .78)';
      ctx.beginPath();
      ctx.moveTo(-7, -3);
      ctx.lineTo(-7 - flame, 0);
      ctx.lineTo(-7, 3);
      ctx.closePath();
      ctx.fill();
    }
    ctx.restore();
  }

  drawEnemy(ctx, enemy, x, y) {
    ctx.save();
    ctx.translate(x, y);
    ctx.rotate(enemy.angle + enemy.spin * Math.sin(this.visualTime * 2 + x * 0.01));
    ctx.shadowColor = enemy.color;
    ctx.shadowBlur = 9 * this.effectsScale();
    ctx.fillStyle = enemy.color;
    ctx.strokeStyle = 'rgba(255,255,255,.5)';
    ctx.lineWidth = 1;
    ctx.beginPath();

    if (enemy.type === 'brute') {
      for (let point = 0; point < 6; point += 1) {
        const angle = (Math.PI * 2 * point) / 6;
        const px = Math.cos(angle) * enemy.radius;
        const py = Math.sin(angle) * enemy.radius;
        if (point === 0) ctx.moveTo(px, py);
        else ctx.lineTo(px, py);
      }
      ctx.closePath();
    } else if (enemy.type === 'hunter') {
      ctx.moveTo(enemy.radius + 1, 0);
      ctx.lineTo(-enemy.radius * 0.75, -enemy.radius * 0.82);
      ctx.lineTo(-enemy.radius * 0.5, 0);
      ctx.lineTo(-enemy.radius * 0.75, enemy.radius * 0.82);
      ctx.closePath();
    } else {
      ctx.moveTo(enemy.radius + 1, 0);
      ctx.lineTo(-enemy.radius * 0.8, -enemy.radius * 0.75);
      ctx.lineTo(-enemy.radius * 0.55, 0);
      ctx.lineTo(-enemy.radius * 0.8, enemy.radius * 0.75);
      ctx.closePath();
    }
    ctx.fill();
    ctx.shadowBlur = 0;
    ctx.stroke();
    ctx.fillStyle = 'rgba(13, 18, 34, .88)';
    ctx.beginPath();
    ctx.arc(0, 0, Math.max(2.2, enemy.radius * 0.25), 0, Math.PI * 2);
    ctx.fill();

    if (enemy.maxHp > 1 && enemy.hp < enemy.maxHp) {
      const progress = Math.max(0, enemy.hp / enemy.maxHp);
      ctx.lineWidth = 2;
      ctx.strokeStyle = 'rgba(255,255,255,.22)';
      ctx.beginPath();
      ctx.arc(0, 0, enemy.radius + 4, 0, Math.PI * 2);
      ctx.stroke();
      ctx.strokeStyle = enemy.color;
      ctx.beginPath();
      ctx.arc(0, 0, enemy.radius + 4, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * progress);
      ctx.stroke();
    }
    ctx.restore();
  }

  drawBullets(ctx, alpha) {
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    ctx.lineCap = 'round';
    for (let i = 0; i < this.bullets.length; i += 1) {
      const bullet = this.bullets[i];
      const x = bullet.px + (bullet.x - bullet.px) * alpha;
      const y = bullet.py + (bullet.y - bullet.py) * alpha;
      ctx.strokeStyle = 'rgba(133, 255, 239, .92)';
      ctx.lineWidth = 2.5;
      ctx.beginPath();
      ctx.moveTo(x - bullet.vx * 0.022, y - bullet.vy * 0.022);
      ctx.lineTo(x, y);
      ctx.stroke();
      ctx.fillStyle = '#f0fff8';
      ctx.beginPath();
      ctx.arc(x, y, 1.7, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.restore();
  }

  drawParticles(ctx) {
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    for (let i = 0; i < this.particles.length; i += 1) {
      const particle = this.particles[i];
      const alpha = clamp(particle.life / particle.maxLife, 0, 1);
      ctx.globalAlpha = alpha;
      ctx.fillStyle = particle.color;
      ctx.beginPath();
      ctx.arc(particle.x, particle.y, particle.radius * (0.45 + alpha * 0.55), 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.globalAlpha = 1;
    ctx.restore();
  }

  drawPickup(ctx, pickup) {
    const pulse = 1 + Math.sin(pickup.phase) * 0.15;
    ctx.save();
    ctx.translate(pickup.x, pickup.y);
    ctx.rotate(pickup.phase * 0.4);
    ctx.shadowColor = '#b7ff91';
    ctx.shadowBlur = 12 * this.effectsScale();
    ctx.strokeStyle = 'rgba(197, 255, 156, .88)';
    ctx.fillStyle = 'rgba(154, 255, 150, .18)';
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.rect(-8 * pulse, -8 * pulse, 16 * pulse, 16 * pulse);
    ctx.fill();
    ctx.stroke();
    ctx.shadowBlur = 0;
    ctx.strokeStyle = '#ddffb2';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(-3, 0);
    ctx.lineTo(3, 0);
    ctx.moveTo(0, -3);
    ctx.lineTo(0, 3);
    ctx.stroke();
    ctx.restore();
  }

  drawReticle(ctx) {
    if (this.phase !== 'playing' || !this.input.aim.active || this.input.touchControls) return;
    const { x, y } = this.input.aim;
    ctx.save();
    ctx.strokeStyle = 'rgba(174, 255, 239, .5)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.arc(x, y, 9, 0, Math.PI * 2);
    ctx.moveTo(x - 14, y);
    ctx.lineTo(x - 6, y);
    ctx.moveTo(x + 6, y);
    ctx.lineTo(x + 14, y);
    ctx.moveTo(x, y - 14);
    ctx.lineTo(x, y - 6);
    ctx.moveTo(x, y + 6);
    ctx.lineTo(x, y + 14);
    ctx.stroke();
    ctx.restore();
  }

  destroy() {
    this.destroyed = true;
    cancelAnimationFrame(this.rafId);
    this.resizeObserver?.disconnect();
    this.canvas.removeEventListener('pointermove', this.handlePointerMove);
    this.canvas.removeEventListener('pointerdown', this.handlePointerDown);
    window.removeEventListener('pointerup', this.handlePointerUp);
    window.removeEventListener('pointercancel', this.handlePointerUp);
    window.removeEventListener('keydown', this.handleKeyDown);
    window.removeEventListener('keyup', this.handleKeyUp);
    window.removeEventListener('blur', this.handleBlur);
    window.removeEventListener('resize', this.handleResize);
    document.removeEventListener('visibilitychange', this.handleVisibility);
  }
}
