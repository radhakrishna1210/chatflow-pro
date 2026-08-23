import { useState } from 'react';
import { I } from './Icons.jsx';

export const Btn = ({ children, variant = 'primary', size = 'md', onClick, style: ex = {}, disabled, type }) => {
  const [h, setH] = useState(false);
  const base = {
    display: 'inline-flex', alignItems: 'center', gap: '7px',
    fontFamily: "'Manrope',sans-serif", fontWeight: 600,
    cursor: disabled ? 'not-allowed' : 'pointer', border: 'none',
    transition: 'all .16s ease', whiteSpace: 'nowrap', opacity: disabled ? .55 : 1,
    ...(size === 'sm' ? { padding: '7px 14px', fontSize: '13px', borderRadius: '8px' } :
        size === 'lg' ? { padding: '14px 28px', fontSize: '15px', borderRadius: '11px', letterSpacing: '-.01em' } :
                        { padding: '10px 20px', fontSize: '14px', borderRadius: '9px' }),
    // The design set's primary call to action is a lime→cyan gradient on dark
    // ink — its most repeated single element. The hover was still '#22d468', a
    // leftover green from the previous theme, so every primary button flashed
    // green on hover after the palette moved to cyan.
    ...(variant === 'primary' ? {
      background: h ? 'var(--grad-cta-hot)' : 'var(--grad-cta)', color: 'var(--ink)',
      boxShadow: h ? '0 6px 24px rgba(53,232,242,0.32), inset 0 1px 0 rgba(255,255,255,0.28)'
                   : 'inset 0 1px 0 rgba(255,255,255,0.22)',
      transform: h && !disabled ? 'translateY(-1px)' : 'none',
    } : variant === 'ghost' ? {
      background: h ? 'rgba(255,255,255,0.07)' : 'rgba(255,255,255,0.04)',
      color: 'var(--t1)', border: '1px solid var(--bd)',
      boxShadow: 'inset 0 1px 0 rgba(255,255,255,0.05)',
    } : variant === 'outline' ? {
      background: h ? 'rgba(255,255,255,0.04)' : 'transparent',
      color: 'var(--t2)', border: '1px solid var(--bd)',
    } : {}),
    ...ex,
  };
  return (
    <button type={type} style={base} onClick={onClick} disabled={disabled}
      onMouseEnter={() => setH(true)} onMouseLeave={() => setH(false)}>
      {children}
    </button>
  );
};
