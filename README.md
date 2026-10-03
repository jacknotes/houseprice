# 房价走势 · 中国城市房价历史查询系统

一个本地运行的 Web 系统，用于查看中国城市与小区的房价历史真实走势：

- **全国总览**：一线 / 二线城市房价指数（定基）、70 城最新月涨跌榜
- **城市走势**：北京、上海、广州、深圳、咸宁等 71 个城市，多选对比；新房 / 二手切换；定基指数、月度环比、月度同比；挂牌均价（元/㎡）真实序列
- **小区趋势**：热门小区价格趋势、近 3 月 / 12 月变动、涨跌幅榜；支持搜索；支持在线抓取安居客小区真实详情或导入真实数据
- **数据管理**：数据来源说明、数据自动/手动刷新、CSV 导入（小区均价 / 城市均价 / 小区详情）
- 所有图表悬停即显示 **年月 + 数值** 提示框

## 快速开始

```bash
npm install        # 首次安装依赖
npm run seed       # 初始化 SQLite 数据库（data/app.db）
npm run build      # 构建前端到 dist/
npm start          # 启动服务，默认 http://localhost:3000
```

打开浏览器访问 **http://localhost:3000** 即可。

**数据管理（导入/刷新/抓取）在登录后可用**：右上角"登录" → 默认密码 `admin123`（可用环境变量 `ADMIN_PASSWORD` 修改）。默认导航仅展示总览/城市/小区三个页面。

> 开发模式（前端热更新）：先 `npm start` 启动后端，再开一个终端跑 `npm run dev:web`，访问 http://localhost:5173。

## Docker 部署（云端）

```bash
docker compose up -d --build      # 构建并启动，访问 http://<主机>:3000
docker compose logs -f            # 查看启动时的数据刷新日志
```

- 数据持久化在命名卷 `houseprice-data`（/app/data），重启容器不丢导入数据
- 环境变量 `REFRESH_ON_START=0` 可关闭启动时的自动刷新
- 换端口：修改 compose 里 ports 为 `"8080:3000"` 即可
- 镜像为多阶段构建（node:22-alpine），最终镜像不含 node_modules 全量与构建工具

## 启动时自动更新数据（成本说明）

服务启动后 2 秒自动执行一次增量刷新（`REFRESH_ON_START=0` 可关闭，"数据管理"页可手动触发）：

| 数据 | 方式 | 无更新时成本 | 有新数据时成本 |
|---|---|---|---|
| 70城官方指数 | jsDelivr 镜像 **etag 条件请求**，无更新则 304 | 1 个请求，约几百字节 | 下载 ~5MB CSV，解析入库约 1-2 秒（每月约一次） |
| 安居客城市均价（深圳/咸宁） | 直接抓取历史房价页 | ~100KB×2，可能被反爬拦截（失败不影响系统） | 同左，成功即更新 |

刷新结果记录在数据库 meta 表，"数据管理"页可见上次刷新时间与结果。

## 反爬应对机制

抓取层（`server/http-client.js`）内置：

- **真实浏览器指纹**：完整 Chrome 请求头（sec-ch-ua / sec-fetch-* 等），而非裸 UA
- **Cookie 会话保持**：先访问站点主页"暖场"收集 Cookie，再请求数据页（反爬网关通常校验 Cookie 链路）
- **失败重试退避**：指数退避 + 随机抖动，网络抖动窗口内自动恢复
- **多路径尝试**：小区抓取依次尝试 xiaoqu 子域 → m 站 → fang 子域

"数据管理"页的**网络诊断**按钮可实测当前机器各数据通道的可达性。

环境变量（可选增强手段）：

| 变量 | 作用 |
|---|---|
| `REFRESH_ON_START=0` | 关闭启动时的自动刷新 |
| `ANJUKE_COOKIE=<字符串>` | 浏览器登录安居客后复制 Cookie 粘贴到这里，抓取时附带，可显著提高通过率 |
| `FETCH_PROXY_URL=http://主机:端口` | 抓取走 HTTP 代理（CONNECT 隧道），机房部署时建议配置 |

说明：本系统仅低频抓取公开页面的房价数据用于个人查看（每次启动 2-4 个请求）；即便如此，数据中心 IP 仍可能被目标站拦截——表现为"上次刷新"里如实记录的 blocked-or-empty，不影响已有数据，重试或换网络环境即可恢复。

## 数据来源与真实性说明

| 数据集 | 来源 | 覆盖 | 性质 |
|---|---|---|---|
| 城市房价指数（新房/二手，环比/同比/定基） | 国家统计局《70个大中城市商品住宅销售价格指数》 | 70 城（含北上广深 + 31 二线 + 35 三线），2006-01 至今 | **官方真实数据** |
| 城市挂牌均价（元/㎡） | 安居客·城市历史房价页 | 深圳（2010-08 起）、咸宁（2015-12 起，部分月份缺失）；其他城市可自行导入 | **真实数据** |
| 小区价格趋势 | ① 系统生成（锚定官方指数形态）② 安居客在线抓取 ③ 用户导入 | 北上广深各10个知名小区 + 咸宁6个；更多小区可在线抓取或导入 | 模拟示例 / **可100%真实** |

