const { useState, useEffect } = React;

// ── Icons ──────────────────────────────────────────────────────────────
const I = ({ n, s = 16, c = 'currentColor', w = 1.75 }) => {
  const d = {
    home:  <><path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/><polyline points="9,22 9,12 15,12 15,22"/></>,
    file:  <><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14,2 14,8 20,8"/></>,
    send:  <><line x1="22" y1="2" x2="11" y2="13"/><polygon points="22,2 15,22 11,13 2,9 22,2"/></>,
    users: <><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.87M16 3.13a4 4 0 0 1 0 7.75"/></>,
    msg:   <><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></>,
    zap:   <><polygon points="13,2 3,14 12,14 11,22 21,10 12,10 13,2"/></>,
    chart: <><line x1="18" y1="20" x2="18" y2="10"/><line x1="12" y1="20" x2="12" y2="4"/><line x1="6" y1="20" x2="6" y2="14"/></>,
    phone: <><path d="M22 16.92v3a2 2 0 0 1-2.18 2A19.79 19.79 0 0 1 4.07 4.18 2 2 0 0 1 6.11 2h3a2 2 0 0 1 2 1.72c.127.96.361 1.903.7 2.81a2 2 0 0 1-.45 2.11L10.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45c.907.339 1.85.573 2.81.7A2 2 0 0 1 22 16.92z"/></>,
    key:   <><path d="M21 2l-2 2m-7.61 7.61a5.5 5.5 0 1 1-7.778 7.778 5.5 5.5 0 0 1 7.777-7.777zm0 0L15.5 7.5m0 0l3 3L22 7l-3-3m-3.5 3.5L19 4"/></>,
    cog:   <><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/></>,
    db:    <><ellipse cx="12" cy="5" rx="9" ry="3"/><path d="M21 12c0 1.66-4 3-9 3s-9-1.34-9-3M3 5v14c0 1.66 4 3 9 3s9-1.34 9-3V5"/></>,
    check: <><polyline points="20,6 9,17 4,12"/></>,
    arrow: <><line x1="5" y1="12" x2="19" y2="12"/><polyline points="12,5 19,12 12,19"/></>,
    play:  <><circle cx="12" cy="12" r="10"/><polygon points="10,8 16,12 10,16 10,8"/></>,
    globe: <><circle cx="12" cy="12" r="10"/><line x1="2" y1="12" x2="22" y2="12"/><path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z"/></>,
    brain: <><path d="M9.5 2A2.5 2.5 0 0 1 12 4.5v15a2.5 2.5 0 0 1-4.96-.44 2.5 2.5 0 0 1-2.96-3.08 3 3 0 0 1-.34-5.58 2.5 2.5 0 0 1 1.32-4.24 2.5 2.5 0 0 1 1.44-4.66zM14.5 2A2.5 2.5 0 0 0 12 4.5v15a2.5 2.5 0 0 0 4.96-.44 2.5 2.5 0 0 0 2.96-3.08 3 3 0 0 0 .34-5.58 2.5 2.5 0 0 0-1.32-4.24 2.5 2.5 0 0 0-1.44-4.66z"/></>,
    wflow: <><rect x="2" y="3" width="6" height="6" rx="1"/><rect x="16" y="3" width="6" height="6" rx="1"/><rect x="9" y="15" width="6" height="6" rx="1"/><path d="M5 9v3a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1V9M12 13v2"/></>,
    bot:   <><rect x="3" y="11" width="18" height="10" rx="2"/><circle cx="12" cy="5" r="2"/><path d="M12 7v4M8 15v1M16 15v1"/></>,
    spark: <><path d="M12 3l1.912 5.813a2 2 0 0 0 1.275 1.275L21 12l-5.813 1.912a2 2 0 0 0-1.275 1.275L12 21l-1.912-5.813a2 2 0 0 0-1.275-1.275L3 12l5.813-1.912a2 2 0 0 0 1.275-1.275L12 3z"/></>,
    logout:<><path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/><polyline points="16,17 21,12 16,7"/><line x1="21" y1="12" x2="9" y2="12"/></>,
    eye:   <><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></>,
    eyeoff:<><path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24"/><line x1="1" y1="1" x2="23" y2="23"/></>,
    insta: <><rect x="2" y="2" width="20" height="20" rx="5" ry="5"/><path d="M16 11.37A4 4 0 1 1 12.63 8 4 4 0 0 1 16 11.37z"/><line x1="17.5" y1="6.5" x2="17.51" y2="6.5"/></>,
    search:<><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></>,
    bell:  <><path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9M13.73 21a2 2 0 0 1-3.46 0"/></>,
    x:     <><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></>,
  };
  return <svg width={s} height={s} viewBox="0 0 24 24" fill="none" stroke={c} strokeWidth={w} strokeLinecap="round" strokeLinejoin="round">{d[n]||null}</svg>;
};

// ── Button ─────────────────────────────────────────────────────────────
const Btn = ({ children, variant='primary', size='md', onClick, style:ex={}, disabled }) => {
  const [h, setH] = useState(false);
  const base = {
    display:'inline-flex', alignItems:'center', gap:'7px',
    fontFamily:"'Plus Jakarta Sans',sans-serif", fontWeight:600,
    cursor:disabled?'not-allowed':'pointer', border:'none',
    transition:'all .16s ease', whiteSpace:'nowrap', opacity:disabled?.55:1,
    ...(size==='sm'?{padding:'7px 14px',fontSize:'13px',borderRadius:'8px'}:
        size==='lg'?{padding:'14px 28px',fontSize:'15px',borderRadius:'11px',letterSpacing:'-.01em'}:
                    {padding:'10px 20px',fontSize:'14px',borderRadius:'9px'}),
    ...(variant==='primary'?{
      background:h?'#22d468':'var(--green)', color:'#060A10',
      boxShadow:h?'0 0 32px rgba(30,191,94,0.35)':'inset 0 1px 0 rgba(255,255,255,0.2)',
    }:variant==='ghost'?{
      background:h?'rgba(255,255,255,0.07)':'rgba(255,255,255,0.04)',
      color:'var(--t1)', border:'1px solid var(--bd)',
      boxShadow:'inset 0 1px 0 rgba(255,255,255,0.05)',
    }:variant==='outline'?{
      background:h?'rgba(255,255,255,0.04)':'transparent',
      color:'var(--t2)', border:'1px solid var(--bd)',
    }:{}),
    ...ex,
  };
  return <button style={base} onClick={onClick} disabled={disabled}
    onMouseEnter={()=>setH(true)} onMouseLeave={()=>setH(false)}>{children}</button>;
};

