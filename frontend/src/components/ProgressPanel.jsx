import { useState, useEffect, useCallback } from 'react';
import { I } from './Icons.jsx';
import { wFetch } from '../lib/api.js';

// Your own progress: level, streak, today's missions, achievements, and an
// opt-in leaderboard.
//
// The design constraint that shapes all of this is that points are paid for
// outcomes, never for activity volume — on a platform billed per WhatsApp
// message, rewarding "messages sent" would pay people to burn the customer's
// wallet. That is only credible if the rules are visible, so the earning table
// is shown rather than hidden behind a help link.
//
// Reads GET /progress/me and GET /progress/leaderboard. There is deliberately
// no route to read anyone else's profile.

const card = { background: 'var(--surf)', border: '1px solid var(--bd)', borderRadius: 'var(--rl)' };

// Mirrors XP_RULES in backend/src/services/gamification.service.js. Shown so
// the scheme is inspectable; the server remains the only thing that awards.
const EARNING = [
  { points: 50, label: 'Close a deal' },
  { points: 25, label: 'Get a quote accepted' },
  { points: 10, label: 'Qualify a lead' },
  { points: 8, label: 'Resolve a ticket' },
  { points: 5, label: 'Clear an overdue task' },
];

const fmtWhen = (d) => {
  const then = new Date(d);
  const mins = Math.round((Date.now() - then) / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  if (mins < 1440) return `${Math.round(mins / 60)}h ago`;
  const days = Math.round(mins / 1440);
  if (days < 30) return `${days}d ago`;
  return then.toLocaleDateString('en-IN', { day: 'numeric', month: 'short' });
};

const Bar = ({ pct, tone = 'var(--green)', height = 6 }) => (
  <div style={{ height, borderRadius: height, background: 'rgba(255,255,255,.07)', overflow: 'hidden' }}>
    <div style={{
      width: `${Math.max(0, Math.min(100, pct))}%`, height: '100%', background: tone,
      borderRadius: height, transition: 'width var(--dur-slow) var(--ease-out)',
    }} />
  </div>
);

const LevelHeader = ({ profile }) => {
  const atMax = profile.nextLevelAt === null;
  return (
    <div style={{ ...card, padding: '18px 20px' }}>
      <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap', marginBottom: 12 }}>
        <div style={{ display: 'flex', alignItems: 'baseline', gap: 9 }}>
          <span style={{ fontFamily: "'Syne',sans-serif", fontWeight: 800, fontSize: 19, color: 'var(--t1)' }}>{profile.name}</span>
          <span style={{ fontSize: 12, color: 'var(--t3)' }}>Level {profile.level}</span>
        </div>
        <span style={{ fontSize: 13, color: 'var(--t2)' }}>
          <strong style={{ color: 'var(--green)' }}>{profile.xp.toLocaleString('en-IN')}</strong> XP
        </span>
      </div>

      <Bar pct={profile.progress} />

      <p style={{ fontSize: 11.5, color: 'var(--t3)', marginTop: 7 }}>
        {atMax
          ? 'Highest level reached.'
          : <>{(profile.nextLevelAt - profile.xp).toLocaleString('en-IN')} XP to the next level.</>}
      </p>
    </div>
  );
};

const StreakCard = ({ streak }) => (
  <div style={{ ...card, padding: '16px 18px' }}>
    <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6 }}>
      <I n="zap" s={14} c="#fbbf24" />
      <span style={{ fontSize: 12.5, fontWeight: 600, color: 'var(--t2)' }}>Streak</span>
    </div>
    <div style={{ fontFamily: "'Syne',sans-serif", fontWeight: 800, fontSize: 26, color: 'var(--t1)', lineHeight: 1.1 }}>
      {streak.current}<span style={{ fontSize: 13, fontWeight: 600, color: 'var(--t3)' }}> day{streak.current === 1 ? '' : 's'}</span>
    </div>
    <p style={{ fontSize: 11.5, color: 'var(--t3)', marginTop: 6, lineHeight: 1.5 }}>
      {streak.current === 0
        ? 'Earn anything today to start one.'
        : streak.graceUsed
          // Said plainly rather than quietly folded in. A streak that looks
          // unbroken when a day was actually missed is a lie the user will
          // eventually catch.
          ? 'Includes one missed day — the grace day is now used, so another gap will reset it.'
          : 'Days in a row you finished something. One missed day is forgiven.'}
    </p>
  </div>
);

