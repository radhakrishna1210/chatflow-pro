import { useState, useRef, useEffect } from 'react';
import { I } from './Icons.jsx';
import { Btn } from './Btn.jsx';
import { wFetch } from '../lib/api.js';

// CRM copilot — a slide-over chat over the workspace's own data.
//
// Two things this deliberately does NOT do:
//
//  1. It never applies a change on its own. The server can only ever return a
//     *proposal*; the button below is what performs it. So the worst outcome of
//     a confused or manipulated model is a suggestion someone declines.
//  2. It does not hide what it read. The tools used are listed under each
//     answer, because an assistant over your own pipeline is only trustworthy
//     if you can see where its numbers came from.

const card = { background: 'var(--surf)', border: '1px solid var(--bd)', borderRadius: 'var(--rl)' };

const SUGGESTIONS = [
  'Which deals are at risk?',
  'What should I do first today?',
  'How does the forecast look?',
  'Any tickets about to breach?',
];

const Bubble = ({ role, children }) => (
  <div style={{
    alignSelf: role === 'user' ? 'flex-end' : 'flex-start',
    maxWidth: '86%',
    padding: '10px 13px',
    borderRadius: 11,
    background: role === 'user' ? 'var(--gbg)' : 'rgba(255,255,255,.03)',
    border: `1px solid ${role === 'user' ? 'var(--gbd)' : 'var(--bd)'}`,
    fontSize: 13,
    color: 'var(--t1)',
    lineHeight: 1.6,
    whiteSpace: 'pre-wrap',
  }}>
    {children}
  </div>
);

const Steps = ({ steps }) => {
  if (!steps?.length) return null;
  return (
    <div style={{ alignSelf: 'flex-start', display: 'flex', gap: 5, flexWrap: 'wrap', paddingLeft: 2 }}>
      {steps.map((s, i) => (
        <span key={`${s.tool}-${i}`} title={s.ok ? 'Read successfully' : s.error}
          style={{
            fontSize: 10.5, fontFamily: 'var(--mono)',
            color: s.ok ? 'var(--t3)' : '#f87171',
            border: '1px solid var(--bd)', borderRadius: 4, padding: '1px 6px',
          }}>
          {s.tool}
        </span>
      ))}
    </div>
  );
};

const Proposal = ({ proposal, onConfirm, onDismiss, busy, done, error }) => (
  <div style={{ alignSelf: 'flex-start', ...card, padding: '12px 14px', maxWidth: '86%', borderColor: 'rgba(245,158,11,.3)', background: 'rgba(245,158,11,.06)' }}>
    <div style={{ display: 'flex', gap: 8, alignItems: 'flex-start', marginBottom: 10 }}>
      <span style={{ flexShrink: 0, marginTop: 1 }}><I n="alertt" s={13} c="#fbbf24" /></span>
      <div>
        <div style={{ fontSize: 12.5, color: 'var(--t1)', fontWeight: 600 }}>{proposal.summary}</div>
        <div style={{ fontSize: 11.5, color: 'var(--t3)', marginTop: 3 }}>
          Nothing has changed yet. This runs only if you confirm it.
        </div>
      </div>
    </div>

    {error && <div style={{ fontSize: 11.5, color: '#f87171', marginBottom: 8 }}>{error}</div>}

    {done ? (
      <div style={{ fontSize: 12, color: 'var(--green)', display: 'flex', alignItems: 'center', gap: 6 }}>
        <I n="check" s={12} c="var(--green)" /> Done.
      </div>
    ) : (
      <div style={{ display: 'flex', gap: 7 }}>
        <Btn size="sm" onClick={onConfirm} disabled={busy}>{busy ? 'Applying…' : 'Confirm'}</Btn>
        <Btn size="sm" variant="ghost" onClick={onDismiss} disabled={busy}>No thanks</Btn>
      </div>
    )}
  </div>
);

