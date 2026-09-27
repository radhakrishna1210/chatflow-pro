import fs from 'node:fs';
import path from 'node:path';
const root = process.argv[2];
const routesDir = path.join(root, 'backend/src/routes');
const idx = fs.readFileSync(path.join(routesDir, 'index.js'), 'utf8').split('\n// import')[0];
const imports = {};
for (const m of idx.matchAll(/import\s+(\w+)(?:,\s*\{([^}]*)\})?\s+from\s+'([^']+)'/g)) {
  imports[m[1]] = m[3];
  if (m[2]) for (const n of m[2].split(',')) { const nm = n.trim(); if (nm) imports[nm] = m[3] + '#' + nm; }
}
const mounts = [];
for (const m of idx.matchAll(/^(router|ws)\.use\('([^']+)',\s*(\w+)\)/gm)) {
  const prefix = (m[1] === 'ws' ? '/api/v1/workspaces/:workspaceId' : '/api/v1') + m[2];
  mounts.push({ prefix, name: m[3], file: imports[m[3]] });
}
mounts.push({ prefix: '/widget/v1', name: 'widgetPublicRoutes', file: './widgetPublic.routes.js' });
const out = [];
function parseRouterFile(file, prefix, exportName) {
  const src = fs.readFileSync(file, 'utf8').replace(/\/\*[\s\S]*?\*\//g, '').replace(/\r/g, '').split('\n').map(l => l.replace(/(^|\s)\/\/.*$/, '')).join('\n');
  const routerVars = [...src.matchAll(/const\s+(\w+)\s*=\s*(?:express\.)?Router\(/g)].map(m => m[1]);
  const globalMw = {};
  for (const rv of routerVars) globalMw[rv] = [];
  const re = /(\w+)\.(get|post|put|patch|delete|use|all)\(\s*(?:'([^']*)'|`([^`]*)`)?\s*,?([\s\S]*?)\);/g;
  let m;
  while ((m = re.exec(src))) {
    const rv = m[1]; if (!routerVars.includes(rv)) continue;
    const method = m[2]; const p = m[3] ?? m[4];
    const argsRaw = m[5];
    const lineNo = src.slice(0, m.index).split('\n').length;
    const args = []; let depth = 0, cur = '';
    for (const ch of argsRaw) { if ('([{'.includes(ch)) depth++; if (')]}'.includes(ch)) depth--; if (ch === ',' && depth === 0) { args.push(cur.trim()); cur = ''; } else cur += ch; }
    if (cur.trim()) args.push(cur.trim());
    const clean = args.map(a => a.replace(/\s+/g, ' ').slice(0, 80));
    if (method === 'use' && p === undefined) { globalMw[rv].push(...clean); continue; }
    if (method === 'use' && p !== undefined) {
      const sub = clean[clean.length - 1];
      if (routerVars.includes(sub)) { globalMw[sub] = [...(globalMw[rv] || []), ...clean.slice(0, -1)]; globalMw[sub + '__prefix'] = p; continue; }
      out.push({ method: 'USE', path: prefix + p, file: path.relative(root, file).replace(/\\/g, '/') + ':' + lineNo, mw: [...globalMw[rv], ...clean.slice(0, -1)].join(' | '), handler: sub });
      continue;
    }
    const handler = clean[clean.length - 1];
    const mw = [...(globalMw[rv] || []), ...clean.slice(0, -1)];
    const pfx = globalMw[rv + '__prefix'] ? prefix + globalMw[rv + '__prefix'] : prefix;
    out.push({ method: method.toUpperCase(), path: pfx + (p || ''), file: path.relative(root, file).replace(/\\/g, '/') + ':' + lineNo, mw: mw.join(' | '), handler, exportName });
  }
}
for (const mnt of mounts) {
  if (!mnt.file) continue;
  const [rel, exp] = mnt.file.split('#');
  const file = path.join(routesDir, rel.replace(/^\.\//, ''));
  parseRouterFile(file, mnt.prefix, exp || 'default');
}
out.push({ method: 'GET', path: '/api/v1/health', file: 'backend/src/routes/index.js', mw: '', handler: 'inline' });
out.push({ method: 'GET', path: '/api/v1/pricing', file: 'backend/src/routes/index.js', mw: '', handler: 'inline' });
out.push({ method: 'GET', path: '/api/v1/webhook/instagram', file: 'backend/src/routes/index.js', mw: '', handler: 'instagramController.verifyWebhook' });
out.push({ method: 'POST', path: '/api/v1/webhook/instagram', file: 'backend/src/routes/index.js', mw: '', handler: 'instagramController.receiveWebhook' });
out.sort((a, b) => a.path.localeCompare(b.path) || a.method.localeCompare(b.method));
let md = '| Method | Path | Router file:line | Middleware chain | Handler |\n|---|---|---|---|---|\n';
for (const r of out) md += `| ${r.method} | \`${r.path}\` | ${r.file} | ${r.mw.replace(/\|/g, '/')} | ${r.handler.replace(/\|/g, '/')} |\n`;
fs.writeFileSync(process.argv[3], md);
fs.writeFileSync(process.argv[3].replace('.md', '.json'), JSON.stringify(out, null, 1));
console.log('routes:', out.length);
