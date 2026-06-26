import { useState, useEffect, useRef } from 'react';
import { I } from '../components/Icons.jsx';
import { Btn } from '../components/Btn.jsx';

const card = { background: 'var(--surf)', border: '1px solid var(--bd)', borderRadius: 'var(--rl)', boxShadow: 'var(--card-shadow)' };
const STORAGE_KEY = 'chatflow_integrations_v1';

function loadConnected() {
  try { return JSON.parse(localStorage.getItem(STORAGE_KEY) || '{}'); } catch { return {}; }
}
function saveConnected(obj) { localStorage.setItem(STORAGE_KEY, JSON.stringify(obj)); }

// ─── Integration catalogue ────────────────────────────────────────────────────
const INTEGRATIONS = [
  {
    id: 'whatsapp-pay', name: 'WhatsApp Pay', pricing: 'free', category: 'Payment Provider',
    description: 'Create a frictionless payment experience on WhatsApp to improve conversions',
    features: ['Native WhatsApp payment flow', 'No redirect required', 'Real-time payment confirmation'],
    actions: ['Watch Video', 'Connect'],
    videoQuery: 'WhatsApp Pay setup tutorial',
  },
  {
    id: 'razorpay', name: 'Razorpay', pricing: 'free', category: 'Payment Provider',
    description: 'When customers send WhatsApp carts, send payment links automatically in a checkout botflow',
    features: ['Automatic payment link generation', 'Real-time payment status updates', 'Supports UPI, cards, netbanking'],
    actions: ['Watch Video', 'Connect'],
    videoQuery: 'Razorpay WhatsApp integration tutorial',
  },
  {
    id: 'payu', name: 'PayU', pricing: 'free', category: 'Payment Provider',
    description: 'When customers send WhatsApp carts, send payment links automatically in a auto-checkout workflow',
    features: ['Auto-checkout on cart submission', 'Multi-currency support', 'Instant payment confirmation on WhatsApp'],
    actions: ['Watch Video', 'Connect'],
    videoQuery: 'PayU WhatsApp integration tutorial',
  },
  {
    id: 'aspire', name: 'Aspire', pricing: 'paid', category: 'Payment Provider',
    description: 'Generate and automatically send payment links in WhatsApp carts, enabling a seamless auto-checkout experience',
    features: ['Automated payment link dispatch', 'Cart abandonment recovery', 'Seamless checkout experience'],
    actions: ['Know More', 'Connect'],
    videoQuery: 'Aspire payment WhatsApp integration',
  },
  {
    id: 'xendit', name: 'Xendit', pricing: 'paid', category: 'Payment Provider',
    description: 'Generate and automatically send payment links in WhatsApp carts, enabling a seamless auto-checkout experience',
    features: ['Southeast Asia payment methods', 'Auto payment link in WhatsApp cart', 'VA, e-wallet & card support'],
    actions: ['Know More', 'Connect'],
    videoQuery: 'Xendit WhatsApp payment integration',
  },
  {
    id: 'cashfree', name: 'Cashfree', pricing: 'free', category: 'Payment Provider',
    description: 'Generate and automatically send payment links in WhatsApp carts, enabling a seamless auto-checkout experience',
    features: ['Instant payment links via WhatsApp', 'Refund management', 'Supports 120+ payment modes'],
    actions: ['Know More', 'Connect'],
    videoQuery: 'Cashfree WhatsApp integration tutorial',
  },
  {
    id: 'stripe', name: 'Stripe', pricing: 'paid', category: 'Payment Provider',
    description: 'Create/Update users and send automatic WhatsApp notifications upon Payment status updates on Stripe',
    features: ['Payment success/failure notifications', 'Subscription event alerts', 'Global payment method support'],
    actions: ['Know More', 'Connect'],
    videoQuery: 'Stripe WhatsApp notifications integration',
  },
  {
    id: 'pabbly', name: 'Pabbly Connect', pricing: 'free', category: 'Connector Platform',
    description: 'Send WhatsApp notifications on triggers from any software in the world',
    features: ['Connect 1000+ apps to WhatsApp', 'No-code automation builder', 'Unlimited workflows on free plan'],
    actions: ['View Details'],
    videoQuery: 'Pabbly Connect WhatsApp integration tutorial',
  },
  {
    id: 'integromat', name: 'Integromat (Make)', pricing: 'free', category: 'Connector Platform',
    description: 'Send WhatsApp notifications on triggers from any software in the world',
    features: ['Visual automation builder', 'Real-time scenario execution', 'Advanced filters and routers'],
    actions: ['View Details'],
    videoQuery: 'Integromat Make WhatsApp integration tutorial',
  },
  {
    id: 'zapier', name: 'Zapier', pricing: 'free', category: 'Connector Platform',
    description: 'Send WhatsApp notifications on triggers from any software in the world',
    features: ['6000+ app integrations', 'Multi-step zaps', 'Auto-retry on failure'],
    actions: ['View Details'],
    videoQuery: 'Zapier WhatsApp integration tutorial',
  },
  {
    id: 'google-sheets', name: 'Google Sheets', pricing: 'free', category: 'Data Storage',
    description: 'Send automatic WhatsApp notifications whenever a new row is added in a sheet',
    features: ['New row triggers WhatsApp message', 'Personalized messages from column data', 'Bulk outreach from spreadsheet'],
    actions: ['Know More', 'Connect'],
    videoQuery: 'Google Sheets WhatsApp integration tutorial',
  },
  {
    id: 'shopify-sales', name: 'Shopify Sales Channel', pricing: 'free', category: 'e-Commerce Platform',
    description: 'Auto-sync Shopify products & collections to WhatsApp',
    features: ['Automatic product catalogue sync', 'Collection-level WhatsApp shop', 'Inventory updates in real-time'],
    actions: ['Watch Video', 'View Details'],
    videoQuery: 'Shopify WhatsApp sales channel integration',
  },
  {
    id: 'shopify-marketing', name: 'Shopify Marketing', pricing: 'free', category: 'e-Commerce Platform',
    description: 'Send automatic WhatsApp notifications to recover abandoned carts, confirm CoD Orders & much more',
    features: ['Abandoned cart recovery', 'Cash on Delivery confirmation', 'Order & shipping notifications'],
    actions: ['Watch Video', 'View Details'],
    videoQuery: 'Shopify WhatsApp marketing automation tutorial',
  },
  {
    id: 'woocommerce', name: 'WooCommerce', pricing: 'free', category: 'e-Commerce Platform',
    description: 'Send automatic WhatsApp notifications to recover abandoned carts, confirm orders & much more',
    features: ['Order confirmation & updates via WhatsApp', 'Abandoned cart messages', 'Refund & cancellation alerts'],
    actions: ['View Details'],
    videoQuery: 'WooCommerce WhatsApp integration tutorial',
  },
  {
    id: 'yampi', name: 'Yampi', pricing: 'free', category: 'e-Commerce Platform',
    description: 'Create/Update users and send automatic WhatsApp notifications upon different events from your Yampi store',
    features: ['Order lifecycle notifications', 'Customer auto-creation in ChatFlow', 'Brazilian e-commerce native support'],
    actions: ['Know More', 'Connect'],
    videoQuery: 'Yampi WhatsApp integration tutorial',
  },
  {
    id: 'facebook-lead', name: 'Facebook Lead Form', pricing: 'paid', category: 'Ads Platform',
    description: 'As soon as a lead fills the form, add them in Interakt & send an automatic welcome notification',
    features: ['Instant lead capture to contacts', 'Automated welcome WhatsApp message', 'Lead nurturing sequences'],
    actions: ['Connect'],
    videoQuery: 'Facebook Lead Form WhatsApp integration tutorial',
  },
  {
    id: 'zoho-crm', name: 'Zoho CRM', pricing: 'paid', category: 'CRM Platform',
    description: 'Create/Update users and send automatic WhatsApp notifications upon user/lead creation or updation in Zoho',
    features: ['Bi-directional contact sync', 'Lead creation triggers WhatsApp', 'Deal stage notifications'],
    actions: ['Know More', 'Connect'],
    videoQuery: 'Zoho CRM WhatsApp integration tutorial',
  },
  {
    id: 'hubspot', name: 'HubSpot', pricing: 'paid', category: 'CRM Platform',
    description: 'Create/Update users and send automatic WhatsApp notifications upon user/lead creation or updation in HubSpot',
    features: ['Contact sync with HubSpot CRM', 'Deal-stage triggered messages', 'WhatsApp activity logged in HubSpot'],
    actions: ['Know More', 'Connect'],
    videoQuery: 'HubSpot WhatsApp integration tutorial',
  },
  {
    id: 'salesforce', name: 'Salesforce', pricing: 'paid', category: 'CRM Platform',
    description: 'Create/Update users and send automatic WhatsApp notifications upon user/lead creation or updation in Salesforce',
    features: ['Salesforce lead/contact sync', 'Opportunity event notifications', 'WhatsApp conversations in Salesforce'],
    actions: ['Know More', 'Connect'],
    videoQuery: 'Salesforce WhatsApp integration tutorial',
  },
  {
    id: 'zoho-bigin', name: 'Zoho Bigin CRM', pricing: 'paid', category: 'CRM Platform',
    description: 'Create/Update users and send automatic WhatsApp notifications upon Contact/Company creation or updation',
    features: ['Pipeline stage WhatsApp alerts', 'Auto-create contacts from WhatsApp', 'Company-level notifications'],
    actions: ['Know More', 'Connect'],
    videoQuery: 'Zoho Bigin WhatsApp integration',
  },
  {
    id: 'freshworks-crm', name: 'Freshworks CRM', pricing: 'paid', category: 'CRM Platform',
    description: 'Freshworks CRM is a platform for sales and marketing people to sell faster and market smarter',
    features: ['Sales pipeline WhatsApp alerts', 'Contact activity triggers', 'Deal win/loss notifications'],
    actions: ['Know More', 'Connect'],
    videoQuery: 'Freshworks CRM WhatsApp integration',
  },
  {
    id: 'freshdesk', name: 'Freshdesk v2', pricing: 'paid', category: 'Helpdesk Platform',
    description: 'Create/Update users and send automatic WhatsApp notifications upon Ticket creation or updation on Freshdesk',
    features: ['Ticket creation triggers WhatsApp alert', 'Status change notifications to customer', 'Agent assignment messages'],
    actions: ['Know More', 'Connect'],
    videoQuery: 'Freshdesk WhatsApp integration tutorial',
  },
  {
    id: 'zoho-billing', name: 'Zoho Billing', pricing: 'paid', category: 'Billing Platform',
    description: 'Create/Update users and send automatic WhatsApp notifications upon Subscription/Invoice creation or updation',
    features: ['Invoice sent via WhatsApp', 'Subscription renewal reminders', 'Payment failure alerts'],
    actions: ['Know More', 'Connect'],
    videoQuery: 'Zoho Billing WhatsApp integration',
  },
  {
    id: 'zoho-books', name: 'Zoho Books', pricing: 'paid', category: 'Billing Platform',
    description: 'Accounting software for businesses — send invoices, payment reminders & receipts via WhatsApp',
    features: ['Invoice delivery via WhatsApp', 'Payment receipt notifications', 'Overdue payment reminders'],
    actions: ['Know More', 'Connect'],
    videoQuery: 'Zoho Books WhatsApp integration',
  },
  {
    id: 'judge-me', name: 'Judge.me', pricing: 'paid', category: 'Product Review Platform',
    description: 'Create/Update a Review on Judge.me when a customer completes a Feedback workflow on Interakt',
    features: ['WhatsApp feedback → Judge.me review', 'Automated review request campaigns', 'Photo review collection'],
    actions: ['Know More', 'Connect'],
    videoQuery: 'Judge.me review WhatsApp integration',
  },
  {
    id: 'calendly', name: 'Calendly', pricing: 'paid', category: 'Scheduling Platform',
    description: 'Calendly is an online meeting scheduling platform — send booking confirmations & reminders via WhatsApp',
    features: ['Meeting booked → WhatsApp confirmation', 'Reminder messages before meeting', 'Rescheduling & cancellation alerts'],
    actions: ['Know More', 'Connect'],
    videoQuery: 'Calendly WhatsApp integration tutorial',
  },
  {
    id: 'wafeq', name: 'Wafeq', pricing: 'paid', category: 'Accounting Software',
    description: 'Send invoices to customers via WhatsApp directly from Wafeq accounting software',
    features: ['One-click invoice via WhatsApp', 'Arabic & English invoice support', 'VAT-compliant invoicing'],
    actions: ['Know More', 'Connect'],
    videoQuery: 'Wafeq WhatsApp accounting integration',
  },
];

