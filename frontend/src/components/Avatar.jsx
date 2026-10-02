// The one avatar used across the app. Null-safe on purpose: callers pass
// nullable fields straight through (contact.name, user.name), and a crash
// here used to take the whole view down.
const COLORS = ['#35e8f2', '#9d6bff', '#c4ff46', '#F59E0B', '#F472B6'];

// The shell's identity mark: a filled brand gradient with dark ink initials.
const GRADS = [
  'linear-gradient(135deg,#9d6bff,#35e8f2)',
  'linear-gradient(135deg,#35e8f2,#c4ff46)',
  'linear-gradient(135deg,#c4ff46,#9d6bff)',
  'linear-gradient(135deg,#f59e0b,#c4ff46)',
  'linear-gradient(135deg,#f472b6,#9d6bff)',
];

export const initials = (name) =>
  String(name ?? '').trim().split(/\s+/).filter(Boolean).map(n => n[0]).join('').slice(0, 2).toUpperCase() || '?';

// variant: 'tint' (default, coloured outline on a faint fill) or 'gradient'.
export const Avatar = ({ name, size = 32, showRing = false, variant = 'tint' }) => {
  const init = initials(name);
  const seed = [...init].reduce((a, ch) => a + ch.charCodeAt(0), 0);

  if (variant === 'gradient') {
    return (
      <div aria-hidden="true" style={{ width: size, height: size, borderRadius: '50%', background: GRADS[seed % GRADS.length],
        boxShadow: showRing ? '0 0 0 2px rgba(53,232,242,0.28), inset 0 1px 0 rgba(255,255,255,0.3)' : 'inset 0 1px 0 rgba(255,255,255,0.28)',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        fontSize: size * .38 + 'px', fontWeight: 800, color: 'var(--ink)',
        letterSpacing: '-.02em', flexShrink: 0 }}>
        {init}
      </div>
    );
  }

  const c = COLORS[seed % COLORS.length];
  return (
    <div aria-hidden="true" style={{ width: size, height: size, borderRadius: '50%', background: `${c}18`, border: `1.5px solid ${showRing ? c : c + '44'}`, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: size * .34 + 'px', fontWeight: 700, color: c, flexShrink: 0 }}>
      {init}
    </div>
  );
};
