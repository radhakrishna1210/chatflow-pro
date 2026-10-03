import { useState, useEffect, useCallback } from 'react';
import { I } from '../Icons.jsx';
import { Btn } from '../Btn.jsx';
import { wJson } from '../../lib/automationApi.js';
import { can, canBill } from '../../lib/permissions.js';
import { AI_AGENTS_API } from '../../lib/aiAgentsApi.js';
import { usePlanFeatures } from '../../lib/usePlanFeatures.js';

// The autonomous CRM agent, workspace-wide: its on/off switch, the plan gate,
// and — for admins — the work it has queued, what failed, and the suggestions
// it held back for a human. Per-record history stays on each lead and deal's
// Agent tab; this is the one place to see and steer the whole queue.

const API = AI_AGENTS_API.autonomous;

const card = { background: 'var(--surf)', border: '1px solid var(--bd)', borderRadius: 'var(--rl)', boxShadow: 'var(--card-shadow)' };

const KIND_LABEL = {
  schedule_followup: 'Schedule a follow-up',
  advance_contacted: 'Mark lead contacted',
};

const fmtWhen = (d) => (d ? new Date(d).toLocaleString('en-IN', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }) : '—');

const target = (row) => `${row.targetType === 'deal' ? 'Deal' : row.targetType === 'lead' ? 'Lead' : row.targetType}: ${row.targetLabel || row.targetId}`;

const Section = ({ icon, title, count, hint, children }) => (
  <div style={{ ...card, padding: '16px 18px' }}>
    <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: hint ? 4 : 12 }}>
      <I n={icon} s={14} c="var(--t2)" />
      <span style={{ fontSize: 13.5, fontWeight: 700, color: 'var(--t1)' }}>{title}</span>
      {count !== undefined && (
        <span style={{ fontSize: 11, fontWeight: 700, padding: '1px 7px', borderRadius: 10, background: 'rgba(255,255,255,0.06)', color: 'var(--t2)' }}>{count}</span>
      )}
    </div>
    {hint && <p style={{ fontSize: 12, color: 'var(--t3)', margin: '0 0 12px', lineHeight: 1.5 }}>{hint}</p>}
    {children}
  </div>
);

const Empty = ({ children }) => <p style={{ fontSize: 12.5, color: 'var(--t3)', margin: 0 }}>{children}</p>;

const Row = ({ title, sub, meta, actions }) => (
  <div style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '10px 0', borderTop: '1px solid var(--bd)', flexWrap: 'wrap' }}>
    <div style={{ flex: '1 1 260px', minWidth: 0 }}>
      <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--t1)' }}>{title}</div>
      {sub && <div style={{ fontSize: 12, color: 'var(--t2)', marginTop: 2, lineHeight: 1.45 }}>{sub}</div>}
      {meta && <div style={{ fontSize: 11, color: 'var(--t3)', marginTop: 3 }}>{meta}</div>}
    </div>
    {actions && <div style={{ display: 'flex', gap: 6, flexShrink: 0 }}>{actions}</div>}
  </div>
);

