/**
 * Design 8.5-8.6 (WP14 review): the WP14 handlers change the game only through `propose` (WP11) or through the performers of the actions the pipeline has no
 * form for. Those performers are the state-writing primitives WP14 added in rules/ (status.ts, phasing.ts, stack-objects.ts: declared INTERFACE CHANGES) and
 * the milestone 4 ones it calls (rules/destroy.ts#addRegenerationShield, rules/combat-state.ts#removeFromCombat, statics/links.ts#setLink for `link`, design 8.6
 * stage 5). WP11's lint (m5/propose/lint.test.ts) reads only src/effects, so this test guards the other side: every value a WP14 handler imports from rules/,
 * core/ or statics/ is either a reader or one of the listed performers, and no handler writes `g.s` itself. A new import must be classified here.
 */
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { SRC_ROOT } from '../helpers';

const HANDLERS = join(SRC_ROOT, 'effects/handlers');
const FILES = readdirSync(HANDLERS).filter((f) => /^(zones|tokens|token-)[\w-]*\.ts$/.test(f));

/**
 * The performers of non-proposable actions (design 8.6 stage 4) a handler may still import from rules/, core/ or statics/, by module. WP31 routed the WP14
 * primitives (rules/status.ts, rules/phasing.ts, rules/stack-objects.ts, rules/combat-state.ts#removeFromCombat) through effects/perform-direct.ts, so a handler
 * importing one of them directly fails here and in the lint of test/m5/propose/lint.test.ts.
 */
const PERFORMERS: Record<string, string[]> = {
  'rules/destroy': ['addRegenerationShield'],
  'statics/links': ['setLink'],
};

/** Functions that only read the state (or the RNG of the state, design 8.8 rule 2). */
const READERS: Record<string, string[]> = {
  'rules/attachment': ['auraCanEnchantObject', 'enchantRestriction', 'isAura', 'isEquipment', 'isFortification'],
  'rules/characteristics': ['charsOfObject', 'controllerOf', 'faceChars', 'hasKeyword', 'isPermanentCard', 'ptNumbers'],
  'rules/filter': ['findObjects', 'matchesFilter'],
  'rules/hookpoints': ['gameOf', 'hookpoints'],
  'rules/random': ['randomIndex', 'randomOrder'],
  'rules/combat-state': ['attackerState', 'isBlocking'],
  'rules/restrictions': ['playerRestricted'],
  'rules/cant': ['cantDo', 'costUseDenial'], // WP31: "can't" checks (statics/hooks.ts#ruleDenial)
  'rules/abilities': ['abilityDefOnStack'],
  'rules/targets': ['targetOptions', 'groupStat' /* std-cardcopy-7: the mana value a copy counts for a total (CR 202.3) */],
  'statics/links': ['readLink'],
  'statics/copy': ['charsFromCopiable', 'concreteSnapshot', 'copiableOrWhy'], // M6-2: the copiable values of an object (CR 707.2) and of a copy with exceptions (CR 707.9), pure
  // H1: the handle a library card renewed during this run has now (CR 400.2, 701.24b); FAST5X E28 review: `leavingTogether` writes no state, only the transient
  // `Game.leaving` snapshot of the characteristics of objects that leave in one event (CR 603.10a), which `moveObject` reads
  'core/zones': ['leavingTogether', 'renewedHandle'],
  'core/view': ['cardLine', 'seersOf'], // FXH (audit C3): who may see a card, for a log line that names it only to them (CR 400.2)
  'rules/mode-instances': ['modeInstances'], // std-blb: the chosen modes as instances, each with its own target ids (CR 700.2d), pure: it reads only the definition
  'statics/hooks': ['ruleDenial'], // std-copy-1: "can't be copied" (CR 707.10, 101.2) is a rule denial; tokens-copy.ts only asks it, it writes no state
};

/** The value imports of a source file from rules/, core/ and statics/: `module -> names` (type-only imports excluded). */
function valueImports(text: string): { module: string; name: string }[] {
  const out: { module: string; name: string }[] = [];
  for (const m of text.matchAll(/import\s+(type\s+)?\{([^}]*)\}\s+from\s+'\.\.\/\.\.\/((?:rules|core|statics)\/[\w-]+)'/g)) {
    if (m[1]) continue;
    for (const spec of m[2]!.split(',').map((x) => x.trim()).filter(Boolean)) {
      if (spec.startsWith('type ')) continue;
      out.push({ module: m[3]!, name: spec.split(/\s+as\s+/)[0]!.trim() });
    }
  }
  return out;
}

describe('design 8.5-8.6: WP14 handlers write the state only through the pipeline and the declared performers', () => {
  it('finds the WP14 handler files', () => {
    expect(FILES).toEqual(expect.arrayContaining(['zones-move.ts', 'zones-remove.ts', 'zones-status.ts', 'zones-util.ts', 'tokens-create.ts', 'tokens-copy.ts', 'tokens-cast.ts', 'tokens-attach.ts', 'token-defs.ts']));
  });

  for (const f of FILES) {
    it(`${f}: every rules/, core/ and statics/ value it imports is a reader or a declared performer`, () => {
      const text = readFileSync(join(HANDLERS, f), 'utf8');
      for (const { module, name } of valueImports(text)) {
        const known = (PERFORMERS[module] ?? []).includes(name) || (READERS[module] ?? []).includes(name);
        expect(known, `${f} imports ${name} from ${module}: classify it in performers.test.ts`).toBe(true);
      }
    });

    it(`${f}: never writes g.s or a GameObject of the state directly`, () => {
      const text = readFileSync(join(HANDLERS, f), 'utf8');
      expect(text, 'assignment into g.s').not.toMatch(/\bg\.s(\.\w+|\[[^\]]+\])+\s*(=(?!=)|\+=|-=)/);
      expect(text, 'mutating call on g.s').not.toMatch(/\bg\.s(\.\w+|\[[^\]]+\])+\.(push|splice|pop|shift|unshift|sort|reverse)\(/);
      expect(text, 'g.obj returns the object to write').not.toMatch(/\bg\.obj\(/);
      // (`facts`, `enter` and `spec` are the handlers' own plain records: DestinationFacts and TokenSpec built for a proposal.)
      expect(text, 'an object status field written').not.toMatch(/\b(?!facts\b|enter\b|spec\b)\w+\.(tapped|attachedTo|phasedOut|face|timestamp|controller|zone|damage|counters|links)\s*=(?!=)/);
    });
  }
});
