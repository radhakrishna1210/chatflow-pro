// Splits one Meta webhook POST into independent units of work.
//
// A single delivery can carry several entries, each with several messages and
// statuses, from several customers. Processing the POST as one unit meant a
// throw on the first message dropped every event after it, and nothing could
// serialise one customer's messages without also serialising everyone else's.
//
// Each unit is itself a well-formed webhook body (one entry, one change, one
// message/status), so processWebhook() handles it unchanged. `key` names what
// the unit must be serialised against: everything about one customer on one
// business number shares a key, so their messages never run the automation
// chain concurrently. `jobId` is stable across Meta redeliveries.

// BullMQ uses ':' as its key delimiter and rejects custom ids containing it.
const safe = (value) => String(value ?? '').replace(/:/g, '_');

function unit(entry, change, value, key, jobId) {
  return {
    key: safe(key),
    jobId: jobId ? safe(jobId) : null,
    payload: { object: 'whatsapp_business_account', entry: [{ id: entry.id, changes: [{ field: change.field, value }] }] },
  };
}

export function splitWebhook(body) {
  const units = [];
  for (const entry of body?.entry || []) {
    for (const change of entry?.changes || []) {
      const value = change?.value;
      if (!value) continue;

      if (change.field !== 'messages') {
        // Template status/category updates: rare, and keyed on the WABA.
        units.push(unit(entry, change, value, `waba__${entry.id}`, null));
        continue;
      }

      const { messages = [], statuses = [], contacts = [], ...rest } = value;
      const phoneNumberId = value.metadata?.phone_number_id;

      for (const msg of messages) {
        const contact = contacts.find((c) => c?.wa_id && c.wa_id === msg?.from) ?? contacts[0];
        units.push(unit(entry, change, { ...rest, contacts: contact ? [contact] : [], messages: [msg] },
          `contact__${phoneNumberId}__${msg?.from}`,
          msg?.id ? `in__${msg.id}` : null));
      }

      for (const status of statuses) {
        units.push(unit(entry, change, { ...rest, statuses: [status] },
          `contact__${phoneNumberId}__${status?.recipient_id}`,
          status?.id ? `st__${status.id}__${status.status}` : null));
      }
    }
  }
  return units;
}
