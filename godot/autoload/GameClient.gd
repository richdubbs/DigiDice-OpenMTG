extends Node
## The table channel: one WebSocket to the local server (autoload "GameClient"). Message shapes exactly as the
## TypeScript source's packages/server/src/table/api.ts (names reused from packages/hosted/src/api.ts).
##
## Holds the current view of the seat shown on this screen and what comes with it (legal actions, the hand-off, the undo flag,
## the status text, the clocks), applies `view` and `patch` messages (model/Patch.gd), and sends the player's actions. It never
## decides anything about the game: the engine in the server does.
##
## Client to server: hello {token, protocol}, start {kind, config, seats, computers, seed}, attach {table},
##   act {table, id, seq, action}, shown {table, seq}, undo {table, id?}, handoff {table}, stops {table, player, stops, id?},
##   leave {table}, ping. (`start` also carries `speed`, the animation speed the computer paces itself by.)
## Server to client: welcome {protocol, version, features}, table {table, kind, seats, viewer},
##   view {table, seq, view, legal, handoff, canUndo, status, clocks?, events},
##   patch {table, seq, base, ops, legal, handoff, canUndo, status, clocks?, events}, reply {id, ok, error?},
##   proposal / proposalClosed (not sent: online games have their own, Online.gd), notice {text, level}, result {table, result}, pong.
##
## Names that differ from the channel's (GDScript allows no member variable and method with the same name):
## the hand-off is held in `handoff_player` (the method is `handoff()`), the last result in `game_result`.
##
## Pacing (the browser's PacedConnection.ts): while a Table with an animator is open it sets `paced`, and
## every change that arrives (a `view` or a `patch`, with its events) is queued instead of shown. The Table takes one at a time
## (`take_change`), animates part A on the view on screen, shows the change (`show_change`: the public fields below become that
## change's, and `view_changed` fires), animates part B, then sends `shown(seq)`. With more than MAX_BACKLOG changes waiting,
## `take_change` jumps to the latest (`skipped`: shown at once, its sounds condensed). Unpaced (no Table, tests, the Table without its
## animator), every change is shown at once. The public fields (`view`, `seq`, `legal` ...) are always the change ON
## SCREEN, so prompts and `act` (which sends the seq the action was chosen from) never run ahead of the board; patches apply to the
## latest view received, which may be ahead of it.

signal view_changed(at_seq: int)
signal events(at_seq: int, list: Array)
signal replied(id: int, ok: bool, error: Dictionary)
signal notice(text: String, level: String)
signal result(r: Dictionary)
signal connected()
signal disconnected()
## A `table` message arrived: the table exists (after `start` or `attach`).
signal table_opened(table: String)
## Paced: a change was queued; `count` changes are waiting.
signal changes_waiting(count: int)
## A watched replay moved (its position, play, speed or seat): `replay_state` holds what the server said.
signal replay_state_changed()
## A watched replay refused a control (a view its reveal policy does not allow), with why.
signal replay_refused(message: String)
## The game's replay changed: where it stands, Keep, who shows their cards (`recording`).
signal recording_changed()
## What the table must say about an online game's link changed (`status`), with no new view.
signal status_changed()
## "Report a bug": the moment taken for request `id` ({holds, kind, at, length} or {error}).
signal bug_captured(id: int, info: Dictionary)
## "Report a bug": the report made for request `id` ({name, data (base64)} or {error}).
signal bug_report_file(id: int, info: Dictionary)

const PROTOCOL: int = 1
const PING_EVERY_S: float = 15.0
const RECONNECT_EVERY_S: float = 2.0
## A full view is a few hundred KB, a game config with its card definitions too: the default 64 KB buffers are far too small.
const BUFFER_BYTES: int = 16 * 1024 * 1024
## With more changes than this waiting, the table jumps to the latest (PacedConnection maxBacklog).
const MAX_BACKLOG: int = 6

## The current view (the engine's GameView for the seat shown here), {} before the first.
var view: Dictionary = {}
## The view before the last change (the animations play the change between the two).
var prev_view: Dictionary = {}
var seq: int = -1
## LegalAction[] {action, kind, label, isMana, object?} of the shown player.
var legal: Array = []
## The pending decision of the view, {} when none.
var pending: Dictionary = {}
## Hot-seat: the player who must take over the screen, "" when none (the pass cover shows while it is set).
var handoff_player: String = ""
var can_undo: bool = false
## A problem to show (a lost link, the computer stuck), "" when none.
var status: String = ""
## ClockView {at, seats, abandonMs?} of a DigiDice table, {} when none; `clocks_at` is this app's clock when it came.
var clocks: Dictionary = {}
var clocks_at: float = 0.0
## The last `result` message's result, {} while the game goes on.
var game_result: Dictionary = {}

