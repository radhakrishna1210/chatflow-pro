import { useState, useEffect, useCallback } from 'react';
import { I } from '../components/Icons.jsx';
import { Btn } from '../components/Btn.jsx';
import { Modal } from '../components/Modal.jsx';
import { FInput, FLabel, FSelect, FTextarea } from '../components/Form.jsx';
import { wFetch } from '../lib/api.js';
import { notify, confirmDialog } from '../components/Feedback.jsx';
import { can } from '../lib/permissions.js';
import { AI_AGENTS_API, AI_AGENTS_PATH } from '../lib/aiAgentsApi.js';
import WhatsAppAgentPanel from '../components/aiAgents/WhatsAppAgentPanel.jsx';
import AutonomousAgentPanel from '../components/aiAgents/AutonomousAgentPanel.jsx';
import MobileNavButton from '../components/MobileNavButton.jsx';
import { useIsMobile } from '../lib/useMediaQuery.js';

// ─── AI Agents ───────────────────────────────────────────────────────────────
//
// The one AI Agents area. There used to be three separate screens on three
// API families: this studio (/ai-agents), the WhatsApp AI agent as a tab of
// Automation reachable only by deep link (/ai-agent), and the autonomous CRM
// agent with no screen at all beyond each record's Agent tab (/agent). They
// are now three sections of this page on one API family (lib/aiAgentsApi.js),
// selected by ?tab= so each stays linkable:
//
//   ?tab=whatsapp      the live WhatsApp agent — config, knowledge, deploy, test
//   ?tab=agents|chat-bots|knowledge|guidelines|actions
//                      the agent studio and its sub-tabs
//   ?tab=autonomous    the autonomous CRM agent — switch, plan, queue
//
// Old links (/dashboard/automation?tab=wa-agent, /dashboard/ai-chatbots) are
// redirected here by Dashboard.jsx.

const STUDIO_TABS = ['agents', 'chat-bots', 'knowledge', 'guidelines', 'actions'];

// Older ?tab= values were free-form ("bots", "knowledge-base"…), so they are
// matched loosely, as the studio always did.
function studioTabFor(tab) {
  const t = String(tab || '').toLowerCase();
  if (t.includes('bot')) return 'chat-bots';
  if (t.includes('know')) return 'knowledge';
  if (t.includes('guide')) return 'guidelines';
  if (t.includes('action')) return 'actions';
  return 'agents';
}

function sectionFor(tab) {
  const t = String(tab || '').toLowerCase();
  if (!t || t === 'whatsapp' || t === 'wa-agent') return 'whatsapp';
  if (t.startsWith('autonom')) return 'autonomous';
  return 'studio';
}

const SECTIONS = [
  { id: 'whatsapp',   label: 'WhatsApp agent',       icon: 'bot',   hint: 'The live agent answering customers' },
  { id: 'studio',     label: 'Agent studio',         icon: 'spark', hint: 'Draft, test and apply personas' },
  { id: 'autonomous', label: 'Autonomous CRM agent', icon: 'brain', hint: 'Background CRM work and its queue' },
];

export default function AiAgentsView({ initialTab }) {
  const [tab, setTab] = useState(() => initialTab || 'whatsapp');
  // The route can change while this instance stays mounted (a Quick Link to
  // another section of this page), so the prop is followed, not just read once.
  useEffect(() => { if (initialTab) setTab(initialTab); }, [initialTab]);

  const section = sectionFor(tab);
  const isMobile = useIsMobile();

  // Keeps the address bar on the section shown. The popstate tells the router
  // to re-read the URL (as AutomationView does); it re-renders this instance
  // rather than remounting it.
  const select = (next) => {
    setTab(next);
    const target = `${AI_AGENTS_PATH}?tab=${encodeURIComponent(next)}`;
    if (window.location.pathname + window.location.search === target) return;
    window.history.replaceState({}, '', target);
    window.dispatchEvent(new PopStateEvent('popstate'));
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', flex: 1, minHeight: 0, overflowY: 'auto' }}>
      <div style={{ padding: '14px 24px 0', borderBottom: '1px solid var(--bd)', background: 'var(--surf)', flexShrink: 0 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 10 }}>
          {isMobile && <MobileNavButton />}
          <div>
            <h1 style={{ fontFamily: "'Syne',sans-serif", fontSize: 18, fontWeight: 700, margin: 0, color: 'var(--t1)' }}>AI Agents</h1>
            <p style={{ margin: '3px 0 0', color: 'var(--t2)', fontSize: 12.5 }}>
              Every AI agent in this workspace, in one place.
            </p>
          </div>
        </div>
        <div role="tablist" aria-label="AI Agents sections" style={{ display: 'flex', gap: 4, overflowX: 'auto' }}>
          {SECTIONS.map((sec) => {
            const on = sec.id === section;
            return (
              <button key={sec.id} role="tab" aria-selected={on} title={sec.hint}
                onClick={() => select(sec.id === 'studio' ? 'agents' : sec.id)}
                style={{
                  display: 'flex', alignItems: 'center', gap: 8, padding: '10px 14px', cursor: 'pointer', whiteSpace: 'nowrap',
                  background: on ? 'rgba(53,232,242,0.1)' : 'transparent', border: 'none', borderRadius: '8px 8px 0 0',
                  borderBottom: on ? '2px solid var(--green)' : '2px solid transparent',
                  color: on ? 'var(--green)' : 'var(--t2)', fontFamily: "'Manrope',sans-serif", fontSize: 13, fontWeight: on ? 700 : 500,
                }}>
                <I n={sec.icon} s={15} c={on ? 'var(--green)' : 'currentColor'} />
                {sec.label}
              </button>
            );
          })}
        </div>
      </div>

      {section === 'whatsapp' && (
        <div className="dash-page" style={{ padding: 24 }}>
          <div style={{ maxWidth: 1240, margin: '0 auto' }}><WhatsAppAgentPanel /></div>
        </div>
      )}
      {section === 'studio' && (
        <AgentStudio
          initialTab={studioTabFor(tab)}
          onTabChange={select}
          onOpenWhatsApp={() => select('whatsapp')}
        />
      )}
      {section === 'autonomous' && (
        <div className="dash-page" style={{ padding: 24 }}>
          <div style={{ maxWidth: 1000, margin: '0 auto' }}><AutonomousAgentPanel /></div>
        </div>
      )}
    </div>
  );
}

