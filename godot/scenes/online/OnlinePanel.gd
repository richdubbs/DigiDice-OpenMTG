class_name OnlinePanel
extends Control
## What the table adds online (the browser's online/OnlineGamePanel.tsx), in a panel at the top right of the table:
## - the players and their links (a 3-4 player game: each player, connected or not, a dropped one with the clock until they
##   forfeit, who left; the latest table news);
## - adjustments by hand to accept or reject (in words, as the other player's server describes them for this player, CR 400.2), or
##   this player's own waiting for answers, and how the last one ended;
## - the host only: end the game for a guest that left (Forfeit, CR 104.3a);
## - this player's "Show my cards in replays";
## - the chat, in an overlay over the table's right edge (the table's news with it in a 3-4 player game).
## Everything comes from Online, which holds only what the local server sends this player.

var _panel: PanelContainer = null
var _col: VBoxContainer = null
var _presence: VBoxContainer = null
var _news: Label = null
var _proposal_box: VBoxContainer = null
var _outcome: Label = null
var _left_note: Label = null
var _forfeits: VBoxContainer = null
var _consent: CheckBox = null
var _consent_note: Label = null
var _problem: Label = null
var _chat_button: Button = null
var _overlay: PanelContainer = null
var _overlay_title: Label = null
var _news_list: Label = null
var _chat_lines: RichTextLabel = null
var _chat_text: LineEdit = null
var _reason: LineEdit = null
var _shown_proposal: int = -2
var _answering: bool = false
var _sending_consent: Variant = null
var _was_table: bool = false
var _tick: float = 0.0
## The newest chat line read (the chat open), for "(new)".
var _seen_chat: int = 0


func _ready() -> void:
	set_anchors_and_offsets_preset(Control.PRESET_FULL_RECT)
	mouse_filter = Control.MOUSE_FILTER_IGNORE
	_panel = Hud.panel(10)
	_panel.anchor_left = 1.0
	_panel.anchor_right = 1.0
	_panel.offset_left = -436.0
	_panel.offset_right = -16.0
	_panel.offset_top = 96.0
	_panel.grow_horizontal = Control.GROW_DIRECTION_BEGIN
	add_child(_panel)
	_col = VBoxContainer.new()
	_col.add_theme_constant_override("separation", 6)
	_panel.add_child(_col)
	_presence = VBoxContainer.new()
	_presence.add_theme_constant_override("separation", 2)
	_col.add_child(_presence)
	var bar := HBoxContainer.new()
	bar.add_theme_constant_override("separation", 8)
	_news = Hud.text("", 12)
	_news.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	_news.text_overrun_behavior = TextServer.OVERRUN_TRIM_ELLIPSIS
	_news.autowrap_mode = TextServer.AUTOWRAP_OFF
	bar.add_child(_news)
	_chat_button = Hud.button("Chat")
	_chat_button.custom_minimum_size = Vector2(0, 32)
	_chat_button.pressed.connect(func() -> void: _show_chat(not _overlay.visible))
	bar.add_child(_chat_button)
	_col.add_child(bar)
	_proposal_box = VBoxContainer.new()
	_proposal_box.add_theme_constant_override("separation", 6)
	_col.add_child(_proposal_box)
	_outcome = Hud.text("", 13, Hud.TEXT)
	_col.add_child(_outcome)
	_left_note = Hud.text("", 13, Hud.TEXT)
	_col.add_child(_left_note)
	_forfeits = VBoxContainer.new()
	_col.add_child(_forfeits)
	_consent = CheckBox.new()
	_consent.text = "Show my cards in replays"
	_consent.toggled.connect(_on_consent)
	_col.add_child(_consent)
	_consent_note = Hud.text("", 12)
	_col.add_child(_consent_note)
	_problem = Hud.text("", 13, NeonTheme.colors()[1])
	_problem.visible = false
	_col.add_child(_problem)
	_build_overlay()
	Online.changed.connect(_refresh)
	Online.watch(true)
	_refresh()


