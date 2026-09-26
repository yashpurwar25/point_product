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

## GitHub Pages deployment

This repository now includes a GitHub Pages workflow in `.github/workflows/deploy-pages.yml`.

1. Push `main` to the GitHub repository.
2. In the repository settings, enable **Pages** with **GitHub Actions** as the source.
3. Add the repository variable `VITE_API_URL` if you have a public backend URL.

The Pages build publishes only the static dashboard. It disables the saved demo
for that deployment so the site stays small enough for Pages. Live uploads still
require a separately hosted Python backend; set `VITE_API_URL` on the repository
and `CORS_ORIGINS` on the backend to the final Pages origin.
