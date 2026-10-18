/* main.js — 启动流程、输入、区块流式加载、交互、存档、音效 */
(function () {
  'use strict';
  const MC = window.MC;
  const $ = (id) => document.getElementById(id);
  const canvas = $('game');

  const errBox = $('err');
  function fail(msg) {
    errBox.style.display = 'block';
    errBox.textContent += String(msg) + '\n';
  }
  window.addEventListener('error', (e) => fail((e.message || 'Error') + ' @' + (e.filename || '').split('/').pop() + ':' + e.lineno));

  /* ================= 种子与存档 ================= */
  const params = new URLSearchParams(location.search);
  const SAVE_KEY = 'mcweb.save.v1';

  function hashStr(s) {
    let h = 2166136261;
    for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
    return h | 0;
  }

  let saved = null;
  try { saved = JSON.parse(localStorage.getItem(SAVE_KEY) || 'null'); } catch (e) { saved = null; }
  if (!saved || !Array.isArray(saved.edits)) saved = null;
  if (saved && saved.terrainVersion !== 4 && saved.edits.length) {
    // Terrain changes under old builds; keep a restorable copy before migration.
    try {
      const backupKey = SAVE_KEY + '.before-terrain-v4';
      if (!localStorage.getItem(backupKey)) localStorage.setItem(backupKey, JSON.stringify(saved));
    } catch (e) { /* storage may be unavailable */ }
  }

  let seed;
  if (params.has('seed')) {
    const v = params.get('seed');
    seed = /^-?\d+$/.test(v) ? parseInt(v, 10) : hashStr(v);
  } else if (saved && typeof saved.seed === 'number') {
    seed = saved.seed;
  } else {
    seed = (Math.random() * 2e9 - 1e9) | 0;
  }

  const MAX_STACK = 64;
  const stack = (id, count, dur) => {
    const tool = MC.itemTool(id);
    return tool ? { id, count: 1, dur: Number.isFinite(dur) ?
      Math.max(1, Math.min(tool.maxDur, dur)) : tool.maxDur, maxDur: tool.maxDur } : { id, count };
  };
  const START_HOTBAR = [[1, 64], [2, 64], [3, 64], [4, 64], [5, 64], [7, 64], [9, 64], [19, 1], [20, 64]];

  function parseStacks(list, size) {
    const out = new Array(size).fill(null);
    if (!Array.isArray(list)) return out;
    for (let i = 0; i < size && i < list.length; i++) {
      const v = list[i];
      if (Array.isArray(v) && v.length >= 2 && v[0] > 0 && v[1] > 0)
        out[i] = stack(v[0], v[1], v[2]);
    }
    return out;
  }

  const world = new MC.World(seed, saved && saved.seed === seed ? saved.edits : null);
  const player = new MC.Player(world);
  if (saved && saved.seed === seed && saved.player && Array.isArray(saved.player.pos)) {
    const p = saved.player.pos;
    // 旧档没有 player 字段；损坏坐标也不应阻止进入世界。
    if (p.length === 3 && p.every(Number.isFinite) &&
        Math.abs(p[0]) < 1000000 && p[1] >= -10 && p[1] < 256 && Math.abs(p[2]) < 1000000) {
      player.pos[0] = p[0]; player.pos[1] = p[1]; player.pos[2] = p[2];
      if (Number.isFinite(saved.player.yaw)) player.yaw = saved.player.yaw;
      if (Number.isFinite(saved.player.pitch)) player.pitch = Math.max(-1.54, Math.min(1.54, saved.player.pitch));
      player.flying = !!saved.player.flying;
    }
  }
  const mobManager = new MC.MobManager(world);
  player.mobs = mobManager.mobs;

  let renderer;
  try {
    renderer = new MC.Renderer(canvas);
  } catch (e) {
    fail(e.message);
    $('title').textContent = '无法启动';
    $('subtitle').textContent = e.message;
    $('loadText').textContent = '请使用支持 WebGL2 的浏览器（Chrome / Edge / Safari 15+）';
    return;
  }
  const particles = new MC.Particles(renderer);
  const horizon = new MC.Horizon(world, renderer);

  /* ================= 状态 ================= */
  let storage = null;
  try { storage = window.localStorage; } catch (_) { /* 隐私模式下仍可游玩。 */ }
  const settings = new MC.Settings(storage);

  // 触屏设备检测：iPadOS 的 UA 是 Macintosh，所以看 maxTouchPoints + coarse。
  const coarsePointer = window.matchMedia && window.matchMedia('(pointer: coarse)').matches;
  const mobileUA = /Android|iPhone|iPad|iPod|Mobile/i.test(navigator.userAgent);
  // iPadOS 13+ 默认伪装成 Macintosh，只能靠触点数认出来。
  const iPadOS = /Macintosh/.test(navigator.userAgent) && (navigator.maxTouchPoints || 0) > 1;
  const finePointer = window.matchMedia && window.matchMedia('(pointer: fine)').matches;
  const touchCapable = mobileUA || iPadOS || ((navigator.maxTouchPoints || 0) > 0 && coarsePointer);
  // 纯触屏设备不提供「键鼠」选项，避免选完没有输入方式；触屏笔记本三种都保留。
  const inputCycle = touchCapable && !finePointer ? ['auto', 'touch']
    : touchCapable ? ['auto', 'touch', 'mouse'] : ['auto', 'mouse'];
  let inputMode = settings.values.inputMode;
  if (!inputCycle.includes(inputMode)) {
    inputMode = 'auto';
    settings.set('inputMode', 'auto');
  }
  let touchMode = inputMode === 'touch' || (inputMode === 'auto' && touchCapable);

  let RENDER_R = settings.values.distance;
  renderer.resolutionScale = settings.values.resolution;
  renderer.shadowEnabled = settings.values.shadows;
  particles.setEnabled(settings.values.particles);
  const state = {
    mode: 'loading',            // loading | menu | playing | paused | inventory
    selected: 0,
    hotbar: START_HOTBAR.map(([id, c]) => stack(id, c)),
    bag: new Array(27).fill(null),
    cursor: null,
    invTab: 'bag',
    craftGrid: new Array(9).fill(0),
    craftRecipe: null,
    mine: null,
    mouseDown: [false, false],
    breakTimer: 0,
    placeTimer: 0,
    attackTimer: 0,
    swing: 1,
    fps: 0,
    auto: params.has('auto'),
    time: saved && saved.seed === seed && Number.isFinite(saved.time) && saved.time >= 0 ? saved.time : 0,
    seen: saved && saved.seed === seed && saved.secrets && typeof saved.secrets === 'object' ?
      saved.secrets : {},
    flags: saved && saved.seed === seed && saved.flags && typeof saved.flags === 'object' ?
      saved.flags : {},
    explored: saved && saved.seed === seed && Array.isArray(saved.explored) ?
      saved.explored.filter(p => Array.isArray(p) && Number.isFinite(p[0]) && Number.isFinite(p[1]))
        .slice(-640) : [],
    debug: false,
    wasInWater: false,
    touchMode
  };
  if (saved && saved.seed === seed) {
    if (Array.isArray(saved.hotbar)) state.hotbar = parseStacks(saved.hotbar, 9);
    if (Array.isArray(saved.inv)) state.bag = parseStacks(saved.inv, 27);
  }
  const minimap = new MC.Minimap(world, $('miniMapWrap'), $('miniMap'), state);
  let secrets = null;
  const keys = Object.create(null);
  const input = { forward: false, back: false, left: false, right: false,
    jump: false, descend: false, sprint: false, moveX: 0, moveZ: 0 };
  const touchState = { stickX: 0, stickY: 0, jump: false, descend: false,
    lookId: null, lookX: 0, lookY: 0, stickId: null };

  /* ================= 音效 ================= */
  /* 每种方块一套音色：噪声中心频率 / Q / 音量 / 低音敲击 */
  const SND = {};
  SND[MC.Block.GRASS]   = { nf: 560,  q: 0.7, g: 0.24, tone: 120,  tg: 0.10 };
  SND[MC.Block.DIRT]    = { nf: 430,  q: 0.8, g: 0.24, tone: 95,   tg: 0.09 };
  SND[MC.Block.STONE]   = { nf: 1750, q: 1.2, g: 0.24, tone: 220,  tg: 0.06 };
  SND[MC.Block.COBBLE]  = { nf: 1500, q: 1.1, g: 0.24, tone: 200,  tg: 0.06 };
  SND[MC.Block.SAND]    = { nf: 900,  q: 0.6, g: 0.20, tone: 0,    tg: 0 };
  SND[MC.Block.WATER]   = { nf: 420,  q: 0.5, g: 0.18, tone: 0,    tg: 0 };
  SND[MC.Block.LOG]     = { nf: 520,  q: 0.9, g: 0.26, tone: 130,  tg: 0.12 };
  SND[MC.Block.LEAVES]  = { nf: 1100, q: 0.7, g: 0.20, tone: 0,    tg: 0 };
  SND[MC.Block.PLANKS]  = { nf: 680,  q: 0.9, g: 0.24, tone: 150,  tg: 0.10 };
  SND[MC.Block.GLASS]   = { nf: 3000, q: 1.4, g: 0.22, tone: 1500, tg: 0.05 };
  SND[MC.Block.BRICK]   = { nf: 1600, q: 1.1, g: 0.24, tone: 190,  tg: 0.06 };
  SND[MC.Block.SNOW]    = { nf: 1000, q: 0.6, g: 0.16, tone: 0,    tg: 0 };
  SND[MC.Block.BEDROCK] = { nf: 1600, q: 1.2, g: 0.24, tone: 180,  tg: 0.07 };

  class Sfx {
    constructor() {
      this.ctx = null;
      this.master = null;
      this.muffle = null;
      this.noiseBuf = null;
      this.underwater = false;
      this.uw = null;
    }

    init() {
      if (this.ctx) {
        if (this.ctx.state === 'suspended') this.ctx.resume();
        return;
      }
      const AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return;
      const ctx = this.ctx = new AC();

      this.master = ctx.createGain();
      this.master.gain.value = 0.55;

      const comp = ctx.createDynamicsCompressor();
      comp.threshold.value = -20;
      comp.knee.value = 18;
      comp.ratio.value = 4;
      comp.attack.value = 0.004;
      comp.release.value = 0.18;

      this.muffle = ctx.createBiquadFilter();
      this.muffle.type = 'lowpass';
      this.muffle.frequency.value = 18000;
      this.muffle.Q.value = 0.6;

      this.master.connect(comp);
      comp.connect(this.muffle);
      this.muffle.connect(ctx.destination);
      // 调试用：给音效留一个分析口，方便自动化验证
      this.analyser = ctx.createAnalyser();
      this.analyser.fftSize = 1024;
      comp.connect(this.analyser);

      const len = Math.floor(ctx.sampleRate * 0.5);
      const buf = ctx.createBuffer(1, len, ctx.sampleRate);
      const d = buf.getChannelData(0);
      for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
      this.noiseBuf = buf;
    }

    /** 噪声脉冲：带通 + 快速衰减 */
    noise(freq, dur, q, gain, rate) {
      if (!this.ctx || gain <= 0.001) return;
      const ctx = this.ctx, t = ctx.currentTime;
      const src = ctx.createBufferSource();
      src.buffer = this.noiseBuf;
      src.playbackRate.value = rate || 1;
      const bp = ctx.createBiquadFilter();
      bp.type = 'bandpass';
      bp.frequency.value = freq;
      bp.Q.value = q;
      const lp = ctx.createBiquadFilter();
      lp.type = 'lowpass';
      lp.frequency.value = Math.min(9000, freq * 3.2);
      const g = ctx.createGain();
      g.gain.setValueAtTime(0.0001, t);
      g.gain.exponentialRampToValueAtTime(gain, t + 0.006);
      g.gain.exponentialRampToValueAtTime(0.0006, t + dur);
      src.connect(bp);
      bp.connect(lp);
      lp.connect(g);
      g.connect(this.master);
      src.start(t, Math.random() * 0.2);
      src.stop(t + dur + 0.03);
    }

    /** 低音敲击 / 泛音 */
    tone(freq, dur, gain, type, slide) {
      if (!this.ctx || gain <= 0.001) return;
      const ctx = this.ctx, t = ctx.currentTime;
      const o = ctx.createOscillator();
      o.type = type || 'sine';
      o.frequency.setValueAtTime(freq, t);
      if (slide) o.frequency.exponentialRampToValueAtTime(Math.max(30, freq * slide), t + dur);
      const g = ctx.createGain();
      g.gain.setValueAtTime(0.0001, t);
      g.gain.exponentialRampToValueAtTime(gain, t + 0.008);
      g.gain.exponentialRampToValueAtTime(0.0005, t + dur);
      o.connect(g);
      g.connect(this.master);
      o.start(t);
      o.stop(t + dur + 0.02);
    }

    dig(id) {
      const p = SND[id] || SND[MC.Block.STONE];
      const r = 0.92 + Math.random() * 0.16;
      this.noise(p.nf * r, 0.15, p.q, p.g, 1);
      if (p.tone) this.tone(p.tone * r, 0.16, p.tg, 'sine', 0.65);
    }

    place(id) {
      const p = SND[id] || SND[MC.Block.STONE];
      const r = 0.92 + Math.random() * 0.16;
      this.noise(p.nf * 0.72 * r, 0.12, p.q * 1.1, p.g * 0.9, 0.85);
      this.tone((p.tone || 110) * 0.72 * r, 0.10, (p.tg || 0.08) * 1.2, 'triangle', 0.75);
    }

    step(id) {
      const p = SND[id] || SND[MC.Block.GRASS];
      const r = 0.85 + Math.random() * 0.3;
      this.noise(p.nf * 0.55 * r, 0.09, p.q * 0.9, 0.055, 0.8);
    }

    splash(kind) {
      this.noise(kind === 'out' ? 900 : 600, 0.34, 0.5, kind === 'out' ? 0.14 : 0.22, 0.75);
      this.tone(kind === 'out' ? 220 : 160, 0.18, 0.06, 'sine', 1.6);
    }

    /** 羊叫：带颤音的锯齿波 */
    baa(gain) {
      if (!this.ctx) return;
      const ctx = this.ctx, t = ctx.currentTime, dur = 0.55;
      const o = ctx.createOscillator();
      o.type = 'sawtooth';
      o.frequency.setValueAtTime(330 + Math.random() * 40, t);
      o.frequency.linearRampToValueAtTime(250, t + dur);
      const vib = ctx.createOscillator();
      vib.frequency.value = 11;
      const vibGain = ctx.createGain();
      vibGain.gain.value = 14;
      vib.connect(vibGain);
      vibGain.connect(o.frequency);
      const bp = ctx.createBiquadFilter();
      bp.type = 'bandpass';
      bp.frequency.value = 750;
      bp.Q.value = 2.2;
      const g = ctx.createGain();
      g.gain.setValueAtTime(0.0001, t);
      g.gain.exponentialRampToValueAtTime(Math.max(0.01, gain), t + 0.06);
      g.gain.exponentialRampToValueAtTime(0.0006, t + dur);
      o.connect(bp); bp.connect(g); g.connect(this.master);
      o.start(t); vib.start(t);
      o.stop(t + dur); vib.stop(t + dur);
    }

    /** 鸡叫：两下短促的咯咯 */
    cluck(gain) {
      if (!this.ctx) return;
      const base = 950 + Math.random() * 220;
      for (let i = 0; i < 2; i++) {
        const delay = i * 0.13;
        setTimeout(() => {
          this.noise(base, 0.07, 2.6, gain, 1.1);
          this.tone(base * 0.7, 0.06, gain * 0.5, 'square', 0.8);
        }, delay * 1000);
      }
    }

    /** 水下环境底噪 */
    startAmbient() {
      if (!this.ctx || this.uw) return;
      const ctx = this.ctx;
      const src = ctx.createBufferSource();
      src.buffer = this.noiseBuf;
      src.loop = true;
      const lp = ctx.createBiquadFilter();
      lp.type = 'lowpass';
      lp.frequency.value = 300;
      lp.Q.value = 1.6;
      const g = ctx.createGain();
      g.gain.value = 0.05;
      src.connect(lp);
      lp.connect(g);
      g.connect(this.master);
      src.start();
      this.uw = { src, g };
    }

    stopAmbient() {
      if (!this.uw) return;
      const { src, g } = this.uw;
      const now = this.ctx.currentTime;
      g.gain.cancelScheduledValues(now);
      g.gain.setTargetAtTime(0.0001, now, 0.12);
      setTimeout(() => { try { src.stop(); } catch (e) { /* ignore */ } }, 400);
      this.uw = null;
    }

    bubble(gain) {
      const f = 420 + Math.random() * 420;
      this.tone(f, 0.09, gain, 'sine', 2.4);
      this.noise(1100, 0.035, 3, gain * 0.35, 1.3);
    }

    setUnderwater(on) {
      if (!this.ctx || this.underwater === on) return;
      this.underwater = on;
      this.muffle.frequency.setTargetAtTime(on ? 620 : 18000, this.ctx.currentTime, 0.12);
      if (on) this.startAmbient(); else this.stopAmbient();
    }
  }
  const sfx = new Sfx();
  function animalSound(type, gain) {
    if (type === 'sheep') sfx.baa(gain);
    else if (type === 'chicken') sfx.cluck(gain);
    else if (type === 'cow') sfx.tone(135 + Math.random() * 30, 0.42, gain, 'sawtooth', 0.72);
    else if (type === 'pig') {
      sfx.tone(240 + Math.random() * 35, 0.19, gain, 'square', 0.65);
      sfx.noise(520, 0.11, 1.1, gain * 0.4, 0.8);
    } else if (type === 'rabbit') sfx.tone(690, 0.08, gain * 0.45, 'sine', 1.3);
  }

  /* ================= 启动画面 ================= */
  const overlay = $('overlay');
  const titleEl = $('title');
  const subtitleEl = $('subtitle');
  const loadbox = $('loadbox');
  const barFill = $('barFill');
  const loadText = $('loadText');
  const primary = $('primary');
  const seedLabel = $('seedLabel');
  const crosshair = $('crosshair');
  const hudEl = $('hud');
  const hintEl = $('hint');
  const hotbarEl = $('hotbar');
  const itemName = $('itemName');
  const invEl = $('inv');
  const bagGridEl = $('bagGrid');
  const invHotbarEl = $('invHotbar');
  const creativeGridEl = $('creativeGrid');
  const bagPane = $('bagPane');
  const creativePane = $('creativePane');
  const cursorItemEl = $('cursorItem');
  const cursorCanvas = cursorItemEl.querySelector('canvas');
  const cursorCount = cursorItemEl.querySelector('span');
  const toastEl = $('toast');
  const underwaterEl = $('underwater');
  const craftEl = $('craft');
  const craftGridEl = $('craftGrid');
  const craftResultEl = $('craftResult');
  const craftHintEl = $('craftHint');
  const recipeListEl = $('recipeList');
  const craftPaletteEl = $('craftPalette');
  const tabBag = $('tabBag');
  const tabCreative = $('tabCreative');
  const invHint = $('invHint');
  const mineBar = $('minebar');
  const mineFill = $('minefill');
  const readEl = $('read');
  const readTitleEl = $('readTitle');
  const readTextEl = $('readText');
  const auroraEl = $('aurora');
  const meteorsEl = $('meteors');
  const flashEl = $('flash');
  const touchEl = $('touch');
  const touchLookEl = $('touchLook');
  const stickBaseEl = $('stickBase');
  const stickKnobEl = $('stickKnob');
  const touchHintEl = $('touchHint');
  const touchMineEl = $('touchMine');
  const touchPlaceEl = $('touchPlace');
  const touchJumpEl = $('touchJump');
  const touchFlyEl = $('touchFly');
  const touchDownEl = $('touchDown');
  const touchBagEl = $('touchBag');
  const touchMenuEl = $('touchMenu');
  const inputBtn = $('inputBtn');
  const deviceHint = $('deviceHint');
  const mobileHelp = $('mobileHelp');
  const heldItemEl = $('heldItem');
  const heldItemInner = $('heldItemInner');
  const heldItemCanvas = $('heldItemCanvas');
  let heldIconId = null;

  seedLabel.textContent = '种子 ' + seed;

  function showMenu() {
    overlay.classList.remove('hide');
    titleEl.textContent = '远野';
    titleEl.classList.remove('small');
    subtitleEl.textContent = '一方世界，无限远方';
    loadbox.style.display = 'none';
    primary.textContent = '进入世界 ↗';
    primary.disabled = false;
    seedLabel.textContent = '种子 ' + seed;
  }

  function showPause() {
    overlay.classList.remove('hide');
    titleEl.textContent = '旅途暂停';
    titleEl.classList.add('small');
    subtitleEl.textContent = '世界会自动保存在本地';
    loadbox.style.display = 'none';
    primary.textContent = '继续探索 ↗';
    primary.disabled = false;
    seedLabel.textContent = '种子 ' + seed;
  }

  function hideOverlay() {
    syncTouchUI();
    overlay.classList.add('hide');
    crosshair.classList.add('show');
    hudEl.classList.add('show');
    hintEl.classList.add('show');
    hotbarEl.classList.add('show');
  }

  /* ================= 快捷栏 ================= */
  function buildHotbar() {
    hotbarEl.innerHTML = '';
    for (let i = 0; i < 9; i++) {
      const slot = document.createElement('div');
      slot.className = 'slot' + (i === state.selected ? ' sel' : '');
      slot.dataset.index = i;
      const cv = document.createElement('canvas');
      cv.style.width = '42px';
      cv.style.height = '42px';
      const num = document.createElement('div');
      num.className = 'num';
      num.textContent = i + 1;
      const cnt = document.createElement('div');
      cnt.className = 'count';
      slot.appendChild(cv);
      slot.appendChild(num);
      slot.appendChild(cnt);
      hotbarEl.appendChild(slot);
      paintSlot(i);
    }
  }

  function paintSlot(i) {
    const slot = hotbarEl.children[i];
    if (!slot) return;
    const cv = slot.querySelector('canvas');
    const cnt = slot.querySelector('.count');
    const st = state.hotbar[i];
    const oldBar = slot.querySelector('.durability');
    if (oldBar) oldBar.remove();
    slot.removeAttribute('title');
    if (st) {
      MC.itemIcon(cv, st.id, 96);
      cnt.textContent = st.count > 1 ? st.count : '';
      if (st.maxDur) addDurabilityBar(slot, st);
    } else {
      cv.width = 96;
      cv.height = 96;
      cv.getContext('2d').clearRect(0, 0, 96, 96);
      cnt.textContent = '';
    }
  }

  function addDurabilityBar(el, st) {
    const bar = document.createElement('div');
    bar.className = 'durability';
    const fill = document.createElement('i');
    const ratio = Math.max(0, st.dur / st.maxDur);
    fill.style.width = (ratio * 100).toFixed(1) + '%';
    fill.style.backgroundColor = 'hsl(' + Math.round(ratio * 112) + ' 88% 52%)';
    bar.appendChild(fill);
    el.appendChild(bar);
    el.title = MC.itemName(st.id) + ' · 耐久 ' + st.dur + '/' + st.maxDur;
  }

  function swingHand() {
    state.swing = 0;
  }

  function updateHeldItem(held, playing) {
    heldItemEl.hidden = !playing || !held;
    if (heldItemEl.hidden) return;
    if (heldIconId !== held.id) {
      MC.itemIcon(heldItemCanvas, held.id, 180);
      heldIconId = held.id;
    }
    const bob = Math.sin(player.bobPhase * 2) * 4 * player.bobAmount;
    const swing = Math.sin(state.swing * Math.PI);
    heldItemEl.style.transform = 'translate3d(0,' + bob.toFixed(1) + 'px,0)';
    heldItemInner.style.transform = 'translate(' + (-16 * swing).toFixed(1) + 'px,' +
      (34 * swing).toFixed(1) + 'px) rotate(' + (-16 * swing).toFixed(1) + 'deg)';
  }

  function refreshSlot(i) {
    paintSlot(i);
  }

  let itemTimer = null;
  function showItemName(name) {
    itemName.textContent = name;
    itemName.classList.add('show');
    clearTimeout(itemTimer);
    itemTimer = setTimeout(() => itemName.classList.remove('show'), 1300);
  }

  function selectSlot(i, silent) {
    if (i < 0) i = 8;
    if (i > 8) i = 0;
    state.selected = i;
    for (let k = 0; k < hotbarEl.children.length; k++) {
      hotbarEl.children[k].classList.toggle('sel', k === i);
    }
    if (!silent) {
      const st = state.hotbar[i];
      const nm = st ? MC.itemName(st.id) : '';
      if (nm) showItemName(nm);
    }
  }

  /* ---------------- 背包 / 快捷栏 ---------------- */
  let mouseX = 0, mouseY = 0;
  window.addEventListener('mousemove', (e) => {
    mouseX = e.clientX;
    mouseY = e.clientY;
    if (state.cursor) moveCursor();
  });

  function makeInvSlot(st, sel) {
    const el = document.createElement('div');
    el.className = 'invSlot' + (sel ? ' sel' : '');
    const cv = document.createElement('canvas');
    if (st) MC.itemIcon(cv, st.id, 88);
    el.appendChild(cv);
    if (st && st.count > 1) {
      const cnt = document.createElement('span');
      cnt.className = 'cnt';
      cnt.textContent = st.count;
      el.appendChild(cnt);
    }
    if (st && st.maxDur) addDurabilityBar(el, st);
    return el;
  }

  function renderBag() {
    bagGridEl.innerHTML = '';
    for (let i = 0; i < state.bag.length; i++) {
      const el = makeInvSlot(state.bag[i]);
      el.addEventListener('click', () => clickSlot('bag', i));
      bagGridEl.appendChild(el);
    }
  }

  function renderInvHotbar() {
    invHotbarEl.innerHTML = '';
    for (let i = 0; i < 9; i++) {
      const el = makeInvSlot(state.hotbar[i], i === state.selected);
      el.addEventListener('click', () => clickSlot('hotbar', i));
      invHotbarEl.appendChild(el);
    }
  }

  function renderCreative() {
    creativeGridEl.innerHTML = '';
    for (const it of MC.ALL_ITEMS) {
      if (MC.SECRET_ITEMS && MC.SECRET_ITEMS.has(it.id)) continue;
      const count = it.kind === 'tool' ? 1 : MAX_STACK;
      const el = makeInvSlot(stack(it.id, count));
      el.title = it.name;
      el.addEventListener('click', () => {
        if (state.cursor) return;
        state.cursor = stack(it.id, count);
        updateCursor();
      });
      creativeGridEl.appendChild(el);
    }
  }

  function renderInv() {
    const isBag = state.invTab === 'bag';
    bagPane.classList.toggle('hide', !isBag);
    creativePane.classList.toggle('hide', isBag);
    tabBag.classList.toggle('sel', isBag);
    tabCreative.classList.toggle('sel', !isBag);
    if (isBag) { renderBag(); renderInvHotbar(); }
    else renderCreative();
    invHint.textContent = isBag
      ? '挖到的材料自动进背包 · 点物品拿起，再点快捷栏格子替换'
      : '创造页可无限领取物品 · 点物品拿起，再切回「背包」放下';
  }

  function moveCursor() {
    cursorItemEl.style.left = mouseX + 'px';
    cursorItemEl.style.top = mouseY + 'px';
  }

  function updateCursor() {
    if (!state.cursor) {
      cursorItemEl.classList.add('hide');
      return;
    }
    cursorItemEl.classList.remove('hide');
    MC.itemIcon(cursorCanvas, state.cursor.id, 96);
    cursorCount.textContent = state.cursor.count > 1 ? state.cursor.count : '';
    moveCursor();
  }

  function clickSlot(where, index) {
    const arr = where === 'bag' ? state.bag : state.hotbar;
    const slot = arr[index];
    if (state.cursor) {
      if (!slot) {
        arr[index] = state.cursor;
        state.cursor = null;
      } else if (slot.id === state.cursor.id && !MC.itemTool(slot.id) && slot.count < MAX_STACK) {
        const add = Math.min(MAX_STACK - slot.count, state.cursor.count);
        slot.count += add;
        state.cursor.count -= add;
        if (state.cursor.count <= 0) state.cursor = null;
      } else {
        arr[index] = state.cursor;
        state.cursor = slot;
      }
    } else if (slot) {
      state.cursor = slot;
      arr[index] = null;
    }
    dirtySave = true;
    for (let i = 0; i < 9; i++) paintSlot(i);
    renderInv();
    updateCursor();
  }

  function addToBag(id, count) {
    if (!id || count <= 0) return 0;
    const isTool = !!MC.itemTool(id);
    let rest = count;
    for (const s of state.bag) {
      if (isTool) break;
      if (!s || s.id !== id || s.count >= MAX_STACK) continue;
      const add = Math.min(MAX_STACK - s.count, rest);
      s.count += add;
      rest -= add;
      if (rest <= 0) break;
    }
    for (let i = 0; i < state.bag.length && rest > 0; i++) {
      if (state.bag[i]) continue;
      const add = Math.min(isTool ? 1 : MAX_STACK, rest);
      state.bag[i] = stack(id, add);
      rest -= add;
    }
    dirtySave = true;
    return count - rest;
  }

  function addStackToBag(st) {
    if (!st) return true;
    if (st.maxDur) {
      const i = state.bag.findIndex(s => !s);
      if (i < 0) return false;
      state.bag[i] = st;
      dirtySave = true;
      return true;
    }
    const room = bagSpace(st.id);
    if (room < st.count) return false;
    addToBag(st.id, st.count);
    return true;
  }

  function bagSpace(id) {
    const isTool = !!MC.itemTool(id);
    let room = 0;
    for (const st of state.bag) {
      if (!st) room += isTool ? 1 : MAX_STACK;
      else if (!isTool && st.id === id) room += MAX_STACK - st.count;
    }
    return room;
  }

  function openInventory() {
    if (state.mode !== 'playing') return;
    state.mode = 'inventory';
    for (const k in keys) keys[k] = false;
    state.mouseDown[0] = state.mouseDown[1] = false;
    state.invTab = 'bag';
    renderInv();
    invEl.classList.remove('hide');
    if (document.pointerLockElement === canvas) document.exitPointerLock();
  }

  function closeInventory(relock) {
    if (state.mode !== 'inventory') return;
    if (state.cursor) {
      if (!addStackToBag(state.cursor)) {
        const empty = state.hotbar.findIndex(st => !st);
        if (empty < 0) { toast('背包已满，请先放下手上的物品'); return; }
        state.hotbar[empty] = state.cursor;
        paintSlot(empty);
      }
      state.cursor = null;
      updateCursor();
    }
    state.mode = 'playing';
    invEl.classList.add('hide');
    if (relock) requestLock();
  }

  /* ---------------- 合成台 ---------------- */
  function renderCraftGrid() {
    craftGridEl.innerHTML = '';
    for (let i = 0; i < 9; i++) {
      const id = state.craftGrid[i];
      const cell = document.createElement('div');
      cell.className = 'craftSlot' + (id ? ' filled' : '');
      if (id) {
        const cv = document.createElement('canvas');
        MC.itemIcon(cv, id, 84);
        cell.appendChild(cv);
      }
      cell.addEventListener('click', () => {
        state.craftGrid[i] = 0;
        renderCraftGrid();
        refreshCraft();
      });
      craftGridEl.appendChild(cell);
    }
  }

  function refreshCraft() {
    const rec = MC.craftMatch(state.craftGrid);
    state.craftRecipe = rec;
    craftResultEl.innerHTML = '';
    const missing = rec ? missingCraftMaterials(rec) : [];
    craftResultEl.classList.toggle('ready', !!rec && !missing.length);
    if (rec) {
      const cv = document.createElement('canvas');
      MC.itemIcon(cv, rec.out.id, 110);
      craftResultEl.appendChild(cv);
      if (rec.out.count > 1) {
        const cnt = document.createElement('span');
        cnt.className = 'resultCount';
        cnt.textContent = '×' + rec.out.count;
        craftResultEl.appendChild(cnt);
      }
      craftHintEl.textContent = missing.length ? '缺少 ' + missing.join('、') : '可以合成：' + rec.name;
    } else {
      craftHintEl.textContent = '没有匹配的配方 · 试试左边的工具配方';
    }
  }

  function missingCraftMaterials(rec) {
    const need = new Map();
    for (const id of MC.craftIngredients(rec)) need.set(id, (need.get(id) || 0) + 1);
    const missing = [];
    for (const [id, count] of need) {
      let have = 0;
      for (const st of state.bag) if (st && st.id === id) have += st.count;
      if (have < count) missing.push(MC.itemName(id) + ' ×' + (count - have));
    }
    return missing;
  }

  function takeCraft() {
    const rec = state.craftRecipe;
    if (!rec) return;
    const missing = missingCraftMaterials(rec);
    if (missing.length) { toast('缺少 ' + missing.join('、')); refreshCraft(); return; }
    const need = new Map();
    for (const id of MC.craftIngredients(rec)) need.set(id, (need.get(id) || 0) + 1);
    let outputRoom = bagSpace(rec.out.id);
    for (const [id, count] of need) {
      let left = count;
      for (const st of state.bag) {
        if (!st || st.id !== id || left <= 0) continue;
        const used = Math.min(left, st.count);
        if (used === st.count) outputRoom += MC.itemTool(rec.out.id) ? 1 : MAX_STACK;
        else if (id === rec.out.id) outputRoom += used;
        left -= used;
      }
    }
    if (outputRoom < rec.out.count) { toast('背包已满'); return; }
    for (const [id, count] of need) {
      let left = count;
      for (let i = 0; i < state.bag.length && left > 0; i++) {
        const st = state.bag[i];
        if (!st || st.id !== id) continue;
        const used = Math.min(left, st.count);
        st.count -= used;
        left -= used;
        if (st.count === 0) state.bag[i] = null;
      }
    }
    const got = addToBag(rec.out.id, rec.out.count);
    if (got !== rec.out.count) { toast('背包已满'); return; }
    showItemName(MC.itemName(rec.out.id));
    toast('合成 ' + rec.name + ' → 背包');
    state.craftGrid.fill(0);
    renderCraftGrid();
    refreshCraft();
  }

  function putInGrid(id) {
    for (let i = 0; i < 9; i++) {
      if (!state.craftGrid[i]) {
        state.craftGrid[i] = id;
        renderCraftGrid();
        refreshCraft();
        return;
      }
    }
    toast('网格已满');
  }

  function buildCraftUI() {
    renderCraftGrid();
    refreshCraft();
    recipeListEl.innerHTML = '';
    for (const rec of MC.RECIPES) {
      const btn = document.createElement('button');
      btn.className = 'recipeBtn';
      const cv = document.createElement('canvas');
      MC.itemIcon(cv, rec.out.id, 48);
      const label = document.createElement('span');
      label.textContent = rec.name;
      btn.appendChild(cv);
      btn.appendChild(label);
      btn.addEventListener('click', () => {
        state.craftGrid = MC.craftFill(rec);
        renderCraftGrid();
        refreshCraft();
      });
      recipeListEl.appendChild(btn);
    }
    craftPaletteEl.innerHTML = '';
    for (const it of MC.ALL_ITEMS) {
      if (it.kind === 'tool' || (MC.SECRET_ITEMS && MC.SECRET_ITEMS.has(it.id))) continue;
      const btn = document.createElement('button');
      btn.className = 'paletteBtn';
      btn.title = it.name;
      const cv = document.createElement('canvas');
      MC.itemIcon(cv, it.id, 68);
      btn.appendChild(cv);
      btn.addEventListener('click', () => putInGrid(it.id));
      craftPaletteEl.appendChild(btn);
    }
  }

  function openCrafting() {
    if (state.mode !== 'playing') return;
    state.mode = 'crafting';
    for (const k in keys) keys[k] = false;
    state.mouseDown[0] = state.mouseDown[1] = false;
    buildCraftUI();
    craftEl.classList.remove('hide');
    if (document.pointerLockElement === canvas) document.exitPointerLock();
  }

  function closeCrafting(relock) {
    if (state.mode !== 'crafting') return;
    state.mode = 'playing';
    craftEl.classList.add('hide');
    if (relock) requestLock();
  }

  let toastTimer = null;
  function toast(msg) {
    toastEl.textContent = msg;
    toastEl.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => toastEl.classList.remove('show'), 1700);
  }

  /* ================= 区块流式加载 ================= */
  function makeOffsets(r) {
    const a = [];
    for (let dz = -r; dz <= r; dz++) {
      for (let dx = -r; dx <= r; dx++) a.push({ dx, dz, d: dx * dx + dz * dz });
    }
    a.sort((p, q) => p.d - q.d);
    return a;
  }

  let OFFSETS_GEN = makeOffsets(RENDER_R + 1);

  function buildChunkMesh(chunk) {
    const mesh = MC.meshChunk(world, chunk);
    renderer.uploadChunk(chunk, mesh);
    chunk.dirty = false;
  }

  function rebuildNear(x, z) {
    const cx = x >> 4, cz = z >> 4;
    const list = [[cx, cz], [cx + 1, cz], [cx - 1, cz], [cx, cz + 1], [cx, cz - 1]];
    for (const [ax, az] of list) {
      const c = world.getChunk(ax, az);
      if (c && c.dirty && world.neighborsReady(ax, az)) buildChunkMesh(c);
    }
  }

  function stream() {
    const deadline = performance.now() + 4;
    const pcx = Math.floor(player.pos[0] / 16);
    const pcz = Math.floor(player.pos[2] / 16);
    let genBudget = 1, meshBudget = 1;
    // 单个区块仍是原子任务；每帧至多各做一次，超预算立即让出主线程。
    for (let i = 0; i < OFFSETS_GEN.length; i++) {
      if (performance.now() >= deadline || (genBudget <= 0 && meshBudget <= 0)) break;
      const o = OFFSETS_GEN[i], cx = pcx + o.dx, cz = pcz + o.dz;
      const c = world.getChunk(cx, cz);
      if (!c) {
        if (genBudget > 0) { world.ensureChunk(cx, cz); genBudget--; }
        continue;
      }
      if (meshBudget > 0 && Math.abs(o.dx) <= RENDER_R && Math.abs(o.dz) <= RENDER_R &&
          c.dirty && world.neighborsReady(cx, cz)) {
        buildChunkMesh(c);
        meshBudget--;
      }
    }
  }

  function unloadFar() {
    const pcx = Math.floor(player.pos[0] / 16);
    const pcz = Math.floor(player.pos[2] / 16);
    const drop = [];
    for (const c of world.chunks.values()) {
      if (Math.abs(c.cx - pcx) > RENDER_R + 2 || Math.abs(c.cz - pcz) > RENDER_R + 2) drop.push(c);
    }
    for (const c of drop) {
      renderer.disposeChunk(c);
      world.unloadChunk(c);
    }
  }

  /* ================= 相机 ================= */
  const cam = { x: 0, y: 0, z: 0, yaw: 0, pitch: 0, fov: 65, fogFar: 120 };
  const hand = { itemId: 0, swing: 1, bobPhase: 0, bobAmount: 0 };
  function updateCamera(dt) {
    const e = player.eye();
    cam.x = e[0];
    cam.y = e[1];
    cam.z = e[2];
    cam.yaw = player.yaw;
    cam.pitch = player.pitch;
    if (state.mode === 'menu' || state.mode === 'loading') {
      cam.y += 17;
      cam.pitch = -0.34;
    }
    cam.fogFar = 440;
    const under = MC.Block.isLiquid(world.getBlock(Math.floor(cam.x), Math.floor(cam.y), Math.floor(cam.z)));
    if (under !== cam.underwater) {
      cam.underwater = under;
      underwaterEl.classList.toggle('show', under);
      sfx.setUnderwater(under);
    }
    const targetFov = settings.values.fov + (player.sprinting ? 3 : 0);
    cam.fov += (targetFov - cam.fov) * Math.min(1, dt * 8);
  }

  const visibleChunks = [];
  function drawList() {
    const out = visibleChunks;
    out.length = 0;
    const pcx = Math.floor(player.pos[0] / 16);
    const pcz = Math.floor(player.pos[2] / 16);
    for (const c of world.chunks.values()) {
      if (!c.gpu) continue;
      if (Math.abs(c.cx - pcx) > RENDER_R + 1 || Math.abs(c.cz - pcz) > RENDER_R + 1) continue;
      out.push(c);
    }
    return out;
  }

  /* ================= 交互 ================= */
  function targetInfo() {
    const e = player.eye();
    const cp = Math.cos(player.pitch);
    const dx = -Math.sin(player.yaw) * cp;
    const dy = Math.sin(player.pitch);
    const dz = -Math.cos(player.yaw) * cp;
    return MC.raycast(world, e[0], e[1], e[2], dx, dy, dz, 5.5);
  }

  function targetMob(blockHit) {
    const e = player.eye();
    const cp = Math.cos(player.pitch);
    const dx = -Math.sin(player.yaw) * cp;
    const dy = Math.sin(player.pitch);
    const dz = -Math.cos(player.yaw) * cp;
    const hit = mobManager.raycast(e[0], e[1], e[2], dx, dy, dz, 3.2);
    return hit && (!blockHit || hit.t < blockHit.t - 1e-3) ? hit.mob : null;
  }

  function overlapsPlayer(bx, by, bz) {
    const r = player.radius - 0.02;
    const px = player.pos[0], py = player.pos[1], pz = player.pos[2];
    return bx + 1 > px - r && bx < px + r &&
           by + 1 > py + 0.001 && by < py + player.height - 0.001 &&
           bz + 1 > pz - r && bz < pz + r;
  }

  function overlapsMob(bx, by, bz) {
    for (const mob of mobManager.mobs) {
      if (mob.dead || mob.dying || by + 1 <= mob.pos[1] || by >= mob.pos[1] + mob.h) continue;
      if (bx + 1 > mob.pos[0] - mob.r && bx < mob.pos[0] + mob.r &&
          bz + 1 > mob.pos[2] - mob.r && bz < mob.pos[2] + mob.r) return true;
    }
    return false;
  }

  function attackMob(mob) {
    const held = state.hotbar[state.selected];
    const tool = MC.itemTool(held ? held.id : 0);
    const swordDamage = { wood: 4, stone: 5, iron: 6, gold: 4, diamond: 7 };
    const damage = tool && tool.type === 'sword' ? swordDamage[tool.tier] : tool ? 2 : 1;
    const dx = -Math.sin(player.yaw), dz = -Math.cos(player.yaw);
    const defeated = mobManager.attack(mob, damage, dx, dz);
    particles.burst(mob.pos[0], mob.pos[1] + mob.h * 0.6, mob.pos[2], MC.Block.WOOL,
      defeated ? 16 : 7, 'hit');
    if (tool && tool.type === 'sword') wearHeldTool();
    swingHand();
    sfx.noise(210, 0.09, 0.9, 0.11, 0.8);
    animalSound(mob.type, 0.10);
    if (defeated) {
      const drop = mob.moonlit ? MC.ITEM_KEY.moon_wool :
        mob.type === 'sheep' ? MC.Block.WOOL :
        mob.type === 'cow' ? MC.ITEM_KEY.raw_beef :
        mob.type === 'pig' ? MC.ITEM_KEY.raw_pork :
        mob.type === 'rabbit' ? MC.ITEM_KEY.leather : MC.ITEM_KEY.feather;
      const got = addToBag(drop, 1);
      toast(got ? '获得 ' + MC.itemName(drop) : '背包已满');
      dirtySave = true;
    }
  }

  function wearHeldTool() {
    const slot = state.selected, held = state.hotbar[slot];
    if (!held || !held.maxDur) return;
    held.dur--;
    if (held.dur <= 0) {
      const name = MC.itemName(held.id);
      state.hotbar[slot] = null;
      sfx.noise(1450, 0.06, 1.5, 0.17, 0.35);
      toast(name + ' 已损坏');
    }
    paintSlot(slot);
    dirtySave = true;
  }

  function resetMine() {
    state.mine = null;
    mineBar.classList.remove('show');
    mineFill.style.width = '0%';
  }

  function tryMine(dt) {
    const hit = targetInfo();
    if (!hit) { resetMine(); return; }
    const id = world.getBlock(hit.x, hit.y, hit.z);
    if (!id || id === MC.Block.BEDROCK || MC.Block.isLiquid(id)) { resetMine(); return; }
    const info = MC.MINE[id] || { hard: 0.6, tool: null };
    if (info.hard < 0) { resetMine(); return; }

    if (!state.mine || state.mine.x !== hit.x || state.mine.y !== hit.y || state.mine.z !== hit.z) {
      state.mine = { x: hit.x, y: hit.y, z: hit.z, progress: 0 };
    }
    const heldStack = state.hotbar[state.selected];
    const tool = MC.itemTool(heldStack ? heldStack.id : 0);
    const speed = (tool && info.tool && tool.type === info.tool) ? tool.speed : 1;
    state.mine.progress += dt * speed / Math.max(0.12, info.hard);
    mineBar.classList.add('show');
    mineFill.style.width = Math.min(100, state.mine.progress * 100).toFixed(1) + '%';
    if (state.mine.progress >= 1) {
      breakBlock(hit, id, info);
      resetMine();
    }
  }

  function blockDropId(id) {
    const info = MC.MINE[id];
    if (!info) return 0;
    if (info.dropItem) return MC.ITEM_KEY[info.dropItem] || 0;
    if (info.drop) return info.drop;
    if (id === MC.Block.WATER || id === MC.Block.BEDROCK) return 0;
    return id;
  }

  function breakBlock(hit, id, info) {
    // 水下挖方块：直接灌满水，避免留下奇怪的空气泡
    let flood = false;
    if (hit.y <= MC.WORLD.SEA) {
      const N6 = [[1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, -1, 0], [0, 0, 1], [0, 0, -1]];
      for (let i = 0; i < 6; i++) {
        if (MC.Block.isLiquid(world.getBlock(hit.x + N6[i][0], hit.y + N6[i][1], hit.z + N6[i][2]))) {
          flood = true;
          break;
        }
      }
    }
    if (!world.setBlock(hit.x, hit.y, hit.z, flood ? MC.Block.WATER : 0)) return;
    particles.burst(hit.x + 0.5, hit.y + 0.5, hit.z + 0.5, id, 8 + ((Math.random() * 5) | 0));
    wearHeldTool();
    rebuildNear(hit.x, hit.z);
    sfx.dig(id);
    swingHand();
    dirtySave = true;
    const dropId = blockDropId(id);
    if (dropId) {
      const got = addToBag(dropId, 1);
      if (!got) toast('背包已满');
      else if (info.dropItem) toast('获得 ' + MC.itemName(dropId) + '（已入背包）');
    }
  }

  function doPlace() {
    const hit = targetInfo();
    if (!hit) return;
    if (hit.id === MC.Block.TABLE) { openCrafting(); return; }
    if (hit.id === MC.Block.TABLET || hit.id === MC.Block.GLITCH) {
      const lore = secrets ? secrets.readLore(hit.x, hit.y, hit.z) : null;
      if (lore) openRead(lore);
      return;
    }
    if (hit.id === MC.Block.STONE_SWORD) {
      const lore = secrets ? secrets.swordStone(hit.x, hit.y, hit.z) : null;
      if (lore) openRead(lore);
      // 拔出来之后，石头里就只剩下一个孔。
      if (secrets && secrets.flags.swordPulled &&
          world.getBlock(hit.x, hit.y, hit.z) === MC.Block.STONE_SWORD) {
        world.setBlock(hit.x, hit.y, hit.z, 0);
        rebuildNear(hit.x, hit.z);
        dirtySave = true;
      }
      return;
    }
    const px = hit.x + hit.nx, py = hit.y + hit.ny, pz = hit.z + hit.nz;
    if (py < 0 || py >= MC.WORLD.HEIGHT) return;
    const cur = world.getBlock(px, py, pz);
    if (cur !== 0 && !MC.Block.isLiquid(cur)) return;
    const held = state.hotbar[state.selected];
    if (!held) return;
    const blockId = MC.itemBlock(held.id);
    if (!blockId) return;
    if (MC.Block.isSolid(blockId) && (overlapsPlayer(px, py, pz) || overlapsMob(px, py, pz))) return;
    if (world.setBlock(px, py, pz, blockId)) {
      held.count--;
      if (held.count <= 0) state.hotbar[state.selected] = null;
      paintSlot(state.selected);
      rebuildNear(px, pz);
      sfx.place(blockId);
      swingHand();
      dirtySave = true;
    }
  }

  function handleHold(dt) {
    state.swing = Math.min(1, state.swing + dt * 3.5);
    state.attackTimer = Math.max(0, state.attackTimer - dt);
    if (state.mouseDown[0] && state.swing >= 1) swingHand();
    state.placeTimer -= dt;
    if (state.mouseDown[0]) {
      const mob = targetMob(targetInfo());
      if (mob) {
        resetMine();
        if (state.attackTimer <= 0) {
          attackMob(mob);
          state.attackTimer = 0.48;
        }
      } else tryMine(dt);
    } else resetMine();
    if (state.mouseDown[1] && state.placeTimer <= 0) {
      doPlace();
      state.placeTimer = 0.24;
    }
  }

  /* ================= 输入 ================= */
  let lastSpace = -1;

  const KONAMI = ['ArrowUp', 'ArrowUp', 'ArrowDown', 'ArrowDown',
    'ArrowLeft', 'ArrowRight', 'ArrowLeft', 'ArrowRight', 'KeyB', 'KeyA'];
  const konamiBuf = [];
  function feedKonami(code) {
    konamiBuf.push(code);
    if (konamiBuf.length > KONAMI.length) konamiBuf.shift();
    if (konamiBuf.length !== KONAMI.length) return;
    if (KONAMI.every((c, i) => c === konamiBuf[i])) {
      konamiBuf.length = 0;
      if (secrets) secrets.konami();
    }
  }

  window.addEventListener('keydown', (e) => {
    if (e.code !== 'Escape' && e.target.matches('input, select, textarea')) return;
    if (e.code === 'Space' || (e.code === 'Tab' && state.mode === 'playing')) e.preventDefault();
    keys[e.code] = true;
    if (e.code === 'Escape') {
      if (state.mode === 'inventory') closeInventory(true);
      else if (state.mode === 'crafting') closeCrafting(true);
      else if (state.mode === 'reading') closeRead(true);
      else if (state.mode === 'playing') {
        pauseGame();
        if (document.pointerLockElement) document.exitPointerLock();
      }
      return;
    }
    if (e.repeat) return;
    if (state.mode === 'menu' || state.mode === 'paused') feedKonami(e.code);
    if ((e.code === 'KeyE' || e.code === 'KeyJ') && state.mode === 'reading') {
      e.preventDefault(); closeRead(true); return;
    }
    if (e.code === 'KeyE' && (state.mode === 'inventory' || state.mode === 'crafting')) {
      e.preventDefault();
      if (state.mode === 'inventory') closeInventory(true);
      else closeCrafting(true);
      return;
    }
    if (state.mode !== 'playing') return;

    if (e.code === 'KeyE') {
      e.preventDefault();
      openInventory();
    } else if (e.code === 'F3') {
      e.preventDefault();
      state.debug = !state.debug;
      $('debugStats').classList.toggle('show', state.debug);
    } else if (e.code === 'KeyF') {
      const f = player.toggleFly();
      toast(f ? '飞行模式 开' : '飞行模式 关');
    } else if (e.code === 'KeyM') {
      toast(minimap.toggle() ? '手绘地图 已展开' : '手绘地图 已收起');
    } else if (e.code === 'KeyT') {
      e.preventDefault();
      const quarter = Math.floor(state.time / (MC.DAY_LENGTH / 4));
      state.time = (quarter + 1) * (MC.DAY_LENGTH / 4);
      toast(['正午', '日落', '午夜', '日出'][(quarter + 1) % 4]);
      dirtySave = true;
    } else if (e.code === 'Space') {
      const now = performance.now();
      if (now - lastSpace < 300) {
        const f = player.toggleFly();
        toast(f ? '飞行模式 开' : '飞行模式 关');
        lastSpace = -1;
      } else {
        lastSpace = now;
      }
    } else if (/^Digit[1-9]$/.test(e.code)) {
      selectSlot(parseInt(e.code.slice(5), 10) - 1);
    } else if (e.code === 'KeyR' && e.ctrlKey) {
      e.preventDefault();
      location.reload();
    }
  });

  window.addEventListener('keyup', (e) => { keys[e.code] = false; });
  window.addEventListener('blur', () => {
    for (const k in keys) keys[k] = false;
    state.mouseDown[0] = state.mouseDown[1] = false;
  });

  window.addEventListener('mousemove', (e) => {
    if (touchMode) return;
    if (document.pointerLockElement !== canvas) return;
    if (state.mode !== 'playing') return;
    const s = 0.0022;
    player.yaw -= e.movementX * s;
    player.pitch -= e.movementY * s;
    const lim = Math.PI / 2 - 0.02;
    if (player.pitch > lim) player.pitch = lim;
    if (player.pitch < -lim) player.pitch = -lim;
  });

  canvas.addEventListener('mousedown', (e) => {
    if (touchMode) return;
    if (state.mode !== 'playing') return;
    if (!state.auto && document.pointerLockElement !== canvas) {
      requestLock();
      return;
    }
    if (e.button === 0) {
      state.mouseDown[0] = true;
      state.breakTimer = 0;
      swingHand();
    } else if (e.button === 2) {
      state.mouseDown[1] = true;
      state.placeTimer = 0;
    }
  });

  window.addEventListener('mouseup', (e) => {
    if (e.button === 0) state.mouseDown[0] = false;
    if (e.button === 2) state.mouseDown[1] = false;
  });

  window.addEventListener('contextmenu', (e) => e.preventDefault());

  window.addEventListener('wheel', (e) => {
    if (state.mode !== 'playing') return;
    e.preventDefault();
    const dir = e.deltaY > 0 ? 1 : -1;
    selectSlot((state.selected + dir + 9) % 9);
  }, { passive: false });

  document.addEventListener('pointerlockchange', () => {
    const locked = document.pointerLockElement === canvas;
    if (locked) {
      if (state.mode === 'menu' || state.mode === 'paused') startGame();
    } else if (state.mode === 'playing' && !state.auto && !touchMode) {
      pauseGame();
    }
  });
  document.addEventListener('pointerlockerror', () => {
    if (state.mode === 'playing') toast('点击画面锁定鼠标');
  });

  /* ================= 触屏操作 ================= */
  let touchHintTimer = null;

  function updateInputUI() {
    const isAuto = inputMode === 'auto';
    inputBtn.textContent = isAuto ? '操作：自动' : inputMode === 'touch' ? '操作：手机触屏' : '操作：键鼠';
    const names = { auto: '自动', touch: '手机触屏', mouse: '键鼠' };
    inputBtn.title = '自动检测触屏设备；点击切换 ' + inputCycle.map(m => names[m]).join(' / ');
    deviceHint.textContent = isAuto
      ? '自动检测到' + (touchCapable ? '触屏设备' : '键鼠设备') +
        ' · 当前使用' + (touchMode ? '手机操作' : '电脑操作')
      : '操作方式：' + (touchMode ? '手机触屏' : '键鼠') + '（点击上方按钮切换）';
    mobileHelp.hidden = !touchMode;
    state.touchMode = touchMode;
  }

  function resetTouchControls() {
    touchState.stickX = 0;
    touchState.stickY = 0;
    touchState.jump = false;
    touchState.descend = false;
    touchState.stickId = null;
    touchState.lookId = null;
    stickKnobEl.style.transform = '';
    stickBaseEl.classList.remove('active');
    for (const el of [touchMineEl, touchPlaceEl, touchJumpEl, touchDownEl]) el.classList.remove('active');
    // 桌面模式不要碰鼠标状态，否则会打断长按挖掘。
    if (touchMode) state.mouseDown[0] = state.mouseDown[1] = false;
  }

  function syncTouchUI() {
    const active = touchMode && state.mode === 'playing';
    document.body.classList.toggle('touch-mode', touchMode);
    document.body.classList.toggle('flying', player.flying);
    touchEl.classList.toggle('hide', !active);
    touchFlyEl.classList.toggle('active', player.flying);
    if (!active) resetTouchControls();
  }

  function showTouchHint() {
    if (!touchMode) return;
    clearTimeout(touchHintTimer);
    document.body.classList.add('touch-hint');
    touchHintEl.classList.remove('fade');
    touchHintEl.classList.add('show');
    touchHintTimer = setTimeout(() => {
      touchHintEl.classList.add('fade');
      touchHintTimer = setTimeout(() => {
        touchHintEl.classList.remove('show', 'fade');
        document.body.classList.remove('touch-hint');
      }, 600);
    }, 4600);
  }

  function setInputMode(mode) {
    if (!inputCycle.includes(mode)) return;
    settings.set('inputMode', mode);
    inputMode = mode;
    touchMode = mode === 'touch' || (mode === 'auto' && touchCapable);
    if (touchMode) {
      state.mouseDown[0] = state.mouseDown[1] = false;
      if (document.pointerLockElement) document.exitPointerLock();
    } else if (state.mode === 'playing') {
      requestLock();
    }
    updateInputUI();
    syncTouchUI();
    toast(touchMode ? '手机触屏操作' : '键鼠操作');
  }

  function bindTouchHold(el, down, up) {
    let held = false;
    const start = (e) => {
      if (!touchMode || held) return;
      e.preventDefault();
      held = true;
      el.classList.add('active');
      try { el.setPointerCapture(e.pointerId); } catch (_) { /* synthetic / old browser */ }
      if (down) down(e);
    };
    const end = () => {
      if (!held) return;
      held = false;
      el.classList.remove('active');
      if (up) up();
    };
    el.addEventListener('pointerdown', start);
    el.addEventListener('pointerup', end);
    el.addEventListener('pointercancel', end);
    el.addEventListener('lostpointercapture', end);
  }

  function bindTouchTap(el, action) {
    el.addEventListener('pointerdown', (e) => {
      if (!touchMode) return;
      e.preventDefault();
      el.classList.add('active');
      try { el.setPointerCapture(e.pointerId); } catch (_) { /* ignore */ }
      action();
      setTimeout(() => el.classList.remove('active'), 120);
    });
  }

  /* 视角：在右侧/空白区域拖动 */
  touchLookEl.addEventListener('pointerdown', (e) => {
    if (!touchMode || state.mode !== 'playing' || touchState.lookId !== null) return;
    e.preventDefault();
    touchState.lookId = e.pointerId;
    touchState.lookX = e.clientX;
    touchState.lookY = e.clientY;
    try { touchLookEl.setPointerCapture(e.pointerId); } catch (_) { /* ignore */ }
  });
  touchLookEl.addEventListener('pointermove', (e) => {
    if (e.pointerId !== touchState.lookId) return;
    e.preventDefault();
    const dx = e.clientX - touchState.lookX;
    const dy = e.clientY - touchState.lookY;
    touchState.lookX = e.clientX;
    touchState.lookY = e.clientY;
    player.yaw -= dx * 0.0042;
    player.pitch -= dy * 0.0042;
    const lim = Math.PI / 2 - 0.02;
    if (player.pitch > lim) player.pitch = lim;
    if (player.pitch < -lim) player.pitch = -lim;
  });
  const endLook = (e) => {
    if (e.pointerId !== touchState.lookId) return;
    touchState.lookId = null;
  };
  touchLookEl.addEventListener('pointerup', endLook);
  touchLookEl.addEventListener('pointercancel', endLook);
  touchLookEl.addEventListener('lostpointercapture', endLook);

  /* 摇杆：左拇指，0–1 的模拟量 */
  function stickStart(e) {
    if (!touchMode || state.mode !== 'playing' || touchState.stickId !== null) return;
    e.preventDefault();
    touchState.stickId = e.pointerId;
    const rect = stickBaseEl.getBoundingClientRect();
    touchState.stickCx = rect.left + rect.width / 2;
    touchState.stickCy = rect.top + rect.height / 2;
    touchState.stickMax = rect.width * 0.36;
    stickBaseEl.classList.add('active');
    try { stickBaseEl.setPointerCapture(e.pointerId); } catch (_) { /* ignore */ }
    stickMove(e);
  }
  function stickMove(e) {
    if (e.pointerId !== touchState.stickId) return;
    e.preventDefault();
    let dx = e.clientX - touchState.stickCx;
    let dy = e.clientY - touchState.stickCy;
    const len = Math.hypot(dx, dy);
    const max = touchState.stickMax || 1;
    if (len > max) { dx = dx / len * max; dy = dy / len * max; }
    touchState.stickX = dx / max;
    touchState.stickY = dy / max;
    stickKnobEl.style.transform = 'translate(' + dx.toFixed(1) + 'px,' + dy.toFixed(1) + 'px)';
  }
  function stickEnd(e) {
    if (e.pointerId !== touchState.stickId) return;
    touchState.stickId = null;
    touchState.stickX = 0;
    touchState.stickY = 0;
    stickKnobEl.style.transform = '';
    stickBaseEl.classList.remove('active');
  }
  stickBaseEl.addEventListener('pointerdown', stickStart);
  stickBaseEl.addEventListener('pointermove', stickMove);
  stickBaseEl.addEventListener('pointerup', stickEnd);
  stickBaseEl.addEventListener('pointercancel', stickEnd);
  stickBaseEl.addEventListener('lostpointercapture', stickEnd);

  /* 动作按钮 */
  bindTouchHold(touchMineEl,
    () => { state.mouseDown[0] = true; state.breakTimer = 0; swingHand(); },
    () => { state.mouseDown[0] = false; });
  bindTouchHold(touchPlaceEl,
    () => {
      state.mouseDown[1] = true;
      state.placeTimer = 0;
      doPlace();
      // 立即放一次；之后交给 handleHold 每 0.24 秒重复。
      state.placeTimer = 0.24;
      if (state.mode !== 'playing') state.mouseDown[1] = false;
    },
    () => { state.mouseDown[1] = false; });
  bindTouchHold(touchJumpEl,
    () => { touchState.jump = true; },
    () => { touchState.jump = false; });
  bindTouchHold(touchDownEl,
    () => { touchState.descend = true; },
    () => { touchState.descend = false; });
  bindTouchTap(touchFlyEl, () => {
    const f = player.toggleFly();
    toast(f ? '飞行模式 开' : '飞行模式 关');
    syncTouchUI();
  });
  bindTouchTap(touchBagEl, () => openInventory());
  bindTouchTap(touchMenuEl, () => pauseGame());

  hotbarEl.addEventListener('pointerup', (e) => {
    if (!touchMode) return;
    const slot = e.target.closest ? e.target.closest('.slot') : null;
    if (!slot) return;
    const i = Number(slot.dataset.index);
    if (Number.isInteger(i)) selectSlot(i);
  });

  inputBtn.addEventListener('click', () => {
    const next = inputCycle[(inputCycle.indexOf(inputMode) + 1) % inputCycle.length];
    setInputMode(next);
  });
  window.addEventListener('blur', resetTouchControls);
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) resetTouchControls();
  });
  updateInputUI();
  syncTouchUI();

  /* ================= 开始 / 暂停 ================= */
  function requestLock() {
    if (state.auto || touchMode) return;
    try {
      const p = canvas.requestPointerLock();
      if (p && typeof p.catch === 'function') {
        p.catch(() => { if (state.mode === 'playing') toast('点击画面锁定鼠标'); });
      }
    } catch (e) { /* ignore */ }
  }

  function startGame() {
    if (state.mode === 'loading') return;
    state.mode = 'playing';
    hideOverlay();
    sfx.init();
    requestLock();
    player.unstuck();
    mobManager.populate(player.pos, 4);
    selectSlot(state.selected, true);
    syncTouchUI();
    if (touchMode) showTouchHint();
  }

  function pauseGame() {
    if (state.mode !== 'playing') return;
    state.mode = 'paused';
    state.mouseDown[0] = state.mouseDown[1] = false;
    for (const k in keys) keys[k] = false;
    showPause();
    syncTouchUI();
    saveWorld();
  }

  function openRead(lore) {
    if (!lore || state.mode === 'reading') return;
    state.mode = 'reading';
    for (const k in keys) keys[k] = false;
    state.mouseDown[0] = state.mouseDown[1] = false;
    readTitleEl.textContent = lore.title || '石碑';
    readTextEl.textContent = lore.text || '';
    readEl.classList.remove('hide');
    if (document.pointerLockElement) document.exitPointerLock();
  }

  function closeRead(relock) {
    if (state.mode !== 'reading') return;
    state.mode = 'playing';
    readEl.classList.add('hide');
    if (relock) requestLock();
  }

  invClose.addEventListener('click', () => closeInventory(true));
  craftClose.addEventListener('click', () => closeCrafting(true));
  tabBag.addEventListener('click', () => { state.invTab = 'bag'; renderInv(); });
  tabCreative.addEventListener('click', () => { state.invTab = 'creative'; renderInv(); });
  craftResultEl.addEventListener('click', takeCraft);
  $('readClose').addEventListener('click', () => closeRead(true));
  readEl.addEventListener('click', (e) => { if (e.target === readEl) closeRead(true); });

  primary.addEventListener('click', () => {
    if (primary.disabled) return;
    startGame();
  });

  $('newWorld').addEventListener('click', () => {
    if (!confirm('生成新世界？当前世界的改动会被清除。')) return;
    try { localStorage.removeItem(SAVE_KEY); } catch (e) { /* ignore */ }
    const s = (Math.random() * 2e9 - 1e9) | 0;
    location.href = location.pathname + '?seed=' + s;
  });

  /* ================= 存档 ================= */
  let dirtySave = false;
  let lastTimeSave = state.time;
  function saveWorld(force) {
    if (!force && !dirtySave && state.time - lastTimeSave < 30) return;
    try {
      const data = world.saveData();
      data.terrainVersion = 4;
      data.inv = state.bag.map(s => (s ? (s.maxDur ? [s.id, s.count, s.dur, s.maxDur] : [s.id, s.count]) : 0));
      data.hotbar = state.hotbar.map(s => (s ? (s.maxDur ? [s.id, s.count, s.dur, s.maxDur] : [s.id, s.count]) : 0));
      data.time = state.time;
      data.secrets = state.seen;
      data.flags = state.flags;
      if (state.explored.length > 640) state.explored.splice(0, state.explored.length - 640);
      data.explored = state.explored;
      data.player = {
        pos: player.pos.slice(), yaw: player.yaw, pitch: player.pitch, flying: player.flying
      };
      localStorage.setItem(SAVE_KEY, JSON.stringify(data));
      dirtySave = false;
      lastTimeSave = state.time;
    } catch (e) {
      toast('存档失败（本地空间不足）');
    }
  }
  setInterval(saveWorld, 6000);
  window.addEventListener('beforeunload', () => saveWorld(true));
  window.addEventListener('pagehide', () => saveWorld(true));
  document.addEventListener('visibilitychange', () => {
    if (document.hidden && state.mode !== 'loading') saveWorld(true);
  });

  /* ================= HUD ================= */
  const hPos = $('hPos'), hFps = $('hFps'), hChunks = $('hChunks'), hTris = $('hTris'), hMode = $('hMode');
  let fpsAcc = 0, fpsCount = 0;

  function updateHud(dt) {
    fpsAcc += dt;
    fpsCount++;
    if (fpsAcc < 0.4) return;
    state.fps = Math.round(fpsCount / fpsAcc);
    fpsAcc = 0;
    fpsCount = 0;
    hPos.textContent = player.pos[0].toFixed(1) + ' / ' + player.pos[1].toFixed(1) + ' / ' + player.pos[2].toFixed(1);
    hFps.textContent = state.fps;
    hChunks.textContent = renderer.stats.drawn;
    hTris.textContent = (renderer.stats.faces / 1000).toFixed(1) + 'k';
    const biome = world.biomeAtPlayer(player.pos[0], player.pos[1], player.pos[2]);
    const modeName = player.flying ? '飞行' : (player.inWater ? '游泳中' : (player.sprinting ? '疾跑' : '步行'));
    const minute = Math.floor((12 + state.time / MC.DAY_LENGTH * 24) % 24 * 60);
    const clock = String(Math.floor(minute / 60)).padStart(2, '0') + ':' + String(minute % 60).padStart(2, '0');
    hMode.textContent = MC.BIOME_NAMES[biome] || '远野';
    $('hActivity').textContent = modeName + ' · ' + clock;
  }

  /* ================= 预加载 ================= */
  const spawnCx = Math.floor(player.pos[0] / 16);
  const spawnCz = Math.floor(player.pos[2] / 16);
  const PRE_GEN_R = 5, PRE_MESH_R = 4;
  const genList = makeOffsets(PRE_GEN_R);
  const meshList = makeOffsets(PRE_MESH_R);
  let preGen = 0, preMesh = 0;
  const totalSteps = genList.length + meshList.length;
  let loaded = false;

  function preloadTick() {
    const t0 = performance.now();
    while (preGen < genList.length && performance.now() - t0 < 9) {
      const o = genList[preGen++];
      world.ensureChunk(spawnCx + o.dx, spawnCz + o.dz);
    }
    while (preMesh < meshList.length && performance.now() - t0 < 18) {
      const o = meshList[preMesh++];
      const c = world.getChunk(spawnCx + o.dx, spawnCz + o.dz);
      if (c && c.dirty && world.neighborsReady(c.cx, c.cz)) buildChunkMesh(c);
    }
    const p = (preGen + preMesh) / totalSteps;
    barFill.style.width = Math.min(100, p * 100).toFixed(1) + '%';
    loadText.textContent = p < 1
      ? '正在生成世界… ' + Math.floor(p * 100) + '%'
      : '世界就绪，准备出发';
    if (preGen < genList.length || preMesh < meshList.length) {
      requestAnimationFrame(preloadTick);
    } else {
      loaded = true;
      player.unstuck();
      state.mode = 'menu';
      showMenu();
      if (state.auto) startGame();
    }
  }

  /* ================= 主循环 ================= */
  function readInput() {
    input.forward = !!(keys.KeyW || keys.ArrowUp);
    input.back = !!(keys.KeyS || keys.ArrowDown);
    input.left = !!(keys.KeyA || keys.ArrowLeft);
    input.right = !!(keys.KeyD || keys.ArrowRight);
    input.jump = !!keys.Space;
    input.descend = !!(keys.ShiftLeft || keys.ShiftRight);
    input.sprint = player.flying ? !!(keys.ControlLeft || keys.ControlRight) : input.descend;
    input.moveX = 0; input.moveZ = 0;
    if (touchMode) {
      const mag = Math.min(1, Math.hypot(touchState.stickX, touchState.stickY));
      if (mag > 0.12) {
        // 摇杆的 -y 是前进，+x 是右；换成世界坐标。
        const fwd = -touchState.stickY;
        const right = touchState.stickX;
        input.moveX = -Math.sin(player.yaw) * fwd + Math.cos(player.yaw) * right;
        input.moveZ = -Math.cos(player.yaw) * fwd - Math.sin(player.yaw) * right;
        input.forward = input.back = input.left = input.right = false;
        input.sprint = mag > 0.9;
      }
      input.jump = input.jump || touchState.jump;
      input.descend = input.descend || touchState.descend;
    }
    return input;
  }

  let mobSoundTimer = 4;
  let bubbleTimer = 1.5;
  let last = performance.now();
  let lastChunkX = 1e9, lastChunkZ = 1e9;

  function frame(now) {
    requestAnimationFrame(frame);
    let dt = (now - last) / 1000;
    last = now;
    if (!(dt > 0)) dt = 0.016;
    if (dt > 0.1) dt = 0.1;
    if (state.mode === 'playing') state.time += dt;

    if (state.mode === 'playing') {
      player.update(dt, readInput());
      if (player.wantStep) {
        const ground = world.getBlock(
          Math.floor(player.pos[0]), Math.floor(player.pos[1] - 0.05), Math.floor(player.pos[2]));
        sfx.step(ground);
        if (ground === MC.Block.GRASS || ground === MC.Block.SAND || ground === MC.Block.SNOW ||
            ground === MC.Block.RED_SAND) {
          particles.burst(player.pos[0], player.pos[1] + 0.08, player.pos[2], ground, 2, 'dust');
        }
      }
      if (player.inWater !== state.wasInWater) {
        sfx.splash(player.inWater ? 'in' : 'out');
        particles.burst(player.pos[0], player.pos[1] + 0.3, player.pos[2], MC.Block.WATER, 12, 'water');
        state.wasInWater = player.inWater;
      }
      handleHold(dt);
      mobManager.update(dt, player, true);
      if (secrets) secrets.update(dt);

      const eyeNow = player.eye();
      const underNow = MC.Block.isLiquid(world.getBlock(
        Math.floor(eyeNow[0]), Math.floor(eyeNow[1]), Math.floor(eyeNow[2])));
      if (underNow) {
        bubbleTimer -= dt;
        if (bubbleTimer <= 0) {
          bubbleTimer = 1.4 + Math.random() * 2.6;
          sfx.bubble(0.04 + Math.random() * 0.05);
        }
      } else {
        bubbleTimer = 1.2;
      }

      mobSoundTimer -= dt;
      if (mobSoundTimer <= 0) {
        mobSoundTimer = 5 + Math.random() * 8;
        const list = mobManager.mobs;
        if (list.length) {
          const mm = list[(Math.random() * list.length) | 0];
          const dx = mm.pos[0] - player.pos[0], dy = mm.pos[1] - player.pos[1], dz = mm.pos[2] - player.pos[2];
          const d = Math.sqrt(dx * dx + dy * dy + dz * dz);
          if (d < 26) {
            const g = 0.30 * Math.max(0.12, 1 - d / 30);
            animalSound(mm.type, g);
          }
        }
      }
    } else if (state.mode === 'menu') {
      player.yaw += dt * 0.05;
    }

    const pcx = Math.floor(player.pos[0] / 16), pcz = Math.floor(player.pos[2] / 16);
    if (pcx !== lastChunkX || pcz !== lastChunkZ) {
      lastChunkX = pcx; lastChunkZ = pcz;
      unloadFar();
    }
    if (loaded) stream();
    particles.update(dt, world);
    updateCamera(dt);
    horizon.update(player.pos[0], player.pos[2]);

    const showHit = state.mode === 'playing' || state.mode === 'inventory' || state.mode === 'crafting';
    const blockHit = showHit ? targetInfo() : null;
    const aimedMob = state.mode === 'playing' ? targetMob(blockHit) : null;
    const hit = aimedMob ? null : blockHit;
    crosshair.classList.toggle('mob', !!aimedMob);
    const mobBoxes = [];
    mobManager.collect(mobBoxes);
    if (secrets) secrets.collect(mobBoxes);
    const held = state.hotbar[state.selected];
    hand.itemId = held ? held.id : 0;
    hand.swing = state.swing;
    hand.bobPhase = player.bobPhase;
    hand.bobAmount = player.bobAmount;
    updateHeldItem(held, state.mode === 'playing');
    renderer.render(world, cam, drawList(), hit, state.time, mobBoxes,
      state.mode === 'playing' && !held ? hand : null, particles);

    updateHud(dt);
    syncTouchUI();
    if (state.mode === 'playing') minimap.update(player, dt);
    if (state.mode === 'playing') saveWorld();
  }

  /* ================= 初始化 ================= */
  buildHotbar();
  seedLabel.textContent = '种子 ' + seed;
  player.unstuck();
  updateCamera(0.016);
  requestAnimationFrame(frame);
  requestAnimationFrame(preloadTick);

  // 画面设置立即生效，并独立于世界进度保存。
  const shadowBtn = $('shadowBtn'), particleBtn = $('particleBtn');
  function applySettings() {
    const v = settings.values;
    renderer.resolutionScale = v.resolution;
    renderer.shadowEnabled = v.shadows;
    particles.setEnabled(v.particles);
    shadowBtn.textContent = '阴影：' + (v.shadows ? '开' : '关');
    particleBtn.textContent = '粒子：' + (v.particles ? '开' : '关');
    $('viewDistance').value = v.distance;
    $('resolution').value = v.resolution;
    $('fov').value = v.fov;
    $('fovValue').textContent = v.fov + '°';
    if (RENDER_R !== v.distance) {
      RENDER_R = v.distance;
      OFFSETS_GEN = makeOffsets(RENDER_R + 1);
      unloadFar();
    }
  }
  shadowBtn.addEventListener('click', () => { settings.set('shadows', !settings.values.shadows); applySettings(); });
  particleBtn.addEventListener('click', () => { settings.set('particles', !settings.values.particles); applySettings(); });
  for (const [id, key] of [['viewDistance', 'distance'], ['resolution', 'resolution'], ['fov', 'fov']]) {
    $(id).addEventListener('input', e => { settings.set(key, Number(e.target.value)); applySettings(); });
  }
  applySettings();

  const debugMode = params.has('debug');
  secrets = new MC.Secrets({
    world, player, state, sfx, particles, mobManager, debug: debugMode,
    hooks: {
      toast,
      addItem: (id, count) => addToBag(id, count) === count,
      save: () => { dirtySave = true; saveWorld(true); },
      flash: () => {
        flashEl.classList.add('show');
        setTimeout(() => flashEl.classList.remove('show'), 760);
      },
      aurora: on => auroraEl.classList.toggle('show', !!on),
      meteor: on => meteorsEl.classList.toggle('show', !!on)
    }
  });

  const debug = debugMode ? {
    teleport(x, y, z) {
      player.pos[0] = x; player.pos[1] = y; player.pos[2] = z;
      player.vel.fill(0);
      return player.pos.slice();
    },
    setTime(hours) {
      state.time = (hours - 12) / 24 * MC.DAY_LENGTH;
      if (state.time < 0) state.time += MC.DAY_LENGTH;
      return state.time;
    },
    goto(name) {
      const site = world.sites.find(s => s.type === name);
      if (!site) return null;
      player.flying = true;
      player.pos = [site.x + 0.5, site.y + 2, site.z + 0.5];
      return site;
    },
    trigger: id => secrets.trigger(id),
    list: () => secrets.list(),
    secrets: () => secrets,
    sites: () => world.sites.map(s => ({ ...s }))
  } : null;

  window.__mc = {
    world, player, renderer, cam, state, seed, mobManager, sfx, particles,
    horizon, minimap, secrets, settings, debug, worldRef: world,
    get touchMode() { return touchMode; },
    get inputMode() { return inputMode; },
    touchState,
    setInputMode
  };
})();
