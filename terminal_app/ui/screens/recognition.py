
from terminal_app.runtime import *
from terminal_app.ui.curses_helpers import *

def run_daily_recognition(
    stdscr: curses.window,
    questions: List[Question],
    all_cards: List[Card],
    state: Dict[str, Any],
    client: FirebaseClient,
    session: AuthSession,
    grammar_mode: bool = False,
    title_override: str = "",
    on_result: Optional[Any] = None,
) -> bool:
    title = title_override or ("每日文法例句聽力" if grammar_mode else "每日單字例句聽力")
    optional_mode = bool(on_result)
    if not questions:
        wait_message(stdscr, title, "這組題目已完成。" if optional_mode else "今天的題目已完成。")
        return False

    idx = 0
    revealed = False
    word_visible = False
    message = ""
    scroll_offset = 0
    results: Dict[str, bool] = {}
    spoken_question_id = ""
    cards_by_id = {card.id: card for card in all_cards}
    wrong_result_attr = curses.A_BOLD
    if curses.has_colors():
        curses.start_color()
        try:
            curses.use_default_colors()
            curses.init_pair(3, curses.COLOR_RED, -1)
            wrong_result_attr = curses.color_pair(3) | curses.A_BOLD
        except curses.error:
            pass
    set_cursor_visibility(0)
    stdscr.keypad(True)

    def finish_round() -> bool:
        if not optional_mode:
            wait_message(stdscr, "完成", f"今天的{title}已完成。")
            return True
        mistakes = practice_mistake_questions(
            questions,
            (question_id for question_id, correct in results.items() if not correct),
        )
        while practice_mistake_review_menu(stdscr, title, mistakes):
            if run_daily_recognition(
                stdscr,
                list(mistakes),
                all_cards,
                state,
                client,
                session,
                grammar_mode=grammar_mode,
                title_override=f"{title} | 錯題重測",
                on_result=lambda _question, _correct: None,
            ):
                return True
        return True

    while True:
        question = questions[idx]
        card = question.source
        graded = question.id in results
        if graded:
            revealed = True
        stdscr.erase()
        height, width = stdscr.getmaxyx()
        star_help = "" if grammar_mode else " 0=星號 *=不熟悉 -=已學習 9=單字"
        audio_label = "例句"
        draw_line(
            stdscr,
            1,
            2,
            f"{'文法聽力' if grammar_mode else '例句聽力'} | {title} | {idx + 1}/{len(questions)}  Esc=返回 {auto_audio_control_label()}{star_help} 7={audio_label} 8=揭露 4/6=上下題 1=答錯 2=答對 ↑↓=捲動",
            curses.A_BOLD,
        )
        if grammar_mode:
            prompt_text = question.ko if revealed else question.zh if word_visible else "[韓文隱藏，請聆聽例句]"
            prompt_prefix = ""
        else:
            prompt_text = question.ko if revealed else "[韓文隱藏，請聆聽例句]"
            prompt_prefix = f"{'★' if card.is_starred else '☆'} "
        folder_notice, display_message = folder_prompt_notice(message)
        detail_start = draw_wrapped(stdscr, 2, 2, width - 4, f"{prompt_prefix}{prompt_text}{folder_notice}", curses.A_BOLD)
        detail_lines: List[Tuple[str, int, int]] = []

        def append_detail(text: str, indent: int = 0, attr: int = 0) -> None:
            line_width = max(1, width - 4 - indent)
            for line in textwrap.wrap(text, line_width) or [""]:
                detail_lines.append((line, indent, attr))

        if not revealed:
            if not word_visible:
                listening_help = f"按 7 重播{audio_label}"
                reveal_label = "中文" if grammar_mode else "完整答案"
                append_detail(f"{listening_help}；按 8 顯示{reveal_label}。", attr=curses.A_DIM)
            else:
                append_detail(
                    "按 8 公佈韓文答案。" if grammar_mode else "按 8 查看完整單字卡。",
                    attr=curses.A_DIM,
                )
        else:
            if grammar_mode:
                append_detail(f"文法: {card.ko}", attr=curses.A_BOLD)
                for note in card.notes:
                    append_detail(f"筆記: {note}", indent=2, attr=curses.A_DIM)
                append_detail(f"韓文: {question.ko}", indent=2)
                append_detail(f"中文: {question.zh}", indent=2, attr=curses.A_DIM)
            else:
                heading = " / ".join(part for part in (card.zh, card.pos) if part)
                append_detail(heading, attr=curses.A_BOLD)
                for meaning_idx, meaning in enumerate(card.meanings, 1):
                    detail = f"{meaning_idx}. {meaning.get('zh', '')}"
                    if meaning.get("pattern"):
                        detail += f" · {meaning.get('pattern')}"
                    append_detail(detail, indent=2)
                    for example in meaning.get("examples") or []:
                        example_text = " / ".join(part for part in (example.get("ko"), example.get("zh")) if part)
                        append_detail(example_text, indent=4, attr=curses.A_DIM)
                for note in card.notes:
                    append_detail(f"筆記: {note}", indent=2, attr=curses.A_DIM)
                related_words = [cards_by_id[item_id].ko for item_id in card.related if item_id in cards_by_id]
                if related_words:
                    append_detail(f"相關詞: {'、'.join(related_words)}", indent=2, attr=curses.A_DIM)
            if not graded:
                append_detail("請按 1（答錯）或 2（答對）自評。", attr=curses.A_BOLD)
        visible_rows = max(1, height - detail_start - 2)
        scroll_offset = min(scroll_offset, max(0, len(detail_lines) - visible_rows))
        for row, (line, indent, attr) in enumerate(detail_lines[scroll_offset:scroll_offset + visible_rows], detail_start):
            draw_line(stdscr, row, 2 + indent, line, attr)
        footer = display_message
        if graded:
            if results[question.id]:
                result_text = "答對"
            elif grammar_mode:
                result_text = "答錯"
            elif optional_mode:
                result_text = "答錯，會回到可抽題池"
            else:
                result_text = "答錯，已保留到明日題目"
            footer = f"{result_text}。按 Enter 或 6 進入下一題。"
        elif revealed and not footer:
            footer = "1=答錯  2=答對"
        if len(detail_lines) > visible_rows:
            footer = f"{footer}  內容 {scroll_offset + 1}-{min(len(detail_lines), scroll_offset + visible_rows)}/{len(detail_lines)}"
        if footer:
            draw_line(stdscr, height - 1, 2, footer, wrong_result_attr if graded and not results[question.id] else curses.A_BOLD)
        update_curses_screen(stdscr)
        if is_auto_audio_enabled() and not word_visible and not graded and spoken_question_id != question.id:
            spoken_question_id = question.id
            if not speak_korean(question.ko):
                message = "無法播放語音：請確認 edge-tts 與 cvlc／ffplay 可用。"
            continue
        key = read_terminal_key(stdscr, wide=True)
        if isinstance(key, int) and 0 <= key <= 255:
            key = chr(key)
        if key == "\x1b":
            return False
        if key in ("\n", "\r") or key in (curses.KEY_ENTER, 10, 13):
            if not graded:
                message = "請先翻面並選擇答對或答錯。"
                continue
            if idx == len(questions) - 1:
                return finish_round()
            idx += 1
            revealed = questions[idx].id in results
            word_visible = revealed
            message = ""
            scroll_offset = 0
            continue
        if key == curses.KEY_UP:
            scroll_offset = max(0, scroll_offset - 1)
            continue
        if key == curses.KEY_DOWN:
            scroll_offset += 1
            continue
        if not isinstance(key, str):
            continue
        if key == "0" and not grammar_mode:
            snapshot = _clone_json(state)
            toggle_star(state, card)
            if not save_review_state_or_restore(stdscr, client, session, state, snapshot):
                card.is_starred = card.id in (state.get("starred") or [])
                message = ""
                continue
            message = "已打星號" if card.is_starred else "已取消星號"
        elif key == "8":
            was_revealed = revealed
            if not graded:
                if grammar_mode:
                    word_visible, revealed = next_recognition_reveal_state(True, word_visible, revealed)
                else:
                    word_visible, revealed = True, True
            message = ""
            if is_auto_audio_enabled() and not grammar_mode and not was_revealed and revealed:
                message = (
                    "已自動播放所屬韓文單字。"
                    if speak_korean(card.ko)
                    else "無法播放單字語音：請確認 edge-tts 與 cvlc／ffplay 可用。"
                )
            scroll_offset = 0
        elif key == "7":
            if not speak_korean(question.ko):
                message = "無法播放語音：請確認 edge-tts 與 cvlc／ffplay 可用。"
            else:
                message = "已重播韓文發音。"
        elif key == "9" and not grammar_mode:
            message = (
                "已重播韓文單字。"
                if speak_korean(card.ko)
                else "無法播放單字語音：請確認 edge-tts 與 cvlc／ffplay 可用。"
            )
        elif key == "-" and not grammar_mode:
            if not revealed:
                message = "請先按 8 揭露答案，再加入「已學習」。"
                continue
            try:
                added = mark_word_as_learned(client, session, state, question.item_id)
            except RuntimeError as exc:
                message = f"加入已學習失敗：{friendly_firebase_error(exc)}"
                continue
            if added:
                questions = questions[:idx + 1] + [
                    candidate for candidate in questions[idx + 1:]
                    if candidate.item_id != question.item_id
                ]
                message = "已加入「已學習」，本次尚未出現的同卡例句也已略過。"
            else:
                message = "這個單字已經在「已學習」資料夾中。"
        elif key in ("*", "u", "U") and not grammar_mode:
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
        elif key in ("1", "2"):
            if not revealed:
                message = "請先按 8 翻面查看答案。"
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
            elif not grammar_mode:
                snapshot = _clone_json(state)
                record_daily_recognition_answer(state, question, correct)
                if not save_review_state_or_restore(stdscr, client, session, state, snapshot):
                    message = ""
                    continue
            results[question.id] = correct
            message = ""
        elif key == "4":
            idx = max(0, idx - 1)
            revealed = questions[idx].id in results
            word_visible = revealed
            message = ""
            scroll_offset = 0
        elif key == "6":
            if not graded:
                message = "請先翻面並選擇答對或答錯。"
                continue
            if idx == len(questions) - 1:
                return finish_round()
            idx += 1
            revealed = questions[idx].id in results
            word_visible = revealed
            message = ""
            scroll_offset = 0


