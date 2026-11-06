/**
 * CR 614.15 self-replacement: when "Y. If C, X instead." is the step `if C then [X] else [Y]` (WP23 review). Shared by the parser's "instead" fold
 * (parser/lower/riders.ts) and the renderer's "instead" reading (render/steps-flow.ts), so the gate never accepts a shape the parser would not build.
 *
 * X replaces Y as a whole only when it is the same instruction on the same things: one step each, the same op, the same player, the same objects, and a
 * difference only in an amount, a destination, a token, mana, a duration, or the numbers of one continuous effect ("gets +2/+2" / "gets +4/+4"). Anything else is a
 * partial replacement or another instruction ("each player draws ... you draw two instead", "you may X instead", another target, CR 601.2c, 608.2d) and
 * cannot be an `else` branch without a guess.
 */

/** Steps that are not one instruction: a choice, a payment, control flow, a trigger. Never one side of an "instead" fold. */
const NOT_ONE_INSTRUCTION: ReadonlySet<string> = new Set(['may', 'pay', 'if', 'forEach', 'repeat', 'let', 'delay', 'reflexive', 'manual', 'chooseObjects', 'search', 'vote']);

/**
 * Fields in which X may differ from Y (`sentence` is bookkeeping). CLOUD std-msh (CR 614.15, 611.2a): also the duration of the same instruction ("Gain control
 * of target creature until end of turn. If ..., gain control of that creature until the end of your next turn instead.", Evil's Thrall).
 */
// r4-repl (CR 614.15, 610.3): also how long a move's result lasts, "Exile that creature until ~ leaves the battlefield. If C, instead exile the chosen creature."
// (Turncoat Kunoichi: the same exile of the same object, without the return; `until` is the move's duration)
const REPLACEABLE_FIELDS: ReadonlySet<string> = new Set(['count', 'amount', 'units', 'to', 'token', 'sentence', 'duration', 'until']);

type Rec = Record<string, unknown>;
const isRec = (v: unknown): v is Rec => v !== null && typeof v === 'object' && !Array.isArray(v);

/** Canonical JSON (sorted keys, undefined dropped); with `numbers` false, the numbers inside `mods` (except the layer) are one value. */
function canon(v: unknown, numbers = true, inMods = false, key = ''): string {
  if (Array.isArray(v)) return `[${v.map((x) => canon(x, numbers, inMods, key)).join(',')}]`;
  if (!isRec(v)) return !numbers && inMods && key !== 'layer' && typeof v === 'number' ? '#' : (JSON.stringify(v) ?? 'undefined');
  // FAST5 T56 (CR 614.15, 702.34a): "gains flashback {0} until end of turn instead" replaces the cost of the keyword the earlier sentence granted ("equal to its mana cost"): the
  // cost of a granted keyword is an amount like the numbers of a modification, so it is one value too (the keyword itself, and the objects and duration, are not)
  const costless = !numbers && inMods && v['kind'] === 'keyword';
  return `{${Object.keys(v).filter((k) => v[k] !== undefined && !(costless && (k === 'cost' || k === 'costIsManaCost' || k === 'text'))).sort().map((k) => `${JSON.stringify(k)}:${canon(v[k], numbers, inMods || k === 'mods', k)}`).join(',')}}`;
}

/**
 * FAST5X E1: a condition decided when the spell is cast (its cast record: kicker, bargain, gift, CR 601.2b, 607.2i-j). "Y. If [it], X instead." with such a
 * condition is a choice between two instructions made at announcement: the spell has X's targets only if the condition holds and Y's only if it does not
 * (CR 601.2c, 702.166d, 702.174m; parser/lower/riders.ts gives Y's targets the negated condition), and nothing of Y is done when X is. So one instruction
 * may replace another one AS A WHOLE whatever its op and objects; a choice, a payment or control flow on either side is still refused.
 */
export function isCastChoice(c: unknown): boolean {
  if (!isRec(c)) return false;
  if (c['cond'] === 'not') return isCastChoice(c['of']);
  // r4-repl (CR 107.3, 601.2b): "if X is 10 or more" in a spell: X is announced as the spell is cast, before its targets (CR 601.2c), and never changes
  if (c['cond'] === 'compare' && isRec(c['left']) && c['left']['q'] === 'X' && Object.keys(c['left']).length === 1 && typeof c['right'] === 'number') return true;
  return c['cond'] === 'wasCast';
}

/**
 * FAST5X E19 (CR 601.2h, 603.3d, 614.15; opus): "Y. If five or more mana was spent to cast that spell, X instead." The mana spent to cast the triggering
 * spell was fixed when it was cast, before the ability triggered: the condition is decided before the ability is put on the stack and cannot change, so, as
 * with `isCastChoice`, one instruction may replace another as a whole whatever its op and objects ("this creature gets +3/+0 until end of turn. If ...,
 * put three +1/+1 counters on this creature instead"). Only when neither instruction has a target (no target needs a condition, CR 601.2c, 603.3d).
 */
export function isFixedChoice(c: unknown, y: unknown, x: unknown): boolean {
  if (!isRec(c) || c['cond'] !== 'compare' || hasTarget(y) || hasTarget(x)) return false;
  const left = c['left'];
  if (!isRec(left) || left['q'] !== 'spellManaSpent' || typeof c['right'] !== 'number') return false;
  const of = left['of'];
  return isRec(of) && of['ref'] === 'event' && of['role'] === 'spell';
}

/** The objects a continuous-effect step affects and the layers it changes (CR 613.1), or null when it is not only continuous effects. */
function layersOf(step: Rec): { affects: string; layers: Set<string> } | null {
  const effects = step['effects'];
  if (!Array.isArray(effects) || effects.length === 0) return null;
  const affects = new Set<string>();
  const layers = new Set<string>();
  for (const e of effects) {
    if (!isRec(e) || e['s'] !== 'continuous' || !Array.isArray(e['mods'])) return null;
    affects.add(canon(e['affects']));
    for (const m of e['mods']) if (isRec(m)) layers.add(String(m['layer']));
  }
  return { affects: [...affects].sort().join('|'), layers };
}

