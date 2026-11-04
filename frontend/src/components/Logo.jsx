/* Single source of truth for the Svann brand mark, so the ring mark and
   wordmark are identical everywhere they appear (sidebar, resource centre
   footer). Mirrors the treatment used in the dashboard sidebar header. */
export function Logo({
  size = 32,           // px, the hit area around the pulse dot
  text = true,         // render the "Svann" wordmark alongside
  textSize,            // px, defaults to a size-relative value
  onClick,
  style = {},
  ariaLabel = 'Svann',
}) {
  // Svann's mark: a teal ring with a mint dot at its centre.
  const ring = Math.max(16, Math.round(size * 0.72));
  const dot = Math.max(6, Math.round(ring * 0.32));
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
          style={{
            width: ring,
            height: ring,
            borderRadius: '50%',
            border: '1.5px solid rgba(var(--violet-rgb),0.75)',
            background: 'rgba(var(--violet-rgb),0.10)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
          }}
        >
          <span
            className="sp-pulse"
            style={{
              width: dot,
              height: dot,
              borderRadius: '50%',
              background: 'var(--accent)',
              boxShadow: '0 0 10px var(--accent)',
            }}
          />
        </span>
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
          Svann
        </span>
      )}
    </div>
  );
}

export default Logo;
