extends Node
## Card pictures (autoload "Pictures"). Which picture a card shows, as the browser decides it
## (packages/client/src/cards/useCardImage.ts): **the player's own picture > Scryfall's picture (only when the setting is on) > our
## own frame** (Card.tscn's shaders, the default).
##
## - The player's pictures: the server's picture library (GET /api/library/images: one file per image slot, added on the Images
##   screen), read from the server's data folder on this computer. `load_library()` reads the list again after a change.
## - Scryfall (on by default): the `normal` picture URL of the definition's face (`image_uris` / `imageUris`), else the one the server
##   gives for the card's name (GET /api/cards/<name>?images=1, as images/scryfall.ts does), only https links to *.scryfall.io. Kept on
##   disk in user://pictures/scryfall/ (500 MB at most: the oldest by file time go first; a picture in use has its file time renewed
##   once a day, so file time is last use), and at most 120 decoded textures in memory.
## - Pictures are shown as they are: aspect ratio kept, no crop, no filter or tint, nothing drawn over them (Card.gd puts its chips
##   beside the picture, so the artist line is never covered); the zoomed card uses the same picture (no separate large download).
##
## Image slots follow the engine's `imageSlots` (packages/engine/src/cards/pool.ts): one per printed side, so a card keeps its picture
## across zones (a moved card is a new object, CR 400.7, but the same slot).
##
## Card.gd asks `texture_for(def, face)`: a texture at once when it is in memory, else null and `picture_ready(key, texture)` later
## (the card compares `key` with `key_for(def, face)`). `pictures_changed` means "ask again" (the library or the setting changed).

signal picture_ready(key: String, texture: Texture2D)
signal pictures_changed()

const DISK_DIR: String = "user://pictures/scryfall"
const DISK_CAP_BYTES: int = 500 * 1024 * 1024
## After pruning, the cache is brought down to this share of the cap (so it is not pruned on every download).
const DISK_PRUNE_TO: float = 0.9
const MEMORY_CAP: int = 120
const DOWNLOADS_AT_ONCE: int = 4
const RENEW_AFTER_S: int = 24 * 3600
## Two printed sides (CR 712), each with its own picture.
const TWO_SIDED: Array[String] = ["transform", "modal_dfc", "reversible_card", "double_faced_token"]
const TOKEN_LAYOUTS: Array[String] = ["token", "double_faced_token", "emblem"]
const WUBRG: Array[String] = ["W", "U", "B", "R", "G"]

## Image slot key -> absolute path of the player's file.
var _player_files: Dictionary = {}
## key -> Texture2D, and the keys oldest use first.
var _memory: Dictionary = {}
var _order: Array[String] = []
## key -> true while its picture is being read, downloaded or decoded.
var _loading: Dictionary = {}
## key -> the Scryfall artist of its picture.
var _artists: Dictionary = {}
## Card name -> [ {normal, artist} per face ] from the server, or null when the server has none; missing while not asked.
var _lookups: Dictionary = {}
## Card name -> [ [key, side, two_sided] ] waiting for that look-up.
var _waiting: Dictionary = {}
var _downloads: Array[Dictionary] = [] # {key, url, path}
var _requests: Array[HTTPRequest] = []
var _busy: Dictionary = {} # HTTPRequest -> {key, url, path}
var _tasks: Array[int] = []
var _disk_bytes: int = -1
var _scanning: bool = false

static var _re_space: RegEx = null


func _ready() -> void:
	DirAccess.make_dir_recursive_absolute(DISK_DIR)
	for i: int in range(DOWNLOADS_AT_ONCE):
		var r := HTTPRequest.new()
		r.timeout = 30.0
		r.use_threads = true
		add_child(r)
		r.request_completed.connect(_on_downloaded.bind(r))
		_requests.append(r)
	Settings.changed.connect(_on_settings_changed)
	Server.server_ready.connect(func(_port: int, _token: String) -> void: load_library())
	if Server.is_ready:
		load_library()


func _process(_delta: float) -> void:
	# Finished worker tasks are waited for (released); none of them is ever waited for while it runs.
	for i: int in range(_tasks.size() - 1, -1, -1):
		if WorkerThreadPool.is_task_completed(_tasks[i]):
			WorkerThreadPool.wait_for_task_completion(_tasks[i])
			_tasks.remove_at(i)


# ---- what a card shows --------------------------------------------------------------------------------------------------------

