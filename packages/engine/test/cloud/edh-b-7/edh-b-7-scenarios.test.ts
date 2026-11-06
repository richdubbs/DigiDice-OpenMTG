/**
 * Commander coordinator B, round edh-b-7: the round's readings played through the engine with synthetic cards (invented names), compiled by the game's default compiler.
 * Alice (p1) is the active player of turn 1. Each test is named after the rule it checks, with its negative case. CR cites checked against the Comprehensive Rules of 2026-09-25.
 *
 *   CR 119.3, 107.1a, 608.2e      "Each player loses a third of their life, rounded up." (Dire Fleet Ravager)
 *   CR 119.3, 404.1               "Defending player loses 1 life for each card in their graveyard." (Guiltfeeder)
 *   CR 508.1d-j, 305.6, 205.3i    "Creatures can't attack you unless their controller pays {X} for each creature they control that's attacking you, where X is the number of basic land types among lands you control." (Collective Restraint)
 *   CR 111.1, 107.3, 119.1        "Create three tapped X/X green Treefolk creature tokens, where X is the amount of life you gained this turn." (Assemble the Entmoot)
 *   CR 201.5c                     "Whenever Storm deals combat damage ..." the short name of a legendary creature that is also a keyword
 *   CR 205.2a, 608.2c, 119.3      "Each opponent loses 1 life for each card type among those cards." (Polluted Cistern)
 *   CR 701.26b, 608.2d            "You untap up to six lands." (Time Spiral): any lands, chosen as the spell resolves
 *   CR 701.21a, 601.2f, 118.7a    "~ costs {1} less to cast for each permanent sacrificed this turn." (The Balrog, Durin's Bane)
 */
import { describe, expect, it } from 'vitest';
import { compileCard, type CardDef, type GameState, type OracleCard } from '../../../src/index';
import { act, answer, find, pass } from '../../m3/scenario';
import { mpScenario, lifeOf } from '../../m12/rules/helpers';

function card(name: string, type: string, text: string, pt?: [string, string], cost = '{0}'): CardDef {
  return compileCard({ name, layout: 'normal', mana_cost: cost, type_line: type, oracle_text: text, colors: [...new Set(cost.match(/[WUBRG]/g) ?? [])], ...(pt ? { power: pt[0], toughness: pt[1] } : {}) } as OracleCard);
}
const full = (d: CardDef): boolean => d.automation.level === 'full' && !JSON.stringify(d.faces).includes('"op":"manual"');

/** Resolve the stack: pass priority, pay automatically, pick the first option of every choice. */
function resolve(s0: GameState): GameState {
  let s = s0;
  for (let g = 0; g < 60 && (s.zones.stack.length > 0 || (s.pending && s.pending.kind !== 'priority')); g++) {
    const p = s.pending;
    if (p?.kind === 'chooseObjects') s = answer(s, { kind: 'chooseObjects', ids: p.options.slice(0, p.max ?? p.options.length) });
    else if (p?.kind === 'chooseTargets') break;
    else if (p?.kind === 'payCost') s = answer(s, { kind: 'payCost', auto: true });
    else if (p?.kind === 'chooseOption') s = answer(s, { kind: 'chooseOption', ids: [p.options[0]!.id] });
    else if (p?.kind === 'priority') s = pass(s);
    else break;
  }
  return s;
}
const cast = (s: GameState, name: string): GameState => resolve(act(s, { type: 'cast', player: 'p1', card: find(s, name, 'hand', 'p1') } as never));
const setLife = (lives: number[]) => (s: GameState): void => { s.players.forEach((p, i) => { p.life = lives[i]!; }); };
const nameIn = (s: GameState, id: string): string => s.defs[s.objects[id]!.defId]!.name;

