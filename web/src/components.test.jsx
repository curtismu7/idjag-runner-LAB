import { describe, it, expect, beforeEach } from 'vitest';
import React from 'react';
import { render, screen, cleanup } from '@testing-library/react';
import { TraceSteps } from './components.jsx';
import { setJsonView } from './components/JsonPane.jsx';

const bigString = 'x'.repeat(500 * 1024);

beforeEach(() => { cleanup(); setJsonView('form'); });

describe('TraceSteps hostile fixtures', () => {
  it('renders nothing for a non-array or empty steps value', () => {
    expect(render(<TraceSteps steps={null} />).container.querySelector('[data-testid="trace-list"]')).toBeNull();
    cleanup();
    expect(render(<TraceSteps steps={undefined} />).container.querySelector('[data-testid="trace-list"]')).toBeNull();
    cleanup();
    expect(render(<TraceSteps steps={[]} />).container.querySelector('[data-testid="trace-list"]')).toBeNull();
  });

  it('skips null steps, shapeless objects and null request/response without crashing', () => {
    const steps = [
      null,
      {},
      { id: 's1', title: 'no request/response' },
      { id: 's2', title: 'null bodies', request: null, response: null },
      { id: 's3', title: 'real hop', request: { method: 'POST', url: 'https://pf.example', headers: {} }, response: { status: 500, body: { error: bigString } } },
      undefined,
    ];
    render(<TraceSteps steps={steps} />);
    const list = screen.getByTestId('trace-list');
    expect(list.querySelectorAll('details').length).toBe(4);
    expect(screen.getByText('real hop')).toBeTruthy();
    expect(screen.getByText('500')).toBeTruthy();
    expect(screen.getByText('refused')).toBeTruthy();
  });

  it("shows each hop's request and response through the shared JsonPane, status marked hot", () => {
    const steps = [{ id: 'h', title: 'hop', request: { method: 'POST', url: 'https://pf.example/as/token.oauth2', headers: { Accept: 'application/json' } }, response: { status: 200, body: { token_type: 'Bearer' } } }];
    const { container } = render(<TraceSteps steps={steps} />);
    const boxes = container.querySelectorAll('.jsonbox');
    expect([...boxes].map((b) => b.querySelector('.json').getAttribute('aria-label'))).toEqual(['Request', 'Response']);
    expect(container.querySelector('pre')).toBeNull(); // Form view: no hand-rolled pre
    expect([...container.querySelectorAll('.jform__row[data-hot="true"] .jform__k')].map((k) => k.textContent)).toContain('status');
  });

  it('survives a 500 KB string claim without crashing or freezing', () => {
    const steps = [{ id: 'big', title: 'big body', response: { status: 200, body: { blob: bigString } } }];
    render(<TraceSteps steps={steps} />);
    expect(screen.getByTestId('trace-list').querySelectorAll('details').length).toBe(1);
  });
});
