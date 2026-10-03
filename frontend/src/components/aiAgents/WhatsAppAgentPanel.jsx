import { useState, useEffect, useCallback } from 'react';
import { I } from '../Icons.jsx';
import { Btn } from '../Btn.jsx';
import { confirmDialog } from '../Feedback.jsx';
import { wJson } from '../../lib/automationApi.js';
import { validateMeaningfulText } from '../../lib/validation.js';
import { can } from '../../lib/permissions.js';
import { AI_AGENTS_API } from '../../lib/aiAgentsApi.js';
import { usePlanFeatures } from '../../lib/usePlanFeatures.js';

// The live WhatsApp AI agent: persona, knowledge, guardrails, campaign
// awareness, the test lab and the deploy switch. It used to be the Automation
// page's "WhatsApp AI Agent" tab, reachable only by deep link; it is now one
// section of the AI Agents area (pages/AiAgentsView.jsx), on the
// /ai-agents/whatsapp API.

const WA = AI_AGENTS_API.whatsapp;

const card = { background:'var(--surf)', border:'1px solid var(--bd)', borderRadius:'var(--rl)', boxShadow:'var(--card-shadow)' };
const inputStyle = { width:'100%', padding:'10px 13px', borderRadius:8, background:'rgba(255,255,255,0.03)', border:'1px solid var(--bd)', color:'var(--t1)', fontSize:13, outline:'none', fontFamily:"'Manrope',sans-serif", boxSizing:'border-box' };
const labelStyle = { display:'block', fontSize:'11px', fontWeight:600, color:'var(--t2)', textTransform:'uppercase', letterSpacing:'.05em', marginBottom:6 };

const Toggle = ({ on, onToggle, disabled = false }) => (
  <div onClick={disabled ? undefined : onToggle} style={{ width:36, height:20, borderRadius:20, background: on ? 'var(--green)' : 'rgba(255,255,255,0.1)', cursor: disabled ? 'not-allowed' : 'pointer', opacity: disabled ? 0.5 : 1, transition:'background .2s', position:'relative', border:`1px solid ${on ? 'var(--gbd)' : 'var(--bd)'}`, flexShrink:0 }}>
    <div style={{ position:'absolute', top:2, left: on ? 17 : 2, width:14, height:14, borderRadius:'50%', background:'white', transition:'left .2s', boxShadow:'0 1px 3px rgba(0,0,0,0.4)' }} />
  </div>
);

const Banner = ({ tone = 'info', children }) => {
  const palette = {
    error: { bd:'rgba(239,68,68,.25)', bg:'rgba(239,68,68,.06)', fg:'#f87171' },
    warn:  { bd:'rgba(245,158,11,.3)', bg:'rgba(245,158,11,.06)', fg:'#fbbf24' },
    ok:    { bd:'var(--gbd)',          bg:'var(--gbg)',           fg:'var(--green)' },
    info:  { bd:'var(--bd)',           bg:'rgba(255,255,255,0.03)', fg:'var(--t2)' },
  }[tone];
  return (
    <div style={{ ...card, padding:'11px 15px', border:`1px solid ${palette.bd}`, background:palette.bg, display:'flex', alignItems:'center', gap:8 }}>
      <I n="alertc" s={14} c={palette.fg} />
      <span style={{ fontSize:12.5, color:palette.fg, lineHeight:1.5 }}>{children}</span>
    </div>
  );
};

const TabHeader = ({ icon, color, bg, title, subtitle, badge, children }) => (
  <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center', gap:16, flexWrap:'wrap' }}>
    <div style={{ display:'flex', alignItems:'center', gap:'12px' }}>
      <div style={{ width:'36px', height:'36px', borderRadius:'8px', background:bg, border:`1px solid ${color}44`, display:'flex', alignItems:'center', justifyContent:'center', flexShrink:0 }}>
        <I n={icon} s={18} c={color} />
      </div>
      <div>
        <div style={{ display:'flex', alignItems:'center', gap:8 }}>
          <h2 style={{ fontFamily:"'Space Grotesk',sans-serif", fontWeight:700, fontSize:'18px', color:'var(--t1)' }}>{title}</h2>
          {badge}
        </div>
        <p style={{ fontSize:'13px', color:'var(--t2)', marginTop:2 }}>{subtitle}</p>
      </div>
    </div>
    {children}
  </div>
);

const Pill = ({ children, tone = 'green' }) => (
  <span style={{ fontSize:10, fontWeight:700, padding:'2px 8px', borderRadius:20, background: tone === 'green' ? 'var(--gbg)' : 'rgba(245,158,11,0.1)', border:`1px solid ${tone === 'green' ? 'var(--gbd)' : 'rgba(245,158,11,0.3)'}`, color: tone === 'green' ? 'var(--green)' : '#f59e0b', textTransform:'uppercase', letterSpacing:'.05em' }}>
    {children}
  </span>
);


