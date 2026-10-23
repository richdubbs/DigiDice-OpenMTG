/**
 * std-rx31 (wave 2, Standard lane rx31: exile, copies and returns): the template data of parser/templates/zz-cloud/std-rx31.json and the round's parser, renderer
 * and engine support: an optional cast's "Otherwise" and "if it wasn't cast this way" (parser/lower/riders.ts, parser/lower/conditions.ts#resolveDid,
 * model/lint-flow.ts, render/steps-flow.ts), a rider's instructions put BEFORE the step it modifies (`@before`, parser/lower/riders.ts), the "double-faced card"
 * filter (CR 712.1: rules/filter.ts, parser/holes/filter.ts, render/np.ts, render/cond.ts), "a player controls no creatures" (parser/holes/cond.ts#control,
 * render/cond.ts), what the object was as it left in a trigger on itself leaving (parser/lower/ability.ts#selfAsItLeft), a plural name's "die" and "were"
 * (render/evt.ts, parser/holes/cond.ts), "becomes attached to a creature" (parser/holes/event.ts, triggers/normalize.ts, triggers/match.ts), a total of mana values
 * as the stop of "exile cards until" (effects/handlers/actions-native.ts), and the renderer folds of render/fold-stdrx31.ts. Guard G9 (design 6.8): every example
 * lowers with its template and passes the exact render gate (G6); every counter-example does not parse or parses to different JSON; near-miss mutations fail or
 * differ; a nonsense word in place of any word of an example never leaves an automated card (G2). Examples are synthetic wordings (design 6.10), checked against
 * the local index when it is present. The behavior is in std-rx31-scenarios.test.ts. CR cites from memory, unverified (rules/cr/ is not in the cloud checkout).
 */
import { describe, expect, it } from 'vitest';
import { compileCard, type OracleCard } from '../../../src/index';
import type { Template } from '../../../src/parser/types';
import { defaultParseOptions, parseCard } from '../../../src/parser/parse';
import { validateTemplates } from '../../../src/parser/chart';
import { TEMPLATE_FILES, TEMPLATE_SET } from '../../../src/parser/template-set';
import { ENGINE_CAPABILITIES } from '../../../src/model/capabilities';
import stdRx31 from '../../../src/parser/templates/zz-cloud/std-rx31.json';
import review from '../../m5/golden/cards/cloud-std-rx31-review.json';
import r3cost from '../../m5/golden/cards/cloud-r3-cost-review.json';
import { automated, bare, card, fullyAutomated, jsonKey } from '../../m5/templates/support';
import { localIndex } from '../../m5/parser/support';

const RX31 = stdRx31 as Template[];
const OPTS = defaultParseOptions({ templates: [...TEMPLATE_SET], capabilities: ENGINE_CAPABILITIES }); // what a decklist card gets (design 5.2; `needs`)
type Golden = { card: string; verified: string; expect?: string }[];
const goldenUsing = (id: string, file: Golden = review as Golden): string[] => file.filter((g) => new RegExp(`[ (]${id.replaceAll('.', '\\.')}[,);]`).test(g.verified)).map((g) => g.card);

