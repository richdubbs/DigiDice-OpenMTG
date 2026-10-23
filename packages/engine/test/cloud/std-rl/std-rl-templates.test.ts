/**
 * std-rl (precon round L, slot L of the Commander-precon rounds): the template data of parser/templates/zz-cloud/std-rl.json and the round's parser and
 * renderer support (a bare "another spell" in Cond, parser/holes/cond.ts; "the greatest mana value among your commanders" in every zone,
 * parser/holes/qty.ts#commandersAnywhere; render families with-stat-before-controller, cast-only-if and counters-equal-without-number; the third person of a
 * verb of several words, render/evt.ts#personVerb; a player's search onto the battlefield tapped, render/fold-r4refs.ts; the counters-plus template's
 * "that permanent", zz-m6/replace.json). Guard G9 (design 6.8): every example lowers with its template and passes the exact render gate (G6); every
 * counter-example does not parse or parses to different JSON; near-miss mutations fail or differ; a nonsense word in place of any word of an example never
 * leaves an automated card (G2). Examples are synthetic wordings (design 6.10), checked against the local index when it is present. The behavior is in
 * std-rl-scenarios.test.ts. CR cites from memory, unverified (rules/cr/ is not in the cloud checkout).
 */
import { describe, expect, it } from 'vitest';
import { compileCard } from '../../../src/index';
import type { Template } from '../../../src/parser/types';
import { defaultParseOptions, parseCard } from '../../../src/parser/parse';
import { validateTemplates } from '../../../src/parser/chart';
import { TEMPLATE_FILES, TEMPLATE_SET } from '../../../src/parser/template-set';
import { ENGINE_CAPABILITIES } from '../../../src/model/capabilities';
import stdRl from '../../../src/parser/templates/zz-cloud/std-rl.json';
import review from '../../m5/golden/cards/cloud-std-rl-review.json';
import { automated, bare, card, fullyAutomated, jsonKey } from '../../m5/templates/support';
import { localIndex } from '../../m5/parser/support';

const RL = stdRl as Template[];
const OPTS = defaultParseOptions({ templates: [...TEMPLATE_SET], capabilities: ENGINE_CAPABILITIES }); // what a decklist card gets (design 5.2; `needs`)
type Golden = { card: string; verified: string; expect?: string }[];
const goldenUsing = (id: string, file: Golden = review as Golden): string[] => file.filter((g) => new RegExp(`[ (]${id.replaceAll('.', '\\.')}[,);]`).test(g.verified)).map((g) => g.card);

