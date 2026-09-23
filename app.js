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

// pid：订单/家庭编号（一户多只猫共用）。与名字括号里的 id 双向同步：
// 上传时从文件名自动填；改名字括号 → pid 跟着变；组头改 pid → 名字括号跟着变。
// 旧记录没有 pid 字段时，回落到从名字括号提取（兼容历史数据，无需迁移）。
const pidOf = (p) => {
  const v = String(p.pid ?? '').trim();
  return v || idOf(p.name);
};

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
   裁剪（非破坏式）
   原图始终保留，只在记录里多存一组裁剪参数：
     crop = { rot:0|90|180|270, x,y,w,h }   x/y/w/h 是「旋转后的图」上的归一化比例
   没有 crop 字段 = 用原图整张（老数据天然兼容）
   ========================================================= */
const FULL_CROP = { rot: 0, x: 0, y: 0, w: 1, h: 1 };

// 兼容 ImageBitmap / canvas / HTMLImage 三种来源
const pxW = (img) => img.width || img.naturalWidth || 0;
const pxH = (img) => img.height || img.naturalHeight || 0;

function cropOf(rec) { return rec.crop || FULL_CROP; }

function isCropped(rec) {
  const c = rec.crop;
  if (!c) return false;
  if (c.rot) return true;
  return c.x > 0.002 || c.y > 0.002 || c.w < 0.998 || c.h < 0.998;
}

// 把原图旋转后的画布（缓存，最长边不超过存库尺寸，避免大图占内存）
function rotatedCanvas(rec, rot) {
  const bmp = rec._bitmap;
  const bw = pxW(bmp), bh = pxH(bmp);
  const swap = rot % 180 !== 0;
  const rw = swap ? bh : bw;
  const rh = swap ? bw : bh;
  const k = Math.min(1, MAX_SIZE / Math.max(rw, rh));
  const c = document.createElement('canvas');
  c.width = Math.max(1, Math.round(rw * k));
  c.height = Math.max(1, Math.round(rh * k));
  const x = c.getContext('2d');
  x.fillStyle = '#fff';
  x.fillRect(0, 0, c.width, c.height);
  x.translate(c.width / 2, c.height / 2);
  x.rotate(rot * Math.PI / 180);
  x.scale(k, k);
  x.drawImage(bmp, -bw / 2, -bh / 2);
  return c;
}

// 拼贴时真正取用的图：有旋转就返回旋转后的缓存，否则原图
function sourceOf(rec) { return rec._rotSrc || rec._bitmap; }

// 裁剪参数变了以后重建旋转缓存（rot = 0 时直接清掉）
function prepareSrc(rec) {
  const rot = (rec.crop && rec.crop.rot) || 0;
  rec._rotSrc = (rot && rec._bitmap) ? rotatedCanvas(rec, rot) : null;
}

// 按当前裁剪参数，把「保留区域」等比放进 w×h（cover：铺满并居中裁切多余部分）
function drawCover(cx, rec, x, y, w, h) {
  const img = sourceOf(rec);
  if (!img) return;
  const iw = pxW(img), ih = pxH(img);
  if (!iw || !ih) return;
  const c = cropOf(rec);
  const sw = Math.max(1, iw * c.w), sh = Math.max(1, ih * c.h);
  const sx = iw * c.x, sy = ih * c.y;
  const k = Math.max(w / sw, h / sh);
  const dw = sw * k, dh = sh * k;
  cx.drawImage(img, sx, sy, sw, sh, x + (w - dw) / 2, y + (h - dh) / 2, dw, dh);
}

// 同样按裁剪参数，但「完整放入」不裁切，留白补底色（单张照片时用）
function drawContain(cx, rec, x, y, w, h, bg) {
  const img = sourceOf(rec);
  if (!img) return;
  const iw = pxW(img), ih = pxH(img);
  if (!iw || !ih) return;
  const c = cropOf(rec);
  const sw = Math.max(1, iw * c.w), sh = Math.max(1, ih * c.h);
  const sx = iw * c.x, sy = ih * c.y;
  const k = Math.min(w / sw, h / sh);
  const dw = sw * k, dh = sh * k;
  cx.fillStyle = bg;
  cx.fillRect(x, y, w, h);
  cx.drawImage(img, sx, sy, sw, sh, x + (w - dw) / 2, y + (h - dh) / 2, dw, dh);
}

