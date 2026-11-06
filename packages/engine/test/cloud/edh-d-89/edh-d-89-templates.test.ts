/**
 * Commander coordinator D, round edh-d-89 (EDHREC band 5,001-10,000, group combat): the template data of parser/templates/zz-cloud/edh-d-89.json (see the file) and the round's parser, lowering,
 * engine and renderer changes, tested at the end of this file and in edh-d-89-scenarios.test.ts.
 * Guard G9 (design 6.8): every example lowers with its template, is automated and passes the exact render gate (G6); every counter-example does not parse or
 * parses to different JSON; near-miss mutations fail or differ; a nonsense word in place of any word of an example never leaves an automated card (G2). Examples
 * are synthetic wordings (design 6.10), checked against the local index when it is present. CR cites checked against the Comprehensive Rules of 2026-09-25 (fetched from media.wizards.com).
 */
import { describe, expect, it } from 'vitest';
import type { Template } from '../../../src/parser/types';
import { defaultParseOptions, parseCard } from '../../../src/parser/parse';
import { validateTemplates } from '../../../src/parser/chart';
import { TEMPLATE_FILES, TEMPLATE_SET } from '../../../src/parser/template-set';
import { ENGINE_CAPABILITIES } from '../../../src/model/capabilities';
import edhD89 from '../../../src/parser/templates/zz-cloud/edh-d-89.json';
import ownReview from '../../m5/golden/cards/edh-d-89-review.json';
import stdLciReview from '../../m5/golden/cards/cloud-std-lci-review.json';
/** The round's golden entries; Eivor's is the Cloud std-lci entry, updated by this round (one entry per card, CARD_AUTOMATION section 6). */
const review = [...ownReview, ...(stdLciReview as { card: string }[]).filter((g) => g.card === 'Eivor, Wolf-Kissed')];
import { automated, bare, card, fullyAutomated, jsonKey } from '../../m5/templates/support';
import { localIndex } from '../../m5/parser/support';

const MECH = edhD89 as Template[];
const MECH_COUNT = 11;
/**
 * design 6.9 deviation (docs/CARD_AUTOMATION.md section 5, "Narrow wordings"): templates made stable on fewer than three golden cards because Oracle prints the
 * wording on only one or two cards, with their template tests (G9, G2) and played scenarios. Listed in the round's record for the owner (DECIDED BY DEFAULT,
 * owner instruction 2026-10-21).
 */
const NARROW: Readonly<Record<string, readonly string[]>> = {
  'rst.edhd89.cast.self.beforeAttackers': ['Master Warcraft'],
  'eff.edhd89.youChooseAttackers': ['Master Warcraft'],
  'eff.edhd89.youChooseBlocksTurn': ['Master Warcraft'],
  'eff.edhd89.meldPair.bothAttacking.entersAttacking': ['Mishra, Claimed by Gix'],
  'rid.edhd89.token.theTokenHas': ['Scriv, the Obligator'],
  'eff.edhd89.choose.counterOn.aFilter': ['Aven Courier'],
  'eff.edhd89.put.ofThatKind.ifNone': ['Aven Courier'],
  'eff.edhd89.return.bf.owner.converted': ['Optimus Prime, Hero // Optimus Prime, Autobot Leader'],
  'eff.edhd89.when.thatCreature.combatDamage.thisTurn': ['Optimus Prime, Hero // Optimus Prime, Autobot Leader'],
  'eff.edhd89.attackersUntapAllTheyControl': ['Curse of Bounty'],
  'eff.edhd89.milled.put.eitherOr.bf': ['Eivor, Wolf-Kissed'],
};
const OPTS = defaultParseOptions({ templates: [...TEMPLATE_SET], capabilities: ENGINE_CAPABILITIES }); // what a decklist card gets (design 5.2; `needs`)

