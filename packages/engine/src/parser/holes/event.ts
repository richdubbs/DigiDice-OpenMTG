/**
 * Hole grammar `Event` (EventPattern[]), design 6.3 and model section 3.5. Owner: WP6.
 *
 *   Event      ::= StepEvent | SubjectEvent | CounterEvent | StateEvent
 *   StepEvent  ::= "the beginning of" Step | "end of combat"                         => {ev:'step'}
 *   SubjectEvent ::= Subject { "or" Subject } Predicate { "or" Predicate }           => one pattern per (subject, predicate) pair
 *   Subject    ::= ~ | "a|an|another|each" NP | "one or more" NP | "enchanted|equipped" NP | "you" | "a player" | "an opponent"
 *   Predicate  ::= enters | dies | leaves the battlefield | is put into a graveyard from ... | is exiled | attacks [alone] | blocks | becomes blocked [by NP]
 *                | deals [combat] damage [to R] | is dealt [combat] damage [by NP] | becomes tapped/untapped/the target of .../monstrous/renowned
 *                | is turned face up | transforms | cast NP | draw | gain/lose life | sacrifice/discard/cycle NP | create tokens | roll a die | play a land | attack [with N or more NP]
 * The word that introduces the trigger ("when", "whenever", "at") stays in the template. "one or more" subjects and "you attack" set the flag `batch` (CR 603.2c):
 * the template or the lowering pass puts `batch: true` on the TriggerDef.
 */
import { WITHOUT_DYING, type Condition, type EventPattern, type NumberCmp, type ObjectFilter, type PlayerPred, type PlayerRef, type ZoneName } from '../../types/ability';
import type { Step } from '../../types/state';
import type { ManaType } from '../../types/mana';
import type { Alt, HoleCtx, HoleFn } from './core';
import { P, anaphorObj, anyPhraseAt, cmpAt, dedupe, mergeFilter, numberAt, phraseAt, predOf } from './core';
import { npAlts, yourCommanderAt, postModAt } from './filter';
import { possessivePlayerAt } from './player';
import { sacrificedOrDestroyed } from './edhd87'; // edh-d-87
import type { ZoneValue } from './zone';

// ---------------------------------------------------------------------------
// steps
// ---------------------------------------------------------------------------

/**
 * "main phase" without first / second / precombat / postcombat is both main phases (CR 505.1). FAST5X E17: "second main phase" is the main phase that is the
 * second of its turn (CR 505.1b), `nth: 2`: an additional main phase is a postcombat main phase but not the second one (CR 505.1a). "first main phase" needs
 * no number: only the first main phase is a precombat main phase (CR 505.1a).
 */
const STEPS: [string[], Step[], number?][] = [
  [P('upkeep'), ['upkeep']], [P('draw step'), ['draw']], [P('precombat main phase'), ['main1']], [P('first main phase'), ['main1']], [P('main phase'), ['main1', 'main2']],
  [P('postcombat main phase'), ['main2']], [P('second main phase'), ['main2'], 2], [P('beginning of combat'), ['beginCombat']], [P('combat'), ['beginCombat']],
  [P('declare attackers step'), ['declareAttackers']], [P('declare blockers step'), ['declareBlockers']], [P('combat damage step'), ['combatDamage']],
  [P('end of combat step'), ['endCombat']], [P('end step'), ['end']],
];
const W_BEGINNING_OF = P('the beginning of');
/**
 * std-rk (CR 505.1a, 603.2): "at the beginning of each of your postcombat main phases" (Kirri, Talented Sprout; Neheb, the Eternal): the same steps as "your
 * postcombat main phase" (every postcombat main phase of your turns, an additional one included), said in the plural. Only the steps Oracle names so; "each of
 * your main phases" (both kinds at once) is not read here.
 */
const EACH_OF_YOUR_STEPS: [string[], Step[]][] = [
  [P('upkeeps'), ['upkeep']], [P('draw steps'), ['draw']], [P('precombat main phases'), ['main1']], [P('postcombat main phases'), ['main2']], [P('end steps'), ['end']],
  // edh-mana-keywords-7 (CR 505.1a, 603.2; Frontier Siege): both kinds at once, "at the beginning of each of your main phases" (the two steps of every turn of yours)
  [P('main phases'), ['main1', 'main2']],
];
const W_EACH_OF_YOUR = P('each of your');

/**
 * Whose step: the plain words stay words ("your" is 'you', "each opponent's" / "an opponent's" is 'opponent'), "each player's" is every player (no
 * restriction), and every other possessor ("that player's", "its controller's", "the chosen player's", "target player's", "defending player's", "each
 * other player's") stays a player reference for the lowering pass. A possessor is never dropped (CR 500, 603.2).
 */
function whoseOf(ref: PlayerRef): PlayerPred | undefined {
  return ref.ref === 'each' && ref.who === 'player' ? undefined : predOf(ref);
}

function stepEvents(ctx: HoleCtx, pos: number): Alt[] {
  const out: Alt[] = [];
  const emit = (end: number, steps: readonly Step[], whose?: PlayerPred, nth?: number): void => {
    out.push({ end, value: steps.map((step) => ({ ev: 'step', step, ...(whose !== undefined ? { whose } : {}), ...(nth !== undefined ? { nth } : {}) }) satisfies EventPattern) });
  };
  const eoc = anyPhraseAt(ctx, pos, [P('the end of combat'), P('end of combat')]);
  if (eoc >= 0) emit(eoc, ['endCombat']);
  // Standard round 5, r5-trig (CR 511.1, 511.2; Sidequest: Play Blitzball): "at end of combat on your turn": the end of combat step of your turn
  const eocOn = eoc >= 0 ? phraseAt(ctx, eoc, P('on your turn')) : -1;
  if (eocOn >= 0) emit(eocOn, ['endCombat'], 'you');
  // edh-d-34 (CR 500.8, 511.1; Zariel's emblem): "the end of the first combat phase on your turn": the end of combat step of the first combat phase of your turn (`nth` 1)
  const firstOn = phraseAt(ctx, pos, P('the end of the first combat phase on your turn'));
  if (firstOn >= 0) emit(firstOn, ['endCombat'], 'you', 1);
  const b = phraseAt(ctx, pos, W_BEGINNING_OF);
  if (b < 0) return out;
  const eoy = phraseAt(ctx, b, W_EACH_OF_YOUR);
  if (eoy >= 0) for (const [ws, step] of EACH_OF_YOUR_STEPS) {
    const e = phraseAt(ctx, eoy, ws);
    if (e >= 0) emit(e, step, 'you');
  }
  // edh-combat-7 (CR 505.1a, 603.2, 303.4; Shadow of the Second Sun): "at the beginning of each of enchanted player's postcombat main phases" (and any other possessor
  // "each of <player>'s <steps>" takes in the plural): every such step of that player's turns, said as "each of your <steps>" is (an Aura's host player is judged as the step begins)
  const eop = phraseAt(ctx, b, P('each of'));
  if (eop >= 0) for (const o of possessivePlayerAt(ctx, eop)) {
    if (o.ref.ref !== 'enchantedPlayer') continue; // narrow: the Aura's host only
    for (const [ws, step] of EACH_OF_YOUR_STEPS) {
      const e = phraseAt(ctx, o.end, ws);
      if (e >= 0) emit(e, step, whoseOf(o.ref));
    }
  }
  // edh-d-71 (CR 503.1, 500.9, 603.2; Paradox Haze): "at the beginning of enchanted player's first upkeep each turn": the first upkeep step of the turn of that player, never an
  // additional upkeep step added after it (`nth` 1 of the upkeep steps that began in the turn, core/turn.ts#beginStep)
  for (const o of possessivePlayerAt(ctx, b)) {
    const e = phraseAt(ctx, o.end, P('first upkeep each turn'));
    if (e >= 0) emit(e, ['upkeep'], whoseOf(o.ref), 1);
  }
  for (const [ws, steps, nth] of STEPS) {
    // "each upkeep", "the end step", "each combat"
    for (const det of [P('each'), P('the')]) {
      const d = phraseAt(ctx, b, det);
      const e = d >= 0 ? phraseAt(ctx, d, ws) : -1;
      if (e >= 0) emit(e, steps, undefined, nth);
    }
    // "your upkeep", "each player's upkeep", "each opponent's upkeep", "that player's upkeep"
    for (const o of possessivePlayerAt(ctx, b)) {
      const e = phraseAt(ctx, o.end, ws);
      if (e >= 0) emit(e, steps, whoseOf(o.ref), nth);
    }
    // "combat on your turn"; trek-8 (CR 603.2, 506.1): and on any other player's turn ("combat on each player's turn", "on each opponent's turn"), the same step
    // of those turns as "each player's upkeep" is theirs (only the beginning of combat: the main phases and the end step are not said this way)
    const e0 = phraseAt(ctx, b, ws);
    if (e0 >= 0) {
      const on = phraseAt(ctx, e0, P('on'));
      if (on >= 0) for (const o of possessivePlayerAt(ctx, on)) {
        const t = phraseAt(ctx, o.end, P('turn'));
        if (t >= 0 && o.ref.ref === 'you') emit(t, steps, 'you', nth);
        else if (t >= 0 && steps.length === 1 && steps[0] === 'beginCombat' && ws.length === 1) emit(t, steps, whoseOf(o.ref), nth);
      }
    }
  }
  return out;
}

// ---------------------------------------------------------------------------
// subjects
// ---------------------------------------------------------------------------

interface Subj { end: number; obj?: ObjectFilter; player?: PlayerPred; batch: boolean; flags: string[]; head?: string }

const ATTACHED = ['enchanted', 'equipped', 'fortified'];

function objectSubjects(ctx: HoleCtx, pos: number): Subj[] {
  const out: Subj[] = [];
  if (ctx.toks[pos]?.kind === 'SELF') out.push({ end: pos + 1, obj: { self: true }, batch: false, flags: [] });
  const t = ctx.toks[pos]?.norm;
  const nps = (p: number, number: 'singular' | 'plural', extra?: ObjectFilter, batch = false): void => {
    for (const n of npAlts(ctx, p)) {
      if (n.number !== number) continue;
      const f = extra ? mergeFilter(n.filter, extra) : n.filter;
      if (f !== null) out.push({ end: n.end, obj: f, batch, flags: n.flags, head: n.head });
    }
  };
  if (t === 'a' || t === 'an') nps(pos + 1, 'singular');
  if (t === 'another') nps(pos + 1, 'singular', { other: true });
  if (t === 'each') nps(pos + 1, 'singular');
  const oom = phraseAt(ctx, pos, P('one or more'));
  if (oom >= 0) nps(oom, 'plural', undefined, true);
  if (t !== undefined && ATTACHED.includes(t)) nps(pos + 1, 'singular', { attachedToSource: true });
  // CMD2 (CR 903.3d, 903.3e; 702.124e: with two commanders, either one): "whenever your commander enters / attacks / deals combat damage": a commander you own
  for (const n of yourCommanderAt(ctx, pos)) if (n.number === 'singular') out.push({ end: n.end, obj: n.filter, batch: false, flags: [] });
  return out;
}

const W_OPPONENT_WHO_CONTROLS = P('an opponent who controls'); // edh-players-15
function playerSubjects(ctx: HoleCtx, pos: number): Subj[] {
  const out: Subj[] = [];
  const add = (ws: readonly string[], pred: PlayerPred): void => { const e = phraseAt(ctx, pos, ws); if (e >= 0) out.push({ end: e, player: pred, batch: false, flags: [] }); };
  add(P('you'), 'you');
  add(P('a player'), 'any');
  add(P('an opponent'), 'opponent');
  add(P('each opponent'), 'opponent');
  // edh-top-7 (CR 102.2, 603.2; Aerial Extortionist, Firemane Commando): "another player" is a player other than the ability's controller: an opponent (this engine has no teams, CR 810)
  add(P('another player'), 'opponent');
  add(P('each player'), 'any');
  add(P('enchanted player'), { ref: 'enchantedPlayer' }); // std-rr (CR 303.4, 702.5a): the player the source Aura is attached to
  add(P('enchanted opponent'), { ref: 'enchantedPlayer' }); // edh-players-17 (CR 303.4, 702.5a): "Enchant opponent" Auras
  // edh-players-15 (CR 109.4, 102.2, 603.2; Wedding Ring): "an opponent who controls an artifact named X": the actor must be an opponent who controls such a permanent as the event happens
  // (a plain description: "controls" says whose and where; a draw or life-change predicate follows)
  const wc = phraseAt(ctx, pos, W_OPPONENT_WHO_CONTROLS);
  const det = wc >= 0 ? ctx.toks[wc]?.norm : undefined;
  if (wc >= 0 && (det === 'a' || det === 'an')) {
    for (const n of npAlts(ctx, wc + 1)) {
      const f = n.filter;
      if (n.number !== 'singular' || n.head === 'card' || n.head === 'spell' || n.head === 'ability' || n.head === 'stackObject' || f.controller !== undefined || f.owner !== undefined || f.zone !== undefined || f.other !== undefined) continue;
      out.push({ end: n.end, player: { ref: 'controlsAny', filter: f, opponents: true }, batch: false, flags: [] });
    }
  }
  return out;
}

/** "~ or another creature you control" : object subjects joined by "or". */
function objectSubjectLists(ctx: HoleCtx, pos: number): { end: number; subs: Subj[] }[] {
  const out: { end: number; subs: Subj[] }[] = [];
  const walk = (p: number, acc: Subj[], depth: number): void => {
    for (const s of objectSubjects(ctx, p)) {
      const subs = [...acc, s];
      out.push({ end: s.end, subs });
      if (depth < 3) { const or = phraseAt(ctx, s.end, P('or')); if (or >= 0) walk(or, subs, depth + 1); }
      // edh-c-68 (CR 603.2, 205.3; Royal Decree): "a Swamp, Mountain, black permanent, or red permanent": a list of three or more descriptions, the article only before the first
      // (each later one a singular description with no article); one pattern per description. Only after an article-led first subject, never "one or more"
      if (depth === 0 && !s.batch && (s.obj?.subtypes?.length ?? 0) <= 1 && (ctx.toks[p]?.norm === 'a' || ctx.toks[p]?.norm === 'an')) bareList(s.end, subs);
      // Standard round 5, r5-trig (CR 603.2c; Satoru, the Infiltrator): "~ and/or one or more other nontoken creatures you control enter": the object itself, the
      // others, or both at once: one batch trigger over all of them (the "one or more" part makes the list a batch, the flag below)
      if (depth < 3) { const ao = phraseAt(ctx, s.end, P('and/or')); if (ao >= 0) for (const t of objectSubjects(ctx, ao)) if (t.batch) out.push({ end: t.end, subs: [...subs, t] }); }
    }
  };
  // later items of an article-led list: ", Mountain, black permanent, or red permanent" (at least three items in all)
  const bareList = (p: number, acc: Subj[]): void => {
    const comma = phraseAt(ctx, p, P(','));
    if (comma < 0) return;
    const closing = phraseAt(ctx, comma, P('or'));
    for (const n of npAlts(ctx, closing >= 0 ? closing : comma)) {
      if (n.number !== 'singular' || n.flags.length > 0 || (n.filter.subtypes?.length ?? 0) > 1) continue; // a list of subtypes is one description: its own items are listed one by one
      const subs = [...acc, { end: n.end, obj: n.filter, batch: false, flags: n.flags, head: n.head } as Subj];
      // (a list of one kind of description, "a Swamp, Mountain, or Forest" or "an artifact, creature, or enchantment you control", is one description of several values
      // already, read as before: only a list that mixes kinds, subtypes with colors, is read here)
      const kinds = new Set(subs.map((x) => Object.keys(x.obj ?? {}).filter((k) => !['controller', 'owner', 'other', 'zone'].includes(k)).sort().join()));
      const onlySubtypes = kinds.size < 2;
      if (closing >= 0) { if (subs.length >= 3 && !onlySubtypes) out.push({ end: n.end, subs }); }
      else if (subs.length < 5) bareList(n.end, subs);
    }
  };
  walk(pos, [], 0);
  return out;
}

// ---------------------------------------------------------------------------
// predicates
// ---------------------------------------------------------------------------

/** `make` gives null when the predicate cannot hold for this subject (a contradiction such as two different owners): that reading is dropped. */
interface Pred {
  end: number; make: (s: Subj) => EventPattern | null; batch?: boolean;
  /** T3 (push wave): a bare "blocks", and the creature of "becomes blocked by <NP>": "blocks or becomes blocked by <NP>" shares the NP (see `event`). */
  bareBlocks?: true; blockedBy?: ObjectFilter;
  /** edh-replace-3 (CR 603.2c): the whole batch is one occurrence however many players it was dealt to (`TriggerDef.wholeBatch`; "deal combat damage to one or more players"). */
  whole?: true;
}
const sf = (s: Subj): ObjectFilter => s.obj ?? {};
/** pc-counters-1: "a permanent you control", "another permanent": a description of permanents that says no more than who controls or owns them. */
const plainPermanents = (f: ObjectFilter): boolean => Object.entries(f).every(([k, v]) => v === undefined || k === 'controller' || k === 'owner' || k === 'other') && f.self !== true;

/**
 * Who or what is attacked (CR 508.1b: a player, a planeswalker or a battle). M12-3: "you or a planeswalker you control" is `defender: 'you'` with
 * `orPlaneswalker` (W_YOU_OR_YOUR_PLANESWALKER below), never narrowed to "you".
 */
const W_YOU_OR_YOUR_PLANESWALKER = P('you or a planeswalker you control');
const W_A_PLAYER_WHO_CONTROLS = P('a player who controls'); // edh-d-88 (Owlbear Cub)
const W_IF_YOURE_DEFENDING = P(", if you're the defending player"); // edh-combat-1 (CR 508.5, 603.4): Kazuul, Tyrant of the Cliffs
const W_ENCHANTED_PLAYER_ATTACKED = P('enchanted player is attacked'); // pc-combat-1
const W_OPPONENT_OR_THEIR_PLANESWALKER = [P('one of your opponents or a planeswalker an opponent controls'), P('one of your opponents or a planeswalker they control')]; // pc-combat-1
const DEFENDERS: [string[], PlayerPred | 'planeswalker' | 'battle'][] = [
  [P('you'), 'you'], [P('a player'), 'any'], [P('an opponent'), 'opponent'], [P('one of your opponents'), 'opponent'] /* r5-refs (CR 508.1b): Oracle's other name for an opponent */, [P('a planeswalker'), 'planeswalker'], [P('a battle'), 'battle'],
  [P('enchanted player'), { ref: 'enchantedPlayer' }] /* pc-combat-3 (CR 303.4, 508.1b): "a creature attacks enchanted player" (the Curses) */,
  [P('enchanted opponent'), { ref: 'enchantedPlayer' }] /* edh-players-17 (CR 303.4, 508.1b) */,
  [P('the player who has the initiative'), { ref: 'initiative' }] /* edh-next-82 (CR 726.1, 508.1b; Loot Dispute, Undercellar Sweep) */,
  [P('the monarch'), { ref: 'monarch' }] /* edh-next-75 (CR 725.1, 508.1b; The Spear of Bashenga): the player who has the monarch designation as the attackers are declared */,
];

const BASIC_LAND_TYPES = ['Plains', 'Island', 'Swamp', 'Mountain', 'Forest'];

/**
 * FAST1 T4, CR 106.12: to "tap a permanent for mana" is to activate a mana ability of it with {T} in its cost. The event model has no field for the {T}
 * (`activate` with `manaAbility`), so only lands are read: every mana ability of a land has {T} in its cost, while a creature's or an artifact's may not
 * ("Sacrifice a Goblin: Add {R}"). A filter is a land when it says so ("a land", "a nonbasic land", "a land creature") or names basic land types only.
 */
function landTappedForMana(f: ObjectFilter): boolean {
  if (f.anyOf !== undefined || f.not !== undefined || f.self === true) return false;
  const types = f.types ?? [];
  if (types.length === 1 && types[0] === 'Land') return true;
  if (types.length === 0 && (f.allTypes ?? []).includes('Land')) return true;
  return types.length === 0 && f.allTypes === undefined && (f.subtypes?.length ?? 0) > 0 && f.subtypes!.every((t) => BASIC_LAND_TYPES.includes(t));
}

const W_WHILE_SADDLED = P('while saddled'); // FAST5X E3
const W_EXPLOITED: readonly [string[], ObjectFilter | undefined][] = [[P('a creature'), undefined], [P('a nontoken creature'), { types: ['Creature'], token: false }]]; // std-rx17 (CR 702.110b)
const W_EXPLORED_KIND: readonly [string[], 'land' | 'nonland'][] = [[P('a land card'), 'land'], [P('a nonland card'), 'nonland']]; // std-lci (CR 701.44a)

/**
 * p2-trigger-events-1 (CR 110.1, 110.4): a subject that can only be a permanent: "a permanent ...", an attached object ("enchanted artifact"), or a description by
 * card types with no "card" and no zone ("a creature you control"); never the object itself, a card, a spell or a token said by its noun.
 */
function permanentSubject(s: Subj): boolean {
  const f = s.obj;
  if (f === undefined || f.self !== undefined || f.isCard !== undefined || f.zone !== undefined || f.stackKind !== undefined || s.batch) return false;
  if (s.head === 'permanent' || f.attachedToSource === true) return true;
  return s.head === 'type' && ((f.types?.length ?? 0) > 0 || (f.subtypes?.length ?? 0) > 0);
}

/** p2-trigger-events-1 (CR 701.17a): a description of cards ("a nonland card", "one or more creature cards"): what a player mills. */
const cardSubject = (f: ObjectFilter | undefined): boolean => f !== undefined && f.isCard === true && f.self === undefined && f.zone === undefined;

