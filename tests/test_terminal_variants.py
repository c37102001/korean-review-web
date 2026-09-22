import unittest

from terminal_app.domain.content import card_korean_forms, card_korean_speech, normalize_records
from terminal_app.runtime import study_auto_audio_steps


class TerminalVariantTests(unittest.TestCase):
    def test_normalized_card_displays_base_and_all_variants(self):
        records = [{
            "id": "word", "date": "2026-09-22",
            "item": {"ko": "쏟다", "variants": ["쏟아요", "쏟는"], "meanings": [{"zh": "倒出"}]},
        }]
        cards, questions = normalize_records(records, {})
        self.assertEqual(cards[0].variants, ["쏟아요", "쏟는"])
        self.assertEqual(card_korean_forms(cards[0]), "쏟다 / 쏟아요 / 쏟는")
        self.assertEqual(card_korean_speech(cards[0]), "쏟다. 쏟아요. 쏟는")
        self.assertEqual(study_auto_audio_steps(cards[0], 1)[0][2], "쏟다. 쏟아요. 쏟는")
        self.assertEqual(questions[0].ko, "쏟다")

    def test_missing_or_duplicate_variants_leave_clean_title(self):
        records = [{"id": "word", "date": "2026-09-22", "item": {"ko": "가다", "variants": ["가다", "가요", "가요"]}}]
        cards, _ = normalize_records(records, {})
        self.assertEqual(card_korean_forms(cards[0]), "가다 / 가요")
        self.assertEqual(card_korean_speech(cards[0]), "가다. 가요")


if __name__ == "__main__":
    unittest.main()
