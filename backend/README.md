# Live inference backend

Uploads run the inference approach from
[AS2.5LM](https://github.com/point-matrix/AS2.5LM), revision
`da39fde055f6972647955983f332b7d9c63ee889`: Open3D RandLA-Net with the
SemanticKITTI checkpoint referenced in `raw-inference-script.ipynb`, followed by
the repository's `grid_engine.pipeline.build_grid_engine`.
There is no simulated prediction or saved-frame fallback.

## Setup

Run from the repository root. Use Python 3.11 on Linux x86_64 for the pinned
Open3D 0.19 / PyTorch 2.2.2 stack. Python 3.14 is not compatible with these pins.
On Apple Silicon, use a Linux amd64 container or a remote Linux inference host;
Docker's amd64 emulation can be slow.

```bash
python3.11 -m venv .venv
source .venv/bin/activate
pip install -r backend/requirements-model.txt
python -m backend.setup_runtime
uvicorn backend.app:app --host 127.0.0.1 --port 8000 --workers 1
```

Setup fetches the upstream engine and the official checkpoint into `.runtime`.
It applies `backend/patches/quadtree-capacity.patch`: the upstream allocation
allows only twice the input cell count, but sparse clouds can require an
ancestor for each leaf at every level. The patch reserves enough nodes for
that case. It does not change the grid algorithm. For an existing custom
`GRID_ENGINE_PATH`, apply the patch to that checkout before running the service.
Reports include a source hash of the loaded engine for reproducibility.
If the engine repo requires access, authenticate Git on the backend host first.
The model loads once on the first request and is reused. The default is CPU;
set `MODEL_DEVICE=gpu` for a host with compatible CUDA drivers and PyTorch CUDA.
Initial model loading and CPU inference can take substantially longer than the
example dataset's historical benchmarks.

Start the dashboard separately:

```bash
cd dashboard
npm ci
npm run dev
```

The Vite server proxies `/api` to `127.0.0.1:8000`. Choose a scan, then click
**Run model + grid**. **View saved demo** explicitly loads the existing assets.

## Input and output

- `.bin`: little-endian float32 records `[X, Y, Z, intensity]` (KITTI/Velodyne).
- `.npy`: a numeric `(N, 4)` array with the same columns. Six-column classified
  output files are intentionally rejected as raw input.
- Coordinates must be sensor-local meters within +/-1,000 m. Nonfinite values,
  empty scans, object arrays, scans above 250,000 points and uploads over 16 MiB
  are rejected. One upload is one frame.
- All uploaded points undergo inference and grid processing. Only the point
  visualization is sampled to 15,000 points. The complete grid is displayed.
- `classified.npy`: full `[X, Y, Z, label, confidence, intensity]` predictions.
- `grid.npz`: structured `final_cells`, including all upstream grid fields.
- `report.json`: actual timings, checkpoint hash, class IDs, statistics and
  a five-cell preview.
- `run_pipeline.py`: a CLI entrypoint to rerun the same pipeline from this
  checkout with the backend environment activated; it is not a standalone model.
- `outputs.zip`: the four output files above. Raw uploads are deleted after
  processing and are not included in this archive.

Class IDs are 0-18, matching the upstream grid engine and the dashboard palette.
The model configuration mirrors Open3D-ML's
[RandLA-Net SemanticKITTI config](https://github.com/isl-org/Open3D-ML/blob/main/ml3d/configs/randlanet_semantickitti.yml).
The notebook uses the published trained checkpoint; uploading runs inference,
not model training. Set `MODEL_CHECKPOINT` to use a different trusted checkpoint
with the same architecture and class ordering.

You can also run without the UI:

```bash
python -m backend.pipeline /path/to/scan.bin --output ./live-output
```

## Deployment

The existing Render site is static and cannot execute Python inference.
Deploy this backend on a separate Linux host and set `VITE_API_URL` when
building the dashboard, for example `https://your-inference-host.example`.
Set backend `CORS_ORIGINS` to the dashboard's exact HTTPS origin. A dashboard
rebuild is required after changing a Vite environment variable.

Container option, from the repository root:

```bash
docker build --platform linux/amd64 -f backend/Dockerfile -t point-matrix-api .
docker run --platform linux/amd64 --rm -p 8000:8000 \
  -e CORS_ORIGINS=http://localhost:5173 \
  -v point-matrix-runtime:/app/.runtime point-matrix-api
```

The engine/checkpoint are fetched on startup if missing; the mounted volume
retains them. For a private upstream repository, provision the runtime volume
using authenticated Git before starting the container. Do not bake credentials
into the image.

Configuration:

| Variable | Default | Purpose |
| --- | --- | --- |
| `POINT_MATRIX_RUNTIME` | `.runtime` in checkout | Engine, weights and transient jobs |
| `MODEL_DEVICE` | `cpu` | Open3D `cpu` or `gpu` |
| `MODEL_CHECKPOINT` | Published checkpoint in runtime | Trusted local model weights |
| `GRID_ENGINE_PATH` | `.runtime/AS2.5LM` | Existing upstream engine checkout |
| `CORS_ORIGINS` | Local Vite origins | Comma-separated allowed browser origins |
| `VITE_API_URL` | Same origin | Dashboard build-time API URL |

Use **one Uvicorn worker and one service instance per runtime directory**.
Inference is serial to avoid simultaneous use of the model. Additional uploads
receive HTTP 429 while it is busy. The last four completed jobs are retained
for up to one hour; cleanup happens on subsequent requests/jobs and restart.
Job IDs are opaque download capabilities, not user authentication. For a
public service, put access control and request limits at the reverse proxy;
CORS alone does not restrict who can submit jobs.

`GET /api/health` reports service availability and whether the model is loaded;
it does not claim that the checkpoint/dependencies have passed inference.
Model setup errors are shown in the upload panel, with no demo substituted.
Jobs are transient and do not survive a backend restart or page reload.
If polling loses its connection, **Reconnect** checks the same job without
rerunning inference. **Dismiss job** stops tracking it but does not cancel
processing on the server.

## Checks

```bash
pip install -r backend/requirements.txt
python -m unittest discover -s backend/tests -v
GRID_ENGINE_PATH=/path/to/AS2.5LM python -m unittest discover -s backend/tests -v
```

The tests inject deterministic predictions to check orchestration, validation,
downloads and job errors. With `GRID_ENGINE_PATH`, a separate integration test
runs the actual upstream grid. These checks do not verify the DL runtime;
verify the full model on the deployment host with a real raw scan.
