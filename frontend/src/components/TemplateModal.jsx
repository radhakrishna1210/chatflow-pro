// Moved out of pages/Dashboard.jsx as-is (same logic, same validation, same
// payload) so the Authentication module can reuse the exact same template
// builder/editor and live preview instead of a second implementation.
import { useState, useRef, useEffect } from 'react';
import { I } from './Icons.jsx';
import { Btn } from './Btn.jsx';
import { wFetch } from '../lib/api.js';
import { validateMeaningfulText } from '../lib/validation.js';
import { useFocusTrap } from '../lib/useFocusTrap.js';
import { detectTemplateType } from '../lib/templateHelpers.js';

const card = { background: 'var(--surf)', border: '1px solid var(--bd)', borderRadius: 'var(--rl)', boxShadow: 'var(--card-shadow)' };

// ─── Template shape rules (mirror of backend lib/templateStructure.js) ──────
// Which template types each category may use, and which headers each category
// allows. The builder only offers what Meta will actually accept, so a bad
// combination is impossible to submit rather than rejected hours later.
const TYPES_BY_CATEGORY = {
  MARKETING:      ['STANDARD', 'CATALOG', 'CAROUSEL'],
  UTILITY:        ['STANDARD', 'CAROUSEL'],
  AUTHENTICATION: ['STANDARD'],
};

const TEMPLATE_TYPE_META = {
  STANDARD: { label: 'Standard',  hint: 'Header, body, footer and buttons.' },
  CATALOG:  { label: 'Catalog',   hint: 'Opens the catalog linked to your WhatsApp account.' },
  CAROUSEL: { label: 'Carousel',  hint: 'Up to 10 swipeable cards, each with its own image.' },
};

const HEADER_FORMATS_BY_CATEGORY = {
  MARKETING:      ['NONE', 'TEXT', 'IMAGE', 'VIDEO', 'DOCUMENT'],
  UTILITY:        ['NONE', 'TEXT', 'IMAGE', 'VIDEO', 'DOCUMENT'],
  AUTHENTICATION: ['NONE'],
};

const HEADER_FORMAT_META = {
  NONE:     { label: 'None',     accept: null },
  TEXT:     { label: 'Text',     accept: null },
  IMAGE:    { label: 'Image',    accept: 'image/jpeg,image/png',  hint: 'JPG or PNG, up to 5 MB.' },
  VIDEO:    { label: 'Video',    accept: 'video/mp4',             hint: 'MP4, up to 16 MB.' },
  DOCUMENT: { label: 'Document', accept: 'application/pdf',       hint: 'PDF, up to 100 MB.' },
};

const CARD_MAX = 10;
const CARD_BODY_MAX = 160;

// An authentication template is not authored — Meta writes the passcode
// message itself, in the template's language, and the template only sets these
// switches. Mirrors lib/templateStructure.js → normalizeAuthentication on the
// server, which is what actually enforces them.
const OTP_EXPIRY = { min: 1, max: 90, default: 5 };
const OTP_BUTTON_LABEL_DEFAULT = 'Copy code';
// What WhatsApp renders for each switch, shown in the preview so the user can
// see the message they are approving rather than guess at it.
const OTP_PREVIEW = {
  body: '<CODE> is your verification code.',
  security: 'For your security, do not share this code.',
  expiry: (m) => `This code expires in ${m} minute${m === 1 ? '' : 's'}.`,
};

