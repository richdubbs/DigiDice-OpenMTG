/**
 * The ladder's one door to milestone 14 (design docs/design/m15-ladder.md, section 2 and D1). Every other file of @openmtg/ladder takes these types
 * from here, never from @openmtg/accounts itself (test/m15-1/accounts.test.ts checks it). Types only: the import is erased at run time, so the ladder
 * loads nothing of accounts, and accounts never imports the ladder.
 *
 * M14-1 merged before M15-1, so this re-exports @openmtg/accounts/api directly and there is no shim (src/accounts-shim.ts) and no M15-1b (m15 2,
 * m14 13.3). Milestone 14's values the ladder needs are copied, and the copies pinned against accounts' own by a test: the account id's shape
 * (ACCOUNT_ID_SHAPE) and the deleted player's name (DELETED_PLAYER_NAME), both in src/api/constants.ts.
 */
export type {
  AccountDataHolder,
  AccountDirectory,
  AccountId,
  AccountStatus,
  PlayerRef,
  PrivacySettings,
  ReportReason,
  Standing,
} from '@openmtg/accounts/api';
