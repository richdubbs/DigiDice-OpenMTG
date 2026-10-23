/**
 * WP16, design 9.4: one test per wired `RestrictionDef.action` row, through the REAL call-sites (combat declarations, castCheck, activation, land play,
 * targeting, attachment, the life rules, the game-end rules, the untap step), with cards whose restriction is written as model JSON.
 */
import { describe, expect, it } from 'vitest';
import {
  attackCandidates, canPayLife, cloneState, gainLife, legalActions, loseLife, renderGate, type CardDef, type GameState, type ObjectId,
} from '../../../src/index';
import { Game } from '../../../src/core/game';
import { performStateBasedActions } from '../../../src/core/sba';
import { castCheck } from '../../../src/actions/cast';
import { landCheck } from '../../../src/actions/land';
import { gameOf, hookpoints } from '../../../src/rules/hookpoints';
import { targetOptions } from '../../../src/rules/targets';
import { staticsProvider } from '../../../src/statics/hooks';
import { act, advanceTo, castAuto, find, legal, logHas, reject, scenario, toDeclareAttackers, tweak } from '../helpers';
import {
  ARREST, EACH_PLAYER, putAttached, ENCHANTMENT, MANA_VAULT, OPPONENTS, PACIFISM, PLATINUM_ANGEL, SELF, SORCERY, UNCOUNTERABLE, VANILLA, YOU, cant, kw, staticOf,
} from './fixtures';

const BEARS = VANILLA('Test Bears');
const LANDS = ['Island', 'Island', 'Island', 'Forest', 'Forest', 'Plains', 'Mountain'];

/** A board for p1 with extra definitions; p1 has untapped lands so spells are payable. */
function board(defs: CardDef[], p1: { battlefield?: string[]; hand?: string[]; graveyard?: string[] } = {}, p2: { battlefield?: string[]; hand?: string[] } = {}): GameState {
  return scenario([...new Set([...LANDS, 'Mountain', 'Llanowar Elves', 'Sol Ring', 'Lightning Bolt'])], {
    defs,
    p1: { battlefield: [...LANDS, ...(p1.battlefield ?? [])], hand: p1.hand ?? [], graveyard: p1.graveyard ?? [] },
    p2: { battlefield: ['Island', 'Island', 'Mountain', ...(p2.battlefield ?? [])], hand: p2.hand ?? [] },
  });
}

const g = (s: GameState) => gameOf(s);

describe('CR 508.1c, 509.1b: "Enchanted creature can\'t attack or block." (Pacifism, rule:attack, rule:block)', () => {
  const setup = () => {
    let s = board([BEARS, PACIFISM], { battlefield: ['Test Bears'] }, { battlefield: ['Test Bears'] });
    const [mine, theirs] = [find(s, 'Test Bears', 'battlefield', 'p1'), find(s, 'Test Bears', 'battlefield', 'p2')];
    s = putAttached(s, 'Pacifism', mine);
    return { s, mine, theirs };
  };

  it('the enchanted creature is not offered as an attacker; the declare attackers decision of the real game omits it', () => {
    const { s, mine } = setup();
    expect(attackCandidates(s, 'p1').map((c) => c.id)).not.toContain(mine);
    const d = toDeclareAttackers(s).pending;
    expect(d?.kind === 'declareAttackers' ? d.candidates.map((c) => c.id) : ['no decision']).not.toContain(mine);
    const denial = hookpoints.canAttack(g(s), mine, 'p2');
    expect(denial?.rules).toEqual(expect.arrayContaining(['CR 508.1c', 'CR 101.2']));
    expect(denial?.message).toContain("Enchanted creature can't attack or block.");
  });

  it('it can\'t block either, while the unenchanted creature can', () => {
    const { s, mine, theirs } = setup();
    expect(hookpoints.canBlock(g(s), mine, theirs)?.rules).toContain('CR 509.1b');
    expect(hookpoints.canBlock(g(s), theirs, mine)).toBeNull();
  });

  it('CR 611.3a: the restriction ends with the Aura (a static ability stores nothing)', () => {
    const { s, mine } = setup();
    const gone = tweak(s, (t) => {
      const aura = find(t, 'Pacifism', 'battlefield');
      t.zones.battlefield = t.zones.battlefield.filter((id) => id !== aura);
      t.objects[aura]!.zone = 'graveyard';
      t.zones.graveyard.p1!.push(aura);
      delete t.objects[aura]!.attachedTo;
    });
    expect(attackCandidates(gone, 'p1').map((c) => c.id)).toContain(mine);
  });
});

