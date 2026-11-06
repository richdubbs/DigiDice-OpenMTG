extends Control
## Card images (packages/client/src/images/ImagesScreen.tsx, ImageLibrary.tsx, ReviewList.tsx, matching.ts): pictures of the
## player's own cards. Chosen files (or a folder's) are checked, matched to image slots by their names (POST /api/images/match,
## a decklist helping with unclear names), and those matched surely are stored in the server's picture library at once; the
## rest wait in a review list for the player to pick the card. The library shows every stored picture by card, with Replace,
## Add (a missing side) and Delete, and adds a picture for a card picked by name.

const MAX_IMAGE_BYTES: int = 25 * 1024 * 1024
## A match this sure is stored without asking (matching.ts AUTO_ACCEPT).
const AUTO_ACCEPT: float = 0.9
## The server matches at most this many file names, and reads this many decklist names, at a time.
const MATCH_BATCH: int = 2000
const MAX_DECK_NAMES: int = 500
const IMAGE_EXTENSIONS: Array[String] = ["jpg", "jpeg", "png", "webp", "gif", "avif", "bmp", "heic", "heif", "tif", "tiff", "jfif"]
const DECK_EXTENSIONS: Array[String] = ["txt", "dec"]
const SECTION_WORDS: Array[String] = ["deck", "main", "maindeck", "mainboard", "sideboard", "commander", "companion", "maybeboard", "about"]
const THUMB: Vector2 = Vector2(72, 100)
const TOAST_S: float = 8.0
const REASONS: Dictionary = {
	"unmatched": "No card matched this file name.",
	"unsure": "Not sure which card this is.",
	"duplicate": "Another file in this upload was matched to the same card side.",
}

var _busy: bool = false
var _choose_files: Button = null
var _choose_folder: Button = null
var _deck_text: TextEdit = null
var _status: Label = null
var _review_panel: Control = null
var _review_box: VBoxContainer = null
var _review_title: Label = null
var _skip_all: Button = null
## [{id, path, fileName, reason, match: {key, label, card}, confidence, alternatives}]
var _review: Array[Dictionary] = []
var _batch: int = 0
var _library_title: Label = null
var _library_box: VBoxContainer = null
var _adder: VBoxContainer = null
var _images: Array = []
var _toast: Label = null
var _toast_timer: Timer = null
## path -> ImageTexture, and the thumbnails still to load: [path, TextureRect].
var _thumbs: Dictionary = {}
var _thumb_queue: Array = []


func _ready() -> void:
	TopBar.attach(self)
	Footer.attach(self)
	var scroll := ScrollContainer.new()
	scroll.set_anchors_and_offsets_preset(Control.PRESET_FULL_RECT)
	scroll.offset_top = TopBar.HEIGHT
	scroll.offset_bottom = -56
	scroll.horizontal_scroll_mode = ScrollContainer.SCROLL_MODE_DISABLED
	add_child(scroll)
	var margin := MarginContainer.new()
	margin.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	margin.add_theme_constant_override("margin_left", 220)
	margin.add_theme_constant_override("margin_right", 220)
	margin.add_theme_constant_override("margin_top", 18)
	margin.add_theme_constant_override("margin_bottom", 24)
	scroll.add_child(margin)
	var page := VBoxContainer.new()
	page.add_theme_constant_override("separation", 16)
	margin.add_child(page)
	var head := HBoxContainer.new()
	head.add_theme_constant_override("separation", 16)
	var back := Hud.button("Back")
	back.custom_minimum_size = Vector2(80, 36)
	back.pressed.connect(Nav.back)
	head.add_child(back)
	head.add_child(Hud.title("Card images", 28))
	page.add_child(head)
	page.add_child(Hud.text("Add pictures of your own cards. They are matched to cards by file name and kept on this computer; they are never uploaded anywhere.", 14, Hud.TEXT))
	page.add_child(_upload_panel())
	_review_panel = _review_section()
	_review_panel.visible = false
	page.add_child(_review_panel)
	page.add_child(_library_section())
	_toast = Label.new()
	_toast.visible = false
	_toast.autowrap_mode = TextServer.AUTOWRAP_WORD_SMART
	_toast.horizontal_alignment = HORIZONTAL_ALIGNMENT_CENTER
	var ts := StyleBoxFlat.new()
	ts.bg_color = Color(0.03, 0.06, 0.13, 0.96)
	ts.border_color = NeonTheme.colors()[0]
	ts.set_border_width_all(1)
	ts.set_corner_radius_all(10)
	ts.set_content_margin_all(12)
	_toast.add_theme_stylebox_override("normal", ts)
	_toast.z_index = 50
	add_child(_toast)
	_toast_timer = Timer.new()
	_toast_timer.one_shot = true
	_toast_timer.timeout.connect(func() -> void: _toast.visible = false)
	add_child(_toast_timer)
	if not Server.is_ready:
		await Server.server_ready
	_load_library()