// ─── New Template Dialog ───────────────────────────────────────
const TemplateModal = ({ onClose, onSaved, template = null, seed = null, forcedCategory = null }) => {
  const isEdit = !!template;
  const comps = isEdit && Array.isArray(template.components) ? template.components : [];
  const findComp = (t) => comps.find(c => (c.type || '').toUpperCase() === t);
  const initialBody   = isEdit ? (findComp('BODY')?.text ?? '') : (seed?.body ?? '');
  const initialFooter = isEdit ? (findComp('FOOTER')?.text ?? '') : (seed?.footer ?? '');
  const initialHeader = isEdit ? findComp('HEADER') : null;
  // A generated image wins over drafted header text — Meta allows only one
  // header, and the user explicitly asked for the picture.
  const initialHeaderKind = initialHeader
    ? (initialHeader.format || 'TEXT').toUpperCase()
    : (seed?.image ? 'IMAGE' : seed?.headerText ? 'TEXT' : 'NONE');
  const initialType = isEdit ? detectTemplateType(comps) : 'STANDARD';
  // Carousel cards, unpacked from the stored CAROUSEL component. `media` holds
  // what the upload endpoint returned; `assetId` is what the send path later
  // re-uploads, so an edited card keeps it even when the file is not touched.
  const initialCards = (comps.find(c => (c.type || '').toUpperCase() === 'CAROUSEL')?.cards || []).map(card => {
    const cc = Array.isArray(card?.components) ? card.components : [];
    const ch = cc.find(c => (c.type || '').toUpperCase() === 'HEADER');
    return {
      body: cc.find(c => (c.type || '').toUpperCase() === 'BODY')?.text || '',
      buttons: (cc.find(c => (c.type || '').toUpperCase() === 'BUTTONS')?.buttons || []).map(b => ({ ...b })),
      media: ch ? { format: (ch.format || 'IMAGE').toUpperCase(), assetId: ch._assetId || null, example: ch.example || null } : null,
      preview: null,
    };
  });

  const [name, setName]         = useState(isEdit ? template.name : (seed?.name ?? ''));
  const [category, setCategory] = useState(isEdit ? template.category : (forcedCategory || seed?.category || 'MARKETING'));
  const [language, setLanguage] = useState(isEdit ? template.language : (seed?.language ?? 'en'));
  const [body, setBody]         = useState(initialBody);
  const [footer, setFooter]     = useState(initialFooter);
  // Header: 'none' | 'text' | 'image'. Meta allows at most one header, and a
  // media header needs a sample uploaded to Meta before the template can be
  // submitted — headerMedia holds the handle that upload returns.
  const [headerKind, setHeaderKind] = useState(initialHeaderKind);
  // Standard / catalog / carousel. Changing the category can make the current
  // type illegal, which the effect below corrects.
  const [templateType, setTemplateType] = useState(initialType);
  const [cards, setCards] = useState(initialCards);
  // A catalog template's single button; Meta only lets its label be chosen.
  const [catalogLabel, setCatalogLabel] = useState(() => {
    const b = (comps.find(c => (c.type || '').toUpperCase() === 'BUTTONS')?.buttons || [])
      .find(x => (x?.type || '').toUpperCase() === 'CATALOG');
    return b?.text || 'View catalog';
  });
  // Which product's picture heads the message. Meta calls it the thumbnail
  // product retailer id and it is the item's Content ID in Commerce Manager.
  // Optional — left blank, Meta uses the first item in the catalog.
  const [catalogThumbnailId, setCatalogThumbnailId] = useState(() => {
    const b = (comps.find(c => (c.type || '').toUpperCase() === 'BUTTONS')?.buttons || [])
      .find(x => (x?.type || '').toUpperCase() === 'CATALOG');
    return b?._thumbnailProductRetailerId || '';
  });
  const [cardUploading, setCardUploading] = useState(null);
  const [headerText, setHeaderText] = useState(initialHeader?.text ?? seed?.headerText ?? '');
  // Holds Meta's review handle once the image is uploaded, plus the assetId of
  // the stored bytes the send path re-uploads later. A generated image starts
  // with only the assetId — the handle is minted on save, so a draft the user
  // abandons never touches Meta.
  const [headerMedia, setHeaderMedia] = useState(seed?.image?.assetId ? { assetId: seed.image.assetId } : null);
  // Buttons component. Meta caps these at 2 URL, 1 phone, 1 copy-code and
  // 10 total, and quick replies must stay grouped — enforced on save.
  const [buttons, setButtons] = useState(() => {
    const existing = isEdit ? findComp('BUTTONS')?.buttons : seed?.buttons;
    return Array.isArray(existing) ? existing.map(b => ({ ...b })) : [];
  });
  // ── Authentication ──
  // The three switches an authentication template is allowed to set. They are
  // read back off the stored components when editing one, and default to what
  // Meta itself suggests for a new one.
  const [otpSecurityNote, setOtpSecurityNote] = useState(
    () => (isEdit ? findComp('BODY')?.add_security_recommendation !== false : true),
  );
  // Blank means "no expiry line", which Meta accepts — so an absent value stays
  // absent on an existing template rather than being invented here.
  const [otpExpiry, setOtpExpiry] = useState(() => {
    if (!isEdit) return String(OTP_EXPIRY.default);
    const minutes = findComp('FOOTER')?.code_expiration_minutes;
    return minutes === undefined || minutes === null ? '' : String(minutes);
  });
  const [otpButtonLabel, setOtpButtonLabel] = useState(() => {
    const b = (findComp('BUTTONS')?.buttons || []).find(x => (x?.type || '').toUpperCase() === 'OTP');
    return b?.text || OTP_BUTTON_LABEL_DEFAULT;
  });

  const [headerPreview, setHeaderPreview] = useState(seed?.image?.dataUri ?? null);
  const [uploading, setUploading] = useState(false);
  const [examples, setExamples] = useState(() => {
    const out = {};
    for (const v of seed?.variables || []) out[v.index] = v.example || '';
    return out;
  });
  const [saving, setSaving]     = useState(false);
  const [err, setErr]           = useState(null);
  const modalRef = useRef(null);
  useFocusTrap(modalRef, true);
  // Templates are private per WhatsApp number. When a workspace has more than
  // one number, the user must choose which number this template belongs to.
  const [numbers, setNumbers]   = useState([]);
  const [waNumberId, setWaNumberId] = useState(isEdit ? (template.waNumberId || '') : '');

  useEffect(() => {
    if (isEdit) return; // editing keeps its existing number binding
    wFetch('/whatsapp/numbers').then(r => r.ok && r.json()).then(d => {
      if (Array.isArray(d)) {
        setNumbers(d);
        if (d.length === 1) setWaNumberId(d[0].id);
      }
    }).catch(() => {});
  }, []);

  // Show the image an existing template actually sends. Pulled as a blob
  // rather than pointed at with <img src> because every API route requires the
  // Authorization header (same reason wDownload exists).
  useEffect(() => {
    if (!isEdit || !template?.headerAssetId) return;
    let url = null;
    let cancelled = false;
    wFetch(`/templates/media/${template.headerAssetId}`)
      .then(r => r.ok ? r.blob() : null)
      .then(blob => {
        if (!blob || cancelled) return;
        url = URL.createObjectURL(blob);
        setHeaderPreview(url);
      })
      .catch(() => {});
    return () => { cancelled = true; if (url) URL.revokeObjectURL(url); };
  }, [isEdit, template?.headerAssetId]);

  const allowedTypes   = TYPES_BY_CATEGORY[category] || TYPES_BY_CATEGORY.MARKETING;
  const allowedHeaders = HEADER_FORMATS_BY_CATEGORY[category] || HEADER_FORMATS_BY_CATEGORY.MARKETING;

  // Picking a category narrows what is legal — an authentication template can
  // carry no header at all, and only marketing can use a catalog. Rather than
  // let the form hold a combination Meta would reject, the illegal choice falls
  // back to the safe one the moment the category changes.
  useEffect(() => {
    if (!allowedTypes.includes(templateType)) setTemplateType('STANDARD');
    if (!allowedHeaders.includes(headerKind)) setHeaderKind('NONE');
  }, [category]);

  // Show the pictures an existing carousel's cards will actually send, for the
  // same reason the main header is fetched as a blob: every API route needs the
  // Authorization header, so <img src> cannot reach them.
  useEffect(() => {
    if (!isEdit || initialCards.length === 0) return;
    const urls = [];
    let cancelled = false;
    Promise.all(initialCards.map((c, i) => (
      c.media?.assetId
        ? wFetch(`/templates/media/${c.media.assetId}`)
            .then(r => r.ok ? r.blob() : null)
            .then(blob => {
              if (!blob || cancelled) return null;
              const u = URL.createObjectURL(blob);
              urls.push(u);
              return [i, u];
            })
            .catch(() => null)
        : Promise.resolve(null)
    ))).then(pairs => {
      if (cancelled) return;
      const found = pairs.filter(Boolean);
      if (found.length) {
        setCards(list => list.map((c, i) => {
          const hit = found.find(([idx]) => idx === i);
          return hit ? { ...c, preview: hit[1] } : c;
        }));
      }
    });
    return () => { cancelled = true; urls.forEach(u => URL.revokeObjectURL(u)); };
  }, [isEdit]);

  const langs = [
    { code:'en',    label:'English' },
    { code:'en_US', label:'English (US)' },
    { code:'en_GB', label:'English (UK)' },
    { code:'es',    label:'Spanish' },
    { code:'hi',    label:'Hindi' },
    { code:'mr',    label:'Marathi' },
    { code:'pt_BR', label:'Portuguese (BR)' },
    { code:'fr',    label:'French' },
    { code:'de',    label:'German' },
    { code:'id',    label:'Indonesian' },
    { code:'ar',    label:'Arabic' },
  ];
  // Authentication is created from the separate Authentication page, not this
  // picker — its OTP-only rendering below (isAuth) still exists to support
  // opening an existing Authentication template for editing.
  const cats = [
    { id:'MARKETING', label:'Marketing', hint:'Promotions, offers, announcements.' },
    { id:'UTILITY',   label:'Utility',   hint:'Order updates, confirmations, alerts.' },
  ];

  // Authentication templates are configured, not written: Meta supplies the
  // copy and the builder collects only the switches, so the body, footer and
  // button editors below are replaced wholesale for this category.
  const isAuth = category === 'AUTHENTICATION';

  // Extract {{1}}, {{2}}, ... in order
  const vars = isAuth ? [] : Array.from(new Set((body.match(/\{\{\d+\}\}/g) || [])))
    .map(v => parseInt(v.replace(/\D/g, ''), 10))
    .filter(n => !isNaN(n))
    .sort((a, b) => a - b);

  const slug = name.toLowerCase().replace(/[^a-z0-9_]/g, '_').slice(0, 64);
  const nameValid = /^[a-z0-9_]{1,64}$/.test(slug) && slug.length > 0;

  // Meta will not approve a media header without a sample file, so the image
  // is uploaded to Meta up front and only the returned handle is submitted
  // with the template. The preview is a local object URL — the bytes are
  // never stored on our side.
  const pickHeaderImage = async (file) => {
    if (!file) return;
    setErr(null);
    // The header format is an explicit choice now, so the file has to match it
    // rather than merely being one of the four types Meta accepts somewhere.
    const spec = {
      IMAGE:    { types: ['image/jpeg', 'image/png'], maxMb: 5,   label: 'a JPG or PNG image' },
      VIDEO:    { types: ['video/mp4'],               maxMb: 16,  label: 'an MP4 video' },
      DOCUMENT: { types: ['application/pdf'],         maxMb: 100, label: 'a PDF' },
    }[headerKind];
    if (!spec) return;
    if (!spec.types.includes(file.type)) { setErr(`The header is set to ${HEADER_FORMAT_META[headerKind].label} — use ${spec.label}.`); return; }
    if (file.size > spec.maxMb * 1024 * 1024) { setErr(`That file is ${(file.size / 1024 / 1024).toFixed(1)} MB — the limit for a ${HEADER_FORMAT_META[headerKind].label.toLowerCase()} header is ${spec.maxMb} MB.`); return; }

    setUploading(true);
    try {
      const fd = new FormData();
      fd.append('file', file);
      if (waNumberId) fd.append('waNumberId', waNumberId);
      const res = await wFetch('/templates/media', { method: 'POST', body: fd });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) { setErr(data.error || 'Could not upload that file'); return; }
      setHeaderMedia({ ...data, name: file.name });
      setHeaderPreview(file.type.startsWith('image/') ? URL.createObjectURL(file) : null);
    } catch (e) {
      setErr(e.message || 'Could not upload that file');
    } finally {
      setUploading(false);
    }
  };

  // Carousel cards are limited to images: the send path has to re-upload the
  // real media on every send, and only image bytes are stored (a video header
  // is review-only in this product), so a video card could never be delivered.
  const pickCardImage = async (index, file) => {
    if (!file) return;
    setErr(null);
    if (!['image/jpeg', 'image/png'].includes(file.type)) { setErr(`Card ${index + 1}: use a JPG or PNG image.`); return; }
    if (file.size > 5 * 1024 * 1024) { setErr(`Card ${index + 1}: images must be 5 MB or smaller.`); return; }

    setCardUploading(index);
    try {
      const fd = new FormData();
      fd.append('file', file);
      if (waNumberId) fd.append('waNumberId', waNumberId);
      const res = await wFetch('/templates/media', { method: 'POST', body: fd });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) { setErr(data.error || `Card ${index + 1}: could not upload that image`); return; }
      const preview = URL.createObjectURL(file);
      setCards(list => list.map((c, i) => i === index
        ? { ...c, media: { ...data, format: 'IMAGE', name: file.name }, preview }
        : c));
    } catch (e) {
      setErr(e.message || 'Could not upload that image');
    } finally {
      setCardUploading(null);
    }
  };

  // An authentication template's components, which carry switches rather than
  // copy — see the OTP_* constants above and normalizeAuthentication() on the
  // server. Nothing here is authored by the user except the button's label.
  const authComponents = () => {
    const out = [{ type:'BODY', add_security_recommendation: otpSecurityNote }];
    // Blank is a legitimate choice: Meta then renders no expiry line at all.
    if (otpExpiry.trim()) out.push({ type:'FOOTER', code_expiration_minutes: Number(otpExpiry) });
    out.push({
      type:'BUTTONS',
      buttons: [{ type:'OTP', otp_type:'COPY_CODE', text: otpButtonLabel.trim() || OTP_BUTTON_LABEL_DEFAULT }],
    });
    return out;
  };

  const submit = async () => {
    setErr(null);
    if (!nameValid) { setErr('Name must contain only lowercase letters, numbers and underscores.'); return; }

    if (isAuth) {
      if (otpExpiry.trim()) {
        const minutes = Number(otpExpiry);
        if (!Number.isInteger(minutes) || minutes < OTP_EXPIRY.min || minutes > OTP_EXPIRY.max) {
          setErr(`The code expiry must be a whole number of minutes between ${OTP_EXPIRY.min} and ${OTP_EXPIRY.max}.`); return;
        }
      }
      if (!isEdit && numbers.length > 1 && !waNumberId) { setErr('Select which WhatsApp number this template belongs to.'); return; }
      await save(authComponents());
      return;
    }

    const bodyError = validateMeaningfulText(body, 'Body text');
    if (bodyError) { setErr(bodyError); return; }
    for (const n of vars) {
      if (!examples[n]?.trim()) { setErr(`Provide an example value for variable {{${n}}}.`); return; }
    }

    const isCarousel = templateType === 'CAROUSEL';
    const isCatalog  = templateType === 'CATALOG';
    const isMediaHeader = ['IMAGE', 'VIDEO', 'DOCUMENT'].includes(headerKind);
    const usesHeader = templateType === 'STANDARD';

    if (usesHeader && isMediaHeader && !headerMedia && !isEdit) {
      setErr(`Upload a ${HEADER_FORMAT_META[headerKind].label.toLowerCase()} for the header, or set the header to None.`); return;
    }
    if (!isEdit && numbers.length > 1 && !waNumberId) { setErr('Select which WhatsApp number this template belongs to.'); return; }

    if (isCarousel) {
      if (cards.length === 0) { setErr('A carousel needs at least one card.'); return; }
      for (let i = 0; i < cards.length; i++) {
        const c = cards[i];
        if (!c.media?.handle && !c.media?.example) { setErr(`Card ${i + 1}: upload an image.`); return; }
        const labelled = c.buttons.filter(b => String(b.text || '').trim());
        if (labelled.length === 0) { setErr(`Card ${i + 1}: add at least one button — Meta requires them on every card.`); return; }
      }
      // Meta rejects the template unless every card repeats the same buttons in
      // the same order, so the mismatch is caught here rather than at review.
      const signature = (c) => c.buttons.filter(b => String(b.text || '').trim()).map(b => b.type).join(',');
      const first = signature(cards[0]);
      const odd = cards.findIndex(c => signature(c) !== first);
      if (odd > 0) { setErr(`Card ${odd + 1} has different buttons from card 1 — every card must repeat the same buttons in the same order.`); return; }
    }

    if (isCatalog && !catalogLabel.trim()) { setErr('Give the catalog button a label.'); return; }

    // A generated image has stored bytes but no Meta review handle yet — it is
    // uploaded here rather than at generation time so a draft the user
    // abandons never reaches Meta.
    let media = headerMedia;
    if (usesHeader && isMediaHeader && media?.assetId && !media.handle) {
      setSaving(true);
      try {
        const res = await wFetch('/templates/media', {
          method: 'POST',
          body: JSON.stringify({ assetId: media.assetId, ...(waNumberId ? { waNumberId } : {}) }),
        });
        const data = await res.json().catch(() => ({}));
        if (!res.ok) { setErr(data.error || 'Could not send the header image to Meta'); return; }
        media = { ...media, ...data };
        setHeaderMedia(media);
      } catch (e) {
        setErr(e.message); return;
      } finally {
        setSaving(false);
      }
    }
    if (usesHeader && headerKind === 'TEXT' && !headerText.trim()) {
      setErr('Enter the header text, or set the header to None.'); return;
    }

    const components = [];
    // Meta requires HEADER first, then BODY, then FOOTER.
    if (usesHeader && headerKind === 'TEXT') {
      components.push({ type:'HEADER', format:'TEXT', text: headerText.trim() });
    } else if (usesHeader && isMediaHeader) {
      const header = { type:'HEADER', format: media?.format || headerKind };
      // The handle is Meta's sample for review. Editing without re-uploading
      // keeps whatever the stored component already had.
      if (media?.handle) header.example = { header_handle: [media.handle] };
      else if (initialHeader?.example) header.example = initialHeader.example;
      components.push(header);
    }
    const bodyComp = { type:'BODY', text: body.trim() };
    if (vars.length > 0) {
      bodyComp.example = { body_text: [vars.map(n => examples[n].trim())] };
    }
    components.push(bodyComp);
    // A carousel carries no footer or buttons on the bubble itself.
    if (!isCarousel && footer.trim()) components.push({ type:'FOOTER', text: footer.trim() });

    // BUTTONS goes last. The server re-validates against Meta's rules, so a
    // bad set is caught before the template is submitted for review.
    const toMetaButton = (b) => {
      const out = { type: b.type, text: String(b.text).trim() };
      if (b.type === 'URL') { out.url = String(b.url || '').trim(); if (b.example) out.example = String(b.example).trim(); }
      if (b.type === 'PHONE_NUMBER') out.phone_number = String(b.phone_number || '').trim();
      if (b.type === 'COPY_CODE') out.example = String(b.example || '').trim();
      return out;
    };

    if (isCatalog) {
      const catalogBtn = { type:'CATALOG', text: catalogLabel.trim() };
      if (catalogThumbnailId.trim()) catalogBtn._thumbnailProductRetailerId = catalogThumbnailId.trim();
      components.push({ type:'BUTTONS', buttons: [catalogBtn] });
    } else if (isCarousel) {
      components.push({
        type: 'CAROUSEL',
        cards: cards.map(c => {
          const header = { type:'HEADER', format: c.media?.format || 'IMAGE' };
          if (c.media?.handle) header.example = { header_handle: [c.media.handle] };
          else if (c.media?.example) header.example = c.media.example;
          // Carried through so the send path can re-upload the real picture —
          // the review handle above cannot be sent. Stripped before Meta sees it.
          if (c.media?.assetId) header._assetId = c.media.assetId;
          const cardComponents = [header];
          if (c.body.trim()) cardComponents.push({ type:'BODY', text: c.body.trim() });
          cardComponents.push({
            type: 'BUTTONS',
            buttons: c.buttons.filter(b => String(b.text || '').trim()).map(toMetaButton),
          });
          return { components: cardComponents };
        }),
      });
    } else {
      const cleanButtons = buttons.filter(b => String(b.text || '').trim()).map(toMetaButton);
      if (cleanButtons.length) components.push({ type:'BUTTONS', buttons: cleanButtons });
    }

    await save(components, media);
  };

  // Posts the finished components. Shared by the authored categories and the
  // authentication one, which assembles a different components array but is
  // created and edited through exactly the same endpoints.
  const save = async (components, media = null) => {
    setSaving(true);
    try {
      const res = isEdit
        ? await wFetch(`/templates/${template.id}`, {
            method:'PUT',
            body: JSON.stringify({ name: slug, category, language, components }),
          })
        : await wFetch('/templates', {
            method:'POST',
            body: JSON.stringify({
              name: slug, category, language, components,
              ...(waNumberId ? { waNumberId } : {}),
              // Binds the stored bytes to the template so campaign sends can
              // re-upload the picture — Meta's review handle cannot be sent.
              ...(templateType === 'STANDARD' && headerKind === 'IMAGE' && media?.assetId ? { headerAssetId: media.assetId } : {}),
            }),
          });
      const data = await res.json();
      if (!res.ok) { setErr(data.error || `Error ${res.status}`); return; }
      onSaved?.(data);
    } catch (e) {
      setErr(e.message);
    } finally {
      setSaving(false);
    }
  };

  // What makes a template submittable differs by category: an authentication
  // template has no body to fill in — Meta writes it — so gating on one would
  // leave its Submit button permanently disabled.
  const canSubmit = !saving && nameValid && (isAuth ? !!otpButtonLabel.trim() : !!body.trim());

  const inputBase = {
    width:'100%', padding:'9px 12px', borderRadius:8, background:'rgba(255,255,255,0.04)',
    border:'1px solid var(--bd)', color:'var(--t1)', fontSize:13,
    fontFamily:"'Manrope',sans-serif", outline:'none', boxSizing:'border-box',
  };

  // Pulled out so an authentication template — which has nothing to author but
  // switches — can show it beside the form instead of scrolled below it. Every
  // other category keeps the original stacked layout, unchanged.
  const previewSection = (
    <div>
      <label style={{ display:'block', fontSize:12, fontWeight:700, color:'var(--t2)', marginBottom:6 }}>Preview</label>
      <div style={{ background:'#ECE5DD', borderRadius:10, padding:14, minHeight:60 }}>
        <div style={{ background:'#fff', borderRadius:'0 8px 8px 8px', padding:'10px 12px', maxWidth:'88%', boxShadow:'0 1px 3px rgba(0,0,0,0.1)', display:'inline-block' }}>
          {templateType === 'STANDARD' && headerKind === 'IMAGE' && (
            headerPreview
              ? <img src={headerPreview} alt="" style={{ display:'block', width:'100%', maxWidth:220, borderRadius:6, marginBottom:7 }} />
              : <div style={{ width:220, height:110, borderRadius:6, marginBottom:7, background:'#d9d2c9', display:'flex', alignItems:'center', justifyContent:'center', fontSize:11, color:'#7a736b' }}>Image header</div>
          )}
          {templateType === 'STANDARD' && ['VIDEO', 'DOCUMENT'].includes(headerKind) && (
            <div style={{ width:220, height: headerKind === 'VIDEO' ? 110 : 64, borderRadius:6, marginBottom:7, background:'#d9d2c9', display:'flex', alignItems:'center', justifyContent:'center', fontSize:11, color:'#7a736b' }}>
              {HEADER_FORMAT_META[headerKind].label} header
            </div>
          )}
          {templateType === 'STANDARD' && headerKind === 'TEXT' && headerText && (
            <p style={{ fontSize:12.5, fontWeight:700, color:'#111', margin:'0 0 4px', lineHeight:1.4 }}>{headerText}</p>
          )}
          {/* Meta's own wording for an authentication message, so the
              preview shows what the recipient reads rather than the
              switches that produce it. <CODE> is filled in per send. */}
          {isAuth ? (
            <p style={{ fontSize:12, color:'#111', lineHeight:1.5, whiteSpace:'pre-wrap', wordBreak:'break-word', fontFamily:'system-ui,-apple-system,sans-serif', margin:0 }}>
              {OTP_PREVIEW.body}{otpSecurityNote ? ` ${OTP_PREVIEW.security}` : ''}
            </p>
          ) : (
            <p style={{ fontSize:12, color:'#111', lineHeight:1.5, whiteSpace:'pre-wrap', wordBreak:'break-word', fontFamily:'system-ui,-apple-system,sans-serif', margin:0 }}>
              {body || <span style={{ color:'#999', fontStyle:'italic' }}>Body preview…</span>}
            </p>
          )}
          {isAuth && otpExpiry.trim() && Number(otpExpiry) > 0 && (
            <p style={{ fontSize:10.5, color:'#888', marginTop:6, lineHeight:1.4 }}>{OTP_PREVIEW.expiry(Number(otpExpiry))}</p>
          )}
          {isAuth && (
            <div style={{ marginTop:8, borderTop:'1px solid #e4e0d8', paddingTop:2 }}>
              <div style={{ textAlign:'center', padding:'7px 4px', fontSize:12, color:'#00a5f4', fontWeight:500 }}>
                {'⧉ '}{otpButtonLabel.trim() || OTP_BUTTON_LABEL_DEFAULT}
              </div>
            </div>
          )}
          {templateType !== 'CAROUSEL' && !isAuth && footer && (
            <p style={{ fontSize:10.5, color:'#888', marginTop:6, lineHeight:1.4 }}>{footer}</p>
          )}
          {templateType === 'STANDARD' && !isAuth && buttons.filter(b => (b.text || '').trim()).length > 0 && (
            <div style={{ marginTop:8, borderTop:'1px solid #e4e0d8', paddingTop:2 }}>
              {buttons.filter(b => (b.text || '').trim()).map((b, i) => (
                <div key={i} style={{ textAlign:'center', padding:'7px 4px', fontSize:12, color:'#00a5f4', fontWeight:500, borderTop: i > 0 ? '1px solid #e4e0d8' : 'none' }}>
                  {{ URL:'↗ ', PHONE_NUMBER:'✆ ', COPY_CODE:'⧉ ' }[b.type] || ''}{b.text}
                </div>
              ))}
            </div>
          )}
          {templateType === 'CATALOG' && catalogLabel.trim() && (
            <div style={{ marginTop:8, borderTop:'1px solid #e4e0d8', paddingTop:2 }}>
              <div style={{ textAlign:'center', padding:'7px 4px', fontSize:12, color:'#00a5f4', fontWeight:500 }}>
                {'▦ '}{catalogLabel}
              </div>
            </div>
          )}
        </div>

        {/* Cards sit below the bubble and scroll sideways, the way WhatsApp shows them. */}
        {templateType === 'CAROUSEL' && cards.length > 0 && (
          <div style={{ display:'flex', gap:8, marginTop:8, overflowX:'auto', paddingBottom:4 }}>
            {cards.map((c, i) => (
              <div key={i} style={{ flex:'0 0 150px', background:'#fff', borderRadius:8, overflow:'hidden', boxShadow:'0 1px 3px rgba(0,0,0,0.1)' }}>
                {c.preview
                  ? <img src={c.preview} alt="" style={{ display:'block', width:'100%', height:88, objectFit:'cover' }} />
                  : <div style={{ width:'100%', height:88, background:'#d9d2c9', display:'flex', alignItems:'center', justifyContent:'center', fontSize:10.5, color:'#7a736b' }}>Card {i + 1} image</div>}
                {c.body.trim() && (
                  <p style={{ fontSize:11, color:'#111', lineHeight:1.45, padding:'7px 9px 0', margin:0, wordBreak:'break-word' }}>{c.body}</p>
                )}
                <div style={{ marginTop:6 }}>
                  {c.buttons.filter(b => (b.text || '').trim()).map((b, bi) => (
                    <div key={bi} style={{ textAlign:'center', padding:'6px 4px', fontSize:11.5, color:'#00a5f4', fontWeight:500, borderTop:'1px solid #e4e0d8' }}>
                      {b.type === 'URL' ? '↗ ' : ''}{b.text}
                    </div>
                  ))}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );

  return (
    <div onKeyDown={e => { if (e.key === 'Escape') onClose(); }} role="dialog" aria-modal="true" aria-label={isEdit ? 'Edit Template' : 'New Message Template'} style={{ position:'fixed', inset:0, background:'rgba(0,0,0,0.6)', zIndex:100, display:'flex', alignItems:'center', justifyContent:'center', backdropFilter:'blur(4px)' }}>
      <div ref={modalRef} className="modal-card" style={{ ...card, ...(isAuth ? { border: '1px solid var(--gbd)', boxShadow: 'var(--card-shadow), 0 0 40px rgba(53,232,242,0.10)' } : {}), width: isAuth ? 900 : 620, maxHeight:'88vh', display:'flex', flexDirection:'column', overflow:'hidden' }}>
        <div style={{ padding:'18px 24px', borderBottom:'1px solid var(--bd)', display:'flex', justifyContent:'space-between', alignItems:'center', flexShrink:0 }}>
          <div>
            <p style={{ fontFamily:"'Space Grotesk',sans-serif", fontWeight:700, fontSize:16, color:'var(--t1)' }}>{isEdit ? 'Edit Template' : 'New Message Template'}</p>
            <p style={{ fontSize:11, color:'var(--t3)', marginTop:2 }}>{isEdit ? 'Changes to a rejected template are re-submitted to Meta.' : 'Will be submitted to Meta for review.'}</p>
          </div>
          <button onClick={onClose} style={{ background:'none', border:'none', cursor:'pointer', color:'var(--t2)', display:'flex' }}>
            <I n="x" s={18} c="var(--t2)" />
          </button>
        </div>

        <div style={{ flex:1, overflow:'hidden', display:'flex', flexDirection: isAuth ? 'row' : 'column' }}>
        <div style={{ flex: isAuth ? '1 1 50%' : 1, overflowY:'auto', padding:'20px 24px', display:'flex', flexDirection:'column', gap:14, ...(isAuth ? { borderRight:'1px solid var(--bd)' } : {}) }}>
          {err && (
            <div style={{ padding:'10px 13px', borderRadius:8, background:'rgba(239,68,68,.08)', border:'1px solid rgba(239,68,68,.25)', color:'#f87171', fontSize:12, lineHeight:1.55 }}>{err}</div>
          )}

          {/* Name */}
          <div>
            <label style={{ display:'block', fontSize:12, fontWeight:700, color:'var(--t2)', marginBottom:6 }}>Template Name <span style={{ color:'#f87171' }}>*</span></label>
            <input value={name} onChange={e => setName(e.target.value)} placeholder="order_confirmation_v1" style={inputBase} />
            <p style={{ fontSize:11, color:'var(--t3)', marginTop:4 }}>
              Submits as <code style={{ fontFamily:'monospace', color:'var(--t2)' }}>{slug || '—'}</code>. Lowercase letters, numbers, underscores only.
            </p>
          </div>

          {/* WhatsApp number (only when the workspace has more than one — templates are per-number) */}
          {!isEdit && numbers.length > 1 && (
            <div>
              <label style={{ display:'block', fontSize:12, fontWeight:700, color:'var(--t2)', marginBottom:6 }}>WhatsApp Number <span style={{ color:'#f87171' }}>*</span></label>
              <select value={waNumberId} onChange={e => setWaNumberId(e.target.value)}
                style={{ ...inputBase, appearance:'auto', colorScheme:'dark' }}>
                <option value="">Select a number…</option>
                {numbers.map(n => <option key={n.id} value={n.id}>{n.phoneNumber}{n.displayName ? ` · ${n.displayName}` : ''}</option>)}
              </select>
              <p style={{ fontSize:11, color:'var(--t3)', marginTop:5 }}>Templates are private to the number they're created on.</p>
            </div>
          )}

          {/* Category — fixed and hidden when this modal is opened from a
              category-specific entry point (the Authentication module), since
              there is nothing to choose there. */}
          {!forcedCategory && (
          <div>
            <label style={{ display:'block', fontSize:12, fontWeight:700, color:'var(--t2)', marginBottom:6 }}>Category <span style={{ color:'#f87171' }}>*</span></label>
            <div className="rgrid-3" style={{ display:'grid', gridTemplateColumns:`repeat(${cats.length},1fr)`, gap:8 }} role="radiogroup" aria-label="Template category">
              {cats.map(c => (
                <div key={c.id} onClick={() => setCategory(c.id)}
                  tabIndex={0} role="radio" aria-checked={category === c.id}
                  onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); setCategory(c.id); } }}
                  style={{ padding:'10px 12px', borderRadius:8, border:`1.5px solid ${category === c.id ? 'var(--green)' : 'var(--bd)'}`, background: category === c.id ? 'var(--gbg)' : 'rgba(255,255,255,0.02)', cursor:'pointer', outline:'none' }}
                  onFocus={e => { e.currentTarget.style.boxShadow = '0 0 0 2px var(--green)'; }}
                  onBlur={e => { e.currentTarget.style.boxShadow = 'none'; }}>
                  <p style={{ fontSize:13, fontWeight:600, color: category === c.id ? 'var(--green)' : 'var(--t1)', marginBottom:3 }}>{c.label}</p>
                  <p style={{ fontSize:10.5, color:'var(--t3)', lineHeight:1.4 }}>{c.hint}</p>
                </div>
              ))}
            </div>
          </div>
          )}

          {/* Template Type — only the types the chosen category allows. An
              authentication template has exactly one shape, so there is
              nothing to choose and the selector is hidden entirely. */}
          {!isAuth && (
          <div>
            <label style={{ display:'block', fontSize:12, fontWeight:700, color:'var(--t2)', marginBottom:6 }}>Template Type <span style={{ color:'#f87171' }}>*</span></label>
            <div style={{ display:'flex', gap:6, flexWrap:'wrap' }}>
              {allowedTypes.map(t => (
                <button key={t} type="button" onClick={() => { setTemplateType(t); setErr(null); }}
                  style={{ flex:'1 1 150px', textAlign:'left', padding:'9px 12px', borderRadius:8, cursor:'pointer',
                           fontFamily:"'Manrope',sans-serif",
                           border:`1.5px solid ${templateType === t ? 'var(--green)' : 'var(--bd)'}`,
                           background: templateType === t ? 'var(--gbg)' : 'rgba(255,255,255,0.02)' }}>
                  <p style={{ fontSize:13, fontWeight:600, color: templateType === t ? 'var(--green)' : 'var(--t1)', marginBottom:3 }}>{TEMPLATE_TYPE_META[t].label}</p>
                  <p style={{ fontSize:10.5, color:'var(--t3)', lineHeight:1.4 }}>{TEMPLATE_TYPE_META[t].hint}</p>
                </button>
              ))}
            </div>
            {allowedTypes.length === 1 && (
              <p style={{ fontSize:11, color:'var(--t3)', marginTop:5 }}>
                Only the standard format is available for this category.
              </p>
            )}
          </div>
          )}

          {/* Language */}
          <div>
            <label style={{ display:'block', fontSize:12, fontWeight:700, color:'var(--t2)', marginBottom:6 }}>Language <span style={{ color:'#f87171' }}>*</span></label>
            <select value={language} onChange={e => setLanguage(e.target.value)}
              style={{ ...inputBase, appearance:'auto', colorScheme:'dark' }}>
              {langs.map(l => <option key={l.code} value={l.code}>{l.label} ({l.code})</option>)}
            </select>
          </div>

          {/* Authentication — Meta writes this message itself, in the language
              chosen above, and rejects any wording of our own. So there is no
              body, footer or button editor here: only the switches Meta reads.
              What each one produces is shown in the preview below. */}
          {isAuth && (
            <div style={{ padding:'12px 14px', borderRadius:8, background:'rgba(251,191,36,.05)', border:'1px solid rgba(251,191,36,.2)' }}>
              <p style={{ fontSize:12, fontWeight:700, color:'#fbbf24', marginBottom:6 }}>Passcode message</p>
              <p style={{ fontSize:11, color:'#fbbf24', opacity:.85, marginBottom:14, lineHeight:1.55 }}>
                WhatsApp writes this message itself and fills in the code on every send — the wording is fixed and translated for you. Meta rejects authentication templates that carry their own text.
              </p>

              <label style={{ display:'block', fontSize:12, fontWeight:700, color:'var(--t2)', marginBottom:6 }}>
                Code expires after <span style={{ color:'var(--t3)', fontWeight:500 }}>(optional, {OTP_EXPIRY.min}–{OTP_EXPIRY.max} minutes)</span>
              </label>
              <div style={{ display:'flex', alignItems:'center', gap:8 }}>
                <input type="number" min={OTP_EXPIRY.min} max={OTP_EXPIRY.max} value={otpExpiry}
                  onChange={e => setOtpExpiry(e.target.value)}
                  placeholder="5" style={{ ...inputBase, width:110 }} />
                <span style={{ fontSize:12, color:'var(--t3)' }}>minutes</span>
              </div>
              <p style={{ fontSize:11, color:'var(--t3)', marginTop:4, lineHeight:1.5 }}>
                Adds the expiry line to the message. Leave blank to omit it. This is also the window the OTP stays valid for when the code is verified here.
              </p>

              <label style={{ display:'flex', alignItems:'flex-start', gap:8, margin:'14px 0 0', cursor:'pointer' }}>
                <input type="checkbox" checked={otpSecurityNote}
                  onChange={e => setOtpSecurityNote(e.target.checked)}
                  style={{ marginTop:2, accentColor:'var(--green)', width:15, height:15, cursor:'pointer' }} />
                <span>
                  <span style={{ display:'block', fontSize:12.5, fontWeight:600, color:'var(--t1)' }}>Add the security warning</span>
                  <span style={{ display:'block', fontSize:11, color:'var(--t3)', marginTop:2, lineHeight:1.5 }}>
                    Appends “{OTP_PREVIEW.security}” to the message.
                  </span>
                </span>
              </label>

              <label style={{ display:'block', fontSize:12, fontWeight:700, color:'var(--t2)', margin:'14px 0 6px' }}>
                Copy-code button label <span style={{ color:'#f87171' }}>*</span>
              </label>
              <input value={otpButtonLabel} maxLength={25}
                onChange={e => setOtpButtonLabel(e.target.value)}
                placeholder={OTP_BUTTON_LABEL_DEFAULT} style={inputBase} />
              <p style={{ fontSize:11, color:'var(--t3)', marginTop:4, lineHeight:1.5 }}>
                Tapping it copies the passcode. Every authentication template carries this one button and no others.
              </p>
            </div>
          )}

          {/* Header — the formats depend on the category; a carousel puts its
              media on the cards instead, and a catalog template allows none. */}
          {templateType === 'STANDARD' && allowedHeaders.length > 1 && (
            <div>
              <label style={{ display:'block', fontSize:12, fontWeight:700, color:'var(--t2)', marginBottom:6 }}>
                Header <span style={{ color:'var(--t3)', fontWeight:500 }}>(optional)</span>
              </label>
              <div style={{ display:'flex', gap:6, flexWrap:'wrap', marginBottom: headerKind === 'NONE' ? 0 : 10 }}>
                {allowedHeaders.map(fmt => (
                  <button key={fmt} type="button" onClick={() => { setHeaderKind(fmt); setErr(null); }}
                    style={{ padding:'7px 13px', borderRadius:8, cursor:'pointer', fontSize:12.5, fontWeight:600,
                             fontFamily:"'Manrope',sans-serif",
                             border:`1px solid ${headerKind === fmt ? 'var(--gbd)' : 'var(--bd)'}`,
                             background: headerKind === fmt ? 'var(--gbg)' : 'rgba(255,255,255,0.04)',
                             color: headerKind === fmt ? 'var(--green)' : 'var(--t2)' }}>
                    {HEADER_FORMAT_META[fmt].label}
                  </button>
                ))}
              </div>

              {headerKind === 'TEXT' && (
                <input value={headerText} maxLength={60} onChange={e => setHeaderText(e.target.value)}
                  placeholder="e.g. Your order is on the way" style={inputBase} />
              )}

              {['IMAGE', 'VIDEO', 'DOCUMENT'].includes(headerKind) && (
                <div style={{ border:'1px dashed var(--bd)', borderRadius:10, padding:14, display:'flex', gap:12, alignItems:'center', flexWrap:'wrap' }}>
                  {headerKind === 'IMAGE' && headerPreview ? (
                    <img src={headerPreview} alt="Header preview"
                      style={{ width:72, height:72, objectFit:'cover', borderRadius:8, border:'1px solid var(--bd)' }} />
                  ) : (
                    <div style={{ width:72, height:72, borderRadius:8, background:'rgba(255,255,255,0.04)', border:'1px solid var(--bd)', display:'flex', alignItems:'center', justifyContent:'center' }}>
                      <I n="file" s={22} c="var(--t3)" />
                    </div>
                  )}
                  <div style={{ flex:1, minWidth:190 }}>
                    <input type="file" accept={HEADER_FORMAT_META[headerKind].accept} disabled={uploading}
                      onChange={e => pickHeaderImage(e.target.files?.[0])}
                      style={{ fontSize:12, color:'var(--t2)', maxWidth:'100%' }} />
                    <p style={{ fontSize:11, color:'var(--t3)', marginTop:6, lineHeight:1.5 }}>
                      {uploading ? 'Uploading to Meta…'
                        : headerMedia ? `Uploaded ${headerMedia.name} — ${headerMedia.format} header ready.`
                        : isEdit && initialHeader ? 'This template already has a media header. Upload a new file only to replace it.'
                        : `${HEADER_FORMAT_META[headerKind].hint} Meta needs this sample to review the template.`}
                    </p>
                    {headerMedia && (
                      <button type="button" onClick={() => { setHeaderMedia(null); setHeaderPreview(null); }}
                        style={{ marginTop:6, background:'none', border:'none', padding:0, cursor:'pointer', color:'#f87171', fontSize:11.5, fontWeight:600 }}>
                        Remove
                      </button>
                    )}
                  </div>
                </div>
              )}
            </div>
          )}

          {templateType === 'CAROUSEL' && (
            <p style={{ fontSize:11.5, color:'var(--t3)', lineHeight:1.5, margin:0 }}>
              A carousel has no header of its own — each card carries its own image, configured below.
            </p>
          )}
          {templateType === 'CATALOG' && (
            <p style={{ fontSize:11.5, color:'var(--t3)', lineHeight:1.5, margin:0 }}>
              Catalog templates cannot have a header. The button opens the catalog already linked to your WhatsApp Business account.
            </p>
          )}

          {/* Body — authored for every category except authentication, whose
              body is written by Meta and configured in the panel above. */}
          {!isAuth && (
          <div>
            <label style={{ display:'block', fontSize:12, fontWeight:700, color:'var(--t2)', marginBottom:6 }}>Body Text <span style={{ color:'#f87171' }}>*</span></label>
            <textarea value={body} onChange={e => setBody(e.target.value)} rows={4}
              placeholder="Hello {{1}}, your order #{{2}} has been confirmed!"
              style={{ ...inputBase, resize:'vertical', minHeight:90, lineHeight:1.55 }} />
            <p style={{ fontSize:11, color:'var(--t3)', marginTop:4 }}>
              Use <code style={{ fontFamily:'monospace', color:'var(--green)' }}>{'{{1}}'}</code>, <code style={{ fontFamily:'monospace', color:'var(--green)' }}>{'{{2}}'}</code> etc. for variables. Max 1024 chars.
            </p>
          </div>
          )}

          {/* Variable examples */}
          {vars.length > 0 && (
            <div style={{ padding:'12px 14px', borderRadius:8, background:'rgba(14,165,233,.06)', border:'1px solid rgba(14,165,233,.18)' }}>
              <p style={{ fontSize:12, fontWeight:600, color:'#b9a3ff', marginBottom:10 }}>
                Variable example values
              </p>
              <p style={{ fontSize:11, color:'#b9a3ff', opacity:.8, marginBottom:10, lineHeight:1.5 }}>
                Meta requires a sample value for each variable so reviewers can understand the message context.
              </p>
              <div style={{ display:'flex', flexDirection:'column', gap:8 }}>
                {vars.map(n => (
                  <div key={n} style={{ display:'flex', alignItems:'center', gap:8 }}>
                    <span style={{ fontFamily:'monospace', fontSize:12, color:'var(--green)', minWidth:42 }}>{`{{${n}}}`}</span>
                    <input value={examples[n] || ''} onChange={e => setExamples(x => ({ ...x, [n]: e.target.value }))}
                      placeholder={`Sample value for {{${n}}}`} style={{ ...inputBase, flex:1 }} />
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Footer — independent of the header. Meta has no footer on a
              carousel, and an authentication template's footer carries the
              expiry rather than text (set in the panel above). */}
          {templateType !== 'CAROUSEL' && !isAuth && (
            <div>
              <label style={{ display:'block', fontSize:12, fontWeight:700, color:'var(--t2)', marginBottom:6 }}>Footer <span style={{ color:'var(--t3)', fontWeight:500 }}>(optional, max 60 chars)</span></label>
              <input value={footer} maxLength={60} onChange={e => setFooter(e.target.value)}
                placeholder="Reply STOP to unsubscribe" style={inputBase} />
              <p style={{ fontSize:11, color:'var(--t3)', marginTop:4 }}>Plain text only — Meta does not allow variables in a footer.</p>
            </div>
          )}

          {/* Catalog configuration */}
          {templateType === 'CATALOG' && (
            <div>
              <label style={{ display:'block', fontSize:12, fontWeight:700, color:'var(--t2)', marginBottom:6 }}>Catalog Button <span style={{ color:'#f87171' }}>*</span></label>
              <input value={catalogLabel} maxLength={25} onChange={e => setCatalogLabel(e.target.value)}
                placeholder="View catalog" style={inputBase} />
              <p style={{ fontSize:11, color:'var(--t3)', marginTop:4, lineHeight:1.5 }}>
                The button opens the product catalog connected to this WhatsApp Business account.
              </p>

              <label style={{ display:'block', fontSize:12, fontWeight:700, color:'var(--t2)', margin:'14px 0 6px' }}>
                Thumbnail product ID <span style={{ color:'var(--t3)', fontWeight:500 }}>(optional)</span>
              </label>
              <input value={catalogThumbnailId} maxLength={100} onChange={e => setCatalogThumbnailId(e.target.value)}
                placeholder="e.g. 2lc20305pt" style={inputBase} />
              <p style={{ fontSize:11, color:'var(--t3)', marginTop:4, lineHeight:1.5 }}>
                The item whose picture heads the message — its Content ID in Commerce Manager. Leave blank to use the first product in the catalog.
              </p>
            </div>
          )}

          {/* Buttons — the message bubble's own buttons. A carousel puts
              buttons on each card instead; a catalog template's single button
              and an authentication template's OTP button are configured
              above, and Meta allows neither of those to sit beside others. */}
          {templateType === 'STANDARD' && !isAuth && (
          <div>
            <label style={{ display:'block', fontSize:12, fontWeight:700, color:'var(--t2)', marginBottom:6 }}>
              Buttons <span style={{ color:'var(--t3)', fontWeight:500 }}>(optional)</span>
            </label>

            {buttons.length > 0 && (
              <div style={{ display:'flex', flexDirection:'column', gap:8, marginBottom:10 }}>
                {buttons.map((b, i) => (
                  <div key={i} style={{ border:'1px solid var(--bd)', borderRadius:9, padding:'10px 12px', background:'rgba(255,255,255,0.02)', display:'flex', flexDirection:'column', gap:8 }}>
                    <div style={{ display:'flex', gap:8, alignItems:'center', flexWrap:'wrap' }}>
                      <span style={{ fontSize:10.5, fontWeight:700, color:'var(--t3)', textTransform:'uppercase', letterSpacing:'.06em', minWidth:76 }}>
                        {{ QUICK_REPLY:'Quick reply', URL:'Link', PHONE_NUMBER:'Call', COPY_CODE:'Copy code' }[b.type]}
                      </span>
                      <input value={b.text || ''} maxLength={25}
                        onChange={e => setButtons(list => list.map((x, j) => j === i ? { ...x, text: e.target.value } : x))}
                        placeholder="Button label" style={{ ...inputBase, flex:1, minWidth:130 }} />
                      <span style={{ fontSize:10.5, color: (b.text || '').length >= 25 ? '#fbbf24' : 'var(--t3)' }}>{(b.text || '').length}/25</span>
                      <button type="button" onClick={() => setButtons(list => list.filter((_, j) => j !== i))}
                        style={{ padding:'5px 9px', borderRadius:6, background:'rgba(239,68,68,0.08)', border:'1px solid rgba(239,68,68,0.22)', color:'#f87171', cursor:'pointer', fontSize:11 }}>Remove</button>
                    </div>
                    {b.type === 'URL' && (
                      <div style={{ display:'flex', gap:8, flexWrap:'wrap' }}>
                        <input value={b.url || ''}
                          onChange={e => setButtons(list => list.map((x, j) => j === i ? { ...x, url: e.target.value } : x))}
                          placeholder="https://example.com/orders/{{1}}" style={{ ...inputBase, flex:2, minWidth:190 }} />
                        {/\{\{\d+\}\}/.test(b.url || '') && (
                          <input value={b.example || ''}
                            onChange={e => setButtons(list => list.map((x, j) => j === i ? { ...x, example: e.target.value } : x))}
                            placeholder="Example for {{1}}" style={{ ...inputBase, flex:1, minWidth:130 }} />
                        )}
                      </div>
                    )}
                    {b.type === 'PHONE_NUMBER' && (
                      <input value={b.phone_number || ''}
                        onChange={e => setButtons(list => list.map((x, j) => j === i ? { ...x, phone_number: e.target.value } : x))}
                        placeholder="+91 98765 43210" style={inputBase} />
                    )}
                    {b.type === 'COPY_CODE' && (
                      <input value={b.example || ''}
                        onChange={e => setButtons(list => list.map((x, j) => j === i ? { ...x, example: e.target.value } : x))}
                        placeholder="Example code, e.g. SAVE20" style={inputBase} />
                    )}
                  </div>
                ))}
              </div>
            )}

            <div style={{ display:'flex', gap:6, flexWrap:'wrap' }}>
              {[
                ['QUICK_REPLY',  'Quick reply', b => b.filter(x => x.type === 'QUICK_REPLY').length >= 10],
                ['URL',          'Link',        b => b.filter(x => x.type === 'URL').length >= 2],
                ['PHONE_NUMBER', 'Call',        b => b.some(x => x.type === 'PHONE_NUMBER')],
                ['COPY_CODE',    'Copy code',   b => b.some(x => x.type === 'COPY_CODE')],
              ].map(([type, label, atLimit]) => {
                const disabled = buttons.length >= 10 || atLimit(buttons);
                return (
                  <button key={type} type="button" disabled={disabled}
                    onClick={() => setButtons(list => [...list, { type, text:'' }])}
                    style={{ padding:'7px 12px', borderRadius:8, background:'transparent', border:'1px solid var(--bd)',
                             color: disabled ? 'var(--t3)' : 'var(--green)', cursor: disabled ? 'not-allowed' : 'pointer',
                             fontSize:12, fontWeight:600, opacity: disabled ? 0.5 : 1, fontFamily:"'Manrope',sans-serif" }}>
                    + {label}
                  </button>
                );
              })}
            </div>
            <p style={{ fontSize:11, color:'var(--t3)', marginTop:6, lineHeight:1.5 }}>
              Up to 2 links, 1 call and 1 copy-code button. More than 3 buttons are hidden on WhatsApp desktop.
              {buttons.length > 3 && <span style={{ color:'#fbbf24' }}> This template has {buttons.length}.</span>}
            </p>
          </div>
          )}

          {/* Carousel cards */}
          {templateType === 'CAROUSEL' && (
            <div>
              <label style={{ display:'block', fontSize:12, fontWeight:700, color:'var(--t2)', marginBottom:6 }}>
                Cards <span style={{ color:'var(--t3)', fontWeight:500 }}>({cards.length}/{CARD_MAX})</span>
              </label>
              <p style={{ fontSize:11, color:'var(--t3)', marginBottom:10, lineHeight:1.5 }}>
                Every card needs an image and the same buttons in the same order — Meta rejects the whole template otherwise.
              </p>

              <div style={{ display:'flex', flexDirection:'column', gap:10 }}>
                {cards.map((c, ci) => (
                  <div key={ci} style={{ border:'1px solid var(--bd)', borderRadius:10, padding:'12px 13px', background:'rgba(255,255,255,0.02)', display:'flex', flexDirection:'column', gap:10 }}>
                    <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center' }}>
                      <span style={{ fontSize:11, fontWeight:700, color:'var(--t2)', textTransform:'uppercase', letterSpacing:'.06em' }}>Card {ci + 1}</span>
                      <button type="button" onClick={() => setCards(l => l.filter((_, k) => k !== ci))}
                        style={{ padding:'4px 9px', borderRadius:6, background:'rgba(239,68,68,0.08)', border:'1px solid rgba(239,68,68,0.22)', color:'#f87171', cursor:'pointer', fontSize:11 }}>Remove</button>
                    </div>

                    <div style={{ display:'flex', gap:12, alignItems:'flex-start', flexWrap:'wrap' }}>
                      {c.preview ? (
                        <img src={c.preview} alt="" style={{ width:64, height:64, objectFit:'cover', borderRadius:8, border:'1px solid var(--bd)' }} />
                      ) : (
                        <div style={{ width:64, height:64, borderRadius:8, background:'rgba(255,255,255,0.04)', border:'1px solid var(--bd)', display:'flex', alignItems:'center', justifyContent:'center' }}>
                          <I n="file" s={20} c="var(--t3)" />
                        </div>
                      )}
                      <div style={{ flex:1, minWidth:180 }}>
                        <input type="file" accept="image/jpeg,image/png" disabled={cardUploading === ci}
                          onChange={e => pickCardImage(ci, e.target.files?.[0])}
                          style={{ fontSize:12, color:'var(--t2)', maxWidth:'100%' }} />
                        <p style={{ fontSize:11, color:'var(--t3)', marginTop:5 }}>
                          {cardUploading === ci ? 'Uploading to Meta…'
                            : c.media?.handle ? `Uploaded ${c.media.name || 'image'} — ready.`
                            : c.media?.example ? 'This card already has an image. Upload a new one only to replace it.'
                            : 'JPG or PNG up to 5 MB.'}
                        </p>
                      </div>
                    </div>

                    <input value={c.body} maxLength={CARD_BODY_MAX}
                      onChange={e => setCards(l => l.map((x, k) => k === ci ? { ...x, body: e.target.value } : x))}
                      placeholder={`Card text (optional, max ${CARD_BODY_MAX} chars)`} style={inputBase} />

                    <div style={{ display:'flex', flexDirection:'column', gap:7 }}>
                      {c.buttons.map((b, bi) => (
                        <div key={bi} style={{ display:'flex', gap:7, alignItems:'center', flexWrap:'wrap' }}>
                          <span style={{ fontSize:10.5, fontWeight:700, color:'var(--t3)', textTransform:'uppercase', letterSpacing:'.06em', minWidth:72 }}>
                            {b.type === 'URL' ? 'Link' : 'Quick reply'}
                          </span>
                          <input value={b.text || ''} maxLength={25}
                            onChange={e => setCards(l => l.map((x, k) => k === ci ? { ...x, buttons: x.buttons.map((y, m) => m === bi ? { ...y, text: e.target.value } : y) } : x))}
                            placeholder="Button label" style={{ ...inputBase, flex:1, minWidth:120 }} />
                          {b.type === 'URL' && (
                            <input value={b.url || ''}
                              onChange={e => setCards(l => l.map((x, k) => k === ci ? { ...x, buttons: x.buttons.map((y, m) => m === bi ? { ...y, url: e.target.value } : y) } : x))}
                              placeholder="https://example.com" style={{ ...inputBase, flex:1, minWidth:150 }} />
                          )}
                          <button type="button" onClick={() => setCards(l => l.map((x, k) => k === ci ? { ...x, buttons: x.buttons.filter((_, m) => m !== bi) } : x))}
                            style={{ padding:'5px 9px', borderRadius:6, background:'rgba(239,68,68,0.08)', border:'1px solid rgba(239,68,68,0.22)', color:'#f87171', cursor:'pointer', fontSize:11 }}>Remove</button>
                        </div>
                      ))}
                      {c.buttons.length < 2 && (
                        <div style={{ display:'flex', gap:6 }}>
                          {[['QUICK_REPLY', 'Quick reply'], ['URL', 'Link']].map(([t, label]) => (
                            <button key={t} type="button"
                              onClick={() => setCards(l => l.map((x, k) => k === ci ? { ...x, buttons: [...x.buttons, { type: t, text: '' }] } : x))}
                              style={{ padding:'6px 11px', borderRadius:8, background:'transparent', border:'1px solid var(--bd)', color:'var(--green)', cursor:'pointer', fontSize:11.5, fontWeight:600, fontFamily:"'Manrope',sans-serif" }}>
                              + {label}
                            </button>
                          ))}
                        </div>
                      )}
                    </div>
                  </div>
                ))}
              </div>

              {cards.length < CARD_MAX && (
                <button type="button"
                  onClick={() => setCards(l => [...l, {
                    body: '', media: null, preview: null,
                    // A new card copies card 1's button set, because Meta requires
                    // every card to carry the same buttons in the same order.
                    buttons: l[0] ? l[0].buttons.map(b => ({ ...b, text: b.text || '' })) : [],
                  }])}
                  style={{ marginTop:10, padding:'8px 13px', borderRadius:8, background:'transparent', border:'1px dashed var(--bd)', color:'var(--green)', cursor:'pointer', fontSize:12, fontWeight:600, fontFamily:"'Manrope',sans-serif" }}>
                  + Add card
                </button>
              )}
            </div>
          )}

          {!isAuth && previewSection}
        </div>
        {isAuth && (
          <div style={{ flex:'1 1 50%', overflowY:'auto', padding:'20px 24px' }}>
            {previewSection}
          </div>
        )}
        </div>

        <div style={{ padding:'14px 24px', borderTop:'1px solid var(--bd)', display:'flex', justifyContent:'space-between', alignItems:'center', flexShrink:0 }}>
          <span style={{ fontSize:11, color:'var(--t3)' }}>Approval by Meta usually takes minutes to hours.</span>
          <div style={{ display:'flex', gap:8 }}>
            <Btn variant="ghost" onClick={onClose}>Cancel</Btn>
            <Btn onClick={submit} disabled={!canSubmit} style={{ boxShadow: canSubmit ? 'var(--glow)' : 'none' }}>
              {saving ? (isEdit ? 'Saving…' : 'Submitting…') : (isEdit ? 'Save Changes' : 'Submit to Meta')}
            </Btn>
          </div>
        </div>
      </div>
    </div>
  );
};

export { TemplateModal, TEMPLATE_TYPE_META, OTP_PREVIEW, OTP_BUTTON_LABEL_DEFAULT };