/** FAST5 batch 5 merge (CR 614.15, 613.1): X changes the same objects as Y in fewer layers, every one of them a layer Y changes too. */
function replacesPartOfEffect(y: Rec, x: Rec): boolean {
  const a = layersOf(y);
  const b = layersOf(x);
  if (a === null || b === null || a.affects !== b.affects) return false;
  return b.layers.size < a.layers.size && [...b.layers].every((l) => a.layers.has(l));
}

const hasTarget = (v: unknown): boolean => (Array.isArray(v) ? v.some(hasTarget) : isRec(v) && (v['ref'] === 'target' || Object.values(v).some(hasTarget)));

/** The keys of two steps outside `skip` all have the same value. */
const sameOutside = (y: Rec, x: Rec, skip: readonly string[]): boolean =>
  [...new Set([...Object.keys(y), ...Object.keys(x)])].every((k) => skip.includes(k) || canon(y[k]) === canon(x[k]));

/** Two lists of instructions, one for one, each unchanged or itself a replacement of the other as a whole (`notSelfReplacement`). */
const bodiesRestate = (ys: unknown, xs: unknown): boolean =>
  Array.isArray(ys) && Array.isArray(xs) && ys.length > 0 && ys.length === xs.length
  && ys.every((y, i) => isRec(y) && isRec(xs[i]) && (canon(y) === canon(xs[i]) || notSelfReplacement(y, xs[i]) === null));

/**
 * edh-replace-2 (CR 614.15, 608.2c): X is Y said again with other numbers, another pool or another consequence, in the same frame: the same player, the same
 * group, the same kind of choice. Four frames, each a whole instruction Y that "instead" can only replace as a whole:
 *   - a sacrifice choice by the same players with another filter and count ("Each opponent sacrifices a creature of their choice. If C, instead each opponent
 *     sacrifices half the creatures they control of their choice, rounded up.", Vona's Hunger);
 *   - a choice of cards by the same player from the same zone and owner with another description ("you may put a land card from your hand onto the battlefield
 *     tapped. If C, instead you may put a creature or land card ...", Composer of Spring; restated instruction for instruction, the move that follows is equal);
 *   - a "for each" over the same objects whose body restates the body ("Each opponent loses 3 life unless they discard a card. If C, instead each opponent loses
 *     6 life unless they discard two cards.", Court of Ambition);
 *   - a payment offer by the same player (another cost, and a consequence of not paying that restates the other one).
 */
function restatesFrame(y: Rec, x: Rec): boolean {
  const op = y['op'];
  if (typeof op !== 'string' || x['op'] !== op) return false;
  if (op === 'sacrificeChoice') return sameOutside(y, x, ['filter', 'count', 'sentence']);
  if (op === 'chooseObjects') {
    if (!sameOutside(y, x, ['from', 'min', 'max', 'sentence'])) return false;
    const a = y['from'];
    const b = x['from'];
    if (canon(a) === canon(b)) return true;
    if (!isRec(a) || !isRec(b) || a['ref'] !== 'each' || b['ref'] !== 'each' || !isRec(a['filter']) || !isRec(b['filter'])) return false;
    return Object.keys(a).every((k) => k === 'filter' || canon(a[k]) === canon(b[k])) && Object.keys(b).every((k) => k === 'filter' || k in a)
      && canon(a['filter']['zone']) === canon(b['filter']['zone']) && canon(a['filter']['owner']) === canon(b['filter']['owner']) && a['filter']['zone'] !== undefined;
  }
  if (op === 'forEach') return sameOutside(y, x, ['do', 'sentence']) && bodiesRestate(y['do'], x['do']);
  if (op === 'pay' && Array.isArray(y['else']) && Array.isArray(x['else'])) return sameOutside(y, x, ['cost', 'else', 'sentence']) && bodiesRestate(y['else'], x['else']);
  return false;
}

/** edh-replace-2: instructions of the player who acts, with one count or amount and no object of their own: "Scry 1. If C, draw a card instead." */
const PLAYER_OPS: ReadonlySet<string> = new Set(['scry', 'surveil', 'draw', 'mill', 'gainLife', 'loseLife']);

