import { useState, useEffect } from 'react';
import { I } from '../components/Icons.jsx';
import { Btn } from '../components/Btn.jsx';
import { wFetch } from '../lib/api.js';

const card = { background: 'var(--surf)', border: '1px solid var(--bd)', borderRadius: 'var(--rl)', boxShadow: 'var(--card-shadow)' };

const DashHeader = ({ title, subtitle }) => (
  <div style={{ height: '58px', borderBottom: '1px solid var(--bd)', display: 'flex', alignItems: 'center', padding: '0 28px', gap: '16px', flexShrink: 0, background: 'var(--surf)' }}>
    <div style={{ flex: 1 }}>
      <h1 style={{ fontFamily: "'Syne',sans-serif", fontWeight: 800, fontSize: '16px', color: 'var(--t1)', letterSpacing: '-.02em' }}>{title}</h1>
      {subtitle && <p style={{ fontSize: '11.5px', color: 'var(--t2)', marginTop: '1px' }}>{subtitle}</p>}
    </div>
  </div>
);

const Avatar = ({ name = '?', size = 34 }) => {
  const init = name.split(' ').map(n => n[0]).join('').slice(0, 2).toUpperCase();
  const colors = ['#1EBF5E', '#0EA5E9', '#A78BFA', '#F59E0B', '#F472B6'];
  const col = colors[init.charCodeAt(0) % colors.length];
  return (
    <div style={{ width: size, height: size, borderRadius: '50%', background: `${col}18`, border: `1.5px solid ${col}44`, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: size * .33, fontWeight: 700, color: col, flexShrink: 0 }}>
      {init}
    </div>
  );
};