## The picture of `def`'s face `face` (View.shown_face), or null: the card draws its own frame meanwhile. A picture still on its way
## arrives with `picture_ready(key_for(def, face), texture)`.
func texture_for(def: Dictionary, face: int) -> Texture2D:
	var key := key_for(def, face)
	if key == "":
		return null
	if _memory.has(key):
		_order.erase(key)
		_order.append(key)
		return _memory[key]
	_request(key, def, face)
	return null


## Which picture `def`'s face shows, as a key ("" for our own frame): "pl|<slot key>" for the player's file, "sf|<name>|<side>" for
## Scryfall's.
func key_for(def: Dictionary, face: int) -> String:
	if def.is_empty():
		return ""
	var slot := slot_key(def, face)
	if slot != "" and _player_files.has(slot):
		return "pl|%s" % slot
	if Settings.scryfall_images and Val.text(def, "name") != "":
		return "sf|%s|%d" % [Val.text(def, "name"), shown_side(def, face)]
	return ""


## "player", "scryfall" or "" (a picture key's source). A Scryfall picture is never cut (the animator lets it fall whole).
func kind_of(key: String) -> String:
	if key.begins_with("pl|"):
		return "player"
	if key.begins_with("sf|"):
		return "scryfall"
	return ""


## The artist of a Scryfall picture ("" when unknown or not Scryfall).
func artist_of(key: String) -> String:
	return String(_artists.get(key, ""))


# ---- image slots (engine cards/pool.ts imageSlots; client cards/model.ts slotOfFace) -----------------------------------------------

static func is_two_sided(def: Dictionary) -> bool:
	return TWO_SIDED.has(Val.text(def, "layout")) and Val.list(def, "faces").size() == 2


## The side whose picture a face shows: the given face of a two-sided card, otherwise 0 (one picture for every face).
static func shown_side(def: Dictionary, face: int) -> int:
	if not is_two_sided(def):
		return 0
	return face if face >= 0 and face < 2 else 0


## The image slot key of a face.
static func slot_key(def: Dictionary, face: int) -> String:
	var slots := slots_of(def)
	if slots.is_empty():
		return ""
	var faces := Val.list(def, "faces")
	if slots.size() == faces.size() and slots.size() > 1:
		var i := shown_side(def, face)
		return slots[i] if i < slots.size() else slots[0]
	return slots[0]


## The image slot keys of a definition: one per printed side (design 12.2).
static func slots_of(def: Dictionary) -> Array[String]:
	var def_name := Val.text(def, "name")
	var layout := Val.text(def, "layout")
	var faces := Val.list(def, "faces")
	var out: Array[String] = []
	if Val.flag(def, "stub"):
		out.append(def_name)
		return out
	if not faces.is_empty() and (TOKEN_LAYOUTS.has(layout) or Val.flag(def, "isToken")):
		for f: Variant in faces:
			out.append(token_variant_key(Val.as_dict(f)))
		return out
	if layout == "meld":
		out.append(def_name)
		var meld := Val.dict(def, "meld")
		if not Val.flag(meld, "isResult") and Val.text(meld, "result") != "":
			out.append(Val.text(meld, "result"))
		return out
	if TWO_SIDED.has(layout) and faces.size() == 2:
		var a := Val.text(Val.as_dict(faces[0]), "name")
		var b := Val.text(Val.as_dict(faces[1]), "name")
		if a == b:
			out.append("%s (front)" % a)
			out.append("%s (back)" % b)
		else:
			out.append(a)
			out.append(b)
		return out
	out.append(def_name)
	return out


## The slot key of a token face, "Name (P/T COLORS Type; text)" (engine pool.ts `tokenVariantKey`), for example
## "Spirit (1/1 W Creature — Spirit; Flying)".
static func token_variant_key(face: Dictionary) -> String:
	var colors := ""
	var have := Val.texts(face, "colors")
	for c: String in WUBRG:
		if have.has(c):
			colors += c
	if colors == "":
		colors = "C"
	var pt := ""
	if face.has("power") or face.has("toughness"):
		pt = "%s/%s " % [Val.text(face, "power", "?"), Val.text(face, "toughness", "?")]
	var token_word := RegEx.create_from_string("(?i)^Token\\s+")
	var type_line := token_word.sub(_squash(Val.text(face, "typeLine")), "")
	var text := "; ".join(_canonical_token_text(Val.text(face, "oracleText")))
	return "%s (%s%s %s%s)" % [token_base_name(Val.text(face, "name")), pt, colors, type_line, ("; " + text) if text != "" else ""]


