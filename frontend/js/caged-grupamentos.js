const CAGED_GRUP_CSV_URL =
  "https://docs.google.com/spreadsheets/d/e/2PACX-1vQonzVybY3GpyG0D-l5xCoWMfd_OKDUQPo7gjPzl6_VWd7mDroCO_VypQvYM7elL-ZelYrS76CJcjYS/pub?gid=0&single=true&output=csv";

const CG_GRUPO_OPTIONS = [
  { key: "agropecuaria", label: "Agropecuária" },
  { key: "comercio", label: "Comércio" },
  { key: "construcao", label: "Construção" },
  { key: "industria", label: "Indústria" },
  { key: "servicos", label: "Serviços" },
  { key: "nao_identificado", label: "Não Identificado" },
];

const CG_GRUPO_TODOS_KEY = "todos";
const CG_METRIC_TODOS_KEY = "todos";

const CG_METRIC_OPTIONS = [
  { key: "estoque", label: "Estoque mensal", field: "estoque" },
  { key: "admitidos", label: "Admitidos", field: "admitidos" },
  { key: "desligados", label: "Desligados", field: "desligados" },
  { key: "saldo", label: "Saldo", field: "saldo" },
];

const CG_BAR_FORMALIZACAO_COLOR = "#1d4ed8";
const CG_BAR_SALDO_COLOR = "#1e40af";
const CG_LINE_COLORS = ["#7c3aed", "#0d9488", "#ea580c", "#2563eb", "#db2777", "#64748b"];
const CG_MUN_LINE_COLORS = ["#2563eb", "#ea580c", "#7c3aed", "#0d9488", "#db2777"];
const CG_MUN_LINE_MAX = 5;

const CG_TABLE_GRUPO_ORDER = [
  "agropecuaria",
  "industria",
  "construcao",
  "comercio",
  "servicos",
  "nao_identificado",
];

const cgCharts = {};

const cgState = {
  rows: [],
  loading: false,
  loaded: false,
  error: null,
  municipiosList: [],
};

const cgFmt = new Intl.NumberFormat("pt-BR");

let cgMunSearchTimer = null;

function cgNormGrupoKey(label) {
  const n = String(label ?? "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .trim();
  if (n.includes("agropec")) return "agropecuaria";
  if (n.includes("comerc")) return "comercio";
  if (n.includes("constru")) return "construcao";
  if (n.includes("industr")) return "industria";
  if (n.includes("servic")) return "servicos";
  if (n.includes("nao ident") || n === "nao identificado") return "nao_identificado";
  return n.replace(/\s+/g, "_");
}

function cgGrupoLabel(key) {
  if (key === CG_GRUPO_TODOS_KEY) return "Todos os grupamentos";
  return CG_GRUPO_OPTIONS.find((g) => g.key === key)?.label || key;
}

function cgMetricLabel(key) {
  if (key === CG_METRIC_TODOS_KEY) return "Todos os indicadores";
  return CG_METRIC_OPTIONS.find((m) => m.key === key)?.label || key;
}

function cgParseCsvLine(line) {
  const out = [];
  let cur = "";
  let inQ = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (c === '"') {
      if (inQ && line[i + 1] === '"') {
        cur += '"';
        i++;
        continue;
      }
      inQ = !inQ;
      continue;
    }
    if (!inQ && c === ",") {
      out.push(cur.trim());
      cur = "";
      continue;
    }
    cur += c;
  }
  out.push(cur.trim());
  return out;
}

function cgParseNumber(raw) {
  const s = String(raw ?? "").trim();
  if (!s) return 0;
  const n = Number(s.replace(/\./g, "").replace(",", "."));
  return Number.isFinite(n) ? n : 0;
}

function cgNormalizeCodigo(raw) {
  const cod = parseInt(String(raw ?? "").trim(), 10);
  if (!Number.isFinite(cod) || cod <= 0) return null;
  if (cod >= 1_000_000) return Math.floor(cod / 10);
  return cod;
}

function cgParseReferencia(raw) {
  const s = String(raw || "").trim();
  const m = /^(\d{1,2})\/(\d{4})$/.exec(s);
  if (!m) return null;
  const month = Number(m[1]);
  const year = Number(m[2]);
  if (month < 1 || month > 12) return null;
  return { year, month, mesAnoKey: `${year}-${String(month).padStart(2, "0")}` };
}

function cgMesAnoKeyRank(key) {
  const m = /^(\d{4})-(\d{2})$/.exec(String(key || ""));
  if (!m) return 0;
  return parseInt(m[1], 10) * 12 + parseInt(m[2], 10);
}

function cgParseCsvRows(text) {
  const raw = String(text || "").replace(/^\uFEFF/, "");
  const lines = raw.split(/\r?\n/).filter((l) => l.trim());
  if (!lines.length) return [];

  const header = cgParseCsvLine(lines[0]).map((h) => h.trim());
  const idx = Object.fromEntries(header.map((h, i) => [h, i]));
  const pick = (cells, key) => cells[idx[key]] ?? "";

  const rows = [];
  for (let i = 1; i < lines.length; i++) {
    const cells = cgParseCsvLine(lines[i]);
    if (!cells.length) continue;
    const codigo = cgNormalizeCodigo(pick(cells, "Codigo_Municipio"));
    const municipio = pick(cells, "Municipio");
    if (codigo == null || !municipio) continue;
    const ref = cgParseReferencia(pick(cells, "Referencia"));
    const grupoKey = cgNormGrupoKey(pick(cells, "Grande_Grupamento"));
    rows.push({
      codigo,
      municipio,
      referencia: pick(cells, "Referencia"),
      ano: ref?.year ?? null,
      mesAnoKey: ref?.mesAnoKey ?? "",
      grandeGrupamento: pick(cells, "Grande_Grupamento"),
      grupoKey,
      admitidos: cgParseNumber(pick(cells, "Admitidos")),
      desligados: cgParseNumber(pick(cells, "Desligados")),
      saldo: cgParseNumber(pick(cells, "Saldo")),
      estoque: cgParseNumber(pick(cells, "Estoque_Mensal")),
      tempoEmprego: cgParseNumber(pick(cells, "Tempo_Emprego_Desligados")),
    });
  }
  return rows;
}

