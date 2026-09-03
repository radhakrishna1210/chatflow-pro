import { useState, useEffect, useCallback } from 'react';
import { I } from '../components/Icons.jsx';
import { Btn } from '../components/Btn.jsx';
import { Modal } from '../components/Modal.jsx';
import { StatusBadge } from '../components/StatusBadge.jsx';
import { FInput, FLabel, FSelect, FTextarea } from '../components/Form.jsx';
import { wFetch } from '../lib/api.js';
import { fmtMoney, fmtDate, pretty } from '../lib/format.js';

const card = { background: 'var(--surf)', border: '1px solid var(--bd)', borderRadius: 'var(--rl)', boxShadow: 'var(--card-shadow)' };

const STATUS_TONE = { DRAFT: 'gray', SENT: 'blue', ACCEPTED: 'green', REJECTED: 'red', EXPIRED: 'amber' };

// Mirrors ALLOWED_TRANSITIONS in quotes.service.js. The server is the
// authority; this only decides which buttons are worth showing.
const NEXT_STATUS = {
  DRAFT: ['SENT'],
  SENT: ['ACCEPTED', 'REJECTED', 'EXPIRED'],
  ACCEPTED: [],
  REJECTED: [],
  EXPIRED: ['SENT'],
};

const ErrorBanner = ({ children, onDismiss }) => (
  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10, padding: '9px 14px', borderRadius: 8, background: 'rgba(239,68,68,.08)', border: '1px solid rgba(239,68,68,.22)', color: '#f87171', fontSize: 12.5 }}>
    <span>{children}</span>
    {onDismiss && <button onClick={onDismiss} aria-label="Dismiss" style={{ background: 'none', border: 'none', cursor: 'pointer', display: 'flex' }}><I n="x" s={14} c="#f87171" /></button>}
  </div>
);

const ColHead = ({ children, align = 'left' }) => (
  <th style={{ padding: '10px 16px', textAlign: align, fontSize: 11, fontWeight: 700, color: 'var(--t2)', textTransform: 'uppercase', letterSpacing: '.08em', whiteSpace: 'nowrap' }}>{children}</th>
);

