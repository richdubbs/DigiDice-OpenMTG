import type { CostDef, EffectProgram } from '../../types/ability';

/**
 * CR 605.1a (2026-09-25 update; Scryfall rulings of 2026-08-05): an activated ability is a mana ability only if "its cost and effect don't move any card to or from a library".
 * `movesLibraryCards` is true when the cost or the effect of an ability does: a draw, a mill, a scry or surveil (the cards go on the bottom or into the graveyard), a search, a
 * reveal-until, a clash, a card put into a library, a card moved or cast from the top of a library. Such an ability uses the stack whatever else it adds (edh-fix-5).
 * What does not count: a "when that mana is spent" trigger (`whenSpent`, CR 106.6), a delayed trigger or a reflexive trigger the ability creates (CR 603.7, 603.12: a separate triggered ability, not its effect), and an ability a token or a
 * quoted ability grants (it is judged as the ability it is).
 */
const ALWAYS = new Set(['draw', 'mill', 'scry', 'surveil', 'revealUntil', 'clash', 'exileUntil']); // exileUntil: "exile cards from the top of a library until ..."
/** Keyword actions that take cards from or put cards into a library (CR 701.44 explore, 701.40 manifest, 701.57 discover, 702.85 cascade, 701.50 connive: the discard is not one, but the draw is; learn, cycle, transmute, clash). */
const LIBRARY_ACTIONS = new Set(['explore', 'manifest', 'manifestDread', 'cloak', 'discover', 'connive', 'learn', 'cycle', 'transmute', 'clash', 'cascade']);
const MOVERS = new Set(['move', 'cast', 'piles', 'search', 'exchange']);
const READERS = new Set(['reveal', 'look', 'chooseObjects']); // a step that names the library cards a later move or cast then moves
const NESTED_ABILITY = new Set(['activated', 'triggered', 'static', 'keyword', 'manual']);

const mentionsLibrary = (v: unknown): boolean => {
  if (Array.isArray(v)) return v.some(mentionsLibrary);
  if (v === null || typeof v !== 'object') return v === 'library' || v === 'libraryTop' || v === 'libraryBottom';
  const o = v as Record<string, unknown>;
  if (o['ref'] === 'topCards') return true;
  return Object.values(o).some(mentionsLibrary);
};

const stepMoves = (v: unknown): boolean => {
  if (Array.isArray(v)) return v.some(stepMoves);
  if (v === null || typeof v !== 'object') return false;
  const o = v as Record<string, unknown>;
  if (typeof o['kind'] === 'string' && NESTED_ABILITY.has(o['kind']) && typeof o['text'] === 'string') return false; // a granted ability
  const op = o['op'];
  if (op === 'delay' || op === 'reflexive') return false; // a separate triggered ability
  if (typeof op === 'string') {
    if (ALWAYS.has(op)) return true;
    if (op === 'action' && typeof o['action'] === 'string' && LIBRARY_ACTIONS.has(o['action'])) return true;
    if (MOVERS.has(op)) {
      // `search` finds in the zone it names (library by default in the text, `zone` in the model); a move/cast/exile reads its own subtree
      if (op === 'search') return o['zone'] === 'library' || o['allZones'] === true || (Array.isArray(o['alsoZones']) && (o['alsoZones'] as unknown[]).includes('library'));
      if (mentionsLibrary(o)) return true;
    }
  }
  return Object.entries(o).some(([k, x]) => k !== 'untainted' && k !== 'whenSpent' && k !== 'rider' && stepMoves(x));
};

/** A cost part that moves a card to or from a library, also inside a choice between costs (`oneOf`, any option may be the one paid). */
export const costMovesLibraryCards = (cost: CostDef): boolean =>
  (cost.other ?? []).some((p) => p.kind === 'putIntoLibrary' || (p.kind === 'moveCards' && p.to === 'libraryTop') /* edh-d-54 */ || p.kind === 'mill' || (p.kind === 'exileFrom' && p.zone === 'library') || (p.kind === 'oneOf' && p.options.some(costMovesLibraryCards)));

/** Reveal, look or choose among library cards (naming them) and then move or cast the cards so named. */
const readsThenMoves = (program: EffectProgram): boolean => {
  const bound = new Set<string>(); // the names the reading steps gave the library cards they name
  const movers: unknown[] = [];
  const walk = (v: unknown): void => {
    if (Array.isArray(v)) return v.forEach(walk);
    if (v === null || typeof v !== 'object') return;
    const o = v as Record<string, unknown>;
    if (o['op'] === 'delay' || o['op'] === 'reflexive' || (typeof o['kind'] === 'string' && NESTED_ABILITY.has(o['kind']) && typeof o['text'] === 'string')) return;
    if (typeof o['op'] === 'string' && READERS.has(o['op']) && mentionsLibrary(o) && typeof o['as'] === 'string') bound.add(o['as']);
    if (o['op'] === 'move' || o['op'] === 'cast') movers.push(o);
    for (const [k, x] of Object.entries(o)) if (k !== 'untainted' && k !== 'whenSpent' && k !== 'rider') walk(x);
  };
  walk(program);
  return movers.some((m) => mentionsLibrary(m) || [...bound].some((n) => JSON.stringify(m).includes(`"${n}"`))); // a move of the cards that were read, never of something else (this creature)
};

export const effectMovesLibraryCards = (program: EffectProgram): boolean => stepMoves(program) || readsThenMoves(program);

export const movesLibraryCards = (cost: CostDef, program: EffectProgram): boolean => costMovesLibraryCards(cost) || effectMovesLibraryCards(program);

/**
 * For an ability whose effect is not built (a manual one): the text names a draw, a mill, a scry, a surveil, a search or a library (CR 605.1a, the same rule read from the words).
 * Everything from the sentence of the first "when", "whenever" or "at the beginning of" on is a reflexive, delayed or "when this mana is spent" trigger (CR 603.7, 603.12): a separate ability.
 */
export const textMovesLibraryCards = (text: string): boolean => {
  const own = text.replace(/"[^"]*"/g, '""').replace(/(^|\.\s+)(Spend this mana|Activate)\b[^.]*\./gi, '$1'); // a restriction names spells and abilities, not instructions
  // the sentence that holds the first trigger word and everything after it
  const trigger = /(^|\.\s+)[^.]*\b(when|whenever|at the beginning of)\b/i.exec(own);
  const cut = trigger === null ? -1 : trigger.index;
  const effect = (cut < 0 ? own : own.slice(0, cut)).replace(/\bin (your|a|each|an opponent's|their|its owner's) librar(y|ies)\b/gi, '');
  return /\b(draws?|mills?|scry|surveil|search(es)?|libraries|library|explore|manifest|manifests|cloak|discover|connive|cascade|learn|clash|cycle|transmute)\b/i.test(effect);
};
