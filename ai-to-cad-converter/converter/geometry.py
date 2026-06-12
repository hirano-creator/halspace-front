from dataclasses import dataclass, field
from typing import List, Tuple

Point2D = Tuple[float, float]

# PDF/AI points to millimeters (1 pt = 1/72 inch = 0.352778 mm)
PT_TO_MM = 25.4 / 72.0


@dataclass
class LineSegment:
    start: Point2D
    end: Point2D


@dataclass
class CubicBezier:
    """Cubic Bezier curve with 4 control points."""
    p0: Point2D  # start
    p1: Point2D  # control 1
    p2: Point2D  # control 2
    p3: Point2D  # end


@dataclass
class Path:
    segments: List = field(default_factory=list)  # LineSegment | CubicBezier
    closed: bool = False
