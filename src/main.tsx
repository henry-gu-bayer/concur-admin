import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';
import { initAuth } from './auth/tokenStore';
import { initEntities } from './entities/entityStore';
import './index.css';

// Load safe server-side entity metadata, then authenticate the active entity.
void initEntities().then(() => initAuth());

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);
