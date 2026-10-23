/**
 * std-rr (wave 2 slice s2): the template data of parser/templates/zz-cloud/std-rr.json, the promotion of rst.player.cant.gainlife (effect/restrict.json), and the
 * round's parser and renderer support: "enchanted player" (PlayerRef `enchantedPlayer`, parser/holes/player.ts and event.ts, statics/attached-player.ts); "one or more
 * [of your] opponents are dealt [combat] damage" as one trigger for the whole batch (parser/holes/event.ts#opponentsDealtDamage, render/evt.ts); "~'s owner shuffles
 * ~ into their library" (render/fold.ts#shuffleInto); "its base power and toughness become equal to <object>'s power and toughness <duration>" (render/mods.ts).
 * Guard G9 (design 6.8): every example lowers with its template and passes the exact render gate (G6); every counter-example does not parse or parses to different
 * JSON; near-miss mutations fail or differ; a nonsense word in place of any word of an example never leaves an automated card (G2). Examples are synthetic wordings
 * (design 6.10), checked against the local index when it is present. The behavior is in std-rr-scenarios.test.ts. CR cites from memory, unverified (rules/cr/ is
 * not in the cloud checkout).
 */
import { describe, expect, it } from 'vitest';
import type { Template } from '../../../src/parser/types';
import type { AbilityDef } from '../../../src/types/ability';
import { renderGate } from '../../../src/render/gate';
import { defaultParseOptions, parseCard } from '../../../src/parser/parse';
import { validateTemplates } from '../../../src/parser/chart';
import { TEMPLATE_FILES, TEMPLATE_SET } from '../../../src/parser/template-set';
import { ENGINE_CAPABILITIES } from '../../../src/model/capabilities';
import stdRr from '../../../src/parser/templates/zz-cloud/std-rr.json';
import review from '../../m5/golden/cards/cloud-std-rr-review.json';
import { automated, bare, card, fullyAutomated, jsonKey } from '../../m5/templates/support';
import { localIndex } from '../../m5/parser/support';

const RR = stdRr as Template[];
const PROMOTED = TEMPLATE_SET.find((t) => t.id === 'rst.player.cant.gainlife')!;
const OPTS = defaultParseOptions({ templates: [...TEMPLATE_SET], capabilities: ENGINE_CAPABILITIES }); // what a decklist card gets (design 5.2; `needs`)
type Golden = { card: string; verified: string; expect?: string }[];
const goldenUsing = (id: string, file: Golden = review as Golden): string[] => file.filter((g) => new RegExp(`[ (]${id.replaceAll('.', '\\.')}[,);]`).test(g.verified)).map((g) => g.card);

/** The type line each template's examples are printed on. */
const TYPE: Readonly<Record<string, string>> = {
  'eff.stdrr.its.basePT.becomeEqual.objectPT': 'Creature — Elf',
  'rst.player.cant.gainlife': 'Enchantment',
};
const face = (id: string, text: string, typeLine?: string) => {
  const type = typeLine ?? TYPE[id] ?? 'Sorcery';
  return parseCard(card('Example Relic', type, text, type.startsWith('Creature') ? { power: '2', toughness: '2' } : undefined), OPTS).faces[0]!;
};
const understood = (f: ReturnType<typeof face>): boolean => automated(f.abilities) && f.gate.every((g) => g.ok) && f.diagnostics.every((d) => d.level !== 'manual' || d.code === 'experimental');
const json = (f: ReturnType<typeof face>): string => JSON.stringify(bare(f.abilities));