func _process(_delta: float) -> void:
	# Thumbnails load two a frame, so a long library does not stall the screen.
	for i: int in 2:
		if _thumb_queue.is_empty():
			break
		var job: Array = _thumb_queue.pop_front()
		var rect: TextureRect = job[1]
		if is_instance_valid(rect):
			rect.texture = _thumbnail(String(job[0]))
	if _toast.visible:
		var w := minf(560.0, size.x - 32.0)
		_toast.size = Vector2(w, 0)
		_toast.position = Vector2((size.x - w) / 2.0, size.y - 56.0 - 16.0 - _toast.get_combined_minimum_size().y)


func _section(title: String) -> Array:
	var panel := Hud.panel(18)
	var box := VBoxContainer.new()
	box.add_theme_constant_override("separation", 10)
	panel.add_child(box)
	var head := Hud.kicker(title, NeonTheme.colors()[0])
	head.label_settings.font_size = 14
	box.add_child(head)
	return [panel, box, head]


func _link(text: String) -> Button:
	var b := Button.new()
	b.text = text
	b.flat = true
	b.alignment = HORIZONTAL_ALIGNMENT_LEFT
	b.size_flags_horizontal = Control.SIZE_SHRINK_BEGIN
	b.add_theme_color_override("font_color", NeonTheme.colors()[0])
	return b


func _say(text: String) -> void:
	_status.text = text
	_status.visible = text != ""


## A message at the bottom of the screen for 8 s (the library's results).
func _notify(text: String, sound: String = "") -> void:
	_toast.text = text
	_toast.visible = true
	_toast_timer.start(TOAST_S)
	if sound != "":
		Sound.cue(sound)


# ---- Upload ---------------------------------------------------------------------------------------------------------------------------

func _upload_panel() -> Control:
	var parts := _section("Upload")
	var box: VBoxContainer = parts[1]
	var row := HBoxContainer.new()
	row.add_theme_constant_override("separation", 10)
	_choose_files = Hud.primary("Choose image files", 15)
	_choose_files.custom_minimum_size = Vector2(0, 44)
	_choose_files.pressed.connect(func() -> void: _pick(FileDialog.FILE_MODE_OPEN_FILES))
	row.add_child(_choose_files)
	_choose_folder = Hud.button("Choose a folder")
	_choose_folder.custom_minimum_size = Vector2(0, 44)
	_choose_folder.pressed.connect(func() -> void: _pick(FileDialog.FILE_MODE_OPEN_DIR))
	row.add_child(_choose_folder)
	box.add_child(row)
	box.add_child(Hud.text("Decklist (optional): names in it are preferred when a file name is unclear. A .txt decklist among the chosen files is used too, together with this list.", 13))
	_deck_text = TextEdit.new()
	_deck_text.placeholder_text = "4 Card Name\n2 Another Card"
	_deck_text.custom_minimum_size = Vector2(0, 90)
	box.add_child(_deck_text)
	var scry := CheckBox.new()
	scry.text = "Show card images from Scryfall"
	scry.button_pressed = Settings.scryfall_images
	scry.toggled.connect(func(on: bool) -> void: Settings.set_scryfall_images(on))
	box.add_child(scry)
	box.add_child(Hud.text("On by default. OpenMTG downloads card pictures from Scryfall (scryfall.io) for cards you have no image of your own and keeps them on this computer. Images you add always come first.", 12))
	_status = Hud.text("", 14, Hud.TEXT)
	_status.visible = false
	box.add_child(_status)
	return parts[0]


