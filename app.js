/* =========================================================
   猫咪头像墙 · 上门喂猫拍照记录 + 大猫头拼贴
   ========================================================= */

/* ---------- 猫头轮廓（唯一真源，与 index.html 中的 logo 一致） ---------- */
const CAT_PATH = "M500 872 C356 872 176 748 172 572 C169 498 190 418 208 352 L148 92 C143 74 158 58 176 66 L372 158 C414 140 456 131 500 131 C544 131 586 140 628 158 L824 66 C842 58 857 74 852 92 L792 352 C810 418 831 498 828 572 C824 748 644 872 500 872 Z";

const VW = 1000;              // 逻辑坐标宽
const VH = 900;               // 逻辑坐标高
const SCALE = 1400 / VW;      // canvas 实际像素倍率

const WHISKERS = [
  [215, 560, 62, 520], [208, 610, 46, 600], [215, 658, 62, 692],
  [785, 560, 938, 520], [792, 610, 954, 600], [785, 658, 938, 692]
];

const MAX_SIZE = 1600;        // 存库前最长边压缩
const THUMB_SIZE = 420;

/* ---------- 状态 ---------- */
let photos = [];              // {id,name,date,place,note,blob,thumb,w,h,createdAt,_bitmap,_thumbUrl}
let seed = 7;
let storageOK = true;
let layoutMode = 'auto';      // auto = 按照片数均分 | grid = 几 × 几 铺满
let demoActive = false;       // 是否处于示例模式
let demoSnapshot = null;      // 进入示例前的真实照片（仅内存，退出时原样恢复）

/* ---------- DOM ---------- */
const $ = (id) => document.getElementById(id);
const canvas = $('mosaic');
const ctx = canvas.getContext('2d');
const catPath2D = new Path2D(CAT_PATH);

/* =========================================================
   工具
   ========================================================= */
const todayISO = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};

const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 7);

// 「2026-09-23」往前/往后推 n 天（用于示例数据）
function dateOffset(days) {
  const d = new Date();
  d.setDate(d.getDate() + days);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

/* ---------- 名字解析（统计用） ---------- */
// 名字以「合照」开头 = 多只猫的合影，不算一只猫
const isGroupName = (name) => /^合照/.test(String(name || '').trim());

// 从「波波(8)」里取出客户编号「8」；没有括号则返回空串
function idOf(name) {
  const m = String(name || '').trim().match(/[（(]\s*([^()（）]*?)\s*[)）]\s*$/);
  return m ? m[1].trim() : '';
}

let toastTimer;
function toast(msg) {
  const t = $('toast');
  t.textContent = msg;
  t.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.classList.remove('show'), 2200);
}

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
   IndexedDB 存储
   ========================================================= */
const DB_NAME = 'catsmap';
const STORE = 'photos';
let dbPromise = null;

function openDB() {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve, reject) => {
    if (!('indexedDB' in window)) return reject(new Error('no-idb'));
    let settled = false;
    const done = (fn, arg) => { if (!settled) { settled = true; fn(arg); } };
    // 超时兜底：某些环境（无痕模式/受限浏览器）IndexedDB 可能一直挂起
    const timer = setTimeout(() => done(reject, new Error('idb-timeout')), 4000);
    let req;
    try { req = indexedDB.open(DB_NAME, 1); } catch (e) { clearTimeout(timer); return done(reject, e); }
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE)) db.createObjectStore(STORE, { keyPath: 'id' });
    };
    req.onsuccess = () => { clearTimeout(timer); done(resolve, req.result); };
    req.onerror = () => { clearTimeout(timer); done(reject, req.error); };
    req.onblocked = () => { clearTimeout(timer); done(reject, new Error('blocked')); };
  });
  return dbPromise;
}

async function dbAll() {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, 'readonly');
    const r = tx.objectStore(STORE).getAll();
    r.onsuccess = () => resolve(r.result || []);
    r.onerror = () => reject(r.error);
  });
}
async function dbPut(rec) {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, 'readwrite');
    tx.objectStore(STORE).put(rec);
    tx.oncomplete = resolve;
    tx.onerror = () => reject(tx.error);
  });
}
async function dbDelete(id) {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, 'readwrite');
    tx.objectStore(STORE).delete(id);
    tx.oncomplete = resolve;
    tx.onerror = () => reject(tx.error);
  });
}
async function dbClear() {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, 'readwrite');
    tx.objectStore(STORE).clear();
    tx.oncomplete = resolve;
    tx.onerror = () => reject(tx.error);
  });
}

