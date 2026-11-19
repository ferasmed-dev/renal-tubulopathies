// Renal tubulopathies simulator — pure model (no DOM).
// One spec-driven engine: each tubulopathy is a transporter defect that pushes a set of lab values away from
// baseline with a time constant; treatment (from a chosen month) pulls each value back to a residual fraction of
// the defect. Stones accumulate at a rate, GFR can be lost. Values marked "Model" are teaching assumptions.

export const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
const approach = (v, target, dt, tau) => v + (target - v) * Math.min(1, dt / tau);

export const GAUGES = {
  k: { unit: 'mEq/L', dec: 1, normal: [3.5, 5.0] },
  hco3: { unit: 'mEq/L', dec: 0, normal: [22, 26] },
  na: { unit: 'mEq/L', dec: 0, normal: [135, 145] },
  phu: { unit: '', dec: 1, normal: [5, 7] },
  mg: { unit: 'mg/dL', dec: 1, normal: [1.7, 2.4], yMin: 0 },
  ca: { unit: 'mg/dL', dec: 1, normal: [8.5, 10.5] },
  cau: { unit: 'mg/kg/24 h', dec: 1, normal: [0, 4], yMin: 0 },
  glucu: { unit: 'g/24 h', dec: 1, normal: [0, 0.3], yMin: 0 },
  fosfato: { unit: 'mg/dL', dec: 1, normal: [2.5, 4.5], yMin: 0 },
  urico: { unit: 'mg/dL', dec: 1, normal: [2.5, 7], yMin: 0 },
  cistina: { unit: 'mg/24 h', dec: 0, normal: [0, 60], yMin: 0 },
  cistinac: { unit: 'mg/L', dec: 0, normal: [0, 250], yMin: 0 },
  pas: { unit: 'mmHg', dec: 0, normal: [100, 139] },
  renina: { unit: '× N', dec: 1, normal: [0.5, 2], yMin: 0 },
  aldo: { unit: '× N', dec: 1, normal: [0.5, 2], yMin: 0 },
  diuresis: { unit: 'L/24 h', dec: 1, normal: [0.8, 2.5], yMin: 0 },
  uosm: { unit: 'mOsm/kg', dec: 0, normal: [300, 900], yMin: 0 },
  litiasis: { unit: '', dec: 1, normal: null, yMin: 0 },
  hueso: { unit: '0–3', dec: 1, normal: [0, 0.5], yMin: 0, yMax: 3 },
  fg: { unit: 'mL/min', dec: 0, normal: [90, 130], yMin: 0 },
};

/** Baseline (healthy) values. */
export const BASE = { k: 4.2, hco3: 24, na: 140, phu: 6, mg: 2.0, ca: 9.5, cau: 2, glucu: 0.1, fosfato: 3.5, urico: 5, cistina: 30,
  pas: 120, renina: 1, aldo: 1, diuresis: 1.5, uosm: 600, hueso: 0 };

/* Spec per entity:
   seg: nephron segment; tr: transporter id(s) drawn on the schematic; mode: 'loss' | 'gain' of function;
   d: delta from baseline at full severity; resid: residual fraction with treatment (default `r`);
   lith: stones per year untreated (× severity) and `lithR` residual; fgLoss: mL/min per year; fgR residual;
   target: absolute value reached with treatment (overrides resid); treatDelta: added by treatment (fluids, alkali);
   crit: gauge + threshold that marks the main lab consequence; clin: gauge + threshold for the clinical complication. */
