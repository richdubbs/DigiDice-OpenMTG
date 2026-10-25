/**
 * Lane trek, round trek-8, adversarial review fixes, played through the engine with synthetic cards (invented names and wordings, design 6.10). CR cites from memory,
 * unverified (rules/cr/ is not in the cloud checkout).
 *
 *   CR 508.4, 614.1c, 702.49c   Kira Nerys's "enters tapped and attacking" replacement joins the combat once, the way the putting effect says: what ninjutsu's returned
 *                               creature attacked, the player "attacking target player" names, else the controller chooses (one question, also with three players)
 *   CR 702.12b, 614.6           an indestructible permanent is not destroyed, so no "if it would be destroyed" replacement applies to it (Doctor McCoy keeps its
 *                               counters; umbra armor keeps its Aura; a regeneration shield is not used up)
 *   CR 608.2f, 704.3, 701.8a    permanents destroyed at the same time (a wrath, lethal damage in one state-based check) are all subject to the replacement effects there
 *                               are when the events would happen: Doctor McCoy's protection does not depend on the order of the battlefield
 */
import { describe, expect, it } from 'vitest';
import { applyAction, compileCard, createGame, legalActions, type CardDef, type DecisionAnswer, type GameState, type ObjectId, type OracleCard, type PlayerId, type TargetChoice } from '../../../src/index';
import { act, advanceTo, answer, find, findAll, pass, put, scenario } from '../../m3/scenario';
import { clone } from '../../../src/util/clone';
import { basicLand } from '../../helpers';
import { playersConfig } from '../../m12/skeleton/helpers';

function card(name: string, type: string, text: string, opts: { pt?: [string, string]; cost?: string } = {}): CardDef {
  return compileCard({
    name, layout: 'normal', mana_cost: opts.cost ?? '{0}', type_line: type, oracle_text: text, colors: [],
    ...(opts.pt ? { power: opts.pt[0], toughness: opts.pt[1] } : {}),
  } as OracleCard);
}
const attackerOf = (s: GameState, id: ObjectId) => (s.combat?.attackers ?? []).find((a) => a.id === id);
const tgt = (id: ObjectId): TargetChoice => ({ kind: 'object', id });
/** a destroyed permanent is a new object in the graveyard (CR 400.7): the old id is gone, or no longer on the battlefield */
const onBf = (s: GameState, id: ObjectId): boolean => s.objects[id]?.zone === 'battlefield';

interface Drive {
  targets?: TargetChoice[][];
  /** the labels to answer to `chooseOption` decisions, in order (the first option when none is left) */
  options?: string[];
  /** objects chosen by a `chooseObjects` decision */
  pick?: (options: ObjectId[]) => ObjectId[];
}
/** every `chooseOption` prompt the drive has answered, for "asked once" */
const prompts: string[] = [];
function drive(s0: GameState, o: Drive = {}): GameState {
  let s = s0;
  const tq = [...(o.targets ?? [])];
  const oq = [...(o.options ?? [])];
  for (let guard = 0; guard < 80 && s.pending && s.pending.kind !== 'priority'; guard++) {
    const p = s.pending;
    if (p.kind === 'payCost') s = answer(s, { kind: 'payCost', auto: true });
    else if (p.kind === 'yesNo') s = answer(s, { kind: 'yesNo', yes: true });
    else if (p.kind === 'chooseObjects') s = answer(s, { kind: 'chooseObjects', ids: o.pick ? o.pick(p.options) : p.options.slice(0, Math.max(p.min, 1)).slice(0, p.max) });
    else if (p.kind === 'chooseTargets') s = answer(s, { kind: 'chooseTargets', targets: tq.shift() ?? [] });
    else if (p.kind === 'order') s = answer(s, { kind: 'order', ids: p.items.map((x) => x.id) });
    else if (p.kind === 'chooseOption') {
      prompts.push(`${p.prompt} [${p.options.map((x) => x.label).join(' | ')}]`);
      const want = oq.shift();
      const opt = p.options.find((x) => x.label === want || x.id === want) ?? p.options[0]!;
      s = answer(s, { kind: 'chooseOption', ids: [opt.id] } as DecisionAnswer);
    } else throw new Error(`unexpected decision ${p.kind}`);
  }
  return s;
}
function resolveAll(s0: GameState, o: Drive = {}): GameState {
  let s = drive(s0, o);
  for (let guard = 0; guard < 60 && (s.zones.stack.length > 0 || (s.pending && s.pending.kind !== 'priority')); guard++) s = s.pending?.kind === 'priority' ? pass(s) : drive(s, o);
  return s;
}
const cast = (s0: GameState, name: string, o: Drive = {}, who: PlayerId = 'p1'): GameState => resolveAll(act(s0, { type: 'cast', player: who, card: find(s0, name, 'hand', who) }), o);
function toDecision(s0: GameState, kind: 'declareAttackers' | 'declareBlockers', o: Drive = {}): GameState {
  let s = s0;
  for (let guard = 0; guard < 80 && s.pending?.kind !== kind; guard++) s = s.pending?.kind === 'priority' ? pass(s) : drive(s, o);
  if (s.pending?.kind !== kind) throw new Error(`never asked for ${kind} (turn ${s.turn.number} ${s.turn.step}, pending ${s.pending?.kind})`);
  return s;
}

