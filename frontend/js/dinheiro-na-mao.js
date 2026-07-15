const DINHEIRO_NA_MAO_CSV_URL =
  "https://docs.google.com/spreadsheets/d/e/2PACX-1vR0yUMqqyz-DqEIRgsdueFBAo-mfXDXpsvgSCsE3FwYrpIck2V2khuV0FS2SVnVpTX4EuCLjM1guRjH/pub?gid=122762647&single=true&output=csv";

const DNM_MESES_SHORT = ["jan", "fev", "mar", "abr", "mai", "jun", "jul", "ago", "set", "out", "nov", "dez"];
const DNM_RANKING_TOP_N = 15;
const DNM_RANKING_COLOR = "#d97706";
const DNM_LINE_COLORS = ["#059669", "#d97706"];
const DNM_METRIC_OPTIONS = [
  { key: "operacoes", field: "operacoes", label: "Total de operações", format: "int" },
  { key: "valorOperacoes", field: "valorOperacoes", label: "Valor total das operações", format: "currency" },
  { key: "valorJuros", field: "valorJuros", label: "Valor dos juros", format: "currency" },
];

const dnmState = {
  rows: [],
  loading: false,
  loaded: false,
  error: null,
  municipiosList: [],
};

const dnmCharts = {
  rankMun: null,
  rankReg: null,
  periodoLine: null,
};

const dnmFmt = new Intl.NumberFormat("pt-BR");
const dnmCurrencyFmt = new Intl.NumberFormat("pt-BR", {
  style: "currency",
  currency: "BRL",
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});
const dnmCompactCurrencyFmt = new Intl.NumberFormat("pt-BR", {
  style: "currency",
  currency: "BRL",
  notation: "compact",
  maximumFractionDigits: 1,
});

function dnmIsActivePage() {
  return document.getElementById("secaoMapaCe")?.classList.contains("section-map-ce--dinheiro-na-mao") === true;
}

function dnmNormHeader(value) {
  return String(value ?? "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
}

function dnmParseCsvLine(line) {
  const out = [];
  let cur = "";
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const char = line[i];
    if (char === '"') {
      if (inQuotes && line[i + 1] === '"') {
        cur += '"';
        i++;
      } else {
        inQuotes = !inQuotes;
      }
      continue;
    }
    if (char === "," && !inQuotes) {
      out.push(cur.trim());
      cur = "";
      continue;
    }
    cur += char;
  }
  out.push(cur.trim());
  return out;
}

function dnmHeaderIndex(header, candidates) {
  const indexes = new Map(header.map((value, index) => [dnmNormHeader(value), index]));
  for (const candidate of candidates) {
    const index = indexes.get(dnmNormHeader(candidate));
    if (index != null) return index;
  }
  return -1;
}

function dnmNormalizeCodigo(raw) {
  const digits = String(raw ?? "").replace(/\D/g, "");
  const n = parseInt(digits, 10);
  if (!Number.isFinite(n) || n <= 0) return null;
  // Planilha traz COD_IBGE com DV (7 dígitos); o mapa usa código municipal de 6 dígitos.
  const code = n >= 1_000_000 ? Math.floor(n / 10) : n;
  return code >= 230000 && code <= 239999 ? code : null;
}

function dnmParseNumber(raw) {
  const value = String(raw ?? "").trim().replace(/\s/g, "");
  if (!value) return 0;
  const normalized = value.includes(",")
    ? value.replace(/\./g, "").replace(",", ".")
    : value;
  const number = Number(normalized);
  return Number.isFinite(number) ? number : 0;
}

