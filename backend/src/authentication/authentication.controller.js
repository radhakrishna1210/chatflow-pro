import * as authenticationService from './authentication.service.js';

/**
 * Generate and send a WhatsApp Authentication OTP.
 *
 * If `otp` is supplied:
 *   CLIENT_GENERATED mode
 *
 * If `otp` is not supplied:
 *   CHATFLOW_GENERATED mode
 */
export async function generateOtp(req, res) {
  const result =
    await authenticationService.sendAuthenticationOtp(
      req.workspaceId,
      req.body
    );

  res.json(result);
}

/**
 * Verify a ChatFlow-generated Authentication OTP.
 */
export async function verifyOtp(req, res) {
  const { phone, code } = req.body || {};

  const result =
    await authenticationService.verifyAuthenticationOtp(
      phone,
      code
    );

  res.json(result);
}