const BEAR = card('Test Bear', 'Creature — Bear', '', { pt: ['2', '2'] });
const RALLIER = card('Test Rallier', 'Legendary Creature — Bajoran Soldier', 'If a creature you control would enter while you control an attacking creature, instead it enters tapped and attacking.', { pt: ['2', '2'] });
const NINJA = card('Test Shade Runner', 'Creature — Human Ninja', 'Ninjutsu {0}', { pt: ['2', '2'], cost: '{3}' });
const HERALD = card('Test Banner Herald', 'Legendary Creature — Human', "Whenever Test Banner Herald attacks, create a 1/1 white Soldier creature token that's tapped and attacking target player.", { pt: ['2', '2'] });
const MUSTER = card('Test Muster', 'Instant', "Create a 1/1 white Soldier creature token that's tapped and attacking.");

describe('trek-8 review: "enters tapped and attacking" (Kira Nerys) joins the combat once, as the putting effect says (CR 508.4, 702.49c)', () => {
  it('ninjutsu: the ninja attacks what the returned creature attacked (a planeswalker), and nobody is asked what it attacks', () => {
    prompts.length = 0;
    let s = scenario(['Garruk Wildspeaker'], { defs: [RALLIER, BEAR, NINJA], p1: { hand: ['Test Shade Runner'], battlefield: ['Test Rallier', 'Test Bear', 'Test Bear'] }, p2: { battlefield: [{ name: 'Garruk Wildspeaker', counters: { loyalty: 3 } }] } });
    const [b1, b2] = findAll(s, 'Test Bear', 'battlefield', 'p1');
    const garruk = find(s, 'Garruk Wildspeaker', 'battlefield', 'p2');
    s = toDecision(advanceTo(s, 1, 'beginCombat'), 'declareAttackers');
    s = drive(answer(s, { kind: 'declareAttackers', attacks: [{ attacker: b1!, defender: garruk }, { attacker: b2!, defender: 'p2' }] }));
    for (let g = 0; g < 20 && s.turn.step !== 'declareBlockers'; g++) s = s.pending?.kind === 'priority' ? pass(s) : s.pending?.kind === 'declareBlockers' ? answer(s, { kind: 'declareBlockers', blocks: [] }) : drive(s);
    for (let g = 0; g < 10 && !(s.pending?.kind === 'priority' && s.pending.player === 'p1' && s.turn.step === 'declareBlockers'); g++) s = s.pending?.kind === 'priority' ? pass(s) : drive(s);
    const a = legalActions(s, 'p1').find((x) => x.kind === 'activate' && x.object === find(s, 'Test Shade Runner', 'hand', 'p1'));
    expect(a, 'ninjutsu is offered').toBeDefined();
    s = act(s, a!.action);
    s = resolveAll(drive(s, { pick: () => [b1!] }));
    const ninja = find(s, 'Test Shade Runner', 'battlefield', 'p1');
    expect(attackerOf(s, ninja)?.defender).toBe(garruk);
    expect(prompts).toEqual([]);
  });
  it('control: the same game without Kira gives the same answer (the ninja attacks the planeswalker)', () => {
    prompts.length = 0;
    let s = scenario(['Garruk Wildspeaker'], { defs: [BEAR, NINJA], p1: { hand: ['Test Shade Runner'], battlefield: ['Test Bear', 'Test Bear'] }, p2: { battlefield: [{ name: 'Garruk Wildspeaker', counters: { loyalty: 3 } }] } });
    const [b1, b2] = findAll(s, 'Test Bear', 'battlefield', 'p1');
    const garruk = find(s, 'Garruk Wildspeaker', 'battlefield', 'p2');
    s = toDecision(advanceTo(s, 1, 'beginCombat'), 'declareAttackers');
    s = drive(answer(s, { kind: 'declareAttackers', attacks: [{ attacker: b1!, defender: garruk }, { attacker: b2!, defender: 'p2' }] }));
    for (let g = 0; g < 20 && s.turn.step !== 'declareBlockers'; g++) s = s.pending?.kind === 'priority' ? pass(s) : s.pending?.kind === 'declareBlockers' ? answer(s, { kind: 'declareBlockers', blocks: [] }) : drive(s);
    for (let g = 0; g < 10 && !(s.pending?.kind === 'priority' && s.pending.player === 'p1' && s.turn.step === 'declareBlockers'); g++) s = s.pending?.kind === 'priority' ? pass(s) : drive(s);
    const a = legalActions(s, 'p1').find((x) => x.kind === 'activate' && x.object === find(s, 'Test Shade Runner', 'hand', 'p1'));
    s = resolveAll(drive(act(s, a!.action), { pick: () => [b1!] }));
    expect(attackerOf(s, find(s, 'Test Shade Runner', 'battlefield', 'p1'))?.defender).toBe(garruk);
    expect(prompts).toEqual([]);
  });
  it('"a token that\'s tapped and attacking target player": it attacks that player, not what a question of the replacement would pick, and no question is asked', () => {
    prompts.length = 0;
    let s = scenario(['Garruk Wildspeaker'], { defs: [RALLIER, HERALD], p1: { battlefield: ['Test Rallier', 'Test Banner Herald'] }, p2: { battlefield: [{ name: 'Garruk Wildspeaker', counters: { loyalty: 3 } }] } });
    const herald = find(s, 'Test Banner Herald', 'battlefield', 'p1');
    const garruk = find(s, 'Garruk Wildspeaker', 'battlefield', 'p2');
    s = toDecision(advanceTo(s, 1, 'beginCombat'), 'declareAttackers');
    s = answer(s, { kind: 'declareAttackers', attacks: [{ attacker: herald, defender: garruk }] });
    s = resolveAll(s, { targets: [[{ kind: 'player', id: 'p2' }]], options: [garruk] });
    const [tok] = findAll(s, 'Soldier Token', 'battlefield', 'p1');
    expect(attackerOf(s, tok!)?.defender).toBe('p2');
    expect(s.objects[tok!]!.tapped).toBe(true);
    expect(prompts).toEqual([]);
  });
  it('a plain "tapped and attacking" token: the controller is asked once what it attacks, and the answer is what it attacks (the log says it attacks once)', () => {
    prompts.length = 0;
    let s = scenario(['Garruk Wildspeaker'], { defs: [RALLIER, BEAR, MUSTER], p1: { hand: ['Test Muster'], battlefield: ['Test Rallier', 'Test Bear'] }, p2: { battlefield: [{ name: 'Garruk Wildspeaker', counters: { loyalty: 3 } }] } });
    const bear = find(s, 'Test Bear', 'battlefield', 'p1');
    const garruk = find(s, 'Garruk Wildspeaker', 'battlefield', 'p2');
    s = toDecision(advanceTo(s, 1, 'beginCombat'), 'declareAttackers');
    s = drive(answer(s, { kind: 'declareAttackers', attacks: [{ attacker: bear, defender: 'p2' }] }));
    s = cast(s, 'Test Muster', { options: ['Garruk Wildspeaker'] });
    const [tok] = findAll(s, 'Soldier Token', 'battlefield', 'p1');
    expect(attackerOf(s, tok!)?.defender).toBe(garruk);
    expect(prompts.length).toBe(1);
    expect(s.log.filter((l) => l.text.includes('Soldier Token') && l.text.includes('is attacking')).length).toBe(1);
  });
  it('control: without Kira the same token asks once and attacks the answer', () => {
    prompts.length = 0;
    let s = scenario(['Garruk Wildspeaker'], { defs: [BEAR, MUSTER], p1: { hand: ['Test Muster'], battlefield: ['Test Bear'] }, p2: { battlefield: [{ name: 'Garruk Wildspeaker', counters: { loyalty: 3 } }] } });
    const bear = find(s, 'Test Bear', 'battlefield', 'p1');
    const garruk = find(s, 'Garruk Wildspeaker', 'battlefield', 'p2');
    s = toDecision(advanceTo(s, 1, 'beginCombat'), 'declareAttackers');
    s = drive(answer(s, { kind: 'declareAttackers', attacks: [{ attacker: bear, defender: 'p2' }] }));
    s = cast(s, 'Test Muster', { options: ['Garruk Wildspeaker'] });
    expect(attackerOf(s, findAll(s, 'Soldier Token', 'battlefield', 'p1')[0]!)?.defender).toBe(garruk);
    expect(prompts.length).toBe(1);
  });
  it('three players: a plain token with Kira out is asked once, among both opponents, and attacks the one chosen; a token aimed at a player attacks that player unasked', () => {
    prompts.length = 0;
    const FOREST = basicLand('Forest', 'Forest');
    const defs = [FOREST, BEAR, RALLIER, MUSTER, HERALD];
    const base = playersConfig(3, 'trek8-review-3p', { defs });
    let s = createGame({ ...base, options: { ...base.options, startingPlayer: 'p1', skipMulligans: true } });
    while (s.turn.step !== 'main1') s = act(s, { type: 'pass', player: s.pending!.player });
    s = clone(s);
    put(s, 'p1', 'battlefield', 'Test Rallier');
    put(s, 'p1', 'battlefield', 'Test Banner Herald');
    put(s, 'p1', 'hand', 'Test Muster');
    const herald = find(s, 'Test Banner Herald', 'battlefield', 'p1');
    s = toDecision(advanceTo(s, 1, 'beginCombat'), 'declareAttackers');
    s = resolveAll(answer(s, { kind: 'declareAttackers', attacks: [{ attacker: herald, defender: 'p2' }] }), { targets: [[{ kind: 'player', id: 'p3' }]], options: ['Bob'] });
    const [named] = findAll(s, 'Soldier Token', 'battlefield', 'p1');
    expect(attackerOf(s, named!)?.defender).toBe('p3'); // the named player, whatever a question of the replacement could say
    expect(prompts).toEqual([]);
    s = cast(s, 'Test Muster', { options: ['Carol'] });
    const plain = findAll(s, 'Soldier Token', 'battlefield', 'p1').find((id) => id !== named)!;
    expect(attackerOf(s, plain)?.defender).toBe('p3');
    expect(prompts.length).toBe(1);
    expect(prompts[0]).toContain('Bob');
    expect(prompts[0]).toContain('Carol');
  });
});

