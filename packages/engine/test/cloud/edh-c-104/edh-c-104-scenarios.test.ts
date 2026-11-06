/**
 * Commander lane edh-c, round edh-c-104 (third pass of EDHREC ranks 27,501 to 28,000): the round's readings played through the engine with synthetic cards (invented
 * names), compiled by the game's default compiler. Alice (p1) casts or controls the card under test. CR cites checked against the Comprehensive Rules of 2026-09-25.
 *
 *   CR 400.3, 404.1       "Return all creatures on the battlefield and all creature cards in graveyards to their owners' hands." (Soulquake)
 *   CR 701.20a, 400.3     "Reveal the top three cards of your library. Target opponent chooses one of those cards. Put that card into your graveyard, then draw two cards." (Thran Tome)
 *   CR 702.142a, 603.2    "Whenever you activate a boast ability, put a +1/+1 counter on this creature." (Frenzied Raider)
 *   CR 406.1, 608.2c      "... You may choose a nonland card from it. If you do, that player exiles that card. If a nonblack card is exiled this way, exile a card from your hand." (Specter's Shriek)
 *   CR 701.20e, 401.4     "Look at target player's hand and choose two cards from it. Put them on top of that player's library in any order." (Agonizing Memories)
 *   CR 101.4, 608.2d      "each other player may put an artifact or enchantment card onto the battlefield from their hand" (Charmed Griffin)
 *   CR 615.1a, 615.7      "The next time a creature of the chosen type would deal damage to you this turn, prevent that damage." (Circle of Solace)
 *   CR 603.10a, 400.7     "exile it if it had a death counter on it. Otherwise, return it to the battlefield under your control and put a death counter on it." (Bogardan Phoenix)
 *   CR 400.3, 404.1       "You may put a creature card that player owns from exile into that player's graveyard." (Memory Theft)
 */
import { describe, expect, it } from 'vitest';
import { activatedAbilities, compileCard, type CardDef, type OracleCard, type GameState, type ObjectId } from '../../../src/index';
import { act, advanceTo, answer, find, pass, put, scenario } from '../../m3/scenario';
import { attackWith, card, cast, counters, full, resolveAll, settle } from '../cmd3/helpers';

const zoneNames = (s: GameState, zone: 'battlefield' | 'hand' | 'graveyard' | 'library' | 'exile', p: string): string[] =>
  (zone === 'battlefield' ? s.zones.battlefield.filter((id) => s.objects[id]!.controller === p)
    : zone === 'exile' ? s.zones.exile.filter((id) => s.objects[id]!.owner === p) : s.zones[zone][p]!).map((id) => s.objects[id]!.defId).filter((n) => n !== 'Plains');

/** Answer every decision in front of us: `pick` may answer one, anything else gets the first minimal answer. */
function drive(s0: GameState, pick: (d: any, s: GameState) => ReturnType<typeof answer> | GameState | undefined = () => undefined): GameState {
  let s = s0;
  for (let guard = 0; guard < 60 && (s.pending && s.pending.kind !== 'priority' || s.zones.stack.length > 0); guard++) {
    if (!s.pending || s.pending.kind === 'priority') { s = pass(s); continue; }
    const d = s.pending as any;
    const r = pick(d, s);
    if (r !== undefined) { s = r as GameState; continue; }
    s = settle(s);
    if (s.pending === d) break;
  }
  return s;
}
const colored = (name: string, type: string, color: 'B' | 'R'): CardDef => compileCard({ name, layout: 'normal', mana_cost: color === 'B' ? '{B}' : '{R}', type_line: type, oracle_text: '', colors: [color], power: '1', toughness: '1' } as OracleCard);
const choose = (ids: ObjectId[]) => (s: GameState) => answer(s, { kind: 'chooseObjects', ids });

