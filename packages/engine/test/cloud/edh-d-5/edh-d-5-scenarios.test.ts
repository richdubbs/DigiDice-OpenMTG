/**
 * Commander round edh-d-5 (EDHREC ranks 13,751-15,000, second pass): the round's readings played through the engine with synthetic cards (invented names, design 6.10)
 * compiled by the game's default compiler. Each test is named after the rule it checks, with its negative case. CR cites are from the Comprehensive Rules text of 2026-09-25.
 *
 *   CR 702.16b, 702.16e, 702.16j, 608.2d, 611.2a  "you gain protection from the color of your choice until end of turn" (Seht's Tiger); "You and permanents you control have protection from Salamanders" (Gor Muldrak)
 *   CR 603.10a, 303.4b, 301.5    "When ~ dies, if it was enchanted / equipped, create a token" (Gunner Conscript)
 *   CR 106.4, 500.5              "Players don't lose unspent mana as steps and phases end" (Upwelling)
 *   CR 601.3, 602.5, 605.1a      "Until end of turn, target player can't cast instant or sorcery spells, and that player can't activate abilities that aren't mana abilities" (Abeyance)
 *   CR 115.1, 109.4, 608.2h      "That permanent's controller or that player creates a token" (Acorn Catapult)
 *   CR 701.30, 608.2c            "Clash with an opponent. If you win, target player discards two cards. Otherwise, that player discards a card." (Pulling Teeth)
 *   CR 614.15, 701.19c, 608.2c   "Destroy all creatures. They can't be regenerated. If C, instead destroy all creatures, then create two 1/1 tokens. Creatures destroyed this way can't be regenerated." (Kirtar's Wrath)
 */
import { describe, expect, it } from 'vitest';
import type { GameState } from '../../../src/index';
import { applyAction, compileCard, type CardDef, type OracleCard } from '../../../src/index';
import { act, answer, find, scenario } from '../../m3/scenario';
import { tweak } from '../../m4/helpers';
import { card, full, resolveAll } from '../cmd3/helpers';

const sideOf = (s: GameState, player: string): string[] => s.zones.battlefield.filter((id) => s.objects[id]!.controller === player).map((id) => s.objects[id]!.defId);
const namesOf = (s: GameState, player: string): string[] => s.zones.battlefield.filter((id) => s.objects[id]!.controller === player).map((id) => s.defs[s.objects[id]!.defId]!.name);
/** `n` more cards in a player's graveyard (copies of a card already in the game). */
const withGraveyard = (s: GameState, owner: string, n: number): GameState => tweak(s, (g) => {
  for (let i = 0; i < n; i++) {
    const id = `gy-${owner}-${i}` as never;
    const any = Object.values(g.objects).find((o) => o.owner === owner)!;
    g.objects[id] = { ...any, id, zone: 'graveyard', damage: 0, counters: {} } as never;
    g.zones.graveyard[owner]!.push(id);
  }
});

const TROLL = card('Test Troll', 'Creature — Troll', '{0}: Regenerate this creature.', ['2', '2']);
const WRATH = card('Test Wrath', 'Sorcery', "Destroy all creatures. They can't be regenerated.\nThreshold — If there are seven or more cards in your graveyard, instead destroy all creatures, then create two 1/1 white Spirit creature tokens with flying. Creatures destroyed this way can't be regenerated.");
const DEFS = [TROLL, WRATH];

describe('the synthetic edh-d-5 cards are automated', () => {
  it('every synthetic card plays fully', () => {
    for (const d of [WRATH]) expect(full(d), `${d.name}: ${JSON.stringify(d.automation)}`).toBe(true);
  });
});

