/**
 * M14-1: the contracts as data (design 11.1-11.3): ACCOUNT_STORE_METHODS pinned against AccountStore; ACCOUNT_METHOD_ERRORS has a row for every
 * ServiceMethod with only codes of ACCOUNT_ERROR_CODES, as 11.3's table gives them; RESTRICTED_CALLS as 3.8's table; AUDIT_CATEGORY covers every kind
 * and the three kind lists split AUDIT_KINDS exactly; AuditDetails has a key for every kind (a type test); the error classes.
 */
import { describe, expect, it } from 'vitest';
import {
  ACCOUNT_ERROR_CODES, ACCOUNT_METHOD_ERRORS, ACCOUNT_STORE_METHODS, AUDIT_CATEGORY, AUDIT_DETAILS_MAX, AUDIT_KINDS, AccountStoreError,
  AccountsAdminError, HasherBusyError, MODERATION_AUDIT_KINDS, OPERATOR_AUDIT_KINDS, RESTRICTED_CALLS, RESTRICTED_PROVIDER_INTENTS, SECURITY_AUDIT_KINDS,
  type AccountService, type AccountStore, type AuditDetails, type AuditKind, type Auth, type Proof, type RequestContext, type SensitiveAction,
  type ServiceMethod,
} from '@openmtg/accounts';
import type { Equals } from './support';

// ---- AccountStore's methods, listed here independently of the package (a missing or extra one fails the typecheck or the test) ---------------
const STORE = [
  'createAccount', 'account', 'accounts', 'accountByKey', 'updateAccount', 'rename', 'nameEntry', 'putNameEntry', 'deleteNameEntry', 'nameHistory',
  'redactName', 'findAccounts', 'inactiveSince', 'nameKeyVersion', 'nameEntries', 'rekey', 'credentials', 'credentialBySubject', 'putCredential',
  'deleteCredential', 'replaceRecoveryCodes', 'recoveryCodes', 'spendRecoveryCode', 'putDevice', 'device', 'devicesOf', 'updateDevice', 'deleteDevices',
  'putSession', 'sessionByTokenHash', 'rotateSession', 'rerotateInGrace', 'updateSession', 'revokeSession', 'revokeSessions', 'sessionsOf', 'claimGuest',
  'claimsOf', 'sessionById', 'appeal',
  'setRelation', 'deleteRelation', 'relationsOf', 'relationsAmong', 'putEmailCode', 'liveEmailCodes', 'useEmailCode', 'deleteEmailCodes', 'putReport',
  'report', 'reports', 'closeReport', 'putSanction', 'sanction', 'sanctionsOf', 'runningSanctions', 'endSanction', 'sanctionsEndingBy', 'markSeen',
  'putAppeal', 'appeals', 'answerAppeal', 'appendAudit', 'audit', 'appendChange', 'changes', 'changesHead', 'dueDeletions', 'erase', 'tombstone', 'purge',
  'close',
] as const;
const pinStore: Equals<(typeof STORE)[number], keyof AccountStore> = true;

// ---- ServiceMethod, listed independently --------------------------------------------------------------------------------------------------
const METHODS = [
  'register', 'signIn', 'resume', 'signOut', 'sessions', 'revokeSession', 'changePassword', 'useRecoveryCode', 'newRecoveryCodes', 'setEmail',
  'verifyEmail', 'requestEmailReset', 'useEmailReset', 'beginProvider', 'providerCallback', 'confirmProvider', 'registerWithProvider', 'unlinkProvider',
  'claimGuest', 'nameUnavailable', 'self', 'markSeen', 'rename', 'setAvatar', 'setPrivacy', 'profile', 'block', 'mute', 'relations', 'report', 'appeal',
  'exportData', 'deleteAccount', 'cancelDeletion',
] as const;
const pinMethods: Equals<(typeof METHODS)[number], ServiceMethod> = true;
const pinNotMethods: Equals<Exclude<keyof AccountService, ServiceMethod>, 'directory' | 'admin' | 'addHolder' | 'changes' | 'changesHead' | 'onChange' | 'tick' | 'close'> = true;

// ---- AuditDetails has a key for every kind, and no other ---------------------------------------------------------------------------------
const pinDetails: Equals<keyof AuditDetails, AuditKind> = true;

