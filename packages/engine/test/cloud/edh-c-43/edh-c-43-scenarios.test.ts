/**
 * Commander EDHREC ranks 29,501-30,000, round edh-c-43: the round's readings played through the engine with synthetic cards (invented names, design 6.10), compiled by the game's
 * default compiler. Each group has its negative cases. CR cites are from the Comprehensive Rules text of 2026-09-25 (media.wizards.com), read in the session.
 *
 *   CR 604.1, 613.4c, 508.1d       "As long as C, ~ gets +3/+0 and attacks each combat if able."
 *   CR 604.1, 613.4c, 609.4, 702.3b "As long as C, ~ gets +2/+2 and can attack as though it didn't have defender."
 *   CR 105.3, 613.1e, 613.1f       "As long as C, ~ is white and has \"{T}: ...\"."
 *   CR 604.1, 613.4c               "Enchanted creature gets +N/+N as long as it's an Elf / white. Otherwise, it gets -N/-N."
 *   CR 508.1d, 613.4c, 613.1f      "Enchanted creature gets +2/+1, has haste, and attacks each combat if able."
 *   CR 601.2f, 118.7               "This spell costs {1} less to cast if you control a Giant or a Wizard."
 *   CR 701.20a, 608.2c             "Reveal any number of black cards in your hand. ... where X is the number of cards revealed this way."
 *   CR 506.4, 508.1, 509.1         "~ gets +2/+0 as long as it isn't attacking or blocking."
 *   CR 105.2, 205.2, 702.16        "Green creatures and white creatures have protection from Gorgons."
 */
import { describe, expect, it } from 'vitest';
import { compileCard, activatedAbilities, type CardDef, type GameState, type ObjectId, type OracleCard } from '../../../src/index';
import { getChars } from '../../../src/rules/characteristics';
import { act, answer, find } from '../../m3/scenario';
import { declareAttackers, tweak, toDeclareAttackers } from '../../m4/helpers';
import { mpScenario, resolveStack, lifeOf } from '../../m12/rules/helpers';

function card(name: string, type: string, text: string, cost = '{0}', extra: Partial<OracleCard> = {}): CardDef {
  return compileCard({ name, layout: 'normal', mana_cost: cost, type_line: type, oracle_text: text, colors: [], ...extra } as OracleCard);
}
const full = (d: CardDef): boolean => d.automation.level === 'full';
const pt = (s: GameState, id: ObjectId): string => { const c = getChars(s, id)!; return `${c.power}/${c.toughness}`; };
const id = (s: GameState, name: string, zone: 'battlefield' | 'hand' = 'battlefield', p = 'p1'): ObjectId => find(s, name, zone, p);
const GY = (n: number): string[] => Array(n).fill('Test Scrap');
const SCRAP = card('Test Scrap', 'Artifact', '');
const BEAR = card('Test Bear', 'Creature — Bear', '', '{0}', { power: '3', toughness: '3' });

describe('CR 604.1, 613.4c, 508.1d: "As long as there are three or more cards in your graveyard, this creature gets +3/+0 and attacks each combat if able."', () => {
  const RAIDER = card('Test Raider', 'Creature — Ogre', 'As long as there are three or more cards in your graveyard, this creature gets +3/+0 and attacks each combat if able.', '{0}', { power: '2', toughness: '2' });
  const game = (n: number): GameState => mpScenario({ players: 3, defs: [RAIDER, SCRAP], zones: { p1: { battlefield: ['Test Raider'], graveyard: GY(n) } } });
  const must = (s: GameState): boolean => {
    const d = toDeclareAttackers(s).pending;
    if (d?.kind !== 'declareAttackers') throw new Error('no declareAttackers');
    return d.candidates.find((c) => c.id === id(s, 'Test Raider'))!.mustAttack === true;
  };
  it('is automated', () => expect(full(RAIDER)).toBe(true));
  it('three cards in the graveyard: 5/2 and it must attack', () => {
    const s = game(3);
    expect(pt(s, id(s, 'Test Raider'))).toBe('5/2');
    expect(must(s)).toBe(true);
  });
  it('two cards in the graveyard (negative): 2/2 and it is free to stay home', () => {
    const s = game(2);
    expect(pt(s, id(s, 'Test Raider'))).toBe('2/2');
    expect(must(s)).toBe(false);
  });
});

