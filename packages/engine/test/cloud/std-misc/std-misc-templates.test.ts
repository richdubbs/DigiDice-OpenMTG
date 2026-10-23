/**
 * Cloud batch 2, slice std-misc (the Standard backlog of the small sets big, ecc, eoc, frc, inr, msc, soc, tdc and tle, tuning half): the template data of
 * parser/templates/zz-cloud/std-misc.json and the renderer and lowering support they needed. Guard G9 (design 6.8): every example lowers with its template, is
 * automated and passes the exact render gate (G6); every counter-example does not parse or parses to different JSON; near-miss mutations fail or differ; a nonsense
 * word in place of any word of an example never leaves an automated card (G2). Examples are synthetic wordings (design 6.10), checked against the local index when it
 * is present. The behavior is in std-misc-scenarios.test.ts.
 */
import { describe, expect, it } from 'vitest';
import type { OracleCard } from '../../../src/index';
import type { Template } from '../../../src/parser/types';
import { defaultParseOptions, parseCard } from '../../../src/parser/parse';
import { validateTemplates } from '../../../src/parser/chart';
import { TEMPLATE_FILES, TEMPLATE_SET } from '../../../src/parser/template-set';
import { ENGINE_CAPABILITIES } from '../../../src/model/capabilities';
import stdMisc from '../../../src/parser/templates/zz-cloud/std-misc.json';
import review from '../../m5/golden/cards/cloud-std-misc-review.json';
import { automated, card, fullyAutomated, jsonKey } from '../../m5/templates/support';
import { localIndex } from '../../m5/parser/support';

const MISC = stdMisc as Template[];
const OPTS = defaultParseOptions({ templates: [...TEMPLATE_SET], capabilities: ENGINE_CAPABILITIES }); // what a decklist card gets (design 5.2; `needs`)

/** A synthetic card in which an example is an ability of the right kind: a spell on a sorcery, a static ability on an artifact, anything else on a creature. */
function exampleCard(t: Template, text: string): OracleCard {
  const x = /\bX\b/.test(text) ? { mana_cost: '{X}{G}' } : {}; // CR 107.3: an X the card's cost defines
  if (t.kind === 'effect' && !text.includes(':') && (!/^(When|Whenever|At)\b/.test(text) || /^When you next\b/.test(text)) && !text.includes('\n')) return card('Example Volley', 'Sorcery', text, x);
  if (t.kind === 'static') return card('Example Relic', 'Artifact', text);
  if (t.id.startsWith('trg.stdmisc.you.sacrifice')) return card('Example Engine', 'Artifact Creature — Construct', text, { power: '1', toughness: '1' }); // "~ or another artifact / creature"
  if (text.includes('exiled with')) return card('Example Shrine', 'Enchantment', text);
  return card('Example Brute', 'Creature — Elf Warrior', text, { power: '3', toughness: '3', ...x });
}
const parsedWith = (t: Template, text: string) => parseCard(exampleCard(t, text), OPTS).faces[0]!;