## "Treasure Token" -> "Treasure"; each side of a double-faced token too ("Incubator Token // Phyrexian Token" -> "Incubator // Phyrexian").
static func token_base_name(token_name: String) -> String:
	var sides := RegEx.create_from_string("\\s*//\\s*")
	var token_word := RegEx.create_from_string("(?i) Token$")
	var parts: Array[String] = []
	for side: String in sides.sub(_squash(token_name), "\n", true).split("\n"):
		parts.append(token_word.sub(side, ""))
	return " // ".join(parts)


static func _squash(s: String) -> String:
	if _re_space == null:
		_re_space = RegEx.create_from_string("\\s+")
	return _re_space.sub(s, " ", true).strip_edges()


## The rules text of a token variant key, one item per ability (pool.ts `canonicalTokenText`): reminder text dropped, a keyword
## line split into one capitalised keyword per item, every self-reference written "this token".
static func _canonical_token_text(text: String) -> Array[String]:
	var reminder := RegEx.create_from_string("\\s*\\([^()]*\\)")
	var keyword_sep := RegEx.create_from_string("\\s*,\\s*")
	var not_keyword := RegEx.create_from_string("[.:\"]")
	var self_ref := RegEx.create_from_string("(?i)\\b([Tt])his (?:token|artifact|enchantment|aura|creature|permanent|land|vehicle|equipment)\\b")
	var out: Array[String] = []
	for raw: String in text.split("\n"):
		var line := _squash(reminder.sub(raw, "", true))
		if line == "":
			continue
		if line.contains(",") and not_keyword.search(line) == null:
			for k: String in keyword_sep.sub(line, "\n", true).split("\n"):
				if k != "":
					out.append(k.substr(0, 1).to_upper() + k.substr(1))
		else:
			out.append(line)
	for i: int in range(out.size()):
		out[i] = self_ref.sub(out[i], "$1his token", true)
	return out


# ---- loading ------------------------------------------------------------------------------------------------------------------

func _request(key: String, def: Dictionary, face: int) -> void:
	if _loading.has(key):
		return
	_loading[key] = true
	if key.begins_with("pl|"):
		var path: String = _player_files.get(key.substr(3), "")
		_tasks.append(WorkerThreadPool.add_task(_read_file_task.bind(key, path)))
		return
	var uris := _uris_of_def(def, face)
	if not uris.is_empty():
		_fetch(key, Val.text(uris, "normal"), Val.text(uris, "artist"))
		return
	var card_name := Val.text(def, "name")
	var side := shown_side(def, face)
	if _lookups.has(card_name):
		_from_lookup(key, card_name, side, is_two_sided(def))
		return
	if not _waiting.has(card_name):
		_waiting[card_name] = []
		_look_up(card_name)
	Val.list(_waiting, card_name).append([key, side, is_two_sided(def)])


## The `normal` URL (and artist) of a face from the definition itself, {} when it carries none.
func _uris_of_def(def: Dictionary, face: int) -> Dictionary:
	var faces := Val.list(def, "faces")
	if faces.is_empty():
		return {}
	var own := _uris(Val.as_dict(faces[shown_side(def, face)]))
	if not own.is_empty():
		return own
	if not is_two_sided(def):
		for f: Variant in faces:
			var u := _uris(Val.as_dict(f))
			if not u.is_empty():
				return u
	return {}


## {normal, artist} of a face's image URLs (the `normal` picture, else `large`), {} when it has no safe one.
func _uris(face: Dictionary) -> Dictionary:
	for k: String in ["imageUris", "image_uris"]:
		var u := Val.dict(face, k)
		var normal := safe_scryfall_url(Val.text(u, "normal"))
		if normal == "":
			normal = safe_scryfall_url(Val.text(u, "large"))
		if normal != "":
			return {"normal": normal, "artist": Val.text(u, "artist", Val.text(face, "artist"))}
	return {}


## Only https links to Scryfall's image host (images/scryfall.ts `safeScryfallUrl`), else "".
static func safe_scryfall_url(url: String) -> String:
	if not url.begins_with("https://"):
		return ""
	var host := url.substr(8).get_slice("/", 0).get_slice("?", 0).get_slice("#", 0).to_lower()
	if host.contains("@") or host.contains(":"):
		return ""
	if host == "scryfall.io" or host.ends_with(".scryfall.io"):
		return url
	return ""


func _look_up(card_name: String) -> void:
	var r: Dictionary = await Server.get_json("/api/cards/%s?images=1" % card_name.uri_encode())
	var faces: Variant = null
	if Val.flag(r, "ok"):
		var list: Array = []
		for f: Variant in Val.list(Val.dict(Val.as_dict(r.get("data")), "card"), "faces"):
			list.append(_uris(Val.as_dict(f)))
		faces = list
	_lookups[card_name] = faces
	var waiting: Array = _waiting.get(card_name, [])
	_waiting.erase(card_name)
	for w: Variant in waiting:
		var entry: Array = w
		_from_lookup(String(entry[0]), card_name, int(entry[1]), bool(entry[2]))