## The table this client plays at ("" when none), its kind and seats, and the seat shown.
var table_id: String = ""
## A replay is open (watch): its transport's state from the server (index, length, playing, speed, perspective, perspectives,
## turns, title).
var is_replay: bool = false
var replay_state: Dictionary = {}
## The game's replay as the server records it: id, state ("recording", "saving", "saved", "failed", "empty"), error, keep, the
## people at the screen and who of them agreed to show their cards in it.
var recording: Dictionary = {}
## The finished game to come back to after watching its replay from the end screen ("" for none).
var return_table: String = ""
## An online game (Online, the local server's online play, the browser's RemoteConnection): its views come from Online and its
## actions go there; table_id is "online".
var is_online: bool = false
var _online_seq: int = -1
## Online command ids of this table's actions, whose replies become `replied`.
var _online_acts: Dictionary = {}
var table_kind: String = ""
var table_seats: Array = []
var viewer: String = ""
## The last `start` request, for a rematch.
var last_start: Dictionary = {}
## Whether the socket is open and the server welcomed us.
var online: bool = false
var server_version: String = ""
var server_features: Array = []
## The Table's board selection, set while a Table is open (prompts read it as `client.selection`; prompts/README.md).
var selection: BoardSelection = null
## Set by a Table that animates changes: changes are queued for it instead of shown at once.
var paced: bool = false

## The latest view received and its seq (patches apply to it; it may be ahead of `view`, the one on screen).
var _recv_view: Dictionary = {}
var _recv_seq: int = -1
## Changes received and not yet shown: {seq, view, events, legal, handoff, canUndo, status, clocks?, skipped?}.
var _queue: Array[Dictionary] = []

var _ws := WebSocketPeer.new()
var _socket_state: int = WebSocketPeer.STATE_CLOSED
var _next_id: int = 1
var _ping_timer: float = 0.0
var _reconnect_timer: float = 0.0
var _want_socket: bool = false
## Messages to send once the server welcomed us.
var _outbox: Array[Dictionary] = []


func _ready() -> void:
	Server.server_ready.connect(_on_server_ready)
	Server.lost.connect(_on_server_lost)
	set_process(true)


# ---- requests ------------------------------------------------------------------------------------------------------------------

## Make a table. kind: "hotseat" | "computer" | "online" | "hosted"; `config` from Config.build_game_config; `seats` the player
## ids at this screen; `computers` the player ids the computer plays; `seed` the computer's seed.
## The computer's pause before each action follows Settings.animation_speed (`speed`, as the TypeScript source's table/api.ts has it).
## `format`: the game's format id, for its replay's title (the server records every game).
func start(kind: String, config: Dictionary, seats: Array, computers: Array, seed_text: String, format: String = "") -> void:
	last_start = {"kind": kind, "config": config, "seats": seats, "computers": computers, "seed": seed_text, "format": format}
	_reset_table()
	_send({"t": "start", "kind": kind, "config": config, "seats": seats, "computers": computers, "seed": seed_text, "speed": Settings.animation_speed,
		"format": format})


## The same game again with fresh seeds (GameOver's Rematch).
func rematch() -> void:
	if last_start.is_empty():
		return
	var config: Dictionary = Val.dict(last_start, "config").duplicate()
	config["seed"] = Config.new_seed()
	start(Val.text(last_start, "kind"), config, Val.list(last_start, "seats"), Val.list(last_start, "computers"), Config.new_seed(),
		Val.text(last_start, "format"))


## Resume an existing table (after the app or the server restarted): a full view follows.
func attach(table: String) -> void:
	table_id = table
	_send({"t": "attach", "table": table})


## Show the online game the local server plays (Online has its status and view): the table's views come from it from now on.
func open_online() -> void:
	_reset_table()
	is_online = true
	table_kind = "online"
	table_id = "online"
	viewer = Val.text(Online.status, "me")
	table_seats = [viewer] if viewer != "" else []
	if not Online.changed.is_connected(_on_online):
		Online.changed.connect(_on_online)
	if not Online.replied.is_connected(_on_online_reply):
		Online.replied.connect(_on_online_reply)
	_on_online()


