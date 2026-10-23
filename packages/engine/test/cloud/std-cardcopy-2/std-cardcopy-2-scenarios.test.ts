/**
 * Lane std-cardcopy, round std-cardcopy-2: the round's readings played through the engine with synthetic cards (invented names and wordings, design 6.10),
 * compiled by the game's default compiler. CR cites from memory, unverified (rules/cr/ is not in the cloud checkout).
 *
 *   CR 607.2a, 508.4, 707.2   "for each opponent, create a tapped token that's a copy of the exiled card attacking that opponent": the card the OTHER ability of the
 *                             object exiled (the link), one token per opponent, each attacking its own opponent; "those tokens" are all of them
 *   CR 607.2a, 122.6, 608.2d  "sacrifice ~, then put a creature card exiled with it onto the battlefield under your control with two additional +1/+1 counters on it":
 *                             one of the linked cards, chosen by you, read with the source's last known information after it was sacrificed
 *   CR 611.2a, 613.1f         "It gains this card's other abilities": the target gains, for good, copies of the card's other abilities ("this" in them is the target)
 *   CR 608.2c, 608.2d         "choose a creature you control and create a token that's a copy of it": "it" is the chosen creature, never the object itself
 */
import { describe, expect, it } from 'vitest';
import { compileCard, type CardDef, type GameState, type ObjectId, type OracleCard, type PlayerId } from '../../../src/index';
import { getChars } from '../../../src/rules/characteristics';
import { act, answer, find, pass, scenario } from '../../m3/scenario';
import { mpScenario, passUntil } from '../../m12/rules/helpers';

function card(name: string, type: string, text: string, pt?: [string, string], cost = '{0}'): CardDef {
  return compileCard({ name, layout: 'normal', mana_cost: cost, type_line: type, oracle_text: text, colors: [], keywords: [], ...(pt ? { power: pt[0], toughness: pt[1] } : {}) } as OracleCard);
}
/** The card is parsed and automated without a manual unit (a template's experimental status caps the level; that is not checked here). */
const automated = (d: CardDef): boolean => !JSON.stringify(d.faces).includes('"op":"manual"') && d.faces.every((f) => f.abilities.every((a) => a.kind !== 'manual'));

/** Pass priority, answering targets, costs, yes/no and choices (the first offered), until the stack is empty and the active player has priority again. */
function settle(s0: GameState, targets: (ObjectId | ObjectId[])[] = [], picks: ObjectId[] = []): GameState {
  let s = s0;
  const queue = [...targets];
  const chosen = [...picks];
  for (let guard = 0; guard < 80 && s.pending && !(s.pending.kind === 'priority' && s.zones.stack.length === 0 && s.pending.player === s.turn.activePlayer); guard++) {
    const d = s.pending;
    if (d.kind === 'chooseTargets') s = answer(s, { kind: 'chooseTargets', targets: queue.length > 0 ? [queue.shift()!].flat().map((id) => ({ kind: 'object' as const, id })) : [] });
    else if (d.kind === 'payCost') s = answer(s, { kind: 'payCost', auto: true });
    else if (d.kind === 'yesNo') s = answer(s, { kind: 'yesNo', yes: true });
    else if (d.kind === 'order') s = answer(s, { kind: 'order', ids: d.items.map((i) => i.id) });
    else if (d.kind === 'chooseObjects') {
      const want = chosen.shift();
      const ids = want !== undefined && d.options.includes(want) ? [want] : d.options.slice(0, d.min);
      s = answer(s, { kind: 'chooseObjects', ids });
    } else if (d.kind === 'priority') s = pass(s);
    else throw new Error(`unexpected decision ${d.kind}: ${d.prompt}`);
  }
  return s;
}
const tokensNamed = (s: GameState, name: string, controller: PlayerId = 'p1'): ObjectId[] =>
  s.zones.battlefield.filter((id) => s.objects[id]!.kind === 'token' && s.objects[id]!.controller === controller && getChars(s, id)?.name === name);

