/**
 * FAST2 T7: the shapes of parser/templates/zz-fast2/t7.json (and the render and lowering support they needed) played through the engine with synthetic
 * cards compiled by the game's default compiler (invented wordings, design 6.10). Each test is named after the rule it checks.
 *
 *   CR 106.4, 605.3b   mana abilities whose mana is decided as they resolve: "{G} for each creature you control", "three mana of any one color",
 *                      "an amount of {G} equal to ~'s power", "one mana of the chosen color" (CR 607.2d); with "Sacrifice ~" they stay manual
 *   CR 106.1, 605.1a   "Add {B}{G}" and "Add {R}, {G}, or {U}" in any ability
 *   CR 613.1d, 700.5   "As long as your devotion to red is less than five, ~ isn't a creature."
 *   CR 613.4c          "~ gets +4/+4 for each other Giant you control."
 *   CR 702.6c          "Equip Wizard {1}": only a Wizard you control can be the target
 *   CR 702.5a, 303.4a  "Enchant creature or Vehicle": a Vehicle that is not a creature can be enchanted, an artifact cannot
 *   CR 601.2f, 118.7   "Blue spells and black spells you cast cost {1} less": once for a spell that is both
 *   CR 602.5, 605.1a   "Activated abilities of artifacts can't be activated." (mana abilities too)
 *   CR 111.4           "Create two 0/1 ... tokens. They have "Sacrifice ~: Add {C}."" is the same token as "... tokens with ..."
 *   CR 611.3a          "~ has first strike as long as it's attacking"; "... as long as it has a +1/+1 counter on it"; "As long as enchanted creature is
 *                      green, it gets +1/+1 and has trample" (the pronoun is the one object of the sentence, design 6.4)
 *   CR 208.2a, 110.1   "the number of Clerics on the battlefield" counts every player's Clerics
 *   CR 702.16g         "protection from black and from red" is two protection abilities (native keyword line, render/kw.ts)
 */
import { describe, expect, it } from 'vitest';
import { compileCard, type AbilityDef, type CardDef, type Color, type DecisionAnswer, type GameState, type ManaSymbol, type ObjectId, type OracleCard } from '../../../src/index';
import { getChars, hasKeyword } from '../../../src/rules/characteristics';
import { modifiedPlan } from '../../../src/actions/cast';
import { emptyPlan } from '../../../src/rules/cost';
import { act, answer, find, legal, pool, put, scenario } from '../../m3/scenario';
import { tweak } from '../../m4/helpers';

function card(name: string, type: string, text: string, opts: { pt?: [string, string]; cost?: string; colors?: Color[] } = {}): CardDef {
  return compileCard({
    name, layout: 'normal', mana_cost: opts.cost ?? '{0}', type_line: type, oracle_text: text, colors: opts.colors ?? [],
    ...(opts.pt ? { power: opts.pt[0], toughness: opts.pt[1] } : {}),
  } as OracleCard);
}
const level = (d: CardDef): string => d.automation.level;
const kinds = (d: CardDef): string[] => d.faces[0]!.abilities.map((a: AbilityDef) => a.kind);
const pt = (s: GameState, id: ObjectId): string => { const c = getChars(s, id)!; return `${c.power}/${c.toughness}`; };
const manaText = (m: readonly ManaSymbol[]): string => m.map((x) => (x.kind === 'generic' ? `{${x.amount}}` : x.kind === 'colored' ? `{${x.color}}` : `{${x.kind}}`)).join('') || '{0}';
/** Activate the first activated ability of `name` offered to p1, answering a color choice with `color`. */
function activate(s: GameState, name: string, color?: DecisionAnswer): GameState {
  const id = find(s, name, 'battlefield');
  const a = legal(s, 'p1', 'activate').find((x) => x.object === id);
  if (!a) throw new Error(`${name}: no activation offered`);
  let t = act(s, a.action);
  if (t.pending?.kind === 'chooseColor') t = answer(t, color ?? { kind: 'chooseColor', color: 'G' });
  return t;
}
/** An automated (not manual) activated mana ability is on the card. */
const automatedMana = (d: CardDef): boolean => d.faces[0]!.abilities.some((a) => a.kind === 'activated' && a.isMana === true);

