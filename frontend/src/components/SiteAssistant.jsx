import { useState, useRef, useEffect, useCallback } from 'react';
import { I } from './Icons.jsx';

// ─── Website assistant ───────────────────────────────────────────────────────
//
// A floating chatbot that answers questions about ChatFlow Pro from the site's
// own content. Mounted once in App.jsx, so it follows the visitor between the
// landing page and the dashboard without losing the thread.
//
// It talks to POST /api/v1/assistant/chat, which is public and unauthenticated
// — the visitor most likely to ask what a plan costs has not signed up yet.
// The server does the retrieval and refuses anything the site's content does
// not cover, so this component never needs to judge a question itself.
//
// The transcript lives in sessionStorage rather than state alone: the SPA
// router remounts on some navigations, and losing a conversation because
// someone clicked Pricing is a worse bug than it sounds.

const STORAGE_KEY = 'cfp:assistant:thread';
const MONO = 'var(--mono)';

// Shown on an empty thread. These are prompts, not canned answers — tapping
// one just types it into the box and asks the server like any other question.
const SUGGESTIONS = [
  'What features does ChatFlow Pro provide?',
  'What plans do you have?',
  'How do I create a campaign?',
];

const GREETING = "Ask me anything about ChatFlow Pro — features, plans, pricing, or how something works. I answer from this website's content.";

function loadThread() {
  try {
    const saved = JSON.parse(sessionStorage.getItem(STORAGE_KEY) || '[]');
    return Array.isArray(saved) ? saved : [];
  } catch {
    return [];
  }
}

function saveThread(messages) {
  try {
    sessionStorage.setItem(STORAGE_KEY, JSON.stringify(messages));
  } catch {
    // A full or unavailable sessionStorage (private mode) must not break the
    // chat — the thread simply stops surviving navigation.
  }
}

// ─── pieces ──────────────────────────────────────────────────────────────────

const Bubble = ({ role, content, error }) => {
  const mine = role === 'user';
  return (
    <div style={{ display: 'flex', justifyContent: mine ? 'flex-end' : 'flex-start' }}>
      <div style={{
        maxWidth: '86%',
        padding: '10px 13px',
        borderRadius: mine ? '12px 12px 3px 12px' : '12px 12px 12px 3px',
        background: mine ? 'var(--green)' : 'rgba(255,255,255,0.045)',
        border: mine ? 'none' : `1px solid ${error ? 'rgba(248,113,113,0.32)' : 'var(--bd)'}`,
        color: mine ? '#060A10' : error ? '#f87171' : 'var(--t1)',
        fontSize: 13.5,
        lineHeight: 1.62,
        // The model answers in plain prose but uses "- " lists, and its line
        // breaks are meaningful. Preserving them beats parsing markdown for
        // the two constructs that actually appear.
        whiteSpace: 'pre-wrap',
        wordBreak: 'break-word',
        fontWeight: mine ? 600 : 400,
      }}>
        {content}
      </div>
    </div>
  );
};

const Typing = () => (
  <div style={{ display: 'flex', justifyContent: 'flex-start' }}>
    <div style={{
      padding: '12px 15px', borderRadius: '12px 12px 12px 3px',
      background: 'rgba(255,255,255,0.045)', border: '1px solid var(--bd)',
      display: 'flex', gap: 4, alignItems: 'center',
    }}>
      {/* .dot-typing is already in index.css, used by the landing hero. */}
      <span className="dot-typing" style={{ display: 'flex', gap: 4 }} aria-hidden="true">
        <span style={{ width: 5, height: 5, borderRadius: '50%', background: 'var(--t2)' }} />
        <span style={{ width: 5, height: 5, borderRadius: '50%', background: 'var(--t2)' }} />
        <span style={{ width: 5, height: 5, borderRadius: '50%', background: 'var(--t2)' }} />
      </span>
      <span style={{ position: 'absolute', width: 1, height: 1, overflow: 'hidden', clip: 'rect(0 0 0 0)' }}>
        Assistant is typing
      </span>
    </div>
  </div>
);

// ─── widget ──────────────────────────────────────────────────────────────────

