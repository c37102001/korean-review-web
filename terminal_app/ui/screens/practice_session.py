
from terminal_app.runtime import *
from terminal_app.domain.content import card_korean_forms
from terminal_app.ui.curses_helpers import *
from terminal_app.ui.screens.recognition import practice_mistake_questions, practice_mistake_review_menu

def run_practice(stdscr: curses.window, title: str, questions: List[Question], config: Dict[str, Any], state: Dict[str, Any], client: FirebaseClient, session: AuthSession) -> bool:
    excluded_ids = set(state.get("learnedWordIds") or [])
    questions = [question for question in questions if question.kind == "grammar-example" or (question.item_id not in excluded_ids and not question.source.no_review)]
    idx = 0
    user_input = ""
    input_cursor = 0
    show_hint = False
    message = ""
    result_message = ""
    partial: Optional[PartialCheckResult] = None
    graded = False
    last_correct: Optional[bool] = None
    typed_attempts = 0
    retry_diff = False
    example_index = 0
    pending_example_audio = ""
    pending_word_audio = False
    spoken_question_id = ""
    scroll_offset = 0
    wrong_question_ids: set[str] = set()
    ok_attr = curses.A_BOLD
    wrong_attr = curses.A_REVERSE | curses.A_BOLD
    wrong_result_attr = curses.A_BOLD
    self_grade_mode = config.get("direction") == "ko-zh" or config.get("answer_mode") == "self-grade"
    set_cursor_visibility(0 if self_grade_mode else 1)
    stdscr.keypad(True)
    should_record_results = config.get("record_results", False)
    enforce_answer_length = config.get("enforce_answer_length", False)
    allow_star = config.get("allow_star", True)
    require_answer_before_next = config.get("require_answer_before_next", False)
    daily_review = config.get("daily_review", False)
    on_result = config.get("on_result")
    auto_answer_audio = config.get("auto_answer_audio", True)

    def remember_result(target: Question, correct: bool) -> None:
        if correct:
            wrong_question_ids.discard(target.id)
        else:
            wrong_question_ids.add(target.id)

    def finish_round() -> bool:
        set_cursor_visibility(0)
        mistakes = practice_mistake_questions(questions, wrong_question_ids)
        if daily_review:
            practice_mistake_review_menu(stdscr, title, mistakes, allow_retry=False)
            return True
        if not config.get("allow_mistake_retry", True):
            if config.get("show_mistake_review", True):
                practice_mistake_review_menu(stdscr, title, mistakes, allow_retry=False)
            else:
                wait_message(stdscr, "完成", "這組題目已完成。")
            return True
        while practice_mistake_review_menu(stdscr, title, mistakes):
            retry_config = {
                **config,
                "record_results": should_record_results and on_result is None,
                "on_result": None,
                "daily_review": False,
            }
            if run_practice(
                stdscr,
                f"{config.get('_base_title') or title} | 錯題重測",
                list(mistakes),
                {**retry_config, "_base_title": config.get("_base_title") or title},
                state,
                client,
                session,
            ):
                return True
        return True
    if curses.has_colors():
        curses.start_color()
        try:
            curses.use_default_colors()
            curses.init_pair(1, curses.COLOR_GREEN, -1)
            curses.init_pair(2, curses.COLOR_BLACK, curses.COLOR_RED)
            curses.init_pair(3, curses.COLOR_RED, -1)
            ok_attr = curses.color_pair(1) | curses.A_BOLD
            wrong_attr = curses.color_pair(2) | curses.A_BOLD
            wrong_result_attr = curses.color_pair(3) | curses.A_BOLD
        except curses.error:
            pass
    while True:
        if not questions:
            wait_message(stdscr, "測驗", "沒有可測驗的題目。")
            set_cursor_visibility(0)
            return False
        question = questions[idx]
        answer_word = question.source.ko if question.source.pos != "文法" else ""
        prompt = question.zh if config["direction"] == "zh-ko" else card_korean_forms(question.source) if question.kind == "term" else question.ko
        answer = question.ko if config["direction"] == "zh-ko" else question.zh
        if question.kind == "term":
            examples = card_examples(question.source)
        elif question.kind == "grammar-example":
            examples = [{"ko": question.ko, "zh": question.zh}]
        else:
            examples = []
        if examples:
            example_index %= len(examples)
        else:
            example_index = 0
        example_audio_enabled = bool(examples)
        stdscr.erase()
        height, width = stdscr.getmaxyx()
        record_label = "" if should_record_results else " 不紀錄"
        star_help = " 0=星號" if allow_star else ""
        unfamiliar_help = " *=不熟悉" if question.source.pos != "文法" else ""
        answer_visible = show_hint or graded
        learned_help = " -=已學習" if answer_visible and daily_review and question.kind == "term" else ""
        self_grade_help = " 1=答錯 2=答對" if self_grade_mode and answer_visible and not graded else ""
        scroll_help = " ↑↓=捲動" if answer_visible else ""
        word_audio_help = " 9=單字" if answer_word else ""
        if answer_visible and example_audio_enabled:
            example_controls = "7=例句" if question.kind == "grammar-example" else "7=例句 +=下一句"
            controls = f"Esc=返回{star_help}{unfamiliar_help}{learned_help}{self_grade_help}{word_audio_help} {example_controls}{scroll_help} 4/6=上下題 Enter={'下一題' if graded else '送出'}"
        else:
            prompt_audio_help = " 7=題目" if config["direction"] == "ko-zh" and not answer_visible else ""
            check_help = " +=檢查" if not self_grade_mode else ""
            controls = f"Esc=返回{star_help}{unfamiliar_help}{learned_help}{self_grade_help}{word_audio_help}{prompt_audio_help} 8=答案{scroll_help} 4/6=上下題{check_help} Enter={'下一題' if graded else '送出'}"
        draw_line(stdscr, 1, 2, f"測驗{record_label} | {title} | {idx + 1}/{len(questions)}  {auto_audio_control_label()} {controls}", curses.A_BOLD)
        length_hint = f"  ({count_korean_letters(answer)} 個韓文字)" if config["direction"] == "zh-ko" else ""
        star_prefix = f"{'★' if question.source.is_starred else '☆'} " if allow_star else ""
        folder_notice, display_message = folder_prompt_notice(message)
        y = draw_wrapped(stdscr, 2, 2, width - 4, f"{star_prefix}題目: {prompt}{length_hint}{folder_notice}")
        display_answer = card_korean_forms(question.source) if question.kind == "term" and config["direction"] == "zh-ko" else answer
        draw_line(stdscr, y, 2, f"答案: {display_answer}" if show_hint else "答案: hidden (press 8)")
        input_y = y + 1
        if self_grade_mode:
            record_status = "已記錄" if should_record_results else "未紀錄"
            self_grade_status = (
                f"自評: 答對，{record_status}" if graded and last_correct is True
                else f"自評: 答錯，{record_status}" if graded
                else "自評: 1=答錯  2=答對" if show_hint
                else "自評: 請先按 8 公佈答案"
            )
            draw_line(
                stdscr,
                input_y,
                2,
                self_grade_status,
                ok_attr if graded and last_correct is True else wrong_result_attr if graded else 0,
            )
            positions = [2]
        else:
            answered_attr = ok_attr if graded and last_correct is True else 0
            positions = draw_answer_with_feedback(stdscr, input_y, 2, "輸入: ", user_input, partial, ok_attr, wrong_attr, answered_attr)
            count_x = max(positions[-1] + 2, width - 18)
            draw_line(stdscr, input_y, count_x, f"{count_korean_letters(user_input)} 個韓文字", curses.A_DIM)
        detail_start = input_y + 1
        detail_lines: List[Tuple[str, int, int]] = []

        def append_detail(text: str, indent: int = 0, attr: int = 0) -> None:
            line_width = max(1, width - 4 - indent)
            for line in _split_by_cell_width(text, line_width):
                detail_lines.append((line, indent, attr))

        if (show_hint or graded) and question.kind == "grammar-example":
            append_detail(f"筆記: {question.source.ko}", attr=curses.A_BOLD)
            for note in question.source.notes:
                append_detail(f"筆記: {note}", indent=2, attr=curses.A_DIM)
            append_detail(f"韓文: {question.ko}", indent=2)
            append_detail(f"中文: {question.zh}", indent=2, attr=curses.A_DIM)
        elif (show_hint or graded) and question.kind == "term":
            if examples:
                append_detail("例句:", attr=curses.A_DIM)
                for index, example in enumerate(examples):
                    marker = "▶" if index == example_index else " "
                    text = " / ".join(part for part in (example.get("ko"), example.get("zh")) if part)
                    append_detail(
                        f"{marker} {index + 1}. {text}",
                        indent=2,
                        attr=curses.A_BOLD if index == example_index else curses.A_DIM,
                    )
        if (show_hint or graded) and question.source.pos != "文法" and question.source.notes:
            append_detail("筆記:", attr=curses.A_DIM)
            for note in question.source.notes:
                append_detail(str(note), indent=2, attr=curses.A_DIM)
        if not self_grade_mode and (retry_diff or (graded and last_correct is False)):
            draw_answer_diff(stdscr, detail_start, 2, user_input, answer, wrong_attr)
            detail_start += 1
        visible_rows = max(1, height - detail_start - 1)
        max_scroll = max(0, len(detail_lines) - visible_rows)
        scroll_offset = min(scroll_offset, max_scroll)
        for row, (line, indent, attr) in enumerate(
            detail_lines[scroll_offset:scroll_offset + visible_rows],
            detail_start,
        ):
            draw_line(
                stdscr,
                row,
                2 + indent,
                line,
                attr,
            )
        footer_parts = []
        if display_message:
            footer_parts.append(display_message)
        if len(detail_lines) > visible_rows:
            footer_parts.append(
                f"內容 {scroll_offset + 1}-{min(len(detail_lines), scroll_offset + visible_rows)}/{len(detail_lines)}"
            )
        if footer_parts:
            draw_line(
                stdscr,
                height - 1,
                2,
                "  ".join(footer_parts),
                wrong_result_attr if retry_diff or (graded and last_correct is False) else curses.A_BOLD,
            )
        if not self_grade_mode:
            cursor_x = positions[min(input_cursor, len(positions) - 1)]
            stdscr.move(min(height - 1, input_y), min(width - 1, cursor_x))
        update_curses_screen(stdscr)
        if pending_word_audio:
            pending_word_audio = False
            if speak_korean(answer_word):
                word_audio_message = "已自動播放韓文單字。"
            else:
                word_audio_message = "無法播放單字語音：請確認 edge-tts 與 cvlc／ffplay 可用。"
            message = " ".join(part for part in (result_message, word_audio_message) if part)
            continue
        if pending_example_audio:
            audio_action = pending_example_audio
            pending_example_audio = ""
            if speak_korean(examples[example_index]["ko"]):
                action_label = {
                    "replay": "已重播",
                    "next": "已切換並播放",
                }[audio_action]
                audio_message = f"{action_label}例句 {example_index + 1}/{len(examples)}。"
            else:
                audio_message = "無法播放例句語音：請確認 edge-tts 與 cvlc／ffplay 可用。"
            message = " ".join(part for part in (result_message, audio_message) if part)
            continue
        if config.get("auto_prompt_audio", True) and is_auto_audio_enabled() and config["direction"] == "ko-zh" and not answer_visible and spoken_question_id != question.id:
            spoken_question_id = question.id
            message = (
                "已自動播放韓文題目。"
                if speak_korean(question.ko)
                else "無法播放語音：請確認 edge-tts 與 cvlc／ffplay 可用。"
            )
            continue
        key = read_terminal_key(stdscr, wide=True)
        if key == "\x1b":
            set_cursor_visibility(0)
            return False
        if key in ("\n", "\r") or key in (curses.KEY_ENTER, 10, 13):
            if graded:
                if idx == len(questions) - 1:
                    return finish_round()
                idx += 1
                user_input = ""
                input_cursor = 0
                show_hint = False
                partial = None
                graded = False
                last_correct = None
                typed_attempts = 0
                retry_diff = False
                example_index = 0
                pending_example_audio = ""
                pending_word_audio = False
                message = ""
                result_message = ""
                scroll_offset = 0
                continue
            if self_grade_mode:
                message = "請先按 8 公佈答案，再按 1 或 2 自評。"
                continue
            user_input = user_input.strip()
            input_cursor = min(input_cursor, len(user_input))
            if enforce_answer_length:
                length_warning = korean_length_warning(user_input, answer)
                if length_warning:
                    partial = None
                    retry_diff = False
                    message = length_warning
                    continue
            correct = normalize_text(user_input) == normalize_text(answer)
            if not correct and question.kind in ("example", "grammar-example") and config["direction"] == "zh-ko" and typed_attempts == 0:
                typed_attempts = 1
                retry_diff = True
                partial = None
                show_hint = False
                message = (
                    "例句第一次答錯：先看提示再試一次，第二次答錯才會記錄。"
                    if should_record_results
                    else "例句第一次答錯：先看提示再試一次，第二次答錯才會公佈答案。"
                )
                continue
            if on_result:
                try:
                    on_result(question, correct)
                except RuntimeError as exc:
                    message = friendly_firebase_error(exc)
                    continue
            elif should_record_results:
                snapshot = _clone_json(state)
                record_answer(state, question, correct)
                if not save_review_state_or_restore(stdscr, client, session, state, snapshot):
                    message = ""
                    continue
            show_hint = True
            partial = None
            graded = True
            last_correct = correct
            remember_result(question, correct)
            retry_diff = False
            if should_record_results:
                message = "答對，已記錄。按 Enter 或 6 進入下一題。" if correct else "答錯，已記錄。按 Enter 或 6 進入下一題。"
            else:
                message = "答對，未紀錄。按 Enter 或 6 進入下一題。" if correct else "答錯，未紀錄。按 Enter 或 6 進入下一題。"
            result_message = message
            pending_word_audio = auto_answer_audio and is_auto_audio_enabled() and bool(answer_word)
            continue
        if key in (curses.KEY_BACKSPACE, "\b", "\x7f"):
            if graded:
                continue
            if input_cursor > 0:
                user_input = user_input[: input_cursor - 1] + user_input[input_cursor:]
                input_cursor -= 1
            partial = None
            retry_diff = False
            continue
        if key == curses.KEY_LEFT:
            if graded:
                continue
            input_cursor = max(0, input_cursor - 1)
            continue
        if key == curses.KEY_RIGHT:
            if graded:
                continue
            input_cursor = min(len(user_input), input_cursor + 1)
            continue
        if key == curses.KEY_UP and answer_visible:
            scroll_offset = max(0, scroll_offset - 1)
            continue
        if key == curses.KEY_DOWN and answer_visible:
            scroll_offset = min(max_scroll, scroll_offset + 1)
            continue
        if isinstance(key, str):
            if key == "0" and allow_star:
                snapshot = _clone_json(state)
                toggle_star(state, question.source)
                if not save_review_state_or_restore(stdscr, client, session, state, snapshot):
                    question.source.is_starred = question.source.id in (state.get("starred") or [])
                    message = ""
                    continue
                message = "已打星號" if question.source.is_starred else "已取消星號"
            elif key == "*" and question.source.pos != "文法":
                try:
                    now_unfamiliar = toggle_word_as_unfamiliar(client, session, state, question.item_id)
                except RuntimeError as exc:
                    message = f"更新不熟悉失敗：{friendly_firebase_error(exc)}"
                    continue
                message = (
                    "已加入「不熟悉」，仍會照常出現在每日測驗。"
                    if now_unfamiliar
                    else "已移出「不熟悉」。"
                )
                result_message = message
            elif key == "-" and daily_review and question.kind == "term":
                if not answer_visible:
                    message = "請先公佈答案，再加入「已學習」。"
                    continue
                try:
                    added = mark_word_as_learned(client, session, state, question.item_id)
                except RuntimeError as exc:
                    message = f"加入已學習失敗：{friendly_firebase_error(exc)}"
                    continue
                message = (
                    "已加入「已學習」，未來每日測驗不再出現。"
                    if added
                    else "這個單字已經在「已學習」資料夾中。"
                )
                result_message = message
            elif key in ("u", "U") and daily_review and question.kind == "term":
                if not answer_visible:
                    message = "請先公佈答案，再加入「不熟悉」。"
                    continue
                try:
                    added = mark_word_as_unfamiliar(client, session, state, question.item_id)
                except RuntimeError as exc:
                    message = f"加入不熟悉失敗：{friendly_firebase_error(exc)}"
                    continue
                message = (
                    "已加入「不熟悉」，仍會照常出現在每日測驗。"
                    if added
                    else "這個單字已經在「不熟悉」資料夾中。"
                )
                result_message = message
            elif key == "8":
                revealing_answer = not show_hint
                show_hint = revealing_answer
                scroll_offset = 0
                if revealing_answer:
                    pending_word_audio = auto_answer_audio and is_auto_audio_enabled() and bool(answer_word)
            elif key in ("1", "2") and self_grade_mode:
                if not show_hint:
                    message = "請先按 8 公佈答案。"
                    continue
                if graded:
                    message = "這題已完成評分。"
                    continue
                correct = key == "2"
                if on_result:
                    try:
                        on_result(question, correct)
                    except RuntimeError as exc:
                        message = friendly_firebase_error(exc)
                        continue
                elif should_record_results:
                    snapshot = _clone_json(state)
                    record_answer(state, question, correct)
                    if not save_review_state_or_restore(stdscr, client, session, state, snapshot):
                        message = ""
                        continue
                graded = True
                last_correct = correct
                remember_result(question, correct)
                result_label = "答對" if correct else "答錯"
                record_suffix = "已記錄" if should_record_results else "未紀錄"
                message = f"{result_label}，{record_suffix}。按 Enter 或 6 進入下一題。"
                result_message = message
            elif key == "9" and answer_word:
                message = (
                    "已重播韓文單字。"
                    if speak_korean(answer_word)
                    else "無法播放單字語音：請確認 edge-tts 與 cvlc／ffplay 可用。"
                )
            elif key == "7" and (
                (answer_visible and example_audio_enabled)
                or (config["direction"] == "ko-zh" and not answer_visible)
            ):
                if answer_visible and example_audio_enabled:
                    pending_example_audio = "replay"
                elif config["direction"] == "ko-zh" and not answer_visible:
                    message = (
                        "已重播韓文題目。"
                        if speak_korean(question.ko)
                        else "無法播放語音：請確認 edge-tts 與 cvlc／ffplay 可用。"
                    )
            elif key == "+":
                if answer_visible and example_audio_enabled and question.kind != "grammar-example":
                    example_index = (example_index + 1) % len(examples)
                    pending_example_audio = "next"
                    continue
                if graded:
                    message = "這張單字卡沒有其他可播放的例句。"
                    continue
                if self_grade_mode:
                    message = "心中作答模式請先公佈答案，再按 1 或 2 自評。"
                    continue
                user_input = user_input.strip()
                input_cursor = min(input_cursor, len(user_input))
                partial = partial_check_input(user_input, answer)
                message = "目前都正確。" if partial.all_correct_prefix and user_input else "有錯誤或缺字。"
            elif key == "4":
                idx = max(0, idx - 1)
                user_input = ""
                input_cursor = 0
                show_hint = False
                partial = None
                graded = False
                last_correct = None
                typed_attempts = 0
                retry_diff = False
                example_index = 0
                pending_example_audio = ""
                pending_word_audio = False
                message = ""
                result_message = ""
                scroll_offset = 0
            elif key == "6":
                if require_answer_before_next and not graded:
                    message = "請先送出這一題的答案。"
                    continue
                if idx == len(questions) - 1 and graded:
                    return finish_round()
                idx = min(len(questions) - 1, idx + 1)
                user_input = ""
                input_cursor = 0
                show_hint = False
                partial = None
                graded = False
                last_correct = None
                typed_attempts = 0
                retry_diff = False
                example_index = 0
                pending_example_audio = ""
                pending_word_audio = False
                message = ""
                result_message = ""
                scroll_offset = 0
            elif key.isprintable():
                if graded or self_grade_mode:
                    continue
                user_input = user_input[:input_cursor] + key + user_input[input_cursor:]
                input_cursor += 1
                partial = None
                retry_diff = False



__all__ = [name for name in globals() if not name.startswith("__")]