func _exit_tree() -> void:
	Online.watch(false)


func _build_overlay() -> void:
	_overlay = Hud.panel(12)
	_overlay.visible = false
	_overlay.anchor_left = 1.0
	_overlay.anchor_right = 1.0
	_overlay.anchor_bottom = 1.0
	_overlay.offset_left = -456.0
	_overlay.offset_right = -16.0
	_overlay.offset_top = 96.0
	_overlay.offset_bottom = -170.0
	add_child(_overlay)
	var col := VBoxContainer.new()
	col.add_theme_constant_override("separation", 8)
	_overlay.add_child(col)
	var head := HBoxContainer.new()
	_overlay_title = Label.new()
	_overlay_title.add_theme_font_override("font", Hud.bold_font())
	_overlay_title.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	head.add_child(_overlay_title)
	var close := Hud.button("×")
	close.tooltip_text = "Close the chat"
	close.pressed.connect(func() -> void: _show_chat(false))
	head.add_child(close)
	col.add_child(head)
	_news_list = Hud.text("", 12)
	col.add_child(_news_list)
	_chat_lines = RichTextLabel.new()
	_chat_lines.bbcode_enabled = false
	_chat_lines.scroll_following = true
	_chat_lines.size_flags_vertical = Control.SIZE_EXPAND_FILL
	_chat_lines.selection_enabled = true
	col.add_child(_chat_lines)
	var form := HBoxContainer.new()
	form.add_theme_constant_override("separation", 6)
	_chat_text = LineEdit.new()
	_chat_text.max_length = Online.MAX_CHAT
	_chat_text.placeholder_text = "Chat message"
	_chat_text.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	_chat_text.text_submitted.connect(func(_t: String) -> void: _send())
	form.add_child(_chat_text)
	var send := Hud.button("Send")
	send.pressed.connect(_send)
	form.add_child(send)
	col.add_child(form)


func _show_chat(on: bool) -> void:
	_overlay.visible = on
	if on:
		_chat_text.grab_focus.call_deferred()
		_seen_chat = _last_chat_n()
	_refresh()



func _last_chat_n() -> int:
	return int(Online.chat.back()["n"]) if not Online.chat.is_empty() else 0


func _unhandled_key_input(event: InputEvent) -> void:
	if _overlay.visible and event.is_action_pressed("ui_cancel"):
		_show_chat(false)
		get_viewport().set_input_as_handled()


func _process(delta: float) -> void:
	_tick += delta
	# The forfeit clocks count down once a second while one runs.
	if _tick >= 1.0:
		_tick = 0.0
		if _clocks_running():
			_refresh_presence()


func _clocks_running() -> bool:
	for p: Variant in Val.list(Online.status, "players"):
		var pd := Val.as_dict(p)
		if pd.has("forfeitAt") and not Val.flag(pd, "connected") and not Val.flag(pd, "left"):
			return true
	return false


func _over() -> bool:
	return not Val.dict(Val.dict(Online.view, "view"), "result").is_empty() or Val.text(Online.status, "phase") == "over"


func _name(id: String) -> String:
	var s := Online.status
	if not _was_table:
		return "You" if id != "" and id == Val.text(s, "me") else Val.text(s, "opponent", "The other player")
	return OnlineUi.name_of(s, id, Val.list(Val.dict(Online.view, "view"), "players"))