/** Why X does not replace Y as a whole (CR 614.15), or null when it does. `castChoice`: the condition is decided at announcement (`isCastChoice`). */
export function notSelfReplacement(y: unknown, x: unknown, castChoice = false): string | null {
  if (!isRec(y) || !isRec(x)) return 'not a step';
  const op = y['op'];
  // edh-replace-2 (CR 614.15): the same frame restated with another amount, pool or consequence (`restatesFrame`)
  if (restatesFrame(y, x)) return null;
  // edh-next-65 (CR 614.15, 603.7b, 707.10; Sea Gate Stormcaller): "Copy the next instant or sorcery spell ... you cast this turn when you cast it. If ~ was kicked, copy that spell twice instead.":
  // the same delayed trigger (the same event, once, the same duration) whose one copy of the spell that event names is made twice; nothing else changes
  if (op === 'delay' && x['op'] === 'delay' && sameOutside(y, x, ['do', 'sentence']) && Array.isArray(y['do']) && Array.isArray(x['do']) && y['do'].length === 1 && x['do'].length === 1
    && isRec(y['do'][0]) && isRec(x['do'][0]) && y['do'][0]['op'] === 'copy' && x['do'][0]['op'] === 'copy' && y['do'][0]['count'] === undefined && x['do'][0]['count'] === 2
    && sameOutside(y['do'][0], x['do'][0], ['count', 'newTargets', 'sentence', 'span', 'as'])) return null;
  // FAST5X E11 (CR 614.15, 118.12): "Counter target spell unless its controller pays {2}. ... counter that spell unless its controller pays {4} instead": the
  // same offer to the same player with the same consequence, only another cost to pay (the amount of the payment is what "instead" replaces)
  if (op === 'pay' && x['op'] === 'pay') {
    for (const k of new Set([...Object.keys(y), ...Object.keys(x)])) {
      if (k === 'cost' || k === 'sentence') continue;
      if (canon(y[k]) !== canon(x[k])) return `X changes ${k} of the payment, not only its cost`;
    }
    return null;
  }
  // edh-replace-1 (CR 614.15, 118.12a, 701.6a; Stubborn Denial): "Counter target noncreature spell unless its controller pays {1}. If you control a creature with power 4 or
  // greater, counter that spell instead.": the replaced instruction is the counter with its offer to pay (`pay` whose only consequence is that counter), the new one is
  // exactly that counter without the offer; the same spell, nothing else changes
  if (op === 'pay' && x['op'] === 'counter') {
    const els = y['else'];
    if (Array.isArray(els) && els.length === 1 && canon(els[0]) === canon(x) && y['optional'] === undefined) return null;
    return 'the new counter is not the one the payment offer is about';
  }
  // r4-repl (CR 614.15, 608.2c): "Put one of those cards into your hand. If C, put two of those cards into your hand instead.": the same choice by the same player
  // from the same cards with another number of cards (`min` / `max`) is that choice with another amount, nothing else
  if (op === 'chooseObjects' && x['op'] === 'chooseObjects') {
    for (const k of new Set([...Object.keys(y), ...Object.keys(x)])) {
      if (k === 'min' || k === 'max' || k === 'sentence') continue;
      if (canon(y[k]) !== canon(x[k])) return `X changes ${k} of the choice, not only how many objects are chosen`;
    }
    return null;
  }
  // pc-keywords-mana-2 (CR 614.15, 605.1a; Ilysian Caryatid): "Add one mana of any color. If C, add two mana of any one color instead.": the same player adds another production
  if (op === 'addMana' && x['op'] === 'addMana') {
    for (const k of new Set([...Object.keys(y), ...Object.keys(x)])) {
      if (k === 'units' || k === 'dynamic' || k === 'sentence') continue;
      if (canon(y[k]) !== canon(x[k])) return `X changes ${k} of the mana, not only what is added`;
    }
    return null;
  }
  // edh-players-1 (CR 614.15, 111.2, 707.2; Scute Swarm): "Create a 1/1 green Insect creature token. If you control six or more lands, create a token that's a copy of this
  // creature instead.": the same player creates the same number of tokens, a copy of an object instead of a described token. Both are one instruction that creates
  // tokens; neither has a target (CR 601.2c), and the copy has no exception, tapped or attacking rider that the described token would not have
  if (!castChoice && op === 'createToken' && x['op'] === 'copy' && x['result'] === 'token') {
    if (hasTarget(y) || hasTarget(x)) return 'a token copy of a target instead of a token (a target needs a condition at announcement)';
    for (const k of Object.keys(x)) {
      if (k === 'op' || k === 'what' || k === 'result' || k === 'sentence' || k === 'who' || k === 'count') continue;
      if (x[k] !== undefined) return `the token copy has a ${k} that the token it replaces does not`;
    }
    for (const k of Object.keys(y)) {
      if (k === 'op' || k === 'token' || k === 'who' || k === 'count' || k === 'sentence') continue;
      if (y[k] !== undefined) return `the token it replaces has a ${k} that its token copy does not`;
    }
    if (canon(y['who']) !== canon(x['who'])) return 'X changes who creates the tokens';
    if (canon(y['count'] ?? 1) !== canon(x['count'] ?? 1)) return 'X changes how many tokens are created, not only what they are';
    return null;
  }
  // edh-top-15 (CR 614.15, 608.2c, 508.4; Andúril, Flame of the West): "Create two tapped 1/1 ... tokens. If C, instead create two of those tokens that are tapped and attacking.": the same
  // tokens in the same number, already tapped, now also created attacking (the rider adds only `attacking`)
  if (!castChoice && op === 'createToken' && x['op'] === 'createToken' && y['attacking'] === undefined && x['attacking'] === true && y['tapped'] === true && x['tapped'] === true && sameOutside(y, x, ['attacking', 'sentence'])) return null;
  // edh-d-7 (CR 614.15, 608.2c, 121.1; Kumena's Awakening): "Each player draws a card. If C, instead only you draw a card.": the same draw by one player alone (the group of players
  // is replaced as a whole by you), the same number of cards, neither side with a target or anything else
  if (op === 'draw' && x['op'] === 'draw' && isRec(y['who']) && y['who']['ref'] === 'each' && y['who']['who'] === 'player' && isRec(x['who']) && x['who']['ref'] === 'you' && Object.keys(x['who']).length === 1
    && canon(y['count'] ?? 1) === canon(x['count'] ?? 1) && sameOutside(y, x, ['who', 'sentence'])) return null;
  // edh-replace-4 (CR 614.15, 608.2c, 701.8a; Fatal Push): "Destroy target creature if it has mana value 2 or less. Destroy that creature if it has mana value 4 or less instead if C.": the
  // same destroy of the same objects with another test of its own (`guard`, template eff.r4dig.destroy.if): the instruction the sentence before says is replaced as a whole
  if (op === 'destroy' && x['op'] === 'destroy' && y['guard'] !== undefined && x['guard'] !== undefined && sameOutside(y, x, ['guard', 'sentence'])) return null;
  // edh-d-57 (CR 614.15, 608.2c, 701.8a; Anoint with Affliction): "Exile target creature if it has mana value 3 or less. Exile that creature instead if its controller has three or more poison
  // counters.": the same move of the same objects with its own test (`guard`) taken away: when C holds as the spell resolves the unconditional move is done and the guarded one is not
  if (!castChoice && op === 'move' && x['op'] === 'move' && y['guard'] !== undefined && x['guard'] === undefined && sameOutside(y, x, ['guard', 'sentence'])) return null;
  // edh-replace-4 (CR 614.15, 120.10; Ram Through): "Target creature you control deals damage equal to its power to target creature you don't control. If the creature you control has
  // trample, excess damage is dealt to that creature's controller instead.": the same damage from the same source to the same recipient, now with its excess going to the controller
  if (op === 'damage' && x['op'] === 'damage' && y['excessToController'] === undefined && x['excessToController'] === true && sameOutside(y, x, ['excessToController', 'sentence'])
    && y['also'] === undefined && y['perSource'] === undefined && y['divided'] === undefined) return null;
  // edh-replace-7 (CR 614.15, 608.2d; Emeria Shepherd): "You may return target nonland permanent card from your graveyard to your hand. If that land is a Plains, you may return that nonland
  // permanent card to the battlefield instead.": the same player's choice on each side, each choice being one instruction that replaces the other as a whole (the same instruction on
  // the same objects with another destination, amount...)
  if (op === 'may' && x['op'] === 'may') {
    for (const k of new Set([...Object.keys(y), ...Object.keys(x)])) {
      if (k === 'do' || k === 'sentence') continue;
      if (canon(y[k]) !== canon(x[k])) return `X changes ${k} of the choice, not only what is done`;
    }
    const yd = y['do'];
    const xd = x['do'];
    if (!Array.isArray(yd) || !Array.isArray(xd) || yd.length !== 1 || xd.length !== 1) return 'the choices are not one instruction each';
    return notSelfReplacement(yd[0], xd[0], castChoice);
  }
  // edh-next-35 (CR 608.2c, 614.15, 701.21a; Epicenter): "Target player sacrifices a land of their choice. Each player sacrifices all lands they control instead if C.": when C holds as the spell
  // resolves, the second instruction is done and the first is not. The second names no target of its own (the spell's one target is the first one's player, still announced and checked
  // as the spell resolves, CR 608.2b), it sacrifices the same kind of permanent (all of them, each player's own) and nothing else changes
  if (!castChoice && op === 'sacrificeChoice' && x['op'] === 'sacrificeChoice' && !hasTarget(x) && x['mode'] === 'all' && y['mode'] === undefined && y['count'] === 1) {
    const yf = isRec(y['filter']) ? y['filter'] : undefined;
    const xf = isRec(x['filter']) ? x['filter'] : undefined;
    const xw = x['who'];
    if (yf !== undefined && xf !== undefined && canon(yf['types']) === canon(xf['types']) && Object.keys(yf).every((k) => k === 'types') && Object.keys(xf).every((k) => k === 'types' || k === 'controller')
      && canon(xf['controller']) === canon({ ref: 'iterating' }) && isRec(xw) && xw['ref'] === 'each' && xw['who'] === 'player') return null;
    return 'X is not the same kind of sacrifice by every player';
  }
  // edh-next-53 (CR 614.15, 615.1, 608.2c; Winds of Qal Sisma): "Prevent all combat damage that would be dealt this turn. If C, instead prevent all combat damage that would be dealt this turn by
  // creatures your opponents control.": the same prevention of the same damage (one shield each, the same duration and amount, no target) now limited to the damage of some sources. When C holds as the
  // spell resolves the second shield is made and the first is not (the narrower shield replaces the whole of the first, nothing else of the sentence changes)
  if (op === 'effect' && x['op'] === 'effect' && !hasTarget(y) && !hasTarget(x) && sameOutside(y, x, ['effects', 'sentence'])) {
    const ye = y['effects'];
    const xe = x['effects'];
    if (Array.isArray(ye) && Array.isArray(xe) && ye.length === 1 && xe.length === 1 && isRec(ye[0]) && isRec(xe[0]) && ye[0]['s'] === 'replace' && xe[0]['s'] === 'replace'
      && canon(ye[0]['body']) === canon(xe[0]['body']) && sameOutside(ye[0], xe[0], ['replaces']) && isRec(ye[0]['replaces']) && isRec(xe[0]['replaces'])
      && ye[0]['replaces']['ev'] === 'damage' && ye[0]['replaces']['source'] === undefined && xe[0]['replaces']['source'] !== undefined
      && sameOutside(ye[0]['replaces'], xe[0]['replaces'], ['source'])) return null;
  }
  // edh-next-61 (CR 614.15, 611.2a, 613.4c; Golden Demise): "All creatures get -2/-2 until end of turn. If C, instead only creatures your opponents control get -2/-2 until end of turn.": the same
  // continuous effect (one, no target, the same duration and modifications) on the objects of a narrower description of the same kind (the first description's every field kept, one or more
  // added). When C holds as the spell resolves the narrower effect is made and the first is not (the narrower effect replaces the whole of the first, nothing else of the sentence changes)
  if (op === 'effect' && x['op'] === 'effect' && !hasTarget(y) && !hasTarget(x) && sameOutside(y, x, ['effects', 'sentence'])) {
    const ye = y['effects'];
    const xe = x['effects'];
    if (Array.isArray(ye) && Array.isArray(xe) && ye.length === 1 && xe.length === 1 && isRec(ye[0]) && isRec(xe[0]) && ye[0]['s'] === 'continuous' && xe[0]['s'] === 'continuous'
      && canon(ye[0]['mods']) === canon(xe[0]['mods']) && sameOutside(ye[0], xe[0], ['affects']) && isRec(ye[0]['affects']) && isRec(xe[0]['affects'])
      && ye[0]['affects']['ref'] === 'each' && xe[0]['affects']['ref'] === 'each' && isRec(ye[0]['affects']['filter']) && isRec(xe[0]['affects']['filter'])
      && Object.keys(ye[0]['affects']).length === 2 && Object.keys(xe[0]['affects']).length === 2) {
      const yf = ye[0]['affects']['filter'];
      const xf = xe[0]['affects']['filter'];
      if (Object.keys(yf).every((k) => canon(yf[k]) === canon(xf[k])) && Object.keys(xf).length > Object.keys(yf).length) return null;
    }
  }
  // edh-next-145 (CR 614.15, 608.2c, 608.2d; Mythos of Snapdax): "Each player chooses an artifact, ... from among the nonland permanents they control, then sacrifices the rest. If C, you choose
  // the permanents for each player instead.": the same keep-one-of-each-type sacrifice by every player, with only who chooses the kept permanents changed to you (`chooser`)
  if (op === 'sacrificeChoice' && x['op'] === 'sacrificeChoice' && y['mode'] === 'keepEachType' && y['chooser'] === undefined && canon(x['chooser']) === canon({ ref: 'you' }) && sameOutside(y, x, ['chooser', 'sentence'])) return null;
  if (typeof op !== 'string' || NOT_ONE_INSTRUCTION.has(op)) return `the replaced instruction is a ${String(op)} step, not one instruction`;
  // FAST5 batch 5 merge (CR 614.15: "part or all" of the effect; CR 613.1): "Until end of turn, target artifact or creature becomes an artifact creature with
  // base power and toughness 4/3. If evidence was collected, it has base power and toughness 1/1 until end of turn instead." (Behind the Mask): a continuous
  // effect on the same objects that changes only some of the layers the replaced one changes replaces only that part; as a whole it would drop the rest
  // (here the type change), so the fold is refused even with a condition decided at announcement
  if (castChoice && op === 'effect' && x['op'] === 'effect' && replacesPartOfEffect(y, x)) return 'X changes only some of the layers of the continuous effect it replaces';
  // r4-repl (CR 608.2c, 601.2b): the new instructions may include a choice of objects that a later one of them acts on ("untap up to five lands"): it is part of
  // doing them, not an option to do them or not (a `may` or a payment on either side is still refused)
  // trek-8 (CR 614.15, 601.2c, 608.2c): or a "for each" over the objects it names ("If this spell was kicked, instead for each creature target opponent controls, create
  // a token that's a copy of that creature"): the loop is the whole of what is done in place of Y, chosen at announcement like any other instruction
  if (castChoice) return typeof x['op'] !== 'string' || (NOT_ONE_INSTRUCTION.has(x['op']) && x['op'] !== 'chooseObjects' && x['op'] !== 'forEach') ? `the new instruction is a ${String(x['op'])} step, not one instruction` : null;
  if (x['op'] !== op) return `another instruction (${String(x['op'])} for ${op})`;
  // edhv31 (CR 614.15, 615.12; Arrow Storm): "~ deals 4 damage to any target. If you attacked this turn, instead ~ deals 5 damage to that permanent or player and the damage can't be
  // prevented.": the same damage with another amount that now can't be prevented (the rider adds only `unpreventable`)
  const unpreventableNow = op === 'damage' && x['unpreventable'] === true && y['unpreventable'] === undefined;
  for (const k of new Set([...Object.keys(y), ...Object.keys(x)])) {
    if (REPLACEABLE_FIELDS.has(k) || (unpreventableNow && k === 'unpreventable')) continue;
    // edh-c-54 (CR 614.15, 608.2c; Sulfurous Blast): the second recipient of one damage step ("to each creature and each player") is replaced with the first: the same recipients, only the amounts differ
    if (op === 'damage' && k === 'also' && alsoSameRecipients(y[k], x[k])) continue;
    // one continuous effect with other numbers ("gets +4/+4 instead"); another modification or another object is not that
    const numbersOnly = op === 'effect' && k === 'effects';
    if (canon(y[k], !numbersOnly) !== canon(x[k], !numbersOnly)) return `X changes ${k}, not only an amount or a destination`;
  }
  return null;
}