describe('CR 509.1b: "can\'t be blocked" and "can\'t be blocked by creatures with power 2 or less" (rule:beBlocked, rule:beBlockedBy, feature:restrict.other)', () => {
  const unblockable = VANILLA('Test Phantom', ['2', '2'], [staticOf("This creature can't be blocked.", [cant(SELF, 'beBlocked')])]);
  const bigOnly = VANILLA('Test Bully', ['3', '3'], [staticOf("This creature can't be blocked by creatures with power 2 or less.", [cant(SELF, 'beBlockedBy', { other: { types: ['Creature'], power: { op: '<=', value: 2 } } })])]);
  const giant = VANILLA('Test Giant', ['3', '3']);

  it('no creature can block the first; only a creature with power 3 or more can block the second', () => {
    const s = board([unblockable, bigOnly, BEARS, giant], { battlefield: ['Test Phantom', 'Test Bully'] }, { battlefield: ['Test Bears', 'Test Giant'] });
    const [phantom, bully, bears, big] = ['Test Phantom', 'Test Bully', 'Test Bears', 'Test Giant'].map((n) => find(s, n, 'battlefield'));
    expect(hookpoints.canBlock(g(s), bears!, phantom!)?.rules).toContain('CR 509.1b');
    expect(hookpoints.canBlock(g(s), big!, phantom!)?.rules).toContain('CR 509.1b');
    expect(hookpoints.canBlock(g(s), bears!, bully!)?.rules).toContain('CR 509.1b');
    expect(hookpoints.canBlock(g(s), big!, bully!)).toBeNull();
  });
});

describe('CR 601.3: "can\'t cast" restrictions on players (rule:cast, feature:restrict.when, castCheck and legalActions)', () => {
  // "Each opponent can cast spells only any time they could cast a sorcery." is a different form; this is the plain "can't cast during your turn".
  const teferi = ENCHANTMENT('Test Silence Field', [staticOf("Your opponents can't cast spells during your turn.", [cant(OPPONENTS, 'cast', { when: { cond: 'turnOf', whose: 'you' } })])]);

  it('during the controller\'s turn an opponent can\'t cast; on the opponent\'s own turn they can', () => {
    let s = board([teferi], { battlefield: ['Test Silence Field'] }, { hand: ['Lightning Bolt'] });
    const bolt = find(s, 'Lightning Bolt', 'hand', 'p2');
    const d = castCheck(s, 'p2', bolt);
    expect('denial' in d && d.denial.rules).toEqual(expect.arrayContaining(['CR 601.3', 'CR 101.2']));
    s = advanceTo(s, 2, 'main1'); // p2's turn
    expect('info' in castCheck(s, 'p2', find(s, 'Lightning Bolt', 'hand', 'p2'))).toBe(true);
  });

  it('the controller is not affected (subject: opponents)', () => {
    const s = board([teferi], { battlefield: ['Test Silence Field'], hand: ['Lightning Bolt'] });
    expect(legal(s, 'p1', 'cast').map((a) => a.label)).toContain('Cast Lightning Bolt');
  });

  it('"can\'t cast creature spells" filters by the spell (`other`), seen as the face being cast', () => {
    const noCreatures = ENCHANTMENT('Test Ban', [staticOf("Players can't cast creature spells.", [cant(EACH_PLAYER, 'cast', { other: { types: ['Creature'] } })])]);
    const s = board([noCreatures, BEARS], { battlefield: ['Test Ban'], hand: ['Test Bears', 'Lightning Bolt'] });
    expect(legal(s, 'p1', 'cast').map((a) => a.label)).toEqual(['Cast Lightning Bolt']);
    expect(reject(s, { type: 'cast', player: 'p1', card: find(s, 'Test Bears', 'hand') }).rules).toContain('CR 601.3');
  });

  it('a limit: "Each player can\'t cast more than one spell each turn." (max: spells cast this turn, CR 601.2i)', () => {
    const ruleOfLaw = ENCHANTMENT('Test Rule of Law', [staticOf("Each player can't cast more than one spell each turn.", [cant(EACH_PLAYER, 'cast', { max: 1 })])]);
    const s = board([ruleOfLaw], { battlefield: ['Test Rule of Law'], hand: ['Lightning Bolt', 'Lightning Bolt'] });
    expect(legal(s, 'p1', 'cast')).toHaveLength(2);
    const after = tweak(s, (t) => { t.players[0]!.turnStats.spellsCast = 1; });
    expect(legal(after, 'p1', 'cast')).toEqual([]);
  });
});

