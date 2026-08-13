import { useState, useEffect, useRef, useCallback } from 'react';
import { I } from '../components/Icons.jsx';
import { Btn } from '../components/Btn.jsx';
import { wFetch } from '../lib/api.js';

const card = { background: 'var(--surf)', border: '1px solid var(--bd)', borderRadius: 'var(--rl)', boxShadow: 'var(--card-shadow)' };

const Avatar = ({ name = '?', size = 32 }) => {
  const init = name.split(' ').map(n => n[0]).join('').slice(0,2).toUpperCase();
  const colors = ['#35e8f2','#9d6bff','#c4ff46','#F59E0B','#F472B6'];
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
        <span style={{ fontFamily:"'Space Grotesk',sans-serif", fontWeight:700, fontSize:16, color:'var(--t1)' }}>{title}</span>
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
    style={{ width:'100%', padding:'9px 12px', borderRadius:8, background:'rgba(255,255,255,0.04)', border:'1px solid var(--bd)', color:'var(--t1)', fontSize:13, fontFamily:"'Manrope',sans-serif", outline:'none', boxSizing:'border-box' }}
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
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#9d6bff" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ flexShrink:0 }}>
          <circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/>
        </svg>
        <span style={{ fontSize:12, color:'#b9a3ff', lineHeight:1.5 }}>
          Phone numbers must include country code (e.g. <code style={{ fontFamily:'monospace', color:'#b9a3ff' }}>+919876543210</code>). Tags column is comma-separated.
        </span>
      </div>
      <div style={{ padding:'14px 16px', borderRadius:8, background:'rgba(14,165,233,.06)', border:'1px solid rgba(14,165,233,.18)' }}>
        <div style={{ display:'flex', alignItems:'center', gap:8, marginBottom:10 }}>
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="#9d6bff" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ flexShrink:0 }}>
            <circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/>
          </svg>
          <span style={{ fontSize:13, fontWeight:600, color:'#b9a3ff' }}>Instructions for uploading CSV</span>
        </div>
        <ul style={{ paddingLeft: 18, margin: 0, display: 'flex', flexDirection: 'column', gap: 8, fontSize: 12, color: '#b9a3ff', lineHeight: 1.5 }}>
          <li>Upload a CSV file to bulk import contacts.</li>
          <li>
            Required columns:
            <ul style={{ listStyleType: 'none', paddingLeft: 16, marginTop: 6, display: 'flex', flexDirection: 'column', gap: 4 }}>
              <li>- <code style={{ fontFamily: 'monospace', color: '#b9a3ff' }}>phoneNumber</code> (required)</li>
              <li>- <code style={{ fontFamily: 'monospace', color: '#b9a3ff' }}>name</code> (optional)</li>
              <li>- <code style={{ fontFamily: 'monospace', color: '#b9a3ff' }}>email</code> (optional)</li>
              <li>- <code style={{ fontFamily: 'monospace', color: '#b9a3ff' }}>tags</code> (optional)</li>
            </ul>
          </li>
          <li>
            Phone numbers must include country code.
            <div style={{ marginTop: 4 }}>
              Example:<br />
              <code style={{ fontFamily: 'monospace', color: '#b9a3ff' }}>+919876543210</code>
            </div>
          </li>
          <li>
            Tags must be comma-separated.
            <div style={{ marginTop: 4 }}>
              Example:<br />
              <code style={{ fontFamily: 'monospace', color: '#b9a3ff' }}>vip,customer</code>
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

