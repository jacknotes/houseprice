<template>
  <div>
    <div class="card">
      <h3>选择城市（可多选对比，最多8个）</h3>
      <div class="toolbar">
        <div class="seg">
          <button v-for="t in tierTabs" :key="t.v" :class="{ on: tierTab === t.v }" @click="tierTab = t.v">{{ t.label }}</button>
        </div>
        <input type="text" v-model="kw" placeholder="搜索城市名…" style="width: 160px" />
        <button class="btn btn-ghost" @click="clearSel">清空</button>
      </div>
      <div class="chips">
        <span
          v-for="c in visibleCities" :key="c.code" class="chip"
          :class="{ on: selected.includes(c.code) }" @click="toggle(c.code)"
        >
          <span v-if="c.featured" class="star">★</span>{{ c.name }}<small v-if="c.featured && c.tier === '一线'" style="opacity:.7"> · 一线</small><small v-else-if="c.featured && c.code === 'xianning'" style="opacity:.7"> · 咸宁</small>
        </span>
      </div>
    </div>

    <template v-if="single">
      <div class="card" v-if="detail && detail.index.months.length">
        <h3>{{ detail.city.name }} 房价指数（定基，2006-01=100）</h3>
        <div class="sub">国家统计局70城官方环比数据链式合成 · 二手住宅指数自2006年起，虚线为新房指数</div>
        <VChart :option="singleIdxOption" tip-unit="idx" />
        <div class="stat-row">
          <div class="stat-cell"><div class="l">最新月二手环比</div><div class="v" :class="momCls(last(detail, 'secMom'))">{{ pct(last(detail, 'secMom')) }}</div></div>
          <div class="stat-cell"><div class="l">最新月二手同比</div><div class="v" :class="momCls(last(detail, 'secYoy'))">{{ pct(last(detail, 'secYoy')) }}</div></div>
          <div class="stat-cell"><div class="l">二手指数峰值月</div><div class="v">{{ peakInfo.month || '—' }}</div></div>
          <div class="stat-cell"><div class="l">较峰值累计</div><div class="v down">{{ peakInfo.drop }}</div></div>
        </div>
      </div>
      <div class="note-box" v-if="detail && !detail.index.months.length">
        {{ detail.city.name }}不在国家统计局70城名单中，无官方指数；下方为其真实挂牌均价走势。
      </div>
      <div class="card" v-if="detail && detail.index.months.length">
        <h3>月度环比（近5年）</h3>
        <div class="sub">上月=100，柱状为涨跌幅。红涨绿跌。</div>
        <VChart :option="momOption" tip-unit="pct" />
      </div>
      <div class="card" v-if="detail && detail.index.months.length">
        <h3>月度同比（近5年）</h3>
        <div class="sub">上年同月=100。红涨绿跌。</div>
        <VChart :option="yoyOption" tip-unit="pct" />
      </div>
      <div class="card" v-if="detail && detail.level.length">
        <h3>{{ detail.city.name }} 挂牌均价（元/㎡）</h3>
        <div class="sub">
          真实数据来源：安居客历史房价页
          <span class="badge real">真实数据</span>
          （部分月份平台未发布则留空）
        </div>
        <VChart :option="levelOption" tip-unit="price" />
      </div>
      <div class="note-box" v-if="detail && !detail.level.length && detail.index.months.length">
        该城市暂无挂牌均价序列（非重点覆盖城市）。70城官方指数走势已完整覆盖；如需均价数据，可在“数据管理”页导入。
      </div>
    </template>

    <div class="card" v-else-if="multi && multi.length">
      <h3>城市指数对比（定基）</h3>
      <div class="sub">
        <div class="seg" style="display:inline-flex; margin-right:10px">
          <button :class="{ on: metric === 'sec_idx' }" @click="metric = 'sec_idx'">二手住宅</button>
          <button :class="{ on: metric === 'new_idx' }" @click="metric = 'new_idx'">新建商品住宅</button>
        </div>
        指数为官方环比链式合成，基期2006-01=100；咸宁不在70城名单，无官方指数。
      </div>
      <VChart v-if="multiOption" :option="multiOption" height="480px" tip-unit="idx" />
      <div class="loading" v-else>加载中…</div>
    </div>

    <div class="card" v-else>
      <div class="loading">请选择至少一个城市</div>
    </div>
  </div>
