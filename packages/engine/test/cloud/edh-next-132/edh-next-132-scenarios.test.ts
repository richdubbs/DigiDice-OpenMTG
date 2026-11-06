/**
 * edh-next-132 (must-finish round, group copies): the round's readings and engine pieces played through the engine with synthetic cards (invented names and
 * wordings, design 6.10), compiled by the game's default compiler. CR cites checked against MagicCompRules 20260925 unless the record lists them as unverified.
 */
import { describe, expect, it } from 'vitest';
import { compileCard, type CardDef, type GameState, type OracleCard, type PlayerId } from '../../../src/index';
import { act, advanceTo, answer, find, legal, pass, scenario } from '../../m3/scenario';
import { getChars } from '../../../src/rules/characteristics';
import { passUntil } from '../../m12/rules/helpers';

function card(name: string, type: string, text: string, pt?: [string, string], cost = '{0}'): CardDef {
  return compileCard({ name, layout: 'normal', mana_cost: cost, type_line: type, oracle_text: text, colors: [], keywords: [], ...(pt ? { power: pt[0], toughness: pt[1] } : {}) } as OracleCard);
}
/** The card is parsed and automated without a manual unit. */
const automated = (d: CardDef): boolean => !JSON.stringify(d.faces).includes('"op":"manual"') && d.faces.every((f) => f.abilities.every((a) => a.kind !== 'manual'));

type Policy = {
  yes?: (player: PlayerId, prompt: string) => boolean;
  targets?: (player: PlayerId, prompt: string, s: GameState) => { kind: 'player'; id: PlayerId }[] | { kind: 'object'; id: string }[];
  pick?: (player: PlayerId, prompt: string, options: string[], s: GameState) => string[];
  option?: (player: PlayerId, prompt: string, options: { id: string; label: string }[]) => string[];
  onCopy?: (controller: PlayerId) => void;
  x?: number;
};
/** Pass priority and answer decisions by `policy` until the stack is empty and p1 has priority again. */
function settle(s0: GameState, policy: Policy = {}): GameState {
  let s = s0;
  for (let guard = 0; guard < 400 && s.pending && !(s.pending.kind === 'priority' && s.zones.stack.length === 0 && s.pending.player === 'p1'); guard++) {
    const d = s.pending;
    const top = s.zones.stack.at(-1);
    if (top !== undefined && s.objects[top]?.kind === 'spellCopy') policy.onCopy?.(s.objects[top]!.controller);
    if (d.kind === 'chooseTargets') s = answer(s, { kind: 'chooseTargets', targets: policy.targets?.(d.player, d.prompt, s) ?? [] });
    else if (d.kind === 'payCost') s = answer(s, { kind: 'payCost', auto: true });
    else if (d.kind === 'yesNo') s = answer(s, { kind: 'yesNo', yes: policy.yes?.(d.player, d.prompt) ?? false });
    else if (d.kind === 'order') s = answer(s, { kind: 'order', ids: d.items.map((i) => i.id) });
    else if (d.kind === 'chooseObjects') s = answer(s, { kind: 'chooseObjects', ids: policy.pick?.(d.player, d.prompt, d.options, s) ?? d.options.slice(0, d.min) });
    else if (d.kind === 'chooseOption') s = answer(s, { kind: 'chooseOption', ids: policy.option?.(d.player, d.prompt, d.options) ?? d.options.slice(0, d.min).map((o) => o.id) });
    else if (d.kind === 'chooseNumber') s = answer(s, { kind: 'chooseNumber', n: policy.x ?? d.min });
    else if (d.kind === 'priority') s = pass(s);
    else throw new Error(`unexpected decision ${d.kind}: ${d.prompt}`);
  }
  return s;
}
const life = (s: GameState, p: PlayerId): number => s.players.find((x) => x.id === p)!.life;
const names = (s: GameState, ids: readonly string[]): string[] => ids.map((id) => s.objects[id]!.defId);

describe('CR 115.1, 109.4, 608.2h, 707.10c: "Then that player or that permanent\'s controller may pay {R}{R}. If the player does, they may copy this spell ..."', () => {
  const ZAP = card('Test Spark Relay', 'Sorcery', "Test Spark Relay deals 3 damage to any target. Then that player or that permanent's controller may pay {R}{R}. If the player does, they may copy this spell and may choose a new target for that copy.");
  const BEAR = card('Test Ember Cub', 'Creature — Bear', '', ['2', '4']);
  const DEFS = [ZAP, BEAR];
  const start = (): GameState => scenario(['Mountain'], { p1: { hand: ['Test Spark Relay'] }, p2: { battlefield: ['Mountain', 'Mountain', 'Test Ember Cub'] }, defs: DEFS });
  const cast = (s: GameState): GameState => act(s, { type: 'cast', player: 'p1', card: find(s, 'Test Spark Relay', 'hand', 'p1') });
  it('is parsed and automated: the payment and the copy are the target player\'s, or the target permanent\'s controller\'s (`orPlayer`)', () => {
    expect(automated(ZAP)).toBe(true);
    const json = JSON.stringify(ZAP.faces[0]!.abilities);
    expect(json).toContain('{"op":"pay","who":{"ref":"controllerOf","object":{"ref":"target","id":"t0"},"orPlayer":true},"cost":{"mana":[{"kind":"colored","color":"R"},{"kind":"colored","color":"R"}]}');
    expect(json).toContain('"who":{"ref":"controllerOf","object":{"ref":"target","id":"t0"},"orPlayer":true},"newTargets":"may"');
  });
  it('a player target pays {R}{R} and copies it at the caster: both lose 3 life, the copy is theirs', () => {
    const controllers: PlayerId[] = [];
    const s = settle(cast(start()), {
      targets: (p, prompt) => (p === 'p2' ? [{ kind: 'player', id: 'p1' }] : prompt.includes('copy') ? [] : [{ kind: 'player', id: 'p2' }]),
      yes: (p) => p === 'p2',
      onCopy: (c) => controllers.push(c),
    });
    expect(life(s, 'p2')).toBe(17);
    expect(life(s, 'p1')).toBe(17);
    expect(new Set(controllers)).toEqual(new Set(['p2']));
  });
  it('a creature target: its controller (not the caster) is the one who may pay; declining, there is no copy', () => {
    const controllers: PlayerId[] = [];
    let s = start();
    const cub = find(s, 'Test Ember Cub', 'battlefield', 'p2');
    const asked: PlayerId[] = [];
    s = settle(cast(s), { targets: (p) => (p === 'p1' ? [{ kind: 'object', id: cub }] : []), yes: (p) => { asked.push(p); return false; }, onCopy: (c) => controllers.push(c) });
    expect(asked).toContain('p2');
    expect(asked).not.toContain('p1');
    expect(controllers).toEqual([]);
    expect(s.objects[cub]!.damage).toBe(3);
    expect(life(s, 'p1')).toBe(20);
  });
});