const BEAR = card('Test Bear', 'Creature — Bear', '', { pt: ['2', '2'] });

describe('design 6.9: the T7 templates are stable, so a card they read completely is fully automated', () => {
  it('CR 106.4, 613.4c, 702.6c, 601.2f, 602.5: one card per family is full', () => {
    const cards = [
      card('Test Full Cradle', 'Land', '{T}: Add {G} for each creature you control.'),
      card('Test Full Lotus', 'Artifact', '{T}: Add three mana of any one color.'),
      card('Test Full Giant', 'Creature — Giant', 'This creature gets +4/+4 for each other Giant you control.', { pt: ['4', '3'] }),
      card('Test Full Staff', 'Artifact — Equipment', 'Equip Wizard {1}'),
      card('Test Full Familiar', 'Creature — Bird', 'Blue spells and black spells you cast cost {1} less to cast.', { pt: ['1', '1'] }),
      card('Test Full Rod', 'Artifact', "Activated abilities of artifacts can't be activated."),
      card('Test Full Lancer', 'Creature — Human Knight', "This creature has first strike as long as it's attacking.", { pt: ['2', '2'] }),
    ];
    for (const d of cards) expect(level(d), d.name).toBe('full');
  });
});

describe('CR 106.4, 605.3b: mana abilities whose mana is decided as they resolve (the WP31 resolver)', () => {
  const CRADLE = card('Test Cradle', 'Land', '{T}: Add {G} for each creature you control.');
  const LOTUS = card('Test Lotus', 'Artifact', '{T}: Add three mana of any one color.');
  const DRUID = card('Test Druid', 'Creature — Elf Druid', "{T}: Add an amount of {G} equal to this creature's power.", { pt: ['3', '1'] });
  const GRAIL = card('Test Grail', 'Artifact', 'As this artifact enters, choose a color.\n{T}: Add one mana of the chosen color.');
  const PETAL = card('Test Petal', 'Creature — Elf', "{T}, Sacrifice this creature: Add an amount of {G} equal to this creature's power.", { pt: ['2', '2'] });
  const BLOOM = card('Test Bloom', 'Artifact', '{T}, Sacrifice this artifact: Add three mana of any one color.');

  it('CR 605.1a: the abilities are automated mana abilities; with "Sacrifice ~" as a cost the source is gone when the amount is read, so it stays manual', () => {
    for (const d of [CRADLE, LOTUS, DRUID, GRAIL]) expect(automatedMana(d), d.name).toBe(true);
    expect(automatedMana(PETAL)).toBe(false);
    expect(PETAL.automation.requiresEngine).toContain('feature:mana.steps');
    expect(automatedMana(BLOOM)).toBe(true); // reads nothing of its source
  });

  it('CR 106.4, 605.3b: "{T}, Sacrifice ~: Add three mana of any one color": sacrificed as a cost, then three mana of the chosen color', () => {
    const s = scenario([], { p1: { battlefield: ['Test Bloom'] }, defs: [BLOOM] });
    const t = activate(s, 'Test Bloom', { kind: 'chooseColor', color: 'R' });
    expect(pool(t, 'p1')).toBe('RRR');
    expect(t.zones.battlefield.some((id) => t.objects[id]!.defId === 'Test Bloom')).toBe(false);
  });

  it('CR 106.4: "{G} for each creature you control" adds one {G} per creature its controller controls, and nothing for the opponent\'s', () => {
    const s = scenario([], { p1: { battlefield: ['Test Cradle', 'Test Bear', 'Test Bear'] }, p2: { battlefield: ['Test Bear'] }, defs: [CRADLE, BEAR] });
    const t = activate(s, 'Test Cradle');
    expect(pool(t, 'p1')).toBe('GG');
    expect(t.objects[find(t, 'Test Cradle', 'battlefield')]!.tapped).toBe(true);
  });

  it('CR 106.4: "three mana of any one color" asks for one color and adds three of it', () => {
    const s = scenario([], { p1: { battlefield: ['Test Lotus'] }, defs: [LOTUS] });
    expect(pool(activate(s, 'Test Lotus', { kind: 'chooseColor', color: 'B' }), 'p1')).toBe('BBB');
  });

  it('CR 106.4, 208.3: "an amount of {G} equal to this creature\'s power" reads its power as it resolves', () => {
    const s = scenario([], { p1: { battlefield: ['Test Druid'] }, defs: [DRUID] });
    expect(pool(activate(s, 'Test Druid'), 'p1')).toBe('GGG');
  });

  it('CR 607.2d, 106.4: "one mana of the chosen color" adds the color chosen as it entered', () => {
    const s = scenario([], { p1: { battlefield: ['Test Grail'] }, defs: [GRAIL] });
    const chosen = tweak(s, (t) => { t.objects[find(t, 'Test Grail', 'battlefield')]!.links = { color: { values: ['red'] } }; });
    expect(pool(activate(chosen, 'Test Grail'), 'p1')).toBe('R');
  });
});

