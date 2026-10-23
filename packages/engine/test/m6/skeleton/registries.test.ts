/**
 * M6-0 skeleton (m6 design 2.6, 4.1, 5 "M6-0"): every registry and stub exports what section 2 says, with the milestone 5 behavior moved into it unchanged or
 * empty, so no milestone 6 capability appears before its owner lands.
 */
import { describe, expect, it } from 'vitest';
import { ABILITY_MODEL_VERSION, COMPILER_VERSION, createGame, ENGINE_CAPABILITIES, legalActions } from '../../../src/index';
import { simpleConfig } from '../../helpers';
import { CAST_OPTION_PROVIDERS } from '../../../src/actions/cast-options';
import { LAYOUT_SUPPORT } from '../../../src/cards/layout-support';
import { LAYOUT_CAPS } from '../../../src/cards/pipeline';
import { FACE_DOWN_DEFS } from '../../../src/core/create';
import { Game } from '../../../src/core/game';
import { MOVE_PARTS, RESOLVE_PERMANENT_PARTS, SPECIAL_ACTION_HANDLERS, TURN_BASED, VIEW_PARTS } from '../../../src/core/registries';
import { COPY_MOVE_PARTS } from '../../../src/core/move-parts/copy';
import { SPELL_EFFECTS_MOVE_PARTS } from '../../../src/core/move-parts/spell-effects';
import { COPY_DEFS_VIEW_PARTS } from '../../../src/core/view-parts/copy-defs';
import { CHANGE_FACE } from '../../../src/effects/handlers/change-face';
import { REPLACEMENT_BODIES } from '../../../src/effects/propose';
import { BODY_KINDS, DESTINATION_PARTS, ENTERS_PARTS, IMMEDIATE_CHECKS, PROPOSAL_KINDS, RULE_REPLACEMENTS } from '../../../src/effects/registries';
import { REPLACE_ON_CAPABILITIES } from '../../../src/effects/replacements';
import { BASE_PARTS, FILTER_PARTS, FILTER_STATUS_FIELDS } from '../../../src/rules/registries';
import { SUPPORTED_FILTER_FIELDS } from '../../../src/rules/filter';
import { INTRINSIC_PARTS, LAYER_1A, LAYER_1B, LAYER_3, LAYER_TABLE, order1a, RULE_EFFECTS } from '../../../src/statics/layers';
import { EVENT_FORMS_PARTS } from '../../../src/triggers/forms';
import { EVENT_MATCHERS, NOT_EMITTED } from '../../../src/triggers/match';
import { FACE_DOWN_DEF_IDS } from '../../../src/types/card';
import type { Proposed } from '../../../src/effects/api';
import { find, scenario } from '../helpers';

const board = () => scenario(['Grizzly Bears', 'Exalted Angel'], { p1: { battlefield: ['Grizzly Bears'], hand: ['Exalted Angel'] }, p2: { battlefield: ['Grizzly Bears'] } });

describe('M6-0: versions (m6 design 1.1 #1)', () => {
  it('ABILITY_MODEL_VERSION is 2 (3 since M11-0, m11 design 4.5; 4 since M12-1, m12 design 4.3) and COMPILER_VERSION carries the +m6.0 suffix (caches recompile)', () => {
    expect(ABILITY_MODEL_VERSION).toBe(4);
    expect(COMPILER_VERSION.endsWith('+m6.0')).toBe(true);
  });
});

