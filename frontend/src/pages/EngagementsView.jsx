import { useState, useEffect, useCallback, useRef } from 'react';
import { I } from '../components/Icons.jsx';
import { Btn } from '../components/Btn.jsx';
import { Avatar } from '../components/Avatar.jsx';
import { Modal } from '../components/Modal.jsx';
import { FInput, FLabel, FSelect, FTextarea } from '../components/Form.jsx';
import { wFetch } from '../lib/api.js';
import { canManage } from '../lib/permissions.js';
import MobileNavButton from '../components/MobileNavButton.jsx';

// What the "Log Engagement" form sends as `type`. Video calls and visits are
// both MEETING rows server-side (the structured engagementType keeps them
// apart); a Note is a NOTE — it used to fall through to MEETING and come back
// listed as a "Video Call".
const RAW_TYPE = { Call: 'CALL', 'Video Call': 'MEETING', Visit: 'MEETING', Message: 'EMAIL', Note: 'NOTE' };

// Social / Channel icons helper
const ChannelIcon = ({ source = 'INCOMING' }) => {
  const s = String(source).toUpperCase();
  if (s.includes('INSTAGRAM')) {
    return (
      <div
        style={{
          width: 20,
          height: 20,
          borderRadius: 6,
          background: 'linear-gradient(45deg, #f09433 0%, #e6683c 25%, #dc2743 50%, #cc2366 75%, #bc1888 100%)',
          display: 'inline-flex',
          alignItems: 'center',
          justifyContent: 'center',
          flexShrink: 0,
        }}
        title="Instagram Lead"
      >
        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
          <rect x="2" y="2" width="20" height="20" rx="5" ry="5" />
          <path d="M16 11.37A4 4 0 1 1 12.63 8 4 4 0 0 1 16 11.37z" />
          <line x1="17.5" y1="6.5" x2="17.51" y2="6.5" />
        </svg>
      </div>
    );
  }
  if (s.includes('WHATSAPP')) {
    return (
      <div
        style={{
          width: 20,
          height: 20,
          borderRadius: 6,
          background: '#25D366',
          display: 'inline-flex',
          alignItems: 'center',
          justifyContent: 'center',
          flexShrink: 0,
        }}
        title="WhatsApp Lead"
      >
        <I n="msg" s={11} c="#fff" />
      </div>
    );
  }
  return (
    <div
      style={{
        width: 20,
        height: 20,
        borderRadius: 6,
        background: 'rgba(var(--accent-rgb), 0.12)',
        border: '1px solid rgba(var(--accent-rgb), 0.25)',
        display: 'inline-flex',
        alignItems: 'center',
        justifyContent: 'center',
        flexShrink: 0,
      }}
      title={`${source} Lead`}
    >
      <I n="target" s={11} c="var(--accent, #35e8f2)" />
    </div>
  );
};

// Engagement Type Icon
const TypeIcon = ({ type = 'CALL' }) => {
  const t = String(type).toUpperCase();
  if (t === 'CALL') {
    return <I n="phone" s={15} c="var(--t1)" />;
  }
  if (t === 'VIDEO_CALL' || t === 'VIDEO CALL') {
    return (
      <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <polygon points="23 7 16 12 23 17 23 7" />
        <rect x="1" y="5" width="15" height="14" rx="2" ry="2" />
      </svg>
    );
  }
  if (t === 'MESSAGES' || t === 'MESSAGE' || t === 'EMAIL') {
    return <I n="msg" s={15} c="var(--t1)" />;
  }
  if (t === 'VISITS' || t === 'VISIT' || t === 'MEETING') {
    return (
      <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <rect x="3" y="4" width="18" height="18" rx="2" ry="2" />
        <line x1="16" y1="2" x2="16" y2="6" />
        <line x1="8" y1="2" x2="8" y2="6" />
        <line x1="3" y1="10" x2="21" y2="10" />
      </svg>
    );
  }
  // Default activity
  return <I n="activity" s={15} c="var(--t1)" />;
};