function dnmParseDate(raw) {
  const value = String(raw ?? "").trim();
  if (!value) return null;
  let day;
  let month;
  let year;
  let match = value.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (match) {
    day = Number(match[1]);
    month = Number(match[2]);
    year = Number(match[3]);
  } else {
    match = value.match(/^(\d{4})-(\d{1,2})-(\d{1,2})(?:[T\s].*)?$/);
    if (!match) return null;
    year = Number(match[1]);
    month = Number(match[2]);
    day = Number(match[3]);
  }
  const maxYear = new Date().getFullYear();
  if (year < 2000 || year > maxYear || month < 1 || month > 12 || day < 1 || day > 31) return null;
  const date = new Date(year, month - 1, day);
  if (date.getFullYear() !== year || date.getMonth() !== month - 1 || date.getDate() !== day) return null;
  return {
    ano: year,
    mes: month,
    mesAnoKey: `${year}-${String(month).padStart(2, "0")}`,
  };
}

function dnmMesAnoRank(key) {
  const [year, month] = String(key || "").split("-").map(Number);
  return Number.isFinite(year) && Number.isFinite(month) ? year * 100 + month : 0;
}

function dnmMesAnoLabel(key) {
  if (typeof window.ceRegioesMapApi?.formatMesAnoKey === "function") {
    return window.ceRegioesMapApi.formatMesAnoKey(key);
  }
  const [year, monthRaw] = String(key || "").split("-");
  const month = Number(monthRaw);
  return month >= 1 && month <= 12 ? `${DNM_MESES_SHORT[month - 1]}/${year}` : String(key || "—");
}

function dnmParseCsvRows(text) {
  const lines = String(text || "").replace(/^\uFEFF/, "").split(/\r?\n/).filter((line) => line.trim());
  if (lines.length < 2) return [];
  const header = dnmParseCsvLine(lines[0]);
  const idxMunicipio = dnmHeaderIndex(header, ["MUNICÍPIO", "MUNICIPIO"]);
  const idxCodigo = dnmHeaderIndex(header, ["COD_IBGE", "CODIGO IBGE"]);
  const idxPrincipal = dnmHeaderIndex(header, ["VR_PCP_OPE"]);
  const idxJuros = dnmHeaderIndex(header, ["VR_JRS_OPE"]);
  const idxDataReferencia = dnmHeaderIndex(header, [
    "DATA DESEMBOLSO / DATA CONTRATO",
    "DATA DESEMBOLSO DATA CONTRATO",
    "DATA CONTRATO",
  ]);
  if (idxCodigo < 0 || idxPrincipal < 0 || idxJuros < 0 || idxDataReferencia < 0) {
    console.warn("[dinheiro-na-mao] Colunas obrigatórias não encontradas.", header);
    return [];
  }

  const rows = [];
  for (let index = 1; index < lines.length; index++) {
    const cells = dnmParseCsvLine(lines[index]);
    const codigo = dnmNormalizeCodigo(cells[idxCodigo]);
    if (codigo == null) continue;
    const date = dnmParseDate(cells[idxDataReferencia]);
    rows.push({
      codigo,
      municipio: idxMunicipio >= 0 ? String(cells[idxMunicipio] || "").trim() : "",
      valorOperacoes: dnmParseNumber(cells[idxPrincipal]),
      valorJuros: dnmParseNumber(cells[idxJuros]),
      ano: date?.ano ?? null,
      mes: date?.mes ?? null,
      mesAnoKey: date?.mesAnoKey || "",
      dataReferencia: cells[idxDataReferencia] || "",
    });
  }
  return rows;
}

function dnmBuildMunicipiosIndex() {
  const map = new Map();
  for (const row of dnmState.rows) {
    if (!map.has(row.codigo)) map.set(row.codigo, row.municipio);
  }
  dnmState.municipiosList = [...map.entries()]
    .map(([codigo, municipio]) => ({ codigo, municipio }))
    .sort((a, b) => a.municipio.localeCompare(b.municipio, "pt-BR"));
}

function dnmGetSelectedValues(id) {
  const select = document.getElementById(id);
  if (!select) return [];
  return Array.from(select.selectedOptions).map((option) => String(option.value || "")).filter(Boolean);
}

function dnmGetSelectedMetricKey() {
  const value = document.getElementById("mapDinheiroNaMaoLayerStyle")?.value || "operacoes";
  return DNM_METRIC_OPTIONS.some((item) => item.key === value) ? value : "operacoes";
}

