/**
 * std-rx19 (wave 2, Commander precon lane rx19): the template data of parser/templates/zz-cloud/std-rx19.json and the round's parser, renderer and engine support:
 * "that player" of "becomes the target of a spell or ability an opponent controls" is the controller of that spell or ability (parser/lower/scope.ts#eventMentions,
 * render/refs.ts#markTriggerRoles, model/lint-roles.ts); the Recipient "the player or planeswalker it's attacking" (parser/holes/object.ts, render/steps-life.ts,
 * effects/refs.ts#resolveRecipients); the Event "enters untapped" (parser/holes/event.ts, render/evt.ts); "you cast your first spell during each opponent's turn"
 * (render/abil.ts); render family each-player-or-players (render/stat.ts). Guard G9 (design 6.8): every example lowers with its template and passes the exact
 * render gate (G6); every counter-example does not parse or parses to different JSON; near-miss mutations fail or differ; a nonsense word in place of any word of
 * an example never leaves an automated card (G2). Examples are synthetic wordings (design 6.10), checked against the local index when it is present. The behavior
 * is in std-rx19-scenarios.test.ts. CR cites from memory, unverified (rules/cr/ is not in the cloud checkout).
 */
import { describe, expect, it } from 'vitest';
import { compileCard, type OracleCard } from '../../../src/index';
import type { Template } from '../../../src/parser/types';
import { defaultParseOptions, parseCard } from '../../../src/parser/parse';
import { validateTemplates } from '../../../src/parser/chart';
import { TEMPLATE_FILES, TEMPLATE_SET } from '../../../src/parser/template-set';
import { ENGINE_CAPABILITIES } from '../../../src/model/capabilities';
import stdRx19 from '../../../src/parser/templates/zz-cloud/std-rx19.json';
import review from '../../m5/golden/cards/cloud-std-rx19-review.json';
import { automated, bare, card, fullyAutomated, jsonKey } from '../../m5/templates/support';
import { localIndex } from '../../m5/parser/support';

const RX19 = stdRx19 as Template[];
const OPTS = defaultParseOptions({ templates: [...TEMPLATE_SET], capabilities: ENGINE_CAPABILITIES }); // what a decklist card gets (design 5.2; `needs`)
type Golden = { card: string; verified: string; expect?: string }[];
const goldenUsing = (id: string, file: Golden = review as Golden): string[] => file.filter((g) => new RegExp(`[ (]${id.replaceAll('.', '\\.')}[,);]`).test(g.verified)).map((g) => g.card);

/** The type line each template's examples are printed on. */
const TYPE: Readonly<Record<string, string>> = {
  'trg.stdrx19.cast.first.eachOpponentsTurn': 'Creature — Faerie',
  'sta.stdrx19.permit.extraland.eachPlayer': 'Enchantment',
  'trg.stdrx19.event.firstEachTurn': 'Creature — Human',
  'trg.stdrx19.surveil.firstEachTurn': 'Creature — Human',
};
const face = (id: string, text: string, typeLine?: string) => {
  const type = typeLine ?? TYPE[id] ?? 'Sorcery';
  return parseCard(card('Example Relic', type, text, type.includes('Creature') ? { power: '2', toughness: '2' } : undefined), OPTS).faces[0]!;
};
const understood = (f: ReturnType<typeof face>): boolean => automated(f.abilities) && f.gate.every((g) => g.ok) && f.diagnostics.every((d) => d.level !== 'manual' || d.code === 'experimental');
const level = (type: string, text: string): string =>
  compileCard({ name: 'Example Relic', layout: 'normal', mana_cost: '{0}', type_line: type, oracle_text: text, colors: [], ...(type.includes('Creature') ? { power: '2', toughness: '2' } : {}) } as OracleCard).automation.level;
const abilitiesOf = (type: string, text: string): string => JSON.stringify(parseCard(card('Example Relic', type, text, type.includes('Creature') ? { power: '2', toughness: '2' } : undefined), OPTS).faces[0]!.abilities);

