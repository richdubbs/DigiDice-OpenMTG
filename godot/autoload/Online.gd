extends Node
## Online play (the browser's online/OnlineLink.ts): the socket to this player's own OpenMTG server, which plays the game with the
## other players' servers over UDP (packages/net) as the host or a guest. This app never talks to the other players directly.
##
##   1. GET /api/online/session -> {token, protocol} (the server's own page only; an app that sends no Origin passes).
##   2. ws://127.0.0.1:<port>/api/online/socket?token=<token>, with this server's origin as Origin (the socket's guard wants it).
##   3. The server sends `status` at once (and the current view, if a game runs), then on every change; every command gets one
##      `reply` with its id.
##
## It keeps what the server last said (the status, the latest view with its events and legal actions, a proposal to answer,
## notices, chat) and says `changed` after each. Closing the socket does not end the game (the server keeps it; a new socket gets
## the status and the view again): `leave` does. A socket that drops for no reason opens again after RETRY_S, up to MAX_RETRIES
## times in a row; commands waiting for a reply are answered `disconnected`.

## Something the server said, or the link itself, changed.
signal changed()
## The answer to command `id`: {"ok": true} or {"ok": false, "error": {code, message, rules?, details?}}.
signal replied(id: int, reply: Dictionary)

const PROTOCOL: int = 3
const SESSION_PATH: String = "/api/online/session"
const SOCKET_PATH: String = "/api/online/socket"
const REPLAYS_PATH: String = "/api/replays/online"
const DEFAULT_PORT: int = 47620
const CLOSE_REPLACED: int = 4001
const CLOSE_PROTOCOL: int = 4002
const CLOSE_SHUTDOWN: int = 4003
const RETRY_S: float = 1.0
const MAX_RETRIES: int = 5
const KEEP_NOTICES: int = 50
const KEEP_CHAT: int = 200
## How long a host or a join may take before giving up waiting (the server has its own, shorter handshake timeout).
const SETUP_TIMEOUT_S: float = 45.0
const MAX_CHAT: int = 500
const IDLE: Dictionary = {"role": "none", "phase": "idle", "warnings": []}

var status: Dictionary = IDLE.duplicate(true)
## The latest view message: {seq, view, events, legal}; {} for none.
var view: Dictionary = {}
## Manual adjustments to answer (or this player's own, waiting for answers); {} for none.
var proposal: Dictionary = {}
## How the last proposal of a 3-4 player game ended: {n, proposal, outcome, by?, player?, sourceName?}; {} for none.
var outcome: Dictionary = {}
## [{n, kind, text, player?}]
var notices: Array[Dictionary] = []
## [{n, from: "me"|"opponent", text, player?, history?}]
var chat: Array[Dictionary] = []
## The whole game as the host shared it (a guest: gzip in base64), "" for none.
var shared_game: String = ""
## "connecting", "open", "lost" or "closed".
var link_state: String = "closed"
## Why the socket is lost or closed, in words ("" while it is fine).
var link_problem: String = ""

var _ws := WebSocketPeer.new()
var _socket_state: int = WebSocketPeer.STATE_CLOSED
var _token: String = ""
var _next_id: int = 1
## id -> the time (s) it gives up waiting (0: never).
var _pending: Dictionary = {}
var _retries: int = 0
var _retry_in: float = -1.0
var _closed_here: bool = true
var _counter: int = 0
var _clock: float = 0.0
var _connecting: bool = false
## The socket is open and the server's first status has not come yet.
var _waiting_first_status: bool = false
## Who wants the link's sounds (the setup screens and the online panel), counted.
var _sound_watchers: int = 0
var _last_notice_n: int = 0
var _last_chat_n: int = 0
var _down: bool = false
var _ever_open: bool = false


# ---- connecting ---------------------------------------------------------------------------------------------------------------

## Get the token and open the socket; returns "" once the server's first status arrived, else why it could not.
func connect_link() -> String:
	if link_state == "open":
		return ""
	if _connecting:
		while _connecting:
			await changed
		return link_problem if link_state != "open" else ""
	_connecting = true
	_closed_here = false
	if not Server.is_ready:
		await Server.server_ready
	if _token == "":
		var r: Dictionary = await Server.get_json(SESSION_PATH)
		var body := Val.as_dict(r.get("data"))
		if not bool(r["ok"]):
			return _connect_failed("The local OpenMTG server refused online play (%s)." % String(r["error"]))
		if Val.text(body, "token") == "":
			return _connect_failed("The local OpenMTG server gave no online session.")
		if int(Val.num(body, "protocol")) != PROTOCOL:
			return _connect_failed("This app and the local OpenMTG server are different versions (online protocol %d and %d). Restart OpenMTG." % [
				PROTOCOL, int(Val.num(body, "protocol"))])
		_token = Val.text(body, "token")
	_open_socket()
	while link_state == "connecting" or (link_state == "open" and _waiting_first_status):
		await changed
	_connecting = false
	return "" if link_state == "open" else link_problem



