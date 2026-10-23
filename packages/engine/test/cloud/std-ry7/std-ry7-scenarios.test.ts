/**
 * std-ry7 (card wave 2, top-down Commander lane ry7): the round's readings played through the engine with synthetic cards compiled by the game's default
 * compiler (invented names, design 6.10). Each test is named after the rule it checks. CR cites written from memory in a cloud session (no rules/cr/):
 * unverified.
 *
 *   CR 605.1a, 605.3b, 121.1  a mana ability that also says "Draw a card.": the mana and the draw happen at once, without the stack, also after "Sacrifice ~"
 *   CR 605.3b, 603.7          a mana ability that also creates a delayed draw ("Draw a card at the beginning of the next turn's upkeep.")
 *   CR 605.3b, 502.3, 611.2a  a mana ability that also says "This land doesn't untap during your next untap step.": it stays tapped through that untap step only
 *   CR 702.137a, 119.3, 120.3a spectacle: the alternative cost only once an opponent lost life this turn (damage included; your own loss does not count)
 *   CR 702.137b, 607.2i       "if its spectacle cost was paid": the cast record of the spell the permanent was
 *   CR 702.103a-b, 303.4a     bestow: cast for its bestow cost, an Aura spell with enchant creature that targets a creature; cast normally, a creature spell
 *   CR 702.103b, 303.4f       the bestowed Aura enters attached to its target and is no creature (no power or toughness); its printed static applies
 *   CR 702.103e               a bestowed Aura spell whose target is illegal as it resolves resolves as a creature spell (it doesn't fizzle)
 *   CR 702.103f, 704.5m       a bestowed Aura that becomes unattached stops being bestowed and stays on the battlefield as a creature
 */
import { describe, expect, it } from 'vitest';
import { applyAction, charsOfObject, compileCard, legalActions, type CardDef, type DecisionAnswer, type GameState, type OracleCard } from '../../../src/index';
import { act, cast, drive, find, lands, next, resolveAll, scenario, target } from '../../m6/dfc/support';

function card(name: string, type: string, text: string, o: { pt?: [string, string]; cost?: string | null; colors?: string[] } = {}): CardDef {
  return compileCard({
    name, layout: 'normal', mana_cost: o.cost === null ? '' : o.cost ?? '{0}', type_line: type, oracle_text: text, colors: o.colors ?? [], keywords: [],
    ...(o.pt ? { power: o.pt[0], toughness: o.pt[1] } : {}),
  } as OracleCard);
}
const noManual = (d: CardDef): boolean => !JSON.stringify(d.faces).includes('"op":"manual"') && d.faces.every((f) => f.abilities.every((a) => a.kind !== 'manual'));
const full = (d: CardDef): boolean => d.automation.level === 'full' && noManual(d);
const handSize = (s: GameState, p: 'p1' | 'p2'): number => s.zones.hand[p]!.length;
const pool = (s: GameState, p: 'p1' | 'p2'): string => JSON.stringify(s.players.find((x) => x.id === p)!.manaPool);

/** Step forward (passing priority, declaring nothing) until `done` holds. */
function upTo(s: GameState, done: (t: GameState) => boolean, max = 400): GameState {
  let t = s;
  for (let i = 0; i < max && !done(t); i++) {
    t = t.pending && t.pending.kind !== 'priority' && t.pending.kind !== 'declareAttackers' && t.pending.kind !== 'declareBlockers' ? drive(t) : next(t);
  }
  return t;
}
const mainOf = (s: GameState, player: 'p1' | 'p2', turn: number): GameState =>
  upTo(s, (t) => t.turn.number === turn && t.turn.activePlayer === player && t.turn.step === 'main1' && t.pending?.kind === 'priority' && t.zones.stack.length === 0);
const activate = (s: GameState, id: string, answers: DecisionAnswer[] = []): GameState => {
  const la = legalActions(s, 'p1').find((a) => a.kind === 'activate' && a.object === id);
  expect(la, 'the mana ability is offered').toBeDefined();
  return drive(act(s, la!.action), answers);
};

