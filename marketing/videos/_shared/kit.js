// Shared motion kit for the Spandan films.
//
// Every helper is a pure function of t: it sets the element's style for that
// moment and keeps no state between calls, so any frame can be drawn in any
// order (OpenFilm's one rule).

import { theme as paintTheme } from './themes.js';

export const clamp = (x, a = 0, b = 1) => Math.min(b, Math.max(a, x));
export const lerp = (a, b, x) => a + (b - a) * x;
export const ease = {
  lin: x => x,
  out: x => 1 - Math.pow(1 - x, 3),
  in: x => x * x * x,
  inOut: x => (x < 0.5 ? 4 * x * x * x : 1 - Math.pow(-2 * x + 2, 3) / 2),
  back: x => { const c = 1.70158, c3 = c + 1; return 1 + c3 * Math.pow(x - 1, 3) + c * Math.pow(x - 1, 2); },
  expo: x => (x === 1 ? 1 : 1 - Math.pow(2, -10 * x)),
};
/** Progress 0..1 of a span that starts at `at` and lasts `d`. */
export const p = (t, at, d = 0.6) => clamp((t - at) / d);
export const $ = (s, r = document) => r.querySelector(s);
export const $$ = (s, r = document) => [...r.querySelectorAll(s)];

/**
 * Enter at `at` (fade + move + scale), optionally leave at `out`.
 * o: { d, x, y, s, rot, blur, out, outD, outY, outX, e }
 */
export function enter(el, t, at, o = {}) {
  if (!el) return 0;
  const d = o.d ?? 0.6, e = o.e ?? ease.out;
  const k = e(p(t, at, d));
  const q = o.out != null ? ease.in(p(t, o.out, o.outD ?? 0.4)) : 0;
  const x = lerp(o.x ?? 0, 0, k) + (o.outX ?? 0) * q;
  const y = lerp(o.y ?? 40, 0, k) + (o.outY ?? -30) * q;
  const s = lerp(o.s ?? 1, 1, k) * (1 - 0.04 * q);
  const r = lerp(o.rot ?? 0, 0, k);
  el.style.opacity = String(Math.min(clamp(k * 1.4), 1 - q));
  el.style.transform = `translate(${x}px, ${y}px) scale(${s}) rotate(${r}deg)`;
  if (o.blur) el.style.filter = `blur(${(1 - k) * o.blur + q * o.blur}px)`;
  return k * (1 - q);
}

/** Pop in with overshoot (bubbles, badges, stamps). */
export const pop = (el, t, at, o = {}) => enter(el, t, at, { d: 0.45, y: 0, s: 0.4, e: ease.back, ...o });

/**
 * Split an element's text into word spans once. A child element's classes
 * (e.g. .hl gradient) move onto each of its words, so gradients survive.
 */
export function words(el) {
  if (el.dataset.split) return $$('.w', el);
  const out = [];
  const make = (text, cls) => text.split(/(\s+)/).forEach(part => {
    if (!part) return;
    if (/^\s+$/.test(part)) { out.push(document.createTextNode(part)); return; }
    const s = document.createElement('span');
    s.className = 'w' + (cls ? ' ' + cls : '');
    s.textContent = part;
    out.push(s);
  });
  [...el.childNodes].forEach(n => {
    if (n.nodeType === 3) make(n.textContent, '');
    else if (n.tagName === 'BR') out.push(n.cloneNode());
    else make(n.textContent, n.className);
  });
  el.textContent = '';
  out.forEach(n => el.appendChild(n));
  el.dataset.split = '1';
  return $$('.w', el);
}

/** Reveal an element's words one after another. */
export function drawWords(el, t, at, o = {}) {
  const ws = words(el);
  const rate = o.rate ?? 0.08;
  ws.forEach((w, i) => enter(w, t, at + i * rate, { d: o.d ?? 0.5, y: o.y ?? 50, s: o.s ?? 1, blur: o.blur ?? 8, out: o.out != null ? o.out + i * 0.02 : undefined, outY: -40 }));
}

/** Type a string in, with a caret while typing. */
export function typeText(el, text, t, at, cps = 26, caret = true) {
  const n = Math.floor(clamp((t - at) * cps, 0, text.length));
  const typing = t >= at && n < text.length;
  el.textContent = text.slice(0, n);
  if (caret && typing) el.insertAdjacentHTML('beforeend', '<span style="opacity:.8">|</span>');
  return n / text.length;
}

/** Count a number up between `a` and `b`. */
export function count(el, t, at, d, a, b, fmt = v => Math.round(v).toLocaleString('en-IN')) {
  el.textContent = fmt(lerp(a, b, ease.out(p(t, at, d))));
}

/** Gentle drift for the background orbs and grid. */
export function drawBg(root, t) {
  const bg = root.querySelector('.bg');
  if (!bg) return;
  const W = innerWidth, H = innerHeight;
  const [o1, o2, o3] = $$('.orb', bg);
  const g = $('.grid', bg);
  if (o1) o1.style.transform = `translate(${W * 0.55 + Math.sin(t * 0.35) * 160 - 450}px, ${H * 0.12 + Math.cos(t * 0.3) * 120 - 450}px)`;
  if (o2) o2.style.transform = `translate(${W * 0.05 + Math.cos(t * 0.27) * 180 - 400}px, ${H * 0.75 + Math.sin(t * 0.32) * 140 - 400}px)`;
  if (o3) o3.style.transform = `translate(${W * 0.7 + Math.sin(t * 0.22 + 2) * 200 - 350}px, ${H * 0.55 + Math.cos(t * 0.25) * 160 - 350}px)`;
  if (g) g.style.transform = `translate(${(t * 12) % 80}px, ${(t * 8) % 80}px)`;
}

