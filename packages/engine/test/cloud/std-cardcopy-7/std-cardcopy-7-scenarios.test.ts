/**
 * Lane std-cardcopy, round std-cardcopy-7, played through the engine with synthetic cards compiled by the game's default compiler (invented names and wordings,
 * design 6.10). CR cites from memory, unverified (rules/cr/ is not in the cloud checkout).
 *
 *   CR 608.2d, 707.12    "You may cast up to two of the copies ...": one choice of the copies to cast, at most two; the others are not cast
 *   CR 608.2d, 202.3     "... any number of spells with total mana value 3 or less from among the copies ...": the chosen ones keep the total
 *   CR 115.1, 205.2a     "up to one target nonland card of each card type": the targets can be given different card types (an artifact creature counts for one)
 *   CR 118.3, 107.4      a cost "with N or more black mana symbols among their mana costs": the cards exiled must reach the total
 */
import { describe, expect, it } from 'vitest';
import { compileCard, legalActions, type CardDef, type GameState, type ObjectId, type OracleCard } from '../../../src/index';
import { getChars } from '../../../src/rules/characteristics';
import { act, answer, find, pass, scenario } from '../../m3/scenario';

function card(name: string, type: string, text: string, opts: { pt?: [string, string]; cost?: string; colors?: string[] } = {}): CardDef {
  return compileCard({
    name, layout: 'normal', mana_cost: opts.cost ?? '{0}', type_line: type, oracle_text: text, colors: opts.colors ?? [],
    ...(opts.pt ? { power: opts.pt[0], toughness: opts.pt[1] } : {}),
  } as OracleCard);
}
const noManual = (d: CardDef): boolean => d.automation.level !== 'manual' && !JSON.stringify(d.faces).includes('"op":"manual"') && d.faces.every((f) => f.abilities.every((a) => a.kind !== 'manual'));
const nameOf = (s: GameState, id: ObjectId): string => getChars(s, id).name;
const life = (s: GameState, p: string): number => s.players.find((x) => x.id === p)!.life;
const byHandLog = (s: GameState): boolean => s.log.some((l) => /by hand/.test(l.text));

type Pick = (options: ObjectId[], max: number, s: GameState, prompt: string) => ObjectId[];
/** Answer every decision: objects by `pick`, targets in order from `targets` (player ids allowed), mana automatically. */
function drive(s0: GameState, o: { pick?: Pick; targets?: string[][] } = {}): GameState {
  let s = s0;
  const tq = o.targets ?? []; // shared across the calls of one resolution (shift consumes it)
  for (let guard = 0; guard < 60 && s.pending && s.pending.kind !== 'priority'; guard++) {
    const p = s.pending;
    if (p.kind === 'payCost') s = answer(s, { kind: 'payCost', auto: true });
    else if (p.kind === 'chooseObjects') s = answer(s, { kind: 'chooseObjects', ids: o.pick ? o.pick(p.options, p.max, s, (p as unknown as { prompt: string }).prompt) : p.options.slice(0, p.max) });
    else if (p.kind === 'chooseTargets') s = answer(s, { kind: 'chooseTargets', targets: (tq.shift() ?? []).map((id) => (/^p\d+$/.test(id) ? { kind: 'player' as const, id } : { kind: 'object' as const, id })) });
    else if (p.kind === 'chooseNumber') s = answer(s, { kind: 'chooseNumber', n: p.min });
    else if (p.kind === 'yesNo') s = answer(s, { kind: 'yesNo', yes: true });
    else if (p.kind === 'order') s = answer(s, { kind: 'order', ids: p.items.map((x) => x.id) });
    else throw new Error(`unexpected decision ${p.kind}`);
  }
  return s;
}
function resolveAll(s0: GameState, o: Parameters<typeof drive>[1] = {}): GameState {
  let s = drive(s0, o);
  for (let guard = 0; guard < 60 && (s.zones.stack.length > 0 || (s.pending && s.pending.kind !== 'priority')); guard++) s = s.pending?.kind === 'priority' ? pass(s) : drive(s, o);
  return s;
}
const byNames = (names: string[]): Pick => (options, _max, s) => names.map((n) => options.find((id) => nameOf(s, id) === n)!).filter((x) => x !== undefined);

