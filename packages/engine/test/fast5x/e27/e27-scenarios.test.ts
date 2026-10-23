/**
 * FAST5X E27: emblems from planeswalkers and keyword costs II, played through applyAction with synthetic cards compiled by the game's default compiler
 * (invented names and wordings, design 6.10). Each test is named after the rule it checks.
 *
 *   CR 114.1-114.5, 113.6, 606   "-N: You get an emblem with "..."": the emblem is in the command zone, owned and controlled by that player, its abilities
 *                                 function there and outlive the planeswalker; "this emblem deals N damage" has the emblem as its source
 *   CR 702.21a, 122.1f, 118.12a  ward with any cost: get N poison counters, pay life equal to ~'s power, "discard a card or pay {2}" (a choice)
 *   CR 702.6a, 602.2b, 601.2b    equip with non-mana and choice costs: "Pay {3} or discard a card", "Pay 3 life. Activate only once each turn."
 *                                 (CR 602.5b), "Sacrifice another nonland permanent"
 *   CR 702.29e                   typecycling by any subtype (halflingcycling)
 *   CR 207.2d                    a flavor word before a keyword with a dash is a label
 */
import { describe, expect, it } from 'vitest';
import { compileCard, type AbilityDef, type CardDef, type GameState, type ObjectId, type OracleCard, type TargetChoice } from '../../../src/index';
import { act, answer, find, legal, passBoth, scenario } from '../../m3/scenario';
import { lifeOf, logHas, poisonOf } from '../../m4/helpers';
import { charsOfObject } from '../../../src/rules/characteristics';

function card(name: string, type: string, text: string, cost = '{0}', pt?: [string, string], loyalty?: string): CardDef {
  return compileCard({
    name, layout: 'normal', mana_cost: cost, type_line: type, oracle_text: text, colors: [], keywords: [],
    ...(pt ? { power: pt[0], toughness: pt[1] } : {}), ...(loyalty ? { loyalty } : {}),
  } as OracleCard);
}
const manualOf = (d: CardDef): AbilityDef[] => d.faces.flatMap((f) => f.abilities).filter((a) => a.kind === 'manual' || JSON.stringify(a).includes('"op":"manual"') || JSON.stringify(a).includes('"kind":"manual"'));

const BEAR = card('Test Bear', 'Creature — Bear', '', '{1}', ['2', '2']);
const OGRE = card('Test Ogre', 'Creature — Ogre', '', '{1}', ['4', '4']);
const THOUGHT = card('Test Thought', 'Sorcery', 'Draw a card.', '{0}');
const SALVE = card('Test Salve', 'Instant', 'You gain 3 life.', '{0}');
const NUDGE = card('Test Nudge', 'Instant', 'Tap target creature.', '{0}');
const BAUBLE = card('Test Bauble', 'Artifact', '', '{0}');

// ---- emblems ----------------------------------------------------------------------------------------------------------------------------------------------

const PW_ANTHEM = card('Test Rally Walker', 'Legendary Planeswalker — Testa', '-2: You get an emblem with "Creatures you control get +1/+1 and have vigilance and trample."', '{3}', undefined, '5');
const PW_DRAW = card('Test Muse Walker', 'Legendary Planeswalker — Testa', '-2: You get an emblem with "Whenever you cast a spell, draw a card."', '{3}', undefined, '5');
const PW_BURN = card('Test Spark Walker', 'Legendary Planeswalker — Testa', '-2: You get an emblem with "Whenever you cast a spell, this emblem deals 2 damage to any target."', '{3}', undefined, '5');
const PW_DRAIN = card('Test Leech Walker', 'Legendary Planeswalker — Testa', '-2: You get an emblem with "Whenever you gain life, target opponent loses that much life."', '{3}', undefined, '5');
const PW_TOKENS = card('Test Swarm Walker', 'Legendary Planeswalker — Testa', '-2: You get an emblem with "Whenever a player casts a spell, you create a 1/1 green Squirrel creature token."', '{3}', undefined, '5');
const PW_STORM = card('Test Storm Walker', 'Legendary Planeswalker — Testa', '-2: Draw a card. You get an emblem with "Instant and sorcery spells you cast have storm."', '{3}', undefined, '5');
const EMBLEM_DEFS = [PW_STORM, PW_ANTHEM, PW_DRAW, PW_BURN, PW_DRAIN, PW_TOKENS, BEAR, OGRE, THOUGHT, SALVE];

