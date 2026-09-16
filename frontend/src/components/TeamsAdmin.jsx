import { useState, useEffect, useCallback } from 'react';
import { I } from './Icons.jsx';
import { Btn } from './Btn.jsx';
import { Avatar } from './Avatar.jsx';
import { FInput, FLabel } from './Form.jsx';
import { wFetch } from '../lib/api.js';

const card = { background: 'var(--surf)', border: '1px solid var(--bd)', borderRadius: 'var(--rl)', boxShadow: 'var(--card-shadow)' };

// The three modes, described in terms of what a member will actually see
// rather than by their enum name — an admin choosing this is deciding who can
// see whose pipeline, and should not have to guess what "TEAM" means.
const MODES = [
  {
    value: 'ALL',
    label: 'Everyone sees everything',
    detail: 'Every member can see all leads, deals and tasks. This is the default.',
  },
  {
    value: 'TEAM',
    label: 'Teams see their own work',
    detail: 'A member sees records owned by anyone on a shared team. Someone on no team sees only their own.',
  },
  {
    value: 'OWN',
    label: 'Members see only their own',
    detail: 'A member sees only records they own or are assigned.',
  },
];

const ErrorBanner = ({ children, onDismiss }) => (
  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10, padding: '9px 14px', borderRadius: 8, background: 'rgba(239,68,68,.08)', border: '1px solid rgba(239,68,68,.22)', color: '#f87171', fontSize: 12.5, marginBottom: 12 }}>
    <span>{children}</span>
    {onDismiss && <button onClick={onDismiss} aria-label="Dismiss" style={{ background: 'none', border: 'none', cursor: 'pointer', display: 'flex' }}><I n="x" s={14} c="#f87171" /></button>}
  </div>
);

