/** Format validation (milestone 7): format definitions, deck construction checks, report text. */
export { FORMATS, findFormat, formatById } from './formats';
export { validateDeck, UnknownFormatError } from './validate';
export { canBeCommander, canBeYourCommanderAbility, canPartner, partnerAbilities, type PartnerAbility } from './commander';
export { basicLandTypes, colorIdentity, deckLimitText, frontFace, hasCompanion, isBasicLand } from './card-rules';
export { COMPANION_RULES, checkCompanion, companionCondition, companionRuleOf, type CompanionCheck, type CompanionRule, type CompanionVerdict, type StartingDeck } from './companion';
export { formatListLines, problemLine, reportLines, takeOption } from './report';
export type { CommanderStyle, DeckEntry, DeckPart, DeckToValidate, FormatDef, FormatId, FormatProblem, FormatReport, ProblemCode, Severity, UnknownEntry } from './types';