func _on_online() -> void:
	if not is_online:
		return
	var me := Val.text(Online.status, "me")
	if me != "" and me != viewer:
		viewer = me
		table_seats = [me]
	var text := _online_status_text()
	_online_recording()
	var msg := Online.view
	var s := int(Val.num(msg, "seq", -1))
	if not msg.is_empty() and s > _online_seq:
		_online_seq = s
		var v := Val.dict(msg, "view")
		var legal_now: Array = [] if not View.result(v).is_empty() else Val.list(msg, "legal")
		_received({"legal": legal_now, "canUndo": false, "handoff": "", "status": text}, v, s, Val.list(msg, "events"))
	elif text != status:
		status = text
		status_changed.emit()


## An online game's replay as the end screen reads `recording`: the server keeps it in its library under the status's replay id
## (`saved` once it is there), saved again when a choice changes after the end. Each player chooses "Show my cards in replays" on
## their own screen (OnlinePanel), so the end screen asks nobody.
func _online_recording() -> void:
	var r := Val.dict(Online.status, "replay")
	if r.is_empty():
		return
	var over := not View.result(view).is_empty() or Val.text(Online.status, "phase") in ["over", "closed"]
	var state := "saved" if Val.flag(r, "saved") else ("saving" if over else "recording")
	var keep := Val.flag(recording, "keep") and Val.text(recording, "id") == Val.text(r, "id")
	var next := {"id": Val.text(r, "id"), "state": state, "keep": keep, "people": [], "agreed": []}
	if next == recording:
		return
	var just_saved := state == "saved" and Val.text(recording, "state") != "saved"
	recording = next
	recording_changed.emit()
	# Keep pressed before the replay was in the library: it is marked now.
	if just_saved and keep:
		_online_keep({"keep": true})


## Keep replay for an online game: the library's mark (once the replay is there; until then it waits for the save).
func _online_keep(fields: Dictionary) -> void:
	if not fields.has("keep") or recording.is_empty():
		return
	recording["keep"] = bool(fields["keep"])
	recording_changed.emit()
	if Val.text(recording, "state") != "saved":
		return
	var r: Dictionary = await Server.post_json("/api/library/replays/update", {"id": Val.text(recording, "id"), "keep": bool(fields["keep"])})
	if not bool(r.get("ok", false)):
		push_warning("Keep replay: %s" % Val.text(r, "error", "the library did not answer"))


func _on_online_reply(id: int, r: Dictionary) -> void:
	if not _online_acts.has(id):
		return
	_online_acts.erase(id)
	if bool(r.get("ok", false)):
		replied.emit(id, true, {})
	else:
		var e := Val.dict(r, "error")
		replied.emit(id, false, {"message": OnlineUi.line(e), "rules": Val.list(e, "rules")})


## What the table must say about the link right now ("" for nothing): the link to the local server, the host, the other player.
func _online_status_text() -> String:
	if Online.link_state != "open" and Online.link_problem != "":
		return Online.link_problem
	var s := Online.status
	var other := Val.text(s, "opponent", "The other player")
	match Val.text(s, "phase"):
		"spectating":
			return "You left the game and conceded. Your OpenMTG server keeps running the game for the others: keep OpenMTG open until it ends. Leave again to stop it (the game then ends for everyone without a result)."
		"reconnecting":
			return "The link to the host dropped; reconnecting… (the game waits)"
		"closed":
			return "The game is closed: %s. Leave to go back." % Val.text(s, "closedReason", "the link ended")
		"idle":
			return "This game was left. Leave to go back."
		"playing", "over":
			# A 3-4 player game: each player's presence is in the online panel.
			if s.has("players"):
				return ""
			if Val.text(s, "role") == "host" and s.get("opponentConnected", true) == false:
				var left := ""
				for i: int in range(Online.notices.size() - 1, -1, -1):
					var k := String(Online.notices[i]["kind"])
					if k in ["opponentLeft", "opponentBack", "opponentDropped"]:
						left = k
						break
				if left == "opponentLeft":
					return "%s left." % other if Val.text(s, "phase") == "over" else "%s left the game. You can end it for them (Forfeit, CR 104.3a) or leave." % other
				return "%s's link dropped; waiting for them to come back." % other
	return ""


