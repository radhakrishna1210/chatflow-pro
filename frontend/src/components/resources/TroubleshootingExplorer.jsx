import { useState } from 'react';
import { I } from '../Icons.jsx';
import { TROUBLESHOOTING, lookup } from '../../data/resources.js';
import ResourceCard from './ResourceCard.jsx';

/* "What are you trying to do?" — real UI state, not decorative cards.
   Pick an intent, get the matching resources + quick tips. */
export default function TroubleshootingExplorer() {
  const [activeId, setActiveId] = useState(null);
  const active = TROUBLESHOOTING.find((t) => t.id === activeId) || null;
  const resources = active ? active.resources.map(lookup).filter(Boolean) : [];

  return (
    <div className="rc-ts">
      <h3>What are you trying to do?</h3>
      <div className="rc-ts-options" role="group" aria-label="Troubleshooting topics">
        {TROUBLESHOOTING.map((t) => (
          <button
            key={t.id}
            className={`rc-ts-option${t.id === activeId ? ' active' : ''}`}
            aria-pressed={t.id === activeId}
            onClick={() => setActiveId(t.id === activeId ? null : t.id)}
          >
            {t.label}
          </button>
        ))}
      </div>

      {active && (
        <div className="rc-ts-result">
          <div className="rc-ts-tips">
            <h4>Quick checks</h4>
            <ul>{active.tips.map((tip) => <li key={tip}>{tip}</li>)}</ul>
          </div>
          <p style={{ fontSize: 12.5, fontWeight: 700, letterSpacing: '.06em', textTransform: 'uppercase', color: 'var(--t2)' }}>
            Related guides
          </p>
          <div className="rc-res-grid">
            {resources.map((r) => <ResourceCard key={r.slug} resource={r} />)}
          </div>
        </div>
      )}

      {!active && (
        <p style={{ marginTop: 18, fontSize: 13.5, color: 'var(--t2)', display: 'flex', alignItems: 'center', gap: 8 }}>
          <I n="alertc" s={15} c="var(--t2)" />
          Pick a topic above to see the checks and guides that resolve it fastest.
        </p>
      )}
    </div>
  );
}
