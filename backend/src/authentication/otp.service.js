import {
  createHash,
  randomInt,
  timingSafeEqual,
} from 'crypto';

import { prisma } from '../lib/prisma.js';

const OTP_LENGTH = 6;
const DEFAULT_EXPIRY_MINUTES = 10;
const MAX_ATTEMPTS = 5;
const MAX_TRANSACTION_RETRIES = 3;

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

function hashesMatch(left, right) {
  if (
    typeof left !== 'string' ||
    typeof right !== 'string'
  ) {
    return false;
  }

  const leftBuffer = Buffer.from(left, 'hex');
  const rightBuffer = Buffer.from(right, 'hex');

  if (leftBuffer.length !== rightBuffer.length) {
    return false;
  }

  return timingSafeEqual(leftBuffer, rightBuffer);
}

/**
 * Create a ChatFlow-generated authentication transaction.
 *
 * The raw OTP is returned only to the authentication service
 * so it can be sent through Meta.
 *
 * Only the SHA-256 hash is persisted.
 *
 * The previous pending OTP for the same workspace + phone
 * is consumed inside the same database transaction.
 */
export async function createAuthenticationTransaction({
  workspaceId,
  templateId,
  waNumberId,
  campaignId = null,
  phone,
  expiresInMinutes = DEFAULT_EXPIRY_MINUTES,
}) {
  if (!workspaceId) {
    const error = new Error('Workspace is required.');
    error.status = 400;
    throw error;
  }

  if (!templateId) {
    const error = new Error(
      'Authentication template is required.'
    );
    error.status = 400;
    throw error;
  }

  if (!waNumberId) {
    const error = new Error(
      'Authentication WhatsApp number is required.'
    );
    error.status = 400;
    throw error;
  }

  if (!phone) {
    const error = new Error(
      'Authentication phone number is required.'
    );
    error.status = 400;
    throw error;
  }

  const expiryMinutes = Number(expiresInMinutes);

  if (
    !Number.isFinite(expiryMinutes) ||
    expiryMinutes <= 0
  ) {
    const error = new Error(
      'Authentication OTP expiry must be greater than zero.'
    );
    error.status = 400;
    throw error;
  }

  const code = generateOtp();
  const otpHash = hashOtp(code);

  const expiresAt = new Date(
    Date.now() +
      expiryMinutes * 60 * 1000
  );

  for (
    let attempt = 1;
    attempt <= MAX_TRANSACTION_RETRIES;
    attempt += 1
  ) {
    try {
      const transaction =
        await prisma.$transaction(
          async tx => {
            /*
             * Consume every previous pending transaction
             * for this exact workspace + recipient.
             */
            await tx.authenticationTransaction.updateMany({
              where: {
                workspaceId,
                phone,
                status: 'PENDING',
              },
              data: {
                status: 'EXPIRED',
              },
            });

            return tx.authenticationTransaction.create({
              data: {
                workspaceId,
                templateId,
                waNumberId,
                campaignId,
                phone,
                otpHash,
                source: 'CHATFLOW',
                status: 'PENDING',
                expiresAt,
              },
            });
          },
          {
            isolationLevel: 'Serializable',
          }
        );

      return {
        transactionId: transaction.id,
        code,
        expiresAt,
      };
    } catch (error) {
      /*
       * PostgreSQL can report a serialization conflict when
       * two authentication requests for the same recipient
       * are generated concurrently.
       *
       * Retry a small number of times rather than exposing
       * the database race to the API caller.
       */
      if (
        error?.code === 'P2034' &&
        attempt < MAX_TRANSACTION_RETRIES
      ) {
        continue;
      }

      throw error;
    }
  }

  const error = new Error(
    'Unable to create authentication transaction.'
  );
  error.status = 503;
  throw error;
}

/**
 * Store the Meta message ID after the WhatsApp send succeeds.
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
 * Verification is deliberately performed using conditional
 * database updates so that the OTP can only transition from
 * PENDING to VERIFIED once.
 *
 * This prevents concurrent requests from successfully
 * consuming the same OTP twice.
 */
