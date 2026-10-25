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
import { WITHOUT_DYING, type Condition, type EventPattern, type NumberCmp, type ObjectFilter, type PlayerPred, type PlayerRef } from '../../types/ability';
import type { Step } from '../../types/state';
import type { ManaType } from '../../types/mana';
import type { Alt, HoleCtx, HoleFn } from './core';
import { P, anaphorObj, anyPhraseAt, cmpAt, dedupe, mergeFilter, phraseAt, predOf } from './core';
import { npAlts, yourCommanderAt, postModAt } from './filter';
import { possessivePlayerAt } from './player';
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
const EACH_OF_YOUR_STEPS: [string[], Step][] = [
  [P('upkeeps'), 'upkeep'], [P('draw steps'), 'draw'], [P('precombat main phases'), 'main1'], [P('postcombat main phases'), 'main2'], [P('end steps'), 'end'],
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
  const b = phraseAt(ctx, pos, W_BEGINNING_OF);
  if (b < 0) return out;
  const eoy = phraseAt(ctx, b, W_EACH_OF_YOUR);
  if (eoy >= 0) for (const [ws, step] of EACH_OF_YOUR_STEPS) {
    const e = phraseAt(ctx, eoy, ws);
    if (e >= 0) emit(e, [step], 'you');
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

function playerSubjects(ctx: HoleCtx, pos: number): Subj[] {
  const out: Subj[] = [];
  const add = (ws: readonly string[], pred: PlayerPred): void => { const e = phraseAt(ctx, pos, ws); if (e >= 0) out.push({ end: e, player: pred, batch: false, flags: [] }); };
  add(P('you'), 'you');
  add(P('a player'), 'any');
  add(P('an opponent'), 'opponent');
  add(P('each opponent'), 'opponent');
  add(P('each player'), 'any');
  add(P('enchanted player'), { ref: 'enchantedPlayer' }); // std-rr (CR 303.4, 702.5a): the player the source Aura is attached to
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
      // Standard round 5, r5-trig (CR 603.2c; Satoru, the Infiltrator): "~ and/or one or more other nontoken creatures you control enter": the object itself, the
      // others, or both at once: one batch trigger over all of them (the "one or more" part makes the list a batch, the flag below)
      if (depth < 3) { const ao = phraseAt(ctx, s.end, P('and/or')); if (ao >= 0) for (const t of objectSubjects(ctx, ao)) if (t.batch) out.push({ end: t.end, subs: [...subs, t] }); }
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
}
const sf = (s: Subj): ObjectFilter => s.obj ?? {};

/**
 * Who or what is attacked (CR 508.1b: a player, a planeswalker or a battle). M12-3: "you or a planeswalker you control" is `defender: 'you'` with
 * `orPlaneswalker` (W_YOU_OR_YOUR_PLANESWALKER below), never narrowed to "you".
 */
const W_YOU_OR_YOUR_PLANESWALKER = P('you or a planeswalker you control');
const DEFENDERS: [string[], PlayerPred | 'planeswalker' | 'battle'][] = [
  [P('you'), 'you'], [P('a player'), 'any'], [P('an opponent'), 'opponent'], [P('one of your opponents'), 'opponent'] /* r5-refs (CR 508.1b): Oracle's other name for an opponent */, [P('a planeswalker'), 'planeswalker'], [P('a battle'), 'battle'],
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
    if (w.length > 1) { const u = under(e); if (u.ctl) out.push({ end: u.end, make: (s) => ({ ev: 'zoneChange', subject: { ...sf(s), controller: 'you' }, to: 'battlefield' }) }); }
    // Standard round 4, r4-trig (CR 400.7, 603.6a; Fire Lord Zuko): "a permanent you control enters from exile": put onto the battlefield from exile
    const fx = phraseAt(ctx, e, P('from exile'));
    if (fx >= 0) out.push({ end: fx, make: (s) => (s.obj?.self === true ? null : { ev: 'zoneChange', subject: sf(s), from: 'exile', to: 'battlefield' }) });
  }
  // Cloud std-eoe (CR 700.4, 603.6c, 603.10a): "dies or is put into exile": put into a graveyard or into exile from the battlefield (Syr Vondam, Sunstar Exemplar);
  // the subject is a permanent (a creature you control, ~), whose leaves-the-battlefield ability looks back to the battlefield
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
      const fa = phraseAt(ctx, z.end, P('from anywhere'));
      if (fa >= 0) out.push({ end: fa, make: (s) => { const f = subject(s); return f === null ? null : { ev: 'zoneChange', subject: f, to: 'graveyard' }; } });
    }
  }
  // std-lci (CR 701.44a-b): "Whenever a creature you control explores", "... explores a land card" / "... explores a nonland card" (the card it revealed)
  for (const w of [P('explores'), P('explore')]) {
    const e = phraseAt(ctx, pos, w);
    if (e < 0) continue;
    out.push({ end: e, make: (s) => ({ ev: 'action', verb: 'explore', object: sf(s) }) });
    for (const [ws, revealed] of W_EXPLORED_KIND) { const k = phraseAt(ctx, e, ws); if (k >= 0) out.push({ end: k, make: (s) => ({ ev: 'action', verb: 'explore', object: sf(s), revealed }) }); }
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
  at(P('is exiled'), (s) => ({ ev: 'zoneChange', subject: sf(s), to: 'exile' }));
  at(P('are exiled'), (s) => ({ ev: 'zoneChange', subject: sf(s), to: 'exile' }));
  // CLOUD std-msh (CR 400.3, 603.10a, 603.6c): "Whenever another nonland permanent you control is returned to its owner's hand": a permanent put into its
  // owner's hand from the battlefield (the subject is read as it last existed there); only a permanent's description, never a card's ("a card is returned
  // to your hand" may come from any zone)
  for (const w of [P("is returned to its owner 's hand"), P("are returned to their owner 's hand"), P("are returned to their owners ' hands")]) {
    at(w, (s) => (s.obj !== undefined && s.obj.isCard === true ? null : { ev: 'zoneChange', subject: sf(s), from: 'battlefield', to: 'hand' }));
  }

  for (const w of [P('attacks'), P('attack')]) {
    const e = phraseAt(ctx, pos, w);
    if (e < 0) continue;
    out.push({ end: e, make: (s) => ({ ev: 'attacks', attacker: sf(s) }) });
    // std-rx35 (CR 509.1h): "Whenever ~ attacks and isn't blocked": an attacker no blocker was declared for, as blockers are declared
    const nb = phraseAt(ctx, e, P("and isn't blocked"));
    if (nb >= 0) out.push({ end: nb, make: (s) => ({ ev: 'attacksUnblocked', attacker: sf(s) }) });
    // FAST5X E3 (CR 702.171b, 508.1): "~ attacks while saddled": the attacker has the saddled designation as it attacks
    const ws = phraseAt(ctx, e, W_WHILE_SADDLED);
    if (ws >= 0) out.push({ end: ws, make: (s) => (s.obj?.self === true ? { ev: 'attacks', attacker: { ...sf(s), saddled: true } } : null) });
    const al = phraseAt(ctx, e, P('alone'));
    if (al >= 0) out.push({ end: al, make: (s) => ({ ev: 'attacks', attacker: sf(s), alone: true }) });
    for (const [ws, defender] of DEFENDERS) {
      const d = phraseAt(ctx, e, ws);
      if (d >= 0) out.push({ end: d, make: (s) => ({ ev: 'attacks', attacker: sf(s), defender }) });
      // Standard round 4, r4-trig (CR 506.5, 508.1b; Jiang Yanggu, Alone and Yuriko, Blade of the Mighty): "attacks a player alone": the only creature declared as an
      // attacker, and it attacks that player (not a planeswalker or battle)
      const da = d >= 0 && typeof defender === 'string' && defender !== 'planeswalker' && defender !== 'battle' ? phraseAt(ctx, d, P('alone')) : -1;
      if (da >= 0) out.push({ end: da, make: (s) => ({ ev: 'attacks', attacker: sf(s), defender, alone: true }) });
    }
    // M12-3 (CR 506.3, 508.1b): "attacks you or a planeswalker you control" (`orPlaneswalker`)
    const yp = phraseAt(ctx, e, W_YOU_OR_YOUR_PLANESWALKER);
    if (yp >= 0) out.push({ end: yp, make: (s) => ({ ev: 'attacks', attacker: sf(s), defender: 'you', orPlaneswalker: true }) });
  }
  for (const w of [P('blocks'), P('block')]) {
    const e = phraseAt(ctx, pos, w);
    if (e < 0) continue;
    out.push({ end: e, make: (s) => ({ ev: 'blocks', blocker: sf(s) }), bareBlocks: true });
    const a = ctx.toks[e]?.norm;
    if (a === 'a' || a === 'an') for (const n of npAlts(ctx, e + 1)) if (n.number === 'singular') out.push({ end: n.end, make: (s) => ({ ev: 'blocks', blocker: sf(s), attacker: n.filter }) });
  }
  for (const w of [P('becomes blocked'), P('become blocked')]) {
    const e = phraseAt(ctx, pos, w);
    if (e < 0) continue;
    out.push({ end: e, make: (s) => ({ ev: 'becomesBlocked', attacker: sf(s) }) });
    const by = phraseAt(ctx, e, P('by'));
    const t = by >= 0 ? ctx.toks[by]?.norm : undefined;
    if (t === 'a' || t === 'an') for (const n of npAlts(ctx, by + 1)) if (n.number === 'singular') out.push({ end: n.end, make: (s) => ({ ev: 'becomesBlocked', attacker: sf(s), by: n.filter }), blockedBy: n.filter });
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
    const base = (s: Subj): EventPattern | null => (!keep(s) ? null : { ev: 'damage', source: sf(s), ...(combat !== undefined ? { combat } : {}) });
    out.push({ end: e, make: base });
    const to = phraseAt(ctx, e, P('to'));
    if (to >= 0) for (const r of damageRecipients(ctx, to)) out.push({ end: r.end, make: (s) => { const b = base(s); return b === null ? null : ({ ...b, recipient: r.recipient } as EventPattern); } });
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
  for (const [w, combat] of [[P('is dealt combat damage'), true], [P('are dealt combat damage'), true], [P('is dealt damage'), false], [P('are dealt damage'), false]] as const) {
    const e = phraseAt(ctx, pos, w);
    if (e < 0) continue;
    const base = (s: Subj): EventPattern => ({ ev: 'damage', recipient: { object: sf(s) }, ...(combat ? { combat: true } : {}) });
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
    }
  }

  // FAST1 T4, CR 106.12, 605.1b: "enchanted land is tapped for mana" is activating a mana ability of it (landTappedForMana)
  at(P('is tapped for mana'), (s) => (landTappedForMana(sf(s)) ? { ev: 'activate', source: sf(s), manaAbility: true } : null));
  // becomes ...
  for (const [w, what] of [[P('becomes tapped'), 'tapped'], [P('become tapped'), 'tapped'], [P('becomes untapped'), 'untapped'], [P('become untapped'), 'untapped'],
    [P('is turned face up'), 'turnedFaceUp'], [P('transforms'), 'transformed'], [P('transform'), 'transformed'], [P('becomes monstrous'), 'monstrous'],
    [P('becomes renowned'), 'renowned'], [P('becomes saddled'), 'saddled'], [P('becomes crewed'), 'crewed']] as const) {
    at(w, (s) => ({ ev: 'becomes', what, object: sf(s) }));
  }
  // std-rx31 (CR 701.3a, 603.2): "whenever this Equipment becomes attached to a creature": the object itself attached to a permanent of that description (`by`; the
  // event's `object` role is that permanent, triggers/normalize.ts)
  for (const w of [P('becomes attached to'), P('become attached to')]) {
    const e = phraseAt(ctx, pos, w);
    const t = e >= 0 ? ctx.toks[e]?.norm : undefined;
    if (t === 'a' || t === 'an') for (const n of npAlts(ctx, e + 1)) if (n.number === 'singular') out.push({ end: n.end, make: (s) => ({ ev: 'becomes', what: 'attached', object: sf(s), by: n.filter }) });
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
  const players: [string[], PlayerPred][] = [[P('a player'), 'any'], [P('an opponent'), 'opponent'], [P('you'), 'you'], [P('each opponent'), 'opponent'], [P('one of your opponents'), 'opponent']];
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
  if (t === 'a' || t === 'an') for (const n of npAlts(ctx, pos + 1)) if (n.number === 'singular') out.push({ end: n.end, recipient: { object: n.filter } });
  if (ctx.toks[pos]?.kind === 'SELF') out.push({ end: pos + 1, recipient: { object: { self: true } } });
  return out;
}
const W_THAT_PLAYER = P('that player');
const W_THAT_OPPONENT = P('that opponent');

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
  const at = (words: readonly string[], make: PPred['make']): void => { const e = phraseAt(ctx, pos, words); if (e >= 0) out.push({ end: e, make }); };
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
  // cast
  for (const w of [P('cast or copy'), P('casts or copies'), P('cast'), P('casts')]) {
    const e = phraseAt(ctx, pos, w);
    if (e < 0) continue;
    const orCopy = w.includes('copy') || w.includes('copies');
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
        return { ev: 'cast', player: pl, ...(Object.keys(sf).length > 0 ? { spell: sf } : {}), ...(from ? { from: from.zone } : {}), ...(orCopy ? { orCopy: true } : {}) };
      };
      out.push({ end: n.end, make: mk() });
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
  // FAST1 T4, CR 106.12, 605.1b: "a player taps a land for mana" (landTappedForMana)
  for (const w of [P('tap'), P('taps')]) {
    const e = phraseAt(ctx, pos, w);
    const t = e >= 0 ? ctx.toks[e]?.norm : undefined;
    if (t !== 'a' && t !== 'an') continue;
    for (const n of npAlts(ctx, e + 1)) {
      if (n.number !== 'singular') continue;
      // std-mana-1 (CR 106.12): "you tap a land for {C}": the activation of a land's mana ability produced mana of that one type
      const fo = landTappedForMana(n.filter) ? phraseAt(ctx, n.end, P('for')) : -1;
      if (fo >= 0) for (const t of ctx.call('ManaSym', fo)) out.push({ end: t.end, make: (pl) => ({ ev: 'activate', player: pl, source: n.filter, manaAbility: true, produced: t.value as ManaType }) });
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
    const end = phraseAt(ctx, e + 1, P('spell each turn'));
    // "your" is the caster only when the caster is you; "their" only when it is another player
    if (end >= 0) out.push({ end, make: (pl) => ((pl === 'you') === own ? { ev: 'cast', player: pl, nth } : null) });
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
    const poss = phraseAt(ctx, e, P('your'));
    const ord = poss >= 0 ? ORDINALS[ctx.toks[poss]?.norm ?? ''] : undefined;
    if (ord !== undefined) { const ce = phraseAt(ctx, poss + 1, P('card each turn')); if (ce >= 0) out.push({ end: ce, make: (pl) => ({ ev: 'draw', player: pl, nth: ord }) }); }
  }
  // life
  for (const w of [P('gain life'), P('gains life')]) at(w, (pl) => ({ ev: 'life', change: 'gain', player: pl }));
  for (const w of [P('lose life'), P('loses life')]) at(w, (pl) => ({ ev: 'life', change: 'loss', player: pl }));
  // actions on an object: sacrifice, discard, cycle
  for (const [ws, verb] of [[P('sacrifice'), 'sacrifice'], [P('sacrifices'), 'sacrifice'], [P('discard'), 'discard'], [P('discards'), 'discard'], [P('cycle'), 'cycle'], [P('cycles'), 'cycle'], [P('exert'), 'exert'], [P('exerts'), 'exert']] as const) { // std-ry8: "whenever you exert a creature" (CR 701.43a)
    const e = phraseAt(ctx, pos, ws);
    if (e < 0) continue;
    if (ctx.toks[e]?.kind === 'SELF') out.push({ end: e + 1, make: (pl) => ({ ev: 'action', verb, actor: pl, object: { self: true } }) });
    const t = ctx.toks[e]?.norm;
    if (t === 'a' || t === 'an') for (const n of npAlts(ctx, e + 1)) if (n.number === 'singular') out.push({ end: n.end, make: (pl) => ({ ev: 'action', verb, actor: pl, object: n.filter }) });
    // Standard round 4, r4-trig (CR 701.21a, 109.2; Zodiark, Umbral God): "whenever a player sacrifices another creature": a permanent other than the ability's source
    // ("you sacrifice another ..." is trg.you.sacrifice's, parser/templates/trigger.json: its one reading, so only another player here)
    if (t === 'another' && verb === 'sacrifice') for (const n of npAlts(ctx, e + 1)) if (n.number === 'singular' && n.filter.other === undefined) out.push({ end: n.end, make: (pl) => (pl === 'you' ? null : { ev: 'action', verb, actor: pl, object: { ...n.filter, other: true } }) });
    // FAST5X E28 (CR 603.2c, 701.21a): "whenever you sacrifice one or more Foods": once per player's sacrifices in one event (a batch, like the discard template)
    if (verb === 'sacrifice') {
      const one = phraseAt(ctx, e, P('one or more'));
      if (one >= 0) for (const n of npAlts(ctx, one)) if (n.number === 'plural') out.push({ end: n.end, make: (pl) => ({ ev: 'action', verb, actor: pl, object: n.filter }), batch: true });
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
  for (const [w, ability] of [[P('activate an exhaust ability'), 'exhaust'], [P('activates an exhaust ability'), 'exhaust'], [P('activate a loyalty ability'), 'loyalty'], [P('activates a loyalty ability'), 'loyalty']] as const) {
    at(w, (pl) => ({ ev: 'activate', player: pl, ability }));
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
  at(P('rolls a die'), (pl) => ({ ev: 'dieRoll', player: pl }));
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
  for (const [e, def] of p >= 0 ? [[e0, {}], [p, { defender: 'any' }]] as const : [[e0, {}]] as const) {
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
    // Standard round 3, r3-trig (CR 508.1, 208.1): "whenever you attack with creatures with total power 12 or greater": one declaration whose attackers have at least
    // that total power (the declaration's `totalPower`, triggers/normalize.ts); only a number with "or greater" / "or more", and not with a defender
    const tp = w >= 0 && !('defender' in def) ? phraseAt(ctx, w, P('creatures with total power')) : -1;
    if (tp >= 0) for (const c of cmpAt(ctx, tp)) {
      if (c.cmp.op !== '>=' || typeof c.cmp.value !== 'number') continue;
      out.push({ end: c.end, value: [{ ev: 'attacks', attacker: { controller: 'you' }, count: { op: '>=', value: 1 }, power: c.cmp as NumberCmp } satisfies EventPattern], flags: ['batch'] });
    }
    if (w >= 0) for (const c of cmpAt(ctx, w)) {
      if (c.cmp.op === '==' || ('defender' in def && !(c.cmp.op === '>=' && c.cmp.value === 1))) continue;
      for (const n of npAlts(ctx, c.end)) {
        if (n.number !== 'plural') continue;
        const f = mergeFilter(n.filter, { controller: 'you' });
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
function playerAttacksWith(ctx: HoleCtx, pos: number): Alt[] {
  const out: Alt[] = [];
  for (const [ws, controller] of [[P('a player attacks with'), undefined], [P('an opponent attacks with'), 'opponent']] as const) {
    const w = phraseAt(ctx, pos, ws);
    if (w < 0) continue;
    for (const c of cmpAt(ctx, w)) {
      if (c.cmp.op !== '>=') continue;
      for (const n of npAlts(ctx, c.end)) {
        if (n.number !== 'plural' || n.filter.controller !== undefined) continue;
        const f = controller === undefined ? n.filter : mergeFilter(n.filter, { controller });
        if (f) out.push({ end: n.end, value: [{ ev: 'attacks', attacker: f, count: c.cmp as NumberCmp } satisfies EventPattern], flags: ['batch'] });
      }
    }
    // std-combat-1 (CR 508.1a, 603.2c; Tomik, Wielder of Law): "whenever an opponent attacks with creatures": a declaration by that player with one or more attackers, once
    // per declaration (the plural noun of creatures with no count; "two or more of those creatures ..." is an intervening "if" of its own, parser/holes/cond.ts)
    if (ctx.toks[w]?.norm === 'creatures') {
      const f = controller === undefined ? { types: ['Creature'] } : { types: ['Creature'], controller };
      out.push({ end: w + 1, value: [{ ev: 'attacks', attacker: f as ObjectFilter, count: { op: '>=', value: 1 } } satisfies EventPattern], flags: ['batch'] });
    }
  }
  return out;
}

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
        if (s.batch) continue;
        if (nth !== undefined && nth >= 2) {
          if (change === 'put' && w[0] === 'is' && ctx.toks[k.end]?.norm === 'counter') out.push({ end: s.end, value: [{ ev: 'counters', change, kind, on: s.obj!, atLeast: nth } satisfies EventPattern] });
          continue;
        }
        out.push({ end: s.end, value: [{ ev: 'counters', change, ...(kind !== undefined ? { kind } : {}), on: s.obj! } satisfies EventPattern], ...(batch ? { flags: ['batch'] } : {}), ...(k.weak ? { weak: k.weak } : {}) });
      }
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

/** State triggers (CR 603.8): "you control no Islands", "you have no cards in hand". */
function stateEvents(ctx: HoleCtx, pos: number): Alt[] {
  const out: Alt[] = [];
  // FAST5X E21 (CR 603.8): also "there are four or more page counters on ~" (parser/holes/cond.ts#thereAre)
  const lead = anyPhraseAt(ctx, pos, [P('you control'), P("you don't control"), P('you have'), P('there are')]);
  if (lead < 0) return out;
  for (const c of ctx.call('Cond', pos)) out.push({ end: c.end, value: [{ ev: 'state', cond: c.value as Condition } satisfies EventPattern], ...(c.flags ? { flags: c.flags } : {}) });
  return out;
}

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
const W_ONE_OR_MORE_OPPONENTS = [P('one or more of your opponents'), P('one or more opponents')];
const OPPONENTS_DEALT: [string[], boolean | undefined][] = [[P('are dealt combat damage'), true], [P('are dealt noncombat damage'), false], [P('are dealt damage'), undefined]];
function opponentsDealtDamage(ctx: HoleCtx, pos: number): Alt[] {
  const out: Alt[] = [];
  for (const w of W_ONE_OR_MORE_OPPONENTS) {
    const s = phraseAt(ctx, pos, w);
    if (s < 0) continue;
    for (const [ws, combat] of OPPONENTS_DEALT) {
      const e = phraseAt(ctx, s, ws);
      if (e < 0 || (combat === false && w === W_ONE_OR_MORE_OPPONENTS[1])) continue; // T62's words ("one or more opponents are dealt noncombat damage") are T62's
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
const W_OPPONENTS_ATTACKED = P('one or more of your opponents are attacked');
function opponentsAttacked(ctx: HoleCtx, pos: number): Alt[] {
  const e = phraseAt(ctx, pos, W_OPPONENTS_ATTACKED);
  return e < 0 ? [] : [{ end: e, value: [{ ev: 'attacks', attacker: { types: ['Creature'] }, defender: 'opponent' } satisfies EventPattern], flags: ['batch', 'wholeBatch'] }];
}

const W_IS_CAST_FROM_EXILE = P('is cast from exile'); // std-control-1

export const event: HoleFn = (ctx, pos) => {
  const out: Alt[] = [...stepEvents(ctx, pos), ...youAttack(ctx, pos), ...playerAttacksWith(ctx, pos), ...counterEvents(ctx, pos), ...youPutCounters(ctx, pos), ...stateEvents(ctx, pos), ...ringEvents(ctx, pos), ...voteEvents(ctx, pos), ...opponentsDealtNoncombat(ctx, pos),
    ...sourceDamage(ctx, pos), ...opponentsDealtDamage(ctx, pos)]; // Cloud std-woe: sourceDamage; std-mkm: playerAttacksWith; std-rr: opponentsDealtDamage
  out.push(...opponentsAttacked(ctx, pos)); // CLOUD std-tmt
  // std-control-1 (CR 601.2a, 400.7): "~ is cast from exile" (Emrakul, the Exigent Doom's "until this card is cast from exile"): the card moves from exile to the stack,
  // which only casting it does (CR 601.2a); read as that zone change, whose event names the card it was in exile (the cast event names only the new stack object)
  if (ctx.toks[pos]?.kind === 'SELF') {
    const e = phraseAt(ctx, pos + 1, W_IS_CAST_FROM_EXILE);
    if (e >= 0) out.push({ end: e, value: [{ ev: 'zoneChange', subject: { self: true }, from: 'exile', to: 'stack' }] });
  }

  // object subjects: one or more subjects, one or more predicates
  for (const l of objectSubjectLists(ctx, pos)) {
    const walk = (p: number, preds: Pred[], depth: number): void => {
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
        const batch = l.subs.some((s) => s.batch);
        const flags = [...new Set([...l.subs.flatMap((s) => s.flags), ...(batch ? ['batch'] : [])])];
        out.push({ end: pr.end, value: patterns, ...(flags.length > 0 ? { flags } : {}) });
        if (depth < 3) { const or = phraseAt(ctx, pr.end, P('or')); if (or >= 0) walk(or, all, depth + 1); }
      }
    };
    walk(l.end, [], 0);
  }

  // Standard round 4, r4-trig (CR 115.1, 603.2; Loki, God of Mischief): "a player or permanent becomes the target of ...", "you or a permanent you control becomes the
  // target of ...": the player and the object are each an event (a player target, `player`; an object target)
  for (const [ws, pl, obj] of [[P('a player or permanent'), 'any', { zone: 'battlefield' }], [P('you or a permanent you control'), 'you', { controller: 'you', zone: 'battlefield' }]] as const) {
    const e = phraseAt(ctx, pos, ws);
    const b = e >= 0 ? anyPhraseAt(ctx, e, [P('becomes the target of')]) : -1;
    if (b >= 0) for (const by of stackSources(ctx, b)) {
      const extra = by.filter ? { by: by.filter } : {};
      out.push({ end: by.end, value: [{ ev: 'becomes', what: 'targeted', object: {}, player: pl, ...extra }, { ev: 'becomes', what: 'targeted', object: { ...obj }, ...extra }] });
    }
  }
  // Standard round 4, r4-trig (CR 121.2, 603.2; Lady Octopus, Inspired Inventor): "you draw your first or second card each turn": either of the two draws
  const fos = phraseAt(ctx, pos, P('you draw your first or second card each turn'));
  if (fos >= 0) out.push({ end: fos, value: [{ ev: 'draw', player: 'you', nth: 1 }, { ev: 'draw', player: 'you', nth: 2 }] });
  // Standard round 4, r4-trig (CR 305.1, 601.2a; Shadow of the Goblin): "you play a land or cast a spell from anywhere other than your hand": the zone is said once for
  // both events (playerOr makes no reading with a zone said by some predicates only)
  const plc = phraseAt(ctx, pos, P('you play a land or cast a spell from anywhere other than your hand'));
  if (plc >= 0) out.push({ end: plc, value: [{ ev: 'action', verb: 'playLand', actor: 'you', notFrom: 'hand' }, { ev: 'cast', player: 'you', spell: { not: { castFrom: 'hand' } } }] });
  // Standard round 4, r4-trig (CR 120.2, 510.2, 603.2c): "you're dealt [combat] damage" (the player predicates above, of "you")
  for (const [w, combat] of [[P("you're dealt combat damage"), true], [P('you are dealt combat damage'), true], [P("you're dealt damage"), false], [P('you are dealt damage'), false]] as const) {
    const e = phraseAt(ctx, pos, w);
    if (e >= 0) out.push({ end: e, value: [{ ev: 'damage', recipient: { player: 'you' }, ...(combat ? { combat: true } : {}) }] });
  }
  // player subjects
  for (const s of playerSubjects(ctx, pos)) {
    for (const pr of playerPredicates(ctx, s.end)) {
      const m = pr.make(s.player!);
      if (m !== null) out.push({ end: pr.end, value: [m], ...(pr.batch ? { flags: ['batch'] } : {}) });
      if (m !== null && pr.batch !== true) out.push(...playerOr(ctx, s.player!, pr.end, [m], saysFrom(ctx, s.end, pr.end), 0));
    }
  }
  return dedupeEvents(out);
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

