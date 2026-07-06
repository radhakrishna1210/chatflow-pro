import { useState } from 'react';
import { I } from '../components/Icons.jsx';
import { Btn } from '../components/Btn.jsx';

const card = { background: 'var(--surf)', border: '1px solid var(--bd)', borderRadius: 'var(--rl)', boxShadow: 'var(--card-shadow)' };

const DashHeader = ({ title, subtitle }) => (
  <div style={{ height: '58px', borderBottom: '1px solid var(--bd)', display: 'flex', alignItems: 'center', padding: '0 28px', gap: '16px', flexShrink: 0, background: 'var(--surf)' }}>
    <div style={{ flex: 1 }}>
      <h1 style={{ fontFamily: "'Syne',sans-serif", fontWeight: 800, fontSize: '16px', color: 'var(--t1)', letterSpacing: '-.02em' }}>{title}</h1>
      {subtitle && <p style={{ fontSize: '11.5px', color: 'var(--t2)', marginTop: '1px' }}>{subtitle}</p>}
    </div>
  </div>
);

const CodeBlock = ({ children, lang = 'bash' }) => (
  <div style={{
    background: '#0A0E1A', border: '1px solid var(--bd)', borderRadius: 10,
    padding: '14px 16px', fontFamily: "'JetBrains Mono', 'Fira Code', monospace",
    fontSize: 12.5, color: '#a5d6ff', lineHeight: 1.7,
    overflowX: 'auto', position: 'relative',
  }}>
    <span style={{
      position: 'absolute', top: 8, right: 10, fontSize: 9, fontWeight: 700,
      color: 'var(--t3)', textTransform: 'uppercase', letterSpacing: '.08em',
    }}>{lang}</span>
    <pre style={{ margin: 0, whiteSpace: 'pre-wrap', wordBreak: 'break-all' }}>{children}</pre>
  </div>
);

const ENDPOINTS = [
  {
    method: 'POST',
    path: '/api/v1/marketing/campaigns',
    desc: 'Create a new marketing campaign',
    body: `{
  "name": "Summer Sale 2026",
  "templateId": "tpl_abc123",
  "segmentId": "seg_xyz789",
  "scheduledAt": "2026-07-15T10:00:00Z"
}`,
  },
  {
    method: 'GET',
    path: '/api/v1/marketing/campaigns',
    desc: 'List all marketing campaigns with stats',
    body: null,
  },
  {
    method: 'POST',
    path: '/api/v1/marketing/templates',
    desc: 'Submit a new message template to Meta',
    body: `{
  "name": "order_confirmation_v2",
  "category": "UTILITY",
  "language": "en",
  "components": [
    { "type": "BODY", "text": "Hi {{1}}, your order #{{2}} is confirmed!" }
  ]
}`,
  },
  {
    method: 'GET',
    path: '/api/v1/marketing/contacts',
    desc: 'Retrieve all contacts with tags and segments',
    body: null,
  },
  {
    method: 'POST',
    path: '/api/v1/marketing/messages/send',
    desc: 'Send a single templated message',
    body: `{
  "to": "+919800112345",
  "templateName": "order_confirmation_v2",
  "params": ["Priya", "CFP-7821"]
}`,
  },
];

const METHOD_COLORS = {
  GET: '#1EBF5E',
  POST: '#0EA5E9',
  PUT: '#F59E0B',
  DELETE: '#EF4444',
  PATCH: '#A78BFA',
};

