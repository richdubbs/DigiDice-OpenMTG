/**
 * Commander lane edh-perms, round edh-perms-4: the engine capability `feature:enchant.zone` ("Enchant creature card in a graveyard", Animate Dead, Dance of the Dead, Necromancy), played
 * through the engine with synthetic cards (invented names), compiled by the game's default compiler. CR cites from the Comprehensive Rules of 2026-09-25 (media.wizards.com) and the
 * Scryfall rulings of Animate Dead, Dance of the Dead and Necromancy (fetched 2026-10-27).
 */
import { describe, expect, it } from 'vitest';
import { compileCard, type CardDef, type GameState, type ObjectId, type OracleCard, type TargetChoice } from '../../../src/index';
import { getChars } from '../../../src/rules/characteristics';
import { act, advanceTo, answer, find, pass, scenario } from '../../m3/scenario';
import { tweak } from '../../m11/rules/helpers';

function card(name: string, type: string, text: string, opts: { pt?: [string, string]; cost?: string } = {}): CardDef {
  return compileCard({ name, layout: 'normal', mana_cost: opts.cost ?? '', type_line: type, oracle_text: text, colors: [], keywords: [], ...(opts.pt ? { power: opts.pt[0], toughness: opts.pt[1] } : {}) } as OracleCard);
}

const RAISE_TEXT = 'Enchant creature card in a graveyard\nWhen this Aura enters, if it\'s on the battlefield, it loses "enchant creature card in a graveyard" and gains "enchant creature put onto the battlefield with this Aura." Return enchanted creature card to the battlefield under your control and attach this Aura to it. When this Aura leaves the battlefield, that creature\'s controller sacrifices it.\nEnchanted creature gets -1/-0.';
const RAISE = card('Test Raise Aura', 'Enchantment — Aura', RAISE_TEXT, { cost: '{0}' });
const BEAR = card('Test Grave Bear', 'Creature — Bear', '', { pt: ['3', '3'] });
const WOLF = card('Test Grave Wolf', 'Creature — Wolf', '', { pt: ['2', '2'] });
const GHOST = card('Test Pro Black Ghost', 'Creature — Spirit', 'Protection from black', { pt: ['2', '2'] });
const SHROUD = card('Test Shroud Elk', 'Creature — Elk', 'Shroud', { pt: ['2', '2'] });
const LAND = card('Test Plain Land', 'Land', '');
const EXILE_YARD = card('Test Exile Spell', 'Instant', 'Exile target creature card from a graveyard.', { cost: '{0}' });
const SMASH = card('Test Smash Spell', 'Instant', 'Destroy target enchantment.', { cost: '{0}' });
const STEAL = card('Test Steal Spell', 'Instant', 'Gain control of target creature.', { cost: '{0}' });
const PLAIN_AURA = card('Test Plain Aura', 'Enchantment — Aura', 'Enchant creature\nEnchanted creature gets +1/+1.', { cost: '{0}' });
const BLACK_RAISE = compileCard({ name: 'Test Black Raise Aura', layout: 'normal', mana_cost: '{0}', type_line: 'Enchantment — Aura', oracle_text: RAISE_TEXT, colors: ['B'], keywords: [] } as OracleCard);
const DANCE = card('Test Dance Aura', 'Enchantment — Aura', RAISE_TEXT.replace('Return enchanted creature card to the battlefield under', 'Put enchanted creature card onto the battlefield tapped under').replace('Enchanted creature gets -1/-0.', 'Enchanted creature gets +1/+1 and doesn\'t untap during its controller\'s untap step.'), { cost: '{0}' });
const NECRO_TEXT = 'You may cast this spell as though it had flash. If you cast it any time a sorcery couldn\'t have been cast, the controller of the permanent it becomes sacrifices it at the beginning of the next cleanup step.\nWhen this enchantment enters, if it\'s on the battlefield, it becomes an Aura with "enchant creature put onto the battlefield with Test Necro Ench." Put target creature card from a graveyard onto the battlefield under your control and attach this enchantment to it. When this enchantment leaves the battlefield, that creature\'s controller sacrifices it.';
const NECRO = card('Test Necro Ench', 'Enchantment', NECRO_TEXT, { cost: '{0}' });
const FLASH_GRANTER = card('Test Flash Granter', 'Enchantment', 'You may cast spells as though they had flash.', { cost: '{0}' });
const FLASH_AURA = card('Test Flash Aura', 'Enchantment — Aura', 'You may cast this spell as though it had flash. If you cast it any time a sorcery couldn\'t have been cast, the controller of the permanent it becomes sacrifices it at the beginning of the next cleanup step.\nEnchant creature\nEnchanted creature gets +2/+2.', { cost: '{0}' });
const PHASE = card('Test Phase Spell', 'Instant', 'Target permanent phases out.', { cost: '{0}' });
const PLATE = card('Test Plate Equipment', 'Artifact — Equipment', 'Equipped creature gets +1/+1.\nEquip {1}', { cost: '{0}' });
const BLACK_AURA_DEFS = [PHASE, FLASH_AURA, PLATE, NECRO, FLASH_GRANTER, RAISE, BEAR, WOLF, GHOST, SHROUD, LAND, EXILE_YARD, SMASH, STEAL, PLAIN_AURA, BLACK_RAISE, DANCE];

