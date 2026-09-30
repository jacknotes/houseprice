<template>
  <div>
    <div class="warn-box" v-if="!activeComm">
      小区级历史价格为<b>模拟示例数据</b>：曲线形态锚定所在城市的官方指数 / 真实均价走势，绝对价格仅供参考。
      获取 100% 真实数据的两条路径：① 下方“添加真实小区”在线抓取安居客（视网络环境）；②
      在“数据管理”页导入小区真实数据（导入后标记为 <span class="badge user">已导入</span>）。
    </div>

    <div class="grid-2">
      <div>
        <div class="card">
          <h3>选择城市</h3>
          <div class="toolbar">
            <select v-model="cityCode" @change="loadCity">
              <option v-for="c in cities.filter((x) => x.communityCount > 0 || x.featured)" :key="c.code" :value="c.code">
                {{ c.name }}（{{ c.communityCount }}个小区）
              </option>
            </select>
            <input type="text" v-model="kw" placeholder="搜索小区 / 区域…" style="flex: 1; min-width: 130px" />
          </div>
          <div class="comm-list" v-if="filtered.length">
            <div
              v-for="cm in filtered" :key="cm.id" class="comm-item"
              :class="{ on: activeId === cm.id }" @click="select(cm.id)"
            >
              <div>
                <div class="name">{{ cm.name }} <span class="badge" :class="badgeCls(cm.source).cls">{{ badgeCls(cm.source).text }}</span></div>
                <div class="meta">{{ cm.cityName }} · {{ cm.district || '—' }} · {{ cm.points }}个月</div>
              </div>
              <div class="price">
                <div><b>{{ price(cm.latest) }}</b></div>
                <div class="meta">{{ cm.latestMonth }}</div>
              </div>
            </div>
          </div>
          <div class="loading" v-else>该城市暂无小区数据</div>
        </div>

        <div class="card">
          <h3>添加真实小区（安居客在线抓取）</h3>
          <div class="sub">输入小区名，系统尝试从安居客获取详情（建成年份、楼栋、户数、容积率、绿化率、物业费）与当前挂牌均价；历史走势按官方指数形态推算</div>
          <div class="toolbar">
            <input type="text" v-model="fetchKw" placeholder="如：华清嘉园 / 半岛城邦" style="flex: 1; min-width: 150px" @keyup.enter="doFetch" />
            <button class="btn" :disabled="fetching" @click="doFetch">{{ fetching ? '抓取中…' : '抓取' }}</button>
          </div>
          <div class="note-box" style="margin: 0" v-if="fetchMsg" :style="fetchOk ? '' : 'background:#fef2f2;border-color:#fecaca;color:#b91c1c'">{{ fetchMsg }}</div>
        </div>

        <div class="card">
          <h3>热门小区榜 · 近3月变动</h3>
          <div class="sub">基于小区价格序列计算（模拟数据时仅供参考），点击查看趋势</div>
          <div class="hot-cols" v-if="hot">
            <div>
              <div style="color: var(--up); font-weight: 600; margin-bottom: 4px">▲ 涨幅榜</div>
              <ul class="hot-list" v-if="hot.risers.length">
                <li v-for="cm in hot.risers" :key="cm.id" @click="select(cm.id)">
                  <span>{{ cm.name }} <small style="color:var(--muted)">{{ cm.district }}</small></span>
                  <b class="up">+{{ cm.mom3 }}%</b>
                </li>
              </ul>
              <div class="loading" v-else style="padding: 12px 0">近3月无上涨小区</div>
            </div>
            <div>
              <div style="color: var(--down); font-weight: 600; margin-bottom: 4px">▼ 跌幅榜</div>
              <ul class="hot-list" v-if="hot.fallers.length">
                <li v-for="cm in hot.fallers" :key="cm.id" @click="select(cm.id)">
                  <span>{{ cm.name }} <small style="color:var(--muted)">{{ cm.district }}</small></span>
                  <b class="down">{{ cm.mom3 }}%</b>
                </li>
              </ul>
              <div class="loading" v-else style="padding: 12px 0">近3月无下跌小区</div>
            </div>
          </div>
          <div class="loading" v-else>加载中…</div>
        </div>
      </div>

      <div class="card" v-if="detail">
        <h3>
          {{ detail.name }}
          <span class="badge" :class="badgeCls(detail.source).cls">{{ badgeCls(detail.source).text }}</span>
          <small style="color: var(--muted); font-weight: 400"> · {{ detail.cityName }}{{ detail.district ? ' · ' + detail.district : '' }}</small>
        </h3>
        <div class="sub" v-if="detail.source !== 'user'">{{ detail.note }}</div>
        <div class="stat-row">
          <div class="stat-cell"><div class="l">最新均价（{{ detail.stats.latestMonth }}）</div><div class="v">{{ price(detail.stats.latest) }}</div></div>
          <div class="stat-cell"><div class="l">历史峰值（{{ detail.stats.peakMonth }}）</div><div class="v">{{ price(detail.stats.peak) }}</div></div>
          <div class="stat-cell"><div class="l">较峰值</div><div class="v down">{{ detail.stats.dropFromPeak }}%</div></div>
          <div class="stat-cell"><div class="l">近3月</div><div class="v" :class="detail.stats.mom3 >= 0 ? 'up' : 'down'">{{ detail.stats.mom3 > 0 ? '+' : '' }}{{ detail.stats.mom3 }}%</div></div>
          <div class="stat-cell"><div class="l">近12月</div><div class="v" :class="detail.stats.mom12 >= 0 ? 'up' : 'down'">{{ detail.stats.mom12 > 0 ? '+' : '' }}{{ detail.stats.mom12 }}%</div></div>
        </div>
        <div class="stat-row" v-if="hasDetailFields">
          <div class="stat-cell" v-if="detail.built_year"><div class="l">建成年份</div><div class="v">{{ detail.built_year }}年 <span class="badge real">真实</span></div></div>
          <div class="stat-cell" v-if="detail.buildings"><div class="l">楼栋数</div><div class="v">{{ detail.buildings }} 栋</div></div>
          <div class="stat-cell" v-if="detail.households"><div class="l">总户数</div><div class="v">{{ detail.households }} 户</div></div>
          <div class="stat-cell" v-if="detail.plot_ratio"><div class="l">容积率</div><div class="v">{{ detail.plot_ratio }}</div></div>
          <div class="stat-cell" v-if="detail.greening_rate"><div class="l">绿化率</div><div class="v">{{ detail.greening_rate }}%</div></div>
          <div class="stat-cell" v-if="detail.property_fee"><div class="l">物业费</div><div class="v" style="font-size:13px">{{ detail.property_fee }}</div></div>
          <div class="stat-cell" v-if="detail.listed_price"><div class="l">当前挂牌均价（{{ detail.listed_month }}）</div><div class="v">{{ price(detail.listed_price) }} <span class="badge real">真实</span></div></div>
        </div>
        <div style="margin-bottom: 8px" v-if="detail.anjuke_url">
          <a :href="detail.anjuke_url" target="_blank" rel="noopener">在安居客查看该小区 →</a>
        </div>
        <VChart :option="detailOption" height="400px" tip-unit="price" />
      </div>
      <div class="card" v-else>
        <div class="loading">← 从左侧选择一个小区查看价格趋势</div>
      </div>
    </div>
  </div>
