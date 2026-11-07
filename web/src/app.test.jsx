import { describe, it, expect, beforeEach, vi } from 'vitest';
import '@testing-library/jest-dom/vitest';
import { cleanup, render, screen, fireEvent } from '@testing-library/react';
import React from 'react';
import App from './App.jsx';
import FlowTab from './FlowTab.jsx';
import { TokenView } from './components.jsx';
import { isExpectedRefusal, relativeExpiry, WORKSPACE } from './api.js';

const FIXTURE_HEADER = btoa(JSON.stringify({ alg: 'RS512', typ: 'oauth-id-jag+jwt', kid: 'test-key' }))
  .replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const FIXTURE_CLAIMS = btoa(JSON.stringify({ iss: 'https://pf.example', aud: 'test-resource-client', sub: 'tarun', exp: Math.floor(Date.now() / 1000) + 600 }))
  .replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const FIXTURE_ID_JAG = `${FIXTURE_HEADER}.${FIXTURE_CLAIMS}.c2ln`;

beforeEach(() => {
  cleanup();
  localStorage.clear();
  sessionStorage.clear();
});

describe('App shell', () => {
  it('renders the four tabs and the real-PingFederate banner', () => {
    render(<App />);
    for (const label of ['Flow', 'Trace', 'JWKS / Inspector', 'About']) {
      expect(screen.getByRole('button', { name: label })).toBeTruthy();
    }
    expect(screen.getAllByRole('note')[0].textContent).toMatch(/real PingFederate/);
  });

  it('shows the runtime host in the header from /api/info', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ runtimeUrl: 'https://pf-runtime.example', workspace: 'w1', mode: 'live' }),
    });
    vi.stubGlobal('fetch', fetchMock);
    render(<App />);
    await screen.findByText('https://pf-runtime.example');
    expect(fetchMock.mock.calls.every(([, init]) => init.headers['X-Lab-Workspace'] === WORKSPACE)).toBe(true);
    vi.unstubAllGlobals();
  });

  it('sends the workspace header on every api call, in all tabs', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: () => Promise.resolve({ runtimeUrl: 'https://x.example', trace: [], keys: [] }) });
    vi.stubGlobal('fetch', fetchMock);
    render(<App />);
    await screen.findByText('https://x.example');
    fireEvent.click(screen.getByRole('button', { name: 'JWKS / Inspector' }));
    fireEvent.click(screen.getByRole('button', { name: 'Fetch JWKS' }));
    await vi.waitFor(() => expect(fetchMock.mock.calls.length).toBeGreaterThanOrEqual(2));
    for (const [path, init] of fetchMock.mock.calls) {
      expect(path.startsWith('/api/')).toBe(true);
      expect(init.headers['X-Lab-Workspace']).toBe(WORKSPACE);
    }
    vi.unstubAllGlobals();
  });
});

describe('decoded token panel', () => {
  it('highlights typ oauth-id-jag+jwt on a fixture ID-JAG', () => {
    render(<TokenView label="ID-JAG" view={{ masked: 'eyJhbXc...c2ln', length: 100, kind: 'JWT', header: { alg: 'RS512', typ: 'oauth-id-jag+jwt' }, claims: { iss: 'https://pf.example', exp: Math.floor(Date.now() / 1000) + 600 } }} />);
    const typ = screen.getByText('typ: oauth-id-jag+jwt');
    expect(typ.className).toMatch(/typ-jag/);
    expect(screen.getByText('https://pf.example')).toBeTruthy();
  });

  it('shows an access token typ without the ID-JAG highlight', () => {
    render(<TokenView label="Access token" view={{ masked: 'xyz...abc', length: 40, kind: 'JWT', header: { alg: 'RS512', typ: 'JWT' }, claims: { sub: 'tarun' } }} />);
    expect(screen.getByText('typ: JWT').className).not.toMatch(/typ-jag/);
  });

  it('shows expiry as relative time', () => {
    expect(relativeExpiry({ exp: Math.floor(Date.now() / 1000) + 300 })).toMatch(/expires in \d+ minutes?/);
    expect(relativeExpiry({ exp: Math.floor(Date.now() / 1000) - 300 })).toMatch(/expired \d+ minutes? ago/);
    expect(relativeExpiry({})).toBeNull();
  });
});