describe('CR 601.3, 604.5: a spell\'s own casting restriction ("Cast this spell only ...", restrict:onlyIf)', () => {
  it('a condition that is not timing ("only if you control a creature") is enforced before the card moves', () => {
    const conditional = SORCERY('Test Conditional', '{U}');
    const def: CardDef = { ...conditional, faces: [{ ...conditional.faces[0]!, abilities: [...conditional.faces[0]!.abilities, staticOf('Cast this spell only if you control a creature.', [{ s: 'restrict', subject: SELF, mode: 'onlyIf', action: 'cast', when: { cond: 'exists', of: { ref: 'each', filter: { types: ['Creature'], controller: 'you' } } } }], { zone: ['stack'] })] }] };
    const without = board([def], { hand: ['Test Conditional'] });
    expect(legal(without, 'p1', 'cast')).toEqual([]);
    expect(reject(without, { type: 'cast', player: 'p1', card: find(without, 'Test Conditional', 'hand') }).rules).toContain('CR 601.3');
    const withOne = board([def, BEARS], { hand: ['Test Conditional'], battlefield: ['Test Bears'] });
    expect(legal(withOne, 'p1', 'cast').map((a) => a.label)).toEqual(['Cast Test Conditional']);
  });

  it('the native timing form is answered by the statics provider too (the same rule, read from the model JSON)', () => {
    const combatOnly = { ...SORCERY('Test Ambush', '{G}'), faces: [{ ...SORCERY('Test Ambush', '{G}').faces[0]!, types: ['Instant' as const], abilities: [staticOf('Cast this spell only during combat.', [{ s: 'restrict', subject: SELF, mode: 'onlyIf', action: 'cast', when: { cond: 'turnOf', whose: 'any', step: ['beginCombat', 'declareAttackers', 'declareBlockers', 'combatDamage', 'endCombat'] } }], { zone: ['stack'] })] }] } as CardDef;
    const s = board([combatOnly], { hand: ['Test Ambush'] });
    const id = find(s, 'Test Ambush', 'hand');
    expect(staticsProvider.canCast!(g(s), id, 'p1', 0, {})?.rules).toContain('CR 601.3');
    const inCombat = advanceTo(s, 1, 'beginCombat');
    expect(staticsProvider.canCast!(g(inCombat), find(inCombat, 'Test Ambush', 'hand'), 'p1', 0, {})).toBeNull();
  });
});

describe('CR 601.3: "Players can\'t cast spells from graveyards." (rule:castFromZone)', () => {
  const flashback = { ...SORCERY('Test Flashback', '{U}') };
  const fb: CardDef = { ...flashback, faces: [{ ...flashback.faces[0]!, abilities: [...flashback.faces[0]!.abilities, kw('flashback', { text: 'Flashback {1}{U}', cost: { mana: [{ kind: 'generic', amount: 1 }, { kind: 'colored', color: 'U' }] } })] }] };
  const crypt = ENCHANTMENT('Test Crypt Ward', [staticOf("Players can't cast spells from graveyards.", [cant(EACH_PLAYER, 'castFromZone')])]);

  it('flashback from the graveyard is denied; the same card from the hand is not', () => {
    const s = board([fb, crypt], { battlefield: ['Test Crypt Ward'], graveyard: ['Test Flashback'], hand: ['Test Flashback'] });
    expect(legal(board([fb], { graveyard: ['Test Flashback'] }), 'p1', 'cast').map((a) => a.label).some((l) => l.includes('flashback'))).toBe(true); // baseline
    const labels = legal(s, 'p1', 'cast').map((a) => a.label);
    expect(labels.some((l) => l.includes('flashback'))).toBe(false);
    expect(labels).toContain('Cast Test Flashback');
  });
});

