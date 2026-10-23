/**
 * The milestone 6 registries (m6 design 2.6) by name, for the shared-state guard (test/shared-state-guard.ts) and the M6-0 skeleton tests. A test that adds
 * a test part to one of them must take it out again (`withEntries`, test/m6/helpers.ts): in the fast default suite the test files of a worker share modules.
 */
import { CAST_OPTION_PROVIDERS } from '../../src/actions/cast-options';
import { LAYOUT_SUPPORT } from '../../src/cards/layout-support';
import { MOVE_PARTS, RESOLVE_PERMANENT_PARTS, SPECIAL_ACTION_HANDLERS, TURN_BASED, VIEW_PARTS } from '../../src/core/registries';
import { CHANGE_FACE } from '../../src/effects/handlers/change-face';
import { BODY_KINDS, DESTINATION_PARTS, ENTERS_PARTS, IMMEDIATE_CHECKS, PROPOSAL_KINDS, RULE_REPLACEMENTS } from '../../src/effects/registries';
import { BASE_PARTS, FILTER_PARTS } from '../../src/rules/registries';
import { INTRINSIC_PARTS, LAYER_TABLE, RULE_EFFECTS } from '../../src/statics/layers';
import { EVENT_FORMS_PARTS } from '../../src/triggers/forms';

export const M6_REGISTRIES: Readonly<Record<string, object>> = {
  BODY_KINDS, ENTERS_PARTS, DESTINATION_PARTS, PROPOSAL_KINDS, RULE_REPLACEMENTS, IMMEDIATE_CHECKS, CHANGE_FACE,
  MOVE_PARTS, RESOLVE_PERMANENT_PARTS, TURN_BASED, SPECIAL_ACTION_HANDLERS, VIEW_PARTS,
  BASE_PARTS, FILTER_PARTS, LAYER_TABLE, RULE_EFFECTS, INTRINSIC_PARTS, CAST_OPTION_PROVIDERS, LAYOUT_SUPPORT, EVENT_FORMS_PARTS,
};
