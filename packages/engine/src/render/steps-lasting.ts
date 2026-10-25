/**
 * Lasting effects, delayed and reflexive triggers, and the game itself (WP2): effect, delay, reflexive, extraTurn, extraPhase, endTurn, winGame,
 * loseGame, createEmblem, rollDie, flipCoin, clash, designate, action (CR 611, 603.7, 603.12, 500.7, 104, 114, 705, 706, 701).
 */
import type { EffectStep, EventPattern, KeywordActionName, ObjectFilter, ObjRef, PlayerRef, Quantity, RestrictionDef } from '../types/ability';
import { acting, plain, type Clause } from './clause';
import { doubledBy, doubledText } from './double';
import { K } from './kernel';
import { identityOf, isPlayerRef, markTriggerRoles, spellOrPermanentOf, withSubjects } from './refs';
import { bind, byPlayer, infoOfRef, isComputed, movedCondFocus, timesWords, whereX, type StepOf } from './steps-util';
import { gainControlWhileAttached, playerCantAttackYou } from './fold-stdcombat1';
import { continuousHave, ptPredicate } from './mods';
import { quotedAbility, quotedListItem } from './quote';
import { attackOrBlockIfAble, damageUnpreventable, damageUnpreventableText, graveyardPermitsSentence, lastingCants, lastingCombatToAndBy, sharedEffectSubject, topPermitsSentence } from './stat';
import { absorb, cloneState, nestedState, objKey, playerKey, withVariants, type RenderState } from './state';
import { playerCantAttack, playerCantAttackText } from './fold-trek8';
import { possessiveStep } from './turn';
import { controlledGroup } from '../model/focus';
import { alt, firstAlt, joinList, NoRenderer, numWord, pluralize } from './text';

const hasBreak = (text: string): boolean => /\. /.test(firstAlt(text));

/**
 * r4-repl (CR 614.1a, 608.2n, 611.2c): "Whenever you cast a multicolored instant or sorcery spell from your hand, exile that spell instead of putting it into your
 * graveyard as it resolves." (Lilah, Undefeated Slickshot; the template eff.r4repl.castSpell.exileAsItResolves): a replacement of the move of the spell the cast
 * trigger names from the stack to a graveyard as it resolves (`cause: 'resolve'`), sending it to exile. null for anything else.
 */
function spellExiledAsItResolves(s: StepOf<'effect'>, st: RenderState): string | null {
  if (s.effects.length !== 1 || s.duration.d !== 'permanent' || s.as !== undefined) return null;
  const e = s.effects[0]!;
  if (e.s !== 'replace' || e.condition !== undefined || e.optional === true || e.shield !== undefined || e.selfReplacement === true) return null;
  const ev = e.replaces;
  if (ev.ev !== 'zoneChange' || ev.from !== 'stack' || ev.to !== 'graveyard' || ev.cause !== 'resolve' || ev.byOpponent !== undefined || JSON.stringify(ev.subject) !== JSON.stringify({ is: { ref: 'event', role: 'spell' } })) return null;
  const { then, ...body } = e.body as Extract<typeof e.body, { b: 'modify' }>;
  if (JSON.stringify(body) !== JSON.stringify({ b: 'modify', destination: { zone: 'exile' } })) return null;
  if ((st.trigger ?? []).length === 0 || !(st.trigger ?? []).every((p) => p.ev === 'cast')) return null;
  const head = 'exile that spell instead of putting it into your graveyard as it resolves';
  if (then === undefined) return head;
  // std-exile-play-2-2 (CR 614.1a, 122.1, 400.7): "exile that card with a dream counter on it instead of putting it into your graveyard as it resolves" (Goliath
  // Daydreamer): one counter put on the card it became in exile, once it was exiled this way (effects/bodies/m5.ts#thenAfterMove)
  const put = then.do.length === 1 ? then.do[0]! : undefined;
  if (put?.op === 'putCounters' && put.count === 1 && typeof put.kind === 'string' && JSON.stringify(put.on) === JSON.stringify({ ref: 'bound', name: then.as })
    && Object.keys(put).every((k) => ['op', 'on', 'kind', 'count'].includes(k))) {
    return `exile that card with ${/^[aeiou]/.test(put.kind) ? 'an' : 'a'} ${put.kind} counter on it instead of putting it into your graveyard as it resolves`;
  }
  // std-rB (CR 614.1a, 608.2c, 400.7; parser/lower/conditions.ts#absorbIntoReplacement): "... as it resolves. If you do, it becomes plotted." (Lilah, Undefeated
  // Slickshot): what happens once the spell was exiled this way, to the card it became in exile ("it")
  bind(st, then.as, { nouns: ['card'], plural: false });
  return `${head}. if you do, ${K.steps(then.do, st)}`;
}

/**
 * r4-repl (CR 614.1c, 614.12, 611.2c): an `effect` step whose one effect replaces the entering of the spell a cast trigger names (`subject: {is: {ref: 'event',
 * role: 'spell'}}`, fixed as the effect is created) with an entering body of one kind of counters: "that creature enters with an additional +1/+1 counter on it",
 * "... for each Dog and/or Wolf you control", "that creature enters with X additional +1/+1 counters on it, where X is ...". Only a creature spell's cast
 * ("that creature"); null for anything else.
 */
function spellEntersWith(s: StepOf<'effect'>, st: RenderState): string | null {
  if (s.effects.length !== 1 || s.duration.d !== 'permanent' || s.as !== undefined) return null;
  const e = s.effects[0]!;
  if (e.s !== 'replace' || e.condition !== undefined || e.optional === true || e.shield !== undefined || e.selfReplacement === true) return null;
  const ev = e.replaces;
  if (ev.ev !== 'zoneChange' || [ev.to].flat().join() !== 'battlefield' || ev.from !== undefined || JSON.stringify(ev.subject) !== JSON.stringify({ is: { ref: 'event', role: 'spell' } })) return null;
  const b = e.body;
  if (b.b !== 'enters' || Object.keys(b).some((k) => k !== 'b' && k !== 'counters') || b.counters?.length !== 1) return null;
  const casts = (st.trigger ?? []).every((p) => p.ev === 'cast' && (p.spell?.types ?? []).length === 1 && p.spell!.types![0] === 'Creature');
  if ((st.trigger ?? []).length === 0 || !casts) return null;
  const { kind, count } = b.counters[0]!;
  if (count === 1) return `that creature enters with an additional ${kind} counter on it`;
  if (typeof count === 'object' && count.q === 'count' && count.of.ref === 'each' && 'filter' in count.of) {
    return `that creature enters with an additional ${kind} counter on it for each ${K.np(count.of.filter, st, { det: 'none', forEach: true })}`;
  }
  if (typeof count === 'object') return `that creature enters with X additional ${kind} counters on it, where X is ${K.qty(count, st)}`;
  return null;
}

/**
 * FAST5 T45: the delayed trigger "when you next cast a spell this turn" (no restriction on the spell) that copies the spell once: nothing else on the event, the
 * copy, or the duration (triggers/delayed.ts, `once`). Anything more stays in the "when you next cast ..." wording.
 */
function isNextSpellCopy(s: StepOf<'delay'>, c: StepOf<'copy'>): boolean {
  if (s.when.at !== 'event' || s.duration?.d !== 'endOfTurn') return false;
  const ev = s.when.event as unknown as Record<string, unknown>;
  const keys = Object.keys(ev).sort().join(',');
  const copyKeys = Object.keys(c).filter((k) => k !== 'newTargets' && k !== 'span' && k !== 'as').sort().join(',');
  const what = c.what as unknown as Record<string, unknown>;
  return keys === 'ev,player' && ev['ev'] === 'cast' && ev['player'] === 'you' && copyKeys === 'op,result,what,who' && c.result === 'spell' && c.who.ref === 'you' && what['ref'] === 'event' && what['role'] === 'spell';
}

/**
 * r5-refs: a delayed trigger that waits for an event every time until its controller's next turn ("Until your next turn, whenever a creature attacks you, ..."); std-rt
 * (CR 603.7b, 611.2a): or until the end of that turn ("Until the end of your next turn, whenever you cast a spell, ...", Season of the Bold). The leading words, or null.
 */
function untilYourNextTurn(s: StepOf<'delay'>): string | null {
  const d = s.duration;
  if (s.when.at !== 'event' || s.once === true || d === undefined) return null;
  if (d.d === 'untilNextTurn' && d.whose.ref === 'you') return 'until your next turn';
  if (d.d === 'endOfNextTurn' && d.whose.ref === 'you') return 'until the end of your next turn';
  return null;
}

/** "at the beginning of the next end step" / "at end of combat" / "when ~ leaves the battlefield this turn". */
/** r4-fxb: the steps an `extraStep` may add, as Oracle names them before "step". */
const EXTRA_STEP_WORDS: Partial<Record<string, string>> = { upkeep: 'upkeep', draw: 'draw', end: 'end', beginCombat: 'beginning of combat' };

