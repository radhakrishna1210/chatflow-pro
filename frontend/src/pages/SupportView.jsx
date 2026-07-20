import { useState, useEffect } from 'react';
import { I } from '../components/Icons.jsx';
import { Btn } from '../components/Btn.jsx';
import { wFetch } from '../lib/api.js';

const card = { background: 'var(--surf)', border: '1px solid var(--bd)', borderRadius: 14 };

// Client-facing "Contact Us" / support surface. Submits real SupportTickets that
// the super admin sees in the Platform Admin → Support queue.
export default function SupportView() {
  const [subject, setSubject] = useState('');
  const [category, setCategory] = useState('GENERAL');
  const [message, setMessage] = useState('');
  const [status, setStatus] = useState('idle');
  const [err, setErr] = useState(null);
  const [tickets, setTickets] = useState([]);

  const load = () => wFetch('/support').then(r => r.ok ? r.json() : []).then(d => setTickets(Array.isArray(d) ? d : [])).catch(() => {});
  useEffect(() => { load(); }, []);

  const submit = async (e) => {
    e.preventDefault();
    if (!subject.trim() || !message.trim()) { setErr('Subject and message are required.'); return; }
    setErr(null); setStatus('loading');
    try {
      const res = await wFetch('/support', { method: 'POST', body: JSON.stringify({ subject, category, message }) });
      const data = await res.json();
      if (!res.ok) { setErr(data.error || 'Could not submit'); setStatus('idle'); return; }
      setSubject(''); setMessage(''); setCategory('GENERAL');
      setStatus('success'); setTimeout(() => setStatus('idle'), 2500);
      load();
    } catch (e) { setErr(e.message); setStatus('idle'); }
  };

  const inputStyle = { padding: '11px 14px', borderRadius: 8, background: 'rgba(255,255,255,0.03)', border: '1px solid var(--bd)', color: 'var(--t1)', fontSize: 13, outline: 'none', fontFamily: "'Plus Jakarta Sans',sans-serif" };

  return (
    <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
      <div style={{ height: 58, borderBottom: '1px solid var(--bd)', display: 'flex', alignItems: 'center', padding: '0 28px', flexShrink: 0, background: 'var(--surf)' }}>
        <h1 style={{ fontFamily: "'Syne',sans-serif", fontWeight: 800, fontSize: 16, color: 'var(--t1)' }}>Help &amp; Support</h1>
        <p style={{ fontSize: 11.5, color: 'var(--t2)', marginLeft: 10 }}>Report an issue or contact our team</p>
      </div>

      <div style={{ flex: 1, overflowY: 'auto', padding: '24px 28px', maxWidth: 720, margin: '0 auto', width: '100%', boxSizing: 'border-box' }}>
        <div style={{ ...card, padding: 24, marginBottom: 20 }}>
          <h3 style={{ fontFamily: "'Syne',sans-serif", fontSize: 15, fontWeight: 700, color: 'var(--t1)', marginBottom: 16 }}>Submit a request</h3>
          {err && <div style={{ padding: '10px 13px', borderRadius: 8, background: 'rgba(239,68,68,.08)', border: '1px solid rgba(239,68,68,.25)', color: '#f87171', fontSize: 13, marginBottom: 14 }}>{err}</div>}
          {status === 'success' && <div style={{ padding: '10px 13px', borderRadius: 8, background: 'var(--gbg)', border: '1px solid var(--gbd)', color: 'var(--green)', fontSize: 13, marginBottom: 14, display: 'flex', alignItems: 'center', gap: 8 }}><I n="check" s={14} c="var(--green)" w={2} /> Ticket submitted — we'll get back to you by email.</div>}
          <form onSubmit={submit} style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
            <div style={{ display: 'grid', gridTemplateColumns: '2fr 1fr', gap: 12 }}>
              <input value={subject} onChange={e => setSubject(e.target.value)} placeholder="Subject" style={inputStyle} maxLength={200} />
              <select value={category} onChange={e => setCategory(e.target.value)} style={{ ...inputStyle, colorScheme: 'dark' }}>
                <option value="GENERAL" style={{ background: '#07090F' }}>General</option>
                <option value="BILLING" style={{ background: '#07090F' }}>Billing</option>
                <option value="TECHNICAL" style={{ background: '#07090F' }}>Technical</option>
                <option value="BUG" style={{ background: '#07090F' }}>Bug report</option>
                <option value="FEATURE" style={{ background: '#07090F' }}>Feature request</option>
              </select>
            </div>
            <textarea value={message} onChange={e => setMessage(e.target.value)} placeholder="Describe your issue…" rows={5} maxLength={4000}
              style={{ ...inputStyle, resize: 'vertical' }} />
            <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
              <Btn type="submit" disabled={status === 'loading'}>{status === 'loading' ? 'Submitting…' : 'Submit request'}</Btn>
            </div>
          </form>
        </div>

        <h3 style={{ fontFamily: "'Syne',sans-serif", fontSize: 14, fontWeight: 700, color: 'var(--t1)', marginBottom: 12 }}>Your requests</h3>
        {tickets.length === 0 ? (
          <div style={{ ...card, padding: 28, textAlign: 'center', color: 'var(--t3)', fontSize: 13 }}>No requests yet.</div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            {tickets.map((t) => (
              <div key={t.id} style={{ ...card, padding: '14px 18px', display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 12 }}>
                <div style={{ minWidth: 0 }}>
                  <p style={{ fontSize: 13.5, fontWeight: 600, color: 'var(--t1)', marginBottom: 3 }}>{t.subject}</p>
                  <p style={{ fontSize: 12, color: 'var(--t2)', lineHeight: 1.5, marginBottom: 4 }}>{t.message}</p>
                  <p style={{ fontSize: 11, color: 'var(--t3)' }}>{new Date(t.createdAt).toLocaleString('en-IN')}</p>
                </div>
                <span style={{ padding: '3px 9px', borderRadius: 20, fontSize: 11, fontWeight: 600, flexShrink: 0,
                  background: t.status === 'OPEN' ? 'rgba(251,191,36,.1)' : t.status === 'RESOLVED' || t.status === 'CLOSED' ? 'var(--gbg)' : 'rgba(56,189,248,.1)',
                  color: t.status === 'OPEN' ? '#fbbf24' : t.status === 'RESOLVED' || t.status === 'CLOSED' ? 'var(--green)' : '#38bdf8' }}>
                  {t.status}
                </span>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