const activate = (s: GameState, source: ObjectId, player = 'p1'): GameState => {
  const a = legal(s, player, 'activate').find((x) => x.object === source);
  if (!a) throw new Error(`no activation of ${source}`);
  return act(s, a.action);
};
const emblems = (s: GameState): ObjectId[] => s.zones.command.filter((id) => s.defs[s.objects[id]!.defId]?.layout === 'emblem');
const resolveTop = (s: GameState, targets?: TargetChoice[]): GameState => {
  let x = passBoth(s);
  for (let i = 0; i < 10 && x.pending && x.pending.kind !== 'priority'; i++) {
    if (x.pending.kind === 'chooseTargets' && targets) x = answer(x, { kind: 'chooseTargets', targets });
    else if (x.pending.kind === 'payCost') x = answer(x, { kind: 'payCost', auto: true });
    else break;
  }
  return x;
};
const castSpell = (s: GameState, name: string, player = 'p1', targets?: TargetChoice[]): GameState => {
  let x = act(s, { type: 'cast', player, card: find(s, name, 'hand', player) });
  for (let i = 0; i < 10 && x.pending && x.pending.kind !== 'priority'; i++) {
    if (x.pending.kind === 'chooseTargets') x = answer(x, { kind: 'chooseTargets', targets: targets ?? [] });
    else if (x.pending.kind === 'payCost') x = answer(x, { kind: 'payCost', auto: true });
    else break;
  }
  return x;
};

