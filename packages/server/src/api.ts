/**
 * The local HTTP API between the browser client and the OpenMTG server (docs/design/m8-client.md, "Server API").
 *
 * Shared contract: the client imports these types (`import type ... from '@openmtg/server/api'`), the server's handlers implement them. This file must
 * stay browser-safe: types and plain constants only, and imports only from `@openmtg/engine` (never Node modules or `@openmtg/cards`).
 *
 * Every response is JSON. Errors use `ApiError` with an HTTP status:
 *   400 bad request (a malformed body, an unknown or malformed search parameter, an unknown format, text that is not a decklist);
 *   404 unknown card name (`suggestions` lists close names);
 *   409 ambiguous face name (C1: a face name shared by several cards; `suggestions` lists their full names);
 *   409 also: an update is already running (UPD1, POST /api/update, `code: 'updateRunning'`);
 *   503 not available yet (C1; `code` says which): 'noCardData' (no local card index: `npm run cards -- refresh` or the Update button),
 *       'indexBuilding' (the automation filter needs the classification index, still being built: `progress`, `retryAfterMs`);
 *   501 not implemented yet (C0 scaffold stubs; no C1 endpoint answers it any more).
 */
import type { AutomationLevel, CardDef, Color, ManualSpan, ReplayGameInfo, ReplayReveal } from '@openmtg/engine';

/** Default port of the local server (127.0.0.1 only). */
export const DEFAULT_PORT = 47600;
/** Every API path starts with this prefix; in development Vite proxies it to the server. */
export const API_PREFIX = '/api';

// ---------------------------------------------------------------------------------------------------------------------------------------------------
// Shared pieces

/** A format's legality of a card, as Scryfall reports it (`not_legal` = not in the format's card pool). */
export type Legality = 'legal' | 'not_legal' | 'banned' | 'restricted';

/** Card image URLs; present only when the client asked for them (the "Show card images from Scryfall" setting, ARCHITECTURE.md "Card images" B). */
export interface ImageUris {
  normal?: string;
  large?: string;
  /** Scryfall's artist of this picture: shown with it as "Illustrated by ...". */
  artist?: string;
}

export interface FaceSummary {
  name: string;
  /** Printed mana cost text ("{2}{G}"), null when the face has none. */
  manaCost: string | null;
  typeLine: string;
  oracleText: string;
  power?: string;
  toughness?: string;
  loyalty?: string;
  defense?: string;
  colors: Color[];
  /** Only when requested with `images=1`; taken from the local index, never built by hand. */
  imageUris?: ImageUris;
}

/** One search result (one Oracle card). */
export interface CardSummary {
  name: string;
  /** Scryfall Oracle id: decks store it next to the name so they survive card-data refreshes (docs/design/decks-and-formats.md). */
  oracleId: string;
  layout: string;
  /** Mana value (CR 202.3). */
  manaValue: number;
  colors: Color[];
  colorIdentity: Color[];
  faces: FaceSummary[];
  /** Per-format legality, keyed by Scryfall format name ("standard", "modern", "commander"...). */
  legalities: Record<string, Legality>;
  automation: AutomationLevel;
}

/**
 * C1 addition: the kind of a manual part. 'not-understood' the compiler does not read the text yet; 'needs-engine' the text is read but the engine lacks
 * the rules support; 'capped' the whole card is limited (a layout or template the engine does not run, a stub card); 'rejected' the card could not be
 * compiled at all.
 */
export type ManualCategory = 'not-understood' | 'needs-engine' | 'capped' | 'rejected';

/**
 * A manual part of a card, shown to players before they pick it (design: "automation level with the manual parts listed"). Show `summary` (a sentence
 * for players); `reason` is the compiler's diagnostic, for an expandable detail view. `category` and `summary` are C1 additions.
 */
export type ManualPart = Pick<ManualSpan, 'text' | 'reason' | 'impact'> & { face: number; category: ManualCategory; summary: string };

