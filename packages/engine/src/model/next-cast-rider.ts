/**
 * edh-d-31 (CR 605.1a, 605.3b, 603.7, 614.1c; Chocobo Camp, Yuna Grand Summoner, Brass Infiniscope): beside adding mana, a mana ability may also set up a waiting
 * effect of the turn, "When you next cast a creature spell this turn, that creature enters with two additional +1/+1 counters on it." or "..., you draw a card
 * and gain half X life, rounded down.": a delayed triggered ability (CR 603.7) created as the mana ability resolves; it does not add to or change the mana, and
 * the mana ability still has no target (CR 605.1a). Pure shape check, shared by parser/lower/ability.ts#onlyAddMana, model/cap-walk.ts and model/lint-nodes.ts
 * (the walker imports no handler, design 5.4): a `delay` step that waits for the next spell of its controller of some description, ends with the turn, fires once,
 * and does only: gives the spell an additional-counters enters replacement, draws a fixed number of cards, or gains life.
 */
const rec = (v: unknown): Record<string, unknown> => (typeof v === 'object' && v !== null ? (v as Record<string, unknown>) : {});
const arr = (v: unknown): unknown[] => (Array.isArray(v) ? v : []);

/** One instruction of the waiting effect: the enters replacement of the spell, a fixed draw, or life gained by the controller. */
function riderDoStep(s: unknown): boolean {
  const st = rec(s);
  if (st['guard'] !== undefined || st['as'] !== undefined) return false;
  const who = rec(st['who']);
  const you = who['ref'] === 'you' && Object.keys(who).length === 1;
  if (st['op'] === 'draw') return you && typeof st['count'] === 'number';
  if (st['op'] === 'gainLife') return you && st['also'] === undefined && (typeof st['amount'] === 'number' || typeof st['amount'] === 'object');
  if (st['op'] !== 'effect') return false;
  const d = rec(st['duration']);
  const effects = arr(st['effects']);
  const e = rec(effects[0]);
  const body = rec(e['body']);
  const replaces = rec(e['replaces']);
  const subject = rec(rec(replaces['subject'])['is']);
  return d['d'] === 'permanent' && effects.length === 1 && e['s'] === 'replace' && replaces['ev'] === 'zoneChange' && replaces['to'] === 'battlefield'
    && subject['ref'] === 'event' && subject['role'] === 'spell' && body['b'] === 'enters' && Object.keys(body).every((k) => k === 'b' || k === 'counters') && arr(body['counters']).length > 0;
}

/** Is the step a waiting effect for the next spell its controller casts this turn, of the one shape above? */
export function isNextCastRider(s: unknown): boolean {
  const st = rec(s);
  if (st['op'] !== 'delay' || st['guard'] !== undefined || st['as'] !== undefined || st['once'] !== true || st['batch'] !== undefined || st['wholeBatch'] !== undefined) return false;
  if (arr(st['targets']).length > 0 || st['capture'] !== undefined) return false;
  const when = rec(st['when']);
  const ev = rec(when['event']);
  if (when['at'] !== 'event' || ev['ev'] !== 'cast' || ev['player'] !== 'you') return false;
  const dur = rec(st['duration']);
  if (dur['d'] !== 'endOfTurn') return false;
  const steps = arr(st['do']);
  return steps.length > 0 && steps.every(riderDoStep);
}
