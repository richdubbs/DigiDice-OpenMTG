class_name PhaseBar
extends PanelContainer
## The turn and its steps (CR 500.1), with the player's stops: for each step, "stop here in my turn" and "stop here in the
## opponents' turns" toggles. A toggle sends the viewer's whole StopSettings with GameClient.stops (never
## stale) and keeps them as the default for new games (Settings). The current step is lit.

const ROW_LABELS: Array[String] = ["", "Mine", "Theirs"]

@onready var _turn: Label = %Turn
@onready var _steps: GridContainer = %Steps

var _step_labels: Dictionary = {}
var _own: Dictionary = {}
var _opp: Dictionary = {}
var _viewer: String = ""
var _stops: Dictionary = {}
var _updating: bool = false


func _ready() -> void:
	_steps.columns = Config.STEP_ORDER.size() + 1
	for r: int in range(3):
		var head := Label.new()
		head.text = ROW_LABELS[r]
		head.add_theme_font_size_override("font_size", 10)
		_steps.add_child(head)
		for step: String in Config.STEP_ORDER:
			if r == 0:
				var l := Label.new()
				l.text = String(View.STEP_LABELS.get(step, step))
				l.horizontal_alignment = HORIZONTAL_ALIGNMENT_CENTER
				l.add_theme_font_size_override("font_size", 10)
				_steps.add_child(l)
				_step_labels[step] = l
			else:
				var b := CheckBox.new()
				b.focus_mode = Control.FOCUS_NONE
				b.size_flags_horizontal = Control.SIZE_SHRINK_CENTER
				b.tooltip_text = "Stop in %s during %s" % [String(View.STEP_LABELS.get(step, step)), "my turn" if r == 1 else "the opponents' turns"]
				b.toggled.connect(_on_toggled)
				_steps.add_child(b)
				if r == 1:
					_own[step] = b
				else:
					_opp[step] = b


func show_view(view: Dictionary) -> void:
	_viewer = View.viewer(view)
	var t := View.turn(view)
	var active := Val.text(t, "activePlayer")
	_turn.text = "Turn %d\n%s" % [Val.num(t, "number"), View.player_name(view, active)]
	var current := Val.text(t, "step")
	var colors := NeonTheme.colors()
	for step: Variant in _step_labels.keys():
		var l: Label = _step_labels[step]
		l.modulate = colors[0].lightened(0.3) if step == current else Color(1, 1, 1, 0.55)
	_stops = Val.dict(View.player(view, _viewer), "stops")
	var own := Val.texts(_stops, "ownTurn")
	var opp := Val.texts(_stops, "opponentTurn")
	_updating = true
	for step: Variant in _own.keys():
		var b: CheckBox = _own[step]
		b.set_pressed_no_signal(own.has(String(step)))
		b.disabled = _viewer == ""
	for step: Variant in _opp.keys():
		var b: CheckBox = _opp[step]
		b.set_pressed_no_signal(opp.has(String(step)))
		b.disabled = _viewer == ""
	_updating = false


func _on_toggled(_on: bool) -> void:
	if _updating or _viewer == "":
		return
	var own: Array[String] = []
	var opp: Array[String] = []
	for step: String in Config.STEP_ORDER:
		if (_own[step] as CheckBox).button_pressed:
			own.append(step)
		if (_opp[step] as CheckBox).button_pressed:
			opp.append(step)
	var settings: Dictionary = _stops.duplicate(true)
	settings["ownTurn"] = own
	settings["opponentTurn"] = opp
	if not settings.has("fullControl"):
		settings["fullControl"] = false
	GameClient.stops(_viewer, settings)
	Settings.set_stops(own, opp, Val.flag(settings, "fullControl"))