const automated = (d: CardDef): boolean => d.automation.level === 'full';

/** Answer every decision until a player has priority (targets from the queue, yes/no by `yes`, mana automatically). */
function drive(s0: GameState, o: { yes?: boolean; targets?: TargetChoice[][] } = {}): GameState {
  let s = s0;
  const tq = [...(o.targets ?? [])];
  for (let guard = 0; guard < 60 && s.pending && s.pending.kind !== 'priority'; guard++) {
    const p = s.pending as unknown as { kind: string; options?: ObjectId[]; min?: number; max?: number };
    if (p.kind === 'payCost') s = answer(s, { kind: 'payCost', auto: true });
    else if (p.kind === 'yesNo') s = answer(s, { kind: 'yesNo', yes: o.yes ?? true });
    else if (p.kind === 'chooseTargets') s = answer(s, { kind: 'chooseTargets', targets: tq.shift() ?? [] });
    else if (p.kind === 'chooseObjects') s = answer(s, { kind: 'chooseObjects', ids: p.options!.slice(0, Math.max(p.min ?? 0, 1)).slice(0, p.max) });
    else throw new Error(`unexpected decision ${JSON.stringify(s.pending)}`);
  }
  return s;
}
function resolveAll(s0: GameState, o: Parameters<typeof drive>[1] = {}): GameState {
  let s = drive(s0, o);
  for (let guard = 0; guard < 40 && (s.zones.stack.length > 0 || (s.pending && s.pending.kind !== 'priority')); guard++) s = s.pending?.kind === 'priority' ? pass(s) : drive(s, o);
  return s;
}
const objTarget = (id: ObjectId): TargetChoice => ({ kind: 'object', id }) as TargetChoice;
const onBf = (s: GameState, name: string, who?: 'p1' | 'p2'): ObjectId[] => s.zones.battlefield.filter((id) => getChars(s, id)!.name === name && (who === undefined || s.objects[id]!.controller === who));
const inYard = (s: GameState, name: string, who: 'p1' | 'p2'): ObjectId[] => s.zones.graveyard[who]!.filter((id) => getChars(s, id)!.name === name);

describe('the cards are automated', () => {
  it('the Aura compiles to full automation', () => expect(automated(RAISE)).toBe(true));
});

describe('CR 303.4a, 303.4f, 607.2a: an Aura that enchants a creature card in a graveyard (Scryfall rulings of Animate Dead, 2016-06-08)', () => {
  it('is cast targeting a creature card in a graveyard, returns that card under your control, attaches itself to it and shrinks it', () => {
    const s0 = scenario([], { p1: { hand: ['Test Raise Aura'] }, p2: { graveyard: ['Test Grave Bear'] }, defs: BLACK_AURA_DEFS });
    const bearCard = find(s0, 'Test Grave Bear', 'graveyard', 'p2');
    const t = act(s0, { type: 'cast', player: 'p1', card: find(s0, 'Test Raise Aura', 'hand', 'p1') });
    expect(t.pending?.kind).toBe('chooseTargets');
    const s1 = resolveAll(t, { targets: [[objTarget(bearCard)]] });
    expect(s1.zones.stack).toHaveLength(0);
    const aura = onBf(s1, 'Test Raise Aura', 'p1');
    expect(aura).toHaveLength(1);
    const bear = onBf(s1, 'Test Grave Bear', 'p1');
    expect(bear).toHaveLength(1); // the creature is under the Aura's controller's control, it came from the opponent's graveyard
    expect(inYard(s1, 'Test Grave Bear', 'p2')).toHaveLength(0);
    expect(s1.objects[aura[0]!]!.attachedTo).toBe(bear[0]);
    const c = getChars(s1, bear[0]!)!;
    expect(`${c.power}/${c.toughness}`).toBe('2/3'); // "Enchanted creature gets -1/-0"
    // the Aura never went to a graveyard (ruling 2016-06-08)
    expect(s1.zones.graveyard.p1!.some((id) => getChars(s1, id)!.name === 'Test Raise Aura')).toBe(false);
    // the Aura's enchant ability is now the restricted one (CR 613.1f, 702.5a)
    const kws = getChars(s1, aura[0]!)!.keywords.filter((k) => k.keyword === 'enchant');
    expect(kws).toHaveLength(1);
    expect(kws[0]!.filter?.zone).toBeUndefined();
  });
});

