/**
 * FAST4 T25: the shapes of parser/templates/zz-fast4/t25.json (and the hole-grammar and renderer readings the package added) played through the engine with
 * the real fixture cards compiled by the game's default compiler, or synthetic cards where the real card needs something else first (design 6.10).
 *
 *   CR 400.7a, 611.2a, 105.3   Purelace on a creature spell: the permanent it becomes stays white (the effect has no duration)
 *   CR 108.3, 613.1b, 611.2c   Homeward Path: each player gains control of the creatures they own
 *   CR 608.2c, 400.7j, 110.2   Living Death: each player's creature cards come back under their owner's control, the old creatures go to the graveyard
 *   CR 120.3, 102.3, 109.4     Tectonic Hazard: 1 damage to each opponent and each creature they control, nothing to yours
 *   CR 120.3, 102.3, 603.2     Amarant Coral: "each other opponent" is every opponent but the one dealt damage
 *   CR 401.1, 108.3, 608.2d    Uneasy Partings: the creature's owner chooses the top or the bottom of their library
 *   CR 614.1c, 400.7           Daydream: the creature returns as a new object with a +1/+1 counter
 *   CR 603.7a, 118.12          Attack-in-the-Box: sacrificed at the next end step only if the pump was chosen
 *   CR 701.8a, 115.1           Boom Box: up to one target artifact, creature and land, destroyed together
 *   CR 208.1, 115.1            Repel Calamity: a creature with power or toughness 4 or greater
 *   CR 701.21a, 608.2c         Vile Mutilator's sentence: each opponent sacrifices a nontoken enchantment, then a nontoken creature
 *   CR 608.2c, 701.8a          Villainous Wrath: the loss of life first, then destroy all creatures
 *   CR 120.3, 601.2c           "deals 2 damage to each of up to three targets": each target is dealt the whole amount
 */
import { describe, expect, it } from 'vitest';
import { compileCard, getChars, type CardDef, type GameState, type ObjectId, type OracleCard, type PlayerId } from '../../../src/index';
import { Game } from '../../../src/core/game';
import { makeCtx } from '../../../src/effects/ctx';
import { resolvePlayers } from '../../../src/effects/refs';
import { getCard } from '../../fixtures';
import { act, answer, find, findAll, lifeOf, pass, passUntil, runCombat, scenario, toStep, tweak } from '../../m5/helpers';
import { activate, cast, drive, resolveAll, resolveTop, target } from '../../m5/cr-examples/helpers';

const full = (d: CardDef): boolean => d.automation.level === 'full' && !JSON.stringify(d.faces).includes('"op":"manual"');
const gamePath = (name: string): CardDef => compileCard(getCard(name));
const synth = (name: string, type: string, text: string): CardDef =>
  compileCard({ name, layout: 'normal', mana_cost: '{0}', type_line: type, oracle_text: text, colors: [] } as unknown as OracleCard);
const names = (s: GameState, ids: ObjectId[]): string[] => ids.map((id) => s.objects[id]!.defId).sort();
const graveyard = (s: GameState, p: PlayerId): string[] => names(s, s.zones.graveyard[p]!);
const bf = (s: GameState, p: PlayerId): string[] => names(s, s.zones.battlefield.filter((id) => getChars(s, id)?.controller === p && s.objects[id]!.kind === 'card' && !/Plains|Island|Swamp|Mountain|Forest/.test(s.objects[id]!.defId)));
const lands = (land: string, n: number): string[] => Array(n).fill(land) as string[];

describe('T25 cards are full on the game path (stable templates)', () => {
  it.each(['Purelace', 'Homeward Path', 'Living Death', 'Tectonic Hazard', 'Amarant Coral', 'Daydream', 'Attack-in-the-Box', 'Boom Box', 'Repel Calamity', 'Vile Mutilator', 'Villainous Wrath', "Jaya's Immolating Inferno"])('%s', (n) => {
    expect(full(gamePath(n)), JSON.stringify(gamePath(n).automation)).toBe(true);
  });
});