// ---------------------------------------------------------------------------------------------------------------------------------------------------
// GET /api/status (C0 addition: the About screen's card-data date, versions and coverage)

export interface StatusResponse {
  app: { name: 'OpenMTG'; version: string };
  /** `COMPILER_VERSION` of the engine the server compiles with. */
  compilerVersion: string;
  /** The local Scryfall bulk file, null when the cache has not been downloaded yet (`npm run cards -- refresh`). */
  cardData: { updatedAt: string; downloadedAt: string; cards?: number } | null;
  /** Version of the installed rules pack (docs/design/updates.md), null when none is installed (UPD1: read from the pack's install record). */
  rulesPack: string | null;
  /** Automation coverage of the whole card pool, null until the classification index is built. */
  coverage: { full: number; partial: number; manual: number; total: number } | null;
  /**
   * M13-11 (hosted design 12), absent when no hosted game server is configured (`--hosted-url`, OPENMTG_HOSTED_URL): the WebSocket origin of the hosted
   * server, `wss://play.example.net` (or `ws://127.0.0.1:<port>` for a server on this machine). New game then offers "Play on the DigiDice server";
   * the page adds the socket path (`HOSTED_SOCKET_PATH`, '/ws').
   */
  hostedUrl?: string;
}

// ---------------------------------------------------------------------------------------------------------------------------------------------------
// GET /api/cards/search?q=&colors=&types=&mv=&format=&automation=&page=&images=

/**
 * Every parameter is checked: an unknown parameter name, malformed syntax, an unbalanced quote or a format no card has legality data for answers 400
 * with the reason (C1), never an ignored filter.
 */
export interface SearchQuery {
  /**
   * Name or rules-text words (every word must appear in the name or the rules text; "double quotes" keep a phrase together; "//" with or without
   * spaces is the split-card separator). With `q` or `name`, results are ordered by relevance (C1): exact full name, exact face name, then names that
   * start with the words, then names that hold every word, then rules-text matches; Oracle-name order within each group.
   */
  q?: string;
  /** C1 addition: words that must all appear in the name (any face). */
  name?: string;
  /** C1 addition: words that must all appear in the rules text (any face). */
  text?: string;
  /**
   * Color letters, e.g. "WU"; "C" for colorless. Without an operator the card has at least these colors (">=", as Scryfall's `c:`); "=" exactly these;
   * "<=" no colors outside these. A double-faced card's colors are its front face's (CR 712.8a).
   */
  colors?: string;
  /** C1 addition: color identity letters (CR 903.4), same syntax as `colors`; without an operator "<=" (fits a commander of these colors). */
  identity?: string;
  /** Card types, supertypes or subtypes, all required; commas, spaces and dashes separate them ("creature,elf", "Legendary Creature — Elf"). */
  types?: string;
  /** Mana value (CR 202.3): "3", "<=2", ">=5", "<4", ">1", "=0". */
  mv?: string;
  /** C1 addition: power of any face, same comparisons as `mv` (numeric powers only; "*" matches only "*"). */
  pow?: string;
  /** C1 addition: toughness of any face, same comparisons as `pow`. */
  tou?: string;
  /** C1 addition: comma-separated keywords, all required ("flying,lifelink"; Scryfall's keyword list). */
  keywords?: string;
  /**
   * Only cards legal (or restricted) in this format (Scryfall format name, or an alias such as "edh"). Cards without legality data are left out.
   * "freeform" and "casual" mean no card-pool filter. A format no card has legality data for answers 400 listing the known ones.
   */
  format?: string;
  /**
   * Only cards at this automation level. Needs the whole card pool classified: until the background build is done the server answers 503 with
   * `code: 'indexBuilding'`, `progress` and `retryAfterMs` (C1).
   */
  automation?: AutomationLevel;
  /**
   * A search in Scryfall's syntax (https://scryfall.com/docs/syntax), the deckbuilder's "Advanced search"; ANDed with the other parameters. Supported:
   * name (bare words, "quoted", /regex/, !exact), c/color, id/identity, t/type, o/oracle, fo/fulloracle, kw/keyword, m/mana, mv/cmc, pow, tou, pt, loy, def,
   * f/format/legal, banned, restricted, is, not, has, layout, produces, devotion, s/set/e/edition (a set code or name; the set's card list comes from
   * Scryfall the first time, sets.ts), with AND (implicit), OR, parentheses and a `-` prefix to negate. A keyword that needs printing data the local
   * index lacks (rarity, artist, flavor, year, prices, ...) or is unknown answers 400 naming it, as does a set search without the set's list offline.
   */
  scry?: string;
  /** 1-based page number. */
  page?: number;
  /** C1 addition: results per page, 1-200 (default 50). */
  pageSize?: number;
  /** 1 = include Scryfall image URLs (the player opted in). */
  images?: 0 | 1;
}

