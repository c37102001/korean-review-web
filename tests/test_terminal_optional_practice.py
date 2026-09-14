import unittest
from unittest.mock import patch

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


if __name__ == "__main__":
    unittest.main()