/** Templates whose examples are spell text (an instant or sorcery named Example Subject); the others are abilities of a creature unless they are a bare effect. */
const SPELL_RST = new Set<string>(['rst.edhd89.cast.self.beforeAttackers', 'rid.edhd89.token.theTokenHas']);
/** A synthetic card with the example as its ability: a spell restriction on an instant; a static, activated or triggered ability on an artifact creature; a spell otherwise. */
const parsedWith = (t: Template, text: string) => parseCard(
  t.id === 'eff.edhd89.attackersUntapAllTheyControl' ? card('Example Relic', 'Enchantment — Aura Curse', `Enchant player\n${text}`)
    : SPELL_RST.has(t.id) ? card('Example Subject', 'Instant', text)
    : t.kind === 'static' || text.includes(':') || /^(When|Whenever|At the beginning)/.test(text) || (text.startsWith('~') && !text.includes('as you cast ~')) ? card('Example Relic', 'Artifact Creature — Construct', text, { power: '2', toughness: '2' }) : card('Example Plan', 'Sorcery', text), OPTS).faces[0]!;

describe('edh-d-89 template file (design 6.3, 6.9; CONTRIBUTING "Adding a template")', () => {
  it('is loaded by the default compiler (zz-cloud/edh-d-89.json, path order: after edh-d-8.json, before edh-d-9.json) and its ids are unique in the whole set', () => {
    const files = TEMPLATE_FILES.map((f) => f.file);
    expect(files).toContain('zz-cloud/edh-d-89.json');
    expect(files.indexOf('zz-cloud/edh-d-89.json')).toBeGreaterThan(files.indexOf('zz-cloud/edh-d-8.json'));
    expect(files.indexOf('zz-cloud/edh-d-89.json')).toBeLessThan(files.indexOf('zz-cloud/edh-d-9.json'));
    const ids = TEMPLATE_SET.map((t) => t.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(validateTemplates([...TEMPLATE_SET])).toEqual([]);
  });
  it('design 6.9: every template cites rules, has at least two examples and two counter-examples, a status, and is of version 89; ids are *.edhd89.*', () => {
    expect(MECH.length).toBe(MECH_COUNT);
    for (const t of MECH) {
      expect(t.id, t.id).toMatch(/^(eff|sta|rep|trg|rst|ch|rid|cm)\.edhd89\./);
      expect(t.cr.length, t.id).toBeGreaterThan(0);
      for (const cr of t.cr) expect(cr, t.id).toMatch(/^CR \d{3}(\.\d+[a-z]?)?$/);
      expect(t.examples.length, t.id).toBeGreaterThanOrEqual(2);
      expect(t.counterExamples.length, t.id).toBeGreaterThanOrEqual(2);
      expect(['stable', 'experimental'], t.id).toContain(t.status);
      expect(t.since, t.id).toBe(89);
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

describe('edh-d-89 guard G9 (design 6.8): examples and counter-examples', () => {
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

describe('edh-d-89 guard G9 (design 6.8): near-miss mutations fail or differ', () => {
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

describe('edh-d-89 guard G2 (design 6.8): a nonsense word never leaves an automated card', () => {
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

describe.skipIf(index === null)('edh-d-89 design 6.10 (local index): synthetic examples', () => {
  it('no edh-d-89 line of an example or counter-example is a line of a real card (with the card\'s own name or "this <type>" read as "~")', () => {
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

describe('edh-d-89 renderer, lowering and engine changes (one test each)', () => {
  const spell = (text: string) => parseCard(card('Example Subject', 'Instant', text), OPTS).faces[0]!;
  it('render/stat.ts#castSelfBeforeAttackers (CR 601.3, 508.1, 500.8; Master Warcraft ruling 2013-09-20): "Cast ~ only before attackers are declared" is a step before the declare attackers step AND no declare attackers step yet this turn; the steps alone are not this wording', () => {
    const f = spell('Cast Example Subject only before attackers are declared.\nDraw a card.');
    expect(fullyAutomated(f)).toBe(true);
    expect(JSON.stringify(f.abilities)).toContain('"cond":"not","of":{"cond":"happened","event":{"ev":"step","step":"declareAttackers"},"scope":"turn"}');
  });
  it('render/steps-lasting.ts (CR 509.1a, 723.1): controlBlocks with `turn` says "this turn", without it "this combat" (Odric keeps its reading)', () => {
    const odric = parseCard(card('Example Relic', 'Artifact Creature — Construct', 'Whenever ~ attacks, you choose which creatures block this combat and how those creatures block.', { power: '2', toughness: '2' }), OPTS).faces[0]!;
    expect(fullyAutomated(odric)).toBe(true);
    expect(JSON.stringify(odric.abilities)).not.toContain('"turn":true');
    const turn = spell('You choose which creatures block this turn and how those creatures block. Draw a card.');
    expect(JSON.stringify(turn.abilities)).toContain('"op":"controlBlocks","who":{"ref":"you"},"turn":true');
  });
  it('effects/handlers/edh-d-89.ts + core/combat.ts (CR 508.1a-b, 723.1): control of the attack declaration is advertised as the op controlAttacks, in its one form (you)', () => {
    expect(ENGINE_CAPABILITIES.has('op:controlAttacks')).toBe(true);
    expect(JSON.stringify(spell('You choose which creatures attack this turn. Draw a card.').abilities)).toContain('"op":"controlAttacks","who":{"ref":"you"}');
  });
  it('parser/holes/edhd89.ts + effects/eval.ts (CR 702.122e, 603.4): "if it was crewed by exactly two creatures" after "becomes crewed" is `eventCrewers` 2, an intervening if; without "exactly", with "this turn" or another subject it is not this reading', () => {
    const vehicle = (cond: string) => parseCard(card('Example Relic', 'Artifact — Vehicle', `Whenever ~ becomes crewed, if ${cond}, draw a card.\nCrew 2`, { power: '3', toughness: '3' }), OPTS).faces[0]!;
    const f = vehicle('it was crewed by exactly two creatures');
    expect(fullyAutomated(f)).toBe(true);
    expect(JSON.stringify(f.abilities)).toContain('"interveningIf":{"cond":"eventCrewers","count":2}');
    expect(JSON.stringify(vehicle('it was crewed by exactly one creature').abilities)).toContain('"interveningIf":{"cond":"eventCrewers","count":1}');
    expect(fullyAutomated(vehicle('it was crewed by two creatures'))).toBe(false);
    expect(fullyAutomated(vehicle('it was crewed by exactly two creatures this turn'))).toBe(false);
    expect(fullyAutomated(vehicle('it was crewed by exactly one creatures'))).toBe(false);
    expect(fullyAutomated(vehicle('~ was crewed by exactly two creatures'))).toBe(false);
  });
  it('parser/lower/join-edhd89.ts + render/cond.ts + render/steps-lasting.ts (CR 701.42a, 508.4): the meld sentence and "It enters tapped and attacking." are joined only when the second is exactly that; the condition says both are attacking', () => {
    const relic = (text: string) => parseCard(card('Example Relic', 'Legendary Creature — Human', text, { power: '3', toughness: '3' }), OPTS).faces[0]!;
    const lead = 'Whenever you attack, you gain 1 life. If ~ and a creature named Brass Wyrm are attacking, and you both own and control them, exile them, then meld them into Brass Overlord.';
    const f = relic(`${lead} It enters tapped and attacking.`);
    expect(fullyAutomated(f)).toBe(true);
    expect(JSON.stringify(f.abilities)).toContain('"action":"meldPair","who":{"ref":"you"},"arg":"Brass Overlord","partner":{"attacking":true},"entersAttacking":true');
    expect(fullyAutomated(relic(`${lead} It enters tapped and attacking Bob.`))).toBe(false);
    expect(fullyAutomated(relic(`${lead} It gains haste.`))).toBe(false);
    expect(fullyAutomated(relic(lead))).toBe(false); // the join needs the second sentence; alone the attacking condition has no template
  });
  it('parser/holes/edhd89.ts + render/cond.ts (CR 506.3, 508.1b, 603.4): "if no other creatures are attacking that player" after "attacks a player" is no creature but the event\'s attacker attacking the event\'s defending player; "other" never means "other than ~" here', () => {
    const relic = (text: string) => parseCard(card('Example Relic', 'Legendary Creature — Human', text, { power: '3', toughness: '3' }), OPTS).faces[0]!;
    const f = relic('Whenever a creature you control attacks a player, if no other creatures are attacking that player, draw a card.');
    expect(fullyAutomated(f)).toBe(true);
    expect(JSON.stringify(f.abilities)).toContain('"interveningIf":{"cond":"not","of":{"cond":"exists","of":{"ref":"each","filter":{"types":["Creature"],"not":{"is":{"ref":"event","role":"attacker"}},"attacking":{"defender":{"ref":"event","role":"defender"}}}}}}');
    expect(fullyAutomated(relic('Whenever a creature you control attacks a player, if no other creatures are attacking that player this turn, draw a card.'))).toBe(false);
    expect(fullyAutomated(relic('Whenever a creature you control attacks a player, if no other creatures are attacking those players, draw a card.'))).toBe(false);
  });
  it('parser/holes/cond.ts + render/cond.ts (CR 508.1b): "if it\'s attacking one of your opponents" is the object attacking a player who is an opponent (never a planeswalker); the negated form is not read', () => {
    const aura = (t: string) => parseCard(card('Example Relic', 'Enchantment — Aura', `Enchant creature\nWhenever enchanted creature attacks, ${t}`), OPTS).faces[0]!;
    const f = aura("it gets +2/+0 until end of turn if it's attacking one of your opponents. Otherwise, its controller loses 2 life.");
    expect(fullyAutomated(f)).toBe(true);
    expect(JSON.stringify(f.abilities)).toContain('"cond":{"cond":"matches","object":{"ref":"event","role":"attacker"},"filter":{"attacking":{"defender":"opponent"}}}');
    expect(fullyAutomated(aura("it gets +2/+0 until end of turn if it's not attacking one of your opponents."))).toBe(false);
    expect(fullyAutomated(aura("it gets +2/+0 until end of turn if it's attacking one of your teammates."))).toBe(false);
  });
  it('parser/lower/targets.ts (CR 115.3, 109.2, 301.5c; Amy Rose): "up to one other target attacking creature" after an Equipment target in its own attack trigger excludes this object AND the Equipment target; after any other earlier target it stays manual', () => {
    const relic = (text: string) => parseCard(card('Example Relic', 'Legendary Creature — Hedgehog', text, { power: '3', toughness: '3' }), OPTS).faces[0]!;
    const f = relic("Whenever ~ attacks, attach up to one target Equipment to ~. Then up to one other target attacking creature gets +X/+0 until end of turn, where X is ~'s power.");
    expect(fullyAutomated(f)).toBe(true);
    expect(JSON.stringify(f.abilities)).toContain('"other":true},"distinctFrom":["t0"]');
    expect(fullyAutomated(relic("Whenever ~ attacks, untap up to one target artifact. Then up to one other target attacking creature gets +X/+0 until end of turn, where X is ~'s power."))).toBe(false);
  });
  it('parser/lower/mentions.ts + render/steps-lasting.ts (CR 701.39a, 603.7c): the creature a bolster chose is "the chosen creature", then "that creature" of a once-only delayed trigger of its combat damage to a player this turn', () => {
    const relic = (text: string) => parseCard(card('Example Relic', 'Artifact Creature — Construct', text, { power: '3', toughness: '3' }), OPTS).faces[0]!;
    const f = relic('Whenever ~ attacks, bolster 2. The chosen creature gains trample until end of turn. When that creature deals combat damage to a player this turn, draw a card.');
    expect(fullyAutomated(f), JSON.stringify(f.diagnostics)).toBe(true);
    const j = JSON.stringify(f.abilities);
    expect(j).toContain('"action":"bolster","who":{"ref":"you"},"n":2,"as":"them"');
    expect(j).toContain('"source":{"is":{"ref":"bound","name":"them"}},"combat":true,"recipient":{"player":"any"}}');
    expect(j).toContain('"once":true');
    expect(fullyAutomated(relic('Whenever ~ attacks, bolster 2. The chosen creature gains trample until end of turn. When that creature deals combat damage to a creature this turn, draw a card.'))).toBe(false);
    expect(fullyAutomated(relic('Whenever ~ attacks, bolster 2. The chosen creatures gain trample until end of turn.'))).toBe(false);
  });
  it('render/cond.ts (review): "it was crewed by exactly N creatures" only after "becomes crewed", "no other creatures are attacking that player" only after an attack on a player', () => {
    const relic = (type: string, text: string) => parseCard(card('Example Relic', type, text, { power: '3', toughness: '3' }), OPTS).faces[0]!;
    expect(fullyAutomated(relic('Artifact — Vehicle', 'Whenever ~ attacks, if it was crewed by exactly two creatures, draw a card.\nCrew 1'))).toBe(false);
    expect(fullyAutomated(relic('Artifact — Vehicle', 'Whenever ~ becomes crewed, if it was crewed by exactly two creatures, draw a card.\nCrew 1'))).toBe(true);
    expect(fullyAutomated(relic('Creature — Human', 'Whenever a creature you control attacks, if no other creatures are attacking that player, draw a card.'))).toBe(false);
  });
});

