// Tab-scoped impersonation.
//
// The signed-in session lives in localStorage (accessToken, refreshToken,
// user), which every tab shares. Writing a customer's tokens there while a
// super admin impersonated them silently turned every other open admin tab
// into the customer too — with no banner and no way back.
//
// Instead, an impersonation lives in *this tab's* sessionStorage, and while it
// does, reads and writes of those three keys on localStorage are redirected to
// it. The rest of the app keeps calling localStorage as it always has; other
// tabs, and the admin's own stored session, are never touched. Ending the
// impersonation removes the overlay and the tab is the admin again.

const SESSION_KEYS = new Set(['accessToken', 'refreshToken', 'user']);
const MARKER = 'impersonation';
const PREFIX = 'impersonation:';

let installed = false;

function rawSession() {
  return window.sessionStorage;
}

export function installTabSessionOverlay() {
  if (installed || typeof Storage === 'undefined') return;
  installed = true;
  const proto = Storage.prototype;
  const { getItem, setItem, removeItem } = proto;

  const redirected = (store, key) => store === window.localStorage
    && SESSION_KEYS.has(key)
    && getItem.call(rawSession(), MARKER) !== null;

  proto.getItem = function patchedGetItem(key) {
    return redirected(this, key) ? getItem.call(rawSession(), PREFIX + key) : getItem.call(this, key);
  };
  proto.setItem = function patchedSetItem(key, value) {
    return redirected(this, key) ? setItem.call(rawSession(), PREFIX + key, value) : setItem.call(this, key, value);
  };
  proto.removeItem = function patchedRemoveItem(key) {
    return redirected(this, key) ? removeItem.call(rawSession(), PREFIX + key) : removeItem.call(this, key);
  };
}

// Installed on import; main.jsx imports this module before anything else.
installTabSessionOverlay();

// { impersonatorId, expiresAt, targetEmail } while this tab impersonates.
export function impersonationInfo() {
  try {
    return JSON.parse(rawSession().getItem(MARKER) || 'null');
  } catch {
    return null;
  }
}

export function startImpersonation({ accessToken, user, impersonation }) {
  const s = rawSession();
  s.setItem(MARKER, JSON.stringify({ ...(impersonation || {}), targetEmail: user?.email ?? null }));
  s.setItem(PREFIX + 'accessToken', accessToken);
  s.removeItem(PREFIX + 'refreshToken');
  s.setItem(PREFIX + 'user', JSON.stringify(user));
}

export function endImpersonation() {
  const s = rawSession();
  for (const key of SESSION_KEYS) s.removeItem(PREFIX + key);
  s.removeItem(MARKER);
  // Left over from the old localStorage-swapping implementation.
  s.removeItem('impersonatorSession');
}