describe('CR 602.5: "its activated abilities can\'t be activated" and "can\'t activate abilities of artifacts" (rule:activate)', () => {
  it('Arrest on Llanowar Elves: its mana ability is not listed, not a mana source, and the action is rejected', () => {
    let s = board([ARREST], { battlefield: ['Llanowar Elves'] });
    const elves = find(s, 'Llanowar Elves', 'battlefield');
    s = putAttached(s, 'Test Arrest', elves);
    expect(legal(s, 'p1', 'activate').some((a) => a.action.type === 'activate' && a.action.source === elves)).toBe(false);
    expect(reject(s, { type: 'activate', player: 'p1', source: elves, ability: 'p:0:0' }).rules).toContain('CR 602.5');
  });

  it('a player restriction with `other`: Sol Ring is stopped, Llanowar Elves is not', () => {
    const nullRod = ENCHANTMENT('Test Null Field', [staticOf("Players can't activate abilities of artifacts.", [cant(EACH_PLAYER, 'activate', { other: { types: ['Artifact'] } })])]);
    const s = board([nullRod], { battlefield: ['Llanowar Elves', 'Sol Ring', 'Test Null Field'] });
    const ring = find(s, 'Sol Ring', 'battlefield');
    const elves = find(s, 'Llanowar Elves', 'battlefield');
    expect(hookpoints.canActivate(g(s), ring, 'p:0:0', 'p1')?.rules).toContain('CR 602.5');
    expect(hookpoints.canActivate(g(s), elves, 'p:0:0', 'p1')).toBeNull();
    const sources = legal(s, 'p1', 'activate').map((a) => (a.action.type === 'activate' ? a.action.source : ''));
    expect(sources).toContain(elves);
    expect(sources).not.toContain(ring);
  });
});

describe('CR 305.2: "Players can\'t play lands." (rule:playLand)', () => {
  it('landCheck denies, legalActions omits the land', () => {
    const noLands = ENCHANTMENT('Test Salted Earth', [staticOf("Players can't play lands.", [cant(EACH_PLAYER, 'playLand')])]);
    const s = scenario(['Forest'], { defs: [noLands], p1: { battlefield: ['Test Salted Earth'], hand: ['Forest'] } });
    const d = landCheck(s, 'p1', find(s, 'Forest', 'hand'));
    expect('denial' in d && d.denial.rules).toEqual(expect.arrayContaining(['CR 305.2', 'CR 101.2']));
    expect(legal(s, 'p1', 'playLand')).toEqual([]);
  });
});

