import { useEffect, useState } from 'react';
import { Modal } from './Modal.jsx';
import { Btn } from './Btn.jsx';

// App-wide replacements for window.alert / window.confirm: a toast stack and a
// styled confirm dialog, both rendered by <FeedbackHost /> (mounted once in
// App). They are plain functions rather than hooks so any handler can call
// them, the same way it used to call the native dialogs:
//
//   notify('Saved.', 'success');
//   if (!(await confirmDialog('Delete this flow?', { danger: true }))) return;

const listeners = new Set();
const emit = (event) => listeners.forEach((l) => l(event));
let seq = 0;

// tone: 'error' (default) | 'success' | 'info'
export function notify(message, tone = 'error') {
  emit({ type: 'toast', toast: { id: ++seq, message: String(message ?? ''), tone } });
}

// Resolves true when confirmed, false when cancelled or dismissed.
export function confirmDialog(message, { title = 'Are you sure?', confirmLabel = 'Confirm', cancelLabel = 'Cancel', danger = false } = {}) {
  if (listeners.size === 0) return Promise.resolve(false);
  return new Promise((resolve) => {
    emit({ type: 'confirm', confirm: { id: ++seq, message, title, confirmLabel, cancelLabel, danger, resolve } });
  });
}

// Resolves the trimmed text when confirmed, null when cancelled or dismissed.
export function promptDialog(message, { title = 'Are you sure?', label = '', placeholder = '', minLength = 0, confirmLabel = 'Confirm', cancelLabel = 'Cancel', danger = false } = {}) {
  if (listeners.size === 0) return Promise.resolve(null);
  return new Promise((resolve) => {
    emit({
      type: 'confirm',
      confirm: { id: ++seq, message, title, confirmLabel, cancelLabel, danger, input: { label, placeholder, minLength }, resolve },
    });
  });
}

const TONES = {
  error:   { bd: 'rgba(239,68,68,0.45)',  fg: '#fca5a5' },
  success: { bd: 'var(--gbd)',            fg: 'var(--green)' },
  info:    { bd: 'var(--bd)',             fg: 'var(--t1)' },
};

export function FeedbackHost() {
  const [toasts, setToasts] = useState([]);
  const [confirms, setConfirms] = useState([]);

  useEffect(() => {
    const onEvent = (e) => {
      if (e.type === 'toast') {
        setToasts((t) => [...t.slice(-3), e.toast]);
        setTimeout(() => setToasts((t) => t.filter((x) => x.id !== e.toast.id)), e.toast.tone === 'error' ? 7000 : 4500);
      } else if (e.type === 'confirm') {
        setConfirms((c) => [...c, e.confirm]);
      }
    };
    listeners.add(onEvent);
    return () => listeners.delete(onEvent);
  }, []);

  const [text, setText] = useState('');
  const settle = (item, ok) => {
    item.resolve(item.input ? (ok ? text.trim() : null) : ok);
    setText('');
    setConfirms((c) => c.filter((x) => x.id !== item.id));
  };
  const active = confirms[0];
  const inputShort = active?.input && text.trim().length < active.input.minLength;

  return (
    <>
      <div aria-live="polite" role="status" style={{ position: 'fixed', top: 16, left: '50%', transform: 'translateX(-50%)', zIndex: 1100, display: 'flex', flexDirection: 'column', gap: 8, width: 'min(420px, calc(100vw - 32px))', pointerEvents: 'none' }}>
        {toasts.map((t) => {
          const tone = TONES[t.tone] || TONES.info;
          return (
            <div key={t.id} style={{ pointerEvents: 'auto', padding: '11px 14px', borderRadius: 10, background: 'var(--surf-solid, #0b1220)', border: `1px solid ${tone.bd}`, color: tone.fg, fontSize: 13, lineHeight: 1.45, boxShadow: '0 12px 32px rgba(0,0,0,0.45)', display: 'flex', alignItems: 'flex-start', gap: 10 }}>
              <span style={{ flex: 1 }}>{t.message}</span>
              <button type="button" aria-label="Dismiss" onClick={() => setToasts((all) => all.filter((x) => x.id !== t.id))}
                style={{ background: 'none', border: 'none', color: 'var(--t3)', cursor: 'pointer', fontSize: 15, lineHeight: 1, padding: 0 }}>×</button>
            </div>
          );
        })}
      </div>
      {active && (
        <Modal key={active.id} title={active.title} width={420} zIndex={1050} onClose={() => settle(active, false)}
          footer={<>
            <Btn variant="ghost" size="sm" onClick={() => settle(active, false)}>{active.cancelLabel}</Btn>
            <Btn variant={active.danger ? 'danger' : 'primary'} size="sm" autoFocus={!active.input} disabled={inputShort} onClick={() => settle(active, true)}>{active.confirmLabel}</Btn>
          </>}>
          <p style={{ fontSize: 13.5, color: 'var(--t2)', lineHeight: 1.55, whiteSpace: 'pre-line' }}>{active.message}</p>
          {active.input && (
            <label style={{ display: 'block', marginTop: 12, fontSize: 12.5, color: 'var(--t2)' }}>
              {active.input.label}
              <input autoFocus value={text} placeholder={active.input.placeholder} onChange={(e) => setText(e.target.value)}
                onKeyDown={(e) => { if (e.key === 'Enter' && !inputShort) settle(active, true); }}
                style={{ display: 'block', width: '100%', marginTop: 6, padding: '8px 10px', borderRadius: 8, border: '1px solid var(--bd)', background: 'var(--surf)', color: 'var(--t1)', fontSize: 13.5 }} />
            </label>
          )}
        </Modal>
      )}
    </>
  );
}
