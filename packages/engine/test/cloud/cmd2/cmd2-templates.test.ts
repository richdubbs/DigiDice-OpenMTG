/**
 * Commander batch, agent CMD2 (references to commanders in card text): the template data of parser/templates/zz-cloud/cmd2.json and the parser and renderer
 * support of the family. Guard G9 (design 6.8): every example lowers with its template, is automated and passes the exact render gate (G6); every
 * counter-example does not parse or parses to different JSON; near-miss mutations fail or differ; a nonsense word in place of any word of an example never
 * leaves an automated card (G2). Examples are synthetic wordings (design 6.10), checked against the local index when it is present. The behavior is in
 * cmd2-scenarios.test.ts.
 */
import { describe, expect, it } from 'vitest';
import type { OracleCard } from '../../../src/index';
import type { Template } from '../../../src/parser/types';
import { defaultParseOptions, parseCard } from '../../../src/parser/parse';
import { validateTemplates } from '../../../src/parser/chart';
import { TEMPLATE_FILES, TEMPLATE_SET } from '../../../src/parser/template-set';
import { ENGINE_CAPABILITIES } from '../../../src/model/capabilities';
import cmd2 from '../../../src/parser/templates/zz-cloud/cmd2.json';
import review from '../../m5/golden/cards/cloud-cmd2-review.json';
import { automated, bare, card, fullyAutomated, jsonKey } from '../../m5/templates/support';
import { localIndex } from '../../m5/parser/support';

const CMD2 = cmd2 as Template[];
/** std-ro (precon round O): the templates promoted to stable on three verified golden cards each (design 6.9). */
const PROMOTED = ['eff.cmd2.copy.forEachCommanderCast'];
const OPTS = defaultParseOptions({ templates: [...TEMPLATE_SET], capabilities: ENGINE_CAPABILITIES }); // what a decklist card gets (design 5.2; `needs`)

/** A synthetic card in which an example is an ability of the right kind: a spell on a sorcery, equip on an Equipment, anything else on a creature. */
function exampleCard(t: Template, text: string): OracleCard {
  const cost = /\bX\b/.test(text) ? { mana_cost: '{X}{U}' } : {}; // an X in the effect is announced with the spell's cost (CR 107.3)
  if (t.kind === 'effect' && !text.includes(':') && (!/^(When|Whenever|At)\b/.test(text) || /^When you next\b/.test(text))) return card('Example Volley', 'Sorcery', text, cost);
  if (/^Equip\b/.test(text)) return card('Example Plate', 'Artifact — Equipment', text);
  return card('Example Brute', 'Creature — Elf Warrior', text, { power: '3', toughness: '3' });
}
const parsedWith = (t: Template, text: string) => parseCard(exampleCard(t, text), OPTS).faces[0]!;
const face = (type: string, text: string) => parseCard(card('Example Brute', type, text, { power: '3', toughness: '3' }), OPTS).faces[0]!;