function cgBuildMunicipiosIndex() {
  const munMap = new Map();
  for (const row of cgState.rows) {
    if (!munMap.has(row.codigo)) munMap.set(row.codigo, row.municipio);
  }
  cgState.municipiosList = [...munMap.entries()]
    .map(([codigo, municipio]) => ({ codigo, municipio }))
    .sort((a, b) => a.municipio.localeCompare(b.municipio, "pt-BR"));
}

function cgPopulateAnoFilter() {
  const sel = document.getElementById("mapFilterAno");
  if (!sel) return;
  const prev = new Set(Array.from(sel.selectedOptions).map((o) => o.value));
  const years = [...new Set(cgState.rows.map((r) => r.ano).filter((y) => Number.isFinite(y)))].sort(
    (a, b) => a - b
  );
  sel.innerHTML = "";
  for (const y of years) {
    const opt = document.createElement("option");
    opt.value = String(y);
    opt.textContent = String(y);
    if (prev.has(String(y))) opt.selected = true;
    sel.appendChild(opt);
  }
}

function cgRebuildMesFilter() {
  const sel = document.getElementById("mapFilterMes");
  const anoSel = cgGetSelectedAnos();
  if (!sel) return;
  const prev = new Set(Array.from(sel.selectedOptions).map((o) => o.value));
  const keys = new Set();
  for (const row of cgState.rows) {
    if (!row.mesAnoKey) continue;
    if (anoSel.length && !anoSel.includes(String(row.ano))) continue;
    keys.add(row.mesAnoKey);
  }
  const sorted = [...keys].sort((a, b) => cgMesAnoKeyRank(a) - cgMesAnoKeyRank(b));
  sel.innerHTML = "";
  for (const key of sorted) {
    const opt = document.createElement("option");
    opt.value = key;
    opt.textContent =
      typeof window.ceRegioesMapApi?.formatMesAnoKey === "function"
        ? window.ceRegioesMapApi.formatMesAnoKey(key)
        : key;
    if (prev.has(key)) opt.selected = true;
    sel.appendChild(opt);
  }
}

function cgRebuildMunicipioOptions(preferredSelection) {
  const sel = document.getElementById("mapFilterMunicipio");
  const searchEl = document.getElementById("mapFilterMunSearch");
  if (!sel || !cgState.municipiosList.length) return;

  const regSel = cgGetSelectedRegioes();
  let pool = cgState.municipiosList;
  if (regSel.length && typeof window.ceRegioesMapApi?.getRegiaoToCodigos === "function") {
    const regMap = window.ceRegioesMapApi.getRegiaoToCodigos();
    const allowed = new Set();
    for (const reg of regSel) {
      const set = regMap.get(reg);
      if (!set) continue;
      for (const c of set) allowed.add(String(c));
    }
    pool = pool.filter((item) => allowed.has(String(item.codigo)));
  }

  const q = (searchEl?.value || "").trim().toLowerCase();
  const selected =
    preferredSelection !== undefined
      ? preferredSelection
      : new Set(Array.from(sel.selectedOptions).map((o) => o.value));

  sel.innerHTML = "";
  for (const item of pool) {
    const codStr = String(item.codigo);
    const match = !q || item.municipio.toLowerCase().includes(q);
    const isSel = selected.has(codStr);
    if (!match && !isSel) continue;
    const opt = document.createElement("option");
    opt.value = codStr;
    opt.textContent = item.municipio;
    if (isSel) opt.selected = true;
    sel.appendChild(opt);
  }
}

function cgSyncMunicipiosFromRegiao() {
  if (!cgState.municipiosList.length) return;
  const regSel = cgGetSelectedRegioes();
  const codes = new Set();
  if (regSel.length && typeof window.ceRegioesMapApi?.getRegiaoToCodigos === "function") {
    const regMap = window.ceRegioesMapApi.getRegiaoToCodigos();
    const valid = new Set(cgState.municipiosList.map((m) => String(m.codigo)));
    for (const reg of regSel) {
      const set = regMap.get(reg);
      if (!set) continue;
      for (const c of set) {
        const cs = String(c);
        if (valid.has(cs)) codes.add(cs);
      }
    }
  }
  cgRebuildMunicipioOptions(codes);
}

function cgClearMunicipioSelection() {
  const search = document.getElementById("mapFilterMunSearch");
  if (search) search.value = "";
  cgRebuildMunicipioOptions(new Set());
}

function cgSelectSingleMunicipioFromMap(codigo) {
  const codStr = String(codigo ?? "").trim();
  if (!codStr) return;
  const exists = cgState.municipiosList.some((m) => String(m.codigo) === codStr);
  if (!exists) return;
  const search = document.getElementById("mapFilterMunSearch");
  if (search) search.value = "";
  cgRebuildMunicipioOptions(new Set([codStr]));
  cgRefreshAll();
}

function cgGetSelectedAnos() {
  const sel = document.getElementById("mapFilterAno");
  if (!sel) return [];
  return Array.from(sel.selectedOptions)
    .map((o) => String(o.value || ""))
    .filter(Boolean);
}

function cgGetSelectedMesKeys() {
  const sel = document.getElementById("mapFilterMes");
  if (!sel) return [];
  return Array.from(sel.selectedOptions)
    .map((o) => String(o.value || ""))
    .filter(Boolean);
}

function cgGetSelectedMunicipioCodes() {
  const sel = document.getElementById("mapFilterMunicipio");
  if (!sel) return [];
  return Array.from(sel.selectedOptions)
    .map((o) => String(o.value || ""))
    .filter(Boolean);
}

function cgGetSelectedRegioes() {
  const sel = document.getElementById("mapFilterRegiao");
  if (!sel) return [];
  return Array.from(sel.selectedOptions)
    .map((o) => String(o.value || ""))
    .filter(Boolean);
}

