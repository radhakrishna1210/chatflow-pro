# Third-party attribution

## trycompai/crm

The autonomous agent layer in `backend/src/services/agent.*.js` is derived from
the design of [trycompai/crm](https://github.com/trycompai/crm), which is
distributed under the MIT licence.

No source file was copied. Their agent is written in TypeScript on the `eve`
framework against their own Prisma schema, and does not run outside that
monorepo. What was taken is the architecture, and in places the specific
semantics:

- **Evidence ledger.** Tools report what they observed; a weighted ledger prices
  the observation and the price decides whether a claim is written to the record
  or held back as a suggestion. Confidence scores from tools are refused
  outright. `contradiction` is a first-class evidence kind rather than an
  absence of support. Our weights and kinds differ — theirs price open-web
  research (LinkedIn, GitHub, cited pages), ours price a workspace's own
  messaging and CRM history — but the mechanism is theirs.

- **Deny rather than defer.** Sensitive operations are refused when running
  unattended instead of being queued for later approval. Taken from their
  `apps/agent/agent/lib/approval.ts`:

  ```ts
  isAutomated(session)
    ? { type: "denied", reason: `Not something to do unattended. ${instead}` }
    : "user-approval"
  ```

- **Agent-owned work queue.** The agent runs on its own schedule against its own
  queue, claiming rows with `FOR UPDATE SKIP LOCKED` so several dispatchers take
  disjoint work, and books its own next look with a reason a rep can read.

- **Per-record audit.** Every pass is recorded against the record it touched,
  including the writes that were held back, so "what did it consider and reject"
  is answerable.

### One deliberate divergence

Their ledger prices evidence as the model reports it; the tool description asks
the model not to invent observations it did not make. Ours re-checks each
claimed observation against the database before pricing it, and discards
anything that does not verify.

This is not a correction of their design — it reflects a different exposure.
Their agent researches external sources, and its containment is the sandbox.
This CRM ingests text that customers write directly into it (inbound WhatsApp
messages and public lead-form submissions become contact names, notes and ticket
subjects), and that text is read back by the agent's own tools. Where the input
is attacker-controlled, evidence that cannot be independently confirmed should
not be able to buy an autonomous write.

### Licence

```
MIT License

Copyright (c) 2026 Comp AI

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
```

If any of their source is copied verbatim in future, this notice must travel
with it in the file itself, not only here.