func _refresh() -> void:
	var s := Online.status
	if OnlineUi.is_table(s):
		_was_table = true
	_refresh_presence()
	var other := Val.text(s, "opponent", "The other player")
	var news: Array[Dictionary] = []
	for n: Dictionary in Online.notices:
		if String(n["kind"]) != "refused":
			news.append(n)
	_news.text = String(news.back()["text"]) if _was_table and not news.is_empty() else ""
	_news.tooltip_text = _news.text
	var unread: bool = not Online.chat.is_empty() and String(Online.chat.back()["from"]) == "opponent" and not Online.chat.back().has("history") and _last_chat_n() > _seen_chat and not _overlay.visible
	var title := "Table chat" if _was_table else "Chat with %s" % other
	_chat_button.text = title + (" (new)" if unread else "")
	_overlay_title.text = title
	_refresh_proposal()
	var o := Online.outcome
	_outcome.text = _outcome_text(o) if not o.is_empty() and int(Val.num(o, "proposal")) != int(Val.num(Online.proposal, "id", -1)) else ""
	_outcome.visible = _outcome.text != ""
	# After the end, why the other player is gone when they left (leaving a running game concedes it, CR 104.3a).
	var last := _last_presence("")
	_left_note.text = Val.text(last, "text") if not _was_table and _over() and Val.text(last, "kind") == "opponentLeft" else ""
	_left_note.visible = _left_note.text != ""
	_refresh_forfeits(last)
	_refresh_consent()
	# The chat and the news.
	var lines := ""
	for c: Dictionary in Online.chat:
		var who := "You" if String(c["from"]) == "me" else (_name(String(c.get("player", ""))) if _was_table else other)
		lines += "%s: %s\n" % [who, String(c["text"])]
	_chat_lines.text = lines.strip_edges()
	var news_text := ""
	if _was_table:
		for n: Dictionary in news:
			news_text += "%s\n" % String(n["text"])
	_news_list.text = news_text.strip_edges()
	_news_list.visible = _news_list.text != ""


func _refresh_presence() -> void:
	for c: Node in _presence.get_children():
		c.queue_free()
	var s := Online.status
	if not _was_table:
		var other := Val.text(s, "opponent", "")
		if other != "":
			var on: bool = s.get("opponentConnected", true) != false
			_presence.add_child(_presence_line(other, "connected" if on else "disconnected", on))
		return
	var now := Time.get_unix_time_from_system() * 1000.0
	var over := _over()
	for p: Dictionary in OnlineUi.seated_players(s):
		var id := Val.text(p, "id")
		var you := id == Val.text(s, "me")
		var pname := Val.text(p, "name") if Val.text(p, "name") != "" else _name(id)
		var state := "connected"
		if Val.flag(p, "left"):
			state = "left the game"
		elif not Val.flag(p, "connected"):
			state = "disconnected: %s until they forfeit" % OnlineUi.clock_text(Val.real(p, "forfeitAt") - now) if p.has("forfeitAt") and not over else "disconnected"
		_presence.add_child(_presence_line(pname + (" (you)" if you else ""), state, Val.flag(p, "connected") and not Val.flag(p, "left")))


func _presence_line(who: String, state: String, on: bool) -> Control:
	var row := HBoxContainer.new()
	row.add_theme_constant_override("separation", 6)
	var dot := Label.new()
	dot.text = "●"
	dot.add_theme_color_override("font_color", Color("#5ce1a7") if on else NeonTheme.colors()[1])
	row.add_child(dot)
	var t := Hud.text("%s: %s" % [who, state], 13, Hud.TEXT)
	t.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	row.add_child(t)
	return row


func _last_presence(player: String) -> Dictionary:
	for i: int in range(Online.notices.size() - 1, -1, -1):
		var n: Dictionary = Online.notices[i]
		if String(n["kind"]) in ["opponentLeft", "opponentDropped", "opponentBack"] and (player == "" or String(n.get("player", "")) == player):
			return n
	return {}