function objectPredicates(ctx: HoleCtx, pos: number): Pred[] {
  const out: Pred[] = [];
  const at = (words: readonly string[], make: Pred['make']): void => { const e = phraseAt(ctx, pos, words); if (e >= 0) out.push({ end: e, make }); };
  const under = (e: number): { end: number; ctl: boolean } => { const u = phraseAt(ctx, e, P('under your control')); return u >= 0 ? { end: u, ctl: true } : { end: e, ctl: false }; };

  for (const w of [P('enters the battlefield'), P('enter the battlefield'), P('enters'), P('enter')]) {
    const e = phraseAt(ctx, pos, w);
    if (e < 0) continue;
    out.push({ end: e, make: (s) => ({ ev: 'zoneChange', subject: sf(s), to: 'battlefield' }) });
    // std-rx19 (CR 603.6a, 614.1c; Gingerbread Cabin): "When this land enters untapped": it entered the battlefield untapped (an "enters tapped" replacement
    // applied before it entered, so the permanent's status as it entered is the one the trigger sees, CR 110.5b)
    const ut = phraseAt(ctx, e, P('untapped'));
    if (ut >= 0) out.push({ end: ut, make: (s) => { const f = mergeFilter(sf(s), { tapped: false }); return f === null ? null : { ev: 'zoneChange', subject: f, to: 'battlefield' }; } });
    // edh-zones-21 (CR 305.1, 603.6a; Deep Gnome Terramancer): "lands enter under an opponent's control without being played": entered by any means but a land play
    for (const [ph, who] of [[P('under your control'), 'you'], [P("under an opponent 's control"), 'opponent']] as const) {
      const u0 = phraseAt(ctx, e, ph);
      const np = u0 >= 0 ? phraseAt(ctx, u0, P('without being played')) : -1;
      if (np >= 0) out.push({ end: np, make: (s) => { const f = mergeFilter(sf(s), { controller: who }); return f === null || f.self === true || f.types?.length !== 1 || f.types[0] !== 'Land' ? null : { ev: 'zoneChange', subject: f, to: 'battlefield', cause: 'unplayed' }; } }); // lands only: a permanent that was cast was played too (CR 701.18b)
    }
    if (w.length > 1) { const u = under(e); if (u.ctl) out.push({ end: u.end, make: (s) => ({ ev: 'zoneChange', subject: { ...sf(s), controller: 'you' }, to: 'battlefield' }) }); }
    // edh-d-37 (CR 603.6a, 110.2; Tunnel Ignus): "a land enters under an opponent's control": an opponent of the ability's controller controls the object as it enters
    const uo = phraseAt(ctx, e, P("under an opponent 's control"));
    if (uo >= 0) out.push({ end: uo, make: (s) => { const f = mergeFilter(sf(s), { controller: 'opponent' }); return f === null || f.self === true || f.owner !== undefined ? null : { ev: 'zoneChange', subject: f, to: 'battlefield' }; } });
    // Standard round 4, r4-trig (CR 400.7, 603.6a; Fire Lord Zuko): "a permanent you control enters from exile": put onto the battlefield from exile
    const fx = phraseAt(ctx, e, P('from exile'));
    if (fx >= 0) out.push({ end: fx, make: (s) => (s.obj?.self === true ? null : { ev: 'zoneChange', subject: sf(s), from: 'exile', to: 'battlefield' }) });
    // p2-trigger-events-1 (CR 603.6a, 614.1c, 110.5b; Amulet of Vigor, Tiller Engine): "a permanent you control enters tapped": put onto the battlefield tapped (an
    // "enters tapped" replacement applied before it entered), the counterpart of "enters untapped" above
    const tp = phraseAt(ctx, e, P('tapped'));
    if (tp >= 0) out.push({ end: tp, make: (s) => { const f = mergeFilter(sf(s), { tapped: true }); return f === null ? null : { ev: 'zoneChange', subject: f, to: 'battlefield' }; } });
    // edh-next-111 (CR 508.4, 603.6a; Arni Metalbrow): "a creature you control enters attacking" / "enters tapped and attacking": put onto the battlefield attacking (it was never declared as an attacker,
    // so no "attacks" trigger; the subject is an attacking creature as it enters). Both words say the same: a permanent put onto the battlefield tapped and attacking is the one that enters attacking
    for (const aw of [P('attacking'), P('tapped and attacking')]) {
      const ak = phraseAt(ctx, e, aw);
      if (ak >= 0) out.push({ end: ak, make: (s) => { const f = mergeFilter(sf(s), { attacking: true }); return f === null || s.batch ? null : { ev: 'zoneChange', subject: f, to: 'battlefield' }; } });
    }
    // edh-d-55 (CR 712.14a, 603.6a, 110.5b; Corruption of Towashi): "a permanent you control enters transformed": it entered the battlefield with its back face up (the filter `transformed`)
    const tf = phraseAt(ctx, e, P('transformed'));
    if (tf >= 0) out.push({ end: tf, make: (s) => { const f = mergeFilter(sf(s), { transformed: true }); return f === null || s.batch ? null : { ev: 'zoneChange', subject: f, to: 'battlefield' }; } });
    // p2-trigger-events-1 (CR 400.3, 603.6a; Phyrexian Dragon Engine, Dredging Claw): "enters from your graveyard": put onto the battlefield from a graveyard, which is
    // its owner's, so the object is one you own (the object itself too: a card that left another player's graveyard under your control never came from yours)
    // edh-perms-10 (CR 400.3, 603.6a; Thousand-Faced Shadow): "enters from your hand": put onto the battlefield from a hand, which is its owner's, so the object is one you own
    const fh = phraseAt(ctx, e, P('from your hand'));
    if (fh >= 0) out.push({ end: fh, make: (s) => { const f = mergeFilter(sf(s), { owner: 'you' }); return f === null || s.batch ? null : { ev: 'zoneChange', subject: f, from: 'hand', to: 'battlefield' }; } });
    const fg = phraseAt(ctx, e, P('from your graveyard'));
    if (fg >= 0) out.push({ end: fg, make: (s) => { const f = mergeFilter(sf(s), { owner: 'you' }); return f === null || s.batch ? null : { ev: 'zoneChange', subject: f, from: 'graveyard', to: 'battlefield' }; } });
    // edh-next-47 (CR 400.3, 603.6a; The Lost and the Damned): "a land you control enters from anywhere other than your hand": a land put onto the battlefield from a library, a graveyard,
    // exile or the command zone (a land is never on the stack, so only lands are read: another permanent entering from a cast spell comes from the stack)
    const fo = phraseAt(ctx, e, P('from anywhere other than your hand'));
    if (fo >= 0) out.push({ end: fo, make: (s) => { const f = sf(s); return s.batch || f === null || f.self === true || f.types?.length !== 1 || f.types[0] !== 'Land' ? null : { ev: 'zoneChange', subject: f, from: ['library', 'graveyard', 'exile', 'command'], to: 'battlefield' }; } });
    // edh-zones-11 (CR 400.3, 603.6a; River Kelpie): "enters from a graveyard": put onto the battlefield from any player's graveyard
    const fa = phraseAt(ctx, e, P('from a graveyard'));
    if (fa >= 0) out.push({ end: fa, make: (s) => (s.batch ? null : { ev: 'zoneChange', subject: sf(s), from: 'graveyard', to: 'battlefield' }) });
  }
  // Cloud std-eoe (CR 700.4, 603.6c, 603.10a): "dies or is put into exile": put into a graveyard or into exile from the battlefield (Syr Vondam, Sunstar Exemplar);
  // the subject is a permanent (a creature you control, ~), whose leaves-the-battlefield ability looks back to the battlefield
  at(P('dies or is put into the command zone'), (s) => ({ ev: 'zoneChange', subject: sf(s), from: 'battlefield', to: ['graveyard', 'command'] })); // edhn63 (Reyhan, Last of the Abzan)
  at(P('dies or is put into exile'), (s) => ({ ev: 'zoneChange', subject: sf(s), from: 'battlefield', to: ['graveyard', 'exile'] }));
  at(P('die or are put into exile'), (s) => ({ ev: 'zoneChange', subject: sf(s), from: 'battlefield', to: ['graveyard', 'exile'] }));
  at(P('dies'), (s) => ({ ev: 'zoneChange', subject: sf(s), from: 'battlefield', to: 'graveyard' }));
  at(P('die'), (s) => ({ ev: 'zoneChange', subject: sf(s), from: 'battlefield', to: 'graveyard' }));
  at(P('leaves the battlefield'), (s) => ({ ev: 'zoneChange', subject: sf(s), from: 'battlefield' }));
  at(P('leave the battlefield'), (s) => ({ ev: 'zoneChange', subject: sf(s), from: 'battlefield' }));
  // FAST5 T65 (CR 700.4, 603.6c): "leaves the battlefield without dying": it left the battlefield for any zone but a graveyard (a creature that "dies" is put into a
  // graveyard from the battlefield, CR 700.4; a token put into a hand, library, exile or the command zone left without dying)
  at(P('leaves the battlefield without dying'), (s) => ({ ev: 'zoneChange', subject: sf(s), from: 'battlefield', to: [...WITHOUT_DYING] }));
  at(P('leave the battlefield without dying'), (s) => ({ ev: 'zoneChange', subject: sf(s), from: 'battlefield', to: [...WITHOUT_DYING] }));
  // FAST4 T23 (CR 400.3, 603.10a): "one or more creature cards leave your graveyard": cards in a graveyard are in their owner's, so "your graveyard" is
  // owner you; only a subject that is a card (the head word "card", CR 404.1) is read, never "~" or a permanent's description
  for (const w of [P('leaves your graveyard'), P('leave your graveyard')]) {
    at(w, (s) => {
      const f = s.obj !== undefined && s.obj.isCard === true && s.obj.self === undefined ? mergeFilter(s.obj, { owner: 'you' }) : null;
      return f === null ? null : { ev: 'zoneChange', subject: f, from: 'graveyard' };
    });
  }
  // CR 400.3: a card goes to its OWNER's graveyard, so "your graveyard" limits the subject to cards you own and "an opponent's graveyard" to theirs.
  for (const be of [P('is put into'), P('are put into')]) {
    const e = phraseAt(ctx, pos, be);
    if (e < 0) continue;
    for (const z of ctx.call('Zone', e)) {
      const zv = z.value as ZoneValue;
      const owner = zv.owner === 'any' ? undefined : zv.owner;
      if (zv.zone !== 'graveyard' || (owner !== undefined && owner !== 'you' && owner !== 'opponent')) continue;
      const subject = (s: Subj): ObjectFilter | null => (owner === undefined ? sf(s) : mergeFilter(sf(s), { owner }));
      const fb = phraseAt(ctx, z.end, P('from the battlefield'));
      if (fb >= 0) out.push({ end: fb, make: (s) => { const f = subject(s); return f === null ? null : { ev: 'zoneChange', subject: f, from: 'battlefield', to: 'graveyard' }; } });
      // FAST5 T66 (CR 400.3, 603.2c): "one or more land cards are put into your graveyard from your library" (milled, or put there by a search): the cards are in their
      // owner's graveyard and came from their owner's library, so only "your graveyard" with "from your library" is read
      const fl = owner === 'you' ? phraseAt(ctx, z.end, P('from your library')) : -1;
      if (fl >= 0) out.push({ end: fl, make: (s) => { const f = subject(s); return f === null ? null : { ev: 'zoneChange', subject: f, from: 'library', to: 'graveyard' }; } });
      // edh-next-138 (CR 400.3, 603.2c, 701.9a; Desert Warfare): "a Desert card is put into your graveyard from your hand or library": a card you own, discarded (or otherwise put there) from your
      // hand, or milled (or put there by a search) from your library; a card only (a hand and a library hold cards)
      const fhl = owner === 'you' ? Math.max(phraseAt(ctx, z.end, P('from your hand or library')), phraseAt(ctx, z.end, P('from your hand or your library'))) : -1;
      if (fhl >= 0) out.push({ end: fhl, make: (s) => { const f = subject(s); return f === null || f.isCard !== true ? null : { ev: 'zoneChange', subject: f, from: ['hand', 'library'], to: 'graveyard' }; } });
      // edh-d-57 (CR 400.3, 603.2c; Undead Alchemist): "a creature card is put into an opponent's graveyard from their library": a card an opponent owns, milled (or put there by a search) from its owner's library
      const fl3 = owner === 'opponent' ? phraseAt(ctx, z.end, P('from their library')) : -1;
      if (fl3 >= 0) out.push({ end: fl3, make: (s) => { const f = subject(s); return f === null ? null : { ev: 'zoneChange', subject: f, from: 'library', to: 'graveyard' }; } });
      // edh-next-47 (CR 400.3, 603.2c; Dreadhound): "a creature card is put into a graveyard from a library" (any player's graveyard, from any player's library: milled, or put there by a search)
      const fl2 = owner === undefined ? phraseAt(ctx, z.end, P('from a library')) : -1;
      if (fl2 >= 0) out.push({ end: fl2, make: (s) => { const f = subject(s); return f === null || f.isCard !== true ? null : { ev: 'zoneChange', subject: f, from: 'library', to: 'graveyard' }; } });
      // pc-counters-1 (CR 700.4, 603.6c; Aetherworks Marvel): "Whenever a permanent you control is put into a graveyard": a permanent is on the battlefield, so the zone it
      // is put there from is the battlefield; only the plain description of permanents (a controller, an owner, "other"), never a card's or an object's own words
      if (owner === undefined) out.push({ end: z.end, make: (s) => (plainPermanents(sf(s)) ? { ev: 'zoneChange', subject: sf(s), from: 'battlefield', to: 'graveyard' } : null) });
      const fa = phraseAt(ctx, z.end, P('from anywhere'));
      if (fa >= 0) out.push({ end: fa, make: (s) => { const f = subject(s); return f === null ? null : { ev: 'zoneChange', subject: f, to: 'graveyard' }; } });
      // edh-zones-3 (CR 400.3, 603.2; Syr Konrad, the Grim): "a creature card is put into a graveyard from anywhere other than the battlefield": from any zone a card can be put
      // into a graveyard from but the battlefield (a hand: discarded, a library: milled, the stack: a spell that resolved or was countered, exile, the command zone)
      const fo = phraseAt(ctx, z.end, W_FROM_ANYWHERE_OTHER_THAN_BATTLEFIELD);
      if (fo >= 0) out.push({ end: fo, make: (s) => { const f = subject(s); return f === null || f.isCard !== true ? null : { ev: 'zoneChange', subject: f, from: ['hand', 'library', 'stack', 'exile', 'command'], to: 'graveyard' }; } });
      // p2-trigger-events-1 (CR 110.1, 603.6c, 603.10a; Aetherworks Marvel, Gremlin Infestation): "a permanent you control is put into a graveyard", "when enchanted
      // artifact is put into a graveyard": only a permanent is described so (a card says "card"), so it can only come from the battlefield. Never the object itself
      // (old wordings of "~ is put into a graveyard" may mean from anywhere) and never a description of a card or of a zone
      if (owner === undefined) out.push({ end: z.end, make: (s) => (permanentSubject(s) ? { ev: 'zoneChange', subject: sf(s), from: 'battlefield', to: 'graveyard' } : null) });
    }
  }
  // edh-c-20 (CR 400.3, 603.6c, 702.52; Golgari Brownscale): "When this card is put into your hand from your graveyard" (a draw replaced by dredge, a return): a card of yours that was
  // in your graveyard and is now in your hand; only a description of cards or the object itself, from the graveyard named
  for (const be of [P('is put into'), P('are put into')]) {
    const e = phraseAt(ctx, pos, be);
    if (e < 0) continue;
    for (const z of ctx.call('Zone', e)) {
      const zv = z.value as ZoneValue;
      if (zv.zone !== 'hand' || zv.owner !== 'you') continue;
      const fg = phraseAt(ctx, z.end, P('from your graveyard'));
      if (fg >= 0) out.push({ end: fg, make: (s) => {
        const f = sf(s);
        const owned = f === null || (f.self !== true && f.isCard !== true) ? null : mergeFilter(f, { owner: 'you' });
        return owned === null ? null : { ev: 'zoneChange', subject: owned, from: 'graveyard', to: 'hand' };
      } });
    }
  }
  // edh-c-20 (CR 400.3, 401.1, 603.2c; Dutiful Knowledge Seeker): "whenever one or more cards are put into a library from anywhere": cards (never tokens or permanents) that arrive in any
  // player's library from any zone (a shuffle-in, a tuck, a mill that is not one: a card put into a library from anywhere is one move)
  for (const be of [P('is put into'), P('are put into')]) {
    const e = phraseAt(ctx, pos, be);
    if (e < 0) continue;
    for (const z of ctx.call('Zone', e)) {
      const zv = z.value as ZoneValue;
      if (zv.zone !== 'library' || zv.owner !== undefined) continue;
      const fa = phraseAt(ctx, z.end, P('from anywhere'));
      if (fa >= 0) out.push({ end: fa, make: (s) => {
        const f = sf(s);
        return f === null || f.isCard !== true || f.self === true ? null : { ev: 'zoneChange', subject: f, from: ['hand', 'battlefield', 'graveyard', 'stack', 'exile', 'command'], to: 'library' }; // not from a library (Wan Shi Tong ruling 2025-10-02)
      } });
    }
  }
  // std-lci (CR 701.44a-b): "Whenever a creature you control explores", "... explores a land card" / "... explores a nonland card" (the card it revealed)
  for (const w of [P('explores'), P('explore')]) {
    const e = phraseAt(ctx, pos, w);
    if (e < 0) continue;
    out.push({ end: e, make: (s) => ({ ev: 'action', verb: 'explore', object: sf(s) }) });
    for (const [ws, revealed] of W_EXPLORED_KIND) { const k = phraseAt(ctx, e, ws); if (k >= 0) out.push({ end: k, make: (s) => ({ ev: 'action', verb: 'explore', object: sf(s), revealed }) }); }
  }
  // edh-next-33 (CR 701.50a, 603.2; Iron Monger): "Whenever a creature you control connives": the creature that connived, once the whole connive is done
  for (const w of [P('connives'), P('connive')]) {
    const e = phraseAt(ctx, pos, w);
    if (e < 0) continue;
    out.push({ end: e, make: (s) => ({ ev: 'action', verb: 'connive', object: sf(s) }) });
  }
  // edh-combat-6 (CR 701.14a, 603.2; Neyith of the Dire Hunt): "Whenever one or more creatures you control fight": each creature of a fight is reported (one occurrence for the event, effects/handlers/lifedamage.ts)
  for (const w of [P('fights'), P('fight')]) {
    const e = phraseAt(ctx, pos, w);
    if (e < 0) continue;
    out.push({ end: e, make: (s) => ({ ev: 'action', verb: 'fight', object: sf(s) }) });
  }
  // edh-c-49 (CR 702.154a, 603.2; Guardian of New Benalia): "Whenever ~ enlists a creature": the creature that enlisted (the attacker), as the enlist option is taken
  for (const w of [P('enlists a creature'), P('enlist a creature')]) {
    const e = phraseAt(ctx, pos, w);
    if (e < 0) continue;
    out.push({ end: e, make: (s) => ({ ev: 'action', verb: 'enlist', object: sf(s) }) });
  }
  // edh-c-48 (CR 702.100a; Renegade Krasis): "Whenever ~ evolves": an evolve ability put a +1/+1 counter on the creature
  for (const w of [P('evolves'), P('evolve')]) {
    const e = phraseAt(ctx, pos, w);
    if (e < 0) continue;
    out.push({ end: e, make: (s) => ({ ev: 'action', verb: 'evolve', object: sf(s) }) });
  }
  // std-rx17 (CR 702.110b): "When ~ exploits a creature", "Whenever a creature you control exploits a nontoken creature": the creature sacrificed by its exploit
  // ability is always a creature, so "a creature" adds nothing to the pattern
  for (const w of [P('exploits'), P('exploit')]) {
    const e = phraseAt(ctx, pos, w);
    if (e < 0) continue;
    for (const [ws, exploited] of W_EXPLOITED) { const k = phraseAt(ctx, e, ws); if (k >= 0) out.push({ end: k, make: (s) => ({ ev: 'action', verb: 'exploit', object: sf(s), ...(exploited ? { exploited } : {}) }) }); }
  }
  // CMD2 (CR 903.9a-b, 408.1): "whenever your commander is put into the command zone from anywhere" (Myth Unbound): a commander moved there by the state-based
  // action or the replacement of CR 903.9, from any zone
  for (const be of [P('is put into the command zone from anywhere'), P('are put into the command zone from anywhere')]) {
    at(be, (s) => (s.obj?.commander === true ? { ev: 'zoneChange', subject: sf(s), to: 'command' } : null));
  }
  // p2-trigger-events-1 (CR 406.3, 603.6c, 603.10a; Soulherder, Shard of the Void Dragon): "is exiled from the battlefield", "is put into exile from the battlefield"
  for (const w of [P('is exiled from the battlefield'), P('are exiled from the battlefield'), P('is put into exile from the battlefield'), P('are put into exile from the battlefield')]) {
    at(w, (s) => ({ ev: 'zoneChange', subject: sf(s), from: 'battlefield', to: 'exile' }));
  }
  // edh-zones-4 (CR 400.3, 406.3, 603.2c; Laelia, the Blade Reforged): "one or more cards are put into exile from your library and/or your graveyard": cards you own that
  // were in one of those zones and now are in exile (a card goes to its owner's zones, so "your" limits the subject to cards you own); only a description of cards
  for (const be of [P('is put into exile from'), P('are put into exile from')]) {
    for (const [zw, from] of W_EXILE_FROM_ZONES) {
      const w = [...be, ...zw];
      at(w, (s) => {
        const f = s.obj !== undefined && s.obj.isCard === true && s.obj.self === undefined ? mergeFilter(s.obj, { owner: 'you' }) : null;
        return f === null ? null : { ev: 'zoneChange', subject: f, from, to: 'exile' };
      });
    }
  }
  // edh-d-39 (CR 400.3, 406.3, 603.2c; The War Doctor): "one or more other cards are put into exile from anywhere": a card of any owner that went to exile from any zone; only a description of cards
  for (const w of [P('is put into exile from anywhere'), P('are put into exile from anywhere')]) {
    at(w, (s) => (s.obj !== undefined && s.obj.isCard === true ? { ev: 'zoneChange', subject: sf(s), to: 'exile' } : null));
  }
  // p2-trigger-events-1 (CR 701.17a, 603.2c; Mirelurk Queen): "one or more nonland cards are milled", "a creature card is milled": cards a player mills (the
  // action `mill`, any player); only a description of cards
  // edh-perms-20 (CR 603.2c; The Wise Mothman ruling 2024-03-08): "one or more nonland cards are milled" is ONE trigger however many players mill at once (`whole`: TriggerDef.wholeBatch)
  for (const w of [P('is milled'), P('are milled')]) { const e = phraseAt(ctx, pos, w); if (e >= 0) out.push({ end: e, make: (s) => (cardSubject(s.obj) ? { ev: 'action', verb: 'mill', object: sf(s) } : null), whole: true }); }
  at(P('is exiled'), (s) => ({ ev: 'zoneChange', subject: sf(s), to: 'exile' }));
  at(P('are exiled'), (s) => ({ ev: 'zoneChange', subject: sf(s), to: 'exile' }));
  // CLOUD std-msh (CR 400.3, 603.10a, 603.6c): "Whenever another nonland permanent you control is returned to its owner's hand": a permanent put into its
  // owner's hand from the battlefield (the subject is read as it last existed there); only a permanent's description, never a card's ("a card is returned
  // to your hand" may come from any zone)
  // edh-d-6 (CR 400.3, 603.6c; Tameshi, Reality Architect): "one or more noncreature permanents are returned to hand" (the same event, the hand said without its owner)
  for (const w of [P("is returned to its owner 's hand"), P("are returned to their owner 's hand"), P("are returned to their owners ' hands"), P('is returned to hand'), P('are returned to hand')]) {
    at(w, (s) => (s.obj !== undefined && s.obj.isCard === true ? null : { ev: 'zoneChange', subject: sf(s), from: 'battlefield', to: 'hand' }));
  }
  // edh-c-76 (CR 400.3, 603.10a, 603.6c; Stormfront Riders): "Whenever this creature or another creature is returned to your hand from the battlefield": a permanent of yours put into
  // its owner's hand from the battlefield (a hand is its owner's: the subject is a permanent you own)
  for (const w of [P('is returned to your hand from the battlefield'), P('are returned to your hand from the battlefield')]) {
    at(w, (s) => {
      if (s.obj !== undefined && s.obj.isCard === true) return null;
      const f = mergeFilter(sf(s), { owner: 'you' });
      return f === null ? null : { ev: 'zoneChange', subject: f, from: 'battlefield', to: 'hand' };
    });
  }

  // edh-c-63 (CR 400.3, 603.6c, 603.10a; Azorius Aethermage, Warped Devotion, Liability): "a permanent is returned to your hand" / "to a player's hand" / "is put into a player's
  // graveyard from the battlefield": a permanent put into its owner's hand or graveyard from the battlefield (a hand and a graveyard are their owner's, so "your" limits the
  // permanent to ones you own, "a player's" to none); any permanent, a token too (it is put there before it ceases to exist, CR 111.8); only a permanent's description, never a card's
  for (const [w, owner, to] of [
    [P('is returned to your hand'), 'you', 'hand'], [P('are returned to your hand'), 'you', 'hand'],
    [P("is returned to a player 's hand"), undefined, 'hand'], [P("are returned to a player 's hand"), undefined, 'hand'],
    [P("is put into a player 's graveyard from the battlefield"), undefined, 'graveyard'], [P("are put into a player 's graveyard from the battlefield"), undefined, 'graveyard'],
  ] as const) {
    at(w, (s) => {
      if (!permanentSubject(s)) return null;
      const f = owner === undefined ? sf(s) : mergeFilter(sf(s), { owner });
      return f === null ? null : { ev: 'zoneChange', subject: f, from: 'battlefield', to };
    });
  }

  for (const w of [P('attacks'), P('attack')]) {
    const e = phraseAt(ctx, pos, w);
    if (e < 0) continue;
    out.push({ end: e, make: (s) => ({ ev: 'attacks', attacker: sf(s) }) });
    // std-rx35 (CR 509.1h): "Whenever ~ attacks and isn't blocked": an attacker no blocker was declared for, as blockers are declared
    const nb = phraseAt(ctx, e, P("and isn't blocked"));
    if (nb >= 0) out.push({ end: nb, make: (s) => ({ ev: 'attacksUnblocked', attacker: sf(s) }) });
    // pc-combat-4 (CR 509.1h, 508.1b; Coveted Jewel): "one or more creatures an opponent controls attack you and aren't blocked": unblocked attackers of a player
    for (const [ws, defender] of DEFENDERS) {
      // 'any' ("attacks a player and isn't blocked"): "that player" would be the defending player, but the event's `player` role is the attacker's controller: read only for the source itself (edh-combat-6, Master of Cruelties)
      if (defender === 'planeswalker' || defender === 'battle') continue;
      const d = phraseAt(ctx, e, ws);
      if (d < 0) continue;
      for (const nbw of [P("and aren't blocked"), P("and isn't blocked")]) {
        const n2 = phraseAt(ctx, d, nbw);
        if (n2 >= 0) out.push({ end: n2, make: (s) => (defender === 'any' && s.obj?.self !== true ? null : { ev: 'attacksUnblocked', attacker: sf(s), defender }) });
      }
    }
    // FAST5X E3 (CR 702.171b, 508.1): "~ attacks while saddled": the attacker has the saddled designation as it attacks
    const ws = phraseAt(ctx, e, W_WHILE_SADDLED);
    if (ws >= 0) out.push({ end: ws, make: (s) => (s.obj?.self === true ? { ev: 'attacks', attacker: { ...sf(s), saddled: true } } : null) });
    const al = phraseAt(ctx, e, P('alone'));
    if (al >= 0) out.push({ end: al, make: (s) => ({ ev: 'attacks', attacker: sf(s), alone: true }) });
    // edh-d-88 (CR 508.1b, 603.2, 109.4; Owlbear Cub): "attacks a player who controls eight or more lands": the attack is on a player who controls at least N permanents of a plain
    // plural description as the attackers are declared (a planeswalker or battle attacked is not that player)
    const wc = phraseAt(ctx, e, W_A_PLAYER_WHO_CONTROLS);
    const atLeast = wc >= 0 ? numberAt(ctx, wc) : undefined;
    const om = atLeast !== undefined && atLeast >= 2 ? phraseAt(ctx, wc + 1, P('or more')) : -1;
    if (om >= 0) {
      for (const n of npAlts(ctx, om)) {
        const f = n.filter;
        if (n.number !== 'plural' || n.head === 'card' || n.head === 'spell' || n.head === 'ability' || n.head === 'stackObject' || f.controller !== undefined || f.owner !== undefined || f.zone !== undefined || f.other !== undefined) continue;
        const defender: PlayerRef = { ref: 'controlsAny', filter: f, atLeast: atLeast! };
        out.push({ end: n.end, make: (s) => ({ ev: 'attacks', attacker: sf(s), defender }) });
      }
    }
    for (const [ws, defender] of DEFENDERS) {
      const d = phraseAt(ctx, e, ws);
      if (d >= 0) out.push({ end: d, make: (s) => ({ ev: 'attacks', attacker: sf(s), defender }) });
      // Standard round 4, r4-trig (CR 506.5, 508.1b; Jiang Yanggu, Alone and Yuriko, Blade of the Mighty): "attacks a player alone": the only creature declared as an
      // attacker, and it attacks that player (not a planeswalker or battle)
      const da = d >= 0 && typeof defender === 'string' && defender !== 'planeswalker' && defender !== 'battle' ? phraseAt(ctx, d, P('alone')) : -1;
      if (da >= 0) out.push({ end: da, make: (s) => ({ ev: 'attacks', attacker: sf(s), defender, alone: true }) });
    }
    // edh-next-127 (CR 603.2c, 508.1b; Zurzoth, Chaos Rider): "Whenever one or more Devils you control attack one or more players": ONE trigger for the whole declaration, however many
    // players are attacked (TriggerDef.wholeBatch), never one for each player as "attack a player" is; only the plural subject "one or more" (a batch), and only players (an attack on a
    // planeswalker or a battle alone does not trigger it). "those players" then names every player attacked together (parser/lower/scope.ts#eventMentions)
    const many = phraseAt(ctx, e, W_ONE_OR_MORE_PLAYERS);
    if (many >= 0) out.push({ end: many, whole: true, make: (s) => (s.batch ? { ev: 'attacks', attacker: sf(s), defender: 'any' } : null) });
    // edh-combat-1 (CR 508.5, 603.4): "attacks, if you're the defending player": the player attacked, or the controller of the planeswalker or protector of the battle attacked
    const dp = phraseAt(ctx, e, W_IF_YOURE_DEFENDING);
    if (dp >= 0) out.push({ end: dp, make: (s) => ({ ev: 'attacks', attacker: sf(s), defending: 'you' }) });
    // M12-3 (CR 506.3, 508.1b): "attacks you or a planeswalker you control" (`orPlaneswalker`)
    const yp = phraseAt(ctx, e, W_YOU_OR_YOUR_PLANESWALKER);
    if (yp >= 0) out.push({ end: yp, make: (s) => ({ ev: 'attacks', attacker: sf(s), defender: 'you', orPlaneswalker: true }) });
    // pc-combat-1 (CR 506.3, 508.1b; Gahiji, Honored One and Frontier Warmonger): "attacks one of your opponents or a planeswalker an opponent controls": an attack on an
    // opponent or on a planeswalker an opponent controls (`orPlaneswalker` with the defender `opponent`)
    for (const ws of W_OPPONENT_OR_THEIR_PLANESWALKER) {
      const op = phraseAt(ctx, e, ws);
      if (op >= 0) out.push({ end: op, make: (s) => ({ ev: 'attacks', attacker: sf(s), defender: 'opponent', orPlaneswalker: true }) });
    }
  }
  for (const w of [P('blocks'), P('block')]) {
    const e = phraseAt(ctx, pos, w);
    if (e < 0) continue;
    out.push({ end: e, make: (s) => ({ ev: 'blocks', blocker: sf(s) }), bareBlocks: true });
    const a = ctx.toks[e]?.norm;
    if (a === 'a' || a === 'an') for (const n of npAlts(ctx, e + 1)) if (n.number === 'singular') out.push({ end: n.end, make: (s) => ({ ev: 'blocks', blocker: sf(s), attacker: n.filter }) });
    // trek-13 (CR 509.3a, 603.2; Extraction Integrant): "a creature blocks ~" ("this creature"): the blocks event of any other creature that blocks the object itself (once per blocker)
    if (ctx.toks[e]?.kind === 'SELF') out.push({ end: e + 1, make: (s) => (s.obj?.self === true ? null : { ev: 'blocks', blocker: sf(s), attacker: { self: true } }) });
  }
  for (const w of [P('becomes blocked'), P('become blocked')]) {
    const e = phraseAt(ctx, pos, w);
    if (e < 0) continue;
    out.push({ end: e, make: (s) => ({ ev: 'becomesBlocked', attacker: sf(s) }) });
    const by = phraseAt(ctx, e, P('by'));
    const t = by >= 0 ? ctx.toks[by]?.norm : undefined;
    if (t === 'a' || t === 'an') for (const n of npAlts(ctx, by + 1)) if (n.number === 'singular') out.push({ end: n.end, make: (s) => ({ ev: 'becomesBlocked', attacker: sf(s), by: n.filter }), blockedBy: n.filter });
    // edh-d-25 (CR 509.3c, 509.3a, 603.2; Mirror Shield): "a creature with deathtouch becomes blocked by ~" ("this creature"): the becomes-blocked event of any other creature that the object itself
    // blocks (once per attacker); like "a creature blocks ~" above, and shared with a bare "blocks" ("blocks or becomes blocked by ~")
    if (by >= 0 && ctx.toks[by]?.kind === 'SELF') out.push({ end: by + 1, make: (s) => (s.obj?.self === true ? null : { ev: 'becomesBlocked', attacker: sf(s), by: { self: true } }), blockedBy: { self: true } });
    // edh-c-48 (CR 509.3e; Seifer, Balamb Rival): "becomes blocked by two or more creatures": once, when the attacker's blockers reach that number (declared together, or one put onto
    // the battlefield blocking as the second); the group is a description of the blockers, never one the effect can name afterwards
    const more = by >= 0 && t !== 'a' && t !== 'an' ? phraseAt(ctx, by, P('two or more')) : -1;
    if (more >= 0) for (const n of npAlts(ctx, more)) if (n.number === 'plural' && JSON.stringify(n.filter) === '{"types":["Creature"]}') out.push({ end: n.end, make: (s) => ({ ev: 'becomesBlocked', attacker: sf(s), by: n.filter, byAtLeast: 2 }) }); // only plain creatures: the count does not look at what the blockers are
    // edh-d-90 (CR 509.3c, 509.3d, 603.2c; Godsend): "becomes blocked by one or more creatures": the becomes-blocked-by-a-creature events of the attacker, all of one declaration ONE occurrence (a
    // "one or more" trigger, `batch`), so "those creatures" are its blockers; shared with a bare "blocks" ("blocks or becomes blocked by one or more creatures": the attackers it blocks). Only plain
    // creatures (the group is the event's, never filtered)
    const oneOrMore = by >= 0 && t !== 'a' && t !== 'an' ? phraseAt(ctx, by, W_ONE_OR_MORE) : -1;
    if (oneOrMore >= 0) for (const n of npAlts(ctx, oneOrMore)) if (n.number === 'plural' && JSON.stringify(n.filter) === '{"types":["Creature"]}') out.push({ end: n.end, make: (s) => (s.batch ? null : { ev: 'becomesBlocked', attacker: sf(s), by: n.filter }), blockedBy: n.filter, batch: true });
  }

  // damage dealt by the subject
  // Cloud std-woe (CR 120.2b): "deals noncombat damage", any damage that is not combat damage (`combat: false`)
  for (const [w, combat] of [[P('deals combat damage'), true], [P('deal combat damage'), true], [P('deals damage'), undefined], [P('deal damage'), undefined], [P('deals noncombat damage'), false], [P('deal noncombat damage'), false]] as const) {
    const e = phraseAt(ctx, pos, w);
    if (e < 0) continue;
    // CR 109.2: "a permanent" deals damage from the battlefield only, but a role filter has no zone the matcher reads (triggers/match.ts#roleMatches), so
    // its bare filter would also match a spell's damage: that reading is dropped (WP19 review) and the trigger stays manual
    // CMD2 (CR 510.1, 903.3d): "a commander you control deals combat damage": only creatures in combat deal combat damage, so the commander is a permanent there
    const keep = (s: Subj): boolean => s.head !== 'permanent' || (combat === true && s.obj?.commander === true);
    // edh-zones-19 (CR 109.2, 120.2; Dissipation Field): a single "permanent" deals damage: the pattern says the source was a permanent (`sourcePermanent`), so a spell's damage never matches
    const bare = (s: Subj): boolean => s.head === 'permanent' && !s.batch && s.obj?.commander !== true && s.obj?.self !== true && plainPermanents(sf(s));
    const base = (s: Subj): EventPattern | null => (!keep(s) && !bare(s) ? null : { ev: 'damage', source: sf(s), ...(combat !== undefined ? { combat } : {}), ...(bare(s) ? { sourcePermanent: true as const } : {}) });
    out.push({ end: e, make: base });
    const to = phraseAt(ctx, e, P('to'));
    if (to >= 0) for (const r of damageRecipients(ctx, to)) out.push({ end: r.end, make: (s) => { const b = base(s); return b === null ? null : ({ ...b, recipient: r.recipient } as EventPattern); } });
    // edh-replace-3 (CR 603.2c, 510.2, 120.2b; Contaminant Grafter): "one or more creatures you control deal combat damage to one or more players": ONE trigger for all the damage the
    // creatures deal at once, however many players it goes to (the plural subject "one or more" and the plural recipient together; "to a player" is one trigger for each player)
    const toMany = to >= 0 ? phraseAt(ctx, to, W_ONE_OR_MORE_PLAYERS) : -1;
    if (toMany >= 0) out.push({ end: toMany, whole: true, make: (s) => { const b = s.batch ? base(s) : null; return b === null ? null : ({ ...b, recipient: { player: 'any' } } as EventPattern); } });
    // edh-replace-5 (CR 603.2c, 120.2; Malcolm, Keen-Eyed Navigator): "one or more Pirates you control deal damage to your opponents": ONE trigger for all the damage they deal at once to
    // the controller's opponents (the plural subject "one or more" and the plural recipient together; an opponent's own damage to its opponents is never read here)
    const toOpps = to >= 0 ? phraseAt(ctx, to, W_YOUR_OPPONENTS) : -1;
    if (toOpps >= 0) out.push({ end: toOpps, whole: true, make: (s) => { const b = s.batch ? base(s) : null; return b === null ? null : ({ ...b, recipient: { player: 'opponent' } } as EventPattern); } });
    // edh-players-18 (CR 603.2c, 510.2; Hordewing Skaab): "... deal combat damage to one or more of your opponents": the same batch event as "to your opponents" (family to-one-or-more-of-your-opponents)
    const toSome = to >= 0 ? phraseAt(ctx, to, W_ONE_OR_MORE_OF_YOUR_OPPONENTS) : -1;
    if (toSome >= 0) out.push({ end: toSome, whole: true, make: (s) => { const b = s.batch ? base(s) : null; return b === null ? null : ({ ...b, recipient: { player: 'opponent' } } as EventPattern); } });
    // edh-next-51 (CR 603.2c, 510.2, 120.2; Briarbridge Patrol): "Whenever this creature deals damage to one or more creatures": the single source's damage to creatures at once is ONE occurrence
    // (the batch of creatures dealt damage together, however many of them), never one for each creature; a plural subject keeps its own readings above
    // edh-d-93 (CR 120.1, 603.2c; The Red Terror): "Whenever a red source you control deals damage to one or more permanents and/or players": damage is only ever dealt to permanents and players
    // (CR 120.1), so this is the source's damage with no recipient named, which is already one occurrence for each source of one instruction's (or combat's) damage (triggers/occurrences.ts);
    // a singular subject and plain damage only
    const toAnything = to >= 0 && combat === undefined ? phraseAt(ctx, to, W_ONE_OR_MORE_PERMANENTS_AND_OR_PLAYERS) : -1;
    if (toAnything >= 0) out.push({ end: toAnything, make: (s) => (s.batch ? null : base(s)) });
    const toCreatures = to >= 0 ? phraseAt(ctx, to, W_ONE_OR_MORE_CREATURES) : -1;
    if (toCreatures >= 0) out.push({ end: toCreatures, whole: true, batch: true, make: (s) => { const b = s.batch ? null : base(s); return b === null ? null : ({ ...b, recipient: { object: { types: ['Creature'] } } } as EventPattern); } });
    // std-rx28 (CR 115.9b, 120.1; Imodane, the Pyrohammer): "a spell that targets only a single creature deals damage to that creature": the damage dealt to the
    // object the subject itself targets (its one target, of the description the subject names); only a subject that targets only a single described object
    const tc = to >= 0 ? phraseAt(ctx, to, W_THAT_CREATURE) : -1;
    if (tc >= 0) out.push({ end: tc, make: (s) => {
      const b = base(s);
      const only = s.obj?.targetsOnly as { ref?: string; filter?: ObjectFilter } | undefined;
      if (b === null || only?.ref !== 'each' || only.filter === undefined || !(only.filter.types ?? []).includes('Creature')) return null;
      return { ...b, recipient: { object: only.filter }, toSourceTarget: true } as EventPattern;
    } });
  }
  // damage dealt to the subject
  // edh-b-10 (CR 120.2b; Smaug the Impenetrable): "is dealt noncombat damage" is damage that is not combat damage (`combat: false`)
  for (const [w, combat] of [[P('is dealt combat damage'), true], [P('are dealt combat damage'), true], [P('is dealt noncombat damage'), 'non'], [P('are dealt noncombat damage'), 'non'], [P('is dealt damage'), false], [P('are dealt damage'), false]] as const) {
    const e = phraseAt(ctx, pos, w);
    if (e < 0) continue;
    const base = (s: Subj): EventPattern => ({ ev: 'damage', recipient: { object: sf(s) }, ...(combat === 'non' ? { combat: false } : combat ? { combat: true } : {}) });
    out.push({ end: e, make: base });
    const by = phraseAt(ctx, e, P('by'));
    const t = by >= 0 ? ctx.toks[by]?.norm : undefined;
    if (t === 'a' || t === 'an') for (const n of npAlts(ctx, by + 1)) if (n.number === 'singular') out.push({ end: n.end, make: (s) => ({ ...base(s), source: n.filter } as EventPattern) });
  }

  // std-mkm (CR 120.2, 603.2c): "whenever ~ is dealt 3 or more damage": at least N damage dealt to the subject at once (the occurrence's total, however many
  // sources dealt it: triggers/occurrences.ts#byOccurrenceAmount); only "N or more" of a number, with no source named
  for (const w of [P('is dealt'), P('are dealt')]) {
    const e = phraseAt(ctx, pos, w);
    if (e < 0) continue;
    for (const c of cmpAt(ctx, e)) {
      if (c.cmp.op !== '>=' || typeof c.cmp.value !== 'number') continue;
      const d = phraseAt(ctx, c.end, P('damage'));
      if (d >= 0) out.push({ end: d, make: (s) => ({ ev: 'damage', recipient: { object: sf(s) }, amount: c.cmp as NumberCmp }) });
    }
  }
  // Standard round 3, r3-trig (CR 120.2, 510.2, 603.2c): "whenever ~ deals 4 or more damage": at least N damage the subject dealt at once, to whatever it was
  // dealt to (the occurrence's total: triggers/occurrences.ts groups a one-sided damage pattern by its source, as the "is dealt" form above by its recipient);
  // only "N or more" of a number, with no recipient named, and not for a bare "permanent" (see the damage forms above, CR 109.2)
  for (const w of [P('deals'), P('deal')]) {
    const e = phraseAt(ctx, pos, w);
    if (e < 0) continue;
    for (const c of cmpAt(ctx, e)) {
      if (c.cmp.op !== '>=' || typeof c.cmp.value !== 'number') continue;
      const d = phraseAt(ctx, c.end, P('damage'));
      if (d >= 0) out.push({ end: d, make: (s) => (s.obj === undefined || s.head === 'permanent' ? null : { ev: 'damage', source: sf(s), amount: c.cmp as NumberCmp }) });
      // pc-players-3 (CR 120.2, 510.2, 603.2c; Dragonborn Champion): "whenever a source you control deals 5 or more damage to a player": the damage the subject dealt at once to that recipient
      const to = d >= 0 ? phraseAt(ctx, d, P('to')) : -1;
      if (to >= 0) for (const r of damageRecipients(ctx, to)) out.push({ end: r.end, make: (s) => (s.obj === undefined || s.head === 'permanent' ? null : { ev: 'damage', source: sf(s), recipient: r.recipient, amount: c.cmp as NumberCmp } as EventPattern) });
    }
  }
  // edh-replace-7 (CR 120.2, 603.2, 603.2c; Ghyrson Starn, Kelermorph, ruling 2022-10-07): "whenever another source you control deals exactly 1 damage to a permanent or player": the amount of ONE
  // damage event of the source to the recipient it names (a pattern that names both sides is one occurrence per event, triggers/occurrences.ts), never an "or more"
  for (const w of [P('deals exactly'), P('deal exactly')]) {
    const e = phraseAt(ctx, pos, w);
    if (e < 0) continue;
    for (const q of ctx.call('Qty', e)) {
      if (typeof q.value !== 'number') continue;
      const d = phraseAt(ctx, q.end, P('damage'));
      const to = d >= 0 ? phraseAt(ctx, d, P('to')) : -1;
      if (to >= 0) for (const r of damageRecipients(ctx, to)) out.push({ end: r.end, make: (s) => (s.obj === undefined || s.head === 'permanent' || s.batch ? null : { ev: 'damage', source: sf(s), recipient: r.recipient, amount: { op: '==', value: q.value as number } } as EventPattern) });
    }
  }

  // FAST1 T4, CR 106.12, 605.1b: "enchanted land is tapped for mana" is activating a mana ability of it (landTappedForMana)
  at(P('is tapped for mana'), (s) => (landTappedForMana(sf(s)) ? { ev: 'activate', source: sf(s), manaAbility: true } : null));
  // becomes ...
  for (const [w, what] of [[P('becomes tapped'), 'tapped'], [P('become tapped'), 'tapped'], [P('becomes untapped'), 'untapped'], [P('become untapped'), 'untapped'],
    [P('is turned face up'), 'turnedFaceUp'], [P('transforms'), 'transformed'], [P('transform'), 'transformed'], [P('becomes monstrous'), 'monstrous'],
    [P('becomes renowned'), 'renowned'], [P('phases out'), 'phasedOut'], [P('phase out'), 'phasedOut'], [P('phases in'), 'phasedIn'], [P('phase in'), 'phasedIn'], // edh-d-39 (CR 702.26b-c)
     [P('becomes saddled'), 'saddled'], [P('becomes crewed'), 'crewed']] as const) {
    at(w, (s) => ({ ev: 'becomes', what, object: sf(s) }));
  }
  // edh-next-76 (CR 701.27e, 603.2; Norn's Inquisitor, Cult of the Waxing Moon): "whenever a permanent you control transforms into a Phyrexian / a non-Human creature": the
  // permanent, after it transformed, is described by the noun phrase after "into" (the face it transformed into is the one showing). Only a single object.
  for (const w of [P('transforms into')]) {
    const e = phraseAt(ctx, pos, w);
    const t = e >= 0 ? ctx.toks[e]?.norm : undefined;
    if (t === 'a' || t === 'an') for (const n of npAlts(ctx, e + 1)) if (n.number === 'singular') out.push({ end: n.end, make: (s) => (s.batch ? null : { ev: 'becomes', what: 'transformed', object: sf(s), into: n.filter }) });
  }
  // edh-players-20 (CR 508.1f, 603.4; Verity Circle): "becomes tapped, if it isn't being declared as an attacker": a tap that is not the declaration's own (said as the event's own words, so the condition
  // is part of the event: it is judged as the event happens)
  // edh-d-71 (CR 502.3, 603.2; The Ninth Doctor): "whenever ~ becomes untapped during your untap step": the object itself, untapped by the untap step's turn-based action (r5-trig's `untapStep`)
  // of its controller (only the turn player's permanents untap in an untap step; a described permanent other than the object itself is not read)
  at(P('becomes untapped during your untap step'), (s) => (s.batch || s.obj?.self !== true ? null : { ev: 'becomes', what: 'untapped', object: sf(s), untapStep: true }));
  at(P("becomes tapped , if it isn't being declared as an attacker"), (s) => (s.batch ? null : { ev: 'becomes', what: 'tapped', object: sf(s), notAsAttacker: true }));
  // std-rx31 (CR 701.3a, 603.2): "whenever this Equipment becomes attached to a creature": the object itself attached to a permanent of that description (`by`; the
  // event's `object` role is that permanent, triggers/normalize.ts)
  for (const w of [P('becomes attached to'), P('become attached to')]) {
    const e = phraseAt(ctx, pos, w);
    const t = e >= 0 ? ctx.toks[e]?.norm : undefined;
    if (t === 'a' || t === 'an') for (const n of npAlts(ctx, e + 1)) if (n.number === 'singular') out.push({ end: n.end, make: (s) => ({ ev: 'becomes', what: 'attached', object: sf(s), by: n.filter }) });
  }
  // edh-perms-10 (CR 701.3d, 603.10c; Grafted Exoskeleton): "whenever this Equipment becomes unattached from a permanent": the object itself left a permanent of that description (`by`;
  // the event's `object` role is that permanent, as it was when it left, triggers/normalize.ts)
  for (const w of [P('becomes unattached from'), P('become unattached from')]) {
    const e = phraseAt(ctx, pos, w);
    const t = e >= 0 ? ctx.toks[e]?.norm : undefined;
    if (t === 'a' || t === 'an') for (const n of npAlts(ctx, e + 1)) if (n.number === 'singular') out.push({ end: n.end, make: (s) => ({ ev: 'becomes', what: 'unattached', object: sf(s), by: n.filter }) });
  }
  // Standard round 5, r5-trig (CR 702.122b, 702.171c; Canyon Vaulter): "~ saddles a Mount", "~ crews a Vehicle": the creature is tapped to pay that permanent's saddle
  // / crew cost (`by`), the Mount or Vehicle is the event's object ("that Mount or Vehicle")
  at(P('crews a vehicle'), (s) => (s.batch ? null : { ev: 'becomes', what: 'crewCostPaid', object: { subtypes: ['Vehicle'] }, by: sf(s) }));
  at(P('saddles a mount'), (s) => (s.batch ? null : { ev: 'becomes', what: 'saddleCostPaid', object: { subtypes: ['Mount'] }, by: sf(s) }));
  // std-rq (CR 702.194a; Agent Maria Hill): "~ becomes tapped to pay a teamwork cost": the creature (`by`) tapped as a spell with teamwork (the event's object) is cast
  at(P('becomes tapped to pay a teamwork cost'), (s) => (s.batch ? null : { ev: 'becomes', what: 'teamworkCostPaid', object: {}, by: sf(s) }));
  for (const w of [P('becomes the target of'), P('become the target of')]) {
    const e = phraseAt(ctx, pos, w);
    if (e < 0) continue;
    for (const by of stackSources(ctx, e)) out.push({ end: by.end, make: (s) => ({ ev: 'becomes', what: 'targeted', object: sf(s), ...(by.filter ? { by: by.filter } : {}) }) });
  }
  return out;
}