describe('CR 400.3, 404.1: "Return all creatures on the battlefield and all creature cards in graveyards to their owners\' hands."', () => {
  const QUAKE = card('Test Quake', 'Sorcery', "Return all creatures on the battlefield and all creature cards in graveyards to their owners' hands.", undefined, '{0}');
  const BEAR = card('Test Bear', 'Creature — Bear', '', ['2', '2']);
  const ROCK = card('Test Rock', 'Artifact', '');
  const DEFS: CardDef[] = [QUAKE, BEAR, ROCK];
  it('is automated', () => expect(full(QUAKE)).toBe(true));
  it('every creature of both players and every creature card of both graveyards goes to its owner\'s hand; other permanents and cards stay', () => {
    let s = scenario([], { p1: { hand: ['Test Quake'], battlefield: ['Test Bear', 'Test Rock'], graveyard: ['Test Bear', 'Test Rock'] }, p2: { battlefield: ['Test Bear'], graveyard: ['Test Bear'] }, defs: DEFS });
    s = advanceTo(s, 3, 'main1');
    s = resolveAll(cast(s, 'Test Quake'));
    expect(zoneNames(s, 'battlefield', 'p1')).toEqual(['Test Rock']);
    expect(zoneNames(s, 'battlefield', 'p2')).toEqual([]);
    expect(zoneNames(s, 'hand', 'p1').sort()).toEqual(['Test Bear', 'Test Bear']);
    expect(zoneNames(s, 'hand', 'p2')).toEqual(['Test Bear', 'Test Bear']);
    expect(zoneNames(s, 'graveyard', 'p1').filter((n) => n === 'Test Rock')).toEqual(['Test Rock']);
    expect(zoneNames(s, 'graveyard', 'p1').includes('Test Bear')).toBe(false);
  });
  it('negative: a creature card in a hand or in exile is not moved', () => {
    let s = scenario([], { p1: { hand: ['Test Quake', 'Test Bear'], exile: ['Test Bear'] }, p2: {}, defs: DEFS });
    s = advanceTo(s, 3, 'main1');
    s = resolveAll(cast(s, 'Test Quake'));
    expect(zoneNames(s, 'hand', 'p1')).toEqual(['Test Bear']);
    expect(zoneNames(s, 'exile', 'p1')).toEqual(['Test Bear']);
  });
});

describe('CR 701.20a, 400.3: "Reveal the top three cards of your library. Target opponent chooses one of those cards. Put that card into your graveyard, then draw two cards."', () => {
  const TOME = card('Test Tome', 'Artifact — Book', '{T}: Reveal the top three cards of your library. Target opponent chooses one of those cards. Put that card into your graveyard, then draw two cards.', undefined, '{0}');
  const A = card('Test Alpha', 'Creature — Bear', '', ['1', '1']);
  const B = card('Test Beta', 'Creature — Bear', '', ['1', '1']);
  const C = card('Test Gamma', 'Creature — Bear', '', ['1', '1']);
  const D = card('Test Delta', 'Creature — Bear', '', ['1', '1']);
  const E = card('Test Epsilon', 'Creature — Bear', '', ['1', '1']);
  const DEFS: CardDef[] = [TOME, A, B, C, D, E];
  it('is automated', () => expect(full(TOME)).toBe(true));
  it('the opponent picks one of the three revealed cards; it goes to your graveyard; the other two stay and you draw two', () => {
    let s = scenario([], { p1: { battlefield: ['Test Tome'], library: ['Test Alpha', 'Test Beta', 'Test Gamma', 'Test Delta', 'Test Epsilon'] }, p2: {}, defs: DEFS });
    s = advanceTo(s, 3, 'main1');
    const tome = find(s, 'Test Tome', 'battlefield', 'p1');
    const hand0 = s.zones.hand.p1!.length;
    s = act(s, { type: 'activate', player: 'p1', source: tome, ability: activatedAbilities(s, s.objects[tome]!)[0]!.key } as any);
    let chosen: string | undefined;
    s = drive(s, (d, st) => {
      if (d.kind === 'chooseTargets') return answer(st, { kind: 'chooseTargets', targets: [{ kind: 'player', id: 'p2' }] });
      if (d.kind === 'chooseObjects') { expect(d.player).toBe('p2'); expect(d.options.length).toBe(3); chosen = st.objects[d.options[1]]!.defId; return answer(st, { kind: 'chooseObjects', ids: [d.options[1]] }); }
      return undefined;
    });
    expect(chosen).toBeDefined();
    expect(zoneNames(s, 'graveyard', 'p1')).toEqual([chosen]);
    expect(s.zones.hand.p1!.length - hand0).toBe(2);
  });
});

