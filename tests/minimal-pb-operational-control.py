"""SSH-only helper for an authorized, bounded two-client minimal PB deployment check."""
import hashlib
import json
import os
import pathlib
import shutil
import subprocess
import sys
import time
import urllib.request

app = pathlib.Path.cwd()
if app != pathlib.Path.home() / 'Servers/pixeltown-minimal/app':
    raise SystemExit('Use only the isolated minimal operational app')
action = sys.argv[1]
marker = app / '.test-work/pb-operational-state.json'
if action == 'prepare':
    if marker.exists():
        raise SystemExit('Previous PB deployment check state exists; inspect it first')
    directory = app / '.test-work' / ('pb-deployment-' + str(time.time_ns()))
    directory.mkdir(mode=0o700)
    hooks = app / 'pocketbase/minimal/pb_hooks'
    shutil.copytree(hooks, directory / 'original-hooks')
    shutil.copytree(hooks, directory / 'next-hooks')
    api = directory / 'next-hooks/api.pb.js'
    with api.open('a') as stream:
        stream.write('\nrouterAdd("GET", "/api/minimal/deployment-probe", (e) => {\n'
                     'if (e.request.header.get("CF-Connecting-IP") || e.request.header.get("X-Forwarded-For")) return e.noContent(403);\n'
                     'return e.json(200, {revision: 2});\n});\n')
    marker.write_text(json.dumps({'directory': str(directory)})); marker.chmod(0o600)
    print(json.dumps({'prepared': True, 'directory': str(directory)}))
elif action in ('deploy', 'restore'):
    state = json.loads(marker.read_text())
    source = pathlib.Path(state['directory']) / ('next-hooks' if action == 'deploy' else 'original-hooks')
    completed = subprocess.run(['python3', 'scripts/deploy-minimal-pb.py', '--hooks-source', str(source)], capture_output=True, text=True)
    if completed.returncode:
        raise SystemExit(completed.stderr)
    result = json.loads(completed.stdout)
    if action == 'deploy':
        with urllib.request.urlopen('http://127.0.0.1:18820/api/minimal/deployment-probe', timeout=3) as response:
            assert json.load(response)['revision'] == 2
        result['probeRevision'] = 2
    else:
        original = source
        hooks = app / 'pocketbase/minimal/pb_hooks'
        assert all((hooks / file.name).read_bytes() == file.read_bytes() for file in original.iterdir())
        marker.rename(pathlib.Path(state['directory']) / 'completed.json')
        result['originalHooksRestored'] = True
    print(json.dumps(result))
else:
    raise SystemExit('Unknown PB control action')
