class_name ReplayCover
extends ColorRect
## Instead of the table while a replay made with another build is checked on this one (its progress), or when it cannot be watched
## here at all (the browser's ReplayCover in replays/viewer/ReplayPrompt.tsx): a heading, the notice, a progress bar while it is
## checked, and "Leave the replay".

signal leave_pressed()

var _heading: Label = null
var _notice: Label = null
var _progress: ProgressBar = null


func _ready() -> void:
	set_anchors_and_offsets_preset(Control.PRESET_FULL_RECT)
	color = Color("#03070f")
	mouse_filter = Control.MOUSE_FILTER_STOP
	visible = false
	var glow := TextureRect.new()
	var g := GradientTexture2D.new()
	var grad := Gradient.new()
	grad.set_color(0, Color(NeonTheme.colors()[0], 0.14))
	grad.set_color(1, Color(0, 0, 0, 0))
	g.gradient = grad
	g.fill = GradientTexture2D.FILL_RADIAL
	g.fill_from = Vector2(0.5, 0.55)
	g.fill_to = Vector2(0.9, 0.55)
	glow.texture = g
	glow.set_anchors_and_offsets_preset(Control.PRESET_FULL_RECT)
	glow.stretch_mode = TextureRect.STRETCH_SCALE
	glow.mouse_filter = Control.MOUSE_FILTER_IGNORE
	add_child(glow)
	var center := CenterContainer.new()
	center.set_anchors_and_offsets_preset(Control.PRESET_FULL_RECT)
	add_child(center)
	var box := VBoxContainer.new()
	box.custom_minimum_size = Vector2(540, 0)
	box.alignment = BoxContainer.ALIGNMENT_CENTER
	box.add_theme_constant_override("separation", 14)
	center.add_child(box)
	_heading = Hud.title("Checking this replay", 26)
	_heading.horizontal_alignment = HORIZONTAL_ALIGNMENT_CENTER
	box.add_child(_heading)
	_notice = Hud.text("", 14)
	_notice.horizontal_alignment = HORIZONTAL_ALIGNMENT_CENTER
	box.add_child(_notice)
	_progress = Hud.bar(0.0, 10)
	_progress.custom_minimum_size = Vector2(352, 10)
	_progress.size_flags_horizontal = Control.SIZE_SHRINK_CENTER
	_progress.tooltip_text = "Checking the replay"
	box.add_child(_progress)
	var leave := Hud.button("Leave the replay")
	leave.size_flags_horizontal = Control.SIZE_SHRINK_CENTER
	leave.pressed.connect(func() -> void: leave_pressed.emit())
	box.add_child(leave)


## Shown while the replay is checked or cannot be watched; hidden otherwise.
func show_state(s: Dictionary) -> void:
	var badge := Val.text(s, "badge")
	var checking := badge == "checking"
	visible = checking or badge == "unplayable"
	if not visible:
		return
	_heading.text = "Checking this replay" if checking else "This replay cannot be watched here"
	var notice := Val.text(s, "notice")
	_notice.text = notice
	_notice.visible = notice != ""
	_progress.visible = checking
	_progress.value = roundf(Val.real(s, "progress") * 100.0)
