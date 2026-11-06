/**
 * Commander coordinator D, round edh-d-85 (EDHREC ranks 5,001-10,000, group combat): the template data of parser/templates/zz-cloud/edh-d-85.json (see the file) and the round's parser, lowering,
 * engine and renderer changes, tested at the end of this file and in edh-d-85-scenarios.test.ts.
 * Guard G9 (design 6.8): every example lowers with its template, is automated and passes the exact render gate (G6); every counter-example does not parse or
 * parses to different JSON; near-miss mutations fail or differ; a nonsense word in place of any word of an example never leaves an automated card (G2). Examples
 * are synthetic wordings (design 6.10), checked against the local index when it is present. CR cites checked against the Comprehensive Rules of 2026-09-25.
 */
import { describe, expect, it } from 'vitest';
import type { OracleCard } from '../../../src/index';
import type { Template } from '../../../src/parser/types';
import { defaultParseOptions, parseCard } from '../../../src/parser/parse';
import { validateTemplates } from '../../../src/parser/chart';
import { TEMPLATE_FILES, TEMPLATE_SET } from '../../../src/parser/template-set';
import { ENGINE_CAPABILITIES } from '../../../src/model/capabilities';
import edhD85 from '../../../src/parser/templates/zz-cloud/edh-d-85.json';
import review from '../../m5/golden/cards/edh-d-85-review.json';
import { automated, bare, card, fullyAutomated, jsonKey } from '../../m5/templates/support';
import { localIndex } from '../../m5/parser/support';

const index = localIndex();

const MECH = edhD85 as Template[];
const MECH_COUNT = 9;
/**
 * design 6.9 deviation (docs/CARD_AUTOMATION.md section 5, "Narrow wordings"): templates made stable on fewer than three golden cards because Oracle prints the
 * wording on only one or two cards, with their template tests (G9, G2) and played scenarios. Listed in the round's record for the owner (DECIDED BY DEFAULT,
 * owner instruction 2026-10-21).
 */
const NARROW: Readonly<Record<string, readonly string[]>> = {
  // the cards of the EDHREC top 20,000 that print each wording and are full (each the only card of the index that prints it)
  'eff.edhd85.dur.gains.ifCond.andIfCond': ['Doors of Durin'],
  'rep.edhd85.dies.insteadExile.putCounterOnIt': ['Ravenloft Adventurer'],
  'eff.edhd85.dur.lead.grant.andItCantBeBlocked': ['Blitzball Stadium'],
  'eff.edhd85.eachPlayer.draws.damageToSelfBySourcesTheyControlled': ['Grothama, All-Devouring'],
  'eff.edhd85.return.bf.underTheirControl.withCounter': ['Immortal Obligation'],
  'eff.edhd85.dur.isGoaded.cantAttackYouOrYours.cantBlockYours': ['Immortal Obligation'],
  'eff.edhd85.they.get.additional': ['Motivated Pony'],
  'sta.edhd85.self.attacksMostLifeOpponent.unlessYouControlNamed': ['Galactus, Devourer of Worlds'],
  'eff.edhd85.mayExileAnyNumber.fourCardTypes.ifDo.putFromAmongWithCounter': ['Winter, Cynical Opportunist'],
};
const OPTS = defaultParseOptions({ templates: [...TEMPLATE_SET], capabilities: ENGINE_CAPABILITIES }); // what a decklist card gets (design 5.2; `needs`)

/** A synthetic card with the example as its ability: a static or an activated ability on an artifact creature, a spell otherwise. */
const parsedWith = (t: Template, text: string) => parseCard(
  t.kind === 'static' || text.includes(':') || /^(When|Whenever|At the beginning)/.test(text) || (text.startsWith('~') && !text.includes('as you cast ~')) ? card('Example Relic', 'Artifact Creature — Construct', text, { power: '2', toughness: '2' }) : card('Example Plan', 'Sorcery', text), OPTS).faces[0]!;