describe('CR 607.2a, 508.4, 707.2: "for each opponent, create a tapped token that\'s a copy of the exiled card attacking that opponent"', () => {
  const TOTEM = card('Test Siege Totem', 'Creature — Golem', "Haste\nWhen this creature enters, exile up to one other target creature you control until this creature leaves the battlefield.\nWhenever this creature attacks, for each opponent, create a tapped token that's a copy of the exiled card attacking that opponent. At the beginning of your next end step, sacrifice those tokens.", ['4', '4']);
  const OX = card('Test Plow Ox', 'Creature — Ox', '', ['3', '3']);
  const OTHER = card('Test Stray Cat', 'Creature — Cat', '', ['1', '1']);
  const DEFS = [TOTEM, OX, OTHER];
  it('is parsed and automated: the enters exile records the link, the attack trigger reads it', () => {
    expect(automated(TOTEM)).toBe(true);
    const json = JSON.stringify(TOTEM.faces[0]!.abilities);
    expect(json).toContain('"to":{"zone":"exile"},"until":');
    expect(json).toContain('"link":"exiled"');
    expect(json).toContain('"what":{"ref":"linked","link":"exiled"},"result":"token","who":{"ref":"you"},"tapped":true,"attacking":{"defender":{"ref":"bound","name":"each"}}');
  });
  const enterAndAttack = (): GameState => {
    let s = mpScenario({ defs: DEFS, zones: { p1: { hand: ['Test Siege Totem'], battlefield: ['Test Plow Ox', 'Test Stray Cat'] } } });
    const ox = find(s, 'Test Plow Ox', 'battlefield', 'p1');
    s = settle(act(s, { type: 'cast', player: 'p1', card: find(s, 'Test Siege Totem', 'hand', 'p1') }), [ox]);
    expect(s.objects[ox]?.zone ?? 'gone').not.toBe('battlefield');
    s = passUntil(s, (x) => x.pending?.kind === 'declareAttackers' && x.pending.player === 'p1', 'the attack');
    s = answer(s, { kind: 'declareAttackers', attacks: [{ attacker: find(s, 'Test Siege Totem', 'battlefield', 'p1'), defender: 'p2' }] });
    return settle(s);
  };
  it('in a 4-player game: three tapped copies of the exiled creature, one attacking each opponent (the copies are of the Ox, never of the other creature)', () => {
    const s = enterAndAttack();
    const copies = tokensNamed(s, 'Test Plow Ox');
    expect(copies.length).toBe(3);
    expect(tokensNamed(s, 'Test Stray Cat').length).toBe(0);
    for (const id of copies) expect(s.objects[id]!.tapped).toBe(true);
    const defenders = copies.map((id) => s.combat!.attackers.find((a) => a.id === id)?.defender).sort();
    expect(defenders).toEqual(['p2', 'p3', 'p4']);
  });
  it('"those tokens": at the beginning of your next end step every one of them is sacrificed', () => {
    let s = enterAndAttack();
    expect(tokensNamed(s, 'Test Plow Ox').length).toBe(3);
    s = passUntil(s, (x) => x.turn.step === 'end' && x.zones.stack.length === 0 && x.pending?.kind === 'priority', 'the end step');
    s = settle(s);
    expect(tokensNamed(s, 'Test Plow Ox').length).toBe(0);
  });
  it('with nothing exiled (no other creature as it entered), the attack creates no token', () => {
    let s = mpScenario({ defs: DEFS, zones: { p1: { hand: ['Test Siege Totem'] } } });
    s = settle(act(s, { type: 'cast', player: 'p1', card: find(s, 'Test Siege Totem', 'hand', 'p1') }));
    s = passUntil(s, (x) => x.pending?.kind === 'declareAttackers' && x.pending.player === 'p1', 'the attack');
    s = settle(answer(s, { kind: 'declareAttackers', attacks: [{ attacker: find(s, 'Test Siege Totem', 'battlefield', 'p1'), defender: 'p2' }] }));
    expect(s.zones.battlefield.filter((id) => s.objects[id]!.kind === 'token').length).toBe(0);
  });
});