func _set_busy(on: bool) -> void:
	_busy = on
	for b: Button in [_choose_files, _choose_folder]:
		b.disabled = on
		b.modulate.a = 0.5 if on else 1.0


func _pick(mode: FileDialog.FileMode) -> void:
	if _busy:
		return
	var dialog := FileDialog.new()
	dialog.file_mode = mode
	dialog.access = FileDialog.ACCESS_FILESYSTEM
	dialog.use_native_dialog = true
	if mode == FileDialog.FILE_MODE_OPEN_FILES:
		var exts: PackedStringArray = []
		for e: String in IMAGE_EXTENSIONS + DECK_EXTENSIONS:
			exts.append("*." + e)
		dialog.filters = PackedStringArray([", ".join(exts) + " ; Images and decklists"])
		dialog.files_selected.connect(func(paths: PackedStringArray) -> void: _upload(Array(paths)))
	else:
		dialog.dir_selected.connect(func(dir: String) -> void: _upload(_files_in(dir)))
	add_child(dialog)
	dialog.popup_centered(Vector2i(900, 560))


## Every file in a folder and its sub-folders.
static func _files_in(dir: String) -> Array:
	var out: Array = []
	for f: String in DirAccess.get_files_at(dir):
		out.append(dir.path_join(f))
	for sub: String in DirAccess.get_directories_at(dir):
		out.append_array(_files_in(dir.path_join(sub)))
	return out


## "a", "a and b", "a, b and c", "a, b, c and 4 more".
static func _names_list(names: Array) -> String:
	if names.size() <= 1:
		return "" if names.is_empty() else String(names[0])
	if names.size() <= 3:
		return "%s and %s" % [", ".join(PackedStringArray(names.slice(0, names.size() - 1))), names[names.size() - 1]]
	return "%s and %d more" % [", ".join(PackedStringArray(names.slice(0, 3))), names.size() - 3]


