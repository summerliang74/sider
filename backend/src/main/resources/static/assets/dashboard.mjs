const number = value => new Intl.NumberFormat('en').format(Number(value || 0));
const bytes = value => {
  const n = Number(value || 0);
  const power = Math.min(4, Math.floor(Math.log(Math.max(n, 1)) / Math.log(1024)));
  return `${(n / 1024 ** power).toFixed(power ? 1 : 0)} ${['B', 'KB', 'MB', 'GB', 'TB'][power]}`;
};
function svgNode(tag, attrs = {}, text) {
  const node = document.createElementNS('http://www.w3.org/2000/svg', tag);
  for (const [key, value] of Object.entries(attrs)) node.setAttribute(key, String(value));
  if (text !== undefined) node.textContent = text;
  return node;
}
function plot(series, keys, { small = false, byteValues = false } = {}) {
  const width = 640, height = small ? 64 : 220;
  const left = small ? 0 : 65, top = 12, bottom = small ? height : height - 30;
  const right = width - (small ? 0 : 18);
  const max = Math.max(1, ...series.flatMap(row => keys.map(key => Number(row[key] || 0))));
  const svg = svgNode('svg', { viewBox: `0 0 ${width} ${height}`, class: small ? 'dashboard-spark' : 'dashboard-plot', role: 'img', 'aria-label': keys.join(' and ') + ' over time, UTC. Exact values in the data table below.' });
  const x = i => left + i * (right - left) / Math.max(1, series.length - 1);
  const y = value => bottom - Number(value || 0) / max * (bottom - top);
  if (!small) {
    for (let i = 0; i <= 4; i++) {
      const position = top + (bottom - top) * i / 4;
      svg.append(svgNode('line', { x1: left, x2: right, y1: position, y2: position, class: 'dashboard-gridline' }),
        svgNode('text', { x: left - 10, y: position + 4, 'text-anchor': 'end' }, byteValues ? bytes(max * (1 - i / 4)) : new Intl.NumberFormat('en', { maximumFractionDigits: 1, notation: 'compact' }).format(max * (1 - i / 4))));
    }
    [...new Set([0, Math.floor((series.length - 1) / 2), series.length - 1])].filter(i => i >= 0).forEach(i => {
      const d = new Date(series[i].at);
      const label = d.toLocaleString('en', { timeZone: 'UTC', month: 'short', day: 'numeric', ...(series.length === 24 ? { hour: '2-digit' } : {}) });
      svg.append(svgNode('text', { x: x(i), y: height - 7, 'text-anchor': i === 0 ? 'start' : i === series.length - 1 ? 'end' : 'middle' }, label));
    });
  }
  keys.forEach((key, index) => {
    const points = series.map((row, i) => `${x(i)},${y(row[key])}`).join(' ');
    if (series.length) svg.append(svgNode('polygon', { points: `${left},${bottom} ${points} ${x(series.length - 1)},${bottom}`, class: `dashboard-area series-${index}` }),
      svgNode('polyline', { points, class: `dashboard-line series-${index}`, 'vector-effect': 'non-scaling-stroke' }));
    if (series.length === 1) svg.append(svgNode('circle', { cx: x(0), cy: y(series[0][key]), r: 3, fill: '#3987f6' }));
  });
  return svg;
}
export function dashboardPanels(el, data) {
  const { summary: s, series } = data;
  const metric = (label, value, note, key) => el('article', { class: 'dashboard-metric' }, el('span', {}, label), el('strong', {}, value), el('small', {}, note), key && plot(series, [key], { small: true }));
  function chart(label, keys, labels, byteValues = false) {
    const totals = keys.map(key => series.reduce((sum, row) => sum + Number(row[key] || 0), 0));
    const head = el('thead', {}, el('tr', {}, el('th', {}, 'UTC'), ...labels.map(name => el('th', {}, name))));
    const rows = series.map(row => el('tr', {}, el('td', {}, row.at.replace('T', ' ').slice(0, 16)),
      ...keys.map(key => el('td', {}, byteValues ? bytes(row[key]) : number(row[key])))));
    const table = el('details', { class: 'dashboard-table' }, el('summary', {}, 'View data'),
      el('div', {}, el('table', {}, head, el('tbody', {}, ...rows))));
    return el('section', { class: 'dashboard-panel' }, el('div', { class: 'dashboard-panel-heading' }, el('h2', {}, label), el('span', {}, data.range === '24h' ? 'Hourly · UTC' : 'Daily · UTC')),
      el('div', { class: 'dashboard-legend' }, ...keys.map((key, i) => el('span', { class: `series-label-${i}` }, labels[i] + '  ' + (byteValues ? bytes(totals[i]) : number(totals[i]))))),
      plot(series, keys, { byteValues }), table);
  }
  function ranking(label, rows, note) {
    const max = Math.max(1, ...rows.map(row => Number(row.value)));
    return el('section', { class: 'dashboard-panel dashboard-ranking' }, el('div', { class: 'dashboard-panel-heading' }, el('h2', {}, label)), el('p', { class: 'muted' }, note),
      rows.length ? el('ul', {}, ...rows.map(row => el('li', {}, el('span', { title: row.label }, row.label), el('meter', { min: 0, max, value: row.value, 'aria-label': row.label }), el('strong', {}, number(row.value))))) : el('p', { class: 'dashboard-no-data' }, 'No activity to display.'));
  }
  return el('div', { class: 'dashboard-body' },
    el('div', { class: 'dashboard-metrics' },
      metric('Total resources', number(s.totalResources), `${number(s.activeResources)} published · excludes deleted`),
      metric('New uploads', number(s.newResources), 'Created in selected period', 'uploads'),
      metric('Registered users', number(s.totalUsers), `+${number(s.newUsers)} in selected period`),
      metric('Open reports', number(s.openReports), 'Current moderation queue'),
      metric('Resource size', bytes(s.resourceBytes), 'Metadata total · excludes deleted')),
    el('div', { class: 'dashboard-grid' }, chart('Uploads over time', ['uploads'], ['Uploads']), chart('Uploaded file size', ['bytes'], ['File size'], true),
      chart('Report activity', ['reports', 'handled'], ['Created', 'Handled']), ranking('Resources by status', data.statuses, 'Current totals · includes deleted metadata'),
      ranking('Top tags', data.tags, 'Published resources · all time'), ranking('File types', data.types, 'Published resources · all time'),
      ranking('Management activity', data.actions, 'Audit actions in selected period')));
}
