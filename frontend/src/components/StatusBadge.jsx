// Two call styles are supported:
//   <StatusBadge s="Approved" />               — colour picked from the status name
//   <StatusBadge label="Live" tone="green" />  — explicit label and tone
const TONES = {
  green: { bg: 'var(--gbg)', bd: 'var(--gbd)', fg: 'var(--green)' },
  blue: { bg: 'rgba(14,165,233,0.12)', bd: 'rgba(14,165,233,0.35)', fg: '#38bdf8' },
  amber: { bg: 'rgba(245,158,11,0.12)', bd: 'rgba(245,158,11,0.35)', fg: '#fbbf24' },
  red: { bg: 'rgba(239,68,68,0.12)', bd: 'rgba(239,68,68,0.35)', fg: '#f87171' },
  violet: { bg: 'rgba(167,139,250,0.12)', bd: 'rgba(167,139,250,0.35)', fg: '#a78bfa' },
  gray: { bg: 'rgba(255,255,255,0.04)', bd: 'var(--bd)', fg: 'var(--t2)' },
};

const STATUS_STYLES = {
  Active:    { bg: 'var(--gbg)',            bd: 'var(--gbd)',            fg: 'var(--green)' },
  Approved:  { bg: 'var(--gbg)',            bd: 'var(--gbd)',            fg: 'var(--green)' },
  Completed: { bg: 'rgba(99,102,241,.1)',   bd: 'rgba(99,102,241,.25)',  fg: '#818cf8' },
  Draft:     { bg: 'rgba(255,255,255,.04)', bd: 'var(--bd)',             fg: 'var(--t2)' },
  Scheduled: { bg: 'rgba(14,165,233,.1)',   bd: 'rgba(14,165,233,.25)',  fg: '#9d6bff' },
  Running:   { bg: 'rgba(14,165,233,.1)',   bd: 'rgba(14,165,233,.25)',  fg: '#9d6bff' },
  Cancelled: { bg: 'rgba(239,68,68,.08)',   bd: 'rgba(239,68,68,.22)',   fg: '#f87171' },
  Failed:    { bg: 'rgba(239,68,68,.08)',   bd: 'rgba(239,68,68,.22)',   fg: '#f87171' },
  Rejected:  { bg: 'rgba(239,68,68,.08)',   bd: 'rgba(239,68,68,.22)',   fg: '#f87171' },
  Pending:   { bg: 'rgba(245,158,11,.1)',   bd: 'rgba(245,158,11,.25)',  fg: '#fbbf24' },
  Retrying:  { bg: 'rgba(168,85,247,.12)',  bd: 'rgba(168,85,247,.3)',   fg: '#c4ff46' },
  urgent:    { bg: 'rgba(239,68,68,.08)',   bd: 'rgba(239,68,68,.22)',   fg: '#f87171' },
  resolved:  { bg: 'var(--gbg)',            bd: 'var(--gbd)',            fg: 'var(--green)' },
  billing:   { bg: 'rgba(245,158,11,.08)',  bd: 'rgba(245,158,11,.22)',  fg: '#fbbf24' },
};

export const StatusBadge = ({ s, label, tone }) => {
  let text = label;
  let t;
  if (label === undefined && s !== undefined) {
    text = typeof s === 'string' && /^[A-Z_]+$/.test(s)
      ? s.charAt(0) + s.slice(1).toLowerCase()
      : s;
    t = STATUS_STYLES[text] || STATUS_STYLES.Draft;
  } else {
    t = TONES[tone] ?? TONES.gray;
  }
  return (
    <span style={{ padding: '2px 9px', borderRadius: 12, fontSize: 11, fontWeight: 600, background: t.bg, border: `1px solid ${t.bd}`, color: t.fg, whiteSpace: 'nowrap', display: 'inline-block' }}>
      {text}
    </span>
  );
};
