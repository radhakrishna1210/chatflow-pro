const { useState } = React;

const App = () => {
  const [page, setPage] = useState('landing');

  const nav = (p) => {
    setPage(p);
    window.scrollTo({ top: 0, behavior: 'instant' });
  };

  if (page === 'landing')   return <window.LandingPage onNav={nav} />;
  if (page === 'login')     return <window.LoginPage   onNav={nav} />;
  if (page === 'dashboard') return <window.Dashboard   onNav={nav} />;

  // Fallback
  return <window.LandingPage onNav={nav} />;
};

ReactDOM.createRoot(document.getElementById('root')).render(<App />);