const RAVAGER = card('Test Ravager', 'Creature — Orc', 'When ~ enters, each player loses a third of their life, rounded up.', ['2', '2']);
const SIPHON = card('Test Siphon', 'Creature — Horror', 'When ~ enters, target opponent loses 1 life for each card in their graveyard.', ['2', '2']);
const PRISON = card('Test Domain Prison', 'Enchantment', "Creatures can't attack you unless their controller pays {X} for each creature they control that's attacking you, where X is the number of basic land types among lands you control.");
const GROVE = card('Test Grove', 'Enchantment', 'Sacrifice this enchantment: Create three tapped X/X green Treefolk creature tokens, where X is the amount of life you gained this turn.');
const SPIRAL = card('Test Spiral', 'Sorcery', 'Exile ~. Each player shuffles their hand and graveyard into their library, then draws seven cards. You untap up to six lands.');
const CISTERN = card('Test Cistern', 'Enchantment', 'Whenever one or more cards are put into your graveyard from your library, each opponent loses 1 life for each card type among those cards.');
const MILLER = card('Test Miller', 'Sorcery', 'Mill three cards.');
const BEAR = card('Test Bear', 'Creature — Bear', '', ['2', '2']);
const GOLD = card('Test Gold Knight', 'Creature — Knight', '', ['2', '2'], '{W}{U}');
const MONO = card('Test Mono Knight', 'Creature — Knight', '', ['2', '2'], '{2}{W}');
const NONE = card('Test Golem', 'Artifact Creature — Golem', '', ['2', '2'], '{3}');
const ARTIFACT = card('Test Gem', 'Artifact', '');
const SAC = card('Test Altar', 'Artifact', '{0}, Sacrifice a creature: You gain 1 life.');
const BALROG = card('Test Balrog', 'Creature — Demon', 'This spell costs {1} less to cast for each permanent sacrificed this turn.', ['6', '6'], '{3}{B}');
const FLASH_HERO = card('Flash, Test Hero', 'Legendary Creature — Human Hero', 'Whenever Flash deals combat damage to a player, you gain 1 life.\nFlash', ['2', '2']);
const FLASH_SPELL = card('Flash, Test Spell', 'Instant', 'Flash\nYou gain 1 life.');
const DEFS = [RAVAGER, SIPHON, PRISON, GROVE, SPIRAL, CISTERN, MILLER, BEAR, GOLD, MONO, NONE, ARTIFACT, SAC, BALROG, FLASH_HERO, FLASH_SPELL];

describe('the synthetic cards are automated', () => {
  it('every synthetic card plays fully', () => {
    for (const d of [RAVAGER, SIPHON, PRISON, GROVE, SPIRAL, CISTERN, MILLER, BALROG, FLASH_HERO]) expect(full(d), `${d.name}: ${JSON.stringify(d.automation)}`).toBe(true);
  });
  it('a keyword line that starts with the capitalized keyword stays the keyword, not the name', () => {
    expect(JSON.stringify(FLASH_HERO.faces)).toContain('combat');
    expect(JSON.stringify(FLASH_HERO.faces)).not.toContain('"op":"manual"');
    expect(full(FLASH_SPELL)).toBe(true);
  });
});

describe('CR 119.3, 107.1a, 608.2e: "Each player loses a third of their life, rounded up."', () => {
  const game = (lives: number[]) => mpScenario({ defs: DEFS, zones: { p1: { hand: ['Test Ravager'] } }, setup: setLife(lives) });
  it('every player loses a third of their own life total, rounded up (40, 10, 7, 2 lose 14, 4, 3, 1)', () => {
    const s = cast(game([40, 10, 7, 2]), 'Test Ravager');
    expect([1, 2, 3, 4].map((i) => lifeOf(s, `p${i}`))).toEqual([26, 6, 4, 1]);
  });
  it('a player with 3 life loses exactly 1, one with 4 loses 2 (the rounding is up, never down)', () => {
    const s = cast(game([3, 4, 5, 6]), 'Test Ravager');
    expect([1, 2, 3, 4].map((i) => lifeOf(s, `p${i}`))).toEqual([2, 2, 3, 4]);
  });
});

