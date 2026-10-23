/**
 * Cloud batch 2, slice std-ecl (the Standard backlog of Lorwyn Eclipsed, tuning half): the template data of parser/templates/zz-cloud/std-ecl.json and the
 * hole, lowering and renderer support the slice needed. Guard G9 (design 6.8): every example lowers with its template, is automated and passes the exact render
 * gate (G6); every counter-example does not parse or parses to different JSON; near-miss mutations fail or differ; a nonsense word in place of any word of an
 * example never leaves an automated card (G2). Examples are synthetic wordings (design 6.10), checked against the local index when it is present. The behavior
 * is in std-ecl-scenarios.test.ts.
 */
import { describe, expect, it } from 'vitest';
import type { OracleCard } from '../../../src/index';
import { compileCard } from '../../../src/index';
import type { Template } from '../../../src/parser/types';
import type { AbilityDef, EffectStep, TargetSpec } from '../../../src/types/ability';
import { defaultParseOptions, parseCard } from '../../../src/parser/parse';
import { validateTemplates } from '../../../src/parser/chart';
import { TEMPLATE_FILES, TEMPLATE_SET } from '../../../src/parser/template-set';
import { ENGINE_CAPABILITIES } from '../../../src/model/capabilities';
import stdEcl from '../../../src/parser/templates/zz-cloud/std-ecl.json';
import review from '../../m5/golden/cards/cloud-std-ecl-review.json';
import r4FxbReview from '../../m5/golden/cards/cloud-r4-fxb-review.json'; // Standard round 4 r4-fxb: Bard's Company, the conditional flash's third golden card
import { automated, bare, card, fullyAutomated, jsonKey } from '../../m5/templates/support';
import { localIndex } from '../../m5/parser/support';
import { accepts, bound, rejects, spell, you } from '../../m5/render/build';

const ECL = stdEcl as Template[];
const OPTS = defaultParseOptions({ templates: [...TEMPLATE_SET], capabilities: ENGINE_CAPABILITIES }); // what a decklist card gets (design 5.2; `needs`)

/**
 * Design 6.9 evidence for a stable template: three hand-verified golden cards, or, for a sentence only one real card prints, that card (every card of the index
 * that prints the line, checked below against the local index).
 */