// 按裁剪结果重做缩略图（保持裁剪后的比例，最长边 THUMB_SIZE）
function croppedThumb(rec) {
  const img = sourceOf(rec);
  if (!img) return Promise.resolve(null);
  const iw = pxW(img), ih = pxH(img);
  const c = cropOf(rec);
  const sw = Math.max(1, iw * c.w), sh = Math.max(1, ih * c.h);
  const sx = iw * c.x, sy = ih * c.y;
  const k = Math.min(1, THUMB_SIZE / Math.max(sw, sh));
  const dw = Math.max(1, Math.round(sw * k)), dh = Math.max(1, Math.round(sh * k));
  const cv = document.createElement('canvas');
  cv.width = dw; cv.height = dh;
  const x = cv.getContext('2d');
  x.fillStyle = '#fff';
  x.fillRect(0, 0, dw, dh);
  x.drawImage(img, sx, sy, sw, sh, 0, 0, dw, dh);
  return new Promise((resolve) => cv.toBlob((b) => resolve(b), 'image/jpeg', 0.78));
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
    pid: '',
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
    rec.pid = idOf(parsed.name);          // 客户 id 同时存进 pid，供分组用
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
  const added = [];
  for (const f of files) {
    try {
      const rec = await fileToRecord(f);
      if (rec._autoFilled) auto++;
      photos.unshift(rec);
      await saveRecord(rec);
      added.push(rec);
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
  openCropQueue(added);   // 上传后紧接着逐张裁剪（可一键全部保持原样）
}

async function saveRecord(rec) {
  if (rec.demo) return; // 示例照片不入库
  const { _bitmap, _rotSrc, _thumbUrl, _autoFilled, ...clean } = rec;
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

/* 分组：pid 相同的照片归为一户（订单/家庭）。
   · 没有编号的照片各自独立一组（组头可补填编号归组），排在最后
   · 组内合照排最后，其余保持现有顺序（新照片在前）
   · 组间按编号排（数字优先），没编号的按创建时间新在前 */
function groupPhotos() {
  const map = new Map();
  for (const p of photos) {
    const pid = pidOf(p);
    const key = pid ? 'pid:' + pid : 'anon:' + p.id;
    if (!map.has(key)) map.set(key, { pid, members: [] });
    map.get(key).members.push(p);
  }
  const list = [...map.values()];
  for (const g of list) {
    g.members.sort((a, b) => (isGroupName(a.name) ? 1 : 0) - (isGroupName(b.name) ? 1 : 0)); // 稳定排序，合照挪到最后
  }
  list.sort((a, b) => {
    if (a.pid && b.pid) return a.pid.localeCompare(b.pid, undefined, { numeric: true });
    if (a.pid !== b.pid) return a.pid ? -1 : 1;
    return (b.members[0].createdAt || 0) - (a.members[0].createdAt || 0);
  });
  return list;
}

function renderList() {
  const box = $('photoList');
  box.innerHTML = '';
  $('listEmpty').style.display = photos.length ? 'none' : 'block';
  $('listCount').textContent = photos.length;

  for (const g of groupPhotos()) {
    const sec = document.createElement('section');
    sec.className = 'group-card';
    // 组头取组内第一个非空的值（有的照片文件名里没带地址，不该让组头空着）
    const dateVal = (g.members.find((m) => m.date) || g.members[0]).date;
    const placeVal = (g.members.find((m) => (m.place || '').trim()) || g.members[0]).place;
    const head = document.createElement('div');
    head.className = 'group-head';
    head.innerHTML = `
      <span class="pid-label">订单</span>
      <input class="f-pid" data-gk="pid" placeholder="补编号" title="订单/家庭编号，一户共用；改了会同步到组内名字" value="${escapeAttr(g.pid)}">
      <input type="date" data-gk="date" title="探访日期（整组共用）" value="${escapeAttr(dateVal)}">
      <input data-gk="place" placeholder="地址 / 楼栋（整组共用）" title="地址（整组共用）" value="${escapeAttr(placeVal)}">`;
    sec.appendChild(head);

    const body = document.createElement('div');
    body.className = 'group-body';
    for (const p of g.members) {
      const el = document.createElement('article');
      el.className = 'card';
      el.dataset.id = p.id;
      el.innerHTML = `
        <div class="thumb"><img alt="${catNameOf(p)}" src="${p._thumbUrl}">${isGroupName(p.name) ? '<span class="badge-group">合照</span>' : ''}</div>
        <div class="meta">
          <input class="f-name" data-k="name" placeholder="猫咪名字" value="${escapeAttr(p.name)}">
          <input class="f-note" data-k="note" placeholder="备注：吃了几口、便便、精神状态…" value="${escapeAttr(p.note)}">
          <div class="card-foot">
            <button class="mini-btn" data-act="crop" title="裁剪这张照片（原图会保留）">裁剪</button>
            ${isCropped(p) ? '<span class="mini-flag">已裁剪</span>' : ''}
          </div>
        </div>
        <button class="del" title="删除这张">&times;</button>`;
      body.appendChild(el);
    }
    sec.appendChild(body);
    box.appendChild(sec);
  }
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

/* 编辑（防抖保存）
   · 照片行：名字（括号 id 联动 pid）、备注
   · 组头：pid / 日期 / 地址（change 时整组生效，改 pid 会重新归组） */
let saveTimers = {};
$('photoList').addEventListener('input', (e) => {
  const input = e.target.closest('input[data-k]');
  if (!input) return;                          // 组头字段走 change
  const card = input.closest('.card');
  const rec = photos.find((p) => p.id === card.dataset.id);
  if (!rec) return;
  rec[input.dataset.k] = input.value;
  if (input.dataset.k === 'name') {
    const img = card.querySelector('.thumb img');
    if (img) img.alt = catNameOf(rec);
    const id = idOf(rec.name);
    if (id) rec.pid = id;                      // 双向同步：名字括号 → pid
  }
  clearTimeout(saveTimers[rec.id]);
  saveTimers[rec.id] = setTimeout(() => { saveRecord(rec); renderStats(); }, 420);
});

$('photoList').addEventListener('change', (e) => {
  const input = e.target.closest('input');
  if (!input) return;

  // 名字失焦后重新归组（编号可能变了）
  if (input.dataset.k === 'name') { renderList(); return; }

  const gInput = input.closest('[data-gk]');
  if (!gInput) return;
  const sec = gInput.closest('.group-card');
  const members = [...sec.querySelectorAll('.card')]
    .map((c) => photos.find((p) => p.id === c.dataset.id))
    .filter(Boolean);
  if (!members.length) return;
  const k = gInput.dataset.gk;

  if (k === 'pid') {
    const v = gInput.value.trim();
    for (const rec of members) {
      rec.pid = v;
      const name = (rec.name || '').trim();
      if (name && v) {
        // 双向同步：pid → 名字括号（有括号就替换，没括号就补上）
        rec.name = idOf(name)
          ? name.replace(/[（(]\s*[^()（）]*?[)）]\s*$/, `(${v})`)
          : `${name}(${v})`;
      }
    }
    renderList();                              // 重新归组排序
  } else {
    for (const rec of members) rec[k] = gInput.value;   // 日期/地址整组共用
  }
  for (const rec of members) saveRecord(rec);
});

$('photoList').addEventListener('click', async (e) => {
  const card = e.target.closest('.card');
  if (!card) return;
  const rec = photos.find((p) => p.id === card.dataset.id);
  if (!rec) return;

  if (e.target.closest('[data-act="crop"]')) {
    cropQueue = [];
    cropIdx = 0;
    openCropModal(rec, false);   // false = 从卡片进来，只有这一张
    return;
  }
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

/* ---------- 主体格优先填充 ----------
   铺满模式的格子本来是从画布左上角按行生成、按行填充，
   而猫头在画布中间：这样每张照片的第 1 份都会落在头顶/耳朵的边缘格里。
   这里用轮廓路径 isPointInPath 对每格 9×9 采样算覆盖率（按列数缓存，
   切换列数时重算一次），填充顺序改为：完整格（覆盖率 ≥95%）在前、
   按从上到下阅读顺序，边缘格在后用重复照片补满。 */
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

/* ---------- 完整格（主体格）与建议值 ----------
   「几 × 几 铺满」的格子先铺满整个矩形画布、再被猫头轮廓裁形，
   被裁到只剩一部分的只能算「边缘格」。
   下表为实测值：每档列数下被猫头完整覆盖（覆盖率 ≥95%）的格子数，
   用轮廓路径 isPointInPath 逐格 9×9 采样测得，与屏幕人工清点一致
   （如 8×8=20：第 3~6 列 × 第 3~7 行；10×9=34，与用户截图清点相同）。 */
const MAIN_CELLS = [9, 10, 13, 20, 28, 34, 41, 48, 61, 72, 89, 98, 114, 128, 146, 156, 169, 188]; // 5~22 列

const mainCellsOf = (cols) =>
  MAIN_CELLS[Math.max(0, Math.min(MAIN_CELLS.length - 1, Math.round(cols) - 5))] || 0;

const gridRowsOf = (cols) => Math.ceil(VH / (VW / cols));

// 建议列数 = 「完整格数 ≥ 照片数」的最小列数（格子能多大就多大）；
// 照片多于 188 张（22×21 的完整格上限）时只能返回上限 22
function suggestCols(n) {
  for (let c = 5; c <= 22; c++) if (MAIN_CELLS[c - 5] >= n) return c;
  return 22;
}

// 滑块旁的建议提示：只提示不强制，点按钮才应用
function renderSuggest(n, cols) {
  const el = $('suggestHint');
  const btn = $('suggestApply');
  if (layoutMode !== 'grid' || !n) { el.hidden = true; return; }
  const curMain = mainCellsOf(cols);
  const sug = suggestCols(n);
  if (sug === cols) { el.hidden = true; return; }   // 当前档位已是最优
  const sugRows = gridRowsOf(sug);
  const sugMain = mainCellsOf(sug);
  el.hidden = false;
  if (curMain < n) {
    // 完整格不够：要么给建议，要么已到上限
    if (sugMain < n) {
      btn.hidden = true;
      $('suggestTxt').textContent =
        `当前 ${cols} × ${gridRowsOf(cols)} 只有 ${curMain} 个完整格，放不下 ${n} 张；已到上限 22 × 21（${sugMain} 个完整格），多出的只能进边缘`;
    } else {
      btn.hidden = false;
      $('suggestTxt').textContent =
        `当前 ${cols} × ${gridRowsOf(cols)} 只有 ${curMain} 个完整格，放不下 ${n} 张`;
      btn.textContent = `用建议值 ${sug} × ${sugRows}（${sugMain} 个完整格）`;
    }
  } else {
    // 完整格够但列数偏多：用更少的列格子更大
    btn.hidden = false;
    $('suggestTxt').textContent = `${n} 张照片用更少的列就能全部完整展示，每格更大`;
    btn.textContent = `用建议值 ${sug} × ${sugRows}（${sugMain} 个完整格）`;
  }
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
    rects = mainFirstRects(cols, gridRows);
    const repeat = Math.max(1, Math.round(rects.length / n));
    const main = mainCellsOf(cols);
    const promise = main >= n
      ? `主体格优先：每张照片都先完整放进主体格，其余格循环补满（每张约出现 ${repeat} 次）`
      : `主体格优先：完整格 ${main} 个不够 ${n} 张，多出的照片会落到边缘格`;
    note = `几 × 几 铺满：${cols} × ${gridRows} = ${rects.length} 格，其中 ${main} 格在猫头主体内完整展示；${promise}`;
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
  renderSuggest(n, cols);

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
      const rec = order[i % order.length];
      const x = rc.x + gap / 2;
      const y = rc.y + gap / 2;
      const w = Math.max(1, rc.w - gap);
      const h = Math.max(1, rc.h - gap);

      if (layoutMode === 'auto' && n === 1) {
        // 单张：完整放入（不裁切），留白处补底色
        drawContain(ctx, rec, x, y, w, h, '#FBF1E4');
      } else {
        drawCover(ctx, rec, x, y, w, h);
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
   导出图片包（zip，零依赖 STORE 打包）
   内容：每张照片的成品 JPEG（按裁剪参数渲染）+ 拼贴大猫头 PNG + manifest.json
   ========================================================= */

// —— ZIP「仅存储」打包器（图片本身已压缩，STORE 不损失、实现最简） ——
let _crcTable = null;
function crc32(u8) {
  if (!_crcTable) {
    _crcTable = new Uint32Array(256);
    for (let n = 0; n < 256; n++) {
      let c = n;
      for (let k = 0; k < 8; k++) c = (c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1);
      _crcTable[n] = c >>> 0;
    }
  }
  let c = 0xFFFFFFFF;
  for (let i = 0; i < u8.length; i++) c = _crcTable[(c ^ u8[i]) & 0xFF] ^ (c >>> 8);
  return (c ^ 0xFFFFFFFF) >>> 0;
}

function zipStore(files) {
  const enc = new TextEncoder();
  const d = new Date();
  const dosTime = (d.getHours() << 11) | (d.getMinutes() << 5) | (d.getSeconds() >> 1);
  const dosDate = ((d.getFullYear() - 1980) << 9) | ((d.getMonth() + 1) << 5) | d.getDate();

  const chunks = [], central = [];
  let offset = 0;
  for (const f of files) {
    const nameB = enc.encode(f.name);
    const crc = crc32(f.data);

    const local = new Uint8Array(30 + nameB.length);
    const lv = new DataView(local.buffer);
    lv.setUint32(0, 0x04034b50, true);        // local file header
    lv.setUint16(4, 20, true);                // version needed
    lv.setUint16(6, 0x0800, true);            // UTF-8 文件名
    lv.setUint16(8, 0, true);                 // method = STORE
    lv.setUint16(10, dosTime, true);
    lv.setUint16(12, dosDate, true);
    lv.setUint32(14, crc, true);
    lv.setUint32(18, f.data.length, true);    // compressed size
    lv.setUint32(22, f.data.length, true);    // uncompressed size
    lv.setUint16(26, nameB.length, true);
    local.set(nameB, 30);
    chunks.push(local, f.data);

    const cen = new Uint8Array(46 + nameB.length);
    const cv = new DataView(cen.buffer);
    cv.setUint32(0, 0x02014b50, true);        // central directory
    cv.setUint16(4, 20, true);                // version made by
    cv.setUint16(6, 20, true);                // version needed
    cv.setUint16(8, 0x0800, true);            // UTF-8 文件名
    cv.setUint16(10, 0, true);                // method = STORE
    cv.setUint16(12, dosTime, true);
    cv.setUint16(14, dosDate, true);
    cv.setUint32(16, crc, true);
    cv.setUint32(20, f.data.length, true);
    cv.setUint32(24, f.data.length, true);
    cv.setUint16(28, nameB.length, true);
    cv.setUint32(42, offset, true);           // local header offset
    cen.set(nameB, 46);
    central.push(cen);

    offset += local.length + f.data.length;
  }

  const cenSize = central.reduce((s, c) => s + c.length, 0);
  const eocd = new Uint8Array(22);
  const ev = new DataView(eocd.buffer);
  ev.setUint32(0, 0x06054b50, true);          // end of central directory
  ev.setUint16(8, files.length, true);
  ev.setUint16(10, files.length, true);
  ev.setUint32(12, cenSize, true);
  ev.setUint32(16, offset, true);

  return new Blob([...chunks, ...central, eocd], { type: 'application/zip' });
}

async function blobBytes(b) { return new Uint8Array(await b.arrayBuffer()); }

// —— 照片文件名：客户id-猫咪名（有 id 不会重名）；没名字/id 的给随机 ID ——
function photoFileBase(rec) {
  const name = (rec.name || '').trim();
  const id = idOf(name).replace(/[\\/:*?"<>|]/g, '');
  const base = name.replace(/\s*[（(][^()（）]*[)）]\s*$/, '').trim()
    .replace(/[\\/:*?"<>|]/g, '').replace(/\s+/g, ' ');
  if (id && base) return `${id}-${base}`;
  if (id) return id;
  if (base) return base;
  return 'IMG-' + Math.random().toString(36).slice(2, 8).toUpperCase();
}

function uniqueName(base, ext, used) {
  let n = base, i = 1;
  while (used.has(n.toLowerCase())) { i++; n = `${base}-${i}`; }
  used.add(n.toLowerCase());
  return `${n}.${ext}`;
}

// —— 按裁剪参数渲染成品 JPEG（未裁剪的 = 原图完整导出，最长边不超存库尺寸） ——
function renderExportBlob(rec) {
  const img = sourceOf(rec);
  if (!img) return Promise.resolve(null);
  const iw = pxW(img), ih = pxH(img);
  if (!iw || !ih) return Promise.resolve(null);
  const c = cropOf(rec);
  const sw = Math.max(1, iw * c.w), sh = Math.max(1, ih * c.h);
  const sx = iw * c.x, sy = ih * c.y;
  const k = Math.min(1, MAX_SIZE / Math.max(sw, sh));
  const w = Math.max(1, Math.round(sw * k)), h = Math.max(1, Math.round(sh * k));
  const cv = document.createElement('canvas');
  cv.width = w; cv.height = h;
  const x = cv.getContext('2d');
  x.fillStyle = '#fff';
  x.fillRect(0, 0, w, h);
  x.drawImage(img, sx, sy, sw, sh, 0, 0, w, h);
  return new Promise((r) => cv.toBlob((b) => r(b), 'image/jpeg', 0.9));
}

// 拼贴大猫头成品（示例模式下临时用真实照片重画，画完恢复现场）
async function mosaicPngBlob() {
  if (!demoActive) {
    return await new Promise((r) => canvas.toBlob((b) => r(b), 'image/png'));
  }
  const keepPhotos = photos, keepSeed = seed;
  photos = (demoSnapshot || []).filter((p) => !p.demo);
  seed = Math.floor(Math.random() * 1e6);
  renderMosaic();
  const b = await new Promise((r) => canvas.toBlob((bb) => r(bb), 'image/png'));
  photos = keepPhotos; seed = keepSeed;
  renderMosaic();
  return b;
}

async function exportZip() {
  let src = demoActive ? (demoSnapshot || []) : photos;
  src = (src || []).filter((p) => !p.demo && p._bitmap);
  if (!src.length) return toast('还没有照片可以导出');

  toast(`正在打包 ${src.length} 张照片…`);
  const used = new Set();
  const files = [];
  const manifest = { app: 'catsmap', type: 'photo-pack', version: 1, exportedAt: new Date().toISOString(), photos: [] };

  // 1) 每张照片的成品图
  let done = 0;
  for (const rec of src) {
    try {
      const blob = await renderExportBlob(rec);
      if (!blob) continue;
      const fname = uniqueName(photoFileBase(rec), 'jpg', used);
      files.push({ name: fname, data: await blobBytes(blob) });
      manifest.photos.push({
        file: fname,
        name: (rec.name || '').trim(),
        id: idOf(rec.name || ''),
        pid: pidOf(rec),
        date: rec.date || '',
        place: rec.place || '',
        note: rec.note || '',
        cropped: !!isCropped(rec)
      });
    } catch (e) { console.warn('一张照片导出失败，已跳过', e); }
    done++;
    if (done % 5 === 0) toast(`正在打包… ${done} / ${src.length}`);
  }

  if (!files.length) return toast('照片导出失败，请重试');

  // 2) 拼贴大猫头
  try {
    const mosaic = await mosaicPngBlob();
    if (mosaic) files.push({ name: '拼贴-大猫头.png', data: await blobBytes(mosaic) });
    manifest.mosaic = '拼贴-大猫头.png';
  } catch (e) { console.warn('拼贴图导出失败', e); }

  // 3) 记录清单
  manifest.count = manifest.photos.length;
  files.push({ name: 'manifest.json', data: new TextEncoder().encode(JSON.stringify(manifest, null, 2)) });

  const zip = zipStore(files);
  const a = document.createElement('a');
  a.href = URL.createObjectURL(zip);
  a.download = `猫咪照片包-${todayISO()}.zip`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 8000);
  toast(`图片包已保存到下载文件夹（${files.length - 1} 张照片 + 拼图 + 清单）`);
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

/* 备份 = ZIP 包：原图二进制（不 base64，体积省约 1/3）+ manifest.json 元数据。
   缩略图不入包，导入时从原图重新生成。旧版 JSON 备份导入仍然兼容。 */
async function buildBackupBlob() {
  let rows = [];
  try { rows = await dbAll(); } catch (e) { /* 存储不可用时退回内存里的照片 */ }
  if (!rows.length) {
    const src = demoActive ? (demoSnapshot || []) : photos;   // 示例模式下备份的是真实照片
    rows = src.filter((p) => !p.demo).map(({ _bitmap, _rotSrc, _thumbUrl, ...r }) => r);
  }

  const files = [];
  const list = [];
  for (const r of rows) {
    try {
      const fname = `photos/${r.id}.jpg`;
      files.push({ name: fname, data: await blobBytes(r.blob) });
      list.push({
        id: r.id, file: fname,
        name: r.name || '', pid: r.pid || idOf(r.name || '') || '',
        date: r.date || '', place: r.place || '', note: r.note || '',
        w: r.w || 0, h: r.h || 0, createdAt: r.createdAt || 0,
        crop: r.crop || null
      });
    } catch (e) { console.warn('有一张照片读取失败，已跳过', e); }
  }
  if (!list.length) return null;
  files.push({ name: 'manifest.json', data: new TextEncoder().encode(JSON.stringify({
    app: 'catsmap', type: 'backup', version: 2, exportedAt: new Date().toISOString(), count: list.length, photos: list
  })) });
  return { blob: zipStore(files), count: list.length };
}

async function exportBackup() {
  toast('正在打包备份…');
  const built = await buildBackupBlob();
  if (!built) return toast('还没有照片可以备份');
  const a = document.createElement('a');
  a.href = URL.createObjectURL(built.blob);
  a.download = `猫咪头像墙备份-${todayISO()}.zip`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 8000);
  toast(`备份已保存到下载文件夹（${built.count} 张照片）`);
}

/* 只解析自家备份包（STORE 无压缩）的 zip：读中央目录取文件名和数据。
   自产自销用，不做通用解压器（不支持 DEFLATE/分卷/zip64）。 */
function zipRead(u8) {
  const dv = new DataView(u8.buffer, u8.byteOffset, u8.byteLength);
  let eocd = -1;
  for (let i = u8.length - 22; i >= Math.max(0, u8.length - 22 - 65536); i--) {
    if (dv.getUint32(i, true) === 0x06054b50) { eocd = i; break; }
  }
  if (eocd < 0) throw new Error('找不到 zip 目录');
  const count = dv.getUint16(eocd + 10, true);
  let p = dv.getUint32(eocd + 16, true);
  const dec = new TextDecoder();
  const out = new Map();
  for (let i = 0; i < count; i++) {
    if (dv.getUint32(p, true) !== 0x02014b50) break;
    const method = dv.getUint16(p + 10, true);
    const compSize = dv.getUint32(p + 20, true);
    const nameLen = dv.getUint16(p + 28, true);
    const extraLen = dv.getUint16(p + 30, true);
    const cmtLen = dv.getUint16(p + 32, true);
    const lfhOff = dv.getUint32(p + 42, true);
    const name = dec.decode(u8.subarray(p + 46, p + 46 + nameLen));
    if (method !== 0) throw new Error(`包内有压缩数据，不是本应用生成的备份：${name}`);
    const lNameLen = dv.getUint16(lfhOff + 26, true);
    const lExtraLen = dv.getUint16(lfhOff + 28, true);
    const start = lfhOff + 30 + lNameLen + lExtraLen;
    out.set(name, u8.subarray(start, start + compSize));
    p += 46 + nameLen + extraLen + cmtLen;
  }
  return out;
}

async function importBackup(file) {
  if (!file) return;
  const isZip = /\.zip$/i.test(file.name) || String(file.type || '').includes('zip');
  if (isZip) return importBackupZip(file);

  // 旧版 JSON 备份（图片是 base64 dataURL）
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
        id: it.id || uid(), name: it.name || '', pid: it.pid || idOf(it.name || '') || '',
        date: it.date || todayISO(),
        place: it.place || '', note: it.note || '',
        blob, thumb, w: it.w || 0, h: it.h || 0, createdAt: it.createdAt || Date.now(),
        crop: it.crop || null
      };
      rec._bitmap = await decodeFile(rec.blob);
      rec._thumbUrl = URL.createObjectURL(thumb);
      prepareSrc(rec);
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

/* 新版 ZIP 备份导入：photos/*.jpg 原图 + manifest.json 元数据（缩略图重新生成） */
async function importBackupZip(file) {
  let entries;
  try { entries = zipRead(new Uint8Array(await file.arrayBuffer())); }
  catch (e) { return toast('这个文件不是有效的备份包'); }
  let data;
  try { data = JSON.parse(new TextDecoder().decode(entries.get('manifest.json'))); }
  catch (e) { return toast('备份包清单无法解析'); }
  if (!data || data.app !== 'catsmap' || !Array.isArray(data.photos)) {
    return toast('这个文件不是「猫咪头像墙」的备份');
  }
  const items = data.photos;
  if (!items.length) return toast('备份包里没有照片');
  if (!confirm(`导入 ${items.length} 张照片？将与现有记录按编号合并，同编号的会覆盖。`)) return;

  if (demoActive) { leaveDemoForReal(); renderList(); renderMosaic(true); }
  toast(`正在导入 ${items.length} 张照片…`);
  let ok = 0;
  for (const it of items) {
    try {
      const raw = entries.get(it.file) || entries.get(`photos/${it.file}`);
      if (!raw) continue;
      const blob = new Blob([raw], { type: 'image/jpeg' });
      const rec = {
        id: it.id || uid(), name: it.name || '', pid: it.pid || idOf(it.name || '') || '',
        date: it.date || todayISO(),
        place: it.place || '', note: it.note || '',
        w: it.w || 0, h: it.h || 0, createdAt: it.createdAt || Date.now(),
        crop: it.crop || null
      };
      rec._bitmap = await decodeFile(blob);
      const thumb = await resizeToBlob(rec._bitmap, THUMB_SIZE, 0.78);
      rec._thumbUrl = URL.createObjectURL(thumb);
      rec.w = rec.w || rec._bitmap.width;      // 旧备份若没存尺寸，用解码结果补上
      rec.h = rec.h || rec._bitmap.height;
      prepareSrc(rec);
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
   裁剪编辑器
   ========================================================= */
const CROP_MAX_W = 460;     // 编辑区最大显示宽（css px）
const CROP_MAX_H = 360;     // 编辑区最大显示高
const CROP_MIN = 40;        // 裁剪框最小边长（显示像素）

let cropQueue = [];         // 待裁剪队列（上传后自动进入）
let cropIdx = 0;
let cropInQueue = false;    // true = 上传后的连续裁剪；false = 卡片上单独点开的
let cropRec = null;
let cropRot = 0;
let cropRatio = 1;          // 数字 = 宽/高（锁定比例）；'free' = 自由
let cropDispW = 0, cropDispH = 0, cropScale = 1;
let cropBoxPx = { l: 0, t: 0, w: 0, h: 0 };
let cropDrag = null;

const clampNum = (v, a, b) => Math.min(b, Math.max(a, v));

// 上传后：把这批新照片逐张送进裁剪
function openCropQueue(list) {
  const queue = (list || []).filter((r) => r && r._bitmap);
  if (!queue.length) return;
  cropQueue = queue;
  cropIdx = 0;
  openCropModal(cropQueue[0], true);
}

function openCropModal(rec, inQueue) {
  if (!rec || !rec._bitmap) return;
  cropRec = rec;
  cropInQueue = !!inQueue;
  cropRot = (rec.crop && rec.crop.rot) || 0;
  cropRatio = 1;
  buildCropStage();

  const c = rec.crop;
  const isFull = !c || (c.x === 0 && c.y === 0 && c.w === 1 && c.h === 1);
  if (c && (c.rot || 0) === cropRot && !isFull) {
    cropBoxPx = { l: c.x * cropDispW, t: c.y * cropDispH, w: c.w * cropDispW, h: c.h * cropDispH };
    clampBox();
    // 已经是裁剪过的照片：反推它像哪个预设比例，像就选中，否则显示「自由」
    const r = cropBoxPx.w / cropBoxPx.h;
    const hit = [1, 0.75, 1.333].find((p) => Math.abs(p - r) < 0.02);
    cropRatio = hit || 'free';
  } else {
    resetBoxForRatio();
  }
  setRatioBtns();
  layoutCropBox();

  $('cropStep').textContent = cropQueue.length > 1
    ? `第 ${cropIdx + 1} / ${cropQueue.length} 张　${catNameOf(rec)}`
    : catNameOf(rec);
  $('cropSkip').textContent = cropInQueue ? '跳过这张' : '取消';
  $('cropSkipAll').style.display = (cropInQueue && cropQueue.length > 1) ? '' : 'none';
  $('cropModal').classList.add('show');
  document.body.classList.add('cropping');
}

// 把「旋转后的图」按比例画进编辑区，并算好显示尺寸
function buildCropStage() {
  const bmp = cropRec._bitmap;
  const bw = pxW(bmp), bh = pxH(bmp);
  const swap = cropRot % 180 !== 0;
  const rw = swap ? bh : bw;
  const rh = swap ? bw : bh;

  let kf = Math.min(CROP_MAX_W / rw, CROP_MAX_H / rh);
  kf = Math.min(kf, 3);                       // 小图最多放大 3 倍，方便拖
  cropDispW = Math.max(60, Math.round(rw * kf));
  cropDispH = Math.max(60, Math.round(rh * kf));
  cropScale = Math.max(cropDispW / rw, cropDispH / rh);

  const cv = $('cropCanvas');
  const dpr = Math.min(2, window.devicePixelRatio || 1);
  cv.width = Math.round(cropDispW * dpr);
  cv.height = Math.round(cropDispH * dpr);
  cv.style.width = cropDispW + 'px';
  cv.style.height = cropDispH + 'px';

  const x = cv.getContext('2d');
  x.setTransform(dpr, 0, 0, dpr, 0, 0);
  x.fillStyle = '#F3EADF';
  x.fillRect(0, 0, cropDispW, cropDispH);
  x.save();
  x.translate(cropDispW / 2, cropDispH / 2);
  x.rotate(cropRot * Math.PI / 180);
  x.scale(cropScale, cropScale);
  x.drawImage(bmp, -bw / 2, -bh / 2);
  x.restore();
}

// 默认裁剪框：按当前比例取「能放下的最大一块」，居中
function resetBoxForRatio() {
  const r = cropRatio === 'free' ? cropDispW / cropDispH : cropRatio;
  let w = cropDispW, h = w / r;
  if (h > cropDispH) { h = cropDispH; w = h * r; }
  cropBoxPx = { l: (cropDispW - w) / 2, t: (cropDispH - h) / 2, w, h };
}

function layoutCropBox() {
  const el = $('cropBox');
  el.style.left = cropBoxPx.l + 'px';
  el.style.top = cropBoxPx.t + 'px';
  el.style.width = cropBoxPx.w + 'px';
  el.style.height = cropBoxPx.h + 'px';
}

function clampBox() {
  const r = cropRatio === 'free' ? null : cropRatio;
  cropBoxPx.w = clampNum(cropBoxPx.w, CROP_MIN, cropDispW);
  cropBoxPx.h = clampNum(cropBoxPx.h, CROP_MIN, cropDispH);
  if (r) {
    if (cropBoxPx.w > cropDispW) { cropBoxPx.w = cropDispW; cropBoxPx.h = cropBoxPx.w / r; }
    if (cropBoxPx.h > cropDispH) { cropBoxPx.h = cropDispH; cropBoxPx.w = cropBoxPx.h * r; }
    if (cropBoxPx.w < CROP_MIN) { cropBoxPx.w = CROP_MIN; cropBoxPx.h = cropBoxPx.w / r; }
    if (cropBoxPx.h < CROP_MIN) { cropBoxPx.h = CROP_MIN; cropBoxPx.w = cropBoxPx.h * r; }
  }
  cropBoxPx.l = clampNum(cropBoxPx.l, 0, Math.max(0, cropDispW - cropBoxPx.w));
  cropBoxPx.t = clampNum(cropBoxPx.t, 0, Math.max(0, cropDispH - cropBoxPx.h));
}

function setRatioBtns() {
  Array.from($('ratioSeg').children).forEach((b) => {
    b.classList.toggle('on', String(b.dataset.ratio) === String(cropRatio));
  });
}

// 切换预设比例：保持当前框中心，按新比例重排
function applyRatio() {
  const r = cropRatio;
  const cx = cropBoxPx.l + cropBoxPx.w / 2;
  const cy = cropBoxPx.t + cropBoxPx.h / 2;
  let h = cropBoxPx.h, w = h * r;
  if (w > cropDispW) { w = cropDispW; h = w / r; }
  if (h > cropDispH) { h = cropDispH; w = h * r; }
  cropBoxPx = { l: cx - w / 2, t: cy - h / 2, w: Math.max(CROP_MIN, w), h: Math.max(CROP_MIN, h) };
  clampBox();
  layoutCropBox();
}

function rotateCrop(delta) {
  cropRot = ((cropRot + delta) % 360 + 360) % 360;
  buildCropStage();
  resetBoxForRatio();
  layoutCropBox();
}

function applyCropDrag(dx, dy) {
  const SW = cropDispW, SH = cropDispH;
  const b0 = cropDrag.box;
  const mode = cropDrag.mode;

  if (mode === 'move') {
    cropBoxPx = {
      l: clampNum(b0.l + dx, 0, Math.max(0, SW - b0.w)),
      t: clampNum(b0.t + dy, 0, Math.max(0, SH - b0.h)),
      w: b0.w, h: b0.h
    };
    layoutCropBox();
    return;
  }

  const right = b0.l + b0.w;
  const bottom = b0.t + b0.h;
  const isE = mode.indexOf('e') >= 0;      // 拖右角 → 左边界固定
  const isS = mode.indexOf('s') >= 0;      // 拖下角 → 上边界固定
  const maxW = isE ? SW - b0.l : right;
  const maxH = isS ? SH - b0.t : bottom;
  let W, H;

  if (cropRatio === 'free') {
    W = isE ? b0.w + dx : b0.w - dx;
    H = isS ? b0.h + dy : b0.h - dy;
    W = clampNum(W, Math.min(CROP_MIN, maxW), Math.max(CROP_MIN, maxW));
    H = clampNum(H, Math.min(CROP_MIN, maxH), Math.max(CROP_MIN, maxH));
  } else {
    const r = cropRatio;
    const rawW = isE ? b0.w + dx : b0.w - dx;
    const rawH = isS ? b0.h + dy : b0.h - dy;
    if (Math.abs(rawW - b0.w) >= Math.abs(rawH - b0.h)) { W = rawW; H = W / r; }
    else { H = rawH; W = H * r; }
    W = Math.max(CROP_MIN, Math.min(W, maxW, maxH * r));
    H = W / r;
  }

  cropBoxPx = { l: isE ? b0.l : right - W, t: isS ? b0.t : bottom - H, w: W, h: H };
  clampBox();
  layoutCropBox();
}

// 保存裁剪结果：原图不动，只改参数，并重建缩略图
async function commitCrop(rec, norm) {
  if (norm) rec.crop = norm; else delete rec.crop;
  prepareSrc(rec);
  try {
    const tb = await croppedThumb(rec);
    if (tb) {
      if (rec._thumbUrl) { try { URL.revokeObjectURL(rec._thumbUrl); } catch (e) { /* ignore */ } }
      rec.thumb = tb;
      rec._thumbUrl = URL.createObjectURL(tb);
    }
  } catch (e) { console.warn('缩略图重建失败', e); }
  await saveRecord(rec);
}

function nextInCropQueue() {
  renderList();
  renderMosaic(true);
  if (!cropInQueue) return closeCropModal();
  cropIdx++;
  if (cropIdx < cropQueue.length) openCropModal(cropQueue[cropIdx], true);
  else { closeCropModal(); toast('裁剪完成'); }
}

function closeCropModal() {
  $('cropModal').classList.remove('show');
  document.body.classList.remove('cropping');
  cropRec = null;
  cropQueue = [];
  cropIdx = 0;
  cropDrag = null;
}

async function applyCrop() {
  const rec = cropRec;
  if (!rec) return;
  const norm = {
    rot: cropRot,
    x: cropBoxPx.l / cropDispW,
    y: cropBoxPx.t / cropDispH,
    w: cropBoxPx.w / cropDispW,
    h: cropBoxPx.h / cropDispH
  };
  const full = !norm.rot && norm.x < 0.002 && norm.y < 0.002 && norm.w > 0.998 && norm.h > 0.998;
  const next = full ? null : norm;
  const cur = rec.crop || null;
  const same = (!cur && !next) || (cur && next &&
    cur.rot === next.rot && Math.abs(cur.x - next.x) < 0.001 && Math.abs(cur.y - next.y) < 0.001 &&
    Math.abs(cur.w - next.w) < 0.001 && Math.abs(cur.h - next.h) < 0.001);
  if (!same) await commitCrop(rec, next);
  nextInCropQueue();
}

/* =========================================================
   事件绑定
   ========================================================= */
$('pickBtn').addEventListener('click', () => $('fileInput').click());
$('cameraBtn').addEventListener('click', () => $('cameraInput').click());
$('demoBtn').addEventListener('click', () => enterDemo(14));
$('demoExit').addEventListener('click', exitDemo);
$('exportBtn').addEventListener('click', exportBackup);
$('zipBtn').addEventListener('click', exportZip);
$('importBtn').addEventListener('click', () => $('importInput').click());
$('importInput').addEventListener('change', (e) => {
  const f = e.target.files[0];
  e.target.value = '';
  importBackup(f);
});
$('fileInput').addEventListener('change', (e) => { addFiles(e.target.files); e.target.value = ''; });
$('cameraInput').addEventListener('change', (e) => { addFiles(e.target.files); e.target.value = ''; });

/* ---------- 裁剪弹窗 ---------- */
$('ratioSeg').addEventListener('click', (e) => {
  const btn = e.target.closest('button[data-ratio]');
  if (!btn) return;
  const raw = btn.dataset.ratio;
  cropRatio = raw === 'free' ? 'free' : Number(raw);
  setRatioBtns();
  if (cropRatio !== 'free') applyRatio();
});

$('rotL').addEventListener('click', () => rotateCrop(-90));
$('rotR').addEventListener('click', () => rotateCrop(90));

$('cropReset').addEventListener('click', () => {
  cropRot = 0;
  cropRatio = 1;
  setRatioBtns();
  buildCropStage();
  resetBoxForRatio();
  layoutCropBox();
});

$('cropApply').addEventListener('click', applyCrop);

$('cropSkip').addEventListener('click', () => {
  if (cropInQueue) nextInCropQueue();
  else closeCropModal();
});

$('cropSkipAll').addEventListener('click', () => {
  closeCropModal();
  toast('已按原图保留，之后随时可以在照片卡片上点「裁剪」');
});

const cropBoxEl = $('cropBox');
cropBoxEl.addEventListener('pointerdown', (e) => {
  if (!cropRec) return;
  const handle = e.target.closest('.cg');
  cropDrag = {
    mode: handle ? handle.dataset.h : 'move',
    x0: e.clientX, y0: e.clientY,
    box: { l: cropBoxPx.l, t: cropBoxPx.t, w: cropBoxPx.w, h: cropBoxPx.h }
  };
  try { cropBoxEl.setPointerCapture(e.pointerId); } catch (err) { /* ignore */ }
  e.preventDefault();
});
cropBoxEl.addEventListener('pointermove', (e) => {
  if (!cropDrag) return;
  applyCropDrag(e.clientX - cropDrag.x0, e.clientY - cropDrag.y0);
});
['pointerup', 'pointercancel', 'lostpointercapture'].forEach((ev) =>
  cropBoxEl.addEventListener(ev, () => { cropDrag = null; }));

document.addEventListener('keydown', (e) => {
  if (!$('cropModal').classList.contains('show')) return;
  if (e.key === 'Escape') {
    if (cropInQueue) nextInCropQueue(); else closeCropModal();
  } else if (e.key === 'Enter') {
    if (e.target && /^(INPUT|TEXTAREA)$/.test(e.target.tagName)) return;
    e.preventDefault();
    applyCrop();
  }
});

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
$('suggestApply').addEventListener('click', () => {
  const n = photos.filter((p) => p._bitmap).length;
  if (!n) return;
  $('density').value = suggestCols(n);
  renderMosaic(true);
  toast('已切到建议档位');
});
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
        prepareSrc(r);
      } catch (e) { continue; }
      loaded.push(r);
    }
    if (demoActive) { demoSnapshot = loaded; return; }  // 加载期间用户进了示例，先存快照，退出时再显示
    // 旧数据迁移：没有 pid 字段的，从名字括号补一份（不回写库，编辑时自然会存）
    for (const p of loaded) {
      if (p.pid == null || String(p.pid).trim() === '') {
        const id = idOf(p.name);
        if (id) p.pid = id;
      }
    }
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
