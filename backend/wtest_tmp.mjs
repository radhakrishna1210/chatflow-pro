import { createHmac } from 'crypto';
import { PrismaClient } from '@prisma/client';

const p = new PrismaClient();
// Use a real connected number so the handler resolves a workspace.
const num = await p.waNumber.findFirst({ where: { metaPhoneNumberId: '1347751938430316' } });
if (!num) { console.log('no test number'); process.exit(0); }
const PNID = num.metaPhoneNumberId;
const FROM = '919999000111';

const post = async (body) => {
  const raw = JSON.stringify(body);
  const sig = 'sha256=' + createHmac('sha256', process.env.META_APP_SECRET).update(raw).digest('hex');
  const r = await fetch('http://127.0.0.1:4000/api/v1/webhook/meta', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Hub-Signature-256': sig },
    body: raw,
  });
  return r.status;
};
const envelope = (value) => ({ object: 'whatsapp_business_account', entry: [{ id: num.wabaId, changes: [{ field: 'messages', value }] }] });
const meta = { messaging_product: 'whatsapp', metadata: { display_phone_number: num.phoneNumber, phone_number_id: PNID } };
const ts = Math.floor(Date.now() / 1000);
const wamid = (s) => `wamid.TEST_${s}_${ts}`;

console.log('--- 1. text message, delivered twice (Meta retry) ---');
const textMsg = envelope({ ...meta, contacts: [{ profile: { name: 'QA Sender' }, wa_id: FROM }],
  messages: [{ from: FROM, id: wamid('text'), timestamp: String(ts), type: 'text', text: { body: 'hello there' } }] });
console.log('  first  delivery ->', await post(textMsg));
console.log('  repeat delivery ->', await post(textMsg));

console.log('--- 2. image with caption ---');
await post(envelope({ ...meta, contacts: [{ profile: { name: 'QA Sender' }, wa_id: FROM }],
  messages: [{ from: FROM, id: wamid('img'), timestamp: String(ts), type: 'image',
    image: { id: '1234567890', mime_type: 'image/jpeg', sha256: 'abc', caption: 'here is the receipt' } }] }));

console.log('--- 3. location ---');
await post(envelope({ ...meta, contacts: [{ profile: { name: 'QA Sender' }, wa_id: FROM }],
  messages: [{ from: FROM, id: wamid('loc'), timestamp: String(ts), type: 'location',
    location: { latitude: 18.5204, longitude: 73.8567, name: 'Pune Office' } }] }));

console.log('--- 4. voice note (no caption) ---');
await post(envelope({ ...meta, contacts: [{ profile: { name: 'QA Sender' }, wa_id: FROM }],
  messages: [{ from: FROM, id: wamid('aud'), timestamp: String(ts), type: 'audio',
    audio: { id: '999', mime_type: 'audio/ogg; codecs=opus', sha256: 'def' } }] }));

await new Promise(r => setTimeout(r, 3500));

const contact = await p.contact.findFirst({ where: { workspaceId: num.workspaceId, phoneNumber: FROM } });
const convo = contact ? await p.conversation.findFirst({ where: { contactId: contact.id, waNumberId: num.id } }) : null;
const msgs = convo ? await p.message.findMany({ where: { conversationId: convo.id }, orderBy: { createdAt: 'asc' },
  select: { body: true, type: true, status: true, metaMessageId: true, mediaId: true, mediaMimeType: true, locationLat: true, direction: true } }) : [];
console.log('\nStored messages:', msgs.length);
for (const m of msgs) console.log(' ', m.direction, m.type.padEnd(9), m.status.padEnd(9), JSON.stringify(m.body).slice(0,40),
  m.mediaId ? `media=${m.mediaId}/${m.mediaMimeType}` : '', m.locationLat != null ? `loc=${m.locationLat}` : '');
const dupes = msgs.filter(m => m.metaMessageId?.includes('_text_')).length;
console.log('copies of the retried text message:', dupes, dupes === 1 ? '(idempotent)' : '(DUPLICATED)');
console.log('conversation lastInboundAt set:', !!(convo?.lastInboundAt));
process.exit(0);
