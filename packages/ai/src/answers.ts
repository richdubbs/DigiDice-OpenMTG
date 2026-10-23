/**
 * Answers to every decision other than priority and combat. `null` means "cancel" (only offered when the decision is cancellable, CR 733.1).
 */
import type {
  ChooseColorDecision, ChooseNameDecision, ChooseNumberDecision, ChooseObjectsDecision, ChooseOptionDecision, ChooseTargetsDecision, Decision,
  DecisionAnswer, ManaType, ObjectId, PlayerId, TargetChoice, YesNoDecision,
} from '@openmtg/engine';
import { chooseObjectsLimitHolds, obeyRequirements } from '@openmtg/engine';
import { assignCombatDamage, divide } from './assign';
import { chooseAttacks } from './attack';
import { chooseBlocks } from './block';
import { battlefield, controller, creatures, hand, life, opponentAmong, pt, safeToDraw, stackTop, type Ctx } from './context';
import { cardsToShed, keepHand } from './hand';
import { auraPolarity, modePrograms, programOf, summarize } from './intent';
import { payCostLife } from './life';
import { isPileChoice, isPilesSeparation, choosePile, separatePiles } from './piles';
import { drawXCap } from './plays';
import { chooseProliferate, isProliferate } from './proliferate';
import { bestPick, sweepNet } from './score';
import { chosenTargets, stackAbility, stackSummary } from './source';
import { chooseFrom, type Want } from './targets';
import { value } from './value';
import { wordVote } from './votes';

