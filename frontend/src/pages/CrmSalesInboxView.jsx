import { useState, useEffect, useCallback } from 'react';
import { I } from '../components/Icons.jsx';
import { Btn } from '../components/Btn.jsx';
import { Avatar } from '../components/Avatar.jsx';
import { Modal } from '../components/Modal.jsx';
import { StatusBadge } from '../components/StatusBadge.jsx';
import { FInput, FLabel, FSelect } from '../components/Form.jsx';
import { wFetch } from '../lib/api.js';

const CATEGORY_COLORS = {
  HOT: { bg: 'rgba(239, 68, 68, 0.12)', bd: 'rgba(239, 68, 68, 0.3)', c: '#f87171', label: 'HOT 🔥' },
  WARM: { bg: 'rgba(245, 158, 11, 0.12)', bd: 'rgba(245, 158, 11, 0.3)', c: '#fbbf24', label: 'WARM ⚡' },
  COLD: { bg: 'rgba(59, 130, 246, 0.12)', bd: 'rgba(59, 130, 246, 0.3)', c: '#60a5fa', label: 'COLD ❄️' },
};

const CategoryBadge = ({ category = 'COLD' }) => {
  const cfg = CATEGORY_COLORS[category] || CATEGORY_COLORS.COLD;
  return (
    <span
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: 4,
        padding: '3px 8px',
        borderRadius: 12,
        fontSize: 11,
        fontWeight: 700,
        background: cfg.bg,
        border: `1px solid ${cfg.bd}`,
        color: cfg.c,
      }}
    >
      {cfg.label}
    </span>
  );
};