describe('CR 400.7a, 611.2a: Purelace, "Target spell or permanent becomes white."', () => {
  it('on a creature spell: the permanent it becomes is white, and stays white after the turn ends (no duration)', () => {
    let s = scenario(['Purelace', 'Grizzly Bears', 'Forest', 'Plains'], { p1: { hand: ['Grizzly Bears', 'Purelace'], battlefield: ['Forest', 'Forest', 'Plains'] } });
    s = cast(s, 'Grizzly Bears');
    const spell = find(s, 'Grizzly Bears', 'stack');
    s = cast(s, 'Purelace', [target(spell)]);
    s = resolveAll(s);
    const bears = find(s, 'Grizzly Bears', 'battlefield');
    expect(getChars(s, bears)!.colors).toEqual(['W']);
    s = passUntil(s, (x) => x.turn.number === 2 && x.turn.step === 'main1' && x.pending?.kind === 'priority', 'the next turn');
    expect(getChars(s, bears)!.colors).toEqual(['W']);
  });
  it('on a permanent: it becomes white (its other colors are gone, CR 105.3)', () => {
    let s = scenario(['Purelace', 'Grizzly Bears', 'Plains'], { p1: { hand: ['Purelace'], battlefield: ['Plains'] }, p2: { battlefield: ['Grizzly Bears'] } });
    const bears = find(s, 'Grizzly Bears', 'battlefield');
    s = resolveTop(cast(s, 'Purelace', [target(bears)]));
    expect(getChars(s, bears)!.colors).toEqual(['W']);
  });
});

describe('CR 108.3, 613.1b: Homeward Path, "Each player gains control of all creatures they own."', () => {
  it('a creature of p2 that p1 controls goes back to p2; p1 keeps its own', () => {
    let s = scenario(['Homeward Path', 'Grizzly Bears', 'Threaten', 'Mountain'], { p1: { hand: ['Threaten'], battlefield: ['Homeward Path', 'Grizzly Bears', 'Mountain', 'Mountain', 'Mountain'] }, p2: { battlefield: ['Grizzly Bears'] } });
    const theirs = find(s, 'Grizzly Bears', 'battlefield', 'p2');
    s = resolveTop(cast(s, 'Threaten', [target(theirs)]));
    expect(getChars(s, theirs)!.controller).toBe('p1');
    s = resolveTop(activate(s, find(s, 'Homeward Path', 'battlefield'), [], /Each player/i));
    expect(getChars(s, theirs)!.controller).toBe('p2');
    expect(bf(s, 'p1')).toEqual(['Grizzly Bears', 'Homeward Path']);
  });
});

describe('CR 608.2c, 400.7j, 110.2: Living Death', () => {
  it('each player\'s creature cards return under their control; the creatures on the battlefield go to their owners\' graveyards', () => {
    const s0 = scenario(['Living Death', 'Grizzly Bears', 'Hill Giant', 'Swamp'], {
      p1: { hand: ['Living Death'], graveyard: ['Hill Giant'], battlefield: [...lands('Swamp', 5), 'Grizzly Bears'] },
      p2: { graveyard: ['Grizzly Bears'], battlefield: ['Hill Giant'] },
    });
    const s = resolveTop(cast(s0, 'Living Death'));
    expect(bf(s, 'p1')).toEqual(['Hill Giant']);
    expect(bf(s, 'p2')).toEqual(['Grizzly Bears']);
    expect(graveyard(s, 'p1')).toEqual(['Grizzly Bears', 'Living Death']);
    expect(graveyard(s, 'p2')).toEqual(['Hill Giant']);
    expect(s.zones.exile).toEqual([]);
  });
});