function delayedLead(s: StepOf<'delay'>, st: RenderState): string {
  const w = s.when;
  const limited = s.duration !== undefined && s.duration.d !== 'permanent';
  // r5-refs (CR 603.7b, 611.2a): "Until your next turn, whenever ..." waits for every such event until the controller's next turn begins (core/durations.ts#expireAtTurnStart);
  // it is only ever written in front of its effect (the delay renderer below)
  const nextTurn = untilYourNextTurn(s);
  if (nextTurn !== null) return `${nextTurn}, whenever ${K.events([(w as { event: EventPattern }).event], st, 'present', { batch: s.batch === true })}`;
  // CR 603.7b: a stated duration ("this turn") is the only way for a delayed trigger to trigger more than once, so it is part of the event's words
  if (limited && ((w.at !== 'event' && w.at !== 'step') || s.duration!.d !== 'endOfTurn')) throw new NoRenderer(`duration ${s.duration!.d} on a delayed trigger`);
  // r4-fxb (CR 603.7b, 506.1): "At the beginning of each combat this turn, ...": a step trigger that lasts the turn fires at each beginning of combat step of it,
  // the added combat phases' too (triggers/delayed.ts#collectDelayed); only that step, for no particular player
  if (limited && w.at === 'step') {
    // std-library-1 (CR 603.7b, 506.1, 507.1): "At the beginning of the next combat phase this turn, ..." (Feral Encounter): the first beginning of combat step after the
    // trigger was created, this turn only, once (parser template dl.stdlib1.nextCombat.thisTurn.lead)
    if (w.step === 'beginCombat' && w.whose === undefined && w.next === true && w.turn === undefined && s.once === true) return alt('at the beginning of the next combat phase this turn', 'at the beginning of the next combat this turn'); // trek-8: Oracle also prints it without "phase" (The Wrath of Khan)
    if (w.step !== 'beginCombat' || w.whose !== undefined || w.next === true || w.turn !== undefined || s.once === true) throw new NoRenderer('a step trigger with a duration other than "each combat this turn"');
    return 'at the beginning of each combat this turn';
  }
  switch (w.at) {
    case 'step':
      if (w.step === 'endCombat') return alt('at end of combat', 'at the end of combat');
      // FAST5 T36 (CR 500.7, 603.7a): the end step of the turn right after this one, "that turn" once an extra turn was taken
      if (w.turn === 'next') {
        // w8-followups (CR 500.9, 500.10, 603.7a): T3's "at the beginning of the next turn's upkeep" is the upkeep of the turn after this one, not an additional upkeep
        // step added to this turn after the trigger was created
        if (w.step === 'upkeep' && w.next === true && w.whose === undefined) return "at the beginning of the next turn's upkeep";
        if (w.step !== 'end' || w.whose !== undefined) throw new NoRenderer('a delayed trigger of the next turn other than its end step or upkeep');
        return "at the beginning of that turn's end step";
      }
      // r4-fxz (CR 603.7a, 513.1): the end step of your next turn (a later turn, never this one)
      if (w.turn === 'later') {
        if (w.step !== 'end' || w.whose !== 'you' || w.next !== undefined) throw new NoRenderer('a delayed trigger of a later turn other than the end step on your next turn');
        return 'at the beginning of the end step on your next turn';
      }
      // T3 (push wave): a delayed upkeep trigger fires at the first upkeep after the step it was created in (triggers/delayed.ts#fires), "the next upkeep" (CR 603.7a,
      // 503.1). w8-followups: not "the next turn's upkeep", which T3 now builds with `turn: 'next'`: the two differ when an additional upkeep step is added to this
      // turn after the trigger was created (CR 500.9, 500.10)
      if (w.step === 'upkeep' && w.next === true && (w.whose === undefined || w.whose === 'any')) return 'at the beginning of the next upkeep';
      // r5-fxb (CR 505.1, 603.7a): "at the beginning of your next main phase": either main phase
      if (w.anyMain === true) {
        if (w.step !== 'main1' || w.next !== true || w.whose !== 'you' || w.turn !== undefined) throw new NoRenderer('a delayed main phase trigger other than "your next main phase"');
        return 'at the beginning of your next main phase';
      }
      return `at the beginning of ${possessiveStep(w.step, w.whose, st, w.next === true)}`;
    case 'endOfCombat': return alt('at end of combat', 'at the end of combat');
    case 'event': {
      let ev = K.events([w.event], st, 'present', { batch: s.batch === true });
      // FAST5 T45 (CR 603.7b): a delayed trigger that waits for the NEXT event of the turn and then ends: "when you next cast an instant or sorcery spell this turn"
      if (s.once === true) {
        // r5-mech (CR 603.7b, 702.177a): also "when you next activate an exhaust ability that isn't a mana ability this turn" (Pit Automaton)
        // std-r9 (CR 603.7b, 508.1, 603.2c): "when you next attack this turn" (All-Out Assault), the next declaration of attackers by you, one occurrence
        if (limited && s.batch === true && JSON.stringify(w.event) === JSON.stringify({ ev: 'attacks', attacker: { controller: 'you' }, count: { op: '>=', value: 1 } })) ev = 'you next attack';
        // std-rx32 (CR 603.7c): "When you lose control of that Equipment this turn" (Stolen Uniform): a "when" of one object's change of control, once
        else if (limited && w.event.ev === 'controlChange' && ev.startsWith('you lose control of ')) return `when ${ev} this turn`;
        else {
          const verb = ev.startsWith('you cast ') ? 'cast' : ev.startsWith('you activate an exhaust ability') ? 'activate' : null;
          if (!limited || verb === null) throw new NoRenderer('a once-only delayed trigger other than "when you next cast / activate / attack ... this turn"');
          ev = `you next ${verb} ${ev.slice(`you ${verb} `.length)}`;
        }
      }
      const tail = limited ? ' this turn' : '';
      return `${alt('when', 'whenever')} ${ev}${tail}`;
    }
  }
}

const ACTION_ACTOR: Partial<Record<KeywordActionName, (n: string | null, arg: string | null) => string>> = {
  investigate: () => 'investigate',
  proliferate: () => 'proliferate',
  populate: () => 'populate',
  learn: () => 'learn',
  recruit: () => 'recruit', // FAST5X E18 (reminder text)
  discover: (n) => `discover ${n ?? 'X'}`,
  // CR 701.47a: `arg` is the subtype the Army gets, singular (keywords/actions/tokens.ts#AMASS); Oracle writes it plural ("amass Orcs 2", CR 701.47d)
  amass: (n, arg) => `amass ${arg ? `${pluralize(arg)} ` : ''}${n ?? 'X'}`,
  manifestDread: () => 'manifest dread',
  venture: () => 'venture into the dungeon',
  timeTravel: () => 'time travel',
  planeswalk: () => 'planeswalk',
  setInMotion: () => 'set a scheme in motion',
  abandon: () => 'abandon this scheme',
  assemble: () => 'assemble a Contraption',
  harness: () => 'harness ~',
  openAttraction: () => 'open an Attraction',
  rollToVisit: () => 'roll to visit your Attractions',
  clash: () => 'clash with an opponent',
  vote: () => 'vote',
  cascade: () => 'cascade',
  forage: () => 'forage',
  collectEvidence: (n) => `collect evidence ${n ?? 'X'}`,
  blight: (n) => `blight ${n ?? 'X'}`,
  endure: (n) => `endure ${n ?? 'X'}`,
  // FAST5X E11 (CR 701.4a): "behold an Elf" (`arg` the subtype, keywords/actions/native.ts#BEHOLD)
  behold: (_n, arg) => (arg === undefined || arg === null ? 'behold a card' : `behold ${/^[aeiou]/i.test(arg) ? 'an' : 'a'} ${arg}`),
  waterbend: (n) => `waterbend {${n ?? 'X'}}`,
  airbend: (n) => `airbend ${n ?? 'X'}`,
  earthbend: (n) => `earthbend ${n ?? 'X'}`,
  // FAST5 MX6: "empower Jace 2" (`arg` the planeswalker type, keywords/actions/bending.ts#EMPOWER)
  empower: (n, arg) => `empower ${arg ?? 'Jace'} ${n ?? 'X'}`,
  adapt: (n) => `adapt ${n ?? 'X'}`,
  monstrosity: (n) => `monstrosity ${n ?? 'X'}`,
  bolster: (n) => `bolster ${n ?? 'X'}`,
  support: (n) => `support ${n ?? 'X'}`,
  fabricate: (n) => `fabricate ${n ?? 'X'}`,
  incubate: (n) => `incubate ${n ?? 'X'}`,
  manifest: () => 'manifest the top card of your library',
  cloak: () => 'cloak the top card of your library',
};

/** The actions whose template prints `n` itself ("amass 2", "adapt 3"); every other action says "twice" or "N times" after it (CR 701). */
const PRINTS_N = new Set<KeywordActionName>(['discover', 'amass', 'collectEvidence', 'blight', 'endure', 'waterbend', 'airbend', 'earthbend', 'adapt', 'monstrosity', 'bolster', 'support', 'fabricate', 'incubate', 'empower']);

/** The actions whose computed N Oracle writes "X, where X is ..." (CR 107.3). */
// FAST5X E16: "amass Goblins X, where X is that excess damage" (CR 701.47a, 107.3)
const WHERE_X_ACTIONS = new Set<KeywordActionName>(['discover', 'earthbend', 'endure', 'empower', 'amass', 'connive', 'incubate' /* p2-misc-3: CR 701.53a */]); // cloud r3-mech: connive X, where X is ... (CR 701.50a)

/** The vote nouns: what "each <noun> with the most votes or tied for most votes" may name after a vote for objects (CR 701.38a). */
const VOTE_NOUNS = ['permanent', 'creature', 'card', 'artifact', 'enchantment', 'land', 'planeswalker'];

/**
 * M12-3 (CR 701.38a-b): a vote. "Starting with <who>, each player votes for <choices>": words ("carnage or homage", "blue, black, red, or green"), an
 * object of a set ("a nonland permanent you don't control"), or a player ("a player", "an opponent"). Its `as` names the objects or players with the most
 * votes or tied for most votes: "each permanent with the most votes or tied for most votes" (an anaphor's whole phrase, RefInfo.alts).
 */
function voteText(s: StepOf<'action'>, st: RenderState): string {
  if (s.n !== undefined || s.arg !== undefined) throw new NoRenderer('vote with a number or an argument');
  const who = s.who.ref === 'you' ? 'you' : K.player(s.who, st, 'object').text;
  let what: string;
  if (s.choices !== undefined) {
    if (s.subject !== undefined || s.choices.length < 2) throw new NoRenderer('vote for words with a subject, or fewer than two words');
    const c = s.choices;
    what = c.length === 2 ? `${c[0]} or ${c[1]}` : `${c.slice(0, -1).join(', ')}, or ${c[c.length - 1]}`;
  } else {
    const r = s.subject as { ref?: string; who?: string; filter?: ObjectFilter } | undefined;
    if (r?.ref === 'each' && r.who === 'player') what = 'a player';
    else if (r?.ref === 'each' && r.who === 'opponent') what = 'an opponent';
    else if (r?.ref === 'each' && r.filter !== undefined && r.who === undefined) what = K.np(r.filter, st, { det: 'a' });
    else throw new NoRenderer('vote for something other than words, a set of objects, a player or an opponent');
    const players = r.who !== undefined;
    const nouns = players ? ['player'] : VOTE_NOUNS;
    bind(st, s.as, { nouns, plural: true, ...(players ? { player: true } : {}), alts: nouns.map((n) => `each ${n} with the most votes or tied for most votes`) });
  }
  return `starting with ${who}, each player votes for ${what}`;
}

/** Actions an object performs: "X explores", "X connives". */
const ACTION_SUBJECT: Partial<Record<KeywordActionName, [string, string]>> = {
  explore: ['explores', 'explore'],
  connive: ['connives', 'connive'],
  // FAST5 MX6: "it endures 2" (CR 701.63a: a permanent is instructed to endure)
  endure: ['endures', 'endure'],
};

