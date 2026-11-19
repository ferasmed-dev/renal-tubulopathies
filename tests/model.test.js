import test from 'node:test';
import assert from 'node:assert/strict';
import { ENTITIES, GAUGES, PRESETS, simulate, defaults, sevOf, BASE } from '../src/model.js';
import { STR } from '../src/i18n.js';

const last = r => r.points[r.points.length - 1];
const at = (r, t) => r.points.reduce((a, b) => (Math.abs(b.t - t) < Math.abs(a.t - t) ? b : a));
const min = (r, g) => Math.min(...r.points.map(p => p.g[g]));
const max = (r, g) => Math.max(...r.points.map(p => p.g[g]));
const evs = r => r.events.map(e => e.key);

/* ---------- generic: every entity ---------- */
for (const e of ENTITIES) {
  test(`${e.key}: well-formed output (defaults, extremes, both arms)`, () => {
    const variants = [defaults(e.key)];
    for (const p of e.params.filter(q => q.type !== 'choice')) {
      variants.push({ ...defaults(e.key), [p.key]: p.min }, { ...defaults(e.key), [p.key]: p.max });
    }
    for (const p of e.params.filter(q => q.type === 'choice')) for (const o of p.options) variants.push({ ...defaults(e.key), [p.key]: o });
    for (const v of variants) for (const tr of [false, true]) {
      const r = simulate(e.key, v, tr);
      assert.equal(r.points.length, Math.round(e.tMax / e.dt) + 1);
      for (let i = 1; i < r.points.length; i++) assert.ok(r.points[i].t > r.points[i - 1].t);
      for (const pt of r.points) {
        for (const g of [...e.tiles, ...e.charts]) {
          assert.ok(Number.isFinite(pt.g[g]) && pt.g[g] >= 0, `${e.key} ${g}=${pt.g[g]}`);
          assert.ok(GAUGES[g], `gauge ${g} defined`);
        }
        for (const a of pt.active) assert.ok(e.steps.includes(a), `${e.key} unknown step ${a}`);
        assert.ok(pt.lesion >= 0 && pt.lesion <= 1);
      }
      for (const ev of r.events) assert.ok(ev.t >= 0 && ev.t <= e.tMax);
    }
  });
}

test('pure: same input → same output, params not mutated', () => {
  for (const e of ENTITIES) {
    const p = defaults(e.key); const copy = JSON.stringify(p);
    assert.deepEqual(simulate(e.key, p, true), simulate(e.key, p, true));
    assert.equal(JSON.stringify(p), copy);
  }
});

test('severity factor is 1 at the default (7) and rises with the slider; baseline values are physiological', () => {
  assert.equal(sevOf(7), 1);
  assert.ok(sevOf(10) > sevOf(1));
  assert.ok(BASE.k > 3.5 && BASE.k < 5 && BASE.hco3 === 24 && BASE.na === 140);
});

test('i18n: every key used by the model exists in ES and EN', () => {
  for (const lang of ['es', 'en']) {
    const S = STR[lang];
    for (const e of ENTITIES) {
      const E = S.ent[e.key];
      for (const f of ['name', 'what', 'params', 'sees', 'tto']) assert.ok(E[f], `${lang} ${e.key}.${f}`);
      for (const st of e.steps) assert.ok(E.steps[st], `${lang} step ${e.key}.${st}`);
      for (const p of e.params) {
        assert.ok(S.params[p.key], `${lang} param ${p.key}`);
        if (p.type === 'choice') for (const o of p.options) assert.ok(S.choice[p.key][o], `${lang} choice ${p.key}.${o}`);
      }
      for (const g of [...e.tiles, ...e.charts]) assert.ok(S.gauges[g], `${lang} gauge ${g}`);
      assert.ok(S.units[e.unit]);
      for (const tr of [false, true]) {
        const r = simulate(e.key, defaults(e.key), tr);
        for (const ev of r.events) assert.equal(typeof S.ev[ev.key], 'function', `${lang} event ${ev.key}`);
        for (const pt of r.points) if (pt.badge) assert.ok(S.badge[pt.badge], `${lang} badge ${pt.badge}`);
      }
    }
    for (const k of Object.keys(PRESETS)) assert.ok(S.presets[k], `${lang} preset ${k}`);
  }
});

/* ---------- presets ---------- */
test('presets reference valid entities and parameters', () => {
  for (const [k, pr] of Object.entries(PRESETS)) {
    const e = ENTITIES.find(x => x.key === pr.entity);
    assert.ok(e, k);
    for (const pk of Object.keys(pr.params)) assert.ok(e.params.some(p => p.key === pk), `${k}.${pk}`);
    for (const ev of [...simulate(pr.entity, pr.params, false).events, ...simulate(pr.entity, pr.params, true).events]) {
      assert.equal(typeof STR.es.ev[ev.key], 'function', `${k} event ${ev.key}`);
    }
  }
});

/* ---------- mechanisms ---------- */
const L = (k, p = {}, tr = false) => last(simulate(k, p, tr)).g;
const ev = (r, k) => r.events.find(e => e.key === k);

test('every entity with treatment moves its key lab value back towards normal; later treatment is worse', () => {
  for (const e of ENTITIES.filter(x => x.treat)) {
    const u = L(e.key), t = L(e.key, {}, true), g = e.charts[0];
    assert.ok(Math.abs(t[g] - (BASE[g] ?? t[g])) <= Math.abs(u[g] - (BASE[g] ?? u[g])) + 1e-9, `${e.key} ${g}`);
  }
  assert.ok(L('cistinuria', PRESETS.cistinuria_tardia.params, true).litiasis > L('cistinuria', PRESETS.cistinuria_joven.params, true).litiasis);
  assert.ok(L('cistinosis', PRESETS.cistinosis_sin_cisteamina.params, true).fg < L('cistinosis', PRESETS.cistinosis_lactante.params, true).fg);
});

