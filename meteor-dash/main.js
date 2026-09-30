// Meteor Dash — mini-jogo arcade em PixiJS v8 (sem assets externos: tudo é desenhado por código).
// Controles: WASD/setas ou mouse/toque para mover · tiro automático · P/Esc pausa · M som.

(async () => {
  const COLORS = { bg: 0x0d1110, green: 0x7dff9b, gold: 0xf5c84c, white: 0xffffff, rock: 0x1d2622 };
  const MAX_LIVES = 3;
  const FIRE_DELAY = 0.2;
  const SHIP_SPEED = 420;

  const app = new PIXI.Application();
  await app.init({
    resizeTo: window,
    background: COLORS.bg,
    antialias: true,
    resolution: Math.min(window.devicePixelRatio || 1, 2),
    autoDensity: true,
  });
  document.body.appendChild(app.canvas);

  const world = new PIXI.Container();
  const ui = new PIXI.Container();
  app.stage.addChild(world, ui);

  // ---------- util ----------
  const rand = (a, b) => a + Math.random() * (b - a);
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
  const dist2 = (a, b) => (a.x - b.x) ** 2 + (a.y - b.y) ** 2;

  const store = {
    get: () => { try { return Number(localStorage.getItem('meteor-dash-best')) || 0; } catch { return 0; } },
    set: v => { try { localStorage.setItem('meteor-dash-best', String(v)); } catch { /* ignore */ } },
  };

  // ---------- som (WebAudio, criado só após o primeiro input) ----------
  let audio = null;
  let muted = false;
  function beep(freq, dur, type = 'square', vol = 0.05, slide = 0) {
    if (muted) return;
    try {
      audio ??= new (window.AudioContext || window.webkitAudioContext)();
      const o = audio.createOscillator();
      const g = audio.createGain();
      o.type = type;
      o.frequency.setValueAtTime(freq, audio.currentTime);
      if (slide) o.frequency.exponentialRampToValueAtTime(Math.max(30, freq + slide), audio.currentTime + dur);
      g.gain.setValueAtTime(vol, audio.currentTime);
      g.gain.exponentialRampToValueAtTime(0.0001, audio.currentTime + dur);
      o.connect(g).connect(audio.destination);
      o.start();
      o.stop(audio.currentTime + dur);
    } catch { /* áudio indisponível */ }
  }
  const sfx = {
    shoot: () => beep(880, 0.06, 'square', 0.025, -400),
    hit: () => beep(220, 0.08, 'triangle', 0.06, -80),
    boom: () => beep(160, 0.25, 'sawtooth', 0.07, -120),
    hurt: () => beep(120, 0.45, 'sawtooth', 0.09, -90),
    start: () => beep(440, 0.15, 'square', 0.05, 440),
  };

  // ---------- fundo: estrelas com parallax ----------
  const stars = [];
  for (let i = 0; i < 120; i++) {
    const layer = Math.random();
    const g = new PIXI.Graphics().circle(0, 0, 0.6 + layer * 1.6).fill({ color: COLORS.white, alpha: 0.2 + layer * 0.5 });
    g.x = Math.random() * app.screen.width;
    g.y = Math.random() * app.screen.height;
    world.addChild(g);
    stars.push({ g, speed: 20 + layer * 120 });
  }

  // ---------- entidades ----------
  const ship = new PIXI.Graphics()
    .poly([0, -20, 15, 14, 0, 7, -15, 14]).fill(COLORS.green)
    .poly([0, -8, 5, 6, -5, 6]).fill(COLORS.bg);
  ship.radius = 11;
  const flame = new PIXI.Graphics().poly([-5, 10, 5, 10, 0, 24]).fill(COLORS.gold);
  ship.addChild(flame);
  world.addChild(ship);

  let bullets = [];
  let rocks = [];
  let particles = [];

  function spawnBullet(x, y, vx) {
    const g = new PIXI.Graphics().roundRect(-2, -8, 4, 14, 2).fill(COLORS.green);
    g.x = x; g.y = y; g.radius = 5;
    g.vx = vx; g.vy = -720;
    world.addChild(g);
    bullets.push(g);
  }

  const ROCK_RADIUS = [0, 15, 27, 44];
  function spawnRock(size, x, y, vx, vy) {
    const r = ROCK_RADIUS[size];
    const pts = [];
    const n = 10;
    for (let i = 0; i < n; i++) {
      const a = (i / n) * Math.PI * 2;
      const rr = r * rand(0.8, 1.1);
      pts.push(Math.cos(a) * rr, Math.sin(a) * rr);
    }
    const g = new PIXI.Graphics().poly(pts).fill(COLORS.rock).stroke({ width: 2, color: COLORS.gold });
    g.x = x; g.y = y; g.radius = r * 0.9;
    g.vx = vx; g.vy = vy;
    g.spin = rand(-1.5, 1.5);
    g.size = size; g.hp = size;
    world.addChild(g);
    rocks.push(g);
  }

  function burst(x, y, color, count, power = 160) {
    for (let i = 0; i < count; i++) {
      const a = Math.random() * Math.PI * 2;
      const s = rand(0.3, 1) * power;
      const g = new PIXI.Graphics().circle(0, 0, rand(1, 2.6)).fill(color);
      g.x = x; g.y = y;
      g.vx = Math.cos(a) * s; g.vy = Math.sin(a) * s;
      g.life = g.maxLife = rand(0.3, 0.7);
      world.addChild(g);
      particles.push(g);
    }
  }

  // ---------- HUD ----------
  const font = 'ui-monospace, Consolas, monospace';
  const mkText = (size, fill, align = 'left') =>
    new PIXI.Text({ text: '', style: { fontFamily: font, fontSize: size, fill, align, fontWeight: '700', letterSpacing: 1 } });
  const scoreText = mkText(20, COLORS.green);
  const livesText = mkText(20, COLORS.gold);
  const bestText = mkText(13, 0x8fa199);
  const centerText = mkText(34, COLORS.white, 'center');
  const subText = mkText(15, 0x8fa199, 'center');
  centerText.anchor.set(0.5);
  subText.anchor.set(0.5, 0);
  livesText.anchor.set(1, 0);
  ui.addChild(scoreText, livesText, bestText, centerText, subText);

  // ---------- estado ----------
  let state = 'menu'; // menu | playing | paused | over
  let score = 0, lives = MAX_LIVES, time = 0;
  let spawnTimer = 0, fireTimer = 0, invuln = 0, shake = 0;
  let best = store.get();

  function weaponLevel() { return Math.min(3, 1 + Math.floor(score / 1500)); }

  function resetGame() {
    [...bullets, ...rocks, ...particles].forEach(o => o.destroy());
    bullets = []; rocks = []; particles = [];
    score = 0; lives = MAX_LIVES; time = 0; spawnTimer = 0; fireTimer = 0; invuln = 1.5; shake = 0;
    ship.x = app.screen.width / 2;
    ship.y = app.screen.height * 0.8;
    ship.visible = true;
  }

  function startGame() {
    resetGame();
    state = 'playing';
    sfx.start();
  }

  function gameOver() {
    state = 'over';
    ship.visible = false;
    burst(ship.x, ship.y, COLORS.green, 40, 260);
    sfx.boom();
    if (score > best) { best = score; store.set(best); }
  }

  function togglePause() {
    if (state === 'playing') state = 'paused';
    else if (state === 'paused') state = 'playing';
  }

  // ---------- input ----------
  const keys = new Set();
  let target = null;
  const KEYMAP = { arrowleft: 'l', a: 'l', arrowright: 'r', d: 'r', arrowup: 'u', w: 'u', arrowdown: 'd', s: 'd' };

  addEventListener('keydown', e => {
    const k = e.key.toLowerCase();
    if (KEYMAP[k]) { keys.add(KEYMAP[k]); target = null; e.preventDefault(); }
    else if (k === 'p' || k === 'escape') togglePause();
    else if (k === 'm') muted = !muted;
    else if ((k === ' ' || k === 'enter') && (state === 'menu' || state === 'over')) startGame();
  });
  addEventListener('keyup', e => { const m = KEYMAP[e.key.toLowerCase()]; if (m) keys.delete(m); });
  addEventListener('blur', () => { if (state === 'playing') state = 'paused'; });

  function setTarget(e) {
    // no toque, a nave fica acima do dedo para não ficar escondida
    target = { x: e.clientX, y: e.clientY - (e.pointerType === 'touch' ? 70 : 0) };
  }
  addEventListener('pointermove', e => { if (e.pointerType !== 'mouse' || state === 'playing') setTarget(e); });
  addEventListener('pointerdown', e => {
    setTarget(e);
    if (state === 'menu' || state === 'over') startGame();
    else if (state === 'paused') state = 'playing';
  });

  // ---------- atualização ----------
  function update(dt) {
    const w = app.screen.width, h = app.screen.height;
    time += dt;

    // nave
    let vx = 0, vy = 0;
    if (keys.size) {
      vx = (keys.has('r') ? 1 : 0) - (keys.has('l') ? 1 : 0);
      vy = (keys.has('d') ? 1 : 0) - (keys.has('u') ? 1 : 0);
      const len = Math.hypot(vx, vy) || 1;
      vx = (vx / len) * SHIP_SPEED; vy = (vy / len) * SHIP_SPEED;
    } else if (target) {
      vx = clamp((target.x - ship.x) * 10, -SHIP_SPEED * 1.6, SHIP_SPEED * 1.6);
      vy = clamp((target.y - ship.y) * 10, -SHIP_SPEED * 1.6, SHIP_SPEED * 1.6);
    }
    ship.x = clamp(ship.x + vx * dt, 16, w - 16);
    ship.y = clamp(ship.y + vy * dt, 16, h - 16);
    ship.rotation = clamp(vx / SHIP_SPEED, -1, 1) * 0.25;
    flame.scale.y = 0.7 + Math.random() * 0.6;
    invuln = Math.max(0, invuln - dt);
    ship.alpha = invuln > 0 ? (Math.floor(invuln * 12) % 2 ? 0.25 : 1) : 1;

    // tiro automático (nível da arma sobe com a pontuação)
    fireTimer -= dt;
    if (fireTimer <= 0) {
      fireTimer = FIRE_DELAY;
      const lvl = weaponLevel();
      if (lvl === 1) spawnBullet(ship.x, ship.y - 20, 0);
      else if (lvl === 2) { spawnBullet(ship.x - 9, ship.y - 14, 0); spawnBullet(ship.x + 9, ship.y - 14, 0); }
      else { spawnBullet(ship.x, ship.y - 20, 0); spawnBullet(ship.x - 11, ship.y - 12, -110); spawnBullet(ship.x + 11, ship.y - 12, 110); }
      sfx.shoot();
    }

    // meteoros (dificuldade cresce com o tempo)
    spawnTimer -= dt;
    if (spawnTimer <= 0) {
      spawnTimer = Math.max(0.3, 1.05 - time * 0.012);
      const roll = Math.random();
      const size = roll < 0.45 ? 1 : roll < 0.8 ? 2 : 3;
      const fall = Math.min(260, 90 + time * 2.5);
      spawnRock(size, rand(0, w), -60, rand(-50, 50), rand(fall * 0.7, fall * 1.3));
    }

    for (const b of bullets) { b.x += b.vx * dt; b.y += b.vy * dt; }
    for (const r of rocks) {
      r.x += r.vx * dt; r.y += r.vy * dt; r.rotation += r.spin * dt;
      if (r.x < -80) r.x = w + 80; else if (r.x > w + 80) r.x = -80;
    }
    for (const s of stars) {
      s.g.y += s.speed * dt;
      if (s.g.y > h) { s.g.y = 0; s.g.x = Math.random() * w; }
    }
    for (const p of particles) { p.x += p.vx * dt; p.y += p.vy * dt; p.life -= dt; p.alpha = Math.max(0, p.life / p.maxLife); }

    // colisões: tiro × meteoro
    for (const b of bullets) {
      if (b.dead) continue;
      for (const r of rocks) {
        if (r.dead) continue;
        if (dist2(b, r) < (b.radius + r.radius) ** 2) {
          b.dead = true;
          r.hp--;
          if (r.hp > 0) { sfx.hit(); burst(b.x, b.y, COLORS.gold, 4, 90); r.scale.set(0.85 + r.hp / (r.size * 6.7)); break; }
          r.dead = true;
          score += r.size * 10;
          burst(r.x, r.y, COLORS.gold, 8 + r.size * 4);
          sfx.boom();
          shake = Math.max(shake, r.size * 1.5);
          if (r.size > 1) {
            spawnRock(r.size - 1, r.x - 10, r.y, r.vx - 70, r.vy);
            spawnRock(r.size - 1, r.x + 10, r.y, r.vx + 70, r.vy);
          }
          break;
        }
      }
    }

    // colisão: nave × meteoro
    if (invuln <= 0) {
      for (const r of rocks) {
        if (!r.dead && dist2(ship, r) < (ship.radius + r.radius) ** 2) {
          r.dead = true;
          lives--;
          invuln = 2;
          shake = 14;
          burst(ship.x, ship.y, COLORS.green, 18, 200);
          sfx.hurt();
          if (lives <= 0) gameOver();
          break;
        }
      }
    }

    // limpeza de objetos mortos ou fora da tela
    const prune = (list, keep) => list.filter(o => { if (keep(o)) return true; o.destroy(); return false; });
    bullets = prune(bullets, b => !b.dead && b.y > -30 && b.x > -30 && b.x < w + 30);
    rocks = prune(rocks, r => !r.dead && r.y < h + 100);
    particles = prune(particles, p => p.life > 0);
  }

  // ---------- render de HUD / mensagens ----------
  function drawHud() {
    const w = app.screen.width, h = app.screen.height;
    scoreText.text = `PONTOS ${score}`;
    livesText.text = `VIDAS ${Math.max(lives, 0)}  ARMA ${weaponLevel()}`;
    bestText.text = `RECORDE ${Math.max(best, score)}`;
    scoreText.position.set(16, 14);
    livesText.position.set(w - 16, 14);
    bestText.position.set(16, 40);
    centerText.position.set(w / 2, h / 2 - 20);
    subText.position.set(w / 2, h / 2 + 26);

    const msgs = {
      menu: ['METEOR DASH', 'Mova com WASD / setas / mouse / toque · tiro automático\nClique ou ESPAÇO para jogar'],
      paused: ['PAUSADO', 'Clique ou P para continuar'],
      over: ['FIM DE JOGO', `Você fez ${score} pontos${score >= best && score > 0 ? ' — novo recorde!' : ''}\nClique ou ESPAÇO para jogar de novo`],
      playing: ['', ''],
    }[state];
    centerText.text = msgs[0];
    subText.text = msgs[1];
  }

  // ---------- loop ----------
  app.ticker.add(t => {
    const dt = Math.min(t.deltaMS / 1000, 0.05);
    if (state === 'playing') update(dt);
    else if (state === 'menu' || state === 'over') {
      // fundo e partículas continuam vivos nos menus
      for (const s of stars) { s.g.y += s.speed * dt; if (s.g.y > app.screen.height) { s.g.y = 0; s.g.x = Math.random() * app.screen.width; } }
      for (const p of particles) { p.x += p.vx * dt; p.y += p.vy * dt; p.life -= dt; p.alpha = Math.max(0, p.life / p.maxLife); }
      particles = particles.filter(p => { if (p.life > 0) return true; p.destroy(); return false; });
    }
    // tremor de tela
    shake = Math.max(0, shake - dt * 30);
    world.position.set(rand(-shake, shake), rand(-shake, shake));
    drawHud();
  });

  ship.x = app.screen.width / 2;
  ship.y = app.screen.height * 0.8;
  ship.visible = false;

  // gancho para testes automatizados no console
  window.__game = { get state() { return state; }, get score() { return score; }, get lives() { return lives; }, rocks: () => rocks.length, bullets: () => bullets.length };
})();
