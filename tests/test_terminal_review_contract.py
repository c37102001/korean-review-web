import json
import unittest
from pathlib import Path

from terminal_app.domain.review import (
    REVIEW_INTERVALS,
    exclude_learned_word_ids,
    familiarity_score,
    next_review_transition,
    wrong_question_ids,
)


CONTRACT = json.loads(
    (Path(__file__).parents[1] / "contracts" / "review-rules-v1.json").read_text(encoding="utf-8")
)


class ReviewContractTests(unittest.TestCase):
    def test_terminal_review_rules_match_shared_contract(self):
        self.assertEqual(CONTRACT["version"], 1)
        self.assertEqual(list(REVIEW_INTERVALS), CONTRACT["reviewIntervals"])
        for case in CONTRACT["familiarityCases"]:
            self.assertEqual(familiarity_score(case["stats"]), case["score"])
        for case in CONTRACT["scheduleCases"]:
            actual = next_review_transition(
                case["previousStage"], case["previousStats"], case["nextStats"], case["correct"]
            )
            self.assertEqual(actual, case["expected"], case["name"])
        for case in CONTRACT["wrongPoolCases"]:
            self.assertEqual(wrong_question_ids(case["events"]), case["expected"])
        for case in CONTRACT["learnedExclusionCases"]:
            self.assertEqual(
                exclude_learned_word_ids(case["questionWordIds"], case["learnedWordIds"]),
                case["expected"],
            )


if __name__ == "__main__":
    unittest.main()
