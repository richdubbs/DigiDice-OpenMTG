/**
 * Precon lane pc-counters, round pc-counters-1 (counters: energy amounts, players who lost life, enters-with-additional-counters replacements, exile and graveyard
 * triggers): the template data of parser/templates/zz-cloud/pc-counters-1.json, the quantity readings of parser/holes/pccounters1.ts, the event readings of
 * parser/holes/event.ts ("is exiled from the battlefield", a permanent "is put into a graveyard"), and the renderer readings (render/steps-life.ts, render/stat.ts,
 * render/evt.ts, render/abil.ts). Guard G9 (design 6.8): every example lowers with its template, is automated and passes the exact render gate (G6); every
 * counter-example does not parse or parses to different JSON; near-miss mutations fail or differ; a nonsense word in place of any word of an example never leaves
 * an automated card (G2). Examples are synthetic wordings (design 6.10), checked against the local index when it is present. The behavior is in
 * pc-counters-1-scenarios.test.ts. CR cites from memory, unverified (rules/cr/ is not in the cloud checkout).
 */
import { describe, expect, it } from 'vitest';
import type { Template } from '../../../src/parser/types';
import { defaultParseOptions, parseCard } from '../../../src/parser/parse';
import { validateTemplates } from '../../../src/parser/chart';
import { TEMPLATE_FILES, TEMPLATE_SET } from '../../../src/parser/template-set';
import { ENGINE_CAPABILITIES } from '../../../src/model/capabilities';
import round from '../../../src/parser/templates/zz-cloud/pc-counters-1.json';
import review from '../../m5/golden/cards/pc-counters-1-review.json';
import { automated, card, fullyAutomated, jsonKey } from '../../m5/templates/support';
import { localIndex } from '../../m5/parser/support';

const MECH = round as Template[];
const MECH_COUNT = 7;
const OPTS = defaultParseOptions({ templates: [...TEMPLATE_SET], capabilities: ENGINE_CAPABILITIES }); // what a decklist card gets (design 5.2; `needs`)

/** A spell: the sentences of a sorcery. */
const parse = (text: string, type = 'Sorcery', pt?: { power: string; toughness: string }) => parseCard(card('Example Ooze', type, text, pt ?? {}), OPTS).faces[0]!;
/** Fully automated, and no cost part the model cannot state. */
const fully = (f: ReturnType<typeof parse>): boolean => fullyAutomated(f) && !JSON.stringify(f.abilities).includes('"kind":"manual"');
const golden = review as { card: string; verified: string; expect?: string }[];
const evidence = (id: string): string[] => golden.filter((g) => g.verified.includes(`(${id}`) || g.verified.includes(` ${id}`) || g.verified.includes(`${id},`)).map((g) => g.card);
/** The type line an example needs: a trigger or a static ability goes on a permanent, an effect on a spell. */
const typeOf = (t: Template): string => (t.kind === 'effect' ? 'Sorcery' : /^equipped/i.test(t.examples[0]!.text) ? 'Artifact — Equipment' : /^enchanted/i.test(t.examples[0]!.text) ? 'Enchantment — Aura' : 'Artifact');

