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

const PLAN_FEATURES = [
  { label: 'WhatsApp Messages', value: '50,000 / month', included: true },
  { label: 'Team Members', value: 'Up to 10', included: true },
  { label: 'Automation Workflows', value: 'Unlimited', included: true },
  { label: 'AI Smart Replies', value: 'Included', included: true },
  { label: 'Template Library', value: 'Full Access', included: true },
  { label: 'API Access', value: 'Included', included: true },
  { label: 'Priority Support', value: '24/7', included: true },
  { label: 'Custom Integrations', value: '5 slots', included: true },
  { label: 'A/B Testing', value: 'Not Available', included: false },
  { label: 'White-label', value: 'Not Available', included: false },
];

export default function SubscriptionPage() {
  const [showUpgrade, setShowUpgrade] = useState(false);
  const [plan, setPlan] = useState('GROWTH');
  const [usage, setUsage] = useState({ messages: 0, members: 0, workflows: 0 });
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    wFetch('/settings/subscription')
      .then(r => r.ok ? r.json() : Promise.reject())
      .then(data => {
        if (data) {
          setPlan(data.plan);
          if (data.usage) setUsage(data.usage);
        }
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  if (loading) {
    return (
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
        <DashHeader title="Subscription" subtitle="Manage your plan and billing" />
        <div style={{ textAlign: 'center', padding: '48px', color: 'var(--t2)', fontSize: 13 }}>
          <div style={{ width: 24, height: 24, border: '2px solid var(--green)', borderTopColor: 'transparent', borderRadius: '50%', margin: '0 auto 10px', animation: 'spin 1s linear infinite' }} />
          Loading subscription details…
        </div>
      </div>
    );
  }

  const isFree = plan === 'FREE';
  const planLabel = isFree ? 'Free Plan' : 'Growth Plan';
  const maxMessages = isFree ? 1000 : 50000;
  const maxMembers = isFree ? 2 : 10;
  const maxWorkflows = isFree ? 5 : 999;

  return (
    <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
      <DashHeader title="Subscription" subtitle="Manage your plan and billing" />
      <div style={{ flex: 1, overflowY: 'auto', padding: '24px 28px' }}>

        {/* Current Plan Card */}
        <div style={{
          ...card, padding: 0, marginBottom: 24, overflow: 'hidden',
          background: 'linear-gradient(135deg, rgba(30,191,94,0.05), rgba(167,139,250,0.03))',
        }}>
          <div style={{ padding: '24px 24px 20px', display: 'flex', alignItems: 'flex-start', gap: 20, flexWrap: 'wrap' }}>
            <div style={{
              width: 56, height: 56, borderRadius: 14,
              background: 'linear-gradient(135deg, var(--green), #0EA5E9)',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              boxShadow: '0 8px 24px rgba(30,191,94,0.3)',
              flexShrink: 0,
            }}>
              <I n="subscription" s={24} c="#fff" w={2} />
            </div>
            <div style={{ flex: 1, minWidth: 200 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 6 }}>
                <h2 style={{ fontFamily: "'Syne',sans-serif", fontWeight: 800, fontSize: 20, color: 'var(--t1)', letterSpacing: '-.02em' }}>{planLabel}</h2>
                <span style={{
                  padding: '4px 12px', borderRadius: 20, fontSize: 10, fontWeight: 800,
                  background: 'linear-gradient(135deg, rgba(30,191,94,0.15), rgba(30,191,94,0.08))',
                  border: '1px solid rgba(30,191,94,0.3)',
                  color: '#4ade80', letterSpacing: '.05em', textTransform: 'uppercase',
                }}>ACTIVE</span>
              </div>
              <p style={{ fontSize: 13, color: 'var(--t2)', lineHeight: 1.5 }}>
                Your subscription renews automatically. You have full access to {planLabel} tier features.
              </p>
            </div>
            <div style={{ textAlign: 'right', minWidth: 140 }}>
              <p style={{ fontFamily: "'Syne',sans-serif", fontWeight: 800, fontSize: 28, color: 'var(--t1)', letterSpacing: '-.03em' }}>
                {isFree ? '₹0' : '₹2,999'}<span style={{ fontSize: 14, fontWeight: 500, color: 'var(--t2)' }}>/mo</span>
              </p>
            </div>
          </div>

          {/* Plan meta */}
          <div style={{ padding: '16px 24px', borderTop: '1px solid rgba(255,255,255,0.06)', display: 'flex', gap: 24, flexWrap: 'wrap' }}>
            {[
              { label: 'Billing Cycle', value: 'Monthly', icon: 'clock' },
              { label: 'Renewal Date', value: 'Aug 1, 2026', icon: 'clock' },
              { label: 'Seats Used', value: `${usage.members} / ${maxMembers}`, icon: 'users' },
              { label: 'Status', value: 'Active', icon: 'check', isGreen: true },
            ].map(m => (
              <div key={m.label} style={{ display: 'flex', alignItems: 'center', gap: 8, flex: '1 1 150px' }}>
                <I n={m.icon} s={14} c={m.isGreen ? 'var(--green)' : 'var(--t3)'} />
                <div>
                  <p style={{ fontSize: 10, fontWeight: 600, color: 'var(--t3)', textTransform: 'uppercase', letterSpacing: '.06em' }}>{m.label}</p>
                  <p style={{ fontSize: 13, fontWeight: 700, color: m.isGreen ? 'var(--green)' : 'var(--t1)' }}>{m.value}</p>
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* Usage */}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: 14, marginBottom: 24 }}>
          {[
            { label: 'Messages Used', current: usage.messages, max: maxMessages, color: '#1EBF5E' },
            { label: 'Team Seats', current: usage.members, max: maxMembers, color: '#0EA5E9' },
            { label: 'Workflows', current: usage.workflows, max: maxWorkflows, color: '#A78BFA' },
          ].map(u => {
            const pct = Math.min((u.current / u.max) * 100, 100);
            return (
              <div key={u.label} style={{ ...card, padding: 20 }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
                  <p style={{ fontSize: 11, fontWeight: 700, color: 'var(--t3)', textTransform: 'uppercase', letterSpacing: '.08em' }}>{u.label}</p>
                  <span style={{ fontSize: 12, fontWeight: 700, color: u.color }}>
                    {u.max === 999 ? 'Unlimited' : `${pct.toFixed(0)}%`}
                  </span>
                </div>
                <p style={{ fontFamily: "'Syne',sans-serif", fontWeight: 800, fontSize: 20, color: 'var(--t1)', marginBottom: 10 }}>
                  {u.current.toLocaleString()} <span style={{ fontSize: 13, fontWeight: 500, color: 'var(--t2)' }}>/ {u.max === 999 ? '∞' : u.max.toLocaleString()}</span>
                </p>
                <div style={{ width: '100%', height: 6, borderRadius: 6, background: 'rgba(255,255,255,0.06)' }}>
                  <div style={{ height: '100%', width: `${u.max === 999 ? 15 : pct}%`, borderRadius: 6, background: u.color, transition: 'width .5s ease', boxShadow: `0 0 10px ${u.color}40` }} />
                </div>
              </div>
            );
          })}
        </div>

        {/* Features */}
        <div style={{ ...card, overflow: 'hidden', marginBottom: 24 }}>
          <div style={{ padding: '16px 20px', borderBottom: '1px solid var(--bd)', display: 'flex', alignItems: 'center', gap: 10 }}>
            <I n="spark" s={16} c="var(--green)" />
            <span style={{ fontFamily: "'Syne',sans-serif", fontWeight: 700, fontSize: 15, color: 'var(--t1)' }}>Plan Features</span>
          </div>
          <div style={{ padding: 20 }}>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))', gap: 8 }}>
              {PLAN_FEATURES.map(f => (
                <div key={f.label} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '10px 12px', borderRadius: 8, background: 'rgba(255,255,255,0.02)' }}>
                  <I n={f.included ? 'check' : 'x'} s={14} c={f.included ? 'var(--green)' : 'var(--t3)'} />
                  <span style={{ flex: 1, fontSize: 13, color: f.included ? 'var(--t1)' : 'var(--t3)' }}>{f.label}</span>
                  <span style={{ fontSize: 12, fontWeight: 600, color: f.included ? 'var(--t2)' : 'var(--t3)' }}>{f.value}</span>
                </div>
              ))}
            </div>
          </div>
        </div>

        {/* Actions */}
        <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
          <Btn style={{ boxShadow: 'var(--glow)' }}>
            <I n="spark" s={14} c="#060A10" /> Upgrade to Enterprise
          </Btn>
          <Btn variant="outline">
            <I n="cog" s={14} c="var(--t2)" /> Manage Subscription
          </Btn>
          <Btn variant="ghost">
            <I n="download" s={14} c="var(--t1)" /> Download Invoice
          </Btn>
        </div>
      </div>
    </div>
  );
}