// How a campaign's own status reads on the agent's usage list. Deliberately
// the campaign's real status rather than a made-up on/off: a paused (cancelled)
// campaign still has customers holding a message with a live CTA.
const CAMPAIGN_TONE = {
  RUNNING:   { label:'Active',    fg:'var(--success)', bg:'var(--sbg)',          bd:'var(--sbd)' },
  SCHEDULED: { label:'Scheduled', fg:'#9d6bff',      bg:'rgba(157,107,255,.08)',  bd:'rgba(157,107,255,.25)' },
  COMPLETED: { label:'Completed', fg:'var(--success)', bg:'var(--sbg)',          bd:'var(--sbd)' },
  DRAFT:     { label:'Draft',     fg:'var(--t2)',    bg:'rgba(255,255,255,.05)', bd:'var(--bd)' },
  CANCELLED: { label:'Paused',    fg:'#fbbf24',      bg:'rgba(245,158,11,.08)',  bd:'rgba(245,158,11,.25)' },
  FAILED:    { label:'Failed',    fg:'#f87171',      bg:'rgba(239,68,68,.08)',   bd:'rgba(239,68,68,.25)' },
};
// The eight things that make an agent answer well, in the order you configure
// them. The section rail is the page's spine: each one edits a different part
// of what the model is handed, and lumping them into one long form was what
// made the previous version unreadable once it grew past three fields.
const AGENT_SECTIONS = [
  { id: 'identity',    icon: 'user',   label: 'Identity',          kicker: 'Identity & tone',        blurb: 'How the agent introduces itself and speaks to customers.' },
  { id: 'purpose',     icon: 'spark',  label: 'Purpose',           kicker: 'What it is for',         blurb: 'The job this agent exists to do. Given to the model as standing context.' },
  { id: 'knowledge',   icon: 'db',     label: 'Knowledge',         kicker: 'Knowledge sources',      blurb: 'What the agent knows. It answers from the notes and documents added here.' },
  { id: 'instructions',icon: 'note',   label: 'Instructions',      kicker: 'Answering rules',        blurb: 'How to answer — length, formatting, what to do when unsure.' },
  { id: 'campaign',    icon: 'send',   label: 'Campaign awareness',kicker: 'Campaigns using it',     blurb: 'Where this agent is attached, and what it answers about there.' },
  { id: 'escalation',  icon: 'wflow',  label: 'Escalation',        kicker: 'Escalation & handoff',   blurb: 'When the agent steps back and brings in a human.' },
  { id: 'safety',      icon: 'shield', label: 'Safety',            kicker: 'Guardrails',             blurb: 'What the agent must never do, in its own words.' },
  { id: 'performance', icon: 'chart',  label: 'Performance',       kicker: 'Readiness',              blurb: 'What is still missing before this agent is ready for customers.' },
];

const AGENT_LANGUAGES = ['English', 'हिंदी', 'Hinglish', 'मराठी', 'বাংলা', 'தமிழ்', 'తెలుగు', 'ગુજરાતી'];

// Escalation rules mirror backend ESCALATION_RULES. The ids are the contract;
// the labels are this page's business.
const ESCALATION_RULES = [
  { id: 'refund',            label: 'Refund or complaint intent',  hint: 'Anything about money going back' },
  { id: 'negativeSentiment', label: 'Negative sentiment detected',  hint: 'Frustration, anger, repeated complaints' },
  { id: 'asksForHuman',      label: 'Customer asks for a human',    hint: 'An explicit request always wins' },
  { id: 'highIntent',        label: 'High purchase intent',         hint: 'Hand a ready buyer to a person' },
];

const SOURCE_STATUS = {
  READY:   { label: 'CONNECTED', fg: 'var(--success)', bg: 'var(--sbg)',              bd: 'var(--sbd)' },
  PENDING: { label: 'INDEXING',  fg: '#fbbf24',        bg: 'rgba(245,158,11,.08)',   bd: 'rgba(245,158,11,.28)' },
  ERROR:   { label: 'FAILED',    fg: '#f87171',        bg: 'rgba(239,68,68,.08)',    bd: 'rgba(239,68,68,.25)' },
};

const SectionIntro = ({ section }) => (
  <div style={{ marginBottom: 18 }}>
    <div style={{ fontFamily:'var(--mono)', fontSize:10, letterSpacing:'.16em', textTransform:'uppercase', color:'var(--t3)', marginBottom:7 }}>Configure</div>
    <h3 style={{ fontFamily:"'Space Grotesk',sans-serif", fontWeight:700, fontSize:19, color:'var(--t1)', letterSpacing:'-.02em' }}>{section.kicker}</h3>
    <p style={{ fontSize:13, color:'var(--t2)', marginTop:5, lineHeight:1.6, maxWidth:520 }}>{section.blurb}</p>
  </div>
);

