const { useState, useRef, useEffect } = React;
const I   = window.I;
const Btn = window.Btn;

// ── Shared Style Token ──────────────────────────────────────────────────
const card = { background:'var(--surf)', border:'1px solid var(--bd)', borderRadius:'var(--rl)', boxShadow:'var(--card-shadow)' };

const StatusBadge = ({ s }) => {
  const cfg = {
    active:   {bg:'var(--gbg)',          bd:'var(--gbd)',                   c:'var(--green)'},
    Active:   {bg:'var(--gbg)',          bd:'var(--gbd)',                   c:'var(--green)'},
    Approved: {bg:'var(--gbg)',          bd:'var(--gbd)',                   c:'var(--green)'},
    Completed:{bg:'rgba(99,102,241,.1)',  bd:'rgba(99,102,241,.25)',         c:'#818cf8'},
    paused:   {bg:'rgba(245,158,11,0.12)', c:'#F59E0B',                      dot:'#F59E0B'},
    inactive: {bg:'rgba(100,110,130,0.14)',c:'var(--t2)',                     dot:'var(--t2)'},
    Draft:    {bg:'rgba(255,255,255,.04)',bd:'var(--bd)',                    c:'var(--t2)'},
    Pending:  {bg:'rgba(245,158,11,.1)', bd:'rgba(245,158,11,.25)',         c:'#fbbf24'},
    urgent:   {bg:'rgba(239,68,68,.08)', bd:'rgba(239,68,68,.22)',          c:'#f87171'},
    resolved: {bg:'var(--gbg)',          bd:'var(--gbd)',                   c:'var(--green)'},
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

// ── Global Admin / Client Role Analytics Data ──────────────────────────
const ADMIN_STATS = {
  overview: [
    {label:"Total Clients Active",  value:"1,248",   delta:"+14.2%", up:true,  icon:"👥"},
    {label:"Clients with Numbers", value:"984",     delta:"+8.6%",  up:true,  icon:"🔌"},
    {label:"Total Numbers Leased", value:"4,130",   delta:"+11.5%", up:true,  icon:"🔢"},
    {label:"Platform Messages",    value:"948.3K",  delta:"+24.1%", up:true,  icon:"📤"},
    {label:"Avg Conversion Rate",  value:"31.4%",   delta:"+2.3%",  up:true,  icon:"📈"},
    {label:"Active Sessions",      value:"342",     delta:"+5.1%",  up:true,  icon:"⚡"},
  ],
  weeklyMsgs:[
    {day:"Mon",sent:18200,recv:15400},{day:"Tue",sent:21400,recv:19200},
    {day:"Wed",sent:19900,recv:17100},{day:"Thu",sent:24100,recv:21000},
    {day:"Fri",sent:26200,recv:24000},{day:"Sat",sent:14100,recv:12900},
    {day:"Sun",sent:11500,recv:9800},
  ],
  devices:[
    {label:"Android Users",pct:58,color:"#1EBF5E"},
    {label:"iOS Users",   pct:31,color:"#3B82F6"},
    {label:"Web Apps",    pct:11,color:"#F59E0B"},
  ],
  heatmap: Array.from({length:7},(_,d)=>
    Array.from({length:24},(_,h)=>({ d,h,v:Math.round(Math.random()*100*(h>=8&&h<=21?1:.15)*(d<5?1:.5)) }))
  ).flat(),
};

// Unified Network Database Tracking all Client Numbers
const CLIENT_NUMBERS_POOL = [
  {id:1,number:"+1 (415) 555-0182",  label:"US Primary",    client:"Acme Corp",     status:"active",   msgs:14230, region:"North America"},
  {id:2,number:"+44 20 7946 0823",   label:"UK Support",    client:"Acme Corp",     status:"active",   msgs:8741,  region:"Europe"},
  {id:3,number:"+91 98765 43200",    label:"India Sales",   client:"Zara Retail",   status:"active",   msgs:22109, region:"Asia Pacific"},
  {id:4,number:"+55 11 9 8765-4320", label:"Brazil MKT",    client:"Initech Solutions",status:"paused",msgs:3304,  region:"Latin America"},
  {id:5,number:"+61 4 1234 5678",    label:"AU Ops",        client:"Omega Ltd",     status:"active",   msgs:5620,  region:"Asia Pacific"},
];

const CONVS=[
  {id:1,name:'Priya Sharma', phone:'+91 98001 11234',last:'Is my order shipped?',     time:'10:32',unread:2,label:'urgent'}
];
const MSGS={
  1:[{id:1,dir:'IN',body:'Hi! I placed an order yesterday. Is it shipped?',time:'10:28'}]
};
const CAMPAIGNS=[
  {id:1,name:'Diwali Sale 2026',     status:'Active',   sent:12421,delivered:12180,read:8943, rate:98.1,date:'Oct 18'}
];
const TEMPLATES=[
  {id:1,name:'Order Confirmation',  cat:'Transactional',status:'Approved',preview:'Your order #{{1}} has been confirmed.'}
];

// ── Chart Subcomponents Rendering Modules ──────────────────────────────
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
      </svg>
      <div style={{display:'grid',gridTemplateColumns:`repeat(${labels.length},1fr)`,gap:'0',marginTop:'8px'}}>
        {labels.map(l=><div key={l} style={{fontSize:'11px',color:'var(--t3)',textAlign:'center'}}>{l}</div>)}
      </div>
    </div>
  );
};

