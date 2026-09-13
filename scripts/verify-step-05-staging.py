#!/usr/bin/env python3
"""Verify Step 05 against staging using disposable, generated accounts."""
import argparse
import json
import os
import secrets
import struct
import sys
import tempfile
import urllib.error
import urllib.parse
import urllib.request
import zlib

BASE = 'https://lauver-api-staging.onrender.com'
parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument('--cleanup-state', help='Retry cleanup from a private recovery file')
args = parser.parse_args()
accounts = []
checks = []
exit_code = 0

def call(method, path, body=None, token=None, raw=None, headers=None):
    url = path if path.startswith('https://') else BASE + path
    h = dict(headers or {})
    if method == 'GET' and path.startswith('https://'):
        # Cloudflare rejects urllib's default request with error code 1010.
        h.setdefault('User-Agent', 'Mozilla/5.0 (compatible; LauverStep05Acceptance/1.0)')
        h.setdefault('Accept', 'image/jpeg')
    if token:
        h['Authorization'] = 'Bearer ' + token
    data = raw
    if body is not None:
        data = json.dumps(body).encode()
        h['Content-Type'] = 'application/json'
    if data is not None:
        h['Content-Length'] = str(len(data))
    request = urllib.request.Request(url, data=data, headers=h, method=method)
    try:
        with urllib.request.urlopen(request, timeout=40) as response:
            status, payload, response_headers = response.status, response.read(), {key.lower(): value for key, value in response.headers.items()}
    except urllib.error.HTTPError as error:
        status, payload, response_headers = error.code, error.read(), {key.lower(): value for key, value in error.headers.items()}
    try:
        parsed = json.loads(payload)
    except (ValueError, UnicodeDecodeError):
        parsed = None
    return status, parsed, payload, response_headers

def check(condition, label):
    if not condition:
        raise AssertionError(label)
    checks.append(label)
    print('PASS ' + label, flush=True)

def png(color):
    def chunk(kind, body):
        return struct.pack('>I', len(body)) + kind + body + struct.pack('>I', zlib.crc32(kind + body) & 0xffffffff)
    rows = (b'\x00' + bytes(color) * 256) * 256
    return b'\x89PNG\r\n\x1a\n' + chunk(b'IHDR', struct.pack('>IIBBBBB',256,256,8,2,0,0,0)) + chunk(b'IDAT',zlib.compress(rows)) + chunk(b'IEND',b'')

def upload_photo(account, data):
    status, upload, _, _ = call('POST','/v1/me/photo/upload-url',
        {'fileName':'avatar.png','contentType':'image/png','byteSize':len(data)},account['session']['accessToken'])
    check(status == 201 and isinstance(upload,dict), 'signed-upload-url')
    check(urllib.parse.urlparse(upload['uploadURL']).scheme == 'https', 'signed-url-https')
    status, _, _, _ = call('PUT',upload['uploadURL'],raw=data,headers=upload['requiredHeaders'])
    check(status == 200, 'object-storage-put')
    return upload

def complete(account, upload):
    return call('POST','/v1/me/photo/complete',{'objectKey':upload['objectKey']},account['session']['accessToken'])

def cache_bypass(url):
    return url + ('&' if '?' in url else '?') + 'step05_verify=' + secrets.token_hex(8)

