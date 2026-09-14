"""Durable terminal snapshots and optimistic, atomic offline synchronization."""

import copy
import hashlib
import json
import os
import uuid
from pathlib import Path


def persist(path, payload):
    path = Path(path)
    path.parent.mkdir(parents=True, exist_ok=True)
    temporary = path.with_suffix('.tmp')
    with temporary.open('w', encoding='utf-8') as stream:
        json.dump(payload, stream, ensure_ascii=False)
        stream.flush()
        os.fsync(stream.fileno())
    temporary.replace(path)


def begin(payload):
    payload = copy.deepcopy(payload)
    payload.setdefault('pending', {
        'id': str(uuid.uuid4()),
        'baseState': copy.deepcopy(payload['state']),
        'baseGrammarReview': copy.deepcopy(payload.get('grammarReview') or {}),
        'folders': {},
    })
    return payload


def sync_receipt(payload):
    snapshot = {key: payload.get(key) for key in ('pending', 'state', 'grammarReview')}
    digest = hashlib.sha256(json.dumps(snapshot, ensure_ascii=False, sort_keys=True).encode()).hexdigest()
    return {'id': payload['pending']['id'], 'digest': digest}


def merge_state(remote, payload):
    """Apply local counter deltas, never an entire stale stats snapshot."""
    merged = copy.deepcopy(remote)
    base = payload['pending']['baseState']
    local = payload['state']
    for qid, stats in local.get('stats', {}).items():
        old = base.get('stats', {}).get(qid, {})
        if stats == old:
            continue
        latest = merged.setdefault('stats', {}).setdefault(qid, {})
        for key in ('correct', 'wrong', 'total'):
            delta = stats.get(key, 0) - old.get(key, 0)
            if delta < 0:
                raise RuntimeError('離線作答次數不合法，已保留待同步資料')
            latest[key] = latest.get(key, 0) + delta
        if stats.get('lastAnsweredAt', '') >= latest.get('lastAnsweredAt', ''):
            for key in ('lastAnsweredAt', 'lastResult'):
                if key in stats:
                    latest[key] = stats[key]
    for qid, progress in local.get('progress', {}).items():
        if progress == base.get('progress', {}).get(qid):
            continue
        latest = merged.setdefault('progress', {}).get(qid, {})
        if latest != base.get('progress', {}).get(qid, {}) and latest:
            raise RuntimeError('其他裝置也修改了相同單字的排程，已保留離線資料；請先處理同步衝突')
        merged['progress'][qid] = copy.deepcopy(progress)
    base_attempts = {a['id'] for a in base.get('attempts', [])}
    existing = {a['id'] for a in merged.get('attempts', [])}
    merged.setdefault('attempts', []).extend(
        a for a in local.get('attempts', []) if a['id'] not in base_attempts and a['id'] not in existing
    )
    merged['completedReviewDates'] = sorted(set(remote.get('completedReviewDates', [])) | set(local.get('completedReviewDates', [])))
    old_stars = set(base.get('starred', []))
    local_stars = set(local.get('starred', []))
    merged['starred'] = sorted((set(remote.get('starred', [])) | (local_stars - old_stars)) - (old_stars - local_stars))
    return merged