// ── Mini sparkline for hero preview ───────────────────────────────────
const MiniSpark = ({ data, color='#1EBF5E', w=56, h=22 }) => {
  const max=Math.max(...data), min=Math.min(...data), r=(max-min)||1;
  const pts = data.map((v,i)=>`${(i/(data.length-1)*w).toFixed(1)},${(h-(v-min)/r*h*.78-h*.11).toFixed(1)}`).join(' ');
  return (
    <svg width={w} height={h} viewBox={`0 0 ${w} ${h}`} style={{overflow:'visible'}}>
      <polyline points={pts} fill="none" stroke={color} strokeWidth="1.5" strokeLinejoin="round" strokeLinecap="round"/>
    </svg>
  );
};

// ── Hero product preview ───────────────────────────────────────────────
const HeroPreview = () => {
  const spark1=[42,55,48,62,58,74,68,82,76,90];
  const spark2=[30,38,32,45,40,52,48,58,54,62];
  const spark3=[8,12,10,16,14,20,18,22,20,24];
  const spark4=[95,97,96,98,97,99,98,99,98,99];
  const bars  =[40,58,45,72,65,88,80];
  return (
    <div className="fu5 floatY" style={{position:'relative',flexShrink:0}}>
      {/* Floating pill — top right */}
      <div style={{position:'absolute',top:'-18px',right:'-24px',zIndex:10,padding:'8px 14px',borderRadius:'40px',background:'var(--surf)',border:'1px solid var(--bd)',boxShadow:'var(--card-shadow)',display:'flex',alignItems:'center',gap:'8px'}}>
        <div style={{width:7,height:7,borderRadius:'50%',background:'var(--green)',animation:'pulse 2s ease infinite'}}/>
        <span style={{fontSize:'12px',fontWeight:700,color:'var(--t1)'}}>98.7% delivered</span>
      </div>
      {/* Floating pill — bottom left */}
      <div style={{position:'absolute',bottom:'-16px',left:'-24px',zIndex:10,padding:'8px 14px',borderRadius:'40px',background:'var(--surf)',border:'1px solid var(--bd)',boxShadow:'var(--card-shadow)',display:'flex',alignItems:'center',gap:'8px'}}>
        <I n="send" s={13} c="#1EBF5E"/>
        <span style={{fontSize:'12px',fontWeight:700,color:'var(--t1)'}}>12,421 sent today</span>
      </div>
      {/* Browser frame */}
      <div style={{background:'#090D1A',borderRadius:'16px',border:'1px solid rgba(255,255,255,0.10)',boxShadow:'0 32px 80px rgba(0,0,0,0.7), inset 0 1px 0 rgba(255,255,255,0.08)',overflow:'hidden',width:'560px'}}>
        {/* Chrome bar */}
        <div style={{height:'36px',background:'#060A15',borderBottom:'1px solid rgba(255,255,255,0.06)',display:'flex',alignItems:'center',padding:'0 14px',gap:'10px'}}>
          <div style={{display:'flex',gap:'5px'}}>{['#FF5F57','#FFBD2E','#28C840'].map(c=><div key={c} style={{width:'10px',height:'10px',borderRadius:'50%',background:c}}/>)}</div>
          <div style={{flex:1,maxWidth:'300px',margin:'0 auto',background:'rgba(255,255,255,0.05)',borderRadius:'5px',padding:'3px 12px',fontSize:'10.5px',color:'rgba(255,255,255,0.3)',fontFamily:'monospace'}}>app.chatflowpro.com/dashboard</div>
        </div>
        {/* Dashboard */}
        <div style={{display:'flex',height:'430px'}}>
          {/* Sidebar */}
          <div style={{width:'50px',background:'#060913',borderRight:'1px solid rgba(255,255,255,0.05)',display:'flex',flexDirection:'column',alignItems:'center',padding:'14px 0',gap:'4px'}}>
            <div style={{width:'28px',height:'28px',borderRadius:'7px',background:'var(--green)',display:'flex',alignItems:'center',justifyContent:'center',marginBottom:'10px'}}>
              <svg width="12" height="12" viewBox="0 0 16 16" fill="none"><path d="M8 1C4.13 1 1 4.13 1 8c0 1.29.35 2.5.96 3.54L1 15l3.46-.96A7 7 0 1 0 8 1z" fill="#060913"/></svg>
            </div>
            {['home','file','send','users','msg','zap','chart','phone','cog'].map((ic,i)=>(
              <div key={ic} style={{width:'32px',height:'32px',borderRadius:'7px',background:i===0?'var(--gbg)':'transparent',display:'flex',alignItems:'center',justifyContent:'center'}}>
                <I n={ic} s={14} c={i===0?'var(--green)':'rgba(255,255,255,0.18)'} w={1.6}/>
              </div>
            ))}
          </div>
          {/* Main */}
          <div style={{flex:1,background:'#070B18',padding:'16px 18px',display:'flex',flexDirection:'column',gap:'10px',overflow:'hidden'}}>
            {/* Header */}
            <div style={{display:'flex',justifyContent:'space-between',alignItems:'center'}}>
              <div>
                <div style={{fontFamily:"'Syne',sans-serif",fontWeight:800,fontSize:'14px',color:'var(--t1)'}}>Dashboard</div>
                <div style={{fontSize:'10px',color:'var(--t2)',marginTop:'1px'}}>May 9, 2026</div>
              </div>
              <div style={{display:'flex',gap:'6px'}}>
                <div style={{padding:'4px 10px',fontSize:'10px',fontWeight:600,borderRadius:'6px',background:'rgba(255,255,255,0.05)',border:'1px solid rgba(255,255,255,0.06)',color:'rgba(255,255,255,0.4)'}}>Export</div>
                <div style={{padding:'4px 10px',fontSize:'10px',fontWeight:700,borderRadius:'6px',background:'var(--green)',color:'#060913'}}>+ Campaign</div>
              </div>
            </div>
            {/* Upgrade strip */}
            <div style={{height:'32px',borderRadius:'8px',background:'linear-gradient(90deg,rgba(30,191,94,0.12),rgba(14,165,233,0.07))',border:'1px solid rgba(30,191,94,0.2)',display:'flex',alignItems:'center',padding:'0 12px',gap:'6px'}}>
              <I n="spark" s={10} c="var(--green)"/>
              <span style={{fontSize:'10px',color:'var(--t1)',fontWeight:600}}>Unlock AI Copilot — Upgrade to Growth</span>
              <span style={{marginLeft:'auto',fontSize:'9px',padding:'2px 8px',borderRadius:'20px',background:'var(--green)',color:'#060913',fontWeight:700}}>Upgrade</span>
            </div>
            {/* Stats */}
            <div style={{display:'grid',gridTemplateColumns:'repeat(4,1fr)',gap:'6px'}}>
              {[['50.2K','Messages',spark1,'var(--green)','↑12%'],['12.4K','Contacts',spark2,'#0EA5E9','↑8%'],['24','Campaigns',spark3,'#A78BFA','↑3'],['98.7%','Delivery',spark4,'#F59E0B','↑0.4%']].map(([v,l,sp,c,ch])=>(
                <div key={l} style={{padding:'9px 10px',background:'rgba(255,255,255,0.025)',border:'1px solid rgba(255,255,255,0.06)',borderRadius:'8px',boxShadow:'inset 0 1px 0 rgba(255,255,255,0.05)'}}>
                  <div style={{fontSize:'9px',color:'rgba(255,255,255,0.3)',marginBottom:'3px'}}>{l}</div>
                  <div style={{fontFamily:"'Syne',sans-serif",fontWeight:800,fontSize:'14px',color:c,marginBottom:'2px'}}>{v}</div>
                  <div style={{display:'flex',justifyContent:'space-between',alignItems:'flex-end'}}>
                    <span style={{fontSize:'8px',color:'rgba(30,191,94,0.7)'}}>{ch}</span>
                    <MiniSpark data={sp} color={c} w={44} h={18}/>
                  </div>
                </div>
              ))}
            </div>
            {/* Chart area */}
            <div style={{flex:1,padding:'10px 12px',background:'rgba(255,255,255,0.02)',border:'1px solid rgba(255,255,255,0.05)',borderRadius:'8px'}}>
              <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',marginBottom:'8px'}}>
                <span style={{fontSize:'10px',fontWeight:600,color:'rgba(255,255,255,0.5)'}}>Messages Sent</span>
                <span style={{fontSize:'9px',color:'var(--green)',fontWeight:600}}>↑ 32% this week</span>
              </div>
              <div style={{display:'flex',alignItems:'flex-end',gap:'5px',height:'68px',marginBottom:'6px'}}>
                {bars.map((h2,i)=>(
                  <div key={i} style={{flex:1,height:`${h2}%`,borderRadius:'4px 4px 0 0',background:`linear-gradient(to top,rgba(30,191,94,${i===5?'0.8':'0.35'}),rgba(30,191,94,${i===5?'0.9':'0.55'}))`}}/>
                ))}
              </div>
              <div style={{display:'flex',gap:'5px'}}>
                {['M','T','W','T','F','S','S'].map((d,i)=><div key={i} style={{flex:1,fontSize:'8px',color:'rgba(255,255,255,0.2)',textAlign:'center'}}>{d}</div>)}
              </div>
            </div>
            {/* Bottom row */}
            <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:'6px'}}>
              {[
                {label:'WhatsApp',value:'+91 98765 43210',sub:'Quality: High',badge:'Connected',bc:'var(--green)',bb:'var(--gbd)',bbg:'var(--gbg)'},
                {label:'Campaigns',value:'Diwali Sale Active',sub:'12,421 sent',badge:'Live',bc:'#0EA5E9',bb:'rgba(14,165,233,0.25)',bbg:'rgba(14,165,233,0.08)'},
              ].map(it=>(
                <div key={it.label} style={{padding:'9px 10px',background:'rgba(255,255,255,0.025)',border:'1px solid rgba(255,255,255,0.06)',borderRadius:'7px'}}>
                  <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',marginBottom:'5px'}}>
                    <span style={{fontSize:'9px',color:'rgba(255,255,255,0.3)',textTransform:'uppercase',letterSpacing:'.06em'}}>{it.label}</span>
                    <span style={{fontSize:'8px',padding:'1px 6px',borderRadius:'20px',background:it.bbg,border:`1px solid ${it.bb}`,color:it.bc,fontWeight:700}}>{it.badge}</span>
                  </div>
                  <div style={{fontFamily:"'Syne',sans-serif",fontSize:'10px',fontWeight:700,color:'var(--t1)'}}>{it.value}</div>
                  <div style={{fontSize:'9px',color:'rgba(255,255,255,0.3)',marginTop:'1px'}}>{it.sub}</div>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

// ── Navbar ─────────────────────────────────────────────────────────────
const Navbar = ({ onNav }) => {
  const [scrolled, setScrolled] = useState(false);
  useEffect(() => {
    const fn = () => setScrolled(window.scrollY > 20);
    window.addEventListener('scroll', fn);
    return () => window.removeEventListener('scroll', fn);
  }, []);
  return (
    <nav style={{position:'fixed',top:0,left:0,right:0,zIndex:100,height:'62px',
      background:scrolled?'rgba(8,11,18,0.90)':'transparent',
      backdropFilter:scrolled?'blur(24px)':'none',
      borderBottom:scrolled?'1px solid var(--bd)':'1px solid transparent',
      transition:'all .25s ease',display:'flex',alignItems:'center'}}>
      <div style={{maxWidth:'1240px',width:'100%',margin:'0 auto',padding:'0 32px',display:'flex',alignItems:'center',justifyContent:'space-between'}}>
        <div onClick={()=>onNav('landing')} style={{display:'flex',alignItems:'center',gap:'9px',cursor:'pointer'}}>
          <div style={{width:'32px',height:'32px',borderRadius:'8px',background:'var(--green)',display:'flex',alignItems:'center',justifyContent:'center',boxShadow:'0 0 16px rgba(30,191,94,0.35)'}}>
            <svg width="14" height="14" viewBox="0 0 16 16" fill="none"><path d="M8 1C4.13 1 1 4.13 1 8c0 1.29.35 2.5.96 3.54L1 15l3.46-.96A7 7 0 1 0 8 1z" fill="#060913"/><path d="M5.5 7.5h5M5.5 10h3" stroke="#1EBF5E" strokeWidth="1.2" strokeLinecap="round"/></svg>
          </div>
          <span style={{fontFamily:"'Syne',sans-serif",fontWeight:700,fontSize:'16px',color:'var(--t1)',letterSpacing:'-.02em'}}>ChatFlow<span style={{color:'var(--green)'}}>Pro</span></span>
        </div>
        <div style={{display:'flex',gap:'32px'}}>
          {[['Features','#features'],['Use Cases','#usecases'],['Pricing','#pricing']].map(([l,h])=>(
            <a key={l} href={h} style={{color:'var(--t2)',fontSize:'14px',fontWeight:500,textDecoration:'none',transition:'color .15s'}}
              onMouseOver={e=>e.target.style.color='var(--t1)'} onMouseOut={e=>e.target.style.color='var(--t2)'}>{l}</a>
          ))}
        </div>
        <div style={{display:'flex',gap:'8px',alignItems:'center'}}>
          <Btn variant="ghost" size="sm" onClick={()=>onNav('login')}>Log in</Btn>
          <Btn variant="primary" size="sm" onClick={()=>onNav('dashboard')}>Get Started <I n="arrow" s={12} c="#060A10"/></Btn>
        </div>
      </div>
    </nav>
  );
};

// ── Hero — SPLIT LAYOUT ────────────────────────────────────────────────
const Hero = ({ onNav }) => (
  <section style={{
    minHeight:'100vh', paddingTop:'62px', display:'flex', alignItems:'center',
    position:'relative', overflow:'hidden',
    backgroundImage:`linear-gradient(rgba(255,255,255,0.028) 1px,transparent 1px),linear-gradient(90deg,rgba(255,255,255,0.028) 1px,transparent 1px)`,
    backgroundSize:'72px 72px',
  }}>
    {/* Gradient blobs */}
    <div style={{position:'absolute',top:0,left:'-10%',width:'55%',height:'100%',background:'radial-gradient(ellipse at 30% 50%,rgba(30,191,94,0.07) 0%,transparent 60%)',pointerEvents:'none'}}/>
    <div style={{position:'absolute',bottom:0,right:'-5%',width:'45%',height:'70%',background:'radial-gradient(ellipse at 70% 60%,rgba(14,165,233,0.05) 0%,transparent 60%)',pointerEvents:'none'}}/>

    <div style={{maxWidth:'1240px',width:'100%',margin:'0 auto',padding:'72px 32px',display:'grid',gridTemplateColumns:'1fr 1fr',gap:'72px',alignItems:'center'}}>
      {/* Text */}
      <div>
        <div className="fu0" style={{marginBottom:'28px',display:'inline-flex',alignItems:'center',gap:'8px',padding:'6px 14px',borderRadius:'100px',background:'var(--gbg)',border:'1px solid var(--gbd)'}}>
          <div style={{width:'6px',height:'6px',borderRadius:'50%',background:'var(--green)',animation:'pulse 2s ease infinite'}}/>
          <span style={{fontSize:'11.5px',fontWeight:600,color:'var(--green)',letterSpacing:'.02em'}}>Official Meta WhatsApp Business API Partner</span>
        </div>

        <h1 className="fu1" style={{fontSize:'clamp(48px,5.2vw,76px)',fontWeight:800,lineHeight:1.03,marginBottom:'22px',letterSpacing:'-.035em'}}>
          The WhatsApp<br/>Platform Built<br/>
          for <span style={{color:'var(--green)'}}>Revenue.</span>
        </h1>

        <p className="fu2" style={{fontSize:'17px',color:'var(--t2)',lineHeight:1.7,marginBottom:'36px',maxWidth:'440px'}}>
          Send campaigns, automate conversations, and track every rupee of ROI — with zero hidden markup and no per-agent fees.
        </p>

        <div className="fu3" style={{display:'flex',gap:'12px',marginBottom:'44px',flexWrap:'wrap'}}>
          <Btn size="lg" onClick={()=>onNav('dashboard')} style={{boxShadow:'var(--glow)'}}>
            Start for free <I n="arrow" s={14} c="#060A10"/>
          </Btn>
          <Btn size="lg" variant="ghost">
            <I n="play" s={14} c="var(--t2)"/> Watch 2-min demo
          </Btn>
        </div>

        {/* Stat pills */}
        <div className="fu4" style={{display:'flex',gap:'0',borderRadius:'12px',overflow:'hidden',border:'1px solid var(--bd)',width:'fit-content'}}>
          {[['50K+','msgs / day'],['99.9%','uptime'],['0%','hidden markup']].map(([v,l],i)=>(
            <div key={l} style={{padding:'14px 22px',background:'var(--surf)',boxShadow:'inset 0 1px 0 rgba(255,255,255,0.06)',borderRight:i<2?'1px solid var(--bd)':'none',display:'flex',flexDirection:'column',gap:'2px'}}>
              <span style={{fontFamily:"'Syne',sans-serif",fontWeight:800,fontSize:'20px',color:'var(--t1)',letterSpacing:'-.03em'}}>{v}</span>
              <span style={{fontSize:'11px',color:'var(--t2)',fontWeight:500}}>{l}</span>
            </div>
          ))}
        </div>
      </div>

      {/* Preview */}
      <HeroPreview/>
    </div>
  </section>
);

// ── Features ───────────────────────────────────────────────────────────
const card = { background:'var(--surf)', border:'1px solid var(--bd)', borderRadius:'var(--rl)', padding:'28px', boxShadow:'var(--card-shadow)', transition:'border-color .2s, transform .2s' };

const CampaignVisual = () => (
  <div style={{marginTop:'20px',background:'rgba(255,255,255,0.02)',borderRadius:'10px',border:'1px solid var(--bd)',padding:'14px'}}>
    <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',marginBottom:'12px'}}>
      <div><div style={{fontSize:'11px',color:'var(--t2)',marginBottom:'2px'}}>Diwali Sale 2026 · 12,400 recipients</div>
        <div style={{fontSize:'13px',fontWeight:600,color:'var(--t1)'}}>Campaign Active</div></div>
      <div style={{padding:'3px 9px',borderRadius:'20px',background:'var(--gbg)',border:'1px solid var(--gbd)',fontSize:'10px',color:'var(--green)',fontWeight:700}}>Live</div>
    </div>
    <div style={{display:'grid',gridTemplateColumns:'repeat(3,1fr)',gap:'6px',marginBottom:'12px'}}>
      {[['Sent','12,421','var(--t1)'],['Delivered','12,180','var(--green)'],['Read','8,943','#0EA5E9']].map(([l,v,c])=>(
        <div key={l} style={{padding:'8px',borderRadius:'8px',background:'rgba(255,255,255,0.03)',border:'1px solid var(--bd)'}}>
          <div style={{fontSize:'9px',color:'var(--t2)',textTransform:'uppercase',letterSpacing:'.06em',marginBottom:'3px'}}>{l}</div>
          <div style={{fontFamily:"'Syne',sans-serif",fontWeight:700,fontSize:'13px',color:c}}>{v}</div>
        </div>
      ))}
    </div>
    <div>
      <div style={{display:'flex',justifyContent:'space-between',fontSize:'10px',color:'var(--t2)',marginBottom:'4px'}}><span>Delivery</span><span style={{color:'var(--green)'}}>98.3%</span></div>
      <div style={{height:'4px',borderRadius:'4px',background:'rgba(255,255,255,0.06)'}}><div style={{height:'100%',width:'98.3%',borderRadius:'4px',background:'var(--green)'}}/></div>
    </div>
  </div>
);

const ChatVisual = () => (
  <div style={{marginTop:'18px',display:'flex',flexDirection:'column',gap:'7px'}}>
    {[{t:'What are your delivery charges?',o:false},{t:'Free delivery above ₹499! Your order qualifies.',o:true,ai:true},{t:'Is the blue hoodie in XL?',o:false}].map((m,i)=>(
      <div key={i} style={{display:'flex',justifyContent:m.o?'flex-end':'flex-start'}}>
        <div style={{maxWidth:'82%',padding:'8px 11px',borderRadius:m.o?'12px 12px 2px 12px':'12px 12px 12px 2px',background:m.o?'var(--gbg)':'rgba(255,255,255,0.04)',border:`1px solid ${m.o?'var(--gbd)':'var(--bd)'}`}}>
          {m.ai&&<div style={{fontSize:'8px',color:'var(--green)',fontWeight:700,textTransform:'uppercase',letterSpacing:'.07em',marginBottom:'3px'}}>AI Reply</div>}
          <p style={{fontSize:'11px',color:'var(--t1)',lineHeight:1.45}}>{m.t}</p>
        </div>
      </div>
    ))}
  </div>
);

const BarVis = () => {
  const d=[55,72,61,88,95,78,84];
  return (
    <div style={{marginTop:'18px'}}>
      <div style={{display:'flex',alignItems:'flex-end',gap:'5px',height:'72px',marginBottom:'6px'}}>
        {d.map((v,i)=><div key={i} style={{flex:1,height:`${v}%`,borderRadius:'4px 4px 0 0',background:`linear-gradient(to top,rgba(30,191,94,0.25),rgba(30,191,94,${i===4?'0.8':'0.55'}))`}}/>)}
      </div>
      <div style={{display:'flex',gap:'5px'}}>{['M','T','W','T','F','S','S'].map(d=><div key={d} style={{flex:1,fontSize:'9px',color:'var(--t3)',textAlign:'center'}}>{d}</div>)}</div>
      <div style={{marginTop:'8px',display:'flex',alignItems:'center',gap:'6px'}}>
        <div style={{width:'6px',height:'6px',borderRadius:'50%',background:'var(--green)'}}/>
        <span style={{fontSize:'10px',color:'var(--green)',fontWeight:600}}>↑ 32% revenue this week</span>
      </div>
    </div>
  );
};

const FlowVis = () => (
  <div style={{marginTop:'18px',display:'flex',flexDirection:'column',gap:'5px'}}>
    {[['Trigger','User sends message','var(--green)'],['Condition','During business hours?','#F59E0B'],['Action','Send welcome + menu','#0EA5E9']].map(([t,d,c],i)=>(
      <div key={t}>
        <div style={{padding:'9px 12px',borderRadius:'8px',background:'rgba(255,255,255,0.025)',border:'1px solid var(--bd)',display:'flex',alignItems:'center',gap:'9px'}}>
          <div style={{width:'8px',height:'8px',borderRadius:'50%',background:c,flexShrink:0}}/>
          <div><div style={{fontSize:'9px',color:c,fontWeight:700,textTransform:'uppercase',letterSpacing:'.06em'}}>{t}</div>
            <div style={{fontSize:'10px',color:'var(--t2)',marginTop:'1px'}}>{d}</div></div>
        </div>
        {i<2&&<div style={{width:'1px',height:'6px',background:'rgba(255,255,255,0.08)',margin:'0 19px'}}/>}
      </div>
    ))}
  </div>
);

const FCard = ({ span=2, icon, color='var(--green)', title, desc, visual }) => (
  <div style={{...card, gridColumn:`span ${span}`}}
    onMouseEnter={e=>{e.currentTarget.style.borderColor='var(--bdm)';e.currentTarget.style.transform='translateY(-2px)';}}
    onMouseLeave={e=>{e.currentTarget.style.borderColor='var(--bd)';e.currentTarget.style.transform='none';}}>
    <div style={{width:'36px',height:'36px',borderRadius:'9px',background:'rgba(255,255,255,0.045)',border:'1px solid var(--bd)',display:'flex',alignItems:'center',justifyContent:'center',marginBottom:'14px',boxShadow:'inset 0 1px 0 rgba(255,255,255,0.08)'}}>
      <I n={icon} s={17} c={color}/>
    </div>
    <h3 style={{fontSize:'15px',fontWeight:700,color:'var(--t1)',marginBottom:'7px',letterSpacing:'-.01em'}}>{title}</h3>
    <p style={{fontSize:'13px',color:'var(--t2)',lineHeight:1.65}}>{desc}</p>
    {visual}
  </div>
);

const Features = () => (
  <section id="features" style={{padding:'110px 0 80px'}}>
    <div style={{maxWidth:'1240px',margin:'0 auto',padding:'0 32px'}}>
      <div style={{textAlign:'center',marginBottom:'60px'}}>
        <div style={{fontSize:'11px',fontWeight:700,letterSpacing:'.14em',textTransform:'uppercase',color:'var(--green)',marginBottom:'14px'}}>Features</div>
        <h2 style={{fontSize:'clamp(30px,3.8vw,52px)',fontWeight:800,marginBottom:'16px',letterSpacing:'-.03em'}}>
          Everything competitors charge<br/>extra for — <span style={{color:'var(--green)'}}>included free</span>
        </h2>
        <p style={{fontSize:'16px',color:'var(--t2)',maxWidth:'500px',margin:'0 auto',lineHeight:1.7}}>No per-agent fees, no conversation markup, no hidden costs.</p>
      </div>
      <div style={{display:'grid',gridTemplateColumns:'repeat(6,1fr)',gap:'12px'}}>
        <FCard span={4} icon="send" title="Smart Campaigns" desc="One-time, ongoing, or API-triggered campaigns with A/B testing, retry logic, and full UTM tracking." visual={<CampaignVisual/>}/>
        <FCard span={2} icon="bot" color="#0EA5E9" title="AI Smart Replies" desc="Intent-based automation. AI copilot writes templates and suggests contextual responses." visual={<ChatVisual/>}/>
        <FCard span={2} icon="wflow" color="#F59E0B" title="Visual Flow Builder" desc="Drag-and-drop automation with triggers, conditions, and multi-step sequences." visual={<FlowVis/>}/>
        <FCard span={4} icon="chart" color="#A78BFA" title="Revenue Attribution" desc="Full-funnel conversion tracking with ROI dashboards — every campaign tied to actual revenue." visual={<BarVis/>}/>
        {[{icon:'msg',color:'#0EA5E9',title:'Team Inbox',desc:'Split-panel inbox with agent assignment, bot/human toggle, session timers, and internal notes.'},
          {icon:'globe',color:'#F59E0B',title:'60+ Integrations',desc:'Shopify, WooCommerce, Zapier, Google Sheets, HubSpot, Razorpay — plug and play.'},
          {icon:'brain',color:'#A78BFA',title:'AI Copilot',desc:'Generate template copy, optimize send times, and get campaign suggestions powered by AI.'},
        ].map(f=><FCard key={f.title} span={2} {...f}/>)}
      </div>
    </div>
  </section>
);

// ── Use Cases ──────────────────────────────────────────────────────────
const UseCases = () => {
  const cases=[
    {icon:'send',color:'#1EBF5E',title:'E-Commerce',metric:'3× conversion',desc:'Abandoned cart recovery, order updates, catalog sharing, and WhatsApp checkout.'},
    {icon:'users',color:'#0EA5E9',title:'Education',metric:'60% less work',desc:'Enrollment reminders, class updates, fee notifications, and student support bots.'},
    {icon:'phone',color:'#A78BFA',title:'Healthcare',metric:'89% satisfaction',desc:'Appointment booking, prescription reminders, lab reports, and follow-ups.'},
    {icon:'chart',color:'#F59E0B',title:'Real Estate',metric:'2× site visits',desc:'Property alerts, site visit scheduling, document sharing, and lead nurturing.'},
    {icon:'globe',color:'#1EBF5E',title:'Marketing Agencies',metric:'50+ clients',desc:'Multi-client management, campaign analytics, white-label solutions, bulk messaging.'},
    {icon:'zap',color:'#0EA5E9',title:'Travel & Tourism',metric:'75% faster',desc:'Booking confirmations, itinerary sharing, 24/7 FAQ bots, and feedback collection.'},
  ];
  return (
    <section id="usecases" style={{padding:'80px 0',borderTop:'1px solid var(--bd)',borderBottom:'1px solid var(--bd)',background:'var(--surf)'}}>
      <div style={{maxWidth:'1240px',margin:'0 auto',padding:'0 32px'}}>
        <div style={{textAlign:'center',marginBottom:'52px'}}>
          <div style={{fontSize:'11px',fontWeight:700,letterSpacing:'.14em',textTransform:'uppercase',color:'var(--green)',marginBottom:'14px'}}>Use Cases</div>
          <h2 style={{fontSize:'clamp(28px,3.5vw,48px)',fontWeight:800,marginBottom:'14px',letterSpacing:'-.03em'}}>Built for <span style={{color:'var(--green)'}}>every industry</span></h2>
          <p style={{fontSize:'15px',color:'var(--t2)',maxWidth:'460px',margin:'0 auto',lineHeight:1.65}}>From D2C brands to hospitals, ChatFlow Pro powers WhatsApp at scale.</p>
        </div>
        <div style={{display:'grid',gridTemplateColumns:'repeat(3,1fr)',gap:'12px'}}>
          {cases.map(c=>(
            <div key={c.title} style={{...card,padding:'22px'}}
              onMouseEnter={e=>{e.currentTarget.style.borderColor='var(--bdm)';e.currentTarget.style.transform='translateY(-2px)';}}
              onMouseLeave={e=>{e.currentTarget.style.borderColor='var(--bd)';e.currentTarget.style.transform='none';}}>
              <div style={{display:'flex',justifyContent:'space-between',alignItems:'flex-start',marginBottom:'14px'}}>
                <div style={{width:'34px',height:'34px',borderRadius:'8px',background:'rgba(255,255,255,0.04)',border:'1px solid var(--bd)',display:'flex',alignItems:'center',justifyContent:'center'}}>
                  <I n={c.icon} s={16} c={c.color}/>
                </div>
                <div style={{padding:'3px 9px',borderRadius:'20px',background:'rgba(255,255,255,0.04)',border:'1px solid var(--bd)',fontSize:'11px',color:'var(--t2)',fontWeight:600}}>{c.metric}</div>
              </div>
              <h3 style={{fontSize:'14px',fontWeight:700,color:'var(--t1)',marginBottom:'6px',letterSpacing:'-.01em'}}>{c.title}</h3>
              <p style={{fontSize:'13px',color:'var(--t2)',lineHeight:1.6}}>{c.desc}</p>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
};

// ── Pricing ────────────────────────────────────────────────────────────
const Pricing = ({ onNav }) => {
  const plans=[
    {name:'Starter',price:'₹799',per:'/mo',desc:'For small businesses getting started.',popular:false,
      features:['1 WhatsApp number','Up to 5 team members','1,000 conversations/mo','Basic chatbot builder','Team inbox','Template manager','Email support']},
    {name:'Growth',price:'₹2,499',per:'/mo',desc:'For growing teams needing full automation.',popular:true,
      features:['2 WhatsApp numbers','Unlimited team members','5,000 conversations/mo','AI Smart Replies & Copilot','Campaign A/B testing','Visual flow builder','Revenue attribution','RCS fallback','Priority support']},
    {name:'Enterprise',price:'Custom',per:'',desc:'For large teams with complex requirements.',popular:false,
      features:['Unlimited numbers & team','Custom conversation volume','Custom AI model training','Dedicated account manager','SSO & audit logs','Custom integrations','SLA guarantee']},
  ];
  return (
    <section id="pricing" style={{padding:'110px 0'}}>
      <div style={{maxWidth:'1240px',margin:'0 auto',padding:'0 32px'}}>
        <div style={{textAlign:'center',marginBottom:'60px'}}>
          <div style={{fontSize:'11px',fontWeight:700,letterSpacing:'.14em',textTransform:'uppercase',color:'var(--green)',marginBottom:'14px'}}>Pricing</div>
          <h2 style={{fontSize:'clamp(28px,3.8vw,52px)',fontWeight:800,marginBottom:'14px',letterSpacing:'-.03em'}}>
            Transparent pricing.<br/><span style={{color:'var(--green)'}}>Zero hidden costs.</span>
          </h2>
          <p style={{fontSize:'16px',color:'var(--t2)',maxWidth:'480px',margin:'0 auto',lineHeight:1.7}}>
            Unlike Wati's 20% markup, we pass through Meta's pricing at cost.
          </p>
        </div>
        <div style={{display:'grid',gridTemplateColumns:'repeat(3,1fr)',gap:'16px',maxWidth:'980px',margin:'0 auto'}}>
          {plans.map(p=>(
            <div key={p.name} style={{
              padding:'32px', borderRadius:'var(--rxl)', position:'relative',
              background:p.popular?'linear-gradient(155deg,rgba(30,191,94,0.07),rgba(14,165,233,0.04))':'var(--surf)',
              border:p.popular?'1px solid var(--gbd)':'1px solid var(--bd)',
              boxShadow:p.popular?`var(--glow), var(--card-shadow)`:'var(--card-shadow)',
            }}>
              {p.popular&&<div style={{position:'absolute',top:'-13px',left:'50%',transform:'translateX(-50%)',padding:'4px 14px',borderRadius:'20px',background:'var(--green)',fontSize:'11px',fontWeight:700,color:'#060913',whiteSpace:'nowrap',boxShadow:'0 4px 16px rgba(30,191,94,0.3)'}}>Most Popular</div>}
              <h3 style={{fontWeight:700,fontSize:'18px',color:'var(--t1)',marginBottom:'6px',letterSpacing:'-.02em'}}>{p.name}</h3>
              <p style={{fontSize:'13px',color:'var(--t2)',marginBottom:'22px',lineHeight:1.55}}>{p.desc}</p>
              <div style={{marginBottom:'24px',display:'flex',alignItems:'baseline',gap:'3px'}}>
                <span style={{fontFamily:"'Syne',sans-serif",fontWeight:800,fontSize:'42px',color:'var(--t1)',letterSpacing:'-.04em'}}>{p.price}</span>
                <span style={{fontSize:'13px',color:'var(--t2)'}}>{p.per}</span>
              </div>
              <ul style={{listStyle:'none',display:'flex',flexDirection:'column',gap:'10px',marginBottom:'28px'}}>
                {p.features.map(f=>(
                  <li key={f} style={{display:'flex',alignItems:'flex-start',gap:'9px',fontSize:'13px',color:'var(--t2)'}}>
                    <I n="check" s={14} c="var(--green)" w={2.2}/> {f}
                  </li>
                ))}
              </ul>
              <Btn variant={p.popular?'primary':'ghost'} style={{width:'100%',justifyContent:'center',boxShadow:p.popular?'var(--glow)':undefined}} onClick={()=>onNav('dashboard')}>
                {p.name==='Enterprise'?'Talk to Sales':'Start Free Trial'} <I n="arrow" s={13} c={p.popular?'#060A10':'var(--t2)'}/>
              </Btn>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
};

// ── CTA ─────────────────────────────────────────────────────────────────
const CTA = ({ onNav }) => (
  <section style={{padding:'110px 32px',textAlign:'center',position:'relative',overflow:'hidden',borderTop:'1px solid var(--bd)'}}>
    <div style={{position:'absolute',top:'50%',left:'50%',transform:'translate(-50%,-50%)',width:'700px',height:'500px',background:'radial-gradient(ellipse,rgba(30,191,94,0.07) 0%,transparent 60%)',pointerEvents:'none'}}/>
    <div style={{position:'relative',maxWidth:'680px',margin:'0 auto'}}>
      <div style={{fontSize:'11px',fontWeight:700,letterSpacing:'.14em',textTransform:'uppercase',color:'var(--green)',marginBottom:'18px'}}>Get Started Today</div>
      <h2 style={{fontSize:'clamp(30px,4vw,58px)',fontWeight:800,marginBottom:'18px',letterSpacing:'-.03em',lineHeight:1.08}}>
        Ready to stop overpaying<br/>for WhatsApp API?
      </h2>
      <p style={{fontSize:'17px',color:'var(--t2)',marginBottom:'36px',lineHeight:1.7,maxWidth:'500px',margin:'0 auto 36px'}}>
        Join thousands of businesses that switched to get better features at a fraction of the cost.
      </p>
      <Btn size="lg" onClick={()=>onNav('dashboard')} style={{boxShadow:'var(--glow)'}}>
        Start Your Free Trial <I n="arrow" s={14} c="#060A10"/>
      </Btn>
      <p style={{marginTop:'16px',fontSize:'12px',color:'var(--t3)'}}>14-day free trial · No credit card required · Setup in 5 minutes</p>
    </div>
  </section>
);

// ── Footer ─────────────────────────────────────────────────────────────
const Footer = ({ onNav }) => (
  <footer style={{borderTop:'1px solid var(--bd)',padding:'60px 32px 32px',background:'var(--surf)'}}>
    <div style={{maxWidth:'1240px',margin:'0 auto'}}>
      <div style={{display:'grid',gridTemplateColumns:'1.6fr 1fr 1fr 1fr',gap:'40px',marginBottom:'48px'}}>
        <div>
          <div onClick={()=>onNav('landing')} style={{display:'inline-flex',alignItems:'center',gap:'9px',cursor:'pointer',marginBottom:'14px'}}>
            <div style={{width:'28px',height:'28px',borderRadius:'7px',background:'var(--green)',display:'flex',alignItems:'center',justifyContent:'center'}}>
              <svg width="12" height="12" viewBox="0 0 16 16" fill="none"><path d="M8 1C4.13 1 1 4.13 1 8c0 1.29.35 2.5.96 3.54L1 15l3.46-.96A7 7 0 1 0 8 1z" fill="#060913"/></svg>
            </div>
            <span style={{fontFamily:"'Syne',sans-serif",fontWeight:700,fontSize:'15px',color:'var(--t1)'}}>ChatFlow<span style={{color:'var(--green)'}}>Pro</span></span>
          </div>
          <p style={{fontSize:'13px',color:'var(--t2)',lineHeight:1.65,maxWidth:'220px'}}>WhatsApp Business API platform built for revenue, not hidden fees.</p>
        </div>
        {[{title:'Product',links:['Features','Pricing','Integrations','API Docs','Changelog']},
          {title:'Solutions',links:['E-commerce','Education','Healthcare','Real Estate','Agencies']},
          {title:'Company',links:['About','Blog','Careers','Contact','Privacy Policy']},
        ].map(col=>(
          <div key={col.title}>
            <h4 style={{fontFamily:"'Syne',sans-serif",fontWeight:700,fontSize:'12px',color:'var(--t1)',marginBottom:'16px',textTransform:'uppercase',letterSpacing:'.08em'}}>{col.title}</h4>
            <ul style={{listStyle:'none',display:'flex',flexDirection:'column',gap:'10px'}}>
              {col.links.map(l=><li key={l}><a href="#" style={{fontSize:'13px',color:'var(--t2)',textDecoration:'none',transition:'color .15s'}} onMouseOver={e=>e.target.style.color='var(--t1)'} onMouseOut={e=>e.target.style.color='var(--t2)'}>{l}</a></li>)}
            </ul>
          </div>
        ))}
      </div>
      <div style={{borderTop:'1px solid var(--bd)',paddingTop:'24px',display:'flex',justifyContent:'space-between',alignItems:'center',flexWrap:'wrap',gap:'12px'}}>
        <p style={{fontSize:'12px',color:'var(--t3)'}}>© 2026 ChatFlow Pro. All rights reserved. Official Meta WhatsApp Business API Partner.</p>
        <div style={{display:'flex',gap:'20px'}}>{['Terms','Privacy','Security'].map(l=><a key={l} href="#" style={{fontSize:'12px',color:'var(--t3)',textDecoration:'none'}}>{l}</a>)}</div>
      </div>
    </div>
  </footer>
);

// ── LandingPage ────────────────────────────────────────────────────────
const LandingPage = ({ onNav }) => (
  <div style={{minHeight:'100vh'}}>
    <Navbar onNav={onNav}/>
    <Hero onNav={onNav}/>
    <Features/>
    <UseCases/>
    <Pricing onNav={onNav}/>
    <CTA onNav={onNav}/>
    <Footer onNav={onNav}/>
  </div>
);

Object.assign(window, { LandingPage, I, Btn });
