/*
 * KASANE — サイト挙動。
 *
 * スクロールは奪わない。ネイティブのまま走らせて、読み取った値を
 * ひとつの rAF ループの中で慣性補間し、CSS 変数と WebGL に配る。
 */

import { createCloth } from './gl.js';

const root = document.documentElement;
const $ = (s, c = document) => c.querySelector(s);
const $$ = (s, c = document) => [...c.querySelectorAll(s)];
const lerp = (a, b, t) => a + (b - a) * t;
const clamp01 = (v) => (v < 0 ? 0 : v > 1 ? 1 : v);

/* 動きを減らす設定。?motion=force で押し切り、?motion=reduce で強制する（表示確認用） */
const motionParam = new URLSearchParams(location.search).get('motion');
const reduced = motionParam === 'reduce'
  || (motionParam !== 'force' && window.matchMedia('(prefers-reduced-motion: reduce)').matches);
if (reduced) root.classList.add('reduced');

/* ══ 幕 ═══════════════════════════════════════════════════ */

const veil = $('#veil');
let introStart = 0;

function liftVeil() {
  if (!veil || veil.dataset.done) return;
  veil.dataset.done = '1';
  veil.classList.add('is-up');
  root.classList.add('is-ready');
  introStart = performance.now();
  window.setTimeout(() => veil.remove(), reduced ? 0 : 1500);
}

if (reduced) {
  liftVeil();
} else {
  // フォントが決まってから引き上げる。決まらなくても 2.2 秒で必ず開ける
  const fonts = document.fonts ? document.fonts.ready : Promise.resolve();
  Promise.race([fonts, new Promise((r) => setTimeout(r, 2200))])
    .then(() => setTimeout(liftVeil, 420));
  window.setTimeout(liftVeil, 3400);
}

/* ══ 布 ═══════════════════════════════════════════════════ */

const canvas = $('#cloth');
const cloth = canvas ? createCloth(canvas) : null;

function sizeCloth() {
  if (!cloth) return;
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  cloth.resize(window.innerWidth, window.innerHeight, dpr);
}
sizeCloth();

let resizeTimer = 0;
window.addEventListener('resize', () => {
  window.clearTimeout(resizeTimer);
  resizeTimer = window.setTimeout(() => {
    sizeCloth();
    measure();
    if (reduced) drawStill();
  }, 140);
});

/* ══ 位置の実測 ════════════════════════════════════════════ */

const wipe = $('#wipe');
const coll = $('#collection');
const track = $('#track');
const gauge = $('#gauge');
const hero = $('#hero');

let M = { wipeTop: 0, wipeLen: 1, collTop: 0, collLen: 1, trackOver: 0, heroH: 1, docLen: 1 };

function measure() {
  const y = window.scrollY;
  if (wipe) {
    const r = wipe.getBoundingClientRect();
    M.wipeTop = r.top + y;
    M.wipeLen = Math.max(1, wipe.offsetHeight - window.innerHeight);
  }
  if (coll && track) {
    const r = coll.getBoundingClientRect();
    M.collTop = r.top + y;
    M.collLen = Math.max(1, coll.offsetHeight - window.innerHeight);
    M.trackOver = Math.max(0, track.scrollWidth - window.innerWidth);
  }
  M.heroH = hero ? hero.offsetHeight : window.innerHeight;
  M.docLen = Math.max(1, document.documentElement.scrollHeight - window.innerHeight);
}

measure();
window.addEventListener('load', measure);
if (document.fonts) document.fonts.ready.then(measure);

/* ══ ポインタ ══════════════════════════════════════════════ */

let ptrX = 0, ptrY = 0, ptrTX = 0, ptrTY = 0;
if (!reduced) {
  window.addEventListener('pointermove', (e) => {
    ptrTX = (e.clientX / window.innerWidth) * 2 - 1;
    ptrTY = 1 - (e.clientY / window.innerHeight) * 2;
  }, { passive: true });
}

/* ══ ループ ════════════════════════════════════════════════ */

let smoothY = window.scrollY;
let lastY = window.scrollY;
let vel = 0;

/* ヘッダの帯にかかっているのが生成りの面かどうか */
const HEAD_Y = 46;
const circle = $('.wipe__circle');

/* 写真が頭に来うるセクション。ここでだけヘッダの下に薄く敷く。
   洗朱のベタ面に敷くと暗い帯になるので、対象から外している */
const scrimZones = ['collection', 'fabric', 'greetings', 'contact']
  .map((id) => document.getElementById(id))
  .filter(Boolean);

function spansHead(el) {
  const r = el.getBoundingClientRect();
  return r.top <= HEAD_Y && r.bottom >= HEAD_Y;
}

function overLight() {
  if (coll && spansHead(coll)) return true;
  // 円は途中からヘッダを覆う。半径と中心から実際に届いているかを見る
  if (circle) {
    const r = circle.getBoundingClientRect();
    if (r.width > 8) {
      const cx = r.left + r.width / 2;
      const cy = r.top + r.height / 2;
      const rad = r.width / 2;
      if (Math.hypot(120 - cx, HEAD_Y - cy) < rad) return true;
    }
  }
  return false;
}

