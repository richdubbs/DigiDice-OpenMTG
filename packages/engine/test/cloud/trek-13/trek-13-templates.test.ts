/**
 * trek-13 (lane trek, Star Trek: Borg and assimilate): the template data of parser/templates/zz-cloud/trek-13.json ("<spells> you cast have replicate {cost}", "the next <spell> you
 * cast this turn has undaunted" and its two-spell wording, "<group> gain protection from the color of your choice <dur>", "for each opponent, assimilate <target card from that
 * player's graveyard>", and Gift of Perfection's three sentences: each player reveals until a card, "assimilate one of the <cards> revealed this way", "then each opponent puts the other
 * cards they revealed this way on the bottom of their library in a random order"), and the round's parser, renderer and engine changes (the trigger event "a creature blocks ~"; a target
 * "from that player's graveyard" for each opponent; the link "the Borg assimilated with ~"; assimilate of a permanent; the reveal-until of several players). Guard G9 (design 6.8): every
 * example lowers with its template, is automated and passes the exact render gate (G6); every counter-example does not parse or parses to different JSON; near-miss mutations fail or
 * differ; a nonsense word in place of any word of an example never leaves an automated card (G2). Examples are synthetic wordings (design 6.10), checked against the local index when it is
 * present. The behavior is in trek-13-scenarios.test.ts. CR cites from memory, unverified (rules/cr/ is not in the cloud checkout); assimilate has no rule number in the 2026-09-25 edition
 * (its reminder text is its rule source).
 */
import { describe, expect, it } from 'vitest';
import type { Template } from '../../../src/parser/types';
import { defaultParseOptions, parseCard } from '../../../src/parser/parse';
import { validateTemplates } from '../../../src/parser/chart';
import { TEMPLATE_FILES, TEMPLATE_SET } from '../../../src/parser/template-set';
import { ENGINE_CAPABILITIES } from '../../../src/model/capabilities';
import trek13 from '../../../src/parser/templates/zz-cloud/trek-13.json';
import ownReview from '../../m5/golden/cards/trek-13-review.json';
import { automated, bare, card, fullyAutomated, jsonKey } from '../../m5/templates/support';
import { localIndex } from '../../m5/parser/support';

const MECH = trek13 as Template[];
const MECH_COUNT = 8;
const review = ownReview as { card: string; verified: string; expect?: string }[];
/**
 * design 6.9 deviation (docs/CARD_AUTOMATION.md section 5, "Narrow wordings"): templates made stable on fewer than three golden cards, accepted by the owner for the Star Trek set
 * (2026-10-24, repeated 2026-10-29), with their template tests (G9, G2) and played scenarios (trek-13-scenarios.test.ts). Each rests on ONE Star Trek golden card, the only card that prints
 * the wording: "Artifact spells you cast have replicate {2}{U}." (Hugh), the two-spell undaunted line (Võx), the group's protection from the color of your choice (Borg Incursion), the
 * per-opponent assimilate of a graveyard card (Assimilate the Wounded) and the three sentences of Gift of Perfection. eff.trek13.nextSpell.has.undaunted (one spell) is printed by no Star
 * Trek card and stays experimental.
 */
const NARROW: Readonly<Record<string, string>> = {
  'sta.trek13.spells.cast.replicate': 'Hugh, First of Many',
  'eff.trek13.nextSpell.two.have.undaunted': 'Võx, Child of the Collective',
  'eff.trek13.group.protection.choice': 'Borg Incursion',
  'eff.trek13.forEachOpponent.assimilate': 'Assimilate the Wounded',
  'eff.trek13.they.revealUntil': 'Gift of Perfection',
  'eff.trek13.assimilate.oneOfRevealed': 'Gift of Perfection',
  'eff.trek13.then.eachOpponent.putOtherBottomRandom': 'Gift of Perfection',
};
const OPTS = defaultParseOptions({ templates: [...TEMPLATE_SET], capabilities: ENGINE_CAPABILITIES }); // what a decklist card gets (design 5.2; `needs`)

