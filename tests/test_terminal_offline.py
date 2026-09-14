import copy
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

import terminal_offline as offline
import terminal_review_practice as terminal


class OfflineTests(unittest.TestCase):
    def setUp(self):
        self.directory = tempfile.TemporaryDirectory()
        self.addCleanup(self.directory.cleanup)
        self.cache_patch = patch.object(terminal, 'CACHE_DIR', Path(self.directory.name))
        self.cache_patch.start()
        self.addCleanup(self.cache_patch.stop)
        self.session = terminal.AuthSession('test@example.com', 'uid', '', '')
        self.client = terminal.FirebaseClient('key', 'project')
        self.payload = {
            'account': {'email': self.session.email, 'uid': self.session.uid},
            'state': terminal.empty_state(), 'records': [],
            'folders': [{'id': 'system-unfamiliar', 'wordIds': []}],
            'grammarReview': {}, 'grammarNotes': [], 'ytSubtitles': [],
        }
        terminal._write_terminal_cache(self.session.uid, self.payload)

    def test_offline_restart_keeps_answers_and_folder_changes_without_network(self):
        with patch.object(self.client, '_request_json', side_effect=AssertionError('network accessed')):
            self.client.start_offline(self.session)
            state = copy.deepcopy(self.payload['state'])
            state['stats']['q'] = {'correct': 1, 'wrong': 0, 'total': 1}
            state['progress']['q'] = {'stage': 1, 'nextDue': '2026-09-17'}
            state['attempts'] = [{'id': 'attempt', 'questionId': 'q', 'correct': True, 'date': '2026-09-14'}]
            self.client.save_review_state(self.session, state)
            self.client.add_word_to_folder(self.session, 'system-unfamiliar', 'word')
        second_client = terminal.FirebaseClient('key', 'project')
        second_client.start_offline(self.session)
        self.assertEqual(second_client.offline_payload['state']['stats']['q']['correct'], 1)
        self.assertEqual(second_client.offline_payload['folders'][0]['wordIds'], ['word'])
        self.assertEqual(second_client.offline_payload['pending']['folders']['system-unfamiliar'], {'word': True})
        self.assertEqual(second_client.offline_payload['pending']['id'], self.client.offline_payload['pending']['id'])

    def test_folder_toggle_cancels_membership_and_preserves_final_intent(self):
        self.client.start_offline(self.session)
        self.client.add_word_to_folder(self.session, 'system-unfamiliar', 'word')
        self.client.remove_word_from_folder(self.session, 'system-unfamiliar', 'word')
        cached = terminal._read_terminal_cache(self.session.uid)
        self.assertEqual(cached['folders'][0]['wordIds'], [])
        self.assertFalse(cached['pending']['folders']['system-unfamiliar']['word'])

    def test_local_optional_practice_can_be_created_and_completed(self):
        self.client.start_offline(self.session)
        created = self.client.update_optional_practice(
            self.session, lambda current: terminal.add_optional_practice_task(current, {'id': 'task', 'kind': 'words'}, ['q'], 1))
        self.assertEqual(created['tasks'][0]['ids'], ['q'])
        completed = self.client.update_optional_practice(
            self.session, lambda current: terminal.answer_optional_practice_task(current, 'task', 'q', False))
        self.assertEqual(completed['tasks'], [])
        self.assertEqual(terminal._read_terminal_cache(self.session.uid)['grammarReview']['optionalPractice'], completed)

    def test_disk_failure_does_not_acknowledge_answer(self):
        self.client.start_offline(self.session)
        before = copy.deepcopy(self.client.offline_payload['state'])
        changed = copy.deepcopy(before)
        changed['stats']['q'] = {'correct': 1}
        with patch.object(offline, 'persist', side_effect=OSError('disk full')):
            with self.assertRaises(RuntimeError):
                self.client.save_review_state(self.session, changed)
        self.assertEqual(self.client.offline_payload['state'], before)

    def test_merge_preserves_remote_changes_and_uses_counter_deltas(self):
        payload = offline.begin(self.payload)
        payload['state']['stats']['q'] = {'correct': 1, 'wrong': 0, 'total': 1}
        payload['state']['starred'] = ['local']
        remote = terminal.empty_state()
        remote['stats']['other'] = {'correct': 5}
        remote['starred'] = ['remote']
        merged = offline.merge_state(remote, payload)
        self.assertEqual(merged['stats']['other'], {'correct': 5})
        self.assertEqual(merged['stats']['q']['correct'], 1)
        self.assertEqual(merged['starred'], ['local', 'remote'])

    def test_same_question_schedule_conflict_is_not_overwritten(self):
        payload = offline.begin(self.payload)
        payload['state']['progress']['q'] = {'stage': 1}
        remote = terminal.empty_state()
        remote['progress']['q'] = {'stage': 2}
        with self.assertRaises(RuntimeError):
            offline.merge_state(remote, payload)

    def test_synced_receipt_prevents_duplicate_commit(self):
        payload = offline.begin(self.payload)
        fields = {'terminalOfflineReceipts': {payload['pending']['id']: offline.sync_receipt(payload)}}
        document = {'fields': {key: terminal._to_firestore_value(value) for key, value in fields.items()}}
        with patch.object(self.client, '_request_json', return_value=document) as network:
            offline.synchronize(self.client, self.session, payload, terminal)
        self.assertEqual(network.call_count, 1)
        self.assertEqual(network.call_args.args[0], 'GET')

    def test_failed_sync_retains_journal(self):
        self.client.start_offline(self.session)
        self.session.id_token = 'token'
        before = copy.deepcopy(self.client.offline_payload)
        with patch.object(offline, 'synchronize', side_effect=RuntimeError('HTTP 429: Quota exceeded.')):
            with self.assertRaises(RuntimeError):
                self.client.sync_offline(self.session)
        self.assertEqual(self.client.offline_payload, before)
        self.assertTrue(self.client.offline_mode)

    def test_sync_uses_one_atomic_commit_and_preserves_other_fields(self):
        payload = offline.begin(self.payload)
        payload['state']['stats']['q'] = {'correct': 1, 'wrong': 0, 'total': 1}
        payload['state']['progress']['q'] = {'stage': 1, 'nextDue': '2026-09-17'}
        payload['state']['attempts'] = [{'id': 'attempt', 'questionId': 'q', 'correct': True, 'date': '2026-09-14'}]
        remote = terminal.empty_state()
        settings = {'schemaVersion': 3, 'starred': [], 'completedReviewDates': []}
        settings_doc = {'updateTime': 'time', 'fields': {k: terminal._to_firestore_value(v) for k, v in settings.items()}}
        grammar_doc = {'updateTime': 'grammar-time', 'fields': {}}

        def request(method, url, **kwargs):
            if method == 'POST':
                return {}
            return settings_doc if url.endswith('/review') else grammar_doc

        with patch.object(self.client, 'load_review_state', return_value=remote), patch.object(self.client, '_list_documents', return_value=[]), patch.object(self.client, '_request_json', side_effect=request) as network:
            offline.synchronize(self.client, self.session, payload, terminal)
        commits = [call for call in network.call_args_list if call.args[0] == 'POST']
        self.assertEqual(len(commits), 1)
        writes = commits[0].kwargs['payload']['writes']
        self.assertEqual(len(writes), 4)
        shard = next(write for write in writes if '/progressShards/' in write.get('update', {}).get('name', ''))
        self.assertEqual(shard['currentDocument'], {'exists': False})
        self.assertEqual(shard['updateMask']['fieldPaths'], ['entries.`q`'])

    def test_offline_attempt_journal_survives_display_history_truncation(self):
        self.client.start_offline(self.session)
        state = copy.deepcopy(self.payload['state'])
        state['attempts'] = [{'id': 'a', 'questionId': 'q', 'correct': True}]
        self.client.save_review_state(self.session, state)
        state['attempts'] = [{'id': 'b', 'questionId': 'q', 'correct': False}]
        self.client.save_review_state(self.session, state)
        self.assertEqual(set(self.client.offline_payload['pending']['attempts']), {'a', 'b'})

    def test_offline_data_loading_never_reads_firestore(self):
        self.client.start_offline(self.session)
        with patch.object(self.client, '_request_json', side_effect=AssertionError('network accessed')):
            loaded, cached = terminal.load_data_with_cache(self.client, self.session)
        self.assertTrue(cached)
        self.assertEqual(loaded[0]['folders'][0]['id'], 'system-unfamiliar')

    def test_quota_exhaustion_uses_persisted_backup(self):
        with patch.object(terminal, 'load_data', side_effect=RuntimeError('HTTP 429: Quota exceeded.')):
            loaded, cached = terminal.load_data_with_cache(self.client, self.session)
        self.assertTrue(cached)
        self.assertTrue(self.client.offline_mode)
        self.assertEqual(loaded[1], [])

    def test_local_ack_failure_keeps_pending_id_for_safe_retry(self):
        self.client.start_offline(self.session)
        self.session.id_token = 'token'
        pending_id = self.client.offline_payload['pending']['id']
        with patch.object(offline, 'synchronize'), patch.object(offline, 'persist', side_effect=OSError('disk full')):
            with self.assertRaises(RuntimeError):
                self.client.sync_offline(self.session)
        self.assertEqual(self.client.offline_payload['pending']['id'], pending_id)


if __name__ == '__main__':
    unittest.main()
