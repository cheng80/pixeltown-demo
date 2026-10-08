"""Read minimal service and shared tunnel diagnostics without changing services."""
import datetime
import json
import os
import pathlib
import re
import subprocess
import sys
import urllib.request

app = pathlib.Path('/Users/cheng80/Servers/pixeltown-minimal/app')
assert pathlib.Path.cwd().resolve() == app
key = sys.argv[1]
assert re.fullmatch(r'\d+-\d+', key)
cursor = app / '.test-work' / ('live-diagnostic-' + key + '.json')
previous = json.loads(cursor.read_text()) if cursor.exists() else {}
result = {'at': datetime.datetime.now(datetime.timezone.utc).isoformat(), 'services': {}, 'logs': []}
for label, domain in [('com.fastmake.pixeltown.minimal.colyseus', f'gui/{os.getuid()}'),
                      ('com.fastmake.pixeltown.minimal.pocketbase', f'gui/{os.getuid()}'),
                      ('com.cloudflare.cloudflared', 'system')]:
    proc = subprocess.run(['launchctl', 'print', domain + '/' + label], capture_output=True, text=True, timeout=5)
    result['services'][label] = {'loaded': proc.returncode == 0}
    for field in ['pid', 'state', 'last exit code']:
        match = re.search(r'^\s*' + re.escape(field) + r' = ([^\n]+)', proc.stdout, re.M)
        if match:
            result['services'][label][field] = match.group(1)
try:
    result['health'] = json.load(urllib.request.urlopen('http://127.0.0.1:13620/health', timeout=3))
except Exception as error:
    result['healthError'] = type(error).__name__

def redact(line):
    line = re.sub(r'eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+', '[JWT]', line)
    line = re.sub(r'(?i)((?:authorization|password|token|secret)["\s:=]+)[^\s,"}]+', r'\1[REDACTED]', line)
    line = re.sub(r'https?://[^\s?]+\?[^\s]+', '[URL WITH QUERY]', line)
    line = re.sub(r'[\w.+-]+@[\w.-]+', '[EMAIL]', line)
    return line[:1800]

paths = [app.parent / ('minimal-' + part + '.' + stream + '.log')
         for part in ['game', 'pb'] for stream in ['out', 'err']]
paths += [pathlib.Path('/Library/Logs/com.cloudflare.cloudflared.' + stream + '.log') for stream in ['out', 'err']]
current = {}
for path in paths:
    name = str(path)
    try:
        size = path.stat().st_size
        old = previous.get(name, size)
        start = max(0, old if old <= size else 0, size - 65536)
        with path.open('rb') as stream:
            stream.seek(start)
            lines = stream.read().decode('utf-8', errors='replace').splitlines()
        # Tunnel logs are shared. Keep infrastructure errors and minimal-specific events.
        if 'cloudflared' in name:
            lines = [line for line in lines if ('pixeltown-minimal' in line or
                     (re.search(r'\b(ERR|WRN)\b', line) and 'originService=' not in line and 'ingressRule=' not in line))]
        result['logs'].append({'path': name, 'from': start, 'to': size,
                               'baseline': name not in previous,
                               'truncated': start > old, 'lines': [redact(line) for line in lines[-100:]]})
        current[name] = size
    except (OSError, PermissionError) as error:
        result['logs'].append({'path': name, 'error': type(error).__name__})
cursor.write_text(json.dumps(current))
cursor.chmod(0o600)
print(json.dumps(result))
