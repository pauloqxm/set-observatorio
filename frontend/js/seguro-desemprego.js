const SEGURO_DESEMPREGO_CSV_URL =
  "https://docs.google.com/spreadsheets/d/e/2PACX-1vSqbXvr8i6RoTDsnQvV5HB35Su37BeBW8hWgIJa1HWiLZbzwhzH-Ke0rq-EqS_Jio9HY85L8uqxvrCa/pub?gid=0&single=true&output=csv";

const SD_MESES = {
  janeiro: 1,
  fevereiro: 2,
  marco: 3,
  abril: 4,
  maio: 5,
  junho: 6,
  julho: 7,
  agosto: 8,
  setembro: 9,
  outubro: 10,
  novembro: 11,
  dezembro: 12,
};
const SD_MESES_SHORT = ["jan", "fev", "mar", "abr", "mai", "jun", "jul", "ago", "set", "out", "nov", "dez"];
const SD_MESES_FULL = [
  "Janeiro", "Fevereiro", "Março", "Abril", "Maio", "Junho",
  "Julho", "Agosto", "Setembro", "Outubro", "Novembro", "Dezembro",
];
const SD_BAR_RANKING_COLOR = "#2563eb";
const SD_LINE_QUINZENA_COLOR = "#14b8a6";
const SD_COLOR_PRESENCIAL = "#5eead4";
const SD_COLOR_WEB = "#065f46";
const SD_RANKING_TOP_N = 15;
const SD_BRUSH_MIN_CATEGORIES = 18;

const sdState = {
  rows: [],
  loading: false,
  loaded: false,
  error: null,
  municipiosList: [],
};

const sdFmt = new Intl.NumberFormat("pt-BR");

const sdCharts = {
  rankMun: null,
  rankReg: null,
  lineQuinzena: null,
  stackedQuinzena: null,
};

function sdMetricLabel(metricKey) {
  return metricKey === "requerentes_web" ? "Requerentes WEB" : "Requerentes";
}

function sdGetMetricField(metricKey) {
  return metricKey === "requerentes_web" ? "requerentesWeb" : "requerentes";
}

function sdGetSelectedRankOrder() {
  const el = document.getElementById("sdRankOrder");
  return el?.value === "menores" ? "menores" : "maiores";
}

function sdRankOrderLabel(order) {
  return order === "menores" ? "15 menores" : "15 maiores";
}

function sdSortRankingRows(rows, order) {
  rows.sort((a, b) => {
    const cmp = order === "maiores" ? b.value - a.value : a.value - b.value;
    return cmp || a.label.localeCompare(b.label, "pt-BR");
  });
  return rows;
}

function sdPickMunicipioRankingEntries(aggByCod, field, order = sdGetSelectedRankOrder()) {
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
  return sdSortRankingRows(rows, order).slice(0, SD_RANKING_TOP_N);
}

function sdPickRegiaoRankingEntries(aggByCod, field, order = sdGetSelectedRankOrder()) {
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
  return sdSortRankingRows(rows, order).slice(0, SD_RANKING_TOP_N);
}