function dnmGetMetricConfig(key = dnmGetSelectedMetricKey()) {
  return DNM_METRIC_OPTIONS.find((item) => item.key === key) || DNM_METRIC_OPTIONS[0];
}

function dnmPopulateAnoFilter() {
  const select = document.getElementById("mapFilterAno");
  if (!select) return;
  const previous = new Set(Array.from(select.selectedOptions).map((option) => option.value));
  const years = [...new Set(dnmState.rows.map((row) => row.ano).filter(Number.isFinite))].sort((a, b) => a - b);
  select.innerHTML = "";
  for (const year of years) {
    const option = document.createElement("option");
    option.value = String(year);
    option.textContent = String(year);
    option.selected = previous.has(String(year));
    select.appendChild(option);
  }
}

function dnmRebuildMesFilter() {
  const select = document.getElementById("mapFilterMes");
  if (!select) return;
  const years = new Set(dnmGetSelectedValues("mapFilterAno"));
  const previous = new Set(Array.from(select.selectedOptions).map((option) => option.value));
  const keys = new Set();
  for (const row of dnmState.rows) {
    if (!row.mesAnoKey) continue;
    if (years.size && !years.has(String(row.ano))) continue;
    keys.add(row.mesAnoKey);
  }
  select.innerHTML = "";
  for (const key of [...keys].sort((a, b) => dnmMesAnoRank(a) - dnmMesAnoRank(b))) {
    const option = document.createElement("option");
    option.value = key;
    option.textContent = dnmMesAnoLabel(key);
    option.selected = previous.has(key);
    select.appendChild(option);
  }
}

function dnmSyncTemporalFilters() {
  if (!dnmState.loaded) {
    const year = document.getElementById("mapFilterAno");
    const month = document.getElementById("mapFilterMes");
    if (year) year.innerHTML = "";
    if (month) month.innerHTML = "";
    return;
  }
  dnmPopulateAnoFilter();
  dnmRebuildMesFilter();
}

function dnmRebuildMunicipioOptions(preferredSelection) {
  const select = document.getElementById("mapFilterMunicipio");
  const search = document.getElementById("mapFilterMunSearch");
  if (!select || !dnmState.municipiosList.length) return;
  const selected = preferredSelection !== undefined
    ? preferredSelection
    : new Set(Array.from(select.selectedOptions).map((option) => option.value));
  const regions = dnmGetSelectedValues("mapFilterRegiao");
  let pool = dnmState.municipiosList;
  if (regions.length && typeof window.ceRegioesMapApi?.getRegiaoToCodigos === "function") {
    const regionMap = window.ceRegioesMapApi.getRegiaoToCodigos();
    const allowed = new Set();
    for (const region of regions) {
      for (const code of regionMap.get(region) || []) allowed.add(String(code));
    }
    pool = pool.filter((item) => allowed.has(String(item.codigo)));
  }
  const query = String(search?.value || "").trim().toLocaleLowerCase("pt-BR");
  select.innerHTML = "";
  for (const item of pool) {
    const code = String(item.codigo);
    const isSelected = selected.has(code);
    if (query && !item.municipio.toLocaleLowerCase("pt-BR").includes(query) && !isSelected) continue;
    const option = document.createElement("option");
    option.value = code;
    option.textContent = item.municipio;
    option.selected = isSelected;
    select.appendChild(option);
  }
}

function dnmSyncMunicipiosFromRegiao() {
  const regions = dnmGetSelectedValues("mapFilterRegiao");
  const codes = new Set();
  if (regions.length && typeof window.ceRegioesMapApi?.getRegiaoToCodigos === "function") {
    const regionMap = window.ceRegioesMapApi.getRegiaoToCodigos();
    const valid = new Set(dnmState.municipiosList.map((item) => String(item.codigo)));
    for (const region of regions) {
      for (const code of regionMap.get(region) || []) {
        if (valid.has(String(code))) codes.add(String(code));
      }
    }
  }
  dnmRebuildMunicipioOptions(codes);
}

