import { useEffect, useMemo, useState } from 'react';
import { apiFetch, wFetch } from '../lib/api.js';

/**
 * Authentication Dashboard
 *
 * Purpose:
 * - Test ChatFlow-generated Authentication OTPs (Mode 1)
 * - Test Client-generated Authentication OTPs (Mode 2)
 *
 * Backend endpoints:
 * POST /api/v1/authentication/generate
 * POST /api/v1/authentication/verify
 *
 * IMPORTANT:
 * Authentication API routes use API-key authentication on the backend.
 * This dashboard therefore needs an API key that has:
 *
 *     authentication:send
 *
 * The API key is sent using the X-API-Key header.
 */

const page = {
  minHeight: '100vh',
  background: 'var(--bg, #08090d)',
  color: 'var(--t1, #f5f7fa)',
  fontFamily: "'Space Grotesk', Inter, system-ui, sans-serif",
  padding: '32px',
  boxSizing: 'border-box',
};

const shell = {
  maxWidth: 1180,
  margin: '0 auto',
};

const card = {
  background: 'var(--surf, #11141b)',
  border: '1px solid var(--bd, rgba(255,255,255,.09))',
  borderRadius: 18,
  boxShadow: '0 18px 50px rgba(0,0,0,.18)',
};

const inputStyle = {
  width: '100%',
  boxSizing: 'border-box',
  background: 'rgba(255,255,255,.035)',
  border: '1px solid var(--bd, rgba(255,255,255,.1))',
  color: 'var(--t1, #f5f7fa)',
  borderRadius: 10,
  padding: '12px 13px',
  outline: 'none',
  fontSize: 14,
};

const labelStyle = {
  display: 'block',
  marginBottom: 7,
  color: 'var(--t2, #9aa3b2)',
  fontSize: 12,
  fontWeight: 700,
};

const buttonBase = {
  border: 0,
  borderRadius: 10,
  padding: '11px 16px',
  fontSize: 13,
  fontWeight: 800,
  cursor: 'pointer',
};

function getUser() {
  try {
    return JSON.parse(localStorage.getItem('user') || '{}');
  } catch {
    return {};
  }
}

function getWorkspaceId() {
  return getUser()?.workspaceId || '';
}

function getStoredApiKey() {
  return localStorage.getItem('chatflowAuthenticationApiKey') || '';
}

function saveStoredApiKey(value) {
  if (value) {
    localStorage.setItem(
      'chatflowAuthenticationApiKey',
      value
    );
  } else {
    localStorage.removeItem(
      'chatflowAuthenticationApiKey'
    );
  }
}

function StatusBox({ type, children }) {
  if (!children) return null;

  const styles = {
    success: {
      background: 'rgba(34,197,94,.09)',
      border: '1px solid rgba(34,197,94,.25)',
      color: '#86efac',
    },
    error: {
      background: 'rgba(239,68,68,.09)',
      border: '1px solid rgba(239,68,68,.25)',
      color: '#fca5a5',
    },
    info: {
      background: 'rgba(99,102,241,.09)',
      border: '1px solid rgba(99,102,241,.25)',
      color: '#a5b4fc',
    },
  };

  return (
    <div
      style={{
        ...styles[type || 'info'],
        borderRadius: 10,
        padding: '11px 13px',
        fontSize: 13,
        lineHeight: 1.5,
      }}
    >
      {children}
    </div>
  );
}

function ResultRow({ label, value, mono = false }) {
  if (
    value === undefined ||
    value === null ||
    value === ''
  ) {
    return null;
  }

  return (
    <div
      style={{
        display: 'grid',
        gridTemplateColumns: '150px 1fr',
        gap: 12,
        padding: '10px 0',
        borderBottom:
          '1px solid rgba(255,255,255,.055)',
      }}
    >
      <div
        style={{
          color: 'var(--t2, #9aa3b2)',
          fontSize: 12,
          fontWeight: 700,
        }}
      >
        {label}
      </div>

      <div
        style={{
          color: 'var(--t1, #f5f7fa)',
          fontSize: 13,
          fontFamily: mono
            ? 'ui-monospace, SFMono-Regular, Menlo, monospace'
            : 'inherit',
          wordBreak: 'break-word',
        }}
      >
        {String(value)}
      </div>
    </div>
  );
}

