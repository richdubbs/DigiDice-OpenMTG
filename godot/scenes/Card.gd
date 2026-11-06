class_name CardView
extends Control
## One card on the table: the own frame (shaders/card_frame.gdshader), the procedural art
## (shaders/procedural_art.gdshader, seeded by model/ArtSeed.gd exactly as the browser's CardArt.tsx), the name, mana cost,
## type line, rules text and power/toughness, status chips above the card (counters, damage, sick, attacking, blocking,
## attachments), and a Glow sprite behind it for playable / selectable / selected states.
##
## The card shows what the view says and nothing else. Hidden cards (another player's hand, a library, a face-down card the
## viewer may not see) are the sleeve. Only position, rotation, scale and modulate are ever animated (fx/Animator.gd); the glow is
## its own child with its own modulate, and the animator's flashes are more such children (`add_flash`).
##
## Pictures (autoload Pictures): when the player's own picture or (setting on) Scryfall's exists for the shown face, it is the whole
## card: drawn as it is (aspect ratio kept, no filter, tint or overlay), the frame, art and texts hidden; the chips stay above the
## card, beside the picture, so its artist line is never covered. A picture still on its way arrives with Pictures.picture_ready.

signal clicked(id: String)
signal right_clicked(id: String)
signal hovered(id: String, inside: bool)
## A draggable card (the viewer's hand) moved by the pointer past DRAG_START_PX: picked up, moving, let go (global positions).
## A drag never counts as a click.
signal drag_started(id: String)
signal drag_moved(id: String, at: Vector2)
signal drag_ended(id: String, at: Vector2)

const DRAG_START_PX: float = 8.0

const SIZE: Vector2 = Vector2(120, 168)
## Below this on-screen width the type line and rules text hide (a visibility toggle).
const COMPACT_WIDTH: float = 120.0

enum GlowKind { NONE, PLAYABLE, SELECTABLE, SELECTED, ATTACKING, BLOCKING }

## The glow's ring and halo (set_glow).
const RING_WIDTH: int = 2
const RING_GLOW: int = 14
const HALO_GLOW: int = 22
const CORNER_RADIUS: int = 6
const BREATHE_S: float = 2.2
const SELECTABLE_BREATHE_S: float = 1.2

## Frame tones per colour (W, U, B, R, G), colourless, land and gold.
const TONES: Dictionary = {
	"W": Color(0.82, 0.79, 0.68), "U": Color(0.2, 0.42, 0.75), "B": Color(0.3, 0.26, 0.33), "R": Color(0.72, 0.26, 0.19),
	"G": Color(0.22, 0.52, 0.3), "C": Color(0.55, 0.57, 0.62), "land": Color(0.52, 0.44, 0.36), "gold": Color(0.8, 0.65, 0.3),
}

var object_id: String = ""
var hidden_card: bool = false
## A prompt's short text for this card (BoardSelection.marks), shown as the first chip.
var _mark: String = ""
var _mark_chip: Label = null
var _art_key: String = ""
var _chip_style: StyleBoxFlat = null
## The picture this card shows or waits for (Pictures.key_for), "" for the own frame; and its source ("player", "scryfall" or "").
var picture_key: String = ""
var picture_kind: String = ""
var _glow_kind: GlowKind = GlowKind.NONE
var _pending_glow: GlowKind = GlowKind.NONE
var _ring: Panel = null
var _ring_style: StyleBoxFlat = null
var _halo: Panel = null
var _halo_style: StyleBoxFlat = null
var _breathe: Tween = null
## What is drawn ON a permanent (CardOverlay.tsx): its power/toughness (or loyalty, defense) plate and its counters.
var _overlay: Control = null
var _has_plate: bool = false

@onready var _glow: Sprite2D = $Glow
@onready var _frame: ColorRect = $Frame
@onready var _art: ColorRect = $Art
@onready var _name: Label = $Name
@onready var _cost: Label = $Cost
@onready var _type: Label = $Type
@onready var _rules: RichTextLabel = $Rules
@onready var _pt: Label = $PT
@onready var _chips: HBoxContainer = $Chips
@onready var _picture: TextureRect = $Picture