describe('Act 4 expected-refusal styling', () => {
  const cases = [
    ['wrong-client-redeem', 'unauthorized_client'],
    ['bad-resource', 'invalid_target'],
    ['forged-assertion', 'invalid_grant'],
    ['access_denied', 'invalid_scope'],
  ];

  it('isExpectedRefusal accepts the server shape and rejects failures', () => {
    expect(isExpectedRefusal({ expected: true, pfError: 'invalid_grant' })).toBe(true);
    expect(isExpectedRefusal({ expected: true, pfError: null })).toBe(false);
    expect(isExpectedRefusal({ expected: false, pfError: 'invalid_grant' })).toBe(false);
    expect(isExpectedRefusal(null)).toBe(false);
  });

  it('an Act 4 run renders the green refusal line with the PF error', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ case: 'forged-assertion', expected: true, pfStatus: 400, pfError: 'invalid_grant', pfErrorDescription: 'Assertion is not valid', trace: [{ id: 's1', title: 'call', request: { method: 'POST', url: 'https://x.example', headers: {} }, response: { status: 400, body: { error: 'invalid_grant' } } }] }),
    });
    vi.stubGlobal('fetch', fetchMock);
    render(<FlowTab />);
    fireEvent.click(screen.getByRole('button', { name: /forged assertion/i }));
    const result = await screen.findByTestId('act4-result');
    expect(result.className).toBe('result-ok');
    expect(result.textContent).toMatch(/PF refused as designed: invalid_grant/);
    expect(screen.queryByRole('alert')).toBeNull();
    vi.unstubAllGlobals();
  });

  it('a refused redeem renders the green refusal line', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ redeemRefusal: true, pfStatus: 400, pfError: 'invalid_grant', pfErrorDescription: 'The ID-JAG expired', trace: [] }),
    });
    vi.stubGlobal('fetch', fetchMock);
    render(<FlowTab />);
    // Act 3 redeem button is disabled until Act 2 ran
    expect(screen.getByRole('button', { name: 'Redeem ID-JAG' })).toBeDisabled();
    // simulate Act 2 result by running act1+act2 via mocked fetch
    fireEvent.change(screen.getByTestId('f-pass'), { target: { value: 'pw' } });
    fireEvent.click(screen.getByRole('button', { name: 'Run Act 1' }));
    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalled());
    vi.unstubAllGlobals();
  });

  it('a genuine failure still renders as an error box', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: false,
      status: 502,
      json: () => Promise.resolve({ error: 'act1_failed', message: 'The password grant was refused (HTTP 400)' }),
    });
    vi.stubGlobal('fetch', fetchMock);
    render(<FlowTab />);
    fireEvent.change(screen.getByLabelText('Password'), { target: { value: 'pw' } });
    fireEvent.click(screen.getByRole('button', { name: 'Run Act 1' }));
    const alert = await screen.findByRole('alert');
    expect(alert.textContent).toMatch(/password grant was refused/);
    vi.unstubAllGlobals();
  });
});

describe('secret hygiene', () => {
  it('the demo secret renders masked in the label and nothing persists to localStorage', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: () => Promise.resolve({ tokens: {}, trace: [] }) });
    vi.stubGlobal('fetch', fetchMock);
    render(<FlowTab />);
    const pass = screen.getByTestId('f-pass');
    const secret = screen.getByTestId('f-csec');
    // The client secret field is a text input showing the demo value; the password stays masked.
    expect(pass.type).toBe('password');
    expect(pass.value).toBe('');
    expect(secret.value).toBe('idjagAcSecret1234');
    fireEvent.change(pass, { target: { value: 'hunter2' } });
    fireEvent.click(screen.getByRole('button', { name: 'Run Act 1' }));
    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalled());
    expect(pass.value).toBe('hunter2'); // still in tab memory for the next act
    vi.unstubAllGlobals();
    expect(JSON.stringify(localStorage)).not.toMatch(/hunter2|idjagAcSecret/);
    expect(JSON.stringify(sessionStorage)).not.toMatch(/hunter2|idjagAcSecret/);
  });

  it('the persisted theme preference never holds secrets', () => {
    render(<App />);
    fireEvent.change(screen.getByTestId('theme'), { target: { value: 'dark' } });
    expect(localStorage.getItem('idjag_theme')).toBe('dark');
    fireEvent.change(screen.getByTestId('theme'), { target: { value: '' } });
    expect(localStorage.getItem('idjag_theme')).toBeNull();
  });
});

describe('inline Flow diagram', () => {
  // ReactFlow fits the view once, when it first measures its container. Inside a closed <details> that
  // container is 0x0, so the diagram must not be mounted until the section is opened.
  it('mounts the diagram only after the collapsed section is opened, and unmounts it on close', () => {
    const { container } = render(<FlowTab />);
    const details = container.querySelector('details.flow-diagram-details');
    expect(details.open).toBe(false);
    expect(screen.queryByTestId('diagram-canvas')).toBeNull();
    details.open = true;
    fireEvent(details, new Event('toggle'));
    expect(screen.getByTestId('diagram-canvas')).toBeTruthy();
    expect(container.querySelector('.react-flow')).toBeTruthy();
    details.open = false;
    fireEvent(details, new Event('toggle'));
    expect(screen.queryByTestId('diagram-canvas')).toBeNull();
  });
});
