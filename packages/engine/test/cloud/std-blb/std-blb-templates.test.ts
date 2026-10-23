/**
 * Cloud batch 2, slice std-blb (the Standard backlog of Bloomburrow, tuning half): the template data of parser/templates/zz-cloud/std-blb.json and the parser,
 * renderer and lowering support it needed (the status list of the Filter hole, the pawprint and repeatable mode headers, "If you do" inside an `if` branch,
 * restrictions read from the turn's history). Guard G9 (design 6.8): every example lowers with its template, is automated and passes the exact render gate
 * (G6); every counter-example does not parse or parses to different JSON; near-miss mutations fail or differ; a nonsense word in place of any word of an
 * example never leaves an automated card (G2). Examples are synthetic wordings (design 6.10), checked against the local index when it is present. The
 * behavior is in std-blb-scenarios.test.ts.
 */
import { describe, expect, it } from 'vitest';
import { compileCard, type OracleCard } from '../../../src/index';
import type { Template } from '../../../src/parser/types';
import { defaultParseOptions, parseCard } from '../../../src/parser/parse';
import { validateTemplates } from '../../../src/parser/chart';
import { CRITICAL_WORDS } from '../../../src/parser/lower/units';
import { TEMPLATE_FILES, TEMPLATE_SET } from '../../../src/parser/template-set';
import { ENGINE_CAPABILITIES } from '../../../src/model/capabilities';
import stdBlb from '../../../src/parser/templates/zz-cloud/std-blb.json';
import review from '../../m5/golden/cards/cloud-std-blb-review.json';
import { automated, bare, card, fullyAutomated, jsonKey } from '../../m5/templates/support';
import { localIndex } from '../../m5/parser/support';

const BLB = stdBlb as Template[];
const OPTS = defaultParseOptions({ templates: [...TEMPLATE_SET], capabilities: ENGINE_CAPABILITIES }); // what a decklist card gets (design 5.2; `needs`)

/**
 * Design 6.9 evidence of each stable template: its hand-verified golden cards (cloud-std-blb-review.json): at least one, and three where at least three cards
 * outside the held-out Standard cards of the batch read the sentence in full (the slice opens no held-out card, design 6.12). DEVIATION recorded,
 * as std-hob: design 6.9 asks for 20 reviewed matches or three golden cards. A card the template reads around a manual ability of the card is a partial golden
 * card: its understood abilities are checked all the same (the two graveyard replacements make no card full: every card that prints them has another manual ability).
 */
const EVIDENCE: Readonly<Record<string, readonly string[]>> = {
  'eff.stdblb.then.return.bf.tapped': ['Lumra, Bellow of the Woods'],
  'eff.stdblb.then.return.hand': ['Withdraw'],
  'eff.stdblb.lead.grant.pump.whereX': ['Treeguard Duo', 'Strength in Numbers', 'The Triumph of Anax'],
  'eff.stdblb.also.gets.ifCond': ['Might of the Meek'],
  'eff.stdblb.if.delay.nextEnd': ['Parting Gust', 'Systems Override'],
  'sta.stdblb.graveyard.yours.exile': ['Festival of Embers', 'Emet-Selch, Unsundered // Hades, Sorcerer of Eld'],
  'sta.stdblb.graveyard.yours.card.exile': ["Yawgmoth's Agenda"],
  // merge of lines C and D: sta.stdblb.damage.plus.toOpponents and .noncombat were the same templates (same pattern and JSON) as CLOUD std-dft's
  // rep.stddft.damage.plus.yourSource.toOpponentOrTheirPermanent and CLOUD std-msh's rep.stdmsh.damage.noncombat.opp.plus, which are kept (their tests read Far
  // Fortune, End Boss and Artist's Talent with them)
  'sta.stdblb.damage.plus.toOpponents.colored': ['Torbran, Thane of Red Fell'],
  'eff.stdblb.choose.permanent.youControl': ['Season of Weaving'],
  'eff.stdblb.look.nFromTop': ['Stargaze'],
  'eff.stdblb.dig.nCardsFromAmong.putHand.rest.graveyard': ['Stargaze'],
};
/**
 * Partial golden cards: the template's sentence is understood, another ability of the card stays manual (no engine mechanic). None since C10 (cloud batch 3):
 * Festival of Embers, Hades and Yawgmoth's Agenda were partial for their graveyard permission only, which zz-cloud/c10.json now reads, so they are full.
 */
const PARTIAL = new Set<string>([]);