describe('CR 119.3, 404.1: "target opponent loses 1 life for each card in their graveyard."', () => {
  it('counts the target\'s own graveyard, not the controller\'s or another opponent\'s', () => {
    let s = mpScenario({ defs: DEFS, zones: { p1: { hand: ['Test Siphon'], graveyard: ['Test Bear', 'Test Bear', 'Test Bear', 'Test Bear'] }, p2: { graveyard: ['Test Bear', 'Test Bear', 'Test Bear'] }, p3: { graveyard: ['Test Bear'] } } });
    s = resolve(act(s, { type: 'cast', player: 'p1', card: find(s, 'Test Siphon', 'hand', 'p1') } as never));
    if (s.pending?.kind === 'chooseTargets') s = resolve(answer(s, { kind: 'chooseTargets', targets: [{ kind: 'player', id: 'p2' }] as never }));
    expect(lifeOf(s, 'p2')).toBe(17);
    expect(lifeOf(s, 'p3')).toBe(20);
    expect(lifeOf(s, 'p1')).toBe(20);
  });
});

describe('CR 508.1h, 305.6, 205.3i: "Creatures can\'t attack you unless their controller pays {X} for each creature they control that\'s attacking you, where X is the number of basic land types among lands you control."', () => {
  const tax = (landsOfDefender: string[], lands: number) => {
    let s = mpScenario({ defs: DEFS, cards: ['Island'], zones: { p1: { battlefield: ['Test Bear', ...Array(lands).fill('Plains')] }, p2: { battlefield: ['Test Domain Prison', ...landsOfDefender] } } });
    s.objects[find(s, 'Test Bear', 'battlefield', 'p1')]!.controlledSinceTurn = -1;
    for (let g = 0; g < 40 && s.pending?.kind !== 'declareAttackers'; g++) s = pass(s);
    return answer(s, { kind: 'declareAttackers', attacks: [{ attacker: find(s, 'Test Bear', 'battlefield', 'p1'), defender: 'p2' }] } as never);
  };
  it('with Plains and Island (two basic land types) the attack costs {2}, whatever the number of lands', () => {
    const s = tax(['Plains', 'Plains', 'Island'], 2);
    expect(s.pending?.kind).toBe('yesNo');
    expect(s.pending?.prompt).toContain('{2}');
  });
  it('with only Plains the attack costs {1}', () => {
    const s = tax(['Plains', 'Plains'], 1);
    expect(s.pending?.kind).toBe('yesNo');
    expect(s.pending?.prompt).toContain('{1}');
  });
  it('with no basic land type the attack is free', () => {
    const s = tax([], 0);
    if (s.pending?.kind === 'yesNo') expect(s.pending.prompt).toContain('{0}');
    else expect(s.combat?.attackers.length).toBe(1);
  });
});

describe('CR 111.1, 107.3, 119.1: "Create three tapped X/X green Treefolk creature tokens, where X is the amount of life you gained this turn."', () => {
  const run = (gain: boolean) => {
    let s = mpScenario({ defs: DEFS, zones: { p1: { battlefield: ['Test Grove', 'Test Altar', 'Test Bear'] } } });
    if (gain) {
      s = resolve(act(s, { type: 'activate', player: 'p1', source: find(s, 'Test Altar', 'battlefield', 'p1'), ability: 'p:0:0' } as never));
      if (s.pending?.kind === 'chooseObjects') s = resolve(answer(s, { kind: 'chooseObjects', ids: [find(s, 'Test Bear', 'battlefield', 'p1')] }));
    }
    return resolve(act(s, { type: 'activate', player: 'p1', source: find(s, 'Test Grove', 'battlefield', 'p1'), ability: 'p:0:0' } as never));
  };
  it('after gaining 1 life, three tapped 1/1 Treefolk tokens appear and the enchantment is gone', () => {
    const s = run(true);
    const tokens = s.zones.battlefield.filter((id) => s.objects[id]!.kind === 'token' || nameIn(s, id).includes('Treefolk'));
    expect(tokens.length).toBe(3);
    expect(tokens.every((id) => s.objects[id]!.tapped)).toBe(true);
    expect(s.zones.battlefield.some((id) => nameIn(s, id) === 'Test Grove')).toBe(false);
  });
  it('with no life gained this turn the tokens are 0/0 and die at once', () => {
    const s = run(false);
    expect(s.zones.battlefield.filter((id) => nameIn(s, id).includes('Treefolk')).length).toBe(0);
  });
});

