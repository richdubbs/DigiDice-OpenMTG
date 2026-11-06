extends Control
## About (packages/client/src/screens/AboutScreen.tsx, UpdatePanel.tsx): the logo and the creator credit, the Fan Content
## disclaimer, where the card data comes from with its date, the rules pack, the compiler and the automation coverage (GET
## /api/status), the update button (GET and POST /api/update, polled while an update runs), and the licenses.

const POLICY_URL: String = "https://company.wizards.com/en/legal/fancontentpolicy"
const DISCLAIMER: String = "OpenMTG is unofficial Fan Content permitted under the Fan Content Policy. Not approved/endorsed by Wizards. Portions of the materials used are property of Wizards of the Coast. ©Wizards of the Coast LLC."
## How often the panel asks for progress while an update runs, and while the new coverage is being computed.
const POLL_RUNNING_S: float = 1.0
const POLL_COVERAGE_S: float = 4.0
const PHASE_TEXT: Dictionary = {
	"cards": "Checking Scryfall for new card data…",
	"pack": "Getting the rules pack…",
	"compile": "Compiling the new and changed cards…",
}
const OUTCOME_TEXT: Dictionary = {
	"updated": "Update installed.",
	"current": "Everything is up to date.",
	"partial": "Update partly installed: one part failed (details below).",
	"failed": "The update failed: nothing was changed.",
}

var _status_box: VBoxContainer = null
var _update_box: VBoxContainer = null
var _timer: Timer = null
## The job last seen: {id, running, pending}, empty before the first answer.
var _seen: Dictionary = {}
var _starting: bool = false
var _start_error: String = ""
var _log_open: bool = false


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
	margin.add_theme_constant_override("margin_left", 260)
	margin.add_theme_constant_override("margin_right", 260)
	margin.add_theme_constant_override("margin_top", 18)
	margin.add_theme_constant_override("margin_bottom", 24)
	scroll.add_child(margin)
	var page := VBoxContainer.new()
	page.add_theme_constant_override("separation", 18)
	margin.add_child(page)
	page.add_child(_header())
	page.add_child(_credits())
	var cols := HBoxContainer.new()
	cols.add_theme_constant_override("separation", 18)
	page.add_child(cols)
	var fan := _fan_content()
	fan.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	cols.add_child(fan)
	var licenses := _licenses()
	licenses.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	cols.add_child(licenses)
	page.add_child(_card_data())
	_timer = Timer.new()
	_timer.one_shot = true
	_timer.timeout.connect(_poll)
	add_child(_timer)
	if not Server.is_ready:
		await Server.server_ready
	_load_status()
	_poll()


func _header() -> Control:
	var row := HBoxContainer.new()
	row.add_theme_constant_override("separation", 16)
	var back := Hud.button("Back")
	back.custom_minimum_size = Vector2(80, 36)
	back.pressed.connect(Nav.back)
	row.add_child(back)
	row.add_child(Hud.title("About", 28))
	return row


func _section(title: String) -> Array:
	var panel := Hud.panel(18)
	var box := VBoxContainer.new()
	box.add_theme_constant_override("separation", 10)
	panel.add_child(box)
	var head := Hud.kicker(title, NeonTheme.colors()[0])
	head.label_settings.font_size = 14
	box.add_child(head)
	return [panel, box]


func _para(text: String, size: int = 14) -> Label:
	return Hud.text(text, size, Hud.TEXT)


func _link(text: String, open: Callable) -> Button:
	var b := Button.new()
	b.text = text
	b.flat = true
	b.alignment = HORIZONTAL_ALIGNMENT_LEFT
	b.size_flags_horizontal = Control.SIZE_SHRINK_BEGIN
	b.add_theme_color_override("font_color", NeonTheme.colors()[0])
	b.add_theme_color_override("font_hover_color", Color.WHITE)
	b.pressed.connect(open)
	return b