const StatCard = ({label, value, delta, up, icon}) => (
  <div style={{...card, padding:"16px 18px"}}>
    <div style={{display:"flex", justifyContent:"space-between", alignItems:"flex-start", marginBottom:10}}>
      <span style={{fontSize:18}}>{icon}</span>
      <span style={{
        fontSize:10, fontWeight:600, padding:"3px 7px", borderRadius:6,
        background:up?"rgba(30,191,94,0.12)":"rgba(255,80,80,0.12)",
        color:up?"var(--green)":"#ff5050",
        display:"flex", alignItems:"center", gap:3,
      }}>
        {delta}
      </span>
    </div>
    <div style={{fontSize:21, fontWeight:800, fontFamily:"'Syne',sans-serif", color:"var(--t1)", letterSpacing:"-0.03em"}}>{value}</div>
    <div style={{fontSize:11, color:"var(--t2)", marginTop:4}}>{label}</div>
  </div>
);

const WeeklyBarChart = ({ data }) => {
  const max = Math.max(...data.map(d=>d.sent));
  return (
    <div style={{...card, padding:"20px 22px"}}>
      <div style={{display:"flex", justifyContent:"space-between", alignItems:"center", marginBottom:16}}>
        <div>
          <h3 style={{fontSize:13, fontWeight:700, color:"var(--t1)"}}>System Traffic Distribution</h3>
          <p style={{fontSize:11, color:"var(--t2)", marginTop:3}}>Aggregated client communication metric load</p>
        </div>
      </div>
      <div style={{display:"flex", alignItems:"flex-end", gap:5, height:110}}>
        {data.map((d)=>(
          <div key={d.day} style={{flex:1, display:"flex", flexDirection:"column", alignItems:"center", gap:4, height:"100%"}}>
            <div style={{flex:1, width:"100%", display:"flex", alignItems:"flex-end", gap:2}}>
              <div style={{flex:1, borderRadius:"3px 3px 0 0", background:"var(--green)", height:`${(d.sent/max)*100}%`, opacity:.85}}/>
              <div style={{flex:1, borderRadius:"3px 3px 0 0", background:"var(--surf3)", height:`${(d.recv/max)*100}%`}}/>
            </div>
            <span style={{fontSize:10, color:"var(--t2)"}}>{d.day}</span>
          </div>
        ))}
      </div>
    </div>
  );
};