function dnmFilterRows(rows) {
  const years = dnmGetSelectedValues("mapFilterAno");
  const months = dnmGetSelectedValues("mapFilterMes");
  const municipalities = dnmGetSelectedValues("mapFilterMunicipio");
  const regions = dnmGetSelectedValues("mapFilterRegiao");
  let allowedByRegion = null;
  if (regions.length && typeof window.ceRegioesMapApi?.getRegiaoToCodigos === "function") {
    allowedByRegion = new Set();
    const regionMap = window.ceRegioesMapApi.getRegiaoToCodigos();
    for (const region of regions) {
      for (const code of regionMap.get(region) || []) allowedByRegion.add(String(code));
    }
  }
  return rows.filter((row) => {
    if (years.length && !years.includes(String(row.ano))) return false;
    if (months.length && !months.includes(row.mesAnoKey)) return false;
    if (municipalities.length && !municipalities.includes(String(row.codigo))) return false;
    if (allowedByRegion && !allowedByRegion.has(String(row.codigo))) return false;
    return true;
  });
}

function dnmEmptyAggregation(municipio = "", codigo = null) {
  return { codigo, municipio, operacoes: 0, valorOperacoes: 0, valorJuros: 0 };
}

function dnmAggregateByCodigo(rows) {
  const map = new Map();
  for (const row of rows) {
    const current = map.get(row.codigo) || dnmEmptyAggregation(row.municipio, row.codigo);
    current.operacoes += 1;
    current.valorOperacoes += row.valorOperacoes;
    current.valorJuros += row.valorJuros;
    if (!current.municipio) current.municipio = row.municipio;
    map.set(row.codigo, current);
  }
  return map;
}

function dnmComputeKpis(rows) {
  return rows.reduce(
    (totals, row) => ({
      operacoes: totals.operacoes + 1,
      valorOperacoes: totals.valorOperacoes + row.valorOperacoes,
      valorJuros: totals.valorJuros + row.valorJuros,
    }),
    { operacoes: 0, valorOperacoes: 0, valorJuros: 0 }
  );
}

function dnmRenderKpis(kpis) {
  const set = (id, value, formatter) => {
    const element = document.getElementById(id);
    if (element) element.textContent = Number.isFinite(value) ? formatter.format(value) : "—";
  };
  set("dnmKpiOperacoes", kpis.operacoes, dnmFmt);
  set("dnmKpiValorOperacoes", kpis.valorOperacoes, dnmCurrencyFmt);
  set("dnmKpiValorJuros", kpis.valorJuros, dnmCurrencyFmt);
}

function dnmSetStatus(message) {
  const status = document.getElementById("dnmStatus");
  if (status) {
    status.textContent = message || "";
    status.hidden = !message;
  }
  const note = document.getElementById("dnmKpiStatus");
  if (note && dnmIsActivePage()) note.textContent = message || "";
}

function dnmDestroyChart(key) {
  const chart = dnmCharts[key];
  if (!chart) return;
  try {
    chart.destroy();
  } catch (_) {}
  dnmCharts[key] = null;
}

function dnmDestroyCharts() {
  Object.keys(dnmCharts).forEach(dnmDestroyChart);
}

function dnmGetRankOrder() {
  return document.getElementById("dnmRankOrder")?.value === "menores" ? "menores" : "maiores";
}

function dnmSortRanking(entries, order) {
  return entries
    .sort((a, b) => {
      const result = order === "menores" ? a.value - b.value : b.value - a.value;
      return result || a.label.localeCompare(b.label, "pt-BR");
    })
    .slice(0, DNM_RANKING_TOP_N);
}

function dnmMunicipioRanking(aggregation, field, order) {
  return dnmSortRanking(
    [...aggregation.values()]
      .map((item) => ({ label: item.municipio || `Código ${item.codigo}`, value: Number(item[field]) || 0 }))
      .filter((item) => item.value > 0),
    order
  );
}