describe('std-rr template file (design 6.3, 6.9; CONTRIBUTING "Adding a template")', () => {
  it('is loaded by the default compiler (zz-cloud/std-rr.json, after zz-cloud/std-rp.json, before zz-cloud/std-sos.json) and its ids are unique in the whole set', () => {
    const files = TEMPLATE_FILES.map((f) => f.file);
    expect(files).toContain('zz-cloud/std-rr.json');
    expect(files.indexOf('zz-cloud/std-rr.json')).toBeGreaterThan(files.indexOf('zz-cloud/std-rp.json'));
    expect(files.indexOf('zz-cloud/std-rr.json')).toBeLessThan(files.indexOf('zz-cloud/std-sos.json'));
    const ids = TEMPLATE_SET.map((t) => t.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(validateTemplates([...TEMPLATE_SET])).toEqual([]);
  });
  it('design 6.9: every template cites rules, has at least two examples and two counter-examples, a status with its evidence, and is of version 8', () => {
    expect(RR.map((t) => t.id)).toEqual(['eff.stdrr.its.basePT.becomeEqual.objectPT']);
    for (const t of RR) {
      expect(t.id, t.id).toMatch(/^eff\.stdrr\./);
      expect(t.cr.length, t.id).toBeGreaterThan(0);
      for (const cr of t.cr) expect(cr, t.id).toMatch(/^CR \d{3}(\.\d+[a-z]?)?$/);
      expect(t.examples.length, t.id).toBeGreaterThanOrEqual(2);
      expect(t.counterExamples.length, t.id).toBeGreaterThanOrEqual(2);
      expect(t.since, t.id).toBe(8);
      expect(t.status, t.id).toBe('stable');
    }
    for (const g of review as Golden) expect(g.expect, g.card).toBe('full');
    // narrow wording (one Standard card prints it; the other cards of the family are held out): stable on one hand-verified golden card plus these tests and the
    // played scenario, a 6.9 deviation named in the round record and the PR
    expect(goldenUsing('eff.stdrr.its.basePT.becomeEqual.objectPT')).toEqual(["Galion, Elvenking's Butler"]);
  });
  it('design 6.9: rst.player.cant.gainlife (effect/restrict.json, experimental since milestone 1, never demoted) is stable on Grievous Wound plus these tests and the played scenario (a 6.9 deviation: the only card of the corpus its general Player reading is the one reading of)', () => {
    expect(PROMOTED.status).toBe('stable');
    expect(goldenUsing('rst.player.cant.gainlife')).toEqual(['Grievous Wound']);
  });
  it('guard G3: a critical word a pattern spells out is listed in `consumes`', () => {
    for (const t of [...RR, PROMOTED]) {
      const words = t.pattern.toLowerCase().replace(/\{[^}]*:[^}]*\}/g, ' ').split(/[^a-z']+/).filter(Boolean);
      for (const w of ['all', 'each', 'another', 'other', 'may', 'if', 'unless', 'until', 'instead', 'only', 'chosen', 'except', "can't", 'would', 'next', 'then', 'when', 'also']) {
        if (words.includes(w)) expect(t.consumes ?? [], `${t.id}: ${w}`).toContain(w);
      }
    }
  });
});

describe('std-rr guard G9 (design 6.8): examples and counter-examples', () => {
  for (const t of [...RR, PROMOTED]) {
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
    [/\bbase power and toughness\b/, 'power and toughness'], [/\bpower and toughness until\b/, 'power until'], [/\buntil end of turn\b/, 'until your next turn'],
    [/\bcan't gain life\b/, "can't lose life"], [/\bEach opponent\b/, 'Each creature'],
  ];
  for (const [re, by] of swaps) if (re.test(text)) out.push(text.replace(re, by));
  return out;
}

describe('std-rr guard G9 (design 6.8): near-miss mutations fail or differ', () => {
  for (const t of [...RR, PROMOTED]) {
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

describe('std-rr guard G2 (design 6.8): a nonsense word never leaves an automated card', () => {
  for (const t of [...RR, PROMOTED]) {
    it(`${t.id}: replacing any one word of an example by an invented word makes the card not understood`, () => {
      for (const e of t.examples) {
        const lines = e.text.split('\n');
        const last = lines.length - 1;
        const words = lines[last]!.split(' ');
        words.forEach((w, i) => {
          const end = w.match(/[.,"]+$/)?.[0] ?? '';
          const mutated = [...lines.slice(0, last), [...words.slice(0, i), `blorfty${end}`, ...words.slice(i + 1)].join(' ')].join('\n');
          expect(understood(face(t.id, mutated)), mutated).toBe(false);
        });
      }
    });
  }
});

describe('std-rr parser support', () => {
  it('CR 303.4, 702.5a: "enchanted player" is the player the source Aura is attached to (PlayerRef enchantedPlayer), as a subject and in a trigger event', () => {
    const a = face('x', "Enchant player\nEnchanted player can't gain life.", 'Enchantment — Aura Curse');
    expect(fullyAutomated(a)).toBe(true);
    expect(json(a)).toContain('"subject":{"ref":"enchantedPlayer"}');
    const b = face('x', 'Enchant player\nWhenever enchanted player is dealt damage, you gain 1 life.', 'Enchantment — Aura Curse');
    expect(fullyAutomated(b)).toBe(true);
    expect(json(b)).toContain('"recipient":{"player":{"ref":"enchantedPlayer"}}');
  });
  it('CR 603.2c, 510.2: "one or more of your opponents are dealt combat damage" and "one or more opponents are dealt damage" are one trigger for the whole batch', () => {
    for (const [text, combat] of [['When one or more of your opponents are dealt combat damage, draw a card.', true], ['Whenever one or more opponents are dealt damage, draw a card.', undefined]] as const) {
      const f = face('x', text, 'Enchantment');
      expect(fullyAutomated(f), text).toBe(true);
      expect(bare(f.abilities)[0]).toMatchObject({ trigger: { on: [{ ev: 'damage', recipient: { player: 'opponent' }, ...(combat ? { combat } : {}) }], batch: true, wholeBatch: true } });
    }
  });
  it('guard G10: FAST5 T62\'s "one or more opponents are dealt noncombat damage" keeps its own reading (batch, one occurrence for each opponent dealt damage)', () => {
    const f = face('x', 'Whenever one or more opponents are dealt noncombat damage, draw a card.', 'Enchantment');
    expect(fullyAutomated(f)).toBe(true);
    const trig = (bare(f.abilities)[0] as { trigger: Record<string, unknown> }).trigger;
    expect(trig['batch']).toBe(true);
    expect(trig['wholeBatch']).toBeUndefined();
  });
  it('CR 603.2: "during your turn" after the opponents-dealt-damage event is the existing stdfin template\'s (no second template for it)', () => {
    const f = face('x', 'When one or more of your opponents are dealt combat damage during your turn, draw a card.', 'Enchantment');
    expect(f.templatesUsed).toContain('trg.stdfin.when.duringYourTurn');
    expect(json(f)).toContain('"while":{"cond":"turnOf","whose":"you"}');
  });
});

describe('std-rr renderer support', () => {
  it('CR 701.24a, 400.3 (family self-owner-shuffles-self): "~\'s owner shuffles ~ into their library" is "shuffle ~ into its owner\'s library"', () => {
    const a = face('x', "Draw a card. ~'s owner shuffles ~ into their library.");
    const b = face('x', "Draw a card. Shuffle ~ into its owner's library.");
    expect(fullyAutomated(a)).toBe(true);
    expect(jsonKey(a.abilities)).toBe(jsonKey(b.abilities));
  });
  it('CR 613.4b, 608.2h (family base-pt-equal-to-object-pt): a value read continuously (`live`) is never said "become equal to" (render/mods.ts#objectPT)', () => {
    const f = face('eff.stdrr.its.basePT.becomeEqual.objectPT', "When ~ enters, choose target creature an opponent controls. Its base power and toughness become equal to ~'s power and toughness until end of turn.");
    const a = bare(f.abilities)[0] as AbilityDef;
    const live = JSON.parse(JSON.stringify(a).replace(/("power":)(\{"q":"stat","stat":"power","of":\{"ref":"self"\}\})/, '$1{"q":"live","value":$2}')) as AbilityDef;
    expect(JSON.stringify(live)).toContain('"q":"live"');
    const lines = ["When ~ enters, choose target creature an opponent controls. Its base power and toughness become equal to ~'s power and toughness until end of turn."];
    expect(renderGate(a, lines, { selfNames: ['Example Relic'] }).ok).toBe(true);
    expect(renderGate(live, lines, { selfNames: ['Example Relic'] }).ok).toBe(false);
  });
});

const index = localIndex();

describe.skipIf(index === null)('std-rr design 6.10 (local index): synthetic examples', () => {
  it('no std-rr line of an example or counter-example is a line of a real card (with the card\'s own name or "this <type>" read as "~")', () => {
    const lines = new Set<string>();
    for (const c of index ?? []) {
      for (const text of [c.oracle_text, ...(c.card_faces ?? []).map((x) => x.oracle_text)]) {
        if (typeof text !== 'string') continue;
        for (const l of text.split('\n')) {
          lines.add(l.trim());
          lines.add(l.replaceAll(c.name, '~').replace(/\bthis (creature|land|artifact|enchantment|Aura|Equipment|spell|card|Saga)\b/gi, '~').trim());
          const short = c.name.split(',')[0]!;
          if (short !== c.name) lines.add(l.replaceAll(short, '~').trim());
        }
      }
    }
    const verbatim = RR.flatMap((t) => [...t.examples.map((e) => e.text), ...t.counterExamples].filter((x) => x.split('\n').some((l) => lines.has(l.trim()))).map((x) => `${t.id}: ${x}`));
    expect(verbatim).toEqual([]);
  }, 120_000);
});
