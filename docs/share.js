/* =========================================================
   喵星人头像墙 · 访客页
   只做一件事：把 meowtonians/ 里的照片拼成一个大猫头。

   · 照片清单来自同目录的 photos.json（由工作台「发布到网站」生成）
   · 拼贴核心与工作台 app.js 的对应段落保持一致（改一边记得同步另一边）
   · 发布出来的照片已经是裁剪成品，所以这里不需要裁剪/旋转参数
   · 访客点「下载这张」拿到的整张图会盖一层水印（页面上的显示保持干净）
   ========================================================= */

/* ---------- 猫头轮廓（唯一真源，与工作台的 logo 一致） ---------- */
const CAT_PATH = "M500 872 C356 872 176 748 172 572 C169 498 190 418 208 352 L148 92 C143 74 158 58 176 66 L372 158 C414 140 456 131 500 131 C544 131 586 140 628 158 L824 66 C842 58 857 74 852 92 L792 352 C810 418 831 498 828 572 C824 748 644 872 500 872 Z";

const VW = 1000;              // 逻辑坐标宽
const VH = 900;               // 逻辑坐标高
const SCALE = 1400 / VW;      // canvas 实际像素倍率

const WHISKERS = [
  [215, 560, 62, 520], [208, 610, 46, 600], [215, 658, 62, 692],
  [785, 560, 938, 520], [792, 610, 954, 600], [785, 658, 938, 692]
];

const MIN_COLS = 5, MAX_COLS = 22;

/* ---------- 状态 ---------- */
let photos = [];              // { file, name, _bitmap }
let meta = null;
let seed = 7;
let layoutMode = 'grid';      // 访客页默认「几 × 几 铺满」
let ready = false;

/* ---------- DOM ---------- */
const $ = (id) => document.getElementById(id);
const canvas = $('mosaic');
const ctx = canvas.getContext('2d');
const catPath2D = new Path2D(CAT_PATH);

/* ---------- 随机 ---------- */
function mulberry32(a) {
  return function () {
    a |= 0; a = a + 0x6D2B79F5 | 0;
    let t = Math.imul(a ^ a >>> 15, 1 | a);
    t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
    return ((t ^ t >>> 14) >>> 0) / 4294967296;
  };
}

function shuffleWithSeed(arr, s) {
  const rnd = mulberry32(s);
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rnd() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

/* =========================================================
   版面计算
   ========================================================= */

// 均分切分：把整块猫头按张数递归二分，每张照片面积相等（照片少时最自然）
function sliceRects(n) {
  if (n <= 1) return [{ x: 0, y: 0, w: VW, h: VH }];
  const out = [];
  (function split(rect, count) {
    if (count <= 1) { out.push(rect); return; }
    const first = Math.ceil(count / 2);
    if (rect.w >= rect.h) {
      const w1 = rect.w * first / count;
      split({ x: rect.x, y: rect.y, w: w1, h: rect.h }, first);
      split({ x: rect.x + w1, y: rect.y, w: rect.w - w1, h: rect.h }, count - first);
    } else {
      const h1 = rect.h * first / count;
      split({ x: rect.x, y: rect.y, w: rect.w, h: h1 }, first);
      split({ x: rect.x, y: rect.y + h1, w: rect.w, h: rect.h - h1 }, count - first);
    }
  })({ x: 0, y: 0, w: VW, h: VH }, n);
  return out;
}

// 规则网格
function gridRects(cols, rows) {
  const tw = VW / cols, th = VH / rows;
  const out = [];
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) out.push({ x: c * tw, y: r * th, w: tw, h: th });
  }
  return out;
}

// 按照片数挑一个「浪费格子最少、格子又不至于太扁长」的网格
function autoGrid(n) {
  if (n <= 1) return { cols: 1, rows: 1 };
  let best = null;
  let fallback = null;
  for (let c = 1; c <= n; c++) {
    const r = Math.ceil(n / c);
    const waste = c * r - n;
    const ar = (VW / c) / (VH / r);
    const cand = { cols: c, rows: r, waste, ar, score: Math.abs(Math.log(ar)) };
    if (!fallback || cand.score < fallback.score) fallback = cand;
    if (ar >= 0.5 && ar <= 2) {
      if (!best || cand.waste < best.waste ||
          (cand.waste === best.waste && cand.score < best.score)) best = cand;
    }
  }
  return best || fallback;
}

