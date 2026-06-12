"""Parse Adobe Illustrator (.ai) files via PyMuPDF (AI files are PDF-based)."""

import fitz  # PyMuPDF
import math
from typing import List, Set, Tuple
from .geometry import LineSegment, CubicBezier, Path, PT_TO_MM

# 重複判定の座標丸め精度 (mm)
_DEDUP_TOLERANCE = 0.01


def parse_ai_file(file_path: str) -> List[Path]:
    """Extract vector paths from an .ai file. Returns deduplicated Path objects in mm."""
    try:
        doc = fitz.open(file_path)
    except Exception as e:
        raise ValueError(f"ファイルを開けませんでした: {e}")

    paths: List[Path] = []

    for page in doc:
        page_height = page.rect.height  # points, used to flip Y axis

        for draw in page.get_drawings():
            path = Path()

            for item in draw.get("items", []):
                cmd = item[0]

                if cmd == "l":  # line segment
                    p1 = _to_mm(item[1], page_height)
                    p2 = _to_mm(item[2], page_height)
                    if _dist(p1, p2) > _DEDUP_TOLERANCE:
                        path.segments.append(LineSegment(p1, p2))

                elif cmd == "c":  # cubic Bezier (start, cp1, cp2, end)
                    p0 = _to_mm(item[1], page_height)
                    p1 = _to_mm(item[2], page_height)
                    p2 = _to_mm(item[3], page_height)
                    p3 = _to_mm(item[4], page_height)
                    path.segments.append(CubicBezier(p0, p1, p2, p3))

                elif cmd == "re":  # rectangle
                    r = item[1]
                    corners = [
                        _to_mm_xy(r.x0, r.y0, page_height),
                        _to_mm_xy(r.x1, r.y0, page_height),
                        _to_mm_xy(r.x1, r.y1, page_height),
                        _to_mm_xy(r.x0, r.y1, page_height),
                    ]
                    for i in range(4):
                        path.segments.append(
                            LineSegment(corners[i], corners[(i + 1) % 4])
                        )
                    path.closed = True

                elif cmd == "qu":  # quadrilateral
                    q = item[1]
                    corners = [
                        _to_mm_xy(q.ul.x, q.ul.y, page_height),
                        _to_mm_xy(q.ur.x, q.ur.y, page_height),
                        _to_mm_xy(q.lr.x, q.lr.y, page_height),
                        _to_mm_xy(q.ll.x, q.ll.y, page_height),
                    ]
                    for i in range(4):
                        path.segments.append(
                            LineSegment(corners[i], corners[(i + 1) % 4])
                        )
                    path.closed = True

            if draw.get("closePath") and path.segments:
                path.closed = True

            if path.segments:
                paths.append(path)

    doc.close()
    return _deduplicate(paths)


def _deduplicate(paths: List[Path]) -> List[Path]:
    """ストローク・フィルの二重描画など、重複するセグメントをグローバルに除去する。"""
    seen: Set[tuple] = set()
    result: List[Path] = []

    for path in paths:
        unique_segs = []
        for seg in path.segments:
            key = _seg_key(seg)
            if key not in seen:
                seen.add(key)
                unique_segs.append(seg)
        if unique_segs:
            result.append(Path(segments=unique_segs, closed=path.closed))

    return result


def _seg_key(seg) -> tuple:
    """セグメントの正規化ハッシュキー（向きに依存しない）。"""
    tol = _DEDUP_TOLERANCE

    def r(v: float) -> int:
        return round(v / tol)

    if isinstance(seg, LineSegment):
        p1 = (r(seg.start[0]), r(seg.start[1]))
        p2 = (r(seg.end[0]), r(seg.end[1]))
        # 向きに依存しない比較（A→BとB→Aを同一視）
        return ("L", min(p1, p2), max(p1, p2))

    if isinstance(seg, CubicBezier):
        fwd = tuple((r(p[0]), r(p[1])) for p in [seg.p0, seg.p1, seg.p2, seg.p3])
        rev = tuple((r(p[0]), r(p[1])) for p in [seg.p3, seg.p2, seg.p1, seg.p0])
        return ("C", min(fwd, rev))

    # 未知の型はキーなし（スキップしない）
    return ("?", id(seg))


def _dist(p1: tuple, p2: tuple) -> float:
    return math.sqrt((p1[0] - p2[0]) ** 2 + (p1[1] - p2[1]) ** 2)


def _to_mm(point, page_height: float) -> tuple:
    return (point.x * PT_TO_MM, (page_height - point.y) * PT_TO_MM)


def _to_mm_xy(x: float, y: float, page_height: float) -> tuple:
    return (x * PT_TO_MM, (page_height - y) * PT_TO_MM)