describe('cmd2 template file (design 6.3, 6.9; CONTRIBUTING "Adding a template")', () => {
  it('is loaded by the default compiler (zz-cloud/cmd2.json, after trigger.json, before zz-fast1/) and its ids are unique in the whole set', () => {
    const files = TEMPLATE_FILES.map((f) => f.file);
    expect(files).toContain('zz-cloud/cmd2.json');
    expect(files.indexOf('zz-cloud/cmd2.json')).toBeGreaterThan(files.indexOf('trigger.json'));
    expect(files.indexOf('zz-cloud/cmd2.json')).toBeLessThan(files.findIndex((f) => f.startsWith('zz-fast1/')));
    const ids = TEMPLATE_SET.map((t) => t.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(validateTemplates([...TEMPLATE_SET])).toEqual([]);
  });
  it('design 6.9: every template cites rules, has at least two examples and two counter-examples, is experimental (or stable with its evidence, below), of version 8; ids are eff./sta./kw.cmd2.*', () => {
    expect(CMD2.length).toBeGreaterThanOrEqual(6);
    for (const t of CMD2) {
      expect(t.id, t.id).toMatch(/^(eff|trg|sta|kw)\.cmd2\./);
      expect(t.cr.length, t.id).toBeGreaterThan(0);
      for (const cr of t.cr) expect(cr, t.id).toMatch(/^CR \d{3}(\.\d+[a-z]?)?$/);
      expect(t.examples.length, t.id).toBeGreaterThanOrEqual(2);
      expect(t.counterExamples.length, t.id).toBeGreaterThanOrEqual(2);
      expect(t.status, t.id).toBe(PROMOTED.includes(t.id) ? 'stable' : 'experimental'); // fewer than three verified golden cards in the tuning half (design 6.9)
      expect(t.since, t.id).toBe(8);
    }
  });
  it('design 6.9: a stable cmd2 template has its evidence: three hand-verified golden cards of the tuning half that use it (precon round O, std-ro: cloud-cmd2-review.json)', () => {
    const golden = review as { card: string; verified: string; expect?: string }[];
    for (const id of PROMOTED) {
      const cards = golden.filter((g) => g.verified.includes(`(${id}`) || g.verified.includes(` ${id},`) || g.verified.includes(` ${id})`)).map((g) => g.card);
      expect(cards.length, id).toBeGreaterThanOrEqual(3);
    }
    for (const g of golden) expect(g.expect, g.card).toBe('full');
  });
  it('guard G3: a critical word a pattern spells out is listed in `consumes`', () => {
    for (const t of CMD2) {
      const words = t.pattern.toLowerCase().replace(/\{[^}]*:[^}]*\}/g, ' ').split(/[^a-z']+/).filter(Boolean);
      for (const w of ['all', 'each', 'another', 'other', 'may', 'if', 'unless', 'until', 'instead', 'only', 'chosen', 'additional', 'except', "can't", 'would', 'next', 'then']) {
        if (words.includes(w)) expect(t.consumes ?? [], `${t.id}: ${w}`).toContain(w);
      }
    }
  });
});

describe('cmd2 guard G9 (design 6.8): examples and counter-examples', () => {
  for (const t of CMD2) {
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
    [/\bfor each time\b/, 'for any time'], [/\bthis game\b/, 'this turn'], [/\bcommand zone\b/, 'graveyard'], [/\bwhenever you\b/i, 'Whenever an opponent'], [/\bnext\b/, 'first'],
    [/\bexcept for commanders\b/, 'except for tokens'], [/\bother\b/, 'enchanted'], [/\bhave\b/, 'lose'], [/\bcommander\b/, 'legend'],
  ];
  for (const [re, by] of swaps) if (re.test(text)) out.push(text.replace(re, by));
  return out;
}

describe('cmd2 guard G9 (design 6.8): near-miss mutations fail or differ', () => {
  for (const t of CMD2) {
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

describe('cmd2 guard G2 (design 6.8): a nonsense word never leaves an automated card', () => {
  for (const t of CMD2) {
    it(`${t.id}: replacing any one word of an example by an invented word makes the card not fully automated`, () => {
      for (const e of t.examples) {
        const words = e.text.split(' ');
        words.forEach((w, i) => {
          if (w === '~' || w === '~.' || /^"?\{/.test(w) || w.includes('\n')) return;
          const end = w.match(/[.,"]+$/)?.[0] ?? '';
          const mutated = [...words.slice(0, i), `blorfty${end}`, ...words.slice(i + 1)].join(' ');
          expect(fullyAutomated(parsedWith(t, mutated)), mutated).toBe(false);
        });
      }
    });
  }
});

describe('cmd2 parser support (no template of its own): the abilities are read by the existing templates', () => {
  it('CR 113.6k, 601.2i: "When you cast this spell, draw two cards." is a triggered ability that functions on the stack', () => {
    const f = face('Creature — Eldrazi', 'When you cast this spell, draw two cards.');
    expect(fullyAutomated(f)).toBe(true);
    expect(JSON.stringify(f.abilities)).toContain('"zone":["stack"]');
    expect(JSON.stringify(f.abilities)).toContain('"spell":{"self":true}');
  });
  it('CR 400.7: a cast trigger whose effect names the spell beyond copying, countering or the mana spent to cast it stays manual; an intervening "if" too', () => {
    for (const text of ['When you cast this spell, it gains haste until end of turn.', 'When you cast this spell, put a +1/+1 counter on ~.']) {
      expect(fullyAutomated(face('Creature — Eldrazi', text)), text).toBe(false);
    }
    // Standard round 3, r3-trig (CR 603.4, 113.6k): an intervening "if" that does not name the spell is checked as the spell is cast and as the ability resolves, with
    // the spell still on the stack under it (lower/ability.ts#triggered); one that names the spell stays manual (CR 400.7: it may be a permanent by then)
    expect(fullyAutomated(face('Creature — Eldrazi', 'When you cast this spell, if you control a Forest, draw a card.'))).toBe(true);
    // p2-c-cast-zone-1 (CR 603.4, 702.33d): "if it was kicked" is this spell's own cast record (no object; lower/ability.ts#triggered), read as the spell is cast and as
    // the ability resolves above it on the stack (last known information if it left): automated, played in test/cloud/p2-c-cast-zone-1. A condition that names the
    // spell otherwise still keeps the trigger manual (lower/cast-self.ts#castSelfProgramSafe)
    expect(fullyAutomated(face('Creature — Eldrazi', 'When you cast this spell, if it was kicked, draw a card.'))).toBe(true);
    expect(fullyAutomated(face('Instant', 'When you cast this spell, copy it. You may choose new targets for the copy.'))).toBe(true);
  });
  it('CR 903.3e: "your commander" is the subject of enters, attacks, dies and combat damage triggers (a commander you own)', () => {
    for (const text of ['Whenever your commander enters, draw a card.', 'Whenever your commander attacks, draw a card.', 'Whenever your commander dies, draw a card.',
      'Whenever your commander deals combat damage to a player, draw a card.', 'Whenever your commander enters or attacks, draw a card.']) {
      const f = face('Enchantment', text);
      expect(fullyAutomated(f), text).toBe(true);
      expect(JSON.stringify(f.abilities), text).toContain('{"commander":true,"owner":"you"}');
    }
  });
  it('CR 508.1, 903.3d: "whenever you attack with your commander" is one batch of attackers you control that includes a commander you own', () => {
    const f = face('Enchantment', 'Whenever you attack with your commander, draw a card.');
    expect(fullyAutomated(f)).toBe(true);
    expect(JSON.stringify(f.abilities)).toContain('"attacker":{"commander":true,"owner":"you","controller":"you"},"count":{"op":">=","value":1}');
  });
  it('CR 510.1, 903.3d: "a commander you control deals combat damage" is read (only creatures deal combat damage); noncombat "a permanent" damage is not', () => {
    expect(fullyAutomated(face('Enchantment', 'Whenever a commander you control deals combat damage to a player, draw a card.'))).toBe(true);
    expect(fullyAutomated(face('Enchantment', 'Whenever a permanent you control deals damage to a player, draw a card.'))).toBe(false);
  });
  it('CR 903.9: "whenever your commander is put into the command zone from anywhere"', () => {
    const f = face('Enchantment', 'Whenever your commander is put into the command zone from anywhere, draw a card.');
    expect(fullyAutomated(f)).toBe(true);
    expect(JSON.stringify(f.abilities)).toContain('"to":"command"');
    expect(fullyAutomated(face('Enchantment', 'Whenever a creature you control is put into the command zone from anywhere, draw a card.'))).toBe(false);
  });
  it('CR 903.3d: "the greatest mana value of a commander you own on the battlefield or in the command zone" is a quantity of the where-X templates', () => {
    const f = face('Sorcery', 'All creatures get -X/-X until end of turn, where X is the greatest mana value of a commander you own on the battlefield or in the command zone.');
    expect(fullyAutomated(f)).toBe(true);
    expect(JSON.stringify(f.abilities)).toContain('{"q":"stat","stat":"manaValue","agg":"max","of":{"ref":"each","filter":{"commander":true,"owner":"you","zone":["battlefield","command"]}}}');
  });
  it('CR 603.3c, 700.2: a triggered ability\'s mode count may change with a condition ("If you control a commander, you may choose both instead.")', () => {
    const f = face('Enchantment', 'At the beginning of combat on your turn, choose one. If you control a commander, you may choose both instead.\n• Create a 1/1 white Soldier creature token.\n• You gain 2 life.');
    expect(fullyAutomated(f)).toBe(true);
    expect(JSON.stringify(f.abilities)).toContain('"override":{"when":{"cond":"exists","of":{"ref":"each","filter":{"commander":true,"controller":"you"}}},"min":1,"max":2}');
  });
  it('CR 702.16a: "protection from each color" is protection from all colors', () => {
    const f = face('Instant', 'Creatures you control gain protection from each color until end of turn.');
    expect(fullyAutomated(f)).toBe(true);
    expect(JSON.stringify(f.abilities)).toContain('"quality":"color:any"');
  });
  it('CR 702.173a: freerunning is a keyword with an alternative cost read from the turn\'s combat damage history', () => {
    const f = face('Sorcery', 'Freerunning {1}{G}\nDraw a card.');
    expect(fullyAutomated(f)).toBe(true);
    expect(ENGINE_CAPABILITIES.has('keyword:freerunning')).toBe(true);
  });
});

const index = localIndex();

describe.skipIf(index === null)('cmd2 design 6.10 (local index): synthetic examples', () => {
  it('no cmd2 line of an example or counter-example is a line of a real card (with the card\'s own name or "this <type>" read as "~")', () => {
    const lines = new Set<string>();
    for (const c of index ?? []) {
      for (const text of [c.oracle_text, ...(c.card_faces ?? []).map((x) => x.oracle_text)]) {
        if (typeof text !== 'string') continue;
        for (const l of text.split('\n')) {
          lines.add(l.trim());
          lines.add(l.replaceAll(c.name, '~').replace(/\bthis (creature|land|artifact|enchantment|Aura|spell|card|Equipment)\b/gi, '~').trim());
        }
      }
    }
    const verbatim = CMD2.flatMap((t) => [...t.examples.map((e) => e.text), ...t.counterExamples].filter((x) => x.split('\n').some((l) => lines.has(l.trim()))).map((x) => `${t.id}: ${x}`));
    expect(verbatim).toEqual([]);
  }, 120_000);
});