describe('FAST5X E27 emblems (CR 114)', () => {
  it('CR 114.2: every emblem shape here is understood (the quoted ability is parsed with the ordinary chart)', () => {
    for (const d of EMBLEM_DEFS) expect(manualOf(d), d.name).toEqual([]);
    const step = (PW_BURN.faces[0]!.abilities[0] as { effect: { steps: { op: string; abilities: AbilityDef[] }[] } }).effect.steps[0]!;
    expect(step.op).toBe('createEmblem');
    // CR 114.4 / 113.7: "this emblem" is the emblem itself, the source of the damage
    expect(JSON.stringify(step.abilities)).toContain('"source":{"ref":"self"}');
  });

  it('CR 114.2, 114.4, 606.4: the loyalty ability puts an emblem owned and controlled by its player into the command zone, and its static ability applies there', () => {
    let s = scenario([], { defs: EMBLEM_DEFS, p1: { battlefield: [{ name: 'Test Rally Walker', counters: { loyalty: 5 } }, 'Test Bear'] }, p2: { battlefield: ['Test Ogre'] } });
    const walker = find(s, 'Test Rally Walker', 'battlefield', 'p1');
    s = activate(s, walker);
    expect(s.objects[walker]!.counters['loyalty']).toBe(3);
    s = resolveTop(s);
    const [e] = emblems(s);
    expect(e).toBeDefined();
    expect(s.objects[e!]).toMatchObject({ owner: 'p1', controller: 'p1', zone: 'command' });
    const view = (id: ObjectId): { power: number; toughness: number; keywords: string[] } => {
      const c = charsOfObject(s, s.objects[id]!);
      return { power: Number(c.power), toughness: Number(c.toughness), keywords: c.keywords.map((k) => k.keyword) };
    };
    const bear = find(s, 'Test Bear', 'battlefield', 'p1');
    expect(view(bear)).toMatchObject({ power: 3, toughness: 3 });
    expect(view(bear).keywords).toEqual(expect.arrayContaining(['vigilance', 'trample']));
    expect(view(find(s, 'Test Ogre', 'battlefield', 'p2'))).toMatchObject({ power: 4, toughness: 4 }); // "you control": the emblem's controller (CR 114.2)
  });

  it('CR 114.4, 114.5: the emblem stays and works after the planeswalker is gone (it is no permanent)', () => {
    let s = scenario([], { defs: EMBLEM_DEFS, p1: { battlefield: [{ name: 'Test Muse Walker', counters: { loyalty: 2 } }], hand: ['Test Thought', 'Test Salve'] } });
    s = activate(s, find(s, 'Test Muse Walker', 'battlefield', 'p1'));
    s = resolveTop(s);
    // 0 loyalty: the planeswalker is put into its owner's graveyard (CR 704.5i); the emblem stays
    expect(s.zones.graveyard['p1']!.some((id) => s.objects[id]!.defId === 'Test Muse Walker')).toBe(true);
    expect(emblems(s)).toHaveLength(1);
    const hand = s.zones.hand['p1']!.length;
    s = castSpell(s, 'Test Salve');
    // the trigger goes on the stack above the spell and resolves first: one card drawn
    s = resolveTop(s);
    expect(s.zones.hand['p1']!.length).toBe(hand - 1 + 1);
  });

  it('CR 114.4, 120.2: "this emblem deals 2 damage to any target": the emblem is the source', () => {
    let s = scenario([], { defs: EMBLEM_DEFS, p1: { battlefield: [{ name: 'Test Spark Walker', counters: { loyalty: 5 } }], hand: ['Test Thought'] } });
    s = activate(s, find(s, 'Test Spark Walker', 'battlefield', 'p1'));
    s = resolveTop(s);
    const before = lifeOf(s, 'p2');
    // the emblem's trigger targets as it is put on the stack (CR 603.3d)
    s = castSpell(s, 'Test Thought', 'p1', [{ kind: 'player', id: 'p2' }]);
    s = resolveTop(s);
    expect(lifeOf(s, 'p2')).toBe(before - 2);
    expect(logHas(s, /Emblem \(Test Spark Walker\) deals 2 damage/)).toBe(true);
  });

  it('CR 114.4, 603.2: "Whenever you gain life, target opponent loses that much life."', () => {
    let s = scenario([], { defs: EMBLEM_DEFS, p1: { battlefield: [{ name: 'Test Leech Walker', counters: { loyalty: 5 } }], hand: ['Test Salve'] } });
    s = activate(s, find(s, 'Test Leech Walker', 'battlefield', 'p1'));
    s = resolveTop(s);
    const before = lifeOf(s, 'p2');
    s = castSpell(s, 'Test Salve');
    s = resolveTop(s); // Salve resolves, the emblem triggers
    for (let i = 0; i < 4 && s.pending?.kind === 'chooseTargets'; i++) s = answer(s, { kind: 'chooseTargets', targets: [{ kind: 'player', id: 'p2' }] });
    s = resolveTop(s);
    expect(lifeOf(s, 'p2')).toBe(before - 3);
  });

  it('CR 114.4, 702.40a, 613.1f: "Instant and sorcery spells you cast have storm.": a sorcery cast after another spell is copied once', () => {
    let s = scenario([], { defs: EMBLEM_DEFS, p1: { battlefield: [{ name: 'Test Storm Walker', counters: { loyalty: 5 } }], hand: ['Test Salve', 'Test Thought'], library: ['Test Bear', 'Test Bear', 'Test Bear', 'Test Bear'] } });
    s = activate(s, find(s, 'Test Storm Walker', 'battlefield', 'p1'));
    s = resolveTop(s);
    expect(emblems(s)).toHaveLength(1);
    s = castSpell(s, 'Test Salve');
    s = resolveTop(s); // storm of the Salve: no spell before it, no copy
    for (let i = 0; i < 4 && s.zones.stack.length > 0; i++) s = resolveTop(s);
    const hand = s.zones.hand['p1']!.length;
    s = castSpell(s, 'Test Thought');
    for (let i = 0; i < 6 && s.zones.stack.length > 0; i++) s = resolveTop(s);
    // Thought left the hand, the original and one copy each drew a card
    expect(s.zones.hand['p1']!.length).toBe(hand - 1 + 2);
  });

  it('CR 114.4: "Whenever a player casts a spell, you create a 1/1 green Squirrel creature token." triggers on an opponent\'s spell too', () => {
    let s = scenario([], { defs: EMBLEM_DEFS, p1: { battlefield: [{ name: 'Test Swarm Walker', counters: { loyalty: 5 } }] }, p2: { hand: ['Test Salve'] } });
    s = activate(s, find(s, 'Test Swarm Walker', 'battlefield', 'p1'));
    s = resolveTop(s);
    s = act(s, { type: 'pass', player: 'p1' });
    expect(s.pending).toMatchObject({ kind: 'priority', player: 'p2' });
    s = castSpell(s, 'Test Salve', 'p2');
    s = resolveTop(s);
    expect(s.zones.battlefield.filter((id) => s.objects[id]!.controller === 'p1' && s.objects[id]!.kind === 'token')).toHaveLength(1);
  });
});

