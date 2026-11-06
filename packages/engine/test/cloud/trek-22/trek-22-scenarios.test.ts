/**
 * trek-22 (lane trek-22, coordinator D): the readings of the round played through the engine with synthetic cards (invented names and wordings, design 6.10), compiled by the game's
 * default compiler. Each test is named after the rule it checks, with its negative case. CR cites are checked against the 2026-09-25 text unless the record lists them as unverified.
 *
 *   CR 201.5c          "Whenever Lieutenant Sulu becomes tapped, he explores." (Lieutenant Hikaru Sulu): the short name "Lieutenant Sulu" and the pronoun are the creature itself
 *   CR 115.1, 113.7a   "can't be the target of abilities from artifact sources your opponents control." (Species 8472): abilities only, artifact sources only, opponents' only
 *   CR 607.2a, 108.3   "return each creature card you own exiled with it to the battlefield." (S.S. Botany Bay): only the creature cards its own ability exiled, and only the ones you own
 *   CR 702.26b-c       "it and up to one target creature you control phase out." (U.S.S. Defiant, Mirror Migrant)
 *   CR 119.3, 608.2c   "each opponent loses life equal to the life that player lost this turn. You gain life equal to the life lost this way." (Gul Dukat, Colonial Prefect)
 *   CR 603.2, 701.20   "put a +1/+1 counter on it, then reveal cards ... until you reveal a land card" after "enters or attacks" (Janice Rand, Essential Aide)
 *   CR 701.14a, 603.7  "You may have the chosen creatures fight each other. Whenever a creature that fought this way dies this turn, you draw a card." (T'Pring, Never Parted)
 */
import { describe, expect, it } from 'vitest';
import { compileCard, type CardDef, type GameState, type OracleCard } from '../../../src/index';
import { act, advanceTo, answer, find, pass, scenario } from '../../m3/scenario';
import { lifeOf, mpScenario, passUntil, resolveStack } from '../../m12/rules/helpers';
import { castWith } from '../../m6/costs/support';

function card(name: string, type: string, text: string, cost = '{0}', extra: Partial<OracleCard> = {}): CardDef {
  return compileCard({ name, layout: 'normal', mana_cost: cost, type_line: type, oracle_text: text, colors: [], keywords: [], ...extra } as OracleCard);
}
const PT = { power: '2', toughness: '2' };
const nm = (s: GameState, id: string): string => s.defs[s.objects[id]!.defId]?.name ?? '?';
const idOn = (s: GameState, name: string, player?: string): string => s.zones.battlefield.find((id) => nm(s, id) === name && (player === undefined || s.objects[id]!.controller === player))!;
const onBf = (s: GameState, name: string): boolean => s.zones.battlefield.some((id) => nm(s, id) === name);
const inGy = (s: GameState, p: string, name: string): boolean => (s.zones.graveyard[p] ?? []).some((id) => nm(s, id) === name);
const inExile = (s: GameState, name: string): boolean => s.zones.exile.some((id) => nm(s, id) === name);
const handSize = (s: GameState, p: string): number => (s.zones.hand[p] ?? []).length;
const life = (s: GameState, p: string): number => s.players.find((x) => x.id === p)!.life;
const full = (d: CardDef): boolean => d.automation.level === 'full' && !JSON.stringify(d.faces).includes('"op":"manual"') && d.faces.every((f) => f.abilities.every((a) => a.kind !== 'manual'));

/** Answer decisions until the stack is empty and only priority is pending (yes to every may unless `yes` is false; the first option of a choice; the first legal target). */
function settle(s0: GameState, yes = true, prefer = 'p2'): GameState {
  let s = s0;
  for (let guard = 0; guard < 150 && (s.zones.stack.length > 0 || (s.pending && s.pending.kind !== 'priority')); guard++) {
    const d = s.pending!;
    if (d.kind === 'priority') s = pass(s);
    else if (d.kind === 'payCost') s = answer(s, { kind: 'payCost', auto: true });
    else if (d.kind === 'yesNo') s = answer(s, { kind: 'yesNo', yes });
    else if (d.kind === 'chooseObjects') s = answer(s, { kind: 'chooseObjects', ids: (d as unknown as { options: string[] }).options.slice(0, 1) });
    else if (d.kind === 'chooseTargets') {
      const t = d as unknown as { objects: string[]; players: string[] };
      s = answer(s, { kind: 'chooseTargets', targets: [t.objects.length > 0 ? { kind: 'object', id: t.objects[0]! } : { kind: 'player', id: t.players.includes(prefer) ? prefer : t.players[0]! }] });
    } else throw new Error(`unexpected decision ${d.kind}`);
  }
  return s;
}

