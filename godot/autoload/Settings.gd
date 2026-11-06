extends Node
## The player's settings (packages/client/src/settings/settings.ts, profiles/profiles.ts), kept in user://settings.cfg and the
## looks in user://profiles.json (autoload "Settings", loaded first). Every change is saved at once and announced with
## `changed`; a change of look re-colours the shared theme (theme/neon_grid.tres), sets the text size and the backgrounds,
## and emits `colors_changed`.
##
## Defaults as the browser's: Scryfall pictures on, the Arena-like stops, full control off, animation speed normal, sound on
## with master 80 %, interface 80 %, game 100 %, ambience 60 %, players "Player 1" to "Player 4", the shared table with the
## camera following the mouse. Looks: the Neon Grid template (read-only), or a saved profile of it (its colours, text size,
## the grid floor behind every screen, moving backgrounds); at most MAX_PROFILES.

signal changed(key: String)
signal colors_changed(neon: Color, neon2: Color)

const PATH: String = "user://settings.cfg"
const PROFILES_PATH: String = "user://profiles.json"
const SPEEDS: Array[String] = ["off", "fast", "normal", "slow"]
const LAYOUTS: Array[String] = ["shared", "acrossTop", "focused"]
const TEXT_SIZES: Array[float] = [0.9, 1.0, 1.1, 1.2, 1.3]
const THEME_PATH: String = "res://theme/neon_grid.tres"
const MAX_NAME_LENGTH: int = 24
const MAX_PROFILES: int = 40
const MAX_PROFILE_NAME: int = 32
const TEMPLATE_ID: String = "template:neonGrid"
const TEMPLATE_NAME: String = "Neon Grid"
const DEFAULT_NAMES: Array[String] = ["Player 1", "Player 2", "Player 3", "Player 4"]

var animation_speed: String = "normal"
var sound_on: bool = true
## The master volume, 0.0 .. 1.0 (the others below are the three kinds of sound).
var sound_volume: float = 0.8
var volume_interface: float = 0.8
var volume_game: float = 1.0
var volume_ambience: float = 0.6
## On by default, as in the browser client: pictures come from Scryfall unless the player turns them off.
var scryfall_images: bool = true
## The folder of the player's own card pictures ("" when none): matched to cards by the server's POST /api/images/match.
## Reduced motion: every change is shown at once, as with animations off (sounds play condensed), and backgrounds stay still.
var reduced_motion: bool = false
## The steps the player stops in during their own turn and the opponents' turns (StopSettings for new games).
var stops_own: Array[String] = []
var stops_opponent: Array[String] = []
var full_control: bool = false
## How a game of three or four players is drawn, and whether the shared table's camera follows the mouse.
var table_layout: String = "shared"
var camera_follow: bool = true
## The names the New game screen starts with.
var player_names: Array[String] = DEFAULT_NAMES.duplicate()
## The look now (the active profile's): its colours, text size, grid floor and moving backgrounds.
var color_preset: String = "DigiDice"
var neon: Color = NeonTheme.preset_colors("DigiDice")[0]
var neon2: Color = NeonTheme.preset_colors("DigiDice")[1]
var text_size: float = 1.0
var look_scene: bool = true
var look_motion: bool = true
## The saved looks: [{id, name, look: {template, colors: {neon, neon2}, textSize, motion, scene}}], and the active one's id.
var profiles: Array[Dictionary] = []
var active_profile: String = TEMPLATE_ID

var _file := ConfigFile.new()


func _ready() -> void:
	stops_own.assign(Config.DEFAULT_STOPS["ownTurn"])
	stops_opponent.assign(Config.DEFAULT_STOPS["opponentTurn"])
	load_settings()
	_load_profiles()
	_apply_look()


