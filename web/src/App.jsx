import React, { useEffect, useState } from 'react';
import { api, WORKSPACE } from './api.js';
import FlowTab from './FlowTab.jsx';
import TraceTab from './TraceTab.jsx';
import InspectorTab from './InspectorTab.jsx';
import AboutTab from './AboutTab.jsx';
import TalkTrackTab from './TalkTrackTab.jsx';
import DiagramView from './DiagramView.jsx';
import { DiagramTab } from './DiagramTab.jsx';
import ShelfLink from './components/ShelfLink.jsx';
import TopMenu, { applyFontSize } from './top-menu/TopMenu.jsx';
import talkTrack from '../../docs/talk-track.md?raw';

const TABS = [
  { id: 'flow', label: 'Flow' },
  { id: 'trace', label: 'Trace' },
  { id: 'jwks', label: 'JWKS / Inspector' },
  { id: 'diagram', label: 'Diagram' },
  { id: 'about', label: 'About' },
  { id: 'talk', label: 'Talk track' },
];

// Per-tab sections of docs/talk-track.md shown in the presenter-say aside (heading prefixes to match on).
const SAY = {
  flow: ['Say this first', 'Act 1', 'Act 2', 'Act 3', 'Act 4', 'Close'],
  trace: ['Act 1', 'Act 2', 'Act 3', 'Act 4'],
  jwks: ['Setup', 'The Inspector', 'Act 3'],
  diagram: ['What to say about PingFederate'],
  about: ['What this lab is', 'What to say about PingFederate', 'Close'],
  talk: [],
};

function sayFor(lines, tabId) {
  const wanted = SAY[tabId] || [];
  const out = [];
  let current = null;
  for (const raw of lines) {
    const h = /^##\s+(.*)$/.exec(raw);
    if (h) current = h[1];
    if (current && wanted.some((w) => current.startsWith(w)) && raw.trim() && !/^#/.test(raw)) out.push(raw);
  }
  return out;
}

const sayLines = talkTrack.split('\n');

function themeOf() {
  try { return localStorage.getItem('idjag_theme') || 'auto'; } catch { return 'auto'; }
}

function fontOf() {
  try { return localStorage.getItem('ilr.font') || 'M'; } catch { return 'M'; }
}

export default function App() {
  const [tab, setTab] = useState('flow');
  const [runtimeUrl, setRuntimeUrl] = useState('');
  const [info, setInfo] = useState(null);
  const [theme, setTheme] = useState(themeOf());
  const [fontStep, setFontStep] = useState(fontOf());
  const [presenter, setPresenter] = useState(false);
  const [resetCount, setResetCount] = useState(0);

  const reset = async () => {
    try { await api('/api/reset', { method: 'POST', body: {} }); } catch { /* reset the view anyway */ }
    setResetCount((n) => n + 1);
  };

  useEffect(() => {
    const on = (e) => {
      if (e.target && /^(INPUT|TEXTAREA|SELECT)$/.test(e.target.tagName)) return;
      if (e.key === 'p' || e.key === 'P') setPresenter((v) => !v);
      else if (e.key === 'Escape') setPresenter(false);
    };
    window.addEventListener('keydown', on);
    return () => window.removeEventListener('keydown', on);
  }, []);

  useEffect(() => {
    api('/api/info').then((data) => { setInfo(data); setRuntimeUrl(data.runtimeUrl); }).catch(() => setRuntimeUrl('(unreachable)'));
  }, []);

  useEffect(() => {
    const root = document.documentElement;
    if (theme && theme !== 'auto') root.setAttribute('data-theme', theme);
    else root.removeAttribute('data-theme');
    try {
      if (theme && theme !== 'auto') localStorage.setItem('idjag_theme', theme);
      else localStorage.removeItem('idjag_theme');
    } catch { /* ignore */ }
  }, [theme]);

  useEffect(() => {
    applyFontSize(fontStep);
    try { localStorage.setItem('ilr.font', fontStep); } catch { /* ignore */ }
  }, [fontStep]);

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
    <div className={`app${presenter ? ' app--presenter' : ''}`}>
      <header className="shell-bar">
        <span className="shell-brand">Tarun ID-JAG Runner <small>real PingFederate</small></span>
        <nav className="shell-nav" aria-label="Sections">
          {TABS.map((t) => (
            <button key={t.id} aria-current={tab === t.id ? 'page' : undefined} onClick={() => setTab(t.id)}>
              {t.label}
            </button>
          ))}
        </nav>
        <TopMenu
          theme={{ value: theme, onChange: setTheme }}
          fontSize={{ value: fontStep, onChange: setFontStep }}
          help={{ href: 'https://github.com/curtismu7/idjag-runner-LAB#readme' }}
          version={info?.version || null}
          onReset={reset}
          extra={<span className="shell-runtime" title="Configured PingFederate runtime">{runtimeUrl}</span>}
          present={{ active: presenter, onToggle: () => setPresenter((v) => !v) }}
          talkTrack={{ active: tab === 'talk', onToggle: () => setTab('talk') }}
        >
          <ShelfLink headers={{ 'X-Lab-Workspace': WORKSPACE }} />
        </TopMenu>
      </header>
      <main className="page">
        {presenter && tab !== 'talk' ? (
          <aside className="presenter-say" aria-label="Talk track">
            {sayFor(sayLines, tab).map((l, i) => (
              <p key={i} className={/^\d+\./.test(l) ? 'talk__step' : ''}>{l}</p>
            ))}
          </aside>
        ) : null}
        {tab === 'flow' ? <FlowTab key={`flow-${resetCount}`} /> : null}
        {tab === 'trace' ? <TraceTab key={`trace-${resetCount}`} /> : null}
        {tab === 'jwks' ? <InspectorTab runtimeUrl={runtimeUrl} onRuntimeChanged={setRuntimeUrl} /> : null}
        {tab === 'diagram' ? <DiagramTab /> : null}
        {tab === 'about' ? <AboutTab /> : null}
        {tab === 'talk' ? <TalkTrackTab /> : null}
      </main>
    </div>
  );
}