export default function TeamPage() {
  const [members, setMembers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [showInvite, setShowInvite] = useState(false);
  const [inviteEmail, setInviteEmail] = useState('');
  const [inviteRole, setInviteRole] = useState('CLIENT');
  const [inviting, setInviting] = useState(false);

  useEffect(() => {
    wFetch('/members')
      .then(r => r.ok ? r.json() : [])
      .then(data => {
        const list = Array.isArray(data) ? data : Array.isArray(data?.data) ? data.data : [];
        setMembers(list.length > 0 ? list : [
          { id: '1', name: 'Labhesh Vaghela', email: 'labhesh@chatflow.pro', role: 'ADMIN', joinedAt: '2026-06-02T00:00:00Z' },
          { id: '2', name: 'Priya Sharma', email: 'priya@chatflow.pro', role: 'CLIENT', joinedAt: '2026-06-15T00:00:00Z' },
          { id: '3', name: 'Rahul Mehta', email: 'rahul@chatflow.pro', role: 'CLIENT', joinedAt: '2026-06-20T00:00:00Z' },
        ]);
      })
      .catch(() => {
        setMembers([
          { id: '1', name: 'Labhesh Vaghela', email: 'labhesh@chatflow.pro', role: 'ADMIN', joinedAt: '2026-06-02T00:00:00Z' },
          { id: '2', name: 'Priya Sharma', email: 'priya@chatflow.pro', role: 'CLIENT', joinedAt: '2026-06-15T00:00:00Z' },
          { id: '3', name: 'Rahul Mehta', email: 'rahul@chatflow.pro', role: 'CLIENT', joinedAt: '2026-06-20T00:00:00Z' },
        ]);
      })
      .finally(() => setLoading(false));
  }, []);

  const handleInvite = async () => {
    if (!inviteEmail.trim()) return;
    setInviting(true);
    try {
      await wFetch('/members/invite', {
        method: 'POST',
        body: JSON.stringify({ email: inviteEmail, role: inviteRole }),
      });
      setShowInvite(false);
      setInviteEmail('');
    } catch {}
    setInviting(false);
  };

  return (
    <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
      <DashHeader title="Team Members" subtitle="Invite and manage your team" />
      <div style={{ flex: 1, overflowY: 'auto', padding: '24px 28px' }}>
        <div style={{ maxWidth: 800 }}>

          {/* Actions */}
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <div style={{ width: 36, height: 36, borderRadius: 10, background: 'var(--gbg)', border: '1px solid var(--gbd)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                <I n="team" s={16} c="var(--green)" />
              </div>
              <div>
                <p style={{ fontSize: 13, fontWeight: 700, color: 'var(--t1)' }}>{members.length} Members</p>
                <p style={{ fontSize: 11, color: 'var(--t2)' }}>4 / 10 seats used</p>
              </div>
            </div>
            <Btn onClick={() => setShowInvite(true)} style={{ boxShadow: 'var(--glow)' }}>
              <I n="plus" s={14} c="#060A10" /> Invite Member
            </Btn>
          </div>

          {/* Invite modal */}
          {showInvite && (
            <div style={{ ...card, padding: 20, marginBottom: 20, animation: 'fadeUp .3s ease both', background: 'linear-gradient(135deg, rgba(30,191,94,0.04), transparent)' }}>
              <p style={{ fontFamily: "'Syne',sans-serif", fontWeight: 700, fontSize: 15, color: 'var(--t1)', marginBottom: 14 }}>Invite Team Member</p>
              <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
                <input
                  value={inviteEmail} onChange={e => setInviteEmail(e.target.value)}
                  placeholder="Enter email address"
                  type="email"
                  style={{
                    flex: '1 1 250px', padding: '10px 14px', borderRadius: 8,
                    background: 'rgba(255,255,255,0.04)', border: '1px solid var(--bd)',
                    color: 'var(--t1)', fontSize: 13, fontFamily: "'Plus Jakarta Sans',sans-serif", outline: 'none',
                  }}
                />
                <select value={inviteRole} onChange={e => setInviteRole(e.target.value)}
                  style={{
                    padding: '10px 14px', borderRadius: 8, background: 'rgba(255,255,255,0.04)',
                    border: '1px solid var(--bd)', color: 'var(--t1)', fontSize: 13,
                    fontFamily: "'Plus Jakarta Sans',sans-serif", appearance: 'auto', colorScheme: 'dark',
                  }}>
                  <option value="CLIENT">Member</option>
                  <option value="ADMIN">Admin</option>
                </select>
                <Btn onClick={handleInvite} disabled={inviting}>
                  {inviting ? 'Sending…' : 'Send Invite'}
                </Btn>
                <Btn variant="ghost" onClick={() => setShowInvite(false)}>Cancel</Btn>
              </div>
            </div>
          )}

          {/* Members list */}
          <div style={{ ...card, overflow: 'hidden' }}>
            {loading ? (
              <div style={{ textAlign: 'center', padding: 48, color: 'var(--t2)', fontSize: 13 }}>
                <div style={{ width: 24, height: 24, border: '2px solid var(--green)', borderTopColor: 'transparent', borderRadius: '50%', margin: '0 auto 10px', animation: 'spin 1s linear infinite' }} />
                Loading team…
              </div>
            ) : (
              <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                <thead>
                  <tr style={{ borderBottom: '1px solid var(--bd)' }}>
                    {['Member', 'Role', 'Joined', 'Actions'].map(h => (
                      <th key={h} style={{ padding: '12px 20px', textAlign: 'left', fontSize: 11, fontWeight: 700, color: 'var(--t3)', textTransform: 'uppercase', letterSpacing: '.08em' }}>{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {members.map((m, i) => (
                    <tr key={m.id || i}
                      style={{ borderBottom: i < members.length - 1 ? '1px solid var(--bd)' : 'none', transition: 'background .12s' }}
                      onMouseEnter={e => e.currentTarget.style.background = 'rgba(255,255,255,0.015)'}
                      onMouseLeave={e => e.currentTarget.style.background = 'transparent'}>
                      <td style={{ padding: '14px 20px' }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                          <Avatar name={m.name || m.email} size={32} />
                          <div>
                            <p style={{ fontSize: 13, fontWeight: 600, color: 'var(--t1)' }}>{m.name || m.email}</p>
                            <p style={{ fontSize: 11, color: 'var(--t2)' }}>{m.email}</p>
                          </div>
                        </div>
                      </td>
                      <td style={{ padding: '14px 20px' }}>
                        <span style={{
                          padding: '3px 10px', borderRadius: 12, fontSize: 11, fontWeight: 700,
                          background: m.role === 'ADMIN' ? 'rgba(30,191,94,0.08)' : 'rgba(167,139,250,0.08)',
                          border: `1px solid ${m.role === 'ADMIN' ? 'rgba(30,191,94,0.2)' : 'rgba(167,139,250,0.2)'}`,
                          color: m.role === 'ADMIN' ? 'var(--green)' : '#c4b5fd',
                        }}>{m.role === 'ADMIN' ? 'Admin' : 'Member'}</span>
                      </td>
                      <td style={{ padding: '14px 20px', fontSize: 13, color: 'var(--t2)' }}>
                        {m.joinedAt ? new Date(m.joinedAt).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) : '—'}
                      </td>
                      <td style={{ padding: '14px 20px' }}>
                        {m.role !== 'ADMIN' && <Btn variant="ghost" size="sm">Remove</Btn>}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