/** A synthetic card in which an example is an ability of the right kind: a creature's static or activated ability, a sorcery. */
const parsedWith = (_t: Template, text: string) => {
  if (/^(Artifact|Creature) spells you cast /.test(text) || /^(\{|When )/.test(text)) return parseCard(card('Example Lurker', 'Creature — Human', text, { power: '2', toughness: '2' }), OPTS).faces[0]!;
  return parseCard(card('Example Order', 'Sorcery', text), OPTS).faces[0]!;
};

describe('trek-13 template file (design 6.3, 6.9; CONTRIBUTING "Adding a template")', () => {
  it('is loaded by the default compiler (zz-cloud/trek-13.json, after trek-12.json, before zz-fast1/) and its ids are unique in the whole set', () => {
    const files = TEMPLATE_FILES.map((f) => f.file);
    expect(files).toContain('zz-cloud/trek-13.json');
    expect(files.indexOf('zz-cloud/trek-13.json')).toBeGreaterThan(files.indexOf('zz-cloud/trek-12.json'));
    expect(files.indexOf('zz-cloud/trek-13.json')).toBeLessThan(files.findIndex((f) => f.startsWith('zz-fast1/')));
    const ids = TEMPLATE_SET.map((t) => t.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(validateTemplates([...TEMPLATE_SET])).toEqual([]);
  });
  it('design 6.9: every template cites rules, has at least two examples and two counter-examples, a status, and is of version 9; ids are (eff|rid|sta).trek13.*', () => {
    expect(MECH.length).toBe(MECH_COUNT);
    for (const t of MECH) {
      expect(t.id, t.id).toMatch(/^(eff|rid|sta)\.trek13\./);
      expect(t.cr.length, t.id).toBeGreaterThan(0);
      for (const cr of t.cr) expect(cr, t.id).toMatch(/^CR \d{3}(\.\d+[a-z]?)?$/);
      expect(t.examples.length, t.id).toBeGreaterThanOrEqual(2);
      expect(t.counterExamples.length, t.id).toBeGreaterThanOrEqual(2);
      expect(['stable', 'experimental'], t.id).toContain(t.status);
      expect(t.since, t.id).toBe(9);
    }
    expect(MECH.find((t) => t.id === 'eff.trek13.nextSpell.has.undaunted')?.status).toBe('experimental'); // no Star Trek card prints it
  });
  it('design 6.9: a stable template has its evidence: three or more hand-verified golden cards, or (a recorded deviation) the one card that prints the wording', () => {
    for (const t of MECH.filter((x) => x.status === 'stable')) {
      const cards = review.filter((g) => new RegExp(`[( ]${t.id.replaceAll('.', '\\.')}[,)]`).test(g.verified)).map((g) => g.card);
      expect(NARROW[t.id], `${t.id}: a stable template needs a NARROW entry or three golden cards`).toBeDefined();
      expect(cards, t.id).toContain(NARROW[t.id]);
    }
    for (const g of review) expect(g.expect, g.card).toBe('full');
    for (const g of review) expect(g.verified, g.card).toMatch(/CR \d{3}/);
  });
  it('guard G3: a critical word a pattern spells out is listed in `consumes`', () => {
    for (const t of MECH) {
      const words = t.pattern.toLowerCase().replace(/\{[^}]*:[^}]*\}/g, ' ').split(/[^a-z']+/).filter(Boolean);
      for (const w of ['all', 'each', 'another', 'other', 'may', 'if', 'unless', 'until', 'instead', 'only', 'chosen', 'additional', 'except', "can't", 'would', 'next', 'then', 'during', 'equal']) {
        if (words.includes(w)) expect(t.consumes ?? [], `${t.id}: ${w}`).toContain(w);
      }
    }
  });
});

describe('trek-13 guard G9 (design 6.8): examples and counter-examples', () => {
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
  const out = [`${body} unless it is blue.`, `${body} instead.`, `${body} at random.`, `${body} twice.`, `${body} if able.`, `${body} this turn.`];
  const swaps: [RegExp, string][] = [
    [/\bcast\b/, 'play'], [/\bfrom that player's graveyard\b/, 'from your graveyard'], [/\bbottom\b/, 'top'], [/\bopponent\b/, 'player'], [/\bnext\b/, 'last'],
    [/\brandom\b/, 'any'], [/\breplicate\b/, 'flashback'], [/\bundaunted\b/, 'cascade'], [/\bassimilate\b/, 'exile'], [/\bthis way\b/, 'that way'],
    [/\beach\b/, 'one'], [/\bcreature card\b/, 'creature'], [/\bthey put\b/, 'you put'], [/\breveals\b/, 'exiles'], [/\bgain\b/, 'lose'],
  ];
  for (const [re, by] of swaps) if (re.test(text)) out.push(text.replace(re, by));
  return out;
}

describe('trek-13 guard G9 (design 6.8): near-miss mutations fail or differ', () => {
  for (const t of MECH) {
    it(`${t.id}: an appended "unless/instead/at random/twice/if able/this turn" or a swapped key word never gives the example's JSON`, () => {
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

describe('trek-13 guard G2 (design 6.8): a nonsense word never leaves an automated card', () => {
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

describe.skipIf(index === null)('trek-13 design 6.10 (local index): synthetic examples', () => {
  it('no trek-13 line of an example or counter-example is a line of a real card (with the card\'s own name or "this <type>" read as "~")', () => {
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

const json = (v: unknown): string => JSON.stringify(v);

describe('trek-13 readings (general readings, not card-specific)', () => {
  const lurker = (text: string) => parseCard(card('Example Lurker', 'Creature — Human', text, { power: '2', toughness: '2' }), OPTS).faces[0]!;
  it('"Whenever a creature blocks ~" triggers for each creature that blocks the object itself (CR 509.3a, 603.2), the blocker being "that creature"', () => {
    const f = lurker('Whenever a creature blocks this creature, that creature gets -1/-1 until end of turn.');
    expect(fullyAutomated(f)).toBe(true);
    expect(json(f.abilities)).toContain('"trigger":{"on":[{"ev":"blocks","blocker":{"types":["Creature"]},"attacker":{"self":true}}]}');
    expect(json(f.abilities)).toContain('"affects":{"ref":"event","role":"blocker"}');
  });
  it('negative: "blocks" of another object is not that event ("a creature blocks a creature you control" has no self attacker; "~ blocks ~" is nothing)', () => {
    expect(json(lurker('Whenever a creature blocks a creature you control, you gain 1 life.').abilities)).not.toContain('"attacker":{"self":true}');
    expect(fullyAutomated(lurker('Whenever this creature blocks this creature, you gain 1 life.'))).toBe(false);
  });
  it('"the Borg assimilated with ~" is the creature another ability of the face assimilated (CR 607.2a): the producer\'s target is linked, the reader reads the link; with no producer the reader is manual', () => {
    const saga = parseCard(card('Example Saga', 'Enchantment — Saga', 'I — Assimilate target nonartifact creature an opponent controls.\nII — Exile the Borg assimilated with ~, then return it to the battlefield under its owner\'s control.'), OPTS).faces[0]!;
    expect(fullyAutomated(saga)).toBe(true);
    expect(json(saga.abilities)).toContain('"link":"assimilated"');
    expect(json(saga.abilities)).toContain('{"ref":"linked","link":"assimilated"}');
    const alone = parseCard(card('Example Saga', 'Enchantment — Saga', 'I — Exile the Borg assimilated with ~, then return it to the battlefield under its owner\'s control.'), OPTS).faces[0]!;
    expect(fullyAutomated(alone)).toBe(false);
    const two = parseCard(card('Example Saga', 'Enchantment — Saga', 'I — Assimilate target nonartifact creature an opponent controls.\nII — Assimilate target nonartifact creature an opponent controls.\nIII — Exile the Borg assimilated with ~, then return it to the battlefield under its owner\'s control.'), OPTS).faces[0]!;
    expect(fullyAutomated(two)).toBe(false);
  });
  it('assimilate of a target creature on the battlefield and of a graveyard card are the same action (the macro tells them apart as it runs); a non-creature target on the battlefield is not rendered', () => {
    const creature = parseCard(card('Example Order', 'Sorcery', 'Assimilate target nonartifact creature an opponent controls.'), OPTS).faces[0]!;
    expect(fullyAutomated(creature)).toBe(true);
    const grave = parseCard(card('Example Order', 'Sorcery', 'Assimilate target creature card from an opponent\'s graveyard.'), OPTS).faces[0]!;
    expect(fullyAutomated(grave)).toBe(true);
    expect(json(creature.abilities)).toContain('"action":"assimilate"');
    expect(json(grave.abilities)).toContain('"action":"assimilate"');
    expect(fullyAutomated(parseCard(card('Example Order', 'Sorcery', 'Assimilate target artifact an opponent controls.'), OPTS).faces[0]!)).toBe(false);
  });
  it('"for each opponent" with a target card in that player\'s graveyard: at most one for each opponent, the owner (never the controller); other zones or "your" graveyard are other wordings', () => {
    const t = (text: string) => parseCard(card('Example Order', 'Sorcery', text), OPTS).faces[0]!;
    const ok = t("For each opponent, assimilate up to one target creature card from that player's graveyard.");
    expect(fullyAutomated(ok)).toBe(true);
    expect(json(ok.abilities)).toContain('"perOpponent":true');
    expect(json(ok.abilities)).toContain('"owner":"opponent"');
    for (const bad of ["For each opponent, assimilate up to two target creature cards from that player's graveyard.", "For each opponent, assimilate up to one target creature card from your graveyard.", "For each opponent, assimilate up to one target creature card from that player's hand."]) {
      expect(fullyAutomated(t(bad)), bad).toBe(false);
    }
  });
  it('"reveal cards ... until they reveal <a card>" for several players (CR 701.20a, 101.4): the step names every player, and the old single-player wording is unchanged', () => {
    const t = (text: string) => parseCard(card('Example Order', 'Sorcery', text), OPTS).faces[0]!;
    const each = t('Each opponent reveals cards from the top of their library until they reveal a creature card. Assimilate one of the creature cards revealed this way. Then each opponent puts the other cards they revealed this way on the bottom of their library in a random order.');
    expect(fullyAutomated(each)).toBe(true);
    expect(json(each.abilities)).toContain('"op":"revealUntil","who":{"ref":"each","who":"opponent"}');
    // a lone reveal-until of each opponent, or of one player, with another sentence after it, is said by no renderer: "that card" would name one card for each opponent
    expect(fullyAutomated(t('Each opponent reveals cards from the top of their library until they reveal a land card. Put that card into your hand.'))).toBe(false);
    // edh-next-40: one target player is now said (render/steps-cards.ts#revealUntil): the card goes to its owner's hand (CR 400.3), which is the player who revealed it
    expect(fullyAutomated(t('Target opponent reveals cards from the top of their library until they reveal a land card. Put that card into your hand.'))).toBe(true);
    const own = t('Reveal cards from the top of your library until you reveal a creature card. Put that card into your hand and the rest on the bottom of your library in a random order.');
    expect(fullyAutomated(own)).toBe(true);
    expect(json(own.abilities)).toContain('"op":"revealUntil","who":{"ref":"you"}');
  });
});