describe('trek-8 review: Doctor McCoy and an indestructible permanent (CR 702.12b, 614.6; the Hyena Umbra ruling)', () => {
  const SURGEON = card('Test Surgeon', 'Legendary Creature — Human Doctor', 'If another creature you control with a +1/+1 counter on it would be destroyed, instead remove all +1/+1 counters from it and all damage already dealt to it is healed.', { pt: ['2', '2'] });
  const STONE = card('Test Stone Bear', 'Creature — Bear', 'Indestructible', { pt: ['2', '2'] });
  const DOOM = card('Test Doom', 'Instant', 'Destroy target creature.');
  const BOLT = card('Test Bolt', 'Instant', 'Test Bolt deals 3 damage to target creature.');
  const MEND = card('Test Mend', 'Instant', 'Regenerate target creature.');
  const SHROUD = card('Test Umbral Veil', 'Enchantment — Aura', 'Enchant creature\nEnchanted creature gets +0/+2.\nUmbra armor (If enchanted creature would be destroyed, instead remove all damage from it and destroy this Aura.)');
  const defs = [SURGEON, STONE, DOOM, BOLT, MEND, BEAR, SHROUD];
  it('a destroy spell on an indestructible creature with +1/+1 counters has no effect: its counters stay', () => {
    let s = scenario([], { defs, p1: { hand: ['Test Doom'], battlefield: ['Test Surgeon', { name: 'Test Stone Bear', counters: { '+1/+1': 2 } }] } });
    const st = find(s, 'Test Stone Bear', 'battlefield', 'p1');
    s = cast(s, 'Test Doom', { targets: [[tgt(st)]] });
    expect(onBf(s, st)).toBe(true);
    expect(s.objects[st]!.counters['+1/+1'] ?? 0).toBe(2);
  });
  it('lethal damage to it: the counters stay and the damage stays too (it is not destroyed, and nothing heals it)', () => {
    let s = scenario([], { defs, p1: { hand: ['Test Bolt'], battlefield: ['Test Surgeon', { name: 'Test Stone Bear', counters: { '+1/+1': 1 } }] } });
    const st = find(s, 'Test Stone Bear', 'battlefield', 'p1');
    s = cast(s, 'Test Bolt', { targets: [[tgt(st)]] });
    expect([s.objects[st]!.counters['+1/+1'] ?? 0, s.objects[st]!.damage]).toEqual([1, 3]);
  });
  it('a regeneration shield on an indestructible creature is not used up by the destroy spell (nothing is destroyed, nothing regenerates)', () => {
    let s = scenario([], { defs, p1: { hand: ['Test Mend', 'Test Doom'], battlefield: ['Test Surgeon', { name: 'Test Stone Bear', counters: { '+1/+1': 1 } }] } });
    const st = find(s, 'Test Stone Bear', 'battlefield', 'p1');
    s = cast(s, 'Test Mend', { targets: [[tgt(st)]] });
    const shields = (): number => s.continuousEffects.filter((e) => (e.effect as { body?: { b?: string } }).body?.b === 'regeneration').length;
    expect(shields()).toBe(1);
    s = cast(s, 'Test Doom', { targets: [[tgt(st)]] });
    expect(shields()).toBe(1);
    expect(s.objects[st]!.tapped).toBe(false);
    expect(s.objects[st]!.counters['+1/+1'] ?? 0).toBe(1);
  });
  it('the same creature without indestructible: McCoy applies (counters removed, it lives) and the destroy spell is not wasted on it', () => {
    let s = scenario([], { defs, p1: { hand: ['Test Doom'], battlefield: ['Test Surgeon', { name: 'Test Bear', counters: { '+1/+1': 2 } }] } });
    const bear = find(s, 'Test Bear', 'battlefield', 'p1');
    s = cast(s, 'Test Doom', { targets: [[tgt(bear)]] });
    expect(onBf(s, bear)).toBe(true);
    expect(s.objects[bear]!.counters['+1/+1'] ?? 0).toBe(0);
  });
  it('umbra armor still saves the enchanted creature (its damage is removed, the Aura is destroyed) and an indestructible creature keeps its Aura', () => {
    let s = scenario([], { defs, p1: { hand: ['Test Doom'], battlefield: ['Test Bear'] } });
    const bear = find(s, 'Test Bear', 'battlefield', 'p1');
    let veil = put(s, 'p1', 'battlefield', 'Test Umbral Veil');
    s.objects[veil]!.attachedTo = bear;
    s = cast(s, 'Test Doom', { targets: [[tgt(bear)]] });
    expect(onBf(s, bear)).toBe(true);
    expect(onBf(s, veil)).toBe(false);
    s = scenario([], { defs, p1: { hand: ['Test Doom'], battlefield: ['Test Stone Bear'] } });
    const stone = find(s, 'Test Stone Bear', 'battlefield', 'p1');
    veil = put(s, 'p1', 'battlefield', 'Test Umbral Veil');
    s.objects[veil]!.attachedTo = stone;
    s = cast(s, 'Test Doom', { targets: [[tgt(stone)]] });
    expect(onBf(s, stone)).toBe(true);
    expect(onBf(s, veil)).toBe(true);
  });
});

