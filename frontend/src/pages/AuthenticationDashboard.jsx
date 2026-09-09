import React, { useEffect, useRef, useState } from 'react';

import { wFetch } from '../lib/api.js';
import { I } from '../components/Icons.jsx';
import { Btn } from '../components/Btn.jsx';
import MobileNavButton from '../components/MobileNavButton.jsx';
// The exact same template builder/editor, live preview and preview modal the
// normal Templates page uses — reused here rather than a second
// implementation, per the "Authentication is a self-contained module" rule.
import { TemplateModal } from '../components/TemplateModal.jsx';
import { TemplatePreviewModal } from '../components/TemplatePreviewModal.jsx';
import { StatusBadge } from '../components/StatusBadge.jsx';
import { statusLabel } from '../lib/templateHelpers.js';
import { fmtDate } from '../lib/formatters.js';

function getErrorMessage(data, fallback) {
  return (
    data?.error ||
    data?.message ||
    fallback
  );
}

function formatPhone(number) {
  if (!number) return 'Not configured';

  return number;
}

function maskApiKey(key) {
  if (!key) return 'Not generated';

  if (key.length <= 12) {
    return `${key.slice(0, Math.min(8, key.length))}********`;
  }

  return `${key.slice(0, 12)}••••••••${key.slice(-4)}`;
}

const card = { background: 'var(--surf)', border: '1px solid var(--bd)', borderRadius: 'var(--rl)', boxShadow: 'var(--card-shadow)' };

// Authentication's own page background — deep navy/blue instead of the app's
// default near-black, scoped to this page only (applied inline, not to the
// shared --bg/--surf tokens every other page also uses). Cards above keep
// using --surf as-is, which is lighter than this, so they stay clearly
// visible without any card styling changing.
const authPageBackground =
  'radial-gradient(ellipse 900px 500px at 50% -10%, rgba(53,232,242,0.06), transparent 60%), ' +
  'linear-gradient(165deg, #060a13 0%, #0a1119 45%, #05070d 100%)';

const mono = "'JetBrains Mono', ui-monospace, SFMono-Regular, Menlo, Consolas, monospace";

// ─── Small shared pieces, styled to match the rest of the dashboard ──────────

const StatusPill = ({ enabled }) => (
  <div style={{
    display: 'inline-flex', alignItems: 'center', gap: 8,
    padding: '8px 14px', borderRadius: 999, fontSize: 12.5, fontWeight: 700,
    fontFamily: "'Manrope',sans-serif", flexShrink: 0,
    background: enabled ? 'var(--sbg)' : 'rgba(255,255,255,0.04)',
    border: `1px solid ${enabled ? 'var(--sbd)' : 'var(--bd)'}`,
    color: enabled ? 'var(--success)' : 'var(--t2)',
  }}>
    <span style={{
      width: 7, height: 7, borderRadius: '50%',
      background: enabled ? 'var(--success)' : 'var(--t3)',
      boxShadow: enabled ? '0 0 8px var(--success)' : 'none',
    }} />
    {enabled ? 'Enabled' : 'Disabled'}
  </div>
);

const AlertBanner = ({ type = 'error', children }) => {
  const cfg = type === 'success'
    ? { bg: 'var(--sbg)', bd: 'var(--sbd)', c: 'var(--success)', icon: 'checkc' }
    : { bg: 'rgba(239,68,68,0.08)', bd: 'rgba(239,68,68,0.22)', c: '#fca5a5', icon: 'alertt' };

  return (
    <div style={{
      display: 'flex', alignItems: 'flex-start', gap: 10,
      padding: '13px 16px', borderRadius: 'var(--r)',
      background: cfg.bg, border: `1px solid ${cfg.bd}`,
      color: cfg.c, fontSize: 13, lineHeight: 1.5,
    }}>
      <I n={cfg.icon} s={15} c={cfg.c} />
      <span style={{ flex: 1 }}>{children}</span>
    </div>
  );
};

const SectionHeader = ({ icon, title, description, right }) => (
  <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 16, marginBottom: 20, flexWrap: 'wrap' }}>
    <div style={{ display: 'flex', alignItems: 'flex-start', gap: 11 }}>
      <div style={{ width: 32, height: 32, borderRadius: 8, background: 'var(--gbg)', border: '1px solid var(--gbd)', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0, marginTop: 1 }}>
        <I n={icon} s={15} c="var(--green)" />
      </div>
      <div>
        <h2 style={{ margin: 0, fontFamily: "'Space Grotesk',sans-serif", fontWeight: 700, fontSize: 15.5, color: 'var(--t1)' }}>{title}</h2>
        {description && <p style={{ margin: '5px 0 0', fontSize: 12.5, color: 'var(--t2)', lineHeight: 1.5, maxWidth: 480 }}>{description}</p>}
      </div>
    </div>
    {right}
  </div>
);

const Toggle = ({ checked, onChange, label }) => (
  <label style={{ display: 'flex', alignItems: 'center', gap: 10, cursor: 'pointer', userSelect: 'none' }}>
    <span style={{ position: 'relative', width: 38, height: 22, borderRadius: 999, flexShrink: 0, transition: 'all .18s', background: checked ? 'var(--sbg)' : 'rgba(255,255,255,0.06)', border: `1px solid ${checked ? 'var(--sbd)' : 'var(--bd)'}` }}>
      <input type="checkbox" checked={checked} onChange={onChange} aria-label={label} style={{ position: 'absolute', inset: 0, opacity: 0, margin: 0, cursor: 'pointer' }} />
      <span style={{ position: 'absolute', top: 2, left: checked ? 18 : 2, width: 16, height: 16, borderRadius: '50%', transition: 'all .18s', background: checked ? 'var(--success)' : 'var(--t3)' }} />
    </span>
    <span style={{ fontSize: 13, fontWeight: 600, color: 'var(--t1)', fontFamily: "'Manrope',sans-serif" }}>{label}</span>
  </label>
);

