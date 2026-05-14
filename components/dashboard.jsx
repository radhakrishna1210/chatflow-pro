const { useState, useRef, useEffect } = React;
const I   = window.I;
const Btn = window.Btn;

// ── Shared ─────────────────────────────────────────────────────────────
const card = { background:'var(--surf)', border:'1px solid var(--bd)', borderRadius:'var(--rl)', boxShadow:'var(--card-shadow)' };

const StatusBadge = ({ s }) => {
  const cfg = {
    Active:   {bg:'var(--gbg)',           bd:'var(--gbd)',                   c:'var(--green)'},
    Approved: {bg:'var(--gbg)',           bd:'var(--gbd)',                   c:'var(--green)'},
    Completed:{bg:'rgba(99,102,241,.1)',  bd:'rgba(99,102,241,.25)',         c:'#818cf8'},
    Draft:    {bg:'rgba(255,255,255,.04)',bd:'var(--bd)',                    c:'var(--t2)'},
    Pending:  {bg:'rgba(245,158,11,.1)', bd:'rgba(245,158,11,.25)',         c:'#fbbf24'},
    urgent:   {bg:'rgba(239,68,68,.08)', bd:'rgba(239,68,68,.22)',          c:'#f87171'},
    resolved: {bg:'var(--gbg)',           bd:'var(--gbd)',                   c:'var(--green)'},
    billing:  {bg:'rgba(245,158,11,.08)',bd:'rgba(245,158,11,.22)',         c:'#fbbf24'},
  };
  const v = cfg[s]||cfg.Draft;
  return <span style={{padding:'3px 9px',borderRadius:'20px',fontSize:'11px',fontWeight:600,background:v.bg,border:`1px solid ${v.bd}`,color:v.c,display:'inline-block'}}>{s}</span>;
};

const Avatar = ({ name='?', size=34, showRing=false }) => {
  const init = name.split(' ').map(n=>n[0]).join('').slice(0,2).toUpperCase();
  const colors = ['#1EBF5E','#0EA5E9','#A78BFA','#F59E0B','#F472B6'];
  const col = colors[init.charCodeAt(0)%colors.length];
  return (
    <div style={{width:size,height:size,borderRadius:'50%',background:`${col}18`,
      border:`1.5px solid ${showRing?col:col+'44'}`,display:'flex',alignItems:'center',
      justifyContent:'center',fontSize:size*.33+'px',fontWeight:700,color:col,flexShrink:0}}>
      {init}
    </div>
  );
};

// ── Sparkline ──────────────────────────────────────────────────────────
const Spark = ({ data, color='var(--green)', id='s', width=80, height=30 }) => {
  const max=Math.max(...data), min=Math.min(...data), range=(max-min)||1;
  const pts = data.map((v,i)=>{
    const x=(i/(data.length-1)*width).toFixed(1);
    const y=(height-((v-min)/range)*height*.75-height*.1).toFixed(1);
    return `${x},${y}`;
  }).join(' ');
  const area = `0,${height} ${pts} ${width},${height}`;
  const gid = `sg-${id}`;
  return (
    <svg width={width} height={height} viewBox={`0 0 ${width} ${height}`} style={{overflow:'visible',display:'block'}}>
      <defs>
        <linearGradient id={gid} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor={color} stopOpacity="0.28"/>
          <stop offset="100%" stopColor={color} stopOpacity="0"/>
        </linearGradient>
      </defs>
      <polygon points={area} fill={`url(#${gid})`}/>
      <polyline points={pts} fill="none" stroke={color} strokeWidth="1.75" strokeLinejoin="round" strokeLinecap="round"/>
    </svg>
  );
};

// ── Line chart for activity ────────────────────────────────────────────
const ActivityChart = ({ data, labels, color='var(--green)' }) => {
  const W=600,H=100;
  const max=Math.max(...data), min=Math.min(...data), range=(max-min)||1;
  const pts = data.map((v,i)=>{
    const x=(i/(data.length-1)*W).toFixed(1);
    const y=(H-((v-min)/range)*H*.78-H*.1).toFixed(1);
    return `${x},${y}`;
  }).join(' ');
  return (
    <div>
      <svg width="100%" height={H} viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" style={{display:'block'}}>
        <defs>
          <linearGradient id="acg" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={color} stopOpacity="0.18"/>
            <stop offset="100%" stopColor={color} stopOpacity="0"/>
          </linearGradient>
        </defs>
        <polygon points={`0,${H} ${pts} ${W},${H}`} fill="url(#acg)"/>
        <polyline points={pts} fill="none" stroke={color} strokeWidth="2" strokeLinejoin="round" strokeLinecap="round"/>
        {/* Dot on last point */}
        {pts.split(' ').slice(-1).map(p => {
          const [x,y] = p.split(',');
          return <circle key="dot" cx={x} cy={y} r="4" fill={color} stroke="var(--surf)" strokeWidth="2"/>;
        })}
      </svg>
      <div style={{display:'grid',gridTemplateColumns:`repeat(${labels.length},1fr)`,gap:'0',marginTop:'8px'}}>
        {labels.map(l=><div key={l} style={{fontSize:'11px',color:'var(--t3)',textAlign:'center'}}>{l}</div>)}
      </div>
    </div>
  );
};

