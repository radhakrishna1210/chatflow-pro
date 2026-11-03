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
};

/** Paint theme `name` behind the stage; returns draw(t). */
export function theme(name) {
  document.body.classList.add('theme-' + name);
  const stage = document.querySelector('.stage');
  const root = el('tbg', {});
  stage.insertBefore(root, stage.firstChild);
  return THEMES[name](root, innerWidth, innerHeight);
}
