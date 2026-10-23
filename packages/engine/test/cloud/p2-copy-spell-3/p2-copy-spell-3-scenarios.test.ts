/**
 * Lane p2-copy-spell, round p2-copy-spell-3: the round's readings played through the engine with synthetic cards (invented names and wordings, design 6.10),
 * compiled by the game's default compiler. CR cites from memory, unverified (rules/cr/ is not in the cloud checkout).
 *
 *   CR 707.10, 707.10c   "The controller of target instant spell copies it. That player may choose new targets for the copy.": the copy is the spell's
 *                        controller's, whoever activated the ability, and that player chooses its new targets
 *   CR 707.10c, 101.4    "each player copies it": every one of those players puts a copy of their own onto the stack (effects/handlers/tokens-copy.ts)
 *   CR 603.7, 707.10     "Until end of turn, whenever a player casts an instant or sorcery spell, that player copies it ...": the copies are not cast, so
 *                        they trigger nothing more
 */
import { describe, expect, it } from 'vitest';
import { compileCard, type CardDef, type GameState, type OracleCard, type PlayerId } from '../../../src/index';
import { act, answer, find, pass, scenario } from '../../m3/scenario';

function card(name: string, type: string, text: string, pt?: [string, string], cost = '{0}'): CardDef {
  return compileCard({ name, layout: 'normal', mana_cost: cost, type_line: type, oracle_text: text, colors: [], keywords: [], ...(pt ? { power: pt[0], toughness: pt[1] } : {}) } as OracleCard);
}
/** The card is parsed and automated without a manual unit. */
const automated = (d: CardDef): boolean => !JSON.stringify(d.faces).includes('"op":"manual"') && d.faces.every((f) => f.abilities.every((a) => a.kind !== 'manual'));
const life = (s: GameState, p: PlayerId): number => s.players.find((x) => x.id === p)!.life;

/** Resolve everything: targets by `targets`, yes/no always no (keep the copies' targets), passing priority, recording the controllers of spell copies seen. */
function settle(s0: GameState, targets: (player: PlayerId, prompt: string) => { kind: 'player'; id: PlayerId }[], copies: PlayerId[] = []): GameState {
  let s = s0;
  const seen = new Set<string>();
  for (let guard = 0; guard < 300 && s.pending && !(s.pending.kind === 'priority' && s.zones.stack.length === 0 && s.pending.player === 'p1'); guard++) {
    for (const id of s.zones.stack) if (s.objects[id]?.kind === 'spellCopy' && !seen.has(id)) { seen.add(id); copies.push(s.objects[id]!.controller); }
    const d = s.pending;
    if (d.kind === 'chooseTargets') s = answer(s, { kind: 'chooseTargets', targets: targets(d.player, d.prompt) });
    else if (d.kind === 'payCost') s = answer(s, { kind: 'payCost', auto: true });
    else if (d.kind === 'yesNo') s = answer(s, { kind: 'yesNo', yes: false });
    else if (d.kind === 'priority') s = pass(s);
    else throw new Error(`unexpected decision ${d.kind}: ${d.prompt}`);
  }
  return s;
}

