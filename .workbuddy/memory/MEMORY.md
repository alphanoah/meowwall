# 猫咪头像墙 · 项目长期约定

## 版本控制（2026-09-23 用户明确要求）
- **每完成一次改动，自动执行一次 git 提交**，提交信息写清改了什么（做了什么、为什么、影响哪些文件/功能）。
- 仓库：`/Users/alpha/Theo/meowwall`（2026-09-28 从 `/Users/alpha/Downloads/catsmap` 整体移动过来，GitHub 远端与提交历史不变），分支 `main`，首次提交 `80a9593`。
- 提交前先 `node --check app.js` 确认语法无误；改动涉及渲染/界面时，先截图自测再提交。
- 一次改动 = 一个提交，不把多个不相关改动混在一起。
- 推送约定（2026-09-30 更新）：Pages 线上地址 `https://alphanoah.github.io/meowwall/`（Source = main /docs，推送后约 1 分钟内部署完）。仓库地址 `https://github.com/alphanoah/meowwall.git`。
  - **网络通道（按优先级试）**：① `git push git@github.com:alphanoah/meowwall.git main` —— SSH 22 端口直连**实测可用**（`ssh -T git@github.com` 返回 `Hi alphanoah!`，key = `~/.ssh/id_ed25519`），这是当前最稳的通道；② HTTPS 直连 github.com:443 会被墙（75s 超时）；③ 沙盒代理 `127.0.0.1:53061`（env 里的 HTTP_PROXY）访问 github 是**时通时断**（多次重试偶尔 200、多为 502），当兜底。
  - 用 URL 直推不会更新 `origin/main` 本地跟踪引用（`git status` 会一直显示 ahead），推完用 `git update-ref refs/remotes/origin/main <sha>` 同步。
  - `origin` 的 URL 仍是 HTTPS（不通）；**远程配置不要擅自改，换通道用一次性 URL 推即可**。
- **commit 照旧自动做**，用户开口时直接 push（默认优先走 SSH 通道）。
- 提交信息结尾注明「已验证」的方式（如 headless 截图 / node 校验）。

## 技术约定
- 纯前端零依赖：`index.html` + `style.css` + `app.js`，无构建步骤。
- 拼贴底图（2026-09-30 起）：「木牌猫相框」背景图（`cat-bg.png`，中间圆洞放照片格子），真源 = app.js 的 `BG_MAP`/`BG_HOLE`（洞几何由图实测）+ `BG_CLIP_R`。**换背景图必须重新实测洞几何并复测主体格数**（testenv/measure-cells.js 可出数）。图加载失败自动退回猫头画法；工作台「木牌相框底图」勾选可来回切（localStorage `catsmap.bgFrame`，默认开），`?nobg` / `window.CAT_BG_DISABLE` 强制猫头（自测页 test-mainfirst 的 iframe 用，其基准表按猫头固化，勾选在这两种情况下自动隐藏）。顶栏 logo 仍是旧猫头（index.html 内联 SVG，不共用）。
- 控制区固定分区（2026-09-30 起）：**每个控件常驻、位置只跟窗口宽度有关**——切换排列方式/建议值增减不再引起控件换行跳动（1029bb9）。「照片块数」非铺满模式置灰（`.ctl.is-idle` 置灰 + input disabled + title 说明）不消失；建议值行常驻（无建议时 `.suggest.is-idle` 灰字静默），`min-height:42px` 恒定两行；相框底图未就绪用 `.ctl.off{visibility:hidden}` 占位（不用 hidden/display:none，就绪后原地出现、零重排）。**坑：`.suggest` 是 flex-basis:100% 的整行，DOM 里必须放在所有控件之后**——插在中间会把后面的控件全挤到下一行（第一版就栽在这）。验证留档 testenv/test-ctl-stable.js（三视口 × 三模式逐控件坐标比对）。
- 本地预览：`cd /Users/alpha/Theo/meowwall && /Users/alpha/.workbuddy/binaries/python/versions/3.13.12/bin/python3 -m http.server 8848`
  - **固定用 8848 端口**：照片存在浏览器 IndexedDB，数据绑定「源地址」（host:port，与项目路径无关），换端口 = 换一个空库；项目换文件夹不影响数据。
- 照片存储：IndexedDB 库 `catsmap` / 表 `photos`（主键 id，字段 name/date/place/note/blob/thumb/w/h/createdAt/crop）。
  - `crop`（2026-09-23 新增，可选）= `{rot,x,y,w,h}`：rot 为 0/90/180/270，x/y/w/h 是「旋转后图」上的归一化比例。**非破坏式**：原图 blob 永不动，裁剪只存参数；无 crop 字段 = 用原图（老数据天然兼容）。
  - 备份/导入已带 crop 字段，换电脑可还原裁剪结果。
- 常用路径：node = `/Users/alpha/.workbuddy/binaries/node/versions/22.22.2-3/bin/node`；Chrome = `/Applications/Google Chrome.app/Contents/MacOS/Google Chrome`