const SPECS = {
  fanconi: { seg: 'tcp', tr: ['sglt2', 'nhe3', 'napi', 'rbat', 'urat1'], mode: 'loss',
    d: { glucu: 5, fosfato: -1.6, urico: -2.8, hco3: -8, k: -1.1, phu: -0.7, diuresis: 1.2, hueso: 2 }, r: 0.3, resid: { glucu: 1, urico: 1 },
    tiles: ['hco3', 'k', 'fosfato', 'glucu', 'hueso'], charts: ['hco3', 'fosfato'], crit: ['hco3', '<', 20], clin: ['hueso', '>', 1] },
  glucosuria: { seg: 'tcp', tr: ['sglt2'], mode: 'loss', treat: false,
    d: { glucu: 12 }, tiles: ['glucu', 'k', 'hco3'], charts: ['glucu'], crit: ['glucu', '>', 1], clin: null },
  cistinuria: { seg: 'tcp', tr: ['rbat'], mode: 'loss',
    d: { cistina: 1300, phu: -0.4 }, r: 0.4, target: { phu: 7.5 }, treatDelta: { diuresis: 1.7 }, lith: 1.4, lithR: 0.12,
    tiles: ['cistinac', 'cistina', 'phu', 'diuresis', 'litiasis'], charts: ['cistinac', 'litiasis'], crit: ['cistinac', '>', 250], clin: ['litiasis', '>', 1] },
  hipouricemia: { seg: 'tcp', tr: ['urat1'], mode: 'loss',
    d: { urico: -3.6 }, resid: { urico: 1 }, treatDelta: { diuresis: 1, phu: 0.8 }, lith: 0.5, lithR: 0.25, fgLoss: 4, fgR: 0.2,
    tiles: ['urico', 'diuresis', 'litiasis', 'fg'], charts: ['urico', 'litiasis'], crit: ['urico', '<', 2], clin: ['litiasis', '>', 1] },
  raquitismo_x: { seg: 'tcp', tr: ['napi'], mode: 'loss',
    d: { fosfato: -1.9, hueso: 2.6 }, r: 0.35,
    tiles: ['fosfato', 'ca', 'hueso'], charts: ['fosfato', 'hueso'], crit: ['fosfato', '<', 2.5], clin: ['hueso', '>', 1] },
  cistinosis: { seg: 'tcp', tr: ['ctns', 'sglt2', 'nhe3', 'napi', 'rbat'], mode: 'loss',
    d: { glucu: 4, fosfato: -1.6, hco3: -8, k: -1.2, diuresis: 1.5, hueso: 2 }, r: 0.35, resid: { glucu: 0.8 }, fgLoss: 9, fgR: 0.25,
    tiles: ['hco3', 'k', 'fosfato', 'fg', 'hueso'], charts: ['fg', 'hco3'], crit: ['hco3', '<', 20], clin: ['fg', '<', 80] },
  atr2: { seg: 'tcp', tr: ['nbce1'], mode: 'loss',
    d: { hco3: -7, k: -0.9, phu: -0.8, hueso: 1.2 }, r: 0.25,
    tiles: ['hco3', 'k', 'phu', 'hueso'], charts: ['hco3', 'k'], crit: ['hco3', '<', 20], clin: ['hueso', '>', 0.8] },
  hipercalciuria: { seg: 'tcp', tr: ['ca'], mode: 'gain',
    d: { cau: 3.6, hueso: 0.9 }, r: 0.35, lith: 1.0, lithR: 0.25,
    tiles: ['cau', 'ca', 'litiasis', 'hueso'], charts: ['cau', 'litiasis'], crit: ['cau', '>', 4], clin: ['litiasis', '>', 1] },
  hipomagnesemia: { seg: 'tcd', tr: ['trpm6'], mode: 'loss',
    d: { mg: -1.0, ca: -1.6, k: -0.5 }, r: 0.4,
    tiles: ['mg', 'ca', 'k'], charts: ['mg', 'ca'], crit: ['mg', '<', 1.4], clin: ['ca', '<', 8.5] },
  bartter: { seg: 'asa', tr: ['nkcc2', 'romk', 'clckb'], mode: 'loss',
    d: { k: -1.8, hco3: 8, cau: 4, mg: -0.3, renina: 5, aldo: 3, diuresis: 2.5, pas: -12, uosm: -300 }, r: 0.45, resid: { cau: 0.7, diuresis: 0.7, uosm: 0.8 }, lith: 0.6, lithR: 0.5,
    tiles: ['k', 'hco3', 'renina', 'pas', 'cau'], charts: ['k', 'hco3'], crit: ['k', '<', 3], clin: ['litiasis', '>', 1] },
  gitelman: { seg: 'tcd', tr: ['ncc'], mode: 'loss',
    d: { k: -1.4, hco3: 6, cau: -1.6, mg: -0.9, renina: 3, aldo: 2, pas: -8 }, r: 0.45, resid: { mg: 0.5, cau: 1 },
    tiles: ['k', 'mg', 'hco3', 'cau', 'pas'], charts: ['k', 'mg'], crit: ['k', '<', 3.5], clin: ['mg', '<', 1.4] },
  atr1: { seg: 'colector', tr: ['hatpasa'], mode: 'loss',
    d: { hco3: -10, k: -1.3, phu: 1.0, cau: 3, hueso: 1.5 }, r: 0.15, lith: 1.0, lithR: 0.2, fgLoss: 3, fgR: 0.15,
    tiles: ['hco3', 'k', 'phu', 'cau', 'litiasis'], charts: ['hco3', 'litiasis'], crit: ['hco3', '<', 20], clin: ['litiasis', '>', 1] },
  atr4: { seg: 'colector', tr: ['mr'], mode: 'loss',
    d: { k: 1.8, hco3: -6, phu: -0.7, aldo: -0.7, renina: -0.5 }, r: 0.3, resid: { aldo: 1, renina: 1 },
    tiles: ['k', 'hco3', 'aldo', 'phu'], charts: ['k', 'hco3'], crit: ['k', '>', 5.5], clin: ['k', '>', 6] },
  pha1: { seg: 'colector', tr: ['enac', 'mr'], mode: 'loss',
    d: { k: 2.2, hco3: -6, na: -9, pas: -16, renina: 5, aldo: 6 }, r: 0.35, resid: { aldo: 0.7, renina: 0.7 },
    tiles: ['k', 'na', 'aldo', 'renina', 'pas'], charts: ['k', 'na'], crit: ['k', '>', 5.5], clin: ['na', '<', 135] },
  gordon: { seg: 'tcd', tr: ['ncc'], mode: 'gain',
    d: { k: 1.6, hco3: -4, pas: 34, renina: -0.8, aldo: -0.3, cau: 1.5 }, r: 0.05,
    tiles: ['k', 'pas', 'renina', 'hco3'], charts: ['pas', 'k'], crit: ['k', '>', 5.5], clin: ['pas', '>', 139] },
  liddle: { seg: 'colector', tr: ['enac'], mode: 'gain',
    d: { k: -1.5, hco3: 6, pas: 38, renina: -0.8, aldo: -0.8 }, r: 0.1, resid: { renina: 0.6, aldo: 0.6 },
    tiles: ['pas', 'k', 'renina', 'aldo'], charts: ['pas', 'k'], crit: ['k', '<', 3.5], clin: ['pas', '>', 139] },
  di_nefrogenica: { seg: 'colector', tr: ['v2'], mode: 'loss',
    d: { diuresis: 8, uosm: -500, na: 3 }, r: 0.5, resid: { uosm: 0.7, na: 0.3 },
    tiles: ['diuresis', 'uosm', 'na'], charts: ['diuresis', 'na'], crit: ['diuresis', '>', 3], clin: ['na', '>', 145] },
};

