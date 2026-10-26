/**
 * Sample keyword instances for the keyword tests (WP3): one or more per keyword whose data expands into abilities, with the parameters a parser would give.
 * The expansion snapshot (`expansions.snap.json`) and the type-check file (`expansion-types.generated.ts`) are built from these.
 */
import { parseManaCost } from '../../../src/types/mana';
import type { CostDef, KeywordAbilityDef } from '../../../src/index';

const mana = (text: string): CostDef => ({ mana: parseManaCost(text)! });

function kw(keyword: string, text: string, rest: Partial<KeywordAbilityDef> = {}): KeywordAbilityDef {
  return { kind: 'keyword', text, keyword, ...rest };
}

/** Label -> instance. The label is the key of the snapshot, so it is stable and says what is being expanded. */
export const SAMPLES: Readonly<Record<string, KeywordAbilityDef>> = {
  'equip {1}': kw('equip', 'Equip {1}', { cost: mana('{1}') }),
  'equip {3} to a legendary creature': kw('equip', 'Equip legendary creature {3}', { cost: mana('{3}'), filter: { types: ['Creature'], supertypes: ['Legendary'], controller: 'you' } }),
  'cycling {2}': kw('cycling', 'Cycling {2}', { cost: mana('{2}') }),
  'cycling -- pay 2 life': kw('cycling', 'Cycling—Pay 2 life', { cost: { other: [{ kind: 'payLife', amount: 2 }] } }),
  'basic landcycling {1}': kw('typecycling', 'Basic landcycling {1}', { cost: mana('{1}'), filter: { zone: 'library', types: ['Land'], supertypes: ['Basic'] } }),
  'kicker {2}{G}': kw('kicker', 'Kicker {2}{G}', { cost: mana('{2}{G}') }),
  'multikicker {1}{B}': kw('multikicker', 'Multikicker {1}{B}', { cost: mana('{1}{B}') }),
  'ward {2}': kw('ward', 'Ward {2}', { cost: mana('{2}') }),
  'ward -- pay 3 life': kw('ward', 'Ward—Pay 3 life.', { cost: { other: [{ kind: 'payLife', amount: 3 }] } }),
  'cumulative upkeep {1}': kw('cumulative upkeep', 'Cumulative upkeep {1}', { cost: mana('{1}') }),
  'buyback {3}': kw('buyback', 'Buyback {3}', { cost: mana('{3}') }),
  'flashback {1}{R}': kw('flashback', 'Flashback {1}{R}', { cost: mana('{1}{R}') }),
  storm: kw('storm', 'Storm'),
  'affinity for artifacts': kw('affinity', 'Affinity for artifacts', { filter: { types: ['Artifact'], controller: 'you' } }),
  'entwine {2}': kw('entwine', 'Entwine {2}', { cost: mana('{2}') }),
  'bushido 1': kw('bushido', 'Bushido 1', { amount: 1 }),
  'firebending 2': kw('firebending', 'Firebending 2', { amount: 2 }), // FAST5 MX6 (CR 702.189a)
  'ninjutsu {1}{U}': kw('ninjutsu', 'Ninjutsu {1}{U}', { cost: mana('{1}{U}') }),
  'commander ninjutsu {U}{B}': kw('commander ninjutsu', 'Commander ninjutsu {U}{B}', { cost: mana('{U}{B}') }), // M11-4, CR 702.49d
  'partner with Toothy, Imaginary Friend': kw('partner with', 'Partner with Toothy, Imaginary Friend', { filter: { name: 'Toothy, Imaginary Friend' } }), // M11-4, CR 702.124j
  'evoke {R}': kw('evoke', 'Evoke {R}', { cost: mana('{R}') }),
  // M6-5 (CR 702.138a): an alternative cost from the graveyard, with the usual "exile N other cards" part
  'escape {R}{R}, exile two other cards': kw('escape', 'Escape—{R}{R}, Exile two other cards from your graveyard.', { cost: { ...mana('{R}{R}'), other: [{ kind: 'exileFrom', zone: 'graveyard', count: 2, filter: { other: true } }] } }),
  // FAST5X E2 (CR 702.185a): an alternative cost from the hand whose static ability exiles the permanent at the next end step
  'warp {1}{R}': kw('warp', 'Warp {1}{R}', { cost: mana('{1}{R}') }),
  // FAST5X E7 (CR 702.190a-b, 702.188a): alternative costs that return a creature (an unblocked attacker in your declare blockers step; a tapped creature)
  'sneak {1}{B}': kw('sneak', 'Sneak {1}{B}', { cost: mana('{1}{B}') }),
  'web-slinging {W}': kw('web-slinging', 'Web-slinging {W}', { cost: mana('{W}') }),
  // FAST5X E6 (CR 702.187b): an alternative cost from the graveyard, only for a card discarded this turn
  'mayhem {1}{R}': kw('mayhem', 'Mayhem {1}{R}', { cost: mana('{1}{R}') }),
  // CMD2 (CR 702.173a): an alternative cost while you dealt combat damage to a player this turn with an Assassin or commander
  'freerunning {1}{B}': kw('freerunning', 'Freerunning {1}{B}', { cost: mana('{1}{B}') }),
  // CMD2 (CR 702.152a): an alternative cost whose permanent has haste and "When this creature dies, draw a card" and is sacrificed at the next end step
  'blitz {2}{R}': kw('blitz', 'Blitz {2}{R}', { cost: mana('{2}{R}') }),
  // FAST5X E6 (CR 702.180a-b): an alternative cost from the graveyard, a tapped creature's power off the total, exiled on leaving the stack
  'harmonize {4}{G}': kw('harmonize', 'Harmonize {4}{G}', { cost: mana('{4}{G}') }),
  exalted: kw('exalted', 'Exalted'),
  cascade: kw('cascade', 'Cascade'),
  prowess: kw('prowess', 'Prowess'),
  melee: kw('melee', 'Melee'), // M12-3 (CR 702.121a)
  // T35 (CR 702.163a, 702.184a)
  'for mirrodin!': kw('for mirrodin!', 'For Mirrodin!'),
  station: kw('station', 'Station'),
  devoid: kw('devoid', 'Devoid'),
  changeling: kw('changeling', 'Changeling'),
  'crew 2': kw('crew', 'Crew 2', { amount: 2 }),
  'saddle 3': kw('saddle', 'Saddle 3', { amount: 3 }), // FAST5X E3 (CR 702.171a)
  // FAST5X E9 (CR 702.181a, 702.182a, 702.191a)
  'mobilize 2': kw('mobilize', 'Mobilize 2', { amount: 2 }),
  // FAST5X E28 (CR 702.91a, 702.147a, 702.101a, 702.79a, 702.93a)
  'battle cry': kw('battle cry', 'Battle cry'),
  decayed: kw('decayed', 'Decayed'),
  extort: kw('extort', 'Extort'),
  persist: kw('persist', 'Persist'),
  riot: kw('riot', 'Riot'), // CR 702.136a
  undying: kw('undying', 'Undying'),
  'job select': kw('job select', 'Job select'),
  increment: kw('increment', 'Increment'),
  ravenous: kw('ravenous', 'Ravenous'), // cmd4 (CR 702.156a): enters with X +1/+1 counters; draw when it enters if X is 5 or more
  // cmd4 (CR 702.125a, 702.54a, 702.134a)
  undaunted: kw('undaunted', 'Undaunted'),
  'bloodthirst 2': kw('bloodthirst', 'Bloodthirst 2', { amount: 2 }),
  // std-rx15 (CR 702.82a-b): devour of creatures, and of a permanent type
  'devour 2': kw('devour', 'Devour 2', { amount: 2 }),
  'devour land 3': kw('devour', 'Devour land 3', { amount: 3, filter: { types: ['Land'] } }),
  mentor: kw('mentor', 'Mentor'),
  dethrone: kw('dethrone', 'Dethrone'), // cmd4 (CR 702.105a)
  // M6-1 (m6 design 3.2): the keywords that use the replacement loop
  'dredge 4': kw('dredge', 'Dredge 4', { amount: 4 }),
  'unearth {B}': kw('unearth', 'Unearth {B}', { cost: mana('{B}') }),
  rebound: kw('rebound', 'Rebound'),
  // M6-12 (CR 702.35a): madness, the replacement with its "exiled this way" trigger and the cast for the madness cost (op:cast.costChange)
  'madness {R}': kw('madness', 'Madness {R}', { cost: mana('{R}') }),
  // M6-12 (m6 design 3.3): the copy keywords over M6-2's token and spell copies
  'embalm {W}': kw('embalm', 'Embalm {W}', { cost: mana('{W}') }),
  // FAST5X E13 (CR 702.167a-c): one material, two materials, "one or more"
  'craft with artifact {2}{W}': kw('craft', 'Craft with artifact {2}{W}', { cost: mana('{2}{W}'), filter: { types: ['Artifact'] } }),
  'craft with two creatures {5}{B}': kw('craft', 'Craft with two creatures {5}{B}', { cost: mana('{5}{B}'), filter: { types: ['Creature'] }, amount: 2 }),
  'craft with one or more Dinosaurs {4}{R}': kw('craft', 'Craft with one or more Dinosaurs {4}{R}', { cost: mana('{4}{R}'), filter: { subtypes: ['Dinosaur'] }, amount: 1, quality: 'or more' }),
  'eternalize {4}{U}{U}': kw('eternalize', 'Eternalize {4}{U}{U}', { cost: mana('{4}{U}{U}') }),
  'encore {4}{G}': kw('encore', 'Encore {4}{G}', { cost: mana('{4}{G}') }),
  myriad: kw('myriad', 'Myriad'),
  'squad {2}': kw('squad', 'Squad {2}', { cost: mana('{2}') }),
  'offspring {2}': kw('offspring', 'Offspring {2}', { cost: mana('{2}') }),
  'replicate {1}{R}': kw('replicate', 'Replicate {1}{R}', { cost: mana('{1}{R}') }),
  conspire: kw('conspire', 'Conspire'),
  // M6-4 (m6 design 3.6): daybound enters transformed at night (CR 702.145b); the rest of it is engine code (core/day-night.ts)
  daybound: kw('daybound', 'Daybound'),
  // M6-6 (CR 702.87a): leveler cards' level up
  'level up {W}': kw('level up', 'Level up {W}', { cost: mana('{W}') }),
  // FAST5X E1: bargain (CR 702.166a) and gift (CR 702.174a-b; on a permanent, the samples' face type: the enters trigger)
  bargain: kw('bargain', 'Bargain'),
  // FAST5X E11: teamwork (CR 702.194a: an optional additional cost, tap creatures you control with total power N or more)
  'teamwork 3': kw('teamwork', 'Teamwork 3', { amount: 3 }),
  'gift a card': kw('gift', 'Gift a card', { quality: 'a card' }),
  'gift a tapped Fish': kw('gift', 'Gift a tapped Fish', { quality: 'a tapped Fish' }),
  // FAST5X E26: impending (CR 702.176a: alternative cost, time counters, not a creature, end step removal), paradigm (CR 702.192a), hideaway (CR 702.75a)
  'impending 4 -- {1}{U}{U}': kw('impending', 'Impending 4—{1}{U}{U}', { amount: 4, cost: mana('{1}{U}{U}') }),
  paradigm: kw('paradigm', 'Paradigm'),
  'hideaway 4': kw('hideaway', 'Hideaway 4', { amount: 4 }),
  // CMD3 (commander batch): expansion keywords (CR 702.86a, 702.135a, 702.107a, 702.115a, 702.130a, 702.46a, 702.123a, 702.43a, 702.44a, 702.32a, 702.92a)
  'annihilator 2': kw('annihilator', 'Annihilator 2', { amount: 2 }),
  'afterlife 1': kw('afterlife', 'Afterlife 1', { amount: 1 }),
  'outlast {1}{W}': kw('outlast', 'Outlast {1}{W}', { cost: mana('{1}{W}') }),
  ingest: kw('ingest', 'Ingest'),
  'afflict 2': kw('afflict', 'Afflict 2', { amount: 2 }),
  'soulshift 3': kw('soulshift', 'Soulshift 3', { amount: 3 }),
  'fabricate 1': kw('fabricate', 'Fabricate 1', { amount: 1 }),
  'modular 2': kw('modular', 'Modular 2', { amount: 2 }),
  sunburst: kw('sunburst', 'Sunburst'),
  'fading 3': kw('fading', 'Fading 3', { amount: 3 }),
  'living weapon': kw('living weapon', 'Living weapon'),
  'echo {2}{U}': kw('echo', 'Echo {2}{U}', { cost: mana('{2}{U}') }), // CR 702.30a
  flanking: kw('flanking', 'Flanking'), // CR 702.25a
  'rampage 2': kw('rampage', 'Rampage 2', { amount: 2 }), // CR 702.23a
  evolve: kw('evolve', 'Evolve'), // CR 702.100a
  unleash: kw('unleash', 'Unleash'), // CR 702.98a
  'reinforce 2 -- {1}{W}': kw('reinforce', 'Reinforce 2—{1}{W}', { amount: 2, cost: mana('{1}{W}') }), // CR 702.77a
  'transmute {1}{U}{U}': kw('transmute', 'Transmute {1}{U}{U}', { cost: mana('{1}{U}{U}') }), // CR 702.53a
  'scavenge {3}{G}{G}': kw('scavenge', 'Scavenge {3}{G}{G}', { cost: mana('{3}{G}{G}') }), // CR 702.97a
  ascend: kw('ascend', 'Ascend'), // CR 702.131a-b (a permanent: no expansion, core/citys-blessing.ts)
  // std-rl (precon round L)
  training: kw('training', 'Training'), // CR 702.149a
  'vanishing 3': kw('vanishing', 'Vanishing 3', { amount: 3 }), // CR 702.63a
  vanishing: kw('vanishing', 'Vanishing'), // CR 702.63b: no number, no time counters of its own
  retrace: kw('retrace', 'Retrace'), // CR 702.81a
  // std-rx7 (wave 2 slice s20)
  'casualty 2': kw('casualty', 'Casualty 2', { amount: 2 }), // CR 702.153a
  // std-rx17 (wave 2, precon lane rx17)
  'dash {2}{R}': kw('dash', 'Dash {2}{R}', { cost: mana('{2}{R}') }), // CR 702.109a
  'graft 2': kw('graft', 'Graft 2', { amount: 2 }), // CR 702.58a
  exploit: kw('exploit', 'Exploit'), // CR 702.110a
  // std-ry8 (wave 2, Commander lane ry8)
  enlist: kw('enlist', 'Enlist'), // CR 702.154a
  'renown 2': kw('renown', 'Renown 2', { amount: 2 }), // CR 702.112a
  'surge {1}{R}': kw('surge', 'Surge {1}{R}', { cost: mana('{1}{R}') }), // CR 702.117a
  // std-rx24 (wave 2, EDH lane rx24)
  'umbra armor': kw('umbra armor', 'Umbra armor'), // CR 702.89a
  'jump-start': kw('jump-start', 'Jump-start'), // CR 702.133a
  'champion a Faerie': kw('champion', 'Champion a Faerie', { filter: { subtypes: ['Faerie'] } }), // CR 702.72a
  // std-rx22 (wave 2, EDH lane rx22)
  'suspend 4 -- {1}{R}': kw('suspend', 'Suspend 4—{1}{R}', { amount: 4, cost: mana('{1}{R}') }), // CR 702.62a
  // std-ry7 (wave 2, Commander lane ry7)
  'spectacle {B}{R}': kw('spectacle', 'Spectacle {B}{R}', { cost: mana('{B}{R}') }), // CR 702.137a
  // std-ry3 (wave 2, Commander lane ry3)
  'awaken 3 -- {5}{B}{B}': kw('awaken', 'Awaken 3—{5}{B}{B}', { amount: 3, cost: mana('{5}{B}{B}') }), // CR 702.113a
  provoke: kw('provoke', 'Provoke'), // CR 702.39a
  // trek-1 (lane trek, Star Trek reminder text): an alternative cost from the graveyard that also returns a creature you control, exiled on leaving the stack
  'beam me up {2}{U}': kw('beam me up', 'Beam me up {2}{U}', { cost: mana('{2}{U}') }),
  // pc-keywords-mana-1 (precon lane keywords-mana, CR 702.96a): an alternative cost; the spell is rewritten when it is cast (effects/overload.ts)
  'overload {3}{U}': kw('overload', 'Overload {3}{U}', { cost: mana('{3}{U}') }),
};