export async function verifyAuthenticationTransaction(
  workspaceId,
  phone,
  code
) {
  if (!workspaceId) {
    const error = new Error('Workspace is required.');
    error.status = 400;
    throw error;
  }

  const normalizedPhone = String(phone || '').trim();
  const normalizedCode = String(code || '').trim();

  if (!normalizedPhone) {
    const error = new Error(
      'Phone number is required.'
    );
    error.status = 400;
    throw error;
  }

  if (!/^\d{6}$/.test(normalizedCode)) {
    const error = new Error(
      'OTP must be exactly 6 digits.'
    );
    error.status = 400;
    throw error;
  }

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

  const now = new Date();

  /*
   * Expiry is checked first and the status transition is
   * conditional on the transaction still being PENDING.
   */
  if (transaction.expiresAt <= now) {
    const expired =
      await prisma.authenticationTransaction.updateMany({
        where: {
          id: transaction.id,
          workspaceId,
          status: 'PENDING',
        },
        data: {
          status: 'EXPIRED',
        },
      });

    if (expired.count > 0) {
      return {
        verified: false,
        reason: 'OTP_EXPIRED',
      };
    }

    /*
     * Another concurrent request changed the transaction
     * before this request could expire it.
     */
    const current =
      await prisma.authenticationTransaction.findUnique({
        where: {
          id: transaction.id,
        },
        select: {
          status: true,
        },
      });

    if (current?.status === 'VERIFIED') {
      return {
        verified: false,
        reason: 'OTP_ALREADY_USED',
      };
    }

    if (current?.status === 'FAILED') {
      return {
        verified: false,
        reason: 'MAX_ATTEMPTS_EXCEEDED',
      };
    }

    return {
      verified: false,
      reason: 'OTP_EXPIRED',
    };
  }

  /*
   * Atomically lock out the transaction once the maximum
   * number of attempts has already been reached.
   */
  if (transaction.attempts >= MAX_ATTEMPTS) {
    const failed =
      await prisma.authenticationTransaction.updateMany({
        where: {
          id: transaction.id,
          workspaceId,
          status: 'PENDING',
          attempts: {
            gte: MAX_ATTEMPTS,
          },
        },
        data: {
          status: 'FAILED',
        },
      });

    if (failed.count > 0) {
      return {
        verified: false,
        reason: 'MAX_ATTEMPTS_EXCEEDED',
      };
    }

    const current =
      await prisma.authenticationTransaction.findUnique({
        where: {
          id: transaction.id,
        },
        select: {
          status: true,
        },
      });

    if (current?.status === 'VERIFIED') {
      return {
        verified: false,
        reason: 'OTP_ALREADY_USED',
      };
    }

    return {
      verified: false,
      reason: 'MAX_ATTEMPTS_EXCEEDED',
    };
  }

  const submittedHash = hashOtp(normalizedCode);
  const matches = hashesMatch(
    submittedHash,
    transaction.otpHash
  );

  if (!matches) {
    /*
     * Increment attempts atomically.
     *
     * The update only applies while the transaction remains
     * PENDING and below the attempt limit.
     */
    const updated =
      await prisma.authenticationTransaction.updateMany({
        where: {
          id: transaction.id,
          workspaceId,
          status: 'PENDING',
          attempts: {
            lt: MAX_ATTEMPTS,
          },
        },
        data: {
          attempts: {
            increment: 1,
          },
        },
      });

    if (updated.count === 0) {
      const current =
        await prisma.authenticationTransaction.findUnique({
          where: {
            id: transaction.id,
          },
          select: {
            status: true,
            attempts: true,
          },
        });

      if (current?.status === 'VERIFIED') {
        return {
          verified: false,
          reason: 'OTP_ALREADY_USED',
        };
      }

      if (
        current?.status === 'FAILED' ||
        Number(current?.attempts) >= MAX_ATTEMPTS
      ) {
        if (current?.status === 'PENDING') {
          await prisma.authenticationTransaction.updateMany({
            where: {
              id: transaction.id,
              workspaceId,
              status: 'PENDING',
              attempts: {
                gte: MAX_ATTEMPTS,
              },
            },
            data: {
              status: 'FAILED',
            },
          });
        }

        return {
          verified: false,
          reason: 'MAX_ATTEMPTS_EXCEEDED',
        };
      }

      return {
        verified: false,
        reason: 'OTP_NOT_FOUND',
      };
    }

    /*
     * Re-read the attempt count so the response accurately
     * reflects whether this invalid attempt exhausted the OTP.
     */
    const current =
      await prisma.authenticationTransaction.findUnique({
        where: {
          id: transaction.id,
        },
        select: {
          attempts: true,
          status: true,
        },
      });

    if (
      current?.status === 'PENDING' &&
      Number(current.attempts) >= MAX_ATTEMPTS
    ) {
      await prisma.authenticationTransaction.updateMany({
        where: {
          id: transaction.id,
          workspaceId,
          status: 'PENDING',
          attempts: {
            gte: MAX_ATTEMPTS,
          },
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

    return {
      verified: false,
      reason: 'INVALID_OTP',
    };
  }

  /*
   * CRITICAL:
   *
   * The OTP is accepted only if this conditional update
   * successfully changes the transaction from PENDING to
   * VERIFIED.
   *
   * If another request verifies it first, count === 0 and
   * this request cannot verify the same OTP again.
   */
  const verified =
    await prisma.authenticationTransaction.updateMany({
      where: {
        id: transaction.id,
        workspaceId,
        phone: normalizedPhone,
        source: 'CHATFLOW',
        status: 'PENDING',
        expiresAt: {
          gt: new Date(),
        },
        attempts: {
          lt: MAX_ATTEMPTS,
        },
        otpHash: submittedHash,
      },
      data: {
        status: 'VERIFIED',
        verifiedAt: new Date(),
      },
    });

  if (verified.count > 0) {
    return {
      verified: true,
    };
  }

  /*
   * Another request won the atomic verification race, or
   * the transaction changed state between the initial read
   * and this update.
   */
  const current =
    await prisma.authenticationTransaction.findUnique({
      where: {
        id: transaction.id,
      },
      select: {
        status: true,
        expiresAt: true,
        attempts: true,
      },
    });

  if (current?.status === 'VERIFIED') {
    return {
      verified: false,
      reason: 'OTP_ALREADY_USED',
    };
  }

  if (current?.status === 'FAILED') {
    return {
      verified: false,
      reason: 'MAX_ATTEMPTS_EXCEEDED',
    };
  }

  if (
    current?.expiresAt &&
    current.expiresAt <= new Date()
  ) {
    await prisma.authenticationTransaction.updateMany({
      where: {
        id: transaction.id,
        workspaceId,
        status: 'PENDING',
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

  return {
    verified: false,
    reason: 'OTP_NOT_FOUND',
  };
}

/**
 * An OTP must never be usable when its delivery failed. This is conditional so
 * a late failure handler cannot overwrite a transaction already consumed.
 */
export async function invalidateAuthenticationTransaction(transactionId) {
  if (!transactionId) return;

  await prisma.authenticationTransaction.updateMany({
    where: { id: transactionId, status: 'PENDING' },
    data: { status: 'FAILED' },
  });
}
