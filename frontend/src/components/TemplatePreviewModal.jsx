// Moved out of pages/Dashboard.jsx as-is, plus an Authentication branch so the
// same "Preview" action works for an Authentication template too — its BODY
// carries `add_security_recommendation` rather than `text`, so the original
// rendering showed "No body text" for one.
import { useState, useEffect } from 'react';
import { I } from './Icons.jsx';
import { Btn } from './Btn.jsx';
import { StatusBadge } from './StatusBadge.jsx';
import { OTP_PREVIEW, OTP_BUTTON_LABEL_DEFAULT } from './TemplateModal.jsx';
import { wFetch } from '../lib/api.js';
import { getBodyText, statusLabel } from '../lib/templateHelpers.js';

const card = { background: 'var(--surf)', border: '1px solid var(--bd)', borderRadius: 'var(--rl)', boxShadow: 'var(--card-shadow)' };

// WhatsApp-style bubble preview of one of the workspace's own templates.
const TemplatePreviewModal = ({ template, onClose }) => {
  const [headerPreview, setHeaderPreview] = useState(null);
  const isAuth = String(template?.category || '').toUpperCase() === 'AUTHENTICATION';

  useEffect(() => {
    const headerComp = Array.isArray(template?.components)
      ? template.components.find(c => (c.type || '').toUpperCase() === 'HEADER')
      : null;

    if (template?.headerAssetId) {
      let active = true;
      let objectUrl = null;
      wFetch(`/templates/media/${template.headerAssetId}`)
        .then(res => res.ok ? res.blob() : null)
        .then(blob => {
          if (active && blob) {
            objectUrl = URL.createObjectURL(blob);
            setHeaderPreview(objectUrl);
          } else if (active) {
            setHeaderPreview('placeholder');
          }
        })
        .catch(() => {
          if (active) setHeaderPreview('placeholder');
        });
      return () => {
        active = false;
        if (objectUrl) URL.revokeObjectURL(objectUrl);
      };
    } else {
      const exampleUrl = headerComp?.example?.header_url?.[0] || headerComp?.example?.header_handle?.[0];
      if (exampleUrl && typeof exampleUrl === 'string' && exampleUrl.startsWith('http')) {
        setHeaderPreview(exampleUrl);
      } else if (headerComp?.format === 'IMAGE') {
        setHeaderPreview('placeholder');
      }
    }
  }, [template]);

  const authFooterComp = isAuth && Array.isArray(template.components)
    ? template.components.find(c => (c.type || '').toUpperCase() === 'FOOTER')
    : null;
  const authButton = isAuth && Array.isArray(template.components)
    ? (template.components.find(c => (c.type || '').toUpperCase() === 'BUTTONS')?.buttons || [])
        .find(b => (b?.type || '').toUpperCase() === 'OTP')
    : null;
  const authBodyComp = isAuth && Array.isArray(template.components)
    ? template.components.find(c => (c.type || '').toUpperCase() === 'BODY')
    : null;

  const bodyText = getBodyText(template.components);
  const footerText = Array.isArray(template.components)
    ? (template.components.find(c => (c.type || '').toUpperCase() === 'FOOTER')?.text ?? '')
    : '';

  const headerComp = Array.isArray(template.components)
    ? template.components.find(c => (c.type || '').toUpperCase() === 'HEADER')
    : null;
  const isTextHeader = headerComp?.format === 'TEXT';
  const isImageHeader = headerComp?.format === 'IMAGE';

  return (
    <div onClick={onClose} onKeyDown={e => { if (e.key === 'Escape') onClose(); }} role="dialog" aria-modal="true" aria-label={template.name} style={{ position:'fixed', inset:0, background:'rgba(3,5,12,0.78)', backdropFilter:'blur(4px)', zIndex:100, display:'flex', alignItems:'center', justifyContent:'center', padding:20 }}>
      <div onClick={e => e.stopPropagation()} tabIndex={-1} style={{ ...card, ...(isAuth ? { border: '1px solid var(--gbd)', boxShadow: 'var(--card-shadow), 0 0 40px rgba(53,232,242,0.10)' } : {}), width:'100%', maxWidth:480, display:'flex', flexDirection:'column', overflow:'hidden' }}>
        <div style={{ padding:'16px 20px', borderBottom:'1px solid var(--bd)', display:'flex', alignItems:'center', justifyContent:'space-between' }}>
          <div>
            <p style={{ fontFamily:"'Space Grotesk',sans-serif", fontWeight:700, fontSize:15, color:'var(--t1)' }}>{template.name}</p>
            <p style={{ fontSize:11.5, color:'var(--t2)', marginTop:2 }}>{template.category} · {template.language} · <StatusBadge s={statusLabel(template.status)} /></p>
          </div>
          <button onClick={onClose} style={{ width:28, height:28, borderRadius:6, background:'rgba(255,255,255,0.04)', border:'1px solid var(--bd)', cursor:'pointer', display:'flex', alignItems:'center', justifyContent:'center' }}>
            <I n="x" s={12} c="var(--t2)" />
          </button>
        </div>
        <div style={{ padding:20 }}>
          <div style={{ background:'#ECE5DD', borderRadius:10, padding:14, minHeight:60 }}>
            <div style={{ background:'#fff', borderRadius:'0 8px 8px 8px', padding:'10px 12px', maxWidth:'88%', boxShadow:'0 1px 3px rgba(0,0,0,0.1)', display:'inline-block' }}>
              {isImageHeader && (
                <div style={{ marginBottom: 8, borderRadius: 6, overflow: 'hidden', background: '#f0f0f0', display: 'flex', alignItems: 'center', justifyContent: 'center', minHeight: (headerPreview && headerPreview !== 'placeholder') ? 'auto' : 120 }}>
                  {headerPreview === 'placeholder' ? (
                    <span style={{ fontSize: 12, color: '#888', padding: 20 }}>Image header</span>
                  ) : headerPreview ? (
                    <img src={headerPreview} alt="Header" style={{ width: '100%', display: 'block' }} />
                  ) : (
                    <span style={{ fontSize: 11, color: '#999', padding: 20 }}>Loading image…</span>
                  )}
                </div>
              )}
              {isTextHeader && headerComp.text && (
                <p style={{ fontSize: 13, fontWeight: 700, color: '#111', margin: '0 0 6px', fontFamily: 'system-ui,-apple-system,sans-serif' }}>
                  {headerComp.text}
                </p>
              )}
              {isAuth ? (
                <p style={{ fontSize:12, color:'#111', lineHeight:1.5, whiteSpace:'pre-wrap', wordBreak:'break-word', fontFamily:'system-ui,-apple-system,sans-serif', margin:0 }}>
                  {OTP_PREVIEW.body}{authBodyComp?.add_security_recommendation !== false ? ` ${OTP_PREVIEW.security}` : ''}
                </p>
              ) : (
                <p style={{ fontSize:12, color:'#111', lineHeight:1.5, whiteSpace:'pre-wrap', wordBreak:'break-word', fontFamily:'system-ui,-apple-system,sans-serif', margin:0 }}>
                  {bodyText || <span style={{ color:'#999', fontStyle:'italic' }}>No body text</span>}
                </p>
              )}
              {isAuth && authFooterComp?.code_expiration_minutes != null && (
                <p style={{ fontSize:10.5, color:'#888', marginTop:6, lineHeight:1.4 }}>{OTP_PREVIEW.expiry(Number(authFooterComp.code_expiration_minutes))}</p>
              )}
              {isAuth && (
                <div style={{ marginTop:8, borderTop:'1px solid #e4e0d8', paddingTop:2 }}>
                  <div style={{ textAlign:'center', padding:'7px 4px', fontSize:12, color:'#00a5f4', fontWeight:500 }}>
                    {'⧉ '}{authButton?.text || OTP_BUTTON_LABEL_DEFAULT}
                  </div>
                </div>
              )}
              {!isAuth && footerText && <p style={{ fontSize:10.5, color:'#888', marginTop:6, lineHeight:1.4 }}>{footerText}</p>}
            </div>
          </div>
          <p style={{ fontSize:11, color:'var(--t3)', marginTop:8 }}>Placeholders like {'{{1}}'} are filled per recipient at send time.</p>
        </div>
        <div style={{ padding:'12px 20px', borderTop:'1px solid var(--bd)', display:'flex', justifyContent:'flex-end' }}>
          <Btn variant="ghost" size="sm" onClick={onClose}>Close</Btn>
        </div>
      </div>
    </div>
  );
};

export { TemplatePreviewModal };

