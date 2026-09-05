import { createHash, randomInt } from 'crypto';
import { prisma } from '../lib/prisma.js';

const OTP_LENGTH = 6;
const DEFAULT_EXPIRY_MINUTES = 5;
const MAX_ATTEMPTS = 5;

function generateOtp() {
  return randomInt(0, 1_000_000)
    .toString()
    .padStart(OTP_LENGTH, '0');
}

function hashOtp(code) {
  return createHash('sha256')
    .update(String(code))
    .digest('hex');
}

/**
 * Create a ChatFlow-generated authentication transaction.
 *
 * The raw OTP is returned only to the caller.
 * Only the SHA-256 hash is stored in the database.
 */
export async function createAuthenticationTransaction({
  workspaceId,
  templateId,
  waNumberId,
  phone,
  expiresInMinutes = DEFAULT_EXPIRY_MINUTES,
}) {
  const code = generateOtp();
  const otpHash = hashOtp(code);

  const expiresAt = new Date(
    Date.now() + expiresInMinutes * 60 * 1000
  );

  // Consume any previous pending transaction for this phone.
  await prisma.authenticationTransaction.updateMany({
    where: {
      workspaceId,
      phone,
      status: 'PENDING',
    },
    data: {
      status: 'EXPIRED',
    },
  });

  const transaction =
    await prisma.authenticationTransaction.create({
      data: {
        workspaceId,
        templateId,
        waNumberId,
        phone,
        otpHash,
        source: 'CHATFLOW',
        status: 'PENDING',
        expiresAt,
      },
    });

  return {
    transactionId: transaction.id,
    code,
    expiresAt,
  };
}

/**
 * Store/update the Meta message ID after sending.
 */
export async function attachMetaMessageId(
  transactionId,
  metaMessageId
) {
  if (!transactionId || !metaMessageId) {
    return;
  }

  await prisma.authenticationTransaction.update({
    where: {
      id: transactionId,
    },
    data: {
      metaMessageId,
    },
  });
}

/**
 * Verify a ChatFlow-generated authentication transaction.
 *
 * The lookup is scoped to `workspaceId`. Without it, two workspaces that had
 * both sent an OTP to the same phone number would share a single pool of
 * pending transactions, and whichever called /verify first would consume the
 * other's — a cross-tenant leak, since the code from workspace A would verify
 * against workspace B's transaction.
 */
export async function verifyAuthenticationTransaction({
  workspaceId,
  phone,
  code,
}) {
  const normalizedPhone = String(phone || '').trim();
  const normalizedCode = String(code || '').trim();

  const transaction =
    await prisma.authenticationTransaction.findFirst({
      where: {
        workspaceId,
        phone: normalizedPhone,
        source: 'CHATFLOW',
        status: 'PENDING',
      },
      orderBy: {
        createdAt: 'desc',
      },
    });

  if (!transaction) {
    return {
      verified: false,
      reason: 'OTP_NOT_FOUND',
    };
  }

  if (transaction.expiresAt <= new Date()) {
    await prisma.authenticationTransaction.update({
      where: {
        id: transaction.id,
      },
      data: {
        status: 'EXPIRED',
      },
    });

    return {
      verified: false,
      reason: 'OTP_EXPIRED',
    };
  }

  if (transaction.attempts >= MAX_ATTEMPTS) {
    await prisma.authenticationTransaction.update({
      where: {
        id: transaction.id,
      },
      data: {
        status: 'FAILED',
      },
    });

    return {
      verified: false,
      reason: 'MAX_ATTEMPTS_EXCEEDED',
    };
  }

  const submittedHash = hashOtp(normalizedCode);

  if (submittedHash !== transaction.otpHash) {
    const attempts = transaction.attempts + 1;

    await prisma.authenticationTransaction.update({
      where: {
        id: transaction.id,
      },
      data: {
        attempts,
        ...(attempts >= MAX_ATTEMPTS
          ? { status: 'FAILED' }
          : {}),
      },
    });

    return {
      verified: false,
      reason:
        attempts >= MAX_ATTEMPTS
          ? 'MAX_ATTEMPTS_EXCEEDED'
          : 'INVALID_OTP',
    };
  }

  await prisma.authenticationTransaction.update({
    where: {
      id: transaction.id,
    },
    data: {
      status: 'VERIFIED',
      verifiedAt: new Date(),
    },
  });

  return {
    verified: true,
    transactionId: transaction.id,
  };
}