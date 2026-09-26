import React from 'react';
import { createRoot } from 'react-dom/client';
import '@fontsource/antonio/400.css';
import '@fontsource/antonio/700.css';
import './styles.css';
import './lcars.css';
import { App } from './App';
createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
