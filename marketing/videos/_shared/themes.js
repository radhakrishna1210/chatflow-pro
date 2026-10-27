// Animated backgrounds for the series 2 colour schemes. Each theme builds its
// layers once and returns draw(t), a pure function of t like everything else.

function rng(seed) {
  return () => { seed |= 0; seed = (seed + 0x6d2b79f5) | 0; let x = Math.imul(seed ^ (seed >>> 15), 1 | seed); x = (x + Math.imul(x ^ (x >>> 7), 61 | x)) ^ x; return ((x ^ (x >>> 14)) >>> 0) / 4294967296; };
}
const el = (cls, css) => { const d = document.createElement('div'); d.className = cls; Object.assign(d.style, css); return d; };
const NS = 'http://www.w3.org/2000/svg';

function blobs(root, list) {
  return list.map(([c, size, x, y, o]) => { const b = el('blob', { width: size + 'px', height: size + 'px', background: c, opacity: o ?? 0.55 }); b._p = [x, y, size]; root.appendChild(b); return b; });
}
function driftBlobs(bs, t, W, H) {
  bs.forEach((b, i) => { const [x, y, s] = b._p; b.style.transform = `translate(${x * W - s / 2 + Math.sin(t * 0.3 + i * 2) * 140}px, ${y * H - s / 2 + Math.cos(t * 0.25 + i) * 110}px)`; });
}