/** Actions written as an instruction about an object: "goad X", "suspect X", "double the power and toughness of X". */
const ACTION_OBJECT: Partial<Record<KeywordActionName, (obj: string, n: string | null, arg: string | null) => string>> = {
  goad: (o) => `goad ${o}`,
  detain: (o) => `detain ${o}`,
  suspect: (o) => `suspect ${o}`,
  cycle: (o) => `cycle ${o}`,
  transmute: (o) => `transmute ${o}`,
  meld: (o, _n, arg) => `meld ${o}${arg ? ` with ${arg}` : ''}`,
  doublePT: (o) => `double the power and toughness of ${o}`,
  // FAST5 T65 (CR 701.10e): a set named before ("among one, two, or three target creatures") is also "each of those creatures"
  doubleCounters: (o, _n, arg) => `double the number of ${arg ?? '+1/+1'} counters on ${o.includes('those creatures') ? alt(o, 'each of those creatures') : o}`,
  // cloud std-spm (CR 701.10e): every kind of counter the object has
  doubleEachKind: (o) => `double the number of each kind of counter on ${o}`,
  // r5-refs (CR 122.6): one more counter of each kind; the holder is named again by its demonstrative ("target permanent or player" ... "that permanent or player")
  anotherOfEachKind: (o) => `for each kind of counter on ${o}, give ${o.includes('target ') ? o.replaceAll('target ', 'that ') : o} another counter of that kind`,
  manifest: (o) => `manifest ${o}`,
  cloak: (o) => `cloak ${o}`,
  // FAST5X E10: "airbend target nonland permanent" (CR 701.65a: the objects are named after the word)
  airbend: (o) => `airbend ${o}`,
  // FAST5X E28 (CR 701.43a): "exert target creature you control": the player exerts the permanent (Oracle never writes "it exerts")
  exert: (o) => `exert ${o}`,
  // trek-1 (Star Trek reminder text; CR 701, number unverified): "assimilate target creature card from an opponent's graveyard"
  assimilate: (o) => `assimilate ${o}`,
};

/**
 * FAST5 T41 (CR 611.2a, 611.2c): "Until end of turn, target creature you control gets +1/+1 and target creature an opponent controls gets -1/-1": two P/T
 * changes of two targets with one duration said once, in front (also each with its own, as the effects print apart). Null for anything else.
 */
function pumpPair(s: StepOf<'effect'>, st: RenderState): string | null {
  if (s.effects.length !== 2 || s.duration.d === 'permanent') return null;
  type Pump = Extract<StepOf<'effect'>['effects'][number], { s: 'continuous' }>;
  const lone = (e: StepOf<'effect'>['effects'][number]): e is Pump => e.s === 'continuous' && e.cda !== true && e.affects.ref === 'target' && e.mods.length === 1 && e.mods[0]!.layer === '7c'
    && Object.keys(e.mods[0]!).every((k) => k === 'layer' || k === 'power' || k === 'toughness');
  const [e1, e2] = s.effects;
  if (e1 === undefined || e2 === undefined || !lone(e1) || !lone(e2)) return null;
  const values = [e1, e2].flatMap((e) => {
    const m = e.mods[0] as { power?: Quantity; toughness?: Quantity };
    return [m.power ?? 0, m.toughness ?? 0];
  });
  if (values.every((v) => typeof v === 'number')) {
    const [a, b] = s.effects.map((e) => K.staticEffect(e, st, { duration: { d: 'permanent' } }));
    const dur = K.dur(s.duration, st);
    return alt(`${dur}, ${a} and ${b}`, `${a} ${dur} and ${b} ${dur}`);
  }
  // FAST5 T69 (CR 107.3c, 608.2h): "Target creature you control gets +X/+0 until end of turn and up to one target creature an opponent controls gets -0/-X until
  // end of turn, where X is ...": one "where X is" clause defines the X of both changes, said once at the end. Every changed value is a number, the one calculated
  // quantity Q or its negation; each change is worded with the plain X (no clause of its own) and the clause is added once.
  const negated = (q: Quantity): Quantity | null => (typeof q === 'object' && q.q === 'math' && q.op === '*' && q.args.length === 2 && q.args[0] === -1 ? q.args[1]! : null);
  const calc = values.filter((v) => typeof v !== 'number');
  const base = (v: Quantity): Quantity => negated(v) ?? v;
  const key = JSON.stringify(base(calc[0]!));
  if (calc.some((v) => JSON.stringify(base(v)) !== key) || key.includes('"q":"X"') || key.includes('"q":"var"')) return null;
  const plain = (v: Quantity): Quantity => (typeof v === 'number' ? v : negated(v) !== null ? { q: 'math', op: '*', args: [-1, { q: 'X' }] } : { q: 'X' });
  const withX = (e: Pump): Pump => {
    const m = e.mods[0] as { layer: '7c'; power?: Quantity; toughness?: Quantity };
    return { ...e, mods: [{ layer: '7c', ...(m.power !== undefined ? { power: plain(m.power) } : {}), ...(m.toughness !== undefined ? { toughness: plain(m.toughness) } : {}) }] };
  };
  const v = cloneState(st);
  const [a, b] = [withX(e1), withX(e2)].map((e) => K.staticEffect(e, v, { duration: { d: 'permanent' } }));
  const dur = K.dur(s.duration, v);
  const q = K.qty(base(calc[0]!), v);
  // Cloud std-eoe: the duration said once, in front ("When ~ enters, until end of turn, target creature you control gets +X/+0 and target creature an opponent
  // controls gets -0/-X, where X is ..."), as the numeric pair above offers it (equivalence family 'duration')
  const text = alt(`${a} ${dur} and ${b} ${dur}, where X is ${q}`, `${dur}, ${a} and ${b}, where X is ${q}`);
  absorb(st, v);
  return text;
}

/**
 * std-hob (CR 611.2a, 611.2c, 613.1f, 613.4c): "Until end of turn, ~ gets +1/+0 and creatures you control gain trample" (Wargling), "Moku gets +2/+1 and creatures you
 * control gain haste until end of turn": a P/T change of one object and the abilities a group gains, with one duration said once, in front or at the end
 * (templates eff.stdhob.lead.pump.andGroupGains, eff.stdhob.pump.andGroupGains.trail). Null for anything else.
 */
function pumpAndGroupGains(s: StepOf<'effect'>, st: RenderState): string | null {
  if (s.effects.length !== 2 || s.duration.d === 'permanent') return null;
  const [e1, e2] = s.effects;
  if (e1?.s !== 'continuous' || e2?.s !== 'continuous') return null;
  const plainKeys = (e: object): boolean => Object.keys(e).every((k) => k === 's' || k === 'affects' || k === 'mods');
  if (!plainKeys(e1) || !plainKeys(e2) || e1.mods.length !== 1 || e2.mods.length !== 1) return null;
  const [m1, m2] = [e1.mods[0]!, e2.mods[0]!];
  if (m1.layer !== '7c' || !Object.keys(m1).every((k) => k === 'layer' || k === 'power' || k === 'toughness')) return null;
  if (m2.layer !== 6 || !Object.keys(m2).every((k) => k === 'layer' || k === 'add')) return null;
  if (e1.affects.ref === 'each' || e2.affects.ref !== 'each' || isPlayerRef(e1.affects as ObjRef | PlayerRef, st)) return null;
  const [a, b] = [e1, e2].map((e) => K.staticEffect(e, st, { duration: { d: 'permanent' } }));
  const dur = K.dur(s.duration, st);
  return alt(`${dur}, ${a} and ${b}`, `${a} and ${b} ${dur}`);
}

/**
 * r3-choose (CR 701.10a-c, 608.2h, 611.2a, 613.1f): "Until end of turn, double its power and toughness and it gains trample" (World War Hulk): one object's power and
 * toughness doubled and abilities that object gains, with one duration said once, in front or at the end (templates eff.r3choose.dur.double*.pt.gains). Null for anything else.
 */
function doubleAndGains(s: StepOf<'effect'>, st: RenderState): string | null {
  if (s.effects.length !== 2 || s.duration.d === 'permanent') return null;
  const [e1, e2] = s.effects;
  // p2-pt-1 (CR 701.10c, 613.4c): also one object's power alone, "Until end of turn, double target creature's power and it gains first strike" (eff.p2pt1.*)
  const kind = e1?.s === 'continuous' ? doubledBy(e1) : null;
  if (e1?.s !== 'continuous' || e2?.s !== 'continuous' || (kind !== 'pt' && kind !== 'power')) return null;
  if (!Object.keys(e2).every((k) => k === 's' || k === 'affects' || k === 'mods') || e2.mods.length !== 1) return null;
  const m2 = e2.mods[0]!;
  if (m2.layer !== 6 || !Object.keys(m2).every((k) => k === 'layer' || k === 'add')) return null;
  if (e1.affects.ref === 'each' || e1.affects.ref === 'union' || JSON.stringify(e1.affects) !== JSON.stringify(e2.affects) || isPlayerRef(e1.affects as ObjRef | PlayerRef, st)) return null;
  const doubled = doubledText(kind, e1.affects as ObjRef, undefined, st);
  const gains = K.staticEffect(e2, st, { duration: { d: 'permanent' } });
  const dur = K.dur(s.duration, st);
  return alt(`${dur}, ${doubled} and ${gains}`, `${doubled} and ${gains} ${dur}`);
}

/** FAST5X E1: "you and <objects> gain hexproof <duration>", or null when the two effects are not exactly that. */
function youAndObjsHexproof(s: StepOf<'effect'>, st: RenderState): string | null {
  const [r, c] = s.effects;
  if (r?.s !== 'restrict' || c?.s !== 'continuous') return null;
  if (JSON.stringify(r.subject) !== '{"ref":"you"}' || r.mode !== 'cant' || r.action !== 'beTargeted' || JSON.stringify(r.other) !== '{"controller":"opponent"}') return null;
  if (Object.keys(r).some((k) => !['s', 'subject', 'mode', 'action', 'other'].includes(k))) return null;
  if (c.affects.ref !== 'each' || !('filter' in c.affects) || c.mods.length !== 1 || Object.keys(c).some((k) => !['s', 'affects', 'mods'].includes(k))) return null;
  const m = c.mods[0]!;
  const add = (m as { add?: unknown }).add;
  if (m.layer !== 6 || Object.keys(m).some((k) => k !== 'layer' && k !== 'add') || !Array.isArray(add) || add.length !== 1) return null;
  const k = add[0] as { kind?: string; keyword?: string } & Record<string, unknown>;
  if (k.kind !== 'keyword' || k.keyword !== 'hexproof' || Object.keys(k).some((x) => !['kind', 'keyword', 'text'].includes(x))) return null;
  const objs = K.np(c.affects.filter, st, { det: 'none', plural: true });
  const dur = K.dur(s.duration, st);
  return `you and ${objs} gain hexproof${dur ? ` ${dur}` : ''}`;
}

