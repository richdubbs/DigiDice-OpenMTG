/**
 * The lobby browser and table passwords (design 4.2, 4.3; package M13-8): listings with filters, sorting and live updates (`LobbyBrowser`, the gateway's
 * `LobbyService` and the tables layer's `ListingSink`), and the scrypt `PasswordHook`.
 *
 * How main.ts wires it: `new LobbyBrowser({ maxWatchers: config.maxLobbyWatchers, source: () => gateway.tables.listings() })` is both the gateway's
 * `listings` sink and its `hooks.lobby`; `lobby.start()` runs its timer; `new ScryptPasswords()` is the gateway's `passwords`.
 */
export { LobbyBrowser, RECONCILE_EVERY_MS, type LobbyBrowserOptions } from './browser';
export { ListingIndex, HIDE_TTL_MS, MAX_HIDDEN, type ListingChange } from './listings';
export { compareListings, matchesFilter, normalizeFilter, pageOf, sameFilter, sameListing } from './query';
export {
  PASSWORD_KEY_BYTES, PasswordBusyError, PASSWORD_SALT_BYTES, scryptDerive, ScryptPasswords, TABLE_SCRYPT, type PasswordDerive, type ScryptPasswordsOptions, type ScryptSettings,
} from './passwords';
