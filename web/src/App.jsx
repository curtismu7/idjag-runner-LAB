import React, { useEffect, useState } from 'react';
import { api, WORKSPACE } from './api.js';
import FlowTab from './FlowTab.jsx';
import TraceTab from './TraceTab.jsx';
import InspectorTab from './InspectorTab.jsx';
import AboutTab from './AboutTab.jsx';
import SeGuideTab from './SeGuideTab.jsx';
import DiagramView from './DiagramView.jsx';
import { DiagramTab } from './DiagramTab.jsx';
import ShelfLink from './components/ShelfLink.jsx';

const TABS = [
  { id: 'flow', label: 'Flow' },
  { id: 'trace', label: 'Trace' },
  { id: 'jwks', label: 'JWKS / Inspector' },
  { id: 'diagram', label: 'Diagram' },
  { id: 'about', label: 'About' },
  { id: 'seguide', label: 'Postman + PF setup' },
];

function themeOf() {
  try { return localStorage.getItem('idjag_theme') || ''; } catch { return ''; }
}

export default function App() {
  const [tab, setTab] = useState('flow');
  const [runtimeUrl, setRuntimeUrl] = useState('');
  const [theme, setTheme] = useState(themeOf());

  useEffect(() => {
    api('/api/info').then((info) => setRuntimeUrl(info.runtimeUrl)).catch(() => setRuntimeUrl('(unreachable)'));
  }, []);

  useEffect(() => {
    const root = document.documentElement;
    if (theme) root.setAttribute('data-theme', theme);
    else root.removeAttribute('data-theme');
    try {
      if (theme) localStorage.setItem('idjag_theme', theme);
      else localStorage.removeItem('idjag_theme');
    } catch { /* ignore */ }
  }, [theme]);

  // Secrets live only in component state; a page unload clears them with the tab's memory.
  useEffect(() => {
    const clear = () => {
      for (const id of ['f-pass', 'f-csec']) {
        const el = document.getElementById(id);
        if (el) el.value = '';
      }
    };
    window.addEventListener('unload', clear);
    return () => window.removeEventListener('unload', clear);
  }, []);

  return (
    <>
      <header className="shell-bar">
        <span className="shell-brand">Tarun ID-JAG Runner <small>real PingFederate</small></span>
        <nav className="shell-nav" aria-label="Sections">
          {TABS.map((t) => (
            <button key={t.id} aria-current={tab === t.id ? 'page' : undefined} onClick={() => setTab(t.id)}>
              {t.label}
            </button>
          ))}
        </nav>
        <div className="shell-right">
          <ShelfLink headers={{ 'X-Lab-Workspace': WORKSPACE }} />
          <span className="shell-runtime" title="Configured PingFederate runtime">{runtimeUrl}</span>
          <label className="inline">Theme
            <select value={theme} onChange={(e) => setTheme(e.target.value)} data-testid="theme">
              <option value="">Auto</option>
              <option value="light">Light</option>
              <option value="dark">Dark</option>
            </select>
          </label>
        </div>
      </header>
      <main className="page">
        {tab === 'flow' ? <FlowTab /> : null}
        {tab === 'trace' ? <TraceTab /> : null}
        {tab === 'jwks' ? <InspectorTab runtimeUrl={runtimeUrl} onRuntimeChanged={setRuntimeUrl} /> : null}
        {tab === 'diagram' ? <DiagramTab /> : null}
        {tab === 'about' ? <AboutTab /> : null}
        {tab === 'seguide' ? <SeGuideTab /> : null}
      </main>
    </>
  );
}
