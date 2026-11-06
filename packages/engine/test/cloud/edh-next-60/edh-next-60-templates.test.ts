/**
 * Commander worker, round edh-next-60 (lane prevent: damage prevention and redirection): the template data of parser/templates/zz-cloud/edh-next-60.json (see the file) and the round's parser, lowering,
 * engine and renderer changes, tested at the end of this file and in edh-next-60-scenarios.test.ts.
 * Guard G9 (design 6.8): every example lowers with its template, is automated and passes the exact render gate (G6); every counter-example does not parse or
 * parses to different JSON; near-miss mutations fail or differ; a nonsense word in place of any word of an example never leaves an automated card (G2). Examples
 * are synthetic wordings (design 6.10), checked against the local index when it is present. CR cites checked against the Comprehensive Rules text of 2026-09-25 (media.wizards.com).
 */
import { describe, expect, it } from 'vitest';
import type { OracleCard } from '../../../src/index';
import type { Template } from '../../../src/parser/types';
import { defaultParseOptions, parseCard } from '../../../src/parser/parse';
import { validateTemplates } from '../../../src/parser/chart';
import { TEMPLATE_FILES, TEMPLATE_SET } from '../../../src/parser/template-set';
import { ENGINE_CAPABILITIES } from '../../../src/model/capabilities';
import edhN60 from '../../../src/parser/templates/zz-cloud/edh-next-60.json';
import review from '../../m5/golden/cards/edh-next-60-review.json';
import { automated, bare, card, fullyAutomated, jsonKey } from '../../m5/templates/support';
import { localIndex } from '../../m5/parser/support';

const MECH = edhN60 as Template[];
const MECH_COUNT = 14;
/**
 * design 6.9 deviation (docs/CARD_AUTOMATION.md section 5, "Narrow wordings"): templates made stable on fewer than three golden cards because Oracle prints the
 * wording on only one or two cards, with their template tests (G9, G2) and played scenarios. Listed in the round's record for the owner (DECIDED BY DEFAULT,
 * owner instruction 2026-10-21).
 */
const NARROW: Readonly<Record<string, readonly string[]>> = {
  // the cards of the EDHREC top 20,000 that print each wording and are full (opened by the owner: commander request 2026-10-27, more cards 2026-10-30)
  'eff.edhn60.redirect.all.youAnd.lead': ['Heroic Sacrifice'],
  'eff.edhn60.redirect.all.youAnd.mid': ["Gideon's Sacrifice", 'Saving Grace'],
  'eff.edhn60.redirect.all.group.lead': ['Ascent of the Worthy'],
  'sta.edhn60.damageToSelf.prevent.list': ["Sekki, Seasons' Guide"],
  'sta.edhn60.damageToAttached.prevent.then': ['Panther Habit'],
  'sta.edhn60.aslong.prevent.toObj': ['Multiclass Baldric'], // edh-next-147: made stable on its one full card (design 6.9 narrow wording, recorded)
  'sta.edhn60.damageToSelf.whileCounter.prevent.then': ['Polukranos, Unchained'],
  'eff.edhn60.damageToObj.prevent.then.dur': ['Gatta and Luzzu'],
  'eff.edhn60.prevent.nextTime.objWouldDeal.gainLife': ['Awe Strike'],
  'eff.edhn60.prevent.nextTime.objCombatToPlayers.then': ['Ria Ivor, Bane of Bladehold'],
  'sta.edhn60.combatDamageToCreature.prevent.ownerShuffles': ['Weeping Angel'],
  'eff.edhn60.prevent.toYou.byFilter.whenPrevented.eachDealsPower': ['Judgment of Alexander'],
  'sta.edhn60.damageToSelf.whileCounter.prevent.removeThenGiveRad': ['Bloatfly Swarm'],
  'sta.edhn60.entersWith.escapesWith.instead': ['Polukranos, Unchained'],
}
const OPTS = defaultParseOptions({ templates: [...TEMPLATE_SET], capabilities: ENGINE_CAPABILITIES }); // what a decklist card gets (design 5.2; `needs`)

/** A synthetic card with the example as its ability: a static or an activated ability on an artifact creature, a spell otherwise. */
const parsedWith = (t: Template, text: string) => parseCard(
  t.kind === 'static' || text.includes(':') || /^(When|Whenever|At the beginning)/.test(text) || (text.startsWith('~') && !text.includes('as you cast ~')) ? card('Example Relic', 'Artifact Creature — Construct', text, { power: '2', toughness: '2' }) : card('Example Plan', 'Sorcery', text), OPTS).faces[0]!;

