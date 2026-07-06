import { useState, useEffect, useRef } from 'react';
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

const Toast = ({ message, type = 'success', onClose }) => {
  useEffect(() => { const t = setTimeout(onClose, 3000); return () => clearTimeout(t); }, [onClose]);
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

const SectionCard = ({ icon, title, subtitle, children, color = 'var(--green)' }) => (
  <div style={{ ...card, overflow: 'hidden' }}>
    <div style={{ padding: '16px 20px', borderBottom: '1px solid var(--bd)', display: 'flex', alignItems: 'center', gap: 12 }}>
      <div style={{
        width: 36, height: 36, borderRadius: 10,
        background: `${color}12`, border: `1px solid ${color}25`,
        display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0,
      }}>
        <I n={icon} s={17} c={color} />
      </div>
      <div>
        <span style={{ fontFamily: "'Syne',sans-serif", fontWeight: 700, fontSize: 15, color: 'var(--t1)' }}>{title}</span>
        {subtitle && <p style={{ fontSize: 12, color: 'var(--t2)', marginTop: 2 }}>{subtitle}</p>}
      </div>
    </div>
    <div style={{ padding: 20 }}>{children}</div>
  </div>
);

const STORAGE_KEY = 'chatflow_widget_settings';

const DEFAULT_CFG = {
  brandColor: '#1EBF5E',
  buttonColor: '#1EBF5E',
  theme: 'dark',
  cornerStyle: 'rounded',
  position: 'right',
  desktopMargin: 20,
  mobileMargin: 16,
  welcomeMessage: 'Hi there! 👋 How can we help you today?',
  headerText: 'Chat with us',
  avatarUrl: '',
  companyName: 'ChatFlow Pro',
};

const ColorPicker = ({ label, value, onChange }) => {
  const [open, setOpen] = useState(false);
  const presets = ['#1EBF5E', '#0EA5E9', '#A78BFA', '#F59E0B', '#F472B6', '#EF4444', '#10B981', '#6366F1', '#EC4899', '#14B8A6'];
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
      <label style={{ fontSize: 12, fontWeight: 600, color: 'var(--t2)' }}>{label}</label>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
        <div
          onClick={() => setOpen(o => !o)}
          style={{
            width: 36, height: 36, borderRadius: 8, background: value,
            border: '2px solid rgba(255,255,255,0.12)', cursor: 'pointer',
            boxShadow: `0 0 12px ${value}40`, transition: 'all .15s',
          }}
        />
        <input
          value={value} onChange={e => onChange(e.target.value)}
          style={{
            flex: 1, padding: '8px 12px', borderRadius: 8,
            background: 'rgba(255,255,255,0.04)', border: '1px solid var(--bd)',
            color: 'var(--t1)', fontSize: 13, fontFamily: "'Plus Jakarta Sans',sans-serif",
            outline: 'none', boxSizing: 'border-box',
          }}
        />
      </div>
      {open && (
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginTop: 4 }}>
          {presets.map(c => (
            <div key={c} onClick={() => { onChange(c); setOpen(false); }}
              style={{
                width: 28, height: 28, borderRadius: 6, background: c, cursor: 'pointer',
                border: c === value ? '2px solid #fff' : '2px solid transparent',
                transition: 'all .1s', boxShadow: c === value ? `0 0 10px ${c}60` : 'none',
              }}
            />
          ))}
        </div>
      )}
    </div>
  );
};

const SegmentedControl = ({ options, value, onChange }) => (
  <div style={{ display: 'flex', gap: 4, padding: 3, borderRadius: 9, background: 'rgba(255,255,255,0.04)', border: '1px solid var(--bd)' }}>
    {options.map(o => {
      const on = value === o.value;
      return (
        <div key={o.value} onClick={() => onChange(o.value)}
          style={{
            padding: '7px 14px', borderRadius: 7, cursor: 'pointer', fontSize: 12,
            fontWeight: on ? 700 : 500, color: on ? '#060913' : 'var(--t2)',
            background: on ? 'var(--green)' : 'transparent', transition: 'all .15s',
            whiteSpace: 'nowrap',
          }}>
          {o.label}
        </div>
      );
    })}
  </div>
);