func _credits() -> Control:
	var panel := Hud.panel(22)
	var row := HBoxContainer.new()
	row.add_theme_constant_override("separation", 28)
	panel.add_child(row)
	var logo := Logo3D.make(112.0, true)
	logo.size_flags_vertical = Control.SIZE_SHRINK_CENTER
	row.add_child(logo)
	var words := VBoxContainer.new()
	words.alignment = BoxContainer.ALIGNMENT_CENTER
	words.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	words.add_theme_constant_override("separation", 6)
	var name_label := Hud.title("", 30)
	name_label.text = "OpenMTG by DigiDice"
	words.add_child(name_label)
	words.add_child(_para("Created by DigiDice LLC"))
	words.add_child(_para("Free and open source. No ads, no paid tiers, no accounts. Donations unlock nothing."))
	row.add_child(words)
	return panel


func _fan_content() -> Control:
	var parts := _section("Fan Content")
	var box: VBoxContainer = parts[1]
	box.add_child(_para(DISCLAIMER))
	box.add_child(_para("OpenMTG is not affiliated with, endorsed by, or sponsored by Wizards of the Coast or Scryfall."))
	box.add_child(_link("Wizards of the Coast Fan Content Policy", func() -> void: OS.shell_open(POLICY_URL)))
	return parts[0]


func _licenses() -> Control:
	var parts := _section("Licenses")
	var box: VBoxContainer = parts[1]
	box.add_child(_para("OpenMTG's code is licensed under the MIT License, copyright © 2026 DigiDice LLC."))
	box.add_child(_para("The MIT License does not cover Wizards of the Coast's intellectual property (card names, card text, card art, mana and set symbols, logos, the Comprehensive Rules text). The DigiDice name, logos and card back belong to DigiDice LLC and are not licensed under the MIT License."))
	box.add_child(_link("MIT License", func() -> void: Reader.open(self, "MIT License", _file("res://LICENSE"))))
	box.add_child(_link("Notice", func() -> void: Reader.open(self, "Notice", _file("res://legal/NOTICE.txt"))))
	box.add_child(_link("Third-party notices", _open_third_party))
	box.add_child(_link("DigiDice brand assets notice", func() -> void:
		Reader.open(self, "DigiDice brand assets notice", _file("res://assets/brand/README.md"))))
	return parts[0]


static func _file(path: String) -> String:
	var text := FileAccess.get_file_as_string(path)
	return text if text != "" else "This file is missing from this copy of OpenMTG."


## The engine's notices and its parts', from the engine itself, then the game server's (its /legal/THIRD_PARTY_NOTICES.md).
func _open_third_party() -> void:
	var out := PackedStringArray()
	out.append("OpenMTG is built with the Godot Engine (https://godotengine.org).\n")
	out.append("Godot Engine\n\n" + Engine.get_license_text())
	var parts: Array[Dictionary] = Engine.get_copyright_info()
	for part: Dictionary in parts:
		out.append("—— %s ——" % part.get("name", ""))
		for piece: Variant in part.get("parts", []):
			var p := Val.as_dict(piece)
			for c: Variant in Val.as_list(p.get("copyright", [])):
				out.append("Copyright %s" % c)
			out.append("License: %s\n" % p.get("license", ""))
	var licenses: Dictionary = Engine.get_license_info()
	out.append("—— License texts ——")
	for name: String in licenses:
		out.append("%s\n\n%s\n" % [name, licenses[name]])
	var reader := Reader.open(self, "Third-party notices", "\n".join(out) + "\n\nThe game server's notices are loading…")
	var res: Dictionary = await Server.get_text("/legal/THIRD_PARTY_NOTICES.md")
	if not is_instance_valid(reader):
		return
	var server_part := String(res["text"]) if bool(res["ok"]) else "The game server did not send its notices (%s)." % res["error"]
	reader.set_text("\n".join(out) + "\n\n—— The game server ——\n\n" + server_part)


# ---- Card data ----------------------------------------------------------------------------------------------------

