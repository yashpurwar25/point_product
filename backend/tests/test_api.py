import io
from pathlib import Path
from tempfile import TemporaryDirectory
from threading import Event
import time
import unittest
from unittest.mock import patch

from fastapi.testclient import TestClient
import numpy as np

import backend.app as server
from backend.pipeline import MAX_UPLOAD_BYTES, SetupError
from test_pipeline import PredictableRuntime, example_scan


class ApiTests(unittest.TestCase):
    def setUp(self):
        self.temp = TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.patcher = patch.object(server, "RUNTIME", Path(self.temp.name))
        self.patcher.start()
        self.addCleanup(self.patcher.stop)
        self.client = TestClient(server.app)
        self.client.__enter__()
        self.addCleanup(lambda: self.client.__exit__(None, None, None))
        self.store = server.app.state.jobs
        self.store.runtime = PredictableRuntime()

    def submit(self, points=None):
        stream = io.BytesIO()
        np.save(stream, example_scan() if points is None else points)
        response = self.client.post("/api/jobs?filename=scan.npy", content=stream.getvalue())
        self.assertEqual(response.status_code, 202, response.text)
        return response.json()["id"]

    def wait(self, key):
        deadline = time.monotonic() + 5
        while time.monotonic() < deadline:
            response = self.client.get(f"/api/jobs/{key}")
            self.assertEqual(response.status_code, 200, response.text)
            job = response.json()
            if job["stage"] in {"complete", "failed"}:
                return job
            time.sleep(0.01)
        self.fail("Job did not finish")

    def test_upload_to_download(self):
        key = self.submit()
        self.assertEqual(self.wait(key)["stage"], "complete")
        for name in server.ARTIFACTS:
            response = self.client.get(f"/api/jobs/{key}/files/{name}")
            self.assertEqual(response.status_code, 200, name)
            self.assertGreater(len(response.content), 0)
        result = self.client.get(f"/api/jobs/{key}/files/classified.npy")
        report = self.client.get(f"/api/jobs/{key}/files/report.json").json()
        self.assertEqual(report["source"], "scan.npy")
        points = np.load(io.BytesIO(result.content), allow_pickle=False)
        np.testing.assert_array_equal(points[:, :3], example_scan()[:, :3])
        self.assertEqual(self.client.get(f"/api/jobs/{key}/files/input.npy").status_code, 404)
        self.assertEqual(self.client.get("/api/jobs/nonexistent").status_code, 404)

    def test_limits_and_formats(self):
        self.assertEqual(self.client.post("/api/jobs?filename=test.csv", content=b"x").status_code, 415)
        self.assertEqual(self.client.post("/api/jobs?filename=test.bin", content=b"").status_code, 400)
        self.assertEqual(self.client.post("/api/jobs?filename=test.bin", content=b"x",
                                         headers={"content-length": str(MAX_UPLOAD_BYTES + 1)}).status_code, 413)
        # No Content-Length, so the streamed limit must also be enforced.
        chunks = iter([b"x" * (1024 * 1024)] * 17)
        self.assertEqual(self.client.post("/api/jobs?filename=test.bin", content=chunks).status_code, 413)
        self.assertFalse(self.client.get("/api/health").json()["busy"])

    def test_invalid_scan_produces_failed_job_without_outputs(self):
        key = self.submit(np.zeros((10, 6)))
        job = self.wait(key)
        self.assertEqual(job["stage"], "failed")
        self.assertIn("(N, 4)", job["error"])
        self.assertEqual(self.client.get(f"/api/jobs/{key}/files/grid.npz").status_code, 409)

    def test_missing_model_does_not_return_demo(self):
        with patch.object(self.store.runtime, "initialize", side_effect=SetupError("Checkpoint missing")):
            job = self.wait(self.submit())
        self.assertEqual(job["stage"], "failed")
        self.assertEqual(job["error"], "Checkpoint missing")

    def test_busy_worker_rejects_second_upload(self):
        entered, release = Event(), Event()
        initialize = self.store.runtime.initialize

        def hold():
            entered.set()
            release.wait(5)
            initialize()

        with patch.object(self.store.runtime, "initialize", side_effect=hold):
            try:
                key = self.submit()
                self.assertTrue(entered.wait(2))
                self.assertEqual(self.client.post("/api/jobs?filename=test.bin", content=b"x").status_code, 429)
            finally:
                release.set()
            self.assertEqual(self.wait(key)["stage"], "complete")

    def test_expired_job_is_removed(self):
        key = self.submit()
        self.wait(key)
        # Wait for worker cleanup following the completion notification.
        self.store.executor.shutdown(wait=True)
        directory = self.store.jobs[key].directory
        with self.store.lock:
            self.store.jobs[key].finished = time.time() - server.RESULT_TTL - 1
        self.assertEqual(self.client.get(f"/api/jobs/{key}").status_code, 404)
        self.assertFalse(directory.exists())


if __name__ == "__main__":
    unittest.main()
