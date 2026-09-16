import { I } from './Icons.jsx';

export default function TemplateModuleTabs({ active }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 18, borderBottom: '1px solid var(--bd)', overflowX: 'auto', overflowY: 'hidden', flexShrink: 0, maxWidth: '100%' }} role="tablist" aria-label="Template modules">
      {[
        { id: 'templates', label: 'Templates', icon: 'file' },
        { id: 'authentication', label: 'Authentication', icon: 'shield' },
      ].map(item => {
        const on = active === item.id;
        return <button key={item.id} type="button" role="tab" aria-selected={on}
          onClick={() => window.dispatchEvent(new CustomEvent('app:nav', { detail: item.id }))}
          style={{ display: 'flex', alignItems: 'center', gap: 7, padding: '10px 14px', cursor: 'pointer', whiteSpace: 'nowrap', background: 'none', border: 0, borderBottom: `2px solid ${on ? 'var(--green)' : 'transparent'}`, marginBottom: -1, fontSize: 13, fontWeight: on ? 700 : 500, color: on ? 'var(--t1)' : 'var(--t2)', transition: 'all .15s' }}>
          <I n={item.icon} s={13} c={on ? 'var(--green)' : 'var(--t2)'} />
          {item.label}
        </button>;
      })}
    </div>
  );
}
