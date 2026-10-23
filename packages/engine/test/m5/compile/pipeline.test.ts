/**
 * WP18: the compile pipeline (cards/pipeline.ts#compileCardV2) as the default compiler: steps 0, 8 and 9 of design 6.1, the caps of 10.4 and 12.4, the
 * native recognizers kept below the parser, and the shape of CardAutomation. Synthetic cards (design 6.10) unless a fixture card is the point.
 */
import { describe, expect, it } from 'vitest';
import {
  COMPILER_VERSION, ENGINE_CAPABILITIES, compileCard, compileCardV2, defaultCompileSources, pipelineCompiler, textHash, validateAbility,
  type KeywordAbilityDef, type ManualAbilityDef, type Template,
} from '../../../src/index';
import { BOOTSTRAP_TEMPLATES } from '../../../src/parser/parse';
import { compiledDef, getCard } from '../../fixtures';
import { abilities, card, compile, creature, kinds } from './helpers';
import { act, answer, castAuto, find, passBoth, scenario, zoneNames } from '../../m3/scenario';

describe('the default compiler is the compile pipeline (design 6.1, 15.2 WP18)', () => {
  it('compileCard(card) is compileCardV2(card, defaultCompileSources()), and pipelineCompiler names the same thing', () => {
    const c = card('Test Card deals 3 damage to any target.');
    expect(compileCard(c)).toEqual(compileCardV2(c, defaultCompileSources()));
    expect(compileCard(c, pipelineCompiler)).toEqual(compileCard(c));
  });

  it('the default sources classify against the engine capability set the package entry installs', () => {
    const src = defaultCompileSources();
    expect(src.caps).toBe(ENGINE_CAPABILITIES);
    expect(src.parse.capabilities).toBe(ENGINE_CAPABILITIES);
    expect(src.trust).toBe('autoverified'); // design 11.5: the default llmTrust (it matters only with an LLM cache or LLM data in a pack)
    expect(src.compilerVersion).toBe(COMPILER_VERSION);
  });

  it('CR 120.3: a damage spell is fully automated, with a complete CardAutomation (faces, autoRatio, textHash, compilerVersion)', () => {
    const { def, report } = compile(card('Test Card deals 3 damage to any target.'));
    expect(kinds(def)).toEqual(['spell']);
    expect(def.automation).toMatchObject({ level: 'full', unsupported: [], source: 'templates', autoRatio: 1, compilerVersion: COMPILER_VERSION });
    expect(def.automation.textHash).toBe(textHash(['Test Card deals 3 damage to any target.']));
    expect(def.automation.faces).toEqual([{ abilities: [{ level: 'full', manual: [] }] }]);
    expect(report.templatesUsed).toContain('eff.damage');
    for (const a of abilities(def)) expect(validateAbility(a).filter((i) => i.severity === 'error')).toEqual([]);
  });

  it('design 8.8 (determinism): the same card compiles to the same JSON every time', () => {
    const c = creature('Flying\nWhen this creature enters, draw a card.\nFrobnicate the quux.');
    expect(JSON.stringify(compileCard(c))).toBe(JSON.stringify(compileCard(c)));
  });

  it('design 10.3: partial when some text is manual, manual when nothing is automated, full for a vanilla card', () => {
    expect(compile(creature('Flying\nFrobnicate the quux.')).def.automation.level).toBe('partial');
    expect(compile(creature('Frobnicate the quux.')).def.automation).toMatchObject({ level: 'manual', source: 'none', autoRatio: 0, unsupported: ['Frobnicate the quux.'] });
    expect(compile(creature('')).def.automation).toMatchObject({ level: 'full', unsupported: [], autoRatio: 1 });
  });

  it('design 6.2: abilities are in printed line order (one ability per line; ability keys p:<face>:<index> follow the card)', () => {
    const def = compileCard(creature('Flying\n{T}: Add {G}.\nHaste'));
    expect(abilities(def).map((a) => (a.kind === 'keyword' ? a.keyword : a.kind))).toEqual(['flying', 'activated', 'haste']);
    expect(abilities(def).map((a) => a.src)).toEqual([[0], [1], [2]]);
  });
});