describe('CR 614.15, 701.19c, 608.2c: "Destroy all creatures. They can\'t be regenerated. If C, instead destroy all creatures, then create two 1/1 tokens. Creatures destroyed this way can\'t be regenerated."', () => {
  /** p1 casts the Wrath with `gy` cards in its graveyard (the spell itself goes there only after it resolves); p1's Troll has a regeneration shield, p2's does not. */
  const play = (gy: number): GameState => {
    let s = scenario([], { defs: DEFS, p1: { hand: ['Test Wrath'], battlefield: ['Test Troll'] }, p2: { battlefield: ['Test Troll'] } });
    s = withGraveyard(s, 'p1', gy);
    s = resolveAll(act(s, { type: 'activate', player: 'p1', source: find(s, 'Test Troll', 'battlefield', 'p1'), ability: 'p:0:0' }));
    return resolveAll(act(s, { type: 'cast', player: 'p1', card: find(s, 'Test Wrath', 'hand', 'p1') }));
  };
  it('with seven cards in your graveyard: every creature dies despite the shield and you get two Spirit tokens', () => {
    const s = play(7);
    expect(sideOf(s, 'p2')).toEqual([]);
    expect(namesOf(s, 'p1')).toEqual(['Spirit Token', 'Spirit Token']);
  });
  it('negative: with six cards the creatures still die (the shield is no help either) but no token is made', () => {
    const s = play(6);
    expect(sideOf(s, 'p2')).toEqual([]);
    expect(sideOf(s, 'p1')).toEqual([]);
  });
});

/** A synthetic card with colors. */
const colored = (name: string, type: string, text: string, colors: string[], pt?: [string, string]): CardDef =>
  compileCard({ name, layout: 'normal', mana_cost: '{0}', type_line: type, oracle_text: text, colors, ...(pt ? { power: pt[0], toughness: pt[1] } : {}) } as OracleCard);
const lifeOf = (s: GameState, p: string): number => s.players.find((x) => x.id === p)!.life;
/** True when `player` can still choose `target` for the spell the pending decision is about. */
const canTarget = (s: GameState, id: string): boolean => {
  const d = s.pending!;
  const r = applyOrError(s, { type: 'answer', player: d.player, decisionId: d.id, answer: { kind: 'chooseTargets', targets: [{ kind: 'player', id }] } } as never);
  return !r;
};
function applyOrError(s: GameState, a: never): string | null {
  const r = applyAction(s, a);
  return r.error ? r.error.message : null;
}

