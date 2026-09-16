import { I } from './Icons.jsx';

const card = { background: 'var(--surf)', border: '1px solid var(--bd)', borderRadius: 'var(--rl)', boxShadow: 'var(--card-shadow)' };

export const Modal = ({ title, onClose, children, footer, width = 540 }) => (
  <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.6)', zIndex: 100, display: 'flex', alignItems: 'center', justifyContent: 'center', backdropFilter: 'blur(4px)' }}>
    <div style={{ ...card, width, maxWidth: 'calc(100vw - 32px)', maxHeight: '85vh', display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
      <div style={{ padding: '18px 24px', borderBottom: '1px solid var(--bd)', display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexShrink: 0 }}>
        <span style={{ fontFamily: "'Syne',sans-serif", fontWeight: 700, fontSize: 16, color: 'var(--t1)' }}>{title}</span>
        <button onClick={onClose} aria-label="Close" style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--t2)', display: 'flex' }}>
          <I n="x" s={18} c="var(--t2)" />
        </button>
      </div>
      <div style={{ flex: 1, overflowY: 'auto', padding: '20px 24px' }}>{children}</div>
      {footer && <div style={{ padding: '14px 24px', borderTop: '1px solid var(--bd)', display: 'flex', justifyContent: 'flex-end', gap: 8, flexShrink: 0 }}>{footer}</div>}
    </div>
  </div>
);