/** A synthetic card in which an example is an ability of the right kind: a spell on a sorcery (with {X} in its cost when it reads an X it does not define), anything else on a creature. */
function exampleCard(t: Template, text: string): OracleCard {
  if (t.kind === 'effect' && !text.includes(':') && !/^(When|Whenever|At)\b/.test(text)) {
    const x = /\bX\b/.test(text) && !/where X is/i.test(text);
    return card('Example Volley', 'Sorcery', text, x ? { mana_cost: '{X}{B}' } : {});
  }
  return card('Example Brute', 'Creature — Elf Warrior', text, { power: '3', toughness: '3' });
}
const parsedWith = (t: Template, text: string) => parseCard(exampleCard(t, text), OPTS).faces[0]!;

describe('std-blb template file (design 6.3, 6.9; CONTRIBUTING "Adding a template")', () => {
  it('is loaded by the default compiler (zz-cloud/std-blb.json, path order: after trigger.json, before zz-cloud/std-hob.json and zz-fast1/) and its ids are unique in the whole set', () => {
    const files = TEMPLATE_FILES.map((f) => f.file);
    expect(files).toContain('zz-cloud/std-blb.json');
    expect(files.indexOf('zz-cloud/std-blb.json')).toBeGreaterThan(files.indexOf('trigger.json'));
    expect(files.indexOf('zz-cloud/std-blb.json')).toBeLessThan(files.indexOf('zz-cloud/std-hob.json'));
    expect(files.indexOf('zz-cloud/std-blb.json')).toBeLessThan(files.findIndex((f) => f.startsWith('zz-fast1/')));
    const ids = TEMPLATE_SET.map((t) => t.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(validateTemplates([...TEMPLATE_SET])).toEqual([]);
  });
  it('design 6.9: every template cites rules, has at least two examples and two counter-examples, a status, and is of version 8; ids are eff.stdblb.* or sta.stdblb.*', () => {
    expect(BLB.length).toBe(13); // merge of lines C and D: two duplicates of std-dft's and std-msh's damage replacements dropped
    for (const t of BLB) {
      expect(t.id, t.id).toMatch(/^(eff|sta)\.stdblb\./);
      expect(t.cr.length, t.id).toBeGreaterThan(0);
      for (const cr of t.cr) expect(cr, t.id).toMatch(/^CR \d{3}(\.\d+[a-z]?)?$/);
      expect(t.examples.length, t.id).toBeGreaterThanOrEqual(2);
      expect(t.counterExamples.length, t.id).toBeGreaterThanOrEqual(2);
      expect(['stable', 'experimental'], t.id).toContain(t.status);
      expect(t.since, t.id).toBe(8);
    }
  });
  it('design 6.9: a stable template has its evidence (hand-verified golden cards that cite it); the two then-return variants no real card reads in full stay experimental', () => {
    const golden = review as { card: string; verified: string; expect?: string }[];
    const stable = BLB.filter((x) => x.status === 'stable').map((t) => t.id);
    expect(stable.slice().sort()).toEqual(Object.keys(EVIDENCE).sort());
    expect(BLB.filter((x) => x.status === 'experimental').map((t) => t.id).sort()).toEqual(['eff.stdblb.then.return.bf', 'eff.stdblb.then.return.bf.owner']);
    const cites = (g: { verified: string }, id: string): boolean => new RegExp(`[ (;]${id.replace(/\./g, '\\.')}[,;)]`).test(g.verified);
    for (const [id, cards] of Object.entries(EVIDENCE)) {
      expect(golden.filter((g) => cites(g, id)).map((g) => g.card).sort(), id).toEqual([...cards].sort());
      for (const c of cards) expect(golden.find((g) => g.card === c)?.expect, c).toBe(PARTIAL.has(c) ? undefined : 'full');
    }
    for (const g of golden) expect(g.verified, g.card).toMatch(/CR \d{3}/);
  });
  it('guard G3: a critical word a pattern spells out is listed in `consumes`', () => {
    for (const t of BLB) {
      const literal = ` ${t.pattern.toLowerCase().replace(/\{[^}]*:[^}]*\}/g, ' ').replace(/[()[\]|,]/g, ' ').replace(/\s+/g, ' ').trim()} `;
      for (const w of CRITICAL_WORDS) if (literal.includes(` ${w} `)) expect(t.consumes ?? [], `${t.id}: ${w}`).toContain(w);
    }
  });
});

describe('std-blb guard G9 (design 6.8): examples and counter-examples', () => {
  for (const t of BLB) {
    it(`${t.id} (${t.cr.join(', ')}): every example parses with it, is automated and passes the render gate; counter-examples do not give the same JSON`, () => {
      const first = parsedWith(t, t.examples[0]!.text);
      for (const e of t.examples) {
        const f = parsedWith(t, e.text);
        // merge of lines C and D (as std-hob's test): an experimental template whose wording the stable templates also lower to the same result gives way to
        // them (design 6.9, G10: the "experimental" info diagnostic names it); CLOUD std-fra's generic sentence-initial "Then" reads "Then return ..." so
        const fellBack = t.status === 'experimental' && f.diagnostics.some((d) => d.code === 'experimental' && d.message.includes(t.id));
        expect(f.templatesUsed.includes(t.id) || fellBack, `${e.text}: ${f.templatesUsed.join(', ')}`).toBe(true);
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
  const out = [`${body} unless it is blue.`, `${body} instead.`, `${body} at random.`, `${body} twice.`, `${body} if able.`];
  const swaps: [RegExp, string][] = [
    [/\btapped\b/, 'untapped'], [/\buntil end of turn\b/, 'until your next turn'], [/\bgains\b/, 'loses'], [/\byour graveyard\b/, "an opponent's graveyard"],
    [/\bnext end step\b/, 'next upkeep'], [/\ban opponent controls\b/, 'you control'], [/\bplus\b/, 'minus'], [/\binto your hand\b/, 'into your graveyard'],
    [/\bfrom the top\b/, 'from the bottom'], [/\byou control\b/, 'an opponent controls'], [/\bThen return\b/, 'Then exile'], [/\balso gets\b/, 'also gains'],
  ];
  for (const [re, by] of swaps) if (re.test(text)) out.push(text.replace(re, by));
  return out;
}

describe('std-blb guard G9 (design 6.8): near-miss mutations fail or differ', () => {
  for (const t of BLB) {
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

describe('std-blb guard G2 (design 6.8): a nonsense word never leaves an automated card', () => {
  for (const t of BLB) {
    it(`${t.id}: replacing any one word of an example by an invented word makes the card not fully automated`, () => {
      for (const e of t.examples) {
        const words = e.text.split(' ');
        words.forEach((w, i) => {
          if (w === '~' || w === '~.' || /^"?\{/.test(w) || w.includes('\n')) return;
          // CR 122.1: any word can name a kind of counter (parser/holes/misc.ts#counterKind), so the word before "counter" is not a nonsense position (as T51)
          if (/^counters?$/.test(words[i + 1] ?? '')) return;
          const end = w.match(/[.,"]+$/)?.[0] ?? '';
          const start = w.startsWith('"') ? '"' : '';
          const mutated = [...words.slice(0, i), `${start}blorfty${end}`, ...words.slice(i + 1)].join(' ');
          expect(fullyAutomated(parsedWith(t, mutated)), mutated).toBe(false);
        });
      }
    });
  }
});

describe('std-blb parser, lowering and renderer support', () => {
  const face = (type: string, text: string, extra: Partial<OracleCard> = {}) => parseCard(card('Example Brute', type, text, { power: '3', toughness: '3', ...extra }), OPTS).faces[0]!;
  const json = (f: { abilities: unknown[] }): string => JSON.stringify(f.abilities);

  it('CR 115.1, 601.2c: "attacking, blocking, or tapped creature" is one filter with any of the three statuses (parser/holes/filter.ts#statusList); a list without "or" is not read', () => {
    const three = face('Instant', '~ deals 2 damage to target attacking, blocking, or tapped creature.');
    expect(fullyAutomated(three)).toBe(true);
    expect(json(three)).toContain('"anyOf":[{"attacking":true},{"blocking":true},{"tapped":true}]');
    const two = face('Instant', '~ deals 2 damage to target blocking or tapped creature.');
    expect(fullyAutomated(two)).toBe(true);
    expect(json(two)).toContain('"anyOf":[{"blocking":true},{"tapped":true}]');
    expect(fullyAutomated(face('Instant', '~ deals 2 damage to target attacking, blocking, tapped creature.'))).toBe(false);
    expect(fullyAutomated(face('Instant', '~ deals 2 damage to target tapped, or untapped creature.'))).toBe(false);
  });

  it('CR 700.2i: the pawprint header and "{P}" mode costs lower to a mode budget (parser/lower/ability.ts) and render back exactly; a mode without pawprints is not read', () => {
    const f = face('Sorcery', 'Choose up to four {P} worth of modes. You may choose the same mode more than once.\n{P} — You gain 2 life.\n{P}{P} — Draw a card.\n{P}{P}{P} — Destroy target artifact.');
    expect(fullyAutomated(f)).toBe(true);
    const modes = (f.abilities[0] as { effect: { modes: { min: number; max: number; pawprints: number; allowRepeat: boolean; options: { pawprints: number }[] } } }).effect.modes;
    expect([modes.min, modes.max, modes.pawprints, modes.allowRepeat]).toEqual([0, 4, 4, true]);
    expect(modes.options.map((o) => o.pawprints)).toEqual([1, 2, 3]);
    const once = face('Sorcery', 'Choose up to four {P} worth of modes.\n{P} — You gain 2 life.\n{P}{P} — Draw a card.');
    expect(fullyAutomated(once)).toBe(true);
    expect(json(once)).not.toContain('allowRepeat');
    expect(fullyAutomated(face('Sorcery', 'Choose up to four {P} worth of modes.\n{P} — You gain 2 life.\n• Draw a card.'))).toBe(false);
  });

  // r5-cost (Moment of Reckoning): "Choose up to N." with the same sentence is read now, none up to N modes with repeats (parser/lower/ability.ts#withModes)
  it('CR 700.2d: "Choose two. You may choose the same mode more than once." is two modes with repeats allowed; "Choose up to two." with the same sentence is none to two', () => {
    const f = face('Instant', 'Choose two. You may choose the same mode more than once.\n• Draw a card.\n• Target player gains 3 life.');
    expect(fullyAutomated(f)).toBe(true);
    const modes = (f.abilities[0] as { effect: { modes: { min: number; max: number; allowRepeat: boolean } } }).effect.modes;
    expect([modes.min, modes.max, modes.allowRepeat]).toEqual([2, 2, true]);
    const upTo = face('Instant', 'Choose up to two. You may choose the same mode more than once.\n• Draw a card.\n• Target player gains 3 life.');
    expect(fullyAutomated(upTo)).toBe(true);
    const m2 = (upTo.abilities[0] as { effect: { modes: { min: number; max: number; allowRepeat: boolean } } }).effect.modes;
    expect([m2.min, m2.max, m2.allowRepeat]).toEqual([0, 2, true]);
  });

  it('CR 608.2c: "If C, X. If you do, Y." puts Y inside the branch, after X, reading X (parser/lower/conditions.ts#foldDidInIf); with no `if` before it, "If you do" reads the instruction itself', () => {
    const f = face('Sorcery', 'If you control an Elf, put two +1/+1 counters on target creature. If you do, draw a card.');
    expect(fullyAutomated(f)).toBe(true);
    expect(json(f)).toMatch(/^\[\{"kind":"spell".*"steps":\[\{"op":"if","cond":\{"cond":"exists".*"then":\[\{"op":"putCounters".*"as":"(\w+)".*\{"op":"if","cond":\{"cond":"did","step":"\1"\},"then":\[\{"op":"draw"/);
    const plain = face('Sorcery', 'You may sacrifice a creature. If you do, draw a card.');
    expect(fullyAutomated(plain)).toBe(true);
    expect(json(plain)).not.toMatch(/"op":"if","cond":\{"cond":"exists"/);
  });

  it('CR 602.5b: "Activate only if an opponent lost life this turn" is read from the turn\'s history when the ability is activated (model/forms.ts#turnHistoryAtAnnouncement); an engine without that capability asks the player, as before', () => {
    const text = '{2}: Draw a card. Activate only if an opponent lost life this turn.';
    const f = face('Artifact', text);
    expect(fullyAutomated(f)).toBe(true);
    expect(json(f)).toContain('"onlyIf":{"cond":"happened","event":{"ev":"life","change":"loss","player":"opponent"},"scope":"turn"}');
    const without = parseCard(card('Example Brute', 'Artifact', text), defaultParseOptions({ templates: [...TEMPLATE_SET], capabilities: new Set([...ENGINE_CAPABILITIES].filter((c) => c !== 'feature:announce.happened.turn')) })).faces[0]!;
    expect(json(without)).toMatch(/"onlyIf":\{"cond":"ask"[,}]/);
    expect(json(without)).not.toContain('"cond":"happened"');
  });

  it('CR 608.2c, 603.7: "If C, <instructions> at the beginning of the next end step" (priority 0.5) leaves the sentences T25 and T61 read with the same JSON to them (priority 1), and outranks the generic readings (0)', () => {
    const t25 = face('Sorcery', 'Gain control of target creature until end of turn. Untap that creature. If you control a Goblin, sacrifice that creature at the beginning of the next end step.');
    expect(t25.templatesUsed).toContain('eff.t25.ifThen.sacrifice.nextEnd');
    expect(t25.templatesUsed).not.toContain('eff.stdblb.if.delay.nextEnd');
    const t61 = face('Sorcery', "Exile target creature you control. If you control an Elf, return that card to the battlefield under its owner's control at the beginning of the next end step.");
    expect(t61.templatesUsed).toContain('eff.t61.if.returnNextEnd.owner');
    const general = face('Sorcery', 'Target creature gets +2/+0 until end of turn. If you control a Goblin, you lose 2 life at the beginning of the next end step.');
    expect(fullyAutomated(general)).toBe(true);
    expect(general.templatesUsed).toContain('eff.stdblb.if.delay.nextEnd');
    expect(json(general)).toMatch(/"op":"if","cond":\{"cond":"exists".*"then":\[\{"op":"delay","when":\{"at":"step","step":"end","next":true\}/);
  });

  it('CR 400.3, 602.5b: "if three or more cards left your graveyard this turn" counts the turn\'s zone changes out of your graveyard', () => {
    const f = face('Artifact', '{T}: Draw a card. Activate only if three or more cards left your graveyard this turn.');
    expect(fullyAutomated(f)).toBe(true);
    expect(json(f)).toContain('"onlyIf":{"cond":"happened","event":{"ev":"zoneChange","subject":{"isCard":true,"owner":"you"},"from":"graveyard"},"scope":"turn","times":{"op":">=","value":3}}');
    // as a cost reduction the sentence stays t32's (cm.t32.self.less.cardsLeftGraveyard): one reading, not two (G5)
    const cost = face('Instant', '~ costs {2} less to cast if three or more cards left your graveyard this turn.\nDraw a card.');
    expect(fullyAutomated(cost)).toBe(true);
    expect(cost.templatesUsed).toContain('cm.t32.self.less.cardsLeftGraveyard');
  });
});

const index = localIndex();

describe.skipIf(index === null)('std-blb design 6.9, 6.10 (local index): synthetic examples; the evidence cards read their sentence with the template', () => {
  it('no std-blb example or counter-example is a line of a real card (with the card\'s own name or "this <type>" read as "~")', () => {
    const lines = new Set<string>();
    for (const c of index ?? []) {
      for (const text of [c.oracle_text, ...(c.card_faces ?? []).map((x) => x.oracle_text)]) {
        if (typeof text !== 'string') continue;
        for (const l of text.split('\n')) {
          lines.add(l.trim());
          lines.add(l.replaceAll(c.name, '~').replace(/\bthis (creature|land|artifact|enchantment|Aura|spell|card|Class)\b/gi, '~').trim());
        }
      }
    }
    // a template with no hole (the two graveyard replacements) spells out its whole sentence: its examples are two-line cards whose other line is invented
    const verbatim = BLB.flatMap((t) => [...t.examples.map((e) => e.text), ...t.counterExamples].filter((x) => lines.has(x.trim())).map((x) => `${t.id}: ${x}`));
    expect(verbatim).toEqual([]);
  }, 120_000);

  for (const [id, names] of Object.entries(EVIDENCE)) {
    it(`${id}: ${names.join(', ')} read the sentence with it and pass the render gate`, () => {
      for (const name of names) {
        const oracle = (index ?? []).find((c) => c.name === name);
        expect(oracle, name).toBeDefined();
        const parsed = parseCard(oracle!, OPTS);
        expect(parsed.faces.flatMap((f) => f.templatesUsed), name).toContain(id);
        // a partial card keeps its manual ability (whose gate entry fails); the abilities it understands pass, and the golden test checks their JSON
        const gate = parsed.faces.flatMap((f) => f.gate);
        if (PARTIAL.has(name)) expect(gate.filter((g) => g.ok).length, name).toBeGreaterThan(0);
        else expect(gate.every((g) => g.ok), name).toBe(true);
        expect(compileCard(oracle!).automation.level, name).toBe(PARTIAL.has(name) ? 'partial' : 'full');
      }
    });
  }
});