func _ready() -> void:
	mouse_filter = Control.MOUSE_FILTER_STOP
	_make_glow_panels()
	set_glow(_pending_glow)
	mouse_entered.connect(func() -> void: hovered.emit(object_id, true))
	mouse_exited.connect(func() -> void: hovered.emit(object_id, false))
	_chip_style = StyleBoxFlat.new()
	_chip_style.bg_color = Color(0.02, 0.03, 0.07, 0.92)
	_chip_style.set_border_width_all(1)
	_chip_style.set_corner_radius_all(3)
	_chip_style.content_margin_left = 3.0
	_chip_style.content_margin_right = 3.0
	_set_frame_param("size", SIZE)
	var colors := NeonTheme.colors()
	_set_frame_param("rim", colors[0])
	_set_frame_param("rim2", colors[1])
	_chip_style.border_color = colors[0]
	Pictures.picture_ready.connect(_on_picture_ready)


## A card in the viewer's hand: a press becomes a click only when let go without moving; moving it drags it (Hand.tsx).
var draggable: bool = false
var _press_at: Vector2 = Vector2.ZERO
var _pressing: bool = false
var _dragging: bool = false


func _gui_input(event: InputEvent) -> void:
	var motion := event as InputEventMouseMotion
	if motion != null and _pressing and draggable:
		if not _dragging and motion.global_position.distance_to(_press_at) > DRAG_START_PX:
			_dragging = true
			drag_started.emit(object_id)
		if _dragging:
			drag_moved.emit(object_id, motion.global_position)
		accept_event()
		return
	var mb := event as InputEventMouseButton
	if mb == null:
		return
	if mb.button_index == MOUSE_BUTTON_LEFT:
		if mb.pressed:
			if draggable:
				_pressing = true
				_dragging = false
				_press_at = mb.global_position
			else:
				clicked.emit(object_id)
		elif _pressing:
			_pressing = false
			if _dragging:
				_dragging = false
				drag_ended.emit(object_id, mb.global_position)
			else:
				clicked.emit(object_id)
		accept_event()
	elif mb.button_index == MOUSE_BUTTON_RIGHT and mb.pressed:
		right_clicked.emit(object_id)
		accept_event()


## Show the object `id` of `view` (or its card back when the viewer can't see it).
func show_object(view: Dictionary, id: String) -> void:
	object_id = id
	var obj := View.object(view, id)
	if obj.is_empty() or View.is_hidden(obj):
		show_back()
		return
	hidden_card = false
	_set_frame_param("sleeve", false)
	_frame.visible = true
	_art.visible = true
	for l: Control in [_name, _cost, _type, _rules]:
		l.visible = true
	var chars := Chars.of(view, obj)
	var kind := Val.text(obj, "kind")
	var title := View.name_of(view, obj)
	var type_line := Val.text(chars, "type_line")
	var text := Val.text(chars, "text")
	# The art is seeded by the printed text (as the browser's CardArt), not by the abilities' readings shown.
	var art_text := Val.text(chars, "printed_text")
	if kind == "ability":
		var st := Val.dict(obj, "stack")
		type_line = "Triggered ability" if Val.text(st, "kind") == "triggered" else "Activated ability"
		text = ""
		art_text = ""
	elif View.is_face_down_profile(obj):
		title = "Face-down"
		type_line = "Creature"
	_name.text = title
	_cost.text = Val.text(chars, "mana_cost")
	_type.text = type_line
	_rules.text = _escape(text)
	var power := Val.text(chars, "power")
	var toughness := Val.text(chars, "toughness")
	var loyalty := Val.text(chars, "loyalty")
	var defense := Val.text(chars, "defense")
	if power != "" or toughness != "":
		_pt.text = "%s/%s" % [power, toughness]
	elif loyalty != "":
		_pt.text = str(Val.num(Val.dict(obj, "counters"), "loyalty", loyalty.to_int())) if Val.text(obj, "zone") == "battlefield" else loyalty
	elif defense != "":
		_pt.text = defense
	else:
		_pt.text = ""
	_pt.visible = _pt.text != ""
	var colors := Val.texts(chars, "colors")
	_set_tone(colors, Chars.has_type(chars, "Land"))
	_set_art(title, colors, type_line, art_text)
	rotation_degrees = 90.0 if Val.flag(obj, "tapped") else 0.0
	_set_chips(view, obj, chars)
	var def := View.def_of(view, obj)
	_set_overlay(obj, def, chars)
	# An ability shows the card it comes from (StackPanel.tsx AbilityTile), unless that is an emblem or face down.
	var ability_card := kind == "ability" and not def.is_empty() and Val.text(def, "layout") != "emblem" and not Val.flag(obj, "faceDown") 		and not Val.list(def, "faces").is_empty()
	if ability_card:
		var ref_face := int(Val.num(Val.dict(Val.dict(obj, "stack"), "abilityRef"), "face", int(Val.num(obj, "face"))))
		var face := clampi(ref_face, 0, Val.list(def, "faces").size() - 1)
		picture_key = Pictures.key_for(def, face)
		_set_picture(Pictures.texture_for(def, face))
	elif kind != "ability" and not View.is_face_down_profile(obj) and not def.is_empty():
		var face := View.shown_face(def, obj)
		picture_key = Pictures.key_for(def, face)
		_set_picture(Pictures.texture_for(def, face))
	else:
		picture_key = ""
		_set_picture(null)


