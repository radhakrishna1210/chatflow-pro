import { useEffect, useId, useRef } from 'react';
import { I } from './Icons.jsx';

const card = { background: 'var(--surf)', border: '1px solid var(--bd)', borderRadius: 'var(--rl)', boxShadow: 'var(--card-shadow)' };

const FOCUSABLE = 'button:not([disabled]),input:not([disabled]),select:not([disabled]),textarea:not([disabled]),a[href],[tabindex]:not([tabindex="-1"])';

// The shared dialog. It used to be a bare overlay: no dialog role, Escape did
// nothing, focus stayed on the button behind it (so Tab walked straight back
// out into the page underneath) and closing dropped focus on <body>. It now
// behaves like a dialog — Escape closes, Tab cycles inside it, the first field
// is focused on open, and focus returns to whatever opened it.
export const Modal = ({ title, onClose, children, footer, width = 540 }) => {
  const ref = useRef(null);
  const titleId = useId();
  // Read through a ref so a parent that passes a fresh arrow every render does
  // not re-run the mount effect (and re-steal focus) on each keystroke.
  const closeRef = useRef(onClose);
  closeRef.current = onClose;

  useEffect(() => {
    const opener = document.activeElement;
    const node = ref.current;
    // Prefer the first form field over the header's close button.
    requestAnimationFrame(() => {
      if (!node || node.contains(document.activeElement)) return;
      const field = node.querySelector('input:not([disabled]):not([type="hidden"]),select:not([disabled]),textarea:not([disabled])');
      (field || node.querySelector(FOCUSABLE) || node).focus();
    });
    return () => {
      if (opener && typeof opener.focus === 'function' && document.contains(opener)) opener.focus();
    };
  }, []);

  const onKeyDown = (e) => {
    if (e.key === 'Escape') {
      // Stop here so a modal opened from inside another one closes alone.
      e.stopPropagation();
      closeRef.current?.();
      return;
    }
    if (e.key !== 'Tab' || !ref.current) return;
    const els = ref.current.querySelectorAll(FOCUSABLE);
    if (els.length === 0) { e.preventDefault(); return; }
    const first = els[0];
    const last = els[els.length - 1];
    if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
    else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
  };

  return (
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.6)', zIndex: 100, display: 'flex', alignItems: 'center', justifyContent: 'center', backdropFilter: 'blur(4px)' }}>
      <div ref={ref} role="dialog" aria-modal="true" aria-labelledby={titleId} tabIndex={-1} onKeyDown={onKeyDown}
        style={{ ...card, width, maxWidth: 'calc(100vw - 32px)', maxHeight: '85vh', display: 'flex', flexDirection: 'column', overflow: 'hidden', outline: 'none' }}>
        <div style={{ padding: '18px 24px', borderBottom: '1px solid var(--bd)', display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexShrink: 0, gap: 12 }}>
          <span id={titleId} style={{ fontFamily: "'Syne',sans-serif", fontWeight: 700, fontSize: 16, color: 'var(--t1)', minWidth: 0 }}>{title}</span>
          <button type="button" onClick={onClose} aria-label="Close" style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--t2)', display: 'flex', flexShrink: 0 }}>
            <I n="x" s={18} c="var(--t2)" />
          </button>
        </div>
        <div style={{ flex: 1, overflowY: 'auto', padding: '20px 24px' }}>{children}</div>
        {footer && <div style={{ padding: '14px 24px', borderTop: '1px solid var(--bd)', display: 'flex', justifyContent: 'flex-end', gap: 8, flexShrink: 0, flexWrap: 'wrap' }}>{footer}</div>}
      </div>
    </div>
  );
};
