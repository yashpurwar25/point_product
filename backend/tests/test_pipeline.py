import importlib
import json
import os
from pathlib import Path
import sys
from tempfile import TemporaryDirectory
import unittest
import zipfile

import numpy as np

from backend.pipeline import (
    MAX_POINTS, MAX_RENDER_POINTS, Runtime, load_raw, process_scan, validate_predictions,
)
from convert_frames import GRID_FIELDS


def example_scan(count=32):
    rng = np.random.default_rng(13)
    scan = rng.uniform(-10, 10, (count, 4)).astype("<f4")
    scan[:, 3] = rng.random(count)
    return scan


class PredictableRuntime:
    """Orchestration test double, never used by the production service."""

    device = "test"
    checkpoint_hash = "test-only"
    engine_hash = "test-only"
    model = None

    def initialize(self):
        self.model = self

    def predict(self, xyzi):
        return (xyzi[:, 0] >= 0).astype(np.int32), np.full(len(xyzi), 0.8)

    def grid(self, path, verbose=False):
        classified = np.load(path, allow_pickle=False)
        cells = np.zeros(2, dtype=[(name, "<f8") for name in GRID_FIELDS])
        cells["semantic_class"] = [0, 1]
        cells["resolution"] = 0.5
        cells["x_min"] = [0, 0.5]
        cells["x_max"] = [0.5, 1]
        cells["y_max"] = 0.5
        cells["semantic_confidence"] = 0.8
        cells["point_count"] = np.bincount(classified[:, 3].astype(int), minlength=2)
        return {"final_cells": cells, "timings": {"total": 0.001}}


class InputTests(unittest.TestCase):
    def setUp(self):
        self.temp = TemporaryDirectory()
        self.root = Path(self.temp.name)
        self.addCleanup(self.temp.cleanup)

    def save(self, data):
        path = self.root / "scan.npy"
        np.save(path, data)
        return path

    def test_bin_and_npy_have_same_input(self):
        scan = example_scan()
        binary = self.root / "scan.bin"
        scan.tofile(binary)
        np.testing.assert_array_equal(load_raw(binary), load_raw(self.save(scan)))

    def test_bad_shapes_types_and_nonfinite_values(self):
        for data in (
            np.zeros((0, 4)), np.zeros((3, 6)), np.zeros(4),
            np.full((2, 4), np.nan), np.full((2, 4), np.inf),
            np.full((2, 4), 1001), np.full((2, 4), "a"),
            np.zeros((2, 4), dtype=complex), np.zeros((MAX_POINTS + 1, 4), dtype=np.float32),
        ):
            with self.subTest(shape=data.shape, dtype=data.dtype), self.assertRaises(ValueError):
                load_raw(self.save(data))

    def test_object_array_and_truncated_npy_rejected(self):
        with self.assertRaises(ValueError):
            load_raw(self.save(np.array([{"point": 1}], dtype=object)))
        path = self.root / "broken.npy"
        path.write_bytes(b"\x93NUMPYbad")
        with self.assertRaises(ValueError):
            load_raw(path)

    def test_bad_binary_length_and_empty_file(self):
        path = self.root / "scan.bin"
        for content in (b"", b"123", b"12345"):
            path.write_bytes(content)
            with self.assertRaises(ValueError):
                load_raw(path)

    def test_prediction_contract(self):
        labels = np.array([0, 18])
        scores = np.full((2, 19), 0.5)
        actual_labels, confidence = validate_predictions(labels, scores, 2)
        np.testing.assert_array_equal(actual_labels, labels)
        np.testing.assert_array_equal(confidence, [0.5, 0.5])
        for bad_labels, bad_scores in (
            ([0, 19], scores), ([0.5, 1], scores), ([0], scores),
            ([0, 1], np.zeros((2, 20))), ([0, 1], np.full((2, 19), np.nan)),
            ([0, 1], np.full((2, 19), -1)),
        ):
            with self.assertRaises(RuntimeError):
                validate_predictions(bad_labels, bad_scores, 2)

    def test_model_recentering_does_not_change_grid_coordinates(self):
        raw = example_scan()
        before = raw.copy()

        class MutatingModel:
            def run_inference(self, data):
                data["point"][:] = 0
                return {"predict_labels": np.zeros(len(raw)),
                        "predict_scores": np.full((len(raw), 19), 1 / 19)}

        runtime = Runtime()
        runtime.model = MutatingModel()
        runtime.predict(raw)
        np.testing.assert_array_equal(raw, before)

    def test_export_uses_uploaded_points_and_keeps_full_download(self):
        scan = example_scan(MAX_RENDER_POINTS + 5)
        source = self.save(scan)
        output = self.root / "result"
        stages = []
        report = process_scan(source, output, PredictableRuntime(),
                              lambda stage, message: stages.append(stage))
        classified = np.load(output / "classified.npy", allow_pickle=False)
        np.testing.assert_array_equal(classified[:, :3], scan[:, :3])
        np.testing.assert_array_equal(classified[:, 5], scan[:, 3])
        np.testing.assert_array_equal(classified[:, 3], (scan[:, 0] >= 0).astype(int))
        self.assertEqual(report["meta"]["exported_points"], MAX_RENDER_POINTS)
        self.assertEqual(report["meta"]["total_input_points"], len(scan))
        self.assertEqual((output / "frames/points/upload_points.bin").stat().st_size,
                         MAX_RENDER_POINTS * 4 * 4)
        self.assertEqual(stages, ["validating", "loading_model", "inference", "grid", "exporting", "complete"])
        self.assertEqual(json.loads((output / "frames/manifest.json").read_text())["frames"], ["upload"])
        with zipfile.ZipFile(output / "outputs.zip") as archive:
            self.assertEqual(set(archive.namelist()),
                             {"classified.npy", "grid.npz", "report.json", "run_pipeline.py"})

    @unittest.skipUnless(os.environ.get("GRID_ENGINE_PATH"), "Set GRID_ENGINE_PATH for the real grid integration")
    def test_real_upstream_grid(self):
        sys.path.insert(0, os.environ["GRID_ENGINE_PATH"])
        grid = importlib.import_module("grid_engine.pipeline").build_grid_engine
        runtime = PredictableRuntime()
        runtime.grid = grid
        output = self.root / "real-grid"
        report = process_scan(self.save(example_scan(256)), output, runtime)
        self.assertGreater(report["meta"]["total_cells"], 0)
        self.assertEqual(report["meta"]["total_input_points"], 256)
        cells = np.load(output / "grid.npz", allow_pickle=False)["final_cells"]
        for field in GRID_FIELDS:
            self.assertTrue(np.isfinite(cells[field]).all(), field)


if __name__ == "__main__":
    unittest.main()
