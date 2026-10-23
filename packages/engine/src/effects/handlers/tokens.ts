/**
 * Op handlers: tokens, copies and casting (CR 111, 701.5, 701.7, 707). Owner: WP14. The aggregator (handlers/index.ts) spreads this table into OP_HANDLERS; the
 * capability `op:<op>` appears only when the op has a handler here AND a renderer (design 5.2), so an unfinished package can never make a card wrongly automated.
 * Ops: createToken copy cast.
 *
 * Files: tokens-create.ts (createToken), tokens-copy.ts (copy: spell copies and token copies), tokens-cast.ts (cast, through effects/cast-hook.ts),
 * token-defs.ts (token definitions: inline, predefined from predefined-tokens.json, copies; ids from canonical JSON).
 */
import type { OpHandlers } from '../api';
import { cast } from './tokens-cast';
import { copy } from './tokens-copy';
import { createToken } from './tokens-create';

export const TOKENS_HANDLERS: OpHandlers = { createToken, copy, cast };
