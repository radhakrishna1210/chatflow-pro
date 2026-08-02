import { prisma } from '../lib/prisma.js';
import { llmText, llmAvailable } from '../lib/llm.js';

// Voice AI — inbound calls. The tab used to persist four settings that nothing
// read; there was no call handling anywhere in the backend. This drives a real
// call over Twilio's Programmable Voice webhooks: <Gather input="speech">
// transcribes the caller, an LLM answers using the workspace's prompt, and the
// exchange is stored as a VoiceCall with a captured lead at the end.
//
// Twilio is already a dependency (used by admin.service.js for number sync), so
// no new provider integration is introduced here.

const MAX_TURNS = 12;

const esc = (s) => String(s ?? '')
  .replace(/&/g, '&amp;')
  .replace(/</g, '&lt;')
  .replace(/>/g, '&gt;')
  .replace(/"/g, '&quot;');

export function say(text, { gather = true, actionUrl } = {}) {
  const voice = '<Say voice="Polly.Joanna">';
  if (!gather) {
    return `<?xml version="1.0" encoding="UTF-8"?><Response>${voice}${esc(text)}</Say><Hangup/></Response>`;
  }
  return `<?xml version="1.0" encoding="UTF-8"?><Response>` +
    `<Gather input="speech" speechTimeout="auto" action="${esc(actionUrl)}" method="POST">` +
    `${voice}${esc(text)}</Say>` +
    `</Gather>` +
    // Reached only when the caller says nothing at all.
    `${voice}Sorry, I didn't catch that. Goodbye.</Say><Hangup/>` +
    `</Response>`;
}

export function hangup(text) {
  return say(text, { gather: false });
}

// Dials the workspace's forwarding number and ends the AI leg.
export function forwardTo(number, text) {
  return `<?xml version="1.0" encoding="UTF-8"?><Response>` +
    `<Say voice="Polly.Joanna">${esc(text)}</Say>` +
    `<Dial>${esc(number)}</Dial>` +
    `</Response>`;
}

// Routes an inbound call to the workspace that owns the dialled number.
export async function findWorkspaceForNumber(toPhone) {
  const digits = String(toPhone || '').replace(/[^\d]/g, '');
  if (!digits) return null;

  const candidates = await prisma.workspace.findMany({
    where: { voiceAiEnabled: true, NOT: { voiceAiInboundPhone: '' } },
    select: {
      id: true, voiceAiInboundPhone: true, voiceAiName: true,
      voiceAiPrompt: true, voiceAiPhone: true, voiceAiGreeting: true,
    },
  });
  return candidates.find((w) => String(w.voiceAiInboundPhone).replace(/[^\d]/g, '') === digits) || null;
}

export async function startCall(workspace, { callSid, fromPhone, toPhone }) {
  return prisma.voiceCall.upsert({
    where: { providerCallId: callSid },
    update: {},
    create: {
      workspaceId: workspace.id,
      providerCallId: callSid,
      fromPhone,
      toPhone,
      status: 'IN_PROGRESS',
      transcript: [],
    },
  });
}

export async function appendTurn(callId, role, text) {
  const call = await prisma.voiceCall.findUnique({ where: { id: callId }, select: { transcript: true } });
  const transcript = Array.isArray(call?.transcript) ? call.transcript : [];
  transcript.push({ role, text, at: new Date().toISOString() });
  return prisma.voiceCall.update({ where: { id: callId }, data: { transcript } });
}

// Generates the receptionist's next line. Returns { reply, handoff } — handoff
// asks the caller be transferred to a human.
export async function generateCallReply(workspace, transcript, callerText) {
  if (!llmAvailable()) {
    return { reply: "Thanks for calling. I'll take your details and have someone call you back. What's your name?", handoff: false };
  }

  const history = transcript
    .slice(-8)
    .map((t) => `${t.role === 'caller' ? 'Caller' : 'You'}: ${t.text}`)
    .join('\n');

  const system = [
    `You are ${workspace.voiceAiName}, a phone receptionist. ${workspace.voiceAiPrompt}`,
    '\nRules:',
    '- This is a live phone call. Reply in ONE short spoken sentence — no lists, no markdown, no emoji.',
    '- Your goal is to capture the caller\'s name, what they need, and a contact detail.',
    '- Never invent prices, availability, or policies.',
    '- If the caller asks for a human, or is angry, or you cannot help, reply with exactly: TRANSFER',
  ].join('\n');

  const prompt = `${history ? `Call so far:\n${history}\n\n` : ''}Caller: ${callerText}\n\nYou:`;
  const reply = await llmText(prompt, system);
  if (!reply) return { reply: 'Sorry, could you say that again?', handoff: false };

  const clean = reply.trim().replace(/^["']|["']$/g, '');
  if (/^TRANSFER\b/i.test(clean)) return { reply: '', handoff: true };
  return { reply: clean.slice(0, 400), handoff: false };
}

// End of call: ask the model to pull a lead out of the transcript, then upsert
// the caller as a Contact so they land in the CRM like any other lead.
export async function finalizeCall(callId) {
  const call = await prisma.voiceCall.findUnique({ where: { id: callId } });
  if (!call || call.status === 'COMPLETED') return call;

  const transcript = Array.isArray(call.transcript) ? call.transcript : [];
  let leadName = null;
  let leadEmail = null;
  let leadSummary = null;

  if (transcript.length > 0 && llmAvailable()) {
    const text = transcript.map((t) => `${t.role}: ${t.text}`).join('\n');
    const raw = await llmText(
      `Call transcript:\n${text}\n\nJSON:`,
      'Extract the caller\'s details from a phone transcript. Reply with ONLY JSON: {"name": string|null, "email": string|null, "summary": string}. summary is one sentence on what they wanted.',
    ).catch(() => null);
    try {
      const parsed = JSON.parse(String(raw).replace(/```(?:json)?/gi, '').trim());
      leadName = parsed.name || null;
      leadEmail = parsed.email || null;
      leadSummary = parsed.summary || null;
    } catch {
      // A non-JSON reply is not worth failing the call teardown over — the
      // transcript is still saved and readable in the UI.
      leadSummary = transcript.find((t) => t.role === 'caller')?.text?.slice(0, 200) || null;
    }
  } else if (transcript.length > 0) {
    leadSummary = transcript.find((t) => t.role === 'caller')?.text?.slice(0, 200) || null;
  }

  let contactId = null;
  try {
    const contact = await prisma.contact.upsert({
      where: { workspaceId_phoneNumber: { workspaceId: call.workspaceId, phoneNumber: call.fromPhone } },
      update: leadName ? { name: leadName } : {},
      create: {
        workspaceId: call.workspaceId,
        name: leadName || call.fromPhone,
        phoneNumber: call.fromPhone,
        ...(leadEmail ? { email: leadEmail } : {}),
        tags: ['Voice AI Lead'],
      },
    });
    contactId = contact.id;
  } catch (err) {
    console.error('[Voice] Could not upsert contact from call:', err.message);
  }

  const durationSec = Math.max(0, Math.round((Date.now() - new Date(call.startedAt).getTime()) / 1000));

  return prisma.voiceCall.update({
    where: { id: callId },
    data: { status: 'COMPLETED', leadName, leadEmail, leadSummary, contactId, durationSec, endedAt: new Date() },
  });
}

export async function listCalls(workspaceId, limit = 50) {
  return prisma.voiceCall.findMany({
    where: { workspaceId },
    orderBy: { startedAt: 'desc' },
    take: Math.min(limit, 200),
  });
}

export const MAX_CALL_TURNS = MAX_TURNS;
