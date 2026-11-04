'use strict';

/* ============================================================
 * WorkBuddy 桌宠 · 鲸鱼娘
 * 主逻辑：像素级命中、拖拽、动作状态机、气泡渲染
 * ============================================================ */

window.addEventListener('error', (e) => {
  console.error('ERR', e.message, e.filename, e.lineno, e.colno, (e.error && e.error.stack) || '');
});

const DLOG = location.search.includes('diag');
function dlog() {
  if (!DLOG) return;
  console.log('[pt]', Array.prototype.slice.call(arguments).join(' '));
}
const api = window.petAPI;
const P = window.DSPricing;

const FORM_H = { chibi: 196, normal: 268 };
const IDLE_TO_SLEEP = 180 * 1000;

const el = (id) => document.getElementById(id);
const sprite = el('sprite');
const petEl = el('pet');
const bubble = el('bubble');
const fxEl = el('fx');
const signEl = el('sign');
const signText = el('signText');

const state = {
  cfg: { mode: 'auto', scale: 1, switchSeconds: 90 },
  form: 'chibi',
  bubbleOpen: false,
  dragging: false,
  busy: false,
  sleeping: false,
  ignore: true,
  lastInteract: Date.now(),
  lastDataAt: 0,
  lastPhase: null,
  data: null,
  poses: [],
  pos: { x: 0, y: 0 },
  origin: { x: 0, y: 0 },
  workArea: { x: 0, y: 0, width: 1920, height: 1080 }
};

/* ---------------------------------------------------------- 像素级命中 */

let maskData = null;
let maskW = 0;
let maskH = 0;

function buildMask() {
  if (!sprite.naturalWidth) return;
  const w = 90;
  const h = Math.max(1, Math.round((w * sprite.naturalHeight) / sprite.naturalWidth));
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  const ctx = c.getContext('2d', { willReadFrequently: true });
  ctx.clearRect(0, 0, w, h);
  ctx.drawImage(sprite, 0, 0, w, h);
  try {
    maskData = ctx.getImageData(0, 0, w, h).data;
    maskW = w;
    maskH = h;
  } catch (e) {
    maskData = null;
  }
}

function alphaHit(x, y) {
  if (!maskData) return true;
  const r = sprite.getBoundingClientRect();
  if (!r.width || !r.height) return false;
  const u = (x - r.left) / r.width;
  const v = (y - r.top) / r.height;
  if (u < -0.02 || u > 1.02 || v < -0.02 || v > 1.02) return false;
  const px = Math.min(maskW - 1, Math.max(0, Math.floor(u * maskW)));
  const py = Math.min(maskH - 1, Math.max(0, Math.floor(v * maskH)));
  for (let dy = -1; dy <= 1; dy++) {
    for (let dx = -1; dx <= 1; dx++) {
      const xx = Math.min(maskW - 1, Math.max(0, px + dx));
      const yy = Math.min(maskH - 1, Math.max(0, py + dy));
      if (maskData[(yy * maskW + xx) * 4 + 3] > 24) return true;
    }
  }
  return false;
}

/* 鼠标穿透由主进程轮询光标 + alpha 掩码决定（见 main.js hitTick），
   渲染层只负责把「精灵矩形 / 气泡矩形」上报过去。 */

function absSpritePath() {
  try {
    let p = decodeURIComponent(new URL(sprite.src).pathname);
    if (/^\/[A-Za-z]:/.test(p)) p = p.slice(1);
    return p;
  } catch (e) {
    return '';
  }
}

