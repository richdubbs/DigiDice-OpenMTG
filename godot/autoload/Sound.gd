extends Node
## The game's sounds (autoload "Sound"). The local server renders the 113 synthesized sounds
## of packages/client/src/audio/catalog.ts once, with the same DSP code the browser uses, and serves them:
##   GET /api/sounds/manifest              -> {version, hash, rate: 48000, sounds: [{id, variants, lengthMs, loop?: true}]}
##   GET /api/sounds/<id>/<variant>.wav    -> 16-bit stereo 48 kHz PCM WAV, ETag "<hash>-<id>-<variant>" (304 to a matching
##                                            If-None-Match); 404 for an unknown id or variant
## (the TypeScript source's packages/server/src/sounds/api.ts; a URL never carries "#"). When the table channel connects (and when the
## server is ready) this node reads the manifest, downloads the WAVs it does not have yet into user://sounds/<hash>/ (a few at
## a time, HTTPRequest nodes), loads them as AudioStreamWAV (a few per frame, never one big stall) and plays them through
## AudioStreamPlayer2D nodes at the event's position on the table, so the left-right pan comes from the table's Camera2D for free.
## No synthesis here, no per-sound stall. A sound problem never breaks or delays anything: a sound
## that is not there yet is simply not heard. A file already on disk is loaded at once and checked with the server afterwards
## (If-None-Match with its ETag: 304 means it is up to date; a 200 replaces it and it is loaded again).
##
## API (the animator calls `cue` at the beats fx/sounds.gd names):
##   cue(id, at = null, gain = 1.0, delay_s = 0.0, offset_s = 0.0)   at: a Vector2 on the table (global canvas position), or null
##   play_cues(cues, at = null)                                    cues: [{id, gain?, delay?}] (SoundCues.event_cues ...)
##   since(id) -> float                                            ms since `id` last started (INF when never)
##   accent_of(id) -> float                                        seconds into the sound of its accent (-1 when none)
##   hold_ambience() / release_ambience()                          the table's ambience loop ("ambient.grid") while held
## Volume and mute come from Settings (the master bus).

signal sounds_ready()

const CACHE_ROOT: String = "user://sounds"
const MANIFEST_PATH: String = "/api/sounds/manifest"
const DOWNLOADS_AT_ONCE: int = 4
const LOADS_PER_FRAME: int = 6
const PLAYERS_2D: int = 24
const PLAYERS_FLAT: int = 8
const AMBIENCE_ID: String = "ambient.grid"
const BUSES: Array[String] = ["Interface", "Game", "Ambience"]
const AMBIENCE_FADE_IN_S: float = 1.5
const AMBIENCE_FADE_OUT_S: float = 0.8
## The ambience sits well under the game sounds (catalog.ts: -36 LUFS against about -20).
const AMBIENCE_DB: float = 0.0

## The manifest's catalog hash ("" until read), its render version and the sample rate of its WAVs.
var catalog_hash: String = ""
var catalog_version: int = 0
var catalog_rate: int = 0
## id -> {variants: int, lengthMs: int, loop: bool}
var _meta: Dictionary = {}
## "id/variant" (`_key`) -> AudioStreamWAV
var _streams: Dictionary = {}
## Files on disk waiting to be loaded: [{id, variant, path}]
var _to_load: Array[Dictionary] = []
## Files to request: [{id, variant, path, check}]; `check`: the file is on disk already and is only revalidated (If-None-Match).
## The missing files come first.
var _to_fetch: Array[Dictionary] = []
## Paths checked with the server (or downloaded) since the catalog was read: not revalidated again on a reconnect.
var _checked: Dictionary = {}
var _requests: Array[HTTPRequest] = []
var _busy: Dictionary = {} # HTTPRequest -> {id, variant, path}
var _players: Array[AudioStreamPlayer2D] = []
var _flat: Array[AudioStreamPlayer] = []
var _next_2d: int = 0
var _next_flat: int = 0
var _ambience: AudioStreamPlayer = null
var _ambience_users: int = 0
var _ambience_tween: Tween = null
var _started: Dictionary = {} # id -> msec it (last) started
## The game's cues are dropped while this is set (a replay above 4x with "Mute sound above 4x"); the ambience goes on.
var game_muted: bool = false
## Nor before this time (msec): a replay's jump is shown without sound.
var _quiet_until: int = 0
var _last_variant: Dictionary = {}
var _reading: bool = false
var _announced: bool = false


