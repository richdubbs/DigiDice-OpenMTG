/**
 * UI profiles (docs/design/ui-profiles.md): the look and feel of the interface, saved under a name. Every profile is built on a template, one of the
 * complete looks the client ships: Neon Grid (the DigiDice neon room every screen was designed in), LCARS (a flat starship-console look:
 * theme/lcars.css) and Reality Fracture (a shattered-mirror world after the Reality Fracture set's Echoverse: theme/fracture.css). A profile keeps its
 * template's palette with any colors the player changed, a text size, whether backgrounds move and whether the template's background scene is shown.
 * Only the look changes: every screen works the same in every profile.
 *
 * The templates are read-only profiles of their own (ids `template:<id>`), so a player can switch to either without saving anything; the player's own
 * profiles are kept in this browser's localStorage. Like the settings (settings/settings.ts) every read and write is wrapped in try/catch, and anything
 * stored that is not understood falls back to the template's value for that field.
 */
import { BRAND } from '../branding/brand';
import { contrastRatio, rgbChannels } from '../theme/theme';

export type TemplateId = 'neonGrid' | 'lcars' | 'fracture';
export const TEMPLATE_IDS: readonly TemplateId[] = ['neonGrid', 'lcars', 'fracture'];

/** One color of a template's palette that a profile can change. */
export interface ColorSlot {
  key: string;
  label: string;
  hint: string;
  /** #rrggbb */
  default: string;
}

export interface ProfileTemplate {
  id: TemplateId;
  name: string;
  description: string;
  slots: readonly ColorSlot[];
  /** Ready-made palettes (the first one is the template's own). */
  presets: readonly { name: string; colors: Readonly<Record<string, string>> }[];
  /** What the template's background scene is, for the switch that hides it. */
  sceneLabel: string;
}