// ─── Agent studio ────────────────────────────────────────────────────────────
// Personas you draft and test, then apply to the WhatsApp channel.
function AgentStudio({ initialTab, onTabChange, onOpenWhatsApp }) {
  const canEdit = can('aiAgents.manage');
  const canTest = can('aiAgents.studioTest');
  const canEditKnowledge = can('widgets.manage');
  const [activeTab, setActiveTabState] = useState(() => (STUDIO_TABS.includes(initialTab) ? initialTab : 'agents'));
  useEffect(() => { if (STUDIO_TABS.includes(initialTab)) setActiveTabState(initialTab); }, [initialTab]);
  const setActiveTab = (id) => { setActiveTabState(id); onTabChange?.(id); };

  const [agents, setAgents] = useState([]);
  const [guidelines, setGuidelines] = useState([]);
  const [actions, setActions] = useState([]);
  const [knowledgeSources, setKnowledgeSources] = useState([]);
  const [channels, setChannels] = useState([]);
  const [channelsError, setChannelsError] = useState('');
  const [loading, setLoading] = useState(true);

  // Modals
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [editingAgent, setEditingAgent] = useState(null);
  const [testingAgent, setTestingAgent] = useState(null);
  const [configuringChannel, setConfiguringChannel] = useState(null);

  // Channel Configuration Form State
  const [channelForm, setChannelForm] = useState({ assignedAgentId: '', enabled: false });
  const [savingChannel, setSavingChannel] = useState(false);
  const [channelMsg, setChannelMsg] = useState('');

  // Form State
  const [formName, setFormName] = useState('');
  const [formDescription, setFormDescription] = useState('');
  const [formPurpose, setFormPurpose] = useState('');
  const [formPrompt, setFormPrompt] = useState('');
  const [saving, setSaving] = useState(false);

  // Test Simulator State
  const [testInput, setTestInput] = useState('');
  const [testChat, setTestChat] = useState([]);
  const [testLoading, setTestLoading] = useState(false);

  // Knowledge Form State
  const [newFaqQ, setNewFaqQ] = useState('');
  const [newFaqA, setNewFaqA] = useState('');
  const [savingKnowledge, setSavingKnowledge] = useState(false);

  // Fetch agents
  const loadAgents = useCallback(async () => {
    try {
      const res = await wFetch(AI_AGENTS_API.studio);
      if (res.ok) {
        const d = await res.json();
        setAgents(d.data || []);
      }
    } catch (e) {
      console.error('Failed to load agents', e);
    }
  }, []);

  // Fetch guidelines
  const loadGuidelines = useCallback(async () => {
    try {
      const res = await wFetch(`${AI_AGENTS_API.studio}/guidelines`);
      if (res.ok) {
        const d = await res.json();
        setGuidelines(d.data || []);
      }
    } catch (e) {
      console.error('Failed to load guidelines', e);
    }
  }, []);

  // Fetch actions
  const loadActions = useCallback(async () => {
    try {
      const res = await wFetch(`${AI_AGENTS_API.studio}/actions`);
      if (res.ok) {
        const d = await res.json();
        setActions(d.data || []);
      }
    } catch (e) {
      console.error('Failed to load actions', e);
    }
  }, []);

  // Fetch knowledge sources
  const loadKnowledge = useCallback(async () => {
    try {
      const res = await wFetch('/widgets/knowledge');
      if (res.ok) {
        const d = await res.json();
        setKnowledgeSources(Array.isArray(d) ? d : d.data || []);
      }
    } catch (e) {
      console.error('Failed to load knowledge', e);
    }
  }, []);

  // Fetch channels. A failure is shown as such — never replaced with sample
  // channels, which used to report agents as "Connected & Active".
  const loadChannels = useCallback(async () => {
    try {
      const res = await wFetch(`${AI_AGENTS_API.studio}/channels`);
      const d = await res.json().catch(() => ({}));
      if (res.ok) {
        setChannels(d.data || []);
        setChannelsError('');
      } else {
        setChannelsError(d.error || 'Could not load channels.');
      }
    } catch (e) {
      setChannelsError('Could not load channels.');
    }
  }, []);

  useEffect(() => {
    setLoading(true);
    Promise.all([loadAgents(), loadGuidelines(), loadActions(), loadKnowledge(), loadChannels()]).finally(() => {
      setLoading(false);
    });
  }, [loadAgents, loadGuidelines, loadActions, loadKnowledge, loadChannels]);

  const handleOpenConfigure = (ch) => {
    setConfiguringChannel(ch);
    setChannelForm({
      assignedAgentId: ch.assignedAgentId || '',
      enabled: ch.enabled === true,
    });
    setChannelMsg('');
  };

  // The WhatsApp AI agent's full settings (knowledge, guardrails, deploy) are
  // the WhatsApp agent section of this page; the studio switches to it rather
  // than keeping a second copy of them.
  const openWhatsAppAgentSettings = () => onOpenWhatsApp?.();

  const handleSaveChannel = async () => {
    if (!configuringChannel) return;
    setSavingChannel(true);
    setChannelMsg('');
    // Only what changed is sent: applying an agent overwrites the live bot's
    // persona, so re-saving the dialog must not do it again by accident.
    const body = {};
    if (channelForm.assignedAgentId && channelForm.assignedAgentId !== configuringChannel.assignedAgentId) {
      body.assignedAgentId = channelForm.assignedAgentId;
    }
    if (channelForm.enabled !== configuringChannel.enabled) body.enabled = channelForm.enabled;
    if (Object.keys(body).length === 0) {
      setSavingChannel(false);
      setConfiguringChannel(null);
      return;
    }
    try {
      const res = await wFetch(`${AI_AGENTS_API.studio}/channels/${configuringChannel.channelKey}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      if (res.ok) {
        setChannelMsg('WhatsApp channel updated.');
        await loadChannels();
        setTimeout(() => {
          setConfiguringChannel(null);
          setChannelMsg('');
        }, 1000);
      } else {
        const err = await res.json().catch(() => ({}));
        notify(err.error || 'Failed to save channel configuration');
      }
    } catch (e) {
      notify('Network error saving channel configuration');
    } finally {
      setSavingChannel(false);
    }
  };

  const handleTestChannel = (ch) => {
    const targetAgent = agents.find((a) => a.id === ch.assignedAgentId);
    if (targetAgent) {
      openReviewModal(targetAgent);
    } else {
      notify('No agent from this page has been applied to this channel yet.');
    }
  };

  const openCreateModal = () => {
    setEditingAgent(null);
    setFormName('');
    setFormDescription('');
    setFormPurpose('');
    setFormPrompt('');
    setShowCreateModal(true);
  };

  const openEditModal = (agent) => {
    setEditingAgent(agent);
    setFormName(agent.name || '');
    setFormDescription(agent.description || '');
    setFormPurpose(agent.purpose || '');
    setFormPrompt(agent.systemPrompt || '');
    setShowCreateModal(true);
  };

  const handleSaveAgent = async () => {
    if (!formName.trim()) {
      notify('Please provide an agent name');
      return;
    }
    setSaving(true);
    try {
      const payload = {
        name: formName.trim(),
        description: formDescription.trim(),
        purpose: formPurpose.trim(),
        systemPrompt: formPrompt.trim(),
      };

      const url = editingAgent ? `${AI_AGENTS_API.studio}/${editingAgent.id}` : AI_AGENTS_API.studio;
      const method = editingAgent ? 'PUT' : 'POST';

      const res = await wFetch(url, {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });

      if (!res.ok) {
        const d = await res.json().catch(() => ({}));
        throw new Error(d.error || 'Failed to save agent');
      }

      setShowCreateModal(false);
      loadAgents();
    } catch (err) {
      notify(`Error: ${err.message}`);
    } finally {
      setSaving(false);
    }
  };

  const handleDeleteAgent = async (agent) => {
    if (!await confirmDialog(`Are you sure you want to delete "${agent.name}"?`, { danger: true })) return;
    try {
      const res = await wFetch(`${AI_AGENTS_API.studio}/${agent.id}`, { method: 'DELETE' });
      if (res.ok) {
        loadAgents();
      } else {
        const d = await res.json().catch(() => ({}));
        notify(d.error || 'Failed to delete agent');
      }
    } catch (e) {
      notify('Failed to delete agent');
    }
  };

  // Open the test lab. It starts empty: every agent bubble shown is a real
  // model reply, and failures are shown as failures.
  const openReviewModal = (agent) => {
    setTestingAgent(agent);
    setTestChat([]);
    setTestInput('');
  };

  const handleSendTestMessage = async () => {
    if (!testInput.trim() || !testingAgent || testLoading) return;
    const userMsg = testInput.trim();
    setTestInput('');

    setTestChat((prev) => [...prev, { role: 'user', text: userMsg }]);
    setTestLoading(true);

    try {
      const res = await wFetch(`${AI_AGENTS_API.studio}/${testingAgent.id}/test`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message: userMsg }),
      });
      const data = await res.json().catch(() => ({}));

      if (res.ok && data.data?.ok && data.data.reply) {
        setTestChat((prev) => [...prev, { role: 'agent', text: data.data.reply }]);
      } else {
        const reason = data.data?.reason || data.error || `Request failed (${res.status})`;
        setTestChat((prev) => [...prev, { role: 'error', text: `No reply: ${reason}` }]);
      }
    } catch (e) {
      setTestChat((prev) => [...prev, { role: 'error', text: 'No reply: network error — the request did not reach the server.' }]);
    } finally {
      setTestLoading(false);
    }
  };

  const handleAddFaq = async () => {
    if (!newFaqQ.trim() || !newFaqA.trim()) return;
    setSavingKnowledge(true);
    try {
      await wFetch('/widgets/knowledge', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          title: newFaqQ.trim(),
          type: 'FAQ',
          content: newFaqA.trim(),
        }),
      });
      setNewFaqQ('');
      setNewFaqA('');
      loadKnowledge();
    } catch (e) {
      notify('Could not add FAQ');
    } finally {
      setSavingKnowledge(false);
    }
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', flex: 1, minHeight: 0, overflowY: 'auto' }}>
      {/* ── TOP HEADER ── */}
      <div
        style={{
          minHeight: 58,
          borderBottom: '1px solid var(--bd)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          padding: '10px 24px',
          flexShrink: 0,
          background: 'var(--surf)',
          flexWrap: 'wrap',
          gap: 12,
        }}
      >
        <div>
          <h1 style={{ fontFamily: "'Syne',sans-serif", fontSize: 17, fontWeight: 700, margin: 0, color: 'var(--t1)', display: 'flex', alignItems: 'center', gap: 10 }}>
            <span>Agent studio</span>
            <span
              style={{
                fontSize: 11,
                fontWeight: 700,
                padding: '2px 8px',
                borderRadius: 12,
                background: 'rgba(53, 232, 242, 0.12)',
                color: 'var(--accent, #35e8f2)',
                border: '1px solid rgba(53, 232, 242, 0.25)',
              }}
            >
              Multi-Agent Hub
            </span>
          </h1>
          <p style={{ margin: '4px 0 0', color: 'var(--t2)', fontSize: 13 }}>
            Draft and test agent personas here, then apply one to the WhatsApp channel. The live agent's knowledge, guardrails and deploy switch are under WhatsApp AI Agent settings.
          </p>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <button
            onClick={openWhatsAppAgentSettings}
            title="Persona, knowledge, guardrails and deploy for the live WhatsApp AI agent"
            style={{
              padding: '7px 14px',
              borderRadius: 8,
              border: '1px solid var(--bd)',
              background: 'rgba(255,255,255,0.03)',
              color: 'var(--t1)',
              fontSize: 12.5,
              fontWeight: 600,
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center',
              gap: 6,
            }}
          >
            <I n="spark" s={14} c="var(--accent, #35e8f2)" /> WhatsApp AI Agent settings
          </button>

          {canEdit && (
            <Btn size="sm" onClick={openCreateModal}>
              <I n="plus" s={14} c="#060A10" /> New Chat Agent
            </Btn>
          )}
        </div>
      </div>

      {/* ── 5 SUB-TABS RIBBON (Matching Screenshot) ── */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          padding: '10px 24px',
          borderBottom: '1px solid var(--bd)',
          background: 'rgba(255,255,255,0.01)',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, overflowX: 'auto' }}>
          {[
            { id: 'chat-bots', label: 'Chat Bots' },
            { id: 'agents', label: 'Agents', badge: agents.length },
            { id: 'knowledge', label: 'Knowledge', badge: knowledgeSources.length },
            { id: 'guidelines', label: 'Guidelines', badge: guidelines.length },
            { id: 'actions', label: 'Actions', badge: actions.length },
          ].map((tab) => {
            const isSel = activeTab === tab.id;
            return (
              <button
                key={tab.id}
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
                {tab.badge !== undefined && (
                  <span
                    style={{
                      fontSize: 10.5,
                      fontWeight: 700,
                      padding: '1px 6px',
                      borderRadius: 10,
                      background: isSel ? 'rgba(0,0,0,0.2)' : 'rgba(255,255,255,0.08)',
                      color: isSel ? '#060A10' : 'var(--t3)',
                    }}
                  >
                    {tab.badge}
                  </span>
                )}
              </button>
            );
          })}
        </div>
      </div>

      {/* ── TAB 1: AGENTS (Active Grid from Screenshot) ── */}
      {activeTab === 'agents' && (
        <div style={{ padding: '24px', flex: 1 }}>
          {loading ? (
            <div style={{ padding: 60, textAlign: 'center', color: 'var(--t2)' }}>
              <div style={{ width: 24, height: 24, border: '2px solid var(--accent)', borderTopColor: 'transparent', borderRadius: '50%', margin: '0 auto 10px', animation: 'spin 1s linear infinite' }} />
              Loading AI Agents...
            </div>
          ) : agents.length === 0 ? (
            <div style={{ padding: 60, textAlign: 'center', color: 'var(--t3)' }}>
              <p>No agents configured yet.</p>
              {canEdit && <Btn size="sm" onClick={openCreateModal}>+ Create Your First Agent</Btn>}
            </div>
          ) : (
            <div
              style={{
                display: 'grid',
                gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))',
                gap: 20,
              }}
            >
              {agents.map((agent) => (
                <div
                  key={agent.id}
                  style={{
                    background: 'var(--surf)',
                    border: '1px solid var(--bd)',
                    borderRadius: 14,
                    padding: '20px 20px 16px',
                    display: 'flex',
                    flexDirection: 'column',
                    justifyContent: 'space-between',
                    boxShadow: 'var(--card-shadow)',
                    transition: 'border-color 0.15s ease, transform 0.15s ease',
                  }}
                  onMouseEnter={(e) => {
                    e.currentTarget.style.borderColor = 'rgba(53, 232, 242, 0.4)';
                    e.currentTarget.style.transform = 'translateY(-2px)';
                  }}
                  onMouseLeave={(e) => {
                    e.currentTarget.style.borderColor = 'var(--bd)';
                    e.currentTarget.style.transform = 'translateY(0)';
                  }}
                >
                  <div>
                    {/* Role Pill */}
                    <div style={{ marginBottom: 12 }}>
                      <span
                        style={{
                          fontSize: 10,
                          fontWeight: 800,
                          letterSpacing: '.05em',
                          textTransform: 'uppercase',
                          padding: '3px 8px',
                          borderRadius: 6,
                          background: 'rgba(245, 158, 11, 0.12)',
                          border: '1px solid rgba(245, 158, 11, 0.3)',
                          color: '#fbbf24',
                        }}
                      >
                        {agent.role || 'AGENT'}
                      </span>
                    </div>

                    {/* Agent Name */}
                    <h3 style={{ fontSize: 16, fontWeight: 700, margin: '0 0 8px', color: 'var(--t1)' }}>
                      {agent.name}
                    </h3>

                    {/* Description */}
                    <p style={{ fontSize: 13, color: 'var(--t2)', lineHeight: 1.5, margin: '0 0 16px', minHeight: 56 }}>
                      {agent.description || agent.purpose || 'Autonomous AI conversationalist for your CRM.'}
                    </p>

                    {/* Action tags */}
                    {agent.actions && agent.actions.length > 0 && (
                      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginBottom: 16 }}>
                        {agent.actions.map((act) => (
                          <span
                            key={act}
                            style={{
                              fontSize: 10,
                              fontWeight: 600,
                              padding: '2px 6px',
                              borderRadius: 4,
                              background: 'rgba(255,255,255,0.04)',
                              color: 'var(--t3)',
                              border: '1px solid rgba(255,255,255,0.06)',
                            }}
                          >
                            ⚡ {act.replace('crm.', '')}
                          </span>
                        ))}
                      </div>
                    )}
                  </div>

                  {/* Bottom Action Links (Matching Screenshot: Modify | AI Review | Delete) */}
                  <div
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: 16,
                      paddingTop: 14,
                      borderTop: '1px solid var(--bd)',
                      fontSize: 12.5,
                      fontWeight: 600,
                    }}
                  >
                    {canEdit && (
                      <button
                        onClick={() => openEditModal(agent)}
                        style={{ background: 'none', border: 'none', color: '#818cf8', cursor: 'pointer', padding: 0 }}
                      >
                        Modify
                      </button>
                    )}
                    {canTest && (
                      <button
                        onClick={() => openReviewModal(agent)}
                        style={{ background: 'none', border: 'none', color: 'var(--accent, #35e8f2)', cursor: 'pointer', padding: 0 }}
                      >
                        AI Review
                      </button>
                    )}
                    {canEdit && (
                      <button
                        onClick={() => handleDeleteAgent(agent)}
                        style={{ background: 'none', border: 'none', color: '#f87171', cursor: 'pointer', padding: 0, marginLeft: 'auto' }}
                      >
                        Delete
                      </button>
                    )}
                    {!canEdit && !canTest && (
                      <span style={{ color: 'var(--t3)', fontWeight: 500 }}>View only</span>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* ── TAB 2: KNOWLEDGE BASE ── */}
      {activeTab === 'knowledge' && (
        <div style={{ padding: 24, maxWidth: 900 }}>
          <div style={{ marginBottom: 24 }}>
            <h2 style={{ fontSize: 16, fontWeight: 700, margin: '0 0 6px', color: 'var(--t1)' }}>Website Assistant Knowledge</h2>
            <p style={{ margin: 0, fontSize: 13, color: 'var(--t2)' }}>
              These FAQs and sources are what the website widget assistant answers from. The WhatsApp AI agent does not read them —
              it answers from the knowledge on its own settings page.{' '}
              <button onClick={openWhatsAppAgentSettings} style={{ background: 'none', border: 'none', padding: 0, color: 'var(--accent, #35e8f2)', cursor: 'pointer', fontSize: 13 }}>
                Edit WhatsApp agent knowledge
              </button>
            </p>
          </div>

          {/* Add FAQ form */}
          {canEditKnowledge && <div style={{ background: 'var(--surf)', border: '1px solid var(--bd)', borderRadius: 12, padding: 18, marginBottom: 24 }}>
            <h3 style={{ fontSize: 14, fontWeight: 700, margin: '0 0 12px', color: 'var(--t1)' }}>+ Add FAQ Item</h3>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
              <FInput
                placeholder="Question (e.g. What are your delivery times?)"
                value={newFaqQ}
                onChange={(e) => setNewFaqQ(e.target.value)}
              />
              <FTextarea
                rows={2}
                placeholder="Answer (e.g. Orders ship within 2 working days; delivery takes 3-5 days...)"
                value={newFaqA}
                onChange={(e) => setNewFaqA(e.target.value)}
              />
              <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
                <Btn size="sm" onClick={handleAddFaq} disabled={savingKnowledge || !newFaqQ || !newFaqA}>
                  {savingKnowledge ? 'Saving...' : 'Save to Knowledge Base'}
                </Btn>
              </div>
            </div>
          </div>}

          {/* List of existing knowledge */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            {knowledgeSources.map((item) => (
              <div key={item.id} style={{ padding: '14px 18px', background: 'var(--surf)', border: '1px solid var(--bd)', borderRadius: 10 }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 4 }}>
                  <span style={{ fontSize: 13.5, fontWeight: 700, color: 'var(--t1)' }}>{item.title}</span>
                  <span style={{ fontSize: 10.5, fontWeight: 600, padding: '2px 7px', borderRadius: 6, background: 'rgba(53, 232, 242, 0.1)', color: 'var(--accent, #35e8f2)' }}>
                    {item.type || 'DOCUMENT'}
                  </span>
                </div>
                <div style={{ fontSize: 12.5, color: 'var(--t2)', lineHeight: 1.45 }}>{item.content}</div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* ── TAB 3: GUIDELINES & SAFETY ── */}
      {activeTab === 'guidelines' && (
        <div style={{ padding: 24, maxWidth: 900 }}>
          <div style={{ marginBottom: 20 }}>
            <h2 style={{ fontSize: 16, fontWeight: 700, margin: '0 0 6px', color: 'var(--t1)' }}>Agent Guidelines & Guardrails</h2>
            <p style={{ margin: 0, fontSize: 13, color: 'var(--t2)' }}>
              Guidance added to an agent's prompt when you test it here. On WhatsApp, the live agent follows the guardrails set on its own settings page.
            </p>
          </div>

          <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            {guidelines.map((g) => (
              <div key={g.id} style={{ background: 'var(--surf)', border: '1px solid var(--bd)', borderRadius: 10, padding: '16px 20px' }}>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 6 }}>
                  <span style={{ fontSize: 14, fontWeight: 700, color: 'var(--t1)' }}>{g.title}</span>
                  <span
                    style={{
                      fontSize: 10.5,
                      fontWeight: 800,
                      padding: '2px 8px',
                      borderRadius: 6,
                      background: g.severity === 'CRITICAL' ? 'rgba(239, 68, 68, 0.12)' : 'rgba(53, 232, 242, 0.12)',
                      color: g.severity === 'CRITICAL' ? '#f87171' : 'var(--accent, #35e8f2)',
                    }}
                  >
                    {g.severity || 'MEDIUM'}
                  </span>
                </div>
                <p style={{ fontSize: 13, color: 'var(--t2)', margin: 0 }}>{g.description}</p>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* ── TAB 4: CRM ACTIONS ── */}
      {activeTab === 'actions' && (
        <div style={{ padding: 24, maxWidth: 900 }}>
          <div style={{ marginBottom: 20 }}>
            <h2 style={{ fontSize: 16, fontWeight: 700, margin: '0 0 6px', color: 'var(--t1)' }}>CRM Action Tools</h2>
            <p style={{ margin: 0, fontSize: 13, color: 'var(--t2)' }}>
              CRM actions that can be run for an agent through the API. Agents do not run them on their own during conversations,
              and the test lab never runs them.
            </p>
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))', gap: 16 }}>
            {actions.map((act) => (
              <div key={act.id} style={{ background: 'var(--surf)', border: '1px solid var(--bd)', borderRadius: 10, padding: '16px 18px' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
                  <div style={{ width: 28, height: 28, borderRadius: 6, background: 'rgba(53, 232, 242, 0.15)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                    <I n="zap" s={14} c="var(--accent, #35e8f2)" />
                  </div>
                  <span style={{ fontSize: 13.5, fontWeight: 700, color: 'var(--t1)' }}>{act.name}</span>
                </div>
                <p style={{ fontSize: 12.5, color: 'var(--t2)', margin: '0 0 10px', lineHeight: 1.45 }}>{act.description}</p>
                <div style={{ fontSize: 11, color: 'var(--t3)', fontFamily: 'monospace' }}>ID: {act.id}</div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* ── TAB 5: CHAT BOTS (CHANNELS) ── */}
      {activeTab === 'chat-bots' && (
        <div style={{ padding: 24, maxWidth: 900 }}>
          <div style={{ marginBottom: 20 }}>
            <h2 style={{ fontSize: 16, fontWeight: 700, margin: '0 0 6px', color: 'var(--t1)' }}>Chatbot Deployments & Channels</h2>
            <p style={{ margin: 0, fontSize: 13, color: 'var(--t2)' }}>
              Apply one of your agents to the WhatsApp AI agent and turn it on or off. Website widget and Instagram are not
              available for these agents yet.
            </p>
          </div>

          {channelsError && (
            <div style={{ padding: '10px 14px', marginBottom: 14, borderRadius: 8, fontSize: 12.5, background: 'rgba(239, 68, 68, 0.1)', border: '1px solid rgba(239, 68, 68, 0.3)', color: '#f87171' }}>
              {channelsError}
            </div>
          )}
          {!channelsError && !loading && channels.length === 0 && (
            <div style={{ padding: 24, textAlign: 'center', color: 'var(--t3)', fontSize: 13 }}>No channels available.</div>
          )}

          <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
            {channels.map((ch) => (
              <div key={ch.channelKey || ch.channel} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '16px 20px', background: 'var(--surf)', border: '1px solid var(--bd)', borderRadius: 10, flexWrap: 'wrap', gap: 10 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                  <div style={{ width: 34, height: 34, borderRadius: 8, background: 'rgba(255,255,255,0.04)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                    <I n={ch.icon} s={16} />
                  </div>
                  <div>
                    <div style={{ fontSize: 14, fontWeight: 700, color: 'var(--t1)' }}>{ch.channel}</div>
                    <div style={{ fontSize: 12, color: 'var(--t3)', marginTop: 2 }}>
                      Live agent: <strong style={{ color: 'var(--accent, #35e8f2)' }}>{ch.liveAgentName || 'Not named yet'}</strong>
                      {ch.assignedAgent && <span style={{ marginLeft: 8 }}>· applied from "{ch.assignedAgent}"</span>}
                      <span style={{ marginLeft: 8 }}>· {ch.connectedNumbers} number{ch.connectedNumbers === 1 ? '' : 's'} connected</span>
                    </div>
                  </div>
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                  <span style={{ fontSize: 11.5, fontWeight: 600, color: ch.live ? '#22c55e' : ch.connectedNumbers === 0 ? '#fbbf24' : 'var(--t3)' }}>
                    ● {ch.status}
                  </span>
                  {canTest && <button
                    onClick={() => handleTestChannel(ch)}
                    style={{
                      padding: '5px 12px',
                      borderRadius: 6,
                      background: 'rgba(53, 232, 242, 0.1)',
                      border: '1px solid rgba(53, 232, 242, 0.3)',
                      color: 'var(--accent, #35e8f2)',
                      fontSize: 12,
                      fontWeight: 600,
                      cursor: 'pointer',
                      display: 'flex',
                      alignItems: 'center',
                      gap: 5,
                    }}
                  >
                    <I n="play" s={12} c="var(--accent, #35e8f2)" /> Test Bot
                  </button>}
                  {canEdit && (
                    <Btn outline size="sm" onClick={() => handleOpenConfigure(ch)}>
                      Configure
                    </Btn>
                  )}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* ── MODAL: CREATE / MODIFY AGENT ── */}
      {showCreateModal && (
        <Modal title={editingAgent ? `Modify ${editingAgent.name}` : 'Create New Chat Agent'} onClose={() => setShowCreateModal(false)} width={540}>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
            <div>
              <FLabel required>Agent Name</FLabel>
              <FInput
                placeholder="e.g. Order Support Agent"
                value={formName}
                onChange={(e) => setFormName(e.target.value)}
              />
            </div>

            <div>
              <FLabel>Card Description</FLabel>
              <FInput
                placeholder="Brief summary displayed on the agent card..."
                value={formDescription}
                onChange={(e) => setFormDescription(e.target.value)}
              />
            </div>

            <div>
              <FLabel>Operational Purpose</FLabel>
              <FInput
                placeholder="Specific goal this agent is tasked to achieve..."
                value={formPurpose}
                onChange={(e) => setFormPurpose(e.target.value)}
              />
            </div>

            <div>
              <FLabel required>System Prompt & Persona</FLabel>
              <FTextarea
                rows={4}
                placeholder="Instructions defining tone, behavior, qualifying questions, and boundaries..."
                value={formPrompt}
                onChange={(e) => setFormPrompt(e.target.value)}
              />
            </div>

            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 10, marginTop: 8 }}>
              <Btn outline onClick={() => setShowCreateModal(false)}>Cancel</Btn>
              <Btn onClick={handleSaveAgent} disabled={saving || !formName.trim()}>
                {saving ? 'Saving...' : editingAgent ? 'Save Changes' : 'Create Agent'}
              </Btn>
            </div>
          </div>
        </Modal>
      )}

      {/* ── MODAL: AI REVIEW / TEST SIMULATOR ── */}
      {testingAgent && (
        <Modal title={`AI Review: ${testingAgent.name}`} onClose={() => setTestingAgent(null)} width={560}>
          <div style={{ display: 'flex', flexDirection: 'column', height: 440 }}>
            {/* Chat message history */}
            <div style={{ flex: 1, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 10, padding: 12, background: 'var(--bg)', borderRadius: 8, border: '1px solid var(--bd)', marginBottom: 12 }}>
              <div style={{ fontSize: 11.5, color: 'var(--t3)', lineHeight: 1.45 }}>
                Replies come from the configured LLM using this agent's prompt and guidelines. Nothing is sent to customers and no CRM actions are run.
              </div>
              {testChat.map((msg, i) => (
                <div
                  key={i}
                  style={{
                    alignSelf: msg.role === 'user' ? 'flex-end' : 'flex-start',
                    maxWidth: '85%',
                    background: msg.role === 'user' ? 'var(--accent, #35e8f2)' : msg.role === 'error' ? 'rgba(239, 68, 68, 0.1)' : 'var(--surf)',
                    color: msg.role === 'user' ? '#060A10' : msg.role === 'error' ? '#f87171' : 'var(--t1)',
                    border: msg.role === 'user' ? 'none' : msg.role === 'error' ? '1px solid rgba(239, 68, 68, 0.3)' : '1px solid var(--bd)',
                    borderRadius: 10,
                    padding: '8px 12px',
                    fontSize: 13,
                    lineHeight: 1.45,
                  }}
                >
                  <div>{msg.text}</div>
                </div>
              ))}
              {testLoading && (
                <div style={{ alignSelf: 'flex-start', color: 'var(--t3)', fontSize: 12 }}>
                  Agent is typing...
                </div>
              )}
            </div>

            {/* Test input bar */}
            <div style={{ display: 'flex', gap: 8 }}>
              <input
                type="text"
                placeholder="Type a test message (e.g. Do you deliver on weekends?)..."
                value={testInput}
                onChange={(e) => setTestInput(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && handleSendTestMessage()}
                style={{
                  flex: 1,
                  padding: '9px 12px',
                  background: 'var(--surf)',
                  border: '1px solid var(--bd)',
                  borderRadius: 8,
                  fontSize: 13,
                  color: 'var(--t1)',
                  outline: 'none',
                }}
              />
              <Btn size="sm" onClick={handleSendTestMessage} disabled={testLoading || !testInput.trim()}>
                Send
              </Btn>
            </div>
          </div>
        </Modal>
      )}

      {/* ── MODAL: CONFIGURE CHATBOT CHANNEL ── */}
      {configuringChannel && (
        <Modal
          title={`Configure Chatbot: ${configuringChannel.channel}`}
          onClose={() => setConfiguringChannel(null)}
          width={580}
        >
          <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '10px 14px', background: 'rgba(255,255,255,0.03)', borderRadius: 8, border: '1px solid var(--bd)' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                <div style={{ width: 30, height: 30, borderRadius: 6, background: 'rgba(53, 232, 242, 0.1)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                  <I n={configuringChannel.icon || 'phone'} s={16} c="var(--accent, #35e8f2)" />
                </div>
                <div>
                  <div style={{ fontSize: 13.5, fontWeight: 700, color: 'var(--t1)' }}>{configuringChannel.channel}</div>
                  <div style={{ fontSize: 11, color: 'var(--t3)' }}>{configuringChannel.status}</div>
                </div>
              </div>
              <label style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer', fontSize: 12.5, fontWeight: 600, color: channelForm.enabled ? '#34d399' : 'var(--t3)' }}>
                <input
                  type="checkbox"
                  checked={channelForm.enabled}
                  onChange={(e) => setChannelForm({ ...channelForm, enabled: e.target.checked })}
                  style={{ accentColor: 'var(--accent, #35e8f2)', width: 16, height: 16 }}
                />
                {channelForm.enabled ? 'Deployed' : 'Not deployed'}
              </label>
            </div>

            <div>
              <FLabel>Apply an agent's persona</FLabel>
              <FSelect
                value={channelForm.assignedAgentId}
                onChange={(e) => setChannelForm({ ...channelForm, assignedAgentId: e.target.value })}
              >
                <option value="">Keep the current WhatsApp persona</option>
                {agents.map((ag) => (
                  <option key={ag.id} value={ag.id}>
                    {ag.name}
                  </option>
                ))}
              </FSelect>
              <div style={{ fontSize: 11.5, color: 'var(--t3)', marginTop: 5, lineHeight: 1.4 }}>
                Applying an agent replaces the WhatsApp AI agent's name and persona prompt. Its knowledge, instructions and
                guardrails stay as set on the WhatsApp AI Agent settings page. Deploying needs a persona prompt and a configured LLM.
              </div>
              {(() => {
                const cur = agents.find((a) => a.id === channelForm.assignedAgentId);
                return cur ? (
                  <div style={{ fontSize: 11.5, color: 'var(--t3)', marginTop: 5, lineHeight: 1.4 }}>
                    {cur.description || cur.purpose || cur.systemPrompt?.slice(0, 120)}
                  </div>
                ) : null;
              })()}
            </div>

            <div style={{ fontSize: 12, color: 'var(--t2)' }}>
              Escalation rules, languages, knowledge and guardrails:{' '}
              <button onClick={openWhatsAppAgentSettings} style={{ background: 'none', border: 'none', padding: 0, color: 'var(--accent, #35e8f2)', cursor: 'pointer', fontSize: 12 }}>
                open WhatsApp AI Agent settings
              </button>
            </div>

            {channelMsg && (
              <div style={{ padding: '8px 12px', background: 'rgba(52, 211, 153, 0.1)', border: '1px solid rgba(52, 211, 153, 0.3)', color: '#34d399', borderRadius: 6, fontSize: 12 }}>
                {channelMsg}
              </div>
            )}

            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: 8 }}>
              <Btn
                outline
                size="sm"
                disabled={!channelForm.assignedAgentId}
                onClick={() => {
                  const targetAgent = agents.find((a) => a.id === channelForm.assignedAgentId);
                  if (targetAgent) {
                    setConfiguringChannel(null);
                    openReviewModal(targetAgent);
                  }
                }}
              >
                <I n="play" s={13} /> Test In Simulator
              </Btn>

              <div style={{ display: 'flex', gap: 10 }}>
                <Btn outline onClick={() => setConfiguringChannel(null)}>Cancel</Btn>
                <Btn onClick={handleSaveChannel} disabled={savingChannel}>
                  {savingChannel ? 'Saving...' : 'Save Configuration'}
                </Btn>
              </div>
            </div>
          </div>
        </Modal>
      )}
    </div>
  );
}