export default function AutonomousAgentPanel() {
  const isAdmin = can('autonomousAgent.manage');
  const { allows } = usePlanFeatures();
  const [settings, setSettings] = useState(null);
  const [queue, setQueue] = useState(null);
  const [queueError, setQueueError] = useState(null);
  const [busy, setBusy] = useState(null);
  const [message, setMessage] = useState(null);

  const loadSettings = useCallback(() => wJson(`${API}/settings`).then((r) => {
    if (r.ok && r.data) setSettings(r.data);
  }), []);

  const loadQueue = useCallback(() => {
    if (!isAdmin) return Promise.resolve();
    return wJson(`${API}/pending`).then((r) => {
      if (r.ok) { setQueue(r.data); setQueueError(null); } else setQueueError(r.error);
    });
  }, [isAdmin]);

  useEffect(() => { loadSettings(); loadQueue(); }, [loadSettings, loadQueue]);

  // Every action goes through here: one in flight at a time, the server's
  // refusal shown as-is, and the lists reloaded so they show what happened.
  const act = async (key, path, opts, done) => {
    setBusy(key);
    setMessage(null);
    const r = await wJson(path, opts);
    setBusy(null);
    if (!r.ok) {
      setMessage({ tone: 'error', text: r.locked ? 'The autonomous agent is not included in this workspace\'s plan.' : r.error });
      return;
    }
    if (done) setMessage({ tone: 'ok', text: done });
    await Promise.all([loadSettings(), loadQueue()]);
  };

  const enabled = settings?.enabled === true;
  const planAllows = allows('autonomousAgent');
  const live = enabled && planAllows;

  const toggle = () => act('switch', `${API}/settings`, {
    method: 'PATCH', body: JSON.stringify({ enabled: !enabled }),
  }, enabled ? 'Switched off. Queued work was withdrawn.' : 'Switched on. The agent picks up work on its next sweep.');

  const runNow = () => act('run', `${API}/run`, { method: 'POST' }, 'Queued a run — results appear below within a minute or two.');

  const openPlans = () => window.dispatchEvent(new CustomEvent('app:nav', { detail: { section: 'payments', subTab: 'subscription' } }));

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
      {/* ── switch and plan ── */}
      <div style={{ ...card, padding: '18px 20px', display: 'flex', alignItems: 'center', gap: 16, flexWrap: 'wrap' }}>
        <div style={{ width: 40, height: 40, borderRadius: 10, background: 'rgba(157,107,255,0.1)', border: '1px solid rgba(157,107,255,0.3)', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
          <I n="brain" s={19} c="#9d6bff" />
        </div>
        <div style={{ flex: '1 1 320px', minWidth: 0 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
            <h2 style={{ fontFamily: "'Space Grotesk',sans-serif", fontWeight: 700, fontSize: 17, color: 'var(--t1)', margin: 0 }}>Autonomous CRM agent</h2>
            {settings && (
              <span style={{ fontSize: 10, fontWeight: 700, padding: '2px 8px', borderRadius: 20, textTransform: 'uppercase', letterSpacing: '.05em',
                background: live ? 'var(--gbg)' : 'rgba(245,158,11,0.1)', border: `1px solid ${live ? 'var(--gbd)' : 'rgba(245,158,11,0.3)'}`, color: live ? 'var(--green)' : '#f59e0b' }}>
                {!planAllows ? 'Not in plan' : enabled ? 'On' : 'Off'}
              </span>
            )}
          </div>
          <p style={{ fontSize: 12.5, color: 'var(--t2)', margin: '4px 0 0', lineHeight: 1.55 }}>
            Works your CRM in the background: books follow-up tasks on open deals that have gone quiet and moves untouched
            New leads to Contacted. It only writes what the record's own history supports; anything less certain is held
            back below as a suggestion for a person to accept or reject.
          </p>
        </div>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          {isAdmin && (planAllows || enabled) && (
            <Btn variant={enabled ? 'outline' : 'primary'} onClick={toggle} disabled={!settings || busy === 'switch'}>
              {busy === 'switch' ? 'Working…' : enabled ? 'Turn off' : 'Turn on'}
            </Btn>
          )}
          {isAdmin && live && (
            <Btn variant="outline" onClick={runNow} disabled={busy === 'run'}>
              <I n="play" s={13} /> {busy === 'run' ? 'Queuing…' : 'Run now'}
            </Btn>
          )}
          {!planAllows && canBill() && <Btn onClick={openPlans}>See plans</Btn>}
        </div>
      </div>

      {!planAllows && (
        <div style={{ ...card, padding: '12px 16px', fontSize: 12.5, color: '#fbbf24', background: 'rgba(245,158,11,.06)', border: '1px solid rgba(245,158,11,.3)' }}>
          The autonomous agent is included in the paid plans. On this workspace's plan it books and changes nothing
          {canBill() ? ' — upgrade to turn it on.' : '; ask a workspace admin about upgrading.'}
        </div>
      )}

      {message && (
        <div role="status" style={{ ...card, padding: '10px 14px', fontSize: 12.5,
          color: message.tone === 'error' ? '#f87171' : 'var(--green)',
          border: `1px solid ${message.tone === 'error' ? 'rgba(239,68,68,.3)' : 'var(--gbd)'}`,
          background: message.tone === 'error' ? 'rgba(239,68,68,.06)' : 'var(--gbg)' }}>
          {message.text}
        </div>
      )}

      {!isAdmin && (
        <div style={{ ...card, padding: '14px 18px', fontSize: 12.5, color: 'var(--t2)', lineHeight: 1.55 }}>
          The agent's queue — what it has booked, what failed and what it is waiting on — is managed by workspace admins.
          What it did to a particular lead or deal is on that record's Agent tab.
        </div>
      )}

      {isAdmin && queueError && (
        <div style={{ ...card, padding: '12px 16px', fontSize: 12.5, color: '#f87171' }}>{queueError}</div>
      )}

      {isAdmin && !queue && !queueError && (
        <div style={{ ...card, padding: 18, fontSize: 12.5, color: 'var(--t3)' }}>Loading the agent's queue…</div>
      )}

      {isAdmin && queue && (
        <>
          <Section icon="clock" title="Queued and running" count={queue.queued}
            hint="Work the agent has booked. A queued task can be run on the next tick instead of at its booked time, or cancelled.">
            {queue.tasks.length === 0 ? <Empty>Nothing queued.</Empty> : queue.tasks.map((t) => (
              <Row key={t.id}
                title={`${KIND_LABEL[t.kind] || t.kind} · ${target(t)}`}
                sub={t.reason}
                meta={t.status === 'RUNNING'
                  ? `Running since ${fmtWhen(t.lockedAt)} · attempt ${t.attempts}`
                  : `${new Date(t.runAfter) > new Date() ? `Due ${fmtWhen(t.runAfter)}` : 'Due now'}${t.attempts ? ` · ${t.attempts} earlier attempt${t.attempts === 1 ? '' : 's'}` : ''}${t.lastError ? ` · last error: ${t.lastError}` : ''}`}
                actions={t.status === 'PENDING' && (
                  <>
                    {live && (
                      <Btn size="sm" variant="outline" disabled={busy === `run:${t.id}`}
                        onClick={() => act(`run:${t.id}`, `${API}/tasks/${t.id}/run`, { method: 'POST' }, 'It will run on the next tick.')}>
                        Run now
                      </Btn>
                    )}
                    <Btn size="sm" variant="ghost" disabled={busy === `cancel:${t.id}`}
                      onClick={() => act(`cancel:${t.id}`, `${API}/tasks/${t.id}/cancel`, { method: 'POST' }, 'Task cancelled.')}>
                      Cancel
                    </Btn>
                  </>
                )} />
            ))}
          </Section>

          <Section icon="alertt" title="Waiting on a person" count={queue.suggestions}
            hint="Changes the agent thought were right but could not prove from the record. Nothing is written until someone accepts.">
            {queue.suggestionItems.length === 0 ? <Empty>No suggestions waiting.</Empty> : queue.suggestionItems.map((f) => (
              <Row key={f.id}
                title={`${f.field}: ${f.value} · ${target(f)}`}
                sub={f.rationale}
                meta={`Suggested ${fmtWhen(f.createdAt)}`}
                actions={(
                  <>
                    <Btn size="sm" disabled={busy === `fact:${f.id}`}
                      onClick={() => act(`fact:${f.id}`, `${API}/facts/${f.id}`, { method: 'PATCH', body: JSON.stringify({ accepted: true }) }, 'Suggestion accepted.')}>
                      Accept
                    </Btn>
                    <Btn size="sm" variant="ghost" disabled={busy === `fact:${f.id}`}
                      onClick={() => act(`fact:${f.id}`, `${API}/facts/${f.id}`, { method: 'PATCH', body: JSON.stringify({ accepted: false }) }, 'Suggestion rejected.')}>
                      Reject
                    </Btn>
                  </>
                )} />
            ))}
          </Section>

          <Section icon="ban" title="Failed" count={queue.failed.length}
            hint="Tasks that ran out of attempts. Retrying puts one back in the queue with a fresh budget, due now.">
            {queue.failed.length === 0 ? <Empty>No failures.</Empty> : queue.failed.map((t) => (
              <Row key={t.id}
                title={`${KIND_LABEL[t.kind] || t.kind} · ${target(t)}`}
                sub={t.lastError}
                meta={`Failed ${fmtWhen(t.updatedAt)} after ${t.attempts} attempt${t.attempts === 1 ? '' : 's'}`}
                actions={live && (
                  <Btn size="sm" variant="outline" disabled={busy === `retry:${t.id}`}
                    onClick={() => act(`retry:${t.id}`, `${API}/tasks/${t.id}/retry`, { method: 'POST' }, 'Task re-queued.')}>
                    <I n="refresh" s={12} /> Retry
                  </Btn>
                )} />
            ))}
          </Section>

          <Section icon="activity" title="Recent passes" count={queue.recent.length}>
            {queue.recent.length === 0 ? <Empty>The agent has not run in this workspace yet.</Empty> : queue.recent.map((r) => (
              <Row key={r.id}
                title={target(r)}
                sub={r.summary}
                meta={`${fmtWhen(r.createdAt)}${r.applied ? ` · ${r.applied} change${r.applied === 1 ? '' : 's'} applied` : ''}${r.withheld ? ` · ${r.withheld} held back` : ''}`} />
            ))}
          </Section>
        </>
      )}
    </div>
  );
}