func _upload(paths: Array) -> void:
	if _busy or paths.is_empty():
		return
	_set_busy(true)
	_batch += 1
	var images: Array = []
	var decklists: Array = []
	var ignored := 0
	var too_big := 0
	for p: Variant in paths:
		var path := String(p)
		var ext := path.get_extension().to_lower()
		if DECK_EXTENSIONS.has(ext):
			decklists.append(path)
		elif IMAGE_EXTENSIONS.has(ext):
			var f := FileAccess.open(path, FileAccess.READ)
			if f != null and f.get_length() > MAX_IMAGE_BYTES:
				too_big += 1
			elif f != null:
				images.append(path)
		else:
			ignored += 1
	# Each picture is decoded once: one OpenMTG cannot show is not stored.
	_say("Checking images…")
	var shown: Array = []
	var unreadable: Array = []
	for i: int in images.size():
		if i % 4 == 0:
			_say("Checking image %d of %d…" % [i + 1, images.size()])
			await get_tree().process_frame
		if Pictures.decode(FileAccess.get_file_as_bytes(String(images[i]))) != null:
			shown.append(images[i])
		else:
			unreadable.append(String(images[i]).get_file())
	var notes: Array[String] = []
	var deck := await _deck_names(decklists, notes)
	_say("Matching file names…")
	var matches: Array = []
	var match_error := ""
	for start: int in range(0, shown.size(), MATCH_BATCH):
		var names: Array = []
		for p: Variant in shown.slice(start, start + MATCH_BATCH):
			names.append(String(p).get_file())
		var body := {"fileNames": names}
		if not deck["names"].is_empty():
			body["deckNames"] = deck["names"].slice(0, MAX_DECK_NAMES)
		var r: Dictionary = await Server.post_json("/api/images/match", body)
		if not bool(r["ok"]):
			match_error = String(r["error"])
			break
		matches.append_array(Val.list(Val.as_dict(r["data"]), "matches"))
	if match_error != "":
		matches = []
		notes.append("Automatic matching is unavailable (%s): pick the cards below." % match_error)
	# Sure matches are stored; on a slot two files claim, the surest (then the first) wins and the other waits for review.
	var winners := {}
	var review: Array[Dictionary] = []
	for i: int in shown.size():
		var m := Val.as_dict(matches[i]) if i < matches.size() else {}
		var item := {"id": "%d-%d:%s" % [_batch, i, String(shown[i]).get_file()], "path": String(shown[i]), "fileName": String(shown[i]).get_file(),
			"match": Val.dict(m, "match"), "confidence": Val.real(m, "confidence"), "alternatives": Val.list(m, "alternatives")}
		var key := Val.text(Val.dict(m, "match"), "key")
		if key == "":
			item["reason"] = "unmatched"
			review.append(item)
		elif Val.real(m, "confidence") < AUTO_ACCEPT:
			item["reason"] = "unsure"
			review.append(item)
		elif winners.has(key):
			var other: Dictionary = winners[key]
			if float(item["confidence"]) > float(other["confidence"]):
				other["reason"] = "duplicate"
				review.append(other)
				winners[key] = item
			else:
				item["reason"] = "duplicate"
				review.append(item)
		else:
			winners[key] = item
	var stored := 0
	var n := 0
	for key: Variant in winners:
		n += 1
		_say("Storing %d of %d…" % [n, winners.size()])
		var item: Dictionary = winners[key]
		var r := await _store(String(item["path"]), Val.dict(item, "match"))
		if bool(r["ok"]):
			stored += 1
		else:
			notes.append("Could not store %s: %s" % [item["fileName"], r["error"]])
	_review.append_array(review)
	var parts: Array[String] = ["Stored %d image%s." % [stored, "" if stored == 1 else "s"]]
	if not review.is_empty():
		parts.append("%d image%s to review." % [review.size(), "" if review.size() == 1 else "s"])
	if not unreadable.is_empty():
		parts.append("%s cannot be shown by OpenMTG; convert %s to JPEG or PNG." % [_names_list(unreadable), "it" if unreadable.size() == 1 else "them"])
	if too_big > 0:
		parts.append("Skipped %d file%s over 25 MB." % [too_big, "" if too_big == 1 else "s"])
	if ignored > 0:
		parts.append("Ignored %d file%s that %s not an image." % [ignored, "" if ignored == 1 else "s", "is" if ignored == 1 else "are"])
	if not deck["names"].is_empty():
		parts.append("Decklist used: %d card name%s (from %s)." % [deck["names"].size(), "" if deck["names"].size() == 1 else "s", _names_list(deck["sources"])])
	_say(" ".join(parts) + ("\n" + "\n".join(notes) if not notes.is_empty() else ""))
	Sound.cue("ui.success" if stored > 0 else "ui.notify")
	_set_busy(false)
	_show_review()
	if stored > 0:
		Pictures.load_library()
		_load_library()


## The decklist's card names, from the text box and the chosen .txt / .dec files, each read by POST /api/decks/resolve (or, when it
## finds nothing, line by line): {names, sources}.
func _deck_names(files: Array, notes: Array[String]) -> Dictionary:
	var names: Array = []
	var sources: Array = []
	var texts: Array = []
	if _deck_text.text.strip_edges() != "":
		texts.append(["the text box", _deck_text.text, false])
	for f: Variant in files:
		texts.append([String(f).get_file(), FileAccess.get_file_as_string(String(f)), true])
	for t: Variant in texts:
		var entry: Array = t
		var found: Array = []
		var r: Dictionary = await Server.post_json("/api/decks/resolve", {"text": String(entry[1])})
		if bool(r["ok"]):
			for c: Variant in Val.list(Val.as_dict(r["data"]), "cards"):
				var n := Val.text(Val.as_dict(c), "name")
				if n != "" and not found.has(n):
					found.append(n)
		if found.is_empty():
			found = _parse_names(String(entry[1]), bool(entry[2]))
		if found.is_empty():
			if bool(entry[2]):
				notes.append("%s does not look like a decklist, so it was not used." % entry[0])
			continue
		sources.append(entry[0])
		for n: Variant in found:
			if not names.has(n):
				names.append(n)
	return {"names": names, "sources": sources}


static var _re_count: RegEx = null
static var _re_suffix: RegEx = null


