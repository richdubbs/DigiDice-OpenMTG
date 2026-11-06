extends Node
## Finds the local OpenMTG server, starts it when needed, and watches it (autoload "Server").
##
## 1. If the environment variable OPENMTG_SERVER is set ("host:port" or "host:port:token"; a developer runs the TypeScript source's
##    `npm run start` by hand), that server is used and never started or stopped here.
## 2. Otherwise the bundled server `bin/openmtg-server.exe` (next to the app; in the editor, the project's bin/ folder) is started
##    with SERVER_ARGS. `--announce-json` makes its first line of output exactly one JSON object,
##    {"port": 47600, "token": "<64 hex>", "url": "http://127.0.0.1:47600"} (the TypeScript source's packages/server/src/main.ts). The plain line every server prints ("OpenMTG by DigiDice is running at http://127.0.0.1:47600")
##    is understood too, as a fallback without a token: the table channel then refuses the socket (the app has no Origin, so the
##    server requires the token), and a warning says so.
## Then GET HEALTH_PATH answers, and `server_ready(port, token)` is emitted. If the started server exits, `lost()` is emitted and it
## is started again, at most RESTART_CAP times in a minute; after that `failed(message)`.
##
## Godot's own rules:
## - The signal is `server_ready`, not `ready`: every Node already has a `ready` signal.
## - The process is started with OS.execute_with_pipe, not OS.create_process: only a pipe lets the app read the first line.
## - The health check is GET /api/status: the local server has no /api/version (its /api/status carries app.version).

signal server_ready(port: int, token: String)
signal lost()
signal failed(message: String)
## A line the server printed (for the Boot screen and the debugger output).
signal output(line: String)

const ENV_NAME: String = "OPENMTG_SERVER"
const EXE_RELATIVE: String = "bin/openmtg-server.exe"
const SERVER_ARGS: Array[String] = ["--port", "0", "--announce-json"]
const HEALTH_PATH: String = "/api/status"
const RESTART_CAP: int = 3
const START_TIMEOUT_S: float = 60.0
## How long a server asked to stop may take (it leaves an online game properly and keeps its replay) before it is ended.
const STOP_WAIT_MS: int = 2000

var host: String = "127.0.0.1"
var port: int = 0
var token: String = ""
## The version the server reported (StatusResponse.app.version).
var version: String = ""
var is_ready: bool = false
## True when the app started the server process (and so stops it on quit).
var owns_process: bool = false

var _pid: int = -1
var _stdio: FileAccess = null
var _reader: Thread = null
var _lines: Array[String] = []
var _lines_mutex := Mutex.new()
var _restarts: Array[float] = []
var _waiting_first_line: bool = false
var _started_at: float = 0.0
var _watch_timer: float = 0.0
var _health_busy: bool = false
var _stopping: bool = false


## Begin: use OPENMTG_SERVER or start the bundled server. Safe to call again after `failed`.
func start() -> void:
	is_ready = false
	var env := OS.get_environment(ENV_NAME)
	if env != "":
		_use_external(env)
	else:
		_launch()


## The server's URL for a path ("/api/decks" -> "http://127.0.0.1:47600/api/decks").
func url(path: String) -> String:
	return "http://%s:%d%s" % [host, port, path]


## The table channel's address. The launch token goes in the upgrade too (the Godot app sends no Origin, so the server needs
## it before anything else; `hello` carries it as well).
func socket_url() -> String:
	var base := "ws://%s:%d/table" % [host, port]
	return base if token == "" else "%s?token=%s" % [base, token.uri_encode()]


## GET a JSON endpoint. Returns {"ok": bool, "status": int, "data": Variant, "error": String}.
func get_json(path: String) -> Dictionary:
	return await request_json(HTTPClient.METHOD_GET, path, null)


## POST a JSON body to an endpoint. Same result as `get_json`.
func post_json(path: String, body: Variant) -> Dictionary:
	return await request_json(HTTPClient.METHOD_POST, path, body)