// ---- a rename needs a proof (finding 6): 'rename' is a SensitiveAction and AccountService.rename's last parameter is a Proof ----------------
const pinRenameAction: Equals<Extract<SensitiveAction, 'rename'>, 'rename'> = true;
const pinRenameProof: Equals<Parameters<AccountService['rename']>, [RequestContext, Auth, string, Proof]> = true;
// ---- an appeal and a guest claim need a proof (M14-15, review A3): both are SensitiveActions and both methods take a Proof last -------------------
const pinAppealAction: Equals<Extract<SensitiveAction, 'appeal' | 'claim'>, 'appeal' | 'claim'> = true;
const pinAppealProof: Equals<Parameters<AccountService['appeal']>, [RequestContext, Auth, string, string, Proof]> = true;
const pinClaimProof: Equals<Parameters<AccountService['claimGuest']>, [RequestContext, Auth, string, Proof]> = true;

/** 11.3's table, "Its own codes", copied by hand from the design. */
const OWN: Record<ServiceMethod, readonly string[]> = {
  register: ['busy', 'nameInvalid', 'nameTaken', 'nameReserved', 'nameFiltered', 'passwordWeak', 'ageGate', 'captchaRequired', 'captchaFailed', 'emailInvalid', 'emailUnavailable', 'alreadyClaimed'],
  signIn: ['busy', 'badCredentials', 'captchaRequired', 'captchaFailed'],
  resume: ['sessionExpired', 'sessionRevoked'],
  signOut: [], sessions: [], self: [], relations: [],
  revokeSession: ['notFound'], markSeen: ['notFound'],
  changePassword: ['badCredentials', 'passwordWeak'],
  useRecoveryCode: ['busy', 'badCredentials', 'passwordWeak', 'captchaRequired', 'captchaFailed'],
  newRecoveryCodes: ['reauthRequired', 'badCredentials'],
  setEmail: ['reauthRequired', 'badCredentials', 'emailInvalid', 'emailUnavailable', 'limitReached'],
  verifyEmail: ['emailCodeInvalid'],
  requestEmailReset: ['emailUnavailable'],
  useEmailReset: ['busy', 'emailCodeInvalid', 'passwordWeak'],
  beginProvider: ['providerUnavailable', 'notAllowed', 'reauthRequired', 'badCredentials'],
  providerCallback: ['providerFailed', 'providerUnavailable'],
  confirmProvider: ['busy', 'providerFailed', 'providerLinked'],
  registerWithProvider: ['busy', 'providerFailed', 'nameInvalid', 'nameTaken', 'nameReserved', 'nameFiltered', 'ageGate', 'alreadyClaimed'],
  unlinkProvider: ['reauthRequired', 'badCredentials', 'notFound', 'conflict'],
  // the design's row plus the proof's codes (M14-15, review A3: a claim cannot be undone)
  claimGuest: ['reauthRequired', 'badCredentials', 'busy', 'notFound', 'alreadyClaimed', 'limitReached'],
  nameUnavailable: [],
  // the design's row plus the proof's codes (review of M14-1, finding 6: a rename needs the password)
  rename: ['reauthRequired', 'badCredentials', 'nameInvalid', 'nameTaken', 'nameReserved', 'nameFiltered', 'renameCooldown', 'conflict'],
  setAvatar: [], setPrivacy: [],
  profile: ['notFound'],
  block: ['limitReached'], mute: ['limitReached'],
  report: ['notAllowed'],
  // the design's row plus the proof's codes (M14-15, review A3: a sanction has one appeal)
  appeal: ['reauthRequired', 'badCredentials', 'notFound', 'conflict'],
  exportData: ['reauthRequired', 'badCredentials'],
  deleteAccount: ['reauthRequired', 'badCredentials'],
  cancelDeletion: ['notAllowed'],
};
/** The methods without an Auth (guests, the HTTP callback, resume by token, the name check). */
const NO_AUTH: readonly ServiceMethod[] = [
  'register', 'signIn', 'resume', 'useRecoveryCode', 'requestEmailReset', 'useEmailReset', 'providerCallback', 'registerWithProvider', 'nameUnavailable', 'profile',
];
const COMMON = ['badMessage', 'rateLimited', 'unavailable', 'notYet'];
/** Allowed in a restricted session for the 'reauth' intent only, so they may still answer the status's code (review of M14-1, findings 2 and 8). */
const REAUTH_ONLY: readonly ServiceMethod[] = ['beginProvider', 'confirmProvider'];
/**
 * The methods that write the account row (ServiceGuard.patch, or the store's version check): a version conflict after 3 retries answers 'conflict'
 * (review of M14-1, finding 3). The sign-ins (lastSignInAt), the email, the avatar, privacy, the name and the deletion.
 */
