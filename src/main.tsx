import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';
import { initAuth } from './auth/tokenStore';
import './index.css';

// Fetch a fresh Concur access token on app start and begin the auto-refresh loop.
void initAuth();

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);
