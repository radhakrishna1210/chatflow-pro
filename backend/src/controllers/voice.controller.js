import twilio from 'twilio';
import { prisma } from '../lib/prisma.js';
import { env } from '../config/env.js';
import * as voice from '../services/voice.service.js';

// Twilio Programmable Voice webhooks. Configure the number's "A call comes in"
// URL to POST /api/v1/voice/incoming; the Gather action loops back to
// /api/v1/voice/respond until the caller hangs up or asks for a human.

const XML = (res, body) => res.type('text/xml').status(200).send(body);

const publicBase = () => env.API_PUBLIC_URL.replace(/\/$/, '');
const respondUrl = (callId) => `${publicBase()}/api/v1/voice/respond?callId=${encodeURIComponent(callId)}`;

// Twilio signs every request. Without this an open endpoint would let anyone
// drive the LLM and write VoiceCall rows.
export function verifyTwilioSignature(req, res, next) {
  if (!env.TWILIO_AUTH_TOKEN) {
    console.warn('[Voice] TWILIO_AUTH_TOKEN not set — rejecting call webhook.');
    return res.status(503).type('text/xml').send(voice.hangup('Voice service is not configured.'));
  }
  const signature = req.headers['x-twilio-signature'];
  const url = `${publicBase()}${req.originalUrl}`;
  const valid = twilio.validateRequest(env.TWILIO_AUTH_TOKEN, signature, url, req.body || {});
  if (!valid) {
    console.warn('[Voice] REJECTED — bad X-Twilio-Signature for', url);
    return res.status(403).type('text/xml').send(voice.hangup('Unauthorized.'));
  }
  next();
}

export async function incoming(req, res) {
  const { CallSid, From, To } = req.body || {};

  const workspace = await voice.findWorkspaceForNumber(To);
  if (!workspace) {
    console.warn(`[Voice] No Voice-AI-enabled workspace owns ${To} — rejecting.`);
    return XML(res, voice.hangup('This number is not configured to take calls right now. Goodbye.'));
  }

  const call = await voice.startCall(workspace, { callSid: CallSid, fromPhone: From, toPhone: To });
  const greeting = workspace.voiceAiGreeting || 'Hello! How can I help you today?';
  await voice.appendTurn(call.id, 'agent', greeting);

  return XML(res, voice.say(greeting, { actionUrl: respondUrl(call.id) }));
}

export async function respond(req, res) {
  const { callId } = req.query;
  const spoken = String(req.body?.SpeechResult || '').trim();

  const call = await prisma.voiceCall.findUnique({ where: { id: String(callId || '') } });
  if (!call) return XML(res, voice.hangup('Sorry, something went wrong. Goodbye.'));

  const workspace = await prisma.workspace.findUnique({
    where: { id: call.workspaceId },
    select: { voiceAiName: true, voiceAiPrompt: true, voiceAiPhone: true },
  });

  if (!spoken) {
    await voice.finalizeCall(call.id);
    return XML(res, voice.hangup('I did not hear anything. Goodbye.'));
  }

  await voice.appendTurn(call.id, 'caller', spoken);

  const transcript = Array.isArray(call.transcript) ? call.transcript : [];
  // Hard cap so a looping caller can't run up an unbounded LLM bill.
  if (transcript.length >= voice.MAX_CALL_TURNS * 2) {
    await voice.finalizeCall(call.id);
    return XML(res, voice.hangup('Thanks for calling. Someone from our team will follow up shortly. Goodbye.'));
  }

  let reply;
  let handoff = false;
  try {
    ({ reply, handoff } = await voice.generateCallReply(workspace, transcript, spoken));
  } catch (err) {
    console.error('[Voice] Reply generation failed:', err.message);
    await voice.finalizeCall(call.id);
    return XML(res, voice.hangup('Sorry, I am having trouble right now. Someone will call you back. Goodbye.'));
  }

  if (handoff) {
    const forwardNumber = String(workspace?.voiceAiPhone || '').trim();
    await voice.appendTurn(call.id, 'agent', forwardNumber ? 'Transferring to a colleague.' : 'Will pass to the team.');
    await prisma.voiceCall.update({ where: { id: call.id }, data: { forwarded: Boolean(forwardNumber) } });
    await voice.finalizeCall(call.id);
    return XML(res, forwardNumber
      ? voice.forwardTo(forwardNumber, 'Sure — connecting you to a colleague now.')
      : voice.hangup('Sure — I will have someone call you back shortly. Goodbye.'));
  }

  await voice.appendTurn(call.id, 'agent', reply);
  return XML(res, voice.say(reply, { actionUrl: respondUrl(call.id) }));
}

// Twilio's statusCallback — the only reliable signal that the caller hung up.
export async function status(req, res) {
  const { CallSid, CallStatus } = req.body || {};
  if (['completed', 'busy', 'failed', 'no-answer', 'canceled'].includes(CallStatus)) {
    const call = await prisma.voiceCall.findUnique({ where: { providerCallId: String(CallSid || '') } });
    if (call) await voice.finalizeCall(call.id).catch((err) => console.error('[Voice] finalize failed:', err.message));
  }
  res.status(204).send();
}

export async function listCalls(req, res) {
  try {
    res.json(await voice.listCalls(req.params.workspaceId));
  } catch (err) {
    console.error('[Voice] list error:', err);
    res.status(err.status || 500).json({ error: err.message || 'Failed to list calls' });
  }
}