describe('CR 707.10c: "The controller of target instant spell copies it. That player may choose new targets for the copy."', () => {
  const TWIN = card('Test Echo Glass', 'Artifact', '{0}: The controller of target instant spell copies it. That player may choose new targets for the copy.');
  const BALM = card('Test Small Balm', 'Instant', 'Target player gains 3 life.');
  it('is parsed and automated: a copy of the target whose copier is its controller, with new targets they may choose', () => {
    expect(automated(TWIN)).toBe(true);
    expect(JSON.stringify(TWIN.faces[0]!.abilities)).toContain('"op":"copy","what":{"ref":"target","id":"t0"},"result":"spell","who":{"ref":"controllerOf","object":{"ref":"target","id":"t0"}},"newTargets":"may"');
  });
  it('another player activates it on your spell: the copy is yours, not theirs', () => {
    let s = scenario([], { p1: { hand: ['Test Small Balm'] }, p2: { battlefield: ['Test Echo Glass'] }, defs: [TWIN, BALM] });
    s = act(s, { type: 'cast', player: 'p1', card: find(s, 'Test Small Balm', 'hand', 'p1') });
    while (s.pending?.kind === 'chooseTargets' || s.pending?.kind === 'payCost') {
      s = s.pending.kind === 'chooseTargets' ? answer(s, { kind: 'chooseTargets', targets: [{ kind: 'player', id: 'p1' }] }) : answer(s, { kind: 'payCost', auto: true });
    }
    s = pass(s); // p1 passes priority with the instant on the stack: p2 gets it
    expect(s.pending?.kind === 'priority' && s.pending.player).toBe('p2');
    const balm = s.zones.stack.at(-1)!;
    s = act(s, { type: 'activate', player: 'p2', source: find(s, 'Test Echo Glass', 'battlefield', 'p2'), ability: 'p:0:0' });
    const copies: PlayerId[] = [];
    s = settle(s, (_p, prompt) => (prompt.includes('copy') ? [] : [{ kind: 'object', id: balm } as never]), copies);
    expect(copies).toEqual(['p1']);
    expect(life(s, 'p1')).toBe(26);
    expect(life(s, 'p2')).toBe(20);
  });
});

describe('CR 707.10c, 101.4: "each player copies it" (one copy for every player, each theirs)', () => {
  const ROUND = card('Test Shared Toast', 'Sorcery', 'Until end of turn, whenever a player casts an instant or sorcery spell, each player copies it and may choose new targets for the copy.');
  const BALM = card('Test Small Balm', 'Instant', 'Target player gains 3 life.');
  it('is parsed and automated', () => expect(automated(ROUND)).toBe(true));
  it('each player puts a copy of their own onto the stack; the copies are not cast, so they trigger nothing more', () => {
    let s = scenario([], { p1: { hand: ['Test Shared Toast', 'Test Small Balm'] }, defs: [ROUND, BALM] });
    s = act(s, { type: 'cast', player: 'p1', card: find(s, 'Test Shared Toast', 'hand', 'p1') });
    s = settle(s, () => []);
    s = act(s, { type: 'cast', player: 'p1', card: find(s, 'Test Small Balm', 'hand', 'p1') });
    const copies: PlayerId[] = [];
    s = settle(s, () => [{ kind: 'player', id: 'p1' }], copies);
    expect([...copies].sort()).toEqual(['p1', 'p2']);
    expect(life(s, 'p1')).toBe(29);
  });
});

describe('CR 603.7, 707.10c: "Until end of turn, whenever a player casts an instant or sorcery spell, that player copies it and may choose new targets for the copy."', () => {
  const ROUND = card('Test Encore Night', 'Sorcery', 'Until end of turn, whenever a player casts an instant or sorcery spell, that player copies it and may choose new targets for the copy.');
  const BALM = card('Test Small Balm', 'Instant', 'Target player gains 3 life.');
  it('is parsed and automated', () => expect(automated(ROUND)).toBe(true));
  it('the caster copies each instant they cast this turn, once (the copy is not cast)', () => {
    let s = scenario([], { p1: { hand: ['Test Encore Night', 'Test Small Balm'] }, defs: [ROUND, BALM] });
    s = act(s, { type: 'cast', player: 'p1', card: find(s, 'Test Encore Night', 'hand', 'p1') });
    s = settle(s, () => []);
    s = act(s, { type: 'cast', player: 'p1', card: find(s, 'Test Small Balm', 'hand', 'p1') });
    const copies: PlayerId[] = [];
    s = settle(s, () => [{ kind: 'player', id: 'p1' }], copies);
    expect(copies).toEqual(['p1']);
    expect(life(s, 'p1')).toBe(26);
  });
});
