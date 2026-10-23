/**
 * Dividing an amount: combat damage among blockers or blocked creatures, and with trample the player or permanent attacked (CR 510.1c-d, 702.19b; lethal
 * damage shown as a hint, deathtouch makes it 1, CR 702.2c), and damage or counters divided among targets as a spell is cast (CR 601.2d).
 */
import { useRef, useState, type KeyboardEvent, type MouseEvent } from 'react';
import type { AssignDamageDecision, GameView } from '@openmtg/engine';
import { gameSfx } from '../game/sound';
import { allocateInOrder, assignmentProblem, defaultAssignment, defaultDivision } from './combat';
import { usePrimary } from './keys';
import { distinctLabels, objectName } from './names';
import type { PromptProps } from './types';
import { PromptActions } from './PromptActions';
import { PromptStage, StageCard } from './stage';

function Amount({ label, value, min, max, busy, onChange }: { label: string; value: number; min: number; max: number; busy: boolean; onChange: (n: number) => void }) {
  return (
    <>
      <input type="number" aria-label={label} min={min} max={max} step={1} disabled={busy} value={Number.isNaN(value) ? '' : value} onChange={(e) => onChange(e.target.value === '' ? NaN : Number(e.target.value))} />
      <input type="range" aria-label={`${label} slider`} min={min} max={max} step={1} disabled={busy} value={Number.isNaN(value) ? min : value} onChange={(e) => onChange(Number(e.target.value))} />
    </>
  );
}

