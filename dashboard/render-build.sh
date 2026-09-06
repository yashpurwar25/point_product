#!/usr/bin/env bash
set -euo pipefail

GIT_LFS_VERSION="3.8.0"

if command -v git-lfs >/dev/null 2>&1; then
  GIT_LFS_BIN="$(command -v git-lfs)"
else
  GIT_LFS_DIR="$(mktemp -d)"
  trap 'rm -rf "$GIT_LFS_DIR"' EXIT
  curl -fsSL \
    "https://github.com/git-lfs/git-lfs/releases/download/v${GIT_LFS_VERSION}/git-lfs-linux-amd64-v${GIT_LFS_VERSION}.tar.gz" \
    | tar -xz -C "$GIT_LFS_DIR"
  GIT_LFS_BIN="$GIT_LFS_DIR/git-lfs-${GIT_LFS_VERSION}/git-lfs"
fi

"$GIT_LFS_BIN" pull --include="dashboard/public/frames/**"
npm ci
npm run build
