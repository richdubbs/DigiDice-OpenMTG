/**
 * edh-next-16: the folds of its templates (parser/templates/zz-cloud/edh-next-16.json), called from render/fold.ts#foldAt. Each applies only when every part is exactly what the
 * idiom says.
 *
 * `shuffleHandCardIntoLibrary` (CR 701.24a, 400.3, 608.2c; See Beyond, eff.edhn16.shuffle.handCard.intoLibrary): "Shuffle a card from your hand into your library.": your choice of
 * exactly one card of your hand, its move into your library, and the shuffle of your library. Exactly those three steps, the chosen card named by nothing else.
 */
import type { EffectStep } from '../types/ability';
import { plain } from './clause';
import type { Folded } from './fold';
import { K } from './kernel';
import type { RenderState } from './state';

const canon = (v: unknown): unknown => (Array.isArray(v) ? v.map(canon) : v !== null && typeof v === 'object' ? Object.fromEntries(Object.entries(v as Record<string, unknown>).filter(([, x]) => x !== undefined).sort(([x], [y]) => (x < y ? -1 : 1)).map(([k, x]) => [k, canon(x)])) : v);
const same = (a: unknown, b: unknown): boolean => JSON.stringify(canon(a)) === JSON.stringify(canon(b));

function shuffleHandCardIntoLibrary(list: EffectStep[], i: number): Folded | null {
  const [c, m, sh] = [list[i], list[i + 1], list[i + 2]];
  if (c?.op !== 'chooseObjects' || m?.op !== 'move' || sh?.op !== 'shuffle' || c.as !== 'shuf') return null;
  // the library is shuffled only when a card was put there (ruling 2010-06-15: with an empty hand it is not shuffled)
  if (!same(sh.guard, { cond: 'did', step: 'shuffled' })) return null;
  if (c.guard !== undefined || m.guard !== undefined || c.random !== undefined || c.groupLimit !== undefined || c.perPlayer !== undefined || c.link !== undefined) return null;
  if (!same(c.who, { ref: 'you' }) || c.min !== 1 || c.max !== 1 || c.from.ref !== 'each' || !same(c.from.filter, { zone: 'hand', owner: 'you' })) return null;
  if (!same(m.what, { ref: 'bound', name: c.as }) || !same(m.to, { zone: 'library', owner: { ref: 'you' } }) || m.as !== 'shuffled' || m.until !== undefined || m.link !== undefined || m.remember !== undefined) return null;
  if (!same(sh.who, { ref: 'you' }) || sh.as !== undefined || sh.ifSearched !== undefined) return null;
  if (list.slice(i + 3).some((x) => JSON.stringify(x).includes(`"${c.as}"`))) return null;
  return { clauses: [plain('shuffle a card from your hand into your library')], consumed: 3 };
}

/**
 * `countLibraryLifeBecomes` (CR 119.5, 608.2c; Invincible Hymn, eff.edhn16.countLibrary.lifeBecomes): "Count the number of cards in your library. Your life total becomes that number.":
 * your life total is set to the number of cards in your library. Exactly that step.
 */
function countLibraryLifeBecomes(list: EffectStep[], i: number): Folded | null {
  const s = list[i];
  if (s?.op !== 'setLife' || s.guard !== undefined || !same(s.who, { ref: 'you' }) || !same(s.value, { q: 'count', of: { ref: 'each', filter: { zone: 'library', owner: 'you' } } })) return null;
  if (Object.keys(s).some((k) => !['op', 'who', 'value'].includes(k))) return null;
  return { clauses: [plain('count the number of cards in your library. your life total becomes that number', { standalone: true })], consumed: 1 };
}

/**
 * `destroyCreaturesAndAttached` (CR 701.8a, 303.4, 301.5, 608.2c; End Hostilities, eff.edhn16.destroyAll.creaturesAndAttached): "Destroy all creatures and all permanents attached to creatures.":
 * the one destruction of every creature and every permanent attached to a creature, decided together. Exactly that step.
 */
function destroyCreaturesAndAttached(list: EffectStep[], i: number): Folded | null {
  const s = list[i];
  const creature = { ref: 'each', filter: { types: ['Creature'] } };
  if (s?.op !== 'destroy' || s.guard !== undefined || Object.keys(s).some((k) => !['op', 'what'].includes(k))) return null;
  if (!same(s.what, { ref: 'each', filter: { anyOf: [{ types: ['Creature'] }, { attachedToObject: creature }] } })) return null;
  return { clauses: [plain('destroy all creatures and all permanents attached to creatures')], consumed: 1 };
}

/**
 * `destroyLandsOrCreatures` (CR 701.8a, 701.19c, 608.2d; Catastrophe, eff.edhn16.destroyAll.landsOrCreatures.noRegenCreatures): "Destroy all lands or all creatures. Creatures destroyed this way
 * can't be regenerated.": your choice of lands or creatures (named `destroyChoice`), the destruction of all of the chosen kind, the creatures with no regeneration. Exactly those three steps.
 */