export interface SearchResponse {
  cards: CardSummary[];
  page: number;
  pageSize: number;
  total: number;
}

// ---------------------------------------------------------------------------------------------------------------------------------------------------
// GET /api/sets

/** A Magic set, for the Advanced search form's Set field (sets.ts: from Scryfall's /sets, kept next to the card data). */
export interface SetSummary {
  /** Scryfall's set code, lower case (dmu). */
  code: string;
  name: string;
  /** Scryfall's set type (expansion, core, commander, promo, token, ...). */
  type: string;
  /** Release date, YYYY-MM-DD ('' when Scryfall has none). */
  released: string;
  /** Printings in the set (Scryfall's card_count). */
  cards: number;
  /** Released online only (MTG Arena, Magic Online). */
  digital?: boolean;
}

export interface SetsResponse {
  /** Every set, newest first. */
  sets: SetSummary[];
}

// ---------------------------------------------------------------------------------------------------------------------------------------------------
// GET /api/cards/:name

export interface CardDetailResponse {
  card: CardSummary;
  /** Compiled definition summary: per face, how many abilities and which are manual. */
  compiled: { faces: { name: string; abilities: number; manual: number }[]; compilerVersion: string };
  /** The parts players resolve by hand (empty when the card is fully automated). */
  manualParts: ManualPart[];
}

// ---------------------------------------------------------------------------------------------------------------------------------------------------
// POST /api/decks/resolve { text }

export type DeckSection = 'main' | 'sideboard' | 'commander' | 'companion';

export interface ResolveRequest {
  /** Decklist text (Arena, MTGO or plain), or a deck-site link. */
  text: string;
}

export interface ResolvedCard {
  section: DeckSection;
  count: number;
  /** Oracle name. */
  name: string;
  /** Scryfall Oracle id (docs/design/decks-and-formats.md: decks reference cards by Oracle name and oracle_id). */
  oracleId: string;
  automation: AutomationLevel;
}

export interface UnknownCard {
  section: DeckSection;
  /** The name as written (invisible format characters removed). */
  name: string;
  count: number;
  /** The line of the name's first occurrence in this section. */
  line: number;
  /** Close names; empty after the first 100 unknown names of one request (an `errors` entry says so). */
  suggestions: string[];
  /** A face name shared by several cards: their full names. */
  ambiguous?: string[];
  /**
   * C1 addition (WP24 stub hook, design 12.1): the stub card the player may confirm instead of fixing the name (no cost, no types, no text, played by
   * hand). Absent for an ambiguous face name (the player picks one of the full names, a stub would hide a card the index knows), and for a line without
   * an explicit count or without a plausible card name (prose, a CSV header, "-1 Opt").
   */
  stub?: CardDef;
}

/** A recognized deck-site link: no request is made to the site (docs/research/deck-sites.md); the player follows the export steps. */
export interface DeckSiteLink {
  site: string;
  url: string;
  exportSteps: string[];
  /** C1 addition: false for a link whose host is not a known deck site (generic export steps). */
  known?: boolean;
}

