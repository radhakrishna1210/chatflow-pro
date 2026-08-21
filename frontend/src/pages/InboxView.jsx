import { useState, useEffect, useRef, useCallback } from 'react';
import { I } from '../components/Icons.jsx';
import { Btn } from '../components/Btn.jsx';
import { wFetch } from '../lib/api.js';
import ContactDetailsPanel from '../components/ContactDetailsPanel.jsx';
import { useIsMobile } from '../lib/useMediaQuery.js';
import MobileNavButton from '../components/MobileNavButton.jsx';

const labelCfg = {
  urgent:   { bg:'rgba(239,68,68,.08)',   bd:'rgba(239,68,68,.22)',   c:'#f87171' },
  resolved: { bg:'var(--gbg)',            bd:'var(--gbd)',            c:'var(--green)' },
  billing:  { bg:'rgba(245,158,11,.08)', bd:'rgba(245,158,11,.22)', c:'#fbbf24' },
};

const Avatar = ({ name='?', size=36 }) => {
  const init = name.split(' ').map(n=>n[0]).join('').slice(0,2).toUpperCase();
  const colors = ['#35e8f2','#9d6bff','#c4ff46','#F59E0B','#F472B6'];
  const c = colors[init.charCodeAt(0) % colors.length];
  return (
    <div style={{ width:size, height:size, borderRadius:'50%', background:`${c}18`, border:`1.5px solid ${c}44`, display:'flex', alignItems:'center', justifyContent:'center', fontSize:size*.33+'px', fontWeight:700, color:c, flexShrink:0 }}>
      {init}
    </div>
  );
};

const LabelBadge = ({ label }) => {
  if (!label) return null;
  const v = labelCfg[label] || {};
  return <span style={{ padding:'2px 7px', borderRadius:10, fontSize:10, fontWeight:700, background:v.bg, border:`1px solid ${v.bd}`, color:v.c }}>{label}</span>;
};

const fmtTime = (iso) => {
  if (!iso) return '';
  const d = new Date(iso);
  if (isNaN(d.getTime())) return iso;
  const now = new Date();
  const sameDay = d.toDateString() === now.toDateString();
  if (sameDay) return d.toLocaleTimeString([], { hour:'2-digit', minute:'2-digit' });
  const diffDays = Math.floor((now - d) / 86400000);
  if (diffDays === 1) return 'Yesterday';
  if (diffDays < 7) return d.toLocaleDateString([], { weekday:'short' });
  return d.toLocaleDateString([], { month:'short', day:'numeric' });
};

// ─── Thread context ──────────────────────────────────────────────────────────
//
// Where this conversation came from, what the agent did with it, and what has
// happened to this customer over time. It sits above the contact record, since
// the question it answers — "what am I walking into?" — is the one an agent has
// before they read the thread.
//
// Every row is a stored fact with a timestamp behind it; there is nothing here
// the server inferred.

const CTX_SECTION = { padding: '14px 16px', borderBottom: '1px solid var(--bd)' };
const CTX_LABEL = { fontFamily: 'var(--mono)', fontSize: 9, letterSpacing: '.14em', textTransform: 'uppercase', color: 'var(--t3)', marginBottom: 9 };

const TIMELINE_COLOUR = {
  contact: 'var(--t3)',
  campaign: 'var(--wa-green)',
  ai: 'var(--accent)',
  inbound: '#9d6bff',
  human: '#c4ff46',
  status: 'var(--t3)',
};

