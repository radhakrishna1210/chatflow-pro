// components/user_analytics.jsx
const { useState } = React;

const cardStyle = { background: 'var(--surf)', border: '1px solid var(--bd)', borderRadius: 'var(--rl)', boxShadow: 'var(--card-shadow)' };

// ── Shared Subcomponents ───────────────────────────────────────────────
const StatusBadge = ({ s }) => {
  const cfg = {
    active:   {bg:'var(--gbg)',          bd:'var(--gbd)',                   c:'var(--green)'},
    Active:   {bg:'var(--gbg)',          bd:'var(--gbd)',                   c:'var(--green)'},
    paused:   {bg:'rgba(245,158,11,0.12)', c:'#F59E0B'},
    inactive: {bg:'rgba(100,110,130,0.14)',c:'var(--t2)'}
  };
  const v = cfg[s] || {bg:'rgba(255,255,255,.04)', bd:'var(--bd)', c:'var(--t2)'};
  return <span style={{padding:'3px 9px',borderRadius:'20px',fontSize:'11px',fontWeight:600,background:v.bg,border:`1px solid ${v.bd}`,color:v.c,display:'inline-block'}}>{s}</span>;
};

const StatCard = ({label, value, delta, up, icon}) => (
  <div style={{...cardStyle, padding:"16px 18px"}}>
    <div style={{display:"flex", justifyContent:"space-between", alignItems:"flex-start", marginBottom:10}}>
      <span style={{fontSize:18}}>{icon}</span>
      <span style={{
        fontSize:10, fontWeight:600, padding:"3px 7px", borderRadius:6,
        background:up?"rgba(30,191,94,0.12)":"rgba(255,80,80,0.12)",
        color:up?"var(--green)":"#ff5050",
      }}>{delta}</span>
    </div>
    <div style={{fontSize:21, fontWeight:800, fontFamily:"'Syne',sans-serif", color:"var(--t1)", letterSpacing:"-0.03em"}}>{value}</div>
    <div style={{fontSize:11, color:"var(--t2)", marginTop:4}}>{label}</div>
  </div>
);