const PATCHES: readonly ServiceMethod[] = [
  'signIn', 'useRecoveryCode', 'useEmailReset', 'confirmProvider', 'setEmail', 'verifyEmail', 'rename', 'setAvatar', 'setPrivacy', 'deleteAccount', 'cancelDeletion',
];

describe('M14-1: ACCOUNT_STORE_METHODS', () => {
  it('lists every method of AccountStore exactly once', () => {
    expect(pinStore).toBe(true);
    expect(new Set(ACCOUNT_STORE_METHODS).size).toBe(ACCOUNT_STORE_METHODS.length);
    expect([...ACCOUNT_STORE_METHODS].sort()).toEqual([...STORE].sort());
    expect(ACCOUNT_STORE_METHODS).toHaveLength(72);
    expect(Object.isFrozen(ACCOUNT_STORE_METHODS)).toBe(true);
  });

  it('AccountStoreError carries its code', () => {
    const e = new AccountStoreError('exists', 'the key is taken');
    expect(e).toBeInstanceOf(Error);
    expect(e).toMatchObject({ code: 'exists', message: 'the key is taken', name: 'AccountStoreError' });
  });
});

describe('M14-1: ACCOUNT_METHOD_ERRORS (11.3)', () => {
  it('has a row for every ServiceMethod and no other, with only codes of ACCOUNT_ERROR_CODES, none twice', () => {
    expect([pinMethods, pinNotMethods]).toEqual([true, true]);
    expect(Object.keys(ACCOUNT_METHOD_ERRORS).sort()).toEqual([...METHODS].sort());
    const known = new Set<string>(ACCOUNT_ERROR_CODES);
    for (const m of METHODS) {
      const row = ACCOUNT_METHOD_ERRORS[m];
      for (const c of row) expect(known.has(c), `${m}: ${c}`).toBe(true);
      expect(new Set(row).size, m).toBe(row.length);
    }
    expect(new Set(ACCOUNT_ERROR_CODES).size).toBe(ACCOUNT_ERROR_CODES.length);
    expect(ACCOUNT_ERROR_CODES).not.toContain('recoveryInvalid');
  });

  it('each row is its own codes, the common ones, and for an Auth method the session and status codes RESTRICTED_CALLS imply', () => {
    for (const m of METHODS) {
      if (m === 'nameUnavailable') continue;
      const want = new Set([...COMMON, ...OWN[m]]);
      if (PATCHES.includes(m)) want.add('conflict');
      if (!NO_AUTH.includes(m)) {
        want.add('sessionExpired');
        want.add('sessionRevoked');
        const partly = REAUTH_ONLY.includes(m);
        if (partly || !RESTRICTED_CALLS.suspended.includes(m)) want.add('suspended');
        if (partly || !RESTRICTED_CALLS.banned.includes(m)) want.add('banned');
        if (partly || !RESTRICTED_CALLS.deleting.includes(m)) want.add('deletionPending');
      }
      expect([...ACCOUNT_METHOD_ERRORS[m]].sort(), m).toEqual([...want].sort());
    }
    expect(ACCOUNT_METHOD_ERRORS.nameUnavailable).toEqual([]);
  });

  it('spot checks against the design text', () => {
    // D24: the right password always signs in; a status never answers a sign-in
    for (const m of ['register', 'signIn', 'useRecoveryCode', 'useEmailReset', 'resume'] as const) {
      for (const c of ['suspended', 'banned', 'deletionPending']) expect(ACCOUNT_METHOD_ERRORS[m], `${m} ${c}`).not.toContain(c);
    }
    expect(ACCOUNT_METHOD_ERRORS.resume).toEqual(expect.arrayContaining(['sessionExpired', 'sessionRevoked']));
    // the security housekeeping of a restricted session
    expect(ACCOUNT_METHOD_ERRORS.changePassword).not.toContain('suspended');
    expect(ACCOUNT_METHOD_ERRORS.changePassword).not.toContain('deletionPending');
    expect(ACCOUNT_METHOD_ERRORS.newRecoveryCodes).not.toContain('banned');
    expect(ACCOUNT_METHOD_ERRORS.newRecoveryCodes).toContain('deletionPending');
    expect(ACCOUNT_METHOD_ERRORS.rename).toEqual(expect.arrayContaining(['suspended', 'banned', 'deletionPending', 'renameCooldown']));
    expect(ACCOUNT_METHOD_ERRORS.cancelDeletion).toEqual(expect.arrayContaining(['suspended', 'banned', 'notAllowed']));
    expect(ACCOUNT_METHOD_ERRORS.cancelDeletion).not.toContain('deletionPending');
    expect(ACCOUNT_METHOD_ERRORS.profile).not.toContain('sessionRevoked');
    expect(ACCOUNT_METHOD_ERRORS.report).toEqual(expect.arrayContaining(['notAllowed', 'sessionRevoked', 'suspended']));
    expect(Object.isFrozen(ACCOUNT_METHOD_ERRORS)).toBe(true);
    expect(Object.isFrozen(ACCOUNT_METHOD_ERRORS.register)).toBe(true);
  });

  it('an appeal and a guest claim need the password too: neither can be undone (M14-15, review A3)', () => {
    expect([pinAppealAction, pinAppealProof, pinClaimProof]).toEqual([true, true, true]);
    for (const m of ['appeal', 'claimGuest'] as const) {
      expect(ACCOUNT_METHOD_ERRORS[m], m).toEqual(expect.arrayContaining(['reauthRequired', 'badCredentials']));
    }
  });

  it('a rename needs the password, like every change that could keep the owner out (finding 6, 5.2)', () => {
    expect([pinRenameAction, pinRenameProof]).toEqual([true, true]);
    expect(ACCOUNT_METHOD_ERRORS.rename).toEqual(expect.arrayContaining(['reauthRequired', 'badCredentials']));
    // the same codes as the other changes that need a proof
    for (const m of ['newRecoveryCodes', 'setEmail', 'unlinkProvider', 'exportData', 'deleteAccount', 'rename'] as const) {
      expect(ACCOUNT_METHOD_ERRORS[m], m).toEqual(expect.arrayContaining(['reauthRequired', 'badCredentials']));
    }
  });

  it('every method that writes the account row may answer conflict, as ServiceGuard.patch does after 3 retries (finding 3)', () => {
    for (const m of ['setAvatar', 'setPrivacy', 'setEmail', 'verifyEmail', 'deleteAccount', 'cancelDeletion', 'signIn', 'useRecoveryCode', 'useEmailReset'] as const) {
      expect(ACCOUNT_METHOD_ERRORS[m], m).toContain('conflict');
    }
    // read-only calls never do
    for (const m of ['self', 'sessions', 'profile', 'relations', 'resume', 'requestEmailReset', 'providerCallback'] as const) {
      expect(ACCOUNT_METHOD_ERRORS[m], m).not.toContain('conflict');
    }
  });
});

