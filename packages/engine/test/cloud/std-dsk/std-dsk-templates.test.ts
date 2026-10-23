/**
 * Cloud batch 2, slice std-dsk (the Standard backlog of Duskmourn, tuning half): the template data of parser/templates/zz-cloud/std-dsk.json and the hole
 * grammar, lowering and renderer support they needed (parser/holes/stddsk.ts, cond.ts, filter.ts, qty.ts, token.ts; render/fold-stddsk.ts, np.ts, cond.ts,
 * qty.ts, evt.ts, steps-flow.ts, steps-zones.ts). Guard G9 (design 6.8): every example lowers with its template, is automated and passes the exact render gate
 * (G6); every counter-example does not parse or parses to different JSON; near-miss mutations fail or differ; a nonsense word in place of any word of an example
 * never leaves an automated card (G2). Examples are synthetic wordings (design 6.10), checked against the local index when it is present. The behavior is in
 * std-dsk-scenarios.test.ts.
 */
import { describe, expect, it } from 'vitest';
import type { OracleCard } from '../../../src/index';
import type { Template } from '../../../src/parser/types';
import { defaultParseOptions, parseCard } from '../../../src/parser/parse';
import { validateTemplates } from '../../../src/parser/chart';
import { TEMPLATE_FILES, TEMPLATE_SET } from '../../../src/parser/template-set';
import { ENGINE_CAPABILITIES } from '../../../src/model/capabilities';
import { KEYWORD_DATA_FILES } from '../../../src/keywords/data';
import { WRAPPER_RESTRICTIONS } from '../../../src/render/abil';
import stdDsk from '../../../src/parser/templates/zz-cloud/std-dsk.json';
import review from '../../m5/golden/cards/cloud-std-dsk-review.json';
import { automated, bare, card, fullyAutomated, jsonKey } from '../../m5/templates/support';
import { localIndex } from '../../m5/parser/support';

const DSK = stdDsk as Template[];
const OPTS = defaultParseOptions({ templates: [...TEMPLATE_SET], capabilities: ENGINE_CAPABILITIES }); // what a decklist card gets (design 5.2; `needs`)

/** A synthetic card in which an example is an ability of the right kind: an Aura's or an Equipment's static ability, a spell on a sorcery, a trigger or activation on a creature. */
function exampleCard(t: Template, text: string): OracleCard {
  if (/^Enchanted creature\b/.test(text)) return card('Example Charm', 'Enchantment — Aura', `Enchant creature\n${text}`);
  if (/^Equipped creature\b/.test(text)) return card('Example Blade', 'Artifact — Equipment', text);
  if (t.kind === 'effect' && !text.includes(':') && !/^(When|Whenever|At)\b/.test(text)) return card('Example Volley', 'Sorcery', text);
  return card('Example Brute', 'Creature — Elf Warrior', text, { power: '3', toughness: '3' });
}
const parsedWith = (t: Template, text: string) => parseCard(exampleCard(t, text), OPTS).faces[0]!;