/** edh-c-54 (CR 614.15, 120.3): the extra recipients of two damage steps are the same ones (their amounts may differ). */
function alsoSameRecipients(a: unknown, b: unknown): boolean {
  if (!Array.isArray(a) || !Array.isArray(b) || a.length !== b.length) return false;
  return a.every((e, i) => isRec(e) && isRec(b[i]) && canon(e['to']) === canon((b[i] as Rec)['to']));
}

/** `if C then [X] else [Y]` reads "Y. If C, X instead." (CR 614.15). */
export const isSelfReplacement = (then: readonly unknown[], els: readonly unknown[], castChoice = false): boolean =>
  // FAST5X E11: a choice made at announcement may replace one instruction with several (parser/lower/riders.ts#applyRider)
  (then.length === 1 || (castChoice && then.length > 1)) && els.length === 1 && then.every((x) => notSelfReplacement(els[0], x, castChoice) === null);

/*
 * CLOUD C9 (CR 608.2c, 614.15; rules unverified in this checkout): an "instead" sentence that replaces a different instruction, or a whole sentence of several
 * instructions. In spell text "Y. If C, [instead] X [instead]." says X is done in place of the instruction(s) of the sentence before it, decided as the ability
 * resolves (CR 608.2c); it is the self-replacement of CR 614.15, not a replacement effect that watches an event (CR 614.1a). What X replaces is decided from the
 * sentence structure only, and only when that leaves one reading:
 *   - one instruction by ANOTHER instruction on the same objects ("All creatures get -2/-2 until end of turn. If C, destroy all creatures instead.", "Target
 *     creature gets +2/+2 until end of turn. If C, instead put two +1/+1 counters on it."): X names again exactly the objects Y acts on, so it replaces Y and
 *     nothing else. Instructions on players only ("You gain 2 life. If C, draw two cards instead.") stay refused (WP23 review);
 *   - a search by a search of the same player, zone and result ("Search your library for a basic land card. If C, instead search your library for a creature
 *     card. Reveal that card, ..."): the description and the number of cards are what X changes (CR 701.23);
 *   - one instruction by several, each on the same objects as Y ("... gets +2/+2 until end of turn. If C, instead put a +1/+1 counter on it and it gets +1/+1
 *     until end of turn.");
 *   - a sentence of several instructions by a sentence that restates it instruction for instruction, the same ops in the same order ("Search ..., reveal it, put
 *     it into your hand, then shuffle. If C, instead search ..., put it into your hand, then shuffle."): the whole sentence is replaced.
 * Under a condition decided as the ability resolves, X may not have a target Y does not have (it would be chosen as the spell is cast whether or not X is done,
 * CR 601.2c); a "may" on either side, a partial replacement (a subset of a group, some layers of an effect) and anything else stay refused (manual).
 */

