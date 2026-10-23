/**
 * Wires the renderer together (WP2): fills the table `K` of render/kernel.ts with the implementations. Every public module of render/ imports this one
 * first (a side-effect import), so the mutually recursive renderers can call each other without an import cycle.
 */
import { ability } from './abil';
import { cond } from './cond';
import { cost, costParts, costVerbs } from './costs';
import { dur } from './dur';
import { event, events } from './evt';
import { K } from './kernel';
import { np, nounsOf, zoneTail } from './np';
import { program } from './program';
import { isNumber, qty } from './qty';
import { obj, player, specPhrase } from './refs';
import { costAmount, staticEffect, staticEffects } from './stat';
import { clause, steps } from './steps';
import { withP2iv2 } from './p2iv2'; // p2-intervening-2: Oracle's words of its intervening "if" readings

Object.assign(K, { np, nounsOf, zoneTail, obj, player, specPhrase, qty, isNumber, cond: withP2iv2(cond), event, events, dur, cost, costParts, costVerbs, clause, steps, program, ability, staticEffect, staticEffects, costAmount });
