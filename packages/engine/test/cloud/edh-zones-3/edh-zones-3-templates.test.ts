/**
 * edh-zones-3 (Commander effort, lane edh-zones): the template data of parser/templates/zz-cloud/edh-zones-3.json and the round's other changes: triggers that function in the
 * graveyard for "put into a graveyard from anywhere" (parser/lower/trigger-zone.ts, triggers/collect.ts for tokens), "that aren't legendary" / "that's not historic"
 * (parser/holes/filter.ts, render/np.ts), complete events joined by "or" and "from anywhere other than the battlefield" (parser/holes/event.ts, render/evt.ts), a group of
 * players milling half their library one at a time (parser/lower/targets.ts#perGroupAmounts, render/steps-flow.ts), the renderer folds and alternatives (render/fold.ts,
 * fold-edhzones3.ts, steps-zones.ts, steps-cards.ts). Guard G9 and G2 as the earlier rounds run them; examples are synthetic (design 6.10). The behavior is in
 * edh-zones-3-scenarios.test.ts. CR cites checked against MagicCompRules 20260925 (none from memory).
 */
import { describe, expect, it } from 'vitest';
import { compileCard, type OracleCard } from '../../../src/index';
import type { Template } from '../../../src/parser/types';
import { defaultParseOptions, parseCard } from '../../../src/parser/parse';
import { validateTemplates } from '../../../src/parser/chart';
import { TEMPLATE_FILES, TEMPLATE_SET } from '../../../src/parser/template-set';
import { ENGINE_CAPABILITIES } from '../../../src/model/capabilities';
import edhZones3 from '../../../src/parser/templates/zz-cloud/edh-zones-3.json';
import review from '../../m5/golden/cards/edh-zones-3-review.json';
import { automated, bare, card, fullyAutomated, jsonKey } from '../../m5/templates/support';
import { localIndex } from '../../m5/parser/support';

const EZ3 = edhZones3 as Template[];
const OPTS = defaultParseOptions({ templates: [...TEMPLATE_SET], capabilities: ENGINE_CAPABILITIES }); // what a decklist card gets (design 5.2; `needs`)
type Golden = { card: string; verified: string; expect?: string }[];
const goldenUsing = (id: string, file: Golden = review as Golden): string[] => file.filter((g) => new RegExp(`[ (]${id.replaceAll('.', '\\.')}[,);]`).test(g.verified)).map((g) => g.card);