/** The field naming the objects an instruction of each op acts on (CLOUD C9). `damage` names a recipient that may be a player: it is only ever compared with an
 *  instruction of ANOTHER op, which names objects, so an equal value is an object. */
const OBJECT_FIELD: Readonly<Record<string, string>> = {
  destroy: 'what', move: 'what', sacrifice: 'what', counter: 'what', tap: 'what', untap: 'what', phaseOut: 'what', regenerate: 'what', removeFromCombat: 'what',
  changeFace: 'what', putCounters: 'on', removeCounters: 'from', action: 'subject', damage: 'to',
};

/** CLOUD C9: the objects one instruction acts on (canonical JSON), or null when it is not one instruction on one set of objects. */
function objectsOf(step: Rec): string | null {
  const op = step['op'];
  if (op === 'effect') {
    const l = layersOf(step);
    return l !== null && !l.affects.includes('|') ? l.affects : null;
  }
  if (op === 'damage' && (step['also'] !== undefined || step['perSource'] !== undefined || step['divided'] !== undefined)) return null;
  const field = typeof op === 'string' && Object.hasOwn(OBJECT_FIELD, op) ? OBJECT_FIELD[op]! : undefined;
  const v = field === undefined ? undefined : step[field];
  return isRec(v) ? canon(v) : null;
}