## useCardImage.ts: the looked-up side, or (a one-picture card) the first side that has a picture.
func _from_lookup(key: String, card_name: String, side: int, two_sided: bool) -> void:
	var faces: Variant = _lookups.get(card_name)
	if not (faces is Array):
		_loading.erase(key)
		return
	var list: Array = faces
	var pick: Dictionary = {}
	if side < list.size():
		pick = Val.as_dict(list[side])
	if pick.is_empty() and not two_sided:
		for u: Variant in list:
			if not Val.as_dict(u).is_empty():
				pick = Val.as_dict(u)
				break
	if pick.is_empty():
		_loading.erase(key)
		return
	_fetch(key, Val.text(pick, "normal"), Val.text(pick, "artist"))


## A Scryfall picture: from the disk cache, else downloaded into it.
func _fetch(key: String, url: String, artist: String) -> void:
	if url == "":
		_loading.erase(key)
		return
	if artist != "":
		_artists[key] = artist
	var path := DISK_DIR.path_join("%s.img" % url.md5_text())
	if FileAccess.file_exists(path):
		_tasks.append(WorkerThreadPool.add_task(_read_file_task.bind(key, path)))
		return
	_downloads.append({"key": key, "url": url, "path": path})
	_pump_downloads()


func _pump_downloads() -> void:
	for r: HTTPRequest in _requests:
		if _downloads.is_empty():
			return
		if _busy.has(r):
			continue
		var item: Dictionary = _downloads.pop_front()
		r.download_file = "%s.part" % item["path"]
		var headers := PackedStringArray(["Accept: image/jpeg,image/png,image/*", "User-Agent: OpenMTG/%s" % Server.version])
		var err := r.request(String(item["url"]), headers)
		if err != OK:
			_loading.erase(item["key"])
			continue
		_busy[r] = item


func _on_downloaded(result: int, code: int, _headers: PackedStringArray, _body: PackedByteArray, r: HTTPRequest) -> void:
	var item: Dictionary = _busy.get(r, {})
	_busy.erase(r)
	if not item.is_empty():
		var path: String = item["path"]
		var part := "%s.part" % path
		if result == HTTPRequest.RESULT_SUCCESS and code == 200 and FileAccess.file_exists(part):
			DirAccess.rename_absolute(part, path)
			_count_disk(path)
			_tasks.append(WorkerThreadPool.add_task(_read_file_task.bind(String(item["key"]), path)))
		else:
			DirAccess.remove_absolute(part)
			_loading.erase(item["key"])
	_pump_downloads()


## On a worker thread: read and decode one picture, then hand it to the main thread. Mipmaps are made here so a picture drawn small
## stays smooth (sampling, not a filter: the picture's own colours are untouched).
func _read_file_task(key: String, path: String) -> void:
	var image := decode(FileAccess.get_file_as_bytes(path))
	if image != null:
		image.generate_mipmaps()
	_on_decoded.call_deferred(key, path, image)


## A picture file's bytes as an image (JPEG, PNG, WebP or BMP, told apart by their first bytes); null for anything else (GIF,
## AVIF, HEIC: OpenMTG cannot show those) or a broken file.
static func decode(bytes: PackedByteArray) -> Image:
	if bytes.size() <= 12:
		return null
	var image := Image.new()
	var err := ERR_FILE_UNRECOGNIZED
	if bytes[0] == 0xFF and bytes[1] == 0xD8:
		err = image.load_jpg_from_buffer(bytes)
	elif bytes[0] == 0x89 and bytes[1] == 0x50:
		err = image.load_png_from_buffer(bytes)
	elif bytes.slice(0, 4).get_string_from_ascii() == "RIFF" and bytes.slice(8, 12).get_string_from_ascii() == "WEBP":
		err = image.load_webp_from_buffer(bytes)
	elif bytes[0] == 0x42 and bytes[1] == 0x4D:
		err = image.load_bmp_from_buffer(bytes)
	return image if err == OK and not image.is_empty() else null


func _on_decoded(key: String, path: String, image: Image) -> void:
	_loading.erase(key)
	if image == null:
		if path.begins_with(DISK_DIR):
			DirAccess.remove_absolute(path) # a broken download: fetched again next time
		return
	if path.begins_with(DISK_DIR):
		_renew(path)
	var texture := ImageTexture.create_from_image(image)
	_memory[key] = texture
	_order.erase(key)
	_order.append(key)
	while _order.size() > MEMORY_CAP:
		_memory.erase(_order.pop_front())
	picture_ready.emit(key, texture)