describe('CR 702.142a, 603.2: "Whenever you activate a boast ability, put a +1/+1 counter on this creature."', () => {
  const RAIDER = card('Test Raider', 'Creature — Orc', 'Whenever you activate a boast ability, put a +1/+1 counter on this creature.\nBoast — {0}: Draw a card. (Activate only if this creature attacked this turn and only once each turn.)\n{0}: Scry 1.', ['2', '2']);
  const FILL = card('Test Filler', 'Creature — Bear', '', ['1', '1']);
  const DEFS: CardDef[] = [RAIDER, FILL];
  it('is automated', () => expect(full(RAIDER)).toBe(true));
  it('activating the boast ability after attacking puts a counter; activating another ability does not', () => {
    let s = scenario([], { p1: { battlefield: ['Test Raider'], library: ['Test Filler', 'Test Filler', 'Test Filler'] }, p2: {}, defs: DEFS });
    s = advanceTo(s, 3, 'main1');
    const raider = find(s, 'Test Raider', 'battlefield', 'p1');
    const abilities = activatedAbilities(s, s.objects[raider]!);
    expect(abilities.length).toBe(2);
    const scryIdx = abilities.find((a) => (a.def as { keyword?: string }).keyword !== 'boast')?.key;
    expect(scryIdx).toBeDefined();
    // the plain ability first: no counter
    s = resolveAll(act(s, { type: 'activate', player: 'p1', source: raider, ability: scryIdx! } as any));
    s = drive(s);
    expect(counters(s, raider, '+1/+1')).toBe(0);
    s = attackWith(s, [raider]);
    s = drive(s);
    s = advanceTo(s, 3, 'main2');
    const boast = activatedAbilities(s, s.objects[raider]!).find((a) => a.key !== scryIdx)!;
    s = resolveAll(act(s, { type: 'activate', player: 'p1', source: raider, ability: boast.key } as any));
    s = drive(s);
    expect(counters(s, raider, '+1/+1')).toBe(1);
  });
});

describe('CR 406.1, 608.2c: Specter\'s Shriek reading', () => {
  const SHRIEK = card('Test Shriek', 'Sorcery', 'Target opponent reveals their hand. You may choose a nonland card from it. If you do, that player exiles that card. If a nonblack card is exiled this way, exile a card from your hand.', undefined, '{0}');
  const LAND = card('Test Land', 'Land', '');
  const RED = colored('Test Red', 'Creature — Bear', 'R');
  const BLACK = colored('Test Black', 'Creature — Bear', 'B');
  const SPARE = card('Test Spare', 'Creature — Bear', '', ['1', '1']);
  const mk = (): CardDef[] => [SHRIEK, LAND, RED, BLACK, SPARE];
  it('is automated', () => expect(full(SHRIEK)).toBe(true));
  it('negative: declining the choice exiles nothing; choosing a land is not offered', () => {
    let s = scenario([], { p1: { hand: ['Test Shriek', 'Test Spare'] }, p2: { hand: ['Test Land', 'Test Black'] }, defs: mk() });
    s = advanceTo(s, 3, 'main1');
    s = act(s, { type: 'cast', player: 'p1', card: find(s, 'Test Shriek', 'hand', 'p1') });
    s = drive(s, (d, st) => {
      if (d.kind === 'chooseTargets') return answer(st, { kind: 'chooseTargets', targets: [{ kind: 'player', id: 'p2' }] });
      if (d.kind === 'chooseObjects') { expect(d.options.map((o: string) => st.objects[o]!.defId)).toEqual(['Test Black']); return answer(st, { kind: 'chooseObjects', ids: [] }); }
      return undefined;
    });
    expect(zoneNames(s, 'hand', 'p2').sort()).toEqual(['Test Black', 'Test Land']);
    expect(zoneNames(s, 'hand', 'p1')).toEqual(['Test Spare']);
  });
  it('a black card chosen is exiled from their hand and nothing else is exiled', () => {
    let s = scenario([], { p1: { hand: ['Test Shriek', 'Test Spare'] }, p2: { hand: ['Test Land', 'Test Black'] }, defs: mk() });
    s = advanceTo(s, 3, 'main1');
    s = act(s, { type: 'cast', player: 'p1', card: find(s, 'Test Shriek', 'hand', 'p1') });
    s = drive(s, (d, st) => {
      if (d.kind === 'chooseTargets') return answer(st, { kind: 'chooseTargets', targets: [{ kind: 'player', id: 'p2' }] });
      if (d.kind === 'chooseObjects') return answer(st, { kind: 'chooseObjects', ids: d.options.slice(0, 1) });
      return undefined;
    });
    expect(zoneNames(s, 'exile', 'p2')).toEqual(['Test Black']);
    expect(zoneNames(s, 'hand', 'p2')).toEqual(['Test Land']);
    expect(zoneNames(s, 'hand', 'p1')).toEqual(['Test Spare']);
    expect(zoneNames(s, 'exile', 'p1')).toEqual([]);
  });
  it('a nonblack card chosen is exiled and you exile a card from your hand', () => {
    let s = scenario([], { p1: { hand: ['Test Shriek', 'Test Spare'] }, p2: { hand: ['Test Land', 'Test Red'] }, defs: mk() });
    s = advanceTo(s, 3, 'main1');
    s = act(s, { type: 'cast', player: 'p1', card: find(s, 'Test Shriek', 'hand', 'p1') });
    s = drive(s, (d, st) => {
      if (d.kind === 'chooseTargets') return answer(st, { kind: 'chooseTargets', targets: [{ kind: 'player', id: 'p2' }] });
      if (d.kind === 'chooseObjects') return answer(st, { kind: 'chooseObjects', ids: d.options.slice(0, 1) });
      return undefined;
    });
    expect(zoneNames(s, 'exile', 'p2')).toEqual(['Test Red']);
    expect(zoneNames(s, 'exile', 'p1')).toEqual(['Test Spare']);
  });
});