// ── Mock data ──────────────────────────────────────────────────────────
const CONVS=[
  {id:1,name:'Priya Sharma', phone:'+91 98001 11234',last:'Is my order shipped?',     time:'10:32',unread:2,label:'urgent'},
  {id:2,name:'Rahul Mehta',  phone:'+91 97002 22345',last:'Thanks! Got the invoice.',  time:'09:58',unread:0,label:'resolved'},
  {id:3,name:'Ananya Iyer',  phone:'+91 96003 33456',last:'When does the offer end?', time:'09:12',unread:1,label:''},
  {id:4,name:'Karan Patel',  phone:'+91 95004 44567',last:'Please send catalogue',    time:'Yesterday',unread:0,label:''},
  {id:5,name:'Sneha Gupta',  phone:'+91 94005 55678',last:'Got it, thanks!',           time:'Yesterday',unread:0,label:'billing'},
];
const MSGS={
  1:[{id:1,dir:'IN',body:'Hi! I placed an order yesterday. Is it shipped?',time:'10:28'},
     {id:2,dir:'OUT',body:'Hello Priya! Let me check that for you right away.',time:'10:30',sender:'You'},
     {id:3,dir:'IN',body:'Order ID is #CFP-7821.',time:'10:31'},
     {id:4,dir:'IN',body:'Is my order shipped?',time:'10:32'}],
  2:[{id:1,dir:'OUT',body:'Hi Rahul! Your invoice is attached.',time:'09:50',sender:'You'},
     {id:2,dir:'IN',body:'Thanks! Got the invoice.',time:'09:58'}],
  3:[{id:1,dir:'IN',body:'Hi, I wanted to ask about your Diwali offer.',time:'09:10'},
     {id:2,dir:'OUT',body:'Our Diwali Sale runs till Oct 31 — 30% off all plans!',time:'09:11',sender:'AI'},
     {id:3,dir:'IN',body:'When does the offer end?',time:'09:12'}],
};
const CAMPAIGNS=[
  {id:1,name:'Diwali Sale 2026',     status:'Active',   sent:12421,delivered:12180,read:8943, rate:98.1,date:'Oct 18'},
  {id:2,name:'Re-engagement Oct',    status:'Completed',sent:5800, delivered:5620, read:3210, rate:96.9,date:'Oct 12'},
  {id:3,name:'New Catalogue Drop',   status:'Draft',    sent:0,    delivered:0,    read:0,    rate:0,   date:'Oct 20'},
  {id:4,name:'Abandoned Cart #14',   status:'Active',   sent:2340, delivered:2290, read:1870, rate:97.9,date:'Oct 17'},
];
const TEMPLATES=[
  {id:1,name:'Order Confirmation',  cat:'Transactional',status:'Approved',preview:'Your order #{{1}} has been confirmed! Delivery by {{2}}.'},
  {id:2,name:'Abandoned Cart Alert',cat:'Marketing',    status:'Approved',preview:"Hey {{1}}, you left something behind! Get 10% off with SAVE10."},
  {id:3,name:'Appointment Reminder',cat:'Utility',      status:'Approved',preview:'Hi {{1}}, your appointment on {{2}} at {{3}} is confirmed.'},
  {id:4,name:'Diwali Offer',        cat:'Marketing',    status:'Pending', preview:'Celebrate Diwali with up to 30% off! Shop now: {{1}}'},
  {id:5,name:'OTP Verification',    cat:'Authentication',status:'Approved',preview:'Your verification code is {{1}}. Valid for 10 minutes.'},
  {id:6,name:'Delivery Update',     cat:'Transactional',status:'Approved',preview:'Great news {{1}}! Order #{{2}} has shipped. Arrives by {{3}}.'},
];

// ── Dashboard Header ───────────────────────────────────────────────────
const DashHeader = ({ title, subtitle }) => (
  <div style={{height:'58px',borderBottom:'1px solid var(--bd)',display:'flex',alignItems:'center',padding:'0 28px',gap:'16px',flexShrink:0,background:'var(--surf)'}}>
    <div style={{flex:1}}>
      <h1 style={{fontFamily:"'Syne',sans-serif",fontWeight:800,fontSize:'16px',color:'var(--t1)',letterSpacing:'-.02em'}}>{title}</h1>
      {subtitle&&<p style={{fontSize:'11.5px',color:'var(--t2)',marginTop:'1px'}}>{subtitle}</p>}
    </div>
    <div style={{display:'flex',alignItems:'center',gap:'8px'}}>
      {/* Search */}
      <div style={{display:'flex',alignItems:'center',gap:'7px',padding:'7px 12px',borderRadius:'8px',background:'rgba(255,255,255,0.04)',border:'1px solid var(--bd)',width:'200px'}}>
        <I n="search" s={13} c="var(--t2)"/>
        <span style={{fontSize:'13px',color:'var(--t3)'}}>Search…</span>
      </div>
      {/* Bell */}
      <div style={{position:'relative',width:'34px',height:'34px',borderRadius:'8px',background:'rgba(255,255,255,0.04)',border:'1px solid var(--bd)',display:'flex',alignItems:'center',justifyContent:'center',cursor:'pointer'}}>
        <I n="bell" s={15} c="var(--t2)"/>
        <div style={{position:'absolute',top:'7px',right:'7px',width:'6px',height:'6px',borderRadius:'50%',background:'var(--green)',border:'1.5px solid var(--surf)'}}/>
      </div>
      {/* Avatar */}
      <Avatar name="Admin User" size={34} showRing/>
    </div>
  </div>
);