/** p1 casts `aura` at `target`; the resulting state is returned with p1 holding priority (the stack has the Aura spell on it). */
const castAt = (s0: GameState, aura: string, target: ObjectId, who: 'p1' | 'p2' = 'p1'): GameState => drive(act(s0, { type: 'cast', player: who, card: find(s0, aura, 'hand', who) }), { targets: [[objTarget(target)]] });

describe('CR 608.2b, 303.4a: the target card leaves the graveyard before the Aura spell resolves', () => {
  it('the Aura spell is countered on resolution (all its targets are illegal) and goes to its owner\'s graveyard; the card stays where it went', () => {
    const s0 = scenario([], { p1: { hand: ['Test Raise Aura'] }, p2: { hand: ['Test Exile Spell'], graveyard: ['Test Grave Bear'] }, defs: BLACK_AURA_DEFS });
    const bearCard = find(s0, 'Test Grave Bear', 'graveyard', 'p2');
    let s = castAt(s0, 'Test Raise Aura', bearCard);
    expect(s.zones.stack).toHaveLength(1);
    s = pass(s); // p1 passes; p2 may respond
    expect(s.pending?.kind).toBe('priority');
    expect((s.pending as unknown as { player: string }).player).toBe('p2');
    s = drive(act(s, { type: 'cast', player: 'p2', card: find(s, 'Test Exile Spell', 'hand', 'p2') }), { targets: [[objTarget(bearCard)]] });
    s = resolveAll(s);
    expect(onBf(s, 'Test Raise Aura')).toHaveLength(0);
    expect(inYard(s, 'Test Raise Aura', 'p1')).toHaveLength(1);
    expect(onBf(s, 'Test Grave Bear')).toHaveLength(0);
    expect(s.zones.exile.some((id) => getChars(s, id)!.name === 'Test Grave Bear')).toBe(true);
  });
});

describe('CR 704.5m, 603.4: the card leaves the graveyard while the enters trigger waits on the stack', () => {
  it('the Aura is put into the graveyard as a state-based action (it is attached to nothing it may enchant) and its trigger does nothing (the intervening "if it\'s on the battlefield")', () => {
    const s0 = scenario([], { p1: { hand: ['Test Raise Aura'] }, p2: { hand: ['Test Exile Spell'], graveyard: ['Test Grave Bear'] }, defs: BLACK_AURA_DEFS });
    const bearCard = find(s0, 'Test Grave Bear', 'graveyard', 'p2');
    let s = castAt(s0, 'Test Raise Aura', bearCard);
    s = pass(s); // p1 passes, p2 passes: the Aura spell resolves
    s = pass(s);
    expect(onBf(s, 'Test Raise Aura', 'p1')).toHaveLength(1);
    expect(s.zones.stack).toHaveLength(1); // the enters trigger
    expect((s.pending as unknown as { player: string }).player).toBe('p1');
    s = pass(s); // p1 passes: p2 responds by exiling the card
    s = drive(act(s, { type: 'cast', player: 'p2', card: find(s, 'Test Exile Spell', 'hand', 'p2') }), { targets: [[objTarget(bearCard)]] });
    s = resolveAll(s);
    expect(onBf(s, 'Test Raise Aura')).toHaveLength(0);
    expect(inYard(s, 'Test Raise Aura', 'p1')).toHaveLength(1);
    expect(onBf(s, 'Test Grave Bear')).toHaveLength(0);
  });
});

