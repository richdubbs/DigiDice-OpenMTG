/** @openmtg/server public API (Node only). Browser code imports only `@openmtg/server/api` (types). */
export * from './api';
export { startServer, createApp, contextFrom, soundsFrom, isLoopbackHost, HOST, MAX_BODY_BYTES, CONTENT_SECURITY_POLICY, DEFAULT_CLIENT_DIST, type ServerOptions, type RunningServer } from './http';
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
// Godot plan phase 1: the table channel (/table). Browser code imports only `@openmtg/server/table` (types and constants).
export { TABLE_PROTOCOL, TABLE_SOCKET_PATH, type TableClientMessage, type TableServerMessage } from './table/api';
export { TableService, TableChannel, checkTableUpgrade, type TableServiceOptions, type TablePort, type TableVerdict } from './table/socket';
export { Table, Tables, TableError, type TablesOptions, type TableSink } from './table/tables';
// Godot plan phase 3: the game's sounds as WAV files (/api/sounds). Browser code imports only `@openmtg/server/sounds` (types and constants).
export * from './sounds/api';
export { SoundService, type SoundServiceOptions, type SoundFile } from './sounds/service';
export { RenderPool, defaultPoolSize, type RenderPoolOptions } from './sounds/pool';
// Card data more than a day old is refreshed in the background at launch (the desktop app, the Godot app's server).
export { CARD_DATA_MAX_AGE_MS, cardDataStale, refreshCardData } from './cardData';
