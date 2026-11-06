extends Control
## Settings (packages/client/src/settings/SettingsScreen.tsx, ProfilesSection.tsx, SoundSection.tsx): Restore defaults; Look and
## feel (the Neon Grid template and the player's saved profiles: save as new, rename, delete, export, import; a saved
## profile's palettes, two colours, text size, the grid floor, moving backgrounds); Card images; Stops for new games with Full
## control; Animation speed; Table (three or four players) and the camera; Sound with four volumes, their tests and every
## sound; Player names. Every change is saved at once; stops apply to games started afterwards.

const SOUNDS_PATH: String = "res://data/sounds.json"
## The "All sounds" groups (SoundSection.tsx), in order.
const SOUND_GROUPS: Array = [
	["Interface and decks", ["ui.hover", "ui.click", "ui.confirm", "ui.cancel", "ui.toggleOn", "ui.toggleOff", "ui.select", "ui.tick",
		"ui.type", "ui.navigate", "ui.open", "ui.close", "ui.error", "ui.notify", "ui.success", "ui.delete", "deck.add", "deck.remove",
		"deck.legal", "deck.illegal"]],
	["Game flow", ["game.start", "game.mulligan", "game.keep", "game.shuffle", "turn.mine", "turn.theirs", "turn.step", "priority.mine",
		"priority.pass", "game.handoff", "game.coin", "game.dice"]],
	["Big moments, online, ambience", ["game.finalBlow", "game.victory", "game.defeat", "game.drawn", "world.day", "world.night",
		"world.crown", "net.connected", "net.joined", "net.lost", "net.restored", "net.chat", "net.waiting", "ambient.grid"]],
	["Spells", ["cast.fire", "impact.fire", "cast.lightning", "impact.lightning", "cast.arcane", "impact.arcane", "cast.shadow",
		"impact.shadow", "cast.nature", "impact.nature", "cast.radiant", "impact.radiant", "cast.force", "impact.force"]],
	["Mana, spells resolving, abilities", ["mana.W", "mana.U", "mana.B", "mana.R", "mana.G", "mana.C", "spell.resolve", "spell.bolt",
		"spell.touch", "spell.countered", "spell.copied", "ability.activated", "ability.triggered"]],
	["Combat, life, counters", ["combat.attack", "combat.block", "combat.arm", "combat.assign", "combat.swing", "hit.light",
		"hit.medium", "hit.heavy", "hit.player", "life.gain", "life.loss", "counter.up", "counter.down", "stat.up", "stat.down",
		"damage.prevented"]],
	["Cards moving", ["card.draw", "card.land", "card.enter", "card.enterHeavy", "card.token", "card.destroy", "card.sacrifice",
		"card.exile", "card.bounce", "card.toGraveyard", "card.toLibrary", "card.tap", "card.untap"]],
	["Cards changing, zones, targets", ["card.flip", "card.attach", "card.control", "card.phase", "card.reveal", "card.search",
		"card.zoom", "card.pickup", "card.drop", "card.target", "card.targeted"]],
]
const STOP_ROWS: Array = [["upkeep", "Upkeep"], ["draw", "Draw"], ["main1", "Precombat main"], ["beginCombat", "Beginning of combat"],
	["declareAttackers", "Declare attackers"], ["declareBlockers", "Declare blockers"], ["combatDamage", "Combat damage"],
	["endCombat", "End of combat"], ["main2", "Postcombat main"], ["end", "End step"]]
const LAYOUT_ROWS: Array = [
	["shared", "Shared table", "Every board on one table, seen from your seat; the camera can look across it."],
	["acrossTop", "Opponents across the top", "Your board at the bottom, every opponent side by side at the top in turn order."],
	["focused", "One focused opponent", "One opponent large at the top, the others as strips; it follows whose turn it is and who attacks or targets you."],
]