// ---- the cards -------------------------------------------------------------------------------------------------------------------------------------------------------------
const SULU = card('Lieutenant Test Sulu', 'Legendary Creature — Human Pilot', 'Whenever Lieutenant Sulu becomes tapped, he explores.', '{0}', PT);
const BEAR = card('Test Bear', 'Creature — Bear', '', '{0}', PT);
const OGRE = card('Test Ogre', 'Creature — Ogre', '', '{0}', { power: '4', toughness: '4' });
const WARD = card('Test Ward Insect', 'Creature — Insect Beast', "This creature can't be the target of abilities from artifact sources your opponents control.", '{0}', PT);
const ARTI_PINGER = card('Test Artifact Pinger', 'Artifact Creature — Construct', '{0}: Test Artifact Pinger deals 1 damage to target creature.', '{0}', { power: '1', toughness: '1' });
const PINGER = card('Test Pinger', 'Creature — Wizard', '{0}: Test Pinger deals 1 damage to target creature.', '{0}', { power: '1', toughness: '1' });
const ARTI_BOLT = card('Test Artifact Trinket', 'Artifact', '{0}: Test Artifact Trinket deals 1 damage to target creature.', '{0}');
const HULL = card('Test Hull', 'Artifact Creature — Vehicle', "{0}: Each opponent exiles a card from their graveyard. You may exile a card from your graveyard.\nWhenever Test Hull deals combat damage to a player, return each creature card you own exiled with it to the battlefield.", '{0}', { power: '2', toughness: '2' });
const DEFIANT = card('Test Defiant', 'Artifact Creature — Spacecraft', 'Flash\nWhen Test Defiant enters, it and up to one target creature you control phase out.', '{0}', PT);
const PREFECT = card('Test Prefect', 'Legendary Creature — Cardassian', 'At the beginning of each end step, each opponent loses life equal to the life that player lost this turn. You gain life equal to the life lost this way.', '{0}', PT);
const RAND = card('Test Aide', 'Legendary Creature — Human', 'Whenever a creature you control enters or attacks, put a +1/+1 counter on it, then reveal cards from the top of your library until you reveal a land card. Put that card onto the battlefield tapped and the rest on the bottom of your library in a random order.', '{0}', PT);
const PAIR = card('Test Pair', 'Creature — Vulcan', 'When this creature enters, choose another target creature you control and target creature an opponent controls. You may have the chosen creatures fight each other. Whenever a creature that fought this way dies this turn, you draw a card.', '{0}', PT);
const SMITE = card('Test Smite', 'Instant', 'Destroy target creature.', '{0}');
const SIPHON2 = card('Test Siphon Two', 'Sorcery', 'Target player loses 2 life.', '{0}');
const SIPHON5 = card('Test Siphon Five', 'Sorcery', 'Target player loses 5 life.', '{0}');
const DEFS = [SULU, BEAR, OGRE, WARD, ARTI_PINGER, PINGER, ARTI_BOLT, HULL, DEFIANT, PREFECT, RAND, PAIR, SMITE, SIPHON2, SIPHON5];