describe('std-rx19 template file (design 6.3, 6.9; CONTRIBUTING "Adding a template")', () => {
  it('is loaded by the default compiler (zz-cloud/std-rx19.json, after zz-cloud/std-rw6.json, before zz-cloud/std-rx9.json) and its ids are unique in the whole set', () => {
    const files = TEMPLATE_FILES.map((f) => f.file);
    expect(files).toContain('zz-cloud/std-rx19.json');
    expect(files.indexOf('zz-cloud/std-rx19.json')).toBeGreaterThan(files.indexOf('zz-cloud/std-rw6.json'));
    expect(files.indexOf('zz-cloud/std-rx19.json')).toBeLessThan(files.indexOf('zz-cloud/std-rx9.json'));
    const ids = TEMPLATE_SET.map((t) => t.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(validateTemplates([...TEMPLATE_SET])).toEqual([]);
  });
  it('design 6.9: every template cites rules, has at least two examples and two counter-examples, a status with its evidence, and is of version 8', () => {
    expect(RX19.map((t) => t.id)).toEqual(Object.keys(TYPE));
    for (const t of RX19) {
      expect(t.id, t.id).toMatch(/^(trg|sta)\.stdrx19\./);
      expect(t.cr.length, t.id).toBeGreaterThan(0);
      for (const cr of t.cr) expect(cr, t.id).toMatch(/^CR \d{3}(\.\d+[a-z]?)?$/);
      expect(t.examples.length, t.id).toBeGreaterThanOrEqual(2);
      expect(t.counterExamples.length, t.id).toBeGreaterThanOrEqual(2);
      expect(t.since, t.id).toBe(8);
      expect(t.status, t.id).toBe('stable');
    }
    for (const g of review as Golden) expect(g.expect, g.card).toBe('full');
    // stable on three or more hand-verified golden cards (design 6.9)
    expect(goldenUsing('trg.stdrx19.cast.first.eachOpponentsTurn').length).toBeGreaterThanOrEqual(3);
    expect(goldenUsing('trg.stdrx19.event.firstEachTurn')).toEqual(['Intermediate Chirography', "Gonti's Machinations", 'Angelic Cub']);
    // narrow wordings: stable on one or two hand-verified golden cards plus these tests and the scenarios, a 6.9 deviation named in the round record and the PR
    expect(goldenUsing('sta.stdrx19.permit.extraland.eachPlayer')).toEqual(['Rites of Flourishing']);
    expect(goldenUsing('trg.stdrx19.surveil.firstEachTurn')).toEqual(['Whispering Snitch']);
  });
  it('guard G3: a critical word a pattern spells out is listed in `consumes`', () => {
    for (const t of RX19) {
      const words = t.pattern.toLowerCase().replace(/\{[^}]*:[^}]*\}/g, ' ').split(/[^a-z']+/).filter(Boolean);
      for (const w of ['all', 'each', 'another', 'other', 'may', 'if', 'unless', 'until', 'instead', 'only', 'chosen', 'except', "can't", 'would', 'next', 'then', 'when', 'also', 'first']) {
        if (words.includes(w)) expect(t.consumes ?? [], `${t.id}: ${w}`).toContain(w);
      }
    }
  });
});

describe('std-rx19 guard G9 (design 6.8): examples and counter-examples', () => {
  for (const t of RX19) {
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
    [/first spell/, 'second spell'], [/each opponent's turn/, 'each of your turns'], [/Players may/, 'Opponents may'],
    [/an additional land/, 'two additional lands'], [/first time each turn/, 'second time each turn'], [/surveil/, 'scry'], [/lose life/, 'gain life'],
  ];
  for (const [re, by] of swaps) if (re.test(text)) out.push(text.replace(re, by));
  return out;
}

describe('std-rx19 guard G9 (design 6.8): near-miss mutations fail or differ', () => {
  for (const t of RX19) {
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

describe('std-rx19 guard G2 (design 6.8): a nonsense word never leaves an automated card', () => {
  for (const t of RX19) {
    it(`${t.id}: replacing any one word of an example by an invented word makes the card not understood`, () => {
      for (const e of t.examples) {
        const lines = e.text.split('\n');
        const last = lines.length - 1; // the line of the template (an earlier line is a keyword or another ability of the card)
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


describe('std-rx19 parser, renderer and engine support (hole readings, no template)', () => {
  const DRAGON = 'Creature — Dragon';
  it('CR 115.1, 109.5: "that player" of "becomes the target of a spell or ability an opponent controls" is the controller of that spell or ability', () => {
    for (const text of [
      'Whenever ~ becomes the target of a spell or ability an opponent controls, ~ deals 2 damage to that player.',
      'Whenever a creature you control becomes the target of a spell or ability an opponent controls, that player loses 2 life.',
    ]) {
      expect(level(DRAGON, text), text).toBe('full');
      expect(abilitiesOf(DRAGON, text), text).toContain('{"ref":"controllerOf","object":{"ref":"event","role":"spell"}}');
    }
  });
  it('fails closed: "that player" when the spell or ability is yours (the targeted permanent\'s controller is no antecedent either)', () => {
    expect(level(DRAGON, 'Whenever ~ becomes the target of a spell or ability you control, ~ deals 2 damage to that player.')).not.toBe('full');
  });
  it("CR 506.2, 508.1b: \"the player or planeswalker it's attacking\" is the attack's defender, only in a trigger of that attack", () => {
    const text = "Whenever ~ attacks, it deals 1 damage to the player or planeswalker it's attacking.";
    expect(level('Creature — Pirate', text)).toBe('full');
    expect(abilitiesOf('Creature — Pirate', text)).toContain('"to":{"ref":"event","role":"defender"}');
    expect(level('Creature — Pirate', "Whenever ~ blocks, it deals 1 damage to the player or planeswalker it's attacking.")).not.toBe('full');
    expect(level('Instant', "Target attacking creature deals 1 damage to the player or planeswalker it's attacking.")).toBe('manual');
  });
  it('CR 603.6a: "When ~ enters untapped" is the object itself entering untapped; another object "enters untapped" stays as it was', () => {
    const text = 'This land enters tapped unless you control a Forest.\nWhen this land enters untapped, you gain 2 life.';
    expect(level('Land', text)).toBe('full');
    expect(abilitiesOf('Land', text)).toContain('"subject":{"self":true,"tapped":false}');
    expect(level('Creature — Human', 'Whenever a creature an opponent controls enters untapped, you gain 1 life.')).not.toBe('full');
  });
});

const index = localIndex();

describe.skipIf(index === null)('std-rx19 design 6.10 (local index): synthetic examples', () => {
  it('no std-rx19 line of an example or counter-example is a line of a real card (with the card\'s own name or "this <type>" read as "~")', () => {
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
    const context = /^(Flying|Reach|Trample|Vigilance)$/;
    const verbatim = RX19.flatMap((t) => [...t.examples.map((e) => e.text), ...t.counterExamples].filter((x) => x.split('\n').some((l) => !context.test(l.trim()) && lines.has(l.trim()))).map((x) => `${t.id}: ${x}`));
    expect(verbatim).toEqual([]);
  }, 120_000);
});
