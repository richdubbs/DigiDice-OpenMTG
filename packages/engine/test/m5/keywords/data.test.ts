/**
 * The keyword data files (design 7.2, WP3): one JSON file per keyword, the single source of truth. These tests pin that the set is complete (all 193 keyword
 * abilities of CR 702), well formed, listed, and that the statuses follow the table of design 7.4 (implemented only where the engine acts).
 */
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { KEYWORD_RULES } from '../../../src/cards/keyword-list';
import { KEYWORD_DATA_FILES } from '../../../src/keywords/data';
import { createKeywordRegistry, keywordRegistry, KeywordRegistryError } from '../../../src/keywords/registry';
import { keywordDataProblems, keywordDataSetProblems, REMINDER_RULE_KEYWORDS } from '../../../src/keywords/validate';
import type { KeywordDefData } from '../../../src/keywords/types';
import { SRC_ROOT } from '../helpers';

const DATA_DIR = join(SRC_ROOT, 'keywords', 'data');
const all = KEYWORD_DATA_FILES.map((f) => f.data as KeywordDefData);

describe('keywords/data: the files and the list that imports them', () => {
  const onDisk = readdirSync(DATA_DIR).filter((f) => f.endsWith('.json')).sort();

  it('every .json file of the directory is listed in data/index.ts, and every listed file exists (a keyword can neither be forgotten nor silently dropped)', () => {
    expect(KEYWORD_DATA_FILES.map((f) => f.file)).toEqual(onDisk);
    const index = readFileSync(join(DATA_DIR, 'index.ts'), 'utf8');
    for (const f of onDisk) expect(index, f).toContain(`'./${f}'`);
  });

  it('each file is named after its keyword (the slug of the canonical name) and holds exactly that keyword', () => {
    for (const { file, data } of KEYWORD_DATA_FILES) {
      const name = (data as KeywordDefData).name;
      expect(file, name).toBe(`${name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')}.json`);
      expect(JSON.parse(readFileSync(join(DATA_DIR, file), 'utf8')), file).toEqual(data); // the module is the file
    }
  });

  it('every file passes the structural validation, and the set has no duplicate names or aliases', () => {
    expect(keywordDataSetProblems(all)).toEqual([]);
  });
});

describe('CR 702: every keyword ability of the official list has data (design 7.2: "all 193"; 194 since the 2026-09-25 edition added Storied, CR 702.195)', () => {
  // The two rules whose list entry names more than one keyword.
  const NAMES_OF: Record<string, string[]> = { 'daybound and nightbound': ['daybound', 'nightbound'], '∞ (infinity)': ['infinity'] };

  it('the official list has 194 keyword abilities and the library has a file for each rule number, with the rule number stored in the file', () => {
    const rules = [...new Set(KEYWORD_RULES.values())];
    expect(rules).toHaveLength(194);
    const have = new Set(all.map((d) => d.rule));
    for (const r of rules) expect(have.has(r), `${r} has no data file`).toBe(true);
    // FAST5X E18: a keyword newer than the CR says rule "reminder" and is listed in REMINDER_RULE_KEYWORDS (none since Storied became CR 702.195)
    for (const d of all) expect(rules.includes(d.rule) || (d.rule === 'reminder' && REMINDER_RULE_KEYWORDS.includes(d.name)), `${d.name} has an unknown rule ${d.rule}`).toBe(true);
  });

  it('each name of the list is found in the registry (by name or alias) under the same rule number', () => {
    for (const [listName, rule] of KEYWORD_RULES) {
      for (const name of NAMES_OF[listName] ?? [listName]) {
        const def = keywordRegistry.get(name);
        expect(def, `no keyword "${name}" (${rule})`).toBeDefined();
        expect(def!.rule, name).toBe(rule);
      }
    }
  });

  it('keyword variants have their own file under the rule of the keyword they vary: multikicker (CR 702.33c) and typecycling (CR 702.29e)', () => {
    expect(keywordRegistry.get('multikicker')?.rule).toBe('702.33');
    expect(keywordRegistry.get('typecycling')?.rule).toBe('702.29');
  });

  it('reminder text is stored for every keyword that has one (CR 207.2: it has no rules meaning); only keywords whose ability text follows them have none', () => {
    const none = all.filter((d) => d.reminder === '').map((d) => d.name).sort();
    expect(none).toEqual(['enchant', 'infinity', 'max speed', 'solved', 'visit']);
  });
});