/** "a spell or ability", "a spell", "an ability", "a spell or ability an opponent controls": the source in "becomes the target of ...". */
function stackSources(ctx: HoleCtx, pos: number): { end: number; filter?: ObjectFilter }[] {
  const out: { end: number; filter?: ObjectFilter }[] = [];
  const t = ctx.toks[pos]?.norm;
  if (t !== 'a' && t !== 'an') return out;
  for (const n of npAlts(ctx, pos + 1)) {
    if (n.number !== 'singular') continue;
    if (n.head !== 'spell' && n.head !== 'ability' && n.head !== 'stackObject') continue;
    const f: ObjectFilter = { ...n.filter };
    delete f.zone;
    if (n.head === 'stackObject') { out.push({ end: n.end, ...(Object.keys(f).length > 0 ? { filter: f } : {}) }); continue; }
    out.push({ end: n.end, filter: f });
  }
  return out;
}

/** "a player", "an opponent", "you", "a creature", "a player or planeswalker": the recipient of damage in an event. */
function damageRecipients(ctx: HoleCtx, pos: number): { end: number; recipient: { object?: ObjectFilter; player?: PlayerPred } }[] {
  const out: { end: number; recipient: { object?: ObjectFilter; player?: PlayerPred } }[] = [];
  // M12-3: "one of your opponents" (Edric, Spymaster of Trest) is an opponent of the ability's controller
  const players: [string[], PlayerPred][] = [[P('a player'), 'any'], [P('an opponent'), 'opponent'], [P('you'), 'you'], [P('each opponent'), 'opponent'], [P('one of your opponents'), 'opponent'], [P('another player'), 'opponent']]; // edh-c-25: a player other than you, an opponent when there are no teams (CR 102.3)
  for (const [ws, pred] of players) {
    const e = phraseAt(ctx, pos, ws);
    if (e < 0) continue;
    out.push({ end: e, recipient: { player: pred } });
    const or = phraseAt(ctx, e, P('or'));
    const a = or >= 0 ? ctx.toks[or]?.norm : undefined;
    if (or >= 0) {
      for (const n of npAlts(ctx, a === 'a' || a === 'an' ? or + 1 : or)) if (n.number === 'singular') out.push({ end: n.end, recipient: { player: pred, object: n.filter } });
    }
  }
  // std-rx13 (CR 603.7c, 608.2c; Great Train Heist): "that player", "that opponent": one player an earlier part of the ability names ("Choose target opponent.
  // Whenever a creature you control deals combat damage to that player this turn, ..."), resolved as any other player anaphor (lower/anaphora.ts) and fixed as a
  // delayed trigger is created (effects/handlers/lasting.ts#delay); with no unique antecedent the sentence stays manual
  for (const [ws, head] of [[W_THAT_PLAYER, 'player'], [W_THAT_OPPONENT, 'opponent']] as const) {
    const e = phraseAt(ctx, pos, ws);
    if (e >= 0) out.push({ end: e, recipient: { player: anaphorObj({ sort: 'player', number: 'singular', head, text: ws.join(' ') }) as unknown as PlayerRef } });
  }
  const t = ctx.toks[pos]?.norm;
  if (t === 'a' || t === 'an') for (const n of npAlts(ctx, pos + 1)) if (n.number === 'singular') {
    out.push({ end: n.end, recipient: { object: n.filter } });
    // edh-replace-7 (CR 120.1, 120.3; Ghyrson Starn, Kelermorph): "a permanent or player" (the object first, then any player): the damage dealt to either (triggers/match.ts reads the recipient
    // with both parts as the object when an object was dealt the damage, the player otherwise)
    const orPlayer = phraseAt(ctx, n.end, W_OR_PLAYER);
    if (orPlayer >= 0) out.push({ end: orPlayer, recipient: { object: n.filter, player: 'any' } });
    // edh-next-15 (CR 120.1, 120.3; Flesh Reaver): "a creature or opponent" (the object first, then any opponent of the ability's controller), read the same way
    const orOpponent = phraseAt(ctx, n.end, W_OR_OPPONENT);
    if (orOpponent >= 0) out.push({ end: orOpponent, recipient: { object: n.filter, player: 'opponent' } });
  }
  // edh-next-23 (CR 303.4, 120.1, 603.2; Curse of Hospitality, Liliana's Talent): damage dealt to the player or the object the source Aura is attached to
  if (phraseAt(ctx, pos, P('enchanted player')) >= 0) out.push({ end: phraseAt(ctx, pos, P('enchanted player')), recipient: { player: { ref: 'enchantedPlayer' } } });
  // edh-next-146 (CR 601.2a, 611.2c; Hellish Rebuke): "the player who cast ¤" in an ability a spell's resolved effect grants (parser/holes/player.ts; fixed as the effect is created)
  const whoCast = phraseAt(ctx, pos, P('the player who cast'));
  if (whoCast >= 0 && ctx.toks[whoCast]?.kind === 'GRANTOR') out.push({ end: whoCast + 1, recipient: { player: { ref: 'grantCaster' } } });
  for (const [w, type] of [[P('enchanted creature'), 'Creature'], [P('enchanted planeswalker'), 'Planeswalker']] as const) {
    const e = phraseAt(ctx, pos, w);
    if (e >= 0) out.push({ end: e, recipient: { object: { types: [type], attachedToSource: true } } });
  }
  if (ctx.toks[pos]?.kind === 'SELF') out.push({ end: pos + 1, recipient: { object: { self: true } } });
  return out;
}
const W_THAT_PLAYER = P('that player');
const W_OR_PLAYER = P('or player'); // edh-replace-7
const W_OR_OPPONENT = P('or opponent'); // edh-next-15
const W_THAT_OPPONENT = P('that opponent');
const W_ONE_OR_MORE_PLAYERS = P('one or more players'); // edh-replace-3
const W_ONE_OR_MORE_CREATURES = P('one or more creatures'); // edh-next-51
const W_ONE_OR_MORE_PERMANENTS_AND_OR_PLAYERS = P('one or more permanents and/or players'); // edh-d-93
const W_YOUR_OPPONENTS = P('your opponents'); // edh-replace-5
const W_ONE_OR_MORE_OF_YOUR_OPPONENTS = P('one or more of your opponents'); // edh-players-18