/** The type line an example is printed on: a creature for a permanent's line (a trigger, "this creature"), else a sorcery or an artifact. */
const typeOf = (text: string): string => (/^Whenever|^When|this creature/m.test(text) ? 'Creature — Beast' : /^\{/m.test(text) ? 'Artifact' : 'Sorcery');
const face = (text: string, typeLine?: string) => {
  const type = typeLine ?? typeOf(text);
  return parseCard(card('Example Relic', type, text, type.includes('Creature') ? { power: '2', toughness: '2' } : undefined), OPTS).faces[0]!;
};
const understood = (f: ReturnType<typeof face>): boolean => automated(f.abilities) && f.gate.every((g) => g.ok) && f.diagnostics.every((d) => d.level !== 'manual' || d.code === 'experimental');
const compiled = (type: string, text: string, name = 'Example Relic') =>
  compileCard({ name, layout: 'normal', mana_cost: '{0}', type_line: type, oracle_text: text, colors: [], ...(type.includes('Creature') ? { power: '2', toughness: '2' } : {}) } as OracleCard);
const level = (type: string, text: string, name?: string): string => compiled(type, text, name).automation.level;
const json = (type: string, text: string, name?: string): string => JSON.stringify(compiled(type, text, name).faces);

const IDS = ['eff.edhz3.shuffle.obj.ownersLibrary', 'eff.edhz3.player.puts.graveyard.bottomRandom', 'eff.edhz3.shuffle.selfAndGraveyard.ownersLibrary', 'eff.edhz3.return.fromYourGraveyard.battlefield'];

describe('edh-zones-3 template file (design 6.3, 6.9; CONTRIBUTING "Adding a template")', () => {
  it('is loaded by the default compiler (zz-cloud/edh-zones-3.json, after zz-cloud/edh-zones-1.json, before zz-cloud/look3.json) and its ids are unique in the whole set', () => {
    const files = TEMPLATE_FILES.map((f) => f.file);
    expect(files).toContain('zz-cloud/edh-zones-3.json');
    expect(files.indexOf('zz-cloud/edh-zones-3.json')).toBeGreaterThan(files.indexOf('zz-cloud/edh-zones-1.json')); // path order
    expect(files.indexOf('zz-cloud/edh-zones-3.json')).toBeLessThan(files.indexOf('zz-cloud/look3.json'));
    const ids = TEMPLATE_SET.map((t) => t.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(validateTemplates([...TEMPLATE_SET])).toEqual([]);
  });
  it('design 6.9: every template cites rules, has at least two examples and two counter-examples, a status with its evidence, and is of version 8', () => {
    expect(EZ3.map((t) => t.id)).toEqual(IDS);
    for (const t of EZ3) {
      expect(t.id, t.id).toMatch(/^eff\.edhz3\./);
      expect(t.cr.length, t.id).toBeGreaterThan(0);
      for (const cr of t.cr) expect(cr, t.id).toMatch(/^CR \d{3}(\.\d+[a-z]?)?$/);
      expect(t.examples.length, t.id).toBeGreaterThanOrEqual(2);
      expect(t.counterExamples.length, t.id).toBeGreaterThanOrEqual(2);
      expect(t.since, t.id).toBe(8);
      expect(t.status, t.id).toBe('stable');
    }
    for (const g of review as Golden) {
      expect(g.expect, g.card).toBe('full');
      expect(g.verified, g.card).toMatch(/CR \d{3}/);
    }
    // narrow wordings (printed on one or two cards of the top 5,000), stable on one hand-verified golden card plus these tests and the scenarios: 6.9 deviations named in the
    // round record. (Dread and Serra Avatar print the first one too, but they are held-out cards outside the top 5,000: opened for verification only, never evidence.)
    expect(goldenUsing('eff.edhz3.shuffle.obj.ownersLibrary')).toEqual(['Worldspine Wurm']);
    expect(goldenUsing('eff.edhz3.player.puts.graveyard.bottomRandom')).toEqual(['Endurance']);
    expect(goldenUsing('eff.edhz3.shuffle.selfAndGraveyard.ownersLibrary')).toEqual(['Elixir of Immortality']);
    expect(goldenUsing('eff.edhz3.return.fromYourGraveyard.battlefield')).toEqual(['Stitch Together']);
  });
  it('guard G3: a critical word a pattern spells out is listed in `consumes`', () => {
    for (const t of EZ3) {
      const words = t.pattern.toLowerCase().replace(/\{[^}]*:[^}]*\}/g, ' ').split(/[^a-z']+/).filter(Boolean);
      for (const w of ['all', 'each', 'another', 'other', 'may', 'if', 'unless', 'until', 'instead', 'only', 'chosen', 'except', "can't", 'would', 'then', 'when', 'also', 'whenever', 'and', 'random']) {
        if (words.includes(w)) expect(t.consumes ?? [], `${t.id}: ${w}`).toContain(w);
      }
    }
  });
});

describe('edh-zones-3 guard G9 (design 6.8): examples and counter-examples', () => {
  for (const t of EZ3) {
    it(`${t.id} (${t.cr.join(', ')}): every example parses with it, is automated and passes the render gate; counter-examples do not give the same JSON`, () => {
      const first = face(t.examples[0]!.text);
      for (const e of t.examples) {
        const f = face(e.text);
        expect(f.templatesUsed, e.text).toContain(t.id);
        expect(understood(f), `${e.text}: ${JSON.stringify(f.abilities)} ${JSON.stringify(f.diagnostics)} ${JSON.stringify(f.gate)}`).toBe(true);
        expect(fullyAutomated(f), e.text).toBe(true);
        if (e.expect !== undefined) expect(bare(f.abilities), e.text).toEqual(e.expect);
      }
      for (const c of t.counterExamples) {
        const f = face(c, typeOf(t.examples[0]!.text));
        expect(understood(f) && jsonKey(f.abilities) === jsonKey(first.abilities), c).toBe(false);
      }
    });
  }
});

/** Near-miss mutations of one example (design 6.8 G9): each must not parse, or parse to different JSON. */
function nearMisses(text: string): string[] {
  const body = text.replace(/\.$/, '');
  const out = [`${body} unless it is blue.`, `${body} twice.`];
  const swaps: [RegExp, string][] = [
    [/\bbottom\b/, 'top'], [/\ball the cards\b/, 'two cards'], [/\bgraveyard\b/, 'hand'], [/\binto their owner's library\b/, "into your library"], [/\bto the battlefield\b/, 'to the battlefield tapped'],
    [/\bthe battlefield\b/, 'your hand'],
  ];
  for (const [re, by] of swaps) if (re.test(text)) out.push(text.replace(re, by));
  return out;
}

describe('edh-zones-3 guard G9 (design 6.8): near-miss mutations fail or differ', () => {
  for (const t of EZ3) {
    it(`${t.id}: an appended condition, or a swapped key word, never gives the example's JSON`, () => {
      for (const e of t.examples) {
        const orig = face(e.text);
        for (const m of nearMisses(e.text)) {
          if (m === e.text) continue;
          const f = face(m, typeOf(e.text));
          expect(understood(f) && jsonKey(f.abilities) === jsonKey(orig.abilities), m).toBe(false);
        }
      }
    });
  }
});

describe('edh-zones-3 guard G2 (design 6.8): a nonsense word never leaves an automated card', () => {
  for (const t of EZ3) {
    it(`${t.id}: replacing any one word of the template's sentence by an invented word makes the card not understood`, () => {
      for (const e of t.examples) {
        const words = e.text.split(' ');
        words.forEach((w, i) => {
          if (/^\{/.test(w)) return; // a mana symbol is not a word
          const end = w.match(/[.,"]+$/)?.[0] ?? '';
          const mutated = [...words.slice(0, i), `blorfty${end}`, ...words.slice(i + 1)].join(' ');
          expect(understood(face(mutated, typeOf(e.text))), mutated).toBe(false);
        });
      }
    });
  }
});

const SHUFFLE = 'its owner shuffles their graveyard into their library.';

describe('edh-zones-3 "put into a graveyard from anywhere" (parser/lower/trigger-zone.ts; CR 603.6c, 113.6k)', () => {
  it('a self trigger with no origin zone functions in the graveyard and is automated when its whole effect is understood', () => {
    const j = json('Creature — Eldrazi', `When ~ is put into a graveyard from anywhere, ${SHUFFLE}`);
    expect(level('Creature — Eldrazi', `When ~ is put into a graveyard from anywhere, ${SHUFFLE}`)).toBe('full');
    expect(j).toContain('"zone":["graveyard"]');
    expect(j).toContain('"trigger":{"on":[{"ev":"zoneChange","subject":{"self":true},"to":"graveyard"}]}');
  });
  it('"it" is the card in the graveyard: "shuffle it into its owner\'s library" is the move of the event\'s object and the owner\'s shuffle', () => {
    const j = json('Creature — Wurm', "When ~ is put into a graveyard from anywhere, shuffle it into its owner's library.");
    expect(level('Creature — Wurm', "When ~ is put into a graveyard from anywhere, shuffle it into its owner's library.")).toBe('full');
    expect(j).toContain('"what":{"ref":"event","role":"subject"}');
    expect(j).toContain('"owner":{"ref":"ownerOf","object":{"ref":"event","role":"subject"}}');
  });
  it('near misses: an effect that is not understood keeps the ability manual; a battlefield origin ("dies", "from the battlefield") is not this reading', () => {
    expect(level('Creature — Eldrazi', 'When ~ is put into a graveyard from anywhere, fnord the foo.')).not.toBe('full');
    expect(json('Creature — Eldrazi', `When ~ is put into a graveyard from the battlefield, ${SHUFFLE}`)).not.toContain('"zone":["graveyard"]');
    expect(json('Creature — Eldrazi', `When ~ dies, ${SHUFFLE}`)).not.toContain('"zone":["graveyard"]');
    expect(level('Creature — Eldrazi', `When ~ is put into a graveyard from anywhere, if you control a fnord, ${SHUFFLE}`)).not.toBe('full');
  });
});

describe('edh-zones-3 "that aren\'t legendary" / "that\'s not historic" (parser/holes/filter.ts, render/np.ts; CR 700.6, 205.4a)', () => {
  it('not legendary and not historic are read after the noun and said both ways', () => {
    const a = json('Sorcery', "Exile all nonland permanents that aren't legendary.");
    expect(a).toContain('"notSupertypes":["Legendary"]');
    expect(level('Sorcery', 'Exile all nonland, nonlegendary permanents.')).toBe('full');
    expect(jsonKey(face("Exile all nonland permanents that aren't legendary.", 'Sorcery').abilities)).toBe(jsonKey(face('Exile all nonland, nonlegendary permanents.', 'Sorcery').abilities));
    const h = json('Instant', "Return each nonland permanent that's not historic to its owner's hand.");
    expect(h).toContain('"notTypes":["Land","Artifact"]');
    expect(h).toContain('"notSubtypes":["Saga"]');
    expect(level('Instant', "Destroy target creature that's not legendary.")).toBe('full');
  });
  it('near misses: other qualities after "that aren\'t" are not read as these; "historic" negated is all three of its kinds, not one', () => {
    expect(level('Sorcery', "Exile all nonland permanents that aren't blorfty.")).not.toBe('full');
    expect(json('Sorcery', "Exile all nonland permanents that aren't legendary.")).not.toContain('"Artifact"');
    expect(json('Sorcery', 'Exile all nonland permanents that are not historic.')).toContain('"Saga"');
  });
});

describe('edh-zones-3 complete events joined by "or", and "from anywhere other than the battlefield" (parser/holes/event.ts, render/evt.ts; CR 603.2, 400.3)', () => {
  const TRIGGER = 'Whenever another creature dies, or a creature card is put into a graveyard from anywhere other than the battlefield, or a creature card leaves your graveyard, ~ deals 1 damage to each opponent.';
  it('three events, each its own pattern, said with the commas of Oracle or without', () => {
    expect(level('Legendary Creature — Zombie', TRIGGER)).toBe('full');
    expect(level('Legendary Creature — Zombie', TRIGGER.replaceAll(', or', ' or'))).toBe('full');
    const j = json('Legendary Creature — Zombie', TRIGGER);
    expect(j.match(/"ev":"zoneChange"/g)?.length).toBe(3);
    expect(j).toContain('"from":["hand","library","stack","exile","command"]');
  });
  it('the same event joined to a different clause: two events, and two spellings give one JSON', () => {
    const a = face('Whenever another creature dies or a creature card leaves your graveyard, ~ deals 1 damage to each opponent.', 'Legendary Creature — Zombie');
    const b = face('Whenever another creature dies, or a creature card leaves your graveyard, ~ deals 1 damage to each opponent.', 'Legendary Creature — Zombie');
    expect(understood(a)).toBe(true);
    expect(jsonKey(a.abilities)).toBe(jsonKey(b.abilities));
  });
  it('near misses: a token is no card ("a creature token is put into a graveyard from anywhere other than the battlefield" is not read), a "one or more" event is not joined, a half event is not an event', () => {
    expect(level('Legendary Creature — Zombie', 'Whenever a creature token is put into a graveyard from anywhere other than the battlefield, ~ deals 1 damage to each opponent.')).not.toBe('full');
    expect(level('Legendary Creature — Zombie', 'Whenever another creature dies or leaves, ~ deals 1 damage to each opponent.')).not.toBe('full');
    expect(level('Legendary Creature — Zombie', 'Whenever another creature dies, or fnord, ~ deals 1 damage to each opponent.')).not.toBe('full');
  });
});

describe('edh-zones-3 a group of players doing one instruction with an amount of their own (parser/lower/targets.ts#perGroupAmounts; CR 608.2f, 102.2)', () => {
  it('"Each opponent mills half their library, rounded up" is one mill per opponent, read for that opponent alone (a forEach), also inside an "instead"', () => {
    const j = json('Sorcery', 'Each opponent mills half their library, rounded up.');
    expect(j).toContain('"op":"forEach","over":{"ref":"each","who":"opponent"}');
    expect(j).toContain('"zoneSize","zone":"library","of":{"ref":"bound"');
    const k = json('Sorcery', 'Kicker {1}\nEach opponent mills eight cards. If this spell was kicked, instead each opponent mills half their library, rounded up.');
    expect(k.match(/"op":"forEach"/g)?.length).toBe(1);
    expect(level('Sorcery', 'Kicker {1}\nEach opponent mills eight cards. If this spell was kicked, instead each opponent mills half their library, rounded up.')).toBe('full');
  });
  it('near misses: a plain count, an "each player" count that reads no group, or a life total keep their reading', () => {
    expect(json('Sorcery', 'Each opponent mills eight cards.')).not.toContain('forEach');
    expect(json('Sorcery', 'Each opponent loses half their life, rounded up.')).toContain('"op":"loseLife"'); // (its own template builds its own loop)
    expect(json('Sorcery', 'Each player draws a card.')).not.toContain('forEach');
  });
});

describe('edh-zones-3 renderer alternatives (render/fold.ts shuffleInto, render/steps-zones.ts, render/fold-edhzones3.ts; CR 701.24a, 400.3)', () => {
  it('"Shuffle it into its owner\'s library" and "Shuffle target creature into its owner\'s library" say the same as "its owner shuffles it into their library"', () => {
    expect(level('Sorcery', "Shuffle target creature into its owner's library.")).toBe('full');
    expect(jsonKey(face("Shuffle target creature into its owner's library.", 'Sorcery').abilities)).toBe(jsonKey(face("Target creature's owner shuffles it into their library.", 'Sorcery').abilities));
    expect(level('Sorcery', "Shuffle target creature into its owner's graveyard.")).not.toBe('full');
  });
  it('"Return that card from your graveyard to the battlefield instead if ..." names the target card with its zone again', () => {
    const t = 'Return target creature card from your graveyard to your hand. Return that card from your graveyard to the battlefield instead if there are seven or more cards in your graveyard.';
    expect(level('Sorcery', t)).toBe('full');
    expect(level('Sorcery', t.replace('your graveyard to the battlefield instead', 'a graveyard to the battlefield instead'))).not.toBe('full');
    expect(level('Sorcery', t.replace('seven or more cards', 'seven or more lands'))).not.toBe('full');
  });
});

const index = localIndex();

describe.skipIf(index === null)('edh-zones-3 design 6.10 (local index): synthetic examples', () => {
  it('no edh-zones-3 line of an example or counter-example is a line of a real card (with the card\'s own name or "this <type>" read as "~")', () => {
    const lines = new Set<string>();
    for (const c of index ?? []) {
      for (const text of [c.oracle_text, ...(c.card_faces ?? []).map((x) => x.oracle_text)]) {
        if (typeof text !== 'string') continue;
        for (const l of text.split('\n')) {
          lines.add(l.trim());
          lines.add(l.replaceAll(c.name, '~').replace(/\bthis (creature|land|artifact|enchantment|Aura|Equipment|spell|card|Saga)\b/gi, '~').trim());
        }
      }
    }
    const verbatim = EZ3.flatMap((t) => [...t.examples.map((e) => e.text), ...t.counterExamples].filter((x) => x.split('\n').some((l) => lines.has(l.trim()))).map((x) => `${t.id}: ${x}`));
    expect(verbatim).toEqual([]);
  }, 120_000);
});