var _left: VBoxContainer = null
var _right: VBoxContainer = null
var _wide: VBoxContainer = null
var _look_box: VBoxContainer = null
var _look_message: Label = null
var _look_form: Control = null
var _stop_boxes: Array[CheckBox] = []
var _ambience_test: Button = null
var _ambience_timer: SceneTreeTimer = null
var _building: bool = false


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
	page.add_theme_constant_override("separation", 18)
	margin.add_child(page)
	page.add_child(_header())
	_wide = VBoxContainer.new()
	_wide.add_theme_constant_override("separation", 18)
	page.add_child(_wide)
	var cols := HBoxContainer.new()
	cols.add_theme_constant_override("separation", 20)
	page.add_child(cols)
	_left = VBoxContainer.new()
	_left.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	_left.add_theme_constant_override("separation", 18)
	cols.add_child(_left)
	_right = VBoxContainer.new()
	_right.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	_right.add_theme_constant_override("separation", 18)
	cols.add_child(_right)
	var bottom := VBoxContainer.new()
	bottom.add_theme_constant_override("separation", 18)
	page.add_child(bottom)
	_wide.add_child(_look_section())
	_left.add_child(_images_section())
	_right.add_child(_stops_section())
	_left.add_child(_speed_section())
	_left.add_child(_table_section())
	_right.add_child(_names_section())
	bottom.add_child(_sound_section())
	Settings.changed.connect(_on_settings_changed)


func _exit_tree() -> void:
	if _ambience_test != null and _ambience_test.text == "Stop":
		Sound.release_ambience()


func _on_settings_changed(key: String) -> void:
	if key == "all" and not _building:
		# Restore defaults: the screen is drawn again from the settings.
		_building = true
		get_tree().reload_current_scene.call_deferred()


# ---- pieces --------------------------------------------------------------------------------------------------------

func _header() -> Control:
	var row := HBoxContainer.new()
	row.add_theme_constant_override("separation", 16)
	var back := Hud.button("Back")
	back.custom_minimum_size = Vector2(80, 36)
	back.pressed.connect(Nav.back)
	row.add_child(back)
	var title := Hud.title("Settings", 28)
	title.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	row.add_child(title)
	var restore := _link("Restore defaults")
	restore.pressed.connect(func() -> void: Settings.restore_defaults())
	row.add_child(restore)
	return row


func _section(title: String, hint: String = "") -> Array:
	var panel := Hud.panel(18)
	var box := VBoxContainer.new()
	box.add_theme_constant_override("separation", 8)
	panel.add_child(box)
	var head := Hud.kicker(title, NeonTheme.colors()[0])
	head.label_settings.font_size = 14
	box.add_child(head)
	if hint != "":
		box.add_child(_hint(hint))
	return [panel, box]


func _hint(text: String) -> Label:
	return Hud.text(text, 13, Color(0.91, 0.91, 0.94, 0.72))


func _link(text: String) -> Button:
	var b := Button.new()
	b.text = text
	b.flat = true
	b.add_theme_color_override("font_color", NeonTheme.colors()[0])
	b.add_theme_color_override("font_hover_color", Color.WHITE)
	return b


func _check(text: String, on: bool, changed: Callable) -> CheckBox:
	var c := CheckBox.new()
	c.text = text
	c.button_pressed = on
	c.toggled.connect(changed)
	return c


func _radios(options: Array, current: String, changed: Callable) -> HFlowContainer:
	var row := HFlowContainer.new()
	row.add_theme_constant_override("h_separation", 14)
	var group := ButtonGroup.new()
	for o: Array in options:
		var r := CheckBox.new()
		r.button_group = group
		r.text = String(o[1])
		r.button_pressed = String(o[0]) == current
		if o.size() > 2:
			r.tooltip_text = String(o[2])
		var value := String(o[0])
		r.toggled.connect(func(on: bool) -> void:
			if on:
				changed.call(value))
		row.add_child(r)
	return row


# ---- Look and feel -------------------------------------------------------------------------------------------------

func _look_section() -> Control:
	var parts := _section("Look and feel", "A profile is a look for the whole interface; every screen works the same in each one. Pick one to load it. Neon Grid is the look OpenMTG was designed in: save it as a profile of your own to change its colors, text size and backgrounds. Changes are saved at once.")
	_look_box = parts[1]
	_fill_look()
	return parts[0]