describe('CR 607.2a, 701.21a, 109.4: when the Aura leaves the battlefield, that creature\'s controller sacrifices it (the linked ability)', () => {
  const setup = (extra: { p1Hand?: string[]; p2Hand?: string[]; p1Yard?: string[]; p2Yard?: string[] } = {}): { s: GameState; bearCard: ObjectId } => {
    const s0 = scenario([], {
      p1: { hand: ['Test Raise Aura', ...(extra.p1Hand ?? [])], graveyard: extra.p1Yard ?? [] }, p2: { hand: extra.p2Hand ?? [], graveyard: extra.p2Yard ?? [] }, defs: BLACK_AURA_DEFS,
    });
    const owner = (extra.p1Yard ?? []).length > 0 ? 'p1' : 'p2';
    const bearCard = find(s0, 'Test Grave Bear', 'graveyard', owner);
    return { s: resolveAll(castAt(s0, 'Test Raise Aura', bearCard)), bearCard };
  };
  it('the Aura destroyed: its controller sacrifices the creature (it goes to its owner\'s graveyard)', () => {
    let { s } = setup({ p1Hand: ['Test Smash Spell'], p2Yard: ['Test Grave Bear'] });
    expect(onBf(s, 'Test Grave Bear', 'p1')).toHaveLength(1);
    s = resolveAll(drive(act(s, { type: 'cast', player: 'p1', card: find(s, 'Test Smash Spell', 'hand', 'p1') }), { targets: [[objTarget(onBf(s, 'Test Raise Aura')[0]!)]] }));
    expect(onBf(s, 'Test Raise Aura')).toHaveLength(0);
    expect(onBf(s, 'Test Grave Bear')).toHaveLength(0);
    expect(inYard(s, 'Test Grave Bear', 'p2')).toHaveLength(1); // the opponent's card: its owner's graveyard
    expect(inYard(s, 'Test Raise Aura', 'p1')).toHaveLength(1);
  });
  it('the creature changed controllers first: the CURRENT controller of the creature sacrifices it, not the controller of the Aura', () => {
    let { s } = setup({ p1Hand: ['Test Smash Spell'], p2Hand: ['Test Steal Spell'], p1Yard: ['Test Grave Bear'] });
    const bear = onBf(s, 'Test Grave Bear', 'p1')[0]!;
    s = pass(s); // p1 passes with an empty stack: p2 may act first
    expect((s.pending as unknown as { player: string }).player).toBe('p2');
    s = resolveAll(drive(act(s, { type: 'cast', player: 'p2', card: find(s, 'Test Steal Spell', 'hand', 'p2') }), { targets: [[objTarget(bear)]] }));
    expect(s.objects[bear]!.controller).toBe('p2');
    expect(onBf(s, 'Test Raise Aura', 'p1')).toHaveLength(1); // still p1's Aura, attached to the creature p2 controls
    s = resolveAll(drive(act(s, { type: 'cast', player: 'p1', card: find(s, 'Test Smash Spell', 'hand', 'p1') }), { targets: [[objTarget(onBf(s, 'Test Raise Aura')[0]!)]] }));
    expect(onBf(s, 'Test Grave Bear')).toHaveLength(0);
    expect(inYard(s, 'Test Grave Bear', 'p1')).toHaveLength(1); // sacrificed by p2: into its owner's (p1's) graveyard
  });
  it('the creature died first: the Aura goes to the graveyard as a state-based action and the trigger finds nothing to sacrifice (the card in the graveyard is a new object)', () => {
    let { s } = setup({ p1Hand: ['Test Smash Spell'], p2Yard: ['Test Grave Bear'] });
    // kill the creature: the Aura has nothing to enchant (CR 704.5m); the creature card in the graveyard is not sacrificed or moved again by the leaves trigger
    const bear = onBf(s, 'Test Grave Bear', 'p1')[0]!;
    s.objects[bear]!.damage = 3;
    s = pass(pass(s)); // SBA run when priority is given: let a pass resolve the state
    expect(onBf(s, 'Test Grave Bear')).toHaveLength(0);
    expect(onBf(s, 'Test Raise Aura')).toHaveLength(0);
    expect(inYard(s, 'Test Grave Bear', 'p2')).toHaveLength(1);
    expect(inYard(s, 'Test Raise Aura', 'p1')).toHaveLength(1);
  });
});

describe('Scryfall rulings of Animate Dead (2016-06-08): protection and shroud work on the battlefield only', () => {
  it('a creature card with shroud can be the target in the graveyard, and the Aura attaches to the creature that enters', () => {
    const s0 = scenario([], { p1: { hand: ['Test Raise Aura'] }, p2: { graveyard: ['Test Shroud Elk'] }, defs: BLACK_AURA_DEFS });
    const elkCard = find(s0, 'Test Shroud Elk', 'graveyard', 'p2');
    const s = resolveAll(castAt(s0, 'Test Raise Aura', elkCard));
    const elk = onBf(s, 'Test Shroud Elk', 'p1');
    expect(elk).toHaveLength(1);
    expect(s.objects[onBf(s, 'Test Raise Aura')[0]!]!.attachedTo).toBe(elk[0]);
  });
  it('a creature with protection from black: the black Aura can target the card, but can\'t attach to the creature that enters: it goes to the graveyard and the creature is sacrificed', () => {
    const s0 = scenario([], { p1: { hand: ['Test Black Raise Aura'], battlefield: ['Test Plain Land'] }, p2: { graveyard: ['Test Pro Black Ghost'] }, defs: BLACK_AURA_DEFS });
    const ghostCard = find(s0, 'Test Pro Black Ghost', 'graveyard', 'p2');
    const t = act(s0, { type: 'cast', player: 'p1', card: find(s0, 'Test Black Raise Aura', 'hand', 'p1') });
    expect(t.pending?.kind).toBe('chooseTargets');
    expect((t.pending as unknown as { objects: ObjectId[] }).objects).toContain(ghostCard);
    const s = resolveAll(t, { targets: [[objTarget(ghostCard)]] });
    expect(onBf(s, 'Test Black Raise Aura')).toHaveLength(0);
    expect(inYard(s, 'Test Black Raise Aura', 'p1')).toHaveLength(1);
    expect(onBf(s, 'Test Pro Black Ghost')).toHaveLength(0); // sacrificed by the leaves trigger, the creature's controller being the Aura's controller
    expect(inYard(s, 'Test Pro Black Ghost', 'p2')).toHaveLength(1);
  });
});