def practice_mistake_questions(
    questions: Iterable[Question],
    wrong_question_ids: Iterable[str],
) -> List[Question]:
    wrong_ids = set(wrong_question_ids)
    seen: set[str] = set()
    result: List[Question] = []
    for question in questions:
        if question.id not in wrong_ids:
            continue
        review_key = (
            f"grammar:{question.id}"
            if question.kind == "grammar-example"
            else f"word:{question.item_id or question.source.id or question.id}"
        )
        if review_key in seen:
            continue
        seen.add(review_key)
        result.append(question)
    return result


def practice_mistake_review_menu(
    stdscr: curses.window,
    title: str,
    questions: List[Question],
    allow_retry: bool = True,
) -> bool:
    if not questions:
        wait_message(stdscr, "測驗完成", "這一輪沒有答錯的題目。")
        return False
    scroll_offset = 0
    set_cursor_visibility(0)
    while True:
        stdscr.erase()
        height, width = stdscr.getmaxyx()
        draw_line(stdscr, 1, 2, f"錯誤單字檢討 | {title} | {len(questions)} 題", curses.A_BOLD)
        controls = "Enter=只重測錯題 Esc=結束" if allow_retry else "Enter/Esc=結束"
        draw_line(stdscr, 2, 2, f"{controls} ↑↓=捲動", curses.A_DIM)
        lines: List[str] = []
        for index, question in enumerate(questions, 1):
            korean = question.ko if question.kind == "grammar-example" else question.source.ko or question.ko
            chinese = question.zh if question.kind == "grammar-example" else question.source.zh or question.zh
            lines.extend(_split_by_cell_width(f"{index}. {korean} / {chinese}", max(1, width - 4)))
        visible_rows = max(1, height - 4)
        max_scroll = max(0, len(lines) - visible_rows)
        scroll_offset = min(scroll_offset, max_scroll)
        for row, line in enumerate(lines[scroll_offset:scroll_offset + visible_rows], 3):
            draw_line(stdscr, row, 2, line)
        if max_scroll:
            draw_line(
                stdscr,
                height - 1,
                2,
                f"內容 {scroll_offset + 1}-{min(len(lines), scroll_offset + visible_rows)}/{len(lines)}",
                curses.A_DIM,
            )
        update_curses_screen(stdscr)
        key = read_terminal_key(stdscr, wide=True)
        if key in ("\x1b", 27):
            return False
        if key == curses.KEY_UP:
            scroll_offset = max(0, scroll_offset - 1)
        elif key == curses.KEY_DOWN:
            scroll_offset = min(max_scroll, scroll_offset + 1)
        elif key in ("\n", "\r", curses.KEY_ENTER, 10, 13):
            return allow_retry



__all__ = [name for name in globals() if not name.startswith("__")]
