/**
 * std-costs-2 (lane std-costs, account B: additional costs that choose objects or a creature type, kicked "instead", modes that are only targets): the template data
 * of parser/templates/zz-cloud/std-costs-2.json and the round's parser, lowering and renderer support (modes that share one instruction, the chooseObject cost and
 * the chosen object, warped cards, kicked "instead choose" targets and "each chosen <noun>", the cost that chooses a creature type, "<obj> is the chosen type",
 * the revealed card of a search, and the render family each-chosen). Guard G9 (design 6.8): every example lowers with its template and passes the exact render
 * gate (G6); every counter-example does not parse or parses to different JSON; near-miss mutations fail or differ; a nonsense word in place of any word of an
 * example never leaves an automated card (G2). Examples are synthetic wordings (design 6.10), checked against the local index when it is present. The behavior
 * is in std-costs-2-scenarios.test.ts. CR cites from memory, unverified (rules/cr/ is not in the cloud checkout).
 */
import { describe, expect, it } from 'vitest';
import { compileCard, renderAbility } from '../../../src/index';
import type { Template } from '../../../src/parser/types';
import { defaultParseOptions, faceChoices, parseCard } from '../../../src/parser/parse';
import { validateTemplates } from '../../../src/parser/chart';
import { TEMPLATE_FILES, TEMPLATE_SET } from '../../../src/parser/template-set';
import { ENGINE_CAPABILITIES } from '../../../src/model/capabilities';
import { lintCard } from '../../../src/model/lint-card';
import stdCosts2 from '../../../src/parser/templates/zz-cloud/std-costs-2.json';
import review from '../../m5/golden/cards/std-costs-2-review.json';
import { automated, bare, card, fullyAutomated, jsonKey } from '../../m5/templates/support';
import { localIndex } from '../../m5/parser/support';

const T = stdCosts2 as Template[];
const OPTS = defaultParseOptions({ templates: [...TEMPLATE_SET], capabilities: ENGINE_CAPABILITIES }); // what a decklist card gets (design 5.2; `needs`)
type Golden = { card: string; verified: string; expect?: string }[];
const goldenUsing = (id: string, file: Golden = review as Golden): string[] => file.filter((g) => new RegExp(`[ (]${id.replaceAll('.', '\\.')}[,);]`).test(g.verified)).map((g) => g.card).sort();

const face = (text: string) => parseCard(card('Example Relic', 'Sorcery', text), OPTS).faces[0]!;
const understood = (f: ReturnType<typeof face>): boolean => automated(f.abilities) && f.gate.every((g) => g.ok) && f.diagnostics.every((d) => d.level !== 'manual' || d.code === 'experimental');
const compiled = (text: string, type = 'Sorcery') => compileCard(card('Example Relic', type, text));
const full = (text: string, type?: string): boolean => {
  const d = compiled(text, type);
  return d.automation.level === 'full' && !JSON.stringify(d.faces).includes('"op":"manual"');
};