describe('CR 607.2a, 122.6, 608.2d: "sacrifice ~, then put a creature card exiled with it onto the battlefield under your control with two additional +1/+1 counters on it"', () => {
  const VOID = card('Test Hungry Rift', 'Enchantment', 'Whenever a creature you control dies, each opponent chooses a creature they control and exiles it.\n{0}: Sacrifice this enchantment, then put a creature card exiled with it onto the battlefield under your control with two additional +1/+1 counters on it.');
  const OX = card('Test Plow Ox', 'Creature — Ox', '', ['3', '3']);
  const CAT = card('Test Stray Cat', 'Creature — Cat', '', ['1', '1']);
  const LOOSE = card('Test Loose Hound', 'Creature — Dog', '', ['2', '2']);
  const DEFS = [VOID, OX, CAT, LOOSE];
  it('is parsed and automated', () => {
    expect(automated(VOID)).toBe(true);
    const json = JSON.stringify(VOID.faces[0]!.abilities);
    expect(json).toContain('"to":{"zone":"exile"},"link":"exiled"');
    expect(json).toContain('"counters":[{"kind":"+1/+1","count":2}]');
  });
  it('the opponent\'s exiled creature comes back under your control with two +1/+1 counters after the source is sacrificed; a card exiled otherwise is never chosen', () => {
    let s = scenario([], { p1: { battlefield: ['Test Hungry Rift', 'Test Stray Cat'] }, p2: { battlefield: ['Test Plow Ox'], exile: ['Test Loose Hound'] }, defs: DEFS });
    const cat = find(s, 'Test Stray Cat', 'battlefield', 'p1');
    // the cat dies: the opponent exiles the Ox with the Rift's linked ability
    s.objects[cat]!.damage = 5;
    s = settle(pass(s));
    s = settle(s);
    expect(find(s, 'Test Plow Ox', 'exile', 'p2')).toBeDefined();
    const rift = find(s, 'Test Hungry Rift', 'battlefield', 'p1');
    s = settle(act(s, { type: 'activate', player: 'p1', source: rift, ability: 'p:0:1' }));
    expect(s.objects[rift]?.zone ?? 'gone').not.toBe('battlefield');
    const ox = s.zones.battlefield.find((id) => s.objects[id]!.defId === 'Test Plow Ox')!;
    expect(ox).toBeDefined();
    expect(s.objects[ox]!.controller).toBe('p1');
    expect(s.objects[ox]!.owner).toBe('p2');
    expect(s.objects[ox]!.counters['+1/+1']).toBe(2);
    expect(s.zones.battlefield.some((id) => s.objects[id]!.defId === 'Test Loose Hound')).toBe(false); // exiled, but not with the Rift
  });
});

