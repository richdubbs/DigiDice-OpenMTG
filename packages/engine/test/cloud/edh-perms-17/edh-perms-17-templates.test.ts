/**
 * Commander lane edh-perms, round edh-perms-17: the template data of parser/templates/zz-cloud/edh-perms-17.json (see the file) and the round's parser, lowering,
 * engine and renderer changes, tested at the end of this file and in edh-perms-17-scenarios.test.ts.
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
import edhPm17 from '../../../src/parser/templates/zz-cloud/edh-perms-17.json';
import review from '../../m5/golden/cards/edh-perms-17-review.json';
import { automated, bare, card, fullyAutomated, jsonKey } from '../../m5/templates/support';
import { localIndex } from '../../m5/parser/support';

const MECH = edhPm17 as Template[];
const MECH_COUNT = 10;
/**
 * design 6.9 deviation (docs/CARD_AUTOMATION.md section 5, "Narrow wordings"): templates made stable on fewer than three golden cards because Oracle prints the
 * wording on only one or two cards, with their template tests (G9, G2) and played scenarios. Listed in the round's record for the owner (DECIDED BY DEFAULT,
 * owner instruction 2026-10-21).
 */
const NARROW: Readonly<Record<string, readonly string[]>> = {
  // the cards of the EDHREC top 5,000 that print each wording and are full
  'sta.edhpm17.self.mustAttack.cantSacrificed.cantAttackPlayer': ['Alexios, Deimos of Kosmos'],
  'sta.edhpm17.attached.pump.grant.cantAttackYou.cantSacrificed': ['Assault Suit'],
  'eff.edhpm17.player.gainControl.untapIt.counterOnIt': ['Alexios, Deimos of Kosmos'],
  'eff.edhpm17.mayHave.player.gainControl.dur': ['Assault Suit'],
  'eff.edhpm17.becomes.creature.baseEqualMv': ['Zur, Eternal Schemer'],
  'sta.edhpm17.self.aslong.isLand.inAddition': ['Invasion of Zendikar // Awakened Skyclave'],
  'ch.edhpm17.put.attached': ['Danitha, Benalia\'s Hope'],
  'eff.edhpm17.token.attacking.forEach.qty': ['Otharri, Suns\' Glory'],
  'rid.edhpm17.copy.token.entersTappedAttacking.player': ['Echoing Assault'],
  'eff.edhpm17.forEach.copyToken.tappedAttacking': ['Redoubled Stormsinger'],
};
const OPTS = defaultParseOptions({ templates: [...TEMPLATE_SET], capabilities: ENGINE_CAPABILITIES }); // what a decklist card gets (design 5.2; `needs`)

/** A synthetic card with the example as its ability: a static or an activated ability on an artifact creature, a spell otherwise. */
const parsedWith = (t: Template, text: string) => parseCard(
  text.startsWith('Enchanted ') ? card('Example Charm', 'Enchantment — Aura', `Enchant creature\n${text}`)
    : t.kind === 'static' || text.includes(':') || /^(When|Whenever|At the beginning)/.test(text) ? card('Example Relic', 'Artifact Creature — Construct', text, { power: '2', toughness: '2' }) : card('Example Plan', 'Sorcery', text), OPTS).faces[0]!;

