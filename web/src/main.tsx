import React from 'react';
import ReactDOM from 'react-dom/client';
import { App } from './App';
import { PublicShare } from './Share';
import './styles.css';

// Minimal path routing: /share/:token renders the public (no-login) view; anything
// else is the authenticated app. `serve -s dist` already falls back to index.html
// for /share/* in production, and Vite's dev server does the same.
const shareMatch = window.location.pathname.match(/^\/share\/(.+)$/);

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    {shareMatch ? <PublicShare token={decodeURIComponent(shareMatch[1])} /> : <App />}
  </React.StrictMode>
);
