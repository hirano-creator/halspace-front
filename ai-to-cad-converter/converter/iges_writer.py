"""Write IGES 5.3 files with 2D geometry placed on the XY plane (Z=0)."""

import os
import math
from datetime import datetime
from typing import List
from .geometry import Path, LineSegment, CubicBezier


# Each IGES record is exactly 80 characters:
#   cols 1-72  : section data
#   col  73    : section code (S/G/D/P/T)
#   cols 74-80 : 7-digit sequence number


def _rec(data: str, section: str, seq: int) -> str:
    return f"{data[:72].ljust(72)}{section}{seq:7d}"


class _IGESBuilder:
    def __init__(self):
        self._de_lines: List[str] = []
        self._pd_lines: List[str] = []
        self._de_seq = 1  # DE sequence (increments by 2 per entity)
        self._pd_seq = 1

    # ------------------------------------------------------------------ helpers

    def _write_pd(self, params: str, de_ptr: int) -> int:
        """Append PD record lines and return the count of lines written."""
        text = params + ";"
        count = 0
        while text:
            chunk = text[:64]
            text = text[64:]
            line = _rec(f"{chunk.ljust(64)}{de_ptr:8d}", "P", self._pd_seq)
            self._pd_lines.append(line)
            self._pd_seq += 1
            count += 1
        return count

    def _write_de(self, etype: int, pd_start: int, pd_count: int, form: int = 0):
        de_ptr = self._de_seq
        # Line 1
        row1 = (f"{etype:8d}{pd_start:8d}{0:8d}{0:8d}{0:8d}"
                f"{0:8d}{0:8d}{0:8d}{'00000001':8s}")
        self._de_lines.append(_rec(row1, "D", self._de_seq))
        self._de_seq += 1
        # Line 2
        row2 = (f"{etype:8d}{0:8d}{0:8d}{pd_count:8d}{form:8d}"
                f"{'':8s}{'':8s}{'':8s}{0:8d}")
        self._de_lines.append(_rec(row2, "D", self._de_seq))
        self._de_seq += 1
        return de_ptr

    # ------------------------------------------------------------------ entities

    def add_line(self, x1: float, y1: float, x2: float, y2: float):
        """IGES Type 110: Line."""
        pd_start = self._pd_seq
        params = f"110,{x1:.6f},{y1:.6f},0.,{x2:.6f},{y2:.6f},0."
        pd_count = self._write_pd(params, self._de_seq)
        self._write_de(110, pd_start, pd_count)

    def add_cubic_bezier(self, p0, p1, p2, p3):
        """IGES Type 126: Rational B-Spline Curve (cubic Bezier = degree-3 clamped B-spline)."""
        # K=3 (upper index), M=3 (degree), 4 control points
        # Clamped uniform knot vector: 0 0 0 0 1 1 1 1
        K, M = 3, 3
        knots = "0.,0.,0.,0.,1.,1.,1.,1."
        weights = "1.,1.,1.,1."
        ctrl = ",".join(
            f"{pt[0]:.6f},{pt[1]:.6f},0." for pt in (p0, p1, p2, p3)
        )
        params = f"126,{K},{M},0,0,1,0,{knots},{weights},{ctrl},0.,1."
        pd_start = self._pd_seq
        pd_count = self._write_pd(params, self._de_seq)
        self._write_de(126, pd_start, pd_count, form=0)

    # ------------------------------------------------------------------ output

    def build(self, filename: str) -> str:
        now = datetime.now().strftime("%Y%m%d.%H%M%S")
        basename = os.path.basename(filename)

        # Start section
        start_rec = _rec("AI to CAD Converter - IGES output", "S", 1)

        # Global section
        g_str = (
            f"1H,,1H;,"
            f"{len(basename)+2}H{basename},"
            f"{len(basename)+2}H{basename},"
            f"14HAI2CAD v1.0.0,"
            f"3H1.0,"
            f"6,15,6,15,15,"
            f"3H1.0,"
            f"1.,"
            f"2,"          # unit flag: 2 = mm
            f"2Hmm,"
            f"32,"
            f"0.001,"
            f"15H{now},"
            f"0.001,"
            f"10000.,"
            f"8HConverter,"
            f"3HAIF,"
            f"11,"
            f"0,"
            f"15H{now};"
        )
        global_recs = []
        i, g_seq = 0, 1
        while i < len(g_str):
            global_recs.append(_rec(g_str[i:i+72], "G", g_seq))
            i += 72
            g_seq += 1

        # Terminate section
        t_rec = _rec(
            f"S{1:7d}G{len(global_recs):7d}D{len(self._de_lines):7d}P{len(self._pd_lines):7d}",
            "T", 1
        )

        lines = (
            [start_rec] + global_recs
            + self._de_lines + self._pd_lines
            + [t_rec]
        )
        return "\r\n".join(lines) + "\r\n"


# ------------------------------------------------------------------ public API

def write_iges(paths: List[Path], output_path: str) -> None:
    builder = _IGESBuilder()

    for path in paths:
        for seg in path.segments:
            if isinstance(seg, LineSegment):
                dx = seg.end[0] - seg.start[0]
                dy = seg.end[1] - seg.start[1]
                if math.sqrt(dx * dx + dy * dy) > 1e-6:
                    builder.add_line(*seg.start, *seg.end)
            elif isinstance(seg, CubicBezier):
                builder.add_cubic_bezier(seg.p0, seg.p1, seg.p2, seg.p3)

    content = builder.build(output_path)
    with open(output_path, "w", newline="", encoding="ascii") as f:
        f.write(content)