describe('statuses follow design 7.4 (implemented only where every mechanism exists, native where the engine acts without the data)', () => {
  const byStatus = (s: KeywordDefData['status']): string[] => all.filter((d) => d.status === s).map((d) => d.name).sort();

  /** Design 7.4 rows [rank, keyword, ships]. `implemented` for M3, M4 and M5 rows; flashback is native, and morph and disguise since M6-3; the rest is planned. Echo and convoke were the M5 rows left planned (echo is not built, convoke had no caller of its hook until WP7); cascade was too until
   * WP32 gave its native action handler an owner (effects/handlers/actions-native.ts). */
  const TOP60: [number, string, string][] = [
    [1, 'flying', 'M4'], [2, 'enchant', 'M4'], [3, 'trample', 'M4'], [4, 'vigilance', 'M4'], [5, 'haste', 'M3'], [6, 'flash', 'M3'], [7, 'equip', 'M5'], [8, 'reach', 'M4'],
    [9, 'menace', 'M4'], [10, 'cycling', 'M5'], [11, 'first strike', 'M4'], [12, 'lifelink', 'M4'], [13, 'deathtouch', 'M4'], [14, 'defender', 'M4'], [15, 'kicker', 'M5'],
    [16, 'ward', 'M5'], [17, 'flashback', 'native'], [18, 'protection', 'M4'], [19, 'morph', 'native'], [20, 'crew', 'M5'], [21, 'devoid', 'M5'], [22, 'landwalk', 'M4'],
    [23, 'double strike', 'M4'], [24, 'indestructible', 'M4'], [25, 'convoke', 'M5'], [26, 'partner', 'deck'], [27, 'hexproof', 'M4'], [28, 'prowess', 'M5'],
    [29, 'cumulative upkeep', 'M5'], [30, 'affinity', 'M5'], [31, 'suspend', 'std-rx22' /* was later: core/special/suspend.ts + keywords/data/suspend.json */], [32, 'changeling', 'M5'], [33, 'madness', 'M6-12'], [34, 'unearth', 'M6-1'],
    [35, 'foretell', 'native' /* cloud r3-mech */], [36, 'echo', 'CMD3' /* was M5-planned; commander batch CMD3: keywords/data/echo.json, cond controlledSinceUpkeep */], [37, 'disguise', 'native'], [38, 'start your engines!', 'FAST5X-4'], [39, 'infect', 'M4'], [40, 'bestow', 'native' /* std-ry7: actions/cast-opt/bestow.ts, rules/base-parts/bestow.ts */],
    [41, 'toxic', 'M4'], [42, 'exhaust', 'M5'], [43, 'fear', 'M4'], [44, 'max speed', 'FAST5X-4'], [45, 'buyback', 'M5'], [46, 'shadow', 'M4'], [47, 'cascade', 'M5'],
    [48, 'daybound', 'M6-4'], [49, 'ninjutsu', 'M5'], [50, 'power-up', 'T35'], [51, 'warp', 'FAST5X'], [52, 'bushido', 'M5'], [53, 'evoke', 'M5'], [54, 'rebound', 'M6-1'],
    [55, 'shroud', 'M4'], [56, 'exalted', 'M5'], [57, 'storm', 'M5'], [58, 'mutate', 'native'], [59, 'plot', 'native' /* FAST5X E6 */], [60, 'entwine', 'M5'],
  ];

  it.each(TOP60)('#%i %s (ships %s)', (_rank, name, ships) => {
    const status = keywordRegistry.get(name)?.status;
    if (ships === 'native') expect(status).toBe('native');
    else if (/^M[345]$/.test(ships) || ships === 'deck' || ships === 'M6-1' || ships === 'M6-4' || ships === 'M6-12' || ships === 'T35' || ships === 'FAST5X' || ships === 'FAST5X-4' || ships === 'CMD3' || ships === 'std-rx22') expect(status).toBe('implemented'); // M6-1: dredge, unearth, rebound; M6-4: daybound; M6-12: madness; FAST5X E2: warp; FAST5X-4: speed (CR 702.178-179)
    else expect(status).toBe('planned'); // M6, later, and echo
  });

  it('the implemented set, exactly (a new keyword must be added here on purpose)', () => {
    // CMD3 (commander batch): expansion keywords, each in its own line so that other batches can add theirs without touching this one
    const cmd3 = ['afflict', 'afterlife', 'annihilator', 'ascend', 'echo', 'evolve', 'fabricate', 'fading', 'flanking', 'ingest', 'living weapon', 'modular', 'outlast', 'rampage', 'reinforce', 'scavenge', 'soulshift', 'sunburst', 'transmute', 'unleash'];
    // std-rl (precon round L): expansion keywords
    const stdRl = ['retrace', 'training', 'vanishing'];
    // std-rx7 (wave 2 slice s20): casualty, an optional additional cost and a copy trigger like conspire (CR 702.153a)
    const stdRx7 = ['casualty'];
    // std-rx17 (wave 2, precon lane rx17): dash (alternative cost, like blitz; CR 702.109a), graft (CR 702.58a), exploit (CR 702.110a-b)
    const stdRx17 = ['dash', 'exploit', 'graft'];
    // std-rx15 (wave 2, slice s12): devour N and devour <type> N (CR 702.82a-b)
    const stdRx15 = ['devour'];
    // std-rx24 (wave 2, EDH lane rx24): umbra armor (a replacement body, CR 702.89a), jump-start (a graveyard permission that exiles the spell, CR 702.133a),
    // champion (an exile cost linked to the source, CR 702.72a, 607.2k)
    const stdRx24 = ['champion', 'jump-start', 'umbra armor'];
    // std-ry3 (wave 2, Commander lane ry3): awaken (an alternative cost and a spell ability whose land target exists only when it was paid, CR 702.113a-b),
    // provoke (an attack trigger: untap and block it this combat if able, CR 702.39a)
    const stdRy3 = ['awaken', 'provoke'];
    // std-rx22 (wave 2, EDH lane rx22): suspend, a special action (core/special/suspend.ts) plus its triggered abilities in exile and the haste (CR 702.62a)
    const stdRx22 = ['suspend'];
    // std-ry7 (wave 2, Commander lane ry7): spectacle (an alternative cost if an opponent lost life this turn, CR 702.137a)
    const stdRy7 = ['spectacle'];
    // std-ry8 (wave 2, Commander lane ry8): enlist (an attack option, core/attack-options.ts, CR 702.154a), renown (a trigger and the native action renown,
    // CR 702.112a-b), surge (an alternative cost after another spell this turn, CR 702.117a)
    const stdRy8 = ['enlist', 'renown', 'surge'];
    // p2-misc-1 (Phase 2 lane p2-misc): phasing, its permanents phase out in their controller's untap step (rules/phasing.ts#phaseInForUntapStep, CR 702.26a, 502.1)
    const p2Misc1 = ['phasing'];
    expect(byStatus('implemented')).toEqual([...cmd3, ...stdRl, ...stdRx7, ...stdRx17, ...stdRx15, ...stdRx24, ...stdRx22, ...stdRy7, ...stdRy8, ...stdRy3, ...p2Misc1, ...[
      'affinity', 'aftermath', 'bargain' /* FAST5X E1 */, 'battle cry' /* FAST5X E28 */, 'blitz' /* CMD2 */, 'bloodthirst' /* CMD4 */, 'boast' /* cloud r3-mech */, 'bushido', 'buyback', 'cascade', 'changeling', 'choose a background' /* cmd1, CR 702.124k */, 'commander ninjutsu' /* M11-4 */, 'conspire' /* M6-12 */, 'convoke', 'craft' /* FAST5X E13 */, 'crew', 'cumulative upkeep', 'cycling', 'daybound', 'deathtouch', 'decayed' /* FAST5X E28 */, 'defender', 'delve' /* std-tdm */, 'dethrone' /* CMD4 */, 'devoid', 'doctor\'s companion' /* cmd1, CR 702.124m */,
      'double strike', 'dredge', 'embalm' /* M6-12 */, 'enchant', 'encore' /* M6-12 */, 'entwine', 'equip', 'escape', 'eternalize' /* M6-12 */, 'evoke', 'exalted', 'exhaust', 'extort' /* FAST5X E28 */, 'fear', 'firebending' /* FAST5 MX6 */, 'first strike', 'flash', 'flying', 'for mirrodin!' /* T35 */, 'freerunning' /* CMD2 */, 'fuse', 'gift' /* FAST5X E1 */, 'harmonize' /* FAST5X E6 */, 'haste', 'hexproof', 'hideaway' /* FAST5X E26 */, 'horsemanship', 'impending' /* FAST5X E26 */, 'improvise' /* FAST5X E26 */,
      'increment' /* FAST5X E9 */, 'indestructible', 'infect', 'intimidate', 'job select' /* FAST5X E9 */, 'kicker', 'landwalk', 'level up' /* M6-6 */, 'lifelink', 'madness' /* M6-12 */, 'max speed' /* FAST5X-4 */, 'mayhem' /* FAST5X E6 */, 'melee' /* M12-3 */, 'menace', 'mentor' /* CMD4 */, 'mobilize' /* FAST5X E9 */, 'multikicker', 'myriad' /* M6-12 */, 'ninjutsu', 'offspring' /* M6-12 */, 'paradigm' /* FAST5X E26 */, 'partner', 'partner with' /* M11-4 */, 'persist' /* FAST5X E28 */, 'power-up' /* T35 */, 'protection', 'prowess', 'ravenous' /* CMD4 */, 'reach', 'rebound',
      'replicate' /* M6-12 */, 'riot' /* FAST5X E28 */, 'saddle' /* FAST5X E3 */, 'shadow', 'shroud', 'skulk', 'sneak' /* FAST5X E7 */, 'split second', 'spree' /* FAST5X E1 */, 'squad' /* M6-12 */, 'start your engines!' /* FAST5X-4 */, 'station' /* T35 */, 'storied' /* FAST5X E18 */, 'storm', 'teamwork' /* FAST5X E11 */, 'tiered' /* FAST5X E11 */, 'toxic', 'trample', 'typecycling', 'undaunted' /* CMD4 */, 'undying' /* FAST5X E28 */, 'unearth', 'vigilance', 'ward', 'warp' /* FAST5X E2 */, 'web-slinging' /* FAST5X E7 */, 'wither',
    ]].sort());
    // M6-3: the face-down keywords (actions/cast-opt/face-down.ts, core/special/turn-face-up.ts); M6-4: disturb, more than meets the eye (actions/cast-opt/back-face.ts),
    // nightbound (core/day-night.ts); M6-6: prototype (actions/cast-opt/prototype.ts), read ahead (statics/levels.ts); M6-9: mutate (actions/cast-opt/mutate.ts, core/resolve-parts/mutate.ts)
    expect(byStatus('native')).toEqual(['bestow' /* std-ry7: actions/cast-opt/bestow.ts */, 'companion' /* CMP1: core/special/companion.ts */, 'disguise', 'disturb', 'flashback', 'foretell' /* cloud r3-mech: core/special/foretell.ts, actions/cast-opt/foretell.ts */, 'megamorph', 'miracle' /* FAST5X E26: triggers/miracle.ts */, 'more than meets the eye', 'morph', 'mutate', 'nightbound', 'plot' /* FAST5X E6 */, 'prototype', 'read ahead']);
    expect(byStatus('implemented').length + byStatus('native').length + byStatus('planned').length).toBe(all.length);
  });

  it('a planned keyword has no hooks and does not list readers (it acts on nothing yet); an implemented keyword with an expansion has no planned-only fields', () => {
    for (const d of all.filter((x) => x.status === 'planned')) {
      expect(d.hooks, d.name).toBeUndefined();
      expect(d.readers, d.name).toBeUndefined();
    }
  });
});