func _ready() -> void:
	process_mode = Node.PROCESS_MODE_ALWAYS
	for i: int in range(PLAYERS_2D):
		var p := AudioStreamPlayer2D.new()
		# The whole table is in earshot: a little softer far from the camera, panned by where it is.
		p.max_distance = 6000.0
		p.attenuation = 0.25
		add_child(p)
		_players.append(p)
	for i: int in range(PLAYERS_FLAT):
		var f := AudioStreamPlayer.new()
		add_child(f)
		_flat.append(f)
	_ambience = AudioStreamPlayer.new()
	_ambience.volume_db = -80.0
	add_child(_ambience)
	# The three kinds of sound have their own buses under the master (audio/engine.ts): interface (ui.*, deck.*), game, ambience.
	for bus: String in BUSES:
		if AudioServer.get_bus_index(bus) < 0:
			AudioServer.add_bus()
			var i := AudioServer.bus_count - 1
			AudioServer.set_bus_name(i, bus)
			AudioServer.set_bus_send(i, "Master")
	_ambience.bus = "Ambience"
	for i: int in range(DOWNLOADS_AT_ONCE):
		var r := HTTPRequest.new()
		r.timeout = 60.0
		r.use_threads = true
		add_child(r)
		r.request_completed.connect(_on_fetched.bind(r))
		_requests.append(r)
	Settings.changed.connect(_on_settings_changed)
	_apply_volume()
	Server.server_ready.connect(func(_port: int, _token: String) -> void: load_manifest())
	GameClient.connected.connect(load_manifest)
	if Server.is_ready:
		load_manifest()


# ---- playing ------------------------------------------------------------------------------------------------------------------

## Play `id` (a catalog sound id) at `at` (a Vector2 on the table, or null for no position), `gain` (linear), after `delay_s`
## seconds, starting `offset_s` seconds into the sound. Never fails: an unknown or missing sound is not heard.
func cue(id: String, at: Variant = null, gain: float = 1.0, delay_s: float = 0.0, offset_s: float = 0.0) -> void:
	if id == "" or not Settings.sound_on or game_muted or Time.get_ticks_msec() < _quiet_until:
		return
	_started[id] = Time.get_ticks_msec() + int(maxf(0.0, delay_s) * 1000.0)
	if delay_s > 0.0:
		get_tree().create_timer(delay_s).timeout.connect(_play_now.bind(id, at, gain, offset_s))
	else:
		_play_now(id, at, gain, offset_s)


## Hold the game's cues back for `ms` (a replay's jump).
func quiet_for(ms: int) -> void:
	_quiet_until = maxi(_quiet_until, Time.get_ticks_msec() + ms)


## Play a list of cues ({id, gain?, delay?}, as SoundCues makes them) at one place.
func play_cues(cues: Array, at: Variant = null) -> void:
	for c: Variant in cues:
		var d := Val.as_dict(c)
		cue(Val.text(d, "id"), at, Val.real(d, "gain", 1.0), Val.real(d, "delay"))


## Milliseconds since `id` last started (negative while it is still scheduled); INF when it never played.
func since(id: String) -> float:
	if not _started.has(id):
		return INF
	return float(Time.get_ticks_msec() - int(_started[id]))


## Seconds into `id` of its main accent (-1 when none): the manifest's `accent` when it carries one, else the catalog's
## (SoundCues.ACCENTS).
func accent_of(id: String) -> float:
	var from_manifest := Val.real(Val.dict(_meta, id), "accent", -1.0)
	if from_manifest >= 0.0:
		return from_manifest
	return float(SoundCues.ACCENTS.get(id, -1.0))


## Forget when sounds played (a new game).
func reset_clock() -> void:
	_started.clear()


## Whether a sound is loaded (tests, the settings screen).
func has_sound(id: String) -> bool:
	return _streams.has(_key(id, 0))


## The table's ambience plays while at least one holder wants it.
func hold_ambience() -> void:
	_ambience_users += 1
	if _ambience_users == 1:
		_start_ambience()


func release_ambience() -> void:
	if _ambience_users == 0:
		return
	_ambience_users -= 1
	if _ambience_users == 0:
		_stop_ambience()