describe('CR 605.1a, 605.3b, 121.1: a mana ability that also says "Draw a card."', () => {
  const EGG = card('Test Dawn Egg', 'Artifact', '{2}, {T}, Sacrifice this artifact: Add {W}{U}. Draw a card.', { cost: '{1}' });
  it('activating it adds the mana and draws the card at once, without the stack, after the artifact was sacrificed as a cost', () => {
    expect(full(EGG)).toBe(true);
    const s0 = scenario(['Plains'], { defs: [EGG], p1: { battlefield: ['Test Dawn Egg', ...lands('Plains', 2)] } });
    const egg = find(s0, 'Test Dawn Egg', 'battlefield', 'p1');
    const before = handSize(s0, 'p1');
    const s = activate(s0, egg);
    expect(handSize(s, 'p1')).toBe(before + 1);
    expect(s.zones.stack).toEqual([]);
    expect(pool(s, 'p1')).toContain('W');
    expect(pool(s, 'p1')).toContain('U');
    expect(s.zones.graveyard.p1!.some((id) => s.defs[s.objects[id]!.defId]!.name === 'Test Dawn Egg')).toBe(true);
    expect(handSize(s, 'p2')).toBe(handSize(s0, 'p2')); // the controller draws, nobody else
  });
  it('a draw for another player beside the mana is not read (fail closed)', () => {
    const OTHER = card('Test Gift Egg', 'Artifact', '{T}, Sacrifice this artifact: Add {W}. Each opponent draws a card.');
    expect(full(OTHER)).toBe(false);
    const MANY = card('Test Greedy Egg', 'Artifact', '{T}, Sacrifice this artifact: Add {W}. Draw X cards, where X is the number of artifacts you control.');
    expect(full(MANY)).toBe(false);
  });
});

describe('CR 605.3b, 603.7: a mana ability that also creates a delayed draw', () => {
  const SEXTANT = card('Test Thorn Sextant', 'Artifact', "{1}, {T}, Sacrifice this artifact: Add one mana of any color. Draw a card at the beginning of the next turn's upkeep.", { cost: '{1}' });
  it('the mana is added now; the card is drawn at the next upkeep (the next turn\'s, the opponent\'s), by the controller', () => {
    expect(full(SEXTANT)).toBe(true);
    const s0 = scenario(['Plains'], { defs: [SEXTANT], p1: { battlefield: ['Test Thorn Sextant', 'Plains'] } });
    const sextant = find(s0, 'Test Thorn Sextant', 'battlefield', 'p1');
    const before = handSize(s0, 'p1');
    const s1 = activate(s0, sextant, [{ kind: 'chooseColor', color: 'G' } as DecisionAnswer]);
    expect(pool(s1, 'p1')).toContain('G');
    expect(handSize(s1, 'p1')).toBe(before);
    expect(s1.zones.stack).toEqual([]);
    const s2 = upTo(s1, (t) => t.turn.activePlayer === 'p2' && t.turn.step === 'draw');
    expect(s2.turn.number).toBe(2);
    expect(handSize(s2, 'p1')).toBe(before + 1);
  });
});

describe('CR 605.3b, 502.3, 611.2a: a mana ability that also says "This land doesn\'t untap during your next untap step."', () => {
  const LAKE = card('Test Mistfall Lake', 'Land', "{T}: Add {W} or {U}. This land doesn't untap during your next untap step.", { cost: null });
  it('tapped for mana, it stays tapped through its controller\'s next untap step and untaps at the one after', () => {
    expect(full(LAKE)).toBe(true);
    const s0 = scenario(['Plains'], { defs: [LAKE], p1: { battlefield: ['Test Mistfall Lake', { name: 'Plains', tapped: true }] } });
    const lake = find(s0, 'Test Mistfall Lake', 'battlefield', 'p1');
    const plains = find(s0, 'Plains', 'battlefield', 'p1');
    expect(s0.objects[plains]!.tapped).toBe(true);
    const la = legalActions(s0, 'p1').filter((a) => a.kind === 'activate' && a.object === lake);
    expect(la.length).toBeGreaterThan(0);
    let s = drive(act(s0, la[0]!.action), [{ kind: 'chooseColor', color: 'U' } as DecisionAnswer]);
    expect(pool(s, 'p1')).toContain('U');
    expect(s.objects[lake]!.tapped).toBe(true);
    expect(s.zones.stack).toEqual([]);
    s = mainOf(s, 'p1', 3);
    expect(s.turn.number).toBe(3);
    expect(s.objects[lake]!.tapped).toBe(true); // its next untap step: it doesn't untap
    expect(s.objects[plains]!.tapped).toBe(false); // the other land untaps as usual
    s = mainOf(s, 'p1', 5);
    expect(s.turn.number).toBe(5);
    expect(s.objects[lake]!.tapped).toBe(false); // the effect ended with that untap step
  });
});

