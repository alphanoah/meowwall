# 猫咪头像墙 · 项目长期约定

## 版本控制（2026-09-23 用户明确要求）
- **每完成一次改动，自动执行一次 git 提交**，提交信息写清改了什么（做了什么、为什么、影响哪些文件/功能）。
- 仓库：`/Users/alpha/Downloads/catsmap`，分支 `main`，首次提交 `80a9593`。
- 提交前先 `node --check app.js` 确认语法无误；改动涉及渲染/界面时，先截图自测再提交。
- 一次改动 = 一个提交，不把多个不相关改动混在一起。
- 不擅自 push（当前无远端）；用户给了远端地址再推。
- 提交信息结尾注明「已验证」的方式（如 headless 截图 / node 校验）。

## 技术约定
- 纯前端零依赖：`index.html` + `style.css` + `app.js`，无构建步骤。
- 本地预览：`cd /Users/alpha/Downloads/catsmap && /Users/alpha/.workbuddy/binaries/python/versions/3.13.12/bin/python3 -m http.server 8848`
  - **固定用 8848 端口**：照片存在浏览器 IndexedDB，数据绑定「源地址」，换端口 = 换一个空库。
- 照片存储：IndexedDB 库 `catsmap` / 表 `photos`（主键 id，字段 name/date/place/note/blob/thumb/w/h/createdAt）。
- 常用路径：node = `/Users/alpha/.workbuddy/binaries/node/versions/22.22.2-3/bin/node`；Chrome = `/Applications/Google Chrome.app/Contents/MacOS/Google Chrome`

## 验证套路的坑（踩过）
- 用 headless Chrome **截图**验证，别用 `--dump-dom`（virtual-time 不可靠）。
- 测试页注入脚本必须**同步执行**；用 `setTimeout` 会让 virtual-time 截图挂死。
- 调试值时把信息画到页面上（固定定位的 div）再截图，比读 title/console 可靠。

## 已确认的产品口径
- 统计四项：照片 / 猫咪 / 客户 / 最近探访。`合照(x)` 不算猫；未命名照片合计算 1 只「未命名猫」、每张各算 1 位客户；有名字无编号的合并算 1 位客户。
- 文件名规则：`客户id-猫咪名称-地址`（地址可省略、可含 `-`），`all` → `合照(id)`；自动填入后仍可手改。
- 排列方式：2026-09-23 用户要求**回退**为「按照片数均分」（默认）＋「几 × 几 铺满」，此前的「正方格平铺」方案已撤销，不要再擅自改回。
- 单张照片：均分模式下整头完整放入（不裁切）+ 米色留白。
