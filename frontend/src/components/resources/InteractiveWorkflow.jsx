import { useState, useEffect } from 'react';
import { navigate } from '../../App.jsx';
import { I } from '../Icons.jsx';
import { JOURNEYS, CATEGORY_NAME, getCategory } from '../../data/resources.js';

/* Interactive product journey player — Prev/Next through the real Spandan
   flow. Each step shows the module it maps to, prerequisites, expected result
   and common errors. Goes beyond the Interakt reference: this communicates the
   actual product sequence, not just a list of articles. */
export default function InteractiveWorkflow({ initialId }) {
  const [journeyId, setJourneyId] = useState(
    JOURNEYS.some((j) => j.id === initialId) ? initialId : JOURNEYS[0].id
  );
  const [stepIx, setStepIx] = useState(0);

  useEffect(() => { setStepIx(0); }, [journeyId]);

  const journey = JOURNEYS.find((j) => j.id === journeyId) || JOURNEYS[0];
  const step = journey.steps[stepIx];
  const total = journey.steps.length;
  const stepCategory = getCategory(step.module);

  return (
    <div>
      <div className="rc-journey-tabs" role="tablist" aria-label="Product journeys">
        {JOURNEYS.map((j) => (
          <button
            key={j.id}
            role="tab"
            aria-selected={j.id === journeyId}
            className={`rc-chip${j.id === journeyId ? ' active' : ''}`}
            onClick={() => setJourneyId(j.id)}
          >
            {j.title}
          </button>
        ))}
      </div>

      <p style={{ textAlign: 'center', color: 'var(--t2)', fontSize: 14, maxWidth: 620, margin: '0 auto 22px', lineHeight: 1.6 }}>
        {journey.summary}
      </p>

      <div className="rc-journey">
        <div className="rc-journey-rail" role="tablist" aria-label={`${journey.title} steps`}>
          {journey.steps.map((s, i) => (
            <button
              key={s.title}
              role="tab"
              aria-selected={i === stepIx}
              className={`rc-journey-step-btn${i === stepIx ? ' active' : ''}${i < stepIx ? ' done' : ''}`}
              onClick={() => setStepIx(i)}
            >
              <span className="n">{i < stepIx ? <I n="check" s={11} c="var(--green)" w={2.4} /> : i + 1}</span>
              <span>{s.title}</span>
            </button>
          ))}
        </div>

        <div className="rc-journey-body">
          <span className="step-k">Step {stepIx + 1} of {total} · {CATEGORY_NAME[step.module] || step.module}</span>
          <h3>{step.title}</h3>
          <p>{step.detail}</p>

          <div className="rc-journey-grid">
            <div className="rc-journey-panel">
              <h4>Prerequisites</h4>
              {step.prerequisites && step.prerequisites.length ? (
                <ul>{step.prerequisites.map((p) => <li key={p}>{p}</li>)}</ul>
              ) : <p>None — this is a starting point.</p>}
            </div>
            <div className="rc-journey-panel">
              <h4>Expected result</h4>
              <p>{step.result}</p>
            </div>
            <div className="rc-journey-panel" style={{ gridColumn: '1 / -1' }}>
              <h4>Common errors</h4>
              {step.errors && step.errors.length ? (
                <ul>{step.errors.map((er) => <li key={er}>{er}</li>)}</ul>
              ) : <p>No frequently reported issues at this step.</p>}
            </div>
          </div>

          {stepCategory && (
            <div>
              <button
                className="rc-btn rc-btn-ghost"
                onClick={() => navigate(`/resources/category/${stepCategory.id}`)}
                style={{ fontSize: 13 }}
              >
                Read the {CATEGORY_NAME[step.module] || 'section'} guides <I n="arrow" s={12} c="var(--t1)" />
              </button>
            </div>
          )}

          <div className="rc-journey-nav">
            <button
              className="rc-btn rc-btn-ghost"
              onClick={() => setStepIx((i) => Math.max(0, i - 1))}
              disabled={stepIx === 0}
              style={{ opacity: stepIx === 0 ? 0.4 : 1 }}
            >
              <I n="arrow" s={12} c="var(--t1)" /> Previous
            </button>
            <div className="rc-journey-dots" aria-hidden="true">
              {journey.steps.map((s, i) => <span key={s.title} className={i === stepIx ? 'on' : ''} />)}
            </div>
            {stepIx < total - 1 ? (
              <button className="rc-btn rc-btn-cta" onClick={() => setStepIx((i) => Math.min(total - 1, i + 1))}>
                Next <I n="arrow" s={12} c="#060A10" />
              </button>
            ) : (
              <button className="rc-btn rc-btn-cta" onClick={() => setStepIx(0)}>
                <I n="rotate" s={12} c="#060A10" /> Restart
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