// ── Home View ──────────────────────────────────────────────────────────
const HomeView = () => {
  const wkData=[42,58,46,70,65,88,82];
  const wkLabels=['Mon','Tue','Wed','Thu','Fri','Sat','Sun'];
  const stats=[
    {icon:'msg',  label:'Total Messages', value:'50,241',change:'+12%', color:'var(--green)', spark:[38,42,45,55,49,62,58,70,66,82],id:'msg'},
    {icon:'users',label:'Active Contacts',value:'12,400',change:'+8%',  color:'#0EA5E9',     spark:[28,32,35,40,38,48,44,55,52,62],id:'ct'},
    {icon:'send', label:'Campaigns',      value:'24',    change:'+3',   color:'#A78BFA',     spark:[8,10,10,14,12,18,16,20,20,24],id:'cp'},
    {icon:'chart',label:'Delivery Rate',  value:'98.7%', change:'↑0.4%',color:'#F59E0B',     spark:[96,97,96,98,97,99,98,99,98,99],id:'dr'},
  ];
  return (
    <div style={{flex:1,overflowY:'auto'}}>
      <DashHeader title="Dashboard" subtitle="May 9, 2026 — Good morning!"/>
      <div style={{padding:'24px 28px',display:'flex',flexDirection:'column',gap:'18px'}}>

        {/* Upgrade banner */}
        <div style={{borderRadius:'var(--rl)',background:'linear-gradient(135deg,rgba(30,191,94,0.1),rgba(14,165,233,0.06))',border:'1px solid var(--gbd)',padding:'16px 20px',display:'flex',alignItems:'center',justifyContent:'space-between',gap:'16px',boxShadow:'inset 0 1px 0 rgba(255,255,255,0.06)'}}>
          <div style={{display:'flex',alignItems:'center',gap:'12px'}}>
            <div style={{width:'36px',height:'36px',borderRadius:'9px',background:'var(--gbg)',border:'1px solid var(--gbd)',display:'flex',alignItems:'center',justifyContent:'center'}}>
              <I n="spark" s={18} c="var(--green)"/>
            </div>
            <div>
              <p style={{fontFamily:"'Syne',sans-serif",fontWeight:700,fontSize:'14px',color:'var(--t1)',marginBottom:'2px'}}>Unlock AI Smart Replies &amp; A/B Testing</p>
              <p style={{fontSize:'12px',color:'var(--t2)'}}>Upgrade to Growth plan for advanced features.</p>
            </div>
          </div>
          <Btn size="sm" style={{flexShrink:0}}>Upgrade Plan</Btn>
        </div>

        {/* Stats grid */}
        <div style={{display:'grid',gridTemplateColumns:'repeat(4,1fr)',gap:'12px'}}>
          {stats.map(s=>(
            <div key={s.label} style={{...card,padding:'20px'}}>
              <div style={{display:'flex',justifyContent:'space-between',alignItems:'flex-start',marginBottom:'14px'}}>
                <div style={{width:'34px',height:'34px',borderRadius:'8px',background:'rgba(255,255,255,0.04)',border:'1px solid var(--bd)',display:'flex',alignItems:'center',justifyContent:'center'}}>
                  <I n={s.icon} s={15} c={s.color}/>
                </div>
                <span style={{fontSize:'11px',fontWeight:700,color:'var(--green)',padding:'2px 7px',borderRadius:'6px',background:'var(--gbg)'}}>{s.change}</span>
              </div>
              <div style={{fontFamily:"'Syne',sans-serif",fontWeight:800,fontSize:'28px',color:'var(--t1)',marginBottom:'2px',letterSpacing:'-.03em'}}>{s.value}</div>
              <div style={{fontSize:'12px',color:'var(--t2)',marginBottom:'12px'}}>{s.label}</div>
              <Spark data={s.spark} color={s.color} id={s.id} width={120} height={32}/>
            </div>
          ))}
        </div>

        {/* Activity chart */}
        <div style={{...card,padding:'24px'}}>
          <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',marginBottom:'20px'}}>
            <div>
              <h3 style={{fontFamily:"'Syne',sans-serif",fontWeight:700,fontSize:'15px',color:'var(--t1)',marginBottom:'3px'}}>Messages Sent</h3>
              <p style={{fontSize:'12px',color:'var(--t2)'}}>Last 7 days performance</p>
            </div>
            <div style={{display:'flex',alignItems:'center',gap:'8px'}}>
              <div style={{fontSize:'11px',color:'var(--green)',fontWeight:700,padding:'4px 10px',borderRadius:'6px',background:'var(--gbg)',border:'1px solid var(--gbd)'}}>↑ 32% this week</div>
            </div>
          </div>
          <ActivityChart data={wkData} labels={wkLabels}/>
        </div>

        {/* Status cards */}
        <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:'12px'}}>
          <div style={{...card,padding:'20px'}}>
            <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',marginBottom:'16px'}}>
              <span style={{fontSize:'11px',fontWeight:700,color:'var(--t2)',textTransform:'uppercase',letterSpacing:'.08em'}}>WhatsApp Number</span>
              <StatusBadge s="Approved"/>
            </div>
            <div style={{display:'flex',alignItems:'center',gap:'12px'}}>
              <div style={{width:'44px',height:'44px',borderRadius:'11px',background:'var(--gbg)',border:'1px solid var(--gbd)',display:'flex',alignItems:'center',justifyContent:'center'}}>
                <I n="phone" s={20} c="var(--green)"/>
              </div>
              <div>
                <p style={{fontFamily:"'Syne',sans-serif",fontWeight:700,fontSize:'15px',color:'var(--t1)',marginBottom:'2px'}}>+91 98765 43210</p>
                <p style={{fontSize:'12px',color:'var(--t2)'}}>Quality: High · ChatFlow Pro Business</p>
              </div>
            </div>
          </div>
          <div style={{...card,padding:'20px'}}>
            <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',marginBottom:'16px'}}>
              <span style={{fontSize:'11px',fontWeight:700,color:'var(--t2)',textTransform:'uppercase',letterSpacing:'.08em'}}>Instagram</span>
              <span style={{padding:'3px 9px',borderRadius:'20px',fontSize:'11px',fontWeight:600,background:'rgba(255,255,255,0.04)',border:'1px solid var(--bd)',color:'var(--t2)'}}>Coming Soon</span>
            </div>
            <div style={{display:'flex',alignItems:'center',gap:'12px'}}>
              <div style={{width:'44px',height:'44px',borderRadius:'11px',background:'rgba(255,255,255,0.04)',border:'1px solid var(--bd)',display:'flex',alignItems:'center',justifyContent:'center'}}>
                <I n="insta" s={20} c="var(--t2)"/>
              </div>
              <div>
                <p style={{fontFamily:"'Syne',sans-serif",fontWeight:700,fontSize:'15px',color:'var(--t1)',marginBottom:'2px'}}>Connect Account</p>
                <p style={{fontSize:'12px',color:'var(--t2)'}}>Link your Instagram business account</p>
              </div>
            </div>
          </div>
        </div>

        {/* Quick actions */}
        <div style={{display:'flex',gap:'10px',flexWrap:'wrap'}}>
          <Btn style={{boxShadow:'var(--glow)'}}><I n="users" s={14} c="#060A10"/> Add Customers</Btn>
          <Btn variant="ghost"><I n="file" s={14} c="var(--t2)"/> Create Template</Btn>
          <Btn variant="ghost"><I n="send" s={14} c="var(--t2)"/> Launch Campaign</Btn>
        </div>
      </div>
    </div>
  );
};

