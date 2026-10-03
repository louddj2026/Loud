"""Launch the optional bridge silently; logs and pairing details stay local."""
from pathlib import Path
import json
import os
import socket
import subprocess
import time

app = Path(__file__).resolve().parent.parent
configured = os.environ.get("CROWD_ANALYSIS_RUNTIME")
runtime_candidates = [app / ".audio-bridge"]
if configured:
    runtime_candidates.append(Path(configured) / "env")
runtime_candidates.append(app.parent / "analysis" / "env")
runtime = next((candidate for candidate in runtime_candidates if candidate.exists()), runtime_candidates[0])
python = runtime / ("Scripts/pythonw.exe" if os.name == "nt" else "bin/python")
state = Path(os.environ.get("LOCALAPPDATA", str(Path.home() / ".local" / "share"))) / "Loud" / "audio-bridge"
if not python.exists(): raise SystemExit("The bundled audio runtime is missing; repair Loud or see docs/AUDIO-HARDWARE.md.")
with socket.socket() as probe:
    if probe.connect_ex(("127.0.0.1", 17840)) == 0: raise SystemExit("Port 17840 is already in use. If Loud's bridge is running, use its existing connection.json.")
state.mkdir(parents=True, exist_ok=True)
with (state / "launcher.log").open("a", encoding="utf-8") as log:
    child = subprocess.Popen([str(python), str(app / "scripts/loud_audio_bridge.py"), "--serve"],
                             cwd=app, stdin=subprocess.DEVNULL, stdout=log, stderr=subprocess.STDOUT,
                             creationflags=subprocess.CREATE_NO_WINDOW if os.name == "nt" else 0,
                             start_new_session=os.name != "nt")
    (state / "process.json").write_text(json.dumps({"pid": child.pid}), encoding="utf-8")
    for _ in range(40):
        if child.poll() is not None: raise SystemExit("Bridge stopped during startup. See " + str(state / "launcher.log"))
        with socket.socket() as probe:
            if probe.connect_ex(("127.0.0.1", 17840)) == 0:
                print("Bridge ready. Import pairing file in Loud Audio Outputs: " + str(state / "connection.json")); break
        time.sleep(.25)
    else: raise SystemExit("Bridge startup timed out. Check " + str(state / "launcher.log"))
