import { useState, useEffect, useRef, useCallback } from 'react';
import { I } from '../components/Icons.jsx';
import { Btn } from '../components/Btn.jsx';
import { wFetch } from '../lib/api.js';

const card = { background: 'var(--surf)', border: '1px solid var(--bd)', borderRadius: 'var(--rl)', boxShadow: 'var(--card-shadow)' };

const Avatar = ({ name = '?', size = 32 }) => {
  const init = name.split(' ').map(n => n[0]).join('').slice(0,2).toUpperCase();
  const colors = ['#1EBF5E','#0EA5E9','#A78BFA','#F59E0B','#F472B6'];
  const c = colors[init.charCodeAt(0) % colors.length];
  return (
    <div style={{ width:size, height:size, borderRadius:'50%', background:`${c}18`, border:`1.5px solid ${c}44`, display:'flex', alignItems:'center', justifyContent:'center', fontSize:size*.33+'px', fontWeight:700, color:c, flexShrink:0 }}>
      {init}
    </div>
  );
};

const Tag = ({ label }) => (
  <span style={{ padding:'2px 8px', borderRadius:'6px', fontSize:'10px', fontWeight:600, background:'rgba(255,255,255,0.06)', border:'1px solid var(--bd)', color:'var(--t2)', whiteSpace:'nowrap' }}>{label}</span>
);

const StatusBadge = ({ optedOut }) => (
  <span style={{ padding:'2px 9px', borderRadius:'12px', fontSize:'11px', fontWeight:600, background: optedOut ? 'rgba(255,255,255,0.04)' : 'var(--gbg)', border:`1px solid ${optedOut ? 'var(--bd)' : 'var(--gbd)'}`, color: optedOut ? 'var(--t2)' : 'var(--green)' }}>
    {optedOut ? 'Opted Out' : 'Active'}
  </span>
);

const fmtDate = d => new Date(d).toLocaleDateString('en-IN', { day:'numeric', month:'short', year:'numeric' });

const ColHead = ({ children, width }) => (
  <th style={{ padding:'10px 16px', textAlign:'left', fontSize:'11px', fontWeight:700, color:'var(--t2)', textTransform:'uppercase', letterSpacing:'.08em', whiteSpace:'nowrap', width }}>
    {children}
  </th>
);

const Modal = ({ title, onClose, children, footer, width = 540 }) => (
  <div style={{ position:'fixed', inset:0, background:'rgba(0,0,0,0.6)', zIndex:100, display:'flex', alignItems:'center', justifyContent:'center', backdropFilter:'blur(4px)' }}>
    <div style={{ ...card, width, maxHeight:'85vh', display:'flex', flexDirection:'column', overflow:'hidden' }}>
      <div style={{ padding:'18px 24px', borderBottom:'1px solid var(--bd)', display:'flex', justifyContent:'space-between', alignItems:'center', flexShrink:0 }}>
        <span style={{ fontFamily:"'Syne',sans-serif", fontWeight:700, fontSize:16, color:'var(--t1)' }}>{title}</span>
        <button onClick={onClose} style={{ background:'none', border:'none', cursor:'pointer', color:'var(--t2)', display:'flex' }}>
          <I n="x" s={18} c="var(--t2)" />
        </button>
      </div>
      <div style={{ flex:1, overflowY:'auto', padding:'20px 24px' }}>{children}</div>
      {footer && <div style={{ padding:'14px 24px', borderTop:'1px solid var(--bd)', display:'flex', justifyContent:'flex-end', gap:8, flexShrink:0 }}>{footer}</div>}
    </div>
  </div>
);

const FInput = ({ value, onChange, placeholder, type = 'text', onKeyDown }) => (
  <input
    type={type} value={value} onChange={onChange} placeholder={placeholder} onKeyDown={onKeyDown}
    style={{ width:'100%', padding:'9px 12px', borderRadius:8, background:'rgba(255,255,255,0.04)', border:'1px solid var(--bd)', color:'var(--t1)', fontSize:13, fontFamily:"'Plus Jakarta Sans',sans-serif", outline:'none', boxSizing:'border-box' }}
    onFocus={e => e.target.style.borderColor='var(--gbd)'}
    onBlur={e => e.target.style.borderColor='var(--bd)'} />
);