export default function CrmSalesInboxView() {
  const [activeTab, setActiveTab] = useState('individual'); // 'individual' | 'segment'

  // Common data
  const [segments, setSegments] = useState({ categories: { HOT: 0, WARM: 0, COLD: 0, ALL: 0 }, sources: [] });
  const [templates, setTemplates] = useState([]);
  const [waNumbers, setWaNumbers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  // Individual Mode State
  const [leads, setLeads] = useState([]);
  const [selectedLeadId, setSelectedLeadId] = useState(null);
  const [selectedLead, setSelectedLead] = useState(null);
  const [leadSearch, setLeadSearch] = useState('');
  const [categoryFilter, setCategoryFilter] = useState('ALL');
  const [statusFilter, setStatusFilter] = useState('');

  // Conversation & Messaging State
  const [conversation, setConversation] = useState(null);
  const [messages, setMessages] = useState([]);
  const [messageText, setMessageText] = useState('');
  const [sendingMsg, setSendingMsg] = useState(false);
  const [showTemplateModal, setShowTemplateModal] = useState(false);
  const [selectedTemplateId, setSelectedTemplateId] = useState('');

  // Segment Mode State
  const [segCategory, setSegCategory] = useState('HOT');
  const [segSource, setSegSource] = useState('');
  const [segStatus, setSegStatus] = useState('');
  const [audienceData, setAudienceData] = useState({ matchingCount: 0, eligibleCount: 0, excludedCount: 0, exclusions: {}, leads: [] });
  const [loadingAudience, setLoadingAudience] = useState(false);

  // Bulk Campaign Launch State
  const [campaignName, setCampaignName] = useState('');
  const [campaignTemplateId, setCampaignTemplateId] = useState('');
  const [campaignWaNumberId, setCampaignWaNumberId] = useState('');
  const [showConfirmModal, setShowConfirmModal] = useState(false);
  const [launching, setLaunching] = useState(false);
  const [launchSuccess, setLaunchSuccess] = useState(null);

  // 1. Fetch initial segments & metadata
  const fetchMetadata = useCallback(async () => {
    setLoading(true);
    try {
      const [segRes, tmplRes, numRes] = await Promise.all([
        wFetch('/crm-sales-inbox/segments').then(r => r.ok ? r.json() : null),
        wFetch('/templates').then(r => r.ok ? r.json() : null),
        wFetch('/whatsapp').then(r => r.ok ? r.json() : null),
      ]);
      setSegments(segRes || { categories: { HOT: 0, WARM: 0, COLD: 0, ALL: 0 }, sources: [] });
      setTemplates(Array.isArray(tmplRes?.data) ? tmplRes.data : Array.isArray(tmplRes) ? tmplRes : []);
      setWaNumbers(Array.isArray(numRes?.data) ? numRes.data : Array.isArray(numRes) ? numRes : []);
    } catch (err) {
      console.error('[CrmSalesInbox] Error fetching metadata:', err);
      setError('Failed to load CRM Inbox data.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchMetadata();
  }, [fetchMetadata]);

  // 2. Fetch Leads for Individual Mode
  const fetchLeads = useCallback(async () => {
    try {
      const query = new URLSearchParams();
      if (categoryFilter && categoryFilter !== 'ALL') query.set('category', categoryFilter);
      if (statusFilter) query.set('status', statusFilter);
      if (leadSearch) query.set('search', leadSearch);

      const res = await wFetch(`/leads?${query.toString()}`);
      if (!res.ok) return;
      const data = await res.json();
      const list = Array.isArray(data) ? data : data?.data || [];
      setLeads(list);

      if (list.length > 0 && !selectedLeadId) {
        setSelectedLeadId(list[0].id);
      }
    } catch (err) {
      console.error('[CrmSalesInbox] Error fetching leads:', err);
    }
  }, [categoryFilter, statusFilter, leadSearch, selectedLeadId]);

  useEffect(() => {
    if (activeTab === 'individual') {
      fetchLeads();
    }
  }, [activeTab, fetchLeads]);

  // 3. Fetch Selected Lead Details & Messages
  const loadLeadContext = useCallback(async (leadId) => {
    if (!leadId) return;
    try {
      const leadRes = await wFetch(`/leads/${leadId}`);
      if (!leadRes.ok) return;
      const leadData = await leadRes.json();
      setSelectedLead(leadData);

      // Fetch or find conversation for contact
      if (leadData?.contactId) {
        const convsRes = await wFetch(`/conversations?search=${encodeURIComponent(leadData.contact.phoneNumber)}`);
        let convList = [];
        if (convsRes.ok) {
          const convsData = await convsRes.json();
          convList = Array.isArray(convsData) ? convsData : convsData?.data || [];
        }
        const match = Array.isArray(convList) ? convList[0] : null;

        if (match) {
          setConversation(match);
          const msgsRes = await wFetch(`/conversations/${match.id}/messages`);
          if (msgsRes.ok) {
            const msgsData = await msgsRes.json();
            setMessages(Array.isArray(msgsData) ? msgsData : msgsData?.data || []);
          }
        } else {
          setConversation(null);
          setMessages([]);
        }
      }
    } catch (err) {
      console.error('[CrmSalesInbox] Error loading lead details:', err);
    }
  }, []);

  useEffect(() => {
    if (selectedLeadId && activeTab === 'individual') {
      loadLeadContext(selectedLeadId);
    }
  }, [selectedLeadId, activeTab, loadLeadContext]);

  // 4. Fetch Segment Audience Review
  const fetchAudience = useCallback(async () => {
    setLoadingAudience(true);
    try {
      const query = new URLSearchParams();
      if (segCategory && segCategory !== 'ALL') query.set('category', segCategory);
      if (segSource) query.set('source', segSource);
      if (segStatus) query.set('status', segStatus);

      const res = await wFetch(`/crm-sales-inbox/audience-review?${query.toString()}`);
      if (res.ok) {
        const data = await res.json();
        setAudienceData(data || { matchingCount: 0, eligibleCount: 0, excludedCount: 0, exclusions: {}, leads: [] });
      }
    } catch (err) {
      console.error('[CrmSalesInbox] Error reviewing audience:', err);
    } finally {
      setLoadingAudience(false);
    }
  }, [segCategory, segSource, segStatus]);

  useEffect(() => {
    if (activeTab === 'segment') {
      fetchAudience();
    }
  }, [activeTab, fetchAudience]);

  // 5. Direct Message Sending
  const handleSendMessage = async () => {
    if (!messageText.trim() || !selectedLead) return;
    setSendingMsg(true);
    try {
      let convId = conversation?.id;

      // Create conversation if none exists
      if (!convId) {
        const newRes = await wFetch('/conversations', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ contactId: selectedLead.contactId }),
        });
        if (!newRes.ok) throw new Error('Failed to create conversation');
        const newConv = await newRes.json();
        convId = newConv.id;
        setConversation(newConv);
      }

      const res = await wFetch(`/conversations/${convId}/messages`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ body: messageText.trim() }),
      });
      if (!res.ok) {
        const errData = await res.json().catch(() => ({}));
        throw new Error(errData.error || 'Failed to send message');
      }
      const sentMsg = await res.json();

      setMessages((prev) => [...prev, sentMsg]);
      setMessageText('');

      // Refresh lead details to pick up updated category/score
      loadLeadContext(selectedLeadId);
    } catch (err) {
      alert(`Could not send message: ${err.message}`);
    } finally {
      setSendingMsg(false);
    }
  };

  // 6. Template Message Sending (Individual)
  const handleSendTemplate = async () => {
    if (!selectedTemplateId || !selectedLead) return;
    setSendingMsg(true);
    try {
      let convId = conversation?.id;
      if (!convId) {
        const newRes = await wFetch('/conversations', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ contactId: selectedLead.contactId }),
        });
        if (!newRes.ok) throw new Error('Failed to create conversation');
        const newConv = await newRes.json();
        convId = newConv.id;
        setConversation(newConv);
      }

      const res = await wFetch(`/conversations/${convId}/template`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ templateId: selectedTemplateId }),
      });
      if (!res.ok) {
        const errData = await res.json().catch(() => ({}));
        throw new Error(errData.error || 'Failed to send template');
      }

      setShowTemplateModal(false);
      loadLeadContext(selectedLeadId);
      alert('Template message sent successfully!');
    } catch (err) {
      alert(`Could not send template: ${err.message}`);
    } finally {
      setSendingMsg(false);
    }
  };

  // 7. Recalculate Lead Category
  const handleRecalculateCategory = async () => {
    if (!selectedLeadId) return;
    try {
      const res = await wFetch(`/crm-sales-inbox/leads/${selectedLeadId}/recalculate-category`, { method: 'POST' });
      if (!res.ok) throw new Error('Failed to recalculate category');
      const updated = await res.json();
      setSelectedLead(updated);
      fetchLeads();
      fetchMetadata();
    } catch (err) {
      alert(`Recalculate failed: ${err.message}`);
    }
  };

  // 8. Launch Bulk Campaign
  const handleLaunchCampaign = async () => {
    if (!campaignTemplateId || !campaignWaNumberId) {
      alert('Please select both a WhatsApp Template and a WhatsApp Number.');
      return;
    }
    setLaunching(true);
    setLaunchSuccess(null);
    try {
      const res = await wFetch('/crm-sales-inbox/launch-bulk-campaign', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: campaignName.trim() || `CRM Segment (${segCategory}) Bulk Campaign`,
          category: segCategory,
          source: segSource,
          status: segStatus,
          templateId: campaignTemplateId,
          waNumberId: campaignWaNumberId,
        }),
      });

      if (!res.ok) {
        const errData = await res.json().catch(() => ({}));
        throw new Error(errData.error || 'Failed to launch campaign');
      }

      const launchRes = await res.json();
      setShowConfirmModal(false);
      setLaunchSuccess(launchRes);
      fetchMetadata();
      fetchAudience();
    } catch (err) {
      alert(`Campaign launch failed: ${err.message}`);
    } finally {
      setLaunching(false);
    }
  };

  if (loading) {
    return (
      <div style={{ padding: 40, textAlign: 'center', color: 'var(--t2)' }}>
        <I n="loader" s={24} c="var(--primary)" />
        <div style={{ marginTop: 12, fontSize: 14 }}>Loading CRM Sales Inbox...</div>
      </div>
    );
  }

  return (
    <div style={{ padding: '24px 32px', maxWidth: 1600, margin: '0 auto' }}>
      {/* HEADER & NAVIGATION */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 24 }}>
        <div>
          <h1 style={{ fontSize: 24, fontWeight: 700, color: 'var(--t1)', margin: 0, display: 'flex', alignItems: 'center', gap: 10 }}>
            <I n="messageSquare" s={26} c="var(--primary)" />
            CRM Sales Inbox
          </h1>
          <p style={{ fontSize: 13, color: 'var(--t2)', margin: '4px 0 0 0' }}>
            Message specific CRM leads or target dynamically segmented lead audiences via WhatsApp bulk campaigns.
          </p>
        </div>

        {/* TAB SWITCHER */}
        <div style={{ display: 'flex', background: 'var(--surf)', padding: 4, borderRadius: 10, border: '1px solid var(--bd)' }}>
          <button
            onClick={() => setActiveTab('individual')}
            style={{
              padding: '8px 16px',
              borderRadius: 8,
              border: 'none',
              fontSize: 13,
              fontWeight: 600,
              cursor: 'pointer',
              background: activeTab === 'individual' ? 'var(--primary)' : 'transparent',
              color: activeTab === 'individual' ? '#fff' : 'var(--t2)',
              display: 'flex',
              alignItems: 'center',
              gap: 6,
              transition: 'all 0.15s ease',
            }}
          >
            <I n="user" s={16} />
            Individual Lead Mode
          </button>
          <button
            onClick={() => setActiveTab('segment')}
            style={{
              padding: '8px 16px',
              borderRadius: 8,
              border: 'none',
              fontSize: 13,
              fontWeight: 600,
              cursor: 'pointer',
              background: activeTab === 'segment' ? 'var(--primary)' : 'transparent',
              color: activeTab === 'segment' ? '#fff' : 'var(--t2)',
              display: 'flex',
              alignItems: 'center',
              gap: 6,
              transition: 'all 0.15s ease',
            }}
          >
            <I n="target" s={16} />
            Segment / Filter Mode
          </button>
        </div>
      </div>

      {/* METRICS & CATEGORY BUCKETS OVERVIEW */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 16, marginBottom: 24 }}>
        {[
          { key: 'HOT', label: 'HOT Leads', count: segments.categories?.HOT || 0, color: '#f87171', bg: 'rgba(239, 68, 68, 0.08)' },
          { key: 'WARM', label: 'WARM Leads', count: segments.categories?.WARM || 0, color: '#fbbf24', bg: 'rgba(245, 158, 11, 0.08)' },
          { key: 'COLD', label: 'COLD Leads', count: segments.categories?.COLD || 0, color: '#60a5fa', bg: 'rgba(59, 130, 246, 0.08)' },
          { key: 'ALL', label: 'Total CRM Prospects', count: segments.categories?.ALL || 0, color: 'var(--primary)', bg: 'rgba(99, 102, 241, 0.08)' },
        ].map((item) => (
          <div
            key={item.key}
            onClick={() => {
              if (activeTab === 'individual') setCategoryFilter(item.key);
              else setSegCategory(item.key);
            }}
            style={{
              background: 'var(--surf)',
              border: `1px solid ${activeTab === 'individual' && categoryFilter === item.key ? item.color : 'var(--bd)'}`,
              borderRadius: 12,
              padding: '16px 20px',
              cursor: 'pointer',
              transition: 'all 0.2s ease',
              boxShadow: 'var(--card-shadow)',
            }}
          >
            <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--t2)', textTransform: 'uppercase', letterSpacing: 0.5 }}>
              {item.label}
            </div>
            <div style={{ fontSize: 28, fontWeight: 800, color: item.color, marginTop: 4 }}>
              {item.count}
            </div>
          </div>
        ))}
      </div>

      {/* TAB 1: INDIVIDUAL LEAD MESSAGING MODE */}
      {activeTab === 'individual' && (
        <div style={{ display: 'grid', gridTemplateColumns: '320px 1fr 340px', gap: 20, minHeight: 650 }}>
          {/* LEFT: LEAD SEARCH & LIST */}
          <div style={{ background: 'var(--surf)', border: '1px solid var(--bd)', borderRadius: 14, padding: 16, display: 'flex', flexDirection: 'column' }}>
            <div style={{ marginBottom: 12 }}>
              <FInput
                placeholder="Search lead by name, phone, email..."
                value={leadSearch}
                onChange={(e) => setLeadSearch(e.target.value)}
              />
            </div>

            <div style={{ display: 'flex', gap: 6, marginBottom: 12, flexWrap: 'wrap' }}>
              {['ALL', 'HOT', 'WARM', 'COLD'].map((cat) => (
                <button
                  key={cat}
                  onClick={() => setCategoryFilter(cat)}
                  style={{
                    padding: '4px 10px',
                    borderRadius: 6,
                    border: '1px solid var(--bd)',
                    fontSize: 11,
                    fontWeight: 700,
                    cursor: 'pointer',
                    background: categoryFilter === cat ? 'var(--primary)' : 'var(--bg)',
                    color: categoryFilter === cat ? '#fff' : 'var(--t2)',
                  }}
                >
                  {cat}
                </button>
              ))}
            </div>

            <div style={{ flex: 1, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 8 }}>
              {leads.length === 0 ? (
                <div style={{ padding: 20, textAlign: 'center', color: 'var(--t3)', fontSize: 13 }}>
                  No matching CRM leads found.
                </div>
              ) : (
                leads.map((l) => {
                  const isSelected = l.id === selectedLeadId;
                  return (
                    <div
                      key={l.id}
                      onClick={() => setSelectedLeadId(l.id)}
                      style={{
                        padding: 12,
                        borderRadius: 10,
                        border: `1px solid ${isSelected ? 'var(--primary)' : 'var(--bd)'}`,
                        background: isSelected ? 'rgba(99, 102, 241, 0.06)' : 'var(--bg)',
                        cursor: 'pointer',
                        transition: 'all 0.15s ease',
                      }}
                    >
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 4 }}>
                        <span style={{ fontSize: 13.5, fontWeight: 700, color: 'var(--t1)' }}>{l.contact?.name || l.contact?.phoneNumber}</span>
                        <CategoryBadge category={l.category} />
                      </div>
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', fontSize: 11.5, color: 'var(--t2)' }}>
                        <span>{l.contact?.phoneNumber}</span>
                        <span style={{ fontWeight: 600, color: 'var(--primary)' }}>Score: {l.score}</span>
                      </div>
                    </div>
                  );
                })
              )}
            </div>
          </div>

          {/* MIDDLE: CONVERSATION THREAD & MESSAGE COMPOSER */}
          <div style={{ background: 'var(--surf)', border: '1px solid var(--bd)', borderRadius: 14, display: 'flex', flexDirection: 'column' }}>
            {selectedLead ? (
              <>
                {/* THREAD HEADER */}
                <div style={{ padding: '16px 20px', borderBottom: '1px solid var(--bd)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <div>
                    <h3 style={{ margin: 0, fontSize: 16, fontWeight: 700, color: 'var(--t1)' }}>
                      Conversation with {selectedLead.contact?.name || selectedLead.contact?.phoneNumber}
                    </h3>
                    <div style={{ fontSize: 12, color: 'var(--t2)', marginTop: 2 }}>
                      WhatsApp Contact: {selectedLead.contact?.phoneNumber}
                    </div>
                  </div>
                  <div style={{ display: 'flex', gap: 8 }}>
                    <Btn size="sm" variant="sec" onClick={() => setShowTemplateModal(true)}>
                      <I n="fileText" s={14} /> Send Template
                    </Btn>
                  </div>
                </div>

                {/* MESSAGES TRAIL */}
                <div style={{ flex: 1, padding: 20, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 12, background: 'var(--bg)' }}>
                  {messages.length === 0 ? (
                    <div style={{ margin: 'auto', textAlign: 'center', color: 'var(--t3)', fontSize: 13 }}>
                      No message history with this lead yet. Start the conversation below.
                    </div>
                  ) : (
                    messages.map((m) => {
                      const isOutbound = m.direction === 'OUTBOUND';
                      return (
                        <div
                          key={m.id}
                          style={{
                            alignSelf: isOutbound ? 'flex-end' : 'flex-start',
                            maxWidth: '75%',
                            padding: '10px 14px',
                            borderRadius: 12,
                            background: isOutbound ? 'var(--primary)' : 'var(--surf)',
                            color: isOutbound ? '#fff' : 'var(--t1)',
                            border: isOutbound ? 'none' : '1px solid var(--bd)',
                            fontSize: 13.5,
                            boxShadow: '0 1px 3px rgba(0,0,0,0.05)',
                          }}
                        >
                          <div>{m.body}</div>
                          <div style={{ fontSize: 10, opacity: 0.7, textAlign: 'right', marginTop: 4 }}>
                            {new Date(m.sentAt || m.createdAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                          </div>
                        </div>
                      );
                    })
                  )}
                </div>

                {/* COMPOSER */}
                <div style={{ padding: 16, borderTop: '1px solid var(--bd)', display: 'flex', gap: 10 }}>
                  <FInput
                    placeholder="Type WhatsApp message to lead..."
                    value={messageText}
                    onChange={(e) => setMessageText(e.target.value)}
                    onKeyDown={(e) => e.key === 'Enter' && !e.shiftKey && handleSendMessage()}
                    style={{ flex: 1 }}
                  />
                  <Btn onClick={handleSendMessage} disabled={sendingMsg || !messageText.trim()}>
                    <I n="send" s={16} /> Send
                  </Btn>
                </div>
              </>
            ) : (
              <div style={{ margin: 'auto', color: 'var(--t3)', fontSize: 14 }}>
                Select a lead from the list to view conversation.
              </div>
            )}
          </div>

          {/* RIGHT: CRM CONTEXT PANEL */}
          <div style={{ background: 'var(--surf)', border: '1px solid var(--bd)', borderRadius: 14, padding: 20, overflowY: 'auto' }}>
            {selectedLead ? (
              <div>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
                  <h3 style={{ margin: 0, fontSize: 15, fontWeight: 700, color: 'var(--t1)' }}>CRM Context</h3>
                  <Btn size="xs" variant="ghost" onClick={handleRecalculateCategory} title="Recalculate Lead Category & Score">
                    <I n="refresh" s={14} /> Recalculate
                  </Btn>
                </div>

                {/* LEAD HEADER */}
                <div style={{ display: 'flex', alignItems: 'center', gap: 12, paddingBottom: 16, borderBottom: '1px solid var(--bd)', marginBottom: 16 }}>
                  <Avatar name={selectedLead.contact?.name || 'L'} size={42} />
                  <div>
                    <div style={{ fontSize: 15, fontWeight: 700, color: 'var(--t1)' }}>{selectedLead.contact?.name || 'Unnamed Lead'}</div>
                    <div style={{ fontSize: 12, color: 'var(--t2)' }}>{selectedLead.contact?.phoneNumber}</div>
                  </div>
                </div>

                {/* CATEGORY & EXPLAINABILITY */}
                <div style={{ marginBottom: 20 }}>
                  <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--t2)', textTransform: 'uppercase', marginBottom: 6 }}>
                    Lead Category (Segmentation)
                  </div>
                  <div style={{ marginBottom: 10 }}>
                    <CategoryBadge category={selectedLead.category} />
                  </div>

                  {/* EXPLAINABILITY REASONS BOX */}
                  <div style={{ background: 'var(--bg)', borderRadius: 10, border: '1px solid var(--bd)', padding: 12 }}>
                    <div style={{ fontSize: 11.5, fontWeight: 700, color: 'var(--t1)', marginBottom: 6, display: 'flex', alignItems: 'center', gap: 6 }}>
                      <I n="info" s={14} c="var(--primary)" /> Segmentation Reasons:
                    </div>
                    {Array.isArray(selectedLead.categoryReasons) && selectedLead.categoryReasons.length > 0 ? (
                      <ul style={{ margin: 0, paddingLeft: 16, fontSize: 12, color: 'var(--t2)', display: 'flex', flexDirection: 'column', gap: 4 }}>
                        {selectedLead.categoryReasons.map((r, i) => (
                          <li key={i}>{r}</li>
                        ))}
                      </ul>
                    ) : (
                      <div style={{ fontSize: 12, color: 'var(--t3)' }}>No explanation available yet.</div>
                    )}
                  </div>
                </div>

                {/* METRICS & STATUS */}
                <div style={{ display: 'flex', flexDirection: 'column', gap: 12, fontSize: 13 }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', borderBottom: '1px solid var(--bd)', paddingBottom: 8 }}>
                    <span style={{ color: 'var(--t2)' }}>Lead Status</span>
                    <StatusBadge s={selectedLead.status} />
                  </div>
                  <div style={{ display: 'flex', justifyContent: 'space-between', borderBottom: '1px solid var(--bd)', paddingBottom: 8 }}>
                    <span style={{ color: 'var(--t2)' }}>Lead Score</span>
                    <span style={{ fontWeight: 700, color: 'var(--primary)' }}>{selectedLead.score} / 100</span>
                  </div>
                  <div style={{ display: 'flex', justifyContent: 'space-between', borderBottom: '1px solid var(--bd)', paddingBottom: 8 }}>
                    <span style={{ color: 'var(--t2)' }}>Source</span>
                    <span style={{ fontWeight: 600, color: 'var(--t1)' }}>{selectedLead.source || 'Direct'}</span>
                  </div>
                </div>

                {/* FORM ANSWERS SUMMARY */}
                {selectedLead.LeadFormSubmission?.length > 0 && (
                  <div style={{ marginTop: 20 }}>
                    <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--t2)', textTransform: 'uppercase', marginBottom: 6 }}>
                      Recent Form Submission Answers
                    </div>
                    <div style={{ background: 'var(--bg)', borderRadius: 10, border: '1px solid var(--bd)', padding: 12, fontSize: 12, color: 'var(--t2)' }}>
                      {Object.entries(selectedLead.LeadFormSubmission[0].answers || {}).map(([k, v]) => (
                        <div key={k} style={{ marginBottom: 4 }}>
                          <strong style={{ color: 'var(--t1)' }}>{k}:</strong> {String(v)}
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            ) : (
              <div style={{ textAlign: 'center', color: 'var(--t3)', fontSize: 13, paddingTop: 40 }}>
                Select a lead to view CRM details and segmentation explanation.
              </div>
            )}
          </div>
        </div>
      )}

      {/* TAB 2: SEGMENT & FILTER BULK CAMPAIGN MODE */}
      {activeTab === 'segment' && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 24 }}>
          {/* CONTROLS & SELECTION */}
          <div style={{ background: 'var(--surf)', border: '1px solid var(--bd)', borderRadius: 14, padding: 20 }}>
            <h3 style={{ margin: '0 0 16px 0', fontSize: 16, fontWeight: 700, color: 'var(--t1)' }}>
              1. Select CRM Segment & Filters
            </h3>

            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 16 }}>
              <div>
                <FLabel>Lead Category Segment</FLabel>
                <FSelect value={segCategory} onChange={(e) => setSegCategory(e.target.value)}>
                  <option value="HOT">HOT Leads (High Intent & Score)</option>
                  <option value="WARM">WARM Leads (Moderate Intent & Score)</option>
                  <option value="COLD">COLD Leads (Low Engagement)</option>
                  <option value="ALL">All Leads (Entire CRM)</option>
                </FSelect>
              </div>

              <div>
                <FLabel>Source Filter</FLabel>
                <FInput
                  placeholder="e.g. Website, Form, Ads..."
                  value={segSource}
                  onChange={(e) => setSegSource(e.target.value)}
                />
              </div>

              <div>
                <FLabel>Lead Status Filter</FLabel>
                <FSelect value={segStatus} onChange={(e) => setSegStatus(e.target.value)}>
                  <option value="">All Lead Statuses</option>
                  <option value="NEW">NEW</option>
                  <option value="CONTACTED">CONTACTED</option>
                  <option value="QUALIFIED">QUALIFIED</option>
                  <option value="UNQUALIFIED">UNQUALIFIED</option>
                </FSelect>
              </div>
            </div>
          </div>

          {/* AUDIENCE REVIEW SUMMARY CARDS */}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 16 }}>
            <div style={{ background: 'var(--surf)', border: '1px solid var(--bd)', borderRadius: 12, padding: 20 }}>
              <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--t2)', textTransform: 'uppercase' }}>
                Total Matching CRM Leads
              </div>
              <div style={{ fontSize: 32, fontWeight: 800, color: 'var(--t1)', marginTop: 4 }}>
                {audienceData.matchingCount}
              </div>
            </div>

            <div style={{ background: 'var(--surf)', border: '1px solid var(--gbd)', borderRadius: 12, padding: 20 }}>
              <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--green)', textTransform: 'uppercase' }}>
                Eligible For WhatsApp Delivery
              </div>
              <div style={{ fontSize: 32, fontWeight: 800, color: 'var(--green)', marginTop: 4 }}>
                {audienceData.eligibleCount}
              </div>
            </div>

            <div style={{ background: 'var(--surf)', border: '1px solid rgba(239, 68, 68, 0.3)', borderRadius: 12, padding: 20 }}>
              <div style={{ fontSize: 12, fontWeight: 600, color: '#f87171', textTransform: 'uppercase' }}>
                Excluded Contacts ({audienceData.excludedCount})
              </div>
              <div style={{ fontSize: 12.5, color: 'var(--t2)', marginTop: 8, display: 'flex', flexDirection: 'column', gap: 4 }}>
                <div>• Opted Out: <strong>{audienceData.exclusions?.optedOutCount || 0}</strong></div>
                <div>• Missing/Invalid Phone: <strong>{audienceData.exclusions?.invalidPhoneCount || 0}</strong></div>
              </div>
            </div>
          </div>

          {/* LAUNCH BAR & AUDIENCE REVIEW TABLE */}
          <div style={{ background: 'var(--surf)', border: '1px solid var(--bd)', borderRadius: 14, padding: 20 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
              <h3 style={{ margin: 0, fontSize: 16, fontWeight: 700, color: 'var(--t1)' }}>
                2. Audience Review ({(audienceData?.leads || []).length} Leads)
              </h3>

              <Btn
                disabled={(audienceData?.eligibleCount || 0) === 0}
                onClick={() => setShowConfirmModal(true)}
              >
                <I n="send" s={16} /> Configure & Launch WhatsApp Campaign
              </Btn>
            </div>

            {/* AUDIENCE TABLE */}
            <div style={{ overflowX: 'auto' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
                <thead>
                  <tr style={{ borderBottom: '1px solid var(--bd)', textAlign: 'left', color: 'var(--t2)', fontSize: 12 }}>
                    <th style={{ padding: 10 }}>Lead Name</th>
                    <th style={{ padding: 10 }}>Phone Number</th>
                    <th style={{ padding: 10 }}>Category</th>
                    <th style={{ padding: 10 }}>Score</th>
                    <th style={{ padding: 10 }}>Status</th>
                    <th style={{ padding: 10 }}>Source</th>
                    <th style={{ padding: 10 }}>Delivery Status</th>
                  </tr>
                </thead>
                <tbody>
                  {loadingAudience ? (
                    <tr>
                      <td colSpan={7} style={{ padding: 20, textAlign: 'center', color: 'var(--t2)' }}>
                        Resolving audience...
                      </td>
                    </tr>
                  ) : (audienceData?.leads || []).length === 0 ? (
                    <tr>
                      <td colSpan={7} style={{ padding: 20, textAlign: 'center', color: 'var(--t3)' }}>
                        No leads match the selected segment and filters.
                      </td>
                    </tr>
                  ) : (
                    (audienceData?.leads || []).map((l) => (
                      <tr key={l.id} style={{ borderBottom: '1px solid var(--bd)' }}>
                        <td style={{ padding: 10, fontWeight: 600, color: 'var(--t1)' }}>{l.name}</td>
                        <td style={{ padding: 10, color: 'var(--t2)' }}>{l.phoneNumber}</td>
                        <td style={{ padding: 10 }}><CategoryBadge category={l.category} /></td>
                        <td style={{ padding: 10, fontWeight: 700, color: 'var(--primary)' }}>{l.score}</td>
                        <td style={{ padding: 10 }}>
                          <StatusBadge label={l.status || 'NEW'} tone={l.status === 'QUALIFIED' ? 'green' : l.status === 'CONTACTED' ? 'violet' : 'gray'} />
                        </td>
                        <td style={{ padding: 10, color: 'var(--t2)' }}>{l.source}</td>
                        <td style={{ padding: 10 }}>
                          {l.isEligible ? (
                            <span style={{ color: 'var(--green)', fontWeight: 700, fontSize: 12 }}>Eligible</span>
                          ) : (
                            <span style={{ color: '#f87171', fontWeight: 600, fontSize: 12 }}>
                              Excluded ({l.exclusionReason})
                            </span>
                          )}
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>

          </div>
        </div>
      )}

      {/* MODAL: INDIVIDUAL TEMPLATE SEND */}
      {showTemplateModal && (
        <Modal title="Send Approved WhatsApp Template" onClose={() => setShowTemplateModal(false)}>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
            <div>
              <FLabel>Select Approved Template</FLabel>
              <FSelect value={selectedTemplateId} onChange={(e) => setSelectedTemplateId(e.target.value)}>
                <option value="">Select a template...</option>
                {templates.map((t) => (
                  <option key={t.id} value={t.id}>{t.name} ({t.category})</option>
                ))}
              </FSelect>
            </div>
            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 10 }}>
              <Btn variant="sec" onClick={() => setShowTemplateModal(false)}>Cancel</Btn>
              <Btn onClick={handleSendTemplate} disabled={!selectedTemplateId || sendingMsg}>
                Send Template Message
              </Btn>
            </div>
          </div>
        </Modal>
      )}

      {/* MODAL: BULK CAMPAIGN CONFIRMATION & SETUP */}
      {showConfirmModal && (
        <Modal title="Configure & Launch Bulk Segment Campaign" onClose={() => setShowConfirmModal(false)}>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
            <div>
              <FLabel>Campaign Name</FLabel>
              <FInput
                placeholder={`e.g. ${segCategory} Leads Campaign`}
                value={campaignName}
                onChange={(e) => setCampaignName(e.target.value)}
              />
            </div>

            <div>
              <FLabel>Select WhatsApp Approved Template</FLabel>
              <FSelect value={campaignTemplateId} onChange={(e) => setCampaignTemplateId(e.target.value)}>
                <option value="">Select template...</option>
                {templates.map((t) => (
                  <option key={t.id} value={t.id}>{t.name} ({t.language})</option>
                ))}
              </FSelect>
            </div>

            <div>
              <FLabel>Select WhatsApp Number</FLabel>
              <FSelect value={campaignWaNumberId} onChange={(e) => setCampaignWaNumberId(e.target.value)}>
                <option value="">Select sender number...</option>
                {waNumbers.map((n) => (
                  <option key={n.id} value={n.id}>{n.displayName || n.phoneNumber}</option>
                ))}
              </FSelect>
            </div>

            <div style={{ background: 'var(--bg)', padding: 14, borderRadius: 10, border: '1px solid var(--bd)', fontSize: 13, color: 'var(--t2)' }}>
              <div>• Dynamic Audience Category: <strong>{segCategory}</strong></div>
              <div>• Recipients to Message: <strong>{audienceData.eligibleCount} eligible leads</strong></div>
              <div>• Excluded Contacts: <strong>{audienceData.excludedCount} contacts</strong></div>
            </div>

            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 10, marginTop: 10 }}>
              <Btn variant="sec" onClick={() => setShowConfirmModal(false)}>Cancel</Btn>
              <Btn onClick={handleLaunchCampaign} disabled={launching || !campaignTemplateId || !campaignWaNumberId}>
                {launching ? 'Launching Campaign...' : 'Confirm & Launch Campaign'}
              </Btn>
            </div>
          </div>
        </Modal>
      )}

      {/* LAUNCH SUCCESS BANNER */}
      {launchSuccess && (
        <Modal title="Campaign Launched Successfully! 🎉" onClose={() => setLaunchSuccess(null)}>
          <div style={{ fontSize: 14, color: 'var(--t1)', display: 'flex', flexDirection: 'column', gap: 12 }}>
            <div>
              Bulk campaign <strong>{launchSuccess.campaign?.name}</strong> has been created and launched for WhatsApp delivery.
            </div>
            <div style={{ background: 'var(--bg)', padding: 12, borderRadius: 8, fontSize: 13, color: 'var(--t2)' }}>
              <div>• Sent to: <strong>{launchSuccess.audienceSummary?.eligibleSent} eligible contacts</strong></div>
              <div>• Excluded: <strong>{launchSuccess.audienceSummary?.excluded} contacts</strong></div>
            </div>
            <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
              <Btn onClick={() => setLaunchSuccess(null)}>Done</Btn>
            </div>
          </div>
        </Modal>
      )}
    </div>
  );
}
