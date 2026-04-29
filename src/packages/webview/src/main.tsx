import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App.js';

const root = document.getElementById('root');
if (!root) {
  throw new Error(
    'Root element #root not found. Make sure index.html contains <div id="root"></div> before main.tsx loads.',
  );
}

const style = document.createElement('style');
style.textContent = `
  html, body, #root { background: transparent; margin: 0; padding: 0; height: 100%; min-height: 100%; }
  *, *::before, *::after { box-sizing: border-box; }
  @keyframes gp-pulse { 0%, 100% { opacity: 1; } 50% { opacity: 0.35; } }
  button:focus-visible, [role="button"]:focus-visible, [role="tab"]:focus-visible {
    outline: 1px solid var(--vscode-focusBorder, #007acc);
    outline-offset: 1px;
  }
  select option { background: var(--vscode-input-background); color: var(--vscode-input-foreground); }
`;
document.head.appendChild(style);

createRoot(root).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
