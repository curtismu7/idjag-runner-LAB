import React from 'react';
import { Banner } from './components.jsx';

// The original SE guide, embedded exactly as written, plus direct downloads for the two
// Postman collections it references. Use this tab to set up PingFederate and Postman for the
// ID-JAG demo; use the Flow tab for the no-Postman version of the same demo.

const FILES = [
  {
    href: '/idjag-se-guide.html',
    name: 'PingFederate-IDJAG-SE-Guide.html',
    desc: 'The full SE guide (opens in a new tab) — prerequisites, setup steps, run sheet, troubleshooting.',
  },
  {
    href: '/PingFederate-IDJAG-Setup.postman_collection.json',
    name: 'PingFederate-IDJAG-Setup.postman_collection.json',
    desc: 'Builds everything on your PingFederate through the admin API, verifies it end to end, and tears it all down again. Run this once before anything else.',
  },
  {
    href: '/PingFederate-IDJAG-Demo.postman_collection.json',
    name: 'PingFederate-IDJAG-Demo.postman_collection.json',
    desc: 'The customer-facing demo: 15 narrated steps in 5 acts, with decoded tokens and "PF refuses this" steps.',
  },
];

export default function SeGuideTab() {
  return (
    <div>
      <Banner />
      <h1>Set up PingFederate + Postman</h1>
      <p className="card-sub">
        This tab is the original SE guide, unchanged — use it to set up PingFederate and Postman for the
        ID-JAG demo. The <strong>Flow</strong> tab in this app runs the same demo without Postman, against the
        same <code className="mono">idjag-*</code> objects the Setup collection builds.
      </p>

      <h2 className="section-label">Downloads</h2>
      <dl className="kv">
        {FILES.map((f) => (
          <React.Fragment key={f.href}>
            <dt>
              <a className="mono" href={f.href} download={f.name}>{f.name}</a>
            </dt>
            <dd>{f.desc}</dd>
          </React.Fragment>
        ))}
      </dl>
      <p className="card-sub">
        Postman: Import each downloaded JSON (drag it into Postman), then follow the guide's step 2.
        Settings → General → SSL certificate verification OFF.
      </p>

      <h2 className="section-label">The guide</h2>
      <iframe
        src="/idjag-se-guide.html"
        title="ID-JAG on PingFederate: SE guide"
        style={{ width: '100%', height: '78vh', border: '1px solid var(--border)', borderRadius: '8px', background: '#fff' }}
      />
    </div>
  );
}
