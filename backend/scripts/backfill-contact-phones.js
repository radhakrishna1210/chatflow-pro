// Rewrites every Contact.phoneNumber to E.164 (CF-200).
//
//   node --env-file=.env scripts/backfill-contact-phones.js            # dry run: report only
//   node --env-file=.env scripts/backfill-contact-phones.js --apply    # write the changes
//   ... --workspace <id>                                               # one workspace only
//   ... --report collisions.json                                       # also write the report as JSON
//
// Numbers typed without a country code take the workspace's default phone
// country (Settings -> Workspace; India unless changed), so set that first for
// workspaces outside India.
//
// Contacts that collapse onto the same number are NOT merged: each such group
// is listed (ids, names, stored spellings, whether a lead hangs off each) and
// left as it is, for someone to merge by hand. Numbers that cannot be E.164 at
// all are listed too. Re-running is safe: already-normalised rows are skipped.
import { writeFileSync } from 'node:fs';
import { prisma } from '../src/lib/prisma.js';
import { planPhoneBackfill } from '../src/services/contactPhoneBackfill.js';
import { DEFAULT_PHONE_COUNTRY, PHONE_COUNTRIES } from '../src/lib/phone.js';

const args = process.argv.slice(2);
const apply = args.includes('--apply');
const argValue = (flag) => { const i = args.indexOf(flag); return i >= 0 ? args[i + 1] : null; };
const onlyWorkspace = argValue('--workspace');
const reportFile = argValue('--report');

const PAGE = 5000;

async function contactsOf(workspaceId) {
  const rows = [];
  let cursor = null;
  for (;;) {
    const page = await prisma.contact.findMany({
      where: { workspaceId },
      select: { id: true, name: true, phoneNumber: true, createdAt: true, optedOut: true, lead: { select: { id: true } } },
      orderBy: { id: 'asc' },
      take: PAGE,
      ...(cursor ? { skip: 1, cursor: { id: cursor } } : {}),
    });
    rows.push(...page);
    if (page.length < PAGE) return rows;
    cursor = page.at(-1).id;
  }
}

const describe = (c) => ({
  id: c.id, name: c.name, phoneNumber: c.phoneNumber,
  createdAt: c.createdAt, optedOut: c.optedOut, leadId: c.lead?.id ?? null,
});

async function main() {
  const workspaces = await prisma.workspace.findMany({
    where: onlyWorkspace ? { id: onlyWorkspace } : {},
    select: { id: true, name: true, defaultPhoneCountry: true },
    orderBy: { createdAt: 'asc' },
  });

  const report = { mode: apply ? 'apply' : 'dry-run', workspaces: [] };
  let totalUpdated = 0;
  let totalCollisions = 0;
  let totalInvalid = 0;

  for (const ws of workspaces) {
    const country = PHONE_COUNTRIES[ws.defaultPhoneCountry] ? ws.defaultPhoneCountry : DEFAULT_PHONE_COUNTRY;
    const contacts = await contactsOf(ws.id);
    const plan = planPhoneBackfill(contacts, country);

    let updated = 0;
    const raced = [];
    if (apply) {
      for (const u of plan.updates) {
        try {
          await prisma.contact.update({ where: { id: u.id }, data: { phoneNumber: u.to } });
          updated += 1;
        } catch (err) {
          // A contact created with the canonical number since the read.
          if (err.code !== 'P2002') throw err;
          raced.push(u);
        }
      }
    }

    const entry = {
      workspaceId: ws.id,
      name: ws.name,
      country,
      contacts: contacts.length,
      toRewrite: plan.updates.length,
      rewritten: updated,
      collisions: plan.collisions.map((g) => ({ phoneNumber: g.phoneNumber, contacts: g.contacts.map(describe) })),
      invalid: plan.invalid.map(describe),
      lostToConcurrentWrite: raced,
    };
    report.workspaces.push(entry);
    totalUpdated += apply ? updated : plan.updates.length;
    totalCollisions += plan.collisions.length;
    totalInvalid += plan.invalid.length;

    if (plan.updates.length || plan.collisions.length || plan.invalid.length) {
      console.log(`\n[${ws.id}] ${ws.name} (${country}): ${contacts.length} contact(s), `
        + `${plan.updates.length} to rewrite${apply ? ` (${updated} written)` : ''}, `
        + `${plan.collisions.length} duplicate group(s), ${plan.invalid.length} invalid`);
      for (const g of plan.collisions) {
        console.log(`  DUPLICATE ${g.phoneNumber}: ${g.contacts.map((c) => `${c.id} "${c.name}" [${c.phoneNumber}]${c.lead ? ' lead' : ''}`).join(' | ')}`);
      }
      for (const c of plan.invalid) console.log(`  INVALID ${c.id} "${c.name}" [${c.phoneNumber}]`);
      for (const u of raced) console.log(`  SKIPPED ${u.id} ${u.from} -> ${u.to}: number taken by a newer contact`);
    }
  }

  if (reportFile) writeFileSync(reportFile, JSON.stringify(report, null, 2));
  console.log(`\nDone (${report.mode}). ${apply ? 'Rewrote' : 'Would rewrite'} ${totalUpdated} number(s); `
    + `${totalCollisions} duplicate group(s) and ${totalInvalid} invalid number(s) left for review.`);
  if (!apply) console.log('Nothing was written. Re-run with --apply to rewrite.');
}

main()
  .catch((e) => { console.error(e); process.exit(1); })
  .finally(() => prisma.$disconnect());
