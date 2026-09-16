import { navigate } from '../../App.jsx';
import { Logo } from '../Logo.jsx';
import { CATEGORIES } from '../../data/resources.js';

/* Footer for the Resource Center. The Resource Center renders inside the
   Dashboard shell (the sidebar is the app chrome), so there is no separate
   top nav here — just this footer for quick discovery. */

export function RcFooter() {
  const goResources = (query) => (e) => {
    e.preventDefault();
    navigate(query ? `/resources?${query}` : '/resources');
  };
  const topicCols = [CATEGORIES.slice(0, 6), CATEGORIES.slice(6, 12)];
  return (
    <footer className="rc-footer">
      <div className="rc-wrap">
        <div className="rc-foot-top">
          <div className="rc-foot-brand">
            <Logo size={28} onClick={() => navigate('/dashboard')} />
            <p>WhatsApp Business API for teams that would rather their campaigns answered for themselves.</p>
          </div>
          <div className="rc-foot-col">
            <h5>Resource Center</h5>
            <button onClick={goResources('type=guide')}>Guides</button>
            <button onClick={goResources('type=api')}>API docs</button>
            <button onClick={goResources('type=workflow')}>Workflows</button>
            <button onClick={goResources('type=troubleshooting')}>Troubleshooting</button>
            <button onClick={goResources('')}>Product journeys</button>
          </div>
          {topicCols.map((col, i) => (
            <div className="rc-foot-col" key={i}>
              <h5>{i === 0 ? 'Topics' : 'More topics'}</h5>
              {col.map((c) => (
                <button key={c.id} onClick={(e) => { e.preventDefault(); navigate(`/resources/category/${c.id}`); }}>
                  {c.name}
                </button>
              ))}
            </div>
          ))}
        </div>
        <div className="rc-foot-bottom">
          <span>© {new Date().getFullYear()} Spandan · Official Meta WhatsApp Business API Partner</span>
          <span>Guides, product journeys &amp; developer reference</span>
        </div>
      </div>
    </footer>
  );
}