describe('CR 106.1, 605.1a: "Add {B}{G}" and "Add {R}, {G}, or {U}" (eff.t7.mana.units)', () => {
  const TWO = card('Test Twin Stone', 'Artifact', '{T}: Add {B}{G}.');
  const THREE = card('Test Tri Stone', 'Artifact', '{T}: Add {R}, {G}, or {U}.');

  it('CR 106.1: a run of symbols adds each of them; a list adds one of its types', () => {
    expect(automatedMana(TWO)).toBe(true);
    expect(automatedMana(THREE)).toBe(true);
    const s = scenario([], { p1: { battlefield: ['Test Twin Stone', 'Test Tri Stone'] }, defs: [TWO, THREE] });
    expect(pool(activate(s, 'Test Twin Stone'), 'p1')).toBe('BG');
    expect(pool(activate(s, 'Test Tri Stone', { kind: 'chooseColor', color: 'U' }), 'p1')).toBe('U');
  });
});

describe('CR 613.1d, 700.5: "As long as your devotion to red is less than five, ~ isn\'t a creature."', () => {
  const GOD = card('Test Forge God', 'Legendary Enchantment Creature — God', "Indestructible\nAs long as your devotion to red is less than five, this creature isn't a creature.", { pt: ['6', '5'], cost: '{3}{R}', colors: ['R'] });
  const ZEALOT = card('Test Zealot', 'Creature — Human', '', { pt: ['1', '1'], cost: '{R}{R}{R}{R}', colors: ['R'] });

  it('CR 613.1d: below the devotion it is an enchantment and not a creature; at five it is a creature again', () => {
    expect(kinds(GOD)).toEqual(['keyword', 'static']);
    const s = scenario([], { p1: { battlefield: ['Test Forge God'] }, defs: [GOD, ZEALOT] });
    const god = find(s, 'Test Forge God', 'battlefield');
    expect(getChars(s, god)!.types).toEqual(['Enchantment']);
    const devoted = scenario([], { p1: { battlefield: ['Test Forge God', 'Test Zealot'] }, defs: [GOD, ZEALOT] }); // {R} + {R}{R}{R}{R}: devotion 5
    expect(getChars(devoted, find(devoted, 'Test Forge God', 'battlefield'))!.types).toEqual(['Enchantment', 'Creature']);
  });
});

describe('CR 613.4c: "~ gets +4/+4 for each other Giant you control."', () => {
  const GIANT = card('Test Giant', 'Creature — Giant', 'This creature gets +4/+4 for each other Giant you control.', { pt: ['4', '3'] });
  const HILL = card('Test Hill Giant', 'Creature — Giant', '', { pt: ['3', '3'] });

  it('CR 613.4c: +4/+4 per OTHER Giant its controller controls (not itself, not the opponent\'s)', () => {
    const s = scenario([], { p1: { battlefield: ['Test Giant', 'Test Hill Giant', 'Test Hill Giant'] }, p2: { battlefield: ['Test Hill Giant'] }, defs: [GIANT, HILL] });
    expect(pt(s, find(s, 'Test Giant', 'battlefield'))).toBe('12/11');
    const alone = scenario([], { p1: { battlefield: ['Test Giant'] }, defs: [GIANT, HILL] });
    expect(pt(alone, find(alone, 'Test Giant', 'battlefield'))).toBe('4/3');
  });
});