export default function EngagementsView({ user, initialTab }) {
  // Navigation / Filter state
  const [activeTab, setActiveTab] = useState(() => {
    if (!initialTab) return 'ALL';
    const t = String(initialTab).toUpperCase();
    if (t.includes('VIDEO')) return 'VIDEO_CALLS';
    if (t.includes('CALL')) return 'CALLS';
    if (t.includes('MESSAGE')) return 'MESSAGES';
    if (t.includes('VISIT')) return 'VISITS';
    return 'ALL';
  });
  const [scope, setScope] = useState('ALL'); // 'MY' | 'ALL'
  const [search, setSearch] = useState('');
  // One request per pause in typing, not per keystroke — and see the
  // request-id guard below for responses that come back out of order.
  const [debouncedSearch, setDebouncedSearch] = useState('');
  useEffect(() => {
    const t = setTimeout(() => setDebouncedSearch(search.trim()), 300);
    return () => clearTimeout(t);
  }, [search]);
  const reqId = useRef(0);
  // Logging writes a CRM activity: members and admins only on the server
  // (routes/activities.routes.js + roleCapabilities), so only they see it.
  const mayLog = canManage(user);
  const [total, setTotal] = useState(0);
  const [saveErr, setSaveErr] = useState(null);
  const [engagements, setEngagements] = useState([]);
  const [counts, setCounts] = useState({ ALL: 0, CALL: 0, VIDEO_CALL: 0, MESSAGES: 0, VISITS: 0 });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);


  // New Engagement Modal
  const [showLogModal, setShowLogModal] = useState(false);
  const [leadsList, setLeadsList] = useState([]);
  const [selectedLeadId, setSelectedLeadId] = useState('');
  const [engagementType, setEngagementType] = useState('Call');
  const [engagementStatus, setEngagementStatus] = useState('Completed');
  const [durationMins, setDurationMins] = useState('');
  const [notes, setNotes] = useState('');
  const [saving, setSaving] = useState(false);

  // Details Modal
  const [viewingItem, setViewingItem] = useState(null);

  // Fetch engagements from backend
  const fetchEngagements = useCallback(async () => {
    const id = ++reqId.current;
    setLoading(true);
    setError(null);
    try {
      const q = new URLSearchParams();
      if (activeTab === 'CALLS') q.set('type', 'CALL');
      else if (activeTab === 'VIDEO_CALLS') q.set('type', 'VIDEO_CALL');
      else if (activeTab === 'MESSAGES') q.set('type', 'MESSAGES');
      else if (activeTab === 'VISITS') q.set('type', 'VISITS');

      if (scope === 'MY' && user?.id) {
        q.set('ownerUserId', user.id);
      }
      if (debouncedSearch) {
        q.set('search', debouncedSearch);
      }

      const res = await wFetch(`/activities?${q.toString()}`);
      if (!res.ok) throw new Error('Failed to load engagements');
      const data = await res.json();
      if (id !== reqId.current) return; // a newer query has already answered
      setEngagements(data.data || []);
      setTotal(data.total || 0);
      if (data.counts) {
        setCounts({
          // counts.ALL is the whole workspace; `total` is only the current
          // tab+search, which made the "All" badge change with every tab.
          ALL: data.counts.ALL ?? data.total ?? 0,
          CALL: data.counts.CALL || 0,
          VIDEO_CALL: data.counts.VIDEO_CALL || 0,
          MESSAGES: data.counts.MESSAGES || 0,
          VISITS: data.counts.VISITS || 0,
        });
      }
    } catch (err) {
      if (id !== reqId.current) return;
      setError(err.message);
    } finally {
      if (id === reqId.current) setLoading(false);
    }
  }, [activeTab, scope, debouncedSearch, user?.id]);

  useEffect(() => {
    fetchEngagements();
  }, [fetchEngagements]);

  // Leads for the logging modal. Once — it used to depend on selectedLeadId,
  // so picking a lead in the dropdown refetched the whole list each time.
  useEffect(() => {
    if (!mayLog) return;
    wFetch('/leads?limit=100')
      .then((r) => (r.ok ? r.json() : []))
      .then((data) => {
        const list = Array.isArray(data) ? data : data?.data || [];
        setLeadsList(list);
        setSelectedLeadId((cur) => cur || list[0]?.id || '');
      })
      .catch(() => {});
  }, [mayLog]);

  // Submit new engagement
  const handleSaveEngagement = async () => {
    if (saving) return;
    if (!selectedLeadId) {
      setSaveErr('Pick the lead this engagement was with.');
      return;
    }
    const mins = durationMins === '' ? null : Number(durationMins);
    if (mins !== null && (!Number.isInteger(mins) || mins < 0)) {
      setSaveErr('Duration must be a whole number of minutes.');
      return;
    }
    setSaveErr(null);
    setSaving(true);
    try {
      const selLead = leadsList.find((l) => l.id === selectedLeadId);
      const res = await wFetch('/activities', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          leadId: selectedLeadId,
          contactId: selLead?.contactId,
          type: RAW_TYPE[engagementType] || 'NOTE',
          engagementType,
          status: engagementStatus,
          duration: mins,
          notes: notes.trim() || `${engagementType} with lead`,
          content: notes.trim() || `${engagementType} logged`,
        }),
      });

      if (!res.ok) {
        const d = await res.json().catch(() => ({}));
        throw new Error(d.error || 'Failed to save engagement');
      }

      setShowLogModal(false);
      setNotes('');
      setDurationMins('');
      fetchEngagements();
    } catch (err) {
      setSaveErr(`Could not log engagement: ${err.message}`);
    } finally {
      setSaving(false);
    }
  };

  // Format date helper (e.g. 15/Aug/2026 11:30 AM)
  const formatDateTime = (dateStr) => {
    if (!dateStr) return '-';
    try {
      const d = new Date(dateStr);
      const day = d.getDate();
      const month = d.toLocaleString('en-US', { month: 'short' });
      const year = d.getFullYear();
      const time = d.toLocaleString('en-US', { hour: 'numeric', minute: '2-digit', hour12: true });
      return `${day}/${month}/${year} ${time}`;
    } catch {
      return dateStr;
    }
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', flex: 1, minHeight: 0, overflowY: 'auto' }}>
      {/* ── TOP PAGE HEADER ── */}
      <div style={{ minHeight: 58, borderBottom: '1px solid var(--bd)', display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '10px 24px', flexShrink: 0, background: 'var(--surf)', flexWrap: 'wrap', gap: 12 }}>
        <MobileNavButton />
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ display: 'flex', alignItems: 'baseline', gap: 10 }}>
            <h1 style={{ fontFamily: "'Syne',sans-serif", fontWeight: 700, fontSize: 17, color: 'var(--t1)', margin: 0 }}>Engagements</h1>
            <span style={{ fontSize: 12.5, color: 'var(--t3)' }}>{counts.ALL || 0}</span>
          </div>
          <p style={{ margin: '2px 0 0', color: 'var(--t3)', fontSize: 11.5 }}>
            Track and manage customer calls, video meetings, messages, and visits.
          </p>
        </div>

        {mayLog && (
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <Btn size="sm" onClick={() => { setSaveErr(null); setShowLogModal(true); }}>
              <I n="plus" s={14} c="#060A10" /> Log Engagement
            </Btn>
          </div>
        )}
      </div>

      {/* ── SUB-TABS RIBBON ── */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8, padding: '10px 24px', borderBottom: '1px solid var(--bd)', background: 'rgba(255,255,255,0.01)' }}>
        <div role="tablist" aria-label="Engagement type" style={{ display: 'flex', alignItems: 'center', gap: 6, overflowX: 'auto', minWidth: 0 }}>
          {[
            { id: 'ALL', label: 'All Engagements', count: counts.ALL },
            { id: 'CALLS', label: 'Calls', count: counts.CALL },
            { id: 'VIDEO_CALLS', label: 'Video Calls', count: counts.VIDEO_CALL },
            { id: 'MESSAGES', label: 'Messages', count: counts.MESSAGES },
            { id: 'VISITS', label: 'Visits', count: counts.VISITS },
          ].map((tab) => {
            const isSel = activeTab === tab.id;
            return (
              <button
                key={tab.id}
                role="tab"
                aria-selected={isSel}
                onClick={() => setActiveTab(tab.id)}
                style={{
                  padding: '6px 14px',
                  borderRadius: 8,
                  border: isSel ? 'none' : '1px solid var(--bd)',
                  fontSize: 12.5,
                  fontWeight: 600,
                  cursor: 'pointer',
                  background: isSel ? 'var(--accent, #35e8f2)' : 'rgba(255,255,255,0.03)',
                  color: isSel ? '#060A10' : 'var(--t2)',
                  transition: 'all 0.15s ease',
                  display: 'flex',
                  alignItems: 'center',
                  gap: 6,
                  whiteSpace: 'nowrap',
                }}
              >
                <span>{tab.label}</span>
                {tab.count > 0 && (
                  <span
                    style={{
                      fontSize: 11,
                      fontWeight: 700,
                      padding: '1px 6px',
                      borderRadius: 10,
                      background: isSel ? 'rgba(0,0,0,0.2)' : 'rgba(255,255,255,0.08)',
                      color: isSel ? '#060A10' : 'var(--t3)',
                    }}
                  >
                    {tab.count}
                  </span>
                )}
              </button>
            );
          })}
        </div>

        <button
          onClick={fetchEngagements}
          disabled={loading}
          title="Refresh engagements"
          aria-label="Refresh engagements"
          style={{
            width: 32,
            height: 32,
            borderRadius: 8,
            border: '1px solid var(--bd)',
            background: 'var(--surf)',
            color: 'var(--t2)',
            cursor: 'pointer',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            flexShrink: 0,
          }}
        >
          <I n="refresh" s={14} />
        </button>
      </div>

      {/* ── ACTION & FILTER TOOLBAR ── */}
      <div
        style={{
          padding: '10px 24px',
          background: 'var(--surf)',
          borderBottom: '1px solid var(--bd)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          flexWrap: 'wrap',
          gap: 12,
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
          {/* Scope Toggle: My vs All */}
          <div
            style={{
              display: 'flex',
              background: 'rgba(255,255,255,0.04)',
              padding: 2,
              borderRadius: 8,
              border: '1px solid var(--bd)',
            }}
          >
            <button
              aria-pressed={scope === 'MY'}
              onClick={() => setScope('MY')}
              style={{
                padding: '4px 12px',
                borderRadius: 6,
                border: 'none',
                fontSize: 12,
                fontWeight: 700,
                cursor: 'pointer',
                background: scope === 'MY' ? 'var(--accent, #35e8f2)' : 'transparent',
                color: scope === 'MY' ? '#060A10' : 'var(--t2)',
                transition: 'all 0.15s ease',
              }}
            >
              My
            </button>
            <button
              aria-pressed={scope === 'ALL'}
              onClick={() => setScope('ALL')}
              style={{
                padding: '4px 12px',
                borderRadius: 6,
                border: 'none',
                fontSize: 12,
                fontWeight: 700,
                cursor: 'pointer',
                background: scope === 'ALL' ? 'var(--accent, #35e8f2)' : 'transparent',
                color: scope === 'ALL' ? '#060A10' : 'var(--t2)',
                transition: 'all 0.15s ease',
              }}
            >
              All
            </button>
          </div>
        </div>

        {/* Right Search Input: "Type first 3 letters..." */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, flex: '1 1 220px', maxWidth: 360 }}>
          <div style={{ position: 'relative', width: '100%' }}>
            <input
              type="text"
              placeholder="Search lead, owner or notes…"
              aria-label="Search engagements"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              style={{
                width: '100%',
                padding: '7px 12px 7px 32px',
                background: 'var(--bg)',
                border: '1px solid var(--bd)',
                borderRadius: 8,
                fontSize: 12.5,
                color: 'var(--t1)',
                outline: 'none',
                boxSizing: 'border-box',
              }}
            />
            <div style={{ position: 'absolute', left: 10, top: '50%', transform: 'translateY(-50%)', pointerEvents: 'none' }}>
              <I n="search" s={14} c="var(--t3)" />
            </div>
            {search && (
              <button
                aria-label="Clear search"
                onClick={() => setSearch('')}
                style={{ position: 'absolute', right: 8, top: '50%', transform: 'translateY(-50%)', background: 'none', border: 'none', cursor: 'pointer', color: 'var(--t3)' }}
              >
                <I n="x" s={12} />
              </button>
            )}
          </div>
        </div>
      </div>

      {/* ── MAIN DATA TABLE ── */}
      <div style={{ flex: 1, minHeight: 0, overflowY: 'auto', padding: '0 24px 24px' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13, textAlign: 'left' }}>
          <thead>
            <tr
              style={{
                borderBottom: '1px solid var(--bd)',
                color: 'var(--t3)',
                fontSize: 12,
                fontWeight: 600,
                background: 'var(--bg)',
                position: 'sticky',
                top: 0,
                zIndex: 10,
              }}
            >
              <th style={{ padding: '12px 10px', minWidth: 200 }}>Lead</th>
              <th style={{ padding: '12px 10px', minWidth: 130 }}>Lead Source</th>
              <th style={{ padding: '12px 10px', minWidth: 140 }}>Engagement Type</th>
              <th style={{ padding: '12px 10px', minWidth: 140 }}>Engagement Status</th>
              <th style={{ padding: '12px 10px', minWidth: 160 }}>Engagement Owner</th>
              <th style={{ padding: '12px 10px', minWidth: 120 }}>Team</th>
              <th style={{ padding: '12px 10px', minWidth: 160 }}>Last Updated</th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr>
                <td colSpan={7} style={{ padding: 40, textAlign: 'center', color: 'var(--t2)' }}>
                  <div style={{ width: 22, height: 22, border: '2px solid var(--accent, #35e8f2)', borderTopColor: 'transparent', borderRadius: '50%', margin: '0 auto 10px', animation: 'spin 1s linear infinite' }} />
                  <div style={{ fontSize: 13 }}>Loading engagements...</div>
                </td>
              </tr>
            ) : error ? (
              <tr>
                <td colSpan={7} role="alert" style={{ padding: 40, textAlign: 'center', color: '#f87171', fontSize: 13 }}>
                  Couldn't load engagements. <button onClick={fetchEngagements} style={{ background: 'none', border: 'none', color: 'var(--accent)', cursor: 'pointer', fontWeight: 600, fontSize: 13 }}>Try again</button>
                </td>
              </tr>
            ) : engagements.length === 0 ? (
              <tr>
                <td colSpan={7} style={{ padding: 48, textAlign: 'center', color: 'var(--t3)' }}>
                  <div style={{ fontSize: 14, fontWeight: 600, color: 'var(--t2)', marginBottom: 6 }}>No engagements found</div>
                  <div style={{ fontSize: 12.5, color: 'var(--t3)' }}>Log a call, video meeting, visit or message to start tracking team touchpoints.</div>
                  {mayLog && !debouncedSearch && (
                    <div style={{ marginTop: 14, display: 'flex', justifyContent: 'center' }}>
                      <Btn size="sm" onClick={() => { setSaveErr(null); setShowLogModal(true); }}>
                        <I n="plus" s={14} c="#060A10" /> Log First Engagement
                      </Btn>
                    </div>
                  )}
                </td>
              </tr>
            ) : (
              engagements.map((item) => {
                const isSelected = false;
                // No invented names: a missing owner or team reads as a dash,
                // not as "Sales Rep" / "Enterprise Growth Team".
                const leadName = item.leadName || item.lead?.contact?.name || item.contact?.name || item.lead?.contact?.phoneNumber || 'Unknown contact';
                const leadSource = item.leadSource || item.lead?.source || '—';
                const leadStage = item.leadStage || (item.lead?.status === 'QUALIFIED' ? 'Qualified Leads' : 'Opportunity Lead');
                const engType = item.engagementType || (item.type === 'MEETING' ? 'Video Call' : item.type === 'CALL' ? 'Call' : item.type === 'EMAIL' ? 'Message' : 'Note');
                const engStatus = item.engagementStatus || 'Completed';
                const ownerName = item.createdByUser?.name || '—';
                const teamName = item.teamName && item.teamName !== 'Enterprise Growth Team' ? item.teamName : '—';
                const open = () => setViewingItem({ ...item, leadName, leadSource, leadStage, engagementType: engType, engagementStatus: engStatus, teamName });

                return (
                  <tr
                    key={item.id}
                    tabIndex={0}
                    aria-label={`${engType} with ${leadName} — open details`}
                    onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); open(); } }}
                    onClick={open}
                    style={{
                      borderBottom: '1px solid var(--bd)',
                      background: isSelected ? 'rgba(var(--accent-rgb), 0.05)' : 'transparent',
                      cursor: 'pointer',
                      transition: 'background 0.12s ease',
                    }}
                    onMouseEnter={(e) => {
                      if (!isSelected) e.currentTarget.style.background = 'rgba(255,255,255,0.02)';
                    }}
                    onMouseLeave={(e) => {
                      if (!isSelected) e.currentTarget.style.background = 'transparent';
                    }}
                  >
                    {/* Lead Column (Avatar + Name + Stage Tag) */}
                    <td style={{ padding: '12px 10px' }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                        <ChannelIcon source={leadSource} />
                        <div style={{ display: 'flex', flexDirection: 'column', gap: 2, minWidth: 0 }}>
                          <span style={{ fontSize: 13, fontWeight: 600, color: 'var(--t1)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', maxWidth: 160 }}>
                            {leadName}
                          </span>
                          <span
                            style={{
                              fontSize: 10.5,
                              fontWeight: 600,
                              color: leadStage.includes('Qualified') ? 'var(--green)' : 'var(--accent, #35e8f2)',
                              background: leadStage.includes('Qualified') ? 'var(--gbg)' : 'rgba(var(--accent-rgb), 0.12)',
                              border: `1px solid ${leadStage.includes('Qualified') ? 'var(--gbd)' : 'rgba(var(--accent-rgb), 0.25)'}`,
                              padding: '1px 6px',
                              borderRadius: 4,
                              display: 'inline-block',
                              width: 'fit-content',
                            }}
                          >
                            {leadStage}
                          </span>
                        </div>
                      </div>
                    </td>

                    {/* Lead Source */}
                    <td style={{ padding: '12px 10px', fontSize: 12, fontWeight: 600, color: 'var(--t2)', textTransform: 'uppercase' }}>
                      {leadSource}
                    </td>

                    {/* Engagement Type */}
                    <td style={{ padding: '12px 10px' }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                        <TypeIcon type={engType} />
                        <span style={{ fontSize: 12.5, fontWeight: 600, color: 'var(--t1)' }}>{engType}</span>
                      </div>
                    </td>

                    {/* Engagement Status */}
                    <td style={{ padding: '12px 10px' }}>
                      <span
                        style={{
                          display: 'inline-block',
                          padding: '3px 10px',
                          borderRadius: 14,
                          fontSize: 11.5,
                          fontWeight: 700,
                          background:
                            engStatus === 'Completed'
                              ? 'var(--gbg)'
                              : engStatus === 'Active'
                              ? 'rgba(var(--accent-rgb), 0.12)'
                              : 'rgba(245, 158, 11, 0.12)',
                          color:
                            engStatus === 'Completed'
                              ? 'var(--green)'
                              : engStatus === 'Active'
                              ? 'var(--accent, #35e8f2)'
                              : '#fbbf24',
                          border: `1px solid ${
                            engStatus === 'Completed'
                              ? 'var(--gbd)'
                              : engStatus === 'Active'
                              ? 'rgba(var(--accent-rgb), 0.25)'
                              : 'rgba(245, 158, 11, 0.25)'
                          }`,
                        }}
                      >
                        {engStatus}
                      </span>
                    </td>

                    {/* Engagement Owner */}
                    <td style={{ padding: '12px 10px' }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                        <Avatar name={ownerName} size={24} />
                        <span style={{ fontSize: 12.5, fontWeight: 500, color: 'var(--t1)' }}>
                          {ownerName}
                        </span>
                      </div>
                    </td>

                    {/* Team */}
                    <td style={{ padding: '12px 10px', fontSize: 12, color: 'var(--t2)' }}>
                      {teamName}
                    </td>

                    {/* Last Updated */}
                    <td style={{ padding: '12px 10px', fontSize: 12, color: 'var(--t3)' }}>
                      {formatDateTime(item.createdAt)}
                    </td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
        {/* The list endpoint pages (200 rows by default) and this screen does
            not, so say when there is more than is shown. */}
        {!loading && !error && total > engagements.length && (
          <p style={{ fontSize: 11.5, color: 'var(--t3)', marginTop: 10 }}>
            Showing the latest {engagements.length} of {total}. Narrow it down with a tab or search.
          </p>
        )}
      </div>

      {/* ── MODAL: LOG NEW ENGAGEMENT ── */}
      {showLogModal && (
        <Modal title="Log New Engagement" onClose={() => setShowLogModal(false)} width={500}>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
            {saveErr && (
              <div role="alert" style={{ padding: '8px 12px', background: 'rgba(239,68,68,0.1)', color: '#f87171', borderRadius: 6, fontSize: 12 }}>{saveErr}</div>
            )}
            <div>
              <FLabel required>Target Lead</FLabel>
              {leadsList.length === 0 && (
                <p style={{ fontSize: 12, color: 'var(--t3)', margin: '0 0 6px' }}>No leads yet — an engagement is logged against a lead, so create one in Leads first.</p>
              )}
              <FSelect value={selectedLeadId} onChange={(e) => setSelectedLeadId(e.target.value)} aria-label="Target lead">
                {leadsList.map((l) => (
                  <option key={l.id} value={l.id} style={{ background: '#1e293b', color: '#fff' }}>
                    {l.contact?.name || l.contact?.phoneNumber} ({l.source || 'Incoming'}) · Score: {l.score}
                  </option>
                ))}
              </FSelect>
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
              <div>
                <FLabel required>Engagement Type</FLabel>
                <FSelect value={engagementType} onChange={(e) => setEngagementType(e.target.value)}>
                  <option value="Call" style={{ background: '#1e293b', color: '#fff' }}>Call</option>
                  <option value="Video Call" style={{ background: '#1e293b', color: '#fff' }}>Video Call</option>
                  <option value="Message" style={{ background: '#1e293b', color: '#fff' }}>Message</option>
                  <option value="Visit" style={{ background: '#1e293b', color: '#fff' }}>Visit</option>
                  <option value="Note" style={{ background: '#1e293b', color: '#fff' }}>Note</option>
                </FSelect>
              </div>

              <div>
                <FLabel required>Status</FLabel>
                <FSelect value={engagementStatus} onChange={(e) => setEngagementStatus(e.target.value)}>
                  <option value="Completed" style={{ background: '#1e293b', color: '#fff' }}>Completed</option>
                  <option value="Active" style={{ background: '#1e293b', color: '#fff' }}>Active</option>
                  <option value="Scheduled" style={{ background: '#1e293b', color: '#fff' }}>Scheduled</option>
                </FSelect>
              </div>
            </div>

            <div>
              <FLabel>Duration (Minutes, Optional)</FLabel>
              <FInput
                type="number"
                min={0}
                step={1}
                placeholder="e.g. 15"
                value={durationMins}
                onChange={(e) => setDurationMins(e.target.value)}
              />
            </div>

            <div>
              <FLabel>Engagement Summary / Notes</FLabel>
              <FTextarea
                rows={3}
                placeholder="Discussed requirements, scheduled next follow-up call..."
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
              />
            </div>

            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 10, marginTop: 8 }}>
              <Btn outline onClick={() => setShowLogModal(false)}>Cancel</Btn>
              <Btn
                onClick={handleSaveEngagement}
                disabled={saving || !selectedLeadId}
              >
                {saving ? 'Saving...' : 'Save Engagement'}
              </Btn>
            </div>
          </div>
        </Modal>
      )}

      {/* ── MODAL: VIEW ENGAGEMENT DETAILS ── */}
      {viewingItem && (
        <Modal title={`${viewingItem.engagementType} Details`} onClose={() => setViewingItem(null)} width={480}>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 12, paddingBottom: 12, borderBottom: '1px solid var(--bd)' }}>
              <ChannelIcon source={viewingItem.leadSource} />
              <div>
                <div style={{ fontSize: 15, fontWeight: 700, color: 'var(--t1)' }}>{viewingItem.leadName}</div>
                <div style={{ fontSize: 12, color: 'var(--t2)', marginTop: 2 }}>
                  Source: {viewingItem.leadSource} · {viewingItem.leadStage}
                </div>
              </div>
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10, background: 'var(--bg)', padding: 12, borderRadius: 8, border: '1px solid var(--bd)' }}>
              <div>
                <div style={{ fontSize: 11, color: 'var(--t3)', textTransform: 'uppercase' }}>Engagement Type</div>
                <div style={{ fontSize: 13, fontWeight: 700, color: 'var(--t1)', marginTop: 2 }}>{viewingItem.engagementType}</div>
              </div>
              <div>
                <div style={{ fontSize: 11, color: 'var(--t3)', textTransform: 'uppercase' }}>Status</div>
                <div style={{ fontSize: 13, fontWeight: 700, color: 'var(--green)', marginTop: 2 }}>{viewingItem.engagementStatus}</div>
              </div>
              <div>
                <div style={{ fontSize: 11, color: 'var(--t3)', textTransform: 'uppercase' }}>Logged By</div>
                <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--t1)', marginTop: 2 }}>{viewingItem.createdByUser?.name || '—'}</div>
              </div>
              <div>
                <div style={{ fontSize: 11, color: 'var(--t3)', textTransform: 'uppercase' }}>Team</div>
                <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--t1)', marginTop: 2 }}>{viewingItem.teamName}</div>
              </div>
            </div>

            <div>
              <div style={{ fontSize: 12, fontWeight: 700, color: 'var(--t2)', textTransform: 'uppercase', marginBottom: 6 }}>Notes & Content</div>
              <div style={{ background: 'var(--bg)', padding: 12, borderRadius: 8, fontSize: 13, color: 'var(--t1)', lineHeight: 1.5, border: '1px solid var(--bd)' }}>
                {viewingItem.content || 'No notes recorded.'}
              </div>
            </div>

            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 10, marginTop: 8 }}>
              <Btn outline onClick={() => setViewingItem(null)}>Close</Btn>
            </div>
          </div>
        </Modal>
      )}
    </div>
  );
}