describe('FAST5X E27 "As this creature transforms into ~, you get an emblem with ..." (CR 712.20, 114.2)', () => {
  const CHANGER = compileCard({
    name: 'Test Squire // Test Champion', layout: 'transform', mana_cost: '{0}', type_line: 'Creature — Human // Creature — Human', colors: [],
    card_faces: [
      { name: 'Test Squire', mana_cost: '{0}', type_line: 'Creature — Human', oracle_text: '{1}: Transform this creature.', power: '1', toughness: '1', colors: [] },
      { name: 'Test Champion', mana_cost: '', type_line: 'Creature — Human', oracle_text: 'As this creature transforms into Test Champion, you get an emblem with "Creatures you control get +1/+1."', power: '3', toughness: '3', colors: [] },
    ],
  } as unknown as OracleCard);
  it('CR 712.20, 614.1e: the replacement of the back face applies as it transforms: its controller gets the emblem, and the ability of the emblem applies', () => {
    expect(manualOf(CHANGER)).toEqual([]);
    let s = scenario([], { defs: [CHANGER, BEAR], p1: { battlefield: ['Test Squire // Test Champion', 'Test Bear', 'Plains'] } });
    const squire = find(s, 'Test Squire // Test Champion', 'battlefield', 'p1');
    s = activate(s, squire);
    if (s.pending?.kind === 'payCost') s = answer(s, { kind: 'payCost', auto: true });
    s = resolveTop(s);
    expect(s.objects[squire]!.face).toBe(1);
    expect(emblems(s)).toHaveLength(1);
    expect(s.objects[emblems(s)[0]!]).toMatchObject({ owner: 'p1', controller: 'p1' });
    expect(Number(charsOfObject(s, s.objects[find(s, 'Test Bear', 'battlefield', 'p1')]!).power)).toBe(3);
  });
});

// ---- ward with any cost ---------------------------------------------------------------------------------------------------------------------------------

const SNAKE = card('Test Venom Warden', 'Creature — Snake', 'Ward—Get three poison counters.', '{1}', ['1', '1']);
const BULL = card('Test Iron Bull', 'Creature — Ox', "Ward—Pay life equal to Test Iron Bull's power.", '{1}', ['4', '4']);
const TROLL = card('Test Bridge Troll', 'Creature — Troll', 'Ward—Discard a card or pay {2}.', '{1}', ['3', '3']);
const WARD_DEFS = [SNAKE, BULL, TROLL, NUDGE, THOUGHT, BEAR];

/** p1 casts Test Nudge at p2's warded creature; the ward trigger is put on the stack (p2 controls it) and passes to its resolution, where p1 is asked. */
function wardSetup(name: string, p1: { hand?: string[]; battlefield?: string[] } = {}): { s: GameState; warded: ObjectId } {
  let s = scenario([], { defs: WARD_DEFS, p2: { battlefield: [name] }, p1: { hand: ['Test Nudge', ...(p1.hand ?? [])], battlefield: p1.battlefield ?? [] } });
  const warded = find(s, name, 'battlefield', 'p2');
  s = castSpell(s, 'Test Nudge', 'p1', [{ kind: 'object', id: warded }]);
  s = passBoth(s); // the ward trigger resolves first
  return { s, warded };
}

