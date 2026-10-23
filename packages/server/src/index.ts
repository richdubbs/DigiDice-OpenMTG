/** @openmtg/server public API (Node only). Browser code imports only `@openmtg/server/api` (types). */
export * from './api';
export { startServer, createApp, contextFrom, isLoopbackHost, HOST, MAX_BODY_BYTES, CONTENT_SECURITY_POLICY, DEFAULT_CLIENT_DIST, type ServerOptions, type RunningServer } from './http';
export { warmCardCache } from './cache';
export { ROUTES, matchRoute, type RouteMatch } from './routes';
export { badRequest, notImplemented, type ServerContext, type ApiRequest, type ApiResult, type Handler, type UpdateIo } from './context';
// Online play (milestone 9). Browser code imports only `@openmtg/server/online` (types and constants).
export * from './online/api';
export { OnlineService, type OnlineOptions } from './online/socket';
export { OnlineBridge, type BridgeOptions, type OnlineBackends, type ClientPort, type ClientHandle } from './online/bridge';
export { checkUpgrade, checkSessionRequest, checkExtraOrigin, allowedOrigins, isLoopbackHostWithPort, newOnlineToken, type Verdict } from './online/guard';
export { parseClientMessage, parseGameAddress, checkClientAction } from './online/messages';
export { OnlineReplayStore, replayRequest, KEEP_RECORDS, type ReplayRequestResult } from './online/replays';
