// Turning one Meta `messages` webhook entry into the row we store.
//
// The old handler understood four shapes — text, button, and the two
// interactive replies — and produced an empty body for everything else. An
// image, a voice note, a PDF, a shared location or a forwarded contact card all
// arrived as a blank message with no record that anything had been attached, so
// the inbox showed a customer saying nothing at all.

// What to show in a message list for a media message that carries no caption.
// The type is stored separately; this is only the human-readable stand-in.
export const PLACEHOLDER = {
  IMAGE: '[photo]',
  VIDEO: '[video]',
  AUDIO: '[voice message]',
  DOCUMENT: '[document]',
  STICKER: '[sticker]',
  CONTACTS: '[contact card]',
  LOCATION: '[location]',
  UNSUPPORTED: '[unsupported message type]',
};

// Meta nests the media object under a key named after the type, and every one
// of them carries the same id/mime_type/sha256 shape.
export const MEDIA_TYPES = {
  image: 'IMAGE',
  video: 'VIDEO',
  audio: 'AUDIO',
  voice: 'AUDIO',
  document: 'DOCUMENT',
  sticker: 'STICKER',
};

/**
 * Normalises an inbound Meta message into the fields Message stores.
 * Returns { type, body, media, location, buttonPayload }.
 */
export const FLOW_REPLY_BODY = '[Form submitted]';

// { token, data } from Meta's nfm_reply. `response_json` is a JSON string of
// the screen's inputs plus the flow_token; a reply we cannot read still comes
// back as a flow reply (with no data) so it is never mistaken for text.
function parseFlowReply(reply) {
  let payload = {};
  try {
    const raw = reply?.response_json;
    const parsed = typeof raw === 'string' ? JSON.parse(raw) : raw;
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) payload = parsed;
  } catch {
    payload = {};
  }
  const { flow_token: token, ...data } = payload;
  return { token: token === undefined || token === null ? '' : String(token), data };
}

export function parseInboundMessage(msg) {
  const out = {
    type: 'UNSUPPORTED',
    body: '',
    media: null,
    location: null,
    // Whether an audio message was recorded as a voice note. Kept out of
    // `media` on purpose: `media` is spread straight into the Message row, and
    // Message has no such column — carrying it there made Prisma reject every
    // inbound image, video, audio, document and sticker.
    voice: false,
    buttonPayload:
      msg.button?.payload
      ?? msg.interactive?.button_reply?.id
      ?? msg.interactive?.list_reply?.id
      ?? null,
  };

  if (msg.text?.body) {
    out.type = 'TEXT';
    out.body = msg.text.body;
    return out;
  }

  if (msg.button?.text) {
    out.type = 'BUTTON';
    out.body = msg.button.text;
    return out;
  }

  // A submitted form screen (WhatsApp Flow). The answers arrive as a JSON
  // string alongside the token the screen was sent with; there is no text the
  // customer typed, so the body is a marker for the inbox and nothing more.
  if (msg.interactive?.type === 'nfm_reply' || msg.interactive?.nfm_reply) {
    out.type = 'INTERACTIVE';
    out.body = FLOW_REPLY_BODY;
    out.flowReply = parseFlowReply(msg.interactive.nfm_reply);
    return out;
  }

  if (msg.interactive) {
    out.type = 'INTERACTIVE';
    out.body = msg.interactive.button_reply?.title
      ?? msg.interactive.list_reply?.title
      ?? '';
    return out;
  }

  for (const [key, type] of Object.entries(MEDIA_TYPES)) {
    const node = msg[key];
    if (!node) continue;
    out.type = type;
    // A caption is the customer's actual words; without one the placeholder
    // stands in so the thread does not render a blank bubble.
    out.body = node.caption || PLACEHOLDER[type];
    out.media = {
      mediaId: node.id ?? null,
      mediaMimeType: node.mime_type ?? null,
      mediaFilename: node.filename ?? null,
      mediaSha256: node.sha256 ?? null,
    };
    out.voice = Boolean(node.voice || key === 'voice');
    return out;
  }

  if (msg.location) {
    out.type = 'LOCATION';
    out.body = msg.location.name || msg.location.address || PLACEHOLDER.LOCATION;
    out.location = {
      locationLat: Number(msg.location.latitude),
      locationLng: Number(msg.location.longitude),
      locationName: msg.location.name || msg.location.address || null,
    };
    return out;
  }

  if (Array.isArray(msg.contacts) && msg.contacts.length > 0) {
    out.type = 'CONTACTS';
    const names = msg.contacts.map((c) => c.name?.formatted_name).filter(Boolean);
    out.body = names.length ? `[contact card: ${names.join(', ')}]` : PLACEHOLDER.CONTACTS;
    return out;
  }

  // A reaction is the customer tapping an emoji on one of our messages. It is
  // not something they wrote, so it stays UNSUPPORTED (no automation reads it),
  // but the thread should say what it was rather than "unsupported message".
  if (msg.reaction) {
    out.type = 'UNSUPPORTED';
    out.body = msg.reaction.emoji ? `[reacted ${msg.reaction.emoji}]` : '[removed a reaction]';
    return out;
  }

  // A type we do not handle yet (order, system, …). Recorded as
  // itself rather than dropped, so the thread stays honest about the fact that
  // something arrived — and `msg.type` names what it was.
  out.type = 'UNSUPPORTED';
  out.body = msg.errors?.[0]?.title
    ? `[${msg.errors[0].title}]`
    : `[unsupported message${msg.type ? `: ${msg.type}` : ''}]`;
  return out;
}

// Only a message the customer typed (or spoke in a transcribed voice note)
// should drive keyword triggers, intent matching or an AI reply.
// Matching "STOP" against the placeholder text we invented for a photo
// would be our own words triggering our own automation.
export function carriesCustomerText(parsed) {
  if (!parsed) return false;

  // A submitted form screen carries answers, not words: its body is our own
  // marker and must not match a keyword or reach the AI agent.
  if (parsed.flowReply) return false;

  // A voice note transcribed to text represents the customer's actual words
  if (parsed.type === 'AUDIO') {
    const text = String(parsed.body || '').trim();
    const isTranscribed = Boolean(parsed.transcription) || (text && text !== PLACEHOLDER.AUDIO);
    return Boolean(isTranscribed && text);
  }

  return (parsed.type === 'TEXT' || parsed.type === 'BUTTON' || parsed.type === 'INTERACTIVE')
    && Boolean(parsed.body?.trim());
}