export interface ResolveResponse {
  cards: ResolvedCard[];
  unknown: UnknownCard[];
  /**
   * Lines that are not deck entries: parse errors, text around a deck link (ignored, never read as a card), the back face of a meld pair (CR 712.4b),
   * and a note when suggestions were capped. Text where most lines are not card names answers 400 instead.
   */
  errors: { line: number; text: string; message: string }[];
  links: DeckSiteLink[];
  /** Maybeboard entries that were parsed and ignored. */
  ignored: number;
}

// ---------------------------------------------------------------------------------------------------------------------------------------------------
// POST /api/cards/defs { names }

export interface DefsRequest {
  /** Oracle names (as returned by resolve). Face names and loose spellings are accepted too; `defs` is keyed by the name as sent. */
  names: string[];
  /**
   * C1 addition: names the player confirmed as stub cards (UnknownCard.stub). Each gets `stubCardDef(name, 'decklist')`, or the real card when the
   * index has learned the name since (the Update button). A stub name that is now an ambiguous face name, or a known card the compiler rejects, is
   * reported in `failed` instead (never a blank stub hiding a known card). A name may be in both `names` and `stubs` (the player confirmed its stub):
   * it gets the stub and is not reported in `failed`.
   */
  stubs?: string[];
}

/**
 * C6 addition (INTERFACE CHANGE): why a name could not be compiled, as a code clients act on (`reason` is English text for the player and may be
 * reworded): 'unknown', the card data does not know the name (the only case a client may offer a stub card for); 'ambiguous', a face name shared by
 * several cards (the player picks a full name); 'rejected', the compiler rejected a known card.
 */
export type DefsFailureCode = 'unknown' | 'ambiguous' | 'rejected';

export interface DefsFailure {
  name: string;
  code: DefsFailureCode;
  reason: string;
}

export interface DefsResponse {
  /**
   * C1 change: keyed by the name as requested (was "by Oracle name"; a face name or loose spelling is answered under the spelling sent). `CardDef.id` is
   * the Oracle name. Game configs embed them (the engine state is self-contained).
   */
  defs: Record<string, CardDef>;
  /** Names that could not be compiled, with the reason. Every requested name is in exactly one of `defs` and `failed`. */
  failed: DefsFailure[];
  compilerVersion: string;
}

// ---------------------------------------------------------------------------------------------------------------------------------------------------
// POST /api/decks/validate { deck, format }

/** A deck entry: the Oracle name, and the Oracle id when known (decks imported from text get it from resolve). */
export interface DeckEntry {
  name: string;
  count: number;
  oracleId?: string;
}

export interface DeckList {
  main: DeckEntry[];
  sideboard: DeckEntry[];
  commander?: DeckEntry[];
  companion?: DeckEntry[];
}

export interface ValidateRequest {
  deck: DeckList;
  /** Scryfall format name, e.g. "standard", "modern", "commander"; "freeform" skips card-pool checks. */
  format: string;
}

export interface DeckProblem {
  /** C1 addition: 'commander' and 'companion' (commander and companion rules, CR 903.3, 702.139). */
  kind: 'size' | 'copies' | 'banned' | 'restricted' | 'notLegal' | 'sideboard' | 'identity' | 'commander' | 'companion' | 'unknown';
  /**
   * C1 addition: 'error' breaks a rule of the format; 'warning' means something could not be checked (no legality data, an unknown card), never a silent
   * pass; 'note' is informational.
   */
  severity: 'error' | 'warning' | 'note';
  message: string;
  /** The card the problem is about, if any. */
  card?: string;
  /** CR citations (e.g. "CR 100.2a"). */
  rules: string[];
}

