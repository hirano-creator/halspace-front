"""Write STEP AP214 files with 2D geometry placed on the XY plane (Z=0).

Produces a GEOMETRICALLY_BOUNDED_WIREFRAME_SHAPE_REPRESENTATION containing
all curves, importable by SolidWorks, Fusion 360, FreeCAD, etc.
"""

import os
import math
from datetime import datetime
from typing import List, Dict, Optional
from .geometry import Path, LineSegment, CubicBezier


class _STEPBuilder:
    def __init__(self):
        self._entities: Dict[int, str] = {}
        self._next_id = 1
        self._curve_ids: List[int] = []

    def _alloc(self, definition: str) -> int:
        eid = self._next_id
        self._next_id += 1
        self._entities[eid] = definition
        return eid

    # ------------------------------------------------------------------ geometry

    def _point(self, x: float, y: float, z: float = 0.0) -> int:
        return self._alloc(f"CARTESIAN_POINT('',({x:.6f},{y:.6f},{z:.6f}))")

    def _direction(self, x: float, y: float, z: float) -> int:
        return self._alloc(f"DIRECTION('',({x:.6f},{y:.6f},{z:.6f}))")

    def _vector(self, dir_id: int, magnitude: float) -> int:
        return self._alloc(f"VECTOR('',#{dir_id},{magnitude:.6f})")

    def add_line(self, x1: float, y1: float, x2: float, y2: float):
        """Add a LINE as a TRIMMED_CURVE in the XY plane."""
        dx, dy = x2 - x1, y2 - y1
        length = math.sqrt(dx * dx + dy * dy)
        if length < 1e-6:
            return

        p_start = self._point(x1, y1)
        dir_id = self._direction(dx / length, dy / length, 0.0)
        vec_id = self._vector(dir_id, length)
        line_id = self._alloc(f"LINE('',#{p_start},#{vec_id})")

        p_end = self._point(x2, y2)
        trim_id = self._alloc(
            f"TRIMMED_CURVE('',#{line_id},"
            f"(PARAMETER_VALUE(0.)),(PARAMETER_VALUE(1.)),"
            f".T.,.PARAMETER.)"
        )
        self._curve_ids.append(trim_id)

    def add_cubic_bezier(self, p0, p1, p2, p3):
        """Add a cubic Bezier as B_SPLINE_CURVE_WITH_KNOTS (degree 3, 4 control points)."""
        ctrl_ids = [self._point(pt[0], pt[1]) for pt in (p0, p1, p2, p3)]
        ctrl_refs = ",".join(f"#{i}" for i in ctrl_ids)
        curve_id = self._alloc(
            f"B_SPLINE_CURVE_WITH_KNOTS('',3,"
            f"({ctrl_refs}),"
            f".UNSPECIFIED.,.F.,.F.,"
            f"(4,4),(0.,1.),"
            f".UNSPECIFIED.)"
        )
        self._curve_ids.append(curve_id)

    # ------------------------------------------------------------------ file structure

    def _build_product_structure(self) -> None:
        """Add AP214 product/shape boilerplate and the geometric curve set."""
        app_ctx = self._alloc("APPLICATION_CONTEXT('automotive design')")
        self._alloc(
            f"APPLICATION_PROTOCOL_DEFINITION("
            f"'draft international standard','automotive_design',1997,#{app_ctx})"
        )

        prod_ctx = self._alloc(f"PRODUCT_CONTEXT('',#{app_ctx},'mechanical')")
        prod = self._alloc(
            f"PRODUCT('AI Curves','AI Curves','',(#{prod_ctx}))"
        )
        pdf = self._alloc(
            f"PRODUCT_DEFINITION_FORMATION_WITH_SPECIFIED_SOURCE"
            f"('','',#{prod},.NOT_KNOWN.)"
        )
        pd_ctx = self._alloc(
            f"PRODUCT_DEFINITION_CONTEXT('part definition',#{app_ctx},'design')"
        )
        pd = self._alloc(
            f"PRODUCT_DEFINITION('design','',#{pdf},#{pd_ctx})"
        )
        pd_shape = self._alloc(
            f"PRODUCT_DEFINITION_SHAPE('','',#{pd})"
        )

        # Coordinate system
        origin = self._alloc("CARTESIAN_POINT('',(0.,0.,0.))")
        z_dir = self._alloc("DIRECTION('',(0.,0.,1.))")
        x_dir = self._alloc("DIRECTION('',(1.,0.,0.))")
        axis = self._alloc(f"AXIS2_PLACEMENT_3D('',#{origin},#{z_dir},#{x_dir})")

        # Unit / context
        len_unit = self._alloc(
            "(LENGTH_UNIT() NAMED_UNIT(*) SI_UNIT(.MILLI.,.METRE.))"
        )
        angle_unit = self._alloc(
            "(NAMED_UNIT(*) PLANE_ANGLE_UNIT() SI_UNIT($,.RADIAN.))"
        )
        solid_unit = self._alloc(
            "(NAMED_UNIT(*) SI_UNIT($,.STERADIAN.) SOLID_ANGLE_UNIT())"
        )
        uncertainty = self._alloc(
            f"UNCERTAINTY_MEASURE_WITH_UNIT("
            f"LENGTH_MEASURE(1.E-07),#{len_unit},"
            f"'distance_accuracy_value','confusion accuracy')"
        )
        rep_ctx = self._alloc(
            f"( GEOMETRIC_REPRESENTATION_CONTEXT(3)"
            f" GLOBAL_UNIT_ASSIGNED_CONTEXT((#{len_unit},#{angle_unit},#{solid_unit}))"
            f" GLOBAL_UNCERTAINTY_ASSIGNED_CONTEXT((#{uncertainty}))"
            f" REPRESENTATION_CONTEXT('Context #1',"
            f"'3D Context with UNIT and UNCERTAINTY') )"
        )

        # Geometric curve set
        if self._curve_ids:
            curve_refs = ",".join(f"#{i}" for i in self._curve_ids)
            curve_set = self._alloc(
                f"GEOMETRIC_CURVE_SET('AI curves',({curve_refs}))"
            )
        else:
            curve_set = self._alloc("GEOMETRIC_CURVE_SET('AI curves',(#0))")

        shape_rep = self._alloc(
            f"GEOMETRICALLY_BOUNDED_WIREFRAME_SHAPE_REPRESENTATION"
            f"('',(#{axis},#{curve_set}),#{rep_ctx})"
        )
        self._alloc(
            f"SHAPE_DEFINITION_REPRESENTATION(#{pd_shape},#{shape_rep})"
        )

    def build(self, filename: str) -> str:
        self._build_product_structure()

        now = datetime.now().strftime("%Y-%m-%dT%H:%M:%S")
        basename = os.path.basename(filename)

        lines = [
            "ISO-10303-21;",
            "HEADER;",
            f"FILE_DESCRIPTION(('AI to CAD Converter - STEP AP214'),'2;1');",
            f"FILE_NAME('{basename}','{now}',(''),(''),",
            "  'AI2CAD Converter v1.0','','');",
            "FILE_SCHEMA(('AUTOMOTIVE_DESIGN'));",
            "ENDSEC;",
            "DATA;",
        ]
        for eid, edata in sorted(self._entities.items()):
            lines.append(f"#{eid}={edata};")
        lines += ["ENDSEC;", "END-ISO-10303-21;"]

        return "\r\n".join(lines) + "\r\n"


# ------------------------------------------------------------------ public API

def write_step(paths: List[Path], output_path: str) -> None:
    builder = _STEPBuilder()

    for path in paths:
        for seg in path.segments:
            if isinstance(seg, LineSegment):
                builder.add_line(*seg.start, *seg.end)
            elif isinstance(seg, CubicBezier):
                builder.add_cubic_bezier(seg.p0, seg.p1, seg.p2, seg.p3)

    content = builder.build(output_path)
    with open(output_path, "w", newline="", encoding="ascii") as f:
        f.write(content)