const WhatsAppAgentPanel = () => {
  // Configuring and deploying is member work; testing is open to agents too
  // (the inbox uses the same preview). Mirrors lib/permissions CAPABILITIES.
  const canEdit = can('aiAgents.manage');
  const canTest = can('aiAgent.test');
  // Deploying and testing the agent is the campaignAi plan feature.
  const { allows } = usePlanFeatures();
  const planLocked = !allows('campaignAi');

  const [cfg, setCfg] = useState(null);
  const [section, setSection] = useState('identity');

  // Identity
  const [name, setName] = useState('');
  const [systemPrompt, setSystemPrompt] = useState('');
  const [languages, setLanguages] = useState(['English']);
  // The sections added alongside it
  const [purpose, setPurpose] = useState('');
  const [instructions, setInstructions] = useState('');
  const [safetyNote, setSafetyNote] = useState('');
  const [escThreshold, setEscThreshold] = useState(0.65);
  const [escRules, setEscRules] = useState({});
  const [escRulesTouched, setEscRulesTouched] = useState(false);

  const [knowledge, setKnowledge] = useState('');
  const [uploadingDoc, setUploadingDoc] = useState(false);
  const [uploadNote, setUploadNote] = useState(null);
  const [sources, setSources] = useState([]);
  const [newSourceUrl, setNewSourceUrl] = useState('');
  const [addingSource, setAddingSource] = useState(false);

  const [saving, setSaving] = useState(false);
  const [deploying, setDeploying] = useState(false);
  const [banner, setBanner] = useState(null);

  // Test Lab
  const [testMsg, setTestMsg] = useState('What are your business hours?');
  const [thread, setThread] = useState([]);
  const [testing, setTesting] = useState(false);
  const [usage, setUsage] = useState(null);
  const [campaigns, setCampaigns] = useState([]);
  const [testMode, setTestMode] = useState('general');
  const [testCampaignId, setTestCampaignId] = useState('');

  const load = useCallback(() => wJson(`${WA}/config`).then(r => {
    if (!r.ok || !r.data) return;
    const d = r.data;
    setCfg(d);
    setName(d.aiAgentName || '');
    setSystemPrompt(d.aiAgentPrompt || '');
    setKnowledge(d.aiAgentKnowledge || '');
    setPurpose(d.aiAgentPurpose || '');
    setInstructions(d.aiAgentInstructions || '');
    setSafetyNote(d.aiAgentSafetyNote || '');
    setLanguages(Array.isArray(d.aiAgentLanguages) && d.aiAgentLanguages.length ? d.aiAgentLanguages : ['English']);
    setEscThreshold(typeof d.escalationThreshold === 'number' ? d.escalationThreshold : 0.65);
    setEscRules(d.escalationRules || {});
    setEscRulesTouched(false);
  }), []);
  useEffect(() => { load(); }, [load]);

  // Structured knowledge sources are the rows the website widget indexes. They
  // are listed here so the corpus is visible in one place, but the WhatsApp
  // agent's replies do not retrieve from them yet (only the notes column), and
  // the panel says so.
  const loadSources = useCallback(() => wJson('/widgets/knowledge').then(r => {
    if (r.ok && Array.isArray(r.data)) setSources(r.data);
  }), []);
  useEffect(() => { loadSources(); }, [loadSources]);

  const loadUsage = useCallback(() => wJson(`${WA}/campaigns`).then(r => {
    if (r.ok && r.data) setUsage(r.data);
  }), []);
  useEffect(() => { loadUsage(); }, [loadUsage]);

  useEffect(() => {
    wJson('/campaigns?limit=100').then(r => {
      const list = Array.isArray(r.data) ? r.data : r.data?.data;
      if (r.ok && Array.isArray(list)) setCampaigns(list);
    });
  }, []);

  const validateFields = () => {
    if (name.trim()) { const e = validateMeaningfulText(name, 'Agent name'); if (e) return e; }
    if (systemPrompt.trim()) { const e = validateMeaningfulText(systemPrompt, 'Persona'); if (e) return e; }
    return null;
  };

  // One payload for every section: the page saves the whole agent, so moving
  // between sections can never lose an edit made in the one you left.
  //
  // Escalation rules go back only once the workspace has chosen them (saved
  // before, or toggled here). The page shows defaults with three switched on,
  // and sending those on every save — an undeploy included — stored them as
  // the workspace's choice.
  const payload = () => JSON.stringify({
    name, systemPrompt, knowledge, purpose, instructions, safetyNote,
    languages, escalationThreshold: escThreshold,
    ...(escRulesTouched || cfg?.escalationRulesSet ? { escalationRules: escRules } : {}),
  });

  const save = async () => {
    const fieldError = validateFields();
    if (fieldError) { setBanner({ tone:'error', text:fieldError }); return; }
    setSaving(true); setBanner(null);
    const r = await wJson(`${WA}/config`, { method:'PATCH', body: payload() });
    setSaving(false);
    if (!r.ok) { setBanner({ tone:'error', text:r.error }); return; }
    setCfg(r.data);
    setBanner({ tone:'ok', text:'Configuration saved.' });
  };

  const deploy = async () => {
    const fieldError = validateFields();
    if (fieldError) { setBanner({ tone:'error', text:fieldError }); return; }
    setDeploying(true); setBanner(null);
    await wJson(`${WA}/config`, { method:'PATCH', body: payload() });
    const r = await wJson(cfg?.aiAgentEnabled ? `${WA}/undeploy` : `${WA}/deploy`, { method:'POST' });
    setDeploying(false);
    if (!r.ok) { setBanner({ tone:'error', text:r.error }); return; }
    setBanner({ tone:'ok', text: r.data.aiAgentEnabled
      ? 'Agent deployed — it now answers inbound messages when no automation rule matches, and can be attached to campaigns.'
      : 'Agent undeployed.' });
    load();
  };

  const uploadKnowledgeDoc = async (file) => {
    if (!file) return;
    setUploadingDoc(true);
    setUploadNote(null);
    const fd = new FormData();
    fd.append('file', file);
    const r = await wJson(`${WA}/knowledge/upload`, { method: 'POST', body: fd });
    setUploadingDoc(false);
    if (!r.ok) { setUploadNote({ error: r.error }); return; }
    const d = r.data;
    setKnowledge(d.knowledge);
    setUploadNote({
      truncated: d.truncated,
      text: d.truncated
        ? `Added ${d.added.toLocaleString()} characters from "${d.fileName}", but ${d.dropped.toLocaleString()} had to be dropped — the knowledge base holds ${d.limit.toLocaleString()} characters and is now full.`
        : `Added ${d.added.toLocaleString()} characters from "${d.fileName}". Using ${d.used.toLocaleString()} of ${d.limit.toLocaleString()}.`,
    });
  };

  const addUrlSource = async () => {
    const url = newSourceUrl.trim();
    if (!url) return;
    setAddingSource(true); setBanner(null);
    const r = await wJson('/widgets/knowledge', { method:'POST', body: JSON.stringify({ kind:'url', url }) });
    setAddingSource(false);
    if (!r.ok) { setBanner({ tone:'error', text:r.error }); return; }
    setNewSourceUrl('');
    loadSources();
    load();   // readiness moves the moment a source connects
  };

  const removeSource = async (source) => {
    if (!await confirmDialog(`Remove "${source.title}" from the agent's knowledge?`, { danger: true })) return;
    const r = await wJson(`/widgets/knowledge/${source.id}`, { method:'DELETE' });
    if (!r.ok) { setBanner({ tone:'error', text:r.error }); return; }
    loadSources();
    load();
  };

  const runTest = async () => {
    const question = testMsg.trim();
    if (!question) return;
    if (testMode === 'campaign' && !testCampaignId) {
      setThread(t => [...t, { role:'error', text:'Select a campaign to test against.' }]);
      return;
    }
    setTesting(true);
    setThread(t => [...t, { role:'customer', text: question }]);
    const r = await wJson(`${WA}/test`, { method:'POST', body: JSON.stringify({
      message: question,
      mode: testMode,
      ...(testMode === 'campaign' ? { campaignId: testCampaignId } : {}),
    }) });
    setTesting(false);
    setTestMsg('');
    if (r.ok && r.data?.ok) {
      setThread(t => [...t, {
        role: 'agent',
        text: r.data.reply,
        sources: r.data.sources || [],
        grounding: r.data.grounding,
        context: r.data.context,
      }]);
    } else {
      setThread(t => [...t, { role:'error', text: r.data?.reason || r.data?.error || r.error || 'Test failed' }]);
    }
  };

  const deployed = cfg?.aiAgentEnabled === true;
  const llmMissing = cfg && cfg.llmAvailable === false;
  const readiness = cfg?.readiness;
  const active = AGENT_SECTIONS.find(x => x.id === section) || AGENT_SECTIONS[0];

  const toggleLanguage = (lang) => setLanguages(list =>
    list.includes(lang) ? list.filter(l => l !== lang) : [...list, lang]);

  return (
    <div style={{ display:'flex', flexDirection:'column', gap:'16px' }}>
      <TabHeader icon="bot" color="#9d6bff" bg="rgba(157,107,255,0.1)"
        title={name || 'WhatsApp AI Agent'}
        subtitle={deployed
          ? 'Deployed · answering campaign CTAs and inbound messages'
          : 'Not deployed · configure it here, then put it live'}
        badge={deployed && <Pill>Live</Pill>}>
        {canEdit && <div style={{ display:'flex', gap:10, alignItems:'center', flexWrap:'wrap' }}>
          <Btn variant="outline" onClick={save} disabled={saving}>{saving ? 'Saving…' : 'Save changes'}</Btn>
          <Btn onClick={deploy} disabled={deploying || llmMissing || (planLocked && !deployed)}
            style={deployed ? { background:'rgba(239,68,68,.12)', border:'1px solid rgba(239,68,68,.3)', color:'#f87171', boxShadow:'none' } : { boxShadow:'var(--glow)' }}>
            {deploying ? 'Working…' : deployed ? 'Undeploy agent' : <><I n="play" s={14} c="#08090c"/> Deploy agent</>}
          </Btn>
        </div>}
      </TabHeader>

      {!canEdit && <Banner tone="info">View only — your role can see this agent's settings but not change or deploy them.</Banner>}

      {planLocked && <Banner tone="warn">The Campaign AI Agent is not included in your plan. You can configure it here; upgrade from Payments to deploy it.</Banner>}
      {llmMissing && <Banner tone="warn">No LLM provider is configured on the server. Set <code>GEMINI_API_KEY</code> in the backend environment to enable deployment and live testing.</Banner>}
      {banner && <Banner tone={banner.tone}>{banner.text}</Banner>}

      <div className="agent-grid" style={{ display:'grid', gridTemplateColumns:'190px minmax(0,1fr) 330px', gap:16, alignItems:'start' }}>

        {/* ── section rail + readiness ── */}
        <div style={{ display:'flex', flexDirection:'column', gap:12 }}>
          <div style={{ ...card, padding:8, display:'flex', flexDirection:'column', gap:2 }}>
            {AGENT_SECTIONS.map(sec => {
              const on = sec.id === section;
              return (
                <button key={sec.id} onClick={() => setSection(sec.id)}
                  style={{ display:'flex', alignItems:'center', gap:9, padding:'9px 10px', borderRadius:9, border:'none', cursor:'pointer', textAlign:'left', width:'100%',
                           fontFamily:"'Manrope',sans-serif", fontSize:13, fontWeight: on ? 700 : 500,
                           color: on ? 'var(--t1)' : 'var(--t2)',
                           background: on ? 'rgba(157,107,255,0.12)' : 'transparent',
                           borderLeft: `2px solid ${on ? '#9d6bff' : 'transparent'}` }}>
                  <I n={sec.icon} s={14} c={on ? '#9d6bff' : 'var(--t3)'} />
                  {sec.label}
                </button>
              );
            })}
          </div>

          {readiness && (
            <div style={{ ...card, padding:16 }}>
              <div style={{ fontFamily:'var(--mono)', fontSize:9.5, letterSpacing:'.14em', textTransform:'uppercase', color:'var(--t3)', marginBottom:8 }}>AI readiness</div>
              <div style={{ fontFamily:"'Space Grotesk',sans-serif", fontWeight:800, fontSize:30, color: readiness.score >= 80 ? 'var(--lime)' : readiness.score >= 50 ? 'var(--accent)' : '#fbbf24', letterSpacing:'-.03em', lineHeight:1 }}>
                {readiness.score}%
              </div>
              <div style={{ height:4, borderRadius:4, background:'rgba(255,255,255,0.07)', overflow:'hidden', margin:'10px 0 9px' }}>
                <div style={{ width:`${readiness.score}%`, height:'100%', borderRadius:4, background:'var(--grad-cta)', transition:'width .3s' }} />
              </div>
              <p style={{ fontSize:11.5, color:'var(--t2)', lineHeight:1.5 }}>
                {readiness.nextStep ? readiness.nextStep : 'Everything is configured.'}
              </p>
            </div>
          )}
        </div>

        {/* ── section body ── */}
        <div style={{ ...card, padding:22, minWidth:0 }}>
          <SectionIntro section={active} />
          <fieldset disabled={!canEdit} style={{ border:0, padding:0, margin:0, minWidth:0 }}>

          {section === 'identity' && (
            <div style={{ display:'flex', flexDirection:'column', gap:16 }}>
              <div>
                <label style={labelStyle}>Agent name</label>
                <input value={name} onChange={e => setName(e.target.value)} style={inputStyle} maxLength={80} placeholder="Support Agent" />
              </div>
              <div>
                <label style={labelStyle}>Persona & tone</label>
                <textarea value={systemPrompt} onChange={e => setSystemPrompt(e.target.value)} rows={5} maxLength={4000}
                  style={{ ...inputStyle, resize:'vertical' }}
                  placeholder="Warm, concise and helpful. Speaks like a knowledgeable store associate — never pushy, never robotic." />
              </div>
              <div>
                <label style={labelStyle}>Languages</label>
                <div style={{ display:'flex', flexWrap:'wrap', gap:7 }}>
                  {AGENT_LANGUAGES.map(lang => {
                    const on = languages.includes(lang);
                    return (
                      <button key={lang} type="button" onClick={() => toggleLanguage(lang)}
                        style={{ fontSize:12.5, fontWeight:600, padding:'6px 13px', borderRadius:100, cursor:'pointer', fontFamily:"'Manrope',sans-serif",
                                 background: on ? 'var(--gbg)' : 'rgba(255,255,255,0.03)',
                                 border:`1px solid ${on ? 'var(--gbd)' : 'var(--bd)'}`,
                                 color: on ? 'var(--green)' : 'var(--t2)' }}>{lang}</button>
                    );
                  })}
                </div>
                <p style={{ fontSize:11, color:'var(--t3)', marginTop:8, lineHeight:1.5 }}>
                  The agent replies in the customer’s language. This tells it which ones you actually support.
                </p>
              </div>
            </div>
          )}

          {section === 'purpose' && (
            <div>
              <label style={labelStyle}>What this agent is for</label>
              <textarea value={purpose} onChange={e => setPurpose(e.target.value)} rows={6} maxLength={2000}
                style={{ ...inputStyle, resize:'vertical' }}
                placeholder="Answer questions about live offers and orders for our D2C footwear store, and hand anything about refunds to the support team." />
              <p style={{ fontSize:11.5, color:'var(--t3)', marginTop:8, lineHeight:1.6 }}>
                One or two sentences. This rides along with every reply as standing context, so it is worth being specific
                about the business rather than the tone — tone belongs in Identity.
              </p>
            </div>
          )}

          {section === 'knowledge' && (
            <div style={{ display:'flex', flexDirection:'column', gap:18 }}>
              {/* Structured sources first: they are the ones with a status. */}
              <div>
                <div style={{ display:'flex', alignItems:'center', justifyContent:'space-between', gap:10, marginBottom:10, flexWrap:'wrap' }}>
                  <span style={{ fontFamily:'var(--mono)', fontSize:10, letterSpacing:'.14em', textTransform:'uppercase', color:'var(--t3)' }}>
                    Website widget sources · {sources.length}
                  </span>
                </div>

                {/* The WhatsApp agent's prompt is built from the notes below
                    only; nothing retrieves from these indexed sources yet, so
                    they are labelled for what they actually feed. */}
                <p style={{ fontSize:12, color:'#fbbf24', lineHeight:1.6, marginBottom:12 }}>
                  These sources feed the website widget assistant. The WhatsApp AI agent does not read them yet — put the facts it
                  needs in the notes below, or upload a document there.
                </p>

                <div style={{ display:'flex', flexDirection:'column', gap:8 }}>
                  {sources.map(src => {
                    const tone = SOURCE_STATUS[src.status] || SOURCE_STATUS.PENDING;
                    return (
                      <div key={src.id} style={{ display:'flex', alignItems:'center', gap:11, padding:'11px 13px', borderRadius:10, background:'rgba(255,255,255,0.03)', border:'1px solid var(--bd)' }}>
                        <I n={src.kind === 'url' ? 'globe' : src.kind === 'file' ? 'file' : 'note'} s={15} c="var(--t2)" />
                        <div style={{ flex:1, minWidth:0 }}>
                          <div style={{ fontSize:13, fontWeight:600, color:'var(--t1)', whiteSpace:'nowrap', overflow:'hidden', textOverflow:'ellipsis' }}>{src.title}</div>
                          <div style={{ fontSize:11, color:'var(--t3)', whiteSpace:'nowrap', overflow:'hidden', textOverflow:'ellipsis' }}>
                            {src.error
                              ? src.error
                              : `${(src.chars || 0).toLocaleString()} characters${src.fetchedAt ? ` · read ${new Date(src.fetchedAt).toLocaleDateString('en-IN', { day:'numeric', month:'short' })}` : ''}`}
                          </div>
                        </div>
                        <span style={{ fontFamily:'var(--mono)', fontSize:9, letterSpacing:'.06em', padding:'3px 8px', borderRadius:6, flexShrink:0, background:tone.bg, border:`1px solid ${tone.bd}`, color:tone.fg }}>
                          {tone.label}
                        </span>
                        <button onClick={() => removeSource(src)} aria-label={`Remove ${src.title}`}
                          style={{ width:26, height:26, borderRadius:7, background:'rgba(239,68,68,0.07)', border:'1px solid rgba(239,68,68,0.2)', cursor:'pointer', display:'flex', alignItems:'center', justifyContent:'center', flexShrink:0 }}>
                          <I n="trash" s={11} c="#f87171" />
                        </button>
                      </div>
                    );
                  })}
                </div>

                <div style={{ display:'flex', gap:8, marginTop:12, flexWrap:'wrap' }}>
                  <input value={newSourceUrl} onChange={e => setNewSourceUrl(e.target.value)}
                    onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); addUrlSource(); } }}
                    placeholder="https://yourstore.com/faq" style={{ ...inputStyle, flex:'1 1 220px' }} />
                  <Btn variant="outline" onClick={addUrlSource} disabled={addingSource}>
                    {addingSource ? 'Reading…' : 'Add source'}
                  </Btn>
                </div>
              </div>

              {/* The inline base stays: it is what short, hand-written facts
                  belong in, and it is what the campaign reply path already
                  reads. */}
              <div style={{ borderTop:'1px solid var(--bd)', paddingTop:16 }}>
                <label style={labelStyle}>Notes the agent should always know</label>
                <textarea value={knowledge} onChange={e => setKnowledge(e.target.value)} rows={6} maxLength={12000}
                  style={{ ...inputStyle, resize:'vertical' }}
                  placeholder={"Business hours: Mon-Sat 9am-7pm IST\nReturns: within 7 days with receipt\nShipping: 2-4 business days"} />

                <div style={{ display:'flex', alignItems:'center', justifyContent:'space-between', gap:10, marginTop:7, flexWrap:'wrap' }}>
                  <label style={{ display:'inline-flex', alignItems:'center', gap:7, fontSize:12, color:'var(--t2)', cursor: uploadingDoc ? 'wait' : 'pointer' }}>
                    <span style={{ display:'inline-flex', alignItems:'center', gap:6, padding:'6px 11px', borderRadius:8, border:'1px solid var(--bd)', background:'rgba(255,255,255,0.04)', fontWeight:600 }}>
                      <I n="file" s={12} c="var(--t2)" />
                      {uploadingDoc ? 'Reading…' : 'Upload document'}
                    </span>
                    <input type="file" accept=".pdf,.docx,.txt,.md,.csv" disabled={uploadingDoc}
                      onChange={e => { uploadKnowledgeDoc(e.target.files?.[0]); e.target.value = ''; }}
                      style={{ display:'none' }} />
                  </label>
                  <span style={{ fontSize:11, color: knowledge.length >= 12000 ? '#fbbf24' : 'var(--t3)' }}>
                    {knowledge.length.toLocaleString()} / 12,000
                  </span>
                </div>

                <p style={{ fontSize:11, color:'var(--t3)', marginTop:5, lineHeight:1.5 }}>
                  PDF, Word (.docx) or plain text. The text is extracted and appended to whatever is above — the file itself is not stored.
                </p>

                {uploadNote && (
                  <div style={{ marginTop:8, padding:'8px 11px', borderRadius:8, fontSize:11.5, lineHeight:1.5,
                    background: uploadNote.error ? 'rgba(239,68,68,.08)' : uploadNote.truncated ? 'rgba(245,158,11,.08)' : 'var(--gbg)',
                    border: `1px solid ${uploadNote.error ? 'rgba(239,68,68,.25)' : uploadNote.truncated ? 'rgba(245,158,11,.28)' : 'var(--gbd)'}`,
                    color: uploadNote.error ? '#f87171' : uploadNote.truncated ? '#fbbf24' : 'var(--green)' }}>
                    {uploadNote.error || uploadNote.text}
                  </div>
                )}
              </div>
            </div>
          )}

          {section === 'instructions' && (
            <div>
              <label style={labelStyle}>How the agent should answer</label>
              <textarea value={instructions} onChange={e => setInstructions(e.target.value)} rows={8} maxLength={4000}
                style={{ ...inputStyle, resize:'vertical' }}
                placeholder={"Keep replies to two or three sentences.\nAlways confirm the size before promising stock.\nIf a fact is not in the campaign or the knowledge base, say so and offer a human."} />
              <p style={{ fontSize:11.5, color:'var(--t3)', marginTop:8, lineHeight:1.6 }}>
                One instruction per line reads best. These are appended to the persona, so they win where the two disagree.
              </p>
            </div>
          )}

          {section === 'campaign' && (
            <div style={{ display:'flex', flexDirection:'column', gap:14 }}>
              <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center', gap:12, flexWrap:'wrap' }}>
                <p style={{ fontSize:13, color:'var(--t2)' }}>
                  {usage === null ? 'Checking campaigns…'
                    : usage.total === 0 ? 'No campaign uses this agent yet — turn it on in the AI Agent step of the campaign wizard.'
                    : `Attached to ${usage.total} campaign${usage.total === 1 ? '' : 's'}.`}
                </p>
                <Btn variant="outline" size="sm" onClick={loadUsage}>Refresh</Btn>
              </div>

              {usage?.campaigns?.length > 0 && (
                <div style={{ border:'1px solid var(--bd)', borderRadius:10, overflow:'hidden' }}>
                  {usage.campaigns.map((c, i) => (
                    <div key={c.id} style={{ padding:'12px 14px', borderBottom: i < usage.campaigns.length - 1 ? '1px solid var(--bd)' : 'none', display:'flex', alignItems:'center', gap:12, flexWrap:'wrap' }}>
                      <div style={{ flex:1, minWidth:180 }}>
                        <p style={{ fontSize:13, fontWeight:600, color:'var(--t1)' }}>{c.name}</p>
                        <p style={{ fontSize:11.5, color:'var(--t3)', marginTop:2 }}>
                          CTA “{c.aiAgentCtaLabel || 'Ask Anything'}”
                          {c.totalContacts ? ` · ${c.totalContacts} recipient${c.totalContacts === 1 ? '' : 's'}` : ''}
                        </p>
                      </div>
                      {c.activeSessions > 0 && (
                        <span style={{ fontSize:11, fontWeight:600, color:'var(--green)' }}>
                          {c.activeSessions} chat{c.activeSessions === 1 ? '' : 's'} live
                        </span>
                      )}
                      <span style={{ fontSize:11, fontWeight:700, padding:'3px 10px', borderRadius:20, textTransform:'capitalize',
                        color: CAMPAIGN_TONE[c.status]?.fg || 'var(--t2)',
                        background: CAMPAIGN_TONE[c.status]?.bg || 'rgba(255,255,255,0.05)',
                        border: `1px solid ${CAMPAIGN_TONE[c.status]?.bd || 'var(--bd)'}` }}>
                        {CAMPAIGN_TONE[c.status]?.label || c.status}
                      </span>
                    </div>
                  ))}
                </div>
              )}

              <div style={{ padding:'11px 14px', background:'rgba(255,255,255,0.03)', border:'1px solid var(--bd)', borderRadius:8, fontSize:11.5, color:'var(--t3)', lineHeight:1.6 }}>
                Reply order on inbound messages: <strong style={{ color:'var(--t2)' }}>active campaign AI chat</strong> → form in progress → workflow → keyword trigger → intent match → escalation rules → welcome/out-of-office → <strong style={{ color:'var(--t2)' }}>this agent</strong>.
              </div>
            </div>
          )}

          {section === 'escalation' && (
            <div style={{ display:'flex', flexDirection:'column', gap:20 }}>
              {/* A confidence-threshold slider used to sit here. The agent
                  produces no confidence score, so the stored threshold was
                  never read; only the rules below decide a handoff. */}
              <p style={{ fontSize:12, color:'var(--t2)', lineHeight:1.6 }}>
                While the agent is deployed, a message that matches a rule switched on below — and that no workflow, keyword
                trigger or intent rule answered — is handed to a human in the shared inbox. Automation on that chat pauses until a
                person replies, and resumes by itself once nobody has replied there for 24 hours (HANDOFF_TTL_HOURS).
              </p>

              <div>
                <div style={{ fontFamily:'var(--mono)', fontSize:10, letterSpacing:'.14em', textTransform:'uppercase', color:'var(--t3)', marginBottom:10 }}>Always escalate on</div>
                <div style={{ display:'flex', flexDirection:'column', gap:8 }}>
                  {ESCALATION_RULES.map(rule => (
                    <div key={rule.id} style={{ display:'flex', alignItems:'center', gap:12, padding:'11px 13px', borderRadius:10, background:'rgba(255,255,255,0.03)', border:'1px solid var(--bd)' }}>
                      <div style={{ flex:1, minWidth:0 }}>
                        <div style={{ fontSize:13, fontWeight:600, color:'var(--t1)' }}>{rule.label}</div>
                        <div style={{ fontSize:11, color:'var(--t3)', marginTop:2 }}>{rule.hint}</div>
                      </div>
                      <Toggle on={escRules[rule.id] === true} disabled={!canEdit} onToggle={() => { setEscRulesTouched(true); setEscRules(r => ({ ...r, [rule.id]: !r[rule.id] })); }} />
                    </div>
                  ))}
                </div>
              </div>
            </div>
          )}

          {section === 'safety' && (
            <div style={{ display:'flex', flexDirection:'column', gap:16 }}>
              <div style={{ display:'flex', gap:12, alignItems:'flex-start', padding:'14px 16px', borderRadius:10, background:'var(--gbg)', border:'1px solid var(--gbd)' }}>
                <I n="shield" s={17} c="var(--green)" />
                <p style={{ fontSize:12.5, color:'var(--t2)', lineHeight:1.6 }}>
                  Always on: the agent is instructed never to state a discount, price or date that is not in the campaign or a
                  connected source. Asked something neither covers, it says so and offers a human rather than filling the gap.
                </p>
              </div>
              <div>
                <label style={labelStyle}>Your own guardrails</label>
                <textarea value={safetyNote} onChange={e => setSafetyNote(e.target.value)} rows={6} maxLength={2000}
                  style={{ ...inputStyle, resize:'vertical' }}
                  placeholder={"Never promise a delivery date for a made-to-order item.\nNever quote a competitor.\nNever ask for card details in chat."} />
              </div>
            </div>
          )}

          {section === 'performance' && (
            <div style={{ display:'flex', flexDirection:'column', gap:10 }}>
              {!readiness && <p style={{ fontSize:13, color:'var(--t3)' }}>Loading…</p>}
              {readiness?.checks?.map(check => (
                <div key={check.id} style={{ display:'flex', alignItems:'center', gap:12, padding:'12px 14px', borderRadius:10,
                  background: check.done ? 'var(--sbg)' : 'rgba(255,255,255,0.03)',
                  border: `1px solid ${check.done ? 'var(--sbd)' : 'var(--bd)'}` }}>
                  <I n={check.done ? 'checkc' : 'alertc'} s={16} c={check.done ? 'var(--success)' : 'var(--t3)'} />
                  <span style={{ flex:1, fontSize:13, color: check.done ? 'var(--t1)' : 'var(--t2)' }}>{check.label}</span>
                  <span style={{ fontFamily:'var(--mono)', fontSize:11, color:'var(--t3)', flexShrink:0 }}>{check.weight} pts</span>
                </div>
              ))}
            </div>
          )}
          </fieldset>
        </div>

        {/* ── Test Lab ── */}
        <div style={{ ...card, padding:18, display:'flex', flexDirection:'column', gap:12, minWidth:0 }}>
          <div style={{ display:'flex', alignItems:'center', gap:8, flexWrap:'wrap' }}>
            <span style={{ fontFamily:'var(--mono)', fontSize:10, letterSpacing:'.14em', textTransform:'uppercase', color:'var(--t1)' }}>Test lab</span>
            <span style={{ fontFamily:'var(--mono)', fontSize:9, letterSpacing:'.06em', padding:'2px 7px', borderRadius:5, background:'rgba(255,255,255,0.04)', border:'1px solid var(--bd)', color:'var(--t3)' }}>
              not live · sandbox
            </span>
          </div>
          <p style={{ fontSize:12, color:'var(--t2)', lineHeight:1.55 }}>
            Ask what a customer would ask. Every answer shows the sources it was given and how much of it traces back to them.
          </p>

          <div style={{ display:'flex', gap:6, flexWrap:'wrap' }}>
            {[['general', 'General'], ['campaign', 'Campaign context']].map(([id, label]) => {
              const on = testMode === id;
              return (
                <button key={id} onClick={() => { setTestMode(id); setThread([]); }}
                  style={{ fontSize:12, fontWeight:600, padding:'6px 12px', borderRadius:100, cursor:'pointer', fontFamily:"'Manrope',sans-serif",
                           background: on ? 'var(--gbg)' : 'rgba(255,255,255,0.03)',
                           border:`1px solid ${on ? 'var(--gbd)' : 'var(--bd)'}`,
                           color: on ? 'var(--green)' : 'var(--t2)' }}>{label}</button>
              );
            })}
          </div>

          {testMode === 'campaign' && (
            <select value={testCampaignId} onChange={e => { setTestCampaignId(e.target.value); setThread([]); }} style={inputStyle}>
              <option value="">— Select a campaign —</option>
              {campaigns.map(c => (
                <option key={c.id} value={c.id}>{c.name}{c.aiAgentEnabled ? ' · agent attached' : ''}</option>
              ))}
            </select>
          )}

          <div style={{ display:'flex', flexDirection:'column', gap:10, maxHeight:340, overflowY:'auto', padding:'2px 0' }}>
            {thread.length === 0 && (
              <p style={{ fontSize:12, color:'var(--t3)', lineHeight:1.6 }}>
                Nothing tested yet. Answers appear here with their sources.
              </p>
            )}
            {thread.map((m, i) => {
              if (m.role === 'customer') {
                return (
                  <div key={i} style={{ alignSelf:'flex-end', maxWidth:'88%', borderRadius:'13px 4px 13px 13px', background:'rgba(53,232,242,0.14)', border:'1px solid var(--gbd)', padding:'8px 11px' }}>
                    <p style={{ fontSize:12.5, color:'var(--t1)', lineHeight:1.5 }}>{m.text}</p>
                  </div>
                );
              }
              if (m.role === 'error') {
                return (
                  <div key={i} style={{ borderRadius:9, background:'rgba(239,68,68,.06)', border:'1px solid rgba(239,68,68,.25)', padding:'9px 12px' }}>
                    <p style={{ fontSize:12, color:'#f87171', lineHeight:1.5 }}>{m.text}</p>
                  </div>
                );
              }
              const pct = m.grounding == null ? null : Math.round(m.grounding * 100);
              return (
                <div key={i} style={{ alignSelf:'flex-start', maxWidth:'96%', minWidth:0 }}>
                  {m.sources?.length > 0 && (
                    <div style={{ display:'flex', flexWrap:'wrap', gap:5, marginBottom:6 }}>
                      {m.sources.map(src => (
                        <span key={src.kind} style={{ fontFamily:'var(--mono)', fontSize:8.5, letterSpacing:'.06em', textTransform:'uppercase', padding:'2px 7px', borderRadius:5,
                          background: src.kind === 'campaign' ? 'rgba(53,232,242,0.12)' : src.kind === 'knowledge' ? 'rgba(196,255,70,0.12)' : 'rgba(157,107,255,0.12)',
                          border: `1px solid ${src.kind === 'campaign' ? 'var(--gbd)' : src.kind === 'knowledge' ? 'rgba(196,255,70,0.3)' : 'rgba(157,107,255,0.3)'}`,
                          color: src.kind === 'campaign' ? 'var(--cyan)' : src.kind === 'knowledge' ? 'var(--lime)' : 'var(--violet)' }}>
                          {src.label}
                        </span>
                      ))}
                    </div>
                  )}
                  <div style={{ borderRadius:'4px 13px 13px 13px', background:'rgba(255,255,255,0.045)', border:'1px solid var(--bd)', padding:'10px 12px' }}>
                    <p style={{ fontSize:12.5, color:'var(--t1)', lineHeight:1.55, whiteSpace:'pre-wrap' }}>{m.text}</p>
                  </div>
                  {pct != null && (
                    <div style={{ display:'flex', alignItems:'center', gap:8, marginTop:7 }}
                      title="Share of the answer's distinctive words that appear in the sources the agent was given. Low means the model supplied it from its own knowledge rather than yours.">
                      <span style={{ fontFamily:'var(--mono)', fontSize:8.5, letterSpacing:'.1em', color:'var(--t3)', textTransform:'uppercase' }}>Grounding</span>
                      <span style={{ flex:1, height:4, borderRadius:4, background:'rgba(255,255,255,0.07)', overflow:'hidden' }}>
                        <span style={{ display:'block', width:`${pct}%`, height:'100%', borderRadius:4, background: pct >= 60 ? 'var(--lime)' : pct >= 30 ? '#fbbf24' : '#f87171' }} />
                      </span>
                      <span style={{ fontFamily:'var(--mono)', fontSize:10, color: pct >= 60 ? 'var(--lime)' : pct >= 30 ? '#fbbf24' : '#f87171' }}>{pct}%</span>
                    </div>
                  )}
                  {m.context && (
                    <details style={{ fontSize:11, color:'var(--t3)', marginTop:7 }}>
                      <summary style={{ cursor:'pointer', color:'var(--t2)' }}>Campaign content the agent was given</summary>
                      <pre style={{ marginTop:7, whiteSpace:'pre-wrap', fontFamily:"'Manrope',sans-serif", lineHeight:1.55 }}>
                        {[m.context.header, m.context.body, m.context.footer].filter(Boolean).join('\n\n') || '(no text content)'}
                      </pre>
                    </details>
                  )}
                </div>
              );
            })}
          </div>

          <div style={{ marginTop:'auto', display:'flex', gap:8 }}>
            <input value={testMsg} onChange={e => setTestMsg(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); runTest(); } }}
              placeholder="Ask a test question…" style={{ ...inputStyle, flex:1 }} />
            <Btn variant="outline" onClick={runTest} disabled={testing || llmMissing || !canTest}>{testing ? '…' : 'Test'}</Btn>
          </div>

          <div style={{ display:'flex', flexWrap:'wrap', gap:5, paddingTop:4, borderTop:'1px solid var(--bd)' }}>
            <span style={{ fontFamily:'var(--mono)', fontSize:8.5, letterSpacing:'.1em', color:'var(--t3)', textTransform:'uppercase', marginRight:4, paddingTop:5 }}>Legend</span>
            {[['Campaign context', 'var(--cyan)'], ['Knowledge base', 'var(--lime)'], ['Persona & profile', 'var(--violet)']].map(([label, colour]) => (
              <span key={label} style={{ fontFamily:'var(--mono)', fontSize:8.5, letterSpacing:'.06em', textTransform:'uppercase', padding:'2px 7px', borderRadius:5, marginTop:3, color:colour, border:`1px solid ${colour}`, opacity:.75 }}>
                {label}
              </span>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
};

export default WhatsAppAgentPanel;
