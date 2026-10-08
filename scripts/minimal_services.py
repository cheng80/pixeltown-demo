"""launchd definitions shared by first installation and an empty-lobby migration."""
import json
import os
import pathlib
import plistlib
import subprocess
import time
import urllib.request

HOME = pathlib.Path.home()
ROOT = HOME / 'Servers/pixeltown-minimal'
APP = ROOT / 'app'
NODE = HOME / 'Servers/pixeltown-colyseus/runtime/bin/node'
DOMAIN = f'gui/{os.getuid()}'
OLD_LABEL = 'com.fastmake.pixeltown.minimal'
LABELS = {'pb': OLD_LABEL + '.pocketbase', 'game': OLD_LABEL + '.colyseus'}


def plist_path(label):
    return HOME / 'Library/LaunchAgents' / (label + '.plist')


def definition(component):
    script = 'scripts/minimal-pocketbase.mjs' if component == 'pb' else 'scripts/start-minimal-game.mjs'
    return {
        'Label': LABELS[component],
        'ProgramArguments': [str(NODE), '--env-file=' + str(ROOT / '.env'), script],
        'WorkingDirectory': str(APP), 'RunAtLoad': True,
        'KeepAlive': {'SuccessfulExit': False}, 'ThrottleInterval': 10,
        'StandardOutPath': str(ROOT / f'minimal-{component}.out.log'),
        'StandardErrorPath': str(ROOT / f'minimal-{component}.err.log'),
    }


def write_definitions():
    created = []
    try:
        for component, label in LABELS.items():
            path = plist_path(label)
            with path.open('xb') as stream:
                created.append(path)
                plistlib.dump(definition(component), stream)
            path.chmod(0o600)
    except Exception:
        for path in created:
            path.unlink()
        raise


def launch(action, label):
    target = str(plist_path(label)) if action == 'bootstrap' else DOMAIN + '/' + label
    args = ['launchctl', action, DOMAIN, target] if action == 'bootstrap' else ['launchctl', action, target]
    subprocess.run(args, check=True, capture_output=True)


def health(port, path='/health'):
    with urllib.request.urlopen(f'http://127.0.0.1:{port}{path}', timeout=2) as response:
        return json.load(response)


def wait_ready(port, path):
    deadline = time.monotonic() + 30
    while time.monotonic() < deadline:
        try:
            result = health(port, path)
            if result.get('code') == 200 or result.get('ok') or (path == '/api/minimal/ready' and result.get('mode') == 'minimal'):
                return result
        except Exception:
            pass
        time.sleep(.2)
    raise RuntimeError('Minimal component is not ready; inspect its private log')


def ports():
    # Load the same env syntax as the Node services. Print only public port values.
    code = "import {PB_PORT,GAME_PORT} from './colyseus/minimal/config.js';console.log(JSON.stringify({pb:PB_PORT,game:GAME_PORT}));"
    result = subprocess.run([str(NODE), '--env-file=' + str(ROOT / '.env'), '--input-type=module', '-e', code],
                            cwd=APP, check=True, capture_output=True, text=True)
    return json.loads(result.stdout)