## The card back (the sleeve placeholder).
func show_back() -> void:
	hidden_card = true
	_set_frame_param("sleeve", true)
	_frame.visible = true
	_art.visible = false
	for l: Control in [_name, _cost, _type, _rules, _pt]:
		l.visible = false
	for c: Node in _chips.get_children():
		c.queue_free()
	_mark = ""
	_mark_chip = null
	if _overlay != null:
		_overlay.visible = false
	rotation_degrees = 0.0
	picture_key = ""
	_set_picture(null)


## A prompt's short text for this card ("" removes it), drawn as a chip above the card, never over the picture.
func set_mark(text: String) -> void:
	if text == _mark:
		return
	_mark = text
	if _mark_chip != null:
		_mark_chip.queue_free()
		_mark_chip = null
	if text == "":
		return
	_mark_chip = _make_chip(text)
	_mark_chip.add_theme_color_override("font_color", NeonTheme.colors()[1].lightened(0.35))
	_chips.add_child(_mark_chip)
	_chips.move_child(_mark_chip, 0)


## The glow: a lit ring round the card's edge, and for a card usable now (PLAYABLE) or to choose (SELECTABLE) a halo outside it
## that breathes, as the browser's board does (arena.css hl-playable: a 2 px ring with a 14 px glow, a 22 px halo fading in and
## out every 2.2 s; hl-selectable every 1.2 s, to full).
## The other kinds keep their light behind the card as well. NONE hides it all. Nothing is drawn over the picture.
## The keyboard's focus (Tab on the table): a white outline round the card.
func set_key_focus(on: bool) -> void:
	var ring := get_node_or_null("KeyFocus") as Panel
	if ring == null:
		if not on:
			return
		ring = Panel.new()
		ring.name = "KeyFocus"
		var s := StyleBoxFlat.new()
		s.bg_color = Color(0, 0, 0, 0)
		s.set_border_width_all(3)
		s.border_color = Color("#eaf7ff")
		s.set_corner_radius_all(8)
		s.set_expand_margin_all(4)
		ring.add_theme_stylebox_override("panel", s)
		ring.mouse_filter = Control.MOUSE_FILTER_IGNORE
		ring.size = SIZE
		add_child(ring)
	ring.visible = on