export function answer(ctx: Ctx, d: Exclude<Decision, { kind: 'priority' }>): DecisionAnswer | null {
  switch (d.kind) {
    case 'playFirst': return { kind: 'playFirst', player: d.options.includes(ctx.me) ? ctx.me : d.options[0]! }; // CR 103.1: playing first is the tempo
    case 'mulligan': return { kind: 'mulligan', keep: keepHand(ctx, d) };
    case 'chooseObjects': return { kind: 'chooseObjects', ids: chooseObjects(ctx, d) };
    case 'yesNo': {
      const yes = yesNo(ctx, d);
      return yes === null ? null : { kind: 'yesNo', yes };
    }
    case 'chooseOption': return { kind: 'chooseOption', ids: chooseOption(ctx, d) };
    case 'chooseNumber': return { kind: 'chooseNumber', n: chooseNumber(ctx, d) };
    case 'chooseColor': return { kind: 'chooseColor', color: chooseColor(ctx, d) };
    case 'order': return { kind: 'order', ids: d.items.map((i) => i.id) }; // any order is legal (CR 603.3b); the bot keeps the engine's
    case 'chooseTargets': {
      const t = chooseTargets(ctx, d);
      return t === null ? null : { kind: 'chooseTargets', targets: t };
    }
    // CR 601.2g-h: the engine's auto-payer keeps flexible sources untapped; an unpayable cost, or one that would take the bot's last life (CR 119.4,
    // 107.4f), is cancelled (the planner then moves on).
    case 'payCost': {
      const affordable = !d.cancellable || life(ctx, ctx.me) - payCostLife(ctx, d) > 0;
      if (d.autoPayable && affordable) return { kind: 'payCost', auto: true };
      return d.cancellable ? null : { kind: 'payCost', auto: false, activations: [] };
    }
    // R1 INTERFACE CHANGE (engine M6-7a): attack and block requirements are enforced (CR 508.1d, 509.1c); the decision says how to obey them.
    // r5-static (engine, CR 508.1h, 509.1d): the bot doesn't attack or block with a creature whose attack or block has a cost (`taxed`): it never has to judge
    // whether it can pay, and a declaration it couldn't pay would only be rejected
    // ... and keeps within the limits of a whole declaration ("No more than one creature can attack each combat", CR 508.1c, 509.1b): the first ones it chose stay
    case 'declareAttackers': {
      // M12 gaps: with several opponents only the attacks on a taxed defender are dropped (`taxedDefenders`, CR 508.1h): the others stay free
      const untaxed = (c: (typeof d.candidates)[number]): typeof c | null => {
        if (!c.taxed) return c;
        const left = c.taxedDefenders === undefined ? [] : c.defenders.filter((x) => !c.taxedDefenders!.includes(x));
        if (left.length === 0) return null;
        const { taxed: _taxed, taxedDefenders: _at, ...rest } = c;
        return { ...rest, defenders: left };
      };
      const free = d.candidates.some((c) => c.taxed) ? { ...d, candidates: d.candidates.flatMap((c) => { const u = untaxed(c); return u ? [u] : []; }) } : d;
      let attacks = obeyRequirements(free, chooseAttacks(ctx, free));
      for (const l of d.limits ?? []) {
        let n = 0;
        attacks = attacks.filter((a) => !l.pairs.some((p) => p.attacker === a.attacker && p.defender === a.defender) || ++n <= l.max);
      }
      return { kind: 'declareAttackers', attacks };
    }
    case 'declareBlockers': {
      const free = d.candidates.some((c) => c.taxed) ? { ...d, candidates: d.candidates.filter((c) => !c.taxed) } : d;
      let blocks = obeyRequirements(free, chooseBlocks(ctx, free));
      const before = blocks;
      for (const l of d.limits ?? []) {
        const kept = new Set<string>();
        blocks = blocks.filter((b) => !l.blockers.includes(b.blocker) || kept.has(b.blocker) || (kept.size < l.max && kept.add(b.blocker) !== undefined));
      }
      // an attacker that needs several blockers (menace, CR 702.111b) and lost one of them to a limit is not blocked at all (never a block the rules forbid)
      const count = (list: typeof blocks, a: string): number => list.filter((b) => b.attacker === a).length;
      if (blocks.length !== before.length) blocks = blocks.filter((b) => !d.needsMultiple.includes(b.attacker) || count(blocks, b.attacker) === count(before, b.attacker));
      return { kind: 'declareBlockers', blocks };
    }
    case 'assignDamage': return { kind: 'assignDamage', amounts: assignCombatDamage(ctx, d) };
    case 'chooseDivision': return { kind: 'chooseDivision', amounts: divide(ctx, d) };
    case 'chooseReplacement': return { kind: 'chooseReplacement', id: d.options[0]!.id }; // CR 616.1: any order is legal
    case 'chooseName': return { kind: 'chooseName', name: chooseName(ctx, d) };
    // M11-0 (m11 design 7): CR 903.9a-b: the bot always keeps its commander available in the command zone (milestone 10's tuning may refine this)
    case 'commanderZone': return { kind: 'commanderZone', command: true };
    // The engine did not understand this text. The bot does not adjust the game by hand (it could only guess, and a guess could cheat): it records that.
    case 'manualResolve': return { kind: 'manualResolve', ops: [{ op: 'note', text: `The AI resolves nothing by hand for ${d.sourceName}: "${d.text}" was left undone.` }] };
  }
}

// ---- targets --------------------------------------------------------------------------------------------------------------------

/** What the targets of the spell or ability being put on the stack are for: the use of the spec whose text the decision quotes. */
function wantFor(ctx: Ctx, d: ChooseTargetsDecision): Want {
  const stack = [...ctx.view.zones.stack].reverse();
  for (const sid of stack) {
    const s = stackSummary(ctx, sid);
    const u = s.uses.find((x) => x.spec.text === d.targetText);
    if (u) return { polarity: u.polarity, kind: u.kind, amount: u.amount, power: u.power, spec: u.spec };
    // An Aura spell targets what it will enchant (CR 303.4a, 702.5a).
    const o = ctx.view.objects[sid];
    const c = ctx.chars(sid);
    if (o?.stack?.kind === 'spell' && c?.subtypes.includes('Aura')) {
      const pol = auraPolarity(ctx.view.defs[o.defId]?.faces[o.stack.face ?? 0]?.abilities ?? []);
      if (pol) return { polarity: pol.polarity, kind: pol.polarity === 'help' ? 'attach' : 'restrict', amount: pol.toughness, power: pol.power };
    }
  }
  const mine = /you control|your graveyard/i.test(d.targetText);
  return { polarity: mine ? 'help' : 'harm', kind: 'other', amount: 0, power: 0 };
}

