/**
 * Lane trek, round trek-11 (Star Trek: The Holodeck, playing a card from outside the game): the template data of parser/templates/zz-cloud/trek-11.json, the
 * permission field `alsoOutside` (types/ability.ts#PermissionDef; statics/play-permits.ts#isPermanentPlayPermit; model/cap-walk.ts; render/stat.ts), the
 * `playOutside` special action (core/special/play-outside.ts) and the action field `outside` (core/action-shape.ts). Guard G9 (design 6.8): every example lowers with
 * its template, is automated and passes the exact render gate (G6); every counter-example does not parse or parses to different JSON; near-miss mutations fail or
 * differ; a nonsense word in place of any word of an example never leaves an automated card (G2). Examples are synthetic wordings (design 6.10), checked against the
 * local index when it is present. The behavior is in trek-11-scenarios.test.ts. CR cites from memory, unverified (rules/cr/ is not in the cloud checkout).
 */
import { describe, expect, it } from 'vitest';
import type { Template } from '../../../src/parser/types';
import { defaultParseOptions, parseCard } from '../../../src/parser/parse';
import { validateTemplates } from '../../../src/parser/chart';
import { TEMPLATE_FILES, TEMPLATE_SET } from '../../../src/parser/template-set';
import { ENGINE_CAPABILITIES } from '../../../src/model/capabilities';
import { capabilitiesOfDef } from '../../../src/model/cap-walk';
import { actionShapeProblem } from '../../../src/core/action-shape';
import { isGraveyardPermit, isPermanentPlayPermit, PERMANENT_CARD_TYPES } from '../../../src/statics/play-permits';
import { SPECIAL_ACTION_HANDLERS } from '../../../src/core/registries';
import type { PermissionDef } from '../../../src/types/ability';
import round from '../../../src/parser/templates/zz-cloud/trek-11.json';
import review from '../../m5/golden/cards/trek-11-review.json';
import { automated, bare, card, fullyAutomated, jsonKey } from '../../m5/templates/support';
import { localIndex } from '../../m5/parser/support';

const MECH = round as Template[];
const MECH_COUNT = 1;
const OPTS = defaultParseOptions({ templates: [...TEMPLATE_SET], capabilities: ENGINE_CAPABILITIES }); // what a decklist card gets (design 5.2; `needs`)

/** A static ability of an artifact card. */
const parse = (text: string) => parseCard(card('Example Relic', 'Legendary Artifact', text, { mana_cost: '{7}' }), OPTS).faces[0]!;
const golden = review as { card: string; verified: string; expect?: string }[];
const evidence = (id: string): string[] => golden.filter((g) => g.verified.includes(`(${id}`) || g.verified.includes(` ${id}`) || g.verified.includes(`${id},`)).map((g) => g.card);

