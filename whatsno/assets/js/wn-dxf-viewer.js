'use strict';
/* DXF ビューア共通モジュール
 * 依存: three.js, dxf-parser
 * 使用:
 *   wnRenderDxf(container, dxfText)   → Three.js でレンダリング
 *   wnDxfThumbnail(canvas, dxfText)   → canvas にサムネイル描画
 */

function wnParseDxf(text) {
  try {
    const parser = new DxfParser();
    return parser.parseSync(text);
  } catch (e) {
    return null;
  }
}

/* エンティティを Three.js オブジェクトに変換 */
function wnDxfToObjects(dxf) {
  const objects = [];
  if (!dxf || !dxf.entities) return objects;

  const mat = new THREE.LineBasicMaterial({ color: 0x2196F3, linewidth: 1 });

  for (const e of dxf.entities) {
    try {
      if (e.type === 'LINE') {
        const pts = [
          new THREE.Vector3(e.vertices[0].x, e.vertices[0].y, 0),
          new THREE.Vector3(e.vertices[1].x, e.vertices[1].y, 0),
        ];
        const geo = new THREE.BufferGeometry().setFromPoints(pts);
        objects.push(new THREE.Line(geo, mat));

      } else if (e.type === 'LWPOLYLINE' || e.type === 'POLYLINE') {
        const verts = e.vertices || [];
        if (verts.length < 2) continue;
        const pts = verts.map(v => new THREE.Vector3(v.x, v.y, 0));
        if (e.shape) pts.push(pts[0].clone()); // 閉じる
        const geo = new THREE.BufferGeometry().setFromPoints(pts);
        objects.push(new THREE.Line(geo, mat));

      } else if (e.type === 'CIRCLE') {
        const curve = new THREE.EllipseCurve(
          e.center.x, e.center.y, e.radius, e.radius, 0, Math.PI * 2
        );
        const pts = curve.getPoints(64);
        const geo = new THREE.BufferGeometry().setFromPoints(pts);
        objects.push(new THREE.Line(geo, mat));

      } else if (e.type === 'ARC') {
        const start = (e.startAngle ?? 0) * Math.PI / 180;
        const end   = (e.endAngle   ?? 360) * Math.PI / 180;
        const curve = new THREE.EllipseCurve(
          e.center.x, e.center.y, e.radius, e.radius, start, end
        );
        const pts = curve.getPoints(48);
        const geo = new THREE.BufferGeometry().setFromPoints(pts);
        objects.push(new THREE.Line(geo, mat));

      } else if (e.type === 'ELLIPSE') {
        const rx = e.majorAxisEndPoint
          ? Math.sqrt(e.majorAxisEndPoint.x ** 2 + e.majorAxisEndPoint.y ** 2)
          : e.radius ?? 1;
        const ry = rx * (e.axisRatio ?? 1);
        const rot = e.majorAxisEndPoint
          ? Math.atan2(e.majorAxisEndPoint.y, e.majorAxisEndPoint.x)
          : 0;
        const curve = new THREE.EllipseCurve(
          e.center.x, e.center.y, rx, ry,
          e.startAngle ?? 0, e.endAngle ?? Math.PI * 2,
          false, rot
        );
        const pts = curve.getPoints(64);
        const geo = new THREE.BufferGeometry().setFromPoints(pts);
        objects.push(new THREE.Line(geo, mat));

      } else if (e.type === 'SPLINE' && e.controlPoints) {
        const pts = e.controlPoints.map(p => new THREE.Vector3(p.x, p.y, 0));
        if (pts.length >= 2) {
          const geo = new THREE.BufferGeometry().setFromPoints(pts);
          objects.push(new THREE.Line(geo, mat));
        }
      }
    } catch {}
  }
  return objects;
}

