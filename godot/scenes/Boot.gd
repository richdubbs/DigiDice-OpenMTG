class_name BootScreen
extends Control
## The first screen: updates the app when a newer release is out (Updater, before anything else starts), starts the game server
## (Server.start), shows what it is doing, downloads the card data on the first run (POST /api/update, progress from GET
## /api/update), then opens Home.

const HOME_SCENE: String = "res://scenes/Home.tscn"

@onready var _status: Label = %Status
@onready var _progress: ProgressBar = %Progress
@onready var _retry: Button = %Retry

var _moving_on: bool = false


func _ready() -> void:
	_retry.pressed.connect(_on_retry)
	Server.server_ready.connect(_on_server_ready)
	Server.failed.connect(_on_failed)
	Server.output.connect(_on_output)
	_progress.value = 0.0
	if Server.is_ready:
		_on_server_ready(Server.port, Server.token)
		return
	if Updater.enabled():
		Updater.progress.connect(_on_update_progress)
		var outcome: String = await Updater.at_launch()
		Updater.progress.disconnect(_on_update_progress)
		# The installer is starting: it opens the new version by itself.
		if outcome == "installing":
			get_tree().quit()
			return
	_progress.value = 0.0
	_status.text = "Starting the game server…"
	Server.start()


func _on_update_progress(message: String, detail: String, fraction: float) -> void:
	_status.text = message if detail == "" else "%s\n%s" % [message, detail]
	if fraction >= 0.0:
		_progress.max_value = 1.0
		_progress.value = fraction


func _on_output(line: String) -> void:
	if not _moving_on and not Server.is_ready:
		_status.text = line.substr(0, 160)


func _on_failed(message: String) -> void:
	_status.text = message
	_retry.visible = true


func _on_retry() -> void:
	_retry.visible = false
	_status.text = "Starting the game server…"
	Server.start()


func _on_server_ready(_port: int, _token: String) -> void:
	if _moving_on:
		return
	_moving_on = true
	await _ensure_card_data()
	await _adopt_desktop()
	get_tree().change_scene_to_file(HOME_SCENE)


## The first start after the desktop app: the settings and look profiles it left in the server's store become this app's (its
## decks, pictures and replays are in the server's library already).
func _adopt_desktop() -> void:
	if Settings.has_own_settings():
		return
	var r: Dictionary = await Server.get_json("/api/library/settings")
	var desktop := Val.dict(Val.dict(Val.as_dict(r.get("data")), "settings"), "desktop")
	if not desktop.is_empty() and Settings.adopt_desktop(desktop):
		_status.text = "Your settings from the earlier OpenMTG are in place."


## First run: the server has no card data yet (GET /api/status says cardData null). Start the update and show its progress.
func _ensure_card_data() -> void:
	_status.text = "Checking the card data…"
	var st: Dictionary = await Server.get_json("/api/status")
	var data := Val.as_dict(st.get("data"))
	if not Val.flag(st, "ok") or not Val.dict(data, "cardData").is_empty():
		return
	_status.text = "Loading the card data (first run). This takes a few minutes."
	await Server.post_json("/api/update", {}) # 409 "an update is already running" is fine: we follow that one
	while is_inside_tree():
		await get_tree().create_timer(1.0).timeout
		var u: Dictionary = await Server.get_json("/api/update")
		var job := Val.dict(Val.as_dict(u.get("data")), "job")
		if job.is_empty():
			return
		var prog := Val.dict(job, "progress")
		if not prog.is_empty():
			_progress.max_value = maxf(1.0, Val.real(prog, "total"))
			_progress.value = Val.real(prog, "done")
		var lines := Val.texts(job, "log")
		if not lines.is_empty():
			_status.text = lines[lines.size() - 1].substr(0, 160)
		if Val.text(job, "state") != "running":
			if Val.text(job, "state") == "failed":
				_status.text = "The card data could not be loaded: %s" % Val.text(job, "error", "unknown error")
				await get_tree().create_timer(3.0).timeout
			return
