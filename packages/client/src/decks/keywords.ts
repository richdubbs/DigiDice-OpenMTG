/**
 * Keyword reminders for the card preview (Arena shows a box per keyword next to the card). The sentences are our own short wording of the rule named in
 * each entry (Comprehensive Rules, effective 2026-09-25), not card text; they are reading aids, not rules decisions.
 */
import type { CardSummary } from '@openmtg/server/api';

export interface KeywordReminder {
  keyword: string;
  text: string;
  /** The rule the sentence summarizes. */
  rule: string;
}

const TABLE: readonly KeywordReminder[] = [
  { keyword: 'Flying', text: "A creature with flying can't be blocked except by creatures with flying or reach.", rule: 'CR 702.9' },
  { keyword: 'Reach', text: 'A creature with reach can block creatures with flying.', rule: 'CR 702.17' },
  { keyword: 'First strike', text: 'This creature deals combat damage before creatures without first strike.', rule: 'CR 702.7' },
  { keyword: 'Double strike', text: 'This creature deals combat damage twice: once with the first strikers and once with everything else.', rule: 'CR 702.4' },
  { keyword: 'Deathtouch', text: 'Any amount of damage this deals to a creature is enough to destroy it.', rule: 'CR 702.2' },
  { keyword: 'Lifelink', text: 'Damage dealt by this also makes its controller gain that much life.', rule: 'CR 702.15' },
  { keyword: 'Haste', text: 'This can attack and use {T} abilities as soon as it comes under your control.', rule: 'CR 702.10' },
  { keyword: 'Vigilance', text: "Attacking doesn't cause this creature to tap.", rule: 'CR 702.20' },
  { keyword: 'Trample', text: 'If this is blocked, it can assign damage beyond what is lethal to its blockers to the player or planeswalker it attacks.', rule: 'CR 702.19' },
  { keyword: 'Menace', text: "This creature can't be blocked except by two or more creatures.", rule: 'CR 702.111' },
  { keyword: 'Hexproof', text: "This can't be the target of spells or abilities your opponents control.", rule: 'CR 702.11' },
  { keyword: 'Shroud', text: "This can't be the target of any spells or abilities.", rule: 'CR 702.18' },
  { keyword: 'Indestructible', text: "Damage and \"destroy\" effects can't destroy this permanent.", rule: 'CR 702.12' },
  { keyword: 'Flash', text: 'You may cast this any time you could cast an instant.', rule: 'CR 702.8' },
  { keyword: 'Defender', text: "This creature can't attack.", rule: 'CR 702.3' },
  { keyword: 'Ward', text: 'When this becomes the target of a spell or ability an opponent controls, counter it unless that player pays the ward cost.', rule: 'CR 702.21' },
  { keyword: 'Protection', text: "Damage, enchanting or equipping, blocking, and targeting by anything with the stated quality are all prevented.", rule: 'CR 702.16' },
  { keyword: 'Prowess', text: 'Whenever you cast a noncreature spell, this creature gets +1/+1 until end of turn.', rule: 'CR 702.108' },
  { keyword: 'Kicker', text: 'You may pay an extra cost as you cast this spell for a bigger effect.', rule: 'CR 702.33' },
  { keyword: 'Flashback', text: 'You may cast this from your graveyard by paying its flashback cost; it is exiled afterwards.', rule: 'CR 702.34' },
  { keyword: 'Equip', text: 'Pay the equip cost, at sorcery speed, to attach this to a creature you control.', rule: 'CR 702.6' },
  { keyword: 'Cycling', text: 'Pay the cycling cost and discard this card to draw a card.', rule: 'CR 702.29' },
  { keyword: 'Cascade', text: 'When you cast this, exile cards from the top of your library until you find a cheaper nonland card, and cast it free.', rule: 'CR 702.85' },
  { keyword: 'Convoke', text: 'Your creatures can help pay for this spell: each one you tap pays for {1} or one mana of its color.', rule: 'CR 702.51' },
  { keyword: 'Undying', text: 'When this creature dies, if it had no +1/+1 counters, return it with a +1/+1 counter.', rule: 'CR 702.93' },
  { keyword: 'Persist', text: 'When this creature dies, if it had no -1/-1 counters, return it with a -1/-1 counter.', rule: 'CR 702.79' },
  { keyword: 'Infect', text: 'This deals damage to creatures as -1/-1 counters and to players as poison counters.', rule: 'CR 702.90' },
  { keyword: 'Toxic', text: 'A player dealt combat damage by this creature also gets that many poison counters.', rule: 'CR 702.164' },
  { keyword: 'Scry', text: 'Look at the top cards of your library; put any number on the bottom and the rest back in any order.', rule: 'CR 701.22' },
  { keyword: 'Surveil', text: 'Look at the top cards of your library; put any number into your graveyard and the rest back in any order.', rule: 'CR 701.25' },
  { keyword: 'Fight', text: 'Each of the two creatures deals damage equal to its power to the other.', rule: 'CR 701.14' },
  { keyword: 'Mill', text: 'Put the top cards of a library into its owner’s graveyard.', rule: 'CR 701.17' },
  { keyword: 'Proliferate', text: 'Choose any permanents and players with counters, then give each one more counter of a kind it already has.', rule: 'CR 701.34' },
  { keyword: 'Exalted', text: 'Whenever a creature you control attacks alone, it gets +1/+1 until end of turn.', rule: 'CR 702.83' },
  { keyword: 'Storm', text: 'When you cast this, copy it for each spell cast before it this turn.', rule: 'CR 702.40' },
  { keyword: 'Evolve', text: 'Whenever a bigger creature enters under your control, put a +1/+1 counter on this.', rule: 'CR 702.100' },
];

/** Text without its reminder text (the parenthesized sentences), which would otherwise mention keywords that are not on the card. */
const withoutReminders = (text: string) => text.replace(/\([^)]*\)/g, ' ');

/** The keywords a card has or grants, found in its rules text (every face) and type line, in the order of the table. */
export function keywordReminders(card: CardSummary): KeywordReminder[] {
  const text = withoutReminders(card.faces.map((f) => f.oracleText).join('\n'));
  return TABLE.filter((k) => new RegExp(`(^|[^\\w])${k.keyword.replace(/ /g, '\\s+')}(?![\\w])`, 'i').test(text));
}