func _fill_look() -> void:
	# Keep the heading and the hint; rebuild the rest.
	while _look_box.get_child_count() > 2:
		var c := _look_box.get_child(2)
		_look_box.remove_child(c)
		c.queue_free()
	_look_form = null
	var list := GridContainer.new()
	list.columns = 3
	list.add_theme_constant_override("h_separation", 8)
	list.add_theme_constant_override("v_separation", 8)
	var group := ButtonGroup.new()
	_look_box.add_child(Hud.kicker("Templates", Hud.MUTED))
	var templates := GridContainer.new()
	templates.columns = 3
	templates.add_child(_profile_option({"id": Settings.TEMPLATE_ID, "name": Settings.TEMPLATE_NAME, "look": Settings.template_look()},
		"Template", group))
	_look_box.add_child(templates)
	if not Settings.profiles.is_empty():
		_look_box.add_child(Hud.kicker("My profiles", Hud.MUTED))
		for p: Dictionary in Settings.profiles:
			list.add_child(_profile_option(p, "Based on Neon Grid", group))
		_look_box.add_child(list)
	var actions := HFlowContainer.new()
	actions.add_theme_constant_override("h_separation", 8)
	var full := Settings.profiles.size() >= Settings.MAX_PROFILES
	var save := Hud.primary("Save as new profile", 15)
	save.custom_minimum_size = Vector2(0, 40)
	save.disabled = full
	save.pressed.connect(_open_save_form)
	actions.add_child(save)
	var rename := Hud.button("Rename")
	rename.disabled = Settings.is_template_active()
	rename.pressed.connect(_open_rename_form)
	actions.add_child(rename)
	var delete := Hud.button("Delete")
	delete.set_meta(&"slab", "danger")
	delete.disabled = Settings.is_template_active()
	delete.pressed.connect(_open_delete_confirm)
	actions.add_child(delete)
	var export := Hud.button("Export")
	export.pressed.connect(_export_profile)
	actions.add_child(export)
	var import := Hud.button("Import")
	import.disabled = full
	import.pressed.connect(_import_profile)
	actions.add_child(import)
	_look_box.add_child(actions)
	if full:
		_look_box.add_child(_hint("You have %d profiles, the most there can be; delete one to make another." % Settings.MAX_PROFILES))
	_look_message = _hint(_look_message.text if _look_message != null else "")
	_look_box.add_child(_look_message)
	_look_message.visible = _look_message.text != ""
	if Settings.is_template_active():
		_look_box.add_child(_hint("%s is a template and cannot be changed. Save it as a new profile to customize its colors, text size and backgrounds." % Settings.TEMPLATE_NAME))
	else:
		_look_box.add_child(_customize_panel())


func _say(text: String) -> void:
	_look_message.text = text
	_look_message.visible = text != ""


func _profile_option(p: Dictionary, line: String, group: ButtonGroup) -> Control:
	var b := Button.new()
	b.toggle_mode = true
	b.button_group = group
	b.set_meta(&"slab", "none")
	b.button_pressed = String(p["id"]) == Settings.active_profile
	b.custom_minimum_size = Vector2(270, 54)
	var neon := NeonTheme.colors()[0]
	for state: String in ["normal", "hover", "pressed", "hover_pressed"]:
		var s := StyleBoxFlat.new()
		s.bg_color = Color(0.06, 0.09, 0.18, 0.9) if state.begins_with("hover") else Color(0.035, 0.055, 0.12, 0.9)
		s.set_border_width_all(2 if state.contains("pressed") else 1)
		s.border_color = neon if state.contains("pressed") else Color(neon, 0.35)
		s.set_corner_radius_all(10)
		s.set_content_margin_all(10)
		b.add_theme_stylebox_override(state, s)
	var row := HBoxContainer.new()
	row.mouse_filter = Control.MOUSE_FILTER_IGNORE
	row.set_anchors_and_offsets_preset(Control.PRESET_FULL_RECT)
	row.offset_left = 12
	row.offset_right = -12
	var words := VBoxContainer.new()
	words.mouse_filter = Control.MOUSE_FILTER_IGNORE
	words.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	words.alignment = BoxContainer.ALIGNMENT_CENTER
	var title := Label.new()
	title.text = String(p["name"])
	title.add_theme_font_override("font", Hud.bold_font())
	title.text_overrun_behavior = TextServer.OVERRUN_TRIM_ELLIPSIS
	words.add_child(title)
	words.add_child(Hud.text(line, 11))
	row.add_child(words)
	var colors: Dictionary = (p["look"] as Dictionary)["colors"]
	for k: String in ["neon", "neon2"]:
		var chip := ColorRect.new()
		chip.color = Color.html(String(colors.get(k, "#ffffff")))
		chip.custom_minimum_size = Vector2(12, 22)
		chip.size_flags_vertical = Control.SIZE_SHRINK_CENTER
		chip.mouse_filter = Control.MOUSE_FILTER_IGNORE
		row.add_child(chip)
	b.add_child(row)
	var id := String(p["id"])
	b.toggled.connect(func(on: bool) -> void:
		if on and id != Settings.active_profile:
			Sound.cue("ui.select")
			_look_message = null
			Settings.use_profile(id)
			_fill_look())
	return b


