# Grid Engine Dashboard

React visualization with raw LiDAR upload, live DL/grid processing and an optional
saved demo. See [backend setup](../backend/README.md) for the inference service.

## Run

From this directory:

```bash
npm install
npm run dev
```

Create a production build with `npm run build`.

Local `/api` requests proxy to port 8000. For a deployed backend, set
`VITE_API_URL` before building (see `.env.example`).

## GitHub Pages

The repository includes a GitHub Actions workflow that deploys the dashboard to
GitHub Pages. That build sets `VITE_ENABLE_DEMO=false` and expects a repository
variable named `VITE_API_URL` when you want uploads to talk to a public backend.
The Python inference service itself cannot run on GitHub Pages.

## Rebuild frame assets

From the repository root:

```bash
python3 convert_frames.py
```

The converter defaults to all 1,000 frames from `001000` through `001999`, exports at most 15,000 points per frame, and writes compact binary grids to `dashboard/public/frames`. Run `python3 convert_frames.py --help` for source, range, cadence, point-limit, and format options.
