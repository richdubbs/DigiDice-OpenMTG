/**
 * FXC, audit C2 on the real cards: every Siege of the local index that compiles full is defeated by combat damage, triggers CR 310.12b, is exiled and cast
 * transformed for free, and its back face ends on the battlefield under its controller (or the card stays in exile if the cast is declined).
 * Skipped without the local card index (OPENMTG_CACHE_DIR); no card text is committed.
 */
import { describe, expect, it } from 'vitest';
import { compileCard, type GameState, type OracleCard } from '../../../src/index';
import { answer, find, logHas, pass, runCombat, scenario } from '../../m4/helpers';
import { localIndex } from '../../m5/parser/support';

const idx = localIndex();
const sieges = (idx ?? []).filter((c) => /\bSiege\b/.test(c.type_line ?? '')).map((c) => compileCard(c as OracleCard)).filter((d) => d.automation.level === 'full');

/** Answers every remaining decision conservatively (no to optional things, first legal choice otherwise) until priority with an empty stack. */
function settle(s: GameState): GameState {
  for (let i = 0; i < 60 && s.pending; i++) {
    const d = s.pending as { kind: string; options?: unknown[]; min?: number; targets?: unknown };
    if (d.kind === 'priority') {
      if (s.zones.stack.length === 0) return s;
      s = pass(s);
    } else if (d.kind === 'yesNo') s = answer(s, { kind: 'yesNo', yes: false });
    else if (d.kind === 'payCost') s = answer(s, { kind: 'payCost', auto: true });
    else if (d.kind === 'chooseObjects') s = answer(s, { kind: 'chooseObjects', ids: (d.options as string[]).slice(0, d.min ?? 0) });
    else return s;
  }
  return s;
}

describe.skipIf(!idx)('CR 310.12b on every full Siege of the index', () => {
  it('there are full Sieges to check', () => expect(sieges.length).toBeGreaterThan(0));

  for (const def of sieges) {
    it(`${def.name}: defeated, exiled, cast transformed for free, back face on the battlefield`, () => {
      const s0 = scenario(['Craw Wurm'], { p1: { battlefield: ['Craw Wurm', { name: def.name, counters: { defense: 1 } }] }, defs: [def] });
      const battle = find(s0, def.name, 'battlefield');
      let s = runCombat(s0, { attack: [[find(s0, 'Craw Wurm', 'battlefield'), battle]], until: 'combatDamage' });
      expect(logHas(s, new RegExp(`triggers: When the last defense counter is removed`), 'CR 310.12b')).toBe(true);
      for (let i = 0; i < 6 && s.pending?.kind === 'priority'; i++) s = pass(s);
      expect(s.pending?.kind).toBe('yesNo');
      expect(s.pending!.prompt).toMatch(/transformed without paying its mana cost/);
      s = answer(s, { kind: 'yesNo', yes: true });
      // the back face may have targets or choices as it is cast: answer them with the first legal option
      for (let i = 0; i < 10 && s.pending && s.pending.kind !== 'priority'; i++) {
        const d = s.pending as { kind: string; options?: unknown[]; min?: number };
        if (d.kind === 'payCost') s = answer(s, { kind: 'payCost', auto: true });
        else if (d.kind === 'chooseObjects') s = answer(s, { kind: 'chooseObjects', ids: (d.options as string[]).slice(0, d.min ?? 0) });
        else break;
      }
      const spellId = s.zones.stack.find((id) => s.objects[id]!.stack?.kind === 'spell');
      expect(spellId).toBeDefined();
      expect(s.objects[spellId!]!.stack!.face).toBe(1);
      s = settle(s);
      const back = s.zones.battlefield.find((id) => s.objects[id]!.defId === s.objects[battle]?.defId || s.defs[s.objects[id]!.defId]!.name === def.name);
      expect(back).toBeDefined();
      expect(s.objects[back!]!.face).toBe(1);
      expect(s.objects[back!]!.controller).toBe('p1');
      expect(s.zones.graveyard['p1']!.some((id) => s.defs[s.objects[id]!.defId]!.name === def.name)).toBe(false);
    });
  }
});
