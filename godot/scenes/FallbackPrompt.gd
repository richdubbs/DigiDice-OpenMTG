extends PanelContainer
## The prompt shown when prompts/<Kind>.tscn is missing (PromptLayer.gd). It follows the prompt contract (prompts/README.md) so
## no game ever gets stuck: it shows the question, lists the legal actions for a priority decision (one button each, Pass
## first), and lets a developer type the answer as JSON (types/decisions.ts DecisionAnswer). Not meant for players.

signal answered(answer: Dictionary)
signal cancelled()
signal acted(action: Dictionary)

@onready var _kind: Label = %Kind
@onready var _prompt: Label = %Prompt
@onready var _actions: VBoxContainer = %Actions
@onready var _json: TextEdit = %Json
@onready var _cancel: Button = %Cancel
@onready var _send: Button = %Send

var _decision: Dictionary = {}


func _ready() -> void:
	_send.pressed.connect(_on_send)
	_cancel.pressed.connect(func() -> void: cancelled.emit())


func setup(decision: Dictionary, _view: Dictionary, client: Node) -> void:
	_decision = decision
	var kind := Val.text(decision, "kind")
	_kind.text = "No screen for this question yet (%s)" % kind
	_prompt.text = Val.text(decision, "prompt")
	_cancel.visible = Val.flag(decision, "cancellable")
	for child: Node in _actions.get_children():
		child.queue_free()
	if kind == "priority":
		_json.visible = false
		_send.visible = false
		var legal: Array = Val.as_list(client.get("legal"))
		var player := Val.text(decision, "player")
		_add_action("Pass", {"type": "pass", "player": player})
		for la: Variant in legal:
			var d := Val.as_dict(la)
			if Val.text(d, "kind") == "pass" or Val.flag(d, "isMana"):
				continue
			_add_action(Val.text(d, "label", "Action"), Val.dict(d, "action"))
	else:
		_json.text = JSON.stringify({"kind": kind})


func _add_action(label: String, action: Dictionary) -> void:
	var b := Button.new()
	b.text = label
	b.alignment = HORIZONTAL_ALIGNMENT_LEFT
	b.pressed.connect(func() -> void: acted.emit(action))
	_actions.add_child(b)


func _on_send() -> void:
	var parsed: Variant = JSON.parse_string(_json.text)
	if parsed is Dictionary:
		answered.emit(parsed)
	else:
		_kind.text = "That is not a JSON object."


func rejected(error: Dictionary) -> void:
	_kind.text = Val.text(error, "message", "Refused.")