describe('FAST5X E27 ward with any cost (CR 702.21a)', () => {
  it('CR 702.21a: each ward cost shape is understood and the cards are fully automated', () => {
    for (const d of [SNAKE, BULL, TROLL]) {
      expect(manualOf(d), d.name).toEqual([]);
      expect(d.automation.level, d.name).toBe('full');
    }
    expect(SNAKE.faces[0]!.abilities[0]).toMatchObject({ kind: 'keyword', keyword: 'ward', cost: { other: [{ kind: 'getCounters', counter: 'poison', amount: 3 }] } });
    expect(TROLL.faces[0]!.abilities[0]).toMatchObject({ kind: 'keyword', keyword: 'ward', cost: { other: [{ kind: 'oneOf', options: [{ other: [{ kind: 'discard', count: 1 }] }, { mana: [{ kind: 'generic', amount: 2 }] }] }] } });
  });

  it('CR 702.21a, 122.1f: "Ward—Get three poison counters": paying gives the targeting player three poison counters and the spell resolves', () => {
    let { s, warded } = wardSetup('Test Venom Warden');
    expect(s.pending).toMatchObject({ kind: 'yesNo', player: 'p1' });
    s = answer(s, { kind: 'yesNo', yes: true });
    expect(poisonOf(s, 'p1')).toBe(3);
    s = passBoth(s);
    expect(s.objects[warded]!.tapped).toBe(true);
  });

  it('CR 702.21a, 118.12a: declining the poison counters counters the spell', () => {
    let { s, warded } = wardSetup('Test Venom Warden');
    s = answer(s, { kind: 'yesNo', yes: false });
    expect(poisonOf(s, 'p1')).toBe(0);
    expect(s.zones.stack).toHaveLength(0);
    expect(s.objects[warded]!.tapped).toBe(false);
  });

  it('CR 702.21a, 608.2h: "Pay life equal to ~\'s power": the power is read as the ward trigger resolves', () => {
    let { s, warded } = wardSetup('Test Iron Bull');
    const before = lifeOf(s, 'p1');
    expect(s.pending).toMatchObject({ kind: 'yesNo', player: 'p1' });
    expect((s.pending as { prompt: string }).prompt).toContain('Pay 4 life');
    s = answer(s, { kind: 'yesNo', yes: true });
    expect(lifeOf(s, 'p1')).toBe(before - 4);
    s = passBoth(s);
    expect(s.objects[warded]!.tapped).toBe(true);
  });

  it('CR 702.21a, 118.3: with too little life the cost can\'t be paid and the spell is countered without a question', () => {
    let s = scenario([], { defs: WARD_DEFS, p2: { battlefield: ['Test Iron Bull'] }, p1: { hand: ['Test Nudge'] } });
    s.players.find((p) => p.id === 'p1')!.life = 3;
    const warded = find(s, 'Test Iron Bull', 'battlefield', 'p2');
    s = castSpell(s, 'Test Nudge', 'p1', [{ kind: 'object', id: warded }]);
    s = passBoth(s);
    s = passBoth(s);
    expect(s.zones.stack).toHaveLength(0);
    expect(s.objects[warded]!.tapped).toBe(false);
    expect(lifeOf(s, 'p1')).toBe(3);
  });

  it('CR 702.21a, 601.2b, 118.12a: "Discard a card or pay {2}": the payer chooses which cost to pay', () => {
    let { s, warded } = wardSetup('Test Bridge Troll', { hand: ['Test Thought'], battlefield: ['Plains', 'Plains'] });
    s = answer(s, { kind: 'yesNo', yes: true });
    expect(s.pending).toMatchObject({ kind: 'chooseOption', player: 'p1' });
    const opts = (s.pending as { options: { id: string; label: string }[] }).options.map((o) => o.label);
    expect(opts).toEqual(['Discard 1 card', '{2}']);
    s = answer(s, { kind: 'chooseOption', ids: ['0'] });
    expect(s.zones.graveyard['p1']!.map((id) => s.objects[id]!.defId)).toContain('Test Thought');
    s = passBoth(s);
    expect(s.objects[warded]!.tapped).toBe(true);
  });

  it('CR 118.3, 601.2b: when only one of the costs can be paid it is the one paid (no card in hand: {2})', () => {
    let { s, warded } = wardSetup('Test Bridge Troll', { battlefield: ['Plains', 'Plains'] });
    s = answer(s, { kind: 'yesNo', yes: true });
    if (s.pending?.kind === 'payCost') s = answer(s, { kind: 'payCost', auto: true });
    expect(s.zones.battlefield.filter((id) => s.objects[id]!.defId === 'Plains' && s.objects[id]!.tapped)).toHaveLength(2);
    s = passBoth(s);
    expect(s.objects[warded]!.tapped).toBe(true);
  });

  it('CR 118.3: with neither a card nor {2} the cost can\'t be paid: the spell is countered', () => {
    let { s, warded } = wardSetup('Test Bridge Troll');
    expect(s.zones.stack).toHaveLength(0);
    expect(s.objects[warded]!.tapped).toBe(false);
  });
});

// ---- equip with any cost ----------------------------------------------------------------------------------------------------------------------------------

const FLAIL = card('Test Thorn Flail', 'Artifact — Equipment', 'Equipped creature gets +2/+1.\nEquip—Pay {3} or discard a card.', '{1}');
const SWORD = card('Test Grim Sword', 'Artifact — Equipment', 'Equipped creature gets +3/+0.\nDarkblade — Equip—Pay 3 life. Activate only once each turn.', '{1}');
const ARMOR = card('Test Shell Armor', 'Artifact — Equipment', 'Equipped creature gets +2/+1.\nEquip—Sacrifice another nonland permanent. Activate only once each turn.', '{1}');
const EQUIP_DEFS = [FLAIL, SWORD, ARMOR, BEAR, OGRE, THOUGHT, BAUBLE];
const attachedTo = (s: GameState, id: ObjectId): ObjectId | undefined => s.objects[id]!.attachedTo as ObjectId | undefined;

