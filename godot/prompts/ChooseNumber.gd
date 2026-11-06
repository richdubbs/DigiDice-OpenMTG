extends "res://prompts/PromptBase.gd"
## chooseNumber (CR 107.3, 601.2b: X and other numbers): a SpinBox, plus a slider when the range is 100 or less. OK is "Choose N".
## Answer: {kind:'chooseNumber', n: int}.

@onready var number: SpinBox = $Frame/Box/Body/Row/Number
@onready var slider: HSlider = $Frame/Box/Body/Row/Slider
@onready var range_label: Label = $Frame/Box/Body/Row/Range

var _lo: int = 0
var _hi: int = 0


func _build() -> void:
	_lo = J.int_of(decision, "min")
	_hi = maxi(_lo, J.int_of(decision, "max"))
	for r: Range in [number, slider]:
		r.min_value = _lo
		r.max_value = _hi
		r.step = 1
		r.rounded = true
		r.set_value_no_signal(_lo)
	slider.visible = _hi > _lo and _hi - _lo <= 100
	range_label.text = "%d to %d" % [_lo, _hi]
	number.value_changed.connect(_on_number_changed)
	slider.value_changed.connect(_on_slider_changed)


func _on_number_changed(value: float) -> void:
	slider.set_value_no_signal(value)
	_refresh()


func _on_slider_changed(value: float) -> void:
	number.set_value_no_signal(value)
	_refresh()


## The number chosen now.
func chosen() -> int:
	return roundi(number.value)


func _refresh() -> void:
	var n := chosen()
	set_ok(n >= _lo and n <= _hi, "Choose %d" % n)


func _on_ok() -> void:
	var n := chosen()
	if n >= _lo and n <= _hi:
		send_answer({"kind": "chooseNumber", "n": n})