/** The type line each template's examples are printed on. */
const TYPE: Readonly<Record<string, string>> = {
  'eff.stdrx31.cast.free.maxManaValue.qty': 'Creature — Giant',
  'eff.stdrx31.put.hand.ifNotCastThisWay': 'Sorcery',
  'rid.stdrx31.instead.putOneOfThose.battlefield': 'Sorcery',
  'eff.stdrx31.dig.reveal.fromAmong': 'Sorcery',
  'eff.stdrx31.may.put.bf.andGains': 'Sorcery',
  'eff.stdrx31.ifNotPutRevealed.battlefield': 'Sorcery',
  'rid.stdrx31.instead.mayReveal.upTo.hand': 'Sorcery',
  'eff.stdrx31.exileUntil.totalManaValue': 'Sorcery',
  'eff.stdrx31.return.bf.ifCond': 'Sorcery',
  'eff.stdrx31.return.bf.andItsA.ptArtifactCreature': 'Sorcery',
  'eff.stdrx31.player.mayPayLife': 'Enchantment',
  'eff.stdrx31.return.underYourControl.withCounter': 'Enchantment',
  'eff.stdrx31.itsAnArtifact.noDuration': 'Creature — Troll',
  'eff.stdrx31.may.becomeCopy.dur': 'Creature — Shapeshifter',
};
const face = (id: string, text: string, typeLine?: string) => {
  const type = typeLine ?? TYPE[id] ?? 'Sorcery';
  return parseCard(card('Example Relic', type, text, type.includes('Creature') ? { power: '2', toughness: '2' } : undefined), OPTS).faces[0]!;
};
const understood = (f: ReturnType<typeof face>): boolean => automated(f.abilities) && f.gate.every((g) => g.ok) && f.diagnostics.every((d) => d.level !== 'manual' || d.code === 'experimental');
const level = (type: string, text: string, name = 'Example Relic'): string =>
  compileCard({ name, layout: 'normal', mana_cost: '{0}', type_line: type, oracle_text: text, colors: [], ...(type.includes('Creature') ? { power: '2', toughness: '2' } : {}) } as OracleCard).automation.level;
const abilitiesOf = (type: string, text: string): string => JSON.stringify(parseCard(card('Example Relic', type, text, type.includes('Creature') ? { power: '2', toughness: '2' } : undefined), OPTS).faces[0]!.abilities);