/** Activates the equip ability of `equipment` at `target`, answering the decisions; `option` picks a cost of a choice. */
function equip(s0: GameState, equipment: ObjectId, target: ObjectId, option?: string, objects?: ObjectId[]): GameState {
  let s = activate(s0, equipment);
  for (let i = 0; i < 10 && s.pending && s.pending.kind !== 'priority'; i++) {
    const p = s.pending;
    if (p.kind === 'chooseTargets') s = answer(s, { kind: 'chooseTargets', targets: [{ kind: 'object', id: target }] });
    else if (p.kind === 'chooseOption') s = answer(s, { kind: 'chooseOption', ids: [option ?? p.options[0]!.id] });
    else if (p.kind === 'chooseObjects') s = answer(s, { kind: 'chooseObjects', ids: objects ?? p.options.slice(0, p.min) });
    else if (p.kind === 'payCost') s = answer(s, { kind: 'payCost', auto: true });
    else break;
  }
  return passBoth(s);
}

describe('FAST5X E27 equip with any cost (CR 702.6a)', () => {
  it('CR 702.6a, 602.5b, 207.2d: each equip shape is understood (a flavor word before "Equip—" is a label)', () => {
    for (const d of [FLAIL, SWORD, ARMOR]) expect(manualOf(d), d.name).toEqual([]);
    expect(SWORD.faces[0]!.abilities[1]).toMatchObject({ kind: 'keyword', keyword: 'equip', cost: { other: [{ kind: 'payLife', amount: 3 }] }, limit: { per: 'turn', max: 1 } });
  });

  it('CR 702.6a, 601.2b: "Pay {3} or discard a card": with both payable the player chooses; discarding attaches it', () => {
    let s = scenario([], { defs: EQUIP_DEFS, p1: { battlefield: ['Test Thorn Flail', 'Test Bear', 'Plains', 'Plains', 'Plains'], hand: ['Test Thought'] } });
    const flail = find(s, 'Test Thorn Flail', 'battlefield', 'p1');
    const bear = find(s, 'Test Bear', 'battlefield', 'p1');
    let asked = false;
    let x = activate(s, flail);
    for (let i = 0; i < 10 && x.pending && x.pending.kind !== 'priority'; i++) {
      const p = x.pending;
      if (p.kind === 'chooseTargets') x = answer(x, { kind: 'chooseTargets', targets: [{ kind: 'object', id: bear }] });
      else if (p.kind === 'chooseOption') {
        asked = true;
        expect(p.options.map((o) => o.label)).toEqual(['{3}', 'Discard 1 card']);
        x = answer(x, { kind: 'chooseOption', ids: ['1'] });
      } else if (p.kind === 'chooseObjects') x = answer(x, { kind: 'chooseObjects', ids: p.options.slice(0, p.min) });
      else break;
    }
    expect(asked).toBe(true);
    s = passBoth(x);
    expect(attachedTo(s, flail)).toBe(bear);
    expect(s.zones.hand['p1']).toHaveLength(0);
    expect(s.zones.battlefield.filter((id) => s.objects[id]!.tapped)).toHaveLength(0); // no mana paid
  });

  it('CR 118.3, 602.2b: with no card in hand only {3} can be paid, and with neither the ability is not offered', () => {
    let s = scenario([], { defs: EQUIP_DEFS, p1: { battlefield: ['Test Thorn Flail', 'Test Bear', 'Plains', 'Plains', 'Plains'] } });
    const flail = find(s, 'Test Thorn Flail', 'battlefield', 'p1');
    s = equip(s, flail, find(s, 'Test Bear', 'battlefield', 'p1'));
    expect(attachedTo(s, flail)).toBe(find(s, 'Test Bear', 'battlefield', 'p1'));
    expect(s.zones.battlefield.filter((id) => s.objects[id]!.defId === 'Plains' && s.objects[id]!.tapped)).toHaveLength(3);
    const t = scenario([], { defs: EQUIP_DEFS, p1: { battlefield: ['Test Thorn Flail', 'Test Bear', 'Plains'] } });
    expect(legal(t, 'p1', 'activate').some((a) => a.object === find(t, 'Test Thorn Flail', 'battlefield', 'p1'))).toBe(false);
  });

  it('CR 702.6a, 602.5b: "Pay 3 life. Activate only once each turn.": the life is paid, and a second activation that turn is not offered', () => {
    let s = scenario([], { defs: EQUIP_DEFS, p1: { battlefield: ['Test Grim Sword', 'Test Bear', 'Test Ogre'] } });
    const sword = find(s, 'Test Grim Sword', 'battlefield', 'p1');
    const life = lifeOf(s, 'p1');
    s = equip(s, sword, find(s, 'Test Bear', 'battlefield', 'p1'));
    expect(attachedTo(s, sword)).toBe(find(s, 'Test Bear', 'battlefield', 'p1'));
    expect(lifeOf(s, 'p1')).toBe(life - 3);
    expect(legal(s, 'p1', 'activate').some((a) => a.object === sword)).toBe(false);
  });

  it('CR 702.6a, 701.21a: "Sacrifice another nonland permanent": the Equipment itself and lands can\'t pay it', () => {
    let s = scenario([], { defs: EQUIP_DEFS, p1: { battlefield: ['Test Shell Armor', 'Test Bear', 'Test Bauble', 'Plains'] } });
    const armor = find(s, 'Test Shell Armor', 'battlefield', 'p1');
    const bauble = find(s, 'Test Bauble', 'battlefield', 'p1');
    let x = activate(s, armor);
    let offered: ObjectId[] = [];
    for (let i = 0; i < 10 && x.pending && x.pending.kind !== 'priority'; i++) {
      const p = x.pending;
      if (p.kind === 'chooseTargets') x = answer(x, { kind: 'chooseTargets', targets: [{ kind: 'object', id: find(x, 'Test Bear', 'battlefield', 'p1') }] });
      else if (p.kind === 'chooseObjects') {
        offered = [...p.options];
        expect(offered.some((id) => x.objects[id]!.defId === 'Plains')).toBe(false);
        x = answer(x, { kind: 'chooseObjects', ids: [bauble] });
      }
      else break;
    }
    expect(offered).toEqual(expect.arrayContaining([bauble]));
    expect(offered).not.toContain(armor);
    s = passBoth(x);
    expect(attachedTo(s, armor)).toBe(find(s, 'Test Bear', 'battlefield', 'p1'));
    expect(s.zones.graveyard['p1']!.map((id) => s.objects[id]!.defId)).toContain('Test Bauble');
  });
});