export const TeamsAdmin = ({ isAdmin }) => {
  const [teams, setTeams] = useState([]);
  const [members, setMembers] = useState([]);
  const [visibility, setVisibility] = useState('ALL');
  const [newName, setNewName] = useState('');
  const [editing, setEditing] = useState(null); // team id whose membership is open
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState(null);

  const load = useCallback(() => {
    wFetch('/teams')
      .then(r => (r.ok ? r.json() : { data: [] }))
      .then(d => setTeams(d.data ?? []))
      .catch(() => {});
    wFetch('/teams/visibility')
      .then(r => (r.ok ? r.json() : null))
      .then(d => { if (d) setVisibility(d.recordVisibility); })
      .catch(() => {});
  }, []);

  useEffect(() => { load(); }, [load]);
  useEffect(() => {
    wFetch('/members').then(r => r.ok && r.json()).then(d => { if (Array.isArray(d)) setMembers(d); }).catch(() => {});
  }, []);

  const send = async (path, options, onOk) => {
    setBusy(true);
    setErr(null);
    try {
      const res = await wFetch(path, options);
      if (!res.ok && res.status !== 204) {
        const d = await res.json().catch(() => ({}));
        throw new Error(d.error || 'That change was refused');
      }
      onOk?.();
      load();
    } catch (e) {
      setErr(e.message);
    } finally {
      setBusy(false);
    }
  };

  const changeMode = (mode) => {
    setVisibility(mode); // optimistic; reload below corrects it if refused
    send('/teams/visibility', {
      method: 'PATCH', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ recordVisibility: mode }),
    });
  };

  const createTeam = () => {
    const name = newName.trim();
    if (!name) return;
    send('/teams', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name }),
    }, () => setNewName(''));
  };

  const toggleMember = (team, userId) => {
    const current = new Set((team.members ?? []).map(m => m.userId));
    current.has(userId) ? current.delete(userId) : current.add(userId);
    send(`/teams/${team.id}/members`, {
      method: 'PUT', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ userIds: [...current] }),
    });
  };

  return (
    <div>
      {err && <ErrorBanner onDismiss={() => setErr(null)}>{err}</ErrorBanner>}

      <div style={{ fontSize: 12.5, color: 'var(--t2)', marginBottom: 6, fontWeight: 600 }}>Who can see which records</div>
      <div style={{ fontSize: 11.5, color: 'var(--t3)', marginBottom: 12 }}>
        Applies to leads, deals and tasks. Admins always see everything, and records with no owner stay visible to everyone.
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginBottom: 22 }}>
        {MODES.map(m => {
          const active = visibility === m.value;
          return (
            <label key={m.value}
              style={{ display: 'flex', gap: 10, alignItems: 'flex-start', padding: '11px 13px', borderRadius: 8,
                cursor: isAdmin ? 'pointer' : 'default',
                background: active ? 'rgba(30,191,94,.06)' : 'rgba(255,255,255,.02)',
                border: `1px solid ${active ? 'var(--gbd)' : 'var(--bd)'}` }}>
              <input type="radio" name="recordVisibility" value={m.value} checked={active}
                disabled={!isAdmin || busy} onChange={() => changeMode(m.value)} style={{ marginTop: 2 }} />
              <span>
                <span style={{ fontSize: 12.5, color: 'var(--t1)', fontWeight: 600 }}>{m.label}</span>
                <span style={{ display: 'block', fontSize: 11, color: 'var(--t3)', marginTop: 2 }}>{m.detail}</span>
              </span>
            </label>
          );
        })}
      </div>

      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 }}>
        <span style={{ fontSize: 12.5, color: 'var(--t2)', fontWeight: 600 }}>Teams</span>
        <span style={{ fontSize: 11, color: 'var(--t3)' }}>{teams.length}</span>
      </div>

      {visibility !== 'TEAM' && teams.length > 0 && (
        <div style={{ fontSize: 11, color: 'var(--t3)', marginBottom: 10, display: 'flex', gap: 7, alignItems: 'center' }}>
          <I n="alertc" s={12} c="#f59e0b" />
          Teams only affect visibility while the mode above is “Teams see their own work”.
        </div>
      )}

      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        {teams.length === 0 && (
          <div style={{ fontSize: 12, color: 'var(--t3)' }}>No teams yet.</div>
        )}

        {teams.map(team => {
          const memberIds = new Set((team.members ?? []).map(m => m.userId));
          const open = editing === team.id;
          return (
            <div key={team.id} style={{ ...card, padding: '11px 13px' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                <span style={{ flex: 1, fontSize: 12.5, color: 'var(--t1)', fontWeight: 600 }}>{team.name}</span>
                <span style={{ display: 'flex', gap: -6 }}>
                  {(team.members ?? []).slice(0, 4).map(m => (
                    <span key={m.userId} title={m.user?.name || m.user?.email} style={{ marginLeft: -4 }}>
                      <Avatar name={m.user?.name || m.user?.email} size={20} />
                    </span>
                  ))}
                </span>
                <span style={{ fontSize: 11, color: 'var(--t3)', minWidth: 60, textAlign: 'right' }}>
                  {memberIds.size} member{memberIds.size === 1 ? '' : 's'}
                </span>
                {isAdmin && (
                  <>
                    <Btn size="sm" variant="ghost" onClick={() => setEditing(open ? null : team.id)}>
                      {open ? 'Done' : 'Members'}
                    </Btn>
                    <button onClick={() => send(`/teams/${team.id}`, { method: 'DELETE' })}
                      aria-label={`Delete ${team.name}`} disabled={busy}
                      style={{ background: 'none', border: 'none', cursor: 'pointer', padding: 4 }}>
                      <I n="trash" s={13} c="#f87171" />
                    </button>
                  </>
                )}
              </div>

              {open && (
                <div style={{ marginTop: 11, paddingTop: 11, borderTop: '1px solid var(--bd)', display: 'flex', flexDirection: 'column', gap: 6 }}>
                  {members.map(m => (
                    <label key={m.user.id} style={{ display: 'flex', alignItems: 'center', gap: 9, fontSize: 12, color: 'var(--t2)', cursor: 'pointer' }}>
                      <input type="checkbox" checked={memberIds.has(m.user.id)} disabled={busy}
                        onChange={() => toggleMember(team, m.user.id)} />
                      <Avatar name={m.user.name || m.user.email} size={20} />
                      <span>{m.user.name || m.user.email}</span>
                      {m.role === 'ADMIN' && (
                        <span style={{ fontSize: 10, color: 'var(--t3)', border: '1px solid var(--bd)', borderRadius: 4, padding: '0 5px' }}>
                          admin — sees everything anyway
                        </span>
                      )}
                    </label>
                  ))}
                  {members.length === 0 && (
                    <div style={{ fontSize: 11.5, color: 'var(--t3)' }}>No workspace members to add.</div>
                  )}
                </div>
              )}
            </div>
          );
        })}
      </div>

      {isAdmin && (
        <div style={{ display: 'flex', gap: 8, alignItems: 'flex-end', marginTop: 14 }}>
          <div style={{ flex: 1, maxWidth: 260 }}>
            <FLabel>New team</FLabel>
            <FInput value={newName} onChange={e => setNewName(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter') createTeam(); }}
              placeholder="e.g. Enterprise Sales" />
          </div>
          <Btn size="sm" onClick={createTeam} disabled={busy || !newName.trim()}>Create</Btn>
        </div>
      )}

      {!isAdmin && (
        <div style={{ fontSize: 11.5, color: 'var(--t3)', marginTop: 12 }}>
          Only an admin can change teams or record visibility.
        </div>
      )}
    </div>
  );
};

export default TeamsAdmin;
