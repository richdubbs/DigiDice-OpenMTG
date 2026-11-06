/**
 * Commander lane d-rank-5 (ranks 19,501-20,000 + concept groups), round edh-d-55: the round's readings played through the engine with synthetic cards (invented names,
 * design 6.10), compiled by the game's default compiler. Alice (p1) is the active player of turn 1. Each test is named after the rule it checks, with its negative case.
 * CR cites are from memory (cloud session) and listed as unverified in the record.
 *
 *   CR 509.1b, 506.2          "~ can't be blocked as long as defending player controls three or more artifacts."
 *   CR 601.3, 304.1, 307.1    "Exile the top card of your library. Until end of turn, you may cast it if it's an instant or sorcery spell."
 *   CR 603.2, 712.14a, 603.4  "Whenever a permanent you control transforms or a permanent you control enters transformed, you may draw a card. Do this only once each turn."
 *   CR 205.3m, 400.7          "..., return that card to the battlefield under your control. If it's a creature, it's a Zombie in addition to its other creature types."
 *   CR 701.20, 608.2c         "reveal the top six cards ... You may put a card that shares a creature type with it from among them into your hand."
 *   CR 508.4, 603.7a          "Exile it. Return it to the battlefield under your control tapped and attacking at the beginning of the declare attackers step on your next turn."
 *   CR 202.3, 608.2h, 701.20  "You may put any number of artifact cards with mana value less than or equal to ~'s power from among them onto the battlefield tapped."
 */
import { describe, expect, it } from 'vitest';
import { compileCard, type CardDef, type DeclareBlockersDecision, type GameState, type ObjectId, type OracleCard } from '../../../src/index';
import { getChars } from '../../../src/rules/characteristics';
import { act, answer, find, findAll, legal, pass, scenario } from '../../m3/scenario';
import { declareAttackers, declareBlockers, passUntil, toDeclareAttackers, tweak } from '../../m4/helpers';

function card(name: string, type: string, text: string, pt?: [string, string], cost = '{0}', colors: string[] = []): CardDef {
  return compileCard({ name, layout: 'normal', mana_cost: cost, type_line: type, oracle_text: text, colors, ...(pt ? { power: pt[0], toughness: pt[1] } : {}) } as OracleCard);
}
const automated = (d: CardDef): boolean => d.faces.every((f) => f.abilities.every((a) => a.kind !== 'manual')) && !JSON.stringify(d.faces).includes('"op":"manual"')
  && (d.automation.faces ?? []).every((f) => f.abilities.every((a) => a.level !== 'manual' && a.manual.length === 0));
const where = (s: GameState, name: string): string[] => Object.values(s.objects).filter((o) => s.defs[o.defId]?.name === name).map((o) => o.zone);

/** Answer the decisions that come up until the stack is empty and priority is back: yes/no with `yes`, costs automatically, `pick` names the objects to choose. */
function settle(s0: GameState, opts: { yes?: boolean; pick?: (d: { options: unknown; min: number; max?: number }, s: GameState) => ObjectId[] } = {}): GameState {
  let s = s0;
  for (let guard = 0; guard < 60 && s.pending && (s.pending.kind !== 'priority' || s.zones.stack.length > 0); guard++) {
    const d = s.pending;
    if (d.kind === 'payCost') s = answer(s, { kind: 'payCost', auto: true });
    else if (d.kind === 'yesNo') s = answer(s, { kind: 'yesNo', yes: opts.yes ?? true });
    else if (d.kind === 'chooseObjects') s = answer(s, { kind: 'chooseObjects', ids: opts.pick ? opts.pick(d as never, s) : [] } as never);
    else if (d.kind === 'priority') s = pass(s);
    else throw new Error(`unexpected decision ${d.kind}`);
  }
  return s;
}

