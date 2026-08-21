import { createHmac } from 'crypto';
import { PrismaClient } from '@prisma/client';
const p = new PrismaClient();
const num = await p.waNumber.findFirst({ where: { metaPhoneNumberId: '1347751938430316' } });
const PNID = num.metaPhoneNumberId, FROM = '919999000222';
// Clean slate for this probe number.
const old = await p.contact.findFirst({ where: { workspaceId: num.workspaceId, phoneNumber: FROM } });
if (old) await p.contact.delete({ where: { id: old.id } });

const post = async (body) => {
  const raw = JSON.stringify(body);
  const sig = 'sha256=' + createHmac('sha256', process.env.META_APP_SECRET).update(raw).digest('hex');
  return (await fetch('http://127.0.0.1:4000/api/v1/webhook/meta', { method:'POST',
    headers: { 'Content-Type':'application/json', 'X-Hub-Signature-256': sig }, body: raw })).status;
};
const meta = { messaging_product:'whatsapp', metadata:{ display_phone_number:num.phoneNumber, phone_number_id:PNID } };
const contacts = [{ profile:{ name:'QA Media' }, wa_id:FROM }];
const env1 = (messages) => ({ object:'whatsapp_business_account', entry:[{ id:num.wabaId, changes:[{ field:'messages', value:{ ...meta, contacts, messages } }] }] });
const ts = Math.floor(Date.now()/1000), W = (s)=>`wamid.T2_${s}_${ts}`;

const msgs = [
  { from:FROM, id:W('text'), timestamp:String(ts), type:'text', text:{ body:'hello there' } },
  { from:FROM, id:W('img'),  timestamp:String(ts), type:'image', image:{ id:'IMG1', mime_type:'image/jpeg', sha256:'a', caption:'here is the receipt' } },
  { from:FROM, id:W('loc'),  timestamp:String(ts), type:'location', location:{ latitude:18.5204, longitude:73.8567, name:'Pune Office' } },
  { from:FROM, id:W('aud'),  timestamp:String(ts), type:'audio', audio:{ id:'AUD1', mime_type:'audio/ogg', sha256:'b' } },
  { from:FROM, id:W('doc'),  timestamp:String(ts), type:'document', document:{ id:'DOC1', mime_type:'application/pdf', filename:'invoice.pdf', sha256:'c' } },
];
// All in one delivery, plus a full retry of the batch.
console.log('batch delivery      ->', await post(env1(msgs)));
console.log('retry same batch    ->', await post(env1(msgs)));

// A delivery status for one of our own outbound messages.
await new Promise(r=>setTimeout(r,2500));
process.exit0 = 0;
const contact = await p.contact.findFirst({ where:{ workspaceId:num.workspaceId, phoneNumber:FROM } });
const convo = await p.conversation.findFirst({ where:{ contactId:contact.id, waNumberId:num.id } });
const stored = await p.message.findMany({ where:{ conversationId:convo.id }, orderBy:{ createdAt:'asc' },
  select:{ body:true, type:true, status:true, mediaId:true, mediaMimeType:true, mediaFilename:true, locationLat:true } });
console.log('\nstored messages:', stored.length, '(5 expected — the retry must add none)');
for (const m of stored) console.log(' ', m.type.padEnd(9), m.status.padEnd(9), JSON.stringify(m.body).slice(0,32).padEnd(34),
  [m.mediaId && `media=${m.mediaId}`, m.mediaFilename, m.mediaMimeType, m.locationLat!=null && `lat=${m.locationLat}`].filter(Boolean).join(' '));
process.exit(0);
