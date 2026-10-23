/**
 * std-ry10 (wave 2, Commander lane ry10): the template data of parser/templates/zz-cloud/std-ry10.json and the round's other parser and renderer changes:
 *  - Qty (parser/holes/qty.ts): "the number of creatures in your party" / "for each creature in your party" (`partySize`, CR 700.8), and "for each <filter> that
 *    died this turn" (the history count "the number of ... that died this turn" already read, CR 700.4); render/qty.ts#countParts says the party in the "for each"
 *    form, render/steps-util.ts#amountOf no longer takes "creatures that died this turn" for "that much";
 *  - HandCard (parser/holes/object.ts#handCard): "a nonland card from it with mana value 3 or less" (CR 202.3, 701.20a), rendered by
 *    render/steps-util.ts#handChoiceFromIt (family mana-value-after-hand);
 *  - "prevent all combat damage that would be dealt to and dealt by <obj> <dur>" (render/stat.ts#lastingCombatToAndBy, CR 615.1a), "If ~ would die, exile it
 *    instead" (CR 614.1a), "look at <player>'s hand and choose a <card> from it" (CR 402.3, 701.20e), "<obj> gets +N/+N <dur> for each <Qty>" (CR 611.2c).
 * Guard G9 (design 6.8): every example lowers with its template and passes the exact render gate (G6); every counter-example does not parse or parses to different
 * JSON; near-miss mutations fail or differ; a nonsense word in place of any word of an example never leaves an automated card (G2). Examples are synthetic wordings
 * (design 6.10), checked against the local index when it is present. The behavior is in std-ry10-scenarios.test.ts. CR cites from memory, unverified (rules/cr/ is
 * not in the cloud checkout).
 */
import { describe, expect, it } from 'vitest';
import { compileCard, type OracleCard } from '../../../src/index';
import type { Template } from '../../../src/parser/types';
import { defaultParseOptions, parseCard } from '../../../src/parser/parse';
import { validateTemplates } from '../../../src/parser/chart';
import { TEMPLATE_FILES, TEMPLATE_SET } from '../../../src/parser/template-set';
import { ENGINE_CAPABILITIES } from '../../../src/model/capabilities';
import stdRy10 from '../../../src/parser/templates/zz-cloud/std-ry10.json';
import review from '../../m5/golden/cards/cloud-std-ry10-review.json';
import { automated, bare, card, fullyAutomated, jsonKey } from '../../m5/templates/support';
import { localIndex } from '../../m5/parser/support';

const RY10 = stdRy10 as Template[];
const OPTS = defaultParseOptions({ templates: [...TEMPLATE_SET], capabilities: ENGINE_CAPABILITIES }); // what a decklist card gets (design 5.2; `needs`)
type Golden = { card: string; verified: string; expect?: string }[];
const goldenUsing = (id: string, file: Golden = review as Golden): string[] => file.filter((g) => new RegExp(`[ (]${id.replaceAll('.', '\\.')}[,);]`).test(g.verified)).map((g) => g.card);