func load_settings() -> void:
	if _file.load(PATH) != OK:
		return
	var speed: String = Val.as_text(_file.get_value("table", "animation_speed", animation_speed), animation_speed)
	animation_speed = speed if SPEEDS.has(speed) else "normal"
	sound_on = Val.as_bool(_file.get_value("sound", "on", sound_on), sound_on)
	sound_volume = _unit(_file.get_value("sound", "volume", sound_volume), sound_volume)
	volume_interface = _unit(_file.get_value("sound", "interface", volume_interface), volume_interface)
	volume_game = _unit(_file.get_value("sound", "game", volume_game), volume_game)
	volume_ambience = _unit(_file.get_value("sound", "ambience", volume_ambience), volume_ambience)
	scryfall_images = Val.as_bool(_file.get_value("pictures", "scryfall", scryfall_images), scryfall_images)
	reduced_motion = Val.as_bool(_file.get_value("table", "reduced_motion", reduced_motion), reduced_motion)
	var own: Variant = _file.get_value("stops", "own") if _file.has_section_key("stops", "own") else null
	if own is Array:
		stops_own = _steps(own)
	var opp: Variant = _file.get_value("stops", "opponent") if _file.has_section_key("stops", "opponent") else null
	if opp is Array:
		stops_opponent = _steps(opp)
	full_control = Val.as_bool(_file.get_value("stops", "full_control", full_control), full_control)
	var layout: String = Val.as_text(_file.get_value("table", "layout", table_layout), table_layout)
	table_layout = layout if LAYOUTS.has(layout) else "shared"
	camera_follow = Val.as_bool(_file.get_value("table", "camera_follow", camera_follow), camera_follow)
	var names: Variant = _file.get_value("players", "names", []) if _file.has_section_key("players", "names") else []
	if names is Array:
		for i: int in 4:
			player_names[i] = _clean_name(Val.as_text((names as Array)[i] if i < (names as Array).size() else "", ""), i)


## The desktop app's settings ("openmtg.settings.v1": animationSpeed, sound, showScryfallImages, stops, fullControl,
## tableLayout, cameraFollow, playerNames) as this app's; what is missing or out of range keeps its value.
func apply_desktop_settings(s: Dictionary) -> void:
	var speed := Val.text(s, "animationSpeed", animation_speed)
	animation_speed = speed if SPEEDS.has(speed) else animation_speed
	var sound := Val.dict(s, "sound")
	sound_on = Val.flag(sound, "enabled", sound_on)
	sound_volume = _unit(sound.get("master", sound_volume), sound_volume)
	volume_interface = _unit(sound.get("interface", volume_interface), volume_interface)
	volume_game = _unit(sound.get("game", volume_game), volume_game)
	volume_ambience = _unit(sound.get("ambience", volume_ambience), volume_ambience)
	scryfall_images = Val.flag(s, "showScryfallImages", scryfall_images)
	var stops := Val.dict(s, "stops")
	if stops.get("ownTurn") is Array:
		stops_own = _steps(stops["ownTurn"])
	if stops.get("opponentTurn") is Array:
		stops_opponent = _steps(stops["opponentTurn"])
	full_control = Val.flag(s, "fullControl", full_control)
	var layout := Val.text(s, "tableLayout", table_layout)
	table_layout = layout if LAYOUTS.has(layout) else table_layout
	camera_follow = Val.flag(s, "cameraFollow", camera_follow)
	var names := Val.list(s, "playerNames")
	for i: int in mini(4, names.size()):
		player_names[i] = _clean_name(Val.as_text(names[i], ""), i)


## Whether this app has settings and look profiles of its own yet (none at its first start).
func has_own_settings() -> bool:
	return FileAccess.file_exists(PATH) and FileAccess.file_exists(PROFILES_PATH)


## The desktop app's settings and look profiles, as it left them in the server's settings store (its "desktop" entry: the
## browser storage's "openmtg.settings.v1" and "openmtg.profiles.v1"), become this app's where it has none of its own yet.
## Returns whether anything was taken.
func adopt_desktop(desktop: Dictionary) -> bool:
	var took := false
	var s := Val.dict(desktop, "openmtg.settings.v1")
	if not s.is_empty() and not FileAccess.file_exists(PATH):
		apply_desktop_settings(s)
		save_settings()
		took = true
	var p := Val.dict(desktop, "openmtg.profiles.v1")
	if not p.is_empty() and not FileAccess.file_exists(PROFILES_PATH):
		var f := FileAccess.open(PROFILES_PATH, FileAccess.WRITE)
		if f != null:
			f.store_string(JSON.stringify(p))
			f.close()
			profiles.clear()
			_load_profiles()
			_save_profiles()
			_apply_look()
			took = true
	return took


func save_settings() -> void:
	_file.set_value("table", "animation_speed", animation_speed)
	_file.set_value("sound", "on", sound_on)
	_file.set_value("sound", "volume", sound_volume)
	_file.set_value("sound", "interface", volume_interface)
	_file.set_value("sound", "game", volume_game)
	_file.set_value("sound", "ambience", volume_ambience)
	_file.set_value("pictures", "scryfall", scryfall_images)
	_file.set_value("table", "reduced_motion", reduced_motion)
	_file.set_value("table", "layout", table_layout)
	_file.set_value("table", "camera_follow", camera_follow)
	_file.set_value("stops", "own", stops_own)
	_file.set_value("stops", "opponent", stops_opponent)
	_file.set_value("stops", "full_control", full_control)
	_file.set_value("players", "names", player_names)
	var err := _file.save(PATH)
	if err != OK:
		push_warning("Settings could not be saved (%s)." % error_string(err))