function reportState() {
  try {
    /* 用布局尺寸而不是 getBoundingClientRect：后者会把拖拽倾斜、呼吸缩放算进去，
       导致命中/夹紧用的矩形在拖动过程中不停变化 */
    /* #pet 铺满窗口宽度、精灵水平居中且贴底：直接用窗口尺寸算，既不碰 transform，
       也不依赖 offsetParent 链（精灵的 offsetParent 是带倾斜动画的 .pet-breathe） */
    const pw = sprite.offsetWidth || petEl.offsetWidth || 0;
    const ph = sprite.offsetHeight || petEl.offsetHeight || 0;
    const vw = document.documentElement.clientWidth;
    const vh = document.documentElement.clientHeight;
    /* 她不再贴着窗口底边（底部留 26px 给阴影），所以用容器底边反推她脚底 */
    const petRect = petEl.getBoundingClientRect();
    const r = {
      left: Math.round((vw - pw) / 2),
      top: Math.round(petRect.bottom - ph),
      width: pw,
      height: ph
    };
    const st = {
      form: state.form,
      sprite: absSpritePath(),
      rect: [Math.round(r.left), Math.round(r.top), Math.round(r.width), Math.round(r.height)],
      bubble: null
    };
    /* 下采样 alpha 掩膜：主进程用它判断光标是不是压在她身上（透明处可穿透） */
    try {
      if (sprite.naturalWidth && sprite.naturalHeight) {
        if (!window.__maskCanvas) {
          window.__maskCanvas = document.createElement('canvas');
          window.__maskCanvas.width = 40;
          window.__maskCanvas.height = 40;
        }
        const mc = window.__maskCanvas;
        const mctx = mc.getContext('2d');
        mctx.clearRect(0, 0, 40, 40);
        mctx.drawImage(sprite, 0, 0, 40, 40);
        const px = mctx.getImageData(0, 0, 40, 40).data;
        const arr = new Array(1600);
        for (let i = 0; i < 1600; i++) arr[i] = px[i * 4 + 3] > 40 ? 1 : 0;
        st.mask = arr;
        st.mw = 40;
        st.mh = 40;
      }
    } catch (e) {
      /* 读像素失败就退回矩形命中 */
    }
    st.vw = vw;
    st.vh = vh;
    st.dpr = window.devicePixelRatio || 1;
    st.menu = window.__menuRect || null;
    st.bubbleH = bubble.offsetHeight || 0;
    if (state.bubbleOpen) {
      const b = bubble.getBoundingClientRect();
      st.bubble = [
        Math.round(b.left) - 2,
        Math.round(b.top) - 2,
        Math.round(b.width) + 4,
        Math.round(b.height) + 4
      ];
    }
    api.setState(st);
  } catch (e) {
    /* ignore */
  }
}

/* ---------------------------------------------------------- 待机动画 */

const breatheEl = () => document.querySelector('.pet-breathe');
let idleAnim = null;

function startIdle() {
  stopIdle();
  const t = breatheEl();
  t.style.transform = '';
  const amp = state.sleeping ? 1.003 : 1.012;
  idleAnim = t.animate(
    [{ transform: 'scale(1, 1)' }, { transform: `scale(${amp}, ${(2 - amp).toFixed(3)})` }],
    {
      duration: state.sleeping ? 5400 : 3400,
      iterations: Infinity,
      direction: 'alternate',
      easing: 'ease-in-out'
    }
  );
}

function stopIdle() {
  if (idleAnim) {
    idleAnim.cancel();
    idleAnim = null;
  }
}

async function anim(frames, opts) {
  const t = breatheEl();
  stopIdle();
  t.style.transform = '';
  const a = t.animate(frames, opts);
  try {
    await a.finished;
  } catch (e) {
    /* 动画被打断 */
  }
  if (!state.dragging) startIdle();
}

/* ---------------------------------------------------------- 特效 */

const ICONS = {
  heart:
    '<svg viewBox="0 0 24 24"><path d="M12 21s-8-4.7-8-10a4.6 4.6 0 0 1 8-3.1A4.6 4.6 0 0 1 20 11c0 5.3-8 10-8 10z" fill="currentColor"/></svg>',
  star:
    '<svg viewBox="0 0 24 24"><path d="M12 2l2.3 7.2L21.5 12l-7.2 2.8L12 22l-2.3-7.2L2.5 12l7.2-2.8z" fill="currentColor"/></svg>',
  angry:
    '<svg viewBox="0 0 24 24"><path d="M12 1.5l2.1 2.2 2.9-1 1 2.9 3 .8-.7 3 2.4 1.9-2 2.4 1 2.9-2.9 1-.8 3-3-.7-1.9 2.4-2.4-2-2.9 1-1-2.9-3-.8.7-3L1.5 12l2-2.4-1-2.9 2.9-1 .8-3 3 .7z" fill="currentColor"/></svg>',
  fish:
    '<svg viewBox="0 0 24 24"><path d="M8 6c4.5 0 8 2.4 9.6 5.4L22 8v8l-4.4-3.4C16 15.6 12.5 18 8 18c-4.4 0-6-6-6-6s1.6-6 6-6z" fill="currentColor"/><circle cx="10" cy="11" r="1.1" fill="#0b1020"/></svg>'
};

function spawnFx(kind, o = {}) {
  const node = document.createElement('div');
  node.className = 'fx-item fx-' + kind;
  const size = o.size || 16;
  if (kind === 'zzz') {
    node.textContent = 'z';
    node.style.fontSize = size + 'px';
  } else {
    node.innerHTML = ICONS[kind] || '';
    const svg = node.firstChild;
    svg.setAttribute('width', size);
    svg.setAttribute('height', size);
    svg.style.display = 'block';
  }
  const pr = petEl.getBoundingClientRect();
  const fr = fxEl.getBoundingClientRect();
  node.style.left = pr.left + pr.width * (o.x == null ? 0.5 : o.x) - fr.left + 'px';
  node.style.top = pr.top + pr.height * (o.y == null ? 0.4 : o.y) - fr.top + 'px';
  node.style.opacity = '0';
  fxEl.appendChild(node);

  const dx = o.dx == null ? 0 : o.dx;
  const dy = o.dy == null ? -46 : o.dy;
  const dur = o.dur || 1000;
  const rot = o.rot || 0;

  const a = node.animate(
    [
      { transform: 'translate(-50%, -50%) scale(.45)', opacity: 0 },
      { transform: `translate(-50%, -50%) scale(1) rotate(${rot}deg)`, opacity: 1, offset: 0.22 },
      {
        transform: `translate(calc(-50% + ${dx}px), calc(-50% + ${dy}px)) scale(.85) rotate(${rot + 12}deg)`,
        opacity: 0
      }
    ],
    { duration: dur, easing: 'cubic-bezier(.25,.7,.4,1)' }
  );
  a.finished.then(() => node.remove()).catch(() => node.remove());
}