func request_json(method: HTTPClient.Method, path: String, body: Variant) -> Dictionary:
	var req := HTTPRequest.new()
	req.timeout = 30.0
	add_child(req)
	var headers := PackedStringArray(["Accept: application/json"])
	if token != "":
		headers.append("X-OpenMTG-Token: %s" % token)
	var data := ""
	if typeof(body) != TYPE_NIL:
		headers.append("Content-Type: application/json")
		data = JSON.stringify(body)
	var err := req.request(url(path), headers, method, data)
	if err != OK:
		req.queue_free()
		return {"ok": false, "status": 0, "data": null, "error": "The request could not be sent (%s)." % error_string(err)}
	var res: Array = await req.request_completed
	req.queue_free()
	var result: int = res[0]
	var code: int = res[1]
	var bytes: PackedByteArray = res[3]
	if result != HTTPRequest.RESULT_SUCCESS:
		return {"ok": false, "status": code, "data": null, "error": "The game server did not answer (%d)." % result}
	var text := bytes.get_string_from_utf8()
	var parsed: Variant = JSON.parse_string(text) if text != "" else null
	var ok: bool = code >= 200 and code < 300
	var message := ""
	if not ok:
		message = Val.text(Val.as_dict(parsed), "error", "The game server answered %d." % code)
	return {"ok": ok, "status": code, "data": parsed, "error": message}


## GET a file of the server as text (a notice under /legal/). Returns {"ok": bool, "status": int, "text": String, "error": String}.
func get_text(path: String) -> Dictionary:
	var req := HTTPRequest.new()
	req.timeout = 30.0
	add_child(req)
	var headers := PackedStringArray()
	if token != "":
		headers.append("X-OpenMTG-Token: %s" % token)
	var err := req.request(url(path), headers)
	if err != OK:
		req.queue_free()
		return {"ok": false, "status": 0, "text": "", "error": "the request could not be sent (%s)" % error_string(err)}
	var res: Array = await req.request_completed
	req.queue_free()
	var code: int = res[1]
	if res[0] != HTTPRequest.RESULT_SUCCESS:
		return {"ok": false, "status": code, "text": "", "error": "no answer"}
	if code < 200 or code >= 300:
		return {"ok": false, "status": code, "text": "", "error": "it answered %d" % code}
	return {"ok": true, "status": code, "text": (res[3] as PackedByteArray).get_string_from_utf8(), "error": ""}


## Open a page of the server in the system browser (the Decks screen: "/decks").
func open_page(path: String) -> void:
	if port > 0:
		OS.shell_open(url(path))


func _use_external(env: String) -> void:
	owns_process = false
	var parts := env.split(":")
	if parts.size() < 2 or not parts[1].is_valid_int():
		failed.emit("%s should be host:port or host:port:token (it is \"%s\")." % [ENV_NAME, env])
		return
	host = parts[0] if parts[0] != "" else "127.0.0.1"
	port = parts[1].to_int()
	token = ":".join(parts.slice(2)) if parts.size() > 2 else ""
	_started_at = _now()
	_check_health()


func _exe_path() -> String:
	if OS.has_feature("editor"):
		return ProjectSettings.globalize_path("res://" + EXE_RELATIVE)
	return OS.get_executable_path().get_base_dir().path_join(EXE_RELATIVE)


func _launch() -> void:
	_stop_process() # a retry after a timeout: the earlier process (if any) goes first
	var exe := _exe_path()
	if not FileAccess.file_exists(exe):
		failed.emit("The game server is missing (%s). Developers: set %s=127.0.0.1:47600 and run the OpenMTG server." % [exe, ENV_NAME])
		return
	# A blocking pipe: the reader thread waits for each line (and ends at the end of the output).
	var info := OS.execute_with_pipe(exe, PackedStringArray(SERVER_ARGS))
	if info.is_empty():
		failed.emit("The game server could not be started.")
		return
	owns_process = true
	_pid = Val.as_int(info.get("pid"), -1)
	_stdio = info.get("stdio") as FileAccess
	_waiting_first_line = true
	_started_at = _now()
	port = 0
	token = ""
	_reader = Thread.new()
	_reader.start(_read_output.bind(_stdio))