describe('trek-22: the readings are automated', () => {
  it('every synthetic card compiles to a full card with no manual ability', () => {
    for (const d of DEFS) expect(full(d), `${d.name}: ${JSON.stringify(d.automation)}`).toBe(true);
  });
  it('the printed texts of the seven cards of the round compile to full cards (the real wordings, with the cards\' own names)', () => {
    const real: [string, string, string, Partial<OracleCard>][] = [
      ['Lieutenant Hikaru Sulu', 'Legendary Creature — Human Pilot', 'Whenever Lieutenant Sulu becomes tapped, he explores.\n{2}{U}: Target creature can\'t be blocked this turn.', PT],
      ['Species 8472', 'Creature — Insect Beast', "When this creature enters, you gain life equal to the number of differently named lands you control.\nThis creature can't be blocked by artifact creatures.\nThis creature can't be the target of abilities from artifact sources your opponents control.", PT],
    ];
    for (const [name, type, text, extra] of real) {
      const d = card(name, type, text, '{1}{U}', extra);
      expect(d.faces[0]!.abilities.filter((a) => a.kind === 'manual'), name).toEqual([]);
    }
  });
});

describe('CR 201.5c, 603.2: "Whenever Lieutenant Sulu becomes tapped, he explores."', () => {
  it('when it attacks and becomes tapped it explores: a land card on top goes to its owner\'s hand', () => {
    let s = scenario([], { p1: { battlefield: ['Lieutenant Test Sulu'], library: ['Plains'] }, defs: DEFS });
    const before = handSize(s, 'p1');
    s = act(s, { type: 'pass', player: 'p1' });
    s = advanceTo(s, 1, 'declareAttackers');
    s = settle(answer(s, { kind: 'declareAttackers', attacks: [{ attacker: idOn(s, 'Lieutenant Test Sulu'), defender: 'p2' }] }));
    expect(handSize(s, 'p1')).toBe(before + 1);
    expect(s.objects[idOn(s, 'Lieutenant Test Sulu')]!.counters['+1/+1'] ?? 0).toBe(0);
  });
  it('a nonland card on top: it gets a +1/+1 counter and the card may stay on top or go to the graveyard', () => {
    let s = scenario([], { p1: { battlefield: ['Lieutenant Test Sulu'], library: ['Test Bear'] }, defs: DEFS });
    s = advanceTo(s, 1, 'declareAttackers');
    s = settle(answer(s, { kind: 'declareAttackers', attacks: [{ attacker: idOn(s, 'Lieutenant Test Sulu'), defender: 'p2' }] }));
    expect(s.objects[idOn(s, 'Lieutenant Test Sulu')]!.counters['+1/+1']).toBe(1);
  });
  it('negative: another creature of the same player becoming tapped does not make it explore', () => {
    let s = scenario([], { p1: { battlefield: ['Lieutenant Test Sulu', 'Test Bear'], library: ['Plains'] }, defs: DEFS });
    const before = handSize(s, 'p1');
    s = advanceTo(s, 1, 'declareAttackers');
    s = settle(answer(s, { kind: 'declareAttackers', attacks: [{ attacker: idOn(s, 'Test Bear'), defender: 'p2' }] }));
    expect(handSize(s, 'p1')).toBe(before);
  });
});

describe('CR 115.1, 113.7a: "This creature can\'t be the target of abilities from artifact sources your opponents control." (Species 8472)', () => {
  const targetsOf = (s: GameState, player: string, source: string): string[] => {
    try {
      let u = act(s, { type: 'activate', player, source, ability: 'p:0:0' } as never);
      while (u.pending && u.pending.kind === 'payCost') u = answer(u, { kind: 'payCost', auto: true });
      return u.pending?.kind === 'chooseTargets' ? (u.pending as unknown as { objects: string[] }).objects : [];
    } catch { return []; }
  };
  it('an opponent\'s artifact creature\'s ability and an opponent\'s artifact\'s ability can\'t target it', () => {
    const s = scenario([], { p1: { battlefield: ['Test Ward Insect', 'Test Bear'] }, p2: { battlefield: ['Test Artifact Pinger', 'Test Artifact Trinket'] }, defs: DEFS });
    const t = advanceTo(s, 2, 'main1');
    const bear = idOn(t, 'Test Bear');
    const insect = idOn(t, 'Test Ward Insect');
    const viaCreature = targetsOf(t, 'p2', idOn(t, 'Test Artifact Pinger'));
    expect(viaCreature).toContain(bear);
    expect(viaCreature).not.toContain(insect);
    const viaArtifact = targetsOf(t, 'p2', idOn(t, 'Test Artifact Trinket'));
    expect(viaArtifact).toContain(bear);
    expect(viaArtifact).not.toContain(insect);
  });
  it('negative: an opponent\'s ability from a source that is not an artifact can target it', () => {
    const s = scenario([], { p1: { battlefield: ['Test Ward Insect'] }, p2: { battlefield: ['Test Pinger'] }, defs: DEFS });
    const t = advanceTo(s, 2, 'main1');
    expect(targetsOf(t, 'p2', idOn(t, 'Test Pinger'))).toContain(idOn(t, 'Test Ward Insect'));
  });
  it('negative: its controller\'s own artifact\'s ability can target it', () => {
    const s = scenario([], { p1: { battlefield: ['Test Ward Insect', 'Test Artifact Trinket'] }, defs: DEFS });
    expect(targetsOf(s, 'p1', idOn(s, 'Test Artifact Trinket'))).toContain(idOn(s, 'Test Ward Insect'));
  });
});

