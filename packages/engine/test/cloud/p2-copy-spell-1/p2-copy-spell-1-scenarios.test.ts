/**
 * Lane p2-copy-spell, round p2-copy-spell-1: the round's readings played through the engine with synthetic cards (invented names and wordings, design 6.10),
 * compiled by the game's default compiler. CR cites from memory, unverified (rules/cr/ is not in the cloud checkout).
 *
 *   CR 707.10, 707.10c   "That player may copy this spell and may choose a new target for that copy.": the player who copies the spell controls the copy and
 *                        is the one who may choose its new targets; the copy is put onto the stack, not cast
 *   CR 608.2d            the option is that player's: when they decline, no copy
 *   CR 608.2h            "that permanent's controller" after the permanent left the battlefield is its controller as it last existed
 *   CR 707.10, 601.2     "If this spell was cast from a graveyard, you may copy this spell ...": a copy is not cast, so the copy never copies itself again
 */
import { describe, expect, it } from 'vitest';
import { compileCard, type CardDef, type GameState, type OracleCard, type PlayerId } from '../../../src/index';
import { act, answer, find, pass, scenario } from '../../m3/scenario';

function card(name: string, type: string, text: string, pt?: [string, string], cost = '{0}'): CardDef {
  return compileCard({ name, layout: 'normal', mana_cost: cost, type_line: type, oracle_text: text, colors: [], keywords: [], ...(pt ? { power: pt[0], toughness: pt[1] } : {}) } as OracleCard);
}
/** The card is parsed and automated without a manual unit. */
const automated = (d: CardDef): boolean => !JSON.stringify(d.faces).includes('"op":"manual"') && d.faces.every((f) => f.abilities.every((a) => a.kind !== 'manual'));

type Policy = {
  /** yes/no answers by player and prompt (default: no) */
  yes?: (player: PlayerId, prompt: string) => boolean;
  /** the targets a player chooses when asked (default: none) */
  targets?: (player: PlayerId, prompt: string, s: GameState) => { kind: 'player'; id: PlayerId }[] | { kind: 'object'; id: string }[];
  /** called whenever a copy is on top of the stack, with its controller */
  onCopy?: (controller: PlayerId) => void;
};
/** Pass priority and answer decisions by `policy` until the stack is empty and p1 has priority again. */
function settle(s0: GameState, policy: Policy): GameState {
  let s = s0;
  for (let guard = 0; guard < 300 && s.pending && !(s.pending.kind === 'priority' && s.zones.stack.length === 0 && s.pending.player === 'p1'); guard++) {
    const d = s.pending;
    const top = s.zones.stack.at(-1);
    if (top !== undefined && s.objects[top]?.kind === 'spellCopy') policy.onCopy?.(s.objects[top]!.controller);
    if (d.kind === 'chooseTargets') s = answer(s, { kind: 'chooseTargets', targets: policy.targets?.(d.player, d.prompt, s) ?? [] });
    else if (d.kind === 'payCost') s = answer(s, { kind: 'payCost', auto: true });
    else if (d.kind === 'yesNo') s = answer(s, { kind: 'yesNo', yes: policy.yes?.(d.player, d.prompt) ?? false });
    else if (d.kind === 'order') s = answer(s, { kind: 'order', ids: d.items.map((i) => i.id) });
    else if (d.kind === 'chooseObjects') s = answer(s, { kind: 'chooseObjects', ids: d.options.slice(0, d.min) });
    else if (d.kind === 'priority') s = pass(s);
    else throw new Error(`unexpected decision ${d.kind}: ${d.prompt}`);
  }
  return s;
}
const graveyardOf = (s: GameState, p: PlayerId): string[] => s.zones.graveyard[p]!.map((id) => s.objects[id]!.defId);

describe('CR 707.10c, 608.2d: "That player may copy this spell and may choose a new target for that copy."', () => {
  const SMOG = card('Test Ash Chain', 'Sorcery', 'Target player discards a card. That player may copy this spell and may choose a new target for that copy.');
  const ROCK = card('Test Pebble', 'Artifact', '');
  const DEFS = [SMOG, ROCK];
  const start = (): GameState => scenario([], { p1: { hand: ['Test Ash Chain', 'Test Pebble'] }, p2: { hand: ['Test Pebble', 'Test Pebble'] }, defs: DEFS });
  const cast = (s: GameState): GameState => act(s, { type: 'cast', player: 'p1', card: find(s, 'Test Ash Chain', 'hand', 'p1') });
  it('is parsed and automated: a `may` of the target player around a copy of this spell that is theirs, with new targets they may choose', () => {
    expect(automated(SMOG)).toBe(true);
    const json = JSON.stringify(SMOG.faces[0]!.abilities);
    expect(json).toContain('{"op":"may","who":{"ref":"target","id":"t0"},"do":[{"op":"copy","what":{"ref":"self"},"result":"spell","who":{"ref":"target","id":"t0"},"newTargets":"may"}]}');
  });
  it('the target player copies it: the copy is theirs, and the new target they choose (the caster) discards; the caster then declines', () => {
    const controllers: PlayerId[] = [];
    const s = settle(cast(start()), {
      targets: (p, prompt) => (prompt.includes('copy') ? (p === 'p2' ? [{ kind: 'player', id: 'p1' }] : []) : [{ kind: 'player', id: 'p2' }]),
      yes: (p) => p === 'p2',
      onCopy: (c) => controllers.push(c),
    });
    expect(graveyardOf(s, 'p2').filter((n) => n === 'Test Pebble').length).toBe(1);
    expect(graveyardOf(s, 'p1')).toContain('Test Pebble');
    expect(new Set(controllers)).toEqual(new Set(['p2']));
  });
  it('the negative case: the target player declines, so there is no copy and only they discard', () => {
    const controllers: PlayerId[] = [];
    const s = settle(cast(start()), { targets: (_p, prompt) => (prompt.includes('copy') ? [] : [{ kind: 'player', id: 'p2' }]), yes: () => false, onCopy: (c) => controllers.push(c) });
    expect(controllers).toEqual([]);
    expect(graveyardOf(s, 'p1')).toEqual(['Test Ash Chain']);
    expect(graveyardOf(s, 'p2')).toEqual(['Test Pebble']);
  });
});