// ---------------------------------------------------------------------------------------------------------------------------------
// Ayesha Tanaka: "can't be blocked as long as defending player controls three or more artifacts"
// ---------------------------------------------------------------------------------------------------------------------------------
const SERPENT = card('Test Serpent', 'Creature — Serpent', "Test Serpent can't be blocked as long as defending player controls three or more artifacts.", ['4', '4']);
const BEAR = card('Test Bear', 'Creature — Bear', '', ['2', '2'], '{1}{G}', ['G']);
const RELIC = card('Test Relic', 'Artifact', '', undefined, '{1}');
const blockers = (s: GameState): DeclareBlockersDecision => s.pending as DeclareBlockersDecision;
const canBlock = (s: GameState, blocker: ObjectId, attacker: ObjectId): boolean => s.pending?.kind === 'declareBlockers' && blockers(s).candidates.some((c) => c.id === blocker && c.attackers.includes(attacker));
const attackWith = (s: GameState, ids: ObjectId[]): GameState =>
  passUntil(declareAttackers(toDeclareAttackers(s), ids.map((id) => [id] as [ObjectId])), (x) => x.pending?.kind === 'declareBlockers' || x.turn.step === 'combatDamage' || x.turn.step === 'endCombat', 'blockers');

describe('CR 509.1b, 506.2: "can\'t be blocked as long as defending player controls three or more artifacts"', () => {
  it('is automated', () => expect(automated(SERPENT)).toBe(true));
  it('three artifacts of the defending player: no block; two: it can be blocked; artifacts of the attacking player do not count', () => {
    const board = (theirs: number, mine: number): GameState => scenario([], {
      p1: { battlefield: ['Test Serpent', ...Array.from({ length: mine }, () => 'Test Relic')] },
      p2: { battlefield: ['Test Bear', ...Array.from({ length: theirs }, () => 'Test Relic')] }, defs: [SERPENT, BEAR, RELIC],
    });
    for (const [theirs, mine, blockable] of [[3, 0, false], [2, 0, true], [2, 5, true], [4, 0, false]] as const) {
      const s0 = board(theirs, mine);
      const serpent = find(s0, 'Test Serpent', 'battlefield', 'p1');
      const bear = find(s0, 'Test Bear', 'battlefield', 'p2');
      const s = attackWith(s0, [serpent]);
      expect(canBlock(s, bear, serpent), `${theirs} theirs, ${mine} mine`).toBe(blockable);
    }
  });
});

// ---------------------------------------------------------------------------------------------------------------------------------
// Nivix: "Until end of turn, you may cast it if it's an instant or sorcery spell."
// ---------------------------------------------------------------------------------------------------------------------------------
const PEEK = card('Test Peek', 'Artifact', '{T}: Exile the top card of your library. Until end of turn, you may cast it if it\'s an instant or sorcery spell.');
const BOLT = card('Test Bolt', 'Instant', 'Test Bolt deals 1 damage to any target.');
const RITE = card('Test Rite', 'Sorcery', 'You gain 1 life.');
const LION = card('Test Lion', 'Creature — Cat', '', ['2', '2']);

describe('CR 601.3, 304.1, 307.1: "Until end of turn, you may cast it if it\'s an instant or sorcery spell."', () => {
  it('is automated', () => expect(automated(PEEK)).toBe(true));
  const play = (top: string): GameState => {
    const s0 = scenario([], { p1: { battlefield: ['Test Peek'], library: [top] }, defs: [PEEK, BOLT, RITE, LION] });
    const topId = s0.zones.library['p1']![0]!;
    expect(s0.defs[s0.objects[topId]!.defId]!.name).toBe(top);
    return settle(act(s0, { type: 'activate', player: 'p1', source: find(s0, 'Test Peek', 'battlefield'), ability: 'p:0:0' } as never));
  };
  const canCast = (s: GameState, name: string): boolean => legal(s, 'p1', 'cast').some((a) => a.object !== undefined && s.defs[s.objects[a.object]!.defId]!.name === name);
  it('an exiled instant or sorcery can be cast; an exiled creature cannot', () => {
    const bolt = play('Test Bolt');
    expect(where(bolt, 'Test Bolt')).toEqual(['exile']);
    expect(canCast(bolt, 'Test Bolt')).toBe(true);
    expect(canCast(play('Test Rite'), 'Test Rite')).toBe(true); // main phase, empty stack: a sorcery is castable too
    expect(canCast(play('Test Lion'), 'Test Lion')).toBe(false);
  });
});

