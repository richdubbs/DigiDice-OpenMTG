/**
 * std-rx27 (wave 2, Standard lane rx27: cast and play permissions): the template data of parser/templates/zz-cloud/std-rx27.json (static linked cast permissions
 * with riders, a one-card permission, the "enters with" rider of top-card cast permissions, a land and a permanent spell of each permanent type from the
 * graveyard) and the parser, model and renderer changes of the round. Guard G9 (design 6.8): every example lowers with its template, is automated and passes the
 * exact render gate (G6); every counter-example does not parse or parses to different JSON; near-miss mutations fail or differ; a nonsense word in place of any
 * word of an example never leaves an automated card (G2). Examples are synthetic wordings (design 6.10), checked against the local index when it is present. The
 * behavior is in std-rx27-scenarios.test.ts. CR cites from memory, unverified (rules/cr/ is not in the cloud checkout).
 */
import { describe, expect, it } from 'vitest';
import type { OracleCard } from '../../../src/index';
import type { Template } from '../../../src/parser/types';
import { defaultParseOptions, parseCard } from '../../../src/parser/parse';
import { validateTemplates } from '../../../src/parser/chart';
import { TEMPLATE_FILES, TEMPLATE_SET } from '../../../src/parser/template-set';
import { ENGINE_CAPABILITIES } from '../../../src/model/capabilities';
import stdRx27 from '../../../src/parser/templates/zz-cloud/std-rx27.json';
import ownReview from '../../m5/golden/cards/cloud-std-rx27-review.json';
import r4refsReview from '../../m5/golden/cards/cloud-r4-refs-review.json';
// Azula, Cunning Usurper had an entry of r4-refs (its static ability pending); this round updated that entry instead of adding a second one (guide section 6)
const review = [...ownReview, ...(r4refsReview as { card: string }[]).filter((g) => g.card === 'Azula, Cunning Usurper')];
import { capabilitiesOfDef } from '../../../src/model/cap-walk';
import { automated, bare, card, fullyAutomated, jsonKey } from '../../m5/templates/support';
import { localIndex } from '../../m5/parser/support';

const MECH = stdRx27 as Template[];
const MECH_COUNT = 13;
const OPTS = defaultParseOptions({ templates: [...TEMPLATE_SET], capabilities: ENGINE_CAPABILITIES }); // what a decklist card gets (design 5.2; `needs`)

/** A synthetic card in which an example is an ability of the right kind: a spell on a sorcery, a triggered or static ability on a creature. */
function exampleCard(t: Template, text: string): OracleCard {
  if ((t.kind === 'effect' || t.kind === 'rider') && !text.includes(':') && !/^(When|Whenever|At)\b/.test(text)) return card('Example Volley', 'Sorcery', text);
  return card('Example Brute', 'Creature — Elf Warrior', text, { power: '3', toughness: '3' });
}
const parsedWith = (t: Template, text: string) => parseCard(exampleCard(t, text), OPTS).faces[0]!;

