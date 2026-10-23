/**
 * std-rx18 (wave 2, Commander precon lane rx18): the template data of parser/templates/zz-cloud/std-rx18.json and the round's renderer support: "loses all
 * abilities and can't attack or block" said once (render/stat.ts, family shared-subject); "creatures without flying your opponents control" (render/np.ts, family
 * keyword-controller-order); "investigate X times, where X is the number of opponents you have" (render/steps-lasting.ts); "you and target opponent each create a
 * <token>" (render/fold.ts#youAndPlayerEachCreate). Guard G9 (design 6.8): every example lowers with its template and passes the exact render gate (G6); every
 * counter-example does not parse or parses to different JSON; near-miss mutations fail or differ; a nonsense word in place of any word of an example never leaves
 * an automated card (G2). Examples are synthetic wordings (design 6.10), checked against the local index when it is present. The behavior is in
 * std-rx18-scenarios.test.ts. CR cites from memory, unverified (rules/cr/ is not in the cloud checkout).
 */
import { describe, expect, it } from 'vitest';
import { compileCard, type OracleCard } from '../../../src/index';
import type { Template } from '../../../src/parser/types';
import { defaultParseOptions, parseCard } from '../../../src/parser/parse';
import { validateTemplates } from '../../../src/parser/chart';
import { TEMPLATE_FILES, TEMPLATE_SET } from '../../../src/parser/template-set';
import { ENGINE_CAPABILITIES } from '../../../src/model/capabilities';
import stdRx18 from '../../../src/parser/templates/zz-cloud/std-rx18.json';
import review from '../../m5/golden/cards/cloud-std-rx18-review.json';
import { automated, bare, card, fullyAutomated, jsonKey } from '../../m5/templates/support';
import { localIndex } from '../../m5/parser/support';

const RX18 = stdRx18 as Template[];
const OPTS = defaultParseOptions({ templates: [...TEMPLATE_SET], capabilities: ENGINE_CAPABILITIES }); // what a decklist card gets (design 5.2; `needs`)
type Golden = { card: string; verified: string; expect?: string }[];
const goldenUsing = (id: string, file: Golden = review as Golden): string[] => file.filter((g) => new RegExp(`[ (]${id.replaceAll('.', '\\.')}[,);]`).test(g.verified)).map((g) => g.card);

/** The type line an example is printed on: an Aura or an Equipment for the attached statics, an artifact for an activated ability, a creature for a trigger, else a sorcery. */
const typeOf = (text: string): string =>
  /Enchanted creature/.test(text) ? 'Enchantment — Aura' : /Equipped creature/.test(text) ? 'Artifact — Equipment' : /\{T\}:/.test(text) ? 'Artifact' : /^Whenever/m.test(text) ? 'Creature — Beast' : 'Sorcery';
const face = (text: string, typeLine?: string) => {
  const type = typeLine ?? typeOf(text);
  return parseCard(card('Example Relic', type, text, type.includes('Creature') ? { power: '2', toughness: '2' } : undefined), OPTS).faces[0]!;
};
const understood = (f: ReturnType<typeof face>): boolean => automated(f.abilities) && f.gate.every((g) => g.ok) && f.diagnostics.every((d) => d.level !== 'manual' || d.code === 'experimental');
const level = (type: string, text: string): string =>
  compileCard({ name: 'Example Relic', layout: 'normal', mana_cost: '{0}', type_line: type, oracle_text: text, colors: [], ...(type.includes('Creature') ? { power: '2', toughness: '2' } : {}) } as OracleCard).automation.level;

const IDS = [
  'eff.stdrx18.becomes.artifact.inaddition.dur',
  'eff.stdrx18.becomes.artifact.inaddition',
  'sta.stdrx18.attached.basept.has',
  'sta.stdrx18.attached.loseall.noattackblock',
  'trg.stdrx18.you.cycleOrDiscard.another',
  'eff.stdrx18.sacrificeChoice.discard.loseLife',
  'eff.stdrx18.youAndPlayer.each.createToken',
];