func set_glow(kind: GlowKind) -> void:
	if _ring == null:
		_pending_glow = kind # before _ready: applied there
		return
	if kind == _glow_kind:
		return
	_glow_kind = kind
	var colors := NeonTheme.colors()
	if _breathe != null:
		_breathe.kill()
		_breathe = null
	_halo.visible = false
	var tint := Color.TRANSPARENT
	match kind:
		GlowKind.NONE:
			_glow.visible = false
			_ring.visible = false
			return
		GlowKind.PLAYABLE:
			tint = colors[0]
		GlowKind.SELECTABLE:
			tint = colors[0]
		GlowKind.SELECTED:
			tint = colors[1]
		GlowKind.ATTACKING:
			tint = Color(1.0, 0.35, 0.2)
		GlowKind.BLOCKING:
			tint = Color(0.4, 0.8, 1.0)
	_ring_style.border_color = tint
	_ring_style.shadow_color = Color(tint, 0.75)
	_ring.visible = true
	if kind == GlowKind.PLAYABLE or kind == GlowKind.SELECTABLE:
		# Usable now: 2.2 s up to 0.8 (playable-glow); a choice to make: faster, 1.2 s up to full (selectable-glow).
		var period := BREATHE_S if kind == GlowKind.PLAYABLE else SELECTABLE_BREATHE_S
		var peak := 0.8 if kind == GlowKind.PLAYABLE else 1.0
		_glow.visible = false
		_halo_style.shadow_color = tint
		_halo.modulate.a = 0.0
		_halo.visible = true
		if Settings.reduced_motion:
			_halo.modulate.a = peak * 0.6
			return
		_breathe = create_tween().set_loops()
		_breathe.tween_property(_halo, "modulate:a", peak, period / 2.0).set_trans(Tween.TRANS_SINE).set_ease(Tween.EASE_IN_OUT)
		_breathe.tween_property(_halo, "modulate:a", 0.0, period / 2.0).set_trans(Tween.TRANS_SINE).set_ease(Tween.EASE_IN_OUT)
		return
	_glow.modulate = Color(tint, 1.0 if kind == GlowKind.SELECTED else 0.85 if kind != GlowKind.SELECTABLE else 0.9)
	_glow.visible = true


## The ring and the halo: panels the size of the card, behind everything on it, drawing only outside its edge (a border and a
## shadow, never a centre).
func _make_glow_panels() -> void:
	_ring_style = StyleBoxFlat.new()
	_ring_style.draw_center = false
	_ring_style.set_border_width_all(RING_WIDTH)
	_ring_style.set_corner_radius_all(CORNER_RADIUS)
	_ring_style.shadow_size = RING_GLOW
	_ring = Panel.new()
	_ring.name = "Ring"
	_ring.add_theme_stylebox_override("panel", _ring_style)
	_halo_style = StyleBoxFlat.new()
	_halo_style.draw_center = false
	_halo_style.set_corner_radius_all(CORNER_RADIUS)
	_halo_style.shadow_size = HALO_GLOW
	_halo = Panel.new()
	_halo.name = "Halo"
	_halo.add_theme_stylebox_override("panel", _halo_style)
	for p: Panel in [_halo, _ring]:
		p.mouse_filter = Control.MOUSE_FILTER_IGNORE
		p.visible = false
		p.set_anchors_and_offsets_preset(Control.PRESET_FULL_RECT)
		p.offset_left = -RING_WIDTH
		p.offset_top = -RING_WIDTH
		p.offset_right = RING_WIDTH
		p.offset_bottom = RING_WIDTH
		add_child(p)
		move_child(p, _glow.get_index() + 1)


## A glow flash behind the card (a new child under the picture, additive, like Glow): the animator tweens its modulate and frees it.
func add_flash(color: Color, grow: float = 1.0) -> Sprite2D:
	var flash := Sprite2D.new()
	flash.texture = _glow.texture
	flash.material = _glow.material
	flash.position = _glow.position
	flash.scale = _glow.scale * grow
	flash.modulate = Color(color, 0.0)
	add_child(flash)
	move_child(flash, 0)
	return flash


## Whether the card shows a picture (the player's or Scryfall's) instead of the own frame.
func has_picture() -> bool:
	return _picture.visible


func _on_picture_ready(key: String, texture: Texture2D) -> void:
	if key != "" and key == picture_key:
		_set_picture(texture)