func _card_data() -> Control:
	var parts := _section("Card data")
	var box: VBoxContainer = parts[1]
	box.add_child(_para("Card data comes from Scryfall. OpenMTG is not produced by or endorsed by Scryfall. Card images are never bundled: cards are shown as text unless you add your own images or turn on Scryfall images in Settings."))
	box.add_child(_link("scryfall.com", func() -> void: OS.shell_open("https://scryfall.com")))
	_status_box = VBoxContainer.new()
	box.add_child(_status_box)
	box.add_child(HSeparator.new())
	_update_box = VBoxContainer.new()
	_update_box.add_theme_constant_override("separation", 8)
	box.add_child(_update_box)
	_update_box.add_child(_para("Checking the update service…"))
	return parts[0]


static func _day(iso: String) -> String:
	return iso.substr(0, 10)


static func _pct(n: float, total: float) -> String:
	return "%.1f%%" % (100.0 * n / total) if total > 0 else "0%"


static func _coverage(c: Dictionary, long: bool) -> String:
	var total := Val.num(c, "total")
	if long:
		return "%s fully automated, %s partly, %s manual (%s cards)" % [_pct(Val.num(c, "full"), total),
			_pct(Val.num(c, "partial"), total), _pct(Val.num(c, "manual"), total), Hud.thousands(int(total))]
	return "%s full, %s partial, %s manual (%s cards)" % [_pct(Val.num(c, "full"), total), _pct(Val.num(c, "partial"), total),
		_pct(Val.num(c, "manual"), total), Hud.thousands(int(total))]


## A definition list: [[term, text]] as two columns.
func _rows(rows: Array) -> GridContainer:
	var grid := GridContainer.new()
	grid.columns = 2
	grid.add_theme_constant_override("h_separation", 18)
	grid.add_theme_constant_override("v_separation", 6)
	for r: Array in rows:
		var term := Hud.text(String(r[0]), 13)
		term.autowrap_mode = TextServer.AUTOWRAP_OFF
		term.size_flags_vertical = Control.SIZE_SHRINK_BEGIN
		grid.add_child(term)
		var value := _para(String(r[1]), 13)
		value.size_flags_horizontal = Control.SIZE_EXPAND_FILL
		grid.add_child(value)
	return grid


func _load_status() -> void:
	_clear(_status_box)
	_status_box.add_child(_para("Loading…"))
	var res: Dictionary = await Server.get_json("/api/status")
	if not is_instance_valid(_status_box):
		return
	_clear(_status_box)
	if not bool(res["ok"]):
		_status_box.add_child(_para("The local server did not answer (%s)." % res["error"]))
		return
	var s := Val.as_dict(res["data"])
	var cd := Val.dict(s, "cardData")
	var card_text := "Not downloaded yet: use Check for updates below"
	if not cd.is_empty():
		card_text = "Scryfall Oracle data of %s (downloaded %s%s)" % [_day(Val.text(cd, "updatedAt")), _day(Val.text(cd, "downloadedAt")),
			(", %s cards" % Hud.thousands(int(Val.num(cd, "cards")))) if cd.has("cards") else ""]
	var cov := Val.dict(s, "coverage")
	_status_box.add_child(_rows([
		["Version", Val.text(Val.dict(s, "app"), "version")],
		["Card data", card_text],
		["Rules pack", Val.text(s, "rulesPack", "None installed") if s.get("rulesPack") != null else "None installed"],
		["Compiler", Val.text(s, "compilerVersion")],
		["Automation coverage", _coverage(cov, true) if not cov.is_empty() else "Not computed yet"],
	]))


static func _clear(box: Node) -> void:
	for c: Node in box.get_children():
		box.remove_child(c)
		c.queue_free()


# ---- Updates ------------------------------------------------------------------------------------------------------

func _poll() -> void:
	var res: Dictionary = await Server.get_json("/api/update")
	if not is_inside_tree():
		return
	if not bool(res["ok"]):
		if _seen.is_empty() or not bool(_seen.get("running", false)):
			_show_unavailable(String(res["error"]))
		else:
			# While an update runs, keep asking: the server may be busy for a moment.
			_timer.start(POLL_COVERAGE_S)
		return
	_apply(res["data"])


