import { useState } from 'react';
import { I } from '../components/Icons.jsx';
import { Btn } from '../components/Btn.jsx';
import { apiFetch, wFetch } from '../lib/api.js';

// ─── Post-signup onboarding ──────────────────────────────────────────────────
//
// Creating a workspace here is still the only way to become its ADMIN; users
// invited by an admin join as members and never see this screen.
//
// It used to be one field — a workspace name — which meant the product knew
// nothing about the business it had just been handed, and the AI agent started
// from a blank persona. The wizard asks four short questions instead, and every
// answer is actually stored: the industry on the workspace, the goal as the
// agent's purpose. Nothing here is decoration.
//
// The workspace is created at the last possible moment, on "Finish setup", so
// someone who abandons the wizard halfway does not leave an empty workspace
// behind that the /setup guard would then skip them straight past.

const GOALS = [
  { id: 'sales',    icon: 'credit', title: 'Drive sales',      sub: 'Promote offers, convert in chat',
    purpose: 'Answer questions about our offers and products, and help customers buy in the conversation.' },
  { id: 'support',  icon: 'msg',    title: 'Support customers', sub: 'Answer faster, with less staffing',
    purpose: 'Answer customer questions about orders, delivery and returns quickly and accurately.' },
  { id: 'launch',   icon: 'zap',    title: 'Launch products',  sub: 'Announce to your audience',
    purpose: 'Tell customers about what we have just launched and answer questions about it.' },
  { id: 'reengage', icon: 'rotate', title: 'Re-engage',        sub: 'Win back quiet customers',
    purpose: 'Bring inactive customers back with relevant offers, and answer what they ask in return.' },
];

const INDUSTRIES = [
  { id: 'retail',    icon: 'building',  title: 'D2C / Retail',  sub: 'Products and offers',      industry: 'D2C / Retail' },
  { id: 'education', icon: 'file',      title: 'Education',     sub: 'Courses and admissions',   industry: 'Education' },
  { id: 'food',      icon: 'send',      title: 'Food & local',  sub: 'Bookings and orders',      industry: 'Food & hospitality' },
  { id: 'services',  icon: 'briefcase', title: 'Services',      sub: 'Leads and consultations',  industry: 'Professional services' },
];

const STEPS = [
  { kicker: 'YOUR GOAL',    title: 'What brings you to ChatFlow Pro?', sub: 'This tailors your setup and the agent we build for you.' },
  { kicker: 'YOUR BUSINESS',title: 'What kind of business?',       sub: 'It tunes the assistant’s tone and what it assumes.' },
  { kicker: 'WORKSPACE',    title: 'Name your workspace',          sub: 'Your team, numbers, contacts and wallet all live inside it.' },
  { kicker: 'AI SETUP',     title: 'Turn on Campaign AI?',         sub: 'Let customers ask about your offers and get grounded answers.' },
  { kicker: 'DONE',         title: 'Welcome to ChatFlow Pro',           sub: '' },
];

// ─── pieces ──────────────────────────────────────────────────────────────────

const ChoiceCard = ({ option, selected, onSelect }) => (
  <button type="button" onClick={() => onSelect(option.id)}
    style={{ display: 'flex', alignItems: 'center', gap: 14, padding: '16px 18px', borderRadius: 14, cursor: 'pointer', textAlign: 'left', width: '100%',
             fontFamily: "'Manrope',sans-serif", transition: 'all .15s',
             background: selected ? 'var(--gbg)' : 'rgba(255,255,255,0.03)',
             border: `1px solid ${selected ? 'var(--gbd)' : 'var(--bd)'}` }}>
    <span style={{ width: 38, height: 38, borderRadius: 11, flexShrink: 0, display: 'flex', alignItems: 'center', justifyContent: 'center',
                   background: selected ? 'rgba(53,232,242,0.14)' : 'rgba(255,255,255,0.04)', border: '1px solid var(--bd)' }}>
      <I n={option.icon} s={16} c={selected ? 'var(--green)' : 'var(--t2)'} />
    </span>
    <span style={{ flex: 1, minWidth: 0 }}>
      <span style={{ display: 'block', fontSize: 14, fontWeight: 700, color: 'var(--t1)' }}>{option.title}</span>
      <span style={{ display: 'block', fontSize: 12, color: 'var(--t3)', marginTop: 2 }}>{option.sub}</span>
    </span>
    <span style={{ width: 22, height: 22, borderRadius: '50%', flexShrink: 0, display: 'flex', alignItems: 'center', justifyContent: 'center',
                   background: selected ? 'var(--green)' : 'transparent', border: `1px solid ${selected ? 'var(--green)' : 'var(--bd)'}` }}>
      {selected && <I n="check" s={11} c="#08090c" w={3} />}
    </span>
  </button>
);