func _connect_failed(message: String) -> String:
	_connecting = false
	link_state = "closed"
	link_problem = message
	changed.emit()
	return message


func _open_socket() -> void:
	_ws = WebSocketPeer.new()
	_ws.inbound_buffer_size = 16 * 1024 * 1024
	_ws.handshake_headers = PackedStringArray(["Origin: http://%s:%d" % [Server.host, Server.port]])
	var url := "ws://%s:%d%s?token=%s" % [Server.host, Server.port, SOCKET_PATH, _token.uri_encode()]
	var err := _ws.connect_to_url(url)
	link_state = "connecting"
	_waiting_first_status = true
	_socket_state = WebSocketPeer.STATE_CONNECTING
	changed.emit()
	if err != OK:
		_dropped(1006, "")


## Close the socket (the game goes on at the server; `leave` first to end it).
func close_link() -> void:
	_closed_here = true
	_retry_in = -1.0
	if _socket_state != WebSocketPeer.STATE_CLOSED:
		_ws.close(1000, "closed by the app")
		_socket_state = WebSocketPeer.STATE_CLOSED
		_dropped(1000, "")
	elif link_state != "closed":
		link_state = "closed"
		changed.emit()


func _dropped(code: int, reason: String) -> void:
	_waiting_first_status = false
	for id: Variant in _pending.keys():
		_pending.erase(id)
		replied.emit(int(id), _error("disconnected", "The connection to the local OpenMTG server dropped before it answered."))
	if _closed_here:
		link_state = "closed"
		link_problem = ""
	elif code == CLOSE_REPLACED:
		link_state = "closed"
		link_problem = "This game was opened in another window; play it there (or open it here again to take it back)."
	elif code == CLOSE_SHUTDOWN:
		link_state = "closed"
		link_problem = "The local OpenMTG server stopped, and the online game with it."
	elif code == CLOSE_PROTOCOL:
		link_state = "closed"
		link_problem = "The local OpenMTG server closed the connection: %s." % (reason if reason != "" else "protocol error")
	elif _retries < MAX_RETRIES:
		link_state = "lost"
		link_problem = "Lost the connection to the local OpenMTG server; trying again…"
		_retries += 1
		_retry_in = RETRY_S
	else:
		link_state = "closed"
		link_problem = "Lost the connection to the local OpenMTG server. Check that OpenMTG is still running."
	changed.emit()


func _process(delta: float) -> void:
	_clock += delta
	if _retry_in >= 0.0:
		_retry_in -= delta
		if _retry_in < 0.0 and not _closed_here:
			_open_socket()
	for id: Variant in _pending.keys():
		var until: float = _pending[id]
		if until > 0.0 and _clock >= until:
			_pending.erase(id)
			replied.emit(int(id), _error("timeout", "The local OpenMTG server did not answer in time."))
	if _socket_state == WebSocketPeer.STATE_CLOSED:
		return
	_ws.poll()
	var state := _ws.get_ready_state()
	if state != _socket_state:
		_socket_state = state
		if state == WebSocketPeer.STATE_OPEN:
			link_state = "open"
			link_problem = ""
			changed.emit()
		elif state == WebSocketPeer.STATE_CLOSED:
			_dropped(_ws.get_close_code(), _ws.get_close_reason())
			return
	if state != WebSocketPeer.STATE_OPEN:
		return
	while _ws.get_available_packet_count() > 0:
		var msg: Variant = JSON.parse_string(_ws.get_packet().get_string_from_utf8())
		if msg is Dictionary:
			_receive(msg)


# ---- receiving ----------------------------------------------------------------------------------------------------------------