func _apply(data: Variant) -> void:
	var s := Val.as_dict(data)
	if not (s.get("packConfigured") is bool) or not s.has("job"):
		_show_unavailable("this server has no Update support")
		return
	var job := Val.as_dict(s.get("job"))
	var prev := _seen
	var now: Dictionary = {}
	if not job.is_empty():
		var result := Val.as_dict(job.get("result"))
		now = {"id": int(Val.num(job, "id")), "running": Val.text(job, "state") == "running",
			"pending": bool(Val.dict(result, "coverage").get("afterPending", false))}
	_seen = now
	var watched_end := not now.is_empty() and not prev.is_empty() and not bool(now["running"]) \
		and (int(prev["id"]) != int(now["id"]) or bool(prev["running"]))
	var coverage_ready := not now.is_empty() and not prev.is_empty() and bool(prev.get("pending", false)) and not bool(now["pending"])
	if watched_end or coverage_ready:
		_load_status()
	if watched_end:
		Sound.cue(_finished_sound(job))
	_show_panel(s, job)
	if not now.is_empty() and bool(now["running"]):
		_timer.start(POLL_RUNNING_S)
	elif not now.is_empty() and bool(now["pending"]):
		_timer.start(POLL_COVERAGE_S)


static func _finished_sound(job: Dictionary) -> String:
	if Val.text(job, "state") == "failed" or Val.as_dict(job.get("result")).is_empty():
		return "ui.error"
	var outcome := Val.text(Val.dict(job, "result"), "outcome")
	return "ui.notify" if outcome == "partial" else ("ui.error" if outcome == "failed" else "ui.success")


func _show_unavailable(message: String) -> void:
	_clear(_update_box)
	_update_box.add_child(_heading("Updates"))
	_update_box.add_child(_para("The game server cannot run updates right now (%s)." % message, 13))


func _heading(text: String) -> Label:
	var l := Label.new()
	l.text = text
	l.add_theme_font_override("font", Hud.bold_font())
	l.add_theme_font_size_override("font_size", 17)
	return l


func _show_panel(s: Dictionary, job: Dictionary) -> void:
	_clear(_update_box)
	_update_box.add_child(_heading("Updates"))
	_update_box.add_child(Hud.text("New sets: the card data comes from Scryfall (downloaded at most once a day); how to automate new cards and mechanics comes from the OpenMTG rules pack.", 13))
	if not bool(s["packConfigured"]):
		_update_box.add_child(_warning("Rules-pack updates are off: no pack address is set yet, because the project has not published a rules pack. Check for updates refreshes the card data only."))
	var running := Val.text(job, "state") == "running"
	var start := Hud.primary("Updating…" if running else "Check for updates", 16)
	start.custom_minimum_size = Vector2(220, 42)
	start.size_flags_horizontal = Control.SIZE_SHRINK_BEGIN
	start.disabled = running or _starting
	start.pressed.connect(_start)
	_update_box.add_child(start)
	if _start_error != "":
		_update_box.add_child(_warning("Could not start the update: %s" % _start_error))
	if not job.is_empty():
		_job_view(job)


func _warning(text: String) -> Control:
	var panel := PanelContainer.new()
	var style := StyleBoxFlat.new()
	style.bg_color = Color(NeonTheme.colors()[1], 0.12)
	style.border_color = Color(NeonTheme.colors()[1], 0.6)
	style.set_border_width_all(1)
	style.set_corner_radius_all(8)
	style.set_content_margin_all(10)
	panel.add_theme_stylebox_override("panel", style)
	panel.add_child(_para(text, 13))
	return panel


func _start() -> void:
	_start_error = ""
	_starting = true
	# An update started here: its end is reported even when the answer already says done.
	_seen = {"id": -1, "running": true, "pending": false}
	var res: Dictionary = await Server.post_json("/api/update", {})
	_starting = false
	if not is_inside_tree():
		return
	if bool(res["ok"]):
		_apply(res["data"])
	elif Val.text(Val.as_dict(res["data"]), "code") == "updateRunning":
		_poll()
	else:
		_start_error = String(res["error"])
		Sound.cue("ui.error")
		_poll()