export interface ValidateResponse {
  /** The format as requested. */
  format: string;
  /** C1 addition: the validator's id of the format it checked ("freeform" is checked as "casual", "edh" as "commander"). */
  checkedAs: string;
  /**
   * True when no problem has severity 'error'. NOT "legal": `valid` can be true while warnings say something could not be checked (an unknown card,
   * no legality data, an unchecked companion). Clients show `status`, and render the warnings even when `valid` is true.
   */
  valid: boolean;
  /**
   * C1 addition: 'illegal' at least one error; 'unchecked' no error but at least one warning (something could not be checked; never show it as
   * legal); 'legal' no errors and no warnings (notes are informational).
   */
  status: 'legal' | 'illegal' | 'unchecked';
  problems: DeckProblem[];
  /**
   * CMP1 INTERFACE CHANGE (additive): the companion the validator checked (CR 702.139a), by Oracle name: the deck's Companion section, or the one card of
   * an MTGO-style sideboard whose condition the deck fulfills (a note says so). Absent: no companion. New game plays this one (game/config.ts).
   */
  companion?: string;
}

// ---------------------------------------------------------------------------------------------------------------------------------------------------
// POST /api/images/match { fileNames, deckNames? }

export interface ImageMatchRequest {
  fileNames: string[];
  /** Names in the player's decklist: preferred when a file name is ambiguous. */
  deckNames?: string[];
}

export interface ImageSlotMatch {
  /** Slot key the image is stored under (Oracle name plus face, or a token variant). */
  key: string;
  label: string;
  /** Oracle name of the card or token. */
  card: string;
}

export interface ImageFileMatch {
  fileName: string;
  /** Best match, null when nothing matched. */
  match: ImageSlotMatch | null;
  /** 0..1; below the client's threshold the file goes to the review screen. */
  confidence: number;
  alternatives: ImageSlotMatch[];
}

export interface ImageMatchResponse {
  matches: ImageFileMatch[];
}

// ---------------------------------------------------------------------------------------------------------------------------------------------------
// GET /api/update, POST /api/update {} (UPD1, milestone 7: the Update button; docs/design/updates.md "Two sources, one button")

/** Card counts per automation level of the whole card pool (the shape of `StatusResponse.coverage`). */
export interface CoverageCounts {
  full: number;
  partial: number;
  manual: number;
  total: number;
}

/** Where a running update is: 'cards' the Scryfall refresh, 'pack' the rules pack download and install, 'compile' the summary's re-compile. */
export type UpdatePhase = 'cards' | 'pack' | 'compile';

/** The rules-pack part of an update. */
export type UpdatePackResult =
  /** No pack URL is configured (OPENMTG_PACK_URL): the pack part is off until the project publishes a pack. `installed`: a pack installed earlier. */
  | { state: 'notConfigured'; installed: string | null }
  /** Downloaded, verified against its manifest's SHA-256 and installed. `rejected`: entries refused one by one by the validator. */
  | { state: 'installed'; version: string; entries: number; rejected: number; verified: boolean }
  /** Not installed (download failed, integrity or format check failed); `kept` is the pack installed before, still in use. */
  | { state: 'failed'; error: string; kept: string | null };

export interface UpdateResult {
  /**
   * 'updated' something new was installed (card data or a rules pack); 'current' everything was already up to date; 'partial' one part failed and the
   * other worked or had nothing to do; 'failed' nothing could be updated.
   */
  outcome: 'updated' | 'current' | 'partial' | 'failed';
  /** Nothing could be downloaded at all (no connection, or Scryfall and the pack host both unreachable): the local data is unchanged and still used. */
  offline: boolean;
  /** The Scryfall Oracle bulk refresh (at most one download per 24 h; 'current' = "already current"). */
  cardData: { state: 'refreshed' | 'current' | 'failed'; detail: string };
  /** Cards the local index knows now and did not know before. */
  cardsAdded: number;
  /** The first names of the new cards (at most 20). */
  newCards: string[];
  pack: UpdatePackResult;
  /** Parser templates of the installed rules pack, before and after. */
  templates: { before: number; after: number; added: number };
  /**
   * Coverage of the whole card pool before the update and now. `after` is null while the classification index of the new card data is being built
   * (`afterPending`; ask again), or when there is no card data.
   */
  coverage: { before: CoverageCounts | null; after: CoverageCounts | null; afterPending: boolean };
  /** Among the new cards and the cards a rules pack touches (`runUpdate`'s delta): how many are more automated, less automated, still manual. */
  delta: { newlyAutomated: number; lessAutomated: number; stillManual: number };
  /** Cards a pack lists as needing a newer OpenMTG (they play with manual resolution until then); `names` holds at most 20. */
  needsNewer: { count: number; names: string[] };
  /** Pack entries the gates refused on this player's own card text (never used). */
  refusedForYourText: number;
}