/* ---------------------------------------------------------- 动作表 */

function pick(weighted) {
  const total = weighted.reduce((s, a) => s + a.w, 0);
  let r = Math.random() * total;
  for (const a of weighted) {
    r -= a.w;
    if (r <= 0) return a;
  }
  return weighted[weighted.length - 1];
}

const ACTIONS = [
  {
    id: 'hop',
    w: 3,
    run: () =>
      anim(
        [
          { transform: 'translateY(0) scale(1,1)' },
          { transform: 'translateY(-30px) scale(.96,1.05)', offset: 0.34 },
          { transform: 'translateY(0) scale(1.07,.93)', offset: 0.62 },
          { transform: 'translateY(-7px) scale(1,1)', offset: 0.8 },
          { transform: 'translateY(0) scale(1,1)' }
        ],
        { duration: 780, easing: 'cubic-bezier(.3,.85,.4,1)' }
      )
  },
  {
    id: 'wobble',
    w: 3,
    run: () =>
      anim(
        [
          { transform: 'rotate(0deg)' },
          { transform: 'rotate(-6deg)', offset: 0.25 },
          { transform: 'rotate(5deg)', offset: 0.55 },
          { transform: 'rotate(-2deg)', offset: 0.8 },
          { transform: 'rotate(0deg)' }
        ],
        { duration: 920, easing: 'ease-in-out' }
      )
  },
  {
    id: 'spin',
    w: 1,
    run: () =>
      anim(
        [
          { transform: 'rotate(0deg) scale(1,1)' },
          { transform: 'rotate(180deg) scale(.94,.96)', offset: 0.5 },
          { transform: 'rotate(360deg) scale(1,1)' }
        ],
        { duration: 1000, easing: 'cubic-bezier(.45,0,.3,1)' }
      )
  },
  {
    id: 'stretch',
    w: 2,
    run: () =>
      anim(
        [
          { transform: 'scale(1,1)' },
          { transform: 'scale(.95,1.09)', offset: 0.45 },
          { transform: 'scale(1.02,.98)', offset: 0.75 },
          { transform: 'scale(1,1)' }
        ],
        { duration: 900, easing: 'ease-in-out' }
      )
  },
  {
    id: 'lean',
    w: 2,
    run: () =>
      anim(
        [
          { transform: 'rotate(0) translateX(0)' },
          { transform: 'rotate(-9deg) translateX(-8px)', offset: 0.5 },
          { transform: 'rotate(0) translateX(0)' }
        ],
        { duration: 1150, easing: 'ease-in-out' }
      )
  },
  {
    id: 'dance',
    w: 2,
    run: () =>
      anim(
        [
          { transform: 'rotate(0) translateY(0)' },
          { transform: 'rotate(7deg) translateY(-8px)', offset: 0.2 },
          { transform: 'rotate(-7deg) translateY(-8px)', offset: 0.4 },
          { transform: 'rotate(7deg) translateY(-8px)', offset: 0.6 },
          { transform: 'rotate(-7deg) translateY(-8px)', offset: 0.8 },
          { transform: 'rotate(0) translateY(0)' }
        ],
        { duration: 1500, easing: 'ease-in-out' }
      )
  },
  {
    id: 'shy',
    w: 2,
    run: async () => {
      spawnFx('heart', { x: 0.72, y: 0.28, dx: 22, dy: -40, size: 15 });
      spawnFx('heart', { x: 0.3, y: 0.32, dx: -18, dy: -44, size: 12 });
      await anim(
        [
          { transform: 'rotate(0)' },
          { transform: 'rotate(4deg) scale(.99,.99)', offset: 0.4 },
          { transform: 'rotate(-3deg)', offset: 0.7 },
          { transform: 'rotate(0)' }
        ],
        { duration: 1100, easing: 'ease-in-out' }
      );
    }
  },
  {
    id: 'angry',
    w: 2,
    run: async () => {
      spawnFx('angry', { x: 0.8, y: 0.17, dx: 6, dy: -6, size: 18, dur: 700 });
      await anim(
        [
          { transform: 'translateX(0) rotate(0)' },
          { transform: 'translateX(-5px) rotate(-2deg)', offset: 0.15 },
          { transform: 'translateX(5px) rotate(2deg)', offset: 0.3 },
          { transform: 'translateX(-5px) rotate(-2deg)', offset: 0.45 },
          { transform: 'translateX(5px) rotate(2deg)', offset: 0.6 },
          { transform: 'translateX(-2px)', offset: 0.8 },
          { transform: 'translateX(0)' }
        ],
        { duration: 620, easing: 'linear' }
      );
    }
  },
  {
    id: 'fish',
    w: 2,
    run: async () => {
      spawnFx('fish', { x: 0.72, y: 0.55, dx: 8, dy: -10, size: 20, dur: 1500, rot: -8 });
      await anim(
        [
          { transform: 'translateY(0) rotate(0)' },
          { transform: 'translateY(-4px) rotate(-3deg)', offset: 0.5 },
          { transform: 'translateY(0) rotate(0)' }
        ],
        { duration: 1600, easing: 'ease-in-out' }
      );
      hideSign();
    }
  },
  {
    id: 'eat',
    w: 2,
    run: async () => {
      createFlyFish();
      await anim(
        [
          { transform: 'scale(1,1)' },
          { transform: 'scale(1.02,.97)', offset: 0.25 },
          { transform: 'scale(.97,1.03)', offset: 0.5 },
          { transform: 'scale(1.02,.98)', offset: 0.75 },
          { transform: 'scale(1,1)' }
        ],
        { duration: 1300, easing: 'ease-in-out' }
      );
      hideSign();
    }
  },
  {
    id: 'peek',
    w: 2,
    run: () =>
      anim(
        [
          { transform: 'rotate(0) translateY(0) scale(1)' },
          { transform: 'rotate(5deg) translateY(-11px) scale(1.02)', offset: 0.45 },
          { transform: 'rotate(0) translateY(0) scale(1)' }
        ],
        { duration: 1250, easing: 'cubic-bezier(.3,.8,.4,1)' }
      )
  },
  {
    id: 'bow',
    w: 2,
    run: () =>
      anim(
        [
          { transform: 'rotate(0) translateY(0)' },
          { transform: 'rotate(13deg) translateY(5px)', offset: 0.45 },
          { transform: 'rotate(13deg) translateY(5px)', offset: 0.72 },
          { transform: 'rotate(0) translateY(0)' }
        ],
        { duration: 1400, easing: 'ease-in-out' }
      )
  },
  {
    id: 'twirl',
    w: 2,
    run: () =>
      anim(
        [
          { transform: 'rotate(0) scale(1)' },
          { transform: 'rotate(360deg) scale(.96)', offset: 0.5 },
          { transform: 'rotate(720deg) scale(1)' }
        ],
        { duration: 1200, easing: 'cubic-bezier(.4,0,.3,1)' }
      )
  },
  {
    id: 'look',
    w: 3,
    run: async () => {
      const inner = document.querySelector('.pet-inner');
      const before = inner.classList.contains('flipped');
      inner.classList.toggle('flipped', !before);
      await anim(
        [
          { transform: 'rotate(0) translateX(0)' },
          { transform: 'rotate(-5deg) translateX(-7px)', offset: 0.5 },
          { transform: 'rotate(0) translateX(0)' }
        ],
        { duration: 900, easing: 'ease-in-out' }
      );
      inner.classList.toggle('flipped', before);
      await new Promise((r) => setTimeout(r, 260));
      inner.classList.toggle('flipped', !before);
      await anim(
        [
          { transform: 'rotate(0) translateX(0)' },
          { transform: 'rotate(5deg) translateX(7px)', offset: 0.5 },
          { transform: 'rotate(0) translateX(0)' }
        ],
        { duration: 900, easing: 'ease-in-out' }
      );
      inner.classList.toggle('flipped', before);
    }
  },
  {
    id: 'yawn',
    w: 2,
    run: () =>
      anim(
        [
          { transform: 'scale(1,1) translateY(0)' },
          { transform: 'scale(0.97,1.06) translateY(-4px)', offset: 0.35 },
          { transform: 'scale(0.99,1.02) translateY(-2px)', offset: 0.7 },
          { transform: 'scale(1,1) translateY(0)' }
        ],
        { duration: 1600, easing: 'ease-in-out' }
      )
  },
  {
    id: 'pose',
    w: 6,
    run: async () => {
      if (!state.poses || !state.poses.length) return;
      let file = state.poses[Math.floor(Math.random() * state.poses.length)];
      let guard = 0;
      while (file === lastPose && guard++ < 4) {
        file = state.poses[Math.floor(Math.random() * state.poses.length)];
      }
      lastPose = file;
      await playPose(file);
    }
  }
];