func _open_save_form() -> void:
	var p := Settings.active()
	var start := ("My %s" % p["name"]) if Settings.is_template_active() else ("%s copy" % p["name"])
	_name_form("Name of the new profile", start, "Save", func(text: String) -> void:
		var saved := Settings.save_as_profile(text)
		_look_message = _hint("Saved and loaded “%s”." % saved if saved != "" else "")
		_fill_look())


func _open_rename_form() -> void:
	var p := Settings.active()
	_name_form("New name", String(p["name"]), "Save name", func(text: String) -> void:
		Settings.rename_profile(String(p["id"]), text)
		_look_message = null
		_fill_look())


## An inline form: a name field (Enter saves, Esc cancels), its button and Cancel.
func _name_form(label: String, start: String, button: String, done: Callable) -> void:
	if _look_form != null and is_instance_valid(_look_form):
		_look_form.queue_free()
	var row := HBoxContainer.new()
	row.add_theme_constant_override("separation", 8)
	var caption := Label.new()
	caption.text = label
	caption.size_flags_vertical = Control.SIZE_SHRINK_CENTER
	row.add_child(caption)
	var field := LineEdit.new()
	field.text = start
	field.max_length = Settings.MAX_PROFILE_NAME
	field.custom_minimum_size = Vector2(260, 0)
	row.add_child(field)
	var ok := Hud.primary(button, 14)
	ok.custom_minimum_size = Vector2(0, 36)
	row.add_child(ok)
	var cancel := Hud.button("Cancel")
	row.add_child(cancel)
	var submit := func() -> void:
		if field.text.strip_edges() != "":
			done.call(field.text)
	ok.pressed.connect(submit)
	field.text_submitted.connect(func(_t: String) -> void: submit.call())
	field.text_changed.connect(func(t: String) -> void: ok.disabled = t.strip_edges() == "")
	cancel.pressed.connect(func() -> void: row.queue_free())
	field.gui_input.connect(func(e: InputEvent) -> void:
		if e.is_action_pressed("ui_cancel"):
			row.queue_free())
	_look_box.add_child(row)
	_look_box.move_child(row, _look_message.get_index())
	_look_form = row
	field.grab_focus()
	field.select_all()


func _open_delete_confirm() -> void:
	var p := Settings.active()
	if _look_form != null and is_instance_valid(_look_form):
		_look_form.queue_free()
	var row := HBoxContainer.new()
	row.add_theme_constant_override("separation", 8)
	var q := Label.new()
	q.text = "Delete the profile “%s”? The Neon Grid template takes its place." % p["name"]
	q.size_flags_vertical = Control.SIZE_SHRINK_CENTER
	row.add_child(q)
	var yes := Hud.button("Delete")
	yes.set_meta(&"slab", "danger")
	yes.pressed.connect(func() -> void:
		var gone := String(p["name"])
		Settings.delete_profile(String(p["id"]))
		_look_message = _hint("Deleted “%s”." % gone)
		_fill_look())
	row.add_child(yes)
	var cancel := Hud.button("Cancel")
	cancel.pressed.connect(func() -> void:
		Sound.cue("ui.close")
		row.queue_free())
	row.add_child(cancel)
	_look_box.add_child(row)
	_look_box.move_child(row, _look_message.get_index())
	_look_form = row


