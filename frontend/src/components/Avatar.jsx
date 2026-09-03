const COLORS = ['#1EBF5E', '#0EA5E9', '#A78BFA', '#F59E0B', '#F472B6'];

export const Avatar = ({ name = '?', size = 32 }) => {
  const init = (name || '?').split(' ').map(n => n[0]).join('').slice(0, 2).toUpperCase() || '?';
  const c = COLORS[init.charCodeAt(0) % COLORS.length];
  return (
    <div style={{ width: size, height: size, borderRadius: '50%', background: `${c}18`, border: `1.5px solid ${c}44`, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: size * .33 + 'px', fontWeight: 700, color: c, flexShrink: 0 }}>
      {init}
    </div>
  );
};
