import { useState, useEffect, useRef } from 'react';
import { I } from './Icons.jsx';

const QUICK_ACTIONS = {
  landing: [
    { emoji: '📝', label: 'Create Template', prompt: 'Create a template' },
    { emoji: '🗑️', label: 'Delete Template', prompt: 'Delete a template' },
    { emoji: '🚀', label: 'Create Campaign', prompt: 'Create a campaign' },
    { emoji: '🗑️', label: 'Delete Campaign', prompt: 'Delete a campaign' },
  ],
  dashboard: [
    { emoji: '📝', label: 'Create Template', prompt: 'Create a template' },
    { emoji: '🗑️', label: 'Delete Template', prompt: 'Delete a template' },
    { emoji: '🚀', label: 'Create Campaign', prompt: 'Create a campaign' },
    { emoji: '🗑️', label: 'Delete Campaign', prompt: 'Delete a campaign' },
  ]
};

export default function AIOnboardingCard({ page = 'landing' }) {
  const [messages, setMessages] = useState([
    {
      role: 'assistant',
      content: page === 'landing'
        ? "👋 Hi! I'm your AI Onboarding Agent. I can help you understand our features, create templates, or set up campaigns. What's your business type?"
        : "🤖 Welcome to your Dashboard! I'm your AI Assistant — running locally on your system with zero third-party APIs. I can help you build templates, optimize campaigns, and guide you through the platform. What would you like to do?"
    }
  ]);
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
  const messagesEndRef = useRef(null);
  const inputRef = useRef(null);

  const scrollToBottom = () => messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  useEffect(() => { scrollToBottom(); }, [messages]);

  const [showLoginModal, setShowLoginModal] = useState(false);

  const sendMessage = async (text) => {
    if (!text.trim() || loading) return;

    const token = localStorage.getItem('accessToken');
    if (!token) {
      setShowLoginModal(true);
      return;
    }

    const userMsg = { role: 'user', content: text };
    setMessages(prev => [...prev, userMsg]);
    setInput('');
    setLoading(true);

    try {
      const userStr = localStorage.getItem('user');
      const user = userStr ? JSON.parse(userStr) : {};
      
      const res = await fetch('/api/v1/onboarding/chat', {
        method: 'POST',
        headers: { 
          'Content-Type': 'application/json',
          ...(token ? { 'Authorization': `Bearer ${token}` } : {})
        },
        body: JSON.stringify({ message: text, history: messages, workspaceId: user.workspaceId })
      });
      const data = await res.json();
      setMessages(prev => [...prev, { role: 'assistant', content: data.content, card: data.card }]);
      
      // Dispatch an event so tabs can refresh if needed
      if (data.card) {
        window.dispatchEvent(new CustomEvent('app:data-updated', { detail: { templates: true, campaigns: true } }));
      }
    } catch (err) {
      console.error(err);
      setMessages(prev => [...prev, {
        role: 'assistant',
        content: "⚠️ Could not reach the local AI service. Make sure the backend is running on port 4000."
      }]);
    } finally {
      setLoading(false);
    }
  };

  const handleSend = () => sendMessage(input);
  const handleQuickAction = (prompt) => sendMessage(prompt);

  return (
    <div style={{
      width: '100%',
      fontFamily: "'Plus Jakarta Sans', sans-serif",
    }}>
      {/* Keyframe Animations */}
      <style>{`
        @keyframes agent-fadeUp {
          from { opacity: 0; transform: translateY(12px); }
          to   { opacity: 1; transform: translateY(0); }
        }
        @keyframes agent-pulse {
          0%, 100% { opacity: 1; }
          50% { opacity: 0.5; }
        }
        @keyframes agent-dot-bounce {
          0%, 80%, 100% { transform: scale(0.6); opacity: 0.4; }
          40% { transform: scale(1); opacity: 1; }
        }
        @keyframes agent-shimmer {
          0% { background-position: -200% 0; }
          100% { background-position: 200% 0; }
        }
      `}</style>

      {showLoginModal && (
        <div style={{ position:'fixed', inset:0, background:'rgba(0,0,0,0.6)', zIndex:1000, display:'flex', alignItems:'center', justifyContent:'center', backdropFilter:'blur(4px)' }}>
          <div style={{ background:'#070B14', border:'1px solid rgba(255,255,255,0.08)', width: 400, borderRadius: 12, padding: 24, display:'flex', flexDirection:'column', alignItems:'center', boxShadow:'0 24px 64px rgba(0,0,0,0.5)' }}>
            <div style={{ width: 48, height: 48, borderRadius: '50%', background: 'rgba(245, 158, 11, 0.1)', border: '1px solid rgba(245, 158, 11, 0.25)', display: 'flex', alignItems: 'center', justifyContent: 'center', marginBottom: 16 }}>
              <div style={{ fontSize: '24px' }}>🔒</div>
            </div>
            <h3 style={{ fontFamily:"'Syne',sans-serif", fontWeight: 700, fontSize: 18, color:'#F0F2F8', marginBottom: 8, margin: 0 }}>Login Required</h3>
            <p style={{ fontSize: 14, color:'rgba(255,255,255,0.6)', textAlign:'center', marginBottom: 24, lineHeight: 1.5 }}>
              You need to be logged in to use the AI Agent. Please sign in to your account to continue.
            </p>
            <div style={{ display: 'flex', gap: 12, width: '100%' }}>
              <button onClick={() => setShowLoginModal(false)} style={{ flex: 1, padding: '10px', borderRadius: 8, background: 'rgba(255,255,255,0.05)', color: '#fff', border: '1px solid rgba(255,255,255,0.1)', cursor: 'pointer' }}>Cancel</button>
              <button onClick={() => { window.dispatchEvent(new CustomEvent('app:nav', { detail: 'login' })); }} style={{ flex: 1, padding: '10px', borderRadius: 8, background: '#1EBF5E', color: '#000', border: 'none', cursor: 'pointer', fontWeight: 700 }}>Log in</button>
            </div>
          </div>
        </div>
      )}

      <div style={{
        background: 'linear-gradient(180deg, #0D1121 0%, #080B12 100%)',
        border: '1px solid rgba(255,255,255,0.08)',
        borderRadius: '20px',
        boxShadow: '0 24px 64px rgba(0,0,0,0.5), 0 0 40px rgba(30,191,94,0.06), inset 0 1px 0 rgba(255,255,255,0.06)',
        display: 'flex',
        flexDirection: 'column',
        overflow: 'hidden',
        height: page === 'landing' ? '480px' : '440px',
        animation: 'agent-fadeUp 0.35s ease-out',
      }}>

        {/* ─── Header ─── */}
        <div style={{
          padding: '14px 18px',
          background: 'linear-gradient(135deg, rgba(30,191,94,0.12), rgba(14,165,233,0.05))',
          borderBottom: '1px solid rgba(255,255,255,0.06)',
          display: 'flex', alignItems: 'center', gap: '10px',
          flexShrink: 0,
        }}>
          <div style={{
            width: '36px', height: '36px', borderRadius: '10px',
            background: 'linear-gradient(135deg, rgba(30,191,94,0.2), rgba(30,191,94,0.05))',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            border: '1px solid rgba(30,191,94,0.25)', fontSize: '17px',
            flexShrink: 0,
          }}>🤖</div>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontSize: '13px', fontWeight: 700, color: '#F0F2F8', letterSpacing: '-0.01em' }}>AI Onboarding Agent</div>
            <div style={{ display: 'flex', alignItems: 'center', gap: '5px', marginTop: '1px' }}>
              <div style={{ width: '5px', height: '5px', borderRadius: '50%', background: '#1EBF5E', animation: 'agent-pulse 2s ease infinite' }} />
              <span style={{ fontSize: '10px', color: '#1EBF5E', fontWeight: 600 }}>Local Model Active</span>
            </div>
          </div>
        </div>

        {/* ─── Messages Area ─── */}
        <div style={{
          flex: 1, padding: '14px 16px', overflowY: 'auto',
          display: 'flex', flexDirection: 'column', gap: '10px',
        }}>
          {messages.map((m, i) => (
            <div key={i} style={{
              alignSelf: m.role === 'user' ? 'flex-end' : 'flex-start',
              maxWidth: '88%', animation: 'agent-fadeUp 0.2s ease-out',
            }}>
              {m.role === 'assistant' && (
                <div style={{ fontSize: '9px', color: '#56688A', fontWeight: 600, marginBottom: '3px', paddingLeft: '2px' }}>AI Agent</div>
              )}
              <div style={{
                background: m.role === 'user'
                  ? 'linear-gradient(135deg, rgba(30,191,94,0.15), rgba(30,191,94,0.08))'
                  : 'rgba(255,255,255,0.03)',
                border: m.role === 'user'
                  ? '1px solid rgba(30,191,94,0.2)'
                  : '1px solid rgba(255,255,255,0.06)',
                padding: '9px 13px',
                borderRadius: m.role === 'user' ? '12px 12px 3px 12px' : '12px 12px 12px 3px',
                fontSize: '12.5px', color: '#F0F2F8', lineHeight: 1.55,
                whiteSpace: 'pre-wrap', wordBreak: 'break-word',
                boxShadow: 'inset 0 1px 0 rgba(255,255,255,0.04)',
              }}>
                {typeof m.content === 'string' ? m.content : null}
                {m.card && (
                  <div style={{
                    marginTop: m.content ? '10px' : '0',
                    background: 'rgba(0,0,0,0.2)',
                    border: '1px solid rgba(30,191,94,0.3)',
                    borderRadius: '8px',
                    padding: '12px',
                  }}>
                    <div style={{ fontSize: '14px', fontWeight: 'bold', marginBottom: '8px', color: '#1EBF5E', display: 'flex', alignItems: 'center', gap: '6px' }}>
                      {m.card.icon || '✅'} {m.card.title}
                    </div>
                    {m.card.details && Object.entries(m.card.details).map(([k, v]) => (
                      <div key={k} style={{ fontSize: '11px', marginBottom: '4px' }}>
                        <span style={{ color: '#56688A', textTransform: 'capitalize' }}>{k}:</span>{' '}
                        <span style={{ color: '#F0F2F8' }}>{typeof v === 'object' ? JSON.stringify(v) : v}</span>
                      </div>
                    ))}
                    {m.card.preview && (
                       <div style={{ marginTop: '8px', background: 'rgba(255,255,255,0.05)', padding: '8px', borderRadius: '4px', fontSize: '11px', fontStyle: 'italic', borderLeft: '2px solid #1EBF5E' }}>
                         {m.card.preview}
                       </div>
                    )}
                  </div>
                )}
              </div>
            </div>
          ))}

          {/* Typing indicator */}
          {loading && (
            <div style={{ alignSelf: 'flex-start', maxWidth: '88%' }}>
              <div style={{ fontSize: '9px', color: '#56688A', fontWeight: 600, marginBottom: '3px', paddingLeft: '2px' }}>AI Agent</div>
              <div style={{
                background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.06)',
                padding: '11px 15px', borderRadius: '12px 12px 12px 3px',
                display: 'flex', gap: '5px', alignItems: 'center',
              }}>
                {[0, 1, 2].map(i => (
                  <div key={i} style={{
                    width: '6px', height: '6px', borderRadius: '50%', background: '#1EBF5E',
                    animation: `agent-dot-bounce 1.4s ${i * 0.16}s ease-in-out infinite`,
                  }} />
                ))}
              </div>
            </div>
          )}
          <div ref={messagesEndRef} />
        </div>

        {/* ─── Quick Action Chips (shown when conversation is short) ─── */}
        {messages.length <= 2 && !loading && (
          <div style={{
            padding: '0 14px 8px', display: 'flex', flexWrap: 'wrap', gap: '6px',
            flexShrink: 0,
          }}>
            {QUICK_ACTIONS[page]?.map((action) => (
              <button
                key={action.label}
                onClick={() => handleQuickAction(action.prompt)}
                style={{
                  padding: '5px 11px', borderRadius: '16px', fontSize: '11px', fontWeight: 600,
                  background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.08)',
                  color: 'rgba(255,255,255,0.55)', cursor: 'pointer', transition: 'all 0.15s',
                  fontFamily: 'inherit', display: 'flex', alignItems: 'center', gap: '4px',
                }}
                onMouseEnter={e => {
                  e.currentTarget.style.borderColor = 'rgba(30,191,94,0.3)';
                  e.currentTarget.style.color = '#1EBF5E';
                  e.currentTarget.style.background = 'rgba(30,191,94,0.06)';
                }}
                onMouseLeave={e => {
                  e.currentTarget.style.borderColor = 'rgba(255,255,255,0.08)';
                  e.currentTarget.style.color = 'rgba(255,255,255,0.55)';
                  e.currentTarget.style.background = 'rgba(255,255,255,0.04)';
                }}
              >
                <span>{action.emoji}</span>
                <span>{action.label}</span>
              </button>
            ))}
          </div>
        )}

        {/* ─── Input Area ─── */}
        <div style={{
          padding: '10px 14px', borderTop: '1px solid rgba(255,255,255,0.06)',
          display: 'flex', gap: '8px', background: 'rgba(0,0,0,0.15)',
          flexShrink: 0,
        }}>
          <input
            ref={inputRef}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && handleSend()}
            placeholder="Ask me anything..."
            style={{
              flex: 1, padding: '9px 12px', borderRadius: '10px',
              border: '1px solid rgba(255,255,255,0.06)',
              background: 'rgba(255,255,255,0.04)', color: '#F0F2F8',
              outline: 'none', fontFamily: 'inherit', fontSize: '12.5px',
              transition: 'border-color 0.15s',
            }}
            onFocus={e => e.currentTarget.style.borderColor = 'rgba(30,191,94,0.3)'}
            onBlur={e => e.currentTarget.style.borderColor = 'rgba(255,255,255,0.06)'}
          />
          <button
            onClick={handleSend}
            disabled={loading || !input.trim()}
            style={{
              background: (loading || !input.trim()) ? 'rgba(30,191,94,0.3)' : '#1EBF5E',
              color: '#060A10', border: 'none', borderRadius: '10px',
              padding: '0 14px', fontWeight: 700,
              cursor: (loading || !input.trim()) ? 'not-allowed' : 'pointer',
              fontFamily: 'inherit', fontSize: '13px',
              boxShadow: (loading || !input.trim()) ? 'none' : '0 0 16px rgba(30,191,94,0.25)',
              transition: 'all 0.15s', display: 'flex', alignItems: 'center',
            }}
          >
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
              <path d="M22 2L11 13" /><path d="M22 2L15 22L11 13L2 9L22 2Z" />
            </svg>
          </button>
        </div>

        {/* ─── Footer Badge ─── */}
        <div style={{
          padding: '5px 14px 7px', textAlign: 'center',
          fontSize: '9.5px', color: '#2A3550', fontWeight: 500,
          flexShrink: 0, background: 'rgba(0,0,0,0.08)',
        }}>
          🔒 Running locally · No data leaves your system
        </div>
      </div>
    </div>
  );
}