function destroyLandsOrCreatures(list: EffectStep[], i: number): Folded | null {
  const [c, a, b] = [list[i], list[i + 1], list[i + 2]];
  if (c?.op !== 'chooseValue' || a?.op !== 'if' || b?.op !== 'if' || a.guard !== undefined || b.guard !== undefined || c.guard !== undefined) return null;
  if (!same(c, { op: 'chooseValue', who: { ref: 'you' }, what: 'option', as: 'destroyChoice', link: 'destroyChoice', options: ['lands', 'creatures'] })) return null;
  if (!same(a, { op: 'if', cond: { cond: 'chosen', link: 'destroyChoice', equals: 'lands' }, then: [{ op: 'destroy', what: { ref: 'each', filter: { types: ['Land'], notTypes: ['Creature'] } } }, { op: 'destroy', regeneration: 'cant', what: { ref: 'each', filter: { allTypes: ['Land', 'Creature'] } } }] })) return null;
  if (!same(b, { op: 'if', cond: { cond: 'chosen', link: 'destroyChoice', equals: 'creatures' }, then: [{ op: 'destroy', what: { ref: 'each', filter: { types: ['Creature'] } }, regeneration: 'cant' }] })) return null;
  return { clauses: [plain("destroy all lands or all creatures. creatures destroyed this way can't be regenerated", { standalone: true })], consumed: 3 };
}

/**
 * `chooseThenDestroyOthers` (CR 701.8a, 608.2d, 608.2c; Deadly Vanity, eff.edhn16.chooseCreatureOrPw.destroyAllOthers): "Choose a creature or planeswalker, then destroy all other creatures and
 * planeswalkers.": you choose one creature or planeswalker (named `kept`), and every other creature and planeswalker is destroyed. Exactly those two steps.
 */
function chooseThenDestroyOthers(list: EffectStep[], i: number): Folded | null {
  const [c, d] = [list[i], list[i + 1]];
  const both = { anyOf: [{ types: ['Creature'] }, { types: ['Planeswalker'] }] };
  if (c?.op !== 'chooseObjects' || d?.op !== 'destroy' || c.guard !== undefined || d.guard !== undefined) return null;
  if (!same(c, { op: 'chooseObjects', who: { ref: 'you' }, from: { ref: 'each', filter: both }, min: 1, max: 1, as: 'kept' })) return null;
  if (!same(d, { op: 'destroy', what: { ref: 'each', filter: { ...both, not: { is: { ref: 'bound', name: 'kept' } } } } })) return null;
  if (list.slice(i + 2).some((x) => JSON.stringify(x).includes('"kept"'))) return null;
  return { clauses: [plain('choose a creature or planeswalker, then destroy all other creatures and planeswalkers', { standalone: true })], consumed: 2 };
}

/**
 * `returnUpToOneAndUpToOne` (CR 400.3, 404.1, 608.2d; Druidic Ritual, eff.edhn16.return.upToOne.and.upToOne.graveyardToHand): "Return up to one creature card and up to one land card from your
 * graveyard to your hand.": your choice of up to one card of each of two descriptions from your graveyard (the second not the first), and both go to your hand. Exactly those four steps.
 */
function returnUpToOneAndUpToOne(list: EffectStep[], i: number, st: RenderState): Folded | null {
  const [a, b, m1, m2] = [list[i], list[i + 1], list[i + 2], list[i + 3]];
  if (a?.op !== 'chooseObjects' || b?.op !== 'chooseObjects' || m1?.op !== 'move' || m2?.op !== 'move') return null;
  if ([a, b, m1, m2].some((x) => x.guard !== undefined) || a.as !== 'returnedFirst' || b.as !== 'returnedSecond') return null;
  const fa = a.from.ref === 'each' ? a.from.filter : undefined;
  const fb = b.from.ref === 'each' ? b.from.filter : undefined;
  if (fa === undefined || fb === undefined || fa.anyOf?.length !== 1 || fb.anyOf?.length !== 1) return null;
  const shape = (f: typeof fa, extra: object): unknown => ({ ...f, anyOf: undefined, ...extra });
  if (!same(a, { op: 'chooseObjects', who: { ref: 'you' }, from: { ref: 'each', filter: { anyOf: fa.anyOf, zone: 'graveyard', owner: 'you', isCard: true } }, min: 0, max: 1, as: 'returnedFirst' })) return null;
  if (!same(b, { op: 'chooseObjects', who: { ref: 'you' }, from: { ref: 'each', filter: { anyOf: fb.anyOf, zone: 'graveyard', owner: 'you', isCard: true, not: { is: { ref: 'bound', name: 'returnedFirst' } } } }, min: 0, max: 1, as: 'returnedSecond' })) return null;
  if (!same(m1, { op: 'move', what: { ref: 'bound', name: 'returnedFirst' }, to: { zone: 'hand' } }) || !same(m2, { op: 'move', what: { ref: 'bound', name: 'returnedSecond' }, to: { zone: 'hand' } })) return null;
  if (shape(fa, {}) === undefined) return null;
  if (list.slice(i + 4).some((x) => JSON.stringify(x).includes('"returnedFirst"') || JSON.stringify(x).includes('"returnedSecond"'))) return null;
  const one = K.np({ ...fa.anyOf[0]!, zone: 'graveyard', owner: 'you' }, st, { det: 'none', count: 'up to one', noZone: true });
  const two = K.np({ ...fb.anyOf[0]!, zone: 'graveyard', owner: 'you' }, st, { det: 'none', count: 'up to one', noZone: true });
  return { clauses: [plain(`return ${one} and ${two} from your graveyard to your hand`, { standalone: true })], consumed: 4 };
}

export function foldEdhN16(list: EffectStep[], i: number, st: RenderState): Folded | null {
  return shuffleHandCardIntoLibrary(list, i) ?? countLibraryLifeBecomes(list, i) ?? destroyCreaturesAndAttached(list, i) ?? destroyLandsOrCreatures(list, i) ?? chooseThenDestroyOthers(list, i) ?? returnUpToOneAndUpToOne(list, i, st);
}
