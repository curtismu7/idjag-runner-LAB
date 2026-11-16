import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import '@testing-library/jest-dom/vitest';
import { cleanup, render, screen, within } from '@testing-library/react';
import React from 'react';
import App from './App.jsx';
import { WORKSPACE } from './api.js';

// The header shows this lab's own Verified / In progress mark, read from the same /api/shelf call the Shelf link makes (through the lab-proxy
// that call reaches the shelf, whose payload lists every demo with its mark). The lab's own /api/shelf has no demos, so there is no mark then.
const mark = (status, label, extra = {}) => ({ status, label, note: '', updatedAt: '2026-11-15', source: 'shipped', ...extra });
const json = (body) => Promise.resolve({ ok: true, json: () => Promise.resolve(body) });
let calls;
function withShelf(payload) {
  calls = [];
  vi.stubGlobal('fetch', vi.fn((url, init) => {
    calls.push([url, init]);
    return json(url === '/api/shelf' ? payload : { runtimeUrl: 'https://pf-runtime.example', trace: [], keys: [] });
  }));
}

beforeEach(() => { cleanup(); localStorage.clear(); sessionStorage.clear(); });
afterEach(() => { vi.unstubAllGlobals(); });

describe('verification mark in the header', () => {
  it("shows this lab's own mark beside the Shelf link, and no other lab's", async () => {
    withShelf({ shelfUrl: 'http://shelf.example', demos: [
      { id: 'other-lab', verification: mark('in-progress', 'In progress') },
      { id: 'idjag-runner', verification: mark('verified', 'Verified', { note: 'Every exchange run on the real PF' }) },
    ] });
    render(<App />);
    const bar = within(await screen.findByTestId('top-menu'));
    expect(await bar.findByText('Verified')).toBeInTheDocument();
    expect(bar.getByRole('link', { name: 'Shelf' })).toBeInTheDocument();
    expect(bar.queryByText('In progress')).toBeNull();
    expect(document.querySelectorAll('.verify')).toHaveLength(1);
    expect(bar.getByText('Verified').closest('.verify')).toHaveAttribute('title', expect.stringContaining('Every exchange run on the real PF'));
    // the lab's per-request workspace header rides on the badge's call too
    const shelfCalls = calls.filter(([u]) => u === '/api/shelf');
    expect(shelfCalls.length).toBeGreaterThanOrEqual(2);
    for (const [, init] of shelfCalls) expect(init.headers['X-Lab-Workspace']).toBe(WORKSPACE);
  });

  it('shows nothing when the lab is opened on its own port (its /api/shelf has no demos) or the shelf has no mark for it', async () => {
    for (const payload of [{ shelfUrl: 'http://shelf.example' }, { shelfUrl: 'http://shelf.example', demos: [{ id: 'idjag-runner', verification: null }] }]) {
      cleanup();
      withShelf(payload);
      render(<App />);
      const bar = within(await screen.findByTestId('top-menu'));
      expect(await bar.findByRole('link', { name: 'Shelf' })).toBeInTheDocument(); // the shelf answered, and still no badge
      expect(document.querySelector('.verify')).toBeNull();
    }
  });
});