describe('std-dsk template file (design 6.3, 6.9; CONTRIBUTING "Adding a template")', () => {
  it('is loaded by the default compiler (zz-cloud/std-dsk.json, after trigger.json, before zz-fast1/) and its ids are unique in the whole set', () => {
    const files = TEMPLATE_FILES.map((f) => f.file);
    expect(files).toContain('zz-cloud/std-dsk.json');
    expect(files.indexOf('zz-cloud/std-dsk.json')).toBeGreaterThan(files.indexOf('trigger.json'));
    expect(files.indexOf('zz-cloud/std-dsk.json')).toBeLessThan(files.findIndex((f) => f.startsWith('zz-fast1/')));
    const ids = TEMPLATE_SET.map((t) => t.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(validateTemplates([...TEMPLATE_SET])).toEqual([]);
  });
  it('design 6.9: every template cites rules, has at least two examples and two counter-examples, a status, and is of version 8; ids are eff.stddsk.*, trg.stddsk.* or sta.stddsk.*', () => {
    expect(DSK.length).toBe(11);
    for (const t of DSK) {
      expect(t.id, t.id).toMatch(/^(eff|trg|sta)\.stddsk\./);
      expect(t.cr.length, t.id).toBeGreaterThan(0);
      for (const cr of t.cr) expect(cr, t.id).toMatch(/^CR \d{3}(\.\d+[a-z]?)?$/);
      expect(t.examples.length, t.id).toBeGreaterThanOrEqual(2);
      expect(t.counterExamples.length, t.id).toBeGreaterThanOrEqual(2);
      expect(['stable', 'experimental'], t.id).toContain(t.status);
      expect(t.since, t.id).toBe(8);
    }
  });
  it('design 6.9: a stable template has its evidence: at least one hand-verified golden card that uses it (the review file pins each card as full)', () => {
    const golden = review as { card: string; verified: string; expect?: string }[];
    for (const t of DSK.filter((x) => x.status === 'stable')) {
      const cards = golden.filter((g) => g.verified.includes(`(${t.id}`) || g.verified.includes(` ${t.id}`) || g.verified.includes(`${t.id},`)).map((g) => g.card);
      expect(cards.length, t.id).toBeGreaterThanOrEqual(1);
    }
    // the four templates no real card of the tuning half is full with yet stay experimental (cards that use them are capped at partial, design 6.9)
    expect(DSK.filter((x) => x.status === 'experimental').map((t) => t.id).sort()).toEqual([
      'eff.stddsk.counters.choice3.eachNamed', 'eff.stddsk.counters.choice3.yourChoice', 'eff.stddsk.loseGame.if', 'sta.stddsk.attached.pump.foreach.scaled.has',
    ]);
    for (const g of golden) expect(g.expect, g.card).toBe('full');
  });
  it('guard G3: a critical word a pattern spells out is listed in `consumes`', () => {
    for (const t of DSK) {
      const words = t.pattern.toLowerCase().replace(/\{[^}]*:[^}]*\}/g, ' ').split(/[^a-z']+/).filter(Boolean);
      for (const w of ['all', 'each', 'another', 'other', 'may', 'if', 'unless', 'until', 'instead', 'only', 'chosen', 'additional', 'except', "can't", 'would', 'next', 'then', 'whenever']) {
        if (words.includes(w)) expect(t.consumes ?? [], `${t.id}: ${w}`).toContain(w);
      }
    }
  });
});

describe('std-dsk guard G9 (design 6.8): examples and counter-examples', () => {
  for (const t of DSK) {
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

/** Near-miss mutations of one example sentence (design 6.8 G9): each must not parse, or parse to different JSON. */
function nearMisses(text: string): string[] {
  const body = text.replace(/\.$/, '');
  const out = [`${body} unless it is blue.`, `${body} instead.`, `${body} at random.`, `${body} twice.`, `${body} if able.`];
  const swaps: [RegExp, string][] = [
    [/\bfor each\b/, 'for any'], [/\band has\b/, 'and loses'], [/, or /, ', and '], [/\byour choice of\b/, 'their choice of'], [/\bdoesn't have\b/, 'has'],
    [/\bwin the game\b/, 'draw the game'], [/\blose the game\b/, 'lose a game'], [/\bface up\b/, 'face down'], [/\bwhenever you\b/i, 'Whenever an opponent'], [/\bor more\b/, 'or fewer'],
    [/\byour library\b/, 'your graveyard'], [/\breveal it\b/, 'reveal them'],
  ];
  for (const [re, by] of swaps) if (re.test(text)) out.push(text.replace(re, by));
  return out;
}

describe('std-dsk guard G9 (design 6.8): near-miss mutations fail or differ', () => {
  for (const t of DSK) {
    it(`${t.id}: an appended "unless/instead/at random/twice/if able" or a swapped key word never gives the example's JSON`, () => {
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

describe('std-dsk guard G2 (design 6.8): a nonsense word never leaves an automated card', () => {
  for (const t of DSK) {
    it(`${t.id}: replacing any one word of an example by an invented word makes the card not fully automated`, () => {
      for (const e of t.examples) {
        const words = e.text.split(' ');
        words.forEach((w, i) => {
          if (w === '~' || w === '~,' || w === '~.' || /^"?\{/.test(w) || w.includes('\n')) return;
          const end = w.match(/[.,"]+$/)?.[0] ?? '';
          const start = w.startsWith('"') ? '"' : '';
          const mutated = [...words.slice(0, i), `${start}blorfty${end}`, ...words.slice(i + 1)].join(' ');
          expect(fullyAutomated(parsedWith(t, mutated)), mutated).toBe(false);
        });
      }
    });
  }
});

describe('std-dsk hole grammar, lowering and renderer support', () => {
  const face = (type: string, text: string) => parseCard(card('Example Brute', type, text, { power: '3', toughness: '3' }), OPTS).faces[0]!;
  const room = (left: string, right: string) => parseCard({
    name: 'Example Den // Example Loft', layout: 'split', type_line: 'Enchantment — Room // Enchantment — Room', mana_cost: '{1} // {2}', colors: [],
    card_faces: [{ name: 'Example Den', type_line: 'Enchantment — Room', mana_cost: '{1}', oracle_text: left }, { name: 'Example Loft', type_line: 'Enchantment — Room', mana_cost: '{2}', oracle_text: right }],
  } as unknown as OracleCard, OPTS);

  it('CR 506.2, 603.4: "defending player controls no ..." is a condition; the positive form keeps its one reading by the restriction templates (guard G5)', () => {
    const no = face('Creature — Horror', 'Whenever ~ attacks, if defending player controls no Islands, draw a card.');
    expect(fullyAutomated(no)).toBe(true);
    expect(JSON.stringify(no.abilities)).toContain('"interveningIf":{"cond":"not","of":{"cond":"exists","of":{"ref":"each","filter":{"subtypes":["Island"],"controller":{"ref":"defending"}}}}}');
    // "can't attack unless defending player controls an Island": one reading (rst.t16.cantattack.unless.defending.controls), not two
    const unless = face('Creature — Serpent', "~ can't attack unless defending player controls an Island.");
    expect(fullyAutomated(unless)).toBe(true);
    expect(unless.diagnostics.filter((d) => d.code === 'ambiguous')).toEqual([]);
  });
  it('CR 608.2c: "then <instruction> unless you control ..." is rendered back from a negated control condition (render/steps-flow.ts)', () => {
    const f = face('Creature — Toy', 'When ~ enters, draw a card. Then discard a card unless you control an artifact.');
    expect(fullyAutomated(f)).toBe(true);
    expect(f.gate.every((g) => g.ok)).toBe(true);
  });
  it('CR 201.2: "that doesn\'t have the same name as <a described permanent>" is the negated name comparison with the set, also in a target', () => {
    const f = face('Creature — Elf', "When ~ enters, tap target creature that doesn't have the same name as a creature you control.");
    expect(fullyAutomated(f)).toBe(true);
    expect(JSON.stringify(f.abilities)).toContain('"not":{"sharesWith":{"with":{"ref":"each","filter":{"types":["Creature"],"controller":"you"}},"quality":"name"}}');
    // after the target's own controller ("target nontoken creature you control that doesn't have ..."): the clause is said after it (render/np.ts)
    const own = face('Creature — Elf', "When ~ enters, exile target nontoken creature you control that doesn't have the same name as a token you control.");
    expect(fullyAutomated(own)).toBe(true);
    expect(own.gate.every((g) => g.ok)).toBe(true);
    // the search reads it with the zone the template states (the hole drops only the "no zone stated" note)
    const s = face('Creature — Elf', "When ~ enters, search your library for an Elf card that doesn't have the same name as an Elf you control, reveal it, put it into your hand, then shuffle.");
    expect(fullyAutomated(s)).toBe(true);
    expect(s.templatesUsed).toContain('eff.stddsk.search.reveal.notSameName');
    // an ordinary search keeps its own template (the hole accepts only descriptions with the name comparison)
    const plain = face('Creature — Elf', 'When ~ enters, search your library for an Elf card, reveal it, put it into your hand, then shuffle.');
    expect(plain.templatesUsed).not.toContain('eff.stddsk.search.reveal.notSameName');
    expect(fullyAutomated(plain)).toBe(true);
  });
  it('CR 709.5, 709.5c: door names and unlocked doors are read for Rooms only', () => {
    const names = room('At the beginning of your upkeep, you win the game if there are four or more different names among unlocked doors of Rooms you control.', 'When you unlock this door, draw a card.');
    expect(names.faces.every((f) => automated(f.abilities))).toBe(true);
    const notRooms = face('Creature — Spirit', 'At the beginning of your upkeep, you win the game if there are four or more different names among unlocked doors of permanents you control.');
    expect(automated(notRooms.abilities)).toBe(false);
    const doors = room('When you unlock this door, you gain life equal to the number of unlocked doors among Rooms you control.', 'When you unlock this door, draw a card.');
    expect(automated(doors.faces[0]!.abilities)).toBe(true);
    expect(JSON.stringify(doors.faces[0]!.abilities)).toContain('"q":"unlockedDoors","among":{"ref":"each","filter":{"subtypes":["Room"],"controller":"you"}}');
    const creatures = face('Creature — Spirit', 'When ~ enters, create an X/X blue Spirit creature token with flying, where X is the number of unlocked doors among creatures you control.');
    expect(automated(creatures.abilities)).toBe(false);
  });
  it('CR 702.37e, 708.2: only "you turn ... face up" names who turned it; an opponent\'s turning is not read', () => {
    const them = face('Creature — Horror', 'Whenever an opponent turns a permanent face up, draw a card.');
    expect(automated(them.abilities)).toBe(false);
  });
  it('CR 205.3i, 305.6: "that is every basic land type" belongs to a named land token only', () => {
    const land = face('Creature — Treefolk', 'When ~ enters, create a colorless land token named Yonder that is every basic land type.');
    expect(fullyAutomated(land)).toBe(true);
    expect(JSON.stringify(land.abilities)).toContain('"subtypes":["Plains","Island","Swamp","Mountain","Forest"]');
    const creature = face('Creature — Treefolk', 'When ~ enters, create a 1/1 colorless Golem artifact creature token named Yonder that is every basic land type.');
    expect(automated(creature.abilities)).toBe(false);
  });
  it('CR 702.177a, 602.5b: an exhaust ability with a timing restriction of its own is read and rendered; the keyword\'s own restriction said again stays manual', () => {
    const f = parseCard(card('Example Relic', 'Artifact', 'Exhaust — {2}: Draw a card. Activate only as a sorcery.'), OPTS).faces[0]!;
    expect(fullyAutomated(f)).toBe(true);
    expect(f.gate.every((g) => g.ok)).toBe(true);
    expect(f.abilities[0]).toMatchObject({ keyword: 'exhaust', sorcerySpeed: true, limit: { per: 'game', max: 1 } });
    const during = parseCard(card('Example Relic', 'Artifact', 'Exhaust — {2}: Draw a card. Activate only during your turn.'), OPTS).faces[0]!;
    expect(fullyAutomated(during)).toBe(true);
    const once = parseCard(card('Example Relic', 'Artifact', 'Exhaust — {2}: Draw a card. Activate only once each turn.'), OPTS).faces[0]!;
    expect(automated(once.abilities)).toBe(false);
  });
  it('design 5.4: the renderer\'s table of wrapper-keyword restrictions (render/abil.ts#WRAPPER_RESTRICTIONS, it may not import the keyword layer) is the keyword data', () => {
    const fromData: Record<string, unknown> = {};
    for (const f of KEYWORD_DATA_FILES) {
      const d = f.data as { name: string; status?: string; modifies?: { kind?: string; limit?: unknown; sorcerySpeed?: boolean; onlyIf?: unknown } };
      const m = d.modifies;
      if (m?.kind !== 'activated' || d.status !== 'implemented') continue;
      fromData[d.name.toLowerCase()] = { ...(m.limit !== undefined ? { limit: m.limit } : {}), ...(m.sorcerySpeed === true ? { sorcerySpeed: true } : {}), ...(m.onlyIf !== undefined ? { onlyIf: m.onlyIf } : {}) };
    }
    expect(WRAPPER_RESTRICTIONS).toEqual(fromData);
  });
  it('CR 122.1b: a kind outside the lexicon\'s counter kinds and keywords is no choice (guard G2), and three kinds need ", or"', () => {
    expect(automated(face('Creature — Human', 'When ~ enters, put a flying, glorbix, or +1/+1 counter on it.').abilities)).toBe(false);
    expect(automated(face('Creature — Human', 'When ~ enters, put a flying, lifelink +1/+1 counter on it.').abilities)).toBe(false);
  });
});

const index = localIndex();

describe.skipIf(index === null)('std-dsk design 6.10 (local index): synthetic examples', () => {
  it('no std-dsk line of an example or counter-example is a line of a real card (with the card\'s own name or "this <type>" read as "~")', () => {
    const lines = new Set<string>();
    for (const c of index ?? []) {
      for (const text of [c.oracle_text, ...(c.card_faces ?? []).map((x) => x.oracle_text)]) {
        if (typeof text !== 'string') continue;
        for (const l of text.split('\n')) {
          lines.add(l.trim());
          lines.add(l.replaceAll(c.name, '~').replace(/\bthis (creature|land|artifact|enchantment|Aura|spell|card|door)\b/gi, '~').trim());
        }
      }
    }
    const verbatim = DSK.flatMap((t) => [...t.examples.map((e) => e.text), ...t.counterExamples].filter((x) => x.split('\n').some((l) => lines.has(l.trim()))).map((x) => `${t.id}: ${x}`));
    expect(verbatim).toEqual([]);
  }, 120_000);
});