/** The type line each template's examples are printed on. */
const TYPE: Readonly<Record<string, string>> = {
  'sta.stdrl.attached.pump.whereX': 'Enchantment — Aura',
  'sta.stdrl.attached.shrink.whereX': 'Enchantment — Aura',
  'eff.stdrl.player.searches.bf.tapped': 'Sorcery',
  'eff.stdrl.copy.tokens.tapped': 'Sorcery',
  'eff.stdrl.group.attack.nodefender': 'Artifact',
  'rst.stdrl.cast.self.onlyIf': 'Creature — Wizard',
  'rst.stdrl.cast.self.onlyIf.anotherSpell': 'Creature — Bird',
  'eff.stdrl.counters.put.equalTo': 'Sorcery',
  'sta.stdrl.graveyard.landType': 'Creature — Elf',
};
const face = (id: string, text: string, typeLine?: string) => {
  const type = typeLine ?? (/^Equipped creature/.test(text) || /Equip \{/.test(text) ? 'Artifact — Equipment' : TYPE[id] ?? 'Sorcery');
  return parseCard(card('Example Relic', type, text, type.startsWith('Creature') ? { power: '2', toughness: '2' } : undefined), OPTS).faces[0]!;
};
const understood = (f: ReturnType<typeof face>): boolean => automated(f.abilities) && f.gate.every((g) => g.ok) && f.diagnostics.every((d) => d.level !== 'manual' || d.code === 'experimental');

describe('std-rl template file (design 6.3, 6.9; CONTRIBUTING "Adding a template")', () => {
  it('is loaded by the default compiler (zz-cloud/std-rl.json, after zz-cloud/std-r9.json, before zz-cloud/std-sos.json) and its ids are unique in the whole set', () => {
    const files = TEMPLATE_FILES.map((f) => f.file);
    expect(files).toContain('zz-cloud/std-rl.json');
    expect(files.indexOf('zz-cloud/std-rl.json')).toBeGreaterThan(files.indexOf('zz-cloud/std-r9.json'));
    expect(files.indexOf('zz-cloud/std-rl.json')).toBeLessThan(files.indexOf('zz-cloud/std-sos.json'));
    const ids = TEMPLATE_SET.map((t) => t.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(validateTemplates([...TEMPLATE_SET])).toEqual([]);
  });
  it('design 6.9: every template cites rules, has at least two examples and two counter-examples, a status with its evidence, and is of version 8', () => {
    expect(RL.map((t) => t.id)).toEqual(Object.keys(TYPE));
    for (const t of RL) {
      expect(t.id, t.id).toMatch(/^(eff|sta|rst)\.stdrl\./);
      expect(t.cr.length, t.id).toBeGreaterThan(0);
      for (const cr of t.cr) expect(cr, t.id).toMatch(/^CR \d{3}(\.\d+[a-z]?)?$/);
      expect(t.examples.length, t.id).toBeGreaterThanOrEqual(2);
      expect(t.counterExamples.length, t.id).toBeGreaterThanOrEqual(2);
      expect(t.since, t.id).toBe(8);
      expect(t.status, t.id).toBe('stable');
    }
    for (const g of review as Golden) expect(g.expect, g.card).toBe('full');
    // three or more independently verified golden cards (design 6.9)
    expect(goldenUsing('sta.stdrl.attached.pump.whereX')).toEqual(['Staff of Titania', 'Exoskeletal Armor', 'Opaline Bracers', 'Tangleweave Armor']);
    expect(goldenUsing('rst.stdrl.cast.self.onlyIf.anotherSpell')).toEqual(['Hewed Stone Retainers', 'Illusory Angel', 'Skyshroud Condor']);
    // two tuning-half golden cards (the other cards of its 14 in the index are held out or need more): stable, a 6.9 deviation named in the record and the PR
    expect(goldenUsing('rst.stdrl.cast.self.onlyIf')).toEqual(['Twice Upon a Time // Unlikely Meeting', "Talara's Battalion"]);
    // narrow wordings (one tuning-half card each): stable on one hand-verified golden card plus these tests, a 6.9 deviation named in the round record and the PR
    expect(goldenUsing('sta.stdrl.attached.shrink.whereX')).toEqual(["Kagemaro's Clutch"]);
    expect(goldenUsing('eff.stdrl.player.searches.bf.tapped')).toEqual(['Fertilid']);
    expect(goldenUsing('eff.stdrl.copy.tokens.tapped')).toEqual(['Skyclave Relic']);
    expect(goldenUsing('eff.stdrl.group.attack.nodefender')).toEqual(['Wakestone Gargoyle']);
    expect(goldenUsing('eff.stdrl.counters.put.equalTo')).toEqual(['Experiment Twelve']);
    expect(goldenUsing('sta.stdrl.graveyard.landType')).toEqual(["Titania, Nature's Force"]);
  });
  it('guard G3: a critical word a pattern spells out is listed in `consumes`', () => {
    for (const t of RL) {
      const words = t.pattern.toLowerCase().replace(/\{[^}]*:[^}]*\}/g, ' ').split(/[^a-z']+/).filter(Boolean);
      for (const w of ['all', 'each', 'another', 'other', 'may', 'if', 'unless', 'until', 'instead', 'only', 'chosen', 'except', "can't", 'would', 'next', 'then', 'when', 'also']) {
        if (words.includes(w)) expect(t.consumes ?? [], `${t.id}: ${w}`).toContain(w);
      }
    }
  });
});

describe('std-rl guard G9 (design 6.8): examples and counter-examples', () => {
  for (const t of RL) {
    it(`${t.id} (${t.cr.join(', ')}): every example parses with it, is automated and passes the render gate; counter-examples do not give the same JSON`, () => {
      const first = face(t.id, t.examples[0]!.text);
      for (const e of t.examples) {
        const f = face(t.id, e.text);
        expect(f.templatesUsed, e.text).toContain(t.id);
        expect(understood(f), `${e.text}: ${JSON.stringify(f.abilities)} ${JSON.stringify(f.diagnostics)} ${JSON.stringify(f.gate)}`).toBe(true);
        expect(fullyAutomated(f), e.text).toBe(true);
        if (e.expect !== undefined) expect(bare(f.abilities), e.text).toEqual(e.expect);
      }
      for (const c of t.counterExamples) {
        const f = face(t.id, c);
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
    [/\+X\/\+X/, '+X/+0'], [/-X\/-X/, '-X/-0'], [/\btapped\b/, 'untapped'], [/\bonly if\b/, 'unless'], [/\bthis turn as though\b/, 'as though'],
    [/\bdefender\.$/, 'flying.'], [/\btheir library\b/, 'your library'], [/\bgraveyard\.$/, 'hand.'], [/\bequal to\b/, 'for each'], [/\bcopies\b/, 'tokens'],
  ];
  for (const [re, by] of swaps) if (re.test(text)) out.push(text.replace(re, by));
  return out;
}

describe('std-rl guard G9 (design 6.8): near-miss mutations fail or differ', () => {
  for (const t of RL) {
    it(`${t.id}: an appended condition, or a swapped key word, never gives the example's JSON`, () => {
      for (const e of t.examples) {
        const orig = face(t.id, e.text);
        for (const m of nearMisses(e.text)) {
          if (m === e.text) continue;
          const f = face(t.id, m);
          expect(understood(f) && jsonKey(f.abilities) === jsonKey(orig.abilities), m).toBe(false);
        }
      }
    });
  }
});

describe('std-rl guard G2 (design 6.8): a nonsense word never leaves an automated card', () => {
  for (const t of RL) {
    it(`${t.id}: replacing any one word of an example by an invented word makes the card not understood`, () => {
      for (const e of t.examples) {
        const lines = e.text.split('\n');
        const last = lines.length - 1; // the line of the template (an earlier line is a keyword or a reminder of the card type)
        const words = lines[last]!.split(' ');
        words.forEach((w, i) => {
          if (/^counters?\b/.test(words[i + 1] ?? '')) return; // a counter's kind is any name (CR 122.1)
          const end = w.match(/[.,"]+$/)?.[0] ?? '';
          const mutated = [...lines.slice(0, last), [...words.slice(0, i), `blorfty${end}`, ...words.slice(i + 1)].join(' ')].join('\n');
          expect(understood(face(t.id, mutated)), mutated).toBe(false);
        });
      }
    });
  }
});

describe('std-rl parser support', () => {
  it('CR 601.3, 109.2: "Cast ~ only if you\'ve cast another spell this turn" is a spell other than this one (its own template, so FAST4 T32\'s and r4-fxz\'s readings of the words are untouched)', () => {
    const f = face('rst.stdrl.cast.self.onlyIf.anotherSpell', "Cast ~ only if you've cast another spell this turn.\nFlying");
    expect(fullyAutomated(f)).toBe(true);
    expect(JSON.stringify(f.abilities)).toContain('"when":{"cond":"happened","event":{"ev":"cast","player":"you","spell":{"other":true}},"scope":"turn","times":{"op":">=","value":1}}');
  });
  it('design 6.3 rule 2: FAST4 T32\'s cost reduction keeps "if you\'ve cast another spell this turn"', () => {
    const f = face('x', "~ costs {2} less to cast if you've cast another spell this turn.\nFlying");
    expect(f.templatesUsed).toContain('cm.t32.self.less.anotherSpell');
  });
  it('CR 903.3, 903.3d: "the greatest mana value among your commanders" counts the commanders you own in every zone', () => {
    const f = face('sta.stdrl.attached.pump.whereX', 'Equipped creature gets +X/+X, where X is the greatest mana value among your commanders.\nEquip {3}');
    expect(fullyAutomated(f)).toBe(true);
    expect(JSON.stringify(f.abilities)).toContain('"filter":{"commander":true,"owner":"you","zone":"any"}');
  });
  it('CR 614.1a: the counters-plus template also says "that permanent" (rep.m6.counters.plus)', () => {
    const f = face('x', 'If one or more +1/+1 counters would be put on an artifact you control, that many plus one +1/+1 counters are put on that permanent instead.', 'Enchantment');
    expect(fullyAutomated(f)).toBe(true);
    expect(f.templatesUsed).toContain('rep.m6.counters.plus');
  });
  it('CR 205.3i: "You may play artifacts from your graveyard" is not a land permission (fails closed)', () => {
    // the parse is the template's; the engine has no capability for it (statics/play-permits.ts#isGraveyardLandFilter, model/cap-walk.ts), so the card is manual
    expect(compileCard(card('Example Relic', 'Creature — Elf', 'You may play artifacts from your graveyard.', { power: '2', toughness: '2' })).automation.level).toBe('manual');
    expect(compileCard(card('Example Relic', 'Creature — Elf', 'You may play Islands from your graveyard.', { power: '2', toughness: '2' })).automation.level).toBe('full');
  });
});

describe('std-rl renderer support', () => {
  it('CR 208.1, 109.4 (family with-stat-before-controller): "target creature with power 4 or greater an opponent controls"', () => {
    const a = face('x', 'Destroy target creature with power 4 or greater an opponent controls.');
    const b = face('x', 'Destroy target creature an opponent controls with power 4 or greater.');
    expect(fullyAutomated(a)).toBe(true);
    expect(jsonKey(a.abilities)).toBe(jsonKey(b.abilities));
  });
  it('CR 700.13: "whenever an opponent commits a crime" (the verb of several words conjugated on its first word)', () => {
    expect(fullyAutomated(face('x', 'Whenever an opponent commits a crime, you gain 1 life.', 'Enchantment'))).toBe(true);
  });
  it('CR 601.3 (family cast-only-if): "Cast ~ only if C" and "You can\'t cast ~ unless C" are one restriction', () => {
    const a = face('rst.stdrl.cast.self.onlyIf', 'Cast ~ only if you control three or more Islands.\nFlying');
    const b = face('x', "You can't cast ~ unless you control three or more Islands.\nFlying", 'Creature — Wizard');
    expect(fullyAutomated(a)).toBe(true);
    if (fullyAutomated(b)) expect(jsonKey(b.abilities)).toBe(jsonKey(a.abilities));
  });
  it('CR 122.1 (family counters-equal-without-number): "put +1/+1 counters on X equal to Q" is "put a number of +1/+1 counters on X equal to Q"', () => {
    const a = face('eff.stdrl.counters.put.equalTo', 'Put +1/+1 counters on target creature equal to the number of Forests you control.');
    const b = face('x', 'Put a number of +1/+1 counters on target creature equal to the number of Forests you control.');
    expect(fullyAutomated(a)).toBe(true);
    expect(jsonKey(a.abilities)).toBe(jsonKey(b.abilities));
  });
});

const index = localIndex();

describe.skipIf(index === null)('std-rl design 6.10 (local index): synthetic examples', () => {
  it('no std-rl line of an example or counter-example is a line of a real card (with the card\'s own name or "this <type>" read as "~")', () => {
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
    // (a line that is only a keyword ability, "Flying", "Enchant creature", "Equip {3}", gives the example its card type and is not the template's)
    const context = /^(Flying|Reach|Trample|Vigilance|Enchant creature|Equip \{\d\})$/;
    const verbatim = RL.flatMap((t) => [...t.examples.map((e) => e.text), ...t.counterExamples].filter((x) => x.split('\n').some((l) => !context.test(l.trim()) && lines.has(l.trim()))).map((x) => `${t.id}: ${x}`));
    expect(verbatim).toEqual([]);
  }, 120_000);
});