func set_animation_speed(speed: String) -> void:
	if not SPEEDS.has(speed):
		return
	animation_speed = speed
	_changed("animation_speed")


## Sound on or off and the master volume (0..1).
func set_sound(on: bool, volume: float) -> void:
	sound_on = on
	sound_volume = clampf(volume, 0.0, 1.0)
	_changed("sound")


## One kind of sound's volume: "interface", "game" or "ambience".
func set_volume(kind: String, volume: float) -> void:
	var v := clampf(volume, 0.0, 1.0)
	match kind:
		"interface":
			volume_interface = v
		"game":
			volume_game = v
		"ambience":
			volume_ambience = v
		_:
			sound_volume = v
	_changed("sound")


func set_scryfall_images(on: bool) -> void:
	scryfall_images = on
	_changed("scryfall_images")



func set_reduced_motion(on: bool) -> void:
	reduced_motion = on
	_changed("reduced_motion")


## Whether changes are animated: animation speed not Off and no reduced motion.
func animates() -> bool:
	return animation_speed != "off" and not reduced_motion


## Whether the backgrounds move (the look's "Moving backgrounds", and no reduced motion).
func backgrounds_move() -> bool:
	return look_motion and not reduced_motion


func set_stops(own: Array, opponent: Array, full: bool = false) -> void:
	stops_own = _steps(own)
	stops_opponent = _steps(opponent)
	full_control = full
	_changed("stops")


func set_table_layout(layout: String) -> void:
	if LAYOUTS.has(layout):
		table_layout = layout
		_changed("table_layout")


func set_camera_follow(on: bool) -> void:
	camera_follow = on
	_changed("camera_follow")


## Player `i`'s default name: trimmed, at most 24 characters; empty gives back "Player <i + 1>".
func set_player_name(i: int, player_name: String) -> void:
	if i < 0 or i > 3:
		return
	player_names[i] = _clean_name(player_name, i)
	_changed("player_names")


## Every setting back to its default (the looks are left alone).
func restore_defaults() -> void:
	animation_speed = "normal"
	sound_on = true
	sound_volume = 0.8
	volume_interface = 0.8
	volume_game = 1.0
	volume_ambience = 0.6
	scryfall_images = true
	reduced_motion = false
	stops_own.assign(Config.DEFAULT_STOPS["ownTurn"])
	stops_opponent.assign(Config.DEFAULT_STOPS["opponentTurn"])
	full_control = false
	table_layout = "shared"
	camera_follow = true
	player_names = DEFAULT_NAMES.duplicate()
	_changed("all")


## The stops of a new game, as the engine's StopSettings ({ownTurn, opponentTurn, fullControl}).
func stop_settings() -> Dictionary:
	return {"ownTurn": stops_own.duplicate(), "opponentTurn": stops_opponent.duplicate(), "fullControl": full_control}


## How long animations take relative to "normal" (0 means none). Read by the animator (fx/Animator.gd) at every change.
func speed_factor() -> float:
	match animation_speed:
		"off":
			return 0.0
		"fast":
			return 0.6
		"slow":
			return 1.7
		_:
			return 1.0


# ---- looks (profiles) -----------------------------------------------------------------------------------------------------

## The Neon Grid template's look.
static func template_look() -> Dictionary:
	var c := NeonTheme.preset_colors("DigiDice")
	return {"template": "neonGrid", "colors": {"neon": "#" + c[0].to_html(false), "neon2": "#" + c[1].to_html(false)}, "textSize": 1.0,
		"motion": true, "scene": true}


## The active profile: {id, name, look, builtIn}.
func active() -> Dictionary:
	for p: Dictionary in profiles:
		if String(p["id"]) == active_profile:
			return p
	return {"id": TEMPLATE_ID, "name": TEMPLATE_NAME, "look": template_look(), "builtIn": true}


func is_template_active() -> bool:
	return active_profile == TEMPLATE_ID or active().get("builtIn", false)


func use_profile(id: String) -> void:
	active_profile = id if id == TEMPLATE_ID or _profile_index(id) >= 0 else TEMPLATE_ID
	_save_profiles()
	_apply_look()
	changed.emit("look")