func _receive(msg: Dictionary) -> void:
	match Val.text(msg, "t"):
		"status":
			status = Val.dict(msg, "status")
			var phase := Val.text(status, "phase")
			# A new game (or none): the old game's view and proposal are gone.
			if phase in ["idle", "starting", "joining", "waiting"]:
				view = {}
				proposal = {}
				outcome = {}
				shared_game = ""
			# A game being set up starts its own chat.
			if phase == "starting" or phase == "joining":
				chat.clear()
			if _waiting_first_status:
				_waiting_first_status = false
				_retries = 0
			_changed()
		"view":
			# `seq` only goes up; a resend repeats the last view without its events, which were shown already.
			if not view.is_empty() and Val.num(msg, "seq") < Val.num(view, "seq"):
				return
			view = msg
			_changed()
		"reply":
			var id := int(Val.num(msg, "id"))
			if not _pending.has(id):
				return
			_pending.erase(id)
			replied.emit(id, {"ok": true} if Val.flag(msg, "ok") else {"ok": false, "error": Val.dict(msg, "error")})
		"manualProposal":
			proposal = Val.dict(msg, "proposal")
			_changed()
		"manualClosed":
			var id := int(Val.num(msg, "proposal"))
			var held := proposal if int(Val.num(proposal, "id", -1)) == id else {}
			if not held.is_empty():
				proposal = {}
			if Val.text(msg, "outcome") != "":
				_counter += 1
				outcome = {"n": _counter, "proposal": id, "outcome": Val.text(msg, "outcome")}
				if Val.text(msg, "by") != "":
					outcome["by"] = Val.text(msg, "by")
				if Val.text(held, "player") != "":
					outcome["player"] = Val.text(held, "player")
				if not held.is_empty():
					outcome["sourceName"] = Val.text(held, "sourceName")
			if not held.is_empty() or Val.text(msg, "outcome") != "":
				_changed()
		"chat":
			_counter += 1
			var line := {"n": _counter, "from": "opponent", "text": Val.text(msg, "text")}
			if Val.text(msg, "from") != "":
				line["player"] = Val.text(msg, "from")
			chat.append(line)
			_trim(chat, KEEP_CHAT)
			_changed()
		"chatHistory":
			var lines: Array[Dictionary] = []
			for l: Variant in Val.list(msg, "lines"):
				var ld := Val.as_dict(l)
				if not ld.has("text"):
					continue
				_counter += 1
				var line := {"n": _counter, "from": "me" if Val.flag(ld, "mine") else "opponent", "text": Val.text(ld, "text"), "history": true}
				if not Val.flag(ld, "mine") and Val.text(ld, "from") != "":
					line["player"] = Val.text(ld, "from")
				lines.append(line)
			if _same_chat(lines):
				return
			chat = lines
			_trim(chat, KEEP_CHAT)
			_changed()
		"notice":
			_counter += 1
			var n := {"n": _counter, "kind": Val.text(msg, "kind"), "text": Val.text(msg, "text")}
			if Val.text(msg, "player") != "":
				n["player"] = Val.text(msg, "player")
			notices.append(n)
			_trim(notices, KEEP_NOTICES)
			_changed()
		"replayGame":
			var data := Val.text(msg, "data")
			if data == "" or data == shared_game:
				return
			shared_game = data
			_changed()


func _same_chat(lines: Array[Dictionary]) -> bool:
	if lines.size() != chat.size():
		return false
	for i: int in lines.size():
		var a: Dictionary = lines[i]
		var b: Dictionary = chat[i]
		if a["text"] != b["text"] or a["from"] != b["from"] or a.get("player", "") != b.get("player", ""):
			return false
	return true


static func _trim(list: Array[Dictionary], keep: int) -> void:
	while list.size() > keep:
		list.remove_at(0)


func _changed() -> void:
	changed.emit()
	_sounds()


# ---- sounds (the browser's online/sounds.ts) ------------------------------------------------------------------------------------

## The link's sounds while a screen of online play is up (`watch(true)` / `watch(false)`): the socket to the local server and the
## other players coming and going (net.lost, net.restored, net.joined), and their chat (net.chat). Only what happens after the watch
## starts sounds; the chat a new socket gets back is not news.
func watch(on: bool) -> void:
	_sound_watchers = maxi(0, _sound_watchers + (1 if on else -1))
	if on and _sound_watchers == 1:
		_last_notice_n = int(Val.num(notices.back(), "n")) if not notices.is_empty() else 0
		_last_chat_n = int(Val.num(chat.back(), "n")) if not chat.is_empty() else 0
		_ever_open = link_state == "open"
		_down = false


