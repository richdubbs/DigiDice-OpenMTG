/**
 * Declaring attackers (CR 508.1: click creatures; when one may attack several players, planeswalkers or battles, choose which, CR 508.1b) and blockers
 * (CR 509.1: click a blocker, then the attacker it blocks). Only the creatures and attackers the engine offers can be chosen; a declaration that is illegal
 * as a whole (menace with one blocker, CR 702.111b) is rejected by the engine with its explanation.
 *
 * Sound: arming an attacker (or taking it back, or Attack with all) is combat.arm; picking a blocker or the attacker it blocks is combat.assign. The
 * declaration itself is heard on the board (combat.attack, combat.block); its button keeps the page's generic confirm.
 */
import { useState } from 'react';
import type { DeclareAttackersDecision, DeclareBlockersDecision } from '@openmtg/engine';
import { gameSfx } from '../game/sound';
import { Chips } from './Chips';
import {
  aimAt, aimable, allAt, allAtPlayers, armAll, attackSplit, attackersOf, defaultDefender, initialAttacks, initialBlocks, initialMultiAttacks, isMultiplayerView,
  requirementObeyed, toggleAttacker, toggleBlock, underBlocked, untargeted, type Block,
} from './combat';
import { useEscape, usePrimary } from './keys';
import { distinctLabels, entityName, isPlayer, objectName, playerName } from './names';
import { usePublishSelection } from './selection';
import type { PromptProps } from './types';
import { PromptActions } from './PromptActions';

/**
 * M6-11 (M6-7, CR 508.1d, 509.1c): the attack or block requirements that apply, each marked obeyed or not by the declaration as it stands, how many a legal
 * declaration must obey (the most that can be obeyed without breaking a restriction), and what the engine does not check (said before the choice, never a
 * silent pass). Nothing is shown when no requirement applies.
 */
