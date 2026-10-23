/**
 * FAST5 T76 (CR 608.2c, 111.1, 122.1): the discourse focus of a resolving ability, shared by the parser (parser/lower/anaphora.ts#focusAt) and the renderer
 * (render/steps.ts#clausesOf, render/refs.ts#candidateCheck) so the two never disagree.
 *
 * Oracle names the thing an instruction is about with a bare pronoun once the instruction before it made or worked on exactly that one thing: "Create a 1/1
 * Goblin creature token. It gains haste until end of turn. Sacrifice it at the beginning of the next end step." / "Put a +1/+1 counter on ~. It can't be
 * blocked this turn." / "Exile target nonland permanent. Return it ..." The focus after an instruction is
 *   - the token(s) or token copy it created;
 *   - the one card it looked at on top of one player's library (LOOK1, looksAtOneCard), or std-r8 revealed there (revealsOneCard);
 *   - the card(s) "reveal cards from the top of your library until you reveal ..." stopped at (r3-dig, op revealUntil; also from inside a `may`, keptFocus);
 *   - else the one named object it worked on (put counters on, removed counters from, tapped, untapped, moved, destroyed, sacrificed, or gave a continuous
 *     effect or a restriction; see WORKED_ON);
 *   - else nothing (every other instruction ends it).
 * LOOK3: a sentence whose condition says the card was not put somewhere ("If you don't put the card onto the battlefield, put it into your hand.") is about the card
 * the instruction before it would have moved, from inside its `if` and `may` (notPutMove): that card is the focus of the sentence's own instructions.
 * It decides between several compatible antecedents of a BARE pronoun only (never "that creature", never a player); it adds no antecedent and removes none, and
 * it is looked up only for the first instruction of a sentence that names no target of its own. There is no "nearest noun" rule: the previous sentence must have
 * been understood and must end with exactly such an instruction.
 */

type Rec = Record<string, unknown>;
const isRec = (v: unknown): v is Rec => typeof v === 'object' && v !== null && !Array.isArray(v);

/** The refs that name one object (a group, a union or a player is never a focus). */
const OBJECT_REFS: ReadonlySet<string> = new Set(['target', 'self', 'bound', 'event', 'attachedTo']);

/**
 * The field holding the one object an op works on. Anything not listed (damage, fight, attach, anything with two parties) leaves no focus. Cloud std-fin: revealing one
 * named card works on it too ("you may reveal it and put it into your hand": the card revealed is still the one the next instruction moves, CR 701.20a).
 */
const WORKED_ON: Readonly<Record<string, string>> = {
  putCounters: 'on', removeCounters: 'from', tap: 'what', untap: 'what', move: 'what', destroy: 'what', sacrifice: 'what', reveal: 'what',
};

/** Player references that always name exactly one player (the top card of each player's library is several cards, never "it"). */
const ONE_PLAYER_REFS: ReadonlySet<string> = new Set(['you', 'target', 'event', 'defending', 'active', 'controllerOf', 'ownerOf', 'anOpponent', 'linked', 'iterating', 'seat', 'costChosen']);

/** std-rs: does the player reference always name exactly one player (ONE_PLAYER_REFS)? */
export const namesOnePlayer = (ref: unknown): boolean => isRec(ref) && ONE_PLAYER_REFS.has(String(ref['ref']));

/**
 * LOOK1 (CR 701.20e, 608.2c): is the step a look at the top card of one player's library? Looking moves nothing (CR 701.20b), so that card is still on top of the
 * library, and it is what the next sentence's "it" or "that card" names: "Whenever ~ attacks, look at the top card of your library. If it's a land card, you may put it
 * onto the battlefield tapped." (the card, never the attacking object). Shared by the parser's discourse model (parser/lower/mentions.ts#producedBy) and the focus
 * (focusEffect) so the parser and the renderer never disagree. A look at several cards is a group instead (FAST5 T43).
 */
export function looksAtOneCard(step: unknown): boolean {
  if (!isRec(step) || step['op'] !== 'look' || !isRec(step['at'])) return false;
  const at = step['at'];
  return at['ref'] === 'topCards' && at['count'] === 1 && isRec(at['player']) && ONE_PLAYER_REFS.has(String(at['player']['ref']));
}

