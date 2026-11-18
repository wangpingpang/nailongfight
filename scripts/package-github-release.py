"""Rebuild the two approved v0.1.3 preview downloads from the tagged source."""
from hashlib import sha256
from pathlib import Path
from shutil import copyfile
from zipfile import ZIP_DEFLATED, ZipFile, ZipInfo


ROOT = Path(__file__).resolve().parents[1]
DIST = ROOT / "dist"
CHECKSUMS = {
    "echo-arena-six-fighters.html": "d8648c081043e188207336ed97d0b077867af4af3e794ab867d16d17bce4551d",
    "echo-arena-six-fighters-source.zip": "9afbc381d207e638550a1620e883fe52a75575f0c611b94dbb633065e14b77cf",
}
SOURCE_FILES = [
    ".github/workflows/game-checks.yml", "LICENSE", "README.md",
    "docs/architecture/web-combat.md", "package.json",
    "production/qa/content-module-sync.md", "production/qa/task-bus-t01-t06.md",
    "project.yaml", "scripts/browser-smoke.py", "scripts/export-fighter-frames.mjs",
    "scripts/game-build.mjs", "scripts/game-server.mjs",
]


def main():
    copyfile(DIST / "echo-arena.html", DIST / "echo-arena-six-fighters.html")
    sources = [ROOT / name for name in SOURCE_FILES]
    for folder in ("src/game", "tests/game"):
        sources.extend(p for p in (ROOT / folder).rglob("*") if p.is_file())
    with ZipFile(DIST / "echo-arena-six-fighters-source.zip", "w") as archive:
        for source in sorted(sources, key=lambda p: p.relative_to(ROOT).as_posix()):
            entry = ZipInfo(source.relative_to(ROOT).as_posix(), (2026, 11, 18, 0, 0, 0))
            entry.create_system = 3
            entry.external_attr = 0o644 << 16
            archive.writestr(entry, source.read_bytes(), compress_type=ZIP_DEFLATED, compresslevel=6)

    for name, expected in CHECKSUMS.items():
        actual = sha256((DIST / name).read_bytes()).hexdigest()
        if actual != expected:
            raise SystemExit(f"{name} differs from the approved v0.1.3 preview: {actual}")
    (DIST / "SHA256SUMS").write_text("".join(
        f"{digest}  {name}\n" for name, digest in CHECKSUMS.items()
    ), encoding="ascii")


if __name__ == "__main__":
    main()
