/** @openmtg/cards public API (Node only). */
export { CardDatabase, CardDatabaseError, type DatabaseStats, type OpenOptions, type ResolveOptions, type ResolvedDecklist, type ResolvedEntry, type ResolvedName, type UnknownName, type UnresolvedEntry } from './database';
export { parseDecklist, totalCount, type DeckLine, type DeckParseError, type DeckSection, type ParsedDecklist } from './decklist';
export { compileCards, compileCardsSafe, compileResolvedDeck, meldResultCards, CardCompileError, type CompiledDeck, type CompileFailure } from './compile';
export { decodeText } from './text';
export { normalizeName, looseName } from './normalize';
export { NameIndex } from './name-index';
export { ScryfallClient, ScryfallHttpError, ScryfallRateLimitError, USER_AGENT, type Clock } from './http';
export { refreshBulk, shouldDownload, canSkipWithoutNetwork, type BulkMeta, type RefreshResult } from './bulk';
export { buildFixture, generateFixtures, parseCardList, type FixtureFile } from './fixtures';
export { trimCard, toFixtureCard } from './trim';
export { buildIndexData, type IndexOptions, type IndexStats } from './index-store';
export { LEGALITIES, legalitiesOf, legalityIn, isUnsanctioned, trimLegalities, type IndexedCard, type Legalities, type Legality } from './legalities';
export { compileDeckWithStubs, type StubbedDeck, type StubConfirmation } from './stubs';
export { matchImageName, slotsOfCard, tokenVariantsFor, type ImageLookup, type ImageMatch } from './images';
export { defaultCacheDir } from './paths';
export {
  FORMATS,
  findFormat,
  formatById,
  validateDeck,
  UnknownFormatError,
  canBeCommander,
  canPartner,
  partnerAbilities,
  basicLandTypes,
  colorIdentity,
  deckLimitText,
  frontFace,
  hasCompanion,
  isBasicLand,
  COMPANION_RULES,
  checkCompanion,
  companionCondition,
  companionRuleOf,
  formatListLines,
  problemLine,
  reportLines,
  type CommanderStyle,
  type CompanionCheck,
  type CompanionRule,
  type CompanionVerdict,
  type StartingDeck,
  type DeckEntry,
  type DeckPart,
  type DeckToValidate,
  type FormatDef,
  type FormatId,
  type FormatProblem,
  type FormatReport,
  type PartnerAbility,
  type ProblemCode,
  type Severity,
  type UnknownEntry,
} from './formats';
// Milestone 7 (WP26, WP27): the LLM compile cache and rules packs, for the client's Update button and its compile sources (design 11.5, 12.5).
export { LlmCache, defaultCompiledDir } from './llm/cache';
export { type LlmClient, type LlmRequest, type LlmReply, type CompileIndexEntry } from './llm/types';
export { OPENMTG_VERSION, validatePack, validateManifest, compareVersions, type RulesPack, type PackManifest, type ValidatedPack } from './pack/format';
export { installPack, loadInstalledPack, defaultPacksDir, PackError, type InstalledRecord, type LoadedPack } from './pack/install';
export { downloadPack } from './pack/fetch';
export { sourcesWith, type DataSources } from './pack/sources';
export { runUpdate, type UpdateDeps, type UpdateSummary, type PackSource } from './pack/update';
