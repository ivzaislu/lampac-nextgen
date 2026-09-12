#!/usr/bin/env python3
import json
import os
import sqlite3
import urllib.error
import urllib.parse
import urllib.request
from pathlib import Path

BASE = os.environ.get('TRANSLATIONSUB_BASE_URL', 'http://127.0.0.1:9118').rstrip('/')
DB_PATH = Path(os.environ.get('TRANSLATIONSUB_DB_PATH', '/tmp/lampac-runtime/database/translationsub.db'))
UID = 'settings-regression@translationsub.test'
TRIMMED_UID = 'settings-body@translationsub.test'


def call(method, path, payload=None, raw=None):
    url = BASE + path
    headers = {}
    data = None
    if raw is not None:
        data = raw.encode('utf-8')
        headers['Content-Type'] = 'application/json'
    elif payload is not None:
        data = json.dumps(payload, ensure_ascii=False).encode('utf-8')
        headers['Content-Type'] = 'application/json'

    request = urllib.request.Request(url, data=data, headers=headers, method=method)
    try:
        with urllib.request.urlopen(request, timeout=15) as response:
            status = response.status
            text = response.read().decode('utf-8')
    except urllib.error.HTTPError as exc:
        status = exc.code
        text = exc.read().decode('utf-8')

    try:
        body = json.loads(text) if text else None
    except json.JSONDecodeError:
        body = text
    return status, body


def q(uid):
    return '?' + urllib.parse.urlencode({'uid': uid})


def value(obj, pascal, camel):
    return obj.get(pascal, obj.get(camel))


def settings_of(body):
    assert isinstance(body, dict) and body.get('success') is True, body
    settings = body.get('settings')
    assert isinstance(settings, dict), body
    return settings


def assert_settings(settings, *, uid, interval, sources, smart, tmdb_hours, ended_days, season_mode):
    assert value(settings, 'Uid', 'uid') == uid, settings
    assert value(settings, 'CheckIntervalHours', 'checkIntervalHours') == interval, settings
    assert value(settings, 'Sources', 'sources') == sources, settings
    assert value(settings, 'UseTmdbSchedule', 'useTmdbSchedule') is smart, settings
    assert value(settings, 'TmdbRefreshHours', 'tmdbRefreshHours') == tmdb_hours, settings
    assert value(settings, 'EndedRefreshDays', 'endedRefreshDays') == ended_days, settings
    assert value(settings, 'NewSeasonMode', 'newSeasonMode') == season_mode, settings


def db_row(uid):
    assert DB_PATH.is_file(), f'SQLite database was not created: {DB_PATH}'
    with sqlite3.connect(DB_PATH) as db:
        return db.execute(
            'SELECT uid, check_interval_hours, sources_json, use_tmdb_schedule, '
            'tmdb_refresh_hours, ended_refresh_days, new_season_mode '
            'FROM settings WHERE uid = ?',
            (uid,),
        ).fetchone()


