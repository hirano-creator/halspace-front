'use strict';

/* ===== Three.js 3Dビューア（STLLoader + OrbitControls） ===== */

let scene, camera, renderer, controls, animId;

function initViewer(canvasEl) {
  // シーン・カメラ
  scene = new THREE.Scene();
  scene.background = new THREE.Color(0xf4f4f4);

  const w = canvasEl.clientWidth;
  const h = canvasEl.clientHeight;
  camera = new THREE.PerspectiveCamera(45, w / h, 0.01, 2000);
  camera.position.set(60, 60, 100);

  // レンダラー
  renderer = new THREE.WebGLRenderer({ canvas: canvasEl, antialias: true });
  renderer.setSize(w, h);
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.shadowMap.enabled = true;

  // ライト
  const ambient = new THREE.AmbientLight(0xffffff, 0.5);
  scene.add(ambient);
  const dir1 = new THREE.DirectionalLight(0xffffff, 1.0);
  dir1.position.set(100, 100, 100);
  dir1.castShadow = true;
  scene.add(dir1);
  const dir2 = new THREE.DirectionalLight(0x8888ff, 0.4);
  dir2.position.set(-60, -40, -60);
  scene.add(dir2);

  // グリッド
  const grid = new THREE.GridHelper(200, 20, 0x334455, 0x223344);
  scene.add(grid);

  // OrbitControls
  controls = new THREE.OrbitControls(camera, renderer.domElement);
  controls.enableDamping = true;
  controls.dampingFactor = 0.08;
  controls.minDistance = 5;
  controls.maxDistance = 1000;

  // リサイズ対応
  const ro = new ResizeObserver(() => {
    const nw = canvasEl.clientWidth;
    const nh = canvasEl.clientHeight;
    camera.aspect = nw / nh;
    camera.updateProjectionMatrix();
    renderer.setSize(nw, nh);
  });
  ro.observe(canvasEl.parentElement);

  animate();
}

function animate() {
  animId = requestAnimationFrame(animate);
  controls.update();
  renderer.render(scene, camera);
}

function disposeViewer() {
  if (animId) cancelAnimationFrame(animId);
  if (renderer) renderer.dispose();
}

/* ===== STL ファイルのロード ===== */
function loadSTL(url, onProgress) {
  return new Promise((resolve, reject) => {
    const loader = new THREE.STLLoader();
    loader.load(
      url,
      geometry => {
        geometry.computeVertexNormals();
        geometry.center();

        const mat = new THREE.MeshPhongMaterial({
          color: 0x888888,
          specular: 0xffffff,
          shininess: 80,
          side: THREE.DoubleSide,
        });
        const mesh = new THREE.Mesh(geometry, mat);
        mesh.castShadow = true;
        mesh.receiveShadow = true;

        // シーン内の前のモデルを削除
        scene.children
          .filter(o => o.isMesh)
          .forEach(o => scene.remove(o));

        scene.add(mesh);

        // カメラをモデルに合わせる
        const box = new THREE.Box3().setFromObject(mesh);
        const size = box.getSize(new THREE.Vector3());
        const center = box.getCenter(new THREE.Vector3());
        const maxDim = Math.max(size.x, size.y, size.z);
        camera.position.set(center.x + maxDim * 1.5, center.y + maxDim, center.z + maxDim * 1.5);
        controls.target.copy(center);
        controls.update();

        resolve(mesh);
      },
      xhr => onProgress && onProgress(xhr.loaded / xhr.total),
      err => reject(err)
    );
  });
}

/* ===== ダミーSTL（ファイル未生成時の代替表示） ===== */
function showPlaceholder(partName) {
  scene.children
    .filter(o => o.isMesh)
    .forEach(o => scene.remove(o));

  const geo = new THREE.BoxGeometry(20, 20, 20);
  const mat = new THREE.MeshPhongMaterial({ color: 0x78909c, wireframe: false });
  const mesh = new THREE.Mesh(geo, mat);
  scene.add(mesh);
  camera.position.set(50, 40, 50);
  controls.target.set(0, 0, 0);
  controls.update();
}

/* ===== リセット・フロントビュー ===== */
function resetCamera() {
  camera.position.set(60, 60, 100);
  controls.target.set(0, 0, 0);
  controls.update();
}