describe('CR 702.16b, 702.16e, 702.16j, 608.2d, 611.2a: "When ~ enters, you gain protection from the color of your choice until end of turn." (Seht\'s Tiger)', () => {
  const TIGER = colored('Test Tiger', 'Creature — Cat', 'Flash\nWhen this creature enters, you gain protection from the color of your choice until end of turn.', ['G'], ['1', '1']);
  const RED_BOLT = colored('Test Red Bolt', 'Instant', 'Test Red Bolt deals 2 damage to target player.', ['R']);
  const BLUE_BOLT = colored('Test Blue Bolt', 'Instant', 'Test Blue Bolt deals 2 damage to target player.', ['U']);
  const RED_BLAST = colored('Test Red Blast', 'Instant', 'Test Red Blast deals 2 damage to each player.', ['R']);
  const DEFS2 = [TIGER, RED_BOLT, BLUE_BOLT, RED_BLAST];
  /** p1 casts the Tiger and chooses `color`; the state is at p1's priority with the ability resolved. */
  const protectedFrom = (color: string): GameState => {
    let s = scenario([], { defs: DEFS2, p1: { hand: ['Test Tiger', 'Test Red Bolt', 'Test Blue Bolt', 'Test Red Blast'] } });
    s = act(s, { type: 'cast', player: 'p1', card: find(s, 'Test Tiger', 'hand', 'p1') });
    for (let i = 0; i < 6 && s.pending?.kind !== 'chooseColor'; i++) s = s.pending?.kind === 'priority' ? act(s, { type: 'pass', player: s.pending.player }) : s;
    expect(s.pending?.kind).toBe('chooseColor');
    s = answer(s, { kind: 'chooseColor', color: color as never });
    return resolveAll(s);
  };
  it('is full', () => expect(full(TIGER)).toBe(true));
  it('red chosen: a red spell cannot target the player, a blue spell can, and red damage from a source with no target is prevented while blue damage is not', () => {
    const s = protectedFrom('R');
    const red = act(s, { type: 'cast', player: 'p1', card: find(s, 'Test Red Bolt', 'hand', 'p1') });
    expect(canTarget(red, 'p1')).toBe(false);
    const blue = act(s, { type: 'cast', player: 'p1', card: find(s, 'Test Blue Bolt', 'hand', 'p1') });
    expect(canTarget(blue, 'p1')).toBe(true);
    const blast = resolveAll(act(s, { type: 'cast', player: 'p1', card: find(s, 'Test Red Blast', 'hand', 'p1') }));
    expect(lifeOf(blast, 'p1')).toBe(20);
    expect(lifeOf(blast, 'p2')).toBe(18);
  });
  it('protection prevents damage, so damage that can\'t be prevented still hurts the protected player (CR 702.16e, 615.12)', () => {
    const FIRE = colored('Test Hard Blast', 'Instant', "Test Hard Blast deals 2 damage to each player. The damage can't be prevented.", ['R']);
    let s = scenario([], { defs: [...DEFS2, FIRE], p1: { hand: ['Test Tiger', 'Test Hard Blast'] } });
    s = act(s, { type: 'cast', player: 'p1', card: find(s, 'Test Tiger', 'hand', 'p1') });
    for (let i = 0; i < 6 && s.pending?.kind !== 'chooseColor'; i++) s = s.pending?.kind === 'priority' ? act(s, { type: 'pass', player: s.pending.player }) : s;
    s = resolveAll(answer(s, { kind: 'chooseColor', color: 'R' as never }));
    s = resolveAll(act(s, { type: 'cast', player: 'p1', card: find(s, 'Test Hard Blast', 'hand', 'p1') }));
    expect(lifeOf(s, 'p1')).toBe(18);
  });
  it('negative: blue chosen: the red spell targets the player and its damage goes through', () => {
    const s = protectedFrom('U');
    const red = act(s, { type: 'cast', player: 'p1', card: find(s, 'Test Red Bolt', 'hand', 'p1') });
    expect(canTarget(red, 'p1')).toBe(true);
    const blast = resolveAll(act(s, { type: 'cast', player: 'p1', card: find(s, 'Test Red Blast', 'hand', 'p1') }));
    expect(lifeOf(blast, 'p1')).toBe(18);
  });
});

describe('CR 702.16b, 702.16e, 702.16j, 604.1: "You and permanents you control have protection from Salamanders." (Gor Muldrak, Amphinologist)', () => {
  const GOR = colored('Test Gor', 'Legendary Creature — Salamander Warrior', 'You and permanents you control have protection from Salamanders.', ['U'], ['3', '3']);
  const NEWT = colored('Test Newt', 'Creature — Salamander', '{0}: This creature deals 1 damage to target player.', ['U'], ['1', '1']);
  const WISP = colored('Test Wisp', 'Creature — Faerie', '{0}: This creature deals 1 damage to target player.', ['U'], ['1', '1']);
  const BLAST = colored('Test Newt Blast', 'Instant', 'Test Newt Blast deals 1 damage to each creature.', ['U']);
  it('is full', () => expect(full(GOR)).toBe(true));
  it('a Salamander cannot target the player or damage them; a Faerie can', () => {
    const s0 = scenario([], { defs: [GOR, NEWT, WISP, BLAST], p1: { battlefield: ['Test Gor', 'Test Newt', 'Test Wisp'] } });
    const viaNewt = act(s0, { type: 'activate', player: 'p1', source: find(s0, 'Test Newt', 'battlefield', 'p1'), ability: 'p:0:0' });
    expect(canTarget(viaNewt, 'p1')).toBe(false);
    const viaWisp = act(s0, { type: 'activate', player: 'p1', source: find(s0, 'Test Wisp', 'battlefield', 'p1'), ability: 'p:0:0' });
    expect(canTarget(viaWisp, 'p1')).toBe(true);
  });
  it('your permanents have it too: a Salamander cannot target your Faerie but can target the opponent\'s Faerie; without Gor Muldrak it can target yours', () => {
    const POKE = colored('Test Poke Newt', 'Creature — Salamander', '{0}: This creature deals 1 damage to target creature.', ['U'], ['1', '1']);
    const canPoke = (s0: GameState, victim: string): boolean => {
      const s = act(s0, { type: 'activate', player: 'p1', source: find(s0, 'Test Poke Newt', 'battlefield', 'p1'), ability: 'p:0:0' });
      const d = s.pending!;
      return applyOrError(s, { type: 'answer', player: d.player, decisionId: d.id, answer: { kind: 'chooseTargets', targets: [{ kind: 'object', id: victim }] } } as never) === null;
    };
    const withGor = scenario([], { defs: [GOR, POKE, WISP], p1: { battlefield: ['Test Gor', 'Test Poke Newt', 'Test Wisp'] }, p2: { battlefield: ['Test Wisp'] } });
    expect(canPoke(withGor, find(withGor, 'Test Wisp', 'battlefield', 'p1'))).toBe(false);
    expect(canPoke(withGor, find(withGor, 'Test Wisp', 'battlefield', 'p2'))).toBe(true);
    const noGor = scenario([], { defs: [GOR, POKE, WISP], p1: { battlefield: ['Test Poke Newt', 'Test Wisp'] }, p2: { battlefield: ['Test Wisp'] } });
    expect(canPoke(noGor, find(noGor, 'Test Wisp', 'battlefield', 'p1'))).toBe(true);
  });
});