const ZAP = card('Test Zap', 'Instant', 'Test Zap deals 1 damage to target player.', { cost: '{R}' });
const JOLT = card('Test Jolt', 'Instant', 'Test Jolt deals 2 damage to target player.', { cost: '{1}{R}' });
const BLAST = card('Test Blast', 'Sorcery', 'Test Blast deals 3 damage to target player.', { cost: '{2}{R}' });
const BEAR = card('Test Bear', 'Creature — Bear', '', { pt: ['2', '2'], cost: '{1}{G}' });
const GOLEM = card('Test Golem', 'Artifact Creature — Golem', '', { pt: ['3', '3'], cost: '{3}' });
const TRINKET = card('Test Trinket', 'Artifact', '', { cost: '{1}' });
const COMMON = [ZAP, JOLT, BLAST, BEAR, GOLEM, TRINKET];

describe('CR 608.2d, 707.12: "Copy them. You may cast up to two of the copies without paying their mana costs." (rid.stdcardcopy7.mayCastUpToNCopies.free, cast.select)', () => {
  const ECHO = card('Test Echo', 'Sorcery', 'Exile any number of target instant and/or sorcery cards from your graveyard. Copy them. You may cast up to two of the copies without paying their mana costs.');
  const defs = [...COMMON, ECHO];
  it('has no manual part', () => expect(noManual(ECHO)).toBe(true));
  const setup = (): GameState => scenario([], { defs, p1: { hand: ['Test Echo'], graveyard: ['Test Zap', 'Test Jolt', 'Test Blast'] } });
  it('three exiled, two copies cast (Jolt and Blast: 5 damage), the third copy not cast; the cards stay in exile', () => {
    const s0 = setup();
    const gy = ['Test Zap', 'Test Jolt', 'Test Blast'].map((n) => find(s0, n, 'graveyard', 'p1'));
    const s = resolveAll(act(s0, { type: 'cast', player: 'p1', card: find(s0, 'Test Echo', 'hand') }), { targets: [gy, ['p2'], ['p2']], pick: byNames(['Test Jolt', 'Test Blast']) });
    expect(life(s, 'p2')).toBe(15);
    expect(s.zones.exile.map((id) => nameOf(s, id)).sort()).toEqual(['Test Blast', 'Test Jolt', 'Test Zap']);
    expect(s.zones.exile.every((id) => s.objects[id]!.kind === 'card')).toBe(true);
    expect(byHandLog(s)).toBe(false);
  });
  it('the negative case: choosing all three copies is not a legal answer (at most two)', () => {
    const s0 = setup();
    const gy = ['Test Zap', 'Test Jolt', 'Test Blast'].map((n) => find(s0, n, 'graveyard', 'p1'));
    expect(() => resolveAll(act(s0, { type: 'cast', player: 'p1', card: find(s0, 'Test Echo', 'hand') }), { targets: [gy], pick: (options) => options })).toThrow(/at most|between|choose/i);
  });
});