let lastPose = null;

function createFlyFish() {
  const node = document.createElement('div');
  node.className = 'fx-item fx-fish';
  node.innerHTML = ICONS.fish;
  const svg = node.firstChild;
  svg.setAttribute('width', 18);
  svg.setAttribute('height', 18);
  const pr = petEl.getBoundingClientRect();
  const fr = fxEl.getBoundingClientRect();
  const tx = pr.left + pr.width * 0.5 - fr.left;
  const ty = pr.top + pr.height * 0.42 - fr.top;
  node.style.left = pr.left + pr.width * 1.05 - fr.left + 'px';
  node.style.top = pr.top + pr.height * 0.65 - fr.top + 'px';
  node.style.opacity = '0';
  fxEl.appendChild(node);
  const a = node.animate(
    [
      { transform: 'translate(-50%,-50%) scale(.7) rotate(0)', opacity: 0 },
      { transform: 'translate(-50%,-50%) scale(1) rotate(-10deg)', opacity: 1, offset: 0.25 },
      {
        transform: `translate(calc(-50% + ${tx - (pr.left + pr.width * 1.05 - fr.left)}px), calc(-50% + ${
          ty - (pr.top + pr.height * 0.65 - fr.top)
        }px)) scale(.5) rotate(20deg)`,
        opacity: 0
      }
    ],
    { duration: 900, easing: 'cubic-bezier(.4,0,.7,1)' }
  );
  a.finished.then(() => node.remove()).catch(() => node.remove());
}