function cgGetSelectedGrupoKey() {
  const el = document.getElementById("mapCagedGrupLayerStyle");
  const v = el?.value || CG_GRUPO_TODOS_KEY;
  if (v === CG_GRUPO_TODOS_KEY) return CG_GRUPO_TODOS_KEY;
  return CG_GRUPO_OPTIONS.some((g) => g.key === v) ? v : CG_GRUPO_TODOS_KEY;
}

function cgGetSelectedMetricKey() {
  const el = document.getElementById("mapCagedGrupMetricStyle");
  const v = el?.value || CG_METRIC_TODOS_KEY;
  if (v === CG_METRIC_TODOS_KEY) return CG_METRIC_TODOS_KEY;
  return CG_METRIC_OPTIONS.some((m) => m.key === v) ? v : CG_METRIC_TODOS_KEY;
}

function cgRowsForGrupo(rows, grupoKey) {
  return grupoKey === CG_GRUPO_TODOS_KEY ? rows : rows.filter((r) => r.grupoKey === grupoKey);
}

function cgFilterRows(rows) {
  const anos = cgGetSelectedAnos();
  const meses = cgGetSelectedMesKeys();
  const muns = cgGetSelectedMunicipioCodes();
  const regs = cgGetSelectedRegioes();
  let allowedByReg = null;
  if (regs.length && typeof window.ceRegioesMapApi?.getRegiaoToCodigos === "function") {
    allowedByReg = new Set();
    const regMap = window.ceRegioesMapApi.getRegiaoToCodigos();
    for (const reg of regs) {
      const set = regMap.get(reg);
      if (!set) continue;
      for (const c of set) allowedByReg.add(String(c));
    }
  }

  return rows.filter((row) => {
    if (anos.length && !anos.includes(String(row.ano))) return false;
    if (meses.length && !meses.includes(row.mesAnoKey)) return false;
    if (muns.length && !muns.includes(String(row.codigo))) return false;
    if (allowedByReg && !allowedByReg.has(String(row.codigo))) return false;
    return true;
  });
}

function cgLatestMesAnoKeyInRows(rows) {
  let bestRank = -1;
  let bestKey = "";
  for (const row of rows) {
    if (!row.mesAnoKey) continue;
    const rk = cgMesAnoKeyRank(row.mesAnoKey);
    if (rk > bestRank) {
      bestRank = rk;
      bestKey = row.mesAnoKey;
    }
  }
  return bestRank > 0 ? bestKey : "";
}

function cgEmptyMunAgg(municipio = "", codigo = null) {
  return {
    codigo,
    municipio,
    estoque: 0,
    admitidos: 0,
    desligados: 0,
    saldo: 0,
  };
}

function cgAggregateByCodigoAtMonths(rows, grupoKey) {
  const grupoRows = cgRowsForGrupo(rows, grupoKey);
  /** @type {Map<string, Map<number, ReturnType<typeof cgEmptyMunAgg>>>} */
  const byMonth = new Map();
  for (const row of grupoRows) {
    if (!row.mesAnoKey) continue;
    let byCod = byMonth.get(row.mesAnoKey);
    if (!byCod) {
      byCod = new Map();
      byMonth.set(row.mesAnoKey, byCod);
    }
    const cur = byCod.get(row.codigo) || cgEmptyMunAgg(row.municipio, row.codigo);
    byCod.set(row.codigo, {
      codigo: row.codigo,
      municipio: cur.municipio || row.municipio,
      estoque: cur.estoque + row.estoque,
      admitidos: cur.admitidos + row.admitidos,
      desligados: cur.desligados + row.desligados,
      saldo: cur.saldo + row.saldo,
    });
  }
  return byMonth;
}

function cgGetMunicipioMetricFromMonthAgg(monthAgg, codigo, metricField) {
  if (!monthAgg) return null;
  const cod = parseInt(String(codigo), 10);
  const vals = monthAgg.get(cod);
  if (!vals) return null;
  const value = vals[metricField];
  return Number.isFinite(value) ? value : null;
}

function cgAggregateByCodigo(rows, grupoKey) {
  const grupoRows = cgRowsForGrupo(rows, grupoKey);
  const latestMesKey = cgLatestMesAnoKeyInRows(grupoRows);
  const byMonth = cgAggregateByCodigoAtMonths(rows, grupoKey);
  /** @type {Map<number, ReturnType<typeof cgEmptyMunAgg>>} */
  const byCod = new Map();

  for (const monthAgg of byMonth.values()) {
    for (const [cod, vals] of monthAgg) {
      const cur = byCod.get(cod) || cgEmptyMunAgg(vals.municipio, cod);
      byCod.set(cod, {
        codigo: cod,
        municipio: cur.municipio || vals.municipio,
        estoque: cur.estoque,
        admitidos: cur.admitidos + vals.admitidos,
        desligados: cur.desligados + vals.desligados,
        saldo: cur.saldo + vals.saldo,
      });
    }
  }

  if (latestMesKey) {
    const latestAgg = byMonth.get(latestMesKey);
    if (latestAgg) {
      for (const [cod, vals] of latestAgg) {
        const cur = byCod.get(cod) || cgEmptyMunAgg(vals.municipio, cod);
        byCod.set(cod, {
          ...cur,
          codigo: cod,
          municipio: cur.municipio || vals.municipio,
          estoque: vals.estoque,
        });
      }
    }
  }

  return byCod;
}

function cgFmtPct(val, digits = 2) {
  return new Intl.NumberFormat("pt-BR", {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  }).format(Number(val) || 0);
}

function cgMesAnoLabel(key) {
  return typeof window.ceRegioesMapApi?.formatMesAnoKey === "function"
    ? window.ceRegioesMapApi.formatMesAnoKey(key)
    : key;
}

