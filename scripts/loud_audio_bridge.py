"""Optional local ASIO/WASAPI/Core Audio output host. No music files or input capture.

Run with --list to inspect outputs or --serve to host the authenticated loopback
bridge. The pairing token is written to the user's local state directory, never
the source checkout. The browser sends four float32 channels: master L/R, cue L/R.
"""
import argparse
import asyncio
import hmac
import json
import logging
import os
from pathlib import Path
import secrets
import threading
from urllib.parse import urlparse

os.environ.setdefault("SD_ENABLE_ASIO", "1")
import numpy as np
import sounddevice as sd
from websockets.asyncio.server import serve
from websockets.asyncio.client import connect

PORT = 17840
STATE = Path(os.environ.get("LOCALAPPDATA", str(Path.home() / ".local" / "share"))) / "Loud" / "audio-bridge"

def valid_origin(origin):
    try:
        url = urlparse(origin or "")
        return url.scheme in {"http", "https"} and url.hostname in {"localhost", "127.0.0.1", "::1"} and not url.username and not url.password
    except ValueError:
        return False

def devices():
    apis = sd.query_hostapis()
    return [{"id": i, "name": d["name"], "api": apis[d["hostapi"]]["name"],
             "channels": int(d["max_output_channels"]), "sampleRate": d["default_samplerate"]}
            for i, d in enumerate(sd.query_devices()) if d["max_output_channels"] >= 2]