export interface UpdateJob {
  /** Increases with every update started by this server process. */
  id: number;
  /** 'failed' only when the update itself crashed (`error`); a finished update whose parts failed is 'done' with `result.outcome`. */
  state: 'running' | 'done' | 'failed';
  phase: UpdatePhase | null;
  startedAt: string;
  finishedAt: string | null;
  /** The progress lines, as the CLI (`npm run cards -- update`) prints them; at most the last 200. */
  log: string[];
  /**
   * The summary's compile (phase 'compile'): cards compiled and pack entries checked so far, of `total`. Up to the whole pool on a first card download,
   * about a minute; it runs in time slices, so the server keeps answering meanwhile. Null outside that phase.
   */
  progress: { done: number; total: number } | null;
  result: UpdateResult | null;
  error?: string;
}

export interface UpdateStatusResponse {
  /** False while no rules-pack URL is configured: the Update button then refreshes only the card data and says so. */
  packConfigured: boolean;
  /** The configured pack manifest URL (OPENMTG_PACK_URL), null when none. */
  packUrl: string | null;
  /** The last update of this server process (running or finished), null when none was started. */
  job: UpdateJob | null;
}

/** POST /api/update starts an update; the body is an empty object (`{}`). An update already running answers 409 with `code: 'updateRunning'`. */
export type UpdateRequest = Record<string, never>;

// ---------------------------------------------------------------------------------------------------------------------------------------------------
// The player's library in the server's data folder (library/): GET /api/library/decks, GET /api/library/decks/:id, POST /api/library/decks/save,
// POST /api/library/decks/delete, GET and POST /api/library/settings, GET /api/library/images, POST /api/library/images/add, /delete, /clear

/** A deck of the player's library: the desktop client's `Deck` record (client/src/decks/model.ts), one file per deck. */
export interface LibraryDeck {
  id: string;
  name: string;
  /** Format id, e.g. "modern", "commander", "casual". */
  format: string;
  main: DeckEntry[];
  sideboard: DeckEntry[];
  commander: DeckEntry[];
  companion: DeckEntry[];
  notes: string;
  /** ISO timestamps; `updatedAt` is also the version a save names as `expected`. */
  createdAt: string;
  updatedAt: string;
  /** Oracle name of the card shown for the deck. */
  cover?: string;
}

export interface LibraryDecksResponse {
  /** Newest first, then by name. */
  decks: LibraryDeck[];
}

export interface LibraryDeckResponse {
  deck: LibraryDeck;
}

/**
 * `expected`: the `updatedAt` of the stored version this save replaces, or null when the deck must not exist yet; another stored version answers 409
 * (`code: 'deckConflict'`, the stored deck in `stored`) and writes nothing. Absent: no check.
 */
export interface LibrarySaveRequest {
  deck: LibraryDeck;
  expected?: string | null;
}

export interface LibraryDeleteRequest {
  id: string;
}

export interface LibraryDeleteResponse {
  /** False when there was no such deck. */
  deleted: boolean;
}

export interface LibrarySettingsResponse {
  /** The saved object, null when nothing was saved. */
  settings: Record<string, unknown> | null;
  updatedAt: string | null;
}