describe('CR 607.2a, 108.3: "return each creature card you own exiled with it to the battlefield." (S.S. Botany Bay)', () => {
  const setup = (): GameState => scenario([], { p1: { battlefield: ['Test Hull'], graveyard: ['Test Bear', 'Plains'] }, p2: { graveyard: ['Test Ogre'] }, defs: DEFS });
  it('the creature cards you exiled with it come back on combat damage; the opponent\'s card stays exiled', () => {
    let s = setup();
    s = settle(act(s, { type: 'activate', player: 'p1', source: idOn(s, 'Test Hull'), ability: 'p:0:0' } as never));
    expect(inExile(s, 'Test Ogre')).toBe(true);
    expect(inExile(s, 'Test Bear')).toBe(true);
    s = advanceTo(s, 2, 'main1');
    s = advanceTo(s, 3, 'declareAttackers');
    s = answer(s, { kind: 'declareAttackers', attacks: [{ attacker: idOn(s, 'Test Hull'), defender: 'p2' }] });
    s = settle(advanceTo(s, 3, 'endCombat'));
    expect(onBf(s, 'Test Bear')).toBe(true);
    expect(inExile(s, 'Test Ogre')).toBe(true); // owned by the opponent: not returned
    expect(onBf(s, 'Test Ogre')).toBe(false);
  });
  it('negative: a creature card that was exiled by something else is not returned, and a land exiled with it is not a creature card', () => {
    let s = scenario([], { p1: { battlefield: ['Test Hull'], graveyard: ['Plains'] }, p2: { graveyard: [] }, defs: DEFS });
    s = settle(act(s, { type: 'activate', player: 'p1', source: idOn(s, 'Test Hull'), ability: 'p:0:0' } as never));
    expect(inExile(s, 'Plains')).toBe(true);
    s = advanceTo(s, 2, 'main1');
    s = advanceTo(s, 3, 'declareAttackers');
    s = answer(s, { kind: 'declareAttackers', attacks: [{ attacker: idOn(s, 'Test Hull'), defender: 'p2' }] });
    s = settle(advanceTo(s, 3, 'endCombat'));
    expect(inExile(s, 'Plains')).toBe(true);
  });
});

describe('CR 702.26b-c: "When this creature enters, it and up to one target creature you control phase out." (U.S.S. Defiant, Mirror Migrant)', () => {
  it('it and the chosen creature phase out; a creature that was not chosen stays', () => {
    let s = scenario([], { p1: { hand: ['Test Defiant'], battlefield: ['Test Bear', 'Test Ogre'] }, defs: DEFS });
    s = settle(act(s, { type: 'cast', player: 'p1', card: find(s, 'Test Defiant', 'hand', 'p1') }));
    const defiant = Object.values(s.objects).find((o) => nm(s, o.id) === 'Test Defiant')!;
    expect(defiant.phasedOut).toBe(true);
    const phased = Object.values(s.objects).filter((o) => o.phasedOut && nm(s, o.id) !== 'Test Defiant').map((o) => nm(s, o.id));
    expect(phased).toHaveLength(1); // the first legal target was chosen: exactly one other creature phased out
    const stayed = Object.values(s.objects).filter((o) => !o.phasedOut && (nm(s, o.id) === 'Test Bear' || nm(s, o.id) === 'Test Ogre'));
    expect(stayed).toHaveLength(1);
  });
  it('negative: with no creature to choose, only it phases out; an opponent\'s creature is not a legal target', () => {
    let s = scenario([], { p1: { hand: ['Test Defiant'] }, p2: { battlefield: ['Test Ogre'] }, defs: DEFS });
    s = settle(act(s, { type: 'cast', player: 'p1', card: find(s, 'Test Defiant', 'hand', 'p1') }));
    const phased = Object.values(s.objects).filter((o) => o.phasedOut).map((o) => nm(s, o.id));
    expect(phased).toEqual(['Test Defiant']);
  });
});