/**
 * r5-static (CR 508.1d, 611.2a, 102.3): "Until your next turn, each creature attacks each combat if able and attacks a player other than you if able" (Maximum
 * Carnage): two requirements of one group with one duration, the second naming the players other than you, who in a game without teams are your opponents (CR
 * 102.3; fixed as the effect begins, effects/handlers/lasting-fix.ts). The subject is said once.
 */
function attacksOtherThanYou(s: StepOf<'effect'>, st: RenderState): string | null {
  const [a, b] = s.effects;
  if (a?.s !== 'restrict' || b?.s !== 'restrict') return null;
  const only = (r: RestrictionDef, extra: readonly string[]): boolean => Object.keys(r).every((k) => ['s', 'subject', 'mode', 'action', ...extra].includes(k));
  if (a.mode !== 'mustIfAble' || a.action !== 'attack' || !only(a, [])) return null;
  if (b.mode !== 'mustIfAble' || b.action !== 'attack' || !only(b, ['otherPlayer']) || JSON.stringify(b.otherPlayer) !== '{"ref":"each","who":"opponent"}') return null;
  if (JSON.stringify(a.subject) !== JSON.stringify(b.subject) || isPlayerRef(a.subject, st)) return null;
  const dur = K.dur(s.duration, st);
  const body = withSubjects(a.subject, st, (sj, pl) => `${sj} ${pl ? 'attack' : 'attacks'} each combat if able and ${pl ? 'attack' : 'attacks'} a player other than you if able`);
  return dur ? `${dur}, ${body}` : body;
}

/**
 * FAST5 T69 (CR 107.3c, 601.2c): "Up to X target creatures you control get +X/+X until end of turn, where X is the number of colors among permanents you
 * control": the one lasting effect whose targets' upper bound is a calculated quantity, that the pump also uses (so one "where X is" clause defines both,
 * the same quantity the lowering put in for both X). The JSON of that quantity, or null for any other effect.
 */
function xCountOf(s: StepOf<'effect'>, st: RenderState): string | null {
  const e = s.effects[0];
  if (s.effects.length !== 1 || e === undefined || e.s !== 'continuous' || e.affects.ref !== 'target') return null;
  const spec = st.specs.get(e.affects.id);
  if (spec === undefined || spec.min !== 0 || typeof spec.max !== 'object' || !isComputed(spec.max)) return null;
  const key = JSON.stringify(spec.max);
  const pump = e.mods.find((m) => m.layer === '7c');
  if (pump === undefined) return null;
  const uses = (q: unknown): boolean => JSON.stringify(q) === key || (typeof q === 'object' && q !== null && (q as { q?: string }).q === 'live' && JSON.stringify((q as { value?: unknown }).value) === key);
  return uses((pump as { power?: unknown }).power) || uses((pump as { toughness?: unknown }).toughness) ? key : null;
}

/** cmd1's "once for each <object>" of a count of objects (steps-util.ts#timesWords), or '' when that count has no such words (the "X times, where X is" wording
 * then stands alone). */
function eachTimesWords(n: Quantity, st: RenderState): string {
  try {
    return timesWords(n, st);
  } catch (e) {
    if (e instanceof NoRenderer) return '';
    throw e;
  }
}

/** r4-fxz: the player who gains control in a step that is one control change of one object (a target or the object itself), or null. */
function oneControlChange(s: StepOf<'effect'>): PlayerRef | null {
  const [e] = s.effects;
  if (s.effects.length !== 1 || e?.s !== 'continuous' || (e.affects.ref !== 'target' && e.affects.ref !== 'self') || e.mods.length !== 1) return null;
  const m = e.mods[0]!;
  return m.layer === 2 && 'controller' in m && m.controller !== undefined && typeof m.controller === 'object' ? (m.controller as PlayerRef) : null;
}

/**
 * p2-misc-2 (CR 702.16b, 702.16e, 119.7; unverified 702.16j-k): "Until your next turn, your life total can't change and you gain protection from everything"
 * (Teferi's Protection): exactly the five restrictions of the player "you" the template builds (no life gained or lost; not enchanted, targeted or dealt damage
 * by anything: no `other`), until that player's next turn.
 */
function lifeFixedProtectedUntilNextTurn(s: StepOf<'effect'>): boolean {
  if (JSON.stringify(s.duration) !== '{"d":"untilNextTurn","whose":{"ref":"you"}}' || s.effects.length !== 5) return false;
  const got = s.effects.map((e) => (e.s === 'restrict' && e.mode === 'cant' && JSON.stringify(e.subject) === '{"ref":"you"}' && Object.keys(e).length === 4 ? e.action : '')).sort();
  return JSON.stringify(got) === JSON.stringify(['beEnchanted', 'beTargeted', 'gainLife', 'loseLife', 'receiveDamage']);
}