// ─── Connect configuration per integration ───────────────────────────────────
const CONNECT_CONFIG = {
  'whatsapp-pay':     { type: 'info',    message: 'WhatsApp Pay is configured directly in your Meta Business Manager. Once enabled, it works natively inside WhatsApp without additional API keys.', linkLabel: 'Open Meta Business Manager', linkUrl: 'https://business.facebook.com' },
  'razorpay':         { type: 'apikey',  fields: [{ key: 'key_id', label: 'Key ID', placeholder: 'rzp_live_xxxxxxxxxxxx' }, { key: 'key_secret', label: 'Key Secret', placeholder: 'Enter your key secret', password: true }] },
  'payu':             { type: 'apikey',  fields: [{ key: 'merchant_key', label: 'Merchant Key', placeholder: 'Your PayU merchant key' }, { key: 'merchant_salt', label: 'Merchant Salt', placeholder: 'Enter your merchant salt', password: true }] },
  'aspire':           { type: 'apikey',  fields: [{ key: 'api_key', label: 'API Key', placeholder: 'Your Aspire API key' }, { key: 'account_id', label: 'Account ID', placeholder: 'asp_xxxxxxxx' }] },
  'xendit':           { type: 'apikey',  fields: [{ key: 'secret_key', label: 'Secret Key', placeholder: 'xnd_production_xxxxxxxxxxxx' }] },
  'cashfree':         { type: 'apikey',  fields: [{ key: 'app_id', label: 'App ID', placeholder: 'Your Cashfree App ID' }, { key: 'secret_key', label: 'Secret Key', placeholder: 'Enter your secret key', password: true }] },
  'stripe':           { type: 'apikey',  fields: [{ key: 'secret_key', label: 'Secret Key', placeholder: 'sk_live_xxxxxxxxxxxx' }, { key: 'webhook_secret', label: 'Webhook Secret', placeholder: 'whsec_xxxxxxxxxxxx' }] },
  'pabbly':           { type: 'webhook', hint: 'Copy this webhook URL into your Pabbly Connect workflow as a Webhook trigger.' },
  'integromat':       { type: 'webhook', hint: 'Copy this URL into your Make (Integromat) scenario as a Custom Webhook module.' },
  'zapier':           { type: 'webhook', hint: 'Copy this URL into your Zapier Zap using the "Webhooks by Zapier" Catch Hook trigger.' },
  'google-sheets':    { type: 'oauth',   provider: 'Google' },
  'shopify-sales':    { type: 'apikey',  fields: [{ key: 'shop_url', label: 'Shop URL', placeholder: 'yourstore.myshopify.com' }, { key: 'api_key', label: 'API Key', placeholder: 'Your Shopify Admin API key' }, { key: 'api_secret', label: 'API Secret Key', placeholder: 'Enter your API secret key', password: true }] },
  'shopify-marketing':{ type: 'apikey',  fields: [{ key: 'shop_url', label: 'Shop URL', placeholder: 'yourstore.myshopify.com' }, { key: 'api_key', label: 'API Key', placeholder: 'Your Shopify Admin API key' }, { key: 'api_secret', label: 'API Secret Key', placeholder: 'Enter your API secret key', password: true }] },
  'woocommerce':      { type: 'apikey',  fields: [{ key: 'site_url', label: 'Site URL', placeholder: 'https://yourstore.com' }, { key: 'consumer_key', label: 'Consumer Key', placeholder: 'ck_xxxxxxxxxxxx' }, { key: 'consumer_secret', label: 'Consumer Secret', placeholder: 'cs_xxxxxxxxxxxx', password: true }] },
  'yampi':            { type: 'apikey',  fields: [{ key: 'api_key', label: 'API Key', placeholder: 'Your Yampi API key' }, { key: 'store_alias', label: 'Store Alias', placeholder: 'yourstore' }] },
  'facebook-lead':    { type: 'oauth',   provider: 'Facebook' },
  'zoho-crm':         { type: 'oauth',   provider: 'Zoho' },
  'hubspot':          { type: 'oauth',   provider: 'HubSpot' },
  'salesforce':       { type: 'oauth',   provider: 'Salesforce' },
  'zoho-bigin':       { type: 'oauth',   provider: 'Zoho Bigin' },
  'freshworks-crm':   { type: 'apikey',  fields: [{ key: 'domain', label: 'Domain', placeholder: 'yourcompany.freshworks.com' }, { key: 'api_key', label: 'API Key', placeholder: 'Your Freshworks API key' }] },
  'freshdesk':        { type: 'apikey',  fields: [{ key: 'domain', label: 'Domain', placeholder: 'yourcompany.freshdesk.com' }, { key: 'api_key', label: 'API Key', placeholder: 'Your Freshdesk API key' }] },
  'zoho-billing':     { type: 'oauth',   provider: 'Zoho Billing' },
  'zoho-books':       { type: 'oauth',   provider: 'Zoho Books' },
  'judge-me':         { type: 'apikey',  fields: [{ key: 'private_token', label: 'Private Token', placeholder: 'Your Judge.me private token' }, { key: 'shop_domain', label: 'Shop Domain', placeholder: 'yourstore.myshopify.com' }] },
  'calendly':         { type: 'oauth',   provider: 'Calendly' },
  'wafeq':            { type: 'apikey',  fields: [{ key: 'api_key', label: 'API Key', placeholder: 'Your Wafeq API key' }, { key: 'organisation_id', label: 'Organisation ID', placeholder: 'wfq_org_xxxxxx' }] },
};

