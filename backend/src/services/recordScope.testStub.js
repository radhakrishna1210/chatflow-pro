// A record-scope stand-in for tests that are not about visibility: every
// caller sees the whole workspace. Pass it to mock.module so services that
// import any scope helper still load.
export const unscopedRecordScope = {
  VISIBILITY_MODES: ['ALL', 'TEAM', 'OWN'],
  getWorkspaceVisibility: async () => 'ALL',
  teammateIds: async () => [],
  scopeFilter: async () => ({}),
  activityScopeFilter: async () => ({}),
  quoteScopeFilter: async () => ({}),
  withScope: (where) => where,
  scopedWhere: async (_workspaceId, _user, where) => where,
  assertInScope: async () => {},
};
