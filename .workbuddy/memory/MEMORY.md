# 猫咪头像墙 · 项目长期约定

## 版本控制（2026-09-23 用户明确要求）
- **每完成一次改动，自动执行一次 git 提交**，提交信息写清改了什么（做了什么、为什么、影响哪些文件/功能）。
- 仓库：`/Users/alpha/Downloads/catsmap`，分支 `main`，首次提交 `80a9593`。
- 提交前先 `node --check app.js` 确认语法无误；改动涉及渲染/界面时，先截图自测再提交。
- 一次改动 = 一个提交，不把多个不相关改动混在一起。
- 推送约定（2026-09-24 起有远端）：remote = `https://github.com/alphanoah/meowwall.git`，Pages 线上地址 `https://alphanoah.github.io/meowwall/`（Source = main /docs）。commit 照旧自动做；**push 由用户在自己终端跑**（AI 沙盒代理到 github.com 一律 502，推不了），推完说一声即可。
- 提交信息结尾注明「已验证」的方式（如 headless 截图 / node 校验）。

## 技术约定
- 纯前端零依赖：`index.html` + `style.css` + `app.js`，无构建步骤。
- 本地预览：`cd /Users/alpha/Downloads/catsmap && /Users/alpha/.workbuddy/binaries/python/versions/3.13.12/bin/python3 -m http.server 8848`
  - **固定用 8848 端口**：照片存在浏览器 IndexedDB，数据绑定「源地址」，换端口 = 换一个空库。
- 照片存储：IndexedDB 库 `catsmap` / 表 `photos`（主键 id，字段 name/date/place/note/blob/thumb/w/h/createdAt/crop）。
  - `crop`（2026-09-23 新增，可选）= `{rot,x,y,w,h}`：rot 为 0/90/180/270，x/y/w/h 是「旋转后图」上的归一化比例。**非破坏式**：原图 blob 永不动，裁剪只存参数；无 crop 字段 = 用原图（老数据天然兼容）。
  - 备份/导入已带 crop 字段，换电脑可还原裁剪结果。
- 常用路径：node = `/Users/alpha/.workbuddy/binaries/node/versions/22.22.2-3/bin/node`；Chrome = `/Applications/Google Chrome.app/Contents/MacOS/Google Chrome`

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

## TODO（2026-09-24 用户口述，未开工）
1. **叫法统一：所有界面里的「猫咪/只」改成「喵星人」**——如「xx 只猫咪」→「xx 个喵星人」。理念：这个网站的猫都是喵星人，更平等。涉及：工作台统计卡（"只猫咪"）、发布面板、访客页总览（"只喵星人"其实是"45 只"里的量词，一并检查）、按钮/提示文案、og 标签等，全局 grep「猫」「只」排查量词。
2. **访客页加可爱动态挂件**——如到处走动的猫脚印（淡入淡出或连续行走）、甚至小猫咪在页面各处走动。想法还开放（脚印 or 走动的猫 or 两者），实现前先和用户确认样子；注意性能（纯 CSS/canvas 动画、别拖慢 52 张图的加载）。
  - 关键认知：单独把照片裁成方形**解决不了**「每格都看得到猫」——格子不是方形时，方形照片要么留白要么被二次裁切。裁剪的价值在于「让猫脸落在裁剪框正中」。