describe('M14-1: RESTRICTED_CALLS (3.8)', () => {
  it('suspended and banned: the notice, sessions, security housekeeping, appeal, export and deletion, and a reauth through a provider', () => {
    const want = [
      'self', 'markSeen', 'sessions', 'revokeSession', 'signOut', 'changePassword', 'newRecoveryCodes', 'setEmail', 'verifyEmail', 'appeal', 'exportData', 'deleteAccount',
      'beginProvider', 'confirmProvider',
    ];
    expect([...RESTRICTED_CALLS.suspended].sort()).toEqual([...want].sort());
    expect([...RESTRICTED_CALLS.banned].sort()).toEqual([...want].sort());
  });

  it('deleting: the notice, sessions, the password, export and cancel, and a reauth through a provider', () => {
    expect([...RESTRICTED_CALLS.deleting].sort()).toEqual([
      'beginProvider', 'cancelDeletion', 'changePassword', 'confirmProvider', 'exportData', 'revokeSession', 'self', 'sessions', 'signOut',
    ]);
  });

  it('an account without a password can prove itself in a restricted session: a reauth flow only (findings 2, 8; D24, 5.2)', () => {
    expect(RESTRICTED_PROVIDER_INTENTS).toEqual(['reauth']);
    expect(Object.isFrozen(RESTRICTED_PROVIDER_INTENTS)).toBe(true);
    for (const status of ['suspended', 'banned', 'deleting'] as const) {
      // every call of the list that needs a Proof has a way to get one without a password: beginProvider and confirmProvider (intent reauth)
      const needsProof = RESTRICTED_CALLS[status].filter((m) => ['newRecoveryCodes', 'setEmail', 'exportData', 'deleteAccount'].includes(m));
      expect(needsProof.length, status).toBeGreaterThan(0);
      for (const m of ['beginProvider', 'confirmProvider'] as const) expect(RESTRICTED_CALLS[status], `${status} ${m}`).toContain(m);
    }
    // any other intent from a restricted session still answers the status's code
    for (const m of ['beginProvider', 'confirmProvider'] as const) {
      expect(ACCOUNT_METHOD_ERRORS[m], m).toEqual(expect.arrayContaining(['suspended', 'banned', 'deletionPending']));
    }
  });

  it('a restricted session can never play, rename, change the avatar or privacy, block, report or claim', () => {
    for (const status of ['suspended', 'banned', 'deleting'] as const) {
      for (const m of ['rename', 'setAvatar', 'setPrivacy', 'block', 'mute', 'report', 'claimGuest', 'relations'] as const) {
        expect(RESTRICTED_CALLS[status], `${status} ${m}`).not.toContain(m);
      }
    }
    expect(Object.isFrozen(RESTRICTED_CALLS) && Object.isFrozen(RESTRICTED_CALLS.banned)).toBe(true);
  });
});