export default function SiteAssistant() {
  const [open, setOpen] = useState(false);
  const [messages, setMessages] = useState(loadThread);
  const [draft, setDraft] = useState('');
  const [sending, setSending] = useState(false);

  const scrollRef = useRef(null);
  const inputRef = useRef(null);
  // Lets an in-flight answer be discarded when the thread is cleared, so a
  // slow reply cannot reappear in a conversation the user just reset.
  const threadId = useRef(0);

  useEffect(() => { saveThread(messages); }, [messages]);

  // Pin to the newest message whenever the transcript grows or the spinner
  // appears, which is the only scroll position that makes sense here.
  useEffect(() => {
    const el = scrollRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [messages, sending, open]);

  useEffect(() => {
    if (open) inputRef.current?.focus();
  }, [open]);

  useEffect(() => {
    if (!open) return undefined;
    const onKey = (e) => { if (e.key === 'Escape') setOpen(false); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open]);

  const send = useCallback(async (text) => {
    const question = text.trim();
    if (!question || sending) return;

    const mine = threadId.current;
    // The history sent up is the transcript *before* this question; the server
    // takes the question separately. Errors are left out — a failed request is
    // not something the model should try to interpret as conversation.
    const history = messages
      .filter((m) => !m.error)
      .map(({ role, content }) => ({ role, content }));

    setMessages((prev) => [...prev, { role: 'user', content: question }]);
    setDraft('');
    setSending(true);

    try {
      const res = await fetch('/api/v1/assistant/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ question, history }),
      });

      if (mine !== threadId.current) return; // conversation was cleared mid-flight

      if (!res.ok) {
        const retryAfter = res.headers.get('Retry-After');
        const message = res.status === 429
          ? `That's a lot of questions at once — try again in ${retryAfter || 'a few'} seconds.`
          : 'Something went wrong reaching the assistant. Please try again.';
        setMessages((prev) => [...prev, { role: 'assistant', content: message, error: true }]);
        return;
      }

      const data = await res.json();
      setMessages((prev) => [...prev, {
        role: 'assistant',
        content: data.answer || 'I could not put together an answer for that.',
      }]);
    } catch {
      if (mine !== threadId.current) return;
      setMessages((prev) => [...prev, {
        role: 'assistant',
        content: 'Could not reach the assistant. Check your connection and try again.',
        error: true,
      }]);
    } finally {
      if (mine === threadId.current) setSending(false);
    }
  }, [messages, sending]);

  const clear = () => {
    threadId.current += 1;
    setMessages([]);
    setDraft('');
    setSending(false);
    inputRef.current?.focus();
  };

  const onKeyDown = (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      send(draft);
    }
  };

  if (!open) {
    return (
      <button
        onClick={() => setOpen(true)}
        aria-label="Open the ChatFlow Pro assistant"
        style={{
          position: 'fixed', right: 22, bottom: 22, zIndex: 900,
          width: 52, height: 52, borderRadius: '50%',
          background: 'var(--green)', border: 'none', cursor: 'pointer',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          boxShadow: '0 8px 30px rgba(30,191,94,0.38), inset 0 1px 0 rgba(255,255,255,0.25)',
          transition: 'transform .18s ease',
        }}
        onMouseEnter={(e) => { e.currentTarget.style.transform = 'scale(1.06)'; }}
        onMouseLeave={(e) => { e.currentTarget.style.transform = 'scale(1)'; }}
      >
        <I n="bot" s={22} c="#060A10" w={2} />
      </button>
    );
  }

  const empty = messages.length === 0;

  return (
    <>
      <style>{ASSISTANT_CSS}</style>
      <section
        className="cfp-assistant"
        role="dialog"
        aria-label="ChatFlow Pro assistant"
        style={{
          position: 'fixed', right: 22, bottom: 22, zIndex: 900,
          width: 386, maxWidth: 'calc(100vw - 32px)',
          height: 560, maxHeight: 'calc(100vh - 44px)',
          display: 'flex', flexDirection: 'column', overflow: 'hidden',
          background: 'var(--surf-solid, #0D1121)',
          border: '1px solid var(--glass-bd)',
          borderRadius: 'var(--rxl)',
          boxShadow: 'inset 0 1px 0 rgba(255,255,255,0.08), 0 24px 70px rgba(0,0,0,0.62)',
        }}
      >
        {/* header */}
        <header style={{
          display: 'flex', alignItems: 'center', gap: 10,
          padding: '13px 14px', borderBottom: '1px solid var(--bd)',
          background: 'rgba(255,255,255,0.025)', flexShrink: 0,
        }}>
          <div style={{
            width: 30, height: 30, borderRadius: 9, flexShrink: 0,
            background: 'rgba(30,191,94,0.14)', border: '1px solid var(--gbd, rgba(30,191,94,0.3))',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
          }}>
            <I n="bot" s={15} c="var(--green)" />
          </div>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontSize: 13.5, fontWeight: 700, color: 'var(--t1)', letterSpacing: '-.01em' }}>
              ChatFlow Pro Assistant
            </div>
            <div style={{ fontFamily: MONO, fontSize: 10, color: 'var(--t3)', letterSpacing: '.06em', textTransform: 'uppercase' }}>
              Answers from this website
            </div>
          </div>
          <button
            onClick={clear}
            disabled={empty && !sending}
            title="Clear conversation"
            aria-label="Clear conversation"
            className="cfp-assistant-icon"
            style={{ opacity: empty && !sending ? 0.35 : 1, cursor: empty && !sending ? 'default' : 'pointer' }}
          >
            <I n="trash" s={14} c="var(--t2)" />
          </button>
          <button onClick={() => setOpen(false)} title="Close" aria-label="Close assistant" className="cfp-assistant-icon">
            <I n="x" s={15} c="var(--t2)" />
          </button>
        </header>

        {/* transcript */}
        <div
          ref={scrollRef}
          className="cfp-scroll"
          role="log"
          aria-live="polite"
          aria-atomic="false"
          style={{ flex: 1, overflowY: 'auto', padding: 14, display: 'flex', flexDirection: 'column', gap: 10 }}
        >
          <Bubble role="assistant" content={GREETING} />
          {messages.map((m, i) => (
            <Bubble key={`${i}-${m.role}`} role={m.role} content={m.content} error={m.error} />
          ))}
          {sending && <Typing />}

          {empty && !sending && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 7, marginTop: 4 }}>
              {SUGGESTIONS.map((s) => (
                <button
                  key={s}
                  onClick={() => send(s)}
                  className="cfp-assistant-suggestion"
                >
                  {s}
                </button>
              ))}
            </div>
          )}
        </div>

        {/* composer */}
        <div style={{
          flexShrink: 0, borderTop: '1px solid var(--bd)', padding: 11,
          display: 'flex', gap: 8, alignItems: 'flex-end',
          background: 'rgba(255,255,255,0.02)',
        }}>
          <textarea
            ref={inputRef}
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={onKeyDown}
            rows={1}
            maxLength={1000}
            placeholder="Ask about ChatFlow Pro…"
            aria-label="Your question"
            style={{
              flex: 1, resize: 'none', minHeight: 38, maxHeight: 110,
              padding: '9px 12px', borderRadius: 10,
              background: 'rgba(255,255,255,0.04)', border: '1px solid var(--bd)',
              color: 'var(--t1)', fontSize: 13.5, lineHeight: 1.5,
              fontFamily: "'Plus Jakarta Sans',sans-serif", outline: 'none',
            }}
          />
          <button
            onClick={() => send(draft)}
            disabled={!draft.trim() || sending}
            aria-label="Send question"
            style={{
              flexShrink: 0, width: 38, height: 38, borderRadius: 10, border: 'none',
              background: draft.trim() && !sending ? 'var(--green)' : 'rgba(255,255,255,0.06)',
              cursor: draft.trim() && !sending ? 'pointer' : 'not-allowed',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              transition: 'background .15s ease',
            }}
          >
            <I n="send" s={15} c={draft.trim() && !sending ? '#060A10' : 'var(--t3)'} />
          </button>
        </div>
      </section>
    </>
  );
}

