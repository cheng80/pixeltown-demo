#!/usr/bin/env python3
"""Deploy compatible minimal PB hooks, or restart PB alone. Never restart Colyseus."""
import argparse
import datetime
import hashlib
import json
import os
import pathlib
import shutil
import sqlite3
import subprocess
import time
from minimal_services import APP, ROOT, LABELS, plist_path, ports, health, launch, wait_ready

parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument('--hooks-source', type=pathlib.Path, help='Complete compatible minimal hooks, staged outside the active hooks directory')
args = parser.parse_args()
config = ports()
if not all(plist_path(label).is_file() for label in LABELS.values()):
    raise SystemExit('Separate PB/game services must be installed first; nothing stopped')
before = health(config['game'])
if before.get('mode') != 'minimal' or not before.get('ok'):
    raise SystemExit('Minimal game host must be healthy; nothing stopped')


def listener(port):
    result = subprocess.run(['lsof', '-ti', f'TCP:{port}', '-sTCP:LISTEN'], check=False, capture_output=True, text=True)
    return result.stdout.strip()


game_pid = listener(config['game'])
if not game_pid:
    raise SystemExit('Game listener missing; nothing stopped')
state = APP / '.local/minimal'
lock = state / 'pb-deployment.lock'
fd = os.open(lock, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
with os.fdopen(fd, 'w') as stream:
    json.dump({'pid': os.getpid()}, stream)
try:
    hooks = APP / 'pocketbase/minimal/pb_hooks'
    source = args.hooks_source.resolve() if args.hooks_source else None
    if source:
        if source == hooks.resolve() or sorted(path.name for path in source.iterdir()) != ['api.pb.js', 'bootstrap.pb.js']:
            raise RuntimeError('Provide a separate complete minimal hooks directory; nothing stopped')
        if any(not path.is_file() or path.is_symlink() or path.stat().st_nlink != 1 for path in source.iterdir()):
            raise RuntimeError('Hook source must contain only regular unlinked files; nothing stopped')
    stamp = datetime.datetime.now(datetime.timezone.utc).strftime('%Y%m%dT%H%M%S%fZ')
    backup = ROOT / '.backups' / ('pb-deploy-' + stamp)
    backup.mkdir(parents=True, mode=0o700)
    shutil.copytree(hooks, backup / 'previous-hooks')
    shutil.copy2(plist_path(LABELS['pb']), backup / 'pocketbase.plist')
    for name in ['data.db', 'auxiliary.db']:
        database = state / 'pb_data' / name
        if database.exists():
            with sqlite3.connect(f'file:{database}?mode=ro', uri=True) as db, sqlite3.connect(backup / name) as copied:
                db.backup(copied)
                if copied.execute('PRAGMA integrity_check').fetchone()[0] != 'ok':
                    raise RuntimeError('DB backup failed; nothing stopped')
    staged = hooks.parent / ('pb_hooks-stage-' + stamp)
    if source:
        shutil.copytree(source, staged)
    stopped = False
    replaced = False
    try:
        launch('bootout', LABELS['pb']); stopped = True
        deadline = time.monotonic() + 30
        while listener(config['pb']) and time.monotonic() < deadline:
            time.sleep(.2)
        if listener(config['pb']):
            raise RuntimeError('PB still owns its port; no hook files replaced')
        if (state / 'pb.lock').exists():
            raise RuntimeError('PB lock remains; inspect it before retrying')
        if source:
            hooks.rename(backup / 'retired-hooks')
            try:
                staged.rename(hooks)
            except Exception:
                (backup / 'retired-hooks').rename(hooks)
                raise
            replaced = True
        launch('bootstrap', LABELS['pb'])
        wait_ready(config['pb'], '/api/minimal/ready')
        if listener(config['game']) != game_pid or not health(config['game']).get('ok'):
            raise RuntimeError('Game host changed during PB deployment; investigate separately')
        revision = hashlib.sha256(b''.join(path.read_bytes() for path in sorted(hooks.iterdir()) if path.is_file())).hexdigest()
        print(json.dumps({'deployed': True, 'service': LABELS['pb'], 'gameProcessPreserved': True,
                          'hooksRevision': revision, 'backup': str(backup)}))
    except Exception:
        if replaced:
            try:
                launch('bootout', LABELS['pb'])
            except Exception:
                pass
            deadline = time.monotonic() + 30
            while listener(config['pb']) and time.monotonic() < deadline:
                time.sleep(.2)
            if not listener(config['pb']):
                hooks.rename(backup / 'rejected-hooks')
                (backup / 'retired-hooks').rename(hooks)
        if stopped and not listener(config['pb']):
            try:
                launch('bootstrap', LABELS['pb'])
            except Exception:
                pass
        # DB backup is evidence/recovery material; never overwrite live DB automatically.
        raise
    finally:
        if staged.exists():
            shutil.rmtree(staged)
finally:
    lock.unlink()