describe('CR 303.4a: the targets of the Aura spell', () => {
  it('only creature cards in graveyards can be chosen: not a creature on the battlefield, not a land card in a graveyard', () => {
    const s0 = scenario([], { p1: { hand: ['Test Raise Aura'], battlefield: ['Test Grave Wolf'] }, p2: { graveyard: ['Test Grave Bear', 'Test Plain Land'] }, defs: BLACK_AURA_DEFS });
    const t = act(s0, { type: 'cast', player: 'p1', card: find(s0, 'Test Raise Aura', 'hand', 'p1') });
    const objects = (t.pending as unknown as { objects: ObjectId[] }).objects;
    expect(objects).toEqual([find(s0, 'Test Grave Bear', 'graveyard', 'p2')]);
  });
  it('any graveyard: with creature cards in both graveyards both are choices', () => {
    const s0 = scenario([], { p1: { hand: ['Test Raise Aura'], graveyard: ['Test Grave Wolf'] }, p2: { graveyard: ['Test Grave Bear'] }, defs: BLACK_AURA_DEFS });
    const t = act(s0, { type: 'cast', player: 'p1', card: find(s0, 'Test Raise Aura', 'hand', 'p1') });
    expect([...(t.pending as unknown as { objects: ObjectId[] }).objects].sort()).toEqual([find(s0, 'Test Grave Bear', 'graveyard', 'p2'), find(s0, 'Test Grave Wolf', 'graveyard', 'p1')].sort());
  });
  it('with no creature card in any graveyard the Aura can\'t be cast', () => {
    const s0 = scenario([], { p1: { hand: ['Test Raise Aura'] }, p2: { graveyard: ['Test Plain Land'] }, defs: BLACK_AURA_DEFS });
    const legalCast = (s: GameState) => (s.pending as unknown as { legal?: { kind: string }[] }).legal ?? [];
    expect(legalCast(s0).filter((a) => a.kind === 'cast').length).toBe(0);
  });
});

describe('Dance of the Dead wording: "Put enchanted creature card onto the battlefield tapped under your control and attach this Aura to it."', () => {
  it('the creature enters tapped, under your control, and the Aura\'s +1/+1 applies to the new creature', () => {
    const s0 = scenario([], { p1: { hand: ['Test Dance Aura'] }, p2: { graveyard: ['Test Grave Bear'] }, defs: BLACK_AURA_DEFS });
    const s = resolveAll(castAt(s0, 'Test Dance Aura', find(s0, 'Test Grave Bear', 'graveyard', 'p2')));
    const bear = onBf(s, 'Test Grave Bear', 'p1');
    expect(bear).toHaveLength(1);
    expect(s.objects[bear[0]!]!.tapped).toBe(true);
    const c = getChars(s, bear[0]!)!;
    expect(`${c.power}/${c.toughness}`).toBe('4/4');
    expect(s.objects[onBf(s, 'Test Dance Aura')[0]!]!.attachedTo).toBe(bear[0]);
  });
});

describe('every other Aura and Equipment behaves as before (CR 303.4, 301.5, 704.5m, 704.5n)', () => {
  it('an Aura with "Enchant creature" still targets creatures on the battlefield only and a creature card in a graveyard is no choice', () => {
    const s0 = scenario([], { p1: { hand: ['Test Plain Aura'], battlefield: ['Test Grave Wolf'] }, p2: { graveyard: ['Test Grave Bear'] }, defs: BLACK_AURA_DEFS });
    const t = act(s0, { type: 'cast', player: 'p1', card: find(s0, 'Test Plain Aura', 'hand', 'p1') });
    expect((t.pending as unknown as { objects: ObjectId[] }).objects).toEqual([find(s0, 'Test Grave Wolf', 'battlefield', 'p1')]);
  });
  it('a plain Aura goes to the graveyard when the enchanted creature leaves the battlefield (704.5m) and sacrifices nothing', () => {
    const s0 = scenario([], { p1: { hand: ['Test Plain Aura'], battlefield: ['Test Grave Wolf'] }, p2: { hand: ['Test Smash Spell'], graveyard: ['Test Grave Bear'] }, defs: BLACK_AURA_DEFS });
    const wolf = find(s0, 'Test Grave Wolf', 'battlefield', 'p1');
    let s = resolveAll(castAt(s0, 'Test Plain Aura', wolf));
    expect(s.objects[onBf(s, 'Test Plain Aura')[0]!]!.attachedTo).toBe(wolf);
    s.objects[wolf]!.damage = 3;
    s = pass(pass(s));
    expect(onBf(s, 'Test Grave Wolf')).toHaveLength(0);
    expect(onBf(s, 'Test Plain Aura')).toHaveLength(0);
    expect(inYard(s, 'Test Plain Aura', 'p1')).toHaveLength(1);
  });
});