describe('CR 604.1, 613.4c, 609.4, 702.3b: "As long as you control two or more artifacts, this creature gets +2/+2 and can attack as though it didn\'t have defender."', () => {
  const SERPENT = card('Test Serpent', 'Creature — Serpent', "Defender\nAs long as you control two or more artifacts, this creature gets +2/+2 and can attack as though it didn't have defender.", '{0}', { power: '1', toughness: '1' });
  const GIZMO = card('Test Gizmo', 'Artifact', '');
  const game = (n: number): GameState => mpScenario({ players: 3, defs: [SERPENT, GIZMO], zones: { p1: { battlefield: ['Test Serpent', ...Array(n).fill('Test Gizmo')] } } });
  const attackers = (s: GameState): ObjectId[] => {
    try {
      const d = toDeclareAttackers(s).pending;
      return d?.kind === 'declareAttackers' ? d.candidates.map((c) => c.id) : [];
    } catch { return []; } // nothing may attack: no declaration is asked
  };
  it('is automated', () => expect(full(SERPENT)).toBe(true));
  it('two artifacts: 3/3 and it may attack', () => {
    const s = game(2);
    expect(pt(s, id(s, 'Test Serpent'))).toBe('3/3');
    expect(attackers(s)).toContain(id(s, 'Test Serpent'));
  });
  it('one artifact (negative): 1/1 and a defender cannot attack', () => {
    const s = game(1);
    expect(pt(s, id(s, 'Test Serpent'))).toBe('1/1');
    expect(attackers(s)).not.toContain(id(s, 'Test Serpent'));
  });
});

describe('CR 105.3, 613.1e, 613.1f: "As long as there are three or more cards in your graveyard, this creature is white and has \\"{T}: Destroy target black creature.\\""', () => {
  const VAMP = card('Test Vampire', 'Creature — Vampire', 'As long as there are three or more cards in your graveyard, this creature is white and has "{T}: Destroy target black creature."', '{B}', { power: '2', toughness: '2', colors: ['B'] });
  const game = (n: number): GameState => mpScenario({ players: 3, defs: [VAMP, SCRAP], zones: { p1: { battlefield: ['Test Vampire'], graveyard: GY(n) } } });
  const activated = (s: GameState): number => activatedAbilities(s, s.objects[id(s, 'Test Vampire')]!).filter((i) => i.def.isMana !== true).length;
  it('is automated', () => expect(full(VAMP)).toBe(true));
  it('three cards: it is white only (not black) and has the activated ability', () => {
    const s = game(3);
    expect(getChars(s, id(s, 'Test Vampire'))!.colors).toEqual(['W']);
    expect(activated(s)).toBe(1);
  });
  it('two cards (negative): still black, no ability', () => {
    const s = game(2);
    expect(getChars(s, id(s, 'Test Vampire'))!.colors).toEqual(['B']);
    expect(activated(s)).toBe(0);
  });
});