function chooseTargets(ctx: Ctx, d: ChooseTargetsDecision): TargetChoice[] | null {
  const want = wantFor(ctx, d);
  const pick = chooseFrom(ctx, want, { objects: d.objects, players: d.players }, d.min, d.max);
  // Nothing worth aiming at (only the bot's own things for a harmful effect): take the cast back if the rules allow it (CR 733.1).
  if (pick.score <= 0 && d.cancellable && pick.targets.length > 0) return null;
  return pick.targets;
}

// ---- objects --------------------------------------------------------------------------------------------------------------------

const HARMFUL = /discard|sacrifice|bottom|exile|destroy|graveyard|lose|return .* to (its|their) owner/i;

function chooseObjects(ctx: Ctx, d: ChooseObjectsDecision): ObjectId[] {
  const rules = d.rules ?? [];
  if (isPilesSeparation(d)) return separatePiles(ctx, d.options);
  const ownCards = d.options.every((id) => ctx.view.objects[id]?.owner === ctx.me);
  // CR 103.5 bottom, CR 514.1 / 701.9 discard of the bot's own cards (when it picks the cards an opponent discards, the generic rule below takes their best).
  if (ownCards && (rules.includes('CR 103.5') || /discard/i.test(d.prompt))) return cardsToShed(ctx, d.options, d.min);
  if (rules.includes('CR 704.5j')) return [best(ctx, d.options)]; // the legend rule: keep the best one
  const harmful = HARMFUL.test(d.prompt);
  const score = (id: ObjectId): number => {
    const v = ctx.view.objects[id] && ctx.chars(id) ? value(ctx, id) : 1;
    const mine = (controller(ctx, id) ?? ctx.view.objects[id]?.owner) === ctx.me;
    return harmful ? (mine ? -v : v) : (mine ? v : -v);
  };
  const sorted = [...d.options].sort((a, b) => score(b) - score(a));
  const good = sorted.filter((id) => score(id) > 0).length;
  const n = Math.max(d.min, Math.min(d.max, harmful ? Math.min(good, d.min) : good));
  const picked = sorted.slice(0, Math.min(n, sorted.length));
  // FAST5 T66: a decision with a total limit ("total mana value 4 or less") drops the lowest-valued choices until the limit holds
  while (picked.length > 0 && !chooseObjectsLimitHolds(d, picked)) picked.pop();
  return picked;
}

function best(ctx: Ctx, ids: readonly ObjectId[]): ObjectId {
  return [...ids].sort((a, b) => value(ctx, b) - value(ctx, a) || (ctx.view.objects[a]?.tapped ? 1 : 0) - (ctx.view.objects[b]?.tapped ? 1 : 0))[0]!;
}

// ---- yes / no -------------------------------------------------------------------------------------------------------------------

/** `null` = cancel the action being taken (CR 733.1). */
function yesNo(ctx: Ctx, d: YesNoDecision): boolean | null {
  const p = d.prompt;
  const rules = d.rules ?? [];
  // The bot never pays or attests anything by hand ("Confirm: <restriction>", CR 602.5b; "Pay this cost by hand", CR 118.3). Answering "no" would only be
  // rejected (the engine wants a cancel), so it cancels the action instead, and the planner moves on to its next play.
  if (/by hand|I paid it|^Confirm:/i.test(p) || d.yesLabel === 'I paid it') return d.cancellable ? null : false;
  // A condition the engine does not understand (CR 608.2c, `{cond:'ask'}`): the bot can't know, and a guess could cheat; "no" leaves the effect undone.
  if (rules.includes('CR 608.2c')) return false;
  if (/choose new targets/i.test(p)) return false;
  if (/enters tapped/i.test(p) && /life/i.test(p)) return life(ctx, ctx.me) > 10;
  if (/Pay the .* cost for/i.test(p)) return ctx.cancels === 0; // an optional additional cost: try it once; after a cancelled attempt, cast without it
  if (rules.includes('CR 608.2d') || rules.includes('CR 603.5')) return mayDo(ctx, p);
  return true; // "pay ...?" to save the bot's own spell, "apply this effect?": the bot's choices are good for the bot
}