describe('design 10.2: the capability degrade runs on every ability against `caps`', () => {
  it('a capability the build lacks makes the unit manual and is listed in requiresEngine', () => {
    const caps = new Set([...ENGINE_CAPABILITIES].filter((c) => c !== 'op:damage'));
    const { def } = compile(card('Test Card deals 3 damage to any target.'), { caps });
    expect(def.automation.level).toBe('manual');
    expect(def.automation.requiresEngine).toContain('op:damage');
  });

  it('a keyword the engine does not implement is manual and names the capability (CR 702.38 amplify; FAST5X E28 implements persist, std-ry8 enlist)', () => {
    const { def } = compile(creature('Amplify 1'));
    expect(abilities(def)[0]).toMatchObject({ kind: 'manual' });
    expect((abilities(def)[0] as ManualAbilityDef).reason).toContain('keyword:amplify');
    expect(def.automation.requiresEngine).toContain('keyword:amplify');
  });

  it('with no capabilities at all nothing is automated (fail closed)', () => {
    const { def } = compile(creature('Flying\nWhen this creature enters, draw a card.'), { caps: new Set(), parse: { ...defaultCompileSources().parse, capabilities: new Set() } });
    expect(def.automation.level).toBe('manual');
  });
});

describe('design 10.4: overrides and caps', () => {
  it('forceManual: every ability becomes manual (reason forceManual), nothing keeps an automated effect, the card is manual', () => {
    const c = creature('Flying\n{T}: Add {G}.\nWhen this creature enters, draw a card.', { name: 'Test Forced' });
    const { def } = compile(c, { forceManual: new Set(['Test Forced']) });
    expect(def.automation.level).toBe('manual');
    expect(kinds(def)).toEqual(['manual', 'manual', 'manual']);
    for (const a of abilities(def)) {
      expect((a as ManualAbilityDef).reason).toBe('forceManual');
      expect((a as ManualAbilityDef).effect).toBeUndefined();
    }
    expect(abilities(def)[1]).toMatchObject({ shape: 'activated', mana: true, cost: { tap: true } }); // the understood cost is still paid (CR 605.3b)
    expect(def.automation.faces![0]!.abilities.every((a) => a.manual[0]?.reason === 'forceManual')).toBe(true);
    // a face name of a multi-faced card counts too
    const split = card('', { name: 'Test Up // Test Down', layout: 'split', card_faces: [{ name: 'Test Up', type_line: 'Instant', mana_cost: '{R}', oracle_text: 'Draw a card.' }, { name: 'Test Down', type_line: 'Instant', mana_cost: '{U}', oracle_text: 'Draw a card.' }] });
    expect(compile(split, { forceManual: new Set(['Test Down']) }).def.automation.level).toBe('manual');
    expect(compile(split).def.automation.level).toBe('full');
  });

  it('design 6.9: a card whose result used an experimental template is capped at partial', () => {
    const templates: Template[] = BOOTSTRAP_TEMPLATES.map((t) => (t.id === 'eff.damage' ? { ...t, status: 'experimental' as const } : t));
    const { def } = compile(card('Test Card deals 3 damage to any target.'), { parse: { ...defaultCompileSources().parse, templates } });
    expect(abilities(def)[0]!.kind).toBe('spell');
    expect(def.automation.level).toBe('partial');
  });

  // M6-4 lifted meld (cards/layout-support/dfc.ts: melding works, test/m6/dfc/meld.test.ts); M6-6 lifted prototype and case (cards/layout-support/layouts.ts):
  // a card of those layouts is classified by its text; M6-9 lifted mutate (cards/layout-support/merge.ts, test/m6/mutate/)
  it('design 12.4: layouts whose structure is not implemented are manual whatever their text says (planar, scheme, vanguard)', () => {
    expect(compileCard(creature('Flying', { layout: 'meld' })).automation.level).toBe('full'); // M6-4
    expect(compileCard(creature('Flying', { layout: 'mutate' })).automation.level).toBe('full'); // M6-9
    for (const layout of ['planar', 'scheme', 'vanguard']) {
      const def = compileCard(creature('Flying', { layout }));
      expect(def.automation.level, layout).toBe('manual');
      expect(def.automation.unsupported.some((u) => u.startsWith(`layout ${layout}`)), layout).toBe(true);
      // WP18 review: the abilities are demoted with the cap's reason (as forceManual does): the level, the statuses and the spans agree (design 10.3, 10.5)
      expect(abilities(def)[0], layout).toMatchObject({ kind: 'manual', reason: expect.stringMatching(new RegExp(`^layout ${layout}`)) });
      expect(def.automation.faces![0]!.abilities[0]!.level, layout).toBe('manual');
    }
    expect(compileCard(creature('Flying', { layout: 'leveler' })).automation.level).toBe('full');
    expect(compileCard(creature('Flying', { layout: 'saga' })).automation.level).toBe('full');
    for (const layout of ['prototype', 'case']) expect(compileCard(creature('Flying', { layout })).automation.level, layout).toBe('full'); // M6-6
  });
});

