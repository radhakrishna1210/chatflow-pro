import { useState } from 'react';
import { I } from './Icons.jsx';

export const Btn = ({ children, variant = 'primary', size = 'md', onClick, style: ex = {}, disabled }) => {
  const [h, setH] = useState(false);
  const base = {
    display: 'inline-flex', alignItems: 'center', gap: '7px',
    fontFamily: "'Plus Jakarta Sans',sans-serif", fontWeight: 600,
    cursor: disabled ? 'not-allowed' : 'pointer', border: 'none',
    transition: 'all .16s ease', whiteSpace: 'nowrap', opacity: disabled ? .55 : 1,
    ...(size === 'sm' ? { padding: '7px 14px', fontSize: '13px', borderRadius: '8px' } :
        size === 'lg' ? { padding: '14px 28px', fontSize: '15px', borderRadius: '11px', letterSpacing: '-.01em' } :
                        { padding: '10px 20px', fontSize: '14px', borderRadius: '9px' }),
    ...(variant === 'primary' ? {
      background: h ? '#22d468' : 'var(--green)', color: '#060A10',
      boxShadow: h ? '0 0 32px rgba(30,191,94,0.35)' : 'inset 0 1px 0 rgba(255,255,255,0.2)',
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
    <button style={base} onClick={onClick} disabled={disabled}
      onMouseEnter={() => setH(true)} onMouseLeave={() => setH(false)}>
      {children}
    </button>
  );
};