describe('std-misc template file (design 6.3, 6.9; CONTRIBUTING "Adding a template")', () => {
  it('is loaded by the default compiler (zz-cloud/std-misc.json, after zz-cloud/std-hob.json, before zz-cloud/std-otj.json and zz-fast1/) and its ids are unique in the whole set', () => {
    const files = TEMPLATE_FILES.map((f) => f.file);
    expect(files).toContain('zz-cloud/std-misc.json');
    expect(files.indexOf('zz-cloud/std-misc.json')).toBeGreaterThan(files.indexOf('zz-cloud/std-hob.json'));
    expect(files.indexOf('zz-cloud/std-misc.json')).toBeLessThan(files.indexOf('zz-cloud/std-otj.json'));
    expect(files.indexOf('zz-cloud/std-misc.json')).toBeLessThan(files.findIndex((f) => f.startsWith('zz-fast1/')));
    const ids = TEMPLATE_SET.map((t) => t.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(validateTemplates([...TEMPLATE_SET])).toEqual([]);
  });
  it('design 6.9: every template cites rules, has at least two examples and two counter-examples, a status, and is of version 8; ids are eff.stdmisc.*, trg.stdmisc.* or sta.stdmisc.*', () => {
    // 15: eff.stdmisc.nextEnd.copyToken was collapsed in Standard merge wave 4 (line fx) into dl.nextEnd.lead + eff.copy.token, the same JSON
    expect(MISC.length).toBe(15);
    for (const t of MISC) {
      expect(t.id, t.id).toMatch(/^(eff|trg|sta)\.stdmisc\./);
      expect(t.cr.length, t.id).toBeGreaterThan(0);
      for (const cr of t.cr) expect(cr, t.id).toMatch(/^CR \d{3}(\.\d+[a-z]?)?$/);
      expect(t.examples.length, t.id).toBeGreaterThanOrEqual(2);
      expect(t.counterExamples.length, t.id).toBeGreaterThanOrEqual(2);
      expect(['stable', 'experimental'], t.id).toContain(t.status);
      expect(t.since, t.id).toBe(8);
    }
  });
  it('design 6.9: a stable template has its evidence: at least one hand-verified golden card that uses it (the review file pins each card as full); the two experimental ones have no real card yet (p2-promote-1 made eff.stdmisc.copy.spell.artifact stable on Tawnos, the Toymaker, 6.9 narrow)', () => {
    const golden = review as { card: string; verified: string; expect?: string }[];
    for (const t of MISC.filter((x) => x.status === 'stable')) {
      const cards = golden.filter((g) => g.verified.includes(`(${t.id}`) || g.verified.includes(` ${t.id}`) || g.verified.includes(`${t.id},`) || g.verified.includes(`${t.id})`)).map((g) => g.card);
      expect(cards.length, t.id).toBeGreaterThanOrEqual(1);
    }
    expect(MISC.filter((t) => t.status === 'experimental').map((t) => t.id).sort()).toEqual(['eff.stdmisc.gainlife.perColorOf', 'eff.stdmisc.token.you.half.down']);
    for (const g of golden) expect(g.expect, g.card).toBe('full');
  });
  it('guard G3: a critical word a pattern spells out is listed in `consumes`', () => {
    for (const t of MISC) {
      const words = t.pattern.toLowerCase().replace(/\{[^}]*:[^}]*\}/g, ' ').split(/[^a-z']+/).filter(Boolean);
      for (const w of ['all', 'each', 'another', 'other', 'may', 'if', 'unless', 'until', 'instead', 'only', 'chosen', 'additional', 'except', "can't", 'would', 'next', 'then', 'random', 'different']) {
        if (words.includes(w)) expect(t.consumes ?? [], `${t.id}: ${w}`).toContain(w);
      }
    }
  });
});

describe('std-misc guard G9 (design 6.8): examples and counter-examples', () => {
  for (const t of MISC) {
    it(`${t.id} (${t.cr.join(', ')}): every example parses with it, is automated and passes the render gate; counter-examples do not give the same JSON`, () => {
      const first = parsedWith(t, t.examples[0]!.text);
      for (const e of t.examples) {
        const f = parsedWith(t, e.text);
        // an experimental template whose wording a stable template also lowers to the same result gives way to it (design 6.9, G10)
        const fellBack = t.status === 'experimental' && f.diagnostics.some((d) => d.code === 'experimental' && d.message.includes(t.id));
        expect(f.templatesUsed.includes(t.id) || fellBack, `${e.text}: ${f.templatesUsed.join(', ')}`).toBe(true);
        expect(automated(f.abilities), `${e.text}: ${JSON.stringify(f.abilities)} ${JSON.stringify(f.diagnostics)}`).toBe(true);
        expect(f.gate.every((g) => g.ok), `${e.text}: ${JSON.stringify(f.gate)}`).toBe(true);
        expect(f.diagnostics.filter((d) => d.level === 'manual'), e.text).toEqual([]);
        if (e.expect !== undefined) expect((f.abilities.find((a) => a.kind === 'triggered') as { trigger?: unknown } | undefined)?.trigger, e.text).toEqual(e.expect);
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
  const out = text.includes('\n') ? [] : [`${body} unless it is blue.`, `${body} instead.`, `${body} at random.`, `${body} twice.`, `${body} if able.`];
  const swaps: [RegExp, string][] = [
    [/\bfor each\b/, 'for any'], [/\btapped\b/, 'untapped'], [/\bor more\b/, 'or fewer'], [/\bwhenever you\b/, 'whenever an opponent'], [/\bisn't legendary\b/, 'is legendary'],
    [/\bcard name\b/, 'creature type'], [/\bone or more players\b/, 'a player'], [/\bentering\b/, 'dying'], [/\bat random\b/, 'of your choice'], [/\bdifferent names\b/, 'the same name'],
    [/\bnext end step\b/, 'next upkeep'], [/\bhalf\b/, 'all'], [/\bbetween 0 and 10\b/, 'between 0 and 20'], [/\bone or more colors\b/, 'two or more colors'],
  ];
  for (const [re, by] of swaps) if (re.test(text)) out.push(text.replace(re, by));
  return out;
}

describe('std-misc guard G9 (design 6.8): near-miss mutations fail or differ', () => {
  for (const t of MISC) {
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

describe('std-misc guard G2 (design 6.8): a nonsense word never leaves an automated card', () => {
  for (const t of MISC) {
    it(`${t.id}: replacing any one word of an example by an invented word makes the card not fully automated`, () => {
      for (const e of t.examples) {
        const words = e.text.split(' ');
        words.forEach((w, i) => {
          if (w === '~' || w === '~.' || w === '~,' || /^"?\{/.test(w) || w.includes('\n')) return;
          const end = w.match(/[.,"]+$/)?.[0] ?? '';
          const mutated = [...words.slice(0, i), `blorfty${end}`, ...words.slice(i + 1)].join(' ');
          expect(fullyAutomated(parsedWith(t, mutated)), mutated).toBe(false);
        });
      }
    });
  }
});

describe('std-misc parser, lowering and renderer support', () => {
  const face = (type: string, text: string) => parseCard(card('Example Brute', type, text, { power: '3', toughness: '3' }), OPTS).faces[0]!;
  it('CR 608.2c-d, 607.2d: "the chosen name" and "the chosen number" need an earlier choice of that kind in the same ability; without one the sentence is manual', () => {
    expect(fullyAutomated(face('Sorcery', 'Destroy all creatures with the chosen name.'))).toBe(false);
    expect(fullyAutomated(face('Sorcery', 'Destroy all creatures with power greater than or equal to the chosen number.'))).toBe(false);
    expect(fullyAutomated(face('Sorcery', 'Choose a creature type. Destroy all creatures with the chosen name.'))).toBe(false);
    expect(fullyAutomated(face('Sorcery', 'Choose a card name. Destroy all creatures with power greater than or equal to the chosen number.'))).toBe(false);
    const ok = face('Sorcery', 'Choose a card name. Exile all creatures with the chosen name.');
    expect(fullyAutomated(ok)).toBe(true);
    expect(JSON.stringify(ok.abilities)).toContain('"chosen":{"link":"chosenCardName","quality":"cardName"}');
  });
  it('coven (CR 208.1): "you control three or more creatures with different powers" reads the different powers; "four or more lands" keeps its one reading', () => {
    const coven = face('Creature — Human', 'At the beginning of combat on your turn, if you control three or more creatures with different powers, this creature gains trample until end of turn.');
    expect(fullyAutomated(coven)).toBe(true);
    expect(JSON.stringify(coven.abilities)).toContain('"q":"distinct","what":"powers"');
    const lands = face('Sorcery', 'Draw a card. Then if you control four or more lands, untap target land.');
    expect(lands.diagnostics.filter((d) => d.code === 'ambiguous')).toEqual([]);
    expect(fullyAutomated(face('Creature — Human', 'Whenever this creature attacks, if you control three or more creatures with different toughnesses, draw a card.'))).toBe(false);
  });
  it('CR 603.4, 608.2h: "if its toughness was less than 1" is the comparison FAST4 T26 builds for "if its mana value was 3 or less" (one reading)', () => {
    const a = face('Creature — Human', 'Whenever a creature an opponent controls dies, if its power was less than 2, draw a card.');
    expect(fullyAutomated(a)).toBe(true);
    expect(JSON.stringify(a.abilities)).toContain('"interveningIf":{"cond":"compare","left":{"q":"stat","stat":"power","of":{"ref":"event","role":"subject"}},"op":"<","right":2}');
    const t26 = face('Sorcery', 'Destroy target creature. If its mana value was 3 or less, create a Treasure token.');
    expect(fullyAutomated(t26)).toBe(true);
    expect(t26.diagnostics.filter((d) => d.code === 'ambiguous')).toEqual([]);
    expect(JSON.stringify(t26.abilities)).toContain('"cond":{"cond":"compare","left":{"q":"stat","stat":"manaValue"');
  });
  it('CR 506.2, 508.1: after "Whenever ~ attacks", "they" is the defending player, never the attacking one (you)', () => {
    const f = face('Creature — Rogue', 'Whenever this creature attacks, it deals damage to defending player equal to the number of creatures they control.');
    expect(fullyAutomated(f)).toBe(true);
    expect(JSON.stringify(f.abilities)).toContain('"controller":{"ref":"event","role":"defender"}');
  });
  it('CR 707.9b: a spell copy\'s exception the engine can\'t make (an ability it gains) stays manual', () => {
    expect(fullyAutomated(face('Creature — Elf', 'Whenever you cast a creature spell, copy it, except the copy has haste.'))).toBe(false);
  });
});

const index = localIndex();

describe.skipIf(index === null)('std-misc design 6.10 (local index): synthetic examples', () => {
  it('no std-misc line of an example or counter-example is a line of a real card (with the card\'s own name or "this <type>" read as "~")', () => {
    const lines = new Set<string>();
    for (const c of index ?? []) {
      for (const text of [c.oracle_text, ...(c.card_faces ?? []).map((x) => x.oracle_text)]) {
        if (typeof text !== 'string') continue;
        for (const l of text.split('\n')) {
          lines.add(l.trim());
          lines.add(l.replaceAll(c.name, '~').replace(/\bthis (creature|land|artifact|enchantment|Aura|spell|card|Saga)\b/gi, '~').trim());
        }
      }
    }
    const verbatim = MISC.flatMap((t) => [...t.examples.map((e) => e.text), ...t.counterExamples].filter((x) => x.split('\n').some((l) => lines.has(l.trim()))).map((x) => `${t.id}: ${x}`));
    expect(verbatim).toEqual([]);
  }, 120_000);
});