describe('pc-counters-1 template file (design 6.3, 6.9; CONTRIBUTING "Adding a template")', () => {
  it('is loaded by the default compiler (zz-cloud/pc-counters-1.json, after p2-zone-moves-1, before r3-choose) and its ids are unique in the whole set', () => {
    const files = TEMPLATE_FILES.map((f) => f.file);
    expect(files).toContain('zz-cloud/pc-counters-1.json');
    expect(files.indexOf('zz-cloud/pc-counters-1.json')).toBeGreaterThan(files.indexOf('zz-cloud/p2-zone-moves-1.json'));
    expect(files.indexOf('zz-cloud/pc-counters-1.json')).toBeLessThan(files.indexOf('zz-cloud/r3-choose.json'));
    const ids = TEMPLATE_SET.map((t) => t.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(validateTemplates([...TEMPLATE_SET])).toEqual([]);
  });
  it('design 6.9: every template cites rules, has at least two examples and two counter-examples, a status, and is of version 8; ids are eff./rep./sta.pcc1.*', () => {
    expect(MECH.length).toBe(MECH_COUNT);
    for (const t of MECH) {
      expect(t.id, t.id).toMatch(/^(eff|rep|sta)\.pcc1\./);
      expect(t.cr.length, t.id).toBeGreaterThan(0);
      for (const cr of t.cr) expect(cr, t.id).toMatch(/^CR \d{3}(\.\d+[a-z]?)?$/);
      expect(t.examples.length, t.id).toBeGreaterThanOrEqual(2);
      expect(t.counterExamples.length, t.id).toBeGreaterThanOrEqual(2);
      expect(['stable', 'experimental'], t.id).toContain(t.status);
      expect(t.since, t.id).toBe(8);
    }
  });
  it('design 6.9 DEVIATION (named in the round record): each wording is printed on one to three precon cards, so each template is stable on one hand-verified golden card (the precon decks hold the others)', () => {
    expect(MECH.filter((x) => x.status === 'stable').map((t) => t.id).sort()).toEqual(MECH.map((t) => t.id).sort());
    expect(evidence('eff.pcc1.energy.amountEqual')).toContain('Peema Aether-Seer');
    expect(evidence('rep.pcc1.others.enter.nAdditionalCounters.plural')).toEqual(['Curator Beastie']);
    expect(evidence('rep.pcc1.others.enters.xAdditionalCounters.whereX')).toEqual(['Bloodspore Thrinax']);
    expect(evidence('rep.pcc1.others.enters.numberAdditionalCounters.equal')).toEqual(['Arwen, Weaver of Hope']);
    expect(evidence('sta.pcc1.attached.pump.foreach.counterOnSelf.addType')).toEqual(["Reaper's Scythe"]);
    expect(evidence('rep.pcc1.graveyard.others.enters.additionalCounter')).toEqual(['Dearly Departed']);
    expect(evidence('rep.pcc1.self.enters.counters.list4')).toEqual(["Agent's Toolkit"]);
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

describe('pc-counters-1 guard G9 (design 6.8): examples and counter-examples', () => {
  for (const t of MECH) {
    it(`${t.id} (${t.cr.join(', ')}): every example parses with it, is automated and passes the render gate; counter-examples do not give the same JSON`, () => {
      const type = typeOf(t);
      const first = parse(t.examples[0]!.text, type);
      for (const e of t.examples) {
        const f = parse(e.text, type);
        expect(f.templatesUsed.includes(t.id), `${e.text}: ${f.templatesUsed.join(', ')}`).toBe(true);
        expect(automated(f.abilities), `${e.text}: ${JSON.stringify(f.abilities)} ${JSON.stringify(f.diagnostics)}`).toBe(true);
        expect(f.gate.every((g) => g.ok), `${e.text}: ${JSON.stringify(f.gate)}`).toBe(true);
        expect(f.diagnostics.filter((d) => d.level === 'manual'), e.text).toEqual([]);
      }
      for (const c of t.counterExamples) {
        const f = parse(c, type);
        expect(fullyAutomated(f) && jsonKey(f.abilities) === jsonKey(first.abilities), c).toBe(false);
      }
    });
  }
});

/** Near-miss mutations of one example (design 6.8 G9): each must not parse, or parse to different JSON. */
function nearMisses(text: string): string[] {
  const body = text.replace(/\.$/, '');
  const out = [`${body} unless it is blue.`, `${body} instead.`, `${body} at random.`, `${body} twice.`, `${body} this turn.`];
  const swaps: [RegExp, string][] = [
    [/\bgreatest power\b/, 'greatest toughness'], [/\bhighest toughness\b/, 'highest power'], [/\btwo additional\b/, 'three additional'], [/\bthree additional\b/, 'two additional'], [/\bEach other\b/, 'Each'],
    [/\bin your graveyard\b/, 'in your hand'], [/\bnumber of additional\b/, 'number of'], [/\bgets \+1\/\+1\b/, 'gets +2/+2'], [/\bwhere X is\b/, 'where Y is'], [/\ba flying counter\b/, 'a reach counter'],
    [/\bEnchanted\b/, 'Equipped'], [/\bamount of\b/, 'number of'],
  ];
  for (const [re, by] of swaps) if (re.test(text)) out.push(text.replace(re, by));
  return out;
}

describe('pc-counters-1 guard G9 (design 6.8): near-miss mutations fail or differ', () => {
  for (const t of MECH) {
    it(`${t.id}: an appended "unless/instead/at random/twice/this turn" or a swapped key word never gives the example's JSON`, () => {
      const type = typeOf(t);
      for (const e of t.examples) {
        const orig = parse(e.text, type);
        for (const m of nearMisses(e.text)) {
          if (m === e.text) continue;
          const f = parse(m, type);
          const same = automated(f.abilities) && f.gate.every((g) => g.ok) && jsonKey(f.abilities) === jsonKey(orig.abilities);
          // "Enchanted" and "Equipped" are one reading of the attached-creature templates (both give attachedTo): not a near miss there
          if (/^(Enchanted|Equipped)/.test(e.text) && m.replace(/^(Enchanted|Equipped)/, '') === e.text.replace(/^(Enchanted|Equipped)/, '')) continue;
          expect(same, m).toBe(false);
        }
      }
    });
  }
});

describe('pc-counters-1 guard G2 (design 6.8): a nonsense word never leaves an automated card', () => {
  for (const t of MECH) {
    it(`${t.id}: replacing any one word of an example by an invented word makes the card not fully automated`, () => {
      const type = typeOf(t);
      for (const e of t.examples) {
        const words = e.text.split(' ');
        words.forEach((w, i) => {
          if (/^"?~/.test(w) || /^\{/.test(w)) return;
          // the word before "counter(s)" is a counter kind, and any word is one (an unlisted kind is a weak reading of the CounterKind hole: "a blorfty counter" is a counter kind)
          if (/^counters?\b/.test(words[i + 1] ?? '')) return;
          const lead = w.match(/^["\n]+/)?.[0] ?? '';
          const end = w.match(/[.,:"\n]+$/)?.[0] ?? '';
          const mutated = [...words.slice(0, i), `${lead}blorfty${end}`, ...words.slice(i + 1)].join(' ');
          expect(fullyAutomated(parse(mutated, type)), mutated).toBe(false);
        });
      }
    });
  }
});

describe('pc-counters-1 lowering and holes: the readings that are no template of their own', () => {
  it('CR 119.3, 122.1, 608.2h: "for each player / opponent who lost life this turn" and "the number of players who lost life this turn" count the players of countPlayers.lostLifeThisTurn', () => {
    const each = parse('Put a charge counter on target creature for each player who lost life this turn.');
    expect(fully(each), JSON.stringify(each.diagnostics)).toBe(true);
    expect(JSON.stringify(each.abilities)).toContain('"count":{"q":"countPlayers","of":{"ref":"each","who":"player"},"lostLifeThisTurn":true}');
    const opp = parse('Put a charge counter on target creature for each opponent who lost life this turn.');
    expect(JSON.stringify(opp.abilities)).toContain('"count":{"q":"countPlayers","of":{"ref":"each","who":"opponent"},"lostLifeThisTurn":true}');
    const gain = parse('You gain life equal to the number of players who lost life this turn.');
    expect(fully(gain), JSON.stringify(gain.diagnostics)).toBe(true);
    expect(JSON.stringify(gain.abilities)).toContain('"q":"countPlayers","of":{"ref":"each","who":"player"},"lostLifeThisTurn":true');
    // not for another description of the players, or without the turn
    for (const bad of ['Put a charge counter on target creature for each player who lost life.', 'Put a charge counter on target creature for each creature who lost life this turn.', 'Put a charge counter on target creature for each player who gained life this turn.', 'You gain life equal to the number of players who lost life this game.']) {
      expect(fully(parse(bad)), bad).toBe(false);
    }
  });
  it('std-mkm keeps its sentence: "Investigate for each opponent who lost life this turn." still reads with the std-mkm template (the new reading is weak)', () => {
    const f = parse('Investigate for each opponent who lost life this turn.');
    expect(f.templatesUsed).toContain('eff.stdmkm.investigate.foreach.lostlife');
    expect(fully(f)).toBe(true);
  });
  it('CR 400.7, 603.6c: "Whenever a creature is exiled from the battlefield" / "is put into exile from the battlefield" are a leaves-the-battlefield event into exile; a bare "is exiled" stays any zone', () => {
    for (const text of ['Whenever a creature is exiled from the battlefield, draw a card.', 'Whenever a creature is put into exile from the battlefield, draw a card.', 'Whenever another creature you control is exiled from the battlefield, draw a card.']) {
      const f = parse(text, 'Enchantment');
      expect(fully(f), `${text}: ${JSON.stringify(f.diagnostics)}`).toBe(true);
      expect(JSON.stringify(f.abilities), text).toContain('"from":"battlefield","to":"exile"');
    }
    const bare = parse('Whenever a creature is exiled, draw a card.', 'Enchantment');
    expect(JSON.stringify(bare.abilities)).not.toContain('"from":"battlefield","to":"exile"');
    expect(fully(parse('Whenever a creature is exiled from your hand, draw a card.', 'Enchantment'))).toBe(false);
  });
  it('CR 700.4, 603.6c: "Whenever a permanent you control is put into a graveyard" is from the battlefield (a permanent is there); a creature, a card or a nonland permanent is no such reading', () => {
    const f = parse('Whenever a permanent you control is put into a graveyard, draw a card.', 'Enchantment');
    expect(fully(f), JSON.stringify(f.diagnostics)).toBe(true);
    expect(JSON.stringify(f.abilities)).toContain('"subject":{"controller":"you"},"from":"battlefield","to":"graveyard"');
    expect(fully(parse('Whenever another permanent is put into a graveyard, draw a card.', 'Enchantment'))).toBe(true);
    for (const bad of ['Whenever a card is put into a graveyard, draw a card.', 'Whenever a creature you control is put into a graveyard, draw a card.', 'Whenever a nonland permanent you control is put into a graveyard, draw a card.', 'Whenever a permanent you control is put into a graveyard from your hand, draw a card.']) {
      expect(fully(parse(bad, 'Enchantment')), bad).toBe(false);
    }
  });
});

const index = localIndex();

describe.skipIf(index === null)('pc-counters-1 design 6.10 (local index): synthetic examples', () => {
  it('no pc-counters-1 line of an example or counter-example is a line of a real card (with the card\'s own name or "this <type>" read as "~")', () => {
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
