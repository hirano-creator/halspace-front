"""AI to CAD Converter - FastAPI web application."""

import os
import tempfile
import uuid
from pathlib import Path

from fastapi import FastAPI, File, Form, HTTPException, UploadFile
from fastapi.responses import FileResponse, HTMLResponse
from fastapi.staticfiles import StaticFiles

from converter.ai_parser import parse_ai_file
from converter.iges_writer import write_iges
from converter.step_writer import write_step

app = FastAPI(title="AI to CAD Converter")
app.mount("/static", StaticFiles(directory="static"), name="static")

TEMP_DIR = Path(tempfile.gettempdir()) / "ai2cad"
TEMP_DIR.mkdir(exist_ok=True)


@app.get("/", response_class=HTMLResponse)
async def index():
    return FileResponse("static/index.html")


@app.post("/convert")
async def convert(
    file: UploadFile = File(...),
    format: str = Form("iges"),
):
    if not file.filename.lower().endswith(".ai"):
        raise HTTPException(status_code=400, detail=".aiファイルのみ対応しています")

    if format not in ("iges", "step"):
        raise HTTPException(status_code=400, detail="format は 'iges' または 'step' を指定してください")

    session_id = uuid.uuid4().hex
    input_path = TEMP_DIR / f"{session_id}.ai"
    ext = ".igs" if format == "iges" else ".stp"
    output_path = TEMP_DIR / f"{session_id}{ext}"

    try:
        # Save uploaded file
        content = await file.read()
        if len(content) == 0:
            raise HTTPException(status_code=400, detail="ファイルが空です")
        input_path.write_bytes(content)

        # Parse and convert
        paths = parse_ai_file(str(input_path))
        if not paths:
            raise HTTPException(
                status_code=422,
                detail="変換可能なパスが見つかりませんでした。ファイルにベクターパスが含まれているか確認してください。",
            )

        seg_count = sum(len(p.segments) for p in paths)

        if format == "iges":
            write_iges(paths, str(output_path))
            media_type = "application/iges"
        else:
            write_step(paths, str(output_path))
            media_type = "application/step"

        stem = Path(file.filename).stem
        download_name = f"{stem}{ext}"

        return FileResponse(
            path=str(output_path),
            media_type=media_type,
            filename=download_name,
            headers={
                "X-Segment-Count": str(seg_count),
                "X-Path-Count": str(len(paths)),
            },
        )

    except HTTPException:
        raise
    except ValueError as e:
        raise HTTPException(status_code=422, detail=str(e))
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"変換エラー: {e}")
    finally:
        if input_path.exists():
            input_path.unlink(missing_ok=True)