describe('CR 603.4, 115.9b, 707.2: "Whenever you cast an instant or sorcery spell, if it targets one or more other permanents you control, create a token that\'s a copy of one of those permanents."', () => {
  const SHIFTER = card('Test Many-Shaped', 'Creature — Shapeshifter', "Whenever you cast an instant or sorcery spell, if it targets one or more other permanents you control, create a token that's a copy of one of those permanents.", ['3', '3']);
  const PUMP = card('Test Quick Ward', 'Instant', 'Target creature gets +1/+1 until end of turn.');
  const TWIN = card('Test Twin Ward', 'Instant', 'Up to two target creatures each get +1/+1 until end of turn.');
  const BEAR = card('Test Ember Cub', 'Creature — Bear', '', ['2', '4']);
  const ELK = card('Test Moss Elk', 'Creature — Elk', '', ['3', '1']);
  const DEFS = [SHIFTER, PUMP, TWIN, BEAR, ELK];
  const start = (): GameState => scenario([], { p1: { hand: ['Test Quick Ward', 'Test Twin Ward'], battlefield: ['Test Many-Shaped', 'Test Ember Cub', 'Test Moss Elk'] }, p2: { battlefield: ['Test Ember Cub'] }, defs: DEFS });
  const tokens = (s: GameState, p: PlayerId): string[] => s.zones.battlefield.filter((id) => s.objects[id]!.kind === 'token' && s.objects[id]!.controller === p).map((id) => getChars(s, id).name);
  it('is parsed and automated: an intervening "if" that the cast spell targets such a permanent, then a choice among those it targets', () => {
    expect(automated(SHIFTER)).toBe(true);
    const json = JSON.stringify(SHIFTER.faces[0]!.abilities);
    expect(json).toContain('"interveningIf":{"cond":"matches","object":{"ref":"event","role":"spell"},"filter":{"targets":{"ref":"each","filter":{"other":true,"controller":"you"}}}}');
    expect(json).toContain('"from":{"ref":"each","filter":{"is":{"ref":"each","filter":{"other":true,"controller":"you","targetedBy":{"ref":"event","role":"spell"}}}}}');
  });
  it('a spell targeting a creature you control: a token copy of that creature', () => {
    let s = start();
    const cub = find(s, 'Test Ember Cub', 'battlefield', 'p1');
    s = act(s, { type: 'cast', player: 'p1', card: find(s, 'Test Quick Ward', 'hand', 'p1') });
    s = settle(s, { targets: () => [{ kind: 'object', id: cub }] });
    expect(tokens(s, 'p1')).toEqual(['Test Ember Cub']);
  });
  it('two of your creatures targeted: you choose which one is copied as the ability resolves (one token only)', () => {
    let s = start();
    const cub = find(s, 'Test Ember Cub', 'battlefield', 'p1');
    const elk = find(s, 'Test Moss Elk', 'battlefield', 'p1');
    s = act(s, { type: 'cast', player: 'p1', card: find(s, 'Test Twin Ward', 'hand', 'p1') });
    s = settle(s, { targets: () => [{ kind: 'object', id: cub }, { kind: 'object', id: elk }], pick: (_p, _prompt, options) => options.filter((o) => o === elk) });
    expect(tokens(s, 'p1')).toEqual(['Test Moss Elk']);
  });
  it('the negative cases: a spell targeting an opponent\'s creature, or the shapeshifter itself (not "other"), makes no token', () => {
    let s = start();
    const theirs = find(s, 'Test Ember Cub', 'battlefield', 'p2');
    s = act(s, { type: 'cast', player: 'p1', card: find(s, 'Test Quick Ward', 'hand', 'p1') });
    s = settle(s, { targets: () => [{ kind: 'object', id: theirs }] });
    expect(tokens(s, 'p1')).toEqual([]);
    const self = find(s, 'Test Many-Shaped', 'battlefield', 'p1');
    s = act(s, { type: 'cast', player: 'p1', card: find(s, 'Test Twin Ward', 'hand', 'p1') });
    s = settle(s, { targets: () => [{ kind: 'object', id: self }] });
    expect(tokens(s, 'p1')).toEqual([]);
  });
});