describe('contract C1 cases: layouts, faces, costs the engine cannot read', () => {
  it('CR 107.4, 202.1b: a mana cost with a symbol CR 107.4 does not define compiles: no mana cost, a manual card, a manual ability naming the symbol, requiresEngine mana:{D}', () => {
    const def = compileCard(creature('Flying', { mana_cost: '{2}{R}{D}' }));
    expect(def.faces[0]!.manaCost).toBeNull();
    expect(def.automation.level).toBe('manual'); // WP18 review: the engine can't cast the card (CR 202.1b), so nothing of it is automated
    expect(def.automation.requiresEngine).toContain('mana:{D}');
    const last = abilities(def).at(-1) as ManualAbilityDef;
    expect(last).toMatchObject({ kind: 'manual', text: 'Mana cost {2}{R}{D}', shape: 'static' });
    expect(last.reason).toMatch(/Unknown mana symbol \{D\}.*CR 107\.4/);
    expect(abilities(def)[0]!.kind).toBe('manual'); // the printed keyword is demoted with the cap's reason; the cost ability is appended (keys kept)
  });

  it('CR 709, 712, 715, 710: split, double-faced, adventurer and flip cards have one face each with their own abilities', () => {
    for (const name of ['Fire // Ice', 'Delver of Secrets // Insectile Aberration', 'Bonecrusher Giant // Stomp', 'Bushi Tenderfoot // Kenzo the Hardhearted']) {
      const def = compiledDef(name);
      expect(def.faces, name).toHaveLength(2);
      expect(def.automation.faces, name).toHaveLength(2);
      def.faces.forEach((f, i) => expect(def.automation.faces![i]!.abilities, `${name} face ${i}`).toHaveLength(f.abilities.length));
    }
  });

  it('CR 702.102d: the halves of a split card get distinct target ids, so a fused spell announces both targets', () => {
    const def = compiledDef('Wear // Tear');
    const ids = def.faces.flatMap((f) => f.abilities.flatMap((a) => (a.kind === 'spell' ? a.effect.targets.map((t) => t.id) : [])));
    expect(ids).toEqual(['t0', 't1']);
    const tear = def.faces[1]!.abilities.find((a) => a.kind === 'spell')!;
    expect(JSON.stringify(tear)).toContain('"ref":"target","id":"t1"');
  });

  it('a token and a card with no text compile; a basic land is full (its mana ability is rule-generated, CR 305.6)', () => {
    expect(compileCard({ name: 'Test Token', layout: 'token', type_line: 'Token Creature — Soldier', power: '1', toughness: '1', oracle_text: '' } as never).isToken).toBe(true);
    expect(compiledDef('Forest').automation.level).toBe('full');
  });
});