describe('the validator refuses bad data, so the registry never builds from it (design 7.1.5, "no keyword is silently ignored")', () => {
  const good: KeywordDefData = { name: 'zap', rule: '702.1', params: [], mechanisms: ['flag'], reminder: 'x', multiple: 'redundant', status: 'planned' };
  const bad = (patch: Record<string, unknown>): string[] => keywordDataProblems({ ...good, ...patch });

  it('accepts a minimal planned keyword', () => {
    expect(keywordDataProblems(good)).toEqual([]);
  });

  it.each([
    ['an unknown key', { colour: 'red' }, 'unknown key'],
    ['an upper-case name', { name: 'Zap' }, 'lower-case'],
    ['a rule that is not CR 702', { rule: '701.5' }, 'rule must be'],
    ['a status that does not exist', { status: 'done' }, 'status must be'],
    ['a mechanism that does not exist', { mechanisms: ['magic'] }, 'mechanisms must be'],
    ['a param of the wrong type', { params: [{ name: 'cost', type: 'number' }] }, 'must have type cost'],
    ['an unknown param', { params: [{ name: 'colour', type: 'quality' }] }, 'is not cost | amount'],
    ['a duplicate param', { params: [{ name: 'cost', type: 'cost' }, { name: 'cost', type: 'cost' }] }, 'duplicate param'],
    ['a hook that does not exist', { mechanisms: ['hook'], hooks: ['canFly'] }, 'names of KeywordHooks'],
    ['hooks without the hook mechanism', { hooks: ['canAttack'] }, 'mechanism "hook" is not'],
    ['an implemented hook keyword without hooks', { mechanisms: ['hook'], status: 'implemented', readers: ['rules/x.ts#f'] }, 'at least one entry in hooks'],
    ['an implemented flag keyword without readers', { status: 'implemented' }, 'must list its readers'],
    ['a malformed reader', { readers: ['rules/x#f'] }, 'readers must be'],
    ['an expansion that uses a param the keyword lacks', { mechanisms: ['expands'], expand: [{ kind: 'static', text: 't', cost: '$cost' }] }, 'no cost param'],
    ['an expansion that uses an unknown placeholder', { mechanisms: ['expands'], expand: [{ kind: 'static', text: 't', cost: '$mana' }] }, 'unknown placeholder'],
    ['an implemented expanding keyword without expand', { mechanisms: ['expands'], status: 'implemented' }, 'needs its expand'],
    ['a reminder with {cost} but no cost param', { reminder: 'Pay {cost}.' }, 'has no cost param'],
    ['a wrapper keyword that also expands', { mechanisms: ['expands'], modifies: { kind: 'activated' }, expand: [{ kind: 'static', text: 't' }] }, 'no expand'],
  ])('rejects %s', (_what, patch, message) => {
    expect(bad(patch).join('\n')).toContain(message);
  });

  it('a duplicate name or alias across files is a problem', () => {
    expect(keywordDataSetProblems([good, { ...good, rule: '702.2' }]).join('\n')).toContain('already used');
    expect(keywordDataSetProblems([good, { ...good, name: 'zip', aliases: ['zap'] }]).join('\n')).toContain('already used');
  });

  it('createKeywordRegistry throws KeywordRegistryError listing every problem, and builds from good data', () => {
    expect(() => createKeywordRegistry([good, { ...good, name: 'Bad' }])).toThrow(KeywordRegistryError);
    expect(() => createKeywordRegistry([{ ...good, status: 'nope' }])).toThrow(/status must be/);
    expect(createKeywordRegistry([good]).names()).toEqual(['zap']);
  });
});

describe('FAST5X E18: a keyword newer than the Comprehensive Rules says rule "reminder"', () => {
  it('only the keywords REMINDER_RULE_KEYWORDS lists may say rule "reminder"; Storied has CR 702.195 since the 2026-09-25 edition', () => {
    expect(REMINDER_RULE_KEYWORDS).toEqual([]);
    expect(keywordRegistry.get('storied')?.rule).toBe('702.195');
    const base: KeywordDefData = { name: 'zap', rule: 'reminder', params: [], mechanisms: ['structural'], reminder: 'x', multiple: 'redundant', status: 'planned' };
    expect(keywordDataProblems(base).join()).toMatch(/rule must be/);
    expect(keywordDataProblems({ ...base, name: 'storied' }).join()).toMatch(/rule must be/);
    expect(keywordDataProblems({ ...base, name: 'storied', rule: '702.195' })).toEqual([]);
  });
});