describe('CR 701.9a, 113.6k, 603.2: "When a spell or ability an opponent controls causes you to discard this card, create a token that\'s a copy of target permanent."', () => {
  const SHIFTER = card('Test Many-Shaped', 'Creature — Shapeshifter', "When a spell or ability an opponent controls causes you to discard this card, create a token that's a copy of target permanent.", ['3', '3']);
  const PRICK = card('Test Mind Prick', 'Instant', 'Target player discards a card.');
  const BEAR = card('Test Ember Cub', 'Creature — Bear', '', ['2', '4']);
  const DEFS = [SHIFTER, PRICK, BEAR];
  const tokens = (s: GameState, p: PlayerId): string[] => s.zones.battlefield.filter((id) => s.objects[id]!.kind === 'token' && s.objects[id]!.controller === p).map((id) => getChars(s, id).name);
  it('is parsed and automated: the discard action of the card itself by you, caused by an opponent\'s spell or ability (`by`), functioning where the card went', () => {
    expect(automated(SHIFTER)).toBe(true);
    const json = JSON.stringify(SHIFTER.faces[0]!.abilities);
    expect(json).toContain('{"ev":"action","verb":"discard","actor":"you","object":{"self":true},"by":"opponent"}');
    expect(json).toContain('"zone":["graveyard","exile"]');
  });
  it('an opponent\'s spell makes you discard it: it triggers from the graveyard and copies the permanent you target', () => {
    let s = scenario([], { p1: { hand: ['Test Many-Shaped'] }, p2: { hand: ['Test Mind Prick'], battlefield: ['Test Ember Cub'] }, defs: DEFS });
    const cub = find(s, 'Test Ember Cub', 'battlefield', 'p2');
    s = pass(s);
    s = act(s, { type: 'cast', player: 'p2', card: find(s, 'Test Mind Prick', 'hand', 'p2') });
    s = settle(s, { targets: (p) => (p === 'p2' ? [{ kind: 'player', id: 'p1' }] : [{ kind: 'object', id: cub }]) });
    expect(names(s, s.zones.graveyard['p1']!)).toContain('Test Many-Shaped');
    expect(tokens(s, 'p1')).toEqual(['Test Ember Cub']);
  });
  it('the negative case: your own spell makes you discard it, so it does not trigger', () => {
    let s = scenario([], { p1: { hand: ['Test Many-Shaped', 'Test Mind Prick'], battlefield: ['Test Ember Cub'] }, defs: DEFS });
    s = act(s, { type: 'cast', player: 'p1', card: find(s, 'Test Mind Prick', 'hand', 'p1') });
    s = settle(s, { targets: () => [{ kind: 'player', id: 'p1' }] });
    expect(names(s, s.zones.graveyard['p1']!)).toContain('Test Many-Shaped');
    expect(tokens(s, 'p1')).toEqual([]);
  });
});

describe('CR 603.12a, 603.3d, 707.9b, 205.1a: "Exile each opponent\'s graveyard. When you do, choose up to one target creature card exiled this way. Create a token that\'s a copy of that card, except it\'s an artifact and it loses all other card types."', () => {
  const MAGIC = card('Test Stone Memory', 'Instant', "Exile each opponent's graveyard. When you do, choose up to one target creature card exiled this way. Create a token that's a copy of that card, except it's an artifact and it loses all other card types.");
  const DRAKE = card('Test Ash Drake', 'Creature — Drake', 'Flying', ['3', '2']);
  const DEFS = [MAGIC, DRAKE];
  const tokens = (s: GameState, p: PlayerId): string[] => s.zones.battlefield.filter((id) => s.objects[id]!.kind === 'token' && s.objects[id]!.controller === p);
  it('is parsed and automated: the reflexive trigger announces its target among the cards the exile moved, and copies it with the card type set to artifact', () => {
    expect(automated(MAGIC)).toBe(true);
    const json = JSON.stringify(MAGIC.faces[0]!.abilities);
    expect(json).toContain('{"op":"reflexive","when":{"did":"them"},"targets":[{"id":"t0","kind":"object","min":0,"max":1');
    expect(json).toContain('"is":{"ref":"bound","name":"them"}');
    expect(json).toContain('"except":[{"layer":4,"types":{"set":["Artifact"]}}]');
  });
  it('the opponent\'s creature card is exiled with the rest, then targeted: the token is a noncreature artifact named like it, with its abilities, and your own graveyard stays', () => {
    let s = scenario([], { p1: { hand: ['Test Stone Memory'], graveyard: ['Test Ash Drake'] }, p2: { graveyard: ['Test Ash Drake', 'Plains'] }, defs: DEFS });
    const drake = find(s, 'Test Ash Drake', 'graveyard', 'p2');
    s = act(s, { type: 'cast', player: 'p1', card: find(s, 'Test Stone Memory', 'hand', 'p1') });
    s = settle(s, { targets: (_p, _prompt, st) => st.zones.exile.filter((id) => st.objects[id]!.defId === 'Test Ash Drake').map((id) => ({ kind: 'object' as const, id })) });
    expect(s.zones.graveyard['p2']!.length).toBe(0);
    expect(names(s, s.zones.graveyard['p1']!)).toContain('Test Ash Drake');
    expect(s.objects[drake]).toBeUndefined(); // the card moved: a new object in exile (CR 400.7)
    const toks = tokens(s, 'p1');
    expect(toks.length).toBe(1);
    const ch = getChars(s, toks[0]!);
    expect(ch.name).toBe('Test Ash Drake');
    expect(ch.types).toEqual(['Artifact']);
    expect(ch.subtypes).toEqual([]);
    expect(JSON.stringify(ch.abilities ?? []).toLowerCase()).toContain('flying');
  });
  it('the negative cases: "up to one" chooses none, so no token; and the caster\'s own graveyard card is no legal target (it was not exiled this way)', () => {
    let s = scenario([], { p1: { hand: ['Test Stone Memory'], graveyard: ['Test Ash Drake'] }, p2: { graveyard: ['Test Ash Drake'] }, defs: DEFS });
    s = act(s, { type: 'cast', player: 'p1', card: find(s, 'Test Stone Memory', 'hand', 'p1') });
    s = settle(s, { targets: () => [] });
    expect(tokens(s, 'p1').length).toBe(0);
    let t = scenario([], { p1: { hand: ['Test Stone Memory'], graveyard: ['Test Ash Drake'] }, p2: { graveyard: ['Plains'] }, defs: DEFS });
    const mine = find(t, 'Test Ash Drake', 'graveyard', 'p1');
    t = act(t, { type: 'cast', player: 'p1', card: find(t, 'Test Stone Memory', 'hand', 'p1') });
    let offered: string[] = [];
    t = settle(t, { targets: (_p, _prompt, st) => { offered = st.pending?.kind === 'chooseTargets' ? JSON.stringify(st.pending).match(/o\d+/g) ?? [] : []; return []; } });
    expect(offered).not.toContain(mine);
    expect(tokens(t, 'p1').length).toBe(0);
  });
});