describe('CR 115.1, 601.2c: "can\'t be the target of ..." (rule:beTargeted), in the JSON the render gate accepts for the Oracle text', () => {
  const sanctityText = "You can't be the target of spells or abilities your opponents control.";
  const sanctityAbility = staticOf(sanctityText, [cant(YOU, 'beTargeted', { other: { controller: 'opponent', anyOf: [{ stackKind: 'spell' }, { stackKind: 'ability' }] } })]);
  const sanctity = ENCHANTMENT('Test Sanctity', [sanctityAbility]);

  it('the controller can\'t be targeted by an opponent\'s spell, but can by their own', () => {
    expect(renderGate(sanctityAbility, [sanctityText], { selfNames: ['Test Sanctity'] }).ok).toBe(true);
    const s = board([sanctity], { battlefield: ['Test Sanctity'], hand: ['Lightning Bolt'] }, { hand: ['Lightning Bolt'] });
    const spec = { id: 't0', kind: 'anyTarget' as const, min: 1, max: 1, text: 'any target' };
    expect(targetOptions(s, spec, 'p2', find(s, 'Lightning Bolt', 'hand', 'p2')).players).toEqual(['p2']);
    expect(targetOptions(s, spec, 'p1', find(s, 'Lightning Bolt', 'hand', 'p1')).players).toEqual(['p1', 'p2']);
  });

  it('an object: "This creature can\'t be the target of black spells." (the source filter is matched wherever the spell is)', () => {
    const text = "This creature can't be the target of black spells.";
    const ability = staticOf(text, [cant(SELF, 'beTargeted', { other: { colors: ['B'], stackKind: 'spell' } })]);
    expect(renderGate(ability, [text], { selfNames: ['Test Warded'] }).ok).toBe(true);
    const ward = VANILLA('Test Warded', ['2', '2'], [ability]);
    const black = { ...SORCERY('Test Black Spell', '{B}') };
    const s = board([ward, black], { battlefield: ['Test Warded'], hand: ['Test Black Spell', 'Lightning Bolt'] });
    const warded = find(s, 'Test Warded', 'battlefield');
    expect(hookpoints.canBeTargeted(g(s), warded, find(s, 'Test Black Spell', 'hand'), 'p1')?.rules).toEqual(expect.arrayContaining(['CR 115.1', 'CR 601.2c', 'CR 101.2']));
    expect(hookpoints.canBeTargeted(g(s), warded, find(s, 'Lightning Bolt', 'hand'), 'p1')).toBeNull();
  });
});

describe('CR 303.4c, 704.5m: "can\'t be enchanted" answered by hookpoints.canAttach (rule:beEnchanted stays unadvertised until the Aura spell path honors CR 303.4i)', () => {
  const warded = VANILLA('Test Unenchantable', ['2', '2'], [staticOf("This creature can't be enchanted.", [cant(SELF, 'beEnchanted')])]);

  // CR 303.4a: the target of an Aura spell is defined by its enchant ability alone; an Aura that can't legally enchant its target as it resolves is put into
  // the graveyard instead (CR 303.4i: the resolution's job, WP10).
  it('an Aura already on it is put into its owner\'s graveyard by the state-based action; the same Aura on an ordinary creature stays', () => {
    const s = board([warded, PACIFISM, BEARS], { battlefield: ['Test Unenchantable', 'Test Bears'] });
    const host = find(s, 'Test Unenchantable', 'battlefield');
    const t = putAttached(putAttached(s, 'Pacifism', host), 'Pacifism', find(s, 'Test Bears', 'battlefield'));
    const onHost = t.zones.battlefield.find((id) => t.objects[id]!.attachedTo === host)!;
    expect(hookpoints.canAttach(g(t), onHost, host)?.rules).toContain('CR 303.4');
    const game = new Game(cloneState(t));
    performStateBasedActions(game);
    expect(game.s.zones.graveyard.p1!.map((id) => game.s.objects[id]!.defId)).toEqual(['Pacifism']);
    expect(game.s.zones.battlefield.filter((id) => game.s.objects[id]!.defId === 'Pacifism')).toHaveLength(1);
  });
});

describe('CR 119.7-119.8: "Players can\'t gain life" / "You can\'t lose life" (rule:gainLife, rule:loseLife through rules/life.ts)', () => {
  it('a static ability on the battlefield stops life gain and loss, and paying life (CR 119.4)', () => {
    const vortex = ENCHANTMENT('Test Vortex', [staticOf("Players can't gain life.", [cant(EACH_PLAYER, 'gainLife')]), staticOf("You can't lose life.", [cant(YOU, 'loseLife')])]);
    const s = board([vortex], { battlefield: ['Test Vortex'] });
    const game = new Game(cloneState(s));
    expect(gainLife(game, 'p2', 3, 'test')).toBe(0);
    expect(loseLife(game, 'p1', 3, 'test')).toBe(0);
    expect(canPayLife(game, 'p1', 2)).toBe(false);
    expect(loseLife(game, 'p2', 3, 'test')).toBe(3);
    expect(game.s.players.map((p) => p.life)).toEqual([20, 17]);
  });
});