/**
 * CLOUD C9: X is another instruction on exactly the objects Y acts on (each one instruction). With the same op only a continuous effect qualifies, and only
 * when it changes every layer Y changes ("it gets +1/+1 ... If C, it gets +2/+2 and gains indestructible ... instead"); one that changes fewer replaces only
 * part of Y (Behind the Mask, `replacesPartOfEffect`) and is refused.
 */
function otherInstructionOnSameObjects(y: Rec, x: Rec): boolean {
  if (typeof y['op'] !== 'string' || typeof x['op'] !== 'string' || NOT_ONE_INSTRUCTION.has(y['op']) || NOT_ONE_INSTRUCTION.has(x['op'])) return false;
  if (x['op'] === y['op']) {
    if (x['op'] !== 'effect') return false;
    const a = layersOf(y);
    const b = layersOf(x);
    return a !== null && b !== null && a.affects === b.affects && !a.affects.includes('|') && [...a.layers].every((l) => b.layers.has(l));
  }
  const a = objectsOf(y);
  return a !== null && a === objectsOf(x);
}

/**
 * edh-replace-2 (CR 614.15, 608.2c): "Scry 1. If this is the second time this ability has resolved this turn, draw a card instead." (Rumor Gatherer): one
 * instruction of you (a scry, a draw, life ...) by another one of you. The sentence before is that one instruction, so what "instead" replaces is not a guess; a
 * target or a name the earlier one binds would be (the condition is decided as the ability resolves, CR 601.2c), so neither has either.
 */
function otherInstructionOfYou(y: Rec, x: Rec): boolean {
  const ok = (s: Rec): boolean => typeof s['op'] === 'string' && PLAYER_OPS.has(s['op']) && isRec(s['who']) && s['who']['ref'] === 'you' && Object.keys(s).every((k) => ['op', 'who', 'count', 'amount', 'sentence'].includes(k)) && !hasTarget(s);
  return y['op'] !== x['op'] && ok(y) && ok(x);
}

/** CLOUD C9 (CR 701.23): X is a search by the same player of the same zone with the same result name; only what is searched for (and how many) differs. */
function searchForSearch(y: Rec, x: Rec): boolean {
  return y['op'] === 'search' && x['op'] === 'search' && ['who', 'zone', 'owner', 'as'].every((k) => canon(y[k]) === canon(x[k]));
}

const targetIds = (v: unknown, out: Set<string> = new Set()): Set<string> => {
  if (Array.isArray(v)) for (const x of v) targetIds(x, out);
  else if (isRec(v)) {
    if (v['ref'] === 'target' && typeof v['id'] === 'string') out.add(v['id']);
    for (const x of Object.values(v)) targetIds(x, out);
  }
  return out;
};

/** CLOUD C9 (CR 601.2c): X names a target that the replaced sentence Y does not. */
function newTarget(ys: readonly unknown[], xs: readonly unknown[]): boolean {
  const have = targetIds(ys);
  return [...targetIds(xs)].some((id) => !have.has(id));
}

/**
 * r4-repl (CR 614.15, 701.20e, 608.2c): `ys` is [a choice by you among a group G still in the library, the move of the chosen cards to Z, the move of the rest of G]
 * and `x` is the move of every card of G (still in the library) to Z: x does with every card what ys does with the chosen ones, so it replaces the whole sentence.
 */
export function everyCardInstead(ys: readonly Rec[], x: Rec): boolean {
  if (ys.length !== 3) return false;
  const [a, b, c] = ys as [Rec, Rec, Rec];
  if (a['op'] !== 'chooseObjects' || b['op'] !== 'move' || c['op'] !== 'move' || x['op'] !== 'move' || typeof a['as'] !== 'string') return false;
  const from = a['from'];
  const pool = isRec(from) && from['ref'] === 'each' && isRec(from['filter']) ? from['filter'] : null;
  if (pool === null || pool['zone'] !== 'library' || !isRec(pool['is']) || Object.keys(pool).some((k) => k !== 'is' && k !== 'zone')) return false;
  if (canon(b['what']) !== canon({ ref: 'bound', name: a['as'] }) || b['as'] !== undefined || c['as'] !== undefined || x['as'] !== undefined) return false;
  const rest = c['what'];
  if (!isRec(rest) || rest['ref'] !== 'each' || !isRec(rest['filter']) || canon(rest['filter']['is']) !== canon(pool['is']) || canon(rest['filter']['not']) !== canon({ is: { ref: 'bound', name: a['as'] } })) return false;
  return canon(x['what']) === canon({ ref: 'each', filter: { is: pool['is'], zone: 'library' } }) && canon(x['to']) === canon(b['to']) && Object.keys(x).every((k) => k === 'op' || k === 'what' || k === 'to' || k === 'sentence');
}

/**
 * edh-zones-25 (CR 614.15, 608.2c, 608.2d; Haunting Voyage): `ys` is [your choice of up to N objects among those of a description, the move of the chosen ones to Z] and `x` is the
 * move of every object of that very description to Z: x does with all of them what ys does with the chosen ones, so it replaces the whole sentence.
 */