## A name made unique (case-insensitive) among the template and the saved profiles: " (2)", " (3)", ... with the base cut so
## the whole stays within MAX_PROFILE_NAME. `except` is a profile id that may keep its own name.
func unique_name(wanted: String, except: String = "") -> String:
	var base := clean_profile_name(wanted, TEMPLATE_NAME)
	var taken: Dictionary = {TEMPLATE_NAME.to_lower(): true}
	for p: Dictionary in profiles:
		if String(p["id"]) != except:
			taken[String(p["name"]).to_lower()] = true
	if not taken.has(base.to_lower()):
		return base
	var n := 2
	while true:
		var suffix := " (%d)" % n
		var candidate := base.substr(0, MAX_PROFILE_NAME - suffix.length()).strip_edges() + suffix
		if not taken.has(candidate.to_lower()):
			return candidate
		n += 1
	return base


static func clean_profile_name(raw: String, fallback: String) -> String:
	var words := " ".join(raw.strip_edges().split(" ", false)).replace("\t", " ").replace("\n", " ")
	words = words.substr(0, MAX_PROFILE_NAME).strip_edges()
	return words if words != "" else fallback


## Save the active look as a new profile and load it; "" when there is no room.
func save_as_profile(profile_name: String) -> String:
	if profiles.size() >= MAX_PROFILES:
		return ""
	var p := {"id": _new_id(), "name": unique_name(profile_name), "look": (active()["look"] as Dictionary).duplicate(true)}
	profiles.append(p)
	use_profile(String(p["id"]))
	return String(p["name"])


func rename_profile(id: String, new_name: String) -> void:
	var i := _profile_index(id)
	if i < 0:
		return
	var cleaned := clean_profile_name(new_name, String(profiles[i]["name"]))
	if cleaned == String(profiles[i]["name"]):
		return
	profiles[i]["name"] = unique_name(cleaned, id)
	_save_profiles()
	changed.emit("look")


## Delete a profile: the template takes its place.
func delete_profile(id: String) -> void:
	var i := _profile_index(id)
	if i < 0:
		return
	profiles.remove_at(i)
	if active_profile == id:
		active_profile = TEMPLATE_ID
	_save_profiles()
	_apply_look()
	changed.emit("look")


## Change the active saved profile's look: any of colors {neon, neon2}, textSize, motion, scene.
func update_look(changes: Dictionary) -> void:
	var i := _profile_index(active_profile)
	if i < 0:
		return
	var look: Dictionary = profiles[i]["look"]
	for k: String in changes:
		if k == "colors":
			var colors: Dictionary = look["colors"]
			for c: String in changes["colors"]:
				colors[c] = String(changes["colors"][c])
		else:
			look[k] = changes[k]
	look["textSize"] = _snap_text(float(look.get("textSize", 1.0)))
	_save_profiles()
	_apply_look()
	changed.emit("look")


## The active profile's look as a file (.openmtg-profile.json): {openmtgProfile: 1, name, look}.
func export_profile() -> String:
	var p := active()
	return JSON.stringify({"openmtgProfile": 1, "name": p["name"], "look": p["look"]}, "  ")


## Import a profile file; "" and the reason when it is not one, else the loaded name.
func import_profile(text: String) -> Array:
	if profiles.size() >= MAX_PROFILES:
		return ["", "You already have %d profiles; delete one first." % MAX_PROFILES]
	var data := Val.as_dict(JSON.parse_string(text))
	if int(Val.num(data, "openmtgProfile")) != 1:
		return ["", "That file is not an OpenMTG profile."]
	var p := {"id": _new_id(), "name": unique_name(clean_profile_name(Val.text(data, "name"), TEMPLATE_NAME)),
		"look": _clean_look(Val.dict(data, "look"))}
	profiles.append(p)
	use_profile(String(p["id"]))
	return [String(p["name"]), ""]


## Back to the template's colours, text size and backgrounds (the active saved profile).
func reset_look() -> void:
	var i := _profile_index(active_profile)
	if i < 0:
		return
	profiles[i]["look"] = template_look()
	_save_profiles()
	_apply_look()
	changed.emit("look")


func _profile_index(id: String) -> int:
	for i: int in profiles.size():
		if String(profiles[i]["id"]) == id:
			return i
	return -1