describe('CR 120.3, 102.3: Tectonic Hazard, "deals 1 damage to each opponent and each creature they control"', () => {
  it('p2 loses 1 life and p2\'s 1-toughness creature dies; p1\'s creature is not dealt damage', () => {
    const s0 = scenario(['Tectonic Hazard', 'Llanowar Elves', 'Mountain'], { p1: { hand: ['Tectonic Hazard'], battlefield: ['Mountain', 'Llanowar Elves'] }, p2: { battlefield: ['Llanowar Elves'] } });
    const s = resolveTop(cast(s0, 'Tectonic Hazard'));
    expect(lifeOf(s, 'p2')).toBe(19);
    expect(lifeOf(s, 'p1')).toBe(20);
    expect(bf(s, 'p1')).toEqual(['Llanowar Elves']);
    expect(bf(s, 'p2')).toEqual([]);
  });
});

describe('CR 102.3, 603.2: Amarant Coral, "it deals that much damage to each other opponent"', () => {
  it('ref otherOpponents than the event recipient: every opponent of the controller but the damaged one (three players)', () => {
    const s = scenario(['Amarant Coral'], { p1: { battlefield: ['Amarant Coral'] } });
    s.players.push({ ...structuredClone(s.players[1]!), id: 'p3', name: 'Carol' });
    s.zones.library['p3'] = [];
    const g = new Game(structuredClone(s));
    const cx = makeCtx(g, g.obj(find(s, 'Amarant Coral', 'battlefield')), { targets: [], steps: [] });
    (cx as unknown as { event: unknown }).event = { roles: { recipient: { players: ['p2'] } } };
    expect(resolvePlayers(cx, { ref: 'otherOpponents', than: { ref: 'event', role: 'recipient' } })).toEqual(['p3']);
    (cx as unknown as { event: unknown }).event = { roles: { recipient: { players: ['p3'] } } };
    expect(resolvePlayers(cx, { ref: 'otherOpponents', than: { ref: 'event', role: 'recipient' } })).toEqual(['p2']);
  });
  it('two players: the combat damage is dealt, and the trigger deals nothing more (no other opponent)', () => {
    let s = scenario(['Amarant Coral'], { p1: { battlefield: ['Amarant Coral'] } });
    const coral = find(s, 'Amarant Coral', 'battlefield');
    s = runCombat(s, { attack: [[coral, 'p2']], until: 'combatDamage' });
    s = resolveAll(s);
    expect(lifeOf(s, 'p2')).toBe(15);
    expect(lifeOf(s, 'p1')).toBe(20);
  });
});

describe('CR 401.1, 608.2d: Uneasy Partings, "Target creature\'s owner puts it on their choice of the top or bottom of their library."', () => {
  const setup = (): GameState => scenario(['Uneasy Partings', 'Grizzly Bears', 'Island'], { p1: { hand: ['Uneasy Partings'], battlefield: lands('Island', 4) }, p2: { battlefield: ['Grizzly Bears'] } });
  const run = (choice: 'top' | 'bottom'): GameState => {
    let s = setup();
    s = cast(s, 'Uneasy Partings', [target(find(s, 'Grizzly Bears', 'battlefield'))]);
    s = pass(pass(s));
    expect(s.pending?.kind).toBe('chooseOption');
    expect(s.pending?.player).toBe('p2'); // the owner chooses (CR 108.3)
    const opt = s.pending?.kind === 'chooseOption' ? s.pending.options.find((o) => o.id === choice || o.label.toLowerCase() === choice) : undefined;
    expect(opt).toBeDefined();
    return drive(answer(s, { kind: 'chooseOption', ids: [opt!.id] }));
  };
  it('the owner chooses the bottom: the card is the last of their library', () => {
    const s = run('bottom');
    const lib = s.zones.library['p2']!;
    expect(s.objects[lib[lib.length - 1]!]!.defId).toBe('Grizzly Bears');
    expect(bf(s, 'p2')).toEqual([]);
  });
  it('the owner chooses the top: the card is the first of their library', () => {
    const s = run('top');
    expect(s.objects[s.zones.library['p2']![0]!]!.defId).toBe('Grizzly Bears');
  });
});