/* ---------- 主体格优先填充 ----------
   格子从画布左上角按行生成，而猫头在画布中间：直接按行填充会让
   每张照片的第一份落在头顶/耳朵的边缘格里。这里用轮廓路径
   isPointInPath 对每格 9×9 采样算覆盖率（按列数缓存），填充顺序改为
   完整格（覆盖率 ≥95%）在前、按阅读顺序，边缘格在后用重复照片补满。 */
const _coverCache = new Map(); // cols -> 每格覆盖率数组（行优先）

function cellCoverages(cols, rows) {
  if (_coverCache.has(cols)) return _coverCache.get(cols);
  const tw = VW / cols, th = VH / rows;
  const out = [];
  ctx.save();
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      let inside = 0;
      for (let sy = 0; sy < 9; sy++) {
        const py = r * th + (th * (sy + 0.5)) / 9;
        for (let sx = 0; sx < 9; sx++) {
          const px = c * tw + (tw * (sx + 0.5)) / 9;
          if (ctx.isPointInPath(catPath2D, px, py)) inside++;
        }
      }
      out.push(inside / 81);
    }
  }
  ctx.restore();
  _coverCache.set(cols, out);
  return out;
}

// 主体格优先的格子顺序：完整格在前（保持阅读顺序），边缘格在后
function mainFirstRects(cols, rows) {
  const rects = gridRects(cols, rows);
  const cov = cellCoverages(cols, rows);
  return rects
    .map((_, i) => i)
    .sort((a, b) => (cov[b] >= 0.95) - (cov[a] >= 0.95) || a - b)
    .map((i) => rects[i]);
}

/* ---------- 每档列数的完整格数（与工作台实测值一致） ---------- */
const MAIN_CELLS = [9, 10, 13, 20, 28, 34, 41, 48, 61, 72, 89, 98, 114, 128, 146, 156, 169, 188]; // 5~22 列

const mainCellsOf = (cols) =>
  MAIN_CELLS[Math.max(0, Math.min(MAIN_CELLS.length - 1, Math.round(cols) - 5))] || 0;

const gridRowsOf = (cols) => Math.ceil(VH / (VW / cols));

// 建议列数 = 「完整格数 ≥ 照片数」的最小列数（格子能多大就多大）
function suggestCols(n) {
  for (let c = MIN_COLS; c <= MAX_COLS; c++) if (MAIN_CELLS[c - MIN_COLS] >= n) return c;
  return MAX_COLS;
}

/* =========================================================
   绘制
   ========================================================= */

// 发布出来的图已是成品，等比铺满整格并居中裁切
function drawCover(cx, rec, x, y, w, h) {
  const img = rec._bitmap;
  if (!img) return;
  const iw = img.width || img.naturalWidth || 0;
  const ih = img.height || img.naturalHeight || 0;
  if (!iw || !ih) return;
  const k = Math.max(w / iw, h / ih);
  const dw = iw * k, dh = ih * k;
  cx.drawImage(img, x + (w - dw) / 2, y + (h - dh) / 2, dw, dh);
}