describe('CR 701.20e, 401.4: "Look at target player\'s hand and choose two cards from it. Put them on top of that player\'s library in any order."', () => {
  const MEM = card('Test Memories', 'Sorcery', "Look at target player's hand and choose two cards from it. Put them on top of that player's library in any order.", undefined, '{0}');
  const mkc = (n: string) => card(n, 'Creature — Bear', '', ['1', '1']);
  const DEFS: CardDef[] = [MEM, mkc('Test Aa'), mkc('Test Bb'), mkc('Test Cc'), mkc('Test Dd')];
  it('is automated', () => expect(full(MEM)).toBe(true));
  it('exactly two cards of the target player\'s hand go on top of their library; the third stays in hand', () => {
    let s = scenario([], { p1: { hand: ['Test Memories'] }, p2: { hand: ['Test Aa', 'Test Bb', 'Test Cc'] }, defs: DEFS });
    s = advanceTo(s, 3, 'main1');
    put(s, 'p2', 'library', 'Test Dd');
    s = act(s, { type: 'cast', player: 'p1', card: find(s, 'Test Memories', 'hand', 'p1') });
    const handIds = s.zones.hand.p2!.filter((id) => s.objects[id]!.defId !== 'Plains');
    s = drive(s, (d, st) => {
      if (d.kind === 'chooseTargets') return answer(st, { kind: 'chooseTargets', targets: [{ kind: 'player', id: 'p2' }] });
      if (d.kind === 'chooseObjects') { expect(d.player).toBe('p1'); expect(d.min).toBe(2); expect(d.max).toBe(2); return answer(st, { kind: 'chooseObjects', ids: [handIds[0]!, handIds[2]!] }); }
      return undefined;
    });
    expect(zoneNames(s, 'hand', 'p2')).toEqual(['Test Bb']);
    expect(s.zones.library.p2!.slice(0, 2).map((id) => s.objects[id]!.defId).sort()).toEqual(['Test Aa', 'Test Cc']);
    expect(zoneNames(s, 'hand', 'p1')).toEqual([]);
  });
});

