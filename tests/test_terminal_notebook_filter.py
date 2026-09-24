import curses
import unittest
from unittest.mock import patch

from terminal_app.domain.content import WORD_POS_OPTIONS
from terminal_app.domain.models import Card, Question
from terminal_app.runtime import filtered_notebook_cards
from terminal_app.ui.screens.library import run_notebook


class FakeScreen:
    def erase(self):
        pass

    def getmaxyx(self):
        return 24, 100

    def keypad(self, _enabled):
        pass


def question_for(card):
    return Question(card.id, card.id, card.date, "term", card.ko, card.zh, card)


class TerminalNotebookPosFilterTests(unittest.TestCase):
    def setUp(self):
        self.cards = [
            Card("noun", "2026-09-24", "책", "書", pos="名詞", meanings=[{"zh": "書"}]),
            Card("verb", "2026-09-24", "읽다", "閱讀", pos="動詞", meanings=[{"zh": "閱讀"}]),
            Card("adjective", "2026-09-24", "크다", "大", pos="形容詞", meanings=[{"zh": "大"}]),
        ]
        self.questions = [question_for(card) for card in self.cards]
        self.state = {"folders": [], "learnedWordIds": [], "stats": {}}

    def test_part_of_speech_filters_the_notebook_and_combines_with_search(self):
        config = {
            "query": "閱讀",
            "search_scope": "word",
            "levels": set(),
            "folder_ids": set(),
            "pos": "動詞",
            "show_learned": False,
            "sort": "latest",
        }

        result = filtered_notebook_cards(self.cards, self.questions, self.state, config)

        self.assertEqual([card.id for card in result], ["verb"])
        config["pos"] = "名詞"
        self.assertEqual(filtered_notebook_cards(self.cards, self.questions, self.state, config), [])
        config["pos"] = ""
        self.assertEqual([card.id for card in filtered_notebook_cards(self.cards, self.questions, self.state, config)], ["verb"])

    def test_notebook_screen_offers_the_same_pos_options_as_the_web(self):
        drawn_lines = []
        keys = [curses.KEY_DOWN] * 4 + ["\n", "\x1b"]
        with (
            patch("terminal_app.ui.screens.library.set_cursor_visibility"),
            patch("terminal_app.ui.screens.library.update_curses_screen"),
            patch("terminal_app.ui.screens.library.draw_line", side_effect=lambda _screen, _row, _column, text, *_args: drawn_lines.append(text)),
            patch("terminal_app.ui.screens.library.read_terminal_key", side_effect=keys),
            patch("terminal_app.ui.screens.library.menu", return_value="動詞") as pos_menu,
        ):
            run_notebook(FakeScreen(), self.cards, self.questions, self.state, object(), object())

        self.assertEqual(
            pos_menu.call_args.args[2],
            [("", "全部"), *((pos, pos) for pos in WORD_POS_OPTIONS)],
        )
        self.assertTrue(any(line.strip(" »") == "詞性: 動詞" for line in drawn_lines))


if __name__ == "__main__":
    unittest.main()
