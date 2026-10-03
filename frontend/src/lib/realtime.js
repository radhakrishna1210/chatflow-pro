import { useCallback, useEffect, useRef, useState } from 'react';
import { wFetch } from './api.js';

// One live-updates connection per tab, shared by every screen that wants it.
//
// The server pushes small "this changed" events over Server-Sent Events
// (backend/src/services/realtime.service.js): a message arrived or changed
// status, a conversation was assigned, a campaign moved on, a template was
// approved. Screens refetch the affected data through the normal API — the
// events carry ids, never content — and poll only while the stream is down.
//
// EventSource cannot send the Authorization header, so each connection first
// fetches a one-minute stream token with the normal session and opens the
// stream with that. Reconnects are handled here rather than by EventSource
// itself, because its built-in retry would reuse an expired token: each
// attempt mints a fresh one, with exponential backoff and jitter. Anything
// missed while disconnected is not replayed; instead every screen gets a
// `resync` event once the stream is back, and refetches.
//
// Status, as screens see it:
//   live    — connected; push is authoritative, no polling needed
//   paused  — closed on purpose while the tab is hidden (it reconnects and
//             resyncs as soon as the tab is shown); counts as live
//   connecting / down / off / idle — poll instead

const EVENT_TYPES = [
  'message.created',
  'message.status',
  'conversation.updated',
  'campaign.updated',
  'template.updated',
  'resync',
];

// A hidden tab keeps its stream briefly (switching tabs is common), then lets
// it go: each open stream holds a server connection, and over HTTP/1.1 one of
// the browser's six per-host connections.
const HIDDEN_GRACE_MS = 60_000;
// Released this long after the last screen using it unmounts, so moving
// between Inbox and Campaigns does not tear the stream down and rebuild it.
const IDLE_RELEASE_MS = 5_000;
const MAX_BACKOFF_MS = 30_000;
// The server closes the oldest stream when a user opens too many. Coming
// straight back would just evict another tab, so wait.
const EVICTED_RETRY_MS = 60_000;

const listeners = new Set();
const statusListeners = new Set();
let status = 'idle';
let source = null;
let connecting = false;
let generation = 0;
let attempt = 0;
let everLive = false;
let disabled = false;
let retryTimer = null;
let hiddenTimer = null;
let releaseTimer = null;
let visibilityBound = false;

function setStatus(next) {
  if (status === next) return;
  status = next;
  for (const fn of [...statusListeners]) fn(next);
}

function emit(event) {
  for (const fn of [...listeners]) {
    try { fn(event); } catch (err) { console.error('[realtime] listener failed:', err); }
  }
}

function closeSource() {
  if (source) { source.close(); source = null; }
}

function scheduleReconnect(delayMs) {
  clearTimeout(retryTimer);
  if (listeners.size === 0 || disabled) return;
  const backoff = Math.min(MAX_BACKOFF_MS, 1000 * 2 ** attempt);
  const wait = delayMs ?? Math.round(backoff * (0.5 + Math.random() * 0.5));
  attempt = Math.min(attempt + 1, 10);
  retryTimer = setTimeout(connect, wait);
}