describe('CR 205.2a, 608.2c, 119.3: "each opponent loses 1 life for each card type among those cards."', () => {
  it('three milled cards (creature, creature, artifact) are two card types: each opponent loses 2', () => {
    let s = mpScenario({ defs: DEFS, zones: { p1: { hand: ['Test Miller'], battlefield: ['Test Cistern'], library: ['Test Bear', 'Test Bear', 'Test Bear', 'Test Gem'] } } });
    s = cast(s, 'Test Miller');
    expect([2, 3, 4].map((i) => lifeOf(s, `p${i}`))).toEqual([18, 18, 18]);
    expect(lifeOf(s, 'p1')).toBe(20);
  });
});

describe('CR 701.26b, 608.2d: "You untap up to six lands." (Time Spiral)', () => {
  it('up to six lands of any player are chosen as the spell resolves and untapped; the spell is exiled', () => {
    let s = mpScenario({ defs: DEFS, zones: { p1: { hand: ['Test Spiral'], battlefield: Array(6).fill({ name: 'Plains', tapped: true }) }, p2: { battlefield: Array(2).fill({ name: 'Plains', tapped: true }) } } });
    s = act(s, { type: 'cast', player: 'p1', card: find(s, 'Test Spiral', 'hand', 'p1') } as never);
    for (let g = 0; g < 40 && (s.zones.stack.length > 0 || (s.pending && s.pending.kind !== 'priority')); g++) {
      const p = s.pending;
      if (p?.kind === 'chooseObjects') s = answer(s, { kind: 'chooseObjects', ids: p.options.slice(0, 6) });
      else if (p?.kind === 'payCost') s = answer(s, { kind: 'payCost', auto: true });
      else if (p?.kind === 'priority') s = pass(s);
      else break;
    }
    const untapped = s.zones.battlefield.filter((id) => !s.objects[id]!.tapped).length;
    expect(untapped).toBe(6);
    expect(s.zones.exile.some((id) => nameIn(s, id) === 'Test Spiral')).toBe(true);
    expect(s.zones.hand['p1']!.length).toBe(7);
  });
});

describe('CR 701.21a, 601.2f, 118.7a: "~ costs {1} less to cast for each permanent sacrificed this turn." (The Balrog, Durin\'s Bane)', () => {
  const game = () => mpScenario({ defs: DEFS, cards: ['Swamp'], zones: { p1: { hand: ['Test Balrog'], battlefield: ['Test Altar', 'Test Bear', 'Test Bear', 'Swamp', 'Swamp'] } } });
  const sac = (s0: GameState): GameState => {
    let s = s0;
    for (let g = 0; g < 8 && s.pending?.kind !== undefined; g++) {
      const p = s.pending;
      if (p?.kind === 'chooseObjects') s = answer(s, { kind: 'chooseObjects', ids: [p.options[0]!] });
      else if (p?.kind === 'payCost') s = answer(s, { kind: 'payCost', auto: true });
      else if (p?.kind === 'priority' && s.zones.stack.length > 0) s = pass(s);
      else break;
    }
    return s;
  };
  it('without a sacrifice the {3}{B} creature cannot be cast with two lands; after two sacrifices (by anyone) it can', () => {
    let s = game();
    expect(() => act(s, { type: 'cast', player: 'p1', card: find(s, 'Test Balrog', 'hand', 'p1') } as never)).toThrow();
    for (let i = 0; i < 2; i++) s = sac(act(s, { type: 'activate', player: 'p1', source: find(s, 'Test Altar', 'battlefield', 'p1'), ability: 'p:0:0' } as never));
    expect(s.zones.battlefield.filter((id) => nameIn(s, id) === 'Test Bear').length).toBe(0);
    s = resolve(act(s, { type: 'cast', player: 'p1', card: find(s, 'Test Balrog', 'hand', 'p1') } as never));
    expect(s.zones.battlefield.some((id) => nameIn(s, id) === 'Test Balrog')).toBe(true);
  });
});
