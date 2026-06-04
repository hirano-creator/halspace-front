'use strict';

/* ===== カテゴリー定義 ===== */
const CATEGORIES = [
  { id: 'fasteners',  name: 'ボルト・ナット',   icon: 'fa-solid fa-screwdriver', iconClass: 'cat-fasteners',  type: 'download', spec: 'JIS B 1176 / ISO 4762' },
  { id: 'washers',    name: '座金・止め輪',     icon: 'fa-solid fa-ring',        iconClass: 'cat-washers',    type: 'download', spec: 'JIS B 1256 / JIS B 2804' },
  { id: 'bearings',   name: 'ベアリング',        icon: 'fa-solid fa-circle-dot',  iconClass: 'cat-bearings',   type: 'download', spec: 'JIS B 1521' },
  { id: 'linear',     name: 'リニアガイド',      icon: 'fa-solid fa-left-right',  iconClass: 'cat-linear',     type: 'download', spec: '外形のみ（干渉チェック用）' },
  { id: 'gears',      name: '歯車',              icon: 'fa-solid fa-gear',        iconClass: 'cat-gears',      type: 'download', spec: 'JIS B 1702' },
  { id: 'frames',     name: 'アルミフレーム',    icon: 'fa-solid fa-border-all',  iconClass: 'cat-frames',     type: 'download', spec: 'MISUMI / 八光 互換' },
  { id: 'couplings',  name: 'カップリング',      icon: 'fa-solid fa-link',        iconClass: 'cat-couplings',  type: 'download', spec: '外形参照用' },
  { id: 'pulleys',    name: 'タイミングプーリー', icon: 'fa-solid fa-compact-disc',iconClass: 'cat-pulleys',    type: 'download', spec: 'GT2 / MXL / HTD' },
  { id: 'pneumatics', name: 'エアシリンダー',    icon: 'fa-solid fa-wind',        iconClass: 'cat-pneumatics', type: 'link',     spec: 'SMC / CKD' },
  { id: 'valves',     name: '電磁弁',            icon: 'fa-solid fa-sliders',     iconClass: 'cat-valves',     type: 'link',     spec: 'SMC VQ・SYシリーズ' },
  { id: 'motors',     name: 'モーター',          icon: 'fa-solid fa-bolt',        iconClass: 'cat-motors',     type: 'link',     spec: 'NEMA17/23・各社サーボ' },
  { id: 'clamps',     name: '治具・クランプ',    icon: 'fa-solid fa-hand-fist',   iconClass: 'cat-clamps',     type: 'link',     spec: 'SUGATSUNE / BEST' },
];

