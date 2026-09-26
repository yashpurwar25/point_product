"""Fetch the pinned grid engine and the checkpoint used by its inference notebook."""

import subprocess

import httpx

from .pipeline import CHECKPOINT_NAME, ENGINE_REVISION, ROOT, RUNTIME


def main():
    RUNTIME.mkdir(parents=True, exist_ok=True)
    engine = RUNTIME / "AS2.5LM"
    if not engine.exists():
        subprocess.run([
            "git", "clone", "https://github.com/point-matrix/AS2.5LM.git", str(engine),
        ], check=True)
        subprocess.run(["git", "-C", str(engine), "checkout", "--detach", ENGINE_REVISION], check=True)
    revision = subprocess.check_output(["git", "-C", str(engine), "rev-parse", "HEAD"], text=True).strip()
    if revision != ENGINE_REVISION:
        raise SystemExit(f"Expected engine {ENGINE_REVISION}; found {revision}. Use a fresh runtime directory.")
    patch = ROOT / "backend/patches/quadtree-capacity.patch"
    already_applied = subprocess.run(
        ["git", "-C", str(engine), "apply", "--reverse", "--check", str(patch)],
        capture_output=True,
    ).returncode == 0
    if not already_applied:
        subprocess.run(["git", "-C", str(engine), "apply", "--check", str(patch)], check=True)
        subprocess.run(["git", "-C", str(engine), "apply", str(patch)], check=True)
    checkpoint = RUNTIME / CHECKPOINT_NAME
    if not checkpoint.exists():
        temporary = checkpoint.with_suffix(".download")
        url = f"https://storage.googleapis.com/open3d-releases/model-zoo/{CHECKPOINT_NAME}"
        print(f"Downloading {CHECKPOINT_NAME}...")
        try:
            with httpx.stream("GET", url, timeout=120, follow_redirects=True) as response, temporary.open("wb") as output:
                response.raise_for_status()
                for chunk in response.iter_bytes(1024 * 1024):
                    output.write(chunk)
            temporary.replace(checkpoint)
        finally:
            temporary.unlink(missing_ok=True)
    print(f"Runtime ready at {RUNTIME}")


if __name__ == "__main__":
    main()