static func _new_id() -> String:
	var t := Time.get_unix_time_from_system() * 1000.0
	var chars := "0123456789abcdefghijklmnopqrstuvwxyz"
	var out := ""
	var n := int(t)
	while n > 0:
		out = chars[n % 36] + out
		n /= 36
	for i: int in 4:
		out += chars[randi() % 36]
	return "p-" + out


func _clean_look(look: Dictionary) -> Dictionary:
	var base := template_look()
	var colors: Dictionary = base["colors"]
	for k: String in ["neon", "neon2"]:
		var c := Val.text(Val.dict(look, "colors"), k)
		if c.length() == 4 and c.begins_with("#"):
			c = "#" + c[1] + c[1] + c[2] + c[2] + c[3] + c[3]
		if c.length() == 7 and c.begins_with("#") and Color.html_is_valid(c):
			colors[k] = c.to_lower()
	return {"template": "neonGrid", "colors": colors, "textSize": _snap_text(Val.num(look, "textSize", 1.0)),
		"motion": not (look.get("motion") is bool and look["motion"] == false),
		"scene": not (look.get("scene") is bool and look["scene"] == false)}


static func _snap_text(v: float) -> float:
	var best := 1.0
	for s: float in TEXT_SIZES:
		if absf(s - v) < absf(best - v):
			best = s
	return best


func _load_profiles() -> void:
	if not FileAccess.file_exists(PROFILES_PATH):
		return
	var data := Val.as_dict(JSON.parse_string(FileAccess.get_file_as_string(PROFILES_PATH)))
	var seen: Dictionary = {}
	for p: Variant in Val.list(data, "profiles"):
		var pd := Val.as_dict(p)
		var id := Val.text(pd, "id")
		if not id.begins_with("p-") or seen.has(id) or profiles.size() >= MAX_PROFILES:
			continue
		seen[id] = true
		profiles.append({"id": id, "name": clean_profile_name(Val.text(pd, "name"), TEMPLATE_NAME), "look": _clean_look(Val.dict(pd, "look"))})
	var want := Val.text(data, "activeId", TEMPLATE_ID)
	active_profile = want if want == TEMPLATE_ID or seen.has(want) else TEMPLATE_ID


func _save_profiles() -> void:
	var f := FileAccess.open(PROFILES_PATH, FileAccess.WRITE)
	if f == null:
		push_warning("Profiles could not be saved.")
		return
	f.store_string(JSON.stringify({"activeId": active_profile, "profiles": profiles}, " "))
	f.close()


## Apply the active look: colours to the shared theme, the text size, the backgrounds.
func _apply_look() -> void:
	var look: Dictionary = active()["look"]
	var colors: Dictionary = look["colors"]
	neon = Color.html(String(colors.get("neon", "#1fb8ff")))
	neon2 = Color.html(String(colors.get("neon2", "#f500f5")))
	color_preset = "Custom"
	for preset: String in NeonTheme.PRESET_ORDER:
		var pc := NeonTheme.preset_colors(preset)
		if pc[0].is_equal_approx(neon) and pc[1].is_equal_approx(neon2):
			color_preset = preset
	text_size = float(look.get("textSize", 1.0))
	look_scene = bool(look.get("scene", true))
	look_motion = bool(look.get("motion", true))
	var theme := load(THEME_PATH) as Theme
	if theme != null:
		NeonTheme.apply(theme, neon, neon2)
	if is_inside_tree():
		get_tree().root.content_scale_factor = text_size
	colors_changed.emit(neon, neon2)


## Kept for the colour presets of the look panel: the active saved profile takes both colours.
func set_preset(preset_name: String) -> void:
	var colors := NeonTheme.preset_colors(preset_name)
	update_look({"colors": {"neon": "#" + colors[0].to_html(false), "neon2": "#" + colors[1].to_html(false)}})


func set_colors(first: Color, second: Color) -> void:
	update_look({"colors": {"neon": "#" + first.to_html(false), "neon2": "#" + second.to_html(false)}})


func _steps(list: Array) -> Array[String]:
	var out: Array[String] = []
	for s: Variant in list:
		if s is String and Config.STEP_ORDER.has(s) and not out.has(s):
			out.append(s)
	return out


func _clean_name(raw: String, i: int) -> String:
	var n := raw.strip_edges().substr(0, MAX_NAME_LENGTH)
	return n if n != "" else DEFAULT_NAMES[i]


static func _unit(v: Variant, fallback: float) -> float:
	return clampf(Val.as_float(v, fallback), 0.0, 1.0)


func _changed(key: String) -> void:
	save_settings()
	changed.emit(key)
