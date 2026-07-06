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

const Toast = ({ message, type = 'success', onClose }) => {
  useEffect(() => { const t = setTimeout(onClose, 3500); return () => clearTimeout(t); }, [onClose]);
  const isS = type === 'success';
  return (
    <div style={{
      position: 'fixed', bottom: 28, right: 28, zIndex: 9000,
      display: 'flex', alignItems: 'center', gap: 10,
      padding: '13px 20px', borderRadius: 11,
      background: isS ? 'rgba(30,191,94,0.12)' : 'rgba(239,68,68,0.12)',
      border: `1px solid ${isS ? 'rgba(30,191,94,0.3)' : 'rgba(239,68,68,0.3)'}`,
      color: isS ? '#4ade80' : '#f87171', fontSize: 13, fontWeight: 600,
      fontFamily: "'Plus Jakarta Sans',sans-serif",
      backdropFilter: 'blur(12px)', boxShadow: '0 8px 32px rgba(0,0,0,0.4)',
      animation: 'fadeUp .3s ease both',
    }}>
      <I n={isS ? 'check' : 'alertc'} s={15} c={isS ? '#4ade80' : '#f87171'} />
      {message}
    </div>
  );
};

const Toggle = ({ on, onToggle, disabled = false }) => (
  <div onClick={disabled ? undefined : onToggle} style={{
    width: 42, height: 23, borderRadius: 20,
    background: on ? 'var(--green)' : 'rgba(255,255,255,0.1)',
    cursor: disabled ? 'not-allowed' : 'pointer', transition: 'background .2s', position: 'relative',
    border: `1px solid ${on ? 'var(--gbd)' : 'var(--bd)'}`, flexShrink: 0,
    opacity: disabled ? 0.5 : 1,
  }}>
    <div style={{
      position: 'absolute', top: 2.5, left: on ? 21 : 2.5,
      width: 16, height: 16, borderRadius: '50%', background: 'white',
      transition: 'left .2s', boxShadow: '0 1px 3px rgba(0,0,0,0.4)',
    }} />
  </div>
);