## Show a picture as the whole card (null: the own frame).
func _set_picture(texture: Texture2D) -> void:
	var on := texture != null and not hidden_card
	_picture.texture = texture if on else null
	_picture.visible = on
	picture_kind = Pictures.kind_of(picture_key) if on else ""
	if hidden_card:
		return
	_frame.visible = not on
	_art.visible = not on
	_name.visible = not on
	_cost.visible = not on
	# A permanent's plate (the overlay) shows its current numbers instead of the frame's P/T line.
	_pt.visible = not on and _pt.text != "" and not _has_plate
	_apply_compact()


## Draw the card at this scale (the type line and rules text hide when it gets small).
func set_card_scale(s: float) -> void:
	scale = Vector2(s, s)
	_apply_compact()


## Hide the type line and rules text when the card is drawn small (scale below COMPACT_WIDTH on screen).
func _apply_compact() -> void:
	if hidden_card:
		return
	var compact := SIZE.x * scale.x < COMPACT_WIDTH - 0.5
	_type.visible = not compact and not _picture.visible
	_rules.visible = not compact and not _picture.visible


func _set_tone(colors: Array[String], is_land: bool) -> void:
	var a: Color = TONES["C"]
	var b: Color = TONES["C"]
	if colors.size() == 1:
		a = TONES.get(colors[0], TONES["C"])
		b = a
	elif colors.size() == 2:
		a = TONES.get(colors[0], TONES["C"])
		b = TONES.get(colors[1], TONES["C"])
	elif colors.size() > 2:
		a = TONES["gold"]
		b = a
	elif is_land:
		a = TONES["land"]
		b = a
	_set_frame_param("tone", a)
	_set_frame_param("tone2", b)


## Set the art shader's numbers from ArtSeed (only when the card's name, colours or type line change).
func _set_art(seed_name: String, colors: Array[String], type_line: String, text: String) -> void:
	var key := "%s|%s|%s|%s" % [seed_name, "".join(colors), type_line, text.length()]
	if key == _art_key:
		return
	_art_key = key
	var mat := _art.material as ShaderMaterial
	if mat == null:
		return
	var p := ArtSeed.art_params(seed_name, colors, type_line, text)
	var count: int = p["count"]
	var flavors: Array = p["flavors"]
	var palettes: Array = p["palettes"]
	var glows: Array = p["glows"]
	var seeds: Array = p["seeds"]
	var seams: Array = p["seams"]
	mat.set_shader_parameter("scene_count", count)
	mat.set_shader_parameter("land", p["land"])
	mat.set_shader_parameter("gold", p["gold"])
	for i: int in range(3):
		var k: int = mini(i, count - 1)
		var pal: Dictionary = palettes[k]
		mat.set_shader_parameter("flavor_%d" % i, flavors[k])
		mat.set_shader_parameter("sky0_%d" % i, pal["sky0"])
		mat.set_shader_parameter("sky1_%d" % i, pal["sky1"])
		mat.set_shader_parameter("sky2_%d" % i, pal["sky2"])
		mat.set_shader_parameter("glow_%d" % i, pal["glow"])
		mat.set_shader_parameter("light_%d" % i, pal["light"])
		mat.set_shader_parameter("dark_%d" % i, pal["dark"])
		mat.set_shader_parameter("glow_pos_%d" % i, glows[k])
		mat.set_shader_parameter("seed_%d" % i, seeds[k])
	if seams.size() > 0:
		mat.set_shader_parameter("seam_0", seams[0])
	if seams.size() > 1:
		mat.set_shader_parameter("seam_1", seams[1])


