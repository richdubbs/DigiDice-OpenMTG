/**
 * Standard round 5, slice r5-mech (set mechanics, words the lexicon lacks and copy leftovers, both halves): the mechanisms of
 * parser/templates/zz-cloud/r5-mech.json and the parser, renderer and engine support they needed, played through the engine with synthetic cards compiled by
 * the game's default compiler (invented names and wordings, design 6.10). Each test is named after the rule it checks.
 *
 *   CR 111.4, 105.2b        "Create a 4/4 Dragon creature token named ... that's all colors. It has flying, lifelink, and "When this token enters, ...""
 *   CR 111.4, 205.1b         "create a tapped Mutavault token" (the token Mutable Explorer's reminder text defines; model/named-tokens.ts)
 *   CR 108.3, 404.1, 406.1  "... cards you own in exile and in your graveyard that are Oozes or are named ~" (one count over two zones)
 *   CR 100.2a               "A deck can have any number of cards named ~." on an instant or sorcery is a static line, not part of the spell ability
 *   CR 118.3, 608.2c, 608.2m "Then you may exile this spell and N cards named ~ from your graveyard. If you do, ..."
 *   CR 603.7b, 702.177a, 707.10 "When you next activate an exhaust ability that isn't a mana ability this turn, copy it."
 */
import { describe, expect, it } from 'vitest';
import { compileCard, getChars, legalActions, ptNumbers, type CardDef, type DecisionAnswer, type GameState, type OracleCard } from '../../../src/index';
import { act, answer, cast, drive, resolveTop, scenario } from '../../m6/dfc/support';

function card(name: string, type: string, text: string, o: { pt?: [string, string]; cost?: string; colors?: string[] } = {}): CardDef {
  return compileCard({
    name, layout: 'normal', mana_cost: o.cost ?? '{0}', type_line: type, oracle_text: text, colors: o.colors ?? [], keywords: [],
    ...(o.pt ? { power: o.pt[0], toughness: o.pt[1] } : {}),
  } as OracleCard);
}
/** Nothing of the card is left manual. */
const noManual = (d: CardDef): boolean => !JSON.stringify(d.faces).includes('"op":"manual"') && d.faces.every((f) => f.abilities.every((a) => a.kind !== 'manual'));
const full = (d: CardDef): boolean => d.automation.level === 'full' && noManual(d);
const nameOf = (s: GameState, id: string): string => s.objects[id]!.kind === 'token' ? String((s.objects[id] as unknown as { token?: { name?: string } }).token?.name ?? getChars(s, id).name) : s.defs[s.objects[id]!.defId]!.name;
const named = (s: GameState, name: string): string[] => s.zones.battlefield.filter((id) => getChars(s, id).name === name);
/** Answer the decisions of a resolution: yes to every "may" (or no with `no`), the first options of every choice, automatic payments. */
function auto(s0: GameState, o: { no?: boolean; max?: number } = {}): GameState {
  let s = s0;
  for (let i = 0; i < (o.max ?? 40) && s.pending && s.pending.kind !== 'priority'; i++) {
    const p = s.pending as unknown as { kind: string; options?: unknown[]; min?: number; items?: { id: string }[] };
    let a: DecisionAnswer;
    if (p.kind === 'yesNo') a = { kind: 'yesNo', yes: o.no !== true };
    else if (p.kind === 'chooseObjects') a = { kind: 'chooseObjects', ids: (p.options as string[]).slice(0, Math.max(1, p.min ?? 1)) };
    else if (p.kind === 'chooseOption') a = { kind: 'chooseOption', ids: [(p.options as { id: string }[])[0]!.id] };
    else if (p.kind === 'payCost') a = { kind: 'payCost', auto: true };
    else if (p.kind === 'order') a = { kind: 'order', ids: p.items!.map((x) => x.id) };
    else if (p.kind === 'chooseTargets') a = { kind: 'chooseTargets', targets: [{ kind: 'player', id: 'p2' }] };
    else throw new Error(`auto: ${p.kind}`);
    s = answer(s, a);
  }
  return s;
}
const activateOf = (s: GameState, id: string, label?: RegExp) => legalActions(s, s.pending!.player).find((a) => a.kind === 'activate' && a.object === id && (!label || label.test(a.label)));
void nameOf;
const life = (s: GameState, p: 'p1' | 'p2'): number => s.players.find((x) => x.id === p)!.life;
const pt = (s: GameState, id: string): [number | null, number | null] => { const n = ptNumbers(getChars(s, id)); return [n.power, n.toughness]; };

// ---- CR 111.4, 105.2b: a named token that's all colors --------------------------------------------------------------------------------------------------