export const bgHTML = (cls = '') => `<div class="bg ${cls}"><div class="grid"></div><div class="orb o1"></div><div class="orb o2"></div><div class="orb o3"></div></div>`;

const FONTS = ['700 1em "Bricolage Grotesque"', '800 1em "Bricolage Grotesque"', 'italic 600 1em Fraunces', '700 1em "Noto Sans Devanagari"', '600 1em "Noto Sans Devanagari"', '700 1em "Noto Sans Tamil"', '600 1em "Noto Sans Tamil"', '500 1em "Space Grotesk"', '600 1em "Space Grotesk"', '700 1em "Space Grotesk"', '500 1em Manrope', '600 1em Manrope', '700 1em Manrope', '800 1em Manrope', '500 1em "JetBrains Mono"', '600 1em "JetBrains Mono"', '1em "Noto Color Emoji"'];

/**
 * Declare the page. `setup` runs once the fonts are in (measure layout there);
 * `draw(t)` paints a moment. The background drifts on its own.
 */
export function film({ duration, setup, draw, bg = '', theme }) {
  const stage = document.querySelector('.stage');
  const themeDraw = theme ? paintTheme(theme) : null;
  if (!theme && stage && !stage.querySelector('.bg')) stage.insertAdjacentHTML('afterbegin', bgHTML(bg));
  const ready = Promise.all(FONTS.map(f => document.fonts.load(f, 'A😀₹कத'))).then(() => setup && setup());
  window.film = {
    duration,
    ready,
    frame(t) { if (themeDraw) themeDraw(t); else drawBg(document, t); draw(t); },
  };
}

/**
 * A WhatsApp thread. msgs: [{ at, side: 'in'|'out', html, ai, tpl, typing, until, time }]
 *  - typing: true makes a typing indicator that shows from `at` to `until`.
 *  - tpl: { img, imgBg, html, btns: [] } renders a template message card.
 */
export class Chat {
  constructor(body, msgs) {
    this.msgs = msgs.map(m => {
      const slot = document.createElement('div');
      slot.className = 'slot ' + (m.side || 'in');
      let inner;
      if (m.typing) inner = `<div class="bub typing"><i></i><i></i><i></i></div>`;
      else if (m.tpl) inner = `<div class="bub tpl"><div class="img" style="background:${m.tpl.imgBg || 'var(--grad-cta)'}">${m.tpl.img}</div><div class="txt">${m.tpl.html}<span class="meta">${m.time || '6:02 PM'}</span></div>${m.tpl.btns && m.tpl.btns.length ? `<div class="btns">${m.tpl.btns.map(b => `<div class="b">${b}</div>`).join('')}</div>` : ''}</div>`;
      else inner = `<div class="bub${m.ai ? ' ai' : ''}">${m.ai ? '<span class="tag">✦ SPANDAN AI</span><br>' : ''}${m.html}<span class="meta">${m.time || '6:04 PM'}${m.side === 'out' ? ' <span class="tk">✓✓</span>' : ''}</span></div>`;
      slot.innerHTML = `<div class="inner">${inner}</div>`;
      body.appendChild(slot);
      return { ...m, slot, bub: slot.querySelector('.bub') };
    });
  }
  measure() { this.msgs.forEach(m => { m.slot.style.height = 'auto'; m.h = m.slot.offsetHeight; }); }
  draw(t) {
    this.msgs.forEach(m => {
      if (m.h == null) this.measure();
      const k = ease.out(p(t, m.at, 0.35));
      const gone = m.until != null ? ease.inOut(p(t, m.until, 0.25)) : 0;
      m.slot.style.height = `${m.h * k * (1 - gone)}px`;
      const b = ease.back(p(t, m.at, 0.4));
      m.bub.style.transform = `scale(${lerp(0.5, 1, b)})`;
      m.bub.style.opacity = String(clamp(k * 2) * (1 - gone));
      if (m.typing) [...m.bub.children].forEach((d, i) => { d.style.transform = `translateY(${Math.sin(t * 9 - i * 0.9) * -6}px)`; });
    });
  }
}

/** A finger tap: a ring that grows and fades at `at`, positioned by its CSS. */
export function tap(el, t, at) {
  const k = p(t, at - 0.25, 0.7);
  el.style.opacity = String(k > 0 && k < 1 ? Math.sin(k * Math.PI) : 0);
  el.style.transform = `scale(${lerp(0.6, 1.4, ease.out(k))})`;
}

/** Countdown ring: fraction left from `at` over `d` seconds. */
export function ring(circle, t, at, d) {
  const r = +circle.getAttribute('r');
  const C = 2 * Math.PI * r;
  circle.style.strokeDasharray = `${C}`;
  circle.style.strokeDashoffset = `${C * p(t, at, d)}`;
}
