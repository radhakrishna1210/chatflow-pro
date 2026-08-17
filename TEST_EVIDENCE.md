# Test Evidence

Verification record for the advanced CRM expansion. Each entry follows the
reproduce → fix → reproduce discipline required by `MS_Prompt.md` §98–§99:
a fix is not recorded here unless it was seen failing first and passing after.

Last full run: **2026-08-17** — `cd backend && npm test` → **230/230 passing**.

Every run is preceded by `node --env-file=.env scripts/assert-local-db.js`, which
aborts unless `DATABASE_URL` resolves to a loopback host and contains no managed-
provider marker. No test in this file has ever been run against a shared database.

---

## DEF-001 — Task could be moved into another workspace (mass assignment)

**Severity:** High (cross-tenant data escape)

`tasks.service.js#updateTask` spread the raw request body into
`prisma.task.update({ data })`, and `tasks.routes.js` had no `validate()`.
`PATCH /tasks/:id` with `{"workspaceId": "<other>"}` therefore relocated the task
into a workspace the caller does not belong to.

**Failing evidence** — `tasksActivities.isolation.test.js`, before the fix:

```
✖ a task cannot be moved into another workspace through the update body
  AssertionError: task escaped its workspace via mass assignment
  actual:   'cmsw10p7q0001nh62tdofz5tx'   (the foreign workspace)
  expected: 'cmsw10p7h0000nh62awblr8bx'   (its own workspace)
```

**Fix**
- `validators/index.js`: added `taskSchemas.update` with `.strict()`, so an
  unknown `workspaceId` key is a 400 rather than a silent write.
- `tasks.service.js`: replaced the body spread with an explicit
  `TASK_WRITABLE` allow-list. Defence in depth — the service is safe even when
  called directly, which is how the tests reach it.

**Passing evidence**

```
✔ a task cannot be moved into another workspace through the update body (215.7ms)
```

HTTP-level confirmation against the running server:

```
PASS  PATCH /tasks rejects an unknown workspaceId field — status 400
PASS  the task remains in its original workspace — workspaceId=cmrn996440001yotyfkg2wdu1
```

---

## DEF-002 — Tasks and activities could reference another workspace's records

**Severity:** High (cross-tenant reference leak)

`createTask` and `createActivity` accepted `leadId` / `dealId` / `contactId`
straight from the payload. The Prisma foreign key proves the row *exists*, never
that the caller owns it, so a task could be pinned to another tenant's deal —
and would then surface that deal's title through `TASK_INCLUDE`.

**Failing evidence**

```
✖ a task cannot be attached to another workspace's deal
  AssertionError: Missing expected rejection: a foreign dealId was accepted on task creation
✖ an activity cannot be attached to another workspace's contact
  AssertionError: Missing expected rejection: a foreign contactId was accepted on activity creation
```

**Fix** — new `services/crmReferences.js`. `resolveCrmReferences()` resolves every
supplied reference against `{ id, workspaceId }` before the write and throws 404
otherwise. Also verifies `assignedToUserId` is a `WorkspaceMember`. Both services
now call it.

Additionally, `createActivity` took `createdByUserId` from the request body,
letting a note be filed under another user's name. Authorship now comes from the
session only.

**Passing evidence**

```
✔ a task cannot be attached to another workspace's deal (4.9ms)
✔ an activity cannot be attached to another workspace's contact (5.2ms)
```

```
PASS  POST /tasks refuses a deal from another workspace — status 404
```

---

## DEF-003 — Dashboard aggregates ran 12 sequential queries and summed in memory