export const TEMPLATES: Readonly<Record<TemplateId, ProfileTemplate>> = {
  neonGrid: {
    id: 'neonGrid',
    name: 'Neon Grid',
    description: 'The DigiDice neon room: dark glass panels with neon edges, raised slab buttons and a glowing grid floor.',
    slots: [
      { key: 'neon', label: 'Neon', hint: 'Edges, glows, the lit tab and the main buttons', default: BRAND.colors.blue.toLowerCase() },
      { key: 'neon2', label: 'Second neon', hint: 'Corner brackets, the horizon and the danger buttons', default: BRAND.colors.magenta.toLowerCase() },
    ],
    presets: [
      { name: 'DigiDice', colors: { neon: BRAND.colors.blue.toLowerCase(), neon2: BRAND.colors.magenta.toLowerCase() } },
      { name: 'Synthwave', colors: { neon: '#ff4fd8', neon2: '#ffb000' } },
      { name: 'Toxic', colors: { neon: '#39ff7a', neon2: '#00e1ff' } },
      { name: 'Ember', colors: { neon: '#ff7a1f', neon2: '#ff2b4a' } },
    ],
    sceneLabel: 'Neon grid floor and horizon behind every screen',
  },
  lcars: {
    id: 'lcars',
    name: 'LCARS',
    description: 'A starship library computer console: black screens framed by rounded color bars and elbows, pill buttons and condensed capitals.',
    slots: [
      { key: 'frame', label: 'Frame', hint: 'The sidebar, elbows and frame bars', default: '#ff9c00' },
      { key: 'button', label: 'Buttons', hint: 'Buttons and switches', default: '#ffcc99' },
      { key: 'panel', label: 'Panels', hint: 'Panel frames and headings', default: '#cc99cc' },
      { key: 'highlight', label: 'Highlight', hint: 'The current tab, chosen items, focus and primary buttons', default: '#9999ff' },
      { key: 'alert', label: 'Alert', hint: 'Danger buttons, warnings and errors', default: '#e05a4f' },
      { key: 'text', label: 'Text', hint: 'Body text on the black screen', default: '#ffe6c7' },
    ],
    presets: [
      { name: 'Classic', colors: { frame: '#ff9c00', button: '#ffcc99', panel: '#cc99cc', highlight: '#9999ff', alert: '#e05a4f', text: '#ffe6c7' } },
      { name: 'Fleet blue', colors: { frame: '#5b8fd6', button: '#a8c8f0', panel: '#7d7fd6', highlight: '#e8a33d', alert: '#d9534f', text: '#dfe9ff' } },
      { name: 'Red alert', colors: { frame: '#d6373a', button: '#ff8f7a', panel: '#b5524f', highlight: '#ffcc66', alert: '#ff2a2a', text: '#ffe0d6' } },
      { name: 'Gold', colors: { frame: '#e8b53d', button: '#ffe0a3', panel: '#c9a86b', highlight: '#f07f3c', alert: '#d9534f', text: '#fff1d6' } },
    ],
    sceneLabel: 'Space battle behind the Home screen',
  },
  fracture: {
    id: 'fracture',
    name: 'Reality Fracture',
    description:
      'The broken mirrors of the Reality Fracture set: sections hanging from a crack like glass pendants, panes with stepped corners, gems split gold and violet, card sleeves of broken glass with the DigiDice logo breaking through, and a mirror broken round the logo behind Home.',
    slots: [
      { key: 'mind', label: 'Mind', hint: 'Links, the focus ring and the pale light in the glass', default: '#4cb8ff' },
      { key: 'echo', label: 'Echo', hint: "The dark half: echoes, rims, chosen cards and the opponent's side of the table", default: '#a463ff' },
      { key: 'memory', label: 'Memory', hint: 'The light half: titles, the main actions, chosen items, highlights and your side of the table', default: '#ffc965' },
      { key: 'alert', label: 'Alert', hint: 'Danger buttons, warnings and errors', default: '#ff4d73' },
      { key: 'text', label: 'Text', hint: 'Body text', default: '#eef0ff' },
      { key: 'void', label: 'Void', hint: 'The darkness behind everything', default: '#0a0920' },
    ],
    presets: [
      { name: 'Echoverse', colors: { mind: '#4cb8ff', echo: '#a463ff', memory: '#ffc965', alert: '#ff4d73', text: '#eef0ff', void: '#0a0920' } },
      { name: 'Mirror image', colors: { mind: '#ff9f43', echo: '#ff4fa3', memory: '#62e6ff', alert: '#ff3b3b', text: '#fff1e3', void: '#170a12' } },
      { name: 'Shattered glass', colors: { mind: '#9fdcff', echo: '#8f9cff', memory: '#f3f6ff', alert: '#ff6680', text: '#f4f7ff', void: '#0b0e17' } },
      { name: 'Hexhaven', colors: { mind: '#35dcb0', echo: '#5a7cff', memory: '#f2c14e', alert: '#ff5d5d', text: '#e9fff7', void: '#06140f' } },
      { name: 'Theorist', colors: { mind: '#3d7bff', echo: '#ff3fae', memory: '#f2f4ff', alert: '#ff2e55', text: '#eef1ff', void: '#05061a' } },
    ],
    sceneLabel: 'The broken mirror behind every screen and round the logo on Home',
  },
};

export interface Look {
  template: TemplateId;
  /** The template's palette: one #rrggbb per slot key. */
  colors: Record<string, string>;
  /** Text size, 1 = the template's own (most text is in rem: html font-size). */
  textSize: number;
  /** Animated backgrounds (the grid's drift, the space battle); also off when the system asks for reduced motion. */
  motion: boolean;
  /** The template's background scene (TEMPLATES[].sceneLabel). */
  scene: boolean;
}

export interface UiProfile {
  id: string;
  name: string;
  look: Look;
  /** A template (read-only, not stored). */
  builtIn?: true;
}

export const TEXT_SIZES: readonly number[] = [0.9, 1, 1.1, 1.2, 1.3];
export const MAX_PROFILE_NAME = 32;
export const MAX_PROFILES = 40;
export const PROFILES_KEY = 'openmtg.profiles.v1';
/** The template a first visit starts with: the look the client was designed in. */
export const DEFAULT_TEMPLATE: TemplateId = 'neonGrid';

export function templateProfileId(id: TemplateId): string {
  return `template:${id}`;
}