## Runs on the reader thread: every line the server prints goes to `_lines` (read on the main thread). Reading all of them
## keeps the pipe drained, so the server never blocks on a full pipe.
func _read_output(pipe: FileAccess) -> void:
	while pipe != null and pipe.is_open():
		var line := pipe.get_line()
		var err := pipe.get_error()
		if line != "":
			_lines_mutex.lock()
			_lines.append(line)
			_lines_mutex.unlock()
		elif err != OK:
			break


func _process(delta: float) -> void:
	_drain_lines()
	if _waiting_first_line and _now() - _started_at > START_TIMEOUT_S:
		_waiting_first_line = false
		failed.emit("The game server did not start in time.")
	_watch_timer += delta
	if _watch_timer < 1.0:
		return
	_watch_timer = 0.0
	if owns_process and _pid > 0 and not _stopping and not OS.is_process_running(_pid):
		_on_exit()


func _drain_lines() -> void:
	if _lines.is_empty():
		return
	_lines_mutex.lock()
	var lines: Array[String] = _lines.duplicate()
	_lines.clear()
	_lines_mutex.unlock()
	for line: String in lines:
		output.emit(line)
		if _waiting_first_line:
			_first_line(line)


## The server's first line: JSON {port, token, url} (`--announce-json`), or the plain "running at http://host:port" (no token).
func _first_line(line: String) -> void:
	var re := RegEx.create_from_string("https?://([0-9.]+|localhost):([0-9]+)")
	var text := line.strip_edges()
	var parsed: Variant = JSON.parse_string(text) if text.begins_with("{") else null
	if parsed is Dictionary and Val.num(parsed, "port") > 0:
		port = Val.num(parsed, "port")
		token = Val.text(parsed, "token")
		host = "127.0.0.1"
		var m_url := re.search(Val.text(parsed, "url"))
		if m_url != null:
			host = m_url.get_string(1)
	else:
		var m := re.search(line)
		if m == null:
			return # some other line before the address: keep waiting
		host = m.get_string(1)
		port = m.get_string(2).to_int()
		token = ""
		push_warning("The game server did not announce its token (started without --announce-json?): the table channel will refuse the socket.")
	_waiting_first_line = false
	_check_health()


func _check_health() -> void:
	if _health_busy:
		return
	_health_busy = true
	while not is_ready:
		var r: Dictionary = await get_json(HEALTH_PATH)
		if Val.flag(r, "ok"):
			version = Val.text(Val.dict(Val.as_dict(r.get("data")), "app"), "version")
			is_ready = true
			_health_busy = false
			server_ready.emit(port, token)
			return
		if _now() - _started_at > START_TIMEOUT_S:
			_health_busy = false
			failed.emit("The game server does not answer at %s." % url(HEALTH_PATH))
			return
		await get_tree().create_timer(0.5).timeout
	_health_busy = false


func _on_exit() -> void:
	is_ready = false
	_pid = -1
	_join_reader()
	lost.emit()
	var now := _now()
	var recent: Array[float] = []
	for t: float in _restarts:
		if now - t < 60.0:
			recent.append(t)
	_restarts = recent
	if _restarts.size() >= RESTART_CAP:
		failed.emit("The game server stopped %d times in a minute. Please restart OpenMTG." % RESTART_CAP)
		return
	_restarts.append(now)
	_launch()


func _join_reader() -> void:
	if _reader != null and _reader.is_started():
		_reader.wait_to_finish()
	_reader = null
	_stdio = null


func _now() -> float:
	return Time.get_ticks_msec() / 1000.0


func _stop_process() -> void:
	if owns_process and _pid > 0 and OS.is_process_running(_pid):
		# Asked first, on its standard input: it closes properly (an online game is left with a bye, its replay kept). A server
		# that does not stop in time, or cannot be asked, is ended.
		if _stdio != null and _stdio.is_open():
			_stdio.store_line("stop")
			_stdio.flush()
			var waited := 0
			while OS.is_process_running(_pid) and waited < STOP_WAIT_MS:
				OS.delay_msec(25)
				waited += 25
		if OS.is_process_running(_pid):
			OS.kill(_pid)
	_pid = -1
	_join_reader()


func _exit_tree() -> void:
	_stopping = true
	_stop_process()