/* =========================================================
   图片解码 / 压缩
   ========================================================= */
async function decodeFile(file) {
  if ('createImageBitmap' in window) {
    try { return await createImageBitmap(file, { imageOrientation: 'from-image' }); } catch (e) { /* next */ }
    try { return await createImageBitmap(file); } catch (e) { /* next */ }
  }
  const url = URL.createObjectURL(file);
  try {
    return await new Promise((res, rej) => {
      const img = new Image();
      img.onload = () => res(img);
      img.onerror = rej;
      img.src = url;
    });
  } finally { setTimeout(() => URL.revokeObjectURL(url), 8000); }
}

function resizeToBlob(src, maxSide, quality) {
  const w0 = src.width || src.naturalWidth;
  const h0 = src.height || src.naturalHeight;
  const k = Math.min(1, maxSide / Math.max(w0, h0));
  const w = Math.max(1, Math.round(w0 * k));
  const h = Math.max(1, Math.round(h0 * k));
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  const cx = c.getContext('2d');
  cx.fillStyle = '#fff';
  cx.fillRect(0, 0, w, h);
  cx.drawImage(src, 0, 0, w, h);
  return new Promise((resolve) => {
    c.toBlob((b) => resolve({ blob: b, w, h }), 'image/jpeg', quality);
  });
}

/* =========================================================
   文件名解析：客户id-猫咪名称-地址（地址可省略）
   例：8-波波.png      -> 波波(8)
       8-all.JPG      -> 合照(8)
       8-波波-A栋302   -> 波波(8) + 地址 A栋302
   ========================================================= */
function parseFileName(fileName) {
  const base = String(fileName || '').replace(/\.[^.]+$/, '').trim();
  if (!base) return null;
  const parts = base.split('-').map((s) => s.trim());
  if (parts.length === 1) {
    // 只有纯数字文件名时，视为只给了客户 id
    return /^\d+$/.test(parts[0]) ? { name: `猫咪(${parts[0]})`, place: '' } : null;
  }
  const id = parts[0];
  if (!id) return null;
  const catRaw = parts[1] || '';
  const place = parts.slice(2).filter(Boolean).join('-');
  let name;
  if (/^all$/i.test(catRaw)) name = `合照(${id})`;     // all = 所有猫的合照
  else if (catRaw) name = `${catRaw}(${id})`;
  else name = `猫咪(${id})`;
  return { name, place };
}

async function fileToRecord(file) {
  const bitmap = await decodeFile(file);
  const main = await resizeToBlob(bitmap, MAX_SIZE, 0.88);
  const thumb = await resizeToBlob(bitmap, THUMB_SIZE, 0.78);
  const rec = {
    id: uid(),
    name: '',
    date: todayISO(),
    place: '',
    note: '',
    blob: main.blob,
    thumb: thumb.blob,
    w: main.w,
    h: main.h,
    createdAt: Date.now(),
    _bitmap: bitmap,
    _thumbUrl: URL.createObjectURL(thumb.blob)
  };
  const parsed = parseFileName(file.name);
  if (parsed) {
    rec.name = parsed.name;
    if (parsed.place) rec.place = parsed.place;
    rec._autoFilled = true;
  }
  return rec;
}

/* =========================================================
   上传
   ========================================================= */
async function addFiles(fileList) {
  const files = Array.from(fileList || []).filter((f) => f.type.startsWith('image/'));
  if (!files.length) return;
  leaveDemoForReal(); // 上传真实照片前先退出示例，避免混在一起
  toast(`正在处理 ${files.length} 张照片…`);
  let ok = 0;
  let auto = 0;
  for (const f of files) {
    try {
      const rec = await fileToRecord(f);
      if (rec._autoFilled) auto++;
      photos.unshift(rec);
      await saveRecord(rec);
      ok++;
      renderList();
      renderMosaic();
    } catch (e) {
      console.warn('照片处理失败', e);
    }
  }
  if (!ok) return toast('这些照片没能读取成功');
  toast(auto ? `已加入 ${ok} 张照片，其中 ${auto} 张按文件名自动填好了名字` : `已加入 ${ok} 张照片`);
  renderStats();
  renderMosaic(true);
}