describe('CR 111.4, 105.2b: "Create a 4/4 Dragon creature token named ... that\'s all colors. It has flying, lifelink, and ..."', () => {
  const RELIC = card('Test Wyrm Reliquary', 'Artifact', '{T}: Create a 4/4 Dragon creature token named Test Prism Wyrm that\'s all colors. It has flying, lifelink, and "When this token enters, it deals 3 damage to target opponent."');
  it('is automated: one token with the name, the five colors and the rider\'s abilities', () => {
    expect(full(RELIC)).toBe(true);
    const tok = JSON.stringify(RELIC.faces[0]!.abilities[0]);
    expect(tok).toContain('"name":"Test Prism Wyrm"');
    expect(tok).toContain('"colors":["W","U","B","R","G"]');
  });
  it('the token is a 4/4 Dragon of all five colors named so, with flying and lifelink, and its enters trigger deals the damage', () => {
    const s0 = scenario([], { defs: [RELIC], p1: { battlefield: ['Test Wyrm Reliquary'] } });
    const relic = s0.zones.battlefield.find((id) => s0.defs[s0.objects[id]!.defId]?.name === 'Test Wyrm Reliquary')!;
    let s = resolveTop(drive(act(s0, activateOf(s0, relic)!.action)));
    s = auto(s);
    const [wyrm] = named(s, 'Test Prism Wyrm');
    expect(wyrm).toBeDefined();
    const c = getChars(s, wyrm!);
    expect([...c.colors].sort()).toEqual(['B', 'G', 'R', 'U', 'W']);
    expect(c.subtypes).toContain('Dragon');
    expect(pt(s, wyrm!)).toEqual([4, 4]);
    expect(JSON.stringify(c.abilities)).toContain('flying');
    expect(JSON.stringify(c.abilities)).toContain('lifelink');
    if (s.zones.stack.length > 0) s = auto(resolveTop(s));
    expect(life(s, 'p2')).toBe(17);
  });
  // merge wave 8: the all-colors reading is r5-fxb's general one (parser/holes/token.ts), which also reads a token with no name; r5-mech's own reading was for a
  // named token only. CR 105.2: a token "that's all colors" is each of the five colors, named or not
  it('CR 105.2: a token that\'s all colors with no name of its own is the five colors too (r5-fxb\'s reading, kept on the merge)', () => {
    const d = card('Test Plain Prism', 'Sorcery', 'Create a 4/4 Dragon creature token that\'s all colors.');
    expect(full(d)).toBe(true);
    expect(JSON.stringify(d.faces)).toContain('"colors":["W","U","B","R","G"]');
  });
});

// ---- CR 111.4: the Mutavault token ----------------------------------------------------------------------------------------------------------------------

describe('CR 111.4, 205.1b: "create a tapped Mutavault token" (a land with "{T}: Add {C}" and "{1}: This token becomes a 2/2 creature ...")', () => {
  const EXPLORER = card('Test Vault Seeker', 'Creature — Shapeshifter', 'When this creature enters, create a tapped Mutavault token. (It\'s a land with "{T}: Add {C}" and "{1}: This token becomes a 2/2 creature with all creature types until end of turn. It\'s still a land.")', { pt: ['1', '1'] });
  it('is automated with the token of model/named-tokens.ts', () => {
    expect(full(EXPLORER)).toBe(true);
    expect(JSON.stringify(EXPLORER.faces[0]!.abilities[0])).toContain('"name":"Mutavault"');
  });
  it('the token is a tapped colorless land; its {1} ability makes it a 2/2 creature with every creature type that is still a land, until end of turn', () => {
    const s0 = scenario([], { defs: [EXPLORER], p1: { hand: ['Test Vault Seeker'], battlefield: ['Plains', 'Plains'] } });
    const s = auto(resolveTop(auto(resolveTop(cast(s0, 'Test Vault Seeker')))));
    const [vault] = named(s, 'Mutavault');
    expect(vault).toBeDefined();
    expect(s.objects[vault!]!.tapped).toBe(true);
    let c = getChars(s, vault!);
    expect(c.types).toEqual(['Land']);
    expect(c.colors).toEqual([]);
    const animate = activateOf(s, vault!, /\{1\}/);
    expect(animate).toBeDefined();
    const s2 = auto(resolveTop(auto(drive(act(s, animate!.action)))));
    c = getChars(s2, vault!);
    expect(c.types).toContain('Creature');
    expect(c.types).toContain('Land');
    expect(pt(s2, vault!)).toEqual([2, 2]);
    expect(c.subtypes).toContain('Goblin');
  });
});

// ---- CR 108.3, 404.1, 406.1: cards you own in exile and in your graveyard -------------------------------------------------------------------------------