describe('CR 608.2h, 707.10c: "Then that permanent\'s controller may sacrifice a land of their choice. If the player does, they may copy this spell ..."', () => {
  const VAPOR = card('Test Mist Chain', 'Instant', "Return target nonland permanent to its owner's hand. Then that permanent's controller may sacrifice a land of their choice. If the player does, they may copy this spell and may choose a new target for that copy.");
  const ROCK = card('Test Pebble', 'Artifact', '');
  const DEFS = [VAPOR, ROCK];
  const start = (): GameState => scenario([], { p1: { hand: ['Test Mist Chain'], battlefield: ['Test Pebble'] }, p2: { battlefield: ['Test Pebble', 'Plains'] }, defs: DEFS });
  it('is parsed and automated: "they" is the controller of the target who chose to sacrifice', () => {
    expect(automated(VAPOR)).toBe(true);
    expect(JSON.stringify(VAPOR.faces[0]!.abilities)).toContain('"then":[{"op":"may","who":{"ref":"controllerOf","object":{"ref":"target","id":"t0"}},"do":[{"op":"copy"');
  });
  it('the returned permanent\'s controller (as it last existed) sacrifices a land and copies the spell, retargeting it at the caster\'s permanent', () => {
    let s = start();
    const theirs = find(s, 'Test Pebble', 'battlefield', 'p2');
    const mine = find(s, 'Test Pebble', 'battlefield', 'p1');
    const controllers: PlayerId[] = [];
    s = act(s, { type: 'cast', player: 'p1', card: find(s, 'Test Mist Chain', 'hand', 'p1') });
    s = settle(s, {
      targets: (p, prompt) => (prompt.includes('copy') ? (p === 'p2' ? [{ kind: 'object', id: mine }] : []) : [{ kind: 'object', id: theirs }]),
      yes: (p) => p === 'p2',
      onCopy: (c) => controllers.push(c),
    });
    expect(new Set(controllers)).toEqual(new Set(['p2']));
    expect(s.zones.hand['p2']!.map((id) => s.objects[id]!.defId)).toContain('Test Pebble');
    expect(s.zones.hand['p1']!.map((id) => s.objects[id]!.defId)).toContain('Test Pebble');
    expect(graveyardOf(s, 'p2')).toContain('Plains');
  });
});

describe('CR 707.10, 702.34a: "If this spell was cast from a graveyard, you may copy this spell and may choose a new target for the copy."', () => {
  const RECLAIM = card('Test Second Dawn', 'Sorcery', 'Target player gains 2 life. If this spell was cast from a graveyard, you may copy this spell and may choose a new target for the copy.\nFlashback {0}');
  const DEFS = [RECLAIM];
  it('is parsed and automated', () => expect(automated(RECLAIM)).toBe(true));
  it('cast with flashback from the graveyard: one copy, which is not cast and so does not copy itself again', () => {
    let s = scenario([], { p1: { graveyard: ['Test Second Dawn'] }, defs: DEFS });
    const controllers: PlayerId[] = [];
    s = act(s, { type: 'cast', player: 'p1', card: find(s, 'Test Second Dawn', 'graveyard', 'p1'), method: 'flashback' });
    s = settle(s, { targets: () => [{ kind: 'player', id: 'p1' }], yes: () => true, onCopy: (c) => controllers.push(c) });
    expect(s.players.find((p) => p.id === 'p1')!.life).toBe(24);
    expect(new Set(controllers)).toEqual(new Set(['p1']));
  });
  it('the negative case: cast from the hand, no copy', () => {
    let s = scenario([], { p1: { hand: ['Test Second Dawn'] }, defs: DEFS });
    s = act(s, { type: 'cast', player: 'p1', card: find(s, 'Test Second Dawn', 'hand', 'p1') });
    s = settle(s, { targets: () => [{ kind: 'player', id: 'p1' }], yes: () => true });
    expect(s.players.find((p) => p.id === 'p1')!.life).toBe(22);
  });
});
