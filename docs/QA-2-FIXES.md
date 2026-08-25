# QA Round 2 — defect fixes

Response to `qa_testing_2.pdf` (Spandan — Comprehensive Module-Wise Testing
Report, 24 August 2026).

Every defect in section 15 of that report is addressed below, with the change
that fixes it and the automated check that proves it. The checks live in
`backend/tests-qa2-automation.mjs` and run the real inbound pipeline
(`processWebhook`) against the database, with Meta's Graph API replaced by a
recording stub.

The suite also walks all nine tabs of the Automation screen end to end,
including the two modules the report could not reach — Instagram Quickflows
(*Pending*) and Voice AI (*blocked on Twilio*). 164 checks, all passing.

```
cd backend && node --env-file=.env tests-qa2-automation.mjs
```

---

## Status of each reported defect

| ID | Module | Defect | Status |
|----|--------|--------|--------|
| BUG-01 | Basic Automations | Working Hours reset after disable/enable | **Fixed** |
| BUG-02 | Workflows | Active workflow cannot be interrupted | **Fixed** |
| BUG-03 | AI Intent Matching | General messages inconsistently routed | **Fixed** |
| BUG-04 | AI Intent Matching | Synonyms/typos not recognised | **Fixed** |
| BUG-05 | Cross-module | Overlapping automation triggers conflict | **Fixed** |
| BUG-06 | Smart Lists | `phoneNumber` missing in Prisma create | **Fixed** |
| BUG-07 | Welcome Automation | Repeated/new-contact behaviour inconsistent | **Fixed** |
| BUG-08 | Voice AI | Live testing needs Twilio | **Not a code defect** — see below |
| — | Cross-module | Unmatched message switched automation off for good | **Fixed** — found while testing BUG-03 |

---

## BUG-06 · Smart Lists could not create a contact (Priority 1)

**Cause.** The Smart Lists "Add Customer" form sent `{ name, phone }`. The API
and the Prisma `Contact` model both call that column `phoneNumber`, so the field
arrived as an unrecognised extra and `prisma.contact.create()` was invoked with
no phone number at all.

The same mismatch broke *editing* a contact, which QA did not reach: the PATCH
route validates with `contactSchemas.update`, which is `.strict()`, so a body
containing `phone` was rejected outright.

**Fix.**
- `frontend/src/pages/AutomationView.jsx` now sends `phoneNumber` on both create
  and edit, trimmed.
- `backend/src/services/segments.service.js` accepts `phoneNumber` *or* the
  legacy `phone` alias, so an older cached bundle keeps working; normalises the
  number (strips spaces, dashes and brackets, keeps a leading `+`); rejects an
  empty value with a `400 Phone number is required` rather than letting Prisma
  throw; and reuses an existing contact with the same number instead of
  colliding with the `(workspaceId, phoneNumber)` unique index.

**Verified.** Adding `Test User / 9689607480` creates the contact; the legacy
`phone` payload works; re-adding the same number reuses the contact; a missing
number returns a clean 400.

---

## BUG-01 · Working Hours reset after disable/enable (Priority 5)

**Cause.** There was no separate "enabled" flag. The feature switch was encoded
as *"is `Workspace.businessHours` null?"*, so turning working hours **off**
wrote `null` and destroyed the saved schedule. Turning it back on then saved
whatever the UI was showing — which, after the reload, was the 09:00–18:00
default.

**Fix.** The schedule and the switch are now stored together but kept
independent. `businessHours` holds `{ tz, enabled, days }`, and the two are
edited separately:

- `businessHours.service.js` gained `isBusinessHoursEnabled()` and
  `mergeBusinessHours()`; `isWithinBusinessHours()` treats a disabled schedule as
  "always open" without touching the stored days.
- `automation.service.js` merges a schedule edit and a switch edit onto what is
  already stored, so neither can clobber the other.
- The API keeps exposing `businessHours` and `businessHoursEnabled` as two
  fields, and the UI toggle now patches only `businessHoursEnabled`.

**No migration is required.** Existing rows read back correctly: a stored blob
with no `enabled` key was written when non-null meant "on", so it reads as
enabled; `null` reads as disabled.