## The chips under a permanent (Markers.tsx permanentMarkers, useTargetMarkers): marked damage, attacking or blocking, summoning
## sickness, face down, phased out, attachments, and "Target of" each spell or ability on the stack that targets it; each with
## its rule as the tooltip. Counters and power/toughness are drawn on the card itself (`_set_overlay`).
func _set_chips(view: Dictionary, obj: Dictionary, chars: Dictionary) -> void:
	for c: Node in _chips.get_children():
		if c != _mark_chip:
			c.queue_free()
	var chips: Array = []
	var id := Val.text(obj, "id")
	if Val.text(obj, "kind") == "ability":
		var triggered := Val.text(Val.dict(obj, "stack"), "kind") == "triggered"
		chips.append(["✦ Trigger" if triggered else "⚡ Ability", "Triggered ability (CR 603)" if triggered else "Activated ability (CR 602)"])
	var damage := int(Val.num(obj, "damage"))
	if damage > 0:
		chips.append(["%d damage" % damage, "Damage marked on this permanent (CR 120.3e, 120.6)"])
	if Val.text(obj, "zone") == "battlefield":
		var c := View.combat(view)
		for a: Variant in Val.list(c, "attackers"):
			var ad := Val.as_dict(a)
			if Val.text(ad, "id") == id:
				var where := Val.text(ad, "defender")
				chips.append(["⚔ Attacking %s%s" % [View.name_by_id(view, where) if where != "" else "(its target left combat)",
					" (blocked)" if Val.flag(ad, "blocked") else ""], "Attacking creature (CR 508.1, 509.1h, 506.4c)"])
		for b: Variant in Val.list(c, "blockers"):
			var bd := Val.as_dict(b)
			if Val.text(bd, "id") == id:
				var names: Array[String] = []
				for at: Variant in Val.list(bd, "blocking"):
					names.append(View.name_by_id(view, String(at)))
				chips.append(["🛡 Blocking %s" % ", ".join(names), "Blocking creature (CR 509.1)"])
		if _looks_sick(view, obj, chars):
			chips.append(["zZ", "Summoning sick: can't attack or use {T} abilities yet (CR 302.6)"])
		if Val.flag(obj, "faceDown"):
			chips.append(["Face down", "Face down; only its controller may look at it (CR 708.5)"])
		if Val.flag(obj, "phasedOut"):
			chips.append(["Phased out", "Treated as though it does not exist (CR 702.26b)"])
		var attached := View.attachments_of(view, id).size()
		if attached > 0:
			chips.append(["+%d attached" % attached, "Auras and Equipment attached to it (CR 301.5, 303.4)"])
	for s: String in View.stack(view):
		if s == id:
			continue
		for group: Variant in Val.list(Val.dict(View.object(view, s), "stack"), "targets"):
			for t: Variant in Val.as_list(group):
				if Val.text(Val.as_dict(t), "id") == id:
					chips.append(["Target of %s" % View.name_by_id(view, s), "CR 115.1, 601.2c"])
	for c: Array in chips:
		var chip := _make_chip(String(c[0]))
		chip.tooltip_text = "%s: %s" % [c[0], c[1]] if String(c[1]) != "" else String(c[0])
		chip.mouse_filter = Control.MOUSE_FILTER_PASS
		_chips.add_child(chip)


func _make_chip(text: String) -> Label:
	var chip := Label.new()
	chip.text = text
	chip.add_theme_font_size_override("font_size", 9)
	chip.add_theme_stylebox_override("normal", _chip_style)
	chip.mouse_filter = Control.MOUSE_FILTER_IGNORE
	return chip


