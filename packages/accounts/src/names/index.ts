/**
 * M14-2: the names part's factories (design 6.2-6.4): NameRules (the canonical key with its data versions, reserved names, the forced-rename
 * series) and ListNameFilter. src/compose.ts imports these names and src/index.ts re-exports this file (`export *`), so every name here is unique
 * in the package. The browser-safe display check is ./api/names (checkAccountName).
 */
export { createNameRules, type DisplayAwareNameRules } from './rules';
export { createListNameFilter, DEFAULT_MODERATION_WORDS, NAME_FILTERED_MESSAGE } from './filter';
export { createNameData, CURRENT_NAME_DATA, PREVIOUS_NAME_DATA } from './data';
export { encodeNameTable, type GeneratedNameData } from './table';
export { DEFAULT_RESERVED_NAMES } from './reserved';