## Card names read line by line: blank lines, comments and section words skipped; "4 ", "4x ", "SB: ", an Arena " (SET) 123" and
## MTGO's "*F*" taken off. `strict` (a file) counts only lines that look like a list's.
static func _parse_names(text: String, strict: bool) -> Array:
	if _re_count == null:
		_re_count = RegEx.create_from_string("^(?:SB:\\s*)?(\\d+)x?\\s+(.+)$")
		_re_suffix = RegEx.create_from_string("\\s+\\([A-Za-z0-9]{2,6}\\)\\s*\\S*$")
	var out: Array = []
	for raw: String in text.split("\n"):
		var l := raw.strip_edges()
		if l == "" or l.begins_with("//") or l.begins_with("#"):
			continue
		var lower := l.to_lower().trim_suffix(":")
		if SECTION_WORDS.has(lower) or lower.begins_with("name "):
			continue
		var m := _re_count.search(l)
		var card := ""
		if m != null:
			card = m.get_string(2)
		elif _re_suffix.search(l) != null:
			card = l
		elif not strict:
			card = l
		card = _re_suffix.sub(card.replace("*F*", ""), "").strip_edges()
		if card != "" and not out.has(card):
			out.append(card)
	return out


## Store `path` as the slot `slot` ({key, label, card}): {ok, error}.
func _store(path: String, slot: Dictionary) -> Dictionary:
	var r: Dictionary = await Server.post_json("/api/library/images/add", {"key": Val.text(slot, "key"), "card": Val.text(slot, "card"),
		"label": Val.text(slot, "label"), "path": path, "fileName": path.get_file()})
	return {"ok": bool(r["ok"]), "error": String(r["error"])}


# ---- Review ---------------------------------------------------------------------------------------------------------------------------

func _review_section() -> Control:
	var parts := _section("Review")
	_review_box = parts[1]
	_review_title = parts[2]
	_review_box.add_child(Hud.text("Pick the card each image shows. Skipped images are not stored.", 13))
	_skip_all = _link("Skip all")
	_skip_all.pressed.connect(func() -> void:
		_review.clear()
		_say("Skipped every image waiting for review.")
		_show_review())
	_review_box.add_child(_skip_all)
	return parts[0]


func _show_review() -> void:
	_review_panel.visible = not _review.is_empty()
	_review_title.text = "REVIEW (%d)" % _review.size()
	_skip_all.text = "Skip all %d image%s" % [_review.size(), "" if _review.size() == 1 else "s"]
	while _review_box.get_child_count() > 3:
		var c := _review_box.get_child(3)
		_review_box.remove_child(c)
		c.queue_free()
	for item: Dictionary in _review:
		_review_box.add_child(_review_row(item))


func _review_row(item: Dictionary) -> Control:
	var row := HBoxContainer.new()
	row.add_theme_constant_override("separation", 12)
	row.add_child(_thumb_rect(String(item["path"])))
	var col := VBoxContainer.new()
	col.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	col.add_theme_constant_override("separation", 6)
	var file := Label.new()
	file.text = String(item["fileName"])
	file.add_theme_font_override("font", Hud.bold_font())
	col.add_child(file)
	var reason := String(REASONS.get(String(item["reason"]), ""))
	var guess := Val.dict(item, "match")
	if String(item["reason"]) == "unsure" and not guess.is_empty():
		reason += " Best guess: %s (%d%%)." % [Val.text(guess, "label"), roundi(float(item["confidence"]) * 100.0)]
	col.add_child(Hud.text(reason, 13))
	var choices: Array = []
	var seen := {}
	for c: Variant in [guess] + Val.as_list(item["alternatives"]):
		var cd := Val.as_dict(c)
		if cd.is_empty() or seen.has(Val.text(cd, "key")):
			continue
		seen[Val.text(cd, "key")] = true
		choices.append(cd)
	if not choices.is_empty():
		var quick := HFlowContainer.new()
		quick.add_theme_constant_override("h_separation", 6)
		for c: Dictionary in choices:
			var b := Hud.button(Val.text(c, "label"))
			b.pressed.connect(func() -> void: _resolve(item, c))
			quick.add_child(b)
		col.add_child(quick)
	var search := Hud.button("Search for the card")
	search.size_flags_horizontal = Control.SIZE_SHRINK_BEGIN
	search.pressed.connect(func() -> void:
		var picker := CardPicker.make("Or search for the card", _query_for(item))
		picker.picked.connect(func(key: String, label: String, card: String) -> void:
			_resolve(item, {"key": key, "label": label, "card": card}))
		col.add_child(picker)
		col.move_child(picker, search.get_index())
		search.queue_free()
		picker.focus.call_deferred())
	col.add_child(search)
	var skip := _link("Skip this image")
	skip.pressed.connect(func() -> void:
		_review.erase(item)
		_show_review())
	col.add_child(skip)
	row.add_child(col)
	return row