test('Fanconi: normoglycaemic glucosuria, hypophosphataemia, hypouricaemia, proximal acidosis and hypoK', () => {
  const g = L('fanconi');
  assert.ok(g.glucu > 3 && g.fosfato < 2.5 && g.urico < 2.5 && g.hco3 < 20 && g.k < 3.5);
  assert.ok(L('fanconi', {}, true).glucu > 3, 'treatment replaces losses; glucosuria persists');
});

test('renal glucosuria: isolated glucosuria, no treatment arm', () => {
  const g = L('glucosuria');
  assert.ok(g.glucu > 5 && g.k === BASE.k && g.hco3 === BASE.hco3);
  assert.equal(ENTITIES.find(e => e.key === 'glucosuria').treat, false);
});

test('cystinuria: cystine > 250 mg/L in acid urine precipitates; fluids + alkalinisation dissolve it and stop stones', () => {
  const u = L('cistinuria', PRESETS.cistinuria_joven.params), t = L('cistinuria', PRESETS.cistinuria_joven.params, true);
  assert.ok(u.cistina > 400 && u.cistinac > 250 && u.phu < 6 && u.litiasis >= 2);
  assert.ok(t.cistinac < 250 && t.phu >= 7 && t.diuresis > 3 && t.litiasis < 1);
});

test('renal hypouricaemia: serum urate < 2 with stones; X-linked rickets: low phosphate and bone disease', () => {
  const h = L('hipouricemia');
  assert.ok(h.urico < 2 && h.litiasis > 0.5 && h.fg < 100);
  const r = L('raquitismo_x');
  assert.ok(r.fosfato < 2 && r.hueso > 2 && r.ca === BASE.ca);
  assert.ok(L('raquitismo_x', {}, true).hueso < 1.5);
});

test('cystinosis: Fanconi + progressive GFR loss; cysteamine slows it', () => {
  const u = simulate('cistinosis', PRESETS.cistinosis_lactante.params), t = simulate('cistinosis', PRESETS.cistinosis_lactante.params, true);
  assert.ok(last(u).g.fg < 85 && last(u).g.hco3 < 20 && last(t).g.fg > 90);
});

test('RTA: II low HCO3 with acid urine; I acid-alkaline urine > 5.5, hypercalciuria and stones; IV hyperK', () => {
  const a2 = L('atr2'), a1 = L('atr1'), a4 = L('atr4');
  assert.ok(a2.hco3 < 20 && a2.phu < 5.5 && a2.k < 3.5);
  assert.ok(a1.hco3 < a2.hco3 && a1.phu > 5.5 && a1.cau > 4 && a1.litiasis > 1 && a1.k < 3.5);
  assert.ok(a4.k > 5.5 && a4.hco3 < 22 && a4.phu < 5.5);
});

test('idiopathic hypercalciuria: urine Ca > 4 mg/kg/day with normal serum Ca; thiazide lowers it', () => {
  const u = L('hipercalciuria'), t = L('hipercalciuria', {}, true);
  assert.ok(u.cau > 4 && u.ca === BASE.ca && u.litiasis > 1);
  assert.ok(t.cau < 4 && t.litiasis < u.litiasis);
});

test('hypomagnesaemia: Mg < 1.4 with secondary hypocalcaemia', () => {
  const g = L('hipomagnesemia');
  assert.ok(g.mg < 1.4 && g.ca < 8.5);
});

test('Bartter vs Gitelman: both hypoK alkalosis with high renin and normal/low BP; calciuria high vs low; Gitelman low Mg', () => {
  const b = L('bartter'), g = L('gitelman');
  for (const x of [b, g]) assert.ok(x.k < 3.5 && x.hco3 > 28 && x.renina > 2 && x.pas < 120);
  assert.ok(b.cau > 4 && g.cau < 1);
  assert.ok(g.mg < 1.4 && b.mg > g.mg);
  assert.ok(b.diuresis > 3 && b.k < g.k);
});

test('PHA I: hyperK, hypoNa, low BP with HIGH aldosterone and renin; Gordon: hyperK with HTA and suppressed renin; thiazide fixes Gordon', () => {
  const p = L('pha1');
  assert.ok(p.k > 5.5 && p.na < 135 && p.aldo > 3 && p.renina > 3 && p.pas < 110);
  const g = L('gordon');
  assert.ok(g.k > 5.5 && g.pas > 140 && g.renina < 0.5);
  assert.ok(L('gordon', {}, true).pas < 130);
});

test('Liddle: HTA + hypoK + alkalosis with renin AND aldosterone suppressed; amiloride corrects it', () => {
  const g = L('liddle');
  assert.ok(g.pas > 140 && g.k < 3.5 && g.hco3 > 28 && g.renina < 0.5 && g.aldo < 0.5);
  const t = L('liddle', {}, true);
  assert.ok(t.pas < 130 && t.k > 3.5);
});

test('nephrogenic DI: polyuria with dilute urine; hypernatraemia only without free access to water; thiazide reduces urine output', () => {
  const free = L('di_nefrogenica', { agua: 'libre' }), restr = L('di_nefrogenica', { agua: 'restringida' });
  assert.ok(free.diuresis > 6 && free.uosm < 200 && free.na <= 145);
  assert.ok(restr.na > 150);
  assert.ok(L('di_nefrogenica', {}, true).diuresis < free.diuresis * 0.7);
});