describe('std-rx18 template file (design 6.3, 6.9; CONTRIBUTING "Adding a template")', () => {
  it('is loaded by the default compiler (zz-cloud/std-rx18.json, after zz-cloud/std-rw6.json, before zz-cloud/std-rx9.json) and its ids are unique in the whole set', () => {
    const files = TEMPLATE_FILES.map((f) => f.file);
    expect(files).toContain('zz-cloud/std-rx18.json');
    expect(files.indexOf('zz-cloud/std-rx18.json')).toBeGreaterThan(files.indexOf('zz-cloud/std-rw6.json'));
    expect(files.indexOf('zz-cloud/std-rx18.json')).toBeLessThan(files.indexOf('zz-cloud/std-rx9.json'));
    const ids = TEMPLATE_SET.map((t) => t.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(validateTemplates([...TEMPLATE_SET])).toEqual([]);
  });
  it('design 6.9: every template cites rules, has at least two examples and two counter-examples, a status with its evidence, and is of version 8', () => {
    expect(RX18.map((t) => t.id)).toEqual(IDS);
    for (const t of RX18) {
      expect(t.id, t.id).toMatch(/^(eff|sta|trg)\.stdrx18\./);
      expect(t.cr.length, t.id).toBeGreaterThan(0);
      for (const cr of t.cr) expect(cr, t.id).toMatch(/^CR \d{3}(\.\d+[a-z]?)?$/);
      expect(t.examples.length, t.id).toBeGreaterThanOrEqual(2);
      expect(t.counterExamples.length, t.id).toBeGreaterThanOrEqual(2);
      expect(t.since, t.id).toBe(8);
      expect(t.status, t.id).toBe('stable');
    }
    for (const g of review as Golden) expect(g.expect, g.card).toBe('full');
    // three hand-verified golden cards (design 6.9 met)
    expect(goldenUsing('sta.stdrx18.attached.basept.has')).toEqual(['Hulkbuster Armor', 'Almost Perfect', 'Super State']);
    // narrow wordings, stable on one or two hand-verified golden cards plus these tests and the scenarios: a 6.9 deviation named in the round record and the PR
    expect(goldenUsing('eff.stdrx18.becomes.artifact.inaddition.dur')).toEqual(['Liquimetal Coating']);
    expect(goldenUsing('eff.stdrx18.becomes.artifact.inaddition')).toEqual(['Memnarch', "Ashnod's Transmogrant"]);
    expect(goldenUsing('sta.stdrx18.attached.loseall.noattackblock')).toEqual(['Observed Stasis']);
    expect(goldenUsing('trg.stdrx18.you.cycleOrDiscard.another')).toEqual(['Archfiend of Ifnir']);
    expect(goldenUsing('eff.stdrx18.sacrificeChoice.discard.loseLife')).toEqual(['Archon of Cruelty']);
    expect(goldenUsing('eff.stdrx18.youAndPlayer.each.createToken')).toEqual(['Bloodroot Apothecary']);
  });
  it('guard G3: a critical word a pattern spells out is listed in `consumes`', () => {
    for (const t of RX18) {
      const words = t.pattern.toLowerCase().replace(/\{[^}]*:[^}]*\}/g, ' ').split(/[^a-z']+/).filter(Boolean);
      for (const w of ['all', 'each', 'another', 'other', 'may', 'if', 'unless', 'until', 'instead', 'only', 'chosen', 'except', "can't", 'would', 'next', 'then', 'when', 'also', 'whenever']) {
        if (words.includes(w)) expect(t.consumes ?? [], `${t.id}: ${w}`).toContain(w);
      }
    }
  });
});

describe('std-rx18 guard G9 (design 6.8): examples and counter-examples', () => {
  for (const t of RX18) {
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
    [/\ban artifact in addition\b/, 'an enchantment in addition'], [/\bloses all abilities\b/, 'loses flying'], [/\battack or block\b/, 'attack'], [/\bbase power and toughness\b/, 'power and toughness'],
    [/\bcycle or discard\b/, 'cycle or sacrifice'], [/\banother card\b/, 'another creature card'], [/\bof their choice\b/, 'of your choice'], [/\bdiscards (a|two) cards?\b/, 'draws a card'],
    [/\beach create\b/, 'each sacrifice'], [/^You and /, 'You or '], [/\bhas (trample|reach)\b/, 'loses $1'],
  ];
  for (const [re, by] of swaps) if (re.test(text)) out.push(text.replace(re, by));
  return out;
}

describe('std-rx18 guard G9 (design 6.8): near-miss mutations fail or differ', () => {
  for (const t of RX18) {
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

describe('std-rx18 guard G2 (design 6.8): a nonsense word never leaves an automated card', () => {
  for (const t of RX18) {
    it(`${t.id}: replacing any one word of an example by an invented word makes the card not understood`, () => {
      for (const e of t.examples) {
        const lines = e.text.split('\n');
        const last = lines.length - 1; // the line of the template (an earlier line is a keyword of the card)
        const words = lines[last]!.split(' ');
        words.forEach((w, i) => {
          const end = w.match(/[.,"]+$/)?.[0] ?? '';
          const mutated = [...lines.slice(0, last), [...words.slice(0, i), `blorfty${end}`, ...words.slice(i + 1)].join(' ')].join('\n');
          expect(understood(face(mutated, typeOf(e.text))), mutated).toBe(false);
        });
      }
    });
  }
});

describe('std-rx18 renderer support (G6: the render gate is exact; each new reading is one reviewed alternative)', () => {
  it('render/stat.ts (CR 613.1f, 508.1c, 509.1b): the loss of all abilities and two bans of one attached object read as one sentence; a third effect of another kind does not join', () => {
    expect(level('Enchantment — Aura', "Enchant creature\nEnchanted creature loses all abilities and can't attack or block.")).toBe('full');
    expect(level('Enchantment — Aura', "Enchant creature\nEnchanted creature loses all abilities. It can't attack or block.")).not.toBe('full');
  });
  it('render/np.ts (family keyword-controller-order): "creatures without flying your opponents control" is the same set as "creatures your opponents control without flying"', () => {
    for (const text of ["Creatures without flying your opponents control can't block this turn.", "Creatures your opponents control without flying can't block this turn."]) {
      const f = face(text);
      expect(understood(f), text).toBe(true);
      expect(JSON.stringify(f.abilities, (_k, v) => (v && typeof v === 'object' && !Array.isArray(v) ? Object.fromEntries(Object.entries(v).sort(([a], [b]) => (a < b ? -1 : 1))) : v)), text)
        .toContain('"filter":{"controller":"opponent","notKeyword":"flying","types":["Creature"]}');
    }
    // a zone or a second post-modifier keeps the one order
    expect(level('Sorcery', 'Return all creature cards without flying from your graveyard your opponents control to their owners\' hands.')).not.toBe('full');
  });
  it('render/steps-lasting.ts (CR 102.3, 701.16a, 107.3a): "investigate X times, where X is the number of opponents you have"; a count with a qualifier keeps its own wording', () => {
    const f = face('When ~ enters, investigate X times, where X is the number of opponents you have.', 'Creature — Spirit');
    expect(understood(f)).toBe(true);
    expect(JSON.stringify(f.abilities)).toContain('"n":{"q":"countPlayers","of":{"ref":"each","who":"opponent"}}');
    expect(level('Creature — Spirit', 'When this creature enters, investigate for each opponent who lost life this turn.')).toBe('full');
  });
  it('render/fold.ts#youAndPlayerEachCreate (CR 111.2, 101.4): only the same tokens, you first; a different token for the other player stays two sentences', () => {
    expect(level('Sorcery', 'You and target opponent each create a Treasure token.')).toBe('full');
    expect(level('Sorcery', 'Create a Treasure token. Target opponent creates a Food token.')).toBe('full');
    expect(understood(face('You and target opponent each create a Treasure token and a Food token.'))).toBe(false);
  });
  it('fails closed: "cycle or discard another card" of an opponent, and "becomes an artifact" without "in addition to its other types"', () => {
    expect(level('Creature — Beast', 'Whenever an opponent cycles or discards another card, you gain 2 life.')).not.toBe('full');
    expect(level('Sorcery', 'Target land becomes an artifact until end of turn.')).not.toBe('full');
  });
});

const index = localIndex();

describe.skipIf(index === null)('std-rx18 design 6.10 (local index): synthetic examples', () => {
  it('no std-rx18 line of an example or counter-example is a line of a real card (with the card\'s own name or "this <type>" read as "~")', () => {
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
    // (a line that is only a keyword ability, "Flash", "Enchant creature", gives the example its card type and is not the template's)
    const context = /^(Flash|Flying|Enchant creature)$/;
    const verbatim = RX18.flatMap((t) => [...t.examples.map((e) => e.text), ...t.counterExamples].filter((x) => x.split('\n').some((l) => !context.test(l.trim()) && lines.has(l.trim()))).map((x) => `${t.id}: ${x}`));
    expect(verbatim).toEqual([]);
  }, 120_000);
});
