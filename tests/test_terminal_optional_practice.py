import unittest
from unittest.mock import ANY, patch

import terminal_review_practice as terminal


class OptionalPracticeTests(unittest.TestCase):
    @staticmethod
    def card_and_question():
        card = terminal.Card("word", "2026-09-10", "날씨", "天氣", meanings=[])
        question = terminal.Question("word", "word", card.date, "term", card.ko, card.zh, card)
        return card, question

    def test_wrong_answers_return_to_pool_and_correct_answers_stay_seen(self):
        state = terminal.add_optional_practice_task(
            {"tasks": [], "pools": {}},
            {"id": "task-1", "kind": "reading"},
            ["a", "b"],
            2,
        )
        state = terminal.answer_optional_practice_task(state, "task-1", "a", False)
        self.assertEqual(state["tasks"][0]["answeredIds"], ["a"])
        self.assertEqual(state["pools"]["reading"], ["b"])
        state = terminal.answer_optional_practice_task(state, "task-1", "b", True)
        self.assertEqual(state["tasks"], [])
        next_state = terminal.add_optional_practice_task(
            state, {"id": "task-2", "kind": "reading"}, ["a", "b"], 1
        )
        self.assertEqual(next_state["tasks"][0]["ids"], ["a"])

    def test_unseen_questions_are_selected_before_a_new_round(self):
        selected, seen = terminal.draw_optional_practice_ids(
            ["a", "b", "c"], ["a", "b"], [], 2
        )
        self.assertEqual(selected[0], "c")
        self.assertEqual(len(set(selected)), 2)
        self.assertEqual(set(seen), set(selected))

    def test_optional_practice_patch_updates_only_its_field(self):
        class FakeClient(terminal.FirebaseClient):
            def __init__(self):
                super().__init__("key", "project")
                self.patch_url = ""
                self.patch_payload = None

            def _request_json(self, method, url, payload=None, session=None, _retry=True):
                if method == "GET":
                    return {
                        "fields": {
                            "optionalPractice": terminal._to_firestore_value({"tasks": [], "pools": {}}),
                            "lastCompletedGrammarId": terminal._to_firestore_value("keep-me"),
                        },
                        "updateTime": "2026-09-10T01:02:03.000Z",
                    }
                self.patch_url = url
                self.patch_payload = payload
                return payload

        client = FakeClient()
        session = terminal.AuthSession("test@example.com", "uid", "token", "refresh")
        result = client.update_optional_practice(
            session,
            lambda current: terminal.add_optional_practice_task(
                current, {"id": "one", "kind": "words"}, ["word"], 1
            ),
        )
        self.assertEqual(result["tasks"][0]["id"], "one")
        self.assertEqual(set(client.patch_payload["fields"]), {"optionalPractice"})
        self.assertIn("updateMask.fieldPaths=optionalPractice", client.patch_url)
        self.assertIn("currentDocument.updateTime=", client.patch_url)

    def test_precise_negative_familiarity_filter_matches_the_web(self):
        self.assertEqual(terminal.familiarity_filter_value("不熟悉", -1), "score-negative-1")
        self.assertEqual(terminal.familiarity_filter_value("不熟悉", -3), "score-negative-3")
        self.assertEqual(terminal.familiarity_filter_value("不熟悉", -8), "score-negative-4-or-less")
        self.assertEqual(terminal.familiarity_filter_value("熟悉", 4), "熟悉")

    def test_familiarity_score_has_no_initial_offset(self):
        self.assertEqual(terminal.familiarity_score({}), 0)
        self.assertEqual(terminal.familiarity_score({"correct": 3, "wrong": 1}), 2)
        self.assertEqual(terminal.familiarity_score({"correct": 1, "wrong": 3}), -2)

    def test_negative_score_schedule_matches_the_web(self):
        _, question = self.card_and_question()
        with patch.object(terminal, "today_string", return_value="2026-09-14"):
            wrong_state = {
                "stats": {question.id: {"total": 2, "correct": 1, "wrong": 1}},
                "progress": {question.id: {"stage": 3}},
                "attempts": [],
            }
            terminal.record_answer(wrong_state, question, False)
            self.assertEqual(terminal.familiarity_score(wrong_state["stats"][question.id]), -1)
            self.assertEqual(wrong_state["progress"][question.id]["nextDue"], "2026-09-15")

            correct_state = {
                "stats": {question.id: {"total": 2, "correct": 0, "wrong": 2}},
                "progress": {question.id: {"stage": 3}},
                "attempts": [],
            }
            terminal.record_answer(correct_state, question, True)
            self.assertEqual(terminal.familiarity_score(correct_state["stats"][question.id]), -1)
            self.assertEqual(correct_state["progress"][question.id]["nextDue"], "2026-09-16")

            recovered_state = {
                "stats": {question.id: {"total": 3, "correct": 1, "wrong": 2}},
                "progress": {question.id: {"stage": 4}},
                "attempts": [],
            }
            terminal.record_answer(recovered_state, question, True)
            self.assertEqual(terminal.familiarity_score(recovered_state["stats"][question.id]), 0)
            self.assertEqual(recovered_state["progress"][question.id]["stage"], 1)
            self.assertEqual(recovered_state["progress"][question.id]["nextDue"], "2026-09-17")

    def test_word_search_text_contains_korean_and_chinese_meanings_only(self):
        card = terminal.Card(
            "word", "2026-09-10", "날씨", "天氣", meanings=[{
                "zh": "天氣", "examples": [{"ko": "시장이 가까워요.", "zh": "市場很近。"}],
            }], notes=["市場附近"],
        )
        search_text = terminal.card_word_search_text(card)
        self.assertIn("날씨", search_text)
        self.assertIn("天氣", search_text)
        self.assertNotIn("市場", search_text)
        self.assertNotIn("시장", search_text)

    def test_terminal_can_create_a_listening_task(self):
        card, term = self.card_and_question()
        example = terminal.Question("example", card.id, card.date, "example", "날씨가 좋아요.", "天氣很好。", card)
        review = {}

        class Client:
            def update_optional_practice(self, _session, change):
                return change(terminal.optional_practice_state(review))

        with patch.object(terminal, "menu", return_value="listening"):
            created = terminal.create_optional_practice(
                object(), [card], [term, example], [], {"learnedWordIds": []}, review,
                Client(), terminal.AuthSession("email", "uid", "token", "refresh"),
            )
        self.assertTrue(created)
        self.assertEqual(review["optionalPractice"]["tasks"][0]["ids"], ["example"])

    def test_terminal_runs_and_completes_a_web_created_task(self):
        card, question = self.card_and_question()
        review = {"optionalPractice": {
            "tasks": [{
                "id": "web-task", "kind": "words", "title": "單字練習",
                "direction": "ko-zh", "ids": [question.id], "answeredIds": [],
            }],
            "pools": {"words": [question.id]},
        }}

        class Client:
            def update_optional_practice(self, _session, change):
                return change(terminal.optional_practice_state(review))

        menu_results = iter(["web-task", "start", None])

        def complete_practice(_screen, _title, active, config, *_args):
            config["on_result"](active[0], True)
            return True

        with patch.object(terminal, "menu", side_effect=lambda *_args, **_kwargs: next(menu_results)), \
                patch.object(terminal, "run_practice", side_effect=complete_practice):
            terminal.run_optional_practice_menu(
                object(), [card], [question], [], {"learnedWordIds": []}, review,
                Client(), terminal.AuthSession("email", "uid", "token", "refresh"),
            )
        self.assertEqual(review["optionalPractice"]["tasks"], [])
        self.assertEqual(review["optionalPractice"]["pools"]["words"], [question.id])

    def test_srt_audio_time_selects_the_latest_started_subtitle(self):
        entries = [
            {"startMs": 0},
            {"startMs": 2500},
            {"startMs": 7000},
        ]
        self.assertEqual(terminal.subtitle_entry_index_at_time(entries, 0), 0)
        self.assertEqual(terminal.subtitle_entry_index_at_time(entries, 6999), 1)
        self.assertEqual(terminal.subtitle_entry_index_at_time(entries, 7000), 2)
        self.assertIsNone(terminal.subtitle_entry_index_at_time([{"startMs": None}], 1000))

    def test_youtube_audio_cache_changes_when_the_source_url_changes(self):
        first = terminal.YoutubeSubtitle("id", "Title", "https://youtu.be/one", "srt", [])
        same = terminal.YoutubeSubtitle("id", "Renamed", "https://youtu.be/one", "srt", [])
        changed = terminal.YoutubeSubtitle("id", "Title", "https://youtu.be/two", "srt", [])
        self.assertEqual(terminal.youtube_audio_cache_path(first), terminal.youtube_audio_cache_path(same))
        self.assertNotEqual(terminal.youtube_audio_cache_path(first), terminal.youtube_audio_cache_path(changed))

    def test_youtube_audio_download_has_format_and_client_fallbacks(self):
        profiles = terminal.youtube_audio_download_profiles()
        self.assertEqual(profiles[0], [])
        self.assertTrue(any(
            any("bestaudio[ext=m4a]" in argument for argument in profile)
            for profile in profiles
        ))
        self.assertTrue(any("youtube:player_client=android_vr" in profile for profile in profiles))

    def test_collection_escape_returns_to_its_mode_menu_before_parent(self):
        card, question = self.card_and_question()
        menu_results = iter(["study", "all", None])
        menu_titles = []

        def choose(_screen, title, *_args, **_kwargs):
            menu_titles.append(title)
            return next(menu_results)

        with patch.object(terminal, "menu", side_effect=choose), \
                patch.object(terminal, "run_study") as study:
            terminal.run_collection(
                object(), "測試資料夾", [card], [question], {}, object(), object()
            )

        study.assert_called_once()
        self.assertEqual(menu_titles, [
            "測試資料夾 | 模式",
            "測試資料夾 | 學習篩選",
            "測試資料夾 | 模式",
        ])

    def test_calendar_escape_returns_to_date_list_after_collection(self):
        card, question = self.card_and_question()
        with patch.object(terminal, "date_menu", side_effect=[card.date, None]) as dates, \
                patch.object(terminal, "run_collection") as collection:
            terminal.run_calendar(
                object(), [card], [question], {}, object(), object()
            )

        self.assertEqual(dates.call_count, 2)
        collection.assert_called_once()

    def test_daily_practice_escape_returns_through_answer_setup_then_task_list(self):
        _, question = self.card_and_question()
        with patch.object(
            terminal,
            "due_task_menu",
            side_effect=[(terminal.DAILY_MIXED_MODE, [question]), None],
        ) as tasks, patch.object(
            terminal,
            "translation_answer_mode_menu",
            side_effect=[("ko-zh", "self-grade"), None],
        ) as setup, patch.object(
            terminal,
            "run_practice",
            return_value=False,
        ) as practice, patch.object(
            terminal,
            "daily_due_questions",
            return_value=[question],
        ):
            terminal.run_due_reviews(object(), {}, [question], object(), object())

        practice.assert_called_once()
        self.assertEqual(setup.call_count, 2)
        self.assertEqual(tasks.call_count, 2)

    def test_daily_wrong_review_can_start_configured_study_mode(self):
        card, question = self.card_and_question()
        with patch.object(
            terminal,
            "due_task_menu",
            side_effect=[(terminal.DAILY_WRONG_REVIEW_MODE, [question]), None],
        ), patch.object(
            terminal,
            "menu",
            side_effect=["study", "zh", "alphabetical", None],
        ) as choices, patch.object(
            terminal,
            "run_study",
        ) as study, patch.object(
            terminal,
            "daily_due_questions",
            return_value=[question],
        ):
            terminal.run_due_reviews(object(), {}, [question], object(), object())

        study.assert_called_once_with(
            ANY,
            "今日答錯題目",
            [card],
            {},
            ANY,
            ANY,
            front_side="zh",
        )
        self.assertEqual(
            [call.args[1] for call in choices.call_args_list],
            [
                "今日答錯題目 | 模式",
                "今日答錯題目 | 學習正面",
                "今日答錯題目 | 學習順序",
                "今日答錯題目 | 模式",
            ],
        )

    def test_study_card_ordering_keeps_input_unchanged(self):
        first = terminal.Card("first", "2026-09-10", "하늘", "天空")
        second = terminal.Card("second", "2026-09-10", "가방", "包包")
        cards = [first, second]

        ordered = terminal.ordered_study_cards(cards, "alphabetical")

        self.assertEqual([card.id for card in ordered], ["second", "first"])
        self.assertEqual([card.id for card in cards], ["first", "second"])

    def test_daily_wrong_review_correct_answers_remove_only_the_review_item(self):
        card, question = self.card_and_question()
        state = {
            "stats": {question.id: {"correct": 2, "wrong": 1}},
            "progress": {question.id: {"nextDue": "2026-09-20"}},
            "attempts": [{
                "id": "wrong",
                "questionId": question.id,
                "correct": False,
                "date": "2026-09-15",
                "time": "2026-09-15T01:00:00Z",
            }],
        }
        original_stats = dict(state["stats"])
        original_progress = dict(state["progress"])

        with patch.object(terminal, "today_string", return_value="2026-09-15"):
            terminal.record_daily_wrong_review_answer(state, question, True)
            remaining = terminal.daily_wrong_term_questions(state, [question])

        self.assertEqual(remaining, [])
        self.assertEqual(state["stats"], original_stats)
        self.assertEqual(state["progress"], original_progress)
        self.assertEqual(state["attempts"][0]["mode"], terminal.DAILY_WRONG_REVIEW_MODE)

    def test_mistake_retry_keeps_only_one_question_for_each_wrong_word(self):
        card, term = self.card_and_question()
        example = terminal.Question(
            "example", card.id, card.date, "example", "날씨가 좋아요.", "天氣很好。", card
        )

        mistakes = terminal.practice_mistake_questions(
            [term, example],
            [term.id, example.id],
        )

        self.assertEqual([question.id for question in mistakes], [term.id])


if __name__ == "__main__":
    unittest.main()
