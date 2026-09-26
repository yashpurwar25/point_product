# Point Matrix

React dashboard for uploading raw LiDAR scans, running RandLA-Net and the
AS2.5LM grid engine, and viewing the generated point cloud and grid. The
1,000 saved classified frames remain available as an explicit demo.

## Live processing

Set up and start the Python inference service using [backend/README.md](backend/README.md).
Then start the dashboard below, choose a raw `.bin` or `(N, 4)` `.npy` scan,
and click **Run model + grid**. The dashboard displays processing stages,
generated visualizations, output data and a rerun script.

## Local development

```bash
cd dashboard
npm ci
npm run dev
```

## Production build

```bash
cd dashboard
npm ci
npm run build
```

## Render deployment

This repository includes a Render Blueprint in `render.yaml`.

1. In Render, select **New > Blueprint**.
2. Connect the GitHub repository `yashpurwar25/point_matrix`.
3. Select the `main` branch and apply the Blueprint.

Render installs a pinned Git LFS binary when needed, pulls the browser-ready frame assets, builds from `dashboard`, and publishes `dashboard/dist` as a static site. The raw NumPy source dataset is not downloaded during the build.

The frame dataset is large. Git LFS must be available during the Render checkout and the deployed static-site size must fit the selected Render plan. If those limits are exceeded, move `dashboard/public/frames` to object storage and configure the dashboard to use that asset URL.

Live inference needs a separately deployed Python backend. Set `VITE_API_URL`
on the static site's build and `CORS_ORIGINS` on the backend. The static Render
site alone only supports the saved demo; see the backend deployment guide.