function dnmRegiaoRanking(aggregation, field, order) {
  const regionMap = window.ceRegioesMapApi?.getRegiaoToCodigos?.();
  if (!regionMap) return [];
  const entries = [];
  for (const [region, codes] of regionMap.entries()) {
    let value = 0;
    for (const code of codes) value += Number(aggregation.get(Number(code))?.[field]) || 0;
    if (value > 0) entries.push({ label: region, value });
  }
  return dnmSortRanking(entries, order);
}

function dnmFormatMetricValue(value, format) {
  return format === "currency" ? dnmCurrencyFmt.format(Number(value) || 0) : dnmFmt.format(Number(value) || 0);
}

function dnmBuildRankingConfig(entries, metric) {
  const hasData = entries.length > 0;
  const height = Math.max(280, 52 + Math.max(entries.length, 1) * 30);
  return {
    height,
    config: {
      chart: {
        type: "bar",
        height,
        toolbar: { show: false },
        fontFamily: "system-ui, Segoe UI, sans-serif",
        foreColor: "#1f2d78",
      },
      series: [{
        name: metric.label,
        data: hasData ? entries.map((item) => ({ x: item.label, y: item.value })) : [{ x: "Sem dados no filtro", y: 0 }],
      }],
      colors: [DNM_RANKING_COLOR],
      plotOptions: {
        bar: { horizontal: true, barHeight: "72%", borderRadius: 4, borderRadiusApplication: "end" },
      },
      xaxis: {
        labels: {
          formatter: (value) => metric.format === "currency"
            ? dnmCompactCurrencyFmt.format(Number(value) || 0)
            : dnmFmt.format(Number(value) || 0),
          style: { fontSize: "11px", colors: "#475569" },
        },
      },
      yaxis: { labels: { maxWidth: 170, style: { fontSize: "11px", colors: "#1f2d78" } } },
      dataLabels: {
        enabled: hasData,
        formatter: (value) => dnmFormatMetricValue(value, metric.format),
        style: { fontSize: "10px", fontWeight: 700, colors: ["#fff"] },
        offsetX: -8,
      },
      grid: { borderColor: "#fde68a", padding: { left: 12, right: 24, top: 8, bottom: 8 } },
      tooltip: { y: { formatter: (value) => dnmFormatMetricValue(value, metric.format) } },
    },
  };
}

function dnmUpdateRankingCharts(filtered) {
  if (typeof ApexCharts === "undefined") return;
  const aggregation = dnmAggregateByCodigo(filtered);
  const metric = dnmGetMetricConfig();
  const order = dnmGetRankOrder();
  const hint = document.getElementById("dnmRankingsHeadHint");
  if (hint) hint.textContent = `${metric.label} · ${order === "menores" ? "15 menores" : "15 maiores"} · mesmos filtros do mapa`;

  const definitions = [
    ["rankMun", "dnmChartRankingMun", dnmMunicipioRanking(aggregation, metric.field, order)],
    ["rankReg", "dnmChartRankingReg", dnmRegiaoRanking(aggregation, metric.field, order)],
  ];
  for (const [key, id, entries] of definitions) {
    const element = document.getElementById(id);
    if (!element) continue;
    dnmDestroyChart(key);
    const { config } = dnmBuildRankingConfig(entries, metric);
    const chart = new ApexCharts(element, config);
    chart.render();
    dnmCharts[key] = chart;
  }
}

function dnmBuildMonthlySeries(rows) {
  const map = new Map();
  for (const row of rows) {
    if (!row.mesAnoKey) continue;
    const current = map.get(row.mesAnoKey) || { valorOperacoes: 0, valorJuros: 0 };
    current.valorOperacoes += row.valorOperacoes;
    current.valorJuros += row.valorJuros;
    map.set(row.mesAnoKey, current);
  }
  const keys = [...map.keys()].sort((a, b) => dnmMesAnoRank(a) - dnmMesAnoRank(b));
  return {
    categories: keys.map(dnmMesAnoLabel),
    principal: keys.map((key) => map.get(key).valorOperacoes),
    juros: keys.map((key) => map.get(key).valorJuros),
  };
}