describe('trek-11 template file (design 6.3, 6.9; CONTRIBUTING "Adding a template")', () => {
  it('is loaded by the default compiler (zz-cloud/trek-11.json, in path order after trek-1.json, before trek-2.json) and its ids are unique in the whole set', () => {
    const files = TEMPLATE_FILES.map((f) => f.file);
    expect(files).toContain('zz-cloud/trek-11.json');
    expect(files.indexOf('zz-cloud/trek-11.json')).toBeGreaterThan(files.indexOf('zz-cloud/trek-1.json'));
    expect(files.indexOf('zz-cloud/trek-11.json')).toBeLessThan(files.indexOf('zz-cloud/trek-2.json'));
    expect(files.indexOf('zz-cloud/trek-11.json')).toBeLessThan(files.indexOf('zz-fast1/t4.json'));
    const ids = TEMPLATE_SET.map((t) => t.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(validateTemplates([...TEMPLATE_SET])).toEqual([]);
  });
  it('design 6.9: every template cites rules, has at least two examples and two counter-examples, a status, and is of version 8; ids are sta.trek11.*', () => {
    expect(MECH.length).toBe(MECH_COUNT);
    for (const t of MECH) {
      expect(t.id, t.id).toMatch(/^sta\.trek11\./);
      expect(t.cr.length, t.id).toBeGreaterThan(0);
      for (const cr of t.cr) expect(cr, t.id).toMatch(/^CR \d{3}(\.\d+[a-z]?)?$/);
      expect(t.examples.length, t.id).toBeGreaterThanOrEqual(2);
      expect(t.counterExamples.length, t.id).toBeGreaterThanOrEqual(2);
      expect(['stable', 'experimental'], t.id).toContain(t.status);
      expect(t.since, t.id).toBe(8);
    }
  });
  it('design 6.9 DEVIATION (named in the round record, accepted by the owner on 2026-10-24 for single-printing Star Trek wordings): the wording is printed on one card, so the template is stable on one hand-verified golden card', () => {
    expect(MECH.filter((x) => x.status === 'stable').map((t) => t.id)).toEqual(['sta.trek11.once.playPermanentOutside']);
    expect(evidence('sta.trek11.once.playPermanentOutside')).toEqual(['The Holodeck']);
    for (const g of golden) expect(g.expect, g.card).toBe('full');
  });
  it('guard G3: a critical word a pattern spells out is listed in `consumes`', () => {
    for (const t of MECH) {
      const words = t.pattern.toLowerCase().replace(/\{[^}]*:[^}]*\}/g, ' ').split(/[^a-z']+/).filter(Boolean);
      for (const w of ['all', 'each', 'another', 'other', 'may', 'if', 'unless', 'until', 'instead', 'only', 'chosen', 'additional', 'except', "can't", 'would', 'next', 'then', 'during', 'same']) {
        if (words.includes(w)) expect(t.consumes ?? [], `${t.id}: ${w}`).toContain(w);
      }
    }
  });
});

describe('trek-11 guard G9 (design 6.8): examples and counter-examples', () => {
  for (const t of MECH) {
    it(`${t.id} (${t.cr.join(', ')}): every example parses with it, is automated and passes the render gate; counter-examples do not give the same JSON`, () => {
      const first = parse(t.examples[0]!.text);
      for (const e of t.examples) {
        const f = parse(e.text);
        expect(f.templatesUsed.includes(t.id), `${e.text}: ${f.templatesUsed.join(', ')}`).toBe(true);
        expect(automated(f.abilities), `${e.text}: ${JSON.stringify(f.abilities)} ${JSON.stringify(f.diagnostics)}`).toBe(true);
        expect(f.gate.every((g) => g.ok), `${e.text}: ${JSON.stringify(f.gate)}`).toBe(true);
        expect(f.diagnostics.filter((d) => d.level === 'manual'), e.text).toEqual([]);
      }
      for (const c of t.counterExamples) {
        const f = parse(c);
        expect(fullyAutomated(f) && jsonKey(f.abilities) === jsonKey(first.abilities), c).toBe(false);
        expect(f.templatesUsed.includes(t.id) && fullyAutomated(f), c).toBe(false); // none of them is this template's (a card that is only partly this wording is manual)
      }
    });
  }
});

/** Near-miss mutations of one example (design 6.8 G9): each must not parse, or parse to different JSON. */
function nearMisses(text: string): string[] {
  const body = text.replace(/\.$/, '');
  const out = [`${body} unless it is blue.`, `${body} instead.`, `${body} at random.`, `${body} twice.`, `${body} this turn.`];
  const swaps: [RegExp, string][] = [
    [/\bOnce during each of your turns\b/, 'During each of your turns'], [/\bOnce during each of your turns\b/, "Once during each of your opponents' turns"], [/\bmay play\b/, 'may cast'],
    [/\ba permanent card\b/, 'a creature card'], [/\ba permanent card\b/, 'a nonland card'], [/\byou own\b/, 'an opponent owns'], [/\bfrom your graveyard or from outside the game\b/, 'from your hand or from outside the game'],
    [/\bfrom your graveyard or from outside the game\b/, 'from exile or from outside the game'], [/\bfrom your graveyard\b/, "from an opponent's graveyard"], [/\boutside the game\b/, 'the battlefield'], [/\bfrom your graveyard or\b/, 'from your graveyard and'],
  ];
  for (const [re, by] of swaps) if (re.test(text)) out.push(text.replace(re, by));
  return out;
}

describe('trek-11 guard G9 (design 6.8): near-miss mutations fail or differ', () => {
  for (const t of MECH) {
    it(`${t.id}: an appended "unless/instead/at random/twice/this turn" or a swapped key word never gives the example's JSON`, () => {
      for (const e of t.examples) {
        const orig = parse(e.text);
        for (const m of nearMisses(e.text)) {
          if (m === e.text) continue;
          const f = parse(m);
          expect(automated(f.abilities) && f.gate.every((g) => g.ok) && jsonKey(f.abilities) === jsonKey(orig.abilities), m).toBe(false);
        }
      }
    });
  }
});

describe('trek-11 guard G2 (design 6.8): a nonsense word never leaves an automated card', () => {
  for (const t of MECH) {
    it(`${t.id}: replacing any one word of an example by an invented word makes the card not fully automated`, () => {
      for (const e of t.examples) {
        const words = e.text.split(' ');
        words.forEach((w, i) => {
          if (/^"?~/.test(w) || /^\{/.test(w)) return;
          const lead = w.match(/^["\n]+/)?.[0] ?? '';
          const end = w.match(/[.,:"\n]+$/)?.[0] ?? '';
          const mutated = [...words.slice(0, i), `${lead}blorfty${end}`, ...words.slice(i + 1)].join(' ');
          expect(fullyAutomated(parse(mutated)), mutated).toBe(false);
        });
      }
    });
  }
});

describe('trek-11 model (CR 400.11, 305.1, 601.3): the permission `alsoOutside` is honored on its one form, and refused on any other (fail closed)', () => {
  const permit = (extra: Record<string, unknown> = {}, drop: string[] = []): PermissionDef => {
    const base: Record<string, unknown> = { s: 'permit', who: { ref: 'you' }, action: 'play', of: { types: [...PERMANENT_CARD_TYPES] }, from: 'graveyard', alsoOutside: true, oncePerTurn: true, ...extra };
    for (const k of drop) delete base[k];
    return base as unknown as PermissionDef;
  };
  const staticOf = (p: PermissionDef) => ({ kind: 'static', condition: { cond: 'turnOf', whose: 'you' }, effects: [p] });
  it('the capability is registered, and the form is read by the engine and by the model walker alike', () => {
    expect(ENGINE_CAPABILITIES.has('feature:permit.play.zone.outside')).toBe(true);
    expect(isPermanentPlayPermit(permit())).toBe(true);
    expect(isGraveyardPermit(permit())).toBe(true); // the graveyard half is the ordinary graveyard permission
    const caps = capabilitiesOfDef(staticOf(permit()) as never);
    expect(caps).toContain('feature:permit.play.zone.outside');
    expect(caps.filter((c) => !ENGINE_CAPABILITIES.has(c))).toEqual([]);
  });
  it('without the once-each-turn limit, with another type list, with an extra field, for another player, as a cast, or from another zone, the field is not honored and its capability is unregistered', () => {
    const odd: PermissionDef[] = [
      permit({}, ['oncePerTurn']),
      permit({ of: { types: ['Creature'] } }),
      permit({ of: { types: [...PERMANENT_CARD_TYPES].reverse(), subtypes: ['Elf'] } }),
      permit({ addCost: { life: 1 } }),
      permit({ who: { ref: 'each', who: 'player' } }),
      permit({ action: 'cast' }),
      permit({ from: 'exile' }),
      permit({ alsoOutside: false }),
      permit({ of: undefined }),
    ];
    for (const p of odd) {
      expect(isPermanentPlayPermit(p), JSON.stringify(p)).toBe(false);
      expect(isGraveyardPermit(p) && p.alsoOutside !== undefined, JSON.stringify(p)).toBe(false);
      const caps = capabilitiesOfDef(staticOf(p) as never);
      expect(caps.some((c) => !ENGINE_CAPABILITIES.has(c)) || !caps.includes('feature:permit.play.zone.outside'), JSON.stringify(p)).toBe(true);
    }
  });
  it('a resolved effect that carries the field (it has no counter for the limit) is a form nothing registers', () => {
    const lasting = { kind: 'activated', cost: { mana: [{ kind: 'generic', amount: 1 }] }, effect: { targets: [], steps: [{ op: 'effect', duration: { d: 'endOfTurn' }, effects: [permit()] }] } };
    expect(capabilitiesOfDef(lasting as never).some((c) => !ENGINE_CAPABILITIES.has(c))).toBe(true);
  });
  it('the field is a land-and-spell permission only: "you may play lands from your graveyard" (GY1) is unchanged and does not read it', () => {
    const gy1 = { s: 'permit', who: { ref: 'you' }, action: 'play', of: { types: ['Land'] }, from: 'graveyard' } as unknown as PermissionDef;
    expect(isGraveyardPermit(gy1)).toBe(true);
    expect(isPermanentPlayPermit(gy1)).toBe(false);
    expect(isGraveyardPermit({ ...gy1, alsoOutside: true } as PermissionDef)).toBe(false);
  });
});

describe('trek-11 renderer (render/stat.ts#graveyardPermit; render/abil.ts family during-turn)', () => {
  it('CR 611.3a: the one form says "once during each of your turns, you may play a permanent card you own from outside the game or from your graveyard" and the gate passes', () => {
    const f = parse('Once during each of your turns, you may play a permanent card you own from outside the game or from your graveyard.');
    expect(fullyAutomated(f), JSON.stringify(f.diagnostics)).toBe(true);
    expect((bare(f.abilities) as Record<string, unknown>[])[0]).toMatchObject({ kind: 'static', condition: { cond: 'turnOf', whose: 'you' }, effects: [{ s: 'permit', action: 'play', from: 'graveyard', alsoOutside: true, oncePerTurn: true }] });
  });
  it('the words before the permission and a second ability do not change it: it is one static ability among others', () => {
    const f = parse('{6}, {T}: You gain 7 life.\nOnce during each of your turns, you may play a permanent card you own from outside the game or from your graveyard.');
    expect(fullyAutomated(f), JSON.stringify(f.diagnostics)).toBe(true);
    expect(f.abilities.length).toBe(2);
  });
  it('the other wordings are not this one: no template reads "a land card", the graveyard alone, outside the game alone, or an opponent\'s turn (manual, never wrong)', () => {
    for (const text of [
      'Once during each of your turns, you may play a land card you own from outside the game or from your graveyard.',
      'Once during each of your turns, you may play a permanent card you own from outside the game.',
      "Once during each of your opponents' turns, you may play a permanent card you own from outside the game or from your graveyard.",
    ]) expect(fullyAutomated(parse(text)), text).toBe(false);
  });
});

describe('trek-11 special action (core/special/play-outside.ts; core/action-shape.ts): `playOutside` and its field `outside`', () => {
  it('the handler is registered once, hidden from public questions, and lists nothing with no permission (here: an empty game)', () => {
    const hs = SPECIAL_ACTION_HANDLERS.filter((h) => h.kind === 'playOutside');
    expect(hs.length).toBe(1);
    expect(hs[0]!.hidden).toBe(true);
  });
  it('the action shape: `outside` is a short string, and a field the engine does not read is still refused (net: exactFields)', () => {
    const a = { type: 'special', player: 'p1', kind: 'playOutside', outside: 'Example Bear' };
    expect(actionShapeProblem(a, { exactFields: true })).toBeNull();
    expect(actionShapeProblem({ ...a, outside: 7 }, { exactFields: true })).not.toBeNull();
    expect(actionShapeProblem({ ...a, outside: 'x'.repeat(201) }, { exactFields: true })).not.toBeNull();
    expect(actionShapeProblem({ ...a, outsidee: 'Example Bear' }, { exactFields: true })).not.toBeNull();
    expect(actionShapeProblem({ type: 'cast', player: 'p1', card: 'o1', outside: 'Example Bear' }, { exactFields: true })).not.toBeNull(); // only a special action has it
  });
});

const index = localIndex();

describe.skipIf(index === null)('trek-11 design 6.10 (local index): synthetic examples', () => {
  it('no trek-11 line of an example or counter-example is a line of a real card (with the card\'s own name or "this <type>" read as "~")', () => {
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
    const verbatim = MECH.flatMap((t) => [...t.examples.map((e) => e.text), ...t.counterExamples].filter((x) => x.split('\n').some((l) => lines.has(l.trim()))).map((x) => `${t.id}: ${x}`));
    expect(verbatim).toEqual([]);
  }, 120_000);
});
