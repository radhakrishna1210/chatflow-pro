import { useState, useEffect } from 'react';
import { I } from '../components/Icons.jsx';
import { Btn } from '../components/Btn.jsx';
import { wFetch } from '../lib/api.js';

const card = { background:'var(--surf)', border:'1px solid var(--bd)', borderRadius:'var(--rl)', boxShadow:'var(--card-shadow)' };

// Loads the Razorpay Checkout widget once, same pattern as the Facebook JS SDK
// loader in NumberSetupView.jsx.
const loadRazorpayScript = () => new Promise((resolve) => {
  if (window.Razorpay) return resolve(true);
  if (document.getElementById('razorpay-checkout-js')) {
    const check = setInterval(() => { if (window.Razorpay) { clearInterval(check); resolve(true); } }, 100);
    setTimeout(() => { clearInterval(check); resolve(!!window.Razorpay); }, 5000);
    return;
  }
  const js = document.createElement('script');
  js.id = 'razorpay-checkout-js';
  js.src = 'https://checkout.razorpay.com/v1/checkout.js';
  js.onload = () => resolve(true);
  js.onerror = () => resolve(false);
  document.body.appendChild(js);
});

const SUB_TABS = [
  { id: 'wallet',       label: 'Wallet',                 icon: 'credit'  },
  { id: 'expenses',     label: 'Track Expenses',         icon: 'chart'   },
  { id: 'insights',     label: 'Paid Messages Insights', icon: 'chart'   },
  { id: 'billing',      label: 'Billing Details',        icon: 'note'    },
  { id: 'subscription', label: 'Manage Subscriptions',   icon: 'users'   },
  { id: 'invoices',     label: 'Invoices',               icon: 'note'    },
];