export const CLAUSES_LASTING = {
  effect: (s: StepOf<'effect'>, st: RenderState): Clause => {
    if (lifeFixedProtectedUntilNextTurn(s)) return plain("until your next turn, your life total can't change and you gain protection from everything");
    // r4-static (the parser's rule, parser/lower/anaphora.ts#continuousAffects, Mention.stackObject; CR 611.2c): a continuous effect or restriction of a resolving
    // spell or ability modifies only objects on the battlefield, so the spell itself on the stack is no antecedent of its pronoun ("~ deals 1 damage to target
    // creature. It can't block this turn.")
    if (st.permanentOnly !== true) {
      st.permanentOnly = true;
      try {
        return CLAUSES_LASTING.effect(s, st);
      } finally {
        delete st.permanentOnly;
      }
    }
    // CLOUD std-tmt (CR 611.2c, 608.2c): a group's control change names the objects it took for the instructions after it ("Untap them.")
    if (s.as !== undefined) {
      const taken = controlledGroup(s);
      // r4-fxz (CR 608.2c, 613.1b): "Target opponent gains control of another target permanent you control. If they do, you draw a card.": one object's control
      // change, named so that "If they do" reads whether it happened; the player who gains control is the one who "does"
      const gainer = taken === null ? oneControlChange(s) : null;
      if (taken === null && gainer === null) throw new NoRenderer('a continuous effect that names its objects, other than a control change of a group or of one object');
      const { as, ...rest } = s;
      const c = CLAUSES_LASTING.effect(rest as StepOf<'effect'>, st);
      if (taken !== null) bind(st, as, { nouns: K.nounsOf(taken['filter'] as ObjectFilter), plural: true });
      else bind(st, as, { nouns: [], plural: false, actor: playerKey(gainer!) });
      return c;
    }
    const xq = xCountOf(s, st);
    if (xq !== null && st.xCount !== xq) {
      const saved = st.xCount;
      st.xCount = xq;
      try {
        return CLAUSES_LASTING.effect(s, st);
      } finally {
        if (saved === undefined) delete st.xCount;
        else st.xCount = saved;
      }
    }
    // std-combat-1 (CR 613.1b, 611.2b): "gain control of that permanent for as long as that Aura is attached to it"
    const whileAttached = gainControlWhileAttached(s.effects, s.duration, st);
    if (whileAttached !== null) return plain(whileAttached);
    const [only] = s.effects;
    // FAST2 T9: the "have ... get" form inside "you may" ("you may have target creature get +2/+0 until end of turn", CR 608.2d)
    if (s.effects.length === 1 && only!.s === 'continuous') {
      // the have form is rendered on a copy of the state: the clause's own text leaves the state exactly as before this addition
      let have: string | null = null;
      try {
        have = continuousHave(only, cloneState(st), s.duration);
      } catch (e) {
        if (!(e instanceof NoRenderer)) throw e;
      }
      // FAST4 T22 (CR 701.10b, family double-pt): "+X/+0 until end of turn, where X is its power" is also "double its power until end of turn"; rendered
      // first, on a copy of the state, so the object is named the same way in both readings. A value of each modified object ("its own power", `subject`)
      // has no "gets" wording: then the doubling is the only reading
      const kind = doubledBy(only!);
      const doubled = kind === null ? null : doubledText(kind, only!.affects as ObjRef, s.duration, cloneState(st));
      let own: string;
      try {
        own = K.staticEffect(only!, st, { duration: s.duration });
      } catch (e) {
        if (!(e instanceof NoRenderer) || kind === null) throw e;
        own = doubledText(kind, only!.affects as ObjRef, s.duration, st);
      }
      // std-rx31 (CR 205.1a, 611.2a; family its-an-artifact): with no duration, "It's an artifact." / "~ is an artifact." says what "it becomes an artifact" says: from now
      // on its only card type is artifact (the parser's eff.stdrx31.itsAnArtifact.noDuration; "(They're no longer a creature.)", Tom, Bert, and William)
      const onlyArtifact = s.duration.d === 'permanent' && JSON.stringify(only!.mods) === JSON.stringify([{ layer: 4, types: { set: ['Artifact'] } }]) && Object.keys(only!).length === 3;
      if (onlyArtifact) own = alt(own, `${K.obj(only!.affects as ObjRef, cloneState(st), 'subject').text} is an artifact`, "it's an artifact");
      const text = doubled === null ? own : alt(own, doubled);
      // FAST5 T47: the have form of a change of identity may carry the "It's still a land." rider after it (a sentence of the same instruction, CR 608.2c)
      const identityHave = only!.mods.some((m) => m.layer === 4) && only!.mods.every((m) => m.layer === 4 || m.layer === 5 || m.layer === '7b');
      return plain(text, { standalone: hasBreak(text), ...(have !== null && (identityHave || !hasBreak(have)) ? { have } : {}) });
    }
    // FAST4 T33: the "have ... block" form inside "you may" ("you may have target creature block it this turn if able", CR 509.1c, 608.2d): a requirement
    // that one object blocks another this turn, said with the controller choosing whether it applies
    const r = only;
    if (s.effects.length === 1 && r!.s === 'restrict' && r.mode === 'mustIfAble' && r.action === 'block' && r.other !== undefined && Object.keys(r.other).length === 1
      && r.other.is !== undefined && r.when === undefined && r.max === undefined && r.otherPlayer === undefined && s.duration.d === 'endOfTurn' && !isPlayerRef(r.subject, st)) {
      const blocked = r.other.is;
      let have: string | null = null;
      try {
        const v = cloneState(st);
        const blocker = K.obj(r.subject as ObjRef, v, 'object').text;
        // a creature never blocks itself (CR 509.1a): the blocker is no antecedent of the creature it blocks ("block it"; parser/lower/anaphora.ts#blockSubject)
        const key = objKey(r.subject as ObjRef);
        if (key !== null) v.notAntecedent = identityOf(v, key);
        have = `${blocker} block ${K.obj(blocked, v, 'object').text} this turn if able`;
      } catch (e) {
        if (!(e instanceof NoRenderer)) throw e;
      }
      const own = K.staticEffect(r, st, { duration: s.duration });
      return plain(own, { standalone: hasBreak(own), ...(have !== null && !hasBreak(have) ? { have } : {}) });
    }
    if (s.effects.length === 2) {
      // FAST5X E1 (CR 702.11c, 702.11b): "You and permanents you control gain hexproof until end of turn": the player's hexproof ("can't be the target of
      // spells or abilities your opponents control") and the permanents' keyword, with one duration (template eff.fast5x.youAndObjs.gain.hexproof)
      const both = youAndObjsHexproof(s, st);
      if (both !== null) return plain(both, { standalone: true });
      const carnage = attacksOtherThanYou(s, st); // r5-static
      const theyCant = playerCantAttackYou(s.effects, K.dur(s.duration, st), st); // std-combat-1
      if (theyCant !== null) return plain(theyCant, { standalone: true });
      const noDefender = pumpGainsNoDefender(s, st); // std-rx32
      if (noDefender !== null) return plain(noDefender, { standalone: true });
      if (carnage !== null) return plain(carnage, { standalone: true });
      // FAST2 T9: one object that gets a P/T change and can't be blocked, or can attack as though it didn't have defender, says its subject once ("~ gets +1/+0
      // until end of turn and can't be blocked this turn", CR 611.2c, 509.1b, 609.4)
      const shared = sharedEffectSubject(s.effects[0]!, s.effects[1]!, s.duration, st);
      if (shared !== null) return plain(shared, { standalone: true });
      const pair = pumpPair(s, st);
      if (pair !== null) return plain(pair, { standalone: true });
      const pumpGains = pumpAndGroupGains(s, st);
      if (pumpGains !== null) return plain(pumpGains, { standalone: true });
      const doubleGains = doubleAndGains(s, st); // r3-choose
      if (doubleGains !== null) return plain(doubleGains, { standalone: true });
      // std-ry10 (CR 615.1a, 510.1): "prevent all combat damage that would be dealt to and dealt by target creature this turn" (FAST5 T40's pair, resolved)
      const toAndBy = lastingCombatToAndBy(s.effects, s.duration, st);
      if (toAndBy !== null) return plain(toAndBy, { standalone: true });
    }
    // r4-repl (CR 614.1c, 614.12, 611.2c): "Whenever you cast a creature spell, that creature enters with an additional +1/+1 counter on it" (the templates
    // eff.r4repl.castSpell.entersWith.*): a replacement of the entering of the spell the cast trigger names
    const castEnters = spellEntersWith(s, st) ?? spellExiledAsItResolves(s, st);
    if (castEnters !== null) return plain(castEnters, { standalone: true });
    // FAST5X E14 (CR 401.5, 601.3, 611.2a): "until end of turn, you may look at the top card of your library any time and you may play cards from the top of
    // your library"
    const top = topPermitsSentence(s.effects, 0, st, s.duration) ?? graveyardPermitsSentence(s.effects, 0, st, s.duration); // C10: from your graveyard
    if (top !== null && top.n === s.effects.length) return plain(top.text, { standalone: true });
    // FAST5 T57: "Damage can't be prevented this turn" (CR 615.12)
    if (damageUnpreventable(s.effects)) return plain(damageUnpreventableText(s.duration, st), { standalone: true });
    if (damageUnpreventable(s.effects, 'preventCombatDamage')) return plain(damageUnpreventableText(s.duration, st, true), { standalone: true }); // r5-repl (CR 510.2)
    // FAST3 T16: "Target creature can't attack or block this turn" (CR 611.2a, 508.1c, 509.1b)
    const cants = lastingCants(s.effects, s.duration, st);
    if (cants !== null) return plain(cants, { standalone: true });
    // std-mkm (CR 508.1d, 509.1c): "Target creature attacks or blocks this turn if able"
    const musts = attackOrBlockIfAble(s.effects, s.duration, st);
    if (musts !== null) return plain(musts, { standalone: true });
    // trek-8 (CR 508.1, 611.2a): "Target player can't attack this turn" is also the restriction on every creature the player controls (render/fold-trek8.ts)
    const pca = playerCantAttack(s);
    if (pca !== null) {
      const [group, player] = withVariants(st, [(v) => K.staticEffect(s.effects[0]!, v, { duration: s.duration }), (v) => playerCantAttackText(pca.who, pca.duration, v)]);
      return plain(alt(group!, player!));
    }
    const parts = s.effects.map((e) => K.staticEffect(e, st, { duration: s.duration }));
    if (parts.length === 1) return plain(parts[0]!, { standalone: hasBreak(parts[0]!) });
    // r4-repl (CR 611.2a, 614.1a): "you may cast spells from your graveyard this turn, and if a card would be put into your graveyard from anywhere this turn, exile it
    // instead" (Walk-In Closet // Forgotten Cellar; the template eff.r4repl.gy.cast.andExileInstead.thisTurn): a permission and a replacement of one effect, one sentence
    if (parts.length === 2 && s.effects[0]!.s === 'permit' && s.effects[1]!.s === 'replace' && /^if /.test(firstAlt(parts[1]!))) return plain(alt(parts.join('. '), `${parts[0]!}, and ${parts[1]!}`), { standalone: true });
    return plain(parts.join('. '), { standalone: true });
  },

  delay: (s: StepOf<'delay'>, st: RenderState): Clause => {
    // FAST5 T45 (CR 603.7b, 707.10): a copy of the next spell of any kind you cast this turn has its own wording, "copy the next spell you cast this turn when you
    // cast it" (the same delayed trigger as "when you next cast a spell this turn, copy that spell", which no card prints)
    const only = s.do.length === 1 ? s.do[0]! : undefined;
    if (s.once === true && s.when.at === 'event' && only?.op === 'copy' && isNextSpellCopy(s, only)) {
      const nt = only.newTargets === true || only.newTargets === 'may' ? '. you may choose new targets for the copy' : '';
      return plain(`copy the next spell you cast this turn when you cast it${nt}`, { standalone: true });
    }
    const lead = delayedLead(s, st);
    // inside the delayed trigger `{ref:'event'}` is the event it waits for (CR 603.7)
    const saved = st.trigger;
    let hadSelf = false;
    const savedBatch = st.triggerBatch;
    const savedOwnEnters = st.inOwnEnters;
    if (s.when.at === 'event') {
      // std-rx11 (render/refs.ts#candidateCheck): created by the object's own "enters" trigger (CR 603.6a)
      if ((saved ?? []).length > 0 && saved!.every((ev) => ev.ev === 'zoneChange' && ev.subject.self === true && ev.to === 'battlefield')) st.inOwnEnters = true;
      st.trigger = [s.when.event];
      if (s.batch === true) st.triggerBatch = true; // FAST5 T50: "that many" and the plural roles of a batch (render/refs.ts)
      markTriggerRoles(st);
      // FAST5 T45: "Put a +1/+1 counter on ~. When you next cast a Lesson spell this turn, copy it": the spell the event names was mentioned last, so "it" is the
      // spell, not ~ (the parser's unique candidate would not see ~ in the delayed trigger's own clause)
      if (s.when.event.ev === 'cast') hadSelf = st.mentioned.delete('self');
    }
    let body: string;
    try {
      body = K.steps(s.do, st, { nested: true, sentences: true }); // (a step-timed delayed trigger too: parser/lower/delay-tail.ts, trek-8)
    } finally {
      st.trigger = saved;
      if (hadSelf) st.mentioned.add('self');
      st.triggerBatch = savedBatch;
      st.inOwnEnters = savedOwnEnters;
    }
    // FAST5 T50 (CR 603.7b): "Until end of turn, whenever ..." is the same delayed trigger as "Whenever ... this turn"; it is only ever written in front of its effect
    if (untilYourNextTurn(s) !== null) return plain(`${lead}, ${body}`, { standalone: true }); // r5-refs, std-rt
    const untilLead = s.when.at === 'event' && s.duration?.d === 'endOfTurn' && s.once !== true ? `until end of turn, whenever ${K.events([s.when.event], st, 'present', { batch: s.batch === true })}` : null;
    if (hasBreak(body)) return plain(untilLead === null ? `${lead}, ${body}` : alt(`${lead}, ${body}`, `${untilLead}, ${body}`), { standalone: true });
    // (the leading wording first: a body that ends inside the quotes of a granted ability ends the sentence there, render/clause.ts#endSentence reads the first option)
    if (untilLead !== null) return plain(alt(`${lead}, ${body}`, `${untilLead}, ${body}`, `${body} ${lead}`), { standalone: true });
    // one instruction reads "Sacrifice it at the beginning of the next end step"; several read "At the beginning of ..., do this and that"
    return plain(s.do.length === 1 ? alt(`${body} ${lead}`, `${lead}, ${body}`) : alt(`${lead}, ${body}`, `${body} ${lead}`), { standalone: true });
  },

  reflexive: (s: StepOf<'reflexive'>, st: RenderState): Clause => {
    // FAST5X E16 (CR 603.12, 120.10): a reflexive trigger that waits for a result of the step: "when excess damage is dealt to ... this way, ..."
    // (wave 7 review, CR 603.4: "When you do, if X, Y": the intervening "if" of lower/conditions.ts#foldReflexive is also the lone `if` of the instructions, said once there)
    const lone = s.do.length === 1 && s.do[0]!.op === 'if' && s.do[0]!.else === undefined ? s.do[0]! : undefined;
    const intervening = s.when.if !== undefined && lone !== undefined && JSON.stringify(lone.cond) === JSON.stringify(s.when.if);
    if (s.when.if !== undefined && !intervening) {
      // r4-moved: "When you discard a card this way, target player mills cards equal to its mana value." (render/steps-flow.ts#movedCondFocus)
      const c = K.cond(s.when.if, st);
      const outer = st.focus;
      // std-combat-1 (CR 603.12, 608.2c): "When you put one or more Equipment onto the battlefield this way, you may attach one of them ...": "them" are the objects that
      // move put there (RefInfo.movedBinding, render/fold.ts#putAnyFromGroup)
      const w0 = s.when.if as { cond?: string; step?: string; which?: unknown; to?: string; not?: boolean };
      const putThere = w0.cond === 'did' && w0.which !== undefined && w0.to === 'battlefield' && w0.not !== true && w0.step !== undefined ? st.info.get(`r:${w0.step}`)?.movedBinding : undefined;
      const focus = movedCondFocus(s.when.if, st) ?? (putThere !== undefined ? `b:${putThere}` : undefined);
      if (focus !== undefined) st.focus = focus;
      // std-ra (CR 603.12, 608.2c): "... this way, tap up to that many target creatures": the count of what the condition asks about (render/refs.ts#countWord)
      const outerMoved = st.movedThatMany;
      const w = s.when.if as { cond?: string; step?: string; which?: unknown };
      if (w.cond === 'did' && w.which !== undefined) st.movedThatMany = JSON.stringify({ step: w.step, which: w.which });
      try {
        return plain(`when ${c}, ${K.steps(s.do, st)}`, { standalone: true });
      } finally {
        if (focus !== undefined) { if (outer === undefined) delete st.focus; else st.focus = outer; }
        if (outerMoved === undefined) delete st.movedThatMany; else st.movedThatMany = outerMoved;
      }
    }
    const info = st.info.get(`b:${s.when.did}`);
    const actor = info?.actor;
    const you = actor === undefined || actor === null || actor === 'you';
    const lead = you ? alt('when you do', 'when you did') : alt('when that player does', 'when the player does');
    // r5-cost (CR 603.12, 700.2): a reflexive trigger with modes, "when you do, choose one -- • ... • ..." (its program: the modes, then its own instructions)
    if (s.modes !== undefined) return plain(`${lead}, ${K.program({ targets: s.targets, modes: s.modes, steps: s.do }, st)}`, { standalone: true });
    // std-rx32 (CR 701.3a, 603.12): after an attach of targets, "when one or more Equipment become attached to that creature this way" (render/steps-zones.ts#attach)
    const att = info?.attachedThisWay;
    if (att !== undefined) return plain(`when one or more ${att.noun} become attached to ${K.obj(att.to, st, 'object').text} this way, ${K.steps(s.do, st)}`, { standalone: true });
    // r5-moved (CR 603.12, 701.23a; family searched-this-way): after a search of your own library (render/steps-cards.ts#search), "when you search your library this way"
    if (you && info?.searched === true) return plain(`${alt(lead, 'when you search your library this way')}, ${K.steps(s.do, st)}`, { standalone: true });
    return plain(`${lead}, ${K.steps(s.do, st)}`, { standalone: true });
  },

  extraTurn: (s: StepOf<'extraTurn'>, st: RenderState): Clause => {
    // std-rx30 (CR 500.7, 705.1): "Take an extra turn after this one for each coin that comes up heads" (Ral Zarek): as many as the coins an earlier flip came up heads
    const q = s.count;
    if (typeof q === 'object' && q.q === 'resultCount' && q.which === undefined && st.info.get(`r:${q.step}`)?.thisWay === 'that came up heads') {
      return byPlayer(s.who, st, 'take', 'an extra turn after this one for each coin that comes up heads');
    }
    return byPlayer(s.who, st, 'take', () => (typeof s.count === 'number' && s.count === 1 ? 'an extra turn after this one' : `${typeof s.count === 'number' ? numWord(s.count) : K.qty(s.count, st)} extra turns after this one`));
  },

  /** std-control-3 (CR 723.1): "you control target opponent during their next turn" / "... during their next combat phase". */
  controlPlayer: (s: StepOf<'controlPlayer'>, st: RenderState): Clause =>
    plain(`you control ${K.player(s.who, st, 'object').text} during their next ${s.during === 'turn' ? 'turn' : 'combat phase'}`),

  extraPhase: (s: StepOf<'extraPhase'>, st: RenderState): Clause => {
    const after = s.after === undefined ? 'this phase' : `this ${s.after === 'main1' || s.after === 'main2' ? 'main phase' : s.after === 'combatDamage' || s.after === 'endCombat' ? 'combat' : 'phase'}`;
    // std-rq (CR 500.8, 508.1c): "After this phase, there is an additional combat phase. Only land creatures can attack during that combat phase."
    if (s.attackers !== undefined) {
      if (s.phase !== 'combat' || s.followedBy !== undefined || s.after !== undefined) throw new NoRenderer('an attacker restriction of another added phase');
      const only = K.np(s.attackers, st, { det: 'none', plural: true });
      return plain(`after this phase, there is an additional combat phase. only ${only} can attack during that combat phase`, { standalone: true });
    }
    // r4-mech (CR 500.8): "after this main phase, there is an additional combat phase followed by an additional main phase" and "there is an additional combat
    // phase after this phase, followed by an additional main phase"
    if (s.followedBy !== undefined) {
      if (s.followedBy !== 'main' || s.phase !== 'combat') throw new NoRenderer('an added phase followed by another kind of phase');
      const follow = 'followed by an additional main phase';
      return plain(alt(`after ${after}, there is an additional combat phase ${follow}`, `there is an additional combat phase after ${after}, ${follow}`, `there is an additional combat phase after ${after} ${follow}`));
    }
    return plain(alt(`after ${after}, there is an additional ${s.phase} phase`, `after this phase, there is an additional ${s.phase} phase`, `there is an additional ${s.phase} phase after ${after}`)); // r3-refs: the clause after an "and" ("untap ~ and there is an additional combat phase after this phase", CR 500.8)
  },

  // r4-fxb (CR 500.9): "there is an additional end step after this step", "you get that many additional upkeep steps after this phase"
  extraStep: (s: StepOf<'extraStep'>, st: RenderState): Clause => {
    const name = EXTRA_STEP_WORDS[s.step];
    if (name === undefined) throw new NoRenderer(`an additional ${s.step} step`);
    const anchor = s.afterPhase === true ? 'this phase' : 'this step';
    if (s.count === undefined || s.count === 1) return plain(alt(`there is an additional ${name} step after ${anchor}`, `after ${anchor}, there is an additional ${name} step`));
    const n = typeof s.count === 'number' ? numWord(s.count) : s.count.q === 'eventAmount' ? 'that many' : K.qty(s.count, st);
    return plain(alt(`you get ${n} additional ${name} steps after ${anchor}`, `there are ${n} additional ${name} steps after ${anchor}`));
  },

  endTurn: (): Clause => plain('end the turn'),

  winGame: (s: StepOf<'winGame'>, st: RenderState): Clause => byPlayer(s.who, st, 'win', 'the game'),
  loseGame: (s: StepOf<'loseGame'>, st: RenderState): Clause => byPlayer(s.who, st, 'lose', 'the game'),

  createEmblem: (s: StepOf<'createEmblem'>, st: RenderState): Clause =>
    byPlayer(s.who, st, 'get', () => `an emblem with ${joinList(s.abilities.map((a) => `"${K.ability(a, nestedState(st))}"`))}`),

  rollDie: (s: StepOf<'rollDie'>, st: RenderState): Clause => {
    const count = s.count === undefined || s.count === 1 ? 'a' : numWord(s.count);
    // p2-c-dieroll-1 (CR 706.1): a d6 is also "a six-sided die" (family six-sided-die)
    const dice = s.sides === 6 ? alt(`${count} d6`, `${count} six-sided ${count === 'a' ? 'die' : 'dice'}`) : `${count} d${s.sides}`;
    const c = byPlayer(s.who, st, 'roll', dice);
    if (!s.table || s.table.length === 0) return c;
    // p2-c-dieroll-1 (CR 706.3a): only one row happens, so each row is said from what was said before the table, never after another row ("its controller" again)
    const rows = s.table.map((r) => `${r.min === r.max ? r.min : `${r.min}-${r.max}`} | ${K.steps(r.do, cloneState(st))}`);
    return acting(c.actor ?? 'x', `${c.imp}. ${rows.join('. ')}`, `${c.sub}. ${rows.join('. ')}`, { standalone: true, commaThen: true }); // p2-c-dieroll-1: "Exile target creature, then roll a d20." (CR 608.2c)
  },

  flipCoin: (s: StepOf<'flipCoin'>, st: RenderState): Clause => {
    const key = playerKey(s.who);
    // std-rx30 (CR 705.1, 608.2c): what a flip of several coins came up is "the number of coins that came up heads" for a later count (render/qty.ts, resultCount)
    // p2-coinflip-3 (CR 705.2): flips called for a later count are "each flip you win" (render/qty.ts, resultCount); by you only, several coins, no instructions
    if (s.called === true && (key !== 'you' || s.count === undefined || s.untilLose !== undefined || s.onWin !== undefined || s.onLose !== undefined)) throw new NoRenderer('called flips other than "flip N coins. For each flip you win, ..."');
    if (s.as !== undefined && s.called === true) st.info.set(`r:${s.as}`, { nouns: ['flip'], plural: true, thisWay: 'you win' });
    else if (s.as !== undefined && s.count !== undefined && s.onWin === undefined && s.onLose === undefined) st.info.set(`r:${s.as}`, { nouns: ['coin'], plural: true, thisWay: 'that came up heads' });
    // p2-coinflip-1 (CR 705.1-705.2): "flip a coin until you lose a flip", by you only
    if (s.untilLose === true) {
      if (key !== 'you' || s.count !== undefined || s.onWin !== undefined || s.onLose !== undefined) throw new NoRenderer('a flip until a loss other than "flip a coin until you lose a flip"');
      // p2-coinflip-2 (CR 705.2, 608.2c): its count is "each flip you won" for a later count (render/qty.ts, resultCount)
      if (s.as !== undefined) st.info.set(`r:${s.as}`, { nouns: ['flip'], plural: true, thisWay: 'you won' });
      return byPlayer(s.who, st, 'flip', 'a coin until you lose a flip');
    }
    const c = byPlayer(s.who, st, 'flip', s.count === undefined ? 'a coin' : `${numWord(s.count)} coin${s.count === 1 ? '' : 's'}`); // r4-mech: "flip five coins"
    const you = key === 'you';
    const subj = you ? 'you' : K.player(s.who, st, 'subject').text;
    const wins = you ? 'win' : 'wins';
    const loses = you ? 'lose' : 'loses';
    let imp = c.imp;
    let sub = c.sub;
    // std-copy-1 (CR 603.12, 705.2): a branch that is one reflexive trigger waiting for the flip itself is "when you win the flip, X" (by you only)
    const result = (branch: EffectStep[], verb: string): string => {
      const r = branch.length === 1 && branch[0]!.op === 'reflexive' ? branch[0]! : undefined;
      if (r === undefined || r.op !== 'reflexive') return `. if ${subj} ${verb} the flip, ${K.steps(branch, st)}`;
      if (!you || s.as === undefined || r.when.did !== s.as || r.when.if !== undefined || r.modes !== undefined) throw new NoRenderer('a reflexive trigger of a coin flip other than "when you win / lose the flip"');
      return `. when you ${verb} the flip, ${K.steps(r.do, st)}`;
    };
    if (s.onWin && s.onWin.length > 0) {
      const t = result(s.onWin, wins);
      imp += t;
      sub += t;
    }
    if (s.onLose && s.onLose.length > 0) {
      const t = result(s.onLose, loses);
      imp += t;
      sub += t;
    }
    return acting(c.actor ?? 'x', imp, sub, { standalone: imp !== c.imp });
  },

  // p2-player-rules-2 (CR 701.30): "clash with an opponent. if you win, X. otherwise, Y." (by you only; the result sentences folded by parser/lower/clash.ts)
  clash: (s: StepOf<'clash'>, st: RenderState): Clause => {
    if (playerKey(s.who) !== 'you') throw new NoRenderer('a clash by another player than you');
    const c = byPlayer(s.who, st, 'clash', `with ${K.player(s.with, st, 'object').text}`);
    let tail = '';
    if (s.onWin && s.onWin.length > 0) tail += `. if you win, ${K.steps(s.onWin, st)}`;
    if (s.onLose && s.onLose.length > 0) {
      if (tail === '') throw new NoRenderer('a clash with only a branch for a clash not won');
      tail += `. otherwise, ${K.steps(s.onLose, st)}`;
    }
    return acting(c.actor ?? 'x', c.imp + tail, c.sub + tail, { standalone: tail !== '' });
  },

  designate: (s: StepOf<'designate'>, st: RenderState): Clause => {
    switch (s.what) {
      case 'monarch': return byPlayer(s.who, st, 'become', 'the monarch');
      case 'initiative': return byPlayer(s.who, st, 'take', 'the initiative');
      case 'day': return plain('it becomes day');
      case 'night': return plain('it becomes night');
      // FAST5X-4 (CR 702.179c-d): the inherent ability of speed; no template writes it
      case 'speed': {
        // std-control-1 (CR 702.179): "reduce that opponent's speed by 1. This effect can't reduce their speed below 1." (one sentence pair, lower/ability.ts#joinSpeedFloor)
        if (s.decrease === true && s.floor !== undefined) {
          const p = K.player(s.who, st, 'possessive');
          if (p.person !== 'sg') throw new NoRenderer('a speed reduction of several players');
          return plain(`reduce ${p.text} speed by ${s.by ?? 1}. this effect can't reduce their speed below ${s.floor}`);
        }
        if (s.who.ref !== 'you') throw new NoRenderer('a speed increase of another player');
        return plain(`your speed increases by ${numWord(s.by ?? 1)}`);
      }
      // CMD3 (CR 702.131a, 702.131c): ascend's spell ability; no template writes it
      case 'citysBlessing': return byPlayer(s.who, st, 'get', "the city's blessing for the rest of the game");
    }
  },

  // std-mana-12 (CR 603.2): "you earthbend" / "you firebend", the report the earthbend macro and the firebending trigger end with; no template writes it
  reportAction: (s: StepOf<'reportAction'>, st: RenderState): Clause => byPlayer(s.who, st, s.verb, ''),

  // M6-6 INTERFACE CHANGE (additive): designations of a permanent (CR 716.2a, 719.3a-b, 722.3a-b), as Oracle words them
  designateObject: (s: StepOf<'designateObject'>, st: RenderState): Clause => {
    if (s.designation === 'classLevel') {
      if (s.level === undefined) throw new NoRenderer('designateObject classLevel without a level');
      return plain(`${K.obj(s.what, st, 'possessive').text} level becomes ${s.level}`);
    }
    // FAST5X E8 (CR 709.5f-g): "unlock a locked door of <Room>", "lock or unlock a door of <Room>"
    if (s.designation === 'unlockDoor') return plain(`unlock a locked door of ${K.obj(s.what, st, 'object').text}`);
    if (s.designation === 'lockOrUnlockDoor') return plain(`lock or unlock a door of ${K.obj(s.what, st, 'object').text}`);
    // FAST5X E12, CR 701.60a: "it's no longer suspected", "all suspected creatures are no longer suspected", "have it become no longer suspected"
    if (s.designation === 'unsuspected') {
      const before = cloneState(st);
      const p = K.obj(s.what, st, 'subject');
      const be = p.plural ? 'are' : 'is';
      const contracted = p.text === 'it' ? ["it's no longer suspected"] : p.text === 'they' ? ["they're no longer suspected"] : [];
      // std-mkm (CR 701.60a, 701.60b): "If it's suspected, it's no longer suspected", "If any of them are suspected, they're no longer suspected": a permanent that
      // isn't suspected stays so when an effect makes it no longer suspected, so the condition says nothing the instruction doesn't (Airtight Alibi, Eliminate the Impossible)
      const first = K.obj(s.what, before, p.plural ? 'object' : 'subject').text;
      const again = K.obj(s.what, before, 'subject').text;
      const lead = p.plural ? `if any of ${first} are suspected, ${again} are no longer suspected` : `if ${first} is suspected, ${again} is no longer suspected`;
      return plain(alt(`${p.text} ${be} no longer suspected`, ...contracted, lead), { have: `${p.text} become no longer suspected` });
    }
    // cloud r3-mech (CR 701.64): "Harness ~."
    if (s.designation === 'harnessed') return plain(`harness ${K.obj(s.what, st, 'object').text}`);
    if (s.designation === 'suspected') {
      const p = K.obj(s.what, st, 'object');
      return plain(`suspect ${p.text}`); // CR 701.60a (the action form, keywords/actions/evidence.ts#SUSPECT, is what templates build)
    }
    const who = K.obj(s.what, st, 'subject').text;
    // FAST5X E3, CR 702.171b: the saddled designation lasts until end of turn, and Oracle says so
    const until = s.designation === 'saddled' ? ' until end of turn' : '';
    return plain(`${who} becomes ${s.designation}${until}`, { have: `${who} become ${s.designation}${until}` });
  },

  action: (s: StepOf<'action'>, st: RenderState): Clause => {
    // T20 (FAST4): a computed N is written "discover X, where X is that spell's mana value" (CR 701.57a, 107.3)
    // FAST5 MX6: and "earthbend X, where X is ...", "it endures X, where X is ...", "empower Jace X, where X is ..." (CR 701.66a, 701.63a)
    // FAST5 T76: "it endures X, where X is the number of counters on this creature": the permanent that endures comes first in the text, so it is named before the amount
    // names anything else (the pronoun looks back, parser/lower/anaphora.ts#withoutLaterSelf)
    // std-rx26 (CR 701.57a): "discover again for the same value": the N of the discover that triggered the ability (`{q:'eventAmount'}` of a discover event)
    if (s.action === 'discover' && s.who.ref === 'you' && typeof s.n === 'object' && s.n !== null && s.n.q === 'eventAmount' && s.subject === undefined && s.arg === undefined && s.choices === undefined) {
      bind(st, s.as, { nouns: ['card'], plural: false, alts: ['the discovered card'] });
      return plain('discover again for the same value');
    }
    const endurer = s.action === 'endure' && s.subject !== undefined && !isPlayerRef(s.subject as never, st) ? K.obj(s.subject as never, st, 'object').text : null;
    const n = s.n === undefined ? null : WHERE_X_ACTIONS.has(s.action) && isComputed(s.n) ? whereX(s.n, st) : K.qty(s.n, st);
    // T20 (FAST4): the permanent manifest dread put onto the battlefield is a creature a later instruction names ("attach ~ to that creature", CR 701.62a,
    // 701.40a: a face-down 2/2 creature)
    // FAST5X E25: "manifest dread X times, then ... each of those creatures" (CR 701.62a, 608.2c): the permanents of every repetition; the permanent manifest or
    // cloak put onto the battlefield ("cloak the top card of your library, then attach ~ to it", CR 701.58a)
    if (s.action === 'manifestDread') bind(st, s.as, { nouns: ['creature', 'permanent'], plural: s.n !== undefined });
    // std-hob (CR 701.47c, 608.2c; the parser's participle "amassed", parser/lower/mentions.ts#producedBy): the Army an amass action chose is "the amassed Army" later
    if (s.action === 'amass') bind(st, s.as, { nouns: ['army'], plural: false, alts: ['the amassed Army', 'the Army you amassed'] });
    // p2-attack-block-2 (CR 701.15a, 608.2c; parser/lower/mentions.ts#producedBy): the group a goad of a description goaded is "those creatures" / "they" later
    if (s.action === 'goad' && s.as !== undefined && s.subject !== undefined && (s.subject as { ref?: string }).ref === 'each' && 'filter' in (s.subject as object)) bind(st, s.as, infoOfRef(s.subject as never, st));
    // CLOUD std-ecl (CR 701.68c; the parser's participle "blighted", parser/lower/mentions.ts#producedBy): the creature you chose as you blighted is "the blighted creature"
    if (s.action === 'blight' && s.who.ref === 'you') bind(st, s.as, { nouns: ['creature'], plural: false, alts: ['the blighted creature'] });
    // r4-mech (CR 701.57c; the parser's participle "discovered", parser/lower/mentions.ts#producedBy): the card a discover by you stopped at is "the discovered card"
    if (s.action === 'discover' && s.who.ref === 'you') bind(st, s.as, { nouns: ['card'], plural: false, alts: ['the discovered card'] });
    if ((s.action === 'cloak' || s.action === 'manifest') && s.subject === undefined) bind(st, s.as, { nouns: ['creature', 'permanent'], plural: s.n !== undefined });
    // T20 (FAST4): "support N" names its targets without the word (CR 701.41a): only "up to N [other] target creatures" may stand behind it
    if (s.action === 'support' && s.subject !== undefined) {
      const spec = (s.subject as { ref?: string }).ref === 'target' ? st.specs.get((s.subject as { id: string }).id) : undefined;
      const f = (spec?.filter ?? {}) as Record<string, unknown>;
      const ok = spec !== undefined && spec.kind === 'object' && spec.min === 0 && JSON.stringify(spec.max) === JSON.stringify(s.n)
        && JSON.stringify(f['types']) === '["Creature"]' && Object.keys(f).every((k) => k === 'types' || (k === 'other' && f[k] === true));
      if (!ok) throw new NoRenderer('support with targets that are not "up to N [other] target creatures" (CR 701.41a)');
    }
    // FAST5 MX6: "earthbend N" names its target without the word (CR 701.66a): only "target land you control" may stand behind it
    if (s.action === 'earthbend' && s.subject !== undefined) {
      const spec = (s.subject as { ref?: string }).ref === 'target' ? st.specs.get((s.subject as { id: string }).id) : undefined;
      const ok = spec !== undefined && spec.kind === 'object' && spec.min === 1 && spec.max === 1 && spec.onlyIf === undefined && spec.distinctFrom === undefined
        && JSON.stringify(spec.filter) === JSON.stringify({ types: ['Land'], controller: 'you' });
      if (!ok) throw new NoRenderer('earthbend with a target that is not "target land you control" (CR 701.66a)');
    }
    // trek-1 (assimilate: "put it onto the battlefield under your control", Star Trek reminder text): the macro moves a card, so only one target card in a graveyard,
    // assimilated by "you", may stand behind it (keywords/actions/assimilate.ts); anything else stays manual
    if (s.action === 'assimilate') {
      const spec = (s.subject as { ref?: string } | undefined)?.ref === 'target' ? st.specs.get((s.subject as { id: string }).id) : undefined;
      const f = (spec?.kind === 'object' ? spec.filter ?? {} : {}) as Record<string, unknown>;
      // trek-7 (The Borg Queen): or the one card another instruction of the ability exiled ("... until they exile a creature card. Assimilate that card."), a card in exile
      const sub = s.subject as { ref?: string; name?: string } | undefined;
      const exiledCard = sub?.ref === 'bound' && sub.name !== undefined && st.info.get(`b:${sub.name}`)?.zone === 'exile' && st.info.get(`b:${sub.name}`)?.plural === false
        && st.info.get(`b:${sub.name}`)?.nouns.includes('card') === true;
      const ok = exiledCard ? s.who.ref === 'you' && s.n === undefined
        : spec !== undefined && spec.kind === 'object' && spec.min === 1 && spec.max === 1 && f['zone'] === 'graveyard' && f['isCard'] === true && s.who.ref === 'you' && s.n === undefined;
      if (!ok) throw new NoRenderer('assimilate of something that is not one target card in a graveyard or the one card an exile put into exile, or not by you');
    }
    const arg = s.arg ?? null;
    // FAST5X E10: airbend is run for permanents only (effects/handlers/airbend.ts; a spell or a card in another zone is airbent by hand): only targets or
    // "all/each ..." of the battlefield may stand behind it, so the gate keeps any other airbend manual (CR 701.65a)
    // std-rw6 (CR 701.65a): and a target that is a spell or a permanent ("target creature or spell", FAST5 T59's filter): the handler exiles a spell from the stack
    if (s.action === 'airbend') {
      const ref = s.subject as { ref?: string; id?: string; filter?: { zone?: unknown } } | undefined;
      const spec = ref?.ref === 'target' ? st.specs.get(ref.id!) : undefined;
      const spellOr = spec !== undefined && spec.kind === 'object' && spec.filter !== undefined && spellOrPermanentOf(spec.filter) !== null;
      const zone = spellOr ? 'battlefield' : spec !== undefined ? (spec.kind === 'object' ? (spec.filter as { zone?: unknown } | undefined)?.zone ?? 'battlefield' : 'none') : ref?.ref === 'each' ? ref.filter?.zone ?? 'battlefield' : 'none';
      if (zone !== 'battlefield') throw new NoRenderer('airbend of something that is not a permanent, or not a target or "each" (CR 701.65a)');
    }
    // MX2 (additive): the meld cards' "exile them, then meld them into <result>" (effects/handlers/meld-pair.ts): "them" is the object and its partner
    if (s.action === 'meldPair') {
      if (s.subject !== undefined || s.n !== undefined || arg === null || s.who.ref !== 'you') throw new NoRenderer('meldPair: only "you" and the result');
      return plain(`exile them, then meld them into ${arg}`);
    }
    // M12-3 (CR 701.38a-b): "starting with you, each player votes for carnage or homage / a nonland permanent you don't control / a player"
    if (s.action === 'vote') return plain(voteText(s, st));
    if (s.choices !== undefined) throw new NoRenderer(`action ${s.action} with choices`);
    // `arg` has words in a few actions only ("amass Zombies 2", "behold an Elemental", "meld with", "double the number of ... counters")
    if (s.arg !== undefined && !['amass', 'behold', 'meld', 'doubleCounters', 'empower'].includes(s.action)) throw new NoRenderer(`action ${s.action} with an argument`);
    // r3-choose (CR 107.3a, 608.2h): a calculated number of times with its "where X is" clause, "investigate X times, where X is the total number of creatures those players
    // control" (Officious Interrogation; investigate only, the one action that reads it)
    // r4-fxb (CR 701.34a, 107.3a): proliferate reads it too, "proliferate X times, where X is the number of ..." (effects/handlers/actions-native-counters.ts#amount)
    const computedTimes = (s.action === 'investigate' || s.action === 'proliferate') && s.n !== undefined && isComputed(s.n) && typeof s.n === 'object' && s.n.q !== 'eventAmount'
      // std-rx18 (CR 102.3, 107.3a): a plain count of players too, "investigate X times, where X is the number of opponents you have" (Ethereal Investigator); a count
      // with a qualifier ("once for each opponent who ...") keeps timesWords' wording
      && (s.n.q !== 'countPlayers' || Object.keys(s.n).length === 2);
    // Standard merge wave 4 (family investigate-times-for-each): a count of objects is also cmd1's "once for each <object>" (Sophina, Spearsage Deserter); both
    // count as the instruction resolves (CR 608.2h)
    const eachTimes = computedTimes && typeof s.n === 'object' && s.n.q === 'count' && s.n.of.ref === 'each' ? eachTimesWords(s.n, st) : '';
    const times = ACTION_SUBJECT[s.action] || PRINTS_N.has(s.action) ? '' : computedTimes ? (eachTimes !== '' ? alt(` X times, where X is ${K.qty(s.n!, st)}`, eachTimes) : ` X times, where X is ${K.qty(s.n!, st)}`) : timesWords(s.n, st);
    if (s.action === 'ringTempts') return plain(`the Ring tempts you${times}`);
    const subjectForms = ACTION_SUBJECT[s.action];
    const obj = endurer ?? (s.subject !== undefined ? (isPlayerRef(s.subject as never, st) ? K.player(s.subject as never, st, 'object').text : K.obj(s.subject as never, st, 'object').text) : null);
    if (subjectForms) {
      const who = obj ?? K.obj({ ref: 'self' }, st, 'subject').text;
      // FAST5 T65 (CR 701.44a): the N of explore is how many times it explores ("it explores X times", "explores twice"), not a number said after the verb
      if (s.action === 'explore') {
        const times = timesWords(s.n);
        // std-lci (CR 701.44a-b): exploring twice is also said "X explores, then it explores again" (two complete explores, one after the other)
        if (s.n === 2 && obj !== null) return plain(alt(`${who} ${subjectForms[0]}${times}`, `${who} ${subjectForms[0]}, then it ${subjectForms[0]} again`), { have: `${who} ${subjectForms[1]}${times}` });
        return plain(`${who} ${subjectForms[0]}${times}`, { have: `${who} ${subjectForms[1]}${times}` });
      }
      return plain(`${who} ${subjectForms[0]}${n ? ` ${n}` : ''}`, { have: `${who} ${subjectForms[1]}` });
    }
    const objectual = ACTION_OBJECT[s.action];
    if (objectual && obj !== null) return plain(`${objectual(obj, n, arg)}${times}`);
    const actor = ACTION_ACTOR[s.action];
    // p2-counters-move-1 (CR 701.34a): proliferating twice is also said "proliferate, then proliferate again" (two whole proliferates, one after the other)
    if (actor && s.action === 'proliferate' && s.n === 2 && s.who.ref === 'you') {
      const c = byPlayer(s.who, st, 'proliferate', 'twice');
      return { ...c, imp: alt(c.imp, 'proliferate, then proliferate again') };
    }
    if (actor) return byPlayer(s.who, st, actor(n, arg).split(' ')[0]!, `${actor(n, arg).split(' ').slice(1).join(' ')}${times}`.trim());
    throw new NoRenderer(`action ${s.action}`);
  },
};