func _job_view(job: Dictionary) -> void:
	var state := Val.text(job, "state")
	var log: Array = Val.list(job, "log")
	if state == "running":
		var phase := Val.text(job, "phase")
		var progress := Val.dict(job, "progress") if phase == "compile" else {}
		var bar := ProgressBar.new()
		bar.custom_minimum_size = Vector2(0, 10)
		bar.show_percentage = false
		if progress.is_empty():
			bar.indeterminate = true
		else:
			bar.max_value = maxf(1.0, Val.num(progress, "total"))
			bar.value = Val.num(progress, "done")
		_update_box.add_child(bar)
		_update_box.add_child(_para(String(PHASE_TEXT.get(phase, "Working…")), 13))
		if not progress.is_empty():
			_update_box.add_child(_para("%s of %s cards compiled" % [Hud.thousands(int(Val.num(progress, "done"))),
				Hud.thousands(int(Val.num(progress, "total")))], 13))
		if not log.is_empty():
			_update_box.add_child(Hud.text(String(log[log.size() - 1]), 12))
	elif state == "failed":
		_update_box.add_child(_warning("The update stopped with an error: %s. Your local data is unchanged." % Val.text(job, "error", "unknown error")))
	elif state == "done" and not Val.dict(job, "result").is_empty():
		_result_view(Val.dict(job, "result"))
	if not log.is_empty():
		var toggle := Button.new()
		toggle.flat = true
		toggle.toggle_mode = true
		toggle.button_pressed = _log_open
		toggle.text = ("▾ " if _log_open else "▸ ") + "Details"
		toggle.alignment = HORIZONTAL_ALIGNMENT_LEFT
		toggle.size_flags_horizontal = Control.SIZE_SHRINK_BEGIN
		toggle.add_theme_color_override("font_color", NeonTheme.colors()[0])
		_update_box.add_child(toggle)
		var text := TextEdit.new()
		text.editable = false
		text.text = "\n".join(PackedStringArray(log))
		text.custom_minimum_size = Vector2(0, 220)
		text.visible = _log_open
		_update_box.add_child(text)
		toggle.toggled.connect(func(on: bool) -> void:
			_log_open = on
			toggle.text = ("▾ " if on else "▸ ") + "Details"
			text.visible = on)


func _result_view(r: Dictionary) -> void:
	var outcome := _heading(String(OUTCOME_TEXT.get(Val.text(r, "outcome"), "")))
	outcome.add_theme_font_size_override("font_size", 15)
	_update_box.add_child(outcome)
	if Val.flag(r, "offline"):
		_update_box.add_child(_warning("You seem to be offline: nothing could be downloaded. Your cards and rules are unchanged and keep working; try again when you are connected."))
	var cd := Val.dict(r, "cardData")
	var card_text := "Not refreshed: %s. Your local card data is unchanged." % Val.text(cd, "detail")
	if Val.text(cd, "state") == "refreshed":
		card_text = "Downloaded the latest Scryfall data (%s)." % Val.text(cd, "detail")
	elif Val.text(cd, "state") == "current":
		card_text = "Already current (%s)." % Val.text(cd, "detail")
	var added := int(Val.num(r, "cardsAdded"))
	var names: Array = Val.list(r, "newCards")
	var added_text := Hud.thousands(added)
	if not names.is_empty():
		added_text += " (%s%s)" % [", ".join(PackedStringArray(names)),
			(", and %s more" % Hud.thousands(added - names.size())) if added > names.size() else ""]
	var t := Val.dict(r, "templates")
	var cov := Val.dict(r, "coverage")
	var before := _coverage(Val.dict(cov, "before"), false) if not Val.dict(cov, "before").is_empty() else "not computed"
	var after := "not computed"
	if not Val.dict(cov, "after").is_empty():
		after = _coverage(Val.dict(cov, "after"), false)
	elif Val.flag(cov, "afterPending"):
		after = "being computed for the new card data…"
	var d := Val.dict(r, "delta")
	var rows: Array = [
		["Card data", card_text],
		["Cards added", added_text],
		["Rules pack", _pack_text(Val.dict(r, "pack"))],
		["Templates added", "%s (rules-pack templates: %s before, %s now)" % [Hud.thousands(int(Val.num(t, "added"))),
			Hud.thousands(int(Val.num(t, "before"))), Hud.thousands(int(Val.num(t, "after")))]],
		["Coverage before", before],
		["Coverage now", after],
		["New and changed cards", "%s more automated, %s less automated, %s still manual" % [Hud.thousands(int(Val.num(d, "newlyAutomated"))),
			Hud.thousands(int(Val.num(d, "lessAutomated"))), Hud.thousands(int(Val.num(d, "stillManual")))]],
	]
	var nn := Val.dict(r, "needsNewer")
	var nn_count := int(Val.num(nn, "count"))
	if nn_count > 0:
		var nn_names: Array = Val.list(nn, "names")
		rows.append(["Needs a newer OpenMTG", "%s card(s) need a newer OpenMTG and play with manual resolution until then (%s%s)." % [
			Hud.thousands(nn_count), ", ".join(PackedStringArray(nn_names)), ", …" if nn_count > nn_names.size() else ""]])
	var refused := int(Val.num(r, "refusedForYourText"))
	if refused > 0:
		rows.append(["Refused entries", "%s rules-pack entries do not fit your card text and are not used." % Hud.thousands(refused)])
	_update_box.add_child(_rows(rows))