const MissionsCard = ({ missions }) => (
  <div style={{ ...card, padding: '16px 18px' }}>
    <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 12 }}>
      <I n="target" s={14} c="var(--green)" />
      <span style={{ fontSize: 12.5, fontWeight: 600, color: 'var(--t2)' }}>Today</span>
    </div>
    <div style={{ display: 'flex', flexDirection: 'column', gap: 13 }}>
      {missions.map((m) => (
        <div key={m.key}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 7, marginBottom: 5 }}>
            <span style={{
              width: 15, height: 15, borderRadius: 4, flexShrink: 0,
              border: m.done ? 'none' : '1px solid var(--bd)',
              background: m.done ? 'var(--green)' : 'transparent',
              display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
            }}>
              {m.done && <I n="check" s={10} c="#060A10" />}
            </span>
            <span style={{ fontSize: 13, color: m.done ? 'var(--t3)' : 'var(--t1)', textDecoration: m.done ? 'line-through' : 'none' }}>
              {m.title}
            </span>
          </div>
          <div style={{ paddingLeft: 22 }}>
            <Bar pct={m.progress} tone={m.done ? 'var(--green)' : 'rgba(255,255,255,.22)'} height={4} />
            <p style={{ fontSize: 11.5, color: 'var(--t3)', marginTop: 4 }}>{m.detail}</p>
          </div>
        </div>
      ))}
    </div>
    <p style={{ fontSize: 11, color: 'var(--t3)', marginTop: 13, lineHeight: 1.5, borderTop: '1px solid var(--bd)', paddingTop: 10 }}>
      Missions come from your actual open work. Nothing here can be completed by
      logging in or by sending more messages.
    </p>
  </div>
);

const AchievementsCard = ({ achievements }) => {
  const earned = achievements.filter((a) => a.unlocked).length;
  return (
    <div style={{ ...card, padding: '16px 18px' }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <I n="spark" s={14} c="#a78bfa" />
          <span style={{ fontSize: 12.5, fontWeight: 600, color: 'var(--t2)' }}>Achievements</span>
        </div>
        <span style={{ fontSize: 11.5, color: 'var(--t3)' }}>{earned} of {achievements.length}</span>
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(150px, 1fr))', gap: 8 }}>
        {achievements.map((a) => (
          <div key={a.key} title={a.detail} style={{
            padding: '10px 12px', borderRadius: 8,
            border: `1px solid ${a.unlocked ? 'var(--gbd)' : 'var(--bd)'}`,
            background: a.unlocked ? 'var(--gbg)' : 'transparent',
            opacity: a.unlocked ? 1 : .55,
          }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 3 }}>
              <I n={a.unlocked ? 'check' : 'lock'} s={11} c={a.unlocked ? 'var(--green)' : 'var(--t3)'} />
              <span style={{ fontSize: 12.5, fontWeight: 600, color: a.unlocked ? 'var(--t1)' : 'var(--t3)' }}>{a.label}</span>
            </div>
            <p style={{ fontSize: 11, color: 'var(--t3)', margin: 0, lineHeight: 1.45 }}>{a.detail}</p>
          </div>
        ))}
      </div>
    </div>
  );
};

const RecentCard = ({ recent }) => (
  <div style={{ ...card, padding: '16px 18px' }}>
    <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 12 }}>
      <I n="chart" s={14} c="var(--t2)" />
      <span style={{ fontSize: 12.5, fontWeight: 600, color: 'var(--t2)' }}>Recently earned</span>
    </div>
    {recent.length === 0 ? (
      <p style={{ fontSize: 12.5, color: 'var(--t3)', margin: 0 }}>Nothing yet. Points arrive when work reaches a result.</p>
    ) : (
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        {recent.map((r, i) => (
          <div key={`${r.kind}-${r.at}-${i}`} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10 }}>
            <span style={{ fontSize: 12.5, color: 'var(--t2)' }}>{r.label}</span>
            <span style={{ display: 'flex', alignItems: 'center', gap: 9, flexShrink: 0 }}>
              <span style={{ fontSize: 11, color: 'var(--t3)' }}>{fmtWhen(r.at)}</span>
              <span style={{ fontSize: 12, fontWeight: 700, color: 'var(--green)' }}>+{r.points}</span>
            </span>
          </div>
        ))}
      </div>
    )}
  </div>
);

