'use strict';
/* 3Dモデル（STL / STEP）に寸法を入れる。app/model3d.html の中で動く。

   - 「寸法を入れる」を押して2点を押すと、その間の長さを寸法として残す
   - 押した場所は 角（頂点）→ 稜線 → 面 の順に吸い付く。回転・拡大はそのまま使える（ドラッグは回転、押すだけが点の指定）
   - 寸法を押すと、直線／X／Y／Z の切り替え、図面の寸法のメモ、削除ができる
   - 図面（PDF）を横に並べて、見比べながら寸法を置ける
   モデルのファイルは書き換えない。寸法と図面の指定は親画面（ファイル詳細）経由で保存する。
   線と数字は 3D の上に重ねた SVG / HTML で描く（モデルの裏に隠れないようにするため）

   使い方: WnModelMeasure.attach({ viewer, stage, toolbar, host })
     host = { dims, drawing, save(payload), searchPdfs(q), fetchBuffer(id) } */
const WnModelMeasure = (() => {
  const SVGNS = 'http://www.w3.org/2000/svg';
  const AXES = ['x', 'y', 'z'];
  const MAX_DIMS = 300;
  const MOVE_SNAP_MAX_POINTS = 600000;   // 稜線の点がこれより多いモデルは、動かしている間の吸い付き表示を省く
  const MOVE_RAY_MAX_TRIS    = 300000;   // 三角形がこれより多いモデルは、動かしている間は面を調べない（押したときだけ調べる）
  const PDFJS = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/';

  const el = (tag, cls, text) => {
    const e = document.createElement(tag);
    if (cls) e.className = cls;
    if (text != null) e.textContent = text;
    return e;
  };
  const svgEl = (tag, cls) => { const e = document.createElementNS(SVGNS, tag); if (cls) e.setAttribute('class', cls); return e; };
  const fmt = n => (Math.round(n * 100) / 100).toFixed(2);

  function attach({ viewer, stage, toolbar, host }) {
    const { THREE, camera, mesh, edges, renderer, radius } = viewer.ctx;
    const coarse = window.matchMedia('(pointer: coarse)').matches;
    const SNAP_V = coarse ? 24 : 14, SNAP_E = coarse ? 14 : 8;

    let dims = (host.dims || []).filter(d => d && Array.isArray(d.a) && Array.isArray(d.b))
      .map(d => ({ id: String(d.id), a: d.a.map(Number), b: d.b.map(Number), axis: AXES.includes(d.axis) ? d.axis : null, note: d.note || '' }));
    let drawing = host.drawing || null;
    let measuring = false, shown = true, pending = null, hover = null, selectedId = null;

    /* ── 重ねる層（線は SVG、数字は HTML） ── */
    const svg = svgEl('svg', 'dm-svg');
    const labels = el('div', 'dm-labels');
    const marker = el('div', 'dm-marker');
    const hint = el('div', 'dm-hint');
    const panel = el('div', 'dm-panel');
    panel.hidden = true; hint.hidden = true; marker.hidden = true;
    stage.append(svg, labels, marker, hint, panel);
    const rubber = svgEl('line', 'dm-rubber'), pendDot = svgEl('circle', 'dm-dot dm-pend');
    pendDot.setAttribute('r', 4);
    svg.append(rubber, pendDot);
    const nodes = new Map();   // 寸法ID → { g, main, ext, ca, cb, label }

    /* ── ツールバー ── */
    const mkBtn = (icon, text, title) => {
      const b = el('button', 'tb-btn');
      b.type = 'button'; b.title = title || '';
      b.innerHTML = `<i class="fa-solid ${icon}"></i> `;
      b.append(el('b', 'tb-txt', text));
      return b;
    };
    const sep = el('div', 'tb-sep');
    const btnMeasure = mkBtn('fa-ruler', '寸法を入れる', '2点を押して長さを測り、寸法として残す');
    const btnShow    = mkBtn('fa-eye', '寸法 0', '入れた寸法を表示／隠す');
    const btnDraw    = mkBtn('fa-file-pdf', '図面', '図面（PDF）を横に並べる');
    const status     = el('b', 'dm-status');
    const hintSpan = toolbar.querySelector('span');
    /* 視点・エッジのボタンの後ろ、操作説明の前に入れる（寸法を入れる → 寸法 N → 図面 → 保存の状態） */
    if (hintSpan && hintSpan.previousElementSibling) hintSpan.previousElementSibling.before(sep); else toolbar.append(sep);
    sep.after(btnMeasure, btnShow, btnDraw, status);
    /* 3D表示側のツールバー処理は「視点以外のボタン＝エッジ切り替え」として扱うので、そこへ届かせない */
    const own = (b, fn) => b.addEventListener('click', e => { e.stopPropagation(); fn(); });
    own(btnMeasure, () => setMeasuring(!measuring));
    own(btnShow, () => { shown = !shown; if (!shown) { select(null); setMeasuring(false); } refresh(); });
    own(btnDraw, () => drawingPane.toggle());
    status.addEventListener('click', e => e.stopPropagation());

    /* ── 画面上の位置と、吸い付き ── */
    const m4 = new THREE.Matrix4(), v3 = new THREE.Vector3(), ray = new THREE.Raycaster(), ndc = new THREE.Vector2();
    const size = () => [stage.clientWidth || 1, stage.clientHeight || 1];
    function project(p, W, H) {
      v3.set(p[0], p[1], p[2]).project(camera);
      return [(v3.x + 1) / 2 * W, (1 - v3.y) / 2 * H];
    }
    const edgePos = edges ? edges.geometry.attributes.position.array : null;
    const tris = (mesh.geometry.index ? mesh.geometry.index.count : mesh.geometry.attributes.position.count) / 3;

    /* 押した位置(px,py)に対して、角 → 稜線 → 面 の順で一番近い点を返す。
       full=false（動かしている間）は重い処理を省く */
    function snapAt(px, py, full) {
      const [W, H] = size();
      camera.updateMatrixWorld();
      m4.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse);
      const e = m4.elements;

      /* 面との交点。モデルの裏側にある角や線を拾わないための目安にもなる */
      let hit = null, hitZ = Infinity;
      if (full || tris <= MOVE_RAY_MAX_TRIS) {
        ndc.set(px / W * 2 - 1, -(py / H * 2 - 1));
        ray.setFromCamera(ndc, camera);
        const hits = ray.intersectObject(mesh, false);
        if (hits.length) {
          hit = hits[0];
          const p = hit.point;
          hitZ = e[2] * p.x + e[6] * p.y + e[10] * p.z + e[14];
        }
      }
      /* 押した面より「少し奥」までは拾う。面が斜めだと、数ピクセル横の角は押した点より奥にあるので、
         吸い付く距離（ピクセル）を実寸に直した分だけ余裕を持たせる */
      const perPx = (camera.right - camera.left) / camera.zoom / W;
      const zTol = Math.max(radius * 0.03, SNAP_V * perPx * 4) * 2 / (camera.far - camera.near);
      const zMax = hit ? hitZ + zTol : Infinity;

      let best = null;   // { kind, p:[x,y,z], d }
      const tryVertex = (x, y, z, kind, limit) => {
        const sz = e[2] * x + e[6] * y + e[10] * z + e[14];
        if (sz > zMax) return;
        const sx = ((e[0] * x + e[4] * y + e[8] * z + e[12]) + 1) / 2 * W;
        const sy = (1 - (e[1] * x + e[5] * y + e[9] * z + e[13])) / 2 * H;
        const d = Math.hypot(sx - px, sy - py);
        if (d <= limit && (!best || d < best.d)) best = { kind, p: [x, y, z], d };
      };

      /* 押した面の3つの頂点（なめらかな面の上の点は稜線に出てこないので、ここで拾う） */
      if (hit && hit.face) {
        const pos = mesh.geometry.attributes.position;
        for (const i of [hit.face.a, hit.face.b, hit.face.c]) tryVertex(pos.getX(i), pos.getY(i), pos.getZ(i), 'vertex', SNAP_V);
      }

      if (edgePos && (full || edgePos.length / 3 <= MOVE_SNAP_MAX_POINTS)) {
        const n = edgePos.length;
        let edgeBest = null;
        for (let i = 0; i < n; i += 6) {
          const ax = edgePos[i], ay = edgePos[i + 1], az = edgePos[i + 2];
          const bx = edgePos[i + 3], by = edgePos[i + 4], bz = edgePos[i + 5];
          const sax = ((e[0] * ax + e[4] * ay + e[8] * az + e[12]) + 1) / 2 * W, say = (1 - (e[1] * ax + e[5] * ay + e[9] * az + e[13])) / 2 * H;
          const sbx = ((e[0] * bx + e[4] * by + e[8] * bz + e[12]) + 1) / 2 * W, sby = (1 - (e[1] * bx + e[5] * by + e[9] * bz + e[13])) / 2 * H;
          /* 線分から遠ければ飛ばす（ほとんどの線はここで落ちる） */
          if (Math.min(sax, sbx) - SNAP_V > px || Math.max(sax, sbx) + SNAP_V < px || Math.min(say, sby) - SNAP_V > py || Math.max(say, sby) + SNAP_V < py) continue;
          tryVertex(ax, ay, az, 'vertex', SNAP_V);
          tryVertex(bx, by, bz, 'vertex', SNAP_V);
          const dx = sbx - sax, dy = sby - say, len2 = dx * dx + dy * dy;
          if (len2 < 1e-6) continue;
          const t = Math.max(0, Math.min(1, ((px - sax) * dx + (py - say) * dy) / len2));
          const d = Math.hypot(sax + dx * t - px, say + dy * t - py);
          if (d > SNAP_E || (edgeBest && d >= edgeBest.d)) continue;
          /* 平行投影なので、画面上の割合 t はそのまま 3D 上の割合になる */
          const x = ax + (bx - ax) * t, y = ay + (by - ay) * t, z = az + (bz - az) * t;
          if (e[2] * x + e[6] * y + e[10] * z + e[14] > zMax) continue;
          edgeBest = { kind: 'edge', p: [x, y, z], d };
        }
        if (!best && edgeBest) best = edgeBest;
      }
      if (!best && hit) best = { kind: 'face', p: [hit.point.x, hit.point.y, hit.point.z], d: 0 };
      return best;
    }

    /* ── 寸法の値と形 ── */
    const comp = (d, ax) => Math.abs(d.b[AXES.indexOf(ax)] - d.a[AXES.indexOf(ax)]);
    const dist = d => Math.hypot(d.b[0] - d.a[0], d.b[1] - d.a[1], d.b[2] - d.a[2]);
    const value = d => d.axis ? comp(d, d.axis) : dist(d);
    /* X/Y/Z の寸法は、1点目から軸の向きにだけ進んだ点 c までを寸法線にし、c から2点目へは補助の点線を引く */
    function axisEnd(d) {
      if (!d.axis) return d.b;
      const c = d.a.slice(), i = AXES.indexOf(d.axis);
      c[i] = d.b[i];
      return c;
    }

    function build() {
      nodes.forEach(n => { n.g.remove(); n.label.remove(); });
      nodes.clear();
      for (const d of dims) {
        const g = svgEl('g', 'dm-dim');
        const main = svgEl('line', 'dm-line'), ext = svgEl('line', 'dm-ext');
        const ca = svgEl('circle', 'dm-dot'), cb = svgEl('circle', 'dm-dot');
        ca.setAttribute('r', 3.5); cb.setAttribute('r', 3.5);
        g.append(ext, main, ca, cb);
        svg.append(g);
        const label = el('button', 'dm-label');
        label.type = 'button';
        label.addEventListener('click', () => select(d.id));
        labels.append(label);
        nodes.set(d.id, { g, main, ext, ca, cb, label });
      }
      refresh();
    }

    /* 文字や選択状態など、3Dを動かしても変わらないところ */
    function refresh() {
      for (const d of dims) {
        const n = nodes.get(d.id); if (!n) continue;
        n.label.textContent = '';
        n.label.append(el('span', 'dm-val', (d.axis ? d.axis.toUpperCase() + ' ' : '') + fmt(value(d))));
        if (d.note) n.label.append(el('span', 'dm-note', d.note));
        const sel = d.id === selectedId;
        n.g.classList.toggle('sel', sel); n.label.classList.toggle('sel', sel);
      }
      svg.style.display = labels.style.display = shown ? '' : 'none';
      btnShow.querySelector('.tb-txt').textContent = '寸法 ' + dims.length;
      btnShow.querySelector('i').className = 'fa-solid ' + (shown ? 'fa-eye' : 'fa-eye-slash');
      btnShow.style.opacity = shown ? 1 : .55;
      btnMeasure.classList.toggle('on', measuring);
      stage.classList.toggle('dm-measuring', measuring);
      hint.hidden = !measuring;
      if (measuring) hint.textContent = pending ? '2点目を押してください' : '測りたい場所の1点目を押してください（角や線に吸い付きます）';
    }

    const setLine = (ln, p, q) => { ln.setAttribute('x1', p[0]); ln.setAttribute('y1', p[1]); ln.setAttribute('x2', q[0]); ln.setAttribute('y2', q[1]); };
    /* 3Dを描くたびに、線と数字を今の見え方に合わせて置き直す */
    let lastW = 0, lastH = 0;
    function layout() {
      const [W, H] = size();
      if (W !== lastW || H !== lastH) { svg.setAttribute('viewBox', `0 0 ${W} ${H}`); svg.setAttribute('width', W); svg.setAttribute('height', H); lastW = W; lastH = H; }
      if (shown) {
        for (const d of dims) {
          const n = nodes.get(d.id); if (!n) continue;
          const pa = project(d.a, W, H), pb = project(d.b, W, H), pc = d.axis ? project(axisEnd(d), W, H) : pb;
          setLine(n.main, pa, pc);
          n.ext.style.display = d.axis ? '' : 'none';
          if (d.axis) setLine(n.ext, pc, pb);
          n.ca.setAttribute('cx', pa[0]); n.ca.setAttribute('cy', pa[1]);
          n.cb.setAttribute('cx', pb[0]); n.cb.setAttribute('cy', pb[1]);
          n.label.style.transform = `translate(${(pa[0] + pc[0]) / 2}px, ${(pa[1] + pc[1]) / 2}px) translate(-50%, -50%)`;
        }
      }
      const showPend = measuring && pending;
      pendDot.style.display = showPend ? '' : 'none';
      rubber.style.display = showPend && hover ? '' : 'none';
      if (showPend) {
        const pp = project(pending, W, H);
        pendDot.setAttribute('cx', pp[0]); pendDot.setAttribute('cy', pp[1]);
        if (hover) setLine(rubber, pp, project(hover.p, W, H));
      }
      marker.hidden = !(measuring && hover);
      if (measuring && hover) {
        const ph = project(hover.p, W, H);
        marker.className = 'dm-marker ' + hover.kind;
        marker.style.transform = `translate(${ph[0]}px, ${ph[1]}px) translate(-50%, -50%)`;
        if (pending) {
          const l = Math.hypot(hover.p[0] - pending[0], hover.p[1] - pending[1], hover.p[2] - pending[2]);
          marker.dataset.len = fmt(l);
        } else delete marker.dataset.len;
      }
    }
    viewer.onFrame(layout);

    /* ── 保存（少し待ってまとめて送る） ── */
    let saveTimer = 0, saving = false, dirty = false;
    function setStatus(text, bad) { status.textContent = text; status.classList.toggle('bad', !!bad); }
    function queueSave() {
      dirty = true;
      clearTimeout(saveTimer);
      saveTimer = setTimeout(flush, 700);
    }
    async function flush(extra) {
      if (saving) { if (!extra) { saveTimer = setTimeout(flush, 300); return true; } }
      saving = true; dirty = false;
      setStatus('保存中…');
      let ok = false;
      try { ok = await host.save(Object.assign({ dims }, extra || {})); } catch (e) { console.error('[dims] save', e); }
      saving = false;
      setStatus(ok ? '保存しました' : '保存できませんでした', !ok);
      if (ok) setTimeout(() => { if (!dirty && !saving) setStatus(''); }, 2500);
      return ok;
    }

    /* ── 操作 ── */
    function setMeasuring(on) {
      measuring = on; pending = null; hover = null;
      if (on) { shown = true; select(null); }
      refresh();
    }
    function place(s) {
      if (!s) return;
      if (!pending) { pending = s.p; refresh(); return; }
      if (Math.hypot(s.p[0] - pending[0], s.p[1] - pending[1], s.p[2] - pending[2]) < radius * 1e-6) return;   // 同じ点を2回押した
      if (dims.length >= MAX_DIMS) { setStatus(`寸法は${MAX_DIMS}件までです`, true); pending = null; refresh(); return; }
      const d = { id: Date.now().toString(36) + Math.random().toString(36).slice(2, 7), a: pending, b: s.p, axis: null, note: '' };
      dims.push(d);
      pending = null; hover = null;
      build();
      queueSave();
    }
    function remove(id) {
      dims = dims.filter(d => d.id !== id);
      if (selectedId === id) select(null);
      build();
      queueSave();
    }

    function select(id) {
      selectedId = id;
      const d = dims.find(x => x.id === id);
      panel.hidden = !d;
      panel.textContent = '';
      if (d) {
        if (measuring) { measuring = false; pending = null; hover = null; }
        const head = el('div', 'dm-p-head');
        const big = el('b', 'dm-p-val', fmt(value(d)));
        const close = el('button', 'dm-p-x', '×'); close.type = 'button'; close.title = '閉じる';
        close.addEventListener('click', () => select(null));
        head.append(big, close);

        const seg = el('div', 'dm-seg');
        [[null, '直線', dist(d)], ['x', 'X', comp(d, 'x')], ['y', 'Y', comp(d, 'y')], ['z', 'Z', comp(d, 'z')]].forEach(([ax, name, val]) => {
          const b = el('button', d.axis === ax ? 'on' : '');
          b.type = 'button';
          b.append(el('span', '', name), el('b', '', fmt(val)));
          b.addEventListener('click', () => { d.axis = ax; queueSave(); select(d.id); });
          seg.append(b);
        });

        const lab = el('label', 'dm-p-note', '図面の寸法・メモ');
        const input = el('input');
        input.type = 'text'; input.maxLength = 60; input.value = d.note; input.placeholder = '例: 25±0.1';
        input.addEventListener('input', () => { d.note = input.value.trim(); refresh(); queueSave(); });
        input.addEventListener('keydown', e => { e.stopPropagation(); if (e.key === 'Enter') input.blur(); });
        lab.append(input);

        const del = el('button', 'dm-p-del');
        del.type = 'button';
        del.innerHTML = '<i class="fa-solid fa-trash"></i> この寸法を消す';
        del.addEventListener('click', () => remove(d.id));

        panel.append(head, seg, lab, del, el('div', 'dm-p-foot', '単位はモデルのデータのまま（ふつうは mm）'));
      }
      refresh();
    }

    /* 押す＝点の指定、ドラッグ＝回転。押してから指がほとんど動かなかったときだけ点として扱う */
    const canvas = renderer.domElement;
    let down = null, moveRaf = 0, lastMove = null;
    const local = e => { const r = stage.getBoundingClientRect(); return [e.clientX - r.left, e.clientY - r.top]; };
    const onDown = e => { down = { x: e.clientX, y: e.clientY, t: Date.now(), id: e.pointerId }; };
    const onUp = e => {
      const d = down; down = null;
      if (!d || d.id !== e.pointerId || e.button > 0) return;
      if (Math.hypot(e.clientX - d.x, e.clientY - d.y) > 6 || Date.now() - d.t > 700) return;
      if (measuring) { const [x, y] = local(e); place(snapAt(x, y, true)); }
      else if (selectedId) select(null);
    };
    const onMove = e => {
      if (!measuring || e.pointerType !== 'mouse' || e.buttons) { if (hover && e.buttons) hover = null; return; }
      lastMove = local(e);
      if (moveRaf) return;
      moveRaf = requestAnimationFrame(() => { moveRaf = 0; if (measuring && lastMove) hover = snapAt(lastMove[0], lastMove[1], false); });
    };
    const onLeave = () => { hover = null; lastMove = null; };
    const onKey = e => {
      if (e.key === 'Escape') {
        if (pending) { pending = null; hover = null; refresh(); }
        else if (measuring) setMeasuring(false);
        else if (selectedId) select(null);
      } else if ((e.key === 'Delete' || e.key === 'Backspace') && selectedId && !/^(INPUT|TEXTAREA)$/.test(e.target.tagName)) {
        remove(selectedId);
      }
    };
    canvas.addEventListener('pointerdown', onDown);
    canvas.addEventListener('pointerup', onUp);
    canvas.addEventListener('pointermove', onMove);
    canvas.addEventListener('pointerleave', onLeave);
    document.addEventListener('keydown', onKey);

    /* ── 図面（PDF）を横に並べる ── */
    const drawingPane = createDrawingPane({
      host,
      button: btnDraw,
      getDrawing: () => drawing,
      async setDrawing(next) {
        const ok = await flush({ drawing_file_id: next ? next.id : null });
        if (ok) drawing = next;
        return ok;
      },
    });
    if (drawing) btnDraw.classList.add('has');

    build();

    return {
      destroy() {
        clearTimeout(saveTimer);
        canvas.removeEventListener('pointerdown', onDown);
        canvas.removeEventListener('pointerup', onUp);
        canvas.removeEventListener('pointermove', onMove);
        canvas.removeEventListener('pointerleave', onLeave);
        document.removeEventListener('keydown', onKey);
        [svg, labels, marker, hint, panel, sep, btnMeasure, btnShow, btnDraw, status].forEach(n => n.remove());
        drawingPane.destroy();
      },
      /* 確認用（E2E） */
      _state: () => ({ dims, measuring, pending, selectedId, drawing }),
      _project: p => project(p, ...size()),
    };
  }

  /* 図面の表示。図面は読むだけで、寸法の読み取りはしない（人が見比べる） */
  function createDrawingPane({ host, button, getDrawing, setDrawing }) {
    const pane = document.getElementById('drawPane');
    const main = document.getElementById('main');
    pane.textContent = '';
    const head = el('div', 'dp-head');
    const name = el('span', 'dp-name');
    const prev = el('button', 'tb-btn', '‹'), next = el('button', 'tb-btn', '›'), pageNo = el('span', 'dp-page');
    const zoomOut = el('button', 'tb-btn', '−'), zoomIn = el('button', 'tb-btn', '＋'), fitBtn = el('button', 'tb-btn', '全体');
    const change = el('button', 'tb-btn', '図面を選ぶ'), close = el('button', 'tb-btn', '×');
    [prev, next, zoomOut, zoomIn, fitBtn, change, close].forEach(b => { b.type = 'button'; });
    prev.title = '前のページ'; next.title = '次のページ'; zoomOut.title = '縮小'; zoomIn.title = '拡大'; fitBtn.title = '全体を表示'; close.title = '図面を閉じる';
    head.append(name, prev, pageNo, next, zoomOut, zoomIn, fitBtn, change, close);
    const view = el('div', 'dp-view');
    const canvas = el('canvas');
    const note = el('div', 'dp-msg');
    view.append(canvas, note);
    const picker = el('div', 'dp-picker');
    picker.hidden = true;
    pane.append(head, view, picker);

    let open = false, pdf = null, pageNum = 1, zoom = 1, baseW = 0, baseH = 0, renderTask = null, loadedId = null, renderTimer = 0;

    const say = (text) => { note.textContent = text || ''; note.hidden = !text; canvas.style.display = text ? 'none' : ''; };

    function loadScript(src) {
      return new Promise((ok, ng) => {
        const s = document.createElement('script');
        s.src = src; s.onload = ok; s.onerror = () => ng(new Error('読み込み失敗'));
        document.head.appendChild(s);
      });
    }

    async function load() {
      const d = getDrawing();
      name.textContent = d ? d.file_name : '図面';
      name.title = d ? d.file_name : '';
      if (!d) { pdf = null; loadedId = null; say('横に並べる図面（PDF）を選んでください'); openPicker(); updateHead(); return; }
      if (loadedId === d.id && pdf) { say(''); return fit(); }
      say('図面を読み込み中…');
      try {
        if (!window.pdfjsLib) {
          await loadScript(PDFJS + 'pdf.min.js');
          window.pdfjsLib.GlobalWorkerOptions.workerSrc = PDFJS + 'pdf.worker.min.js';
        }
        const buffer = await host.fetchBuffer(d.id);
        if (!buffer) throw new Error('取得失敗');
        pdf = await window.pdfjsLib.getDocument({
          data: buffer,
          cMapUrl: 'https://unpkg.com/pdfjs-dist@3.11.174/cmaps/', cMapPacked: true,
          standardFontDataUrl: 'https://unpkg.com/pdfjs-dist@3.11.174/standard_fonts/',
        }).promise;
        loadedId = d.id; pageNum = 1;
        say('');
        await fit();
      } catch (e) {
        console.error('[dims] drawing', e);
        pdf = null; loadedId = null;
        say('図面を表示できませんでした');
      }
      updateHead();
    }

    function updateHead() {
      const many = pdf && pdf.numPages > 1;
      prev.style.display = next.style.display = pageNo.style.display = many ? '' : 'none';
      if (pdf) pageNo.textContent = `${pageNum} / ${pdf.numPages}`;
      [zoomOut, zoomIn, fitBtn].forEach(b => { b.style.display = pdf ? '' : 'none'; });
    }

    /* 枠に全体が入る大きさを 1 として、そこから拡大する */
    async function fit() {
      if (!pdf) return;
      const page = await pdf.getPage(pageNum);
      const vp = page.getViewport({ scale: 1 });
      const k = Math.min((view.clientWidth - 16) / vp.width, (view.clientHeight - 16) / vp.height);
      baseW = vp.width * k; baseH = vp.height * k; zoom = 1;
      applySize();
      await render();
      updateHead();
    }
    function applySize() {
      canvas.style.width = baseW * zoom + 'px'; canvas.style.height = baseH * zoom + 'px';
    }
    async function render() {
      if (!pdf || !baseW) return;
      const page = await pdf.getPage(pageNum);
      const vp1 = page.getViewport({ scale: 1 });
      /* 細い寸法文字が読めるよう画面の解像度に合わせて描く。大きくなりすぎると落ちるので上限を付ける */
      let scale = baseW * zoom / vp1.width * Math.min(window.devicePixelRatio || 1, 2);
      scale = Math.min(scale, 4600 / Math.max(vp1.width, vp1.height));
      const vp = page.getViewport({ scale });
      if (renderTask) { try { renderTask.cancel(); } catch (e) { /* 終わっている */ } }
      const off = document.createElement('canvas');
      off.width = Math.round(vp.width); off.height = Math.round(vp.height);
      const task = page.render({ canvasContext: off.getContext('2d'), viewport: vp });
      renderTask = task;
      try { await task.promise; } catch (e) { return; }   // 途中で次の描画に切り替わった
      if (renderTask !== task) return;
      canvas.width = off.width; canvas.height = off.height;
      canvas.getContext('2d').drawImage(off, 0, 0);
    }
    /* (cx, cy)＝枠の中の位置を動かさずに拡大・縮小する */
    function zoomTo(nz, cx, cy) {
      nz = Math.max(1, Math.min(12, nz));
      if (!pdf || nz === zoom) return;
      const r = view.getBoundingClientRect();
      if (cx == null) { cx = r.width / 2; cy = r.height / 2; }
      const c = canvas.getBoundingClientRect();
      const fx = (cx + r.left - c.left) / c.width, fy = (cy + r.top - c.top) / c.height;
      zoom = nz;
      applySize();
      const c2 = canvas.getBoundingClientRect();
      view.scrollLeft += (c2.left + c2.width * fx) - (r.left + cx);
      view.scrollTop  += (c2.top + c2.height * fy) - (r.top + cy);
      clearTimeout(renderTimer);
      renderTimer = setTimeout(render, 220);
    }

    view.addEventListener('wheel', e => {
      if (!pdf) return;
      e.preventDefault();
      const r = view.getBoundingClientRect();
      zoomTo(zoom * (e.deltaY < 0 ? 1.2 : 1 / 1.2), e.clientX - r.left, e.clientY - r.top);
    }, { passive: false });
    /* つかんで動かす／2本指で拡大 */
    const pts = new Map();
    let pinch = 0;
    view.addEventListener('pointerdown', e => {
      if (e.target.closest('.dp-picker')) return;
      pts.set(e.pointerId, [e.clientX, e.clientY]);
      view.setPointerCapture(e.pointerId);
      if (pts.size === 2) { const [p, q] = [...pts.values()]; pinch = Math.hypot(p[0] - q[0], p[1] - q[1]); }
    });
    view.addEventListener('pointermove', e => {
      const p = pts.get(e.pointerId); if (!p) return;
      if (pts.size === 1) { view.scrollLeft -= e.clientX - p[0]; view.scrollTop -= e.clientY - p[1]; }
      pts.set(e.pointerId, [e.clientX, e.clientY]);
      if (pts.size === 2 && pinch) {
        const [a, b] = [...pts.values()], d = Math.hypot(a[0] - b[0], a[1] - b[1]);
        const r = view.getBoundingClientRect();
        zoomTo(zoom * d / pinch, (a[0] + b[0]) / 2 - r.left, (a[1] + b[1]) / 2 - r.top);
        pinch = d;
      }
    });
    const drop = e => { pts.delete(e.pointerId); pinch = 0; };
    view.addEventListener('pointerup', drop);
    view.addEventListener('pointercancel', drop);

    prev.addEventListener('click', () => { if (pdf && pageNum > 1) { pageNum--; fit(); } });
    next.addEventListener('click', () => { if (pdf && pageNum < pdf.numPages) { pageNum++; fit(); } });
    zoomIn.addEventListener('click', () => zoomTo(zoom * 1.4));
    zoomOut.addEventListener('click', () => zoomTo(zoom / 1.4));
    fitBtn.addEventListener('click', fit);
    close.addEventListener('click', () => toggle(false));
    change.addEventListener('click', () => (picker.hidden ? openPicker() : closePicker()));

    /* ── 図面を選ぶ ── */
    let searchSeq = 0, searchTimer = 0;
    function closePicker() { picker.hidden = true; }
    function openPicker() {
      picker.hidden = false;
      picker.textContent = '';
      const input = el('input');
      input.type = 'search'; input.placeholder = '図面（PDF）の名前で探す';
      const list = el('div', 'dp-list');
      const foot = el('div', 'dp-foot');
      if (getDrawing()) {
        const off = el('button', 'tb-btn', '図面をはずす'); off.type = 'button';
        off.addEventListener('click', async () => { if (await setDrawing(null)) { button.classList.remove('has'); closePicker(); load(); } });
        foot.append(off);
      }
      const cancel = el('button', 'tb-btn', '閉じる'); cancel.type = 'button';
      cancel.addEventListener('click', closePicker);
      foot.append(cancel);
      picker.append(input, list, foot);
      const run = async () => {
        const seq = ++searchSeq;
        list.textContent = '';
        list.append(el('div', 'dp-empty', '探しています…'));
        let files = [];
        try { files = await host.searchPdfs(input.value.trim()); } catch (e) { console.error('[dims] search', e); }
        if (seq !== searchSeq) return;
        list.textContent = '';
        if (!files.length) { list.append(el('div', 'dp-empty', input.value.trim() ? '該当するPDFがありません' : '名前を入れて探してください')); return; }
        for (const f of files.slice(0, 30)) {
          const row = el('button', 'dp-row');
          row.type = 'button';
          row.innerHTML = '<i class="fa-solid fa-file-pdf"></i> ';
          row.append(el('span', '', f.file_name));
          row.addEventListener('click', async () => {
            row.disabled = true;
            if (await setDrawing({ id: f.id, file_name: f.file_name })) { button.classList.add('has'); closePicker(); load(); }
            else { row.disabled = false; list.prepend(el('div', 'dp-empty', '図面を設定できませんでした')); }
          });
          list.append(row);
        }
      };
      input.addEventListener('input', () => { clearTimeout(searchTimer); searchTimer = setTimeout(run, 350); });
      input.addEventListener('keydown', e => e.stopPropagation());
      run();
    }

    function toggle(force) {
      open = force == null ? !open : force;
      main.classList.toggle('with-drawing', open);
      pane.hidden = !open;
      button.classList.toggle('on', open);
      if (open) { closePicker(); load(); }
    }
    const ro = new ResizeObserver(() => { if (open && pdf && zoom === 1) { clearTimeout(renderTimer); renderTimer = setTimeout(fit, 150); } });
    ro.observe(view);

    return {
      toggle: () => toggle(),
      destroy() { ro.disconnect(); clearTimeout(renderTimer); clearTimeout(searchTimer); toggle(false); pane.textContent = ''; },
    };
  }

  return { attach };
})();
