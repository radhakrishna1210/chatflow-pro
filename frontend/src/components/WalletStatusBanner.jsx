import { I } from './Icons.jsx';
import { Btn } from './Btn.jsx';
import { useWallet, goToRecharge } from '../lib/useWallet.js';

const inr = (n) => `₹${Number(n || 0).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

// The three wallet states, with the copy they show. `status` is decided by the
// server from the balance and the workspace's own cost per message — nothing
// here re-derives it, so every placement of this banner says the same thing.
const STATES = {
  HEALTHY: {
    title: 'Wallet Status: Healthy',
    message: 'Your wallet balance is sufficient to continue using ChatFlow Pro.',
    icon: 'check',
    accent: 'var(--green)',
    bg: 'var(--gbg)',
    bd: 'var(--gbd)',
    action: false,
  },
  LOW: {
    title: 'Wallet Status: Low Balance',
    message: 'Your wallet balance is running low. Please add funds to continue your campaigns without interruption.',
    icon: 'alertt',
    accent: '#fbbf24',
    bg: 'rgba(245,158,11,.08)',
    bd: 'rgba(245,158,11,.25)',
    action: true,
  },
  EMPTY: {
    title: 'Wallet Status: Empty',
    message: 'Your wallet is empty. Please add funds to continue using ChatFlow Pro.',
    icon: 'alertt',
    accent: '#f87171',
    bg: 'rgba(239,68,68,.08)',
    bd: 'rgba(239,68,68,.25)',
    action: true,
  },
};

/**
 * Wallet status wherever the balance matters.
 *
 * Reads the live wallet through useWallet(), so it re-renders itself after a
 * recharge, a campaign debit or a refund without the host screen doing
 * anything.
 *
 * `hideWhenHealthy` is for screens that already state the balance plainly — the
 * campaign cost breakdown, the wallet page's own balance card. There, a
 * second "everything is fine" banner is noise; the warning states still show,
 * because those are the ones that need acting on.
 */
export default function WalletStatusBanner({ hideWhenHealthy = false, compact = false, style = {} }) {
  const { wallet, loading } = useWallet();

  // Nothing is shown until the real balance has arrived — a banner that
  // guesses would flash the wrong status on every page load.
  if (loading || !wallet) return null;

  const state = STATES[wallet.status] || STATES.HEALTHY;
  if (hideWhenHealthy && wallet.status === 'HEALTHY') return null;

  return (
    <div
      role={wallet.status === 'HEALTHY' ? undefined : 'alert'}
      style={{
        display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap',
        padding: compact ? '10px 14px' : '13px 16px',
        borderRadius: 10, background: state.bg, border: `1px solid ${state.bd}`,
        ...style,
      }}>
      <div style={{
        width: 30, height: 30, borderRadius: 8, flexShrink: 0,
        background: `${state.accent}14`, border: `1px solid ${state.accent}33`,
        display: 'flex', alignItems: 'center', justifyContent: 'center',
      }}>
        <I n={state.icon} s={15} c={state.accent} />
      </div>

      <div style={{ flex: 1, minWidth: 200 }}>
        <p style={{ fontSize: 13, fontWeight: 700, color: state.accent, marginBottom: 2 }}>{state.title}</p>
        {!compact && (
          <p style={{ fontSize: 12, color: 'var(--t2)', lineHeight: 1.5 }}>{state.message}</p>
        )}
      </div>

      <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexShrink: 0 }}>
        <div style={{ textAlign: 'right' }}>
          <p style={{ fontSize: 10, color: 'var(--t3)', textTransform: 'uppercase', letterSpacing: '.06em', fontWeight: 700 }}>Available</p>
          <p style={{ fontSize: 15, fontWeight: 700, color: 'var(--t1)', fontVariantNumeric: 'tabular-nums' }}>{inr(wallet.balance)}</p>
          {/* Runway, not just rupees — it is what makes "low" mean something. */}
          {wallet.messagesRemaining != null && wallet.status !== 'EMPTY' && (
            <p style={{ fontSize: 10.5, color: 'var(--t3)', marginTop: 1 }}>
              ≈ {wallet.messagesRemaining.toLocaleString('en-IN')} messages
            </p>
          )}
        </div>
        {state.action && (
          <Btn size="sm" onClick={goToRecharge} style={{ boxShadow: 'var(--glow)' }}>
            <I n="plus" s={13} c="#08090c" />
            Add Money
          </Btn>
        )}
      </div>
    </div>
  );
}