/** std-r8: a reveal of the top card of ONE player's library (as looksAtOneCard for a look). */
export function revealsOneCard(step: unknown): boolean {
  if (!isRec(step) || step['op'] !== 'reveal' || !isRec(step['what'])) return false;
  const w = step['what'];
  return w['ref'] === 'topCards' && w['count'] === 1 && isRec(w['player']) && ONE_PLAYER_REFS.has(String(w['player']['ref']));
}

export type FocusEffect =
  /** The instruction made the focus itself: the token(s) it created, or the one card it looked at (LOOK1), bound by its `as` name. */
  | { kind: 'makes' }
  /** The instruction worked on exactly this one named object, which is now the focus. */
  | { kind: 'object'; on: Rec };

/** The refs an instruction works on (see WORKED_ON), or null when one of them is not one named object or it works on nothing. */
function workedRefs(step: Rec): Rec[] | null {
  const out: Rec[] = [];
  const add = (v: unknown): boolean => {
    if (!isRec(v) || !OBJECT_REFS.has(String(v['ref']))) return false;
    out.push(v);
    return true;
  };
  const op = String(step['op']);
  if (op === 'delay' && Array.isArray(step['do'])) {
    // "Sacrifice it at the beginning of the next end step": the delayed instructions work on what they name
    for (const s of step['do']) {
      const r = isRec(s) ? workedRefs(s) : null;
      if (r === null) return null;
      out.push(...r);
    }
  } else if (op === 'effect' && Array.isArray(step['effects'])) {
    for (const e of step['effects']) {
      if (!isRec(e)) return null;
      if (e['s'] === 'continuous') { if (!add(e['affects'])) return null; }
      else if (e['s'] === 'restrict') { if (!add(e['subject'])) return null; }
      else return null;
    }
  } else if (Object.hasOwn(WORKED_ON, op)) {
    if (!add(step[WORKED_ON[op]!])) return null;
  } else return null;
  return out.length > 0 ? out : null;
}

/** r5-refs (CR 701.23a): the name a search for at most one card binds what it found to, as a bound ref; null for any other step. */
function searchedOne(step: Rec): Rec | null {
  const as = step['as'];
  return step['op'] === 'search' && step['max'] === 1 && typeof as === 'string' && step['each'] === undefined ? { ref: 'bound', name: as } : null;
}

/**
 * std-cardcopy-2 (CR 608.2d): the name a choice of exactly one object binds it to (one chooser, no per-player or in-turn choice, nothing random), as a bound ref; null
 * for any other step.
 */
export function chosenOne(step: Rec): Rec | null {
  const as = step['as'];
  const who = step['who'];
  return step['op'] === 'chooseObjects' && step['min'] === 1 && step['max'] === 1 && typeof as === 'string' && isRec(who) && who['ref'] === 'you'
    && step['perPlayer'] === undefined && step['startingWith'] === undefined && step['random'] === undefined && step['groupLimit'] === undefined
    ? { ref: 'bound', name: as } : null;
}

/**
 * std-promote-4 (CR 608.2c, 122.1; design 6.4, coordinator A's decision Q5 of 2026-10-21): an instruction whose only effect is putting counters on you ("You get
 * {E}{E}", "you get an experience counter") works on no object, so it leaves the focus of the instruction before it in place: "Whenever ~ attacks, create a tapped and
 * attacking token that's a copy of ... You get {E}{E}. At the beginning of the next end step, sacrifice that token unless you pay an amount of {E} equal to its mana
 * value." (Satya, Aetherflux Genius: "its" is the token). Only `you`, unconditioned: counters on a target player, on each opponent or on an object end the focus as before.
 */
export function keepsFocus(step: unknown): boolean {
  return isRec(step) && step['op'] === 'putCounters' && step['guard'] === undefined && isRec(step['on']) && step['on']['ref'] === 'you' && Object.keys(step['on']).length === 1;
}

