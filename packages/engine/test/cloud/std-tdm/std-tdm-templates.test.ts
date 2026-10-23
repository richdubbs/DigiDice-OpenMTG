/**
 * Cloud batch 2, slice std-tdm (the Standard backlog of Tarkir: Dragonstorm, tuning half): the template data of parser/templates/zz-cloud/std-tdm.json and the
 * lowering, renderer and model support they needed. Guard G9 (design 6.8): every example lowers with its template, is automated and passes the exact render gate
 * (G6); every counter-example does not parse or parses to different JSON; near-miss mutations fail or differ; a nonsense word in place of any word of an example
 * never leaves an automated card (G2). Examples are synthetic wordings (design 6.10), checked against the local index when it is present. The behavior is in
 * std-tdm-scenarios.test.ts.
 */
import { describe, expect, it } from 'vitest';
import type { OracleCard } from '../../../src/index';
import type { Template } from '../../../src/parser/types';
import { defaultParseOptions, parseCard } from '../../../src/parser/parse';
import { validateTemplates } from '../../../src/parser/chart';
import { TEMPLATE_FILES, TEMPLATE_SET } from '../../../src/parser/template-set';
import { ENGINE_CAPABILITIES } from '../../../src/model/capabilities';
import stdTdm from '../../../src/parser/templates/zz-cloud/std-tdm.json';
import review from '../../m5/golden/cards/cloud-std-tdm-review.json';
import { automated, bare, card, fullyAutomated, jsonKey } from '../../m5/templates/support';
import { localIndex } from '../../m5/parser/support';

const TDM = stdTdm as Template[];
const OPTS = defaultParseOptions({ templates: [...TEMPLATE_SET], capabilities: ENGINE_CAPABILITIES }); // what a decklist card gets (design 5.2; `needs`)

/** A synthetic card in which an example is an ability of the right kind: a spell on a sorcery, a triggered or activated ability on a creature. */
function exampleCard(t: Template, text: string): OracleCard {
  if (t.kind === 'effect' && !text.includes(':') && !/^(When|Whenever|At)\b/.test(text)) return card('Example Volley', 'Sorcery', text);
  return card('Example Brute', 'Creature — Elf Warrior', text, { power: '3', toughness: '3' });
}
const parsedWith = (t: Template, text: string) => parseCard(exampleCard(t, text), OPTS).faces[0]!;
const face = (type: string, text: string) => parseCard(card('Example Brute', type, text, { power: '3', toughness: '3' }), OPTS).faces[0]!;