**Verified.** Monday 10:00–17:00 → off → on still reads 10:00–17:00.

---

## BUG-02 · An active flow could not be interrupted (Priority 2)

**Cause.** A form or workflow in flight consumed every message. "bye", "done"
and "cancel" were filed as answers to the question on screen, and the flow kept
re-asking. A workflow parked on a delay would also wake up later and carry on
messaging someone who had already left.

**Fix.** A new module, `backend/src/services/conversationControl.service.js`,
recognises global control commands, and the inbound handler now checks for them
before any flow gets the message:

| Command | Also matches | Effect |
|---|---|---|
| `cancel` | stop, quit, exit, abort, nevermind, forget it | Ends the flow, confirms |
| `restart` | start over, start again, reset | Re-asks question one |
| `done` | finished, complete, that's all | Ends the flow, acknowledges |
| `bye` | goodbye, see you, take care | Ends the flow, says goodbye |
| `human` | agent, representative, talk to someone | Ends the flow, hands to a person |

Guards against false positives: only messages of four words or fewer count,
politeness words are stripped first (`please stop` → `stop`), and typo tolerance
applies to single-word messages only. **"I want to cancel my order and get a
refund" is still an ordinary message,** not the cancel command.

Interrupting also cancels any workflow run parked on a delay
(`cancelActiveRuns`), so a resume that fires later finds the run closed and
sends nothing.

**Verified.** "bye" at the urgency question ends the form instead of re-asking;
"done", "cancel" and "restart" behave as the table says; a parked workflow run
is cancelled and a late resume sends nothing.

### One deliberate deviation from the report

The report lists `stop` among the interruption commands. **`stop` still opts the
contact out**, because it is the phrase WhatsApp expects a business to honour as
an unsubscribe, and a form being open is not a good reason to ignore one.
Opting out stops the flow anyway, since it suppresses every outbound message.

However, `cancel`, `quit` and `end` were *also* opt-out keywords — so QA's own
"cancel mid-form" test was silently unsubscribing the contact from the
workspace. Those three now mean "leave the flow" while a flow is open, and still
opt out otherwise. `stop` and `unsubscribe` are unchanged in every case.

---

## BUG-03 · General/fallback messages inconsistently handled (Priority 3)

**Cause.** "hi", "bye", "thanks" and "working hours" matched nothing
deterministic and fell through to the AI agent. When the agent had nothing to
say the thread was escalated to a human — which **suppressed automation on that
conversation from then on.** One unanswerable "working hours" message could
therefore silence every later automation, which is the inconsistency QA saw.

**Fix.** A general-conversation layer sits between the workspace's own
automations and the AI agent, covering greeting, goodbye, thanks, business hours
and help. It only catches what nothing above it claimed, so a workspace that has
built its own greeting trigger keeps using it.

"What are your working hours?" is answered from the workspace's actual Working
Hours configuration, collapsing consecutive days
(`Monday–Friday: 09:00–18:00`). When working hours are switched off it says the
business is reachable any time, rather than returning nothing and triggering the
escalation cascade described above.

**Verified.** Hi / Hello / Bye / thanks / Working hours all get an appropriate
answer, and the configured Monday window is quoted back.

---

## BUG-04 · Synonyms and typos not recognised (Priority 3)

**Cause.** Two separate exact-match problems.

1. Form choice questions accepted only the option text verbatim, so `Urrget`,
   `urgently`, `very urgent` and `Technical issue` were all rejected.
2. Intent phrase scoring compared whole words, so `order stauts` scored 0.

**Fix.** `matchOption()` resolves a free-text answer through five tiers — the
number, exact text, filler-stripped text (`this is urgent` → `urgent`),
containment, a synonym table, then a length-scaled Levenshtein distance. The
typo tier refuses to guess when two options are equally close, so an ambiguous
answer is re-asked rather than filed under the wrong option. Resolved answers
are stored as the *configured* option, so reports show `Urgent` whether the
customer wrote `urgently` or `2`.

Intent phrase scoring gained the same typo allowance, weighted slightly below an
exact word match so a clean match still wins.