const R = (key, min, max, step, def, unit = '', dec = 0) => ({ key, min, max, step, def, unit, dec });
const Ch = (key, options, def) => ({ key, type: 'choice', options, def });

export const ENTITIES = Object.entries(SPECS).map(([key, s]) => ({
  key, loc: s.seg, tr: s.tr, mode: s.mode, unit: 'months', tMax: 24, dt: 0.25, treat: s.treat !== false,
  params: [R('gravedad', 1, 10, 1, 7), ...(s.treat === false ? [] : [R('inicio', 0, 18, 1, 2, '', 0)]),
    ...(key === 'di_nefrogenica' ? [Ch('agua', ['libre', 'restringida'], 'libre')] : [])],
  tiles: s.tiles, charts: s.charts,
  steps: ['defecto', 'efecto', 'laboratorio', ...(s.clin ? ['clinica'] : []), ...(s.treat === false ? [] : ['tto'])],
}));

export function defaults(key) {
  const e = ENTITIES.find(x => x.key === key);
  return Object.fromEntries(e.params.map(p => [p.key, p.def]));
}

const cmp = (v, op, th) => (op === '<' ? v < th : v > th);
/** Severity factor from the 1–10 slider (Model): 1 → 0.49, 7 → 1, 10 → 1.26. */
export const sevOf = (g) => 0.4 + 0.6 * g / 7;