describe('std-tdm template file (design 6.3, 6.9; CONTRIBUTING "Adding a template")', () => {
  it('is loaded by the default compiler (zz-cloud/std-tdm.json, after trigger.json, before zz-fast1/) and its ids are unique in the whole set', () => {
    const files = TEMPLATE_FILES.map((f) => f.file);
    expect(files).toContain('zz-cloud/std-tdm.json');
    expect(files.indexOf('zz-cloud/std-tdm.json')).toBeGreaterThan(files.indexOf('trigger.json'));
    expect(files.indexOf('zz-cloud/std-tdm.json')).toBeLessThan(files.findIndex((f) => f.startsWith('zz-fast1/')));
    const ids = TEMPLATE_SET.map((t) => t.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(validateTemplates([...TEMPLATE_SET])).toEqual([]);
  });
  it('design 6.9: every template cites rules, has at least two examples and two counter-examples, a status, and is of version 8; ids are eff.stdtdm.* or trg.stdtdm.*', () => {
    expect(TDM.length).toBe(12);
    for (const t of TDM) {
      expect(t.id, t.id).toMatch(/^(eff|trg|sta)\.stdtdm\./);
      expect(t.cr.length, t.id).toBeGreaterThan(0);
      for (const cr of t.cr) expect(cr, t.id).toMatch(/^CR \d{3}(\.\d+[a-z]?)?$/);
      expect(t.examples.length, t.id).toBeGreaterThanOrEqual(2);
      expect(t.counterExamples.length, t.id).toBeGreaterThanOrEqual(2);
      expect(['stable', 'experimental'], t.id).toContain(t.status);
      expect(t.since, t.id).toBe(8);
    }
  });
  it('design 6.9: a stable template has its evidence: at least one hand-verified golden card that uses it (the review file pins each card as full)', () => {
    const golden = review as { card: string; verified: string; expect?: string }[];
    for (const t of TDM.filter((x) => x.status === 'stable')) {
      const cards = golden.filter((g) => g.verified.includes(`(${t.id}`) || g.verified.includes(` ${t.id}`) || g.verified.includes(`${t.id},`)).map((g) => g.card);
      expect(cards.length, t.id).toBeGreaterThanOrEqual(1);
    }
    for (const g of golden) expect(g.expect, g.card).toBe('full');
  });
  it('guard G3: a critical word a pattern spells out is listed in `consumes`', () => {
    for (const t of TDM) {
      const words = t.pattern.toLowerCase().replace(/\{[^}]*:[^}]*\}/g, ' ').split(/[^a-z']+/).filter(Boolean);
      for (const w of ['all', 'each', 'another', 'other', 'may', 'if', 'unless', 'until', 'instead', 'only', 'chosen', 'additional', 'except', "can't", 'would', 'next', 'then']) {
        if (words.includes(w)) expect(t.consumes ?? [], `${t.id}: ${w}`).toContain(w);
      }
    }
  });
});

describe('std-tdm guard G9 (design 6.8): examples and counter-examples', () => {
  for (const t of TDM) {
    it(`${t.id} (${t.cr.join(', ')}): every example parses with it, is automated and passes the render gate; counter-examples do not give the same JSON`, () => {
      const first = parsedWith(t, t.examples[0]!.text);
      for (const e of t.examples) {
        const f = parsedWith(t, e.text);
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
  const body = text.replace(/\.$/, '');
  const out = [`${body} unless it is blue.`, `${body} instead.`, `${body} at random.`, `${body} twice.`, `${body} if able.`];
  const swaps: [RegExp, string][] = [
    [/\bfor each\b/, 'for any'], [/\btapped\b/, 'untapped'], [/\buntil end of turn\b/, 'until your next turn'], [/\bwhenever you\b/i, 'Whenever an opponent'],
    [/\bdestroyed this way\b/, 'exiled this way'], [/\bon top of\b/, 'on the bottom of'], [/\bin any order\b/, 'in a random order'], [/\bdivided as you choose\b/, 'divided evenly, rounded down,'],
    [/ or a /, ' and a '], [/ or an /, ' and an '], [/\band a\b/, 'or a'], [/\bexile ~\b/, 'sacrifice ~'], [/\bYou gain\b/, 'Target opponent gains'],
  ];
  for (const [re, by] of swaps) if (re.test(text)) out.push(text.replace(re, by));
  return out;
}

describe('std-tdm guard G9 (design 6.8): near-miss mutations fail or differ', () => {
  for (const t of TDM) {
    it(`${t.id}: an appended "unless/instead/at random/twice/if able" or a swapped key word never gives the example's JSON`, () => {
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

describe('std-tdm guard G2 (design 6.8): a nonsense word never leaves an automated card', () => {
  for (const t of TDM) {
    it(`${t.id}: replacing any one word of an example by an invented word makes the card not fully automated`, () => {
      for (const e of t.examples) {
        const words = e.text.split(' ');
        words.forEach((w, i) => {
          // the counter kind is any word before "counter" (the CounterKind hole takes unlisted words, as every counter template of the set does)
          if (w === '~' || w === '~,' || w === '~.' || /^\{/.test(w) || /^counters?[.,]?$/.test(words[i + 1] ?? '')) return;
          const end = w.match(/[.,]+$/)?.[0] ?? '';
          const mutated = [...words.slice(0, i), `blorfty${end}`, ...words.slice(i + 1)].join(' ');
          expect(fullyAutomated(parsedWith(t, mutated)), mutated).toBe(false);
        });
      }
    });
  }
});

describe('std-tdm lowering, renderer and model support', () => {
  it('CR 701.8a, 608.2c: "for each <noun> destroyed this way" is the result count of the destroy step, and only a noun that names everything it destroys is read', () => {
    const ok = face('Sorcery', 'Destroy all creatures. Draw a card for each creature destroyed this way.');
    expect(automated(ok.abilities)).toBe(true);
    expect(JSON.stringify(ok.abilities)).toContain('"count":{"q":"resultCount","step":"destroy"}');
    expect(automated(face('Sorcery', 'Destroy all creatures and enchantments. Draw a card for each permanent destroyed this way.').abilities)).toBe(true);
    // a narrower noun would count a part of the result, which the model has no quantity for: manual, never the whole count
    expect(automated(face('Sorcery', 'Destroy all creatures and enchantments. Draw a card for each creature destroyed this way.').abilities)).toBe(false);
    expect(automated(face('Sorcery', 'Exile all creatures. Draw a card for each creature destroyed this way.').abilities)).toBe(false);
  });
  it('CR 608.2c, 614.11: "If you don\'t draw a card this way" names the draw right before it (a guarded draw too), never another instruction', () => {
    const ok = face('Creature — Dog', "When ~ enters, draw a card if you control an artifact. If you don't draw a card this way, put a +1/+1 counter on ~.");
    expect(fullyAutomated(ok)).toBe(true);
    expect(JSON.stringify(ok.abilities)).toContain('"cond":{"cond":"did","step":"drew","not":true}');
    expect(automated(face('Creature — Dog', "When ~ enters, you gain 2 life. If you don't draw a card this way, put a +1/+1 counter on ~.").abilities)).toBe(false);
  });
  it('CR 602.5b: two conditions of one activation restriction are both required; a history question of this turn is read as the ability is activated', () => {
    const both = face('Artifact', '{T}: Draw a card. Activate only during your turn and only if a card left your graveyard this turn.');
    expect(fullyAutomated(both)).toBe(true);
    expect(JSON.stringify(both.abilities)).toContain('"onlyIf":{"cond":"all","of":[{"cond":"turnOf","whose":"you"},{"cond":"happened"');
    // a comparison the announcement code cannot read is never taken as met (std-ry5 made a group's total power readable, so this pin now uses the greatest
    // power among a group, which the announcement still cannot read: its announcement form is a capability the engine does not have, so the card is manual)
    const power = face('Artifact', '{T}: Draw a card. Activate only if the greatest power among creatures you control is 4 or greater.');
    expect(JSON.stringify(power.abilities)).toContain('"agg":"max"');
    expect(ENGINE_CAPABILITIES.has('feature:announce.qty.stat.each')).toBe(false);
  });
  it('CR 601.2a, 603.4: "if you cast it" of the creature that entered reads that creature\'s cast record; anywhere else the pronoun must be the source', () => {
    const ok = face('Enchantment', 'Whenever a creature you control enters, if you cast it, draw a card.');
    expect(fullyAutomated(ok)).toBe(true);
    expect(JSON.stringify(ok.abilities)).toContain('"interveningIf":{"cond":"wasCast","by":"you","object":{"ref":"event","role":"subject"}}');
    expect(automated(face('Enchantment', 'Whenever a creature you control dies, if you cast it, draw a card.').abilities)).toBe(false);
    expect(automated(face('Enchantment', 'Whenever a creature you control enters, if it was kicked, draw a card.').abilities)).toBe(false);
  });
  it('CR 603.7, 603.3d: a target a delayed trigger announces is its own (delay.targets), chosen when it is put on the stack; the creating ability announces none', () => {
    const f = face('Sorcery', 'Draw a card. Whenever you cast a noncreature spell this turn, target creature you control gains double strike until end of turn.');
    expect(fullyAutomated(f)).toBe(true);
    const spell = f.abilities[0] as { effect: { targets: unknown[]; steps: { op: string; targets?: { id: string }[] }[] } };
    expect(spell.effect.targets).toEqual([]);
    expect(spell.effect.steps.find((s) => s.op === 'delay')?.targets?.map((t) => t.id)).toEqual(['t0']);
  });
  it('CR 701.21a, 118.3: "Sacrifice a creature you control other than ~" is one other creature; "your library has no cards in it" is an empty library', () => {
    const sac = face('Creature — Snake', '{T}, Sacrifice a creature you control other than ~: Draw a card.');
    expect(fullyAutomated(sac)).toBe(true);
    expect(JSON.stringify(sac.abilities)).toContain('"filter":{"types":["Creature"],"controller":"you","other":true}');
    const lib = face('Sorcery', 'If your library has no cards in it, draw a card.');
    expect(jsonKey(lib.abilities)).toBe(jsonKey(face('Sorcery', 'If there are no cards in your library, draw a card.').abilities));
  });
  it('CR 702.66a: "Spells you cast have delve" grants a keyword the engine plays (keyword:delve)', () => {
    expect(ENGINE_CAPABILITIES.has('keyword:delve')).toBe(true);
    expect(fullyAutomated(face('Enchantment', 'Instant spells you cast have delve.'))).toBe(true);
  });
});

const index = localIndex();

describe.skipIf(index === null)('std-tdm design 6.10 (local index): synthetic examples', () => {
  it('no std-tdm line of an example or counter-example is a line of a real card (with the card\'s own name or "this <type>" read as "~")', () => {
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
    const verbatim = TDM.flatMap((t) => [...t.examples.map((e) => e.text), ...t.counterExamples].filter((x) => x.split('\n').some((l) => lines.has(l.trim()))).map((x) => `${t.id}: ${x}`));
    expect(verbatim).toEqual([]);
  }, 120_000);
});