describe('CR 107.3, 608.2c, 707.2, 701.8a: "Destroy up to X target artifacts. If X is 5 or more, for each artifact destroyed this way, create a token that\'s a copy of it. Those tokens gain haste. Exile them at the beginning of the next end step."', () => {
  const DUSK = card('Test Ember Dusk', 'Sorcery', "Destroy up to X target artifacts. If X is 5 or more, for each artifact destroyed this way, create a token that's a copy of it. Those tokens gain haste. Exile them at the beginning of the next end step.", undefined, '{X}');
  const COG = card('Test Brass Cog', 'Artifact Creature — Construct', '', ['1', '1']);
  const WALL = card('Test Iron Bulwark', 'Artifact', 'Indestructible');
  const DEFS = [DUSK, COG, WALL];
  const tokens = (s: GameState): string[] => s.zones.battlefield.filter((id) => s.objects[id]!.kind === 'token' && s.objects[id]!.controller === 'p1');
  const start = (): GameState => scenario(['Mountain'], { p1: { hand: ['Test Ember Dusk'], battlefield: ['Mountain', 'Mountain', 'Mountain', 'Mountain', 'Mountain', 'Mountain'] }, p2: { battlefield: ['Test Brass Cog', 'Test Brass Cog', 'Test Brass Cog', 'Test Brass Cog', 'Test Iron Bulwark'] }, defs: DEFS });
  const arts = (s: GameState): { kind: 'object'; id: string }[] => s.zones.battlefield.filter((id) => s.objects[id]!.controller === 'p2' && (s.objects[id]!.defId === 'Test Brass Cog' || s.objects[id]!.defId === 'Test Iron Bulwark')).map((id) => ({ kind: 'object' as const, id }));
  it('is parsed and automated: the copies are one per artifact the destroy bound, only when X is 5 or more; haste and the end-step exile are for those tokens', () => {
    expect(automated(DUSK)).toBe(true);
    const json = JSON.stringify(DUSK.faces[0]!.abilities);
    expect(json).toContain('{"op":"if","cond":{"cond":"compare","left":{"q":"X"},"op":">=","right":5},"then":[{"op":"forEach","over":{"ref":"bound","name":"destroy"}');
  });
  it('X = 5: four artifacts are destroyed (the indestructible one is not), so four hasty token copies, exiled at the next end step', () => {
    let s = start();
    s = act(s, { type: 'cast', player: 'p1', card: find(s, 'Test Ember Dusk', 'hand', 'p1') });
    s = settle(s, { x: 5, targets: (_p, _prompt, st) => arts(st) });
    const toks = tokens(s);
    expect(toks.length).toBe(4);
    expect(toks.every((id) => getChars(s, id).name === 'Test Brass Cog')).toBe(true);
    expect(toks.every((id) => JSON.stringify(getChars(s, id).abilities ?? []).includes('haste'))).toBe(true);
    expect(names(s, s.zones.graveyard['p2']!).filter((n) => n === 'Test Brass Cog').length).toBe(4);
    // the delayed trigger (CR 603.7): at the beginning of the next end step the four tokens are exiled (a token in exile ceases to exist, CR 704.5d)
    s = settle(advanceTo(s, s.turn.number, 'end'));
    expect(tokens(s).length).toBe(0);
    expect(toks.every((id) => !s.zones.battlefield.includes(id))).toBe(true);
  });
  it('the negative case: X = 4 destroys four artifacts and makes no token', () => {
    let s = start();
    s = act(s, { type: 'cast', player: 'p1', card: find(s, 'Test Ember Dusk', 'hand', 'p1') });
    s = settle(s, { x: 4, targets: (_p, _prompt, st) => arts(st).filter((t) => st.objects[t.id]!.defId === 'Test Brass Cog') });
    expect(tokens(s).length).toBe(0);
    expect(names(s, s.zones.graveyard['p2']!).filter((n) => n === 'Test Brass Cog').length).toBe(4);
  });
});

