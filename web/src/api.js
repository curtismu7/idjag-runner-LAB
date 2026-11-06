const WORKSPACE_HEADER = 'X-Lab-Workspace';

function workspaceId() {
  // Per-tab workspace: each browser tab gets its own server-side session state, so
  // two tabs never share tokens. Kept in sessionStorage (per tab), never localStorage.
  let id = null;
  try { id = sessionStorage.getItem('idjag_workspace'); } catch { /* storage unavailable */ }
  if (!id || !/^[a-z0-9][a-z0-9-]{0,31}$/.test(id)) {
    id = `tab-${Math.random().toString(36).slice(2, 10)}`;
    try { sessionStorage.setItem('idjag_workspace', id); } catch { /* ignore */ }
  }
  return id;
}

export const WORKSPACE = workspaceId();

export class ApiError extends Error {
  constructor(status, body) {
    super(body?.message || `Request failed (HTTP ${status})`);
    this.status = status;
    this.body = body || {};
  }
}

export async function api(path, { method = 'GET', body } = {}) {
  const res = await fetch(path, {
    method,
    headers: {
      ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}),
      [WORKSPACE_HEADER]: WORKSPACE,
    },
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw new ApiError(res.status, json);
  return json;
}

export function truncateMiddle(text, head = 8, tail = 6) {
  const s = String(text ?? '');
  return s.length <= head + tail + 3 ? s : `${s.slice(0, head)}...${s.slice(-tail)}`;
}

export function relativeExpiry(claims, now = Date.now()) {
  if (!claims || typeof claims.exp !== 'number') return null;
  const seconds = Math.round(claims.exp - now / 1000);
  const abs = Math.abs(seconds);
  const unit = abs >= 3600 ? [Math.round(abs / 3600), 'hour'] : abs >= 60 ? [Math.round(abs / 60), 'minute'] : [abs, 'second'];
  return seconds >= 0 ? `expires in ${unit[0]} ${unit[1]}${unit[0] === 1 ? '' : 's'}` : `expired ${unit[0]} ${unit[1]}${unit[0] === 1 ? '' : 's'} ago`;
}

// Act 4 results are teaching payloads: a refusal is the expected, correct outcome.
export function isExpectedRefusal(result) {
  if (!result || typeof result !== 'object') return false;
  return result.expected === true && typeof result.pfError === 'string' && result.pfError.length > 0;
}
