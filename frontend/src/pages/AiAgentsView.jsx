import { useState, useEffect, useCallback } from 'react';
import { I } from '../components/Icons.jsx';
import { Btn } from '../components/Btn.jsx';
import { Modal } from '../components/Modal.jsx';
import { FInput, FLabel, FSelect, FTextarea } from '../components/Form.jsx';
import { wFetch } from '../lib/api.js';

export default function AiAgentsView({ user, initialTab }) {
  const [activeTab, setActiveTab] = useState(() => {
    if (!initialTab) return 'agents';
    const t = String(initialTab).toLowerCase();
    if (t.includes('bot')) return 'chat-bots';
    if (t.includes('know')) return 'knowledge';
    if (t.includes('guide')) return 'guidelines';
    if (t.includes('action')) return 'actions';
    return 'agents';
  });

  const [agents, setAgents] = useState([]);
  const [guidelines, setGuidelines] = useState([]);
  const [actions, setActions] = useState([]);
  const [knowledgeSources, setKnowledgeSources] = useState([]);
  const [channels, setChannels] = useState([]);
  const [loading, setLoading] = useState(true);

  // Modals
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [editingAgent, setEditingAgent] = useState(null);
  const [testingAgent, setTestingAgent] = useState(null);
  const [showSetupModal, setShowSetupModal] = useState(false);
  const [configuringChannel, setConfiguringChannel] = useState(null);

  // Channel Configuration Form State
  const [channelForm, setChannelForm] = useState({
    assignedAgentId: '',
    enabled: true,
    greeting: '',
    delaySeconds: 1,
    fallbackToHuman: true,
    autoSyncCrm: true,
    businessHoursOnly: false,
    widgetPosition: 'bottom-right',
  });
  const [savingChannel, setSavingChannel] = useState(false);
  const [channelMsg, setChannelMsg] = useState('');

  // AI Setup Form State
  const [setupLang, setSetupLang] = useState('en');
  const [setupSensitivity, setSetupSensitivity] = useState('0.65');
  const [savingSetup, setSavingSetup] = useState(false);
  const [setupMsg, setSetupMsg] = useState('');

  // Form State
  const [formName, setFormName] = useState('');
  const [formDescription, setFormDescription] = useState('');
  const [formPurpose, setFormPurpose] = useState('');
  const [formPrompt, setFormPrompt] = useState('');
  const [formModel, setFormModel] = useState('gemini-1.5-flash');
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
      const res = await wFetch('/ai-agents');
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
      const res = await wFetch('/ai-agents/guidelines');
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
      const res = await wFetch('/ai-agents/actions');
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

  // Fetch channels
  const loadChannels = useCallback(async () => {
    try {
      const res = await wFetch('/ai-agents/channels');
      if (res.ok) {
        const d = await res.json();
        setChannels(d.data || []);
      }
    } catch (e) {
      console.error('Failed to load channels', e);
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
      assignedAgentId: ch.assignedAgentId || (agents[0]?.id || ''),
      enabled: ch.enabled !== false,
      greeting: ch.greeting || '',
      delaySeconds: ch.delaySeconds ?? 1,
      fallbackToHuman: ch.fallbackToHuman !== false,
      autoSyncCrm: ch.autoSyncCrm !== false,
      businessHoursOnly: !!ch.businessHoursOnly,
      widgetPosition: ch.widgetPosition || 'bottom-right',
    });
    setChannelMsg('');
  };

  const handleSaveChannel = async () => {
    if (!configuringChannel) return;
    setSavingChannel(true);
    setChannelMsg('');
    try {
      const res = await wFetch(`/ai-agents/channels/${configuringChannel.channelKey}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(channelForm),
      });
      if (res.ok) {
        setChannelMsg('Channel chatbot configuration saved successfully!');
        await loadChannels();
        setTimeout(() => {
          setConfiguringChannel(null);
          setChannelMsg('');
        }, 1000);
      } else {
        const err = await res.json().catch(() => ({}));
        alert(err.error || 'Failed to save channel configuration');
      }
    } catch (e) {
      alert('Network error saving channel configuration');
    } finally {
      setSavingChannel(false);
    }
  };

  const handleTestChannel = (ch) => {
    const targetAgentId = ch.assignedAgentId;
    const targetAgent = agents.find((a) => a.id === targetAgentId) || agents[0];
    if (targetAgent) {
      openReviewModal(targetAgent);
    } else {
      alert('No agent assigned to this channel yet.');
    }
  };

  const handleSaveSetup = async () => {
    setSavingSetup(true);
    setSetupMsg('');
    try {
      const res = await wFetch('/ai-agent/config', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          languages: [setupLang],
          escalationThreshold: parseFloat(setupSensitivity),
        }),
      });
      if (res.ok) {
        setSetupMsg('Workspace AI settings updated successfully!');
        setTimeout(() => {
          setShowSetupModal(false);
          setSetupMsg('');
        }, 1000);
      }
    } catch (e) {
      alert('Failed to update workspace AI settings');
    } finally {
      setSavingSetup(false);
    }
  };

  const openCreateModal = () => {
    setEditingAgent(null);
    setFormName('');
    setFormDescription('');
    setFormPurpose('');
    setFormPrompt('');
    setFormModel('gemini-1.5-flash');
    setShowCreateModal(true);
  };

  const openEditModal = (agent) => {
    setEditingAgent(agent);
    setFormName(agent.name || '');
    setFormDescription(agent.description || '');
    setFormPurpose(agent.purpose || '');
    setFormPrompt(agent.systemPrompt || '');
    setFormModel(agent.model || 'gemini-1.5-flash');
    setShowCreateModal(true);
  };

  const handleSaveAgent = async () => {
    if (!formName.trim()) {
      alert('Please provide an agent name');
      return;
    }
    setSaving(true);
    try {
      const payload = {
        name: formName.trim(),
        description: formDescription.trim(),
        purpose: formPurpose.trim(),
        systemPrompt: formPrompt.trim(),
        model: formModel,
      };

      const url = editingAgent ? `/ai-agents/${editingAgent.id}` : '/ai-agents';
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
      alert(`Error: ${err.message}`);
    } finally {
      setSaving(false);
    }
  };

  const handleDeleteAgent = async (agent) => {
    if (!confirm(`Are you sure you want to delete "${agent.name}"?`)) return;
    try {
      const res = await wFetch(`/ai-agents/${agent.id}`, { method: 'DELETE' });
      if (res.ok) {
        loadAgents();
      }
    } catch (e) {
      alert('Failed to delete agent');
    }
  };

  // Open interactive test simulator
  const openReviewModal = (agent) => {
    setTestingAgent(agent);
    setTestChat([
      {
        role: 'agent',
        text: `Hello! I am the ${agent.name}. How can I assist you with our services today?`,
        actions: [],
      },
    ]);
    setTestInput('');
  };

  const handleSendTestMessage = async () => {
    if (!testInput.trim() || !testingAgent || testLoading) return;
    const userMsg = testInput.trim();
    setTestInput('');

    setTestChat((prev) => [...prev, { role: 'user', text: userMsg }]);
    setTestLoading(true);

    try {
      const res = await wFetch(`/ai-agents/${testingAgent.id}/test`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message: userMsg }),
      });

      if (res.ok) {
        const data = await res.json();
        setTestChat((prev) => [
          ...prev,
          {
            role: 'agent',
            text: data.data?.reply || 'Understood. Thank you for providing those details.',
            actions: data.data?.triggeredActions || [],
          },
        ]);
      } else {
        setTestChat((prev) => [
          ...prev,
          { role: 'agent', text: 'Thank you for your message. How else may I assist you?' },
        ]);
      }
    } catch (e) {
      setTestChat((prev) => [
        ...prev,
        { role: 'agent', text: 'Thank you for the update. Let me know if you need anything else.' },
      ]);
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
      alert('Could not add FAQ');
    } finally {
      setSavingKnowledge(false);
    }
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', flex: 1, minHeight: 0, overflowY: 'auto' }}>
      {/* ── TOP HEADER ── */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          padding: '20px 24px',
          borderBottom: '1px solid var(--bd)',
        }}
      >
        <div>
          <h1 style={{ fontSize: 20, fontWeight: 700, margin: 0, color: 'var(--t1)', display: 'flex', alignItems: 'center', gap: 10 }}>
            <span>AI Chatbots & Agents</span>
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
            Configure autonomous AI conversational agents, RAG knowledge sources, guardrails, and CRM actions.
          </p>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <button
            onClick={() => setShowSetupModal(true)}
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
            <I n="spark" s={14} c="var(--accent, #35e8f2)" /> AI Setup
          </button>

          <Btn size="sm" onClick={openCreateModal}>
            <I n="plus" s={14} c="#060A10" /> New Chat Agent
          </Btn>
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

        <div style={{ fontSize: 12, color: 'var(--t3)' }}>
          LLM Engine: <span style={{ color: 'var(--accent, #35e8f2)', fontWeight: 600 }}>Gemini 1.5 Flash</span>
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
              <Btn size="sm" onClick={openCreateModal}>+ Create Your First Agent</Btn>
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
                    <button
                      onClick={() => openEditModal(agent)}
                      style={{ background: 'none', border: 'none', color: '#818cf8', cursor: 'pointer', padding: 0 }}
                    >
                      Modify
                    </button>
                    <button
                      onClick={() => openReviewModal(agent)}
                      style={{ background: 'none', border: 'none', color: 'var(--accent, #35e8f2)', cursor: 'pointer', padding: 0 }}
                    >
                      AI Review
                    </button>
                    <button
                      onClick={() => handleDeleteAgent(agent)}
                      style={{ background: 'none', border: 'none', color: '#f87171', cursor: 'pointer', padding: 0, marginLeft: 'auto' }}
                    >
                      Delete
                    </button>
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
            <h2 style={{ fontSize: 16, fontWeight: 700, margin: '0 0 6px', color: 'var(--t1)' }}>Knowledge Base & RAG Context</h2>
            <p style={{ margin: 0, fontSize: 13, color: 'var(--t2)' }}>
              These documents, FAQs, and links provide the exact factual context your AI Agents draw upon to answer customer queries.
            </p>
          </div>

          {/* Add FAQ form */}
          <div style={{ background: 'var(--surf)', border: '1px solid var(--bd)', borderRadius: 12, padding: 18, marginBottom: 24 }}>
            <h3 style={{ fontSize: 14, fontWeight: 700, margin: '0 0 12px', color: 'var(--t1)' }}>+ Add FAQ Item</h3>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
              <FInput
                placeholder="Question (e.g. What is the minimum investment amount?)"
                value={newFaqQ}
                onChange={(e) => setNewFaqQ(e.target.value)}
              />
              <FTextarea
                rows={2}
                placeholder="Answer (e.g. The minimum investment for Fund Series A is $250,000 for accredited entities...)"
                value={newFaqA}
                onChange={(e) => setNewFaqA(e.target.value)}
              />
              <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
                <Btn size="sm" onClick={handleAddFaq} disabled={savingKnowledge || !newFaqQ || !newFaqA}>
                  {savingKnowledge ? 'Saving...' : 'Save to Knowledge Base'}
                </Btn>
              </div>
            </div>
          </div>

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
              Boundaries, compliance directives, and escalation thresholds enforced on every conversation.
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
            <h2 style={{ fontSize: 16, fontWeight: 700, margin: '0 0 6px', color: 'var(--t1)' }}>Callable CRM Action Tools</h2>
            <p style={{ margin: 0, fontSize: 13, color: 'var(--t2)' }}>
              Functions that your AI agents can trigger autonomously during a live conversation.
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
              Map which AI agent answers on each public messaging channel.
            </p>
          </div>

          <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
            {(channels.length > 0 ? channels : [
              { channelKey: 'whatsapp', channel: 'WhatsApp Cloud API', icon: 'phone', assignedAgent: 'Investor Qualification Agent', status: 'Connected & Active', color: '#22c55e', enabled: true },
              { channelKey: 'website', channel: 'Website Live Chat Widget', icon: 'globe', assignedAgent: 'Fund Information Agent', status: 'Connected & Active', color: '#22c55e', enabled: true },
              { channelKey: 'instagram', channel: 'Instagram Direct Messages', icon: 'insta', assignedAgent: 'Investor Support Agent', status: 'Standby / Ready', color: '#38bdf8', enabled: false },
            ]).map((ch) => (
              <div key={ch.channelKey || ch.channel} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '16px 20px', background: 'var(--surf)', border: '1px solid var(--bd)', borderRadius: 10 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                  <div style={{ width: 34, height: 34, borderRadius: 8, background: 'rgba(255,255,255,0.04)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                    <I n={ch.icon} s={16} />
                  </div>
                  <div>
                    <div style={{ fontSize: 14, fontWeight: 700, color: 'var(--t1)' }}>{ch.channel}</div>
                    <div style={{ fontSize: 12, color: 'var(--t3)', marginTop: 2 }}>
                      Assigned Agent: <strong style={{ color: 'var(--accent, #35e8f2)' }}>{ch.assignedAgent}</strong>
                      {ch.greeting && <span style={{ marginLeft: 8, color: 'var(--t3)' }}>· "{ch.greeting.slice(0, 40)}..."</span>}
                    </div>
                  </div>
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                  <span style={{ fontSize: 11.5, fontWeight: 600, color: ch.color || (ch.enabled ? '#22c55e' : '#38bdf8') }}>
                    ● {ch.status || (ch.enabled ? 'Connected & Active' : 'Standby / Ready')}
                  </span>
                  <button
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
                  </button>
                  <Btn outline size="sm" onClick={() => handleOpenConfigure(ch)}>
                    Configure
                  </Btn>
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
                placeholder="e.g. Commercial Real Estate Advisor"
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

            <div>
              <FLabel>AI Model</FLabel>
              <FSelect value={formModel} onChange={(e) => setFormModel(e.target.value)}>
                <option value="gemini-1.5-flash">Gemini 1.5 Flash (Ultra-fast & responsive)</option>
                <option value="gemini-1.5-pro">Gemini 1.5 Pro (Deep complex reasoning)</option>
                <option value="gpt-4o-mini">GPT-4o Mini</option>
              </FSelect>
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
              {testChat.map((msg, i) => (
                <div
                  key={i}
                  style={{
                    alignSelf: msg.role === 'user' ? 'flex-end' : 'flex-start',
                    maxWidth: '85%',
                    background: msg.role === 'user' ? 'var(--accent, #35e8f2)' : 'var(--surf)',
                    color: msg.role === 'user' ? '#060A10' : 'var(--t1)',
                    border: msg.role === 'user' ? 'none' : '1px solid var(--bd)',
                    borderRadius: 10,
                    padding: '8px 12px',
                    fontSize: 13,
                    lineHeight: 1.45,
                  }}
                >
                  <div>{msg.text}</div>
                  {msg.actions && msg.actions.length > 0 && (
                    <div style={{ marginTop: 6, paddingTop: 6, borderTop: '1px solid rgba(255,255,255,0.1)', display: 'flex', flexWrap: 'wrap', gap: 4 }}>
                      {msg.actions.map((act) => (
                        <span key={act} style={{ fontSize: 10, fontWeight: 700, padding: '2px 6px', borderRadius: 4, background: 'rgba(34, 197, 94, 0.2)', color: '#4ade80' }}>
                          ⚡ Triggered: {act}
                        </span>
                      ))}
                    </div>
                  )}
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
                placeholder="Type a test inquiry (e.g. I want to invest $1M, are you taking new clients?)..."
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
                  <div style={{ fontSize: 11, color: 'var(--t3)' }}>Inbound conversational AI routing</div>
                </div>
              </div>
              <label style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer', fontSize: 12.5, fontWeight: 600, color: channelForm.enabled ? '#34d399' : 'var(--t3)' }}>
                <input
                  type="checkbox"
                  checked={channelForm.enabled}
                  onChange={(e) => setChannelForm({ ...channelForm, enabled: e.target.checked })}
                  style={{ accentColor: 'var(--accent, #35e8f2)', width: 16, height: 16 }}
                />
                {channelForm.enabled ? 'Active & Answering' : 'Standby / Paused'}
              </label>
            </div>

            <div>
              <FLabel required>Assigned Conversational Agent</FLabel>
              <FSelect
                value={channelForm.assignedAgentId}
                onChange={(e) => setChannelForm({ ...channelForm, assignedAgentId: e.target.value })}
              >
                {agents.map((ag) => (
                  <option key={ag.id} value={ag.id}>
                    {ag.name} ({ag.role || 'AGENT'} · {ag.model || 'Gemini 1.5 Flash'})
                  </option>
                ))}
              </FSelect>
              {(() => {
                const cur = agents.find((a) => a.id === channelForm.assignedAgentId);
                return cur ? (
                  <div style={{ fontSize: 11.5, color: 'var(--t3)', marginTop: 5, lineHeight: 1.4 }}>
                    {cur.description || cur.purpose || cur.systemPrompt?.slice(0, 120)}
                  </div>
                ) : null;
              })()}
            </div>

            <div>
              <FLabel>Initial Welcome / Greeting Message</FLabel>
              <FTextarea
                rows={2}
                value={channelForm.greeting}
                onChange={(e) => setChannelForm({ ...channelForm, greeting: e.target.value })}
                placeholder="Message sent when an inbound inquiry is initiated..."
              />
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
              <div>
                <FLabel>Response Delay</FLabel>
                <FSelect
                  value={channelForm.delaySeconds}
                  onChange={(e) => setChannelForm({ ...channelForm, delaySeconds: parseInt(e.target.value, 10) })}
                >
                  <option value={0}>Instant (0s)</option>
                  <option value={1}>Natural Pacing (1s)</option>
                  <option value={2}>Typing Simulation (2s)</option>
                  <option value={5}>Delayed (5s)</option>
                </FSelect>
              </div>

              {configuringChannel.channelKey === 'website' ? (
                <div>
                  <FLabel>Widget Placement</FLabel>
                  <FSelect
                    value={channelForm.widgetPosition}
                    onChange={(e) => setChannelForm({ ...channelForm, widgetPosition: e.target.value })}
                  >
                    <option value="bottom-right">Bottom Right Corner</option>
                    <option value="bottom-left">Bottom Left Corner</option>
                  </FSelect>
                </div>
              ) : (
                <div>
                  <FLabel>Operating Schedule</FLabel>
                  <FSelect
                    value={channelForm.businessHoursOnly ? 'hours' : '24_7'}
                    onChange={(e) => setChannelForm({ ...channelForm, businessHoursOnly: e.target.value === 'hours' })}
                  >
                    <option value="24_7">24 / 7 Always Active</option>
                    <option value="hours">Business Hours Only</option>
                  </FSelect>
                </div>
              )}
            </div>

            <div style={{ borderTop: '1px solid var(--bd)', paddingTop: 12, display: 'flex', flexDirection: 'column', gap: 8 }}>
              <span style={{ fontSize: 11, fontWeight: 700, color: 'var(--t3)', textTransform: 'uppercase' }}>Automation & CRM Guardrails</span>
              <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 12.5, color: 'var(--t2)', cursor: 'pointer' }}>
                <input
                  type="checkbox"
                  checked={channelForm.autoSyncCrm}
                  onChange={(e) => setChannelForm({ ...channelForm, autoSyncCrm: e.target.checked })}
                  style={{ accentColor: 'var(--accent, #35e8f2)' }}
                />
                Automatically qualify leads and sync contact details to CRM
              </label>
              <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 12.5, color: 'var(--t2)', cursor: 'pointer' }}>
                <input
                  type="checkbox"
                  checked={channelForm.fallbackToHuman}
                  onChange={(e) => setChannelForm({ ...channelForm, fallbackToHuman: e.target.checked })}
                  style={{ accentColor: 'var(--accent, #35e8f2)' }}
                />
                Escalate conversation to CRM Sales Inbox when user asks for a human
              </label>
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
                onClick={() => {
                  const targetAgent = agents.find((a) => a.id === channelForm.assignedAgentId) || agents[0];
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

      {/* ── MODAL: AI SETUP WIZARD ── */}
      {showSetupModal && (
        <Modal title="AI Workspace Configuration" onClose={() => setShowSetupModal(false)} width={480}>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
            <p style={{ fontSize: 13, color: 'var(--t2)', margin: 0 }}>
              Global parameters applied across all autonomous conversational agents in this workspace.
            </p>
            <div>
              <FLabel>Primary Business Language</FLabel>
              <FSelect value={setupLang} onChange={(e) => setSetupLang(e.target.value)}>
                <option value="en">English (US / UK / Global)</option>
                <option value="hi">Hindi / Hinglish</option>
                <option value="es">Spanish</option>
                <option value="ar">Arabic</option>
                <option value="de">German</option>
              </FSelect>
            </div>
            <div>
              <FLabel>Human Escalation Sensitivity</FLabel>
              <FSelect value={setupSensitivity} onChange={(e) => setSetupSensitivity(e.target.value)}>
                <option value="0.80">Conservative (High handoff rate to human reps)</option>
                <option value="0.65">Balanced (Recommended for sales & support)</option>
                <option value="0.45">Autonomous (Handles most inquiries independently)</option>
              </FSelect>
            </div>
            <div>
              <FLabel>Default LLM Foundation Model</FLabel>
              <FSelect defaultValue="gemini-1.5-flash">
                <option value="gemini-1.5-flash">Gemini 1.5 Flash (Ultra-fast latency, high reasoning)</option>
                <option value="gemini-1.5-pro">Gemini 1.5 Pro (Complex legal & tax evaluation)</option>
              </FSelect>
            </div>

            {setupMsg && (
              <div style={{ padding: '8px 12px', background: 'rgba(52, 211, 153, 0.1)', border: '1px solid rgba(52, 211, 153, 0.3)', color: '#34d399', borderRadius: 6, fontSize: 12 }}>
                {setupMsg}
              </div>
            )}

            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 10, marginTop: 8 }}>
              <Btn outline onClick={() => setShowSetupModal(false)}>Cancel</Btn>
              <Btn onClick={handleSaveSetup} disabled={savingSetup}>
                {savingSetup ? 'Saving...' : 'Save AI Settings'}
              </Btn>
            </div>
          </div>
        </Modal>
      )}
    </div>
  );
}