## The card search a review row starts with: the guessed card's first face, else the file name without its extension, numbering,
## copy marks and side words.
static func _query_for(item: Dictionary) -> String:
	var guess := Val.dict(item, "match")
	if not guess.is_empty():
		return Val.text(guess, "card").split(" // ")[0]
	var q := String(item["fileName"]).get_basename()
	for ch: String in ["_", "-", "."]:
		q = q.replace(ch, " ")
	q = RegEx.create_from_string("^\\s*\\d+\\s*").sub(q, "")
	var tail := RegEx.create_from_string("(?i)\\s*(\\([^)]*\\)|\\d+|copy|front|back|f|b)\\s*$")
	var before := ""
	while before != q:
		before = q
		q = tail.sub(q, "")
	return q.strip_edges()


func _resolve(item: Dictionary, slot: Dictionary) -> void:
	var r := await _store(String(item["path"]), slot)
	if bool(r["ok"]):
		_review.erase(item)
		_say("Stored %s as %s." % [item["fileName"], Val.text(slot, "label")])
		Sound.cue("ui.success")
		Pictures.load_library()
		_load_library()
	else:
		_say("Could not store %s: %s" % [item["fileName"], r["error"]])
		Sound.cue("ui.error")
	_show_review()


# ---- Your images ----------------------------------------------------------------------------------------------------------------------

func _library_section() -> Control:
	var parts := _section("Your images")
	_library_box = parts[1]
	_library_title = parts[2]
	_adder = VBoxContainer.new()
	_library_box.add_child(_adder)
	_show_adder()
	_library_box.add_child(Hud.text("Loading…", 13))
	return parts[0]


## "Add an image for a specific card": the picker, then that side's file button and Cancel.
func _show_adder() -> void:
	for c: Node in _adder.get_children():
		c.queue_free()
	var picker := CardPicker.make("Add an image for a specific card")
	picker.picked.connect(func(key: String, label: String, card: String) -> void:
		for c: Node in _adder.get_children():
			c.queue_free()
		var line := HBoxContainer.new()
		line.add_theme_constant_override("separation", 10)
		line.add_child(Hud.text("Image for %s" % label, 14, Hud.TEXT))
		var choose := Hud.button("Choose image for %s" % label)
		choose.pressed.connect(func() -> void: _pick_one({"key": key, "label": label, "card": card}, func() -> void: _show_adder()))
		line.add_child(choose)
		var cancel := _link("Cancel")
		cancel.pressed.connect(_show_adder)
		line.add_child(cancel)
		_adder.add_child(line)
		choose.grab_focus.call_deferred())
	_adder.add_child(picker)


