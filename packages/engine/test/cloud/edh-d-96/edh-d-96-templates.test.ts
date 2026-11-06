/**
 * Commander coordinator D, round edh-d-96 (MUST-FINISH, EDHREC band 5,001-10,000, group graveyard-exile-cast part 1): the template data of parser/templates/zz-cloud/edh-d-96.json (see the file) and the round's parser, lowering,
 * engine and renderer changes, tested at the end of this file and in edh-d-96-scenarios.test.ts.
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
import edhD96 from '../../../src/parser/templates/zz-cloud/edh-d-96.json';
import review from '../../m5/golden/cards/edh-d-96-review.json';
import { automated, bare, card, fullyAutomated, jsonKey } from '../../m5/templates/support';
import { localIndex } from '../../m5/parser/support';

const MECH = edhD96 as Template[];
const MECH_COUNT = 11;
/**
 * design 6.9 deviation (docs/CARD_AUTOMATION.md section 5, "Narrow wordings"): templates made stable on fewer than three golden cards because Oracle prints the
 * wording on only one or two cards, with their template tests (G9, G2) and played scenarios. Listed in the round's record for the owner (DECIDED BY DEFAULT,
 * owner instruction 2026-10-21).
 */
const NARROW: Readonly<Record<string, readonly string[]>> = {
  'rid.edhd96.cast.fromGraveyardThisWay.exileInstead': ['Gale, Waterdeep Prodigy'],
  'sta.edhd96.surveil.lookAdditional': ['Enhanced Surveillance'],
  'eff.edhd96.cast.instantSorcery.mvOrLess.free.fromAmong': ['Epic Experiment'],
  'eff.edhd96.exile.ownPerPlayer.opponent.until': ['Intellect Devourer'],
  'sta.edhd96.play.linked.anyColor': ['Intellect Devourer'],
  'eff.edhd96.permit.play.upToN.group.dur': ['March of Reckless Joy'],
  'trg.edhd96.you.scryBottom': ['The Temporal Anchor'],
  'eff.edhd96.exile.n.fromBottom': ['The Temporal Anchor'],
  'sta.edhd96.duringYourTurn.play.linked': ['The Temporal Anchor'],
  'eff.edhd96.forEachOpponentPoison.put.bf.yours': ["Geth's Summons"],
  'eff.edhd96.put.battlefieldOrHand': ['Illuna, Apex of Wishes'],
};
const OPTS = defaultParseOptions({ templates: [...TEMPLATE_SET], capabilities: ENGINE_CAPABILITIES }); // what a decklist card gets (design 5.2; `needs`)

/** A synthetic card with the example as its ability: a static or an activated ability on an artifact creature, a spell otherwise. */
const parsedWith = (t: Template, text: string) => parseCard(
  t.kind === 'static' || text.includes(':') || /^(When|Whenever|At the beginning)/.test(text) || (text.startsWith('~') && !text.includes('as you cast ~')) ? card('Example Relic', 'Artifact Creature — Construct', text, { power: '2', toughness: '2' }) : card('Example Plan', 'Sorcery', text), OPTS).faces[0]!;

