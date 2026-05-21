'use strict';
/* =====================================================
   ファイルビューア（PDF / DXF）
   openViewer(file) で呼び出す
   file: { file_name, file_type, id }
   ===================================================== */

const Viewer = (() => {

  /* ================================================================
     SheetEye DXF パーサー（2d-cad/index.html より移植）
     ================================================================ */

  let _blocks = {};
  let _textStyles = {};

  const DXF_COLORS = {
    1: '#ff0000', 2: '#ffff00', 3: '#00ff00', 4: '#00ffff',
    5: '#0000ff', 6: '#ff00ff', 7: '#ffffff', 8: '#808080',
    9: '#c0c0c0', 10: '#ff0000', 11: '#ff7f7f', 12: '#cc0000',
    30: '#ff7f00', 40: '#ffff00', 50: '#7fff00', 60: '#00ff00',
    70: '#00ff7f', 80: '#00ffff', 90: '#007fff', 100: '#0000ff',
    110: '#7f00ff', 120: '#ff00ff', 130: '#ff007f',
    250: '#333333', 251: '#545454', 252: '#787878', 253: '#a0a0a0',
    254: '#c8c8c8', 255: '#ffffff', 256: '#cdd6f4',
  };
  function dxfColor(c) { return DXF_COLORS[c] || '#cdd6f4'; }
  function pf(v) { return parseFloat(v) || 0; }

  function cleanMText(s) {
    if (!s) return '';

    // %%nnn 拡張ASCIIコード（CADフォント用）→ 変換テーブルまたは空白
    // よく使われるものだけ変換、残りは除去
    s = s.replace(/%%(\d{3})/g, (_, n) => {
      const code = parseInt(n, 10);
      if (code >= 32 && code <= 126) return String.fromCharCode(code);
      return '';
    });
    // %%記号変換（順序重要：%%Pより先に処理）
    s = s.replace(/%%c/gi, '⌀');
    s = s.replace(/%%d/gi, '°');
    s = s.replace(/%%p/gi, '±');
    s = s.replace(/%%u/gi, '');
    s = s.replace(/%%o/gi, '');

    // MTEXT書式コード
    // \P は段落区切り（改行）→ 先に変換してから他のコードを除去
    s = s.replace(/\\P/g, '\n');
    s = s.replace(/\\~/g, ' ');
    s = s.replace(/\\n/g, '\n');

    // {\fFont|b0|i0;text} 形式のフォント指定 → テキストだけ取り出す
    // 繰り返し適用（ネストに対応）
    for (let i = 0; i < 5; i++) {
      const prev = s;
      s = s.replace(/\{\\[^}]*;([^{}]*)\}/g, '$1');
      if (s === prev) break;
    }

    // \H, \W, \Q, \T, \A, \C, \L, \l, \O, \o, \K, \k, \S など（セミコロン終端）
    s = s.replace(/\\[HWQTACILlOoKkSsBb][^;\\{}]*;/g, '');
    // \f, \F（フォント指定、セミコロン終端）
    s = s.replace(/\\[fF][^;]*;/g, '');

    // 残ったブレース除去
    s = s.replace(/\{|\}/g, '');
    // 残ったバックスラッシュシーケンス除去
    s = s.replace(/\\./g, '');

    return s.trim();
  }

  function parseLWPolyline(d, layer, color) {
    const xs = Array.isArray(d[10]) ? d[10].map(pf) : [pf(d[10])];
    const ys = Array.isArray(d[20]) ? d[20].map(pf) : [pf(d[20])];
    const bulges = Array.isArray(d[42]) ? d[42].map(pf) : d[42] !== undefined ? [pf(d[42])] : [];
    const closed = (parseInt(d[70]) & 1) === 1;
    const vertices = [];
    for (let i = 0; i < xs.length; i++) {
      vertices.push({ x: xs[i], y: ys[i] || 0, bulge: bulges[i] || 0 });
    }
    return { type: 'LWPOLYLINE', layer, color, vertices, closed };
  }

  function parseSpline(d, layer, color) {
    const xs = Array.isArray(d[10]) ? d[10].map(pf) : [pf(d[10])];
    const ys = Array.isArray(d[20]) ? d[20].map(pf) : [pf(d[20])];
    const pts = [];
    for (let i = 0; i < xs.length; i++) pts.push({ x: xs[i], y: ys[i] || 0 });
    return { type: 'SPLINE', layer, color, controlPoints: pts, degree: parseInt(d[71]) || 3 };
  }

  function parseDimension(d, layer, color) {
    return {
      type: 'DIMENSION', layer, color,
      blockName: d[2] || '',
      defX: pf(d[10]), defY: pf(d[20]),
      textX: pf(d[11]), textY: pf(d[21]),
      defX1: pf(d[13]), defY1: pf(d[23]),
      defX2: pf(d[14]), defY2: pf(d[24]),
      text: cleanMText(d[1] || ''),
      dimType: parseInt(d[70]) || 0,
    };
  }

  function parseEntity(type, d) {
    const layer = d[8] || '0';
    const color = parseInt(d[62]) || 7;
    switch (type) {
      case 'LINE':
        return { type: 'LINE', layer, color, x1: pf(d[10]), y1: pf(d[20]), x2: pf(d[11]), y2: pf(d[21]) };
      case 'CIRCLE':
        return { type: 'CIRCLE', layer, color, cx: pf(d[10]), cy: pf(d[20]), r: pf(d[40]) };
      case 'ARC':
        return { type: 'ARC', layer, color, cx: pf(d[10]), cy: pf(d[20]), r: pf(d[40]),
                 startAngle: pf(d[50]), endAngle: pf(d[51]) };
      case 'POINT':
        return { type: 'POINT', layer, color, x: pf(d[10]), y: pf(d[20]) };
      case 'LWPOLYLINE':
        return parseLWPolyline(d, layer, color);
      case 'TEXT': {
        const ha = parseInt(d[72]) || 0;
        const va = parseInt(d[73]) || 0;
        const usesEndPoint = (ha === 1 || ha === 2 || ha === 4 || va !== 0);
        const useAlign = usesEndPoint && d[11] !== undefined;
        const wf = pf(d[41]);
        return { type: 'TEXT', layer, color,
                 x: useAlign ? pf(d[11]) : pf(d[10]),
                 y: useAlign ? pf(d[21]) : pf(d[20]),
                 height: pf(d[40]) || 2.5, text: cleanMText(d[1] || ''),
                 rotation: pf(d[50]), halign: ha, valign: va,
                 _widthFactor: (wf && wf > 0) ? wf : 1.0,
                 _style: d[7] || 'Standard' };
      }
      case 'MTEXT': {
        const ap = parseInt(d[71]) || 1;
        const halignMap = [0, 0, 1, 2, 0, 1, 2, 0, 1, 2];
        const valignMap = [0, 3, 3, 3, 2, 2, 2, 1, 1, 1];
        const refWidth = pf(d[41]) || 0;
        const lineSpacingFactor = pf(d[44]) || 1.0;
        let rot = pf(d[50]);
        if ((!rot || rot === 0) && d[11] !== undefined && d[21] !== undefined) {
          const vx = pf(d[11]), vy = pf(d[21]);
          if (vx !== 0 || vy !== 0) rot = Math.atan2(vy, vx) * 180 / Math.PI;
        }
        if (!rot) rot = 0;
        return { type: 'TEXT', layer, color, x: pf(d[10]), y: pf(d[20]),
                 height: pf(d[40]) || 2.5, text: cleanMText(d[1] || ''),
                 rotation: rot, halign: halignMap[ap], valign: valignMap[ap],
                 _isMText: true, _refWidth: refWidth, _lineSpacing: lineSpacingFactor,
                 _style: d[7] || 'Standard' };
      }
      case 'DIMENSION':
        return parseDimension(d, layer, color);
      case 'ELLIPSE':
        return { type: 'ELLIPSE', layer, color, cx: pf(d[10]), cy: pf(d[20]),
                 ex: pf(d[11]), ey: pf(d[21]), ratio: pf(d[40]),
                 startParam: pf(d[41]), endParam: pf(d[42]) };
      case 'SPLINE':
        return parseSpline(d, layer, color);
      case 'INSERT':
        return { type: 'INSERT', layer, color, x: pf(d[10]), y: pf(d[20]),
                 blockName: d[2] || '', sx: pf(d[41]) || 1, sy: pf(d[42]) || 1, rotation: pf(d[50]) };
      case 'SOLID': case '3DFACE':
        return { type: 'SOLID', layer, color,
                 x1: pf(d[10]), y1: pf(d[20]), x2: pf(d[11]), y2: pf(d[21]),
                 x3: pf(d[12]), y3: pf(d[22]), x4: pf(d[13]), y4: pf(d[23]) };
      case 'ATTRIB': case 'ATTDEF': {
        const ha2 = parseInt(d[72]) || 0;
        const va2 = parseInt(d[73]) || 0;
        const usesEndPoint2 = (ha2 === 1 || ha2 === 2 || ha2 === 4 || va2 !== 0);
        const useAlign2 = usesEndPoint2 && d[11] !== undefined;
        const wf2 = pf(d[41]);
        const txt = cleanMText(d[1] || '');
        if (!txt) return null;
        return { type: 'TEXT', layer, color,
                 x: useAlign2 ? pf(d[11]) : pf(d[10]),
                 y: useAlign2 ? pf(d[21]) : pf(d[20]),
                 height: pf(d[40]) || 2.5, text: txt, rotation: pf(d[50]),
                 halign: ha2, valign: va2,
                 _widthFactor: (wf2 && wf2 > 0) ? wf2 : 1.0,
                 _style: d[7] || 'Standard' };
      }
      default:
        return null;
    }
  }

  function readOneEntity(pairs, i, arr) {
    if (i >= pairs.length || pairs[i].code !== 0) return i + 1;
    const etype = pairs[i].val;

    if (etype === 'POLYLINE') {
      i++;
      const hd = {};
      while (i < pairs.length && pairs[i].code !== 0) { hd[pairs[i].code] = pairs[i].val; i++; }
      const layer = hd[8] || '0', color = parseInt(hd[62]) || 7;
      const closed = (parseInt(hd[70]) & 1) === 1;
      const vertices = [];
      while (i < pairs.length) {
        if (pairs[i].code === 0 && pairs[i].val === 'SEQEND') {
          i++; while (i < pairs.length && pairs[i].code !== 0) i++; break;
        }
        if (pairs[i].code === 0 && pairs[i].val === 'VERTEX') {
          i++;
          let vx = 0, vy = 0, vb = 0;
          while (i < pairs.length && pairs[i].code !== 0) {
            if (pairs[i].code === 10) vx = pf(pairs[i].val);
            else if (pairs[i].code === 20) vy = pf(pairs[i].val);
            else if (pairs[i].code === 42) vb = pf(pairs[i].val);
            i++;
          }
          vertices.push({ x: vx, y: vy, bulge: vb });
        } else break;
      }
      if (vertices.length >= 2) arr.push({ type: 'LWPOLYLINE', layer, color, vertices, closed });
      return i;
    }

    if (etype === 'VERTEX' || etype === 'SEQEND') {
      i++; while (i < pairs.length && pairs[i].code !== 0) i++; return i;
    }

    i++;
    const data = {};
    while (i < pairs.length && pairs[i].code !== 0) {
      const c = pairs[i].code, v = pairs[i].val;
      if (data[c] !== undefined) {
        if (!Array.isArray(data[c])) data[c] = [data[c]];
        data[c].push(v);
      } else data[c] = v;
      i++;
    }
    const ent = parseEntity(etype, data);
    if (ent) {
      if (data[67] === '1') ent._paperSpace = true;
      arr.push(ent);
    }
    return i;
  }

  function findBlock(name) {
    if (!name) return null;
    if (_blocks[name]) return _blocks[name];
    const lo = name.toLowerCase();
    for (const k of Object.keys(_blocks)) {
      if (k.toLowerCase() === lo) return _blocks[k];
    }
    return null;
  }

  function transformEntity(e, ix, iy, bx, by, sx, sy, cosR, sinR, insertColor) {
    function tx(x, y) {
      const lx = (x - bx) * sx, ly = (y - by) * sy;
      return { x: ix + lx * cosR - ly * sinR, y: iy + lx * sinR + ly * cosR };
    }
    const color = (e.color === 0 || e.color === 256) ? (insertColor || 7) : e.color;
    switch (e.type) {
      case 'LINE': { const a = tx(e.x1, e.y1), b = tx(e.x2, e.y2);
        return { type:'LINE', layer:e.layer, color, x1:a.x, y1:a.y, x2:b.x, y2:b.y }; }
      case 'CIRCLE': { const c = tx(e.cx, e.cy);
        return { type:'CIRCLE', layer:e.layer, color, cx:c.x, cy:c.y, r:e.r*Math.abs(sx) }; }
      case 'ARC': { const c = tx(e.cx, e.cy);
        const rotDeg = Math.atan2(sinR, cosR)*180/Math.PI;
        let sa = e.startAngle+rotDeg, ea = e.endAngle+rotDeg;
        if (sx*sy < 0) { const tmp=sa; sa=180-ea; ea=180-tmp; }
        return { type:'ARC', layer:e.layer, color, cx:c.x, cy:c.y, r:e.r*Math.abs(sx), startAngle:sa, endAngle:ea }; }
      case 'POINT': { const p = tx(e.x, e.y);
        return { type:'POINT', layer:e.layer, color, x:p.x, y:p.y }; }
      case 'LWPOLYLINE': {
        const verts = e.vertices.map(v => { const p=tx(v.x,v.y); return { x:p.x, y:p.y, bulge:v.bulge*(sx*sy>0?1:-1) }; });
        return { type:'LWPOLYLINE', layer:e.layer, color, vertices:verts, closed:e.closed }; }
      case 'TEXT': { const p = tx(e.x, e.y);
        const rotDeg = Math.atan2(sinR, cosR)*180/Math.PI;
        return { type:'TEXT', layer:e.layer, color, x:p.x, y:p.y,
                 height:e.height*Math.abs(sy), text:e.text, rotation:(e.rotation||0)+rotDeg,
                 halign:e.halign, valign:e.valign, _isMText:e._isMText,
                 _refWidth:(e._refWidth||0)*Math.abs(sx), _lineSpacing:e._lineSpacing,
                 _widthFactor:e._widthFactor, _style:e._style }; }
      case 'ELLIPSE': { const c=tx(e.cx,e.cy), ep=tx(e.cx+e.ex,e.cy+e.ey);
        return { type:'ELLIPSE', layer:e.layer, color, cx:c.x, cy:c.y, ex:ep.x-c.x, ey:ep.y-c.y,
                 ratio:e.ratio, startParam:e.startParam, endParam:e.endParam }; }
      case 'SPLINE': { const pts=e.controlPoints.map(p=>tx(p.x,p.y));
        return { type:'SPLINE', layer:e.layer, color, controlPoints:pts, degree:e.degree }; }
      case 'SOLID': { const p1=tx(e.x1,e.y1),p2=tx(e.x2,e.y2),p3=tx(e.x3,e.y3),p4=tx(e.x4,e.y4);
        return { type:'SOLID', layer:e.layer, color, x1:p1.x, y1:p1.y, x2:p2.x, y2:p2.y, x3:p3.x, y3:p3.y, x4:p4.x, y4:p4.y }; }
      case 'INSERT': { const p=tx(e.x,e.y);
        return { type:'INSERT', layer:e.layer, color, x:p.x, y:p.y, blockName:e.blockName,
                 sx:(e.sx||1)*sx, sy:(e.sy||1)*sy, rotation:(e.rotation||0)+Math.atan2(sinR,cosR)*180/Math.PI }; }
      default: return null;
    }
  }

  function flattenInserts(ents, depth) {
    if (depth > 10) return ents;
    const result = [];
    for (const e of ents) {
      const insertBlk = e.type === 'INSERT' ? findBlock(e.blockName) : null;
      if (e.type === 'INSERT' && insertBlk) {
        const blk = insertBlk;
        const bx = blk.baseX||0, by = blk.baseY||0;
        const sx = e.sx||1, sy = e.sy||1;
        const rot = (e.rotation||0)*Math.PI/180;
        const cosR = Math.cos(rot), sinR = Math.sin(rot);
        for (const be of blk.entities) {
          const transformed = transformEntity(be, e.x, e.y, bx, by, sx, sy, cosR, sinR, e.color);
          if (transformed) {
            if (e._isDimension) transformed._isDimension = true;
            if (e._paperSpace) transformed._paperSpace = true;
            result.push(transformed);
          }
        }
      } else if (e.type === 'DIMENSION' && e.blockName && findBlock(e.blockName)) {
        const blk = findBlock(e.blockName);
        const bx = blk.baseX||0, by = blk.baseY||0;
        for (const be of blk.entities) {
          const transformed = transformEntity(be, 0, 0, bx, by, 1, 1, 1, 0, e.color);
          if (transformed) {
            if (transformed.type === 'TEXT' && transformed.text) {
              const dist = Math.sqrt((e.defX2-e.defX1)**2+(e.defY2-e.defY1)**2);
              const measText = e.text || dist.toFixed(2);
              transformed.text = transformed.text.replace(/<>/g, measText);
            }
            transformed._isDimension = true;
            if (e._paperSpace) transformed._paperSpace = true;
            result.push(transformed);
          }
        }
      } else if (e.type === 'DIMENSION') {
        // no block found — skip
      } else {
        result.push(e);
      }
    }
    const hasInsert = result.some(e => e.type === 'INSERT');
    return hasInsert ? flattenInserts(result, depth+1) : result;
  }

  function getEntityCenter(e) {
    switch (e.type) {
      case 'LINE':      return { x:(e.x1+e.x2)/2, y:(e.y1+e.y2)/2 };
      case 'CIRCLE': case 'ARC': case 'ELLIPSE': return { x:e.cx, y:e.cy };
      case 'LWPOLYLINE': {
        const n=e.vertices.length;
        return n ? { x:e.vertices.reduce((s,v)=>s+v.x,0)/n, y:e.vertices.reduce((s,v)=>s+v.y,0)/n } : { x:0,y:0 };
      }
      case 'SPLINE': return e.controlPoints&&e.controlPoints.length ? { x:e.controlPoints[0].x, y:e.controlPoints[0].y } : { x:0,y:0 };
      case 'SOLID': return { x:(e.x1+e.x2+e.x3+e.x4)/4, y:(e.y1+e.y2+e.y3+e.y4)/4 };
      default: return { x:e.x||0, y:e.y||0 };
    }
  }

  function findBestViewport(e, vps) {
    const c = getEntityCenter(e);
    for (const vp of vps) {
      if (c.x >= vp.modelCX-vp.modelHalfW && c.x <= vp.modelCX+vp.modelHalfW &&
          c.y >= vp.modelCY-vp.modelHalfH && c.y <= vp.modelCY+vp.modelHalfH) return vp;
    }
    let minD=Infinity, best=vps[0];
    for (const vp of vps) {
      const dx=(c.x-vp.modelCX)/(vp.modelHalfW||1), dy=(c.y-vp.modelCY)/(vp.modelHalfH||1);
      const d=dx*dx+dy*dy;
      if (d<minD) { minD=d; best=vp; }
    }
    return best;
  }

  function applyViewportTransform(e, vp, cos, sin) {
    const s=vp.scale, pcx=vp.paperCX, pcy=vp.paperCY, mcx=vp.modelCX, mcy=vp.modelCY;
    function tx(mx,my) {
      const rx=(mx-mcx)*cos-(my-mcy)*sin, ry=(mx-mcx)*sin+(my-mcy)*cos;
      return { x:pcx+rx*s, y:pcy+ry*s };
    }
    switch (e.type) {
      case 'LINE': { const a=tx(e.x1,e.y1),b=tx(e.x2,e.y2); return {...e, x1:a.x,y1:a.y,x2:b.x,y2:b.y}; }
      case 'CIRCLE': case 'ARC': { const c=tx(e.cx,e.cy); return {...e, cx:c.x, cy:c.y, r:e.r*s}; }
      case 'LWPOLYLINE': { const verts=e.vertices.map(v=>{const p=tx(v.x,v.y);return{...v,x:p.x,y:p.y};}); return {...e,vertices:verts}; }
      case 'TEXT': { const p=tx(e.x,e.y); return {...e,x:p.x,y:p.y,height:e.height*s,_refWidth:(e._refWidth||0)*s}; }
      case 'SOLID': { const p1=tx(e.x1,e.y1),p2=tx(e.x2,e.y2),p3=tx(e.x3,e.y3),p4=tx(e.x4,e.y4); return {...e,x1:p1.x,y1:p1.y,x2:p2.x,y2:p2.y,x3:p3.x,y3:p3.y,x4:p4.x,y4:p4.y}; }
      case 'ELLIPSE': { const c=tx(e.cx,e.cy); return {...e,cx:c.x,cy:c.y,ex:e.ex*s,ey:e.ey*s}; }
      case 'SPLINE': { const pts=e.controlPoints.map(p=>{const q=tx(p.x,p.y);return{x:q.x,y:q.y};}); return {...e,controlPoints:pts}; }
      case 'POINT': { const p=tx(e.x,e.y); return {...e,x:p.x,y:p.y}; }
      default: return e;
    }
  }

  function parseDXF(text) {
    _blocks = {};
    _textStyles = {};
    const lines = text.split(/\r?\n/);
    const pairs = [];
    for (let i = 0; i < lines.length-1; i += 2) {
      const code = parseInt(lines[i].trim(), 10);
      const val  = lines[i+1] ? lines[i+1].trim() : '';
      pairs.push({ code, val });
    }

    // STYLE table
    for (let si = 0; si < pairs.length; si++) {
      if (pairs[si].code === 0 && pairs[si].val === 'STYLE') {
        si++;
        let name='', font='', wf=1.0, oblique=0;
        while (si < pairs.length && pairs[si].code !== 0) {
          const c=pairs[si].code, v=pairs[si].val;
          if (c===2) name=v;
          else if (c===3) font=v;
          else if (c===4) { if (!font) font=v; }
          else if (c===41) wf=pf(v)||1.0;
          else if (c===50) oblique=pf(v)||0;
          si++;
        }
        if (name) {
          const fLower=(font||'').toLowerCase();
          const isShx=fLower.endsWith('.shx')||(fLower&&!fLower.endsWith('.ttf')&&!fLower.endsWith('.ttc')&&!fLower.endsWith('.otf'));
          _textStyles[name]={font,widthFactor:wf,oblique,isShx};
        }
        si--;
      }
    }

    // BLOCKS section
    let bi = 0;
    while (bi < pairs.length) {
      if (pairs[bi].code===2 && pairs[bi].val==='BLOCKS') { bi++; break; }
      bi++;
    }
    while (bi < pairs.length) {
      if (pairs[bi].code===0 && pairs[bi].val==='ENDSEC') break;
      if (pairs[bi].code===0 && pairs[bi].val==='BLOCK') {
        bi++;
        let blockName='', bx=0, by=0;
        while (bi < pairs.length && pairs[bi].code !== 0) {
          if (pairs[bi].code===2) blockName=pairs[bi].val;
          else if (pairs[bi].code===10) bx=pf(pairs[bi].val);
          else if (pairs[bi].code===20) by=pf(pairs[bi].val);
          bi++;
        }
        const blockEnts = [];
        while (bi < pairs.length) {
          if (pairs[bi].code===0 && pairs[bi].val==='ENDBLK') {
            bi++; while (bi < pairs.length && pairs[bi].code!==0) bi++; break;
          }
          bi = readOneEntity(pairs, bi, blockEnts);
        }
        _blocks[blockName] = { entities:blockEnts, baseX:bx, baseY:by };
      } else { bi++; }
    }

    // ENTITIES section
    const ents = [];
    let i = 0;
    while (i < pairs.length) {
      if (pairs[i].code===2 && pairs[i].val==='ENTITIES') { i++; break; }
      i++;
    }
    while (i < pairs.length) {
      if (pairs[i].code===0 && pairs[i].val==='ENDSEC') break;
      i = readOneEntity(pairs, i, ents);
    }

    // VIEWPORT detection
    const viewports = [];
    for (let vi = 0; vi < pairs.length-1; vi++) {
      if (pairs[vi].code===0 && pairs[vi].val==='VIEWPORT') {
        vi++;
        const vd = {};
        while (vi < pairs.length && pairs[vi].code!==0) {
          if (vd[pairs[vi].code]===undefined) vd[pairs[vi].code]=pairs[vi].val;
          vi++;
        }
        vi--;
        const vpId = parseInt(vd[69])||0;
        if (vpId<=1) continue;
        const paperH=pf(vd[41]), paperW=pf(vd[40]), modelH=pf(vd[45]);
        if (paperH>0 && modelH>0) {
          const scale=paperH/modelH;
          const modelW=(paperW>0)?modelH*(paperW/paperH):modelH;
          const modelCX=pf(vd[17])+pf(vd[12]), modelCY=pf(vd[27])+pf(vd[22]);
          const twist=pf(vd[51])*Math.PI/180;
          viewports.push({
            paperCX:pf(vd[10]), paperCY:pf(vd[20]),
            paperH, modelH, scale, modelCX, modelCY,
            modelHalfW:modelW/2, modelHalfH:modelH/2, twist,
            cos:Math.cos(-twist), sin:Math.sin(-twist),
          });
        }
      }
    }

    const flat = flattenInserts(ents, 0);
    if (viewports.length > 0) {
      return flat.map(e => {
        if (e._paperSpace) return e;
        const vp = findBestViewport(e, viewports);
        if (!vp) return e;
        return applyViewportTransform(e, vp, vp.cos, vp.sin);
      });
    }
    return flat;
  }

  /* ================================================================
     DXF Canvas レンダラー
     ================================================================ */
  const DXF = {
    canvas: null,
    ctx: null,
    entities: [],
    cam: { x: 0, y: 0, zoom: 1 },
    dragging: false,
    dragStart: null,
    _resizeHandler: null,

    init(container) {
      this.canvas = document.createElement('canvas');
      this.canvas.id = 'dxfCanvas';
      this.canvas.style.display = 'block';
      this.canvas.width  = container.clientWidth  || 800;
      this.canvas.height = container.clientHeight || 600;
      container.appendChild(this.canvas);
      this.ctx = this.canvas.getContext('2d');
      this._mouseMoveHandler = null;
      this._mouseUpHandler   = null;
      this._bindEvents();
    },

    load(dxfText) {
      try {
        this.entities = parseDXF(dxfText);
        this.fit();
      } catch (e) {
        this._drawError('DXFのパースに失敗しました: ' + e.message);
      }
    },

    worldToScreen(wx, wy) {
      return {
        x: (wx - this.cam.x) * this.cam.zoom + this.canvas.width  / 2,
        y: -(wy - this.cam.y) * this.cam.zoom + this.canvas.height / 2,
      };
    },

    _calcBounds() {
      let minX=Infinity, maxX=-Infinity, minY=Infinity, maxY=-Infinity;
      for (const e of this.entities) {
        let pts = [];
        switch (e.type) {
          case 'LINE':      pts=[[e.x1,e.y1],[e.x2,e.y2]]; break;
          case 'CIRCLE': case 'ARC':
            pts=[[e.cx-e.r,e.cy-e.r],[e.cx+e.r,e.cy+e.r]]; break;
          case 'LWPOLYLINE':
            pts=e.vertices.map(v=>[v.x,v.y]); break;
          case 'ELLIPSE': {
            const a=Math.sqrt(e.ex**2+e.ey**2);
            pts=[[e.cx-a,e.cy-a],[e.cx+a,e.cy+a]]; break;
          }
          case 'SPLINE':
            pts=(e.controlPoints||[]).map(p=>[p.x,p.y]); break;
          case 'SOLID':
            pts=[[e.x1,e.y1],[e.x2,e.y2],[e.x3,e.y3],[e.x4,e.y4]]; break;
          case 'TEXT':
            pts=[[e.x,e.y]]; break;
          case 'POINT':
            pts=[[e.x,e.y]]; break;
        }
        for (const [x,y] of pts) {
          if (x<minX) minX=x; if (x>maxX) maxX=x;
          if (y<minY) minY=y; if (y>maxY) maxY=y;
        }
      }
      if (!isFinite(minX)) { minX=0; maxX=100; minY=0; maxY=100; }
      return { minX, maxX, minY, maxY };
    },

    fit() {
      const bounds = this._calcBounds();
      const cw = this.canvas.width, ch = this.canvas.height;
      const dw = bounds.maxX - bounds.minX || 1;
      const dh = bounds.maxY - bounds.minY || 1;
      const pad = 40;
      this.cam.zoom = Math.min((cw-pad*2)/dw, (ch-pad*2)/dh);
      this.cam.x = (bounds.minX + bounds.maxX) / 2;
      this.cam.y = (bounds.minY + bounds.maxY) / 2;
      this.draw();
    },

    draw() {
      const ctx = this.ctx;
      const cw = this.canvas.width, ch = this.canvas.height;
      ctx.clearRect(0, 0, cw, ch);
      ctx.fillStyle = '#1a1a2e';
      ctx.fillRect(0, 0, cw, ch);

      for (const e of this.entities) {
        ctx.strokeStyle = dxfColor(e.color);
        ctx.fillStyle   = dxfColor(e.color);
        ctx.lineWidth = 1;
        ctx.setLineDash([]);
        this._drawEntity(ctx, e);
      }
    },

    _drawEntity(ctx, e) {
      switch (e.type) {
        case 'LINE': {
          const a = this.worldToScreen(e.x1, e.y1), b = this.worldToScreen(e.x2, e.y2);
          ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y); ctx.stroke();
          break;
        }
        case 'CIRCLE': {
          const c = this.worldToScreen(e.cx, e.cy);
          ctx.beginPath();
          ctx.arc(c.x, c.y, e.r * this.cam.zoom, 0, Math.PI*2);
          ctx.stroke();
          break;
        }
        case 'ARC': {
          const c = this.worldToScreen(e.cx, e.cy);
          const sa = -e.endAngle   * Math.PI / 180;
          const ea = -e.startAngle * Math.PI / 180;
          ctx.beginPath();
          ctx.arc(c.x, c.y, e.r * this.cam.zoom, sa, ea);
          ctx.stroke();
          break;
        }
        case 'POINT': {
          const p = this.worldToScreen(e.x, e.y);
          ctx.beginPath(); ctx.arc(p.x, p.y, 2, 0, Math.PI*2); ctx.fill();
          break;
        }
        case 'LWPOLYLINE': {
          if (e.vertices.length < 2) break;
          const verts = e.vertices;
          const count = e.closed ? verts.length : verts.length-1;
          for (let j = 0; j < count; j++) {
            const v1 = verts[j], v2 = verts[(j+1) % verts.length];
            ctx.beginPath();
            if (v1.bulge && Math.abs(v1.bulge) > 0.001) {
              this._drawBulgeArc(ctx, v1, v2, v1.bulge);
            } else {
              const pa = this.worldToScreen(v1.x, v1.y);
              const pb = this.worldToScreen(v2.x, v2.y);
              ctx.moveTo(pa.x, pa.y); ctx.lineTo(pb.x, pb.y);
            }
            ctx.stroke();
          }
          break;
        }
        case 'TEXT': {
          const p = this.worldToScreen(e.x, e.y);
          const fs = e.height * this.cam.zoom;
          if (fs < 1) break;
          ctx.save();
          ctx.font = `${fs}px 'Noto Sans JP', 'Meiryo', sans-serif`;
          ctx.textAlign = (e.halign===1||e.halign===4) ? 'center' : (e.halign===2) ? 'right' : 'left';
          ctx.textBaseline = (e.halign===4) ? 'middle' : (e.valign===3) ? 'top' : (e.valign===2) ? 'middle' : (e.valign===1) ? 'bottom' : 'alphabetic';
          const lineHeight = fs * 1.2 * (e._lineSpacing || 1.0);
          let lines;
          if (e._isMText && e._refWidth > 0) {
            const maxPx = e._refWidth * this.cam.zoom;
            lines = [];
            for (const para of e.text.split('\n')) {
              if (ctx.measureText(para).width <= maxPx) { lines.push(para); continue; }
              let cur = '';
              for (let ci = 0; ci < para.length; ci++) {
                const test = cur + para[ci];
                if (ctx.measureText(test).width > maxPx && cur) {
                  lines.push(cur); cur = para[ci];
                } else { cur = test; }
              }
              if (cur) lines.push(cur);
            }
          } else {
            lines = e.text.split('\n');
          }
          const style = _textStyles[e._style];
          const styleWf = style ? style.widthFactor : 1.0;
          const shxComp = (style && style.isShx) ? 0.72 : 1.0;
          const wf = (e._widthFactor||1.0) * styleWf * shxComp;
          ctx.translate(p.x, p.y);
          if (e.rotation) ctx.rotate(-e.rotation * Math.PI / 180);
          if (wf !== 1.0) ctx.scale(wf, 1);
          for (let li = 0; li < lines.length; li++) {
            ctx.fillText(lines[li], 0, li * lineHeight);
          }
          ctx.restore();
          break;
        }
        case 'ELLIPSE': {
          const c = this.worldToScreen(e.cx, e.cy);
          const a = Math.sqrt(e.ex**2 + e.ey**2) * this.cam.zoom;
          const b = a * (e.ratio || 0.5);
          const rot = Math.atan2(e.ey, e.ex);
          ctx.beginPath();
          ctx.ellipse(c.x, c.y, Math.max(0.1,a), Math.max(0.1,b), -rot,
                      e.startParam||0, e.endParam||Math.PI*2);
          ctx.stroke();
          break;
        }
        case 'SPLINE': {
          if (e.controlPoints.length < 2) break;
          const pts = e.controlPoints.map(p => this.worldToScreen(p.x, p.y));
          ctx.beginPath();
          ctx.moveTo(pts[0].x, pts[0].y);
          if (pts.length === 2) {
            ctx.lineTo(pts[1].x, pts[1].y);
          } else if (pts.length === 3) {
            ctx.quadraticCurveTo(pts[1].x, pts[1].y, pts[2].x, pts[2].y);
          } else {
            for (let j = 1; j < pts.length-2; j++) {
              const xc=(pts[j].x+pts[j+1].x)/2, yc=(pts[j].y+pts[j+1].y)/2;
              ctx.quadraticCurveTo(pts[j].x, pts[j].y, xc, yc);
            }
            const n=pts.length-1;
            ctx.quadraticCurveTo(pts[n-1].x, pts[n-1].y, pts[n].x, pts[n].y);
          }
          ctx.stroke();
          break;
        }
        case 'SOLID': {
          const sp1=this.worldToScreen(e.x1,e.y1), sp2=this.worldToScreen(e.x2,e.y2);
          const sp3=this.worldToScreen(e.x3,e.y3), sp4=this.worldToScreen(e.x4,e.y4);
          ctx.beginPath();
          ctx.moveTo(sp1.x,sp1.y); ctx.lineTo(sp2.x,sp2.y);
          ctx.lineTo(sp4.x,sp4.y); ctx.lineTo(sp3.x,sp3.y);
          ctx.closePath(); ctx.fill();
          break;
        }
      }
    },

    _drawBulgeArc(ctx, v1, v2, bulge) {
      const dx=v2.x-v1.x, dy=v2.y-v1.y;
      const chordLen=Math.sqrt(dx*dx+dy*dy);
      if (chordLen<0.0001) return;
      const sagitta=Math.abs(bulge)*chordLen/2;
      const r=(chordLen*chordLen/4+sagitta*sagitta)/(2*sagitta);
      const midX=(v1.x+v2.x)/2, midY=(v1.y+v2.y)/2;
      const d=Math.sqrt(Math.max(0, r*r-(chordLen/2)**2));
      const sign=bulge>0?1:-1;
      const nx=-dy/chordLen, ny=dx/chordLen;
      const cx=midX+nx*d*sign, cy=midY+ny*d*sign;
      const sc=this.worldToScreen(cx, cy);
      const screenStartA=Math.atan2(-(v1.y-cy),(v1.x-cx));
      const screenEndA  =Math.atan2(-(v2.y-cy),(v2.x-cx));
      const ccw=bulge<0;
      const sp=this.worldToScreen(v1.x, v1.y);
      ctx.moveTo(sp.x, sp.y);
      ctx.arc(sc.x, sc.y, r*this.cam.zoom, screenStartA, screenEndA, ccw);
    },

    zoom(factor) {
      this.cam.zoom *= factor;
      this.draw();
    },

    resize(w, h) {
      this.canvas.width = w; this.canvas.height = h;
      this.draw();
    },

    screenToWorld(sx, sy) {
      return {
        x:  (sx - this.canvas.width  / 2) / this.cam.zoom + this.cam.x,
        y: -((sy - this.canvas.height / 2) / this.cam.zoom) + this.cam.y,
      };
    },

    _bindEvents() {
      const c = this.canvas;

      /* ホイールズーム: マウス位置を固定したままズーム */
      c.addEventListener('wheel', ev => {
        ev.preventDefault();
        const factor = ev.deltaY < 0 ? 1.15 : 0.87;
        const rect = c.getBoundingClientRect();
        const sx = ev.clientX - rect.left;
        const sy = ev.clientY - rect.top;
        // マウス位置のワールド座標をズーム前後で一致させる
        const wx = this.screenToWorld(sx, sy).x;
        const wy = this.screenToWorld(sx, sy).y;
        this.cam.zoom *= factor;
        // ズーム後にその点が同じスクリーン座標になるようcam.x/yを補正
        this.cam.x = wx - (sx - this.canvas.width  / 2) / this.cam.zoom;
        this.cam.y = wy + (sy - this.canvas.height / 2) / this.cam.zoom;
        this.draw();
      }, { passive: false });

      /* ドラッグパン */
      c.addEventListener('mousedown', ev => {
        this.dragging = true;
        this.dragStart = {
          sx: ev.clientX, sy: ev.clientY,
          cx: this.cam.x, cy: this.cam.y,
        };
        c.style.cursor = 'grabbing';
      });
      /* 前回のイベントリスナーを除去して重複を防ぐ */
      if (this._mouseMoveHandler) window.removeEventListener('mousemove', this._mouseMoveHandler);
      if (this._mouseUpHandler)   window.removeEventListener('mouseup',   this._mouseUpHandler);
      this._mouseMoveHandler = ev => {
        if (!this.dragging) return;
        const dx = ev.clientX - this.dragStart.sx;
        const dy = ev.clientY - this.dragStart.sy;
        this.cam.x = this.dragStart.cx - dx / this.cam.zoom;
        this.cam.y = this.dragStart.cy + dy / this.cam.zoom;
        this.draw();
      };
      this._mouseUpHandler = () => {
        this.dragging = false;
        c.style.cursor = 'grab';
      };
      window.addEventListener('mousemove', this._mouseMoveHandler);
      window.addEventListener('mouseup',   this._mouseUpHandler);
      c.style.cursor = 'grab';

      /* タッチ */
      let lastDist = 0, lastTouchCam = null;
      c.addEventListener('touchstart', ev => {
        if (ev.touches.length === 1) {
          this.dragging = true;
          this.dragStart = {
            sx: ev.touches[0].clientX, sy: ev.touches[0].clientY,
            cx: this.cam.x, cy: this.cam.y,
          };
        } else if (ev.touches.length === 2) {
          this.dragging = false;
          lastDist = Math.hypot(
            ev.touches[0].clientX - ev.touches[1].clientX,
            ev.touches[0].clientY - ev.touches[1].clientY);
          lastTouchCam = { ...this.cam };
        }
      });
      c.addEventListener('touchmove', ev => {
        ev.preventDefault();
        if (ev.touches.length === 1 && this.dragging) {
          const dx = ev.touches[0].clientX - this.dragStart.sx;
          const dy = ev.touches[0].clientY - this.dragStart.sy;
          this.cam.x = this.dragStart.cx - dx / this.cam.zoom;
          this.cam.y = this.dragStart.cy + dy / this.cam.zoom;
          this.draw();
        } else if (ev.touches.length === 2) {
          const d = Math.hypot(
            ev.touches[0].clientX - ev.touches[1].clientX,
            ev.touches[0].clientY - ev.touches[1].clientY);
          if (lastDist > 0) this.cam.zoom *= d / lastDist;
          lastDist = d;
          this.draw();
        }
      }, { passive: false });
      c.addEventListener('touchend', () => { this.dragging = false; });
    },

    _drawError(msg) {
      const ctx = this.ctx;
      ctx.fillStyle = '#1a1a2e';
      ctx.fillRect(0, 0, this.canvas.width, this.canvas.height);
      ctx.fillStyle = '#e17055';
      ctx.font = '14px sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText(msg, this.canvas.width/2, this.canvas.height/2);
    },
  };

  /* ---- 3D ビューア状態 ---- */
  let _3dAnimId = null;
  let _3dRenderer = null;
  let _3dResetFn = null;
  let _3dResizeHandler = null;

  /* ---- モーダル制御 ---- */
  function open(file) {
    const modal      = document.getElementById('viewerModal');
    const content    = document.getElementById('viewerContent');
    const dxfTb      = document.getElementById('dxfToolbar');
    const threejsTb  = document.getElementById('threejsToolbar');

    const ext = file.file_name.split('.').pop().toLowerCase();
    const is3d = ['stl','stp','step'].includes(ext);

    document.getElementById('viewerFileName').textContent = file.file_name;
    document.getElementById('viewerFileType').textContent =
      { pdf:'PDF図面', dxf:'DXF図面', dwg:'DWG図面',
        stl:'3Dモデル (STL)', stp:'3Dモデル (STEP)', step:'3Dモデル (STEP)' }[ext] || ext.toUpperCase();
    document.getElementById('viewerIcon').innerHTML =
      ext === 'pdf'
        ? '<i class="fa-solid fa-file-pdf" style="color:#e17055;"></i>'
        : is3d
          ? '<i class="fa-solid fa-cube" style="color:#00b894;"></i>'
          : '<i class="fa-solid fa-file-lines" style="color:#74b9ff;"></i>';

    content.innerHTML = '';
    dxfTb.style.display   = 'none';
    threejsTb.style.display = 'none';

    const loading = document.createElement('div');
    loading.className = 'viewer-loading';
    loading.innerHTML = '<i class="fa-solid fa-spinner"></i><span>読み込み中...</span>';
    content.appendChild(loading);

    modal.classList.remove('hidden');

    if (ext === 'pdf') {
      _openPdf(file, content, loading);
    } else if (ext === 'dxf' || ext === 'dwg') {
      _openDxf(file, content, loading, dxfTb);
    } else if (is3d) {
      _open3D(file, content, loading, threejsTb, ext);
    } else {
      loading.innerHTML = '<i class="fa-solid fa-circle-exclamation" style="color:#e17055;"></i>'
        + '<span>このファイル形式はプレビューに対応していません</span>';
    }
  }

  /* ---- 3Dビューア ---- */
  async function _open3D(file, content, loading, toolbar, ext) {
    const THREE = window.THREE;
    if (!THREE) {
      loading.innerHTML = '<i class="fa-solid fa-circle-exclamation" style="color:#e17055;"></i>'
        + '<span>3Dライブラリの読み込みに失敗しました</span>';
      return;
    }

    try {
      // ── シーン構築 ──
      const scene = new THREE.Scene();
      scene.background = new THREE.Color(0x1a1a2e);

      const w = content.clientWidth  || 800;
      const h = content.clientHeight || 600;
      const camera = new THREE.PerspectiveCamera(45, w / h, 0.001, 100000);

      const renderer = new THREE.WebGLRenderer({ antialias: true });
      renderer.setSize(w, h);
      renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
      renderer.shadowMap.enabled = true;
      content.appendChild(renderer.domElement);
      _3dRenderer = renderer;

      // ── ライティング ──
      scene.add(new THREE.AmbientLight(0xffffff, 0.55));
      const dir1 = new THREE.DirectionalLight(0xffffff, 0.8);
      dir1.position.set(1, 2, 3);
      scene.add(dir1);
      const dir2 = new THREE.DirectionalLight(0x88aaff, 0.4);
      dir2.position.set(-2, -1, -2);
      scene.add(dir2);

      // ── OrbitControls ──
      const controls = new THREE.OrbitControls(camera, renderer.domElement);
      controls.enableDamping = true;
      controls.dampingFactor = 0.08;
      controls.screenSpacePanning = false;

      // ── ファイル取得（認証付き）──
      const url = file.id ? `${API_BASE}/files/${file.id}/view` : null;
      if (!url) throw new Error('ファイルURLが取得できません');

      const realUrl = await _resolveFileUrl(url);
      const res = await fetch(realUrl);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const buffer = await res.arrayBuffer();

      // ── 拡張子別パース ──
      let geometry;
      if (ext === 'stl') {
        const loader = new THREE.STLLoader();
        geometry = loader.parse(buffer);
      } else {
        // STEP / STP: occt-import-js（WASM）
        if (typeof occtimportjs === 'undefined') {
          throw new Error('STEPパーサーの読み込みに失敗しました');
        }
        loading.querySelector('span').textContent = 'STEPファイルを解析中...（初回は時間がかかる場合があります）';
        const occt = await occtimportjs();
        const result = occt.ReadStepFile(new Uint8Array(buffer), null);
        geometry = _occtToGeometry(THREE, result);
      }

      // ── メッシュ生成 ──
      geometry.computeVertexNormals();
      const material = new THREE.MeshPhongMaterial({
        color: 0x0984e3,
        specular: 0x3399ff,
        shininess: 50,
        side: THREE.DoubleSide,
      });
      const mesh = new THREE.Mesh(geometry, material);

      // ── ワイヤーフレーム（薄くエッジを強調）──
      const wireMat = new THREE.MeshBasicMaterial({ color: 0x004080, wireframe: true, opacity: 0.08, transparent: true });
      const wire    = new THREE.Mesh(geometry, wireMat);
      scene.add(mesh);
      scene.add(wire);

      // ── グリッド ──
      const box = new THREE.Box3().setFromObject(mesh);
      const size = box.getSize(new THREE.Vector3());
      const center = box.getCenter(new THREE.Vector3());
      const maxDim = Math.max(size.x, size.y, size.z);
      const gridSize = maxDim * 3;
      const grid = new THREE.GridHelper(gridSize, 20, 0x334455, 0x223344);
      grid.position.y = box.min.y;
      scene.add(grid);

      // ── カメラ自動フィット ──
      const fitDist = maxDim * 1.8;
      camera.position.set(center.x, center.y + maxDim * 0.5, center.z + fitDist);
      camera.lookAt(center);
      controls.target.copy(center);
      controls.update();

      // ── 視点リセット関数 ──
      _3dResetFn = () => {
        camera.position.set(center.x, center.y + maxDim * 0.5, center.z + fitDist);
        camera.lookAt(center);
        controls.target.copy(center);
        controls.update();
      };

      // ── リサイズ対応 ──
      _3dResizeHandler = () => {
        const nw = content.clientWidth, nh = content.clientHeight;
        camera.aspect = nw / nh;
        camera.updateProjectionMatrix();
        renderer.setSize(nw, nh);
      };
      window.addEventListener('resize', _3dResizeHandler);

      // ── ツールバー表示 ──
      toolbar.style.display = 'flex';
      document.getElementById('threejsReset').onclick = _3dResetFn;

      // ── ローディング除去 ──
      loading.remove();

      // ── アニメーションループ ──
      function animate() {
        _3dAnimId = requestAnimationFrame(animate);
        controls.update();
        renderer.render(scene, camera);
      }
      animate();

    } catch (err) {
      loading.innerHTML = '<i class="fa-solid fa-circle-exclamation" style="color:#e17055;"></i>'
        + `<span>3Dファイルの読み込みに失敗しました: ${err.message}</span>`;
    }
  }

  function _occtToGeometry(THREE, result) {
    const positions = [], normals = [], indices = [];
    let offset = 0;
    for (const meshData of (result.meshes || [])) {
      const pos = meshData.attributes?.position?.array || [];
      const nor = meshData.attributes?.normal?.array   || [];
      const idx = meshData.index?.array || [];
      for (const v of pos) positions.push(v);
      for (const n of nor) normals.push(n);
      for (const i of idx) indices.push(i + offset);
      offset += pos.length / 3;
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
    if (normals.length) geo.setAttribute('normal', new THREE.Float32BufferAttribute(normals, 3));
    if (indices.length)  geo.setIndex(indices);
    return geo;
  }

  function _fetchWithAuth(url) {
    const token = localStorage.getItem('space_token');
    return fetch(url, {
      headers: {
        'Accept': '*/*',
        ...(token ? { 'Authorization': `Bearer ${token}` } : {}),
      },
    });
  }

  /* APIがJSONで署名付きURLを返す場合に対応して実際のファイルURLを解決する */
  function _resolveFileUrl(apiUrl) {
    return _fetchWithAuth(apiUrl).then(r => {
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      const ct = r.headers.get('Content-Type') || '';
      if (ct.includes('application/json')) {
        return r.json().then(data => data.url);
      }
      return apiUrl;
    });
  }

  /* DXF テキスト取得: Shift-JIS / UTF-8 を自動判定してデコード */
  function _fetchDxfText(apiUrl) {
    return _resolveFileUrl(apiUrl).then(realUrl => {
      return fetch(realUrl)
        .then(r => { if (!r.ok) throw new Error(`HTTP ${r.status}`); return r.arrayBuffer(); })
        .then(buf => _decodeDxf(buf));
    });
  }

  function _decodeDxf(buf) {
    const bytes = new Uint8Array(buf);
    /* UTF-8 BOM */
    if (bytes[0] === 0xEF && bytes[1] === 0xBB && bytes[2] === 0xBF) {
      return new TextDecoder('utf-8').decode(buf);
    }
    /* DXFヘッダーの $DWGCODEPAGE を ASCII で読んで判定（最初の8KB以内に必ず存在） */
    const header = new TextDecoder('ascii', { fatal: false }).decode(bytes.slice(0, Math.min(bytes.length, 8192)));
    if (/ANSI_932|ANSI_936|ANSI_949|ANSI_950|shift.?jis|sjis/i.test(header)) {
      return new TextDecoder('shift_jis').decode(buf);
    }
    if (/ANSI_936/.test(header)) {
      return new TextDecoder('gbk').decode(buf);
    }
    /* 全バイトを走査して 0x80以上のバイトが存在すれば Shift-JIS として試みる */
    for (let i = 0; i < bytes.length; i++) {
      const b = bytes[i];
      if ((b >= 0x81 && b <= 0x9F) || (b >= 0xE0 && b <= 0xFC)) {
        try { return new TextDecoder('shift_jis').decode(buf); } catch { break; }
      }
    }
    return new TextDecoder('utf-8').decode(buf);
  }

  function _openPdf(file, content, loading) {
    const url = file.preview_url
      || (file.id ? `${API_BASE}/files/${file.id}/view` : null);

    if (!url) {
      loading.innerHTML = '<i class="fa-solid fa-file-pdf" style="color:#e17055;font-size:48px;"></i>'
        + '<span style="margin-top:8px;">PDFプレビューを読み込めませんでした</span>';
      return;
    }

    if (file.preview_url) {
      loading.remove();
      const iframe = document.createElement('iframe');
      iframe.id = 'pdfFrame';
      iframe.src = url + '#toolbar=1&navpanes=0';
      content.appendChild(iframe);
    } else {
      _resolveFileUrl(url)
        .then(realUrl => fetch(realUrl))
        .then(r => { if (!r.ok) throw new Error(`HTTP ${r.status}`); return r.blob(); })
        .then(blob => {
          loading.remove();
          const blobUrl = URL.createObjectURL(blob);
          const iframe = document.createElement('iframe');
          iframe.id = 'pdfFrame';
          iframe.src = blobUrl + '#toolbar=1&navpanes=0';
          iframe.dataset.blobUrl = blobUrl;
          content.appendChild(iframe);
        })
        .catch(err => {
          loading.innerHTML = '<i class="fa-solid fa-circle-exclamation" style="color:#e17055;"></i>'
            + `<span>PDFの読み込みに失敗しました: ${err.message}</span>`;
        });
    }
  }

  function _openDxf(file, content, loading, toolbar) {
    const url = file.preview_url
      || (file.id ? `${API_BASE}/files/${file.id}/view` : null);

    if (!url && !file.dxf_text) {
      loading.innerHTML = '<i class="fa-solid fa-file-lines" style="color:#74b9ff;font-size:48px;"></i>'
        + '<span style="margin-top:8px;">DXFプレビューを読み込めませんでした</span>'
        + `<span style="font-size:12px;color:rgba(255,255,255,.4);">${file.file_name}</span>`;
      return;
    }

    const initCanvas = (dxfText) => {
      loading.remove();
      toolbar.style.display = 'flex';
      DXF.init(content);
      const onResize = () => {
        const w = content.clientWidth, h = content.clientHeight;
        if (w > 0) DXF.resize(w, h);
      };
      DXF._resizeHandler = onResize;
      window.addEventListener('resize', onResize);
      DXF.load(dxfText);
      document.getElementById('dxfZoomIn') .onclick = () => DXF.zoom(1.3);
      document.getElementById('dxfZoomOut').onclick = () => DXF.zoom(0.77);
      document.getElementById('dxfFit')    .onclick = () => DXF.fit();
    };

    if (file.dxf_text) {
      initCanvas(file.dxf_text);
    } else {
      /* 公開URL / 認証URL どちらも arrayBuffer で取得して Shift-JIS 判定 */
      const fetchFn = file.preview_url
        ? () => fetch(url).then(r => { if (!r.ok) throw new Error(`HTTP ${r.status}`); return r.arrayBuffer(); }).then(_decodeDxf)
        : () => _fetchDxfText(url);

      fetchFn()
        .then(text => initCanvas(text))
        .catch(err => {
          loading.innerHTML = '<i class="fa-solid fa-circle-exclamation" style="color:#e17055;"></i>'
            + `<span>DXFの読み込みに失敗しました: ${err.message}</span>`;
        });
    }
  }

  function close() {
    const iframe = document.getElementById('pdfFrame');
    if (iframe?.dataset.blobUrl) URL.revokeObjectURL(iframe.dataset.blobUrl);

    if (DXF._resizeHandler)    { window.removeEventListener('resize',    DXF._resizeHandler);    DXF._resizeHandler    = null; }
    if (DXF._mouseMoveHandler) { window.removeEventListener('mousemove', DXF._mouseMoveHandler); DXF._mouseMoveHandler = null; }
    if (DXF._mouseUpHandler)   { window.removeEventListener('mouseup',   DXF._mouseUpHandler);   DXF._mouseUpHandler   = null; }

    // 3Dリソース解放
    if (_3dAnimId)        { cancelAnimationFrame(_3dAnimId); _3dAnimId = null; }
    if (_3dRenderer)      { _3dRenderer.dispose(); _3dRenderer = null; }
    if (_3dResizeHandler) { window.removeEventListener('resize', _3dResizeHandler); _3dResizeHandler = null; }
    _3dResetFn = null;

    document.getElementById('viewerModal').classList.add('hidden');
    document.getElementById('viewerContent').innerHTML = '';
    document.getElementById('dxfToolbar').style.display    = 'none';
    document.getElementById('threejsToolbar').style.display = 'none';
    DXF.canvas = null;
    DXF.ctx = null;
    DXF.entities = [];
  }

  document.addEventListener('DOMContentLoaded', () => {
    document.getElementById('viewerClose')?.addEventListener('click', close);
    document.getElementById('viewerModal')?.addEventListener('click', e => {
      if (e.target === document.getElementById('viewerModal')) close();
    });
    document.addEventListener('keydown', e => { if (e.key === 'Escape') close(); });
  });

  /* viewer-page.html（別タブ版）向けに内部エンジンを公開 */
  function _drawDXF(ctx, cw, ch, entities, cam, w2s) {
    ctx.clearRect(0, 0, cw, ch);
    ctx.fillStyle = '#11111b';
    ctx.fillRect(0, 0, cw, ch);
    for (const e of entities) {
      ctx.strokeStyle = dxfColor(e.color);
      ctx.fillStyle   = dxfColor(e.color);
      ctx.lineWidth = 1;
      ctx.setLineDash([]);
      _drawEntityWith(ctx, e, cam, w2s);
    }
  }

  /* worldToScreen を外から受け取って描画する（viewer-page.html用） */
  function _drawEntityWith(ctx, e, cam, w2s) {
    switch (e.type) {
      case 'LINE': {
        const a=w2s(e.x1,e.y1), b=w2s(e.x2,e.y2);
        ctx.beginPath(); ctx.moveTo(a.x,a.y); ctx.lineTo(b.x,b.y); ctx.stroke(); break;
      }
      case 'CIRCLE': {
        const c=w2s(e.cx,e.cy);
        ctx.beginPath(); ctx.arc(c.x,c.y,e.r*cam.zoom,0,Math.PI*2); ctx.stroke(); break;
      }
      case 'ARC': {
        const c=w2s(e.cx,e.cy);
        ctx.beginPath(); ctx.arc(c.x,c.y,e.r*cam.zoom,-e.endAngle*Math.PI/180,-e.startAngle*Math.PI/180); ctx.stroke(); break;
      }
      case 'POINT': {
        const p=w2s(e.x,e.y); ctx.beginPath(); ctx.arc(p.x,p.y,2,0,Math.PI*2); ctx.fill(); break;
      }
      case 'LWPOLYLINE': {
        if (e.vertices.length<2) break;
        const verts=e.vertices, count=e.closed?verts.length:verts.length-1;
        for (let j=0;j<count;j++) {
          const v1=verts[j], v2=verts[(j+1)%verts.length];
          ctx.beginPath();
          if (v1.bulge && Math.abs(v1.bulge)>0.001) {
            _bulgeArcWith(ctx,v1,v2,v1.bulge,cam,w2s);
          } else {
            const pa=w2s(v1.x,v1.y), pb=w2s(v2.x,v2.y);
            ctx.moveTo(pa.x,pa.y); ctx.lineTo(pb.x,pb.y);
          }
          ctx.stroke();
        }
        break;
      }
      case 'TEXT': {
        const p=w2s(e.x,e.y), fs=e.height*cam.zoom;
        if (fs<1) break;
        ctx.save();
        ctx.font=`${fs}px 'Noto Sans JP',sans-serif`;
        ctx.textAlign=(e.halign===1||e.halign===4)?'center':(e.halign===2)?'right':'left';
        ctx.textBaseline=(e.halign===4)?'middle':(e.valign===3)?'top':(e.valign===2)?'middle':(e.valign===1)?'bottom':'alphabetic';
        const lines=e.text.split('\n');
        const lh=fs*1.2*(e._lineSpacing||1.0);
        const style=_textStyles[e._style];
        const wf=(e._widthFactor||1)*((style?style.widthFactor:1))*((style&&style.isShx)?0.72:1);
        ctx.translate(p.x,p.y);
        if (e.rotation) ctx.rotate(-e.rotation*Math.PI/180);
        if (wf!==1) ctx.scale(wf,1);
        lines.forEach((l,i)=>ctx.fillText(l,0,i*lh));
        ctx.restore(); break;
      }
      case 'ELLIPSE': {
        const c=w2s(e.cx,e.cy), a=Math.sqrt(e.ex**2+e.ey**2)*cam.zoom, b=a*(e.ratio||0.5);
        ctx.beginPath(); ctx.ellipse(c.x,c.y,Math.max(0.1,a),Math.max(0.1,b),-Math.atan2(e.ey,e.ex),e.startParam||0,e.endParam||Math.PI*2); ctx.stroke(); break;
      }
      case 'SPLINE': {
        if (e.controlPoints.length<2) break;
        const pts=e.controlPoints.map(p=>w2s(p.x,p.y));
        ctx.beginPath(); ctx.moveTo(pts[0].x,pts[0].y);
        if (pts.length===2) ctx.lineTo(pts[1].x,pts[1].y);
        else if (pts.length===3) ctx.quadraticCurveTo(pts[1].x,pts[1].y,pts[2].x,pts[2].y);
        else {
          for (let j=1;j<pts.length-2;j++) {
            const xc=(pts[j].x+pts[j+1].x)/2, yc=(pts[j].y+pts[j+1].y)/2;
            ctx.quadraticCurveTo(pts[j].x,pts[j].y,xc,yc);
          }
          const n=pts.length-1; ctx.quadraticCurveTo(pts[n-1].x,pts[n-1].y,pts[n].x,pts[n].y);
        }
        ctx.stroke(); break;
      }
      case 'SOLID': {
        const p1=w2s(e.x1,e.y1),p2=w2s(e.x2,e.y2),p3=w2s(e.x3,e.y3),p4=w2s(e.x4,e.y4);
        ctx.beginPath(); ctx.moveTo(p1.x,p1.y); ctx.lineTo(p2.x,p2.y);
        ctx.lineTo(p4.x,p4.y); ctx.lineTo(p3.x,p3.y); ctx.closePath(); ctx.fill(); break;
      }
    }
  }

  function _bulgeArcWith(ctx, v1, v2, bulge, cam, w2s) {
    const dx=v2.x-v1.x, dy=v2.y-v1.y, cl=Math.sqrt(dx*dx+dy*dy);
    if (cl<0.0001) return;
    const sag=Math.abs(bulge)*cl/2, r=(cl*cl/4+sag*sag)/(2*sag);
    const midX=(v1.x+v2.x)/2, midY=(v1.y+v2.y)/2;
    const d=Math.sqrt(Math.max(0,r*r-(cl/2)**2));
    const sign=bulge>0?1:-1, nx=-dy/cl, ny=dx/cl;
    const cx=midX+nx*d*sign, cy=midY+ny*d*sign;
    const sc=w2s(cx,cy);
    const sa=Math.atan2(-(v1.y-cy),(v1.x-cx)), ea=Math.atan2(-(v2.y-cy),(v2.x-cx));
    const sp=w2s(v1.x,v1.y);
    ctx.moveTo(sp.x,sp.y);
    ctx.arc(sc.x,sc.y,r*cam.zoom,sa,ea,bulge<0);
  }

  /* viewer-page.html（別タブ）向け: コンテナにCanvasを作ってDXFエンジンを起動 */
  function _createDxfEngine(container, entities) {
    /* DXFオブジェクトをリセットして再初期化 */
    DXF.canvas = null; DXF.ctx = null;
    DXF.entities = entities;
    DXF.cam = { x: 0, y: 0, zoom: 1 };
    DXF.dragging = false; DXF.dragStart = null; DXF._resizeHandler = null;
    DXF.init(container);
    DXF.fit();
    return DXF;
  }

  return { open, close, _parseDXF: parseDXF, _drawDXF, _createDxfEngine, _occtToGeometry };
})();