// Copy button used both for the API key and every documentation code block.
// Clicking it flips to a green "✓ Copied" state with a small toast, then
// reverts on its own — the clipboard write itself is unchanged either way.
const CopyButton = ({ text, label = 'Copy', message = 'Copied to clipboard', small = false, onError }) => {
  const [copied, setCopied] = useState(false);
  const timeoutRef = useRef(null);

  useEffect(() => () => { if (timeoutRef.current) clearTimeout(timeoutRef.current); }, []);

  const handleCopy = async () => {
    if (!text) return;

    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      if (timeoutRef.current) clearTimeout(timeoutRef.current);
      timeoutRef.current = setTimeout(() => setCopied(false), 2500);
    } catch {
      onError?.();
    }
  };

  return (
    <span style={{ position: 'relative', display: 'inline-flex' }}>
      <button
        type="button"
        onClick={handleCopy}
        style={{
          display: 'inline-flex', alignItems: 'center', gap: 6,
          padding: small ? '5px 10px' : '7px 13px',
          borderRadius: 7, fontSize: small ? 11.5 : 12.5, fontWeight: 600,
          fontFamily: "'Manrope',sans-serif", cursor: 'pointer', transition: 'all .15s',
          border: `1px solid ${copied ? 'var(--sbd)' : 'var(--bd)'}`,
          background: copied ? 'var(--sbg)' : 'rgba(255,255,255,0.04)',
          color: copied ? 'var(--success)' : 'var(--t2)',
        }}
      >
        <I n={copied ? 'check' : 'copy'} s={small ? 11 : 12} c={copied ? 'var(--success)' : 'var(--t2)'} />
        {copied ? 'Copied' : label}
      </button>

      {copied && (
        <span style={{
          position: 'absolute', top: 'calc(100% + 7px)', right: 0, whiteSpace: 'nowrap', zIndex: 5,
          padding: '6px 10px', borderRadius: 7, fontSize: 11.5, fontWeight: 600,
          background: 'var(--sbg)', border: '1px solid var(--sbd)', color: 'var(--success)',
          boxShadow: '0 8px 20px rgba(0,0,0,0.35)',
        }}>
          {message}
        </span>
      )}
    </span>
  );
};

const CodeBlock = ({ title, code, copyMessage }) => (
  <div style={{ marginTop: 14 }}>
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 7 }}>
      <span style={{ fontSize: 11, fontWeight: 700, color: 'var(--t3)', textTransform: 'uppercase', letterSpacing: '.07em' }}>{title}</span>
      <CopyButton text={code} small message={copyMessage || 'Copied to clipboard'} />
    </div>
    <pre style={{ margin: 0, padding: '13px 15px', borderRadius: 9, background: 'rgba(0,0,0,0.35)', border: '1px solid var(--bd)', overflowX: 'auto', fontFamily: mono, fontSize: 12, lineHeight: 1.65, color: 'var(--t1)', whiteSpace: 'pre' }}>
      {code}
    </pre>
  </div>
);

const ENDPOINTS = [
  {
    id: 'generate',
    method: 'POST',
    path: '/api/v1/authentication/generate',
    description: 'Generate and send a secure WhatsApp OTP.',
    headers: 'x-api-key: YOUR_AUTHENTICATION_API_KEY\nContent-Type: application/json',
    body: '{\n  "to": "+919876543210"\n}',
    example: `POST /api/v1/authentication/generate
x-api-key: YOUR_AUTHENTICATION_API_KEY
Content-Type: application/json
{
  "to": "+919876543210"
}`,
  },
  {
    id: 'verify',
    method: 'POST',
    path: '/api/v1/authentication/verify',
    description: 'Verify a customer-submitted OTP code.',
    headers: 'x-api-key: YOUR_AUTHENTICATION_API_KEY\nContent-Type: application/json',
    body: '{\n  "phone": "+919876543210",\n  "code": "123456"\n}',
    example: `POST /api/v1/authentication/verify
x-api-key: YOUR_AUTHENTICATION_API_KEY
Content-Type: application/json
{
  "phone": "+919876543210",
  "code": "123456"
}`,
  },
];