describe('Necromancy wording: it becomes an Aura as its enters trigger resolves (Scryfall rulings of Necromancy, 2005-08-01, 2004-10-04)', () => {
  it('is automated', () => expect(automated(NECRO)).toBe(true));
  it('cast at sorcery timing: it is an enchantment on the battlefield, then an Aura attached to the creature put onto the battlefield under your control; nothing is sacrificed', () => {
    const s0 = scenario([], { p1: { hand: ['Test Necro Ench'] }, p2: { graveyard: ['Test Grave Bear'] }, defs: BLACK_AURA_DEFS });
    const bearCard = find(s0, 'Test Grave Bear', 'graveyard', 'p2');
    let s = drive(act(s0, { type: 'cast', player: 'p1', card: find(s0, 'Test Necro Ench', 'hand', 'p1') }));
    expect(getChars(s, s.zones.stack[0]!)!.subtypes).not.toContain('Aura'); // an enchantment spell, no target
    s = pass(s);
    s = pass(s); // the spell resolves: the enters trigger goes on the stack and asks for its target
    s = resolveAll(s, { targets: [[objTarget(bearCard)]] });
    const necro = onBf(s, 'Test Necro Ench', 'p1');
    const bear = onBf(s, 'Test Grave Bear', 'p1');
    expect(necro).toHaveLength(1);
    expect(bear).toHaveLength(1);
    expect(getChars(s, necro[0]!)!.subtypes).toContain('Aura');
    expect(s.objects[necro[0]!]!.attachedTo).toBe(bear[0]);
    // the end of the turn: no sacrifice for a spell cast at sorcery timing
    s = advanceTo(s, 2, 'upkeep');
    expect(onBf(s, 'Test Necro Ench', 'p1')).toHaveLength(1);
    expect(onBf(s, 'Test Grave Bear', 'p1')).toHaveLength(1);
  });
  it('cast at instant speed (a time a sorcery couldn\'t have been cast): sacrificed at the beginning of the next cleanup step, and with it the creature', () => {
    const s0 = scenario([], { p1: { hand: ['Test Necro Ench'] }, p2: { graveyard: ['Test Grave Bear'] }, defs: BLACK_AURA_DEFS });
    const bearCard = find(s0, 'Test Grave Bear', 'graveyard', 'p2');
    let s = advanceTo(s0, 1, 'end');
    s = drive(act(s, { type: 'cast', player: 'p1', card: find(s, 'Test Necro Ench', 'hand', 'p1') }));
    s = pass(s);
    s = pass(s);
    s = resolveAll(s, { targets: [[objTarget(bearCard)]] });
    expect(onBf(s, 'Test Necro Ench', 'p1')).toHaveLength(1);
    expect(onBf(s, 'Test Grave Bear', 'p1')).toHaveLength(1);
    s = advanceTo(s, 2, 'upkeep');
    expect(onBf(s, 'Test Necro Ench')).toHaveLength(0);
    expect(inYard(s, 'Test Necro Ench', 'p1')).toHaveLength(1);
    expect(onBf(s, 'Test Grave Bear')).toHaveLength(0); // its leaves trigger: the creature's controller sacrificed it
    expect(inYard(s, 'Test Grave Bear', 'p2')).toHaveLength(1);
  });
  it('cast with another source of flash (the player uses that permission, not its own): not sacrificed', () => {
    const s0 = scenario([], { p1: { hand: ['Test Necro Ench'], battlefield: ['Test Flash Granter'] }, p2: { graveyard: ['Test Grave Bear'] }, defs: BLACK_AURA_DEFS });
    const bearCard = find(s0, 'Test Grave Bear', 'graveyard', 'p2');
    let s = advanceTo(s0, 1, 'end');
    s = drive(act(s, { type: 'cast', player: 'p1', card: find(s, 'Test Necro Ench', 'hand', 'p1') }));
    s = pass(s);
    s = pass(s);
    s = resolveAll(s, { targets: [[objTarget(bearCard)]] });
    s = advanceTo(s, 2, 'upkeep');
    expect(onBf(s, 'Test Necro Ench', 'p1')).toHaveLength(1);
    expect(onBf(s, 'Test Grave Bear', 'p1')).toHaveLength(1);
  });
  it('the target card left the graveyard: the trigger does nothing at all, Necromancy stays an enchantment on the battlefield (the whole ability, "becomes an Aura" included, is countered, CR 608.2b)', () => {
    const s0 = scenario([], { p1: { hand: ['Test Necro Ench'] }, p2: { hand: ['Test Exile Spell'], graveyard: ['Test Grave Bear'] }, defs: BLACK_AURA_DEFS });
    const bearCard = find(s0, 'Test Grave Bear', 'graveyard', 'p2');
    let s = drive(act(s0, { type: 'cast', player: 'p1', card: find(s0, 'Test Necro Ench', 'hand', 'p1') }));
    s = pass(s);
    s = pass(s);
    s = drive(s, { targets: [[objTarget(bearCard)]] }); // the trigger waits on the stack with its target
    expect(s.zones.stack).toHaveLength(1);
    s = pass(s); // p1 passes; p2 exiles the card in response
    s = drive(act(s, { type: 'cast', player: 'p2', card: find(s, 'Test Exile Spell', 'hand', 'p2') }), { targets: [[objTarget(bearCard)]] });
    s = resolveAll(s);
    expect(onBf(s, 'Test Necro Ench', 'p1')).toHaveLength(1);
    expect(getChars(s, onBf(s, 'Test Necro Ench', 'p1')[0]!)!.subtypes).not.toContain('Aura');
    expect(onBf(s, 'Test Grave Bear')).toHaveLength(0);
  });
});