## 发布流程 / File System Access（2026-09-28 踩坑）
- 「发布到网站」= 把成品图 + photos.json 写进项目里的 `docs/`（`buildSiteFiles` 只产出照片/拼贴/photos.json；docs 的 index.html、share.css、share.js 是仓库静态文件，发布不覆盖）。
- 访客页相框（2026-09-30 起，91a0841）：docs/share.js 也支持木牌相框，几何与工作台同源（BG_MAP/BG_HOLE/BG_CLIP_R，**改一边必须同步另一边**）。清单 `bgFrame:true` 且同目录有 cat-bg.png 才用相框，否则退回猫头；发布时工作台勾着相框才把 cat-bg.png 一起发布；访客页有自己的「相框底图」开关，相框模式下「轮廓+胡须」置灰。发布 toast 三条路径都带「打开访客页」跳转 + 顶栏有常驻「打开访客页」按钮（window.open 必须留在点击手势里，不能先 await 探测，否则被拦）。
  - 像素回归坑：访客页随机挂件（widgetToggle）会污染截图，比对前先关；相框站与猫头站默认档位不同（按形状算），跨页比对要显式设同一 density/gap。
- 目录句柄存在 IndexedDB 的 `catsmap` 库 KV 表里（键 `publishDir`），下次发布直接复用、不再弹框。
  - **坑**：目录句柄绑在「那个具体目录」上。项目文件夹被移动/改名后，句柄照样读得出来、`queryPermission` 也仍返回 granted，只有在真正读写那一刻才抛 `NotFoundError: A requested file or directory could not be found at the time an operation was processed.` → 表现为发布提示「写不进文件夹（…），已改成下载发布包」。项目 2026-09-28 从 Downloads/catsmap 挪到 Theo/meowwall 正因此中招。
  - 已在 29d1ad3 自愈：`dirUsable()`（只读探活 `values().next()`）在 `currentPubDir()` 里先探，死了就 `forgetPubDir()` 并重选（探活在用户手势内，弹框正常）；面板会写明「上次记下的项目文件夹已经找不到了」+ 按钮变「重新选文件夹并发布」。
  - 另有 `pubDirChange`（面板里「换个文件夹」）可手动重选；`canWriteDir()` 为 false 的浏览器走下载 zip 兜底。
- 换文件夹/换端口后若要重来：面板点「换个文件夹」重选一次即可；句柄失效不影响 IndexedDB 里的照片数据。

## 验证套路的坑（踩过）
- 用 headless Chrome **截图**验证，别用 `--dump-dom`（virtual-time 不可靠）。
- 测试页注入脚本必须**同步执行**；用 `setTimeout` 会让 virtual-time 截图挂死。
- 调试值时把信息画到页面上（固定定位的 div）再截图，比读 title/console 可靠。

## 已确认的产品口径
- 统计四项：照片 / 猫咪 / 客户 / 最近探访。`合照(x)` 不算猫；未命名照片合计算 1 只「未命名猫」、每张各算 1 位客户；有名字无编号的合并算 1 位客户。
- 文件名规则：`客户id-猫咪名称-地址`（地址可省略、可含 `-`），`all` → `合照(id)`；自动填入后仍可手改。
- 排列方式：2026-09-23 用户明确确认**保留**「按照片数均分」（默认）＋「几 × 几 铺满」两种；此前的「正方格平铺」方案（squareGrid/bestSquareGrid）已永久废弃，**不要再擅自改回**。
- 单张照片：均分模式下整头完整放入（不裁切）+ 米色留白。
- 裁剪（2026-09-23 用户三选一确认）：默认 **1:1 正方形**；**上传后自动弹出**逐张裁剪（可「全部保持原样」跳过），卡片上永远有「裁剪」入口可回头改；**支持旋转**（左/右 90°）。比例另提供 自由 / 3:4 / 4:3 预设。
- 目标进度（2026-09-27 用户四问确认）：口径 = **认识的喵星人数**（名字去重、同户同名合并、合照不算、未命名合并 1 位）；大猫头新增第三模式「目标进度」（每猫一格 + 空格淡爪印，代表照 = 最新单人照，默认选中），原均分/铺满两模式**必须保留**；访客页同步显示进度条；时间对照用**自然年**。
- 水印（2026-09-27）：文字可自定义（默认 Theo）、「带小猫爪」「对角密排」各为可勾选项，偏好存 localStorage 并随 photos.json 发布（watermark / watermarkPaw / watermarkTile），访客页下载水印同步跟随。爪型绘制要点：每个 ellipse 前必须 moveTo 隔开子路径，否则 canvas 自动补弦线、stroke 会画出穿爪直线。

## TODO（2026-09-24 用户口述）
1. ~~叫法统一：所有界面里的「猫咪/只」改成「喵星人」~~ ✅ 2026-09-26 完成（74654e3），全局 grep 无残留，四页回归通过。
2. ~~访客页加可爱动态挂件~~ ✅ 2026-09-26 完成（dbbe00a）。规格：：三个方案都要，**随机分布**（每次加载随机组合/位置/节奏：脚印路径随机、小猫速度方向随机、睡猫角落随机）；**灰猫毛色**（灰蓝色调）；**给访客开关**，控件区小开关、默认开、localStorage 记忆。实现：纯 CSS/SVG 动画，无图片依赖，pointer-events 穿透不挡操作，不拖慢照片加载。三个原型：脚印小径（约半秒一步依次亮起消失）、溜达小猫（约 13s 走完一屏、四腿交替+摆尾+身体起伏）、角落氛围组（呼吸睡猫+滚动毛线球+偶尔 Zzz 和脚印）。
  - 关键认知：单独把照片裁成方形**解决不了**「每格都看得到猫」——格子不是方形时，方形照片要么留白要么被二次裁切。裁剪的价值在于「让猫脸落在裁剪框正中」。