describe('edh-d-85 template file (design 6.3, 6.9; CONTRIBUTING "Adding a template")', () => {
  it('is loaded by the default compiler (zz-cloud/edh-d-85.json, listed after edh-d-8.json, before edh-d-9.json) and its ids are unique in the whole set', () => {
    const files = TEMPLATE_FILES.map((f) => f.file);
    expect(files).toContain('zz-cloud/edh-d-85.json');
    expect(files.indexOf('zz-cloud/edh-d-85.json')).toBeGreaterThan(files.indexOf('zz-cloud/edh-d-8.json'));
    expect(files.indexOf('zz-cloud/edh-d-85.json')).toBeLessThan(files.indexOf('zz-cloud/edh-d-9.json'));
    const ids = TEMPLATE_SET.map((t) => t.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(validateTemplates([...TEMPLATE_SET])).toEqual([]);
  });
  it('design 6.9: every template cites rules, has at least two examples and two counter-examples, a status, and is of version 9; ids are *.edhd85.*', () => {
    expect(MECH.length).toBe(MECH_COUNT);
    for (const t of MECH) {
      expect(t.id, t.id).toMatch(/^(eff|sta|rep|trg|rst|ch|rid|cm)\.edhd85\./);
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

describe('edh-d-85 guard G9 (design 6.8): examples and counter-examples', () => {
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
  const swaps: [RegExp, string][] = [[/\bcreature\b/, 'land'], [/\bfour\b/, 'five'], [/\bopponent\b/, 'player'], [/\bmost\b/, 'least']];
  for (const [re, by] of swaps) if (re.test(text)) out.push(text.replace(re, by));
  return out;
}

describe('edh-d-85 guard G9 (design 6.8): near-miss mutations fail or differ', () => {
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

describe('edh-d-85 guard G2 (design 6.8): a nonsense word never leaves an automated card', () => {
  for (const t of MECH) {
    it(`${t.id}: replacing any one word of an example by an invented word makes the card not fully automated`, () => {
      for (const e of t.examples) {
        const words = e.text.split(' ');
        words.forEach((w, i) => {
          if (/^"?~/.test(w) || /^\{/.test(w)) return;
          if (/^counters?[.,]?$/.test(words[i + 1] ?? '')) return; // a counter kind is any word (CR 122.1b: a counter with a name no rule defines is allowed)
          const lead = w.match(/^["\n]+/)?.[0] ?? '';
          const end = w.match(/[.,:"\n]+$/)?.[0] ?? '';
          const mutated = [...words.slice(0, i), `${lead}blorfty${end}`, ...words.slice(i + 1)].join(' ');
          expect(fullyAutomated(parsedWith(t, mutated)), mutated).toBe(false);
        });
      }
    }, 120_000);
  }
});


describe.skipIf(index === null)('edh-d-85 design 6.10 (local index): synthetic examples', () => {
  it('no edh-d-85 line of an example or counter-example is a line of a real card (with the card\'s own name or "this <type>" read as "~")', () => {
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

describe('edh-d-85 changes outside the templates (one test each)', () => {
  const relic = (text: string, type = 'Artifact Creature — Construct') => parseCard(card('Example Relic', type, text, { power: '2', toughness: '2' }), OPTS).faces[0]!;
  const spellOf = (text: string) => parseCard(card('Example Plan', 'Sorcery', text), OPTS).faces[0]!;
  it('eff.put.bf.attacking is stable (design 6.9 deviation, one golden card: Doors of Durin, the only card of the index that prints the wording)', () => {
    const t = TEMPLATE_SET.find((x) => x.id === 'eff.put.bf.attacking')!;
    expect(t.status).toBe('stable');
    expect((review as { card: string; verified: string }[]).some((g) => g.card === 'Doors of Durin' && g.verified.includes('(eff.put.bf.attacking'))).toBe(true);
  });
  it('parser/holes/vocab.ts (CR 122.1): "hit" and "duty" are counter kinds', () => {
    expect(fullyAutomated(relic('{T}: Put a hit counter on target creature.'))).toBe(true);
    expect(fullyAutomated(relic('{T}: Put a duty counter on target creature.'))).toBe(true);
    expect(JSON.stringify(relic('{T}: Put a hit counter on target creature.').abilities)).toContain('"kind":"hit"');
  });
  it('parser/holes/qty.ts, render/qty.ts (CR 122.1): "for each kind of counter on <it>" is the kinds of counter on one object; "for each counter on it" stays the plain count', () => {
    const f = relic('Whenever this creature deals combat damage to a player, draw a card for each kind of counter on it.');
    expect(fullyAutomated(f)).toBe(true);
    expect(JSON.stringify(f.abilities)).toContain('"what":"counterKinds"');
    expect(JSON.stringify(relic('Whenever this creature deals combat damage to a player, draw a card for each counter on it.').abilities)).not.toContain('counterKinds');
  });
  it('parser/holes/cond.ts, effects/eval.ts (CR 506.1, 508.1): "if that player attacked you during their last turn" names the event\'s player (cond attackedYouLastTurn with who)', () => {
    const f = relic('Whenever this creature deals combat damage to a player, if that player attacked you during their last turn, draw a card.');
    expect(fullyAutomated(f)).toBe(true);
    expect(JSON.stringify(f.abilities)).toContain('"cond":"attackedYouLastTurn","who":{"ref":"event","role":"recipient"}');
    expect(fullyAutomated(relic('Whenever this creature deals combat damage to a player, if that player attacked you during your last turn, draw a card.'))).toBe(false);
  });
  it('parser/holes/filter.ts, rules/history.ts (CR 701.9a, 400.7): "that was discarded or put there from a library this turn" (putThereFrom discardOrLibrary)', () => {
    const f = relic('Whenever this creature attacks, return up to one target card in a graveyard that was discarded or put there from a library this turn to its owner\'s hand.');
    expect(JSON.stringify(f.abilities)).toContain('"putThereFrom":"discardOrLibrary"');
    expect(JSON.stringify(relic('Whenever this creature attacks, return up to one target card in a graveyard that was discarded or put there from a hand this turn to its owner\'s hand.').abilities)).not.toContain('discardOrLibrary');
  });
  it('parser/lower/conditions.ts (CR 608.2c, 118.12): "If it\'s a <kind> card, you may put it onto the battlefield ... If you don\'t, Z." writes Z on both paths; another "If C, you may X. If you don\'t" is unchanged (not full)', () => {
    const f = relic("Whenever this creature deals combat damage to a player, exile the top card of that player's library. If it's a creature card, you may put it onto the battlefield under your control. If you don't, you gain 3 life.");
    expect(fullyAutomated(f)).toBe(true);
    expect(JSON.stringify(f.abilities)).toContain('"else":[{"op":"gainLife"');
    expect(JSON.stringify(relic('Whenever this creature attacks, if you control a Goblin, you may draw a card. If you don\'t, you gain 3 life.').abilities)).not.toContain('"else":[{"op":"gainLife"');
  });
  it('render/abil.ts (CR 508.1d, 611.3a): an attack requirement under "unless" (statics/requirements.ts reads the opponents with the most life, scenarios)', () => {
    expect(fullyAutomated(relic('This creature attacks an opponent with the most life among your opponents each combat if able unless you control a creature named Grizzly Bears.'))).toBe(true);
  });
});

describe('edh-d-85 render/fold-edhd85.ts#gainsIfAndIf: only a pair of guarded grants', () => {
  it('a run of more than two guarded grants ("The same is true for ...", the same-for expansion) keeps its own reading and stays full', () => {
    const f = parseCard(card('Example Relic', 'Artifact Creature — Construct', 'At the beginning of each combat, this creature gains flying until end of turn if you control a creature with flying. The same is true for first strike and trample.', { power: '2', toughness: '2' }), OPTS).faces[0]!;
    expect(fullyAutomated(f)).toBe(true);
  });
});

describe.skipIf(index === null)('edh-d-85 (local index): the card names that contain the printing card\'s own name', () => {
  it('Galactus, Devourer of Worlds reads "a creature named Silver Surfer, Galactus\'s Herald" (the name of the index), and is full', () => {
    const g = (index ?? []).find((c) => c.name === 'Galactus, Devourer of Worlds');
    if (g === undefined) return;
    const f = parseCard(g as OracleCard, OPTS).faces[0]!;
    expect(fullyAutomated(f)).toBe(true);
    expect(JSON.stringify(f.abilities)).toContain('"name":"Silver Surfer, Galactus\'s Herald"');
    // fail closed: a name with "~" in it that no card of the index has is no name
    const other = parseCard({ ...(g as OracleCard), oracle_text: (g as OracleCard).oracle_text!.replace("Galactus's Herald", "Galactus's Scout") } as OracleCard, OPTS).faces[0]!;
    expect(fullyAutomated(other)).toBe(false);
  }, 120_000);
});
