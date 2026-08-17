import { useState, useEffect } from 'react';
import { wFetch } from '../lib/api.js';

const inr = (value) => `₹${Number(value || 0).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const card = { background: 'var(--gbg)', border: '1px solid var(--bd)', borderRadius: 12 };

export const WalletSummaryCards = () => {
  const [summary, setSummary] = useState(null);

  useEffect(() => {
    let alive = true;
    const load = () => wFetch('/wallet/summary')
      .then(r => (r.ok ? r.json() : null))
      .then(d => { if (alive && d) setSummary(d); })
      .catch(() => {});
    load();
    const onUpdated = () => load();
    window.addEventListener('wallet:balance-updated', onUpdated);
    return () => { alive = false; window.removeEventListener('wallet:balance-updated', onUpdated); };
  }, []);

  if (!summary) return null;

  const tiles = [
    { label: 'Wallet Balance',   value: inr(summary.balance), accent: summary.balance <= 0 ? '#f87171' : 'var(--green)' },
    { label: "Today's Spend",    value: inr(summary.todaySpend) },
    { label: 'Campaign Spend',   value: inr(summary.campaignSpend) },
    { label: 'Total Campaigns',  value: (summary.totalCampaigns || 0).toLocaleString() },
    { label: 'Avg / Campaign',   value: inr(summary.averageCostPerCampaign) },
    {
      label: 'Last Recharge',
      value: summary.lastRecharge ? inr(summary.lastRecharge.amount) : '—',
      sub: summary.lastRecharge ? new Date(summary.lastRecharge.at).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' }) : 'No recharges yet',
    },
  ];

  return (
    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: 12 }}>
      {tiles.map(t => (
        <div key={t.label} style={{ ...card, padding: '14px 16px' }}>
          <p style={{ fontSize: 10, fontWeight: 700, color: 'var(--t3)', textTransform: 'uppercase', letterSpacing: '.07em', marginBottom: 6 }}>{t.label}</p>
          <p style={{ fontFamily: "'Syne',sans-serif", fontWeight: 800, fontSize: 19, color: t.accent || 'var(--t1)', letterSpacing: '-.02em' }}>{t.value}</p>
          {t.sub && <p style={{ fontSize: 10.5, color: 'var(--t3)', marginTop: 3 }}>{t.sub}</p>}
        </div>
      ))}
    </div>
  );
};
