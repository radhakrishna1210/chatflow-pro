# Agent roadmap

What is left to build in the agentic layer, in the order worth building it.

Written after reading [trycompai/crm](https://github.com/trycompai/crm) (MIT) in
full — see `ATTRIBUTION.md`. Their agent has 27 tools; ours has 2 autonomous
actions and 11 read tools. The gap is not polish, it is whole categories.

**Where we stand today.** The control machinery is built and tested: evidence
ledger, deny-when-unattended, `FOR UPDATE SKIP LOCKED` claiming, per-record
audit, verified-before-priced evidence. The capability machinery mostly is not.
We have the brakes and the steering; they also have the engine.

**Pipeline coverage today:** the sweep books work for exactly two things — open
deals untouched 14+ days with nothing scheduled, and leads still marked `NEW`.
That is roughly 1½ of the ~10 points in the pipeline where work happens.

---

## Phase 1 — Contain it

**Why first:** every capability added later inherits this blast radius. The
agent's tools currently run inside the API process with full Prisma access.
trycompai/crm runs theirs under `defineSandbox({ networkPolicy: "deny-all" })`
with no database access at all — a shell with neither credentials nor egress is
just a text processor.

| # | Item | Notes | Est |
|---|---|---|---|
| 1.1 | Move tool execution out of the API process | Child process or container. The agent process gets a narrow RPC surface, not `prisma`. | 2d |
| 1.2 | Deny-all egress from the tool process | No outbound network unless a tool explicitly declares it (matters from Phase 4 onward). | 0.5d |
| 1.3 | Capability manifest per tool | Declare what each tool may touch; the host enforces it rather than trusting the tool. | 0.5d |

---

## Phase 2 — Breadth on what we already own

**Why second:** best ratio in the whole plan. The queue, ledger, audit and
Agent tab all exist, so each new trigger or action is small. This is what takes
pipeline coverage from 1½ of 10 to most of it.

### New sweep triggers (`sweepWorkspace`)

| # | Trigger | Condition | Est |
|---|---|---|---|
| 2.1 | Stalled by stage age | Deal in one stage past that stage's budget (`dealHealth` already computes this) | 0.5d |
| 2.2 | Unassigned high-score lead | `score >= 60`, `ownerUserId` null | 0.25d |
| 2.3 | Ticket approaching breach | Open, `dueAt` within 2h — same window `nextBestAction` uses | 0.5d |
| 2.4 | Quote going cold | `SENT`, no response, past a threshold | 0.5d |
| 2.5 | Deal missing an amount | Open, `value` null — distorts the forecast | 0.25d |
| 2.6 | Sequence stalled | Enrolment `WAITING` far longer than its step | 0.5d |

### New autonomous actions (`ACTIONS`)

| # | Action | Class | Est |
|---|---|---|---|
| 2.7 | `assign_owner` | assertion — needs a rule for *who*, e.g. team round-robin | 1d |
| 2.8 | `flag_for_review` | reminder — creates a task rather than changing the record | 0.25d |
| 2.9 | `schedule_recheck` wired into actions | Exists in the service, no action calls it yet | 0.25d |

### Supporting

| # | Item | Notes | Est |
|---|---|---|---|
| 2.10 | Workspace on/off switch + per-action opt-out | An autonomous agent nobody can turn off is not shippable | 0.5d |
| 2.11 | Admin view of queue and suggestions | `/agent/pending` exists; nothing renders it | 0.5d |

---

## Phase 3 — Conversation intelligence

**Why this is the differentiator.** trycomp's entire enrichment stack —
LinkedIn, GitHub, Perplexity — is a *substitute* for relationship data they do
not have. ChatFlow has the real thing: a two-way WhatsApp stream with every
contact. Their agent is reconstructing what yours can simply read.

Today the ledger's strongest evidence kind, `crm.inbound-reply`, only checks
that a reply **exists**. It never looks at what was **in** it.

| # | Item | Notes | Est |
|---|---|---|---|
| 3.1 | New evidence kinds from message content | `reply.intent-expressed`, `reply.timeline-stated`, `reply.objection-raised`, `reply.competitor-named` | 1d |
| 3.2 | Extraction with verification | The model proposes; the server confirms the quoted span really appears in a stored message before pricing it — same discipline as `verify()` today | 1.5d |
| 3.3 | Quote the evidence in the Agent tab | Show the actual sentence, not a label. A rep checks a quote in one second | 0.5d |
| 3.4 | Sentiment shift after a quote or price | Deal-health signal nobody else can compute for you | 1d |
| 3.5 | Conversation-derived deal risks | Feed into `dealHealth.risks` so it reaches forecasting and next-best-action | 0.5d |

---

## Phase 4 — External enrichment (optional)

**Why last:** after Phase 3 you will know whether external data adds anything
the conversation did not already tell you. Also the phase that most needs
Phase 1 finished — it is the first time the agent talks to the outside world.

| # | Item | Notes | Est |
|---|---|---|---|
| 4.1 | One vendor, one field | Company enrichment from domain. Not a research suite | 1.5d |
| 4.2 | Per-run budget cap | Their `deadline.ts` / `pool.ts` / `budget` param. Vendor calls cost money | 0.5d |
| 4.3 | Enrichment evidence kinds | Weighted **below** anything observed in your own CRM | 0.5d |

---

## Deliberately not planned

Judgements, not oversights:

- **Autonomous customer messaging.** Stays in `SENSITIVE`. The platform bills
  per message and a wrong send cannot be recalled.
- **Autonomous deal closing.** Same. `close_deal` is denied unattended.
- **Sub-agents building sub-agents** (their `agent_builder` / `agent_runner`).
  Enormous surface, unclear value at this size.
- **Identity resolution across external sources.** Only matters with Phase 4,
  and it is a genuine research problem, not a sprint.
- **Their Slack integration.** Different product decision entirely.

---

## Unfinished from the current build

Small, and not part of any phase:

| # | Item | Est |
|---|---|---|
| 5.1 | UI for the workflow compiler — `POST /workflows/compile` works, nothing calls it | 0.5d |
| 5.2 | Verify the compiler's English→graph step once Gemini quota resets | 10 min |
| 5.3 | Copilot on a paid key — 20 requests/day keeps it in the deterministic fallback | — |

---

## Rough shape

Phases 1–2 are about two weeks and make the agent genuinely useful. Phase 3 is
another week and is where this beats theirs *for this product*. Phase 4 is
optional catch-up.

Full tool-for-tool parity with trycompai/crm is a quarter, and would spend it
matching their strength while leaving ours unused.
