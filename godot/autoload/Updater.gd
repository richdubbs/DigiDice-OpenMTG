extends Node
## Updates at launch (the desktop app's update at launch, without Electron). Before the game server starts, the latest release of
## the public repository is read (its latest.yml, the file electron-updater reads, so desktop installs and this app follow the same
## releases), and a newer version is downloaded, checked and installed silently: the installer starts the new version by itself
## ("/S --updated --force-run") and this copy closes. Checked: the download's SHA-512 against latest.yml, and its Authenticode
## signature, which must be valid and carry the name of a publisher this copy accepts.
##
## Offline, no newer release, a check that takes more than CHECK_TIMEOUT_S, a download that stops moving for STALL_TIMEOUT_S or that
## fails a check: the app starts as it is and tries again at the next launch. A download still running after DOWNLOAD_CAP_S goes on
## in the background; once it has passed its checks, its installer runs (without starting the app) when the player closes OpenMTG.
##
## Only a copy that knows whom to trust updates itself: CONFIG_FILE next to the program (written when the installer is built) names
## the accepted publishers. Without it (the editor, an unsigned build) nothing is checked or installed.
##
## Every step of the latest launch goes to %APPDATA%\OpenMTG\update.log.

## What the boot screen shows: a message, a smaller line under it, and the share done (negative: none).
signal progress(message: String, detail: String, fraction: float)

const FEED: String = "https://github.com/richdubbs/DigiDice-OpenMTG/releases/latest/download/"
const CONFIG_FILE: String = "update.json"
const CHECK_TIMEOUT_S: float = 10.0
const STALL_TIMEOUT_S: float = 60.0
const DOWNLOAD_CAP_S: float = 180.0
const INSTALL_PAUSE_S: float = 1.5
const BACKGROUND_NOTE: String = "Update downloading, installs when you close OpenMTG"
const MB: float = 1024.0 * 1024.0

## Where latest.yml and the installers are read from (tests point it at a server on this machine).
var feed: String = FEED
## The publisher names an update's signature may carry (CONFIG_FILE's "publishers").
var publishers: PackedStringArray = []
## A downloaded installer that passed its checks, to run when the app closes (a download that went on in the background).
var pending_installer: String = ""

var _configured: bool = false
var _log_path: String = ""
var _download: HTTPRequest = null


func _ready() -> void:
	_read_config()


## Whether this copy updates itself: an exported build with CONFIG_FILE naming at least one publisher.
func enabled() -> bool:
	return _configured and not OS.has_feature("editor") and not publishers.is_empty()


func _read_config() -> void:
	var path := OS.get_executable_path().get_base_dir().path_join(CONFIG_FILE)
	if not FileAccess.file_exists(path):
		return
	var data := Val.as_dict(JSON.parse_string(FileAccess.get_file_as_string(path)))
	publishers.clear()
	for p: Variant in Val.list(data, "publishers"):
		if p is String and String(p).strip_edges() != "":
			publishers.append(String(p).strip_edges())
	_configured = true


## This app's version (project setting application/config/version).
static func app_version() -> String:
	return str(ProjectSettings.get_setting("application/config/version", "0.0.0"))


## latest.yml as electron-builder writes it: {version, path, sha512, size}; {} when it does not read. The top-level `path` and
## `sha512` name the installer; without them, the first entry of `files`.
static func parse_latest(text: String) -> Dictionary:
	text = text.trim_prefix(char(0xFEFF))
	var top := {}
	var first_file := {}
	var in_files := false
	var file_started := false
	for raw: String in text.split("\n"):
		var line := raw.rstrip("\r")
		if line.strip_edges() == "" or line.strip_edges().begins_with("#"):
			continue
		var indented := line.begins_with(" ") or line.begins_with("-")
		var body := line.strip_edges()
		if not indented:
			in_files = body.begins_with("files:")
		if in_files and indented:
			if body.begins_with("- "):
				if file_started:
					in_files = false
					continue
				file_started = true
				body = body.substr(2).strip_edges()
			var kv := _key_value(body)
			if not kv.is_empty():
				first_file[kv[0]] = kv[1]
			continue
		if not indented:
			var kv := _key_value(body)
			if not kv.is_empty():
				top[kv[0]] = kv[1]
	var out := {
		"version": Val.text(top, "version"),
		"path": Val.text(top, "path", Val.text(first_file, "url")),
		"sha512": Val.text(top, "sha512", Val.text(first_file, "sha512")),
		"size": int(Val.text(first_file, "size", "0")),
	}
	if out["version"] == "" or out["path"] == "" or out["sha512"] == "":
		return {}
	# The installer's name only: never a path elsewhere.
	if String(out["path"]).contains("/") or String(out["path"]).contains("\\") or String(out["path"]).contains(".."):
		return {}
	return out