export default function PaymentsView({ initialTab } = {}) {
  const isAdmin = JSON.parse(localStorage.getItem('user') || '{}').role === 'ADMIN';
  const [activeSubTab, setActiveSubTab] = useState(() => SUB_TABS.some(t => t.id === initialTab) ? initialTab : 'wallet');
  
  // Wallet state — server-authoritative. Balance and transactions come from the
  // backend wallet ledger, never localStorage.
  const [balance, setBalance] = useState(0);
  const [walletTxns, setWalletTxns] = useState([]);
  const [rechargeAmt, setRechargeAmt] = useState('2000');
  const [rechargeStatus, setRechargeStatus] = useState('');
  const [rechargeError, setRechargeError] = useState('');

  // Billing State
  const [bizName, setBizName] = useState('');
  const [bizEmail, setBizEmail] = useState('');
  const [bizAddress, setBizAddress] = useState('');
  const [gstNum, setGstNum] = useState('');
  const [saveStatus, setSaveStatus] = useState('');

  // Subscriptions & Add-ons
  const [addons, setAddons] = useState({
    crm: false,
    events: false,
    tags: false,
    fields: false
  });

  // Subscription plan — server-authoritative (README §12). `subscription` is
  // the GET /subscription summary (current plan, usage, status, pending plan);
  // `plans` is the purchasable catalog.
  const [subscription, setSubscription] = useState(null);
  const [plans, setPlans] = useState([]);
  const [checkoutPlanId, setCheckoutPlanId] = useState(null);
  const [checkoutError, setCheckoutError] = useState('');
  const [checkoutMessage, setCheckoutMessage] = useState('');

  const loadSubscription = () => wFetch('/subscription')
    .then(r => r.ok ? r.json() : null)
    .then(d => { if (d) setSubscription(d); })
    .catch(() => {});

  // Invoices list
  const [invoices, setInvoices] = useState([]);
  const [loadingInvoices, setLoadingInvoices] = useState(true);

  // Insights state
  const [insights, setInsights] = useState(null);
  const [loadingInsights, setLoadingInsights] = useState(false);
  const [insightsError, setInsightsError] = useState('');

  // Load state from backend
  useEffect(() => {
    // 1. Wallet balance + transaction ledger (server-authoritative)
    const loadWallet = () => wFetch('/wallet')
      .then(r => r.ok ? r.json() : null)
      .then(data => {
        if (data) {
          setBalance(Number(data.balance) || 0);
          setWalletTxns(Array.isArray(data.transactions) ? data.transactions : []);
          window.dispatchEvent(new CustomEvent('wallet:balance-updated', { detail: Number(data.balance) || 0 }));
        }
      })
      .catch(() => {});
    loadWallet();
    window._reloadWallet = loadWallet;

    // 2. Billing details (still local until a billing backend exists)
    const savedBilling = localStorage.getItem('chatflow_billing_details');
    if (savedBilling) {
      try {
        const parsed = JSON.parse(savedBilling);
        setBizName(parsed.bizName || '');
        setBizEmail(parsed.bizEmail || '');
        setBizAddress(parsed.bizAddress || '');
        setGstNum(parsed.gstNum || '');
      } catch {}
    }

    const savedAddons = localStorage.getItem('chatflow_subscribed_addons');
    if (savedAddons) {
      try { setAddons(JSON.parse(savedAddons)); } catch {}
    }

    // 4. Load invoices from backend
    wFetch('/settings/invoices')
      .then(r => r.ok ? r.json() : [])
      .then(data => {
        setInvoices(data);
        setLoadingInvoices(false);
      })
      .catch(() => setLoadingInvoices(false));

    // 5. Subscription plan + purchasable catalog
    loadSubscription();
    wFetch('/subscription/plans')
      .then(r => r.ok ? r.json() : [])
      .then(data => setPlans(Array.isArray(data) ? data : []))
      .catch(() => {});
  }, []);

  // Real Razorpay top-up (test mode) — order created server-side (amount
  // validated + capped there too), credited only after signature verification.
  const handleRecharge = async () => {
    const amt = parseFloat(rechargeAmt);
    if (isNaN(amt) || amt <= 0) { setRechargeError('Enter a valid amount.'); return; }
    setRechargeError('');
    setRechargeStatus('processing');
    try {
      const orderRes = await wFetch('/wallet/checkout', { method: 'POST', body: JSON.stringify({ amount: amt }) });
      const order = await orderRes.json();
      if (!orderRes.ok) { setRechargeError(order.error || 'Could not start checkout'); setRechargeStatus(''); return; }

      const loaded = await loadRazorpayScript();
      if (!loaded) { setRechargeError('Could not load the payment widget. Check your connection and try again.'); setRechargeStatus(''); return; }

      const user = JSON.parse(localStorage.getItem('user') || '{}');
      const rzp = new window.Razorpay({
        key: order.keyId,
        amount: order.amount,
        currency: order.currency,
        order_id: order.orderId,
        name: 'ChatFlow Pro',
        description: 'Wallet recharge',
        prefill: { email: user.email, name: user.name },
        theme: { color: '#1EBF5E' },
        handler: async (response) => {
          try {
            const verifyRes = await wFetch('/wallet/checkout/verify', {
              method: 'POST',
              body: JSON.stringify({
                orderId: response.razorpay_order_id,
                paymentId: response.razorpay_payment_id,
                signature: response.razorpay_signature,
              }),
            });
            const data = await verifyRes.json();
            if (!verifyRes.ok) { setRechargeError(data.error || 'Payment verification failed'); setRechargeStatus(''); return; }
            setBalance(Number(data.balance) || 0);
            window.dispatchEvent(new CustomEvent('wallet:balance-updated', { detail: Number(data.balance) || 0 }));
            if (window._reloadWallet) window._reloadWallet();
            setRechargeStatus('success');
            setTimeout(() => setRechargeStatus(''), 2000);
          } catch {
            setRechargeError(`Payment succeeded but we could not confirm it automatically. Contact support with payment ID ${response.razorpay_payment_id}.`);
            setRechargeStatus('');
          }
        },
        modal: { ondismiss: () => setRechargeStatus('') },
      });
      rzp.on('payment.failed', (resp) => {
        setRechargeError(resp.error?.description || 'Payment failed');
        setRechargeStatus('');
      });
      rzp.open();
    } catch (e) {
      setRechargeError(e.message);
      setRechargeStatus('');
    }
  };

  // Buy/upgrade a plan via Razorpay Checkout (test mode). The order is created
  // server-side (amount comes from the Plan row, never the client) and
  // verified server-side via HMAC signature. The new plan takes effect
  // immediately — a fresh billing cycle starts now, giving the buyer the
  // full new quota right away instead of waiting for the next renewal.
  const handleBuyPlan = async (plan) => {
    setCheckoutError(''); setCheckoutMessage(''); setCheckoutPlanId(plan.id);
    try {
      const orderRes = await wFetch('/subscription/checkout', { method: 'POST', body: JSON.stringify({ planId: plan.id }) });
      const order = await orderRes.json();
      if (!orderRes.ok) { setCheckoutError(order.error || 'Could not start checkout'); setCheckoutPlanId(null); return; }

      const loaded = await loadRazorpayScript();
      if (!loaded) { setCheckoutError('Could not load the payment widget. Check your connection and try again.'); setCheckoutPlanId(null); return; }

      const user = JSON.parse(localStorage.getItem('user') || '{}');
      const rzp = new window.Razorpay({
        key: order.keyId,
        amount: order.amount,
        currency: order.currency,
        order_id: order.orderId,
        name: 'ChatFlow Pro',
        description: `${plan.name} plan`,
        prefill: { email: user.email, name: user.name },
        theme: { color: '#1EBF5E' },
        handler: async (response) => {
          try {
            const verifyRes = await wFetch('/subscription/checkout/verify', {
              method: 'POST',
              body: JSON.stringify({
                orderId: response.razorpay_order_id,
                paymentId: response.razorpay_payment_id,
                signature: response.razorpay_signature,
              }),
            });
            const result = await verifyRes.json();
            if (!verifyRes.ok) { setCheckoutError(result.error || 'Payment verification failed'); return; }
            setCheckoutMessage(`You're now on the ${result.plan.name} plan.`);
            loadSubscription();
          } catch {
            setCheckoutError(`Payment succeeded but we could not confirm it automatically. Contact support with payment ID ${response.razorpay_payment_id}.`);
          } finally {
            setCheckoutPlanId(null);
          }
        },
        modal: { ondismiss: () => setCheckoutPlanId(null) },
      });
      rzp.on('payment.failed', (resp) => {
        setCheckoutError(resp.error?.description || 'Payment failed');
        setCheckoutPlanId(null);
      });
      rzp.open();
    } catch (e) {
      setCheckoutError(e.message || 'Checkout failed');
      setCheckoutPlanId(null);
    }
  };

  const handleSaveBilling = () => {
    const data = { bizName, bizEmail, bizAddress, gstNum };
    localStorage.setItem('chatflow_billing_details', JSON.stringify(data));
    setSaveStatus('success');
    setTimeout(() => setSaveStatus(''), 2000);
  };

  const toggleAddon = (key) => {
    const updated = { ...addons, [key]: !addons[key] };
    setAddons(updated);
    localStorage.setItem('chatflow_subscribed_addons', JSON.stringify(updated));
  };

  // Render Inner Tabs
  const renderWallet = () => (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
      {/* Balance Card */}
      <div style={{ ...card, padding: 24, background: 'linear-gradient(135deg, #0f172a 0%, #1e293b 100%)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <div>
          <p style={{ fontSize: 13, color: 'var(--t2)', marginBottom: 6 }}>Total Wallet Balance</p>
          <h2 style={{ fontFamily: "'Syne',sans-serif", fontSize: 36, fontWeight: 800, color: 'var(--t1)', letterSpacing: '-.02em' }}>
            ₹ {balance.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
          </h2>
        </div>
        <div style={{ width: 48, height: 48, borderRadius: 12, background: 'rgba(30,191,94,0.1)', border: '1px solid var(--gbd)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          <I n="credit" s={24} c="var(--green)" />
        </div>
      </div>

      {/* Quick Recharge Box */}
      {isAdmin ? (
        <div style={{ ...card, padding: 24, display: 'flex', flexDirection: 'column', gap: 16 }}>
          <h3 style={{ fontFamily: "'Syne',sans-serif", fontSize: 16, fontWeight: 700, color: 'var(--t1)' }}>Recharge Wallet</h3>

          <div style={{ display: 'flex', gap: 12, alignItems: 'center' }}>
            <div style={{ position: 'relative', flex: 1, maxWidth: 300 }}>
              <span style={{ position: 'absolute', left: 14, top: 11, fontSize: 14, fontWeight: 600, color: 'var(--t2)' }}>₹</span>
              <input type="number" value={rechargeAmt} onChange={e => setRechargeAmt(e.target.value)}
                style={{ width: '100%', padding: '10px 14px 10px 28px', borderRadius: 8, background: 'rgba(255,255,255,0.03)', border: '1px solid var(--bd)', color: 'var(--t1)', fontSize: 14, outline: 'none', boxSizing: 'border-box' }} />
            </div>

            <Btn onClick={handleRecharge} disabled={rechargeStatus === 'processing'} style={{ padding: '11px 24px', boxShadow: 'var(--glow)' }}>
              {rechargeStatus === 'processing' ? 'Processing...' : rechargeStatus === 'success' ? 'Recharge Successful!' : 'Recharge Now'}
            </Btn>
          </div>

          {/* Quick Select Buttons */}
          <div style={{ display: 'flex', gap: 8 }}>
            {[1000, 2000, 5000].map(val => (
              <button key={val} onClick={() => setRechargeAmt(val.toString())}
                style={{ padding: '8px 16px', borderRadius: 6, background: 'rgba(255,255,255,0.04)', border: '1px solid var(--bd)', color: 'var(--t2)', fontSize: 12, fontWeight: 600, cursor: 'pointer', transition: 'all 0.15s' }}
                onMouseEnter={e => { e.currentTarget.style.color = 'var(--t1)'; e.currentTarget.style.borderColor = 'var(--t3)'; }}
                onMouseLeave={e => { e.currentTarget.style.color = 'var(--t2)'; e.currentTarget.style.borderColor = 'var(--bd)'; }}>
                + ₹{val.toLocaleString()}
              </button>
            ))}
          </div>
          {rechargeError && <p style={{ fontSize: 12, color: '#f87171', marginTop: 4 }}>{rechargeError}</p>}
          <p style={{ fontSize: 11, color: 'var(--t3)', marginTop: 4 }}>
            Demo mode: recharges credit your wallet through the server ledger without a live payment gateway. Connect a payment provider to enable real charges.
          </p>
        </div>
      ) : (
        <div style={{ ...card, padding: '16px 20px', display: 'flex', gap: 10, alignItems: 'center' }}>
          <I n="alertt" s={16} c="var(--t3)" />
          <p style={{ fontSize: 12.5, color: 'var(--t2)' }}>Recharging the wallet requires a workspace admin.</p>
        </div>
      )}
    </div>
  );

  const renderExpenses = () => (
    <div style={{ ...card, padding: 24, display: 'flex', flexDirection: 'column', gap: 16 }}>
      <h3 style={{ fontFamily: "'Syne',sans-serif", fontSize: 16, fontWeight: 700, color: 'var(--t1)' }}>Transaction History</h3>
      <p style={{ fontSize: 13, color: 'var(--t2)' }}>Real wallet credits and usage deductions from your account ledger.</p>

      {walletTxns.length === 0 ? (
        <div style={{ padding: '32px', textAlign: 'center', color: 'var(--t3)', fontSize: 13, border: '1px solid var(--bd)', borderRadius: 8 }}>
          No transactions yet. Recharge your wallet to get started.
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', border: '1px solid var(--bd)', borderRadius: 8, overflow: 'hidden' }}>
          {walletTxns.map((item, idx, arr) => (
            <div key={item.id} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '14px 18px', borderBottom: idx < arr.length - 1 ? '1px solid var(--bd)' : 'none', background: 'rgba(255,255,255,0.01)' }}>
              <div>
                <p style={{ fontSize: 13, fontWeight: 600, color: 'var(--t1)', marginBottom: 2 }}>{item.reason}</p>
                <p style={{ fontSize: 11, color: 'var(--t3)' }}>{new Date(item.createdAt).toLocaleString('en-IN')}</p>
              </div>
              <div style={{ textAlign: 'right' }}>
                <span style={{ fontSize: 13, fontWeight: 700, color: item.type === 'CREDIT' ? 'var(--green)' : '#f87171' }}>
                  {item.type === 'CREDIT' ? '+' : '-'} ₹ {Number(item.amount).toFixed(2)}
                </span>
                <p style={{ fontSize: 10, color: 'var(--t3)' }}>Bal: ₹ {Number(item.balanceAfter).toFixed(2)}</p>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );

  const renderInsights = () => {
    if (loadingInsights) {
      return <div style={{ color: 'var(--t2)', padding: 24, display: 'flex', justifyContent: 'center' }}>Loading insights...</div>;
    }
    if (insightsError) {
      return <div style={{ color: '#f87171', padding: 24, display: 'flex', justifyContent: 'center' }}>Error loading insights: {insightsError}</div>;
    }

    const { totals = {}, chartData = [] } = insights || {};
    
    // Find the max value for the chart to scale properly
    const maxChartVal = chartData.reduce((max, bar) => Math.max(max, bar.val), 10) || 100;

    return (
      <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
        {/* Metric Cards Row */}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(5, 1fr)', gap: 10 }}>
          {[
            { label: 'Total Paid Messages', val: totals.totalPaidMessages || 0, color: 'var(--green)' },
            { label: 'Utility', val: totals.utility || 0, color: '#a78bfa' },
            { label: 'Marketing', val: totals.marketing || 0, color: '#f59e0b' },
            { label: 'Marketing Lite', val: totals.marketingLite || 0, color: '#0ea5e9' },
            { label: 'Auth Messages', val: totals.authMessages || 0, color: '#f43f5e' }
          ].map((m, idx) => (
            <div key={idx} style={{ ...card, padding: 14, display: 'flex', flexDirection: 'column', gap: 6 }}>
              <span style={{ fontSize: 11, color: 'var(--t3)', fontWeight: 600 }}>{m.label}</span>
              <span style={{ fontFamily: "'Syne',sans-serif", fontSize: 24, fontWeight: 800, color: m.val > 0 ? m.color : 'var(--t1)' }}>{m.val}</span>
            </div>
          ))}
        </div>

        {/* Chart Card */}
        <div style={{ ...card, padding: 24, display: 'flex', flexDirection: 'column', gap: 16 }}>
          <h3 style={{ fontFamily: "'Syne',sans-serif", fontSize: 15, fontWeight: 700, color: 'var(--t1)' }}>Paid Message Analytics</h3>
          
          {/* Custom SVG Bar Chart */}
          <div style={{ width: '100%', height: 200, display: 'flex', alignItems: 'flex-end', justifyContent: 'space-around', paddingBottom: 20, borderBottom: '1px solid var(--bd)' }}>
            {(chartData.length ? chartData : [{ date: '-', val: 0 }]).map((bar, idx) => {
              const pctHeight = (bar.val / maxChartVal) * 100;
              return (
                <div key={idx} style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', flex: 1, gap: 10 }}>
                  {bar.val > 0 && <span style={{ fontSize: 10, color: 'var(--t2)', fontWeight: 600 }}>{bar.val}</span>}
                  <div style={{ width: 36, height: `${pctHeight || 4}px`, background: bar.val > 0 ? 'var(--green)' : 'rgba(255,255,255,0.03)', borderRadius: '4px 4px 0 0', transition: 'height 0.3s ease' }} />
                  <span style={{ fontSize: 10, color: 'var(--t3)', marginTop: 4 }}>{bar.date}</span>
                </div>
              );
            })}
          </div>
        </div>
      </div>
    );
  };

  const renderBilling = () => (
    <div style={{ ...card, padding: 24, display: 'flex', flexDirection: 'column', gap: 20 }}>
      <h3 style={{ fontFamily: "'Syne',sans-serif", fontSize: 16, fontWeight: 700, color: 'var(--t1)' }}>Billing details</h3>
      
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: 16 }}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          <label style={{ fontSize: 11, fontWeight: 600, color: 'var(--t2)', textTransform: 'uppercase', letterSpacing: '.05em' }}>Legal Business Name</label>
          <input value={bizName} onChange={e => setBizName(e.target.value)} placeholder="e.g. Acme Corp" disabled={!isAdmin}
            style={{ padding: '10px 14px', borderRadius: 8, background: 'rgba(255,255,255,0.03)', border: '1px solid var(--bd)', color: 'var(--t1)', fontSize: 13, outline: 'none', opacity: isAdmin ? 1 : 0.6, cursor: isAdmin ? 'text' : 'not-allowed' }} />
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          <label style={{ fontSize: 11, fontWeight: 600, color: 'var(--t2)', textTransform: 'uppercase', letterSpacing: '.05em' }}>Business Email</label>
          <input value={bizEmail} onChange={e => setBizEmail(e.target.value)} placeholder="e.g. billing@acme.com" disabled={!isAdmin}
            style={{ padding: '10px 14px', borderRadius: 8, background: 'rgba(255,255,255,0.03)', border: '1px solid var(--bd)', color: 'var(--t1)', fontSize: 13, outline: 'none', opacity: isAdmin ? 1 : 0.6, cursor: isAdmin ? 'text' : 'not-allowed' }} />
        </div>
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
        <label style={{ fontSize: 11, fontWeight: 600, color: 'var(--t2)', textTransform: 'uppercase', letterSpacing: '.05em' }}>Business Address</label>
        <textarea value={bizAddress} onChange={e => setBizAddress(e.target.value)} placeholder="Full business address..." rows={3} disabled={!isAdmin}
          style={{ width: '100%', padding: '10px 14px', borderRadius: 8, background: 'rgba(255,255,255,0.03)', border: '1px solid var(--bd)', color: 'var(--t1)', fontSize: 13, outline: 'none', resize: 'vertical', opacity: isAdmin ? 1 : 0.6, cursor: isAdmin ? 'text' : 'not-allowed' }} />
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: 16 }}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          <label style={{ fontSize: 11, fontWeight: 600, color: 'var(--t2)', textTransform: 'uppercase', letterSpacing: '.05em' }}>GST / Tax Details</label>
          <input value={gstNum} onChange={e => setGstNum(e.target.value)} placeholder="e.g. 29AAAAA0000A1Z5" disabled={!isAdmin}
            style={{ padding: '10px 14px', borderRadius: 8, background: 'rgba(255,255,255,0.03)', border: '1px solid var(--bd)', color: 'var(--t1)', fontSize: 13, outline: 'none', opacity: isAdmin ? 1 : 0.6, cursor: isAdmin ? 'text' : 'not-allowed' }} />
        </div>
      </div>

      {isAdmin && <div style={{ display: 'flex', gap: 8, borderTop: '1px solid var(--bd)', paddingTop: 16 }}>
        <Btn onClick={handleSaveBilling} style={{ boxShadow: 'var(--glow)' }}>
          {saveStatus === 'success' ? 'Details Saved!' : 'Save Details'}
        </Btn>
      </div>}
    </div>
  );

  const renderSubscription = () => {
    const currentKey = subscription?.plan?.key;
    const messagesUsed = subscription?.usage?.messagesUsed ?? 0;
    const messageQuota = subscription?.plan?.messageQuota ?? 0;
    const unlimited = messageQuota === -1;
    const usagePct = unlimited || messageQuota <= 0 ? 0 : Math.min(100, (messagesUsed / messageQuota) * 100);
    const isActive = subscription?.status === 'ACTIVE';

    return (
      <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
        {/* Current plan */}
        <div style={{ ...card, padding: 24, display: 'flex', flexDirection: 'column', gap: 16 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
            <div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 8 }}>
                <span style={{ fontSize: 13, color: 'var(--t2)' }}>Current Plan</span>
                <span style={{ padding: '2px 8px', borderRadius: 10, fontSize: 10, fontWeight: 600, background: isActive ? 'var(--gbg)' : 'rgba(239,68,68,0.1)', border: `1px solid ${isActive ? 'var(--gbd)' : 'rgba(239,68,68,0.2)'}`, color: isActive ? 'var(--green)' : '#f87171' }}>
                  {subscription?.status || '—'}
                </span>
              </div>
              <h3 style={{ fontFamily: "'Syne',sans-serif", fontSize: 22, fontWeight: 800, color: 'var(--t1)' }}>
                {subscription?.plan?.name || 'Loading…'}
              </h3>
            </div>
            {subscription?.currentPeriodEnd && (
              <div style={{ textAlign: 'right' }}>
                <p style={{ fontSize: 11, color: 'var(--t3)' }}>{subscription.cancelAtPeriodEnd ? 'Cancels on' : 'Renews on'}</p>
                <p style={{ fontSize: 13, fontWeight: 600, color: 'var(--t1)' }}>
                  {new Date(subscription.currentPeriodEnd).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' })}
                </p>
              </div>
            )}
          </div>

          {subscription?.pendingPlan && (
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '10px 14px', borderRadius: 8, background: 'rgba(245,158,11,0.08)', border: '1px solid rgba(245,158,11,0.2)' }}>
              <I n="alertc" s={14} c="#fbbf24" />
              <span style={{ fontSize: 12, color: '#fbbf24' }}>
                Switching to <strong>{subscription.pendingPlan.name}</strong> at the start of your next billing cycle.
              </span>
            </div>
          )}

          <div>
            <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 6 }}>
              <span style={{ fontSize: 12, color: 'var(--t2)' }}>Messages used this cycle</span>
              <span style={{ fontSize: 12, fontWeight: 600, color: 'var(--t1)' }}>
                {messagesUsed.toLocaleString()} / {unlimited ? 'Unlimited' : messageQuota.toLocaleString()}
              </span>
            </div>
            <div style={{ height: 8, borderRadius: 6, background: 'rgba(255,255,255,0.06)', overflow: 'hidden' }}>
              <div style={{ height: '100%', width: `${unlimited ? 4 : usagePct}%`, borderRadius: 6, background: usagePct > 90 ? '#f87171' : usagePct > 70 ? '#fbbf24' : 'var(--green)', transition: 'width .4s' }} />
            </div>
            {!unlimited && usagePct >= 100 && (
              <p style={{ fontSize: 11, color: 'var(--t3)', marginTop: 6 }}>
                Quota exhausted — further messages bill from your wallet at ₹{Number(subscription?.plan?.overageRatePerMsg || 0).toFixed(3)}/message.
              </p>
            )}
          </div>
        </div>

        {checkoutMessage && (
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '12px 16px', borderRadius: 8, background: 'var(--gbg)', border: '1px solid var(--gbd)', color: 'var(--green)', fontSize: 13 }}>
            <I n="checkc" s={14} c="var(--green)" /> {checkoutMessage}
          </div>
        )}
        {checkoutError && (
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '12px 16px', borderRadius: 8, background: 'rgba(239,68,68,0.08)', border: '1px solid rgba(239,68,68,0.2)', color: '#f87171', fontSize: 13 }}>
            <I n="alertt" s={14} c="#f87171" /> {checkoutError}
          </div>
        )}

        {/* Plan catalog */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          <h4 style={{ fontFamily: "'Syne',sans-serif", fontSize: 14, fontWeight: 700, color: 'var(--t1)', textTransform: 'uppercase', letterSpacing: '.05em' }}>Available Plans</h4>

          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: 16 }}>
            {plans.map(plan => {
              const isCurrent = plan.key === currentKey;
              const isPending = subscription?.pendingPlan?.key === plan.key;
              const isFree = Number(plan.priceMonthly) === 0;
              const busy = checkoutPlanId === plan.id;
              return (
                <div key={plan.id} style={{ ...card, padding: 20, display: 'flex', flexDirection: 'column', gap: 12, border: isCurrent ? '1px solid var(--gbd)' : '1px solid var(--bd)' }}>
                  <div>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 4 }}>
                      <h5 style={{ fontFamily: "'Syne',sans-serif", fontSize: 16, fontWeight: 800, color: 'var(--t1)' }}>{plan.name}</h5>
                      {isCurrent && (
                        <span style={{ padding: '2px 8px', borderRadius: 10, fontSize: 10, fontWeight: 600, background: 'var(--gbg)', border: '1px solid var(--gbd)', color: 'var(--green)' }}>Current</span>
                      )}
                    </div>
                    <p style={{ fontSize: 20, fontWeight: 700, color: 'var(--t1)' }}>
                      {isFree ? 'Free' : `₹${Number(plan.priceMonthly).toLocaleString('en-IN')}`}
                      {!isFree && <span style={{ fontSize: 12, fontWeight: 500, color: 'var(--t3)' }}>/month</span>}
                    </p>
                  </div>
                  <ul style={{ listStyle: 'none', display: 'flex', flexDirection: 'column', gap: 6, fontSize: 12, color: 'var(--t2)', padding: 0, margin: 0 }}>
                    <li>{plan.messageQuota === -1 ? 'Unlimited' : plan.messageQuota.toLocaleString()} messages/cycle</li>
                    <li>{plan.contactLimit == null ? 'Unlimited' : plan.contactLimit.toLocaleString()} contacts</li>
                    <li>{plan.memberLimit == null ? 'Unlimited' : plan.memberLimit} team members</li>
                    <li>{plan.apiKeyLimit == null ? 'Unlimited' : plan.apiKeyLimit} API keys</li>
                  </ul>
                  {isAdmin ? (
                    <Btn
                      variant={isCurrent ? 'outline' : 'primary'}
                      disabled={isCurrent || isPending || busy || (isFree && !isCurrent)}
                      onClick={() => handleBuyPlan(plan)}
                      style={{ width: '100%', justifyContent: 'center', marginTop: 4 }}
                    >
                      {isCurrent ? 'Current Plan' : isPending ? 'Scheduled' : busy ? 'Processing…' : isFree ? 'Contact support to downgrade' : 'Buy Now'}
                    </Btn>
                  ) : isCurrent ? (
                    <div style={{ width: '100%', textAlign: 'center', marginTop: 4, padding: '9px 0', borderRadius: 8, border: '1px solid var(--gbd)', background: 'var(--gbg)', color: 'var(--green)', fontSize: 13, fontWeight: 600 }}>
                      Current Plan
                    </div>
                  ) : (
                    <p style={{ fontSize: 11, color: 'var(--t3)', textAlign: 'center', marginTop: 4 }}>Ask a workspace admin to change plans</p>
                  )}
                </div>
              );
            })}
          </div>
          <p style={{ fontSize: 11, color: 'var(--t3)' }}>
            Test mode: payments are processed via Razorpay's test environment — no real charges occur. Plan changes take effect immediately and start a fresh billing cycle.
          </p>
        </div>

        {/* Add-ons Section */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          <h4 style={{ fontFamily: "'Syne',sans-serif", fontSize: 14, fontWeight: 700, color: 'var(--t1)', textTransform: 'uppercase', letterSpacing: '.05em' }}>Available Add-ons</h4>

          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: 16 }}>
            {[
              { id: 'crm', title: 'Sales CRM Add-on', price: '₹1499/month', desc: 'Native lead owners, auto-assignments, pipeline management' },
              { id: 'events', title: 'Pack of 3 Custom Events', price: '₹499/month', desc: 'Track external triggers and coordinate custom actions via Webhook' },
              { id: 'tags', title: 'Pack of 10 Custom Tags', price: '₹499/month', desc: 'Expand categorizations to organize contacts effectively' },
              { id: 'fields', title: 'Pack of 5 Custom Fields', price: '₹499/month', desc: 'Add user traits and extra attributes to contact profiles' }
            ].map(addon => {
              const hasAddon = addons[addon.id];
              return (
                <div key={addon.id} style={{ ...card, padding: 18, display: 'flex', flexDirection: 'column', justifyContent: 'space-between', gap: 14 }}>
                  <div>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 6 }}>
                      <h5 style={{ fontSize: 14, fontWeight: 700, color: 'var(--t1)' }}>{addon.title}</h5>
                      <span style={{ fontSize: 12, fontWeight: 600, color: 'var(--green)' }}>{addon.price}</span>
                    </div>
                    <p style={{ fontSize: 12, color: 'var(--t2)', lineHeight: 1.5 }}>{addon.desc}</p>
                  </div>
                  {isAdmin ? (
                    <Btn variant={hasAddon ? 'outline' : 'primary'} onClick={() => toggleAddon(addon.id)} style={{ width: '100%', borderColor: hasAddon ? '#f8717144' : 'var(--bd)', color: hasAddon ? '#f87171' : '#07090F' }}>
                      {hasAddon ? 'Remove Add-on' : 'Add to Plan'}
                    </Btn>
                  ) : (
                    <div style={{ width: '100%', textAlign: 'center', padding: '9px 0', borderRadius: 8, border: '1px solid var(--bd)', color: 'var(--t3)', fontSize: 12 }}>
                      {hasAddon ? 'Included' : 'Not included'}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      </div>
    );
  };

  const renderInvoices = () => (
    <div style={{ ...card, overflow: 'hidden' }}>
      <table style={{ width: '100%', borderCollapse: 'collapse', textAlign: 'left' }}>
        <thead>
          <tr style={{ borderBottom: '1px solid var(--bd)', background: 'rgba(255,255,255,0.01)' }}>
            {['Date', 'Description', 'Amount', 'Status', 'Invoice'].map(h => (
              <th key={h} style={{ padding: '14px 20px', fontSize: 11, fontWeight: 600, color: 'var(--t3)', textTransform: 'uppercase', letterSpacing: '.05em' }}>{h}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {loadingInvoices && (
            <tr>
              <td colSpan="5" style={{ padding: 32, textAlign: 'center', color: 'var(--t2)' }}>Loading invoices...</td>
            </tr>
          )}
          {!loadingInvoices && invoices.length === 0 && (
            <tr>
              <td colSpan="5" style={{ padding: 32, textAlign: 'center', color: 'var(--t2)' }}>No invoice records found.</td>
            </tr>
          )}
          {!loadingInvoices && invoices.map((inv, idx) => (
            <tr key={inv.id} style={{ borderBottom: idx < invoices.length - 1 ? '1px solid var(--bd)' : 'none' }}>
              <td style={{ padding: '14px 20px', fontSize: 13, color: 'var(--t2)' }}>
                {new Date(inv.invoiceDate).toLocaleDateString('en-IN', {
                  day: '2-digit',
                  month: 'short',
                  year: 'numeric',
                  hour: '2-digit',
                  minute: '2-digit'
                })}
              </td>
              <td style={{ padding: '14px 20px', fontSize: 13, fontWeight: 600, color: 'var(--t1)' }}>
                {inv.description || 'Subscription Charges - renewal'}
              </td>
              <td style={{ padding: '14px 20px', fontSize: 13, fontWeight: 700, color: 'var(--t1)' }}>
                ₹ {inv.amount.toLocaleString('en-IN', { minimumFractionDigits: 2 })}
              </td>
              <td style={{ padding: '14px 20px' }}>
                <span style={{ padding: '2px 8px', borderRadius: 10, fontSize: 11, fontWeight: 600, color: 'var(--green)', background: 'var(--gbg)', border: '1px solid var(--gbd)' }}>
                  {inv.status}
                </span>
              </td>
              <td style={{ padding: '14px 20px' }}>
                <a href="#" onClick={e => e.preventDefault()} style={{ fontSize: 13, color: 'var(--green)', fontWeight: 600, textDecoration: 'none' }}>
                  Download Invoice
                </a>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );

  return (
    <div style={{ flex: 1, display: 'flex', height: '100%', overflow: 'hidden', background: '#060B18' }}>
      
      {/* Subtab Left Sidebar */}
      <div style={{ width: 232, background: 'rgba(255, 255, 255, 0.01)', borderRight: '1px solid var(--bd)', display: 'flex', flexDirection: 'column', flexShrink: 0 }}>
        <div style={{ padding: '24px 20px 14px 20px' }}>
          <h2 style={{ fontFamily: "'Syne',sans-serif", fontWeight: 800, fontSize: 17, color: 'var(--t1)', letterSpacing: '-.02em' }}>Payments</h2>
          <p style={{ fontSize: 11, color: 'var(--t3)', marginTop: 2 }}>Manage funds, plans, and invoices</p>
        </div>

        <div style={{ flex: 1, padding: 8, display: 'flex', flexDirection: 'column', gap: 2 }}>
          {SUB_TABS.map(tab => {
            const on = activeSubTab === tab.id;
            return (
              <div key={tab.id} onClick={() => setActiveSubTab(tab.id)}
                style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '10px 12px', borderRadius: 8, cursor: 'pointer', transition: 'all 0.15s', background: on ? 'rgba(30,191,94,0.1)' : 'transparent' }}
                onMouseEnter={e => { if (!on) e.currentTarget.style.background = 'rgba(255,255,255,0.03)'; }}
                onMouseLeave={e => { if (!on) e.currentTarget.style.background = 'transparent'; }}>
                <I n={tab.icon} s={16} c={on ? 'var(--green)' : 'var(--t2)'} />
                <span style={{ fontSize: 13, fontWeight: on ? 600 : 500, color: on ? 'var(--t1)' : 'var(--t2)' }}>{tab.label}</span>
              </div>
            );
          })}
        </div>
      </div>

      {/* Main Content Area */}
      <div style={{ flex: 1, overflowY: 'auto', padding: '32px' }}>
        <div style={{ maxWidth: 840, margin: '0 auto', display: 'flex', flexDirection: 'column', gap: 24 }}>
          {/* Header */}
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', borderBottom: '1px solid var(--bd)', paddingBottom: 16 }}>
            <h1 style={{ fontFamily: "'Syne',sans-serif", fontSize: 20, fontWeight: 800, color: 'var(--t1)' }}>
              {SUB_TABS.find(t => t.id === activeSubTab)?.label}
            </h1>
          </div>

          {/* Sub-tab view renderer */}
          {activeSubTab === 'wallet' && renderWallet()}
          {activeSubTab === 'expenses' && renderExpenses()}
          {activeSubTab === 'insights' && renderInsights()}
          {activeSubTab === 'billing' && renderBilling()}
          {activeSubTab === 'subscription' && renderSubscription()}
          {activeSubTab === 'invoices' && renderInvoices()}
        </div>
      </div>

    </div>
  );
}