## One picture file for one slot (Replace, Add, or a card picked by name).
func _pick_one(slot: Dictionary, after: Callable = Callable()) -> void:
	var dialog := FileDialog.new()
	dialog.file_mode = FileDialog.FILE_MODE_OPEN_FILE
	dialog.access = FileDialog.ACCESS_FILESYSTEM
	dialog.use_native_dialog = true
	var exts: PackedStringArray = []
	for e: String in IMAGE_EXTENSIONS:
		exts.append("*." + e)
	dialog.filters = PackedStringArray([", ".join(exts) + " ; Images"])
	dialog.file_selected.connect(func(path: String) -> void:
		var file := path.get_file()
		if not IMAGE_EXTENSIONS.has(path.get_extension().to_lower()):
			_notify("%s is not an image file." % file, "ui.error")
			return
		var f := FileAccess.open(path, FileAccess.READ)
		if f != null and f.get_length() > MAX_IMAGE_BYTES:
			_notify("%s is too large (over 25 MB)." % file, "ui.error")
			return
		if Pictures.decode(FileAccess.get_file_as_bytes(path)) == null:
			_notify("%s cannot be shown by OpenMTG; convert it to JPEG or PNG." % file, "ui.error")
			return
		var r := await _store(path, slot)
		if bool(r["ok"]):
			_notify("Stored %s as %s." % [file, Val.text(slot, "label")], "ui.success")
			Pictures.load_library()
			_load_library()
		else:
			_notify("Could not store %s: %s" % [file, r["error"]], "ui.error")
		if after.is_valid():
			after.call())
	add_child(dialog)
	dialog.popup_centered(Vector2i(900, 560))


func _load_library() -> void:
	var r: Dictionary = await Server.get_json("/api/library/images")
	if not is_inside_tree():
		return
	_images = Val.list(Val.as_dict(r["data"]), "images") if bool(r["ok"]) else []
	_library_title.text = "YOUR IMAGES (%d)" % _images.size()
	while _library_box.get_child_count() > 2:
		var c := _library_box.get_child(2)
		_library_box.remove_child(c)
		c.queue_free()
	if not bool(r["ok"]):
		_library_box.add_child(Hud.text("The picture library could not be read: %s" % r["error"], 13, Color("#ff9bff")))
		return
	if _images.is_empty():
		_library_box.add_child(Hud.text("No images stored yet.", 13))
		return
	var by_card := {}
	var order: Array = []
	for i: Variant in _images:
		var d := Val.as_dict(i)
		var card := Val.text(d, "card")
		if not by_card.has(card):
			by_card[card] = []
			order.append(card)
		(by_card[card] as Array).append(d)
	for card: Variant in order:
		var group := VBoxContainer.new()
		group.add_theme_constant_override("separation", 6)
		var head := Label.new()
		head.text = String(card)
		head.add_theme_font_override("font", Hud.bold_font())
		head.add_theme_font_size_override("font_size", 16)
		group.add_child(head)
		_library_box.add_child(group)
		_fill_group(group, String(card), by_card[card])
	var clear := Hud.button("Delete all images")
	clear.set_meta(&"slab", "danger")
	clear.size_flags_horizontal = Control.SIZE_SHRINK_BEGIN
	clear.pressed.connect(func() -> void: _confirm_clear(clear))
	_library_box.add_child(clear)


## A card's sides: the stored ones, and for a two-sided card ("A // B") the side still without a picture.
func _fill_group(group: VBoxContainer, card: String, stored: Array) -> void:
	var slots: Array = []
	if card.contains(" // "):
		var r: Dictionary = await Server.get_json("/api/cards/%s" % card.uri_encode())
		if bool(r["ok"]):
			slots = Pictures.slot_labels(Val.dict(Val.as_dict(r["data"]), "card"))
	if not is_instance_valid(group):
		return
	var by_key := {}
	for s: Variant in stored:
		by_key[Val.text(Val.as_dict(s), "key")] = s
	var rows: Array = []
	var seen := {}
	for s: Variant in slots:
		var pair: Array = s
		rows.append({"key": pair[0], "label": pair[1], "card": card, "stored": by_key.get(pair[0], {})})
		seen[pair[0]] = true
	for s: Variant in stored:
		var d := Val.as_dict(s)
		if not seen.has(Val.text(d, "key")):
			rows.append({"key": Val.text(d, "key"), "label": Val.text(d, "label"), "card": card, "stored": d})
	for row: Dictionary in rows:
		group.add_child(_slot_row(row))