export function templateLook(id: TemplateId): Look {
  const t = TEMPLATES[id];
  return { template: id, colors: Object.fromEntries(t.slots.map((s) => [s.key, s.default])), textSize: 1, motion: true, scene: true };
}

/** The templates as read-only profiles, in TEMPLATE_IDS order. */
export const TEMPLATE_PROFILES: readonly UiProfile[] = TEMPLATE_IDS.map((id) => ({ id: templateProfileId(id), name: TEMPLATES[id].name, look: templateLook(id), builtIn: true }));

const HEX = /^#[0-9a-f]{6}$/;

/** A color as #rrggbb (lower case), or null. #rgb is expanded. */
export function cleanHex(v: unknown): string | null {
  if (typeof v !== 'string') return null;
  const s = v.trim().toLowerCase();
  if (/^#[0-9a-f]{3}$/.test(s)) return `#${[...s.slice(1)].map((c) => c + c).join('')}`;
  return HEX.test(s) ? s : null;
}

/** Any value -> a valid look: an unknown template is Neon Grid, and each field that is missing or not understood takes the template's value. */
export function sanitizeLook(raw: unknown): Look {
  const r = raw && typeof raw === 'object' ? (raw as Record<string, unknown>) : {};
  const template = TEMPLATE_IDS.includes(r.template as TemplateId) ? (r.template as TemplateId) : DEFAULT_TEMPLATE;
  const base = templateLook(template);
  const colors = r.colors && typeof r.colors === 'object' ? (r.colors as Record<string, unknown>) : {};
  const size = typeof r.textSize === 'number' && Number.isFinite(r.textSize) ? r.textSize : base.textSize;
  return {
    template,
    colors: Object.fromEntries(TEMPLATES[template].slots.map((s) => [s.key, cleanHex(colors[s.key]) ?? s.default])),
    // The nearest offered size.
    textSize: TEXT_SIZES.reduce((best, x) => (Math.abs(x - size) < Math.abs(best - size) ? x : best)),
    motion: r.motion !== false,
    scene: r.scene !== false,
  };
}

export function cleanProfileName(v: unknown, fallback: string): string {
  if (typeof v !== 'string') return fallback;
  const name = v.replace(/\s+/g, ' ').trim().slice(0, MAX_PROFILE_NAME);
  return name === '' ? fallback : name;
}

export interface ProfilesState {
  /** The profile in use: a template's id or a saved profile's. */
  activeId: string;
  /** The player's own profiles, in the order they were made. */
  profiles: UiProfile[];
}

const ID = /^p-[0-9a-z]{4,24}$/;

export function sanitizeProfiles(raw: unknown): ProfilesState {
  const r = raw && typeof raw === 'object' ? (raw as Record<string, unknown>) : {};
  const list = Array.isArray(r.profiles) ? r.profiles : [];
  const seen = new Set<string>();
  const profiles: UiProfile[] = [];
  for (const p of list) {
    if (!p || typeof p !== 'object' || profiles.length >= MAX_PROFILES) continue;
    const q = p as Record<string, unknown>;
    if (typeof q.id !== 'string' || !ID.test(q.id) || seen.has(q.id)) continue;
    seen.add(q.id);
    const look = sanitizeLook(q.look);
    profiles.push({ id: q.id, name: cleanProfileName(q.name, TEMPLATES[look.template].name), look });
  }
  const known = [...TEMPLATE_PROFILES, ...profiles].some((p) => p.id === r.activeId);
  return { activeId: known ? (r.activeId as string) : templateProfileId(DEFAULT_TEMPLATE), profiles };
}

/** A fresh profile id. Not a rules decision, so Math.random is fine (the engine never sees it). */
export function newProfileId(): string {
  return `p-${Date.now().toString(36)}${Math.floor(Math.random() * 36 ** 4).toString(36).padStart(4, '0')}`;
}

/** `name`, or `name (2)`, `name (3)`, ... so that no two profiles (templates included) share a name. */
export function uniqueName(name: string, taken: readonly string[]): string {
  const lower = new Set(taken.map((t) => t.toLowerCase()));
  if (!lower.has(name.toLowerCase())) return name;
  for (let i = 2; ; i++) {
    const suffix = ` (${i})`;
    const candidate = name.slice(0, MAX_PROFILE_NAME - suffix.length) + suffix;
    if (!lower.has(candidate.toLowerCase())) return candidate;
  }
}

/** The file a profile is exported as (and imported from): its name and look, nothing else. */
export interface ProfileFile {
  openmtgProfile: 1;
  name: string;
  look: Look;
}

export function profileFile(p: UiProfile): ProfileFile {
  return { openmtgProfile: 1, name: p.name, look: structuredClone(p.look) };
}

/** Parses an exported profile; null when the text is not one. */
export function parseProfileFile(text: string): { name: string; look: Look } | null {
  try {
    const raw = JSON.parse(text) as Record<string, unknown>;
    if (!raw || typeof raw !== 'object' || raw.openmtgProfile !== 1) return null;
    const look = sanitizeLook(raw.look);
    return { name: cleanProfileName(raw.name, TEMPLATES[look.template].name), look };
  } catch {
    return null;
  }
}

/** The browser's localStorage, or null when it cannot be reached (private mode, sandboxing, no DOM). */
function browserStorage(): Storage | null {
  try {
    return typeof window !== 'undefined' && window.localStorage ? window.localStorage : null;
  } catch {
    return null;
  }
}

export function loadProfiles(storage: Storage | null = browserStorage()): ProfilesState {
  try {
    const text = storage?.getItem(PROFILES_KEY);
    return sanitizeProfiles(text ? JSON.parse(text) : null);
  } catch {
    return sanitizeProfiles(null);
  }
}

/** Returns false when the profiles could not be stored (they still apply until the page is closed). */
export function saveProfiles(s: ProfilesState, storage: Storage | null = browserStorage()): boolean {
  try {
    if (!storage) return false;
    storage.setItem(PROFILES_KEY, JSON.stringify({ activeId: s.activeId, profiles: s.profiles.map(({ id, name, look }) => ({ id, name, look })) }));
    return true;
  } catch {
    return false;
  }
}

/**
 * The profiles of this page (useSyncExternalStore-shaped like SettingsStore). Every change is applied and stored at once. Templates cannot be changed: a
 * player customizes a profile of their own (`create` copies a look under a new name).
 */
export class ProfilesStore {
  private current: ProfilesState;
  private readonly listeners = new Set<() => void>();
  /** False after a write failed. */
  persisted = true;

  constructor(private readonly storage: Storage | null = browserStorage()) {
    this.current = loadProfiles(storage);
  }

  readonly get = (): ProfilesState => this.current;

  readonly subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };

  /** Templates first, then the player's profiles. */
  all(): UiProfile[] {
    return [...TEMPLATE_PROFILES, ...this.current.profiles];
  }

  find(id: string): UiProfile | undefined {
    return this.all().find((p) => p.id === id);
  }

  /** The profile in use. */
  active(): UiProfile {
    return this.find(this.current.activeId) ?? TEMPLATE_PROFILES[0]!;
  }

  private commit(next: ProfilesState): void {
    this.current = sanitizeProfiles(next);
    this.persisted = saveProfiles(this.current, this.storage);
    for (const l of [...this.listeners]) l();
  }

  /** Load a profile (or a template): the interface takes its look at once. */
  readonly select = (id: string): void => {
    if (id !== this.current.activeId && this.find(id)) this.commit({ ...this.current, activeId: id });
  };

  /** Save a look as a new profile and load it. Returns its id, or null when there are already MAX_PROFILES. */
  readonly create = (name: string, look: Look): string | null => {
    if (this.current.profiles.length >= MAX_PROFILES) return null;
    const clean = sanitizeLook(look);
    const id = newProfileId();
    const unique = uniqueName(cleanProfileName(name, TEMPLATES[clean.template].name), this.all().map((p) => p.name));
    this.commit({ activeId: id, profiles: [...this.current.profiles, { id, name: unique, look: clean }] });
    return id;
  };

  readonly rename = (id: string, name: string): void => {
    const p = this.current.profiles.find((x) => x.id === id);
    if (!p) return;
    const others = this.all().filter((x) => x.id !== id).map((x) => x.name);
    const unique = uniqueName(cleanProfileName(name, p.name), others);
    if (unique === p.name) return;
    this.commit({ ...this.current, profiles: this.current.profiles.map((x) => (x.id === id ? { ...x, name: unique } : x)) });
  };

  /** Change a saved profile's look (templates cannot change). Changing the template resets the colors to the new template's palette. */
  readonly updateLook = (id: string, change: Partial<Look>): void => {
    const p = this.current.profiles.find((x) => x.id === id);
    if (!p) return;
    const switched = change.template !== undefined && change.template !== p.look.template;
    const look = { ...p.look, ...change, colors: change.colors ?? (switched ? templateLook(change.template!).colors : p.look.colors) };
    this.commit({ ...this.current, profiles: this.current.profiles.map((x) => (x.id === id ? { ...x, look: sanitizeLook(look) } : x)) });
  };

  /** Delete a saved profile; when it was in use, its template takes over. */
  readonly remove = (id: string): void => {
    const p = this.current.profiles.find((x) => x.id === id);
    if (!p) return;
    const activeId = this.current.activeId === id ? templateProfileId(p.look.template) : this.current.activeId;
    this.commit({ activeId, profiles: this.current.profiles.filter((x) => x.id !== id) });
  };

  /** Import an exported profile as a new profile and load it. Returns its id, or null when the text is not a profile or there is no room. */
  readonly importText = (text: string): string | null => {
    const parsed = parseProfileFile(text);
    return parsed ? this.create(parsed.name, parsed.look) : null;
  };
}

