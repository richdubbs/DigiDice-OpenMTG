/**
 * Test environment of the chart parser and the hole grammars (WP6): a small lexicon with the vocabulary the tests use (the generated lexicon of WP5 is
 * empty in this work package's branch), a keyword list shaped like `ParseOptions.keywords`, and helpers that run one hole over a phrase.
 */
import type { Alt, HoleEnv, Tok } from '../../../src/parser/holes';
import { canonicalJson, lex, runHole } from '../../../src/parser/holes';
import type { HoleType, Lexicon, ParseOptions } from '../../../src/parser/types';

const sub = (singular: string, cls: Lexicon['subtypes'][number]['class'] = 'creature', plural?: string): Lexicon['subtypes'][number] => ({ singular, plural: plural ?? `${singular}s`, class: cls });

export const LEXICON: Lexicon = {
  crEdition: 'test',
  cardTypes: [],
  supertypes: [],
  subtypes: [
    sub('Goblin'), sub('Elf', 'creature', 'Elves'), sub('Human'), sub('Zombie'), sub('Soldier'), sub('Spirit'), sub('Beast'), sub('Dragon'), sub('Bird'), sub('Elemental'),
    sub('Eldrazi', 'creature', 'Eldrazi'), sub('Scion'), sub('Knight'), sub('Wizard'), sub('Angel'), sub('Warrior'), sub('Cat'), sub('Wolf', 'creature', 'Wolves'),
    sub('Vampire'), sub('Merfolk', 'creature', 'Merfolk'),
    sub('Forest', 'land'), sub('Island', 'land'), sub('Swamp', 'land'), sub('Mountain', 'land'), sub('Plains', 'land', 'Plains'),
    sub('Aura', 'enchantment'), sub('Equipment', 'artifact', 'Equipment'), sub('Vehicle', 'artifact'), sub('Saga', 'enchantment'), sub('Treasure', 'artifact'),
  ],
  colors: [],
  keywordAbilities: [],
  keywordActions: [],
  counterKinds: ['charge', 'loyalty', 'lore', 'time', 'poison', 'oil', 'quest', 'storage', 'spore', 'fade', 'stun', 'shield'],
  predefinedTokens: [{ name: 'Treasure', rule: '111.10a' }, { name: 'Food', rule: '111.10b' }, { name: 'Clue', rule: '111.10f' }],
  abilityWords: [],
};

export const KEYWORDS: ParseOptions['keywords'] = [
  { name: 'flying', aliases: [], params: [], reminder: '' },
  { name: 'reach', aliases: [], params: [], reminder: '' },
  { name: 'haste', aliases: [], params: [], reminder: '' },
  { name: 'vigilance', aliases: [], params: [], reminder: '' },
  { name: 'trample', aliases: [], params: [], reminder: '' },
  { name: 'deathtouch', aliases: [], params: [], reminder: '' },
  { name: 'lifelink', aliases: [], params: [], reminder: '' },
  { name: 'first strike', aliases: [], params: [], reminder: '' },
  { name: 'double strike', aliases: [], params: [], reminder: '' },
  { name: 'menace', aliases: [], params: [], reminder: '' },
  { name: 'defender', aliases: [], params: [], reminder: '' },
  { name: 'indestructible', aliases: [], params: [], reminder: '' },
  { name: 'hexproof', aliases: [], params: ['quality'], reminder: '' },
  { name: 'protection', aliases: [], params: ['quality'], reminder: '' },
  { name: 'ward', aliases: [], params: ['cost'], reminder: '' },
  { name: 'kicker', aliases: [], params: ['cost'], reminder: '' },
  { name: 'equip', aliases: [], params: ['cost'], reminder: '' },
  { name: 'toxic', aliases: [], params: ['amount'], reminder: '' },
  { name: 'crew', aliases: [], params: ['amount'], reminder: '' },
  { name: 'suspend', aliases: [], params: ['amount', 'cost'], reminder: '' },
  { name: 'enchant', aliases: [], params: ['filter'], reminder: '' },
  { name: 'affinity', aliases: [], params: ['filter'], reminder: '' },
];

export const ENV: HoleEnv = { lexicon: LEXICON, keywords: KEYWORDS };

export const toks = (text: string): Tok[] => lex(text);

/** Alternatives of `type` that consume the WHOLE phrase. */
export function full(type: HoleType, text: string, env: HoleEnv = ENV): Alt[] {
  const t = toks(text);
  return runHole(type, t, 0, env).filter((a) => a.end === t.length);
}

/** The single complete value (throws a readable error when there is none or several with different JSON). */
export function one(type: HoleType, text: string, env: HoleEnv = ENV): unknown {
  const alts = full(type, text, env);
  const vals = new Map(alts.map((a) => [canonicalJson(a.value), a.value]));
  if (vals.size !== 1) throw new Error(`${type} "${text}": ${vals.size} readings\n${[...vals.keys()].join('\n')}`);
  return [...vals.values()][0];
}

/** Does the hole have no complete parse of the phrase? */
export const rejects = (type: HoleType, text: string, env: HoleEnv = ENV): boolean => full(type, text, env).length === 0;

/** A target marker as the tests expect it. */
export const target = (spec: Record<string, unknown>): unknown => ({ ref: 'target', id: '', $target: spec });