describe('M6-0: effects/registries.ts', () => {
  // M6-1 registered instead, redirect, skip (effects/instead.ts, effects/prevent.ts) and modify.amount|count|to, prevent.then (effects/bodies/m5.ts); M6-2 enters.copy;
  // M6-3: `during` (effects/bodies/during.ts) and `enters.faceDown` (effects/enters-parts/face-down.ts); M6-4: `enters.transformed`, `modify.destination.transformed`;
  // M6-6: `enters.prepared`
  it('BODY_KINDS holds the milestone 5 bodies and those of M6-1 and M6-3, and REPLACEMENT_BODIES is built from their capabilities and the enters parts', () => {
    expect(Object.keys(BODY_KINDS).sort()).toEqual(['during', 'enters', 'healFirst' /* Cloud r5-repl, CR 614.1a */, 'instead', 'insteadThen' /* merge wave 8, audit D4 */, 'modify', 'prevent', 'redirect', 'regeneration', 'shieldCounter' /* FAST5X E28, CR 122.1c */, 'skip', 'umbraArmor' /* std-rx24, CR 702.89a */]);
    expect(Object.keys(REPLACEMENT_BODIES).sort()).toEqual([
      'during', 'enters', 'enters.attachTo', 'enters.choice' /* FAST5X E28: riot, CR 702.136a */, 'enters.copy', 'enters.copy.then' /* r4-copy: CR 603.12 */, 'enters.countersIf' /* CMD3: sunburst, CR 702.44a, 614.12 */, 'enters.dayIfNeither' /* p2-misc-1: CR 731.1 */, 'enters.devour' /* std-rx15: CR 702.82a */, 'enters.exileCards' /* std-cardcopy-3: CR 607.2a */, 'enters.faceDown', 'enters.lookAtHand' /* std-rx6: CR 614.12a, 402.3 */, 'enters.prepared', 'enters.transformed', 'enters.under', 'enters.untapped' /* r5-fxb: CR 614.1d */, 'healFirst' /* Cloud r5-repl */, 'instead', 'insteadThen' /* merge wave 8, audit D4: CR 614.1a, 614.6 */, 'insteadThen.if' /* p2-replace-events-1: CR 614.1a */, 'modify', 'modify.amount', 'modify.count',
      'modify.destination', 'modify.destination.faceDown', 'modify.destination.random', 'modify.destination.transformed', 'modify.link' /* std-ru, CR 607.2a */, 'modify.then' /* M6-12, CR 702.35a */, 'modify.to', 'prevent', 'prevent.as' /* std-library-2, CR 603.12 */, 'prevent.then', 'redirect', 'redirect.amount',
      'regeneration', 'shieldCounter' /* FAST5X E28 */, 'skip', 'umbraArmor' /* std-rx24 */,
    ]);
    for (const b of [] as string[]) { // every body of milestone 6 so far is registered
      expect(ENGINE_CAPABILITIES.has(`body:${b}`), b).toBe(false);
    }
  });

  it('ENTERS_PARTS, DESTINATION_PARTS, RULE_REPLACEMENTS and IMMEDIATE_CHECKS start empty (M6-2: copy; M6-3: face down; M6-4: transformed, day and night; M6-6: prepared; MX2: the control sync)', () => {
    // M6-6: no Saga rule replacement: a Saga's intrinsic "enters with lore counters" abilities are rule-generated abilities (statics/levels.ts, CR 714.3a-b).
    // M11-1: one, CR 903.9b (effects/rule-replacements/commander.ts; nothing outside a Commander game)
    expect([ENTERS_PARTS.map((p) => p.field).sort(), DESTINATION_PARTS.map((p) => p.field), RULE_REPLACEMENTS.length, IMMEDIATE_CHECKS.length])
      .toEqual([['copy', 'faceDown', 'prepared', 'transformed'], ['faceDown', 'transformed'], 5 /* FAST5X E13: finality counters, CR 122.1h; M11-1: the commander, CR 903.9b; FAST5X E28: shield counters, CR 122.1c; CLOUD C10: a spell cast from a graveyard by a permission enters with a finality counter, CR 614.1c (effects/rule-replacements/permit-enters.ts); Cloud r5-repl: a spell cast with a permission goes elsewhere instead of a graveyard, CR 614.1a (effects/rule-replacements/permit-graveyard.ts) */, 4 /* FAST5X E18: Storied's enduring story (core/enduring-story.ts); CMD3: ascend's city's blessing (core/citys-blessing.ts, CR 702.131b) */]);
  });

  it('PROPOSAL_KINDS is total over Proposed: the eight milestone 5 kinds with their replace.on names, phase and turn (M6-1), turnFaceUp (M6-3), transform (M6-4)', () => {
    const kinds: Record<Proposed['ev'], string[]> = {
      damage: ['feature:replace.on.damage'], life: ['feature:replace.on.life'], draw: ['feature:replace.on.draw'], zoneChange: ['feature:replace.on.zoneChange'],
      createToken: ['feature:replace.on.createToken'], counters: ['feature:replace.on.counters'], destroy: ['feature:replace.on.action.destroy'],
      step: ['feature:replace.on.step'], phase: ['feature:replace.on.phase'], turn: ['feature:replace.on.turn'], turnFaceUp: ['feature:replace.on.turnFaceUp'] /* M6-3 */, transform: ['feature:replace.on.transform'] /* M6-4 */,
      mill: ['feature:replace.on.action.mill'] /* Cloud r3-repl: a mill's number of cards, CR 701.17a, 614.1a (effects/proposal-kinds/mill.ts) */,
      connive: ['feature:replace.on.action.connive'] /* Cloud r3-repl: a permanent's connive, CR 701.50a, 614.1a (effects/proposal-kinds/connive.ts) */,
      drawMany: ['feature:replace.on.action.draw'] /* Cloud r4-repl: a player's draw of N cards, CR 121.2, 614.1a (effects/proposal-kinds/draw-many.ts) */,
      explore: ['feature:replace.on.action.explore'] /* Cloud r4-repl: one explore of a permanent, CR 701.44a, 614.1a (effects/proposal-kinds/explore.ts) */,
      payLife: ['feature:replace.on.action.payLife'] /* std-library-4: a payment of life, CR 119.4, 614.1a (effects/proposal-kinds/pay-life.ts) */,
      proliferate: ['feature:replace.on.action.proliferate'] /* p2-replace-events-2: one proliferate of a player, CR 701.34a, 614.1a (effects/proposal-kinds/proliferate.ts) */,
      scry: ['feature:replace.on.action.scry'] /* p2-replace-events-3: one player's scry of N cards, CR 701.22a, 614.1a (effects/proposal-kinds/scry.ts) */,
    };
    expect(Object.keys(PROPOSAL_KINDS).sort()).toEqual(Object.keys(kinds).sort());
    for (const [ev, caps] of Object.entries(kinds)) {
      const k = PROPOSAL_KINDS[ev as Proposed['ev']];
      expect(k.ev, ev).toBe(ev);
      expect([...k.capabilities], ev).toEqual(caps);
    }
    expect([...REPLACE_ON_CAPABILITIES]).toEqual(Object.values(kinds).flat().sort());
    for (const c of REPLACE_ON_CAPABILITIES) expect(ENGINE_CAPABILITIES.has(c), c).toBe(true);
    for (const c of ['feature:replace.on.action.sacrifice']) {
      expect(ENGINE_CAPABILITIES.has(c), c).toBe(false);
    }
  });

  it('the stub kinds translate their events for a matcher; a turnFaceUp or transform proposal of a permanent that can\'t do it performs nothing (M6-3, M6-4)', () => {
    const s = board();
    const g = new Game(s);
    const bears = find(s, 'Grizzly Bears', 'battlefield', 'p1');
    expect(PROPOSAL_KINDS.phase.semOf(g, { ev: 'phase', phase: 'combat', whose: 'p1' })).toMatchObject({ ev: 'phase', data: { phase: 'combat' } });
    expect(PROPOSAL_KINDS.turn.semOf(g, { ev: 'turn', whose: 'p2', extra: false })).toMatchObject({ ev: 'beginTurn' });
    expect(PROPOSAL_KINDS.turnFaceUp.affectedPlayer(g, { ev: 'turnFaceUp', object: { id: bears, zone: 'battlefield' }, via: 'morph' })).toBe('p1');
    expect(PROPOSAL_KINDS.transform.perform(g, { ev: 'transform', object: { id: bears, zone: 'battlefield' }, convert: false })).toBeNull(); // M6-4: not double-faced (CR 712.9)
    expect(PROPOSAL_KINDS.turnFaceUp.perform(g, { ev: 'turnFaceUp', object: { id: bears, zone: 'battlefield' }, via: 'morph' })).toBeNull(); // M6-3: a face-up permanent: nothing happens
  });
});