export interface LibrarySettingsRequest {
  settings: Record<string, unknown>;
}

export interface LibrarySettingsSaved {
  updatedAt: string;
}

/**
 * A stored picture of an image slot (the engine's `imageSlots` key: one per printed side), as the desktop client's image store
 * keeps it (client/src/images/store.ts StoredImage), with the stored file's local path instead of the bytes.
 */
export interface LibraryImage {
  key: string;
  /** Oracle name of the card or token ("A // B" for a two-sided card). */
  card: string;
  /** "Delver of Secrets (front)". */
  label: string;
  /** The added file's own name. */
  fileName: string;
  /** image/png, image/jpeg, image/gif, image/webp, image/bmp, image/avif or image/heic, read from the bytes. */
  type: string;
  size: number;
  /** ms since the epoch. */
  addedAt: number;
  /** The stored file on this machine. */
  path: string;
}

export interface LibraryImagesResponse {
  /** By card, then label, then key. */
  images: LibraryImage[];
}

/** One of `path` (a file on this computer) or `data` (the bytes, base64); a picture of 25 MB at most. */
export interface LibraryImageAddRequest {
  key: string;
  card: string;
  label: string;
  fileName?: string;
  path?: string;
  data?: string;
}

export interface LibraryImageResponse {
  image: LibraryImage;
}

export interface LibraryImageDeleteRequest {
  key: string;
}

export interface LibraryImagesCleared {
  /** How many pictures were deleted. */
  deleted: number;
}

/** A replay of the library (library/replays.ts): its facts (engine ReplayFile without the play), Keep, size, when added and the file's local path. */
export interface LibraryReplay {
  id: string;
  title: string;
  createdAt: string;
  kind: 'game' | 'recording';
  game: ReplayGameInfo;
  reveal: ReplayReveal;
  hasRecording: boolean;
  /** The file's format version and engine facts (absent on entries added before they were kept). */
  formatVersion?: number;
  engine?: { build: string | null; model: number; viewSchema: number };
  /** What it can be watched as on this server: "exact" (this build), "checked" (checked when watched), "recordingOnly", "needsNewer". */
  status: 'exact' | 'checked' | 'recordingOnly' | 'needsNewer';
  keep: boolean;
  size: number;
  addedAt: number;
  path: string;
}

export interface LibraryReplaysResponse {
  /** Newest first. */
  replays: LibraryReplay[];
  /** How many replays not marked Keep are kept: 10, 50 or 200. */
  retention: number;
}

export interface LibraryReplayResponse {
  replay: LibraryReplay;
}

// ---------------------------------------------------------------------------------------------------------------------------------------------------
// Errors and the endpoint table

export interface ApiError {
  error: string;
  /** C1 addition: close names for an unknown card name (404) or the full names an ambiguous face name may mean (409). */
  suggestions?: string[];
  /** C1 addition, on 503 answers: why the endpoint cannot answer yet (see the file header). */
  code?: 'noCardData' | 'indexBuilding' | 'updateRunning' | 'deckConflict';
  /** C1 addition, with `code: 'indexBuilding'`: cards classified so far, of the whole pool. */
  progress?: { done: number; total: number };
  /** C1 addition, with `code: 'indexBuilding'`: when to ask again. */
  retryAfterMs?: number;
  /** For 501 answers of the C0 scaffold stubs: what the endpoint still has to do (no C1 endpoint sends it). */
  todo?: string[];
  /** With `code: 'deckConflict'`: the stored version of the deck (absent when it was deleted). */
  stored?: LibraryDeck;
}