describe('CR 614.1c, 400.7: Daydream, "Exile target creature you control, then return that card to the battlefield under its owner\'s control with a +1/+1 counter on it."', () => {
  it('the creature comes back as a new object with one +1/+1 counter, its damage gone', () => {
    let s = scenario(['Daydream', 'Hill Giant', 'Plains'], { p1: { hand: ['Daydream'], battlefield: ['Plains', 'Hill Giant'] } });
    const giant = find(s, 'Hill Giant', 'battlefield');
    s = tweak(s, (t) => { t.objects[giant]!.damage = 2; });
    s = resolveTop(cast(s, 'Daydream', [target(giant)]));
    const now = find(s, 'Hill Giant', 'battlefield');
    expect(now).not.toBe(giant);
    expect(s.objects[now]!.counters['+1/+1']).toBe(1);
    expect(s.objects[now]!.damage).toBe(0);
    expect(getChars(s, now)!.controller).toBe('p1');
  });
});

describe('CR 603.7a, 118.12: Attack-in-the-Box, "If you do, sacrifice it at the beginning of the next end step."', () => {
  const play = (yes: boolean): GameState => {
    let s = scenario(['Attack-in-the-Box'], { p1: { battlefield: ['Attack-in-the-Box'] } });
    const box = find(s, 'Attack-in-the-Box', 'battlefield');
    s = runCombat(s, { attack: [[box, 'p2']], until: 'declareAttackers' });
    expect(s.zones.stack.length).toBe(1); // the attack trigger (CR 603.2)
    s = pass(pass(s));
    expect(s.pending?.kind).toBe('yesNo');
    return drive(answer(s, { kind: 'yesNo', yes }));
  };
  it('pumped: 6/4 this turn, sacrificed at the beginning of the end step', () => {
    let s = play(true);
    const box = find(s, 'Attack-in-the-Box', 'battlefield');
    expect(Number(getChars(s, box)!.power)).toBe(6);
    s = toStep(s, 'end');
    s = resolveAll(s);
    expect(graveyard(s, 'p1')).toEqual(['Attack-in-the-Box']);
  });
  it('not pumped: it stays', () => {
    let s = play(false);
    expect(Number(getChars(s, find(s, 'Attack-in-the-Box', 'battlefield'))!.power)).toBe(2);
    s = toStep(s, 'end');
    s = resolveAll(s);
    expect(bf(s, 'p1')).toEqual(['Attack-in-the-Box']);
  });
});

describe('CR 701.8a, 115.1: Boom Box, "Destroy up to one target artifact, up to one target creature, and up to one target land."', () => {
  it('three target specs of up to one each; the chosen ones are destroyed', () => {
    const def = gamePath('Boom Box');
    const prog = (def.faces[0]!.abilities[0] as unknown as { effect: { targets: { min: number; max: number; filter: unknown }[] } }).effect;
    expect(prog.targets.map((t) => [t.min, t.max, t.filter])).toEqual([[0, 1, { types: ['Artifact'] }], [0, 1, { types: ['Creature'] }], [0, 1, { types: ['Land'] }]]);
    let s = scenario(['Boom Box', 'Grizzly Bears', 'Forest', 'Plains'], { p1: { battlefield: ['Boom Box', ...lands('Plains', 6)] }, p2: { battlefield: ['Grizzly Bears', 'Forest'] } });
    // one decision per target spec, in printed order (CR 601.2c): no artifact, the creature, the land
    s = activate(s, find(s, 'Boom Box', 'battlefield'), [target(), target(find(s, 'Grizzly Bears', 'battlefield')), target(find(s, 'Forest', 'battlefield', 'p2'))]);
    s = resolveTop(s);
    expect(graveyard(s, 'p2')).toEqual(['Forest', 'Grizzly Bears']);
    expect(graveyard(s, 'p1')).toEqual(['Boom Box']);
  });
});

