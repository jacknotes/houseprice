<template>
  <div>
    <div class="kpis" v-if="meta">
      <div class="kpi">
        <div class="label">一线城市二手房价 · 环比（{{ meta.latestMonth }}）</div>
        <div class="value" :class="kpiCls(v(agg1, 'sec_mom'))">{{ fmtAgg(agg1, 'sec_mom') }}</div>
        <div class="hint">新房环比 {{ fmtAgg(agg1, 'new_mom') }}</div>
      </div>
      <div class="kpi">
        <div class="label">一线城市二手房价 · 同比</div>
        <div class="value" :class="kpiCls(v(agg1, 'sec_yoy'))">{{ fmtAgg(agg1, 'sec_yoy') }}</div>
        <div class="hint">新房同比 {{ fmtAgg(agg1, 'new_yoy') }}</div>
      </div>
      <div class="kpi">
        <div class="label">二线城市二手房价 · 环比</div>
        <div class="value" :class="kpiCls(v(agg2, 'sec_mom'))">{{ fmtAgg(agg2, 'sec_mom') }}</div>
        <div class="hint">新房环比 {{ fmtAgg(agg2, 'new_mom') }}</div>
      </div>
      <div class="kpi">
        <div class="label">二线城市二手房价 · 同比</div>
        <div class="value" :class="kpiCls(v(agg2, 'sec_yoy'))">{{ fmtAgg(agg2, 'sec_yoy') }}</div>
        <div class="hint">新房同比 {{ fmtAgg(agg2, 'new_yoy') }}</div>
      </div>
    </div>

    <div class="card">
      <h3>一线 / 二线城市房价指数（定基）</h3>
      <div class="sub">基于国家统计局官方环比数据等权合成，基期=2006-01（100）。{{ meta && meta.index_source }}</div>
      <div class="toolbar">
        <div class="seg">
          <button :class="{ on: metric === 'sec_idx' }" @click="switchMetric('sec_idx')">二手住宅</button>
          <button :class="{ on: metric === 'new_idx' }" @click="switchMetric('new_idx')">新建商品住宅</button>
        </div>
      </div>
      <VChart v-if="aggOption" :option="aggOption" tip-unit="idx" />
      <div class="loading" v-else>加载中…</div>
    </div>

    <div class="card">
      <h3>70城最新月涨跌榜（{{ meta && meta.latestMonth }} · 二手住宅环比）</h3>
      <div class="sub">红涨绿跌，数值为环比涨跌幅（较上月）。涨幅前10与跌幅前10。</div>
      <VChart v-if="moversOption" :option="moversOption" height="560px" tip-unit="pct" />
    </div>

    <div class="card">
      <h3>快速查看重点城市</h3>
      <div class="chips">
        <span v-for="c in featured" :key="c.code" class="chip" @click="$router.push('/city?codes=' + c.code)">★ {{ c.name }}</span>
        <span class="chip" @click="$router.push('/community')">→ 查看热门小区趋势</span>
      </div>
    </div>
  </div>
</template>

<script>
import VChart from '../components/VChart.vue';
import { api } from '../api';

export default {
  components: { VChart },
  data: () => ({
    meta: null,
    cities: [],
    metric: 'sec_idx',
    agg1: null, agg2: null, movers: null,
  }),
  computed: {
    featured() { return this.cities.filter((c) => c.featured); },
    aggOption() {
      if (!this.agg1 || !this.agg2) return null;
      const mk = (d, name, color) => ({
        name, type: 'line', showSymbol: false,
        data: d.months.map((m, i) => [m, d[this.metric][i]]),
        lineStyle: { width: 2, color }, itemStyle: { color },
      });
      return {
        legend: { top: 0 },
        grid: { left: 50, right: 20, top: 34, bottom: 64 },
        xAxis: { type: 'time' },
        yAxis: { type: 'value', scale: true },
        dataZoom: [{ type: 'slider', height: 20, bottom: 10 }, { type: 'inside' }],
        series: [mk(this.agg1, '一线城市', '#e0342f'), mk(this.agg2, '二线城市', '#2456e6')],
      };
    },
    moversOption() {
      if (!this.movers) return null;
      const rows = Object.entries(this.movers.cities)
        .map(([code, d]) => ({ code, name: d.name, v: d.values[d.values.length - 1] }))
        .filter((r) => r.v != null)
        .sort((a, b) => b.v - a.v);
      const list = [...rows.slice(0, 10), ...rows.slice(-10).reverse()];
      return {
        grid: { left: 80, right: 70, top: 10, bottom: 30 },
        xAxis: { type: 'value', axisLabel: { formatter: (v) => v + '%' } },
        yAxis: { type: 'category', data: list.map((r) => r.name), axisLabel: { fontSize: 12 } },
        series: [{
          type: 'bar',
          data: list.map((r) => ({
            value: +(r.v - 100).toFixed(2),
            itemStyle: { color: r.v >= 100 ? '#e0342f' : '#0a9e63', borderRadius: 3 },
          })),
          label: { show: true, position: 'right', fontSize: 11, formatter: (p) => (p.value > 0 ? '+' : '') + p.value.toFixed(2) + '%' },
        }],
      };
    },
  },
  async created() {
    this.meta = await api('/api/meta').catch(() => null);
    this.cities = await api('/api/cities').catch(() => []);
    await this.load();
    api('/api/series/cities?metric=sec_mom').then((d) => (this.movers = d));
  },
  methods: {
    async load() {
      [this.agg1, this.agg2] = await Promise.all([
        api('/api/series/aggregate?tier=一线&metric=all'),
        api('/api/series/aggregate?tier=二线&metric=all'),
      ]);
    },
    async switchMetric(m) {
      this.metric = m;
      await this.load();
    },
    v(agg, key) {
      if (!agg || !agg[key]) return null;
      return agg[key][agg[key].length - 1];
    },
    fmtAgg(agg, key) {
      const val = this.v(agg, key);
      if (val == null) return '—';
      return (val - 100 > 0 ? '+' : '') + (val - 100).toFixed(2) + '%';
    },
    kpiCls(val) { return val == null ? '' : val - 100 >= 0 ? 'up' : 'down'; },
  },
};
</script>