// ─── page ────────────────────────────────────────────────────────────────────

export default function WorkspaceSetup({ onNav }) {
  const stored = (() => { try { return JSON.parse(localStorage.getItem('user') || 'null'); } catch { return null; } })();

  const [step, setStep] = useState(0);
  const [goal, setGoal] = useState('sales');
  const [industry, setIndustry] = useState('retail');
  const [name, setName] = useState(stored?.name ? `${stored.name}'s Workspace` : '');
  const [wantsAI, setWantsAI] = useState(true);
  const [status, setStatus] = useState('idle');
  const [errMsg, setErrMsg] = useState('');

  const current = STEPS[step];
  const isLast = step === STEPS.length - 1;

  // Everything the wizard collected, applied after the workspace exists.
  //
  // Failures here are deliberately not fatal. The workspace was created — that
  // is the part that cannot be redone from Settings — so a preference that did
  // not save is a detail the user can fix in a screen they are about to reach,
  // not a reason to strand them on a signup form.
  const applyPreferences = async () => {
    const chosenIndustry = INDUSTRIES.find(i => i.id === industry)?.industry;
    const chosenGoal = GOALS.find(g => g.id === goal);

    if (chosenIndustry) {
      await wFetch('/settings', { method: 'PATCH', body: JSON.stringify({ industry: chosenIndustry }) }).catch(() => {});
    }
    if (wantsAI && chosenGoal) {
      await wFetch('/ai-agent/config', {
        method: 'PATCH',
        body: JSON.stringify({ purpose: chosenGoal.purpose }),
      }).catch(() => {});
    }
  };

  const finish = async () => {
    if (!name.trim()) { setErrMsg('Please enter a workspace name.'); setStatus('error'); setStep(2); return; }
    setStatus('loading'); setErrMsg('');
    try {
      const res = await apiFetch('/api/v1/workspaces', {
        method: 'POST',
        body: JSON.stringify({ name: name.trim() }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Could not create workspace');

      localStorage.setItem('accessToken', data.accessToken);
      localStorage.setItem('refreshToken', data.refreshToken);
      localStorage.setItem('user', JSON.stringify({
        id: data.user.id, name: data.user.name, email: data.user.email, role: data.user.role,
        superAdmin: data.user.superAdmin === true, workspaceId: data.workspace.id, workspaceName: data.workspace.name,
      }));

      await applyPreferences();
      setStatus('success');
      setStep(STEPS.length - 1);
    } catch (err) {
      setErrMsg(err.message);
      setStatus('error');
      setStep(2);
    }
  };

  const next = () => {
    if (step === 2 && !name.trim()) { setErrMsg('Please enter a workspace name.'); return; }
    setErrMsg('');
    if (step === 3) { finish(); return; }
    setStep(s => Math.min(STEPS.length - 1, s + 1));
  };

  const signOut = () => {
    localStorage.removeItem('accessToken');
    localStorage.removeItem('refreshToken');
    localStorage.removeItem('user');
    onNav('login');
  };

  return (
    <div style={{ minHeight: '100vh', display: 'flex', flexDirection: 'column', background: 'radial-gradient(1000px 520px at 15% -10%, rgba(53,232,242,0.07), transparent 60%), var(--bg)' }}>
      <header style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 16, padding: '18px clamp(18px,4vw,44px)' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <span className="sp-pulse" style={{ width: 10, height: 10, borderRadius: '50%', background: 'var(--accent)', boxShadow: '0 0 12px var(--accent)' }} />
          <span style={{ fontFamily: "'Space Grotesk',sans-serif", fontWeight: 700, fontSize: 17, color: 'var(--t1)', letterSpacing: '-.02em' }}>ChatFlow Pro</span>
        </div>
        {/* An escape hatch that does not strand anyone: there is no workspace
            to skip into yet, so this signs out rather than pretending. */}
        <button onClick={signOut} style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: 13, color: 'var(--t2)', fontFamily: "'Manrope',sans-serif" }}>
          Sign out
        </button>
      </header>

      <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '20px clamp(18px,4vw,44px) 60px' }}>
        <div style={{ width: '100%', maxWidth: 560 }}>

          {/* progress */}
          <div style={{ display: 'flex', gap: 5, marginBottom: 24 }}>
            {STEPS.map((_, i) => (
              <span key={i} style={{ flex: 1, height: 3, borderRadius: 3, transition: 'background .25s',
                background: i <= step ? 'var(--grad-cta)' : 'rgba(255,255,255,0.1)' }} />
            ))}
          </div>

          <div style={{ fontFamily: 'var(--mono)', fontSize: 10, letterSpacing: '.18em', color: 'var(--t3)', marginBottom: 10 }}>
            {isLast ? current.kicker : `STEP ${step + 1} OF ${STEPS.length - 1} · ${current.kicker}`}
          </div>
          <h1 style={{ fontFamily: "'Space Grotesk',sans-serif", fontWeight: 800, fontSize: 'clamp(24px,4vw,32px)', color: 'var(--t1)', letterSpacing: '-.03em', marginBottom: current.sub ? 8 : 22 }}>
            {current.title}
          </h1>
          {current.sub && <p style={{ fontSize: 14.5, color: 'var(--t2)', lineHeight: 1.6, marginBottom: 26 }}>{current.sub}</p>}

          {errMsg && (
            <div style={{ padding: '11px 14px', borderRadius: 9, background: 'rgba(239,68,68,.08)', border: '1px solid rgba(239,68,68,.25)', color: '#f87171', fontSize: 13, marginBottom: 18 }}>
              {errMsg}
            </div>
          )}

          {step === 0 && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
              {GOALS.map(g => <ChoiceCard key={g.id} option={g} selected={goal === g.id} onSelect={setGoal} />)}
            </div>
          )}

          {step === 1 && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
              {INDUSTRIES.map(i => <ChoiceCard key={i.id} option={i} selected={industry === i.id} onSelect={setIndustry} />)}
            </div>
          )}

          {step === 2 && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
              <div>
                <label htmlFor="ws-name" style={{ display: 'block', fontSize: 12, fontWeight: 600, color: 'var(--t2)', textTransform: 'uppercase', letterSpacing: '.06em', marginBottom: 7 }}>
                  Workspace name
                </label>
                <input id="ws-name" value={name} onChange={e => setName(e.target.value)}
                  onKeyDown={e => { if (e.key === 'Enter') next(); }}
                  placeholder="Aarav's Store"
                  style={{ width: '100%', padding: '13px 15px', borderRadius: 11, background: 'rgba(255,255,255,0.04)', border: '1px solid var(--bd)', color: 'var(--t1)', fontSize: 15, fontFamily: "'Manrope',sans-serif", outline: 'none', boxSizing: 'border-box' }}
                  onFocus={e => e.target.style.borderColor = 'var(--gbd)'}
                  onBlur={e => e.target.style.borderColor = 'var(--bd)'} />
              </div>
              <div style={{ display: 'flex', gap: 12, alignItems: 'flex-start', padding: '14px 16px', borderRadius: 11, background: 'rgba(255,255,255,0.03)', border: '1px solid var(--bd)' }}>
                <I n="phone" s={16} c="var(--green)" />
                <p style={{ fontSize: 12.5, color: 'var(--t2)', lineHeight: 1.6 }}>
                  You will connect a WhatsApp number next, from Number Setup — either one you already own through Meta’s
                  embedded signup, or one assigned to you. Nothing sends until a number is connected.
                </p>
              </div>
            </div>
          )}

          {step === 3 && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
              {[
                { id: true,  icon: 'spark', title: 'Yes, enable Campaign AI', sub: 'Recommended — customers can ask about your offers' },
                { id: false, icon: 'clock', title: 'Not yet',                 sub: 'Set it up later from the AI Agent page' },
              ].map(opt => (
                <ChoiceCard key={String(opt.id)} option={opt} selected={wantsAI === opt.id} onSelect={() => setWantsAI(opt.id)} />
              ))}
              <p style={{ fontSize: 12, color: 'var(--t3)', lineHeight: 1.6, marginTop: 4 }}>
                Either way the agent has to be configured and deployed before it answers anyone — this only decides whether we
                start it off with a purpose based on your goal.
              </p>
            </div>
          )}

          {isLast && (
            <div style={{ textAlign: 'center', padding: '10px 0 6px' }}>
              <div style={{ fontSize: 40, marginBottom: 14 }}>🎉</div>
              <p style={{ fontSize: 15, color: 'var(--t2)', lineHeight: 1.7, maxWidth: 400, margin: '0 auto' }}>
                Your workspace is ready. Connect a WhatsApp number, import your contacts, and your first campaign can go out
                today.
              </p>
            </div>
          )}

          {/* navigation */}
          <div style={{ display: 'flex', gap: 10, marginTop: 28, alignItems: 'center' }}>
            {!isLast && (
              <>
                <Btn variant="ghost" onClick={() => setStep(s => Math.max(0, s - 1))} disabled={step === 0 || status === 'loading'}>
                  ← Back
                </Btn>
                <div style={{ flex: 1 }} />
                <Btn onClick={next} disabled={status === 'loading'}>
                  {status === 'loading' ? 'Setting up…' : step === 3 ? 'Finish setup →' : 'Continue →'}
                </Btn>
              </>
            )}
            {isLast && (
              <Btn onClick={() => onNav('dashboard')} style={{ width: '100%', justifyContent: 'center', boxShadow: 'var(--glow)' }}>
                Go to dashboard →
              </Btn>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