try:
    if args.cleanup_state:
        with open(args.cleanup_state, encoding='utf-8') as state:
            accounts = json.load(state)
        for account in accounts:
            status, session, _, _ = call('POST', '/v1/auth/login', {
                'email': account['email'], 'password': account['password'],
            })
            check(status == 200, 'cleanup-session-login')
            account['session'] = session
            account['sessions'].append(session)
        # The finally block performs cleanup without creating new accounts.
        sys.exit(0)
    status, ready, _, _ = call('GET','/readyz')
    check(status == 200 and ready.get('database') == 'ok', 'staging-database-ready')
    for _ in range(2):
        account = {'email':'step05-' + secrets.token_hex(10) + '@example.com', 'password':'Step05Validation9-' + secrets.token_hex(20)}
        status, session, _, _ = call('POST','/v1/auth/register',{'email':account['email'],'password':account['password']})
        check(status == 201, 'test-account-registration')
        account['session'] = session
        account['sessions'] = [session]
        accounts.append(account)
    owner, viewer = accounts
    token = owner['session']['accessToken']
    draft = {'displayName':'Staging validation runner','bio':'Profile lifecycle verification',
        'city':{'name':'Shanghai','regionCode':None,'countryCode':'CN','latitude':31.2304,'longitude':121.4737},
        'sports':[{'sport':'running','paceValue':5.2}], 'trainingTimes':[{'weekday':1,'timeBucket':'morning'}]}
    status, updated, _, _ = call('PATCH','/v1/me',draft,token)
    check(status == 200 and updated['profile']['isComplete'], 'complete-profile-save')
    status, reread, _, _ = call('GET','/v1/me',token=token)
    check(status == 200 and reread == updated, 'profile-persisted-reread')
    user_id = updated['profile']['id']
    status, public, _, _ = call('GET','/v1/users/' + user_id,token=viewer['session']['accessToken'])
    check(status == 200, 'second-account-public-profile')
    public_json = json.dumps(public)
    check('latitude' not in public_json and 'longitude' not in public_json and 'photoKey' not in public_json, 'public-coordinate-and-storage-key-omission')
    first_upload = upload_photo(owner,png((30,120,60)))
    status, first, _, _ = complete(owner,first_upload)
    check(status == 200, 'photo-completion')
    first_url = first['profile']['photoURL']
    upload_uuid = first_upload['objectKey'].rsplit('/',1)[1].split('.',1)[0]
    check(urllib.parse.urlparse(first_url).path.rsplit('/',1)[1] == upload_uuid + '.jpg',
        'recovery-revision-deployed')
    status, repeated, _, _ = complete(owner,first_upload)
    check(status == 200 and repeated == first, 'repeat-completion-after-cleanup')
    status, _, photo_bytes, photo_headers = call('GET',cache_bypass(first_url),headers={'Cache-Control':'no-cache'})
    check(status == 200 and photo_bytes.startswith(b'\xff\xd8') and photo_headers.get('content-type','').startswith('image/jpeg'), 'cdn-sanitized-jpeg')
    status, _, _, _ = complete(viewer,first_upload)
    check(status == 422, 'foreign-upload-rejected')
    second_upload = upload_photo(owner,png((120,30,60)))
    status, second, _, _ = complete(owner,second_upload)
    second_url = second['profile']['photoURL'] if status == 200 else None
    check(status == 200 and second_url != first_url, 'photo-replacement')
    status, _, _, _ = call('GET',cache_bypass(first_url),headers={'Cache-Control':'no-cache'})
    check(status == 404, 'replaced-object-absent-from-cdn-origin')
    status, _, _, _ = complete(owner,first_upload)
    check(status == 422, 'replaced-upload-replay-rejected')
    status, fresh_session, _, _ = call('POST','/v1/auth/login',{'email':owner['email'],'password':owner['password']})
    check(status == 200, 'fresh-session-login')
    owner['session'] = fresh_session
    owner['sessions'].append(fresh_session)
    token = fresh_session['accessToken']
    status, fresh_profile, _, _ = call('GET','/v1/me',token=token)
    check(status == 200 and fresh_profile == second, 'fresh-session-profile-and-photo-persistence')
    status, _, _, _ = call('DELETE','/v1/me/photo',token=token)
    check(status == 204, 'photo-deletion')
    status, deleted, _, _ = call('GET','/v1/me',token=token)
    check(status == 200 and deleted['profile']['photoURL'] is None, 'photo-reference-cleared')
    status, _, _, _ = call('GET',cache_bypass(second_url),headers={'Cache-Control':'no-cache'})
    check(status == 404, 'deleted-object-absent-from-cdn-origin')
    status, _, _, _ = complete(owner,second_upload)
    check(status == 422, 'deleted-upload-replay-rejected')
    for label, invalid in [
        ('disguised-extension-rejected',{'fileName':'avatar.txt','contentType':'image/png','byteSize':24}),
        ('oversize-photo-rejected',{'fileName':'avatar.png','contentType':'image/png','byteSize':5*1024*1024+1}),
    ]:
        status, _, _, _ = call('POST','/v1/me/photo/upload-url',invalid,token)
        check(status == 422,label)
    invalid_upload = upload_photo(owner,b'this is not an image')
    status, invalid, _, _ = complete(owner,invalid_upload)
    check(status == 422 and invalid.get('code') == 'invalid_photo_content', 'non-image-content-rejected')
    print(json.dumps({'result':'passed','checks':len(checks)}),flush=True)
except Exception as error:
    label = str(error) if isinstance(error,AssertionError) else type(error).__name__
    print(json.dumps({'result':'failed','check':label,'completed_checks':len(checks)}),flush=True)
    exit_code = 1
finally:
    clean = True
    for account in accounts:
        token = account['session']['accessToken']
        operations = [
            ('DELETE', '/v1/me/photo', None, 204),
            ('PATCH', '/v1/me', {
                'displayName': None, 'bio': None, 'city': None,
                'sports': [], 'trainingTimes': [],
            }, 200),
        ]
        operations.extend(
            ('POST', '/v1/auth/logout', {'refreshToken': session['refreshToken']}, 204)
            for session in account['sessions']
        )
        for method, path, body, expected in operations:
            succeeded = False
            for _ in range(3):
                try:
                    status, _, _, _ = call(method, path, body, token)
                    if status == expected:
                        succeeded = True
                        break
                except Exception:
                    # Continue with the other cleanup operations even if one fails.
                    pass
            clean = clean and succeeded
    print(json.dumps({'test_profiles_photos_and_sessions_cleared': clean}), flush=True)
    if clean and args.cleanup_state:
        os.unlink(args.cleanup_state)
    if not clean:
        # Preserve generated credentials privately so a failed cleanup can be retried.
        descriptor, state_path = tempfile.mkstemp(prefix='lauver-step05-cleanup-', suffix='.json')
        with os.fdopen(descriptor, 'w', encoding='utf-8') as state:
            json.dump(accounts, state)
        print(json.dumps({'cleanup_recovery_file': state_path}), flush=True)
        exit_code = 1
    sys.exit(exit_code)