describe('M6-0: the other registries start with the milestone 5 behavior', () => {
  it('CHANGE_FACE performs every form: transform (M5, then M6-4), face up, face down and manifest (M6-3), convert, flip and the delayed self transform (M6-4)', () => {
    expect(Object.keys(CHANGE_FACE)).toEqual(['transform', 'faceUp', 'faceDown', 'manifest', 'convert', 'delayedSelf', 'flip']); // M6-3: face-ops.ts; M6-4: dfc-ops.ts
    for (const f of ['faceUp', 'faceDown', 'manifest', 'convert', 'flip', 'delayedSelf']) expect(ENGINE_CAPABILITIES.has(`op:changeFace.${f}`), f).toBe(true);
  });

  it('core/registries.ts: the copy parts of M6-2, the face-down move and resolve parts of M6-3, the components move part, the transformed resolve part and the day/night untap check of M6-4, the prototype move part and the lore counter of M6-6, the CR 400.7a move part of M6-8, the mutate resolve part and components view part of M6-9; TURN_BASED.propose is the M6-1 one (core/turn-skip.ts)', () => {
    expect([MOVE_PARTS.length - COPY_MOVE_PARTS.length - SPELL_EFFECTS_MOVE_PARTS.length, RESOLVE_PERMANENT_PARTS.length, VIEW_PARTS.length - COPY_DEFS_VIEW_PARTS.length]).toEqual([6, 3, 2]); // std-ry7: the bestow move part (CR 702.103b); M6-3: face down; M6-4: components; M6-6: prototype; M6-9: the mutate resolve part, the components view part; M11-0: the commander view part; M11-1: the commander move part; FAST5X E8: the Room move part (CR 709.5d)
    expect([TURN_BASED.untapSecondPart.length, TURN_BASED.precombatMainBegins.length]).toEqual([1, 2]); // M6-4: CR 502.2 (core/day-night.ts); M6-6: core/lore.ts (CR 714.3c); std-rx17: core/rad.ts (CR 728.1)
    expect(TURN_BASED.propose).toBeTypeOf('function'); // M6-1: turns, phases and steps are proposed (CR 614.10)
  });

  it('rules/registries.ts: the base parts of M6-3, M6-4 and M6-6; the status fields are evaluated, advertised only once an owner lists them (FILTER_PARTS)', () => {
    expect(BASE_PARTS.length).toBe(5); // std-ry7: rules/base-parts/bestow.ts (CR 702.103b); M6-3: rules/base-parts/face-down.ts; M6-4: rules/base-parts/melded.ts; M6-6: rules/base-parts/prototype.ts; FAST5X E8: rules/base-parts/room.ts
    const listed = FILTER_PARTS.flat();
    expect([...listed].sort()).toEqual(['commander', 'flipped', 'harnessed' /* cloud r3-mech (CR 701.64) */, 'prepared', 'prototyped', 'solved']); // M6-4: rules/filter-parts/dfc.ts; M6-6: rules/filter-parts/levels.ts; M11-1: rules/filter-parts/commander.ts
    for (const f of FILTER_STATUS_FIELDS) {
      expect(SUPPORTED_FILTER_FIELDS.has(f), f).toBe(listed.includes(f)); // evaluated by rules/filter.ts, advertised through FILTER_PARTS only
      expect(ENGINE_CAPABILITIES.has(`filter:${f}`), f).toBe(listed.includes(f));
      expect(ENGINE_CAPABILITIES.has(`sfilter:${f}`), f).toBe(listed.includes(f));
    }
  });

  it('statics/layers.ts: the 1a, 1b and 3 appliers (M6-2, M6-3, M6-8), no rule-generated effect or intrinsic part but the face-down ones; order1a is empty without a copy effect', () => {
    expect(LAYER_1A).not.toBeNull();
    expect(ENGINE_CAPABILITIES.has('layer:1a')).toBe(true);
    // M6-8: the layer 3 applier (statics/text-change.ts)
    expect(LAYER_3).not.toBeNull();
    expect(Object.hasOwn(LAYER_TABLE, '3')).toBe(true);
    expect(ENGINE_CAPABILITIES.has('layer:3')).toBe(true);
    // M6-3: the 1b applier, the rule-generated 1b effects and the fast-path part (statics/face-down.ts)
    expect(LAYER_1B).not.toBeNull();
    expect(ENGINE_CAPABILITIES.has('layer:1b')).toBe(true);
    expect([RULE_EFFECTS.length, INTRINSIC_PARTS.length]).toEqual([4, 2]); // M6-9: the merged permanent's 1a effect and fast-path part (statics/merge.ts); FAST5X E12: the suspected permanent's layer 6 effect (statics/suspect.ts, no fast-path part: a suspected permanent is a layer source); std-ra: the hone counters' layer 7c effect (statics/hone.ts, no fast-path part: an honed Equipment is a layer source)
    const s = board();
    expect(order1a(s, find(s, 'Grizzly Bears', 'battlefield', 'p1'))).toEqual([]);
  });

  it('actions/cast-options.ts: no cast option provider; cards/layout-support.ts lifts no layout cap', () => {
    // M6-3: actions/cast-opt/face-down.ts; M6-4: back-face.ts; M6-6: prototype.ts, prepare.ts; M6-9: mutate.ts; FAST5X E10: airbend.ts (CR 701.65a)
    expect([...CAST_OPTION_PROVIDERS.map((p) => p.name)].sort()).toEqual(['airbend', 'bestow' /* std-ry7 */, 'disguise', 'disturb', 'foretell' /* cloud r3-mech */, 'more than meets the eye', 'morph', 'mutate', 'plot' /* FAST5X E6 */, 'prepare', 'prototype']);
    expect(LAYOUT_SUPPORT).toEqual({ meld: true, case: true, prototype: true, prepare: true, mutate: true }); // M6-4: cards/layout-support/dfc.ts; M6-6: cards/layout-support/layouts.ts; M6-9: merge.ts
    expect(Object.keys(LAYOUT_CAPS).sort()).toEqual(['planar', 'scheme', 'vanguard']); // M6-4 lifted meld; M6-6 case, prototype, prepare; M6-9 mutate
  });

  it('triggers: the event forms parts are empty; NOT_EMITTED is derived (phase and dayNight), so ev:phase and ev:dayNight are no capability', () => {
    // M6-3: triggers/forms-face.ts; M6-4: triggers/forms-dfc.ts (converting and flipping are emitted, and day becoming night: `dayNight`); M6-6: triggers/forms-levels.ts; M6-9: triggers/forms-merge.ts
    expect(EVENT_FORMS_PARTS.flatMap((p) => p.SUPPORTED).sort()).toEqual([...[
      'ev.becomes.classLevel', 'ev.becomes.converted', 'ev.becomes.flipped', 'ev.becomes.melded', 'ev.becomes.mutated', 'ev.becomes.plotted' /* FAST5X E6 */, 'ev.becomes.prepared', 'ev.becomes.saddled' /* FAST5X E3 */, 'ev.becomes.solved', 'ev.becomes.turnedFaceDown', 'ev.becomes.turnedFaceUp',
      'ev.becomes.fullyUnlocked', 'ev.becomes.unlocked', // FAST5X E8 (CR 709.5h-i)
      'ev.action.manifestDread', // FAST5X E25 (CR 701.62b)
      'ev.becomes.crewCostPaid', 'ev.becomes.saddleCostPaid', 'ev.becomes.teamworkCostPaid', 'ev.becomes.untapStep', // Standard round 5, r5-trig (triggers/forms-saddle.ts; CR 702.122b, 702.171c, 502.3); std-rq: teamworkCostPaid (CR 702.194a)
      'ev.becomes.turnedFaceUp.player', // cloud std-dsk: "whenever you turn a permanent face up", the player who turned it (triggers/forms-face.ts, CR 702.37e, 708.2)
    ]].sort());
    expect(EVENT_FORMS_PARTS.flatMap((p) => p.EMITS)).toEqual(['dayNight']);
    expect([...NOT_EMITTED].sort()).toEqual(['phase']);
    expect(Object.hasOwn(EVENT_MATCHERS, 'phase')).toBe(false);
    expect(Object.hasOwn(EVENT_MATCHERS, 'dayNight')).toBe(true);
    for (const w of ['converted', 'flipped', 'melded', 'classLevel', 'solved', 'prepared', 'mutated']) expect(ENGINE_CAPABILITIES.has(`feature:ev.becomes.${w}`), w).toBe(true);
  });
});

