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
  DRAFT: ['SENT', 'EXPIRED'],
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

const esc = (v) => String(v ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

// Line subtotals are pre-discount; the quote's own subtotal/tax are already
// discounted server-side (calculateDocument). Showing the stored subtotal
// directly under undiscounted line totals made the sheet not add up, so the
// discount is shown as its own row between the two.
export function quoteBreakdown(quote) {
  const lines = quote?.lineItems ?? [];
  const r2 = (n) => Math.round((n + Number.EPSILON) * 100) / 100;
  const itemsSubtotal = r2(lines.reduce((s, l) => s + Number(l.subtotal ?? 0), 0));
  const subtotal = Number(quote?.subtotal ?? 0);
  return {
    itemsSubtotal,
    discount: r2(Math.max(0, itemsSubtotal - subtotal)),
    discountPct: Number(quote?.discountPct ?? 0),
    tax: Number(quote?.taxAmount ?? 0),
    total: Number(quote?.total ?? 0),
  };
}

// A print-ready copy of the quote in a new window; the browser's print dialog
// doubles as "Save as PDF". Every value is HTML-escaped because names and
// line items are user-entered.
function printQuote(quote) {
  const b = quoteBreakdown(quote);
  const rows = (quote.lineItems ?? []).map(l => `<tr><td>${esc(l.name)}</td><td class="r">${esc(Number(l.quantity))}</td><td class="r">${esc(fmtMoney(l.unitPrice))}</td><td class="r">${esc(fmtMoney(l.taxAmount))}</td><td class="r">${esc(fmtMoney(l.total))}</td></tr>`).join('');
  const html = `<!doctype html><html><head><meta charset="utf-8"><title>Quote ${esc(quote.quoteNumber)}</title>
<style>body{font-family:system-ui,sans-serif;color:#111;margin:40px}h1{font-size:22px;margin:0 0 4px}table{width:100%;border-collapse:collapse;margin:24px 0}th,td{padding:8px;border-bottom:1px solid #ddd;text-align:left;font-size:13px}.r{text-align:right}.tot td{border:none}.grand td{font-weight:700;font-size:15px;border-top:2px solid #111}.muted{color:#666;font-size:13px}</style></head>
<body><h1>Quote ${esc(quote.quoteNumber)}</h1><div class="muted">${esc(pretty(quote.status))}${quote.contact?.name ? ` · ${esc(quote.contact.name)}` : ''}${quote.deal?.title ? ` · ${esc(quote.deal.title)}` : ''}</div>
<div class="muted">Issued ${esc(fmtDate(quote.createdAt))}${quote.validUntil ? ` · Valid until ${esc(fmtDate(quote.validUntil))}` : ''}</div>
<table><thead><tr><th>Item</th><th class="r">Qty</th><th class="r">Price</th><th class="r">Tax</th><th class="r">Total</th></tr></thead><tbody>${rows || '<tr><td colspan="5">No line items</td></tr>'}</tbody></table>
<table style="width:320px;margin-left:auto"><tbody class="tot">
<tr><td>Subtotal</td><td class="r">${esc(fmtMoney(b.itemsSubtotal, { dash: '₹0' }))}</td></tr>
${b.discount > 0 ? `<tr><td>Discount (${esc(b.discountPct)}%)</td><td class="r">−${esc(fmtMoney(b.discount))}</td></tr>` : ''}
<tr><td>Tax</td><td class="r">${esc(fmtMoney(b.tax, { dash: '₹0' }))}</td></tr>
<tr class="grand"><td>Total</td><td class="r">${esc(fmtMoney(b.total, { dash: '₹0' }))}</td></tr></tbody></table>
${quote.notes ? `<p class="muted" style="white-space:pre-wrap">${esc(quote.notes)}</p>` : ''}
</body></html>`;
  const w = window.open('', '_blank');
  if (!w) return false;
  w.opener = null;
  w.document.open();
  w.document.write(html);
  w.document.close();
  w.focus();
  w.print();
  return true;
}

const ColHead = ({ children, align = 'left' }) => (
  <th style={{ padding: '10px 16px', textAlign: align, fontSize: 11, fontWeight: 700, color: 'var(--t2)', textTransform: 'uppercase', letterSpacing: '.08em', whiteSpace: 'nowrap' }}>{children}</th>
);

const QuoteDetailModal = ({ quoteId, products, onClose, onChanged, onDeleted }) => {
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
      return true;
    } catch (e) {
      setErr(e.message);
      return false;
    } finally {
      setBusy(false);
    }
  };

  const qtyNum = Number(qty);
  const qtyValid = qty !== '' && Number.isFinite(qtyNum) && qtyNum > 0;
  const discountNum = Number(discount || 0);
  const discountValid = Number.isFinite(discountNum) && discountNum >= 0 && discountNum <= 100;

  const addLine = async () => {
    if (!qtyValid) { setErr('Quantity must be greater than zero.'); return; }
    const ok = await act(() => wFetch(`/quotes/${quote.id}/line-items`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ productId, quantity: qtyNum }),
    }));
    // Only clear the picker once the line is really on the quote, so a refused
    // add can be retried without re-entering it.
    if (ok) { setProductId(''); setQty('1'); }
  };

  const removeQuote = async () => {
    if (!window.confirm(`Delete quote ${quote.quoteNumber}? This cannot be undone.`)) return;
    setBusy(true); setErr(null);
    try {
      const res = await wFetch(`/quotes/${quote.id}`, { method: 'DELETE' });
      if (!res.ok && res.status !== 204) {
        const d = await res.json().catch(() => ({}));
        throw new Error(d.error || 'Could not delete this quote');
      }
      onDeleted?.(quote.id);
    } catch (e) {
      setErr(e.message);
      setBusy(false);
    }
  };

  const breakdown = quoteBreakdown(quote);

  const editable = quote?.status === 'DRAFT';

  const applyDiscount = () => {
    if (!discountValid) { setErr('Discount must be between 0 and 100%.'); return; }
    return act(() => wFetch(`/quotes/${quote.id}`, {
      method: 'PATCH', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ discountPct: discountNum }),
    }));
  };

  return (
    <Modal title={quote ? `Quote ${quote.quoteNumber}` : 'Quote'} onClose={onClose} width={640}
      footer={<>
        {quote && quote.status !== 'ACCEPTED' && (
          <Btn variant="outline" size="sm" onClick={removeQuote} disabled={busy}>Delete</Btn>
        )}
        {quote && (
          <Btn variant="outline" size="sm" disabled={busy}
            onClick={() => { if (!printQuote(quote)) setErr('Your browser blocked the print window — allow pop-ups for this site and try again.'); }}>
            <I n="download" s={13} /> Print / PDF
          </Btn>
        )}
        <Btn variant="ghost" size="sm" onClick={onClose}>Close</Btn>
      </>}>
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

          <div style={{ overflowX: 'auto', marginBottom: 14 }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: 480 }}>
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
          </div>

          {editable && (
            <div style={{ display: 'flex', gap: 8, alignItems: 'flex-end', marginBottom: 16, flexWrap: 'wrap' }}>
              <div style={{ flex: 2, minWidth: 170 }}>
                <FLabel>Add product</FLabel>
                <FSelect value={productId} onChange={e => setProductId(e.target.value)} placeholder="Choose a product"
                  options={products.map(p => ({ value: p.id, label: `${p.name} — ${fmtMoney(p.unitPrice)}` }))} />
              </div>
              <div style={{ width: 84 }}><FLabel>Qty</FLabel><FInput type="number" min="0" step="any" value={qty} onChange={e => setQty(e.target.value)} aria-label="Quantity" /></div>
              <Btn size="sm" disabled={busy || !productId || !qtyValid} onClick={addLine}>
                Add
              </Btn>
              <div style={{ width: 110 }}>
                <FLabel>Discount %</FLabel>
                <FInput type="number" min="0" max="100" step="any" value={discount} onChange={e => setDiscount(e.target.value)} aria-label="Discount percent"
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
            <div style={{ display: 'flex', justifyContent: 'space-between', color: 'var(--t3)' }}>
              <span>Subtotal</span><span>{fmtMoney(breakdown.itemsSubtotal, { dash: '₹0' })}</span>
            </div>
            {breakdown.discountPct > 0 && (
              <div style={{ display: 'flex', justifyContent: 'space-between', color: 'var(--t3)' }}>
                <span>Discount ({breakdown.discountPct}%)</span><span>−{fmtMoney(breakdown.discount, { dash: '₹0' })}</span>
              </div>
            )}
            <div style={{ display: 'flex', justifyContent: 'space-between', color: 'var(--t3)' }}>
              <span>Tax{breakdown.discountPct > 0 ? ' (on discounted amount)' : ''}</span><span>{fmtMoney(breakdown.tax, { dash: '₹0' })}</span>
            </div>
            <div style={{ display: 'flex', justifyContent: 'space-between', borderTop: '1px solid var(--bd)', paddingTop: 8, marginTop: 2, fontWeight: 700, color: 'var(--t1)', fontSize: 14 }}>
              <span>Total</span><span>{fmtMoney(quote.total, { dash: '₹0' })}</span>
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
  const [creatingBusy, setCreatingBusy] = useState(false);
  const [err, setErr] = useState(null);

  const load = useCallback(() => {
    setLoading(true);
    setErr(null);
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
    // A second click while the first POST is in flight used to mint a second
    // quote number.
    if (creatingBusy) return;
    setCreatingBusy(true);
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
    } finally {
      setCreatingBusy(false);
    }
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', flex: 1, minHeight: 0, overflowY: 'auto' }}>
      <div className="dash-page-head" style={{ minHeight: 58, borderBottom: '1px solid var(--bd)', display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '10px 24px', flexShrink: 0, background: 'var(--surf)', gap: 12, flexWrap: 'wrap' }}>
        <div style={{ display: 'flex', alignItems: 'baseline', gap: 10 }}>
          <span style={{ fontFamily: "'Syne',sans-serif", fontWeight: 700, fontSize: 17, color: 'var(--t1)' }}>Quotes</span>
          <span style={{ fontSize: 12.5, color: 'var(--t3)' }}>{quotes.length}</span>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
          <div style={{ width: 150 }}>
            <FSelect value={status} onChange={e => setStatus(e.target.value)} placeholder="All statuses"
              options={Object.keys(STATUS_TONE).map(s => ({ value: s, label: pretty(s) }))} />
          </div>
          <Btn size="sm" onClick={() => setCreating(true)}>New quote</Btn>
        </div>
      </div>

      <div className="dash-page" style={{ padding: '18px 20px', display: 'flex', flexDirection: 'column', gap: 14 }}>
        {err && <ErrorBanner onDismiss={() => setErr(null)}>{err}</ErrorBanner>}

        <div style={{ ...card, overflowX: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: 680 }}>
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
                <tr key={q.id} onClick={() => setOpenId(q.id)} tabIndex={0} aria-label={`Open quote ${q.quoteNumber}`}
                  onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); setOpenId(q.id); } }}
                  style={{ borderBottom: '1px solid var(--bd)', cursor: 'pointer' }}>
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
            <Btn size="sm" onClick={create} disabled={creatingBusy}>{creatingBusy ? 'Creating…' : 'Create'}</Btn>
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
          onClose={() => setOpenId(null)} onChanged={load}
          onDeleted={() => { setOpenId(null); load(); }} />
      )}
    </div>
  );
};

export default QuotesView;