describe('CR 603.10a, 303.4b, 301.5: "When ~ dies, if it was enchanted, create a token." / "... if it was equipped, ..." (Gunner Conscript)', () => {
  const GUNNER = colored('Test Gunner', 'Creature — Human Soldier', 'When this creature dies, if it was enchanted, create a 1/1 white Soldier creature token.\nWhen this creature dies, if it was equipped, create a 1/1 white Spirit creature token.', ['W'], ['2', '2']);
  const AURA = colored('Test Aura', 'Enchantment — Aura', 'Enchant creature', ['W']);
  const GEAR = colored('Test Gear', 'Artifact — Equipment', 'Equip {1}', ['W']);
  const DOOM = colored('Test Doom', 'Instant', 'Destroy target creature.', ['B']);
  const kill = (attach: 'none' | 'aura' | 'gear'): GameState => {
    let s = scenario([], { defs: [GUNNER, AURA, GEAR, DOOM], p1: { hand: attach === 'aura' ? ['Test Aura', 'Test Doom'] : ['Test Doom'], battlefield: attach === 'gear' ? ['Test Gunner', 'Test Gear'] : ['Test Gunner'] } });
    const gunner = find(s, 'Test Gunner', 'battlefield', 'p1');
    // an Aura is put on the creature by casting it (an unattached Aura on the battlefield would be put into the graveyard); the Equipment is attached by the test
    if (attach === 'aura') s = resolveAll(act(s, { type: 'cast', player: 'p1', card: find(s, 'Test Aura', 'hand', 'p1') }), { targets: [{ kind: 'object', id: gunner }] });
    if (attach === 'gear') { const gear = find(s, 'Test Gear', 'battlefield', 'p1'); s = tweak(s, (t) => { t.objects[gear]!.attachedTo = gunner; }); }
    return resolveAll(act(s, { type: 'cast', player: 'p1', card: find(s, 'Test Doom', 'hand', 'p1') }), { targets: [{ kind: 'object', id: gunner }] });
  };
  const made = (s: GameState): string[] => s.zones.battlefield.filter((id) => s.objects[id]!.kind === 'token').map((id) => s.defs[s.objects[id]!.defId]!.name);
  it('is full', () => expect(full(GUNNER)).toBe(true));
  it('enchanted when it died: only the enchanted trigger makes its token', () => expect(made(kill('aura'))).toEqual(['Soldier Token']));
  it('equipped when it died: only the equipped trigger makes its token', () => expect(made(kill('gear'))).toEqual(['Spirit Token']));
  it('negative: neither enchanted nor equipped: no token', () => expect(made(kill('none'))).toEqual([]));
});