/** The type line an example is printed on: a creature for a permanent's line (a keyword line first, a trigger, "this permanent"), else a sorcery. */
const typeOf = (text: string): string => (/^Whenever|^When|^Flying|this permanent|^\{/m.test(text) ? 'Creature — Beast' : 'Sorcery');
const face = (text: string, typeLine?: string) => {
  const type = typeLine ?? typeOf(text);
  return parseCard(card('Example Relic', type, text, type.includes('Creature') ? { power: '2', toughness: '2' } : undefined), OPTS).faces[0]!;
};
const understood = (f: ReturnType<typeof face>): boolean => automated(f.abilities) && f.gate.every((g) => g.ok) && f.diagnostics.every((d) => d.level !== 'manual' || d.code === 'experimental');
const compiled = (type: string, text: string) =>
  compileCard({ name: 'Example Relic', layout: 'normal', mana_cost: '{0}', type_line: type, oracle_text: text, colors: [], ...(type.includes('Creature') ? { power: '2', toughness: '2' } : {}) } as OracleCard);
const level = (type: string, text: string): string => compiled(type, text).automation.level;

const IDS = ['eff.stdry10.prevent.combat.toAndBy.obj.dur', 'rep.stdry10.self.dies.exile', 'eff.stdry10.hand.lookAnd.choose', 'eff.stdry10.pump.dur.forEach.qty'];

describe('std-ry10 template file (design 6.3, 6.9; CONTRIBUTING "Adding a template")', () => {
  it('is loaded by the default compiler (zz-cloud/std-ry10.json, after zz-cloud/std-rx9.json, before zz-cloud/std-sos.json) and its ids are unique in the whole set', () => {
    const files = TEMPLATE_FILES.map((f) => f.file);
    expect(files).toContain('zz-cloud/std-ry10.json');
    expect(files.indexOf('zz-cloud/std-ry10.json')).toBeGreaterThan(files.indexOf('zz-cloud/std-rx9.json'));
    expect(files.indexOf('zz-cloud/std-ry10.json')).toBeLessThan(files.indexOf('zz-cloud/std-sos.json'));
    const ids = TEMPLATE_SET.map((t) => t.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(validateTemplates([...TEMPLATE_SET])).toEqual([]);
  });
  it('design 6.9: every template cites rules, has at least two examples and two counter-examples, a status with its evidence, and is of version 8', () => {
    expect(RY10.map((t) => t.id)).toEqual(IDS);
    for (const t of RY10) {
      expect(t.id, t.id).toMatch(/^(eff|rep)\.stdry10\./);
      expect(t.cr.length, t.id).toBeGreaterThan(0);
      for (const cr of t.cr) expect(cr, t.id).toMatch(/^CR \d{3}(\.\d+[a-z]?)?$/);
      expect(t.examples.length, t.id).toBeGreaterThanOrEqual(2);
      expect(t.counterExamples.length, t.id).toBeGreaterThanOrEqual(2);
      expect(t.since, t.id).toBe(8);
      expect(t.status, t.id).toBe('stable');
    }
    for (const g of review as Golden) expect(g.expect, g.card).toBe('full');
    // three or more hand-verified golden cards of the tuning half (design 6.9 met)
    expect(goldenUsing('eff.stdry10.prevent.combat.toAndBy.obj.dur').length).toBeGreaterThanOrEqual(3);
    expect(goldenUsing('rep.stdry10.self.dies.exile').length).toBeGreaterThanOrEqual(3);
    // narrow wordings, stable on one or two hand-verified golden cards (tuning half) plus these tests and the scenarios: a 6.9 deviation named in the round record
    expect(goldenUsing('eff.stdry10.hand.lookAnd.choose')).toEqual(['Thrull Surgeon']);
    expect(goldenUsing('eff.stdry10.pump.dur.forEach.qty')).toEqual(['Grotag Bug-Catcher', 'Kabira Outrider']);
  });
  it('guard G3: a critical word a pattern spells out is listed in `consumes`', () => {
    for (const t of RY10) {
      const words = t.pattern.toLowerCase().replace(/\{[^}]*:[^}]*\}/g, ' ').split(/[^a-z']+/).filter(Boolean);
      for (const w of ['all', 'each', 'another', 'other', 'may', 'if', 'unless', 'until', 'instead', 'only', 'chosen', 'except', "can't", 'would', 'then', 'when', 'also', 'whenever', 'and', 'look', 'choose']) {
        if (words.includes(w)) expect(t.consumes ?? [], `${t.id}: ${w}`).toContain(w);
      }
    }
  });
});

describe('std-ry10 guard G9 (design 6.8): examples and counter-examples', () => {
  for (const t of RY10) {
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
    [/\bto and dealt by\b/, 'to or dealt by'], [/\bcombat damage\b/, 'noncombat damage'], [/\bwould die\b/, 'would leave the battlefield'], [/\bexile it\b/, 'sacrifice it'],
    [/'s hand and choose\b/, "'s library and choose"], [/\bchoose an? (\S+) card from it\b/, 'choose two $1 cards from it'], [/\bin your party\b/, "in an opponent's party"],
    [/\bfor each creature\b/, 'for each card'],
  ];
  for (const [re, by] of swaps) if (re.test(text)) out.push(text.replace(re, by));
  return out;
}

describe('std-ry10 guard G9 (design 6.8): near-miss mutations fail or differ', () => {
  for (const t of RY10) {
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

describe('std-ry10 guard G2 (design 6.8): a nonsense word never leaves an automated card', () => {
  for (const t of RY10) {
    it(`${t.id}: replacing any one word of the template's sentence by an invented word makes the card not understood`, () => {
      for (const e of t.examples) {
        const lines = e.text.split('\n');
        const last = lines.length - 1; // the line of the template (an earlier line is another ability of the card)
        const [cost, rest] = /^(\{[^:]*: )(.*)$/.exec(lines[last]!)?.slice(1) ?? ['', lines[last]!];
        const words = rest!.split(' ');
        words.forEach((w, i) => {
          if (/^\{/.test(w)) return; // a mana symbol is not a word
          const end = w.match(/[.,"]+$/)?.[0] ?? '';
          const mutated = [...lines.slice(0, last), `${cost}${[...words.slice(0, i), `blorfty${end}`, ...words.slice(i + 1)].join(' ')}`].join('\n');
          expect(understood(face(mutated, typeOf(e.text))), mutated).toBe(false);
        });
      }
    });
  }
});

describe('std-ry10 Qty (parser/holes/qty.ts): the size of your party and the creatures that died this turn', () => {
  const left = (text: string, type = 'Creature — Human'): string => {
    const f = face(text, type);
    expect(understood(f), `${text}: ${JSON.stringify(f.diagnostics)} ${JSON.stringify(f.gate)}`).toBe(true);
    return JSON.stringify(f.abilities);
  };
  it('CR 700.8: "the number of creatures in your party" and "for each creature in your party" are partySize of you', () => {
    for (const text of [
      'When this creature enters, target creature an opponent controls gets -X/-X until end of turn, where X is the number of creatures in your party.',
      'When this creature enters, put a +1/+1 counter on it for each creature in your party.',
      'When this creature enters, you gain 2 life for each creature in your party.',
      'When this creature enters, create a 1/1 white Soldier creature token for each creature in your party.',
    ]) expect(left(text), text).toContain('{"q":"partySize","of":{"ref":"you"}}');
  });
  it('CR 700.8: fails closed on another player\'s party and on a count that is not the party', () => {
    expect(level('Creature — Human', "When this creature enters, you gain 1 life for each creature in target opponent's party.")).not.toBe('full');
    expect(level('Creature — Human', 'When this creature enters, you gain 1 life for each creature in your party this turn.')).not.toBe('full');
  });
  it('T38\'s fixed "costs {1} less to cast for each creature in your party" keeps its sentence (the reading is weak)', () => {
    const f = face('This spell costs {1} less to cast for each creature in your party.\nDraw a card.', 'Sorcery');
    expect(f.templatesUsed).toContain('cm.t38.self.less.party');
  });
  it('CR 700.4: "for each creature that died this turn" is the turn\'s count of creatures put into a graveyard from the battlefield', () => {
    expect(left('When this creature dies, you gain 1 life for each creature that died this turn.', 'Creature — Zombie')).toContain('{"q":"happenedCount","event":{"ev":"zoneChange","subject":{"types":["Creature"]},"from":"battlefield","to":"graveyard"},"scope":"turn"}');
    expect(level('Creature — Zombie', 'When this creature dies, you gain 1 life for each creature that died last turn.')).not.toBe('full');
  });
});

describe('std-ry10 HandCard (parser/holes/object.ts#handCard; CR 202.3, 701.20a)', () => {
  it('"a nonland card from it with mana value 3 or less" adds the comparison to the description; "with power ..." after the zone is not read', () => {
    const f = face('Target player reveals their hand. You choose a nonland card from it with mana value 3 or less. That player discards that card.', 'Sorcery');
    expect(understood(f)).toBe(true);
    expect(JSON.stringify(f.abilities)).toContain('"anyOf":[{"notTypes":["Land"],"isCard":true,"manaValue":{"op":"<=","value":3}}]');
    expect(level('Sorcery', 'Target player reveals their hand. You choose a creature card from it with power 3 or less. That player discards that card.')).not.toBe('full');
  });
});

describe('std-ry10 renderer support (G6: the render gate is exact)', () => {
  it('render/stat.ts#lastingCombatToAndBy: only the pair of one object; a group ("those creatures") or all damage stays manual', () => {
    expect(level('Instant', 'Prevent all combat damage that would be dealt to and dealt by target creature this turn.')).toBe('full');
    expect(level('Instant', 'Prevent all damage that would be dealt to and dealt by target creature this turn.')).not.toBe('full');
  });
});

const index = localIndex();

describe.skipIf(index === null)('std-ry10 design 6.10 (local index): synthetic examples', () => {
  it('no std-ry10 line of an example or counter-example is a line of a real card (with the card\'s own name or "this <type>" read as "~")', () => {
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
    const context = /^(Haste|Flying)$/;
    const verbatim = RY10.flatMap((t) => [...t.examples.map((e) => e.text), ...t.counterExamples].filter((x) => x.split('\n').some((l) => !context.test(l.trim()) && lines.has(l.trim()))).map((x) => `${t.id}: ${x}`));
    expect(verbatim).toEqual([]);
  }, 120_000);
});