// ---- typecycling by any subtype ---------------------------------------------------------------------------------------------------------------------------

const BURROW = card('Test Snug Burrow', 'Land', '{T}: Add {G}.\nHalflingcycling {1}', '');
const HALFLING = card('Test Hobbit', 'Creature — Halfling Peasant', '', '{G}', ['1', '1']);

describe('FAST5X E27 typecycling by any subtype (CR 702.29e)', () => {
  it('CR 702.29e: "Halflingcycling {1}" searches the library for a Halfling card and puts it into the hand', () => {
    expect(manualOf(BURROW)).toEqual([]);
    let s = scenario([], { defs: [BURROW, HALFLING, BEAR], p1: { hand: ['Test Snug Burrow'], battlefield: ['Plains'], library: ['Test Bear', 'Test Hobbit', 'Test Bear'] } });
    const burrow = find(s, 'Test Snug Burrow', 'hand', 'p1');
    s = activate(s, burrow);
    for (let i = 0; i < 4 && s.pending && s.pending.kind !== 'priority'; i++) if (s.pending.kind === 'payCost') s = answer(s, { kind: 'payCost', auto: true });
    s = passBoth(s);
    for (let i = 0; i < 4 && s.pending && s.pending.kind !== 'priority'; i++) {
      const p = s.pending;
      if (p.kind === 'chooseObjects') s = answer(s, { kind: 'chooseObjects', ids: p.options.filter((id) => s.objects[id]!.defId === 'Test Hobbit').slice(0, 1) });
      else break;
    }
    expect(s.zones.hand['p1']!.map((id) => s.objects[id]!.defId)).toEqual(['Test Hobbit']);
    expect(s.zones.graveyard['p1']!.map((id) => s.objects[id]!.defId)).toEqual(['Test Snug Burrow']);
  });
});

