# Grid Engine Dashboard

Static React visualization of classified LiDAR points and their synchronized variable-resolution 2.5D grid projection.

## Run

From this directory:

```bash
npm install
npm run dev
```

Create a production build with `npm run build`.

## Rebuild frame assets

From the repository root:

```bash
python3 convert_frames.py
```

The converter defaults to all 1,000 frames from `001000` through `001999`, exports at most 15,000 points per frame, and writes compact binary grids to `dashboard/public/frames`. Run `python3 convert_frames.py --help` for source, range, cadence, point-limit, and format options.
