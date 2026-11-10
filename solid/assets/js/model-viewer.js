'use strict';
/* 3Dモデル（STL / STEP）の表示。SolidWorks の「エッジ付きシェーディング」に近い見た目にする。

   使い方: SolidModelViewer.open(container, geometry, { toolbar })   ※ THREE と OrbitControls を先に読んでおく
   - グレーの立体 ＋ 角の稜線だけを黒い線で描く（STL の三角形の分割線は出さない）
   - 明るいグラデーション背景、遠近なしの平行投影、左下に座標軸
   - 等角・正面・上面・右側面の切り替え
   STL は面ごとにばらばらの三角形で届くので、そのままだと円筒がカクカクに見える。
   隣り合う面の角度が小さいところだけ法線をならして、曲面はなめらかに、角はくっきり見せる */
const SolidModelViewer = (() => {
  const CREASE_DEG = 30;              // これより急な折れ目は「角」として扱う（線を引く・法線をならさない）
  const MAX_SMOOTH_TRIS = 1500000;    // これより細かいモデルはならし処理を省く（待ち時間が長くなるため）
  const MAX_EDGE_TRIS   = 3000000;

  /* 三角形がばらばらのジオメトリ（STL）に、折れ目を残した法線を付ける */
  function creasedNormals(THREE, geo) {
    const pos = geo.attributes.position.array, vcount = pos.length / 3, tcount = vcount / 3;
    const fn = new Float32Array(tcount * 3), fa = new Float32Array(tcount * 3);
    for (let t = 0; t < tcount; t++) {
      const i = t * 9;
      const ax = pos[i + 3] - pos[i], ay = pos[i + 4] - pos[i + 1], az = pos[i + 5] - pos[i + 2];
      const bx = pos[i + 6] - pos[i], by = pos[i + 7] - pos[i + 1], bz = pos[i + 8] - pos[i + 2];
      const nx = ay * bz - az * by, ny = az * bx - ax * bz, nz = ax * by - ay * bx;
      const len = Math.hypot(nx, ny, nz) || 1;
      fa[t * 3] = nx; fa[t * 3 + 1] = ny; fa[t * 3 + 2] = nz;                 // 面積で重み付けした法線
      fn[t * 3] = nx / len; fn[t * 3 + 1] = ny / len; fn[t * 3 + 2] = nz / len;
    }
    geo.computeBoundingBox();
    const size = geo.boundingBox.getSize(new THREE.Vector3());
    const inv = 1 / ((Math.max(size.x, size.y, size.z) || 1) * 1e-5);
    /* 同じ位置の頂点をまとめる */
    const ids = new Map(), groups = [], vid = new Int32Array(vcount);
    for (let v = 0; v < vcount; v++) {
      const key = Math.round(pos[v * 3] * inv) + ',' + Math.round(pos[v * 3 + 1] * inv) + ',' + Math.round(pos[v * 3 + 2] * inv);
      let id = ids.get(key);
      if (id === undefined) { id = groups.length; ids.set(key, id); groups.push([]); }
      groups[id].push(v); vid[v] = id;
    }
    const cos = Math.cos(CREASE_DEG * Math.PI / 180), out = new Float32Array(pos.length);
    for (let v = 0; v < vcount; v++) {
      const t = (v / 3 | 0) * 3, g = groups[vid[v]];
      let x = 0, y = 0, z = 0;
      for (let k = 0; k < g.length; k++) {
        const t2 = (g[k] / 3 | 0) * 3;
        if (fn[t] * fn[t2] + fn[t + 1] * fn[t2 + 1] + fn[t + 2] * fn[t2 + 2] >= cos) { x += fa[t2]; y += fa[t2 + 1]; z += fa[t2 + 2]; }
      }
      const len = Math.hypot(x, y, z) || 1;
      out[v * 3] = x / len; out[v * 3 + 1] = y / len; out[v * 3 + 2] = z / len;
    }
    geo.setAttribute('normal', new THREE.BufferAttribute(out, 3));
  }

  function label(THREE, text, color) {
    const c = document.createElement('canvas'); c.width = c.height = 64;
    const ctx = c.getContext('2d');
    ctx.font = '700 44px sans-serif'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillStyle = color;
    ctx.fillText(text, 32, 34);
    const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: new THREE.CanvasTexture(c), depthTest: false }));
    s.scale.set(.5, .5, 1);
    return s;
  }

  function open(container, geometry, { toolbar } = {}) {
    const THREE = window.THREE;
    const tris = (geometry.index ? geometry.index.count : geometry.attributes.position.count) / 3;

    if (!geometry.index && tris <= MAX_SMOOTH_TRIS) creasedNormals(THREE, geometry);
    else if (!geometry.attributes.normal) geometry.computeVertexNormals();

    const scene = new THREE.Scene();
    container.style.background = 'linear-gradient(#b9c6d4, #eef2f6 70%, #f7f9fb)';
    const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.setClearColor(0x000000, 0);
    renderer.autoClear = false;
    container.appendChild(renderer.domElement);

    /* 立体。線と重なってちらつかないよう、面をわずかに奥へずらす */
    const mesh = new THREE.Mesh(geometry, new THREE.MeshPhongMaterial({
      /* つやは弱めにする（強いと、正面を向いた面が真っ白に飛んで穴や段差が見えなくなる） */
      color: 0xb4bcc8, specular: 0x0c0c0c, shininess: 12, side: THREE.DoubleSide,
      polygonOffset: true, polygonOffsetFactor: 1, polygonOffsetUnits: 1,
    }));
    scene.add(mesh);
    let edges = null;
    if (tris <= MAX_EDGE_TRIS) {
      edges = new THREE.LineSegments(new THREE.EdgesGeometry(geometry, CREASE_DEG), new THREE.LineBasicMaterial({ color: 0x1b1f24 }));
      scene.add(edges);
    }

    const box = new THREE.Box3().setFromObject(mesh);
    const center = box.getCenter(new THREE.Vector3());
    const radius = box.getSize(new THREE.Vector3()).length() / 2 || 1;

    /* 平行投影。光はカメラに付けて、どの向きから見ても同じ明るさにする */
    const camera = new THREE.OrthographicCamera(-1, 1, 1, -1, radius * .01, radius * 40);
    scene.add(camera);
    scene.add(new THREE.AmbientLight(0xffffff, .42));
    const key = new THREE.DirectionalLight(0xffffff, .6); key.position.set(.4, .5, 1);
    const fill = new THREE.DirectionalLight(0xffffff, .3); fill.position.set(-1, .8, .4);
    /* 光の向き先(target)もカメラに付ける。付けないと原点を向いたままになり、2つの光が同じ向きに重なって面が白く飛ぶ */
    [key, fill].forEach(l => { camera.add(l); camera.add(l.target); });

    const controls = new THREE.OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true; controls.dampingFactor = .12;
    controls.mouseButtons = { LEFT: THREE.MOUSE.ROTATE, MIDDLE: THREE.MOUSE.ROTATE, RIGHT: THREE.MOUSE.PAN };   // 中ボタンでも回せる（SolidWorks と同じ）
    controls.zoomSpeed = 1.2;

    let w = 1, h = 1;
    function frame() {
      w = container.clientWidth || 1; h = container.clientHeight || 1;
      const a = w / h, half = radius * 1.15;
      const top = a >= 1 ? half : half / a, right = a >= 1 ? half * a : half;
      camera.left = -right; camera.right = right; camera.top = top; camera.bottom = -top;
      camera.updateProjectionMatrix();
      renderer.setSize(w, h);
    }
    const VIEWS = {
      iso:   [1, 1, 1],
      front: [0, 0, 1],
      top:   [0, 1, 1e-4],        // 真上はカメラの上向きが決まらないので、ごくわずかに手前へ倒す
      right: [1, 0, 0],
    };
    function setView(name) {
      const d = new THREE.Vector3(...VIEWS[name]).normalize();
      camera.position.copy(center).addScaledVector(d, radius * 10);
      camera.zoom = 1; camera.updateProjectionMatrix();
      controls.target.copy(center);
      controls.update();
    }

    /* 左下の座標軸 */
    const triScene = new THREE.Scene(), triCam = new THREE.OrthographicCamera(-1.7, 1.7, 1.7, -1.7, .1, 20);
    [[1, 0, 0, '#d92b2b', 'X'], [0, 1, 0, '#1f9d3a', 'Y'], [0, 0, 1, '#2456d6', 'Z']].forEach(([x, y, z, col, name]) => {
      const dir = new THREE.Vector3(x, y, z);
      triScene.add(new THREE.ArrowHelper(dir, new THREE.Vector3(), 1, col, .3, .16));
      const l = label(THREE, name, col); l.position.copy(dir).multiplyScalar(1.3); triScene.add(l);
    });

    if (toolbar) {
      toolbar.innerHTML = `
        <button class="tb-btn" data-view="iso"><i class="fa-solid fa-cube"></i> 等角</button>
        <button class="tb-btn" data-view="front">正面</button>
        <button class="tb-btn" data-view="top">上面</button>
        <button class="tb-btn" data-view="right">右側面</button>
        <div class="tb-sep"></div>
        <button class="tb-btn" data-edges title="角の線を表示／隠す"><i class="fa-solid fa-border-all"></i> エッジ</button>
        <div class="tb-sep"></div>
        <span style="font-size:11px;color:var(--muted);">
          <i class="fa-solid fa-circle-info"></i> 左／中ドラッグ: 回転 ・ 右ドラッグ: 移動 ・ ホイール: ズーム
        </span>`;
      toolbar.classList.add('visible');
      toolbar.onclick = e => {
        const b = e.target.closest('button'); if (!b) return;
        if (b.dataset.view) setView(b.dataset.view);
        else if (edges) { edges.visible = !edges.visible; b.style.opacity = edges.visible ? 1 : .5; }
      };
      if (!edges) toolbar.querySelector('[data-edges]').style.display = 'none';
    }

    frame(); setView('iso');
    const ro = new ResizeObserver(frame);
    ro.observe(container);

    let raf = 0, dead = false;
    const dir = new THREE.Vector3();
    (function loop() {
      if (dead) return;
      raf = requestAnimationFrame(loop);
      controls.update();
      renderer.clear();
      renderer.setViewport(0, 0, w, h);
      renderer.render(scene, camera);
      const s = Math.min(110, Math.max(70, Math.min(w, h) * .16));
      renderer.clearDepth();
      renderer.setViewport(6, 6, s, s);
      dir.copy(camera.position).sub(controls.target).normalize();
      triCam.position.copy(dir).multiplyScalar(6); triCam.quaternion.copy(camera.quaternion);
      renderer.render(triScene, triCam);
    })();

    return {
      setView,
      destroy() { dead = true; cancelAnimationFrame(raf); ro.disconnect(); controls.dispose(); renderer.dispose(); renderer.domElement.remove(); },
    };
  }

  return { open };
})();
