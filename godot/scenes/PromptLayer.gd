class_name PromptLayer
extends Control
## The prompt layer of the Table: shows the scene for the pending decision when the viewer has to answer it.
##
## One scene per decision kind (types/decisions.ts): `res://prompts/<Kind>.tscn`, where <Kind> is the kind with its first letter
## upper-cased ("chooseObjects" -> prompts/ChooseObjects.tscn); `res://prompts/<kind>.tscn` (the kind as it is) is tried next,
## then prompts/Fallback.tscn, then scenes/FallbackPrompt.tscn. The contract those scenes follow is in prompts/README.md:
##   setup(decision: Dictionary, view: Dictionary, client: Node) -> void   (called once, after the scene entered the tree)
##   signal answered(answer: Dictionary)      -> act {type: 'answer', player, decisionId, answer}
##   signal cancelled()                       -> act {type: 'cancel', player}
##   signal acted(action: Dictionary)         (optional; the priority scene) -> act(action) as it is
##     (`action_chosen(action)` is accepted as the same signal)
##   func set_busy(busy: bool) -> void        (optional; true while an answer is on its way, false when it was refused)
##   func show_error(message: String, rules: Array) -> void   (optional; the engine refused the answer)
##   func rejected(error: Dictionary) -> void (optional; the same refusal as one {message, rules} Dictionary)
##   func view_changed(view: Dictionary) -> void   (optional; a new view while the same decision is pending)
## This node covers the screen but lets every click through to the board (mouse_filter IGNORE); a prompt scene places itself
## with anchors and takes the clicks on its own controls.

const PROMPT_DIR: String = "res://prompts/"
## The prompts' own fallback (a scene for a kind that has none), then the Table's developer panel.
const PROMPT_FALLBACK_SCENE: String = "res://prompts/Fallback.tscn"
const FALLBACK_SCENE: String = "res://scenes/FallbackPrompt.tscn"
const ERROR_SHOW_S: float = 6.0

## The Table's board selection (cleared whenever a prompt closes).
var selection: BoardSelection = null

var _current: Control = null
var _decision: Dictionary = {}
## act request id -> decision id, to show a refusal on the prompt it belongs to.
var _requests: Dictionary = {}
var _waiting: Label = null
var _error: Label = null
var _error_timer: SceneTreeTimer = null
## The view seq that must be on screen before a prompt whose act was accepted takes clicks again (-1: none).
var _settle_seq: int = -1


func _ready() -> void:
	mouse_filter = Control.MOUSE_FILTER_IGNORE
	_waiting = _make_label(-120.0)
	_error = _make_label(-160.0)
	_error.add_theme_color_override("font_color", Color(1.0, 0.65, 0.45))
	GameClient.replied.connect(_on_replied)


## The scene file for a decision kind (see the class comment).
static func scene_path_for(kind: String) -> String:
	if kind != "":
		var pascal := kind.substr(0, 1).to_upper() + kind.substr(1)
		for file_name: String in [pascal, kind]:
			var path := PROMPT_DIR + file_name + ".tscn"
			if ResourceLoader.exists(path):
				return path
	if ResourceLoader.exists(PROMPT_FALLBACK_SCENE):
		return PROMPT_FALLBACK_SCENE
	return FALLBACK_SCENE


## Called by the Table with every new view.
func show_view(view: Dictionary) -> void:
	var d := View.pending(view)
	var mine := GameClient.handoff_player == "" and View.decision_is_mine(view, d)
	if not mine:
		_close()
		_waiting.visible = not d.is_empty() and GameClient.handoff_player == ""
		if _waiting.visible:
			var who := View.player_name(view, Val.text(d, "player"))
			_waiting.text = Val.text(d, "prompt", "Waiting for %s." % who)
		return
	_waiting.visible = false
	if _current != null and Val.text(d, "id") == Val.text(_decision, "id"):
		if _settle_seq >= 0 and GameClient.seq >= _settle_seq:
			_settle_seq = -1
			_set_busy(false)
		if _current.has_method("view_changed"):
			_current.call("view_changed", view)
		return
	_close()
	_open(d, view)


