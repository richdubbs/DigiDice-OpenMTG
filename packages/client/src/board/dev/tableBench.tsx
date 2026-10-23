/**
 * M12-4a dev harness (not part of the app; `table-bench.html`, served by the Vite dev server only, never built): the shared table in the browser before
 * the New game screen offers 3-4 players (M12-4b).
 *
 *   /table-bench.html?mode=game&players=4[&life=6]      a real 3-4 player hot-seat game (LocalConnection, pass cover, prompts): look and play
 *   /table-bench.html?mode=bench&players=4&perms=40       a board with `perms` permanents per player; the frame-rate measurement (m12 design 5.1)
 *   &layout=shared|acrossTop|focused                       the table layout (default shared)
 *   &seat=p1                                               only that player sits at this screen (no pass cover; the others wait)
 *   /table-bench.html?mode=bench&players=2&perms=8&demo=1  bench board with what the card overlay draws: counters, +1/+1 counters, an attached Aura
 *                                                          on each side's first creature, a planeswalker, and the second player's first creature attacking
 *
 * The measurement sweeps the pointer over the table for a few seconds (the camera follows it) and counts animation frames: the median and the worst
 * frame time and the frames per second are shown and kept in `window.__tableBench` (read by the browser check).
 */
import { useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { GameSession, compileCard, viewFor, type CardDef, type GameConfig, type GameState, type GameView } from '@openmtg/engine';
import { NavProvider } from '../../app/nav';
import { LocalConnection } from '../../connection/LocalConnection';
import { GameScreen } from '../../game/GameScreen';
import { sealConnection } from '../../game/sealed';
import { connectProfiles } from '../../profiles/profiles';
import { SettingsStore, type TableLayout } from '../../settings/settings';
import { applyTheme, themeVars } from '../../theme/theme';
import { GameBoard } from '../GameBoard';
import '../../theme/styles.css';
import '../../theme/neon-grid.css';
import '../../theme/lcars.css';

const q = new URLSearchParams(location.search);
const players = Math.min(4, Math.max(2, Number(q.get('players') ?? 4)));
const perms = Math.max(0, Number(q.get('perms') ?? 40));
const layout = (q.get('layout') ?? 'shared') as TableLayout;
const life = Number(q.get('life') ?? 20);

const DEFS: CardDef[] = [
  compileCard({ name: 'Mountain', layout: 'normal', type_line: 'Basic Land — Mountain', oracle_text: '({T}: Add {R}.)' }),
  compileCard({ name: 'Forest', layout: 'normal', type_line: 'Basic Land — Forest', oracle_text: '({T}: Add {G}.)' }),
  compileCard({ name: 'Island', layout: 'normal', type_line: 'Basic Land — Island', oracle_text: '({T}: Add {U}.)' }),
  compileCard({ name: 'Plains', layout: 'normal', type_line: 'Basic Land — Plains', oracle_text: '({T}: Add {W}.)' }),
  compileCard({ name: 'Bench Shock', layout: 'normal', mana_cost: '{R}', type_line: 'Instant', oracle_text: 'Bench Shock deals 2 damage to any target.' }),
  compileCard({ name: 'Goblin Raider', layout: 'normal', mana_cost: '{1}{R}', type_line: 'Creature — Goblin', power: '2', toughness: '2', oracle_text: '' }),
  compileCard({ name: 'Grizzly Cub', layout: 'normal', mana_cost: '{1}{G}', type_line: 'Creature — Bear', power: '2', toughness: '2', oracle_text: '' }),
  compileCard({ name: 'Cloud Sprite', layout: 'normal', mana_cost: '{U}', type_line: 'Creature — Faerie', power: '1', toughness: '1', oracle_text: 'Flying' }),
  compileCard({ name: 'Bench Knight', layout: 'normal', mana_cost: '{W}{W}', type_line: 'Creature — Human Knight', power: '2', toughness: '2', oracle_text: 'First strike' }),
  compileCard({ name: 'Spirit Lantern', layout: 'normal', mana_cost: '{2}', type_line: 'Artifact', oracle_text: '{T}: You gain 1 life.' }),
  compileCard({ name: 'Bench Might', layout: 'normal', mana_cost: '{1}{G}', type_line: 'Enchantment — Aura', oracle_text: 'Enchant creature\nEnchanted creature gets +2/+2.' }),
  compileCard({ name: 'Bench Weakness', layout: 'normal', mana_cost: '{B}', type_line: 'Enchantment — Aura', oracle_text: 'Enchant creature\nEnchanted creature gets -1/-1.' }),
  compileCard({ name: 'Bench Walker', layout: 'normal', mana_cost: '{2}{U}', type_line: 'Legendary Planeswalker — Bench', loyalty: '3', oracle_text: '+1: Draw a card.' }),
];
const demo = q.get('demo') === '1';
const id = (name: string) => DEFS.find((d) => d.name === name)!.id;
const fill = (n: number, name: string) => Array<string>(n).fill(id(name));

const NAMES = ['Alice', 'Bianca', 'Carol', 'Dmitri'];
const DECKS = [
  () => [...fill(16, 'Mountain'), ...fill(10, 'Bench Shock'), ...fill(14, 'Goblin Raider')],
  () => [...fill(16, 'Forest'), ...fill(20, 'Grizzly Cub'), ...fill(4, 'Spirit Lantern')],
  () => [...fill(16, 'Island'), ...fill(20, 'Cloud Sprite'), ...fill(4, 'Spirit Lantern')],
  () => [...fill(16, 'Plains'), ...fill(20, 'Bench Knight'), ...fill(4, 'Spirit Lantern')],
];

function config(seed: string): GameConfig {
  const n = players;
  return {
    seed,
    players: Array.from({ length: n }, (_, i) => ({ id: `p${i + 1}`, name: NAMES[i]!, deck: DECKS[i]!() })),
    defs: DEFS,
    options: { startingLife: life, startingPlayer: 'p1', ...(q.get('seat') ? { skipMulligans: true } : {}), ...(n > 2 ? { multiplayer: { variant: 'freeForAll' as const, attack: 'multiple' as const } } : {}) },
  };
}

/** A settled state with `perms` permanents per player put onto the battlefield from their library (lands, creatures, artifacts; some tapped). */
function benchView(): GameView {
  const session = new GameSession({ ...config('bench'), options: { ...config('bench').options, skipMulligans: true } });
  const s = structuredClone(session.state) as GameState;
  for (const p of s.players) {
    const lib = s.zones.library[p.id] ?? [];
    const take = lib.splice(0, Math.min(perms, lib.length));
    for (const [i, oid] of take.entries()) {
      const o = s.objects[oid]!;
      o.zone = 'battlefield';
      o.controller = p.id;
      o.tapped = i % 5 === 0;
      s.zones.battlefield.push(oid);
    }
  }
  if (demo) addDemo(s);
  return viewFor(s, 'p1');
}

/** `&demo=1`: what the card overlay and the tucked attachments draw, on a bench board. */
function addDemo(s: GameState): void {
  const add = (name: string, controller: string, extra: Partial<GameState['objects'][string]> = {}): string => {
    const base = s.objects[s.zones.battlefield[0]!]!;
    const oid = `demo${Object.keys(s.objects).length}`;
    s.objects[oid] = { ...structuredClone(base), id: oid, defId: id(name), owner: controller, controller, tapped: false, counters: {}, damage: 0, attachedTo: undefined, ...extra } as GameState['objects'][string];
    s.zones.battlefield.push(oid);
    return oid;
  };
  for (const p of s.players) {
    const mine = s.zones.battlefield.filter((x) => s.objects[x]!.controller === p.id);
    const creatures = mine.filter((x) => s.defs[s.objects[x]!.defId]!.faces[0]!.typeLine.includes('Creature'));
    const artifact = mine.find((x) => s.defs[s.objects[x]!.defId]!.name === 'Spirit Lantern');
    if (creatures[0]) {
      s.objects[creatures[0]]!.counters = { '+1/+1': 2 };
      s.objects[creatures[0]]!.tapped = false;
      add('Bench Might', p.id, { attachedTo: creatures[0] });
      add('Bench Weakness', p.id === 'p1' ? 'p2' : 'p1', { attachedTo: creatures[0] });
    }
    if (creatures[1]) s.objects[creatures[1]]!.counters = { '-1/-1': 1, stun: 1 };
    if (artifact) s.objects[artifact]!.counters = { charge: 3 };
    add('Bench Walker', p.id, { counters: { loyalty: 4 } });
  }
  const attacker = s.zones.battlefield.find((x) => s.objects[x]!.controller === 'p2' && s.defs[s.objects[x]!.defId]!.faces[0]!.typeLine.includes('Creature') && !s.objects[x]!.attachedTo);
  if (attacker) {
    s.objects[attacker]!.tapped = true;
    s.combat = { number: 1, attacked: true, attackers: [{ id: attacker, defender: 'p1', defendingPlayer: 'p1', blockedBy: [], blocked: false }], blockers: [], damageSteps: 0, extraDamageStep: false, firstStrikers: [] };
  }
}

interface BenchResult {
  players: number;
  perms: number;
  layout: string;
  width: number;
  height: number;
  frames: number;
  seconds: number;
  fps: number;
  medianMs: number;
  p95Ms: number;
  worstMs: number;
}

declare global {
  interface Window {
    __tableBench?: BenchResult;
    __runTableBench?: (seconds?: number) => Promise<BenchResult>;
  }
}

/** Sweeps the pointer round the table (pointermove events on the table) and times the frames. */
async function runBench(seconds = 6): Promise<BenchResult> {
  const main = document.querySelector<HTMLElement>('.board-main')!;
  const r = main.getBoundingClientRect();
  const times: number[] = [];
  let last = performance.now();
  const start = last;
  await new Promise<void>((resolve) => {
    const tick = (now: number) => {
      times.push(now - last);
      last = now;
      const t = (now - start) / 1000;
      // A slow figure-eight over the whole table: the camera keeps following (the dead zone in the middle is crossed twice a loop).
      const x = r.left + r.width * (0.5 + 0.46 * Math.sin(t * 1.3));
      const y = r.top + r.height * 0.4 * (1 + 0.9 * Math.sin(t * 2.1));
      main.dispatchEvent(new PointerEvent('pointermove', { clientX: x, clientY: y, bubbles: true, buttons: 0 }));
      if (now - start < seconds * 1000) requestAnimationFrame(tick);
      else resolve();
    };
    requestAnimationFrame(tick);
  });
  const frames = times.slice(2);
  const sorted = [...frames].sort((a, b) => a - b);
  const total = frames.reduce((a, b) => a + b, 0) / 1000;
  const result: BenchResult = {
    players,
    perms,
    layout,
    width: Math.round(window.innerWidth),
    height: Math.round(window.innerHeight),
    frames: frames.length,
    seconds: Math.round(total * 100) / 100,
    fps: Math.round((frames.length / total) * 10) / 10,
    medianMs: Math.round(sorted[Math.floor(sorted.length / 2)]! * 10) / 10,
    p95Ms: Math.round(sorted[Math.floor(sorted.length * 0.95)]! * 10) / 10,
    worstMs: Math.round(sorted[sorted.length - 1]! * 10) / 10,
  };
  window.__tableBench = result;
  return result;
}

function Bench() {
  const [view] = useState(benchView);
  const [result, setResult] = useState<BenchResult | null>(null);
  useEffect(() => {
    window.__runTableBench = async (s?: number) => {
      const r = await runBench(s);
      setResult(r);
      return r;
    };
  }, []);
  return (
    <div style={{ height: '100vh', display: 'flex', flexDirection: 'column' }}>
      <div style={{ flex: 1, minHeight: 0 }}>
        <GameBoard view={view} tableLayout={layout} onTableLayout={(l) => (location.search = new URLSearchParams({ ...Object.fromEntries(q), layout: l }).toString())} />
      </div>
      <div style={{ position: 'fixed', left: 8, bottom: 8, zIndex: 100, background: '#000c', color: '#fff', padding: '4px 8px', font: '12px monospace' }}>
        <button type="button" onClick={() => void window.__runTableBench?.(6)}>
          Measure 6 s
        </button>{' '}
        {result ? `${result.fps} fps, median ${result.medianMs} ms, p95 ${result.p95Ms} ms, worst ${result.worstMs} ms (${result.width}x${result.height})` : `${players} x ${perms} permanents`}
      </div>
    </div>
  );
}

function Game() {
  // &seat=p1: only that player sits here (the others' decisions wait; the engine passes for them when they cannot act): every change is animated on one screen.
  const seat = q.get('seat');
  const [conn] = useState(() => sealConnection(new LocalConnection(config(String(q.get('seed') ?? 'table')), seat ? { seats: [seat] } : {})));
  const [settings] = useState(() => {
    const st = new SettingsStore();
    st.update({ tableLayout: layout });
    return st;
  });
  return (
    <div style={{ height: '100vh' }}>
      <NavProvider initial={{ screen: 'game', connection: conn }}>
        <GameScreen connection={conn} settings={settings} coverDelayMs={0} />
      </NavProvider>
    </div>
  );
}

applyTheme(document.documentElement);
// The UI profile in use (Settings, Look and feel), as in the app.
connectProfiles(document.documentElement, undefined, themeVars());
createRoot(document.getElementById('root')!).render(q.get('mode') === 'bench' ? <Bench /> : <Game />);