const PLATFORMS = [
  { id: 'js', label: 'JavaScript', icon: 'code2', color: '#F59E0B' },
  { id: 'wordpress', label: 'WordPress', icon: 'globe', color: '#0EA5E9' },
  { id: 'shopify', label: 'Shopify', icon: 'credit', color: '#1EBF5E' },
  { id: 'react', label: 'React', icon: 'code2', color: '#61DAFB' },
  { id: 'nextjs', label: 'Next.js', icon: 'code2', color: '#F0F2F8' },
  { id: 'vue', label: 'Vue', icon: 'code2', color: '#42B883' },
  { id: 'angular', label: 'Angular', icon: 'code2', color: '#DD0031' },
];

const getSnippet = (platform, cfg) => {
  const base = `<!-- ChatFlow Pro Widget -->
<script>
  window.__CHATFLOW_CONFIG__ = {
    brandColor: "${cfg.brandColor}",
    buttonColor: "${cfg.buttonColor}",
    theme: "${cfg.theme}",
    position: "${cfg.position}",
    welcomeMessage: "${cfg.welcomeMessage}",
    headerText: "${cfg.headerText}",
    companyName: "${cfg.companyName}",
  };
</script>
<script src="https://cdn.chatflowpro.com/widget.js" async></script>`;

  const snippets = {
    js: base,
    wordpress: `/* Add to your theme's functions.php */
function chatflow_widget() {
  ?>
${base}
  <?php
}
add_action('wp_footer', 'chatflow_widget');`,
    shopify: `{% comment %} Add to theme.liquid before </body> {% endcomment %}
${base}`,
    react: `// ChatFlowWidget.jsx
import { useEffect } from 'react';

export default function ChatFlowWidget() {
  useEffect(() => {
    window.__CHATFLOW_CONFIG__ = {
      brandColor: "${cfg.brandColor}",
      buttonColor: "${cfg.buttonColor}",
      theme: "${cfg.theme}",
      position: "${cfg.position}",
      welcomeMessage: "${cfg.welcomeMessage}",
      headerText: "${cfg.headerText}",
      companyName: "${cfg.companyName}",
    };
    const script = document.createElement('script');
    script.src = 'https://cdn.chatflowpro.com/widget.js';
    script.async = true;
    document.body.appendChild(script);
    return () => document.body.removeChild(script);
  }, []);
  return null;
}`,
    nextjs: `// components/ChatFlowWidget.tsx
'use client';
import Script from 'next/script';

export default function ChatFlowWidget() {
  return (
    <>
      <Script id="chatflow-config" strategy="beforeInteractive">
        {\`window.__CHATFLOW_CONFIG__ = ${JSON.stringify({
          brandColor: cfg.brandColor, buttonColor: cfg.buttonColor,
          theme: cfg.theme, position: cfg.position,
          welcomeMessage: cfg.welcomeMessage, headerText: cfg.headerText,
          companyName: cfg.companyName,
        }, null, 2)}\`}
      </Script>
      <Script src="https://cdn.chatflowpro.com/widget.js" strategy="afterInteractive" />
    </>
  );
}`,
    vue: `<!-- ChatFlowWidget.vue -->
<template><div /></template>
<script setup>
import { onMounted, onUnmounted } from 'vue';

let script;
onMounted(() => {
  window.__CHATFLOW_CONFIG__ = {
    brandColor: "${cfg.brandColor}",
    buttonColor: "${cfg.buttonColor}",
    theme: "${cfg.theme}",
    position: "${cfg.position}",
    welcomeMessage: "${cfg.welcomeMessage}",
    headerText: "${cfg.headerText}",
    companyName: "${cfg.companyName}",
  };
  script = document.createElement('script');
  script.src = 'https://cdn.chatflowpro.com/widget.js';
  script.async = true;
  document.body.appendChild(script);
});
onUnmounted(() => { if (script) document.body.removeChild(script); });
</script>`,
    angular: `// chatflow-widget.component.ts
import { Component, OnInit, OnDestroy } from '@angular/core';

@Component({ selector: 'app-chatflow-widget', template: '' })
export class ChatFlowWidgetComponent implements OnInit, OnDestroy {
  private script: HTMLScriptElement | null = null;

  ngOnInit() {
    (window as any).__CHATFLOW_CONFIG__ = {
      brandColor: "${cfg.brandColor}",
      buttonColor: "${cfg.buttonColor}",
      theme: "${cfg.theme}",
      position: "${cfg.position}",
      welcomeMessage: "${cfg.welcomeMessage}",
      headerText: "${cfg.headerText}",
      companyName: "${cfg.companyName}",
    };
    this.script = document.createElement('script');
    this.script.src = 'https://cdn.chatflowpro.com/widget.js';
    this.script.async = true;
    document.body.appendChild(this.script);
  }

  ngOnDestroy() { if (this.script) document.body.removeChild(this.script); }
}`,
  };
  return snippets[platform] || base;
};

