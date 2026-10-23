/**
 * What a server's configuration says about matchmaking (design 4.5, 13.4; package M13-9): the matcher's policy (the pod wait is configurable), which
 * queues the server offers (its formats, `PODS_ENABLED`), and whether a key is a queue at all. Pure.
 */
import { HOSTED_FORMATS, isHostedFormat } from '../api';
import type { HostedConfig } from '../config';
import { DEFAULT_MATCH_POLICY, type MatchPolicy, type QueueKey } from './api';

/** The design's policy with this server's pod wait (`POD_THREE_AFTER_SECONDS`, 90 by default). */
export function matchPolicyFor(config: Pick<HostedConfig, 'podThreeAfterSeconds'>): MatchPolicy {
  return { ...DEFAULT_MATCH_POLICY, podThreeAfterMs: config.podThreeAfterSeconds * 1_000 };
}

/**
 * Whether `k` names a queue that can exist: a hosted format with size 2 (every format), or with size `'pod'` (the Free-for-All formats: Commander,
 * Brawl and Standard Brawl; a pod queue of a 1v1 format never exists, so a 2-player match from a pod queue cannot happen).
 */
export function isQueueKey(k: unknown): k is QueueKey {
  if (typeof k !== 'object' || k === null) return false;
  const { format, size } = k as { format?: unknown; size?: unknown };
  if (!isHostedFormat(format)) return false;
  if (size === 2) return true;
  return size === 'pod' && HOSTED_FORMATS.some((f) => f.id === format && f.pods);
}

/**
 * `MatcherContext.offered` for a server: the queue exists, its format is one of the server's (`HOSTED_FORMATS`), and a pod queue is open only with
 * `PODS_ENABLED` (milestone 13's M13-16 turns pods on; until then a pod `queue` is refused with `notYet` by the gateway and `notOffered` here).
 */
export function offeredQueues(config: Pick<HostedConfig, 'formats' | 'podsEnabled'>): (key: QueueKey) => boolean {
  const formats: ReadonlySet<string> = new Set(config.formats);
  return (key) => isQueueKey(key) && formats.has(key.format) && (key.size === 2 || config.podsEnabled);
}
