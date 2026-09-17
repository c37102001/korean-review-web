import curses
import json
import tempfile
import unittest
from pathlib import Path

from terminal_app.ui.theme import (
    TEXT_STYLE_DIM,
    TEXT_STYLE_NORMAL,
    apply_text_style,
    get_text_style,
    load_text_style,
    preference_path,
    save_text_style,
    set_text_style,
)


class TerminalThemeTests(unittest.TestCase):
    def tearDown(self):
        set_text_style(TEXT_STYLE_NORMAL)

    def test_normal_style_preserves_existing_attributes(self):
        set_text_style(TEXT_STYLE_NORMAL)
        self.assertEqual(apply_text_style(curses.A_BOLD), curses.A_BOLD)

    def test_dim_style_removes_bold_and_dims_every_line(self):
        set_text_style(TEXT_STYLE_DIM)
        result = apply_text_style(curses.A_BOLD | curses.A_REVERSE)
        self.assertFalse(result & curses.A_BOLD)
        self.assertTrue(result & curses.A_DIM)
        self.assertTrue(result & curses.A_REVERSE)

    def test_style_is_saved_per_account_and_loaded_again(self):
        with tempfile.TemporaryDirectory() as directory:
            cache_dir = Path(directory)
            save_text_style(cache_dir, "user-one", TEXT_STYLE_DIM)
            set_text_style(TEXT_STYLE_NORMAL)

            self.assertEqual(load_text_style(cache_dir, "user-one"), TEXT_STYLE_DIM)
            payload = json.loads(preference_path(cache_dir, "user-one").read_text(encoding="utf-8"))
            self.assertEqual(payload["textStyle"], TEXT_STYLE_DIM)
            self.assertNotEqual(preference_path(cache_dir, "user-one"), preference_path(cache_dir, "user-two"))

    def test_unknown_or_missing_style_falls_back_to_normal(self):
        with tempfile.TemporaryDirectory() as directory:
            self.assertEqual(load_text_style(Path(directory), "missing"), TEXT_STYLE_NORMAL)


if __name__ == "__main__":
    unittest.main()
