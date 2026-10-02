import { useSyncExternalStore } from 'react';
import { wFetch } from './api.js';

// The wallet, kept fresh, for anything that needs to know what the balance is.
//
// The balance moves for reasons a screen never sees — a campaign worker
// debiting per message, a Razorpay callback crediting a top-up, a refund for
// messages that never sent. So this refreshes on all four of the signals the
// app already had scattered across components:
//
//   - the `wallet:balance-updated` event other code already dispatches after a
//     recharge or a campaign launch (it may carry the new balance, in which
//     case the number updates instantly and the refetch still confirms it);
//   - the tab regaining focus, since a background campaign spends money while
//     the user is elsewhere;
//   - a slow poll, as the backstop for a long-lived open tab (skipped while
//     the tab is hidden);
//   - an explicit refresh() for callers that just changed something.
//
// `status`, `lowBalanceThreshold` and `messagesRemaining` are computed by the
// server (services/wallet.service.js) rather than here, so the sidebar, the
// banners and the campaign launcher cannot drift into disagreeing about
// whether a wallet is low.
//
// Every component that calls useWallet() shares one store, one poll and one
// request in flight — the sidebar and the home banners used to poll the same
// endpoint independently.
const POLL_MS = 60000;
let snapshot = { wallet: null, loading: true };
let inFlight = null;
let teardown = null;
const listeners = new Set();

const emit = (patch) => {
  snapshot = { ...snapshot, ...patch };
  listeners.forEach((l) => l());
};

function load() {
  if (inFlight) return inFlight;
  inFlight = wFetch('/wallet')
    .then((r) => (r.ok ? r.json() : null))
    .then((d) => { if (d) emit({ wallet: d }); return d; })
    .catch(() => null)
    .finally(() => { inFlight = null; if (snapshot.loading) emit({ loading: false }); });
  return inFlight;
}

function start() {
  load();
  const visible = () => document.visibilityState !== 'hidden';
  const onBalanceUpdated = (e) => {
    // The event often carries the authoritative post-transaction balance.
    // Showing it immediately avoids a visible lag, but the status/threshold
    // still have to come from the server, so a refetch follows either way.
    const next = Number(e.detail);
    if (Number.isFinite(next) && snapshot.wallet) emit({ wallet: { ...snapshot.wallet, balance: next } });
    load();
  };
  const onFocus = () => { if (visible()) load(); };
  const iv = setInterval(() => { if (visible()) load(); }, POLL_MS);
  window.addEventListener('wallet:balance-updated', onBalanceUpdated);
  document.addEventListener('visibilitychange', onFocus);
  window.addEventListener('focus', onFocus);
  return () => {
    clearInterval(iv);
    window.removeEventListener('wallet:balance-updated', onBalanceUpdated);
    document.removeEventListener('visibilitychange', onFocus);
    window.removeEventListener('focus', onFocus);
  };
}

function subscribe(listener) {
  listeners.add(listener);
  if (!teardown) teardown = start();
  return () => {
    listeners.delete(listener);
    // Nobody is looking: stop polling, and forget the balance so a different
    // account signing in on this tab never sees the last one's figure.
    if (listeners.size === 0 && teardown) { teardown(); teardown = null; snapshot = { wallet: null, loading: true }; }
  };
}

const getSnapshot = () => snapshot;

// `enabled: false` (a super admin, who has no workspace wallet) neither
// subscribes nor fetches.
export function useWallet({ enabled = true } = {}) {
  const state = useSyncExternalStore(enabled ? subscribe : noopSubscribe, getSnapshot);
  return { wallet: state.wallet, loading: state.loading, refresh: load };
}

const noopSubscribe = () => () => {};

// Sends the user to the wallet and puts the cursor in the amount field.
//
// This used to only dispatch the cross-section nav event. On the Payments
// screen's own wallet tab — where this banner also renders — that navigates to
// the page already open, and the router returns early when the URL has not
// changed, so the button did nothing at all. Firing a second event that the
// recharge form listens for makes it work from both places: from elsewhere it
// navigates and then focuses, from here it just focuses.
export const goToRecharge = () => {
  window.dispatchEvent(new CustomEvent('app:nav', { detail: { section: 'payments', subTab: 'wallet' } }));
  // After the navigation has had a tick to render the wallet tab.
  setTimeout(() => window.dispatchEvent(new CustomEvent('wallet:focus-recharge')), 60);
};