let shared: ProfilesStore | null = null;
/** The page-wide store (created on first use, so tests can replace localStorage before it is read). */
export function profilesStore(): ProfilesStore {
  shared ??= new ProfilesStore();
  return shared;
}

/** Tests only: forget the page-wide store so the next `profilesStore()` reads storage again. */
export function resetProfilesStoreForTests(store: ProfilesStore | null = null): void {
  shared = store;
}

/** Black or white, whichever reads better on `hex`. */
export function inkOn(hex: string): string {
  return contrastRatio(hex, '#000000') >= contrastRatio(hex, '#ffffff') ? '#000000' : '#ffffff';
}

/**
 * The CSS variables of a look. Neon Grid's colors replace the brand blue and magenta its stylesheets are drawn with (the `-rgb` channel variables carry
 * every translucent glow); LCARS has its own palette (`--lc-*`, theme/lcars.css) and so has Reality Fracture (`--rf-*`, theme/fracture.css), and both
 * also lend theirs to the grid variables, so a rule their sheet does not restyle still takes the profile's colors.
 */
export function lookVars(look: Look): Record<string, string> {
  const c = look.colors;
  if (look.template === 'fracture') {
    return {
      '--rf-mind': c.mind!,
      '--rf-echo': c.echo!,
      '--rf-memory': c.memory!,
      '--rf-alert': c.alert!,
      '--rf-text': c.text!,
      '--rf-void': c.void!,
      '--rf-mind-ink': inkOn(c.mind!),
      '--rf-echo-ink': inkOn(c.echo!),
      '--rf-memory-ink': inkOn(c.memory!),
      '--rf-alert-ink': inkOn(c.alert!),
      '--neon-rgb': rgbChannels(c.memory!),
      '--neon-2-rgb': rgbChannels(c.echo!),
      '--brand-blue': c.memory!,
      '--brand-blue-deep': c.memory!,
      '--brand-magenta': c.echo!,
      '--accent': c.memory!,
      '--accent-text': inkOn(c.memory!),
      '--accent-2': c.echo!,
      '--focus': c.mind!,
      '--text': c.text!,
      '--text-muted': `rgba(${rgbChannels(c.text!)}, 0.74)`,
      '--surface': `rgba(${rgbChannels(c.text!)}, 0.06)`,
      '--surface-strong': `rgba(${rgbChannels(c.text!)}, 0.12)`,
      '--table-bg': c.void!,
      '--border': `rgba(${rgbChannels(c.echo!)}, 0.4)`,
    };
  }
  if (look.template === 'lcars') {
    return {
      '--lc-frame': c.frame!,
      '--lc-button': c.button!,
      '--lc-panel': c.panel!,
      '--lc-highlight': c.highlight!,
      '--lc-alert': c.alert!,
      '--lc-text': c.text!,
      '--lc-frame-ink': inkOn(c.frame!),
      '--lc-button-ink': inkOn(c.button!),
      '--lc-panel-ink': inkOn(c.panel!),
      '--lc-highlight-ink': inkOn(c.highlight!),
      '--lc-alert-ink': inkOn(c.alert!),
      '--neon-rgb': rgbChannels(c.highlight!),
      '--neon-2-rgb': rgbChannels(c.frame!),
      '--brand-blue': c.highlight!,
      '--brand-blue-deep': c.highlight!,
      '--brand-magenta': c.frame!,
      '--accent': c.button!,
      '--accent-text': inkOn(c.button!),
      '--accent-2': c.panel!,
      '--focus': c.highlight!,
      '--text': c.text!,
      '--text-muted': `rgba(${rgbChannels(c.text!)}, 0.74)`,
      '--surface': `rgba(${rgbChannels(c.text!)}, 0.06)`,
      '--surface-strong': `rgba(${rgbChannels(c.text!)}, 0.12)`,
      '--table-bg': '#000000',
      '--border': `rgba(${rgbChannels(c.panel!)}, 0.55)`,
    };
  }
  return {
    '--neon-rgb': rgbChannels(c.neon!),
    '--neon-2-rgb': rgbChannels(c.neon2!),
    '--brand-blue': c.neon!,
    '--brand-magenta': c.neon2!,
    '--accent': c.neon!,
    '--accent-text': inkOn(c.neon!),
    '--accent-2': c.neon2!,
    '--focus': c.neon2!,
    '--border': `rgba(${rgbChannels(c.neon!)}, 0.35)`,
  };
}