function cgPreviousMesAnoKey(latestKey, rows) {
  const latestRank = cgMesAnoKeyRank(latestKey);
  let bestRank = -1;
  let bestKey = "";
  for (const row of rows) {
    const rk = cgMesAnoKeyRank(row.mesAnoKey);
    if (rk < latestRank && rk > bestRank) {
      bestRank = rk;
      bestKey = row.mesAnoKey;
    }
  }
  return bestKey;
}

function cgDestroyChart(key) {
  const chart = cgCharts[key];
  if (!chart) return;
  try {
    chart.destroy();
  } catch (_) {}
  cgCharts[key] = null;
}

function cgDestroyCharts() {
  for (const key of Object.keys(cgCharts)) cgDestroyChart(key);
}

function cgGetMetricField(metricKey) {
  if (metricKey === CG_METRIC_TODOS_KEY) return "estoque";
  return CG_METRIC_OPTIONS.find((m) => m.key === metricKey)?.field || "estoque";
}

const CG_RANKING_TOP_N = 15;

function cgGetSelectedRankOrder() {
  const el = document.getElementById("cgRankOrder");
  return el?.value === "menores" ? "menores" : "maiores";
}

function cgRankOrderLabel(order) {
  return order === "menores" ? "15 menores" : "15 maiores";
}

function cgSortRankingRows(rows, order) {
  rows.sort((a, b) => {
    const cmp = order === "maiores" ? b.value - a.value : a.value - b.value;
    return cmp || a.label.localeCompare(b.label, "pt-BR");
  });
  return rows;
}

function cgPickMunicipioRankingEntries(aggByCod, field, order = cgGetSelectedRankOrder()) {
  const rows = [];
  for (const [, vals] of aggByCod.entries()) {
    const value = vals[field];
    if (!Number.isFinite(value)) continue;
    rows.push({
      codigo: vals.codigo,
      label: vals.municipio || `Código ${vals.codigo}`,
      value,
    });
  }
  return cgSortRankingRows(rows, order).slice(0, CG_RANKING_TOP_N);
}

function cgPickRegiaoRankingEntries(aggByCod, field, order = cgGetSelectedRankOrder()) {
  const regMap = window.ceRegioesMapApi?.getRegiaoToCodigos?.();
  if (!regMap) return [];
  const rows = [];
  for (const [regName, codSet] of regMap.entries()) {
    let sum = 0;
    for (const cod of codSet) {
      const v = aggByCod.get(cod);
      if (v && Number.isFinite(v[field])) sum += v[field];
    }
    rows.push({ label: regName, value: sum });
  }
  return cgSortRankingRows(rows, order).slice(0, CG_RANKING_TOP_N);
}

function cgBuildRankingBarConfig(entries, color, seriesName) {
  const hasData = entries.length > 0;
  const data = hasData ? entries.map((e) => ({ x: e.label, y: e.value })) : [{ x: "Sem dados no filtro", y: 0 }];
  const height = Math.max(280, 48 + Math.max(entries.length || 1, 1) * 28);
  const valFmt = (val) => cgFmt.format(Number(val) || 0);
  return {
    config: {
      chart: {
        type: "bar",
        height,
        toolbar: { show: false },
        zoom: { enabled: false },
        animations: { speed: 260 },
        fontFamily: "system-ui, Segoe UI, sans-serif",
        foreColor: "#1f2d78",
      },
      plotOptions: {
        bar: {
          horizontal: true,
          barHeight: "72%",
          borderRadius: 4,
          borderRadiusApplication: "end",
        },
      },
      colors: [color],
      series: [{ name: seriesName, data }],
      xaxis: {
        type: "category",
        labels: { formatter: (v) => valFmt(v), style: { fontSize: "11px", colors: "#475569" } },
      },
      yaxis: {
        labels: {
          maxWidth: 160,
          style: { fontSize: "11px", colors: "#1f2d78" },
        },
      },
      grid: {
        borderColor: "#e2e8f0",
        padding: { left: 12, right: 18, top: 8, bottom: 8 },
      },
      dataLabels: {
        enabled: hasData,
        formatter: (val) => valFmt(val),
        style: { fontSize: "10px", fontWeight: 600, colors: ["#fff"] },
        offsetX: -8,
      },
      tooltip: {
        y: { formatter: (val) => valFmt(val) },
      },
    },
    height,
  };
}

function cgUpdateRankingHints(order) {
  const metricKey = cgGetSelectedMetricKey();
  const metricLabel = cgMetricLabel(metricKey);
  const grupoLabel = cgGrupoLabel(cgGetSelectedGrupoKey());
  const mapMetricNote =
    metricKey === CG_METRIC_TODOS_KEY ? " · mapa por estoque mensal" : "";
  const orderNote = cgRankOrderLabel(order);
  const headHint = document.getElementById("cgRankingsHeadHint");
  if (headHint) {
    headHint.textContent = `${metricLabel}${mapMetricNote} · ${grupoLabel} · ${orderNote} · valor absoluto no recorte dos filtros · mesmos filtros do mapa`;
  }
}

function cgUpdateRankingCharts(filtered, grupoKey) {
  if (typeof ApexCharts === "undefined") return;
  const metricKey = cgGetSelectedMetricKey();
  const metricField = cgGetMetricField(metricKey);
  const metricLabel = cgMetricLabel(metricKey);
  const order = cgGetSelectedRankOrder();
  const aggByCod = cgAggregateByCodigo(filtered, grupoKey);
  const munEntries = cgPickMunicipioRankingEntries(aggByCod, metricField, order);
  const regEntries = cgPickRegiaoRankingEntries(aggByCod, metricField, order);
  cgUpdateRankingHints(order);

  const munEl = document.getElementById("cgChartFormalizacaoMun");
  if (munEl) {
    cgDestroyChart("formMun");
    const { config } = cgBuildRankingBarConfig(munEntries, CG_BAR_FORMALIZACAO_COLOR, metricLabel);
    const chart = new ApexCharts(munEl, config);
    chart.render();
    cgCharts.formMun = chart;
  }

  const regEl = document.getElementById("cgChartFormalizacaoReg");
  if (regEl) {
    cgDestroyChart("formReg");
    const { config } = cgBuildRankingBarConfig(regEntries, CG_BAR_FORMALIZACAO_COLOR, metricLabel);
    const chart = new ApexCharts(regEl, config);
    chart.render();
    cgCharts.formReg = chart;
  }
}