describe('trek-8 review: permanents destroyed at the same time are all protected by the replacement effects there are (CR 608.2f, 704.3, 701.8a)', () => {
  const SURGEON = card('Test Surgeon', 'Legendary Creature — Human Doctor', 'If another creature you control with a +1/+1 counter on it would be destroyed, instead remove all +1/+1 counters from it and all damage already dealt to it is healed.', { pt: ['2', '2'] });
  const WRATH = card('Test Wrath', 'Sorcery', 'Destroy all creatures.');
  const CLEAVE = card('Test Cleave', 'Sorcery', 'Test Cleave deals 3 damage to each creature.');
  const NOREGEN = card('Test Smite', 'Sorcery', "Destroy all creatures. They can't be regenerated.");
  const defs = [SURGEON, BEAR, WRATH, CLEAVE, NOREGEN];
  const marked = { name: 'Test Bear', counters: { '+1/+1': 1 } };
  for (const [label, order] of [['McCoy first on the battlefield', ['Test Surgeon', marked]], ['McCoy last on the battlefield', [marked, 'Test Surgeon']]] as const) {
    it(`"Destroy all creatures", ${label}: the protected creature survives (counters gone), McCoy and the unmarked creature are destroyed`, () => {
      let s = scenario([], { defs, p1: { hand: ['Test Wrath'], battlefield: [...order, 'Test Bear'] as never[] } });
      const bears = findAll(s, 'Test Bear', 'battlefield', 'p1');
      const protectedBear = bears.find((id) => (s.objects[id]!.counters['+1/+1'] ?? 0) > 0)!;
      const plain = bears.find((id) => id !== protectedBear)!;
      const doc = find(s, 'Test Surgeon', 'battlefield', 'p1');
      s = cast(s, 'Test Wrath');
      expect(onBf(s, protectedBear)).toBe(true);
      expect(s.objects[protectedBear]!.counters['+1/+1'] ?? 0).toBe(0);
      expect(onBf(s, plain)).toBe(false);
      expect(onBf(s, doc)).toBe(false);
    });
    it(`3 damage to each creature (state-based lethal damage), ${label}: the protected creature survives healed, the others die`, () => {
      let s = scenario([], { defs, p1: { hand: ['Test Cleave'], battlefield: [...order, 'Test Bear'] as never[] } });
      const bears = findAll(s, 'Test Bear', 'battlefield', 'p1');
      const protectedBear = bears.find((id) => (s.objects[id]!.counters['+1/+1'] ?? 0) > 0)!;
      const plain = bears.find((id) => id !== protectedBear)!;
      const doc = find(s, 'Test Surgeon', 'battlefield', 'p1');
      s = cast(s, 'Test Cleave');
      expect(onBf(s, protectedBear)).toBe(true);
      expect(s.objects[protectedBear]!.damage).toBe(0);
      expect(s.objects[protectedBear]!.counters['+1/+1'] ?? 0).toBe(0);
      expect(onBf(s, plain)).toBe(false);
      expect(onBf(s, doc)).toBe(false);
    });
  }
  it('two protected creatures and McCoy: both survive; "can\'t be regenerated" changes nothing for McCoy\'s replacement (it is not regeneration)', () => {
    let s = scenario([], { defs, p1: { hand: ['Test Smite'], battlefield: [marked, 'Test Surgeon', marked] as never[] } });
    const doc = find(s, 'Test Surgeon', 'battlefield', 'p1');
    const bears = findAll(s, 'Test Bear', 'battlefield', 'p1');
    s = cast(s, 'Test Smite');
    for (const b of bears) expect(onBf(s, b), 'a protected creature').toBe(true);
    expect(onBf(s, doc)).toBe(false);
  });
  it('umbra armor: "Destroy all nonland permanents" destroys the Aura too, and still saves the enchanted creature (the ruling), whichever of the two is first on the battlefield', () => {
    const PURGE = card('Test Purge', 'Sorcery', 'Destroy all nonland permanents.');
    const VEIL = card('Test Umbral Veil', 'Enchantment — Aura', 'Enchant creature\nEnchanted creature gets +0/+2.\nUmbra armor (If enchanted creature would be destroyed, instead remove all damage from it and destroy this Aura.)');
    for (const auraFirst of [true, false]) {
      let s = scenario([], { defs: [...defs, VEIL, PURGE], p1: { hand: ['Test Purge'], battlefield: ['Test Bear'] } });
      const bear = find(s, 'Test Bear', 'battlefield', 'p1');
      const veil = put(s, 'p1', 'battlefield', 'Test Umbral Veil');
      s.objects[veil]!.attachedTo = bear;
      if (auraFirst) s.zones.battlefield = [veil, bear];
      s = cast(s, 'Test Purge');
      expect(onBf(s, bear), `creature survives (aura first: ${auraFirst})`).toBe(true);
      expect(onBf(s, veil), `the Aura is destroyed (aura first: ${auraFirst})`).toBe(false);
    }
  });
  it('without a protector everything is still destroyed together (a wrath), and McCoy alone with no marked creature changes nothing', () => {
    let s = scenario([], { defs, p1: { hand: ['Test Wrath'], battlefield: ['Test Surgeon', 'Test Bear', 'Test Bear'] }, p2: { battlefield: ['Test Bear'] } });
    s = cast(s, 'Test Wrath');
    expect(s.zones.battlefield.map((id) => s.objects[id]!.defId)).toEqual([]);
  });
  it('a rejected action never changes the state object (the batch funnel leaves no half-applied destruction when a spell is declined)', () => {
    const s = scenario([], { defs, p1: { hand: ['Test Wrath'], battlefield: ['Test Surgeon'] } });
    const r = applyAction(s, { type: 'cast', player: 'p2', card: find(s, 'Test Wrath', 'hand', 'p1') });
    expect(r.error).toBeDefined();
    expect(r.state).toBe(s);
  });
});