## A cached picture in use gets a new file time (at most once a day), so the oldest file times are the least recently used.
func _renew(path: String) -> void:
	var age := int(Time.get_unix_time_from_system()) - int(FileAccess.get_modified_time(path))
	if age < RENEW_AFTER_S:
		return
	var bytes := FileAccess.get_file_as_bytes(path)
	var f := FileAccess.open(path, FileAccess.WRITE)
	if f != null:
		f.store_buffer(bytes)
		f.close()


func _count_disk(new_file: String) -> void:
	if _disk_bytes < 0:
		_disk_bytes = 0
		for f: String in DirAccess.get_files_at(DISK_DIR):
			_disk_bytes += _size_of(DISK_DIR.path_join(f))
	else:
		_disk_bytes += _size_of(new_file)
	if _disk_bytes > DISK_CAP_BYTES:
		_prune()


## Deletes the oldest pictures (by file time) until the cache is under DISK_PRUNE_TO of its cap.
func _prune() -> void:
	var files: Array[Dictionary] = []
	for f: String in DirAccess.get_files_at(DISK_DIR):
		if f.ends_with(".part"):
			continue
		var p := DISK_DIR.path_join(f)
		files.append({"path": p, "time": int(FileAccess.get_modified_time(p)), "size": _size_of(p)})
	files.sort_custom(func(a: Dictionary, b: Dictionary) -> bool: return int(a["time"]) < int(b["time"]))
	var total: int = 0
	for f: Dictionary in files:
		total += int(f["size"])
	var goal := int(DISK_CAP_BYTES * DISK_PRUNE_TO)
	for f: Dictionary in files:
		if total <= goal:
			break
		DirAccess.remove_absolute(String(f["path"]))
		total -= int(f["size"])
	_disk_bytes = total


func _size_of(path: String) -> int:
	var f := FileAccess.open(path, FileAccess.READ)
	if f == null:
		return 0
	var n := f.get_length()
	f.close()
	return n


# ---- the player's pictures ----------------------------------------------------------------------------------------------------

## Read the server's picture library again (after the Images screen changed it): slot key -> stored file.
func load_library() -> void:
	if _scanning or not Server.is_ready:
		return
	_scanning = true
	var r: Dictionary = await Server.get_json("/api/library/images")
	_scanning = false
	if not Val.flag(r, "ok"):
		push_warning("Pictures: the picture library could not be read (%s)." % Val.text(r, "error"))
		return
	var files: Dictionary = {}
	for i: Variant in Val.list(Val.as_dict(r.get("data")), "images"):
		var d := Val.as_dict(i)
		files[Val.text(d, "key")] = Val.text(d, "path")
	_player_files = files
	for k: Variant in _memory.keys():
		if String(k).begins_with("pl|"):
			_memory.erase(k)
			_order.erase(String(k))
	pictures_changed.emit()


## The image slots of a definition with their labels (engine pool.ts `imageSlots`): [[key, label], …] — the card's name for a
## card with one picture, "<face> (front)" and "(back)" for a two-sided card, "<name> token" for a token, "(melded back)" for a
## meld card's result.
static func slot_labels(def: Dictionary) -> Array:
	var keys := slots_of(def)
	var layout := Val.text(def, "layout")
	var faces := Val.list(def, "faces")
	var out: Array = []
	if not faces.is_empty() and (TOKEN_LAYOUTS.has(layout) or Val.flag(def, "isToken")) and not Val.flag(def, "stub"):
		for i: int in mini(keys.size(), faces.size()):
			var base := token_base_name(Val.text(Val.as_dict(faces[i]), "name"))
			var label := base if layout == "emblem" else "%s token" % base
			if layout == "double_faced_token":
				label += " (front)" if i == 0 else " (back)"
			out.append([keys[i], label])
		return out
	if layout == "meld" and keys.size() == 2:
		return [[keys[0], keys[0]], [keys[1], "%s (melded back)" % keys[1]]]
	if TWO_SIDED.has(layout) and faces.size() == 2 and keys.size() == 2:
		for i: int in 2:
			out.append([keys[i], "%s (%s)" % [Val.text(Val.as_dict(faces[i]), "name"), "front" if i == 0 else "back"]])
		return out
	for k: String in keys:
		out.append([k, k])
	return out


func _on_settings_changed(key: String) -> void:
	if key == "scryfall_images":
		pictures_changed.emit()
