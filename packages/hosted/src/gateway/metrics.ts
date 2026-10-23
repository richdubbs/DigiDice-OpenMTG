/**
 * The metrics listener (design 10.2, review 9): a separate HTTP server on `METRICS_PORT`, the Prometheus text format at `/metrics`, a bearer token on every
 * request. Its code is M13-14's, in `../obs/prometheus`; this file keeps the names the gateway's package and tests have always imported.
 */
export { bearerMatches, createMetricsServer, PrometheusMetrics } from '../obs/prometheus';