describe('CR 101.4, 608.2d: "each other player may put an artifact or enchantment card onto the battlefield from their hand"', () => {
  const GRIFFIN = card('Test Griffin', 'Creature — Griffin', 'When this creature enters, each other player may put an artifact or enchantment card onto the battlefield from their hand.', ['2', '2'], '{0}');
  const ROCK = card('Test Rock', 'Artifact', '');
  const AURA = card('Test Wall', 'Enchantment', '');
  const BEAR = card('Test Bear', 'Creature — Bear', '', ['2', '2']);
  const DEFS: CardDef[] = [GRIFFIN, ROCK, AURA, BEAR];
  it('is automated', () => expect(full(GRIFFIN)).toBe(true));
  it('the opponent puts the artifact they choose onto the battlefield under their control; a creature card is not offered; you put nothing', () => {
    let s = scenario([], { p1: { hand: ['Test Griffin', 'Test Rock'] }, p2: { hand: ['Test Rock', 'Test Bear'] }, defs: DEFS });
    s = advanceTo(s, 3, 'main1');
    s = act(s, { type: 'cast', player: 'p1', card: find(s, 'Test Griffin', 'hand', 'p1') });
    s = drive(s, (d, st) => {
      if (d.kind === 'chooseObjects') { expect(d.player).toBe('p2'); expect(d.options.map((o: string) => st.objects[o]!.defId)).toEqual(['Test Rock']); return answer(st, { kind: 'chooseObjects', ids: d.options.slice(0, 1) }); }
      return undefined;
    });
    expect(zoneNames(s, 'battlefield', 'p2')).toEqual(['Test Rock']);
    expect(zoneNames(s, 'hand', 'p2')).toEqual(['Test Bear']);
    expect(zoneNames(s, 'hand', 'p1')).toEqual(['Test Rock']);
  });
  it('negative: declining puts nothing onto the battlefield', () => {
    let s = scenario([], { p1: { hand: ['Test Griffin'] }, p2: { hand: ['Test Wall'] }, defs: DEFS });
    s = advanceTo(s, 3, 'main1');
    s = act(s, { type: 'cast', player: 'p1', card: find(s, 'Test Griffin', 'hand', 'p1') });
    s = drive(s, (d, st) => (d.kind === 'chooseObjects' ? answer(st, { kind: 'chooseObjects', ids: [] }) : undefined));
    expect(zoneNames(s, 'battlefield', 'p2')).toEqual([]);
    expect(zoneNames(s, 'hand', 'p2')).toEqual(['Test Wall']);
  });
});

describe('CR 615.1a, 615.7: "The next time a creature of the chosen type would deal damage to you this turn, prevent that damage."', () => {
  const CIRCLE = card('Test Circle', 'Enchantment', 'As this enchantment enters, choose a creature type.\n{0}: The next time a creature of the chosen type would deal damage to you this turn, prevent that damage.', undefined, '{0}');
  const GOB = card('Test Goblin', 'Creature — Goblin', '{0}: This creature deals 3 damage to target player.', ['3', '3']);
  const ELF = card('Test Elf', 'Creature — Elf', '{0}: This creature deals 2 damage to target player.', ['2', '2']);
  const DEFS: CardDef[] = [CIRCLE, GOB, ELF];
  it('is automated', () => expect(full(CIRCLE)).toBe(true));
  it('the first damage of a creature of the chosen type is prevented, the next creature of the type is not; another type is never prevented', () => {
    let s = scenario([], { p1: { hand: ['Test Circle'], battlefield: ['Test Goblin', 'Test Goblin', 'Test Elf'] }, p2: {}, defs: DEFS });
    s = advanceTo(s, 3, 'main1');
    s = act(s, { type: 'cast', player: 'p1', card: find(s, 'Test Circle', 'hand', 'p1') });
    s = drive(s, (d, st) => (d.kind === 'chooseName' ? answer(st, { kind: 'chooseName', name: 'Goblin' }) : undefined));
    const circle = find(s, 'Test Circle', 'battlefield', 'p1');
    s = drive(act(s, { type: 'activate', player: 'p1', source: circle, ability: activatedAbilities(s, s.objects[circle]!)[0]!.key } as any));
    const life = (st: GameState): number => st.players.find((p) => p.id === 'p1')!.life;
    const hit = (st: GameState, id: ObjectId): GameState => drive(act(st, { type: 'activate', player: 'p1', source: id, ability: activatedAbilities(st, st.objects[id]!)[0]!.key } as any), (d, x) => (d.kind === 'chooseTargets' ? answer(x, { kind: 'chooseTargets', targets: [{ kind: 'player', id: 'p1' }] }) : undefined));
    const [g1, g2] = s.zones.battlefield.filter((id) => s.objects[id]!.defId === 'Test Goblin');
    const elf = find(s, 'Test Elf', 'battlefield', 'p1');
    const start = life(s);
    s = hit(s, elf);
    expect(life(s)).toBe(start - 2); // an Elf is not a Goblin: not prevented, and the shield is kept
    s = hit(s, g1!);
    expect(life(s)).toBe(start - 2); // the first Goblin's damage is prevented
    s = hit(s, g2!);
    expect(life(s)).toBe(start - 5); // the shield was one use
  });
});

