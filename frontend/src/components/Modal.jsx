import { useEffect, useId, useRef } from 'react';
import { I } from './Icons.jsx';
import { useFocusTrap } from '../lib/useFocusTrap.js';

const card = { background: 'var(--surf)', border: '1px solid var(--bd)', borderRadius: 'var(--rl)', boxShadow: 'var(--card-shadow)' };

// Open modals, innermost last, so Escape closes only the one on top when a
// confirm dialog is stacked over an edit form.
const openStack = [];

export const Modal = ({ title, onClose, children, footer, width = 540, zIndex = 100 }) => {
  const ref = useRef(null);
  const titleId = useId();
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;

  useFocusTrap(ref, true);

  useEffect(() => {
    const token = {};
    openStack.push(token);
    const returnTo = document.activeElement;
    const onKey = (e) => {
      if (e.key !== 'Escape' || openStack[openStack.length - 1] !== token) return;
      e.stopPropagation();
      onCloseRef.current?.();
    };
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('keydown', onKey);
      openStack.splice(openStack.indexOf(token), 1);
      // Hand focus back to whatever opened the dialog, if it is still there.
      if (returnTo && typeof returnTo.focus === 'function' && document.contains(returnTo)) returnTo.focus();
    };
  }, []);

  return (
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.6)', zIndex, display: 'flex', alignItems: 'center', justifyContent: 'center', backdropFilter: 'blur(4px)' }}>
      <div ref={ref} role="dialog" aria-modal="true" aria-labelledby={title ? titleId : undefined}
        style={{ ...card, width, maxWidth: 'calc(100vw - 32px)', maxHeight: '85vh', display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
        <div style={{ padding: '18px 24px', borderBottom: '1px solid var(--bd)', display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexShrink: 0 }}>
          <h2 id={titleId} style={{ margin: 0, fontFamily: "'Syne',sans-serif", fontWeight: 700, fontSize: 16, color: 'var(--t1)', letterSpacing: 'normal', lineHeight: 'normal' }}>{title}</h2>
          <button type="button" onClick={onClose} aria-label="Close" style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--t2)', display: 'flex' }}>
            <I n="x" s={18} c="var(--t2)" />
          </button>
        </div>
        <div style={{ flex: 1, overflowY: 'auto', padding: '20px 24px' }}>{children}</div>
        {footer && <div style={{ padding: '14px 24px', borderTop: '1px solid var(--bd)', display: 'flex', justifyContent: 'flex-end', gap: 8, flexShrink: 0 }}>{footer}</div>}
      </div>
    </div>
  );
};
