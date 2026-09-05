const TONES = {
  green: { bg: 'var(--gbg)', bd: 'var(--gbd)', fg: 'var(--green)' },
  blue: { bg: 'rgba(14,165,233,0.12)', bd: 'rgba(14,165,233,0.35)', fg: '#38bdf8' },
  amber: { bg: 'rgba(245,158,11,0.12)', bd: 'rgba(245,158,11,0.35)', fg: '#fbbf24' },
  red: { bg: 'rgba(239,68,68,0.12)', bd: 'rgba(239,68,68,0.35)', fg: '#f87171' },
  violet: { bg: 'rgba(167,139,250,0.12)', bd: 'rgba(167,139,250,0.35)', fg: '#a78bfa' },
  gray: { bg: 'rgba(255,255,255,0.04)', bd: 'var(--bd)', fg: 'var(--t2)' },
};

export const StatusBadge = ({ label, tone = 'gray' }) => {
  const t = TONES[tone] ?? TONES.gray;
  return (
    <span style={{ padding: '2px 9px', borderRadius: 12, fontSize: 11, fontWeight: 600, background: t.bg, border: `1px solid ${t.bd}`, color: t.fg, whiteSpace: 'nowrap', display: 'inline-block' }}>
      {label}
    </span>
  );
};