## The power/toughness plate (or loyalty, defense) on the card's own P/T corner, each number green when raised and red when
## lowered from the printed one, and the counters as small badges down the card's left edge (CR 122.1); +1/+1 and -1/-1 first.
## Nothing covers the picture's bottom line (artist and copyright).
func _set_overlay(obj: Dictionary, def: Dictionary, chars: Dictionary) -> void:
	if _overlay == null:
		_overlay = Control.new()
		_overlay.mouse_filter = Control.MOUSE_FILTER_IGNORE
		_overlay.set_anchors_and_offsets_preset(Control.PRESET_FULL_RECT)
		add_child(_overlay)
	for c: Node in _overlay.get_children():
		c.queue_free()
	_has_plate = false
	_overlay.visible = Val.text(obj, "zone") == "battlefield"
	if not _overlay.visible:
		return
	var faces: Array = Val.list(def, "faces")
	var face := Val.as_dict(faces[clampi(View.shown_face(def, obj), 0, faces.size() - 1)]) if not faces.is_empty() else {}
	var face_down := Val.flag(obj, "faceDown")
	# A copy or a face-down permanent has other base values: its numbers are drawn without a colour (face down: 2/2).
	var own := not face_down and not face.is_empty() and (Val.text(chars, "name") == "" or Val.text(chars, "name") == Val.text(face, "name"))
	var counters := Val.dict(obj, "counters")
	var in_plate := ""
	var plate_text: Array = []
	var title := ""
	if Chars.has_type(chars, "Creature") and Val.text(chars, "power") != "" and Val.text(chars, "toughness") != "":
		var p := Val.text(chars, "power")
		var t := Val.text(chars, "toughness")
		var bp := "2" if face_down else (Val.text(face, "power") if own else "")
		var bt := "2" if face_down else (Val.text(face, "toughness") if own else "")
		plate_text = [[p, _tone(p, bp)], ["/", 0], [t, _tone(t, bt)]]
		var notes: Array[String] = []
		for k: String in ["+1/+1", "-1/-1"]:
			var n := Val.as_int(counters.get(k))
			if n > 0:
				notes.append("%d %s counter%s" % [n, k, "" if n == 1 else "s"])
		var changed := bp != "" and bt != "" and (p != bp or t != bt)
		title = "Power/toughness %s/%s%s%s (CR 208, 613)" % [p, t, (" (%s)" % ", ".join(notes)) if not notes.is_empty() else "",
			(", printed %s/%s" % [bp, bt]) if changed else ""]
	elif Chars.has_type(chars, "Planeswalker") or Chars.has_type(chars, "Battle"):
		in_plate = "loyalty" if Chars.has_type(chars, "Planeswalker") else "defense"
		var n := str(Val.as_int(counters.get(in_plate)))
		var printed := Val.text(face, in_plate) if own else ""
		plate_text = [[n, _tone(n, printed)]]
		title = "%s %s%s (%s)" % ["Loyalty" if in_plate == "loyalty" else "Defense", n, (", printed %s" % printed) if printed != "" and printed != n else "",
			"CR 306.5b" if in_plate == "loyalty" else "CR 310.4b"]
	if not plate_text.is_empty():
		_overlay.add_child(_plate(plate_text, title))
		_has_plate = true
		_pt.visible = false
	# The counters, down the left edge.
	var y := size.y * 0.18
	var order: Array = []
	for k: String in ["+1/+1", "-1/-1"]:
		if Val.as_int(counters.get(k)) > 0:
			order.append(k)
	for k: Variant in counters:
		if not order.has(String(k)) and String(k) != in_plate and Val.as_int(counters[k]) > 0:
			order.append(String(k))
	for k: String in order:
		var n := Val.as_int(counters[k])
		var badge := Label.new()
		var pt_counter := k == "+1/+1" or k == "-1/-1"
		badge.text = ("%s%s" % [k.replace("-1/-1", "−1/−1"), (" ×%d" % n) if n > 1 else ""]) if pt_counter else "%s %d" % [_counter_icon(k), n]
		badge.tooltip_text = "%d %s counter%s (CR 122.1)" % [n, k, "" if n == 1 else "s"]
		badge.mouse_filter = Control.MOUSE_FILTER_PASS
		badge.add_theme_font_size_override("font_size", 10)
		badge.add_theme_color_override("font_color", Color("#7dff9a") if k == "+1/+1" else (Color("#ff7b7b") if k == "-1/-1" else Color.WHITE))
		var s := StyleBoxFlat.new()
		s.bg_color = Color(0.02, 0.04, 0.09, 0.88)
		s.border_color = Color(NeonTheme.colors()[0], 0.6)
		s.set_border_width_all(1)
		s.set_corner_radius_all(5)
		s.content_margin_left = 4
		s.content_margin_right = 4
		badge.add_theme_stylebox_override("normal", s)
		badge.position = Vector2(-4.0, y)
		_overlay.add_child(badge)
		y += 19.0