describe('CR 702.137a: spectacle, an alternative cost if an opponent lost life this turn', () => {
  const PUNCH = card('Test Crowd Punch', 'Instant', 'Test Crowd Punch deals 2 damage to any target.', { cost: '{R}', colors: ['R'] });
  const SPECTACLE_PUNCH = card('Test Rowdy Punch', 'Instant', 'Spectacle {R}\nTest Rowdy Punch deals 2 damage to any target.', { cost: '{4}{R}', colors: ['R'] });
  const DEMON = card('Test Pit Demon', 'Creature — Demon', 'Spectacle {B}\nWhen this creature enters, if its spectacle cost was paid, each opponent discards a card.', { cost: '{4}{B}', pt: ['4', '2'], colors: ['B'] });
  const BLEED = card('Test Self Bleed', 'Instant', 'You lose 2 life.', { cost: '{0}' });
  const DRAIN = card('Test Little Drain', 'Instant', 'Each opponent loses 1 life.', { cost: '{0}' });
  const board = (): GameState => scenario(['Mountain', 'Swamp'], {
    defs: [PUNCH, SPECTACLE_PUNCH, DEMON, BLEED, DRAIN],
    p1: { hand: ['Test Crowd Punch', 'Test Rowdy Punch', 'Test Pit Demon', 'Test Self Bleed', 'Test Little Drain'], battlefield: [...lands('Mountain', 2), 'Swamp'] },
    p2: { hand: ['Mountain', 'Mountain'] },
  });
  const trySpectacle = (s: GameState, name: string) => applyAction(s, { type: 'cast', player: 'p1', card: find(s, name, 'hand', 'p1'), method: 'spectacle' });

  it('the keyword is understood: the cards compile full', () => {
    for (const d of [SPECTACLE_PUNCH, DEMON]) expect(full(d), d.name).toBe(true);
  });
  it('before any opponent lost life this turn the spectacle cost is refused', () => {
    expect(trySpectacle(board(), 'Test Rowdy Punch').error).toBeDefined();
  });
  it('your own life loss does not count (an opponent must have lost life)', () => {
    let s = board();
    s = resolveAll(cast(s, 'Test Self Bleed'));
    expect(s.players.find((p) => p.id === 'p1')!.life).toBe(18);
    expect(trySpectacle(s, 'Test Rowdy Punch').error).toBeDefined();
  });
  it('after an opponent lost life (a loss of life, or damage, CR 120.3a) it can be cast for its spectacle cost', () => {
    let s = board();
    s = resolveAll(cast(s, 'Test Little Drain'));
    expect(s.players.find((p) => p.id === 'p2')!.life).toBe(19);
    const r = trySpectacle(s, 'Test Rowdy Punch');
    expect(r.error).toBeUndefined();
    let t = board();
    t = resolveAll(drive(act(t, { type: 'cast', player: 'p1', card: find(t, 'Test Crowd Punch', 'hand', 'p1') }), [target('p2')]));
    expect(t.players.find((p) => p.id === 'p2')!.life).toBe(18);
    expect(trySpectacle(t, 'Test Rowdy Punch').error).toBeUndefined();
  });
  it('CR 702.137b: "if its spectacle cost was paid" holds for the permanent cast that way, and not for one cast for its mana cost', () => {
    let s = board();
    s = resolveAll(cast(s, 'Test Little Drain'));
    const hand2 = s.zones.hand.p2!.length;
    const r = trySpectacle(s, 'Test Pit Demon');
    expect(r.error).toBeUndefined();
    s = resolveAll(drive(r.state), []);
    // the enters trigger resolves: the opponent discards a card (choosing it themselves)
    for (let i = 0; i < 10 && s.pending?.kind !== 'priority'; i++) s = drive(s, [{ kind: 'chooseObjects', ids: [s.zones.hand.p2![0]!] } as DecisionAnswer]);
    s = resolveAll(s, [{ kind: 'chooseObjects', ids: [s.zones.hand.p2![0]!] } as DecisionAnswer]);
    expect(s.zones.hand.p2!.length).toBe(hand2 - 1);
    const t0 = scenario(['Swamp'], { defs: [DEMON], p1: { hand: ['Test Pit Demon'], battlefield: lands('Swamp', 5) }, p2: { hand: ['Swamp'] } });
    const t = resolveAll(cast(t0, 'Test Pit Demon'));
    expect(t.zones.battlefield.some((id) => t.defs[t.objects[id]!.defId]!.name === 'Test Pit Demon')).toBe(true);
    expect(t.zones.hand.p2!.length).toBe(1);
  });
});