export function simulate(key, params, treated = false) {
  const e = ENTITIES.find(x => x.key === key);
  if (!e) throw new Error(`unknown entity ${key}`);
  const s = SPECS[key];
  const p = { ...defaults(key), ...params };
  const sev = sevOf(p.gravedad);
  const tTx = p.inicio ?? 0;
  const d = { ...s.d };
  // no water restriction: thirst keeps sodium normal in nephrogenic DI
  if (key === 'di_nefrogenica' && p.agua === 'restringida') d.na = 14;
  const st = { ...BASE, litiasis: 0, fg: 100 };
  for (const g of Object.keys(d)) st[g] = BASE[g] + d[g] * sev * 0.7; // already partly expressed at diagnosis
  const points = [], events = [], fired = new Set();
  const emit = (t, k, args = []) => { if (fired.has(k)) return; fired.add(k); events.push({ t, key: k, args }); };
  const n = Math.round(e.tMax / e.dt);
  for (let i = 0; i <= n; i++) {
    const t = +(i * e.dt).toFixed(6);
    const on = treated && e.treat && t >= tTx;
    if (on) emit(t, 'tto');
    if (i > 0) {
      for (const g of new Set([...Object.keys(d), ...Object.keys(s.treatDelta || {})])) {
        const full = BASE[g] + (d[g] || 0) * sev;
        let target = full;
        if (on) {
          const r = s.resid?.[g] ?? s.r ?? 1;
          target = s.target?.[g] ?? BASE[g] + (d[g] || 0) * sev * r;
          target += s.treatDelta?.[g] || 0;
        }
        st[g] = approach(st[g], target, e.dt, on && target !== full ? 1.5 : 4);
      }
      const lith = (s.lith || 0) * sev * (on ? s.lithR ?? 1 : 1);
      st.litiasis += lith * e.dt / 12;
      const loss = (s.fgLoss || 0) * sev * (on ? s.fgR ?? 1 : 1);
      st.fg = Math.max(5, st.fg - loss * e.dt / 12 * (key === 'cistinosis' ? 1 + (100 - st.fg) / 60 : 1));
    }
    const g = { ...st };
    g.cistinac = g.cistina / Math.max(0.3, g.diuresis);   // urine cystine concentration; solubility ≈ 250 mg/L at pH 7
    g.k = clamp(g.k, 1.5, 8.5); g.hco3 = clamp(g.hco3, 6, 45); g.mg = Math.max(0.3, g.mg); g.fosfato = Math.max(0.5, g.fosfato);
    g.urico = Math.max(0.3, g.urico); g.uosm = Math.max(60, g.uosm); g.phu = clamp(g.phu, 4.5, 8); g.hueso = clamp(g.hueso, 0, 3);
    for (const k of Object.keys(g)) if (!Number.isFinite(g[k]) || g[k] < 0) g[k] = 0;
    // events (shared thresholds)
    if (g.k < 3.5) emit(t, 'hipok');
    if (g.k > 5.5) emit(t, 'hiperk');
    if (g.hco3 < 20) emit(t, 'acidosis');
    if (g.hco3 > 28) emit(t, 'alcalosis');
    if (g.litiasis >= 1) emit(t, 'litiasis');
    if (g.pas >= 140) emit(t, 'hta');
    if (g.mg < 1.4) emit(t, 'hipomg');
    if (g.diuresis > 3) emit(t, 'poliuria');
    if (g.na > 145) emit(t, 'hipernatremia');
    if (g.na < 135) emit(t, 'hiponatremia');
    if (g.fg < 60) emit(t, 'erc');
    if (g.hueso > 1.5) emit(t, 'raquitismo');
    const active = ['defecto', 'efecto'];
    if (s.crit && cmp(g[s.crit[0]], s.crit[1], s.crit[2])) active.push('laboratorio');
    if (s.clin && cmp(g[s.clin[0]], s.clin[1], s.clin[2])) active.push('clinica');
    if (on) active.push('tto');
    // lesion: how far the key lab value is from its baseline relative to the full defect
    const cg = s.crit[0] === 'cistinac' ? 'cistina' : s.crit[0];
    const lesion = clamp(Math.abs(g[cg] - BASE[cg]) / Math.max(1e-6, Math.abs((d[cg] || 1) * sev)), 0, 1);
    points.push({ t, g, active, lesion, badge: s.seg });
  }
  return { points, events };
}

export const PRESETS = {
  fanconi_tenofovir: { entity: 'fanconi', params: { gravedad: 6, inicio: 2 } },
  glucosuria_casual: { entity: 'glucosuria', params: { gravedad: 5 } },
  cistinuria_joven: { entity: 'cistinuria', params: { gravedad: 8, inicio: 1 } },
  cistinuria_tardia: { entity: 'cistinuria', params: { gravedad: 8, inicio: 12 } },
  hipouricemia_ejercicio: { entity: 'hipouricemia', params: { gravedad: 8, inicio: 3 } },
  raquitismo_nino: { entity: 'raquitismo_x', params: { gravedad: 8, inicio: 1 } },
  cistinosis_lactante: { entity: 'cistinosis', params: { gravedad: 8, inicio: 1 } },
  cistinosis_sin_cisteamina: { entity: 'cistinosis', params: { gravedad: 8, inicio: 18 } },
  atr2_aislada: { entity: 'atr2', params: { gravedad: 7, inicio: 2 } },
  hipercalciuria_litiasis: { entity: 'hipercalciuria', params: { gravedad: 8, inicio: 3 } },
  hipomg_tetania: { entity: 'hipomagnesemia', params: { gravedad: 9, inicio: 1 } },
  bartter_neonatal: { entity: 'bartter', params: { gravedad: 10, inicio: 1 } },
  gitelman_calambres: { entity: 'gitelman', params: { gravedad: 6, inicio: 2 } },
  atr1_nefrocalcinosis: { entity: 'atr1', params: { gravedad: 8, inicio: 6 } },
  atr4_diabetico: { entity: 'atr4', params: { gravedad: 7, inicio: 1 } },
  pha1_lactante: { entity: 'pha1', params: { gravedad: 8, inicio: 1 } },
  gordon_adolescente: { entity: 'gordon', params: { gravedad: 7, inicio: 2 } },
  liddle_hta_joven: { entity: 'liddle', params: { gravedad: 7, inicio: 2 } },
  di_nef_litio: { entity: 'di_nefrogenica', params: { gravedad: 7, inicio: 2, agua: 'libre' } },
  di_nef_sin_agua: { entity: 'di_nefrogenica', params: { gravedad: 8, inicio: 4, agua: 'restringida' } },
};
