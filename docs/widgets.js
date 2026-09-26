/* =========================================================
   喵星人头像墙 · 访客页小挂件
   三个随机出没的氛围挂件：脚印小径 / 溜达的小猫 / 角落氛围组。
   · 纯 CSS/SVG 动画，无图片、无依赖，pointer-events 穿透不挡操作
   · 每次加载随机组合与节奏（路径 / 方向 / 速度 / 角落）
   · 控件区「小挂件」开关，默认开，localStorage 记忆
   · 系统开了「减少动态效果」时自动关闭
   ========================================================= */
(function () {
  'use strict';
  var KEY = 'meowwall.widgets';
  var reduced = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  var on = !reduced && localStorage.getItem(KEY) !== '0';

  function rnd(a, b) { return a + Math.random() * (b - a); }
  function pick(arr) { return arr[Math.floor(Math.random() * arr.length)]; }

  var layer = document.createElement('div');
  layer.id = 'widgetLayer';
  layer.setAttribute('aria-hidden', 'true');
  if (!on) layer.classList.add('off');

  /* ---------- 灰蓝色调（本次加载微微抖动，避免每次一模一样） ---------- */
  var body = pick(['#8FA5B5', '#879EB0', '#96AAC9']);
  var dark = '#75899A';
  var belly = '#A9BCC9';
  var ink = '#2F3D4A';
  var earIn = '#D9A8B8';
  var yarnC = '#7FA0B0';
  var yarnD = '#5F7E90';
  var zzzC = '#9FB2C1';

  /* ---------- 1. 脚印小径：一条随机走向的小径，脚步依次亮起又淡去 ---------- */
  var trailSvg = (function () {
    var W = window.innerWidth, H = window.innerHeight;
    var dir = pick([1, -1]);                       // 1: 左→右
    var x0 = dir === 1 ? rnd(-40, W * 0.15) : rnd(W * 0.85, W + 40);
    var step = rnd(62, 88) * (dir === 1 ? 1 : -1); // 每步水平距离
    var y0 = rnd(H * 0.55, H * 0.9);
    var drift = rnd(-0.28, 0.28);                  // 斜率：小径微微爬坡
    var gap = rnd(14, 26) * pick([1, -1]);         // 左右脚错开的垂直幅度
    var rotBase = drift * 18;
    var startDelay = rnd(0, 2.5);
    var pace = rnd(0.42, 0.62);
    var s = '<svg class="wtrail" width="100%" height="100%">';
    for (var i = 0; i < 8; i++) {
      var x = x0 + step * i;
      var y = y0 + step * i * drift + (i % 2 ? gap : -gap * 0.4);
      var rot = rotBase * (dir === 1 ? 1 : -1) + (i % 2 ? 13 : -13);
      s += '<g class="wprint" style="animation-delay:' + (startDelay + i * pace).toFixed(2) + 's">'
        + '<g transform="translate(' + x.toFixed(1) + ',' + y.toFixed(1) + ') rotate(' + rot.toFixed(1) + ')">'
        + '<ellipse cx="0" cy="5.5" rx="6.8" ry="5.2" fill="' + dark + '"/>'
        + '<ellipse cx="-6.8" cy="-3" rx="2.8" ry="3.5" fill="' + dark + '"/>'
        + '<ellipse cx="-2.3" cy="-6.2" rx="2.8" ry="3.5" fill="' + dark + '"/>'
        + '<ellipse cx="2.3" cy="-6.2" rx="2.8" ry="3.5" fill="' + dark + '"/>'
        + '<ellipse cx="6.8" cy="-3" rx="2.8" ry="3.5" fill="' + dark + '"/>'
        + '</g></g>';
    }
    return s + '</svg>';
  })();

  /* ---------- 2. 溜达的小猫：沿页面底部走，方向 / 速度随机 ---------- */
  var walkerSvg = (function () {
    var dirRev = pick([false, true]);
    var dur = rnd(11, 17).toFixed(1);
    var bottom = rnd(2, 14).toFixed(0);
    var flip = dirRev ? ' transform="scale(-1 1)"' : '';
    return '<svg class="wwalker' + (dirRev ? ' wrev' : '') + '" width="100%" height="180" '
      + 'style="--wdur:' + dur + 's;--wbottom:' + bottom + 'px">'
      + '<g class="wmove"><g transform="translate(60,116)"><g' + flip + '>'
      + '<g transform="translate(60,116)">'
      + '<g class="wbob">'
      + '<path class="wtail" d="M-30,-8 C-46,-16 -52,-34 -44,-46" fill="none" stroke="' + dark + '" stroke-width="9" stroke-linecap="round"/>'
      + '<rect class="wleg" x="-26" y="8" width="8" height="24" rx="3.5" fill="' + body + '"/>'
      + '<rect class="wleg wb" x="16" y="8" width="8" height="24" rx="3.5" fill="' + body + '"/>'
      + '<ellipse cx="0" cy="0" rx="34" ry="20" fill="' + body + '"/>'
      + '<rect class="wleg wb" x="-16" y="9" width="8" height="23" rx="3.5" fill="' + dark + '"/>'
      + '<rect class="wleg" x="26" y="9" width="8" height="23" rx="3.5" fill="' + dark + '"/>'
      + '<path d="M-34,-4 Q-20,-24 2,-20 L10,-8 Q-14,-2 -34,-4Z" fill="' + belly + '"/>'
      + '<circle cx="38" cy="-16" r="17" fill="' + body + '"/>'
      + '<path d="M26,-28 L23,-42 L35,-32Z" fill="' + body + '"/>'
      + '<path d="M44,-32 L50,-44 L54,-30Z" fill="' + body + '"/>'
      + '<path d="M27,-33 L26,-39 L31,-35Z" fill="' + earIn + '"/>'
      + '<circle cx="40" cy="-18" r="2.4" fill="' + ink + '"/>'
      + '<path d="M50,-14 L56,-13 L51,-9Z" fill="' + earIn + '"/>'
      + '<path d="M40,-8 Q44,-4 48,-7" fill="none" stroke="' + ink + '" stroke-width="1.6" stroke-linecap="round"/>'
      + '<path d="M31,-8 Q34,-5 38,-8" fill="none" stroke="' + ink + '" stroke-width="1.6" stroke-linecap="round"/>'
      + '</g></g></g></g></svg>';
  })();

  /* ---------- 3. 角落氛围组：呼吸睡猫 + 滚动毛线球 + Zzz，随机角落 ---------- */
  var cornerSvg = (function () {
    var corner = pick(['bl', 'br', 'tl', 'tr']);
    var flipX = corner.charAt(1) === 'r';          // 右侧角落整体镜像，睡猫脸朝内
    var flipY = corner.charAt(0) === 't';          // 顶部角落垂直翻转（挂在「架上」的感觉）
    var side = flipX ? 'right:18px;' : 'left:18px;';
    var vert = flipY ? 'top:14px;' : 'bottom:64px;';
    var inner = (flipX ? 'scale(-1 1) ' : '') + (flipY ? 'scale(1 -1)' : '');
    var tf = (inner.trim() === '') ? '' : ' transform="' + inner.trim() + '"';
    return '<div class="wcorner" style="' + side + vert + '">'
      + '<svg width="250" height="170" viewBox="0 0 250 170"'
      + ' style="overflow:visible"><g' + tf + '>'
      + '<g transform="translate(96,118)">'
      + '<g class="wbreathe">'
      + '<path d="M-38,10 C-40,-16 -14,-30 10,-24 C34,-18 44,2 36,16 C24,30 -22,30 -38,10Z" fill="' + body + '"/>'
      + '<circle cx="26" cy="-8" r="17" fill="' + body + '"/>'
      + '<path d="M14,-20 L11,-34 L23,-25Z" fill="' + body + '"/>'
      + '<path d="M33,-24 L38,-36 L42,-22Z" fill="' + body + '"/>'
      + '<path d="M18,-8 Q22,-4 26,-8" fill="none" stroke="' + ink + '" stroke-width="2" stroke-linecap="round"/>'
      + '<path d="M32,-6 Q36,-2 40,-6" fill="none" stroke="' + ink + '" stroke-width="2" stroke-linecap="round"/>'
      + '<path d="M50,14 C58,8 60,-2 54,-6" fill="none" stroke="' + dark + '" stroke-width="7" stroke-linecap="round"/>'
      + '</g>'
      + '<text class="wz" x="34" y="-40" font-size="14" font-weight="500" fill="' + zzzC + '">z</text>'
      + '<text class="wz wz2" x="46" y="-52" font-size="18" font-weight="500" fill="' + zzzC + '">Z</text>'
      + '<text class="wz wz3" x="58" y="-64" font-size="22" font-weight="500" fill="' + zzzC + '">z</text>'
      + '</g>'
      + '<g class="wyarn"><circle cx="196" cy="132" r="12" fill="' + yarnC + '"/>'
      + '<path d="M187,124 Q196,136 207,128" fill="none" stroke="' + yarnD + '" stroke-width="2"/>'
      + '<path d="M186,133 Q198,143 208,135" fill="none" stroke="' + yarnD + '" stroke-width="2"/></g>'
      + '<g class="wprint wzp" style="animation-delay:2.6s"><g transform="translate(120,52) rotate(-8)">'
      + '<ellipse cx="0" cy="5" rx="6" ry="4.6" fill="' + dark + '"/><ellipse cx="-6" cy="-2.6" rx="2.5" ry="3.1" fill="' + dark + '"/>'
      + '<ellipse cx="-2" cy="-5.4" rx="2.5" ry="3.1" fill="' + dark + '"/><ellipse cx="2" cy="-5.4" rx="2.5" ry="3.1" fill="' + dark + '"/>'
      + '<ellipse cx="6" cy="-2.6" rx="2.5" ry="3.1" fill="' + dark + '"/></g></g>'
      + '</g></svg></div>';
  })();

  layer.innerHTML = trailSvg + walkerSvg + cornerSvg;
  document.body.appendChild(layer);

  /* ---------- 开关：控件区「小挂件」，记忆到 localStorage ---------- */
  var cb = document.getElementById('widgetToggle');
  if (cb) {
    cb.checked = on;
    cb.addEventListener('change', function () {
      on = cb.checked;
      localStorage.setItem(KEY, on ? '1' : '0');
      layer.classList.toggle('off', !on);
    });
  }
})();