func _export_profile() -> void:
	var p := Settings.active()
	var safe := ""
	for ch: String in String(p["name"]).split(""):
		if ch.is_valid_identifier() or ch.is_valid_int() or ch == "-" or ch == " " or ch == "_":
			safe += ch
	safe = safe.strip_edges()
	var dialog := FileDialog.new()
	dialog.file_mode = FileDialog.FILE_MODE_SAVE_FILE
	dialog.access = FileDialog.ACCESS_FILESYSTEM
	dialog.use_native_dialog = true
	dialog.filters = PackedStringArray(["*.openmtg-profile.json ; OpenMTG profile"])
	dialog.current_file = (safe if safe != "" else "profile") + ".openmtg-profile.json"
	dialog.file_selected.connect(func(path: String) -> void:
		var f := FileAccess.open(path, FileAccess.WRITE)
		if f == null:
			_say("The file could not be saved.")
			return
		f.store_string(Settings.export_profile())
		f.close()
		_say("Exported “%s”." % p["name"]))
	add_child(dialog)
	dialog.popup_centered(Vector2i(800, 500))


func _import_profile() -> void:
	var dialog := FileDialog.new()
	dialog.file_mode = FileDialog.FILE_MODE_OPEN_FILE
	dialog.access = FileDialog.ACCESS_FILESYSTEM
	dialog.use_native_dialog = true
	dialog.filters = PackedStringArray(["*.json ; JSON"])
	dialog.file_selected.connect(func(path: String) -> void:
		var r: Array = Settings.import_profile(FileAccess.get_file_as_string(path))
		_look_message = _hint("Imported and loaded “%s”." % r[0] if String(r[0]) != "" else String(r[1]))
		_fill_look())
	add_child(dialog)
	dialog.popup_centered(Vector2i(800, 500))


func _customize_panel() -> Control:
	var box := VBoxContainer.new()
	box.add_theme_constant_override("separation", 10)
	box.add_child(HSeparator.new())
	box.add_child(Hud.kicker("Template", Hud.MUTED))
	box.add_child(_hint("The DigiDice neon room: dark glass panels with neon edges, raised slab buttons and a glowing grid floor."))
	box.add_child(Hud.kicker("Palettes", Hud.MUTED))
	var palettes := HFlowContainer.new()
	palettes.add_theme_constant_override("h_separation", 8)
	for preset: String in NeonTheme.PRESET_ORDER:
		var b := Hud.button(preset)
		var pc := NeonTheme.preset_colors(preset)
		var chips := HBoxContainer.new()
		chips.mouse_filter = Control.MOUSE_FILTER_IGNORE
		for c: Color in pc:
			var chip := ColorRect.new()
			chip.color = c
			chip.custom_minimum_size = Vector2(10, 18)
			chip.mouse_filter = Control.MOUSE_FILTER_IGNORE
			chips.add_child(chip)
		chips.position = Vector2(10, 9)
		b.add_child(chips)
		b.alignment = HORIZONTAL_ALIGNMENT_RIGHT
		b.custom_minimum_size = Vector2(140, 38)
		b.pressed.connect(func() -> void:
			Settings.set_preset(preset)
			_fill_look())
		palettes.add_child(b)
	box.add_child(palettes)
	var pickers := HFlowContainer.new()
	pickers.add_theme_constant_override("h_separation", 24)
	for slot: Array in [["neon", "Neon", "Edges, glows, the lit tab and the main buttons"],
			["neon2", "Second neon", "Corner brackets, the horizon and the danger buttons"]]:
		var item := HBoxContainer.new()
		item.tooltip_text = String(slot[2])
		var picker := ColorPickerButton.new()
		picker.custom_minimum_size = Vector2(44, 32)
		picker.edit_alpha = false
		picker.color = Settings.neon if slot[0] == "neon" else Settings.neon2
		var key := String(slot[0])
		picker.color_changed.connect(func(c: Color) -> void:
			Settings.update_look({"colors": {key: "#" + c.to_html(false)}}))
		item.add_child(picker)
		var words := VBoxContainer.new()
		var name_label := Label.new()
		name_label.text = String(slot[1])
		name_label.add_theme_font_override("font", Hud.bold_font())
		words.add_child(name_label)
		words.add_child(Hud.text(String(slot[2]), 11))
		item.add_child(words)
		pickers.add_child(item)
	box.add_child(pickers)
	box.add_child(Hud.kicker("Text size", Hud.MUTED))
	var sizes: Array = []
	for t: float in Settings.TEXT_SIZES:
		sizes.append([str(t), "%d%%" % roundi(t * 100.0)])
	box.add_child(_radios(sizes, str(Settings.text_size), func(v: String) -> void: Settings.update_look({"textSize": float(v)})))
	box.add_child(_check("Neon grid floor and horizon behind every screen", Settings.look_scene,
		func(on: bool) -> void: Settings.update_look({"scene": on})))
	box.add_child(_check("Moving backgrounds", Settings.look_motion, func(on: bool) -> void: Settings.update_look({"motion": on})))
	box.add_child(_hint("Backgrounds also stay still with Reduced motion (under Animation speed)."))
	var reset := _link("Reset to the Neon Grid template")
	reset.size_flags_horizontal = Control.SIZE_SHRINK_BEGIN
	reset.pressed.connect(func() -> void:
		Settings.reset_look()
		_fill_look())
	box.add_child(reset)
	return box