function sdBuildRankingBarConfig(entries, color, seriesName) {
  const hasData = entries.length > 0;
  const data = hasData ? entries.map((e) => ({ x: e.label, y: e.value })) : [{ x: "Sem dados no filtro", y: 0 }];
  const height = Math.max(280, 48 + Math.max(entries.length || 1, 1) * 28);
  const valFmt = (val) => sdFmt.format(Number(val) || 0);
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

function sdDestroyChart(key) {
  const chart = sdCharts[key];
  if (!chart) return;
  try {
    chart.destroy();
  } catch (_) {}
  sdCharts[key] = null;
}

function sdDestroyCharts() {
  for (const key of Object.keys(sdCharts)) sdDestroyChart(key);
}

function sdUpdateRankingHints(order) {
  const metricKey = sdGetSelectedLayerKey();
  const metricLabel = sdMetricLabel(metricKey);
  const orderNote = sdRankOrderLabel(order);
  const headHint = document.getElementById("sdRankingsHeadHint");
  if (headHint) {
    headHint.textContent = `${metricLabel} · ${orderNote} · valor absoluto no recorte dos filtros · mesmos filtros do mapa`;
  }
}

function sdUpdateRankingCharts(filtered) {
  if (typeof ApexCharts === "undefined") return;
  const metricKey = sdGetSelectedLayerKey();
  const metricField = sdGetMetricField(metricKey);
  const metricLabel = sdMetricLabel(metricKey);
  const order = sdGetSelectedRankOrder();
  const aggByCod = sdAggregateByCodigo(filtered);
  const munEntries = sdPickMunicipioRankingEntries(aggByCod, metricField, order);
  const regEntries = sdPickRegiaoRankingEntries(aggByCod, metricField, order);
  sdUpdateRankingHints(order);

  const munEl = document.getElementById("sdChartRankingMun");
  if (munEl) {
    sdDestroyChart("rankMun");
    const { config } = sdBuildRankingBarConfig(munEntries, SD_BAR_RANKING_COLOR, metricLabel);
    const chart = new ApexCharts(munEl, config);
    chart.render();
    sdCharts.rankMun = chart;
  }

  const regEl = document.getElementById("sdChartRankingReg");
  if (regEl) {
    sdDestroyChart("rankReg");
    const { config } = sdBuildRankingBarConfig(regEntries, SD_BAR_RANKING_COLOR, metricLabel);
    const chart = new ApexCharts(regEl, config);
    chart.render();
    sdCharts.rankReg = chart;
  }
}

function sdRefreshCharts() {
  if (!sdIsActivePage() || !sdState.loaded) return;
  sdUpdateRankingCharts(sdFilterRows(sdState.rows));
  sdUpdateQuinzenaCharts(sdState.rows);
}

function sdQuinzenaCategoryLabel(key, includeYear) {
  const m = String(key || "").match(/^(\d{4})-(\d{2})-Q(\d)$/);
  if (!m) return String(key || "—");
  const monthIdx = Number(m[2]) - 1;
  const monthName = SD_MESES_FULL[monthIdx] || m[2];
  if (includeYear) return `${m[3]}ª de ${monthName} de ${m[1]}`;
  return `${m[3]}ª de ${monthName}`;
}

function sdFormatChartY(v) {
  const n = Number(v) || 0;
  if (Math.abs(n) >= 1e6) return `${(n / 1e6).toFixed(1).replace(".", ",")} Mi`;
  if (Math.abs(n) >= 1e3) return `${Math.round(n / 1e3)} mil`;
  return sdFmt.format(n);
}

function sdFilterRowsForTimeSeries(rows) {
  const anos = sdGetSelectedAnos();
  const muns = sdGetSelectedMunicipioCodes();
  const regs = sdGetSelectedRegioes();
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
    if (muns.length && !muns.includes(String(row.codigo))) return false;
    if (allowedByReg && !allowedByReg.has(String(row.codigo))) return false;
    return true;
  });
}

function sdAggregateByQuinzena(rows) {
  /** @type {Map<string, { requerentes: number, requerentesWeb: number }>} */
  const map = new Map();
  for (const row of rows) {
    if (!row.quinzenaKey) continue;
    const cur = map.get(row.quinzenaKey) || { requerentes: 0, requerentesWeb: 0 };
    map.set(row.quinzenaKey, {
      requerentes: cur.requerentes + row.requerentes,
      requerentesWeb: cur.requerentesWeb + row.requerentesWeb,
    });
  }
  return map;
}

function sdBuildQuinzenaTimeSeries(rows) {
  const filtered = sdFilterRowsForTimeSeries(rows);
  const byQz = sdAggregateByQuinzena(filtered);
  const keys = [...byQz.keys()].sort((a, b) => sdQuinzenaKeyRank(a) - sdQuinzenaKeyRank(b));
  const years = new Set(keys.map((k) => k.slice(0, 4)));
  const includeYear = years.size > 1;
  const categories = keys.map((k) => sdQuinzenaCategoryLabel(k, includeYear));
  const totals = keys.map((k) => byQz.get(k).requerentes);
  const presencial = keys.map((k) => {
    const v = byQz.get(k);
    return Math.max(0, v.requerentes - v.requerentesWeb);
  });
  const web = keys.map((k) => byQz.get(k).requerentesWeb);
  const hasData = keys.length > 0 && totals.some((t) => t > 0);
  return { categories, totals, presencial, web, hasData };
}