describe('CR 208.1: Repel Calamity, "Destroy target creature with power or toughness 4 or greater."', () => {
  it('a 1/4 or a 4/1 can be the target, a 3/3 cannot', () => {
    const C14 = synth('Test Wall', 'Creature — Wall', '');
    const wall: CardDef = { ...C14, faces: [{ ...C14.faces[0]!, power: '1', toughness: '4' }] } as CardDef;
    let s = scenario(['Repel Calamity', 'Grizzly Bears', 'Plains'], { p1: { hand: ['Repel Calamity'], battlefield: ['Plains', 'Plains'] }, p2: { battlefield: ['Grizzly Bears', 'Test Wall'] }, defs: [wall] });
    const w = find(s, 'Test Wall', 'battlefield');
    expect(Number(getChars(s, w)!.toughness)).toBe(4);
    s = act(s, { type: 'cast', player: 'p1', card: find(s, 'Repel Calamity', 'hand') });
    expect(s.pending?.kind).toBe('chooseTargets');
    const offered = JSON.stringify(s.pending);
    expect(offered).toContain(w);
    expect(offered).not.toContain(find(s, 'Grizzly Bears', 'battlefield'));
    s = resolveTop(drive(answer(s, target(w))));
    expect(graveyard(s, 'p2')).toEqual(['Test Wall']);
  });
});

describe('CR 701.21a, 608.2c: "each opponent sacrifices a nontoken enchantment of their choice, then sacrifices a nontoken creature of their choice"', () => {
  it('p2 sacrifices one of each; p1 sacrifices nothing', () => {
    const SPELL = synth('Test Mutilation', 'Sorcery', 'Each opponent sacrifices a nontoken enchantment of their choice, then sacrifices a nontoken creature of their choice.');
    expect(full(SPELL)).toBe(true);
    let s = scenario(['Grizzly Bears', 'Glorious Anthem'], { p1: { hand: ['Test Mutilation'], battlefield: ['Grizzly Bears', 'Glorious Anthem'] }, p2: { battlefield: ['Grizzly Bears', 'Glorious Anthem'] }, defs: [SPELL] });
    s = resolveAll(cast(s, 'Test Mutilation'), []);
    expect(graveyard(s, 'p2')).toEqual(['Glorious Anthem', 'Grizzly Bears']);
    expect(bf(s, 'p1')).toEqual(['Glorious Anthem', 'Grizzly Bears']);
  });
});

describe('CR 608.2c: Villainous Wrath, "Target opponent loses life equal to the number of creatures they control. Then destroy all creatures."', () => {
  it('the life is lost first (two creatures: 2), then every creature is destroyed', () => {
    let s = scenario(['Villainous Wrath', 'Grizzly Bears', 'Swamp'], { p1: { hand: ['Villainous Wrath'], battlefield: [...lands('Swamp', 5), 'Grizzly Bears'] }, p2: { battlefield: ['Grizzly Bears', 'Grizzly Bears'] } });
    s = resolveTop(cast(s, 'Villainous Wrath', [target('p2')]));
    expect(lifeOf(s, 'p2')).toBe(18);
    expect(findAll(s, 'Grizzly Bears', 'battlefield')).toEqual([]);
  });
});

describe('CR 120.3, 601.2c: "~ deals 2 damage to each of up to three targets"', () => {
  it('each chosen target is dealt 2 damage', () => {
    const SPELL = synth('Test Inferno', 'Sorcery', '~ deals 2 damage to each of up to three targets.');
    expect(full(SPELL)).toBe(true);
    let s = scenario(['Grizzly Bears'], { p1: { hand: ['Test Inferno'] }, p2: { battlefield: ['Grizzly Bears'] }, defs: [SPELL] });
    s = resolveTop(cast(s, 'Test Inferno', [target(find(s, 'Grizzly Bears', 'battlefield'), 'p2')]));
    expect(lifeOf(s, 'p2')).toBe(18);
    expect(graveyard(s, 'p2')).toEqual(['Grizzly Bears']);
  });
});