# ---- the other sections ----------------------------------------------------------------------------------------------

func _images_section() -> Control:
	var parts := _section("Card images")
	var box: VBoxContainer = parts[1]
	box.add_child(_check("Show card images from Scryfall", Settings.scryfall_images, func(on: bool) -> void: Settings.set_scryfall_images(on)))
	box.add_child(_hint("On by default. OpenMTG downloads card pictures from Scryfall and keeps them on this computer. Your own images always come first, and cards without an image show a text frame."))
	var images := _link("Your own card images: the Images screen")
	images.size_flags_horizontal = Control.SIZE_SHRINK_BEGIN
	images.pressed.connect(func() -> void: Nav.go("images"))
	box.add_child(images)
	return parts[0]


func _stops_section() -> Control:
	var parts := _section("Stops for new games", "Steps where the game stops for you when you could play a land, cast a spell or activate an ability; in other steps it passes priority for you, the way Arena does. If you can do nothing, it always passes for you, stop or not, and also while your own spell or ability is on top of the stack, so the opponent can respond. Full control stops at every step. In a game, Hold priority (next to Pass, key H) stops at every priority until the end of that turn, also right after your own spells.")
	var box: VBoxContainer = parts[1]
	var full := _check("Full control: never pass priority automatically", Settings.full_control, func(on: bool) -> void:
		Settings.set_stops(Settings.stops_own, Settings.stops_opponent, on)
		for c: CheckBox in _stop_boxes:
			c.disabled = on
			c.modulate.a = 0.4 if on else 1.0)
	box.add_child(full)
	var grid := GridContainer.new()
	grid.columns = 3
	grid.add_theme_constant_override("h_separation", 24)
	for h: String in ["Step", "My turn", "Opponent's turn"]:
		grid.add_child(Hud.kicker(h, Hud.MUTED))
	_stop_boxes.clear()
	for row: Array in STOP_ROWS:
		var step := String(row[0])
		var label := Label.new()
		label.text = String(row[1])
		grid.add_child(label)
		for mine: bool in [true, false]:
			var c := CheckBox.new()
			c.button_pressed = Settings.stops_own.has(step) if mine else Settings.stops_opponent.has(step)
			c.tooltip_text = "Stop in %s on %s" % [row[1], "my turn" if mine else "the opponent's turn"]
			c.disabled = Settings.full_control
			c.modulate.a = 0.4 if Settings.full_control else 1.0
			c.toggled.connect(func(on: bool) -> void:
				var own := Settings.stops_own.duplicate()
				var opp := Settings.stops_opponent.duplicate()
				var list: Array = own if mine else opp
				if on and not list.has(step):
					list.append(step)
				elif not on:
					list.erase(step)
				Settings.set_stops(_in_turn_order(own), _in_turn_order(opp), Settings.full_control))
			_stop_boxes.append(c)
			grid.add_child(c)
	box.add_child(grid)
	return parts[0]