describe('CR 604.1, 613.4c: "Enchanted creature gets +2/+2 as long as it\'s an Elf. Otherwise, it gets -2/-2." and the color form', () => {
  const ELFAURA = card('Test Elf Aura', 'Enchantment — Aura', "Enchant creature\nEnchanted creature gets +2/+2 as long as it's an Elf. Otherwise, it gets -2/-2.");
  const WHITEAURA = card('Test Light Aura', 'Enchantment — Aura', "Enchant creature\nEnchanted creature gets +1/+2 as long as it's white. Otherwise, it gets -2/-1.");
  const ELF = card('Test Elf', 'Creature — Elf', '', '{0}', { power: '3', toughness: '3' });
  const PRIEST = card('Test Priest', 'Creature — Human Cleric', '', '{W}', { power: '3', toughness: '3', colors: ['W'] });
  const attached = (aura: string, victim: string): { s: GameState; v: ObjectId } => {
    let v = '';
    const s = mpScenario({ players: 3, defs: [ELFAURA, WHITEAURA, ELF, BEAR, PRIEST], zones: { p1: { battlefield: [victim, aura] } }, setup: (t) => {
      v = find(t, victim, 'battlefield', 'p1');
      t.objects[find(t, aura, 'battlefield', 'p1')]!.attachedTo = v;
    } });
    return { s, v };
  };
  it('are automated', () => { expect(full(ELFAURA)).toBe(true); expect(full(WHITEAURA)).toBe(true); });
  it('an Elf gets +2/+2; a non-Elf gets -2/-2 instead (never both)', () => {
    const a = attached('Test Elf Aura', 'Test Elf');
    expect(pt(a.s, a.v)).toBe('5/5');
    const b = attached('Test Elf Aura', 'Test Bear');
    expect(pt(b.s, b.v)).toBe('1/1');
  });
  it('a white creature gets +1/+2; a creature of another color gets -2/-1 instead', () => {
    const a = attached('Test Light Aura', 'Test Priest');
    expect(pt(a.s, a.v)).toBe('4/5');
    const b = attached('Test Light Aura', 'Test Bear');
    expect(pt(b.s, b.v)).toBe('1/2');
  });
});

describe('CR 508.1d, 613.4c, 613.1f: "Enchanted creature gets +2/+1, has haste, and attacks each combat if able."', () => {
  const RAGE = card('Test Rage Aura', 'Enchantment — Aura', 'Enchant creature\nEnchanted creature gets +2/+1, has haste, and attacks each combat if able.');
  const setup = (withAura: boolean): { s: GameState; v: ObjectId } => {
    let v = '';
    const s = mpScenario({ players: 3, defs: [RAGE, BEAR], zones: { p1: { battlefield: withAura ? ['Test Bear', 'Test Rage Aura'] : ['Test Bear'] } }, setup: (t) => {
      v = find(t, 'Test Bear', 'battlefield', 'p1');
      if (withAura) t.objects[find(t, 'Test Rage Aura', 'battlefield', 'p1')]!.attachedTo = v;
    } });
    return { s, v };
  };
  it('is automated', () => expect(full(RAGE)).toBe(true));
  it('enchanted: 5/4, haste, must attack; unenchanted (negative): 3/3, free to stay home', () => {
    const a = setup(true);
    expect(pt(a.s, a.v)).toBe('5/4');
    expect(getChars(a.s, a.v)!.keywords.some((k) => k.keyword === 'haste')).toBe(true);
    const da = toDeclareAttackers(a.s).pending;
    if (da?.kind !== 'declareAttackers') throw new Error('no declareAttackers');
    expect(da.candidates.find((c) => c.id === a.v)!.mustAttack).toBe(true);
    const b = setup(false);
    const db = toDeclareAttackers(b.s).pending;
    if (db?.kind !== 'declareAttackers') throw new Error('no declareAttackers');
    expect(db.candidates.find((c) => c.id === b.v)!.mustAttack).toBeFalsy();
  });
});

