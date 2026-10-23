/**
 * Commander deck construction: who can be a commander (CR 903.3, 903.3a; Brawl 903.12c), two commanders with a partner ability (CR 702.124), and the
 * color identity rule (CR 903.5c, 903.5d; Brawl's colorless-commander option 903.12e). Pure: reads Oracle data only.
 */
import type { OracleCard } from '@openmtg/engine';
import { basicLandTypes, colorIdentity, frontFace, frontLines, isBasicLand, isCreatureOutsideBattlefield, typeWords } from './card-rules';
import type { CommanderStyle, DeckEntry, DeckPart, FormatProblem } from './types';

/** A partner ability (CR 702.124a): each kind pairs only with its own kind (702.124f). */
export type PartnerAbility =
  | { kind: 'partner' }
  | { kind: 'partner-text'; text: string }
  | { kind: 'partner-with'; name: string }
  | { kind: 'background' }
  | { kind: 'doctors-companion' };

/** The partner abilities on the card's front face (a card may have more than one, CR 702.124g). */
export function partnerAbilities(card: OracleCard): PartnerAbility[] {
  const out: PartnerAbility[] = [];
  for (const line of frontLines(card)) {
    let m: RegExpExecArray | null;
    if (/^Partner$/i.test(line)) out.push({ kind: 'partner' });
    else if ((m = /^Partner\s*[—-]\s*(.+)$/.exec(line))) out.push({ kind: 'partner-text', text: m[1]!.trim().toLowerCase() });
    else if ((m = /^Partner with (.+)$/.exec(line))) out.push({ kind: 'partner-with', name: m[1]!.trim() });
    else if (/^Choose a Background$/i.test(line)) out.push({ kind: 'background' });
    else if (/^Doctor['’]s companion$/i.test(line)) out.push({ kind: 'doctors-companion' });
  }
  return out;
}

const isLegendary = (card: OracleCard) => typeWords(card).types.includes('Legendary');

/** A legendary Background enchantment card (CR 702.124k). */
export function isBackground(card: OracleCard): boolean {
  const { types, subtypes } = typeWords(card);
  return types.includes('Legendary') && types.includes('Enchantment') && subtypes.includes('Background');
}

/** A legendary Time Lord Doctor creature card with no other creature types (CR 702.124m). */
function isPlainDoctor(card: OracleCard): boolean {
  const { types, subtypes } = typeWords(card);
  return types.includes('Legendary') && types.includes('Creature') && subtypes.includes('Doctor') && subtypes.every((s) => s === 'Time' || s === 'Lord' || s === 'Doctor');
}

/**
 * CMDF, CR 903.3a, 113.6n: the front face has the ability "[this card] can be your commander" (a line of its own, outside reminder text, whose subject is the
 * card's name, its short name before the comma, or "this card"), or the keyword "Spell commander" whose reminder says so. Reminder text that mentions some
 * other card being your commander ("It becomes legendary and can be your commander", a Background's) does not count (CR 207.2: no rules meaning).
 */
export function canBeYourCommanderAbility(card: OracleCard): boolean {
  const name = (frontFace(card).name ?? card.name).toLowerCase();
  const names = new Set([name, name.split(',')[0]!.trim(), '~', 'this card']);
  return frontLines(card).some((line) => {
    if (/^Spell commander$/i.test(line)) return true;
    const m = /^(.+?) can be your commander\./i.exec(line);
    return m !== null && names.has(m[1]!.trim().toLowerCase());
  });
}

/**
 * Can this card be a commander on its own (CR 903.3: a legendary creature, Vehicle, or Spacecraft with a power/toughness box; 903.3a: "can be your
 * commander"; Brawl 903.12c adds legendary planeswalkers)? A Background is a commander only beside a "choose a Background" card (702.124k).
 * A legendary card that is a creature card outside the battlefield by its own static ability counts as a creature card (CR 903.3 with 113.6c: Grist).
 */
export function canBeCommander(card: OracleCard, style: CommanderStyle): boolean {
  const face = frontFace(card);
  if (canBeYourCommanderAbility(card)) return true;
  if (!isLegendary(card)) return false;
  const { types, subtypes } = typeWords(card);
  if (types.includes('Creature') || subtypes.includes('Vehicle') || isCreatureOutsideBattlefield(card)) return true;
  if (subtypes.includes('Spacecraft') && (face.power ?? card.power) !== undefined) return true;
  return style === 'brawl' && types.includes('Planeswalker');
}

/** Do these two cards make a legal pair of commanders (CR 702.124h-702.124m; different partner abilities never combine, 702.124f)? */
export function canPartner(a: OracleCard, b: OracleCard): boolean {
  const pa = partnerAbilities(a);
  const pb = partnerAbilities(b);
  const has = (list: PartnerAbility[], kind: PartnerAbility['kind']) => list.some((p) => p.kind === kind);
  if (has(pa, 'partner') && has(pb, 'partner')) return true; // 702.124h
  for (const p of pa) {
    if (p.kind === 'partner-text' && pb.some((q) => q.kind === 'partner-text' && q.text === p.text)) return true; // 702.124i
    if (p.kind === 'partner-with' && p.name === b.name && pb.some((q) => q.kind === 'partner-with' && q.name === a.name)) return true; // 702.124j
  }
  if ((has(pa, 'background') && isBackground(b)) || (has(pb, 'background') && isBackground(a))) return true; // 702.124k
  if ((has(pa, 'doctors-companion') && isPlainDoctor(b)) || (has(pb, 'doctors-companion') && isPlainDoctor(a))) return true; // 702.124m
  return false;
}

/** The commander cards one by one (an entry "2 X" is two commanders). */
export function commanderCards(entries: readonly DeckEntry[]): OracleCard[] {
  return entries.flatMap((e) => Array.from({ length: e.count }, () => e.card));
}

/** Problems with the commander designation: none, more than two, a card that cannot be a commander, two that cannot partner. */
export function checkCommanders(cards: readonly OracleCard[], style: CommanderStyle): FormatProblem[] {
  const out: FormatProblem[] = [];
  const section: DeckPart = 'commander';
  if (cards.length === 0) {
    out.push({ severity: 'error', code: 'no-commander', rule: 'CR 903.3', message: 'No commander: list it under a "Commander" heading.', section });
    return out;
  }
  if (cards.length > 2) {
    out.push({ severity: 'error', code: 'too-many-commanders', rule: 'CR 702.124g', message: `${cards.length} commanders: a deck has one, or two with a partner ability.`, section, count: cards.length, limit: 2 });
    return out;
  }
  const [a, b] = cards as [OracleCard, OracleCard | undefined];
  const pairedBackground = (c: OracleCard, other: OracleCard | undefined) => isBackground(c) && other !== undefined && partnerAbilities(other).some((p) => p.kind === 'background');
  for (const [c, other] of [[a, b], [b, a]] as Array<[OracleCard | undefined, OracleCard | undefined]>) {
    if (!c || canBeCommander(c, style) || pairedBackground(c, other)) continue;
    const what = style === 'brawl' ? 'a legendary creature, planeswalker, Vehicle or Spacecraft (CR 903.12c)' : 'a legendary creature, Vehicle or Spacecraft';
    out.push({ severity: 'error', code: 'not-a-commander', rule: style === 'brawl' ? 'CR 903.12c' : 'CR 903.3', message: `${c.name} can't be a commander: it is not ${what}.`, card: c.name, section });
  }
  if (b && !canPartner(a, b)) {
    out.push({ severity: 'error', code: 'invalid-partners', rule: 'CR 702.124f', message: `${a.name} and ${b.name} can't be commanders together: they don't share a partner ability.`, card: b.name, section });
  }
  return out;
}

/** The commanders' combined color identity (CR 702.124c), or undefined when one of them has no color identity data. */
export function commanderIdentity(cards: readonly OracleCard[]): Set<string> | undefined {
  const ids = new Set<string>();
  for (const c of cards) {
    const id = colorIdentity(c);
    if (!id) return undefined;
    id.forEach((x) => ids.add(x));
  }
  return ids;
}

/**
 * CR 903.5c (and 903.5d, which Scryfall's color identity of a land with basic land types already covers): every card's color identity within the
 * commander's. Brawl with a colorless commander (CR 903.12e): basic lands of one basic land type are allowed anyway.
 */
export function checkColorIdentity(identity: Set<string>, entries: ReadonlyArray<{ entry: DeckEntry; section: DeckPart }>, style: CommanderStyle): FormatProblem[] {
  const out: FormatProblem[] = [];
  const colors = identity.size ? [...identity].join('') : 'colorless';
  const offBasics: Array<{ entry: DeckEntry; section: DeckPart; types: string[] }> = [];
  for (const { entry, section } of entries) {
    const id = colorIdentity(entry.card);
    if (!id) {
      out.push({ severity: 'warning', code: 'no-color-identity', rule: 'CR 903.4', message: `${entry.card.name}: no color identity in the card data; not checked.`, card: entry.card.name, section });
      continue;
    }
    const outside = id.filter((c) => !identity.has(c));
    if (!outside.length) continue;
    if (style === 'brawl' && identity.size === 0 && isBasicLand(entry.card)) {
      offBasics.push({ entry, section, types: basicLandTypes(entry.card) });
      continue;
    }
    out.push({ severity: 'error', code: 'color-identity', rule: 'CR 903.5c', message: `${entry.card.name} (${id.join('')}) is outside the commander's color identity (${colors}).`, card: entry.card.name, section });
  }
  const kinds = [...new Set(offBasics.flatMap((b) => b.types))];
  if (kinds.length > 1) {
    for (const b of offBasics.filter((x) => !x.types.includes(kinds[0]!))) {
      out.push({ severity: 'error', code: 'color-identity', rule: 'CR 903.12e', message: `${b.entry.card.name}: with a colorless commander the deck may have basic lands of one basic land type only (${kinds.join(', ')} found).`, card: b.entry.card.name, section: b.section });
    }
  }
  return out;
}
