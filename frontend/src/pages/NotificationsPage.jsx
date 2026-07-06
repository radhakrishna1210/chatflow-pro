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

const Toggle = ({ on, onToggle }) => (
  <div onClick={onToggle} style={{
    width: 42, height: 23, borderRadius: 20,
    background: on ? 'var(--green)' : 'rgba(255,255,255,0.1)',
    cursor: 'pointer', transition: 'background .2s', position: 'relative',
    border: `1px solid ${on ? 'var(--gbd)' : 'var(--bd)'}`, flexShrink: 0,
  }}>
    <div style={{
      position: 'absolute', top: 2.5, left: on ? 21 : 2.5,
      width: 16, height: 16, borderRadius: '50%', background: 'white',
      transition: 'left .2s', boxShadow: '0 1px 3px rgba(0,0,0,0.4)',
    }} />
  </div>
);

const NotifSection = ({ icon, title, description, items, color = 'var(--green)' }) => (
  <div style={{ ...card, overflow: 'hidden' }}>
    <div style={{ padding: '16px 20px', borderBottom: '1px solid var(--bd)', display: 'flex', alignItems: 'center', gap: 10 }}>
      <I n={icon} s={16} c={color} />
      <div>
        <span style={{ fontFamily: "'Syne',sans-serif", fontWeight: 700, fontSize: 15, color: 'var(--t1)' }}>{title}</span>
        {description && <p style={{ fontSize: 12, color: 'var(--t2)', marginTop: 2 }}>{description}</p>}
      </div>
    </div>
    <div style={{ padding: '4px 0' }}>
      {items.map(item => (
        <div key={item.id} style={{
          display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 16,
          padding: '14px 20px', borderBottom: '1px solid rgba(255,255,255,0.03)',
          transition: 'background .12s',
        }}
          onMouseEnter={e => e.currentTarget.style.background = 'rgba(255,255,255,0.015)'}
          onMouseLeave={e => e.currentTarget.style.background = 'transparent'}
        >
          <div style={{ flex: 1 }}>
            <p style={{ fontSize: 13, fontWeight: 600, color: 'var(--t1)', marginBottom: 2 }}>{item.label}</p>
            {item.hint && <p style={{ fontSize: 11.5, color: 'var(--t2)' }}>{item.hint}</p>}
          </div>
          <Toggle on={item.on} onToggle={item.onToggle} />
        </div>
      ))}
    </div>
  </div>
);