describe('CR 104.3, 104.2: Platinum Angel (rule:lose, rule:win through core/sba.ts)', () => {
  it('its controller at 0 life does not lose while it is on the battlefield, and loses once it leaves', () => {
    const s = tweak(board([PLATINUM_ANGEL], { battlefield: ['Platinum Angel'] }), (t) => { t.players[0]!.life = 0; });
    const game = new Game(cloneState(s));
    performStateBasedActions(game);
    expect(game.s.players[0]!.hasLost).toBe(false);
    const angel = find(game.s, 'Platinum Angel', 'battlefield');
    const gone = tweak(game.s, (t) => {
      t.zones.battlefield = t.zones.battlefield.filter((id) => id !== angel);
      t.objects[angel]!.zone = 'graveyard';
      t.zones.graveyard.p1!.push(angel);
    });
    const later = new Game(cloneState(gone));
    performStateBasedActions(later);
    expect(later.s.players[0]!.hasLost).toBe(true);
  });

  it('its controller\'s opponents can\'t win: a "you win the game" for p2 does nothing (CR 104.2b... 104.3)', async () => {
    const { winGame } = await import('../../../src/core/sba');
    const s = board([PLATINUM_ANGEL], { battlefield: ['Platinum Angel'] });
    const game = new Game(cloneState(s));
    winGame(game, 'p2', 'Test Win');
    expect(game.s.result).toBeNull();
  });
});

describe('CR 502.3: Mana Vault doesn\'t untap during its controller\'s untap step (rule:untapDuringUntapStep)', () => {
  it('it stays tapped through the untap step while the other permanents untap; the log says why', () => {
    let s = board([MANA_VAULT], { battlefield: ['Mana Vault'] });
    const vault = find(s, 'Mana Vault', 'battlefield');
    const island = find(s, 'Island', 'battlefield', 'p1');
    s = act(s, { type: 'activate', player: 'p1', source: vault, ability: 'p:0:1' }); // {T}: Add {C}{C}{C} (the static line is p:0:0)
    s = tweak(s, (t) => { t.objects[island]!.tapped = true; });
    expect(s.objects[vault]!.tapped).toBe(true);
    s = advanceTo(s, 3, 'upkeep'); // p1's next untap step
    expect(s.objects[vault]!.tapped).toBe(true);
    expect(s.objects[island]!.tapped).toBe(false);
    expect(logHas(s, /Mana Vault doesn't untap/, 'CR 502.3')).toBe(true);
  });
});

describe('CR 101.2, 701.6a: "This spell can\'t be countered." (hookpoints.canBeCountered answers; rule:beCountered waits for the counter handler)', () => {
  it('the spell on the stack can\'t be countered; another spell can; Cavern of Souls\' flag is honored too (CR 106.6)', () => {
    const s = castAuto(board([UNCOUNTERABLE], { hand: ['Test Uncounterable', 'Lightning Bolt'] }), 'Test Uncounterable');
    const spell = s.zones.stack[s.zones.stack.length - 1]!;
    expect(hookpoints.canBeCountered(g(s), spell)?.rules).toContain('CR 701.6a');
    const flagged = tweak(s, (t) => { t.objects[spell]!.stack!.flags = ['cantBeCountered']; t.defs = { ...t.defs }; });
    expect(staticsProvider.canBeCountered!(g(flagged), spell)?.rules).toContain('CR 101.2');
  });
});

describe('legalActions stays consistent with the restrictions (every listed action is accepted)', () => {
  it('with Pacifism, Arrest-style and a cast ban in play, every listed cast/activate/playLand action applies without error', () => {
    const ban = ENCHANTMENT('Test Ban', [staticOf("Players can't cast creature spells.", [cant(EACH_PLAYER, 'cast', { other: { types: ['Creature'] } })])]);
    let s = board([BEARS, PACIFISM, ARREST, ban], { battlefield: ['Llanowar Elves', 'Test Ban'], hand: ['Test Bears', 'Lightning Bolt', 'Forest'] });
    s = putAttached(s, 'Test Arrest', find(s, 'Llanowar Elves', 'battlefield'));
    for (const a of legalActions(s, 'p1')) {
      if (a.action.type === 'pass') continue;
      expect(() => act(s, a.action), a.label).not.toThrow();
    }
  });
});