describe('CR 608.2d, 202.3: "... any number of spells with total mana value 3 or less from among the copies ..." (rid.stdcardcopy7.mayCastTotalMVFromCopies.free)', () => {
  const ECHO = card('Test Echo', 'Sorcery', 'Exile any number of target instant and/or sorcery cards from your graveyard. Copy them. You may cast any number of spells with total mana value 3 or less from among the copies without paying their mana costs.');
  const defs = [...COMMON, ECHO];
  it('has no manual part', () => expect(noManual(ECHO)).toBe(true));
  const setup = (): GameState => scenario([], { defs, p1: { hand: ['Test Echo'], graveyard: ['Test Zap', 'Test Jolt', 'Test Blast'] } });
  it('Zap (1) and Jolt (2) together are 3: both cast, 3 damage', () => {
    const s0 = setup();
    const gy = ['Test Zap', 'Test Jolt', 'Test Blast'].map((n) => find(s0, n, 'graveyard', 'p1'));
    const s = resolveAll(act(s0, { type: 'cast', player: 'p1', card: find(s0, 'Test Echo', 'hand') }), { targets: [gy, ['p2'], ['p2']], pick: byNames(['Test Zap', 'Test Jolt']) });
    expect(life(s, 'p2')).toBe(17);
  });
  it('the negative case: Jolt (2) and Blast (3) are 5, more than 3: not a legal answer', () => {
    const s0 = setup();
    const gy = ['Test Zap', 'Test Jolt', 'Test Blast'].map((n) => find(s0, n, 'graveyard', 'p1'));
    expect(() => resolveAll(act(s0, { type: 'cast', player: 'p1', card: find(s0, 'Test Echo', 'hand') }), { targets: [gy], pick: byNames(['Test Jolt', 'Test Blast']) })).toThrow(/limit/);
  });
});

describe('CR 115.1, 205.2a: "Exile up to one target nonland card of each card type from your graveyard." (TargetSpec.perCardType)', () => {
  const SIFT = card('Test Sift', 'Sorcery', 'Exile up to one target nonland card of each card type from your graveyard.');
  const defs = [...COMMON, SIFT];
  it('has no manual part', () => expect(noManual(SIFT)).toBe(true));
  const setup = (): GameState => scenario([], { defs, p1: { hand: ['Test Sift'], graveyard: ['Test Zap', 'Test Bear', 'Test Golem', 'Test Trinket', 'Plains'] } });
  const cast = (s0: GameState, names: string[]): GameState => resolveAll(act(s0, { type: 'cast', player: 'p1', card: find(s0, 'Test Sift', 'hand') }), { targets: [names.map((n) => find(s0, n, 'graveyard', 'p1'))] });
  it('an instant, a creature and an artifact creature (counted as the artifact) are one of each type: all three exiled', () => {
    const s = cast(setup(), ['Test Zap', 'Test Bear', 'Test Golem']);
    expect(s.zones.exile.map((id) => nameOf(s, id)).sort()).toEqual(['Test Bear', 'Test Golem', 'Test Zap']);
  });
  it('the negative case: an artifact, an artifact creature and a creature are not one of each type (only two types for three cards); the artifact and the artifact creature are (artifact, creature)', () => {
    expect(() => cast(setup(), ['Test Trinket', 'Test Golem', 'Test Bear'])).toThrow(/one of each card type/);
    const s = cast(setup(), ['Test Trinket', 'Test Golem']);
    expect(s.zones.exile.length).toBe(2);
  });
  it('a land card is never a legal target (nonland)', () => {
    expect(() => cast(setup(), ['Plains'])).toThrow(/target/i);
  });
});

