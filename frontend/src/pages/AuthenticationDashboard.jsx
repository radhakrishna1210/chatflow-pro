import React, { useEffect, useRef, useState } from 'react';

import { wFetch } from '../lib/api.js';
import { I } from '../components/Icons.jsx';
import { Btn } from '../components/Btn.jsx';
import MobileNavButton from '../components/MobileNavButton.jsx';

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

export default function AuthenticationDashboard() {
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

  async function rotateApiKey() {
    if (
      !window.confirm(
        'Rotate the Authentication API key? The previous key will stop working.'
      )
    ) {
      return;
    }

    setRotating(true);
    setError('');
    setSuccess('');

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

      setApiKey(data.rawKey || null);
      setApiKeyMetadata(data);

      setSuccess(
        'Authentication API key rotated. Copy the new key and update your backend immediately.'
      );
    } catch (err) {
      setError(
        err?.message ||
        'Failed to rotate Authentication API key.'
      );
    } finally {
      setRotating(false);
    }
  }

  if (loading) {
    return (
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
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
    <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
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

        {error && <AlertBanner type="error">{error}</AlertBanner>}
        {success && <AlertBanner type="success">{success}</AlertBanner>}

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
              <label style={{ display: 'block', marginBottom: 7, fontSize: 12, fontWeight: 600, color: 'var(--t2)' }}>
                Authentication Template
              </label>

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
                  onClick={rotateApiKey}
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

      </div>
    </div>
  );
}