/**
 * std-rx32 (CR 609.4, 702.3b, 613.1f, 613.4c): "Until end of turn, target creature you control gets +1/+0, gains "Whenever this creature deals combat damage to a player,
 * draw cards equal to its toughness," and can attack as though it didn't have defender." (The Pride of Hull Clade): one object's P/T change and ONE quoted ability, in
 * one continuous effect, and the permission to attack despite defender for that object, the duration said first; the comma of the list goes inside the quote.
 */
function pumpGainsNoDefender(s: StepOf<'effect'>, st: RenderState): string | null {
  const [e, r] = s.effects;
  if (e?.s !== 'continuous' || r?.s !== 'permit' || e.cda === true || e.mods.length !== 2 || r.action !== 'attackAsThoughNoDefender' || r.who.ref !== 'you' || r.asThough !== undefined) return null;
  const [pt, grant] = e.mods;
  if (pt?.layer !== '7c' || grant?.layer !== 6 || grant.add?.length !== 1 || grant.remove !== undefined || grant.removeAll !== undefined || grant.cantHave !== undefined) return null;
  const a = grant.add[0]!;
  if (a.kind === 'keyword' || e.affects.ref === 'each' || isPlayerRef(e.affects as ObjRef | PlayerRef, st)) return null;
  if (r.of === undefined || Object.keys(r.of).length !== 1 || JSON.stringify(r.of.is) !== JSON.stringify(e.affects) || s.duration.d === 'permanent') return null;
  const dur = K.dur(s.duration, st);
  const subj = K.obj(e.affects as ObjRef, st, 'subject');
  if (subj.plural) return null;
  const pump = ptPredicate({ ...e, mods: [pt] }, st, false);
  if (pump === null) return null;
  const q = quotedListItem(quotedAbility(a, st, 'creature'), 'comma');
  return `${dur}, ${subj.text} ${pump}, gains ${q} and can attack as though it didn't have defender`;
}