let lastActionId = null;

/* 普通版才会切「表情包姿态」；Q 版保持小巧单图 */
function activeActions() {
  const canPose = state.form === 'normal' && state.poses && state.poses.length > 0;
  return ACTIONS.filter((a) => a.id !== 'pose' || canPose);
}

async function runRandomActionById(id) {
  if (state.busy) return;
  const a = ACTIONS.find((x) => x.id === id);
  if (!a) return;
  state.busy = true;
  try {
    await a.run();
  } catch (e) {
    /* ignore */
  }
  state.busy = false;
}

async function runRandomAction() {
  if (state.busy) return;
  state.busy = true;
  try {
    const pool = activeActions();
    let a = pick(pool);
    let guard = 0;
    while (a.id === lastActionId && guard++ < 4) a = pick(pool);
    lastActionId = a.id;
    await a.run();
  } catch (e) {
    /* 忽略单次动作异常 */
  }
  state.busy = false;
}

/* ---------------------------------------------------------- 小牌子 */

let signTimer = null;
function showSign(text, ms) {
  signText.textContent = text;
  signEl.classList.add('show');
  clearTimeout(signTimer);
  if (ms) signTimer = setTimeout(hideSign, ms);
}
function hideSign() {
  signEl.classList.remove('show');
}

/* ---------------------------------------------------------- 形象切换 */

let srcToken = 0;

/** 统一换图：淡出 -> 预载 -> 淡入，并重建命中遮罩 */
function setSpriteSrc(src, opts) {
  const o = opts || {};
  const token = ++srcToken;
  sprite.classList.add('switching');
  setTimeout(() => {
    if (token !== srcToken) return;
    const img = new Image();
    img.onload = () => {
      if (token !== srcToken) return;
      if (o.form) {
        // 图、高度、缩放三者在同一帧生效，避免旧图先按新尺寸闪一下
        document.documentElement.style.setProperty('--pet-h', FORM_H[o.form] + 'px');
        applyScale();
      }
      sprite.src = src;
      sprite.style.height = o.height || '';
      sprite.classList.remove('switching');
      reportState();
      sprite.animate(
        [
          { transform: 'scale(.94)', opacity: 0.3 },
          { transform: 'scale(1.02)', opacity: 1, offset: 0.7 },
          { transform: 'scale(1)' }
        ],
        { duration: 300, easing: 'cubic-bezier(.2,.9,.3,1.2)' }
      );
    };
    img.onerror = () => {
      if (token === srcToken) sprite.classList.remove('switching');
    };
    img.src = src;
  }, 110);
}

/* ---------------- 表情包姿态 ---------------- */

let poseSeq = 0;

function poseMeta(file) {
  const m = state.poseMeta && state.poseMeta[file];
  return m || {};
}

function cancelPose() {
  poseSeq += 1;
  if (state.poseActive) {
    state.poseActive = false;
    setSpriteSrc('assets/' + state.form + '.png');
  }
}

async function playPose(file) {
  const meta = poseMeta(file);
  const my = ++poseSeq;
  state.poseActive = true;
  setSpriteSrc('../' + file, {
    height: meta.h ? 'calc(var(--pet-h) * var(--scale) * ' + meta.h + ')' : ''
  });
  await new Promise((r) => setTimeout(r, meta.dur || 2200));
  if (my !== poseSeq) return;
  state.poseActive = false;
  setSpriteSrc('assets/' + state.form + '.png');
}

function setForm(form, force) {
  if (!FORM_H[form]) return;
  if (!force && state.form === form) {
    document.documentElement.style.setProperty('--pet-h', FORM_H[form] + 'px');
    return;
  }
  cancelPose();
  state.form = form;
  setSpriteSrc('assets/' + form + '.png', { form });
}

