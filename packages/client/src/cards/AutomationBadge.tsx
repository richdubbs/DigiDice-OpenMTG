/**
 * The automation level of a card (design 10: full, partial, manual), shown next to the card and never on its image (ARCHITECTURE.md "Card images":
 * badges are drawn outside the image bounds).
 */
import type { AutomationLevel } from '@openmtg/engine';

export const AUTOMATION_TEXT: Record<AutomationLevel, { short: string; long: string }> = {
  full: { short: 'Full', long: 'Fully automated: the engine runs all of its rules text.' },
  partial: { short: 'Partial', long: 'Partly automated: some of its text is resolved by hand (painted on the card).' },
  manual: { short: 'Manual', long: 'Manual: the players resolve its rules text by hand.' },
};

export function AutomationBadge({ level }: { level: AutomationLevel }) {
  const t = AUTOMATION_TEXT[level];
  return (
    <span className={`automation-badge automation-${level}`} role="img" aria-label={`Automation: ${level}`} title={t.long} data-level={level}>
      {t.short}
    </span>
  );
}