export default function MarketingApiPage() {
  const [expanded, setExpanded] = useState(null);

  return (
    <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
      <DashHeader title="Marketing API" subtitle="API endpoints for programmatic marketing" />
      <div style={{ flex: 1, overflowY: 'auto', padding: '24px 28px' }}>
        <div style={{ maxWidth: 800 }}>

          {/* Hero */}
          <div style={{
            ...card, padding: '24px', marginBottom: 24,
            background: 'linear-gradient(135deg, rgba(30,191,94,0.05), rgba(14,165,233,0.03))',
          }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 14, marginBottom: 14 }}>
              <div style={{
                width: 48, height: 48, borderRadius: 14,
                background: 'linear-gradient(135deg, var(--green), #0EA5E9)',
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                boxShadow: '0 8px 24px rgba(30,191,94,0.25)',
              }}>
                <I n="code2" s={22} c="#fff" w={2} />
              </div>
              <div>
                <h2 style={{ fontFamily: "'Syne',sans-serif", fontWeight: 800, fontSize: 18, color: 'var(--t1)', letterSpacing: '-.02em' }}>Marketing API</h2>
                <p style={{ fontSize: 13, color: 'var(--t2)' }}>Automate campaigns, templates, and messaging via REST endpoints</p>
              </div>
            </div>

            <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
              <div style={{ padding: '8px 14px', borderRadius: 8, background: 'rgba(255,255,255,0.04)', border: '1px solid var(--bd)', fontSize: 12, color: 'var(--t2)' }}>
                <span style={{ color: 'var(--t3)' }}>Base URL:</span> <code style={{ color: 'var(--green)' }}>https://api.chatflowpro.com/v1</code>
              </div>
              <div style={{ padding: '8px 14px', borderRadius: 8, background: 'rgba(255,255,255,0.04)', border: '1px solid var(--bd)', fontSize: 12, color: 'var(--t2)' }}>
                <span style={{ color: 'var(--t3)' }}>Auth:</span> <code style={{ color: '#A78BFA' }}>Bearer &lt;API_KEY&gt;</code>
              </div>
              <div style={{ padding: '8px 14px', borderRadius: 8, background: 'rgba(255,255,255,0.04)', border: '1px solid var(--bd)', fontSize: 12, color: 'var(--t2)' }}>
                <span style={{ color: 'var(--t3)' }}>Rate Limit:</span> <code style={{ color: '#F59E0B' }}>100 req/min</code>
              </div>
            </div>
          </div>

          {/* Usage stats */}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 14, marginBottom: 24 }}>
            {[
              { label: 'API Calls Today', value: '1,247', color: '#1EBF5E' },
              { label: 'Avg Latency', value: '124ms', color: '#0EA5E9' },
              { label: 'Success Rate', value: '99.8%', color: '#A78BFA' },
            ].map(s => (
              <div key={s.label} style={{ ...card, padding: 16, textAlign: 'center' }}>
                <p style={{ fontSize: 10, fontWeight: 700, color: 'var(--t3)', textTransform: 'uppercase', letterSpacing: '.08em', marginBottom: 6 }}>{s.label}</p>
                <p style={{ fontFamily: "'Syne',sans-serif", fontWeight: 800, fontSize: 20, color: s.color }}>{s.value}</p>
              </div>
            ))}
          </div>

          {/* Endpoints */}
          <div style={{ ...card, overflow: 'hidden' }}>
            <div style={{ padding: '16px 20px', borderBottom: '1px solid var(--bd)', display: 'flex', alignItems: 'center', gap: 10 }}>
              <I n="code2" s={16} c="var(--green)" />
              <span style={{ fontFamily: "'Syne',sans-serif", fontWeight: 700, fontSize: 15, color: 'var(--t1)' }}>API Endpoints</span>
            </div>
            {ENDPOINTS.map((ep, i) => {
              const isOpen = expanded === i;
              const methodColor = METHOD_COLORS[ep.method] || 'var(--t2)';
              return (
                <div key={i}>
                  <div
                    onClick={() => setExpanded(isOpen ? null : i)}
                    style={{
                      display: 'flex', alignItems: 'center', gap: 12,
                      padding: '14px 20px', cursor: 'pointer',
                      borderBottom: '1px solid rgba(255,255,255,0.04)',
                      transition: 'background .12s',
                    }}
                    onMouseEnter={e => e.currentTarget.style.background = 'rgba(255,255,255,0.015)'}
                    onMouseLeave={e => e.currentTarget.style.background = 'transparent'}
                  >
                    <span style={{
                      padding: '3px 8px', borderRadius: 5, fontSize: 10, fontWeight: 800,
                      background: `${methodColor}15`, border: `1px solid ${methodColor}30`,
                      color: methodColor, letterSpacing: '.04em', fontFamily: 'monospace',
                      minWidth: 44, textAlign: 'center',
                    }}>{ep.method}</span>
                    <code style={{ fontSize: 13, color: 'var(--t1)', fontFamily: 'monospace', flex: 1 }}>{ep.path}</code>
                    <span style={{ fontSize: 12, color: 'var(--t3)' }}>{ep.desc}</span>
                    <I n="arrow" s={12} c="var(--t3)" />
                  </div>
                  {isOpen && ep.body && (
                    <div style={{ padding: '0 20px 16px', animation: 'fadeUp .2s ease both' }}>
                      <p style={{ fontSize: 11, color: 'var(--t3)', marginBottom: 6, fontWeight: 600 }}>Example Request Body</p>
                      <CodeBlock lang="json">{ep.body}</CodeBlock>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      </div>
    </div>
  );
}