describe('trek-8 re-review: indestructible is settled for the whole batch (CR 608.2f, 702.12b)', () => {
  const SURGEON = card('Test Surgeon', 'Legendary Creature — Human Doctor', 'If another creature you control with a +1/+1 counter on it would be destroyed, instead remove all +1/+1 counters from it and all damage already dealt to it is healed.', { pt: ['2', '2'] });
  const WARDEN = card('Test Warden', 'Creature — Human', 'Other creatures you control have indestructible.', { pt: ['2', '2'] });
  const WRATH = card('Test Wrath', 'Sorcery', 'Destroy all creatures.');
  const defs = [SURGEON, WARDEN, WRATH, BEAR];
  for (const order of [['Test Warden', 'Test Surgeon', 'M'], ['M', 'Test Surgeon', 'Test Warden'], ['Test Surgeon', 'Test Warden', 'M'], ['Test Warden', 'M']]) {
    it(`a creature that gives indestructible is destroyed with the one it protects: the protected one survives in every battlefield order (${order.join(', ')})`, () => {
      let s = scenario([], { defs, p1: { hand: ['Test Wrath'], battlefield: order.map((n) => (n === 'M' ? { name: 'Test Bear', counters: { '+1/+1': 1 } } : n)) as never[] } });
      const bear = find(s, 'Test Bear', 'battlefield', 'p1');
      const warden = find(s, 'Test Warden', 'battlefield', 'p1');
      s = cast(s, 'Test Wrath');
      expect(onBf(s, bear)).toBe(true);
      expect(onBf(s, warden), 'the one that is not itself indestructible is destroyed').toBe(false);
      if (order.includes('Test Surgeon')) expect(s.objects[bear]!.counters['+1/+1'] ?? 0, 'indestructible: nothing to replace, the counter stays').toBe(1);
    });
  }
});