const QuoteDetailModal = ({ quoteId, products, onClose, onChanged }) => {
  const [quote, setQuote] = useState(null);
  const [productId, setProductId] = useState('');
  const [qty, setQty] = useState('1');
  const [discount, setDiscount] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState(null);

  const load = useCallback(() => {
    wFetch(`/quotes/${quoteId}`)
      .then(r => (r.ok ? r.json() : Promise.reject(new Error('Could not load this quote'))))
      .then(q => { setQuote(q); setDiscount(String(Number(q.discountPct) || '')); })
      .catch(e => setErr(e.message));
  }, [quoteId]);

  useEffect(() => { load(); }, [load]);

  const act = async (fn) => {
    setBusy(true);
    setErr(null);
    try {
      const res = await fn();
      if (!res.ok) {
        const d = await res.json().catch(() => ({}));
        throw new Error(d.error || 'That change was refused');
      }
      load();
      onChanged();
    } catch (e) {
      setErr(e.message);
    } finally {
      setBusy(false);
    }
  };

  const editable = quote?.status === 'DRAFT';

  const applyDiscount = () => act(() => wFetch(`/quotes/${quote.id}`, {
    method: 'PATCH', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ discountPct: Number(discount || 0) }),
  }));

  return (
    <Modal title={quote ? `Quote ${quote.quoteNumber}` : 'Quote'} onClose={onClose} width={640}
      footer={<Btn variant="ghost" size="sm" onClick={onClose}>Close</Btn>}>
      {err && <div style={{ marginBottom: 12 }}><ErrorBanner onDismiss={() => setErr(null)}>{err}</ErrorBanner></div>}
      {!quote ? <div style={{ fontSize: 12.5, color: 'var(--t3)' }}>Loading…</div> : (
        <>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 14, flexWrap: 'wrap' }}>
            <StatusBadge label={pretty(quote.status)} tone={STATUS_TONE[quote.status]} />
            <span style={{ fontSize: 12.5, color: 'var(--t3)' }}>
              {quote.contact?.name || 'No contact'}{quote.deal ? ` · ${quote.deal.title}` : ''}
            </span>
            <div style={{ marginLeft: 'auto', display: 'flex', gap: 6 }}>
              {(NEXT_STATUS[quote.status] || []).map(s => (
                <Btn key={s} size="sm" variant={s === 'ACCEPTED' ? 'primary' : 'outline'} disabled={busy}
                  onClick={() => act(() => wFetch(`/quotes/${quote.id}/status`, {
                    method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ status: s }),
                  }))}>
                  {s === 'SENT' ? 'Mark sent' : pretty(s)}
                </Btn>
              ))}
            </div>
          </div>

          {!editable && (
            <div style={{ ...card, padding: '9px 13px', marginBottom: 14, fontSize: 11.5, color: 'var(--t3)', display: 'flex', gap: 8, alignItems: 'center' }}>
              <I n="lock" s={13} c="var(--t3)" />
              This quote has left draft, so its contents are locked.
            </div>
          )}

          <table style={{ width: '100%', borderCollapse: 'collapse', marginBottom: 14 }}>
            <thead><tr style={{ borderBottom: '1px solid var(--bd)' }}>
              <ColHead>Item</ColHead><ColHead align="right">Qty</ColHead><ColHead align="right">Price</ColHead>
              <ColHead align="right">Tax</ColHead><ColHead align="right">Total</ColHead>{editable && <ColHead />}
            </tr></thead>
            <tbody>
              {quote.lineItems.map(l => (
                <tr key={l.id} style={{ borderBottom: '1px solid var(--bd)' }}>
                  <td style={{ padding: '9px 16px', fontSize: 12.5, color: 'var(--t1)' }}>{l.name}</td>
                  <td style={{ padding: '9px 16px', fontSize: 12, color: 'var(--t3)', textAlign: 'right' }}>{Number(l.quantity)}</td>
                  <td style={{ padding: '9px 16px', fontSize: 12, color: 'var(--t3)', textAlign: 'right' }}>{fmtMoney(l.unitPrice)}</td>
                  <td style={{ padding: '9px 16px', fontSize: 12, color: 'var(--t3)', textAlign: 'right' }}>{fmtMoney(l.taxAmount)}</td>
                  <td style={{ padding: '9px 16px', fontSize: 12.5, color: 'var(--t1)', textAlign: 'right', fontWeight: 600 }}>{fmtMoney(l.total)}</td>
                  {editable && (
                    <td style={{ padding: '9px 10px', textAlign: 'right' }}>
                      <button aria-label={`Remove ${l.name}`} disabled={busy}
                        onClick={() => act(() => wFetch(`/quotes/${quote.id}/line-items/${l.id}`, { method: 'DELETE' }))}
                        style={{ background: 'none', border: 'none', cursor: 'pointer', padding: 4 }}>
                        <I n="x" s={13} c="#f87171" />
                      </button>
                    </td>
                  )}
                </tr>
              ))}
              {quote.lineItems.length === 0 && (
                <tr><td colSpan={editable ? 6 : 5} style={{ padding: '20px 16px', textAlign: 'center', fontSize: 12.5, color: 'var(--t3)' }}>
                  No line items yet.
                </td></tr>
              )}
            </tbody>
          </table>

          {editable && (
            <div style={{ display: 'flex', gap: 8, alignItems: 'flex-end', marginBottom: 16, flexWrap: 'wrap' }}>
              <div style={{ flex: 2, minWidth: 170 }}>
                <FLabel>Add product</FLabel>
                <FSelect value={productId} onChange={e => setProductId(e.target.value)} placeholder="Choose a product"
                  options={products.map(p => ({ value: p.id, label: `${p.name} — ${fmtMoney(p.unitPrice)}` }))} />
              </div>
              <div style={{ width: 84 }}><FLabel>Qty</FLabel><FInput type="number" value={qty} onChange={e => setQty(e.target.value)} /></div>
              <Btn size="sm" disabled={busy || !productId}
                onClick={() => act(() => wFetch(`/quotes/${quote.id}/line-items`, {
                  method: 'POST', headers: { 'Content-Type': 'application/json' },
                  body: JSON.stringify({ productId, quantity: Number(qty || 1) }),
                })).then(() => { setProductId(''); setQty('1'); })}>
                Add
              </Btn>
              <div style={{ width: 110 }}>
                <FLabel>Discount %</FLabel>
                <FInput type="number" value={discount} onChange={e => setDiscount(e.target.value)}
                  onKeyDown={e => { if (e.key === 'Enter') applyDiscount(); }} />
              </div>
              {/* An explicit apply, not a save-on-blur: closing the modal
                  straight after typing would otherwise lose the discount. */}
              <Btn size="sm" variant="outline" disabled={busy || String(Number(discount || 0)) === String(Number(quote.discountPct))}
                onClick={applyDiscount}>
                Apply
              </Btn>
            </div>
          )}

          <div style={{ ...card, padding: '12px 16px', display: 'flex', flexDirection: 'column', gap: 6, fontSize: 12.5 }}>
            {[['Subtotal', quote.subtotal], ['Tax', quote.taxAmount]].map(([label, v]) => (
              <div key={label} style={{ display: 'flex', justifyContent: 'space-between', color: 'var(--t3)' }}>
                <span>{label}</span><span>{fmtMoney(v)}</span>
              </div>
            ))}
            {Number(quote.discountPct) > 0 && (
              <div style={{ display: 'flex', justifyContent: 'space-between', color: 'var(--t3)' }}>
                <span>Discount</span><span>{Number(quote.discountPct)}%</span>
              </div>
            )}
            <div style={{ display: 'flex', justifyContent: 'space-between', borderTop: '1px solid var(--bd)', paddingTop: 8, marginTop: 2, fontWeight: 700, color: 'var(--t1)', fontSize: 14 }}>
              <span>Total</span><span>{fmtMoney(quote.total)}</span>
            </div>
            <div style={{ fontSize: 10.5, color: 'var(--t3)', marginTop: 4 }}>
              Every figure is calculated on the server from the line items above.
            </div>
          </div>
        </>
      )}
    </Modal>
  );
};

