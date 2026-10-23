/**
 * Moderation of the lobby (design 4.2, 11; package M13-8): the word filter on display names and table titles (`WordModeration`, the tables layer's
 * `ModerationHook`, on the filter of `@openmtg/accounts`), and the operator's admin command that hides a table from the lobby (`hideTable`, read by
 * the running server's `HideList`). Moderation tools beyond these come with accounts (milestone 14).
 */
export { moderationFromFile, NAME_REFUSED, TITLE_REFUSED, WordModeration, WORDS_FILE_MAX_BYTES } from './words';
export {
  appendHide, effectiveHides, HIDE_FILE, HIDE_FILE_READ_MAX, HIDE_POLL_MS, hideFileOf, HideList, hideTable, parseHideRecords, unhideTable, type Hideable,
  type HideListOptions, type HideRecord,
} from './hidden';