### 小区数据如何达到 100% 真实

小区级历史均价序列没有任何公开数据源（贝壳/链家需登录且不提供完整历史），系统提供三条路径：

1. **导入（推荐，100% 真实）**：在"数据管理"页导入小区详情（建成年份、楼栋、户数、容积率、绿化率、物业费、当前挂牌均价）+ 可选历史均价 CSV。字段全部原样存储展示。
2. **在线抓取（尽力而为）**：在"小区趋势"页输入小区名点击"抓取"，服务端尝试从安居客获取小区详情与当前挂牌均价，历史走势按官方指数形态推算（页面会标注哪些字段真实）。**受反爬限制，取决于部署机器的网络环境**；本机 IP 通常比服务器机房 IP 成功率高。
3. **手动录入**：从贝壳/安居客 APP 查询后手工录入，同样 100% 真实。

## 导入真实数据（CSV）

在"数据管理"页：

1. 选择数据类型（小区均价 / 城市均价 / 小区详情）与城市，小区类型需填小区名称、区域
2. 粘贴或选择 CSV 文件，每行一条：`年月,均价`，例如：

```
2024-01,51000
2024-02,51500
2024-03,51800
```

3. 点击导入。导入"小区均价"时若同名小区已存在会**整体替换**其序列；页面中该小区随即标记为"已导入"（绿色徽章），与模拟数据的黄色徽章区分。

也可调用 API：

```bash
curl -X POST http://localhost:3000/api/import/community \
  -H "Content-Type: application/json" \
  -d '{"city":"shenzhen","name":"半岛城邦","district":"南山","text":"2024-01,108000\n2024-02,108500"}'
```

## 更新数据

- **70 城指数**：启动时自动更新（见上）。也可手动更新 `data/raw/70cityprice.csv`（来源 [hugohe3/70cityprice](https://github.com/hugohe3/70cityprice)）后运行 `node scripts/transform-nbs.js && npm run seed`。
- **安居客均价**：`npm run fetch:anjuke` 或启动时自动刷新。若本机 IP 被反爬拦截，可在浏览器打开对应页面另存 HTML 到 `data/raw/anjuke_<城市>.html`，再跑 `node scripts/parse-anjuke-table.js <城市>` 与 `npm run seed`。

## 目录结构

```
├── server/            # Express 后端 + SQLite（node:sqlite，无需安装数据库）
│   ├── index.js       # REST API + 静态托管 + 导入/抓取接口
│   ├── refresh.js     # 启动/手动增量刷新（etag 条件请求 + 安居客抓取）
│   ├── xiaoqu-fetch.js# 小区真实详情抓取（多路径尝试 + 反爬识别）
│   ├── parsers.js     # 70城CSV / 安居客表格解析
│   ├── seed.js        # 建库 + 灌入种子数据
│   └── city-meta.js   # 71 城元数据（拼音/省份/线级）
├── web/               # Vue3 + Vite + ECharts 前端
│   └── src/views/     # 四个页面：Overview / CityTrend / Community / DataAdmin
├── scripts/           # 数据管线：下载、解析、转换、种子构建
├── data/
│   ├── raw/           # 原始抓取数据（70城CSV、安居客页面/JSON）
│   ├── processed/     # 转换后的种子 JSON
│   └── app.db         # SQLite 数据库（seed 生成）
├── dist/              # 前端构建产物
├── Dockerfile         # 多阶段构建（node:22-alpine）
└── docker-compose.yml # 数据卷 + 端口 + REFRESH_ON_START
```

## API 一览

| 接口 | 说明 |
|---|---|
| `GET /api/meta` | 数据库元信息（最新月份、上次刷新结果） |
| `GET /api/cities` | 城市列表（含线级、小区数量、是否有均价） |
| `GET /api/series/cities?codes=beijing,shanghai&metric=sec_idx` | 多城市序列（metric: new_idx/new_mom/new_yoy/sec_idx/sec_mom/sec_yoy） |
| `GET /api/series/aggregate?tier=一线&metric=all` | 一线 / 二线等权合成序列 |
| `GET /api/city/:code` | 城市详情（指数 + 均价 + 小区简表） |
| `GET /api/communities?city=shenzhen&keyword=` | 小区搜索 |
| `GET /api/community/:id` | 小区详情（序列 + 峰值 / 近3月 / 近12月统计 + 小区信息字段） |
| `GET /api/hot?city=shenzhen` | 近 3 月涨跌幅榜 |
| `POST /api/refresh` | 手动触发增量刷新 |
| `POST /api/import/community`、`/city-level`、`/community-detail` | CSV / 详情导入 |
| `POST /api/community/fetch-real` | 在线抓取安居客小区真实详情 |

## 技术栈

Node.js ≥ 22（内置 `node:sqlite`）· Express 4 · Vue 3 · Vue Router 4 · ECharts 5（自实现悬停提示）· Vite 5 · Docker
