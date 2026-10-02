import importlib.util
from pathlib import Path
import unittest
import asyncio
import json
import socket
import tempfile
from unittest.mock import patch
import numpy as np
from websockets.exceptions import ConnectionClosed

spec = importlib.util.spec_from_file_location('bridge', Path(__file__).resolve().parents[1] / 'scripts/loud_audio_bridge.py')
bridge = importlib.util.module_from_spec(spec); spec.loader.exec_module(bridge)

class BridgeTests(unittest.TestCase):
    def test_origin(self):
        for origin in ['http://localhost:3201', 'http://127.0.0.1:3200', 'https://[::1]']:
            self.assertTrue(bridge.valid_origin(origin))
        for origin in [None, 'null', 'https://evil.example', 'http://localhost.evil.example', 'http://me@localhost']:
            self.assertFalse(bridge.valid_origin(origin))

    def test_queue_alignment_wrap_and_clock_drift(self):
        for drift in [-.0005, .0005]:
            q = bridge.AudioQueue(48000)
            def packet(n): return np.tile(np.array([.1,.2,.3,.4], dtype=np.float32), (n,1)).tobytes()
            q.put(packet(2048))
            incoming = 0.
            for _ in range(20000):
                incoming += 256 * (1 + drift)
                n = int(incoming); incoming -= n
                q.put(packet(n))
                out = q.take(256)
                np.testing.assert_allclose(out[0], [.1,.2,.3,.4], atol=1e-6)
            self.assertEqual(q.underruns, 0); self.assertEqual(q.overruns, 0)
            self.assertLess(q.count, 5000); self.assertGreater(q.count, 256)
            self.assertLess(abs(q.rate_ratio - (1 + drift)), .0003)

    def test_underflow_is_silent_on_every_channel(self):
        q = bridge.AudioQueue(48000)
        q.put(np.ones((2048,4),dtype=np.float32).tobytes())
        q.take(1024)
        self.assertFalse(q.take(2048).any())
        self.assertEqual(q.underruns,1)
        self.assertFalse(q.take(256).any())

    def test_reject_invalid_pcm(self):
        q = bridge.AudioQueue(48000)
        for packet in [b'', b'x', np.full((2,4), np.nan, dtype=np.float32).tobytes()]:
            with self.assertRaises(ValueError): q.put(packet)

    def test_device_identity_and_native_channel_mapping(self):
        device = {'id':4,'name':'Test DJ','api':'ASIO','channels':8}
        config = {'device':4,'deviceName':'Test DJ','api':'ASIO','sampleRate':48000,'masterPair':2,'cuePair':6}
        class Stream:
            def __init__(self, **kw): self.callback = kw['callback']; self.latency = .01
            def start(self): pass
            def abort(self): pass
            def close(self): pass
        with patch.object(bridge,'devices',return_value=[device]), patch.object(bridge.sd,'check_output_settings'), patch.object(bridge.sd,'OutputStream',Stream):
            for invalid in [{'deviceName':'Changed'}, {'masterPair':6}, {'cuePair':8}, {'cuePair':1}]:
                with self.assertRaises(ValueError): bridge.AudioSession({**config,**invalid})
            s = bridge.AudioSession(config)
            s.queue.put(np.tile(np.array([.1,.2,.3,.4],dtype=np.float32),(2048,1)).tobytes())
            out = np.ones((128,8),dtype=np.float32)
            s.stream.callback(out,128,None,type('Status',(),{'output_underflow':False})())
            np.testing.assert_allclose(out[0],[0,0,.1,.2,0,0,.3,.4],atol=1e-6)
            s.close()

class ProtocolTests(unittest.IsolatedAsyncioTestCase):
    async def test_authentication_and_clean_shutdown(self):
        with socket.socket() as sock:
            sock.bind(('127.0.0.1', 0)); port = sock.getsockname()[1]
        with tempfile.TemporaryDirectory() as directory, patch.object(bridge, 'STATE', Path(directory)), patch.object(bridge, 'PORT', port), patch.object(bridge, 'devices', return_value=[]):
            server = asyncio.create_task(bridge.run_server())
            try:
                for _ in range(100):
                    if (Path(directory)/'connection.json').exists(): break
                    await asyncio.sleep(.01)
                await asyncio.sleep(.03)
                token = json.loads((Path(directory)/'connection.json').read_text())['token']
                url = f'ws://127.0.0.1:{port}'
                for origin, credential in [('http://localhost','wrong'), ('https://example.com',token)]:
                    async with bridge.connect(url, origin=origin) as client:
                        try:
                            await client.send(json.dumps({'type':'auth','token':credential}))
                            await client.recv()
                            self.fail('Unauthorised client accepted')
                        except ConnectionClosed:
                            pass
                async with bridge.connect(url, origin='http://localhost:3201') as client:
                    await client.send(json.dumps({'type':'auth','token':token}))
                    response = json.loads(await client.recv())
                    self.assertEqual(response, {'type':'devices','devices':[]})
                    await client.send(json.dumps({'type':'shutdown'}))
                await asyncio.wait_for(server, 3)
            finally:
                if not server.done():
                    server.cancel()
                    try: await server
                    except asyncio.CancelledError: pass

if __name__ == '__main__': unittest.main()