describe('CR 603.10a, 400.7: "exile it if it had a death counter on it. Otherwise, return it to the battlefield under your control and put a death counter on it."', () => {
  const PHX = card('Test Phoenix', 'Creature — Phoenix', 'When this creature dies, exile it if it had a death counter on it. Otherwise, return it to the battlefield under your control and put a death counter on it.', ['2', '2']);
  const BOLT = card('Test Bolt', 'Instant', 'Destroy target creature.', undefined, '{0}');
  const DEFS: CardDef[] = [PHX, BOLT];
  it('is automated', () => expect(full(PHX)).toBe(true));
  it('the first death returns it with a death counter; the second death exiles it', () => {
    let s = scenario([], { p1: { hand: ['Test Bolt', 'Test Bolt'], battlefield: ['Test Phoenix'] }, p2: {}, defs: DEFS });
    s = advanceTo(s, 3, 'main1');
    const kill = (st: GameState): GameState => {
      const target = st.zones.battlefield.find((id) => st.objects[id]!.defId === 'Test Phoenix')!;
      let x = settle(act(st, { type: 'cast', player: 'p1', card: find(st, 'Test Bolt', 'hand', 'p1') }), { targets: [{ kind: 'object', id: target }] });
      x = resolveAll(x);
      return drive(x);
    };
    s = kill(s);
    const back = s.zones.battlefield.filter((id) => s.objects[id]!.defId === 'Test Phoenix');
    expect(back.length).toBe(1);
    expect(counters(s, back[0]!, 'death')).toBe(1);
    s = kill(s);
    expect(s.zones.battlefield.filter((id) => s.objects[id]!.defId === 'Test Phoenix').length).toBe(0);
    expect(zoneNames(s, 'exile', 'p1')).toEqual(['Test Phoenix']);
  });
});

describe('CR 400.3, 404.1: "You may put a creature card that player owns from exile into that player\'s graveyard."', () => {
  const THEFT = card('Test Theft', 'Sorcery', 'Target opponent reveals their hand. You choose a nonland card from it. That player discards that card. You may put a creature card that player owns from exile into that player\'s graveyard.', undefined, '{0}');
  const BEAR = card('Test Bear', 'Creature — Bear', '', ['2', '2']);
  const ROCK = card('Test Rock', 'Artifact', '');
  const DEFS: CardDef[] = [THEFT, BEAR, ROCK];
  it('is automated', () => expect(full(THEFT)).toBe(true));
  it('the opponent\'s exiled creature card goes to their graveyard; your own exiled creature card is not offered', () => {
    let s = scenario([], { p1: { hand: ['Test Theft'], exile: ['Test Bear'] }, p2: { hand: ['Test Rock'], exile: ['Test Bear'] }, defs: DEFS });
    s = advanceTo(s, 3, 'main1');
    s = act(s, { type: 'cast', player: 'p1', card: find(s, 'Test Theft', 'hand', 'p1') });
    s = drive(s, (d, st) => {
      if (d.kind === 'chooseTargets') return answer(st, { kind: 'chooseTargets', targets: [{ kind: 'player', id: 'p2' }] });
      if (d.kind === 'chooseObjects') return answer(st, { kind: 'chooseObjects', ids: d.options.slice(0, 1) });
      if (d.kind === 'yesNo') return answer(st, { kind: 'yesNo', yes: true });
      return undefined;
    });
    expect(zoneNames(s, 'graveyard', 'p2').sort()).toEqual(['Test Bear', 'Test Rock']);
    expect(zoneNames(s, 'exile', 'p1')).toEqual(['Test Bear']);
    expect(zoneNames(s, 'exile', 'p2')).toEqual([]);
  });
  it('negative: a face-down exiled card is never offered', () => {
    const ADV = card('Test Adv', 'Creature — Bear', '', ['2', '2']);
    let s = scenario([], { p1: { hand: ['Test Theft'] }, p2: { hand: ['Test Rock'] }, defs: [...DEFS, ADV] });
    s = advanceTo(s, 3, 'main1');
    const id = put(s, 'p2', 'exile', 'Test Bear');
    s.objects[id]!.faceDown = true;
    s = act(s, { type: 'cast', player: 'p1', card: find(s, 'Test Theft', 'hand', 'p1') });
    s = drive(s, (d, st) => {
      if (d.kind === 'chooseTargets') return answer(st, { kind: 'chooseTargets', targets: [{ kind: 'player', id: 'p2' }] });
      if (d.kind === 'chooseObjects') return answer(st, { kind: 'chooseObjects', ids: d.options.slice(0, 1) });
      return undefined;
    });
    expect(s.zones.exile.includes(id)).toBe(true);
  });
});