describe('CR 702.6c: "Equip Wizard {1}"', () => {
  const STAFF = card('Test Staff', 'Artifact — Equipment', 'Equipped creature gets +1/+0.\nEquip Wizard {1}');
  const WIZARD = card('Test Wizard', 'Creature — Human Wizard', '', { pt: ['1', '1'] });

  it('CR 702.6a, 702.6c: the only legal target is a Wizard its controller controls', () => {
    expect(kinds(STAFF)).toEqual(['static', 'keyword']);
    const s = scenario([], { p1: { battlefield: ['Test Staff', 'Test Wizard', 'Test Bear', 'Plains'] }, p2: { battlefield: ['Test Wizard'] }, defs: [STAFF, WIZARD, BEAR] });
    const staff = find(s, 'Test Staff', 'battlefield');
    const a = legal(s, 'p1', 'activate').find((x) => x.object === staff)!;
    const t = act(s, a.action);
    expect(t.pending?.kind).toBe('chooseTargets');
    const d = t.pending as Extract<NonNullable<GameState['pending']>, { kind: 'chooseTargets' }>;
    expect(d.objects).toEqual([find(s, 'Test Wizard', 'battlefield', 'p1')]);
  });
});

describe('CR 702.5a, 303.4a: "Enchant creature or Vehicle"', () => {
  const AURA = card('Test Plating', 'Enchantment — Aura', 'Enchant creature or Vehicle\nEnchanted permanent has vigilance.');
  const VEHICLE = card('Test Cart', 'Artifact — Vehicle', 'Crew 1', { pt: ['3', '3'] });
  const ROCK = card('Test Rock', 'Artifact', '');

  it('CR 303.4a: the Aura spell can target a creature or a Vehicle, not another artifact', () => {
    const s = scenario([], { p1: { hand: ['Test Plating'], battlefield: ['Test Cart', 'Test Rock', 'Test Bear'] }, defs: [AURA, VEHICLE, ROCK, BEAR] });
    const t = act(s, { type: 'cast', player: 'p1', card: find(s, 'Test Plating', 'hand') });
    expect(t.pending?.kind).toBe('chooseTargets');
    const d = t.pending as Extract<NonNullable<GameState['pending']>, { kind: 'chooseTargets' }>;
    expect([...d.objects].sort()).toEqual([find(s, 'Test Cart', 'battlefield'), find(s, 'Test Bear', 'battlefield')].sort());
  });
});

describe('CR 601.2f, 118.7: "Blue spells and black spells you cast cost {1} less to cast."', () => {
  const FAMILIAR = card('Test Familiar', 'Creature — Bird', 'Blue spells and black spells you cast cost {1} less to cast.', { pt: ['1', '1'] });
  const SPELL = (name: string, cost: string, colors: Color[]): CardDef => card(name, 'Sorcery', 'Draw a card.', { cost, colors });
  const BLUE = SPELL('Test Blue Thought', '{2}{U}', ['U']);
  const BOTH = SPELL('Test Dark Thought', '{2}{U}{B}', ['U', 'B']);
  const RED = SPELL('Test Red Thought', '{2}{R}', ['R']);
  const costOf = (s: GameState, name: string, def: CardDef): string => {
    const id = find(s, name, 'hand');
    const m = modifiedPlan(s, 'p1', id, { ...emptyPlan(), mana: (def.faces[0]!.manaCost ?? []).filter((x) => x.kind !== 'variable') });
    return 'plan' in m ? manaText(m.plan.mana) : `denied: ${m.denial.message}`;
  };

  it('CR 118.7, 601.2f: {1} less for a blue spell, {1} less ONCE for a blue and black spell, nothing for a red spell', () => {
    const s = scenario([], { p1: { hand: ['Test Blue Thought', 'Test Dark Thought', 'Test Red Thought'], battlefield: ['Test Familiar'] }, defs: [FAMILIAR, BLUE, BOTH, RED] });
    expect(costOf(s, 'Test Blue Thought', BLUE)).toBe('{1}{U}');
    expect(costOf(s, 'Test Dark Thought', BOTH)).toBe('{1}{U}{B}');
    expect(costOf(s, 'Test Red Thought', RED)).toBe('{2}{R}');
  });
});