export function AssignDamagePrompt({ d, view, answer, busy }: PromptProps<'assignDamage'>) {
  const [amounts, setAmounts] = useState<Record<string, number>>(() => defaultAssignment(d));
  // The damage screen (Arena style): the creatures First ... Last in the order Auto allocate gives them lethal damage.
  const [order, setOrder] = useState<string[]>(() => d.recipients.filter((r) => !r.trampleTarget).map((r) => r.id));
  const [auto, setAuto] = useState(true);
  const problem = assignmentProblem(d, amounts);
  const total = d.recipients.reduce((n, r) => n + (Number.isNaN(amounts[r.id]) ? 0 : (amounts[r.id] ?? 0)), 0);
  const submit = () => answer({ kind: 'assignDamage', amounts: d.recipients.map((r) => ({ id: r.id, amount: amounts[r.id] ?? 0 })) });
  const names = distinctLabels(view, d.recipients.map((r) => r.id));
  usePrimary(submit, problem === null);
  // Changing an amount by hand turns Auto allocate off; reordering with it on allocates again.
  const setByHand = (next: Record<string, number>) => {
    setAuto(false);
    setAmounts(next);
  };
  const reorder = (next: string[]) => {
    setOrder(next);
    if (auto) setAmounts(allocateInOrder(d, next));
  };
  const setAutoOn = (on: boolean) => {
    setAuto(on);
    if (on) setAmounts(allocateInOrder(d, order));
  };
  const stage = { d, view, amounts, order, auto, busy, problem, names, onAmounts: setByHand, onOrder: reorder, onAuto: setAutoOn };
  return (
    <>
      <p className="prompt-detail">
        {objectName(view, d.attacker)} assigns {d.amount} combat damage ({total} assigned).{d.canTrample ? ' It has trample (CR 702.19b).' : ''}
      </p>
      <table className="prompt-table">
        <tbody>
          {d.recipients.map((r) => {
            const name = names[r.id] ?? r.id;
            return (
              <tr key={r.id}>
                <th scope="row">
                  {name}
                  {r.trampleTarget ? ' (attacked: trample damage)' : <span className="prompt-hint"> lethal: {r.lethal}</span>}
                </th>
                <td>
                  <Amount label={`Damage to ${name}`} value={amounts[r.id] ?? 0} min={0} max={d.amount} busy={busy} onChange={(n) => setByHand({ ...amounts, [r.id]: n })} />
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
      {problem && <p className="prompt-warning" role="status">{problem}</p>}
      <DamageStage {...stage} />
      <PromptActions>
        <button type="button" className="button-primary" disabled={busy || problem !== null} onClick={submit}>
          Assign damage
        </button>
        <button type="button" disabled={busy} onClick={() => setAmounts(allocateInOrder(d, order))}>
          Lethal first
        </button>
      </PromptActions>
    </>
  );
}

/**
 * One more damage to `id`: from what is still unassigned, else taken from the trample target, else from the last creature in `order` that has some (never
 * from `id` itself). Unchanged when there is nothing to take.
 */
export function addDamage(d: AssignDamageDecision, amounts: Readonly<Record<string, number>>, order: readonly string[], id: string): Record<string, number> {
  const out = { ...amounts };
  const total = d.recipients.reduce((n, r) => n + (out[r.id] || 0), 0);
  if (total < d.amount) {
    out[id] = (out[id] || 0) + 1;
    return out;
  }
  const tramples = d.recipients.find((r) => r.trampleTarget)?.id;
  const from = [...(tramples ? [tramples] : []), ...[...order].reverse()].find((x) => x !== id && (out[x] || 0) > 0);
  if (!from) return out;
  out[from] = (out[from] || 0) - 1;
  out[id] = (out[id] || 0) + 1;
  return out;
}

interface DamageStageProps {
  d: AssignDamageDecision;
  view: GameView;
  amounts: Readonly<Record<string, number>>;
  order: readonly string[];
  auto: boolean;
  busy: boolean;
  problem: string | null;
  names: Readonly<Record<string, string>>;
  onAmounts: (a: Record<string, number>) => void;
  onOrder: (o: string[]) => void;
  onAuto: (on: boolean) => void;
}

/**
 * The damage screen on the board's stage (Arena style): the creature dealing the damage large at the left with how much it deals,
 * the creatures it may assign damage to in a row First ... Last (drag one to change the order Auto allocate uses), the damage each is assigned and its
 * lethal damage beside its picture, and with trample what it attacks at the right (CR 510.1c-d, 702.19b). A click assigns one more damage, a right-click
 * takes one back (the keyboard: + and -). The rail keeps the same amounts as number fields.
 */
function DamageStage({ d, view, amounts, order, auto, busy, problem, names, onAmounts, onOrder, onAuto }: DamageStageProps) {
  const dragging = useRef<string | null>(null);
  const total = d.recipients.reduce((n, r) => n + (amounts[r.id] || 0), 0);
  const left = d.amount - total;
  const target = d.recipients.find((r) => r.trampleTarget);
  const targetPlayer = target ? view.players.find((p) => p.id === target.id) : undefined;
  const add = (id: string) => {
    if (busy) return;
    gameSfx('ui.tick');
    onAmounts(addDamage(d, amounts, order, id));
  };
  const take = (id: string) => {
    if (busy || (amounts[id] || 0) <= 0) return;
    gameSfx('ui.tick');
    onAmounts({ ...amounts, [id]: (amounts[id] || 0) - 1 });
  };
  const pick = (id: string, name: string) => ({
    role: 'button',
    tabIndex: 0,
    'aria-label': `${name}: ${amounts[id] || 0} damage. Click for one more, right-click for one less.`,
    onClick: () => add(id),
    onContextMenu: (e: MouseEvent) => {
      e.preventDefault();
      take(id);
    },
    onKeyDown: (e: KeyboardEvent) => {
      if (e.key === '+' || e.key === '=' || e.key === 'ArrowUp') add(id);
      else if (e.key === '-' || e.key === 'ArrowDown') take(id);
      else return;
      e.preventDefault();
    },
  });
  const amount = (id: string, lethal: number | null) => {
    const n = amounts[id] || 0;
    return (
      <div className={`prompt-dmg${lethal !== null && n >= lethal ? ' is-lethal' : ''}`}>
        <span className="prompt-dmg-n">{n}</span>
        {lethal !== null && <span className="prompt-dmg-note">{n >= lethal ? 'lethal' : `lethal ${lethal}`}</span>}
      </div>
    );
  };
  const drop = (onto: string) => {
    const from = dragging.current;
    dragging.current = null;
    if (!from || from === onto) return;
    const next = order.filter((x) => x !== from);
    next.splice(next.indexOf(onto) + (order.indexOf(from) < order.indexOf(onto) ? 1 : 0), 0, from);
    onOrder(next);
  };
  return (
    <PromptStage
      title="Assign damage"
      subtitle="Click a creature for one more damage, right-click for one less. Drag them to change the order Auto allocate gives lethal damage in."
      corner={
        <label className="prompt-stage-check">
          <input type="checkbox" checked={auto} disabled={busy} onChange={(e) => onAuto(e.target.checked)} /> Auto allocate damage
        </label>
      }
    >
      <div className="prompt-dmg-stage">
        <div className="prompt-dmg-attacker">
          <StageCard id={d.attacker}>
            <div className="prompt-dmg prompt-dmg-total">
              <span className="prompt-dmg-n">{d.amount}</span>
              <span className="prompt-dmg-note">{left > 0 ? `${left} left` : left < 0 ? `${-left} too many` : 'all assigned'}</span>
            </div>
          </StageCard>
        </div>
        <div className="prompt-dmg-middle">
          <div className="prompt-dmg-row" role="list" aria-label="Creatures to assign damage to, first to last">
            {order.map((id) => {
              const r = d.recipients.find((x) => x.id === id);
              if (!r) return null;
              return (
                <div
                  key={id}
                  role="listitem"
                  className="prompt-dmg-slot"
                  draggable={!busy}
                  onDragStart={(e) => {
                    dragging.current = id;
                    e.dataTransfer.effectAllowed = 'move';
                  }}
                  onDragOver={(e) => {
                    if (dragging.current && dragging.current !== id) e.preventDefault();
                  }}
                  onDrop={(e) => {
                    e.preventDefault();
                    drop(id);
                  }}
                  onDragEnd={() => (dragging.current = null)}
                >
                  <div className="prompt-dmg-pick" {...pick(id, names[id] ?? objectName(view, id))}>
                    <StageCard id={id}>{amount(id, r.lethal)}</StageCard>
                  </div>
                </div>
              );
            })}
          </div>
          {order.length > 1 && (
            <div className="prompt-dmg-ends" aria-hidden="true">
              <span>First</span>
              <span>Last</span>
            </div>
          )}
          {problem && <p className="prompt-stage-problem">{problem}</p>}
        </div>
        {target && (
          <div className="prompt-dmg-target">
            {targetPlayer ? (
              <div className="prompt-dmg-pick prompt-dmg-player" {...pick(target.id, targetPlayer.name)}>
                <span className="prompt-dmg-player-name">{targetPlayer.name}</span>
                <span className="prompt-dmg-life" title="Life now">
                  {targetPlayer.life}
                </span>
                {amount(target.id, null)}
                <span className="prompt-dmg-note">life after: {targetPlayer.life - (amounts[target.id] || 0)}</span>
              </div>
            ) : (
              <div className="prompt-dmg-pick" {...pick(target.id, names[target.id] ?? objectName(view, target.id))}>
                <StageCard id={target.id}>{amount(target.id, null)}</StageCard>
              </div>
            )}
            <span className="prompt-dmg-trample">Trample</span>
          </div>
        )}
      </div>
    </PromptStage>
  );
}

/** Why a division can't be confirmed yet (CR 601.2d: each target gets at least 1, and the amounts add up to exactly the total), or null when it can. */
export function divisionProblem(total: number, amounts: readonly number[]): string | null {
  if (!amounts.every((n) => Number.isInteger(n) && n >= 1)) return 'Each target needs at least 1 (CR 601.2d).';
  const sum = amounts.reduce((a, b) => a + b, 0);
  if (sum > total) return `${sum - total} too many: divide exactly ${total} (CR 601.2d).`;
  if (sum < total) return `${total - sum} left to divide (CR 601.2d).`;
  return null;
}

export function ChooseDivisionPrompt({ d, answer, busy }: PromptProps<'chooseDivision'>) {
  const [amounts, setAmounts] = useState<number[]>(() => defaultDivision(d.total, d.targets.length));
  const sum = amounts.reduce((a, b) => a + (Number.isNaN(b) ? 0 : b), 0);
  const problem = divisionProblem(d.total, amounts);
  const ok = problem === null;
  const submit = () => answer({ kind: 'chooseDivision', amounts });
  const what = d.what === 'damage' ? 'damage' : d.what === 'counters' ? 'counters' : '';
  usePrimary(submit, ok);
  return (
    <>
      <p className="prompt-detail">
        Divide {d.total} {what} among the targets; each gets at least 1 (CR 601.2d). {sum} of {d.total} divided.
      </p>
      <table className="prompt-table">
        <tbody>
          {d.targets.map((t, i) => (
            <tr key={`${t.id}-${i}`}>
              <th scope="row">{t.label}</th>
              <td>
                <Amount
                  label={`Amount for ${t.label}`}
                  value={amounts[i] ?? 1}
                  min={1}
                  max={Math.max(1, d.total - (d.targets.length - 1))}
                  busy={busy}
                  onChange={(n) => setAmounts((a) => a.map((x, j) => (j === i ? n : x)))}
                />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      {problem && <p className="prompt-warning" role="status">{problem}</p>}
      <PromptActions>
        <button type="button" className="button-primary" disabled={busy || !ok} onClick={submit}>
          Divide
        </button>
      </PromptActions>
    </>
  );
}