static func _key_value(body: String) -> Array:
	var at := body.find(":")
	if at <= 0:
		return []
	var value := body.substr(at + 1).strip_edges()
	if value.length() >= 2 and ((value.begins_with("'") and value.ends_with("'")) or (value.begins_with("\"") and value.ends_with("\""))):
		value = value.substr(1, value.length() - 2)
	return [body.substr(0, at).strip_edges(), value]


## Whether version `candidate` is newer than `current` (major.minor.patch; a pre-release part is older than its release).
static func is_newer(candidate: String, current: String) -> bool:
	var a := _version_parts(candidate)
	var b := _version_parts(current)
	if a.is_empty() or b.is_empty():
		return false
	for i: int in 3:
		if a[i] != b[i]:
			return a[i] > b[i]
	return a[3] > b[3]


## [major, minor, patch, 1 for a release or 0 for a pre-release], or [] for text that is not a version.
static func _version_parts(v: String) -> Array[int]:
	var main := v.strip_edges().trim_prefix("v")
	var pre := 1
	for cut: String in ["-", "+"]:
		var at := main.find(cut)
		if at >= 0:
			if cut == "-":
				pre = 0
			main = main.substr(0, at)
	var parts := main.split(".")
	if parts.size() != 3:
		return []
	var out: Array[int] = []
	for p: String in parts:
		if not p.is_valid_int():
			return []
		out.append(p.to_int())
	out.append(pre)
	return out


## The certificate subject's common name: `CN=DigiDice LLC, O=DigiDice LLC, C=US` -> "DigiDice LLC" (a quoted name keeps its commas).
static func signer_name(subject: String) -> String:
	var at := subject.find("CN=")
	if at < 0:
		return ""
	var rest := subject.substr(at + 3)
	if rest.begins_with("\""):
		var end := rest.find("\"", 1)
		return rest.substr(1, end - 1) if end > 0 else ""
	var comma := rest.find(",")
	return (rest.substr(0, comma) if comma >= 0 else rest).strip_edges()


## The update at launch: "up-to-date", "skipped" (it could not be checked or installed), "installing" (the installer is
## starting: start nothing and close) or "background" (the download goes on; BACKGROUND_NOTE).
func at_launch() -> String:
	_open_log()
	if not enabled():
		_log("no update settings in this copy: no update")
		return "skipped"
	_show("Checking for updates…")
	var latest_text := await _fetch_text(feed + "latest.yml", CHECK_TIMEOUT_S)
	if latest_text == "":
		return "skipped"
	var latest := parse_latest(latest_text)
	if latest.is_empty():
		_log("latest.yml does not read: no update")
		return "skipped"
	var current := app_version()
	if not is_newer(String(latest["version"]), current):
		_log("%s is the latest (the release says %s)" % [current, latest["version"]])
		return "up-to-date"
	var version := String(latest["version"])
	_log("%s -> %s: downloading %s" % [current, version, latest["path"]])
	var dir := OS.get_temp_dir().path_join("OpenMTG-update")
	DirAccess.make_dir_recursive_absolute(dir)
	var file := dir.path_join(String(latest["path"]))
	var outcome := await _download_to(feed + String(latest["path"]).uri_encode(), file, version)
	if outcome == "capped":
		_log("the download of %s did not finish in %d s: it goes on in the background and installs when OpenMTG closes" % [version, int(DOWNLOAD_CAP_S)])
		_finish_in_background(file, latest)
		_show(BACKGROUND_NOTE)
		return "background"
	if outcome != "":
		_log("the download of %s failed: %s; starting as it is" % [version, outcome])
		return "skipped"
	_show("Checking the update…")
	var problem := await verify(file, String(latest["sha512"]))
	if problem != "":
		_log("the download of %s did not pass its checks: %s; starting as it is" % [version, problem])
		DirAccess.remove_absolute(file)
		return "skipped"
	_show("Installing OpenMTG %s…" % version, "OpenMTG closes and opens again by itself in a few seconds.")
	await get_tree().create_timer(INSTALL_PAUSE_S).timeout
	if not run_installer(file, true):
		_log("the installer of %s did not start; starting as it is" % version)
		return "skipped"
	_log("installing %s" % version)
	return "installing"