describe('M6-0: special actions are listed and performed through SPECIAL_ACTION_HANDLERS (m6 design D8)', () => {
  it('the keyword stubs (foretell, suspend, plot, turning face up) are adapted and list nothing, so legalActions has no special action', () => {
    // M6-3: core/special/turn-face-up.ts comes first (it lists only face-down permanents: none here); the keyword stub of turning face up stays, listing nothing
    expect(SPECIAL_ACTION_HANDLERS.map((h) => h.kind).sort()).toEqual(['companion', 'foretell', 'foretell' /* cloud r3-mech: core/special/foretell.ts ahead of the stub */, 'plot', 'plot', 'suspend', 'suspend' /* std-rx22: core/special/suspend.ts ahead of the stub */, 'turnFaceUp', 'turnFaceUp', 'unlock']); // FAST5X E6: core/special/plot.ts ahead of the plot stub; 'unlock': FAST5X E8 (CR 116.2m, core/rooms.ts; no Room here); 'companion': CMP1 (CR 116.2g; no companion here)
    const s = board();
    const g = new Game(s);
    for (const h of SPECIAL_ACTION_HANDLERS) expect(h.list(g, 'p1'), h.kind).toEqual([]);
    expect(legalActions(s, 'p1').some((a) => a.kind === 'special')).toBe(false);
  });
});

