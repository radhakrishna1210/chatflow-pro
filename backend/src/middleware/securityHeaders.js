// Response security headers.
//
// There were none at all before this: no CSP, no X-Content-Type-Options, no
// X-Frame-Options, no HSTS, and Express advertised itself via X-Powered-By.
//
// The allow-lists below are the exact third parties the app actually loads —
// Google Fonts (index.html), the Facebook JS SDK (Embedded Signup, see
// NumberSetupView), and Razorpay Checkout (PaymentsView). Anything not listed
// here is blocked, so adding a new script/CDN means adding it here too.

const FB_SDK = 'https://connect.facebook.net';
const RAZORPAY = 'https://checkout.razorpay.com https://api.razorpay.com https://*.razorpay.com';
const GOOGLE_FONTS_CSS = 'https://fonts.googleapis.com';
const GOOGLE_FONTS_FILES = 'https://fonts.gstatic.com';

// `style-src` keeps 'unsafe-inline' deliberately: the entire UI is built from
// React inline `style={{…}}` props, which the browser applies as style
// attributes. Removing it would blank the whole application. Script sources
// carry no such escape hatch — those are locked to the three origins above.
const CSP = [
  "default-src 'self'",
  `script-src 'self' ${FB_SDK} ${RAZORPAY}`,
  `style-src 'self' 'unsafe-inline' ${GOOGLE_FONTS_CSS}`,
  `font-src 'self' data: ${GOOGLE_FONTS_FILES}`,
  // Meta serves template/media previews and profile images off a wide set of
  // fbcdn hosts, and generated header images arrive as data:/blob: URIs.
  "img-src 'self' data: blob: https:",
  `connect-src 'self' https://graph.facebook.com ${FB_SDK} ${RAZORPAY}`,
  `frame-src ${RAZORPAY} ${FB_SDK} https://www.facebook.com`,
  // Clickjacking: this app is never meant to be framed.
  "frame-ancestors 'none'",
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'self'",
].join('; ');

export function securityHeaders(req, res, next) {
  // MIME sniffing turns an uploaded "image" that is really HTML into stored XSS.
  res.setHeader('X-Content-Type-Options', 'nosniff');
  // Belt and braces with frame-ancestors above, for older browsers.
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  res.setHeader('Permissions-Policy', 'geolocation=(), microphone=(), camera=(), payment=(self)');
  res.setHeader('Cross-Origin-Opener-Policy', 'same-origin-allow-popups');

  // The embeddable widget is loaded *by* third-party sites, so a policy written
  // for this app's own pages does not apply to it — and frame-ancestors 'none'
  // would break the very thing it exists to do. Its own origin checks and rate
  // limits are what protect it (see routes/widgetPublic.routes.js).
  if (!req.path.startsWith('/widget/v1')) {
    res.setHeader('Content-Security-Policy', CSP);
  } else {
    res.removeHeader('X-Frame-Options');
  }

  // Only meaningful over TLS, and setting it in local http development would
  // pin localhost to https in the browser for a year.
  if (req.secure || req.headers['x-forwarded-proto'] === 'https') {
    res.setHeader('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
  }

  next();
}
