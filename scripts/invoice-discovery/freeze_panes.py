"""Persist frozen header rows in artifact-tool generated XLSX workbooks.

The current artifact-tool in this workspace models freeze panes in memory but
does not serialize them during XLSX export. This narrow Open XML post-process
adds only the missing worksheet view state; it does not alter cell content,
styles, tables, formulas, or relationships.
"""

from __future__ import annotations

import argparse
import os
import re
import tempfile
import zipfile
from pathlib import Path


SHEET_VIEW = re.compile(
    rb"<x:sheetViews><x:sheetView(?P<attrs>[^>]*) /></x:sheetViews>"
)


def freeze_workbook(path: Path) -> None:
    temp_handle, temp_name = tempfile.mkstemp(
        prefix=f"{path.stem}-freeze-",
        suffix=".xlsx",
        dir=path.parent,
    )
    os.close(temp_handle)
    temp_path = Path(temp_name)

    try:
        with zipfile.ZipFile(path, "r") as source, zipfile.ZipFile(
            temp_path, "w", compression=zipfile.ZIP_DEFLATED
        ) as destination:
            for item in source.infolist():
                content = source.read(item.filename)
                match = re.fullmatch(r"xl/worksheets/sheet(\d+)\.xml", item.filename)
                if match:
                    sheet_number = int(match.group(1))
                    frozen_rows = 1 if sheet_number == 1 else 4
                    top_left = f"A{frozen_rows + 1}"
                    replacement = (
                        rb"<x:sheetViews><x:sheetView"
                        + SHEET_VIEW.search(content).group("attrs")
                        + rb">"
                        + (
                            f'<x:pane ySplit="{frozen_rows}" topLeftCell="{top_left}" '
                            'activePane="bottomLeft" state="frozen" />'
                        ).encode("utf-8")
                        + (
                            f'<x:selection pane="bottomLeft" activeCell="{top_left}" '
                            f'sqref="{top_left}" />'
                        ).encode("utf-8")
                        + rb"</x:sheetView></x:sheetViews>"
                    )
                    content, replacements = SHEET_VIEW.subn(
                        replacement, content, count=1
                    )
                    if replacements != 1:
                        raise RuntimeError(
                            f"Expected one worksheet view in {item.filename}"
                        )
                destination.writestr(item, content)
        os.replace(temp_path, path)
    finally:
        temp_path.unlink(missing_ok=True)


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("workbooks", nargs="+", type=Path)
    args = parser.parse_args()
    for workbook in args.workbooks:
        freeze_workbook(workbook.resolve())
        print(f"Frozen panes persisted: {workbook}")


if __name__ == "__main__":
    main()