function scaleOf(form) {
  const m = (state.cfg && state.cfg.scaleByForm) || {};
  const v = m[form];
  if (typeof v === 'number') return v;
  return Number(state.cfg && state.cfg.scale) || 1;
}

function applyScale() {
  document.documentElement.style.setProperty('--scale', String(scaleOf(state.form)));
}

function switchMs() {
  const s = Number(state.cfg.switchSeconds);
  if (!Number.isFinite(s) || s <= 0) return Infinity;
  return Math.max(5, s) * 1000;
}

function desiredForm() {
  if (state.cfg.mode !== 'auto') return state.cfg.mode;
  return Date.now() - state.lastInteract > switchMs() ? 'normal' : 'chibi';
}

/* ---------------------------------------------------------- 拖拽 */

let drag = null;

let lastMoveAt = 0;

petEl.addEventListener('pointerdown', (e) => {
  if (e.button !== 0) return;
  e.preventDefault();
  try {
    petEl.setPointerCapture(e.pointerId);
  } catch (err) {
    /* 合成事件没有真实指针时忽略 */
  }
  drag = { sx: e.screenX, sy: e.screenY, id: e.pointerId, started: false, tilt: 0 };
  api.press(true);
  dlog('down', e.clientX, e.clientY);
  touch();
});

petEl.addEventListener('pointermove', (e) => {
  if (!drag) return;

  /* 不再用 e.buttons===0 判断：窗口在光标底下移动时，Windows/Chromium 会补发
     buttons 为 0 的合成 move 事件，那会把正在进行的拖拽提前掐断（拖一半就不跟手了）。 */

  if (!drag.started) {
    if (Math.hypot(e.screenX - drag.sx, e.screenY - drag.sy) <= 4) return;
    drag.started = true;
    state.dragging = true;
    petEl.classList.add('dragging');
    stopIdle();
    api.dragStart({ x: drag.sx, y: drag.sy });
  }

  /* 位置由主进程轮询光标驱动，这里只按 8ms 节流发个"动一下"的信号 */
  const nowT = performance.now();
  if (nowT - lastMoveAt > 8) {
    lastMoveAt = nowT;
    api.dragMove({});
  }

});

function endDrag(e) {
  if (!drag) return;
  const wasDrag = drag.started;
  api.press(false);
  try {
    petEl.releasePointerCapture(drag.id);
  } catch (err) {
    /* ignore */
  }
  drag = null;

  if (wasDrag) {
    state.dragging = false;
    petEl.classList.remove('dragging');
    api
      .dragEnd()
      .then((res) => {
        applySnapFlip(res && res.side);
        bounce();
      })
      .catch(() => {});
    startIdle();
  } else {
    onPetTap();
  }
  touch();
}

/* 注意：不要监听 window blur —— 窗口是 focusable:false，移动过程中会频繁触发 blur，
   那会把正在进行的拖拽提前结束掉（表现就是"拖到一半不跟手了"）。 */

petEl.addEventListener('pointerup', endDrag);
petEl.addEventListener('pointercancel', (e) => {
  dlog('pointercancel');
  endDrag(e);
});
petEl.addEventListener('lostpointercapture', () => dlog('lostcapture'));

function bounce() {
  anim(
    [
      { transform: 'translateY(0) scale(1,1)' },
      { transform: 'translateY(0) scale(1.06,.94)', offset: 0.3 },
      { transform: 'translateY(-6px) scale(.98,1.02)', offset: 0.65 },
      { transform: 'translateY(0) scale(1,1)' }
    ],
    { duration: 520, easing: 'cubic-bezier(.3,.8,.4,1)' }
  );
}

function applySnapFlip(side) {
  const inner = document.querySelector('.pet-inner');
  if (side === 'right') inner.classList.add('flipped');
  else if (side === 'left') inner.classList.remove('flipped');
}

/* 单击 / 双击 */

let tapTimer = null;

function onPetTap() {
  if (tapTimer) {
    clearTimeout(tapTimer);
    tapTimer = null;
    return;
  }
  tapTimer = setTimeout(() => {
    tapTimer = null;
    toggleBubble();
  }, 200);
}

petEl.addEventListener('dblclick', (e) => {
  e.preventDefault();
  if (tapTimer) {
    clearTimeout(tapTimer);
    tapTimer = null;
  }
  const next = state.form === 'chibi' ? 'normal' : 'chibi';
  api.setMode(next);
  showSign(next === 'chibi' ? 'Flash' : 'Pro', 1500);
});

/* 右键菜单改由自绘面板处理（见下方 menu 段） */

