// Simulates a Meta inbound webhook against a local backend, signed the way
// Meta signs it. Lets the campaign CTA and the follow-up questions be tested
// without a live WhatsApp number.
//
// Run from backend/ so --env-file picks up META_APP_SECRET:
//   node --env-file=.env <path>/simulate-inbound.mjs --pn <metaPhoneNumberId> --from 919876543210 --tap <campaignRecipientId>
//   node --env-file=.env <path>/simulate-inbound.mjs --pn <metaPhoneNumberId> --from 919876543210 --text "Price?"
import { createHmac } from 'node:crypto';

const args = Object.fromEntries(
  process.argv.slice(2).reduce((acc, cur, i, arr) => (cur.startsWith('--') ? [...acc, [cur.slice(2), arr[i + 1]]] : acc), []),
);

const { pn, from, tap, text, port = '4000', label = 'Ask Anything' } = args;
if (!pn || !from || (!tap && !text)) {
  console.error('Usage: --pn <metaPhoneNumberId> --from <digits> (--tap <recipientId> | --text "msg") [--port 4000] [--label "Ask Anything"]');
  process.exit(2);
}
if (!process.env.META_APP_SECRET) {
  console.error('META_APP_SECRET is not set — run this with `node --env-file=.env`.');
  process.exit(2);
}

const message = {
  from,
  id: `wamid.SIM${Math.random().toString(36).slice(2)}`,
  timestamp: String(Math.floor(Date.now() / 1000)),
  ...(tap
    // A template quick-reply tap: Meta echoes the payload the send attached.
    ? { type: 'button', button: { payload: `cfp_campaign_ai:${tap}`, text: label } }
    : { type: 'text', text: { body: text } }),
};

const body = JSON.stringify({
  object: 'whatsapp_business_account',
  entry: [{
    id: 'WABA_SIM',
    changes: [{
      field: 'messages',
      value: {
        metadata: { phone_number_id: pn },
        contacts: [{ profile: { name: 'Test Customer' }, wa_id: from }],
        messages: [message],
      },
    }],
  }],
});

const res = await fetch(`http://localhost:${port}/api/v1/webhook/meta`, {
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
    'X-Hub-Signature-256': 'sha256=' + createHmac('sha256', process.env.META_APP_SECRET).update(body).digest('hex'),
  },
  body,
});
console.log(res.status, await res.text());
console.log(tap ? `Sent CTA tap for recipient ${tap}` : `Sent "${text}"`);
console.log('The webhook replies immediately and processes in the background — give it a few seconds, then check the backend log and the Inbox.');