describe('CR 602.5, 605.1a: "Activated abilities of artifacts can\'t be activated."', () => {
  const ROD = card('Test Rod', 'Artifact', "Activated abilities of artifacts can't be activated.");
  const STONE = card('Test Stone', 'Artifact', '{T}: Add {C}.');
  const ELF = card('Test Elf', 'Creature — Elf', '{T}: Add {G}.', { pt: ['1', '1'] });

  it('CR 605.1a: an artifact\'s mana ability is not offered while the ban is there; a creature\'s is', () => {
    const s = scenario([], { p1: { battlefield: ['Test Rod', 'Test Stone', 'Test Elf'] }, defs: [ROD, STONE, ELF] });
    const offered = legal(s, 'p1', 'activate').map((a) => a.object);
    expect(offered).not.toContain(find(s, 'Test Stone', 'battlefield'));
    expect(offered).toContain(find(s, 'Test Elf', 'battlefield'));
    const free = scenario([], { p1: { battlefield: ['Test Stone'] }, defs: [ROD, STONE, ELF] });
    expect(legal(free, 'p1', 'activate').map((a) => a.object)).toContain(find(free, 'Test Stone', 'battlefield'));
  });
});

describe('CR 111.4: "Create two ... tokens. They have "Sacrifice ~: Add {C}.""', () => {
  const RIDER = card('Test Brood', 'Artifact', '{T}: Create two 0/1 colorless Eldrazi Spawn creature tokens. They have "Sacrifice this creature: Add {C}."');
  const WITH = card('Test Brood', 'Artifact', '{T}: Create two 0/1 colorless Eldrazi Spawn creature tokens with "Sacrifice this creature: Add {C}."');

  it('CR 111.4, 608.2c: the second sentence gives the tokens their ability: the same token as the "with" wording, and it taps for {C}', () => {
    const effect = (d: CardDef): unknown => JSON.parse(JSON.stringify((d.faces[0]!.abilities[0] as { effect: unknown }).effect, (k, v) => (k === 'text' || k === 'span' || k === 'sentence' ? undefined : v)));
    expect(effect(RIDER)).toEqual(effect(WITH));
    const s = scenario([], { p1: { battlefield: ['Test Brood'] }, defs: [RIDER] });
    let t = activate(s, 'Test Brood');
    while (t.pending?.kind === 'priority' && t.zones.stack.length > 0) t = act(t, { type: 'pass', player: t.pending.player });
    const tokens = t.zones.battlefield.filter((id) => t.objects[id]!.kind === 'token');
    expect(tokens).toHaveLength(2);
    const a = legal(t, 'p1', 'activate').find((x) => x.object === tokens[0]);
    expect(a?.isMana).toBe(true);
    const after = act(t, a!.action);
    expect(pool(after, 'p1')).toBe('C');
    expect(after.zones.battlefield).not.toContain(tokens[0]);
  });
});