async function saveRecord(rec) {
  if (rec.demo) return; // 示例照片不入库
  const { _bitmap, _thumbUrl, _autoFilled, ...clean } = rec;
  try { await dbPut(clean); }
  catch (e) { storageOK = false; }
}

/* =========================================================
   示例模式（仅内存，不写入本地库）
   ========================================================= */
const DEMO_PALETTES = [
  ['#FFD9A8', '#F2A65E'], ['#FFE3EC', '#F08CB5'], ['#D6EFFF', '#7FB8E6'],
  ['#E4F6D8', '#8CC77E'], ['#FFF3C4', '#E8C55A'], ['#EADCFF', '#A88BE0']
];

function makeDemoFace(i) {
  const s = 480;
  const c = document.createElement('canvas');
  c.width = c.height = s;
  const x = c.getContext('2d');
  const [bg1, bg2] = DEMO_PALETTES[i % DEMO_PALETTES.length];
  const g = x.createLinearGradient(0, 0, s, s);
  g.addColorStop(0, bg1); g.addColorStop(1, bg2);
  x.fillStyle = g; x.fillRect(0, 0, s, s);

  const cx = s / 2, cy = s * 0.56, r = s * 0.30;
  const fur = ['#FFF6EA', '#FBEEDD', '#F6E3CE', '#FFF1E0'][i % 4];

  x.fillStyle = fur;
  x.beginPath(); x.moveTo(cx - r * 0.95, cy - r * 0.5); x.lineTo(cx - r * 0.62, cy - r * 1.42); x.lineTo(cx - r * 0.12, cy - r * 0.78); x.closePath(); x.fill();
  x.beginPath(); x.moveTo(cx + r * 0.95, cy - r * 0.5); x.lineTo(cx + r * 0.62, cy - r * 1.42); x.lineTo(cx + r * 0.12, cy - r * 0.78); x.closePath(); x.fill();
  x.beginPath(); x.ellipse(cx, cy, r, r * 0.92, 0, 0, Math.PI * 2); x.fill();

  x.fillStyle = '#3A332C';
  x.beginPath(); x.ellipse(cx - r * 0.42, cy - r * 0.08, r * 0.10, r * 0.17, 0, 0, Math.PI * 2); x.fill();
  x.beginPath(); x.ellipse(cx + r * 0.42, cy - r * 0.08, r * 0.10, r * 0.17, 0, 0, Math.PI * 2); x.fill();

  x.fillStyle = '#E8836F';
  x.beginPath(); x.moveTo(cx, cy + r * 0.14); x.lineTo(cx - r * 0.09, cy + r * 0.02); x.lineTo(cx + r * 0.09, cy + r * 0.02); x.closePath(); x.fill();

  x.strokeStyle = '#3A332C'; x.lineWidth = s * 0.008; x.lineCap = 'round';
  x.beginPath(); x.moveTo(cx, cy + r * 0.14); x.lineTo(cx, cy + r * 0.26); x.stroke();
  x.beginPath(); x.arc(cx - r * 0.13, cy + r * 0.28, r * 0.13, 0, Math.PI); x.stroke();
  x.beginPath(); x.arc(cx + r * 0.13, cy + r * 0.28, r * 0.13, 0, Math.PI); x.stroke();

  x.lineWidth = s * 0.006; x.strokeStyle = 'rgba(58,51,44,.5)';
  [[-1, -0.1], [-1, 0.02], [-1, 0.14], [1, -0.1], [1, 0.02], [1, 0.14]].forEach(([side, dy], k) => {
    x.beginPath();
    x.moveTo(cx + side * r * 0.85, cy + r * (0.05 + dy));
    x.lineTo(cx + side * r * (1.5 + (k % 3) * 0.08), cy + r * (0.0 + dy * 2.2));
    x.stroke();
  });
  return c;
}

