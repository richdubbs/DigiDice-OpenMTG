/**
 * Commander lane edh-top, round edh-top-7: the template data of parser/templates/zz-cloud/edh-top-7.json ("..., its owner may cast it", "Then if there are four or more charge counters on it, you may
 * remove those counters and transform it") and the round's parser and renderer changes, tested at the end of this file and in edh-top-7-scenarios.test.ts.
 * Guard G9 (design 6.8): every example lowers with its template, is automated and passes the exact render gate (G6); every counter-example does not parse or parses to different JSON; near-miss
 * mutations fail or differ; a nonsense word in place of any word of an example never leaves an automated card (G2). Examples are synthetic wordings (design 6.10), checked against the local
 * index when it is present. The behavior is in edh-top-7-scenarios.test.ts. CR cites are from the Comprehensive Rules text of 2026-09-25 (media.wizards.com), read in the session.
 */
import { describe, expect, it } from 'vitest';
import type { OracleCard } from '../../../src/index';
import type { Template } from '../../../src/parser/types';
import { defaultParseOptions, parseCard } from '../../../src/parser/parse';
import { validateTemplates } from '../../../src/parser/chart';
import { TEMPLATE_FILES, TEMPLATE_SET } from '../../../src/parser/template-set';
import { ENGINE_CAPABILITIES } from '../../../src/model/capabilities';
import edhTop7 from '../../../src/parser/templates/zz-cloud/edh-top-7.json';
import review from '../../m5/golden/cards/edh-top-7-review.json';
import { automated, bare, card, fullyAutomated, jsonKey } from '../../m5/templates/support';
import { localIndex } from '../../m5/parser/support';

const MECH = edhTop7 as Template[];
const MECH_COUNT = 2;
/**
 * design 6.9 deviation (docs/CARD_AUTOMATION.md section 5, "Narrow wordings"): templates made stable on fewer than three golden cards because Oracle prints the wording on one card (of the EDHREC top
 * 5,000) only, with their template tests (G9, G2) and played scenarios. Listed in the round's record for the owner (standing rule 2026-10-27, recommendation: accept).
 */
const NARROW: Readonly<Record<string, readonly string[]>> = {
  'eff.edht7.dur.ownerMayCast': ['Aerial Extortionist'],
  'eff.edht7.thenIf.counters.mayRemoveTransform': ['Primal Amulet // Primal Wellspring'],
};
const OPTS = defaultParseOptions({ templates: [...TEMPLATE_SET], capabilities: ENGINE_CAPABILITIES }); // what a decklist card gets (design 5.2; `needs`)