/** What an instruction does to the focus (see the file comment), or null when it ends it. */
export function focusEffect(step: unknown): FocusEffect | null {
  if (!isRec(step) || step['guard'] !== undefined) return null;
  const op = step['op'];
  if (op === 'createToken' || (op === 'copy' && step['result'] === 'token')) return { kind: 'makes' };
  // the one card an instruction took from the top of a library and named ("Exile the top card of your library. You may play it": parser/lower/anaphora.ts#impulseIdiom);
  // Cloud std-fin: named or not yet ("Exile the top card of your library. You may cast it.": the parser names it when a pronoun binds it, bind(); the renderer reads the name)
  const what = step['what'];
  if (op === 'move' && isRec(what) && what['ref'] === 'topCards' && what['count'] === 1) return { kind: 'makes' };
  // LOOK1: the card looked at, left on top of the library (Cloud std-fin wrote the same rule for any player's library; one card of ONE player's library only, looksAtOneCard)
  if (looksAtOneCard(step)) return { kind: 'makes' };
  // std-r8 (CR 701.20a, 608.2c; as LOOK1): the one card a player revealed on top of one library, which stays there ("Reveal the top card of your library. If it's a
  // creature card, put it onto the battlefield.")
  if (revealsOneCard(step)) return { kind: 'makes' };
  // r3-dig (CR 701.20a, 608.2c): the card(s) "reveal cards from the top of your library until you reveal a land card" stopped at, still in the library
  if (op === 'revealUntil') return { kind: 'makes' };
  // std-rq (CR 406.1, 608.2c; as revealUntil): the card "exile cards from the top of your library until you exile a nonland card" stopped at ("You may cast it ...")
  if (op === 'exileUntil') return { kind: 'makes' };
  // Standard round 5, r5-refs (CR 701.23a, 608.2c): a search for at most one card that names what it found ("search your library for an artifact card and reveal it")
  // leaves the discourse on that card: "Put it onto the battlefield if its mana value is 2 or less. Otherwise, put it into your hand." (the object itself is "~" there)
  const found = searchedOne(step);
  if (found !== null) return { kind: 'object', on: found };
  // std-cardcopy-2 (CR 608.2c, 608.2d): a choice of exactly one object that names it ("choose a nonlegendary creature that saddled it this turn and create a tapped and
  // attacking token that's a copy of it") leaves the discourse on the chosen object, never on the object whose ability it is; std-exile-play-1-2 (CR 608.2c): so does
  // "You choose one of those cards. That player exiles it." (Taster of Wares). One rule for both: a named object, not `makes` (keptFocus keeps it after an `if` / a
  // `may`), and only a choice of one object by you (a choice by another player, for each player, in turn or at random is no focus)
  const chosen = chosenOne(step);
  if (chosen !== null) return { kind: 'object', on: chosen };
  const refs = workedRefs(step);
  return refs !== null && refs.every((r) => JSON.stringify(r) === JSON.stringify(refs[0])) ? { kind: 'object', on: refs[0]! } : null;
}

/**
 * LOOK3 (CR 608.2c, 701.20e): the move that "If you don't put the card onto the battlefield, put it into your hand." names (templates eff.look3.*): the last instruction
 * of the instruction right before that sentence (`step`), reached through the `if`s (no `else`) and the controller's own `may`s (no `otherwise`) that only decide
 * whether it happens, when it moves ONE named object (a card an earlier instruction bound, such as the card looked at, or a target) to `zone`. "The card" and "it" in
 * the condition are that object, and the condition holds when that move was not performed: declined, or never offered because the condition before it was false. It is
 * no "otherwise", which answers the condition alone. Shared by the parser (lower/conditions.ts#resolveDid names the move, lower/anaphora.ts#notPutFocus makes its object
 * the focus of the sentence) and the renderer (render/steps.ts#clausesOf) so the two never disagree. Null for anything else.
 */