</template>

<script>
import VChart from '../components/VChart.vue';
import { api, post } from '../api';

export default {
  components: { VChart },
  data: () => ({
    cities: [],
    cityCode: 'beijing',
    kw: '',
    list: [],
    hot: null,
    activeId: null,
    detail: null,
    fetchKw: '',
    fetching: false,
    fetchMsg: '',
    fetchOk: false,
  }),
  computed: {
    filtered() {
      const k = this.kw.trim();
      if (!k) return this.list;
      return this.list.filter((c) => c.name.includes(k) || (c.district || '').includes(k));
    },
    activeComm() { return this.detail; },
    hasDetailFields() {
      const d = this.detail;
      return d && ['built_year', 'buildings', 'households', 'plot_ratio', 'greening_rate', 'property_fee', 'listed_price'].some((k) => d[k] != null);
    },
    detailOption() {
      if (!this.detail) return {};
      const d = this.detail;
      const color = d.source === 'user' ? '#0a9e63' : '#2456e6';
      return {
        grid: { left: 70, right: 20, top: 20, bottom: 46 },
        xAxis: { type: 'time' },
        yAxis: {
          type: 'value', scale: true,
          axisLabel: { formatter: (v) => (v >= 10000 ? v / 10000 + '万' : v) },
        },
        dataZoom: [{ type: 'slider', height: 20, bottom: 8 }, { type: 'inside' }],
        series: [{
          name: '均价', type: 'line', showSymbol: false, connectNulls: true,
          data: d.months.map((m, i) => [m, d.prices[i]]),
          lineStyle: { width: 2.5, color }, itemStyle: { color },
          areaStyle: { color: d.source === 'user' ? 'rgba(10, 158, 99, .08)' : 'rgba(36, 86, 230, .08)' },
        }],
      };
    },
  },
  async created() {
    this.cities = await api('/api/cities').catch(() => []);
    await this.loadCity();
  },
  methods: {
    price(v) {
      if (v == null) return '—';
      return v >= 10000 ? (v / 10000).toFixed(2) + '万/㎡' : v + ' 元';
    },
    badgeCls(source) {
      if (source === 'user') return { cls: 'user', text: '已导入' };
      if (source === 'anjuke-real') return { cls: 'real', text: '真实详情' };
      return { cls: 'sim', text: '示例' };
    },
    async doFetch() {
      const kw = this.fetchKw.trim();
      if (!kw) return;
      this.fetching = true;
      this.fetchMsg = '';
      try {
        const d = await post('/api/community/fetch-real', { city: this.cityCode, keyword: kw });
        this.fetchOk = true;
        const f = d.fields;
        const got = ['built_year', 'buildings', 'households', 'plot_ratio', 'greening_rate', 'property_fee', 'listed_price'].filter((k) => f[k] != null);
        this.fetchMsg = `已加入「${d.name}」，真实字段：${got.length} 项${f.listed_price ? '（含挂牌均价 ' + f.listed_price + ' 元/㎡）' : ''}；历史走势按官方指数形态推算`;
        await this.loadCity();
        await this.select(d.id);
      } catch (e) {
        this.fetchOk = false;
        this.fetchMsg = e.message + '。建议改用“数据管理”页手动导入，可达到 100% 真实。';
      } finally {
        this.fetching = false;
      }
    },
    async loadCity() {
      this.list = await api(`/api/communities?city=${this.cityCode}`).catch(() => []);
      this.hot = await api(`/api/hot?city=${this.cityCode}`).catch(() => null);
      this.activeId = null;
      this.detail = null;
      if (this.list.length) await this.select(this.list[0].id);
    },
    async select(id) {
      this.activeId = id;
      this.detail = await api('/api/community/' + id).catch(() => null);
    },
  },
};
</script>
