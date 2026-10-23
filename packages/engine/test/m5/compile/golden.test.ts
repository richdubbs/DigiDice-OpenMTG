/**
 * WP18 golden set (design 15.2: "remove cards/basic-compiler.ts ... once the golden set passes"): every fixture card milestone 4's default compiler
 * automated fully is still fully automated by the compile pipeline, and the fixture as a whole only moved up. The list was produced with milestone 4's
 * compiler (main at e468c8e, 76 of 195 fixture cards full, 32 partial, 87 manual) before cards/basic-compiler.ts was removed.
 * Whole-index measurement (STATUS.md, WP18 report): 1,256 full with milestone 4's compiler.
 *
 * WP18 review (decision D14, design 10.3): native recognizer output passes the exact render gate like every other source. Three fixture cards milestone 4
 * automated use forms the renderer cannot print yet (legendary and nonbasic landwalk, "protection from X and from Y"): they are pinned below as NOT full
 * (their line is in CompileReport.faces[].nativeUngated) until the template packages WP19-WP23 add the forms; then they move back into M4_FULL.
 * Whole index: 21 of milestone 4's 1,256 full cards are below full for that reason.
 * FAST4 T33: the renderer prints legendary and nonbasic landwalk (CR 702.14c; render/kw.ts), so Ayumi, the Last Visitor and Dryad Sophisticate are back
 * in M4_FULL and no fixture card is pending the gate.
 */
import { describe, expect, it } from 'vitest';
import { compileCardDetailed, defaultCompileSources } from '../../../src/index';
import { compiledDef, fixtureCardNames, getCard } from '../../fixtures';

const M4_FULL = [
  'Aardvark Sloth', 'Air Elemental', 'Alpine Watchdog', 'Ambush Viper', 'Ancient Den', 'Argothian Swine', 'Battlefield Raptor', 'Beloved Chaplain',
  'Birds of Paradise', 'Black Knight', 'Blor the Impervious', 'Bog Raiders', 'Boros Swiftblade', 'Branchblight Stalker', 'Canopy Spider', 'Charging Badger', 'Colossal Dreadmaw',
  'Craw Wurm', 'Darksteel Myr', 'Death Speakers', 'Dross Prowler', 'Dryad Arbor', 'Elephant-Rat', 'Elvish Lookout', 'Endless One', 'Fencing Ace', 'Forest',
  'Furtive Homunculus', "Galina's Knight", 'Giant Spider', 'Gladecover Scout', 'Glistener Elf', 'Grayscaled Gharial', 'Grizzly Bears', 'Hearthfire Hobgoblin', 'Highborn Ghoul',
  'Hill Giant', 'Icehide Golem', 'Isamaru, Hound of Konda', 'Island', 'Jukai Messenger', 'Llanowar Elves', 'Lotus Petal', 'Mountain', 'Ornithopter',
  'Phyrexian Digester', 'Plains', 'Porcelain Legionnaire', 'Prickly Boggart', 'Raging Goblin', 'Raging Redcap', 'Rime Dryad', 'Scuzzback Scrapper', 'Serra Angel', 'Shrike Force',
  'Shu Cavalry', 'Smoldering Butcher', 'Snow-Covered Forest', 'Snow-Covered Island', 'Snow-Covered Swamp', 'Sol Ring', 'Soltari Foot Soldier', 'Spectral Rider', 'Swamp', 'Taiga',
  'Thalakos Sentry', 'Typhoid Rats', 'Vampire Nighthawk', 'Vassal Soul', 'Wall of Stone', 'Wastes', 'Wei Scout', 'White Knight',
  // FAST2 T7: the renderer prints "protection from black and from green" (CR 702.16g; render/kw.ts, family protection-pair), so the native line is used
  'Mirran Crusader',
  // FAST4 T33: "legendary landwalk" and "nonbasic landwalk" (CR 702.14c; render/kw.ts)
  'Ayumi, the Last Visitor', 'Dryad Sophisticate',
];

/** Milestone 4 full cards whose native line the exact render gate cannot confirm yet (D14): the line, and why. */
const GATE_PENDING: [string, number, string][] = [];

// M12F (STATUS "Wave M12" gap 9): whole-fixture work (compiling, the CLI, the smoke run) sits near Vitest's 5 s default under load: an explicit
// timeout for every test here (a test's own longer one still applies).
describe('golden: no regression of what milestone 4 automated (keyword lines, vanilla cards, mana abilities, timing restrictions, enters with counters)', { timeout: 60_000 }, () => {
  it.each(M4_FULL)('%s is still full', (name) => {
    const def = compiledDef(name);
    expect(def.automation.level).toBe('full');
    expect(def.automation.unsupported).toEqual([]);
  });

  it.skipIf(GATE_PENDING.length > 0)('D14, design 10.3: no fixture card milestone 4 automated is pending the gate', () => expect(GATE_PENDING).toEqual([]));
  if (GATE_PENDING.length > 0) it.each(GATE_PENDING)('D14, design 10.3: %s is not full until the renderer prints its line %i (%s): the native reading is measured, not used', (name, line) => {
    const { def, report } = compileCardDetailed(getCard(name), defaultCompileSources());
    expect(def.automation.level).not.toBe('full');
    expect(report.faces[0]!.nativeUngated).toEqual([line]);
  });

  it('the fixture as a whole has milestone 4\'s 76 full cards but the ones pending the gate (103 of 195 when WP18 merged)', () => {
    const full = fixtureCardNames().filter((n) => compiledDef(n).automation.level === 'full');
    expect(M4_FULL.length + GATE_PENDING.length).toBe(76);
    expect(full.length).toBeGreaterThanOrEqual(M4_FULL.length);
    expect(full).toEqual(expect.arrayContaining(M4_FULL));
  }, 60_000); // compiles every fixture card: over 5 s on a loaded machine (FAST5 batch 1 integration)
});