// ─── Widget Preview ──────────────────────────────────────────────
const WidgetPreview = ({ cfg }) => {
  const isRounded = cfg.cornerStyle === 'rounded';
  const isRight = cfg.position === 'right';
  const isDark = cfg.theme === 'dark';

  return (
    <div style={{
      position: 'relative', width: '100%', maxWidth: 320, height: 440,
      background: isDark
        ? 'linear-gradient(180deg, #0D1121, #080B12)'
        : 'linear-gradient(180deg, #f8fafc, #e2e8f0)',
      borderRadius: isRounded ? 20 : 8,
      border: `1px solid ${isDark ? 'rgba(255,255,255,0.08)' : 'rgba(0,0,0,0.1)'}`,
      overflow: 'hidden', display: 'flex', flexDirection: 'column',
      boxShadow: '0 20px 60px rgba(0,0,0,0.4)',
      transition: 'all .3s ease',
    }}>
      {/* Header */}
      <div style={{
        padding: '16px 18px', display: 'flex', alignItems: 'center', gap: 12,
        background: cfg.brandColor, flexShrink: 0,
      }}>
        <div style={{
          width: 36, height: 36, borderRadius: isRounded ? '50%' : 6,
          background: 'rgba(255,255,255,0.2)', display: 'flex', alignItems: 'center', justifyContent: 'center',
          fontSize: 14, fontWeight: 800, color: '#fff',
        }}>
          {cfg.companyName.slice(0, 2).toUpperCase()}
        </div>
        <div>
          <p style={{ fontSize: 14, fontWeight: 700, color: '#fff', marginBottom: 2 }}>{cfg.headerText}</p>
          <p style={{ fontSize: 11, color: 'rgba(255,255,255,0.7)' }}>{cfg.companyName}</p>
        </div>
      </div>

      {/* Chat area */}
      <div style={{ flex: 1, padding: 16, display: 'flex', flexDirection: 'column', justifyContent: 'flex-end', gap: 10 }}>
        {/* Welcome message bubble */}
        <div style={{
          alignSelf: 'flex-start', maxWidth: '85%',
          padding: '10px 14px', borderRadius: isRounded ? '14px 14px 14px 4px' : '4px',
          background: isDark ? 'rgba(255,255,255,0.06)' : 'rgba(0,0,0,0.04)',
          border: `1px solid ${isDark ? 'rgba(255,255,255,0.08)' : 'rgba(0,0,0,0.08)'}`,
        }}>
          <p style={{ fontSize: 12.5, color: isDark ? '#F0F2F8' : '#1e293b', lineHeight: 1.5 }}>{cfg.welcomeMessage}</p>
          <p style={{ fontSize: 9, color: isDark ? 'rgba(255,255,255,0.3)' : 'rgba(0,0,0,0.3)', textAlign: 'right', marginTop: 4 }}>just now</p>
        </div>
      </div>

      {/* Input area */}
      <div style={{
        padding: '12px 16px', borderTop: `1px solid ${isDark ? 'rgba(255,255,255,0.06)' : 'rgba(0,0,0,0.08)'}`,
        display: 'flex', alignItems: 'center', gap: 10,
      }}>
        <div style={{
          flex: 1, padding: '9px 14px', borderRadius: isRounded ? 20 : 6,
          background: isDark ? 'rgba(255,255,255,0.04)' : 'rgba(0,0,0,0.04)',
          border: `1px solid ${isDark ? 'rgba(255,255,255,0.06)' : 'rgba(0,0,0,0.08)'}`,
          fontSize: 12, color: isDark ? 'var(--t3)' : '#94a3b8',
        }}>
          Type a message…
        </div>
        <div style={{
          width: 32, height: 32, borderRadius: isRounded ? '50%' : 6,
          background: cfg.buttonColor, display: 'flex', alignItems: 'center', justifyContent: 'center',
          cursor: 'pointer', transition: 'transform .1s',
        }}>
          <I n="send" s={14} c="#fff" />
        </div>
      </div>

      {/* Position indicator */}
      <div style={{
        position: 'absolute', bottom: -28, [isRight ? 'right' : 'left']: 8,
        fontSize: 10, color: 'var(--t3)', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '.06em',
      }}>
        ← widget position: {cfg.position}
      </div>
    </div>
  );
};