describe('std-rx31 template file (design 6.3, 6.9; CONTRIBUTING "Adding a template")', () => {
  it('is loaded by the default compiler (zz-cloud/std-rx31.json, after zz-cloud/std-rx3.json, before zz-cloud/std-rx4.json) and its ids are unique in the whole set', () => {
    const files = TEMPLATE_FILES.map((f) => f.file);
    expect(files).toContain('zz-cloud/std-rx31.json');
    expect(files.indexOf('zz-cloud/std-rx31.json')).toBe(files.indexOf('zz-cloud/std-rx30.json') + 1); // (std-rx30 sorts between std-rx3 and std-rx31)
    expect(files.indexOf('zz-cloud/std-rx31.json')).toBeGreaterThan(files.indexOf('zz-cloud/std-rx3.json'));
    const ids = TEMPLATE_SET.map((t) => t.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(validateTemplates([...TEMPLATE_SET])).toEqual([]);
  });
  it('design 6.9: every template cites rules, has at least two examples and two counter-examples, a status with its evidence, and is of version 8', () => {
    expect(RX31.map((t) => t.id)).toEqual(Object.keys(TYPE));
    for (const t of RX31) {
      expect(t.id, t.id).toMatch(/^(eff|rid)\.stdrx31\./);
      expect(t.cr.length, t.id).toBeGreaterThan(0);
      for (const cr of t.cr) expect(cr, t.id).toMatch(/^CR \d{3}(\.\d+[a-z]?)?$/);
      expect(t.examples.length, t.id).toBeGreaterThanOrEqual(2);
      expect(t.counterExamples.length, t.id).toBeGreaterThanOrEqual(2);
      expect(t.since, t.id).toBe(8);
      expect(t.status, t.id).toBe('stable');
    }
    for (const g of review as Golden) expect(g.expect, g.card).toBe('full');
    // narrow wordings, each printed on one card of the index: stable on one hand-verified golden card plus these tests and the scenarios, a 6.9 deviation named
    // in the round record and the PR (the Oracle card that prints each one is its golden card)
    const ONE: Readonly<Record<string, string>> = {
      'eff.stdrx31.cast.free.maxManaValue.qty': 'Bre of Clan Stoutarm',
      'eff.stdrx31.put.hand.ifNotCastThisWay': 'Beseech the Mirror',
      'rid.stdrx31.instead.putOneOfThose.battlefield': 'Back for Seconds',
      'eff.stdrx31.dig.reveal.fromAmong': 'Break Out',
      'eff.stdrx31.may.put.bf.andGains': 'Break Out',
      'eff.stdrx31.ifNotPutRevealed.battlefield': 'Break Out',
      'rid.stdrx31.instead.mayReveal.upTo.hand': 'Follow the Lumarets',
      'eff.stdrx31.return.bf.ifCond': 'Brilliance Unleashed',
      'eff.stdrx31.return.bf.andItsA.ptArtifactCreature': 'Brilliance Unleashed',
      'eff.stdrx31.player.mayPayLife': 'Meathook Massacre II',
      'eff.stdrx31.return.underYourControl.withCounter': 'Meathook Massacre II',
      'eff.stdrx31.itsAnArtifact.noDuration': 'Tom, Bert, and William',
      'eff.stdrx31.may.becomeCopy.dur': 'Lazav, Familiar Stranger',
    };
    for (const [id, name] of Object.entries(ONE)) expect(goldenUsing(id), id).toEqual([name]);
    // (Improvisation Capstone's golden entry is r3-cost's, updated in place by this round: guide section 6)
    expect(goldenUsing('eff.stdrx31.exileUntil.totalManaValue', r3cost as Golden)).toEqual(['Improvisation Capstone']);
  });
  it('guard G3: a critical word a pattern spells out is listed in `consumes`', () => {
    for (const t of RX31) {
      const words = t.pattern.toLowerCase().replace(/\{[^}]*:[^}]*\}/g, ' ').split(/[^a-z']+/).filter(Boolean);
      for (const w of ['all', 'each', 'another', 'other', 'may', 'if', 'unless', 'until', 'instead', 'only', 'chosen', 'except', "can't", 'would', 'next', 'then', 'when', 'also', 'first', 'additional']) {
        if (words.includes(w)) expect(t.consumes ?? [], `${t.id}: ${w}`).toContain(w);
      }
    }
  });
});

describe('std-rx31 guard G9 (design 6.8): examples and counter-examples', () => {
  for (const t of RX31) {
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
    [/less than or equal to/, 'greater than or equal to'], [/wasn't cast/, 'was cast'], [/into your hand/, 'into your graveyard'], [/onto the battlefield/, 'into exile'],
    [/mana value (\d) or less/, 'power $1 or less'], [/reveal (a|an) /, 'exile $1 '], [/total mana value/, 'total power'], [/or greater/, 'or less'],
    [/artifact creature/, 'enchantment creature'], [/finality/, 'stun'], [/pay (\d) life/, 'lose $1 life'], [/an artifact/, 'an enchantment'],
    [/additional/, 'more'], [/becomes attached to/, 'becomes detached from'], [/a copy of/, 'a token of'], [/didn't put/, 'put'],
  ];
  for (const [re, by] of swaps) if (re.test(text)) out.push(text.replace(re, by));
  return out;
}

describe('std-rx31 guard G9 (design 6.8): near-miss mutations fail or differ', () => {
  for (const t of RX31) {
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

describe('std-rx31 guard G2 (design 6.8): a nonsense word never leaves an automated card', () => {
  for (const t of RX31) {
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

describe('std-rx31 parser, renderer and engine support (hole readings, folds, no template)', () => {
  it('CR 712.1: "If it\'s a double-faced card, you may transform it" after a card put onto the battlefield from among a group', () => {
    const text = "Look at the top five cards of your library. You may put a Hero card from among them onto the battlefield. If it's a double-faced card, you may transform it. Put the rest on the bottom of your library in a random order.";
    expect(level('Sorcery', text)).toBe('full');
    expect(abilitiesOf('Sorcery', text)).toContain('"filter":{"doubleFaced":true,"isCard":true}');
    expect(level('Sorcery', text.replace('double-faced', 'single-faced'))).not.toBe('full');
  });
  it('CR 102.1, 603.4: "if a player controls no creatures" is at least one player who controls none; "an opponent controls no creatures" keeps its own reading', () => {
    const text = 'At the beginning of your end step, if a player controls no creatures, draw a card.';
    expect(level('Enchantment', text)).toBe('full');
    expect(abilitiesOf('Enchantment', text)).toContain('"controlsIs":{"filter":{"types":["Creature"]},"op":"==","n":0}');
    expect(abilitiesOf('Enchantment', 'At the beginning of your end step, if an opponent controls no creatures, draw a card.')).not.toContain('controlsIs');
    expect(level('Enchantment', 'At the beginning of your end step, if a player controls no creature, draw a card.')).not.toBe('full');
  });
  it('CR 603.10a, 603.4: a past-tense "if ~ was a creature" in a trigger on the object itself leaving the battlefield reads what it was as it left', () => {
    const text = 'When ~ dies, if ~ was a creature, draw a card.';
    expect(level('Legendary Creature — Troll', text)).toBe('full');
    expect(abilitiesOf('Legendary Creature — Troll', text)).toContain('"interveningIf":{"cond":"matches","object":{"ref":"event","role":"subject"}');
  });
  it('CR 201.5: a plural name takes "die" and "were" (the object itself)', () => {
    const name = 'Test Ann and Bo';
    const text = `When ${name} die, if they were a creature, return them to the battlefield. They're an artifact.`;
    const c = compileCard({ name, layout: 'normal', mana_cost: '{0}', type_line: 'Legendary Creature — Troll', oracle_text: text, colors: [], power: '4', toughness: '4' } as OracleCard);
    expect(c.automation.level).toBe('full');
  });
  it('CR 701.3a: "Whenever ~ becomes attached to a creature" names that creature "that creature" (the event\'s object); "becomes attached" alone does not', () => {
    const text = 'Whenever ~ becomes attached to a creature, that creature gets +1/+1 until end of turn.\nEquip {1}';
    expect(level('Artifact — Equipment', text)).toBe('full');
    expect(abilitiesOf('Artifact — Equipment', text)).toContain('"affects":{"ref":"event","role":"object"}');
  });
  it('CR 608.2c: "Otherwise" after an optional cast of yours is "if you don\'t"; after "If C, you may cast ..." it is still the other branch of C (fl.otherwise)', () => {
    const text = 'Exile cards from the top of your library until you exile a nonland card. You may cast that card without paying its mana cost if that spell\'s mana value is 3 or less. Otherwise, put it into your hand.';
    expect(level('Sorcery', text)).toBe('full');
    expect(abilitiesOf('Sorcery', text)).toContain('"cond":{"cond":"did","step":"did","not":true}');
    const branch = abilitiesOf('Sorcery', 'Exile cards from the top of your library until you exile a nonland card. If you control an Elf, you may cast that card without paying its mana cost. Otherwise, put it into your hand.');
    expect(branch).toContain('"else":[');
    expect(branch).not.toContain('"cond":"did"');
  });
  it('CR 608.2c: "if it wasn\'t cast this way" needs one optional cast of yours earlier in the ability', () => {
    expect(level('Sorcery', 'Search your library for a card, exile it face down, then shuffle. Put the exiled card into your hand if it wasn\'t cast this way.')).not.toBe('full');
  });
});

const index = localIndex();

describe.skipIf(index === null)('std-rx31 design 6.10 (local index): synthetic examples', () => {
  it('no std-rx31 line of an example or counter-example is a line of a real card (with the card\'s own name or "this <type>" read as "~")', () => {
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
    // (a line that is only a keyword ability, "Bargain", "Kicker {2}", "Equip {3}", gives the example its card type and is not the template's)
    const context = /^(Bargain|Kicker \{\d\}|Equip \{\d\})$/;
    const verbatim = RX31.flatMap((t) => [...t.examples.map((e) => e.text), ...t.counterExamples].filter((x) => x.split('\n').some((l) => !context.test(l.trim()) && lines.has(l.trim()))).map((x) => `${t.id}: ${x}`));
    expect(verbatim).toEqual([]);
  }, 120_000);
});