const DeviceDonut = ({ data }) => (
  <div style={{...card, padding:"20px 22px"}}>
    <h3 style={{fontSize:13,fontWeight:700,marginBottom:3, color:"var(--t1)"}}>Access Breakdowns</h3>
    <p style={{fontSize:11,color:"var(--t2)",marginBottom:14}}>Client application environments</p>
    <div style={{display:"flex",flexDirection:"column",gap:9}}>
      {data.map(d=>(
        <div key={d.label} style={{display:"flex",alignItems:"center",justifyContent:"space-between"}}>
          <span style={{fontSize:11,color:"var(--t2)"}}>{d.label}</span>
          <span style={{fontSize:11,fontWeight:600,color:"var(--t1)"}}>{d.pct}%</span>
        </div>
      ))}
    </div>
  </div>
);

const HeatmapCard = ({ data }) => {
  const DAYS=["Mon","Tue","Wed","Thu","Fri","Sat","Sun"];
  const HOURS=Array.from({length:24},(_,i)=>i);
  const cellColor=(di,hi)=>{
    const cell=data.find(c=>c.d===di&&c.h===hi);
    if(!cell||cell.v===0) return "var(--surf3)";
    return "#1EBF5E";
  };
  return (
    <div style={{...card, padding:"20px 22px"}}>
      <h3 style={{fontSize:13,fontWeight:700,marginBottom:3, color:"var(--t1)"}}>Peak Platform Load Heatmap</h3>
      <div style={{overflowX:"auto", marginTop:10}}>
        <div style={{display:"grid", gap:2}}>
          {DAYS.map((day,di)=>(
            <div key={day} style={{display:"flex", gap:2, alignItems:"center"}}>
              <span style={{fontSize:10, color:"var(--t2)", width:30}}>{day}</span>
              {HOURS.map(h=><div key={h} style={{height:10, width:10, borderRadius:2, background:cellColor(di,h)}}/>)}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
};

// ── Global Header Component ───────────────────────────────────────────
const DashHeader = ({ title, subtitle }) => (
  <div style={{height:'58px',borderBottom:'1px solid var(--bd)',display:'flex',alignItems:'center',padding:'0 28px',gap:'16px',flexShrink:0,background:'var(--surf)'}}>
    <div style={{flex:1}}>
      <h1 style={{fontFamily:"'Syne',sans-serif",fontWeight:800,fontSize:'16px',color:'var(--t1)'}}>{title}</h1>
      {subtitle&&<p style={{fontSize:'11.5px',color:'var(--t2)'}}>{subtitle}</p>}
    </div>
    <div style={{fontSize:12, fontWeight:700, color:"var(--green)", background:"var(--gbg)", padding:"4px 10px", borderRadius:6, border:"1px solid var(--gbd)"}}>ADMIN CONSOLE</div>
    <Avatar name="Admin User" size={34} showRing/>
  </div>
);

// ── Core Views ────────────────────────────────────────────────────────
const HomeView = () => {
  const wkData=[42,58,46,70,65,88,82];
  const wkLabels=['Mon','Tue','Wed','Thu','Fri','Sat','Sun'];
  return (
    <div style={{flex:1,overflowY:'auto'}}>
      <DashHeader title="Admin Dashboard" subtitle="Control system gateway and infrastructure health tracking metrics"/>
      <div style={{padding:'24px 28px',display:'flex',flexDirection:'column',gap:'18px'}}>
        <div style={{display:'grid',gridTemplateColumns:'repeat(4,1fr)',gap:'12px'}}>
          <div style={{...card, padding:'20px'}}><h3>1.24M</h3><p style={{fontSize:12, color:'var(--t2)'}}>Total Network Requests</p></div>
          <div style={{...card, padding:'20px'}}><h3>99.8%</h3><p style={{fontSize:12, color:'var(--t2)'}}>API Gateway Status Health</p></div>
        </div>
        <div style={{...card, padding:'24px'}}><ActivityChart data={wkData} labels={wkLabels}/></div>
      </div>
    </div>
  );
};

// ── Shared Number Pool Component Updated for Client/Admin Relationship ──
const NumberPoolPanel = () => {
  const [pool, setPool] = useState(CLIENT_NUMBERS_POOL);
  const [filter, setFilter] = useState("all");
  const filtered = pool.filter(n=>filter==="all" || n.status===filter);

  return (
    <div style={{...card, padding:"22px 24px", marginTop:14}}>
      <div style={{display:"flex",justifyContent:"space-between",marginBottom:14, flexWrap:"wrap", gap:12}}>
        <div>
          <h3 style={{fontSize:15,fontWeight:700,color:"var(--t1)", fontFamily:"'Syne',sans-serif"}}>Leased Client Numbers</h3>
          <p style={{fontSize:11,color:"var(--t2)", marginTop:3}}>Comprehensive overview of active and purchased communication routes matching client accounts</p>
        </div>
        <div style={{display:"flex", gap:6}}>
          {["all","active","paused"].map(f=>(
            <button key={f} onClick={()=>setFilter(f)} style={{background:"var(--surf2)", border:"1px solid var(--bd)", color:"#fff", padding:"6px 12px", borderRadius:6, cursor:"pointer", fontSize:11}}>{f.toUpperCase()}</button>
          ))}
        </div>
      </div>
      <div style={{overflowX:"auto"}}>
        <table style={{width:"100%",borderCollapse:"collapse"}}>
          <thead>
            <tr style={{borderBottom:"1px solid var(--bd)", color:"var(--t2)", fontSize:11, textAlign:"left"}}>
              <th style={{paddingBottom:10}}>Assigned Number</th>
              <th style={{paddingBottom:10}}>Alias Label</th>
              <th style={{paddingBottom:10}}>Owned By Client User</th>
              <th style={{paddingBottom:10}}>Status</th>
              <th style={{paddingBottom:10}}>Region</th>
              <th style={{paddingBottom:10}}>Total Messages</th>
            </tr>
          </thead>
          <tbody>
            {filtered.map(n=>(
              <tr key={n.id} style={{borderBottom:"1px solid var(--bd)", fontSize:13, color:"var(--t1)"}}>
                <td style={{padding:"12px 0", fontFamily:"monospace", fontWeight:600}}>{n.number}</td>
                <td>{n.label}</td>
                <td style={{fontWeight:600, color:"var(--green)"}}>{n.client}</td>
                <td><StatusBadge s={n.status}/></td>
                <td style={{color:"var(--t2)"}}>{n.region}</td>
                <td style={{fontWeight:700}}>{n.msgs.toLocaleString()}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
};

// ── Transformed Client Analytics Overview Page ──────────────────────────
const MyAnalyticsView = () => (
  <div style={{flex:1,overflowY:'auto'}}>
    <DashHeader title="Client Metrics Dashboard" subtitle="Consolidated analytics tracking for all user client roles across the instance"/>
    <div style={{padding:'24px 28px',display:'flex',flexDirection:'column',gap:'20px'}}>
      
      {/* Dynamic Client Aggregate Overview Metrics */}
      <div style={{display:'grid',gridTemplateColumns:'repeat(6,1fr)',gap:'12px'}}>
        {ADMIN_STATS.overview.map(s=>(
          <StatCard key={s.label} label={s.label} value={s.value} delta={s.delta} up={s.up} icon={s.icon}/>
        ))}
      </div>

      {/* Grid Flow Charts Layout */}
      <div style={{display:'grid',gridTemplateColumns:'1fr 320px',gap:'14px'}}>
        <WeeklyBarChart data={ADMIN_STATS.weeklyMsgs}/>
        <DeviceDonut data={ADMIN_STATS.devices}/>
      </div>

      {/* System Heatmap Tracking */}
      <HeatmapCard data={ADMIN_STATS.heatmap}/>

      {/* Consolidated Master Client Numbers Pool */}
      <NumberPoolPanel/>
    </div>
  </div>
);

const InboxView = () => <PlaceholderView title="Inbox Control" icon="msg"/>;
const CampaignsView = () => <PlaceholderView title="Broadcast Routing" icon="send"/>;
const TemplatesView = () => <PlaceholderView title="Template Control Layer" icon="file"/>;

const NumberSetupPage = ({ setPage }) => (
  <div style={{padding:"24px 28px"}}>
    <DashHeader title="Network Setup Control" subtitle="API and infrastructure linkage parameters" />
    <div style={{padding:"24px 0", maxWidth:"800px"}}>
      <div style={{padding:"16px 20px",borderRadius:"var(--rl)",background:"rgba(30,191,94,0.07)",border:"1px solid var(--gbd)",display:"flex",alignItems:"center",gap:14}}>
        <div style={{flex:1}}>
          <span style={{fontSize:13,fontWeight:700,color:"var(--green)"}}>Unified Pool Dashboard Tracking Active! </span>
          <p style={{fontSize:12,color:"var(--t2)", marginTop:4}}>Client numbers, assignment rules, active purchase logs and global configurations have been routed directly to the Master Analytics workspace hub view.</p>
        </div>
        <Btn size="sm" onClick={() => setPage('user_analytics')}>Open Client Analytics →</Btn>
      </div>
    </div>
  </div>
);

const PlaceholderView = ({ title }) => (
  <div style={{flex:1,display:'flex',flexDirection:'column',overflow:'hidden'}}>
    <DashHeader title={title}/>
    <div style={{flex:1,display:'flex',alignItems:'center',justifyContent:'center',color:'var(--t2)'}}>
      <p style={{fontSize:'13px'}}>Admin panel submodule terminal asset coming soon.</p>
    </div>
  </div>
);

// ── Sidebar System Layout Navigation Config ────────────────────────────
const NAV=[
  {id:'home',            label:'Dashboard Panel',     icon:'home'},
  {id:'user_analytics',  label:'Client Analytics',    icon:'user'},
  {id:'templates',       label:'Global Templates',    icon:'file'},
  {id:'campaigns',       label:'Global Campaigns',    icon:'send'},
  {id:'inbox',           label:'System Inbox',        icon:'msg'},
  {id:'setup',           label:'Infrastructure Setup',icon:'phone'},
];

const Sidebar = ({ page, setPage }) => (
  <div style={{width:'232px',background:'#060913',borderRight:'1px solid var(--bd)',display:'flex',flexDirection:'column',flexShrink:0,overflow:'hidden'}}>
    <div style={{padding:'16px 14px',display:'flex',alignItems:'center',gap:'9px',borderBottom:'1px solid var(--bd)',minHeight:'62px'}}>
      <span style={{fontFamily:"'Syne',sans-serif",fontWeight:700,fontSize:'15px',color:'var(--t1)'}}>ChatFlow<span style={{color:'var(--green)'}}>Pro</span></span>
    </div>
    <div style={{flex:1,padding:'8px',display:'flex',flexDirection:'column',gap:'2px',overflowY:'auto'}}>
      {NAV.map(item=>{
        const on = page === item.id;
        return (
          <div key={item.id} onClick={()=>setPage(item.id)}
            style={{display:'flex',alignItems:'center',gap:'10px',padding:'9px 10px',borderRadius:'8px',cursor:'pointer',
              background:on?'rgba(30,191,94,0.1)':'transparent'}}>
            <I n={item.icon} s={16} c={on?'var(--green)':'var(--t2)'} w={2}/>
            <span style={{fontSize:'13px',fontWeight:on?600:500,color:on?'var(--t1)':'var(--t2)'}}>{item.label}</span>
          </div>
        );
      })}
    </div>
  </div>
);

// ── Dashboard Layout Core Controller ────────────────────────────────────
const Dashboard = ({ onNav }) => {
  const [page, setPage] = useState('home');

  const renderView = () => {
    if(page==='home')            return <HomeView/>;
    if(page==='user_analytics')  return <MyAnalyticsView/>;
    if(page==='inbox')           return <InboxView/>;
    if(page==='campaigns')       return <CampaignsView/>;
    if(page==='templates')       return <TemplatesView/>;
    if(page==='setup')           return <NumberSetupPage setPage={setPage}/>;
    return <PlaceholderView title="Admin Layer Terminal" />;
  };

  return (
    <div style={{display:'flex',height:'100vh',overflow:'hidden',background:'#060B18'}}>
      <Sidebar page={page} setPage={setPage} />
      <div style={{flex:1,display:'flex',flexDirection:'column',overflow:'auto',minWidth:0}}>
        {renderView()}
      </div>
    </div>
  );
};

window.Dashboard = Dashboard;