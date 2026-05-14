import { prisma } from '../lib/prisma.js';
import { encrypt, decrypt } from '../lib/encryption.js';
import { getWabaPhoneNumbers, systemClient } from '../lib/meta.js';
import { syncTemplatesFromMeta } from './templates.service.js';
import { env } from '../config/env.js';

// Refresh quality/status of numbers already assigned to this workspace — never creates new records.
async function refreshExistingFromMeta(workspaceId) {
  try {
    const metaNumbers = await getWabaPhoneNumbers(env.META_WABA_ID);
    for (const num of metaNumbers) {
      const exists = await prisma.waNumber.findFirst({
        where: { workspaceId, metaPhoneNumberId: num.id },
      });
      if (!exists) continue;
      await prisma.waNumber.update({
        where: { id: exists.id },
        data: {
          phoneNumber: num.display_phone_number,
          displayName: num.verified_name ?? exists.displayName,
          quality:     num.quality_rating  ?? exists.quality,
          status:      num.status          ?? exists.status,
        },
      });
    }
  } catch (err) {
    console.error('[whatsapp] Meta refresh failed:', err.message);
  }
}

export async function listNumbers(workspaceId) {
  const numbers = await prisma.waNumber.findMany({
    where: { workspaceId },
    orderBy: { createdAt: 'desc' },
  });
  return numbers.map(({ encryptedAccessToken: _, ...n }) => n);
}

export async function refreshNumbers(workspaceId) {
  await refreshExistingFromMeta(workspaceId);
  const numbers = await prisma.waNumber.findMany({
    where: { workspaceId },
    orderBy: { createdAt: 'desc' },
  });
  return numbers.map(({ encryptedAccessToken: _, ...n }) => n);
}

export async function connectOwnNumber(workspaceId, { phoneNumber, metaPhoneNumberId, wabaId, accessToken, displayName }) {
  const encryptedAccessToken = encrypt(accessToken);
  const number = await prisma.waNumber.create({
    data: { workspaceId, phoneNumber, metaPhoneNumberId, wabaId, encryptedAccessToken, displayName },
  });
  return { ...number, encryptedAccessToken: undefined };
}

export async function listPool() {
  const pool = await prisma.numberPool.findMany({
    where: { status: 'AVAILABLE' },
    orderBy: { createdAt: 'desc' },
  });
  return pool.map(({ encryptedAccessToken: _, ...p }) => p);
}

export async function onboardFromPool(workspaceId, poolEntryId) {
  const entry = await prisma.numberPool.findUnique({ where: { id: poolEntryId } });
  if (!entry || entry.status !== 'AVAILABLE') {
    const err = new Error('Pool entry not available');
    err.status = 404;
    throw err;
  }

  // Attempt to create an isolated sub-WABA for this workspace
  let wabaId = entry.wabaId;
  try {
    const { data } = await systemClient.post(`/${env.META_BUSINESS_ID}/owned_whatsapp_business_accounts`, {
      name: `Workspace ${workspaceId}`,
    });
    if (data?.id) wabaId = data.id;
  } catch {
    // Fallback to shared WABA — non-fatal
  }

  // Atomic: mark pool entry ASSIGNED + create WaNumber record
  const [number] = await prisma.$transaction([
    prisma.waNumber.create({
      data: {
        workspaceId,
        phoneNumber:          entry.phoneNumber,
        metaPhoneNumberId:    entry.phoneNumberId,
        wabaId,
        encryptedAccessToken: entry.encryptedAccessToken,
        displayName:          entry.displayName,
      },
    }),
    prisma.numberPool.update({
      where: { id: poolEntryId },
      data: { status: 'ASSIGNED', assignedTo: workspaceId },
    }),
  ]);

  // Fire-and-forget: sync templates from Meta for this workspace
  syncTemplatesFromMeta(workspaceId).catch(() => {});

  return { phoneNumber: number.phoneNumber, displayName: number.displayName, wabaId };
}

export async function disconnectNumber(workspaceId, numberId) {
  const waNumber = await prisma.waNumber.findFirst({ where: { id: numberId, workspaceId } });
  if (!waNumber) { const e = new Error('Number not found in this workspace'); e.status = 404; throw e; }

  // Templates live on the Meta WABA tied to the number. Once the last number is
  // gone, the workspace cannot operate on those templates anymore, so wipe them.
  // Campaigns belong to the user's history and stay.
  const remainingNumbers = await prisma.waNumber.count({
    where: { workspaceId, id: { not: waNumber.id } },
  });

  await prisma.$transaction([
    ...(remainingNumbers === 0 ? [prisma.template.deleteMany({ where: { workspaceId } })] : []),
    prisma.waNumber.delete({ where: { id: waNumber.id } }),
    prisma.numberPool.updateMany({
      where: { phoneNumberId: waNumber.metaPhoneNumberId, assignedTo: workspaceId },
      data: { status: 'AVAILABLE', assignedTo: null },
    }),
  ]);

  return { ok: true, phoneNumber: waNumber.phoneNumber };
}

export async function getDecryptedNumber(workspaceId, numberId) {
  const n = await prisma.waNumber.findFirst({ where: { id: numberId, workspaceId } });
  if (!n) return null;
  return { ...n, accessToken: decrypt(n.encryptedAccessToken) };
}
