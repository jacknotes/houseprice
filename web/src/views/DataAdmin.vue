<template>
  <div>
    <div class="card">
      <h3>数据来源与覆盖范围</h3>
      <table class="src">
        <thead>
          <tr><th>数据集</th><th>来源</th><th>覆盖</th><th>性质</th></tr>
        </thead>
        <tbody>
          <tr>
            <td>城市房价指数（新房 / 二手，环比 / 同比 / 定基）</td>
            <td>国家统计局 · 70个大中城市商品住宅销售价格指数</td>
            <td>北京 / 上海 / 广州 / 深圳 / 31个二线城市 / 35个三线城市，2006-01 起，每月更新</td>
            <td><span class="badge real">官方真实数据</span></td>
          </tr>
          <tr>
            <td>城市挂牌均价（元/㎡）</td>
            <td>安居客 · 城市历史房价页</td>
            <td>深圳（2010-08起）、咸宁（2015-12起，部分月份缺失）；其他城市可自行导入</td>
            <td><span class="badge real">真实数据</span></td>
          </tr>
          <tr>
            <td>小区价格趋势</td>
            <td>① 系统生成（锚定官方指数形态）② 安居客在线抓取（“小区趋势”页）③ 用户导入</td>
            <td>北上广深各10个知名小区 + 咸宁6个；更多小区可在线抓取或导入</td>
            <td><span class="badge sim">模拟示例</span> / <span class="badge real">可100%真实</span></td>
          </tr>
        </tbody>
      </table>
      <div class="note-box" style="margin-top: 12px">
        说明：贝壳 / 链家等平台的小区历史价格需要登录且不对外提供完整序列，无法稳定抓取，因此小区级数据先以“形态真实、价格示意”的模拟数据呈现，并在页面中明确标注。
        若你有真实数据（如中介导出、自己记录），用下面的导入功能即可替换，导入后立即生效并在前端标记为
        <span class="badge user">已导入</span>。
      </div>
    </div>

    <div class="card">
      <h3>数据更新</h3>
      <div class="sub">系统启动时会自动增量刷新（70城指数走 jsDelivr 镜像 etag 条件请求，无更新时仅消耗几百字节；安居客均价尽力抓取）。也可手动触发：</div>
      <div class="form-row">
        <button class="btn" :disabled="refreshing" @click="doRefresh">{{ refreshing ? '刷新中…（约5-40秒）' : '立即刷新数据' }}</button>
        <button class="btn btn-ghost" :disabled="diaging" @click="doDiag">{{ diaging ? '诊断中…' : '网络诊断' }}</button>
        <span v-if="refreshMsg" :style="{ color: refreshOk ? 'var(--down)' : 'var(--up)' }">{{ refreshMsg }}</span>
      </div>
      <table class="src" v-if="diag">
        <thead>
          <tr><th style="width:220px">数据通道</th><th style="width:90px">状态</th><th>说明</th><th style="width:90px">耗时</th></tr>
        </thead>
        <tbody>
          <tr v-for="cItem in diag.checks" :key="cItem.name">
            <td>{{ cItem.name }}</td>
            <td :style="{ color: cItem.ok ? 'var(--down)' : 'var(--up)', fontWeight: 600 }">{{ cItem.ok ? '✓ 可用' : '✗ 不可用' }}</td>
            <td>{{ cItem.note }}（HTTP {{ cItem.status }}）</td>
            <td>{{ cItem.ms }}ms</td>
          </tr>
          <tr>
            <td>代理 / 手动Cookie</td>
            <td colspan="3">{{ diag.proxy }} · {{ diag.manualCookie }}<br />
              <small style="color:var(--muted)">被反爬拦截时的增强手段：设置环境变量 ANJUKE_COOKIE（浏览器登录安居客后复制 Cookie 字符串）或 FETCH_PROXY_URL（http://主机:端口），然后重启服务。</small>
            </td>
          </tr>
        </tbody>
      </table>
      <table class="src" v-if="meta && meta.last_refresh" style="margin-top: 12px">
        <tbody>
          <tr>
            <th style="width: 140px">上次刷新</th>
            <td>
              {{ (meta.last_refresh.startedAt || '').replace('T', ' ').slice(0, 19) }}
              · 70城指数: {{ refreshText(meta.last_refresh.nbs) }}
              · 安居客均价: {{ meta.last_refresh.anjuke ? JSON.stringify(meta.last_refresh.anjuke) : '—' }}
            </td>
          </tr>
        </tbody>
      </table>
    </div>

    <div class="card">
      <h3>导入数据</h3>
      <div class="form-row">
        <div class="form-col">
          <label>数据类型</label>
          <div class="seg">
            <button :class="{ on: kind === 'community' }" @click="kind = 'community'">小区均价</button>
            <button :class="{ on: kind === 'city-level' }" @click="kind = 'city-level'">城市均价</button>
            <button :class="{ on: kind === 'community-detail' }" @click="kind = 'community-detail'">小区详情</button>
          </div>
        </div>
        <div class="form-col">
          <label>城市</label>
          <select v-model="cityCode">
            <option v-for="c in cities" :key="c.code" :value="c.code">{{ c.name }}</option>
          </select>
        </div>
        <template v-if="kind !== 'city-level'">
          <div class="form-col">
            <label>小区名称</label>
            <input type="text" v-model="commName" placeholder="如：半岛城邦" />
          </div>
          <div class="form-col">
            <label>区域（可选）</label>
            <input type="text" v-model="district" placeholder="如：南山" />
          </div>
        </template>
      </div>
      <div class="form-row" v-if="kind === 'community-detail'">
        <div class="form-col"><label>建成年份</label><input type="text" v-model="dField.built_year" placeholder="2005" style="width:90px" /></div>
        <div class="form-col"><label>楼栋数</label><input type="text" v-model="dField.buildings" placeholder="12" style="width:70px" /></div>
        <div class="form-col"><label>总户数</label><input type="text" v-model="dField.households" placeholder="1200" style="width:80px" /></div>
        <div class="form-col"><label>容积率</label><input type="text" v-model="dField.plot_ratio" placeholder="3.2" style="width:70px" /></div>
        <div class="form-col"><label>绿化率%</label><input type="text" v-model="dField.greening_rate" placeholder="35" style="width:70px" /></div>
        <div class="form-col"><label>物业费</label><input type="text" v-model="dField.property_fee" placeholder="2.8元/㎡/月" style="width:110px" /></div>
        <div class="form-col"><label>当前挂牌均价</label><input type="text" v-model="dField.listed_price" placeholder="51000" style="width:90px" /></div>
      </div>
      <div class="form-col" style="margin-bottom: 8px">
        <label>
          {{ kind === 'community-detail' ? '历史均价（可选，每行一条：年月,均价）' : '数据（每行一条：年月,均价，如 2024-05,52000）' }}
          <button class="btn btn-ghost" style="margin-left: 10px; padding: 3px 10px; font-size: 12px" @click="downloadTpl">下载模板</button>
        </label>
        <input type="file" accept=".csv,.txt" @change="onFile" style="margin-top: 4px" />
      </div>
      <textarea v-model="text" :placeholder="kind === 'community-detail' ? '（可选）2024-01,51000\n2024-02,51500…' : '2024-01,51000\n2024-02,51500\n2024-03,51800\n…'"></textarea>
      <div class="form-row" style="margin-top: 12px">
        <button class="btn" :disabled="busy" @click="doImport">{{ busy ? '导入中…' : '导入' }}</button>
        <span v-if="msg" :style="{ color: ok ? 'var(--down)' : 'var(--up)' }">{{ msg }}</span>
      </div>
      <div class="note-box" style="margin-top: 10px">
        导入“小区均价”时若小区名 + 城市已存在则整体替换其序列（推荐导入完整历史）。导入“城市均价”会替换该城市的均价序列。
        导入“小区详情”填写小区的基本信息（从贝壳/安居客 APP 查到后手工录入），配合可选历史均价一次性建立 100% 真实的小区档案。
        导入后请刷新“城市走势 / 小区趋势”页面查看效果。
      </div>
    </div>
  </div>