## Send an engine Action (types/actions.ts) chosen from the view `seq`. Returns the request id that `replied` will carry.
func act(action: Dictionary) -> int:
	if is_online:
		var oid := Online.act(action)
		_online_acts[oid] = true
		return oid
	var id := _next_id
	_next_id += 1
	_send({"t": "act", "table": table_id, "id": id, "seq": seq, "action": action})
	return id


## The table has finished drawing view `seq` (pacing: the computer waits for it).
func shown(shown_seq: int) -> void:
	if table_id != "" and not is_online:
		_send({"t": "shown", "table": table_id, "seq": shown_seq})


## Hot-seat only: take back the shown player's last action. Returns the request id (`replied` says false when nothing was undone).
func undo() -> int:
	var id := _next_id
	_next_id += 1
	if table_id != "":
		_send({"t": "undo", "table": table_id, "id": id})
	return id


## The next player clicked through the pass cover.
func handoff() -> void:
	if table_id != "":
		_send({"t": "handoff", "table": table_id})


## The phase bar's stop toggles (StopSettings {ownTurn, opponentTurn, fullControl, holdPriority?}); never stale. Returns the
## request id the `reply` carries.
func stops(player: String, stop_settings: Dictionary) -> int:
	if is_online:
		return act({"type": "setStops", "player": player, "stops": stop_settings})
	var id := _next_id
	_next_id += 1
	if table_id != "":
		_send({"t": "stops", "table": table_id, "player": player, "stops": stop_settings, "id": id})
	return id


## Watch a replay of the library as a table (the server plays it back; nothing can be done in it but watch).
func watch(replay_id: String) -> void:
	_reset_table()
	is_replay = true
	_send({"t": "watch", "replay": replay_id})


## A watched replay's transport (the server's replay player): "play", "pause", "toggle", "step" (1 or -1), "seek" (a position),
## "turn" (a turn number), "nextTurn", "previousTurn", "speed" (0.25 to 16, or "real"), "changeSpeed" (1 or -1), "perspective"
## (a view's key: "seat:p1", "public", "open") and "muteFast" (true or false).
func replay_control(op: String, value: Variant = null) -> void:
	if table_id != "" and is_replay:
		_send({"t": "replay", "table": table_id, "op": op, "value": value})


## The end screen's replay controls: {"keep": bool} or {"reveal": {"player": id, "agreed": bool}}.
func recording_control(fields: Dictionary) -> void:
	if is_online:
		_online_keep(fields)
		return
	if table_id == "":
		return
	var m := {"t": "recording", "table": table_id}
	m.merge(fields)
	_send(m)


## "Report a bug" opens: the server takes the moment the report is about. Returns the request id `bug_captured` carries.
func bug_capture() -> int:
	var id := _next_id
	_next_id += 1
	_send({"t": "bugCapture", "table": table_id, "id": id})
	return id


## Make the report of the moment taken, with the reporter's words, the card (optional) and the app's environment. Returns the
## request id `bug_report_file` carries.
func bug_report(words: String, card: String, environment: Dictionary) -> int:
	var id := _next_id
	_next_id += 1
	var m := {"t": "bugReport", "table": table_id, "id": id, "words": words, "environment": environment}
	if card != "":
		m["card"] = card
	_send(m)
	return id


## Close the table (the server concedes where the rules require it, CR 104.3a). Online: leave the game at the local server (a
## running game is conceded first; the host of a 3-4 player game keeps serving it to the others).
func leave() -> void:
	if is_online:
		Online.leave()
		_reset_table()
		return
	if table_id != "":
		_send({"t": "leave", "table": table_id})
	_reset_table()


## The legal actions about one object (for the board's click menu).
func legal_for(object_id: String) -> Array[Dictionary]:
	var out: Array[Dictionary] = []
	for la: Variant in legal:
		var d := Val.as_dict(la)
		if Val.text(d, "object") == object_id:
			out.append(d)
	return out


## Whether the object has a legal action other than a mana ability (the board highlights it as playable).
## Whether the object glows as usable now: a spell it can cast or an ability it can activate, not a mana ability. Lands never
## glow: neither playing one nor a land's own ability.
func is_playable(object_id: String) -> bool:
	if Chars.has_type(Chars.of_id(view, object_id), "Land"):
		return false
	for la: Dictionary in legal_for(object_id):
		if not Val.flag(la, "isMana") and Val.text(la, "kind") != "playLand":
			return true
	return false


# ---- the socket ----------------------------------------------------------------------------------------------------------------