describe('CR 119.3, 608.2c: "each opponent loses life equal to the life that player lost this turn. You gain life equal to the life lost this way." (Gul Dukat, Colonial Prefect)', () => {
  it('each opponent loses what that opponent lost this turn, and you gain the total (damage and other life loss count)', () => {
    let s = scenario([], { p1: { battlefield: ['Test Prefect'], hand: ['Test Siphon Five'] }, defs: DEFS });
    s = settle(act(s, { type: 'cast', player: 'p1', card: find(s, 'Test Siphon Five', 'hand', 'p1') }));
    expect(life(s, 'p2')).toBe(15);
    s = settle(advanceTo(s, 1, 'end'));
    expect(life(s, 'p2')).toBe(10);
    expect(life(s, 'p1')).toBe(25);
  });
  it('four players: each opponent loses their own amount (2, 5 and none) and you gain the sum', () => {
    let s = mpScenario({ defs: DEFS, zones: { p1: { battlefield: ['Test Prefect'], hand: ['Test Siphon Two', 'Test Siphon Five'] } } });
    const at = (name: string, target: 'p2' | 'p3'): GameState => resolveStack(castWith(s, name, [{ kind: 'chooseTargets', targets: [{ kind: 'player', id: target }] }]));
    s = at('Test Siphon Two', 'p2');
    s = at('Test Siphon Five', 'p3');
    expect([lifeOf(s, 'p2'), lifeOf(s, 'p3'), lifeOf(s, 'p4')]).toEqual([18, 15, 20]);
    s = passUntil(s, (t) => t.turn.number === 1 && t.turn.step === 'end' && t.pending?.kind === 'priority', 'the end step');
    s = resolveStack(s);
    expect([lifeOf(s, 'p2'), lifeOf(s, 'p3'), lifeOf(s, 'p4')]).toEqual([16, 10, 20]);
    expect(lifeOf(s, 'p1')).toBe(27);
  });
  it('negative: an opponent who lost no life this turn loses none, and you gain nothing', () => {
    let s = scenario([], { p1: { battlefield: ['Test Prefect'] }, defs: DEFS });
    s = settle(advanceTo(s, 1, 'end'));
    expect(life(s, 'p2')).toBe(20);
    expect(life(s, 'p1')).toBe(20);
  });
});