const FLabel = ({ children, required }) => (
  <label style={{ display:'block', fontSize:12, fontWeight:700, color:'var(--t2)', letterSpacing:'.04em', marginBottom:6 }}>
    {children} {required && <span style={{ color:'#f87171' }}>*</span>}
  </label>
);

// ─── Manual add tab ────────────────────────────────────────────
const ManualTab = ({ onSaved }) => {
  const [name, setName]     = useState('');
  const [phone, setPhone]   = useState('');
  const [email, setEmail]   = useState('');
  const [tagsRaw, setTags]  = useState('');
  const [saving, setSaving] = useState(false);
  const [err, setErr]       = useState(null);

  const submit = async () => {
    if (!phone.trim()) { setErr('Phone number is required'); return; }
    setErr(null); setSaving(true);
    try {
      const tags = tagsRaw.split(',').map(t => t.trim()).filter(Boolean);
      const res = await wFetch('/contacts', {
        method:'POST',
        body: JSON.stringify({ name: name.trim() || 'Unknown', phoneNumber: phone.trim(), email: email.trim() || null, tags }),
      });
      const data = await res.json();
      if (!res.ok) { setErr(data.error || `Error ${res.status}`); return; }
      setName(''); setPhone(''); setEmail(''); setTags('');
      onSaved?.(data);
    } catch (e) {
      setErr(e.message);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div style={{ display:'flex', flexDirection:'column', gap:14 }}>
      {err && (
        <div style={{ padding:'9px 12px', borderRadius:8, background:'rgba(239,68,68,.08)', border:'1px solid rgba(239,68,68,.25)', color:'#f87171', fontSize:12 }}>{err}</div>
      )}
      <div>
        <FLabel>Name</FLabel>
        <FInput value={name} onChange={e => setName(e.target.value)} placeholder="Jane Doe" />
      </div>
      <div>
        <FLabel required>Phone Number</FLabel>
        <FInput value={phone} onChange={e => setPhone(e.target.value.replace(/[^0-9+\s\-()]/g, ''))} placeholder="+91 9876543210" onKeyDown={e => e.key === 'Enter' && submit()} />
        <p style={{ fontSize:11, color:'var(--t3)', marginTop:4 }}>Include country code (e.g. +91 for India, +1 for US). WhatsApp won't deliver without it.</p>
      </div>
      <div>
        <FLabel>Email</FLabel>
        <FInput type="email" value={email} onChange={e => setEmail(e.target.value)} placeholder="jane@example.com" />
      </div>
      <div>
        <FLabel>Tags</FLabel>
        <FInput value={tagsRaw} onChange={e => setTags(e.target.value)} placeholder="vip, newsletter, prospect" />
        <p style={{ fontSize:11, color:'var(--t3)', marginTop:4 }}>Comma-separated.</p>
      </div>
      <Btn onClick={submit} disabled={saving || !phone.trim()} style={{ alignSelf:'flex-end', boxShadow: phone.trim() ? 'var(--glow)' : 'none' }}>
        {saving ? 'Adding…' : 'Add Contact'}
      </Btn>
    </div>
  );
};

// ─── CSV upload tab ────────────────────────────────────────────
const CsvTab = ({ onSaved }) => {
  const [file, setFile]       = useState(null);
  const [dragging, setDrag]   = useState(false);
  const [uploading, setUpl]   = useState(false);
  const [result, setResult]   = useState(null);
  const [err, setErr]         = useState(null);
  const inputRef = useRef(null);

  const submit = async () => {
    if (!file) return;
    setErr(null); setResult(null); setUpl(true);
    try {
      const fd = new FormData();
      fd.append('file', file);
      const { workspaceId } = JSON.parse(localStorage.getItem('user') || '{}');
      const token = localStorage.getItem('accessToken');
      const res = await fetch(`/api/v1/workspaces/${workspaceId}/contacts/import`, {
        method:'POST',
        headers: { Authorization: `Bearer ${token}` }, // no Content-Type — browser sets it with boundary
        body: fd,
      });
      const data = await res.json();
      if (!res.ok) { setErr(data.error || `Error ${res.status}`); return; }
      setResult(data);
      onSaved?.();
    } catch (e) {
      setErr(e.message);
    } finally {
      setUpl(false);
    }
  };

  const downloadSample = () => {
    const csvContent = [
      'name,phoneNumber,email,tags',
      'Aarav,+917410066251,aarav@example.com,test',
      'Vivaan,+918983416795,vivaan@example.com,test',
      'Krishna,+919226573383,krishna@example.com,test',
      'Arjun,+918080178330,arjun@example.com,test',
      'Rohan,+919604609921,rohan@example.com,test',
    ].join('\n');
    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.setAttribute('download', 'sample_contacts.csv');
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  };

  return (
    <div style={{ display:'flex', flexDirection:'column', gap:14 }}>
      <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
        <Btn variant="outline" size="sm" onClick={downloadSample}>
          <I n="download" s={13} c="var(--t2)" />
          Download Sample CSV
        </Btn>
      </div>
      {err && (
        <div style={{ padding:'9px 12px', borderRadius:8, background:'rgba(239,68,68,.08)', border:'1px solid rgba(239,68,68,.25)', color:'#f87171', fontSize:12 }}>{err}</div>
      )}
      {result && (
        <div style={{ padding:'10px 13px', borderRadius:8, background:'var(--gbg)', border:'1px solid var(--gbd)', color:'var(--green)', fontSize:13, fontWeight:600 }}>
          ✓ Imported {result.imported} contact{result.imported !== 1 ? 's' : ''}.
        </div>
      )}
      <input ref={inputRef} type="file" accept=".csv,text/csv" style={{ display:'none' }} onChange={e => { setFile(e.target.files[0]); setResult(null); }} />
      <div
        onClick={() => inputRef.current?.click()}
        onDragOver={e => { e.preventDefault(); setDrag(true); }}
        onDragLeave={() => setDrag(false)}
        onDrop={e => { e.preventDefault(); setDrag(false); const f = e.dataTransfer.files[0]; if (f) { setFile(f); setResult(null); } }}
        style={{
          border:`2px dashed ${dragging ? 'var(--green)' : 'var(--bd)'}`,
          borderRadius:12, padding:'30px 18px', textAlign:'center', cursor:'pointer',
          transition:'all .2s', background: dragging ? 'var(--gbg)' : 'rgba(255,255,255,0.01)',
        }}>
        <div style={{ display:'flex', justifyContent:'center', marginBottom:10 }}>
          <div style={{ width:44, height:44, borderRadius:12, background:'rgba(255,255,255,0.04)', border:'1px solid var(--bd)', display:'flex', alignItems:'center', justifyContent:'center' }}>
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="var(--t2)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/>
              <polyline points="17,8 12,3 7,8"/>
              <line x1="12" y1="3" x2="12" y2="15"/>
            </svg>
          </div>
        </div>
        {file ? (
          <>
            <p style={{ fontSize:14, fontWeight:600, color:'var(--green)' }}>{file.name}</p>
            <p style={{ fontSize:11, color:'var(--t3)', marginTop:4 }}>{(file.size/1024).toFixed(1)} KB — click to choose a different file</p>
          </>
        ) : (
          <>
            <p style={{ fontSize:14, fontWeight:600, color:'var(--t1)', marginBottom:5 }}>Drop CSV here or click to browse</p>
            <p style={{ fontSize:12, color:'var(--t2)' }}>
              Columns: <code style={{ color:'var(--green)', fontFamily:'monospace' }}>name</code>, <code style={{ color:'var(--green)', fontFamily:'monospace' }}>phoneNumber</code>, <code style={{ color:'var(--t2)', fontFamily:'monospace' }}>email</code>, <code style={{ color:'var(--t2)', fontFamily:'monospace' }}>tags</code>
            </p>
          </>
        )}
      </div>
      <div style={{ display:'flex', alignItems:'center', gap:10, padding:'10px 12px', borderRadius:8, background:'rgba(14,165,233,.06)', border:'1px solid rgba(14,165,233,.18)' }}>
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#38bdf8" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ flexShrink:0 }}>
          <circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/>
        </svg>
        <span style={{ fontSize:12, color:'#7dd3fc', lineHeight:1.5 }}>
          Phone numbers must include country code (e.g. <code style={{ fontFamily:'monospace', color:'#bae6fd' }}>+919876543210</code>). Tags column is comma-separated.
        </span>
      </div>
      <div style={{ padding:'14px 16px', borderRadius:8, background:'rgba(14,165,233,.06)', border:'1px solid rgba(14,165,233,.18)' }}>
        <div style={{ display:'flex', alignItems:'center', gap:8, marginBottom:10 }}>
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="#38bdf8" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ flexShrink:0 }}>
            <circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/>
          </svg>
          <span style={{ fontSize:13, fontWeight:600, color:'#7dd3fc' }}>Instructions for uploading CSV</span>
        </div>
        <ul style={{ paddingLeft: 18, margin: 0, display: 'flex', flexDirection: 'column', gap: 8, fontSize: 12, color: '#7dd3fc', lineHeight: 1.5 }}>
          <li>Upload a CSV file to bulk import contacts.</li>
          <li>
            Required columns:
            <ul style={{ listStyleType: 'none', paddingLeft: 16, marginTop: 6, display: 'flex', flexDirection: 'column', gap: 4 }}>
              <li>- <code style={{ fontFamily: 'monospace', color: '#bae6fd' }}>phoneNumber</code> (required)</li>
              <li>- <code style={{ fontFamily: 'monospace', color: '#bae6fd' }}>name</code> (optional)</li>
              <li>- <code style={{ fontFamily: 'monospace', color: '#bae6fd' }}>email</code> (optional)</li>
              <li>- <code style={{ fontFamily: 'monospace', color: '#bae6fd' }}>tags</code> (optional)</li>
            </ul>
          </li>
          <li>
            Phone numbers must include country code.
            <div style={{ marginTop: 4 }}>
              Example:<br />
              <code style={{ fontFamily: 'monospace', color: '#bae6fd' }}>+919876543210</code>
            </div>
          </li>
          <li>
            Tags must be comma-separated.
            <div style={{ marginTop: 4 }}>
              Example:<br />
              <code style={{ fontFamily: 'monospace', color: '#bae6fd' }}>vip,customer</code>
            </div>
          </li>
          <li>Duplicate phone numbers in the CSV will be skipped.</li>
          <li>Existing contacts are matched using phone number.</li>
          <li>Invalid rows will not be imported.</li>
        </ul>
      </div>
      {file && (
        <Btn onClick={submit} disabled={uploading} style={{ alignSelf:'flex-end', boxShadow: 'var(--glow)' }}>
          {uploading ? 'Uploading…' : 'Import Contacts'}
        </Btn>
      )}
    </div>
  );
};