// 示例照片：14 张，跨 3 位客户，含 3 张「合照」，正好把统计和合照标签都演示出来
const DEMO_CAST = [
  ['橘橘(1)', '2026-09-21', '示例·A小区 3号楼 302'],
  ['奶牛(1)', '2026-09-21', '示例·A小区 3号楼 302'],
  ['合照(1)', '2026-09-21', '示例·A小区 3号楼 302'],
  ['汤圆(2)', '2026-09-20', '示例·B小区 7号楼 1101'],
  ['布丁(2)', '2026-09-20', '示例·B小区 7号楼 1101'],
  ['年糕(2)', '2026-09-20', '示例·B小区 7号楼 1101'],
  ['合照(2)', '2026-09-20', '示例·B小区 7号楼 1101'],
  ['麻薯(3)', '2026-09-18', '示例·C小区 2号楼 601'],
  ['雪球(3)', '2026-09-18', '示例·C小区 2号楼 601'],
  ['三花(3)', '2026-09-18', '示例·C小区 2号楼 601'],
  ['大白(3)', '2026-09-18', '示例·C小区 2号楼 601'],
  ['狸花(3)', '2026-09-18', '示例·C小区 2号楼 601'],
  ['银渐层(3)', '2026-09-18', '示例·C小区 2号楼 601'],
  ['合照(3)', '2026-09-18', '示例·C小区 2号楼 601']
];

function buildDemoPhotos() {
  const today = todayISO();
  return DEMO_CAST.map(([name, date, place], i) => {
    const c = makeDemoFace(i);
    // 日期若比今天还晚（示例数据写死会过期），就改成今天往前推 i%4 天
    const d = date <= today ? date : dateOffset(-(i % 4));
    return {
      id: 'demo-' + i, demo: true,
      name, date: d, place,
      note: isGroupName(name) ? '示例：几只猫凑在一起拍的' : '示例记录，可以直接改着看效果',
      w: c.width, h: c.height, createdAt: Date.now() - i,
      _bitmap: c, _thumbUrl: c.toDataURL('image/jpeg', 0.72)
    };
  });
}

// 进入示例模式：把真实照片在内存里拍个快照，退出时原样恢复
function enterDemo(count) {
  if (demoActive) return;                    // 已经在示例里
  demoSnapshot = photos.slice();             // 真实照片快照（不落库、不动库）
  photos = buildDemoPhotos();
  const n = Math.max(1, Math.min(DEMO_CAST.length, Number(count) || DEMO_CAST.length));
  if (n !== photos.length) photos = photos.slice(0, n);
  seed = Math.floor(Math.random() * 1e6);
  demoActive = true;
  document.body.classList.add('demo-mode');
  const had = demoSnapshot.length;
  renderList();
  renderMosaic(true);
  toast(had ? `已进入示例模式（不会保存），退出后你原来的 ${had} 张照片原样回来` : '已进入示例模式：这些都是画出来的示例，不会保存');
}

function exitDemo() {
  if (!demoActive) return;
  photos = demoSnapshot || [];
  demoSnapshot = null;
  demoActive = false;
  document.body.classList.remove('demo-mode');
  renderList();
  renderMosaic(true);
  toast(photos.length ? `已退出示例，${photos.length} 张照片都还在` : '已退出示例');
}

// 要放真实数据进来（上传 / 导入）时，静默退出示例，避免和示例混在一起
function leaveDemoForReal() {
  if (!demoActive) return;
  photos = demoSnapshot || [];
  demoSnapshot = null;
  demoActive = false;
  document.body.classList.remove('demo-mode');
}

/* =========================================================
   列表渲染
   ========================================================= */
function catNameOf(p) { return (p.name || '').trim() || '未命名猫咪'; }

