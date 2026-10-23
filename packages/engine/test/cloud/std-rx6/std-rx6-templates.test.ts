/**
 * std-rx6 (wave 2, slice s21): the template data of parser/templates/zz-cloud/std-rx6.json and the round's parser, renderer and engine support ("As ~ enters,
 * choose a card name" as a choice of the face, parser/parse.ts#faceChoices; the look at an opponent's hand of an entering body, `enters.lookAtHand`; the
 * renderer's plain "can't attack you", its pair with a ban on blocking a group, and the group's "unless they're mana abilities", render/stat.ts; family
 * chosen-name-or-that-name). Guard G9 (design 6.8): every example lowers with its template and passes the exact render gate (G6); every counter-example
 * does not parse or parses to different JSON; near-miss mutations fail or differ; a nonsense word in place of any word of an example never leaves an
 * automated card (G2). Examples are synthetic wordings (design 6.10), checked against the local index when it is present. The behavior is in
 * std-rx6-scenarios.test.ts. CR cites from memory, unverified (rules/cr/ is not in the cloud checkout).
 */
import { describe, expect, it } from 'vitest';
import { compileCard, renderAbility } from '../../../src/index';
import type { Template } from '../../../src/parser/types';
import { defaultParseOptions, faceChoices, parseCard } from '../../../src/parser/parse';
import { validateTemplates } from '../../../src/parser/chart';
import { TEMPLATE_FILES, TEMPLATE_SET } from '../../../src/parser/template-set';
import { ENGINE_CAPABILITIES } from '../../../src/model/capabilities';
import stdRx6 from '../../../src/parser/templates/zz-cloud/std-rx6.json';
import review from '../../m5/golden/cards/cloud-std-rx6-review.json';
import { automated, bare, card, fullyAutomated, jsonKey } from '../../m5/templates/support';
import { localIndex } from '../../m5/parser/support';

const RX = stdRx6 as Template[];
const OPTS = defaultParseOptions({ templates: [...TEMPLATE_SET], capabilities: ENGINE_CAPABILITIES }); // what a decklist card gets (design 5.2; `needs`)
type Golden = { card: string; verified: string; expect?: string }[];
const goldenUsing = (id: string, file: Golden = review as Golden): string[] => file.filter((g) => new RegExp(`[ (]${id.replaceAll('.', '\\.')}[,);]`).test(g.verified)).map((g) => g.card).sort();

/** The type line of an example: its self-reference names it ("this Vehicle", "this planeswalker"); the others are enchantments. */
const typeOf = (text: string): string => (/this Vehicle/.test(text) ? 'Artifact — Vehicle' : /this planeswalker/.test(text) ? 'Legendary Planeswalker — Testa' : 'Enchantment');
const face = (text: string, typeLine?: string) => {
  const type = typeLine ?? typeOf(text);
  return parseCard(card('Example Relic', type, text, type.includes('Vehicle') ? { power: '3', toughness: '3' } : type.includes('Planeswalker') ? { loyalty: '3' } : undefined), OPTS).faces[0]!;
};
const understood = (f: ReturnType<typeof face>): boolean => automated(f.abilities) && f.gate.every((g) => g.ok) && f.diagnostics.every((d) => d.level !== 'manual' || d.code === 'experimental');
// std-rx28 promoted sta.stdrx6.group.cantAttackYou.orBlock on Storm, Windrider (its trigger is full there), a 6.9 deviation named in std-rx28's record
const EXPERIMENTAL = new Set<string>([]);

