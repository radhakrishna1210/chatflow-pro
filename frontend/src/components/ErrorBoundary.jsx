import { Component } from 'react';

// After a deploy the hashed chunk names change, so a tab opened before it gets
// a failed dynamic import the first time it navigates to a lazily loaded view.
// A reload fetches the new index and fixes it; the session flag makes sure a
// chunk that is genuinely missing shows the fallback instead of looping.
const RELOAD_FLAG = 'cfp:chunkReloadAt';

const isChunkLoadError = (error) => {
  const msg = String(error?.message || '');
  return error?.name === 'ChunkLoadError'
    || /Failed to fetch dynamically imported module|Importing a module script failed|error loading dynamically imported module|Loading chunk [\w-]+ failed/i.test(msg);
};

const reloadedRecently = () => {
  try { return Date.now() - Number(sessionStorage.getItem(RELOAD_FLAG) || 0) < 30000; } catch { return true; }
};

export default class ErrorBoundary extends Component {
  constructor(props) {
    super(props);
    this.state = { error: null };
  }

  static getDerivedStateFromError(error) {
    return { error };
  }

  componentDidCatch(error, info) {
    if (isChunkLoadError(error) && !reloadedRecently()) {
      try { sessionStorage.setItem(RELOAD_FLAG, String(Date.now())); } catch { /* storage blocked */ }
      window.location.reload();
      return;
    }
    console.error('Render error caught by ErrorBoundary', error, info?.componentStack);
  }

  componentDidUpdate(prevProps) {
    // A new resetKey (the route, usually) means the user moved on: give the
    // new view a fresh chance instead of keeping the old error on screen.
    if (this.state.error && prevProps.resetKey !== this.props.resetKey) {
      this.setState({ error: null });
    }
  }

  render() {
    const { error } = this.state;
    if (!error) return this.props.children;

    const chunk = isChunkLoadError(error);
    const fullPage = this.props.variant === 'page';
    return (
      <div role="alert" style={{
        flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 24,
        minHeight: fullPage ? '100vh' : 240, background: fullPage ? '#060B18' : 'transparent',
        fontFamily: "'Manrope',sans-serif",
      }}>
        <div style={{ maxWidth: 420, textAlign: 'center', color: 'var(--t2, #9aa3b2)' }}>
          <h2 style={{ fontSize: 18, fontWeight: 700, color: 'var(--t1, #eef0f3)', marginBottom: 8 }}>
            {chunk ? 'A newer version is available' : 'Something went wrong'}
          </h2>
          <p style={{ fontSize: 13.5, lineHeight: 1.55, marginBottom: 18 }}>
            {chunk
              ? 'This page could not be loaded because the app was updated. Reload to get the latest version.'
              : 'This screen hit an unexpected error. You can try again, or reload the app.'}
          </p>
          <div style={{ display: 'flex', gap: 8, justifyContent: 'center' }}>
            {!chunk && (
              <button type="button" onClick={() => this.setState({ error: null })}
                style={{ padding: '9px 18px', borderRadius: 9, border: '1px solid var(--bd, rgba(255,255,255,0.12))', background: 'rgba(255,255,255,0.04)', color: 'var(--t1, #eef0f3)', fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit' }}>
                Try again
              </button>
            )}
            <button type="button" onClick={() => window.location.reload()}
              style={{ padding: '9px 18px', borderRadius: 9, border: 'none', background: 'var(--grad-cta, #35e8f2)', color: 'var(--ink, #060a10)', fontWeight: 700, cursor: 'pointer', fontFamily: 'inherit' }}>
              Reload
            </button>
          </div>
        </div>
      </div>
    );
  }
}
