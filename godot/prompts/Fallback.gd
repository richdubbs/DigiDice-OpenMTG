extends "res://prompts/PromptBase.gd"
## The prompt for a decision kind with no scene of its own (a kind the engine added after these scenes were written). It shows the
## prompt text and offers the engine's cheapest legal answer, as the browser's computer player does (prompts/fallbacks.gd, a port of
## game/computer.ts#fallbacks): OK sends the first fallback that answers the decision; Cancel when the decision is cancellable. For a
## priority decision the fallback is a pass, emitted with `acted` like the priority scene. When no fallback exists, OK stays disabled.
## Answer: whatever DecisionAnswer fallbacks.gd gives first for the kind.

signal acted(action: Dictionary)

const Fallbacks := preload("res://prompts/fallbacks.gd")

var _choice: Dictionary = {}


func _build() -> void:
	var kind := J.str_of(decision, "kind")
	for a: Dictionary in Fallbacks.fallbacks(decision):
		var t := J.str_of(a, "type")
		if t == "answer" or t == "pass":
			_choice = a
			break
	var text := "This table has no screen for this kind of decision yet (%s)." % kind
	if _choice.is_empty():
		text += " There is no automatic answer for it%s." % (": cancel, or answer it in the browser" if is_cancellable() else ": answer it in the browser")
	elif J.str_of(_choice, "type") == "pass":
		text += " The simplest legal answer is to pass priority."
	else:
		text += " The simplest legal answer is: %s" % JSON.stringify(J.dict(_choice, "answer"))
	set_detail(text)
	set_ok(not _choice.is_empty(), "Use this answer")


func _on_ok() -> void:
	if _choice.is_empty():
		return
	if J.str_of(_choice, "type") == "pass":
		if not _busy and is_armed():
			acted.emit(_choice)
		return
	send_answer(J.dict(_choice, "answer"))