function dnmUpdatePeriodoChart(filtered) {
  if (typeof ApexCharts === "undefined") return;
  const element = document.getElementById("dnmChartPeriodoLine");
  if (!element) return;
  dnmDestroyChart("periodoLine");
  const { categories, principal, juros } = dnmBuildMonthlySeries(filtered);
  const hasData = categories.length > 0;
  const chart = new ApexCharts(element, {
    chart: {
      type: "line",
      height: 390,
      toolbar: { show: false },
      zoom: { enabled: false },
      fontFamily: "system-ui, Segoe UI, sans-serif",
      foreColor: "#1f2d78",
    },
    series: [
      { name: "Valor total das operações", data: hasData ? principal : [0] },
      { name: "Valor dos juros", data: hasData ? juros : [0] },
    ],
    colors: DNM_LINE_COLORS,
    stroke: { curve: "smooth", width: [3, 3] },
    markers: { size: 4, strokeWidth: 2, strokeColors: "#fff", hover: { size: 6 } },
    xaxis: {
      categories: hasData ? categories : ["Sem dados no filtro"],
      labels: { rotate: -45, rotateAlways: categories.length > 12, style: { fontSize: "11px", colors: "#475569" } },
    },
    yaxis: [
      {
        title: { text: "Valor das operações" },
        labels: { formatter: (value) => dnmCompactCurrencyFmt.format(Number(value) || 0) },
      },
      {
        opposite: true,
        title: { text: "Valor dos juros" },
        labels: { formatter: (value) => dnmCompactCurrencyFmt.format(Number(value) || 0) },
      },
    ],
    dataLabels: { enabled: false },
    legend: { position: "top", horizontalAlign: "left" },
    grid: { borderColor: "#fde68a", strokeDashArray: 4, padding: { left: 8, right: 8, top: 8, bottom: 8 } },
    tooltip: { shared: true, intersect: false, y: { formatter: (value) => dnmCurrencyFmt.format(Number(value) || 0) } },
    noData: { text: "Sem dados no filtro" },
  });
  chart.render();
  dnmCharts.periodoLine = chart;
}

function dnmRefreshKpis() {
  if (!dnmIsActivePage() || !dnmState.loaded) return;
  dnmRenderKpis(dnmComputeKpis(dnmFilterRows(dnmState.rows)));
}

function dnmRefreshMap() {
  if (!dnmIsActivePage() || !dnmState.loaded) return;
  const filtered = dnmFilterRows(dnmState.rows);
  window.ceRegioesMapApi?.applyDinheiroNaMaoLayer?.(
    dnmAggregateByCodigo(filtered),
    dnmGetSelectedMetricKey()
  );
}

function dnmRefreshCharts() {
  if (!dnmIsActivePage() || !dnmState.loaded) return;
  const filtered = dnmFilterRows(dnmState.rows);
  dnmUpdateRankingCharts(filtered);
  dnmUpdatePeriodoChart(filtered);
}

function dnmRefreshAll() {
  if (!dnmState.loaded) return;
  dnmRefreshKpis();
  dnmRefreshMap();
  dnmRefreshCharts();
}

async function dnmEnsureData() {
  if (dnmState.loaded || dnmState.loading) return;
  dnmState.loading = true;
  dnmSetStatus("Carregando planilha Dinheiro na Mão…");
  dnmRenderKpis({ operacoes: NaN, valorOperacoes: NaN, valorJuros: NaN });
  try {
    const response = await fetch(DINHEIRO_NA_MAO_CSV_URL, { cache: "no-store" });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    dnmState.rows = dnmParseCsvRows(await response.text());
    dnmState.loaded = true;
    dnmState.error = null;
    dnmBuildMunicipiosIndex();
    dnmSyncTemporalFilters();
    dnmSyncMunicipiosFromRegiao();
    dnmRefreshAll();
    dnmSetStatus(`${dnmState.rows.length.toLocaleString("pt-BR")} operações carregadas`);
  } catch (error) {
    dnmState.error = error;
    dnmSetStatus("Não foi possível carregar os dados do Dinheiro na Mão.");
    console.error("[dinheiro-na-mao]", error);
  } finally {
    dnmState.loading = false;
  }
}

