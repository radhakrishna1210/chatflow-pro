// "Orders with per-customer prices": a per-workspace setting, off by default,
// that the workspace's own admin turns on (Automation → WhatsApp Forms).
//
// When it is on:
//   - workflow messages and conditions can read uploaded sheet columns
//     ({{price}}) from Contact.attributes
//   - a WhatsApp Form's closing message fills in {{q1}}, {{name}}, sheet
//     columns and {{= q1 * price}} calculations, and the order total is saved
//   - the submissions screen and export show a Total column
//
// When it is off, all three behave exactly as they did before the feature
// existed. Sheet columns are still saved on import and still usable in
// campaign variable mapping, which every workspace has.

import { prisma } from './prisma.js';

// Never throws: a failed lookup (e.g. the column not migrated yet) counts as
// "off", so workflows and forms keep their original behaviour instead of
// failing mid-conversation.
export async function isOrderingEnabled(workspaceId) {
  if (!workspaceId) return false;
  try {
    const ws = await prisma.workspace.findUnique({
      where: { id: workspaceId },
      select: { orderingEnabled: true },
    });
    return ws?.orderingEnabled === true;
  } catch (err) {
    console.warn(`[Ordering] Could not read the setting for workspace ${workspaceId}: ${err.message.split('\n')[0]}`);
    return false;
  }
}

export async function setOrderingEnabled(workspaceId, enabled) {
  if (typeof enabled !== 'boolean') {
    const e = new Error('orderingEnabled must be true or false'); e.status = 400; throw e;
  }
  const ws = await prisma.workspace.update({
    where: { id: workspaceId },
    data: { orderingEnabled: enabled },
    select: { orderingEnabled: true },
  });
  return { orderingEnabled: ws.orderingEnabled };
}

// The contact as workflow messages may see it: without sheet columns unless
// the workspace has ordering turned on.
export function contactForWorkflows(contact, enabled) {
  if (!contact || enabled) return contact;
  const { attributes: _hidden, ...rest } = contact;
  return rest;
}
