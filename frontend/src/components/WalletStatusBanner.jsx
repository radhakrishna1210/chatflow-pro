import { I } from './Icons.jsx';
import { Btn } from './Btn.jsx';
import { useWallet, goToRecharge } from '../lib/useWallet.js';
import { useMessageRates, messagesForBalance } from '../lib/pricing.js';

const inr = (n) => `₹${Number(n || 0).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

// The three wallet states, with the copy they show. `status` is decided by the
// server from the balance and the workspace's own cost per message — nothing
// here re-derives it, so every placement of this banner says the same thing.
const STATES = {
  HEALTHY: {
    title: 'Wallet Status: Healthy',
    message: 'Your wallet balance is sufficient to continue using Svann.',
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
    message: 'Your wallet is empty. Please add funds to continue using Svann.',
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
  const rates = useMessageRates();

  // Nothing is shown until the real balance has arrived — a banner that
  // guesses would flash the wrong status on every page load.
  if (loading || !wallet) return null;

  const state = STATES[wallet.status] || STATES.HEALTHY;
  const runway = messagesForBalance(wallet.balance, rates);
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

      <div style={{ flex: '1 1 200px', minWidth: 0 }}>
        <p style={{ fontSize: 13, fontWeight: 700, color: state.accent, marginBottom: 2 }}>{state.title}</p>
        {!compact && (
          <p style={{ fontSize: 12, color: 'var(--t2)', lineHeight: 1.5 }}>{state.message}</p>
        )}
      </div>

      {/* Allowed to shrink and wrap: with flexShrink 0 the balance, the runway
          line and the Add Money button formed one unbreakable row wider than
          a phone, and the button ran out of the card. */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap', minWidth: 0, maxWidth: '100%', flex: '0 1 auto' }}>
        <div style={{ textAlign: 'right', minWidth: 0 }}>
          <p style={{ fontSize: 10, color: 'var(--t3)', textTransform: 'uppercase', letterSpacing: '.06em', fontWeight: 700 }}>Available</p>
          <p style={{ fontSize: 15, fontWeight: 700, color: 'var(--t1)', fontVariantNumeric: 'tabular-nums' }}>{inr(wallet.balance)}</p>
          {/* Runway, not just rupees — it is what makes "low" mean something.
              Campaigns are charged by template category, so the figure names
              its basis (marketing, the dearest) and the tooltip gives the
              rest, instead of one count at a flat rate no campaign pays. */}
          {runway && wallet.status !== 'EMPTY' && (
            <p
              style={{ fontSize: 10.5, color: 'var(--t3)', marginTop: 1 }}
              title={runway.map(([, label, n]) => `≈ ${n.toLocaleString('en-IN')} ${label.toLowerCase()} messages`).join('\n')}>
              ≈ {runway[0][2].toLocaleString('en-IN')} {runway[0][1].toLowerCase()} messages
              {runway[1] && ` · ${runway[1][2].toLocaleString('en-IN')} ${runway[1][1].toLowerCase()}`}
            </p>
          )}
        </div>
        {state.action && (
          <Btn size="sm" onClick={goToRecharge} style={{ boxShadow: 'var(--glow)' }}>
            <I n="plus" s={13} c="#05080f" />
            Add Money
          </Btn>
        )}
      </div>
    </div>
  );
}