**Verified.** `Urrget` → Urgent, `Technical issue` → Technical problem,
`this is very urgent` → Urgent, and `banana` is still rejected. `order stauts`
and `trackign` now match Order Status above the 0.6 threshold.

### On "do you have this in size 9?"

The report is right that this is not an Order Status defect — the message is
semantically unrelated to order tracking. With a `Size Availability` intent
configured as the report recommends, it now matches that intent at full
confidence instead of falling through at 0%. This is verified in the suite.

---

## BUG-05 · Overlapping automations conflict (Priority 4)

**Fix.** The routing order is now written down as a contract at the head of
`handleInboundMessage`, and anything added later has to be given a place in it:

```
 1. Opt-out              stop / unsubscribe always win
 2. Human handoff        a person has the thread; automation stays out
 3. Global commands      cancel / bye / done / exit / restart / human
 4. Campaign AI session
 5. Form in flight
 6. Workflows
 7. Escalation rules
 8. Exact keyword trigger
 9. Intent rules
10. Fuzzy keyword trigger
11. Welcome / out-of-office
12. General conversation  greeting, goodbye, thanks, working hours
13. AI agent
14. Fallback              hand to a person rather than say nothing
```

Earlier layers are more deterministic and more specific; the model only ever
sees what nothing above it claimed. This matches the hierarchy the report
recommended.

**Verified.** With both a `hi` keyword trigger and the built-in greeting active,
exactly one reply is sent and it is the workspace's own trigger. With a form
open, the form outranks the keyword trigger.

---

## BUG-07 · Welcome automation behaviour inconsistent

**Cause.** Two problems. The welcome could be sent more than once, and the new
general-greeting layer initially reused the welcome text — so a returning
customer saying "hello" was welcomed to the business all over again.

**Fix.** The rule is now stated in one place: greet a first-time contact, or one
returning after more than a day, and only if we have not already sent that
welcome inside the same window. The check reads the message history, so no
schema migration is needed. A repeat greeting gets a plain greeting, not the
welcome message.

**Verified.** The first "Hi" gets the workspace welcome; the next message does
not repeat it but still gets a greeting.

---

## Also fixed · An unanswered message switched automation off for good

Not in the report as its own defect, but it is the mechanism behind BUG-03 and
it was found while writing the tests for it.

**Cause.** When nothing in the chain matched, the message went to the AI agent.
If the agent returned nothing — including the ordinary case of *no agent being
deployed at all* — the conversation was handed to a human. That sets
`humanHandoffAt`, which suppresses automation on the thread from then on.

So on a workspace with no AI agent (the default), **the first message that
matched nothing permanently switched off every keyword trigger, workflow and
form for that contact.** Every later message got no response whatsoever. That is
exactly the "sometimes received no appropriate workflow response" behaviour in
section 6 of the report, and why the same message could behave differently
depending on what the customer had said earlier.

**Fix.** Handing over now happens only when an agent was actually deployed and
could not answer. With no agent deployed the message is left unanswered — it is
in the inbox, unread, and the delayed-response automation exists precisely to
chase a thread nobody has replied to.

**Verified.** After an unanswerable message, the conversation is not handed
over, and the next keyword trigger and greeting still work.

---

## BUG-08 · Voice AI — not a code defect, and now covered by tests

Confirmed as the report states: a live call needs a Twilio number, and there is
nothing to fix in the application.

What *can* be verified without Twilio is now verified — the suite drives the
Programmable Voice webhooks through the controller directly, which covers steps
5 through 9 of the report's validation plan:

- an inbound number routes to the workspace that owns it (and an unknown number
  routes nowhere);
- the call is answered with the configured greeting, wrapped in
  `<Gather input="speech">`;
- a `VoiceCall` row is created and every turn is transcribed;
- the caller's speech gets a spoken reply;
- silence hangs up and finalises the call;
- the caller is captured as a `Contact` tagged *Voice AI Lead*;
- Twilio's status callback finalises a call the caller hung up on, answering 204;
- `forwardTo` emits a `<Dial>` to the configured handoff number;
- TwiML escapes special characters;
- an unsigned webhook request is rejected.