/** A synthetic card with the example as its ability: a triggered or activated line on an artifact or a creature, else a sorcery. */
const parsedWith = (_t: Template, text: string) =>
  parseCard(/^\{/.test(text) ? card('Example Plan', 'Artifact', text) : /^(When|At the|Whenever)/.test(text) ? card('Example Plan', 'Creature — Pirate', text, { power: '3', toughness: '3' } as Partial<OracleCard>) : card('Example Plan', 'Sorcery', text), OPTS).faces[0]!;

describe('edh-top-7 template file (design 6.3, 6.9; CONTRIBUTING "Adding a template")', () => {
  it('is loaded by the default compiler (zz-cloud/edh-top-7.json, path order: after edh-top-6) and its ids are unique in the whole set', () => {
    const files = TEMPLATE_FILES.map((f) => f.file);
    expect(files).toContain('zz-cloud/edh-top-7.json');
    expect(files.indexOf('zz-cloud/edh-top-7.json')).toBeGreaterThan(files.indexOf('zz-cloud/edh-top-6.json'));
    const ids = TEMPLATE_SET.map((t) => t.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(validateTemplates([...TEMPLATE_SET])).toEqual([]);
  });
  it('design 6.9: every template cites rules, has at least two examples and two counter-examples, a status, and is of version 8; ids are *.edht7.*', () => {
    expect(MECH.length).toBe(MECH_COUNT);
    for (const t of MECH) {
      expect(t.id, t.id).toMatch(/^(eff|sta|rep|trg|rid)\.edht7\./);
      expect(t.cr.length, t.id).toBeGreaterThan(0);
      for (const cr of t.cr) expect(cr, t.id).toMatch(/^CR \d{3}(\.\d+[a-z]?)?$/);
      expect(t.examples.length, t.id).toBeGreaterThanOrEqual(2);
      expect(t.counterExamples.length, t.id).toBeGreaterThanOrEqual(2);
      expect(['stable', 'experimental'], t.id).toContain(t.status);
      expect(t.since, t.id).toBe(8);
    }
  });
  it('design 6.9: a stable template has its evidence: three or more hand-verified golden cards, or (a recorded deviation) the cards that print the wording', () => {
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

describe('edh-top-7 guard G9 (design 6.8): examples and counter-examples', () => {
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
  const swaps: [RegExp, string][] = [
    [/\bits owner\b/, 'its controller'], [/\bmay cast\b/, 'may play'], [/\bfor as long as that card remains exiled\b/i, 'until end of turn'], [/\bfour or more\b/, 'four or fewer'], [/\bthree or more\b/, 'three or fewer'],
    [/\bremove those counters\b/, 'remove a counter'], [/\btransform it\b/, 'sacrifice it'], [/\byou may remove\b/, 'you may put'],
  ];
  for (const [re, by] of swaps) if (re.test(text)) out.push(text.replace(re, by));
  return out;
}

describe('edh-top-7 guard G9 (design 6.8): near-miss mutations fail or differ', () => {
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

describe('edh-top-7 guard G2 (design 6.8): a nonsense word never leaves an automated card', () => {
  for (const t of MECH) {
    it(`${t.id}: replacing any one word of an example by an invented word makes the card not fully automated`, () => {
      for (const e of t.examples) {
        const words = e.text.split(' ');
        words.forEach((w, i) => {
          if (/^"?~/.test(w) || /^\{/.test(w)) return;
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

describe.skipIf(index === null)('edh-top-7 design 6.10 (local index): synthetic examples', () => {
  it('no edh-top-7 line of an example or counter-example is a line of a real card (with the card\'s own name or "this <type>" read as "~")', () => {
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

const sorcery = (text: string) => parseCard(card('Example Plan', 'Sorcery', text), OPTS).faces[0]!;
const creature = (text: string) => parseCard(card('Example Plan', 'Creature — Pirate', text, { power: '3', toughness: '3' } as Partial<OracleCard>), OPTS).faces[0]!;
const artifact = (text: string) => parseCard(card('Example Plan', 'Artifact', text), OPTS).faces[0]!;

describe('edh-top-7 parser and renderer changes (one test each)', () => {
  it('parser/lower/scope.ts: in "When you cast this spell", "that creature" / "that card" is the target or the exiled card, never the spell (a spell on the stack is no creature or card); "that spell" and a bare "it" still name it', () => {
    const t = creature('When you cast this spell, gain control of target creature until end of turn. Untap that creature.');
    expect(fullyAutomated(t)).toBe(true);
    expect(JSON.stringify(t.abilities)).toContain('"op":"untap","what":{"ref":"target","id":"t0"}');
    // the spell is still named by "copy it" (Sage of the Skies' shape) and by "that spell"
    expect(fullyAutomated(creature("When you cast this spell, if you've cast another spell this turn, copy it."))).toBe(true);
    // fail closed: with no target or step to mean, "that creature" in a cast trigger is not the spell
    expect(fullyAutomated(creature('When you cast this spell, untap that creature.'))).toBe(false);
    // other cast triggers keep the spell as a candidate of "that creature" (a creature spell was cast): unchanged, not automated
    expect(fullyAutomated(creature('Whenever you cast a creature spell, gain control of target creature until end of turn. Untap that creature.'))).toBe(false);
  });
  it('parser/lower/ability.ts and render/np.ts: "with lesser mana value" in the effect of a cast trigger is a mana value lower than the cast spell\'s (the role spell); in an enters trigger it stays the entering permanent\'s', () => {
    const cast = creature('Whenever you cast a spell, exile cards from the top of your library until you exile a nonland card with lesser mana value. You may cast that card without paying its mana cost.');
    expect(fullyAutomated(cast)).toBe(true);
    expect(JSON.stringify(cast.abilities)).toContain('"op":"<","value":{"q":"stat","stat":"manaValue","of":{"ref":"event","role":"spell"}}');
    const dies = creature('When ~ dies, return target creature card with lesser mana value from your graveyard to your hand.');
    expect(fullyAutomated(dies)).toBe(true);
    expect(JSON.stringify(dies.abilities)).toContain('"role":"subject"');
    // a spell has no event: nothing for "lesser" to compare with
    expect(fullyAutomated(sorcery('Exile cards from the top of your library until you exile a nonland card with lesser mana value.'))).toBe(false);
  });
  it('render/steps-zones.ts: "Put the rest on the bottom of your library in a random order" after your own exile-until is an alt of the plain move; after another player\'s exile-until the older wording is unchanged', () => {
    const own = sorcery('Exile cards from the top of your library until you exile a nonland card. You may cast that card without paying its mana cost. Put the rest on the bottom of your library in a random order.');
    expect(fullyAutomated(own)).toBe(true);
    const wrong = sorcery('Exile cards from the top of your library until you exile a nonland card. You may cast that card without paying its mana cost. Put the rest on the bottom of target opponent\'s library in a random order.');
    expect(fullyAutomated(wrong)).toBe(false);
  });
  it('model/focus.ts#shufflesYourLibrary, parser/lower/anaphora.ts, render/steps.ts: after "..., exile it face down, then shuffle." the next sentence\'s bare "it" is the exiled card; a shuffle of another player\'s library does not keep the focus', () => {
    const ok = creature('When ~ enters, search your library for a card, exile it face down, then shuffle. For as long as that card remains exiled, you may play it.');
    expect(fullyAutomated(ok)).toBe(true);
    expect(JSON.stringify(ok.abilities)).toContain('"action":"play","of":{"is":{"ref":"bound"');
    expect(fullyAutomated(creature('When ~ enters, search your library for a card, exile it face down, then target player shuffles. For as long as that card remains exiled, you may play it.'))).toBe(false);
  });
  it('parser/holes/qty.ts#spellsYouCast: "the number of / for each instant and sorcery spell(s) you\'ve cast this turn" counts your casts of the turn of those types; any other description (a controller, a subtype, a zone) is not read', () => {
    const n = sorcery("Draw X cards, where X is the number of instant and sorcery spells you've cast this turn.");
    expect(fullyAutomated(n)).toBe(true);
    expect(JSON.stringify(n.abilities)).toContain('"event":{"ev":"cast","player":"you","spell":{"types":["Instant","Sorcery"]}}');
    expect(fullyAutomated(sorcery("Draw a card for each instant and sorcery spell you've cast this turn."))).toBe(true);
    expect(fullyAutomated(sorcery("Draw a card for each noncreature spell you've cast this turn."))).toBe(true);
    expect(fullyAutomated(sorcery("Draw X cards, where X is the number of instant spells your opponents have cast this turn."))).toBe(false);
    expect(fullyAutomated(sorcery("Draw X cards, where X is the number of Wizard spells you've cast this turn."))).toBe(false);
  });
  it('render/steps-zones.ts: "Create X tokens that are copies of ..., where X is ..." says a computed number of copies with X (tapped or attacking copies and copies with exceptions keep their older wording)', () => {
    const ok = sorcery('Create X tokens that are copies of target creature you control, where X is the number of creatures you control.');
    expect(fullyAutomated(ok)).toBe(true);
    const trig = creature("At the beginning of combat on your turn, create X tokens that are copies of another target creature you control, where X is one plus the number of instant and sorcery spells you've cast this turn. They gain haste.");
    expect(fullyAutomated(trig)).toBe(true);
    expect(fullyAutomated(sorcery('Create X tokens that are copies of target creature you control, where Y is the number of creatures you control.'))).toBe(false);
  });
  it('parser/holes/event.ts and render/evt.ts: "another player" in an event is an opponent of the controller; "a player" and "you" are unchanged', () => {
    const t = creature('Whenever another player casts a spell from anywhere other than their hand, draw a card.');
    expect(fullyAutomated(t)).toBe(true);
    expect(JSON.stringify(t.abilities)).toContain('"ev":"cast","player":"opponent"');
    expect(fullyAutomated(creature('Whenever another player draws a card, you draw a card.'))).toBe(true);
    expect(fullyAutomated(creature('Whenever another player casts a spell from anywhere other than your hand, draw a card.'))).toBe(false);
  });
  it('render/steps-flow.ts#mayRemoveTransform: "you may remove those counters and transform it" is said only for the optional removal of all counters of the kind counted and the transformation of the same object', () => {
    expect(fullyAutomated(artifact('{T}: Put a charge counter on ~. Then if there are four or more charge counters on it, you may remove those counters and transform it.'))).toBe(true);
    expect(fullyAutomated(artifact('{T}: Put a charge counter on ~. Then if there are four or more charge counters on it, you may remove those counters and draw a card.'))).toBe(false);
    expect(fullyAutomated(artifact('{T}: Put a charge counter on ~. Then if there are four or more charge counters on it, remove those counters and transform it.'))).toBe(true); // (the older, not optional wording, is unchanged)
  });
});

describe('edh-top-7 promotion: eff.pcep1.cast.obj.durFirst.anyColor (narrow wording, a 6.9 deviation named in the record)', () => {
  it('is stable on Grenzo, Havoc Raiser (golden entry) and the Grenzo wording is fully automated', () => {
    const t = TEMPLATE_SET.find((x) => x.id === 'eff.pcep1.cast.obj.durFirst.anyColor')!;
    expect(t.status).toBe('stable');
    expect((review as { card: string; verified: string }[]).filter((g) => g.verified.includes(' eff.pcep1.cast.obj.durFirst.anyColor,')).map((g) => g.card)).toEqual(['Grenzo, Havoc Raiser']);
    expect(fullyAutomated(sorcery('Exile the top card of target opponent\'s library. Until end of turn, you may cast that card and you may spend mana as though it were mana of any color to cast that spell.'))).toBe(true);
  });
});