static func _pack_text(p: Dictionary) -> String:
	match Val.text(p, "state"):
		"notConfigured":
			var installed := Val.text(p, "installed")
			return "Not checked: no rules-pack address is set%s." % ((" (installed: %s)" % installed) if installed != "" else "")
		"installed":
			var rejected := int(Val.num(p, "rejected"))
			return "%s installed%s: %s card entries%s." % [Val.text(p, "version"), ", checked against its published SHA-256" if Val.flag(p, "verified") else "",
				Hud.thousands(int(Val.num(p, "entries"))), (", %s refused by the validator" % Hud.thousands(rejected)) if rejected > 0 else ""]
		"failed":
			var kept := Val.text(p, "kept")
			return "Not installed: %s%s." % [Val.text(p, "error"), (" (still using %s)" % kept) if kept != "" else ""]
	return ""


## A document read inside the app: a dimmed screen with the text in a panel, closed with Close or Esc.
class Reader:
	extends ColorRect

	var _text: TextEdit = null

	static func open(owner_node: Control, title: String, body: String) -> Reader:
		var r := Reader.new()
		r.color = Color(0, 0, 0, 0.6)
		r.set_anchors_and_offsets_preset(Control.PRESET_FULL_RECT)
		r.mouse_filter = Control.MOUSE_FILTER_STOP
		owner_node.add_child(r)
		var panel := Hud.panel(18)
		panel.set_anchors_and_offsets_preset(Control.PRESET_FULL_RECT)
		panel.offset_left = 200
		panel.offset_right = -200
		panel.offset_top = 70
		panel.offset_bottom = -70
		r.add_child(panel)
		var box := VBoxContainer.new()
		box.add_theme_constant_override("separation", 10)
		panel.add_child(box)
		var head := HBoxContainer.new()
		var t := Hud.title(title, 22)
		t.size_flags_horizontal = Control.SIZE_EXPAND_FILL
		head.add_child(t)
		var close := Hud.button("Close")
		close.pressed.connect(r.close)
		head.add_child(close)
		box.add_child(head)
		r._text = TextEdit.new()
		r._text.editable = false
		r._text.wrap_mode = TextEdit.LINE_WRAPPING_BOUNDARY
		r._text.size_flags_vertical = Control.SIZE_EXPAND_FILL
		r._text.text = body
		box.add_child(r._text)
		Sound.cue("ui.open")
		return r

	func set_text(body: String) -> void:
		var line := _text.get_first_visible_line()
		_text.text = body
		_text.set_line_as_first_visible(line)

	func close() -> void:
		Sound.cue("ui.close")
		queue_free()

	func _unhandled_input(event: InputEvent) -> void:
		if event.is_action_pressed("ui_cancel"):
			get_viewport().set_input_as_handled()
			close()