describe('CR 611.3a: "it" in a static ability is the one object it names (lower/static-anaphora.ts)', () => {
  const LANCER = card('Test Lancer', 'Creature — Human Knight', "This creature has first strike as long as it's attacking.", { pt: ['2', '2'] });
  const WALKER = card('Test Walker', 'Creature — Human', 'This creature has flying as long as it has a +1/+1 counter on it.', { pt: ['2', '2'] });
  const FAVOR = card('Test Favor', 'Enchantment — Aura', 'Enchant creature\nAs long as enchanted creature is green, it gets +1/+1 and has trample.');
  const GREEN = card('Test Green Bear', 'Creature — Bear', '', { pt: ['2', '2'], cost: '{1}{G}', colors: ['G'] });

  it('CR 506.4: first strike only while it is an attacking creature', () => {
    const s = scenario([], { p1: { battlefield: ['Test Lancer'] }, defs: [LANCER] });
    const id = find(s, 'Test Lancer', 'battlefield');
    expect(hasKeyword(getChars(s, id)!, 'first strike')).toBe(false);
    const attacking = tweak(s, (t) => {
      t.combat = { number: 1, attacked: true, attackers: [{ id, defender: 'p2', defendingPlayer: 'p2', blockedBy: [], blocked: false }], blockers: [], damageSteps: 0, extraDamageStep: false, firstStrikers: [] };
    });
    expect(hasKeyword(getChars(attacking, id)!, 'first strike')).toBe(true);
  });

  it('CR 122.1: flying only while a +1/+1 counter is on it', () => {
    const s = scenario([], { p1: { battlefield: ['Test Walker'] }, defs: [WALKER] });
    const id = find(s, 'Test Walker', 'battlefield');
    expect(hasKeyword(getChars(s, id)!, 'flying')).toBe(false);
    const countered = tweak(s, (t) => { t.objects[id]!.counters = { '+1/+1': 1 }; });
    expect(hasKeyword(getChars(countered, id)!, 'flying')).toBe(true);
    expect(pt(countered, id)).toBe('3/3');
  });

  it('CR 303.4b: the enchanted creature gets +1/+1 and trample while it is green', () => {
    // the Aura is put onto the battlefield attached (an unattached Aura would be put into the graveyard, CR 704.5m)
    const s = scenario([], { p1: { battlefield: ['Test Green Bear', 'Test Bear'] }, defs: [FAVOR, GREEN, BEAR] });
    const on = (host: string): GameState => tweak(s, (t) => { t.objects[put(t, 'p1', 'battlefield', 'Test Favor')]!.attachedTo = find(t, host, 'battlefield'); });
    const green = on('Test Green Bear');
    expect(pt(green, find(green, 'Test Green Bear', 'battlefield'))).toBe('3/3');
    expect(hasKeyword(getChars(green, find(green, 'Test Green Bear', 'battlefield'))!, 'trample')).toBe(true);
    const plain = on('Test Bear');
    expect(pt(plain, find(plain, 'Test Bear', 'battlefield'))).toBe('2/2');
  });
});

describe('CR 208.2a: "~\'s power and toughness are each equal to the number of Clerics on the battlefield."', () => {
  const ONE = card('Test Choir', 'Creature — Human Cleric', "This creature's power and toughness are each equal to the number of Clerics on the battlefield.", { pt: ['*', '*'] });
  const CLERIC = card('Test Cleric', 'Creature — Human Cleric', '', { pt: ['1', '1'] });

  it('CR 208.2a, 604.3: counts itself and every player\'s Clerics', () => {
    const s = scenario([], { p1: { battlefield: ['Test Choir', 'Test Cleric'] }, p2: { battlefield: ['Test Cleric'] }, defs: [ONE, CLERIC] });
    expect(pt(s, find(s, 'Test Choir', 'battlefield'))).toBe('3/3');
  });
});

describe('CR 702.16g: "protection from black and from red" (the native keyword line, render/kw.ts)', () => {
  const PALADIN = card('Test Paladin', 'Creature — Human Knight', 'First strike, protection from black and from red', { pt: ['2', '2'] });

  it('CR 702.16g: two protection abilities, and the card is fully automated', () => {
    expect(level(PALADIN)).toBe('full');
    const kw = PALADIN.faces[0]!.abilities.filter((a) => a.kind === 'keyword').map((a) => (a as { keyword: string; quality?: string }).quality ?? (a as { keyword: string }).keyword);
    expect(kw).toEqual(['first strike', 'color:B', 'color:R']);
  });
});
