/**
 * FAST5X E27 review fixes (a card is full only if it plays exactly as written):
 *
 *  1. CR 115.1, 601.2c: "target artifact, enchantment, or creature with flying" (Vivien Reid, Broken Wings) is an artifact, an enchantment, or a creature
 *     with flying: the keyword belongs to the last noun only. One filter {types:[...], keyword} asked flying of every type, so a plain artifact or enchantment
 *     could never be targeted (and the -3 was not offered when only those were there). The Filter hole now reads a keyword after a list of card types as
 *     { anyOf: [{ types: the others }, { types: [the last], keyword }] } (parser/holes/filter.ts#keywordOnLastType) and the renderer says it back
 *     (render/np.ts); any other list of kinds with a keyword (subtypes, or types and subtypes mixed) has no reading.
 *  2. CR 114.4, 113.6, 602.1: an emblem's activated ability functions in the command zone, but the legal-action loop (core/legal.ts) lists no emblem's
 *     activated ability (only cards in the command zone). Such an emblem ability needs `feature:emblem.activated`, which no table advertises
 *     (model/cap-walk.ts): the emblem ability is manual, so "-7: You get an emblem with "Tap an untapped artifact you control: ..."" (Karn, Living Legacy)
 *     is no longer full.
 */
import { describe, expect, it } from 'vitest';
import { compileCard, type AbilityDef, type CardDef, type OracleCard } from '../../../src/index';
import { ENGINE_CAPABILITIES, missingCapabilities } from '../../../src/model/capabilities';
import { act, answer, find, legal, passBoth, scenario } from '../../m3/scenario';

function card(name: string, type: string, text: string, cost = '{0}', pt?: [string, string], loyalty?: string): CardDef {
  return compileCard({
    name, layout: 'normal', mana_cost: cost, type_line: type, oracle_text: text, colors: [], keywords: [],
    ...(pt ? { power: pt[0], toughness: pt[1] } : {}), ...(loyalty ? { loyalty } : {}),
  } as OracleCard);
}
const isManual = (a: AbilityDef): boolean => a.kind === 'manual' || JSON.stringify(a).includes('"op":"manual"') || JSON.stringify(a).includes('"kind":"manual"');
const hasSpreadKeyword = (x: unknown): boolean => {
  if (Array.isArray(x)) return x.some(hasSpreadKeyword);
  if (x === null || typeof x !== 'object') return false;
  const r = x as Record<string, unknown>;
  const types = r['types'];
  if (Array.isArray(types) && types.length > 1 && (r['keyword'] !== undefined || r['notKeyword'] !== undefined)) return true;
  return Object.values(r).some(hasSpreadKeyword);
};

const VIVIEN_TEXT = '+1: Look at the top four cards of your library. You may reveal a creature or land card from among them and put it into your hand. Put the rest on the bottom of your library in a random order.\n−3: Destroy target artifact, enchantment, or creature with flying.\n−8: You get an emblem with "Creatures you control get +2/+2 and have vigilance, trample, and indestructible."';

const KEYWORD_LAST = { anyOf: [{ types: ['Artifact', 'Enchantment'] }, { types: ['Creature'], keyword: 'flying' }] };
const VIVIEN = card('Test Vivien', 'Legendary Planeswalker — Vivien', VIVIEN_TEXT, '{3}{G}{G}', undefined, '5');
const BAUBLE = card('Test Bauble', 'Artifact', '', '{0}');
const BEAR = card('Test Bear', 'Creature — Bear', '', '{1}', ['2', '2']);
const BIRD = card('Test Bird', 'Creature — Bird', 'Flying', '{1}', ['1', '1']);