function sdUpdateQuinzenaLineChart(rows) {
  if (typeof ApexCharts === "undefined") return;
  const el = document.getElementById("sdChartQuinzenaLine");
  if (!el) return;
  sdDestroyChart("lineQuinzena");

  const { categories, totals, hasData } = sdBuildQuinzenaTimeSeries(rows);
  const cats = hasData ? categories : ["Sem dados no filtro"];
  const brushEnabled = hasData && categories.length > SD_BRUSH_MIN_CATEGORIES;
  const selectionMax = categories.length - 1;
  const selectionMin = brushEnabled ? Math.max(0, categories.length - SD_BRUSH_MIN_CATEGORIES) : 0;

  const chart = new ApexCharts(el, {
    chart: {
      id: "sd-quinzena-line",
      type: "line",
      height: 420,
      toolbar: { show: false },
      zoom: { enabled: false },
      fontFamily: "system-ui, Segoe UI, sans-serif",
      foreColor: "#1f2d78",
      animations: { speed: 320 },
      brush: {
        enabled: brushEnabled,
        target: "sd-quinzena-stacked",
      },
      selection: {
        enabled: brushEnabled,
        xaxis: {
          min: selectionMin,
          max: selectionMax,
        },
      },
    },
    series: [{ name: "Requerentes", data: hasData ? totals : [0] }],
    xaxis: {
      categories: cats,
      labels: {
        rotate: hasData && cats.length > 8 ? -35 : 0,
        hideOverlappingLabels: false,
        trim: true,
        style: { fontSize: "10px", colors: "#475569" },
      },
      axisBorder: { color: "#cbd5e1" },
      axisTicks: { show: false },
    },
    yaxis: {
      labels: { formatter: (v) => sdFormatChartY(v), style: { fontSize: "11px", colors: "#475569" } },
      min: 0,
    },
    stroke: { curve: "smooth", width: 3 },
    colors: [SD_LINE_QUINZENA_COLOR],
    markers: { size: hasData ? 4 : 0, strokeWidth: 2, hover: { size: 6 } },
    legend: { show: false },
    grid: {
      borderColor: "#e2e8f0",
      strokeDashArray: 4,
      padding: { left: 8, right: 12, top: 10, bottom: brushEnabled ? 24 : 4 },
    },
    tooltip: {
      y: { formatter: (v) => sdFmt.format(Number(v) || 0) },
    },
    dataLabels: {
      enabled: hasData && categories.length <= 14,
      formatter: (val) => sdFmt.format(Number(val) || 0),
      style: { fontSize: "10px", fontWeight: 700, colors: ["#0f766e"] },
      background: {
        enabled: true,
        foreColor: "#fff",
        padding: 4,
        borderRadius: 4,
        borderWidth: 0,
        opacity: 0.92,
      },
      offsetY: -6,
    },
  });
  chart.render();
  sdCharts.lineQuinzena = chart;
}

function sdUpdateQuinzenaStackedChart(rows) {
  if (typeof ApexCharts === "undefined") return;
  const el = document.getElementById("sdChartQuinzenaStacked");
  if (!el) return;
  sdDestroyChart("stackedQuinzena");

  const { categories, presencial, web, hasData } = sdBuildQuinzenaTimeSeries(rows);
  const cats = hasData ? categories : ["Sem dados no filtro"];

  const chart = new ApexCharts(el, {
    chart: {
      id: "sd-quinzena-stacked",
      type: "bar",
      height: 380,
      stacked: true,
      stackType: "100%",
      toolbar: { show: false },
      zoom: { enabled: false },
      fontFamily: "system-ui, Segoe UI, sans-serif",
      foreColor: "#1f2d78",
      animations: { speed: 320 },
    },
    series: hasData
      ? [
          { name: "Presencial", data: presencial },
          { name: "WEB", data: web },
        ]
      : [
          { name: "Presencial", data: [0] },
          { name: "WEB", data: [0] },
        ],
    xaxis: {
      categories: cats,
      labels: {
        rotate: hasData && cats.length > 8 ? -35 : 0,
        hideOverlappingLabels: false,
        trim: true,
        style: { fontSize: "10px", colors: "#475569" },
      },
      axisBorder: { color: "#cbd5e1" },
      axisTicks: { show: false },
    },
    yaxis: {
      max: 100,
      labels: { formatter: (v) => `${Math.round(Number(v) || 0)}%`, style: { fontSize: "11px", colors: "#475569" } },
    },
    plotOptions: {
      bar: {
        horizontal: false,
        columnWidth: hasData && categories.length > 24 ? "92%" : "72%",
        borderRadius: 2,
      },
    },
    colors: [SD_COLOR_PRESENCIAL, SD_COLOR_WEB],
    legend: {
      position: "top",
      horizontalAlign: "right",
      fontSize: "12px",
      fontWeight: 600,
      markers: { width: 12, height: 12, radius: 2 },
    },
    grid: {
      borderColor: "#e2e8f0",
      strokeDashArray: 4,
      padding: { left: 8, right: 12, top: 4, bottom: 4 },
    },
    tooltip: {
      shared: true,
      intersect: false,
      y: {
        formatter: (val, opts) => {
          const idx = opts?.dataPointIndex ?? 0;
          const seriesIdx = opts?.seriesIndex ?? 0;
          const raw = seriesIdx === 0 ? presencial[idx] : web[idx];
          const pct = Number(val) || 0;
          return `${sdFmt.format(raw)} (${pct.toFixed(1).replace(".", ",")}%)`;
        },
      },
    },
    dataLabels: { enabled: false },
  });
  chart.render();
  sdCharts.stackedQuinzena = chart;
}