## Runs the installer silently; `start_app`: it opens the new version when it is done. False when it could not start.
func run_installer(file: String, start_app: bool) -> bool:
	var args := PackedStringArray(["/S", "--updated"])
	if start_app:
		args.append("--force-run")
	return OS.create_process(file, args) > 0


## The installer's checks (empty when it passes): its SHA-512 is `sha512_base64` (latest.yml's), and its Authenticode signature is
## valid and signed by one of `publishers`. Windows does both (PowerShell's Get-FileHash and Get-AuthenticodeSignature), on a
## thread, so a check during a game does not stall the screen.
func verify(file: String, sha512_base64: String) -> String:
	if not FileAccess.file_exists(file):
		return "the file is missing"
	var want := Marshalls.base64_to_raw(sha512_base64).hex_encode().to_lower()
	if want.length() != 128:
		return "latest.yml's SHA-512 does not read"
	var script := "$f = $env:OPENMTG_UPDATE_FILE; $h = (Get-FileHash -Algorithm SHA512 -LiteralPath $f).Hash; " + \
		"$s = Get-AuthenticodeSignature -LiteralPath $f; " + \
		"[pscustomobject]@{ hash = [string]$h; status = [string]$s.Status; subject = [string]$s.SignerCertificate.Subject } | ConvertTo-Json -Compress"
	OS.set_environment("OPENMTG_UPDATE_FILE", ProjectSettings.globalize_path(file))
	var result := {"code": -1, "output": []}
	var thread := Thread.new()
	thread.start(func() -> void:
		var output: Array = []
		var code := OS.execute("powershell.exe", PackedStringArray(["-NoProfile", "-NonInteractive", "-Command", script]), output, false)
		result["code"] = code
		result["output"] = output)
	while thread.is_alive():
		await get_tree().process_frame
	thread.wait_to_finish()
	var text := "".join(PackedStringArray(Val.list(result, "output").map(func(o: Variant) -> String: return str(o)))).strip_edges()
	var data := Val.as_dict(JSON.parse_string(text)) if text != "" else {}
	if data.is_empty():
		return "Windows could not check the file (%s)" % text.substr(0, 200)
	if Val.text(data, "hash").to_lower() != want:
		return "its SHA-512 is not the one the release names"
	if Val.text(data, "status") != "Valid":
		return "its signature is not valid (%s)" % Val.text(data, "status")
	var name := signer_name(Val.text(data, "subject"))
	if not publishers.has(name):
		return "it is signed by \"%s\", whom this copy does not accept" % name
	return ""


## The text at `url`, or "" (logged) when it cannot be read within `timeout_s`.
func _fetch_text(url: String, timeout_s: float) -> String:
	var req := HTTPRequest.new()
	req.timeout = timeout_s
	req.max_redirects = 8
	add_child(req)
	var err := req.request(url, PackedStringArray(["Accept: */*", "User-Agent: OpenMTG/%s" % app_version()]))
	if err != OK:
		req.queue_free()
		_log("the release could not be asked (%s): no update" % error_string(err))
		return ""
	var res: Array = await req.request_completed
	req.queue_free()
	var result: int = res[0]
	var code: int = res[1]
	if result != HTTPRequest.RESULT_SUCCESS or code != 200:
		_log("no answer from the release (%s, HTTP %d): no update" % [_result_text(result), code])
		return ""
	return (res[3] as PackedByteArray).get_string_from_utf8()