const CATEGORIES = ['All', ...Array.from(new Set(INTEGRATIONS.map(i => i.category)))];

const CATEGORY_ICONS = {
  'Payment Provider':        'credit',
  'Connector Platform':      'zap',
  'Data Storage':            'db',
  'e-Commerce Platform':     'globe',
  'Ads Platform':            'chart',
  'CRM Platform':            'users',
  'Helpdesk Platform':       'msg',
  'Billing Platform':        'note',
  'Product Review Platform': 'spark',
  'Scheduling Platform':     'bell',
  'Accounting Software':     'file',
};

const LOGO_COLORS = ['#1EBF5E', '#0EA5E9', '#A78BFA', '#F59E0B', '#F472B6', '#34D399', '#60A5FA', '#FB923C'];

// ─── Helpers ─────────────────────────────────────────────────────────────────
function getWorkspaceId() {
  try { return JSON.parse(localStorage.getItem('user') || '{}').workspaceId || 'ws'; } catch { return 'ws'; }
}

function webhookUrl(id) {
  return `https://hooks.chatflowpro.com/wh/${getWorkspaceId()}/${id}`;
}

// ─── Sub-components ───────────────────────────────────────────────────────────
function LogoBadge({ name, size = 42 }) {
  const initials = name.split(/\s+/).map(w => w[0]).join('').slice(0, 2).toUpperCase();
  const col = LOGO_COLORS[name.charCodeAt(0) % LOGO_COLORS.length];
  return (
    <div style={{ width: size, height: size, borderRadius: size * 0.24, background: `${col}18`, border: `1.5px solid ${col}44`, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: size * 0.3, fontWeight: 700, color: col, flexShrink: 0 }}>
      {initials}
    </div>
  );
}

