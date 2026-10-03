// Turning one Meta `messages` webhook entry into the row we store.
//
// The old handler understood four shapes — text, button, and the two
// interactive replies — and produced an empty body for everything else. An
// image, a voice note, a PDF, a shared location or a forwarded contact card all
// arrived as a blank message with no record that anything had been attached, so
// the inbox showed a customer saying nothing at all.

// What to show in a message list for a media message that carries no caption.
// The type is stored separately; this is only the human-readable stand-in.
const PLACEHOLDER = {
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
const MEDIA_TYPES = {
  image: 'IMAGE',
  video: 'VIDEO',
  audio: 'AUDIO',
  document: 'DOCUMENT',
  sticker: 'STICKER',
};

/**
 * Normalises an inbound Meta message into the fields Message stores.
 * Returns { type, body, media, location, buttonPayload }.
 */
export function parseInboundMessage(msg) {
  const out = {
    type: 'UNSUPPORTED',
    body: '',
    media: null,
    location: null,
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
    const caption = typeof node.caption === 'string' ? node.caption.trim() : '';
    if (caption) out.caption = caption;
    out.body = caption || PLACEHOLDER[type];
    out.media = {
      mediaId: node.id ?? null,
      mediaMimeType: node.mime_type ?? null,
      mediaFilename: node.filename ?? null,
      mediaSha256: node.sha256 ?? null,
    };
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

  // A type we do not handle yet (order, reaction, system, …). Recorded as
  // itself rather than dropped, so the thread stays honest about the fact that
  // something arrived — and `msg.type` names what it was.
  out.type = 'UNSUPPORTED';
  out.body = msg.errors?.[0]?.title
    ? `[${msg.errors[0].title}]`
    : `[unsupported message${msg.type ? `: ${msg.type}` : ''}]`;
  return out;
}

// Only a message the customer typed — or said, once a voice note has been
// transcribed (services/inboundMedia.service.js) — should drive keyword
// triggers, intent matching or an AI reply. Matching "STOP" against the
// placeholder text we invented for a photo would be our own words triggering
// our own automation.
//
// A caption on a photo, video or document is the customer's own words, so it
// counts (WF-IN-8): "ORDER 123 arrived damaged" under a photo fires the ORDER
// workflow. The message keeps its media type, so a `media` trigger still sees
// the photo when no keyword claims the caption.
export function carriesCustomerText(parsed) {
  if (!parsed) return false;
  if (parsed.type === 'AUDIO') return Boolean(parsed.transcript?.trim());
  if (parsed.media) return Boolean(parsed.caption?.trim());
  return (parsed.type === 'TEXT' || parsed.type === 'BUTTON' || parsed.type === 'INTERACTIVE')
    && Boolean(parsed.body?.trim());
}

// A tap on a button or list row we sent. The words are ours, not the
// customer's, so they never count as an opt-out (a "No thanks" button is an
// answer, not an unsubscribe).
export const isButtonReply = (parsed) => parsed?.type === 'BUTTON' || parsed?.type === 'INTERACTIVE';

// What the workflow engine is told arrived. Text the customer wrote (typed, a
// caption, a transcribed voice note, a button they tapped) is a `message`
// event and can match keyword triggers. Anything else — an uncaptioned photo,
// a location, a contact card, an order or an unsupported type — carries only a
// placeholder we wrote ("[photo]", "[location]", "[unsupported message:
// order]"), which must never match a keyword; it goes as a `media` event, so a
// media trigger (when there is media) and the new-contact welcome still fire.
export function inboundEvent(parsed) {
  return carriesCustomerText(parsed) ? 'message' : 'media';
}

// 'image' | 'video' | 'audio' | 'document' | 'sticker' for a media message,
// else null. What the workflow `media` trigger matches on.
export function mediaTypeOf(parsed) {
  return parsed?.media ? String(parsed.type).toLowerCase() : null;
}