static func _in_turn_order(steps: Array) -> Array:
	var out: Array = []
	for s: String in Config.STEP_ORDER:
		if steps.has(s):
			out.append(s)
	return out


func _speed_section() -> Control:
	var parts := _section("Animation speed")
	var box: VBoxContainer = parts[1]
	box.add_child(_radios([["off", "Off"], ["fast", "Fast"], ["normal", "Normal"], ["slow", "Slow"]], Settings.animation_speed,
		func(v: String) -> void: Settings.set_animation_speed(v)))
	box.add_child(_check("Reduced motion: show every change at once and keep backgrounds still", Settings.reduced_motion,
		func(on: bool) -> void: Settings.set_reduced_motion(on)))
	return parts[0]


func _table_section() -> Control:
	var parts := _section("Table (three or four players)", "How a game with three or four players is drawn; a two-player game looks the same in every layout. The table has the same switch during a game.")
	var box: VBoxContainer = parts[1]
	var hint := _hint("")
	for r: Array in LAYOUT_ROWS:
		if r[0] == Settings.table_layout:
			hint.text = String(r[2])
	box.add_child(_radios(LAYOUT_ROWS, Settings.table_layout, func(v: String) -> void:
		Settings.set_table_layout(v)
		for r: Array in LAYOUT_ROWS:
			if r[0] == v:
				hint.text = String(r[2])))
	box.add_child(hint)
	box.add_child(_check("Camera follows the mouse", Settings.camera_follow, func(on: bool) -> void: Settings.set_camera_follow(on)))
	box.add_child(_hint("On the shared table the camera looks where the mouse points. Off: the camera stays still and shows the whole table (zoom with + and -, pan with the arrow keys, Home to recentre). It is also still with Reduced motion."))
	return parts[0]


func _names_section() -> Control:
	var parts := _section("Player names", "The names the New game screen starts with (players 3 and 4 in games with more players). Starting a game keeps the names of the people who played it here; a computer's name is never kept.")
	var box: VBoxContainer = parts[1]
	var grid := GridContainer.new()
	grid.columns = 2
	grid.add_theme_constant_override("h_separation", 12)
	for i: int in 4:
		var label := Label.new()
		label.text = "Player %d" % (i + 1)
		label.custom_minimum_size = Vector2(80, 0)
		grid.add_child(label)
		var field := LineEdit.new()
		field.text = Settings.player_names[i]
		field.max_length = Settings.MAX_NAME_LENGTH
		field.size_flags_horizontal = Control.SIZE_EXPAND_FILL
		# Stored when the field loses the focus, as the browser's.
		field.focus_exited.connect(func() -> void:
			Settings.set_player_name(i, field.text)
			field.text = Settings.player_names[i])
		grid.add_child(field)
	box.add_child(grid)
	return parts[0]


func _sound_section() -> Control:
	var parts := _section("Sound")
	var box: VBoxContainer = parts[1]
	var off_hint := _hint("Sound is off: nothing plays, the tests and the list below included.")
	off_hint.visible = not Settings.sound_on
	box.add_child(_check("Sound effects", Settings.sound_on, func(on: bool) -> void:
		Settings.set_sound(on, Settings.sound_volume)
		off_hint.visible = not on))
	box.add_child(off_hint)
	var grid := GridContainer.new()
	grid.columns = 4
	grid.add_theme_constant_override("h_separation", 14)
	for row: Array in [["master", "Master", ""], ["interface", "Interface", "ui.confirm"], ["game", "Game", "turn.mine"],
			["ambience", "Ambience", "ambient.grid"]]:
		var kind := String(row[0])
		var label := Label.new()
		label.text = String(row[1])
		grid.add_child(label)
		var slider := HSlider.new()
		slider.min_value = 0
		slider.max_value = 100
		slider.step = 1
		slider.custom_minimum_size = Vector2(240, 0)
		slider.size_flags_vertical = Control.SIZE_SHRINK_CENTER
		var current: float = {"master": Settings.sound_volume, "interface": Settings.volume_interface, "game": Settings.volume_game,
			"ambience": Settings.volume_ambience}[kind]
		slider.value = roundf(current * 100.0)
		var value := Label.new()
		value.text = "%d%%" % roundi(slider.value)
		value.custom_minimum_size = Vector2(48, 0)
		value.horizontal_alignment = HORIZONTAL_ALIGNMENT_RIGHT
		slider.value_changed.connect(func(v: float) -> void:
			value.text = "%d%%" % roundi(v)
			Settings.set_volume(kind, v / 100.0))
		grid.add_child(slider)
		grid.add_child(value)
		if String(row[2]) == "":
			grid.add_child(Control.new())
		elif kind == "ambience":
			_ambience_test = Hud.button("Test")
			_ambience_test.tooltip_text = "Test the ambience"
			_ambience_test.pressed.connect(_toggle_ambience_test)
			grid.add_child(_ambience_test)
		else:
			var test := Hud.button("Test")
			test.set_meta(&"slab_depth", 2.0)
			test.tooltip_text = "Test the %s sounds" % kind
			var id := String(row[2])
			test.pressed.connect(func() -> void:
				UiSounds.claim()
				Sound.cue(id))
			grid.add_child(test)
	box.add_child(grid)
	box.add_child(_all_sounds())
	return parts[0]