describe('trek-8 re-review: a permanent cast for its sneak cost joins the combat as the returned creature did, also with Kira Nerys out (CR 702.190b)', () => {
  for (const withKira of [false, true]) {
    it(`Splinter, Hamato Yoshi attacks the planeswalker the returned creature attacked, nobody is asked (Kira out: ${withKira})`, () => {
      prompts.length = 0;
      let s = scenario(['Garruk Wildspeaker', 'Splinter, Hamato Yoshi', 'Swamp'], { defs: [RALLIER, BEAR], p1: { hand: ['Splinter, Hamato Yoshi'], battlefield: [...(withKira ? ['Test Rallier'] : []), 'Test Bear', 'Test Bear', 'Swamp', 'Swamp', 'Swamp'] as never[] }, p2: { battlefield: [{ name: 'Garruk Wildspeaker', counters: { loyalty: 3 } }] } });
      const [b1, b2] = findAll(s, 'Test Bear', 'battlefield', 'p1');
      const garruk = find(s, 'Garruk Wildspeaker', 'battlefield', 'p2');
      s = toDecision(advanceTo(s, 1, 'beginCombat'), 'declareAttackers');
      s = drive(answer(s, { kind: 'declareAttackers', attacks: [{ attacker: b1!, defender: garruk }, { attacker: b2!, defender: 'p2' }] }));
      for (let g = 0; g < 20 && s.turn.step !== 'declareBlockers'; g++) s = s.pending?.kind === 'priority' ? pass(s) : s.pending?.kind === 'declareBlockers' ? answer(s, { kind: 'declareBlockers', blocks: [] }) : drive(s);
      for (let g = 0; g < 10 && !(s.pending?.kind === 'priority' && s.pending.player === 'p1' && s.turn.step === 'declareBlockers'); g++) s = s.pending?.kind === 'priority' ? pass(s) : drive(s);
      s = act(s, { type: 'cast', player: 'p1', card: find(s, 'Splinter, Hamato Yoshi', 'hand', 'p1'), method: 'sneak' } as never);
      s = resolveAll(drive(s, { pick: () => [b1!] }), { options: ['Bob'] });
      const sp = find(s, 'Splinter, Hamato Yoshi', 'battlefield', 'p1');
      expect(attackerOf(s, sp)?.defender).toBe(garruk);
      expect(prompts.filter((x) => /attacking/.test(x))).toEqual([]);
    });
  }
});
