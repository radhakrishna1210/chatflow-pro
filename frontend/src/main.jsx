// First, before any module can read the stored session: an impersonating tab
// keeps its own (see lib/tabSession.js).
import './lib/tabSession.js';
import React from 'react';
import ReactDOM from 'react-dom/client';
import './index.css';
import App from './App.jsx';

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);