function render() {
  const gap = Number($('gap').value);
  const showWhiskers = $('whiskers').checked;
  const loaded = photos.filter((p) => p._bitmap);
  const n = loaded.length;

  let rects = [];
  let note = '';
  const cols = Number($('density').value);
  const gridRows = gridRowsOf(cols);
  $('densityVal').textContent = `${cols} × ${gridRows}`;
  $('gapVal').textContent = gap;

  if (!n) {
    note = '正在加载照片…';
  } else if (layoutMode === 'grid') {
    rects = mainFirstRects(cols, gridRows);
    const main = mainCellsOf(cols);
    note = `${n} 张照片铺成 ${cols} × ${gridRows}；其中 ${main} 格落在猫头主体内`;
  } else if (n === 1) {
    rects = sliceRects(1);
    note = '整张猫头就是这一张';
  } else if (n <= 8) {
    rects = sliceRects(n);
    note = `${n} 张照片平均分成 ${n} 块，每张只出现一次`;
  } else {
    const g = autoGrid(n);
    rects = gridRects(g.cols, g.rows);
    note = `${n} 张照片按 ${g.cols} × ${g.rows} 均分铺满`;
  }
  $('layoutNote').textContent = note;

  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  ctx.setTransform(SCALE, 0, 0, SCALE, 0, 0);

  // 1) 猫头底影
  ctx.save();
  ctx.shadowColor = 'rgba(140,100,62,.22)';
  ctx.shadowBlur = 26;
  ctx.shadowOffsetY = 12;
  ctx.fillStyle = '#fff';
  ctx.fill(catPath2D);
  ctx.restore();

  // 2) 拼贴（裁剪在猫头内）
  ctx.save();
  ctx.clip(catPath2D);
  const order = shuffleWithSeed(loaded, seed);
  rects.forEach((rc, i) => {
    const rec = order[i % order.length];
    const x = rc.x + gap / 2;
    const y = rc.y + gap / 2;
    const w = Math.max(1, rc.w - gap);
    const h = Math.max(1, rc.h - gap);
    drawCover(ctx, rec, x, y, w, h);
  });
  // 轻微高光，让层次更柔和
  const g2 = ctx.createLinearGradient(0, 0, 0, VH);
  g2.addColorStop(0, 'rgba(255,255,255,.16)');
  g2.addColorStop(0.55, 'rgba(255,255,255,0)');
  g2.addColorStop(1, 'rgba(90,60,30,.10)');
  ctx.fillStyle = g2;
  ctx.fillRect(0, 0, VW, VH);
  ctx.restore();

  // 3) 轮廓 + 胡须
  if (showWhiskers) {
    ctx.save();
    ctx.lineJoin = 'round';
    ctx.lineWidth = 9;
    ctx.strokeStyle = 'rgba(255,255,255,.92)';
    ctx.stroke(catPath2D);
    ctx.lineWidth = 3.4;
    ctx.strokeStyle = 'rgba(122,88,58,.55)';
    ctx.stroke(catPath2D);

    ctx.lineCap = 'round';
    ctx.lineWidth = 7;
    ctx.strokeStyle = 'rgba(122,88,58,.42)';
    WHISKERS.forEach(([x1, y1, x2, y2]) => {
      ctx.beginPath();
      ctx.moveTo(x1, y1);
      ctx.lineTo(x2, y2);
      ctx.stroke();
    });
    ctx.restore();
  }
}

/* =========================================================
   加载照片
   ========================================================= */
async function decodeBlob(blob) {
  if ('createImageBitmap' in window) {
    try { return await createImageBitmap(blob, { imageOrientation: 'from-image' }); } catch (e) { /* next */ }
    try { return await createImageBitmap(blob); } catch (e) { /* next */ }
  }
  const url = URL.createObjectURL(blob);
  try {
    return await new Promise((res, rej) => {
      const img = new Image();
      img.onload = () => res(img);
      img.onerror = rej;
      img.src = url;
    });
  } finally { setTimeout(() => URL.revokeObjectURL(url), 8000); }
}

function setProgress(done, total) {
  const bar = $('loadBar');
  const txt = $('loadTxt');
  if (!bar || !txt) return;
  const pct = total ? Math.round((done / total) * 100) : 0;
  bar.style.width = pct + '%';
  txt.textContent = `正在铺满猫头… ${done} / ${total}`;
}

async function loadPhotos() {
  let data;
  try {
    const res = await fetch('photos.json', { cache: 'no-store' });
    if (!res.ok) throw new Error('HTTP ' + res.status);
    data = await res.json();
  } catch (e) {
    $('loadTxt').textContent = '没找到照片清单（photos.json），请先用工作台的「发布到网站」生成并解压到这里。';
    $('loadBar').style.display = 'none';
    return;
  }
  meta = data || {};
  if (meta.watermark) WM_TEXT = String(meta.watermark);
  const list = (Array.isArray(meta.photos) ? meta.photos : []).filter((p) => p && p.file);

  const total = list.length;
  setProgress(0, total);
  if (!total) {
    $('loadTxt').textContent = '清单里还没有照片。';
    $('loadBar').style.display = 'none';
    return;
  }

  // 并发解码，边下边铺（并发数别太高，手机容易顶不住）
  const CONC = 5;
  let next = 0, done = 0;
  const slots = new Array(total).fill(null);

  const worker = async () => {
    while (true) {
      const i = next++;
      if (i >= total) return;
      const item = list[i];
      try {
        // no-cache：每次先向服务器确认有没有更新（没变就 304，依然很快）。
        // 不能用 force-cache —— 图片重新发布后浏览器会一直用旧缓存。
        const r = await fetch(item.file, { cache: 'no-cache' });
        if (!r.ok) throw new Error('HTTP ' + r.status);
        const bmp = await decodeBlob(await r.blob());
        slots[i] = { file: item.file, name: item.name || '', _bitmap: bmp };
      } catch (e) {
        console.warn('这张没能加载：' + item.file, e);
        slots[i] = null;
      }
      done++;
      setProgress(done, total);
      if (done % 6 === 0 || done === total) {
        photos = slots.filter(Boolean);
        render();
      }
    }
  };
  await Promise.all(Array.from({ length: Math.min(CONC, total) }, worker));

  photos = slots.filter(Boolean);
  ready = true;
  render();
  $('loading').classList.add('gone');

  // 默认档位：照片多就铺满到「每张都能完整展示」的列数
  applyDefaultLayout();
  renderOverview();
}

