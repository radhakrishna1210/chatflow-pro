/* Single source of truth for the Spandan brand mark, so the pulse dot and
   wordmark are identical everywhere they appear (sidebar, resource centre
   footer). Mirrors the treatment used in the dashboard sidebar header. */
export function Logo({
  size = 32,           // px, the hit area around the pulse dot
  text = true,         // render the "Spandan" wordmark alongside
  textSize,            // px, defaults to a size-relative value
  onClick,
  style = {},
  ariaLabel = 'Spandan',
}) {
  const dot = Math.max(9, Math.round(size * 0.32));
  return (
    <div
      onClick={onClick}
      role={onClick ? 'button' : undefined}
      aria-label={onClick ? ariaLabel : undefined}
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: 10,
        cursor: onClick ? 'pointer' : 'default',
        ...style,
      }}
    >
      <span
        style={{
          width: size,
          height: size,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          flexShrink: 0,
        }}
      >
        <span
          className="sp-pulse"
          style={{
            width: dot,
            height: dot,
            borderRadius: '50%',
            background: 'var(--accent)',
            boxShadow: '0 0 12px var(--accent)',
          }}
        />
      </span>
      {text && (
        <span
          style={{
            fontFamily: "'Space Grotesk', sans-serif",
            fontWeight: 700,
            fontSize: textSize || Math.round(size * 0.5),
            color: 'var(--t1)',
            letterSpacing: '-0.02em',
            whiteSpace: 'nowrap',
          }}
        >
          Spandan
        </span>
      )}
    </div>
  );
}

export default Logo;
