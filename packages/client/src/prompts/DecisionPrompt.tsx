/** One component per decision kind (docs/design/m8-client.md screen 7); the `Record` makes the table exhaustive, so a new engine decision kind must be added here. */
import type { ComponentType } from 'react';
import type { DecisionKind } from '@openmtg/engine';
import { ChooseNumberPrompt, ChooseObjectsPrompt, ChooseOptionPrompt, ChooseTargetsPrompt, OrderPrompt } from './ChoicePrompts';
import { ChooseNamePrompt } from './ChooseNamePrompt';
import { CommanderZonePrompt } from './CommanderPrompts';
import { DeclareAttackersPrompt, DeclareBlockersPrompt } from './CombatPrompts';
import { AssignDamagePrompt, ChooseDivisionPrompt } from './DamagePrompts';
import { ManualResolvePrompt } from './ManualResolvePrompt';
import { PayCostPrompt } from './PayCostPrompt';
import { PriorityPrompt } from './PriorityPrompt';
import { ChooseColorPrompt, ChooseReplacementPrompt, MulliganPrompt, PlayFirstPrompt, YesNoPrompt } from './SimplePrompts';
import type { PromptProps } from './types';

export const PROMPTS: { [K in DecisionKind]: ComponentType<PromptProps<K>> } = {
  priority: PriorityPrompt,
  playFirst: PlayFirstPrompt,
  mulligan: MulliganPrompt,
  chooseObjects: ChooseObjectsPrompt,
  yesNo: YesNoPrompt,
  chooseOption: ChooseOptionPrompt,
  chooseNumber: ChooseNumberPrompt,
  chooseColor: ChooseColorPrompt,
  order: OrderPrompt,
  chooseTargets: ChooseTargetsPrompt,
  payCost: PayCostPrompt,
  declareAttackers: DeclareAttackersPrompt,
  declareBlockers: DeclareBlockersPrompt,
  assignDamage: AssignDamagePrompt,
  chooseReplacement: ChooseReplacementPrompt,
  manualResolve: ManualResolvePrompt,
  chooseDivision: ChooseDivisionPrompt,
  chooseName: ChooseNamePrompt,
  commanderZone: CommanderZonePrompt, // M11-0: CR 903.9a-b
};

/** The prompt for `props.d`; keyed by the decision id, so every new decision starts with fresh local state. */
export function DecisionPrompt(props: PromptProps) {
  const C = PROMPTS[props.d.kind] as ComponentType<PromptProps>;
  return <C key={props.d.id} {...props} />;
}
