"""Run the upstream RandLA-Net -> adaptive grid pipeline on a raw LiDAR scan."""

from __future__ import annotations

import argparse
import hashlib
import importlib
import json
import os
from pathlib import Path
import sys
import time
import zipfile

import numpy as np

from convert_frames import GRID_FIELDS, convert_frame

ROOT = Path(__file__).resolve().parents[1]
RUNTIME = Path(os.environ.get("POINT_MATRIX_RUNTIME", ROOT / ".runtime"))
ENGINE_REVISION = "da39fde055f6972647955983f332b7d9c63ee889"
CHECKPOINT_NAME = "randlanet_semantickitti_202201071330utc.pth"
MAX_POINTS = 250_000
MAX_UPLOAD_BYTES = 16 * 1024 * 1024
MAX_RENDER_POINTS = 15_000
MODEL_CONFIG = {
    "name": "RandLANet",
    "batcher": "DefaultBatcher",
    "num_neighbors": 16,
    "num_layers": 4,
    "num_points": 45056,
    "num_classes": 19,
    "ignored_label_inds": [0],
    "sub_sampling_ratio": [4, 4, 4, 4],
    "in_channels": 3,
    "dim_features": 8,
    "dim_output": [16, 64, 128, 256],
    "grid_size": 0.06,
    "augment": {"recenter": {"dim": [0, 1]}},
}


class SetupError(RuntimeError):
    """The server is missing an inference dependency or model artifact."""


def load_raw(path: Path) -> np.ndarray:
    if not 0 < path.stat().st_size <= MAX_UPLOAD_BYTES:
        raise ValueError("Upload must contain data and be no larger than 16 MiB.")
    if path.suffix.lower() == ".bin":
        if path.stat().st_size % 16:
            raise ValueError("A .bin scan must contain float32 X, Y, Z, intensity records.")
        raw = np.fromfile(path, dtype="<f4").reshape(-1, 4)
    elif path.suffix.lower() == ".npy":
        try:
            raw = np.load(path, allow_pickle=False, mmap_mode="r")
        except (ValueError, OSError, EOFError) as exc:
            raise ValueError("Invalid numeric .npy file. Pickled arrays are not accepted.") from exc
    else:
        raise ValueError("Use a raw .bin or .npy point cloud.")
    if raw.ndim != 2 or raw.shape[1] != 4 or raw.dtype.kind not in "fiu":
        raise ValueError("Expected a numeric (N, 4) array: X, Y, Z, intensity.")
    if not 0 < len(raw) <= MAX_POINTS:
        raise ValueError(f"Upload must contain 1 to {MAX_POINTS:,} points.")
    if not np.isfinite(raw).all():
        raise ValueError("Point coordinates and intensity must be finite numbers.")
    if np.max(np.abs(raw[:, :3])) > 1000:
        raise ValueError("Use sensor-local coordinates in meters, within +/-1,000 m.")
    with np.errstate(over="ignore"):
        xyzi = np.array(raw, dtype=np.float32, order="C", copy=True)
    if not np.isfinite(xyzi).all():
        raise ValueError("Input values exceed the float32 range.")
    return xyzi


def validate_predictions(labels, scores, count):
    labels, scores = np.asarray(labels), np.asarray(scores)
    if labels.shape != (count,) or scores.shape != (count, 19):
        raise RuntimeError("Model returned an unexpected prediction shape.")
    if not np.isfinite(labels).all() or not np.equal(labels, np.floor(labels)).all():
        raise RuntimeError("Model returned invalid semantic labels.")
    if np.any(labels < 0) or np.any(labels >= 19):
        raise RuntimeError("Model labels must use the engine's 0-18 class mapping.")
    if not np.isfinite(scores).all() or np.any(scores < 0) or np.any(scores > 1 + 1e-6):
        raise RuntimeError("Model returned invalid confidence scores.")
    return labels.astype(np.int32), np.clip(scores.max(axis=1), 0, 1)


class Runtime:
    """One model instance, used serially by the API's single inference worker."""

    def __init__(self):
        self.model = None
        self.grid = None
        self.checkpoint_hash = None
        self.engine_hash = None
        self.device = os.environ.get("MODEL_DEVICE", "cpu")
        if self.device not in {"cpu", "gpu"}:
            raise SetupError("MODEL_DEVICE must be cpu or gpu.")

    def initialize(self):
        if self.model is not None:
            return
        engine_path = Path(os.environ.get("GRID_ENGINE_PATH", RUNTIME / "AS2.5LM")).resolve()
        checkpoint = Path(os.environ.get("MODEL_CHECKPOINT", RUNTIME / CHECKPOINT_NAME))
        if not (engine_path / "grid_engine" / "pipeline.py").is_file() or not checkpoint.is_file():
            raise SetupError("Engine or checkpoint missing. Run python -m backend.setup_runtime.")
        sys.path.insert(0, str(engine_path))
        digest = hashlib.sha256()
        for module in sorted((engine_path / "grid_engine").glob("*.py")):
            digest.update(module.name.encode("utf-8"))
            digest.update(module.read_bytes())
        self.engine_hash = digest.hexdigest()
        try:
            self.grid = importlib.import_module("grid_engine.pipeline").build_grid_engine
            import open3d.ml.torch as ml3d
            import torch
        except Exception as exc:
            raise SetupError(
                "Cannot load Open3D/PyTorch. Install backend/requirements-model.txt "
                "in a compatible Python 3.11 environment. " + str(exc)
            ) from exc
        if self.device == "gpu" and not torch.cuda.is_available():
            raise SetupError("MODEL_DEVICE=gpu requires an available CUDA GPU.")
        model = ml3d.models.RandLANet(**MODEL_CONFIG)
        pipeline = ml3d.pipelines.SemanticSegmentation(
            model, device=self.device, batch_size=1, test_batch_size=1,
            main_log_dir=str(RUNTIME / "logs"),
        )
        pipeline.load_ckpt(ckpt_path=str(checkpoint))
        with checkpoint.open("rb") as stream:
            self.checkpoint_hash = hashlib.file_digest(stream, "sha256").hexdigest()
        self.model = pipeline

    def predict(self, xyzi):
        # Open3D can recenter the model input; preserve sensor coordinates for the grid.
        result = self.model.run_inference({
            "point": xyzi[:, :3].copy(),
            "feat": None,
            "label": np.zeros(len(xyzi), dtype=np.int32),
        })
        return validate_predictions(result["predict_labels"], result["predict_scores"], len(xyzi))


