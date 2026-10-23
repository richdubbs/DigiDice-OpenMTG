/** Type-level helpers of the ladder's tests (M15-1; shared). */

/** True when A and B are the same type (checked by the package typecheck: `const x: Equals<A, B> = true`). */
export type Equals<A, B> = (<T>() => T extends A ? 1 : 2) extends <T>() => T extends B ? 1 : 2 ? true : false;