/* ===== 部品データ（download = 自動生成STEP/STL配布、link = メーカーサイトへ誘導） ===== */
const PARTS = [

  /* ── ボルト・ナット ── */
  { id: 'bolt-hex-m3',  name: '六角ボルト M3',    cat: 'fasteners', spec: 'JIS B 1180', type: 'download',
    files: { step: 'data/models/fasteners/hex_bolt/hex_bolt_m3x16.step', stl: 'data/models/fasteners/hex_bolt/hex_bolt_m3x16.stl', iges: 'data/models/fasteners/hex_bolt/hex_bolt_m3x16.igs' },
    tags: ['ボルト', 'M3', 'JIS'], thumb: '🔩',
    params: { thread: 'M3', d: 3, pitch: 0.5, s: 5.5, k: 2 } },
  { id: 'bolt-hex-m4',  name: '六角ボルト M4',    cat: 'fasteners', spec: 'JIS B 1180', type: 'download',
    files: { step: 'data/models/fasteners/hex_bolt/hex_bolt_m4x20.step', stl: 'data/models/fasteners/hex_bolt/hex_bolt_m4x20.stl', iges: 'data/models/fasteners/hex_bolt/hex_bolt_m4x20.igs' },
    tags: ['ボルト', 'M4', 'JIS'], thumb: '🔩',
    params: { thread: 'M4', d: 4, pitch: 0.7, s: 7, k: 2.8 } },
  { id: 'bolt-hex-m5',  name: '六角ボルト M5',    cat: 'fasteners', spec: 'JIS B 1180', type: 'download',
    files: { step: 'data/models/fasteners/hex_bolt/hex_bolt_m5x20.step', stl: 'data/models/fasteners/hex_bolt/hex_bolt_m5x20.stl', iges: 'data/models/fasteners/hex_bolt/hex_bolt_m5x20.igs' },
    tags: ['ボルト', 'M5', 'JIS'], thumb: '🔩',
    params: { thread: 'M5', d: 5, pitch: 0.8, s: 8, k: 3.5 } },
  { id: 'bolt-hex-m6',  name: '六角ボルト M6',    cat: 'fasteners', spec: 'JIS B 1180', type: 'download',
    files: { step: 'data/models/fasteners/hex_bolt/hex_bolt_m6x25.step', stl: 'data/models/fasteners/hex_bolt/hex_bolt_m6x25.stl', iges: 'data/models/fasteners/hex_bolt/hex_bolt_m6x25.igs' },
    tags: ['ボルト', 'M6', 'JIS'], thumb: '🔩',
    params: { thread: 'M6', d: 6, pitch: 1.0, s: 10, k: 4 } },
  { id: 'bolt-hex-m8',  name: '六角ボルト M8',    cat: 'fasteners', spec: 'JIS B 1180', type: 'download',
    files: { step: 'data/models/fasteners/hex_bolt/hex_bolt_m8x30.step', stl: 'data/models/fasteners/hex_bolt/hex_bolt_m8x30.stl', iges: 'data/models/fasteners/hex_bolt/hex_bolt_m8x30.igs' },
    tags: ['ボルト', 'M8', 'JIS'], thumb: '🔩',
    params: { thread: 'M8', d: 8, pitch: 1.25, s: 13, k: 5.5 } },
  { id: 'bolt-hex-m10', name: '六角ボルト M10',   cat: 'fasteners', spec: 'JIS B 1180', type: 'download',
    files: { step: 'data/models/fasteners/hex_bolt/hex_bolt_m10x35.step', stl: 'data/models/fasteners/hex_bolt/hex_bolt_m10x35.stl', iges: 'data/models/fasteners/hex_bolt/hex_bolt_m10x35.igs' },
    tags: ['ボルト', 'M10', 'JIS'], thumb: '🔩',
    params: { thread: 'M10', d: 10, pitch: 1.5, s: 17, k: 6.4 } },
  { id: 'bolt-hex-m12', name: '六角ボルト M12',   cat: 'fasteners', spec: 'JIS B 1180', type: 'download',
    files: { step: 'data/models/fasteners/hex_bolt/hex_bolt_m12x40.step', stl: 'data/models/fasteners/hex_bolt/hex_bolt_m12x40.stl', iges: 'data/models/fasteners/hex_bolt/hex_bolt_m12x40.igs' },
    tags: ['ボルト', 'M12', 'JIS'], thumb: '🔩',
    params: { thread: 'M12', d: 12, pitch: 1.75, s: 19, k: 7.5 } },
  { id: 'cap-m4',   name: 'キャップスクリュー M4', cat: 'fasteners', spec: 'JIS B 1176 / ISO 4762', type: 'download',
    files: { stl: 'models/fasteners/cap_m4.stl' },
    tags: ['キャップスクリュー', 'M4', 'JIS', 'ISO'], thumb: '🔩',
    params: { thread: 'M4', d: 4, dk: 7, k: 4 } },
  { id: 'cap-m5',   name: 'キャップスクリュー M5', cat: 'fasteners', spec: 'JIS B 1176 / ISO 4762', type: 'download',
    files: { stl: 'models/fasteners/cap_m5.stl' },
    tags: ['キャップスクリュー', 'M5', 'JIS', 'ISO'], thumb: '🔩',
    params: { thread: 'M5', d: 5, dk: 8.5, k: 5 } },
  { id: 'cap-m6',   name: 'キャップスクリュー M6', cat: 'fasteners', spec: 'JIS B 1176 / ISO 4762', type: 'download',
    files: { stl: 'models/fasteners/cap_m6.stl' },
    tags: ['キャップスクリュー', 'M6', 'JIS', 'ISO'], thumb: '🔩',
    params: { thread: 'M6', d: 6, dk: 10, k: 6 } },
  { id: 'nut-hex-m4',  name: '六角ナット M4',  cat: 'fasteners', spec: 'JIS B 1181', type: 'download',
    files: { step: 'data/models/fasteners/hex_nut/hex_nut_m4.step', stl: 'data/models/fasteners/hex_nut/hex_nut_m4.stl', iges: 'data/models/fasteners/hex_nut/hex_nut_m4.igs' },
    tags: ['ナット', 'M4', 'JIS'], thumb: '🔩', params: { thread: 'M4', s: 7, m: 3.2 } },
  { id: 'nut-hex-m6',  name: '六角ナット M6',  cat: 'fasteners', spec: 'JIS B 1181', type: 'download',
    files: { step: 'data/models/fasteners/hex_nut/hex_nut_m6.step', stl: 'data/models/fasteners/hex_nut/hex_nut_m6.stl', iges: 'data/models/fasteners/hex_nut/hex_nut_m6.igs' },
    tags: ['ナット', 'M6', 'JIS'], thumb: '🔩', params: { thread: 'M6', s: 10, m: 5 } },

  /* ── 座金・止め輪 ── */
  { id: 'washer-flat-m4', name: '平座金 M4', cat: 'washers', spec: 'JIS B 1256', type: 'download',
    files: { step: 'data/models/fasteners/flat_washer/flat_washer_m4.step', stl: 'data/models/fasteners/flat_washer/flat_washer_m4.stl', iges: 'data/models/fasteners/flat_washer/flat_washer_m4.igs' },
    tags: ['平座金', 'M4', 'JIS'], thumb: '⭕',
    params: { d1: 4.3, d2: 9, h: 0.9 } },
  { id: 'washer-flat-m6', name: '平座金 M6', cat: 'washers', spec: 'JIS B 1256', type: 'download',
    files: { step: 'data/models/fasteners/flat_washer/flat_washer_m6.step', stl: 'data/models/fasteners/flat_washer/flat_washer_m6.stl', iges: 'data/models/fasteners/flat_washer/flat_washer_m6.igs' },
    tags: ['平座金', 'M6', 'JIS'], thumb: '⭕',
    params: { d1: 6.4, d2: 12, h: 1.6 } },
  { id: 'washer-flat-m8', name: '平座金 M8', cat: 'washers', spec: 'JIS B 1256', type: 'download',
    files: { step: 'data/models/fasteners/flat_washer/flat_washer_m8.step', stl: 'data/models/fasteners/flat_washer/flat_washer_m8.stl', iges: 'data/models/fasteners/flat_washer/flat_washer_m8.igs' },
    tags: ['平座金', 'M8', 'JIS'], thumb: '⭕',
    params: { d1: 8.4, d2: 16, h: 1.6 } },
  { id: 'snap-ring-s10', name: 'スナップリング（軸用）S10', cat: 'washers', spec: 'JIS B 2804', type: 'download',
    files: { stl: 'models/fasteners/snapring_s10.stl' },
    tags: ['スナップリング', '軸用', 'JIS'], thumb: '⭕',
    params: { d: 10, d1: 9.6, b: 1.1, t: 1 } },
  { id: 'snap-ring-s15', name: 'スナップリング（軸用）S15', cat: 'washers', spec: 'JIS B 2804', type: 'download',
    files: { stl: 'models/fasteners/snapring_s15.stl' },
    tags: ['スナップリング', '軸用', 'JIS'], thumb: '⭕',
    params: { d: 15, d1: 14.5, b: 1.1, t: 1 } },
  { id: 'e-ring-e6', name: 'Eリング E6', cat: 'washers', spec: 'JIS B 2804', type: 'download',
    files: { stl: 'models/fasteners/ering_e6.stl' },
    tags: ['Eリング', 'E6', 'JIS'], thumb: '⭕',
    params: { d: 6, d1: 5.5, b: 0.9, t: 0.7 } },

  /* ── ベアリング ── */
  { id: 'brg-6000', name: '深溝ボールベアリング 6000', cat: 'bearings', spec: 'JIS B 1521', type: 'download',
    files: { step: 'data/models/bearings/ball_bearing/bearing_6000.step', stl: 'data/models/bearings/ball_bearing/bearing_6000.stl', iges: 'data/models/bearings/ball_bearing/bearing_6000.igs' },
    tags: ['ベアリング', '6000系', 'JIS'], thumb: '⚙️',
    params: { d: 10, D: 26, B: 8, C: 3.75 } },
  { id: 'brg-6001', name: '深溝ボールベアリング 6001', cat: 'bearings', spec: 'JIS B 1521', type: 'download',
    files: { step: 'data/models/bearings/ball_bearing/bearing_6001.step', stl: 'data/models/bearings/ball_bearing/bearing_6001.stl', iges: 'data/models/bearings/ball_bearing/bearing_6001.igs' },
    tags: ['ベアリング', '6000系', 'JIS'], thumb: '⚙️',
    params: { d: 12, D: 28, B: 8, C: 5.1 } },
  { id: 'brg-6002', name: '深溝ボールベアリング 6002', cat: 'bearings', spec: 'JIS B 1521', type: 'download',
    files: { step: 'data/models/bearings/ball_bearing/bearing_6002.step', stl: 'data/models/bearings/ball_bearing/bearing_6002.stl', iges: 'data/models/bearings/ball_bearing/bearing_6002.igs' },
    tags: ['ベアリング', '6000系', 'JIS'], thumb: '⚙️',
    params: { d: 15, D: 32, B: 9, C: 5.6 } },
  { id: 'brg-6200', name: '深溝ボールベアリング 6200', cat: 'bearings', spec: 'JIS B 1521', type: 'download',
    files: { step: 'data/models/bearings/ball_bearing/bearing_6200.step', stl: 'data/models/bearings/ball_bearing/bearing_6200.stl', iges: 'data/models/bearings/ball_bearing/bearing_6200.igs' },
    tags: ['ベアリング', '6200系', 'JIS'], thumb: '⚙️',
    params: { d: 10, D: 30, B: 9, C: 5.1 } },
  { id: 'brg-6204', name: '深溝ボールベアリング 6204', cat: 'bearings', spec: 'JIS B 1521', type: 'download',
    files: { step: 'data/models/bearings/ball_bearing/bearing_6204.step', stl: 'data/models/bearings/ball_bearing/bearing_6204.stl', iges: 'data/models/bearings/ball_bearing/bearing_6204.igs' },
    tags: ['ベアリング', '6200系', 'JIS'], thumb: '⚙️',
    params: { d: 20, D: 47, B: 14, C: 12.7 } },
  { id: 'brg-6205', name: '深溝ボールベアリング 6205', cat: 'bearings', spec: 'JIS B 1521', type: 'download',
    files: { step: 'data/models/bearings/ball_bearing/bearing_6205.step', stl: 'data/models/bearings/ball_bearing/bearing_6205.stl', iges: 'data/models/bearings/ball_bearing/bearing_6205.igs' },
    tags: ['ベアリング', '6200系', 'JIS'], thumb: '⚙️',
    params: { d: 25, D: 52, B: 15, C: 14.0 } },
  { id: 'brg-6300', name: '深溝ボールベアリング 6300', cat: 'bearings', spec: 'JIS B 1521', type: 'download',
    files: { step: 'data/models/bearings/ball_bearing/bearing_6300.step', stl: 'data/models/bearings/ball_bearing/bearing_6300.stl', iges: 'data/models/bearings/ball_bearing/bearing_6300.igs' },
    tags: ['ベアリング', '6300系', 'JIS'], thumb: '⚙️',
    params: { d: 10, D: 35, B: 11, C: 8.06 } },

  /* ── リニアガイド ── */
  { id: 'lg-hsr15', name: 'リニアガイド HSR15（外形）', cat: 'linear', spec: 'THK HSR型 外形のみ', type: 'download',
    files: { step: 'models/frames/lg_hsr15.step', stl: 'models/frames/lg_hsr15.stl' },
    tags: ['リニアガイド', 'THK', 'HSR15'], thumb: '📏',
    params: { W: 34, H: 28, B: 15, L_block: 55 } },
  { id: 'lg-hsr20', name: 'リニアガイド HSR20（外形）', cat: 'linear', spec: 'THK HSR型 外形のみ', type: 'download',
    files: { step: 'models/frames/lg_hsr20.step', stl: 'models/frames/lg_hsr20.stl' },
    tags: ['リニアガイド', 'THK', 'HSR20'], thumb: '📏',
    params: { W: 44, H: 36, B: 20, L_block: 67.5 } },

  /* ── 歯車 ── */
  { id: 'gear-sp-m1-20t', name: '平歯車 M1 歯数20', cat: 'gears', spec: 'JIS B 1702 インボリュート歯形', type: 'download',
    files: { step: 'models/gears/gear_m1_20t.step', stl: 'models/gears/gear_m1_20t.stl' },
    tags: ['平歯車', 'モジュール1', 'M1', '20歯'], thumb: '⚙️',
    params: { m: 1, z: 20, d: 20, ha: 1, b: 10 } },
  { id: 'gear-sp-m2-20t', name: '平歯車 M2 歯数20', cat: 'gears', spec: 'JIS B 1702 インボリュート歯形', type: 'download',
    files: { step: 'models/gears/gear_m2_20t.step', stl: 'models/gears/gear_m2_20t.stl' },
    tags: ['平歯車', 'モジュール2', 'M2', '20歯'], thumb: '⚙️',
    params: { m: 2, z: 20, d: 40, ha: 2, b: 20 } },
  { id: 'gear-sp-m2-40t', name: '平歯車 M2 歯数40', cat: 'gears', spec: 'JIS B 1702 インボリュート歯形', type: 'download',
    files: { step: 'models/gears/gear_m2_40t.step', stl: 'models/gears/gear_m2_40t.stl' },
    tags: ['平歯車', 'モジュール2', 'M2', '40歯'], thumb: '⚙️',
    params: { m: 2, z: 40, d: 80, ha: 2, b: 20 } },
  { id: 'gear-sp-m3-30t', name: '平歯車 M3 歯数30', cat: 'gears', spec: 'JIS B 1702 インボリュート歯形', type: 'download',
    files: { step: 'models/gears/gear_m3_30t.step', stl: 'models/gears/gear_m3_30t.stl' },
    tags: ['平歯車', 'モジュール3', 'M3', '30歯'], thumb: '⚙️',
    params: { m: 3, z: 30, d: 90, ha: 3, b: 25 } },

  /* ── アルミフレーム ── */
  { id: 'frame-20x20', name: 'アルミフレーム 20×20 L=500', cat: 'frames', spec: 'MISUMI互換 HFS5シリーズ', type: 'download',
    files: { step: 'models/frames/frame_20x20_500.step', stl: 'models/frames/frame_20x20_500.stl' },
    tags: ['アルミフレーム', '20x20', 'HFS5'], thumb: '🏗️',
    params: { W: 20, H: 20, L: 500 } },
  { id: 'frame-40x40', name: 'アルミフレーム 40×40 L=500', cat: 'frames', spec: 'MISUMI互換 HFS8シリーズ', type: 'download',
    files: { step: 'models/frames/frame_40x40_500.step', stl: 'models/frames/frame_40x40_500.stl' },
    tags: ['アルミフレーム', '40x40', 'HFS8'], thumb: '🏗️',
    params: { W: 40, H: 40, L: 500 } },
  { id: 'frame-40x80', name: 'アルミフレーム 40×80 L=500', cat: 'frames', spec: 'MISUMI互換 HFS8シリーズ', type: 'download',
    files: { step: 'models/frames/frame_40x80_500.step', stl: 'models/frames/frame_40x80_500.stl' },
    tags: ['アルミフレーム', '40x80', 'HFS8'], thumb: '🏗️',
    params: { W: 40, H: 80, L: 500 } },
  { id: 'frame-80x80', name: 'アルミフレーム 80×80 L=500', cat: 'frames', spec: 'MISUMI互換 HFS8シリーズ', type: 'download',
    files: { step: 'models/frames/frame_80x80_500.step', stl: 'models/frames/frame_80x80_500.stl' },
    tags: ['アルミフレーム', '80x80', 'HFS8'], thumb: '🏗️',
    params: { W: 80, H: 80, L: 500 } },

  /* ── カップリング ── */
  { id: 'coupling-jaw-d14-d6',   name: 'ジョーカップリング D14×d6',  cat: 'couplings', spec: '外形参照用', type: 'download',
    files: { step: 'models/couplings/jaw_d14_d6.step', stl: 'models/couplings/jaw_d14_d6.stl' },
    tags: ['カップリング', 'ジョー型', 'D14'], thumb: '🔗',
    params: { D: 14, d: 6, L: 22 } },
  { id: 'coupling-jaw-d19-d8',   name: 'ジョーカップリング D19×d8',  cat: 'couplings', spec: '外形参照用', type: 'download',
    files: { step: 'models/couplings/jaw_d19_d8.step', stl: 'models/couplings/jaw_d19_d8.stl' },
    tags: ['カップリング', 'ジョー型', 'D19'], thumb: '🔗',
    params: { D: 19, d: 8, L: 28 } },
  { id: 'coupling-oldham-d30',   name: 'オルダムカップリング D30',    cat: 'couplings', spec: '外形参照用', type: 'download',
    files: { step: 'models/couplings/oldham_d30.step', stl: 'models/couplings/oldham_d30.stl' },
    tags: ['カップリング', 'オルダム', 'D30'], thumb: '🔗',
    params: { D: 30, d: 8, L: 33 } },

  /* ── タイミングプーリー ── */
  { id: 'pulley-gt2-16t-5b', name: 'タイミングプーリー GT2 16T ボア5mm', cat: 'pulleys', spec: 'GT2 2mm ピッチ', type: 'download',
    files: { step: 'models/frames/pulley_gt2_16t.step', stl: 'models/frames/pulley_gt2_16t.stl' },
    tags: ['タイミングプーリー', 'GT2', '16歯'], thumb: '💿',
    params: { teeth: 16, pitch: 2, bore: 5, width: 6 } },
  { id: 'pulley-gt2-20t-5b', name: 'タイミングプーリー GT2 20T ボア5mm', cat: 'pulleys', spec: 'GT2 2mm ピッチ', type: 'download',
    files: { step: 'models/frames/pulley_gt2_20t.step', stl: 'models/frames/pulley_gt2_20t.stl' },
    tags: ['タイミングプーリー', 'GT2', '20歯'], thumb: '💿',
    params: { teeth: 20, pitch: 2, bore: 5, width: 6 } },

  /* ── エアシリンダー（メーカーリンク） ── */
  { id: 'smc-cq2b20-10', name: 'SMC コンパクトシリンダー CQ2B20-10D', cat: 'pneumatics', spec: 'SMC CQ2Bシリーズ φ20', type: 'link',
    link: 'https://www.smcworld.com/products/ja/series.do?ca_id=115&tab=cad&ds_id=11-CQ2B',
    tags: ['エアシリンダー', 'SMC', 'CQ2B', 'φ20'], thumb: '🫧',
    params: { bore: 20, stroke: 10 } },
  { id: 'smc-cq2b40-50', name: 'SMC コンパクトシリンダー CQ2B40-50D', cat: 'pneumatics', spec: 'SMC CQ2Bシリーズ φ40', type: 'link',
    link: 'https://www.smcworld.com/products/ja/series.do?ca_id=115&tab=cad&ds_id=11-CQ2B',
    tags: ['エアシリンダー', 'SMC', 'CQ2B', 'φ40'], thumb: '🫧',
    params: { bore: 40, stroke: 50 } },
  { id: 'ckd-scm-b-20', name: 'CKD スーパーマイクロシリンダー SCM-B-20', cat: 'pneumatics', spec: 'CKD SCM-Bシリーズ', type: 'link',
    link: 'https://www.ckd.co.jp/kiki/jp/products/air_cylinder/scm_b/',
    tags: ['エアシリンダー', 'CKD', 'SCM-B'], thumb: '🫧',
    params: { bore: 20 } },

  /* ── 電磁弁（メーカーリンク） ── */
  { id: 'smc-vq1101',  name: 'SMC 電磁弁 VQ1101',  cat: 'valves', spec: 'SMC VQシリーズ 5ポート', type: 'link',
    link: 'https://www.smcworld.com/products/ja/series.do?ca_id=113&tab=cad&ds_id=11-VQ1000',
    tags: ['電磁弁', 'SMC', 'VQ', '5ポート'], thumb: '🔧' },
  { id: 'smc-sy3120',  name: 'SMC 電磁弁 SY3120',  cat: 'valves', spec: 'SMC SYシリーズ 5ポート', type: 'link',
    link: 'https://www.smcworld.com/products/ja/series.do?ca_id=113&tab=cad&ds_id=11-SY3000',
    tags: ['電磁弁', 'SMC', 'SY', '5ポート'], thumb: '🔧' },

  /* ── モーター（メーカーリンク） ── */
  { id: 'nema17-42hs', name: 'ステッピングモーター NEMA17 42HS48', cat: 'motors', spec: 'NEMA17 (42mm角)', type: 'link',
    link: 'https://www.orientalmotor.co.jp/products/stepping/pkp_245d15a2/',
    tags: ['ステッピングモーター', 'NEMA17', '42mm'], thumb: '⚡' },
  { id: 'nema23-57hs', name: 'ステッピングモーター NEMA23 57HS76', cat: 'motors', spec: 'NEMA23 (57mm角)', type: 'link',
    link: 'https://www.orientalmotor.co.jp/products/stepping/',
    tags: ['ステッピングモーター', 'NEMA23', '57mm'], thumb: '⚡' },

  /* ── 治具・クランプ（メーカーリンク） ── */
  { id: 'toggle-clamp-tc101', name: 'トグルクランプ 垂直型 TC101', cat: 'clamps', spec: 'SUGATSUNE TC-101シリーズ', type: 'link',
    link: 'https://www.sugatsune.co.jp/products/detail.php?product_id=1543',
    tags: ['トグルクランプ', 'SUGATSUNE', '垂直型'], thumb: '🔒' },
  { id: 'toggle-clamp-th111', name: 'トグルクランプ 水平型 TH111', cat: 'clamps', spec: 'SUGATSUNE TH-111シリーズ', type: 'link',
    link: 'https://www.sugatsune.co.jp/products/detail.php?product_id=1544',
    tags: ['トグルクランプ', 'SUGATSUNE', '水平型'], thumb: '🔒' },
];

/* ===== 検索・フィルター関数 ===== */
function searchParts(query = '', catId = '', typeFilter = '') {
  const q = query.toLowerCase().trim();
  return PARTS.filter(p => {
    if (catId && p.cat !== catId) return false;
    if (typeFilter && p.type !== typeFilter) return false;
    if (!q) return true;
    return p.name.toLowerCase().includes(q)
        || p.id.toLowerCase().includes(q)
        || (p.spec || '').toLowerCase().includes(q)
        || p.tags.some(t => t.toLowerCase().includes(q));
  });
}

function getPartById(id) {
  return PARTS.find(p => p.id === id) || null;
}

function getCategoryById(id) {
  return CATEGORIES.find(c => c.id === id) || null;
}

function countByCategory(catId) {
  return PARTS.filter(p => p.cat === catId).length;
}