## Host only: a guest that left without conceding can be ended at once (CR 104.3a).
func _refresh_forfeits(last: Dictionary) -> void:
	for c: Node in _forfeits.get_children():
		c.queue_free()
	var s := Online.status
	if Val.text(s, "role") != "host" or _over():
		return
	if not _was_table:
		if s.get("opponentConnected", true) == false and Val.text(last, "kind") == "opponentLeft":
			var b := Hud.button("End the game: %s forfeits" % Val.text(s, "opponent", "The other player"))
			b.pressed.connect(func() -> void: _forfeit(""))
			_forfeits.add_child(b)
		return
	for p: Dictionary in OnlineUi.seated_players(s):
		var id := Val.text(p, "id")
		if id == Val.text(s, "me") or Val.flag(p, "connected") or Val.flag(p, "left"):
			continue
		if Val.text(_last_presence(id), "kind") != "opponentLeft":
			continue
		var b := Hud.button("End the game for %s: they forfeit" % (Val.text(p, "name") if Val.text(p, "name") != "" else _name(id)))
		b.pressed.connect(func() -> void: _forfeit(id))
		_forfeits.add_child(b)


func _forfeit(player: String) -> void:
	_set_problem("")
	var r := await Online.reply(Online.forfeit(player))
	if not bool(r.get("ok", false)):
		_set_problem(Val.text(OnlineUi.explain(Val.dict(r, "error")), "message"))


# ---- adjustments by hand ----------------------------------------------------------------------------------------------------------

func _refresh_proposal() -> void:
	var p := Online.proposal
	var id := int(Val.num(p, "id", -1))
	if id == _shown_proposal and not p.is_empty():
		return
	_shown_proposal = id
	for c: Node in _proposal_box.get_children():
		c.queue_free()
	_reason = null
	if p.is_empty():
		return
	var s := Online.status
	var me := Val.text(s, "me")
	var role := Val.text(s, "role")
	var waiting: Array = Val.list(p, "waiting")
	var lines: Array = Val.list(p, "lines")
	var source := Val.text(p, "sourceName")
	var must := false
	var head := ""
	if _was_table:
		var mine := Val.text(p, "player") == me
		if mine:
			head = "You resolve %s by hand. Every other player must accept these changes%s" % [source,
				("; waiting for %s." % OnlineUi.list_names(waiting.map(func(x: Variant) -> String: return _name(String(x))))) if not waiting.is_empty() else "."]
		else:
			must = not p.has("waiting") or waiting.has(me)
			head = "%s resolves %s by hand and asks every other player to accept these changes:" % [_name(Val.text(p, "player")), source]
	else:
		var host_own := p.has("waiting")
		var other := Val.text(s, "opponent", "The other player")
		if host_own and role == "host":
			head = "You resolve %s by hand. %s must accept these changes%s" % [source, other, ("; waiting for %s." % other) if not waiting.is_empty() else "."]
		else:
			must = (role == "guest" and not waiting.is_empty()) if host_own else role == "host"
			head = "%s resolves %s by hand and asks you to accept these changes:" % [other, source]
	var title := Hud.text(head, 13, Hud.TEXT)
	title.add_theme_font_override("font", Hud.bold_font())
	_proposal_box.add_child(title)
	if Val.text(p, "text") != "":
		_proposal_box.add_child(Hud.text(Val.text(p, "text"), 13))
	for l: Variant in lines:
		_proposal_box.add_child(Hud.text("• %s" % String(l), 13))
	if _was_table and not waiting.is_empty() and Val.text(p, "player") != me:
		_proposal_box.add_child(Hud.text("%s: %s." % ["Still to answer" if must else "You accepted; waiting for",
			OnlineUi.list_names(waiting.map(func(x: Variant) -> String: return "you" if String(x) == me else _name(String(x))))], 12))
	if must:
		var guest_answers := _was_table or (p.has("waiting") and role == "guest")
		if guest_answers:
			_proposal_box.add_child(Hud.text("Reason if you reject (optional)", 12))
			_reason = LineEdit.new()
			_reason.max_length = Online.MAX_CHAT
			_proposal_box.add_child(_reason)
		var row := HBoxContainer.new()
		row.add_theme_constant_override("separation", 8)
		var accept := Hud.button("Accept")
		accept.set_meta(&"slab", "primary")
		accept.pressed.connect(func() -> void: _answer(true))
		row.add_child(accept)
		var reject := Hud.button("Reject")
		reject.pressed.connect(func() -> void: _answer(false))
		row.add_child(reject)
		_proposal_box.add_child(row)
		Sound.cue("ui.notify")


