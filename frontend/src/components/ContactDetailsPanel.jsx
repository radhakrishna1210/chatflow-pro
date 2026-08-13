import { useState, useEffect, useCallback } from 'react';
import { I } from './Icons.jsx';
import { Btn } from './Btn.jsx';
import { wFetch } from '../lib/api.js';

// Contact details for whichever conversation is open in the inbox.
//
// Everything here is the same record the Contacts section edits — it is read
// from GET /contacts/:id and written back with PATCH /contacts/:id, so a tag
// added from the inbox is the same tag the contact list filters on. Nothing on
// this panel keeps its own copy of a contact.

const Avatar = ({ name = '?', size = 52 }) => {
  const init = String(name).split(' ').map(n => n[0]).join('').slice(0, 2).toUpperCase() || '?';
  const colors = ['#35e8f2', '#9d6bff', '#c4ff46', '#F59E0B', '#F472B6'];
  const c = colors[init.charCodeAt(0) % colors.length];
  return (
    <div style={{ width: size, height: size, borderRadius: '50%', background: `${c}18`, border: `1.5px solid ${c}44`, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: size * .34 + 'px', fontWeight: 700, color: c, flexShrink: 0 }}>
      {init}
    </div>
  );
};

const fmtDate = (d) => (d ? new Date(d).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' }) : '—');
const fmtDateTime = (d) => (d ? new Date(d).toLocaleString('en-IN', { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' }) : '—');

const Section = ({ title, children, action }) => (
  <div style={{ padding: '14px 16px', borderBottom: '1px solid var(--bd)' }}>
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 9 }}>
      <p style={{ fontSize: 10.5, fontWeight: 700, color: 'var(--t3)', textTransform: 'uppercase', letterSpacing: '.07em' }}>{title}</p>
      {action}
    </div>
    {children}
  </div>
);

const Field = ({ label, value, mono = false }) => (
  <div style={{ marginBottom: 9 }}>
    <p style={{ fontSize: 10.5, color: 'var(--t3)', marginBottom: 2 }}>{label}</p>
    <p style={{ fontSize: 12.5, color: 'var(--t1)', wordBreak: 'break-word', fontFamily: mono ? 'monospace' : undefined }}>
      {value || <span style={{ color: 'var(--t3)' }}>—</span>}
    </p>
  </div>
);

const inputStyle = {
  width: '100%', padding: '7px 10px', borderRadius: 7, background: 'rgba(255,255,255,0.04)',
  border: '1px solid var(--bd)', color: 'var(--t1)', fontSize: 12.5,
  fontFamily: "'Manrope',sans-serif", outline: 'none', boxSizing: 'border-box',
};

export default function ContactDetailsPanel({ contactId, onClose, onContactUpdated, asDrawer = false }) {
  const [contact, setContact] = useState(null);
  const [segments, setSegments] = useState([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState(null);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState({ name: '', email: '' });
  const [saving, setSaving] = useState(false);
  const [newTag, setNewTag] = useState('');
  const [addingGroup, setAddingGroup] = useState(false);

  const load = useCallback(() => {
    if (!contactId) return;
    setLoading(true);
    setErr(null);
    wFetch(`/contacts/${contactId}`)
      .then(r => (r.ok ? r.json() : Promise.reject(new Error('Could not load this contact'))))
      .then(d => { setContact(d); setDraft({ name: d.name || '', email: d.email || '' }); })
      .catch(e => setErr(e.message))
      .finally(() => setLoading(false));
  }, [contactId]);

  // Switching conversations swaps the whole panel, so the edit form must not
  // survive into the next contact with the previous one's values in it.
  useEffect(() => { setEditing(false); setNewTag(''); setAddingGroup(false); load(); }, [load]);

  useEffect(() => {
    wFetch('/segments').then(r => r.ok && r.json())
      .then(d => { if (Array.isArray(d)) setSegments(d); else if (Array.isArray(d?.data)) setSegments(d.data); })
      .catch(() => {});
  }, []);

  // Every write goes through the contacts API and then re-reads, so the panel
  // shows what was actually stored rather than what was optimistically hoped.
  const patch = async (updates) => {
    setSaving(true); setErr(null);
    try {
      const res = await wFetch(`/contacts/${contactId}`, { method: 'PATCH', body: JSON.stringify(updates) });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) { setErr(data.error || `Could not save (${res.status})`); return false; }
      setContact(c => ({ ...c, ...data }));
      onContactUpdated?.(data);
      return true;
    } catch (e) {
      setErr(e.message); return false;
    } finally {
      setSaving(false);
    }
  };

  const saveEdit = async () => {
    const ok = await patch({ name: draft.name.trim() || contact.name, email: draft.email.trim() || null });
    if (ok) setEditing(false);
  };

  const addTag = async () => {
    const tag = newTag.trim();
    if (!tag || (contact.tags || []).includes(tag)) { setNewTag(''); return; }
    if (await patch({ tags: [...(contact.tags || []), tag] })) setNewTag('');
  };

  const removeTag = (tag) => patch({ tags: (contact.tags || []).filter(t => t !== tag) });

  const addToGroup = async (segmentId) => {
    if (!segmentId) return;
    setSaving(true); setErr(null);
    try {
      const res = await wFetch(`/segments/${segmentId}/contacts`, {
        method: 'POST', body: JSON.stringify({ contactId }),
      });
      if (!res.ok) {
        const d = await res.json().catch(() => ({}));
        setErr(d.error || 'Could not add to that group');
        return;
      }
      setAddingGroup(false);
      load();
    } catch (e) { setErr(e.message); } finally { setSaving(false); }
  };

  const removeFromGroup = async (segmentId) => {
    setSaving(true); setErr(null);
    try {
      const res = await wFetch(`/segments/${segmentId}/contacts/${contactId}`, { method: 'DELETE' });
      if (!res.ok && res.status !== 204) {
        const d = await res.json().catch(() => ({}));
        setErr(d.error || 'Could not remove from that group');
        return;
      }
      load();
    } catch (e) { setErr(e.message); } finally { setSaving(false); }
  };

  // Opens the Contacts section with this contact's number already searched —
  // reusing the navigation and search events the app already has rather than
  // building a second contact route.
  const viewInContacts = () => {
    window.dispatchEvent(new CustomEvent('app:nav', { detail: 'contacts' }));
    setTimeout(() => window.dispatchEvent(new CustomEvent('app:search', { detail: contact?.phoneNumber || '' })), 50);
  };

  const shell = {
    width: asDrawer ? 'min(340px, 88vw)' : 300,
    borderLeft: '1px solid var(--bd)',
    background: 'var(--surf)',
    display: 'flex',
    flexDirection: 'column',
    flexShrink: 0,
    overflowY: 'auto',
    ...(asDrawer
      ? { position: 'fixed', top: 0, right: 0, bottom: 0, zIndex: 60, boxShadow: '-8px 0 32px rgba(0,0,0,0.45)' }
      : {}),
  };

  const availableGroups = segments.filter(sg => !(contact?.segments || []).some(s => s.id === sg.id));

  return (
    <>
      {asDrawer && <div onClick={onClose} style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.5)', zIndex: 59 }} />}
      <div style={shell}>
        <div style={{ padding: '12px 16px', borderBottom: '1px solid var(--bd)', display: 'flex', alignItems: 'center', justifyContent: 'space-between', position: 'sticky', top: 0, background: 'var(--surf)', zIndex: 1 }}>
          <p style={{ fontFamily: "'Space Grotesk',sans-serif", fontWeight: 700, fontSize: 13.5, color: 'var(--t1)' }}>Contact Details</p>
          {onClose && (
            <button onClick={onClose} aria-label="Close contact details"
              style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--t2)', display: 'flex', padding: 2 }}>
              <I n="x" s={15} c="var(--t2)" />
            </button>
          )}
        </div>

        {loading && <p style={{ padding: '24px 16px', fontSize: 12, color: 'var(--t2)', textAlign: 'center' }}>Loading…</p>}

        {!loading && err && !contact && (
          <p style={{ padding: '24px 16px', fontSize: 12, color: '#f87171', textAlign: 'center' }}>{err}</p>
        )}

        {!loading && contact && (
          <>
            {err && (
              <div style={{ margin: '10px 16px 0', padding: '8px 11px', borderRadius: 7, background: 'rgba(239,68,68,.08)', border: '1px solid rgba(239,68,68,.25)', color: '#f87171', fontSize: 11.5 }}>{err}</div>
            )}

            {/* identity */}
            <div style={{ padding: '16px', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 9, borderBottom: '1px solid var(--bd)' }}>
              <Avatar name={contact.name} size={52} />
              {editing ? (
                <input value={draft.name} onChange={e => setDraft(d => ({ ...d, name: e.target.value }))}
                  placeholder="Contact name" style={{ ...inputStyle, textAlign: 'center' }} />
              ) : (
                <p style={{ fontFamily: "'Space Grotesk',sans-serif", fontWeight: 700, fontSize: 15, color: 'var(--t1)', textAlign: 'center', wordBreak: 'break-word' }}>{contact.name}</p>
              )}
              <span style={{
                padding: '2px 9px', borderRadius: 12, fontSize: 10.5, fontWeight: 600,
                background: contact.optedOut ? 'rgba(255,255,255,0.04)' : 'var(--gbg)',
                border: `1px solid ${contact.optedOut ? 'var(--bd)' : 'var(--gbd)'}`,
                color: contact.optedOut ? 'var(--t2)' : 'var(--green)',
              }}>
                {contact.optedOut ? 'Opted Out' : 'Active'}
              </span>
            </div>

            {/* profile */}
            <Section
              title="Profile"
              action={editing ? null : (
                <button onClick={() => setEditing(true)}
                  style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--green)', fontSize: 11, fontWeight: 600, display: 'flex', alignItems: 'center', gap: 4, padding: 0 }}>
                  <I n="pencil" s={11} c="var(--green)" /> Edit
                </button>
              )}>
              <Field label="Phone Number" value={contact.phoneNumber} mono />
              {editing ? (
                <>
                  <p style={{ fontSize: 10.5, color: 'var(--t3)', marginBottom: 3 }}>Email</p>
                  <input value={draft.email} onChange={e => setDraft(d => ({ ...d, email: e.target.value }))}
                    placeholder="name@example.com" style={inputStyle} />
                  <div style={{ display: 'flex', gap: 7, marginTop: 10 }}>
                    <Btn size="sm" onClick={saveEdit} disabled={saving}>{saving ? 'Saving…' : 'Save'}</Btn>
                    <Btn size="sm" variant="ghost" disabled={saving}
                      onClick={() => { setEditing(false); setDraft({ name: contact.name || '', email: contact.email || '' }); setErr(null); }}>
                      Cancel
                    </Btn>
                  </div>
                </>
              ) : (
                <Field label="Email" value={contact.email} />
              )}
            </Section>

            {/* tags */}
            <Section title="Tags">
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 5, marginBottom: 9 }}>
                {(contact.tags || []).length === 0 && <span style={{ fontSize: 11.5, color: 'var(--t3)' }}>No tags yet.</span>}
                {(contact.tags || []).map(t => (
                  <span key={t} style={{ display: 'inline-flex', alignItems: 'center', gap: 5, padding: '2px 6px 2px 9px', borderRadius: 20, fontSize: 11, fontWeight: 600, background: 'rgba(255,255,255,0.06)', border: '1px solid var(--bd)', color: 'var(--t2)' }}>
                    {t}
                    <button onClick={() => removeTag(t)} disabled={saving} aria-label={`Remove tag ${t}`}
                      style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--t3)', display: 'flex', padding: 0 }}>
                      <I n="x" s={10} c="var(--t3)" />
                    </button>
                  </span>
                ))}
              </div>
              <div style={{ display: 'flex', gap: 6 }}>
                <input value={newTag} onChange={e => setNewTag(e.target.value)} onKeyDown={e => e.key === 'Enter' && addTag()}
                  placeholder="Add a tag…" style={{ ...inputStyle, flex: 1 }} />
                <Btn size="sm" variant="outline" onClick={addTag} disabled={saving || !newTag.trim()}>Add</Btn>
              </div>
            </Section>

            {/* groups */}
            <Section
              title="Groups"
              action={availableGroups.length > 0 && !addingGroup ? (
                <button onClick={() => setAddingGroup(true)}
                  style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--green)', fontSize: 11, fontWeight: 600, display: 'flex', alignItems: 'center', gap: 4, padding: 0 }}>
                  <I n="plus" s={11} c="var(--green)" /> Add
                </button>
              ) : null}>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 5, marginBottom: addingGroup ? 9 : 0 }}>
                {(contact.segments || []).length === 0 && !addingGroup && (
                  <span style={{ fontSize: 11.5, color: 'var(--t3)' }}>Not in any group.</span>
                )}
                {(contact.segments || []).map(sg => (
                  <span key={sg.id} style={{ display: 'inline-flex', alignItems: 'center', gap: 5, padding: '2px 6px 2px 9px', borderRadius: 6, fontSize: 11, fontWeight: 600, background: `${sg.color || '#9d6bff'}14`, border: `1px solid ${sg.color || '#9d6bff'}33`, color: sg.color || '#9d6bff' }}>
                    {sg.name}
                    <button onClick={() => removeFromGroup(sg.id)} disabled={saving} aria-label={`Remove from ${sg.name}`}
                      style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'inherit', display: 'flex', padding: 0, opacity: .7 }}>
                      <I n="x" s={10} c={sg.color || '#9d6bff'} />
                    </button>
                  </span>
                ))}
              </div>
              {addingGroup && (
                <select autoFocus defaultValue="" onChange={e => addToGroup(e.target.value)} disabled={saving}
                  style={{ ...inputStyle, appearance: 'auto', colorScheme: 'dark' }}>
                  <option value="">Choose a group…</option>
                  {availableGroups.map(sg => <option key={sg.id} value={sg.id}>{sg.name}</option>)}
                </select>
              )}
              {/* Clusters are a separate grouping, managed from Contacts. */}
              {(contact.clusters || []).length > 0 && (
                <div style={{ marginTop: 10 }}>
                  <p style={{ fontSize: 10.5, color: 'var(--t3)', marginBottom: 4 }}>Clusters</p>
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: 5 }}>
                    {contact.clusters.map(cl => (
                      <span key={cl.id} style={{ padding: '2px 8px', borderRadius: 6, fontSize: 10.5, fontWeight: 600, background: 'rgba(255,255,255,0.05)', border: '1px solid var(--bd)', color: 'var(--t2)' }}>{cl.name}</span>
                    ))}
                  </div>
                </div>
              )}
            </Section>

            {/* activity */}
            <Section title="Activity">
              <Field label="Last Interaction" value={contact.lastInteractionAt ? fmtDateTime(contact.lastInteractionAt) : null} />
              <Field label="Created" value={fmtDate(contact.createdAt)} />
              <Field label="Last Updated" value={contact.updatedAt ? fmtDateTime(contact.updatedAt) : null} />
            </Section>

            {/* actions */}
            <div style={{ padding: '14px 16px', display: 'flex', flexDirection: 'column', gap: 8 }}>
              <Btn variant="outline" size="sm" onClick={viewInContacts} style={{ justifyContent: 'center' }}>
                <I n="users" s={13} c="var(--t2)" />
                View in Contacts
              </Btn>
              <Btn variant="outline" size="sm" disabled={saving}
                onClick={() => patch({ optedOut: !contact.optedOut })}
                style={{ justifyContent: 'center' }}>
                <I n={contact.optedOut ? 'check' : 'ban'} s={13} c="var(--t2)" />
                {contact.optedOut ? 'Mark as Active' : 'Mark as Opted Out'}
              </Btn>
            </div>
          </>
        )}
      </div>
    </>
  );
}