/**
 * FAST5 T45 (hole `CastSpell`): the noun phrase of a spell that is cast, as the `spell` filter of a `cast` event pattern, with no article (the template spells
 * out "a" / "an" / "other"). The zone and stack kind of the noun phrase are dropped as the Event hole drops them (CR 601.2a, 305.1: the zone of a cast is the `from`
 * field only). A spell "of the chosen color" is not read (its link is the business of the trigger templates that name it, zz-fast4/t23.json; guard G5).
 */
export const castSpell: HoleFn = (ctx, pos) => {
  const out: Alt[] = [];
  for (const n of npAlts(ctx, pos)) {
    if (n.number !== 'singular' || n.head !== 'spell' || n.filter.zone !== 'stack' || n.filter.chosen?.link === '$link') continue;
    const f: ObjectFilter = { ...n.filter };
    delete f.zone; delete f.stackKind;
    out.push({ end: n.end, value: f });
  }
  return out;
};

/** The anaphor "their" (the casting player). */
const isTheirAnaphor = (p: PlayerPred): boolean => typeof p === 'object' && (p as { $anaphor?: { text?: string } }).$anaphor?.text === 'their';

interface PPred { end: number; make: (p: PlayerPred) => EventPattern | null; batch?: boolean }

const W_USING_MANA_PRODUCED_BY = P('using mana produced by'); // std-lci

const ORDINALS: Record<string, number> = { first: 1, second: 2, third: 3, fourth: 4, fifth: 5, sixth: 6, seventh: 7, eighth: 8, ninth: 9, tenth: 10, eleventh: 11, twelfth: 12 }; // std-control-3: sixth..twelfth ("the seventh plan counter", CR 122.1, 603.2)
for (const w of Object.keys(ORDINALS)) P(w);