export default function Copilot({ onClose }) {
  const [turns, setTurns] = useState([]);
  const [input, setInput] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const scroller = useRef(null);

  useEffect(() => {
    if (scroller.current) scroller.current.scrollTop = scroller.current.scrollHeight;
  }, [turns, busy]);

  const send = async (text) => {
    const question = (text ?? input).trim();
    if (!question || busy) return;
    setInput('');
    setError(null);
    setBusy(true);

    const history = turns
      .filter((t) => t.role === 'user' || t.role === 'assistant')
      .map((t) => ({ role: t.role, content: String(t.content).slice(0, 4000) }));

    setTurns((prev) => [...prev, { role: 'user', content: question }]);

    try {
      const res = await wFetch('/copilot/ask', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message: question, history }),
      });
      if (!res.ok) {
        const b = await res.json().catch(() => ({}));
        throw new Error(b.error || b.message || `The assistant could not answer (${res.status}).`);
      }
      const body = await res.json();
      setTurns((prev) => [...prev, {
        role: 'assistant',
        content: body.answer,
        steps: body.steps,
        proposal: body.proposal,
        degraded: body.degraded,
      }]);
    } catch (e) {
      setError(e.message);
    }
    setBusy(false);
  };

  const confirm = async (index) => {
    const turn = turns[index];
    setTurns((prev) => prev.map((t, i) => (i === index ? { ...t, confirming: true, confirmError: null } : t)));
    try {
      const res = await wFetch('/copilot/confirm', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ tool: turn.proposal.tool, args: turn.proposal.args }),
      });
      if (!res.ok) {
        const b = await res.json().catch(() => ({}));
        throw new Error(b.error || b.message || `Could not apply that (${res.status}).`);
      }
      setTurns((prev) => prev.map((t, i) => (i === index ? { ...t, confirming: false, confirmed: true } : t)));
    } catch (e) {
      setTurns((prev) => prev.map((t, i) => (i === index ? { ...t, confirming: false, confirmError: e.message } : t)));
    }
  };

  return (
    <div style={{ position: 'fixed', inset: 0, zIndex: 120, display: 'flex', justifyContent: 'flex-end' }}>
      <div onClick={onClose} style={{ position: 'absolute', inset: 0, background: 'rgba(0,0,0,.5)', backdropFilter: 'blur(3px)' }} />

      <aside className="m-rise" style={{
        position: 'relative', width: 460, maxWidth: '100vw', height: '100%',
        background: 'var(--bg)', borderLeft: '1px solid var(--bd)',
        display: 'flex', flexDirection: 'column',
      }}>
        <header style={{ padding: '15px 18px', borderBottom: '1px solid var(--bd)', display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexShrink: 0 }}>
          <div>
            <div style={{ fontFamily: "'Syne',sans-serif", fontWeight: 700, fontSize: 15, color: 'var(--t1)' }}>Ask your CRM</div>
            <div style={{ fontSize: 11.5, color: 'var(--t3)' }}>Reads your pipeline. Changes need your confirmation.</div>
          </div>
          <button onClick={onClose} aria-label="Close" style={{ background: 'none', border: 'none', cursor: 'pointer', display: 'flex' }}>
            <I n="x" s={18} c="var(--t2)" />
          </button>
        </header>

        <div ref={scroller} style={{ flex: 1, overflowY: 'auto', padding: '16px 18px', display: 'flex', flexDirection: 'column', gap: 10 }}>
          {turns.length === 0 && (
            <div style={{ marginTop: 8 }}>
              <p style={{ fontSize: 13, color: 'var(--t2)', lineHeight: 1.6, marginBottom: 14 }}>
                I can look at your deals, leads, tasks, tickets and forecast, and tell you what I find.
                I can also suggest changes — but you decide whether they happen.
              </p>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                {SUGGESTIONS.map((s) => (
                  <button key={s} onClick={() => send(s)}
                    style={{ ...card, padding: '9px 12px', textAlign: 'left', cursor: 'pointer', fontFamily: 'inherit', fontSize: 12.5, color: 'var(--t2)' }}>
                    {s}
                  </button>
                ))}
              </div>
            </div>
          )}

          {turns.map((t, i) => (
            <div key={i} style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              <Bubble role={t.role}>{t.content}</Bubble>
              {t.role === 'assistant' && <Steps steps={t.steps} />}
              {t.degraded && (
                <span style={{ alignSelf: 'flex-start', fontSize: 11, color: 'var(--t3)' }}>
                  Answered without the assistant provider.
                </span>
              )}
              {t.proposal && (
                <Proposal
                  proposal={t.proposal}
                  busy={t.confirming}
                  done={t.confirmed}
                  error={t.confirmError}
                  onConfirm={() => confirm(i)}
                  onDismiss={() => setTurns((prev) => prev.map((x, j) => (j === i ? { ...x, proposal: null } : x)))}
                />
              )}
            </div>
          ))}

          {busy && <Bubble role="assistant"><span style={{ color: 'var(--t3)' }}>Looking…</span></Bubble>}
          {error && <div style={{ fontSize: 12.5, color: '#f87171' }}>{error}</div>}
        </div>

        <form
          onSubmit={(e) => { e.preventDefault(); send(); }}
          style={{ padding: '13px 16px', borderTop: '1px solid var(--bd)', display: 'flex', gap: 8, flexShrink: 0 }}
        >
          <input
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder="Ask about your pipeline…"
            disabled={busy}
            style={{
              flex: 1, padding: '10px 12px', borderRadius: 9, border: '1px solid var(--bd)',
              background: 'rgba(255,255,255,.03)', color: 'var(--t1)', fontSize: 13, fontFamily: 'inherit', outline: 'none',
            }}
          />
          <Btn size="sm" type="submit" disabled={busy || !input.trim()}>Send</Btn>
        </form>
      </aside>
    </div>
  );
}