/** Whether a look's colors are its template's own (the stylesheets then draw exactly the template). */
export function isTemplatePalette(look: Look): boolean {
  return TEMPLATES[look.template].slots.every((s) => look.colors[s.key] === s.default);
}

/** Every variable a look may set, so switching templates removes the other template's. */
const ALL_VARS = [...new Set(TEMPLATE_IDS.flatMap((id) => Object.keys(lookVars(templateLook(id)))))];

/** The root's `data-ui` for each template: the attribute its stylesheet's rules are scoped to. */
export const UI_ATTRIBUTE: Readonly<Record<TemplateId, string>> = { neonGrid: 'grid', lcars: 'lcars', fracture: 'fracture' };

/**
 * Apply a look to an element (the document root in main.tsx): `data-ui` picks the template's stylesheet rules, `data-motion` and `data-scene` its
 * background, `data-tint` marks a palette of the player's own (Neon Grid then recolors the few gradients drawn in fixed shades), and the variables carry
 * the colors. The grid variables are reset to the brand's when a look does not set them, so theme.ts stays the source of the default.
 */
export function applyLook(el: HTMLElement, look: Look, base: Record<string, string> = {}): void {
  const vars = lookVars(look);
  el.dataset.ui = UI_ATTRIBUTE[look.template];
  el.dataset.motion = look.motion ? 'on' : 'off';
  el.dataset.scene = look.scene ? 'on' : 'off';
  if (isTemplatePalette(look)) delete el.dataset.tint;
  else el.dataset.tint = 'custom';
  for (const k of ALL_VARS) {
    const v = vars[k] ?? base[k];
    if (v === undefined) el.style.removeProperty(k);
    else el.style.setProperty(k, v);
  }
  if (look.textSize === 1) el.style.removeProperty('font-size');
  else el.style.setProperty('font-size', `${Math.round(look.textSize * 100)}%`);
}

/** Keeps an element in the look of the profile in use (main.tsx: the document root). Returns the unsubscribe. */
export function connectProfiles(el: HTMLElement, store: ProfilesStore = profilesStore(), base: Record<string, string> = {}): () => void {
  let last: Look | null = null;
  const sync = () => {
    const look = store.active().look;
    if (look === last) return;
    last = look;
    applyLook(el, look, base);
  };
  sync();
  return store.subscribe(sync);
}
