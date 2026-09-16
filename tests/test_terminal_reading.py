import unittest
from unittest.mock import patch

import terminal_review_practice as terminal


def reading_test(learned=False):
    return terminal.ReadingTest(
        id='reading',
        passage={'ko': '한국어 글', 'zh': '韓文文章'},
        question={'ko': '고르십시오.', 'zh': '請選擇。'},
        options=[
            {'id': '1', 'ko': '첫째', 'zh': '第一'},
            {'id': '2', 'ko': '둘째', 'zh': '第二'},
        ],
        answer='2',
        learned=learned,
    )


class TerminalReadingTests(unittest.TestCase):
    def test_chinese_is_revealed_only_after_submitting(self):
        test = reading_test()
        hidden, _ = terminal._reading_content_lines(test, 80, '1', False)
        revealed, _ = terminal._reading_content_lines(test, 80, '1', True)
        hidden_text = '\n'.join(line for line, _ in hidden)
        revealed_text = '\n'.join(line for line, _ in revealed)
        self.assertNotIn('韓文文章', hidden_text)
        self.assertNotIn('第一', hidden_text)
        self.assertIn('韓文文章', revealed_text)
        self.assertIn('第一', revealed_text)
        self.assertIn('答錯，正確答案是 2', revealed_text)

    def test_online_learned_toggle_updates_only_the_reading_document(self):
        client = terminal.FirebaseClient('key', 'project')
        session = terminal.AuthSession('test@example.com', 'uid', 'token', 'refresh')
        with patch.object(client, '_request_json', return_value={}) as request:
            client.set_reading_test_learned(session, 'reading', True)
        payload = request.call_args.kwargs['payload']
        write = payload['writes'][0]
        self.assertTrue(terminal._parse_firestore_value(write['update']['fields']['learned']))
        self.assertEqual(write['updateMask']['fieldPaths'], ['learned'])
        self.assertTrue(write['update']['name'].endswith('/users/uid/readingTests/reading'))


if __name__ == '__main__':
    unittest.main()