// ─── Edit Contact dialog ───────────────────────────────────────
const EditContactDialog = ({ contact, onClose, onSaved }) => {
  const [name, setName]     = useState(contact.name || '');
  const [phone, setPhone]   = useState(contact.phoneNumber || '');
  const [email, setEmail]   = useState(contact.email || '');
  const [tagsRaw, setTags]  = useState((contact.tags || []).join(', '));
  const [saving, setSaving] = useState(false);
  const [err, setErr]       = useState(null);

  const submit = async () => {
    if (!phone.trim()) { setErr('Phone number is required'); return; }
    setErr(null); setSaving(true);
    try {
      const tags = tagsRaw.split(',').map(t => t.trim()).filter(Boolean);
      const res = await wFetch(`/contacts/${contact.id}`, {
        method:'PATCH',
        body: JSON.stringify({ name: name.trim() || 'Unknown', phoneNumber: phone.trim(), email: email.trim() || null, tags }),
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

  return (
    <Modal title="Edit Contact" onClose={onClose}>
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
          {saving ? 'Saving…' : 'Save Changes'}
        </Btn>
      </div>
    </Modal>
  );
};

// ─── Delete Contact modal ──────────────────────────────────────
const DeleteContactModal = ({ contact, onClose, onDeleted }) => {
  const [deleting, setDeleting] = useState(false);
  const [err, setErr]           = useState(null);

  const confirmDelete = async () => {
    setErr(null); setDeleting(true);
    try {
      const res = await wFetch(`/contacts/${contact.id}`, { method: 'DELETE' });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        setErr(data.error || `Error ${res.status}`);
        return;
      }
      onDeleted?.();
    } catch (e) {
      setErr(e.message);
    } finally {
      setDeleting(false);
    }
  };

  return (
    <Modal title="Delete Contact" onClose={onClose} width={400} footer={
      <>
        <Btn variant="outline" onClick={onClose} disabled={deleting}>Cancel</Btn>
        <Btn onClick={confirmDelete} disabled={deleting} style={{ background: '#f87171', color: '#fff' }}>
          {deleting ? 'Deleting…' : 'Delete'}
        </Btn>
      </>
    }>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
        {err && (
          <div style={{ padding:'9px 12px', borderRadius:8, background:'rgba(239,68,68,.08)', border:'1px solid rgba(239,68,68,.25)', color:'#f87171', fontSize:12 }}>{err}</div>
        )}
        <p style={{ fontSize: 13, color: 'var(--t1)', lineHeight: 1.5 }}>
          Are you sure you want to delete <strong>{contact.name || contact.phoneNumber}</strong>?
        </p>
        <p style={{ fontSize: 13, color: 'var(--t2)', lineHeight: 1.5 }}>
          This action cannot be undone. It will not delete existing conversations or campaign histories for this contact, but they will no longer appear in your contact list.
        </p>
      </div>
    </Modal>
  );
};

// ─── Delete Multiple Contacts modal ──────────────────────────────────────
const DeleteMultipleModal = ({ selectedIds, onClose, onDeleted }) => {
  const [deleting, setDeleting] = useState(false);
  const [err, setErr]           = useState(null);

  const confirmDelete = async () => {
    setErr(null); setDeleting(true);
    try {
      const ids = Array.from(selectedIds);
      const errors = [];
      for (const id of ids) {
        try {
          const res = await wFetch(`/contacts/${id}`, { method: 'DELETE' });
          if (!res.ok) throw new Error(`Failed to delete ${id}`);
        } catch (e) {
          errors.push(e.message);
        }
      }
      if (errors.length > 0) throw new Error(`Failed to delete ${errors.length} contacts.`);
      onDeleted?.();
    } catch (e) {
      setErr(e.message);
    } finally {
      setDeleting(false);
    }
  };

  return (
    <Modal title="Delete Contacts" onClose={onClose} width={400} footer={
      <>
        <Btn variant="outline" onClick={onClose} disabled={deleting}>Cancel</Btn>
        <Btn onClick={confirmDelete} disabled={deleting} style={{ background: '#f87171', color: '#fff' }}>
          {deleting ? 'Deleting…' : 'Delete'}
        </Btn>
      </>
    }>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
        {err && (
          <div style={{ padding:'9px 12px', borderRadius:8, background:'rgba(239,68,68,.08)', border:'1px solid rgba(239,68,68,.25)', color:'#f87171', fontSize:12 }}>{err}</div>
        )}
        <p style={{ fontSize: 13, color: 'var(--t1)', lineHeight: 1.5 }}>
          Are you sure you want to delete <strong>{selectedIds.size}</strong> selected contact{selectedIds.size > 1 ? 's' : ''}?
        </p>
        <p style={{ fontSize: 13, color: 'var(--t2)', lineHeight: 1.5 }}>
          This action cannot be undone. It will not delete existing conversations or campaign histories, but they will no longer appear in your contact list.
        </p>
      </div>
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
              style={{ flex: 1, background: 'none', border: 'none', outline: 'none', color: 'var(--t1)', fontSize: 13, fontFamily: "'Manrope',sans-serif" }}
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
                    style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '8px 10px', borderRadius: 6, cursor: 'pointer', background: sel ? 'rgba(53,232,242,0.08)' : 'transparent', transition: 'background .12s' }}
                    onMouseEnter={(e) => { if (!sel) e.currentTarget.style.background = 'rgba(255,255,255,0.03)'; }}
                    onMouseLeave={(e) => { if (!sel) e.currentTarget.style.background = sel ? 'rgba(53,232,242,0.08)' : 'transparent'; }}
                  >
                    <div style={{ width: 16, height: 16, borderRadius: 4, border: `1.5px solid ${sel ? 'var(--green)' : 'var(--bd)'}`, background: sel ? 'var(--green)' : 'transparent', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0, transition: 'all .15s' }}>
                      {sel && <I n="check" s={9} c="#08090c" w={3} />}
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
// Sort choices offered in the UI. The ids match the whitelist the contacts
// service accepts (services/contacts.service.js CONTACT_SORTS) — the server
// does the ordering, so it holds across pages instead of only reordering
// whatever page happens to be loaded.
const SORT_OPTIONS = [
  { id: 'newest',           label: 'Newest First' },
  { id: 'oldest',           label: 'Oldest First' },
  { id: 'name_asc',         label: 'Name — A to Z' },
  { id: 'name_desc',        label: 'Name — Z to A' },
  { id: 'recently_updated', label: 'Recently Updated' },
  { id: 'phone',            label: 'Phone Number' },
];

const EMPTY_FILTERS = {
  status: '', segmentId: '', tags: [],
  createdFrom: '', createdTo: '', updatedFrom: '', updatedTo: '',
};

const PAGE_SIZE = 20;

export default function ContactsView() {
  const [contacts, setContacts]         = useState([]);
  const [total, setTotal]               = useState(0);
  const [search, setSearch]             = useState('');
  const [selected, setSelected]         = useState(new Set());
  const [loading, setLoading]           = useState(false);
  const [addOpen, setAddOpen]           = useState(false);
  const [editingContact, setEditingContact] = useState(null);
  const [deletingContact, setDeletingContact] = useState(null);
  const [deletingMultiple, setDeletingMultiple] = useState(false);
  const [clusters, setClusters]         = useState([]);
  const [selectedCluster, setSelectedCluster] = useState('');
  const [clusterOpen, setClusterOpen]   = useState(false);

  // Search / filter / sort / page are all query parameters — the server does
  // the work. Filtering a fetched page in the browser (which is what this
  // screen used to do) silently hides every match that lives on another page.
  const [filters, setFilters]   = useState(EMPTY_FILTERS);
  const [sort, setSort]         = useState('newest');
  const [page, setPage]         = useState(1);
  const [filterOpen, setFilterOpen] = useState(false);
  const [sortOpen, setSortOpen] = useState(false);
  const [availableTags, setAvailableTags] = useState([]);
  const [segments, setSegments] = useState([]);

  // Typing shouldn't fire a request per keystroke.
  const [debouncedSearch, setDebouncedSearch] = useState('');
  useEffect(() => {
    const t = setTimeout(() => setDebouncedSearch(search), 300);
    return () => clearTimeout(t);
  }, [search]);

  const activeFilterCount =
    (filters.status ? 1 : 0) +
    (filters.segmentId ? 1 : 0) +
    (filters.tags.length ? 1 : 0) +
    (filters.createdFrom || filters.createdTo ? 1 : 0) +
    (filters.updatedFrom || filters.updatedTo ? 1 : 0);
  const isFiltered = activeFilterCount > 0 || !!debouncedSearch || !!selectedCluster;

  // Any change to what is being asked for has to reset to page 1, or the list
  // lands on a page that no longer exists and reads as "no results".
  useEffect(() => { setPage(1); }, [debouncedSearch, filters, sort, selectedCluster]);

  // Guards against a slow response for an older query landing after a newer
  // one and repopulating the table with stale rows.
  const loadToken = useRef(0);

  const load = useCallback(() => {
    setLoading(true);
    const qs = new URLSearchParams({ page: String(page), limit: String(PAGE_SIZE), sort });
    if (debouncedSearch) qs.set('search', debouncedSearch);
    if (selectedCluster) qs.set('clusterId', selectedCluster);
    if (filters.status) qs.set('status', filters.status);
    if (filters.segmentId) qs.set('segmentId', filters.segmentId);
    if (filters.tags.length) qs.set('tags', filters.tags.join(','));
    for (const k of ['createdFrom', 'createdTo', 'updatedFrom', 'updatedTo']) {
      if (filters[k]) qs.set(k, filters[k]);
    }

    const token = ++loadToken.current;
    wFetch(`/contacts?${qs.toString()}`)
      .then(r => r.ok && r.json())
      .then(d => {
        if (token !== loadToken.current) return;
        const list = Array.isArray(d) ? d : (d?.data ?? []);
        setContacts(list);
        setTotal(d?.total ?? list.length);
        // Selections refer to rows that are no longer on screen.
        setSelected(new Set());
      })
      .catch(() => {})
      .finally(() => { if (token === loadToken.current) setLoading(false); });
  }, [debouncedSearch, selectedCluster, filters, sort, page]);

  useEffect(() => { load(); }, [load]);

  // Filter options: clusters (sidebar), segments and the tags actually in use.
  useEffect(() => {
    wFetch('/clusters').then(r => r.ok && r.json())
      .then(d => { if (Array.isArray(d)) setClusters(d); }).catch(() => {});
    wFetch('/segments').then(r => r.ok && r.json())
      .then(d => { if (Array.isArray(d)) setSegments(d); else if (Array.isArray(d?.data)) setSegments(d.data); }).catch(() => {});
    wFetch('/contacts/tags').then(r => r.ok && r.json())
      .then(d => { if (Array.isArray(d)) setAvailableTags(d); }).catch(() => {});
  }, []);

  // Global header search ("app:search") lands here with the query prefilled.
  useEffect(() => {
    const onSearch = (e) => setSearch(String(e.detail ?? ''));
    window.addEventListener('app:search', onSearch);
    return () => window.removeEventListener('app:search', onSearch);
  }, []);

  const clearFilters = () => {
    setFilters(EMPTY_FILTERS);
    setSearch('');
    setSelectedCluster('');
    setSort('newest');
    setFilterOpen(false);
  };

  const toggleTag = (tag) => setFilters(f => ({
    ...f,
    tags: f.tags.includes(tag) ? f.tags.filter(t => t !== tag) : [...f.tags, tag],
  }));

  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));

  const allChecked = contacts.length > 0 && contacts.every(c => selected.has(c.id));

  const toggleAll = () => {
    if (allChecked) setSelected(new Set());
    else setSelected(new Set(contacts.map(c => c.id)));
  };

  const toggle = id => setSelected(prev => {
    const next = new Set(prev);
    next.has(id) ? next.delete(id) : next.add(id);
    return next;
  });

  const selCount = selected.size;

  const Chk = ({ checked, onChange, indeterminate = false }) => (
    <div onClick={onChange} style={{ width:16, height:16, borderRadius:4, border:`1.5px solid ${checked ? 'var(--green)' : 'var(--bd)'}`, background: checked ? 'var(--green)' : 'transparent', display:'flex', alignItems:'center', justifyContent:'center', cursor:'pointer', flexShrink:0, transition:'all .15s', position:'relative' }}>
      {checked && <I n="check" s={9} c="#08090c" w={3} />}
      {!checked && indeterminate && <div style={{ width:8, height:2, background:'var(--t2)', borderRadius:2 }} />}
    </div>
  );

  const indeterminate = selCount > 0 && !allChecked;

  return (
    <div style={{ flex:1, display:'flex', flexDirection:'column', overflow:'hidden' }}>
      {/* header */}
      <div style={{ height:58, borderBottom:'1px solid var(--bd)', display:'flex', alignItems:'center', padding:'0 28px', gap:12, flexShrink:0, background:'var(--surf)' }}>
        <div style={{ flex:1 }}>
          <h1 style={{ fontFamily:"'Space Grotesk',sans-serif", fontWeight:800, fontSize:16, color:'var(--t1)', letterSpacing:'-.02em' }}>Contacts</h1>
          <p style={{ fontSize:11.5, color:'var(--t2)', marginTop:1 }}>{total} total contacts</p>
        </div>
        <div style={{ display: 'flex', gap: 10 }}>
          {selCount > 0 && (
            <Btn variant="outline" onClick={() => setDeletingMultiple(true)} style={{ borderColor: 'rgba(239,68,68,0.3)', color: '#f87171', background: 'rgba(239,68,68,0.05)' }}>
              <I n="trash" s={14} c="#f87171" />
              Delete {selCount} selected
            </Btn>
          )}
          <Btn variant="outline" onClick={() => setClusterOpen(true)}>
            <I n="plus" s={14} c="var(--t2)" />
            Create Cluster
          </Btn>
          <Btn onClick={() => setAddOpen(true)} style={{ boxShadow:'var(--glow)' }}>
            <I n="plus" s={14} c="#08090c" />
            Add Contact
          </Btn>
        </div>
      </div>

      {/* filter bar */}
      <div style={{ padding:'12px 28px', borderBottom:'1px solid var(--bd)', display:'flex', gap:10, alignItems:'center', background:'var(--surf)', flexShrink:0, flexWrap:'wrap' }}>
        <div style={{ flex:1, maxWidth:360, minWidth:200, display:'flex', alignItems:'center', gap:8, padding:'8px 12px', borderRadius:8, background:'rgba(255,255,255,0.03)', border:'1px solid var(--bd)' }}>
          <I n="search" s={13} c="var(--t2)" />
          <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Search by name, phone or email…"
            style={{ flex:1, background:'none', border:'none', outline:'none', color:'var(--t1)', fontSize:13, fontFamily:"'Manrope',sans-serif" }} />
          {search && (
            <div onClick={() => setSearch('')} style={{ cursor:'pointer', color:'var(--t2)' }}>
              <I n="x" s={12} c="var(--t2)" />
            </div>
          )}
        </div>

        {/* Filter */}
        <div style={{ position:'relative' }}>
          <Btn variant="outline" onClick={() => { setFilterOpen(o => !o); setSortOpen(false); }}
            style={activeFilterCount ? { borderColor:'var(--gbd)', color:'var(--green)' } : {}}>
            <I n="filter" s={13} c={activeFilterCount ? 'var(--green)' : 'var(--t2)'} />
            Filter
            {activeFilterCount > 0 && (
              <span style={{ marginLeft:2, padding:'1px 6px', borderRadius:8, fontSize:10, fontWeight:800, background:'var(--green)', color:'#08090c' }}>{activeFilterCount}</span>
            )}
          </Btn>

          {filterOpen && (
            <>
              {/* click-away */}
              <div onClick={() => setFilterOpen(false)} style={{ position:'fixed', inset:0, zIndex:40 }} />
              <div style={{ ...card, position:'absolute', top:'calc(100% + 8px)', left:0, width:320, zIndex:41, padding:16, display:'flex', flexDirection:'column', gap:14, maxHeight:'70vh', overflowY:'auto' }}>

                <div>
                  <FLabel>Status</FLabel>
                  <div style={{ display:'flex', gap:6 }}>
                    {[['', 'Any'], ['active', 'Active'], ['opted_out', 'Opted Out']].map(([v, label]) => (
                      <button key={v} type="button" onClick={() => setFilters(f => ({ ...f, status: v }))}
                        style={{ flex:1, padding:'7px 8px', borderRadius:7, cursor:'pointer', fontSize:12, fontWeight:600,
                                 fontFamily:"'Manrope',sans-serif",
                                 border:`1px solid ${filters.status === v ? 'var(--gbd)' : 'var(--bd)'}`,
                                 background: filters.status === v ? 'var(--gbg)' : 'rgba(255,255,255,0.03)',
                                 color: filters.status === v ? 'var(--green)' : 'var(--t2)' }}>
                        {label}
                      </button>
                    ))}
                  </div>
                </div>

                {segments.length > 0 && (
                  <div>
                    <FLabel>Group</FLabel>
                    <select value={filters.segmentId} onChange={e => setFilters(f => ({ ...f, segmentId: e.target.value }))}
                      style={{ width:'100%', padding:'8px 10px', borderRadius:8, background:'rgba(255,255,255,0.04)', border:'1px solid var(--bd)', color:'var(--t1)', fontSize:13, fontFamily:"'Manrope',sans-serif", outline:'none', appearance:'auto', colorScheme:'dark' }}>
                      <option value="">Any group</option>
                      {segments.map(sg => <option key={sg.id} value={sg.id}>{sg.name}</option>)}
                    </select>
                  </div>
                )}

                <div>
                  <FLabel>Tags</FLabel>
                  {availableTags.length === 0 ? (
                    <p style={{ fontSize:11.5, color:'var(--t3)' }}>No tags in use yet.</p>
                  ) : (
                    <div style={{ display:'flex', flexWrap:'wrap', gap:6 }}>
                      {availableTags.map(t => {
                        const on = filters.tags.includes(t.name);
                        return (
                          <button key={t.name} type="button" onClick={() => toggleTag(t.name)}
                            style={{ padding:'4px 10px', borderRadius:20, cursor:'pointer', fontSize:11.5, fontWeight:600,
                                     fontFamily:"'Manrope',sans-serif",
                                     border:`1px solid ${on ? 'var(--gbd)' : 'var(--bd)'}`,
                                     background: on ? 'var(--gbg)' : 'rgba(255,255,255,0.03)',
                                     color: on ? 'var(--green)' : 'var(--t2)' }}>
                            {t.name} <span style={{ opacity:.6 }}>{t.count}</span>
                          </button>
                        );
                      })}
                    </div>
                  )}
                  {filters.tags.length > 1 && (
                    <p style={{ fontSize:10.5, color:'var(--t3)', marginTop:5 }}>Showing contacts with any of these tags.</p>
                  )}
                </div>

                <div>
                  <FLabel>Created between</FLabel>
                  <div style={{ display:'flex', gap:6, alignItems:'center' }}>
                    <input type="date" value={filters.createdFrom} onChange={e => setFilters(f => ({ ...f, createdFrom: e.target.value }))}
                      style={{ flex:1, padding:'7px 9px', borderRadius:7, background:'rgba(255,255,255,0.04)', border:'1px solid var(--bd)', color:'var(--t1)', fontSize:12, outline:'none', colorScheme:'dark' }} />
                    <span style={{ fontSize:11, color:'var(--t3)' }}>to</span>
                    <input type="date" value={filters.createdTo} onChange={e => setFilters(f => ({ ...f, createdTo: e.target.value }))}
                      style={{ flex:1, padding:'7px 9px', borderRadius:7, background:'rgba(255,255,255,0.04)', border:'1px solid var(--bd)', color:'var(--t1)', fontSize:12, outline:'none', colorScheme:'dark' }} />
                  </div>
                </div>

                <div>
                  <FLabel>Updated between</FLabel>
                  <div style={{ display:'flex', gap:6, alignItems:'center' }}>
                    <input type="date" value={filters.updatedFrom} onChange={e => setFilters(f => ({ ...f, updatedFrom: e.target.value }))}
                      style={{ flex:1, padding:'7px 9px', borderRadius:7, background:'rgba(255,255,255,0.04)', border:'1px solid var(--bd)', color:'var(--t1)', fontSize:12, outline:'none', colorScheme:'dark' }} />
                    <span style={{ fontSize:11, color:'var(--t3)' }}>to</span>
                    <input type="date" value={filters.updatedTo} onChange={e => setFilters(f => ({ ...f, updatedTo: e.target.value }))}
                      style={{ flex:1, padding:'7px 9px', borderRadius:7, background:'rgba(255,255,255,0.04)', border:'1px solid var(--bd)', color:'var(--t1)', fontSize:12, outline:'none', colorScheme:'dark' }} />
                  </div>
                </div>

                <div style={{ display:'flex', justifyContent:'space-between', gap:8, borderTop:'1px solid var(--bd)', paddingTop:12 }}>
                  <Btn variant="ghost" size="sm" onClick={clearFilters}>Clear all</Btn>
                  <Btn size="sm" onClick={() => setFilterOpen(false)}>Done</Btn>
                </div>
              </div>
            </>
          )}
        </div>

        {/* Sort */}
        <div style={{ position:'relative' }}>
          <Btn variant="outline" onClick={() => { setSortOpen(o => !o); setFilterOpen(false); }}>
            <I n="columns" s={13} c="var(--t2)" />
            {SORT_OPTIONS.find(o => o.id === sort)?.label || 'Sort'}
          </Btn>
          {sortOpen && (
            <>
              <div onClick={() => setSortOpen(false)} style={{ position:'fixed', inset:0, zIndex:40 }} />
              <div style={{ ...card, position:'absolute', top:'calc(100% + 8px)', right:0, width:210, zIndex:41, padding:6 }}>
                {SORT_OPTIONS.map(o => (
                  <div key={o.id} onClick={() => { setSort(o.id); setSortOpen(false); }}
                    style={{ padding:'8px 11px', borderRadius:7, cursor:'pointer', fontSize:12.5,
                             fontWeight: sort === o.id ? 700 : 500,
                             color: sort === o.id ? 'var(--green)' : 'var(--t2)',
                             background: sort === o.id ? 'var(--gbg)' : 'transparent' }}
                    onMouseEnter={e => { if (sort !== o.id) e.currentTarget.style.background = 'rgba(255,255,255,0.03)'; }}
                    onMouseLeave={e => { if (sort !== o.id) e.currentTarget.style.background = 'transparent'; }}>
                    {o.label}
                  </div>
                ))}
              </div>
            </>
          )}
        </div>

        {isFiltered && (
          <Btn variant="ghost" size="sm" onClick={clearFilters}>
            <I n="x" s={12} c="var(--t2)" />
            Clear Filters
          </Btn>
        )}
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
                  <th style={{ padding:'10px 16px', width:120 }} />
                </tr>
              </thead>
              <tbody>
                {contacts.length === 0 && (
                  <tr>
                    <td colSpan={8} style={{ padding:'48px 16px', textAlign:'center', color:'var(--t2)', fontSize:13 }}>
                      {loading
                        ? 'Loading…'
                        : isFiltered ? (
                          // An empty result under a filter is a different thing
                          // from an empty address book, and offering "add your
                          // first contact" to someone with 500 of them is wrong.
                          <div style={{ display:'flex', flexDirection:'column', alignItems:'center', gap:12 }}>
                            <span>No contacts found.</span>
                            <span style={{ fontSize:11.5, color:'var(--t3)' }}>No contacts match the current search and filters.</span>
                            <Btn variant="outline" size="sm" onClick={clearFilters}>Clear Filters</Btn>
                          </div>
                        ) : (
                          <div style={{ display:'flex', flexDirection:'column', alignItems:'center', gap:14 }}>
                            <span>No contacts yet.</span>
                            <Btn onClick={() => setAddOpen(true)} style={{ boxShadow:'var(--glow)' }}>
                              <I n="plus" s={13} c="#08090c" />
                              Add your first contact
                            </Btn>
                          </div>
                        )
                      }
                    </td>
                  </tr>
                )}
                {contacts.map((c, i) => {
                  const sel = selected.has(c.id);
                  return (
                    <tr key={c.id}
                      style={{ borderBottom: i < contacts.length - 1 ? '1px solid var(--bd)' : 'none', background: sel ? 'rgba(53,232,242,0.04)' : 'transparent', transition:'background .12s' }}
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
                        <div style={{ display:'flex', gap:6, justifyContent:'flex-end' }}>
                          <button style={{ width:30, height:30, borderRadius:7, background:'rgba(255,255,255,0.04)', border:'1px solid var(--bd)', cursor:'pointer', display:'flex', alignItems:'center', justifyContent:'center', color:'var(--t2)', transition:'all .15s', flexShrink:0 }}
                            onMouseEnter={e => { e.currentTarget.style.background = 'rgba(53,232,242,0.1)'; e.currentTarget.style.borderColor = 'var(--gbd)'; }}
                            onMouseLeave={e => { e.currentTarget.style.background = 'rgba(255,255,255,0.04)'; e.currentTarget.style.borderColor = 'var(--bd)'; }}>
                            <I n="msg" s={13} c="var(--t2)" />
                          </button>
                          <button style={{ width:30, height:30, borderRadius:7, background:'rgba(255,255,255,0.04)', border:'1px solid var(--bd)', cursor:'pointer', display:'flex', alignItems:'center', justifyContent:'center', color:'var(--t2)', transition:'all .15s', flexShrink:0 }}
                            onClick={() => setEditingContact(c)}
                            onMouseEnter={e => { e.currentTarget.style.background = 'rgba(14,165,233,0.1)'; e.currentTarget.style.borderColor = 'rgba(14,165,233,0.3)'; }}
                            onMouseLeave={e => { e.currentTarget.style.background = 'rgba(255,255,255,0.04)'; e.currentTarget.style.borderColor = 'var(--bd)'; }}>
                            <I n="pencil" s={13} c="var(--t2)" />
                          </button>
                          <button style={{ width:30, height:30, borderRadius:7, background:'rgba(255,255,255,0.04)', border:'1px solid var(--bd)', cursor:'pointer', display:'flex', alignItems:'center', justifyContent:'center', color:'#f87171', transition:'all .15s', flexShrink:0 }}
                            onClick={() => setDeletingContact(c)}
                            onMouseEnter={e => { e.currentTarget.style.background = 'rgba(239,68,68,0.1)'; e.currentTarget.style.borderColor = 'rgba(239,68,68,0.3)'; }}
                            onMouseLeave={e => { e.currentTarget.style.background = 'rgba(255,255,255,0.04)'; e.currentTarget.style.borderColor = 'var(--bd)'; }}>
                            <I n="trash" s={13} c="#f87171" />
                          </button>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          {/* Pagination over the filtered+sorted result, not over the page. */}
          <div style={{ marginTop:14, display:'flex', alignItems:'center', justifyContent:'space-between', gap:12, flexWrap:'wrap' }}>
            <p style={{ fontSize:11, color:'var(--t3)' }}>
              {total === 0
                ? 'No contacts'
                : `Showing ${(page - 1) * PAGE_SIZE + 1}–${Math.min(page * PAGE_SIZE, total)} of ${total} contact${total === 1 ? '' : 's'}`}
            </p>
            {totalPages > 1 && (
              <div style={{ display:'flex', alignItems:'center', gap:8 }}>
                <Btn variant="outline" size="sm" disabled={page <= 1 || loading} onClick={() => setPage(p => Math.max(1, p - 1))}>
                  Previous
                </Btn>
                <span style={{ fontSize:12, color:'var(--t2)' }}>Page {page} of {totalPages}</span>
                <Btn variant="outline" size="sm" disabled={page >= totalPages || loading} onClick={() => setPage(p => Math.min(totalPages, p + 1))}>
                  Next
                </Btn>
              </div>
            )}
          </div>
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
      {editingContact && (
        <EditContactDialog
          contact={editingContact}
          onClose={() => setEditingContact(null)}
          onSaved={() => { setEditingContact(null); load(); }}
        />
      )}
      {deletingContact && (
        <DeleteContactModal
          contact={deletingContact}
          onClose={() => setDeletingContact(null)}
          onDeleted={() => { setDeletingContact(null); load(); }}
        />
      )}
      {deletingMultiple && (
        <DeleteMultipleModal
          selectedIds={selected}
          onClose={() => setDeletingMultiple(false)}
          onDeleted={() => { setDeletingMultiple(false); setSelected(new Set()); load(); }}
        />
      )}
    </div>
  );
}