describe('the native recognizers of milestones 3/4 (cards/native.ts) below the parser: no regression of what milestone 4 automated', () => {
  it('CR 702.14: a landwalk line a STABLE template reads belongs to the template (Swampwalk, W3b: the whole template set is the default)', () => {
    const { def, report } = compile(creature('Swampwalk'));
    expect(abilities(def)).toMatchObject([{ kind: 'keyword', keyword: 'landwalk', quality: 'swamp', src: [0] }]);
    expect(abilities(def)[0]!.prov?.by).not.toBe('native');
    expect(def.automation.level).toBe('full');
    expect(report.faces[0]!.nativeLines).toEqual([]);
  });

  it('W3b, CR 702.14c, design 6.9: kw.walk.mountain (stable since the W3b template review) reads Mountainwalk with the JSON the recognizer gave, the card full', () => {
    const { def, report } = compile(creature('Mountainwalk'));
    expect(abilities(def)).toMatchObject([{ kind: 'keyword', keyword: 'landwalk', quality: 'mountain', src: [0], prov: { by: 'keyword', id: 'landwalk' } }]);
    expect(def.automation.level).toBe('full');
    expect(report.faces[0]!.nativeLines).toEqual([]);
    expect(report.templatesUsed).toContain('kw.walk.mountain');
  });

  it('CR 702.16g, D14: "protection from X and from Y" (Mirran Crusader) is read by the recognizer, and since FAST2 T7 the gate prints it: used', () => {
    const { def, report } = compile(getCard('Mirran Crusader'));
    expect(report.faces[0]!.nativeLines).toEqual([0]);
    expect(report.faces[0]!.nativeUngated).toEqual([]);
    expect(def.automation.level).toBe('full');
    expect(abilities(def).filter((a) => a.prov?.by === 'native').map((a) => (a as { quality?: string }).quality ?? (a as { keyword?: string }).keyword)).toEqual(['double strike', 'color:B', 'color:G']);
  });

  it('CR 605: mana abilities are automated by their stable template; a choice of three colors is printed since T3 (D14)', () => {
    // W3b: lines a stable template reads (Add {W}, any color, and since the template review {G}{G} and {C}{C}{C}) are the template's; FAST2 T7: every
    // run of symbols and every list of choices is read by eff.t7.mana.units ({U}{U}{U} went to the recognizer before), so no mana line is left to it
    for (const text of ['{T}: Add {W}.', '{T}: Add one mana of any color.', '{T}: Add {G}{G}.', '{T}: Add {C}{C}{C}.', '{T}: Add {U}{U}{U}.']) {
      const { def } = compile(creature(text));
      expect(abilities(def), text).toMatchObject([{ kind: 'activated', isMana: true, prov: { by: 'template' } }]);
      expect(def.automation.level, text).toBe('full');
    }
    // T3 (push wave): the renderer prints a choice of three colors ("{R}, {G}, or {W}", CR 106.1), so the recognizer's gated, fully automated reading
    // passes the render gate and the card is full (no template reads the line: the T3 review dropped the per-combination mana templates)
    const { def, report } = compile(creature('{T}: Add {R}, {G}, or {W}.'));
    expect(report.faces[0]!.nativeUngated).toEqual([]);
    expect(abilities(def)[0]).toMatchObject({ kind: 'activated', isMana: true, effect: { steps: [{ op: 'addMana', units: [['R', 'G', 'W']] }] } });
    expect(def.automation.level).toBe('full');
  });

  it('CR 614.1c: "enters with N counters" is automated (Endless One); CR 601.3, D14: a timing restriction the renderer cannot print yet stays manual', () => {
    expect(compiledDef('Endless One').automation.level).toBe('full');
    // FAST4 T32 automates "only during combat" (rst.t32.cast.self.combat, CR 506.1); p2-combat-flow-1 prints "during the declare blockers step" (render/stat.ts);
    // "during an opponent's upkeep" is still left to the native recognizer
    const { def, report } = compile(card('Cast this spell only during an opponent\'s upkeep.\nDraw a card.'));
    expect(report.faces[0]!.nativeUngated).toEqual([0]);
    expect(abilities(def)[0]).toMatchObject({ kind: 'manual', text: 'Cast this spell only during an opponent\'s upkeep.' }); // read as printed: core checks it by hand
  });

  it('a line the parser understood is never replaced, and a line no recognizer reads stays manual', () => {
    const { def, report } = compile(creature('Flying\nFrobnicate the quux.'));
    expect(report.faces[0]!.nativeLines).toEqual([]);
    expect(abilities(def)[0]!.prov).toMatchObject({ by: 'keyword' });
    expect(abilities(def)[1]!.kind).toBe('manual');
  });

  // W3 integration: ward is implemented since WP32 (keyword:ward), so the unimplemented keyword here was rampage (CR 702.23); CMD3 implements rampage, so it is absorb (CR 702.64).
  it('a line that only partly matches a recognizer is not taken (milestone 4 "leftover" rule): "Flying, absorb 2" keeps absorb manual', () => {
    const { def, report } = compile(creature('Flying, absorb 2'));
    expect(kinds(def)).toEqual(['keyword', 'manual']);
    expect(def.automation).toMatchObject({ level: 'partial', unsupported: ['absorb 2'] });
    expect(report.faces[0]!.nativeLines).toEqual([]);
  });
});