const ThreadContext = ({ context, onHandBackToAI, busy }) => {
  if (!context) return null;
  const { campaignSource, aiSession, messages, timeline, conversation } = context;

  return (
    <div style={{ borderBottom: '1px solid var(--bd)' }}>
      {campaignSource && (
        <div style={CTX_SECTION}>
          <div style={CTX_LABEL}>Campaign source</div>
          <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--t1)', marginBottom: 4 }}>{campaignSource.name}</div>
          <div style={{ fontSize: 11.5, color: 'var(--t3)', lineHeight: 1.6 }}>
            {campaignSource.sentAt && `Sent ${new Date(campaignSource.sentAt).toLocaleString('en-IN', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}`}
            {campaignSource.readAt && ` · read ${new Date(campaignSource.readAt).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' })}`}
          </div>
        </div>
      )}

      {aiSession && (
        <div style={CTX_SECTION}>
          <div style={CTX_LABEL}>AI session</div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 7 }}>
            {[
              ['Handled by AI', `${messages.byAgent} ${messages.byAgent === 1 ? 'reply' : 'replies'}`, 'var(--accent)'],
              ['Exchanges', `${aiSession.turns}`, 'var(--t1)'],
              ['Session', aiSession.status === 'ACTIVE' ? 'Open' : aiSession.status === 'EXPIRED' ? 'Expired' : 'Ended',
                aiSession.status === 'ACTIVE' ? 'var(--success)' : 'var(--t2)'],
              ...(aiSession.handedOver ? [['Handed over', 'to a teammate', '#c4ff46']] : []),
            ].map(([k, v, colour]) => (
              <div key={k} style={{ display: 'flex', justifyContent: 'space-between', gap: 10, fontSize: 12 }}>
                <span style={{ color: 'var(--t2)' }}>{k}</span>
                <span style={{ color: colour, fontWeight: 600, fontFamily: 'var(--mono)', fontSize: 11.5 }}>{v}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {timeline?.length > 0 && (
        <div style={CTX_SECTION}>
          <div style={CTX_LABEL}>Customer timeline</div>
          <div style={{ display: 'flex', flexDirection: 'column' }}>
            {timeline.slice(-7).map((event, i, arr) => (
              <div key={`${event.at}-${i}`} style={{ display: 'flex', gap: 10 }}>
                <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', flexShrink: 0 }}>
                  <span style={{ width: 7, height: 7, borderRadius: '50%', background: TIMELINE_COLOUR[event.kind] || 'var(--t3)', marginTop: 4 }} />
                  {i < arr.length - 1 && <span style={{ width: 1, flex: 1, background: 'var(--bd)', minHeight: 16 }} />}
                </div>
                <div style={{ paddingBottom: i < arr.length - 1 ? 12 : 0, minWidth: 0 }}>
                  <div style={{ fontSize: 12.5, color: 'var(--t1)', lineHeight: 1.4 }}>{event.text}</div>
                  <div style={{ fontSize: 10.5, color: 'var(--t3)', marginTop: 2 }}>
                    {new Date(event.at).toLocaleString('en-IN', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {conversation?.assignedTo && (
        <div style={{ ...CTX_SECTION, borderBottom: 'none' }}>
          <button onClick={onHandBackToAI} disabled={busy}
            style={{ width: '100%', padding: '9px 12px', borderRadius: 9, cursor: busy ? 'wait' : 'pointer',
                     background: 'var(--gbg)', border: '1px solid var(--gbd)', color: 'var(--green)',
                     fontSize: 12.5, fontWeight: 600, fontFamily: "'Manrope',sans-serif" }}>
            Hand back to AI
          </button>
          <p style={{ fontSize: 10.5, color: 'var(--t3)', marginTop: 7, lineHeight: 1.5 }}>
            Unassigns the thread. The agent answers again on the next inbound message.
          </p>
        </div>
      )}
    </div>
  );
};


// Message types that are not plain text get a small label in the bubble, so a
// photo or a voice note reads as one rather than as a bare placeholder string.
// Names must exist in components/Icons.jsx — an unknown name renders nothing,
// which would leave the label with no glyph beside it.
const MEDIA_ICON = {
  IMAGE: 'eye', VIDEO: 'play', AUDIO: 'phone', DOCUMENT: 'file',
  STICKER: 'sparkl', LOCATION: 'globe', CONTACTS: 'user', UNSUPPORTED: 'alertt',
};

// Delivery state for an outbound message, mirrored from Meta's status webhook.
// Nothing showed this before: statuses were applied only to campaign sends, so
// an inbox reply never reported whether it had arrived.
const DeliveryTick = ({ status, error }) => {
  const spec = {
    PENDING:   { glyph: '·',  color: 'var(--t3)',  label: 'Sending' },
    SENT:      { glyph: '✓',  color: 'var(--t3)',  label: 'Sent' },
    DELIVERED: { glyph: '✓✓', color: 'var(--t2)', label: 'Delivered' },
    READ:      { glyph: '✓✓', color: 'var(--green)', label: 'Read' },
    FAILED:    { glyph: '!',        color: '#f87171',    label: 'Failed' },
  }[status];
  if (!spec) return null;
  return (
    <span title={error || spec.label}
      style={{ fontSize: 10, lineHeight: 1, color: spec.color, fontWeight: 700, letterSpacing: '-1px' }}>
      {spec.glyph}
    </span>
  );
};

export default function InboxView() {
  const [convs, setConvs]       = useState([]);
  const [msgs, setMsgs]         = useState({});
  // WhatsApp's 24-hour customer service window, per conversation, as reported
  // by the server. Outside it only an approved template may be sent, so the
  // composer has to say so instead of letting the send fail at Meta.
  const [windowState, setWindowState] = useState({});
  const [activeId, setActiveId] = useState(null);
  const [isBot, setIsBot]       = useState(false);
  const [input, setInput]       = useState('');
  const [tab, setTab]           = useState('chat');
  const [search, setSearch]     = useState('');
  const [sending, setSending]   = useState(false);
  const [sendError, setSendError] = useState(null);
  const scrollRef = useRef(null);
  // The details panel follows the selected conversation. On a narrow viewport
  // there is no room for a third column, so it becomes an overlay drawer that
  // opens on demand instead of permanently eating the chat width.
  const [detailsOpen, setDetailsOpen] = useState(true);
  const [narrow, setNarrow] = useState(() => window.matchMedia('(max-width: 1100px)').matches);
  // Four fixed columns (nav 232 + list 320 + thread context 300 + details 300)
  // leave the conversation itself whatever is left, which below ~1400px is not
  // enough to read a chat in — the header controls collided with the contact's
  // name long before the column got that narrow. Above this width all four fit;
  // below it the thread context rides inside the details panel instead of
  // claiming a column of its own, and nothing is lost.
  const [wide, setWide] = useState(() => window.matchMedia('(min-width: 1400px)').matches);
  // Below the shell's mobile breakpoint the inbox stops being three columns
  // and becomes two screens: the conversation list, and the conversation. Which
  // one is showing is `activeId` — selecting pushes into the thread, the back
  // arrow pops out of it — so the phone layout is the same state the desktop
  // layout already had, shown one pane at a time.
  const mobile = useIsMobile();
  // The conversation poll auto-opens the first thread so the desktop layout is
  // never a half-empty two-pane screen. On a phone that would make the back
  // arrow useless — pop out of a thread, and five seconds later the poll drops
  // you back into it. A ref rather than a dep so the poll is not torn down and
  // restarted every time the viewport crosses the breakpoint.
  const mobileRef = useRef(mobile);
  useEffect(() => { mobileRef.current = mobile; }, [mobile]);

  // Who is looking, so the "Mine" filter has something to compare against.
  const me = (() => { try { return JSON.parse(localStorage.getItem('user') || 'null'); } catch { return null; } })();

  const [filter, setFilter] = useState('All');
  const [context, setContext] = useState(null);
  const [suggestions, setSuggestions] = useState([]);
  const [suggestNote, setSuggestNote] = useState(null);
  const [suggesting, setSuggesting] = useState(false);
  const [notes, setNotes] = useState([]);
  const [noteDraft, setNoteDraft] = useState('');
  const [savingNote, setSavingNote] = useState(false);
  const [members, setMembers] = useState([]);
  const [busyAction, setBusyAction] = useState(false);

  useEffect(() => {
    const mq = window.matchMedia('(max-width: 1100px)');
    const onChange = (e) => {
      setNarrow(e.matches);
      // Coming from wide, an open panel would cover the conversation the user
      // was just reading; going back to wide, restore the docked column.
      setDetailsOpen(!e.matches);
    };
    setDetailsOpen(!mq.matches);
    mq.addEventListener('change', onChange);
    return () => mq.removeEventListener('change', onChange);
  }, []);

  useEffect(() => {
    const mq = window.matchMedia('(min-width: 1400px)');
    const onChange = (e) => setWide(e.matches);
    setWide(mq.matches);
    mq.addEventListener('change', onChange);
    return () => mq.removeEventListener('change', onChange);
  }, []);

  // initial + polling fetch of conversation list
  useEffect(() => {
    let stopped = false;
    const loadConvs = () =>
      wFetch('/conversations')
        .then(r => r.ok && r.json())
        .then(d => {
          if (stopped) return;
          const list = d?.data ?? d;
          if (Array.isArray(list)) {
            setConvs(list);
            setActiveId(prev => prev ?? (mobileRef.current ? null : (list[0]?.id ?? null)));
          }
        })
        .catch(() => {});
    loadConvs();
    const interval = setInterval(loadConvs, 5000);
    return () => { stopped = true; clearInterval(interval); };
  }, []);

  // initial + polling fetch of active conversation messages
  useEffect(() => {
    if (!activeId) return;
    let stopped = false;
    const loadMsgs = () =>
      wFetch(`/conversations/${activeId}/messages`)
        .then(r => r.ok && r.json())
        .then(d => {
          if (stopped || !d) return;
          // The endpoint now returns { messages, window } so the composer knows
          // whether WhatsApp still permits a free-form reply. The array form is
          // still accepted so a stale cached bundle keeps working.
          const list = Array.isArray(d) ? d : d.messages;
          if (Array.isArray(list)) setMsgs(p => ({ ...p, [activeId]: list }));
          if (!Array.isArray(d) && d.window) setWindowState(p => ({ ...p, [activeId]: d.window }));
        })
        .catch(() => {});
    loadMsgs();
    const interval = setInterval(loadMsgs, 4000);
    return () => { stopped = true; clearInterval(interval); };
  }, [activeId]);

  useEffect(() => {
    if (scrollRef.current) scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
  }, [activeId, msgs]);

  // Everything the side panel and the header need about the selected thread.
  // Refetched on selection rather than polled: none of it changes between
  // messages, and the message poll already covers what does.
  const loadContext = useCallback((id) => {
    if (!id) { setContext(null); return; }
    wFetch(`/conversations/${id}/context`)
      .then(r => (r.ok ? r.json() : null))
      .then(d => setContext(d))
      .catch(() => setContext(null));
  }, []);

  const loadNotes = useCallback((id) => {
    if (!id) { setNotes([]); return; }
    wFetch(`/conversations/${id}/notes`)
      .then(r => (r.ok ? r.json() : []))
      .then(d => setNotes(Array.isArray(d) ? d : []))
      .catch(() => setNotes([]));
  }, []);

  useEffect(() => {
    setSuggestions([]);
    setSuggestNote(null);
    loadContext(activeId);
    loadNotes(activeId);
  }, [activeId, loadContext, loadNotes]);

  useEffect(() => {
    wFetch('/members')
      .then(r => (r.ok ? r.json() : []))
      .then(d => setMembers(Array.isArray(d) ? d : (d?.data || [])))
      .catch(() => {});
  }, []);

  const askForSuggestion = async () => {
    if (!activeId || suggesting) return;
    setSuggesting(true); setSuggestNote(null);
    try {
      const res = await wFetch(`/conversations/${activeId}/suggest`, { method: 'POST' });
      const d = await res.json().catch(() => ({}));
      if (!res.ok) { setSuggestNote(d.error || 'Could not draft a reply'); return; }
      setSuggestions(d.suggestions || []);
      if (!d.suggestions?.length) setSuggestNote(d.reason || 'Nothing to suggest yet.');
    } catch (e) {
      setSuggestNote(e.message);
    } finally {
      setSuggesting(false);
    }
  };

  const assignTo = async (userId) => {
    if (!activeId) return;
    setBusyAction(true);
    const res = await wFetch(`/conversations/${activeId}/assign`, {
      method: 'PATCH', body: JSON.stringify({ assignedToUserId: userId || null }),
    }).catch(() => null);
    setBusyAction(false);
    if (res?.ok) {
      const updated = await res.json().catch(() => null);
      setConvs(list => list.map(c => (c.id === activeId
        ? { ...c, assignedToUserId: updated?.assignedToUserId ?? null, assignedTo: updated?.assignedTo ?? null }
        : c)));
      loadContext(activeId);
    }
  };

  const setStatus = async (status) => {
    if (!activeId) return;
    setBusyAction(true);
    const res = await wFetch(`/conversations/${activeId}/status`, {
      method: 'PATCH', body: JSON.stringify({ status }),
    }).catch(() => null);
    setBusyAction(false);
    if (res?.ok) {
      setConvs(list => list.map(c => (c.id === activeId ? { ...c, status } : c)));
      loadContext(activeId);
    }
  };

  const addNote = async () => {
    const body = noteDraft.trim();
    if (!body || savingNote) return;
    setSavingNote(true);
    const res = await wFetch(`/conversations/${activeId}/notes`, {
      method: 'POST', body: JSON.stringify({ body }),
    }).catch(() => null);
    setSavingNote(false);
    if (res?.ok) { setNoteDraft(''); loadNotes(activeId); }
  };

  const send = async () => {
    if (!input.trim() || !activeId || sending) return;
    const body = input.trim();
    setInput(''); setSendError(null); setSending(true);
    const temp = { id:`tmp${Date.now()}`, body, direction:'OUTBOUND', sentAt:new Date().toISOString(), senderUser:{ name: isBot ? 'AI' : 'You' }, _pending: true };
    setMsgs(p => ({ ...p, [activeId]: [...(p[activeId] || []), temp] }));
    try {
      const res = await wFetch(`/conversations/${activeId}/messages`, {
        method:'POST', body: JSON.stringify({ type:'TEXT', body }),
      });
      const data = await res.json();
      if (!res.ok) {
        setSendError(data.error || `Send failed (${res.status})`);
        // remove the optimistic message
        setMsgs(p => ({ ...p, [activeId]: (p[activeId] || []).filter(m => m.id !== temp.id) }));
        return;
      }
      // replace temp with real
      setMsgs(p => ({ ...p, [activeId]: (p[activeId] || []).map(m => m.id === temp.id ? data : m) }));
    } catch (e) {
      setSendError(e.message);
      setMsgs(p => ({ ...p, [activeId]: (p[activeId] || []).filter(m => m.id !== temp.id) }));
    } finally {
      setSending(false);
    }
  };

  // What "handled by AI" means here is the only thing the data actually
  // records: the last outbound message had no human sender.
  const lastOutbound = (c) => (c.messages || []).find(m => (m.direction || '').toUpperCase() === 'OUTBOUND');
  const matchesFilter = (c) => {
    if (filter === 'Unassigned') return !c.assignedToUserId;
    if (filter === 'Mine') return !!me?.id && c.assignedToUserId === me.id;
    if (filter === 'AI-handled') {
      const out = lastOutbound(c);
      return (c.aiSessions?.length > 0) || (!!out && out.senderUserId == null);
    }
    return true;
  };

  const filtered = convs.filter(matchesFilter).filter(c =>
    !search ||
    c.contact?.name?.toLowerCase().includes(search.toLowerCase()) ||
    c.contact?.phoneNumber?.includes(search)
  );
  const active = convs.find(c => c.id === activeId);
  const activeMsgs = msgs[activeId] || [];
  const activeWindow = windowState[activeId] || null;

  return (
    <div style={{ display:'flex', flexDirection:'column', flex:1, overflow:'hidden' }}>
      <div className="dash-page-head" style={{ height:58, borderBottom:'1px solid var(--bd)', display:'flex', alignItems:'center', padding:'0 28px', flexShrink:0, background:'var(--surf)' }}>
        <MobileNavButton />
        <h1 style={{ fontFamily:"'Space Grotesk',sans-serif", fontWeight:800, fontSize:16, color:'var(--t1)', letterSpacing:'-.02em' }}>Inbox</h1>
        <p style={{ fontSize:11.5, color:'var(--t2)', marginLeft:10 }}>Manage customer conversations</p>
      </div>

      <div style={{ display:'flex', flex:1, overflow:'hidden' }}>
        {/* ── left panel ── */}
        <div style={{ width: mobile ? '100%' : 320, display: mobile && activeId ? 'none' : 'flex', borderRight: mobile ? 'none' : '1px solid var(--bd)', flexDirection:'column', flexShrink:0, background:'var(--surf)' }}>
          <div style={{ padding:'10px 12px', borderBottom:'1px solid var(--bd)' }}>
            <div style={{ display:'flex', alignItems:'center', gap:8, padding:'8px 12px', borderRadius:8, background:'rgba(255,255,255,0.03)', border:'1px solid var(--bd)' }}>
              <I n="search" s={13} c="var(--t2)" />
              <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Search conversations…"
                style={{ flex:1, background:'none', border:'none', outline:'none', color:'var(--t1)', fontSize:13, fontFamily:"'Manrope',sans-serif" }} />
            </div>

            {/* Four views of the same list. Counts are live, so an empty
                filter is obvious before you switch to it. */}
            <div style={{ display:'flex', gap:6, marginTop:9, overflowX:'auto', paddingBottom:2 }}>
              {['All', 'Unassigned', 'AI-handled', 'Mine'].map(f => {
                const on = filter === f;
                return (
                  <button key={f} onClick={() => setFilter(f)}
                    style={{ fontSize:12, fontWeight:600, whiteSpace:'nowrap', padding:'5px 11px', borderRadius:100, cursor:'pointer',
                             fontFamily:"'Manrope',sans-serif",
                             background: on ? 'var(--gbg)' : 'rgba(255,255,255,0.03)',
                             border:`1px solid ${on ? 'var(--gbd)' : 'var(--bd)'}`,
                             color: on ? 'var(--green)' : 'var(--t2)' }}>
                    {f}
                  </button>
                );
              })}
            </div>
          </div>
          <div style={{ flex:1, overflowY:'auto' }}>
            {filtered.length === 0 && (
              <div style={{ padding:'30px 18px', textAlign:'center', color:'var(--t3)', fontSize:12, lineHeight:1.6 }}>
                {convs.length === 0
                  ? <>No conversations yet.<br/><span style={{ color:'var(--t2)', fontSize:11 }}>When someone messages your WhatsApp number, it'll appear here.</span></>
                  : 'No conversations match your search.'}
              </div>
            )}
            {filtered.map(c => {
              const on = activeId === c.id;
              const lastMsg = (msgs[c.id] || []).slice(-1)[0];
              return (
                <div key={c.id} onClick={() => setActiveId(c.id)}
                  style={{ padding:'12px 14px', borderBottom:'1px solid var(--bd)', cursor:'pointer', transition:'background .12s', borderLeft:`2px solid ${on ? 'var(--green)' : 'transparent'}`, background: on ? 'rgba(53,232,242,0.06)' : 'transparent' }}
                  onMouseEnter={e => { if (!on) e.currentTarget.style.background = 'rgba(255,255,255,0.02)'; }}
                  onMouseLeave={e => { if (!on) e.currentTarget.style.background = 'transparent'; }}>
                  <div style={{ display:'flex', gap:10 }}>
                    <Avatar name={c.contact.name} size={36} />
                    <div style={{ flex:1, minWidth:0 }}>
                      <div style={{ display:'flex', justifyContent:'space-between', marginBottom:3, flexWrap: 'wrap', rowGap: 10 }}>
                        <span style={{ fontSize:13, fontWeight:600, color:'var(--t1)', overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap', maxWidth:140 }}>{c.contact?.name || c.contact?.phoneNumber}</span>
                        <span style={{ fontSize:10, color:'var(--t2)', flexShrink:0 }}>{fmtTime(c.lastMessageAt)}</span>
                      </div>
                      <p style={{ fontSize:12, color:'var(--t2)', whiteSpace:'nowrap', overflow:'hidden', textOverflow:'ellipsis', marginBottom:5 }}>
                        {lastMsg?.body || c.messages?.[0]?.body || c.contact?.phoneNumber}
                      </p>
                      <div style={{ display:'flex', gap:5, alignItems:'center', flexWrap:'wrap' }}>
                        <LabelBadge label={c.label} />
                        {/* Who has this thread, in the same place the design
                            set puts its AI / HUMAN / RESOLVED tag. */}
                        {(() => {
                          const out = (c.messages || []).find(m => (m.direction || '').toUpperCase() === 'OUTBOUND');
                          const tag = c.status === 'RESOLVED' || c.status === 'CLOSED'
                            ? ['RESOLVED', '#8b909b']
                            : c.assignedToUserId
                              ? ['HUMAN', '#9d6bff']
                              : (c.aiSessions?.length > 0 || (out && out.senderUserId == null))
                                ? ['AI', '#35e8f2']
                                : null;
                          if (!tag) return null;
                          return (
                            <span style={{ fontFamily:'var(--mono)', fontSize:8.5, letterSpacing:'.06em', padding:'2px 6px', borderRadius:5, background:`${tag[1]}22`, color:tag[1], border:`1px solid ${tag[1]}44` }}>
                              {tag[0]}
                            </span>
                          );
                        })()}
                        {c.unreadCount > 0 && (
                          <span style={{ padding:'1px 7px', borderRadius:10, fontSize:10, fontWeight:700, background:'var(--green)', color:'#08090c' }}>{c.unreadCount}</span>
                        )}
                      </div>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        {/* ── right panel ──
            minWidth:0 on the column is load-bearing: flex items refuse to
            shrink below their min-content width by default, so with the two
            right-hand columns docked this column stayed as wide as its own
            header wanted and the header's contents overlapped instead of the
            column giving way. */}
        {active ? (
          <div style={{ flex:1, minWidth:0, display:'flex', flexDirection:'column', overflow:'hidden' }}>
            {/* chat header — on a phone this is the screen's own title bar, so
                it carries the back affordance and takes WhatsApp's colour, the
                way the design set's conversation screen does. */}
            {/* overflow:hidden plus a shrinkable right group is what keeps the
                two halves from colliding: with the contact panel open the chat
                column gets narrow enough that the fixed-width controls used to
                overrun the contact's name and phone number and paint on top of
                them. Both sides shrink now, and nothing escapes the bar. */}
            <div style={{ padding: mobile ? '9px 12px' : '10px 20px', borderBottom:'1px solid var(--bd)', display:'flex', alignItems:'center', justifyContent:'space-between', gap:10, background: mobile ? 'var(--grad-wa)' : 'var(--surf)', flexShrink:0, overflow:'hidden' }}>
              <div style={{ display:'flex', alignItems:'center', gap:10, minWidth:0, flex:'1 1 auto', overflow:'hidden' }}>
                {mobile && (
                  <button onClick={() => setActiveId(null)} aria-label="Back to conversations"
                    style={{ background:'none', border:'none', cursor:'pointer', padding:'2px 4px 2px 0', display:'flex', alignItems:'center', color:'#fff', flexShrink:0 }}>
                    <svg width="19" height="19" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M15 18l-6-6 6-6" /></svg>
                  </button>
                )}
                <Avatar name={active.contact.name} size={mobile ? 32 : 36} />
                <div style={{ minWidth:0 }}>
                  <p style={{ fontFamily:"'Space Grotesk',sans-serif", fontWeight:700, fontSize:14, color: mobile ? '#fff' : 'var(--t1)', whiteSpace:'nowrap', overflow:'hidden', textOverflow:'ellipsis' }}>{active.contact.name}</p>
                  <div style={{ display:'flex', alignItems:'center', gap:5, minWidth:0 }}>
                    {!mobile && <I n="phone" s={10} c="var(--t2)" />}
                    <p style={{ fontSize:11, color: mobile ? 'rgba(255,255,255,0.85)' : 'var(--t2)', whiteSpace:'nowrap', overflow:'hidden', textOverflow:'ellipsis' }}>
                      {mobile && isBot ? 'Spandan AI active' : active.contact.phoneNumber}
                    </p>
                  </div>
                </div>
              </div>
              <div style={{ display:'flex', alignItems:'center', gap: mobile ? 8 : 12, minWidth:0 }}>
                <div style={{ display:'flex', alignItems:'center', gap:7, flexShrink:0 }}>
                  <I n={isBot ? 'bot' : 'user'} s={14} c={isBot ? (mobile ? '#fff' : 'var(--green)') : (mobile ? 'rgba(255,255,255,0.8)' : 'var(--t2)')} />
                  <div onClick={() => setIsBot(!isBot)} style={{ width:38, height:21, borderRadius:20, background: isBot ? 'var(--green)' : 'rgba(255,255,255,0.1)', cursor:'pointer', transition:'background .2s', position:'relative', border:'1px solid var(--bd)' }}>
                    <div style={{ position:'absolute', top:2, left: isBot ? 19 : 2, width:15, height:15, borderRadius:'50%', background:'white', transition:'left .2s', boxShadow:'0 1px 4px rgba(0,0,0,0.4)' }} />
                  </div>
                  {!mobile && <span style={{ fontSize:11, color:'var(--t2)' }}>{isBot ? 'Bot' : 'Human'}</span>}
                </div>
                {/* This used to be three hardcoded options that saved nothing.
                    It is the workspace's real members now, and picking one
                    assigns the thread. */}
                {!mobile && (
                  <select
                    value={context?.conversation?.assignedTo?.id || ''}
                    disabled={busyAction}
                    onChange={e => assignTo(e.target.value)}
                    style={{ padding:'6px 10px', borderRadius:7, background:'rgba(255,255,255,0.04)', border:'1px solid var(--bd)', color:'var(--t2)', fontSize:12, fontFamily:"'Manrope',sans-serif", outline:'none', colorScheme:'dark',
                             // The assignee names are arbitrary length, so this
                             // is the one control allowed to give up width when
                             // the column is tight.
                             flex:'0 1 auto', minWidth:0, maxWidth:150, textOverflow:'ellipsis' }}>
                    <option value="">Unassigned</option>
                    {members.map(m => (
                      <option key={m.id || m.userId} value={m.userId || m.id}>{m.name || m.user?.name || m.email}</option>
                    ))}
                  </select>
                )}
                {!mobile && (
                  <Btn variant="outline" size="sm" disabled={busyAction} style={{ flexShrink:0 }}
                    onClick={() => setStatus(active.status === 'RESOLVED' ? 'OPEN' : 'RESOLVED')}>
                    {active.status === 'RESOLVED' ? 'Reopen' : 'Resolve'}
                  </Btn>
                )}
                <button onClick={() => setDetailsOpen(o => !o)}
                  title={detailsOpen ? 'Hide contact details' : 'Show contact details'}
                  aria-label={detailsOpen ? 'Hide contact details' : 'Show contact details'}
                  style={{ width:30, height:30, borderRadius:7, cursor:'pointer', display:'flex', alignItems:'center', justifyContent:'center', flexShrink:0,
                           background: detailsOpen ? 'var(--gbg)' : 'rgba(255,255,255,0.04)',
                           border:`1px solid ${detailsOpen ? 'var(--gbd)' : 'var(--bd)'}` }}>
                  <I n="user" s={14} c={detailsOpen ? 'var(--green)' : 'var(--t2)'} />
                </button>
              </div>
            </div>

            {/* tabs */}
            <div style={{ display:'flex', borderBottom:'1px solid var(--bd)', flexShrink:0, background:'var(--surf)' }}>
              {[{ id:'chat', label:'Chat', icon:'msg' }, { id:'notes', label:'Internal Notes', icon:'note' }].map(t => (
                <div key={t.id} onClick={() => setTab(t.id)}
                  style={{ display:'flex', alignItems:'center', gap:6, padding:'10px 20px', cursor:'pointer', fontSize:13, fontWeight: tab===t.id ? 600 : 500, color: tab===t.id ? 'var(--t1)' : 'var(--t2)', borderBottom:`2px solid ${tab===t.id ? 'var(--green)' : 'transparent'}`, transition:'all .15s' }}>
                  <I n={t.icon} s={13} c={tab===t.id ? 'var(--green)' : 'var(--t2)'} />
                  {t.label}
                </div>
              ))}
            </div>

            {tab === 'chat' ? (
              <>
                {/* messages */}
                <div ref={scrollRef} style={{ flex:1, overflowY:'auto', padding:'20px', display:'flex', flexDirection:'column', gap:10, background:'rgba(5,8,18,0.6)' }}>
                  {activeMsgs.length === 0 && (
                    <div style={{ textAlign:'center', padding:'24px 0', color:'var(--t3)', fontSize:12 }}>No messages yet in this conversation.</div>
                  )}
                  {activeMsgs.map(m => {
                    const out = (m.direction || '').toUpperCase() === 'OUTBOUND';
                    return (
                      <div key={m.id} style={{ display:'flex', justifyContent: out ? 'flex-end' : 'flex-start', alignItems:'flex-end', gap:8, opacity: m._pending ? 0.55 : 1 }}>
                        {!out && <Avatar name={active.contact?.name || '?'} size={26} />}
                        <div style={{ maxWidth:'66%', padding:'10px 14px', borderRadius: out ? '14px 14px 3px 14px' : '14px 14px 14px 3px', background: out ? 'var(--gbg)' : 'var(--surf)', border:`1px solid ${out ? 'var(--gbd)' : 'var(--bd)'}`, boxShadow:'var(--card-shadow)' }}>
                          {/* An outbound message with no sender came from the
                              agent. That was rendered as an unattributed
                              message, so a customer's reply to something the
                              AI said looked like a reply to a teammate. */}
                          {out && (
                            <div style={{ display:'flex', alignItems:'center', gap:5, marginBottom:4 }}>
                              {m.senderUser ? (
                                <span style={{ fontSize:9, color:'var(--t2)', fontWeight:700, textTransform:'uppercase', letterSpacing:'.07em' }}>{m.senderUser.name}</span>
                              ) : (
                                <span style={{ fontFamily:'var(--mono)', fontSize:8.5, letterSpacing:'.08em', color:'var(--green)', fontWeight:700 }}>
                                  ✓ SPANDAN AI{context?.aiSession?.campaign ? ' · CAMPAIGN-GROUNDED' : ''}
                                </span>
                              )}
                            </div>
                          )}
                          {/* Media, location and contact cards arrive as their
                              own message types. They used to be stored as an
                              empty body, so the thread showed nothing at all. */}
                          {m.type && m.type !== 'TEXT' && m.type !== 'BUTTON' && m.type !== 'INTERACTIVE' && (
                            <div style={{ display:'flex', alignItems:'center', gap:6, marginBottom:4, padding:'5px 8px', borderRadius:7, background:'rgba(255,255,255,0.04)', border:'1px solid var(--bd)' }}>
                              <I n={MEDIA_ICON[m.type] || 'file'} s={12} c="var(--t2)" />
                              <span style={{ fontFamily:'var(--mono)', fontSize:9, letterSpacing:'.08em', color:'var(--t2)', textTransform:'uppercase' }}>
                                {m.type === 'LOCATION' && m.locationLat != null
                                  ? `${m.locationLat.toFixed(4)}, ${m.locationLng.toFixed(4)}`
                                  : (m.mediaFilename || m.type.toLowerCase())}
                              </span>
                            </div>
                          )}
                          <p style={{ fontSize:13, color:'var(--t1)', lineHeight:1.5, whiteSpace:'pre-wrap', wordBreak:'break-word' }}>{m.body}</p>
                          <div style={{ display:'flex', alignItems:'center', justifyContent:'flex-end', gap:5, marginTop:4 }}>
                            <span style={{ fontSize:10, color:'var(--t2)' }}>{fmtTime(m.sentAt)}</span>
                            {/* Delivery state, now recorded for every outbound
                                message rather than campaign sends alone. */}
                            {out && m.status && <DeliveryTick status={m.status} error={m.errorMessage} />}
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>
                {sendError && (
                  <div style={{ padding:'8px 16px', borderTop:'1px solid var(--bd)', background:'rgba(239,68,68,.06)', color:'#f87171', fontSize:12, display:'flex', justifyContent:'space-between', alignItems:'center' }}>
                    <span>{sendError}</span>
                    <button onClick={() => setSendError(null)} style={{ background:'none', border:'none', cursor:'pointer', color:'#f87171', padding:0, display:'flex' }}>
                      <I n="x" s={12} c="#f87171" />
                    </button>
                  </div>
                )}
                {/* input */}
                {/* AI suggestions. Drafted by the same agent the customer
                    would have got, so accepting one sends what it would have
                    sent and editing one is a real edit. */}
                <div style={{ padding:'8px 16px 0', display:'flex', alignItems:'center', gap:8, flexWrap:'wrap', background:'var(--surf)', flexShrink:0 }}>
                  <button onClick={askForSuggestion} disabled={suggesting}
                    style={{ display:'inline-flex', alignItems:'center', gap:6, fontFamily:'var(--mono)', fontSize:9, letterSpacing:'.1em', textTransform:'uppercase', color:'var(--green)', background:'none', border:'none', cursor: suggesting ? 'wait' : 'pointer', padding:0 }}>
                    <I n="spark" s={11} c="var(--green)" /> {suggesting ? 'Drafting…' : 'AI suggestions'}
                  </button>
                  {suggestions.map((sug, i) => (
                    <button key={i} onClick={() => setInput(sug)} title="Put this in the composer"
                      style={{ fontSize:12, padding:'5px 11px', borderRadius:100, cursor:'pointer', maxWidth:340, overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap',
                               fontFamily:"'Manrope',sans-serif", background:'rgba(53,232,242,0.08)', border:'1px solid var(--gbd)', color:'var(--t1)' }}>
                      {sug}
                    </button>
                  ))}
                  {suggestNote && <span style={{ fontSize:11, color:'var(--t3)' }}>{suggestNote}</span>}
                </div>

                {/* WhatsApp's 24-hour rule, stated before the agent types
                    rather than discovered when Meta rejects the send. */}
                {activeWindow && !activeWindow.open && (
                  <div style={{ padding:'9px 16px', borderTop:'1px solid var(--bd)', background:'rgba(245,158,11,.07)', display:'flex', alignItems:'center', gap:8 }}>
                    <I n="alertt" s={13} c="#fbbf24" />
                    <span style={{ fontSize:12, color:'#fbbf24', lineHeight:1.45 }}>{activeWindow.description}</span>
                  </div>
                )}
                {activeWindow?.open && activeWindow.msRemaining < 2 * 3600_000 && (
                  <div style={{ padding:'7px 16px', borderTop:'1px solid var(--bd)', background:'rgba(255,255,255,0.02)' }}>
                    <span style={{ fontSize:11, color:'var(--t3)' }}>{activeWindow.description}</span>
                  </div>
                )}

                <div style={{ padding:'12px 16px', borderTop:'1px solid var(--bd)', display:'flex', gap:8, alignItems:'center', background:'var(--surf)', flexShrink:0 }}>
                  <Btn variant="outline" size="sm">Quick Reply</Btn>
                  <input value={input} onChange={e => setInput(e.target.value)} onKeyDown={e => e.key === 'Enter' && send()}
                    placeholder={activeWindow && !activeWindow.open ? 'Reply window closed — send an approved template' : 'Type a message…'}
                    disabled={sending || (activeWindow ? !activeWindow.open : false)}
                    style={{ flex:1, padding:'10px 14px', borderRadius:9, background:'rgba(255,255,255,0.03)', border:'1px solid var(--bd)', color:'var(--t1)', fontSize:13, fontFamily:"'Manrope',sans-serif", outline:'none', transition:'border .15s', opacity: sending ? 0.6 : 1 }}
                    onFocus={e => e.target.style.borderColor='var(--gbd)'}
                    onBlur={e => e.target.style.borderColor='var(--bd)'} />
                  <button onClick={send} disabled={!input.trim() || sending || (activeWindow ? !activeWindow.open : false)}
                    style={{ width:38, height:38, borderRadius:9, background:'var(--green)', border:'none', cursor: (!input.trim() || sending) ? 'not-allowed' : 'pointer', display:'flex', alignItems:'center', justifyContent:'center', flexShrink:0, boxShadow:'0 0 14px rgba(53,232,242,0.25)', opacity: (!input.trim() || sending) ? 0.5 : 1 }}>
                    <I n="send" s={15} c="#08090c" />
                  </button>
                </div>
              </>
            ) : (
              <div style={{ flex:1, display:'flex', flexDirection:'column', overflow:'hidden' }}>
                <div style={{ flex:1, overflowY:'auto', padding:'16px 20px', display:'flex', flexDirection:'column', gap:10 }}>
                  {notes.length === 0 && (
                    <p style={{ fontSize:13, color:'var(--t3)', textAlign:'center', padding:'24px 0', lineHeight:1.6 }}>
                      No notes yet. Anything written here stays inside your team — it is never sent to the customer.
                    </p>
                  )}
                  {notes.map(note => (
                    <div key={note.id} style={{ padding:'11px 13px', borderRadius:9, background:'rgba(245,158,11,0.05)', border:'1px solid rgba(245,158,11,0.2)' }}>
                      <p style={{ fontSize:13, color:'var(--t1)', lineHeight:1.55, whiteSpace:'pre-wrap', marginBottom:6 }}>{note.body}</p>
                      <div style={{ display:'flex', alignItems:'center', gap:8, fontSize:11, color:'var(--t3)' }}>
                        <span>{note.author?.name || 'Someone'}</span>
                        <span>·</span>
                        <span>{new Date(note.createdAt).toLocaleString('en-IN', { day:'numeric', month:'short', hour:'2-digit', minute:'2-digit' })}</span>
                      </div>
                    </div>
                  ))}
                </div>
                <div style={{ padding:'12px 16px', borderTop:'1px solid var(--bd)', display:'flex', gap:8, alignItems:'flex-end', background:'var(--surf)', flexShrink:0 }}>
                  <textarea value={noteDraft} onChange={e => setNoteDraft(e.target.value)} rows={2}
                    placeholder="Private note for your team…"
                    style={{ flex:1, padding:'9px 12px', borderRadius:9, background:'rgba(255,255,255,0.03)', border:'1px solid var(--bd)', color:'var(--t1)', fontSize:13, fontFamily:"'Manrope',sans-serif", outline:'none', resize:'vertical' }} />
                  <Btn size="sm" onClick={addNote} disabled={savingNote || !noteDraft.trim()}>
                    {savingNote ? 'Saving…' : 'Add note'}
                  </Btn>
                </div>
              </div>
            )}
          </div>
        ) : !mobile ? (
          <div style={{ flex:1, display:'flex', alignItems:'center', justifyContent:'center', color:'var(--t2)' }}>
            <p style={{ fontSize:14 }}>Select a conversation to start chatting</p>
          </div>
        ) : null}

        {/* ── contact details ──
            Keyed on the contact so switching conversations swaps the whole
            panel rather than leaving the previous contact's edit state behind.
            The data comes from the Contacts API, so an edit here is an edit
            there. */}
        {/* One column: thread context on top, then the contact record. The
            panel is already a drawer on a narrow viewport, so this rides with
            it rather than claiming a fourth column that does not exist. */}
        {active?.contact?.id && detailsOpen && !narrow && wide && (
          <div style={{ width: 300, flexShrink: 0, borderLeft: '1px solid var(--bd)', overflowY: 'auto', background: 'var(--surf)' }}>
            <ThreadContext
              context={context}
              busy={busyAction}
              onHandBackToAI={() => assignTo(null)}
            />
          </div>
        )}

        {active?.contact?.id && detailsOpen && (
          <ContactDetailsPanel
            key={active.contact.id}
            contactId={active.contact.id}
            asDrawer={narrow}
            // Below the four-column width the thread context has no column of
            // its own, so it rides at the top of this panel — including in the
            // drawer, where it was previously dropped altogether.
            topSlot={!wide && context ? (
              <ThreadContext
                context={context}
                busy={busyAction}
                onHandBackToAI={() => assignTo(null)}
              />
            ) : null}
            onClose={() => setDetailsOpen(false)}
            onContactUpdated={(updated) => {
              // Keep the list and chat header in step with a rename made here,
              // without waiting for the next poll.
              setConvs(list => list.map(c => (
                c.contact?.id === updated.id ? { ...c, contact: { ...c.contact, ...updated } } : c
              )));
            }}
          />
        )}
      </div>
    </div>
  );
}