describe('CR 702.103: bestow', () => {
  const WOLF = card('Test Starfield Wolf', 'Enchantment Creature — Wolf', "Bestow {3}{G} (If you cast this card for its bestow cost, it's an Aura spell with enchant creature. It becomes a creature again if it's not attached.)\nEnchanted creature gets +2/+2.", { cost: '{1}{G}', pt: ['2', '2'], colors: ['G'] });
  const BEAR = card('Test Grove Bear', 'Creature — Bear', '', { cost: '{1}{G}', pt: ['2', '2'], colors: ['G'] });
  const RECALL = card('Test Quick Recall', 'Instant', "Return target creature to its owner's hand.", { cost: '{0}' });
  const KILL = card('Test Quick End', 'Instant', 'Destroy target creature.', { cost: '{0}' });
  const board = (): GameState => scenario(['Forest'], {
    defs: [WOLF, BEAR, RECALL, KILL],
    p1: { hand: ['Test Starfield Wolf', 'Test Quick Recall', 'Test Quick End'], battlefield: [...lands('Forest', 4), { name: 'Test Grove Bear', since: 0 }] },
  });
  const onBattlefield = (s: GameState, name: string): string | undefined => s.zones.battlefield.find((id) => s.defs[s.objects[id]!.defId]!.name === name);
  const bestowOn = (s: GameState, targetId: string): GameState =>
    drive(act(s, { type: 'cast', player: 'p1', card: find(s, 'Test Starfield Wolf', 'hand', 'p1'), method: 'bestow' }), [target(targetId)]);

  it('the keyword is understood: the card compiles full', () => expect(full(WOLF)).toBe(true));
  it('CR 702.103b, 303.4a: cast for its bestow cost it is an Aura spell with enchant creature that targets the creature, not a creature spell', () => {
    const s0 = board();
    const bear = find(s0, 'Test Grove Bear', 'battlefield', 'p1');
    const s = bestowOn(s0, bear);
    const spell = s.zones.stack[s.zones.stack.length - 1]!;
    const c = charsOfObject(s, s.objects[spell]!);
    expect(c.types).toEqual(['Enchantment']);
    expect(c.subtypes).toEqual(['Aura']);
    expect(c.power).toBeUndefined();
    expect(s.objects[spell]!.stack!.targets[0]![0]!.id).toBe(bear);
    expect(s.players.find((p) => p.id === 'p1')!.manaPool).toBeDefined();
    expect(s.zones.battlefield.filter((id) => s.objects[id]!.tapped).length).toBe(4); // its bestow cost {3}{G}, not its mana cost
  });
  it('CR 303.4f, 702.103b: it enters attached to the creature; the Aura is no creature and the enchanted creature gets +2/+2', () => {
    const s0 = board();
    const bear = find(s0, 'Test Grove Bear', 'battlefield', 'p1');
    const s = resolveAll(bestowOn(s0, bear));
    const wolf = onBattlefield(s, 'Test Starfield Wolf')!;
    expect(s.objects[wolf]!.attachedTo).toBe(bear);
    const wc = charsOfObject(s, s.objects[wolf]!);
    expect(wc.types).not.toContain('Creature');
    expect(wc.subtypes).not.toContain('Wolf');
    const bc = charsOfObject(s, s.objects[bear]!);
    expect([bc.power, bc.toughness]).toEqual(['4', '4']);
  });
  it('cast normally (for its mana cost) it is the enchantment creature the card is', () => {
    const s0 = board();
    const s = resolveAll(drive(act(s0, { type: 'cast', player: 'p1', card: find(s0, 'Test Starfield Wolf', 'hand', 'p1') })));
    const wolf = onBattlefield(s, 'Test Starfield Wolf')!;
    const c = charsOfObject(s, s.objects[wolf]!);
    expect(c.types).toEqual(['Enchantment', 'Creature']);
    expect(s.objects[wolf]!.attachedTo).toBeUndefined();
    expect(s.objects[wolf]!.bestowed).toBeUndefined();
  });
  it('CR 702.103e: its target illegal as it resolves (the creature left), it resolves as a creature spell instead of fizzling', () => {
    const s0 = board();
    const bear = find(s0, 'Test Grove Bear', 'battlefield', 'p1');
    let s = bestowOn(s0, bear);
    s = drive(act(s, { type: 'cast', player: 'p1', card: find(s, 'Test Quick Recall', 'hand', 'p1') }), [target(bear)]);
    s = resolveAll(s);
    expect(onBattlefield(s, 'Test Grove Bear')).toBeUndefined();
    const wolf = onBattlefield(s, 'Test Starfield Wolf');
    expect(wolf).toBeDefined();
    const c = charsOfObject(s, s.objects[wolf!]!);
    expect(c.types).toContain('Creature');
    expect([c.power, c.toughness]).toEqual(['2', '2']);
    expect(s.objects[wolf!]!.attachedTo).toBeUndefined();
  });
  it('CR 702.103f, 704.5m: when the enchanted creature dies, the Aura stops being bestowed and stays on the battlefield as a creature (it does not go to the graveyard)', () => {
    const s0 = board();
    const bear = find(s0, 'Test Grove Bear', 'battlefield', 'p1');
    let s = resolveAll(bestowOn(s0, bear));
    const wolf = onBattlefield(s, 'Test Starfield Wolf')!;
    s = resolveAll(drive(act(s, { type: 'cast', player: 'p1', card: find(s, 'Test Quick End', 'hand', 'p1') }), [target(bear)]));
    expect(onBattlefield(s, 'Test Grove Bear')).toBeUndefined();
    expect(s.objects[wolf]?.zone).toBe('battlefield'); // the same object
    expect(s.objects[wolf]!.bestowed).toBeUndefined();
    expect(s.objects[wolf]!.attachedTo).toBeUndefined();
    const c = charsOfObject(s, s.objects[wolf]!);
    expect(c.types).toContain('Creature');
    expect(c.subtypes).toContain('Wolf');
  });
  it('the legal actions offer both ways to cast it', () => {
    const s0 = board();
    const wolf = find(s0, 'Test Starfield Wolf', 'hand', 'p1');
    const casts = legalActions(s0, 'p1').filter((a) => a.kind === 'cast' && a.object === wolf);
    expect(casts.some((a) => (a.action as { method?: string }).method === 'bestow')).toBe(true);
    expect(casts.some((a) => (a.action as { method?: string }).method === undefined)).toBe(true);
  });
  it('a card without bestow is not offered the method', () => {
    const s0 = board();
    const r = applyAction(s0, { type: 'cast', player: 'p1', card: find(s0, 'Test Quick End', 'hand', 'p1'), method: 'bestow' });
    expect(r.error).toBeDefined();
  });
});