function FieldInput({ field, value, onChange }) {
  const [show, setShow] = useState(false);
  const type = field.password && !show ? 'password' : 'text';
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
      <label style={{ fontSize: 11.5, fontWeight: 600, color: 'var(--t2)' }}>{field.label}</label>
      <div style={{ position: 'relative' }}>
        <input
          type={type}
          value={value}
          onChange={e => onChange(e.target.value)}
          placeholder={field.placeholder}
          style={{ width: '100%', padding: field.password ? '9px 36px 9px 12px' : '9px 12px', borderRadius: 8, background: 'rgba(255,255,255,0.04)', border: '1px solid var(--bd)', color: 'var(--t1)', fontSize: 13, outline: 'none', boxSizing: 'border-box', fontFamily: 'inherit' }}
          onFocus={e => e.target.style.borderColor = 'rgba(30,191,94,0.5)'}
          onBlur={e => e.target.style.borderColor = 'var(--bd)'}
        />
        {field.password && (
          <button onClick={() => setShow(s => !s)} type="button"
            style={{ position: 'absolute', right: 10, top: '50%', transform: 'translateY(-50%)', background: 'none', border: 'none', cursor: 'pointer', padding: 0, display: 'flex', color: 'var(--t3)' }}>
            <I n={show ? 'eyeoff' : 'eye'} s={14} c="var(--t3)" />
          </button>
        )}
      </div>
    </div>
  );
}