/** Every endpoint: method + path pattern -> request and response types. `:name` is a URL-encoded path parameter. */
export interface ApiEndpoints {
  'GET /api/status': { query: Record<string, never>; body: undefined; response: StatusResponse };
  'GET /api/cards/search': { query: SearchQuery; body: undefined; response: SearchResponse };
  'GET /api/cards/:name': { query: { images?: 0 | 1 }; body: undefined; response: CardDetailResponse };
  'GET /api/sets': { query: Record<string, never>; body: undefined; response: SetsResponse };
  'POST /api/decks/resolve': { query: Record<string, never>; body: ResolveRequest; response: ResolveResponse };
  'POST /api/cards/defs': { query: Record<string, never>; body: DefsRequest; response: DefsResponse };
  'POST /api/decks/validate': { query: Record<string, never>; body: ValidateRequest; response: ValidateResponse };
  'POST /api/images/match': { query: Record<string, never>; body: ImageMatchRequest; response: ImageMatchResponse };
  'GET /api/update': { query: Record<string, never>; body: undefined; response: UpdateStatusResponse };
  'POST /api/update': { query: Record<string, never>; body: UpdateRequest; response: UpdateStatusResponse };
  'GET /api/library/decks': { query: Record<string, never>; body: undefined; response: LibraryDecksResponse };
  'GET /api/library/decks/:id': { query: Record<string, never>; body: undefined; response: LibraryDeckResponse };
  'POST /api/library/decks/save': { query: Record<string, never>; body: LibrarySaveRequest; response: LibraryDeckResponse };
  'POST /api/library/decks/delete': { query: Record<string, never>; body: LibraryDeleteRequest; response: LibraryDeleteResponse };
  'GET /api/library/settings': { query: Record<string, never>; body: undefined; response: LibrarySettingsResponse };
  'POST /api/library/settings': { query: Record<string, never>; body: LibrarySettingsRequest; response: LibrarySettingsSaved };
  'GET /api/library/images': { query: Record<string, never>; body: undefined; response: LibraryImagesResponse };
  'POST /api/library/images/add': { query: Record<string, never>; body: LibraryImageAddRequest; response: LibraryImageResponse };
  'POST /api/library/images/delete': { query: Record<string, never>; body: LibraryImageDeleteRequest; response: LibraryDeleteResponse };
  'POST /api/library/images/clear': { query: Record<string, never>; body: Record<string, never>; response: LibraryImagesCleared };
  'GET /api/library/replays': { query: Record<string, never>; body: undefined; response: LibraryReplaysResponse };
  'POST /api/library/replays/update': { query: Record<string, never>; body: { id: string; title?: string; keep?: boolean }; response: LibraryReplayResponse };
  'POST /api/library/replays/delete': { query: Record<string, never>; body: { id: string }; response: LibraryDeleteResponse };
  'POST /api/library/replays/import': {
    query: Record<string, never>;
    /** A file on this computer (`path`) or a file's bytes (`data`, base64); `keep`: marked Keep where it came from. */
    body: { path?: string; data?: string; keep?: boolean };
    response: LibraryReplayResponse;
  };
  'POST /api/library/replays/retention': { query: Record<string, never>; body: { limit: number }; response: { retention: number } };
}

export type EndpointKey = keyof ApiEndpoints;
export type Method = 'GET' | 'POST';

/** The endpoint keys as a runtime list (the server's route table is checked against it). */
export const ENDPOINTS: readonly EndpointKey[] = [
  'GET /api/status',
  'GET /api/cards/search',
  'GET /api/cards/:name',
  'GET /api/sets',
  'POST /api/decks/resolve',
  'POST /api/cards/defs',
  'POST /api/decks/validate',
  'POST /api/images/match',
  'GET /api/update',
  'POST /api/update',
  'GET /api/library/decks',
  'GET /api/library/decks/:id',
  'POST /api/library/decks/save',
  'POST /api/library/decks/delete',
  'GET /api/library/settings',
  'POST /api/library/settings',
  'GET /api/library/images',
  'POST /api/library/images/add',
  'POST /api/library/images/delete',
  'POST /api/library/images/clear',
  'GET /api/library/replays',
  'POST /api/library/replays/update',
  'POST /api/library/replays/delete',
  'POST /api/library/replays/import',
  'POST /api/library/replays/retention',
];
