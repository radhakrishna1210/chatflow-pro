import { useState, useEffect } from 'react';
import { I } from './Icons.jsx';
import { wFetch } from '../lib/api.js';

// Self-contained so it does not have to join the notification-toggle state
// machinery in SettingsView, which batches its saves differently.
const Switch = ({ on, onToggle, disabled }) => (
  <div
    role="switch"
    aria-checked={on}
    tabIndex={disabled ? -1 : 0}
    onClick={disabled ? undefined : onToggle}
    onKeyDown={(e) => { if (!disabled && (e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); onToggle(); } }}
    style={{
      width: 38, height: 21, borderRadius: 20, flexShrink: 0, position: 'relative',
      background: on ? 'var(--green)' : 'rgba(255,255,255,0.1)',
      border: `1px solid ${on ? 'var(--gbd)' : 'var(--bd)'}`,
      cursor: disabled ? 'not-allowed' : 'pointer', opacity: disabled ? 0.5 : 1,
      transition: 'background .2s',
    }}>
    <div style={{
      position: 'absolute', top: 2, left: on ? 19 : 2, width: 15, height: 15, borderRadius: '50%',
      background: on ? '#06210F' : 'var(--t3)', transition: 'left .2s',
    }} />
  </div>
);

export const LeadCaptureSetting = ({ isAdmin }) => {
  const [on, setOn] = useState(false);
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState(null);

  useEffect(() => {
    wFetch('/settings')
      .then(r => (r.ok ? r.json() : null))
      .then(d => { if (d && typeof d.autoLeadFromReply === 'boolean') setOn(d.autoLeadFromReply); })
      .catch(() => {});
  }, []);

  const toggle = async () => {
    const next = !on;
    setOn(next); // optimistic
    setSaving(true);
    setErr(null);
    try {
      const res = await wFetch('/settings', {
        method: 'PATCH', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ autoLeadFromReply: next }),
      });
      if (!res.ok) {
        const d = await res.json().catch(() => ({}));
        throw new Error(d.error || 'Could not save this setting');
      }
    } catch (e) {
      setOn(!next); // roll back so the switch never lies about what is stored
      setErr(e.message);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div>
      {err && (
        <div style={{ marginBottom: 12, padding: '9px 13px', borderRadius: 8, background: 'rgba(239,68,68,.08)', border: '1px solid rgba(239,68,68,.22)', color: '#f87171', fontSize: 12 }}>
          {err}
        </div>
      )}

      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 16 }}>
        <div>
          <div style={{ fontSize: 12.5, color: 'var(--t1)', fontWeight: 600, marginBottom: 3 }}>
            Create a lead when someone replies to a campaign
          </div>
          <div style={{ fontSize: 11.5, color: 'var(--t3)', lineHeight: 1.55, maxWidth: 520 }}>
            The reply is attributed to the most recent campaign that actually reached them, within 30 days,
            and the new lead arrives already scored. Contacts who have opted out are never captured, and
            anyone who is already a lead is left alone.
          </div>
        </div>
        <Switch on={on} onToggle={toggle} disabled={!isAdmin || saving} />
      </div>

      {!isAdmin && (
        <div style={{ fontSize: 11.5, color: 'var(--t3)', marginTop: 10 }}>
          Only an admin can change this.
        </div>
      )}

      {on && (
        <div style={{ marginTop: 12, display: 'flex', gap: 8, alignItems: 'flex-start', fontSize: 11.5, color: 'var(--t3)' }}>
          <I n="alertc" s={13} c="#f59e0b" />
          <span>
            Replies to campaigns will start appearing under Leads. Existing conversations are not
            backfilled — only replies received from now on are captured.
          </span>
        </div>
      )}
    </div>
  );
};

export default LeadCaptureSetting;