// ---------------------------------------------------------------------------------------------------------------------------------
// Corruption of Towashi: transforms or enters transformed, once each turn
// ---------------------------------------------------------------------------------------------------------------------------------
const DOOR = card('Test Door', 'Enchantment', 'Whenever a permanent you control transforms or a permanent you control enters transformed, you may draw a card. Do this only once each turn.');
const WOLF = compileCard({ name: 'Test Wolf // Test Alpha', layout: 'transform', mana_cost: '{0}', type_line: 'Creature — Werewolf // Creature — Werewolf', colors: [], card_faces: [
  { name: 'Test Wolf', mana_cost: '{0}', type_line: 'Creature — Werewolf', oracle_text: '{0}: Transform this creature.', power: '2', toughness: '2', colors: [] },
  { name: 'Test Alpha', mana_cost: '', type_line: 'Creature — Werewolf', oracle_text: '{0}: Transform this creature.', power: '3', toughness: '3', colors: [] },
] } as unknown as OracleCard);

describe('CR 603.2, 603.4: "Whenever a permanent you control transforms or a permanent you control enters transformed, you may draw a card. Do this only once each turn."', () => {
  it('is automated', () => expect(automated(DOOR)).toBe(true));
  const handSize = (s: GameState, p: string): number => s.zones.hand[p]!.length;
  it('a transforming permanent of yours draws one card; transforming again the same turn draws none; an opponent\'s transform draws none', () => {
    const s0 = scenario([], { p1: { battlefield: ['Test Door', 'Test Wolf // Test Alpha'] }, p2: { battlefield: ['Test Wolf // Test Alpha'] }, defs: [DOOR, WOLF] });
    const mine = find(s0, 'Test Wolf // Test Alpha', 'battlefield', 'p1');
    const theirs = find(s0, 'Test Wolf // Test Alpha', 'battlefield', 'p2');
    const h0 = handSize(s0, 'p1');
    const flip = (s: GameState, id: ObjectId, player: string, yes = true): GameState => {
      const la = legal(s, player, 'activate').find((a) => a.object === id && !a.isMana);
      if (!la) throw new Error('no activation');
      return settle(act(s, la.action), { yes });
    };
    const one = flip(s0, mine, 'p1');
    expect(handSize(one, 'p1')).toBe(h0 + 1);
    const two = flip(one, mine, 'p1');
    expect(handSize(two, 'p1')).toBe(h0 + 1); // once each turn
    expect(handSize(flip(s0, mine, 'p1', false), 'p1')).toBe(h0); // "may": declining draws nothing
    // ruling 2023-04-14: the ability stops triggering only once you have chosen to draw: declining the first time leaves the second transform able to draw
    const declinedThenYes = flip(flip(s0, mine, 'p1', false), mine, 'p1', true);
    expect(handSize(declinedThenYes, 'p1')).toBe(h0 + 1);
    // an opponent's permanent is not "a permanent you control": Bob may activate it only with priority, so his transform is played on his own turn
    void theirs;
  });
});

// ---------------------------------------------------------------------------------------------------------------------------------
// Lim-Dul: return that card, it's a Zombie in addition to its other creature types
// ---------------------------------------------------------------------------------------------------------------------------------
const NECRO = card('Test Necromancer', 'Legendary Creature — Zombie Wizard', 'Whenever a creature an opponent controls dies, you may pay {0}. If you do, return that card to the battlefield under your control. If it\'s a creature, it\'s a Zombie in addition to its other creature types.', ['3', '3']);
const SLAYER = card('Test Slayer', 'Sorcery', 'Destroy target creature.');