describe('E27 review 1 (CR 115.1, 601.2c): a keyword after a list of card types belongs to the last type only', () => {
  it('Vivien Reid: the -3 targets an artifact, an enchantment, or a creature with flying (anyOf), and the card is full', () => {
    const abilities = VIVIEN.faces[0]!.abilities;
    expect(abilities).toHaveLength(3);
    expect(hasSpreadKeyword(abilities)).toBe(false);
    const minus3 = abilities[1] as Extract<AbilityDef, { kind: 'activated' }>;
    expect(minus3.effect.targets[0]).toMatchObject({ kind: 'object', min: 1, max: 1, filter: KEYWORD_LAST });
    expect(VIVIEN.automation.level).toBe('full');
  });
  it('CR 601.2c, 606.3: with only a plain artifact and a creature without flying, the -3 is offered; it destroys the artifact; the creature is no legal target', () => {
    let s = scenario([], { defs: [VIVIEN, BAUBLE, BEAR, BIRD], p1: { battlefield: [{ name: 'Test Vivien', counters: { loyalty: 5 } }] }, p2: { battlefield: ['Test Bauble', 'Test Bear'] } });
    const walker = find(s, 'Test Vivien', 'battlefield', 'p1');
    const offers = legal(s, 'p1', 'activate').filter((a) => a.object === walker);
    expect(offers).toHaveLength(2); // +1 and -3 (CR 606.3: one loyalty ability per turn; -8 needs 8 loyalty)
    const minus3 = offers.find((a) => a.label.includes('Destroy'))!;
    expect(minus3).toBeDefined();
    const bauble = find(s, 'Test Bauble', 'battlefield', 'p2');
    const bear = find(s, 'Test Bear', 'battlefield', 'p2');
    s = act(s, minus3.action);
    expect(s.pending?.kind).toBe('chooseTargets');
    expect(() => answer(s, { kind: 'chooseTargets', targets: [{ kind: 'object', id: bear }] })).toThrow();
    s = answer(s, { kind: 'chooseTargets', targets: [{ kind: 'object', id: bauble }] });
    for (let i = 0; i < 5 && s.pending && s.pending.kind === 'payCost'; i++) s = answer(s, { kind: 'payCost', auto: true });
    s = passBoth(s);
    expect(s.objects[bauble]?.zone).not.toBe('battlefield');
    expect(s.zones.battlefield).toContain(bear);
  });
  it('CR 601.2c: a creature with flying is a legal target', () => {
    let s = scenario([], { defs: [VIVIEN, BAUBLE, BEAR, BIRD], p1: { battlefield: [{ name: 'Test Vivien', counters: { loyalty: 5 } }] }, p2: { battlefield: ['Test Bird'] } });
    const walker = find(s, 'Test Vivien', 'battlefield', 'p1');
    const bird = find(s, 'Test Bird', 'battlefield', 'p2');
    s = act(s, legal(s, 'p1', 'activate').find((a) => a.object === walker && a.label.includes('Destroy'))!.action);
    s = answer(s, { kind: 'chooseTargets', targets: [{ kind: 'object', id: bird }] });
    for (let i = 0; i < 5 && s.pending && s.pending.kind === 'payCost'; i++) s = answer(s, { kind: 'payCost', auto: true });
    s = passBoth(s);
    expect(s.zones.battlefield).not.toContain(bird);
  });
  it('the same reading for two types, "without", and "all ... and ..."; a list of subtypes with a keyword has no reading; other phrases are unchanged', () => {
    const json = (t: string): string => JSON.stringify(card('Example Spell', 'Sorcery', t).faces[0]!.abilities);
    for (const t of ['Destroy target artifact or creature with flying.', 'Destroy target enchantment or creature without flying.', 'Exile all artifacts and creatures with flying.']) {
      const d = card('Example Spell', 'Sorcery', t);
      expect(hasSpreadKeyword(d.faces[0]!.abilities), t).toBe(false);
      expect(d.automation.level, t).toBe('full');
    }
    expect(json('Destroy target artifact or creature with flying.')).toContain('"anyOf":[{"types":["Artifact"]},{"types":["Creature"],"keyword":"flying"}]');
    expect(json('Destroy target enchantment or creature without flying.')).toContain('"anyOf":[{"types":["Enchantment"]},{"types":["Creature"],"notKeyword":"flying"}]');
    // subtypes (or card types and subtypes mixed): no reading, never the spread filter
    for (const t of ['Destroy target Elf or Goblin with flying.', 'Destroy target creature or Vehicle with flying.']) {
      const d = card('Example Spell', 'Sorcery', t);
      expect(hasSpreadKeyword(d.faces[0]!.abilities), t).toBe(false);
      expect(JSON.stringify(d.faces[0]!.abilities), t).not.toContain('"keyword":"flying"');
      expect(d.automation.level, t).not.toBe('full');
    }
    // one kind with a keyword, a type line of several types ("artifact creature"), and a list of kinds with "you control" (both nouns) are unchanged
    for (const t of ['Destroy target creature with flying.', 'Destroy target artifact creature with flying.', 'Destroy target artifact or creature you control.']) {
      expect(card('Example Spell', 'Sorcery', t).automation.level, t).toBe('full');
    }
    expect(json('Destroy target artifact or creature you control.')).toContain('"types":["Artifact","Creature"]');
  });
});

const KARN_MINUS_7 = '−7: You get an emblem with "Tap an untapped artifact you control: This emblem deals 1 damage to any target."';

describe('E27 review 2 (CR 114.4, 113.6): an emblem with an activated ability is never counted as automated while no emblem ability can be activated', () => {
  it('the -7 of Karn, Living Legacy: the ability of the emblem is manual (needs feature:emblem.activated, which no table advertises), so the -7 is not full', () => {
    const d = card('Example Karn', 'Legendary Planeswalker — Karn', KARN_MINUS_7, '{4}', undefined, '4');
    const [minus] = d.faces[0]!.abilities;
    expect(minus!.kind).toBe('activated');
    const step = (minus as Extract<AbilityDef, { kind: 'activated' }>).effect.steps[0] as { op: string; abilities: AbilityDef[] };
    expect(step.op).toBe('createEmblem');
    expect(step.abilities.map((a) => a.kind)).toEqual(['manual']);
    expect(isManual(minus!)).toBe(true);
    expect(d.automation.level).not.toBe('full');
    expect(d.automation.requiresEngine).toContain('feature:emblem.activated');
  });
  it('the walker names the gap on the parsed ability (written JSON), and an emblem with a static or triggered ability needs nothing more', () => {
    const written = {
      kind: 'activated', text: KARN_MINUS_7, isLoyalty: true, cost: { loyalty: -7 }, effect: { targets: [], steps: [{ op: 'createEmblem', who: { ref: 'you' }, abilities: [
        { kind: 'activated', text: 'Tap an untapped artifact you control: This emblem deals 1 damage to any target.', cost: { tap: false, other: [{ kind: 'tapUntapped', count: 1, filter: { types: ['Artifact'], controller: 'you' } }] },
          effect: { targets: [{ id: 't0', kind: 'anyTarget', min: 1, max: 1 }], steps: [{ op: 'damage', source: { ref: 'self' }, to: { ref: 'target', id: 't0' }, amount: 1 }] } },
      ] }] },
    } as unknown as AbilityDef;
    expect(missingCapabilities(written, ENGINE_CAPABILITIES)).toContain('feature:emblem.activated');
    const anthem = card('Example Walker', 'Legendary Planeswalker — Testa', '-2: You get an emblem with "Creatures you control get +1/+1."', '{3}', undefined, '5');
    expect(anthem.automation.level).toBe('full');
  });
});