/* カメラをオブジェクト全体にフィット */
function wnDxfFitCamera(camera, objects, renderer) {
  const box = new THREE.Box3();
  objects.forEach(o => box.expandByObject(o));
  if (box.isEmpty()) return;

  const size   = box.getSize(new THREE.Vector3());
  const center = box.getCenter(new THREE.Vector3());
  const maxDim = Math.max(size.x, size.y, 0.001);

  const aspect = renderer.domElement.width / renderer.domElement.height;
  camera.left   = -maxDim / 2 * 1.1;
  camera.right  =  maxDim / 2 * 1.1;
  camera.top    =  maxDim / 2 / aspect * 1.1;
  camera.bottom = -maxDim / 2 / aspect * 1.1;
  camera.near   = -10000;
  camera.far    =  10000;
  camera.position.set(center.x, center.y, 1);
  camera.lookAt(center.x, center.y, 0);
  camera.updateProjectionMatrix();
}

/* ────────────────────────────────
   フル表示（ファイル詳細プレビュー用）
   container: DOM要素（width/height が設定されていること）
   dxfText: DXFファイルのテキスト内容
   戻り値: { dispose } — モーダルクローズ時に呼ぶ
   ──────────────────────────────── */
function wnRenderDxf(container, dxfText) {
  const dxf = wnParseDxf(dxfText);
  if (!dxf) return null;

  const w = container.clientWidth  || 600;
  const h = container.clientHeight || 400;

  const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
  renderer.setSize(w, h);
  renderer.setClearColor(0x1A1A2E, 1);
  container.appendChild(renderer.domElement);

  const scene  = new THREE.Scene();
  const camera = new THREE.OrthographicCamera(-1, 1, 1, -1, -10000, 10000);

  const objects = wnDxfToObjects(dxf);
  objects.forEach(o => scene.add(o));
  wnDxfFitCamera(camera, objects, renderer);

  let rafId = null;
  const render = () => { rafId = requestAnimationFrame(render); renderer.render(scene, camera); };
  render();

  // マウスホイールでズーム
  let zoom = 1;
  const onWheel = e => {
    e.preventDefault();
    zoom *= e.deltaY > 0 ? 1.1 : 0.9;
    camera.zoom = zoom;
    camera.updateProjectionMatrix();
  };
  container.addEventListener('wheel', onWheel, { passive: false });

  // ドラッグでパン
  let dragging = false, lastX = 0, lastY = 0;
  const onDown = e => { dragging = true; lastX = e.clientX; lastY = e.clientY; };
  const onMove = e => {
    if (!dragging) return;
    const dx = (e.clientX - lastX) / w * (camera.right - camera.left) / camera.zoom;
    const dy = (e.clientY - lastY) / h * (camera.top - camera.bottom) / camera.zoom;
    camera.position.x -= dx;
    camera.position.y += dy;
    lastX = e.clientX; lastY = e.clientY;
  };
  const onUp = () => { dragging = false; };
  container.addEventListener('mousedown', onDown);
  window.addEventListener('mousemove', onMove);
  window.addEventListener('mouseup', onUp);

  return {
    dispose: () => {
      cancelAnimationFrame(rafId);
      container.removeEventListener('wheel', onWheel);
      container.removeEventListener('mousedown', onDown);
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
      renderer.dispose();
      if (renderer.domElement.parentNode) renderer.domElement.parentNode.removeChild(renderer.domElement);
    }
  };
}

/* ────────────────────────────────
   サムネイル描画（ダッシュボード用）
   canvas: HTMLCanvasElement
   dxfText: DXFファイルのテキスト内容
   ──────────────────────────────── */
function wnDxfThumbnail(canvas, dxfText) {
  const dxf = wnParseDxf(dxfText);
  if (!dxf) return false;

  const w = canvas.width  || 300;
  const h = canvas.height || 150;

  const renderer = new THREE.WebGLRenderer({ canvas, antialias: false, alpha: false });
  renderer.setSize(w, h);
  renderer.setClearColor(0xE8F0FE, 1);

  const scene  = new THREE.Scene();
  const camera = new THREE.OrthographicCamera(-1, 1, 1, -1, -10000, 10000);

  const mat = new THREE.LineBasicMaterial({ color: 0x1E3A5F });
  const objects = wnDxfToObjects(dxf);
  objects.forEach(o => { o.material = mat; scene.add(o); });
  wnDxfFitCamera(camera, objects, renderer);

  renderer.render(scene, camera);
  renderer.dispose();
  return true;
}