describe('std-costs-2 template file (design 6.3, 6.9; CONTRIBUTING "Adding a template")', () => {
  it('is loaded by the default compiler (zz-cloud/std-costs-2.json, after zz-cloud/std-blb.json, before zz-cloud/std-dft.json) and its ids are unique in the whole set', () => {
    const files = TEMPLATE_FILES.map((f) => f.file);
    expect(files.indexOf('zz-cloud/std-costs-2.json')).toBeGreaterThan(files.indexOf('zz-cloud/std-blb.json'));
    expect(files.indexOf('zz-cloud/std-costs-2.json')).toBeLessThan(files.indexOf('zz-cloud/std-dft.json'));
    const ids = TEMPLATE_SET.map((t) => t.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(validateTemplates([...TEMPLATE_SET])).toEqual([]);
  });
  it('design 6.9: every template cites rules, has at least two examples and two counter-examples, a status with its evidence, and is of version 8', () => {
    expect(T.map((t) => t.id)).toEqual([
      'eff.stdcosts2.additional.chooseOrExile', 'dl.stdcosts2.nextUpkeep.lead', 'eff.stdcosts2.additional.chooseType.behold', 'rid.stdcosts2.putOntoBattlefieldInstead',
    ]);
    for (const t of T) {
      expect(t.id, t.id).toMatch(/^(eff|dl|rid)\.stdcosts2\./);
      expect(t.cr.length, t.id).toBeGreaterThan(0);
      for (const cr of t.cr) expect(cr, t.id).toMatch(/^CR \d{3}(\.\d+[a-z]?)?$/);
      expect(t.examples.length, t.id).toBeGreaterThanOrEqual(2);
      expect(t.counterExamples.length, t.id).toBeGreaterThanOrEqual(2);
      expect(t.since, t.id).toBe(8);
      expect(t.status, t.id).toBe('stable');
    }
    for (const g of review as Golden) expect(g.expect, g.card).toBe('full');
    // narrow wordings, each printed on one Standard card: stable on that hand-verified golden card plus these tests and the scenarios (a 6.9 deviation named in the
    // round record)
    expect(goldenUsing('eff.stdcosts2.additional.chooseOrExile')).toEqual(['Close Encounter']);
    expect(goldenUsing('dl.stdcosts2.nextUpkeep.lead')).toEqual(['The Eagles Are Coming!']);
    expect(goldenUsing('eff.stdcosts2.additional.chooseType.behold')).toEqual(['Celestial Reunion']);
    expect(goldenUsing('rid.stdcosts2.putOntoBattlefieldInstead')).toEqual(['Celestial Reunion']);
  });
  it('guard G3: a critical word a pattern spells out is listed in `consumes`', () => {
    for (const t of T) {
      const words = t.pattern.toLowerCase().replace(/\{[^}]*:[^}]*\}/g, ' ').split(/[^a-z']+/).filter(Boolean);
      for (const w of ['all', 'each', 'another', 'other', 'may', 'if', 'unless', 'until', 'instead', 'only', 'chosen', 'except', "can't", 'would', 'then', 'when', 'also', 'additional']) {
        if (words.includes(w) && !(w === 'next' && t.kind === 'effect')) expect(t.consumes ?? [], `${t.id}: ${w}`).toContain(w);
      }
    }
  });
});

describe('std-costs-2 guard G9 (design 6.8): examples and counter-examples', () => {
  for (const t of T) {
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
        const f = face(c);
        expect(understood(f) && jsonKey(f.abilities) === jsonKey(first.abilities), c).toBe(false);
      }
    });
  }
});

/** Near-miss mutations of one example (design 6.8 G9): each must not parse, or parse to different JSON. */
function nearMisses(text: string): string[] {
  const out = [`${text.replace(/\.$/, '')} unless it is blue.`];
  const swaps: [RegExp, string][] = [
    [/\byou own in exile\b/, 'you own in your graveyard'], [/\bwarped\b/, 'exiled'], [/\byou control or\b/, 'an opponent controls or'], [/\bthe next upkeep\b/, 'the next end step'],
    [/\bof that type\b/, 'of that color'], [/\bchoose a creature type\b/, 'choose a color'], [/\bonto the battlefield instead\b/, 'into your graveyard instead'],
    [/\binto your hand\.$/, 'into your graveyard.'],
  ];
  for (const [re, by] of swaps) if (re.test(text)) out.push(text.replace(re, by));
  return out;
}