export function RequirementHint({ d, decl }: { d: DeclareAttackersDecision | DeclareBlockersDecision; decl: Parameters<typeof requirementObeyed>[1] }) {
  const reqs = d.requirements ?? [];
  const unchecked = d.unchecked ?? [];
  if (reqs.length === 0 && unchecked.length === 0) return null;
  const rule = d.kind === 'declareAttackers' ? 'CR 508.1d' : 'CR 509.1c';
  const obeyed = reqs.filter((r) => requirementObeyed(r, decl));
  const short = d.mustObey !== undefined && obeyed.length < d.mustObey;
  return (
    <div className="prompt-requirements" role="group" aria-label={`Requirements (${rule})`}>
      {reqs.length > 0 && (
        <>
          <p className="prompt-hint">
            {d.mustObey !== undefined
              ? `Requirements (${rule}): obey ${d.mustObey} of ${reqs.length}, the most that can be obeyed without breaking a restriction. Obeyed now: ${obeyed.length}.`
              : `Requirements (${rule}): the engine can't tell how many can be obeyed here, so it does not enforce them; obey as many as you can.`}
          </p>
          <ul>
            {reqs.map((r) => {
              const ok = obeyed.includes(r);
              return (
                <li key={r.id} className={ok ? 'is-obeyed' : 'is-not-obeyed'}>
                  {ok ? '✓ ' : '○ '}
                  {r.text} <span className="prompt-rules">({r.sourceName}{ok ? ', obeyed' : ', not obeyed'})</span>
                </li>
              );
            })}
          </ul>
        </>
      )}
      {short && (
        <p className="prompt-warning" role="status">
          This declaration obeys {obeyed.length} of the {d.mustObey} requirements it must obey: the engine will refuse it ({rule}).
        </p>
      )}
      {unchecked.length > 0 && (
        <div className="prompt-hint">
          Not checked by the engine (check these yourself):
          <ul>
            {unchecked.map((u, i) => (
              <li key={i}>
                {u.sourceName}: {u.text}
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

/**
 * Declaring attackers. M12-4b (m12 design D15, 5.3 item 2): a multiplayer game (`options.multiplayer`) has its own prompt with no default target
 * (MultiplayerAttackersPrompt); a two-player game keeps this one exactly as before (the one opponent preselected, CR 508.1b).
 */
export function DeclareAttackersPrompt(props: PromptProps<'declareAttackers'>) {
  return isMultiplayerView(props.view) ? <MultiplayerAttackersPrompt {...props} /> : <DuelAttackersPrompt {...props} />;
}

/**
 * M12-4b (m12 design D15, 5.3 item 2): attacks with several possible defenders. Clicking a creature declares it "needs a target" (unless it
 * has only one); clicking a player's life disc or name plate, a planeswalker or a battle then aims every attacker without a target that can attack it
 * there. Each attacker's line in the prompt shows its target and can change it; "All at <player>" sends every creature that can attack that player. The
 * declare button stays disabled ("Pick a target for 2 attackers") until every attacker has one, then names the split ("Attack: Bianca (2), Carol (1)"). The
 * targets are published for the board's arrows (BoardInteraction.attackTargets).
 */
function MultiplayerAttackersPrompt({ d, view, answer, busy }: PromptProps<'declareAttackers'>) {
  const [attacks, setAttacks] = useState<Record<string, string | null>>(() => initialMultiAttacks(d));
  const ids = d.candidates.map((c) => c.id);
  const candidate = (id: string) => d.candidates.find((c) => c.id === id);
  const waiting = untargeted(attacks, d);
  const targets = aimable(attacks, d);
  const click = (id: string) => {
    if (ids.includes(id)) {
      gameSfx('combat.arm');
      setAttacks((a) => toggleAttacker(a, d, id));
    } else if (targets.includes(id)) {
      gameSfx('combat.assign');
      setAttacks((a) => aimAt(a, d, id));
    }
  };
  const declared = ids.filter((id) => attacks[id] !== undefined);
  const list = declared.flatMap((id) => (attacks[id] ? [{ attacker: id, defender: attacks[id]! }] : []));
  const ready = waiting.length === 0;
  const submit = () => {
    if (ready) answer({ kind: 'declareAttackers', attacks: list });
  };
  const names = distinctLabels(view, ids); // the same "#1" / "#2" as the chips, so each target line says which creature it is for
  const targetName = (id: string) => (isPlayer(view, id) ? playerName(view, id) : objectName(view, id));
  const marks: Record<string, string> = {};
  for (const c of d.candidates) {
    const t = attacks[c.id];
    if (t) marks[c.id] = `attacking ${targetName(t)}`;
    else if (t === null) marks[c.id] = 'needs a target';
    else if (c.mustAttack) marks[c.id] = 'must attack';
  }
  const attackTargets: Record<string, string> = Object.fromEntries(list.map((x) => [x.attacker, x.defender]));
  usePrimary(submit, ready);
  usePublishSelection({ selectable: [...ids, ...targets], selected: declared, marks, click, attackTargets });
  const everyone = allAtPlayers(view, d);
  const split = attackSplit(view, attacks, targetName);
  const s = (n: number) => (n === 1 ? '' : 's');
  return (
    <>
      <p className="prompt-detail">
        {waiting.length > 0
          ? `Now click whom ${waiting.length === 1 ? `${names[waiting[0]!]} attacks` : `these ${waiting.length} attackers attack`}: a player's life, a planeswalker or a battle (CR 508.1b, 802.2).`
          : 'Click creatures to attack with; each one picks its own target: a player, a planeswalker or a battle (CR 508.1b, 802.2).'}
      </p>
      <Chips view={view} ids={ids} selected={declared} marks={marks} onClick={click} disabled={busy} label="Creatures that can attack" />
      {declared
        .filter((id) => (candidate(id)?.defenders.length ?? 0) > 1)
        .map((id) => (
          <label key={id} className="prompt-field" data-needs-target={attacks[id] === null || undefined}>
            {names[id]} attacks
            <select
              value={attacks[id] ?? ''}
              disabled={busy}
              onChange={(e) => {
                const v = e.target.value;
                setAttacks((a) => ({ ...a, [id]: v === '' ? null : v }));
              }}
            >
              <option value="">Pick a target…</option>
              {candidate(id)!.defenders.map((def) => (
                <option key={def} value={def}>
                  {targetName(def)}
                </option>
              ))}
            </select>
          </label>
        ))}
      {everyone.length > 1 && (
        <div className="prompt-chips" role="group" aria-label="Attack with all at one player">
          {everyone.map((p) => (
            <button
              key={p}
              type="button"
              className="prompt-chip"
              disabled={busy}
              onClick={() => {
                gameSfx('combat.arm');
                setAttacks((a) => allAt(a, d, p));
              }}
            >
              All at {playerName(view, p)}
            </button>
          ))}
        </div>
      )}
      <RequirementHint d={d} decl={{ attacks: list }} />
      <PromptActions>
        <button
          type="button"
          disabled={busy || declared.length === ids.length}
          onClick={() => {
            gameSfx('combat.arm');
            setAttacks((a) => armAll(a, d));
          }}
        >
          Attack with all
        </button>
        <button type="button" className="button-primary" disabled={busy || !ready} onClick={submit}>
          {!ready ? `Pick a target for ${waiting.length} attacker${s(waiting.length)}` : list.length === 0 ? 'No attacks' : `Attack: ${split}`}
        </button>
        <button type="button" disabled={busy || declared.length === 0} onClick={() => setAttacks({})}>
          Clear
        </button>
      </PromptActions>
    </>
  );
}

function DuelAttackersPrompt({ d, view, answer, busy }: PromptProps<'declareAttackers'>) {
  const [attacks, setAttacks] = useState<Record<string, string>>(() => initialAttacks(view, d));
  const ids = d.candidates.map((c) => c.id);
  const candidate = (id: string) => d.candidates.find((c) => c.id === id);
  const click = (id: string) => {
    gameSfx('combat.arm');
    setAttacks((a) => {
      if (a[id] !== undefined) {
        const { [id]: _gone, ...rest } = a;
        return rest;
      }
      const def = defaultDefender(view, candidate(id)?.defenders ?? []);
      return def === undefined ? a : { ...a, [id]: def };
    });
  };
  const all = () => {
    gameSfx('combat.arm');
    setAttacks((a) => {
      const next = { ...a };
      for (const c of d.candidates) {
        const def = defaultDefender(view, c.defenders);
        if (next[c.id] === undefined && def !== undefined) next[c.id] = def;
      }
      return next;
    });
  };
  const list = ids.filter((id) => attacks[id] !== undefined).map((id) => ({ attacker: id, defender: attacks[id]! }));
  const submit = () => answer({ kind: 'declareAttackers', attacks: list });
  const marks: Record<string, string> = {};
  for (const c of d.candidates) {
    if (attacks[c.id] !== undefined) marks[c.id] = `attacking ${entityName(view, attacks[c.id]!)}`;
    else if (c.mustAttack) marks[c.id] = 'must attack';
  }
  usePrimary(submit);
  usePublishSelection({ selectable: ids, selected: list.map((x) => x.attacker), marks, click });
  const names = distinctLabels(view, ids); // the same "#1" / "#2" as the chips, so each defender choice says which creature it is for
  return (
    <>
      <Chips view={view} ids={ids} selected={list.map((x) => x.attacker)} marks={marks} onClick={click} disabled={busy} label="Creatures that can attack" />
      {list
        .filter((x) => (candidate(x.attacker)?.defenders.length ?? 0) > 1)
        .map((x) => (
          <label key={x.attacker} className="prompt-field">
            {names[x.attacker]} attacks
            <select value={x.defender} disabled={busy} onChange={(e) => setAttacks((a) => ({ ...a, [x.attacker]: e.target.value }))}>
              {candidate(x.attacker)!.defenders.map((def) => (
                <option key={def} value={def}>
                  {entityName(view, def)}
                </option>
              ))}
            </select>
          </label>
        ))}
      <RequirementHint d={d} decl={{ attacks: list }} />
      {/* Attack with all comes first, then the submit button. */}
      <PromptActions>
        <button type="button" disabled={busy || list.length === ids.length} onClick={all}>
          Attack with all
        </button>
        <button type="button" className="button-primary" disabled={busy} onClick={submit}>
          {list.length === 0 ? 'No attacks' : `Attack with ${list.length}`}
        </button>
        <button type="button" disabled={busy || list.length === 0} onClick={() => setAttacks({})}>
          Clear
        </button>
      </PromptActions>
    </>
  );
}

export function DeclareBlockersPrompt({ d, view, answer, busy }: PromptProps<'declareBlockers'>) {
  const [blocks, setBlocks] = useState<Block[]>(() => initialBlocks(d)); // M6-11: the engine's obeying declaration when it enforces requirements (CR 509.1c)
  const [picked, setPicked] = useState<string | null>(null);
  const blockers = d.candidates.map((c) => c.id);
  const attackers = attackersOf(view, d);
  const canBlock = picked ? (d.candidates.find((c) => c.id === picked)?.attackers ?? []) : [];
  const block = (attacker: string) => {
    if (!picked) return;
    gameSfx('combat.assign');
    setBlocks((b) => toggleBlock(b, d, picked, attacker));
    if ((d.candidates.find((c) => c.id === picked)?.maxBlocks ?? 1) <= 1) setPicked(null);
  };
  const click = (id: string) => {
    if (blockers.includes(id)) {
      gameSfx('combat.assign');
      setPicked((p) => (p === id ? null : id));
    } else if (canBlock.includes(id)) block(id);
  };
  const submit = () => answer({ kind: 'declareBlockers', blocks });
  // Numbered labels ("Grizzly Bears #2") wherever a blocker or an attacker is named, so two creatures with the same name can be told apart.
  const names: Record<string, string> = { ...distinctLabels(view, blockers), ...distinctLabels(view, attackers) };
  const name = (id: string) => names[id] ?? objectName(view, id);
  const marks: Record<string, string> = {};
  for (const b of blockers) {
    const mine = blocks.filter((x) => x.blocker === b).map((x) => name(x.attacker));
    if (mine.length) marks[b] = `blocking ${mine.join(', ')}`;
  }
  for (const a of attackers) {
    const n = blocks.filter((x) => x.attacker === a).length;
    if (n) marks[a] = `${n} blocker${n === 1 ? '' : 's'}`;
  }
  // M6-11 (M6-7, CR 509.1c): what a requirement asks of a creature that does not do it yet
  for (const r of d.requirements ?? []) {
    if (marks[r.creature] !== undefined || requirementObeyed(r, { blocks })) continue;
    if (r.kind === 'block') marks[r.creature] = 'must block';
    else if (r.kind === 'beBlocked') marks[r.creature] = 'must be blocked';
  }
  const warn = underBlocked(d, blocks);
  usePrimary(submit);
  useEscape(() => {
    if (picked === null) return false;
    setPicked(null);
    return true;
  });
  usePublishSelection({ selectable: [...blockers, ...canBlock], selected: [...(picked ? [picked] : []), ...blocks.map((b) => b.blocker)], marks, click });
  return (
    <>
      <p className="prompt-detail">{picked ? `Now click the attacker ${name(picked)} blocks.` : 'Click a creature to block with, then the attacker it blocks.'}</p>
      <h4 className="prompt-heading">Your blockers</h4>
      <Chips view={view} ids={blockers} selected={picked ? [picked] : []} marks={marks} onClick={click} disabled={busy} label="Your creatures that can block" />
      <h4 className="prompt-heading">Attackers</h4>
      <div className="prompt-chips" role="group" aria-label="Attackers">
        {attackers.map((a) => (
          <button key={a} type="button" className="prompt-chip" disabled={busy || !canBlock.includes(a)} onClick={() => block(a)}>
            {name(a)}
            {d.needsMultiple.includes(a) ? ` (needs ${blockerFloor(d, a)} or more blockers)` : ''}
            {blockerCap(d, a)}
            {marks[a] ? <span className="prompt-chip-mark"> · {marks[a]}</span> : null}
          </button>
        ))}
      </div>
      {blocks.length > 0 && (
        <ul className="prompt-list" aria-label="Blocks">
          {blocks.map((b) => {
            const text = `${name(b.blocker)} blocks ${name(b.attacker)}`;
            return (
              <li key={`${b.blocker}>${b.attacker}`}>
                {text}
                <button type="button" className="prompt-button-small" aria-label={`Remove: ${text}`} disabled={busy} onClick={() => setBlocks((l) => l.filter((x) => x !== b))}>
                  Remove
                </button>
              </li>
            );
          })}
        </ul>
      )}
      {warn.length > 0 && (
        <p className="prompt-warning" role="status">
          {warn.map((a) => name(a)).join(', ')} can't be blocked except by two or more creatures (CR 702.111b).
        </p>
      )}
      <RequirementHint d={d} decl={{ blocks }} />
      <PromptActions>
        <button type="button" className="button-primary" disabled={busy} onClick={submit}>
          {blocks.length === 0 ? 'No blocks' : 'Confirm blocks'}
        </button>
        <button type="button" disabled={busy || blocks.length === 0} onClick={() => setBlocks([])}>
          Clear
        </button>
      </PromptActions>
    </>
  );
}

/** The fewest blockers that block an attacker needing several: "two" (menace, CR 702.111b) or the number of "can't be blocked except by three or more creatures" (FAST5 T57). */
function blockerFloor(d: DeclareBlockersDecision, a: string): string {
  const min = d.minBlockers?.find((x) => x.attacker === a)?.min;
  return min === undefined ? 'two' : ['zero', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten'][min] ?? String(min);
}

/** MX5, CR 509.1b: "can't be blocked by more than N creatures", said on the attacker's chip. */
function blockerCap(d: DeclareBlockersDecision, a: string): string {
  const max = d.maxBlockers?.find((x) => x.attacker === a)?.max;
  return max === undefined ? '' : max === 1 ? ' (at most one blocker)' : ` (at most ${max} blockers)`;
}
