
from terminal_app.runtime import *
from terminal_app.ui.curses_helpers import *

def subtitle_time_label(milliseconds: Any) -> str:
    try:
        total_seconds = max(0, int(float(milliseconds or 0) // 1000))
    except (TypeError, ValueError):
        total_seconds = 0
    hours, remainder = divmod(total_seconds, 3600)
    minutes, seconds = divmod(remainder, 60)
    return f"{hours}:{minutes:02d}:{seconds:02d}" if hours else f"{minutes}:{seconds:02d}"


def subtitle_entry_index_at_time(entries: List[Dict[str, Any]], milliseconds: float) -> Optional[int]:
    timed_entries = [
        (index, float(entry["startMs"]))
        for index, entry in enumerate(entries)
        if isinstance(entry.get("startMs"), (int, float))
    ]
    if not timed_entries:
        return None
    active_index = timed_entries[0][0]
    for index, start_ms in timed_entries:
        if start_ms > milliseconds:
            break
        active_index = index
    return active_index


def run_youtube_subtitle_detail(
    stdscr: curses.window,
    subtitles: List[YoutubeSubtitle],
    start_index: int,
) -> None:
    subtitle_index = start_index
    entry_index = 0
    scroll_offset = 0
    show_chinese = True
    message = ""
    audio_player: Optional[TerminalYoutubeAudioPlayer] = None
    set_cursor_visibility(0)
    stdscr.keypad(True)

    def prepare_audio(subtitle: YoutubeSubtitle, start_ms: float = 0) -> str:
        nonlocal audio_player
        if audio_player:
            audio_player.stop()
            audio_player = None
        if not subtitle.youtube_url:
            return "這篇字幕沒有 YouTube 連結，7 仍可播放 TTS。"
        if not TerminalYoutubeAudioPlayer.available():
            return "缺少 ffplay 或 cvlc，無法播放 YouTube 原音。"
        stdscr.erase()
        draw_line(stdscr, 1, 2, f"YT字幕 | {subtitle.title}", curses.A_BOLD)
        draw_line(stdscr, 3, 2, "正在準備 YouTube 音訊；第一次開啟需要下載，請稍候...", curses.A_DIM)
        update_curses_screen(stdscr)
        audio_path, status = download_youtube_audio(subtitle)
        if not audio_path:
            return status
        audio_player = TerminalYoutubeAudioPlayer(audio_path)
        if not audio_player.play_from(max(0.0, start_ms / 1000)):
            audio_player = None
            return "音訊已下載，但 ffplay／cvlc 無法啟動。"
        return status

    first_entries = subtitles[subtitle_index].entries
    first_start = first_entries[0].get("startMs") if first_entries else 0
    message = prepare_audio(subtitles[subtitle_index], float(first_start or 0))
    try:
        while True:
            subtitle = subtitles[subtitle_index]
            entries = subtitle.entries
            if entries:
                entry_index %= len(entries)
            else:
                entry_index = 0

            if audio_player and not audio_player.paused and subtitle.mode == YT_SUBTITLE_MODE_SRT:
                synced_index = subtitle_entry_index_at_time(entries, audio_player.position() * 1000)
                if synced_index is not None:
                    entry_index = synced_index

            stdscr.erase()
            height, width = stdscr.getmaxyx()
            draw_line(
                stdscr,
                1,
                2,
                (
                    f"YT字幕 | {subtitle_index + 1}/{len(subtitles)} | {subtitle.title}  "
                    "Esc=列表 5=中文 4/6=上下篇 7/Space=播放暫停 Enter=跳至此句 ↑↓=上下句"
                ),
                curses.A_BOLD,
            )
            detail_lines: List[Tuple[str, int, int]] = []
            entry_line_offsets: List[int] = []

            def append_detail(text: str, indent: int = 0, attr: int = 0) -> None:
                line_width = max(1, width - 4 - indent)
                for line in _split_by_cell_width(text, line_width):
                    detail_lines.append((line, indent, attr))

            append_detail(subtitle.title, attr=curses.A_BOLD)
            mode_label = "SRT 時間字幕" if subtitle.mode == YT_SUBTITLE_MODE_SRT else "JSON 逐句字幕"
            append_detail(f"{mode_label} · {len(entries)} 句", attr=curses.A_DIM)
            if subtitle.youtube_url:
                append_detail(f"YouTube: {subtitle.youtube_url}", attr=curses.A_DIM)
            if not entries:
                append_detail("目前沒有可顯示的字幕。", attr=curses.A_DIM)
            for index, entry in enumerate(entries):
                entry_line_offsets.append(len(detail_lines))
                marker = "▶" if index == entry_index else " "
                timestamp = f" [{subtitle_time_label(entry['startMs'])}]" if entry.get("startMs") is not None else ""
                append_detail(f"{marker} {index + 1}.{timestamp} {entry['ko']}", attr=curses.A_BOLD if index == entry_index else 0)
                if show_chinese:
                    append_detail(entry["zh"], indent=4, attr=curses.A_DIM)

            visible_rows = max(1, height - 4)
            scroll_offset = min(scroll_offset, max(0, len(detail_lines) - visible_rows))
            if entry_line_offsets:
                entry_start = entry_line_offsets[entry_index]
                scroll_offset = max(0, min(
                    entry_start - visible_rows // 2,
                    max(0, len(detail_lines) - visible_rows),
                ))
            for row, (line, indent, attr) in enumerate(
                detail_lines[scroll_offset:scroll_offset + visible_rows],
                2,
            ):
                draw_line(stdscr, row, 2 + indent, line, attr)
            footer_parts = [message] if message else []
            if audio_player:
                state_label = "暫停" if audio_player.paused else "播放中"
                footer_parts.append(f"原音 {subtitle_time_label(audio_player.position() * 1000)} · {state_label}")
            if len(detail_lines) > visible_rows:
                footer_parts.append(
                    f"內容 {scroll_offset + 1}-{min(len(detail_lines), scroll_offset + visible_rows)}/{len(detail_lines)}"
                )
            if footer_parts:
                draw_line(stdscr, height - 1, 2, "  ".join(footer_parts), curses.A_BOLD)
            update_curses_screen(stdscr)

            if audio_player and not audio_player.paused:
                key = read_terminal_key_with_timeout(stdscr, 200, wide=True)
            else:
                key = read_terminal_key(stdscr, wide=True)
            if key is None:
                continue
            if isinstance(key, int) and 0 <= key <= 255:
                key = chr(key)
            elif key == curses.KEY_ENTER:
                key = "\n"
            if key in ("\x1b", 27):
                return
            if key in (curses.KEY_UP, curses.KEY_DOWN):
                if entries:
                    step = -1 if key == curses.KEY_UP else 1
                    entry_index = (entry_index + step) % len(entries)
                    start_ms = entries[entry_index].get("startMs")
                    if audio_player and start_ms is not None:
                        audio_player.play_from(float(start_ms) / 1000)
                        message = f"已跳至第 {entry_index + 1} 句。"
                continue
            if not isinstance(key, str):
                continue
            if key == "5":
                show_chinese = not show_chinese
                message = f"中文：{'顯示' if show_chinese else '隱藏'}"
            elif key == "4" or key == "6":
                subtitle_index = (subtitle_index + (-1 if key == "4" else 1)) % len(subtitles)
                entry_index = 0
                scroll_offset = 0
                next_subtitle = subtitles[subtitle_index]
                next_entries = next_subtitle.entries
                next_start = next_entries[0].get("startMs") if next_entries else 0
                message = prepare_audio(next_subtitle, float(next_start or 0))
            elif key in ("7", " "):
                if audio_player:
                    if audio_player.paused and not audio_player.process and entries and entries[entry_index].get("startMs") is not None:
                        changed = audio_player.play_from(float(entries[entry_index]["startMs"]) / 1000)
                    else:
                        changed = audio_player.toggle()
                    if changed:
                        message = "原音已暫停。" if audio_player.paused else "原音繼續播放。"
                    else:
                        message = "無法切換原音播放狀態。"
                elif not entries:
                    message = "這篇字幕沒有可播放的韓文。"
                elif speak_korean(entries[entry_index]["ko"]):
                    message = f"已用 TTS 播放第 {entry_index + 1} 句。"
                else:
                    message = "無法播放語音：請確認 edge-tts 與 cvlc／ffplay 可用。"
            elif key in ("\n", "\r"):
                if audio_player and entries and entries[entry_index].get("startMs") is not None:
                    audio_player.play_from(float(entries[entry_index]["startMs"]) / 1000)
                    message = f"已跳至第 {entry_index + 1} 句並播放。"
                elif subtitle.mode != YT_SUBTITLE_MODE_SRT:
                    message = "JSON 字幕沒有時間戳，無法跳轉音訊。"
    finally:
        if audio_player:
            audio_player.stop()


def run_youtube_subtitles(
    stdscr: curses.window,
    subtitles: List[YoutubeSubtitle],
) -> None:
    if not subtitles:
        wait_message(stdscr, "YT字幕", "目前還沒有字幕筆記。")
        return
    notes = subtitles
    cursor = 0
    set_cursor_visibility(0)
    stdscr.keypad(True)
    while True:
        stdscr.erase()
        height, _ = stdscr.getmaxyx()
        visible_count = max(1, height - 4)
        start = max(0, min(cursor - visible_count + 1, len(notes) - visible_count))
        visible_notes = notes[start:start + visible_count]
        draw_line(stdscr, 1, 2, f"YT字幕 | {len(notes)} 篇", curses.A_BOLD)
        draw_line(stdscr, 2, 2, "↑↓=移動 Enter=查看 Esc=返回", curses.A_DIM)
        for row, subtitle in enumerate(visible_notes, 3):
            subtitle_index = start + row - 3
            mode_label = "SRT" if subtitle.mode == YT_SUBTITLE_MODE_SRT else "逐句"
            label = f"{subtitle.title} · {mode_label} · {len(subtitle.entries)} 句"
            draw_line(
                stdscr,
                row,
                2,
                ("» " if subtitle_index == cursor else "  ") + label,
                curses.A_BOLD if subtitle_index == cursor else 0,
            )
        if len(notes) > visible_count:
            draw_line(stdscr, height - 1, 2, f"{cursor + 1}/{len(notes)}", curses.A_DIM)
        update_curses_screen(stdscr)

        key = read_terminal_key(stdscr, wide=True)
        if isinstance(key, int) and 0 <= key <= 255:
            key = chr(key)
        if key in ("\x1b", 27):
            return
        if key == curses.KEY_UP:
            cursor = (cursor - 1) % len(notes)
        elif key == curses.KEY_DOWN:
            cursor = (cursor + 1) % len(notes)
        elif key in ("\n", "\r", curses.KEY_ENTER, 10, 13):
            run_youtube_subtitle_detail(stdscr, notes, cursor)
            set_cursor_visibility(0)



__all__ = [name for name in globals() if not name.startswith("__")]
