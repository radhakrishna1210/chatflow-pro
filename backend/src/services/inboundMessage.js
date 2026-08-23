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
    out.body = node.caption || PLACEHOLDER[type];
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

// Only a message the customer typed should drive keyword triggers, intent
// matching or an AI reply. Matching "STOP" against the placeholder text we
// invented for a photo would be our own words triggering our own automation.
export function carriesCustomerText(parsed) {
  return (parsed.type === 'TEXT' || parsed.type === 'BUTTON' || parsed.type === 'INTERACTIVE')
    && Boolean(parsed.body?.trim());
}
