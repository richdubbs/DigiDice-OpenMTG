import type { Step } from '@openmtg/engine';

/** Step names as CR 500.1 calls them (the main phases are steps in the engine's model). */
export const STEP_LABELS: Record<Step, string> = {
  untap: 'Untap',
  upkeep: 'Upkeep',
  draw: 'Draw',
  main1: 'Precombat main',
  beginCombat: 'Beginning of combat',
  declareAttackers: 'Declare attackers',
  declareBlockers: 'Declare blockers',
  combatDamage: 'Combat damage',
  endCombat: 'End of combat',
  main2: 'Postcombat main',
  end: 'End step',
  cleanup: 'Cleanup',
};