describe('CR 611.2a, 613.1f: "It gains this card\'s other abilities."', () => {
  const HOST = card('Test Drifting Parasite', 'Creature — Horror', 'Whenever this creature deals combat damage to a player, you gain 3 life.\nNew Shell — {0}, Exile this card from your graveyard: Put a +1/+1 counter on target creature you control. It gains this card\'s other abilities. Activate only as a sorcery.', ['1', '1']);
  const BEAR = card('Test Grove Bear', 'Creature — Bear', '', ['2', '2']);
  const DEFS = [HOST, BEAR];
  it('is parsed and automated: the grant holds a copy of the combat damage trigger (and nothing of the activated ability)', () => {
    expect(automated(HOST)).toBe(true);
    const act0 = HOST.faces[0]!.abilities.find((a) => a.kind === 'activated')!;
    const json = JSON.stringify(act0);
    expect(json).toContain('"otherAbilitiesOfCard":true');
    expect(json).toContain('"ev":"damage"');
    const grant = JSON.stringify(JSON.parse(json).effect.steps[1].effects[0].mods[0].add);
    expect(grant).not.toContain('"kind":"activated"');
  });
  it('the target gets the counter and, for good, the trigger: its combat damage to a player gains you 3 life; the activated ability is not granted', () => {
    let s = scenario([], { p1: { battlefield: ['Test Grove Bear'], graveyard: ['Test Drifting Parasite'] }, defs: DEFS });
    const bear = find(s, 'Test Grove Bear', 'battlefield', 'p1');
    const host = find(s, 'Test Drifting Parasite', 'graveyard', 'p1');
    s = settle(act(s, { type: 'activate', player: 'p1', source: host, ability: 'p:0:1' }), [bear]);
    expect(s.objects[bear]!.counters['+1/+1']).toBe(1);
    const abilities = getChars(s, bear)!.abilities.map((a) => a.def.kind);
    expect(abilities).toContain('triggered');
    expect(abilities).not.toContain('activated');
    const before = s.players.find((p) => p.id === 'p1')!.life;
    s = passUntil(s, (x) => x.pending?.kind === 'declareAttackers' && x.pending.player === 'p1', 'the attack');
    s = answer(s, { kind: 'declareAttackers', attacks: [{ attacker: bear, defender: 'p2' }] });
    for (let i = 0; i < 60 && s.turn.step !== 'main2'; i++) {
      const d = s.pending!;
      if (d.kind === 'declareBlockers') s = answer(s, { kind: 'declareBlockers', blocks: [] });
      else if (d.kind === 'priority') s = pass(s);
      else throw new Error(`unexpected ${d.kind}`);
    }
    expect(s.players.find((p) => p.id === 'p1')!.life).toBe(before + 3);
    expect(s.players.find((p) => p.id === 'p2')!.life).toBe(20 - 3);
  });
  it('a card with another ability that is not understood grants nothing: the sentence is manual (never a guess)', () => {
    const ODD = card('Test Odd Parasite', 'Creature — Horror', 'Whenever this creature blorfts a glimmer, you gain 3 life.\n{1}, Exile this card from your graveyard: Put a +1/+1 counter on target creature you control. It gains this card\'s other abilities.', ['1', '1']);
    expect(JSON.stringify(ODD.faces[0]!.abilities)).not.toContain('"otherAbilitiesOfCard":true');
  });
});

describe('CR 608.2c, 608.2d: the one object a player chose is what "it" names next ("choose a creature you control and create a token that\'s a copy of it")', () => {
  const LOOM = card('Test Mirror Loom', 'Artifact Creature — Golem', "Whenever this creature attacks, choose a nontoken creature you control and create a token that's a copy of it.", ['2', '2']);
  const OX = card('Test Plow Ox', 'Creature — Ox', '', ['3', '3']);
  const DEFS = [LOOM, OX];
  it('is parsed and automated, the copy reading the choice (not the object itself)', () => {
    expect(automated(LOOM)).toBe(true);
    expect(JSON.stringify(LOOM.faces[0]!.abilities)).toContain('"op":"copy","what":{"ref":"bound","name":"chosen"}');
  });
  it('the token is a copy of the creature chosen', () => {
    let s = scenario([], { p1: { battlefield: ['Test Mirror Loom', 'Test Plow Ox'] }, defs: DEFS });
    const ox = find(s, 'Test Plow Ox', 'battlefield', 'p1');
    s = passUntil(s, (x) => x.pending?.kind === 'declareAttackers' && x.pending.player === 'p1', 'the attack');
    s = settle(answer(s, { kind: 'declareAttackers', attacks: [{ attacker: find(s, 'Test Mirror Loom', 'battlefield', 'p1'), defender: 'p2' }] }), [], [ox]);
    expect(tokensNamed(s, 'Test Plow Ox').length).toBe(1);
    expect(tokensNamed(s, 'Test Mirror Loom').length).toBe(0);
  });
  it('the negative case: a second sentence that names a target of its own is left to the unique-candidate rule', () => {
    const TWO = card('Test Twin Loom', 'Artifact Creature — Golem', 'Whenever this creature attacks, choose a nontoken creature you control. Target creature gets +1/+1 until end of turn and it gains flying until end of turn.', ['2', '2']);
    expect(JSON.stringify(TWO.faces[0]!.abilities)).not.toContain('"affects":{"ref":"bound","name":"chosen"}');
  });
});