const WHOLE_CORPUS: Readonly<Record<string, { cards: readonly string[]; line: RegExp }>> = {
  // Standard round 4 r4-fxb: the one card of the corpus that prints it (golden in test/m5/golden/cards/cloud-r4-fxb-review.json)
  'eff.stdecl.durFirst.basept.gains.allCreatureTypes': { cards: ['Glamer Gifter'], line: /Until end of turn, that creature has base power and toughness \d+\/\d+ and gains all creature types/ },
  'eff.stdecl.thenIf.blight': { cards: ['Dose of Dawnglow'], line: /Then if [^.]*, blight \w+/ },
  'eff.stdecl.remove.anyNumber.counters': { cards: ['Rhys, the Evermore'], line: /Remove any number of counters from target/ },
  'eff.stdecl.loseall.becomes.subtype.inaddition.basept': { cards: ['Curious Colossus'], line: /loses all abilities, becomes an? [A-Z][a-z]+ in addition to its other types, and has base power and toughness/ },
  'eff.stdecl.mill.thenPutEach.milledThisWay.hand': { cards: ["Grub's Command"], line: /mills? \w+ cards, then puts? each [^.]* card milled this way into (your|their) hand/ },
  // the sentence with no duration ("Up to one target creature gains all creature types. (This effect doesn't end.)"), not "... and gains all creature types."
  'eff.stdecl.gains.allCreatureTypes': { cards: ['Oko, Lorwyn Liege // Oko, Shadowmoor Scion'], line: /(?<!and )gains all creature types\.(?: \(|$)/m },
  'eff.stdecl.copy.token.tappedAttacking.except.has': { cards: ['Grub, Storied Matriarch // Grub, Notorious Auntie'], line: /create a tapped and attacking token that's a copy of [^.]*, except it has/ },
  // p2-coinflip-2 (lane p2-promote's Mirror Entity, after std-promote-4): the one card of the corpus that prints the plain line (Mirror Entity Avatar says "of the chosen type")
  'eff.stdecl.durFirst.group.basept.gain.allCreatureTypes': { cards: ['Mirror Entity'], line: /Until end of turn, creatures you control have base power and toughness X\/X and gain all creature types/ },
};

/** A synthetic card in which an example is an ability of the right kind: a spell on a sorcery, a triggered, activated or static ability on a creature. */
function exampleCard(t: Template, text: string): OracleCard {
  if (t.kind === 'effect' && !text.includes(':') && !/^(When|Whenever|At)\b/.test(text)) return card('Example Volley', 'Sorcery', text);
  return card('Example Brute', 'Creature — Elf Warrior', text, { power: '3', toughness: '3' });
}
const parsedWith = (t: Template, text: string) => parseCard(exampleCard(t, text), OPTS).faces[0]!;
/**
 * Line merge (std-blb + std-ecl): an experimental template of this file whose sentence a STABLE template now reads fully, to the same JSON. std-blb promoted
 * `eff.t34.thenIf` to stable, so "Then if C, create <token>" is read by it and eff.token.you; the parser then prefers the stable reading over the experimental
 * one (parser/parse.ts#preferStable, design 6.9, guard G10: an experimental template that adds nothing does not cap the card). G9 below checks such an example
 * with the stable template left out: it parses with this template, and to the JSON the stable reading gives (CR 608.2c).
 */
const STABLE_READS: Readonly<Record<string, string>> = { 'eff.stdecl.thenIf.token': 'eff.t34.thenIf' };
// merge of lines C and D: CLOUD std-fra's generic sentence-initial "Then" (eff.stdfra.then.effects, weak) with the lead-in "if" template is one more stable reading
// of "Then if C, create ..." with the same JSON, so it is left out too when the experimental template is checked on its own
const OPTS_WITHOUT = (id: string) => defaultParseOptions({ templates: TEMPLATE_SET.filter((x) => x.id !== id && x.id !== 'eff.stdfra.then.effects'), capabilities: ENGINE_CAPABILITIES });

describe('std-ecl template file (design 6.3, 6.9; CONTRIBUTING "Adding a template")', () => {
  it('is loaded by the default compiler (zz-cloud/std-ecl.json, path order: after trigger.json, before zz-cloud/std-hob.json and zz-fast1/) and its ids are unique in the whole set', () => {
    const files = TEMPLATE_FILES.map((f) => f.file);
    expect(files).toContain('zz-cloud/std-ecl.json');
    expect(files.indexOf('zz-cloud/std-ecl.json')).toBeGreaterThan(files.indexOf('trigger.json'));
    expect(files.indexOf('zz-cloud/std-ecl.json')).toBeLessThan(files.indexOf('zz-cloud/std-hob.json'));
    expect(files.indexOf('zz-cloud/std-ecl.json')).toBeLessThan(files.findIndex((f) => f.startsWith('zz-fast1/')));
    const ids = TEMPLATE_SET.map((t) => t.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(validateTemplates([...TEMPLATE_SET])).toEqual([]);
  });
  it('design 6.9: every template cites rules, has at least two examples and two counter-examples, a status, and is of version 8; ids are eff.stdecl.*, trg.stdecl.* or sta.stdecl.*', () => {
    expect(ECL.length).toBe(14);
    for (const t of ECL) {
      expect(t.id, t.id).toMatch(/^(eff|trg|sta)\.stdecl\./);
      expect(t.cr.length, t.id).toBeGreaterThan(0);
      for (const cr of t.cr) expect(cr, t.id).toMatch(/^CR \d{3}(\.\d+[a-z]?)?$/);
      expect(t.examples.length, t.id).toBeGreaterThanOrEqual(2);
      expect(t.counterExamples.length, t.id).toBeGreaterThanOrEqual(2);
      expect(['stable', 'experimental'], t.id).toContain(t.status);
      expect(t.since, t.id).toBe(8);
    }
  });
  it('design 6.9: a stable template has its evidence: three hand-verified golden cards, or every card of the corpus that prints the sentence', () => {
    const golden = [...review, ...r4FxbReview] as { card: string; verified: string; expect?: string }[];
    for (const t of ECL.filter((x) => x.status === 'stable')) {
      const cards = golden.filter((g) => g.verified.includes(`(${t.id})`)).map((g) => g.card);
      const whole = WHOLE_CORPUS[t.id];
      if (whole) expect(cards.slice().sort(), t.id).toEqual([...whole.cards].sort());
      else expect(cards.length, `${t.id}: ${cards.join(', ')}`).toBeGreaterThanOrEqual(3);
    }
    // the experimental ones: three all-creature-types wordings whose few cards are not golden yet (Glamer Gifter waits on another slice's "choose up to one
    // other target creature"; Amoeboid Changeling, Velis Vel and Mirror Entity Avatar have other sentences not read) and "then if C, create <token>" (two
    // golden cards; Tend the Sprigs is the third once its "lands and/or Treefolk" is read). The plain tapped and attacking token copy is stable since std-promote-4
    // on three golden cards (Calamity, Galloping Inferno; Sandstorm Crasher; Satya, Aetherflux Genius; cloud-std-ecl-review.json)
    expect(ECL.filter((t) => t.status === 'experimental').map((t) => t.id).sort()).toEqual([
      'eff.stdecl.gains.allCreatureTypes.dur', 'eff.stdecl.thenIf.token',
      // the conditional flash (sta.stdecl.cast.self.flash.ifCond) is stable since Standard round 4 r4-fxb: its third golden card, Bard's Company, is in
      // test/m5/golden/cards/cloud-r4-fxb-review.json
    ]);
  });
  it('guard G3: a critical word a pattern spells out is listed in `consumes`', () => {
    for (const t of ECL) {
      const words = t.pattern.toLowerCase().replace(/\{[^}]*:[^}]*\}/g, ' ').split(/[^a-z']+/).filter(Boolean);
      for (const w of ['all', 'each', 'another', 'other', 'may', 'if', 'unless', 'until', 'instead', 'only', 'chosen', 'additional', 'except', "can't", 'would', 'next', 'then']) {
        if (words.includes(w)) expect(t.consumes ?? [], `${t.id}: ${w}`).toContain(w);
      }
    }
  });
  it('the priorities: the specific "then if C, ..." wordings win over the general eff.t34.thenIf; the general token copy yields "..., except it has haste." to eff.m6.copy.token.haste', () => {
    const byId = new Map(TEMPLATE_SET.map((t) => [t.id, t]));
    expect(byId.get('eff.stdecl.thenIf.blight')!.priority).toBe(1);
    expect(byId.get('eff.stdecl.thenIf.token')!.priority).toBe(1);
    expect(byId.get('eff.stdecl.copy.token.except.has')!.priority).toBe(-1);
    const f = parseCard(card('Example Volley', 'Sorcery', "Create a token that's a copy of target creature you control, except it has haste. Exile it at the beginning of the next end step."), OPTS).faces[0]!;
    expect(f.templatesUsed).toContain('eff.m6.copy.token.haste');
    expect(f.templatesUsed).not.toContain('eff.stdecl.copy.token.except.has');
  });
});

describe('std-ecl guard G9 (design 6.8): examples and counter-examples', () => {
  for (const t of ECL) {
    it(`${t.id} (${t.cr.join(', ')}): every example parses with it, is automated and passes the render gate; counter-examples do not give the same JSON`, () => {
      const first = parsedWith(t, t.examples[0]!.text);
      const stable = STABLE_READS[t.id];
      for (const e of t.examples) {
        let f = parsedWith(t, e.text);
        if (stable !== undefined) {
          // the stable reading wins (preferStable); without that template the example parses with this one, to the same JSON
          expect(f.templatesUsed, e.text).toContain(stable);
          const own = parseCard(exampleCard(t, e.text), OPTS_WITHOUT(stable)).faces[0]!;
          expect(bare(own.abilities), e.text).toEqual(bare(f.abilities));
          f = own;
        }
        expect(f.templatesUsed.includes(t.id), `${e.text}: ${f.templatesUsed.join(', ')}`).toBe(true);
        expect(automated(f.abilities), `${e.text}: ${JSON.stringify(f.abilities)} ${JSON.stringify(f.diagnostics)}`).toBe(true);
        expect(f.gate.every((g) => g.ok), `${e.text}: ${JSON.stringify(f.gate)}`).toBe(true);
        expect(f.diagnostics.filter((d) => d.level === 'manual'), e.text).toEqual([]);
        if (e.expect !== undefined) expect(bare(f.abilities), e.text).toEqual(e.expect);
      }
      for (const c of t.counterExamples) {
        const f = parsedWith(t, c);
        expect(fullyAutomated(f) && jsonKey(f.abilities) === jsonKey(first.abilities), c).toBe(false);
      }
    });
  }
});

/** Near-miss mutations of one example sentence (design 6.8 G9): each must not parse, or parse to different JSON. */
function nearMisses(text: string): string[] {
  const body = text.replace(/\.$/, '').replace(/\."$/, '"');
  const plain = text.endsWith('"') ? [] : [`${body} unless it is blue.`, `${body} instead.`, `${body} at random.`, `${body} twice.`, `${body} if able.`];
  const out = [...plain];
  const swaps: [RegExp, string][] = [
    [/\bfor each\b/, 'for any'], [/\btapped\b/, 'untapped'], [/\buntil end of turn\b/, 'until your next turn'], [/\bor more\b/, 'or fewer'], [/\bgains\b/, 'loses'],
    [/\bwhenever you\b/, 'whenever an opponent'], [/\beach\b/, 'all'], [/\bthen if\b/i, 'Then unless'], [/\bhaste\b/, 'shroud'], [/\bmills\b/, 'discards'],
    [/\bany number of\b/, 'all'], [/\bin addition to its other types\b/, 'instead of its other types'], [/\bas though it had flash\b/, 'as though it had haste'],
    [/\ball creature types\b/, 'all colors'], [/\bWhen ~ enters\b/, 'When ~ dies'],
  ];
  for (const [re, by] of swaps) if (re.test(text)) out.push(text.replace(re, by));
  return out;
}

describe('std-ecl guard G9 (design 6.8): near-miss mutations fail or differ', () => {
  for (const t of ECL) {
    it(`${t.id}: an appended "unless/instead/at random/twice" or a swapped key word never gives the example's JSON`, () => {
      for (const e of t.examples) {
        const orig = parsedWith(t, e.text);
        for (const m of nearMisses(e.text)) {
          if (m === e.text) continue;
          const f = parsedWith(t, m);
          expect(automated(f.abilities) && f.gate.every((g) => g.ok) && jsonKey(f.abilities) === jsonKey(orig.abilities), m).toBe(false);
        }
      }
    });
  }
});

describe('std-ecl guard G2 (design 6.8): a nonsense word never leaves an automated card', () => {
  for (const t of ECL) {
    it(`${t.id}: replacing any one word of an example by an invented word makes the card not fully automated`, () => {
      for (const e of t.examples) {
        const words = e.text.split(' ');
        words.forEach((w, i) => {
          if (w === '~' || w === '~.' || w === '~,' || /^"?\{/.test(w) || w.includes('\n')) return;
          const end = w.match(/[.,"]+$/)?.[0] ?? '';
          const start = w.startsWith('"') ? '"' : '';
          const mutated = [...words.slice(0, i), `${start}blorfty${end}`, ...words.slice(i + 1)].join(' ');
          expect(fullyAutomated(parsedWith(t, mutated)), mutated).toBe(false);
        });
      }
    });
  }
});

describe('std-ecl hole, lowering and renderer support', () => {
  const sorcery = (text: string) => parseCard(card('Example Volley', 'Sorcery', text), OPTS).faces[0]!;
  const creature = (text: string, type = 'Creature — Elf Warrior') => parseCard(card('Example Brute', type, text, { power: '3', toughness: '3' }), OPTS).faces[0]!;
  const specsOf = (f: ReturnType<typeof sorcery>): TargetSpec[] => (bare(f.abilities)[0] as { effect: { targets: TargetSpec[] } }).effect.targets;

  it('CR 205.3m, 115.1, 601.2c: "two target creature cards that share a creature type" is one spec of exactly two with the shared creature type, in front of or behind the zone', () => {
    const a = sorcery('Return two target creature cards that share a creature type from your graveyard to your hand.');
    const b = sorcery('Return two target creature cards from your graveyard that share a creature type to your hand.');
    for (const f of [a, b]) {
      expect(fullyAutomated(f), JSON.stringify(f.diagnostics)).toBe(true);
      expect(specsOf(f)[0]).toMatchObject({ kind: 'object', min: 2, max: 2, sharedCreatureType: true, filter: { types: ['Creature'], zone: 'graveyard', owner: 'you' } });
    }
    expect(jsonKey(a.abilities)).toBe(jsonKey(b.abilities));
    const tunnel = creature('{3}, {T}: Two target creatures you control that share a creature type can\'t be blocked this turn.');
    expect(fullyAutomated(tunnel)).toBe(true);
    expect(specsOf(tunnel)[0]).toMatchObject({ min: 2, max: 2, sharedCreatureType: true, filter: { controller: 'you' } });
    // a single target, "each", three targets, "up to two" and a phrase that is no target are not this restriction
    for (const text of [
      'Return target creature card that shares a creature type from your graveyard to your hand.', 'Return each creature card that share a creature type from your graveyard to your hand.',
      'Return three target creature cards that share a creature type from your graveyard to your hand.', 'Return up to two target creature cards that share a creature type from your graveyard to your hand.',
      'Return two creature cards that share a creature type from your graveyard to your hand.',
    ]) expect(fullyAutomated(sorcery(text)), text).toBe(false);
  });
  it('CR 205.3m: the shared creature type is said by the noun phrase, never dropped and never said for another restriction', () => {
    const def = spell([{ op: 'move', what: { ref: 'target', id: 'c' }, to: { zone: 'hand' } } as EffectStep], [{ id: 'c', kind: 'object', min: 2, max: 2, text: '', filter: { types: ['Creature'], zone: 'graveyard', owner: 'you', isCard: true }, sharedCreatureType: true }]);
    accepts(def, 'Return two target creature cards that share a creature type from your graveyard to your hand.');
    rejects(def, 'Return two target creature cards from your graveyard to your hand.');
    rejects(def, 'Return two target creature cards that share a card type from your graveyard to your hand.');
    const both = spell(def.kind === 'spell' ? def.effect.steps : [], [{ id: 'c', kind: 'object', min: 2, max: 2, text: '', filter: { types: ['Creature'] }, sharedCreatureType: true, sharedCardType: true }]);
    rejects(both, 'Return two target creatures that share a creature type to their owners\' hands.');
    rejects(both, 'Return two target creatures that share a card type to their owners\' hands.');
  });
  it('CR 122.1, 602.1a: "Remove a counter from ~" and "remove two counters from ~" are costs of counters of any kind (cost:removeCounters.any); a kind named stays that kind', () => {
    const one = creature('{1}, Remove a counter from ~: Draw a card.');
    const two = creature('{2}{B}, Remove two counters from ~: Target creature gets -2/-2 until end of turn.');
    const named = creature('{1}, Remove a +1/+1 counter from ~: Draw a card.');
    for (const f of [one, two, named]) expect(fullyAutomated(f), JSON.stringify(f.diagnostics)).toBe(true);
    const costOf = (f: ReturnType<typeof creature>): unknown => (bare(f.abilities)[0] as { cost: { other: unknown[] } }).cost.other;
    expect(costOf(one)).toEqual([{ kind: 'removeCounters', counter: 'any', count: 1, self: true }]);
    expect(costOf(two)).toEqual([{ kind: 'removeCounters', counter: 'any', count: 2, self: true }]);
    expect(costOf(named)).toEqual([{ kind: 'removeCounters', counter: '+1/+1', count: 1, self: true }]);
    expect(ENGINE_CAPABILITIES.has('cost:removeCounters.any')).toBe(true);
  });
  it('CR 701.4a, 702.34a: "Behold two Goblins" in a cost is two beholds of that quality; "and exile it" is only offered for one', () => {
    const sor = parseCard(card('Example Volley', 'Sorcery', 'Draw a card.\nFlashback—{2}{R}, Behold two Goblins.'), OPTS).faces[0]!;
    expect(fullyAutomated(sor), JSON.stringify(sor.diagnostics)).toBe(true);
    expect(JSON.stringify(sor.abilities)).toContain('"other":[{"kind":"behold","filter":{"subtypes":["Goblin"]},"count":2}]');
    const exiled = parseCard(card('Example Volley', 'Sorcery', 'Draw a card.\nFlashback—{2}{R}, Behold two Goblins and exile them.'), OPTS).faces[0]!;
    expect(fullyAutomated(exiled)).toBe(false);
  });
  it('CR 508.1, 611.3a, 602.5b: "you attacked with N or more <creatures> this turn" counts the attackers declared this turn, as a static condition and as an activation restriction', () => {
    const anthem = creature('As long as you attacked with three or more Elves this turn, Elves you control get +1/+0.');
    expect(fullyAutomated(anthem)).toBe(true);
    expect((bare(anthem.abilities)[0] as { condition: unknown }).condition).toEqual({ cond: 'happened', event: { ev: 'attacks', attacker: { subtypes: ['Elf'], controller: 'you' } }, scope: 'turn', times: { op: '>=', value: 3 } });
    const land = parseCard(card('Example Keep', 'Land', '{T}: Add {W}.\n{2}, {T}: Draw a card. Activate only if you attacked with two or more creatures this turn.'), OPTS).faces[0]!;
    expect(fullyAutomated(land)).toBe(true);
    expect(JSON.stringify(land.abilities)).toContain('"onlyIf":{"cond":"happened","event":{"ev":"attacks","attacker":{"types":["Creature"],"controller":"you"}},"scope":"turn","times":{"op":">=","value":2}}');
    expect(ENGINE_CAPABILITIES.has('feature:announce.happened.attackedWith')).toBe(true);
    // the words a controller or a zone would add are not this condition
    expect(fullyAutomated(creature('As long as you attacked with three or more Elves an opponent controls this turn, Elves you control get +1/+0.'))).toBe(false);
  });
  it('CR 611.3a, 604.1: "the number of creatures that entered the battlefield under your control this turn" is a count of the history the layers evaluate (sq:happenedCount)', () => {
    const f = parseCard(card('Example Charm', 'Enchantment', 'Creatures you control get +X/+X, where X is the number of creatures that entered the battlefield under your control this turn.'), OPTS).faces[0]!;
    expect(fullyAutomated(f)).toBe(true);
    expect(JSON.stringify(f.abilities)).toContain('"q":"happenedCount"');
    expect(ENGINE_CAPABILITIES.has('sq:happenedCount')).toBe(true);
  });
  it('CR 115.1, 120.3: "each creature target player controls" is said for a damage recipient and for the subject of a group', () => {
    const f = sorcery('~ deals 3 damage to each creature target player controls.');
    expect(fullyAutomated(f), JSON.stringify(f.gate)).toBe(true);
    expect(specsOf(f)[0]).toMatchObject({ kind: 'player' });
  });
  it('CR 110.4: "permanent cards" are cards of the six permanent types, and are said "permanent cards"', () => {
    const f = creature('Whenever one or more permanent cards are put into your graveyard from anywhere, you gain 1 life.');
    expect(fullyAutomated(f), JSON.stringify(f.gate)).toBe(true);
    expect(JSON.stringify(f.abilities)).toContain('"types":["Artifact","Battle","Creature","Enchantment","Land","Planeswalker"]');
  });
  it('CR 702.21a, 613.1f: a granted keyword with a dash cost is quoted ("have \\"Ward—Pay 3 life.\\"")', () => {
    const f = creature('Other creatures you control have "Ward—Pay 3 life."');
    expect(fullyAutomated(f), JSON.stringify(f.gate)).toBe(true);
  });
  it('CR 701.68c, 608.2c, 118.12: "the blighted creature" is the creature chosen as you blighted, and "if you do" sees what the optional instruction bound', () => {
    const f = creature('Whenever ~ attacks, you may blight 1. If you do, create a tapped and attacking token that\'s a copy of the blighted creature, except it has "At the beginning of the end step, sacrifice this token."');
    expect(fullyAutomated(f), JSON.stringify(f.diagnostics)).toBe(true);
    const steps = (bare(f.abilities)[0] as { effect: { steps: { op: string; do?: { as?: string }[]; then?: { what?: unknown; tapped?: boolean; attacking?: boolean }[] }[] } }).effect.steps;
    const name = steps[0]!.do![0]!.as;
    expect(steps[0]).toMatchObject({ op: 'may', do: [{ op: 'action', action: 'blight', n: 1 }] });
    expect(typeof name).toBe('string');
    expect(steps[1]!.then![0]).toMatchObject({ op: 'copy', what: { ref: 'bound', name }, tapped: true, attacking: true });
    // the same for the Army an optional amass chose (CR 701.47c)
    expect(fullyAutomated(creature('When ~ enters, you may amass Orcs 1. If you do, put a +1/+1 counter on the amassed Army.'))).toBe(true);
    // "if you don't" never sees what the instruction would have bound; several players blighting name no single creature
    expect(fullyAutomated(creature('Whenever ~ attacks, you may blight 1. If you don\'t, create a token that\'s a copy of the blighted creature.'))).toBe(false);
    expect(fullyAutomated(creature('Whenever ~ attacks, each opponent blights 1. Create a token that\'s a copy of the blighted creature.'))).toBe(false);
    expect(fullyAutomated(creature('Whenever ~ attacks, create a token that\'s a copy of the blighted creature.'))).toBe(false);
  });
  it('CR 608.2c: a choice out of a named group is "one of them", and the chosen object keeps the group\'s noun ("you may play that card")', () => {
    const def: AbilityDef = spell([
      { op: 'move', what: { ref: 'topCards', player: you, count: 2 }, to: { zone: 'exile' }, as: 'them' } as EffectStep,
      { op: 'chooseObjects', who: you, from: { ref: 'each', filter: { is: bound('them') } }, min: 1, max: 1, as: 'ch' } as EffectStep,
      { op: 'effect', duration: { d: 'endOfNextTurn', whose: you }, effects: [{ s: 'permit', who: you, action: 'play', of: { is: bound('ch') } }] } as EffectStep,
    ]);
    accepts(def, 'Exile the top two cards of your library. Choose one of them. Until the end of your next turn, you may play that card.');
    rejects(def, 'Exile the top two cards of your library. Choose two of them. Until the end of your next turn, you may play that card.');
    rejects(def, 'Exile the top two cards of your library. Choose one of them. Until the end of your next turn, you may play that creature.');
  });
});

const index = localIndex();

describe.skipIf(index === null)('std-ecl design 6.9, 6.10 (local index): synthetic examples; the real cards each template reads', () => {
  it('no std-ecl line of an example or counter-example is a line of a real card (with the card\'s own name or "this <type>" read as "~")', () => {
    const lines = new Set<string>();
    for (const c of index ?? []) {
      for (const text of [c.oracle_text, ...(c.card_faces ?? []).map((x) => x.oracle_text)]) {
        if (typeof text !== 'string') continue;
        for (const l of text.split('\n')) {
          lines.add(l.trim());
          lines.add(l.replaceAll(c.name, '~').replace(/\bthis (creature|land|artifact|enchantment|Aura|spell|card)\b/gi, '~').trim());
        }
      }
    }
    const verbatim = ECL.flatMap((t) => [...t.examples.map((e) => e.text), ...t.counterExamples].filter((x) => x.split('\n').some((l) => lines.has(l.trim()))).map((x) => `${t.id}: ${x}`));
    expect(verbatim).toEqual([]);
  }, 120_000);
  it('the cards named as the whole corpus of a sentence are every card of the index that prints it', () => {
    for (const [id, w] of Object.entries(WHOLE_CORPUS)) {
      const found = (index ?? []).filter((c) => [c.oracle_text, ...(c.card_faces ?? []).map((x) => x.oracle_text)].some((x) => typeof x === 'string' && w.line.test(x))).map((c) => c.name);
      expect([...new Set(found)].sort(), id).toEqual([...w.cards].sort());
    }
  }, 120_000);

  // the try step on real cards: each card's line is read by the named template, passes the render gate, and the card is fully automated
  const REAL: Readonly<Record<string, readonly string[]>> = {
    'eff.stdecl.thenIf.blight': ['Dose of Dawnglow'],
    'eff.stdecl.remove.anyNumber.counters': ['Rhys, the Evermore'],
    'eff.stdecl.loseall.becomes.subtype.inaddition.basept': ['Curious Colossus'],
    'trg.stdecl.entersAndWhenever': ['Flaring Cinder', 'Up the Beanstalk', 'Brinelin, the Moon Kraken', 'Hraesvelgr of the First Brood', 'MACH-1, Swooping Scoundrel', 'March from the Black Gate', 'Mindless Conscription'],
    'eff.stdecl.mill.thenPutEach.milledThisWay.hand': ["Grub's Command"],
    'eff.stdecl.copy.token.except.has': ['Kindle the Inner Flame', 'Heat Shimmer', 'Minion Reflector'],
    'eff.stdecl.copy.token.tappedAttacking.except.has': ['Grub, Storied Matriarch // Grub, Notorious Auntie'],
  };
  for (const [id, names] of Object.entries(REAL)) {
    it(`${id}: ${names.join(', ')} read the line with it, pass the render gate and compile fully automated`, () => {
      for (const name of names) {
        const oracle = (index ?? []).find((c) => c.name === name);
        expect(oracle, name).toBeDefined();
        const parsed = parseCard(oracle!, OPTS);
        expect(parsed.faces.flatMap((f) => f.templatesUsed), name).toContain(id);
        expect(parsed.faces.every((f) => f.gate.every((g) => g.ok)), name).toBe(true);
        expect((compileCard(oracle!) as { automation: { level: string } }).automation.level, name).toBe('full');
      }
    }, 60_000);
  }
});