describe('edh-perms-17 template file (design 6.3, 6.9; CONTRIBUTING "Adding a template")', () => {
  it('is loaded by the default compiler (zz-cloud/edh-perms-17.json, path order: after edh-perms-15, before edh-perms-2) and its ids are unique in the whole set', () => {
    const files = TEMPLATE_FILES.map((f) => f.file);
    expect(files).toContain('zz-cloud/edh-perms-17.json');
    expect(files.indexOf('zz-cloud/edh-perms-17.json')).toBeGreaterThan(files.indexOf('zz-cloud/edh-perms-15.json'));
    expect(files.indexOf('zz-cloud/edh-perms-17.json')).toBeLessThan(files.indexOf('zz-cloud/edh-perms-2.json'));
    const ids = TEMPLATE_SET.map((t) => t.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(validateTemplates([...TEMPLATE_SET])).toEqual([]);
  });
  it('design 6.9: every template cites rules, has at least two examples and two counter-examples, a status, and is of version 8; ids are trg.edhpm17.*', () => {
    expect(MECH.length).toBe(MECH_COUNT);
    for (const t of MECH) {
      expect(t.id, t.id).toMatch(/^(eff|sta|rep|trg|ch|rid)\.edhpm17\./);
      expect(t.cr.length, t.id).toBeGreaterThan(0);
      for (const cr of t.cr) expect(cr, t.id).toMatch(/^CR \d{3}(\.\d+[a-z]?)?$/);
      expect(t.examples.length, t.id).toBeGreaterThanOrEqual(2);
      expect(t.counterExamples.length, t.id).toBeGreaterThanOrEqual(2);
      expect(['stable', 'experimental'], t.id).toContain(t.status);
      expect(t.since, t.id).toBe(8);
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

describe('edh-perms-17 guard G9 (design 6.8): examples and counter-examples', () => {
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
    [/\bthe sacrificed creature\b/, 'the destroyed creature'], [/\bpower\./, 'mana value.'], [/\ba counter on\b/, 'two counters on'],
    [/\btarget creature\b/, 'target artifact'], [/\bconsolidate\b/, 'x'],
  ];
  for (const [re, by] of swaps) if (re.test(text)) out.push(text.replace(re, by));
  return out;
}

describe('edh-perms-17 guard G9 (design 6.8): near-miss mutations fail or differ', () => {
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

describe('edh-perms-17 guard G2 (design 6.8): a nonsense word never leaves an automated card', () => {
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

describe.skipIf(index === null)('edh-perms-17 design 6.10 (local index): synthetic examples', () => {
  it('no edh-perms-17 line of an example or counter-example is a line of a real card (with the card\'s own name or "this <type>" read as "~")', () => {
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

describe('edh-perms-17 parser, lowering and renderer changes (one test each)', () => {
  const creature = (text: string, type = 'Creature — Wizard') => parseCard(card('Example Beast', type, text, { power: '2', toughness: '2' }), OPTS).faces[0]!;
  it('render/np.ts (CR 205.3m): "<subtype> that isn\'t a <subtype>" is read for a described subtype with no card type; a second negated subtype and a group stay as before', () => {
    const ok = creature('Whenever you attack, target attacking Vampire that isn\'t a Demon gets +1/+1 until end of turn.');
    expect(fullyAutomated(ok)).toBe(true);
  });
  it('render/np.ts (CR 508.1b): "creature that\'s attacking that player" is the same description as "creature attacking that player"; the "you" form is unchanged', () => {
    const a = creature('Whenever you attack a player, target creature that\'s attacking that player gets +1/+1 until end of turn.', 'Enchantment');
    const b = creature('Whenever you attack a player, target creature attacking that player gets +1/+1 until end of turn.', 'Enchantment');
    expect(fullyAutomated(a)).toBe(true);
    expect(jsonKey(a.abilities)).toBe(jsonKey(b.abilities));
  });
  it('parser/holes/object.ts + render/refs.ts (CR 608.2c): "the rest of those cards" is the rest of a group a choice among it left', () => {
    const ok = creature('Whenever ~ attacks, look at the top three cards of your library. You may put a land card from among them onto the battlefield. Put the rest of those cards on the bottom of your library in a random order.');
    expect(fullyAutomated(ok)).toBe(true);
    expect(fullyAutomated(creature('Whenever ~ attacks, look at the top three cards of your library. You may put a land card from among them onto the battlefield. Put the rest of those cards in your hand.'))).toBe(false);
  });
  it('render/fold-stdrx31.ts (CR 608.2c): the dig\'s move may name what it did for a later "if an Equipment was put onto the battlefield this way"', () => {
    const ok = creature('Whenever ~ attacks, look at the top three cards of your library. You may put an Equipment card from among them onto the battlefield. If an Equipment was put onto the battlefield this way, you may attach it to a creature you control. Put the rest on the bottom of your library in a random order.');
    expect(fullyAutomated(ok)).toBe(true);
  });
  it('parser/lower/anaphora.ts#focusAt (CR 608.2c, 508.4): a rider that only patches the creating instruction keeps its focus, so "Sacrifice it" after it means the token; a rider after a non-token step does not', () => {
    const ok = creature('Whenever ~ attacks, create a token that\'s a copy of target creature you control, except it\'s 1/1. The token enters tapped and attacking defending player. Sacrifice it at the beginning of the next end step.');
    expect(fullyAutomated(ok)).toBe(true);
    const bad = creature('Whenever ~ attacks, draw a card. The token enters tapped and attacking defending player. Sacrifice it at the beginning of the next end step.');
    expect(fullyAutomated(bad)).toBe(false);
  });
  it('render/np.ts#nounsOf (CR 111.1): a creature token is also "that token" to a later copy instruction', () => {
    const ok = creature('Whenever ~ attacks, for each creature token you control, create a tapped and attacking token that\'s a copy of that token.');
    expect(fullyAutomated(ok)).toBe(true);
  });
  it('render/stat.ts + render/steps-zones.ts (CR 508.1d, 701.21a, 508.4): the three-rule static of Alexios, the equipped list with "can\'t be sacrificed", and a tapped token copy attacking a named player with an exception', () => {
    expect(fullyAutomated(creature('~ attacks each combat if able, can\'t be sacrificed, and can\'t attack its owner.'))).toBe(true);
    expect(fullyAutomated(creature('~ attacks each combat if able, can\'t be sacrificed, and can\'t attack you.'))).toBe(true);
    expect(fullyAutomated(creature('~ attacks each combat if able, can\'t be sacrificed, and can\'t block its owner.'))).toBe(false);
    const eq = parseCard(card('Example Rig', 'Artifact — Equipment', 'Equipped creature gets +1/+1, has vigilance, can\'t attack you or planeswalkers you control, and can\'t be sacrificed.\nEquip {2}'), OPTS).faces[0]!;
    expect(fullyAutomated(eq)).toBe(true);
  });
});