export default function AuthenticationDashboard({
  onNav,
}) {
  const user = useMemo(() => getUser(), []);

  const [mode, setMode] = useState('CHATFLOW_GENERATED');

  const [apiKey, setApiKey] = useState(
    getStoredApiKey()
  );

  const [templateId, setTemplateId] = useState('');
  const [to, setTo] = useState('');
  const [clientOtp, setClientOtp] = useState('');

  const [templates, setTemplates] = useState([]);
  const [loadingTemplates, setLoadingTemplates] =
    useState(false);

  const [sending, setSending] = useState(false);
  const [verifying, setVerifying] =
    useState(false);

  const [sendResult, setSendResult] =
    useState(null);

  const [verifyResult, setVerifyResult] =
    useState(null);

  const [error, setError] = useState('');
  const [verifyError, setVerifyError] =
    useState('');

  const [verifyCode, setVerifyCode] =
    useState('');

  const [showRaw, setShowRaw] = useState(false);

  /*
   * Load Authentication templates from the current workspace.
   *
   * This is only used for the UI selector.
   * The backend remains responsible for validating that
   * the selected template is APPROVED + AUTHENTICATION +
   * COPY_CODE.
   */
  useEffect(() => {
    let cancelled = false;

    async function loadTemplates() {
      setLoadingTemplates(true);

      try {
        const res = await wFetch('/templates');

        if (!res.ok) {
          throw new Error(
            `Could not load templates (${res.status})`
          );
        }

        const data = await res.json();

        if (cancelled) return;

        const list = Array.isArray(data)
          ? data
          : Array.isArray(data?.templates)
            ? data.templates
            : Array.isArray(data?.items)
              ? data.items
              : [];

        const authTemplates = list.filter(
          (template) =>
            String(
              template?.category || ''
            ).toUpperCase() === 'AUTHENTICATION'
        );

        setTemplates(authTemplates);

        if (!templateId && authTemplates.length) {
          const approved =
            authTemplates.find(
              (t) =>
                String(
                  t?.status || ''
                ).toUpperCase() === 'APPROVED'
            ) || authTemplates[0];

          setTemplateId(
            approved.id || approved.name || ''
          );
        }
      } catch (err) {
        if (!cancelled) {
          setError(
            err?.message ||
              'Could not load authentication templates.'
          );
        }
      } finally {
        if (!cancelled) {
          setLoadingTemplates(false);
        }
      }
    }

    loadTemplates();

    return () => {
      cancelled = true;
    };
  }, [templateId]);

  /*
   * The authentication routes are API-key protected.
   *
   * We call the route directly rather than wFetch(), because
   * wFetch() uses dashboard JWT authentication.
   */
  async function authenticationFetch(
    path,
    body
  ) {
    const key = apiKey.trim();

    if (!key) {
      throw new Error(
        'Enter an API key with the authentication:send scope.'
      );
    }

    saveStoredApiKey(key);

    const res = await fetch(
      `/api/v1/authentication${path}`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-API-Key': key,
        },
        body: JSON.stringify(body),
      }
    );

    let data = null;

    try {
      data = await res.json();
    } catch {
      data = null;
    }

    if (!res.ok) {
      const message =
        data?.error ||
        data?.message ||
        `Request failed (${res.status})`;

      const err = new Error(message);
      err.status = res.status;
      err.response = data;
      throw err;
    }

    return data;
  }

  async function sendOtp(e) {
    e?.preventDefault();

    setError('');
    setVerifyError('');
    setSendResult(null);
    setVerifyResult(null);
    setVerifyCode('');

    const phone = to.trim();
    const selectedTemplate =
      templateId.trim();

    if (!selectedTemplate) {
      setError(
        'Select an Authentication template.'
      );
      return;
    }

    if (!phone) {
      setError(
        'Enter the recipient phone number.'
      );
      return;
    }

    if (mode === 'CLIENT_GENERATED') {
      if (!/^\d{6}$/.test(clientOtp.trim())) {
        setError(
          'Mode 2 requires an OTP containing exactly 6 digits.'
        );
        return;
      }
    }

    setSending(true);

    try {
      const payload = {
        templateId: selectedTemplate,
        to: phone,
      };

      /*
       * MODE 1:
       * Do not send otp.
       *
       * Backend sees otp === undefined and therefore
       * creates the AuthenticationTransaction and
       * generates the OTP.
       */
      if (mode === 'CLIENT_GENERATED') {
        /*
         * MODE 2:
         * Send the client-provided OTP.
         */
        payload.otp = clientOtp.trim();
      }

      const result =
        await authenticationFetch(
          '/generate',
          payload
        );

      setSendResult(result);

      /*
       * For Mode 1 the backend returns:
       * - otp
       * - transactionId
       *
       * For Mode 2 those fields intentionally
       * are not returned.
       */
      if (mode === 'CHATFLOW_GENERATED') {
        setVerifyCode(
          result?.otp
            ? String(result.otp)
            : ''
        );
      }
    } catch (err) {
      setError(
        err?.message ||
          'Could not send authentication OTP.'
      );
    } finally {
      setSending(false);
    }
  }

  async function verifyOtp(e) {
    e?.preventDefault();

    setVerifyError('');
    setVerifyResult(null);

    const phone = to.trim();
    const code = verifyCode.trim();

    if (!phone) {
      setVerifyError(
        'Enter the recipient phone number.'
      );
      return;
    }

    if (!/^\d{6}$/.test(code)) {
      setVerifyError(
        'Enter the 6-digit OTP to verify.'
      );
      return;
    }

    /*
     * IMPORTANT:
     *
     * The backend's /verify endpoint verifies
     * ChatFlow-generated transactions.
     *
     * Therefore Mode 2 is intentionally NOT
     * sent through /verify.
     */
    if (mode === 'CLIENT_GENERATED') {
      setVerifyError(
        'Mode 2 is client-generated. ChatFlow does not verify the client-generated OTP through this endpoint.'
      );
      return;
    }

    setVerifying(true);

    try {
      const result =
        await authenticationFetch(
          '/verify',
          {
            phone,
            code,
          }
        );

      setVerifyResult(result);
    } catch (err) {
      setVerifyError(
        err?.message ||
          'Could not verify authentication OTP.'
      );
    } finally {
      setVerifying(false);
    }
  }

  function resetTest() {
    setSendResult(null);
    setVerifyResult(null);
    setError('');
    setVerifyError('');
    setVerifyCode('');
  }

  return (
    <div style={page}>
      <div style={shell}>

        {/* ───────────────── HEADER ───────────────── */}

        <div
          style={{
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            gap: 20,
            marginBottom: 28,
            flexWrap: 'wrap',
          }}
        >
          <div>
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 10,
                marginBottom: 8,
              }}
            >
              {onNav && (
                <button
                  type="button"
                  onClick={() =>
                    onNav('dashboard')
                  }
                  style={{
                    ...buttonBase,
                    background:
                      'rgba(255,255,255,.055)',
                    color:
                      'var(--t1, #f5f7fa)',
                    border:
                      '1px solid var(--bd, rgba(255,255,255,.1))',
                  }}
                >
                  ← Dashboard
                </button>
              )}

              <span
                style={{
                  fontSize: 11,
                  fontWeight: 800,
                  letterSpacing: '.08em',
                  textTransform: 'uppercase',
                  color: '#9d6bff',
                }}
              >
                Authentication
              </span>
            </div>

            <h1
              style={{
                margin: 0,
                fontSize: 30,
                lineHeight: 1.15,
                letterSpacing: '-.035em',
              }}
            >
              Authentication OTP Testing
            </h1>

            <p
              style={{
                margin:
                  '9px 0 0',
                color:
                  'var(--t2, #9aa3b2)',
                fontSize: 14,
                lineHeight: 1.5,
                maxWidth: 700,
              }}
            >
              Test the real WhatsApp Authentication
              implementation without modifying the
              existing Dashboard.
            </p>
          </div>

          <div
            style={{
              ...card,
              padding: '11px 14px',
              minWidth: 220,
            }}
          >
            <div
              style={{
                color:
                  'var(--t2, #9aa3b2)',
                fontSize: 11,
                fontWeight: 700,
                marginBottom: 4,
              }}
            >
              CURRENT WORKSPACE
            </div>

            <div
              style={{
                fontSize: 13,
                fontWeight: 800,
              }}
            >
              {user?.workspaceName ||
                getWorkspaceId() ||
                'Workspace'}
            </div>
          </div>
        </div>

        {/* ───────────────── MODE SELECTOR ───────────────── */}

        <div
          style={{
            ...card,
            padding: 8,
            marginBottom: 18,
            display: 'grid',
            gridTemplateColumns:
              'repeat(2, minmax(0, 1fr))',
            gap: 8,
          }}
        >
          <button
            type="button"
            onClick={() => {
              setMode(
                'CHATFLOW_GENERATED'
              );
              resetTest();
            }}
            style={{
              ...buttonBase,
              padding: '16px',
              textAlign: 'left',
              background:
                mode ===
                'CHATFLOW_GENERATED'
                  ? 'rgba(157,107,255,.15)'
                  : 'transparent',
              color:
                mode ===
                'CHATFLOW_GENERATED'
                  ? '#c4b5fd'
                  : 'var(--t2, #9aa3b2)',
              border:
                mode ===
                'CHATFLOW_GENERATED'
                  ? '1px solid rgba(157,107,255,.35)'
                  : '1px solid transparent',
            }}
          >
            <div
              style={{
                fontSize: 14,
                marginBottom: 5,
              }}
            >
              Mode 1 — ChatFlow Generated
            </div>

            <div
              style={{
                fontSize: 11,
                fontWeight: 500,
                lineHeight: 1.45,
                opacity: .8,
              }}
            >
              ChatFlow generates the OTP,
              stores the transaction and can
              verify it.
            </div>
          </button>

          <button
            type="button"
            onClick={() => {
              setMode(
                'CLIENT_GENERATED'
              );
              resetTest();
            }}
            style={{
              ...buttonBase,
              padding: '16px',
              textAlign: 'left',
              background:
                mode ===
                'CLIENT_GENERATED'
                  ? 'rgba(53,232,242,.1)'
                  : 'transparent',
              color:
                mode ===
                'CLIENT_GENERATED'
                  ? '#67e8f9'
                  : 'var(--t2, #9aa3b2)',
              border:
                mode ===
                'CLIENT_GENERATED'
                  ? '1px solid rgba(53,232,242,.3)'
                  : '1px solid transparent',
            }}
          >
            <div
              style={{
                fontSize: 14,
                marginBottom: 5,
              }}
            >
              Mode 2 — Client Generated
            </div>

            <div
              style={{
                fontSize: 11,
                fontWeight: 500,
                lineHeight: 1.45,
                opacity: .8,
              }}
            >
              Your application supplies the
              6-digit OTP. ChatFlow sends it but
              does not verify it.
            </div>
          </button>
        </div>

        {/* ───────────────── MAIN GRID ───────────────── */}

        <div
          style={{
            display: 'grid',
            gridTemplateColumns:
              'minmax(0, 1fr) minmax(0, 1fr)',
            gap: 18,
          }}
        >

          {/* ───────────── SEND PANEL ───────────── */}

          <form
            onSubmit={sendOtp}
            style={{
              ...card,
              padding: 22,
            }}
          >
            <div
              style={{
                marginBottom: 20,
              }}
            >
              <h2
                style={{
                  margin: 0,
                  fontSize: 18,
                  letterSpacing: '-.02em',
                }}
              >
                1. Send Authentication OTP
              </h2>

              <p
                style={{
                  margin:
                    '6px 0 0',
                  color:
                    'var(--t2, #9aa3b2)',
                  fontSize: 12,
                  lineHeight: 1.5,
                }}
              >
                This calls the actual{' '}
                <code>
                  /authentication/generate
                </code>{' '}
                endpoint.
              </p>
            </div>

            {/* API KEY */}

            <div
              style={{
                marginBottom: 16,
              }}
            >
              <label
                style={labelStyle}
              >
                API Key
              </label>

              <input
                type="password"
                value={apiKey}
                onChange={(e) =>
                  setApiKey(e.target.value)
                }
                placeholder="API key with authentication:send"
                style={inputStyle}
                autoComplete="off"
              />

              <div
                style={{
                  marginTop: 6,
                  color:
                    'var(--t2, #9aa3b2)',
                  fontSize: 10,
                  lineHeight: 1.4,
                }}
              >
                Stored locally in this browser
                for this test page.
              </div>
            </div>

            {/* TEMPLATE */}

            <div
              style={{
                marginBottom: 16,
              }}
            >
              <label
                style={labelStyle}
              >
                Approved Authentication Template
              </label>

              {templates.length > 0 ? (
                <select
                  value={templateId}
                  onChange={(e) =>
                    setTemplateId(
                      e.target.value
                    )
                  }
                  style={inputStyle}
                >
                  <option
                    value=""
                    style={{
                      background: '#11141b',
                    }}
                  >
                    Select template
                  </option>

                  {templates.map(
                    (template) => (
                      <option
                        key={
                          template.id ||
                          template.name
                        }
                        value={
                          template.id ||
                          template.name
                        }
                        style={{
                          background:
                            '#11141b',
                        }}
                      >
                        {template.name}
                        {template.status
                          ? ` — ${template.status}`
                          : ''}
                      </option>
                    )
                  )}
                </select>
              ) : (
                <>
                  <input
                    value={templateId}
                    onChange={(e) =>
                      setTemplateId(
                        e.target.value
                      )
                    }
                    placeholder={
                      loadingTemplates
                        ? 'Loading templates...'
                        : 'Template ID or name'
                    }
                    style={inputStyle}
                  />

                  <div
                    style={{
                      marginTop: 6,
                      color:
                        'var(--t2, #9aa3b2)',
                      fontSize: 10,
                    }}
                  >
                    No Authentication templates
                    were returned by the workspace
                    template endpoint. You can enter
                    the template ID/name manually.
                  </div>
                </>
              )}
            </div>

            {/* PHONE */}

            <div
              style={{
                marginBottom: 16,
              }}
            >
              <label
                style={labelStyle}
              >
                Recipient Phone Number
              </label>

              <input
                type="tel"
                value={to}
                onChange={(e) =>
                  setTo(e.target.value)
                }
                placeholder="+919876543210"
                style={inputStyle}
                autoComplete="tel"
              />
            </div>

            {/* MODE 2 OTP */}

            {mode ===
              'CLIENT_GENERATED' && (
              <div
                style={{
                  marginBottom: 16,
                }}
              >
                <label
                  style={labelStyle}
                >
                  Client-Generated OTP
                </label>

                <input
                  inputMode="numeric"
                  maxLength={6}
                  value={clientOtp}
                  onChange={(e) =>
                    setClientOtp(
                      e.target.value.replace(
                        /\D/g,
                        ''
                      )
                    )
                  }
                  placeholder="123456"
                  style={{
                    ...inputStyle,
                    letterSpacing: '.2em',
                    fontFamily:
                      'ui-monospace, monospace',
                    fontWeight: 800,
                  }}
                />

                <div
                  style={{
                    marginTop: 6,
                    color:
                      'var(--t2, #9aa3b2)',
                    fontSize: 10,
                    lineHeight: 1.4,
                  }}
                >
                  This exact 6-digit code is sent
                  to Meta. The backend does not
                  create an AuthenticationTransaction
                  for this mode.
                </div>
              </div>
            )}

            <StatusBox
              type="error"
            >
              {error}
            </StatusBox>

            {error && (
              <div
                style={{
                  height: 10,
                }}
              />
            )}

            <button
              type="submit"
              disabled={sending}
              style={{
                ...buttonBase,
                width: '100%',
                background:
                  mode ===
                  'CHATFLOW_GENERATED'
                    ? '#9d6bff'
                    : '#35e8f2',
                color: '#071015',
                opacity: sending
                  ? .6
                  : 1,
              }}
            >
              {sending
                ? 'Sending...'
                : mode ===
                    'CHATFLOW_GENERATED'
                  ? 'Generate & Send OTP'
                  : 'Send Client OTP'}
            </button>
          </form>

          {/* ───────────── RESULT PANEL ───────────── */}

          <div
            style={{
              ...card,
              padding: 22,
            }}
          >
            <div
              style={{
                marginBottom: 20,
              }}
            >
              <h2
                style={{
                  margin: 0,
                  fontSize: 18,
                  letterSpacing: '-.02em',
                }}
              >
                Send Result
              </h2>

              <p
                style={{
                  margin:
                    '6px 0 0',
                  color:
                    'var(--t2, #9aa3b2)',
                  fontSize: 12,
                }}
              >
                Real response returned by your
                backend.
              </p>
            </div>

            {!sendResult ? (
              <div
                style={{
                  minHeight: 200,
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  textAlign: 'center',
                  color:
                    'var(--t2, #9aa3b2)',
                  fontSize: 13,
                  border:
                    '1px dashed rgba(255,255,255,.1)',
                  borderRadius: 12,
                  padding: 20,
                  boxSizing: 'border-box',
                }}
              >
                Send an OTP to see the real
                backend response.
              </div>
            ) : (
              <>
                <StatusBox type="success">
                  Authentication OTP sent
                  successfully.
                </StatusBox>

                <div
                  style={{
                    marginTop: 14,
                  }}
                >
                  <ResultRow
                    label="Status"
                    value={
                      sendResult.status
                    }
                  />

                  <ResultRow
                    label="Mode"
                    value={
                      sendResult.mode
                    }
                  />

                  <ResultRow
                    label="Phone"
                    value={
                      sendResult.phone
                    }
                    mono
                  />

                  <ResultRow
                    label="Template"
                    value={
                      sendResult.templateName
                    }
                  />

                  <ResultRow
                    label="Expires"
                    value={
                      sendResult.expiresAt
                    }
                  />

                  <ResultRow
                    label="Expires In"
                    value={
                      sendResult.expiresIn != null
                        ? `${sendResult.expiresIn} seconds`
                        : ''
                    }
                  />

                  <ResultRow
                    label="Meta Message ID"
                    value={
                      sendResult.metaMessageId
                    }
                    mono
                  />

                  {sendResult
                    .transactionId && (
                    <ResultRow
                      label="Transaction ID"
                      value={
                        sendResult.transactionId
                      }
                      mono
                    />
                  )}

                  {sendResult.otp && (
                    <ResultRow
                      label="OTP"
                      value={
                        sendResult.otp
                      }
                      mono
                    />
                  )}
                </div>

                <button
                  type="button"
                  onClick={() =>
                    setShowRaw(
                      !showRaw
                    )
                  }
                  style={{
                    ...buttonBase,
                    marginTop: 16,
                    background:
                      'rgba(255,255,255,.055)',
                    color:
                      'var(--t1, #f5f7fa)',
                    border:
                      '1px solid rgba(255,255,255,.1)',
                  }}
                >
                  {showRaw
                    ? 'Hide Raw Response'
                    : 'Show Raw Response'}
                </button>

                {showRaw && (
                  <pre
                    style={{
                      marginTop: 12,
                      padding: 13,
                      background:
                        'rgba(0,0,0,.25)',
                      borderRadius: 10,
                      overflow: 'auto',
                      fontSize: 11,
                      lineHeight: 1.5,
                      color:
                        '#d1d5db',
                    }}
                  >
                    {JSON.stringify(
                      sendResult,
                      null,
                      2
                    )}
                  </pre>
                )}
              </>
            )}
          </div>
        </div>

        {/* ───────────────── VERIFY ───────────────── */}

        <div
          style={{
            ...card,
            padding: 22,
            marginTop: 18,
          }}
        >
          <div
            style={{
              marginBottom: 18,
            }}
          >
            <h2
              style={{
                margin: 0,
                fontSize: 18,
                letterSpacing: '-.02em',
              }}
            >
              2. Verify OTP
            </h2>

            <p
              style={{
                margin:
                  '6px 0 0',
                color:
                  'var(--t2, #9aa3b2)',
                fontSize: 12,
                lineHeight: 1.5,
              }}
            >
              This uses the real{' '}
              <code>
                /authentication/verify
              </code>{' '}
              endpoint.
            </p>
          </div>

          <div
            style={{
              display: 'grid',
              gridTemplateColumns:
                '1fr 1fr auto',
              gap: 12,
              alignItems: 'end',
            }}
          >
            <div>
              <label
                style={labelStyle}
              >
                Phone
              </label>

              <input
                type="tel"
                value={to}
                onChange={(e) =>
                  setTo(e.target.value)
                }
                placeholder="+919876543210"
                style={inputStyle}
              />
            </div>

            <div>
              <label
                style={labelStyle}
              >
                OTP
              </label>

              <input
                inputMode="numeric"
                maxLength={6}
                value={verifyCode}
                onChange={(e) =>
                  setVerifyCode(
                    e.target.value.replace(
                      /\D/g,
                      ''
                    )
                  )
                }
                placeholder="123456"
                style={{
                  ...inputStyle,
                  letterSpacing: '.2em',
                  fontFamily:
                    'ui-monospace, monospace',
                  fontWeight: 800,
                }}
              />
            </div>

            <button
              type="button"
              onClick={verifyOtp}
              disabled={
                verifying ||
                mode ===
                  'CLIENT_GENERATED'
              }
              style={{
                ...buttonBase,
                height: 43,
                background:
                  mode ===
                  'CLIENT_GENERATED'
                    ? 'rgba(255,255,255,.06)'
                    : '#c4ff46',
                color:
                  mode ===
                  'CLIENT_GENERATED'
                    ? 'var(--t2, #9aa3b2)'
                    : '#071015',
                cursor:
                  mode ===
                  'CLIENT_GENERATED'
                    ? 'not-allowed'
                    : 'pointer',
                opacity: verifying
                  ? .6
                  : 1,
              }}
            >
              {verifying
                ? 'Verifying...'
                : 'Verify OTP'}
            </button>
          </div>

          <div
            style={{
              marginTop: 12,
            }}
          >
            <StatusBox type="error">
              {verifyError}
            </StatusBox>
          </div>

          {mode ===
            'CLIENT_GENERATED' && (
            <div
              style={{
                marginTop: 14,
              }}
            >
              <StatusBox type="info">
                <strong>Mode 2:</strong>{' '}
                your current backend deliberately
                does not verify client-generated
                OTPs through{' '}
                <code>/authentication/verify</code>.
                That is consistent with your
                authentication service implementation.
              </StatusBox>
            </div>
          )}

          {verifyResult && (
            <div
              style={{
                marginTop: 16,
              }}
            >
              <StatusBox type="success">
                OTP verification succeeded.
              </StatusBox>

              <pre
                style={{
                  marginTop: 12,
                  padding: 14,
                  background:
                    'rgba(0,0,0,.25)',
                  borderRadius: 10,
                  overflow: 'auto',
                  fontSize: 11,
                  lineHeight: 1.5,
                }}
              >
                {JSON.stringify(
                  verifyResult,
                  null,
                  2
                )}
              </pre>
            </div>
          )}
        </div>

        {/* ───────────────── IMPLEMENTATION CHECK ───────────────── */}

        <div
          style={{
            ...card,
            padding: 22,
            marginTop: 18,
          }}
        >
          <h2
            style={{
              margin:
                '0 0 16px',
              fontSize: 16,
            }}
          >
            Implementation Check
          </h2>

          <div
            style={{
              display: 'grid',
              gridTemplateColumns:
                'repeat(2, minmax(0, 1fr))',
              gap: 12,
            }}
          >
            <div
              style={{
                padding: 15,
                borderRadius: 12,
                background:
                  'rgba(157,107,255,.07)',
                border:
                  '1px solid rgba(157,107,255,.18)',
              }}
            >
              <div
                style={{
                  fontWeight: 800,
                  fontSize: 13,
                  marginBottom: 7,
                }}
              >
                Mode 1
              </div>

              <div
                style={{
                  color:
                    'var(--t2, #9aa3b2)',
                  fontSize: 12,
                  lineHeight: 1.55,
                }}
              >
                No <code>otp</code> field is sent
                from this page.
                <br />
                Backend generates the OTP.
                <br />
                Backend creates the transaction.
                <br />
                Backend returns the OTP and
                transaction ID.
                <br />
                Verify uses the stored transaction.
              </div>
            </div>

            <div
              style={{
                padding: 15,
                borderRadius: 12,
                background:
                  'rgba(53,232,242,.055)',
                border:
                  '1px solid rgba(53,232,242,.16)',
              }}
            >
              <div
                style={{
                  fontWeight: 800,
                  fontSize: 13,
                  marginBottom: 7,
                }}
              >
                Mode 2
              </div>

              <div
                style={{
                  color:
                    'var(--t2, #9aa3b2)',
                  fontSize: 12,
                  lineHeight: 1.55,
                }}
              >
                A 6-digit <code>otp</code> is sent
                by the client.
                <br />
                Backend validates the code.
                <br />
                Backend sends that exact code
                through Meta.
                <br />
                No authentication transaction is
                created.
                <br />
                Backend does not verify this mode.
              </div>
            </div>
          </div>
        </div>

      </div>

      {/* Basic responsive handling without requiring
          another stylesheet. */}
      <style>{`
        @media (max-width: 850px) {
          div {
            --auth-dashboard-mobile: 1;
          }
        }
      `}</style>
    </div>
  );
}