func _sounds() -> void:
	if _sound_watchers <= 0:
		return
	if link_state == "open":
		if _down:
			Sound.cue("net.restored")
		_down = false
		_ever_open = true
	elif _ever_open and not _down and (link_state == "lost" or link_state == "closed") and link_problem != "":
		_down = true
		Sound.cue("net.lost")
	for n: Dictionary in notices:
		if int(n["n"]) <= _last_notice_n:
			continue
		match String(n["kind"]):
			"opponentLeft", "opponentDropped":
				Sound.cue("net.lost")
			"opponentBack":
				Sound.cue("net.restored")
			"opponentJoined":
				Sound.cue("net.joined")
	if not notices.is_empty():
		_last_notice_n = maxi(_last_notice_n, int(notices.back()["n"]))
	var news := false
	for l: Dictionary in chat:
		if int(l["n"]) > _last_chat_n and String(l["from"]) == "opponent" and not l.has("history"):
			news = true
	if news:
		Sound.cue("net.chat")
	if not chat.is_empty():
		_last_chat_n = maxi(_last_chat_n, int(chat.back()["n"]))


# ---- commands ---------------------------------------------------------------------------------------------------------------------

func _error(code: String, message: String) -> Dictionary:
	return {"ok": false, "error": {"code": code, "message": message}}


## Send a command; returns its id, which `replied` carries (also when it could not be sent). `timeout_s`: give up waiting.
func command(msg: Dictionary, timeout_s: float = 0.0) -> int:
	var id := _next_id
	_next_id += 1
	if link_state != "open" or _socket_state != WebSocketPeer.STATE_OPEN:
		var why := link_problem if link_problem != "" else "Not connected to the local OpenMTG server."
		replied.emit.call_deferred(id, _error("disconnected", why))
		return id
	var out := msg.duplicate()
	out["id"] = id
	_pending[id] = _clock + timeout_s if timeout_s > 0.0 else 0.0
	if _ws.send_text(JSON.stringify(out)) != OK:
		_pending.erase(id)
		replied.emit.call_deferred(id, _error("disconnected", "Could not send to the local OpenMTG server."))
	return id


## The reply to command `id`, once it comes.
func reply(id: int) -> Dictionary:
	while true:
		var got: Array = await replied
		if int(got[0]) == id:
			return got[1]
	return {}


## Host a game: `seats` 3 or 4 for a table of more players (one join code per guest seat); 2 for two players.
## `library`: the server keeps the game's replay in its library (this app has none of its own), as for every other game.
func host(player_name: String, deck: Dictionary, format: String, port: int, seats: int = 2) -> int:
	var m := {"t": "host", "name": player_name, "deck": deck, "format": format, "port": port, "library": true}
	if seats > 2:
		m["seats"] = seats
	return command(m, SETUP_TIMEOUT_S)


func join(address: String, code: String, player_name: String, deck: Dictionary) -> int:
	return command({"t": "join", "address": address, "code": code, "name": player_name, "deck": deck, "library": true}, SETUP_TIMEOUT_S)


## No timeout: a guest's manual answer waits for the host player's consent.
func act(action: Dictionary) -> int:
	return command({"t": "act", "action": action})


func answer_proposal(proposal_id: int, accept: bool, reason: String = "") -> int:
	var m := {"t": "manual", "proposal": proposal_id, "accept": accept}
	if reason != "":
		m["reason"] = reason
	return command(m)


## Host only: end the game for a guest that left (CR 104.3a); `player` names which guest of a 3-4 player game.
func forfeit(player: String = "") -> int:
	var m := {"t": "forfeit"}
	if player != "":
		m["player"] = player
	return command(m)


## A chat line; this player's own line is kept once the server took it.
func say(text: String) -> int:
	var t := text.left(MAX_CHAT)
	var id := command({"t": "chat", "text": t})
	_keep_own_line(id, t)
	return id


func _keep_own_line(id: int, text: String) -> void:
	var r := await reply(id)
	if bool(r.get("ok", false)):
		_counter += 1
		chat.append({"n": _counter, "from": "me", "text": text})
		_trim(chat, KEEP_CHAT)
		_changed()


## This player's "Show my cards in replays" (their hand, face-down cards and decklist; default off).
func set_replay_consent(agree: bool) -> int:
	return command({"t": "replayConsent", "agree": agree})


## End the game for this side (the other side is told) and go back to idle. The host of a running 3-4 player game concedes and its
## server keeps running the game for the others (`spectating`); a second leave closes it.
func leave() -> int:
	return command({"t": "leave"}, 10.0)


## Whether a game is open at the server (hosting, joining, playing, over): a new host or join must leave it first.
func has_game() -> bool:
	var phase := Val.text(status, "phase")
	return phase != "idle" and phase != "closed" and phase != ""
