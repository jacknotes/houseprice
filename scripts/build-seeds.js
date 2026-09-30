// Build seed datasets:
//  - data/processed/city_level.json : anjuke listing-price series (real, sparse ok)
//  - data/processed/communities.json: hot communities with simulated series anchored to official city index shape
// Usage: node scripts/build-seeds.js
const fs = require('fs');
const path = require('path');

const P = (f) => path.join(__dirname, '..', 'data', 'processed', f);
fs.mkdirSync(P(''), { recursive: true });
const nbs = JSON.parse(fs.readFileSync(P('city_index.json'), 'utf8'));

/* ---------- 1. city_level: anjuke real series ---------- */
const levels = {};

// Shenzhen (parsed from anjuke SSR page)
const sz = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'data', 'raw', 'anjuke_shenzhen.json'), 'utf8'));
levels['深圳'] = sz.map((r) => ({ ym: r.ym, price: r.price }));

// Xianning (transcribed from anjuke page)
const xnTxt = fs.readFileSync(path.join(__dirname, '..', 'data', 'raw', 'anjuke_xianning_transcribed.csv'), 'utf8');
const xn = xnTxt.trim().split(/\r?\n/).slice(1).map((l) => l.split(',')).filter((c) => c[1] && c[1] !== '-').map((c) => ({ ym: c[0], price: +c[1] }));
levels['咸宁'] = xn;

// recompute mom from consecutive real points (listed mom lost arrow signs in transcription)
for (const city of Object.keys(levels)) {
  const arr = levels[city];
  arr.forEach((r, i) => {
    r.mom = i === 0 ? null : +(((r.price - arr[i - 1].price) / arr[i - 1].price) * 100).toFixed(2);
  });
}
fs.writeFileSync(P('city_level.json'), JSON.stringify(levels));

/* ---------- 2. communities ---------- */
// anchor: normalize a city's monthly series to 1.0 at its first month
function anchorFromIndex(city, metric) {
  const s = nbs[city];
  const out = { months: [], norm: [] };
  const base = s[metric].find((v) => v != null);
  for (let i = 0; i < s.months.length; i++) {
    if (s[metric][i] == null) continue;
    out.months.push(s.months[i]);
    out.norm.push(s[metric][i] / base);
  }
  return out;
}
function anchorFromLevel(city) {
  const arr = levels[city];
  const out = { months: arr.map((r) => r.ym), norm: arr.map((r) => r.price / arr[0].price) };
  return out;
}
function monthlyBetween(a, b) {
  const out = [];
  let [y, m] = a.split('-').map(Number);
  const [ey, em] = b.split('-').map(Number);
  while (y < ey || (y === ey && m <= em)) {
    out.push(`${y}-${String(m).padStart(2, '0')}`);
    m++; if (m > 12) { m = 1; y++; }
  }
  return out;
}
// deterministic pseudo-random wobble so curves aren't dead-straight
function wobble(name, month, i) {
  let h = 0;
  for (const ch of name) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  const phase = (h % 628) / 100;
  const y = +month.slice(0, 4), m = +month.slice(5, 7);
  const seasonal = 0.006 * Math.sin((m / 12) * Math.PI * 2 + phase);
  const drift = 0.004 * Math.sin(i * 0.35 + phase * 2);
  const noise = (((h ^ (i * 2654435761)) >>> 0) % 1000) / 100000 - 0.005;
  return 1 + seasonal + drift + noise;
}