function playerPredicates(ctx: HoleCtx, pos: number): PPred[] {
  const out: PPred[] = [];
  const at = (words: readonly string[], make: PPred['make'], batch?: boolean): void => { const e = phraseAt(ctx, pos, words); if (e >= 0) out.push({ end: e, make, ...(batch ? { batch } : {}) }); };
  // Standard round 4, r4-trig (CR 120.2, 510.2, 603.2c; Contested Game Ball): "a player is dealt [combat] damage", "an opponent is dealt damage": damage dealt to that
  // player; one occurrence for all the damage the player is dealt at once (triggers/occurrences.ts groups a recipient-only pattern by its recipient). "You" takes
  // "you're" / "you are" (the event hole below)
  // Standard round 4, r4-trig (CR 719.3b-c; Case File Auditor): "you solve a Case": a Case you control becomes solved (only its controller solves a Case)
  // Standard round 5, r5-trig (CR 502.3, 603.2c; The Millennium Calendar): "you untap one or more permanents during your untap step": the untap step's untaps of your
  // permanents, one batch ("that many" is how many untapped)
  const unt = phraseAt(ctx, pos, P('untap one or more permanents during your untap step'));
  if (unt >= 0) out.push({ end: unt, make: (pl) => (pl === 'you' ? { ev: 'becomes', what: 'untapped', object: { controller: 'you' }, untapStep: true } : null), batch: true });
  at(P('solve a case'), (pl) => (pl === 'you' ? { ev: 'becomes', what: 'solved', object: { subtypes: ['Case'], controller: 'you' } } : null));
  for (const [w, combat] of [[P('is dealt combat damage'), true], [P('is dealt damage'), false]] as const) at(w, (pl) => (pl === 'you' ? null : { ev: 'damage', recipient: { player: pl }, ...(combat ? { combat: true } : {}) }));
  // edh-c-48 (CR 120.2, 510.2, 603.2; Chandra's Phoenix): "an opponent is dealt damage by a red instant or sorcery spell you control [or by a red planeswalker you control]": damage from a source
  // of the description (or of either description) to that player, one occurrence for each damaged player's damage by one source
  const dealtBy = phraseAt(ctx, pos, P('is dealt damage by'));
  const article = (p: number): boolean => ctx.toks[p]?.norm === 'a' || ctx.toks[p]?.norm === 'an';
  if (dealtBy >= 0 && article(dealtBy)) {
    for (const n of npAlts(ctx, dealtBy + 1)) {
      if (n.number !== 'singular') continue;
      out.push({ end: n.end, make: (pl) => (pl === 'you' ? null : { ev: 'damage', source: n.filter, recipient: { player: pl } }) });
      const or = phraseAt(ctx, n.end, P('or by'));
      if (or < 0 || !article(or)) continue;
      for (const m of npAlts(ctx, or + 1)) if (m.number === 'singular') out.push({ end: m.end, make: (pl) => (pl === 'you' ? null : { ev: 'damage', source: { anyOf: [n.filter, m.filter] }, recipient: { player: pl } }) });
    }
  }
  // edh-d-12 (CR 120.2, 510.2, 603.2c; Pain Magnification): "an opponent is dealt 3 or more damage by a single source": at least N damage from ONE source to that player at once. A pattern
  // that names both sides (any source, the player) keeps one occurrence for each source and recipient pair (triggers/occurrences.ts), so the amounts of different sources are never added
  const dealtN = phraseAt(ctx, pos, P('is dealt'));
  if (dealtN >= 0) {
    for (const c of cmpAt(ctx, dealtN)) {
      if (c.cmp.op !== '>=' || typeof c.cmp.value !== 'number') continue;
      const d = phraseAt(ctx, c.end, P('damage by a single source'));
      if (d >= 0) out.push({ end: d, make: (pl) => (pl === 'you' ? null : { ev: 'damage', source: {}, recipient: { player: pl }, amount: c.cmp as NumberCmp }) });
    }
  }
  // edh-players-19 (CR 120.2, 510.2, 603.2c; Lolth, Spider Queen's emblem): "an opponent is dealt combat damage by one or more creatures you control": the combat damage those creatures deal to
  // that player at once, ONE occurrence for each damaged player (triggers/occurrences.ts, as "one or more creatures you control deal combat damage to a player")
  at(P('is dealt combat damage by one or more creatures you control'), (pl) => (pl === 'you' ? null : { ev: 'damage', combat: true, source: { types: ['Creature'], controller: 'you' }, recipient: { player: pl } }), true);
  // edh-players-8 (CR 121.2, 603.2; Trouble in Pairs): "draws their second card each turn" of another player (an opponent, a player): that player's nth draw of the turn (the
  // trigger templates trg.opponent.drawNth / trg.player.drawNth read the same words for one opponent / any player alone)
  for (const [word, n] of Object.entries(ORDINALS)) at(P(`draws their ${word} card each turn`), (pl) => (pl === 'you' ? null : { ev: 'draw', player: pl, nth: n }));
  // cast
  for (const w of [P('cast or copy'), P('casts or copies'), P('cast'), P('casts'), P('copy'), P('copies')]) {
    const e = phraseAt(ctx, pos, w);
    if (e < 0) continue;
    // edh-b-13 (CR 707.10, 603.2; Kalamax, the Stormsire): "you copy an instant spell": only the copy made of a spell (a copy is not cast, so it has no `cast` of its own), never the cast itself
    const copyOnly = w.length === 1 && (w[0] === 'copy' || w[0] === 'copies');
    const orCopy = !copyOnly && (w.includes('copy') || w.includes('copies'));
    if (copyOnly && !(ctx.toks[e]?.norm === 'a' || ctx.toks[e]?.norm === 'an')) continue;
    if (ctx.toks[e]?.kind === 'SELF') out.push({ end: e + 1, make: (pl) => ({ ev: 'cast', player: pl, spell: { self: true }, ...(orCopy ? { orCopy: true } : {}) }) });
    // CMDF (CR 903.3d: "casting a commander" is a spell that is a commander; 903.3e, 702.124e: "your commander" is a commander you own, either one with
    // two): "when you cast your commander" (Skyfire Phoenix), from any zone. Only the caster "you" ("your" is the caster's own commander).
    if (!orCopy) for (const n of yourCommanderAt(ctx, e)) if (n.number === 'singular') out.push({ end: n.end, make: (pl) => (pl === 'you' ? { ev: 'cast', player: pl, spell: n.filter } : null) });
    const t = ctx.toks[e]?.norm;
    // M11-4 (Edgar Markov's eminence): "you cast another Vampire spell": a spell that is not the ability's source (rules/filter.ts `other`, CR 109.1)
    if (t === 'a' || t === 'an' || t === 'another') for (const n0 of npAlts(ctx, e + 1)) {
      if (t === 'another' && n0.filter.other !== undefined) continue;
      const n = t === 'another' ? { ...n0, filter: { ...n0.filter, other: true } } : n0;
      // the zone of a cast is the `from` field only; a noun phrase that absorbed "from <zone>" would be a second, wrong reading (CR 601.2a, 305.1)
      if (n.number !== 'singular' || n.head !== 'spell' || n.filter.zone !== 'stack') continue;
      // FAST4 T23: "you cast a spell of the chosen color" is read by the trigger template that names the link (zz-fast4/t23.json), its one reading (guard G5).
      // CLOUD C5 (CR 607.2d): any other spell of the chosen color or type ("a player casts a spell of the chosen color", "you cast a creature spell of the chosen
      // type") keeps the placeholder, which parser/lower/ability.ts#triggered resolves against the face's "As ~ enters, choose ..." (or drops the reading)
      const t23 = n.filter.chosen?.link === '$link' && n.filter.chosen.quality === 'color' && Object.keys(n.filter).every((k) => k === 'chosen' || k === 'zone' || k === 'stackKind');
      const f: ObjectFilter = { ...n.filter };
      // CLOUD C5: a spell of the chosen color keeps "spell" as design 13 writes Paradise Plume's trigger (docs/design/m5-ability-model.md, golden G10)
      delete f.zone; if (n.filter.chosen?.link !== '$link') delete f.stackKind;
      const mk = (from?: ZoneValue) => (pl: PlayerPred): EventPattern | null => {
        if (t23 && pl === 'you' && from === undefined && !orCopy) return null;
        // `from` has no owner: it can only say the zone of the caster ("your hand", "their graveyard", or no owner stated)
        if (from?.owner !== undefined && !(from.owner === 'you' ? pl === 'you' : isTheirAnaphor(from.owner))) return null;
        // Standard round P (CR 400.3, 601.2a): "from your graveyard" / "from your library" of your own cast is a card you own (a graveyard or library is its owner's)
        const own = from?.owner === 'you' && pl === 'you' && (from.zone === 'graveyard' || from.zone === 'library');
        const sf: ObjectFilter = own ? { ...f, owner: 'you' } : f;
        return { ev: 'cast', player: pl, ...(Object.keys(sf).length > 0 ? { spell: sf } : {}), ...(from ? { from: from.zone } : {}), ...(orCopy ? { orCopy: true } : {}), ...(copyOnly ? { copyOnly: true } : {}) };
      };
      out.push({ end: n.end, make: mk() });
      // edh-next-107 (CR 601.2i, 500.1; Curse of Shaken Faith): "enchanted player casts a spell other than the first spell they cast each turn": not that player's first spell of the turn
      // (`nthMin` 2, the cast event's count of the caster's spells this turn); a plain "spell" of a player other than "you" only (a typed or located spell has no such wording)
      const nf = !orCopy && !copyOnly ? phraseAt(ctx, n.end, P('other than the first spell they cast each turn')) : -1;
      if (nf >= 0) out.push({ end: nf, make: (pl) => { const ev = pl === 'you' ? null : mk()(pl); return ev === null || ev.ev !== 'cast' || Object.keys(ev).length !== 2 ? null : { ...ev, nthMin: 2 }; } });
      // std-lci (CR 106.3): "a permanent spell using mana produced by ~" (Thousand Moons Smithy // Barracks of the Thousand): some of the mana spent to cast it
      // came from the object itself
      const um = phraseAt(ctx, n.end, W_USING_MANA_PRODUCED_BY);
      if (um >= 0 && ctx.toks[um]?.kind === 'SELF') out.push({ end: um + 1, make: (pl) => { const ev = mk()(pl); return ev === null ? null : { ...ev, manaFromSelf: true }; } });
      // FAST5 T45 (CR 601.2a): "a spell from anywhere other than your hand": a spell that was not cast from the caster's hand (`castFrom` of the spell filter, negated)
      const nh = phraseAt(ctx, n.end, P('from anywhere other than your hand'));
      if (nh >= 0) out.push({ end: nh, make: (pl) => (pl === 'you' ? { ev: 'cast', player: pl, spell: { ...f, not: { castFrom: 'hand' } }, ...(orCopy ? { orCopy: true } : {}) } : null) });
      // std-rm (CR 601.2a, 601.3): "an opponent casts a spell from anywhere other than their hand", "another player casts ...": the caster's own hand, said with
      // "their" for a player other than you (a player casts a spell from a hand only from their own)
      const nt = phraseAt(ctx, n.end, P('from anywhere other than their hand'));
      if (nt >= 0) out.push({ end: nt, make: (pl) => (typeof pl === 'string' && pl !== 'you' ? { ev: 'cast', player: pl, spell: { ...f, not: { castFrom: 'hand' } }, ...(orCopy ? { orCopy: true } : {}) } : null) });
      const fr = phraseAt(ctx, n.end, P('from'));
      if (fr >= 0) for (const z of ctx.call('Zone', fr)) out.push({ end: z.end, make: mk(z.value as ZoneValue) });
    }
  }
  // edh-c-91 (CR 702.33d, 601.2; Saproling Infestation): "a player kicks a spell" is the cast of a kicked spell (the kicker is paid as the spell is cast)
  for (const w of [P('kick'), P('kicks')]) {
    const e = phraseAt(ctx, pos, w);
    const sp = e >= 0 ? phraseAt(ctx, e, P('a spell')) : -1;
    if (sp >= 0) out.push({ end: sp, make: (pl) => ({ ev: 'cast', player: pl, spell: { kicked: true } }) });
  }
  // FAST1 T4, CR 106.12, 605.1b: "a player taps a land for mana" (landTappedForMana)
  for (const w of [P('tap'), P('taps')]) {
    const e = phraseAt(ctx, pos, w);
    // edh-perms-1 (port of the stopped p2-mana-3; CR 106.12, 603.2): "whenever you tap ~ for mana" (Forbidden Orchard): an activation of a mana ability of this permanent
    // with {T} in its cost
    const sm = e >= 0 && ctx.toks[e]?.kind === 'SELF' ? phraseAt(ctx, e + 1, P('for mana')) : -1;
    if (sm >= 0) out.push({ end: sm, make: (pl) => ({ ev: 'activate', player: pl, source: { self: true }, manaAbility: true, tapped: true }) });
    const t = e >= 0 ? ctx.toks[e]?.norm : undefined;
    if (t !== 'a' && t !== 'an') continue;
    for (const n of npAlts(ctx, e + 1)) {
      if (n.number !== 'singular') continue;
      // std-mana-1 (CR 106.12): "you tap a land for {C}": the activation of a land's mana ability produced mana of that one type
      const fo = landTappedForMana(n.filter) ? phraseAt(ctx, n.end, P('for')) : -1;
      if (fo >= 0) for (const t of ctx.call('ManaSym', fo)) out.push({ end: t.end, make: (pl) => ({ ev: 'activate', player: pl, source: n.filter, manaAbility: true, produced: t.value as ManaType }) });
      // edh-perms-1 (CR 106.12, 605.1b; Forsaken Monument): "you tap a permanent for {C}": a permanent that is not (only) a land may have mana abilities without {T}, so the
      // pattern asks for the {T} the activation had (`tapped`), as "taps a permanent for mana" below
      const fp = !landTappedForMana(n.filter) && n.filter.self !== true && n.filter.zone === undefined ? phraseAt(ctx, n.end, P('for')) : -1;
      if (fp >= 0) for (const t of ctx.call('ManaSym', fp)) out.push({ end: t.end, make: (pl) => ({ ev: 'activate', player: pl, source: n.filter, manaAbility: true, tapped: true, produced: t.value as ManaType }) });
      const m = phraseAt(ctx, n.end, P('for mana'));
      if (m < 0) continue;
      if (landTappedForMana(n.filter)) out.push({ end: m, make: (pl) => ({ ev: 'activate', player: pl, source: n.filter, manaAbility: true }) });
      // std-mana-1 (CR 106.12, 605.1b): "you tap an artifact token for mana", "a player taps a permanent for mana": a permanent that is not (only) a land may have
      // mana abilities without {T}, so the pattern asks for the {T} the activation had (`tapped`, rules/mana.ts#addMana)
      else if (n.filter.self !== true && n.filter.zone === undefined) out.push({ end: m, make: (pl) => ({ ev: 'activate', player: pl, source: n.filter, manaAbility: true, tapped: true }) });
    }
  }
  // FAST1 T4 (CR 601.2i): "you cast your second spell each turn", "an opponent casts their second spell each turn" (`nth`, counted like a draw's)
  for (const [w, own] of [[P('cast your'), true], [P('casts their'), false]] as const) {
    const e = phraseAt(ctx, pos, w);
    const nth = e >= 0 ? ORDINALS[ctx.toks[e]?.norm ?? ''] : undefined;
    if (nth === undefined) continue;
    const end = anyPhraseAt(ctx, e + 1, [P('spell each turn'), P('spell in a turn')]); // edh-c-1 (CR 601.2i; Vance's Blasting Cannons): "your third spell in a turn" is the same count
    // "your" is the caster only when the caster is you; "their" only when it is another player
    if (end >= 0) out.push({ end, make: (pl) => ((pl === 'you') === own ? { ev: 'cast', player: pl, nth } : null) });
    // edh-players-1, ported from the stopped p2-trigger-events-2 (CR 601.2i; The Council of Four): "a player casts their second spell during their turn": the turn is said
    // after it ("during ..."), so the count is of that turn as with "each turn"; read only before "during" (the turn clause is the trigger's own, `while`)
    const bare = phraseAt(ctx, e + 1, P('spell'));
    if (bare >= 0 && ctx.toks[bare]?.norm === 'during') out.push({ end: bare, make: (pl) => ((pl === 'you') === own ? { ev: 'cast', player: pl, nth } : null) });
    // FAST5X E18 (CR 601.2i): "an opponent casts their first noncreature spell each turn": the Nth of that player's spells this turn that are such spells
    for (const n of npAlts(ctx, e + 1)) {
      if (n.number !== 'singular' || n.head !== 'spell' || n.filter.zone !== 'stack' || n.filter.chosen !== undefined) continue;
      const f: ObjectFilter = { ...n.filter };
      delete f.zone; delete f.stackKind;
      if (Object.keys(f).length === 0) continue; // "their second spell each turn" is the reading above
      const et = phraseAt(ctx, n.end, P('each turn'));
      if (et >= 0) out.push({ end: et, make: (pl) => ((pl === 'you') === own ? { ev: 'cast', player: pl, spell: f, nth, nthMatching: true } : null) });
    }
  }
  // draw
  for (const w of [P('draw'), P('draws')]) {
    const e = phraseAt(ctx, pos, w);
    if (e < 0) continue;
    const c = anyPhraseAt(ctx, e, [P('a card'), P('a card each turn')]);
    if (c >= 0) out.push({ end: c, make: (pl) => ({ ev: 'draw', player: pl }) });
    // edh-players-1 (CR 504.1, 121.2; Orcish Bowmasters): "an opponent draws a card except the first one they draw in each of their draw steps": every draw but the
    // first card the turn player draws in their own draw step (the replacement form of the same words is r5-repl's); the pronoun is the drawing player's own
    for (const [tail, own] of [[P('a card except the first one you draw in each of your draw steps'), true], [P('a card except the first one they draw in each of their draw steps'), false]] as const) {
      const ex = phraseAt(ctx, e, tail);
      if (ex >= 0) out.push({ end: ex, make: (pl) => ((pl === 'you') === own ? { ev: 'draw', player: pl, exceptFirstInDrawStep: true } : null) });
    }
    const poss = phraseAt(ctx, e, P('your'));
    const ord = poss >= 0 ? ORDINALS[ctx.toks[poss]?.norm ?? ''] : undefined;
    if (ord !== undefined) { const ce = anyPhraseAt(ctx, poss + 1, [P('card each turn'), P('card in a turn')]); /* edh-d-14 (CR 121.2; Sneaky Snacker): "your third card in a turn" counts like "each turn" */ if (ce >= 0) out.push({ end: ce, make: (pl) => ({ ev: 'draw', player: pl, nth: ord }) }); }
    // edh-players-1, ported from the stopped p2-trigger-events-2 (CR 121.2; The Council of Four): "a player draws their second card during their turn" (another player's own
    // draws; read only before "during", which says the turn as "each turn" does)
    const their = phraseAt(ctx, e, P('their'));
    const ordT = their >= 0 ? ORDINALS[ctx.toks[their]?.norm ?? ''] : undefined;
    const ct = ordT !== undefined ? phraseAt(ctx, their + 1, P('card')) : -1;
    if (ordT !== undefined && ct >= 0 && ctx.toks[ct]?.norm === 'during') out.push({ end: ct, make: (pl) => (pl === 'you' ? null : { ev: 'draw', player: pl, nth: ordT }) });
  }
  // life
  for (const w of [P('gain life'), P('gains life')]) at(w, (pl) => ({ ev: 'life', change: 'gain', player: pl }));
  for (const w of [P('lose life'), P('loses life')]) at(w, (pl) => ({ ev: 'life', change: 'loss', player: pl }));
  // edh-d-73 (CR 702.143a, 116.2h, 603.2; Dream Devourer): "Whenever you foretell a card": the player who exiled a card from their hand face down with the foretell special action
  for (const w of [P('foretell a card'), P('foretells a card')]) {
    const e = phraseAt(ctx, pos, w);
    if (e >= 0) out.push({ end: e, make: (pl) => ({ ev: 'action', verb: 'foretell', actor: pl }) });
  }
  // actions on an object: sacrifice, discard, cycle
  for (const [ws, verb] of [[P('sacrifice'), 'sacrifice'], [P('sacrifices'), 'sacrifice'], [P('discard'), 'discard'], [P('discards'), 'discard'], [P('cycle'), 'cycle'], [P('cycles'), 'cycle'], [P('exert'), 'exert'], [P('exerts'), 'exert']] as const) { // std-ry8: "whenever you exert a creature" (CR 701.43a)
    const e = phraseAt(ctx, pos, ws);
    if (e < 0) continue;
    if (ctx.toks[e]?.kind === 'SELF') out.push({ end: e + 1, make: (pl) => ({ ev: 'action', verb, actor: pl, object: { self: true } }) });
    const t = ctx.toks[e]?.norm;
    if (t === 'a' || t === 'an') for (const n of npAlts(ctx, e + 1)) if (n.number === 'singular') out.push({ end: n.end, make: (pl) => ({ ev: 'action', verb, actor: pl, object: n.filter }) });
    // edh-c-87 (CR 701.9a, 603.2, 608.2b; Shipwreck Sifters): "whenever you discard a Spirit card or a card with disturb": a card of either description, each with its own article
    if ((t === 'a' || t === 'an') && verb === 'discard') {
      for (const n of npAlts(ctx, e + 1)) {
        if (n.number !== 'singular' || n.filter.isCard !== true || ctx.toks[n.end]?.norm !== 'or') continue;
        const a2 = ctx.toks[n.end + 1]?.norm;
        if (a2 !== 'a' && a2 !== 'an') continue;
        for (const m of npAlts(ctx, n.end + 2)) if (m.number === 'singular' && m.filter.isCard === true) out.push({ end: m.end, make: (pl) => ({ ev: 'action', verb, actor: pl, object: { anyOf: [n.filter, m.filter] } }) });
      }
    }
    // Standard round 4, r4-trig (CR 701.21a, 109.2; Zodiark, Umbral God): "whenever a player sacrifices another creature": a permanent other than the ability's source
    // ("you sacrifice another ..." is trg.you.sacrifice's, parser/templates/trigger.json: its one reading, so only another player here)
    if (t === 'another' && verb === 'sacrifice') for (const n of npAlts(ctx, e + 1)) if (n.number === 'singular' && n.filter.other === undefined) out.push({ end: n.end, make: (pl) => (pl === 'you' ? null : { ev: 'action', verb, actor: pl, object: { ...n.filter, other: true } }) });
    // FAST5X E28 (CR 603.2c, 701.21a): "whenever you sacrifice one or more Foods": once per player's sacrifices in one event (a batch, like the discard template)
    if (verb === 'sacrifice') {
      const one = phraseAt(ctx, e, P('one or more'));
      if (one >= 0) for (const n of npAlts(ctx, one)) if (n.number === 'plural') out.push({ end: n.end, make: (pl) => ({ ev: 'action', verb, actor: pl, object: n.filter }), batch: true });
    }
  }
  // p2-trigger-events-1 (CR 701.17a, 603.2c; Glowing One, Zellix, Sanity Flayer): "a player mills a nonland card" (each card milled), "a player mills one or more
  // creature cards" (once for each player's mill): the cards milled, judged in the graveyard they went to; only a description of cards
  for (const ws of [P('mill'), P('mills')]) {
    const e = phraseAt(ctx, pos, ws);
    if (e < 0) continue;
    const t = ctx.toks[e]?.norm;
    if (t === 'a' || t === 'an') for (const n of npAlts(ctx, e + 1)) if (n.number === 'singular' && cardSubject(n.filter)) out.push({ end: n.end, make: (pl) => ({ ev: 'action', verb: 'mill', actor: pl, object: n.filter }) });
    const one = phraseAt(ctx, e, P('one or more'));
    if (one >= 0) for (const n of npAlts(ctx, one)) if (n.number === 'plural' && cardSubject(n.filter)) out.push({ end: n.end, make: (pl) => ({ ev: 'action', verb: 'mill', actor: pl, object: n.filter }), batch: true });
  }
  // p2-trigger-events-1 (CR 305.1, 109.1; City of Traitors, Jokulmorder): "you play another land", "you play an Island", "an opponent plays a nonbasic land": the land
  // played, described (`another` is a land other than the object itself). A bare "a land" is the reading below, never a second one
  for (const ws of [P('play'), P('plays')]) {
    const e = phraseAt(ctx, pos, ws);
    if (e < 0) continue;
    const t = ctx.toks[e]?.norm;
    if (t !== 'a' && t !== 'an' && t !== 'another') continue;
    for (const n of npAlts(ctx, e + 1)) {
      if (n.number !== 'singular' || n.filter.zone !== undefined || n.filter.isCard !== undefined || n.filter.self !== undefined || n.filter.other !== undefined) continue;
      const land = (n.filter.types ?? []).includes('Land') || (n.filter.subtypes ?? []).every((x) => BASIC_LAND_TYPES.includes(x)) && (n.filter.subtypes?.length ?? 0) > 0;
      if (!land || (t !== 'another' && JSON.stringify(n.filter) === '{"types":["Land"]}')) continue;
      const object: ObjectFilter = t === 'another' ? { ...n.filter, other: true } : n.filter;
      out.push({ end: n.end, make: (pl) => ({ ev: 'action', verb: 'playLand', actor: pl, object }) });
    }
  }
  at(P('play a land'), (pl) => ({ ev: 'action', verb: 'playLand', actor: pl }));
  // Standard round 4, r4-trig (CR 701.23a; Wan Shi Tong, Librarian): "an opponent searches their library", "you search your library": a search of the player's own library
  at(P('searches their library'), (pl) => (pl === 'you' ? null : { ev: 'action', verb: 'search', actor: pl, searched: 'ownLibrary' }));
  at(P('search your library'), (pl) => (pl === 'you' ? { ev: 'action', verb: 'search', actor: pl, searched: 'ownLibrary' } : null));
  // Standard round 4, r4-trig (CR 305.1): "you play a land from anywhere other than your hand" (`notFrom`), only the player's own hand ("you")
  at(P('play a land from anywhere other than your hand'), (pl) => (pl === 'you' ? { ev: 'action', verb: 'playLand', actor: pl, notFrom: 'hand' } : null));
  at(P('plays a land'), (pl) => ({ ev: 'action', verb: 'playLand', actor: pl }));
  // cloud std-spm (CR 305.1): "you play a land from exile": the zone the land was played from (`from`); like a cast's zone, only the player's own zone (no owner
  // stated, "your graveyard", or "their graveyard" of the player who plays it)
  for (const w of [P('play a land from'), P('plays a land from')]) {
    const e = phraseAt(ctx, pos, w);
    if (e >= 0) for (const z of ctx.call('Zone', e)) {
      const from = z.value as ZoneValue;
      out.push({ end: z.end, make: (pl) => (from.owner !== undefined && !(from.owner === 'you' ? pl === 'you' : isTheirAnaphor(from.owner)) ? null : { ev: 'action', verb: 'playLand', actor: pl, from: from.zone }) });
    }
  }
  // FAST5X E28 (CR 701.61a): "whenever you forage" (as an effect, effects/handlers/forage.ts, or as a cost, rules/pay-parts.ts)
  at(P('forage'), (pl) => ({ ev: 'action', verb: 'forage', actor: pl }));
  at(P('forages'), (pl) => ({ ev: 'action', verb: 'forage', actor: pl }));
  // FAST5X E12 (CR 701.59a): "whenever you collect evidence"
  at(P('collect evidence'), (pl) => ({ ev: 'action', verb: 'collectEvidence', actor: pl }));
  at(P('collects evidence'), (pl) => ({ ev: 'action', verb: 'collectEvidence', actor: pl }));
  // FAST5X E20 (CR 700.13): "whenever you commit a crime"
  at(P('commit a crime'), (pl) => ({ ev: 'action', verb: 'commitCrime', actor: pl }));
  at(P('commits a crime'), (pl) => ({ ev: 'action', verb: 'commitCrime', actor: pl }));
  // trek-2 (CR 700.2, 601.2b, 602.2b, 603.3c; the term is new, its rule number unverified): "whenever you face a dilemma" (Seven of Nine; reminder text: "You face a
  // dilemma as you choose one or more modes for a spell or ability"): the player chose one or more modes (actions/announce.ts#chooseModes emits the action)
  at(P('face a dilemma'), (pl) => ({ ev: 'action', verb: 'faceDilemma', actor: pl }));
  at(P('faces a dilemma'), (pl) => ({ ev: 'action', verb: 'faceDilemma', actor: pl }));
  // edh-d-74 (CR 702.24a, 603.2; Hibernation's End, Thought Lash): "whenever you pay ~'s cumulative upkeep", "when a player doesn't pay ~'s cumulative upkeep": the cumulative upkeep of the permanent itself
  for (const [lead, verb] of [[P('pay'), 'payCumulativeUpkeep'], [P("don't pay"), 'failCumulativeUpkeep'], [P("doesn't pay"), 'failCumulativeUpkeep']] as const) {
    const e = phraseAt(ctx, pos, lead);
    if (e < 0 || ctx.toks[e]?.kind !== 'SELF') continue;
    const f = phraseAt(ctx, e + 1, P("'s cumulative upkeep"));
    if (f >= 0) out.push({ end: f, make: (pl) => ({ ev: 'action', verb, actor: pl, object: { self: true } }) });
  }
  // FAST5X E20 (CR 700.14): "whenever you expend 4"
  for (const w of [P('expend'), P('expends')]) {
    const e = phraseAt(ctx, pos, w);
    const n = e >= 0 && ctx.toks[e]?.kind === 'NUM' ? Number(ctx.toks[e]!.norm) : undefined;
    if (n !== undefined && Number.isInteger(n) && n > 0) out.push({ end: e + 1, make: (pl) => ({ ev: 'action', verb: 'expend', actor: pl, n }) });
  }
  // std-rx28 (CR 602.2, 115.9b; Ertha Jo, Frontier Mentor): "whenever you activate an ability that targets a creature or player": an activated ability (never a mana
  // ability, which has no target, CR 605.1a) described by what it targets; only a description that says something of the ability ("an ability" alone is no form here)
  for (const w of [P('activate an ability'), P('activates an ability')]) {
    const e = phraseAt(ctx, pos, w);
    if (e < 0) continue;
    for (const fe of postModAt(ctx, e)) {
      if (fe.frag.targets === undefined && !(fe.frag.anyOf ?? []).every((x) => x.targets !== undefined)) continue;
      out.push({ end: fe.end, make: (pl) => ({ ev: 'activate', player: pl, activated: fe.frag }) });
    }
  }
  // FAST5X E20: "whenever you activate an exhaust ability" (CR 702.177a), "whenever an opponent activates a loyalty ability" (CR 606.3)
  for (const [w, ability] of [[P('activate an exhaust ability'), 'exhaust'], [P('activates an exhaust ability'), 'exhaust'], [P('activate a loyalty ability'), 'loyalty'], [P('activates a loyalty ability'), 'loyalty'], [P('activate a ninjutsu ability'), 'ninjutsu'], [P('activates a ninjutsu ability'), 'ninjutsu'], [P('activate a boast ability'), 'boast'], [P('activates a boast ability'), 'boast']] as const) { // edh-zones-19 (CR 702.49a): Satoru Umezawa
    at(w, (pl) => ({ ev: 'activate', player: pl, ability }));
  }
  // edh-c-23 (CR 606.3, 602.2; Keral Keep Disciples): "whenever you activate a loyalty ability of a Chandra planeswalker": the planeswalker the loyalty ability belongs to (`source`)
  for (const w of [P('activate a loyalty ability of'), P('activates a loyalty ability of')]) {
    const e = phraseAt(ctx, pos, w);
    if (e < 0) continue;
    if (e < 0 || (ctx.toks[e]?.norm !== 'a' && ctx.toks[e]?.norm !== 'an')) continue;
    for (const n of npAlts(ctx, e + 1)) {
      if (n.number !== 'singular' || n.filter.types?.join() !== 'Planeswalker') continue;
      out.push({ end: n.end, make: (pl) => ({ ev: 'activate', player: pl, ability: 'loyalty', source: n.filter }) });
    }
  }
  // edh-next-17 (CR 602.2, 605.1a, 605.3b; Crackdown Construct): "whenever you activate an ability of an artifact or creature that isn't a mana ability": an activation (not a mana
  // ability) of an ability of a permanent the noun phrase describes (the event's `source`, as for the mana abilities above)
  for (const w of [P('activate an ability of'), P('activates an ability of')]) {
    const e = phraseAt(ctx, pos, w);
    const art = e >= 0 ? ctx.toks[e]?.norm : undefined;
    if (art !== 'a' && art !== 'an') continue;
    for (const n of npAlts(ctx, e + 1)) {
      const m = n.number === 'singular' ? phraseAt(ctx, n.end, P("that isn't a mana ability")) : -1;
      if (m >= 0) out.push({ end: m, make: (pl) => ({ ev: 'activate', player: pl, source: n.filter, manaAbility: false }) });
    }
  }
  // edh-next-11 (CR 606.3, 303.4; Rowan's Talent, Elspeth's Talent): "whenever you activate a loyalty ability of enchanted planeswalker": the source of the loyalty ability is the permanent the Aura is attached to
  for (const w of [P('activate a loyalty ability of enchanted'), P('activates a loyalty ability of enchanted')]) {
    const e = phraseAt(ctx, pos, w);
    if (e < 0) continue;
    for (const n of npAlts(ctx, e)) {
      const f = n.number === 'singular' && n.filter.types?.join() === 'Planeswalker' ? mergeFilter(n.filter, { attachedToSource: true }) : null;
      if (f !== null) out.push({ end: n.end, make: (pl) => ({ ev: 'activate', player: pl, ability: 'loyalty', source: f }) });
    }
  }
  // FAST5X E20 (CR 701.26a): "whenever you tap an untapped creature an opponent controls" (a permanent the player's effect or cost tapped), "one or more untapped
  // creatures your opponents control" (CR 603.2c). Only a permanent an opponent controls: a mana ability's {T} cost (your own permanents) is not reported as an
  // action (rules/crime.ts). "untapped" is the verb's (only an untapped permanent can be tapped): the filter drops it, it would be false after the event.
  for (const w of [P('tap'), P('taps')]) {
    const e = phraseAt(ctx, pos, w);
    if (e < 0) continue;
    const opp = (f: ObjectFilter): ObjectFilter | null => {
      if (f.tapped !== false || f.controller !== 'opponent') return null;
      const { tapped: _t, ...rest } = f;
      return rest;
    };
    const t = ctx.toks[e]?.norm;
    if (t === 'a' || t === 'an') for (const n of npAlts(ctx, e + 1)) {
      const f = n.number === 'singular' ? opp(n.filter) : null;
      if (f) out.push({ end: n.end, make: (pl) => ({ ev: 'action', verb: 'tap', actor: pl, object: f }) });
    }
    const one = phraseAt(ctx, e, P('one or more'));
    if (one >= 0) for (const n of npAlts(ctx, one)) {
      const f = n.number === 'plural' ? opp(n.filter) : null;
      if (f) out.push({ end: n.end, make: (pl) => ({ ev: 'action', verb: 'tap', actor: pl, object: f }), batch: true });
    }
  }
  // tokens, dice
  for (const w of [P('create'), P('creates')]) {
    const e = phraseAt(ctx, pos, w);
    if (e < 0) continue;
    const one = phraseAt(ctx, e, P('one or more'));
    const a = ctx.toks[e]?.norm;
    if (one >= 0) for (const n of npAlts(ctx, one)) if (n.number === 'plural' && n.head === 'token') out.push({ end: n.end, make: (pl) => ({ ev: 'createToken', player: pl, token: n.filter }), batch: true });
    if (a === 'a' || a === 'an') for (const n of npAlts(ctx, e + 1)) if (n.number === 'singular' && n.head === 'token') out.push({ end: n.end, make: (pl) => ({ ev: 'createToken', player: pl, token: n.filter }) });
  }
  at(P('roll a die'), (pl) => ({ ev: 'dieRoll', player: pl }));
  // edh-c-24 (CR 706.2, 603.2c; Dee Kay, Finder of the Lost): "whenever you roll a 2": a roll of one die whose natural result is that number
  for (const w of [P('roll a'), P('rolls a')]) {
    const e = phraseAt(ctx, pos, w);
    const n = e >= 0 ? numberAt(ctx, e) : undefined;
    if (e >= 0 && n !== undefined && Number.isInteger(n) && n >= 1) out.push({ end: e + 1, make: (pl) => ({ ev: 'dieRoll', player: pl, result: { op: '==', value: n } }) });
  }
  // edhn115 (CR 706.2, 603.2c; Critical Hit): "whenever you roll a natural 20": the natural result (before any modifier) is that number, as "roll a 20" is read above
  for (const w of [P('roll a natural'), P('rolls a natural')]) {
    const e = phraseAt(ctx, pos, w);
    const n = e >= 0 ? numberAt(ctx, e) : undefined;
    if (e >= 0 && n !== undefined && Number.isInteger(n) && n >= 1) out.push({ end: e + 1, make: (pl) => ({ ev: 'dieRoll', player: pl, natural: n }) });
  }
  at(P('rolls a die'), (pl) => ({ ev: 'dieRoll', player: pl }));
  // edh-next-55 (CR 706.2, 603.2c; Netherese Puzzle-Ward): "whenever you roll a die's highest natural result": a roll whose natural result is the most the die can show
  at(P("roll a die 's highest natural result"), (pl) => ({ ev: 'dieRoll', player: pl, highest: true }));
  at(P("rolls a die 's highest natural result"), (pl) => ({ ev: 'dieRoll', player: pl, highest: true }));
  // p2-c-dieroll-1 (CR 706.1, 603.2c; unverified cites): "whenever you roll one or more dice": the dice a player rolls in one batch are one occurrence (an
  // instruction that rolls several dice triggers it once); ignored rolls are not rolled (core/dice.ts#rollDice)
  for (const w of [P('roll one or more dice'), P('rolls one or more dice')]) {
    const e = phraseAt(ctx, pos, w);
    if (e >= 0) out.push({ end: e, make: (pl) => ({ ev: 'dieRoll', player: pl }), batch: true });
  }
  // cloud r3-mech (CR 705.2): "whenever you win a coin flip", "whenever a player loses a coin flip"
  at(P('win a coin flip'), (pl) => ({ ev: 'coinFlip', player: pl, won: true }));
  at(P('wins a coin flip'), (pl) => ({ ev: 'coinFlip', player: pl, won: true }));
  at(P('lose a coin flip'), (pl) => ({ ev: 'coinFlip', player: pl, won: false }));
  at(P('loses a coin flip'), (pl) => ({ ev: 'coinFlip', player: pl, won: false }));
  // M12-3 (CR 603.9): "whenever a player loses the game", "whenever an opponent loses the game"
  at(P('loses the game'), (pl) => (pl === 'any' || pl === 'opponent' ? { ev: 'loseGame', player: pl } : null));
  // edh-players-18 (CR 725.3; Palace Jailer): "until an opponent becomes the monarch", "whenever a player becomes the monarch", "whenever you become the monarch"
  at(P('becomes the monarch'), (pl) => (pl === 'you' ? null : { ev: 'monarch', player: pl }));
  at(P('become the monarch'), (pl) => (pl === 'you' ? { ev: 'monarch', player: 'you' } : null));
  return out;
}

/**
 * edh-combat-7 (CR 508.1, 603.2c; Odric, Master Tactician): "whenever ~ and at least three other creatures attack": the source attacks as one of N + 1 or more attackers declared together
 * (the battalion shape of FAST1 T4, which owns "at least two other creatures"; render/evt.ts says any N this way). Only "at least N other creatures", N above two.
 */
function selfAndOthersAttack(ctx: HoleCtx, pos: number): Alt[] {
  if (ctx.toks[pos]?.kind !== 'SELF') return [];
  const al = phraseAt(ctx, pos + 1, P('and at least'));
  const n = al >= 0 ? numberAt(ctx, al) : undefined;
  if (n === undefined || n < 3) return [];
  const o = phraseAt(ctx, al + 1, P('other creatures attack'));
  return o < 0 ? [] : [{ end: o, value: [{ ev: 'attacks', attacker: { self: true }, count: { op: '>=', value: n + 1 } } satisfies EventPattern] }];
}

