class_name PassCover
extends ColorRect
## The hot-seat pass screen (packages/client/src/game/PassCover.tsx): whenever the player who must act changes, this full-screen
## cover hides everything until the next player clicks, so nothing of either player's hidden information (CR 400.2) is on screen
## while the device changes hands. Only Concede (CR 104.3a: at any time) and Leave stay reachable, in the corner.
##
## The button is not focused and stays disabled for ARM_MS after the cover appears: a player still pressing Space to pass
## priority must not click straight through and show the next player's hand to the wrong person. It sounds as it appears
## (game.handoff), so the players hear that the device changes hands.

signal accepted()
signal concede_pressed()
signal leave_pressed()

const ARM_MS: int = 600

@onready var _title: Label = %Title
@onready var _go: Button = %Go

var _hint: Label = null
var _logo: Logo3D = null


func _ready() -> void:
	mouse_filter = Control.MOUSE_FILTER_STOP
	_go.pressed.connect(_on_go)
	_go.set_meta(&"slab", "primary")
	_go.focus_mode = Control.FOCUS_NONE
	var box := _title.get_parent() as VBoxContainer
	box.add_theme_constant_override("separation", 16)
	_logo = Logo3D.make(132.0, true)
	_logo.size_flags_horizontal = Control.SIZE_SHRINK_CENTER
	box.add_child(_logo)
	box.move_child(_logo, 0)
	_title.horizontal_alignment = HORIZONTAL_ALIGNMENT_CENTER
	for c: Node in box.get_children():
		if c is Label and c != _title:
			_hint = c as Label
	if _hint != null:
		_hint.horizontal_alignment = HORIZONTAL_ALIGNMENT_CENTER
		_hint.add_theme_color_override("font_color", Hud.MUTED)
	_go.custom_minimum_size = Vector2(320, 54)
	_go.add_theme_font_override("font", Hud.bold_font())
	_go.add_theme_font_size_override("font_size", 18)
	var bar := HBoxContainer.new()
	bar.set_anchors_and_offsets_preset(Control.PRESET_TOP_RIGHT)
	bar.position = Vector2(-260, 12)
	bar.add_theme_constant_override("separation", 8)
	var concede := Hud.button("Concede")
	concede.set_meta(&"slab", "danger")
	concede.pressed.connect(func() -> void: concede_pressed.emit())
	var leave := Hud.button("Leave")
	leave.pressed.connect(func() -> void: leave_pressed.emit())
	bar.add_child(concede)
	bar.add_child(leave)
	add_child(bar)


func show_for(player_name: String) -> void:
	var settings := Hud.title("Pass to %s" % player_name, 32).label_settings
	_title.label_settings = settings
	_title.text = ("Pass to %s" % player_name).to_upper()
	if _hint != null:
		_hint.text = "Hand the screen to %s. Everything stays hidden until %s continues." % [player_name, player_name]
	_go.text = "I am %s: continue" % player_name
	var was_visible := visible
	visible = true
	if was_visible:
		return
	Sound.cue("game.handoff")
	# Whatever had the keyboard focus belongs to the previous player's table.
	var focused := get_viewport().gui_get_focus_owner()
	if focused != null:
		focused.release_focus()
	_go.disabled = true
	get_tree().create_timer(ARM_MS / 1000.0).timeout.connect(func() -> void: _go.disabled = false)


func _on_go() -> void:
	visible = false
	accepted.emit()