## "up", "down" or "same" against the printed value (both whole numbers), as a colour index 1, -1 or 0.
static func _tone(current: String, printed: String) -> int:
	if not current.is_valid_int() or not printed.is_valid_int() or current == printed:
		return 0
	return 1 if current.to_int() > printed.to_int() else -1


func _plate(parts: Array, title: String) -> Control:
	var plate := PanelContainer.new()
	plate.tooltip_text = title
	plate.mouse_filter = Control.MOUSE_FILTER_PASS
	var up := false
	var down := false
	var row := HBoxContainer.new()
	row.add_theme_constant_override("separation", 0)
	row.mouse_filter = Control.MOUSE_FILTER_IGNORE
	for p: Variant in parts:
		var pair: Array = p
		var l := Label.new()
		l.text = String(pair[0])
		l.add_theme_font_override("font", Hud.bold_font())
		l.add_theme_font_size_override("font_size", 15)
		var tone := int(pair[1])
		up = up or tone > 0
		down = down or tone < 0
		l.add_theme_color_override("font_color", Color("#7dff9a") if tone > 0 else (Color("#ff7b7b") if tone < 0 else Color.WHITE))
		row.add_child(l)
	plate.add_child(row)
	# The plate's glow: green when only raised, red when only lowered, amber when both.
	var glow := Color("#ffd27a") if up and down else (Color("#7dff9a") if up else (Color("#ff7b7b") if down else Color(NeonTheme.colors()[0], 0.6)))
	var s := StyleBoxFlat.new()
	s.bg_color = Color(0.02, 0.04, 0.09, 0.9)
	s.border_color = glow
	s.set_border_width_all(1)
	s.set_corner_radius_all(6)
	s.content_margin_left = 6
	s.content_margin_right = 6
	s.shadow_color = Color(glow, 0.35 if up or down else 0.0)
	s.shadow_size = 6
	plate.add_theme_stylebox_override("panel", s)
	# On the printed P/T box: bottom right, above the bottom line of the picture.
	plate.position = Vector2(size.x - 58.0, size.y * 0.86 - 22.0)
	return plate


## A glyph for common counters (charge, time, oil…), else the name's initial.
static func _counter_icon(counter_name: String) -> String:
	var icons := {"charge": "⚡", "time": "⧗", "oil": "◉", "shield": "◈", "stun": "✕", "lore": "❡", "fade": "◌", "age": "⌛",
		"ice": "❄", "page": "❏", "quest": "★", "level": "▲"}
	if icons.has(counter_name):
		return String(icons[counter_name])
	for ch: String in counter_name.split(""):
		if ch.to_upper() != ch.to_lower():
			return ch.to_upper()
	return "•"


## Summoning sickness (CR 302.6): the engine's answer when the view's summary carries it (`summoningSick`, view schema 2).
## Without it (a schema-1 view), as far as the view tells: a creature its controller has not controlled continuously since their
## most recent turn began (`controlledSinceTurn` against the controller's `lastTurnStarted`), unless it has haste; only a hint.
func _looks_sick(view: Dictionary, obj: Dictionary, chars: Dictionary) -> bool:
	if not Chars.has_type(chars, "Creature"):
		return false
	if Val.flag(chars, "sick_known"):
		return Val.flag(chars, "summoning_sick")
	if Val.texts(chars, "keywords").has("haste"):
		return false
	var since := Val.num(obj, "controlledSinceTurn")
	var controller := Val.text(chars, "controller", Val.text(obj, "controller"))
	var last_turn := Val.num(View.player(view, controller), "lastTurnStarted")
	return since >= last_turn


## Rules text for a RichTextLabel: "[" would start a BBCode tag.
func _escape(text: String) -> String:
	return text.replace("[", "[lb]")


func _set_frame_param(param: String, value: Variant) -> void:
	var mat := _frame.material as ShaderMaterial
	if mat != null:
		mat.set_shader_parameter(param, value)