// [city, district, name, currentPrice(2026-09 ≈)]
const SEED = [
  ['北京', '海淀', '华清嘉园', 86000], ['北京', '西城', '丰汇园', 128000], ['北京', '朝阳', '望京西园四区', 52000],
  ['北京', '朝阳', '北京新天地', 43000], ['北京', '海淀', '中关村东里', 79000], ['北京', '昌平', '龙腾苑六区', 36000],
  ['北京', '大兴', '金地格林小镇', 41000], ['北京', '丰台', '芳城园一区', 46000], ['北京', '通州', '京贸国际城', 32000],
  ['北京', '东城', '和平里七区', 73000],
  ['上海', '浦东', '世茂滨江花园', 92000], ['上海', '浦东', '仁恒河滨城', 88000], ['上海', '普陀', '中远两湾城', 54000],
  ['上海', '闵行', '上海康城', 37000], ['上海', '浦东', '大华锦绣华城', 58000], ['上海', '徐汇', '田林十四村', 52000],
  ['上海', '长宁', '古北国际广场', 79000], ['上海', '松江', '三湘四季花城', 33000], ['上海', '嘉定', '保利海上五月花', 39000],
  ['上海', '黄浦', '耀江花园', 98000],
  ['深圳', '南山', '半岛城邦', 108000], ['深圳', '南山', '蔚蓝海岸', 93000], ['深圳', '福田', '长城大厦', 102000],
  ['深圳', '福田', '水榭花都', 118000], ['深圳', '宝安', '幸福海岸', 74000], ['深圳', '龙华', '金地上塘道', 58000],
  ['深圳', '龙岗', '桂芳园', 34000], ['深圳', '龙岗', '万科城', 41000], ['深圳', '罗湖', '百仕达花园', 54000],
  ['深圳', '南山', '前海时代', 82000],
  ['广州', '天河', '猎德花园', 88000], ['广州', '天河', '汇景新城', 68000], ['广州', '天河', '骏景花园', 48000],
  ['广州', '海珠', '金碧花园', 37000], ['广州', '海珠', '光大花园', 44000], ['广州', '番禺', '祈福新邨', 27000],
  ['广州', '番禺', '华南碧桂园', 30000], ['广州', '白云', '岭南新世界', 37000], ['广州', '白云', '时代玫瑰园', 34000],
  ['广州', '黄埔', '科城山庄', 30000],
  ['咸宁', '温泉', '咸宁碧桂园', 5400], ['咸宁', '咸安', '御龙花园', 3900], ['咸宁', '温泉', '淦河家园', 4600],
  ['咸宁', '温泉', '金桂明珠', 4400], ['咸宁', '咸安', '水木清华', 3900], ['咸宁', '温泉', '中央公园', 4900],
  // 上海松江区 / 嘉定区（重点覆盖）
  ['上海', '松江', '泰晤士小镇', 31000], ['上海', '松江', '开元地中海', 34000], ['上海', '松江', '海德名园', 36000],
  ['上海', '松江', '莱顿小城', 42000], ['上海', '松江', '九城湖滨', 41000],
  ['上海', '嘉定', '龙湖郦城', 40000], ['上海', '嘉定', '安亭新镇', 30000], ['上海', '嘉定', '华润中央公园', 47000],
  ['上海', '嘉定', '金地格林世界', 44000],
];

const anchors = {};
const anchorFor = (city) => {
  if (!anchors[city]) {
    anchors[city] = city === '咸宁' ? anchorFromLevel('咸宁') : anchorFromIndex(city, 'secondIdx');
  }
  return anchors[city];
};

const communities = [];
for (const [city, district, name, current] of SEED) {
  const a = anchorFor(city);
  const normLast = a.norm[a.norm.length - 1];
  const base = current / normLast; // price = base * norm
  const prices = a.months.map((m, i) => Math.round((base * a.norm[i] * wobble(city + name, m, i)) / 10) * 10);
  communities.push({
    city, district, name, source: 'simulated',
    note: '模拟趋势：曲线形态锚定该城市官方指数/真实均价，绝对价格仅示意，可在“数据管理”导入真实数据替换',
    months: a.months, prices,
  });
}
fs.writeFileSync(P('communities.json'), JSON.stringify(communities));

console.log('levels:', JSON.stringify(Object.fromEntries(Object.entries(levels).map(([k, v]) => [k, `${v.length} pts ${v[0].ym}->${v[v.length - 1].ym} last=${v[v.length - 1].price}`])), null, 1));
console.log('communities:', communities.length);
const c0 = communities.find((c) => c.city === '深圳');
console.log('sample 深圳 半岛城邦:', c0 && JSON.stringify({ first: c0.prices[0], peak: Math.max(...c0.prices), last: c0.prices[c0.prices.length - 1], months: c0.months.length }));
