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

    def test_terminal_learned_write_sets_no_review_atomically(self):
        client = terminal.FirebaseClient("key", "project")
        session = terminal.AuthSession("test@example.com", "uid", "token", "refresh")
        with patch.object(client, "_request_json", return_value={}) as request:
            client.add_word_to_folder(session, "system-learned", "word", mark_no_review=True)
        writes = request.call_args.kwargs["payload"]["writes"]
        self.assertEqual(len(writes), 2)
        self.assertEqual(writes[1]["updateMask"]["fieldPaths"], ["item.noReview"])
        self.assertTrue(writes[1]["update"]["fields"]["item"]["mapValue"]["fields"]["noReview"]["booleanValue"])


if __name__ == "__main__":
    unittest.main()