func _on_server_ready(_port: int, _token: String) -> void:
	_want_socket = true
	_open_socket()


func _on_server_lost() -> void:
	_close_socket()


func _open_socket() -> void:
	if not Server.is_ready:
		return
	_ws = WebSocketPeer.new()
	_ws.inbound_buffer_size = BUFFER_BYTES
	_ws.outbound_buffer_size = BUFFER_BYTES
	_ws.max_queued_packets = 4096
	var err := _ws.connect_to_url(Server.socket_url())
	if err != OK:
		push_warning("Table channel: could not connect (%s)." % error_string(err))
	_socket_state = _ws.get_ready_state()


func _close_socket() -> void:
	if _socket_state != WebSocketPeer.STATE_CLOSED:
		_ws.close()
	_socket_state = WebSocketPeer.STATE_CLOSED
	if online:
		online = false
		disconnected.emit()


func _process(delta: float) -> void:
	if _socket_state == WebSocketPeer.STATE_CLOSED:
		if _want_socket and Server.is_ready:
			_reconnect_timer += delta
			if _reconnect_timer >= RECONNECT_EVERY_S:
				_reconnect_timer = 0.0
				_open_socket()
		return
	_ws.poll()
	var state := _ws.get_ready_state()
	if state != _socket_state:
		_socket_state = state
		if state == WebSocketPeer.STATE_OPEN:
			# The token always goes in `hello`: the app sends no Origin, so the server needs it (table/socket.ts). Without one (a
			# server that did not announce it) the socket is refused; Server.gd has warned.
			_raw_send({"t": "hello", "token": Server.token, "protocol": PROTOCOL})
		elif state == WebSocketPeer.STATE_CLOSED:
			if online:
				online = false
				disconnected.emit()
			return
	if state != WebSocketPeer.STATE_OPEN:
		return
	while _ws.get_available_packet_count() > 0:
		var text := _ws.get_packet().get_string_from_utf8()
		var msg: Variant = JSON.parse_string(text)
		if msg is Dictionary:
			_handle(msg)
		else:
			push_warning("Table channel: a message that is not a JSON object.")
	_ping_timer += delta
	if _ping_timer >= PING_EVERY_S:
		_ping_timer = 0.0
		_raw_send({"t": "ping"})


func _send(msg: Dictionary) -> void:
	if online and _socket_state == WebSocketPeer.STATE_OPEN:
		_raw_send(msg)
	else:
		_outbox.append(msg)


func _raw_send(msg: Dictionary) -> void:
	var err := _ws.send_text(JSON.stringify(msg))
	if err != OK:
		push_warning("Table channel: a message could not be sent (%s)." % error_string(err))


# ---- messages ------------------------------------------------------------------------------------------------------------------

func _handle(msg: Dictionary) -> void:
	match Val.text(msg, "t"):
		"welcome":
			online = true
			server_version = Val.text(msg, "version")
			server_features = Val.list(msg, "features")
			connected.emit()
			if table_id != "":
				_raw_send({"t": "attach", "table": table_id}) # the app or the server restarted: a full view follows
			var queued := _outbox.duplicate()
			_outbox.clear()
			for m: Dictionary in queued:
				if Val.text(m, "t") == "attach" and table_id != "" and Val.text(m, "table") == table_id:
					continue # already sent above
				_raw_send(m)
		"table":
			table_id = Val.text(msg, "table")
			table_kind = Val.text(msg, "kind")
			table_seats = Val.list(msg, "seats")
			viewer = Val.text(msg, "viewer")
			table_opened.emit(table_id)
		"view":
			# A full view may be a change too (a patch would have been too long, the client fell behind): its events come with it.
			_received(msg, Val.dict(msg, "view"), Val.num(msg, "seq"), Val.list(msg, "events"))
		"patch":
			_on_patch(msg)
		"reply":
			replied.emit(Val.num(msg, "id"), Val.flag(msg, "ok"), Val.dict(msg, "error"))
		"notice":
			notice.emit(Val.text(msg, "text"), Val.text(msg, "level", "info"))
		"result":
			var r: Variant = msg.get("result")
			game_result = r if r is Dictionary else msg
			result.emit(game_result)
		"replayState":
			replay_state = msg
			Sound.game_muted = Val.flag(msg, "muted")
			replay_state_changed.emit()
		"replayRefused":
			replay_refused.emit(Val.text(msg, "message"))
		"recording":
			recording = msg
			recording_changed.emit()
		"bugCaptured":
			bug_captured.emit(Val.num(msg, "id"), msg)
		"bugReportFile":
			bug_report_file.emit(Val.num(msg, "id"), msg)
		"proposal", "proposalClosed":
			pass # online games get another player's proposals from the online socket (Online.gd)
		"pong":
			pass
		_:
			push_warning("Table channel: unknown message %s." % Val.text(msg, "t"))


