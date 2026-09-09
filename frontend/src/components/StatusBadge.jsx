export const StatusBadge = ({ s }) => {
  const cfg = {
    Active:    { bg: 'var(--gbg)',                bd: 'var(--gbd)',                   c: 'var(--green)' },
    Approved:  { bg: 'var(--gbg)',                bd: 'var(--gbd)',                   c: 'var(--green)' },
    Completed: { bg: 'rgba(99,102,241,.1)',        bd: 'rgba(99,102,241,.25)',         c: '#818cf8' },
    Draft:     { bg: 'rgba(255,255,255,.04)',      bd: 'var(--bd)',                    c: 'var(--t2)' },
    Scheduled: { bg: 'rgba(14,165,233,.1)',         bd: 'rgba(14,165,233,.25)',         c: '#9d6bff' },
    Running:   { bg: 'rgba(14,165,233,.1)',         bd: 'rgba(14,165,233,.25)',         c: '#9d6bff' },
    Cancelled: { bg: 'rgba(239,68,68,.08)',         bd: 'rgba(239,68,68,.22)',          c: '#f87171' },
    Failed:    { bg: 'rgba(239,68,68,.08)',         bd: 'rgba(239,68,68,.22)',          c: '#f87171' },
    Rejected:  { bg: 'rgba(239,68,68,.08)',         bd: 'rgba(239,68,68,.22)',          c: '#f87171' },
    Pending:   { bg: 'rgba(245,158,11,.1)',        bd: 'rgba(245,158,11,.25)',         c: '#fbbf24' },
    Retrying:  { bg: 'rgba(168,85,247,.12)',       bd: 'rgba(168,85,247,.3)',          c: '#c4ff46' },
    urgent:    { bg: 'rgba(239,68,68,.08)',        bd: 'rgba(239,68,68,.22)',          c: '#f87171' },
    resolved:  { bg: 'var(--gbg)',                bd: 'var(--gbd)',                   c: 'var(--green)' },
    billing:   { bg: 'rgba(245,158,11,.08)',       bd: 'rgba(245,158,11,.22)',         c: '#fbbf24' },
  };
  const label = typeof s === 'string' && /^[A-Z_]+$/.test(s)
    ? s.charAt(0) + s.slice(1).toLowerCase()
    : s;
  const v = cfg[label] || cfg.Draft;
  return <span style={{ padding: '3px 9px', borderRadius: '20px', fontSize: '11px', fontWeight: 600, background: v.bg, border: `1px solid ${v.bd}`, color: v.c, display: 'inline-block' }}>{label}</span>;
};