// ─── Add Contact dialog ────────────────────────────────────────
const AddContactDialog = ({ onClose, onSaved }) => {
  const [tab, setTab] = useState('manual');
  const tabs = [
    { id:'manual', label:'Enter Manually', icon:'edit' },
    { id:'csv',    label:'Upload CSV',     icon:'columns' },
  ];

  return (
    <Modal title="Add Contacts" onClose={onClose}>
      <div style={{ display:'flex', gap:8, marginBottom:18 }}>
        {tabs.map(t => (
          <div key={t.id} onClick={() => setTab(t.id)}
            style={{ padding:'8px 14px', borderRadius:8, border:`1px solid ${tab === t.id ? 'var(--green)' : 'var(--bd)'}`, background: tab === t.id ? 'var(--gbg)' : 'transparent', cursor:'pointer', fontSize:13, fontWeight:500, color: tab === t.id ? 'var(--green)' : 'var(--t2)', transition:'all .15s', display:'flex', alignItems:'center', gap:8 }}>
            {t.label}
          </div>
        ))}
      </div>
      {tab === 'manual' && <ManualTab onSaved={onSaved} />}
      {tab === 'csv'    && <CsvTab    onSaved={onSaved} />}
    </Modal>
  );
};

// ─── Create Cluster modal ──────────────────────────────────────
const CreateClusterModal = ({ onClose, onSaved }) => {
  const [name, setName]               = useState('');
  const [description, setDescription] = useState('');
  const [contacts, setContacts]       = useState([]);
  const [selectedIds, setSelectedIds] = useState(new Set());
  const [search, setSearch]           = useState('');
  const [loading, setLoading]         = useState(true);
  const [saving, setSaving]           = useState(false);
  const [err, setErr]                 = useState(null);

  useEffect(() => {
    wFetch('/contacts?limit=all')
      .then((r) => r.ok && r.json())
      .then((d) => {
        const list = Array.isArray(d) ? d : (d?.data ?? []);
        setContacts(list);
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  const toggle = (id) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  };

  const filtered = contacts.filter(
    (c) =>
      !search ||
      c.name?.toLowerCase().includes(search.toLowerCase()) ||
      c.phoneNumber?.includes(search) ||
      c.email?.toLowerCase().includes(search.toLowerCase())
  );

  const submit = async () => {
    if (!name.trim()) {
      setErr('Cluster name is required.');
      return;
    }
    if (selectedIds.size === 0) {
      setErr('At least one contact must be selected.');
      return;
    }
    setErr(null);
    setSaving(true);
    try {
      const res = await wFetch('/clusters', {
        method: 'POST',
        body: JSON.stringify({
          name: name.trim(),
          description: description.trim() || null,
          contactIds: Array.from(selectedIds),
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        setErr(data.error || `Error ${res.status}`);
        return;
      }
      onSaved?.(data);
      onClose();
    } catch (e) {
      setErr(e.message);
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal title="Create Cluster" onClose={onClose}>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
        {err && (
          <div style={{ padding: '9px 12px', borderRadius: 8, background: 'rgba(239,68,68,.08)', border: '1px solid rgba(239,68,68,.25)', color: '#f87171', fontSize: 12 }}>
            {err}
          </div>
        )}
        <div>
          <FLabel required>Cluster Name</FLabel>
          <FInput value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. VIP Customers, Pune Leads" />
        </div>
        <div>
          <FLabel>Description</FLabel>
          <FInput value={description} onChange={(e) => setDescription(e.target.value)} placeholder="Optional description..." />
        </div>
        <div>
          <FLabel required>Select Contacts</FLabel>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '8px 12px', borderRadius: 8, background: 'rgba(255,255,255,0.03)', border: '1px solid var(--bd)', marginBottom: 10 }}>
            <I n="search" s={13} c="var(--t2)" />
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search contacts…"
              style={{ flex: 1, background: 'none', border: 'none', outline: 'none', color: 'var(--t1)', fontSize: 13, fontFamily: "'Plus Jakarta Sans',sans-serif" }}
            />
          </div>
          <div style={{ maxHeight: 220, overflowY: 'auto', border: '1px solid var(--bd)', borderRadius: 8, padding: 4, display: 'flex', flexDirection: 'column', gap: 2, background: 'rgba(0,0,0,0.15)' }}>
            {loading ? (
              <div style={{ padding: 24, textAlign: 'center', color: 'var(--t2)', fontSize: 12 }}>Loading contacts...</div>
            ) : filtered.length === 0 ? (
              <div style={{ padding: 24, textAlign: 'center', color: 'var(--t2)', fontSize: 12 }}>No contacts found.</div>
            ) : (
              filtered.map((c) => {
                const sel = selectedIds.has(c.id);
                return (
                  <div
                    key={c.id}
                    onClick={() => toggle(c.id)}
                    style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '8px 10px', borderRadius: 6, cursor: 'pointer', background: sel ? 'rgba(30,191,94,0.08)' : 'transparent', transition: 'background .12s' }}
                    onMouseEnter={(e) => { if (!sel) e.currentTarget.style.background = 'rgba(255,255,255,0.03)'; }}
                    onMouseLeave={(e) => { if (!sel) e.currentTarget.style.background = sel ? 'rgba(30,191,94,0.08)' : 'transparent'; }}
                  >
                    <div style={{ width: 16, height: 16, borderRadius: 4, border: `1.5px solid ${sel ? 'var(--green)' : 'var(--bd)'}`, background: sel ? 'var(--green)' : 'transparent', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0, transition: 'all .15s' }}>
                      {sel && <I n="check" s={9} c="#060913" w={3} />}
                    </div>
                    <div style={{ display: 'flex', flexDirection: 'column', flex: 1, overflow: 'hidden' }}>
                      <span style={{ fontSize: 13, fontWeight: 500, color: 'var(--t1)', textOverflow: 'ellipsis', overflow: 'hidden', whiteSpace: 'nowrap' }}>{c.name}</span>
                      <span style={{ fontSize: 11.5, color: 'var(--t2)', fontFamily: 'monospace' }}>{c.phoneNumber}</span>
                    </div>
                  </div>
                );
              })
            )}
          </div>
          <div style={{ marginTop: 8, fontSize: 12, fontWeight: 600, color: selectedIds.size > 0 ? 'var(--green)' : 'var(--t2)', display: 'flex', justifyContent: 'flex-end' }}>
            {selectedIds.size} contact{selectedIds.size !== 1 ? 's' : ''} selected
          </div>
        </div>
        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 10, marginTop: 4, paddingTop: 12, borderTop: '1px solid var(--bd)' }}>
          <Btn variant="outline" onClick={onClose}>Cancel</Btn>
          <Btn onClick={submit} disabled={saving || !name.trim() || selectedIds.size === 0} style={{ boxShadow: name.trim() && selectedIds.size > 0 ? 'var(--glow)' : 'none' }}>
            {saving ? 'Creating…' : 'Create Cluster'}
          </Btn>
        </div>
      </div>
    </Modal>
  );
};

// ─── Main page ─────────────────────────────────────────────────
export default function ContactsView() {
  const [contacts, setContacts]         = useState([]);
  const [total, setTotal]               = useState(0);
  const [search, setSearch]             = useState('');
  const [selected, setSelected]         = useState(new Set());
  const [loading, setLoading]           = useState(false);
  const [addOpen, setAddOpen]           = useState(false);
  const [clusters, setClusters]         = useState([]);
  const [selectedCluster, setSelectedCluster] = useState('');
  const [clusterOpen, setClusterOpen]   = useState(false);

  const load = useCallback(() => {
    setLoading(true);
    wFetch(`/contacts?search=${encodeURIComponent(search)}${selectedCluster ? `&clusterId=${selectedCluster}` : ''}`)
      .then(r => r.ok && r.json())
      .then(d => {
        const list = Array.isArray(d) ? d : (d?.data ?? []);
        setContacts(list);
        setTotal(d?.total ?? list.length);
      })
      .catch(() => {})
      .finally(() => setLoading(false));

    wFetch('/clusters')
      .then(r => r.ok && r.json())
      .then(d => {
        if (Array.isArray(d)) setClusters(d);
      })
      .catch(() => {});
  }, [search, selectedCluster]);

  useEffect(() => { load(); }, [load]);

  // Global header search ("app:search") lands here with the query prefilled.
  useEffect(() => {
    const onSearch = (e) => setSearch(String(e.detail ?? ''));
    window.addEventListener('app:search', onSearch);
    return () => window.removeEventListener('app:search', onSearch);
  }, []);

  const filtered = contacts.filter(c =>
    !search ||
    c.name?.toLowerCase().includes(search.toLowerCase()) ||
    c.phoneNumber?.includes(search)
  );

  const allChecked = filtered.length > 0 && filtered.every(c => selected.has(c.id));

  const toggleAll = () => {
    if (allChecked) setSelected(new Set());
    else setSelected(new Set(filtered.map(c => c.id)));
  };

  const toggle = id => setSelected(prev => {
    const next = new Set(prev);
    next.has(id) ? next.delete(id) : next.add(id);
    return next;
  });

  const selCount = selected.size;

  const Chk = ({ checked, onChange, indeterminate = false }) => (
    <div onClick={onChange} style={{ width:16, height:16, borderRadius:4, border:`1.5px solid ${checked ? 'var(--green)' : 'var(--bd)'}`, background: checked ? 'var(--green)' : 'transparent', display:'flex', alignItems:'center', justifyContent:'center', cursor:'pointer', flexShrink:0, transition:'all .15s', position:'relative' }}>
      {checked && <I n="check" s={9} c="#060913" w={3} />}
      {!checked && indeterminate && <div style={{ width:8, height:2, background:'var(--t2)', borderRadius:2 }} />}
    </div>
  );

  const indeterminate = selCount > 0 && !allChecked;

  return (
    <div style={{ flex:1, display:'flex', flexDirection:'column', overflow:'hidden' }}>
      {/* header */}
      <div style={{ height:58, borderBottom:'1px solid var(--bd)', display:'flex', alignItems:'center', padding:'0 28px', gap:12, flexShrink:0, background:'var(--surf)' }}>
        <div style={{ flex:1 }}>
          <h1 style={{ fontFamily:"'Syne',sans-serif", fontWeight:800, fontSize:16, color:'var(--t1)', letterSpacing:'-.02em' }}>Contacts</h1>
          <p style={{ fontSize:11.5, color:'var(--t2)', marginTop:1 }}>{total} total contacts</p>
        </div>
        <div style={{ display: 'flex', gap: 10 }}>
          <Btn variant="outline" onClick={() => setClusterOpen(true)}>
            <I n="plus" s={14} c="var(--t2)" />
            Create Cluster
          </Btn>
          <Btn onClick={() => setAddOpen(true)} style={{ boxShadow:'var(--glow)' }}>
            <I n="plus" s={14} c="#060A10" />
            Add Contact
          </Btn>
        </div>
      </div>

      {/* filter bar */}
      <div style={{ padding:'12px 28px', borderBottom:'1px solid var(--bd)', display:'flex', gap:10, alignItems:'center', background:'var(--surf)', flexShrink:0 }}>
        <div style={{ flex:1, maxWidth:360, display:'flex', alignItems:'center', gap:8, padding:'8px 12px', borderRadius:8, background:'rgba(255,255,255,0.03)', border:'1px solid var(--bd)' }}>
          <I n="search" s={13} c="var(--t2)" />
          <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Search by name or phone…"
            style={{ flex:1, background:'none', border:'none', outline:'none', color:'var(--t1)', fontSize:13, fontFamily:"'Plus Jakarta Sans',sans-serif" }} />
          {search && (
            <div onClick={() => setSearch('')} style={{ cursor:'pointer', color:'var(--t2)' }}>
              <I n="x" s={12} c="var(--t2)" />
            </div>
          )}
        </div>
        <Btn variant="outline">
          <I n="filter" s={13} c="var(--t2)" />
          Filter
        </Btn>
        <Btn variant="outline">
          <I n="columns" s={13} c="var(--t2)" />
          Columns
        </Btn>
      </div>

      <div style={{ flex:1, display:'flex', overflow:'hidden' }}>
        {/* clusters sidebar */}
        <div style={{ width:240, borderRight:'1px solid var(--bd)', padding:'20px 16px', background:'var(--surf)', overflowY:'auto', flexShrink:0, display:'flex', flexDirection:'column', gap:6 }}>
          <div style={{ padding:'0 4px', marginBottom:6, fontSize:12, fontWeight:700, color:'var(--t3)', textTransform:'uppercase', letterSpacing:'0.04em' }}>
            Clusters
          </div>
          <div
            onClick={() => setSelectedCluster('')}
            style={{
              display:'flex', alignItems:'center', justifyContent:'space-between', padding:'9px 12px', borderRadius:8, cursor:'pointer',
              background: !selectedCluster ? 'var(--gbg)' : 'transparent',
              border: `1px solid ${!selectedCluster ? 'var(--gbd)' : 'transparent'}`,
              color: !selectedCluster ? 'var(--green)' : 'var(--t2)',
              fontSize:13, fontWeight: !selectedCluster ? 600 : 500, transition:'all .15s'
            }}
            onMouseEnter={e => { if (selectedCluster) e.currentTarget.style.background='rgba(255,255,255,0.03)'; }}
            onMouseLeave={e => { if (selectedCluster) e.currentTarget.style.background='transparent'; }}
          >
            <span>All Contacts</span>
          </div>
          {clusters.map((c) => {
            const active = selectedCluster === c.id;
            return (
              <div
                key={c.id}
                onClick={() => setSelectedCluster(c.id)}
                style={{
                  display:'flex', alignItems:'center', justifyContent:'space-between', padding:'9px 12px', borderRadius:8, cursor:'pointer',
                  background: active ? 'var(--gbg)' : 'transparent',
                  border: `1px solid ${active ? 'var(--gbd)' : 'transparent'}`,
                  color: active ? 'var(--green)' : 'var(--t2)',
                  fontSize:13, fontWeight: active ? 600 : 500, transition:'all .15s'
                }}
                onMouseEnter={e => { if (!active) e.currentTarget.style.background='rgba(255,255,255,0.03)'; }}
                onMouseLeave={e => { if (!active) e.currentTarget.style.background='transparent'; }}
              >
                <span style={{ overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap', flex:1 }}>{c.name}</span>
                <span style={{ fontSize:11.5, color: active ? 'var(--green)' : 'var(--t3)', marginLeft:8, fontWeight:500 }}>
                  ({c.memberCount ?? 0})
                </span>
              </div>
            );
          })}
        </div>

        {/* table */}
        <div style={{ flex:1, overflowY:'auto', padding:'20px 28px' }}>
          <div style={{ ...card, overflow:'hidden' }}>
            <table style={{ width:'100%', borderCollapse:'collapse' }}>
              <thead>
                <tr style={{ borderBottom:'1px solid var(--bd)' }}>
                  <th style={{ padding:'10px 16px', width:40 }}>
                    <Chk checked={allChecked} indeterminate={indeterminate} onChange={toggleAll} />
                  </th>
                  <ColHead>Name</ColHead>
                  <ColHead>Phone</ColHead>
                  <ColHead>Email</ColHead>
                  <ColHead>Created</ColHead>
                  <ColHead>Status</ColHead>
                  <ColHead>Tags</ColHead>
                  <th style={{ padding:'10px 16px', width:50 }} />
                </tr>
              </thead>
              <tbody>
                {filtered.length === 0 && (
                  <tr>
                    <td colSpan={8} style={{ padding:'48px 16px', textAlign:'center', color:'var(--t2)', fontSize:13 }}>
                      {loading
                        ? 'Loading…'
                        : selectedCluster ? (
                          <span>No contacts found in this cluster.</span>
                        ) : (
                          <div style={{ display:'flex', flexDirection:'column', alignItems:'center', gap:14 }}>
                            <span>No contacts yet.</span>
                            <Btn onClick={() => setAddOpen(true)} style={{ boxShadow:'var(--glow)' }}>
                              <I n="plus" s={13} c="#060A10" />
                              Add your first contact
                            </Btn>
                          </div>
                        )
                      }
                    </td>
                  </tr>
                )}
                {filtered.map((c, i) => {
                  const sel = selected.has(c.id);
                  return (
                    <tr key={c.id}
                      style={{ borderBottom: i < filtered.length - 1 ? '1px solid var(--bd)' : 'none', background: sel ? 'rgba(30,191,94,0.04)' : 'transparent', transition:'background .12s' }}
                      onMouseEnter={e => { if (!sel) e.currentTarget.style.background = 'rgba(255,255,255,0.015)'; }}
                      onMouseLeave={e => { if (!sel) e.currentTarget.style.background = 'transparent'; }}>
                      <td style={{ padding:'12px 16px' }}>
                        <Chk checked={sel} onChange={() => toggle(c.id)} />
                      </td>
                      <td style={{ padding:'12px 16px' }}>
                        <div style={{ display:'flex', alignItems:'center', gap:10 }}>
                          <Avatar name={c.name} size={30} />
                          <span style={{ fontSize:13, fontWeight:600, color:'var(--t1)' }}>{c.name}</span>
                        </div>
                      </td>
                      <td style={{ padding:'12px 16px', fontSize:13, color:'var(--t2)', fontFamily:'monospace' }}>{c.phoneNumber}</td>
                      <td style={{ padding:'12px 16px', fontSize:12, color:'var(--t2)' }}>{c.email || <span style={{ color:'var(--t3)' }}>—</span>}</td>
                      <td style={{ padding:'12px 16px', fontSize:12, color:'var(--t2)' }}>{fmtDate(c.createdAt)}</td>
                      <td style={{ padding:'12px 16px' }}><StatusBadge optedOut={c.optedOut} /></td>
                      <td style={{ padding:'12px 16px' }}>
                        <div style={{ display:'flex', gap:4, flexWrap:'wrap' }}>
                          {(c.tags ?? []).map(t => <Tag key={t} label={t} />)}
                          {(!c.tags || c.tags.length === 0) && <span style={{ fontSize:11, color:'var(--t3)' }}>—</span>}
                        </div>
                      </td>
                      <td style={{ padding:'12px 16px' }}>
                        <button style={{ width:30, height:30, borderRadius:7, background:'rgba(255,255,255,0.04)', border:'1px solid var(--bd)', cursor:'pointer', display:'flex', alignItems:'center', justifyContent:'center', color:'var(--t2)', transition:'all .15s' }}
                          onMouseEnter={e => { e.currentTarget.style.background = 'rgba(30,191,94,0.1)'; e.currentTarget.style.borderColor = 'var(--gbd)'; }}
                          onMouseLeave={e => { e.currentTarget.style.background = 'rgba(255,255,255,0.04)'; e.currentTarget.style.borderColor = 'var(--bd)'; }}>
                          <I n="msg" s={13} c="var(--t2)" />
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          <p style={{ textAlign:'center', marginTop:14, fontSize:11, color:'var(--t3)' }}>Showing {filtered.length} of {total} contacts</p>
        </div>
      </div>

      {addOpen && (
        <AddContactDialog
          onClose={() => setAddOpen(false)}
          onSaved={() => { load(); }}
        />
      )}
      {clusterOpen && (
        <CreateClusterModal
          onClose={() => setClusterOpen(false)}
          onSaved={() => { load(); }}
        />
      )}
    </div>
  );
}