function cgBuildEstoqueLineSeries(rows) {
  /** @type {Map<string, Map<string, number>>} */
  const byMonth = new Map();
  for (const row of rows) {
    if (!row.mesAnoKey) continue;
    let monthMap = byMonth.get(row.mesAnoKey);
    if (!monthMap) {
      monthMap = new Map();
      byMonth.set(row.mesAnoKey, monthMap);
    }
    monthMap.set(row.grupoKey, (monthMap.get(row.grupoKey) || 0) + row.estoque);
  }
  const keys = [...byMonth.keys()].sort((a, b) => cgMesAnoKeyRank(a) - cgMesAnoKeyRank(b));
  const categories = keys.length ? keys.map(cgMesAnoLabel) : ["Sem dados no filtro"];
  const series = CG_GRUPO_OPTIONS.map((g) => ({
    name: g.label,
    data: keys.length ? keys.map((k) => byMonth.get(k)?.get(g.key) ?? 0) : [0],
  }));
  return { categories, series, hasData: keys.length > 0 };
}

function cgUpdateLineChart(rows) {
  if (typeof ApexCharts === "undefined") return;
  const el = document.getElementById("cgChartLineEstoque");
  if (!el) return;
  cgDestroyChart("line");
  const { categories, series, hasData } = cgBuildEstoqueLineSeries(rows);
  const chart = new ApexCharts(el, {
    chart: {
      type: "line",
      height: 420,
      toolbar: { show: false },
      zoom: { enabled: false },
      fontFamily: "system-ui, Segoe UI, sans-serif",
      foreColor: "#1f2d78",
      animations: { speed: 320 },
    },
    series: hasData ? series : CG_GRUPO_OPTIONS.map((g) => ({ name: g.label, data: [0] })),
    xaxis: {
      categories,
      labels: {
        rotate: hasData && categories.length > 8 ? -35 : 0,
        style: { fontSize: "11px", colors: "#475569" },
      },
      axisBorder: { color: "#cbd5e1" },
      axisTicks: { show: false },
    },
    yaxis: {
      labels: { formatter: (v) => cgFmt.format(v), style: { fontSize: "11px", colors: "#475569" } },
      min: 0,
    },
    stroke: { curve: "smooth", width: 3 },
    colors: CG_LINE_COLORS,
    markers: { size: hasData ? 4 : 0, strokeWidth: 2, hover: { size: 6 } },
    legend: { position: "top", horizontalAlign: "left", fontSize: "11px", fontWeight: 600 },
    grid: {
      borderColor: "#e2e8f0",
      strokeDashArray: 4,
      padding: { left: 8, right: 12, top: 10, bottom: 4 },
    },
    tooltip: {
      shared: true,
      intersect: false,
      y: { formatter: (v) => cgFmt.format(v) },
    },
  });
  chart.render();
  cgCharts.line = chart;
}

function cgMunicipioName(codigo) {
  const codStr = String(codigo);
  const fromList = cgState.municipiosList.find((m) => String(m.codigo) === codStr);
  if (fromList) return fromList.municipio;
  const fromRow = cgState.rows.find((r) => String(r.codigo) === codStr);
  return fromRow?.municipio || `Código ${codStr}`;
}

function cgPickMunicipiosForLineChart(filtered, grupoKey, metricField, order = cgGetSelectedRankOrder()) {
  const aggByCod = cgAggregateByCodigo(filtered, grupoKey);
  const ranked = cgPickMunicipioRankingEntries(aggByCod, metricField, order);
  return ranked.slice(0, CG_MUN_LINE_MAX).map((e) => String(e.codigo));
}

function cgBuildMunicipioLineSeries(rows, grupoKey, metricField, codigos) {
  if (!codigos.length) {
    return { categories: ["Sem dados no filtro"], series: [], hasData: false, emptyMessage: true };
  }

  const byMonth = cgAggregateByCodigoAtMonths(rows, grupoKey);
  const keys = [...byMonth.keys()].sort((a, b) => cgMesAnoKeyRank(a) - cgMesAnoKeyRank(b));
  const categories = keys.length ? keys.map(cgMesAnoLabel) : ["Sem dados no filtro"];
  const series = codigos.map((cod) => ({
    name: cgMunicipioName(cod),
    data: keys.length
      ? keys.map((k) => cgGetMunicipioMetricFromMonthAgg(byMonth.get(k), cod, metricField))
      : [0],
  }));
  const hasData =
    keys.length > 0 &&
    series.some((s) => s.data.some((v) => Number.isFinite(v) && v !== 0));

  return { categories, series, hasData, emptyMessage: false };
}

function cgUpdateMunicipioLineHint(codigos, metricKey, grupoKey, rankedTotal, order) {
  const el = document.getElementById("cgChartLineMunicipioHint");
  if (!el) return;
  const metricLabel = cgMetricLabel(metricKey);
  const grupoLabel = cgGrupoLabel(grupoKey);
  const orderWord = order === "menores" ? "menores" : "maiores";
  if (!codigos.length) {
    el.textContent = `${metricLabel} · ${grupoLabel} · sem dados no recorte dos filtros`;
    return;
  }
  const munNote =
    rankedTotal > CG_MUN_LINE_MAX
      ? `${CG_MUN_LINE_MAX} ${orderWord} municípios no recorte (de ${rankedTotal} com dados)`
      : `${codigos.length} município${codigos.length > 1 ? "s" : ""} no recorte (${orderWord})`;
  el.textContent = `${metricLabel} · ${grupoLabel} · ${munNote} · mesma métrica do gráfico por município · evolução mensal`;
}

