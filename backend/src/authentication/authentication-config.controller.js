import * as authenticationConfigService from './authentication-config.service.js';

export async function getConfiguration(req, res) {
  const result =
    await authenticationConfigService.getAuthenticationConfiguration(
      req.params.workspaceId
    );

  res.json(result);
}

export async function updateConfiguration(req, res) {
  const result =
    await authenticationConfigService.updateAuthenticationConfiguration(
      req.params.workspaceId,
      req.body
    );

  res.json(result);
}

export async function getUsage(req, res) {
  const result =
    await authenticationConfigService.getAuthenticationUsage(
      req.params.workspaceId
    );

  res.json(result);
}