export default function NotificationsPage() {
  const [prefs, setPrefs] = useState({
    emailCampaign: true,
    emailTemplate: true,
    emailRejected: true,
    emailMember: true,
    pushNewConv: true,
    pushTemplate: true,
    pushCampaign: false,
    pushOptout: true,
    pushRateLimit: true,
    marketingProduct: false,
    marketingNewsletter: true,
    marketingOffers: false,
    systemMaintenance: true,
    systemSecurity: true,
    systemBilling: true,
  });
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    wFetch('/settings')
      .then(r => r.ok && r.json())
      .then(d => {
        if (d) {
          setPrefs(prev => ({
            ...prev,
            pushNewConv: d.notifyNewConversation ?? prev.pushNewConv,
            pushTemplate: d.notifyTemplateApproved ?? prev.pushTemplate,
            pushCampaign: d.notifyCampaignCompleted ?? prev.pushCampaign,
            pushOptout: d.notifyHighOptout ?? prev.pushOptout,
            pushRateLimit: d.notifyRateLimit ?? prev.pushRateLimit,
            emailCampaign: d.emailNotifyCampaignCompleted ?? prev.emailCampaign,
            emailTemplate: d.emailNotifyTemplateApproved ?? prev.emailTemplate,
            emailRejected: d.emailNotifyTemplateRejected ?? prev.emailRejected,
            emailMember: d.emailNotifyMemberInvite ?? prev.emailMember,
          }));
        }
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  const toggle = (key) => {
    setPrefs(p => ({ ...p, [key]: !p[key] }));
    setSaved(false);
  };

  const handleSave = async () => {
    setSaving(true);
    try {
      await wFetch('/settings', {
        method: 'PATCH',
        body: JSON.stringify({
          notifyNewConversation: prefs.pushNewConv,
          notifyTemplateApproved: prefs.pushTemplate,
          notifyCampaignCompleted: prefs.pushCampaign,
          notifyHighOptout: prefs.pushOptout,
          notifyRateLimit: prefs.pushRateLimit,
          emailNotifyCampaignCompleted: prefs.emailCampaign,
          emailNotifyTemplateApproved: prefs.emailTemplate,
          emailNotifyTemplateRejected: prefs.emailRejected,
          emailNotifyMemberInvite: prefs.emailMember,
        }),
      });
      setSaved(true);
      setTimeout(() => setSaved(false), 3000);
    } catch {}
    setSaving(false);
  };

  const emailNotifs = [
    { id: 'emailCampaign', label: 'Campaign Completed', hint: 'Receive a summary when campaigns finish sending', on: prefs.emailCampaign, onToggle: () => toggle('emailCampaign') },
    { id: 'emailTemplate', label: 'Template Approved', hint: 'Get notified when Meta approves your templates', on: prefs.emailTemplate, onToggle: () => toggle('emailTemplate') },
    { id: 'emailRejected', label: 'Template Rejected', hint: 'Alerts when templates are rejected by Meta', on: prefs.emailRejected, onToggle: () => toggle('emailRejected') },
    { id: 'emailMember', label: 'Member Invited', hint: 'Email when a new member is added to workspace', on: prefs.emailMember, onToggle: () => toggle('emailMember') },
  ];

  const pushNotifs = [
    { id: 'pushNewConv', label: 'New Conversation', hint: 'When a customer initiates a chat', on: prefs.pushNewConv, onToggle: () => toggle('pushNewConv') },
    { id: 'pushTemplate', label: 'Template Status', hint: 'When template approval status changes', on: prefs.pushTemplate, onToggle: () => toggle('pushTemplate') },
    { id: 'pushCampaign', label: 'Campaign Completed', hint: 'When a campaign finishes sending', on: prefs.pushCampaign, onToggle: () => toggle('pushCampaign') },
    { id: 'pushOptout', label: 'High Opt-out Alert', hint: 'When opt-out rates exceed threshold', on: prefs.pushOptout, onToggle: () => toggle('pushOptout') },
    { id: 'pushRateLimit', label: 'Rate Limit Warning', hint: 'Approaching Meta API rate limits', on: prefs.pushRateLimit, onToggle: () => toggle('pushRateLimit') },
  ];

  const marketingNotifs = [
    { id: 'marketingProduct', label: 'Product Updates', hint: 'New features and product announcements', on: prefs.marketingProduct, onToggle: () => toggle('marketingProduct') },
    { id: 'marketingNewsletter', label: 'Newsletter', hint: 'Weekly tips and best practices', on: prefs.marketingNewsletter, onToggle: () => toggle('marketingNewsletter') },
    { id: 'marketingOffers', label: 'Special Offers', hint: 'Exclusive deals and promotions', on: prefs.marketingOffers, onToggle: () => toggle('marketingOffers') },
  ];

  const systemNotifs = [
    { id: 'systemMaintenance', label: 'Maintenance Alerts', hint: 'Scheduled maintenance and downtime', on: prefs.systemMaintenance, onToggle: () => toggle('systemMaintenance') },
    { id: 'systemSecurity', label: 'Security Alerts', hint: 'Unusual login activity and security events', on: prefs.systemSecurity, onToggle: () => toggle('systemSecurity') },
    { id: 'systemBilling', label: 'Billing Alerts', hint: 'Payment failures and billing reminders', on: prefs.systemBilling, onToggle: () => toggle('systemBilling') },
  ];

  if (loading) {
    return (
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
        <DashHeader title="Notification Preferences" subtitle="Choose how you want to be notified" />
        <div style={{ textAlign: 'center', padding: '48px', color: 'var(--t2)', fontSize: 13 }}>
          <div style={{ width: 24, height: 24, border: '2px solid var(--green)', borderTopColor: 'transparent', borderRadius: '50%', margin: '0 auto 10px', animation: 'spin 1s linear infinite' }} />
          Loading preferences…
        </div>
      </div>
    );
  }

  return (
    <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
      <DashHeader title="Notification Preferences" subtitle="Choose how you want to be notified" />
      <div style={{ flex: 1, overflowY: 'auto', padding: '24px 28px' }}>
        <div style={{ maxWidth: 720, display: 'flex', flexDirection: 'column', gap: 20 }}>

          <NotifSection icon="mail" title="Email Notifications" description="Notifications sent to your email" items={emailNotifs} color="#0EA5E9" />
          <NotifSection icon="bell" title="Push Notifications" description="In-app and browser notifications" items={pushNotifs} color="#1EBF5E" />
          <NotifSection icon="send" title="Marketing Emails" description="Product updates and promotions" items={marketingNotifs} color="#A78BFA" />
          <NotifSection icon="shield" title="System Alerts" description="Critical system notifications" items={systemNotifs} color="#F59E0B" />

          {/* Save */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
            <Btn onClick={handleSave} disabled={saving} style={{ boxShadow: 'var(--glow)' }}>
              {saving ? 'Saving…' : saved ? '✓ Saved' : 'Save Preferences'}
            </Btn>
            {saved && <span style={{ fontSize: 12, color: 'var(--green)', fontWeight: 600 }}>Preferences updated successfully</span>}
          </div>
        </div>
      </div>
    </div>
  );
}
