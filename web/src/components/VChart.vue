<template>
  <div ref="el" class="vc-root" :style="{ height, width: '100%', position: 'relative', touchAction: 'pan-y' }"></div>
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
    tipUnit: { type: String, default: 'idx' },
  },
  data: () => ({ chart: null, ro: null }),
  watch: {
    option: {
      handler(v) {
        if (this.chart) {
          this._plain = unwrap(v);
          delete this._plain.tooltip;
          delete this._plain.dataZoom;
          // notMerge: a smaller series array (e.g. a deselected city) must remove
          // its line — default merge mode keeps stale series on the chart.
          this.chart.setOption(this._plain, true);
          this._recompute();
          this._applyView();
        }
      },
      deep: true,
    },
  },
  created() {
    this._onMove = this._onMove.bind(this);
    this._onOut = this._onOut.bind(this);
    this._onWheel = this._onWheel.bind(this);
    this._onDbl = this._onDbl.bind(this);
    this._onLeave = this._onLeave.bind(this);
    this._onTouchStart = this._onTouchStart.bind(this);
    this._onTouchMove = this._onTouchMove.bind(this);
    this._onTouchEnd = this._onTouchEnd.bind(this);
  },
  mounted() {
    this.chart = echarts.init(this.$refs.el);
    this._plain = unwrap(this.option);
    // The echarts hover/dataZoom pipeline throws intermittently in this app and an
    // exception in one zrender handler aborts the rest of the dispatch chain. So
    // hover tooltips AND zooming are implemented here with pure DOM + math against
    // our own option data; the echarts tooltip/dataZoom components are stripped.
    delete this._plain.tooltip;
    delete this._plain.dataZoom;
    this.chart.setOption(this._plain, true);
    this._recompute();
    this._buildOverlay();
    this._el = this.$refs.el;
    this._el.addEventListener('mousemove', this._onMove, true);
    this._el.addEventListener('mouseleave', this._onLeave, true);
    this._el.addEventListener('wheel', this._onWheel, true);
    this._el.addEventListener('dblclick', this._onDbl, true);
    this._el.addEventListener('touchstart', this._onTouchStart, { passive: true });
    this._el.addEventListener('touchmove', this._onTouchMove, { passive: false });
    this._el.addEventListener('touchend', this._onTouchEnd, { passive: true });
    this._el.addEventListener('touchcancel', this._onTouchEnd, { passive: true });
    this.ro = new ResizeObserver(() => this.chart && this.chart.resize());
    this.ro.observe(this.$refs.el);
  },
  beforeUnmount() {
    this._el.removeEventListener('mousemove', this._onMove, true);
    this._el.removeEventListener('mouseleave', this._onLeave, true);
    this._el.removeEventListener('wheel', this._onWheel, true);
    this._el.removeEventListener('dblclick', this._onDbl, true);
    this._el.removeEventListener('touchstart', this._onTouchStart, { passive: true });
    this._el.removeEventListener('touchmove', this._onTouchMove, { passive: false });
    this._el.removeEventListener('touchend', this._onTouchEnd, { passive: true });
    this._el.removeEventListener('touchcancel', this._onTouchEnd, { passive: true });
    if (this.ro) this.ro.disconnect();
    if (this.chart) this.chart.dispose();
  },
  methods: {
    _recompute() {
      const g = gridOf(this._plain);
      const series = this._plain.series || [];
      const line = series.find((s) => s.type === 'line' && Array.isArray(s.data) && s.data.length && Array.isArray(s.data[0]));
      const bar = series.find((s) => s.type === 'bar' && Array.isArray(s.data) && s.data.length);
      if (line) {
        const data0 = line.data;
        this._hover = {
          kind: 'time',
          months: data0.map((d) => d[0]),
          series: series
            .filter((s) => s.type === 'line')
            .map((s) => ({ name: s.name || '', color: (s.itemStyle && s.itemStyle.color) || (s.lineStyle && s.lineStyle.color) || '#2456e6', data: s.data })),
          g,
        };
      } else if (bar) {
        const bseries = series.filter((s) => s.type === 'bar' && Array.isArray(s.data) && s.data.length);
        if (Array.isArray(bar.data[0])) {
          // vertical bars on a time axis: items are [month, value]; series may
          // filter nulls independently, so map values by month per series
          this._hover = {
            kind: 'bartime',
            months: bseries[0].data.map((d) => d[0]),
            series: bseries.map((s) => {
              const map = new Map();
              s.data.forEach((d) => { if (Array.isArray(d) && d[1] != null) map.set(d[0], d[1]); });
              return { name: s.name || '', map };
            }),
            g,
          };
        } else {
          const vals = bar.data.map((d) => (typeof d === 'object' ? d.value : d));
          this._hover = {
            kind: 'barcat',
            values: vals,
            names: (this._plain.yAxis && this._plain.yAxis.data) || [],
            g,
          };
        }
      } else {
        this._hover = null;
      }
      this._view = null; // { i0, i1 } visible index range for time charts
    },
    _syncZoom() {
      if (this._view) this._applyView();
    },
    _applyView() {
      // re-render line series with the sliced window + explicit axis bounds
      const v = this._view;
      const series = (this._plain.series || []).filter((s) => s.type === 'line' && Array.isArray(s.data));
      if (!v || !series.length) return;
      const months = this._hover.months;
      const sliced = series.map((s) => ({ ...s, data: s.data.slice(v.i0, v.i1 + 1) }));
      const option = { series: sliced.map((s) => ({ name: s.name, type: s.type, data: s.data })) };
      option.xAxis = { min: months[v.i0], max: months[v.i1] };
      this.chart.setOption(option);
    },
    _onWheel(e) {
      if (!this._hover || this._hover.kind !== 'time') return;
      e.preventDefault();
      const el = this.$refs.el;
      const rect = el.getBoundingClientRect();
      const px = e.clientX - rect.left;
      const g = this._hover.g;
      const gw = Math.max(10, el.clientWidth - g.left - g.right);
      const n = this._hover.months.length;
      if (!this._view) this._view = { i0: 0, i1: n - 1 };
      let { i0, i1 } = this._view;
      const span = i1 - i0;
      const frac = Math.min(1, Math.max(0, (px - g.left) / gw));
      const anchor = i0 + span * frac;
      const k = e.deltaY > 0 ? 1.3 : 0.75;
      const newSpan = Math.max(11, Math.min(n - 1, span * k));
      let ni0 = Math.round(anchor - newSpan * frac);
      let ni1 = ni0 + Math.round(newSpan);
      if (ni0 < 0) { ni0 = 0; ni1 = Math.min(n - 1, Math.round(newSpan)); }
      if (ni1 > n - 1) { ni1 = n - 1; ni0 = Math.max(0, ni1 - Math.round(newSpan)); }
      this._view = { i0: ni0, i1: ni1 };
      this._applyView();
    },
    _onDbl() {
      if (!this._hover || this._hover.kind !== 'time') return;
      const n = this._hover.months.length;
      this._view = { i0: 0, i1: n - 1 };
      this._applyView();
    },
    // touch gestures (mobile): one finger = pan the visible window, two fingers =
    // pinch zoom, double tap = reset. Vertical page scroll stays native via
    // touch-action: pan-y; the browser fires touchcancel when it takes over.
    _fullView() {
      return { i0: 0, i1: (this._hover ? this._hover.months.length : 1) - 1 };
    },
    _touchStartState(e) {
      const t0 = e.touches[0], t1 = e.touches[1];
      if (t1) {
        const dx = t0.clientX - t1.clientX, dy = t0.clientY - t1.clientY;
        return {
          mode: 'pinch', dist: Math.hypot(dx, dy) || 1,
          midX: (t0.clientX + t1.clientX) / 2,
          view0: { ...(this._view || this._fullView()) },
        };
      }
      return { mode: 'pan', x: t0.clientX, moved: false, view0: { ...(this._view || this._fullView()) } };
    },
    _onTouchStart(e) {
      if (!this._hover || this._hover.kind !== 'time') return;
      this._hideAll(); // a fresh gesture clears any tooltip left by the previous one
      this._touch = this._touchStartState(e);
    },
    _onTouchMove(e) {
      const t = this._touch;
      if (!t || !this._hover || this._hover.kind !== 'time') return;
      e.preventDefault();
      const el = this.$refs.el;
      const g = this._hover.g;
      const gw = Math.max(10, el.clientWidth - g.left - g.right);
      const n = this._hover.months.length;
      const span0 = t.view0.i1 - t.view0.i0;
      let i0, i1, tipX;
      if (t.mode === 'pinch' && e.touches.length === 2) {
        const dx = e.touches[0].clientX - e.touches[1].clientX, dy = e.touches[0].clientY - e.touches[1].clientY;
        const dist = Math.hypot(dx, dy) || 1;
        tipX = (e.touches[0].clientX + e.touches[1].clientX) / 2;
        const frac = Math.min(1, Math.max(0, (tipX - el.getBoundingClientRect().left - g.left) / gw));
        const newSpan = Math.max(11, Math.min(n - 1, Math.round(span0 / (dist / t.dist))));
        const anchor = t.view0.i0 + span0 * frac;
        i0 = Math.round(anchor - newSpan * frac);
        i1 = i0 + newSpan;
      } else if (t.mode === 'pan' && e.touches.length === 1) {
        const dx = e.touches[0].clientX - t.x;
        if (Math.abs(dx) > 4) t.moved = true;
        tipX = e.touches[0].clientX;
        const shift = Math.round(-dx / gw * span0);
        i0 = t.view0.i0 + shift;
        i1 = t.view0.i1 + shift;
      } else {
        return;
      }
      const span = i1 - i0;
      if (i0 < 0) { i0 = 0; i1 = Math.min(n - 1, i0 + span); }
      if (i1 > n - 1) { i1 = n - 1; i0 = Math.max(0, i1 - span); }
      if (i1 <= i0) return;
      this._view = { i0, i1 };
      this._applyView();
      if (tipX != null) {
        try { this._handleMove({ clientX: tipX, clientY: e.touches[0].clientY }); } catch (err) { this._hideAll(); }
      }
    },
    _onTouchEnd(e) {
      const t = this._touch;
      this._touch = null;
      // the browser taking over means the page is scrolling: drop the tooltip
      if (e.type === 'touchcancel') { this._hideAll(); return; }
      if (!t || t.mode !== 'pan' || t.moved) return;
      const now = Date.now();
      if (this._lastTap && now - this._lastTap < 320) {
        this._lastTap = null;
        this._onDbl();
      } else {
        this._lastTap = now;
      }
    },
    _onOut(e) {
      const inst = e.target && e.target.closest ? e.target.closest('[_echarts_instance_]') : null;
      const to = e.relatedTarget && e.relatedTarget.closest ? e.relatedTarget.closest('[_echarts_instance_]') : null;
      if (inst === this._el && to !== this._el) this._hideAll();
    },
    _onLeave() {
      this._hideAll();
    },
    _hideAll() {
      if (this._tipDiv) this._tipDiv.style.display = 'none';
      if (this._cross) this._cross.style.display = 'none';
    },
    _onMove(e) {
      try { this._handleMove(e); } catch (err) { this._hideAll(); }
    },
    _handleMove(e) {
      if (!this._hover || !this._el) return;
      const el = this.$refs.el;
      const rect = el.getBoundingClientRect();
      const px = e.clientX - rect.left;
      const py = e.clientY - rect.top;
      const w = el.clientWidth, h = el.clientHeight;
      if (px < 0 || py < 0 || px > w || py > h) return this._hideAll();
      const g = this._hover.g;
      const gw = Math.max(10, w - g.left - g.right);
      let rows = null, title = '', xPix = null;
      if (this._hover.kind === 'time') {
        const n = this._hover.months.length;
        const v = this._view || { i0: 0, i1: n - 1 };
        const frac = Math.min(1, Math.max(0, (px - g.left) / gw));
        let idx = Math.round(v.i0 + (v.i1 - v.i0) * frac);
        idx = Math.min(v.i1, Math.max(v.i0, idx));
        title = this._hover.months[idx];
        rows = this._hover.series.map((s) => ({
          name: s.name,
          v: s.data[idx] ? s.data[idx][1] : null,
          color: s.color,
        }));
        xPix = g.left + frac * gw;
      } else if (this._hover.kind === 'bartime') {
        const n = this._hover.months.length;
        const frac = Math.min(1, Math.max(0, (px - g.left) / gw));
        const idx = Math.min(n - 1, Math.max(0, Math.round(frac * (n - 1))));
        title = this._hover.months[idx];
        rows = this._hover.series.map((s) => {
          const v = s.map.has(title) ? s.map.get(title) : null;
          return { name: s.name, v, color: v != null && v >= 0 ? '#e0342f' : '#0a9e63' };
        });
        xPix = g.left + frac * gw;
      } else {
        // horizontal bars on a category axis: pick the row under the cursor
        const n = this._hover.values.length;
        const gh = Math.max(10, h - g.top - g.bottom);
        const frac = Math.min(1, Math.max(0, (py - g.top) / gh));
        const idx = Math.min(n - 1, Math.max(0, Math.floor(frac * n)));
        title = this._hover.names[idx] || '';
        const v = this._hover.values[idx];
        rows = [{ name: '二手环比', v, color: v != null && v >= 0 ? '#e0342f' : '#0a9e63' }];
      }
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
};
</script>