function cgUpdateMunicipioLineChart(rows) {
  if (typeof ApexCharts === "undefined") return;
  const el = document.getElementById("cgChartLineMunicipio");
  if (!el) return;

  cgDestroyChart("lineMun");
  const metricKey = cgGetSelectedMetricKey();
  const metricField = cgGetMetricField(metricKey);
  const grupoKey = cgGetSelectedGrupoKey();
  const order = cgGetSelectedRankOrder();
  const aggByCod = cgAggregateByCodigo(rows, grupoKey);
  const ranked = cgPickMunicipioRankingEntries(aggByCod, metricField, order);
  const codigos = cgPickMunicipiosForLineChart(rows, grupoKey, metricField, order);
  cgUpdateMunicipioLineHint(codigos, metricKey, grupoKey, ranked.length, order);

  const { categories, series, hasData, emptyMessage } = cgBuildMunicipioLineSeries(
    rows,
    grupoKey,
    metricField,
    codigos
  );

  const chart = new ApexCharts(el, {
    chart: {
      type: "line",
      height: 420,
      toolbar: { show: false },
      zoom: { enabled: false },
      fontFamily: "system-ui, Segoe UI, sans-serif",
      foreColor: "#1f2d78",
      animations: { speed: 320 },
    },
    series: hasData
      ? series
      : emptyMessage
        ? [{ name: "—", data: [0] }]
        : codigos.map((cod) => ({ name: cgMunicipioName(cod), data: [0] })),
    xaxis: {
      categories,
      labels: {
        rotate: categories.length > 8 ? -35 : 0,
        style: { fontSize: "11px", colors: "#475569" },
      },
      axisBorder: { color: "#cbd5e1" },
      axisTicks: { show: false },
    },
    yaxis: {
      labels: { formatter: (v) => cgFmt.format(v), style: { fontSize: "11px", colors: "#475569" } },
      ...(metricField === "saldo" ? {} : { min: 0 }),
    },
    stroke: { curve: "smooth", width: 3 },
    colors: CG_MUN_LINE_COLORS,
    markers: { size: hasData ? 4 : 0, strokeWidth: 2, hover: { size: 6 } },
    legend: {
      position: "top",
      horizontalAlign: "left",
      fontSize: "11px",
      fontWeight: 600,
      show: hasData || (!emptyMessage && codigos.length > 0),
    },
    grid: {
      borderColor: "#e2e8f0",
      strokeDashArray: 4,
      padding: { left: 8, right: 12, top: 10, bottom: 4 },
    },
    tooltip: {
      shared: true,
      intersect: false,
      y: { formatter: (v) => (Number.isFinite(v) ? cgFmt.format(v) : "—") },
    },
  });
  chart.render();
  cgCharts.lineMun = chart;
}

function cgBuildSaldoGrupoSeries(rows) {
  const sums = new Map(CG_GRUPO_OPTIONS.map((g) => [g.key, 0]));
  for (const row of rows) {
    sums.set(row.grupoKey, (sums.get(row.grupoKey) || 0) + row.saldo);
  }
  return CG_GRUPO_OPTIONS.map((g) => ({
    label: g.label,
    value: sums.get(g.key) || 0,
  })).sort((a, b) => b.value - a.value);
}

function cgUpdateSaldoChart(rows) {
  if (typeof ApexCharts === "undefined") return;
  const el = document.getElementById("cgChartSaldoGrupo");
  if (!el) return;
  cgDestroyChart("saldo");
  const items = cgBuildSaldoGrupoSeries(rows);
  const hasData = items.some((i) => i.value !== 0);
  const categories = hasData ? items.map((i) => i.label) : ["Sem dados no filtro"];
  const data = hasData ? items.map((i) => i.value) : [0];
  const height = Math.max(260, 48 + categories.length * 36);
  const chart = new ApexCharts(el, {
    chart: {
      type: "bar",
      height,
      toolbar: { show: false },
      fontFamily: "system-ui, Segoe UI, sans-serif",
      foreColor: "#1f2d78",
    },
    series: [{ name: "Saldo", data }],
    colors: [CG_BAR_SALDO_COLOR],
    plotOptions: {
      bar: {
        horizontal: true,
        barHeight: "72%",
        borderRadius: 4,
        borderRadiusApplication: "end",
      },
    },
    xaxis: {
      categories,
      labels: { formatter: (v) => cgFmt.format(v), style: { fontSize: "11px" } },
    },
    yaxis: {
      labels: { style: { fontSize: "11px", colors: "#1f2d78" } },
    },
    grid: { borderColor: "#e2e8f0", padding: { left: 8, right: 14 } },
    dataLabels: {
      enabled: hasData,
      formatter: (v) => cgFmt.format(v),
      style: { fontSize: "10px", fontWeight: 600, colors: ["#fff"] },
      offsetX: -6,
    },
    tooltip: { y: { formatter: (v) => cgFmt.format(v) } },
  });
  chart.render();
  cgCharts.saldo = chart;
}

function cgComputeGrupoTableRow(rows, grupoKey) {
  const grupoRows = rows.filter((r) => r.grupoKey === grupoKey);
  const latestKey = cgLatestMesAnoKeyInRows(grupoRows);
  const prevKey = latestKey ? cgPreviousMesAnoKey(latestKey, grupoRows) : "";

  let admitidos = 0;
  let desligados = 0;
  let saldo = 0;
  let estLatest = 0;
  let estPrev = 0;
  let tempoWeighted = 0;
  let deslForTempo = 0;

  for (const row of grupoRows) {
    admitidos += row.admitidos;
    desligados += row.desligados;
    saldo += row.saldo;
    if (row.mesAnoKey === latestKey) estLatest += row.estoque;
    if (prevKey && row.mesAnoKey === prevKey) estPrev += row.estoque;
    if (row.desligados > 0 && row.tempoEmprego > 0) {
      tempoWeighted += row.tempoEmprego * row.desligados;
      deslForTempo += row.desligados;
    }
  }

  return {
    label: cgGrupoLabel(grupoKey),
    admitidos,
    desligados,
    saldo,
    tempoMedio: deslForTempo > 0 ? tempoWeighted / deslForTempo : null,
    estoque: estLatest,
    vrRelativa: estPrev > 0 ? ((estLatest - estPrev) / estPrev) * 100 : null,
  };
}