describe('CR 201.2, 608.2d, 707.2, 111.4: "Choose any number of artifact tokens and/or creature tokens you control with different names. For each of them, create a token that\'s a copy of it."', () => {
  const MUSTER = card('Test Muster Call', 'Sorcery', 'Create two 1/1 white Human Warrior creature tokens, a 1/1 green Elf Warrior creature token, and a Treasure token.');
  const ECHO = card('Test Shield Echo', 'Sorcery', "Choose any number of artifact tokens and/or creature tokens you control with different names. For each of them, create a token that's a copy of it.");
  const BEAR = card('Test Ember Cub', 'Creature — Bear', '', ['2', '4']);
  const DEFS = [MUSTER, ECHO, BEAR];
  const count = (s: GameState, name: string, p: PlayerId = 'p1'): number => s.zones.battlefield.filter((id) => s.objects[id]!.kind === 'token' && s.objects[id]!.controller === p && getChars(s, id).name === name).length;
  it('is parsed and automated: one choice at a time of tokens with names not yet taken, then a token copy of each', () => {
    expect(automated(ECHO)).toBe(true);
    const json = JSON.stringify(ECHO.faces[0]!.abilities);
    expect(json).toContain('"anyOf":[{"types":["Artifact"],"token":true},{"types":["Creature"],"token":true}],"controller":"you","token":true');
    expect(json).toContain('"distinct":"name"');
  });
  it('two Human Warrior tokens share a name, so only one of them is copied; the Elf Warrior and the Treasure are copied too (ruling 2021-02-05: the token names differ by creature types); the nontoken creature is never offered', () => {
    let s = scenario([], { p1: { hand: ['Test Muster Call', 'Test Shield Echo'], battlefield: ['Test Ember Cub'] }, defs: DEFS });
    s = act(s, { type: 'cast', player: 'p1', card: find(s, 'Test Muster Call', 'hand', 'p1') });
    s = settle(s);
    expect(count(s, 'Human Warrior Token')).toBe(2);
    const cub = find(s, 'Test Ember Cub', 'battlefield', 'p1');
    const offered = new Set<string>();
    s = act(s, { type: 'cast', player: 'p1', card: find(s, 'Test Shield Echo', 'hand', 'p1') });
    s = settle(s, { pick: (_p, _prompt, options) => { options.forEach((o) => offered.add(o)); return options.slice(0, 1); } });
    expect(offered.has(cub)).toBe(false);
    expect(count(s, 'Human Warrior Token')).toBe(3);
    expect(count(s, 'Elf Warrior Token')).toBe(2);
    expect(s.zones.battlefield.filter((id) => s.objects[id]!.kind === 'token' && getChars(s, id).subtypes.includes('Treasure')).length).toBe(2);
  });
  it('the negative case: choosing none copies nothing', () => {
    let s = scenario([], { p1: { hand: ['Test Muster Call', 'Test Shield Echo'] }, defs: DEFS });
    s = act(s, { type: 'cast', player: 'p1', card: find(s, 'Test Muster Call', 'hand', 'p1') });
    s = settle(s);
    s = act(s, { type: 'cast', player: 'p1', card: find(s, 'Test Shield Echo', 'hand', 'p1') });
    s = settle(s, { pick: () => [] });
    expect(count(s, 'Human Warrior Token')).toBe(2);
    expect(count(s, 'Elf Warrior Token')).toBe(1);
  });
});

describe('CR 122.2, 508.4, 707.2, 608.2c: "Whenever this creature attacks, exile up to one target Assassin creature card from your graveyard with a memory counter on it. Then for each creature card you own in exile with a memory counter on it, create a tapped and attacking token that\'s a copy of it. Exile those tokens at end of combat."', () => {
  const EAGLE = card('Test Hooded Eagle', 'Legendary Creature — Human Assassin', "First strike\nWhenever this creature attacks, exile up to one target Assassin creature card from your graveyard with a memory counter on it. Then for each creature card you own in exile with a memory counter on it, create a tapped and attacking token that's a copy of it. Exile those tokens at end of combat.", ['3', '3']);
  const BLADE = card('Test Quiet Blade', 'Creature — Human Assassin', '', ['2', '1']);
  const MONK = card('Test Ash Monk', 'Creature — Human Monk', '', ['1', '3']);
  const DEFS = [EAGLE, BLADE, MONK];
  const tokens = (s: GameState): string[] => s.zones.battlefield.filter((id) => s.objects[id]!.kind === 'token' && s.objects[id]!.controller === 'p1');
  const attack = (s0: GameState): GameState => {
    const eagle = find(s0, 'Test Hooded Eagle', 'battlefield', 'p1');
    let s = passUntil(s0, (x) => x.pending?.kind === 'declareAttackers', 'the declaration of attackers');
    s = answer(s, { kind: 'declareAttackers', attacks: [{ attacker: eagle, defender: 'p2' }] });
    return s;
  };
  it('is parsed and automated: the exile puts a memory counter on the card (not a filter of the graveyard), the copies are of each such card you own in exile, tapped and attacking', () => {
    expect(automated(EAGLE)).toBe(true);
    const json = JSON.stringify(EAGLE.faces[0]!.abilities);
    expect(json).toContain('"to":{"zone":"exile","counters":[{"kind":"memory","count":1}]}');
    expect(json).toContain('"over":{"ref":"each","filter":{"types":["Creature"],"owner":"you","zone":"exile","counters":{"kind":"memory"},"isCard":true}}');
    expect(json).toContain('"tapped":true,"attacking":true');
  });
  it('the Assassin card from the graveyard and a creature card already exiled with a memory counter are copied, attacking; a card without the counter and an opponent\'s card are not; the tokens are exiled at end of combat', () => {
    let s = scenario([], { p1: { battlefield: ['Test Hooded Eagle'], graveyard: ['Test Quiet Blade', 'Test Ash Monk'], exile: [{ name: 'Test Ash Monk', counters: { memory: 1 } }, 'Test Quiet Blade'] }, p2: { exile: [{ name: 'Test Quiet Blade', counters: { memory: 1 } }] }, defs: DEFS });
    const blade = find(s, 'Test Quiet Blade', 'graveyard', 'p1');
    s = attack(s);
    s = settle(s, { targets: () => [{ kind: 'object', id: blade }] });
    const toks = tokens(s);
    expect(toks.map((id) => getChars(s, id).name).sort()).toEqual(['Test Ash Monk', 'Test Quiet Blade']);
    expect(toks.every((id) => s.objects[id]!.tapped)).toBe(true);
    expect(toks.every((id) => s.combat?.attackers.some((a) => a.id === id) === true)).toBe(true);
    expect(names(s, s.zones.graveyard['p1']!)).toEqual(['Test Ash Monk']); // the Monk is no Assassin: not a legal target
    s = passUntil(s, (x) => x.turn.step === 'main2', 'the second main phase');
    expect(tokens(s).length).toBe(0);
  });
  it('the negative case: no target and no card with a memory counter in exile, no token', () => {
    let s = scenario([], { p1: { battlefield: ['Test Hooded Eagle'], exile: ['Test Quiet Blade'] }, defs: DEFS });
    s = attack(s);
    s = settle(s, { targets: () => [] });
    expect(tokens(s).length).toBe(0);
  });
});