describe('CR 601.2f, 118.7: "This spell costs {1} less to cast if you control a Giant or a Wizard."', () => {
  const ARCANIST = card('Test Arcanist', 'Creature — Human Wizard', 'This spell costs {1} less to cast if you control a Giant or a Wizard.', '{1}{R}', { power: '2', toughness: '2', colors: ['R'] });
  const WIZ = card('Test Wizard', 'Creature — Human Wizard', '', '{0}', { power: '1', toughness: '1' });
  const GIANT = card('Test Giant', 'Creature — Giant', '', '{0}', { power: '4', toughness: '4' });
  const OGRE = card('Test Ogre', 'Creature — Ogre', '', '{0}', { power: '4', toughness: '4' });
  const cast = (other: string | null, lands: number): boolean => {
    const s = mpScenario({ players: 3, cards: ['Mountain'], defs: [ARCANIST, WIZ, GIANT, OGRE], zones: { p1: { hand: ['Test Arcanist'], battlefield: [...Array(lands).fill('Mountain'), ...(other === null ? [] : [other])] } } });
    try {
      let t = act(s, { type: 'cast', player: 'p1', card: find(s, 'Test Arcanist', 'hand', 'p1') } as never);
      if (t.pending?.kind === 'payCost') t = answer(t, { kind: 'payCost', auto: true });
      t = resolveStack(t, []);
      return t.zones.battlefield.some((x) => t.objects[x]!.defId === 'Test Arcanist');
    } catch { return false; }
  };
  it('is automated', () => expect(full(ARCANIST)).toBe(true));
  it('with a Giant or with a Wizard it costs {R}: one Mountain pays', () => { expect(cast('Test Giant', 1)).toBe(true); expect(cast('Test Wizard', 1)).toBe(true); });
  it('with neither (an Ogre, or nothing) it still costs {1}{R} (negative)', () => { expect(cast('Test Ogre', 1)).toBe(false); expect(cast(null, 1)).toBe(false); expect(cast(null, 2)).toBe(true); });
});

describe('CR 701.20a, 608.2c: "Reveal any number of black cards in your hand. Target creature gets -X/-X until end of turn, where X is the number of cards revealed this way."', () => {
  const NIGHT = card('Test Night Scent', 'Instant', 'Reveal any number of black cards in your hand. Target creature gets -X/-X until end of turn, where X is the number of cards revealed this way.', '{0}');
  const CINDER = card('Test Ember Scent', 'Instant', 'Reveal any number of red cards in your hand. Test Ember Scent deals X damage to any target, where X is the number of cards revealed this way.', '{0}');
  const BLACKS = [card('Test Dark One', 'Sorcery', '', '{B}', { colors: ['B'] }), card('Test Dark Two', 'Sorcery', '', '{B}', { colors: ['B'] })];
  const REDS = [card('Test Fire One', 'Sorcery', '', '{R}', { colors: ['R'] }), card('Test Fire Two', 'Sorcery', '', '{R}', { colors: ['R'] })];
  const WHITE = card('Test Pale One', 'Sorcery', '', '{W}', { colors: ['W'] });
  const VICTIM = card('Test Victim', 'Creature — Bear', '', '{0}', { power: '4', toughness: '4' });
  const DEFS = [NIGHT, CINDER, ...BLACKS, ...REDS, WHITE, VICTIM];
  const start = (spell: string, target: 'creature' | 'player'): { s: GameState; t: GameState } => {
    const s = mpScenario({ players: 3, defs: DEFS, zones: { p1: { hand: [spell, 'Test Dark One', 'Test Dark Two', 'Test Fire One', 'Test Fire Two', 'Test Pale One'] }, p2: { battlefield: ['Test Victim'] } } });
    const victim = find(s, 'Test Victim', 'battlefield', 'p2');
    let t = act(s, { type: 'cast', player: 'p1', card: find(s, spell, 'hand', 'p1') } as never);
    if (t.pending?.kind === 'chooseTargets') t = answer(t, { kind: 'chooseTargets', targets: [target === 'creature' ? { kind: 'object', id: victim } : { kind: 'player', id: 'p2' }] } as never);
    if (t.pending?.kind === 'payCost') t = answer(t, { kind: 'payCost', auto: true });
    return { s, t };
  };
  /** Cast, let it resolve up to the choice of cards to reveal, offer `reveal` of the offered cards (in order), finish. */
  const run = (spell: string, reveal: number, target: 'creature' | 'player'): GameState => {
    const { s, t } = start(spell, target);
    let u = t;
    for (let i = 0; i < 6 && u.pending?.kind === 'priority'; i++) u = act(u, { type: 'pass', player: u.pending.player });
    const d = u.pending as unknown as { kind: string; options: string[]; min: number; max: number | 'any' };
    expect(d.kind).toBe('chooseObjects');
    const names = d.options.map((o) => s.defs[u.objects[o]!.defId]!.name);
    expect(names.every((n) => /^Test (Dark|Fire)/.test(n)), `only cards of the color are offered: ${names.join(', ')}`).toBe(true);
    expect(names.length).toBe(2);
    expect(d.min).toBe(0);
    return resolveStack(answer(u, { kind: 'chooseObjects', ids: d.options.slice(0, reveal) } as never), []);
  };
  it('are automated', () => { expect(full(NIGHT)).toBe(true); expect(full(CINDER)).toBe(true); });
  it('Night: revealing two black cards gives -2/-2; revealing none gives -0/-0 (negative); the white card is never offered', () => {
    const two = run('Test Night Scent', 2, 'creature');
    expect(pt(two, find(two, 'Test Victim', 'battlefield', 'p2'))).toBe('2/2');
    const none = run('Test Night Scent', 0, 'creature');
    expect(pt(none, find(none, 'Test Victim', 'battlefield', 'p2'))).toBe('4/4');
  });
  it('Cinder: revealing two red cards deals 2 damage to the target player; revealing one deals 1', () => {
    expect(lifeOf(run('Test Ember Scent', 2, 'player'), 'p2')).toBe(18);
    expect(lifeOf(run('Test Ember Scent', 1, 'player'), 'p2')).toBe(19);
  });
});