function cgBuildGrupoTableRows(rows) {
  const bodyRows = CG_TABLE_GRUPO_ORDER.map((key) => cgComputeGrupoTableRow(rows, key));
  const latestKey = cgLatestMesAnoKeyInRows(rows);
  const prevKey = latestKey ? cgPreviousMesAnoKey(latestKey, rows) : "";

  let estLatestTotal = 0;
  let estPrevTotal = 0;
  let tempoWeighted = 0;
  let deslForTempo = 0;

  for (const row of rows) {
    if (row.mesAnoKey === latestKey) estLatestTotal += row.estoque;
    if (prevKey && row.mesAnoKey === prevKey) estPrevTotal += row.estoque;
    if (row.desligados > 0 && row.tempoEmprego > 0) {
      tempoWeighted += row.tempoEmprego * row.desligados;
      deslForTempo += row.desligados;
    }
  }

  const total = {
    label: "Total",
    admitidos: bodyRows.reduce((s, r) => s + r.admitidos, 0),
    desligados: bodyRows.reduce((s, r) => s + r.desligados, 0),
    saldo: bodyRows.reduce((s, r) => s + r.saldo, 0),
    tempoMedio: deslForTempo > 0 ? tempoWeighted / deslForTempo : null,
    estoque: estLatestTotal,
    vrRelativa: estPrevTotal > 0 ? ((estLatestTotal - estPrevTotal) / estPrevTotal) * 100 : null,
  };

  return [...bodyRows, total];
}

function cgRenderGrupoTable(rows) {
  const tbody = document.getElementById("cgTableGrupamentoBody");
  if (!tbody) return;
  const tableRows = cgBuildGrupoTableRows(rows);
  tbody.innerHTML = tableRows
    .map((row) => {
      const tempo =
        row.tempoMedio != null
          ? cgFmt.format(Math.round(row.tempoMedio * 10) / 10)
          : "—";
      const vr =
        row.vrRelativa != null
          ? `${cgFmtPct(row.vrRelativa)}%`
          : "—";
      return `<tr>
        <td>${row.label}</td>
        <td>${cgFmt.format(row.admitidos)}</td>
        <td>${cgFmt.format(row.desligados)}</td>
        <td>${cgFmt.format(row.saldo)}</td>
        <td>${tempo}</td>
        <td>${cgFmt.format(row.estoque)}</td>
        <td>${vr}</td>
      </tr>`;
    })
    .join("");
}

function cgRefreshCharts() {
  if (!cgIsActivePage() || !cgState.loaded) return;
  const filtered = cgFilterRows(cgState.rows);
  const grupoKey = cgGetSelectedGrupoKey();
  cgUpdateRankingCharts(filtered, grupoKey);
  cgUpdateLineChart(filtered);
  cgUpdateMunicipioLineChart(filtered);
  cgUpdateSaldoChart(filtered);
  cgRenderGrupoTable(filtered);
  requestAnimationFrame(() => {
    for (const key of Object.keys(cgCharts)) {
      try {
        cgCharts[key]?.resize?.();
      } catch (_) {}
    }
  });
}

function cgComputeKpis(rows, grupoKey) {
  const grupoRows = cgRowsForGrupo(rows, grupoKey);
  const latestMesKey = cgLatestMesAnoKeyInRows(grupoRows);
  return grupoRows.reduce(
    (acc, row) => {
      const countEstoque = latestMesKey && row.mesAnoKey === latestMesKey;
      return {
        estoque: acc.estoque + (countEstoque ? row.estoque : 0),
        admitidos: acc.admitidos + row.admitidos,
        desligados: acc.desligados + row.desligados,
        saldo: acc.saldo + row.saldo,
      };
    },
    { estoque: 0, admitidos: 0, desligados: 0, saldo: 0 }
  );
}

function cgRenderKpis(totals) {
  const set = (id, val) => {
    const el = document.getElementById(id);
    if (!el) return;
    el.textContent = Number.isFinite(val) ? cgFmt.format(val) : "—";
  };
  set("mapKpiEstoque", totals.estoque);
  set("mapKpiAdmissoes", totals.admitidos);
  set("mapKpiDesligamentos", totals.desligados);
  set("mapKpiSaldos", totals.saldo);

  const titleEl = document.querySelector(".map-ce-main__kpis .map-ce-main__kpis-title-inner span:last-child");
  if (titleEl && cgIsActivePage()) {
    titleEl.textContent = `Totais — ${cgGrupoLabel(cgGetSelectedGrupoKey())}`;
  }
}

function cgRefreshKpis() {
  if (!cgIsActivePage() || !cgState.loaded) return;
  const filtered = cgFilterRows(cgState.rows);
  const grupoKey = cgGetSelectedGrupoKey();
  cgRenderKpis(cgComputeKpis(filtered, grupoKey));
}

function cgUpdateMapReference() {
  const el = document.getElementById("mapRefMesAno");
  if (!el) return;
  const filtered = cgFilterRows(cgState.rows);
  const grupoKey = cgGetSelectedGrupoKey();
  const grupoRows = cgRowsForGrupo(filtered, grupoKey);
  const latestKey = cgLatestMesAnoKeyInRows(grupoRows);
  if (!latestKey) {
    el.textContent = "—";
    return;
  }
  el.textContent =
    typeof window.ceRegioesMapApi?.formatMesAnoKey === "function"
      ? window.ceRegioesMapApi.formatMesAnoKey(latestKey)
      : latestKey;
}

function cgRefreshMap() {
  if (!cgIsActivePage() || !cgState.loaded) return;
  const filtered = cgFilterRows(cgState.rows);
  const grupoKey = cgGetSelectedGrupoKey();
  const metricKey = cgGetSelectedMetricKey();
  const aggByCod = cgAggregateByCodigo(filtered, grupoKey);
  window.ceRegioesMapApi?.applyCagedGrupLayer?.(aggByCod, grupoKey, metricKey);
  cgUpdateMapReference();
}