func _answer(accept: bool) -> void:
	var p := Online.proposal
	if p.is_empty() or _answering:
		return
	_answering = true
	_set_problem("")
	var why := _reason.text.strip_edges() if _reason != null else ""
	var reason := ""
	if not accept:
		if _was_table or p.has("waiting"):
			reason = why.left(Online.MAX_CHAT)
		else:
			reason = "The host rejected the adjustments."
	var r := await Online.reply(Online.answer_proposal(int(Val.num(p, "id")), accept, reason))
	_answering = false
	if not bool(r.get("ok", false)):
		_set_problem(Val.text(OnlineUi.explain(Val.dict(r, "error")), "message"))


## How a proposal ended, in words for this player.
func _outcome_text(o: Dictionary) -> String:
	var me := Val.text(Online.status, "me")
	var player := Val.text(o, "player")
	var whose := "The" if player == "" else ("Your" if player == me else "%s's" % _name(player))
	var what := "%s adjustments by hand%s" % [whose, (" for %s" % Val.text(o, "sourceName")) if Val.text(o, "sourceName") != "" else ""]
	match Val.text(o, "outcome"):
		"applied":
			return "%s were applied: every other player accepted." % what
		"rejected":
			var by := Val.text(o, "by")
			return "%s were rejected%s." % [what, (" by %s" % ("you" if by == me else _name(by))) if by != "" else ""]
		"withdrawn":
			return "%s were withdrawn." % what
		"failed":
			return "%s could not be applied." % what
	return ""


# ---- show my cards in replays -----------------------------------------------------------------------------------------------------

func _refresh_consent() -> void:
	var r := Val.dict(Online.status, "replay")
	_consent.visible = not r.is_empty()
	_consent_note.visible = not r.is_empty()
	if r.is_empty():
		return
	var agree := Val.flag(r, "agree")
	var chosen: bool = r.get("pending", agree) == true
	if _sending_consent != null and chosen == bool(_sending_consent):
		_sending_consent = null
	_consent.set_pressed_no_signal(bool(_sending_consent) if _sending_consent != null else chosen)
	_consent.disabled = Val.flag(r, "shared") or Val.flag(r, "tooLarge")
	if Val.flag(r, "shared"):
		_consent_note.text = "Every player agreed: every replay of this game holds the whole game."
	elif Val.flag(r, "tooLarge"):
		_consent_note.text = "Every player agreed, but this game is too large to send: each player keeps a replay of what they saw."
	elif r.has("pending"):
		_consent_note.text = "Not sent yet: the link to the host is down. Until it is back the host has your earlier choice (%s my cards), and a game that ends meanwhile counts that one." % ("show" if agree else "do not show")
	else:
		_consent_note.text = "Your hand, face-down cards and decklist. Only if every player ticks this does every player get the whole game after the end; otherwise each keeps a replay of what they saw."


func _on_consent(on: bool) -> void:
	_set_problem("")
	_sending_consent = on
	var r := await Online.reply(Online.set_replay_consent(on))
	if not bool(r.get("ok", false)):
		_sending_consent = null
		_set_problem(Val.text(OnlineUi.explain(Val.dict(r, "error")), "message"))
		_refresh_consent()


# ---- the chat -----------------------------------------------------------------------------------------------------------------------

func _send() -> void:
	var t := _chat_text.text.strip_edges()
	if t == "":
		return
	var r := await Online.reply(Online.say(t))
	if bool(r.get("ok", false)):
		_chat_text.text = ""
	else:
		_set_problem(Val.text(OnlineUi.explain(Val.dict(r, "error")), "message"))


func _set_problem(text: String) -> void:
	_problem.text = text
	_problem.visible = text != ""
	if text != "":
		Sound.cue("ui.error")