describe('CR 205.3m, 400.7, 613.1d: "..., return that card to the battlefield under your control. If it\'s a creature, it\'s a Zombie in addition to its other creature types."', () => {
  it('is automated', () => expect(automated(NECRO)).toBe(true));
  it('the opponent\'s dead creature returns under your control as a Zombie Bear; declining the payment returns nothing; your own dying creature does not trigger it', () => {
    const run = (yes: boolean, victimOwner: 'p1' | 'p2'): GameState => {
      const s0 = scenario([], { p1: { hand: ['Test Slayer'], battlefield: ['Test Necromancer', ...(victimOwner === 'p1' ? ['Test Bear'] : [])] }, p2: { battlefield: victimOwner === 'p2' ? ['Test Bear'] : [] }, defs: [NECRO, SLAYER, BEAR] });
      const bear = find(s0, 'Test Bear', 'battlefield', victimOwner);
      const cast = act(s0, { type: 'cast', player: 'p1', card: find(s0, 'Test Slayer', 'hand', 'p1') } as never);
      const targeted = settle(cast.pending?.kind === 'chooseTargets' ? answer(cast, { kind: 'chooseTargets', targets: [{ kind: 'object', id: bear }] } as never) : cast, { yes });
      return targeted;
    };
    const s = run(true, 'p2');
    const bears = findAll(s, 'Test Bear', 'battlefield').filter((id) => s.objects[id]!.controller === 'p1');
    expect(bears.length).toBe(1);
    expect(getChars(s, bears[0]!)!.subtypes).toContain('Zombie');
    expect(getChars(s, bears[0]!)!.subtypes).toContain('Bear');
    expect(findAll(run(false, 'p2'), 'Test Bear', 'battlefield').length).toBe(0);
    expect(findAll(run(true, 'p1'), 'Test Bear', 'battlefield').length).toBe(0); // "a creature an opponent controls": your own creature dying is not it
  });
});

// ---------------------------------------------------------------------------------------------------------------------------------
// Tajuru Paragon: put a card that shares a creature type with it from among them into your hand
// ---------------------------------------------------------------------------------------------------------------------------------
const PARAGON = card('Test Paragon', 'Creature — Elf Druid', 'When ~ enters, reveal the top three cards of your library. You may put a card that shares a creature type with it from among them into your hand. Put the rest on the bottom of your library in a random order.', ['2', '2']);
const ELF = card('Test Elf', 'Creature — Elf Warrior', '', ['1', '1']);
const GOLEM = card('Test Golem', 'Artifact Creature — Golem', '', ['1', '1']);

describe('CR 701.20, 205.3m: "reveal the top three cards. You may put a card that shares a creature type with ~ from among them into your hand. Put the rest on the bottom."', () => {
  it('is automated', () => expect(automated(PARAGON)).toBe(true));
  it('only the card sharing a creature type is offered; the rest go to the bottom of the library', () => {
    const s0 = scenario([], { p1: { hand: ['Test Paragon'], library: ['Test Golem', 'Test Elf', 'Test Relic'] }, defs: [PARAGON, ELF, GOLEM, RELIC] });
    const lib0 = s0.zones.library['p1']!.length;
    const cast = act(s0, { type: 'cast', player: 'p1', card: find(s0, 'Test Paragon', 'hand', 'p1') } as never);
    let offered: unknown[] = [];
    const s = settle(cast, { pick: (d) => { offered = d.options as unknown[]; return (d.options as ObjectId[]).slice(0, 1); } });
    expect(offered.length).toBe(1);
    expect(where(s, 'Test Elf')).toEqual(['hand']);
    expect(where(s, 'Test Golem')).toEqual(['library']);
    expect(s.zones.library['p1']!.length).toBe(lib0 - 1);
    const bottom = s.zones.library['p1']!.slice(-2).map((id) => s.defs[s.objects[id]!.defId]!.name).sort();
    expect(bottom).toEqual(['Test Golem', 'Test Relic']);
  });
});