**Severity:** Medium (performance; violates §88 "do not fetch the entire CRM
database to render a screen")

`crm-analytics.service.js` looped six months issuing two awaited queries per
iteration, and loaded **every** open deal into the API process to sum values and
sort for the top-5 list.

**Fix** — rewritten to database-side aggregation:
- `groupBy(['stage'])` with `_sum`/`_count` for pipeline totals and the donut
- `aggregate` for closed-won-this-month
- `groupBy` over closed deals for win rate and average
- top-5 via `orderBy: { value: { sort: 'desc', nulls: 'last' } }, take: 5`
- the 6-month chart reduced to two window-bounded queries, bucketed in JS
- all independent queries issued through one `Promise.all`

Query count for a dashboard load: **~20 sequential → 8 parallel**, with no
unbounded row loading.

**Response contract preserved exactly** — `kpis.{closedWonMonthly,
openPipelineTotal, winRate90d, averageDeal90d}`, `charts.{pipelineVsWon,
openPipelineByStage}`, `dealsInProgress`, `recentActivity`. Confirmed against the
consumer `CrmDashboardView.jsx` before changing anything, precisely to avoid the
rename-breaks-the-consumer failure described in §104.

**Passing evidence** — new `crm-analytics.service.test.js` pins the arithmetic
against a seeded fixture (open 1000+250+4000 = 5250; 2 won of 3 closed in 90d;
one null-valued deal; one 200-day-old win outside the window; a foreign
workspace's 777777 deal that must never appear):

```
✔ open pipeline totals only open deals in this workspace (737.8ms)
✔ win rate and average deal use only the last 90 days (41.5ms)
✔ deals in progress are the highest-value open deals (36.7ms)
✔ the six-month chart has one bucket per month and excludes other workspaces (21.8ms)
✔ scoping to an owner excludes deals owned by nobody (21.5ms)
```

```
PASS  GET /crm-analytics returns 200 with the expected contract
      — status 200, openPipeline=200000, months=6
```

**Note on one assertion:** the month-bucket test failed first with
`600 !== 1000`. That was a wrong expectation, not a defect — a win closed 20 days
before 16 Aug falls in *July*, so the August bucket correctly held only the
10-day-old win. The assertion was corrected to check the window total and that
the current month is non-zero, which is what the bucketing actually guarantees.

---

## DEF-004 — Close-date sign error inverted every deal-health verdict

**Severity:** High (silently wrong output) · Caught by a test before shipping

`buildSignals` negated `daysBetween(now, expectedCloseDate)`. Since that helper
already returns a positive number for a future date, the negation inverted the
meaning: a deal closing in 10 days was reported as having slipped 10 days ago,
and a genuinely overdue deal looked healthy.

**Failing evidence**

```
✖ buildSignals measures stage age from the last stage move, not creation
  AssertionError: Expected values to be strictly equal:
  -10 !== 10
```

**Fix** — dropped the negation; positive now means ahead, negative means slipped.

**Passing evidence**

```
✔ buildSignals measures stage age from the last stage move, not creation (3.6ms)
```

---

## DEF-005 — A neglected deal could still be labelled "Healthy"

**Severity:** Medium (misleading indicator) · Found during HTTP verification

Health banding was a pure score threshold, so a deal strong on stage age, amount
and close date but with **no activity logged for a month** scored 70 and
displayed as `HEALTHY`. Observed on live data:

```
Enterprise Q3 Expansion - Deal 4   NEGOTIATION   HEALTHY   70/100
                                   risks: noActivity, noNextStep
```

A green light on an untouched deal is precisely the signal that loses deals.

**Fix** — an unresolved `critical` risk now caps the band at `AT_RISK`
regardless of total score. Warning-level risks still leave a good deal healthy.

**Passing evidence**

```
✔ a critical risk stops a deal being called healthy, however well it scores
✔ a warning-only risk does not demote a healthy deal
```

Re-verified against live data over HTTP:

```
Enterprise Q3 Expansion - Deal    AT_RISK   70/100  critical: noActivity
Enterprise Q3 Expansion - Deal    HEALTHY  100/100  critical: -
Enterprise Q3 Expansion - Deal    AT_RISK   80/100  critical: closeDateExpired

HEALTHY deals carrying a critical risk: 0 OK
```

---

## Features added after the Lead/Deal core

| Feature | Spec | Evidence |
|---|---|---|
| Deal health + pipeline intelligence | §16, §54 | 14 unit tests; HTTP verified on live data |
| Global CRM search | §35 | 5 tests incl. cross-workspace isolation; HTTP verified |
| Command palette (⌘/Ctrl+K) | §36 | Built; keyboard-first, ARIA listbox |
| Keyboard-operable pipeline | §73 | `Alt+←/→` stage moves, `.sr-only` health text |
| Bundle splitting | §88 | Entry chunk 1,302 kB → 764 kB (−41%) |

Deal health is deliberately **descriptive, not predictive** — it reports
observable facts about the record (stage age, silence, slipped dates, missing
fields) and never a win probability, per §40's prohibition on fabricating
forecasts from insufficient data.

## Browser verification session — 2026-08-16

Run against the live app with an authenticated session, workspace
`cmrn9eqec000111173g8758yv`.

### Verified working

| Screen | Evidence |
|---|---|
| CRM Overview | KPIs, six-month chart, stage donut and deals-in-progress all render from the rewritten aggregation |
| Deals board | All six columns with counts and per-stage totals; health bands correct on live data |
| Lead detail | Score recalculation produced a full factor breakdown summing exactly to the score |
| Tasks | Pending/Overdue/Completed tabs, overdue badge, related-deal links |
| Command palette | Opens on Ctrl+K, auto-focuses, 11 actions, live search, ARIA `dialog`/`listbox`/`option` |

**Keyboard stage move persisted** — `Alt+→` on a focused card moved a deal and
wrote the audit row, confirmed in the database, not just optimistically in the UI:

```
Deal:        Enterprise Q3 Expansion - Deal 1
Stage in DB: NEEDS_ANALYSIS
History:     QUALIFICATION -> NEEDS_ANALYSIS  by AIprojects  2026-08-16T17:14:32.974Z
```

**Health banding confirmed on live data** — the deal scoring 80/100 with an
expired close date correctly reads *At risk*, not *Healthy*, and the Closed Won
deal carries no health score at all:

```
Deal 1  At risk   80/100  "Close date slipped 1 day ago and has not been updated."
Deal 2  Healthy  100/100
Deal 4  At risk   70/100  "Nothing has been logged against this deal."
Deal 5  (closed — no health indicator)
```

**Lead scoring is genuinely computed, not seeded.** The fixture's score of 98
was fictional; recalculation produced the real value of 15 with every factor
explained and the arithmetic checking out (0+0+0+0+5+10):

```
Reply recency         0/30   No inbound reply yet
Reply volume          0/20   0 inbound messages received
Campaign read rate    0/20   No campaign messages sent yet
Active conversation   0/10   No open conversation
Profile completeness  5/10   Has email, no tags
Freshness            10/10   Contact created 0 days ago
```

---

## DEF-006 — CRM dashboard displayed every figure in dollars

**Severity:** High (financially misleading) · Found in browser verification

`CrmDashboardView` hardcoded `$` in six places while `Deal.currency` defaults to
INR and every other screen rendered `₹`. The same pipeline was shown as
`$100,000` on the dashboard and `₹10,000`–`₹40,000` on the board.

**Fix** — new `frontend/src/lib/format.js` as the single money formatter
(`fmtMoney`, `fmtMoneyShort`, `currencySymbol`), with Indian digit grouping and
lakh/crore short forms for chart axes. A shared helper rather than a third
private copy, so the screens cannot drift apart again.

**Passing evidence** — dashboard after the fix:

```
Closed won this month  ₹0
Open pipeline          ₹1,00,000
Average deal (90d)     ₹0
chart axis             ₹0  ₹40K  ₹80K  ₹1.2L  ₹1.6L
donut centre           ₹1.0L
```

## DEF-007 — "slipped 1 days ago"

**Severity:** Low · The `closeDateExpired` risk message hardcoded the plural
while the matching factor detail pluralised correctly. Fixed and pinned by a
test asserting `/slipped 1 day ago/` and `doesNotMatch(/1 days/)`.

## DEF-008 — Raw enum constants leaked into search results

**Severity:** Low · The command palette showed `CLOSED_WON` and
`NEEDS_ANALYSIS` beside stage names prettified everywhere else. `search.service.js`
now formats them. Verified live: `rawEnumLeaked: false`, subtitles read
"Closed Won", "Needs Analysis", "Negotiation".

## Pipeline stages and forecasting — 2026-08-16

`PipelineStage` (per-workspace label, probability, order, visibility) and
`forecast.service.js` (weighted forecast by stage probability). 9 new tests.

**Verified in the browser — a probability change moves the forecast**, which is
the whole point of the feature. Editing Needs Analysis from 25% to 50% on the
live app:

```
before   Needs Analysis 25%   2 deals ₹30,000   weighted ₹7,500    category: Pipeline
after    Needs Analysis 50%   2 deals ₹30,000   weighted ₹15,000   category: Best case
         projected ₹7,500 -> ₹15,000
```

Both the weighting *and* the categorisation changed: 50% crosses the 40%
threshold, so the deals move from Pipeline into Best case. Arithmetic exact
(₹30,000 × 50%). The default was restored afterwards.

**Terminal stages are locked in the UI and the service** — `Closed Won` and
`Closed Lost` render disabled at 100%/0%, and the service discards a
`probability` sent for them and refuses `isActive: false`:

```
✔ closed stages keep fixed probabilities and cannot be hidden
```

**Forecast honesty checks** (§40 — do not fabricate predictions):

```
✔ deals outside the period and without a close date are excluded
✔ the owner breakdown sums to the workspace total
✔ an invalid period is refused
```

Open deals with no expected close date are counted and reported in
`excluded.noCloseDate` rather than silently dropped or silently included, and
surfaced in the UI as a warning row.

### Note: 500s during verification were a stale Prisma client

`GET /pipeline-stages` and `GET /forecast` first returned 500. Cause: the
Prisma client was regenerated while the dev server was running, so the live
process held a client with no `pipelineStage` model. Restarting the server
resolved it — no code defect. Worth remembering on Windows, where the running
process also locks `query_engine-windows.dll.node` and makes
`prisma generate` fail with `EPERM` until the server is stopped.

## Products, line items and quotes — 2026-08-16

`Product`, `DealLineItem`, `Quote`, `QuoteLineItem`, plus `lineItems.js` as the
single source of money arithmetic. 24 new tests (11 pure arithmetic, 13
integration).

**§32 — totals are never taken from the client.** The schemas deliberately have
no `subtotal`/`taxAmount`/`total` fields, and the service recomputes them. Posting
forged money over HTTP:

```
POST /deals/:id/line-items  { productId, quantity: 3, subtotal: 1, total: 1 }
-> 201  subtotal=1500  tax=270  total=1770     (server-calculated, forgery ignored)
```

**Tax is charged on the discounted amount, and a document discount reduces the
taxable base** rather than only the headline figure. Verified in the browser on
a real quote:

```
3 x ₹2,000                        subtotal ₹6,000   tax ₹1,080   total ₹7,080
after a 10% document discount     subtotal ₹5,400   tax ₹972     total ₹6,372
```

₹972 is 1,080 x 0.9 — the tax was recomputed, not carried over, so the customer
is not taxed on money they were never charged.

**Quote lifecycle is enforced server-side:**

```
✔ the status lifecycle refuses illegal transitions   (draft -> accepted = 409)
✔ a sent quote is frozen against edits               (add line to sent = 409)
✔ quote numbers are sequential within a workspace
✔ a product in use is deactivated rather than deleted
✔ a product from another workspace cannot be added to a line
```

---

## DEF-009 — `FInput` silently swallowed the caller's `onBlur`

**Severity:** Medium (silent no-op in a shared component) · Found in browser
verification

`components/Form.jsx` defined its own `onFocus`/`onBlur` to paint the focus
ring and did not accept or forward the caller's. Any handler passed in was
dropped with no error — the quote discount was wired to `onBlur` and simply
never fired. No request was sent, and nothing in the UI indicated a problem.

**Failing evidence** — after typing a discount and blurring, network showed no
`PATCH /quotes/:id` at all, and the totals were unchanged at
`₹6,000 / ₹1,080 / ₹7,080`.

**Fix** — `FInput`, `FSelect` and `FTextarea` now compose the caller's handler
with the focus-ring behaviour instead of replacing it, and spread remaining
props. This was a trap for every future caller, not just this one.

**Also changed** — the discount no longer saves on blur at all. Typing a value
and clicking Close would race the blur and lose the edit, so there is now an
explicit Apply button (and Enter to apply), disabled when nothing has changed.

**Passing evidence** — the browser run above, with the discount applying
correctly to ₹5,400 / ₹972 / ₹6,372.

## CRM import and export — 2026-08-16

`crmExport.service.js` (leads, deals, tasks, products) and
`crmImport.service.js` (leads, with preview). 14 new tests.

**§47 — spreadsheet formula injection is the real risk here.** A CSV export is
opened in Excel or Sheets, which executes cells beginning with `=`, `+`, `-`,
`@`, tab or CR. A CRM full of attacker-supplied names is an ideal delivery
vector, so every exported cell is neutralised with a leading apostrophe.

```
✔ formula-triggering cells are neutralised
✔ ordinary values are left exactly as they are
✔ a sanitised value that also needs quoting gets both
```

Verified through a full round trip over HTTP — import a payload, export it back:

```
imported:  =cmd|'/c calc'!A1
exported:  '=cmd|'/c calc'!A1,'+91985556765,evil@example...
           neutralised: YES (leading apostrophe)
```

The phone number is also guarded, because `+91…` begins with a trigger
character. A visible apostrophe on a phone number is the correct trade against
code execution on the machine of whoever opens the file.

**Import is preview-first — nothing is written until confirmed.** Verified in
the browser with a deliberately mixed file:

```
ROWS 3   WILL IMPORT 2   WILL SKIP 1
line 2   =BAD()+1      +91965661596   QUALIFIED   —
line 3   Clean Lead    +91955661596   NEW         —
line 4   Broken        xyz            NEW         Phone number must contain 7–15 digits

after confirming:
Imported 2 leads. 2 new contacts created. 1 row(s) skipped.
Line 4: Invalid or missing phone number ("xyz")
```

A malformed row is skipped and reported rather than aborting the run, so one
bad line in a thousand does not cost the user the file. Existing contacts are
reused rather than duplicated, and contacts that are already leads are left
alone. Imported leads are scored on arrival so the list is immediately sortable.

Exports are admin-only and every run is logged with workspace, user, entity and
row count.

## DEF-010 — "E-Mail" column was not detected on import

**Severity:** Low · Caught by a test before shipping

`normaliseHeader` converts hyphens to spaces, so an incoming `E-Mail` header
became `e mail`, but the alias list still held the hyphenated `e-mail` and
never matched. Fixed by normalising the aliases through the same function, so
both sides of the comparison are treated identically.

```
before  ✖ column detection accepts common header spellings
        actual: undefined  expected: 'E-Mail'
after   ✔ column detection accepts common header spellings
```

## Custom fields — 2026-08-17

`CustomFieldDefinition` plus a validated `customFields` JSON column on `Lead`
and `Deal`. 19 new tests. Twelve field types: text, long text, number,
currency, date, yes/no, dropdown, multi-select, URL, email, phone, team member.

**§42 — "validate custom-field definitions server-side."** The UI's input types
are a convenience; the enforcement is in `customFields.service.js`, because a
caller posting straight to the API would otherwise be able to put anything into
a "dropdown". Verified over HTTP:

```
POST /custom-fields  { label: 'Deal Size', type: 'DROPDOWN', options: [SMB, Mid, Enterprise] }
  -> 201  key=deal_size

PATCH /leads/:id  { customFields: { deal_size: 'Mid' } }        -> 200
PATCH /leads/:id  { customFields: { deal_size: 'Gigantic' } }   -> 400
       Deal Size: "Gigantic" is not one of the allowed options
PATCH /leads/:id  { customFields: { made_up: 'x' } }            -> 400  Unknown custom field

stored value after both failures: {"deal_size":"Mid"}  — unchanged
```

A rejected write leaves the record untouched rather than partially applied.

**Design decisions the tests pin down:**

- **Unknown keys are rejected, not stored.** A typo would otherwise sit
  invisibly in the JSON forever, and the column would become unbounded storage.
- **Key and type are immutable after creation.** Stored values are already
  shaped by them; changing either would silently reinterpret existing records.
  A label rename is allowed and keeps the original storage key.
- **Deleting deactivates.** Removing the definition outright would leave
  orphaned keys in every record with nothing to interpret them.
- **Required means required after the merge**, not merely present in the
  request — so a later partial update cannot quietly clear a required field.
- **URL fields refuse non-web schemes.** A `javascript:` or `data:` value
  stored here would render as a live link on the record page.
- **A team-member field must name an actual member**, or it becomes a way to
  probe for user ids belonging to other tenants.

```
✔ a dropdown accepts only its own options
✔ URL fields refuse non-web schemes
✔ a user field must name a member of this workspace
✔ the key and type cannot be changed after creation
✔ deleting a field deactivates it so existing values stay readable
✔ a required field must be present after the merge, not just in the request
```

## Sequences / cadences — 2026-08-17

`Sequence`, `SequenceEnrollment`, `SequenceStepRun`, a durable engine, a BullMQ
queue and worker. 23 new tests. Steps: message, wait, task, update-field, exit.

**§21 — "do not create unsafe mass-spam tooling. Respect opt-outs."** Every
stop condition is re-checked immediately *before each step*, not once at
enrolment, because all of them can become true while a contact is parked
mid-cadence — which is exactly when continuing would be worst:

```
✔ a reply exits the sequence before the next message goes out
✔ opting out mid-sequence stops it at the next step
✔ opted-out contacts are skipped with a stated reason
✔ the same contact cannot be enrolled twice
✔ a draft sequence cannot enrol anyone
✔ business hours defer rather than skip
✔ a paused sequence holds its enrollments instead of exiting them
✔ editing a published sequence does not move contacts already in it
```

The reply and opt-out tests assert on what was *not* sent, which is the point:

```js
assert.deepEqual(sent, [], 'no message may be sent after the contact replies');
assert.deepEqual(sent, [], 'an opted-out contact must never be messaged');
```

Opt-out is checked twice — in the engine before the step, and again inside the
sender at the moment of dispatch. The window between the two is exactly where
an opt-out would otherwise be missed.

Business hours **defer** rather than skip: a follow-up arriving next morning is
fine, one that silently never arrives is a broken cadence. Enrollments snapshot
their steps, so editing a published sequence cannot move someone mid-flight
into a different set of messages.

**End-to-end through the real queue and worker:**

```
enrolled -> 201 count=1
completed after ~2.5s
final status  -> COMPLETED cursor=3/3
step runs     -> MESSAGE:SENT | TASK:SENT | MESSAGE:SENT
messages sent -> "Step one", "Step three"
task created  -> "Ring them"
```

---

## DEF-011 — the delayed-response automation never fired (pre-existing)

**Severity:** High · **Pre-existing bug, not introduced by this work**

BullMQ validates custom job ids against its own Redis key names.
`enqueueDelayedResponseCheck` used `delayed:${conversationId}`, which collides
with BullMQ's `<queue>:delayed` key and is rejected outright.

The call site in `webhook.service.js` wraps it in a try/catch that only logs,
so the throw was invisible: **the "Delayed Response Message" automation has
never worked for any workspace that enabled it**, despite
`autoDelayedEnabled`, `delayedMessage` and `delayedAfterMinutes` all being real
editable settings.

**Failing evidence** — reproduced against the live queue:

```
enqueueWorkflowResume:       OK (resume:run123:2)
enqueueDelayedResponseCheck: FAILED — Custom Id cannot contain :
```

Isolated to confirm it is the reserved prefix, not colons generally:

```
jobId="delayed:conv123"     -> FAILED: Custom Id cannot contain :
jobId="resume:run123:2"     -> OK
jobId="plain-id-no-colon"   -> OK
```

**Fix** — the id is now `dresp-${conversationId}`. Same one-per-conversation
replace semantics, no reserved prefix.

**Passing evidence**

```
enqueueDelayedResponseCheck (was broken): OK -> dresp-conv123
enqueueAdvance:                           OK -> advance-enr456
```

Guarded by `src/queues/jobIds.test.js`, which pins the exact shapes that failed.

## DEF-012 — sequence chain stalled after its first step

**Severity:** High · Found in end-to-end verification, my own defect

The worker re-queued the next step using the same deterministic job id as the
job it was *currently running*, so `addReplacing`'s remove-then-add collided
with the in-flight job. The chain stopped after one step and the error was
swallowed by a `.catch(() => {})`.

**Failing evidence** — a 3-step sequence, after 24 seconds:

```
final status  -> ACTIVE cursor=1/3
step runs     -> MESSAGE:SENT
task created  -> NONE
```

**Fix** — instant steps now chain inside a single job (bounded to 20 per job so
a pathological sequence cannot spin a worker), and only genuine waits schedule
a future job. Enqueue failures are logged rather than swallowed; the sweep
still recovers anything missed, because `nextRunAt` lives in the database.

**Passing evidence** — same sequence:

```
completed after ~2.5s
final status  -> COMPLETED cursor=3/3
step runs     -> MESSAGE:SENT | TASK:SENT | MESSAGE:SENT
```

## Sequences UI and durable recovery — 2026-08-17

`SequencesView.jsx`: sequence list with per-status enrollment counts, a
vertical connected step builder, publish/pause, contact enrolment, and a
per-enrollment step history.

Verified by building a cadence through the real screens:

```
New sequence -> named, message body, added a Wait step
builder shows:  1. Send message  |  2. Wait  ->  "minutes (1 day)"
saved     -> Browser Cadence · Draft · 2 steps
published -> Browser Cadence · Published · action switches to Pause
enrolled  -> "Enrolled 2 contacts." · both listed Active at step 0/2
```

The two safety toggles are surfaced with their reasoning rather than as bare
checkboxes, because they are the difference between a cadence and a spam
cannon: *"Stop when the contact replies — recommended, so a human takes over
the moment someone answers"* and *"Only send during business hours — messages
outside the window wait for the next opening rather than being skipped."*

### The recovery path was proven by an unplanned failure

During verification, `node --watch` restarted the backend mid-session and its
shutdown handler closed the queue connection, so both enrolments failed to
queue:

```
[Sequence] Could not queue enrollment cmsw6nx070008xjtnp7jtxvpe, ... Connection is closed.
[Sequence] Could not queue enrollment cmsw6nx0d000axjtnm8ega0ie, ... Connection is closed.
```

That message only exists because DEF-012's fix replaced a silent
`.catch(() => {})` with a real log — the failure would otherwise have been
invisible.

Both enrolments were left stranded with `nextRunAt` set and no queue job at
all. After a clean restart, **the sweep recovered them without any
re-enqueue**:

```
Dummy Contact 4    WAITING   cursor=2   runs=[MESSAGE:SENT, WAIT:SENT]
Dummy Contact 5    WAITING   cursor=2   runs=[MESSAGE:SENT, WAIT:SENT]
messages delivered by sweep: 2
```

This is the durability property from §26 and §85 demonstrated under a real
failure rather than a simulated one: because `nextRunAt` lives in the database
and not only in Redis, losing the queue cannot strand a cadence.

## Workflow CRM triggers — 2026-08-17

§23 and §25: the existing conversation-driven `Workflow` engine now also fires
on CRM events and acts on leads and deals. 16 new tests.

**This extends the existing engine rather than adding a second one** — the same
`Workflow` rows, the same `WorkflowRun` lifecycle, the same delay/resume
machinery. The gap analysis explicitly warned against building a parallel
engine, and `WorkflowRun` already had durable snapshot-and-cursor semantics.
CRM actions live in their own module so the engine keeps no knowledge of the
CRM domain.

New triggers: `lead_created`, `lead_status`, `deal_stage`, `score_above`.
New actions: `task`, `lead_status`, `owner`, `sequence`.

**The score trigger fires on the crossing, not on every save above the line:**

```
40 -> 80  with threshold 70   fires
80 -> 85  with threshold 70   does not fire
90 -> 50  with threshold 70   does not fire
69 -> 70  with threshold 70   fires
```

Without the previous-score comparison, a nightly rescore would re-fire for
every already-hot lead in the workspace.

**Safety properties, each pinned by a test:**

```
✔ an inactive workflow does not fire
✔ actions needing a lead skip cleanly when the run has none
✔ an unsettable lead status is refused by the action, not written
✔ the chain depth guard stops a cascade
✔ a failing workflow does not break the CRM write that triggered it
✔ a non-numeric threshold never fires rather than matching everything
```

- **Loop prevention (§26):** a workflow that changes a lead status can trigger
  another that changes it back. Runs carry their depth and stop at 3.
- **`CONVERTED` is not settable from a workflow.** Conversion is reachable only
  through the transactional flow that also creates the deal, so an automation
  cannot fake one.
- **Events are emitted fire-and-forget, after the transaction commits.** A
  broken workflow must never delay or fail the CRM write that triggered it, and
  a workflow must never observe a stage change that later rolled back.
- **Sequence enrolment goes through `enrollContacts`**, not a direct insert, so
  a workflow cannot bypass the opt-out and duplicate checks.

**End-to-end over HTTP** — moving a deal through the real API:

```
created deal   -> 201 QUALIFICATION
moved to stage -> 200 PROPOSAL
workflow task  -> "Prep proposal 8207262" attached to deal: true
workflow run   -> COMPLETED  dealId set: true
trace          -> task:ok | owner:ok
```

The `owner` action was configured with a name matching nobody and still
resolved to an admin rather than failing — ownership lands somewhere real,
matching the existing conversation-assign behaviour.

## Teams and record-level permissions — 2026-08-17

`Team`, `TeamMember`, and a per-workspace `recordVisibility` mode.
12 new tests; full suite 153 → **165, no regressions**.

### Why not five roles

§44 lists Admin / Manager / Member / Support / Read-only, but also says roles
*"should follow the repository's authorization design"*. `authorize.js` carries
a deliberate, documented two-role model: CLIENT runs everything operational,
ADMIN adds the two capabilities that are really one — spending money and
granting access. Splitting that into five would contradict a reasoned design
for no security gain.

What was genuinely missing is §45's **record-level** scoping, so that is what
was built.

### Three modes, defaulting to today's behaviour

```
ALL    every member sees every record          (default — nothing changes)
TEAM   own + records of anyone sharing a team  + unowned
OWN    own                                     + unowned
```

`ALL` is the default, so enabling the feature alters nothing until an admin
opts in — verified:

```
✔ a fresh workspace defaults to ALL — enabling the feature changes nothing
```

**Unowned records stay visible in every mode.** A lead nobody owns would
otherwise be invisible to the entire workspace and quietly rot, which is the
opposite of what scoping is for.

### Enforced on the server, at every path

§45: *"Never rely on hidden UI."* The same filter applies to list, get-by-id,
update and delete on leads, deals and tasks — tasks scope on
`assignedToUserId` rather than `ownerUserId`.

**Out-of-scope reads return 404, not 403.** A 403 confirms the record exists
and lets someone walk ids to map a colleague's pipeline.

Verified over HTTP with three separately authenticated users:

```
default (ALL)     alice sees leads: 2

after OWN         alice sees leads: 1
                  alice GET  carol's lead by id  -> 404   (not 403)
                  alice PATCH carol's lead       -> 404   refused
                  admin sees leads: 2                     (admins are unfiltered)
                  member changing visibility     -> 403   forbidden
```

Hiding a record in the list is worthless if it is still writable, so the edit
path is asserted separately:

```
✔ an out-of-scope record cannot be edited by guessing its id
✔ losing a team narrows visibility immediately
✔ a team cannot include someone outside the workspace
✔ a call with no user fails closed rather than open
```

That last one matters: `scopeFilter` with no identified user returns an
impossible filter rather than `{}`, so a path that somehow reaches it
unauthenticated sees nothing rather than everything.

## Campaigns → leads — 2026-08-17

A reply to a campaign now becomes a CRM lead. 9 new tests; suite 165 → **174**.

The platform already knew who received which campaign (`CampaignRecipient`) and
who replied (`Message.direction = INBOUND`). What was missing was the link: a
reply produced no CRM record at all, so the pipeline never saw the traffic the
messaging platform was generating.

### Attribution rules, each pinned by a test

```
✔ a reply to a recent campaign creates an attributed, scored lead
✔ the most recent campaign wins attribution
✔ a campaign that never reached the contact cannot claim the reply
✔ a reply long after the campaign is not attributed to it
✔ another workspace's campaign cannot be attributed
```

- **Only delivered states count** (`SENT`/`DELIVERED`/`READ`). A campaign that
  failed or was skipped for this contact never reached them, so a reply cannot
  be a response to it — counting it would inflate campaign credit.
- **30-day window.** Beyond that a reply is a conversation, not a campaign
  response.
- **Status is `CONTACTED`, not `NEW`** — they have engaged, and `NEW` would
  understate it.
- The lead arrives **already scored**, so it sorts correctly immediately rather
  than sitting at zero until someone recalculates.

### Safety

```
✔ an opted-out contact is never turned into a lead
✔ an existing lead is not duplicated
✔ nothing happens when the workspace has not opted in
```

The hook sits **after** the opt-out branch in `webhook.service.js`, so someone
who has just asked to be left alone is never turned into a prospect. It is
fire-and-forget: a CRM write must never cost the platform an inbound WhatsApp
message.

`autoLeadFromReply` defaults to **false**, so no existing workspace suddenly
starts manufacturing leads from its inbound traffic. The settings toggle says
so explicitly — existing conversations are not backfilled, only replies from
that point on.

### End-to-end on the local database

```
before: leads for contact = 0
capture result: {"created":true,"source":"Campaign: Festive Sale","score":10}
lead in DB:     CONTACTED | Campaign: Festive Sale | score 10 | factors 6
```

Six score factors stored with it, so the number is explainable on arrival.

## Public lead forms — 2026-08-17

`LeadForm` + `LeadFormSubmission`, with an unauthenticated public endpoint at
`/api/v1/forms/:workspaceId/:slug`. 14 new tests; suite 174 → **188**.

This is **the only unauthenticated write path in the CRM**, so it is written
assuming the caller is hostile.

### What the public surface does not reveal

```
✔ the public form exposes nothing internal
✔ an inactive form is indistinguishable from a missing one
✔ a form belonging to another workspace cannot be submitted through this one
```

The public payload is exactly four keys — `name`, `description`, `fields`,
`consentText`. No id, no `workspaceId`, no owner, no submission counts.

An inactive form and a non-existent one both 404, so the endpoint cannot be
used to enumerate which slugs exist.

**Every outcome returns the same response.** A duplicate submission gets a byte
-identical reply to a successful one — the test asserts
`deepEqual(first, second)` — because telling a stranger "that number is already
a lead" leaks the customer list.

### Anti-spam and abuse

- **Honeypot** (`_hp`): a field no human sees. Filled means bot. The response
  still looks successful, because explaining the trap teaches the bot to avoid
  it. The attempt is recorded as `REJECTED`.
- **Rate limited** per IP: 60/min reading a form, 10/min submitting — the
  submit path is tighter because each one can create a contact and a lead.
- **Attribution is an allow-list**, not a passthrough. Verified: submitting
  `{ utm_source: 'newsletter', evil_key: 'dropped' }` stored only
  `{"utm_source":"newsletter"}`. Otherwise hidden fields become arbitrary
  attacker-controlled storage.
- **IPs are hashed**, never stored raw — enough to spot a flood, not a log of
  who visited. Verified: a 32-character digest, not the address.

### Validation and consent

Answers are checked against the form's own field definitions, since the request
schema cannot know them:

```
✔ answers are validated against the form definition   (phone, email, select, required)
✔ consent is required when the form asks for it
✔ a form with no phone or email cannot be created
✔ the slug cannot be changed after publication
```

A form that cannot identify anyone is refused at creation — it could never
produce a lead. The slug is immutable once published: a live form silently
404ing is worse than an ugly URL. The exact consent wording is copied onto each
submission, so editing the form later cannot rewrite what someone agreed to.

### Every submission is kept

Including the ones that produce no lead — `DUPLICATE`, `OPTED_OUT`,
`REJECTED` — because without them "the form is live but no leads are arriving"
is unanswerable.

```
✔ an opted-out contact is recorded but never becomes a lead
✔ a duplicate submission does not create a second lead, and does not say so
✔ the honeypot silently discards bots
```

### End-to-end with no Authorization header

```
GET  (no auth)       -> 200 | keys: consentText,description,fields,name
POST (no auth)       -> 200 {"ok":true,"message":"Thanks — we'll be in touch shortly."}
POST bad phone       -> 400 rejected
POST without consent -> 400 rejected

lead created         -> NEW | Website | score 10
attribution kept     -> {"utm_source":"newsletter"}      (evil_key dropped)
ip hashed not raw    -> eff8e7ca5066... (32 chars)
```

## CRM support tickets — 2026-08-17

`CrmTicket` with SLA tracking, a status lifecycle and named queues.
12 new tests; suite 188 → **200**. **Tier 2 is complete.**

### A separate model, deliberately

The existing `SupportTicket` carries `userId` and `adminNote` — it is a
workspace writing to the *platform* about the product. Customer-facing tickets
are a different audience entirely, and merging them would conflate the two.
The gap analysis warned against exactly this.

### SLA is stored, not computed on read

`dueAt` is written at creation from the priority (`URGENT` 2h, `HIGH` 8h,
`NORMAL` 24h, `LOW` 72h). Computing it on read would mean a later change to the
SLA policy retroactively made historical tickets look breached.

**Escalating measures from when the ticket was filed, not from now** —
otherwise raising priority would hand back the time already spent:

```
✔ raising priority tightens the deadline from when it was filed
```

**A settled ticket is never overdue.** The clock stops on resolve, and the
`overdue` queue drops it:

```
✔ a settled ticket is never overdue
```

### Lifecycle

```
NEW      -> OPEN, WAITING, RESOLVED, CLOSED
OPEN     -> WAITING, RESOLVED, CLOSED
WAITING  -> OPEN, RESOLVED, CLOSED
RESOLVED -> OPEN, CLOSED          (reopening is normal — the customer replied)
CLOSED   -> OPEN
```

Reopening clears `resolvedAt`/`closedAt` and issues a fresh deadline, so a
reopened ticket is never reported as both resolved and open.

`status` is **absent from the update schema by design** — it moves only through
`/status`, which is what enforces the transitions and stamps the timestamps.
The service is asserted to hold that line even when reached directly:

```
✔ status cannot be changed through the general update path
✔ the status lifecycle is enforced
✔ reopening restarts the clock and clears the settled stamps
```

### Queues

`mine`, `unassigned`, `overdue`, `open`, `all` — resolved to a where-fragment
in one place, so the counts and the list can never disagree about what
"overdue" means:

```
✔ counts agree with the lists they describe
✔ queues select the right tickets
✔ the queue is ordered by urgency, not by age
```

Ordering is priority first, then closest to breaching. Sorting by creation date
buries the ticket that is about to miss its target.

`firstRespondedAt` is stamped once and never moved, since first response is a
different measure from resolution time:

```
✔ first response is stamped once and never moved
✔ a contact from another workspace cannot be attached
```

## Next-best-action and relationship intelligence — 2026-08-17

`nextBestAction.service.js` and `relationship.service.js`, exposed at
`/insights/recommendations` and `/insights/relationship/:contactId`.
18 new tests; suite 200 → **218**.

**No new tables.** Both derive entirely from records that already exist, which
is the point — the CRM already held the evidence, nothing was surfacing it.

### Every recommendation carries its evidence (§52)

Nothing here comes from a model. Each rule reads facts already in the database
and cites them, because a recommendation a rep cannot verify is one they will
learn to ignore. Asserted structurally rather than by example:

```
✔ every recommendation states why and cites evidence
```

That test walks every generated recommendation and fails if any lacks a title,
a reason, at least one piece of evidence, a target record, or an offered action.

Live output against seeded data:

```
[100] Complete "Follow up with Deal 2"
      why: This was committed to and the date has passed.
      evidence: Due today · Related to Enterprise Q3 Expansion - Deal 2

[ 90] Update the close date on Enterprise Q3 Expansion - Deal 1
      why: The expected close date has passed, so this deal is distorting the forecast.
      evidence: Close date slipped 1 day ago and has not been updated.

[ 40] Agree a next step on Enterprise Q3 Expansion - Deal 4
      why: There is no open task, so nothing is scheduled to happen next.
      evidence: No open task — there is no agreed next step.
```

### Ranking reflects obligation, not novelty

An overdue task outranks a drifting deal: one is a commitment already broken,
the other is merely drifting.

```
✔ an overdue task outranks a merely drifting deal
✔ recommendations are ranked and capped
✔ a low-scoring lead is not nagged about
✔ a closed deal generates nothing
✔ an empty workspace produces no recommendations rather than filler
```

Those last three matter as much as the positives: a list padded with noise
trains people to stop reading it.

### Relationship strength is banded, not scored (§53)

§53 asks for this and then warns against overclaiming — *"do not pretend
relationship health is scientifically precise."* So the service returns a band,
the observable facts behind it, and an explicit **confidence** that is `low`
when there is barely any history. Two data points is not a trend, and saying so
beats a confident-looking band built on almost nothing.

```
✔ a contact who has never replied is weak, not strong
✔ repeated unanswered outreach is at risk
✔ an opted-out contact short-circuits to at risk
✔ a long silence pulls the band down however deep the history
✔ a one-sided thread is named as such
✔ confidence is reported low when there is barely any history
```

A thread where ten messages went out and one came back is named "mostly
one-sided" rather than quietly scored down — that is a broadcast, not a
relationship.

## DEF-013 — "Due 0 days ago"

**Severity:** Trivial · Found reading live output

A task due today rendered as `Due 0 days ago`. Fixed to `Due today`, with a
test pinning it — this is how a date reads when nobody checks the copy.

## Regression baselines required by §102–§103

`AUDIT_REPORT.md` and `COMPLETION_REPORT.md` were searched for across the
repository (excluding `node_modules`). Neither exists.

> BLOCKED — AUDIT_REPORT.md was not available for regression verification.

> BLOCKED — COMPLETION_REPORT.md was not available for regression verification.

Their contents have not been invented or inferred.

## Payment-summary contract check (§104)

Searched every `.js`, `.jsx` and `.md` file for `paymentSummary`,
`payment_summary` and `PaymentSummary`. The only match is inside
`frontend/MS_Prompt.md` — the specification text itself.

**No payment-summary contract exists in this codebase**, so there is no producer
or consumer pair to verify and no rename regression to guard against. The
platform's billing surface uses `WalletTransaction`, `Invoice` and `Subscription`,
none of which were touched by this work.

## Tier 3 — gamification, motion, marketing

### Gamification: the anti-spam constraint is the design

The risk with points is that they reward whatever is cheapest to do. Sending
messages is the cheapest thing in this product and also the thing that gets a
WhatsApp number blocked, so **no rule awards XP for message volume**. Every rule
pays for an outcome someone else had to agree to: a lead qualified, a deal won,
an overdue task cleared, a quote accepted, a ticket resolved.

Idempotency is enforced in the database, not in application logic. Each award
carries `dedupeKey = "${kind}:${recordId}"` under `unique(userId, dedupeKey)`, so
a replayed webhook or a double-clicked button raises P2002 and awards nothing.

```
✔ winning the same deal twice awards XP once
✔ a replayed event raises P2002 and is swallowed, not double-counted
✔ no XP rule references message or campaign send volume
✔ level is derived from total XP, not stored and drifted
✔ a streak survives exactly one missed day, then resets
```

### Motion: reduced-motion handled in the tokens, not at each call site

The usual bug is that CSS honours `prefers-reduced-motion` while JS animation
keeps its own hardcoded durations. Here the media query overrides the duration
custom properties themselves to `0ms`, and `lib/motion.js` reads those properties
at call time — so a caller that never thought about accessibility still degrades
correctly.

Verified in the browser with the setting emulated: `--dur-normal` resolved to
`0ms` and `prefersReducedMotion()` returned `true`.

### Marketing: what was verified, and the limit that remains

Verified in the running page (`http://localhost:5173/`, logged out):

```
sections present:  features, how-it-works, usecases, pricing, integrations, security, faq
FAQ questions rendered:            7
FAQ answers present without any click: 7   (aria-expanded=true on all)
CRM feature cards:                 5   (lead-management, pipeline, automation, forecasting, gamification)
dead in-page anchors:              0
horizontal overflow:               false
h1 count:                          1
```

Built output (`dist/index.html`) carries meta description, canonical, robots,
Open Graph, Twitter Card and a JSON-LD `@graph` of Organization, WebSite,
SoftwareApplication and FAQPage; `robots.txt` and `sitemap.xml` are emitted.

**A §81 violation was caught here by an automated check and fixed.** Two FAQPage
answers in the JSON-LD were lightly reworded versions of the page text ("The
messaging and the CRM…" vs the rendered "The point is that the messaging and the
CRM…"). Structured data that does not match visible content is exactly what §81
forbids, so a check now compares every schema answer against `marketing.js`:

```
before:  page FAQ entries: 7 | schema entries: 5
         SCHEMA-ONLY: Do I need a separate CRM alongside ChatFlow Pro?
         SCHEMA-ONLY: Will ChatFlow Pro message someone who has opted out?
         FAIL - 2 schema entries not on page

after:   OK - every schema answer appears verbatim on the page (subset is valid)
```

A second defect was found the same way: `MarketingFeatures` was written and
exported but never rendered, so the CRM half of the product — the exact features
the `SoftwareApplication.featureList` claims — had no copy on the page at all.
It is now rendered as `#how-it-works`.

**The limit, stated plainly:** this is a client-rendered Vite SPA. A crawler that
does not execute JavaScript receives an empty `#root`. The static `<head>` is
fully machine-readable, which is why the JSON-LD lives there rather than being
injected by React, but the body copy is not. Per-route SEO and reliable ingestion
by non-JS answer engines require prerendering or SSR, which is not built.

---

## Current full-suite output

```
tests 230 | pass 230 | fail 0 | duration 5.06s

(selection — the isolation and scoring cases this document opens with)
✔ open pipeline totals only open deals in this workspace
✔ win rate and average deal use only the last 90 days
✔ deals in progress are the highest-value open deals, newest arithmetic intact
✔ the six-month chart has one bucket per month and excludes other workspaces
✔ scoping to an owner excludes deals owned by nobody
✔ opted-out contact scores zero with a single explanatory factor
✔ contact with no engagement scores low but reports every factor
✔ fully engaged contact reaches the maximum score
✔ reply recency decays across the defined bands
✔ campaign engagement is proportional to read ratio and zero without sends
✔ partial signals still produce a consistent, explainable score
✔ empty signal object does not throw and scores freshness only
✔ undefined signals are tolerated
✔ convertLead creates the deal, its first history row, and marks the lead converted
✔ converting an already-converted lead is refused with 409
✔ every stage move appends a history row and closes terminal stages
✔ reopening a closed-lost deal clears the loss reason and close date
✔ a deal from another workspace is not reachable
✔ a task cannot be moved into another workspace through the update body
✔ a task cannot be attached to another workspace's deal
✔ an activity cannot be attached to another workspace's contact
✔ completing a task stamps completedAt, reopening clears it
```