describe('CR 701.17a, 608.2c, 707.2, 707.9b, 400.7: "At the beginning of your upkeep, each player mills three cards. You may exile a creature card from among the cards milled this way. If you do, this creature becomes a copy of that card, except it has this ability."', () => {
  const KIN = card('Test Umbral Kin', 'Creature — Shapeshifter', 'At the beginning of your upkeep, each player mills three cards. You may exile a creature card from among the cards milled this way. If you do, this creature becomes a copy of that card, except it has this ability.', ['3', '3']);
  const OGRE = card('Test Hill Ogre', 'Creature — Ogre', 'Trample', ['5', '4']);
  const ELK = card('Test Moss Elk', 'Creature — Elk', '', ['3', '1']);
  const DEFS = [KIN, OGRE, ELK];
  const start = (): GameState => scenario([], { p1: { battlefield: ['Test Umbral Kin'], library: ['Test Moss Elk'] }, p2: { library: ['Plains', 'Test Hill Ogre'] }, defs: DEFS });
  it('is parsed and automated: every player mills, your choice among all the milled cards, the exile, then the copy with this ability kept', () => {
    expect(automated(KIN)).toBe(true);
    const json = JSON.stringify(KIN.faces[0]!.abilities);
    expect(json).toContain('{"op":"mill","who":{"ref":"each","who":"player"},"count":3,"as":"them"}');
    expect(json).toContain('"copyOf":{"ref":"bound","name":"chosen"},"except":[{"thisAbility":true}]');
  });
  it('an opponent\'s milled creature card is exiled and the shapeshifter becomes a copy of it, still with the upkeep ability', () => {
    let s = start();
    const kin = find(s, 'Test Umbral Kin', 'battlefield', 'p1');
    s = advanceTo(s, 3, 'upkeep');
    s = settle(s, { pick: (_p, _prompt, options, st) => options.filter((o) => st.objects[o]?.defId === 'Test Hill Ogre') });
    expect(names(s, s.zones.exile)).toEqual(['Test Hill Ogre']);
    const ch = getChars(s, kin);
    expect(ch.name).toBe('Test Hill Ogre');
    expect(ch.power).toBe('5');
    expect(JSON.stringify(ch.abilities ?? []).toLowerCase()).toContain('trample');
    expect(JSON.stringify(ch.abilities ?? [])).toContain('"op":"mill"');
    expect(names(s, s.zones.graveyard['p1']!)).toContain('Test Moss Elk');
  });
  it('the negative case: declining the exile, nothing is exiled and the shapeshifter stays itself', () => {
    let s = start();
    const kin = find(s, 'Test Umbral Kin', 'battlefield', 'p1');
    s = advanceTo(s, 3, 'upkeep');
    s = settle(s, { pick: () => [] });
    expect(s.zones.exile.length).toBe(0);
    expect(getChars(s, kin).name).toBe('Test Umbral Kin');
  });
});