</template>

<script>
import { api, post } from '../api';

export default {
  data: () => ({
    cities: [],
    kind: 'community',
    cityCode: 'beijing',
    commName: '',
    district: '',
    text: '',
    busy: false,
    ok: false,
    msg: '',
    meta: null,
    refreshing: false,
    refreshOk: false,
    refreshMsg: '',
    diaging: false,
    diag: null,
    dField: { built_year: '', buildings: '', households: '', plot_ratio: '', greening_rate: '', property_fee: '', listed_price: '' },
  }),
  async created() {
    this.cities = await api('/api/cities').catch(() => []);
    this.meta = await api('/api/meta').catch(() => null);
  },
  methods: {
    refreshText(nbs) {
      if (!nbs) return '—';
      if (nbs.status === 'updated') return `已更新（${nbs.detail}）`;
      if (nbs.status === 'not-modified') return '上游无更新';
      return '刷新失败';
    },
    async doRefresh() {
      this.refreshing = true;
      this.refreshMsg = '';
      try {
        const d = await post('/api/refresh', {});
        this.refreshOk = d.nbs && d.nbs.status !== 'failed';
        this.refreshMsg = `完成（耗时 ${(d.costMs / 1000).toFixed(1)}s）：70城指数 ${this.refreshText(d.nbs)}`;
        this.meta = await api('/api/meta').catch(() => this.meta);
      } catch (e) {
        this.refreshOk = false;
        this.refreshMsg = '刷新失败：' + e.message;
      } finally {
        this.refreshing = false;
      }
    },
    async doDiag() {
      this.diaging = true;
      try {
        this.diag = await api('/api/diag/network');
      } catch (e) {
        this.diag = null;
        this.refreshOk = false;
        this.refreshMsg = '诊断失败：' + e.message;
      } finally {
        this.diaging = false;
      }
    },
    onFile(e) {
      const f = e.target.files && e.target.files[0];
      if (!f) return;
      const reader = new FileReader();
      reader.onload = () => (this.text = String(reader.result || ''));
      reader.readAsText(f, 'utf-8');
    },
    downloadTpl() {
      const rows = this.kind === 'community'
        ? ['年月,均价', '2024-01,51000', '2024-02,51500', '2024-03,51800']
        : ['年月,均价', '2024-01,3961', '2024-02,3990', '2024-03,4020'];
      const blob = new Blob(['\ufeff' + rows.join('\n')], { type: 'text/csv;charset=utf-8' });
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = this.kind === 'community' ? '小区均价导入模板.csv' : '城市均价导入模板.csv';
      a.click();
      URL.revokeObjectURL(a.href);
    },
    async doImport() {
      this.busy = true;
      this.msg = '';
      try {
        if (this.kind === 'community-detail') {
          const body = { city: this.cityCode, name: this.commName, district: this.district, ...this.dField, text: this.text };
          const d = await post('/api/import/community-detail', body);
          this.ok = true;
          this.msg = `导入成功：小区「${this.commName}」详情已保存${d.historyRows >= 2 ? `，历史均价 ${d.historyRows} 条` : '（未提供历史均价）'}`;
        } else {
          const body = this.kind === 'community'
            ? { kind: this.kind, city: this.cityCode, name: this.commName, district: this.district, text: this.text, replace: true }
            : { city: this.cityCode, text: this.text };
          const url = this.kind === 'community' ? '/api/import/community' : '/api/import/city-level';
          const d = await post(url, body);
          this.ok = true;
          this.msg = `导入成功：${d.rows} 条（${d.range[0]} ~ ${d.range[1]}）${d.id ? '，小区ID=' + d.id : ''}`;
        }
      } catch (e) {
        this.ok = false;
        this.msg = '导入失败：' + e.message;
      } finally {
        this.busy = false;
      }
    },
  },
};
</script>