export const QuotesView = () => {
  const [quotes, setQuotes] = useState([]);
  const [products, setProducts] = useState([]);
  const [deals, setDeals] = useState([]);
  const [status, setStatus] = useState('');
  const [openId, setOpenId] = useState(null);
  const [creating, setCreating] = useState(false);
  const [newDealId, setNewDealId] = useState('');
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState(null);

  const load = useCallback(() => {
    setLoading(true);
    const qs = new URLSearchParams();
    if (status) qs.set('status', status);
    wFetch(`/quotes?${qs}`)
      .then(r => (r.ok ? r.json() : Promise.reject(new Error('Could not load quotes'))))
      .then(d => setQuotes(d.data ?? []))
      .catch(e => setErr(e.message))
      .finally(() => setLoading(false));
  }, [status]);

  useEffect(() => { load(); }, [load]);
  useEffect(() => {
    wFetch('/products').then(r => r.ok && r.json()).then(d => setProducts(d?.data ?? [])).catch(() => {});
    wFetch('/deals').then(r => r.ok && r.json()).then(d => setDeals(d?.data ?? [])).catch(() => {});
  }, []);

  const create = async () => {
    setErr(null);
    try {
      const res = await wFetch('/quotes', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ dealId: newDealId || null, fromDealLineItems: !!newDealId }),
      });
      if (!res.ok) {
        const d = await res.json().catch(() => ({}));
        throw new Error(d.error || 'Could not create this quote');
      }
      const q = await res.json();
      setCreating(false);
      setNewDealId('');
      load();
      setOpenId(q.id);
    } catch (e) {
      setErr(e.message);
    }
  };

  return (
    <div style={{ flex: 1, overflowY: 'auto' }}>
      <div style={{ padding: '16px 20px', borderBottom: '1px solid var(--bd)', display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap' }}>
        <div style={{ display: 'flex', alignItems: 'baseline', gap: 10 }}>
          <span style={{ fontFamily: "'Syne',sans-serif", fontWeight: 700, fontSize: 17, color: 'var(--t1)' }}>Quotes</span>
          <span style={{ fontSize: 12.5, color: 'var(--t3)' }}>{quotes.length}</span>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <div style={{ width: 150 }}>
            <FSelect value={status} onChange={e => setStatus(e.target.value)} placeholder="All statuses"
              options={Object.keys(STATUS_TONE).map(s => ({ value: s, label: pretty(s) }))} />
          </div>
          <Btn size="sm" onClick={() => setCreating(true)}>New quote</Btn>
        </div>
      </div>

      <div style={{ padding: '18px 20px', display: 'flex', flexDirection: 'column', gap: 14 }}>
        {err && <ErrorBanner onDismiss={() => setErr(null)}>{err}</ErrorBanner>}

        <div style={{ ...card, overflow: 'hidden' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead><tr style={{ borderBottom: '1px solid var(--bd)' }}>
              <ColHead>Quote</ColHead><ColHead>Customer</ColHead><ColHead>Deal</ColHead>
              <ColHead>Status</ColHead><ColHead align="right">Total</ColHead><ColHead>Valid until</ColHead>
            </tr></thead>
            <tbody>
              {loading && <tr><td colSpan={6} style={{ padding: 20, fontSize: 12.5, color: 'var(--t3)' }}>Loading…</td></tr>}
              {!loading && quotes.length === 0 && (
                <tr><td colSpan={6} style={{ padding: '32px 16px', textAlign: 'center' }}>
                  <I n="note" s={24} c="var(--t3)" />
                  <div style={{ marginTop: 8, fontSize: 13, color: 'var(--t2)', fontWeight: 600 }}>No quotes yet</div>
                  <div style={{ marginTop: 3, fontSize: 12, color: 'var(--t3)' }}>Create one from a deal to carry its line items across.</div>
                </td></tr>
              )}
              {quotes.map(q => (
                <tr key={q.id} onClick={() => setOpenId(q.id)} style={{ borderBottom: '1px solid var(--bd)', cursor: 'pointer' }}>
                  <td style={{ padding: '11px 16px', fontSize: 12.5, color: 'var(--t1)', fontWeight: 600 }}>{q.quoteNumber}</td>
                  <td style={{ padding: '11px 16px', fontSize: 12.5, color: 'var(--t2)' }}>{q.contact?.name || '—'}</td>
                  <td style={{ padding: '11px 16px', fontSize: 12, color: 'var(--t3)' }}>{q.deal?.title || '—'}</td>
                  <td style={{ padding: '11px 16px' }}><StatusBadge label={pretty(q.status)} tone={STATUS_TONE[q.status]} /></td>
                  <td style={{ padding: '11px 16px', fontSize: 12.5, color: 'var(--t1)', textAlign: 'right', fontWeight: 700 }}>{fmtMoney(q.total)}</td>
                  <td style={{ padding: '11px 16px', fontSize: 12, color: 'var(--t3)' }}>{q.validUntil ? fmtDate(q.validUntil) : '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {creating && (
        <Modal title="New quote" onClose={() => setCreating(false)} width={460}
          footer={<>
            <Btn variant="ghost" size="sm" onClick={() => setCreating(false)}>Cancel</Btn>
            <Btn size="sm" onClick={create}>Create</Btn>
          </>}>
          <FLabel>Deal (optional)</FLabel>
          <FSelect value={newDealId} onChange={e => setNewDealId(e.target.value)} placeholder="No deal"
            options={deals.map(d => ({ value: d.id, label: d.title }))} />
          <div style={{ marginTop: 8, fontSize: 11.5, color: 'var(--t3)' }}>
            Choosing a deal copies its contact and any line items already on it.
          </div>
        </Modal>
      )}

      {openId && (
        <QuoteDetailModal quoteId={openId} products={products}
          onClose={() => setOpenId(null)} onChanged={load} />
      )}
    </div>
  );
};

export default QuotesView;