function applyDefaultLayout() {
  const n = photos.length;
  const cols = n > 8 ? suggestCols(n) : 10;
  $('density').value = cols;
  document.querySelectorAll('#modeSeg button').forEach((b) => {
    b.classList.toggle('on', b.dataset.mode === layoutMode);
  });
  syncMode();
  render();
}

function renderOverview() {
  const el = $('overview');
  const n = (meta && Number(meta.cats)) || photos.length;
  const when = (meta && meta.updatedAt) ? fmtMonth(meta.updatedAt) : '';
  el.innerHTML = `${pawSvg()}<b>${n}</b> 个喵星人${when ? `<span class="ov-when">· 更新于 ${when}</span>` : ''}`;
  el.classList.add('ready');
}

function fmtMonth(iso) {
  const d = new Date(iso);
  if (isNaN(d)) return '';
  return `${d.getFullYear()} 年 ${d.getMonth() + 1} 月`;
}

function pawSvg() {
  return `<svg class="ov-paw" viewBox="0 0 64 64" aria-hidden="true">
    <ellipse cx="32" cy="42" rx="15" ry="12" fill="currentColor"/>
    <ellipse cx="13" cy="26" rx="6.5" ry="8" fill="currentColor"/>
    <ellipse cx="25" cy="17" rx="6.5" ry="8.5" fill="currentColor"/>
    <ellipse cx="39" cy="17" rx="6.5" ry="8.5" fill="currentColor"/>
    <ellipse cx="51" cy="26" rx="6.5" ry="8" fill="currentColor"/>
  </svg>`;
}

/* =========================================================
   水印（与工作台 app.js 里的同名函数保持一致，改一边记得同步另一边）
   ========================================================= */
let WM_TEXT = 'Theo';   // 会用 photos.json 里的 watermark 字段覆盖（与工作台发布时填的水印文字一致）

// 一个小猫爪：掌垫 + 四个趾垫（以 (x,y) 为中心，s 为整体宽度）
function pawAt(cx, x, y, s) {
  const r = s / 2;
  cx.beginPath();
  cx.ellipse(x, y + r * 0.44, r * 0.60, r * 0.50, 0, 0, Math.PI * 2);
  cx.ellipse(x - r * 0.60, y - r * 0.26, r * 0.20, r * 0.26, 0, 0, Math.PI * 2);
  cx.ellipse(x - r * 0.21, y - r * 0.50, r * 0.20, r * 0.27, 0, 0, Math.PI * 2);
  cx.ellipse(x + r * 0.21, y - r * 0.50, r * 0.20, r * 0.27, 0, 0, Math.PI * 2);
  cx.ellipse(x + r * 0.60, y - r * 0.26, r * 0.20, r * 0.26, 0, 0, Math.PI * 2);
  cx.fill();
  cx.stroke();
}