</template>

<script>
import VChart from '../components/VChart.vue';
import { api, fmtPrice } from '../api';

const COLORS = ['#e0342f', '#2456e6', '#0a9e63', '#d97706', '#7c3aed', '#0891b2', '#db2777', '#65a30d'];

export default {
  components: { VChart },
  data: () => ({
    cities: [],
    tierTab: 'featured',
    kw: '',
    selected: ['beijing', 'shanghai', 'guangzhou', 'shenzhen'],
    metric: 'sec_idx',
    detail: null,
    multiData: null,
  }),
  computed: {
    tierTabs() {
      return [
        { v: 'featured', label: '重点城市' },
        { v: '一线', label: '一线' },
        { v: '二线', label: '二线' },
        { v: '三线', label: '三线' },
        { v: 'all', label: '全部' },
      ];
    },
    visibleCities() {
      let list = this.cities;
      if (this.tierTab === 'featured') list = list.filter((c) => c.featured || c.tier === '一线');
      else if (this.tierTab !== 'all') list = list.filter((c) => c.tier === this.tierTab);
      if (this.kw.trim()) list = list.filter((c) => c.name.includes(this.kw.trim()));
      return list;
    },
    single() { return this.selected.length === 1; },
    multi() { return this.selected.length > 1 ? this.selected : null; },
    peakInfo() {
      if (!this.detail) return {};
      const a = this.detail.index.secIdx;
      let mi = -1, mv = 0;
      a.forEach((v, i) => { if (v != null && v > mv) { mv = v; mi = i; } });
      const months = this.detail.index.months;
      const lastV = a[a.length - 1];
      return {
        month: mi >= 0 ? months[mi] : null,
        drop: mv && lastV ? (((lastV / mv) - 1) * 100).toFixed(1) + '%' : '—',
      };
    },
    singleIdxOption() {
      if (!this.detail) return {};
      const d = this.detail.index;
      const line = (data, name, color, dash) => ({
        name, type: 'line', showSymbol: false, data,
        lineStyle: { width: 2, color, type: dash ? 'dashed' : 'solid' }, itemStyle: { color },
      });
      return {
        legend: { top: 0 },
        grid: { left: 50, right: 20, top: 34, bottom: 64 },
        xAxis: { type: 'time' },
        yAxis: { type: 'value', scale: true },
        dataZoom: [{ type: 'slider', height: 20, bottom: 10 }, { type: 'inside' }],
        series: [
          line(d.months.map((m, i) => [m, d.secIdx[i]]), '二手住宅', '#e0342f'),
          line(d.months.map((m, i) => [m, d.newIdx[i]]), '新建商品住宅', '#2456e6', true),
        ],
      };
    },
    momOption() {
      if (!this.detail) return {};
      const d = this.detail.index;
      const cutoff = d.months[Math.max(0, d.months.length - 60)];
      const pts = d.months.map((m, i) => [m, d.secMom[i] == null ? null : +(d.secMom[i] - 100).toFixed(2)])
        .filter((p) => p[0] >= cutoff && p[1] != null);
      return {
        grid: { left: 50, right: 20, top: 20, bottom: 46 },
        xAxis: { type: 'time' },
        yAxis: { type: 'value', axisLabel: { formatter: (v) => v + '%' } },
        series: [{
          type: 'bar', data: pts,
          itemStyle: { color: (p) => (p.value[1] >= 0 ? '#e0342f' : '#0a9e63'), borderRadius: 2 },
          barMaxWidth: 14, name: '二手环比',
        }],
      };
    },
    yoyOption() {
      if (!this.detail) return {};
      const d = this.detail.index;
      const cutoff = d.months[Math.max(0, d.months.length - 60)];
      const mk = (key, name) => ({
        name, type: 'bar', barMaxWidth: 14,
        data: d.months.map((m, i) => [m, d[key][i] == null ? null : +(d[key][i] - 100).toFixed(2)])
          .filter((p) => p[0] >= cutoff && p[1] != null),
        itemStyle: { color: (p) => (p.value[1] >= 0 ? '#e0342f' : '#0a9e63'), borderRadius: 2 },
      });
      return {
        legend: { top: 0 },
        grid: { left: 50, right: 20, top: 34, bottom: 46 },
        xAxis: { type: 'time' },
        yAxis: { type: 'value', axisLabel: { formatter: (v) => v + '%' } },
        series: [mk('secYoy', '二手住宅'), mk('newYoy', '新建商品住宅')],
      };
    },
    levelOption() {
      if (!this.detail || !this.detail.level.length) return {};
      const lv = this.detail.level;
      return {
        grid: { left: 70, right: 20, top: 20, bottom: 46 },
        xAxis: { type: 'time' },
        yAxis: { type: 'value', scale: true, axisLabel: { formatter: (v) => (v >= 10000 ? v / 10000 + '万' : v) } },
        dataZoom: [{ type: 'slider', height: 20, bottom: 8 }, { type: 'inside' }],
        series: [{
          name: '挂牌均价', type: 'line', showSymbol: true, symbolSize: 5, connectNulls: true,
          data: lv.map((r) => [r.month, r.price]),
          lineStyle: { width: 2.5, color: '#d97706' }, itemStyle: { color: '#d97706' },
          areaStyle: { color: 'rgba(217, 119, 6, .08)' },
        }],
      };
    },
    multiOption() {
      if (!this.multi || !this.multiData) return null;
      const d = this.multiData.cities;
      return {
        color: COLORS,
        legend: { top: 0 },
        grid: { left: 50, right: 20, top: 34, bottom: 64 },
        xAxis: { type: 'time' },
        yAxis: { type: 'value', scale: true },
        dataZoom: [{ type: 'slider', height: 20, bottom: 10 }, { type: 'inside' }],
        series: Object.entries(d).map(([code, s], i) => ({
          name: s.name, type: 'line', showSymbol: false,
          data: s.months.map((m, j) => [m, s.values[j]]),
          lineStyle: { width: 2 },
        })),
      };
    },
  },
  watch: {
    async selected() {
      if (this.selected.length === 1) await this.loadSingle();
      else if (this.selected.length > 1) await this.loadMulti();
      else this.detail = null;
    },
    async metric() { if (this.selected.length > 1) await this.loadMulti(); },
  },
  async created() {
    this.cities = await api('/api/cities').catch(() => []);
    const q = this.$route.query.codes;
    if (q) {
      const codes = String(q).split(',').filter((c) => this.cities.some((x) => x.code === c));
      if (codes.length) this.selected = codes.slice(0, 8);
    }
    if (this.selected.length === 1) await this.loadSingle();
    else if (this.selected.length > 1) await this.loadMulti();
  },
  methods: {
    fmtPrice,
    toggle(code) {
      if (this.selected.includes(code)) {
        this.selected = this.selected.filter((c) => c !== code);
      } else {
        const next = [...this.selected, code];
        if (next.length > 8) next.shift();
        this.selected = next;
      }
    },
    clearSel() { this.selected = []; },
    async loadSingle() {
      this.detail = await api('/api/city/' + this.selected[0]).catch(() => null);
    },
    async loadMulti() {
      this.multiData = await api(`/api/series/cities?codes=${this.selected.join(',')}&metric=${this.metric}`).catch(() => null);
    },
    last(detail, key) {
      const a = detail.index[key];
      return a && a.length ? a[a.length - 1] : null;
    },
    pct(v) { return v == null ? '—' : (v - 100 > 0 ? '+' : '') + (v - 100).toFixed(2) + '%'; },
    momCls(v) { return v == null ? '' : v - 100 >= 0 ? 'up' : 'down'; },
  },
};
</script>