def synchronize(client, session, payload, api):
    pending = payload.get('pending')
    if not pending:
        return
    uid = session.uid
    prefix = f'projects/{client.project_id}/databases/(default)/documents/users/{uid}'
    grammar_url = client._document_url(['users', uid, 'settings', 'grammarReview'])

    def read(url):
        try:
            return client._request_json('GET', url, session=session)
        except RuntimeError as exc:
            if '404' in str(exc) or 'NOT_FOUND' in str(exc):
                return {}
            raise

    grammar_doc = read(grammar_url)
    grammar = api._parse_firestore_fields(grammar_doc.get('fields', {}))
    receipt_key = pending['id']
    receipt = sync_receipt(payload)
    existing_receipt = grammar.get('terminalOfflineReceipts', {}).get(receipt_key)
    if existing_receipt:
        if existing_receipt == receipt:
            return
        raise RuntimeError('先前批次已同步，但本機又有新變更；資料已保留，拒絕重複計分或丟棄新作答')
    remote = client.load_review_state(session)
    merged = merge_state(remote, payload)
    shards = client._list_documents(['users', uid, 'progressShards'], session)
    shard_docs = {api._doc_id(doc['name']): doc for doc in shards}
    writes = []

    def update(name, data, paths, document):
        writes.append({
            'update': {'name': name, 'fields': {k: api._to_firestore_value(v) for k, v in data.items()}},
            'updateMask': {'fieldPaths': paths},
            'currentDocument': {'updateTime': document['updateTime']} if document else {'exists': False},
        })

    changed = {}
    for qid in set(merged['stats']) | set(merged['progress']):
        entry = {'stats': merged['stats'].get(qid), 'progress': merged['progress'].get(qid)}
        if entry != {'stats': remote['stats'].get(qid), 'progress': remote['progress'].get(qid)}:
            changed.setdefault(api._progress_shard_id(qid), {})[qid] = entry
    for shard, entries in changed.items():
        document = shard_docs.get(shard, {})
        # Reject a race between the state read and this second shard read.
        actual = api._parse_firestore_fields(document.get('fields', {})).get('entries', {})
        for qid in entries:
            actual_entry = actual.get(qid, {})
            if {key: actual_entry.get(key) for key in ('stats', 'progress')} != {'stats': remote['stats'].get(qid), 'progress': remote['progress'].get(qid)}:
                raise RuntimeError('同步期間遠端進度已變更，請重試；離線資料仍保留')
        update(f'{prefix}/progressShards/{shard}', {'entries': entries},
               ['entries.`' + qid.replace('`', '\\`') + '`' for qid in entries], document)
    base_ids = {a['id'] for a in pending['baseState'].get('attempts', [])}
    attempts = list(pending['attempts'].values()) if 'attempts' in pending else [a for a in payload['state'].get('attempts', []) if a['id'] not in base_ids]
    for day, entries in api._attempts_by_date(attempts).items():
        writes.append({'update': {'name': f'{prefix}/reviewDays/{day}', 'fields': {'date': api._to_firestore_value(day)}},
                       'updateMask': {'fieldPaths': ['date']},
                       'updateTransforms': [{'fieldPath': 'attempts', 'appendMissingElements': {'values': [api._to_firestore_value(a) for a in entries]}}]})
    settings_doc = read(client._document_url(['users', uid, 'settings', 'review']))
    settings = api._parse_firestore_fields(settings_doc.get('fields', {}))
    if settings.get('starred', []) != remote.get('starred', []) or settings.get('completedReviewDates', []) != remote.get('completedReviewDates', []):
        raise RuntimeError('同步期間遠端設定已變更，請重試')
    update(f'{prefix}/settings/review', {k: merged[k] for k in ('starred', 'completedReviewDates')},
           ['starred', 'completedReviewDates'], settings_doc)
    base_grammar = pending['baseGrammarReview']
    local_grammar = payload.get('grammarReview') or {}
    grammar_changes = {}
    for key in set(base_grammar) | set(local_grammar):
        if local_grammar.get(key) == base_grammar.get(key):
            continue
        if grammar.get(key) != base_grammar.get(key):
            raise RuntimeError('其他裝置也修改了自選練習，已保留離線資料；請先處理同步衝突')
        grammar_changes[key] = local_grammar.get(key)
    receipts = dict(grammar.get('terminalOfflineReceipts') or {})
    receipts[receipt_key] = receipt
    grammar_changes['terminalOfflineReceipts'] = receipts
    update(f'{prefix}/settings/grammarReview', grammar_changes, list(grammar_changes), grammar_doc)
    for folder_id, words in pending['folders'].items():
        transforms = []
        for included, operation in ((True, 'appendMissingElements'), (False, 'removeAllFromArray')):
            values = [api._to_firestore_value(word) for word, value in words.items() if value == included]
            if values:
                transforms.append({'fieldPath': 'wordIds', operation: {'values': values}})
        if transforms:
            transforms.append({'fieldPath': 'updatedAt', 'setToServerValue': 'REQUEST_TIME'})
            folder_document = read(client._document_url(['users', uid, 'folders', folder_id]))
            if not folder_document:
                raise RuntimeError('待同步的資料夾已被刪除，已保留離線資料')
            writes.append({'transform': {'document': f'{prefix}/folders/{folder_id}', 'fieldTransforms': transforms},
                           'currentDocument': {'updateTime': folder_document['updateTime']}})
    if len(writes) > 500:
        raise RuntimeError('離線資料超過單次同步上限，資料已保留')
    client._request_json('POST', f'https://firestore.googleapis.com/v1/projects/{client.project_id}/databases/(default)/documents:commit',
                         payload={'writes': writes}, session=session)