export function everyChosenInstead(ys: readonly Rec[], x: Rec): boolean {
  if (ys.length !== 2) return false;
  const [a, b] = ys as [Rec, Rec];
  // edh-top-10 (CR 614.15, 701.26b; White Plume Adventurer): the same for "Untap a creature you control. If C, untap all creatures you control instead." (a choice of one, then the untap of the chosen one)
  if (a['op'] === 'chooseObjects' && b['op'] === 'untap' && x['op'] === 'untap' && typeof a['as'] === 'string' && a['guard'] === undefined && b['guard'] === undefined && x['guard'] === undefined) {
    if (canon(a['who']) !== canon({ ref: 'you' }) || (a['min'] !== 0 && a['min'] !== 1) || typeof a['max'] !== 'number' || a['random'] === true || Object.keys(a).some((k) => !['op', 'who', 'from', 'min', 'max', 'as'].includes(k))) return false;
    const pool = a['from'];
    if (!isRec(pool) || pool['ref'] !== 'each' || !isRec(pool['filter'])) return false;
    return canon(b['what']) === canon({ ref: 'bound', name: a['as'] }) && Object.keys(b).every((k) => k === 'op' || k === 'what') && canon(x['what']) === canon(pool) && Object.keys(x).every((k) => k === 'op' || k === 'what' || k === 'sentence');
  }
  if (a['op'] !== 'chooseObjects' || b['op'] !== 'move' || x['op'] !== 'move' || typeof a['as'] !== 'string' || a['guard'] !== undefined || b['guard'] !== undefined) return false;
  if (canon(a['who']) !== canon({ ref: 'you' }) || a['min'] !== 0 || typeof a['max'] !== 'number' || a['random'] === true || Object.keys(a).some((k) => !['op', 'who', 'from', 'min', 'max', 'as'].includes(k))) return false;
  const from = a['from'];
  if (!isRec(from) || from['ref'] !== 'each' || !isRec(from['filter'])) return false;
  if (canon(b['what']) !== canon({ ref: 'bound', name: a['as'] }) || b['as'] !== undefined || Object.keys(b).some((k) => !['op', 'what', 'to'].includes(k))) return false;
  return canon(x['what']) === canon(from) && canon(x['to']) === canon(b['to']) && x['as'] === undefined && Object.keys(x).every((k) => k === 'op' || k === 'what' || k === 'to' || k === 'sentence');
}

/** edh-next-10: the instructions that may follow the replacing one in "If C, instead A, then B." (nothing of them replaces anything). */
const FOLLOWING_AFTER_INSTEAD: ReadonlySet<string> = new Set(['scry', 'createToken', 'draw', 'gainLife', 'loseLife', 'putCounters']);

/** edh-d-5: a destroy as canonical JSON without its `regeneration` rider and `sentence` bookkeeping. */
const canonNoRegen = (d: Rec): string => canon({ ...d, regeneration: undefined, sentence: undefined });

/** r4-repl: X is Y with another acting player (`who`, a player either way) and perhaps another amount, nothing else (one instruction each). */
function otherPlayerOnly(y: Rec, x: Rec): boolean {
  if (y['op'] !== x['op'] || typeof y['op'] !== 'string' || NOT_ONE_INSTRUCTION.has(y['op']) || !isRec(y['who']) || !isRec(x['who'])) return false;
  const players = new Set(['you', 'each', 'opponent', 'controllerOf', 'ownerOf', 'target', 'defending', 'activePlayer']);
  if (!players.has(String(y['who']['ref'])) || !players.has(String(x['who']['ref'])) || (x['who']['ref'] === 'target' && y['who']['ref'] !== 'target')) return false;
  for (const k of new Set([...Object.keys(y), ...Object.keys(x)])) {
    if (k === 'who' || REPLACEABLE_FIELDS.has(k)) continue;
    if (canon(y[k]) !== canon(x[k])) return false;
  }
  return true;
}

/**
 * Why `if C then xs else ys` is not "ys. If C, [instead] xs [instead]." with the sentence `ys` replaced as a whole (CR 614.15, 608.2c), or null when it is.
 * The readings of WP23, FAST5X E1/E11/E19 (`notSelfReplacement`) and those of CLOUD C9 (the comment above). `castChoice`: `cond` is decided at announcement
 * (`isCastChoice`; the parser passes it only for a spell). Shared by parser/lower/riders.ts#applyRider and render/steps-flow.ts, so the gate never reads a
 * fold the parser would not build.
 */
