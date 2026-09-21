
from terminal_app.runtime import *
from terminal_app.ui.curses_helpers import *

def ordered_study_cards(cards: List[Card], order_mode: str) -> List[Card]:
    ordered = list(cards)
    if order_mode == "alphabetical":
        ordered.sort(key=lambda card: (unicodedata.normalize("NFC", card.ko).casefold(), card.zh, card.id))
    elif order_mode == "random":
        random.shuffle(ordered)
    return ordered


def run_study(
    stdscr: curses.window,
    title: str,
    cards: List[Card],
    state: Dict[str, Any],
    client: FirebaseClient,
    session: AuthSession,
    front_side: str = "ko",
) -> None:
    front_side = "zh" if front_side == "zh" else "ko"
    idx = 0
    show_details = False
    show_chinese = False
    example_index = 0
    scroll_offset = 0
    message = ""
    spoken_card_id = ""
    auto_playing = False
    repeat_count = 1
    auto_card_id = ""
    auto_steps: List[Tuple[str, int, str, int]] = []
    auto_step_index = 0
    cards_by_id = {card.id: card for card in cards}
    set_cursor_visibility(0)
    while True:
        if not cards:
            wait_message(stdscr, "學習模式", "沒有可學習的卡片。")
            return
        card = cards[idx]
        examples = card_examples(card)
        if examples:
            example_index %= len(examples)
        else:
            example_index = 0
        if auto_playing and (auto_card_id != card.id or not auto_steps):
            auto_card_id = card.id
            auto_steps = study_auto_audio_steps(card, repeat_count)
            auto_step_index = 0
        auto_step = auto_steps[auto_step_index] if auto_playing and auto_steps else None
        auto_face = auto_step[0] if auto_step else ""
        if auto_step and auto_step[1] >= 0:
            example_index = auto_step[1]
        clear_with_default_background(stdscr)
        height, width = stdscr.getmaxyx()
        draw_line(
            stdscr,
            1,
            2,
            f"學習 | {title} | {idx + 1}/{len(cards)}  Esc=返回 A=自動:{'開' if auto_playing else '關'} 1/2=重複:{repeat_count} {auto_audio_control_label()} 0=星號 *=不熟悉 5={'中文' if front_side == 'ko' else '韓文'} 9=單字 7=例句 +=下一例句 8=詳情 ↑↓=捲動 4/6=上下張",
            curses.A_BOLD,
        )
        folder_notice, display_message = folder_prompt_notice(message)
        detail_lines: List[Tuple[str, int, int]] = []

        def append_detail(text: str, indent: int = 0, attr: int = 0) -> None:
            line_width = max(1, width - 4 - indent)
            for line in _split_by_cell_width(str(text), line_width):
                detail_lines.append((line, indent, attr))

        front_text = card.ko if front_side == "ko" else card.zh
        append_detail(f"{'★' if card.is_starred else '☆'} {front_text}{folder_notice}", attr=curses.A_BOLD)
        on_back = auto_face != "front"
        show_full_details = show_chinese or show_details or auto_face == "back"
        if front_side == "zh" and show_full_details:
            append_detail(f"韓文: {card.ko}", attr=curses.A_BOLD)
        if front_side == "ko" and on_back and show_chinese and card.zh:
            append_detail(f"中文: {card.zh}", attr=curses.A_BOLD)
        if on_back and show_full_details and card.meanings:
            append_detail("意思與句型:", attr=curses.A_DIM)
            for meaning_index, meaning in enumerate(card.meanings, 1):
                detail_parts = []
                if show_chinese and meaning.get("zh"):
                    detail_parts.append(str(meaning.get("zh")))
                if meaning.get("pattern"):
                    detail_parts.append(str(meaning.get("pattern")))
                if detail_parts:
                    append_detail(f"{meaning_index}. {' · '.join(detail_parts)}", indent=2)
        show_examples = on_back and (front_side == "ko" or show_full_details)
        if show_examples and examples:
            append_detail("例句:", attr=curses.A_DIM)
            for current_index, example in enumerate(examples):
                marker = "▶" if current_index == example_index else " "
                attr = curses.A_BOLD if current_index == example_index else 0
                append_detail(f"{marker} {current_index + 1}. {example.get('ko', '')}", indent=2, attr=attr)
                if (show_chinese or front_side == "zh") and example.get("zh"):
                    append_detail(str(example.get("zh")), indent=5, attr=curses.A_DIM)
        if on_back and show_full_details and card.notes:
            append_detail("筆記:", attr=curses.A_DIM)
            for note in card.notes:
                append_detail(note, indent=2, attr=curses.A_DIM)
        if on_back and show_full_details and card.related:
            related_words = [cards_by_id[item_id].ko for item_id in card.related if item_id in cards_by_id]
            if related_words:
                append_detail(f"相關詞: {'、'.join(related_words)}", attr=curses.A_DIM)

        visible_rows = max(1, height - 3)
        max_scroll = max(0, len(detail_lines) - visible_rows)
        scroll_offset = min(scroll_offset, max_scroll)
        for row, (line, indent, attr) in enumerate(
            detail_lines[scroll_offset:scroll_offset + visible_rows],
            2,
        ):
            draw_line(stdscr, row, 2 + indent, line, attr)

        footer_parts = []
        if display_message:
            footer_parts.append(display_message)
        if auto_step:
            face_label = "正面" if auto_face == "front" else "反面"
            footer_parts.append(f"自動播放 · 第 {auto_step[3]}/{repeat_count} 次 · {face_label}")
        if max_scroll:
            footer_parts.append(
                f"內容 {scroll_offset + 1}-{min(len(detail_lines), scroll_offset + visible_rows)}/{len(detail_lines)}"
            )
        if footer_parts:
            draw_line(stdscr, height - 1, 2, "  ".join(footer_parts), curses.A_DIM)
        update_curses_screen(stdscr)
        if auto_step:
            spoken_card_id = card.id
            if auto_step[2]:
                played = speak_korean(auto_step[2])
                if auto_face == "front":
                    message = "已自動播放韓文單字。" if played else "無法播放韓文單字語音。"
                else:
                    message = (
                        f"已自動播放例句 {auto_step[1] + 1}/{len(examples)}。"
                        if played
                        else "無法播放韓文例句語音。"
                    )
            else:
                message = "這張卡片的反面沒有韓文例句。"
            key = read_terminal_key_with_timeout(stdscr, 420 if auto_step[2] else 900, wide=True)
            if key == "\x1b":
                return
            if key == curses.KEY_UP:
                auto_playing = False
                auto_steps = []
                scroll_offset = max(0, scroll_offset - 1)
                message = "已暫停完整自動播放。"
                continue
            if key == curses.KEY_DOWN:
                auto_playing = False
                auto_steps = []
                scroll_offset = min(max_scroll, scroll_offset + 1)
                message = "已暫停完整自動播放。"
                continue
            if key in ("a", "A"):
                auto_playing = False
                message = "已暫停完整自動播放。"
                continue
            if key in ("1", "2"):
                repeat_count = int(key)
                auto_card_id = ""
                auto_steps = []
                message = f"每張卡片改為完整播放 {repeat_count} 次，從正面重新開始。"
                continue
            if key == "*":
                try:
                    now_unfamiliar = toggle_word_as_unfamiliar(client, session, state, card.id)
                except RuntimeError as exc:
                    message = f"更新不熟悉失敗：{friendly_firebase_error(exc)}"
                else:
                    message = (
                        "已加入「不熟悉」。"
                        if now_unfamiliar
                        else "已移出「不熟悉」。"
                    )
                continue
            if key == "5":
                show_chinese = not show_chinese
                scroll_offset = 0
                content_label = "中文" if front_side == "ko" else "韓文與完整內容"
                message = f"已顯示{content_label}。" if show_chinese else f"已隱藏{content_label}。"
            elif key == "4":
                idx = max(0, idx - 1)
                show_details = False
                show_chinese = False
                example_index = 0
                auto_card_id = ""
                auto_steps = []
                scroll_offset = 0
                message = ""
                continue
            elif key == "6":
                idx = min(len(cards) - 1, idx + 1)
                show_details = False
                show_chinese = False
                example_index = 0
                auto_card_id = ""
                auto_steps = []
                scroll_offset = 0
                message = ""
                continue
            elif key == curses.KEY_RESIZE and not is_auto_audio_enabled():
                auto_playing = False
                message = "自動語音已關閉，完整自動播放已暫停。"
                continue
            auto_step_index += 1
            if auto_step_index >= len(auto_steps):
                idx = (idx + 1) % len(cards)
                show_details = False
                show_chinese = False
                example_index = 0
                auto_card_id = ""
                auto_steps = []
                auto_step_index = 0
                scroll_offset = 0
                message = ""
            continue
        if is_auto_audio_enabled() and front_side == "ko" and spoken_card_id != card.id:
            spoken_card_id = card.id
            message = (
                "已自動播放韓文單字。"
                if speak_korean(card.ko)
                else "無法播放單字語音：請確認 edge-tts 與 cvlc／ffplay 可用。"
            )
            continue
        key = read_terminal_key(stdscr, wide=True)
        if key == "\x1b":
            return
        if key == curses.KEY_UP:
            scroll_offset = max(0, scroll_offset - 1)
            continue
        if key == curses.KEY_DOWN:
            scroll_offset = min(max_scroll, scroll_offset + 1)
            continue
        if key in ("a", "A"):
            if front_side == "zh":
                message = "中文正面暫不支援完整自動播放；按 5 顯示韓文後可用 9、7 播放語音。"
                continue
            if not is_auto_audio_enabled():
                message = "請先按 . 開啟自動語音，再啟動完整自動播放。"
                continue
            auto_playing = True
            auto_card_id = ""
            auto_steps = []
            auto_step_index = 0
            message = "開始完整自動播放。"
        elif key in ("1", "2"):
            repeat_count = int(key)
            message = f"每張卡片將完整播放 {repeat_count} 次。"
        elif key == "0":
            snapshot = _clone_json(state)
            toggle_star(state, card)
            if not save_review_state_or_restore(stdscr, client, session, state, snapshot):
                card.is_starred = card.id in (state.get("starred") or [])
                message = ""
                continue
            message = "已打星號" if card.is_starred else "已取消星號"
        elif key == "*":
            try:
                now_unfamiliar = toggle_word_as_unfamiliar(client, session, state, card.id)
            except RuntimeError as exc:
                message = f"更新不熟悉失敗：{friendly_firebase_error(exc)}"
                continue
            message = (
                "已加入「不熟悉」。"
                if now_unfamiliar
                else "已移出「不熟悉」。"
            )
        elif key == "8":
            show_details = not show_details
            scroll_offset = 0
        elif key == "5":
            show_chinese = not show_chinese
            scroll_offset = 0
            content_label = "中文" if front_side == "ko" else "韓文與完整內容"
            message = f"已顯示{content_label}。" if show_chinese else f"已隱藏{content_label}。"
        elif key == "9":
            message = (
                "已重播韓文單字。"
                if speak_korean(card.ko)
                else "無法播放單字語音：請確認 edge-tts 與 cvlc／ffplay 可用。"
            )
        elif key in ("7", "+"):
            if not examples:
                message = "這張單字卡沒有可播放的韓文例句。"
                continue
            if key == "+":
                example_index = (example_index + 1) % len(examples)
            if speak_korean(examples[example_index].get("ko", "")):
                message = f"已播放例句 {example_index + 1}/{len(examples)}。"
            else:
                message = "無法播放例句語音：請確認 edge-tts 與 cvlc／ffplay 可用。"
        elif key == "4":
            idx = max(0, idx - 1)
            show_details = False
            show_chinese = False
            example_index = 0
            scroll_offset = 0
            message = ""
        elif key == "6":
            idx = min(len(cards) - 1, idx + 1)
            show_details = False
            show_chinese = False
            example_index = 0
            scroll_offset = 0
            message = ""



__all__ = [name for name in globals() if not name.startswith("__")]