describe('CR 118.3, 107.4: "Exile any number of black cards from your graveyard with four or more black mana symbols among their mana costs: Copy those exiled cards. ..." (exileFrom.total, costExiled)', () => {
  const NIGHT = card('Test Night', 'Sorcery', 'Target player loses 2 life.', { cost: '{B}{B}', colors: ['B'] });
  const DUSK = card('Test Dusk', 'Sorcery', 'Target player loses 1 life.', { cost: '{1}{B}', colors: ['B'] });
  const GLOOM = card('Test Gloom', 'Sorcery', 'Target player loses 3 life.', { cost: '{B}{B/G}', colors: ['B', 'G'] });
  const BARON = card('Test Baron', 'Creature — Human', 'Exile any number of black cards from your graveyard with four or more black mana symbols among their mana costs: Copy those exiled cards. You may cast up to one of the copies without paying their mana costs.', { pt: ['2', '2'], cost: '{B}' });
  const defs = [...COMMON, NIGHT, DUSK, GLOOM, BARON];
  it('has no manual part', () => expect(noManual(BARON)).toBe(true));
  const setup = (): GameState => scenario([], { defs, p1: { battlefield: ['Test Baron'], graveyard: ['Test Night', 'Test Dusk', 'Test Gloom', 'Test Zap'] } });
  const activate = (s0: GameState, cost: string[], cast: string): GameState => {
    const baron = find(s0, 'Test Baron', 'battlefield', 'p1');
    const la = legalActions(s0, s0.pending!.player).find((a) => a.kind === 'activate' && a.object === baron && !a.isMana)!;
    let first = true;
    return resolveAll(act(s0, la.action), {
      targets: [['p2']],
      pick: (options, max, s) => {
        if (first) { first = false; return byNames(cost)(options, max, s, ''); }
        return byNames([cast])(options, max, s, '');
      },
    });
  };
  it('Night ({B}{B}) and Gloom ({B}{B/G}: the hybrid symbol is black too) have four black symbols: both exiled, the Gloom copy cast (3 life)', () => {
    const s = activate(setup(), ['Test Night', 'Test Gloom'], 'Test Gloom');
    expect(life(s, 'p2')).toBe(17);
    expect(s.zones.exile.map((id) => nameOf(s, id)).sort()).toEqual(['Test Gloom', 'Test Night']);
  });
  it('the negative case: Night and Dusk have three black symbols, not enough; a red card is never offered', () => {
    expect(() => activate(setup(), ['Test Night', 'Test Dusk'], 'Test Night')).toThrow(/4 or more is needed/);
    const s0 = setup();
    const baron = find(s0, 'Test Baron', 'battlefield', 'p1');
    const la = legalActions(s0, s0.pending!.player).find((a) => a.kind === 'activate' && a.object === baron && !a.isMana)!;
    const s = act(s0, la.action);
    expect(s.pending?.kind).toBe('chooseObjects');
    expect((s.pending as unknown as { options: ObjectId[] }).options.map((id) => nameOf(s, id)).sort()).toEqual(['Test Dusk', 'Test Gloom', 'Test Night']);
  });
  it('with fewer than four black symbols in the graveyard the ability can not be activated (CR 118.3)', () => {
    const s0 = scenario([], { defs, p1: { battlefield: ['Test Baron'], graveyard: ['Test Night', 'Test Zap'] } });
    const baron = find(s0, 'Test Baron', 'battlefield', 'p1');
    expect(legalActions(s0, s0.pending!.player).some((a) => a.kind === 'activate' && a.object === baron && !a.isMana)).toBe(false);
  });
});

describe('CR 707.2, 400.7j: "Exile a creature card from your graveyard: Create a token that\'s a copy of the exiled card." (a token copy of what a cost exiled, `costExiled`)', () => {
  const MOLD = card('Test Mold', 'Artifact', '{T}, Exile a creature card from your graveyard: Create a token that\'s a copy of the exiled card.');
  const defs = [...COMMON, MOLD];
  it('has no manual part', () => expect(noManual(MOLD)).toBe(true));
  it('the token is a copy of the Bear the cost exiled; the card stays in exile', () => {
    const s0 = scenario([], { defs, p1: { battlefield: ['Test Mold'], graveyard: ['Test Bear'] } });
    const mold = find(s0, 'Test Mold', 'battlefield', 'p1');
    const la = legalActions(s0, s0.pending!.player).find((a) => a.kind === 'activate' && a.object === mold && !a.isMana)!;
    const s = resolveAll(act(s0, la.action));
    const tokens = s.zones.battlefield.filter((id) => s.objects[id]!.kind === 'token');
    expect(tokens.map((id) => nameOf(s, id))).toEqual(['Test Bear']);
    expect(s.zones.exile.map((id) => nameOf(s, id))).toEqual(['Test Bear']);
    expect(byHandLog(s)).toBe(false);
  });
  it('the negative case: with no creature card in the graveyard it can not be activated (CR 118.3)', () => {
    const s0 = scenario([], { defs, p1: { battlefield: ['Test Mold'], graveyard: ['Test Zap'] } });
    const mold = find(s0, 'Test Mold', 'battlefield', 'p1');
    expect(legalActions(s0, s0.pending!.player).some((a) => a.kind === 'activate' && a.object === mold && !a.isMana)).toBe(false);
  });
});