describe('M6-0: the face-down pseudo-definitions (m6 design D7, 2.2)', () => {
  it('every game has both, frozen: a 2/2 creature with no name, cost or subtypes; ward2 has ward {2} (CR 708.2a, 702.168a)', () => {
    const s = createGame(simpleConfig()); // (the scenario helper deep-clones its state, definitions included: read a game as createGame makes it)
    for (const [i, id] of Object.values(FACE_DOWN_DEF_IDS).entries()) {
      const d = s.defs[id]!;
      expect(d, id).toBe(FACE_DOWN_DEFS[i]);
      expect(Object.isFrozen(d), id).toBe(true);
      expect(d.faces[0]).toMatchObject({ name: '', manaCost: null, types: ['Creature'], subtypes: [], power: '2', toughness: '2', colors: [] });
    }
    expect(s.defs[FACE_DOWN_DEF_IDS.plain]!.faces[0]!.abilities).toEqual([]);
    expect(s.defs[FACE_DOWN_DEF_IDS.ward2]!.faces[0]!.abilities).toEqual([{ kind: 'keyword', keyword: 'ward', text: 'Ward {2}', cost: { mana: [{ kind: 'generic', amount: 2 }] } }]);
    expect(FACE_DOWN_DEFS.map((d) => d.id)).toEqual([FACE_DOWN_DEF_IDS.plain, FACE_DOWN_DEF_IDS.ward2]);
  });
});
