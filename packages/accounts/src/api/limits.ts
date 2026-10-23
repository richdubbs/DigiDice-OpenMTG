/**
 * M14-1's: the limits of `@openmtg/accounts/api` (design 11.1), in a leaf module that imports nothing. ../api re-exports it by name.
 *
 * Why a file of its own: ../api re-exports the parts in this folder (names, passwords, email), and each part needs these numbers. A part that took
 * them from ../api would close a cycle in which, while the contract loads, the part runs before ../api's body, so a value read at the part's top
 * level is undefined (bundles, Vitest) or in its temporal dead zone (Node). The parts take values from here and types from ../api (`import type`);
 * test/m14-1/load.test.ts checks both, and loads the contract with each file first.
 */
export const ACCOUNT_LIMITS = {
  nameMin: 3, nameMax: 20,                // code points of the display form (6.1)
  nameRawMax: 256,                        // UTF-16 units before any work
  passwordMin: 12, passwordMax: 128,      // code points after NFKC (4.2); passwordMin is PASSWORD_MIN on the server, sent to clients (11.6)
  passwordRawMax: 512,
  recoveryCodes: 10, recoveryCodeLength: 16, recoveryRawMax: 32,
  emailMax: 254, emailLocalMax: 64, emailLabelMax: 63, emailCodeLength: 10,
  confirmCodeLength: 8, confirmTries: 5,
  reportText: 2_000, appealText: 2_000,
  relationsMax: 500, claimsMax: 20, sessionsMax: 20, devicesMax: 10,
  captchaTokenMax: 2_048,
  minAge: 13,                             // MIN_AGE on the server, sent to clients (11.6)
} as const;