// ─── Connect Modal ────────────────────────────────────────────────────────────
function ConnectModal({ intg, onClose, onSave }) {
  const cfg = CONNECT_CONFIG[intg.id] || { type: 'info', message: 'Contact support to enable this integration.' };
  const [values, setValues] = useState({});
  const [saving, setSaving] = useState(false);
  const [copied, setCopied] = useState(false);

  const setField = (key, val) => setValues(v => ({ ...v, [key]: val }));

  const wUrl = webhookUrl(intg.id);

  const canSave = () => {
    if (cfg.type === 'apikey') return cfg.fields.every(f => values[f.key]?.trim());
    if (cfg.type === 'oauth')  return true;
    if (cfg.type === 'webhook') return true;
    return true;
  };

  const handleSave = async () => {
    setSaving(true);
    await new Promise(r => setTimeout(r, 1100));
    onSave(intg.id, cfg.type === 'webhook' ? { webhook_url: wUrl } : cfg.type === 'oauth' ? { oauth: true } : values);
  };

  const copyUrl = () => {
    navigator.clipboard.writeText(wUrl).then(() => { setCopied(true); setTimeout(() => setCopied(false), 2200); }).catch(() => {});
  };

  return (
    <div onClick={onClose} style={{ position: 'fixed', inset: 0, background: 'rgba(3,5,12,0.78)', backdropFilter: 'blur(4px)', zIndex: 100, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 20 }}>
      <div onClick={e => e.stopPropagation()} style={{ ...card, width: '100%', maxWidth: 480, maxHeight: '85vh', display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
        {/* Header */}
        <div style={{ padding: '16px 20px', borderBottom: '1px solid var(--bd)', display: 'flex', alignItems: 'center', gap: 14 }}>
          <LogoBadge name={intg.name} size={36} />
          <div style={{ flex: 1 }}>
            <p style={{ fontFamily: "'Syne',sans-serif", fontWeight: 700, fontSize: 15, color: 'var(--t1)' }}>Connect {intg.name}</p>
            <p style={{ fontSize: 11.5, color: 'var(--t2)', marginTop: 2 }}>{intg.category}</p>
          </div>
          <button onClick={onClose} style={{ width: 28, height: 28, borderRadius: 6, background: 'rgba(255,255,255,0.04)', border: '1px solid var(--bd)', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
            <I n="x" s={12} c="var(--t2)" />
          </button>
        </div>

        {/* Body */}
        <div style={{ padding: 20, overflowY: 'auto', flex: 1, display: 'flex', flexDirection: 'column', gap: 16 }}>

          {cfg.type === 'apikey' && (
            <>
              <p style={{ fontSize: 12.5, color: 'var(--t2)', lineHeight: 1.6 }}>
                Enter your {intg.name} API credentials. These are stored securely and used to authenticate API calls on your behalf.
              </p>
              {cfg.fields.map(f => (
                <FieldInput key={f.key} field={f} value={values[f.key] || ''} onChange={v => setField(f.key, v)} />
              ))}
            </>
          )}

          {cfg.type === 'oauth' && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 14, alignItems: 'center', textAlign: 'center', padding: '10px 0' }}>
              <LogoBadge name={intg.name} size={56} />
              <div>
                <p style={{ fontSize: 14, fontWeight: 700, color: 'var(--t1)', marginBottom: 6 }}>Authorize {cfg.provider}</p>
                <p style={{ fontSize: 12.5, color: 'var(--t2)', lineHeight: 1.65 }}>
                  You'll be redirected to {cfg.provider} to grant ChatFlow Pro access to your account. No passwords are stored — only an OAuth token.
                </p>
              </div>
              <div style={{ width: '100%', padding: '12px 16px', borderRadius: 10, background: 'rgba(30,191,94,0.06)', border: '1px solid var(--gbd)', display: 'flex', gap: 10, textAlign: 'left', alignItems: 'flex-start' }}>
                <I n="shield" s={16} c="var(--green)" />
                <p style={{ fontSize: 12, color: 'var(--t2)', lineHeight: 1.6 }}>
                  We only request the minimum permissions needed. You can revoke access from your {cfg.provider} account settings at any time.
                </p>
              </div>
            </div>
          )}

          {cfg.type === 'webhook' && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
              <div style={{ padding: '12px 16px', borderRadius: 10, background: 'rgba(30,191,94,0.06)', border: '1px solid var(--gbd)', display: 'flex', gap: 10, alignItems: 'flex-start' }}>
                <I n="alertc" s={16} c="var(--green)" />
                <p style={{ fontSize: 12.5, color: 'var(--t2)', lineHeight: 1.65 }}>{cfg.hint}</p>
              </div>
              <div>
                <p style={{ fontSize: 11.5, fontWeight: 600, color: 'var(--t2)', marginBottom: 8 }}>Your Webhook URL</p>
                <div style={{ display: 'flex', gap: 8 }}>
                  <code style={{ flex: 1, padding: '9px 12px', borderRadius: 8, background: 'rgba(255,255,255,0.04)', border: '1px solid var(--bd)', color: 'var(--t1)', fontSize: 11.5, fontFamily: 'monospace', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {wUrl}
                  </code>
                  <button onClick={copyUrl}
                    style={{ padding: '9px 14px', borderRadius: 8, background: copied ? 'rgba(30,191,94,0.15)' : 'rgba(255,255,255,0.05)', border: `1px solid ${copied ? 'var(--gbd)' : 'var(--bd)'}`, cursor: 'pointer', fontSize: 12, fontWeight: 600, color: copied ? 'var(--green)' : 'var(--t2)', display: 'flex', alignItems: 'center', gap: 6, whiteSpace: 'nowrap', transition: 'all .2s' }}>
                    <I n={copied ? 'check' : 'copy'} s={13} c={copied ? 'var(--green)' : 'var(--t2)'} />
                    {copied ? 'Copied!' : 'Copy'}
                  </button>
                </div>
              </div>
              <p style={{ fontSize: 12, color: 'var(--t3)', lineHeight: 1.6 }}>
                After pasting the URL into {intg.name}, click <strong style={{ color: 'var(--t2)' }}>Activate</strong> below to mark this integration as active.
              </p>
            </div>
          )}

          {cfg.type === 'info' && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
              <div style={{ padding: '14px 16px', borderRadius: 10, background: 'rgba(255,255,255,0.03)', border: '1px solid var(--bd)' }}>
                <p style={{ fontSize: 13, color: 'var(--t2)', lineHeight: 1.65 }}>{cfg.message}</p>
              </div>
              {cfg.linkUrl && (
                <a href={cfg.linkUrl} target="_blank" rel="noopener noreferrer"
                  style={{ display: 'inline-flex', alignItems: 'center', gap: 7, padding: '9px 14px', borderRadius: 8, background: 'rgba(255,255,255,0.04)', border: '1px solid var(--bd)', color: 'var(--t1)', fontSize: 13, fontWeight: 600, textDecoration: 'none' }}>
                  <I n="globe" s={14} c="var(--t2)" />
                  {cfg.linkLabel}
                  <I n="arrow" s={13} c="var(--t3)" />
                </a>
              )}
            </div>
          )}
        </div>

        {/* Footer */}
        <div style={{ padding: '14px 20px', borderTop: '1px solid var(--bd)', display: 'flex', gap: 10, justifyContent: 'flex-end' }}>
          <button onClick={onClose} style={{ padding: '8px 16px', borderRadius: 8, background: 'rgba(255,255,255,0.04)', border: '1px solid var(--bd)', color: 'var(--t2)', fontSize: 13, fontWeight: 600, cursor: 'pointer' }}>
            Cancel
          </button>
          {cfg.type !== 'info' && (
            <button
              onClick={handleSave}
              disabled={!canSave() || saving}
              style={{ padding: '8px 20px', borderRadius: 8, background: canSave() && !saving ? 'var(--green)' : 'rgba(30,191,94,0.3)', border: '1px solid var(--gbd)', color: '#060A10', fontSize: 13, fontWeight: 700, cursor: canSave() && !saving ? 'pointer' : 'not-allowed', display: 'flex', alignItems: 'center', gap: 7, transition: 'opacity .15s', boxShadow: canSave() && !saving ? 'var(--glow)' : 'none' }}>
              {saving ? (
                <><span style={{ width: 14, height: 14, border: '2px solid rgba(6,10,16,0.3)', borderTopColor: '#060A10', borderRadius: '50%', display: 'inline-block', animation: 'spin .6s linear infinite' }} />Connecting…</>
              ) : (
                <><I n={cfg.type === 'oauth' ? 'arrow' : 'checkc'} s={14} c="#060A10" />{cfg.type === 'oauth' ? `Authorize with ${cfg.provider}` : cfg.type === 'webhook' ? 'Activate' : 'Save & Connect'}</>
              )}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

// ─── Info / Detail Modal ──────────────────────────────────────────────────────
function InfoModal({ intg, isConnected, onClose, onConnectClick }) {
  const catIcon = CATEGORY_ICONS[intg.category] || 'plug';
  return (
    <div onClick={onClose} style={{ position: 'fixed', inset: 0, background: 'rgba(3,5,12,0.78)', backdropFilter: 'blur(4px)', zIndex: 100, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 20 }}>
      <div onClick={e => e.stopPropagation()} style={{ ...card, width: '100%', maxWidth: 500, maxHeight: '85vh', display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
        {/* Header */}
        <div style={{ padding: '16px 20px', borderBottom: '1px solid var(--bd)', display: 'flex', alignItems: 'center', gap: 14 }}>
          <LogoBadge name={intg.name} size={40} />
          <div style={{ flex: 1 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
              <p style={{ fontFamily: "'Syne',sans-serif", fontWeight: 700, fontSize: 15, color: 'var(--t1)' }}>{intg.name}</p>
              <span style={{ fontSize: 10, fontWeight: 700, padding: '2px 8px', borderRadius: 20, background: intg.pricing === 'free' ? 'var(--gbg)' : 'rgba(245,158,11,0.1)', border: `1px solid ${intg.pricing === 'free' ? 'var(--gbd)' : 'rgba(245,158,11,0.3)'}`, color: intg.pricing === 'free' ? 'var(--green)' : '#fbbf24' }}>
                {intg.pricing}
              </span>
              {isConnected && (
                <span style={{ fontSize: 10, fontWeight: 700, padding: '2px 8px', borderRadius: 20, background: 'var(--gbg)', border: '1px solid var(--gbd)', color: 'var(--green)', display: 'flex', alignItems: 'center', gap: 4 }}>
                  <I n="checkc" s={10} c="var(--green)" /> Connected
                </span>
              )}
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 5, marginTop: 4 }}>
              <I n={catIcon} s={11} c="var(--t3)" />
              <span style={{ fontSize: 11, color: 'var(--t3)' }}>{intg.category}</span>
            </div>
          </div>
          <button onClick={onClose} style={{ width: 28, height: 28, borderRadius: 6, background: 'rgba(255,255,255,0.04)', border: '1px solid var(--bd)', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
            <I n="x" s={12} c="var(--t2)" />
          </button>
        </div>

        {/* Body */}
        <div style={{ padding: 20, overflowY: 'auto', flex: 1, display: 'flex', flexDirection: 'column', gap: 18 }}>
          <p style={{ fontSize: 13, color: 'var(--t2)', lineHeight: 1.65 }}>{intg.description}</p>

          <div>
            <p style={{ fontSize: 10, fontWeight: 700, color: 'var(--t3)', textTransform: 'uppercase', letterSpacing: '.08em', marginBottom: 10 }}>Key Capabilities</p>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              {intg.features.map((f, i) => (
                <div key={i} style={{ display: 'flex', alignItems: 'flex-start', gap: 10 }}>
                  <div style={{ width: 20, height: 20, borderRadius: 6, background: 'var(--gbg)', border: '1px solid var(--gbd)', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0, marginTop: 1 }}>
                    <I n="check" s={10} c="var(--green)" />
                  </div>
                  <p style={{ fontSize: 13, color: 'var(--t1)', lineHeight: 1.5 }}>{f}</p>
                </div>
              ))}
            </div>
          </div>

          <div style={{ padding: '12px 16px', borderRadius: 10, background: 'rgba(255,255,255,0.02)', border: '1px solid var(--bd)', display: 'flex', gap: 10, alignItems: 'flex-start' }}>
            <I n="alertc" s={15} c="var(--t3)" />
            <p style={{ fontSize: 12, color: 'var(--t3)', lineHeight: 1.6 }}>
              {intg.pricing === 'paid'
                ? 'This integration requires a paid plan. Contact your workspace admin to upgrade.'
                : 'This integration is available on all plans including free.'}
            </p>
          </div>
        </div>

        {/* Footer */}
        <div style={{ padding: '14px 20px', borderTop: '1px solid var(--bd)', display: 'flex', gap: 10, justifyContent: 'flex-end' }}>
          <button onClick={onClose} style={{ padding: '8px 16px', borderRadius: 8, background: 'rgba(255,255,255,0.04)', border: '1px solid var(--bd)', color: 'var(--t2)', fontSize: 13, fontWeight: 600, cursor: 'pointer' }}>
            Close
          </button>
          {!isConnected && (
            <button onClick={onConnectClick}
              style={{ padding: '8px 20px', borderRadius: 8, background: 'var(--green)', border: '1px solid var(--gbd)', color: '#060A10', fontSize: 13, fontWeight: 700, cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 7, boxShadow: 'var(--glow)' }}>
              <I n="plug" s={13} c="#060A10" />
              Connect
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

// ─── Integration Card ─────────────────────────────────────────────────────────
function IntegrationCard({ intg, isConnected, onAction, onDisconnect }) {
  const catIcon = CATEGORY_ICONS[intg.category] || 'plug';
  return (
    <div style={{ ...card, padding: 18, display: 'flex', flexDirection: 'column', gap: 13, transition: 'border-color .15s', position: 'relative' }}
      onMouseEnter={e => e.currentTarget.style.borderColor = isConnected ? 'var(--gbd)' : 'rgba(30,191,94,0.3)'}
      onMouseLeave={e => e.currentTarget.style.borderColor = 'var(--bd)'}
    >
      {isConnected && (
        <div style={{ position: 'absolute', top: 14, right: 14, display: 'flex', alignItems: 'center', gap: 5, padding: '3px 9px', borderRadius: 20, background: 'var(--gbg)', border: '1px solid var(--gbd)', fontSize: 10, fontWeight: 700, color: 'var(--green)' }}>
          <I n="checkc" s={10} c="var(--green)" /> Connected
        </div>
      )}

      <div style={{ display: 'flex', alignItems: 'flex-start', gap: 12 }}>
        <LogoBadge name={intg.name} />
        <div style={{ flex: 1, minWidth: 0, paddingRight: isConnected ? 80 : 0 }}>
          <span style={{ fontSize: 14, fontWeight: 700, color: 'var(--t1)' }}>{intg.name}</span>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginTop: 4, flexWrap: 'wrap' }}>
            <span style={{ fontSize: 10, fontWeight: 700, padding: '2px 7px', borderRadius: 20, background: intg.pricing === 'free' ? 'var(--gbg)' : 'rgba(245,158,11,0.1)', border: `1px solid ${intg.pricing === 'free' ? 'var(--gbd)' : 'rgba(245,158,11,0.3)'}`, color: intg.pricing === 'free' ? 'var(--green)' : '#fbbf24' }}>
              {intg.pricing}
            </span>
            <span style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: 11, color: 'var(--t3)' }}>
              <I n={catIcon} s={10} c="var(--t3)" />
              {intg.category}
            </span>
          </div>
        </div>
      </div>

      <p style={{ fontSize: 12.5, color: 'var(--t2)', lineHeight: 1.6, flex: 1 }}>{intg.description}</p>

      <div style={{ display: 'flex', gap: 7, flexWrap: 'wrap', alignItems: 'center' }}>
        {intg.actions.map(a => {
          const isPrimary = a === 'Connect';
          return (
            <button key={a} onClick={() => onAction(a, intg)}
              style={{ padding: '6px 12px', borderRadius: 7, fontSize: 12, fontWeight: 600, cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 5, transition: 'opacity .15s, background .15s', background: isPrimary ? 'var(--green)' : 'rgba(255,255,255,0.05)', color: isPrimary ? '#060A10' : 'var(--t2)', border: isPrimary ? '1px solid var(--gbd)' : '1px solid var(--bd)', boxShadow: isPrimary ? 'var(--glow)' : 'none' }}
              onMouseEnter={e => e.currentTarget.style.opacity = '0.82'}
              onMouseLeave={e => e.currentTarget.style.opacity = '1'}
            >
              {a === 'Watch Video' && <I n="play" s={11} c="var(--t2)" />}
              {isPrimary && <I n="plug" s={11} c="#060A10" />}
              {a}
            </button>
          );
        })}
        {isConnected && (
          <button onClick={() => onDisconnect(intg.id)}
            style={{ padding: '6px 12px', borderRadius: 7, fontSize: 12, fontWeight: 600, cursor: 'pointer', background: 'rgba(239,68,68,0.07)', border: '1px solid rgba(239,68,68,0.2)', color: '#f87171', marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 5, transition: 'opacity .15s' }}
            onMouseEnter={e => e.currentTarget.style.opacity = '0.82'}
            onMouseLeave={e => e.currentTarget.style.opacity = '1'}
          >
            <I n="ban" s={11} c="#f87171" />
            Disconnect
          </button>
        )}
      </div>
    </div>
  );
}

// ─── Main View ────────────────────────────────────────────────────────────────
export default function IntegrationsView() {
  const [connected, setConnected] = useState(loadConnected);
  const [activeCategory, setActiveCategory] = useState('All');
  const [search, setSearch] = useState('');
  const [connectModal, setConnectModal] = useState(null);
  const [infoModal, setInfoModal] = useState(null);

  const filtered = INTEGRATIONS.filter(intg => {
    const matchCat = activeCategory === 'All' || intg.category === activeCategory;
    const q = search.toLowerCase();
    const matchSearch = !q || intg.name.toLowerCase().includes(q) || intg.category.toLowerCase().includes(q) || intg.description.toLowerCase().includes(q);
    return matchCat && matchSearch;
  });

  function handleAction(action, intg) {
    if (action === 'Watch Video') {
      const q = encodeURIComponent(intg.videoQuery || `${intg.name} WhatsApp integration`);
      window.open(`https://www.youtube.com/results?search_query=${q}`, '_blank', 'noopener,noreferrer');
    } else if (action === 'Connect') {
      setConnectModal(intg);
    } else {
      setInfoModal(intg);
    }
  }

  function handleSave(id, values) {
    const updated = { ...connected, [id]: values };
    setConnected(updated);
    saveConnected(updated);
    setConnectModal(null);
  }

  function handleDisconnect(id) {
    const updated = { ...connected };
    delete updated[id];
    setConnected(updated);
    saveConnected(updated);
  }

  function openConnectFromInfo(intg) {
    setInfoModal(null);
    setConnectModal(intg);
  }

  const connectedCount = Object.keys(connected).length;

  return (
    <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
      <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>

      {/* Header */}
      <div style={{ height: 58, borderBottom: '1px solid var(--bd)', display: 'flex', alignItems: 'center', padding: '0 28px', gap: 16, flexShrink: 0, background: 'var(--surf)' }}>
        <div style={{ flex: 1 }}>
          <h1 style={{ fontFamily: "'Syne',sans-serif", fontWeight: 800, fontSize: 16, color: 'var(--t1)', letterSpacing: '-.02em' }}>Integrations</h1>
          <p style={{ fontSize: 11.5, color: 'var(--t2)', marginTop: 1 }}>
            Connect your favourite apps · <span style={{ color: 'var(--green)', fontWeight: 600 }}>{connectedCount} connected</span>
          </p>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 7, padding: '7px 12px', borderRadius: 8, background: 'rgba(255,255,255,0.04)', border: '1px solid var(--bd)', width: 220 }}>
          <I n="search" s={13} c="var(--t2)" />
          <input
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder="Search integrations…"
            style={{ flex: 1, background: 'none', border: 'none', outline: 'none', fontSize: 13, color: 'var(--t1)', fontFamily: 'inherit' }}
          />
          {search && (
            <button onClick={() => setSearch('')} style={{ background: 'none', border: 'none', cursor: 'pointer', padding: 0, display: 'flex' }}>
              <I n="x" s={12} c="var(--t3)" />
            </button>
          )}
        </div>
      </div>

      <div style={{ flex: 1, overflowY: 'auto', padding: '20px 28px', display: 'flex', flexDirection: 'column', gap: 20 }}>

        {/* Category chips */}
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          {CATEGORIES.map(cat => {
            const on = activeCategory === cat;
            const count = cat === 'All' ? INTEGRATIONS.length : INTEGRATIONS.filter(i => i.category === cat).length;
            return (
              <button key={cat} onClick={() => setActiveCategory(cat)}
                style={{ padding: '6px 14px', borderRadius: 20, fontSize: 12, fontWeight: on ? 700 : 500, cursor: 'pointer', transition: 'all .15s', background: on ? 'var(--green)' : 'rgba(255,255,255,0.04)', color: on ? '#060A10' : 'var(--t2)', border: on ? '1px solid var(--gbd)' : '1px solid var(--bd)' }}>
                {cat}
                <span style={{ marginLeft: 5, opacity: 0.65, fontSize: 11 }}>{count}</span>
              </button>
            );
          })}
        </div>

        {/* Stats bar */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
          <span style={{ fontSize: 12, color: 'var(--t2)' }}>
            Showing <strong style={{ color: 'var(--t1)' }}>{filtered.length}</strong> of {INTEGRATIONS.length} integrations
          </span>
          <div style={{ flex: 1, height: 1, background: 'var(--bd)' }} />
          <span style={{ fontSize: 11, color: 'var(--green)', display: 'flex', alignItems: 'center', gap: 4 }}>
            <span style={{ width: 6, height: 6, borderRadius: '50%', background: 'var(--green)', display: 'inline-block' }} />
            {INTEGRATIONS.filter(i => i.pricing === 'free').length} Free
          </span>
          <span style={{ fontSize: 11, color: '#fbbf24', display: 'flex', alignItems: 'center', gap: 4 }}>
            <span style={{ width: 6, height: 6, borderRadius: '50%', background: '#fbbf24', display: 'inline-block' }} />
            {INTEGRATIONS.filter(i => i.pricing === 'paid').length} Paid
          </span>
        </div>

        {/* Grid */}
        {filtered.length === 0 ? (
          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', padding: '60px 0', gap: 14, color: 'var(--t2)' }}>
            <div style={{ width: 52, height: 52, borderRadius: 14, background: 'var(--surf)', border: '1px solid var(--bd)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
              <I n="search" s={22} c="var(--t2)" />
            </div>
            <p style={{ fontSize: 14, color: 'var(--t2)' }}>No integrations match your search.</p>
          </div>
        ) : (
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(290px, 1fr))', gap: 14 }}>
            {filtered.map(intg => (
              <IntegrationCard
                key={intg.id}
                intg={intg}
                isConnected={!!connected[intg.id]}
                onAction={handleAction}
                onDisconnect={handleDisconnect}
              />
            ))}
          </div>
        )}
      </div>

      {/* Modals */}
      {connectModal && (
        <ConnectModal
          intg={connectModal}
          onClose={() => setConnectModal(null)}
          onSave={handleSave}
        />
      )}
      {infoModal && (
        <InfoModal
          intg={infoModal}
          isConnected={!!connected[infoModal.id]}
          onClose={() => setInfoModal(null)}
          onConnectClick={() => openConnectFromInfo(infoModal)}
        />
      )}
    </div>
  );
}