describe('edh-next-60 template file (design 6.3, 6.9; CONTRIBUTING "Adding a template")', () => {
  it('is loaded by the default compiler (zz-cloud/edh-next-60.json, path order: after edh-next-45.json, before edh-next-5.json) and its ids are unique in the whole set', () => {
    const files = TEMPLATE_FILES.map((f) => f.file);
    expect(files).toContain('zz-cloud/edh-next-60.json');
    expect(files.indexOf('zz-cloud/edh-next-60.json')).toBeGreaterThan(files.indexOf('zz-cloud/edh-next-6.json'));
    const ids = TEMPLATE_SET.map((t) => t.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(validateTemplates([...TEMPLATE_SET])).toEqual([]);
  });
  it('design 6.9: every template cites rules, has at least two examples and two counter-examples, a status, and is of version 9; ids are *.edhn60.*', () => {
    expect(MECH.length).toBe(MECH_COUNT);
    for (const t of MECH) {
      expect(t.id, t.id).toMatch(/^(eff|sta|rep|trg|rst|ch|rid|cm|kw)\.edhn60\./);
      expect(t.cr.length, t.id).toBeGreaterThan(0);
      for (const cr of t.cr) expect(cr, t.id).toMatch(/^CR \d{3}(\.\d+[a-z]?)?$/);
      expect(t.examples.length, t.id).toBeGreaterThanOrEqual(2);
      expect(t.counterExamples.length, t.id).toBeGreaterThanOrEqual(2);
      expect(['stable', 'experimental'], t.id).toContain(t.status);
      expect(t.since, t.id).toBe(9);
    }
  });
  it('design 6.9: a stable template has its evidence: three or more hand-verified golden cards, or (a recorded deviation) the one card that prints the wording', () => {
    const golden = review as { card: string; verified: string; expect?: string }[];
    for (const t of MECH.filter((x) => x.status === 'stable')) {
      const cards = golden.filter((g) => g.verified.includes(`(${t.id}`) || g.verified.includes(` ${t.id}`) || g.verified.includes(`${t.id},`)).map((g) => g.card);
      if (NARROW[t.id] !== undefined) for (const n of NARROW[t.id]!) expect(cards, t.id).toContain(n);
      else expect(cards.length, t.id).toBeGreaterThanOrEqual(3);
    }
    for (const g of review as { card: string; expect?: string }[]) expect(g.expect, g.card).toBe('full');
  });
  it('guard G3: a critical word a pattern spells out is listed in `consumes`', () => {
    for (const t of MECH) {
      const words = t.pattern.toLowerCase().replace(/\{[^}]*:[^}]*\}/g, ' ').split(/[^a-z']+/).filter(Boolean);
      for (const w of ['all', 'each', 'another', 'other', 'may', 'if', 'unless', 'until', 'instead', 'only', 'chosen', 'additional', 'except', "can't", 'would', 'next', 'then', 'during']) {
        if (words.includes(w)) expect(t.consumes ?? [], `${t.id}: ${w}`).toContain(w);
      }
    }
  });
});

describe('edh-next-60 guard G9 (design 6.8): examples and counter-examples', () => {
  for (const t of MECH) {
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

/** Near-miss mutations of one example (design 6.8 G9): each must not parse, or parse to different JSON. */
function nearMisses(text: string): string[] {
  const body = text.replace(/\.$/, '');
  const out = [`${body} unless it is blue.`, `${body} instead.`, `${body} at random.`, `${body} twice.`, `${body} if able.`, `${body} until end of turn.`];
  const swaps: [RegExp, string][] = [[/\btwo\b/, 'three'], [/\bhaste\b/, 'flying'], [/\bWalls\b/, 'Wall'], [/\bone\b/, 'two']];
  for (const [re, by] of swaps) if (re.test(text)) out.push(text.replace(re, by));
  return out;
}

describe('edh-next-60 guard G9 (design 6.8): near-miss mutations fail or differ', () => {
  for (const t of MECH) {
    it(`${t.id}: an appended "unless/instead/at random/twice/if able/until end of turn" or a swapped key word never gives the example's JSON`, () => {
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

describe('edh-next-60 guard G2 (design 6.8): a nonsense word never leaves an automated card', () => {
  for (const t of MECH) {
    it(`${t.id}: replacing any one word of an example by an invented word makes the card not fully automated`, () => {
      for (const e of t.examples) {
        const words = e.text.split(' ');
        words.forEach((w, i) => {
          if (/^"?~/.test(w) || /^\{/.test(w)) return;
          if (/^counters?[.,]?$/.test(words[i + 1] ?? '')) return; // the name of a kind of counter is an open class of words (`CounterKind`): any word names one
          const lead = w.match(/^["\n]+/)?.[0] ?? '';
          const end = w.match(/[.,:"\n]+$/)?.[0] ?? '';
          const mutated = [...words.slice(0, i), `${lead}blorfty${end}`, ...words.slice(i + 1)].join(' ');
          expect(fullyAutomated(parsedWith(t, mutated)), mutated).toBe(false);
        });
      }
    });
  }
});

const index = localIndex();

describe.skipIf(index === null)('edh-next-60 design 6.10 (local index): synthetic examples', () => {
  it('no edh-next-60 line of an example or counter-example is a line of a real card (with the card\'s own name or "this <type>" read as "~")', () => {
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



describe('edh-next-60 parser, renderer and engine changes (one test each)', () => {
  const creature = (text: string, type = 'Creature — Wizard') => parseCard(card('Example Beast', type, text, { power: '2', toughness: '2' }), OPTS).faces[0]!;
  const spell = (text: string) => parseCard(card('Example Plan', 'Sorcery', text), OPTS).faces[0]!;
  it('parser/lower/ability.ts#discourseOf, holes/object.ts (CR 608.2c, 607.2): "the chosen creature" after "Choose a creature you control." in the same ability is that choice (the link placeholder of another ability is the weaker reading); a choice that names no object leaves it unread', () => {
    expect(fullyAutomated(spell('Choose a creature you control. Until end of turn, all damage that would be dealt to you and creatures you control is dealt to the chosen creature instead.'))).toBe(true);
    expect(fullyAutomated(spell('Until end of turn, all damage that would be dealt to you and creatures you control is dealt to the chosen creature instead.'))).toBe(false);
    expect(fullyAutomated(spell('Choose a creature you control. Until end of turn, all combat damage that would be dealt to you and creatures you control is dealt to the chosen creature instead.'))).toBe(false);
  });
  it('parser/lower/quantities.ts#underPreventThen (CR 615.5): "that many" in the additional steps of a prevention that is a step of an effect is the damage prevented; in another sentence it still has no candidate', () => {
    expect(fullyAutomated(spell('Choose target creature you control. If damage would be dealt to that creature this turn, prevent that damage and put that many +1/+1 counters on it.'))).toBe(true);
    expect(fullyAutomated(spell('Choose target creature you control. If damage would be dealt to that creature this turn, prevent that damage. Put that many +1/+1 counters on it.'))).toBe(false);
  });
  it('render/steps-zones.ts (CR 615.5, 111.1): "prevent that damage and create that many tokens" says the damage prevented as "that many"; an unrelated number is not "that many"', () => {
    expect(fullyAutomated(creature('If damage would be dealt to ~, prevent that damage, remove that many +1/+1 counters from ~, and create that many 1/1 colorless Spirit creature tokens.'))).toBe(true);
    expect(fullyAutomated(creature('If damage would be dealt to ~, prevent that damage, remove that many +1/+1 counters from ~, and create that many 1/1 colorless Spirit creature tokens twice.'))).toBe(false);
  });
  it('lower/ability.ts#joinPreventedThisWay (CR 615.5): the shield sentence and "you gain life equal to the damage prevented this way" are one instruction only in that exact pair', () => {
    expect(fullyAutomated(spell('The next time target creature would deal damage this turn, prevent that damage. You gain life equal to the damage prevented this way.'))).toBe(true);
    expect(fullyAutomated(spell('The next time target creature would deal damage this turn, prevent that damage. You gain life equal to half the damage prevented this way.'))).toBe(false);
  });
  it('render/cond.ts (CR 506.4, 611.3a): "an artifact creature you control is attacking" is the existence of an attacking artifact creature you control; blocking or an opponent\'s creature is another condition', () => {
    expect(fullyAutomated(spell('If an artifact creature you control is attacking, draw a card.'))).toBe(true);
    expect(fullyAutomated(spell('If an artifact creature you control is blocking, draw a card.'))).toBe(false);
    expect(fullyAutomated(spell('If an artifact creature you control is attacking or blocking, draw a card.'))).toBe(false);
  });
  it('effects/bodies/m5.ts#applyPrevent (CR 615.12): damage that can\'t be prevented still runs the additional steps with the damage it would have prevented (played in the scenarios: Test Seki)', () => {
    expect(fullyAutomated(creature("If damage would be dealt to ~, prevent that damage and put that many +1/+1 counters on ~."))).toBe(true);
  });
});