describe('CR 107.3c, 607.2a, 602.2b, 707.2: "When this artifact enters, you may exile an artifact card from your hand. {X}, {T}: Create a token that\'s a copy of the exiled card. X is the mana value of that card."', () => {
  const GATE = card('Test Pattern Gate', 'Artifact', "Imprint — When this artifact enters, you may exile an artifact card from your hand.\n{X}, {T}: Create a token that's a copy of the exiled card. X is the mana value of that card.");
  const COG = card('Test Brass Cog', 'Artifact Creature — Construct', '', ['1', '1'], '{2}');
  const DEFS = [GATE, COG];
  const start = (lands: number): GameState => scenario(['Mountain'], { p1: { hand: ['Test Pattern Gate', 'Test Brass Cog'], battlefield: Array.from({ length: lands }, () => 'Mountain') }, defs: DEFS });
  const enter = (s0: GameState, exile: boolean): GameState => settle(act(s0, { type: 'cast', player: 'p1', card: find(s0, 'Test Pattern Gate', 'hand', 'p1') }), { yes: () => exile });
  const activations = (s: GameState): number => legal(s, 'p1', 'activate').filter((a) => JSON.stringify(a).includes('p:0:1')).length;
  it('is parsed and automated: the imprint exile is linked, the activated ability\'s X is defined by the text (`xIs`), no X announced', () => {
    expect(automated(GATE)).toBe(true);
    const json = JSON.stringify(GATE.faces[0]!.abilities);
    expect(json).toContain('"to":{"zone":"exile"},"link":"exiled"');
    expect(json).toContain('"xIs":{"q":"stat","stat":"manaValue","of":{"ref":"linked","link":"exiled"}}');
  });
  it('with the 2-mana artifact exiled, X is 2: two lands pay it with no choice of X, and the token copies the exiled card', () => {
    let s = enter(start(2), true);
    expect(names(s, s.zones.exile)).toEqual(['Test Brass Cog']);
    expect(activations(s)).toBe(1);
    const gate = find(s, 'Test Pattern Gate', 'battlefield', 'p1');
    let numbers = 0;
    s = act(s, { type: 'activate', player: 'p1', source: gate, ability: 'p:0:1' });
    for (let g = 0; g < 50 && s.pending?.kind !== 'priority'; g++) {
      if (s.pending?.kind === 'chooseNumber') numbers++;
      s = s.pending?.kind === 'payCost' ? answer(s, { kind: 'payCost', auto: true }) : answer(s, { kind: 'chooseNumber', n: s.pending?.kind === 'chooseNumber' ? s.pending.min : 0 });
    }
    s = settle(s);
    expect(numbers).toBe(0);
    const toks = s.zones.battlefield.filter((id) => s.objects[id]!.kind === 'token');
    expect(toks.map((id) => getChars(s, id).name)).toEqual(['Test Brass Cog']);
  });
  it('the negative cases: with one land X = 2 can\'t be paid; with no card exiled X is undefined and the ability is not offered (ruling 2011-01-01)', () => {
    const poor = enter(start(1), true);
    expect(activations(poor)).toBe(0);
    const none = enter(start(3), false);
    expect(none.zones.exile.length).toBe(0);
    expect(activations(none)).toBe(0);
    expect(() => act(none, { type: 'activate', player: 'p1', source: find(none, 'Test Pattern Gate', 'battlefield', 'p1'), ability: 'p:0:1' })).toThrow();
  });
});

describe('G10 change (owner standing rule 2026-10-27), CR 607.2a: the imprint exile of a card whose later ability names "the exiled card" in its X is now linked (Elite Arcanist\'s first ability)', () => {
  const SAGE = card('Test Ink Savant', 'Creature — Human Wizard', "When this creature enters, you may exile an instant card from your hand.\n{X}, {T}: You may copy the exiled card. If you do, you may cast the copy without paying its mana cost. X is the mana value of the exiled card.", ['1', '1']);
  const BOLT = card('Test Quick Bolt', 'Instant', 'Test Quick Bolt deals 1 damage to any target.', undefined, '{R}');
  const DEFS = [SAGE, BOLT];
  const start = (): GameState => scenario(['Mountain'], { p1: { hand: ['Test Ink Savant', 'Test Quick Bolt'] }, defs: DEFS });
  const enter = (s0: GameState, exile: boolean): GameState => settle(act(s0, { type: 'cast', player: 'p1', card: find(s0, 'Test Ink Savant', 'hand', 'p1') }), { yes: () => exile });
  it('the enters trigger is automated as before and now carries the link the X reads', () => {
    const json = JSON.stringify(SAGE.faces[0]!.abilities[0]);
    expect(json).toContain('"to":{"zone":"exile"},"link":"exiled"');
    expect(SAGE.faces[0]!.abilities[0]!.kind).toBe('triggered');
  });
  it('played: accepting exiles the instant from the hand; declining leaves it in the hand', () => {
    const yes = enter(start(), true);
    expect(names(yes, yes.zones.exile)).toEqual(['Test Quick Bolt']);
    const no = enter(start(), false);
    expect(no.zones.exile.length).toBe(0);
    expect(names(no, no.zones.hand['p1']!)).toContain('Test Quick Bolt');
  });
});