async function connect() {
  clearTimeout(retryTimer);
  if (source || connecting || listeners.size === 0 || disabled) return;
  if (typeof window === 'undefined' || typeof window.EventSource === 'undefined') {
    disabled = true;
    setStatus('off');
    return;
  }
  // A hidden tab connects when it is shown (see onVisibility).
  if (document.visibilityState === 'hidden') { setStatus('paused'); return; }

  connecting = true;
  const gen = generation;
  if (status !== 'paused') setStatus(everLive ? 'down' : 'connecting');

  let token;
  let workspaceId;
  try {
    const res = await wFetch('/realtime/token');
    const body = await res.json().catch(() => ({}));
    if (res.status === 503 && body.code === 'REALTIME_DISABLED') {
      connecting = false;
      disabled = true;
      setStatus('off');
      return;
    }
    if (!res.ok || !body.token) throw new Error(body.error || `HTTP ${res.status}`);
    ({ token, workspaceId } = body);
  } catch {
    connecting = false;
    if (gen !== generation) return;
    setStatus('down');
    scheduleReconnect();
    return;
  }
  connecting = false;
  if (gen !== generation || listeners.size === 0) return;

  const es = new window.EventSource(
    `/api/v1/workspaces/${encodeURIComponent(workspaceId)}/realtime/stream?token=${encodeURIComponent(token)}`,
  );
  source = es;

  es.addEventListener('ready', () => {
    if (source !== es) return;
    attempt = 0;
    const reconnected = everLive;
    everLive = true;
    setStatus('live');
    if (reconnected) emit({ type: 'resync', data: {} });
  });

  for (const type of EVENT_TYPES) {
    es.addEventListener(type, (e) => {
      if (source !== es) return;
      let data = {};
      try { data = JSON.parse(e.data || '{}'); } catch { /* keep {} */ }
      emit({ type, data, id: e.lastEventId || null });
    });
  }

  // The server ended this stream on purpose: its lifetime is up, or it is
  // restarting. Straight back, with a new token.
  es.addEventListener('reconnect', () => {
    if (source !== es) return;
    closeSource();
    attempt = 0;
    setStatus('down');
    scheduleReconnect(250 + Math.round(Math.random() * 1000));
  });

  es.addEventListener('evicted', () => {
    if (source !== es) return;
    closeSource();
    setStatus('down');
    scheduleReconnect(EVICTED_RETRY_MS);
  });

  es.onerror = () => {
    if (source !== es) return;
    // EventSource would retry on its own with the same, soon expired, token.
    closeSource();
    setStatus('down');
    scheduleReconnect();
  };
}

function stop() {
  generation += 1;
  clearTimeout(retryTimer);
  clearTimeout(hiddenTimer);
  closeSource();
  connecting = false;
  attempt = 0;
  everLive = false;
  setStatus('idle');
}

function onVisibility() {
  if (listeners.size === 0) return;
  if (document.visibilityState === 'hidden') {
    clearTimeout(hiddenTimer);
    hiddenTimer = setTimeout(() => {
      if (document.visibilityState !== 'hidden' || !source) return;
      generation += 1;
      clearTimeout(retryTimer);
      closeSource();
      setStatus('paused');
    }, HIDDEN_GRACE_MS);
  } else {
    clearTimeout(hiddenTimer);
    if (!source && !connecting) {
      attempt = 0;
      connect();
    }
  }
}

function addListener(fn) {
  listeners.add(fn);
  clearTimeout(releaseTimer);
  if (!visibilityBound && typeof document !== 'undefined') {
    document.addEventListener('visibilitychange', onVisibility);
    visibilityBound = true;
  }
  if (!source && !connecting && !disabled) connect();
  return () => {
    listeners.delete(fn);
    if (listeners.size === 0) {
      clearTimeout(releaseTimer);
      releaseTimer = setTimeout(() => { if (listeners.size === 0) stop(); }, IDLE_RELEASE_MS);
    }
  };
}

// Subscribes the calling component to live events for as long as it is
// mounted. `onEvent({ type, data })` — the latest one passed is always used,
// so it needs no memoising. Returns `live`: true while push can be trusted,
// so the caller polls only when it is false.
export function useRealtime(onEvent) {
  const handler = useRef(onEvent);
  handler.current = onEvent;
  const [state, setState] = useState(status);

  useEffect(() => {
    const off = addListener((event) => handler.current?.(event));
    statusListeners.add(setState);
    setState(status);
    return () => {
      statusListeners.delete(setState);
      off();
    };
  }, []);

  return { live: state === 'live' || state === 'paused', status: state };
}

// Leading-and-trailing throttle for refetches driven by events: the first
// event refetches at once, a burst after it costs one more refetch at the end
// of the window, never one per event.
export function useThrottledCallback(fn, ms) {
  const fnRef = useRef(fn);
  fnRef.current = fn;
  const state = useRef({ last: 0, timer: null });

  useEffect(() => () => clearTimeout(state.current.timer), []);

  return useCallback(() => {
    const s = state.current;
    if (s.timer) return;
    const wait = s.last + ms - Date.now();
    if (wait <= 0) {
      s.last = Date.now();
      fnRef.current();
      return;
    }
    s.timer = setTimeout(() => {
      s.timer = null;
      s.last = Date.now();
      fnRef.current();
    }, wait);
  }, [ms]);
}
