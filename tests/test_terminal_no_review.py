import curses
import unittest
from unittest.mock import patch

import terminal_review_practice as terminal
from terminal_app.domain.content import normalize_records
from terminal_app.domain.review import daily_due_questions, daily_recognition_questions


class NoReviewTests(unittest.TestCase):
    def test_no_review_excludes_terms_and_examples_but_keeps_card_visible(self):
        records = []
        for word_id, no_review in (("active", False), ("paused", True), ("learned", False)):
            records.append({
                "id": word_id, "date": "2026-09-19",
                "item": {
                    "ko": word_id, "noReview": no_review,
                    "meanings": [{"zh": "意思", "examples": [{"id": f"{word_id}-example", "ko": "例句", "zh": "例句翻譯"}]}],
                },
            })
        state = terminal.empty_state()
        state["learnedWordIds"] = ["learned"]
        cards, questions = normalize_records(records, state)
        self.assertEqual(len(cards), 3)
        self.assertTrue(next(card for card in cards if card.id == "paused").no_review)
        self.assertEqual([question.id for question in daily_due_questions(state, questions, "2026-09-21")], ["active"])
        recognition = daily_recognition_questions(state, questions, "2026-09-21")
        self.assertEqual([question.id for question in recognition], ["active-example"])

    def test_no_review_and_learned_cards_remain_in_manual_study_and_practice(self):
        paused = terminal.Card("paused", "2026-09-19", "멈춤", "暫停", no_review=True)
        learned = terminal.Card("learned", "2026-09-19", "학습", "學習")
        questions = [
            terminal.Question(card.id, card.id, card.date, "term", card.ko, card.zh, card)
            for card in (paused, learned)
        ]
        state = {"learnedWordIds": ["learned"]}

        class Screen:
            def erase(self):
                pass

            def getmaxyx(self):
                return 24, 100

            def keypad(self, _enabled):
                pass

            def addstr(self, *_args):
                pass

        study_lines = []
        with (
            patch("terminal_app.ui.screens.study.set_cursor_visibility"),
            patch("terminal_app.ui.screens.study.clear_with_default_background"),
            patch("terminal_app.ui.screens.study.update_curses_screen"),
            patch("terminal_app.ui.screens.study.is_auto_audio_enabled", return_value=False),
            patch("terminal_app.ui.screens.study.draw_line", side_effect=lambda _screen, _row, _column, text, *_args: study_lines.append(text)),
            patch("terminal_app.ui.screens.study.read_terminal_key", side_effect=["6", "\x1b"]),
        ):
            terminal.run_study(Screen(), "手動學習", [paused, learned], state, object(), object())
        self.assertTrue(any("1/2" in line for line in study_lines))
        self.assertTrue(any("2/2" in line for line in study_lines))

        practice_lines = []
        with (
            patch("terminal_app.ui.screens.practice_session.set_cursor_visibility"),
            patch("terminal_app.ui.screens.practice_session.update_curses_screen"),
            patch("terminal_app.ui.screens.practice_session.is_auto_audio_enabled", return_value=False),
            patch("terminal_app.ui.screens.practice_session.curses.has_colors", return_value=False),
            patch("terminal_app.ui.screens.practice_session.draw_line", side_effect=lambda _screen, _row, _column, text, *_args: practice_lines.append(text)),
            patch("terminal_app.ui.screens.practice_session.read_terminal_key", return_value="\x1b"),
        ):
            completed = terminal.run_practice(
                Screen(),
                "手動測驗",
                questions,
                {
                    "direction": "ko-zh", "answer_mode": "self-grade", "source": "term",
                    "starred": False, "random": False, "record_results": False,
                },
                state, object(), object(),
            )
        self.assertFalse(completed)
        self.assertTrue(any("1/2" in line for line in practice_lines))

    def test_terminal_learned_write_sets_no_review_atomically(self):
        client = terminal.FirebaseClient("key", "project")
        session = terminal.AuthSession("test@example.com", "uid", "token", "refresh")
        with patch.object(client, "_request_json", return_value={}) as request:
            client.add_word_to_folder(session, "system-learned", "word", mark_no_review=True)
        writes = request.call_args.kwargs["payload"]["writes"]
        self.assertEqual(len(writes), 2)
        self.assertEqual(writes[1]["updateMask"]["fieldPaths"], ["item.noReview"])
        self.assertTrue(writes[1]["update"]["fields"]["item"]["mapValue"]["fields"]["noReview"]["booleanValue"])

    def test_terminal_learned_shortcut_toggles_folder_membership(self):
        client = terminal.FirebaseClient("key", "project")
        session = terminal.AuthSession("test@example.com", "uid", "token", "refresh")
        state = {
            "learnedWordIds": [],
            "learnedFolderId": "system-learned",
            "folders": [{"id": "system-learned", "wordIds": []}],
        }
        with patch.object(client, "add_word_to_folder") as add, patch.object(client, "remove_word_from_folder") as remove:
            self.assertTrue(terminal.toggle_word_as_learned(client, session, state, "word"))
            self.assertEqual(state["learnedWordIds"], ["word"])
            self.assertEqual(state["folders"][0]["wordIds"], ["word"])
            add.assert_called_once_with(session, "system-learned", "word", mark_no_review=True)

            self.assertFalse(terminal.toggle_word_as_learned(client, session, state, "word"))
            self.assertEqual(state["learnedWordIds"], [])
            self.assertEqual(state["folders"][0]["wordIds"], [])
            remove.assert_called_once_with(session, "system-learned", "word")


if __name__ == "__main__":
    unittest.main()