export default function WidgetSettingsPage() {
  const [cfg, setCfg] = useState(() => {
    try {
      return { ...DEFAULT_CFG, ...JSON.parse(localStorage.getItem(STORAGE_KEY) || '{}') };
    } catch { return { ...DEFAULT_CFG }; }
  });
  const [activePlatform, setActivePlatform] = useState('js');
  const [toast, setToast] = useState(null);
  const [copied, setCopied] = useState(false);

  const update = (key, val) => {
    setCfg(prev => {
      const next = { ...prev, [key]: val };
      localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
      return next;
    });
  };

  const handleCopy = () => {
    const snippet = getSnippet(activePlatform, cfg);
    navigator.clipboard.writeText(snippet).then(() => {
      setCopied(true);
      setToast({ message: 'Code copied to clipboard!', type: 'success' });
      setTimeout(() => setCopied(false), 2000);
    }).catch(() => {
      setToast({ message: 'Failed to copy', type: 'error' });
    });
  };

  return (
    <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
      <DashHeader title="Widget Settings" subtitle="Customize your chat widget appearance and install code" />
      <div style={{ flex: 1, overflowY: 'auto', padding: '24px 28px' }}>
        <div style={{ display: 'flex', gap: 28, alignItems: 'flex-start', flexWrap: 'wrap' }}>

          {/* Left — Controls */}
          <div style={{ flex: 1, minWidth: 340, display: 'flex', flexDirection: 'column', gap: 20 }}>

            {/* Appearance */}
            <SectionCard icon="spark" title="Appearance" subtitle="Colors and visual style" color="#A78BFA">
              <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14 }}>
                  <ColorPicker label="Brand Color" value={cfg.brandColor} onChange={v => update('brandColor', v)} />
                  <ColorPicker label="Button Color" value={cfg.buttonColor} onChange={v => update('buttonColor', v)} />
                </div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
                  <label style={{ fontSize: 12, fontWeight: 600, color: 'var(--t2)' }}>Widget Theme</label>
                  <SegmentedControl
                    options={[{ value: 'dark', label: '🌙 Dark' }, { value: 'light', label: '☀️ Light' }]}
                    value={cfg.theme} onChange={v => update('theme', v)}
                  />
                </div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
                  <label style={{ fontSize: 12, fontWeight: 600, color: 'var(--t2)' }}>Corner Style</label>
                  <SegmentedControl
                    options={[{ value: 'rounded', label: 'Rounded' }, { value: 'square', label: 'Square' }]}
                    value={cfg.cornerStyle} onChange={v => update('cornerStyle', v)}
                  />
                </div>
              </div>
            </SectionCard>

            {/* Position & Layout */}
            <SectionCard icon="columns" title="Position & Layout" subtitle="Widget placement on page" color="#F59E0B">
              <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
                  <label style={{ fontSize: 12, fontWeight: 600, color: 'var(--t2)' }}>Button Position</label>
                  <SegmentedControl
                    options={[{ value: 'left', label: '← Left' }, { value: 'right', label: 'Right →' }]}
                    value={cfg.position} onChange={v => update('position', v)}
                  />
                </div>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14 }}>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
                    <label style={{ fontSize: 12, fontWeight: 600, color: 'var(--t2)' }}>Desktop Margin (px)</label>
                    <input
                      type="number" value={cfg.desktopMargin} min={0} max={100}
                      onChange={e => update('desktopMargin', parseInt(e.target.value) || 0)}
                      style={{
                        width: '100%', padding: '9px 12px', borderRadius: 8,
                        background: 'rgba(255,255,255,0.04)', border: '1px solid var(--bd)',
                        color: 'var(--t1)', fontSize: 13, fontFamily: "'Plus Jakarta Sans',sans-serif",
                        outline: 'none', boxSizing: 'border-box',
                      }}
                    />
                  </div>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
                    <label style={{ fontSize: 12, fontWeight: 600, color: 'var(--t2)' }}>Mobile Margin (px)</label>
                    <input
                      type="number" value={cfg.mobileMargin} min={0} max={100}
                      onChange={e => update('mobileMargin', parseInt(e.target.value) || 0)}
                      style={{
                        width: '100%', padding: '9px 12px', borderRadius: 8,
                        background: 'rgba(255,255,255,0.04)', border: '1px solid var(--bd)',
                        color: 'var(--t1)', fontSize: 13, fontFamily: "'Plus Jakarta Sans',sans-serif",
                        outline: 'none', boxSizing: 'border-box',
                      }}
                    />
                  </div>
                </div>
              </div>
            </SectionCard>

            {/* Content */}
            <SectionCard icon="msg" title="Content" subtitle="Messages and branding text" color="#0EA5E9">
              <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
                  <label style={{ fontSize: 12, fontWeight: 600, color: 'var(--t2)' }}>Company Name</label>
                  <input
                    value={cfg.companyName} onChange={e => update('companyName', e.target.value)}
                    style={{
                      width: '100%', padding: '9px 12px', borderRadius: 8,
                      background: 'rgba(255,255,255,0.04)', border: '1px solid var(--bd)',
                      color: 'var(--t1)', fontSize: 13, fontFamily: "'Plus Jakarta Sans',sans-serif",
                      outline: 'none', boxSizing: 'border-box',
                    }}
                  />
                </div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
                  <label style={{ fontSize: 12, fontWeight: 600, color: 'var(--t2)' }}>Chat Header</label>
                  <input
                    value={cfg.headerText} onChange={e => update('headerText', e.target.value)}
                    style={{
                      width: '100%', padding: '9px 12px', borderRadius: 8,
                      background: 'rgba(255,255,255,0.04)', border: '1px solid var(--bd)',
                      color: 'var(--t1)', fontSize: 13, fontFamily: "'Plus Jakarta Sans',sans-serif",
                      outline: 'none', boxSizing: 'border-box',
                    }}
                  />
                </div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
                  <label style={{ fontSize: 12, fontWeight: 600, color: 'var(--t2)' }}>Welcome Message</label>
                  <textarea
                    value={cfg.welcomeMessage} onChange={e => update('welcomeMessage', e.target.value)}
                    rows={3}
                    style={{
                      width: '100%', padding: '10px 13px', borderRadius: 8,
                      background: 'rgba(255,255,255,0.04)', border: '1px solid var(--bd)',
                      color: 'var(--t1)', fontSize: 13, fontFamily: "'Plus Jakarta Sans',sans-serif",
                      outline: 'none', boxSizing: 'border-box', resize: 'vertical',
                    }}
                  />
                </div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
                  <label style={{ fontSize: 12, fontWeight: 600, color: 'var(--t2)' }}>Avatar URL (optional)</label>
                  <input
                    value={cfg.avatarUrl} onChange={e => update('avatarUrl', e.target.value)}
                    placeholder="https://example.com/avatar.png"
                    style={{
                      width: '100%', padding: '9px 12px', borderRadius: 8,
                      background: 'rgba(255,255,255,0.04)', border: '1px solid var(--bd)',
                      color: 'var(--t1)', fontSize: 13, fontFamily: "'Plus Jakarta Sans',sans-serif",
                      outline: 'none', boxSizing: 'border-box',
                    }}
                  />
                </div>
              </div>
            </SectionCard>

            {/* Installation */}
            <SectionCard icon="code2" title="Installation" subtitle="Copy the snippet for your platform" color="#1EBF5E">
              {/* Platform tabs */}
              <div style={{ display: 'flex', gap: 6, marginBottom: 16, flexWrap: 'wrap' }}>
                {PLATFORMS.map(p => {
                  const on = activePlatform === p.id;
                  return (
                    <button key={p.id} onClick={() => setActivePlatform(p.id)}
                      style={{
                        padding: '6px 12px', borderRadius: 7, fontSize: 12, fontWeight: on ? 700 : 500,
                        background: on ? `${p.color}18` : 'rgba(255,255,255,0.03)',
                        border: `1px solid ${on ? p.color + '40' : 'var(--bd)'}`,
                        color: on ? p.color : 'var(--t2)', cursor: 'pointer',
                        fontFamily: "'Plus Jakarta Sans',sans-serif", transition: 'all .12s',
                      }}>
                      {p.label}
                    </button>
                  );
                })}
              </div>

              {/* Code block */}
              <div style={{
                background: '#0A0E1A', border: '1px solid var(--bd)', borderRadius: 10,
                padding: '14px 16px', position: 'relative', maxHeight: 300, overflowY: 'auto',
              }}>
                <pre style={{
                  margin: 0, whiteSpace: 'pre-wrap', wordBreak: 'break-all',
                  fontFamily: "'JetBrains Mono', 'Fira Code', monospace",
                  fontSize: 11.5, color: '#a5d6ff', lineHeight: 1.7,
                }}>
                  {getSnippet(activePlatform, cfg)}
                </pre>
              </div>

              <div style={{ marginTop: 12, display: 'flex', justifyContent: 'flex-end' }}>
                <Btn size="sm" onClick={handleCopy}>
                  <I n={copied ? 'check' : 'copy'} s={13} c="#060A10" />
                  {copied ? 'Copied!' : 'Copy Code'}
                </Btn>
              </div>
            </SectionCard>
          </div>

          {/* Right — Live Preview */}
          <div style={{
            position: 'sticky', top: 24, flexShrink: 0,
            display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 16,
          }}>
            <p style={{ fontSize: 10, fontWeight: 700, color: 'var(--t3)', textTransform: 'uppercase', letterSpacing: '.1em' }}>Live Preview</p>
            <WidgetPreview cfg={cfg} />
          </div>
        </div>
      </div>

      {toast && <Toast message={toast.message} type={toast.type} onClose={() => setToast(null)} />}
    </div>
  );
}