describe('std-rx6 template file (design 6.3, 6.9; CONTRIBUTING "Adding a template")', () => {
  it('is loaded by the default compiler (zz-cloud/std-rx6.json, after zz-cloud/std-rp.json, before zz-cloud/std-sos.json) and its ids are unique in the whole set', () => {
    const files = TEMPLATE_FILES.map((f) => f.file);
    expect(files).toContain('zz-cloud/std-rx6.json');
    expect(files.indexOf('zz-cloud/std-rx6.json')).toBeGreaterThan(files.indexOf('zz-cloud/std-rp.json'));
    expect(files.indexOf('zz-cloud/std-rx6.json')).toBeLessThan(files.indexOf('zz-cloud/std-sos.json'));
    const ids = TEMPLATE_SET.map((t) => t.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(validateTemplates([...TEMPLATE_SET])).toEqual([]);
  });
  it('design 6.9: every template cites rules, has at least two examples and two counter-examples, a status with its evidence, and is of version 8', () => {
    expect(RX.map((t) => t.id)).toEqual([
      'rep.stdrx6.enters.choose.cardName', 'rep.stdrx6.enters.lookHand.choose.cardName', 'sta.stdrx6.cantActivate.group.exceptMana',
      'sta.stdrx6.cantActivate.chosenName.exceptMana', 'sta.stdrx6.group.cantAttackYou', 'sta.stdrx6.group.cantAttackYou.orBlock',
    ]);
    for (const t of RX) {
      expect(t.id, t.id).toMatch(/^(rep|sta)\.stdrx6\./);
      expect(t.cr.length, t.id).toBeGreaterThan(0);
      for (const cr of t.cr) expect(cr, t.id).toMatch(/^CR \d{3}(\.\d+[a-z]?)?$/);
      expect(t.examples.length, t.id).toBeGreaterThanOrEqual(2);
      expect(t.counterExamples.length, t.id).toBeGreaterThanOrEqual(2);
      expect(t.since, t.id).toBe(8);
      expect(t.status, t.id).toBe(EXPERIMENTAL.has(t.id) ? 'experimental' : 'stable');
    }
    for (const g of review as Golden) expect(g.expect, g.card).toBe('full');
    // narrow wordings: stable on hand-verified golden cards of this round plus these tests and the scenarios, a 6.9 deviation named in the round record and the PR
    // (the other full cards printing them are held out and not Standard-legal: Declaration of Naught, Disruptor Flute, Blazing Archon, Form of the Dragon, Elephant Grass)
    expect(goldenUsing('rep.stdrx6.enters.choose.cardName')).toEqual(['Pithing Needle']);
    expect(goldenUsing('rep.stdrx6.enters.lookHand.choose.cardName')).toEqual(['Sorcerous Spyglass']);
    expect(goldenUsing('sta.stdrx6.cantActivate.chosenName.exceptMana')).toEqual(['Pithing Needle', 'Sorcerous Spyglass']);
    expect(goldenUsing('sta.stdrx6.cantActivate.group.exceptMana')).toEqual(['Damping Matrix']);
    expect(goldenUsing('sta.stdrx6.group.cantAttackYou')).toEqual(['Reverence']);
    // printed on one card (Storm, Windrider, Standard-legal): stable on that one golden card since std-rx28 made its trigger full (a 6.9 deviation)
    expect(goldenUsing('sta.stdrx6.group.cantAttackYou.orBlock')).toEqual(['Storm, Windrider']);
  });
  it('guard G3: a critical word a pattern spells out is listed in `consumes`', () => {
    for (const t of RX) {
      const words = t.pattern.toLowerCase().replace(/\{[^}]*:[^}]*\}/g, ' ').split(/[^a-z']+/).filter(Boolean);
      for (const w of ['all', 'each', 'another', 'other', 'may', 'if', 'unless', 'until', 'instead', 'only', 'chosen', 'except', "can't", 'would', 'next', 'then', 'when', 'also']) {
        if (words.includes(w)) expect(t.consumes ?? [], `${t.id}: ${w}`).toContain(w);
      }
    }
  });
});

describe('std-rx6 guard G9 (design 6.8): examples and counter-examples', () => {
  for (const t of RX) {
    it(`${t.id} (${t.cr.join(', ')}): every example parses with it, is automated and passes the render gate; counter-examples do not give the same JSON`, () => {
      const first = face(t.examples[0]!.text);
      for (const e of t.examples) {
        const f = face(e.text);
        expect(f.templatesUsed, e.text).toContain(t.id);
        expect(understood(f), `${e.text}: ${JSON.stringify(f.abilities)} ${JSON.stringify(f.diagnostics)} ${JSON.stringify(f.gate)}`).toBe(true);
        if (!EXPERIMENTAL.has(t.id)) expect(fullyAutomated(f), e.text).toBe(true);
        if (e.expect !== undefined) expect(bare(f.abilities), e.text).toEqual(e.expect);
      }
      for (const c of t.counterExamples) {
        const f = face(c);
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
    [/\ba card name\b/, 'a creature type'], [/\bany card name\b/, 'any color'], [/\ban opponent's hand\b/, "an opponent's library"], [/\bmana abilities\b/, 'loyalty abilities'],
    [/\battack you\b/, 'attack'], [/\bblock creatures you control\b/, 'block creatures you don\'t control'], [/\bthat name\b/, 'that color'], [/\bcan't be activated\b/, 'can be activated'],
  ];
  for (const [re, by] of swaps) if (re.test(text)) out.push(text.replace(re, by));
  return out;
}

describe('std-rx6 guard G9 (design 6.8): near-miss mutations fail or differ', () => {
  for (const t of RX) {
    it(`${t.id}: an appended condition, or a swapped key word, never gives the example's JSON`, () => {
      for (const e of t.examples) {
        const orig = face(e.text);
        for (const m of nearMisses(e.text)) {
          if (m === e.text) continue;
          const f = face(m);
          expect(understood(f) && jsonKey(f.abilities) === jsonKey(orig.abilities), m).toBe(false);
        }
      }
    });
  }
});

describe('std-rx6 guard G2 (design 6.8): a nonsense word never leaves an automated card', () => {
  for (const t of RX) {
    it(`${t.id}: replacing any one word of an example by an invented word makes the card not understood`, () => {
      for (const e of t.examples) {
        const lines = e.text.split('\n');
        const last = lines.length - 1; // the line of the template (an earlier line is the choice it reads)
        const words = lines[last]!.split(' ');
        words.forEach((w, i) => {
          const end = w.match(/[.,"]+$/)?.[0] ?? '';
          const mutated = [...lines.slice(0, last), [...words.slice(0, i), `blorfty${end}`, ...words.slice(i + 1)].join(' ')].join('\n');
          expect(understood(face(mutated)), mutated).toBe(false);
        });
      }
    });
  }
});

describe('std-rx6 parser support (fail closed)', () => {
  it('CR 607.2d: "the chosen name" with no "As ~ enters, choose a card name." on the face is never automated', () => {
    const lone = compileCard(card('Example Relic', 'Artifact', "Activated abilities of sources with the chosen name can't be activated unless they're mana abilities."));
    expect(lone.automation.level).not.toBe('full');
    const color = compileCard(card('Example Relic', 'Artifact', "As this artifact enters, choose a color.\nActivated abilities of sources with the chosen name can't be activated unless they're mana abilities."));
    expect(color.automation.level).not.toBe('full');
  });
  it('CR 201.3: "choose a nonland card name" stays manual (the engine has no name choice limited to nonland cards)', () => {
    expect(face('As this Vehicle enters, choose a nonland card name.').templatesUsed).not.toContain('rep.stdrx6.enters.choose.cardName');
  });
  it('CR 607.2d (parser/parse.ts#faceChoices): "choose a card name" and "look at an opponent\'s hand, then choose any card name" are a card-name choice of the face', () => {
    const seg = (text: string) => ({ text }) as never;
    const reader = seg("Activated abilities of sources with the chosen name can't be activated unless they're mana abilities.");
    expect(faceChoices(reader, [reader, seg('As ~ enters, choose a card name.')])).toEqual([{ link: 'cardName', what: 'cardName' }]);
    expect(faceChoices(reader, [reader, seg("As ~ enters, look at an opponent's hand, then choose any card name.")])).toEqual([{ link: 'cardName', what: 'cardName' }]);
    expect(faceChoices(reader, [reader, seg('As ~ enters, choose a color.')])).toEqual([{ link: 'color', what: 'color' }]);
    expect(faceChoices(reader, [reader, seg("As ~ enters, look at an opponent's hand, then choose a color.")])).toEqual([{ link: 'color', what: 'color' }]);
  });
});

describe('std-rx6 renderer support', () => {
  const cant = (subject: object, extra: object = {}) => ({ s: 'restrict', subject: { ref: 'each', filter: subject }, mode: 'cant', ...extra });
  const render = (effects: object[]): string => renderAbility({ kind: 'static', text: '', effects } as never, { selfNames: ['Test Card'] }).join(' ');
  it('CR 508.1c: a plain ban on attacking you is "can\'t attack you"; with the planeswalker half it stays one sentence (FAST4 T33)', () => {
    const attackYou = cant({ types: ['Creature'] }, { action: 'attackPlayer', otherPlayer: { ref: 'you' } });
    expect(render([attackYou])).toMatch(/^(all )?creatures can't attack you\.?$/i);
    expect(render([attackYou, cant({ types: ['Creature'] }, { action: 'attack', other: { types: ['Planeswalker'], controller: 'you' } })])).toMatch(/can't attack you or planeswalkers you control/i);
  });
  it('CR 508.1c: a ban on attacking another player has no words here (fails closed)', () => {
    expect(render([cant({ types: ['Creature'] }, { action: 'attackPlayer', otherPlayer: { ref: 'opponent' } })])).toMatch(/cannot render/);
  });
  it('CR 614.12a: a look at a hand with no choice after it, or before a choice of another kind, has no words here (fails closed)', () => {
    const enters = (body: object) => render([{ s: 'replace', replaces: { ev: 'zoneChange', subject: { self: true }, to: 'battlefield' }, body: { b: 'enters', ...body } }]);
    expect(enters({ lookAtHand: 'opponent' })).toMatch(/cannot render/);
    expect(enters({ lookAtHand: 'opponent', choose: [{ what: 'color', link: 'color' }] })).toMatch(/cannot render/);
  });
});

const index = localIndex();

describe.skipIf(index === null)('std-rx6 design 6.10 (local index): synthetic examples', () => {
  it('no std-rx6 line of an example or counter-example is a line of a real card (with the card\'s own name or "this <type>" read as "~")', () => {
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
    const verbatim = RX.flatMap((t) => [...t.examples.map((e) => e.text), ...t.counterExamples].filter((x) => x.split('\n').some((l) => lines.has(l.trim()))).map((x) => `${t.id}: ${x}`));
    expect(verbatim).toEqual([]);
  }, 120_000);
});
