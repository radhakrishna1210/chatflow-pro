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
  const [windowState, setWindowState] = useState(null);
  const [chatError, setChatError] = useState(null);
  const [messageText, setMessageText] = useState('');
  const [sendingMsg, setSendingMsg] = useState(false);
  const [showTemplateModal, setShowTemplateModal] = useState(false);
  const [selectedTemplateId, setSelectedTemplateId] = useState('');
  const [templateVars, setTemplateVars] = useState({});

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

  // Sequence Enrollment State
  const [sequencesList, setSequencesList] = useState([]);
  const [showEnrollModal, setShowEnrollModal] = useState(false);
  const [selectedSequenceId, setSelectedSequenceId] = useState('');
  const [enrolling, setEnrolling] = useState(false);
  const [enrollTarget, setEnrollTarget] = useState(null); // { type: 'lead', leadId } or { type: 'segment', leadIds }

  // Lead Deletion State
  const [confirmDeleteLead, setConfirmDeleteLead] = useState(false);
  const [deletingLead, setDeletingLead] = useState(false);
  const [selectedAudienceIds, setSelectedAudienceIds] = useState(new Set());
  const [confirmBulkDeleteAudience, setConfirmBulkDeleteAudience] = useState(false);
  const [bulkDeletingAudience, setBulkDeletingAudience] = useState(false);

  // Campaign Analytics & Inbox Filter State
  const [campaignAnalytics, setCampaignAnalytics] = useState(null);
  const [loadingAnalytics, setLoadingAnalytics] = useState(false);
  const [inboxFilter, setInboxFilter] = useState('all'); // 'all' | 'my' | 'uncontacted' | 'awaiting_task' | 'opted_out'

  // Resizable Panel Widths for Individual Lead Mode
  const [leftWidth, setLeftWidth] = useState(() => {
    const saved = localStorage.getItem('crm_sales_inbox_left_width');
    return saved ? Math.max(240, Math.min(450, Number(saved))) : 300;
  });
  const [rightWidth, setRightWidth] = useState(() => {
    const saved = localStorage.getItem('crm_sales_inbox_right_width');
    return saved ? Math.max(300, Math.min(650, Number(saved))) : 380;
  });
  const [isResizingLeft, setIsResizingLeft] = useState(false);
  const [isResizingRight, setIsResizingRight] = useState(false);

  // Resize Left (Lead List)
  const startResizeLeft = useCallback((e) => {
    e.preventDefault();
    setIsResizingLeft(true);
    const startX = e.clientX;
    const startW = leftWidth;

    const onMouseMove = (moveEv) => {
      const delta = moveEv.clientX - startX;
      const newW = Math.max(240, Math.min(480, startW + delta));
      setLeftWidth(newW);
    };

    const onMouseUp = () => {
      setIsResizingLeft(false);
      window.removeEventListener('mousemove', onMouseMove);
      window.removeEventListener('mouseup', onMouseUp);
      setLeftWidth((w) => {
        localStorage.setItem('crm_sales_inbox_left_width', String(w));
        return w;
      });
    };

    window.addEventListener('mousemove', onMouseMove);
    window.addEventListener('mouseup', onMouseUp);
  }, [leftWidth]);

  // Resize Right (CRM Context Panel & Conversation)
  const startResizeRight = useCallback((e) => {
    e.preventDefault();
    setIsResizingRight(true);
    const startX = e.clientX;
    const startW = rightWidth;

    const onMouseMove = (moveEv) => {
      const delta = startX - moveEv.clientX;
      const newW = Math.max(300, Math.min(650, startW + delta));
      setRightWidth(newW);
    };

    const onMouseUp = () => {
      setIsResizingRight(false);
      window.removeEventListener('mousemove', onMouseMove);
      window.removeEventListener('mouseup', onMouseUp);
      setRightWidth((w) => {
        localStorage.setItem('crm_sales_inbox_right_width', String(w));
        return w;
      });
    };

    window.addEventListener('mousemove', onMouseMove);
    window.addEventListener('mouseup', onMouseUp);
  }, [rightWidth]);

  // 1. Fetch initial segments & metadata
  const fetchMetadata = useCallback(async () => {
    setLoading(true);
    try {
      const [segRes, tmplRes, numRes, seqRes] = await Promise.all([
        wFetch('/crm-sales-inbox/segments').then(r => r.ok ? r.json() : null),
        wFetch('/templates').then(r => r.ok ? r.json() : null),
        wFetch('/whatsapp/numbers').then(r => r.ok ? r.json() : null),
        wFetch('/sequences').then(r => r.ok ? r.json() : null),
      ]);
      setSegments(segRes || { categories: { HOT: 0, WARM: 0, COLD: 0, ALL: 0 }, sources: [] });
      setTemplates(Array.isArray(tmplRes?.data) ? tmplRes.data : Array.isArray(tmplRes) ? tmplRes : []);
      const nums = Array.isArray(numRes) ? numRes : Array.isArray(numRes?.data) ? numRes.data : [];
      setWaNumbers(nums);
      setSequencesList(Array.isArray(seqRes?.data) ? seqRes.data : Array.isArray(seqRes) ? seqRes : []);
      if (nums.length > 0) {
        setCampaignWaNumberId(nums[0].id);
      }
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

  useEffect(() => {
    if (!campaignWaNumberId && waNumbers.length > 0) {
      setCampaignWaNumberId(waNumbers[0].id);
    }
  }, [waNumbers, campaignWaNumberId]);

  // 2. Fetch Leads for Individual Mode
  const fetchLeads = useCallback(async () => {
    try {
      const query = new URLSearchParams();
      if (categoryFilter && categoryFilter !== 'ALL') query.set('category', categoryFilter);
      if (statusFilter) query.set('status', statusFilter);
      if (leadSearch) query.set('search', leadSearch);
      if (inboxFilter && inboxFilter !== 'all') query.set('preset', inboxFilter);

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
  }, [categoryFilter, statusFilter, leadSearch, selectedLeadId, inboxFilter]);

  useEffect(() => {
    if (activeTab === 'individual') {
      fetchLeads();
    }
  }, [activeTab, fetchLeads]);

  // Fetch Campaign Analytics
  const fetchCampaignAnalytics = useCallback(async () => {
    setLoadingAnalytics(true);
    try {
      const res = await wFetch('/crm-sales-inbox/campaign-analytics');
      if (res.ok) {
        const data = await res.json();
        setCampaignAnalytics(data);
      }
    } catch (err) {
      console.error('[CrmSalesInbox] Error fetching campaign analytics:', err);
    } finally {
      setLoadingAnalytics(false);
    }
  }, []);

  useEffect(() => {
    if (activeTab === 'analytics' || activeTab === 'segment') {
      fetchCampaignAnalytics();
    }
  }, [activeTab, fetchCampaignAnalytics]);


  // 3. Fetch Selected Lead Details & Messages
  const loadLeadContext = useCallback(async (leadId) => {
    if (!leadId) return;
    setChatError(null);
    try {
      const leadRes = await wFetch(`/leads/${leadId}`);
      if (!leadRes.ok) return;
      const leadData = await leadRes.json();
      setSelectedLead(leadData);

      // Fetch or find conversation strictly for contact
      if (leadData?.contactId) {
        const convsRes = await wFetch(`/conversations?contactId=${encodeURIComponent(leadData.contactId)}`);
        let convList = [];
        if (convsRes.ok) {
          const convsData = await convsRes.json();
          convList = Array.isArray(convsData) ? convsData : convsData?.data || [];
        }
        // STRICT MATCH: Must belong to leadData.contactId and never fallback to an unrelated conversation
        const match = Array.isArray(convList)
          ? convList.find((c) => c.contactId === leadData.contactId)
          : null;

        if (match && match.contactId === leadData.contactId) {
          setConversation(match);
          const msgsRes = await wFetch(`/conversations/${match.id}/messages`);
          if (msgsRes.ok) {
            const msgsData = await msgsRes.json();
            const list = Array.isArray(msgsData) ? msgsData : msgsData?.messages || msgsData?.data || [];
            setMessages(list);
            if (!Array.isArray(msgsData) && msgsData?.window) {
              setWindowState(msgsData.window);
            } else {
              setWindowState(null);
            }
          }
        } else {
          setConversation(null);
          setMessages([]);
          setWindowState(null);
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
    setChatError(null);
    try {
      let activeConv = conversation;

      // Create or get conversation if none exists
      if (!activeConv) {
        const newRes = await wFetch('/conversations', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ contactId: selectedLead.contactId }),
        });
        if (!newRes.ok) {
          const errData = await newRes.json().catch(() => ({}));
          throw new Error(errData.error || 'Failed to create conversation');
        }
        const createdConv = await newRes.json();
        activeConv = createdConv;
        setConversation(createdConv);
      }

      // CRITICAL RECIPIENT & OPT-OUT SAFETY CHECK
      if (selectedLead.contact?.optedOut) {
        throw new Error('This contact has opted out of communications. Outbound messages are blocked.');
      }
      if (activeConv.contactId !== selectedLead.contactId) {
        throw new Error(`Recipient mismatch: conversation contact (${activeConv.contactId}) does not match selected lead (${selectedLead.contactId}). Message aborted.`);
      }
      if (activeConv.contact?.phoneNumber && selectedLead.contact?.phoneNumber && activeConv.contact.phoneNumber !== selectedLead.contact.phoneNumber) {
        throw new Error(`Recipient phone mismatch: conversation phone (${activeConv.contact.phoneNumber}) does not match selected lead (${selectedLead.contact.phoneNumber}). Message aborted.`);
      }

      const res = await wFetch(`/conversations/${activeConv.id}/messages`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          body: messageText.trim(),
          contactId: selectedLead.contactId,
          phoneNumber: selectedLead.contact?.phoneNumber,
        }),
      });
      if (!res.ok) {
        const errData = await res.json().catch(() => ({}));
        const errMsg = errData.error || 'Failed to send message';
        const errObj = new Error(errMsg);
        errObj.code = errData.code;
        throw errObj;
      }
      const sentMsg = await res.json();

      setMessages((prev) => [...prev, sentMsg]);
      setMessageText('');
      setChatError(null);
      setWindowState({ open: true });

      // Refresh lead details to pick up updated category/score
      loadLeadContext(selectedLeadId);
    } catch (err) {
      const isWindowErr = err.code === 'OUTSIDE_24H_WINDOW' ||
        err.message?.toLowerCase().includes('24-hour') ||
        err.message?.toLowerCase().includes('approved template') ||
        err.message?.toLowerCase().includes('not messaged you');

      if (isWindowErr) {
        setChatError('This contact is outside WhatsApp\'s 24-hour reply window according to Meta. Please send an approved template message to re-engage them.');
      } else {
        setChatError(err.message);
      }
    } finally {
      setSendingMsg(false);
    }
  };

  const handleReopenWindow = async () => {
    if (!conversation?.id) return;
    try {
      const res = await wFetch(`/conversations/${conversation.id}/reopen-window`, { method: 'POST' });
      if (res.ok) {
        const d = await res.json();
        setWindowState(d.window || { open: true });
        setChatError(null);
      }
    } catch (e) {
      console.error('Failed to reopen window', e);
    }
  };

  const handleSimulateInbound = async (text = 'Hii') => {
    if (!conversation?.id) return;
    try {
      const res = await wFetch(`/conversations/${conversation.id}/inbound-simulate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ body: text }),
      });
      if (res.ok) {
        const d = await res.json();
        if (d.message) setMessages((prev) => [...prev, d.message]);
        setWindowState(d.window || { open: true });
        setChatError(null);
        loadLeadContext(selectedLeadId);
      }
    } catch (e) {
      console.error('Failed to simulate inbound message', e);
    }
  };

  // 6. Template Message Sending (Individual)
  const handleSendTemplate = async () => {
    if (!selectedTemplateId || !selectedLead) return;
    setSendingMsg(true);
    setChatError(null);
    try {
      let activeConv = conversation;

      // Create or get conversation if none exists
      if (!activeConv) {
        const newRes = await wFetch('/conversations', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ contactId: selectedLead.contactId }),
        });
        if (!newRes.ok) {
          const errData = await newRes.json().catch(() => ({}));
          throw new Error(errData.error || 'Failed to create conversation');
        }
        const createdConv = await newRes.json();
        activeConv = createdConv;
        setConversation(createdConv);
      }

      // CRITICAL RECIPIENT & OPT-OUT SAFETY CHECK
      if (selectedLead.contact?.optedOut) {
        throw new Error('This contact has opted out of communications. Outbound templates are blocked.');
      }
      if (activeConv.contactId !== selectedLead.contactId) {
        throw new Error(`Recipient mismatch: conversation contact (${activeConv.contactId}) does not match selected lead (${selectedLead.contactId}). Template aborted.`);
      }
      if (activeConv.contact?.phoneNumber && selectedLead.contact?.phoneNumber && activeConv.contact.phoneNumber !== selectedLead.contact.phoneNumber) {
        throw new Error(`Recipient phone mismatch: conversation phone (${activeConv.contact.phoneNumber}) does not match selected lead (${selectedLead.contact.phoneNumber}). Template aborted.`);
      }

      const selObj = templates.find((t) => t.id === selectedTemplateId);
      const reqCount = (selObj?.components || []).reduce((max, c) => {
        const nums = [...String(c?.text || '').matchAll(/\{\{(\d+)\}\}/g)].map((m) => parseInt(m[1], 10));
        return nums.length ? Math.max(max, Math.max(...nums)) : max;
      }, 0);

      const varsArray = Array.from({ length: reqCount }, (_, i) => templateVars[i] || (i === 0 ? selectedLead?.contact?.name || 'Customer' : ''));

      const res = await wFetch(`/conversations/${activeConv.id}/template`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          templateId: selectedTemplateId,
          variables: varsArray,
          contactId: selectedLead.contactId,
          phoneNumber: selectedLead.contact?.phoneNumber,
        }),
      });
      if (!res.ok) {
        const errData = await res.json().catch(() => ({}));
        throw new Error(errData.error || 'Failed to send template');
      }

      setShowTemplateModal(false);
      setTemplateVars({});
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
      fetchCampaignAnalytics();
    } catch (err) {
      alert(`Campaign launch failed: ${err.message}`);
    } finally {
      setLaunching(false);
    }
  };

  // 9. Enroll Lead or Segment in Sequence
  const handleEnrollInSequence = async () => {
    if (!selectedSequenceId || !enrollTarget) return;
    setEnrolling(true);
    try {
      const payload = enrollTarget.type === 'lead'
        ? { leadIds: [enrollTarget.leadId] }
        : { leadIds: enrollTarget.leadIds };

      const res = await wFetch(`/sequences/${selectedSequenceId}/enroll`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });

      if (!res.ok) {
        const errData = await res.json().catch(() => ({}));
        throw new Error(errData.error || errData.message || 'Failed to enroll');
      }

      const resData = await res.json();
      setShowEnrollModal(false);
      setSelectedSequenceId('');
      alert(`Successfully enrolled ${resData.enrolled} lead(s) into the sequence!`);
    } catch (err) {
      alert(`Sequence enrollment failed: ${err.message}`);
    } finally {
      setEnrolling(false);
    }
  };

  // 10. Single Lead Deletion
  const handleDeleteSingleLead = async () => {
    if (!selectedLeadId) return;
    setDeletingLead(true);
    try {
      const res = await wFetch(`/leads/${selectedLeadId}`, { method: 'DELETE' });
      if (!res.ok) {
        const d = await res.json().catch(() => ({}));
        throw new Error(d.error || 'Failed to delete lead');
      }
      setConfirmDeleteLead(false);
      setSelectedLead(null);
      setSelectedLeadId(null);
      fetchLeads();
      fetchMetadata();
      window.dispatchEvent(new CustomEvent('crm:pipeline-sync'));
    } catch (err) {
      alert(`Could not delete lead: ${err.message}`);
    } finally {
      setDeletingLead(false);
    }
  };

  // 11. Bulk Audience Deletion (Segment Mode)
  const toggleSelectAudience = (id) => {
    setSelectedAudienceIds((prev) => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  };

  const toggleSelectAllAudience = () => {
    const allIds = (audienceData?.leads || []).map((l) => l.id);
    if (selectedAudienceIds.size === allIds.length) {
      setSelectedAudienceIds(new Set());
    } else {
      setSelectedAudienceIds(new Set(allIds));
    }
  };

  const handleBulkDeleteAudience = async () => {
    if (selectedAudienceIds.size === 0) return;
    setBulkDeletingAudience(true);
    try {
      const res = await wFetch('/leads/bulk-delete', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ids: [...selectedAudienceIds] }),
      });
      if (!res.ok) {
        const d = await res.json().catch(() => ({}));
        throw new Error(d.error || 'Bulk delete failed');
      }
      setConfirmBulkDeleteAudience(false);
      setSelectedAudienceIds(new Set());
      fetchAudience();
      fetchMetadata();
      fetchLeads();
      window.dispatchEvent(new CustomEvent('crm:pipeline-sync'));
    } catch (err) {
      alert(`Bulk delete failed: ${err.message}`);
    } finally {
      setBulkDeletingAudience(false);
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
    <div style={{ padding: '16px 20px', width: '100%', height: 'calc(100vh - 32px)', display: 'flex', flexDirection: 'column', boxSizing: 'border-box', overflow: 'hidden' }}>
      {/* HEADER & NAVIGATION */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16, flexShrink: 0 }}>
        <div>
          <h1 style={{ fontSize: 22, fontWeight: 700, color: 'var(--t1)', margin: 0, display: 'flex', alignItems: 'center', gap: 10 }}>
            <I n="messageSquare" s={24} c="var(--primary)" />
            CRM Sales Inbox
          </h1>
          <p style={{ fontSize: 12.5, color: 'var(--t2)', margin: '3px 0 0 0' }}>
            Message specific CRM leads or target dynamically segmented lead audiences via WhatsApp bulk campaigns.
          </p>
        </div>

        {/* TAB SWITCHER */}
        <div style={{ display: 'flex', background: 'var(--surf)', padding: 4, borderRadius: 10, border: '1px solid var(--bd)' }}>
          <button
            onClick={() => setActiveTab('individual')}
            style={{
              padding: '7px 14px',
              borderRadius: 8,
              border: 'none',
              fontSize: 12.5,
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
            <I n="user" s={15} />
            Individual Lead Mode
          </button>
          <button
            onClick={() => setActiveTab('segment')}
            style={{
              padding: '7px 14px',
              borderRadius: 8,
              border: 'none',
              fontSize: 12.5,
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
            <I n="target" s={15} />
            Segment Broadcast
          </button>
          <button
            onClick={() => setActiveTab('analytics')}
            style={{
              padding: '7px 14px',
              borderRadius: 8,
              border: 'none',
              fontSize: 12.5,
              fontWeight: 600,
              cursor: 'pointer',
              background: activeTab === 'analytics' ? 'var(--primary)' : 'transparent',
              color: activeTab === 'analytics' ? '#fff' : 'var(--t2)',
              display: 'flex',
              alignItems: 'center',
              gap: 6,
              transition: 'all 0.15s ease',
            }}
          >
            <I n="barChart" s={15} />
            Campaign Performance
          </button>
        </div>
      </div>

      {/* METRICS & CATEGORY BUCKETS OVERVIEW */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 14, marginBottom: 16, flexShrink: 0 }}>
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
              padding: '12px 16px',
              cursor: 'pointer',
              transition: 'all 0.2s ease',
              boxShadow: 'var(--card-shadow)',
            }}
          >
            <div style={{ fontSize: 11, fontWeight: 600, color: 'var(--t2)', textTransform: 'uppercase', letterSpacing: 0.5 }}>
              {item.label}
            </div>
            <div style={{ fontSize: 24, fontWeight: 800, color: item.color, marginTop: 2 }}>
              {item.count}
            </div>
          </div>
        ))}
      </div>

      {/* TAB 1: INDIVIDUAL LEAD MESSAGING MODE */}
      {activeTab === 'individual' && (
        <div style={{
          display: 'flex',
          gap: 0,
          flex: 1,
          minHeight: 0,
          overflow: 'hidden',
          userSelect: (isResizingLeft || isResizingRight) ? 'none' : 'auto',
        }}>
          {/* LEFT: LEAD SEARCH & LIST */}
          <div style={{
            width: leftWidth,
            flexShrink: 0,
            background: 'var(--surf)',
            border: '1px solid var(--bd)',
            borderRadius: 14,
            padding: 14,
            display: 'flex',
            flexDirection: 'column',
            height: '100%',
            overflow: 'hidden',
          }}>
            <div style={{ marginBottom: 10, flexShrink: 0 }}>
              <FInput
                placeholder="Search lead by name, phone, email..."
                value={leadSearch}
                onChange={(e) => setLeadSearch(e.target.value)}
              />
            </div>

            <div style={{ display: 'flex', gap: 6, marginBottom: 8, flexWrap: 'wrap', flexShrink: 0 }}>
              {['ALL', 'HOT', 'WARM', 'COLD'].map((cat) => (
                <button
                  key={cat}
                  onClick={() => setCategoryFilter(cat)}
                  style={{
                    padding: '3px 9px',
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

            {/* QUICK THREAD / PIPELINE FILTER PILLS */}
            <div style={{ display: 'flex', gap: 4, marginBottom: 10, flexWrap: 'wrap', flexShrink: 0 }}>
              {[
                { id: 'all', label: 'All' },
                { id: 'my', label: 'My Leads' },
                { id: 'uncontacted', label: 'Uncontacted' },
                { id: 'awaiting_task', label: 'Pending Task' },
                { id: 'opted_out', label: 'DNC / Opt-Out' },
              ].map((pill) => (
                <button
                  key={pill.id}
                  onClick={() => setInboxFilter(pill.id)}
                  style={{
                    padding: '2px 8px',
                    borderRadius: 12,
                    border: `1px solid ${inboxFilter === pill.id ? 'var(--primary)' : 'var(--bd)'}`,
                    fontSize: 10.5,
                    fontWeight: 600,
                    cursor: 'pointer',
                    background: inboxFilter === pill.id ? 'rgba(99, 102, 241, 0.12)' : 'transparent',
                    color: inboxFilter === pill.id ? 'var(--primary)' : 'var(--t3)',
                    transition: 'all 0.15s ease',
                  }}
                >
                  {pill.label}
                </button>
              ))}
            </div>

            <div style={{ flex: 1, minHeight: 0, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 8, paddingRight: 4 }}>
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
                        padding: 10,
                        borderRadius: 10,
                        border: `1px solid ${isSelected ? 'var(--primary)' : 'var(--bd)'}`,
                        background: isSelected ? 'rgba(99, 102, 241, 0.08)' : 'var(--bg)',
                        cursor: 'pointer',
                        transition: 'all 0.15s ease',
                      }}
                    >
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 3 }}>
                        <span style={{ fontSize: 13, fontWeight: 700, color: 'var(--t1)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: 150 }}>{l.contact?.name || l.contact?.phoneNumber}</span>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                          {l.contact?.optedOut && (
                            <span style={{ fontSize: 9.5, fontWeight: 700, padding: '2px 5px', borderRadius: 4, background: 'rgba(239, 68, 68, 0.15)', color: '#f87171' }}>
                              DNC
                            </span>
                          )}
                          <CategoryBadge category={l.category} />
                        </div>
                      </div>
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', fontSize: 11, color: 'var(--t2)' }}>
                        <span>{l.contact?.phoneNumber}</span>
                        <span style={{ fontWeight: 600, color: 'var(--primary)' }}>Score: {l.score}</span>
                      </div>
                    </div>
                  );
                })
              )}
            </div>
          </div>

          {/* LEFT RESIZER */}
          <div
            onMouseDown={startResizeLeft}
            title="Drag to resize lead list"
            style={{
              width: 10,
              cursor: 'col-resize',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              zIndex: 10,
              flexShrink: 0,
              userSelect: 'none',
              transition: 'background 0.15s ease',
              background: isResizingLeft ? 'rgba(99, 102, 241, 0.25)' : 'transparent',
            }}
          >
            <div style={{ width: 2, height: 28, borderRadius: 1, background: isResizingLeft ? 'var(--primary)' : 'var(--bd)' }} />
          </div>

          {/* MIDDLE: CONVERSATION THREAD & MESSAGE COMPOSER */}
          <div style={{
            flex: 1,
            minWidth: 320,
            background: 'var(--surf)',
            border: '1px solid var(--bd)',
            borderRadius: 14,
            display: 'flex',
            flexDirection: 'column',
            height: '100%',
            overflow: 'hidden',
          }}>
            {selectedLead ? (
              <>
                {/* THREAD HEADER */}
                <div style={{ padding: '14px 18px', borderBottom: '1px solid var(--bd)', display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexShrink: 0, gap: 12 }}>
                  <div style={{ minWidth: 0, flex: 1 }}>
                    <h3 style={{ margin: 0, fontSize: 15, fontWeight: 700, color: 'var(--t1)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      Conversation with {selectedLead.contact?.name || selectedLead.contact?.phoneNumber}
                    </h3>
                    <div style={{ fontSize: 11.5, color: 'var(--t2)', marginTop: 2 }}>
                      WhatsApp Contact: {selectedLead.contact?.phoneNumber}
                    </div>
                  </div>
                  <div style={{ display: 'flex', gap: 8, flexShrink: 0 }}>
                    <Btn size="sm" variant="sec" onClick={() => setShowTemplateModal(true)} disabled={selectedLead.contact?.optedOut}>
                      <I n="file" s={14} /> Send Template
                    </Btn>
                  </div>
                </div>

                {/* OPT-OUT NOTICE */}
                {selectedLead.contact?.optedOut && (
                  <div style={{ padding: '9px 14px', background: 'rgba(239, 68, 68, 0.15)', borderBottom: '1px solid rgba(239, 68, 68, 0.3)', color: '#f87171', fontSize: 12, fontWeight: 700, display: 'flex', alignItems: 'center', gap: 8 }}>
                    <span>🛑 DO NOT CONTACT (OPTED OUT): This lead has opted out of WhatsApp messages. Outbound messages and templates are blocked.</span>
                  </div>
                )}

                {/* 24-HOUR WINDOW NOTICE */}
                {!selectedLead.contact?.optedOut && windowState && !windowState.open && (
                  <div style={{ padding: '9px 14px', background: 'rgba(245, 158, 11, 0.12)', borderBottom: '1px solid rgba(245, 158, 11, 0.3)', color: '#fbbf24', fontSize: 12, display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexShrink: 0, gap: 8, flexWrap: 'wrap' }}>
                    <span>
                      ⚡ <strong>WhatsApp 24h Window:</strong> Meta requires customer activity within 24h for free-form replies. You can send a template, or type and send a custom message directly.
                    </span>
                    <div style={{ display: 'flex', gap: 6, flexShrink: 0 }}>
                      <Btn size="xs" variant="sec" onClick={() => setShowTemplateModal(true)}>
                        <I n="file" s={12} /> Send Template
                      </Btn>
                      <Btn size="xs" variant="ghost" onClick={handleReopenWindow} title="Click to sync if the lead already messaged you on WhatsApp">
                        🔄 Sync Window
                      </Btn>
                      <Btn size="xs" variant="ghost" onClick={() => handleSimulateInbound('Hii')} title="Simulate lead inbound reply in dev/test">
                        💬 + Inbound "Hii"
                      </Btn>
                    </div>
                  </div>
                )}

                {/* CHAT ERROR BANNER */}
                {chatError && (
                  <div style={{ padding: '9px 14px', background: 'rgba(239, 68, 68, 0.12)', borderBottom: '1px solid rgba(239, 68, 68, 0.3)', color: '#f87171', fontSize: 12, display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexShrink: 0, gap: 8 }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                      <span>⚠️ {chatError}</span>
                      {chatError.toLowerCase().includes('template') && (
                        <Btn size="xs" variant="sec" onClick={() => setShowTemplateModal(true)}>
                          Send Approved Template
                        </Btn>
                      )}
                    </div>
                    <button onClick={() => setChatError(null)} style={{ background: 'none', border: 'none', color: '#f87171', cursor: 'pointer', fontWeight: 'bold' }}>✕</button>
                  </div>
                )}

                {/* MESSAGES TRAIL */}
                <div style={{ flex: 1, minHeight: 0, padding: 16, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 12, background: 'var(--bg)' }}>
                  {messages.length === 0 ? (
                    <div style={{ margin: 'auto', textAlign: 'center', color: 'var(--t3)', fontSize: 13 }}>
                      No message history with this lead yet. Send an approved template to initiate contact.
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
                            padding: '9px 13px',
                            borderRadius: 12,
                            background: isOutbound ? 'var(--primary)' : 'var(--surf)',
                            color: isOutbound ? '#fff' : 'var(--t1)',
                            border: isOutbound ? 'none' : '1px solid var(--bd)',
                            fontSize: 13,
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
                <div style={{ padding: 12, borderTop: '1px solid var(--bd)', display: 'flex', gap: 10, flexShrink: 0, background: 'var(--surf)' }}>
                  <FInput
                    placeholder={selectedLead.contact?.optedOut ? "Messaging disabled: contact has opted out." : "Type WhatsApp message to lead..."}
                    value={messageText}
                    onChange={(e) => setMessageText(e.target.value)}
                    onKeyDown={(e) => e.key === 'Enter' && !e.shiftKey && handleSendMessage()}
                    disabled={selectedLead.contact?.optedOut}
                    style={{ flex: 1 }}
                  />
                  <Btn onClick={handleSendMessage} disabled={sendingMsg || !messageText.trim() || selectedLead.contact?.optedOut}>
                    <I n="send" s={15} /> Send
                  </Btn>
                </div>
              </>
            ) : (
              <div style={{ margin: 'auto', color: 'var(--t3)', fontSize: 14 }}>
                Select a lead from the list to view conversation.
              </div>
            )}
          </div>

          {/* RIGHT RESIZER */}
          <div
            onMouseDown={startResizeRight}
            title="Drag to resize CRM Context panel & conversation"
            style={{
              width: 10,
              cursor: 'col-resize',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              zIndex: 10,
              flexShrink: 0,
              userSelect: 'none',
              transition: 'background 0.15s ease',
              background: isResizingRight ? 'rgba(99, 102, 241, 0.25)' : 'transparent',
            }}
          >
            <div style={{ width: 2, height: 32, borderRadius: 1, background: isResizingRight ? 'var(--primary)' : 'var(--bd)' }} />
          </div>

          {/* RIGHT: CRM CONTEXT PANEL */}
          <div style={{
            width: rightWidth,
            flexShrink: 0,
            background: 'var(--surf)',
            border: '1px solid var(--bd)',
            borderRadius: 14,
            padding: 16,
            overflowY: 'auto',
            height: '100%',
          }}>
            {selectedLead ? (
              <div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 10, marginBottom: 16, paddingBottom: 12, borderBottom: '1px solid var(--bd)' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                      <I n="columns" s={16} c="var(--primary)" />
                      <h3 style={{ margin: 0, fontSize: 15, fontWeight: 700, color: 'var(--t1)', whiteSpace: 'nowrap' }}>CRM Context</h3>
                    </div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                      <button
                        onClick={handleRecalculateCategory}
                        title="Recalculate Lead Category & Score"
                        style={{
                          background: 'rgba(255,255,255,0.04)',
                          border: '1px solid var(--bd)',
                          borderRadius: 6,
                          padding: '4px 8px',
                          cursor: 'pointer',
                          color: 'var(--t2)',
                          display: 'flex',
                          alignItems: 'center',
                          gap: 4,
                          fontSize: 11,
                          fontWeight: 600,
                          transition: 'all 0.15s ease',
                        }}
                      >
                        <I n="refresh" s={12} />
                      </button>
                      <button
                        onClick={() => setRightWidth(prev => prev >= 480 ? 350 : 520)}
                        title={rightWidth >= 480 ? "Compact view" : "Expand context panel"}
                        style={{
                          background: 'rgba(255,255,255,0.04)',
                          border: '1px solid var(--bd)',
                          borderRadius: 6,
                          padding: '4px 8px',
                          cursor: 'pointer',
                          color: 'var(--t2)',
                          display: 'flex',
                          alignItems: 'center',
                          gap: 4,
                          fontSize: 11,
                          fontWeight: 600,
                          transition: 'all 0.15s ease',
                        }}
                      >
                        <I n="columns" s={12} /> {rightWidth >= 480 ? 'Compact' : 'Expand'}
                      </button>
                      <button
                        onClick={() => setConfirmDeleteLead(true)}
                        title="Delete Lead from CRM"
                        style={{
                          background: 'rgba(239, 68, 68, 0.08)',
                          border: '1px solid rgba(239, 68, 68, 0.3)',
                          borderRadius: 6,
                          padding: '4px 8px',
                          cursor: 'pointer',
                          color: '#f87171',
                          display: 'flex',
                          alignItems: 'center',
                          transition: 'all 0.15s ease',
                        }}
                      >
                        <I n="trash" s={12} c="#f87171" />
                      </button>
                    </div>
                  </div>

                  <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                    <button
                      onClick={() => { setEnrollTarget({ type: 'lead', leadId: selectedLead.id }); setShowEnrollModal(true); }}
                      title="Enroll Lead in Sequence Cadence"
                      style={{
                        flex: 1,
                        padding: '7px 12px',
                        borderRadius: 8,
                        border: '1px solid var(--bd)',
                        background: 'rgba(255, 255, 255, 0.06)',
                        color: 'var(--t1)',
                        fontSize: 12,
                        fontWeight: 600,
                        cursor: 'pointer',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        gap: 6,
                        transition: 'all 0.15s ease',
                      }}
                      onMouseEnter={e => e.currentTarget.style.background = 'rgba(255, 255, 255, 0.12)'}
                      onMouseLeave={e => e.currentTarget.style.background = 'rgba(255, 255, 255, 0.06)'}
                    >
                      <I n="wflow" s={13} c="var(--primary)" /> Enroll in Sequence Cadence
                    </button>
                  </div>
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
        <div style={{ display: 'flex', flexDirection: 'column', gap: 20, flex: 1, minHeight: 0, overflowY: 'auto', paddingRight: 4 }}>
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

              <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
                {selectedAudienceIds.size > 0 && (
                  <button
                    onClick={() => setConfirmBulkDeleteAudience(true)}
                    style={{
                      background: 'rgba(239, 68, 68, 0.12)',
                      border: '1px solid rgba(239, 68, 68, 0.3)',
                      color: '#f87171',
                      borderRadius: 8,
                      padding: '7px 12px',
                      fontSize: 12.5,
                      fontWeight: 700,
                      cursor: 'pointer',
                      display: 'flex',
                      alignItems: 'center',
                      gap: 6,
                    }}
                  >
                    <I n="trash" s={14} c="#f87171" /> Delete Selected ({selectedAudienceIds.size})
                  </button>
                )}
                <Btn
                  variant="sec"
                  disabled={(audienceData?.eligibleCount || 0) === 0}
                  onClick={() => {
                    const eligibleIds = (audienceData?.leads || []).filter(l => l.isEligible).map(l => l.id);
                    setEnrollTarget({ type: 'segment', leadIds: eligibleIds });
                    setShowEnrollModal(true);
                  }}
                >
                  <I n="layers" s={16} /> Enroll Segment in Sequence
                </Btn>
                <Btn
                  disabled={(audienceData?.eligibleCount || 0) === 0}
                  onClick={() => setShowConfirmModal(true)}
                >
                  <I n="send" s={16} /> Configure & Launch WhatsApp Campaign
                </Btn>
              </div>
            </div>

            {/* AUDIENCE TABLE */}
            <div style={{ overflowX: 'auto', maxHeight: '480px', overflowY: 'auto' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
                <thead>
                  <tr style={{ borderBottom: '1px solid var(--bd)', textAlign: 'left', color: 'var(--t2)', fontSize: 12 }}>
                    <th style={{ padding: 10, width: 34 }}>
                      <input
                        type="checkbox"
                        checked={(audienceData?.leads || []).length > 0 && selectedAudienceIds.size === (audienceData?.leads || []).length}
                        onChange={toggleSelectAllAudience}
                        style={{ cursor: 'pointer' }}
                        title="Select All Leads in Audience"
                      />
                    </th>
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
                      <td colSpan={8} style={{ padding: 20, textAlign: 'center', color: 'var(--t2)' }}>
                        Resolving audience...
                      </td>
                    </tr>
                  ) : (audienceData?.leads || []).length === 0 ? (
                    <tr>
                      <td colSpan={8} style={{ padding: 20, textAlign: 'center', color: 'var(--t3)' }}>
                        No leads match the selected segment and filters.
                      </td>
                    </tr>
                  ) : (
                    (audienceData?.leads || []).map((l) => (
                      <tr key={l.id} style={{ borderBottom: '1px solid var(--bd)', background: selectedAudienceIds.has(l.id) ? 'rgba(239, 68, 68, 0.04)' : 'transparent' }}>
                        <td style={{ padding: 10, width: 34 }}>
                          <input
                            type="checkbox"
                            checked={selectedAudienceIds.has(l.id)}
                            onChange={() => toggleSelectAudience(l.id)}
                            style={{ cursor: 'pointer' }}
                          />
                        </td>
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

      {/* TAB 3: CAMPAIGN PERFORMANCE ANALYTICS & TRACKING */}
      {activeTab === 'analytics' && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 20, flex: 1, minHeight: 0, overflowY: 'auto', paddingRight: 4 }}>
          {/* TOP STATS CARDS */}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(5, 1fr)', gap: 14, flexShrink: 0 }}>
            <div style={{ background: 'var(--surf)', border: '1px solid var(--bd)', borderRadius: 12, padding: '16px 18px', boxShadow: 'var(--card-shadow)' }}>
              <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--t2)', textTransform: 'uppercase', letterSpacing: 0.5 }}>
                Target Audience
              </div>
              <div style={{ fontSize: 26, fontWeight: 800, color: 'var(--primary)', marginTop: 4 }}>
                {campaignAnalytics?.summary?.totalAudience || 0}
              </div>
              <div style={{ fontSize: 11.5, color: 'var(--t3)', marginTop: 2 }}>Total Outbound Contacts</div>
            </div>

            <div style={{ background: 'var(--surf)', border: '1px solid var(--bd)', borderRadius: 12, padding: '16px 18px', boxShadow: 'var(--card-shadow)' }}>
              <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--t2)', textTransform: 'uppercase', letterSpacing: 0.5 }}>
                Delivered
              </div>
              <div style={{ fontSize: 26, fontWeight: 800, color: 'var(--green)', marginTop: 4 }}>
                {campaignAnalytics?.summary?.totalDelivered || 0}
              </div>
              <div style={{ fontSize: 11.5, color: 'var(--green)', marginTop: 2, fontWeight: 600 }}>
                {campaignAnalytics?.summary?.overallDeliveryRate || 0}% Delivery Rate
              </div>
            </div>

            <div style={{ background: 'var(--surf)', border: '1px solid var(--bd)', borderRadius: 12, padding: '16px 18px', boxShadow: 'var(--card-shadow)' }}>
              <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--t2)', textTransform: 'uppercase', letterSpacing: 0.5 }}>
                Read / Opened
              </div>
              <div style={{ fontSize: 26, fontWeight: 800, color: '#38bdf8', marginTop: 4 }}>
                {campaignAnalytics?.summary?.totalRead || 0}
              </div>
              <div style={{ fontSize: 11.5, color: '#38bdf8', marginTop: 2, fontWeight: 600 }}>
                {campaignAnalytics?.summary?.overallReadRate || 0}% Read Rate
              </div>
            </div>

            <div style={{ background: 'var(--surf)', border: '1px solid var(--bd)', borderRadius: 12, padding: '16px 18px', boxShadow: 'var(--card-shadow)' }}>
              <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--t2)', textTransform: 'uppercase', letterSpacing: 0.5 }}>
                Failed Messages
              </div>
              <div style={{ fontSize: 26, fontWeight: 800, color: '#f87171', marginTop: 4 }}>
                {campaignAnalytics?.summary?.totalFailed || 0}
              </div>
              <div style={{ fontSize: 11.5, color: '#f87171', marginTop: 2 }}>Invalid or unroutable</div>
            </div>

            <div style={{ background: 'var(--surf)', border: '1px solid var(--bd)', borderRadius: 12, padding: '16px 18px', boxShadow: 'var(--card-shadow)' }}>
              <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--t2)', textTransform: 'uppercase', letterSpacing: 0.5 }}>
                Opted Out / Skipped
              </div>
              <div style={{ fontSize: 26, fontWeight: 800, color: '#fbbf24', marginTop: 4 }}>
                {campaignAnalytics?.summary?.totalOptedOut || 0}
              </div>
              <div style={{ fontSize: 11.5, color: '#fbbf24', marginTop: 2 }}>DNC Protected</div>
            </div>
          </div>

          {/* CAMPAIGNS TABLE */}
          <div style={{ background: 'var(--surf)', border: '1px solid var(--bd)', borderRadius: 14, padding: 20 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
              <div>
                <h3 style={{ margin: 0, fontSize: 16, fontWeight: 700, color: 'var(--t1)' }}>
                  Outbound Broadcast Campaigns Performance
                </h3>
                <p style={{ margin: '3px 0 0 0', fontSize: 12, color: 'var(--t2)' }}>
                  Live delivery, read status, and opt-out tracking across outbound WhatsApp campaigns.
                </p>
              </div>
              <Btn variant="sec" onClick={fetchCampaignAnalytics} disabled={loadingAnalytics}>
                <I n="refresh" s={15} /> Refresh Data
              </Btn>
            </div>

            <div style={{ overflowX: 'auto', maxHeight: '520px', overflowY: 'auto' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
                <thead>
                  <tr style={{ borderBottom: '1px solid var(--bd)', textAlign: 'left', color: 'var(--t2)', fontSize: 12 }}>
                    <th style={{ padding: 10 }}>Campaign Name</th>
                    <th style={{ padding: 10 }}>Status</th>
                    <th style={{ padding: 10 }}>Audience</th>
                    <th style={{ padding: 10 }}>Sent</th>
                    <th style={{ padding: 10 }}>Delivered</th>
                    <th style={{ padding: 10 }}>Read</th>
                    <th style={{ padding: 10 }}>Failed</th>
                    <th style={{ padding: 10 }}>Opted Out</th>
                    <th style={{ padding: 10 }}>Launched</th>
                  </tr>
                </thead>
                <tbody>
                  {loadingAnalytics ? (
                    <tr>
                      <td colSpan={9} style={{ padding: 30, textAlign: 'center', color: 'var(--t2)' }}>
                        Loading broadcast analytics...
                      </td>
                    </tr>
                  ) : !campaignAnalytics?.campaigns || campaignAnalytics.campaigns.length === 0 ? (
                    <tr>
                      <td colSpan={9} style={{ padding: 30, textAlign: 'center', color: 'var(--t3)' }}>
                        No broadcast campaigns found for this workspace. Launch a campaign from the Segment Broadcast mode to track results!
                      </td>
                    </tr>
                  ) : (
                    campaignAnalytics.campaigns.map((c) => (
                      <tr key={c.id} style={{ borderBottom: '1px solid var(--bd)' }}>
                        <td style={{ padding: 10, fontWeight: 600, color: 'var(--t1)' }}>{c.name}</td>
                        <td style={{ padding: 10 }}>
                          <StatusBadge
                            label={c.status}
                            tone={c.status === 'COMPLETED' ? 'green' : c.status === 'RUNNING' ? 'blue' : 'gray'}
                          />
                        </td>
                        <td style={{ padding: 10, fontWeight: 700, color: 'var(--t1)' }}>{c.audience}</td>
                        <td style={{ padding: 10, color: 'var(--t2)' }}>{c.sent}</td>
                        <td style={{ padding: 10 }}>
                          <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                            <span style={{ fontWeight: 600, color: 'var(--green)' }}>{c.delivered}</span>
                            <span style={{ fontSize: 11, color: 'var(--green)', background: 'rgba(34, 197, 94, 0.1)', padding: '1px 6px', borderRadius: 4 }}>
                              {c.deliveryRate}%
                            </span>
                          </div>
                        </td>
                        <td style={{ padding: 10 }}>
                          <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                            <span style={{ fontWeight: 600, color: '#38bdf8' }}>{c.read}</span>
                            <span style={{ fontSize: 11, color: '#38bdf8', background: 'rgba(56, 189, 248, 0.1)', padding: '1px 6px', borderRadius: 4 }}>
                              {c.readRate}%
                            </span>
                          </div>
                        </td>
                        <td style={{ padding: 10 }}>
                          <span style={{ color: c.failed > 0 ? '#f87171' : 'var(--t3)', fontWeight: c.failed > 0 ? 700 : 400 }}>
                            {c.failed}
                          </span>
                        </td>
                        <td style={{ padding: 10 }}>
                          <span style={{ color: c.optedOut > 0 ? '#fbbf24' : 'var(--t3)', fontWeight: c.optedOut > 0 ? 700 : 400 }}>
                            {c.optedOut}
                          </span>
                        </td>
                        <td style={{ padding: 10, color: 'var(--t2)', fontSize: 12 }}>
                          {c.launchedAt ? new Date(c.launchedAt).toLocaleString() : c.createdAt ? new Date(c.createdAt).toLocaleDateString() : '-'}
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
      {showTemplateModal && (() => {
        const selObj = templates.find((t) => t.id === selectedTemplateId);
        const reqCount = (selObj?.components || []).reduce((max, c) => {
          const nums = [...String(c?.text || '').matchAll(/\{\{(\d+)\}\}/g)].map((m) => parseInt(m[1], 10));
          return nums.length ? Math.max(max, Math.max(...nums)) : max;
        }, 0);

        return (
          <Modal title="Send Approved WhatsApp Template" onClose={() => setShowTemplateModal(false)}>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
              <div>
                <FLabel>Select Approved Template</FLabel>
                <FSelect
                  value={selectedTemplateId}
                  onChange={(e) => {
                    setSelectedTemplateId(e.target.value);
                    const tObj = templates.find((t) => t.id === e.target.value);
                    const count = (tObj?.components || []).reduce((max, c) => {
                      const nums = [...String(c?.text || '').matchAll(/\{\{(\d+)\}\}/g)].map((m) => parseInt(m[1], 10));
                      return nums.length ? Math.max(max, Math.max(...nums)) : max;
                    }, 0);
                    if (count > 0) {
                      setTemplateVars({ 0: selectedLead?.contact?.name || 'Customer' });
                    } else {
                      setTemplateVars({});
                    }
                  }}
                >
                  <option value="" style={{ background: '#1e293b', color: '#cbd5e1' }}>Select a template...</option>
                  {templates.map((t) => (
                    <option key={t.id} value={t.id} style={{ background: '#1e293b', color: '#f8fafc' }}>
                      {t.name} ({t.category || t.language || 'APPROVED'})
                    </option>
                  ))}
                </FSelect>
              </div>

              {reqCount > 0 && (
                <div style={{ background: 'var(--bg)', padding: 12, borderRadius: 10, border: '1px solid var(--bd)', display: 'flex', flexDirection: 'column', gap: 10 }}>
                  <div style={{ fontSize: 12, fontWeight: 700, color: 'var(--t1)' }}>
                    Template Variables ({reqCount} required)
                  </div>
                  {Array.from({ length: reqCount }).map((_, idx) => (
                    <div key={idx}>
                      <FLabel>Variable &#123;&#123;{idx + 1}&#125;&#125; {idx === 0 ? '(Customer Name)' : ''}</FLabel>
                      <FInput
                        value={templateVars[idx] ?? (idx === 0 ? selectedLead?.contact?.name || 'Customer' : '')}
                        onChange={(e) => setTemplateVars((prev) => ({ ...prev, [idx]: e.target.value }))}
                        placeholder={`Value for {{${idx + 1}}}`}
                      />
                    </div>
                  ))}
                </div>
              )}

              <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 10 }}>
                <Btn variant="sec" onClick={() => setShowTemplateModal(false)}>Cancel</Btn>
                <Btn onClick={handleSendTemplate} disabled={!selectedTemplateId || sendingMsg}>
                  Send Template Message
                </Btn>
              </div>
            </div>
          </Modal>
        );
      })()}

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
                <option value="" style={{ background: '#1e293b', color: '#cbd5e1' }}>Select template...</option>
                {templates.map((t) => (
                  <option key={t.id} value={t.id} style={{ background: '#1e293b', color: '#f8fafc' }}>
                    {t.name} ({t.language})
                  </option>
                ))}
              </FSelect>
            </div>

            <div>
              <FLabel>Sender WhatsApp Number</FLabel>
              {waNumbers.length === 1 ? (
                <div style={{ padding: '9px 13px', background: 'var(--bg)', border: '1px solid var(--bd)', borderRadius: 8, fontSize: 13, color: 'var(--t1)', fontWeight: 600, display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                  <span>{waNumbers[0].displayName ? `${waNumbers[0].displayName} (${waNumbers[0].phoneNumber})` : waNumbers[0].phoneNumber}</span>
                  <span style={{ fontSize: 11, color: 'var(--green)', fontWeight: 700, background: 'rgba(34, 197, 94, 0.12)', padding: '2px 8px', borderRadius: 10 }}>Auto-Selected Active Sender</span>
                </div>
              ) : (
                <FSelect value={campaignWaNumberId} onChange={(e) => setCampaignWaNumberId(e.target.value)}>
                  <option value="" style={{ background: '#1e293b', color: '#cbd5e1' }}>Select sender number...</option>
                  {waNumbers.map((n) => (
                    <option key={n.id} value={n.id} style={{ background: '#1e293b', color: '#f8fafc' }}>
                      {n.displayName || n.phoneNumber}
                    </option>
                  ))}
                </FSelect>
              )}
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

      {/* MODAL: ENROLL IN SEQUENCE */}
      {showEnrollModal && (
        <Modal title="Enroll Leads in Automated Sequence Cadence" onClose={() => setShowEnrollModal(false)}>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
            <div>
              <FLabel>Select Sequence Cadence</FLabel>
              <FSelect value={selectedSequenceId} onChange={(e) => setSelectedSequenceId(e.target.value)}>
                <option value="" style={{ background: '#1e293b', color: '#cbd5e1' }}>Select sequence cadence...</option>
                {sequencesList.map((s) => (
                  <option key={s.id} value={s.id} style={{ background: '#1e293b', color: '#f8fafc' }}>
                    {s.name} ({s.status} · {Array.isArray(s.steps) ? s.steps.length : 0} steps)
                  </option>
                ))}
              </FSelect>
            </div>

            <div style={{ background: 'var(--bg)', padding: 14, borderRadius: 10, border: '1px solid var(--bd)', fontSize: 13, color: 'var(--t2)', display: 'flex', flexDirection: 'column', gap: 4 }}>
              <div>• Recipients to Enroll: <strong>{enrollTarget?.type === 'lead' ? '1 Selected Lead' : `${enrollTarget?.leadIds?.length || 0} Segment Leads`}</strong></div>
              <div>• Sequence Automation: Executes multi-step cadence (WhatsApp messages, delay waits, CRM task creation).</div>
              <div>• Auto-Exit Handoff: Stops automatically when lead replies, shifting them live to CRM Sales Inbox.</div>
            </div>

            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 10, marginTop: 10 }}>
              <Btn variant="sec" onClick={() => setShowEnrollModal(false)}>Cancel</Btn>
              <Btn onClick={handleEnrollInSequence} disabled={enrolling || !selectedSequenceId}>
                {enrolling ? 'Enrolling Leads...' : 'Confirm & Enroll'}
              </Btn>
            </div>
          </div>
        </Modal>
      )}

      {/* MODAL: CONFIRM SINGLE LEAD DELETION */}
      {confirmDeleteLead && selectedLead && (
        <Modal title="Delete CRM Lead" onClose={() => setConfirmDeleteLead(false)} width={460}>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
            <div style={{ display: 'flex', gap: 12, alignItems: 'flex-start' }}>
              <div style={{ width: 36, height: 36, borderRadius: '50%', background: 'rgba(239, 68, 68, 0.12)', border: '1px solid rgba(239, 68, 68, 0.3)', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                <I n="alertt" s={18} c="#f87171" />
              </div>
              <div>
                <div style={{ fontSize: 14, fontWeight: 700, color: 'var(--t1)', marginBottom: 4 }}>
                  Delete "{selectedLead.contact?.name || selectedLead.contact?.phoneNumber || 'this lead'}"?
                </div>
                <div style={{ fontSize: 12.5, color: 'var(--t2)', lineHeight: 1.5 }}>
                  This will permanently delete this lead from your CRM pipeline, inbox, and category segmentation metrics. This action cannot be undone.
                </div>
              </div>
            </div>
            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 10, marginTop: 8 }}>
              <Btn variant="ghost" size="sm" onClick={() => setConfirmDeleteLead(false)} disabled={deletingLead}>Cancel</Btn>
              <button
                onClick={handleDeleteSingleLead}
                disabled={deletingLead}
                style={{
                  padding: '7px 16px',
                  borderRadius: 8,
                  border: 'none',
                  background: '#ef4444',
                  color: '#fff',
                  fontSize: 12.5,
                  fontWeight: 700,
                  cursor: deletingLead ? 'not-allowed' : 'pointer',
                  opacity: deletingLead ? 0.7 : 1,
                  transition: 'opacity 0.15s ease',
                }}
              >
                {deletingLead ? 'Deleting…' : 'Delete Lead'}
              </button>
            </div>
          </div>
        </Modal>
      )}

      {/* MODAL: CONFIRM BULK AUDIENCE DELETION */}
      {confirmBulkDeleteAudience && (
        <Modal title={`Delete ${selectedAudienceIds.size} Leads`} onClose={() => setConfirmBulkDeleteAudience(false)} width={460}>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
            <div style={{ display: 'flex', gap: 12, alignItems: 'flex-start' }}>
              <div style={{ width: 36, height: 36, borderRadius: '50%', background: 'rgba(239, 68, 68, 0.12)', border: '1px solid rgba(239, 68, 68, 0.3)', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                <I n="alertt" s={18} c="#f87171" />
              </div>
              <div>
                <div style={{ fontSize: 14, fontWeight: 700, color: 'var(--t1)', marginBottom: 4 }}>
                  Delete {selectedAudienceIds.size} selected leads?
                </div>
                <div style={{ fontSize: 12.5, color: 'var(--t2)', lineHeight: 1.5 }}>
                  This will permanently delete {selectedAudienceIds.size} leads from your CRM pipeline, audience review, and segmentation metrics across the system. This action cannot be undone.
                </div>
              </div>
            </div>
            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 10, marginTop: 8 }}>
              <Btn variant="ghost" size="sm" onClick={() => setConfirmBulkDeleteAudience(false)} disabled={bulkDeletingAudience}>Cancel</Btn>
              <button
                onClick={handleBulkDeleteAudience}
                disabled={bulkDeletingAudience}
                style={{
                  padding: '7px 16px',
                  borderRadius: 8,
                  border: 'none',
                  background: '#ef4444',
                  color: '#fff',
                  fontSize: 12.5,
                  fontWeight: 700,
                  cursor: bulkDeletingAudience ? 'not-allowed' : 'pointer',
                  opacity: bulkDeletingAudience ? 0.7 : 1,
                  transition: 'opacity 0.15s ease',
                }}
              >
                {bulkDeletingAudience ? 'Deleting…' : `Delete ${selectedAudienceIds.size} Leads`}
              </button>
            </div>
          </div>
        </Modal>
      )}
    </div>
  );
}