## Channel rule 1: a patch applies only to the view it was made from; otherwise (or when it does not fit) ask for a full view.
func _on_patch(msg: Dictionary) -> void:
	var next := Patch.next_view({"seq": _recv_seq, "view": _recv_view} if not _recv_view.is_empty() else {}, msg)
	if next.is_empty():
		if table_id != "":
			_raw_send({"t": "attach", "table": table_id})
		return
	_received(msg, Val.dict(next, "view"), Val.num(next, "seq"), Val.list(msg, "events"))


## A new view arrived (with the fields of its message): shown at once, or queued for the Table when paced.
func _received(msg: Dictionary, v: Dictionary, s: int, list: Array) -> void:
	_recv_view = v
	_recv_seq = s
	var change: Dictionary = {
		"seq": s, "view": v, "events": list, "legal": Val.list(msg, "legal"), "handoff": Val.text(msg, "handoff"),
		"canUndo": Val.flag(msg, "canUndo"), "status": Val.text(msg, "status"),
	}
	if msg.has("clocks"):
		change["clocks"] = Val.dict(msg, "clocks")
	# A replay's change without events is a jump (a seek, a step back, another view): shown at once, past whatever still waits.
	if is_replay and list.is_empty():
		change["jump"] = true
		_queue.clear()
	# Unpaced, or nothing on screen yet (the first view of a table): at once.
	if not paced or view.is_empty():
		show_change(change)
		if not list.is_empty():
			events.emit(seq, list)
		return
	_queue.append(change)
	changes_waiting.emit(_queue.size())


## How many changes are waiting to be shown.
func backlog() -> int:
	return _queue.size()


## Whether the latest change waiting is a replay's jump (the Table cuts the animation in progress short for it).
func jump_waiting() -> bool:
	return not _queue.is_empty() and Val.flag(_queue.back(), "jump")


## The seq of the latest view received (shown or still waiting to be shown).
func latest_seq() -> int:
	return _recv_seq


## The next change to show ({} when none). With more than MAX_BACKLOG waiting, the latest one, marked `skipped` (shown at once).
func take_change() -> Dictionary:
	if _queue.is_empty():
		return {}
	if _queue.size() > MAX_BACKLOG:
		var last: Dictionary = _queue.back().duplicate()
		last["skipped"] = true
		_queue.clear()
		return last
	return _queue.pop_front()


## Put a change on screen: the public fields become the change's, then `view_changed(seq)`.
func show_change(change: Dictionary) -> void:
	legal = Val.list(change, "legal")
	handoff_player = Val.text(change, "handoff")
	can_undo = Val.flag(change, "canUndo")
	status = Val.text(change, "status")
	if change.has("clocks"):
		clocks = Val.dict(change, "clocks")
		clocks_at = Time.get_ticks_msec() / 1000.0
	# A jump is shown without sound.
	if Val.flag(change, "jump"):
		Sound.quiet_for(60)
	_set_view(Val.dict(change, "view"), Val.num(change, "seq"))
	view_changed.emit(seq)


## Show the latest change waiting at once (the Table closes or stops animating). Returns whether there was one.
func flush() -> bool:
	if _queue.is_empty():
		return false
	var last: Dictionary = _queue.back()
	_queue.clear()
	show_change(last)
	shown(seq)
	return true


func _set_view(v: Dictionary, s: int) -> void:
	prev_view = view
	view = v
	seq = s
	pending = View.pending(v)
	var who := View.viewer(v)
	if who != "":
		viewer = who


func _reset_table() -> void:
	is_replay = false
	replay_state = {}
	recording = {}
	is_online = false
	_online_seq = -1
	_online_acts.clear()
	Sound.game_muted = false
	table_id = ""
	table_kind = ""
	table_seats = []
	view = {}
	prev_view = {}
	seq = -1
	_recv_view = {}
	_recv_seq = -1
	_queue.clear()
	legal = []
	pending = {}
	handoff_player = ""
	can_undo = false
	status = ""
	clocks = {}
	game_result = {}