function renderList() {
  const box = $('photoList');
  box.innerHTML = '';
  $('listEmpty').style.display = photos.length ? 'none' : 'block';
  $('listCount').textContent = photos.length;

  photos.forEach((p) => {
    const el = document.createElement('article');
    el.className = 'card';
    el.dataset.id = p.id;
    el.innerHTML = `
      <div class="thumb"><img alt="${catNameOf(p)}" src="${p._thumbUrl}">${isGroupName(p.name) ? '<span class="badge-group">合照</span>' : ''}</div>
      <div class="meta">
        <input class="f-name" data-k="name" placeholder="猫咪名字" value="${escapeAttr(p.name)}">
        <div class="row">
          <input type="date" class="f-date" data-k="date" value="${escapeAttr(p.date)}">
          <input class="f-place" data-k="place" placeholder="地址 / 楼栋" value="${escapeAttr(p.place)}">
        </div>
        <input class="f-note" data-k="note" placeholder="备注：吃了几口、便便、精神状态…" value="${escapeAttr(p.note)}">
      </div>
      <button class="del" title="删除这张">&times;</button>`;
    box.appendChild(el);
  });
  renderStats();
}

function escapeAttr(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;').replace(/"/g, '&quot;')
    .replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

/* 统计口径：
   · 照片   = 总张数
   · 猫咪   = 去重后的猫咪名（「合照(8)」这种合影不算猫）；
              完全没填名字的照片整体算作 1 只「未命名猫」
   · 客户   = 名字末尾编号去重（8 → 一位客户）；没有编号的照片单独计：
              每张未命名照片算一位，有名字但没编号的合起来算一位
   改了名字或编号后，这里会跟着重新统计。 */
function renderStats() {
  $('statPhotos').textContent = photos.length;

  const catKeys = new Set();   // 猫咪去重键（用完整名字，避免不同客户的同名猫混在一起）
  const clientIds = new Set(); // 有编号的客户
  let unnamed = 0;             // 完全没填名字的照片
  let namedNoId = 0;           // 有名字但没有编号的照片

  photos.forEach((p) => {
    const name = (p.name || '').trim();
    if (!name) { unnamed++; return; }
    const id = idOf(name);
    if (id) clientIds.add(id); else namedNoId++;
    if (!isGroupName(name)) catKeys.add(name);
  });

  $('statCats').textContent = catKeys.size + (unnamed ? 1 : 0);
  $('statClients').textContent = clientIds.size + unnamed + (namedNoId ? 1 : 0);

  const dates = photos.map((p) => p.date).filter(Boolean).sort();
  $('statLast').textContent = dates.length ? dates[dates.length - 1].slice(5).replace('-', '/') : '—';
}

/* 编辑（防抖保存） */
let saveTimers = {};
$('photoList').addEventListener('input', (e) => {
  const input = e.target.closest('input[data-k]');
  if (!input) return;
  const card = input.closest('.card');
  const rec = photos.find((p) => p.id === card.dataset.id);
  if (!rec) return;
  rec[input.dataset.k] = input.value;
  if (input.dataset.k === 'name') {
    const img = card.querySelector('.thumb img');
    if (img) img.alt = catNameOf(rec);
  }
  clearTimeout(saveTimers[rec.id]);
  saveTimers[rec.id] = setTimeout(() => { saveRecord(rec); renderStats(); }, 420);
});

$('photoList').addEventListener('click', async (e) => {
  const card = e.target.closest('.card');
  if (!card) return;
  const rec = photos.find((p) => p.id === card.dataset.id);
  if (!rec) return;

  if (e.target.closest('.del')) {
    if (!confirm(`删除「${catNameOf(rec)}」这张照片？`)) return;
    photos = photos.filter((p) => p.id !== rec.id);
    try { await dbDelete(rec.id); } catch (err) { /* ignore */ }
    renderList(); renderMosaic(true);
    toast('已删除');
    return;
  }
  if (e.target.closest('.thumb')) {
    const lb = $('lightbox');
    $('lightboxImg').src = rec._thumbUrl;
    lb.classList.add('show');
  }
});

$('lightbox').addEventListener('click', () => $('lightbox').classList.remove('show'));

/* =========================================================
   大猫头拼贴渲染
   ========================================================= */
function drawCover(cx, img, x, y, w, h) {
  const iw = img.width || img.naturalWidth;
  const ih = img.height || img.naturalHeight;
  if (!iw || !ih) return;
  const k = Math.max(w / iw, h / ih);
  const dw = iw * k, dh = ih * k;
  cx.drawImage(img, x + (w - dw) / 2, y + (h - dh) / 2, dw, dh);
}

/* ---------- 版面计算 ---------- */

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
    const ar = (VW / c) / (VH / r);        // 格子宽高比
    const cand = { cols: c, rows: r, waste, ar, score: Math.abs(Math.log(ar)) };
    if (!fallback || cand.score < fallback.score) fallback = cand;
    if (ar >= 0.5 && ar <= 2) {            // 排除细长条
      if (!best || cand.waste < best.waste ||
          (cand.waste === best.waste && cand.score < best.score)) best = cand;
    }
  }
  return best || fallback;
}

