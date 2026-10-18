"""Backend-only deployments (Vercel with Root Directory = backend) ship just this folder, without the repository's
sibling `shared/`. These tests rebuild that layout in a temporary directory and start the app from it."""
import os
import shutil
import subprocess
import sys
from pathlib import Path

BACKEND = Path(__file__).resolve().parents[1]
REPO = BACKEND.parent


def test_packaged_catalog_matches_the_authoritative_one():
    assert (BACKEND / "shared" / "catalog.json").read_bytes() == (REPO / "shared" / "catalog.json").read_bytes(), (
        "backend/shared/catalog.json is out of date: run `cp shared/catalog.json backend/shared/catalog.json` "
        "from the repository root")


def _packaged(tmp_path: Path) -> Path:
    """A copy of what a backend-only deployment contains, in a folder with no `shared/` beside it."""
    task = tmp_path / "task"
    ignore = shutil.ignore_patterns("__pycache__", ".pytest_cache", "*.pyc")
    for name in ("app", "shared", "requirements.txt"):
        src = BACKEND / name
        (shutil.copytree(src, task / name, ignore=ignore) if src.is_dir() else shutil.copy(src, task / name))
    assert not (tmp_path / "shared").exists()
    return task


def _run(task: Path, code: str) -> subprocess.CompletedProcess:
    env = {k: v for k, v in os.environ.items()
           if k not in ("SHARED_DIR", "DATABASE_URL", "GEMINI_API_KEY", "FRONTEND_DIST", "PYTHONPATH")}
    return subprocess.run([sys.executable, "-c", code], cwd=task, env=env, capture_output=True, text=True, timeout=300)


def test_catalog_loads_from_a_backend_only_deployment(tmp_path):
    task = _packaged(tmp_path)
    r = _run(task, "from app.config import settings; from app.catalog import get_catalog; "
                   "print(settings.shared_dir); print(len(get_catalog().need_ids))")
    assert r.returncode == 0, r.stderr
    shared_dir, needs = r.stdout.split()
    assert Path(shared_dir) == (task / "shared").resolve() and int(needs) == 20


def test_app_starts_from_a_backend_only_deployment(tmp_path):
    task = _packaged(tmp_path)
    r = _run(task, "from fastapi.testclient import TestClient\n"
                   "from app.main import app\n"
                   "with TestClient(app) as c:\n"
                   "    h = c.get('/api/health')\n"
                   "    print(h.status_code, h.json()['ok'])\n")
    assert r.returncode == 0, r.stderr[-3000:]
    assert r.stdout.split()[-2:] == ["200", "True"]