describe('std-rx27 template file (design 6.3, 6.9; CONTRIBUTING "Adding a template")', () => {
  it('is loaded by the default compiler (zz-cloud/std-rx27.json, after std-rx19.json, before std-rx3.json and std-sos.json) and its ids are unique in the whole set', () => {
    const files = TEMPLATE_FILES.map((f) => f.file);
    expect(files).toContain('zz-cloud/std-rx27.json');
    expect(files.indexOf('zz-cloud/std-rx27.json')).toBeGreaterThan(files.indexOf('zz-cloud/std-rx19.json'));
    expect(files.indexOf('zz-cloud/std-rx27.json')).toBeLessThan(files.indexOf('zz-cloud/std-rx3.json'));
    expect(files.indexOf('zz-cloud/std-rx27.json')).toBeLessThan(files.indexOf('zz-cloud/std-sos.json'));
    expect(files.indexOf('zz-cloud/std-rx27.json')).toBeLessThan(files.findIndex((f) => f.startsWith('zz-fast1/')));
    const ids = TEMPLATE_SET.map((t) => t.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(validateTemplates([...TEMPLATE_SET])).toEqual([]);
  });
  it('design 6.9: every template cites rules, has at least two examples and two counter-examples, a status, and is of version 8; ids are eff.rx27.*, sta.rx27.* or rid.rx27.*', () => {
    expect(MECH.length).toBe(MECH_COUNT);
    for (const t of MECH) {
      expect(t.id, t.id).toMatch(/^(eff|sta|rid)\.rx27\./);
      expect(t.cr.length, t.id).toBeGreaterThan(0);
      for (const cr of t.cr) expect(cr, t.id).toMatch(/^CR \d{3}(\.\d+[a-z]?)?$/);
      expect(t.examples.length, t.id).toBeGreaterThanOrEqual(2);
      expect(t.counterExamples.length, t.id).toBeGreaterThanOrEqual(2);
      expect(['stable', 'experimental'], t.id).toContain(t.status);
      expect(t.since, t.id).toBe(8);
    }
  });
  it('design 6.9: a stable template has its evidence, hand-verified golden cards (Standard, or the tuning half) that use it (the review file pins each card as full)', () => {
    const golden = review as { card: string; verified: string; expect?: string }[];
    for (const t of MECH.filter((x) => x.status === 'stable')) {
      const cards = golden.filter((g) => g.verified.includes(`(${t.id}`) || g.verified.includes(` ${t.id}`) || g.verified.includes(`${t.id},`)).map((g) => g.card);
      expect(cards.length, t.id).toBeGreaterThanOrEqual(1);
    }
    for (const g of golden) expect(g.expect, g.card).toBe('full');
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

describe('std-rx27 guard G9 (design 6.8): examples and counter-examples', () => {
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

/** Near-miss mutations of one example sentence (design 6.8 G9): each must not parse, or parse to different JSON. */
function nearMisses(text: string): string[] {
  const body = text.replace(/\.$/, '');
  const out = [`${body} unless it is blue.`, `${body} instead.`, `${body} at random.`, `${body} twice.`, `${body} if able.`];
  const swaps: [RegExp, string][] = [
    [/\buntil end of turn\b/, 'until your next turn'], [/\bor more\b/, 'or fewer'], [/\beach\b/, 'all'], [/\bget\b/, 'gain'], [/\bgain\b/, 'lose'], [/\bhas\b/, 'loses'],
    [/\bDuring your turn\b/, 'During your end step'], [/\bflash\b/, 'haste'], [/\bits owner's control\b/, 'your control'], [/\binto your hand\b/, 'onto the battlefield'],
    [/\bmilled this way\b/, 'discarded this way'], [/\bloses all abilities\b/, 'loses flying'], [/\bmana cost\b/, 'power'],
    [/\byou own\b/, 'an opponent owns'], [/\bthis turn\b/, 'last turn'], [/\bOnce each turn\b/, 'Twice each turn'], [/\ba card exiled\b/, 'cards exiled'], [/\bthe top of your library\b/, 'your hand'],
    [/\bpermanent type\b/, 'card type'], [/\bany type\b/, 'any color'], [/\bcreature spell this way\b/, 'spell this way'],
  ];
  for (const [re, by] of swaps) if (re.test(text)) out.push(text.replace(re, by));
  return out;
}

describe('std-rx27 guard G9 (design 6.8): near-miss mutations fail or differ', () => {
  for (const t of MECH) {
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

describe('std-rx27 guard G2 (design 6.8): a nonsense word never leaves an automated card', () => {
  for (const t of MECH) {
    it(`${t.id}: replacing any one word of an example by an invented word makes the card not fully automated`, () => {
      for (const e of t.examples) {
        const words = e.text.split(' ');
        const labelEnd = words.indexOf('--'); // a flavor word before "--" has no rules meaning (CR 207.2d): any words may stand there
        words.forEach((w, i) => {
          if (i <= labelEnd) return;
          if (w === '~' || w === '~,' || /^\{/.test(w)) return;
          if (/^counters?[.,]?$/.test(words[i + 1] ?? '')) return; // the word in front of "counter(s)" is an open class by design (6.11, the CounterKind hole), as wp22-mutation.test.ts
          const end = w.match(/[.,]+$/)?.[0] ?? '';
          const mutated = [...words.slice(0, i), `blorfty${end}`, ...words.slice(i + 1)].join(' ');
          expect(fullyAutomated(parsedWith(t, mutated)), mutated).toBe(false);
        });
      }
    });
  }
});

const index = localIndex();

describe.skipIf(index === null)('std-rx27 design 6.10 (local index): synthetic examples', () => {
  it('no std-rx27 line of an example or counter-example is a line of a real card (with the card\'s own name or "this <type>" read as "~")', () => {
    const lines = new Set<string>();
    for (const c of index ?? []) {
      for (const text of [c.oracle_text, ...(c.card_faces ?? []).map((x) => x.oracle_text)]) {
        if (typeof text !== 'string') continue;
        for (const l of text.split('\n')) {
          lines.add(l.trim());
          lines.add(l.replaceAll(c.name, '~').replace(/\bthis (creature|land|artifact|enchantment|Aura|spell|card)\b/gi, '~').trim());
        }
      }
    }
    const verbatim = MECH.flatMap((t) => [...t.examples.map((e) => e.text), ...t.counterExamples].filter((x) => x.split('\n').some((l) => lines.has(l.trim()))).map((x) => `${t.id}: ${x}`));
    expect(verbatim).toEqual([]);
  }, 120_000);
});


// ---- the parser, model and renderer changes of the round, one test each ---------------------------------------------------------------------------------------

const creature = (text: string) => parseCard(card('Example Brute', 'Creature — Elf Warrior', text, { power: '3', toughness: '3' }), OPTS).faces[0]!;
const staticsOf = (f: ReturnType<typeof creature>): Record<string, unknown>[] => (bare(f.abilities) as Record<string, unknown>[]).filter((a) => a['kind'] === 'static');
const EXILER = "When ~ enters, exile the top two cards of target opponent's library.";

describe('std-rx27 model (CR 607.2a, 601.3e, 609.4b, 118.9, 614.1c, 400.7): the capabilities of static linked cast permissions with riders', () => {
  it('every rider has its capability, registered (statics/play-permits.ts#isLinkedRiderPermit, model/cap-walk.ts#linkedRiderFeatures)', () => {
    for (const c of ['permit:cast.linked', 'feature:permit.cast.linked.of', 'feature:permit.cast.linked.anyManaType', 'feature:permit.cast.linked.oncePerTurn', 'feature:permit.cast.linked.entersWith',
      'feature:permit.cast.linked.free', 'feature:permit.cast.linked.thisTurn', 'feature:permit.haveFlash.linked', 'feature:permit.play.single', 'feature:permit.cast.single',
      'feature:permit.cast.top.entersWith', 'feature:permit.play.zone.oncePerTurn', 'rulemod:activateAsUnactivated', 'feature:costMod.abilities.firstEachTurn', 'feature:cost.collectEvidence.link']) expect(ENGINE_CAPABILITIES.has(c), c).toBe(true);
    const f = creature(`${EXILER}\nOnce each turn, you may cast a spell with mana value less than or equal to the number of Elves you control from among cards exiled with ~ this turn without paying its mana cost.`);
    const caps = capabilitiesOfDef(f.abilities[1] as never);
    expect(caps).toEqual(expect.arrayContaining(['permit:cast.linked', 'feature:permit.cast.linked.of', 'feature:permit.cast.linked.oncePerTurn', 'feature:permit.cast.linked.free', 'feature:permit.cast.linked.thisTurn']));
    expect(caps).not.toContain('rfilter:putThereThisTurn'); // judged on the card where it is (statics/play-permits.ts#linkedOf)
  });
  it('a resolved effect with a rider form, or a rider the engine does not read, is a form nothing registers (fail closed)', () => {
    const lasting = { kind: 'activated', cost: { mana: [{ kind: 'generic', amount: 1 }] }, effect: { targets: [], steps: [{ op: 'effect', duration: { d: 'endOfTurn' }, effects: [
      { s: 'permit', who: { ref: 'you' }, action: 'cast', of: { is: { ref: 'linked', link: 'exiled' }, owner: 'you' }, entersWith: [{ kind: 'finality', count: 1 }] }] }] } };
    expect(capabilitiesOfDef(lasting as never)).toContain('feature:permit.cast.linked.lasting');
    // (std-exile-play-2-1 registers an additional cost on this form, `feature:permit.cast.linked.addCost`; a count of spells is still a rider nothing reads)
    const odd = { kind: 'static', effects: [{ s: 'permit', who: { ref: 'you' }, action: 'cast', of: { is: { ref: 'linked', link: 'exiled' } }, count: 2 }] };
    expect(capabilitiesOfDef(odd as never).some((c) => !ENGINE_CAPABILITIES.has(c))).toBe(true);
  });
});

describe('std-rx27 model (CR 601.3, 611.2a): "you may play a card exiled with ~" is one card, only for a permission that lasts until end of turn', () => {
  it('the one-card field is registered on a permission for named objects until end of turn; with another duration it is a form nothing registers', () => {
    const permit = { s: 'permit', who: { ref: 'you' }, action: 'play', of: { is: { ref: 'linked', link: 'exiled' } }, single: true };
    const eot = { kind: 'triggered', trigger: { on: [{ ev: 'attacks', attacker: { self: true } }] }, effect: { targets: [], steps: [{ op: 'effect', duration: { d: 'endOfTurn' }, effects: [permit] }] } };
    const next = { kind: 'triggered', trigger: { on: [{ ev: 'attacks', attacker: { self: true } }] }, effect: { targets: [], steps: [{ op: 'effect', duration: { d: 'untilYourNextTurn' }, effects: [permit] }] } };
    expect(capabilitiesOfDef(eot as never)).toContain('feature:permit.play.single');
    expect(capabilitiesOfDef(next as never)).toContain('feature:permit.play.single.other');
    expect(ENGINE_CAPABILITIES.has('feature:permit.play.single.other')).toBe(false);
  });
});

describe('std-rx27 renderer (render/stat.ts#linkedPermitsText, #topEntersRider; render/abil.ts family during-turn)', () => {
  it('"you may cast cards exiled with ~ and you may cast them as though they had flash" is a cast and a flash permission of the same linked cards', () => {
    const f = creature(`${EXILER}\nDuring your turn, you may cast cards exiled with ~ and you may cast them as though they had flash. Mana of any type can be spent to cast those spells.`);
    expect(fullyAutomated(f), JSON.stringify(f.diagnostics)).toBe(true);
    expect(staticsOf(f)[0]).toMatchObject({ condition: { cond: 'turnOf', whose: 'you' }, effects: [{ action: 'cast', anyManaType: true }, { action: 'haveFlash' }] });
  });
  it('"during each of your turns" is "during your turn" (CR 500.1, 611.3a)', () => {
    const a = creature('During each of your turns, you may play a land and cast a permanent spell of each permanent type from your graveyard.');
    expect(fullyAutomated(a), JSON.stringify(a.diagnostics)).toBe(true);
    expect(staticsOf(a)[0]!['condition']).toEqual({ cond: 'turnOf', whose: 'you' });
  });
  it('the "enters with" rider of a top-card permission reads "an additional" and "a"; without the rider sentence the permission has none', () => {
    const a = creature('You may play lands and cast Elf spells from the top of your library. If you cast a creature spell this way, that creature enters with an additional +1/+1 counter on it.');
    const b = creature('You may play lands and cast Elf spells from the top of your library. If you cast a creature spell this way, that creature enters with a +1/+1 counter on it.');
    expect(fullyAutomated(a) && fullyAutomated(b)).toBe(true);
    expect(jsonKey(a.abilities)).toBe(jsonKey(b.abilities));
    const c = creature('You may play lands and cast Elf spells from the top of your library.');
    expect(JSON.stringify(bare(c.abilities))).not.toContain('entersWith');
  });
});

describe('std-rx27 lowering (CR 603.2h): "Do this only once each turn." on an optional cast after looks (parser/lower/ability.ts#onceCastAt)', () => {
  it('limits the triggered ability by its cast (the action), named so effects/run.ts can tell it was taken', () => {
    const f = parseCard(card('Example Relic', 'Artifact', 'Whenever you scry, look at the top card of your library. You may cast that card without paying its mana cost. Do this only once each turn.'), OPTS).faces[0]!;
    expect(fullyAutomated(f), JSON.stringify(f.diagnostics)).toBe(true);
    const t = (bare(f.abilities) as Record<string, unknown>[])[0]!;
    expect(t['limit']).toEqual({ per: 'turn', max: 1, action: true });
    expect(JSON.stringify(t)).toContain('"op":"cast"');
    expect(JSON.stringify(t)).toContain('"as":"once"');
  });
  it('another step before the cast (not a look) is not this reading', () => {
    const f = parseCard(card('Example Relic', 'Artifact', 'Whenever you scry, draw a card. You may cast a creature card from your hand without paying its mana cost. Do this only once each turn.'), OPTS).faces[0]!;
    expect(fullyAutomated(f)).toBe(false);
  });
});

describe('std-rx27 batch 2 model and lowering (CR 601.2f-h, 602.2b, 601.3, 609.4b, 122.1)', () => {
  const relic = (text: string) => parseCard(card('Example Relic', 'Artifact', text), OPTS).faces[0]!;
  const TAP = "For each mana in this ability's activation cost, you may tap an untapped creature you control rather than pay that mana.";
  it('"For each mana in this ability\'s activation cost, you may tap an untapped creature you control rather than pay that mana." is `tapForMana`, registered', () => {
    const f = relic(`{2}, {T}: You gain 3 life. ${TAP}`);
    expect(fullyAutomated(f), JSON.stringify(f.diagnostics)).toBe(true);
    const a = (bare(f.abilities) as Record<string, unknown>[])[0]!;
    expect(a['tapForMana']).toEqual({ types: ['Creature'], controller: 'you' });
    expect(capabilitiesOfDef(f.abilities[0] as never)).toContain('feature:activate.tapForMana');
    expect(ENGINE_CAPABILITIES.has('feature:activate.tapForMana')).toBe(true);
  });
  it('with colored mana in the cost, or another kind of permanent named without a controller, it is not automated (fail closed)', () => {
    const colored = relic(`{1}{G}, {T}: You gain 3 life. ${TAP}`); // the reading is made; the engine does not offer it (compileCard: manual, needs-engine)
    expect(capabilitiesOfDef(colored.abilities[0] as never)).toContain('feature:activate.tapForMana.unsupported');
    expect(ENGINE_CAPABILITIES.has('feature:activate.tapForMana.unsupported')).toBe(false);
    expect(fullyAutomated(relic("{2}, {T}: You gain 3 life. For each mana in this ability's activation cost, you may tap an untapped creature rather than pay that mana."))).toBe(false);
  });
  it('a static exile permission by description is `permit:play.exile` with its any-type rider; a resolved one is a form nothing registers', () => {
    const f = creature("During your turn, you may play cards you don't own with hoard counters on them from exile, and mana of any type can be spent to cast those spells.");
    expect(fullyAutomated(f), JSON.stringify(f.diagnostics)).toBe(true);
    const caps = capabilitiesOfDef(f.abilities[0] as never);
    expect(caps).toEqual(expect.arrayContaining(['permit:play.exile', 'feature:permit.play.exile.anyManaType']));
    const lasting = { kind: 'activated', cost: { mana: [{ kind: 'generic', amount: 1 }] }, effect: { targets: [], steps: [{ op: 'effect', duration: { d: 'endOfTurn' }, effects: [
      { s: 'permit', who: { ref: 'you' }, action: 'play', from: 'exile', of: { counters: { kind: 'hoard' }, isCard: true } }] }] } };
    expect(capabilitiesOfDef(lasting as never)).toContain('feature:permit.play.exile.lasting');
    expect(ENGINE_CAPABILITIES.has('feature:permit.play.exile.lasting')).toBe(false);
  });
});