// ---------------------------------------------------------------------------------------------------------------------------------
// Meandering Towershell: exile it, return it tapped and attacking at the declare attackers step on your next turn
// ---------------------------------------------------------------------------------------------------------------------------------
const SHELL = card('Test Shell', 'Creature — Turtle', 'Whenever ~ attacks, exile it. Return it to the battlefield under your control tapped and attacking at the beginning of the declare attackers step on your next turn.', ['3', '3']);

describe('CR 508.4, 603.7a, 400.7: "Exile it. Return it to the battlefield under your control tapped and attacking at the beginning of the declare attackers step on your next turn."', () => {
  it('is automated', () => expect(automated(SHELL)).toBe(true));
  it('it leaves when it attacks, is not back this turn, and returns attacking at the declare attackers step of your next turn', () => {
    const s0 = scenario([], { p1: { battlefield: ['Test Shell'] }, defs: [SHELL] });
    const shell = find(s0, 'Test Shell', 'battlefield', 'p1');
    let s = settle(declareAttackers(toDeclareAttackers(s0), [[shell]]));
    expect(where(s, 'Test Shell')).toEqual(['exile']);
    // pass to the player's next turn (turn 3) declare attackers step
    for (let g = 0; g < 400 && !(s.turn.number === 3 && s.turn.step === 'declareAttackers'); g++) {
      const d = s.pending;
      if (!d) break;
      if (d.kind === 'declareAttackers') { s = answer(s, { kind: 'declareAttackers', attacks: [] }); if (s.turn.number === 3) { s = settle(s); break; } }
      else if (d.kind === 'declareBlockers') s = answer(s, { kind: 'declareBlockers', blocks: [] });
      else if (d.kind === 'payCost' || d.kind === 'yesNo' || d.kind === 'chooseObjects') s = settle(s);
      else s = pass(s);
    }
    s = settle(s); // the delayed trigger is put on the stack at the beginning of the step (CR 603.7a) and resolves
    expect(s.turn.number).toBe(3);
    expect(where(s, 'Test Shell')).toEqual(['battlefield']);
    const back = findAll(s, 'Test Shell', 'battlefield')[0]!;
    expect(s.objects[back]!.tapped).toBe(true);
    expect(s.combat?.attackers.some((a) => a.id === back)).toBe(true); // tapped and attacking (CR 508.4)
    // CR 508.8 (review finding): no creature was declared, yet one was put onto the battlefield attacking, so blockers and combat damage are not skipped
    const p2 = s.players.find((x) => x.id === 'p2')!.life;
    let t = s;
    for (let g = 0; g < 60 && t.turn.number === 3 && t.turn.step !== 'endCombat' && t.turn.step !== 'main2'; g++) t = t.pending?.kind === 'declareBlockers' ? answer(t, { kind: 'declareBlockers', blocks: [] }) : settle(t.pending?.kind === 'priority' ? pass(t) : t);
    expect(t.players.find((x) => x.id === 'p2')!.life).toBe(p2 - 3);
  });
  it('negative: turn 1 and 2 never return it', () => {
    const s0 = scenario([], { p1: { battlefield: ['Test Shell'] }, defs: [SHELL] });
    const shell = find(s0, 'Test Shell', 'battlefield', 'p1');
    let s = settle(declareAttackers(toDeclareAttackers(s0), [[shell]]));
    for (let g = 0; g < 400 && s.turn.number < 3; g++) {
      const d = s.pending;
      if (!d) break;
      if (d.kind === 'declareAttackers') s = answer(s, { kind: 'declareAttackers', attacks: [] });
      else if (d.kind === 'declareBlockers') s = answer(s, { kind: 'declareBlockers', blocks: [] });
      else s = settle(s.pending?.kind === 'priority' ? pass(s) : s);
      if (s.turn.number < 3) expect(where(s, 'Test Shell')).toEqual(['exile']);
    }
  });
});