def main():
    print('1. GET defaults and server-owned schema')
    status, body = call('GET', '/translationsub/v2/settings' + q(UID))
    assert status == 200, (status, body)
    settings = settings_of(body)
    assert_settings(
        settings,
        uid=UID,
        interval=1,
        sources=[],
        smart=True,
        tmdb_hours=24,
        ended_days=7,
        season_mode='auto',
    )
    schema = body.get('schema') or {}
    assert schema.get('checkIntervalHours', {}).get('defaultValue') == 1, schema
    assert set((schema.get('checkIntervalHours', {}).get('values') or {}).keys()) == {str(i) for i in range(1, 25)}, schema
    assert schema.get('useTmdbSchedule', {}).get('defaultValue') is True, schema
    assert schema.get('tmdbRefreshHours', {}).get('defaultValue') == 24, schema
    assert set((schema.get('tmdbRefreshHours', {}).get('values') or {}).keys()) == {'6', '12', '24', '48', '72', '168'}, schema
    assert schema.get('endedRefreshDays', {}).get('defaultValue') == 7, schema
    assert set((schema.get('endedRefreshDays', {}).get('values') or {}).keys()) == {'7', '14', '30', '60'}, schema
    assert schema.get('newSeasonMode', {}).get('defaultValue') == 'auto', schema
    assert set((schema.get('newSeasonMode', {}).get('values') or {}).keys()) == {'auto', 'notify', 'off'}, schema
    assert isinstance(body.get('availableSourceItems'), list), body
    assert db_row(UID) is None, 'GET defaults must not create a settings row'

    print('2. GET without uid remains a read-only defaults response')
    status, no_uid_get = call('GET', '/translationsub/v2/settings')
    assert status == 200, (status, no_uid_get)
    no_uid_settings = settings_of(no_uid_get)
    assert value(no_uid_settings, 'Uid', 'uid') is None, no_uid_settings
    assert value(no_uid_settings, 'UseTmdbSchedule', 'useTmdbSchedule') is True, no_uid_settings

    print('3. POST input validation')
    status, empty = call('POST', '/translationsub/v2/settings', raw='')
    assert status == 200 and empty == {'success': False, 'error': 'empty_body'}, (status, empty)
    status, invalid = call('POST', '/translationsub/v2/settings', raw='{not-json')
    assert status == 200 and invalid == {'success': False, 'error': 'invalid_json'}, (status, invalid)
    status, missing_uid = call('POST', '/translationsub/v2/settings', payload={})
    assert status == 200 and missing_uid == {'success': False, 'error': 'uid_required'}, (status, missing_uid)

    print('4. Full POST, false persistence, source normalization and case normalization')
    full_payload = {
        'checkIntervalHours': 24,
        'sources': [' VideoDB ', 'phantom', 'PHANTOM', '../bad?', 'zetflixdb', None],
        'useTmdbSchedule': False,
        'tmdbRefreshHours': 168,
        'endedRefreshDays': 90,
        'newSeasonMode': 'OFF',
    }
    status, full = call('POST', '/translationsub/v2/settings' + q(UID), payload=full_payload)
    assert status == 200, (status, full)
    full_settings = settings_of(full)
    expected_sources = ['phantom', 'videodb', 'zetflixdb']
    assert_settings(
        full_settings,
        uid=UID,
        interval=24,
        sources=expected_sources,
        smart=False,
        tmdb_hours=168,
        ended_days=90,
        season_mode='off',
    )
    row = db_row(UID)
    assert row is not None, 'POST did not persist settings row'
    assert row[0] == UID and row[1] == 24 and json.loads(row[2]) == expected_sources, row
    assert row[3] == 0 and row[4] == 168 and row[5] == 90 and row[6] == 'off', row

    print('5. GET after POST returns canonical persisted values')
    status, reread = call('GET', '/translationsub/v2/settings' + q(UID))
    assert status == 200, (status, reread)
    assert_settings(
        settings_of(reread),
        uid=UID,
        interval=24,
        sources=expected_sources,
        smart=False,
        tmdb_hours=168,
        ended_days=90,
        season_mode='off',
    )

    print('6. Partial POST preserves all unspecified fields')
    status, partial = call('POST', '/translationsub/v2/settings' + q(UID), payload={'newSeasonMode': 'notify'})
    assert status == 200, (status, partial)
    assert_settings(
        settings_of(partial),
        uid=UID,
        interval=24,
        sources=expected_sources,
        smart=False,
        tmdb_hours=168,
        ended_days=90,
        season_mode='notify',
    )

    print('7. Boolean false -> true round trip')
    status, smart_true = call('POST', '/translationsub/v2/settings' + q(UID), payload={'useTmdbSchedule': True})
    assert status == 200, (status, smart_true)
    assert value(settings_of(smart_true), 'UseTmdbSchedule', 'useTmdbSchedule') is True, smart_true
    status, reread_true = call('GET', '/translationsub/v2/settings' + q(UID))
    assert status == 200 and value(settings_of(reread_true), 'UseTmdbSchedule', 'useTmdbSchedule') is True, reread_true
    row = db_row(UID)
    assert row[3] == 1, row

    print('8. Lower-bound/default normalization')
    status, low = call('POST', '/translationsub/v2/settings' + q(UID), payload={
        'checkIntervalHours': -100,
        'tmdbRefreshHours': 0,
        'endedRefreshDays': 0,
        'newSeasonMode': 'invalid-mode',
    })
    assert status == 200, (status, low)
    low_settings = settings_of(low)
    assert value(low_settings, 'CheckIntervalHours', 'checkIntervalHours') == 1, low_settings
    assert value(low_settings, 'TmdbRefreshHours', 'tmdbRefreshHours') == 24, low_settings
    assert value(low_settings, 'EndedRefreshDays', 'endedRefreshDays') == 7, low_settings
    assert value(low_settings, 'NewSeasonMode', 'newSeasonMode') == 'auto', low_settings
    assert value(low_settings, 'Sources', 'sources') == expected_sources, low_settings

    print('9. Upper-bound normalization')
    status, high = call('POST', '/translationsub/v2/settings' + q(UID), payload={
        'checkIntervalHours': 999,
        'tmdbRefreshHours': 999,
        'endedRefreshDays': 999,
    })
    assert status == 200, (status, high)
    high_settings = settings_of(high)
    assert value(high_settings, 'CheckIntervalHours', 'checkIntervalHours') == 24, high_settings
    assert value(high_settings, 'TmdbRefreshHours', 'tmdbRefreshHours') == 168, high_settings
    assert value(high_settings, 'EndedRefreshDays', 'endedRefreshDays') == 90, high_settings

    print('10. Valid minimum boundaries and false value survive another round trip')
    status, minimum = call('POST', '/translationsub/v2/settings' + q(UID), payload={
        'checkIntervalHours': 1,
        'tmdbRefreshHours': 6,
        'endedRefreshDays': 1,
        'useTmdbSchedule': False,
        'newSeasonMode': 'AUTO',
    })
    assert status == 200, (status, minimum)
    assert_settings(
        settings_of(minimum),
        uid=UID,
        interval=1,
        sources=expected_sources,
        smart=False,
        tmdb_hours=6,
        ended_days=1,
        season_mode='auto',
    )
    row = db_row(UID)
    assert row[1] == 1 and row[3] == 0 and row[4] == 6 and row[5] == 1 and row[6] == 'auto', row

    print('11. sources:null preserves selection; sources:[] clears it')
    status, null_sources = call('POST', '/translationsub/v2/settings' + q(UID), payload={'sources': None})
    assert status == 200 and value(settings_of(null_sources), 'Sources', 'sources') == expected_sources, null_sources
    status, clear_sources = call('POST', '/translationsub/v2/settings' + q(UID), payload={'sources': []})
    assert status == 200 and value(settings_of(clear_sources), 'Sources', 'sources') == [], clear_sources
    row = db_row(UID)
    assert json.loads(row[2]) == [], row

    print('12. Body uid is trimmed before persistence')
    status, body_uid = call('POST', '/translationsub/v2/settings', payload={
        'uid': f'  {TRIMMED_UID}  ',
        'checkIntervalHours': 5,
        'useTmdbSchedule': False,
    })
    assert status == 200, (status, body_uid)
    body_uid_settings = settings_of(body_uid)
    assert value(body_uid_settings, 'Uid', 'uid') == TRIMMED_UID, body_uid_settings
    assert value(body_uid_settings, 'CheckIntervalHours', 'checkIntervalHours') == 5, body_uid_settings
    assert value(body_uid_settings, 'UseTmdbSchedule', 'useTmdbSchedule') is False, body_uid_settings
    assert db_row(TRIMMED_UID) is not None, 'trimmed uid row is missing'

    print('13. JSON stores are not recreated')
    legacy_dir = DB_PATH.parent / 'translationsub'
    for name in ('settings.json', 'subscriptions.json', 'profile-progress.json'):
        assert not (legacy_dir / name).exists(), f'legacy JSON store was recreated: {legacy_dir / name}'

    print('TranslationSub settings regression passed: 13 groups')


if __name__ == '__main__':
    main()