const SectionCard = ({ icon, title, subtitle, children, color = 'var(--green)', badge }) => (
  <div style={{ ...card, overflow: 'hidden' }}>
    <div style={{ padding: '16px 20px', borderBottom: '1px solid var(--bd)', display: 'flex', alignItems: 'center', gap: 12 }}>
      <div style={{
        width: 36, height: 36, borderRadius: 10,
        background: `${color}12`, border: `1px solid ${color}25`,
        display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0,
      }}>
        <I n={icon} s={17} c={color} />
      </div>
      <div style={{ flex: 1 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <span style={{ fontFamily: "'Syne',sans-serif", fontWeight: 700, fontSize: 15, color: 'var(--t1)' }}>{title}</span>
          {badge && (
            <span style={{
              padding: '2px 8px', borderRadius: 10, fontSize: 10, fontWeight: 700,
              background: 'rgba(30,191,94,0.08)', border: '1px solid rgba(30,191,94,0.2)',
              color: 'var(--green)', letterSpacing: '.03em',
            }}>{badge}</span>
          )}
        </div>
        {subtitle && <p style={{ fontSize: 12, color: 'var(--t2)', marginTop: 2 }}>{subtitle}</p>}
      </div>
    </div>
    <div style={{ padding: 20 }}>{children}</div>
  </div>
);

const MessageEditor = ({ label, value, onChange, placeholder, hint }) => (
  <div style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
    <label style={{ fontSize: 12, fontWeight: 600, color: 'var(--t2)' }}>{label}</label>
    <textarea
      value={value} onChange={onChange} placeholder={placeholder} rows={3}
      style={{
        width: '100%', padding: '10px 13px', borderRadius: 8,
        background: 'rgba(255,255,255,0.04)', border: '1px solid var(--bd)',
        color: 'var(--t1)', fontSize: 13, fontFamily: "'Plus Jakarta Sans',sans-serif",
        outline: 'none', boxSizing: 'border-box', resize: 'vertical',
        transition: 'border-color .15s',
      }}
      onFocus={e => e.target.style.borderColor = 'var(--gbd)'}
      onBlur={e => e.target.style.borderColor = 'var(--bd)'}
    />
    {hint && <p style={{ fontSize: 11, color: 'var(--t3)' }}>{hint}</p>}
  </div>
);

const Skeleton = ({ w = '100%', h = 40 }) => (
  <div style={{
    width: w, height: h, borderRadius: 8,
    background: 'linear-gradient(90deg, rgba(255,255,255,0.03) 25%, rgba(255,255,255,0.06) 50%, rgba(255,255,255,0.03) 75%)',
    backgroundSize: '200% 100%', animation: 'pulse 1.5s ease infinite',
  }} />
);

const STORAGE_KEY = 'chatflow_automation_settings';

const DAYS = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];

const DEFAULT_HOURS = Object.fromEntries(DAYS.map(d => [d, {
  enabled: d !== 'Saturday' && d !== 'Sunday',
  start: '09:00',
  end: '18:00',
}]));

const DEFAULT_STATE = {
  welcomeMessage: 'Hi! 👋 Welcome to our business. How can we help you today?',
  welcomeEnabled: true,
  awayMessage: 'We are currently away. We will get back to you as soon as possible!',
  awayEnabled: true,
  offlineMessage: "Our team is offline right now. Leave a message and we'll get back to you!",
  offlineEnabled: false,
  autoReplyMessage: 'Thanks for reaching out! Our team will respond within 5 minutes.',
  autoReplyEnabled: true,
  followUpMessage: "Hi! Just checking in — were we able to help with your query?",
  followUpEnabled: false,
  followUpDelay: 24,
  workingHours: DEFAULT_HOURS,
  leadQualification: false,
  aiAutomation: false,
  responseDelay: 2,
};

export default function AutomationSettingsPage() {
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [toast, setToast] = useState(null);
  const [state, setState] = useState(DEFAULT_STATE);

  useEffect(() => {
    // Load from localStorage first
    try {
      const saved = JSON.parse(localStorage.getItem(STORAGE_KEY) || '{}');
      if (Object.keys(saved).length > 0) {
        setState(prev => ({ ...prev, ...saved }));
      }
    } catch { }

    // Then load backend values to overlay
    wFetch('/automation/basic')
      .then(r => r.ok && r.json())
      .then(d => {
        if (d) {
          setState(prev => ({
            ...prev,
            welcomeEnabled: !!d.autoWelcomeEnabled,
            awayEnabled: !!d.autoOooEnabled,
            autoReplyEnabled: !!d.autoDelayedEnabled,
          }));
        }
      })
      .catch(() => { })
      .finally(() => setLoading(false));
  }, []);

  const update = (key, val) => {
    setState(prev => {
      const next = { ...prev, [key]: val };
      localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
      return next;
    });
  };

  const updateHours = (day, field, val) => {
    setState(prev => {
      const next = {
        ...prev,
        workingHours: {
          ...prev.workingHours,
          [day]: { ...prev.workingHours[day], [field]: val },
        },
      };
      localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
      return next;
    });
  };

  const handleSave = async () => {
    setSaving(true);
    try {
      // Save backend-supported fields
      const res = await wFetch('/automation/basic', {
        method: 'PATCH',
        body: JSON.stringify({
          autoWelcomeEnabled: state.welcomeEnabled,
          autoOooEnabled: state.awayEnabled,
          autoDelayedEnabled: state.autoReplyEnabled,
        }),
      });
      // Save all state to localStorage
      localStorage.setItem(STORAGE_KEY, JSON.stringify(state));

      if (res.ok) {
        setToast({ message: 'Automation settings saved!', type: 'success' });
      } else {
        setToast({ message: 'Saved locally. Backend sync failed.', type: 'error' });
      }
    } catch {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
      setToast({ message: 'Saved locally. Backend unavailable.', type: 'error' });
    } finally {
      setSaving(false);
    }
  };

  const handleReset = () => {
    setState(DEFAULT_STATE);
    localStorage.removeItem(STORAGE_KEY);
    setToast({ message: 'Settings reset to defaults', type: 'success' });
  };

  if (loading) {
    return (
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
        <DashHeader title="Automation Settings" subtitle="Configure automated messages and responses" />
        <div style={{ flex: 1, overflowY: 'auto', padding: '24px 28px' }}>
          <div style={{ maxWidth: 760, display: 'flex', flexDirection: 'column', gap: 20 }}>
            <Skeleton h={200} /> <Skeleton h={160} /> <Skeleton h={200} />
          </div>
        </div>
      </div>
    );
  }

  return (
    <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
      <DashHeader title="Automation Settings" subtitle="Configure automated messages and responses" />
      <div style={{ flex: 1, overflowY: 'auto', padding: '24px 28px' }}>
        <div style={{ maxWidth: 760, display: 'flex', flexDirection: 'column', gap: 20 }}>

          {/* Welcome Message */}
          <SectionCard icon="msg" title="Welcome Message" subtitle="Sent when a new conversation starts" color="#1EBF5E">
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 14 }}>
              <span style={{ fontSize: 13, fontWeight: 600, color: 'var(--t1)' }}>Enable Welcome Message</span>
              <Toggle on={state.welcomeEnabled} onToggle={() => update('welcomeEnabled', !state.welcomeEnabled)} />
            </div>
            {state.welcomeEnabled && (
              <MessageEditor
                label="Message Text"
                value={state.welcomeMessage}
                onChange={e => update('welcomeMessage', e.target.value)}
                placeholder="Enter your welcome message..."
                hint="Supports emojis. Use {{name}} for customer name placeholder."
              />
            )}
          </SectionCard>

          {/* Away Message */}
          <SectionCard icon="clock" title="Away Message" subtitle="Sent outside of working hours" color="#F59E0B">
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 14 }}>
              <span style={{ fontSize: 13, fontWeight: 600, color: 'var(--t1)' }}>Enable Away Message</span>
              <Toggle on={state.awayEnabled} onToggle={() => update('awayEnabled', !state.awayEnabled)} />
            </div>
            {state.awayEnabled && (
              <MessageEditor
                label="Away Message Text"
                value={state.awayMessage}
                onChange={e => update('awayMessage', e.target.value)}
                placeholder="Enter your away message..."
              />
            )}
          </SectionCard>

          {/* Offline Message */}
          <SectionCard icon="ban" title="Offline Message" subtitle="Sent when no agents are available" color="#EF4444">
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 14 }}>
              <span style={{ fontSize: 13, fontWeight: 600, color: 'var(--t1)' }}>Enable Offline Message</span>
              <Toggle on={state.offlineEnabled} onToggle={() => update('offlineEnabled', !state.offlineEnabled)} />
            </div>
            {state.offlineEnabled && (
              <MessageEditor
                label="Offline Message Text"
                value={state.offlineMessage}
                onChange={e => update('offlineMessage', e.target.value)}
                placeholder="Enter your offline message..."
              />
            )}
          </SectionCard>

          {/* Auto Reply */}
          <SectionCard icon="reply" title="Auto Reply" subtitle="Instant acknowledgement response" color="#0EA5E9">
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 14 }}>
              <span style={{ fontSize: 13, fontWeight: 600, color: 'var(--t1)' }}>Enable Auto Reply</span>
              <Toggle on={state.autoReplyEnabled} onToggle={() => update('autoReplyEnabled', !state.autoReplyEnabled)} />
            </div>
            {state.autoReplyEnabled && (
              <MessageEditor
                label="Auto Reply Text"
                value={state.autoReplyMessage}
                onChange={e => update('autoReplyMessage', e.target.value)}
                placeholder="Enter your auto-reply message..."
                hint="Sent immediately when a customer sends a message."
              />
            )}
          </SectionCard>

          {/* Follow Up */}
          <SectionCard icon="rotate" title="Follow Up" subtitle="Automated follow-up after inactivity" color="#A78BFA">
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 14 }}>
              <span style={{ fontSize: 13, fontWeight: 600, color: 'var(--t1)' }}>Enable Follow Up</span>
              <Toggle on={state.followUpEnabled} onToggle={() => update('followUpEnabled', !state.followUpEnabled)} />
            </div>
            {state.followUpEnabled && (
              <>
                <MessageEditor
                  label="Follow Up Message"
                  value={state.followUpMessage}
                  onChange={e => update('followUpMessage', e.target.value)}
                  placeholder="Enter your follow-up message..."
                />
                <div style={{ marginTop: 14, display: 'flex', alignItems: 'center', gap: 12 }}>
                  <label style={{ fontSize: 12, fontWeight: 600, color: 'var(--t2)', whiteSpace: 'nowrap' }}>Send after</label>
                  <input
                    type="number" value={state.followUpDelay} min={1} max={168}
                    onChange={e => update('followUpDelay', parseInt(e.target.value) || 1)}
                    style={{
                      width: 70, padding: '8px 10px', borderRadius: 8,
                      background: 'rgba(255,255,255,0.04)', border: '1px solid var(--bd)',
                      color: 'var(--t1)', fontSize: 13, fontFamily: "'Plus Jakarta Sans',sans-serif",
                      outline: 'none', textAlign: 'center',
                    }}
                  />
                  <span style={{ fontSize: 12, color: 'var(--t2)' }}>hours of inactivity</span>
                </div>
              </>
            )}
          </SectionCard>

          {/* Working Hours */}
          <SectionCard icon="clock" title="Working Hours" subtitle="Define when your team is available" color="#F472B6">
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              {DAYS.map(day => {
                const h = state.workingHours[day];
                return (
                  <div key={day} style={{
                    display: 'flex', alignItems: 'center', gap: 14, padding: '10px 14px',
                    borderRadius: 8, background: h.enabled ? 'rgba(255,255,255,0.02)' : 'transparent',
                    border: `1px solid ${h.enabled ? 'rgba(255,255,255,0.04)' : 'transparent'}`,
                    transition: 'all .15s',
                  }}>
                    <Toggle on={h.enabled} onToggle={() => updateHours(day, 'enabled', !h.enabled)} />
                    <span style={{
                      fontSize: 13, fontWeight: 600, color: h.enabled ? 'var(--t1)' : 'var(--t3)',
                      width: 90, flexShrink: 0,
                    }}>{day}</span>
                    {h.enabled ? (
                      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                        <input
                          type="time" value={h.start}
                          onChange={e => updateHours(day, 'start', e.target.value)}
                          style={{
                            padding: '6px 10px', borderRadius: 6,
                            background: 'rgba(255,255,255,0.04)', border: '1px solid var(--bd)',
                            color: 'var(--t1)', fontSize: 12, fontFamily: "'Plus Jakarta Sans',sans-serif",
                            outline: 'none', colorScheme: 'dark',
                          }}
                        />
                        <span style={{ fontSize: 12, color: 'var(--t3)' }}>to</span>
                        <input
                          type="time" value={h.end}
                          onChange={e => updateHours(day, 'end', e.target.value)}
                          style={{
                            padding: '6px 10px', borderRadius: 6,
                            background: 'rgba(255,255,255,0.04)', border: '1px solid var(--bd)',
                            color: 'var(--t1)', fontSize: 12, fontFamily: "'Plus Jakarta Sans',sans-serif",
                            outline: 'none', colorScheme: 'dark',
                          }}
                        />
                      </div>
                    ) : (
                      <span style={{ fontSize: 12, color: 'var(--t3)', fontStyle: 'italic' }}>Closed</span>
                    )}
                  </div>
                );
              })}
            </div>
          </SectionCard>

          {/* Advanced */}
          <SectionCard icon="spark" title="Advanced" subtitle="AI and lead qualification" color="#1EBF5E" badge="BETA">
            <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                <div>
                  <p style={{ fontSize: 13, fontWeight: 600, color: 'var(--t1)', marginBottom: 3 }}>Lead Qualification</p>
                  <p style={{ fontSize: 12, color: 'var(--t2)' }}>Automatically qualify leads based on conversation context</p>
                </div>
                <Toggle on={state.leadQualification} onToggle={() => update('leadQualification', !state.leadQualification)} />
              </div>
              <div style={{ borderTop: '1px solid rgba(255,255,255,0.04)', paddingTop: 16, display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                <div>
                  <p style={{ fontSize: 13, fontWeight: 600, color: 'var(--t1)', marginBottom: 3 }}>AI Automation</p>
                  <p style={{ fontSize: 12, color: 'var(--t2)' }}>Use AI to craft contextual auto-responses</p>
                </div>
                <Toggle on={state.aiAutomation} onToggle={() => update('aiAutomation', !state.aiAutomation)} />
              </div>
              <div style={{ borderTop: '1px solid rgba(255,255,255,0.04)', paddingTop: 16 }}>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                  <div>
                    <p style={{ fontSize: 13, fontWeight: 600, color: 'var(--t1)', marginBottom: 3 }}>Response Delay</p>
                    <p style={{ fontSize: 12, color: 'var(--t2)' }}>Add a natural delay before sending automated messages</p>
                  </div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    <input
                      type="number" value={state.responseDelay} min={0} max={30}
                      onChange={e => update('responseDelay', parseInt(e.target.value) || 0)}
                      style={{
                        width: 60, padding: '7px 10px', borderRadius: 7,
                        background: 'rgba(255,255,255,0.04)', border: '1px solid var(--bd)',
                        color: 'var(--t1)', fontSize: 13, fontFamily: "'Plus Jakarta Sans',sans-serif",
                        outline: 'none', textAlign: 'center',
                      }}
                    />
                    <span style={{ fontSize: 12, color: 'var(--t2)' }}>sec</span>
                  </div>
                </div>
              </div>
            </div>
          </SectionCard>

          {/* Actions */}
          <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, paddingBottom: 24, flexWrap: 'wrap' }}>
            <Btn variant="ghost" onClick={handleReset}>
              <I n="rotate" s={13} c="var(--t2)" />
              Reset to Defaults
            </Btn>
            <div style={{ display: 'flex', gap: 12 }}>
              <Btn variant="outline" onClick={() => window.dispatchEvent(new CustomEvent('app:nav', { detail: 'automation' }))}>
                Cancel
              </Btn>
              <Btn onClick={handleSave} disabled={saving} style={{ boxShadow: 'var(--glow)' }}>
                <I n="check" s={14} c="#060A10" />
                {saving ? 'Saving…' : 'Save Settings'}
              </Btn>
            </div>
          </div>
        </div>
      </div>

      {toast && <Toast message={toast.message} type={toast.type} onClose={() => setToast(null)} />}
    </div>
  );
}
