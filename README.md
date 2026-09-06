# Point Matrix

React dashboard for viewing 1,000 classified LiDAR frames and their synchronized variable-resolution grid projections.

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
