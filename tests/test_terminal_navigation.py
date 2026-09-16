import unittest

from terminal_app.ui.controllers import ScrollModel
from terminal_app.ui.navigation import NavigationStack, ScreenAction, ScreenResult


class NavigationStackTests(unittest.TestCase):
    def test_back_only_removes_one_level(self):
        stack = NavigationStack("home")
        stack.apply(ScreenResult.push("folders"))
        stack.apply(ScreenResult.push("study"))

        stack.apply(ScreenResult.back())

        self.assertEqual(stack.current, "folders")
        self.assertEqual(stack.depth, 2)

    def test_back_at_root_keeps_root(self):
        stack = NavigationStack("home")
        self.assertTrue(stack.apply(ScreenResult.back()))
        self.assertEqual(stack.current, "home")

    def test_exit_stops_navigation(self):
        stack = NavigationStack("home")
        self.assertFalse(stack.apply(ScreenResult.exit()))

    def test_push_requires_target(self):
        stack = NavigationStack("home")
        with self.assertRaises(ValueError):
            stack.apply(ScreenResult(ScreenAction.PUSH))


class ScrollModelTests(unittest.TestCase):
    def test_scroll_clamps_to_content(self):
        scroll = ScrollModel()
        self.assertEqual(scroll.move(8, content_height=10, viewport_height=5), 5)
        self.assertEqual(scroll.move(-20, content_height=10, viewport_height=5), 0)


if __name__ == "__main__":
    unittest.main()