const NUMBER_WORDS: Record<string, number> = { a: 1, an: 1, one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10 };

/**
 * "You may ..." while a spell or ability resolves (CR 608.2d, 603.5). The resolving object is still on top of the stack (CR 608.2n): the bot declines when
 * the optional part would hurt only its own things or help only the opponent's (the targets were chosen earlier, CR 603.3d), and an optional draw that
 * would leave it a nearly empty library (CR 121.4, 704.5b).
 */
function mayDo(ctx: Ctx, prompt: string): boolean {
  const top = stackTop(ctx);
  const s = top !== null ? stackSummary(ctx, top) : null;
  const words = /\bdraws? (a|an|one|two|three|four|five|six|seven|eight|nine|ten|\d+) cards?\b/i.exec(prompt)?.[1]?.toLowerCase();
  const drawn = Math.max(s?.mayDraws ?? 0, words === undefined ? 0 : NUMBER_WORDS[words] ?? Number(words));
  if (!safeToDraw(ctx, drawn)) return false;
  if (!s || top === null) return true;
  for (const u of s.uses) {
    if (!u.optional) continue;
    const chosen = chosenTargets(ctx, top, u.spec.id);
    if (chosen.length === 0) continue;
    const mine = (t: TargetChoice): boolean => (t.kind === 'player' ? t.id === ctx.me : (controller(ctx, t.id) ?? ctx.view.objects[t.id]?.owner) === ctx.me);
    if (u.polarity === 'harm' && chosen.every(mine)) return false;
    if (u.polarity === 'help' && chosen.every((t) => !mine(t))) return false;
  }
  return true;
}

// ---- options, numbers, colors, names --------------------------------------------------------------------------------------------

function chooseOption(ctx: Ctx, d: ChooseOptionDecision): string[] {
  const usable = d.options.filter((o) => !o.disabled);
  const rules = d.rules ?? [];
  if (isPileChoice(d)) return [choosePile(ctx, usable)];
  if (isProliferate(d)) return chooseProliferate(ctx, d); // CR 701.34a
  if (rules.includes('CR 700.2')) {
    const scores = modeScores(ctx, usable.map((o) => Number(o.id)));
    const ranked = usable.map((o, i) => ({ id: o.id, s: scores[i]! })).sort((a, b) => b.s - a.s);
    if (d.allowRepeat) return Array.from({ length: Math.max(d.min, ranked[0]!.s > 0 ? Math.min(d.max, 5) : d.min) }, () => ranked[0]!.id);
    const n = Math.max(d.min, Math.min(d.max, ranked.filter((r) => r.s > 0).length));
    return ranked.slice(0, n).map((r) => r.id);
  }
  const multiplayer = multiplayerChoice(ctx, d, usable.map((o) => o.id));
  if (multiplayer !== undefined) return multiplayer;
  // Players: an opponent for "choose an opponent", the bot itself for "under whose control".
  const opp = usable.find((o) => o.id === ctx.opp);
  const self = usable.find((o) => o.id === ctx.me);
  if (/control/i.test(d.prompt) && self) return [self.id];
  if (opp) return [opp.id];
  return usable.slice(0, Math.max(d.min, Math.min(1, d.max))).map((o) => o.id);
}

// ---- M12-6: the multiplayer choices (m12 design 7, D13; M12-2's and M12-3's decisions) -------------------------------------------------------------