func _play_now(id: String, at: Variant, gain: float, offset_s: float) -> void:
	var stream := _stream_for(id)
	if stream == null or not Settings.sound_on:
		return
	var db := linear_to_db(maxf(gain, 0.0001))
	var from := clampf(offset_s, 0.0, maxf(0.0, stream.get_length() - 0.01))
	if at is Vector2:
		var p := _players[_next_2d]
		_next_2d = (_next_2d + 1) % _players.size()
		p.stop()
		p.bus = bus_of(id)
		p.global_position = at
		p.stream = stream
		p.volume_db = db
		p.play(from)
	else:
		var f := _flat[_next_flat]
		_next_flat = (_next_flat + 1) % _flat.size()
		f.stop()
		f.bus = bus_of(id)
		f.stream = stream
		f.volume_db = db
		f.play(from)


## A variant of `id` (never the same one twice in a row when there are several), loaded now if it is on disk but not loaded yet.
func _stream_for(id: String) -> AudioStreamWAV:
	var n: int = maxi(1, Val.num(Val.dict(_meta, id), "variants", 1))
	var v: int = 0
	if n > 1:
		v = randi() % n
		if v == int(_last_variant.get(id, -1)):
			v = (v + 1) % n
	_last_variant[id] = v
	var key := _key(id, v)
	if not _streams.has(key):
		var path := _path(id, v)
		if catalog_hash != "" and FileAccess.file_exists(path):
			_load_file(id, v, path)
		if not _streams.has(key) and _streams.has(_key(id, 0)):
			key = _key(id, 0)
	return _streams.get(key) as AudioStreamWAV


func _start_ambience() -> void:
	var stream := _streams.get(_key(AMBIENCE_ID, 0)) as AudioStreamWAV
	if stream == null or not Settings.sound_on:
		return # started once it is loaded (_load_file)
	if _ambience_tween != null:
		_ambience_tween.kill()
	if not _ambience.playing:
		_ambience.stream = stream
		_ambience.volume_db = -60.0
		_ambience.play()
	_ambience_tween = create_tween()
	_ambience_tween.tween_property(_ambience, "volume_db", AMBIENCE_DB, AMBIENCE_FADE_IN_S)


func _stop_ambience() -> void:
	if _ambience_tween != null:
		_ambience_tween.kill()
	if not _ambience.playing:
		return
	_ambience_tween = create_tween()
	_ambience_tween.tween_property(_ambience, "volume_db", -60.0, AMBIENCE_FADE_OUT_S)
	_ambience_tween.tween_callback(_ambience.stop)


func _on_settings_changed(key: String) -> void:
	if key == "sound":
		_apply_volume()
		if Settings.sound_on and _ambience_users > 0 and not _ambience.playing:
			_start_ambience()


## Volume and mute on the master bus and each kind's bus, with the browser's squared taper (a slider at 80 % plays at 0.64).
func _apply_volume() -> void:
	AudioServer.set_bus_volume_db(0, linear_to_db(maxf(Settings.sound_volume * Settings.sound_volume, 0.0001)))
	AudioServer.set_bus_mute(0, not Settings.sound_on or Settings.sound_volume <= 0.0)
	var levels := {"Interface": Settings.volume_interface, "Game": Settings.volume_game, "Ambience": Settings.volume_ambience}
	for bus: String in levels:
		var i := AudioServer.get_bus_index(bus)
		if i >= 0:
			var v: float = levels[bus]
			AudioServer.set_bus_volume_db(i, linear_to_db(maxf(v * v, 0.0001)))
			AudioServer.set_bus_mute(i, v <= 0.0)


## The bus of a sound id: Interface for ui.* and deck.*, Ambience for the table's loop, Game for the rest.
static func bus_of(id: String) -> String:
	if id.begins_with("ui.") or id.begins_with("deck."):
		return "Interface"
	return "Ambience" if id == AMBIENCE_ID else "Game"


# ---- the manifest, the downloads, the loads -------------------------------------------------------------------------------------