describe('CR 506.4, 508.1, 509.1: "~ gets +2/+0 as long as it isn\'t attacking or blocking."', () => {
  const ACE = card('Test Ace', 'Creature — Pilot', "This creature gets +2/+0 as long as it isn't attacking or blocking.", '{0}', { power: '1', toughness: '2' });
  it('is automated', () => expect(full(ACE)).toBe(true));
  it('at rest 3/2; attacking 1/2 (negative)', () => {
    const s = mpScenario({ players: 3, defs: [ACE], zones: { p1: { battlefield: ['Test Ace'] } } });
    const ace = id(s, 'Test Ace');
    expect(pt(s, ace)).toBe('3/2');
    const t = declareAttackers(toDeclareAttackers(s), [[ace]]);
    expect(pt(t, ace)).toBe('1/2');
  });
});

describe('CR 105.2, 205.2, 702.16: "Green creatures and white creatures have protection from Gorgons."', () => {
  const GORGON = card('Test Gorgon', 'Creature — Gorgon', 'Green creatures and white creatures have protection from Gorgons.', '{B}', { power: '2', toughness: '2', colors: ['B'] });
  const G = card('Test Green One', 'Creature — Bear', '', '{G}', { power: '1', toughness: '1', colors: ['G'] });
  const W = card('Test White One', 'Creature — Bear', '', '{W}', { power: '1', toughness: '1', colors: ['W'] });
  const R = card('Test Red One', 'Creature — Bear', '', '{R}', { power: '1', toughness: '1', colors: ['R'] });
  it('is automated', () => expect(full(GORGON)).toBe(true));
  it('green and white creatures have it, red and the black Gorgon itself do not (negative)', () => {
    const s = mpScenario({ players: 3, defs: [GORGON, G, W, R], zones: { p1: { battlefield: ['Test Gorgon', 'Test Green One', 'Test White One', 'Test Red One'] } } });
    const has = (n: string): boolean => getChars(s, id(s, n))!.keywords.some((k) => k.keyword === 'protection');
    expect(has('Test Green One')).toBe(true);
    expect(has('Test White One')).toBe(true);
    expect(has('Test Red One')).toBe(false);
    expect(has('Test Gorgon')).toBe(false);
  });
});
