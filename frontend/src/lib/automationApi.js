import { wFetch } from './api.js';

// Every Automation call used to be written as `.then(r => r.ok && r.json())`
// with a `.catch()` meant to handle failures — but fetch *resolves* on 4xx, so
// a 403 PLAN_FEATURE_LOCKED (which is what the whole tab returns on the FREE
// plan) silently produced an empty tab and toggles that flipped without saving.
// This wrapper turns every response into an explicit outcome the UI can render.
export async function wJson(path, opts) {
  let res;
  try {
    res = await wFetch(path, opts);
  } catch (err) {
    return { ok: false, error: err.message || 'Network error', locked: false };
  }

  if (res.status === 204) return { ok: true, data: null, locked: false };

  const data = await res.json().catch(() => null);
  if (res.ok) return { ok: true, data, locked: false };

  return {
    ok: false,
    data,
    locked: data?.code === 'PLAN_FEATURE_LOCKED',
    feature: data?.feature,
    error: data?.error || `Request failed (${res.status})`,
  };
}