describe('edh-d-96 template file (design 6.3, 6.9; CONTRIBUTING "Adding a template")', () => {
  it('is loaded by the default compiler (zz-cloud/edh-d-96.json, path order: after edh-d-9.json, before edh-mana-keywords-1.json) and its ids are unique in the whole set', () => {
    const files = TEMPLATE_FILES.map((f) => f.file);
    expect(files).toContain('zz-cloud/edh-d-96.json');
    expect(files.indexOf('zz-cloud/edh-d-96.json')).toBeGreaterThan(files.indexOf('zz-cloud/edh-d-9.json'));
    const ids = TEMPLATE_SET.map((t) => t.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(validateTemplates([...TEMPLATE_SET])).toEqual([]);
  });
  it('design 6.9: every template cites rules, has at least two examples and two counter-examples, a status, and is of version 96; ids are *.edhd96.*', () => {
    expect(MECH.length).toBe(MECH_COUNT);
    for (const t of MECH) {
      expect(t.id, t.id).toMatch(/^(eff|sta|rep|trg|rst|ch|rid|cm)\.edhd96\./);
      expect(t.cr.length, t.id).toBeGreaterThan(0);
      for (const cr of t.cr) expect(cr, t.id).toMatch(/^CR \d{3}(\.\d+[a-z]?)?$/);
      expect(t.examples.length, t.id).toBeGreaterThanOrEqual(2);
      expect(t.counterExamples.length, t.id).toBeGreaterThanOrEqual(2);
      expect(['stable', 'experimental'], t.id).toContain(t.status);
      expect(t.since, t.id).toBe(96);
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

describe('edh-d-96 guard G9 (design 6.8): examples and counter-examples', () => {
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
  const swaps: [RegExp, string][] = [[/\btwo\b/, 'three'], [/\bthree\b/, 'four'], [/\bbottom\b/, 'top'], [/\bgraveyard\b/, 'hand'], [/\bhand\b/, 'graveyard'], [/\bscrying\b/, 'surveilling'], [/\bopponent\b/, 'player'], [/\bcolor\b/, 'type']];
  for (const [re, by] of swaps) if (re.test(text)) out.push(text.replace(re, by));
  return out;
}

describe('edh-d-96 guard G9 (design 6.8): near-miss mutations fail or differ', () => {
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

/** Does word `i` of the example lie in an ability word, the label before " — " at the start of its line (CR 207.2c)? */
function inLabel(text: string, words: readonly string[], i: number): boolean {
  const at = words.slice(0, i).join(' ').length + (i > 0 ? 1 : 0);
  const lineStart = text.lastIndexOf('\n', at) + 1;
  const dash = text.indexOf(' — ', lineStart);
  const lineEnd = text.indexOf('\n', lineStart);
  return dash >= 0 && (lineEnd < 0 || dash < lineEnd) && at < dash;
}

describe('edh-d-96 guard G2 (design 6.8): a nonsense word never leaves an automated card', () => {
  for (const t of MECH) {
    it(`${t.id}: replacing any one word of an example by an invented word makes the card not fully automated`, () => {
      for (const e of t.examples) {
        const words = e.text.split(' ');
        words.forEach((w, i) => {
          if (/^"?~/.test(w) || /^\{/.test(w)) return;
          if (inLabel(e.text, words, i)) return; // an ability word ("Quiet Hoard — ...") is a label the parser ignores (CR 207.2c): no word of the ability
          const lead = w.match(/^["\n]+/)?.[0] ?? '';
          const end = w.match(/[.,:"\n]+$/)?.[0] ?? '';
          const mutated = [...words.slice(0, i), `${lead}blorfty${end}`, ...words.slice(i + 1)].join(' ');
          expect(fullyAutomated(parsedWith(t, mutated)), mutated).toBe(false);
        });
      }
    }, 120_000);
  }
});

const index = localIndex();

describe.skipIf(index === null)('edh-d-96 design 6.10 (local index): synthetic examples', () => {
  it('no edh-d-96 line of an example or counter-example is a line of a real card (with the card\'s own name or "this <type>" read as "~")', () => {
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

describe('edh-d-96 parser, lowering and renderer changes (one test each)', () => {
  const spell = (text: string) => parseCard(card('Example Plan', 'Sorcery', text), OPTS).faces[0]!;
  const relic = (text: string) => parseCard(card('Example Relic', 'Artifact Creature — Construct', text, { power: '2', toughness: '2' }), OPTS).faces[0]!;
  it('parser/holes/filter.ts "of the other type" (CR 304.1, 307.1): read only in the effect of a cast trigger (the event spell); a dies trigger has no spell, so the sentence stays manual', () => {
    expect(fullyAutomated(relic('Whenever you cast an instant or sorcery spell from your hand, you may cast up to one target card of the other type from your graveyard.'))).toBe(true);
    expect(JSON.stringify(relic('Whenever you cast an instant or sorcery spell from your hand, you may cast up to one target card of the other type from your graveyard.').abilities)).toContain('"quality":"otherSpellType"');
    expect(fullyAutomated(relic('Whenever a creature dies, you may cast up to one target card of the other type from your graveyard.'))).toBe(false);
    // review edh-d-96: after a cast trigger on spells other than "an instant or sorcery spell" the words mean another quality: no reading leaves it full
    expect(fullyAutomated(relic('Whenever you cast a creature or artifact spell, you may return up to one target card of the other type from your graveyard to your hand.'))).toBe(false);
    expect(fullyAutomated(relic('Whenever you cast a spell, you may return up to one target card of the other type from your graveyard to your hand.'))).toBe(false);
  });
  it('render/steps-zones.ts#graveyardInsteadText (CR 614.1a): "a spell cast from your graveyard this way" only after a cast of a target card in your graveyard; after a cast from exile it is no wording', () => {
    expect(fullyAutomated(relic('When ~ enters, you may cast target sorcery card from your graveyard. If a spell cast from your graveyard this way would be put into your graveyard, exile it instead.'))).toBe(true);
    expect(fullyAutomated(relic('When ~ enters, you may cast target sorcery card in exile. If a spell cast from your graveyard this way would be put into your graveyard, exile it instead.'))).toBe(false);
  });
  it('parser/holes/cond.ts "N or more cards have been exiled with ~" (CR 607.2a; Colfenor\'s Urn ruling 2007-10-01) is the whole-game count (`ever`), "there are N or more cards exiled with ~" the cards still there: two JSONs', () => {
    const ever = relic("Whenever a creature you control dies, you may exile it.\nAt the beginning of the end step, if three or more cards have been exiled with ~, sacrifice it. If you do, return those cards to the battlefield under their owner's control.");
    const now = relic("Whenever a creature you control dies, you may exile it.\nAt the beginning of the end step, if there are three or more cards exiled with ~, sacrifice ~. If you do, return the exiled cards to the battlefield under their owner's control.");
    expect(fullyAutomated(ever)).toBe(true);
    expect(JSON.stringify(ever.abilities)).toContain('"ever":true');
    expect(JSON.stringify(now.abilities)).not.toContain('"ever":true');
  });
  it('parser/lower/mentions.ts (CR 607.2a, 603.4): only the count of the linked cards names ~ and "those cards"; without it "sacrifice it" has no antecedent', () => {
    expect(fullyAutomated(relic('At the beginning of the end step, sacrifice it.'))).toBe(false);
  });
  it('parser/holes/object.ts "target spell, nonland permanent, or card in a graveyard" (CR 115.1): one target of three kinds; with words after it (they would hold for one kind only) no reading', () => {
    const f = spell('Exile target spell, nonland permanent, or card in a graveyard.');
    expect(JSON.stringify(f.abilities)).toContain('"zone":["stack","battlefield","graveyard"]');
    expect(fullyAutomated(spell('The owner of target spell, nonland permanent, or card in a graveyard puts it on their choice of the top or bottom of their library.'))).toBe(true);
    expect(fullyAutomated(spell('The owner of target spell, nonland permanent, or card in a graveyard you control puts it on their choice of the top or bottom of their library.'))).toBe(false);
  });
  it('parser/holes/object.ts "all cards exiled this way that weren\'t cast" (CR 608.2c): only after a cast of the chosen cards; after a choice put into your hand it has no antecedent', () => {
    expect(fullyAutomated(spell("Exile the top four cards of your library. You may cast any number of spells with mana value 2 or less from among them without paying their mana costs. Then put all cards exiled this way that weren't cast into your graveyard."))).toBe(true);
    expect(fullyAutomated(spell("Exile the top four cards of your library. Put a card from among them into your hand. Then put all cards exiled this way that weren't cast into your graveyard."))).toBe(false);
  });
  it('render/stat.ts (CR 601.3): a permission for up to N cards is said "you may play up to two of those cards"; "one" is no such permission (no reading leaves it full)', () => {
    expect(fullyAutomated(spell('Exile the top four cards of your library. You may play up to one of those cards until the end of your next turn.'))).toBe(false);
  });
  it('parser/holes/object.ts#poisonOppTarget (CR 601.2c, 122.1f): only after the words "who has N or more poison counters as you cast ~ , put"; other words before the target are not this hole', () => {
    expect(JSON.stringify(spell("For each opponent who has three or more poison counters as you cast ~, put up to one target creature card from that player's graveyard onto the battlefield under your control.").abilities)).toContain('"perOpponentPoison":3');
    expect(fullyAutomated(spell("For each opponent who has three or more cards in hand as you cast ~, put up to one target creature card from that player's graveyard onto the battlefield under your control."))).toBe(false);
  });
  it('render/evt.ts (CR 701.22a): the scryBottom event is said only of "you", in the present; render/fold-edhd96.ts: "into your hand" is the hand of the player who puts it', () => {
    expect(fullyAutomated(relic('Whenever you choose to put one or more cards on the bottom of your library while scrying, draw a card.'))).toBe(true);
    expect(fullyAutomated(relic('Whenever an opponent chooses to put one or more cards on the bottom of their library while scrying, draw a card.'))).toBe(false);
    expect(fullyAutomated(spell('Exile cards from the top of your library until you exile a creature card. Put that card onto the battlefield or into your hand.'))).toBe(true);
  });
});