describe('Equipment and Auras that enchant a battlefield permanent keep the battlefield-only attachment rules (CR 704.5m, 704.5n, 301.5)', () => {
  it('an Equipment attached to a creature that dies becomes unattached and stays on the battlefield (704.5n)', () => {
    let s = scenario([], { p1: { battlefield: ['Test Plate Equipment', 'Test Grave Wolf'] }, defs: BLACK_AURA_DEFS });
    const wolf = find(s, 'Test Grave Wolf', 'battlefield', 'p1');
    const plate = find(s, 'Test Plate Equipment', 'battlefield', 'p1');
    s = tweak(s, (t) => { t.objects[plate]!.attachedTo = wolf; });
    expect(Number(getChars(s, wolf)!.power)).toBe(3);
    s.objects[wolf]!.damage = 3;
    s = pass(pass(s));
    expect(onBf(s, 'Test Grave Wolf')).toHaveLength(0);
    expect(onBf(s, 'Test Plate Equipment', 'p1')).toHaveLength(1);
    expect(s.objects[plate]!.attachedTo).toBeUndefined();
  });
  it('an Equipment attached to a card in a graveyard is unattached (it can be attached to a creature on the battlefield only); the Aura that enchants a graveyard card is the one exception, and only because of its own enchant ability', () => {
    const s0 = scenario([], { p1: { hand: ['Test Plain Aura'], battlefield: ['Test Plate Equipment', 'Test Grave Wolf'] }, p2: { graveyard: ['Test Grave Bear'] }, defs: BLACK_AURA_DEFS });
    const bearCard = find(s0, 'Test Grave Bear', 'graveyard', 'p2');
    const plate = find(s0, 'Test Plate Equipment', 'battlefield', 'p1');
    let s = resolveAll(castAt(s0, 'Test Plain Aura', find(s0, 'Test Grave Wolf', 'battlefield', 'p1')));
    const aura = onBf(s, 'Test Plain Aura', 'p1')[0]!;
    s = tweak(s, (t) => { t.objects[plate]!.attachedTo = bearCard; t.objects[aura]!.attachedTo = bearCard; });
    s = pass(pass(s));
    expect(s.objects[plate]!.attachedTo).toBeUndefined();
    expect(onBf(s, 'Test Plate Equipment', 'p1')).toHaveLength(1);
    expect(onBf(s, 'Test Plain Aura')).toHaveLength(0); // "Enchant creature" is a battlefield restriction: a card in a graveyard is no legal object (704.5m)
    expect(inYard(s, 'Test Plain Aura', 'p1')).toHaveLength(1);
  });
});

