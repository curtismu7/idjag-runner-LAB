import '@testing-library/jest-dom/vitest';

// jsdom lacks ResizeObserver, which ReactFlow requires.
class ResizeObserverStub {
  observe() {}
  unobserve() {}
  disconnect() {}
}
window.ResizeObserver = window.ResizeObserver || ResizeObserverStub;

// Some Node versions expose a half-working global localStorage that shadows jsdom's.
if (typeof globalThis.localStorage?.clear !== 'function') {
  const store = new Map();
  Object.defineProperty(globalThis, 'localStorage', {
    configurable: true,
    value: { getItem: (k) => (store.has(k) ? store.get(k) : null), setItem: (k, v) => store.set(k, String(v)), removeItem: (k) => store.delete(k), clear: () => store.clear() },
  });
}
