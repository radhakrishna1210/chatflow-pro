import { useState, useEffect, useRef } from 'react';
import { I } from '../components/Icons.jsx';
import { Btn } from '../components/Btn.jsx';
import { wFetch } from '../lib/api.js';

const labelCfg = {
  urgent:   { bg:'rgba(239,68,68,.08)',   bd:'rgba(239,68,68,.22)',   c:'#f87171' },
  resolved: { bg:'var(--gbg)',            bd:'var(--gbd)',            c:'var(--green)' },
  billing:  { bg:'rgba(245,158,11,.08)', bd:'rgba(245,158,11,.22)', c:'#fbbf24' },
};

const Avatar = ({ name='?', size=36 }) => {
  const init = name.split(' ').map(n=>n[0]).join('').slice(0,2).toUpperCase();
  const colors = ['#1EBF5E','#0EA5E9','#A78BFA','#F59E0B','#F472B6'];
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

export default function InboxView() {
  const [convs, setConvs]       = useState([]);
  const [msgs, setMsgs]         = useState({});
  const [activeId, setActiveId] = useState(null);
  const [isBot, setIsBot]       = useState(false);
  const [input, setInput]       = useState('');
  const [tab, setTab]           = useState('chat');
  const [search, setSearch]     = useState('');
  const [sending, setSending]   = useState(false);
  const [sendError, setSendError] = useState(null);
  const scrollRef = useRef(null);

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
            setActiveId(prev => prev ?? list[0]?.id ?? null);
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
        .then(d => { if (!stopped && Array.isArray(d)) setMsgs(p => ({ ...p, [activeId]: d })); })
        .catch(() => {});
    loadMsgs();
    const interval = setInterval(loadMsgs, 4000);
    return () => { stopped = true; clearInterval(interval); };
  }, [activeId]);

  useEffect(() => {
    if (scrollRef.current) scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
  }, [activeId, msgs]);

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

  const filtered = convs.filter(c =>
    !search ||
    c.contact?.name?.toLowerCase().includes(search.toLowerCase()) ||
    c.contact?.phoneNumber?.includes(search)
  );
  const active = convs.find(c => c.id === activeId);
  const activeMsgs = msgs[activeId] || [];

  return (
    <div style={{ display:'flex', flexDirection:'column', flex:1, overflow:'hidden' }}>
      <div style={{ height:58, borderBottom:'1px solid var(--bd)', display:'flex', alignItems:'center', padding:'0 28px', flexShrink:0, background:'var(--surf)' }}>
        <h1 style={{ fontFamily:"'Syne',sans-serif", fontWeight:800, fontSize:16, color:'var(--t1)', letterSpacing:'-.02em' }}>Inbox</h1>
        <p style={{ fontSize:11.5, color:'var(--t2)', marginLeft:10 }}>Manage customer conversations</p>
      </div>

      <div style={{ display:'flex', flex:1, overflow:'hidden' }}>
        {/* ── left panel ── */}
        <div style={{ width:320, borderRight:'1px solid var(--bd)', display:'flex', flexDirection:'column', flexShrink:0, background:'var(--surf)' }}>
          <div style={{ padding:'10px 12px', borderBottom:'1px solid var(--bd)' }}>
            <div style={{ display:'flex', alignItems:'center', gap:8, padding:'8px 12px', borderRadius:8, background:'rgba(255,255,255,0.03)', border:'1px solid var(--bd)' }}>
              <I n="search" s={13} c="var(--t2)" />
              <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Search conversations…"
                style={{ flex:1, background:'none', border:'none', outline:'none', color:'var(--t1)', fontSize:13, fontFamily:"'Plus Jakarta Sans',sans-serif" }} />
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
                  style={{ padding:'12px 14px', borderBottom:'1px solid var(--bd)', cursor:'pointer', transition:'background .12s', borderLeft:`2px solid ${on ? 'var(--green)' : 'transparent'}`, background: on ? 'rgba(30,191,94,0.06)' : 'transparent' }}
                  onMouseEnter={e => { if (!on) e.currentTarget.style.background = 'rgba(255,255,255,0.02)'; }}
                  onMouseLeave={e => { if (!on) e.currentTarget.style.background = 'transparent'; }}>
                  <div style={{ display:'flex', gap:10 }}>
                    <Avatar name={c.contact.name} size={36} />
                    <div style={{ flex:1, minWidth:0 }}>
                      <div style={{ display:'flex', justifyContent:'space-between', marginBottom:3 }}>
                        <span style={{ fontSize:13, fontWeight:600, color:'var(--t1)', overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap', maxWidth:140 }}>{c.contact?.name || c.contact?.phoneNumber}</span>
                        <span style={{ fontSize:10, color:'var(--t2)', flexShrink:0 }}>{fmtTime(c.lastMessageAt)}</span>
                      </div>
                      <p style={{ fontSize:12, color:'var(--t2)', whiteSpace:'nowrap', overflow:'hidden', textOverflow:'ellipsis', marginBottom:5 }}>
                        {lastMsg?.body || c.messages?.[0]?.body || c.contact?.phoneNumber}
                      </p>
                      <div style={{ display:'flex', gap:5, alignItems:'center' }}>
                        <LabelBadge label={c.label} />
                        {c.unreadCount > 0 && (
                          <span style={{ padding:'1px 7px', borderRadius:10, fontSize:10, fontWeight:700, background:'var(--green)', color:'#060913' }}>{c.unreadCount}</span>
                        )}
                      </div>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        {/* ── right panel ── */}
        {active ? (
          <div style={{ flex:1, display:'flex', flexDirection:'column', overflow:'hidden' }}>
            {/* chat header */}
            <div style={{ padding:'10px 20px', borderBottom:'1px solid var(--bd)', display:'flex', alignItems:'center', justifyContent:'space-between', background:'var(--surf)', flexShrink:0 }}>
              <div style={{ display:'flex', alignItems:'center', gap:10 }}>
                <Avatar name={active.contact.name} size={36} />
                <div>
                  <p style={{ fontFamily:"'Syne',sans-serif", fontWeight:700, fontSize:14, color:'var(--t1)' }}>{active.contact.name}</p>
                  <div style={{ display:'flex', alignItems:'center', gap:5 }}>
                    <I n="phone" s={10} c="var(--t2)" />
                    <p style={{ fontSize:11, color:'var(--t2)' }}>{active.contact.phoneNumber}</p>
                  </div>
                </div>
              </div>
              <div style={{ display:'flex', alignItems:'center', gap:12 }}>
                <div style={{ display:'flex', alignItems:'center', gap:7 }}>
                  <I n={isBot ? 'bot' : 'user'} s={14} c={isBot ? 'var(--green)' : 'var(--t2)'} />
                  <div onClick={() => setIsBot(!isBot)} style={{ width:38, height:21, borderRadius:20, background: isBot ? 'var(--green)' : 'rgba(255,255,255,0.1)', cursor:'pointer', transition:'background .2s', position:'relative', border:'1px solid var(--bd)' }}>
                    <div style={{ position:'absolute', top:2, left: isBot ? 19 : 2, width:15, height:15, borderRadius:'50%', background:'white', transition:'left .2s', boxShadow:'0 1px 4px rgba(0,0,0,0.4)' }} />
                  </div>
                  <span style={{ fontSize:11, color:'var(--t2)' }}>{isBot ? 'Bot' : 'Human'}</span>
                </div>
                <select style={{ padding:'6px 10px', borderRadius:7, background:'rgba(255,255,255,0.04)', border:'1px solid var(--bd)', color:'var(--t2)', fontSize:12, fontFamily:"'Plus Jakarta Sans',sans-serif", outline:'none' }}>
                  <option>Unassigned</option><option>Agent 1</option><option>Agent 2</option>
                </select>
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
                          {out && m.senderUser && (
                            <div style={{ fontSize:9, color: m.senderUser.name === 'AI' ? 'var(--green)' : 'var(--t2)', fontWeight:700, textTransform:'uppercase', letterSpacing:'.07em', marginBottom:4 }}>{m.senderUser.name}</div>
                          )}
                          <p style={{ fontSize:13, color:'var(--t1)', lineHeight:1.5, whiteSpace:'pre-wrap', wordBreak:'break-word' }}>{m.body}</p>
                          <p style={{ fontSize:10, color:'var(--t2)', textAlign:'right', marginTop:4 }}>{fmtTime(m.sentAt)}</p>
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
                <div style={{ padding:'12px 16px', borderTop:'1px solid var(--bd)', display:'flex', gap:8, alignItems:'center', background:'var(--surf)', flexShrink:0 }}>
                  <Btn variant="outline" size="sm">Quick Reply</Btn>
                  <input value={input} onChange={e => setInput(e.target.value)} onKeyDown={e => e.key === 'Enter' && send()}
                    placeholder="Type a message…" disabled={sending}
                    style={{ flex:1, padding:'10px 14px', borderRadius:9, background:'rgba(255,255,255,0.03)', border:'1px solid var(--bd)', color:'var(--t1)', fontSize:13, fontFamily:"'Plus Jakarta Sans',sans-serif", outline:'none', transition:'border .15s', opacity: sending ? 0.6 : 1 }}
                    onFocus={e => e.target.style.borderColor='var(--gbd)'}
                    onBlur={e => e.target.style.borderColor='var(--bd)'} />
                  <button onClick={send} disabled={!input.trim() || sending}
                    style={{ width:38, height:38, borderRadius:9, background:'var(--green)', border:'none', cursor: (!input.trim() || sending) ? 'not-allowed' : 'pointer', display:'flex', alignItems:'center', justifyContent:'center', flexShrink:0, boxShadow:'0 0 14px rgba(30,191,94,0.25)', opacity: (!input.trim() || sending) ? 0.5 : 1 }}>
                    <I n="send" s={15} c="#060913" />
                  </button>
                </div>
              </>
            ) : (
              <div style={{ flex:1, display:'flex', alignItems:'center', justifyContent:'center', flexDirection:'column', gap:12, color:'var(--t2)' }}>
                <div style={{ width:48, height:48, borderRadius:12, background:'var(--surf)', border:'1px solid var(--bd)', display:'flex', alignItems:'center', justifyContent:'center' }}>
                  <I n="note" s={22} c="var(--t2)" />
                </div>
                <p style={{ fontSize:14, fontWeight:600, color:'var(--t1)' }}>Internal Notes</p>
                <p style={{ fontSize:13, color:'var(--t2)' }}>Add private notes visible only to your team.</p>
                <Btn variant="outline" size="sm">
                  <I n="plus" s={13} c="var(--t2)" />
                  Add Note
                </Btn>
              </div>
            )}
          </div>
        ) : (
          <div style={{ flex:1, display:'flex', alignItems:'center', justifyContent:'center', color:'var(--t2)' }}>
            <p style={{ fontSize:14 }}>Select a conversation to start chatting</p>
          </div>
        )}
      </div>
    </div>
  );
}