// ── Inbox View ─────────────────────────────────────────────────────────
const InboxView = () => {
  const [active,setActive]=useState(1);
  const [input,setInput]=useState('');
  const [msgs,setMsgs]=useState(MSGS);
  const [isBot,setIsBot]=useState(false);
  const scrollRef=useRef(null);
  useEffect(()=>{ if(scrollRef.current) scrollRef.current.scrollTop=scrollRef.current.scrollHeight; },[active,msgs]);

  const send=()=>{
    if(!input.trim()) return;
    const m={id:Date.now(),dir:'OUT',body:input.trim(),time:new Date().toLocaleTimeString([],{hour:'2-digit',minute:'2-digit'}),sender:isBot?'AI':'You'};
    setMsgs(prev=>({...prev,[active]:[...(prev[active]||[]),m]}));
    setInput('');
  };
  const conv=CONVS.find(c=>c.id===active);
  const activeMsgs=msgs[active]||[];

  return (
    <div style={{display:'flex',flexDirection:'column',flex:1,overflow:'hidden'}}>
      <DashHeader title="Inbox" subtitle="Manage customer conversations"/>
      <div style={{display:'flex',flex:1,overflow:'hidden'}}>
        {/* List */}
        <div style={{width:'288px',borderRight:'1px solid var(--bd)',display:'flex',flexDirection:'column',flexShrink:0,background:'var(--surf)'}}>
          <div style={{padding:'12px 14px',borderBottom:'1px solid var(--bd)'}}>
            <div style={{display:'flex',alignItems:'center',gap:'7px',padding:'8px 12px',borderRadius:'8px',background:'rgba(255,255,255,0.03)',border:'1px solid var(--bd)'}}>
              <I n="search" s={13} c="var(--t2)"/>
              <input placeholder="Search…" style={{background:'none',border:'none',outline:'none',color:'var(--t1)',fontSize:'13px',fontFamily:"'Plus Jakarta Sans',sans-serif",flex:1,width:0}}/>
            </div>
          </div>
          <div style={{flex:1,overflowY:'auto'}}>
            {CONVS.map(c=>(
              <div key={c.id} onClick={()=>setActive(c.id)}
                style={{padding:'12px 14px',borderBottom:'1px solid var(--bd)',cursor:'pointer',transition:'background .12s',
                  borderLeft:active===c.id?'2px solid var(--green)':'2px solid transparent',
                  background:active===c.id?'rgba(30,191,94,0.06)':'transparent'}}
                onMouseEnter={e=>{if(active!==c.id)e.currentTarget.style.background='rgba(255,255,255,0.02)';}}
                onMouseLeave={e=>{if(active!==c.id)e.currentTarget.style.background='transparent';}}>
                <div style={{display:'flex',gap:'10px',alignItems:'flex-start'}}>
                  <Avatar name={c.name} size={36}/>
                  <div style={{flex:1,minWidth:0}}>
                    <div style={{display:'flex',justifyContent:'space-between',marginBottom:'3px'}}>
                      <span style={{fontSize:'13px',fontWeight:600,color:'var(--t1)'}}>{c.name}</span>
                      <span style={{fontSize:'10px',color:'var(--t2)'}}>{c.time}</span>
                    </div>
                    <p style={{fontSize:'12px',color:'var(--t2)',whiteSpace:'nowrap',overflow:'hidden',textOverflow:'ellipsis',marginBottom:'5px'}}>{c.last}</p>
                    <div style={{display:'flex',gap:'5px'}}>
                      {c.label&&<StatusBadge s={c.label}/>}
                      {c.unread>0&&<span style={{padding:'1px 7px',borderRadius:'20px',fontSize:'10px',fontWeight:700,background:'var(--green)',color:'#060913'}}>{c.unread}</span>}
                    </div>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* Chat */}
        <div style={{flex:1,display:'flex',flexDirection:'column',overflow:'hidden'}}>
          {conv&&<>
            {/* Header */}
            <div style={{padding:'12px 20px',borderBottom:'1px solid var(--bd)',display:'flex',alignItems:'center',justifyContent:'space-between',background:'var(--surf)',flexShrink:0}}>
              <div style={{display:'flex',alignItems:'center',gap:'10px'}}>
                <Avatar name={conv.name} size={36}/>
                <div>
                  <p style={{fontFamily:"'Syne',sans-serif",fontWeight:700,fontSize:'14px',color:'var(--t1)'}}>{conv.name}</p>
                  <p style={{fontSize:'11px',color:'var(--t2)'}}>{conv.phone}</p>
                </div>
              </div>
              <div style={{display:'flex',alignItems:'center',gap:'12px'}}>
                <div style={{display:'flex',alignItems:'center',gap:'7px'}}>
                  <I n="bot" s={14} c={isBot?'var(--green)':'var(--t2)'}/>
                  <div onClick={()=>setIsBot(!isBot)} style={{width:'38px',height:'21px',borderRadius:'20px',background:isBot?'var(--green)':'rgba(255,255,255,0.1)',cursor:'pointer',transition:'background .2s',position:'relative',border:'1px solid var(--bd)'}}>
                    <div style={{position:'absolute',top:'2px',left:isBot?'19px':'2px',width:'15px',height:'15px',borderRadius:'50%',background:'white',transition:'left .2s',boxShadow:'0 1px 4px rgba(0,0,0,0.4)'}}/>
                  </div>
                  <span style={{fontSize:'11px',color:'var(--t2)'}}>{isBot?'Bot':'Human'}</span>
                </div>
                <select style={{padding:'6px 10px',borderRadius:'7px',background:'rgba(255,255,255,0.04)',border:'1px solid var(--bd)',color:'var(--t2)',fontSize:'12px',fontFamily:"'Plus Jakarta Sans',sans-serif",outline:'none'}}>
                  <option>Unassigned</option><option>Agent 1</option><option>Agent 2</option>
                </select>
              </div>
            </div>
            {/* Messages */}
            <div ref={scrollRef} style={{flex:1,overflowY:'auto',padding:'20px',display:'flex',flexDirection:'column',gap:'10px',background:'rgba(5,8,18,0.6)'}}>
              {activeMsgs.map(m=>{
                const out=m.dir==='OUT';
                return (
                  <div key={m.id} style={{display:'flex',justifyContent:out?'flex-end':'flex-start',alignItems:'flex-end',gap:'8px'}}>
                    {!out&&<Avatar name={conv.name} size={26}/>}
                    <div style={{maxWidth:'66%',padding:'10px 14px',borderRadius:out?'14px 14px 3px 14px':'14px 14px 14px 3px',
                      background:out?'var(--gbg)':'var(--surf)',
                      border:`1px solid ${out?'var(--gbd)':'var(--bd)'}`,
                      boxShadow:'var(--card-shadow)'}}>
                      {out&&m.sender&&<div style={{fontSize:'9px',color:m.sender==='AI'?'var(--green)':'var(--t2)',fontWeight:700,textTransform:'uppercase',letterSpacing:'.07em',marginBottom:'4px'}}>{m.sender}</div>}
                      <p style={{fontSize:'13px',color:'var(--t1)',lineHeight:1.5}}>{m.body}</p>
                      <p style={{fontSize:'10px',color:'var(--t2)',textAlign:'right',marginTop:'4px'}}>{m.time}</p>
                    </div>
                  </div>
                );
              })}
            </div>
            {/* Input */}
            <div style={{padding:'12px 16px',borderTop:'1px solid var(--bd)',display:'flex',gap:'8px',alignItems:'center',background:'var(--surf)',flexShrink:0}}>
              <Btn variant="outline" size="sm">Quick Reply</Btn>
              <input value={input} onChange={e=>setInput(e.target.value)} onKeyDown={e=>e.key==='Enter'&&send()}
                placeholder="Type a message…"
                style={{flex:1,padding:'10px 14px',borderRadius:'9px',background:'rgba(255,255,255,0.03)',border:'1px solid var(--bd)',color:'var(--t1)',fontSize:'13px',fontFamily:"'Plus Jakarta Sans',sans-serif",outline:'none',transition:'border .15s'}}
                onFocus={e=>e.target.style.borderColor='var(--gbd)'} onBlur={e=>e.target.style.borderColor='var(--bd)'}/>
              <button onClick={send} style={{width:'38px',height:'38px',borderRadius:'9px',background:'var(--green)',border:'none',cursor:'pointer',display:'flex',alignItems:'center',justifyContent:'center',flexShrink:0,boxShadow:'0 0 14px rgba(30,191,94,0.25)'}}>
                <I n="send" s={15} c="#060913"/>
              </button>
            </div>
          </>}
        </div>
      </div>
    </div>
  );
};

// ── Campaigns View ─────────────────────────────────────────────────────
const CampaignsView = () => (
  <div style={{flex:1,display:'flex',flexDirection:'column',overflow:'hidden'}}>
    <DashHeader title="Campaigns" subtitle="Manage and monitor your broadcasts"/>
    <div style={{flex:1,overflowY:'auto',padding:'24px 28px'}}>
      <div style={{display:'flex',justifyContent:'flex-end',marginBottom:'16px'}}>
        <Btn style={{boxShadow:'var(--glow)'}}><I n="send" s={14} c="#060A10"/> New Campaign</Btn>
      </div>
      <div style={{...card,overflow:'hidden'}}>
        <table style={{width:'100%',borderCollapse:'collapse'}}>
          <thead>
            <tr style={{borderBottom:'1px solid var(--bd)'}}>
              {['Campaign','Status','Sent','Delivered','Read','Rate','Date',''].map(h=>(
                <th key={h} style={{padding:'12px 16px',textAlign:'left',fontSize:'11px',fontWeight:700,color:'var(--t2)',textTransform:'uppercase',letterSpacing:'.08em'}}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {CAMPAIGNS.map((c,i)=>(
              <tr key={c.id} style={{borderBottom:i<CAMPAIGNS.length-1?'1px solid var(--bd)':'none',transition:'background .12s'}}
                onMouseEnter={e=>e.currentTarget.style.background='rgba(255,255,255,0.015)'}
                onMouseLeave={e=>e.currentTarget.style.background='transparent'}>
                <td style={{padding:'14px 16px',fontSize:'14px',fontWeight:600,color:'var(--t1)'}}>{c.name}</td>
                <td style={{padding:'14px 16px'}}><StatusBadge s={c.status}/></td>
                <td style={{padding:'14px 16px',fontSize:'13px',color:'var(--t2)'}}>{c.sent.toLocaleString()}</td>
                <td style={{padding:'14px 16px',fontSize:'13px',color:'var(--t2)'}}>{c.delivered.toLocaleString()}</td>
                <td style={{padding:'14px 16px',fontSize:'13px',color:'var(--t2)'}}>{c.read.toLocaleString()}</td>
                <td style={{padding:'14px 16px'}}>
                  {c.rate>0?<div style={{display:'flex',alignItems:'center',gap:'8px'}}>
                    <div style={{width:'60px',height:'4px',borderRadius:'4px',background:'rgba(255,255,255,0.06)'}}><div style={{height:'100%',width:`${c.rate}%`,borderRadius:'4px',background:'var(--green)'}}/></div>
                    <span style={{fontSize:'12px',color:'var(--green)',fontWeight:600}}>{c.rate}%</span>
                  </div>:<span style={{fontSize:'12px',color:'var(--t2)'}}>—</span>}
                </td>
                <td style={{padding:'14px 16px',fontSize:'13px',color:'var(--t2)'}}>{c.date}</td>
                <td style={{padding:'14px 16px'}}><Btn variant="outline" size="sm">View</Btn></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  </div>
);

// ── Templates View ─────────────────────────────────────────────────────
const TemplatesView = () => (
  <div style={{flex:1,display:'flex',flexDirection:'column',overflow:'hidden'}}>
    <DashHeader title="Templates" subtitle="Create and manage message templates"/>
    <div style={{flex:1,overflowY:'auto',padding:'24px 28px'}}>
      <div style={{display:'flex',justifyContent:'flex-end',marginBottom:'16px'}}>
        <Btn style={{boxShadow:'var(--glow)'}}><I n="file" s={14} c="#060A10"/> New Template</Btn>
      </div>
      <div style={{display:'grid',gridTemplateColumns:'repeat(3,1fr)',gap:'12px'}}>
        {TEMPLATES.map(t=>(
          <div key={t.id} style={{...card,padding:'20px',transition:'border-color .2s,transform .2s'}}
            onMouseEnter={e=>{e.currentTarget.style.borderColor='var(--bdm)';e.currentTarget.style.transform='translateY(-2px)';}}
            onMouseLeave={e=>{e.currentTarget.style.borderColor='var(--bd)';e.currentTarget.style.transform='none';}}>
            <div style={{display:'flex',justifyContent:'space-between',alignItems:'flex-start',marginBottom:'12px'}}>
              <div>
                <p style={{fontFamily:"'Syne',sans-serif",fontWeight:700,fontSize:'14px',color:'var(--t1)',marginBottom:'5px'}}>{t.name}</p>
                <span style={{fontSize:'11px',padding:'2px 8px',borderRadius:'5px',background:'rgba(255,255,255,0.04)',border:'1px solid var(--bd)',color:'var(--t2)'}}>{t.cat}</span>
              </div>
              <StatusBadge s={t.status}/>
            </div>
            <div style={{background:'rgba(255,255,255,0.02)',borderRadius:'8px',padding:'10px 12px',marginBottom:'14px',border:'1px solid var(--bd)',minHeight:'60px'}}>
              <p style={{fontSize:'12px',color:'var(--t1)',lineHeight:1.55}}>{t.preview}</p>
            </div>
            <div style={{display:'flex',gap:'8px'}}>
              <Btn variant="ghost" size="sm" style={{flex:1,justifyContent:'center'}}>Edit</Btn>
              <Btn variant="outline" size="sm" style={{flex:1,justifyContent:'center'}}>Preview</Btn>
            </div>
          </div>
        ))}
      </div>
    </div>
  </div>
);

// ── Placeholder ────────────────────────────────────────────────────────
const PlaceholderView = ({ title, icon }) => (
  <div style={{flex:1,display:'flex',flexDirection:'column',overflow:'hidden'}}>
    <DashHeader title={title}/>
    <div style={{flex:1,display:'flex',alignItems:'center',justifyContent:'center',flexDirection:'column',gap:'14px',color:'var(--t2)'}}>
      <div style={{width:'56px',height:'56px',borderRadius:'14px',background:'var(--surf)',border:'1px solid var(--bd)',display:'flex',alignItems:'center',justifyContent:'center',boxShadow:'var(--card-shadow)'}}>
        <I n={icon} s={24} c="var(--t2)"/>
      </div>
      <div style={{textAlign:'center'}}>
        <h3 style={{fontFamily:"'Syne',sans-serif",fontWeight:700,fontSize:'17px',color:'var(--t1)',marginBottom:'6px'}}>{title}</h3>
        <p style={{fontSize:'13px'}}>Full interface available in the production app.</p>
      </div>
    </div>
  </div>
);

// ── Sidebar ────────────────────────────────────────────────────────────
const NAV=[
  {id:'home',      label:'Home',        icon:'home'},
  {id:'templates', label:'Templates',   icon:'file'},
  {id:'campaigns', label:'Campaigns',   icon:'send'},
  {id:'contacts',  label:'Contacts',    icon:'users'},
  {id:'inbox',     label:'Inbox',       icon:'msg'},
  {id:'automation',label:'Automation',  icon:'zap'},
  {id:'analytics', label:'Analytics',   icon:'chart'},
  {id:'setup',     label:'Number Setup',icon:'phone'},
  {id:'api',       label:'API Keys',    icon:'key'},
  {id:'settings',  label:'Settings',    icon:'cog'},
];

const Sidebar = ({ page, setPage, onNav }) => {
  const [col, setCol] = useState(false);
  return (
    <div style={{width:col?'60px':'232px',background:'#060913',borderRight:'1px solid var(--bd)',display:'flex',flexDirection:'column',transition:'width .22s ease',flexShrink:0,overflow:'hidden'}}>
      {/* Logo area */}
      <div style={{padding:'16px 14px',display:'flex',alignItems:'center',gap:'9px',borderBottom:'1px solid var(--bd)',minHeight:'62px'}}>
        <div onClick={()=>onNav('landing')} style={{width:'32px',height:'32px',borderRadius:'8px',background:'var(--green)',display:'flex',alignItems:'center',justifyContent:'center',flexShrink:0,cursor:'pointer',boxShadow:'0 0 16px rgba(30,191,94,0.3)'}}>
          <svg width="14" height="14" viewBox="0 0 16 16" fill="none"><path d="M8 1C4.13 1 1 4.13 1 8c0 1.29.35 2.5.96 3.54L1 15l3.46-.96A7 7 0 1 0 8 1z" fill="#060913"/></svg>
        </div>
        {!col&&<span style={{fontFamily:"'Syne',sans-serif",fontWeight:700,fontSize:'15px',color:'var(--t1)',whiteSpace:'nowrap',letterSpacing:'-.02em'}}>ChatFlow<span style={{color:'var(--green)'}}>Pro</span></span>}
        {!col&&<button onClick={()=>setCol(true)} style={{marginLeft:'auto',background:'none',border:'none',cursor:'pointer',color:'var(--t2)',padding:'4px',display:'flex'}}>
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M11 19l-7-7 7-7M18 19l-7-7 7-7"/></svg>
        </button>}
        {col&&<button onClick={()=>setCol(false)} style={{background:'none',border:'none',cursor:'pointer',color:'var(--t2)',padding:'4px',display:'flex',marginLeft:'-2px'}}>
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M13 5l7 7-7 7M6 5l7 7-7 7"/></svg>
        </button>}
      </div>
      {/* Nav */}
      <div style={{flex:1,padding:'8px',display:'flex',flexDirection:'column',gap:'2px',overflowY:'auto'}}>
        {!col&&<div style={{padding:'6px 8px 4px',fontSize:'10px',fontWeight:700,color:'var(--t3)',textTransform:'uppercase',letterSpacing:'.1em'}}>Menu</div>}
        {NAV.map(item=>{
          const on=page===item.id;
          return (
            <div key={item.id} onClick={()=>setPage(item.id)}
              style={{display:'flex',alignItems:'center',gap:'10px',padding:col?'10px':'9px 10px',borderRadius:'8px',cursor:'pointer',transition:'background .12s',
                background:on?'rgba(30,191,94,0.1)':'transparent',
                justifyContent:col?'center':'flex-start'}}
              onMouseEnter={e=>{if(!on)e.currentTarget.style.background='rgba(255,255,255,0.04)';}}
              onMouseLeave={e=>{if(!on)e.currentTarget.style.background='transparent';}}
              title={col?item.label:''}>
              <I n={item.icon} s={16} c={on?'var(--green)':'var(--t2)'} w={on?2:1.75}/>
              {!col&&<span style={{fontSize:'13px',fontWeight:on?600:500,color:on?'var(--t1)':'var(--t2)',whiteSpace:'nowrap'}}>{item.label}</span>}
              {!col&&on&&<div style={{marginLeft:'auto',width:'5px',height:'5px',borderRadius:'50%',background:'var(--green)'}}/>}
            </div>
          );
        })}
      </div>
      {/* Footer */}
      <div style={{padding:'10px 8px',borderTop:'1px solid var(--bd)'}}>
        {!col&&<div style={{padding:'10px',borderRadius:'8px',background:'rgba(255,255,255,0.03)',border:'1px solid var(--bd)',marginBottom:'8px',display:'flex',alignItems:'center',gap:'9px'}}>
          <Avatar name="Admin User" size={28} showRing/>
          <div style={{flex:1,minWidth:0}}>
            <p style={{fontSize:'12px',fontWeight:600,color:'var(--t1)',whiteSpace:'nowrap',overflow:'hidden',textOverflow:'ellipsis'}}>Admin User</p>
            <p style={{fontSize:'10px',color:'var(--t2)'}}>Growth Plan</p>
          </div>
        </div>}
        <div onClick={()=>onNav('landing')} style={{display:'flex',alignItems:'center',gap:'10px',padding:col?'10px':'9px 10px',borderRadius:'8px',cursor:'pointer',transition:'background .12s',justifyContent:col?'center':'flex-start'}}
          onMouseEnter={e=>e.currentTarget.style.background='rgba(255,255,255,0.04)'}
          onMouseLeave={e=>e.currentTarget.style.background='transparent'}
          title={col?'Sign out':''}>
          <I n="logout" s={16} c="var(--t2)"/>
          {!col&&<span style={{fontSize:'13px',color:'var(--t2)',fontWeight:500}}>Sign out</span>}
        </div>
      </div>
    </div>
  );
};

// ── Dashboard Layout ────────────────────────────────────────────────────
const Dashboard = ({ onNav }) => {
  const [page,setPage]=useState('home');
  const isInbox=page==='inbox';

  const renderView=()=>{
    if(page==='home')      return <HomeView/>;
    if(page==='inbox')     return <InboxView/>;
    if(page==='campaigns') return <CampaignsView/>;
    if(page==='templates') return <TemplatesView/>;
    return <PlaceholderView title={NAV.find(n=>n.id===page)?.label||'Section'} icon={NAV.find(n=>n.id===page)?.icon||'cog'}/>;
  };

  return (
    <div style={{display:'flex',height:'100vh',overflow:'hidden',background:'#060B18'}}>
      <Sidebar page={page} setPage={setPage} onNav={onNav}/>
      <div style={{flex:1,display:'flex',flexDirection:'column',overflow:isInbox?'hidden':'auto',minWidth:0}}>
        {renderView()}
      </div>
    </div>
  );
};

window.Dashboard = Dashboard;
