// Meteor Dash
// Fiz pra treinar PixiJS vindo da Godot. Tudo aqui é desenhado por código,
// sem imagem nenhuma, então dá pra abrir direto sem baixar nada.
//
// WASD/setas ou mouse/dedo pra mexer, o tiro é automático.
// P ou Esc pausa, M liga/desliga o som.

(async () => {
  const COR = { fundo: 0x0d1110, verde: 0x7dff9b, ouro: 0xf5c84c, branco: 0xffffff, pedra: 0x1d2622 };
  const VIDAS = 3;
  const INTERVALO_TIRO = 0.2; // segundos
  const VEL_NAVE = 420;

  const app = new PIXI.Application();
  await app.init({
    resizeTo: window,
    background: COR.fundo,
    antialias: true,
    resolution: Math.min(window.devicePixelRatio || 1, 2), // 2 já tá ótimo, mais que isso só pesa no celular
    autoDensity: true,
  });
  document.body.appendChild(app.canvas);

  // mundo = tudo que treme junto, ui = textos que ficam parados
  const mundo = new PIXI.Container();
  const ui = new PIXI.Container();
  app.stage.addChild(mundo, ui);

  const rand = (a, b) => a + Math.random() * (b - a);
  const limita = (v, a, b) => Math.max(a, Math.min(b, v));
  const dist2 = (a, b) => (a.x - b.x) ** 2 + (a.y - b.y) ** 2; // sem raiz, é mais barato comparar assim

  // localStorage pode dar erro (aba anônima, por ex), por isso o try
  function lerRecorde() {
    try { return Number(localStorage.getItem('meteor-dash-recorde')) || 0; } catch { return 0; }
  }
  function salvarRecorde(v) {
    try { localStorage.setItem('meteor-dash-recorde', String(v)); } catch { /* paciência */ }
  }

  // ---------- som ----------
  // Sem arquivo de áudio: uns bips com oscilador já dão o clima retrô.
  // O AudioContext só nasce no primeiro som, porque o navegador bloqueia antes de ter clique.
  let audio = null;
  let mudo = false;

  function bip(freq, dur, tipo = 'square', vol = 0.05, desliza = 0) {
    if (mudo) return;
    try {
      audio = audio || new (window.AudioContext || window.webkitAudioContext)();
      const osc = audio.createOscillator();
      const ganho = audio.createGain();
      const t = audio.currentTime;
      osc.type = tipo;
      osc.frequency.setValueAtTime(freq, t);
      if (desliza) osc.frequency.exponentialRampToValueAtTime(Math.max(30, freq + desliza), t + dur);
      ganho.gain.setValueAtTime(vol, t);
      ganho.gain.exponentialRampToValueAtTime(0.0001, t + dur);
      osc.connect(ganho).connect(audio.destination);
      osc.start();
      osc.stop(t + dur);
    } catch { /* sem áudio, segue o jogo */ }
  }

  const som = {
    tiro: () => bip(880, 0.06, 'square', 0.025, -400),
    acerto: () => bip(220, 0.08, 'triangle', 0.06, -80),
    explosao: () => bip(160, 0.25, 'sawtooth', 0.07, -120),
    dano: () => bip(120, 0.45, 'sawtooth', 0.09, -90),
    inicio: () => bip(440, 0.15, 'square', 0.05, 440),
  };

  // ---------- estrelas do fundo ----------
  // as mais brilhantes caem mais rápido, dá uma sensação de profundidade barata
  const estrelas = [];
  for (let i = 0; i < 120; i++) {
    const prof = Math.random();
    const g = new PIXI.Graphics().circle(0, 0, 0.6 + prof * 1.6).fill({ color: COR.branco, alpha: 0.2 + prof * 0.5 });
    g.x = Math.random() * app.screen.width;
    g.y = Math.random() * app.screen.height;
    mundo.addChild(g);
    estrelas.push({ g, vel: 20 + prof * 120 });
  }

  function moverEstrelas(dt) {
    for (const e of estrelas) {
      e.g.y += e.vel * dt;
      if (e.g.y > app.screen.height) {
        e.g.y = 0;
        e.g.x = Math.random() * app.screen.width;
      }
    }
  }

  // ---------- nave ----------
  const nave = new PIXI.Graphics()
    .poly([0, -20, 15, 14, 0, 7, -15, 14]).fill(COR.verde)
    .poly([0, -8, 5, 6, -5, 6]).fill(COR.fundo); // o "buraco" da cabine
  nave.raio = 11; // hitbox menor que o desenho, senão parece injusto
  const chama = new PIXI.Graphics().poly([-5, 10, 5, 10, 0, 24]).fill(COR.ouro);
  nave.addChild(chama);
  mundo.addChild(nave);

  let tiros = [];
  let pedras = [];
  let faiscas = [];

  function criarTiro(x, y, vx) {
    const g = new PIXI.Graphics().roundRect(-2, -8, 4, 14, 2).fill(COR.verde);
    g.x = x; g.y = y;
    g.raio = 5;
    g.vx = vx; g.vy = -720;
    mundo.addChild(g);
    tiros.push(g);
  }

  const RAIO_PEDRA = [0, 15, 27, 44]; // indexado pelo tamanho (1, 2 ou 3)

  function criarPedra(tam, x, y, vx, vy) {
    const r = RAIO_PEDRA[tam];
    const pts = [];
    const lados = 10;
    for (let i = 0; i < lados; i++) {
      const ang = (i / lados) * Math.PI * 2;
      const rr = r * rand(0.8, 1.1); // cada pedra sai meio torta
      pts.push(Math.cos(ang) * rr, Math.sin(ang) * rr);
    }
    const g = new PIXI.Graphics().poly(pts).fill(COR.pedra).stroke({ width: 2, color: COR.ouro });
    g.x = x; g.y = y;
    g.raio = r * 0.9;
    g.vx = vx; g.vy = vy;
    g.giro = rand(-1.5, 1.5);
    g.tam = tam;
    g.vida = tam; // pedra grande aguenta mais tiro
    mundo.addChild(g);
    pedras.push(g);
  }

  function explodir(x, y, cor, qtd, forca = 160) {
    for (let i = 0; i < qtd; i++) {
      const ang = Math.random() * Math.PI * 2;
      const vel = rand(0.3, 1) * forca;
      const g = new PIXI.Graphics().circle(0, 0, rand(1, 2.6)).fill(cor);
      g.x = x; g.y = y;
      g.vx = Math.cos(ang) * vel;
      g.vy = Math.sin(ang) * vel;
      g.vida = g.vidaMax = rand(0.3, 0.7);
      mundo.addChild(g);
      faiscas.push(g);
    }
  }

  function moverFaiscas(dt) {
    for (const f of faiscas) {
      f.x += f.vx * dt;
      f.y += f.vy * dt;
      f.vida -= dt;
      f.alpha = Math.max(0, f.vida / f.vidaMax);
    }
  }

  // ---------- textos ----------
  const fonte = 'ui-monospace, Consolas, monospace';
  const criarTexto = (tam, cor, align = 'left') =>
    new PIXI.Text({ text: '', style: { fontFamily: fonte, fontSize: tam, fill: cor, align, fontWeight: '700', letterSpacing: 1 } });

  const txtPontos = criarTexto(20, COR.verde);
  const txtVidas = criarTexto(20, COR.ouro);
  const txtRecorde = criarTexto(13, 0x8fa199);
  const txtTitulo = criarTexto(34, COR.branco, 'center');
  const txtAjuda = criarTexto(15, 0x8fa199, 'center');
  txtTitulo.anchor.set(0.5);
  txtAjuda.anchor.set(0.5, 0);
  txtVidas.anchor.set(1, 0);
  ui.addChild(txtPontos, txtVidas, txtRecorde, txtTitulo, txtAjuda);

  // ---------- estado do jogo ----------
  let estado = 'menu'; // menu | jogando | pausado | fim
  let pontos = 0, vidas = VIDAS, tempo = 0;
  let timerPedra = 0, timerTiro = 0, invencivel = 0, tremor = 0;
  let recorde = lerRecorde();

  // a cada 1500 pontos a arma melhora, até o nível 3
  const nivelArma = () => Math.min(3, 1 + Math.floor(pontos / 1500));

  function zerar() {
    [...tiros, ...pedras, ...faiscas].forEach(o => o.destroy());
    tiros = []; pedras = []; faiscas = [];
    pontos = 0; vidas = VIDAS; tempo = 0;
    timerPedra = 0; timerTiro = 0; tremor = 0;
    invencivel = 1.5; // um respiro no começo
    nave.x = app.screen.width / 2;
    nave.y = app.screen.height * 0.8;
    nave.visible = true;
  }

  function comecar() {
    zerar();
    estado = 'jogando';
    som.inicio();
  }

  function fimDeJogo() {
    estado = 'fim';
    nave.visible = false;
    explodir(nave.x, nave.y, COR.verde, 40, 260);
    som.explosao();
    if (pontos > recorde) {
      recorde = pontos;
      salvarRecorde(recorde);
    }
  }

  function pausar() {
    if (estado === 'jogando') estado = 'pausado';
    else if (estado === 'pausado') estado = 'jogando';
  }

  // ---------- controles ----------
  const teclas = new Set();
  let alvo = null; // onde o mouse/dedo tá puxando a nave
  const MAPA = { arrowleft: 'e', a: 'e', arrowright: 'd', d: 'd', arrowup: 'c', w: 'c', arrowdown: 'b', s: 'b' };

  addEventListener('keydown', ev => {
    const k = ev.key.toLowerCase();
    if (MAPA[k]) {
      teclas.add(MAPA[k]);
      alvo = null; // teclado assumiu, esquece o mouse
      ev.preventDefault();
    } else if (k === 'p' || k === 'escape') pausar();
    else if (k === 'm') mudo = !mudo;
    else if ((k === ' ' || k === 'enter') && (estado === 'menu' || estado === 'fim')) comecar();
  });
  addEventListener('keyup', ev => {
    const d = MAPA[ev.key.toLowerCase()];
    if (d) teclas.delete(d);
  });
  // se sair da aba, pausa pra não perder a partida
  addEventListener('blur', () => { if (estado === 'jogando') estado = 'pausado'; });

  function mirar(ev) {
    // no celular a nave fica 70px acima do dedo, senão o dedo cobre ela
    alvo = { x: ev.clientX, y: ev.clientY - (ev.pointerType === 'touch' ? 70 : 0) };
  }
  addEventListener('pointermove', ev => {
    if (ev.pointerType !== 'mouse' || estado === 'jogando') mirar(ev);
  });
  addEventListener('pointerdown', ev => {
    mirar(ev);
    if (estado === 'menu' || estado === 'fim') comecar();
    else if (estado === 'pausado') estado = 'jogando';
  });

  // ---------- loop principal ----------
  function atualizar(dt) {
    const w = app.screen.width, h = app.screen.height;
    tempo += dt;

    // --- mexer a nave ---
    let vx = 0, vy = 0;
    if (teclas.size) {
      vx = (teclas.has('d') ? 1 : 0) - (teclas.has('e') ? 1 : 0);
      vy = (teclas.has('b') ? 1 : 0) - (teclas.has('c') ? 1 : 0);
      const tam = Math.hypot(vx, vy) || 1; // normaliza pra diagonal não ser mais rápida
      vx = (vx / tam) * VEL_NAVE;
      vy = (vy / tam) * VEL_NAVE;
    } else if (alvo) {
      // segue o ponteiro com uma inércia leve
      vx = limita((alvo.x - nave.x) * 10, -VEL_NAVE * 1.6, VEL_NAVE * 1.6);
      vy = limita((alvo.y - nave.y) * 10, -VEL_NAVE * 1.6, VEL_NAVE * 1.6);
    }
    nave.x = limita(nave.x + vx * dt, 16, w - 16);
    nave.y = limita(nave.y + vy * dt, 16, h - 16);
    nave.rotation = limita(vx / VEL_NAVE, -1, 1) * 0.25; // inclina um pouco ao virar
    chama.scale.y = 0.7 + Math.random() * 0.6; // chama tremendo
    invencivel = Math.max(0, invencivel - dt);
    nave.alpha = invencivel > 0 ? (Math.floor(invencivel * 12) % 2 ? 0.25 : 1) : 1; // pisca

    // --- atirar ---
    timerTiro -= dt;
    if (timerTiro <= 0) {
      timerTiro = INTERVALO_TIRO;
      const nv = nivelArma();
      if (nv === 1) {
        criarTiro(nave.x, nave.y - 20, 0);
      } else if (nv === 2) {
        criarTiro(nave.x - 9, nave.y - 14, 0);
        criarTiro(nave.x + 9, nave.y - 14, 0);
      } else {
        criarTiro(nave.x, nave.y - 20, 0);
        criarTiro(nave.x - 11, nave.y - 12, -110);
        criarTiro(nave.x + 11, nave.y - 12, 110);
      }
      som.tiro();
    }

    // --- pedras: quanto mais tempo, mais rápido e mais frequente ---
    timerPedra -= dt;
    if (timerPedra <= 0) {
      timerPedra = Math.max(0.3, 1.05 - tempo * 0.012);
      const sorteio = Math.random();
      const tam = sorteio < 0.45 ? 1 : sorteio < 0.8 ? 2 : 3;
      const queda = Math.min(260, 90 + tempo * 2.5);
      criarPedra(tam, rand(0, w), -60, rand(-50, 50), rand(queda * 0.7, queda * 1.3));
    }

    for (const t of tiros) { t.x += t.vx * dt; t.y += t.vy * dt; }
    for (const p of pedras) {
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      p.rotation += p.giro * dt;
      // sai por um lado, volta pelo outro
      if (p.x < -80) p.x = w + 80;
      else if (p.x > w + 80) p.x = -80;
    }
    moverEstrelas(dt);
    moverFaiscas(dt);

    // --- tiro acertou pedra? ---
    for (const t of tiros) {
      if (t.morto) continue;
      for (const p of pedras) {
        if (p.morta) continue;
        if (dist2(t, p) >= (t.raio + p.raio) ** 2) continue;

        t.morto = true;
        p.vida--;
        if (p.vida > 0) {
          // ainda aguenta, só dá um efeitinho
          som.acerto();
          explodir(t.x, t.y, COR.ouro, 4, 90);
          p.scale.set(0.85 + p.vida / (p.tam * 6.7)); // encolhe um pouco pra dar feedback
          break;
        }
        p.morta = true;
        pontos += p.tam * 10;
        explodir(p.x, p.y, COR.ouro, 8 + p.tam * 4);
        som.explosao();
        tremor = Math.max(tremor, p.tam * 1.5);
        // pedra grande quebra em duas menores
        if (p.tam > 1) {
          criarPedra(p.tam - 1, p.x - 10, p.y, p.vx - 70, p.vy);
          criarPedra(p.tam - 1, p.x + 10, p.y, p.vx + 70, p.vy);
        }
        break;
      }
    }

    // --- pedra acertou a nave? ---
    if (invencivel <= 0) {
      for (const p of pedras) {
        if (p.morta || dist2(nave, p) >= (nave.raio + p.raio) ** 2) continue;
        p.morta = true;
        vidas--;
        invencivel = 2;
        tremor = 14;
        explodir(nave.x, nave.y, COR.verde, 18, 200);
        som.dano();
        if (vidas <= 0) fimDeJogo();
        break;
      }
    }

    // --- limpa o que morreu ou saiu da tela (senão vaza memória) ---
    const limpar = (lista, fica) => lista.filter(o => {
      if (fica(o)) return true;
      o.destroy();
      return false;
    });
    tiros = limpar(tiros, t => !t.morto && t.y > -30 && t.x > -30 && t.x < w + 30);
    pedras = limpar(pedras, p => !p.morta && p.y < h + 100);
    faiscas = limpar(faiscas, f => f.vida > 0);
  }

  function desenharTextos() {
    const w = app.screen.width, h = app.screen.height;
    txtPontos.text = `PONTOS ${pontos}`;
    txtVidas.text = `VIDAS ${Math.max(vidas, 0)}  ARMA ${nivelArma()}`;
    txtRecorde.text = `RECORDE ${Math.max(recorde, pontos)}`;
    txtPontos.position.set(16, 14);
    txtVidas.position.set(w - 16, 14);
    txtRecorde.position.set(16, 40);
    txtTitulo.position.set(w / 2, h / 2 - 20);
    txtAjuda.position.set(w / 2, h / 2 + 26);

    const novoRecorde = pontos >= recorde && pontos > 0 ? ' - novo recorde!' : '';
    const mensagens = {
      menu: ['METEOR DASH', 'WASD / setas / mouse / toque, o tiro é automático\nClique ou ESPAÇO pra jogar'],
      pausado: ['PAUSADO', 'Clique ou P pra continuar'],
      fim: ['FIM DE JOGO', `Você fez ${pontos} pontos${novoRecorde}\nClique ou ESPAÇO pra jogar de novo`],
      jogando: ['', ''],
    };
    [txtTitulo.text, txtAjuda.text] = mensagens[estado];
  }

  app.ticker.add(ticker => {
    // limita o dt: se a aba travar um pouco, os meteoros não teletransportam
    const dt = Math.min(ticker.deltaMS / 1000, 0.05);

    if (estado === 'jogando') {
      atualizar(dt);
    } else if (estado === 'menu' || estado === 'fim') {
      // fundo continua animado no menu e na tela de fim
      moverEstrelas(dt);
      moverFaiscas(dt);
      faiscas = faiscas.filter(f => {
        if (f.vida > 0) return true;
        f.destroy();
        return false;
      });
    }

    tremor = Math.max(0, tremor - dt * 30);
    mundo.position.set(rand(-tremor, tremor), rand(-tremor, tremor));
    desenharTextos();
  });

  // posição inicial (a nave só aparece depois do primeiro clique)
  nave.x = app.screen.width / 2;
  nave.y = app.screen.height * 0.8;
  nave.visible = false;

  // TODO: power-up de escudo, e talvez um boss a cada 5000 pontos
})();