const EndpointCard = ({ endpoint, open, onToggle }) => (
  <div style={{ border: '1px solid var(--bd)', borderRadius: 10, overflow: 'hidden', background: 'rgba(255,255,255,0.015)' }}>
    <button
      type="button"
      onClick={onToggle}
      aria-expanded={open}
      style={{
        width: '100%', display: 'flex', alignItems: 'center', gap: 12,
        padding: '13px 16px', background: 'transparent', border: 'none', cursor: 'pointer',
        textAlign: 'left', fontFamily: "'Manrope',sans-serif",
      }}
    >
      <span style={{ fontSize: 10.5, fontWeight: 800, letterSpacing: '.04em', color: 'var(--green)', background: 'var(--gbg)', border: '1px solid var(--gbd)', borderRadius: 6, padding: '4px 8px', flexShrink: 0 }}>
        {endpoint.method}
      </span>
      <code style={{ fontFamily: mono, fontSize: 13, color: 'var(--t1)', flexShrink: 0 }}>{endpoint.path}</code>
      <span style={{ fontSize: 12, color: 'var(--t3)', flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{endpoint.description}</span>
      <span style={{ display: 'inline-flex', flexShrink: 0, transform: open ? 'rotate(90deg)' : 'rotate(0deg)', transition: 'transform .15s' }}>
        <I n="arrow" s={12} c="var(--t2)" />
      </span>
    </button>

    {open && (
      <div style={{ padding: '4px 16px 18px', borderTop: '1px solid var(--bd)' }}>
        <CodeBlock title="Headers" code={endpoint.headers} copyMessage="Headers copied to clipboard" />
        <CodeBlock title="Request Body" code={endpoint.body} copyMessage="Request body copied to clipboard" />
        <CodeBlock title="Example Request" code={endpoint.example} copyMessage="Example copied to clipboard" />
      </div>
    )}
  </div>
);

const selectFieldStyle = {
  width: '100%', boxSizing: 'border-box', padding: '10px 12px', borderRadius: 8,
  background: 'rgba(255,255,255,0.04)', border: '1px solid var(--bd)', color: 'var(--t1)',
  fontSize: 13.5, fontFamily: "'Manrope',sans-serif", outline: 'none', cursor: 'pointer',
};

// Tabs, styled like the segmented pill control already used elsewhere in the
// dashboard (e.g. the Campaign Analytics view), so Authentication's own
// Overview / Templates / Analytics areas read as one product area rather than
// three unrelated pages.
const TABS = [
  { id: 'overview',  label: 'Overview' },
  { id: 'templates', label: 'Templates' },
  { id: 'analytics', label: 'Analytics' },
];

const TabBar = ({ active, onChange }) => (
  <div style={{ display: 'inline-flex', padding: 4, gap: 4, border: '1px solid var(--bd)', borderRadius: 10, background: 'rgba(255,255,255,.02)' }}>
    {TABS.map(t => {
      const on = active === t.id;
      return (
        <button key={t.id} onClick={() => onChange(t.id)} style={{ border: 0, borderRadius: 7, padding: '8px 14px', cursor: 'pointer', fontSize: 12, fontWeight: 700, transition: 'all .15s', color: on ? '#071015' : 'var(--t2)', background: on ? 'var(--green)' : 'transparent', boxShadow: on ? '0 0 18px rgba(53,232,242,0.35)' : 'none' }}>
          {t.label}
        </button>
      );
    })}
  </div>
);

// Moved from Dashboard.jsx's CampaignsView (was the "Authentication" tab on
// Campaign Analytics) as-is — same /authentication/analytics endpoint, same
// metrics, same table — just reached from the Authentication module now, so
// Campaign Analytics covers regular campaigns only.
const AuthenticationAnalyticsPanel = () => {
  const [usage, setUsage] = useState(null);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState('');
  const [search, setSearch] = useState('');

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setErr('');
    wFetch('/authentication/analytics')
      .then(async (res) => {
        const data = await res.json();
        if (!res.ok) throw new Error(getErrorMessage(data, 'Failed to load Authentication usage'));
        if (!cancelled) setUsage(data);
      })
      .catch((e) => { if (!cancelled) setErr(e.message); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, []);

  if (loading) return <div style={{ textAlign: 'center', padding: '48px', color: 'var(--t2)', fontSize: 13 }}>Loading Authentication usage…</div>;
  if (err) return <AlertBanner type="error">{err}</AlertBanner>;

  const metrics = usage?.metrics || {};
  const q = search.trim().toLowerCase();
  const attempts = (usage?.recent || []).filter((attempt) => !q || [attempt.templateName, attempt.campaignName, attempt.source, attempt.status].some((value) => String(value || '').toLowerCase().includes(q)));

  return (
    <>
      <input
        value={search}
        onChange={(e) => setSearch(e.target.value)}
        placeholder="Search Authentication attempts…"
        style={{ ...selectFieldStyle, cursor: 'text', maxWidth: 320, marginBottom: 16 }}
      />
      <div className="rgrid-3" style={{ display: 'grid', gridTemplateColumns: 'repeat(3,1fr)', gap: 10, marginBottom: 16 }}>
        {[
          ['OTP Requests', metrics.otpRequests], ['Accepted by WhatsApp', metrics.acceptedByWhatsApp], ['Delivered', metrics.delivered],
          ['Verified', metrics.verified], ['Expired', metrics.expired], ['Failed', metrics.failed],
          ['Verification Rate', metrics.verificationRate == null ? null : `${metrics.verificationRate}%`], ['Cost', metrics.cost == null ? null : `₹${Number(metrics.cost).toFixed(2)}`],
        ].map(([label, value]) => (
          <div key={label} style={{ padding: '12px 14px', borderRadius: 10, background: 'rgba(255,255,255,.02)', border: '1px solid var(--bd)' }}>
            <p style={{ fontSize: 10, fontWeight: 700, color: 'var(--t3)', textTransform: 'uppercase', letterSpacing: '.06em', marginBottom: 4 }}>{label}</p>
            <p style={{ fontFamily: "'Space Grotesk',sans-serif", fontWeight: 800, fontSize: 18, color: 'var(--t1)' }}>{value == null ? '—' : value.toLocaleString?.() ?? value}</p>
          </div>
        ))}
      </div>
      {metrics.deliveryTrackingAvailable === false && (
        <p style={{ margin: '-6px 0 16px', fontSize: 12, color: 'var(--t3)' }}>
          Delivery is unavailable for direct Authentication API sends because no delivery receipt is stored for their transaction records.
        </p>
      )}
      <div style={{ borderRadius: 10, padding: '16px 18px', background: 'rgba(0,0,0,0.35)', border: '1px solid var(--bd)', overflowX: 'auto' }}>
        <p style={{ fontSize: 11, fontWeight: 700, color: 'var(--t2)', textTransform: 'uppercase', letterSpacing: '.08em', marginBottom: 10 }}>Recent Authentication attempts</p>
        {attempts.length === 0 ? (
          <p style={{ fontSize: 13, color: 'var(--t2)', padding: '16px 0' }}>{q ? 'No Authentication attempts match your search.' : 'No Authentication API or campaign OTP attempts yet.'}</p>
        ) : (
          <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: 650 }}>
            <thead>
              <tr style={{ borderBottom: '1px solid var(--bd)' }}>
                {['Source', 'Template', 'Status', 'Accepted', 'Created', 'Verified'].map((label) => (
                  <th key={label} style={{ padding: '10px 12px', textAlign: 'left', fontSize: 11, fontWeight: 700, color: 'var(--t2)', textTransform: 'uppercase' }}>{label}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {attempts.map((attempt) => (
                <tr key={attempt.id} style={{ borderBottom: '1px solid var(--bd)' }}>
                  <td style={{ padding: '11px 12px', fontSize: 12, color: 'var(--t2)' }}>{attempt.source === 'API' ? 'API' : `Campaign${attempt.campaignName ? ` · ${attempt.campaignName}` : ''}`}</td>
                  <td style={{ padding: '11px 12px', fontSize: 12, color: 'var(--t1)' }}>{attempt.templateName || '—'}</td>
                  <td style={{ padding: '11px 12px' }}><StatusBadge s={attempt.status} /></td>
                  <td style={{ padding: '11px 12px', fontSize: 12, color: 'var(--t2)' }}>{attempt.acceptedByWhatsApp ? 'Yes' : '—'}</td>
                  <td style={{ padding: '11px 12px', fontSize: 12, color: 'var(--t2)' }}>{fmtDate(attempt.createdAt)}</td>
                  <td style={{ padding: '11px 12px', fontSize: 12, color: 'var(--t2)' }}>{fmtDate(attempt.verifiedAt)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </>
  );
};

// The Authentication module's own template list — create, edit and preview
// all reuse the normal Templates page's builder/editor and preview modal;
// only the entry point (this tab, instead of the normal Templates page) and
// the category filter (AUTHENTICATION only) differ.
const AuthenticationTemplatesPanel = () => {
  const [templates, setTemplates] = useState([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState('');
  const [creating, setCreating] = useState(false);
  const [editingTemplate, setEditingTemplate] = useState(null);
  const [previewTemplate, setPreviewTemplate] = useState(null);

  const loadTemplates = () => {
    setLoading(true);
    wFetch('/templates')
      .then((r) => r.ok && r.json())
      .then((d) => { if (Array.isArray(d)) setTemplates(d.filter((t) => t.category === 'AUTHENTICATION')); })
      .catch(() => setErr('Failed to load Authentication templates.'))
      .finally(() => setLoading(false));
  };

  useEffect(loadTemplates, []);

  return (
    <>
      <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: 16 }}>
        <Btn onClick={() => setCreating(true)} style={{ boxShadow: 'var(--glow)' }}>
          <I n="file" s={14} c="#08090c" /> New Template
        </Btn>
      </div>

      {err && <AlertBanner type="error">{err}</AlertBanner>}

      {loading ? (
        <div style={{ textAlign: 'center', padding: '48px', color: 'var(--t2)', fontSize: 13 }}>Loading templates…</div>
      ) : templates.length === 0 ? (
        <div style={{ borderRadius: 10, padding: '48px 24px', background: 'rgba(0,0,0,0.35)', border: '1px solid var(--bd)', textAlign: 'center', color: 'var(--t2)', fontSize: 13 }}>
          No Authentication templates yet. Create one, or use "Sync from Meta" on the Templates page — it still reaches this list.
        </div>
      ) : (
        <div style={{ borderRadius: 10, background: 'rgba(0,0,0,0.35)', border: '1px solid var(--bd)', overflowX: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: 560 }}>
            <thead>
              <tr style={{ borderBottom: '1px solid var(--bd)' }}>
                {['Name', 'Language', 'Status', ''].map((h) => (
                  <th key={h} style={{ padding: '12px 16px', textAlign: 'left', fontSize: 11, fontWeight: 700, color: 'var(--t2)', textTransform: 'uppercase', letterSpacing: '.08em' }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {templates.map((t) => (
                <tr key={t.id} style={{ borderBottom: '1px solid var(--bd)' }}>
                  <td style={{ padding: '14px 16px', fontSize: 13.5, fontWeight: 600, color: 'var(--t1)' }}>
                    {t.name}
                    {t.status === 'REJECTED' && t.rejectedReason && (
                      <p style={{ margin: '4px 0 0', fontSize: 11, color: '#f87171', fontWeight: 500 }}>{t.rejectedReason}</p>
                    )}
                  </td>
                  <td style={{ padding: '14px 16px', fontSize: 13, color: 'var(--t2)' }}>{t.language}</td>
                  <td style={{ padding: '14px 16px' }}><StatusBadge s={statusLabel(t.status)} /></td>
                  <td style={{ padding: '14px 16px', display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
                    <Btn variant="outline" size="sm" onClick={() => setPreviewTemplate(t)}>Preview</Btn>
                    <Btn variant="outline" size="sm" onClick={() => setEditingTemplate(t)}>Edit</Btn>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {creating && (
        <TemplateModal
          forcedCategory="AUTHENTICATION"
          onClose={() => setCreating(false)}
          onSaved={() => { setCreating(false); loadTemplates(); }}
        />
      )}

      {editingTemplate && (
        <TemplateModal
          template={editingTemplate}
          forcedCategory="AUTHENTICATION"
          onClose={() => setEditingTemplate(null)}
          onSaved={() => { setEditingTemplate(null); loadTemplates(); }}
        />
      )}

      {previewTemplate && (
        <TemplatePreviewModal template={previewTemplate} onClose={() => setPreviewTemplate(null)} />
      )}
    </>
  );
};

// Replaces window.confirm() for the "Regenerate Key" action. Matches the
// modal chrome already established in this file (backdrop, card, header/body/
// footer bands) rather than introducing a new dialog pattern.
const ConfirmRegenerateModal = ({ onCancel, onConfirm, loading }) => (
  <div
    onClick={loading ? undefined : onCancel}
    role="dialog" aria-modal="true" aria-label="Regenerate API Key?"
    style={{ position: 'fixed', inset: 0, background: 'rgba(3,5,12,0.78)', backdropFilter: 'blur(4px)', zIndex: 400, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 20 }}
  >
    <div onClick={e => e.stopPropagation()} style={{ ...card, border: '1px solid var(--gbd)', boxShadow: 'var(--card-shadow), 0 0 40px rgba(53,232,242,0.10)', width: '100%', maxWidth: 440, overflow: 'hidden' }}>
      <div style={{ padding: '18px 22px', borderBottom: '1px solid var(--bd)', display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 12 }}>
        <div style={{ display: 'flex', alignItems: 'flex-start', gap: 10 }}>
          <div style={{ width: 32, height: 32, borderRadius: 8, background: 'rgba(248,113,113,.1)', border: '1px solid rgba(248,113,113,.3)', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0, marginTop: 1 }}>
            <I n="alertt" s={15} c="#f87171" />
          </div>
          <h3 style={{ margin: 0, fontFamily: "'Space Grotesk',sans-serif", fontWeight: 700, fontSize: 16, color: 'var(--t1)' }}>Regenerate API Key?</h3>
        </div>
        <button onClick={onCancel} disabled={loading} style={{ width: 26, height: 26, borderRadius: 6, background: 'rgba(255,255,255,0.04)', border: '1px solid var(--bd)', cursor: loading ? 'not-allowed' : 'pointer', color: 'var(--t2)', flexShrink: 0, opacity: loading ? .5 : 1 }}>
          <I n="x" s={12} c="var(--t2)" />
        </button>
      </div>

      <div style={{ padding: '18px 22px', display: 'flex', flexDirection: 'column', gap: 14 }}>
        <p style={{ margin: 0, fontSize: 13, color: 'var(--t2)', lineHeight: 1.6 }}>
          Your current API key will become invalid immediately after regeneration. Any application currently using the old key will stop authenticating until it is updated with the new key.
        </p>

        <div style={{ display: 'flex', alignItems: 'flex-start', gap: 10, padding: '12px 14px', borderRadius: 9, background: 'rgba(245,158,11,.08)', border: '1px solid rgba(245,158,11,.25)' }}>
          <I n="alertc" s={14} c="#fbbf24" />
          <p style={{ margin: 0, fontSize: 12.5, color: '#fcd34d', lineHeight: 1.55 }}>
            Make sure you can update your application with the new key before continuing.
          </p>
        </div>
      </div>

      <div style={{ padding: '13px 22px', borderTop: '1px solid var(--bd)', display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
        <Btn variant="ghost" onClick={onCancel} disabled={loading}>Cancel</Btn>
        <Btn
          variant="ghost"
          onClick={onConfirm}
          disabled={loading}
          style={{ border: '1px solid rgba(248,113,113,.4)', background: 'rgba(248,113,113,.08)', color: '#f87171' }}
        >
          {loading ? 'Regenerating…' : 'Regenerate Key'}
        </Btn>
      </div>
    </div>
  </div>
);

// The one-time reveal of a freshly rotated key. Closing it is the only way
// out — no backdrop-click dismiss — since the raw value is dropped the moment
// it closes and cannot be recovered from this page again.
const NewKeyModal = ({ apiKey, onClose }) => (
  <div role="dialog" aria-modal="true" aria-label="New API Key Generated" style={{ position: 'fixed', inset: 0, background: 'rgba(3,5,12,0.78)', backdropFilter: 'blur(4px)', zIndex: 400, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 20 }}>
    <div style={{ ...card, border: '1px solid var(--gbd)', boxShadow: 'var(--card-shadow), 0 0 40px rgba(53,232,242,0.10)', width: '100%', maxWidth: 480, overflow: 'hidden' }}>
      <div style={{ padding: '18px 22px', borderBottom: '1px solid var(--bd)', display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 12 }}>
        <div style={{ display: 'flex', alignItems: 'flex-start', gap: 10 }}>
          <div style={{ width: 32, height: 32, borderRadius: 8, background: 'var(--sbg)', border: '1px solid var(--sbd)', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0, marginTop: 1 }}>
            <I n="checkc" s={15} c="var(--success)" />
          </div>
          <h3 style={{ margin: 0, fontFamily: "'Space Grotesk',sans-serif", fontWeight: 700, fontSize: 16, color: 'var(--t1)' }}>New API Key Generated</h3>
        </div>
        <button onClick={onClose} style={{ width: 26, height: 26, borderRadius: 6, background: 'rgba(255,255,255,0.04)', border: '1px solid var(--bd)', cursor: 'pointer', color: 'var(--t2)', flexShrink: 0 }}>
          <I n="x" s={12} c="var(--t2)" />
        </button>
      </div>

      <div style={{ padding: '18px 22px', display: 'flex', flexDirection: 'column', gap: 14 }}>
        <p style={{ margin: 0, fontSize: 13, color: 'var(--t2)', lineHeight: 1.6 }}>
          Your previous API key is now invalid and a new key has been generated successfully.
        </p>

        <div>
          <div style={{ fontSize: 10.5, fontWeight: 700, color: 'var(--t3)', textTransform: 'uppercase', letterSpacing: '.07em', marginBottom: 9 }}>
            New API Key
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, borderRadius: 10, padding: '12px 14px', background: 'rgba(0,0,0,0.35)', border: '1px solid var(--bd)' }}>
            <code style={{ flex: 1, minWidth: 0, fontFamily: mono, fontSize: 13, wordBreak: 'break-all', color: 'var(--t1)' }}>
              {apiKey || 'Not available'}
            </code>
            {apiKey && <CopyButton text={apiKey} label="Copy Key" message="Key copied" />}
          </div>
        </div>

        <div style={{ display: 'flex', alignItems: 'flex-start', gap: 10, padding: '12px 14px', borderRadius: 9, background: 'rgba(245,158,11,.08)', border: '1px solid rgba(245,158,11,.25)' }}>
          <I n="alertc" s={14} c="#fbbf24" />
          <p style={{ margin: 0, fontSize: 12.5, color: '#fcd34d', lineHeight: 1.55 }}>
            Save this key securely. For security, the full key will only be available in this window. Once you close this window, you may not be able to view or copy the full key again.
          </p>
        </div>
      </div>

      <div style={{ padding: '13px 22px', borderTop: '1px solid var(--bd)', display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
        <Btn onClick={onClose} style={{ boxShadow: 'var(--glow)' }}>Close</Btn>
      </div>
    </div>
  </div>
);

export default function AuthenticationDashboard() {
  const [activeTab, setActiveTab] = useState('overview');

  const [configuration, setConfiguration] =
    useState(null);

  const [loading, setLoading] =
    useState(true);

  const [saving, setSaving] =
    useState(false);

  const [rotating, setRotating] =
    useState(false);

  const [error, setError] =
    useState('');

  const [success, setSuccess] =
    useState('');

  const [apiKey, setApiKey] =
    useState(null);

  const [apiKeyMetadata, setApiKeyMetadata] =
    useState(null);

  // Regenerate confirmation + the one-time reveal of the freshly rotated key.
  // Kept separate from `apiKey` above (which is the first-time-provisioning
  // reveal) so closing this modal can drop the raw value without touching
  // that unrelated flow.
  const [showRegenerateConfirm, setShowRegenerateConfirm] =
    useState(false);

  const [newlyRotatedKey, setNewlyRotatedKey] =
    useState(null);

  const [showNewKeyModal, setShowNewKeyModal] =
    useState(false);

  const [enabled, setEnabled] =
    useState(false);

  const [templateId, setTemplateId] =
    useState('');

  const [waNumberId, setWaNumberId] =
    useState('');

  const [expandedEndpoint, setExpandedEndpoint] =
    useState(null);

  async function loadConfiguration() {
    setLoading(true);
    setError('');

    try {
      const res = await wFetch(
        '/authentication'
      );

      const data = await res.json();

      if (!res.ok) {
        throw new Error(
          getErrorMessage(
            data,
            `Failed to load Authentication configuration (${res.status})`
          )
        );
      }

      setConfiguration(data);
      setEnabled(Boolean(data.enabled));
      setTemplateId(data.templateId || '');
      setWaNumberId(data.waNumberId || '');

      // Retrieve an existing key's safe metadata (or provision the dedicated
      // key once). The raw value is returned only on first provisioning.
      await loadApiKey();
    } catch (err) {
      setError(
        err?.message ||
        'Failed to load Authentication configuration.'
      );
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    loadConfiguration();
  }, []);

  async function saveConfiguration() {
    setSaving(true);
    setError('');
    setSuccess('');

    try {
      const res = await wFetch(
        '/authentication',
        {
          method: 'PATCH',
          body: JSON.stringify({
            enabled,
            templateId,
            waNumberId,
          }),
        }
      );

      const data = await res.json();

      if (!res.ok) {
        throw new Error(
          getErrorMessage(
            data,
            `Failed to save Authentication configuration (${res.status})`
          )
        );
      }

      setConfiguration(prev => ({
        ...prev,
        ...data,
      }));

      setSuccess(
        'Authentication configuration saved successfully.'
      );
    } catch (err) {
      setError(
        err?.message ||
        'Failed to save Authentication configuration.'
      );
    } finally {
      setSaving(false);
    }
  }

  async function loadApiKey() {
    setError('');
    setSuccess('');

    try {
      const res = await wFetch(
        '/api-keys/authentication'
      );

      const data = await res.json();

      if (!res.ok) {
        throw new Error(
          getErrorMessage(
            data,
            `Failed to load Authentication API key (${res.status})`
          )
        );
      }

      setApiKey(data.rawKey || data.keyPrefix || null);
      setApiKeyMetadata(data);

      setConfiguration(prev => ({
        ...prev,
        apiKeyId: data.id || data.apiKeyId || prev?.apiKeyId,
      }));

      if (data.rawKey) {
        setSuccess(
          'Authentication API key provisioned. Copy it now and store it securely in your backend.'
        );
      }
    } catch (err) {
      setError(
        err?.message ||
        'Failed to provision Authentication API key.'
      );
    }
  }

  // Confirmation now happens in ConfirmRegenerateModal (a custom in-app
  // dialog) before this is ever called — see handleConfirmRegenerate below.
  // The request itself, its endpoint and its payload are unchanged.
  async function rotateApiKey() {
    setRotating(true);
    setError('');

    try {
      const res = await wFetch(
        '/api-keys/authentication/rotate',
        {
          method: 'POST',
        }
      );

      const data = await res.json();

      if (!res.ok) {
        throw new Error(
          getErrorMessage(
            data,
            `Failed to rotate Authentication API key (${res.status})`
          )
        );
      }

      setApiKeyMetadata(data);
      setConfiguration(prev => ({
        ...prev,
        apiKeyId: data.id || data.apiKeyId || prev?.apiKeyId,
      }));
      // The old key is invalid the moment this succeeds — if it was still
      // being displayed inline from an earlier generate in this session,
      // drop it so nothing offers an already-dead key for copy.
      setApiKey(null);

      // Revealed only in the success modal, not inline on the page — see
      // NewKeyModal's onClose, which drops this the moment it's dismissed.
      setNewlyRotatedKey(data.rawKey || null);
      setShowNewKeyModal(true);
    } catch (err) {
      setError(
        err?.message ||
        'Failed to rotate Authentication API key.'
      );
    } finally {
      setRotating(false);
    }
  }

  // Confirm modal stays open (buttons disabled via `rotating`) for the
  // duration of the request, so it can't be submitted twice, then closes
  // once rotateApiKey settles — on success the new-key modal is already open
  // by that point, on failure the existing error banner is what's left.
  async function handleConfirmRegenerate() {
    await rotateApiKey();
    setShowRegenerateConfirm(false);
  }

  function closeNewKeyModal() {
    setShowNewKeyModal(false);
    setNewlyRotatedKey(null);
  }

  if (loading) {
    return (
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden', background: authPageBackground }}>
        <div className="dash-page" style={{ flex: 1, overflowY: 'auto', padding: '28px 32px', maxWidth: 900, margin: '0 auto', width: '100%', boxSizing: 'border-box' }}>
          <div style={{ ...card, padding: '40px 24px', textAlign: 'center', fontSize: 13, color: 'var(--t2)' }}>
            Loading Authentication configuration…
          </div>
        </div>
      </div>
    );
  }

  const numbers =
    configuration?.numbers || [];

  const templates =
    configuration?.templates || [];

  const selectedNumber =
    numbers.find(
      number => number.id === waNumberId
    );

  const selectedTemplate =
    templates.find(
      template => template.id === templateId
    );

  const rawKeyVisible = Boolean(apiKey && apiKey.length > 12);

  const keyDisplayValue = apiKey
    ? maskApiKey(apiKey)
    : apiKeyMetadata?.keyPrefix
      ? 'cfp_live_••••••••••••'
      : 'Not provisioned';

  return (
    <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden', background: authPageBackground }}>
      <div className="dash-page" style={{ flex: 1, overflowY: 'auto', padding: '28px 32px', display: 'flex', flexDirection: 'column', gap: 20, maxWidth: 900, margin: '0 auto', width: '100%', boxSizing: 'border-box' }}>

        {/* ── Header ── */}
        <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 16, flexWrap: 'wrap' }}>
          <div style={{ display: 'flex', alignItems: 'flex-start', gap: 10 }}>
            <MobileNavButton />
            <div>
              <h1 style={{ margin: 0, fontFamily: "'Space Grotesk',sans-serif", fontWeight: 800, fontSize: 26, color: 'var(--t1)', letterSpacing: '-.02em' }}>
                Authentication
              </h1>
              <p style={{ margin: '7px 0 0', fontSize: 13, color: 'var(--t2)', lineHeight: 1.5 }}>
                Production WhatsApp OTP authentication for your application.
              </p>
            </div>
          </div>

          <StatusPill enabled={enabled} />
        </div>

        <TabBar active={activeTab} onChange={setActiveTab} />

        {error && <AlertBanner type="error">{error}</AlertBanner>}
        {success && <AlertBanner type="success">{success}</AlertBanner>}

        {activeTab === 'templates' && (
          <section style={{ ...card, padding: '22px 24px' }}>
            <SectionHeader
              icon="file"
              title="Authentication Templates"
              description="Create, edit and preview the OTP templates used by your Authentication configuration."
            />
            <AuthenticationTemplatesPanel />
          </section>
        )}

        {activeTab === 'analytics' && (
          <section style={{ ...card, padding: '22px 24px' }}>
            <SectionHeader
              icon="chart"
              title="Authentication Analytics"
              description="OTP requests, deliveries and verification outcomes across the Authentication API and campaigns."
            />
            <AuthenticationAnalyticsPanel />
          </section>
        )}

        {activeTab === 'overview' && (
        <>
        {/* ── Configuration ── */}
        <section style={{ ...card, padding: '22px 24px' }}>
          <SectionHeader
            icon="cog"
            title="Authentication Configuration"
            description="Configure the WhatsApp number and approved Authentication template used for generated OTPs."
            right={<Toggle checked={enabled} onChange={event => setEnabled(event.target.checked)} label="Enable Authentication" />}
          />

          <div className="rgrid-2" style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
            <div>
              <label style={{ display: 'block', marginBottom: 7, fontSize: 12, fontWeight: 600, color: 'var(--t2)' }}>
                WhatsApp Number
              </label>

              <select
                value={waNumberId}
                onChange={event => setWaNumberId(event.target.value)}
                style={selectFieldStyle}
                onFocus={e => e.target.style.borderColor = 'var(--gbd)'}
                onBlur={e => e.target.style.borderColor = 'var(--bd)'}
              >
                <option value="">
                  Select WhatsApp number
                </option>

                {numbers.map(number => (
                  <option
                    key={number.id}
                    value={number.id}
                  >
                    {formatPhone(number.phoneNumber)}
                    {number.displayName ? ` — ${number.displayName}` : ''}
                  </option>
                ))}
              </select>

              {selectedNumber && (
                <div style={{ marginTop: 7, fontSize: 12, color: 'var(--success)', display: 'flex', alignItems: 'center', gap: 5 }}>
                  <I n="checkc" s={11} c="var(--success)" /> Selected WhatsApp number
                </div>
              )}
            </div>

            <div>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8, marginBottom: 7 }}>
                <label style={{ display: 'block', fontSize: 12, fontWeight: 600, color: 'var(--t2)' }}>
                  Authentication Template
                </label>
                <button
                  type="button"
                  onClick={() => setActiveTab('templates')}
                  style={{ background: 'none', border: 'none', padding: 0, cursor: 'pointer', fontSize: 11.5, fontWeight: 700, color: 'var(--green)' }}
                >
                  Manage Templates →
                </button>
              </div>

              <select
                value={templateId}
                onChange={event => setTemplateId(event.target.value)}
                style={selectFieldStyle}
                onFocus={e => e.target.style.borderColor = 'var(--gbd)'}
                onBlur={e => e.target.style.borderColor = 'var(--bd)'}
              >
                <option value="">
                  Select Authentication template
                </option>

                {templates.map(template => (
                  <option
                    key={template.id}
                    value={template.id}
                  >
                    {template.name}
                    {template.language ? ` (${template.language})` : ''}
                  </option>
                ))}
              </select>

              {selectedTemplate && (
                <div style={{ marginTop: 7, fontSize: 12, color: 'var(--success)', display: 'flex', alignItems: 'center', gap: 5 }}>
                  <I n="checkc" s={11} c="var(--success)" /> APPROVED · AUTHENTICATION
                </div>
              )}
            </div>
          </div>

          <div style={{ marginTop: 18, padding: '14px 16px', borderRadius: 9, background: 'rgba(255,255,255,0.02)', border: '1px solid var(--bd)', display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 16, flexWrap: 'wrap' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
              <I n="clock" s={15} c="var(--t2)" />
              <div>
                <p style={{ margin: 0, fontSize: 10.5, fontWeight: 700, color: 'var(--t3)', textTransform: 'uppercase', letterSpacing: '.07em' }}>OTP Expiration</p>
                <p style={{ margin: '3px 0 0', fontSize: 15, fontWeight: 700, color: 'var(--t1)' }}>{configuration?.otpExpirationMinutes || 10} minutes</p>
              </div>
            </div>

            <p style={{ margin: 0, fontSize: 11.5, color: 'var(--t3)', maxWidth: 260, textAlign: 'right' }}>
              OTPs are generated and verified securely by ChatFlow.
            </p>
          </div>

          <div style={{ marginTop: 20, display: 'flex', justifyContent: 'flex-end' }}>
            <Btn
              onClick={saveConfiguration}
              disabled={saving || !templateId || !waNumberId}
              style={{ boxShadow: 'var(--glow)' }}
            >
              {saving ? 'Saving…' : 'Save Configuration'}
            </Btn>
          </div>
        </section>

        {/* ── Developer Integration ── */}
        <section style={{ ...card, padding: '22px 24px' }}>
          <SectionHeader
            icon="key"
            title="Developer Integration"
            description="Use this dedicated Authentication API key from your application's backend."
          />

          <div style={{ display: 'flex', alignItems: 'flex-start', gap: 10, padding: '13px 15px', borderRadius: 9, background: 'rgba(245,158,11,.08)', border: '1px solid rgba(245,158,11,.25)', marginBottom: 18 }}>
            <I n="shield" s={15} c="#fbbf24" />
            <div>
              <p style={{ margin: 0, fontSize: 12.5, fontWeight: 700, color: '#fbbf24' }}>Keep this key secret.</p>
              <p style={{ margin: '3px 0 0', fontSize: 12, color: '#fcd34d', lineHeight: 1.5 }}>
                Never expose the Authentication API key in browser or mobile application code.
              </p>
            </div>
          </div>

          <div style={{ borderRadius: 10, padding: '16px 18px', background: 'rgba(0,0,0,0.35)', border: '1px solid var(--bd)' }}>
            <div style={{ fontSize: 10.5, fontWeight: 700, color: 'var(--t3)', textTransform: 'uppercase', letterSpacing: '.07em', marginBottom: 9 }}>
              Authentication API Key
            </div>

            <code style={{ display: 'block', fontFamily: mono, fontSize: 13.5, wordBreak: 'break-all', marginBottom: 16, color: 'var(--t1)' }}>
              {keyDisplayValue}
            </code>

            <div style={{ display: 'flex', gap: 9, flexWrap: 'wrap', alignItems: 'center' }}>
              {!configuration?.apiKeyId && (
                <Btn size="sm" variant="ghost" onClick={loadApiKey}>
                  Generate Key
                </Btn>
              )}

              {rawKeyVisible && (
                <CopyButton
                  text={apiKey}
                  label="Copy"
                  message="API key copied to clipboard"
                  onError={() => setError('Could not copy the API key. Please copy it manually.')}
                />
              )}

              {(configuration?.apiKeyId || apiKeyMetadata?.id) && (
                <Btn
                  size="sm"
                  variant="ghost"
                  onClick={() => setShowRegenerateConfirm(true)}
                  disabled={rotating}
                  style={{ border: '1px solid rgba(248,113,113,.4)', background: 'rgba(248,113,113,.08)', color: '#f87171' }}
                >
                  {rotating ? 'Rotating…' : 'Regenerate'}
                </Btn>
              )}
            </div>

            {apiKey && (
              <div style={{ marginTop: 14, display: 'flex', alignItems: 'flex-start', gap: 8, paddingTop: 14, borderTop: '1px solid var(--bd)' }}>
                <I n="alertc" s={13} c="#fbbf24" />
                <p style={{ margin: 0, fontSize: 11.5, color: '#fcd34d', lineHeight: 1.55 }}>
                  For security, this key is shown temporarily. Store it securely before leaving this page.
                </p>
              </div>
            )}
          </div>
        </section>

        {/* ── API Documentation ── */}
        <section style={{ ...card, padding: '22px 24px' }}>
          <SectionHeader
            icon="file"
            title="Authentication API"
            description="Use these endpoints from your application's backend to generate and verify customer OTPs."
          />

          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            {ENDPOINTS.map(endpoint => (
              <EndpointCard
                key={endpoint.id}
                endpoint={endpoint}
                open={expandedEndpoint === endpoint.id}
                onToggle={() => setExpandedEndpoint(prev => (prev === endpoint.id ? null : endpoint.id))}
              />
            ))}
          </div>
        </section>
        </>
        )}

      </div>

      {showRegenerateConfirm && (
        <ConfirmRegenerateModal
          loading={rotating}
          onCancel={() => setShowRegenerateConfirm(false)}
          onConfirm={handleConfirmRegenerate}
        />
      )}

      {showNewKeyModal && (
        <NewKeyModal apiKey={newlyRotatedKey} onClose={closeNewKeyModal} />
      )}
    </div>
  );
}