describe('CR 106.4, 500.5: "Players don\'t lose unspent mana as steps and phases end." (Upwelling)', () => {
  const WELL = colored('Test Well', 'Artifact', "Players don't lose unspent mana as steps and phases end.", []);
  const GROVE2 = colored('Test Spring', 'Land', '{T}: Add {G}.', []);
  const floating = (withWell: boolean): number => {
    let s = scenario([], { defs: [WELL, GROVE2], p1: { battlefield: withWell ? ['Test Well', 'Test Spring'] : ['Test Spring'] } });
    s = act(s, { type: 'activate', player: 'p1', source: find(s, 'Test Spring', 'battlefield', 'p1'), ability: 'p:0:0' });
    for (let i = 0; i < 4; i++) s = s.pending?.kind === 'priority' ? act(s, { type: 'pass', player: s.pending.player }) : s;
    return s.players.find((x) => x.id === 'p1')!.manaPool.length;
  };
  it('is full', () => expect(full(WELL)).toBe(true));
  it('the mana is still there after the phase ended', () => expect(floating(true)).toBe(1));
  it('negative: without it the pool is empty after the step ends', () => expect(floating(false)).toBe(0));
});

describe('CR 601.3, 602.5, 605.1a: "Until end of turn, target player can\'t cast instant or sorcery spells, and that player can\'t activate abilities that aren\'t mana abilities." (Abeyance)', () => {
  const ABEY = colored('Test Abeyance', 'Instant', "Until end of turn, target player can't cast instant or sorcery spells, and that player can't activate abilities that aren't mana abilities.\nDraw a card.", ['W']);
  const BOLT = colored('Test Plain Bolt', 'Instant', 'Test Plain Bolt deals 1 damage to each player.', ['R']);
  const RUNE = colored('Test Rune', 'Artifact', '{0}: You gain 1 life.', []);
  const GROVE = colored('Test Grove', 'Land', '{T}: Add {G}.', []);
  it('is full', () => expect(full(ABEY)).toBe(true));
  it('the player cannot cast an instant, cannot activate a non-mana ability, but can still tap a land for mana; another player is not affected', () => {
    const s0 = scenario([], { defs: [ABEY, BOLT, RUNE, GROVE], p1: { hand: ['Test Abeyance', 'Test Plain Bolt'], battlefield: ['Test Rune', 'Test Grove'] }, p2: { hand: [] } });
    const s = resolveAll(act(s0, { type: 'cast', player: 'p1', card: find(s0, 'Test Abeyance', 'hand', 'p1') }), { targets: [{ kind: 'player', id: 'p1' }] });
    expect(() => act(s, { type: 'cast', player: 'p1', card: find(s, 'Test Plain Bolt', 'hand', 'p1') })).toThrow(/Action rejected/);
    expect(() => act(s, { type: 'activate', player: 'p1', source: find(s, 'Test Rune', 'battlefield', 'p1'), ability: 'p:0:0' })).toThrow(/Action rejected/);
    expect(() => act(s, { type: 'activate', player: 'p1', source: find(s, 'Test Grove', 'battlefield', 'p1'), ability: 'p:0:0' })).not.toThrow();
  });
  it('negative: aimed at the opponent, the caster is not restricted', () => {
    const s0 = scenario([], { defs: [ABEY, BOLT, RUNE], p1: { hand: ['Test Abeyance', 'Test Plain Bolt'], battlefield: ['Test Rune'] } });
    const s = resolveAll(act(s0, { type: 'cast', player: 'p1', card: find(s0, 'Test Abeyance', 'hand', 'p1') }), { targets: [{ kind: 'player', id: 'p2' }] });
    expect(() => act(s, { type: 'cast', player: 'p1', card: find(s, 'Test Plain Bolt', 'hand', 'p1') })).not.toThrow();
    expect(() => act(s, { type: 'activate', player: 'p1', source: find(s, 'Test Rune', 'battlefield', 'p1'), ability: 'p:0:0' })).not.toThrow();
  });
});