export function notWideReplacement(ys: readonly unknown[], xs: readonly unknown[], cond: unknown, castChoice = false): string | null {
  if (ys.length === 0 || xs.length === 0 || !ys.every(isRec) || !xs.every(isRec)) return 'not a step';
  if (ys.length === 1) {
    const y = ys[0]!;
    // WP23 / FAST5X: one instruction replaced as a whole (E19: a condition fixed before the ability triggered allows any one; E11: at announcement, several)
    const why = xs.length === 1 || castChoice ? xs.map((x) => notSelfReplacement(y, x, castChoice || isFixedChoice(cond, y, x))).find((w) => w !== null) ?? null
      : '"instead" with several instructions';
    if (why === null) return null;
    if (!castChoice && newTarget(ys, xs)) return why;
    // CLOUD C9: a search by a search, another instruction on the same objects, or several instructions each on the same objects
    if (xs.length === 1 && (searchForSearch(y, xs[0]!) || otherInstructionOnSameObjects(y, xs[0]!) || otherInstructionOfYou(y, xs[0]!))) return null;
    if (xs.length > 1 && xs.every((x) => otherInstructionOnSameObjects(y, x) || (x['op'] === y['op'] && notSelfReplacement(y, x) === null))) return null;
    // edh-next-10 (CR 614.15, 608.2c; Anticognition, Kirtar's Wrath): "If C, instead A, then B.": A replaces the one instruction as a whole (every reading above, alone) and B is
    // done after it, only in this case; `if C then [A, B] else [the instruction]` is exactly those words
    if (xs.length > 1 && !castChoice && FOLLOWING_AFTER_INSTEAD.has(String(xs[xs.length - 1]!['op'])) && xs.slice(1).every((x) => FOLLOWING_AFTER_INSTEAD.has(String(x['op'])))
      && notWideReplacement(ys, [xs[0]!], cond, castChoice) === null) return null;
    // edh-d-5 (CR 614.15, 608.2c, 701.8a; Kirtar's Wrath): "Destroy all creatures. They can't be regenerated. If C, instead destroy all creatures, then create two 1/1 tokens. Creatures destroyed
    // this way can't be regenerated.": X restates the one destroy (a no-regeneration rider on either side comes in its own sentence) and does the following instructions after it, only in this
    // case; `if C then [destroy, B] else [destroy]` is exactly those words
    if (xs.length > 1 && !castChoice && y['op'] === 'destroy' && xs[0]!['op'] === 'destroy' && canonNoRegen(y) === canonNoRegen(xs[0]!) && xs.slice(1).every((x) => FOLLOWING_AFTER_INSTEAD.has(String(x['op'])))) return null;
    // edh-next-93 (CR 614.15, 608.2c, 701.6a; Bane's Contingency): "Counter target spell. If C, instead counter that spell, scry 2, then draw a card.": X restates the one counter (the same spell, nothing
    // else different) and does the following instructions after it, only in this case; `if C then [counter, B] else [counter]` is exactly those words
    if (xs.length > 1 && !castChoice && y['op'] === 'counter' && xs[0]!['op'] === 'counter' && canon(y) === canon(xs[0]!) && xs.slice(1).every((x) => FOLLOWING_AFTER_INSTEAD.has(String(x['op'])))) return null;
    return why;
  }
  // r4-repl (CR 614.15, 701.20e): "Put one of them into your hand and the rest on the bottom of your library in any order. Put each of those cards into your hand
  // instead if C." (Accumulate Wisdom): the choice among a group looked at, the move of the chosen cards and the move of the rest, replaced by the move of every
  // card of the group to where the chosen ones would go
  if (xs.length === 1 && everyCardInstead(ys, xs[0]!)) return null;
  // edh-zones-25 (CR 614.15, 608.2c; Haunting Voyage): "Return up to two creature cards ... to the battlefield. If C, return all creature cards ... to the battlefield instead."
  if (xs.length === 1 && everyChosenInstead(ys, xs[0]!)) return null;
  // CLOUD C9: a sentence of several instructions is replaced only by a sentence that restates it instruction for instruction
  if (xs.length !== ys.length) return '"instead" after a sentence with several instructions';
  if (!castChoice && newTarget(ys, xs)) return 'X names a target the replaced sentence does not (CR 601.2c)';
  let changed = false;
  for (let i = 0; i < ys.length; i++) {
    const y = ys[i]!;
    const x = xs[i]!;
    if (canon(y) === canon(x)) continue;
    changed = true;
    if (x['op'] !== y['op']) return `instruction ${i + 1} of X is another instruction (${String(x['op'])} for ${String(y['op'])})`;
    if (searchForSearch(y, x)) continue;
    const w = notSelfReplacement(y, x, castChoice);
    // r4-repl (CR 614.15, 608.2c): in a sentence restated instruction for instruction, an instruction may also name another player ("You draw two cards and lose
    // 2 life. If C, instead you draw two cards and each opponent loses 2 life."): the whole sentence is replaced, so which instruction X replaces is not a guess
    if (w !== null && !(ys.length > 1 && otherPlayerOnly(y, x))) return `instruction ${i + 1}: ${w}`;
  }
  return changed ? null : 'X repeats the sentence it replaces';
}

/** `if C then xs else ys` reads "ys. If C, [instead] xs [instead]." (CR 614.15; CLOUD C9: `notWideReplacement`). */
export const isWideReplacement = (then: readonly unknown[], els: readonly unknown[], cond: unknown): boolean =>
  notWideReplacement(els, then, cond, isCastChoice(cond)) === null;

/**
 * edh-next-141 (CR 608.2d, 613.1f, 702.1): the three steps of "<object> gains your choice of K1 or K2 <duration>" (zz-fast5/t41.json#eff.t41.gains.choice2): a choice of one of two
 * keywords, then one `if` per option granting that keyword to the same object for the same duration. Returns the object and the duration, or null.
 */
export function keywordChoiceGrant(sentence: readonly unknown[]): { affects: unknown; duration: unknown } | null {
  const [choose, ...ifs] = sentence;
  if (!ifs.every(isRec)) return null;
  if (!isRec(choose) || choose['op'] !== 'chooseValue' || choose['what'] !== 'option' || typeof choose['link'] !== 'string' || !Array.isArray(choose['options']) || choose['options'].length !== ifs.length || ifs.length !== 2) return null;
  let found: { affects: unknown; duration: unknown } | null = null;
  for (const [i, x] of ifs.entries()) {
    const cond = x['cond'];
    if (x['op'] !== 'if' || x['else'] !== undefined || !isRec(cond) || cond['cond'] !== 'chosen' || cond['link'] !== choose['link'] || cond['equals'] !== choose['options'][i]) return null;
    const then = x['then'];
    if (!Array.isArray(then) || then.length !== 1 || !isRec(then[0])) return null;
    const g = grantOf(then[0]);
    if (g === null || (found !== null && (canon(g.affects) !== canon(found.affects) || canon(g.duration) !== canon(found.duration)))) return null;
    found = g;
  }
  return found;
}
/** One `effect` step of one continuous effect that only adds keywords in layer 6 to one object: its object and duration. */
function grantOf(x: Rec): { affects: unknown; duration: unknown } | null {
  const effects = x['effects'];
  if (x['op'] !== 'effect' || !Array.isArray(effects) || effects.length !== 1 || !isRec(effects[0])) return null;
  const e = effects[0];
  const mods = e['mods'];
  if (e['s'] !== 'continuous' || !Array.isArray(mods) || mods.length !== 1 || !isRec(mods[0]) || mods[0]['layer'] !== 6 || !Array.isArray(mods[0]['add']) || Object.keys(mods[0]).length !== 2) return null;
  if (Object.keys(e).some((k) => k !== 's' && k !== 'affects' && k !== 'mods') || Object.keys(x).some((k) => k !== 'op' && k !== 'effects' && k !== 'duration')) return null;
  return { affects: e['affects'], duration: x['duration'] };
}
/** The replacing instruction grants keywords to the very object of the choice, for the same duration. */
export function sameGrantTarget(x: unknown, grant: { affects: unknown; duration: unknown }): boolean {
  const g = isRec(x) ? grantOf(x) : null;
  return g !== null && canon(g.affects) === canon(grant.affects) && canon(g.duration) === canon(grant.duration);
}
