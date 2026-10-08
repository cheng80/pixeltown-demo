#!/usr/bin/env python3
"""First install only: isolated minimal backend; never alter legacy services."""
import json, os, pathlib, plistlib, subprocess, urllib.request, time
from minimal_services import LABELS, plist_path, write_definitions, launch, wait_ready
home=pathlib.Path.home();root=home/'Servers/pixeltown-minimal';app=root/'app'
node=home/'Servers/pixeltown-colyseus/runtime/bin/node';binary=home/'Servers/pixeltown/pocketbase'
label='com.fastmake.pixeltown.minimal';plist=home/f'Library/LaunchAgents/{label}.plist'
if not app.is_dir() or not node.is_file() or not binary.is_file():raise SystemExit('Missing staged app or existing runtime')
if (root/'.env').exists() or (app/'.local').exists() or plist.exists() or any(plist_path(value).exists() for value in LABELS.values()):raise SystemExit('Existing minimal installation found; no restart or overwrite performed')
for port in (18820,13620,5270):
 if subprocess.run(['lsof','-ti',f'TCP:{port}','-sTCP:LISTEN'],capture_output=True,text=True).stdout.strip():raise SystemExit(f'Port {port} occupied; no process stopped')
env=dict(os.environ);env['PATH']=str(node.parent)+os.pathsep+env.get('PATH','')
subprocess.run(['npm','ci','--include=dev','--no-audit','--no-fund'],cwd=app/'colyseus',env=env,check=True,stdout=subprocess.DEVNULL)
(app/'node_modules').symlink_to('colyseus/node_modules',target_is_directory=True)
settings={
 'NODE_ENV':'production','MINIMAL_BACKEND_ONLY':'1','MINIMAL_PUBLIC_MODE':'1',
 'MINIMAL_PB_PORT':'18820','MINIMAL_GAME_PORT':'13620','MINIMAL_WEB_PORT':'5270',
 'MINIMAL_PB_BINARY':str(binary),
 'MINIMAL_PUBLIC_ORIGINS':'https://pixeltown.fastmake.net,https://pixeltown-4x2.pages.dev',
}
fd=os.open(root/'.env',os.O_WRONLY|os.O_CREAT|os.O_EXCL,0o600)
with os.fdopen(fd,'w') as f:f.write(''.join(f'{k}={v}\n' for k,v in settings.items()))
write_definitions()
launch('bootstrap', LABELS['pb']);wait_ready(18820, '/api/health')
launch('bootstrap', LABELS['game']);health=wait_ready(13620, '/ready')
print(json.dumps({'ready':True,'services':LABELS,'root':str(root),'ports':{'pb':18820,'game':13620},'health':health}))
