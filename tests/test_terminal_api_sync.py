import io
import unittest
from urllib import error

from terminal_app.api.transport import JsonHttpTransport
from terminal_app.repositories import FirestoreCollectionRepository
from terminal_app.sync.service import TerminalSyncService


class _Response:
    def __init__(self, payload=b'{}'):
        self.payload = payload

    def __enter__(self):
        return self

    def __exit__(self, *_args):
        return False

    def read(self):
        return self.payload


class TerminalBoundaryTests(unittest.TestCase):
    def test_transport_refreshes_once_and_retries_with_new_token(self):
        requests = []

        def opener(http_request, timeout):
            requests.append((http_request, timeout))
            if len(requests) == 1:
                raise error.HTTPError(http_request.full_url, 401, 'unauthorized', {}, io.BytesIO(b'{"error":{"message":"expired"}}'))
            return _Response(b'{"ok":true}')

        transport = JsonHttpTransport(opener=opener, sleeper=lambda _delay: None)
        self.assertEqual(transport.request_json('GET', 'https://example.test', token='old', refresh=lambda: 'new'), {'ok': True})
        self.assertEqual(requests[1][0].headers['Authorization'], 'Bearer new')

    def test_repository_decodes_firestore_before_returning_data(self):
        class Client:
            def _list_documents(self, _segments, _session):
                return [{'name': 'users/u/records/card', 'fields': {'name': {'stringValue': 'value'}}}]

        session = type('Session', (), {'uid': 'u'})()
        records = FirestoreCollectionRepository(Client(), 'records').list_all(session)
        self.assertEqual(records, [{'name': 'value', 'id': 'card', '_docId': 'card'}])

    def test_offline_sync_service_never_calls_a_network_loader(self):
        payload = {'state': {'cached': True}}
        client = type('Client', (), {
            'offline_mode': True,
            'offline_payload': payload,
            '_saved_state': {},
            'start_offline': lambda self, _session, value: setattr(self, 'offline_payload', value),
        })()
        session = type('Session', (), {'uid': 'u'})()
        service = TerminalSyncService(
            1,
            read_cache=lambda _uid: payload,
            hydrate=lambda _client, _session, value, **_kwargs: (value['state'], [], [], [], {}, []),
            quota_error=lambda _message: False,
        )
        loaded, cached = service.load(
            client,
            session,
            payload,
            full_loader=lambda: self.fail('full network load used'),
            incremental_loader=lambda _value: self.fail('incremental network load used'),
        )
        self.assertTrue(cached)
        self.assertEqual(loaded[0], {'cached': True})


if __name__ == '__main__':
    unittest.main()