// ── Master Component ───────────────────────────────────────────────────
const MyAnalyticsView = ({ adminStats, clientNumbers, onRefresh }) => {
  const [filter, setFilter] = useState("all");
  const filteredPool = clientNumbers.filter(n => filter === "all" || n.status === filter);
  const maxSent = Math.max(...adminStats.weeklyMsgs.map(d => d.sent));

  return (
    <div style={{flex: 1, overflowY: 'auto'}}>
      {/* Page Header */}
      <div style={{height:'58px', borderBottom:'1px solid var(--bd)', display:'flex', alignItems:'center', padding:'0 28px', gap:'16px', background:'var(--surf)'}}>
        <div style={{flex: 1}}>
          <h1 style={{fontFamily:"'Syne',sans-serif", fontWeight:800, fontSize:'16px', color:'var(--t1)'}}>Client Metrics Dashboard</h1>
          <p style={{fontSize:'11.5px', color:'var(--t2)'}}>Consolidated analytics tracking for all user client roles</p>
        </div>
        <div style={{fontSize:12, fontWeight:700, color:"var(--green)", background:"var(--gbg)", padding:"4px 10px", borderRadius:6, border:"1px solid var(--gbd)"}}>ADMIN CONSOLE</div>
      </div>

      <div style={{padding: '24px 28px', display: 'flex', flexDirection: 'column', gap: '20px'}}>
        
        {/* Metric Overview Grid */}
        <div style={{display: 'grid', gridTemplateColumns: 'repeat(6, 1fr)', gap: '12px'}}>
          {adminStats.overview.map(s => (
            <StatCard key={s.label} label={s.label} value={s.value} delta={s.delta} up={s.up} icon={s.icon}/>
          ))}
        </div>

        {/* Charts Section */}
        <div style={{display: 'grid', gridTemplateColumns: '1fr 320px', gap: '14px'}}>
          {/* Bar Chart */}
          <div style={{...cardStyle, padding: "20px 22px"}}>
            <h3 style={{fontSize:13, fontWeight:700, color:"var(--t1)", marginBottom:16}}>System Traffic Distribution</h3>
            <div style={{display: "flex", alignItems: "flex-end", gap: 5, height: 110}}>
              {adminStats.weeklyMsgs.map(d => (
                <div key={d.day} style={{flex: 1, display: "flex", flexDirection: "column", alignItems: "center", gap: 4, height: "100%"}}>
                  <div style={{flex: 1, width: "100%", display: "flex", alignItems: "flex-end", gap: 2}}>
                    <div style={{flex: 1, borderRadius: "3px 3px 0 0", background: "var(--green)", height: `${(d.sent / maxSent) * 100}%`, opacity: 0.85}}/>
                    <div style={{flex: 1, borderRadius: "3px 3px 0 0", background: "var(--surf3)", height: `${(d.recv / maxSent) * 100}%`}}/>
                  </div>
                  <span style={{fontSize: 10, color: "var(--t2)"}}>{d.day}</span>
                </div>
              ))}
            </div>
          </div>

          {/* Donut Data Breakdown */}
          <div style={{...cardStyle, padding: "20px 22px"}}>
            <h3 style={{fontSize:13, fontWeight:700, color:"var(--t1)", marginBottom:14}}>Access Breakdowns</h3>
            <div style={{display: "flex", flexDirection: "column", gap: 9}}>
              {adminStats.devices.map(d => (
                <div key={d.label} style={{display: "flex", alignItems: "center", justifyContent: "space-between"}}>
                  <span style={{fontSize: 11, color: "var(--t2)"}}>{d.label}</span>
                  <span style={{fontSize: 11, fontWeight: 600, color: "var(--t1)"}}>{d.pct}%</span>
                </div>
              ))}
            </div>
          </div>
        </div>

        {/* Master Leased Client Numbers Pool */}
        <div style={{...cardStyle, padding: "22px 24px"}}>
          <div style={{display: "flex", justifyContent: "space-between", marginBottom: 14, alignItems: "center"}}>
            <div>
              <h3 style={{fontSize: 15, fontWeight: 700, color: "var(--t1)", fontFamily: "'Syne',sans-serif"}}>Leased Client Numbers</h3>
              <p style={{fontSize: 11, color: "var(--t2)"}}>Overview of lines purchased by client roles</p>
            </div>
            <div style={{display: "flex", gap: 6}}>
              {["all", "active", "paused"].map(f => (
                <button key={f} onClick={() => setFilter(f)} style={{background: "var(--surf2)", border: "1px solid var(--bd)", color: "#fff", padding: "6px 12px", borderRadius: 6, cursor: "pointer", fontSize: 11}}>{f.toUpperCase()}</button>
              ))}
            </div>
          </div>
          <div style={{overflowX: "auto"}}>
            <table style={{width: "100%", borderCollapse: "collapse"}}>
              <thead>
                <tr style={{borderBottom: "1px solid var(--bd)", color: "var(--t2)", fontSize: 11, textAlign: "left"}}>
                  <th style={{paddingBottom: 10}}>Assigned Number</th>
                  <th style={{paddingBottom: 10}}>Alias Label</th>
                  <th style={{paddingBottom: 10}}>Owned By Client User</th>
                  <th style={{paddingBottom: 10}}>Status</th>
                  <th style={{paddingBottom: 10}}>Region</th>
                  <th style={{paddingBottom: 10}}>Total Messages</th>
                </tr>
              </thead>
              <tbody>
                {filteredPool.map(n => (
                  <tr key={n.id} style={{borderBottom: "1px solid var(--bd)", fontSize: 13, color: "var(--t1)"}}>
                    <td style={{padding: "12px 0", fontFamily: "monospace", fontWeight: 600}}>{n.number}</td>
                    <td>{n.label}</td>
                    <td style={{fontWeight: 600, color: "var(--green)"}}>{n.client}</td>
                    <td><StatusBadge s={n.status}/></td>
                    <td style={{color: "var(--t2)"}}>{n.region}</td>
                    <td style={{fontWeight: 700}}>{n.msgs.toLocaleString()}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>

      </div>
    </div>
  );
};

window.MyAnalyticsView = MyAnalyticsView;