petEl.addEventListener(
  'wheel',
  (e) => {
    e.preventDefault();
    const applied = parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--scale'));
    const cur = Number.isFinite(applied) && applied > 0 ? applied : scaleOf(state.form);
    const next = Math.max(0.6, Math.min(1.8, +(cur + (e.deltaY > 0 ? -0.05 : 0.05)).toFixed(2)));
    if (next !== cur) {
      // 先本地生效，避免连滚几格时读到旧配置只算一步
      document.documentElement.style.setProperty('--scale', String(next));
      api.setScale({ form: state.form, scale: next });
      showSign(Math.round(next * 100) + '%', 900);
    }
    touch();
  },
  { passive: false }
);

/* ---------------------------------------------------------- 气泡 */

function toggleBubble(force) {
  state.bubbleOpen = force == null ? !state.bubbleOpen : !!force;
  bubble.classList.toggle('open', state.bubbleOpen);
  bubble.setAttribute('aria-hidden', String(!state.bubbleOpen));
  reportState();
  if (state.bubbleOpen) {
    renderPhase();
    if (Date.now() - state.lastDataAt > 45000) requestRefresh();
  }
}

el('btnRefresh').addEventListener('click', (e) => {
  e.stopPropagation();
  requestRefresh();
});

let refreshCooldown = 0;
function requestRefresh() {
  if (Date.now() < refreshCooldown) return;
  refreshCooldown = Date.now() + 12000;
  api.refresh();
  const btn = el('btnRefresh');
  btn.classList.add('busy');
  btn.textContent = '读取中…';
  setTimeout(() => {
    btn.classList.remove('busy');
    btn.textContent = '刷新';
  }, 6000);
}

/* ---------------------------------------------------------- 渲染 */

function fmt(n) {
  if (n == null || Number.isNaN(Number(n))) return '—';
  const num = Number(n);
  if (Math.abs(num) >= 1000) {
    return num.toLocaleString('zh-CN', { minimumFractionDigits: 1, maximumFractionDigits: 1 });
  }
  return num.toLocaleString('zh-CN', { maximumFractionDigits: 2 });
}

let balanceShown = null;
function rollBalance(target) {
  const node = el('balance');
  node.classList.remove('na');
  const from = balanceShown == null ? 0 : balanceShown;
  balanceShown = target;
  const t0 = performance.now();
  const dur = 620;
  function step(t) {
    const p = Math.min(1, (t - t0) / dur);
    const e = 1 - Math.pow(1 - p, 3);
    node.textContent = fmt(from + (target - from) * e);
    if (p < 1) requestAnimationFrame(step);
    else node.textContent = fmt(target);
  }
  requestAnimationFrame(step);
}

function renderData(d) {
  if (!d) return;
  state.data = d;
  state.lastDataAt = Date.now();

  if (typeof d.balance === 'number') {
    rollBalance(d.balance);
  } else {
    const node = el('balance');
    node.classList.add('na');
    node.textContent = '—';
    balanceShown = null;
  }

  const local = d.local || {};
  el('todayUsed').textContent = typeof local.today === 'number' ? fmt(local.today) : '—';
  el('weekUsed').textContent = typeof local.week === 'number' ? fmt(local.week) : '—';

  if (Array.isArray(local.by_day) && local.by_day.length) renderSpark(local.by_day);

  const t = new Date(d.ts || Date.now());
  let stamp =
    '更新于 ' + String(t.getHours()).padStart(2, '0') + ':' + String(t.getMinutes()).padStart(2, '0');
  if (typeof d.balance !== 'number') {
    const note = (d.notes && d.notes[d.notes.length - 1]) || '余额读取失败';
    stamp = note.length > 28 ? note.slice(0, 28) + '…' : note;
  }
  el('updated').textContent = stamp;

  renderPhase();
}

function renderSpark(byDay) {
  const box = el('spark');
  box.innerHTML = '';
  const max = Math.max(1, ...byDay.map((x) => x.used || 0));
  byDay.forEach((d, i) => {
    const b = document.createElement('div');
    b.className = 'bar' + (i === byDay.length - 1 ? ' today' : '');
    b.style.height = Math.max(3, Math.round(((d.used || 0) / max) * 30)) + 'px';
    b.title = d.date + '：' + fmt(d.used) + ' 积分';
    box.appendChild(b);
  });
}

function renderPhase() {
  if (!window.DSPricing) return;
  const now = new Date();
  const seg = P.phaseSegment(now);

  const band = el('phaseBand');
  band.classList.toggle('peak', seg.peak);
  el('phaseText').textContent = seg.peak ? '峰段' : seg.weekend ? '谷段 · 周末' : '谷段';
  el('phaseTimer').textContent = seg.next ? P.fmtDuration(seg.next.getTime() - now.getTime()) : '—';
  el('phaseDesc').textContent = seg.peak ? '后转谷' : '后转峰';

  if (seg.prev && seg.next) {
    const total = seg.next.getTime() - seg.prev.getTime();
    const p = total > 0 ? Math.min(1, Math.max(0, (now.getTime() - seg.prev.getTime()) / total)) : 0;
    el('phaseFill').style.width = (p * 100).toFixed(2) + '%';
  }

  if (state.lastPhase != null && state.lastPhase !== seg.peak) {
    showSign(seg.peak ? '峰段开始' : '谷段到了', 2600);
    runOneShot('hop');
    spawnFx(seg.peak ? 'angry' : 'star', { x: 0.78, y: 0.2, dx: 10, dy: -16, size: 16 });
  }
  state.lastPhase = seg.peak;
}

