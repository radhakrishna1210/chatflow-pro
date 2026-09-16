# Testing walkthrough

Everything built on `aditya-advanced-crm`, in the order a customer actually
moves through it. Roughly 30 minutes end to end.

Nothing here touches a remote database. `backend/scripts/assert-local-db.js`
aborts on any non-loopback or managed-provider host.

---

## 0. Start the stack

```bash
docker start chatflow-local-pg
```

```bash
cd backend && node --env-file=.env scripts/assert-local-db.js && npm run dev
```

```bash
cd frontend && npm run dev
```

Backend on `:4000`, frontend on `:5173`. Confirm the guard printed
`[db-guard] OK — local database confirmed`.

Optional starting data (contacts, leads, deals across every workspace):

```bash
cd backend && node --env-file=.env scripts/seed-crm.js
```

Sign in at `http://localhost:5173/login`. The **AIprojects** workspace was
emptied after verification, so it is a clean slate; the **Test User** workspace
still has seeded records.

---

## 1. A stranger becomes a lead

**Lead Forms → New form.** Give it a name, keep the default *Full name* +
*Phone number* fields, add a choice list, set consent text, tick **Live**, save.

Three things to try while building it:

- Switch the phone field to **email**. A warning appears: submissions will be
  stored but no leads created, because a contact is identified by phone. It
  stays a warning — an email-only form is a legitimate thing to build.
- Remove both phone and email. Save is now **disabled**, with the reason shown.
- Add a choice list and leave it empty. Save disabled again.

Open the form, copy the **public URL**, and open it in a private window with
`?utm_source=test&utm_campaign=demo` appended. Fill it in and submit.

Back in the builder, open the form: outcome `Lead created`, the answers, the
consent wording, and a **hashed** IP — never the raw address. Attribution is
stored from those UTM parameters.

> Bot check: submit again with the hidden `company-website` field filled. It is
> recorded `REJECTED — Honeypot triggered`, and the bot receives a response
> identical to a real success.

---

## 2. The lead is scored and worked

**Leads.** The new lead is there with a score. Open it:

- **Lead score** with six named factors, each showing the points it contributed
- **Relationship** — a band plus *stated confidence*. On a brand-new contact it
  reads "Weak · low confidence" and says to treat it as a first impression
- **Agent** — empty until the agent has looked at this record

Change status to `QUALIFIED`, then **Convert** it to a deal.

---

## 3. The deal moves

**Deals.** Drag the card between stages, or focus it and use the arrow keys —
the board is fully keyboard-operable.

Open the deal: stage history records who moved it and when, health shows a band
with named risks, and line items compute totals server-side.

> A deal with an unresolved critical risk is never shown as healthy, however
> well it scores elsewhere.

**Forecast** shows commit / best case / pipeline, weighted by the per-stage
probability set in **Settings → Pipeline stages**. Deals with no close date are
reported separately rather than silently included.

---

## 4. Automation

**Sequences.** Build a multi-step cadence and enrol the contact. It sends during
business hours, exits on reply, and re-checks opt-out at the moment of sending
rather than only at enrolment.

**Automation.** Workflows fire on CRM events — lead created, status changed,
deal stage reached, score threshold crossed.

**Describe an automation** (API only, no UI yet) — POST to
`/api/v1/workspaces/<WS_ID>/workflows/compile` with a JSON body containing a
`description` such as *"When someone messages refund, wait 30 minutes then send
an apology and create a task to call them back"*.

It returns a **draft** workflow (`isActive: false`) plus a plain-English
read-back. It never activates itself. Asking for something the engine cannot do
is refused with the available steps listed, rather than silently producing a
workflow that saves and never fires.

> Currently returns 503 — the Gemini key's free tier is 20 requests per day.

---

## 5. Support

**Tickets → New ticket.** Priority sets the response target: Urgent 2h, High 8h,
Normal 24h, Low 72h.

Open it and note that only the transitions the lifecycle permits are offered — a
new ticket offers Open / Waiting / Resolved / Closed; a resolved one offers only
Open / Closed.

Now raise the priority on an older ticket. A warning appears **before** you apply
it: the deadline is measured from when the ticket was filed, not from now, so it
may go overdue immediately. Apply it and watch that come true.

Resolve it — the clock stops, and it leaves the overdue queue even if it was
past target.

---

## 6. Ask the CRM

The green **Ask your CRM** button, bottom right of any dashboard page.

Try *"Which deals are at risk?"* or *"What should I do first today?"*. Tool names
appear under each answer, so you can see what it read.

Then ask it to change something — *"Create a task to call Meera tomorrow"*. It
returns a **proposal**: "Nothing has changed yet. This runs only if you confirm
it." The model cannot write; only your click can.

> With the quota spent it answers from the deterministic recommendations engine
> instead, and labels itself *"Answered without the assistant provider."*

---

## 7. The autonomous agent

This one runs on its own — a tick every 5 minutes, a sweep hourly. To see it
immediately, POST to `/api/v1/workspaces/<WS_ID>/agent/run`.

It currently picks up two things: open deals untouched for 14+ days with nothing
scheduled, and leads still marked `NEW`.

Open any lead or deal it touched and look at the **Agent** section:

- **Changes it made** — with the evidence that justified each
- **Waiting on you** — claims that did not clear the bar, with Accept / Reject
- **Every pass** — including the ones that did nothing
- **Booked next** — with the reason it scheduled itself

**The test worth doing.** Create two `NEW` leads. Send one an outbound message;
leave the other untouched. Run the agent. The messaged lead moves to
`CONTACTED`; the untouched one stays `NEW`, with the rationale *"Discarded
unverifiable: crm.outbound-delivered"*.

Identical claimed evidence, different outcome — because the server checks the
claim against the database rather than trusting it.

---

## 8. Progress

**Profile → Your Progress.** Level, streak, daily missions, achievements,
recently earned, and the earning table.

Points come only from outcomes — closing a deal, qualifying a lead, resolving a
ticket. Nothing rewards message volume, because on a per-message platform that
would pay people to burn the wallet.

The leaderboard is hidden until you ask for it, and reports names and points
only — never pipeline value.

---

## 9. The rest

**Cmd/Ctrl + K** anywhere for the command palette. Under TEAM or OWN visibility
(**Settings → Teams**) it returns only records you can actually open.

**Marketing page** at `/` when signed out. Its FAQ answers are in the DOM
without clicking, and the structured data in `index.html` quotes them verbatim.

---

## Running the tests

```bash
cd backend && node --env-file=.env scripts/assert-local-db.js && npm test
```

277 tests. `TEST_EVIDENCE.md` records every defect found, with its failing
output before the fix and its passing output after.

---

## Known limits while testing

| Limit | Effect |
|---|---|
| Gemini free tier is 20 requests/day | Copilot and compiler fall back to deterministic behaviour once spent |
| No UI for the workflow compiler | `POST /workflows/compile` only |
| Agent covers ~1.5 of 10 pipeline touchpoints | See `AGENT_ROADMAP.md` |
| Agent tools run in-process | Sandbox is Phase 1 of the roadmap |
| Marketing page is client-rendered | Non-JS crawlers see an empty `#root` |
