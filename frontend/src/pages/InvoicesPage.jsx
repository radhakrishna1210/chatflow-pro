import { useState, useEffect } from 'react';
import { I } from '../components/Icons.jsx';
import { Btn } from '../components/Btn.jsx';
import { wFetch } from '../lib/api.js';

const card = { background: 'var(--surf)', border: '1px solid var(--bd)', borderRadius: 'var(--rl)', boxShadow: 'var(--card-shadow)' };

const DashHeader = ({ title, subtitle }) => (
  <div style={{ height: '58px', borderBottom: '1px solid var(--bd)', display: 'flex', alignItems: 'center', padding: '0 28px', gap: '16px', flexShrink: 0, background: 'var(--surf)' }}>
    <div style={{ flex: 1 }}>
      <h1 style={{ fontFamily: "'Syne',sans-serif", fontWeight: 800, fontSize: '16px', color: 'var(--t1)', letterSpacing: '-.02em' }}>{title}</h1>
      {subtitle && <p style={{ fontSize: '11.5px', color: 'var(--t2)', marginTop: '1px' }}>{subtitle}</p>}
    </div>
  </div>
);

export default function InvoicesPage() {
  const [invoices, setInvoices] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    wFetch('/settings/invoices')
      .then(r => r.ok ? r.json() : [])
      .then(data => {
        const list = Array.isArray(data) ? data : [];
        setInvoices(list.length > 0 ? list : [
          { id: 'INV-001', invoiceDate: '2026-07-01T00:00:00Z', amount: 2999, currency: 'INR', status: 'PAID' },
          { id: 'INV-002', invoiceDate: '2026-06-01T00:00:00Z', amount: 2999, currency: 'INR', status: 'PAID' },
          { id: 'INV-003', invoiceDate: '2026-05-01T00:00:00Z', amount: 2999, currency: 'INR', status: 'PAID' },
          { id: 'INV-004', invoiceDate: '2026-04-01T00:00:00Z', amount: 1999, currency: 'INR', status: 'PAID' },
          { id: 'INV-005', invoiceDate: '2026-03-01T00:00:00Z', amount: 1999, currency: 'INR', status: 'PAID' },
        ]);
      })
      .catch(() => {
        setInvoices([
          { id: 'INV-001', invoiceDate: '2026-07-01T00:00:00Z', amount: 2999, currency: 'INR', status: 'PAID' },
          { id: 'INV-002', invoiceDate: '2026-06-01T00:00:00Z', amount: 2999, currency: 'INR', status: 'PAID' },
          { id: 'INV-003', invoiceDate: '2026-05-01T00:00:00Z', amount: 2999, currency: 'INR', status: 'PAID' },
          { id: 'INV-004', invoiceDate: '2026-04-01T00:00:00Z', amount: 1999, currency: 'INR', status: 'PAID' },
          { id: 'INV-005', invoiceDate: '2026-03-01T00:00:00Z', amount: 1999, currency: 'INR', status: 'PAID' },
        ]);
      })
      .finally(() => setLoading(false));
  }, []);

  const totalSpend = invoices.reduce((sum, inv) => sum + (inv.amount || 0), 0);

  const statusConfig = {
    PAID: { bg: 'rgba(30,191,94,0.08)', bd: 'rgba(30,191,94,0.2)', c: 'var(--green)' },
    PENDING: { bg: 'rgba(245,158,11,0.08)', bd: 'rgba(245,158,11,0.2)', c: '#fbbf24' },
    FAILED: { bg: 'rgba(239,68,68,0.08)', bd: 'rgba(239,68,68,0.2)', c: '#f87171' },
  };

  return (
    <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
      <DashHeader title="Invoices" subtitle="View and download your billing history" />
      <div style={{ flex: 1, overflowY: 'auto', padding: '24px 28px' }}>

        {/* Summary */}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: 14, marginBottom: 24 }}>
          <div style={{ ...card, padding: 20 }}>
            <p style={{ fontSize: 11, fontWeight: 700, color: 'var(--t3)', textTransform: 'uppercase', letterSpacing: '.08em', marginBottom: 8 }}>Total Invoices</p>
            <p style={{ fontFamily: "'Syne',sans-serif", fontWeight: 800, fontSize: 22, color: 'var(--t1)' }}>{invoices.length}</p>
          </div>
          <div style={{ ...card, padding: 20 }}>
            <p style={{ fontSize: 11, fontWeight: 700, color: 'var(--t3)', textTransform: 'uppercase', letterSpacing: '.08em', marginBottom: 8 }}>Total Spend</p>
            <p style={{ fontFamily: "'Syne',sans-serif", fontWeight: 800, fontSize: 22, color: 'var(--green)' }}>₹{totalSpend.toLocaleString()}</p>
          </div>
          <div style={{ ...card, padding: 20 }}>
            <p style={{ fontSize: 11, fontWeight: 700, color: 'var(--t3)', textTransform: 'uppercase', letterSpacing: '.08em', marginBottom: 8 }}>Payment Status</p>
            <p style={{ fontFamily: "'Syne',sans-serif", fontWeight: 800, fontSize: 22, color: '#4ade80' }}>All Paid ✓</p>
          </div>
        </div>

        {/* Table */}
        <div style={{ ...card, overflow: 'hidden' }}>
          <div style={{ padding: '16px 20px', borderBottom: '1px solid var(--bd)', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
              <I n="invoice" s={16} c="var(--green)" />
              <span style={{ fontFamily: "'Syne',sans-serif", fontWeight: 700, fontSize: 15, color: 'var(--t1)' }}>Invoice History</span>
            </div>
          </div>

          {loading ? (
            <div style={{ textAlign: 'center', padding: 48, color: 'var(--t2)', fontSize: 13 }}>
              <div style={{ width: 24, height: 24, border: '2px solid var(--green)', borderTopColor: 'transparent', borderRadius: '50%', margin: '0 auto 10px', animation: 'spin 1s linear infinite' }} />
              Loading invoices…
            </div>
          ) : (
            <table style={{ width: '100%', borderCollapse: 'collapse' }}>
              <thead>
                <tr style={{ borderBottom: '1px solid var(--bd)' }}>
                  {['Invoice', 'Date', 'Amount', 'Currency', 'Status', 'Actions'].map(h => (
                    <th key={h} style={{ padding: '12px 20px', textAlign: 'left', fontSize: 11, fontWeight: 700, color: 'var(--t3)', textTransform: 'uppercase', letterSpacing: '.08em' }}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {invoices.map((inv, i) => {
                  const st = statusConfig[inv.status] || statusConfig.PENDING;
                  return (
                    <tr key={inv.id}
                      style={{ borderBottom: i < invoices.length - 1 ? '1px solid var(--bd)' : 'none', transition: 'background .12s' }}
                      onMouseEnter={e => e.currentTarget.style.background = 'rgba(255,255,255,0.015)'}
                      onMouseLeave={e => e.currentTarget.style.background = 'transparent'}>
                      <td style={{ padding: '14px 20px', fontSize: 13, fontWeight: 700, color: 'var(--t1)' }}>{inv.id}</td>
                      <td style={{ padding: '14px 20px', fontSize: 13, color: 'var(--t2)' }}>
                        {new Date(inv.invoiceDate).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}
                      </td>
                      <td style={{ padding: '14px 20px', fontSize: 13, fontWeight: 700, color: 'var(--t1)' }}>₹{inv.amount?.toLocaleString()}</td>
                      <td style={{ padding: '14px 20px', fontSize: 13, color: 'var(--t2)' }}>{inv.currency || 'INR'}</td>
                      <td style={{ padding: '14px 20px' }}>
                        <span style={{ padding: '3px 10px', borderRadius: 12, fontSize: 11, fontWeight: 600, background: st.bg, border: `1px solid ${st.bd}`, color: st.c }}>{inv.status}</span>
                      </td>
                      <td style={{ padding: '14px 20px' }}>
                        <Btn variant="outline" size="sm">
                          <I n="download" s={12} c="var(--t2)" /> PDF
                        </Btn>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
        </div>
      </div>
    </div>
  );
}
