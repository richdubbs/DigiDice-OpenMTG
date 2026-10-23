/**
 * M13-14: the Prometheus text exposition (design 10.2): families sorted, HELP and TYPE, counters, gauges and cumulative histograms with `_sum` and
 * `_count`; values that would poison a series are ignored; labels are checked. The listener's token rules are pinned by test/m13-6/server.test.ts.
 */
import { describe, expect, it } from 'vitest';
import { bearerMatches, bucketsOf, LATENCY_BUCKETS, METRIC_HELP, PrometheusMetrics, WAIT_BUCKETS } from '../../src/obs/prometheus';
import { METRICS } from '../../src/obs';

describe('M13-14 the Prometheus text', () => {
  it('every metric has a line of help', () => {
    for (const name of Object.values(METRICS)) expect(METRIC_HELP[name], name).toMatch(/\S/);
  });

  it('counters, gauges and histograms, each family once with its HELP and TYPE, in name order', () => {
    const m = new PrometheusMetrics(2);
    m.inc(METRICS.refusals, { reason: 'origin' });
    m.inc(METRICS.refusals, { reason: 'origin' }, 2);
    m.set(METRICS.connections, 4);
    m.observe(METRICS.actionSeconds, 0.003);
    m.observe(METRICS.actionSeconds, 0.2);
    m.observe(METRICS.actionSeconds, 99);
    const text = m.text();
    const families = [...text.matchAll(/^# TYPE (\S+) (\S+)$/gm)].map((x) => [x[1], x[2]]);
    expect(families).toEqual([
      ['openmtg_hosted_action_seconds', 'histogram'],
      ['openmtg_hosted_connections', 'gauge'],
      ['openmtg_hosted_refusals_total', 'counter'],
    ]);
    expect(text).toContain('openmtg_hosted_refusals_total{reason="origin"} 3');
    expect(text).toContain('openmtg_hosted_connections 4');
    expect(text).toContain('openmtg_hosted_action_seconds_bucket{le="0.0025"} 0');
    expect(text).toContain('openmtg_hosted_action_seconds_bucket{le="0.005"} 1');
    expect(text).toContain('openmtg_hosted_action_seconds_bucket{le="0.25"} 2');
    expect(text).toContain('openmtg_hosted_action_seconds_bucket{le="+Inf"} 3');
    expect(text).toContain('openmtg_hosted_action_seconds_count 3');
    expect(text).toMatch(/openmtg_hosted_action_seconds_sum 99\.203/);
    expect(text.endsWith('\n')).toBe(true);
  });

  it('a wait is bucketed in seconds to an hour, a latency in milliseconds to ten seconds', () => {
    expect(bucketsOf(METRICS.capacityWaitSeconds)).toEqual(WAIT_BUCKETS);
    expect(bucketsOf(METRICS.applySeconds)).toEqual(LATENCY_BUCKETS);
  });

  it('a value that would poison a series is ignored; a counter never goes down; a negative duration counts as 0', () => {
    const m = new PrometheusMetrics();
    m.inc(METRICS.drops, {}, -5);
    m.inc(METRICS.drops, {}, Number.NaN);
    m.set(METRICS.sessions, Number.POSITIVE_INFINITY);
    m.observe(METRICS.commitSeconds, Number.NaN);
    m.observe(METRICS.commitSeconds, -1);
    const text = m.text();
    expect(text).not.toMatch(/openmtg_hosted_drops_total/);
    expect(text).not.toMatch(/openmtg_hosted_sessions/);
    expect(text).toContain('openmtg_hosted_commit_seconds_bucket{le="0.001"} 1');
  });

  it('a label or label value outside the closed sets is a programming error', () => {
    const m = new PrometheusMetrics(2);
    expect(() => m.inc(METRICS.refusals, { reason: 'origin' })).not.toThrow();
    expect(() => m.inc(METRICS.refusals, { game: 'G1' } as never)).toThrow();
    expect(() => m.set(METRICS.workerHeapBytes, 1, { worker: '5' })).toThrow();
    expect(() => m.set(METRICS.workerHeapBytes, 1, { worker: '1' })).not.toThrow();
  });

  it('the token is compared whole: the scheme, the case and the length matter', () => {
    const token = 'ab'.repeat(32);
    expect(bearerMatches(`Bearer ${token}`, token)).toBe(true);
    for (const h of [undefined, '', token, `bearer ${token}`, `Bearer ${token} `, `Bearer ${token.slice(1)}`, `Bearer ${'cd'.repeat(32)}`]) {
      expect(bearerMatches(h, token), String(h)).toBe(false);
    }
  });
});