export function notPutMove(step: unknown, zone: unknown): Rec | null {
  let cur = step;
  while (isRec(cur) && cur['guard'] === undefined) {
    const who = cur['who'];
    const list = cur['op'] === 'if' && cur['else'] === undefined ? cur['then'] : cur['op'] === 'may' && cur['otherwise'] === undefined && isRec(who) && who['ref'] === 'you' ? cur['do'] : undefined;
    if (list === undefined) {
      const to = cur['to'];
      const what = cur['what'];
      return cur['op'] === 'move' && cur['until'] === undefined && isRec(to) && to['zone'] === zone && isRec(what) && (what['ref'] === 'bound' || what['ref'] === 'target') ? cur : null;
    }
    if (!Array.isArray(list) || list.length === 0) return null;
    cur = list[list.length - 1];
    // std-rx31 (CR 608.2c, 611.2c): "you may put it onto the battlefield and it gains haste until end of turn": a lasting effect on exactly the object the move right
    // before it moved is part of putting it there, so the move is still the instruction the option ends with
    const mv = list.length >= 2 ? list[list.length - 2] : undefined;
    if (isRec(cur) && isRec(mv) && cur['op'] === 'effect' && cur['guard'] === undefined && mv['op'] === 'move' && Array.isArray(cur['effects'])
      && cur['effects'].every((e) => isRec(e) && e['s'] === 'continuous' && JSON.stringify(e['affects']) === JSON.stringify(mv['what']))) cur = mv;
  }
  return null;
}

/**
 * LOOK3: the zone of the move a condition of an `if` step says was not performed ("If you don't put the card into your hand, ..."), before or after lower/conditions.ts
 * named that move: a negated `did` with `to` and no `which` (parser/templates/zz-cloud/look3.json). Undefined for any other step.
 */
export function notPutZone(step: unknown): string | undefined {
  const c = isRec(step) && step['op'] === 'if' && step['guard'] === undefined ? step['cond'] : undefined;
  return isRec(c) && c['cond'] === 'did' && c['not'] === true && c['which'] === undefined && typeof c['to'] === 'string' ? c['to'] : undefined;
}

/**
 * Cloud std-fin (CR 608.2c): the focus an instruction leaves from inside a condition or an option, when what it worked on is a NAME an earlier instruction bound (the one card
 * looked at): "Look at the top card of your library. If it's a land card, you may put it onto the battlefield. If you don't put the card onto the battlefield, put it into
 * your hand." That card exists whether or not the condition held and the option was taken, so the discourse is still about it after the `if` / the `may` (a token the
 * instruction CREATED, or an object it moved by a target handle, has no such name and keeps the rule above: no focus). `step` is the `if` (no `else`, no guard) or the `may`
 * (no `otherwise`): its last instruction, through any number of such boxes, decides. Null for anything else.
 */
export function keptFocus(step: unknown): FocusEffect | null {
  let cur: unknown = step;
  let depth = 0;
  for (;;) {
    if (!isRec(cur) || cur['guard'] !== undefined) return null;
    const list = cur['op'] === 'if' && cur['else'] === undefined ? cur['then'] : cur['op'] === 'may' && cur['otherwise'] === undefined ? cur['do'] : undefined;
    if (list === undefined) break;
    if (!Array.isArray(list) || list.length === 0) return null;
    cur = list[list.length - 1];
    depth++;
  }
  if (depth === 0) return null;
  // r3-dig (CR 701.20a, 608.2c): the card(s) "you may reveal cards from the top of your library until you reveal a creature card" stopped at, named by the step's `as`;
  // the option not taken binds that name to nothing (effects/handlers/control.ts#declinedNames), so "that card" then names nothing
  if (isRec(cur) && cur['op'] === 'revealUntil' && cur['guard'] === undefined && typeof cur['as'] === 'string') return { kind: 'object', on: { ref: 'bound', name: cur['as'] } };
  const fx = focusEffect(cur);
  return fx !== null && fx.kind === 'object' && fx.on['ref'] === 'bound' ? fx : null;
}

/** Filter fields that say what an object IS (card types, controller ...), which a pump, a grant or an anthem of layers 6 and 7 never changes. */
const STATIC_FILTER_FIELDS: ReadonlySet<string> = new Set(['types', 'subtypes', 'supertypes', 'notTypes', 'notSubtypes', 'controller', 'owner', 'token', 'nontoken', 'other', 'zone']);