const HELPFUL_RESULT = /\b(draws?|gains?|creates?|untaps?|onto the battlefield under (his|her|their) control)\b/i;
const HARMFUL_RESULT = /\b(loses?|sacrifices?|destroy|exile|damage|discards?|mills?|can't|goad)/i;

/**
 * The choices among players that only a game with several opponents asks (D13: never with one candidate), and votes (CR 701.38a-d, M12-3). Undefined:
 * not one of them (the generic answer follows). Each answer names only offered options, so a redirected decision (CR 800.4g-h) is answered as well.
 *  - CR 310.12a, 704.5x: a Siege's protector: the opponent with the least power to block with (the bot attacks the battle to defeat it, CR 310.12b).
 *  - CR 508.5a: the defending player of the bot's spell or ability; CR 601.7a: "an opponent", and which opponent makes a choice for the bot's spell;
 *    CR 800.4g: another opponent instead of one who left: the focus (`opponentAmong`).
 *  - CR 701.38a: a vote for words: M12 gaps, the word whose outcome is worth most to the bot (votes.ts: what each word does in the resolving spell or
 *    ability); the first word when it can't tell (or with one opponent, D17); a vote for players: the bot itself when the vote's result reads as helpful
 *    only, otherwise an opponent (the focus). Every vote it must cast (`min`) goes to that one choice.
 */
function multiplayerChoice(ctx: Ctx, d: ChooseOptionDecision, ids: string[]): string[] | undefined {
  const rules = d.rules ?? [];
  if (ids.length === 0) return undefined;
  const players = ids.every((id) => ctx.view.players.some((p) => p.id === id));
  const votes = (id: string): string[] => Array.from({ length: Math.max(1, d.allowRepeat ? d.min : Math.min(1, d.max)) }, () => id);
  if (rules.includes('CR 701.38a')) {
    if (!players) return votes(wordVote(ctx, ids) ?? ids[0]!);
    const top = stackTop(ctx);
    const o = top !== null ? ctx.view.objects[top] : undefined;
    const text = `${d.prompt} ${o ? ctx.view.defs[o.defId]?.faces[o.stack?.face ?? 0]?.oracleText ?? '' : ''}`;
    const result = text.split(/most votes/i).slice(1).join(' ') || text;
    const helpful = HELPFUL_RESULT.test(result) && !HARMFUL_RESULT.test(result);
    return votes(helpful && ids.includes(ctx.me) ? ctx.me : opponentAmong(ctx, ids) ?? ids[0]!);
  }
  if (!players) return undefined;
  if (rules.includes('CR 310.12a') || rules.includes('CR 704.5x')) {
    const opps = ctx.opps.filter((p) => ids.includes(p));
    if (opps.length === 0) return undefined;
    const defense = (p: PlayerId): number => creatures(ctx, p).filter((id) => !ctx.view.objects[id]?.tapped).reduce((n, id) => n + pt(ctx, id).toughness, 0);
    return [[...opps].sort((a, b) => defense(a) - defense(b))[0]!];
  }
  if (['CR 508.5a', 'CR 601.7a', 'CR 800.4g'].some((r) => rules.includes(r))) {
    const p = opponentAmong(ctx, ids);
    return p !== undefined ? [p] : undefined;
  }
  return undefined;
}

/** CR 700.2: the value of each mode of the spell or ability being cast (the bot's own object on top of the stack). */
function modeScores(ctx: Ctx, indices: number[]): number[] {
  const top = stackTop(ctx);
  const program = top ? programOf(stackAbility(ctx, top)) : undefined;
  const modes = modePrograms(program);
  return indices.map((i) => {
    const m = modes[i];
    if (!m) return 0;
    const s = summarize(m);
    if (s.manual && s.uses.length === 0) return -1;
    let score = 0;
    for (const u of s.uses) {
      const pick = bestPick(ctx, u, top);
      if (!pick) return -5;
      score += pick.score;
    }
    score += s.draws * 3 + s.tokens * 2 + s.lifeGain * 0.3 + s.oppDamage * 0.6 + s.other * 0.3;
    if (s.sweepDamage > 0) score += sweepNet(ctx, s.sweepDamage);
    return score;
  });
}

function chooseNumber(ctx: Ctx, d: ChooseNumberDecision): number {
  // A number the engine does not understand (CR 608.2c, `{q:'ask'}`): the least, the value that does nothing, rather than a guess.
  if ((d.rules ?? []).includes('CR 608.2c')) return d.min;
  // CR 107.3a: X as large as the bot can pay (the decision's max), but no more cards drawn than the library can spare (CR 121.4). The spell or ability
  // being cast is on top of the stack (CR 601.2a).
  if (/value for X/i.test(d.prompt)) {
    const top = stackTop(ctx);
    const cap = top !== null && controller(ctx, top) === ctx.me ? drawXCap(ctx, programOf(stackAbility(ctx, top))) : Infinity;
    return Math.max(d.min, Math.min(d.max, cap));
  }
  if (/prevent/i.test(d.prompt)) return d.max; // prevention as much as allowed (CR 615.7)
  return d.min;
}

/** The color the bot needs most: colored symbols in hand first, then its permanents' colors (CR 105, 106.1b). */
function chooseColor(ctx: Ctx, d: ChooseColorDecision): ManaType {
  const count = new Map<string, number>();
  for (const id of hand(ctx, ctx.me)) {
    for (const s of ctx.chars(id)?.manaCost ?? []) {
      const cols = s.kind === 'colored' ? [s.color] : s.kind === 'hybrid' ? s.colors : [];
      for (const c of cols) count.set(c, (count.get(c) ?? 0) + 2);
    }
  }
  for (const id of battlefield(ctx, ctx.me)) for (const c of ctx.chars(id)?.colors ?? []) count.set(c, (count.get(c) ?? 0) + 1);
  return [...d.options].sort((a, b) => (count.get(b) ?? 0) - (count.get(a) ?? 0))[0]!;
}

/** CR 607.2d, 608.2d: name what the opponent has shown most of; a creature type the bot itself has most of. */
function chooseName(ctx: Ctx, d: ChooseNameDecision): string {
  const tally = new Map<string, number>();
  const add = (name: string | undefined, w = 1): void => { if (name && (!d.options || d.options.includes(name))) tally.set(name, (tally.get(name) ?? 0) + w); };
  const visible = Object.values(ctx.view.objects).filter((o) => ctx.chars(o.id));
  for (const o of visible) {
    const c = ctx.chars(o.id)!;
    const theirs = o.owner !== ctx.me;
    // std-rx28 (CR 201.3): a land or nonland card name only, when the decision says which
    const kindOk = d.cardKind === undefined || c.types.includes('Land') === (d.cardKind === 'land');
    if (d.what === 'cardName' && theirs && o.kind === 'card' && kindOk) add(c.name, value(ctx, o.id));
    if (d.what === 'creatureType' && !theirs) for (const t of c.subtypes) if (c.types.includes('Creature')) add(t);
    if (d.what === 'cardType' && theirs) for (const t of c.types) add(t);
    if (d.what === 'landType' && theirs) for (const t of c.subtypes) if (c.types.includes('Land')) add(t);
  }
  const top = [...tally].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))[0]?.[0];
  if (top) return top;
  if (d.options && d.options.length > 0) return d.options[0]!;
  const nameable = Object.values(ctx.view.defs).find((x) => !x.isToken && (d.cardKind === undefined || x.faces.some((f) => f.types.includes('Land') === (d.cardKind === 'land'))));
  const fallback = { cardName: nameable?.name ?? (d.cardKind === 'nonland' ? 'Lightning Bolt' : undefined), creatureType: 'Human', cardType: 'Creature', landType: 'Forest' }[d.what];
  return fallback ?? 'Forest';
}