function dnmOnPageActivate() {
  if (!dnmIsActivePage()) return;
  void dnmEnsureData().then(() => {
    if (dnmState.loaded) {
      dnmSyncTemporalFilters();
      dnmSyncMunicipiosFromRegiao();
    }
    dnmRefreshKpis();
    dnmRefreshMap();
    requestAnimationFrame(dnmRefreshCharts);
  });
}

function dnmClearMunicipioSelection() {
  const search = document.getElementById("mapFilterMunSearch");
  if (search) search.value = "";
  dnmRebuildMunicipioOptions(new Set());
}

function dnmSelectSingleMunicipioFromMap(codigo) {
  const value = String(codigo ?? "");
  if (!dnmState.municipiosList.some((item) => String(item.codigo) === value)) return;
  dnmRebuildMunicipioOptions(new Set([value]));
  dnmRefreshAll();
}

function dnmRestoreFullMunicipioFilter() {
  window.ceRegioesMapApi?.rebuildAllMunicipios?.();
}

function dnmBindFilters() {
  const root = document.getElementById("secaoMapaCe");
  if (!root || root.dataset.dnmBound === "1") return;
  root.dataset.dnmBound = "1";
  root.addEventListener("change", (event) => {
    if (!dnmIsActivePage()) return;
    const id = event.target?.id;
    if (id === "mapFilterAno") {
      dnmRebuildMesFilter();
      dnmRefreshAll();
    } else if (["mapFilterMes", "mapFilterMunicipio"].includes(id)) {
      dnmRefreshAll();
    } else if (id === "mapFilterRegiao") {
      dnmSyncMunicipiosFromRegiao();
      dnmRefreshAll();
    } else if (id === "mapDinheiroNaMaoLayerStyle") {
      dnmRefreshAll();
    } else if (id === "dnmRankOrder") {
      dnmRefreshCharts();
    }
  });
  root.addEventListener("click", (event) => {
    if (!dnmIsActivePage() || !(event.target instanceof HTMLElement)) return;
    if (event.target.id === "mapFilterAnoClear") {
      const select = document.getElementById("mapFilterAno");
      if (select) Array.from(select.options).forEach((option) => { option.selected = false; });
      dnmRebuildMesFilter();
      dnmRefreshAll();
    } else if (event.target.id === "mapFilterMesClear") {
      const select = document.getElementById("mapFilterMes");
      if (select) Array.from(select.options).forEach((option) => { option.selected = false; });
      dnmRefreshAll();
    } else if (event.target.id === "mapFilterRegiaoClear") {
      const select = document.getElementById("mapFilterRegiao");
      if (select) Array.from(select.options).forEach((option) => { option.selected = false; });
      dnmSyncMunicipiosFromRegiao();
      dnmRefreshAll();
    } else if (event.target.id === "mapFilterMunClear") {
      dnmClearMunicipioSelection();
      dnmRefreshAll();
    }
  });
}

window.dinheiroNaMaoApi = {
  onPageActivate: dnmOnPageActivate,
  refresh: dnmRefreshAll,
  refreshMap: dnmRefreshMap,
  refreshCharts: dnmRefreshCharts,
  destroyCharts: dnmDestroyCharts,
  syncTemporalFilters: dnmSyncTemporalFilters,
  syncMunicipiosFromRegiao: dnmSyncMunicipiosFromRegiao,
  clearMunicipioSelection: dnmClearMunicipioSelection,
  selectSingleMunicipioFromMap: dnmSelectSingleMunicipioFromMap,
  rebuildMunicipioOptions: () => dnmRebuildMunicipioOptions(),
  restoreFullMunicipioFilter: dnmRestoreFullMunicipioFilter,
  getMetricLabel: (key) => dnmGetMetricConfig(key).label,
  getMetricField: (key) => dnmGetMetricConfig(key).field,
};

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", dnmBindFilters);
} else {
  dnmBindFilters();
}