function cgRefreshAll() {
  if (!cgState.loaded) return;
  cgRefreshKpis();
  cgRefreshMap();
  cgRefreshCharts();
}

function cgSetStatus(message) {
  const el = document.getElementById("cgStatus");
  if (el) {
    el.textContent = message || "";
    el.hidden = !message;
  }
}

async function cgEnsureData() {
  if (cgState.loaded || cgState.loading) return;
  cgState.loading = true;
  cgSetStatus("Carregando planilha CAGED por grupamento…");
  cgRenderKpis({ estoque: NaN, admitidos: NaN, desligados: NaN, saldo: NaN });
  try {
    const res = await fetch(CAGED_GRUP_CSV_URL, { cache: "no-store" });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const text = await res.text();
    cgState.rows = cgParseCsvRows(text);
    cgState.loaded = true;
    cgState.error = null;
    cgBuildMunicipiosIndex();
    cgPopulateAnoFilter();
    cgRebuildMesFilter();
    cgSyncMunicipiosFromRegiao();
    cgRefreshAll();
    const grupo = cgGrupoLabel(cgGetSelectedGrupoKey());
    cgSetStatus(`${cgState.rows.length.toLocaleString("pt-BR")} registros · grupamento: ${grupo}`);
  } catch (err) {
    cgState.error = err;
    cgSetStatus("Não foi possível carregar os dados de grupamento.");
    console.error("[caged-grupamentos]", err);
  } finally {
    cgState.loading = false;
  }
}

function cgIsActivePage() {
  return document.getElementById("secaoMapaCe")?.classList.contains("section-map-ce--caged-grupamentos") === true;
}

function cgOnPageActivate() {
  if (!cgIsActivePage()) return;
  void cgEnsureData().then(() => {
    if (cgState.loaded) cgSyncMunicipiosFromRegiao();
    cgRefreshAll();
  });
}

function cgRestoreKpiTitle() {
  const titleEl = document.querySelector(".map-ce-main__kpis .map-ce-main__kpis-title-inner span:last-child");
  if (titleEl) titleEl.textContent = "Totais no filtro";
}

function cgRestoreFullMunicipioFilter() {
  cgRestoreKpiTitle();
  if (typeof window.ceRegioesMapApi?.rebuildAllMunicipios === "function") {
    window.ceRegioesMapApi.rebuildAllMunicipios();
  }
}

function cgBindFilters() {
  const root = document.getElementById("secaoMapaCe");
  if (!root || root.dataset.cgBound === "1") return;
  root.dataset.cgBound = "1";

  root.addEventListener("change", (e) => {
    if (!cgIsActivePage()) return;
    const id = e.target?.id;
    if (id === "mapFilterAno") {
      cgRebuildMesFilter();
      cgRefreshAll();
    }
    if (id === "mapFilterMes" || id === "mapFilterMunicipio" || id === "mapFilterRegiao") {
      if (id === "mapFilterRegiao") cgSyncMunicipiosFromRegiao();
      cgRefreshAll();
    }
    if (id === "mapCagedGrupLayerStyle" || id === "mapCagedGrupMetricStyle") {
      cgRefreshAll();
      const grupo = cgGrupoLabel(cgGetSelectedGrupoKey());
      cgSetStatus(`${cgState.rows.length.toLocaleString("pt-BR")} registros · grupamento: ${grupo}`);
    }
    if (id === "cgRankOrder") {
      cgRefreshCharts();
    }
  });

  root.addEventListener("click", (e) => {
    if (!cgIsActivePage() || !(e.target instanceof HTMLElement)) return;
    if (e.target.id === "mapFilterAnoClear") {
      const sel = document.getElementById("mapFilterAno");
      if (sel) Array.from(sel.options).forEach((o) => { o.selected = false; });
      cgRebuildMesFilter();
      cgRefreshAll();
    }
    if (e.target.id === "mapFilterMesClear") {
      const sel = document.getElementById("mapFilterMes");
      if (sel) Array.from(sel.options).forEach((o) => { o.selected = false; });
      cgRefreshAll();
    }
    if (e.target.id === "mapFilterRegiaoClear") {
      const sel = document.getElementById("mapFilterRegiao");
      if (sel) Array.from(sel.options).forEach((o) => { o.selected = false; });
      cgSyncMunicipiosFromRegiao();
      cgRefreshAll();
    }
    if (e.target.id === "mapFilterMunClear") {
      cgClearMunicipioSelection();
      cgRefreshAll();
    }
  });

  root.addEventListener("input", (e) => {
    if (!cgIsActivePage() || e.target.id !== "mapFilterMunSearch") return;
    clearTimeout(cgMunSearchTimer);
    cgMunSearchTimer = setTimeout(() => cgRebuildMunicipioOptions(), 160);
  });
}

function cgInit() {
  cgBindFilters();
  if (cgIsActivePage()) cgOnPageActivate();
}

window.cagedGrupamentosApi = {
  onPageActivate: cgOnPageActivate,
  refresh: cgRefreshAll,
  refreshMap: cgRefreshMap,
  refreshKpis: cgRefreshKpis,
  refreshCharts: cgRefreshCharts,
  destroyCharts: cgDestroyCharts,
  syncMunicipiosFromRegiao: cgSyncMunicipiosFromRegiao,
  clearMunicipioSelection: cgClearMunicipioSelection,
  selectSingleMunicipioFromMap: cgSelectSingleMunicipioFromMap,
  rebuildMunicipioOptions: cgRebuildMunicipioOptions,
  restoreFullMunicipioFilter: cgRestoreFullMunicipioFilter,
  getGrupoLabel: cgGrupoLabel,
  getMetricLabel: cgMetricLabel,
};

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", cgInit);
} else {
  cgInit();
}