## Read the manifest and fetch what is missing. Safe to call again (a server restart).
func load_manifest() -> void:
	if _reading:
		return
	_reading = true
	var r: Dictionary = await Server.get_json(MANIFEST_PATH)
	_reading = false
	if not Val.flag(r, "ok"):
		push_warning("Sounds: no manifest from the server (%s)." % Val.text(r, "error"))
		return
	var data := Val.as_dict(r.get("data"))
	var hash_text := _safe_name(Val.text(data, "hash"))
	if hash_text == "":
		push_warning("Sounds: the manifest has no hash.")
		return
	var changed := hash_text != catalog_hash
	catalog_hash = hash_text
	catalog_version = Val.num(data, "version")
	catalog_rate = Val.num(data, "rate")
	_meta.clear()
	for s: Variant in Val.list(data, "sounds"):
		var d := Val.as_dict(s)
		var id := Val.text(d, "id")
		if id == "" or _safe_name(id) != id:
			continue # only plain ids ("cast.fire") become file names
		_meta[id] = {
			"variants": maxi(1, Val.num(d, "variants", 1)), "lengthMs": Val.num(d, "lengthMs"), "loop": Val.flag(d, "loop"),
			"accent": Val.real(d, "accent", -1.0),
		}
	if changed:
		_streams.clear()
		_checked.clear()
		_announced = false
	var dir := _dir()
	DirAccess.make_dir_recursive_absolute(dir)
	_remove_old_catalogs()
	_to_load.clear()
	_to_fetch.clear()
	var downloading: Dictionary = {}
	for item: Variant in _busy.values():
		downloading[Val.text(Val.as_dict(item), "path")] = true
	var checks: Array[Dictionary] = []
	for id: Variant in _meta.keys():
		var n: int = Val.num(Val.as_dict(_meta[id]), "variants", 1)
		for v: int in range(n):
			var path := _path(String(id), v)
			if downloading.has(path):
				continue
			var on_disk := FileAccess.file_exists(path)
			var item: Dictionary = {"id": String(id), "variant": v, "path": path, "check": on_disk}
			if not on_disk:
				_to_fetch.append(item)
				continue
			if not _checked.has(path):
				checks.append(item)
			if not _streams.has(_key(String(id), v)):
				_to_load.append(item)
	# Missing files first; the files on disk are revalidated after them (they are loaded and heard meanwhile).
	_to_fetch.append_array(checks)
	# The ambience first: it is the first thing a table asks for.
	_to_load.sort_custom(func(a: Dictionary, b: Dictionary) -> bool: return a["id"] == AMBIENCE_ID and b["id"] != AMBIENCE_ID)
	_pump_fetches()


func _process(_delta: float) -> void:
	var n: int = 0
	while n < LOADS_PER_FRAME and not _to_load.is_empty():
		var item: Dictionary = _to_load.pop_front()
		_load_file(item["id"], item["variant"], item["path"])
		n += 1
	if not _announced and catalog_hash != "" and _to_load.is_empty() and _to_fetch.is_empty() and _busy.is_empty():
		_announced = true
		sounds_ready.emit()


func _pump_fetches() -> void:
	for r: HTTPRequest in _requests:
		if _to_fetch.is_empty():
			return
		if _busy.has(r):
			continue
		var item: Dictionary = _to_fetch.pop_front()
		var part := "%s.part" % item["path"]
		r.download_file = part
		var headers := PackedStringArray(["Accept: audio/wav"])
		if Val.flag(item, "check"):
			headers.append("If-None-Match: %s" % etag_of(catalog_hash, String(item["id"]), int(item["variant"])))
		var url := Server.url(wav_path(String(item["id"]), int(item["variant"])))
		var err := r.request(url, headers)
		if err != OK:
			push_warning("Sounds: %s could not be requested (%s)." % [item["id"], error_string(err)])
			continue
		_busy[r] = item


func _on_fetched(result: int, code: int, _headers: PackedStringArray, _body: PackedByteArray, r: HTTPRequest) -> void:
	var item: Dictionary = _busy.get(r, {})
	_busy.erase(r)
	if not item.is_empty():
		var path: String = item["path"]
		var part := "%s.part" % path
		if result == HTTPRequest.RESULT_SUCCESS and code == 304:
			DirAccess.remove_absolute(part) # up to date (HTTPRequest may leave an empty part file)
			_checked[path] = true
		elif result == HTTPRequest.RESULT_SUCCESS and code == 200 and FileAccess.file_exists(part):
			if FileAccess.file_exists(path):
				DirAccess.remove_absolute(path) # a revalidated file the server answered anew: replaced and loaded again
			DirAccess.rename_absolute(part, path)
			_checked[path] = true
			_streams.erase(_key(String(item["id"]), int(item["variant"])))
			_to_load.append(item)
		else:
			DirAccess.remove_absolute(part)
			push_warning("Sounds: %s/%d could not be downloaded (%d, %d)." % [item["id"], item["variant"], result, code])
	_pump_fetches()