const THEMES = {
  saffron(root, W, H) {
    root.appendChild(el('base', { background: 'radial-gradient(120% 70% at 50% 0%, #6b1424 0%, #2a060f 55%, #12030a 100%)' }));
    const bs = blobs(root, [['#ff7a18', 800, 0.85, 0.12, 0.5], ['#ffc94a', 700, 0.1, 0.85, 0.35], ['#d6246e', 700, 0.2, 0.3, 0.35]]);
    const svg = document.createElementNS(NS, 'svg');
    svg.setAttribute('viewBox', `0 0 ${W} ${H}`);
    const g = document.createElementNS(NS, 'g');
    const cx = W / 2, cy = H * 0.86;
    [260, 360, 470, 600].forEach((r, i) => {
      const c = document.createElementNS(NS, 'circle');
      Object.entries({ cx, cy, r, fill: 'none', stroke: i % 2 ? '#ffc94a' : '#ff7a3d', 'stroke-width': 3, 'stroke-dasharray': i % 2 ? '4 22' : '40 18', opacity: 0.35 }).forEach(([k, v]) => c.setAttribute(k, v));
      g.appendChild(c);
    });
    for (let k = 0; k < 16; k++) {
      const p = document.createElementNS(NS, 'ellipse');
      const a = (k / 16) * Math.PI * 2;
      Object.entries({ cx: cx + Math.cos(a) * 180, cy: cy + Math.sin(a) * 180, rx: 60, ry: 20, fill: 'none', stroke: '#ffc94a', 'stroke-width': 2.5, opacity: 0.35, transform: `rotate(${(a * 180) / Math.PI} ${cx + Math.cos(a) * 180} ${cy + Math.sin(a) * 180})` }).forEach(([kk, v]) => p.setAttribute(kk, v));
      g.appendChild(p);
    }
    svg.appendChild(g); root.appendChild(svg);
    const r = rng(11);
    const pts = Array.from({ length: 70 }, () => { const s = 4 + r() * 10; const d = el('pt', { width: s + 'px', height: s + 'px', background: r() > 0.3 ? '#ffd56b' : '#ff8a3d', boxShadow: `0 0 ${s * 2.5}px ${r() > 0.5 ? '#ffb02e' : '#ff6a2b'}` }); d._p = [r() * W, r() * H, 30 + r() * 90, r() * 6]; root.appendChild(d); return d; });
    return t => {
      driftBlobs(bs, t, W, H);
      g.setAttribute('transform', `rotate(${t * 6} ${cx} ${cy})`);
      pts.forEach(d => { const [x, y, sp, ph] = d._p; const yy = ((y - t * sp) % (H + 60) + H + 60) % (H + 60) - 30; d.style.transform = `translate(${x + Math.sin(t + ph) * 30}px, ${yy}px)`; d.style.opacity = String(0.35 + 0.65 * Math.abs(Math.sin(t * 2.2 + ph))); });
    };
  },

  ocean(root, W, H) {
    root.appendChild(el('base', { background: 'linear-gradient(170deg, #05474b 0%, #032a2e 45%, #01161a 100%)' }));
    const bs = blobs(root, [['#11c58b', 800, 0.8, 0.15, 0.45], ['#2ad4ff', 700, 0.15, 0.7, 0.35], ['#c8ff5a', 500, 0.7, 0.9, 0.18]]);
    const svg = document.createElementNS(NS, 'svg');
    svg.setAttribute('viewBox', `0 0 ${W} ${H}`);
    const paths = Array.from({ length: 9 }, (_, i) => { const p = document.createElementNS(NS, 'path'); p.setAttribute('fill', 'none'); p.setAttribute('stroke', i % 3 ? '#5ef2c6' : '#2ad4ff'); p.setAttribute('stroke-width', i % 3 ? 2 : 3); p.setAttribute('opacity', 0.12 + (i % 3) * 0.06); svg.appendChild(p); return p; });
    root.appendChild(svg);
    const r = rng(5);
    const pts = Array.from({ length: 34 }, () => { const s = 6 + r() * 16; const d = el('pt', { width: s + 'px', height: s + 'px', border: '2px solid rgba(160,255,230,.35)' }); d._p = [r() * W, r() * H, 20 + r() * 50, r() * 6]; root.appendChild(d); return d; });
    return t => {
      driftBlobs(bs, t, W, H);
      paths.forEach((p, i) => {
        const base = H * (0.55 + i * 0.05), amp = 40 + i * 8, k = 0.004 + i * 0.0004, ph = t * (0.6 + i * 0.08) + i;
        let d = `M 0 ${base}`;
        for (let x = 0; x <= W; x += 30) d += ` L ${x} ${base + Math.sin(x * k + ph) * amp + Math.sin(x * k * 2.3 - ph * 0.7) * amp * 0.3}`;
        p.setAttribute('d', d);
      });
      pts.forEach(d => { const [x, y, sp, ph] = d._p; const yy = ((y - t * sp) % (H + 40) + H + 40) % (H + 40) - 20; d.style.transform = `translate(${x + Math.sin(t * 0.8 + ph) * 20}px, ${yy}px)`; });
    };
  },

  violet(root, W, H) {
    root.appendChild(el('base', { background: 'linear-gradient(180deg, #07021a 0%, #140636 50%, #2e0b5a 70%, #5a1278 79%, #12052c 80.5%, #07021a 100%)' }));
    const r = rng(3);
    const stars = Array.from({ length: 90 }, () => { const s = 1.5 + r() * 3; const d = el('pt', { width: s + 'px', height: s + 'px', background: '#fff', left: r() * W + 'px', top: r() * H * 0.75 + 'px' }); d._ph = r() * 6; root.appendChild(d); return d; });
    const sunSize = Math.min(W, H) * 0.5, horizon = H * 0.8;
    const sun = el('sun', { width: sunSize + 'px', height: sunSize + 'px', left: (W - sunSize) / 2 + 'px', top: horizon - sunSize * 0.62 + 'px', opacity: 0.9 });
    root.appendChild(sun);
    const glow = el('blob', { width: sunSize * 1.4 + 'px', height: sunSize * 0.8 + 'px', background: '#ff3fb4', left: (W - sunSize * 1.4) / 2 + 'px', top: horizon - sunSize * 0.5 + 'px', opacity: 0.35 });
    root.appendChild(glow);
    const floor = el('floor', {}); root.appendChild(floor);
    root.appendChild(el('grain', {}));
    return t => {
      stars.forEach(d => { d.style.opacity = String(0.25 + 0.75 * Math.abs(Math.sin(t * 1.5 + d._ph))); });
      floor.style.backgroundPosition = `0 ${(t * 140) % 120}px`;
      sun.style.transform = `translateY(${Math.sin(t * 0.4) * 10}px)`;
    };
  },

  day(root, W, H) {
    root.appendChild(el('base', { background: 'linear-gradient(170deg, #f7fbff 0%, #eef4fa 100%)' }));
    const bs = blobs(root, [['#b9f0d6', 800, 0.85, 0.1, 0.8], ['#cfe1ff', 800, 0.1, 0.55, 0.8], ['#e6dcff', 600, 0.75, 0.9, 0.7]]);
    const svg = document.createElementNS(NS, 'svg');
    svg.innerHTML = `<defs><pattern id="dots" width="36" height="36" patternUnits="userSpaceOnUse"><circle cx="2" cy="2" r="2" fill="#0c1b33" opacity=".07"/></pattern></defs><rect width="100%" height="100%" fill="url(#dots)"/>`;
    root.appendChild(svg);
    const r = rng(9);
    const cols = ['#19b36b', '#0aa5c2', '#3466f6', '#ffb020'];
    const shapes = Array.from({ length: 16 }, (_, i) => { const s = 30 + r() * 60; const d = el('pt', { width: s + 'px', height: s + 'px', border: `4px solid ${cols[i % 4]}`, borderRadius: i % 2 ? '50%' : '28%', opacity: 0.22 }); d._p = [r() * W, r() * H, 10 + r() * 30, r() * 6]; root.appendChild(d); return d; });
    return t => {
      driftBlobs(bs, t, W, H);
      shapes.forEach(d => { const [x, y, sp, ph] = d._p; d.style.transform = `translate(${x + Math.sin(t * 0.5 + ph) * 40}px, ${y + Math.cos(t * 0.4 + ph) * 40}px) rotate(${t * sp}deg)`; });
    };
  },

  sunrise(root, W, H) {
    root.appendChild(el('base', { background: 'linear-gradient(165deg, #ffe0c9 0%, #ffd0e2 50%, #e2d9ff 100%)' }));
    const bs = blobs(root, [['#ff9a5a', 800, 0.85, 0.08, 0.55], ['#ffd34d', 650, 0.1, 0.35, 0.45], ['#ff6fae', 700, 0.75, 0.75, 0.45], ['#9d7bff', 600, 0.15, 0.95, 0.4]]);
    const r = rng(21);
    const bok = Array.from({ length: 28 }, () => { const s = 20 + r() * 110; const d = el('pt', { width: s + 'px', height: s + 'px', background: 'rgba(255,255,255,.45)', filter: `blur(${2 + r() * 6}px)` }); d._p = [r() * W, r() * H, 10 + r() * 35, r() * 6]; root.appendChild(d); return d; });
    root.appendChild(el('grain', { opacity: 0.05 }));
    return t => {
      driftBlobs(bs, t, W, H);
      bok.forEach(d => { const [x, y, sp, ph] = d._p; const yy = ((y - t * sp) % (H + 200) + H + 200) % (H + 200) - 100; d.style.transform = `translate(${x + Math.sin(t * 0.6 + ph) * 30}px, ${yy}px)`; d.style.opacity = String(0.4 + 0.6 * Math.abs(Math.sin(t * 0.8 + ph))); });
    };
  },

  paper(root, W, H) {
    root.appendChild(el('base', { background: '#f6f1e7' }));
    const bs = blobs(root, [['#bdebdc', 700, 0.9, 0.1, 0.55], ['#ffd2c4', 600, 0.05, 0.6, 0.5], ['#fbe6b0', 600, 0.8, 0.92, 0.45]]);
    const svg = document.createElementNS(NS, 'svg');
    svg.innerHTML = `<defs><pattern id="rule" width="${W}" height="64" patternUnits="userSpaceOnUse"><line x1="0" y1="63" x2="${W}" y2="63" stroke="#17140f" stroke-opacity=".06" stroke-width="2"/></pattern></defs><rect width="100%" height="100%" fill="url(#rule)"/><line x1="96" y1="0" x2="96" y2="${H}" stroke="#ef5b45" stroke-opacity=".25" stroke-width="3"/>`;
    root.appendChild(svg);
    const r = rng(17);
    const marks = Array.from({ length: 9 }, (_, i) => { const s = 60 + r() * 80; const d = el('pt', { width: s + 'px', height: s + 'px', border: `5px solid ${i % 2 ? '#0e9f7e' : '#ef5b45'}`, borderRadius: '48% 52% 45% 55%', opacity: 0.16 }); d._p = [r() * W, r() * H, r() * 6]; root.appendChild(d); return d; });
    root.appendChild(el('grain', { opacity: 0.06, mixBlendMode: 'multiply', backgroundImage: 'radial-gradient(rgba(0,0,0,.5) 1px, transparent 1.2px)' }));
    return t => {
      driftBlobs(bs, t, W, H);
      marks.forEach(d => { const [x, y, ph] = d._p; d.style.transform = `translate(${x + Math.sin(t * 0.4 + ph) * 30}px, ${y + Math.cos(t * 0.35 + ph) * 30}px) rotate(${t * 8 + ph * 40}deg)`; });
    };
  },

  gold(root, W, H) {
    root.appendChild(el('base', { background: 'radial-gradient(110% 70% at 50% 30%, #1d160b 0%, #0b0906 60%, #050403 100%)' }));
    const bs = blobs(root, [['#c8953f', 700, 0.85, 0.05, 0.22], ['#8a5f22', 700, 0.1, 0.9, 0.22]]);
    const svg = document.createElementNS(NS, 'svg');
    svg.setAttribute('viewBox', `0 0 ${W} ${H}`);
    const g = document.createElementNS(NS, 'g');
    for (let i = -20; i < 40; i++) { const l = document.createElementNS(NS, 'line'); Object.entries({ x1: i * 90, y1: 0, x2: i * 90 - H * 0.6, y2: H, stroke: '#e7c26b', 'stroke-opacity': i % 5 ? 0.05 : 0.12, 'stroke-width': i % 5 ? 1.5 : 2.5 }).forEach(([k, v]) => l.setAttribute(k, v)); g.appendChild(l); }
    svg.appendChild(g); root.appendChild(svg);
    const r = rng(29);
    const dust = Array.from({ length: 60 }, () => { const s = 2 + r() * 6; const d = el('pt', { width: s + 'px', height: s + 'px', background: '#f5dc96', boxShadow: `0 0 ${s * 3}px #e0b25a` }); d._p = [r() * W, r() * H, 8 + r() * 25, r() * 6]; root.appendChild(d); return d; });
    root.appendChild(el('base', { background: 'radial-gradient(90% 70% at 50% 45%, transparent 55%, rgba(0,0,0,.65) 100%)' }));
    return t => {
      driftBlobs(bs, t, W, H);
      g.setAttribute('transform', `translate(${(t * 18) % 90} 0)`);
      dust.forEach(d => { const [x, y, sp, ph] = d._p; const yy = ((y - t * sp) % (H + 40) + H + 40) % (H + 40) - 20; d.style.transform = `translate(${x + Math.sin(t * 0.7 + ph) * 25}px, ${yy}px)`; d.style.opacity = String(0.2 + 0.8 * Math.abs(Math.sin(t * 1.3 + ph))); });
    };
  },

  pop(root, W, H) {
    root.appendChild(el('base', { background: '#ffd93d' }));
    const svg = document.createElementNS(NS, 'svg');
    svg.setAttribute('viewBox', `0 0 ${W} ${H}`);
    const burst = document.createElementNS(NS, 'g');
    const cx = W * 0.5, cy = H * 0.5, R = Math.max(W, H);
    for (let k = 0; k < 24; k++) { const a0 = (k / 24) * Math.PI * 2, a1 = a0 + Math.PI / 24; const p = document.createElementNS(NS, 'path'); p.setAttribute('d', `M ${cx} ${cy} L ${cx + Math.cos(a0) * R} ${cy + Math.sin(a0) * R} L ${cx + Math.cos(a1) * R} ${cy + Math.sin(a1) * R} Z`); p.setAttribute('fill', '#ffcb05'); burst.appendChild(p); }
    svg.appendChild(burst);
    const dots = document.createElementNS(NS, 'g');
    for (let y = 0; y < 11; y++) for (let x = 0; x < 11; x++) { const c = document.createElementNS(NS, 'circle'); const rr = Math.max(0, 12 - (x + y) * 0.6); if (!rr) continue; Object.entries({ cx: W - x * 32 - 20, cy: H - y * 32 - 20, r: rr, fill: '#111' }).forEach(([k, v]) => c.setAttribute(k, v)); dots.appendChild(c); }
    const dots2 = dots.cloneNode(true); dots2.setAttribute('transform', `translate(${W} 0) scale(-1 1)`);
    svg.appendChild(dots); svg.appendChild(dots2);
    root.appendChild(svg);
    const r = rng(41);
    const cols = ['#ff2e88', '#2e5bff', '#111', '#fff'];
    const bits = Array.from({ length: 10 }, (_, i) => { const s = 40 + r() * 50; const d = el('pt', { width: s + 'px', height: s + 'px', background: cols[i % 4], border: '5px solid #111', borderRadius: i % 3 ? '50%' : '10px', opacity: 0.9 }); d._p = [i % 2 ? W - 70 - r() * 60 : 10 + r() * 60, r() * H, r() * 6]; root.appendChild(d); return d; });
    return t => {
      burst.setAttribute('transform', `rotate(${t * 6} ${cx} ${cy})`);
      bits.forEach(d => { const [x, y, ph] = d._p; d.style.transform = `translate(${x + Math.sin(t * 0.9 + ph) * 26}px, ${y + Math.cos(t * 0.8 + ph) * 26}px) rotate(${t * 30 + ph * 60}deg)`; });
    };
  },

  cyber(root, W, H) {
    root.appendChild(el('base', { background: 'radial-gradient(100% 60% at 50% 0%, #0b1f14 0%, #040706 60%)' }));
    const bs = blobs(root, [['#b6ff2e', 600, 0.9, 0.08, 0.14], ['#2ef6ff', 600, 0.1, 0.85, 0.14]]);
    const grid = el('base', { backgroundImage: 'linear-gradient(rgba(182,255,46,.07) 2px, transparent 2px), linear-gradient(90deg, rgba(182,255,46,.07) 2px, transparent 2px)', backgroundSize: '90px 90px' });
    root.appendChild(grid);
    const r = rng(53);
    const cols = Array.from({ length: 16 }, () => { const d = el('pt', { borderRadius: 0, width: '3px', height: 120 + r() * 220 + 'px', background: 'linear-gradient(transparent, #b6ff2e)', opacity: 0.35 }); d._p = [Math.floor(r() * 12) * 90 + 44, r() * H, 120 + r() * 220]; root.appendChild(d); return d; });
    root.appendChild(el('scan', {}));
    const bar = el('bar', {}); root.appendChild(bar);
    return t => {
      driftBlobs(bs, t, W, H);
      grid.style.backgroundPosition = `0 ${(t * 30) % 90}px`;
      cols.forEach(d => { const [x, y, sp] = d._p; const yy = ((y + t * sp) % (H + 400)) - 300; d.style.transform = `translate(${x}px, ${yy}px)`; });
      bar.style.transform = `translateY(${((t * 300) % (H + 400)) - 220}px)`;
    };
  },

  forest(root, W, H) {
    root.appendChild(el('base', { background: 'linear-gradient(170deg, #134a33 0%, #0c2419 55%, #07160f 100%)' }));
    const bs = blobs(root, [['#c7e07a', 700, 0.85, 0.1, 0.18], ['#f2b84b', 600, 0.1, 0.75, 0.16], ['#2f8a5c', 800, 0.5, 0.45, 0.35]]);
    const r = rng(61);
    const cols = ['#2f8a5c', '#3fa36b', '#c7e07a', '#1f6b45'];
    const leaves = Array.from({ length: 22 }, (_, i) => { const s = 50 + r() * 110; const d = el('leaf', { width: s + 'px', height: s * 0.55 + 'px', background: cols[i % 4], opacity: 0.16 + r() * 0.2 }); d._p = [r() * W, r() * H, 15 + r() * 35, r() * 6]; root.appendChild(d); return d; });
    root.appendChild(el('grain', { opacity: 0.05 }));
    return t => {
      driftBlobs(bs, t, W, H);
      leaves.forEach(d => { const [x, y, sp, ph] = d._p; const yy = ((y + t * sp) % (H + 200)) - 100; d.style.transform = `translate(${x + Math.sin(t * 0.7 + ph) * 60}px, ${yy}px) rotate(${Math.sin(t * 0.6 + ph) * 50 + ph * 60}deg)`; });
    };
  },
};

/** Paint theme `name` behind the stage; returns draw(t). */
export function theme(name) {
  document.body.classList.add('theme-' + name);
  const stage = document.querySelector('.stage');
  const root = el('tbg', {});
  stage.insertBefore(root, stage.firstChild);
  return THEMES[name](root, innerWidth, innerHeight);
}