function renderMosaic(report) {
  const gap = Number($('gap').value);
  const showWhiskers = $('whiskers').checked;
  const loaded = photos.filter((p) => p._bitmap);
  const n = loaded.length;

  // ---- 计算版面 ----
  let rects = [];
  let note = '';
  let tagText = '';
  const cols = Number($('density').value);
  const gridRows = Math.ceil(VH / (VW / cols));
  $('densityVal').textContent = `${cols} × ${gridRows}`;
  $('gapVal').textContent = gap;

  if (!n) {
    note = '上传照片后，会按张数自动均分猫头';
    tagText = '等待照片';
  } else if (layoutMode === 'grid') {
    rects = gridRects(cols, gridRows);
    const repeat = Math.max(1, Math.round(rects.length / n));
    note = `几 × 几 铺满：${cols} × ${gridRows} = ${rects.length} 格，${n} 张照片循环填充（每张约出现 ${repeat} 次）`;
    tagText = `${n} 张照片 · ${cols} × ${gridRows}`;
  } else if (n === 1) {
    rects = sliceRects(1);
    note = '只有 1 张照片：整张放进猫头里，完全不重复';
    tagText = '1 张照片 · 整头 1 块';
  } else if (n <= 8) {
    rects = sliceRects(n);
    note = `${n} 张照片：平均切成 ${n} 块，每张只出现一次、面积一样大`;
    tagText = `${n} 张照片 · 均分 ${n} 块`;
  } else {
    const g = autoGrid(n);
    rects = gridRects(g.cols, g.rows);
    note = `${n} 张照片：按 ${g.cols} × ${g.rows} 均分铺满，每张照片都露面`;
    tagText = `${n} 张照片 · ${g.cols} × ${g.rows}`;
  }
  $('layoutNote').textContent = note;
  $('mosaicTag').textContent = tagText;

  // ---- 绘制 ----
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

  if (n) {
    // 2) 拼贴（裁剪在猫头内）
    ctx.save();
    ctx.clip(catPath2D);
    const order = shuffleWithSeed(loaded, seed);
    rects.forEach((rc, i) => {
      const img = order[i % order.length]._bitmap;
      const x = rc.x + gap / 2;
      const y = rc.y + gap / 2;
      const w = Math.max(1, rc.w - gap);
      const h = Math.max(1, rc.h - gap);

      if (layoutMode === 'auto' && n === 1) {
        // 单张：完整放入（不裁切），留白处补底色
        const iw = img.width || img.naturalWidth;
        const ih = img.height || img.naturalHeight;
        ctx.fillStyle = '#FBF1E4';
        ctx.fillRect(x, y, w, h);
        const k = Math.min(w / iw, h / ih);
        ctx.drawImage(img, x + (w - iw * k) / 2, y + (h - ih * k) / 2, iw * k, ih * k);
      } else {
        drawCover(ctx, img, x, y, w, h);
      }
    });
    // 轻微高光，让层次更柔和
    const g = ctx.createLinearGradient(0, 0, 0, VH);
    g.addColorStop(0, 'rgba(255,255,255,.16)');
    g.addColorStop(0.55, 'rgba(255,255,255,0)');
    g.addColorStop(1, 'rgba(90,60,30,.10)');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, VW, VH);
    ctx.restore();
  } else {
    // 空状态：虚线轮廓 + 提示
    ctx.save();
    ctx.setLineDash([20, 16]);
    ctx.lineWidth = 4;
    ctx.strokeStyle = '#EBD6BE';
    ctx.stroke(catPath2D);
    ctx.restore();

    ctx.fillStyle = '#C4B2A1';
    ctx.textAlign = 'center';
    ctx.font = '600 40px system-ui,-apple-system,"PingFang SC",sans-serif';
    ctx.fillText('还没有照片', 500, 540);
    ctx.font = '400 26px system-ui,-apple-system,"PingFang SC",sans-serif';
    ctx.fillText('上传喂猫时拍的猫咪头像', 500, 590);
    ctx.fillText('它们会拼成这个猫头', 500, 628);
  }

  // 3) 轮廓
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
   下载
   ========================================================= */