func _load_file(id: String, variant: int, path: String) -> void:
	var key := _key(id, variant)
	if _streams.has(key):
		return
	var stream := parse_wav(FileAccess.get_file_as_bytes(path))
	if stream == null:
		push_warning("Sounds: %s is not a 16-bit PCM WAV; it is downloaded again next time." % path)
		DirAccess.remove_absolute(path)
		return
	if Val.flag(Val.dict(_meta, id), "loop"):
		stream.loop_mode = AudioStreamWAV.LOOP_FORWARD
		stream.loop_begin = 0
		@warning_ignore("integer_division")
		stream.loop_end = stream.data.size() / (4 if stream.stereo else 2)
	_streams[key] = stream
	if id == AMBIENCE_ID and variant == 0 and _ambience_users > 0 and not _ambience.playing:
		_start_ambience()


## A 16-bit PCM WAV file (mono or stereo, any rate) as an AudioStreamWAV, or null. Written here (RIFF chunks: "fmt ", "data") so it
## does not depend on the engine's own run-time WAV loader.
static func parse_wav(bytes: PackedByteArray) -> AudioStreamWAV:
	if bytes.size() < 44 or bytes.slice(0, 4).get_string_from_ascii() != "RIFF" or bytes.slice(8, 12).get_string_from_ascii() != "WAVE":
		return null
	var pos: int = 12
	var format_tag: int = 0
	var channels: int = 0
	var rate: int = 0
	var bits: int = 0
	var data := PackedByteArray()
	while pos + 8 <= bytes.size():
		var chunk := bytes.slice(pos, pos + 4).get_string_from_ascii()
		var size: int = bytes.decode_u32(pos + 4)
		var body: int = pos + 8
		if chunk == "fmt " and body + 16 <= bytes.size():
			format_tag = bytes.decode_u16(body)
			channels = bytes.decode_u16(body + 2)
			rate = bytes.decode_u32(body + 4)
			bits = bytes.decode_u16(body + 14)
		elif chunk == "data":
			data = bytes.slice(body, mini(body + size, bytes.size()))
		pos = body + size + (size & 1)
	# 1: PCM; 0xFFFE: WAVE_FORMAT_EXTENSIBLE (PCM inside, 16 bits).
	if (format_tag != 1 and format_tag != 0xFFFE) or bits != 16 or channels < 1 or channels > 2 or rate <= 0 or data.is_empty():
		return null
	var stream := AudioStreamWAV.new()
	stream.format = AudioStreamWAV.FORMAT_16_BITS
	stream.mix_rate = rate
	stream.stereo = channels == 2
	stream.data = data
	return stream


## The server path of one WAV: /api/sounds/<id>/<variant>.wav (the id is URL-encoded; never a "#").
static func wav_path(id: String, variant: int) -> String:
	return "/api/sounds/%s/%d.wav" % [id.uri_encode(), variant]


## The ETag the server gives one WAV of the catalog `hash` (packages/server/src/sounds/service.ts), quotes included.
static func etag_of(hash_text: String, id: String, variant: int) -> String:
	return "\"%s-%s-%d\"" % [hash_text, id, variant]


## The key of a loaded variant in `_streams`.
static func _key(id: String, variant: int) -> String:
	return "%s/%d" % [id, variant]


func _dir() -> String:
	return CACHE_ROOT.path_join(catalog_hash)


func _path(id: String, variant: int) -> String:
	return _dir().path_join("%s_%d.wav" % [id, variant])


## An id or hash fit for a file name: letters, digits, dot, dash and underscore only ("" when anything else is in it).
func _safe_name(s: String) -> String:
	var re := RegEx.create_from_string("^[A-Za-z0-9._-]{1,128}$")
	return s if re.search(s) != null and not s.begins_with(".") else ""


## Older catalogs (another hash) are deleted: the server renders a new one whenever the catalog changes.
func _remove_old_catalogs() -> void:
	for sub: String in DirAccess.get_directories_at(CACHE_ROOT):
		if sub == catalog_hash:
			continue
		var old := CACHE_ROOT.path_join(sub)
		for f: String in DirAccess.get_files_at(old):
			DirAccess.remove_absolute(old.path_join(f))
		DirAccess.remove_absolute(old)