describe('CR 701.55a, 701.55d, 608.2f, 613.1d-f, 707.2: "Choose up to four target creatures you don\'t control. For each of them, that creature\'s controller faces a villainous choice -- That creature becomes a 1/1 white Human creature and loses all abilities, or you create a token that\'s a copy of it."', () => {
  const HUNT = card('Test Family Hunt', 'Sorcery', "Choose up to four target creatures you don't control. For each of them, that creature's controller faces a villainous choice — That creature becomes a 1/1 white Human creature and loses all abilities, or you create a token that's a copy of it.");
  const OGRE = card('Test Hill Ogre', 'Creature — Ogre', 'Trample', ['5', '4']);
  const ELK = card('Test Moss Elk', 'Creature — Elk', '', ['3', '1']);
  const DEFS = [HUNT, OGRE, ELK];
  it('is parsed and automated: one villainous choice for each target, faced by that creature\'s controller', () => {
    expect(automated(HUNT)).toBe(true);
    const json = JSON.stringify(HUNT.faces[0]!.abilities);
    expect(json).toContain('{"op":"forEach","over":{"ref":"target","id":"t0"},"as":"each","do":[{"op":"may","who":{"ref":"controllerOf","object":{"ref":"bound","name":"each"}},"villainous":true');
    expect(json).toContain('"filter":{"types":["Creature"],"not":{"controller":"you"}}');
  });
  it('the opponent chooses for each creature: the Ogre becomes a 1/1 white Human with no abilities, and for the Elk the caster gets a token copy; the caster is never asked', () => {
    let s = scenario([], { p1: { hand: ['Test Family Hunt'] }, p2: { battlefield: ['Test Hill Ogre', 'Test Moss Elk'] }, defs: DEFS });
    const ogre = find(s, 'Test Hill Ogre', 'battlefield', 'p2');
    const elk = find(s, 'Test Moss Elk', 'battlefield', 'p2');
    const askedBy: PlayerId[] = [];
    const answerFor = (p: PlayerId, prompt: string): boolean => { askedBy.push(p); return prompt.includes('Test Hill Ogre') || !prompt.includes('Test Moss Elk') && askedBy.length === 1; };
    s = act(s, { type: 'cast', player: 'p1', card: find(s, 'Test Family Hunt', 'hand', 'p1') });
    s = settle(s, {
      targets: () => [{ kind: 'object', id: ogre }, { kind: 'object', id: elk }],
      yes: answerFor,
      option: (p, prompt, options) => { askedBy.push(p); const first = askedBy.filter((x) => x === 'p2').length === 1; return [options[first ? 0 : options.length - 1]!.id]; },
    });
    expect(new Set(askedBy)).toEqual(new Set(['p2']));
    const o = getChars(s, ogre);
    expect([o.power, o.toughness]).toEqual(['1', '1']);
    expect(o.colors).toEqual(['W']);
    expect(o.subtypes).toEqual(['Human']);
    expect(JSON.stringify(o.abilities ?? []).toLowerCase()).not.toContain('trample');
    const toks = s.zones.battlefield.filter((id) => s.objects[id]!.kind === 'token' && s.objects[id]!.controller === 'p1');
    expect(toks.map((id) => getChars(s, id).name)).toEqual(['Test Moss Elk']);
    expect(getChars(s, elk).power).toBe('3');
  });
  it('the negative case: no creature of your own may be chosen; with no target the spell does nothing', () => {
    let s = scenario([], { p1: { hand: ['Test Family Hunt'], battlefield: ['Test Moss Elk'] }, defs: DEFS });
    const mine = find(s, 'Test Moss Elk', 'battlefield', 'p1');
    let offered = '';
    s = act(s, { type: 'cast', player: 'p1', card: find(s, 'Test Family Hunt', 'hand', 'p1') });
    s = settle(s, { targets: (_p, _prompt, st) => { offered = JSON.stringify(st.pending); return []; } });
    expect(offered).not.toContain(mine);
    expect(s.zones.battlefield.filter((id) => s.objects[id]!.kind === 'token').length).toBe(0);
    expect(getChars(s, mine).power).toBe('3');
  });
});

describe('CR 701.20a, 121.1, 603.2, 707.12, 601.2f: "You may reveal the first card you draw each turn as you draw it. Whenever you reveal an instant or sorcery card this way, copy that card and you may cast the copy. That copy costs {2} less to cast."', () => {
  const GOD = card('Test Mind Sphinx', 'Legendary Creature — Zombie God', 'Flying\nYou may reveal the first card you draw each turn as you draw it. Whenever you reveal an instant or sorcery card this way, copy that card and you may cast the copy. That copy costs {2} less to cast.', ['4', '5']);
  const SPARK = card('Test Twin Spark', 'Instant', 'Test Twin Spark deals 2 damage to any target.', undefined, '{1}{R}');
  const OGRE = card('Test Hill Ogre', 'Creature — Ogre', '', ['5', '4']);
  const DEFS = [GOD, SPARK, OGRE];
  const start = (top: string): GameState => scenario(['Mountain'], { p1: { battlefield: ['Test Mind Sphinx', 'Mountain'], library: [top, 'Test Twin Spark'] }, defs: DEFS });
  it('is parsed and automated: the reveal rule of edh-next-144, optional (`optional`), and its this-way trigger, a copy created in the hand and cast for {2} less', () => {
    expect(automated(GOD)).toBe(true);
    const json = JSON.stringify(GOD.faces[0]!.abilities);
    expect(json).toContain('{"s":"rule","rule":"revealFirstDraw","optional":true}');
    expect(json).toContain('{"ev":"reveal","player":"you","card":{"types":["Instant","Sorcery"],"isCard":true},"thisWay":true}'); // edh-next-144's event
    expect(json).toContain('{"op":"cast","who":{"ref":"you"},"what":{"ref":"event","role":"subject"},"copyIn":"hand","optional":true,"costChange":{"kind":"reduce","mana":[{"kind":"generic","amount":2}]}}');
  });
  it('the first draw of the turn, an instant, is revealed: the copy is cast for {R} with one Mountain, and the card itself stays in the hand', () => {
    let s = advanceTo(start('Test Twin Spark'), 3, 'draw');
    const asked: string[] = [];
    s = settle(s, { yes: (_p, prompt) => { asked.push(prompt); return true; }, targets: () => [{ kind: 'player', id: 'p2' }] });
    expect(asked.some((x) => x.includes('reveal'))).toBe(true);
    expect(life(s, 'p2')).toBe(18);
    expect(names(s, s.zones.hand['p1']!)).toEqual(['Test Twin Spark']);
    expect(s.zones.hand['p1']!.every((id) => s.objects[id]!.kind === 'card')).toBe(true);
  });
  it('the negative cases: declining the reveal, or revealing a creature card, copies nothing; a second draw of the turn is never offered', () => {
    let s = advanceTo(start('Test Twin Spark'), 3, 'draw');
    s = settle(s, { yes: () => false });
    expect(life(s, 'p2')).toBe(20);
    let t = advanceTo(start('Test Hill Ogre'), 3, 'draw');
    const asked: string[] = [];
    t = settle(t, { yes: (_p, prompt) => { asked.push(prompt); return true; }, targets: () => [{ kind: 'player', id: 'p2' }] });
    expect(asked.filter((x) => x.includes('reveal')).length).toBe(1);
    expect(life(t, 'p2')).toBe(20);
    expect(t.zones.stack.length).toBe(0);
  });
});