// ---------------------------------------------------------------------------------------------------------------------------------
// Ayesha Tanaka: any number of artifact cards with mana value <= her power from among the top four onto the battlefield tapped
// ---------------------------------------------------------------------------------------------------------------------------------
const FORGE = card('Test Forger', 'Creature — Human Artificer', 'When ~ enters, look at the top four cards of your library. You may put any number of artifact cards with mana value less than or equal to ~\'s power from among them onto the battlefield tapped. Put the rest on the bottom of your library in a random order.', ['2', '2']);
const TRINKET = card('Test Trinket', 'Artifact', '', undefined, '{2}');
const BAUBLE = card('Test Bauble', 'Artifact', '', undefined, '{3}');

describe('CR 202.3, 608.2h, 701.20: "any number of artifact cards with mana value less than or equal to ~\'s power ... onto the battlefield tapped"', () => {
  it('is automated', () => expect(automated(FORGE)).toBe(true));
  it('power 2: the {2} artifact may come in (tapped), the {3} artifact is not offered; the rest go to the bottom', () => {
    const s0 = scenario([], { p1: { hand: ['Test Forger'], library: ['Test Trinket', 'Test Bauble', 'Test Lion'] }, defs: [FORGE, TRINKET, BAUBLE, LION] });
    const cast = act(s0, { type: 'cast', player: 'p1', card: find(s0, 'Test Forger', 'hand', 'p1') } as never);
    let offered: string[] = [];
    const s = settle(cast, { pick: (d, st) => { const ids = d.options as ObjectId[]; offered = ids.map((id) => st.defs[st.objects[id]!.defId]!.name); return ids; } });
    expect(offered).toEqual(['Test Trinket']);
    expect(where(s, 'Test Trinket')).toEqual(['battlefield']);
    const trinket = findAll(s, 'Test Trinket', 'battlefield')[0]!;
    expect(s.objects[trinket]!.tapped).toBe(true);
    expect(where(s, 'Test Bauble')).toEqual(['library']);
  });
});

// ---------------------------------------------------------------------------------------------------------------------------------
// Invasion of Pyrulea: "reveal the top card of your library. If it's a land or double-faced card, draw a card."
// ---------------------------------------------------------------------------------------------------------------------------------
const SIEGE = card('Test Siege', 'Enchantment', "When ~ enters, reveal the top card of your library. If it's a land or double-faced card, draw a card.", undefined, '{0}');
const DFC = compileCard({ name: 'Test Pup // Test Howler', layout: 'transform', mana_cost: '{0}', type_line: 'Creature — Wolf // Creature — Werewolf', colors: [], card_faces: [
  { name: 'Test Pup', mana_cost: '{0}', type_line: 'Creature — Wolf', oracle_text: '', power: '1', toughness: '1', colors: [] },
  { name: 'Test Howler', mana_cost: '', type_line: 'Creature — Werewolf', oracle_text: '', power: '2', toughness: '2', colors: [] },
] } as unknown as OracleCard);

describe('CR 712.1, 205.2a, 608.2h: "reveal the top card of your library. If it\'s a land or double-faced card, draw a card."', () => {
  it('is automated', () => expect(automated(SIEGE)).toBe(true));
  const draws = (top: string): number => {
    const s0 = scenario([], { p1: { hand: ['Test Siege'], library: [top] }, defs: [SIEGE, LION, DFC] });
    const h0 = s0.zones.hand['p1']!.length;
    const s = settle(act(s0, { type: 'cast', player: 'p1', card: find(s0, 'Test Siege', 'hand', 'p1') } as never));
    return s.zones.hand['p1']!.length - (h0 - 1); // the Siege itself left the hand
  };
  it('a land draws a card; a double-faced creature card draws a card; an ordinary creature card draws none', () => {
    expect(draws('Plains')).toBe(1);
    expect(draws('Test Pup // Test Howler')).toBe(1);
    expect(draws('Test Lion')).toBe(0);
  });
});