describe('M14-1: audit kinds and categories (8.5)', () => {
  it('AUDIT_CATEGORY covers every kind and nothing else', () => {
    expect(pinDetails).toBe(true);
    expect(Object.keys(AUDIT_CATEGORY).sort()).toEqual([...AUDIT_KINDS].sort());
    expect(new Set(AUDIT_KINDS).size).toBe(AUDIT_KINDS.length);
    for (const k of AUDIT_KINDS) expect(['security', 'moderation', 'operator']).toContain(AUDIT_CATEGORY[k]);
  });

  it('the three kind lists split AUDIT_KINDS exactly, in its order, by the ranges of the design', () => {
    const all = [...SECURITY_AUDIT_KINDS, ...MODERATION_AUDIT_KINDS, ...OPERATOR_AUDIT_KINDS];
    expect(all).toEqual([...AUDIT_KINDS]);
    expect(new Set(all).size).toBe(AUDIT_KINDS.length);
    const range = (from: AuditKind, to: AuditKind) => AUDIT_KINDS.slice(AUDIT_KINDS.indexOf(from), AUDIT_KINDS.indexOf(to) + 1);
    expect(SECURITY_AUDIT_KINDS).toEqual(range('registered', 'captchaRequired'));
    expect(MODERATION_AUDIT_KINDS).toEqual(range('reported', 'appealAnswered'));
    expect(OPERATOR_AUDIT_KINDS).toEqual(range('adminViewed', 'nameRekeyed'));
    expect(SECURITY_AUDIT_KINDS).toHaveLength(28);
    expect(MODERATION_AUDIT_KINDS).toHaveLength(8);
    expect(OPERATOR_AUDIT_KINDS).toHaveLength(5);
    // reported is filed under the reporter and is moderation, never in an export (10.1)
    expect(AUDIT_CATEGORY.reported).toBe('moderation');
    expect(AUDIT_CATEGORY.adminViewed).toBe('operator');
    expect(AUDIT_CATEGORY.deleted).toBe('security');
    expect(AUDIT_DETAILS_MAX).toBe(1_024);
  });

  it('a details value of each shape type-checks (a few kinds)', () => {
    const d: { [K in AuditKind]?: AuditDetails[K] } = {
      registered: { provider: 'local', claimed: false },
      signInFailed: { count: 3, nameTag: null },
      signInThrottled: { rule: 3, nameTag: 'abcd' },
      sessionReuse: {},
      captchaRequired: { rule: 'register', bits: 16 },
      nameRekeyed: { from: 1, to: 2, changed: 0 },
    };
    expect(Object.keys(d)).toHaveLength(6);
  });
});

describe('M14-1: the error classes', () => {
  it('AccountsAdminError and HasherBusyError carry their fields', () => {
    const a = new AccountsAdminError('incomplete', 'a required holder is missing');
    expect(a).toBeInstanceOf(Error);
    expect(a).toMatchObject({ code: 'incomplete', name: 'AccountsAdminError', message: 'a required holder is missing' });
    const h = new HasherBusyError(1_500);
    expect(h).toBeInstanceOf(Error);
    expect(h).toMatchObject({ retryAfterMs: 1_500, name: 'HasherBusyError' });
  });
});