/**
 * edh-c-83 (CR 508.1, 603.2c; Mob Mentality): "all non-Wall creatures you control attack": one batch of attackers you declare in which every permanent you control of that
 * description is a declared attacker (`allAttack`). Only a plural description that says "you control" and names no zone.
 */
function allYoursAttack(ctx: HoleCtx, pos: number): Alt[] {
  const out: Alt[] = [];
  const a = phraseAt(ctx, pos, P('all'));
  if (a < 0) return out;
  for (const n of npAlts(ctx, a)) {
    if (n.number !== 'plural' || JSON.stringify(n.filter.types) !== '["Creature"]' || n.filter.controller !== 'you' || n.filter.zone !== undefined || n.filter.other === true || n.filter.self !== undefined) continue;
    // only a description that attacking cannot change (a card type, a creature type, a color): "all untapped creatures" is read after the declaration tapped them
    if (Object.entries(n.filter).some(([k, v]) => v !== undefined && !['types', 'notTypes', 'subtypes', 'notSubtypes', 'colors', 'notColors', 'controller'].includes(k))) continue;
    const e = phraseAt(ctx, n.end, P('attack'));
    if (e < 0) continue;
    out.push({ end: e, value: [{ ev: 'attacks', attacker: { controller: 'you' }, count: { op: '>=', value: 1 }, allAttack: n.filter } satisfies EventPattern], flags: ['batch'] });
  }
  return out;
}

/** "whenever you attack", "whenever you attack with two or more creatures": a batch of attackers declared by one player (CR 508.1, 603.2c). */
function youAttack(ctx: HoleCtx, pos: number): Alt[] {
  const out: Alt[] = [];
  const e0 = phraseAt(ctx, pos, P('you attack'));
  if (e0 < 0) return out;
  // std-tla (CR 508.1b, 603.2c): "whenever you attack a player [with one or more ...]": only creatures declared to attack a player (not a planeswalker or a
  // battle), and each player attacked is an occurrence of its own (triggers/occurrences.ts#batchOccurrences); with "one or more" only, as the declaration's
  // count is of all its attackers
  const p = phraseAt(ctx, e0, P('a player'));
  // edh-next-82 (CR 726.1, 508.1b, 603.2c; Loot Dispute): "whenever you attack the player who has the initiative": the batch of attackers declared against that player
  const pi = phraseAt(ctx, e0, P('the player who has the initiative'));
  const pairs: (readonly [number, { defender?: PlayerPred }])[] = pi >= 0 ? [[pi, { defender: { ref: 'initiative' } }]] : p >= 0 ? [[e0, {}], [p, { defender: 'any' }]] : [[e0, {}]];
  for (const [e, def] of pairs) {
    const attacker: ObjectFilter = { controller: 'you' };
    out.push({ end: e, value: [{ ev: 'attacks', attacker, count: { op: '>=', value: 1 }, ...def } satisfies EventPattern], flags: ['batch'] });
    const w = phraseAt(ctx, e, P('with'));
    // CMD2 (CR 508.1, 903.3d-e, 603.2c): "whenever you attack with your commander": one batch of attackers you declare that includes a commander you own (with two
    // commanders, either one or both, CR 702.124e: once per declaration)
    if (w >= 0 && !('defender' in def)) for (const n of yourCommanderAt(ctx, w)) {
      if (n.number !== 'singular') continue;
      const f = mergeFilter(n.filter, { controller: 'you' });
      if (f) out.push({ end: n.end, value: [{ ev: 'attacks', attacker: f, count: { op: '>=', value: 1 } } satisfies EventPattern], flags: ['batch'] });
    }
    // edh-players-11 (CR 508.1, 903.3d-e, 603.2c; Ainok Strike Leader): "whenever you attack with ~ and/or your commander": one batch of attackers you declare that includes the source
    // or a commander you own (once per declaration, whether one or both attack)
    if (w >= 0 && !('defender' in def) && ctx.toks[w]?.kind === 'SELF') {
      const ao = phraseAt(ctx, w + 1, P('and/or'));
      if (ao >= 0) for (const n of yourCommanderAt(ctx, ao)) {
        if (n.number !== 'singular') continue;
        const f = mergeFilter(n.filter, { controller: 'you' });
        if (f && Object.entries(f).every(([k, v]) => v === undefined || (k === 'commander' && v === true) || (k === 'owner' && v === 'you') || (k === 'controller' && v === 'you'))) {
          out.push({ end: n.end, value: [{ ev: 'attacks', attacker: { controller: 'you', anyOf: [{ self: true }, { commander: true, owner: 'you' }] }, count: { op: '>=', value: 1 } } satisfies EventPattern], flags: ['batch'] });
        }
      }
    }
    // edh-combat-5 (CR 508.1, 603.2c; Merry, Esquire of Rohan): "whenever you attack with ~ and another legendary creature": the source attacks and the same declaration has another
    // creature of that description (the source's own attack event; one trigger per declaration)
    if (w >= 0 && !('defender' in def) && ctx.toks[w]?.kind === 'SELF') {
      const an = phraseAt(ctx, w + 1, P('and another'));
      if (an >= 0) for (const n of npAlts(ctx, an)) {
        if (n.number !== 'singular') continue;
        out.push({ end: n.end, value: [{ ev: 'attacks', attacker: { self: true }, withOther: n.filter } satisfies EventPattern] });
      }
    }
    // Standard round 3, r3-trig (CR 508.1, 208.1): "whenever you attack with creatures with total power 12 or greater": one declaration whose attackers have at least
    // that total power (the declaration's `totalPower`, triggers/normalize.ts); only a number with "or greater" / "or more", and not with a defender
    const tp = w >= 0 && !('defender' in def) ? phraseAt(ctx, w, P('creatures with total power')) : -1;
    if (tp >= 0) for (const c of cmpAt(ctx, tp)) {
      if (c.cmp.op !== '>=' || typeof c.cmp.value !== 'number') continue;
      out.push({ end: c.end, value: [{ ev: 'attacks', attacker: { controller: 'you' }, count: { op: '>=', value: 1 }, power: c.cmp as NumberCmp } satisfies EventPattern], flags: ['batch'] });
    }
    if (w >= 0) for (const c of cmpAt(ctx, w)) {
      // edh-c-101 (CR 508.1, 603.2c; Alluring Suitor): "when you attack with exactly two creatures": the declaration's attackers number exactly two (only with the word "exactly")
      if ((c.cmp.op === '==' && ctx.toks[w]?.norm !== 'exactly') || ('defender' in def && !(c.cmp.op === '>=' && c.cmp.value === 1))) continue;
      for (const n of npAlts(ctx, c.end)) {
        if (n.number !== 'plural') continue;
        const f = mergeFilter(n.filter, { controller: 'you' });
        // the declaration's count is of ALL its attackers (triggers/match.ts), so "exactly N" is read of bare creatures only (a described group would be counted wrongly)
        if (c.cmp.op === '==' && JSON.stringify(f) !== JSON.stringify({ types: ['Creature'], controller: 'you' }) && JSON.stringify(f) !== JSON.stringify({ controller: 'you', types: ['Creature'] })) continue;
        if (f) out.push({ end: n.end, value: [{ ev: 'attacks', attacker: f, count: c.cmp as NumberCmp, ...def } satisfies EventPattern], flags: ['batch'] });
      }
    }
  }
  return out;
}

/**
 * std-mkm: "whenever a player attacks with three or more creatures", "whenever an opponent attacks with two or more creatures": a batch of attackers declared by
 * any player (by an opponent), at least N of them (CR 508.1a: the attackers of one declaration are all the active player's, so the count is of the creatures that
 * player attacks with; CR 603.2c: one occurrence for the declaration). Only a comparison of at least N (the form Oracle prints) and a plural description.
 */
const W_A_PLAYER_ATTACKS = P('a player attacks'); // edh-combat-4
const W_OPPONENT_ATTACKS_YOU_AND_OR_WALKERS = P('an opponent attacks you and/or one or more planeswalkers you control'); // edh-zones-14
// edh-next-53 (CR 508.1b, 506.3, 603.2c, 603.4; Ever-Watching Threshold): "whenever an opponent attacks, if they attacked you and/or a planeswalker you control": the same declaration as
// "an opponent attacks you and/or one or more planeswalkers you control" (the intervening "if" is true exactly when the declaration has an attacker of you or a planeswalker you control,
// a fact the attack history keeps, so it holds again as the ability resolves)
const W_OPPONENT_ATTACKS_IF_THEY_ATTACKED_YOU_OR_WALKER = P('an opponent attacks , if they attacked you and/or a planeswalker you control');
function playerAttacksWith(ctx: HoleCtx, pos: number): Alt[] {
  const out: Alt[] = [];
  // pc-combat-1 (CR 508.1b, 303.4, 603.2c; Curse of Opulence): "whenever enchanted player is attacked": creatures attacking the player the source Aura is attached to
  // (never a planeswalker they control, CR 506.3), once for the declaration; the same event as "a player attacks enchanted player with one or more creatures"
  // edh-combat-4 (CR 508.1a, 603.2c; Avatar Roku, Firebender): "whenever a player attacks": a declaration of attackers by any player, once for the declaration (the attacking
  // player is the active player, "that attacking player"/"the attacking player" of the player hole); the creatures themselves are not described
  const pa = phraseAt(ctx, pos, W_A_PLAYER_ATTACKS);
  if (pa >= 0 && ctx.toks[pa]?.norm !== 'with' && ctx.toks[pa]?.norm !== 'one' && ctx.toks[pa]?.norm !== 'enchanted') out.push({ end: pa, value: [{ ev: 'attacks', attacker: { types: ['Creature'] }, count: { op: '>=', value: 1 } } satisfies EventPattern], flags: ['batch'] });
  const ea = phraseAt(ctx, pos, W_ENCHANTED_PLAYER_ATTACKED);
  if (ea >= 0) out.push({ end: ea, value: [{ ev: 'attacks', attacker: { types: ['Creature'] }, count: { op: '>=', value: 1 }, defender: { ref: 'enchantedPlayer' } } satisfies EventPattern], flags: ['batch'] });
  // pc-combat-1 (CR 508.1b, 303.4, 603.2c; the Curses): "whenever a player attacks enchanted player with one or more creatures": the declaration's attackers that attack the
  // player the source Aura is attached to (a planeswalker that player controls is not that player, CR 506.3), at least N of them; one occurrence for the declaration
  for (const [ws, controller, defender] of [[P('a player attacks with'), undefined, undefined], [P('an opponent attacks with'), 'opponent', undefined], [P('another player attacks with'), 'opponent', undefined] /* edh-combat-6 */, [P('a player attacks enchanted player with'), undefined, { ref: 'enchantedPlayer' }]] as const) {
    const w = phraseAt(ctx, pos, ws);
    if (w < 0) continue;
    for (const c of cmpAt(ctx, w)) {
      if (c.cmp.op !== '>=') continue;
      for (const n of npAlts(ctx, c.end)) {
        if (n.number !== 'plural' || n.filter.controller !== undefined) continue;
        const f = controller === undefined ? n.filter : mergeFilter(n.filter, { controller });
        if (f) out.push({ end: n.end, value: [{ ev: 'attacks', attacker: f, count: c.cmp as NumberCmp, ...(defender !== undefined ? { defender } : {}) } satisfies EventPattern], flags: ['batch'] });
      }
    }
    if (defender !== undefined) continue;
    // std-combat-1 (CR 508.1a, 603.2c; Tomik, Wielder of Law): "whenever an opponent attacks with creatures": a declaration by that player with one or more attackers, once
    // per declaration (the plural noun of creatures with no count; "two or more of those creatures ..." is an intervening "if" of its own, parser/holes/cond.ts)
    if (ctx.toks[w]?.norm === 'creatures') {
      const f = controller === undefined ? { types: ['Creature'] } : { types: ['Creature'], controller };
      out.push({ end: w + 1, value: [{ ev: 'attacks', attacker: f as ObjectFilter, count: { op: '>=', value: 1 } } satisfies EventPattern], flags: ['batch'] });
    }
  }
  return out;
}

/**
 * pc-combat-3 (CR 508.1a-b, 603.2c; Lulu, Stern Guardian and Everett K. Ross): "whenever an opponent attacks you [with two or more creatures]": a declaration by an opponent whose
 * attackers attack you (the player, never a planeswalker you control, CR 506.3), at least N of them (one for "attacks you"); one occurrence for the declaration.
 */
function opponentAttacksYou(ctx: HoleCtx, pos: number): Alt[] {
  const out: Alt[] = [];
  // edh-zones-14 (CR 508.1b, 506.3, 603.2c; Cunning Rhetoric): "whenever an opponent attacks you and/or one or more planeswalkers you control": the declaration of an opponent
  // that attacks you or a planeswalker you control, once for the declaration (`orPlaneswalker`, batch)
  const ew = phraseAt(ctx, pos, W_OPPONENT_ATTACKS_YOU_AND_OR_WALKERS);
  if (ew >= 0) out.push({ end: ew, value: [{ ev: 'attacks', defender: 'you', orPlaneswalker: true, attacker: { types: ['Creature'], controller: 'opponent' }, count: { op: '>=', value: 1 } } satisfies EventPattern], flags: ['batch'] });
  const ew2 = phraseAt(ctx, pos, W_OPPONENT_ATTACKS_IF_THEY_ATTACKED_YOU_OR_WALKER);
  if (ew2 >= 0) out.push({ end: ew2, value: [{ ev: 'attacks', defender: 'you', orPlaneswalker: true, attacker: { types: ['Creature'], controller: 'opponent' }, count: { op: '>=', value: 1 } } satisfies EventPattern], flags: ['batch'] });
  // edh-next-53 (CR 508.1b, 506.3, 603.2c; Suppressor Skyguard): "whenever a player attacks you": a player who attacks you is an opponent of yours (CR 102.3), the same declaration as "an opponent attacks you"
  const ePl = phraseAt(ctx, pos, P('a player attacks you'));
  if (ePl >= 0 && ctx.toks[ePl]?.norm !== 'with') out.push({ end: ePl, value: [{ ev: 'attacks', defender: 'you', attacker: { types: ['Creature'], controller: 'opponent' }, count: { op: '>=', value: 1 } } satisfies EventPattern], flags: ['batch'] });
  // edh-d-70 (CR 508.1b, 506.3, 603.2c; Struggle for Project Purity): "whenever a player attacks you with one or more creatures": the same declaration as "an opponent attacks you with ..." (a player who attacks you is an opponent, CR 102.3)
  const e0 = ((): number => { const x = phraseAt(ctx, pos, P('an opponent attacks you')); if (x >= 0) return x; const y = phraseAt(ctx, pos, P('a player attacks you')); return y >= 0 && ctx.toks[y]?.norm === 'with' ? y : -1; })();
  if (e0 < 0) return out;
  const base = { ev: 'attacks' as const, defender: 'you' as const };
  out.push({ end: e0, value: [{ ...base, attacker: { types: ['Creature'], controller: 'opponent' }, count: { op: '>=', value: 1 } } satisfies EventPattern], flags: ['batch'] });
  const w = phraseAt(ctx, e0, P('with'));
  if (w >= 0) for (const c of cmpAt(ctx, w)) {
    if (c.cmp.op !== '>=') continue;
    for (const n of npAlts(ctx, c.end)) {
      if (n.number !== 'plural' || n.filter.controller !== undefined) continue;
      const f = mergeFilter(n.filter, { controller: 'opponent' });
      if (f) out.push({ end: n.end, value: [{ ...base, attacker: f, count: c.cmp as NumberCmp } satisfies EventPattern], flags: ['batch'] });
    }
  }
  return out;
}

/**
 * edh-zones-11 (CR 508.1a-b, 506.3, 603.2c; Horn of the Mark): "whenever two or more creatures you control attack a player": at least N of the creatures you control, all attacking
 * the same player (never a planeswalker or a battle it protects, CR 506.3); one occurrence for each player attacked with enough of them (triggers/occurrences.ts#byAttackedCount).
 * Only a comparison of at least N above one (the form Oracle prints), a plural description of creatures you control and "a player".
 */
function creaturesAttackAPlayer(ctx: HoleCtx, pos: number): Alt[] {
  const out: Alt[] = [];
  for (const c of cmpAt(ctx, pos)) {
    if (c.cmp.op !== '>=' || typeof c.cmp.value !== 'number' || c.cmp.value < 2) continue;
    for (const n of npAlts(ctx, c.end)) {
      if (n.number !== 'plural' || n.filter.controller !== 'you') continue;
      for (const w of [P('attack a player')]) {
        const e = phraseAt(ctx, n.end, w);
        if (e >= 0) out.push({ end: e, value: [{ ev: 'attacks', attacker: n.filter, count: c.cmp as NumberCmp, defender: 'any' } satisfies EventPattern], flags: ['batch'] });
      }
    }
  }
  return out;
}


/**
 * edh-d-4 (CR 506.3, 508.1b, 603.2c; Rigo, Streetwise Mentor and Oath of Kaya): "whenever you attack a player or planeswalker [with one or more creatures [with power 1 or less]]" is one
 * occurrence for each player or planeswalker attacked (`defender: 'any'` with `orPlaneswalker`, never a battle); "whenever an opponent attacks a planeswalker you control [with one or
 * more creatures]" is one occurrence for each planeswalker you control that is attacked (the Oath of Kaya ruling of 2019-05-03; `defender: 'planeswalker'`, `defending: 'you'`).
 * triggers/occurrences.ts#batchOccurrences groups both by the thing attacked.
 */
const W_YOU_ATTACK_PLAYER_OR_WALKER = P('you attack a player or planeswalker'); // edh-d-4
const W_OPP_ATTACKS_WALKER_YOU_CONTROL = P('an opponent attacks a planeswalker you control'); // edh-d-4
function attackPlayerOrWalker(ctx: HoleCtx, pos: number): Alt[] {
  const out: Alt[] = [];
  const e1 = phraseAt(ctx, pos, W_YOU_ATTACK_PLAYER_OR_WALKER);
  if (e1 >= 0) {
    const mk = (attacker: ObjectFilter): EventPattern => ({ ev: 'attacks', attacker, count: { op: '>=', value: 1 }, defender: 'any', orPlaneswalker: true });
    out.push({ end: e1, value: [mk({ controller: 'you' })], flags: ['batch'] });
    const w = phraseAt(ctx, e1, P('with'));
    if (w >= 0) for (const c of cmpAt(ctx, w)) {
      if (c.cmp.op !== '>=' || c.cmp.value !== 1) continue;
      for (const n of npAlts(ctx, c.end)) {
        if (n.number !== 'plural') continue;
        const f = mergeFilter(n.filter, { controller: 'you' });
        if (f) out.push({ end: n.end, value: [mk(f)], flags: ['batch'] });
      }
    }
  }
  const e2 = phraseAt(ctx, pos, W_OPP_ATTACKS_WALKER_YOU_CONTROL);
  if (e2 >= 0) {
    const mk = (attacker: ObjectFilter): EventPattern => ({ ev: 'attacks', attacker, count: { op: '>=', value: 1 }, defender: 'planeswalker', defending: 'you' });
    out.push({ end: e2, value: [mk({ types: ['Creature'], controller: 'opponent' })], flags: ['batch'] });
    const w = phraseAt(ctx, e2, P('with one or more creatures'));
    if (w >= 0) out.push({ end: w, value: [mk({ types: ['Creature'], controller: 'opponent' })], flags: ['batch'] });
  }
  // edhn115 (CR 508.1b, 506.3, 603.2c; Mila, Crafty Companion, ruling 2021-04-16): "whenever an opponent attacks one or more planeswalkers you control" triggers ONLY ONCE no matter how many creatures
  // attack or how many planeswalkers are attacked: the declaration is one occurrence (TriggerDef.wholeBatch), unlike "attacks a planeswalker you control" above (once for each planeswalker)
  const e3 = phraseAt(ctx, pos, W_OPP_ATTACKS_WALKERS_YOU_CONTROL);
  if (e3 >= 0) out.push({ end: e3, value: [{ ev: 'attacks', attacker: { types: ['Creature'], controller: 'opponent' }, count: { op: '>=', value: 1 }, defender: 'planeswalker', defending: 'you' } satisfies EventPattern], flags: ['batch', 'wholeBatch'] });
  return out;
}
const W_OPP_ATTACKS_WALKERS_YOU_CONTROL = P('an opponent attacks one or more planeswalkers you control'); // edhn115

const W_WHILE_ITS_EXILED = P("while it's exiled"); // edhn81
const W_WHILE_SELF_EXILED = P('while ~ is exiled'); // edhn81
/** "a +1/+1 counter is put on ~", "one or more +1/+1 counters are put on a creature you control". */
function counterEvents(ctx: HoleCtx, pos: number): Alt[] {
  const out: Alt[] = [];
  let start = pos;
  let batch = false;
  const oom = phraseAt(ctx, pos, P('one or more'));
  const t = ctx.toks[pos]?.norm;
  // FAST5X E21 (CR 122.1, 603.2): "the fourth plan counter is put on ~": the event that makes the number of counters of that kind on the object reach N
  // (from fewer than N to N or more, triggers/match.ts#counters `atLeast`); only a singular object and "is put on"
  const nth = t === 'the' ? ORDINALS[ctx.toks[pos + 1]?.norm ?? ''] : undefined;
  if (nth !== undefined && nth >= 2) start = pos + 2;
  else if (oom >= 0) { start = oom; batch = true; } else if (t === 'a' || t === 'an') start = pos + 1; else return out;
  // Standard round 5, r5-trig (CR 122.1, 603.2c): "one or more counters are put on a creature you control" (Stalwart Successor): no kind is any kind, as for
  // "you put one or more counters on ..." (youPutCounters)
  // std-rx13 (CR 122.1, 603.2; Hollowmurk Siege): "a counter is put on a creature you control" is the singular of it, any kind, as "a +1/+1 counter is put on ..."
  // is for one kind (one occurrence per object that gets counters at once, triggers/occurrences.ts)
  const kinds: { end: number; value?: unknown; weak?: number }[] = ctx.toks[start]?.norm === (batch ? 'counters' : 'counter') && nth === undefined ? [{ end: start }] : [];
  for (const k of [...kinds, ...ctx.call('CounterKind', start)]) {
    const c = k.value === undefined ? k.end + 1 : anyPhraseAt(ctx, k.end, [P('counter'), P('counters')]);
    if (c < 0) continue;
    for (const [w, change] of [[P('is put on'), 'put'], [P('are put on'), 'put'], [P('is removed from'), 'removed'], [P('are removed from'), 'removed']] as const) {
      if (k.value === undefined && w[0] !== (batch ? 'are' : 'is')) continue;
      const e = phraseAt(ctx, c, w);
      if (e < 0) continue;
      const kind = k.value as string | undefined;
      for (const s of objectSubjects(ctx, e)) {
        // PUSH1 T2 review (CR 603.2c): the engine counts each object that gets counters as one occurrence (triggers/occurrences.ts#batchOccurrences), which is
        // right for "on a creature"; "on one or more creatures" is one occurrence for all of them, so it is not read (manual, never wrong)
        // edh-c-13 (CR 603.2c; Cloaked Cadet): ... but "one or more counters are put on one or more Humans you control" is ONE occurrence for everything that got counters at once
        // (TriggerDef.wholeBatch, as youPutCounters reads "you put ... on one or more other Heroes"); only with the plural "one or more" counters
        if (s.batch && !batch) continue;
        // edhn81 (CR 113.6k, 702.62a, 603.2; Aeon Chronicler, Benalish Commander): "a time counter is removed from ~ while it's exiled": the counters event of the card itself
        // while it is in exile (suspend removes its time counters there); `on.zone` 'exile' keeps it apart from the battlefield event (triggers/match.ts reads the subject
        // by the filter), and lower/trigger-zone.ts#homeZone makes the ability work in exile. Singular, one kind of counter or any, no other qualifier
        if (change === 'removed' && !batch && nth === undefined && s.obj !== undefined && Object.keys(s.obj).length === 1 && (s.obj as ObjectFilter).self === true) {
          for (const w of [W_WHILE_ITS_EXILED, W_WHILE_SELF_EXILED]) {
            const x = phraseAt(ctx, s.end, w);
            if (x >= 0) out.push({ end: x, value: [{ ev: 'counters', change, ...(kind !== undefined ? { kind } : {}), on: { self: true, zone: 'exile' } } satisfies EventPattern], ...(k.weak ? { weak: k.weak } : {}) });
          }
        }
        if (nth !== undefined && nth >= 2) {
          if (change === 'put' && w[0] === 'is' && ctx.toks[k.end]?.norm === 'counter') out.push({ end: s.end, value: [{ ev: 'counters', change, kind, on: s.obj!, atLeast: nth } satisfies EventPattern] });
          continue;
        }
        out.push({ end: s.end, value: [{ ev: 'counters', change, ...(kind !== undefined ? { kind } : {}), on: s.obj! } satisfies EventPattern], ...(batch ? { flags: s.batch ? ['batch', 'wholeBatch'] : ['batch'] } : {}), ...(k.weak ? { weak: k.weak } : {}) });
      }
      // edhn63 (CR 122.6, 603.2c; Bioessence Hydra): "one or more loyalty counters are put on planeswalkers you control": the bare plural names the set, one occurrence for everything that got counters at once
      // (as "on one or more Humans you control" above); only with the plural "one or more" counters and "are put on"
      if (batch && change === 'put' && nth === undefined && w[0] === 'are') {
        for (const n of npAlts(ctx, e)) {
          if (n.number !== 'plural') continue;
          out.push({ end: n.end, value: [{ ev: 'counters', change, ...(kind !== undefined ? { kind } : {}), on: n.filter } satisfies EventPattern], flags: ['batch', 'wholeBatch'], ...(k.weak ? { weak: k.weak } : {}) });
        }
      }
    }
  }
  return out;
}