const ASSISTANT_CSS = `
  .cfp-assistant { animation: fadeUp .22s cubic-bezier(.2,.7,.3,1); }
  .cfp-assistant-icon {
    flex-shrink: 0; width: 27px; height: 27px; border-radius: 7px;
    background: transparent; border: 1px solid transparent;
    display: flex; align-items: center; justify-content: center;
    cursor: pointer; transition: background .15s, border-color .15s;
  }
  .cfp-assistant-icon:hover:not(:disabled) {
    background: rgba(255,255,255,0.06); border-color: var(--bd);
  }
  .cfp-assistant-suggestion {
    text-align: left; padding: 9px 12px; border-radius: 9px;
    background: rgba(255,255,255,0.03); border: 1px solid var(--bd);
    color: var(--t2); font-size: 12.5px; line-height: 1.45; cursor: pointer;
    font-family: 'Plus Jakarta Sans', sans-serif;
    transition: background .15s, color .15s, border-color .15s;
  }
  .cfp-assistant-suggestion:hover {
    background: rgba(30,191,94,0.08); border-color: var(--gbd, rgba(30,191,94,0.3)); color: var(--t1);
  }
  /* On a phone the panel takes the screen: a 386px card floating over a
     360px viewport is just a broken layout with a shadow. */
  @media (max-width: 480px) {
    .cfp-assistant {
      right: 8px !important; bottom: 8px !important; left: 8px !important;
      width: auto !important; max-height: calc(100vh - 16px) !important;
    }
  }
`;