func _toggle_ambience_test() -> void:
	if _ambience_test.text == "Stop":
		_ambience_test.text = "Test"
		Sound.release_ambience()
		return
	_ambience_test.text = "Stop"
	Sound.hold_ambience()
	var mine := get_tree().create_timer(4.0)
	_ambience_timer = mine
	mine.timeout.connect(func() -> void:
		if _ambience_timer == mine and _ambience_test != null and is_instance_valid(_ambience_test) and _ambience_test.text == "Stop":
			_ambience_test.text = "Test"
			Sound.release_ambience())


## "All sounds": every sound with what it must tell you, each with Play, folded until opened.
func _all_sounds() -> Control:
	var box := VBoxContainer.new()
	var toggle := Button.new()
	toggle.text = "▸ All sounds"
	toggle.flat = true
	toggle.toggle_mode = true
	toggle.alignment = HORIZONTAL_ALIGNMENT_LEFT
	toggle.add_theme_color_override("font_color", NeonTheme.colors()[0])
	box.add_child(toggle)
	var body := VBoxContainer.new()
	body.visible = false
	box.add_child(body)
	toggle.toggled.connect(func(on: bool) -> void:
		toggle.text = ("▾ " if on else "▸ ") + "All sounds"
		body.visible = on
		UiSounds.claim()
		Sound.cue("ui.open" if on else "ui.close")
		if on and body.get_child_count() == 0:
			_fill_sounds(body))
	return box


func _fill_sounds(body: VBoxContainer) -> void:
	body.add_child(_hint("Every sound in OpenMTG, played at the volumes above, with what it must tell you."))
	var meta := Val.as_dict(JSON.parse_string(FileAccess.get_file_as_string(SOUNDS_PATH)))
	for g: Array in SOUND_GROUPS:
		var ids: Array = g[1]
		body.add_child(Hud.kicker("%s (%d)" % [g[0], ids.size()], Hud.MUTED))
		var grid := GridContainer.new()
		grid.columns = 3
		grid.add_theme_constant_override("h_separation", 14)
		for id: String in ids:
			var name_label := Label.new()
			name_label.text = id
			name_label.add_theme_color_override("font_color", NeonTheme.colors()[0])
			name_label.custom_minimum_size = Vector2(170, 0)
			grid.add_child(name_label)
			var info := Val.dict(meta, id)
			var purpose := Hud.text(Val.text(info, "purpose"), 12)
			purpose.size_flags_horizontal = Control.SIZE_EXPAND_FILL
			purpose.tooltip_text = Val.text(info, "when")
			purpose.mouse_filter = Control.MOUSE_FILTER_PASS
			grid.add_child(purpose)
			var play := Hud.button("Play")
			play.set_meta(&"slab_depth", 2.0)
			play.tooltip_text = "Play %s" % id
			play.pressed.connect(func() -> void:
				UiSounds.claim()
				Sound.cue(id))
			grid.add_child(play)
		body.add_child(grid)
