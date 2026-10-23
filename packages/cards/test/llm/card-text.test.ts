/** Design 11.4 "Stored form = no Oracle text" and updates.md "No Wizards or Scryfall content in packs": free text and contained card text. */
import { describe, expect, it } from 'vitest';
import { faceViews } from '../../src/llm/face-lines';
import { runGates, storedForm } from '../../src/llm/gates';
import { cardWork } from '../../src/llm/work';
import { STORED_REASON, cardTextIn, freeTextIn } from '../../src/pack/card-text';
import { bareSources, fixture, goodReply, manualTriggerCard } from './support';

const bolt = () => fixture('Lightning Bolt');
const entry = (abilities: Record<string, unknown>[]) => ({ faces: [{ abilities }] });

describe('design 11.4: card text never enters the cache or a pack', () => {
  it('cardTextIn flags a string that CONTAINS the name, the printed text or the "~" line the model saw (not only equal strings)', () => {
    const c = bolt();
    expect(cardTextIn(entry([{ as: 'Lightning Bolt needs a shapeshift effect' }]), c)).not.toBeNull();
    expect(cardTextIn(entry([{ x: 'cannot represent "Lightning Bolt deals 3 damage to any target." exactly' }]), c)).not.toBeNull();
    expect(cardTextIn(entry([{ x: 'cannot represent "~ deals 3 damage to any target." exactly' }]), c)).not.toBeNull();
    expect(cardTextIn(entry([{ x: '~ deals 3 damage' }]), c)).not.toBeNull();
    expect(cardTextIn(entry([{ x: 'lightning bolt' }]), c)).toBe('lightning bolt');
    expect(cardTextIn(entry([{ x: 'damage to any target' }]), c)).toBe('damage to any target');
  });
  it('cardTextIn leaves structure alone: ops, refs, ids, and rules vocabulary the text also uses (CR 205 types, CR 702 keywords)', () => {
    expect(cardTextIn(entry([{ op: 'damage', ref: 'target', id: 't0' }]), bolt())).toBeNull();
    expect(cardTextIn(entry([{ types: ['Planeswalker'] }]), fixture('Lava Axe'))).toBeNull();
    expect(cardTextIn(entry([{ keyword: 'double strike' }]), fixture('Mirran Crusader'))).toBeNull();
  });
  it('storedForm replaces every free-text reason (manual abilities and manual steps) by the fixed placeholder', () => {
    const s = storedForm({ kind: 'manual', shape: 'spell', reason: 'cannot represent "~ deals 3 damage to any target." exactly', src: [0],
      effect: { steps: [{ op: 'manual', reason: 'Lightning Bolt deals 3 damage', text: 'x' }] } });
    expect(JSON.stringify(s)).not.toMatch(/deals 3 damage|Lightning/);
    expect(freeTextIn(s)).toBeNull();
    expect(s['reason']).toBe(STORED_REASON);
  });
  // M6-4: Huntmaster of the Fells, used here before, now parses (its werewolf lines); an invented card with a trigger no template knows keeps a manual node
  it('a reply whose manual reasons quote the "~" line is stored without the quote (an invented card, bare parser)', () => {
    const card = manualTriggerCard();
    const work = cardWork(card, bareSources())!;
    const views = faceViews(card, bareSources().parse);
    const quote = views[0]!.lines.reduce((a, b) => (b.length > a.length ? b : a), '');
    const reply = goodReply(work, (o) => {
      const visit = (x: unknown): void => {
        if (Array.isArray(x)) x.forEach(visit);
        else if (x && typeof x === 'object') {
          const r = x as Record<string, unknown>;
          if (typeof r['reason'] === 'string') r['reason'] = `cannot represent "${quote}" exactly`;
          Object.values(r).forEach(visit);
        }
      };
      visit(o);
    });
    expect(reply).toContain(quote);
    const g = runGates({ work, sources: bareSources(), views }, reply);
    expect(g.ok).toBe(true);
    if (!g.ok) return;
    expect(JSON.stringify(g.faces)).not.toContain(quote);
    expect(JSON.stringify(g.faces)).toContain(STORED_REASON); // a manual node was kept, with the fixed reason
    expect(freeTextIn(g.faces)).toBeNull();
  });
  it('authority: a reply that writes card text in any other string is refused (it would be stored)', () => {
    const card = bolt();
    const work = cardWork(card, bareSources())!;
    const g = runGates({ work, sources: bareSources(), views: faceViews(card) }, goodReply(work, (o) => { o.faces[0]!.abilities[0]!['as'] = 'Lightning Bolt deals 3 damage'; }));
    expect(g).toMatchObject({ ok: false, gate: 'authority' });
    if (!g.ok) expect(g.message).toMatch(/repeats the card's name or Oracle text/);
  });
});