describe('CR 115.1, 109.4, 608.2h: "~ deals 1 damage to any target. That permanent\'s controller or that player creates a 1/1 token." (Acorn Catapult)', () => {
  const CATA = colored('Test Catapult', 'Artifact', '{0}: This artifact deals 1 damage to any target. That permanent\'s controller or that player creates a 1/1 green Squirrel creature token.', []);
  const BEAR = colored('Test Big Bear', 'Creature — Bear', '', ['green'], ['3', '3']);
  const squirrels = (s: GameState, p: string): number => s.zones.battlefield.filter((id) => s.objects[id]!.controller === p && s.defs[s.objects[id]!.defId]!.name === 'Squirrel Token').length;
  const fire = (target: { kind: 'player'; id: string } | { kind: 'object'; id: string }): GameState => {
    const s0 = scenario([], { defs: [CATA, BEAR], p1: { battlefield: ['Test Catapult'] }, p2: { battlefield: ['Test Big Bear'] } });
    const t = target.kind === 'object' ? { kind: 'object' as const, id: find(s0, 'Test Big Bear', 'battlefield', 'p2') } : target;
    return resolveAll(act(s0, { type: 'activate', player: 'p1', source: find(s0, 'Test Catapult', 'battlefield', 'p1'), ability: 'p:0:0' }), { targets: [t] });
  };
  it('is full', () => expect(full(CATA)).toBe(true));
  it('aimed at a creature: the creature\'s controller gets the Squirrel', () => {
    const s = fire({ kind: 'object', id: '' });
    expect(squirrels(s, 'p2')).toBe(1);
    expect(squirrels(s, 'p1')).toBe(0);
  });
  it('aimed at a player: that player gets it', () => {
    const s = fire({ kind: 'player', id: 'p2' });
    expect(squirrels(s, 'p2')).toBe(1);
    expect(squirrels(s, 'p1')).toBe(0);
  });
  it('aimed at yourself: you get it (and nobody else does)', () => {
    const s = fire({ kind: 'player', id: 'p1' });
    expect(squirrels(s, 'p1')).toBe(1);
    expect(squirrels(s, 'p2')).toBe(0);
  });
});

describe('CR 701.30, 608.2c: "Clash with an opponent. If you win, target player discards two cards. Otherwise, that player discards a card." (Pulling Teeth)', () => {
  const TEETH = colored('Test Teeth', 'Sorcery', 'Clash with an opponent. If you win, target player discards two cards. Otherwise, that player discards a card.', ['B']);
  it('is full', () => expect(full(TEETH)).toBe(true));
  const BIG = compileCard({ name: 'Test Big Spell', layout: 'normal', mana_cost: '{5}', type_line: 'Sorcery', oracle_text: '', colors: [] } as OracleCard);
  const play = (mine: string, theirs: string): number => {
    const s0 = scenario([], { defs: [TEETH, BIG], p1: { hand: ['Test Teeth'], library: [mine] }, p2: { hand: ['Plains', 'Plains', 'Plains'], library: [theirs] } });
    const s = resolveAll(act(s0, { type: 'cast', player: 'p1', card: find(s0, 'Test Teeth', 'hand', 'p1') }), { targets: [{ kind: 'player', id: 'p2' }], yes: false });
    return (s.zones.hand['p2'] ?? []).length;
  };
  it('won clash: the target discards two cards (3 -> 1); lost clash: the same target discards one (3 -> 2); a tie is not a win', () => {
    expect(play('Test Big Spell', 'Plains')).toBe(1);
    expect(play('Plains', 'Test Big Spell')).toBe(2);
    expect(play('Plains', 'Plains')).toBe(2);
  });
  it('compiles to a clash whose won branch and lost branch both act on the one target player (never on the clashed opponent)', () => {
    const json = JSON.stringify(TEETH.faces[0]!.abilities[0]);
    expect(json).toContain('"onWin"');
    expect(json).toContain('"onLose"');
    expect((json.match(/"ref":"target","id":"t0"/g) ?? []).length).toBe(2);
  });
});