## Downloads `url` to `file`: "" when done, "capped" when it is still going after DOWNLOAD_CAP_S (it goes on), or why it failed.
func _download_to(url: String, file: String, version: String) -> String:
	if FileAccess.file_exists(file):
		DirAccess.remove_absolute(file)
	_download = HTTPRequest.new()
	_download.download_file = file
	_download.max_redirects = 8
	_download.use_threads = true
	add_child(_download)
	var done := {"finished": false, "result": 0, "code": 0}
	_download.request_completed.connect(func(result: int, code: int, _h: PackedStringArray, _b: PackedByteArray) -> void:
		done["finished"] = true
		done["result"] = result
		done["code"] = code)
	var err := _download.request(url, PackedStringArray(["User-Agent: OpenMTG/%s" % app_version()]))
	if err != OK:
		_download.queue_free()
		_download = null
		return "it could not start (%s)" % error_string(err)
	_show("Updating OpenMTG to %s…" % version, "Starting the download", 0.0)
	var started := Time.get_ticks_msec()
	var last_bytes := -1
	var last_move := started
	while not bool(done["finished"]):
		await get_tree().create_timer(0.25).timeout
		var now := Time.get_ticks_msec()
		var got := _download.get_downloaded_bytes()
		var total := _download.get_body_size()
		if got != last_bytes:
			last_bytes = got
			last_move = now
			if total > 0:
				_show("Updating OpenMTG to %s…" % version, "Downloading: %d%% (%d of %d MB)" % [int(100.0 * got / total), roundi(got / MB), roundi(total / MB)], float(got) / total)
		if now - last_move > int(STALL_TIMEOUT_S * 1000.0):
			_download.cancel_request()
			_download.queue_free()
			_download = null
			return "it made no progress for %d s" % int(STALL_TIMEOUT_S)
		if now - started > int(DOWNLOAD_CAP_S * 1000.0):
			return "capped"
	var req := _download
	_download = null
	req.queue_free()
	if int(done["result"]) != HTTPRequest.RESULT_SUCCESS or int(done["code"]) != 200:
		return "%s, HTTP %d" % [_result_text(int(done["result"])), int(done["code"])]
	return ""


## A download that goes on in the background: once it finishes and passes its checks, its installer waits for the app to close.
func _finish_in_background(file: String, latest: Dictionary) -> void:
	var req := _download
	if req == null:
		return
	var res: Array = await req.request_completed
	_download = null
	req.queue_free()
	if int(res[0]) != HTTPRequest.RESULT_SUCCESS or int(res[1]) != 200:
		_log("the background download of %s failed (%s, HTTP %d)" % [latest["version"], _result_text(int(res[0])), int(res[1])])
		return
	var problem := await verify(file, String(latest["sha512"]))
	if problem != "":
		_log("the background download of %s did not pass its checks: %s" % [latest["version"], problem])
		return
	pending_installer = file
	_log("the background download of %s finished: it installs when OpenMTG closes" % latest["version"])
	progress.emit("Update ready, installs when you close OpenMTG", "", -1.0)


func _exit_tree() -> void:
	if pending_installer != "" and FileAccess.file_exists(pending_installer):
		_log("installing the update downloaded in the background")
		run_installer(pending_installer, false)


func _show(message: String, detail: String = "", fraction: float = -1.0) -> void:
	progress.emit(message, detail, fraction)


func _open_log() -> void:
	var appdata := OS.get_environment("APPDATA")
	if appdata == "":
		return
	var dir := appdata.path_join("OpenMTG")
	DirAccess.make_dir_recursive_absolute(dir)
	_log_path = dir.path_join("update.log")
	var f := FileAccess.open(_log_path, FileAccess.WRITE)
	if f != null:
		f.close()


func _log(line: String) -> void:
	if _log_path == "":
		return
	var f := FileAccess.open(_log_path, FileAccess.READ_WRITE)
	if f == null:
		return
	f.seek_end()
	f.store_line("%sZ [launch] %s" % [Time.get_datetime_string_from_system(true), line])
	f.close()


static func _result_text(result: int) -> String:
	match result:
		HTTPRequest.RESULT_CANT_CONNECT, HTTPRequest.RESULT_CANT_RESOLVE:
			return "offline"
		HTTPRequest.RESULT_TIMEOUT:
			return "no answer in time"
		HTTPRequest.RESULT_REDIRECT_LIMIT_REACHED:
			return "too many redirects"
		HTTPRequest.RESULT_DOWNLOAD_FILE_CANT_OPEN, HTTPRequest.RESULT_DOWNLOAD_FILE_WRITE_ERROR:
			return "the file could not be written"
		HTTPRequest.RESULT_SUCCESS:
			return "answered"
	return "request error %d" % result