function paint(scrollY, velNorm) {
  const prog = clamp01(scrollY / M.docLen);
  if (gauge) gauge.style.transform = `scaleY(${prog})`;

  // 円マスク。0 → 1 で生成りの円が洗朱を割って開く
  if (wipe) {
    const p = clamp01((scrollY - M.wipeTop) / M.wipeLen);
    wipe.style.setProperty('--p', p.toFixed(4));
  }

  // 固定要素の色。生成りの面に差しかかったら墨に返す
  root.classList.toggle('on-light', overLight());
  root.classList.toggle('needs-scrim', scrimZones.some(spansHead));

  // 横に流れている間は、左のレールがルックに被るので引っ込める
  if (coll) {
    const r = coll.getBoundingClientRect();
    root.classList.toggle('in-coll', r.top <= 0 && r.bottom >= window.innerHeight);
  }

  // 横に流れるコレクション
  if (track && M.trackOver > 0) {
    const p = clamp01((scrollY - M.collTop) / M.collLen);
    track.style.transform = `translate3d(${(-M.trackOver * p).toFixed(1)}px,0,0)`;
  }

  // ヒーローを離れたら布を落ち着かせる
  if (canvas) {
    const away = clamp01((scrollY - M.heroH * 0.35) / (M.heroH * 0.65));
    canvas.style.opacity = (1 - away * 0.62).toFixed(3);
  }

  // ヒーローの見出しは、離れるにつれて静かに沈む
  if (hero) {
    const p = clamp01(scrollY / Math.max(1, M.heroH));
    hero.style.setProperty('--away', p.toFixed(4));
  }

  markActive(scrollY);
  void velNorm;
}

/* 右のドット */
const dots = $$('#dots li');
let activeId = '';
function markActive(scrollY) {
  const mid = scrollY + window.innerHeight * 0.4;
  let found = '';
  for (const d of dots) {
    const el = document.getElementById(d.dataset.for);
    if (el && el.offsetTop <= mid) found = d.dataset.for;
  }
  if (found === activeId) return;
  activeId = found;
  for (const d of dots) d.classList.toggle('is-on', d.dataset.for === found);
}

function drawStill() {
  paint(window.scrollY, 0);
  if (cloth && cloth.webgl) cloth.render({ time: 12.5, vel: 0, intro: 1, px: 0, py: 0 });
}

if (reduced) {
  drawStill();
  window.addEventListener('scroll', () => paint(window.scrollY, 0), { passive: true });
} else {
  const tick = (now) => {
    const y = window.scrollY;

    // 生のスクロール差分を速度に、そのあと減衰させる
    const raw = Math.abs(y - lastY);
    lastY = y;
    vel = Math.max(vel * 0.90, Math.min(raw / 55, 1));

    smoothY = lerp(smoothY, y, 0.14);
    ptrX = lerp(ptrX, ptrTX, 0.05);
    ptrY = lerp(ptrY, ptrTY, 0.05);

    paint(y, vel);

    if (cloth && cloth.webgl) {
      const intro = introStart ? clamp01((now - introStart) / 1600) : 0;
      cloth.render({
        time: now / 1000,
        vel,
        intro: intro * intro * (3 - 2 * intro),
        px: ptrX,
        py: ptrY,
      });
    }
    requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);
}

/* ══ 出現 ══════════════════════════════════════════════════ */

const revealTargets = $$('[data-reveal], [data-stagger]');
if (reduced || !('IntersectionObserver' in window)) {
  for (const el of revealTargets) el.classList.add('is-in');
} else {
  for (const el of $$('[data-stagger]')) {
    [...el.children].forEach((c, i) => c.style.setProperty('--i', String(i)));
  }
  const io = new IntersectionObserver((entries) => {
    for (const e of entries) {
      if (!e.isIntersecting) continue;
      e.target.classList.add('is-in');
      io.unobserve(e.target);
    }
  }, { rootMargin: '0px 0px -12% 0px', threshold: 0.12 });
  for (const el of revealTargets) io.observe(el);
}

/* ══ ナビ ══════════════════════════════════════════════════ */

const burger = $('#burger');
const nav = $('#nav');

function setNav(open) {
  if (!nav || !burger) return;
  burger.setAttribute('aria-expanded', String(open));
  root.classList.toggle('nav-open', open);
  if (open) {
    nav.hidden = false;
    requestAnimationFrame(() => nav.classList.add('is-open'));
  } else {
    nav.classList.remove('is-open');
    window.setTimeout(() => { if (!root.classList.contains('nav-open')) nav.hidden = true; }, reduced ? 0 : 520);
  }
}

burger?.addEventListener('click', () => setNav(burger.getAttribute('aria-expanded') !== 'true'));
nav?.addEventListener('click', (e) => { if (e.target.closest('a')) setNav(false); });
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape' && root.classList.contains('nav-open')) {
    setNav(false);
    burger?.focus();
  }
});

/* コレクションは縦スクロールに紐づくため、アンカー着地を実位置に合わせる */
for (const a of $$('a[href^="#"]')) {
  a.addEventListener('click', () => window.setTimeout(measure, 400));
}