What still needs a real Twilio number: audio quality, speech recognition
accuracy, and an actual transferred call.

**Note.** The suite runs with no LLM provider configured, so the receptionist
takes its deterministic fallback. That is the behaviour that has to hold when
the provider is down, and it keeps the suite free and repeatable.

---

## Instagram Quickflows — now tested

Reported as *Pending*. The module was already implemented; it is now covered end
to end by driving `processInstagramWebhook` with real Meta event payloads:

- DM and comment quickflows are created, listed, updated and deleted, and the
  keyword is normalised to upper case;
- an incoming DM matching a keyword gets the quickflow reply, and the trigger
  counter increments;
- a comment gets a public reply, and `alsoSendDm` additionally sends a DM;
- **loop protection holds** — our own outbound DM echoing back (`is_echo`) and
  our own comment reply are both ignored, so the account cannot talk to itself;
- an event for an Instagram account no workspace has connected is dropped;
- an inactive quickflow does not reply.

What still needs a real Instagram account: the OAuth connect flow
(`completeOAuth`) and Meta's live webhook subscription.

---

## Test results

164 checks, all passing. The first ten sections are the reported defects; the
rest walk the Automation screen's nine tabs end to end.

```
■ BUG-06 · Smart Lists — add customer                          5
■ BUG-01 · Working Hours survive disable/enable                7
■ BUG-03/07 · Greeting and welcome behaviour                   8
■ BUG-03 · "Working hours" answers from the saved schedule     1
■ BUG-02/04 · WhatsApp form — interruption and fuzzy answers  16
■ BUG-02 · Workflow interruption                               5
■ BUG-02 · "human" hands the thread over                       3
■ BUG-03/04 · Intent matching                                  5
■ BUG-05 · Overlapping automations resolve in one order        4
■ Opt-out compliance is not weakened                           1
■ Tab · Custom Auto Reply (keyword triggers)                   8
■ Tab · Workflows (builder + engine)                          13
■ Tab · AI Intent Matching (rule CRUD and routing)             9
■ Tab · WhatsApp AI Agent (configuration and guards)          16
■ Tab · Instagram Quickflows                                  13
■ Tab · Voice AI (inbound call state machine)                 22
■ Tab · WhatsApp Forms (builder and submissions)              13
■ Tab · Smart Lists (segment CRUD)                             8
■ Unmatched messages do not seize the conversation             4
■ Negative testing                                             3
                                                    Passed: 164
```

### Tab coverage

| Tab | Covered |
|---|---|
| Basic Automations | Working hours persistence, welcome, out-of-office, greeting/goodbye/thanks |
| Custom Auto Reply | Trigger CRUD, whole-word matching, activation, independence from out-of-office |
| Workflows | Builder CRUD, keyword trigger, `{{name}}` variables, conditions and skip counts, tag and buttons steps, run traces, interruption |
| AI Intent Matching | Rule CRUD, duplicate names, live tester, all four routing actions, accuracy recording, typo tolerance |
| WhatsApp AI Agent | Config CRUD, readiness, escalation rules and threshold, both deploy guards, intent-matching switch |
| Instagram Quickflows | Flow CRUD, DM/comment/story routing, loop protection, unconnected accounts, activation |
| Voice AI | Number routing, greeting TwiML, transcript, reply, silence teardown, lead capture, status callback, signature guard |
| WhatsApp Forms | Form CRUD, question keys, validation, completion, submissions, contact enrichment, draft status |
| Smart Lists | Segment CRUD, contact add/edit/remove, phone normalisation, 404s |

The suite creates its own workspace, number, contact and conversation, and
deletes them afterwards. It writes to whatever database `backend/.env` points
at, so run it against a development database.

It runs with no LLM provider configured, so every model-backed path takes its
deterministic fallback. That keeps the suite free and repeatable, and those
fallbacks are the behaviour that has to hold when the provider is down.

### Note on the older suites

`tests-e2e-v2.mjs` reports two failures (`registration returns no workspace`,
`creating a workspace grants ADMIN`). These are **pre-existing** — the same two
failures occur on an unmodified checkout — and are unrelated to these changes;
that suite cannot complete its auth setup in this environment.
