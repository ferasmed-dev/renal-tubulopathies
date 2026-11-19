// Schematic: the nephron laid out left to right (glomerulus → proximal tubule → loop of Henle → distal convoluted
// tubule → collecting duct) with every transporter that a tubulopathy can break. The failing transporter of the
// selected entity is crossed out (loss of function) or flagged ↑ (gain of function); urine output and stones are
// drawn underneath.
const SEGMENTS = [
  { key: 'tcp', x: 52, w: 214, cols: 2, tr: ['sglt2', 'nhe3', 'nbce1', 'napi', 'rbat', 'urat1', 'ca', 'ctns'] },
  { key: 'asa', x: 276, w: 118, cols: 1, tr: ['nkcc2', 'romk', 'clckb'] },
  { key: 'tcd', x: 404, w: 118, cols: 1, tr: ['ncc', 'trpm6'] },
  { key: 'colector', x: 532, w: 160, cols: 1, tr: ['enac', 'mr', 'hatpasa', 'v2'] },
];

export function drawSchematic(box, e, pt, tr) {
  const g = pt.g;
  const hit = new Set(e.tr || []);
  const gain = e.mode === 'gain';
  const whole = e.key === 'fanconi' || e.key === 'cistinosis';
  const segs = SEGMENTS.map(s => {
    const segOn = e.loc === s.key;
    const pw = (s.w - 12 - (s.cols - 1) * 6) / s.cols;
    const pills = s.tr.map((id, i) => {
      const col = i % s.cols, row = Math.floor(i / s.cols);
      const x = s.x + 6 + col * (pw + 6), y = 64 + row * 32;
      const on = hit.has(id);
      const label = tr(`schem.tr.${id}`) + (on && gain ? ' ↑' : '');
      return `<rect x="${x}" y="${y}" width="${pw}" height="26" rx="13" fill="${on ? 'var(--hot-bg)' : 'var(--surface)'}" stroke="${on ? 'var(--hot)' : 'var(--axis)'}" stroke-width="${on ? 2 : 1}"/>
        <text x="${x + pw / 2}" y="${y + 17}" text-anchor="middle" style="font-size:11px;${on ? 'font-weight:700;fill:var(--hot)' : 'fill:var(--ink2)'}">${label}</text>
        ${on && !gain ? `<line x1="${x + 8}" y1="${y + 21}" x2="${x + pw - 8}" y2="${y + 5}" stroke="var(--hot)" stroke-width="2" opacity="0.55"/>` : ''}`;
    }).join('');
    const hl = segOn || (whole && s.key === 'tcp');
    return `<rect x="${s.x}" y="34" width="${s.w}" height="166" rx="10" fill="var(--tissue)" fill-opacity="0.35" stroke="${hl ? 'var(--hot)' : 'var(--tissue-line)'}" stroke-width="${hl ? (whole ? 3 : 2) : 1.2}"/>
      <text x="${s.x + s.w / 2}" y="52" text-anchor="middle" class="${hl ? 'lbl-on' : ''}" style="font-size:12px;font-weight:700">${tr(`schem.${s.key}`)}</text>${pills}`;
  }).join('');
  // flow arrows between segments
  const arrows = [[266, 276], [394, 404], [522, 532]].map(([a, b]) => `<path d="M${a} 118 H${b}" stroke="var(--axis)" stroke-width="1.5" marker-end="url(#arr)"/>`).join('');
  // urine: drops ∝ urine output, stones ∝ cumulative stones
  const drops = Math.max(1, Math.min(10, Math.round(g.diuresis)));
  const stones = Math.min(8, Math.floor(g.litiasis + 1e-9));
  const dropSvg = Array.from({ length: drops }, (_, i) => `<path d="M${168 + i * 16} 220 q-5 8 0 12 q5 -4 0 -12z" fill="var(--s1)" opacity="0.8"/>`).join('');
  box.innerHTML = `
<svg viewBox="0 0 700 260" role="img" aria-label="${tr('schem.aria')}">
  <defs><marker id="arr" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="6" markerHeight="6" orient="auto"><path d="M0 0 L10 5 L0 10z" fill="var(--axis)"/></marker></defs>
  <circle cx="26" cy="118" r="20" fill="var(--tissue)" stroke="var(--tissue-line)" stroke-width="1.5"/>
  <path d="M14 112 q6 -10 12 0 q6 10 12 0 M14 124 q6 -10 12 0 q6 10 12 0" fill="none" stroke="var(--vessel)" stroke-width="2"/>
  <text x="2" y="154" style="font-size:11px">${tr('schem.glomerulo')}</text>
  <path d="M46 118 H52" stroke="var(--axis)" stroke-width="1.5"/>
  ${segs}${arrows}
  <text x="20" y="232" style="font-size:12px;font-weight:700;fill:var(--ink)">${tr('schem.orina')}</text>
  <text x="70" y="232" style="font-size:12px">${(+g.diuresis).toFixed(1)} L/24 h</text>
  ${dropSvg}
  ${stones ? `<text x="${360}" y="232" style="font-size:12px" class="lbl-on">${tr('schem.calculos')}</text>` : ''}
  ${Array.from({ length: stones }, (_, i) => `<polygon points="${440 + i * 22},234 ${446 + i * 22},220 ${456 + i * 22},222 ${458 + i * 22},234" fill="var(--hot)" opacity="0.8"/>`).join('')}
</svg>`;
}