function sdUpdateQuinzenaCharts(rows) {
  sdUpdateQuinzenaLineChart(rows);
  sdUpdateQuinzenaStackedChart(rows);
}

function sdParseCsvLine(line) {
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

function sdNormMonthName(value) {
  return String(value || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .trim();
}

function sdBuildCompetencia(ano, month, quinzena, rawLabel) {
  const mesAnoKey = `${ano}-${String(month).padStart(2, "0")}`;
  const quinzenaKey = `${mesAnoKey}-Q${quinzena}`;
  return { ano, month, quinzena, mesAnoKey, quinzenaKey, competenciaRaw: rawLabel };
}

function sdParseCompetenciaQuinzenal(raw) {
  const s = String(raw || "").trim();
  if (!s) return null;

  const m = s.match(/^(\d)[ºª°o]?\s*de\s+(.+?)\s+de\s+(\d{4})$/i);
  if (m) {
    const quinzena = Number(m[1]);
    const month = SD_MESES[sdNormMonthName(m[2])];
    const ano = Number(m[3]);
    if (month && quinzena >= 1 && quinzena <= 2) return sdBuildCompetencia(ano, month, quinzena, s);
  }

  const qMatch = s.match(/^(\d)/);
  const yearMatch = s.match(/(\d{4})$/);
  if (!qMatch || !yearMatch) return null;
  const quinzena = Number(qMatch[1]);
  const ano = Number(yearMatch[1]);
  const mid = s.replace(/^\d[^d]*de\s+/i, "").replace(/\s+de\s+\d{4}$/, "");
  const month = SD_MESES[sdNormMonthName(mid)];
  if (!month || quinzena < 1 || quinzena > 2) return null;
  return sdBuildCompetencia(ano, month, quinzena, s);
}

function sdQuinzenaKeyRank(key) {
  const m = String(key || "").match(/^(\d{4})-(\d{2})-Q(\d)$/);
  if (!m) return 0;
  return Number(m[1]) * 1000 + Number(m[2]) * 10 + Number(m[3]);
}

function sdQuinzenaLabel(key) {
  const m = String(key || "").match(/^(\d{4})-(\d{2})-Q(\d)$/);
  if (!m) return String(key || "—");
  const year = m[1];
  const month = Number(m[2]);
  const q = m[3];
  const mesShort = SD_MESES_SHORT[month - 1] || m[2];
  return `${q}ª quinzena de ${mesShort}/${year}`;
}

function sdParseNumber(raw) {
  const s = String(raw ?? "").trim();
  if (!s) return 0;
  const clean = s.replace(/\./g, "").replace(",", ".");
  const n = Number(clean);
  return Number.isFinite(n) ? n : 0;
}

function sdParseCsvRows(text) {
  const raw = String(text || "").replace(/^\uFEFF/, "");
  const lines = raw.split(/\r?\n/).filter((l) => l.trim());
  if (!lines.length) return [];

  const header = sdParseCsvLine(lines[0]).map((h) => h.trim());
  const idx = Object.fromEntries(header.map((h, i) => [h, i]));
  const pick = (cells, key) => cells[idx[key]] ?? "";

  const rows = [];
  for (let i = 1; i < lines.length; i++) {
    const cells = sdParseCsvLine(lines[i]);
    if (!cells.length) continue;
    const codigoRaw = pick(cells, "Codigo_IBGE");
    const codigo = parseInt(String(codigoRaw).replace(/\D/g, ""), 10);
    if (!Number.isFinite(codigo)) continue;
    const municipio = pick(cells, "Municipio");
    const comp = sdParseCompetenciaQuinzenal(pick(cells, "Competencia_Quinzenal"));
    if (!comp) continue;
    rows.push({
      codigo,
      municipio,
      ano: comp.ano,
      month: comp.month,
      quinzena: comp.quinzena,
      mesAnoKey: comp.mesAnoKey,
      quinzenaKey: comp.quinzenaKey,
      competenciaRaw: comp.competenciaRaw,
      requerentes: sdParseNumber(pick(cells, "Requerentes")),
      requerentesWeb: sdParseNumber(pick(cells, "Requerentes_WEB")),
    });
  }
  return rows;
}

function sdBuildMunicipiosIndex() {
  const munMap = new Map();
  for (const row of sdState.rows) {
    if (!munMap.has(row.codigo)) munMap.set(row.codigo, row.municipio);
  }
  sdState.municipiosList = [...munMap.entries()]
    .map(([codigo, municipio]) => ({ codigo, municipio }))
    .sort((a, b) => a.municipio.localeCompare(b.municipio, "pt-BR"));
}

function sdPopulateAnoFilter() {
  const sel = document.getElementById("sdFilterAno");
  if (!sel) return;
  const prev = new Set(Array.from(sel.selectedOptions).map((o) => o.value));
  const years = [...new Set(sdState.rows.map((r) => r.ano).filter((y) => Number.isFinite(y)))].sort(
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

function sdRebuildQuinzenaFilter() {
  const sel = document.getElementById("sdFilterQuinzena");
  const anoSel = sdGetSelectedAnos();
  if (!sel) return;
  const prev = new Set(Array.from(sel.selectedOptions).map((o) => o.value));
  const keys = new Set();
  for (const row of sdState.rows) {
    if (!row.quinzenaKey) continue;
    if (anoSel.length && !anoSel.includes(String(row.ano))) continue;
    keys.add(row.quinzenaKey);
  }
  const sorted = [...keys].sort((a, b) => sdQuinzenaKeyRank(a) - sdQuinzenaKeyRank(b));
  sel.innerHTML = "";
  for (const key of sorted) {
    const opt = document.createElement("option");
    opt.value = key;
    opt.textContent = sdQuinzenaLabel(key);
    if (prev.has(key)) opt.selected = true;
    sel.appendChild(opt);
  }
}

function sdRebuildMunicipioOptions(preferredSelection) {
  const sel = document.getElementById("mapFilterMunicipio");
  const searchEl = document.getElementById("mapFilterMunSearch");
  if (!sel || !sdState.municipiosList.length) return;

  const regSel = sdGetSelectedRegioes();
  let pool = sdState.municipiosList;
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

function sdSyncMunicipiosFromRegiao() {
  if (!sdState.municipiosList.length) return;
  const regSel = sdGetSelectedRegioes();
  const codes = new Set();
  if (regSel.length && typeof window.ceRegioesMapApi?.getRegiaoToCodigos === "function") {
    const regMap = window.ceRegioesMapApi.getRegiaoToCodigos();
    const valid = new Set(sdState.municipiosList.map((m) => String(m.codigo)));
    for (const reg of regSel) {
      const set = regMap.get(reg);
      if (!set) continue;
      for (const c of set) {
        const cs = String(c);
        if (valid.has(cs)) codes.add(cs);
      }
    }
  }
  sdRebuildMunicipioOptions(codes);
}

function sdClearMunicipioSelection() {
  const search = document.getElementById("mapFilterMunSearch");
  if (search) search.value = "";
  sdRebuildMunicipioOptions(new Set());
}

function sdSelectSingleMunicipioFromMap(codigo) {
  const codStr = String(codigo ?? "").trim();
  if (!codStr) return;
  const exists = sdState.municipiosList.some((m) => String(m.codigo) === codStr);
  if (!exists) return;
  const search = document.getElementById("mapFilterMunSearch");
  if (search) search.value = "";
  sdRebuildMunicipioOptions(new Set([codStr]));
  sdRefreshAll();
}

function sdGetSelectedAnos() {
  const sel = document.getElementById("sdFilterAno");
  if (!sel) return [];
  return Array.from(sel.selectedOptions)
    .map((o) => String(o.value || ""))
    .filter(Boolean);
}

function sdGetSelectedQuinzenaKeys() {
  const sel = document.getElementById("sdFilterQuinzena");
  if (!sel) return [];
  return Array.from(sel.selectedOptions)
    .map((o) => String(o.value || ""))
    .filter(Boolean);
}

function sdGetSelectedMunicipioCodes() {
  const sel = document.getElementById("mapFilterMunicipio");
  if (!sel) return [];
  return Array.from(sel.selectedOptions)
    .map((o) => String(o.value || ""))
    .filter(Boolean);
}

function sdGetSelectedRegioes() {
  const sel = document.getElementById("mapFilterRegiao");
  if (!sel) return [];
  return Array.from(sel.selectedOptions)
    .map((o) => String(o.value || ""))
    .filter(Boolean);
}

function sdGetSelectedLayerKey() {
  const el = document.getElementById("mapSeguroDesempregoLayerStyle");
  const v = el?.value || "requerentes";
  return v === "requerentes_web" ? "requerentes_web" : "requerentes";
}

function sdFilterRows(rows) {
  const anos = sdGetSelectedAnos();
  const quinzenas = sdGetSelectedQuinzenaKeys();
  const muns = sdGetSelectedMunicipioCodes();
  const regs = sdGetSelectedRegioes();
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
    if (quinzenas.length && !quinzenas.includes(row.quinzenaKey)) return false;
    if (muns.length && !muns.includes(String(row.codigo))) return false;
    if (allowedByReg && !allowedByReg.has(String(row.codigo))) return false;
    return true;
  });
}

function sdEmptyMunAgg(municipio = "", codigo = null) {
  return { codigo, municipio, requerentes: 0, requerentesWeb: 0 };
}

function sdAggregateByCodigo(rows) {
  /** @type {Map<number, ReturnType<typeof sdEmptyMunAgg>>} */
  const byCod = new Map();
  for (const row of rows) {
    const cur = byCod.get(row.codigo) || sdEmptyMunAgg(row.municipio, row.codigo);
    byCod.set(row.codigo, {
      codigo: row.codigo,
      municipio: cur.municipio || row.municipio,
      requerentes: cur.requerentes + row.requerentes,
      requerentesWeb: cur.requerentesWeb + row.requerentesWeb,
    });
  }
  return byCod;
}

function sdComputeKpis(rows) {
  let requerentes = 0;
  let requerentesWeb = 0;
  for (const row of rows) {
    requerentes += row.requerentes;
    requerentesWeb += row.requerentesWeb;
  }
  return { requerentes, requerentesWeb };
}

function sdRenderKpis(kpis) {
  const set = (id, v) => {
    const el = document.getElementById(id);
    if (el) el.textContent = Number.isFinite(v) ? sdFmt.format(v) : "—";
  };
  set("sdKpiRequerentes", kpis.requerentes);
  set("sdKpiRequerentesWeb", kpis.requerentesWeb);
}

function sdSetStatus(message) {
  const el = document.getElementById("sdStatus");
  if (el) {
    el.textContent = message || "";
    el.hidden = !message;
  }
  const kpiNote = document.getElementById("sdKpiStatus");
  if (kpiNote && sdIsActivePage()) kpiNote.textContent = message || "";
}

function sdRefreshKpis() {
  if (!sdIsActivePage() || !sdState.loaded) return;
  const filtered = sdFilterRows(sdState.rows);
  sdRenderKpis(sdComputeKpis(filtered));
}

function sdRefreshMap() {
  if (!sdIsActivePage() || !sdState.loaded) return;
  const filtered = sdFilterRows(sdState.rows);
  const aggByCod = sdAggregateByCodigo(filtered);
  const metricKey = sdGetSelectedLayerKey();
  window.ceRegioesMapApi?.applySeguroDesempregoLayer?.(aggByCod, metricKey);
}

function sdRefreshAll() {
  if (!sdState.loaded) return;
  sdRefreshKpis();
  sdRefreshMap();
  sdRefreshCharts();
}

async function sdEnsureData() {
  if (sdState.loaded || sdState.loading) return;
  sdState.loading = true;
  sdSetStatus("Carregando planilha Seguro Desemprego…");
  sdRenderKpis({ requerentes: NaN, requerentesWeb: NaN });
  try {
    const res = await fetch(SEGURO_DESEMPREGO_CSV_URL, { cache: "no-store" });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const text = await res.text();
    sdState.rows = sdParseCsvRows(text);
    sdState.loaded = true;
    sdState.error = null;
    sdBuildMunicipiosIndex();
    sdPopulateAnoFilter();
    sdRebuildQuinzenaFilter();
    sdSyncMunicipiosFromRegiao();
    sdRefreshAll();
    sdSetStatus(`${sdState.rows.length.toLocaleString("pt-BR")} registros carregados`);
  } catch (err) {
    sdState.error = err;
    sdSetStatus("Não foi possível carregar os dados de Seguro Desemprego.");
    console.error("[seguro-desemprego]", err);
  } finally {
    sdState.loading = false;
  }
}

function sdIsActivePage() {
  return document.getElementById("secaoMapaCe")?.classList.contains("section-map-ce--seguro-desemprego") === true;
}

function sdOnPageActivate() {
  if (!sdIsActivePage()) return;
  void sdEnsureData().then(() => {
    if (sdState.loaded) sdSyncMunicipiosFromRegiao();
    sdRefreshKpis();
    sdRefreshMap();
    requestAnimationFrame(() => sdRefreshCharts());
  });
}

function sdRestoreFullMunicipioFilter() {
  if (typeof window.ceRegioesMapApi?.rebuildAllMunicipios === "function") {
    window.ceRegioesMapApi.rebuildAllMunicipios();
  }
}

function sdBindFilters() {
  const root = document.getElementById("secaoMapaCe");
  if (!root || root.dataset.sdBound === "1") return;
  root.dataset.sdBound = "1";

  root.addEventListener("change", (e) => {
    if (!sdIsActivePage()) return;
    const id = e.target?.id;
    if (id === "sdFilterAno") {
      sdRebuildQuinzenaFilter();
      sdRefreshAll();
    }
    if (id === "sdFilterQuinzena" || id === "mapFilterMunicipio" || id === "mapFilterRegiao") {
      if (id === "mapFilterRegiao") sdSyncMunicipiosFromRegiao();
      sdRefreshAll();
    }
    if (id === "mapSeguroDesempregoLayerStyle") {
      sdRefreshAll();
    }
    if (id === "sdRankOrder") {
      sdRefreshCharts();
    }
  });

  root.addEventListener("click", (e) => {
    if (!sdIsActivePage() || !(e.target instanceof HTMLElement)) return;
    if (e.target.id === "sdFilterAnoClear") {
      const sel = document.getElementById("sdFilterAno");
      if (sel) Array.from(sel.options).forEach((o) => { o.selected = false; });
      sdRebuildQuinzenaFilter();
      sdRefreshAll();
    }
    if (e.target.id === "sdFilterQuinzenaClear") {
      const sel = document.getElementById("sdFilterQuinzena");
      if (sel) Array.from(sel.options).forEach((o) => { o.selected = false; });
      sdRefreshAll();
    }
    if (e.target.id === "mapFilterRegiaoClear") {
      const sel = document.getElementById("mapFilterRegiao");
      if (sel) Array.from(sel.options).forEach((o) => { o.selected = false; });
      sdSyncMunicipiosFromRegiao();
      sdRefreshAll();
    }
    if (e.target.id === "mapFilterMunClear") {
      sdClearMunicipioSelection();
      sdRefreshAll();
    }
  });
}

function sdInit() {
  sdBindFilters();
}

window.seguroDesempregoApi = {
  onPageActivate: sdOnPageActivate,
  refresh: sdRefreshAll,
  refreshMap: sdRefreshMap,
  refreshCharts: sdRefreshCharts,
  destroyCharts: sdDestroyCharts,
  syncMunicipiosFromRegiao: sdSyncMunicipiosFromRegiao,
  clearMunicipioSelection: sdClearMunicipioSelection,
  selectSingleMunicipioFromMap: sdSelectSingleMunicipioFromMap,
  rebuildMunicipioOptions: () => sdRebuildMunicipioOptions(),
  restoreFullMunicipioFilter: sdRestoreFullMunicipioFilter,
  quinzenaLabel: sdQuinzenaLabel,
};

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", sdInit);
} else {
  sdInit();
}
