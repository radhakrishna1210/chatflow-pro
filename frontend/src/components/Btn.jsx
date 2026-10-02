import { useState } from 'react';

const SIZES = {
  xs: { padding: '5px 10px', fontSize: '12px', borderRadius: '7px', gap: '5px' },
  sm: { padding: '7px 14px', fontSize: '13px', borderRadius: '8px' },
  md: { padding: '10px 20px', fontSize: '14px', borderRadius: '9px' },
  lg: { padding: '14px 28px', fontSize: '15px', borderRadius: '11px', letterSpacing: '-.01em' },
};

// `sec` is what several CRM screens call the secondary button; it is the
// ghost style under another name.
const VARIANT_ALIASES = { sec: 'ghost', secondary: 'ghost' };

const variantStyle = (variant, h, disabled) => {
  switch (VARIANT_ALIASES[variant] || variant) {
    // The design set's primary call to action is a lime→cyan gradient on dark
    // ink — its most repeated single element.
    case 'primary': return {
      background: h ? 'var(--grad-cta-hot)' : 'var(--grad-cta)', color: 'var(--ink)',
      boxShadow: h ? '0 6px 24px rgba(53,232,242,0.32), inset 0 1px 0 rgba(255,255,255,0.28)'
                   : 'inset 0 1px 0 rgba(255,255,255,0.22)',
      transform: h && !disabled ? 'translateY(-1px)' : 'none',
    };
    case 'ghost': return {
      background: h ? 'rgba(255,255,255,0.07)' : 'rgba(255,255,255,0.04)',
      color: 'var(--t1)', border: '1px solid var(--bd)',
      boxShadow: 'inset 0 1px 0 rgba(255,255,255,0.05)',
    };
    case 'outline': return {
      background: h ? 'rgba(255,255,255,0.04)' : 'transparent',
      color: 'var(--t2)', border: '1px solid var(--bd)',
    };
    case 'danger': return {
      background: h ? 'rgba(239,68,68,0.24)' : 'rgba(239,68,68,0.14)',
      color: '#fca5a5', border: '1px solid rgba(239,68,68,0.45)',
    };
    default: return {};
  }
};

// Anything not consumed here (title, aria-*, id, className, form, autoFocus…)
// is forwarded to the <button>. `type` defaults to "button" so a Btn placed
// inside a <form> never submits it by accident; submit buttons say so.
// A bare `outline` prop is shorthand for variant="outline".
export const Btn = ({ children, variant: v = 'primary', outline = false, size = 'md', style: ex = {}, disabled, type = 'button', onMouseEnter, onMouseLeave, ...rest }) => {
  const variant = outline ? 'outline' : v;
  const [h, setH] = useState(false);
  const base = {
    display: 'inline-flex', alignItems: 'center', gap: '7px',
    fontFamily: "'Manrope',sans-serif", fontWeight: 600,
    cursor: disabled ? 'not-allowed' : 'pointer', border: 'none',
    transition: 'all .16s ease', whiteSpace: 'nowrap', opacity: disabled ? .55 : 1,
    ...(SIZES[size] || SIZES.md),
    ...variantStyle(variant, h, disabled),
    ...ex,
  };
  return (
    <button {...rest} type={type} style={base} disabled={disabled}
      onMouseEnter={(e) => { setH(true); onMouseEnter?.(e); }}
      onMouseLeave={(e) => { setH(false); onMouseLeave?.(e); }}>
      {children}
    </button>
  );
};