describe('manual abilities read as printed (milestone 4 behavior the engine relies on)', () => {
  it('the text of a manual ability is its printed line: the card\'s own name and words, reminder text removed', () => {
    const { def } = compile(card('Cast this spell only if you were dealt damage this turn by a red instant or sorcery spell.\nDraw a card.', { name: 'Test Cond' }));
    expect(abilities(def)[0]).toMatchObject({ kind: 'manual', text: 'Cast this spell only if you were dealt damage this turn by a red instant or sorcery spell.' });
    const persist = compile(creature('Persist (When this creature dies, return it.)')).def;
    expect(abilities(persist)[0]!.text).toBe('Persist');
  });

  it('CR 614.1c: a manual ability that says the permanent enters with counters carries the entersWithCounters flag (core/zones.ts asks for them)', () => {
    const { def } = compile(creature('This creature enters with a +1/+1 counter on it for each opponent you have.'));
    expect(abilities(def)[0]).toMatchObject({ kind: 'manual', entersWithCounters: true });
  });
});

describe('end to end through applyAction (real neighbors, no mocks)', () => {
  it('CR 702.102a-d: fused Wear // Tear announces a target per half and destroys both (the halves\' target ids do not collide)', () => {
    const NAME = 'Wear // Tear';
    let s = scenario([NAME, 'Mountain', 'Plains', 'Sol Ring', 'Glorious Anthem'], { p1: { hand: [NAME], battlefield: ['Mountain', 'Mountain', 'Plains'] }, p2: { battlefield: ['Sol Ring', 'Glorious Anthem'] } });
    const ring = find(s, 'Sol Ring', 'battlefield');
    const anthem = find(s, 'Glorious Anthem', 'battlefield');
    s = act(s, { type: 'cast', player: 'p1', card: find(s, NAME, 'hand'), method: 'fuse' });
    expect(s.pending).toMatchObject({ kind: 'chooseTargets', targetText: 'target artifact' });
    s = answer(s, { kind: 'chooseTargets', targets: [{ kind: 'object', id: ring }] });
    expect(s.pending).toMatchObject({ kind: 'chooseTargets', targetText: 'target enchantment' });
    s = answer(s, { kind: 'chooseTargets', targets: [{ kind: 'object', id: anthem }] });
    s = answer(s, { kind: 'payCost', auto: true });
    s = passBoth(s);
    expect(s.pending).toMatchObject({ kind: 'priority' }); // resolved by the interpreter, no manualResolve
    expect(zoneNames(s, 'graveyard', 'p2').sort()).toEqual(['Glorious Anthem', 'Sol Ring']);
    expect(zoneNames(s, 'graveyard', 'p1')).toEqual([NAME]);
  });

  it('CR 120.3, 704.5g: Lightning Bolt from the default compiler resolves through the interpreter (no manualResolve)', () => {
    let s = scenario(['Lightning Bolt', 'Mountain', 'Grizzly Bears'], { p1: { hand: ['Lightning Bolt'], battlefield: ['Mountain'] }, p2: { battlefield: ['Grizzly Bears'] } });
    const bears = find(s, 'Grizzly Bears', 'battlefield');
    s = castAuto(s, 'Lightning Bolt', { answers: [{ kind: 'chooseTargets', targets: [{ kind: 'object', id: bears }] }] });
    s = passBoth(s);
    expect(s.pending).toMatchObject({ kind: 'priority' });
    expect(zoneNames(s, 'graveyard', 'p2')).toEqual(['Grizzly Bears']);
    expect(s.log.some((l) => l.level === 'manual')).toBe(false);
  });
});
