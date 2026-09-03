import { navigate } from '../../App.jsx';
import { I } from '../Icons.jsx';
import { CATEGORY_NAME, CATEGORY_ICON } from '../../data/resources.js';

const TYPE_LABEL = {
  guide: 'Guide', tutorial: 'Tutorial', video: 'Video',
  workflow: 'Workflow', api: 'API', troubleshooting: 'Troubleshooting',
};

/* One card, used for the "all guides" grid, featured, popular and related.
   Keyboard accessible: it's a real <button>. */
export default function ResourceCard({ resource, onMouseTrack }) {
  const r = resource;
  const go = () => navigate(`/resources/${r.slug}`);

  return (
    <button
      className="rc-res-card rc-glass"
      onClick={go}
      onMouseMove={onMouseTrack}
      aria-label={`${TYPE_LABEL[r.type] || 'Resource'}: ${r.title}`}
    >
      <div className="top">
        <span className="ico">
          <I n={CATEGORY_ICON[r.category] || 'file'} s={17} c="var(--green)" />
        </span>
        <span className="rc-badges">
          <span className="rc-badge type">{TYPE_LABEL[r.type] || r.type}</span>
          {r.difficulty && <span className={`rc-badge lvl-${r.difficulty}`}>{r.difficulty}</span>}
        </span>
      </div>
      <h4>{r.title}</h4>
      <p>{r.description}</p>
      <div className="meta">
        <span>{CATEGORY_NAME[r.category] || r.category}</span>
        {r.duration && <><span aria-hidden="true">·</span><span>{r.duration}</span></>}
      </div>
      <span className="go">
        {r.type === 'video' ? 'Watch' : 'Read'}
        <I n="arrow" s={13} c="var(--green)" />
      </span>
    </button>
  );
}