function download() {
  if (!photos.length) return toast('先上传几张猫咪照片吧');
  canvas.toBlob((blob) => {
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `猫咪头像墙-${todayISO()}.png`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 4000);
    toast('拼图已保存到下载文件夹');
  }, 'image/png');
}

/* =========================================================
   导出备份 / 导入恢复
   ========================================================= */
const blobToDataURL = (b) => new Promise((resolve, reject) => {
  const r = new FileReader();
  r.onload = () => resolve(r.result);
  r.onerror = () => reject(r.error);
  r.readAsDataURL(b);
});
const dataURLToBlob = async (u) => await (await fetch(u)).blob();

async function exportBackup() {
  let rows = [];
  try { rows = await dbAll(); } catch (e) { /* 存储不可用时退回内存里的照片 */ }
  if (!rows.length) {
    const src = demoActive ? (demoSnapshot || []) : photos;   // 示例模式下导出的是真实照片
    rows = src.filter((p) => !p.demo).map(({ _bitmap, _thumbUrl, ...r }) => r);
  }
  if (!rows.length) return toast('还没有照片可以备份');

  toast(`正在打包 ${rows.length} 张照片…`);
  const list = [];
  for (const r of rows) {
    try {
      list.push({
        id: r.id, name: r.name || '', date: r.date || '', place: r.place || '', note: r.note || '',
        w: r.w || 0, h: r.h || 0, createdAt: r.createdAt || 0,
        img: await blobToDataURL(r.blob),
        thumb: r.thumb ? await blobToDataURL(r.thumb) : ''
      });
    } catch (e) { console.warn('有一张照片读取失败，已跳过', e); }
  }
  const payload = { app: 'catsmap', version: 1, exportedAt: new Date().toISOString(), count: list.length, photos: list };
  const blob = new Blob([JSON.stringify(payload)], { type: 'application/json' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `猫咪头像墙备份-${todayISO()}.json`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 8000);
  toast(`备份已保存到下载文件夹（${list.length} 张照片）`);
}

async function importBackup(file) {
  if (!file) return;
  let data;
  try { data = JSON.parse(await file.text()); }
  catch (e) { return toast('这个文件不是有效的备份（无法解析）'); }
  if (!data || data.app !== 'catsmap' || !Array.isArray(data.photos)) {
    return toast('这个文件不是「猫咪头像墙」的备份');
  }
  const items = data.photos;
  if (!items.length) return toast('备份里没有照片');
  if (!confirm(`导入 ${items.length} 张照片？将与现有记录按编号合并，同编号的会覆盖。`)) return;

  if (demoActive) { leaveDemoForReal(); renderList(); renderMosaic(true); }
  toast(`正在导入 ${items.length} 张照片…`);
  let ok = 0;
  for (const it of items) {
    try {
      if (!it.img) continue;
      const blob = await dataURLToBlob(it.img);
      const thumb = it.thumb ? await dataURLToBlob(it.thumb) : blob;
      const rec = {
        id: it.id || uid(), name: it.name || '', date: it.date || todayISO(),
        place: it.place || '', note: it.note || '',
        blob, thumb, w: it.w || 0, h: it.h || 0, createdAt: it.createdAt || Date.now()
      };
      rec._bitmap = await decodeFile(rec.blob);
      rec._thumbUrl = URL.createObjectURL(thumb);
      photos = photos.filter((p) => p.id !== rec.id);
      photos.unshift(rec);
      await saveRecord(rec);
      ok++;
    } catch (e) { console.warn('有一张导入失败', e); }
  }
  renderList();
  renderMosaic(true);
  renderStats();
  toast(ok ? `已恢复 ${ok} 张照片` : '导入失败，请检查备份文件');
}

/* =========================================================
   事件绑定
   ========================================================= */
$('pickBtn').addEventListener('click', () => $('fileInput').click());
$('cameraBtn').addEventListener('click', () => $('cameraInput').click());
$('demoBtn').addEventListener('click', () => enterDemo(14));
$('demoExit').addEventListener('click', exitDemo);
$('exportBtn').addEventListener('click', exportBackup);
$('importBtn').addEventListener('click', () => $('importInput').click());
$('importInput').addEventListener('change', (e) => {
  const f = e.target.files[0];
  e.target.value = '';
  importBackup(f);
});
$('fileInput').addEventListener('change', (e) => { addFiles(e.target.files); e.target.value = ''; });
$('cameraInput').addEventListener('change', (e) => { addFiles(e.target.files); e.target.value = ''; });

const dz = $('dropzone');
['dragenter', 'dragover'].forEach((ev) =>
  dz.addEventListener(ev, (e) => { e.preventDefault(); dz.classList.add('over'); }));
['dragleave', 'drop'].forEach((ev) =>
  dz.addEventListener(ev, (e) => { e.preventDefault(); dz.classList.remove('over'); }));
dz.addEventListener('drop', (e) => {
  const f = e.dataTransfer && e.dataTransfer.files;
  if (f && f.length) addFiles(f);
});
dz.addEventListener('click', (e) => { if (!e.target.closest('button')) $('fileInput').click(); });

['density', 'gap'].forEach((id) => $(id).addEventListener('input', () => renderMosaic(true)));
$('whiskers').addEventListener('change', () => renderMosaic());
$('shuffle').addEventListener('click', () => { seed = Math.floor(Math.random() * 1e6); renderMosaic(true); });
$('download').addEventListener('click', download);

$('modeSeg').addEventListener('click', (e) => {
  const btn = e.target.closest('button[data-mode]');
  if (!btn) return;
  layoutMode = btn.dataset.mode;
  Array.from($('modeSeg').children).forEach((b) => b.classList.toggle('on', b === btn));
  syncMode();
  renderMosaic(true);
});

function syncMode() {
  $('densityCtl').style.display = layoutMode === 'grid' ? '' : 'none';
}

$('clearAll').addEventListener('click', async () => {
  if (demoActive) return toast('示例模式下不能清空，请先点「退出示例」');
  if (!photos.length) return;
  if (!confirm('确定清空全部照片记录？此操作不可撤销。')) return;
  photos.forEach((p) => { try { URL.revokeObjectURL(p._thumbUrl); } catch (e) {} });
  photos = [];
  try { await dbClear(); } catch (e) { /* ignore */ }
  renderList(); renderMosaic(true);
  toast('已清空');
});

/* =========================================================
   启动
   ========================================================= */
(async function init() {
  // 先渲染首帧（空状态），再异步加载数据，避免阻塞
  renderList();
  renderMosaic(true);
  syncMode();

  if (new URLSearchParams(location.search).has('demo')) {
    enterDemo(parseInt(new URLSearchParams(location.search).get('demo'), 10));
    return;
  }

  try {
    const rows = await dbAll();
    rows.sort((a, b) => (b.date || '').localeCompare(a.date || '') || b.createdAt - a.createdAt);
    const loaded = [];
    for (const r of rows) {
      try {
        r._bitmap = await decodeFile(r.blob);
        r._thumbUrl = URL.createObjectURL(r.thumb || r.blob);
      } catch (e) { continue; }
      loaded.push(r);
    }
    if (demoActive) { demoSnapshot = loaded; return; }  // 加载期间用户进了示例，先存快照，退出时再显示
    photos = loaded;
  } catch (e) {
    storageOK = false;
    console.warn('本地存储不可用，照片只保存在当前页面', e);
  }

  renderList();
  renderMosaic(true);

  if (!storageOK) {
    $('tip').textContent = '⚠️ 当前环境无法使用本地数据库（照片仅在本次页面有效）。用本地 http 服务打开即可长期保存。';
  }
})();
