#!/usr/bin/env python3
"""Migrate only the minimal combined service, only with an empty healthy lobby."""
import argparse
import datetime
import json
import os
import shutil
import sqlite3
import subprocess
import time
from minimal_services import APP, ROOT, DOMAIN, OLD_LABEL, LABELS, plist_path, ports, health, write_definitions, launch, wait_ready

parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument('--apply', action='store_true', help='Apply the prepared split; default is a read-only check')
parser.add_argument('--allow-connected', action='store_true', help='Explicitly allow the one-time initial migration to disconnect current players')
args = parser.parse_args()
config = ports()
before = health(config['game'])
old = plist_path(OLD_LABEL)
if not old.is_file():
    raise SystemExit('Original minimal service plist not found; nothing stopped')
if any(plist_path(label).exists() for label in LABELS.values()):
    raise SystemExit('Split service plist already exists; inspect it without overwriting')
for script in ['minimal-pocketbase.mjs', 'start-minimal-game.mjs', 'minimal-process.mjs']:
    if not (APP / 'scripts' / script).is_file():
        raise SystemExit('Required service script not staged; nothing stopped')


def require_empty(value):
    if (value.get('mode') != 'minimal' or not value.get('ok') or value.get('players') != 0
            or value.get('persistence') != {'pending': 0, 'failed': 0}
            or (value.get('worker') or {}).get('candidate')):
        if not (args.allow_connected and value.get('mode') == 'minimal' and value.get('ok')
                and isinstance(value.get('players'), int) and value['players'] >= 0
                and value.get('persistence') == {'pending': 0, 'failed': 0}
                and not (value.get('worker') or {}).get('candidate')):
            raise RuntimeError('Minimal lobby must be healthy and empty with no pending/failed settlements; nothing stopped')


require_empty(before)
if not args.apply:
    print(json.dumps({'eligible': True, 'applied': False, 'services': LABELS, 'players': before['players'], 'disconnectAllowed': args.allow_connected}))
    raise SystemExit(0)

# Preserve DB, full state (including outbox/releases), settings and the original service.
stamp = datetime.datetime.now(datetime.timezone.utc).strftime('%Y%m%dT%H%M%S%fZ')
backup = ROOT / '.backups' / ('service-split-' + stamp)
backup.mkdir(parents=True, mode=0o700)
shutil.copytree(APP / '.local/minimal', backup / 'state')
shutil.copy2(ROOT / '.env', backup / 'env')
shutil.copy2(old, backup / old.name)
for name in ['data.db', 'auxiliary.db']:
    source = APP / '.local/minimal/pb_data' / name
    if source.exists():
        with sqlite3.connect(f'file:{source}?mode=ro', uri=True) as db, sqlite3.connect(backup / name) as copied:
            db.backup(copied)
            if copied.execute('PRAGMA integrity_check').fetchone()[0] != 'ok':
                raise RuntimeError('Database backup verification failed; nothing stopped')
write_definitions()
started = []
stopped_old = False
try:
    # Recheck immediately before stopping the old service, after staging/backup work.
    require_empty(health(config['game']))
    launch('bootout', OLD_LABEL); stopped_old = True
    deadline = time.monotonic() + 30
    while time.monotonic() < deadline:
        if all(not subprocess.run(['lsof', '-ti', f'TCP:{port}', '-sTCP:LISTEN'], capture_output=True, text=True).stdout.strip()
               for port in config.values()):
            break
        time.sleep(.2)
    else:
        raise RuntimeError('Original minimal child still owns a port; no new child started')
    lock = APP / '.local/minimal/pb.lock'
    if lock.exists():
        owner = json.loads(lock.read_text())['pid']
        if not isinstance(owner, int) or isinstance(owner, bool) or owner <= 0:
            raise RuntimeError('Invalid PB lock; no lock removed')
        try:
            os.kill(owner, 0)
        except ProcessLookupError:
            # Both ports and the recorded parent were checked after our own shutdown.
            lock.unlink()
        else:
            raise RuntimeError('PB lock owner still alive; no lock removed')
    started.append(LABELS['pb']); launch('bootstrap', LABELS['pb'])
    wait_ready(config['pb'], '/api/minimal/ready')
    started.append(LABELS['game']); launch('bootstrap', LABELS['game'])
    after = wait_ready(config['game'], '/ready')
    if not after.get('hotSwap') or after.get('workerDeployment') != 'managed-release':
        raise RuntimeError('New host is not using managed worker releases')
    old.rename(backup / ('retired-' + old.name))
    print(json.dumps({'applied': True, 'services': LABELS, 'backup': str(backup), 'playersAtInitialCheck': before['players'], 'disconnectAllowed': args.allow_connected, 'health': after}))
except Exception:
    for label in reversed(started):
        try:
            launch('bootout', label)
        except Exception:
            pass
    for label in LABELS.values():
        plist_path(label).unlink(missing_ok=True)
    if stopped_old:
        # Never overwrite DB or worker selection during rollback.
        try:
            launch('bootstrap', OLD_LABEL)
        except Exception:
            pass
    raise
