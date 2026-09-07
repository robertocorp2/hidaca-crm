#!/usr/bin/env python3
"""Compare a final live rescan with the initial HIDACA invoice manifest."""

from __future__ import annotations

import argparse
import hashlib
import json
from datetime import datetime
from pathlib import Path


def sha256_file(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def entry(path: Path, relative_path: str) -> dict:
    stat = path.stat()
    return {
        "relative_path": relative_path,
        "file_name": path.name,
        "extension": path.suffix.lower(),
        "size_bytes": stat.st_size,
        "source_modified_at": datetime.fromtimestamp(stat.st_mtime).astimezone().isoformat(),
        "download_status": "downloaded",
        "sha256": sha256_file(path),
    }


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--initial-manifest", type=Path, required=True)
    parser.add_argument("--final-root", type=Path, required=True)
    parser.add_argument("--final-matrix", type=Path, required=True)
    parser.add_argument("--final-certificate", type=Path, required=True)
    parser.add_argument("--output-root", type=Path, required=True)
    args = parser.parse_args()

    initial = json.loads(args.initial_manifest.read_text(encoding="utf-8"))
    final = [
        entry(path, f"FACTURAS HIDACA/{path.relative_to(args.final_root).as_posix()}")
        for path in sorted(item for item in args.final_root.rglob("*") if item.is_file())
    ]
    final.append(entry(args.final_matrix, "FACTURAS HIDACA/FACTURACION HIDACA - Matriz Principal.xlsx"))
    final.append(
        entry(
            args.final_certificate,
            "FACTURAS HIDACA/FACTURADOR DGII/certificado firma digital.p12",
        )
    )

    initial_by_path = {item["relative_path"]: item for item in initial}
    final_by_path = {item["relative_path"]: item for item in final}
    deltas = []
    for relative_path in sorted(set(initial_by_path) | set(final_by_path), key=str.casefold):
        before = initial_by_path.get(relative_path)
        after = final_by_path.get(relative_path)
        if before is None:
            status = "added"
        elif after is None:
            status = "removed"
        elif before["sha256"] != after["sha256"]:
            status = "changed"
        else:
            status = "unchanged"
        deltas.append(
            {
                "relative_path": relative_path,
                "delta_status": status,
                "initial_sha256": before["sha256"] if before else None,
                "final_sha256": after["sha256"] if after else None,
                "initial_size_bytes": before["size_bytes"] if before else None,
                "final_size_bytes": after["size_bytes"] if after else None,
                "initial_modified_at": before["source_modified_at"] if before else None,
                "final_modified_at": after["source_modified_at"] if after else None,
            }
        )
    summary = {
        "generated_at": datetime.now().astimezone().isoformat(),
        "initial_files": len(initial),
        "final_files": len(final),
        "counts": {
            status: sum(1 for item in deltas if item["delta_status"] == status)
            for status in ("unchanged", "added", "changed", "removed", "inaccessible")
        },
    }
    args.output_root.mkdir(parents=True, exist_ok=True)
    (args.output_root / "manifest-final.json").write_text(
        json.dumps(final, ensure_ascii=False, indent=2),
        encoding="utf-8",
    )
    (args.output_root / "manifest-deltas.json").write_text(
        json.dumps(deltas, ensure_ascii=False, indent=2),
        encoding="utf-8",
    )
    (args.output_root / "final-rescan-summary.json").write_text(
        json.dumps(summary, ensure_ascii=False, indent=2),
        encoding="utf-8",
    )
    print(json.dumps(summary, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