func _open(d: Dictionary, view: Dictionary) -> void:
	var path := scene_path_for(Val.text(d, "kind"))
	var prompt := _instantiate(path)
	if prompt == null and path != FALLBACK_SCENE:
		push_warning("Prompt scene %s does not follow prompts/README.md; using the fallback." % path)
		prompt = _instantiate(FALLBACK_SCENE)
	if prompt == null:
		push_error("No prompt scene for %s." % Val.text(d, "kind"))
		return
	_current = prompt
	_decision = d
	add_child(prompt)
	prompt.connect("answered", _on_answered)
	prompt.connect("cancelled", _on_cancelled)
	for action_signal: String in ["acted", "action_chosen"]:
		if prompt.has_signal(action_signal):
			prompt.connect(action_signal, _on_action_chosen)
	prompt.call("setup", d, view, GameClient)


## The scene's root, or null when it does not follow the contract.
func _instantiate(path: String) -> Control:
	var packed := load(path) as PackedScene
	if packed == null:
		return null
	var node := packed.instantiate()
	var prompt := node as Control
	if prompt == null or not prompt.has_method("setup") or not prompt.has_signal("answered") or not prompt.has_signal("cancelled"):
		node.queue_free()
		return null
	return prompt


func _close() -> void:
	_settle_seq = -1
	if selection != null:
		selection.clear()
	if _current != null:
		_current.queue_free()
		_current = null
	_decision = {}


func _on_answered(answer: Dictionary) -> void:
	if _decision.is_empty():
		return
	var action := {
		"type": "answer",
		"player": Val.text(_decision, "player"),
		"decisionId": Val.text(_decision, "id"),
		"answer": answer,
	}
	_requests[GameClient.act(action)] = Val.text(_decision, "id")
	_set_busy(true)


func _on_cancelled() -> void:
	if _decision.is_empty():
		return
	_requests[GameClient.act({"type": "cancel", "player": Val.text(_decision, "player")})] = Val.text(_decision, "id")
	_set_busy(true)


func _on_action_chosen(action: Dictionary) -> void:
	_requests[GameClient.act(action)] = Val.text(_decision, "id")
	_set_busy(true)


func _set_busy(busy: bool) -> void:
	if _current != null and _current.has_method("set_busy"):
		_current.call("set_busy", busy)


func _on_replied(id: int, ok: bool, error: Dictionary) -> void:
	if not _requests.has(id):
		return
	var for_decision: String = _requests[id]
	_requests.erase(id)
	# The change an act made arrives before its reply, so a prompt still up for the same decision was not replaced.
	var same_prompt := _current != null and Val.text(_decision, "id") == for_decision
	if ok:
		if same_prompt:
			if GameClient.latest_seq() > GameClient.seq:
				# That change waits behind an animation: the prompt stays busy until it is shown, so a second click can't act on
				# a screen the game has moved on from (the server would refuse it as stale).
				_settle_seq = GameClient.latest_seq()
			else:
				_set_busy(false)
		return
	var rules := Val.texts(error, "rules")
	var message := Val.text(error, "message", "The game refused that.")
	if same_prompt and _current.has_method("show_error"):
		_current.call("show_error", message, rules) # the prompt shows it itself
	else:
		show_error(message + ("" if rules.is_empty() else " (%s)" % ", ".join(rules)))
	if same_prompt:
		_set_busy(false)
		if _current.has_method("rejected"):
			_current.call("rejected", error)


## Show a refusal or a problem for a few seconds (the Table uses it for its own actions too).
func show_error(text: String) -> void:
	_error.text = text
	_error.visible = true
	_error_timer = get_tree().create_timer(ERROR_SHOW_S)
	var timer := _error_timer
	await timer.timeout
	if _error_timer == timer:
		_error.visible = false


func _make_label(bottom: float) -> Label:
	var l := Label.new()
	l.visible = false
	l.mouse_filter = Control.MOUSE_FILTER_IGNORE
	l.horizontal_alignment = HORIZONTAL_ALIGNMENT_CENTER
	l.autowrap_mode = TextServer.AUTOWRAP_WORD_SMART
	l.add_theme_font_size_override("font_size", 16)
	l.add_theme_color_override("font_outline_color", Color(0, 0, 0, 0.9))
	l.add_theme_constant_override("outline_size", 4)
	add_child(l)
	l.set_anchors_preset(Control.PRESET_CENTER_BOTTOM)
	l.offset_left = -360.0
	l.offset_right = 360.0
	l.offset_top = bottom - 36.0
	l.offset_bottom = bottom
	return l