describe('CR 603.2, 701.20: "put a +1/+1 counter on it, then reveal cards from the top of your library until you reveal a land card. Put that card onto the battlefield tapped and the rest on the bottom ..." (Janice Rand, Essential Aide)', () => {
  it('a creature that enters gets the counter, and the first land card of the library enters tapped; the revealed spells go to the bottom', () => {
    let s = scenario([], { p1: { battlefield: ['Test Aide'], hand: ['Test Bear'], library: ['Test Ogre', 'Test Bear', 'Plains'] }, defs: DEFS });
    s = settle(act(s, { type: 'cast', player: 'p1', card: find(s, 'Test Bear', 'hand', 'p1') }));
    const bear = idOn(s, 'Test Bear');
    expect(s.objects[bear]!.counters['+1/+1']).toBe(1);
    const land = s.zones.battlefield.filter((id) => nm(s, id) === 'Plains');
    expect(land).toHaveLength(1);
    expect(s.objects[land[0]!]!.tapped).toBe(true);
    const lib = s.zones.library['p1']!.map((id) => nm(s, id));
    expect(lib.slice(-2).sort()).toEqual(['Test Bear', 'Test Ogre']); // the two revealed nonland cards on the bottom
  });
  it('negative: an opponent\'s creature entering does nothing', () => {
    let s = scenario([], { p1: { battlefield: ['Test Aide'], library: ['Plains'] }, p2: { hand: ['Test Bear'] }, defs: DEFS });
    s = advanceTo(s, 2, 'main1');
    const before = s.zones.battlefield.length;
    s = settle(act(s, { type: 'cast', player: 'p2', card: find(s, 'Test Bear', 'hand', 'p2') }));
    expect(s.zones.battlefield.length).toBe(before + 1);
    expect(s.objects[idOn(s, 'Test Bear')]!.counters['+1/+1'] ?? 0).toBe(0);
  });
  it('it also works when the creature attacks', () => {
    let s = scenario([], { p1: { battlefield: ['Test Aide', 'Test Bear'], library: ['Plains'] }, defs: DEFS });
    s = advanceTo(s, 1, 'declareAttackers');
    s = settle(answer(s, { kind: 'declareAttackers', attacks: [{ attacker: idOn(s, 'Test Bear'), defender: 'p2' }] }));
    expect(s.objects[idOn(s, 'Test Bear')]!.counters['+1/+1']).toBe(1);
    expect(s.zones.battlefield.filter((id) => nm(s, id) === 'Plains')).toHaveLength(1);
  });
});

describe('CR 701.14a, 603.7: "You may have the chosen creatures fight each other. Whenever a creature that fought this way dies this turn, you draw a card." (T\'Pring, Never Parted)', () => {
  const setup = (): GameState => scenario([], { p1: { hand: ['Test Pair', 'Test Smite'], battlefield: ['Test Ogre'] }, p2: { battlefield: ['Test Bear'] }, defs: DEFS });
  it('the chosen creatures fight; the one that dies draws you a card', () => {
    let s = setup();
    const h = handSize(s, 'p1');
    s = settle(act(s, { type: 'cast', player: 'p1', card: find(s, 'Test Pair', 'hand', 'p1') }));
    expect(onBf(s, 'Test Bear')).toBe(false); // 4 damage from the Ogre
    expect(handSize(s, 'p1')).toBe(h - 1 + 1); // the Pair left the hand, one card drawn (the Smite stays)
  });
  it('a creature that fought and lived draws you a card when it dies later the same turn', () => {
    let s = setup();
    const h = handSize(s, 'p1');
    s = settle(act(s, { type: 'cast', player: 'p1', card: find(s, 'Test Pair', 'hand', 'p1') }));
    expect(handSize(s, 'p1')).toBe(h); // the Bear died in the fight
    s = act(s, { type: 'cast', player: 'p1', card: find(s, 'Test Smite', 'hand', 'p1') });
    s = settle(answer(s, { kind: 'chooseTargets', targets: [{ kind: 'object', id: idOn(s, 'Test Ogre') }] }));
    expect(onBf(s, 'Test Ogre')).toBe(false);
    expect(handSize(s, 'p1')).toBe(h - 1 + 1); // the Smite left the hand, one card drawn
  });
  it('negative: declining the fight draws nothing, and a later death of a creature that did not fight draws nothing', () => {
    let s = setup();
    const h = handSize(s, 'p1');
    s = settle(act(s, { type: 'cast', player: 'p1', card: find(s, 'Test Pair', 'hand', 'p1') }), false);
    expect(onBf(s, 'Test Bear')).toBe(true);
    expect(handSize(s, 'p1')).toBe(h - 1);
    // the delayed trigger is for creatures that fought: killing the Bear now (it did not fight) draws nothing
    s = act(s, { type: 'cast', player: 'p1', card: find(s, 'Test Smite', 'hand', 'p1') });
    s = settle(answer(s, { kind: 'chooseTargets', targets: [{ kind: 'object', id: idOn(s, 'Test Bear') }] }));
    expect(onBf(s, 'Test Bear')).toBe(false);
    expect(handSize(s, 'p1')).toBe(h - 2);
  });
});