describe('CR 603.4 (Scryfall ruling of Animate Dead, 2016-06-08): "If Animate Dead isn\'t on the battlefield as its triggered ability resolves, none of its effects happen"', () => {
  it('the Aura is destroyed in response to its enters trigger: the creature card is NOT returned and stays in the graveyard (the intervening "if" is rechecked on resolution)', () => {
    const s0 = scenario([], { p1: { hand: ['Test Raise Aura'] }, p2: { hand: ['Test Smash Spell'], graveyard: ['Test Grave Bear'] }, defs: BLACK_AURA_DEFS });
    const bearCard = find(s0, 'Test Grave Bear', 'graveyard', 'p2');
    let s = castAt(s0, 'Test Raise Aura', bearCard);
    s = pass(pass(s)); // the Aura spell resolves, its trigger waits on the stack
    expect(onBf(s, 'Test Raise Aura', 'p1')).toHaveLength(1);
    expect(s.zones.stack).toHaveLength(1);
    s = pass(s); // p1 passes; p2 destroys the Aura in response
    s = drive(act(s, { type: 'cast', player: 'p2', card: find(s, 'Test Smash Spell', 'hand', 'p2') }), { targets: [[objTarget(onBf(s, 'Test Raise Aura')[0]!)]] });
    s = resolveAll(s);
    expect(onBf(s, 'Test Raise Aura')).toHaveLength(0);
    expect(inYard(s, 'Test Raise Aura', 'p1')).toHaveLength(1);
    expect(inYard(s, 'Test Grave Bear', 'p2')).toHaveLength(1); // still where it was
    expect(onBf(s, 'Test Grave Bear')).toHaveLength(0);
  });
});

describe('an ordinary Aura with the same flash clause (the clause is the card\'s own: CR 601.3b, 603.7)', () => {
  it('cast at sorcery timing: stays; cast at instant speed: sacrificed at the beginning of the next cleanup step', () => {
    const mk = () => scenario([], { p1: { hand: ['Test Flash Aura'], battlefield: ['Test Grave Wolf'] }, defs: BLACK_AURA_DEFS });
    const wolfOf = (s: GameState) => find(s, 'Test Grave Wolf', 'battlefield', 'p1');
    let s = resolveAll(castAt(mk(), 'Test Flash Aura', wolfOf(mk())));
    expect(Number(getChars(s, wolfOf(s))!.power)).toBe(4);
    s = advanceTo(s, 2, 'upkeep');
    expect(onBf(s, 'Test Flash Aura', 'p1')).toHaveLength(1);
    const s1 = advanceTo(mk(), 1, 'end');
    let t = resolveAll(castAt(s1, 'Test Flash Aura', wolfOf(s1)));
    expect(onBf(t, 'Test Flash Aura', 'p1')).toHaveLength(1);
    t = advanceTo(t, 2, 'upkeep');
    expect(onBf(t, 'Test Flash Aura')).toHaveLength(0);
    expect(inYard(t, 'Test Flash Aura', 'p1')).toHaveLength(1);
    expect(onBf(t, 'Test Grave Wolf', 'p1')).toHaveLength(1); // only the Aura is sacrificed
  });
});

describe('"if it\'s on the battlefield" asks about the object now (CR 400.7, 603.4, 702.26b)', () => {
  const GAIN = card('Test Dies Gain', 'Enchantment', 'Whenever a creature dies, if it\'s on the battlefield, you gain 1 life.', { cost: '{0}' });
  it('an object that died is not on the battlefield: nothing happens', () => {
    const s0 = scenario([], { p1: { battlefield: ['Test Dies Gain', 'Test Grave Wolf'] }, defs: [...BLACK_AURA_DEFS, GAIN] });
    let s = s0;
    s.objects[find(s0, 'Test Grave Wolf', 'battlefield', 'p1')]!.damage = 2;
    const before = s.players.find((p) => p.id === 'p1')!.life;
    s = pass(pass(s));
    expect(s.players.find((p) => p.id === 'p1')!.life).toBe(before);
  });
});

describe('CR 702.26b, 603.4: a phased-out Aura is treated as though it doesn\'t exist when its enters trigger resolves', () => {
  it('phased out in response to the trigger: the creature card is not returned', () => {
    const s0 = scenario([], { p1: { hand: ['Test Raise Aura'] }, p2: { hand: ['Test Phase Spell'], graveyard: ['Test Grave Bear'] }, defs: BLACK_AURA_DEFS });
    let s = castAt(s0, 'Test Raise Aura', find(s0, 'Test Grave Bear', 'graveyard', 'p2'));
    s = pass(pass(s));
    s = pass(s);
    s = drive(act(s, { type: 'cast', player: 'p2', card: find(s, 'Test Phase Spell', 'hand', 'p2') }), { targets: [[objTarget(onBf(s, 'Test Raise Aura')[0]!)]] });
    s = resolveAll(s);
    expect(onBf(s, 'Test Grave Bear')).toHaveLength(0);
    expect(inYard(s, 'Test Grave Bear', 'p2')).toHaveLength(1);
  });
});