describe('CR 108.3, 406.1: "the total number of cards you own in exile and in your graveyard that are Oozes or are named ~"', () => {
  const SLIME = card('Test Slime Pact', 'Sorcery', 'Create a 0/0 green Ooze creature token with trample. Put X +1/+1 counters on it, where X is two plus the total number of cards you own in exile and in your graveyard that are Oozes or are named Test Slime Pact.\nA deck can have any number of cards named Test Slime Pact.', { cost: '{1}{G}' });
  const OOZE = card('Test Bog Ooze', 'Creature — Ooze', '', { pt: ['2', '2'] });
  const BEAR = card('Test Bear', 'Creature — Bear', '', { pt: ['2', '2'] });
  it('is automated; the deck-construction line is a static ability of its own (CR 100.2a), not an instruction of the spell', () => {
    expect(full(SLIME)).toBe(true);
    const kinds = SLIME.faces[0]!.abilities.map((a) => a.kind);
    expect(kinds).toContain('static');
    expect(kinds).toContain('spell');
  });
  it('counts your Oozes and same-named cards in exile and in your graveyard, not other cards, not an opponent\'s', () => {
    const s0 = scenario(['Forest'], {
      defs: [SLIME, OOZE, BEAR],
      p1: { hand: ['Test Slime Pact'], battlefield: ['Forest', 'Forest'], graveyard: ['Test Bog Ooze', 'Test Slime Pact', 'Test Bear'], exile: ['Test Bog Ooze', 'Test Bear'] },
      p2: { graveyard: ['Test Bog Ooze', 'Test Slime Pact'], exile: ['Test Bog Ooze'] },
    });
    const s = auto(resolveTop(cast(s0, 'Test Slime Pact')));
    const tok = s.zones.battlefield.find((id) => s.objects[id]!.kind === 'token' && getChars(s, id).subtypes.includes('Ooze'));
    expect(tok).toBeDefined();
    // 2 + (your graveyard: Ooze, Test Slime Pact; your exile: Ooze) = 5; the bears and the opponent's cards are not counted, the resolving spell is on the stack
    expect(s.objects[tok!]!.counters['+1/+1']).toBe(5);
  });
  const DRAKE = card('Test Spell Drake', 'Creature — Drake', "Flying\nThis creature's power is equal to the total number of instant and sorcery cards you own in exile and in your graveyard.", { pt: ['*', '4'] });
  const BOLT = card('Test Zap', 'Instant', 'Test Zap deals 1 damage to any target.');
  it('a characteristic-defining power counted over both zones (Crackling Drake\'s shape)', () => {
    expect(full(DRAKE)).toBe(true);
    const s = scenario([], { defs: [DRAKE, BOLT, BEAR], p1: { battlefield: ['Test Spell Drake'], graveyard: ['Test Zap', 'Test Bear'], exile: ['Test Zap', 'Test Zap'] }, p2: { graveyard: ['Test Zap'] } });
    const d = s.zones.battlefield.find((id) => s.defs[s.objects[id]!.defId]?.name === 'Test Spell Drake')!;
    expect(pt(s, d)[0]).toBe(3);
  });
  const SWARM = card('Test Husk Horde', 'Creature — Insect', 'This spell costs {1} less to cast for each creature card you own in exile and in your graveyard.', { cost: '{5}{B}', pt: ['5', '5'] });
  it('a cost reduction for each card over both zones (CR 601.2f): three creature cards make {5}{B} cost {2}{B}', () => {
    expect(full(SWARM)).toBe(true);
    const s0 = scenario(['Swamp'], { defs: [SWARM, BEAR, BOLT], p1: { hand: ['Test Husk Horde'], battlefield: ['Swamp', 'Swamp', 'Swamp'], graveyard: ['Test Bear', 'Test Zap'], exile: ['Test Bear', 'Test Bear'] }, p2: { graveyard: ['Test Bear'] } });
    const s = cast(s0, 'Test Husk Horde');
    expect(s.zones.stack.length).toBe(1);
    expect(s.zones.battlefield.filter((id) => s.objects[id]!.tapped).length).toBe(3);
  });
  it('fail closed: "cards in exile and in your graveyard" (no "you own") is not read as yours', () => {
    expect(full(card('Test Wide Drake', 'Creature — Drake', "This creature's power is equal to the total number of instant and sorcery cards in exile and in your graveyard.", { pt: ['*', '4'] }))).toBe(false);
  });
});

// ---- CR 118.3, 608.2c, 608.2m: a resolving spell exiles itself and named cards --------------------------------------------------------------------------