/**
 * The `affects` of the only continuous effect of an `effect` step, when it is a described group whose members cannot change by what the effect does (pumps of
 * layer 7c and grants of layer 6 leave a description by types, controller or token-ness alone as it was; Cloud std-eoe: a control change of layer 2, a description
 * with no controller): "Creatures you control get +1/+1 until end of turn.
 * Untap them." names the same group again (CR 608.2c). Null for anything else. Shared by the parser (lower/mentions.ts) and the renderer (render/steps.ts).
 */
export function grantedGroup(step: unknown): Rec | null {
  if (!isRec(step)) return null;
  const effects = step['effects'];
  if (step['op'] !== 'effect' || !Array.isArray(effects) || effects.length !== 1) return null;
  const e = effects[0];
  if (!isRec(e) || e['s'] !== 'continuous' || !isRec(e['affects']) || e['affects']['ref'] !== 'each' || !isRec(e['affects']['filter'])) return null;
  const filter = e['affects']['filter'];
  // std-tla (CR 202.3, 613.1f, 613.4c): a mana value comes from the mana cost, which no ability of layers 6 and 7c changes, so "Each creature with mana value X or less
  // loses all abilities until end of turn. Destroy those creatures." names the same group again too
  if (!Object.keys(filter).every((k) => filter[k] === undefined || STATIC_FILTER_FIELDS.has(k) || k === 'manaValue')) return null;
  const mods = e['mods'];
  // Cloud std-eoe (CR 613.1b, 608.2c): a change of control too ("Gain control of all creatures until end of turn. Untap them."), while the description names no
  // controller (who controls them is what the effect changes)
  const control = (m: Rec): boolean => m['layer'] === 2 && filter['controller'] === undefined;
  if (!Array.isArray(mods) || mods.length === 0 || !mods.every((m) => isRec(m) && (m['layer'] === 6 || m['layer'] === '7c' || control(m)))) return null;
  return e['affects'];
}

/**
 * Standard round 4, r4-refs (CR 608.2c, 121.1): the group a draw of one card per object counts ("Draw a card for each creature you control with a +1/+1 counter on
 * it."), as `{ref:'each', filter}`, when the description names permanents only (no zone other than the battlefield): drawing changes none of them, so "Those
 * creatures gain indestructible until end of turn." names the same group again. Null for anything else. Shared by the parser (lower/mentions.ts) and the
 * renderer (render/fold-r4refs.ts).
 */
export function drawnPerObject(step: unknown): Rec | null {
  if (!isRec(step) || step['op'] !== 'draw' || !isRec(step['count']) || step['guard'] !== undefined) return null;
  const n = step['count'];
  if (n['q'] !== 'count' || !isRec(n['of']) || n['of']['ref'] !== 'each' || !isRec(n['of']['filter'])) return null;
  const zone = n['of']['filter']['zone'];
  if (zone !== undefined && zone !== 'battlefield') return null;
  return n['of'];
}

/**
 * CLOUD std-tmt (CR 611.2c, 608.2c, 613.1b): the `affects` of the only continuous effect of an `effect` step that changes control of a described group ("Gain control
 * of all artifacts your opponents control until end of turn. Untap them."): the set is locked as the effect begins and the description no longer fits it afterwards (the
 * objects change controller), so a later "them" names the objects the step bound under its `as` (effects/handlers/lasting.ts), never the description read again.
 * Null for anything else. Shared by the parser (lower/mentions.ts) and the renderer (render/steps-lasting.ts).
 */
export function controlledGroup(step: unknown): Rec | null {
  if (!isRec(step)) return null;
  const effects = step['effects'];
  if (step['op'] !== 'effect' || !Array.isArray(effects) || effects.length !== 1) return null;
  const e = effects[0];
  if (!isRec(e) || e['s'] !== 'continuous' || !isRec(e['affects']) || e['affects']['ref'] !== 'each' || !isRec(e['affects']['filter'])) return null;
  const mods = e['mods'];
  if (!Array.isArray(mods) || mods.length === 0 || !mods.every((m) => isRec(m) && m['layer'] === 2 && m['controller'] !== undefined)) return null;
  return e['affects'];
}
