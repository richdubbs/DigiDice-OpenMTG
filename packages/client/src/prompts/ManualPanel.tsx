/**
 * The manual-adjustment panel: build one `ManualOp` at a time (move, life, counters, tap, draw, shuffle, control, damage, mana, attach, token, note) and add
 * it to the list. Objects are picked from a list or by clicking them on the board.
 */
import { useState } from 'react';
import { MANUAL_MOVE_ZONES, type GameView, type ManualOp, type ObjectId } from '@openmtg/engine';
import { buildOp, emptyDraft, FIELDS, MANUAL_KINDS, pickableObjects, type ManualDraft, type ManualKind } from './manualOps';
import { playerName } from './names';
import { usePublishSelection } from './selection';

/** M12-4b (CR 800.4a): the players a by-hand change can name: those still in the game (a player who left has no objects and no turns). */
const inGame = (view: GameView) => view.players.filter((p) => !p.hasLost);

const ZONE_LABELS: Record<string, string> = {
  hand: 'Hand', battlefield: 'Battlefield', graveyard: 'Graveyard', exile: 'Exile', libraryTop: 'Top of library', libraryBottom: 'Bottom of library',
};

/** `onAdd` returns why the operation can't be added (it is then shown and the draft kept), or nothing when it was added. */
export function ManualPanel({ view, exclude, busy, onAdd }: { view: GameView; exclude?: ObjectId; busy: boolean; onAdd: (op: ManualOp) => string | null }) {
  const [draft, setDraft] = useState<ManualDraft>(() => emptyDraft(view));
  const [error, setError] = useState<string | null>(null);
  const objects = pickableObjects(view, exclude);
  const fields = FIELDS[draft.kind];
  const set = <K extends keyof ManualDraft>(k: K, v: ManualDraft[K]) => setDraft((d) => ({ ...d, [k]: v }));
  const has = (f: keyof ManualDraft) => fields.includes(f);
  // A click on the board fills the object (or object-or-player) field of the operation being built.
  const pickField: keyof ManualDraft | null = has('object') ? 'object' : has('target') ? 'target' : null;
  usePublishSelection(
    pickField
      ? {
        selectable: [...objects.map((o) => o.id), ...(pickField === 'target' ? inGame(view).map((p) => p.id) : [])],
        selected: draft[pickField] ? [draft[pickField] as string] : [],
        click: (id) => set(pickField, id),
      }
      : null,
  );
  const add = () => {
    const r = buildOp(draft);
    if ('error' in r) {
      setError(r.error);
      return;
    }
    const refused = onAdd(r.op);
    setError(refused);
    if (refused === null) setDraft((d) => ({ ...emptyDraft(view, d.kind), player: d.player }));
  };
  const objectSelect = (k: 'object' | 'target' | 'attachTo', label: string, withPlayers: boolean, noneLabel?: string) => (
    <label className="prompt-field">
      {label}
      <select aria-label={label} value={draft[k]} disabled={busy} onChange={(e) => set(k, e.target.value)}>
        <option value="">{noneLabel ?? '(choose)'}</option>
        {withPlayers && inGame(view).map((p) => <option key={p.id} value={p.id}>{`Player: ${p.name}`}</option>)}
        {objects.map((o) => <option key={o.id} value={o.id}>{o.label}</option>)}
      </select>
    </label>
  );
  const text = (k: keyof ManualDraft, label: string, placeholder?: string) => (
    <label className="prompt-field">
      {label}
      <input type="text" aria-label={label} value={String(draft[k])} placeholder={placeholder} disabled={busy} onChange={(e) => set(k, e.target.value as never)} />
    </label>
  );
  return (
    <fieldset className="prompt-manual-panel">
      <legend>Manual adjustment</legend>
      <label className="prompt-field">
        Operation
        <select aria-label="Operation" value={draft.kind} disabled={busy} onChange={(e) => setDraft({ ...emptyDraft(view, e.target.value as ManualKind), player: draft.player })}>
          {MANUAL_KINDS.map((k) => <option key={k.kind} value={k.kind}>{k.label}</option>)}
        </select>
      </label>
      {has('object') && objectSelect('object', draft.kind === 'attach' ? 'Attachment' : 'Card', false)}
      {has('target') && objectSelect('target', draft.kind === 'damage' ? 'Damage to' : 'Counters on', true)}
      {has('zone') && (
        <label className="prompt-field">
          To
          <select aria-label="To zone" value={draft.zone} disabled={busy} onChange={(e) => set('zone', e.target.value)}>
            {MANUAL_MOVE_ZONES.map((z) => <option key={z} value={z}>{ZONE_LABELS[z] ?? z}</option>)}
          </select>
        </label>
      )}
      {has('attachTo') && (draft.kind === 'attach' || draft.zone === 'battlefield') && objectSelect('attachTo', 'Attached to', true, draft.kind === 'attach' ? '(nothing: unattach)' : '(not attached)')}
      {has('player') && (
        <label className="prompt-field">
          {draft.kind === 'control' ? 'New controller' : 'Player'}
          <select aria-label="Player" value={draft.player} disabled={busy} onChange={(e) => set('player', e.target.value)}>
            {inGame(view).map((p) => <option key={p.id} value={p.id}>{playerName(view, p.id)}</option>)}
          </select>
        </label>
      )}
      {has('counter') && text('counter', 'Counter kind', '+1/+1, loyalty, poison...')}
      {has('amount') && text('amount', draft.kind === 'life' ? 'Life change' : draft.kind === 'draw' ? 'Cards' : draft.kind === 'counters' ? 'Number (minus to remove)' : 'Amount')}
      {has('mana') && text('mana', 'Mana', 'e.g. RRG')}
      {has('name') && text('name', 'Token name')}
      {has('typeLine') && text('typeLine', 'Type line')}
      {has('power') && /\bCreature\b/.test(draft.typeLine) && text('power', 'Power')}
      {has('toughness') && /\bCreature\b/.test(draft.typeLine) && text('toughness', 'Toughness')}
      {has('colors') && text('colors', 'Colors', 'e.g. W or UB; empty for colorless')}
      {has('tapped') && (
        <label className="prompt-field">
          <input type="checkbox" checked={draft.tapped} disabled={busy} onChange={(e) => set('tapped', e.target.checked)} />
          {draft.kind === 'tap' ? 'Tapped (untick to untap)' : 'Enters tapped'}
        </label>
      )}
      {has('text') && text('text', 'Note text')}
      <button type="button" disabled={busy} onClick={add}>
        Add adjustment
      </button>
      {error && <p className="prompt-warning" role="status">{error}</p>}
    </fieldset>
  );
}