describe('CR 118.3, 608.2c: "Then you may exile this spell and two cards named ~ from your graveyard. If you do, ..."', () => {
  const APPROACH = card('Test Approach', 'Instant', 'Draw a card. Then you may exile this spell and two cards named Test Approach from your graveyard. If you do, you gain 10 life.\nA deck can have any number of cards named Test Approach.', { cost: '{1}{U}' });
  it('is automated', () => {
    expect(full(APPROACH)).toBe(true);
  });
  const board = (copies: number): GameState => scenario(['Island'], { defs: [APPROACH], p1: { hand: ['Test Approach'], battlefield: ['Island', 'Island'], graveyard: Array(copies).fill('Test Approach') as string[] } });
  const exiled = (s: GameState): string[] => s.zones.exile.filter((id) => s.defs[s.objects[id]!.defId]?.name === 'Test Approach');
  it('with two copies in the graveyard: the spell and both copies are exiled and the instruction after "If you do" happens', () => {
    const s0 = board(2);
    const s = auto(resolveTop(cast(s0, 'Test Approach')));
    expect(life(s, 'p1')).toBe(30);
    expect(exiled(s).length).toBe(3);
    expect(s.zones.graveyard['p1']!.length).toBe(0);
    expect(s.zones.stack.length).toBe(0);
  });
  it('declined: nothing is exiled, no life is gained, the spell goes to the graveyard', () => {
    const s = auto(resolveTop(cast(board(2), 'Test Approach')), { no: true });
    expect(life(s, 'p1')).toBe(20);
    expect(exiled(s).length).toBe(0);
    expect(s.zones.graveyard['p1']!.length).toBe(3);
  });
  it('with one copy only it cannot be done (CR 118.3): no life, nothing exiled', () => {
    const s = auto(resolveTop(cast(board(1), 'Test Approach')));
    expect(life(s, 'p1')).toBe(20);
    expect(exiled(s).length).toBe(0);
    expect(s.zones.graveyard['p1']!.length).toBe(2);
  });
  it('fail closed: the cards must be named; "and two cards from your graveyard" with this spell is not this template', () => {
    expect(full(card('Test Loose Approach', 'Instant', 'Draw a card. Then you may exile this spell and two cards from your graveyard. If you do, you gain 10 life.'))).toBe(false);
  });
});

// ---- CR 603.7b, 707.10: the next exhaust ability is copied ------------------------------------------------------------------------------------------------

describe('CR 603.7b, 702.177a, 707.10: "When you next activate an exhaust ability that isn\'t a mana ability this turn, copy it."', () => {
  const PIT = card('Test Echo Engine', 'Artifact Creature — Construct', "Defender\n{T}: When you next activate an exhaust ability that isn't a mana ability this turn, copy it. You may choose new targets for the copy.", { pt: ['0', '4'] });
  const DRAIN = card('Test Drain Rig', 'Artifact', 'Exhaust — {0}: Each opponent loses 2 life.');
  const DRAIN2 = card('Test Spare Rig', 'Artifact', 'Exhaust — {0}: Each opponent loses 1 life.');
  it('is automated as a once-only delayed trigger on the activation', () => {
    expect(full(PIT)).toBe(true);
    const j = JSON.stringify(PIT.faces[0]!.abilities[1]);
    expect(j).toContain('"op":"delay"');
    expect(j).toContain('"once":true');
  });
  const byName = (s: GameState, n: string): string => s.zones.battlefield.find((id) => s.defs[s.objects[id]!.defId]?.name === n)!;
  const resolveAll = (s0: GameState): GameState => { let s = s0; for (let i = 0; i < 10 && s.zones.stack.length > 0; i++) s = auto(resolveTop(auto(s))); return s; };
  it('the next exhaust ability this turn resolves twice (the copy and the original); a second one is not copied', () => {
    const s0 = scenario([], { defs: [PIT, DRAIN, DRAIN2], p1: { battlefield: ['Test Echo Engine', 'Test Drain Rig', 'Test Spare Rig'] } });
    let s = resolveAll(drive(act(s0, activateOf(s0, byName(s0, 'Test Echo Engine'))!.action)));
    s = resolveAll(auto(drive(act(s, activateOf(s, byName(s, 'Test Drain Rig'))!.action))));
    expect(life(s, 'p2')).toBe(16);
    s = resolveAll(auto(drive(act(s, activateOf(s, byName(s, 'Test Spare Rig'))!.action))));
    expect(life(s, 'p2')).toBe(15);
  });
  it('an ability that is not an exhaust ability is not copied, and the trigger keeps waiting', () => {
    const PING = card('Test Ping Rig', 'Artifact', '{0}: Each opponent loses 1 life. Activate only once each turn.');
    const s0 = scenario([], { defs: [PIT, DRAIN, PING], p1: { battlefield: ['Test Echo Engine', 'Test Drain Rig', 'Test Ping Rig'] } });
    let s = resolveAll(drive(act(s0, activateOf(s0, byName(s0, 'Test Echo Engine'))!.action)));
    s = resolveAll(auto(drive(act(s, activateOf(s, byName(s, 'Test Ping Rig'))!.action))));
    expect(life(s, 'p2')).toBe(19);
    s = resolveAll(auto(drive(act(s, activateOf(s, byName(s, 'Test Drain Rig'))!.action))));
    expect(life(s, 'p2')).toBe(15);
  });
});
