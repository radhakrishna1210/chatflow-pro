import * as authenticationService from './authentication.service.js';

/**
 * Generate and send a ChatFlow-generated Authentication OTP.
 *
 * The Authentication template and WhatsApp number are resolved
 * from the workspace Authentication configuration.
 *
 * The API client only provides the recipient phone number.
 */
export async function generateOtp(req, res) {
  const { to } = req.body || {};

  const result =
    await authenticationService.sendAuthenticationOtp(
      req.workspaceId,
      { to }
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
      req.workspaceId,
      phone,
      code
    );

  res.json(result);
}