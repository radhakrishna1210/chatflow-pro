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

const StatCard = ({ icon, label, value, sub, color = 'var(--green)', iconColor }) => (
  <div style={{ ...card, padding: '20px', display: 'flex', flexDirection: 'column', gap: 12, transition: 'border-color .2s, transform .2s' }}
    onMouseEnter={e => { e.currentTarget.style.borderColor = 'var(--bdm)'; e.currentTarget.style.transform = 'translateY(-2px)'; }}
    onMouseLeave={e => { e.currentTarget.style.borderColor = 'var(--bd)'; e.currentTarget.style.transform = 'none'; }}>
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
      <div style={{ width: 40, height: 40, borderRadius: 10, background: `${color}12`, border: `1px solid ${color}25`, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        <I n={icon} s={18} c={iconColor || color} />
      </div>
      <span style={{ fontSize: 10, fontWeight: 700, color: 'var(--t3)', textTransform: 'uppercase', letterSpacing: '.08em' }}>{label}</span>
    </div>
    <div>
      <p style={{ fontFamily: "'Syne',sans-serif", fontWeight: 800, fontSize: 22, color: 'var(--t1)', letterSpacing: '-.02em' }}>{value}</p>
      {sub && <p style={{ fontSize: 12, color: 'var(--t2)', marginTop: 3 }}>{sub}</p>}
    </div>
  </div>
);

export default function WalletPage() {
  const [balance, setBalance] = useState(2462.11);
  const [rechargeAmt, setRechargeAmt] = useState('2000');
  const [showRecharge, setShowRecharge] = useState(false);

  useEffect(() => {
    const saved = localStorage.getItem('chatflow_wallet_balance');
    if (saved !== null) setBalance(parseFloat(saved));
  }, []);

  const handleRecharge = () => {
    const amt = parseFloat(rechargeAmt);
    if (isNaN(amt) || amt <= 0) return;
    const newBal = balance + amt;
    setBalance(newBal);
    localStorage.setItem('chatflow_wallet_balance', String(newBal));
    window.dispatchEvent(new CustomEvent('wallet:balance-updated', { detail: newBal }));
    setShowRecharge(false);
    setRechargeAmt('2000');
  };

  const transactions = [
    { id: 1, type: 'Recharge', amount: '+₹5,000.00', date: 'Jul 1, 2026', status: 'Success', color: 'var(--green)' },
    { id: 2, type: 'Campaign — Diwali Sale', amount: '-₹1,247.50', date: 'Jun 28, 2026', status: 'Deducted', color: '#f87171' },
    { id: 3, type: 'Recharge', amount: '+₹2,000.00', date: 'Jun 20, 2026', status: 'Success', color: 'var(--green)' },
    { id: 4, type: 'Campaign — Welcome Flow', amount: '-₹890.39', date: 'Jun 15, 2026', status: 'Deducted', color: '#f87171' },
    { id: 5, type: 'Recharge', amount: '+₹3,000.00', date: 'Jun 10, 2026', status: 'Success', color: 'var(--green)' },
    { id: 6, type: 'Campaign — Flash Sale', amount: '-₹2,400.00', date: 'Jun 5, 2026', status: 'Deducted', color: '#f87171' },
  ];

  const quickAmounts = [500, 1000, 2000, 5000, 10000];

  return (
    <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
      <DashHeader title="Wallet" subtitle="Manage your balance, credits & transactions" />
      <div style={{ flex: 1, overflowY: 'auto', padding: '24px 28px' }}>

        {/* Stats Grid */}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: 14, marginBottom: 24 }}>
          <StatCard
            icon="wallet" label="Balance"
            value={`₹ ${balance.toLocaleString('en-IN', { minimumFractionDigits: 2 })}`}
            sub="Available for campaigns"
            color="#1EBF5E"
          />
          <StatCard
            icon="spark" label="Credits"
            value="12,450"
            sub="Message credits remaining"
            color="#0EA5E9"
          />
          <StatCard
            icon="chart" label="Usage (30d)"
            value="₹ 4,537.89"
            sub="Across 8 campaigns"
            color="#A78BFA"
          />
          <StatCard
            icon="send" label="Messages Sent"
            value="34,210"
            sub="This billing cycle"
            color="#F59E0B"
          />
        </div>

        {/* Recharge Section */}
        <div style={{ ...card, padding: 20, marginBottom: 24, background: 'linear-gradient(135deg, rgba(30,191,94,0.04), rgba(14,165,233,0.02))' }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 16 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
              <div style={{ width: 38, height: 38, borderRadius: 10, background: 'var(--gbg)', border: '1px solid var(--gbd)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                <I n="credit" s={18} c="var(--green)" />
              </div>
              <div>
                <p style={{ fontFamily: "'Syne',sans-serif", fontWeight: 700, fontSize: 15, color: 'var(--t1)' }}>Recharge Wallet</p>
                <p style={{ fontSize: 12, color: 'var(--t2)' }}>Add funds to continue running campaigns</p>
              </div>
            </div>
            {!showRecharge && (
              <Btn onClick={() => setShowRecharge(true)} style={{ boxShadow: 'var(--glow)' }}>
                <I n="plus" s={14} c="#060A10" /> Add Funds
              </Btn>
            )}
          </div>

          {showRecharge && (
            <div style={{ animation: 'fadeUp .3s ease both' }}>
              <div style={{ display: 'flex', gap: 8, marginBottom: 14, flexWrap: 'wrap' }}>
                {quickAmounts.map(amt => (
                  <button key={amt}
                    onClick={() => setRechargeAmt(String(amt))}
                    style={{
                      padding: '8px 16px', borderRadius: 8, fontSize: 13, fontWeight: 600, cursor: 'pointer',
                      background: rechargeAmt === String(amt) ? 'var(--gbg)' : 'rgba(255,255,255,0.04)',
                      border: `1px solid ${rechargeAmt === String(amt) ? 'var(--gbd)' : 'var(--bd)'}`,
                      color: rechargeAmt === String(amt) ? 'var(--green)' : 'var(--t2)',
                      fontFamily: "'Plus Jakarta Sans',sans-serif", transition: 'all .15s',
                    }}
                  >
                    ₹{amt.toLocaleString()}
                  </button>
                ))}
              </div>
              <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
                <input
                  type="number" value={rechargeAmt}
                  onChange={e => setRechargeAmt(e.target.value)}
                  style={{
                    flex: 1, maxWidth: 200, padding: '10px 14px', borderRadius: 8,
                    background: 'rgba(255,255,255,0.04)', border: '1px solid var(--bd)',
                    color: 'var(--t1)', fontSize: 14, fontFamily: "'Plus Jakarta Sans',sans-serif",
                    outline: 'none',
                  }}
                  placeholder="Enter amount"
                />
                <Btn onClick={handleRecharge} style={{ boxShadow: 'var(--glow)' }}>Recharge ₹{parseInt(rechargeAmt || 0).toLocaleString()}</Btn>
                <Btn variant="ghost" onClick={() => setShowRecharge(false)}>Cancel</Btn>
              </div>
            </div>
          )}
        </div>

        {/* Transactions */}
        <div style={{ ...card, overflow: 'hidden' }}>
          <div style={{ padding: '16px 20px', borderBottom: '1px solid var(--bd)', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
              <I n="clock" s={16} c="var(--green)" />
              <span style={{ fontFamily: "'Syne',sans-serif", fontWeight: 700, fontSize: 15, color: 'var(--t1)' }}>Transaction History</span>
            </div>
            <Btn variant="outline" size="sm">
              <I n="download" s={12} c="var(--t2)" /> Download
            </Btn>
          </div>
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead>
              <tr style={{ borderBottom: '1px solid var(--bd)' }}>
                {['Transaction', 'Amount', 'Date', 'Status'].map(h => (
                  <th key={h} style={{ padding: '12px 20px', textAlign: 'left', fontSize: 11, fontWeight: 700, color: 'var(--t3)', textTransform: 'uppercase', letterSpacing: '.08em' }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {transactions.map((t, i) => (
                <tr key={t.id}
                  style={{ borderBottom: i < transactions.length - 1 ? '1px solid var(--bd)' : 'none', transition: 'background .12s' }}
                  onMouseEnter={e => e.currentTarget.style.background = 'rgba(255,255,255,0.015)'}
                  onMouseLeave={e => e.currentTarget.style.background = 'transparent'}>
                  <td style={{ padding: '14px 20px', fontSize: 13, fontWeight: 600, color: 'var(--t1)' }}>{t.type}</td>
                  <td style={{ padding: '14px 20px', fontSize: 13, fontWeight: 700, color: t.color }}>{t.amount}</td>
                  <td style={{ padding: '14px 20px', fontSize: 13, color: 'var(--t2)' }}>{t.date}</td>
                  <td style={{ padding: '14px 20px' }}>
                    <span style={{
                      padding: '3px 10px', borderRadius: 12, fontSize: 11, fontWeight: 600,
                      background: t.status === 'Success' ? 'rgba(30,191,94,0.08)' : 'rgba(255,255,255,0.04)',
                      border: `1px solid ${t.status === 'Success' ? 'rgba(30,191,94,0.2)' : 'var(--bd)'}`,
                      color: t.status === 'Success' ? 'var(--green)' : 'var(--t2)',
                    }}>{t.status}</span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