// 对角密排铺满整张图：每个单元 = 小猫爪 + 「Theo」
function drawWatermark(cx, w, h) {
  const span = Math.hypot(w, h);
  const unit = Math.max(96, Math.round(Math.min(w, h) * 0.40));   // 单元间距
  const fs = Math.max(11, Math.round(unit * 0.26));               // 文字大小
  const paw = fs * 1.15;
  cx.save();
  cx.translate(w / 2, h / 2);
  cx.rotate(-Math.PI / 5);
  cx.textAlign = 'center';
  cx.textBaseline = 'middle';
  cx.font = `700 ${fs}px system-ui,-apple-system,"PingFang SC",sans-serif`;
  cx.fillStyle = 'rgba(255,255,255,.22)';
  cx.strokeStyle = 'rgba(58,42,32,.13)';
  cx.lineWidth = Math.max(1, fs * 0.07);
  cx.lineJoin = 'round';
  let row = 0;
  for (let y = -span / 2; y <= span / 2; y += unit, row++) {
    const offset = (row % 2) * (unit / 2);                        // 交错排列更均匀
    for (let x = -span / 2; x <= span / 2; x += unit) {
      const px = x + offset;
      pawAt(cx, px, y - fs * 0.62, paw);
      cx.strokeText(WM_TEXT, px, y + fs * 0.72);
      cx.fillText(WM_TEXT, px, y + fs * 0.72);
    }
  }
  cx.restore();
}

/* 下载用的画布：整张都盖上水印（不裁猫头轮廓）。
   猫头外的透明区也会铺上，所以不管怎么裁都还留着出处。 */
function watermarkedCanvas() {
  const c = document.createElement('canvas');
  c.width = canvas.width;
  c.height = canvas.height;
  const cx = c.getContext('2d');
  cx.drawImage(canvas, 0, 0);
  drawWatermark(cx, c.width, c.height);
  return c;
}

/* =========================================================
   摸摸猫：点一下大猫头，点击处冒出猫爪 + 爱心（可选喵一声）
   与长按存图共存：压住 <0.6s 且没滑动的才算「摸」
   ========================================================= */
const PET_PAW = `<svg viewBox="0 0 64 64"><g fill="#F6C6A0" stroke="#A9714B" stroke-width="2.4" stroke-linejoin="round">
  <ellipse cx="32" cy="42" rx="15" ry="12"/><ellipse cx="13" cy="26" rx="6.5" ry="8"/>
  <ellipse cx="25" cy="17" rx="6.5" ry="8.5"/><ellipse cx="39" cy="17" rx="6.5" ry="8.5"/><ellipse cx="51" cy="26" rx="6.5" ry="8"/>
</g></svg>`;
const PET_HEART = `<svg viewBox="0 0 32 32"><path d="M16 28C8 22 3 17 3 11.5 3 7.4 6.2 4.5 10 4.5c2.4 0 4.6 1.2 6 3.2 1.4-2 3.6-3.2 6-3.2 3.8 0 7 2.9 7 7C29 17 24 22 16 28Z" fill="#F2A0B4" stroke="#B4576F" stroke-width="1.6"/></svg>`;

// 「喵」用 Web Audio 现场合成（零音频文件）：锯齿波 + 音高先扬后落 + 低通收尾
let _audio = null;
function meow() {
  try {
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    _audio = _audio || new AC();
    if (_audio.state === 'suspended') _audio.resume();
    const t = _audio.currentTime + 0.01;
    const base = 1 + (Math.random() * 0.16 - 0.08);      // 每次音高微抖，像不同的猫
    const osc = _audio.createOscillator();
    osc.type = 'sawtooth';
    osc.frequency.setValueAtTime(480 * base, t);
    osc.frequency.exponentialRampToValueAtTime(900 * base, t + 0.09);
    osc.frequency.setValueAtTime(870 * base, t + 0.15);
    osc.frequency.exponentialRampToValueAtTime(340 * base, t + 0.42);
    const lp = _audio.createBiquadFilter();
    lp.type = 'lowpass'; lp.Q.value = 3;
    lp.frequency.setValueAtTime(1900, t);
    lp.frequency.exponentialRampToValueAtTime(700, t + 0.42);
    const g = _audio.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(0.2, t + 0.03);
    g.gain.setValueAtTime(0.2, t + 0.2);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.44);
    osc.connect(lp).connect(g).connect(_audio.destination);
    osc.start(t); osc.stop(t + 0.5);
  } catch (e) { /* 声音失败不影响摸猫 */ }
}