RERUN_SCRIPT = '''#!/usr/bin/env python3
"""Run from the product_point checkout with the backend environment activated.
Usage: python run_pipeline.py /path/to/raw.bin --output ./live-output
Install/setup instructions: backend/README.md.
"""
from pathlib import Path
import sys

sys.path.insert(0, str(Path.cwd()))
from backend.pipeline import main

if __name__ == "__main__":
    main()
'''


def process_scan(source: Path, output: Path, runtime: Runtime,
                 notify=lambda stage, message: None, source_name: str | None = None):
    started = time.perf_counter()
    output.mkdir(parents=True, exist_ok=True)
    notify("validating", "Validating raw X, Y, Z, intensity points.")
    xyzi = load_raw(source)
    notify("loading_model", "Loading RandLA-Net and the trained checkpoint (first run can take longer).")
    runtime.initialize()
    notify("inference", f"Running RandLA-Net on {len(xyzi):,} uploaded points.")
    inference_start = time.perf_counter()
    labels, confidence = runtime.predict(xyzi)
    inference_seconds = time.perf_counter() - inference_start
    classified = np.column_stack((xyzi[:, :3], labels, confidence, xyzi[:, 3])).astype(np.float32)
    classified_path = output / "classified.npy"
    np.save(classified_path, classified, allow_pickle=False)

    notify("grid", "Building the adaptive grid from the new semantic predictions.")
    grid_start = time.perf_counter()
    result = runtime.grid(str(classified_path), verbose=False)
    grid_seconds = time.perf_counter() - grid_start
    cells = result["final_cells"]
    if not len(cells):
        raise RuntimeError("Grid engine returned no cells.")
    missing = set(GRID_FIELDS).difference(cells.dtype.names or ())
    if missing or any(not np.isfinite(cells[field]).all() for field in GRID_FIELDS):
        raise RuntimeError("Grid engine returned invalid cell data.")
    np.savez_compressed(output / "grid.npz", final_cells=cells)

    notify("exporting", "Preparing the visualizations, report and output files.")
    frames = output / "frames"
    for folder in ("grid", "points", "meta"):
        (frames / folder).mkdir(parents=True, exist_ok=True)
    meta, classes = convert_frame(
        "upload", output / "grid.npz", classified_path, frames,
        MAX_RENDER_POINTS, 42, "binary",
    )
    # Include classes present in points even if semantic fusion removed them from the grid.
    classes.update(int(label) for label in np.unique(labels))
    (frames / "manifest.json").write_text(json.dumps({
        "frames": ["upload"], "grid_format": "binary",
        "grid_fields": GRID_FIELDS, "semantic_classes": sorted(classes),
    }))
    report = {
        "source": source_name or source.name,
        "model": "Open3D RandLA-Net / SemanticKITTI",
        "checkpoint_sha256": runtime.checkpoint_hash,
        "device": runtime.device,
        "engine_baseline_revision": ENGINE_REVISION,
        "engine_source_sha256": runtime.engine_hash,
        "meta": meta,
        "timings_seconds": {
            "inference": inference_seconds, "grid": grid_seconds,
            "total": time.perf_counter() - started,
        },
        "grid_stages_seconds": result["timings"],
        "semantic_classes": sorted(classes),
        "classified_columns": ["x", "y", "z", "label", "confidence", "intensity"],
        "grid_preview": [
            {field: cell[field].item() for field in GRID_FIELDS} for cell in cells[:5]
        ],
    }
    (output / "report.json").write_text(json.dumps(report, indent=2, allow_nan=False))
    (output / "run_pipeline.py").write_text(RERUN_SCRIPT)
    with zipfile.ZipFile(output / "outputs.zip", "w", zipfile.ZIP_DEFLATED) as archive:
        for name in ("classified.npy", "grid.npz", "report.json", "run_pipeline.py"):
            archive.write(output / name, name)
    notify("complete", f"Finished: {len(xyzi):,} points, {len(cells):,} adaptive cells.")
    return report


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("input", type=Path)
    parser.add_argument("--output", type=Path, required=True)
    args = parser.parse_args()
    process_scan(args.input, args.output, Runtime(), lambda stage, message: print(f"[{stage}] {message}"))


if __name__ == "__main__":
    main()