describe('std-costs-2 guard G9 (design 6.8): near-miss mutations fail or differ', () => {
  for (const t of T) {
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

describe('std-costs-2 guard G2 (design 6.8): a nonsense word never leaves an automated card', () => {
  for (const t of T) {
    it(`${t.id}: replacing any one word of the template's line of an example by an invented word makes the card not understood`, () => {
      for (const e of t.examples) {
        const lines = e.text.split('\n');
        const at = t.kind === 'rider' || t.id.startsWith('dl.') ? lines.length - 1 : 0; // a cost template's line is the first; a rider's and a delayed one's the last
        const words = lines[at]!.split(' ');
        words.forEach((w, i) => {
          const end = w.match(/[.,"]+$/)?.[0] ?? '';
          const line = [...words.slice(0, i), `blorfty${end}`, ...words.slice(i + 1)].join(' ');
          const mutated = lines.map((l, k) => (k === at ? line : l)).join('\n');
          expect(understood(face(mutated)), mutated).toBe(false);
        });
      }
    });
  }
});

describe('std-costs-2 parser, lowering and lint support (fail closed)', () => {
  it('CR 700.2, 608.2c (lower/ability.ts#sharedInstructionModes): target-only modes after "Choose up to N. <instruction on those cards>." share one step on the union of their targets', () => {
    const d = compiled('Choose up to two. Return those cards from your graveyard to your hand.\n• Target artifact card.\n• Target creature card.');
    expect(d.automation.level).toBe('full');
    const effect = (d.faces[0]!.abilities[0] as { effect: { steps: unknown[]; modes: { min: number; max: number; options: { program: { steps: unknown[] } }[] } } }).effect;
    expect(effect.steps).toEqual([{ op: 'move', what: { ref: 'union', of: [{ ref: 'target', id: 't0' }, { ref: 'target', id: 't1' }] }, to: { zone: 'hand' } }]);
    expect([effect.modes.min, effect.modes.max]).toEqual([0, 2]);
    expect(effect.modes.options.every((o) => o.program.steps.length === 0)).toBe(true);
    // a mode that is more than one target, a header with no count, or an instruction that does not say "those cards": no such reading
    expect(full('Choose up to two. Return those cards from your graveyard to your hand.\n• Target artifact card and target land card.\n• Target creature card.')).toBe(false);
    expect(full('Choose up to two. Return them from your graveyard to your hand.\n• Target artifact card.\n• Target creature card.')).toBe(false);
    expect(full('Choose up to three. Return those cards from your graveyard to your hand.\n• Target artifact card.\n• Target creature card.')).toBe(false);
  });
  it('CR 601.2b, 702.185a (cost chooseObject, ObjRef costChosenObject): "the chosen creature or card" needs the cost that chooses it', () => {
    const ok = compiled('As an additional cost to cast this spell, choose a creature you control or a warped creature card you own in exile.\nExample Relic deals damage equal to the power of the chosen creature or card to target creature.', 'Instant');
    expect(ok.automation.level).toBe('full');
    expect(JSON.stringify(ok.faces)).toContain('{"kind":"chooseObject","filters":[{"anyOf":[{"types":["Creature"]}],"zone":"battlefield","controller":"you"},{"anyOf":[{"warped":true,"types":["Creature"],"isCard":true}],"zone":"exile","owner":"you","isCard":true}],"count":1}');
    expect(compiled('Example Relic deals damage equal to the power of the chosen creature or card to target creature.', 'Instant').automation.level).not.toBe('full');
    expect(lintCard([{ abilities: [{ kind: 'spell', text: '', effect: { targets: [], steps: [{ op: 'gainLife', who: { ref: 'you' }, amount: { q: 'stat', stat: 'power', of: { ref: 'costChosenObject' } } }] } }] }] as never).map((i) => i.message).join(' ')).toMatch(/costChosenObject/);
  });
  it('CR 702.185a (Filter "warped"): "a warped creature card" is a filter of its own; in a graveyard there is no such reading', () => {
    expect(full('Return target warped creature card you own in exile to your hand.')).toBe(true);
    expect(JSON.stringify(compiled('Return target warped creature card you own in exile to your hand.').faces)).toContain('"warped":true');
  });
  it('CR 601.2b, 601.2c (lower/choose.ts#insteadChoose, lower/mentions.ts#insteadChosenGroup): the kicked "instead choose" announces one set or the other; "each chosen creature" names the one chosen', () => {
    const d = compiled('Kicker {1}\nChoose target creature you own. If this spell was kicked, instead choose any number of target creatures you own. Return each chosen creature to your hand.', 'Instant');
    expect(d.automation.level).toBe('full');
    const effect = (d.faces[0]!.abilities[1] as { effect: { targets: { onlyIf?: unknown }[]; steps: unknown[] } }).effect;
    expect(effect.targets.map((t) => t.onlyIf)).toEqual([{ cond: 'not', of: { cond: 'wasCast', kicked: true } }, { cond: 'wasCast', kicked: true }]);
    expect(effect.steps).toEqual([{ op: 'move', what: { ref: 'union', of: [{ ref: 'target', id: 't0' }, { ref: 'target', id: 't1' }] }, to: { zone: 'hand' } }]);
    // a condition not decided as the spell is cast is no announcement of other targets
    expect(full('Choose target creature you own. If you control an artifact, instead choose any number of target creatures you own. Return each chosen creature to your hand.')).toBe(false);
    // "each chosen creature" after one single target is no reading (one creature is "the chosen creature")
    expect(full('Choose target creature you own. Return each chosen creature to your hand.')).toBe(false);
  });
  it('CR 601.2b, 607.2d (AdditionalCostDef.chooseType, parser/parse.ts#faceChoices): the cost that chooses a creature type is "the chosen type" of the face', () => {
    const seg = (text: string) => ({ text }) as never;
    const reader = seg('Search your library for a creature card, reveal it, put it into your hand, then shuffle.');
    expect(faceChoices(reader, [reader, seg('As an additional cost to cast ~, you may choose a creature type and behold two creatures of that type.')])).toEqual([{ link: 'costType', what: 'creatureType' }]);
    expect(faceChoices(reader, [reader, seg('As an additional cost to cast ~, you may behold two creatures.')])).toEqual([]);
    // "the chosen type" with no choice on the face reads nothing: never automated
    expect(full('Search your library for a creature card, reveal it, put it into your hand, then shuffle. If the revealed card is the chosen type, you gain 2 life.')).toBe(false);
  });
  it('CR 614.15 (rider "@names"): "put that card onto the battlefield instead of putting it into your hand" replaces the move to the hand, not the shuffle; after a draw it has nothing to replace', () => {
    const d = compiled('Kicker {1}\nSearch your library for a creature card, reveal it, put it into your hand, then shuffle. If this spell was kicked, put that card onto the battlefield instead of putting it into your hand.');
    expect(d.automation.level).toBe('full');
    const steps = (d.faces[0]!.abilities[1] as { effect: { steps: { op: string }[] } }).effect.steps;
    expect(steps.map((s) => s.op)).toEqual(['search', 'if', 'shuffle']);
    expect(full('Kicker {1}\nDraw a card. If this spell was kicked, put that card onto the battlefield instead of putting it into your hand.')).toBe(false);
  });
});

describe('std-costs-2 renderer support', () => {
  const render = (def: object): string => renderAbility(def as never, { selfNames: ['Test Card'], selfTypes: ['Sorcery'] }).join(' ');
  const target = (id: string, filter: object) => ({ id, kind: 'object', min: 1, max: 1, text: '', filter });
  it('CR 700.2 (render/program.ts#sharedModes): target-only modes of different zones have no shared wording (fails closed)', () => {
    const modes = (z2: string) => ({
      kind: 'spell', text: '', effect: {
        targets: [], steps: [{ op: 'move', what: { ref: 'union', of: [{ ref: 'target', id: 'a' }, { ref: 'target', id: 'b' }] }, to: { zone: 'hand' } }],
        modes: { min: 0, max: 2, options: [{ text: '', program: { targets: [target('a', { types: ['Artifact'], zone: 'graveyard', owner: 'you', isCard: true })], steps: [] } }, { text: '', program: { targets: [target('b', { types: ['Creature'], zone: z2, owner: 'you', isCard: true })], steps: [] } }] },
      },
    });
    // (renderAbility prints the first reading of each alternative; the gate accepts "those cards from your graveyard")
    expect(render(modes('graveyard'))).toMatch(/^Choose up to two\. Return .* • Target artifact card\. • Target creature card\.$/i);
    expect(render(modes('exile'))).not.toMatch(/• Target creature card\./);
  });
  it('CR 601.2b (render/costs.ts): a chosen-object cost of one description has no wording (fails closed)', () => {
    const cost = (filters: object[]) => render({ kind: 'static', text: '', zone: ['stack'], effects: [{ s: 'additionalCost', cost: { other: [{ kind: 'chooseObject', filters, count: 1 }] } }] });
    expect(cost([{ types: ['Creature'], zone: 'battlefield', controller: 'you' }, { types: ['Creature'], warped: true, zone: 'exile', owner: 'you', isCard: true }])).toMatch(/choose a creature you control or a warped creature card you own in exile/i);
    expect(cost([{ types: ['Creature'], zone: 'battlefield', controller: 'you' }])).toMatch(/cannot render/);
  });
  it('CR 607.2d (render/stat.ts): the creature type chosen for a cost is said before the cost', () => {
    expect(render({ kind: 'static', text: '', zone: ['stack'], effects: [{ s: 'additionalCost', optional: true, chooseType: { what: 'creatureType', link: 'costType' }, cost: { other: [{ kind: 'behold', filter: { types: ['Creature'], chosen: { link: 'costType', quality: 'creatureType' } }, count: 2 }] } }] }))
      .toMatch(/you may choose a creature type and behold two creatures of the chosen type/i);
  });
});

const index = localIndex();

describe.skipIf(index === null)('std-costs-2 design 6.10 (local index): synthetic examples', () => {
  it('no std-costs-2 line of an example or counter-example is a line of a real card (with the card\'s own name or "this <type>" read as "~")', () => {
    const lines = new Set<string>();
    for (const c of index ?? []) {
      for (const text of [c.oracle_text, ...(c.card_faces ?? []).map((x) => x.oracle_text)]) {
        if (typeof text !== 'string') continue;
        for (const l of text.split('\n')) {
          lines.add(l.trim());
          lines.add(l.replaceAll(c.name, '~').replace(/\bthis (creature|land|artifact|enchantment|Aura|Equipment|spell|card|Saga|Vehicle)\b/gi, '~').trim());
        }
      }
    }
    const verbatim = T.flatMap((t) => [...t.examples.map((e) => e.text), ...t.counterExamples].filter((x) => x.split('\n').some((l) => lines.has(l.trim()))).map((x) => `${t.id}: ${x}`));
    expect(verbatim).toEqual([]);
  }, 120_000);
});