function pet(clientX, clientY) {
  const layer = $('petLayer');
  if (!layer) return;
  const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;
  const spawn = (svg, size, i) => {
    const s = document.createElement('span');
    s.className = 'pet';
    s.style.left = clientX + 'px';
    s.style.top = clientY + 'px';
    s.style.width = s.style.height = size + 'px';
    s.style.setProperty('--dx', (Math.random() * 56 - 28).toFixed(0) + 'px');
    s.style.setProperty('--r', (Math.random() * 40 - 20).toFixed(0) + 'deg');
    s.style.setProperty('--s', (0.85 + Math.random() * 0.4).toFixed(2));
    s.style.animationDelay = (reduced ? 0 : i * 70) + 'ms';
    s.innerHTML = svg;
    layer.appendChild(s);
    setTimeout(() => s.remove(), 1350 + i * 70);
  };
  spawn(PET_PAW, 30, 0);
  const hearts = reduced ? 1 : 3;                     // 减少动态效果时只留一枚
  for (let i = 0; i < hearts; i++) spawn(PET_HEART, 16 + Math.random() * 12, i + 1);
  if ($('meow').checked) meow();
}

/* =========================================================
   控件
   ========================================================= */
function syncMode() {
  $('densityCtl').style.display = layoutMode === 'grid' ? '' : 'none';
}

function bind() {
  $('modeSeg').addEventListener('click', (e) => {
    const b = e.target.closest('button[data-mode]');
    if (!b) return;
    layoutMode = b.dataset.mode;
    document.querySelectorAll('#modeSeg button').forEach((x) => x.classList.toggle('on', x === b));
    syncMode();
    render();
  });
  $('density').addEventListener('input', render);
  $('gap').addEventListener('input', render);
  $('whiskers').addEventListener('change', render);
  $('shuffle').addEventListener('click', () => {
    seed = Math.floor(Math.random() * 1e6);
    render();
  });
function saveMosaic() {
  // 下载的是「整张都带水印」的那版；屏幕上显示的拼贴保持干净
  watermarkedCanvas().toBlob((b) => {
    const a = document.createElement('a');
    const d = new Date();
    const stamp = `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, '0')}${String(d.getDate()).padStart(2, '0')}`;
    a.href = URL.createObjectURL(b);
    a.download = `喵星人头像墙-${stamp}.png`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 8000);
  }, 'image/png');
}

$('download').addEventListener('click', saveMosaic);

// 右键大猫头本来会弹出浏览器的「图片另存为」，存的是原图没有水印 —— 拦下来走水印版
canvas.addEventListener('contextmenu', (e) => {
  e.preventDefault();
  saveMosaic();
});

// 手机长按同理：压住 0.6 秒存带水印版（原生菜单已被 CSS 关掉）；
// 轻点（<0.6s 且没滑动）则算「摸猫」
let pressTimer = null, pressXY = null, pressT0 = 0, pressMoved = false;
canvas.addEventListener('pointerdown', (e) => {
  pressXY = { x: e.clientX, y: e.clientY };
  pressT0 = Date.now();
  pressMoved = false;
  if (e.button && e.button !== 0) return;             // 右键走 contextmenu 存图
  pressTimer = setTimeout(saveMosaic, 600);
});
['pointerup', 'pointercancel', 'pointerleave'].forEach((ev) =>
  canvas.addEventListener(ev, (e) => {
    clearTimeout(pressTimer);
    if (ev === 'pointerup' && pressXY && !pressMoved && Date.now() - pressT0 < 600) {
      pet(e.clientX, e.clientY);
      pressXY = null;
    }
  }));
canvas.addEventListener('pointermove', (e) => {
  // 手指滑动（想滚动页面）就不算长按，也不算摸
  if (pressXY && (Math.abs(e.clientX - pressXY.x) > 10 || Math.abs(e.clientY - pressXY.y) > 10)) {
    clearTimeout(pressTimer);
    pressMoved = true;
  }
});
  $('infoBtn').addEventListener('click', () => {
    const on = document.body.classList.toggle('hide-overview');
    $('infoBtn').setAttribute('aria-pressed', String(!on));
    $('infoBtn').title = on ? '显示总览' : '只显示拼贴';
  });
  // 喵声开关：默认开，记住访客偏好
  $('meow').checked = localStorage.getItem('meowwall.meow') !== '0';
  $('meow').addEventListener('change', () => {
    localStorage.setItem('meowwall.meow', $('meow').checked ? '1' : '0');
  });
}

bind();
render();
loadPhotos();
