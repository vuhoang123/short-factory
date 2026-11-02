import asyncio
import importlib.util
import os
from pathlib import Path
from tempfile import TemporaryDirectory
import unittest
from unittest.mock import AsyncMock

os.environ['NODE_ENV'] = 'test'
os.environ['LOCAL_CAPTURE_TOKEN'] = 'local-test-only-token-' * 3
spec = importlib.util.spec_from_file_location('capture_bridge', Path(__file__).with_name('local-capture-server.py'))
bridge = importlib.util.module_from_spec(spec)
spec.loader.exec_module(bridge)


class CaptureBridgeTest(unittest.IsolatedAsyncioTestCase):
    async def asyncSetUp(self):
        self.temporary = TemporaryDirectory(prefix='sf-capture-contract-')
        self.previous = bridge.DATA
        bridge.DATA = Path(self.temporary.name)
        bridge.PROFILES.clear()
        bridge.CAPTURES.clear()
        bridge.CAPTURE_LOCKS.clear()
        self.data = {'workspaceId': '11111111-1111-4111-8111-111111111111', 'userId': '22222222-2222-4222-8222-222222222222', 'jobId': '33333333-3333-4333-8333-333333333333', 'url': 'https://www.facebook.com/owned-fixture/posts/test'}
        self.key, self.directory = bridge.scope(self.data)

    async def asyncTearDown(self):
        bridge.DATA = self.previous
        self.temporary.cleanup()

    async def test_duplicate_waiters_reuse_the_completed_snapshot(self):
        class Post:
            def model_dump(self):
                return {'text': 'Owned synthetic fixture', 'comments': []}
        async def read(*_args, **_kwargs):
            await asyncio.sleep(0.01)
            return Post()
        importer = type('Importer', (), {'context': object(), 'visible': True})()
        importer.read = AsyncMock(side_effect=read)
        bridge.PROFILES[self.key] = importer
        first, second = await asyncio.gather(bridge.operation('capture', self.data), bridge.operation('capture', self.data))
        self.assertEqual(first, second)
        self.assertEqual(importer.read.await_count, 1)
        await bridge.operation('purge', self.data)
        self.assertFalse((self.directory / 'results' / f"{self.data['jobId']}.json").exists())

    async def test_cancel_stops_owned_capture_and_clears_task(self):
        started = asyncio.Event()
        async def read(*_args, **_kwargs):
            started.set()
            await asyncio.Event().wait()
        importer = type('Importer', (), {'context': object(), 'visible': True})()
        importer.read = read
        bridge.PROFILES[self.key] = importer
        task = asyncio.create_task(bridge.operation('capture', self.data))
        await started.wait()
        await bridge.operation('cancel', self.data)
        with self.assertRaises(asyncio.CancelledError):
            await task
        self.assertNotIn((self.key, self.data['jobId']), bridge.CAPTURES)

    async def test_scope_and_image_paths_cannot_escape_the_private_profile(self):
        with self.assertRaises(ValueError):
            bridge.scope({**self.data, 'workspaceId': '../../other-profile'})
        with self.assertRaises(ValueError):
            await bridge.operation('image', {**self.data, 'imageId': '../secret'})


if __name__ == '__main__':
    unittest.main()