func _slot_row(row: Dictionary) -> Control:
	var stored := Val.as_dict(row["stored"])
	var line := HBoxContainer.new()
	line.add_theme_constant_override("separation", 12)
	if stored.is_empty():
		var empty := PanelContainer.new()
		empty.custom_minimum_size = THUMB
		var s := StyleBoxFlat.new()
		s.bg_color = Color(1, 1, 1, 0.04)
		s.border_color = Color(1, 1, 1, 0.2)
		s.set_border_width_all(1)
		s.set_corner_radius_all(4)
		empty.add_theme_stylebox_override("panel", s)
		var none := Hud.text("No image", 11)
		none.horizontal_alignment = HORIZONTAL_ALIGNMENT_CENTER
		none.vertical_alignment = VERTICAL_ALIGNMENT_CENTER
		empty.add_child(none)
		line.add_child(empty)
	else:
		line.add_child(_thumb_rect(Val.text(stored, "path")))
	var words := VBoxContainer.new()
	words.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	words.alignment = BoxContainer.ALIGNMENT_CENTER
	words.add_child(Hud.text(String(row["label"]), 14, Hud.TEXT))
	if not stored.is_empty():
		words.add_child(Hud.text(Val.text(stored, "fileName"), 11))
	line.add_child(words)
	var slot := {"key": row["key"], "label": row["label"], "card": row["card"]}
	var replace := Hud.button(("Replace %s" if not stored.is_empty() else "Add %s") % row["label"])
	replace.size_flags_vertical = Control.SIZE_SHRINK_CENTER
	replace.pressed.connect(func() -> void: _pick_one(slot))
	line.add_child(replace)
	if not stored.is_empty():
		var del := Hud.button("Delete")
		del.size_flags_vertical = Control.SIZE_SHRINK_CENTER
		del.tooltip_text = "Delete %s" % row["label"]
		del.set_meta(&"sfx", "none")
		del.pressed.connect(func() -> void:
			var r: Dictionary = await Server.post_json("/api/library/images/delete", {"key": String(row["key"])})
			if bool(r["ok"]):
				_notify("Image deleted.", "ui.delete")
				Pictures.load_library()
				_load_library()
			else:
				_notify("Could not delete the image: %s" % r["error"], "ui.error"))
		line.add_child(del)
	return line


func _confirm_clear(button: Button) -> void:
	var row := HBoxContainer.new()
	row.add_theme_constant_override("separation", 10)
	row.add_child(Hud.text("Delete all %d images from OpenMTG?" % _images.size(), 14, Hud.TEXT))
	var yes := Hud.button("Yes, delete all")
	yes.set_meta(&"slab", "danger")
	yes.set_meta(&"sfx", "none")
	yes.pressed.connect(func() -> void:
		var r: Dictionary = await Server.post_json("/api/library/images/clear", {})
		if bool(r["ok"]):
			_notify("All images deleted.", "ui.delete")
			Pictures.load_library()
			_load_library()
		else:
			_notify("Could not delete the images: %s" % r["error"], "ui.error"))
	row.add_child(yes)
	var keep := Hud.button("Keep them")
	keep.set_meta(&"sfx", "ui.cancel")
	keep.pressed.connect(func() -> void:
		row.queue_free()
		button.visible = true)
	row.add_child(keep)
	button.visible = false
	_library_box.add_child(row)


# ---- thumbnails -------------------------------------------------------------------------------------------------------------------------

## A 72 x 100 picture of a file, the whole picture kept; loaded a little later.
func _thumb_rect(path: String) -> TextureRect:
	var rect := TextureRect.new()
	rect.custom_minimum_size = THUMB
	rect.expand_mode = TextureRect.EXPAND_IGNORE_SIZE
	rect.stretch_mode = TextureRect.STRETCH_KEEP_ASPECT_CENTERED
	if _thumbs.has(path):
		rect.texture = _thumbs[path]
	else:
		_thumb_queue.append([path, rect])
	return rect


func _thumbnail(path: String) -> Texture2D:
	if _thumbs.has(path):
		return _thumbs[path]
	var image := Pictures.decode(FileAccess.get_file_as_bytes(path))
	var tex: Texture2D = null
	if image != null:
		var k := minf(THUMB.x * 2.0 / image.get_width(), THUMB.y * 2.0 / image.get_height())
		if k < 1.0:
			image.resize(maxi(1, int(image.get_width() * k)), maxi(1, int(image.get_height() * k)), Image.INTERPOLATE_LANCZOS)
		tex = ImageTexture.create_from_image(image)
	_thumbs[path] = tex
	return tex