const W_OPP_PUTS = P('an opponent puts');
const W_THEY_CONTROL = P('they control');
/**
 * edhn63 (CR 122.6, 603.2c; Bold Plagiarist): "an opponent puts one or more counters on a creature they control": the counters event of an opponent putting them on
 * a creature that same player controls (`by: 'opponent'` with `byController`, triggers/match.ts). Any kind unless one is named; one occurrence per creature
 * (triggers/occurrences.ts). Only "a creature" / "a permanent": the controller test is that of the one object.
 */
function opponentPutsCounters(ctx: HoleCtx, pos: number): Alt[] {
  const out: Alt[] = [];
  const lead = phraseAt(ctx, pos, W_OPP_PUTS);
  if (lead < 0) return out;
  const oom = phraseAt(ctx, lead, W_ONE_OR_MORE);
  if (oom < 0) return out;
  const kinds: { end: number; kind?: string; weak?: number }[] = ctx.toks[oom]?.norm === 'counters' ? [{ end: oom }] : [];
  for (const k of ctx.call('CounterKind', oom)) if (ctx.toks[k.end]?.norm === 'counters') kinds.push({ end: k.end, kind: k.value as string, ...(k.weak ? { weak: k.weak } : {}) });
  for (const k of kinds) {
    const on = phraseAt(ctx, k.end + 1, W_ON);
    if (on < 0) continue;
    for (const [head, types] of [['creature', ['Creature']], ['permanent', undefined]] as const) {
      const noun = phraseAt(ctx, on, P(`a ${head}`));
      if (noun < 0) continue;
      const end = phraseAt(ctx, noun, W_THEY_CONTROL);
      if (end < 0) continue;
      const ev: EventPattern = { ev: 'counters', change: 'put', ...(k.kind !== undefined ? { kind: k.kind } : {}), on: types === undefined ? {} : { types: [...types] }, by: 'opponent', byController: true };
      out.push({ end, value: [ev], flags: ['batch'], ...(k.weak ? { weak: k.weak } : {}) });
    }
  }
  return out;
}

const W_YOU_PUT = P('you put');
const W_ONE_OR_MORE = P('one or more');
const W_ON = P('on');

/**
 * FAST5X E21 (CR 122.6, 122.6a): "you put one or more +1/+1 counters on a creature you control", "you put a counter on a creature you control", "you put one or
 * more counters on a Goblin you control": the counters event of the player who puts them (`by`, triggers/match.ts). A kind is optional ("a counter": any
 * kind). "One or more" is one occurrence per object that gets counters (triggers/occurrences.ts#batchOccurrences); a set of objects is not read.
 */
const W_YOU_REMOVE = P('you remove');
/**
 * edhd68 (CR 122.1, 702.62a, 603.2; Watcher of Hours): "you remove a time counter from ~ while it's exiled": the counters event of the card itself in exile, removed
 * by its controller (`by: 'you'`, the engine records who removed them: effects pay with the ability's controller, a cost with the payer). Only the singular, one named kind,
 * the card itself (a time counter removed by another player does not match).
 */
function youRemoveTimeCounter(ctx: HoleCtx, pos: number): Alt[] {
  const out: Alt[] = [];
  const lead = phraseAt(ctx, pos, W_YOU_REMOVE);
  if (lead < 0) return out;
  const t = ctx.toks[lead]?.norm;
  if (t !== 'a' && t !== 'an') return out;
  for (const k of ctx.call('CounterKind', lead + 1)) {
    if (k.value !== 'time') continue;
    const c = phraseAt(ctx, k.end, P('counter from'));
    if (c < 0 || ctx.toks[c]?.kind !== 'SELF') continue;
    for (const w of [W_WHILE_ITS_EXILED, W_WHILE_SELF_EXILED]) {
      const x = phraseAt(ctx, c + 1, w);
      if (x >= 0) out.push({ end: x, value: [{ ev: 'counters', change: 'removed', kind: 'time', on: { self: true, zone: 'exile' }, by: 'you' } satisfies EventPattern], ...(k.weak ? { weak: k.weak } : {}) });
    }
  }
  return out;
}

function youPutCounters(ctx: HoleCtx, pos: number): Alt[] {
  const out: Alt[] = [];
  const lead = phraseAt(ctx, pos, W_YOU_PUT);
  if (lead < 0) return out;
  const oom = phraseAt(ctx, lead, W_ONE_OR_MORE);
  const t = ctx.toks[lead]?.norm;
  const start = oom >= 0 ? oom : t === 'a' || t === 'an' ? lead + 1 : -1;
  if (start < 0) return out;
  const batch = oom >= 0;
  const noun = batch ? 'counters' : 'counter';
  const kinds: { end: number; kind?: string; weak?: number }[] = ctx.toks[start]?.norm === noun ? [{ end: start }] : [];
  for (const k of ctx.call('CounterKind', start)) if (ctx.toks[k.end]?.norm === noun) kinds.push({ end: k.end, kind: k.value as string, ...(k.weak ? { weak: k.weak } : {}) });
  for (const k of kinds) {
    const on = phraseAt(ctx, k.end + 1, W_ON);
    if (on < 0) continue;
    for (const s of objectSubjects(ctx, on)) {
      // Standard round 5, r5-trig (CR 603.2c, 122.6; Invisible Woman, Sue Storm): "you put one or more +1/+1 counters on one or more other Heroes you control" is
      // one occurrence for every object that got counters at once (TriggerDef.wholeBatch), never one for each of them
      if (s.batch && !batch) continue;
      const ev: EventPattern = { ev: 'counters', change: 'put', ...(k.kind !== undefined ? { kind: k.kind } : {}), on: s.obj!, by: 'you' };
      out.push({ end: s.end, value: [ev], ...(batch ? { flags: s.batch ? ['batch', 'wholeBatch'] : ['batch'] } : {}), ...(k.weak ? { weak: k.weak } : {}) });
      // edh-players-11 (CR 122.1, 122.6, 603.2c; All Will Be One): "a permanent or player": the counters put on a permanent, or on a player (poison, energy, experience, rad), each one occurrence
      // (triggers/occurrences.ts#batchOccurrences counts the objects and players that get counters at once, one by one). Never with a set ("one or more permanents").
      if (!s.batch && s.head === 'permanent' && Object.keys(s.obj!).length === 0) {
        const pl = phraseAt(ctx, s.end, P('or player'));
        if (pl >= 0) out.push({ end: pl, value: [ev, { ...ev, on: { player: 'any' } } as EventPattern], ...(batch ? { flags: ['batch'] } : {}), ...(k.weak ? { weak: k.weak } : {}) });
      }
    }
  }
  return out;
}

/**
 * MX3 (CR 701.54d): "the Ring tempts you" (each time the player completes CR 701.54a, even with no creature to choose) and "you choose a creature as your
 * Ring-bearer" (the same event when a creature was chosen: its object). core/ring.ts emits both as the action `ringTempts` of that player.
 */
const W_RING_TEMPTS_YOU = P('the ring tempts you');
const W_CHOOSE_BEARER = P('you choose a creature as your ring-bearer');
function ringEvents(ctx: HoleCtx, pos: number): Alt[] {
  const out: Alt[] = [];
  const a = phraseAt(ctx, pos, W_RING_TEMPTS_YOU);
  if (a >= 0) out.push({ end: a, value: [{ ev: 'action', verb: 'ringTempts', actor: 'you' } satisfies EventPattern] });
  const b = phraseAt(ctx, pos, W_CHOOSE_BEARER);
  if (b >= 0) out.push({ end: b, value: [{ ev: 'action', verb: 'ringTempts', actor: 'you', object: { types: ['Creature'] } } satisfies EventPattern] });
  return out;
}

/**
 * M12F (CR 701.38a): "players finish voting", once per vote, whoever started it (the `votesFinished` event of effects/handlers/actions-native.ts#vote; a vote
 * resolved by hand emits it too, effects/manual.ts#askManual).
 */
const W_PLAYERS_FINISH_VOTING = P('players finish voting');
function voteEvents(ctx: HoleCtx, pos: number): Alt[] {
  const e = phraseAt(ctx, pos, W_PLAYERS_FINISH_VOTING);
  return e < 0 ? [] : [{ end: e, value: [{ ev: 'action', verb: 'votesFinished' } satisfies EventPattern] }];
}

/**
 * edh-c-63 (CR 107.14, 122.1, 603.2c; Territorial Gorger, rulings 2024-06-07 and 2016-09-20): "Whenever you get one or more {E}": energy counters put on you, one occurrence for all
 * of them at once (a "one or more" trigger, `TriggerDef.batch`), so getting three at once is one trigger and getting them at different times is one each.
 */
const W_YOU_GET_ENERGY = P('you get one or more');
function energyGotEvents(ctx: HoleCtx, pos: number): Alt[] {
  const g = phraseAt(ctx, pos, W_YOU_GET_ENERGY);
  const t = g >= 0 ? ctx.toks[g] : undefined;
  return t !== undefined && t.kind === 'MANA' && t.norm === '{e}' ? [{ end: g + 1, value: [{ ev: 'counters', change: 'put', kind: 'energy', on: { player: 'you' } } satisfies EventPattern], flags: ['batch'] }] : [];
}

/** State triggers (CR 603.8): "you control no Islands", "you have no cards in hand". */
function stateEvents(ctx: HoleCtx, pos: number): Alt[] {
  const out: Alt[] = [];
  // FAST5X E21 (CR 603.8): also "there are four or more page counters on ~" (parser/holes/cond.ts#thereAre)
  // edh-perms-1 (port of the stopped p2-trigger-events-2; CR 603.8; Dark Depths): also "~ has no ice counters on it", a condition of the object itself (the Cond hole reads it)
  const selfHas = ctx.toks[pos]?.kind === 'SELF' && ctx.toks[pos + 1]?.norm === 'has';
  const lead = selfHas ? pos + 2 : anyPhraseAt(ctx, pos, [P('you control'), P("you don't control"), P('you have'), P('there are')]);
  // edh-d-4 (CR 603.8; Last Laugh): "when no creatures are on the battlefield", the state "there are no creatures on the battlefield" said the other way round (render/evt.ts, family no-x-are-on-the-battlefield)
  const noW = phraseAt(ctx, pos, W_NO);
  if (noW >= 0) for (const n of npAlts(ctx, noW)) {
    const e = n.number === 'plural' ? phraseAt(ctx, n.end, W_ARE_ON_THE_BATTLEFIELD) : -1;
    const f = n.filter;
    if (e >= 0 && f.controller === undefined && f.owner === undefined && f.zone === undefined && f.other === undefined) {
      out.push({ end: e, value: [{ ev: 'state', cond: { cond: 'not', of: { cond: 'exists', of: { ref: 'each', filter: { ...f, zone: 'battlefield' } } } } } satisfies EventPattern] });
    }
  }
  if (lead < 0) return out;
  for (const c of ctx.call('Cond', pos)) out.push({ end: c.end, value: [{ ev: 'state', cond: c.value as Condition } satisfies EventPattern], ...(c.flags ? { flags: c.flags } : {}) });
  return out;
}
const W_NO = P('no'); // edh-d-4
const W_A_MANA_ABILITY_OF = P('a mana ability of'); // edh-d-90
const W_RESOLVES = P('resolves'); // edh-d-90
const W_ARE_ON_THE_BATTLEFIELD = P('are on the battlefield'); // edh-d-4

// ---------------------------------------------------------------------------
// the hole
// ---------------------------------------------------------------------------

/**
 * FAST5 T62 (CR 120.2, 120.2b, 603.2c): "one or more opponents are dealt noncombat damage": damage that is not combat damage dealt to opponents, one trigger for
 * all of it that is dealt at once (a "one or more" trigger, `TriggerDef.batch`). Only opponents and only noncombat damage.
 */
const W_OPPONENTS_DEALT_NONCOMBAT = P('one or more opponents are dealt noncombat damage');
function opponentsDealtNoncombat(ctx: HoleCtx, pos: number): Alt[] {
  const e = phraseAt(ctx, pos, W_OPPONENTS_DEALT_NONCOMBAT);
  return e < 0 ? [] : [{ end: e, value: [{ ev: 'damage', recipient: { player: 'opponent' }, combat: false } satisfies EventPattern], flags: ['batch'] }];
}

/**
 * std-rr (CR 120.2, 510.2, 603.2c; Fblthp, Impossibly Lost): "one or more of your opponents are dealt combat damage", "one or more opponents are dealt damage": damage
 * dealt to opponents of the controller, ONE trigger for all of it that is dealt at once however many opponents it is dealt to (the opponents are the "one or more":
 * TriggerDef.wholeBatch, as "one or more of your opponents are attacked" above). FAST5 T62's "one or more opponents are dealt noncombat damage" keeps its own reading
 * (one occurrence for each opponent dealt damage, triggers/occurrences.ts#batchOccurrences; guard G10), so the words of T62 are not read here.
 */
const W_ONE_OR_MORE_OPPONENTS = [P('one or more of your opponents'), P('one or more opponents'), P('your opponents') /* edh-d-87 (Mindblade Render): read with the source below only */];
/** edh-d-87 (CR 603.2c, 603.4, 120.2, 510.2; Mindblade Render): ", if any of that damage was dealt by a Warrior": the batch counts only when a source of that description dealt some of it. */
const W_ANY_OF_THAT_DAMAGE_BY = P(', if any of that damage was dealt by');
const OPPONENTS_DEALT: [string[], boolean | undefined][] = [[P('are dealt combat damage'), true], [P('are dealt noncombat damage'), false], [P('are dealt damage'), undefined]];
function opponentsDealtDamage(ctx: HoleCtx, pos: number): Alt[] {
  const out: Alt[] = [];
  for (const w of W_ONE_OR_MORE_OPPONENTS) {
    const s = phraseAt(ctx, pos, w);
    if (s < 0) continue;
    for (const [ws, combat] of OPPONENTS_DEALT) {
      const e = phraseAt(ctx, s, ws);
      if (e < 0 || (combat === false && w === W_ONE_OR_MORE_OPPONENTS[1])) continue; // T62's words ("one or more opponents are dealt noncombat damage") are T62's
      // edh-d-87 (CR 603.2c, 603.4; Mindblade Render; ruling 2018-06-08): "Whenever your opponents are dealt combat damage, if any of that damage was dealt by a Warrior": ONE trigger for the
      // whole simultaneous batch, when some of the damage dealt to opponents was dealt by a source of that description (whoever controls it): the damage event with that source. The
      // condition is about the damage already dealt, so it is as true when the ability resolves (CR 603.4). Only after "your opponents" (the plain wording keeps the readings above)
      const by = phraseAt(ctx, e, W_ANY_OF_THAT_DAMAGE_BY);
      if (by >= 0 && (ctx.toks[by]?.norm === 'a' || ctx.toks[by]?.norm === 'an')) {
        for (const n of npAlts(ctx, by + 1)) {
          if (n.number === 'singular') out.push({ end: n.end, value: [{ ev: 'damage', source: n.filter, recipient: { player: 'opponent' }, ...(combat !== undefined ? { combat } : {}) } satisfies EventPattern], flags: ['batch', 'wholeBatch'] });
        }
      }
      if (w === W_ONE_OR_MORE_OPPONENTS[2]) continue;
      out.push({ end: e, value: [{ ev: 'damage', recipient: { player: 'opponent' }, ...(combat !== undefined ? { combat } : {}) } satisfies EventPattern], flags: ['batch', 'wholeBatch'] });
    }
  }
  return out;
}

/**
 * Cloud std-woe (CR 120.1, 120.2, 109.4): "a source you control deals noncombat damage to an opponent" (Virtue of Courage), "a source an opponent controls deals damage
 * to you": damage dealt by any object, permanent or spell, that player controls. "Source" is no head of an ordinary subject (nothing else "a source" does is an event
 * here), so only the damage it deals is read: [combat | noncombat] damage, to a recipient or to anything.
 */
const W_A_SOURCE = P('a source');
const SOURCE_CONTROLLERS: [string[], PlayerPred][] = [[P('you control'), 'you'], [P('an opponent controls'), 'opponent']];
function sourceDamage(ctx: HoleCtx, pos: number): Alt[] {
  const a = phraseAt(ctx, pos, W_A_SOURCE);
  if (a < 0) return [];
  const out: Alt[] = [];
  for (const [ws, controller] of SOURCE_CONTROLLERS) {
    const c = phraseAt(ctx, a, ws);
    if (c < 0) continue;
    for (const [w, combat] of [[P('deals combat damage'), true], [P('deals noncombat damage'), false], [P('deals damage'), undefined]] as const) {
      const e = phraseAt(ctx, c, w);
      if (e < 0) continue;
      const base: EventPattern = { ev: 'damage', source: { controller }, ...(combat !== undefined ? { combat } : {}) };
      out.push({ end: e, value: [base] });
      const to = phraseAt(ctx, e, P('to'));
      if (to >= 0) {
        for (const r of damageRecipients(ctx, to)) {
          out.push({ end: r.end, value: [{ ...base, recipient: r.recipient } as EventPattern] });
          // std-rx28 (CR 120.1, 208.1; Taii Wakeen, Perfect Shot): "... to a creature equal to that creature's toughness": damage whose amount is the toughness of the
          // creature dealt it; only a creature recipient named alone
          const eq = r.recipient.object !== undefined && r.recipient.player === undefined && r.recipient.object.types?.length === 1 && r.recipient.object.types[0] === 'Creature'
            ? phraseAt(ctx, r.end, W_EQUAL_TO_ITS_TOUGHNESS) : -1;
          if (eq >= 0) out.push({ end: eq, value: [{ ...base, recipient: r.recipient, amountIsToughness: true } as EventPattern] });
        }
      }
    }
  }
  return out;
}
const W_EQUAL_TO_ITS_TOUGHNESS = P("equal to that creature 's toughness"); // std-rx28
const W_THAT_CREATURE = P('that creature'); // std-rx28

/**
 * CLOUD std-tmt (CR 506.2, 508.1b, 603.2c): "one or more of your opponents are attacked": attackers declared with at least one of them attacking an opponent of
 * the controller (a creature attacking a planeswalker or battle does not attack its player; only creatures attack, CR 506.3), one trigger for the declaration
 * however many opponents it attacks (TriggerDef.wholeBatch, the flag `wholeBatch`; "one or more creatures attack an opponent" is one trigger for each opponent
 * attacked, std-tla).
 */
// edh-combat-2 (CR 506.2, 508.1, 603.2c; Jolene, the Plunder Queen): "a player attacks one or more of your opponents" is the same event said from the attacker's side: the active
// player declares every attacker (CR 508.1a), so it is one declaration however many opponents it attacks; "that attacking player" is the active player (holes/player.ts)
const W_OPPONENTS_ATTACKED = [P('one or more of your opponents are attacked'), P('a player attacks one or more of your opponents')];
// edh-combat-4 (CR 508.3e, 603.2c; Combat Calligrapher): "a player attacks one of your opponents" (singular) is one occurrence for each opponent attacked (not the whole declaration:
// no `wholeBatch`), with the creatures attacking that opponent; "that opponent" is the one attacked
const W_PLAYER_ATTACKS_ONE_OPPONENT = P('a player attacks one of your opponents');
// edh-players-20 (CR 506.2, 508.1b, 603.2c; Karazikar, the Eye Tyrant): "an opponent attacks another one of your opponents": an opponent's creatures attacking a different opponent, one occurrence for each
// opponent attacked (as the singular form above); the attacker's own controller never counts (match.ts, `otherThanAttacker`)
const W_OPPONENT_ATTACKS_ANOTHER_OPPONENT = P('an opponent attacks another one of your opponents');
function opponentsAttacked(ctx: HoleCtx, pos: number): Alt[] {
  const another = phraseAt(ctx, pos, W_OPPONENT_ATTACKS_ANOTHER_OPPONENT);
  if (another >= 0) return [{ end: another, value: [{ ev: 'attacks', attacker: { types: ['Creature'], controller: 'opponent' }, defender: 'opponent', otherThanAttacker: true, count: { op: '>=', value: 1 } } satisfies EventPattern], flags: ['batch'] }];
  const one = phraseAt(ctx, pos, W_PLAYER_ATTACKS_ONE_OPPONENT);
  if (one >= 0) return [{ end: one, value: [{ ev: 'attacks', attacker: { types: ['Creature'] }, defender: 'opponent', count: { op: '>=', value: 1 } } satisfies EventPattern], flags: ['batch'] }];
  const e = Math.max(...W_OPPONENTS_ATTACKED.map((w) => phraseAt(ctx, pos, w)));
  return e < 0 ? [] : [{ end: e, value: [{ ev: 'attacks', attacker: { types: ['Creature'] }, defender: 'opponent' } satisfies EventPattern], flags: ['batch', 'wholeBatch'] }];
}

const W_IS_CAST = P('is cast'); // edh-next-147
const W_IS_CAST_FROM_EXILE = P('is cast from exile'); // std-control-1
const W_FROM_ANYWHERE_OTHER_THAN_BATTLEFIELD = P('from anywhere other than the battlefield'); // edh-zones-3
const W_COMMA_OR_EVENT = [P(', or'), P('or')]; // edh-zones-3
const W_COMMA_EVENT = P(','); // edh-players-8
const W_PREDICATE_CLOSE = [P('or'), P(', or')]; // edh-cast-11

/**
 * edh-players-8 (CR 603.2, 603.2c, 508.1a; Trouble in Pairs): "an opponent attacks you with two or more creatures, draws their second card each turn, or casts their second
 * spell each turn": the attack declaration of an opponent (a batch event, once for each declaration) and two or more single events of that same opponent, any of which
 * triggers the ability. The attack comes first and the predicates of the other events share its subject, "an opponent"; a list needs its last "or" (a list of two is joined by "or").
 * The ability is a batch one (the flag below), which the engine splits by event kind: only the attack declaration is a batch (triggers/collect.ts#mixedAttackOccurrences).
 */
function opponentAttacksYouList(ctx: HoleCtx, pos: number): Alt[] {
  const out: Alt[] = [];
  for (const a of opponentAttacksYou(ctx, pos)) {
    const first = a.value as EventPattern[];
    if (first.length !== 1 || first[0]!.ev !== 'attacks' || first[0]!.count === undefined || a.flags?.includes('batch') !== true) continue;
    const walk = (p: number, made: EventPattern[], depth: number): void => {
      // the separators: ", " between the first two, ", or" / "or" before the last
      for (const [w, closes] of [[W_COMMA_EVENT, false], [W_COMMA_OR_EVENT[0]!, true], [W_COMMA_OR_EVENT[1]!, true]] as const) {
        const s = phraseAt(ctx, p, w);
        if (s < 0) continue;
        for (const pr of playerPredicates(ctx, s)) {
          const m = pr.batch === true ? null : pr.make('opponent');
          if (m === null) continue;
          const all = [...made, m];
          if (closes) out.push({ end: pr.end, value: [...first, ...all], flags: ['batch'] });
          if (depth < 2) walk(pr.end, all, depth + 1);
        }
      }
    };
    walk(a.end, [], 0);
  }
  return out;
}
/** edh-zones-4: the zones a card is put into exile from, as Oracle words them after "from" (library and/or graveyard of the same player). */
const W_EXILE_FROM_ZONES: readonly (readonly [readonly string[], ZoneName | ZoneName[]])[] = [
  [P('your library'), 'library'], [P('your graveyard'), 'graveyard'],
  [P('your library and/or your graveyard'), ['library', 'graveyard']], [P('your library or your graveyard'), ['library', 'graveyard']], [P('your library or graveyard'), ['library', 'graveyard']],
];

