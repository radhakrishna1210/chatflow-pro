import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { site, faq, pages } from './src/content/marketing.js';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

// Structured data and social cards are generated from src/content/marketing.js
// at build time, so the JSON-LD always describes exactly the FAQ and copy the
// page renders (search engines penalise markup that doesn't match the page),
// and the sitemap lists exactly the public routes that exist.
const escapeAttr = (v) => String(v).replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;');
// JSON inside <script> must not be able to close the tag.
const jsonForScript = (v) => JSON.stringify(v).replace(/</g, '\\u003c');

function seoPlugin(mode) {
  const origin = (process.env.VITE_SITE_URL || site.url).replace(/\/$/, '');
  return {
    name: 'svann-seo',
    transformIndexHtml(html) {
      const title = `${site.name} — ${site.tagline}`;
      const ld = [
        {
          '@context': 'https://schema.org',
          '@type': 'Organization',
          name: site.name,
          url: origin,
          logo: `${origin}/favicon.svg`,
        },
        {
          '@context': 'https://schema.org',
          '@type': 'SoftwareApplication',
          name: site.name,
          applicationCategory: 'BusinessApplication',
          operatingSystem: 'Web',
          description: site.description,
          url: origin,
          offers: { '@type': 'Offer', price: '0', priceCurrency: 'INR', description: 'Free plan, no card required' },
          featureList: [
            'WhatsApp Business API campaigns',
            'Campaign AI agent that answers replies',
            'Shared team inbox',
            'Visual automation workflows',
            'Built-in sales CRM: leads, deals, quotes, forecasts',
            'Wallet billing at Meta per-message rates',
          ],
        },
        {
          '@context': 'https://schema.org',
          '@type': 'FAQPage',
          mainEntity: faq.map(({ q, a }) => ({ '@type': 'Question', name: q, acceptedAnswer: { '@type': 'Answer', text: a } })),
        },
      ];
      const head = [
        `<title>${escapeAttr(title)}</title>`,
        `<meta name="description" content="${escapeAttr(site.description)}" />`,
        `<link rel="canonical" href="${origin}/" />`,
        `<meta name="theme-color" content="#0a0b0e" />`,
        `<meta name="application-name" content="${escapeAttr(site.name)}" />`,
        `<meta property="og:type" content="website" />`,
        `<meta property="og:site_name" content="${escapeAttr(site.name)}" />`,
        `<meta property="og:title" content="${escapeAttr(title)}" />`,
        `<meta property="og:description" content="${escapeAttr(site.description)}" />`,
        `<meta property="og:url" content="${origin}/" />`,
        `<meta property="og:image" content="${origin}/og-image.png" />`,
        `<meta property="og:image:width" content="1200" />`,
        `<meta property="og:image:height" content="630" />`,
        `<meta property="og:locale" content="${site.locale}" />`,
        `<meta name="twitter:card" content="summary_large_image" />`,
        `<meta name="twitter:title" content="${escapeAttr(title)}" />`,
        `<meta name="twitter:description" content="${escapeAttr(site.description)}" />`,
        `<meta name="twitter:image" content="${origin}/og-image.png" />`,
        `<script type="application/ld+json">${jsonForScript(ld)}</script>`,
      ].join('\n  ');
      return html.replace('<!--seo-->', head);
    },
    generateBundle() {
      if (mode !== 'production') return;
      const today = new Date().toISOString().slice(0, 10);
      const urls = pages.map((p) => `  <url>\n    <loc>${origin}${p.path}</loc>\n    <lastmod>${today}</lastmod>\n    <changefreq>${p.changefreq}</changefreq>\n    <priority>${p.priority.toFixed(1)}</priority>\n  </url>`).join('\n');
      this.emitFile({ type: 'asset', fileName: 'sitemap.xml', source: `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls}\n</urlset>\n` });
      // robots.txt carries the origin in its Sitemap line, so it is emitted here too.
      this.emitFile({ type: 'asset', fileName: 'robots.txt', source: ROBOTS(origin) });
    },
  };
}

const ROBOTS = (origin) => `# ${site.name}
User-agent: *
Allow: /

# The authenticated app has nothing useful to a crawler and should never be
# indexed — these paths require a session and return the SPA shell to anyone
# else.
Disallow: /dashboard
Disallow: /resources
Disallow: /setup
Disallow: /login
Disallow: /register
Disallow: /forgot-password
Disallow: /auth/
Disallow: /oauth/
Disallow: /invite/
Disallow: /api/

# Public lead-capture forms are per-customer pages, not our content.
Disallow: /forms/

Sitemap: ${origin}/sitemap.xml
`;

export default defineConfig(({ mode }) => ({
  plugins: [react(), seoPlugin(mode)],
  build: {
    rollupOptions: {
      output: {
        // Recharts is only needed on the two analytics screens, and React
        // itself changes far less often than app code. Splitting both out
        // keeps the entry chunk small and lets them stay cached across
        // deploys instead of being re-downloaded with every app change.
        // Only Recharts is worth separating. React is needed on first paint
        // either way, so splitting it saved nothing and cost an extra
        // request; Recharts is used by two screens and is half the bundle.
        manualChunks: {
          charts: ['recharts'],
        },
      },
    },
  },
  server: {
    port: 5173,
    // Landing.jsx imports the site copy from backend/src/data/siteContent.js —
    // one source of truth shared with the assistant's indexer. That path is
    // outside this package, so the dev server has to be told it may serve it.
    // Vite infers the same root from the repo lockfile today, but relying on
    // that inference means a lockfile move breaks `npm run dev` with a
    // confusing 403 instead of an error that names the cause.
    fs: { allow: [repoRoot] },
    proxy: {
      '/api': {
        target: 'http://127.0.0.1:4000',
        changeOrigin: true,
      },
    },
  },
  preview: {
    port: 5173,
  },
}));