async function runOneShot(id) {
  if (state.busy) return;
  const a = ACTIONS.find((x) => x.id === id);
  if (!a) return;
  state.busy = true;
  try {
    await a.run();
  } catch (e) {
    /* ignore */
  }
  state.busy = false;
}

/* ---------------------------------------------------------- 交互心跳 */

function touch() {
  state.lastInteract = Date.now();
  if (state.poseActive) cancelPose();
  if (state.sleeping) {
    state.sleeping = false;
    startIdle();
    spawnFx('heart', { x: 0.5, y: 0.25, dx: 0, dy: -40, size: 14 });
  }
}

let zzzTimer = null;
function enterSleep() {
  if (state.sleeping) return;
  state.sleeping = true;
  startIdle();
  clearInterval(zzzTimer);
  zzzTimer = setInterval(() => {
    if (!state.sleeping) return;
    spawnFx('zzz', { x: 0.72, y: 0.2, dx: 18, dy: -38, size: 15, dur: 2200 });
  }, 3400);
}

function exitSleep() {
  state.sleeping = false;
  clearInterval(zzzTimer);
  zzzTimer = null;
  startIdle();
}

/* ---------------------------------------------------------- 调度 */

let actionTimer = null;
function scheduleAction() {
  clearTimeout(actionTimer);
  const delay = 3000 + Math.random() * 3800;
  actionTimer = setTimeout(async () => {
    if (!state.dragging && !state.busy && !state.sleeping) await runRandomAction();
    scheduleAction();
  }, delay);
}

function reconcile() {
  const idleFor = Date.now() - state.lastInteract;
  const want = desiredForm();
  if (want !== state.form) setForm(want);

  if (idleFor > IDLE_TO_SLEEP && !state.sleeping && !state.bubbleOpen) enterSleep();
  else if (idleFor < IDLE_TO_SLEEP && state.sleeping) exitSleep();
}

/* ---------------------------------------------------------- 启动 */

function applyConfig(cfg) {
  if (!cfg) return;
  state.cfg = cfg;
  const want = cfg.mode !== 'auto' ? cfg.mode : desiredForm();
  const changed = want !== state.form;
  setForm(want);
  // 形态没变时立即刷新缩放；形态变了则等换图那一帧一起应用，否则旧图会先按新缩放闪一下
  if (!changed) applyScale();
  reportState();
  renderPhase();
}


(async function boot() {
  if (location.search.includes('debug')) document.body.classList.add('debug');

  if (sprite.complete && sprite.naturalWidth) buildMask();
  sprite.addEventListener('load', buildMask);

  document.addEventListener('mousedown', (e) => {
    if (!e.target.closest('.hit')) return;
    touch();
  });

  api.onData((d) => renderData(d));
  api.onError(() => {
    el('updated').textContent = '读取失败，稍后自动重试';
    el('btnRefresh').classList.remove('busy');
    el('btnRefresh').textContent = '刷新';
  });
  api.onConfig((cfg) => applyConfig(cfg));
  api.onDragStop(() => {
    if (drag && drag.started) endDrag({ clientX: 0, clientY: 0, button: 0, pointerId: drag.id });
  });
  api.onBubble((open) => {
    touch();
    toggleBubble(!!open);
  });
  api.onAction((id) => {
    touch();
    if (id === 'pose') {
      runRandomActionById('pose');
      return;
    }
    runRandomActionById(id);
  });

  let info = null;
  try {
    info = await api.init();
  } catch (e) {
    /* ignore */
  }
  if (info && info.workArea) state.workArea = info.workArea;
  if (info && info.config) applyConfig(info.config);
  if (info && info.poses) state.poses = info.poses;
  if (info && info.poseMeta) state.poseMeta = info.poseMeta;
  if (info && info.data) renderData(info.data);

  reportState();
  setInterval(reportState, 250);

  /* 供自检脚本调用 */
  window.__wbpet = {
    state,
    reportState,
    setForm,
    toggleBubble,
    showSign,
    spawnFx,
    renderPhase,
    playPose,
    playAction: (id) => {
      const a = ACTIONS.find((x) => x.id === id);
      return a ? a.run() : null;
    }
  };

  if (location.search.includes('open')) setTimeout(() => toggleBubble(true), 700);

  startIdle();
  scheduleAction();
  setInterval(reconcile, 5000);
  setInterval(renderPhase, 1000);
})();
