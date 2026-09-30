<template>
  <div ref="el" :style="{ height, width: '100%', position: 'relative' }"></div>
</template>

<script>
import * as echarts from 'echarts';
import { toRaw } from 'vue';

// Deep-unwrap reactive proxies: ECharts mutates options internally, and Vue
// proxies break its internals in this app. Functions pass through.
function unwrap(o) {
  if (o == null || typeof o !== 'object') return o;
  const raw = toRaw(o);
  if (Array.isArray(raw)) return raw.map(unwrap);
  const out = {};
  for (const k of Object.keys(raw)) out[k] = unwrap(raw[k]);
  return out;
}

function fmtValue(v, unit) {
  if (v == null || Number.isNaN(+v)) return '—';
  if (unit === 'pct') return (v > 0 ? '+' : '') + (+v).toFixed(2) + '%';
  if (unit === 'price') return Math.round(v).toLocaleString() + ' 元/㎡';
  return (+v).toFixed(2);
}

function gridOf(plain) {
  const g = plain.grid || {};
  const pick = (v, d) => (typeof v === 'number' ? v : d);
  return { left: pick(g.left, 50), right: pick(g.right, 20), top: pick(g.top, 30), bottom: pick(g.bottom, 50) };
}

export default {
  name: 'VChart',
  props: {
    option: { type: Object, required: true },
    height: { type: String, default: '420px' },
    // tooltip value format: 'idx' (指数) | 'pct' (百分比) | 'price' (元/㎡)
    tipUnit: { type: String, default: 'idx' },
  },
  data: () => ({ chart: null, ro: null }),
  watch: {
    option: {
      handler(v) {
        if (this.chart) {
          this._plain = unwrap(v);
          delete this._plain.tooltip;
          this.chart.setOption(this._plain);
          this._recompute();
        }
      },
      deep: true,
    },
  },
  mounted() {
    this.chart = echarts.init(this.$refs.el);
    this._plain = unwrap(this.option);
    delete this._plain.tooltip;
    // The echarts hover pipeline (tooltip/axisPointer/sampling tasks) throws
    // intermittently in this app and an exception inside one zrender handler
    // aborts the rest of the dispatch chain. So the hover tooltip is computed
    // with pure pixel math against our own option data — no echarts APIs at
    // hover time — and bound on `document` (capture) so it survives Vue
    // re-rendering the chart container.
    this.chart.setOption(this._plain, true);
    this._recompute();
    this._buildOverlay();
    this._bound = (e) => {
      const target = e.target;
      const inst = target && target.closest ? target.closest('[_echarts_instance_]') : null;
      if (!inst || inst !== this._el) return;
      this._onMove(e);
    };
    this._el = this.$refs.el;
    document.addEventListener('mousemove', this._bound, true);
    document.addEventListener('mouseout', this._onOut, true);
    this.ro = new ResizeObserver(() => this.chart && this.chart.resize());
    this.ro.observe(this.$refs.el);
  },
  beforeUnmount() {
    document.removeEventListener('mousemove', this._bound, true);
    document.removeEventListener('mouseout', this._onOut, true);
    if (this.ro) this.ro.disconnect();
    if (this.chart) this.chart.dispose();
  },
  methods: {
    _recompute() {
      // precompute hover math from our own option data (no echarts state needed)
      const g = gridOf(this._plain);
      const series = this._plain.series || [];
      const line = series.find((s) => s.type === 'line' && Array.isArray(s.data) && s.data.length && Array.isArray(s.data[0]));
      const bar = series.find((s) => s.type === 'bar' && Array.isArray(s.data) && s.data.length);
      if (line) {
        const data0 = line.data;
        const t0 = Date.parse(data0[0][0] + '-01T00:00:00');
        const t1 = Date.parse(data0[data0.length - 1][0] + '-01T00:00:00');
        this._hover = {
          kind: 'time',
          months: data0.map((d) => d[0]),
          t0, t1,
          gridW: 0, // resolved at hover time from container width
          g,
        };
      } else if (bar) {
        const vals = bar.data.map((d) => (typeof d === 'object' ? d.value : d));
        this._hover = {
          kind: 'bar',
          values: vals,
          names: (this._plain.yAxis && this._plain.yAxis.data) || [],
          min: Math.min(...vals),
          max: Math.max(...vals),
          g,
        };
      } else {
        this._hover = null;
      }
      this._zoom = { start: 0, end: 100 };
    },
    _onOut(e) {
      // hide when the pointer leaves this chart's container
      const inst = e.target && e.target.closest ? e.target.closest('[_echarts_instance_]') : null;
      const to = e.relatedTarget && e.relatedTarget.closest ? e.relatedTarget.closest('[_echarts_instance_]') : null;
      if (inst === this._el && to !== this._el) this._hideAll();
    },
    _hideAll() {
      if (this._tipDiv) this._tipDiv.style.display = 'none';
      if (this._cross) this._cross.style.display = 'none';
    },
    _onMove(e) {
      try {
        this._handleMove(e);
      } catch (err) { this._hideAll(); }
    },
    _handleMove(e) {
      if (!this._hover || !this._el) return;
      const rect = this._el.getBoundingClientRect();
      const px = e.clientX - rect.left;
      const py = e.clientY - rect.top;
      const w = this._el.clientWidth, h = this._el.clientHeight;
      if (px < 0 || py < 0 || px > w || py > h) return this._hideAll();
      const g = this._hover.g;
      const gw = Math.max(10, w - g.left - g.right);
      const gh = Math.max(10, h - g.top - g.bottom);
      let rows = null, title = '', xPix = null;
      if (this._hover.kind === 'time') {
        const n = this._hover.months.length;
        const z0 = this._zoom.start / 100, z1 = this._zoom.end / 100;
        const frac = Math.min(1, Math.max(0, (px - g.left) / gw));
        const tFrac = z0 + (z1 - z0) * frac;
        let idx = Math.round(tFrac * (n - 1));
        idx = Math.min(n - 1, Math.max(0, idx));
        title = this._hover.months[idx];
        const series = (this._plain.series || []).filter((s) => s.type === 'line');
        rows = series.map((s) => ({
          name: s.name || '',
          v: s.data[idx] ? s.data[idx][1] : null,
          color: (s.itemStyle && s.itemStyle.color) || (s.lineStyle && s.lineStyle.color) || '#2456e6',
        }));
        xPix = g.left + frac * gw;
      } else {
        // bar: nearest value to the cursor's x position within [min,max] range
        const { values, min, max } = this._hover;
        const span = max - min || 1;
        const frac = Math.min(1, Math.max(0, (px - g.left) / gw));
        const vAt = min + span * frac;
        let best = -1, bestD = Infinity;
        values.forEach((v, i) => {
          const dd = Math.abs(v - vAt);
          if (dd < bestD) { bestD = dd; best = i; }
        });
        if (best < 0) return this._hideAll();
        title = this._hover.names[best] || '';
        rows = [{ name: '二手环比', v: values[best], color: values[best] >= 0 ? '#e0342f' : '#0a9e63' }];
        xPix = null;
      }
      // render
      const tip = this._tipDiv;
      const html = [`<div style="font-weight:700;margin-bottom:2px">${title}</div>`];
      for (const r of rows) {
        html.push(`<div><span style="display:inline-block;width:8px;height:8px;border-radius:50%;background:${r.color};margin-right:6px"></span>${r.name}　<b>${fmtValue(r.v, this.tipUnit)}</b></div>`);
      }
      tip.innerHTML = html.join('');
      tip.style.display = 'block';
      const tw = tip.offsetWidth, th = tip.offsetHeight;
      let x = px + 16, y = py - th - 8;
      if (x + tw > w - 8) x = px - tw - 16;
      if (y < 4) y = py + 16;
      if (y + th > h - 4) y = h - th - 4;
      tip.style.left = x + 'px';
      tip.style.top = y + 'px';
      if (xPix != null && this._cross) {
        this._cross.style.display = 'block';
        this._cross.style.left = xPix + 'px';
      } else if (this._cross) {
        this._cross.style.display = 'none';
      }
    },
    _buildOverlay() {
      const wrap = document.createElement('div');
      wrap.style.cssText = 'position:absolute;inset:0;pointer-events:none;overflow:hidden;';
      const cross = document.createElement('div');
      cross.style.cssText = 'position:absolute;display:none;top:0;bottom:0;width:0;border-left:1px dashed #94a3b8;';
      const tip = document.createElement('div');
      tip.style.cssText = [
        'position:absolute', 'display:none', 'z-index:99',
        'background:rgba(255,255,255,.96)', 'border:1px solid #dbe2ef', 'border-radius:8px',
        'box-shadow:0 4px 14px rgba(16,24,40,.12)', 'padding:8px 12px', 'font-size:12.5px',
        'color:#1f2937', 'line-height:1.7', 'white-space:nowrap',
      ].join(';');
      wrap.appendChild(cross);
      wrap.appendChild(tip);
      this.$refs.el.appendChild(wrap);
      this._cross = cross;
      this._tipDiv = tip;
    },
  },
  created() {
    this._onMove = this._onMove.bind(this);
    this._onOut = this._onOut.bind(this);
  },
  beforeUnmount() {
    document.removeEventListener('mousemove', this._bound, true);
    document.removeEventListener('mouseout', this._onOut, true);
    if (this.ro) this.ro.disconnect();
    if (this.chart) this.chart.dispose();
  },
};
</script>
