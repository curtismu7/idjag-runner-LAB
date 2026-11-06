import crypto from 'node:crypto';

// Server-side flow sessions, in memory only. The browser holds an unguessable id in an HttpOnly, SameSite=Strict
// cookie; tokens, the ID-JAG and trace runs live here and never leave the server. Client secrets are held only in
// memory, per session, and are never echoed in any response, trace or log.

export const COOKIE = 'idjag_sid';
const ID = /^[A-Za-z0-9_-]{43}$/;
// Workspaces: the page sends its workspace id in this header. A workspace has its own sessions and state.
export const WORKSPACE_HEADER = 'x-lab-workspace';
export const DEFAULT_WORKSPACE = 'default';
const WORKSPACE = /^[a-z0-9][a-z0-9-]{0,31}$/;
export const validWorkspace = (value) => typeof value === 'string' && WORKSPACE.test(value);
export const MAX_SESSIONS = 200;
export const IDLE_TTL_MS = 8 * 60 * 60 * 1000;

export function emptyState() {
  // tokens hold the session's issued values; secrets hold per-client secrets write-only.
  return { tokens: {}, idJag: null, lastTrace: [], secrets: {} };
}

export function createSessions({ now = Date.now, max = MAX_SESSIONS, secure = false } = {}) {
  const live = new Map();
  const keyOf = (id, workspace) => `${id}|${workspace}`;
  const sessionsOf = (id) => [...live.values()].filter((s) => s.id === id);

  function readWorkspace(headers) {
    const raw = headers[WORKSPACE_HEADER];
    if (raw === undefined) return DEFAULT_WORKSPACE;
    return validWorkspace(raw) ? raw : null;
  }

  function readId(header) {
    if (typeof header !== 'string' || header.length > 4096) return null;
    for (const part of header.split(';')) {
      const [name, ...rest] = part.trim().split('=');
      if (name === COOKIE) {
        const value = rest.join('=');
        return ID.test(value) ? value : null;
      }
    }
    return null;
  }

  const newId = () => crypto.randomBytes(32).toString('base64url');
  const setCookie = (res, id) => res.append('Set-Cookie', `${COOKIE}=${id}; HttpOnly; SameSite=Strict; Path=/${secure ? '; Secure' : ''}`);

  function evict() {
    while (live.size > max) live.delete(live.keys().next().value);
  }

  // A session is created only on a write (same-origin checks have run), never on a GET. A GET without a live
  // session gets an empty, unstored one.
  function middleware(req, res, next) {
    const workspace = readWorkspace(req.headers);
    if (!workspace) return res.status(400).json({ error: 'bad_workspace', message: 'The workspace id is lowercase letters, digits and hyphens (1 to 32 characters)' });
    let id = readId(req.headers.cookie);
    let session = id ? live.get(keyOf(id, workspace)) : null;
    if (session && now() - session.lastSeen > IDLE_TTL_MS) { live.delete(session.key); session = null; }
    if (!session) {
      if (req.method === 'GET' || req.method === 'HEAD') {
        req.session = { id: null, workspace, lastSeen: now(), ...emptyState() };
        return next();
      }
      if (!id || sessionsOf(id).length === 0) { id = newId(); setCookie(res, id); }
      session = { id, workspace, key: keyOf(id, workspace), lastSeen: now(), ...emptyState() };
    }
    session.lastSeen = now();
    live.delete(session.key);
    live.set(session.key, session);
    evict();
    req.session = session;
    return next();
  }

  function destroy(session) {
    live.delete(session.key);
    return sessionsOf(session.id).length === 0;
  }

  // Reset: clears tokens, the ID-JAG, traces and secrets for this session.
  function reset(session) {
    Object.assign(session, emptyState());
    return { ok: true };
  }

  const inWorkspace = (workspace) => [...live.values()].filter((s) => s.workspace === workspace);
  function resetWorkspace(workspace) {
    const targets = [...live.values()].filter((s) => s.workspace === workspace);
    for (const s of targets) reset(s);
    return { sessionsReset: targets.length };
  }

  const clear = () => live.clear();

  return { middleware, destroy, reset, resetWorkspace, inWorkspace, clear, size: () => live.size };
}