/**
 * edh-zones-19 (CR 119.3, 603.2c; Emet-Selch of the Third Seat): "one or more opponents lose life" / "one or more of your opponents lose life": life lost by opponents of the
 * controller at once, ONE trigger for all of it however many opponents lose life (TriggerDef.wholeBatch, as the damage form above); "gain life" is the same reading for gains.
 * Only an amount-less loss or gain (no "exactly N").
 */
function opponentsLoseLife(ctx: HoleCtx, pos: number): Alt[] {
  const out: Alt[] = [];
  for (const w of W_ONE_OR_MORE_OPPONENTS) {
    const s = phraseAt(ctx, pos, w);
    if (s < 0) continue;
    for (const [ws, change] of [[P('lose life'), 'loss'], [P('gain life'), 'gain']] as const) {
      const e = phraseAt(ctx, s, ws);
      if (e >= 0) out.push({ end: e, value: [{ ev: 'life', change, player: 'opponent' } satisfies EventPattern], flags: ['batch', 'wholeBatch'] });
    }
  }
  return out;
}

const W_EXACTLY_EACH_LOSE = [P('each lose exactly')];
/**
 * edh-players-20 (CR 119.3, 120.3a, 603.2c; Ob Nixilis, Captive Kingpin): "one or more opponents each lose exactly 1 life": the life each opponent lost at once, judged in total for that
 * opponent (the ruling: three 1/1 creatures dealing combat damage to one opponent make that player lose 3 life, so it does not trigger); ONE trigger for all of it (TriggerDef.wholeBatch).
 * Only a fixed number.
 */
function opponentsLoseExactly(ctx: HoleCtx, pos: number): Alt[] {
  const out: Alt[] = [];
  for (const w of W_ONE_OR_MORE_OPPONENTS) {
    const s = phraseAt(ctx, pos, w);
    if (s < 0) continue;
    for (const lose of W_EXACTLY_EACH_LOSE) {
      const e = phraseAt(ctx, s, lose);
      if (e < 0) continue;
      const t = ctx.toks[e];
      if (t === undefined || t.kind !== 'NUM') continue;
      const n = Number(t.norm);
      const end = phraseAt(ctx, e + 1, P('life'));
      if (Number.isInteger(n) && n > 0 && end >= 0) out.push({ end, value: [{ ev: 'life', change: 'loss', player: 'opponent', amount: { op: '==', value: n }, totalAmount: true } satisfies EventPattern], flags: ['batch', 'wholeBatch'] });
    }
  }
  return out;
}

export const event: HoleFn = (ctx, pos) => {
  const out: Alt[] = [...stepEvents(ctx, pos), ...youAttack(ctx, pos), ...allYoursAttack(ctx, pos), ...selfAndOthersAttack(ctx, pos), ...playerAttacksWith(ctx, pos), ...opponentAttacksYou(ctx, pos), ...counterEvents(ctx, pos), ...youRemoveTimeCounter(ctx, pos), ...youPutCounters(ctx, pos), ...opponentPutsCounters(ctx, pos), ...energyGotEvents(ctx, pos), ...stateEvents(ctx, pos), ...ringEvents(ctx, pos), ...voteEvents(ctx, pos), ...opponentsDealtNoncombat(ctx, pos),
    ...sourceDamage(ctx, pos), ...opponentsDealtDamage(ctx, pos), ...creaturesAttackAPlayer(ctx, pos), ...attackPlayerOrWalker(ctx, pos)]; // Cloud std-woe: sourceDamage; std-mkm: playerAttacksWith; std-rr: opponentsDealtDamage
  out.push(...opponentsAttacked(ctx, pos)); // CLOUD std-tmt
  out.push(...opponentsLoseLife(ctx, pos)); // edh-zones-19 (CR 603.2c): "one or more opponents lose life"
  out.push(...opponentsLoseExactly(ctx, pos)); // edh-players-20 (CR 603.2c): "one or more opponents each lose exactly 1 life"
  out.push(...opponentAttacksYouList(ctx, pos)); // edh-players-8 (CR 603.2c): "an opponent attacks you with two or more creatures, draws their second card each turn, or ..."
  out.push(...sacrificedOrDestroyed(ctx, pos)); // edh-d-87 (CR 701.17a, 701.8a; parser/holes/edhd87.ts): "a noncreature artifact is sacrificed or destroyed"
  // std-control-1 (CR 601.2a, 400.7): "~ is cast from exile" (Emrakul, the Exigent Doom's "until this card is cast from exile"): the card moves from exile to the stack,
  // which only casting it does (CR 601.2a); read as that zone change, whose event names the card it was in exile (the cast event names only the new stack object)
  // edh-d-90 (CR 605.1a, 605.3a, 605.3b, 602.2; Tyvar the Bellicose): "whenever a mana ability of ~ resolves": an activation of a mana ability of the object itself (an activated mana
  // ability resolves at once, CR 605.3a; the engine sees it as its mana being added by that activation, triggers/normalize.ts); only the object itself (`~`), only "resolves"
  const ma = phraseAt(ctx, pos, W_A_MANA_ABILITY_OF);
  if (ma >= 0 && ctx.toks[ma]?.kind === 'SELF') {
    const e = phraseAt(ctx, ma + 1, W_RESOLVES);
    if (e >= 0) out.push({ end: e, value: [{ ev: 'activate', source: { self: true }, manaAbility: true }] });
  }
  if (ctx.toks[pos]?.kind === 'SELF') {
    const e = phraseAt(ctx, pos + 1, W_IS_CAST_FROM_EXILE);
    if (e >= 0) out.push({ end: e, value: [{ ev: 'zoneChange', subject: { self: true }, from: 'exile', to: 'stack' }] });
  }

  // edh-next-147 (CR 601.2i, 603.2; Sentinel Tower): "an instant or sorcery spell is cast": a cast by any player of a spell of the description (the passive of "a player casts
  // an instant or sorcery spell", the same event); a singular spell noun phrase only, no zone
  {
    const t = ctx.toks[pos]?.norm;
    if (t === 'a' || t === 'an') for (const n of npAlts(ctx, pos + 1)) {
      if (n.number !== 'singular' || n.head !== 'spell' || n.filter.zone !== 'stack' || n.filter.self !== undefined || n.filter.chosen !== undefined) continue;
      const e = phraseAt(ctx, n.end, W_IS_CAST);
      if (e < 0) continue;
      const f: ObjectFilter = { ...n.filter };
      delete f.zone; delete f.stackKind;
      out.push({ end: e, value: [{ ev: 'cast', player: 'any', ...(Object.keys(f).length > 0 ? { spell: f } : {}) }] });
    }
  }

  // object subjects: one or more subjects, one or more predicates
  for (const l of objectSubjectLists(ctx, pos)) {
    // edh-cast-11 (CR 603.2; Giggling Skitterspike): "attacks, blocks, or becomes the target of a spell": a list of three or more predicates is closed by ", or" / "or"
    // (`open`: a predicate followed by a bare comma is not an event list until a later "or" closes it, so "attacks, draw a card" never reads as one)
    const walk = (p: number, preds: Pred[], depth: number, open = false): void => {
      for (const pr of objectPredicates(ctx, p)) {
        // T3 (push wave), CR 509.3b: in "blocks or becomes blocked by a white creature" the noun phrase is the object of both verbs, so the "blocks" half is
        // "blocks a white creature" (once per such attacker), never a bare "blocks" (any creature); the bare reading is replaced, not kept beside it
        const prev = preds[preds.length - 1];
        const shared = prev?.bareBlocks === true && pr.blockedBy !== undefined ? pr.blockedBy : undefined;
        const head = shared !== undefined ? [...preds.slice(0, -1), { end: prev!.end, make: (s: Subj): EventPattern => ({ ev: 'blocks', blocker: sf(s), attacker: shared }) }] : preds;
        const all = [...head, pr];
        const patterns: EventPattern[] = [];
        for (const s of l.subs) for (const x of all) { const m = x.make(s); if (m !== null) patterns.push(m); }
        if (patterns.length !== l.subs.length * all.length) continue; // a contradiction in one pair drops the reading
        const batch = l.subs.some((s) => s.batch) || all.some((x) => x.batch === true); // edh-next-51: or a predicate that is a batch itself ("deals damage to one or more creatures")
        // edh-next-113 (CR 400.3, 603.2; Duskmantle Guildmage, "whenever a card is put into an opponent's graveyard from anywhere this turn"): a card whose event states the zone it
        // moves from or to ("is put into ... graveyard", `zoneChange` with `from` / `to`) is not a card with no zone stated
        const zoned = patterns.every((m) => m.ev === 'zoneChange' && (m.from !== undefined || m.to !== undefined));
        const flags = [...new Set([...l.subs.flatMap((s) => (zoned ? s.flags.filter((x) => x !== 'zone-unstated') : s.flags)), ...(batch ? ['batch'] : []), ...(all.some((x) => x.whole === true) ? ['wholeBatch'] : [])])];
        if (!open) out.push({ end: pr.end, value: patterns, ...(flags.length > 0 ? { flags } : {}) });
        if (depth < 3) {
          for (const w of open ? W_PREDICATE_CLOSE : W_PREDICATE_CLOSE.slice(0, 1)) { const or = phraseAt(ctx, pr.end, w); if (or >= 0) walk(or, all, depth + 1); }
          const comma = phraseAt(ctx, pr.end, W_COMMA_EVENT);
          if (comma >= 0 && !batch) walk(comma, all, depth + 1, true);
        }
      }
    };
    walk(l.end, [], 0);
  }

  // Standard round 4, r4-trig (CR 115.1, 603.2; Loki, God of Mischief): "a player or permanent becomes the target of ...", "you or a permanent you control becomes the
  // target of ...": the player and the object are each an event (a player target, `player`; an object target)
  for (const [ws, pl, obj] of [[P('a player or permanent'), 'any', { zone: 'battlefield' }], [P('you or a permanent you control'), 'you', { controller: 'you', zone: 'battlefield' }],
    // edh-next-141 (CR 115.1, 603.2, 109.1; Valkmira, Protector's Shield): "you or another permanent you control becomes the target of ...": the object event excludes the source itself
    [P('you or another permanent you control'), 'you', { controller: 'you', zone: 'battlefield', other: true }]] as const) {
    const e = phraseAt(ctx, pos, ws);
    const b = e >= 0 ? anyPhraseAt(ctx, e, [P('becomes the target of')]) : -1;
    if (b >= 0) for (const by of stackSources(ctx, b)) {
      const extra = by.filter ? { by: by.filter } : {};
      out.push({ end: by.end, value: [{ ev: 'becomes', what: 'targeted', object: {}, player: pl, ...extra }, { ev: 'becomes', what: 'targeted', object: { ...obj }, ...extra }] });
    }
  }
  // edh-next-99 (CR 115.1, 603.2c; Leyline of Combustion): "you and/or at least one permanent you control becomes the target of ...": the same two events as "you or a permanent you control", as a batch: a spell or
  // ability that targets you and/or permanents you control (even several times) triggers the ability once (ruling 2019-07-12)
  {
    const e = phraseAt(ctx, pos, P('you and/or at least one permanent you control'));
    const b = e >= 0 ? anyPhraseAt(ctx, e, [P('becomes the target of')]) : -1;
    if (b >= 0) for (const by of stackSources(ctx, b)) {
      const extra = by.filter ? { by: by.filter } : {};
      out.push({ end: by.end, value: [{ ev: 'becomes', what: 'targeted', object: {}, player: 'you', ...extra }, { ev: 'becomes', what: 'targeted', object: { controller: 'you', zone: 'battlefield' }, ...extra }], flags: ['batch'] });
    }
  }
  // edh-c-69 (CR 115.1, 603.2; Dormant Gomazoa): "whenever you become the target of a spell": the player target alone (`player`), as the first event of the two above
  {
    const e = phraseAt(ctx, pos, P('you become the target of'));
    if (e >= 0) for (const by of stackSources(ctx, e)) out.push({ end: by.end, value: [{ ev: 'becomes', what: 'targeted', object: {}, player: 'you', ...(by.filter ? { by: by.filter } : {}) }] });
  }
  // edh-next-91 (CR 601.2i, 603.2; Nullstone Gargoyle): "the first noncreature spell of a turn is cast": the Nth spell of the kind cast in the turn by ANY player (`anyCaster`)
  {
    const t = phraseAt(ctx, pos, P('the'));
    const nth = t >= 0 ? ORDINALS[ctx.toks[t]?.norm ?? ''] : undefined;
    if (nth !== undefined) for (const n of npAlts(ctx, t + 1)) {
      if (n.number !== 'singular' || n.head !== 'spell' || n.filter.zone !== 'stack' || n.filter.chosen !== undefined) continue;
      const f: ObjectFilter = { ...n.filter };
      delete f.zone; delete f.stackKind;
      if (Object.keys(f).length === 0) continue;
      const et = phraseAt(ctx, n.end, P('of a turn is cast'));
      if (et >= 0) out.push({ end: et, value: [{ ev: 'cast', spell: f, nth, nthMatching: true, anyCaster: true }] });
    }
  }
  // Standard round 4, r4-trig (CR 121.2, 603.2; Lady Octopus, Inspired Inventor): "you draw your first or second card each turn": either of the two draws
  const fos = phraseAt(ctx, pos, P('you draw your first or second card each turn'));
  if (fos >= 0) out.push({ end: fos, value: [{ ev: 'draw', player: 'you', nth: 1 }, { ev: 'draw', player: 'you', nth: 2 }] });
  // Standard round 4, r4-trig (CR 305.1, 601.2a; Shadow of the Goblin): "you play a land or cast a spell from anywhere other than your hand": the zone is said once for
  // both events (playerOr makes no reading with a zone said by some predicates only)
  const plc = phraseAt(ctx, pos, P('you play a land or cast a spell from anywhere other than your hand'));
  if (plc >= 0) out.push({ end: plc, value: [{ ev: 'action', verb: 'playLand', actor: 'you', notFrom: 'hand' }, { ev: 'cast', player: 'you', spell: { not: { castFrom: 'hand' } } }] });
  // edh-cast-10 (CR 305.1, 601.2a, 603.2; Prosper, Tome-Bound): "you play a card from exile": to play a card is to play it as a land or cast it, so either event (from exile) triggers the ability
  const pcf = phraseAt(ctx, pos, P('you play a card from exile'));
  if (pcf >= 0) out.push({ end: pcf, value: [{ ev: 'action', verb: 'playLand', actor: 'you', from: 'exile' }, { ev: 'cast', player: 'you', from: 'exile' }] });
  // Standard round 4, r4-trig (CR 120.2, 510.2, 603.2c): "you're dealt [combat] damage" (the player predicates above, of "you")
  for (const [w, combat] of [[P("you're dealt combat damage"), true], [P('you are dealt combat damage'), true], [P("you're dealt damage"), false], [P('you are dealt damage'), false]] as const) {
    const e = phraseAt(ctx, pos, w);
    if (e >= 0) out.push({ end: e, value: [{ ev: 'damage', recipient: { player: 'you' }, ...(combat ? { combat: true } : {}) }] });
  }
  // edh-next-91 (CR 120.2, 510.2, 603.2c; Risona, Asari Commander): "combat damage is dealt to you" / "damage is dealt to you": the same event as "you're dealt [combat] damage" (the damage said first)
  for (const [w, combat] of [[P('combat damage is dealt to you'), true], [P('damage is dealt to you'), false]] as const) {
    const e = phraseAt(ctx, pos, w);
    if (e >= 0) out.push({ end: e, value: [{ ev: 'damage', recipient: { player: 'you' }, ...(combat ? { combat: true } : {}) }] });
  }
  // edh-replace-3 (CR 615.13, 615.1; Selfless Squire): "damage that would be dealt to you is prevented": a prevention effect prevented some or all of the damage to you
  const dpv = phraseAt(ctx, pos, P('damage that would be dealt to you is prevented'));
  if (dpv >= 0) out.push({ end: dpv, value: [{ ev: 'damagePrevented', recipient: { player: 'you' } }] });
  // player subjects
  for (const s of playerSubjects(ctx, pos)) {
    for (const pr of playerPredicates(ctx, s.end)) {
      const m = pr.make(s.player!);
      if (m !== null) out.push({ end: pr.end, value: [m], ...(pr.batch ? { flags: ['batch'] } : {}) });
      if (m !== null && pr.batch !== true) out.push(...playerOr(ctx, s.player!, pr.end, [m], saysFrom(ctx, s.end, pr.end), 0));
    }
    // edh-c-13 (CR 305.1, 601.2a, 603.2; Null Profusion): "you play a card": to play a card is to play it as a land or cast it, so either event triggers the ability (as
    // "you play a card from exile" above); only "you"
    if (s.player === 'you') {
      const pc = phraseAt(ctx, s.end, P('play a card'));
      if (pc >= 0) out.push({ end: pc, value: [{ ev: 'action', verb: 'playLand', actor: 'you' }, { ev: 'cast', player: 'you', spell: { isCard: true } }] satisfies EventPattern[] }); // a copy of a spell is cast but is not a card (rulings of Null Profusion 2007-02-01, Recycle 2018-07-13)
      // edh-d-86 (CR 305.1, 601.2a, 603.2, 205.2a; Rendmaw, Creaking Nest): "you play a card with two or more card types": the same two events, the card described by its
      // characteristics only (no zone, controller, owner or "other": the land played and the spell cast are the card's own); the land is judged as it entered, the spell as cast
      const pa = phraseAt(ctx, s.end, P('play'));
      const det = pa >= 0 ? ctx.toks[pa]?.norm : undefined;
      if (det === 'a' || det === 'an') {
        for (const n of npAlts(ctx, pa + 1)) {
          const { isCard: _card, ...f } = n.filter;
          const keys = Object.keys(f).filter((k) => (f as Record<string, unknown>)[k] !== undefined);
          if (n.number !== 'singular' || n.head !== 'card' || keys.length === 0 || !keys.every((k) => k === 'minCardTypes')) continue;
          out.push({ end: n.end, value: [{ ev: 'action', verb: 'playLand', actor: 'you', object: f }, { ev: 'cast', player: 'you', spell: { isCard: true, ...f } }] satisfies EventPattern[] });
        }
      }
    }
    // edh-players-1 (CR 603.2, 111.1, 701.21a; Mirkwood Bats): "you create or sacrifice a token": the one noun phrase is the object of both verbs, each its own event
    // (a token created, a token sacrificed); either triggers the ability. The two verbs in this order only (the renderer says the pair so, events() in render/evt.ts)
    for (const w of [P('create or sacrifice'), P('creates or sacrifices')]) {
      const e = phraseAt(ctx, s.end, w);
      const a = e >= 0 ? ctx.toks[e]?.norm : undefined;
      if (a !== 'a' && a !== 'an') continue;
      for (const n of npAlts(ctx, e + 1)) {
        if (n.number !== 'singular' || n.head !== 'token') continue;
        out.push({ end: n.end, value: [{ ev: 'createToken', player: s.player!, token: n.filter }, { ev: 'action', verb: 'sacrifice', actor: s.player!, object: n.filter }] satisfies EventPattern[] });
      }
    }
  }
  // edh-next-43 (CR 706.2, 603.2c; Atomwheel Acrobats): "whenever you roll a 1 or 2": a roll of one die whose natural result is either number; each result is its own
  // event (as "you roll a 1 or roll a 2"), so one roll triggers the ability once. Whole numbers only, two different results (the renderer says the pair so, evt.ts)
  for (const s of playerSubjects(ctx, pos)) for (const w of [P('roll a'), P('rolls a')]) {
    if (s.player === undefined) continue;
    const e = phraseAt(ctx, s.end, w);
    const n = e >= 0 ? numberAt(ctx, e) : undefined;
    const or = e >= 0 && n !== undefined ? ctx.toks[e + 1]?.norm : undefined;
    const m = or === 'or' ? numberAt(ctx, e + 2) : undefined;
    if (n === undefined || m === undefined || !Number.isInteger(n) || !Number.isInteger(m) || n < 1 || m < 1 || n >= m) continue;
    out.push({ end: e + 3, value: [{ ev: 'dieRoll', player: s.player, result: { op: '==', value: n } }, { ev: 'dieRoll', player: s.player, result: { op: '==', value: m } }] satisfies EventPattern[] });
  }
  // edh-next-55 (CR 706.2, 603.2c; Monoxa, Midway Manager, Mr. House): "whenever you roll a 3 or higher" / "a 2 or lower": a roll of one die whose result is at least (at most) that number
  for (const s of playerSubjects(ctx, pos)) for (const w of [P('roll a'), P('rolls a')]) {
    if (s.player === undefined) continue;
    const e = phraseAt(ctx, s.end, w);
    const n = e >= 0 ? numberAt(ctx, e) : undefined;
    const dir = e >= 0 && n !== undefined && ctx.toks[e + 1]?.norm === 'or' ? ctx.toks[e + 2]?.norm : undefined;
    if (n === undefined || !Number.isInteger(n) || n < 1 || (dir !== 'higher' && dir !== 'lower')) continue;
    out.push({ end: e + 3, value: [{ ev: 'dieRoll', player: s.player, result: { op: dir === 'higher' ? '>=' : '<=', value: n } }] satisfies EventPattern[] });
  }
  // edh-zones-3 (CR 603.2; Syr Konrad, the Grim): two or more complete events, each with a subject of its own, joined by "or" or ", or": any of them triggers the ability. Only
  // single (not "one or more") events, so a batch keeps its own reading; the second event is read by this hole again, so a third and a fourth join too
  const base = dedupeEvents(out);
  const joined: Alt[] = [];
  for (const a of base) {
    if (a.flags?.includes('batch') === true) continue;
    for (const w of W_COMMA_OR_EVENT) {
      const o = phraseAt(ctx, a.end, w);
      if (o < 0) continue;
      for (const b of ctx.call('Event', o)) {
        if (b.flags?.includes('batch') === true || b.end <= o) continue;
        joined.push({ end: b.end, value: [...(a.value as EventPattern[]), ...(b.value as EventPattern[])], ...(a.flags && a.flags.length > 0 ? { flags: a.flags } : {}) });
      }
    }
  }
  return dedupeEvents([...base, ...joined]);
};

const W_PREDICATE_OR = P('or');
const saysFrom = (ctx: HoleCtx, from: number, to: number): boolean => ctx.toks.slice(from, to).some((t) => t.norm === 'from');

/**
 * Cloud std-spm (CR 603.2): one player and predicates joined by "or" ("you play a land from exile or cast a spell from exile", "you play a land or cast a
 * spell"): either event triggers the ability, as for the predicates of an object subject. A zone said by some of the predicates only ("you play a land or
 * cast a spell from anywhere other than your hand") may be meant for all of them, so such a reading is not made; nor with a "one or more" predicate.
 */
function playerOr(ctx: HoleCtx, player: PlayerPred, end: number, made: EventPattern[], from: boolean, depth: number): Alt[] {
  const or = depth < 2 ? phraseAt(ctx, end, W_PREDICATE_OR) : -1;
  if (or < 0) return [];
  const out: Alt[] = [];
  for (const pr of playerPredicates(ctx, or)) {
    const m = pr.batch === true ? null : pr.make(player);
    if (m === null || saysFrom(ctx, or, pr.end) !== from) continue;
    out.push({ end: pr.end, value: [...made, m] }, ...playerOr(ctx, player, pr.end, [...made, m], from, depth + 1));
  }
  return out;
}

function dedupeEvents(alts: Alt[]): Alt[] {
  // identical patterns reached by different routes are one parse; the order of patterns is part of the value
  return dedupe(alts);
}