const EarningCard = () => (
  <div style={{ ...card, padding: '16px 18px' }}>
    <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 11 }}>
      <I n="idcard" s={14} c="var(--t2)" />
      <span style={{ fontSize: 12.5, fontWeight: 600, color: 'var(--t2)' }}>How points are earned</span>
    </div>
    <div style={{ display: 'flex', flexDirection: 'column', gap: 7 }}>
      {EARNING.map((e) => (
        <div key={e.label} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10 }}>
          <span style={{ fontSize: 12.5, color: 'var(--t2)' }}>{e.label}</span>
          <span style={{ fontSize: 12, fontWeight: 700, color: 'var(--t1)' }}>+{e.points}</span>
        </div>
      ))}
    </div>
    <p style={{ fontSize: 11, color: 'var(--t3)', marginTop: 11, lineHeight: 1.5, borderTop: '1px solid var(--bd)', paddingTop: 10 }}>
      Every rule pays for an outcome someone else had to agree to. Nothing pays
      for sending messages, launching campaigns or creating records — rewarding
      volume on a per-message platform would just cost you money.
    </p>
  </div>
);

// Off by default. A leaderboard nobody asked for turns a team tool into a
// ranking, so it is revealed on request and reports only name, points and
// level — never pipeline value.
const Leaderboard = () => {
  const [rows, setRows] = useState(null);
  const [shown, setShown] = useState(false);
  const [error, setError] = useState(null);

  const load = async () => {
    setShown(true);
    try {
      const res = await wFetch('/progress/leaderboard?limit=10');
      if (!res.ok) throw new Error(`Could not load the leaderboard (${res.status}).`);
      const body = await res.json();
      setRows(body.data ?? []);
    } catch (e) {
      setError(e.message);
    }
  };

  if (!shown) {
    return (
      <button onClick={load} style={{
        ...card, padding: '13px 18px', width: '100%', textAlign: 'left', cursor: 'pointer',
        fontFamily: 'inherit', fontSize: 12.5, color: 'var(--t2)',
        display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10,
      }}>
        <span>Show the workspace leaderboard</span>
        <span style={{ fontSize: 11, color: 'var(--t3)' }}>names and points only</span>
      </button>
    );
  }

  return (
    <div style={{ ...card, padding: '16px 18px' }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <I n="users" s={14} c="var(--t2)" />
          <span style={{ fontSize: 12.5, fontWeight: 600, color: 'var(--t2)' }}>Leaderboard</span>
        </div>
        <button onClick={() => setShown(false)} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--t3)', fontSize: 11.5, fontFamily: 'inherit' }}>
          Hide
        </button>
      </div>
      {error ? <p style={{ fontSize: 12.5, color: '#f87171', margin: 0 }}>{error}</p>
        : rows === null ? <p style={{ fontSize: 12.5, color: 'var(--t3)', margin: 0 }}>Loading…</p>
        : rows.length === 0 ? <p style={{ fontSize: 12.5, color: 'var(--t3)', margin: 0 }}>Nobody has earned anything yet.</p>
        : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {rows.map((r) => (
              <div key={r.userId} style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                <span style={{ fontSize: 11.5, color: 'var(--t3)', width: 18, flexShrink: 0 }}>{r.rank}</span>
                <span style={{ fontSize: 12.5, color: 'var(--t1)', flex: 1 }}>{r.name}</span>
                <span style={{ fontSize: 11.5, color: 'var(--t3)' }}>{r.level}</span>
                <span style={{ fontSize: 12, fontWeight: 700, color: 'var(--green)', width: 58, textAlign: 'right' }}>
                  {r.xp.toLocaleString('en-IN')}
                </span>
              </div>
            ))}
          </div>
        )}
    </div>
  );
};

export default function ProgressPanel() {
  const [profile, setProfile] = useState(null);
  const [error, setError] = useState(null);

  const load = useCallback(async () => {
    try {
      const res = await wFetch('/progress/me');
      if (!res.ok) throw new Error(`Could not load your progress (${res.status}).`);
      setProfile(await res.json());
    } catch (e) {
      setError(e.message);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  if (error) {
    return <div style={{ ...card, padding: '14px 18px', fontSize: 12.5, color: '#f87171' }}>{error}</div>;
  }
  if (!profile) {
    return <div style={{ ...card, padding: '20px 18px', fontSize: 12.5, color: 'var(--t3)' }}>Loading your progress…</div>;
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      <LevelHeader profile={profile} />

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(250px, 1fr))', gap: 12, alignItems: 'start' }}>
        <StreakCard streak={profile.streak} />
        <MissionsCard missions={profile.missions} />
      </div>

      <AchievementsCard achievements={profile.achievements} />

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(250px, 1fr))', gap: 12, alignItems: 'start' }}>
        <RecentCard recent={profile.recent} />
        <EarningCard />
      </div>

      <Leaderboard />
    </div>
  );
}