class AudioQueue:
    """Bounded four-channel FIFO; one queue preserves master/cue alignment."""
    def __init__(self, sample_rate, capacity=None):
        self.capacity = capacity or int(sample_rate // 4)
        self.data = np.zeros((self.capacity, 4), dtype=np.float32)
        self.read = self.write = self.count = 0
        self.target = min(2048, self.capacity // 2)
        self.sample_rate = sample_rate
        self.fraction = 0.0
        self.filtered_fill = float(self.target)
        self.rate_ratio = 1.0
        self.primed = False
        self.underruns = self.overruns = self.callback_errors = 0
        self.lock = threading.Lock()

    def put(self, packet):
        if len(packet) % 16 or not 0 < len(packet) <= 65536:
            raise ValueError("Invalid four-channel PCM packet")
        audio = np.frombuffer(packet, dtype="<f4").reshape(-1, 4)
        if not np.isfinite(audio).all(): raise ValueError("Non-finite PCM samples")
        with self.lock:
            if len(audio) > self.capacity - self.count:
                # Drop stale audio rather than let monitor delay grow indefinitely.
                self.read = self.write = self.count = 0; self.primed = False; self.fraction = 0.; self.overruns += 1
            n = len(audio)
            if n > self.capacity: raise ValueError("PCM packet exceeds queue capacity")
            first = min(n, self.capacity - self.write)
            self.data[self.write:self.write + first] = audio[:first]
            self.data[:n - first] = audio[first:]
            self.write = (self.write + n) % self.capacity; self.count += n

    def take(self, frames):
        result = np.zeros((frames, 4), dtype=np.float32)
        with self.lock:
            if not self.primed:
                if self.count < max(self.target, frames + 2): return result
                self.primed = True
                self.filtered_fill = float(self.target)
            # Browser and native DAC clocks are independent. A slow, bounded
            # common resampler prevents their ppm drift draining the FIFO.
            # All four channels use identical positions, preserving deck/cue phase.
            smoothing = min(1., frames / (self.sample_rate * 2.))
            self.filtered_fill += smoothing * (self.count - self.filtered_fill)
            self.rate_ratio = 1. + float(np.clip((self.filtered_fill - self.target) / self.sample_rate * .08, -.003, .003))
            positions = self.fraction + np.arange(frames) * self.rate_ratio
            indices = positions.astype(np.int64)
            consumed_float = self.fraction + frames * self.rate_ratio
            consumed = int(consumed_float)
            needed = max(consumed, int(indices[-1]) + 2)
            if self.count < needed:
                self.underruns += 1; self.primed = False
                # All four channels restart together after a dropout.
                self.read = self.write = self.count = 0; self.fraction = 0.
                return result
            weight = (positions - indices)[:, None]
            left = self.data[(self.read + indices) % self.capacity]
            right = self.data[(self.read + indices + 1) % self.capacity]
            result[:] = left + (right - left) * weight
            self.fraction = consumed_float - consumed
            self.read = (self.read + consumed) % self.capacity; self.count -= consumed
        return result

class AudioSession:
    def __init__(self, config):
        available = devices()
        device = next((d for d in available if d["id"] == config.get("device") and d["name"] == config.get("deviceName") and d["api"] == config.get("api")), None)
        if device is None: raise ValueError("Device changed; refresh native outputs and select it again")
        rate = config.get("sampleRate")
        master, cue = config.get("masterPair"), config.get("cuePair")
        if rate not in {44100, 48000, 88200, 96000, 176400, 192000}: raise ValueError("Unsupported sample rate")
        if any(type(p) is not int or p < 0 or p % 2 or p + 2 > device["channels"] for p in [master, cue]) or master == cue:
            raise ValueError("Master and cue require distinct available stereo pairs")
        self.queue = AudioQueue(rate)
        self.rate = rate
        self.channels = max(master, cue) + 2
        def callback(outdata, frames, time_info, status):
            outdata.fill(0)
            try:
                if status.output_underflow: self.queue.underruns += 1
                audio = self.queue.take(frames)
                outdata[:, master:master + 2] = audio[:, :2]
                outdata[:, cue:cue + 2] = audio[:, 2:]
            except Exception:
                outdata.fill(0); self.queue.callback_errors += 1
        sd.check_output_settings(device=device["id"], channels=self.channels, dtype="float32", samplerate=rate)
        self.stream = sd.OutputStream(device=device["id"], channels=self.channels, samplerate=rate,
                                      dtype="float32", blocksize=0, latency="low", callback=callback)
        try: self.stream.start()
        except Exception:
            self.stream.close()
            raise

    def close(self):
        self.stream.abort(); self.stream.close()

    def status(self):
        return {"type": "status", "queuedFrames": self.queue.count, "sampleRate": self.rate,
                "underruns": self.queue.underruns, "overruns": self.queue.overruns,
                "callbackErrors": self.queue.callback_errors, "clockRatio": self.queue.rate_ratio, "deviceLatency": self.stream.latency}

async def run_server():
    STATE.mkdir(parents=True, exist_ok=True)
    token = secrets.token_urlsafe(32)
    connection_file = STATE / "connection.json"
    connection_file.write_text(json.dumps({"url": f"ws://127.0.0.1:{PORT}", "token": token}, indent=2), encoding="utf-8")
    try: connection_file.chmod(0o600)
    except OSError: pass
    owner = None
    stopping = asyncio.Event()
    async def handler(ws):
        nonlocal owner
        audio = None
        try:
            if not valid_origin(ws.request.headers.get("Origin")):
                await ws.close(1008, "Use the local Loud page"); return
            first = await asyncio.wait_for(ws.recv(), 5)
            auth = json.loads(first) if isinstance(first, str) else {}
            if auth.get("type") != "auth" or not isinstance(auth.get("token"), str) or not hmac.compare_digest(auth["token"], token):
                await ws.close(1008, "Pairing failed"); return
            await ws.send(json.dumps({"type": "devices", "devices": devices()}))
            last_status = 0
            async for message in ws:
                if isinstance(message, bytes):
                    if audio is None: raise ValueError("Configure before sending audio")
                    audio.queue.put(message)
                    now = asyncio.get_running_loop().time()
                    if now - last_status >= 1:
                        await ws.send(json.dumps(audio.status())); last_status = now
                    continue
                cmd = json.loads(message)
                if cmd.get("type") == "configure":
                    if owner is not None and owner is not ws: raise ValueError("Another Loud tab owns the audio device")
                    if audio: audio.close(); audio = None
                    owner = ws
                    audio = AudioSession(cmd)
                    await ws.send(json.dumps({**audio.status(), "type": "ready"}))
                elif cmd.get("type") == "shutdown":
                    stopping.set(); return
                else: raise ValueError("Unknown bridge command")
        except Exception as error:
            logging.warning("Bridge session stopped: %s", type(error).__name__)
            try: await ws.send(json.dumps({"type": "error", "message": str(error)}))
            except Exception: pass
        finally:
            if audio: audio.close()
            if owner is ws: owner = None
    async with serve(handler, "127.0.0.1", PORT, max_size=65536, max_queue=8, compression=None, ping_interval=10, ping_timeout=10):
        logging.info("Local audio bridge listening on 127.0.0.1:%s", PORT)
        await stopping.wait()

async def stop_server():
    config = json.loads((STATE / "connection.json").read_text(encoding="utf-8"))
    async with connect(f"ws://127.0.0.1:{PORT}", origin="http://localhost") as ws:
        await ws.send(json.dumps({"type": "auth", "token": config["token"]}))
        await ws.recv()
        await ws.send(json.dumps({"type": "shutdown"}))

if __name__ == "__main__":
    parser = argparse.ArgumentParser(); parser.add_argument("--list", action="store_true"); parser.add_argument("--serve", action="store_true"); parser.add_argument("--stop", action="store_true")
    args = parser.parse_args()
    if args.list: print(json.dumps(devices(), indent=2))
    elif args.stop: asyncio.run(stop_server())
    elif args.serve:
        STATE.mkdir(parents=True, exist_ok=True)
        logging.basicConfig(filename=STATE / "bridge.log", level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")
        asyncio.run(run_server())
    else: parser.print_help()
