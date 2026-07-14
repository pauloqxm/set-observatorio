const QUALIFICACAO_CSV_URL =
  "https://docs.google.com/spreadsheets/d/e/2PACX-1vSX4leER0WfjxQAuMkPJR9O3mpi1r8XlBaL9ef0bVW7Pb8muKdyJrYB2RvpE5PqSEbCWIAyVj0Wh-L6/pub?gid=1427271035&single=true&output=csv";

const QF_MESES_SHORT = ["jan", "fev", "mar", "abr", "mai", "jun", "jul", "ago", "set", "out", "nov", "dez"];
const QF_EXECUTORA_TODOS = "todos";
const QF_METRIC_OPTIONS = [
  { key: "cursos", field: "cursos", label: "Cursos ofertados" },
  { key: "vagas", field: "vagas", label: "Vagas ofertadas" },
  { key: "inscritos", field: "inscritos", label: "Inscritos" },
  { key: "desistentes", field: "desistentes", label: "Desistentes" },
  { key: "concludentes", field: "concludentes", label: "Concludentes" },
];
const QF_BAR_RANKING_COLOR = "#2563eb";
const QF_RANKING_TOP_N = 15;

const qfState = {
  rows: [],
  loading: false,
  loaded: false,
  error: null,
  municipiosList: [],
  executoras: [],
};

const qfFmt = new Intl.NumberFormat("pt-BR");

const qfCharts = {
  rankMun: null,
  rankReg: null,
};

function qfGetSelectedRankOrder() {
  const el = document.getElementById("qfRankOrder");
  return el?.value === "menores" ? "menores" : "maiores";
}

function qfRankOrderLabel(order) {
  return order === "menores" ? "15 menores" : "15 maiores";
}

function qfSortRankingRows(rows, order) {
  rows.sort((a, b) => {
    const cmp = order === "maiores" ? b.value - a.value : a.value - b.value;
    return cmp || a.label.localeCompare(b.label, "pt-BR");
  });
  return rows;
}

function qfPickMunicipioRankingEntries(aggByCod, field, order = qfGetSelectedRankOrder()) {
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
  return qfSortRankingRows(rows, order).slice(0, QF_RANKING_TOP_N);
}

function qfPickRegiaoRankingEntries(aggByCod, field, order = qfGetSelectedRankOrder()) {
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
  return qfSortRankingRows(rows, order).slice(0, QF_RANKING_TOP_N);
}

function qfBuildRankingBarConfig(entries, color, seriesName) {
  const hasData = entries.length > 0;
  const data = hasData ? entries.map((e) => ({ x: e.label, y: e.value })) : [{ x: "Sem dados no filtro", y: 0 }];
  const height = Math.max(280, 48 + Math.max(entries.length || 1, 1) * 28);
  const valFmt = (val) => qfFmt.format(Number(val) || 0);
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

function qfDestroyChart(key) {
  const chart = qfCharts[key];
  if (!chart) return;
  try {
    chart.destroy();
  } catch (_) {}
  qfCharts[key] = null;
}

function qfDestroyCharts() {
  for (const key of Object.keys(qfCharts)) qfDestroyChart(key);
}

function qfUpdateRankingHints(order) {
  const metricKey = qfGetSelectedMetricKey();
  const metricLabel = qfMetricLabel(metricKey);
  const exec = qfGetSelectedExecutora();
  const execNote = exec === QF_EXECUTORA_TODOS ? "Todas as executoras" : exec;
  const orderNote = qfRankOrderLabel(order);
  const headHint = document.getElementById("qfRankingsHeadHint");
  if (headHint) {
    headHint.textContent = `${metricLabel} · ${execNote} · ${orderNote} · valor absoluto no recorte dos filtros · mesmos filtros do mapa`;
  }
}

function qfUpdateRankingCharts(filtered) {
  if (typeof ApexCharts === "undefined") return;
  const metricKey = qfGetSelectedMetricKey();
  const metricField = qfGetMetricField(metricKey);
  const metricLabel = qfMetricLabel(metricKey);
  const order = qfGetSelectedRankOrder();
  const aggByCod = qfAggregateByCodigo(filtered);
  const munEntries = qfPickMunicipioRankingEntries(aggByCod, metricField, order);
  const regEntries = qfPickRegiaoRankingEntries(aggByCod, metricField, order);
  qfUpdateRankingHints(order);

  const munEl = document.getElementById("qfChartRankingMun");
  if (munEl) {
    qfDestroyChart("rankMun");
    const { config } = qfBuildRankingBarConfig(munEntries, QF_BAR_RANKING_COLOR, metricLabel);
    const chart = new ApexCharts(munEl, config);
    chart.render();
    qfCharts.rankMun = chart;
  }

  const regEl = document.getElementById("qfChartRankingReg");
  if (regEl) {
    qfDestroyChart("rankReg");
    const { config } = qfBuildRankingBarConfig(regEntries, QF_BAR_RANKING_COLOR, metricLabel);
    const chart = new ApexCharts(regEl, config);
    chart.render();
    qfCharts.rankReg = chart;
  }
}

function qfRefreshCharts() {
  if (!qfIsActivePage() || !qfState.loaded) return;
  qfUpdateRankingCharts(qfFilterRows(qfState.rows));
}

function qfNormHeader(value) {
  return String(value ?? "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
}

function qfParseCsvLine(line) {
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

function qfParseNumber(raw) {
  const s = String(raw ?? "").trim();
  if (!s) return 0;
  const clean = s.replace(/\./g, "").replace(",", ".");
  const n = Number(clean);
  return Number.isFinite(n) ? n : 0;
}

/** Converte lat/lon da planilha (aceita vírgula decimal brasileira). */
function qfParseCoord(raw) {
  const s = String(raw ?? "")
    .trim()
    .replace(/\s/g, "")
    .replace(",", ".");
  if (!s) return null;
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
}

function qfNormalizeCodigo(raw) {
  const digits = String(raw ?? "").replace(/\D/g, "");
  const n = parseInt(digits, 10);
  if (!Number.isFinite(n) || n <= 0) return null;
  if (n >= 1_000_000) return Math.floor(n / 10);
  return n;
}

function qfParseDataTermino(raw) {
  const s = String(raw || "").trim();
  if (!s) return null;
  const parts = s.split("/");
  if (parts.length !== 3) return null;
  let day = Number(parts[0]);
  let month = Number(parts[1]);
  const year = Number(parts[2]);
  if (!Number.isFinite(day) || !Number.isFinite(month) || !Number.isFinite(year)) return null;
  if (month > 12 && day >= 1 && day <= 12) {
    const tmp = month;
    month = day;
    day = tmp;
  }
  if (month < 1 || month > 12 || day < 1 || day > 31) return null;
  return {
    year,
    month,
    day,
    mesAnoKey: `${year}-${String(month).padStart(2, "0")}`,
  };
}

function qfMesAnoKeyRank(key) {
  const [y, m] = String(key || "").split("-").map(Number);
  if (!Number.isFinite(y) || !Number.isFinite(m)) return 0;
  return y * 100 + m;
}

function qfMesAnoLabel(key) {
  if (typeof window.ceRegioesMapApi?.formatMesAnoKey === "function") {
    return window.ceRegioesMapApi.formatMesAnoKey(key);
  }
  const [year, month] = String(key || "").split("-");
  const m = Number(month);
  if (!year || !Number.isFinite(m) || m < 1 || m > 12) return String(key || "—");
  return `${QF_MESES_SHORT[m - 1]}/${year}`;
}

function qfHeaderIndex(header, candidates) {
  const map = new Map(header.map((h, i) => [qfNormHeader(h), i]));
  for (const c of candidates) {
    const idx = map.get(qfNormHeader(c));
    if (idx != null) return idx;
  }
  return -1;
}

function qfParseCsvRows(text) {
  const raw = String(text || "").replace(/^\uFEFF/, "");
  const lines = raw.split(/\r?\n/).filter((l) => l.trim());
  if (!lines.length) return [];

  const header = qfParseCsvLine(lines[0]);
  const idxCidade = qfHeaderIndex(header, ["CIDADE", "Municipio", "Município"]);
  const idxCod = qfHeaderIndex(header, ["COD_IBGE", "Codigo_IBGE", "Código IBGE", "codibge"]);
  const idxExec = qfHeaderIndex(header, ["EXECUTORA"]);
  const idxTermino = qfHeaderIndex(header, ["DATA TÉRMINO", "DATA TERMINO", "Data Termino"]);
  const idxVagas = qfHeaderIndex(header, ["VAGAS OFERTADAS", "Vagas Ofertadas"]);
  const idxInscritos = qfHeaderIndex(header, ["INSCRITOS"]);
  const idxDesistentes = qfHeaderIndex(header, ["DESISTENTES"]);
  const idxConcludentes = qfHeaderIndex(header, ["CONCLUDENTES"]);
  const idxPrograma = qfHeaderIndex(header, ["PROGRAMA"]);
  const idxCurso = qfHeaderIndex(header, ["CURSO"]);
  const idxArea = qfHeaderIndex(header, ["ÁREA DO CURSO", "AREA DO CURSO", "Área do Curso"]);
  const idxBairro = qfHeaderIndex(header, ["BAIRRO"]);
  const idxEndereco = qfHeaderIndex(header, [
    "ENDEREÇO DO LOCAL DO CURSO",
    "ENDERECO DO LOCAL DO CURSO",
    "Endereço do Local do Curso",
  ]);
  const idxLat = qfHeaderIndex(header, ["Latitude", "LATITUDE", "Lat"]);
  const idxLon = qfHeaderIndex(header, ["Longitude", "LONGITUDE", "Lon", "Long"]);

  if (idxCod < 0 || idxTermino < 0) {
    console.warn("[qualificacao] Colunas COD_IBGE ou DATA TÉRMINO não encontradas.", header);
    return [];
  }

  const rows = [];
  for (let i = 1; i < lines.length; i++) {
    const cells = qfParseCsvLine(lines[i]);
    if (!cells.length) continue;
    const codigo = qfNormalizeCodigo(cells[idxCod]);
    if (codigo == null) continue;
    const dateParts = qfParseDataTermino(cells[idxTermino] || "");
    if (!dateParts) continue;
    const lat = idxLat >= 0 ? qfParseCoord(cells[idxLat]) : null;
    const lon = idxLon >= 0 ? qfParseCoord(cells[idxLon]) : null;
    const hasCoords =
      lat != null &&
      lon != null &&
      Math.abs(lat) <= 90 &&
      Math.abs(lon) <= 180;
    rows.push({
      codigo,
      municipio: idxCidade >= 0 ? cells[idxCidade] || "" : "",
      executora: idxExec >= 0 ? String(cells[idxExec] || "").trim() : "",
      programa: idxPrograma >= 0 ? cells[idxPrograma] || "" : "",
      curso: idxCurso >= 0 ? cells[idxCurso] || "" : "",
      area: idxArea >= 0 ? cells[idxArea] || "" : "",
      bairro: idxBairro >= 0 ? cells[idxBairro] || "" : "",
      endereco: idxEndereco >= 0 ? cells[idxEndereco] || "" : "",
      dataTermino: cells[idxTermino] || "",
      ano: dateParts.year,
      mes: dateParts.month,
      mesAnoKey: dateParts.mesAnoKey,
      vagas: idxVagas >= 0 ? qfParseNumber(cells[idxVagas]) : 0,
      inscritos: idxInscritos >= 0 ? qfParseNumber(cells[idxInscritos]) : 0,
      desistentes: idxDesistentes >= 0 ? qfParseNumber(cells[idxDesistentes]) : 0,
      concludentes: idxConcludentes >= 0 ? qfParseNumber(cells[idxConcludentes]) : 0,
      lat: hasCoords ? lat : null,
      lon: hasCoords ? lon : null,
    });
  }
  return rows;
}

function qfBuildCursosPointsGeoJson(rows) {
  const features = [];
  for (const row of rows) {
    if (row.lat == null || row.lon == null) continue;
    features.push({
      type: "Feature",
      geometry: {
        type: "Point",
        coordinates: [row.lon, row.lat],
      },
      properties: {
        codigo: row.codigo,
        municipio: row.municipio || "",
        curso: row.curso || "",
        programa: row.programa || "",
        executora: row.executora || "",
        area: row.area || "",
        bairro: row.bairro || "",
        endereco: row.endereco || "",
        dataTermino: row.dataTermino || "",
        vagas: row.vagas,
        inscritos: row.inscritos,
        desistentes: row.desistentes,
        concludentes: row.concludentes,
      },
    });
  }
  return { type: "FeatureCollection", features };
}

function qfBuildMunicipiosIndex() {
  const munMap = new Map();
  for (const row of qfState.rows) {
    if (!munMap.has(row.codigo)) munMap.set(row.codigo, row.municipio);
  }
  qfState.municipiosList = [...munMap.entries()]
    .map(([codigo, municipio]) => ({ codigo, municipio }))
    .sort((a, b) => a.municipio.localeCompare(b.municipio, "pt-BR"));
}

function qfBuildExecutorasIndex() {
  const set = new Set();
  for (const row of qfState.rows) {
    if (row.executora) set.add(row.executora);
  }
  qfState.executoras = [...set].sort((a, b) => a.localeCompare(b, "pt-BR"));
}

function qfPopulateExecutoraSelect() {
  const sel = document.getElementById("mapQualificacaoExecutoraStyle");
  if (!sel) return;
  const prev = sel.value || QF_EXECUTORA_TODOS;
  sel.innerHTML = "";
  const optTodos = document.createElement("option");
  optTodos.value = QF_EXECUTORA_TODOS;
  optTodos.textContent = "Todas";
  sel.appendChild(optTodos);
  for (const name of qfState.executoras) {
    const opt = document.createElement("option");
    opt.value = name;
    opt.textContent = name;
    sel.appendChild(opt);
  }
  sel.value = [...sel.options].some((o) => o.value === prev) ? prev : QF_EXECUTORA_TODOS;
}

function qfPopulateAnoFilter() {
  const sel = document.getElementById("mapFilterAno");
  if (!sel) return;
  const prev = new Set(Array.from(sel.selectedOptions).map((o) => o.value));
  const years = [...new Set(qfState.rows.map((r) => r.ano).filter((y) => Number.isFinite(y)))].sort(
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

function qfGetSelectedAnos() {
  const sel = document.getElementById("mapFilterAno");
  if (!sel) return [];
  return Array.from(sel.selectedOptions)
    .map((o) => String(o.value || ""))
    .filter(Boolean);
}

function qfRebuildMesFilter() {
  const sel = document.getElementById("mapFilterMes");
  const anoSel = qfGetSelectedAnos();
  if (!sel) return;
  const prev = new Set(Array.from(sel.selectedOptions).map((o) => o.value));
  const keys = new Set();
  for (const row of qfState.rows) {
    if (!row.mesAnoKey) continue;
    if (anoSel.length && !anoSel.includes(String(row.ano))) continue;
    keys.add(row.mesAnoKey);
  }
  const sorted = [...keys].sort((a, b) => qfMesAnoKeyRank(a) - qfMesAnoKeyRank(b));
  sel.innerHTML = "";
  for (const key of sorted) {
    const opt = document.createElement("option");
    opt.value = key;
    opt.textContent = qfMesAnoLabel(key);
    if (prev.has(key)) opt.selected = true;
    sel.appendChild(opt);
  }
}

function qfRebuildMunicipioOptions(preferredSelection) {
  const sel = document.getElementById("mapFilterMunicipio");
  const searchEl = document.getElementById("mapFilterMunSearch");
  if (!sel || !qfState.municipiosList.length) return;

  const regSel = qfGetSelectedRegioes();
  let pool = qfState.municipiosList;
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

function qfSyncMunicipiosFromRegiao() {
  if (!qfState.municipiosList.length) return;
  const regSel = qfGetSelectedRegioes();
  const codes = new Set();
  if (regSel.length && typeof window.ceRegioesMapApi?.getRegiaoToCodigos === "function") {
    const regMap = window.ceRegioesMapApi.getRegiaoToCodigos();
    const valid = new Set(qfState.municipiosList.map((m) => String(m.codigo)));
    for (const reg of regSel) {
      const set = regMap.get(reg);
      if (!set) continue;
      for (const c of set) {
        const cs = String(c);
        if (valid.has(cs)) codes.add(cs);
      }
    }
  }
  qfRebuildMunicipioOptions(codes);
}

function qfClearMunicipioSelection() {
  const search = document.getElementById("mapFilterMunSearch");
  if (search) search.value = "";
  qfRebuildMunicipioOptions(new Set());
}

function qfSelectSingleMunicipioFromMap(codigo) {
  const codStr = String(codigo ?? "").trim();
  if (!codStr) return;
  const exists = qfState.municipiosList.some((m) => String(m.codigo) === codStr);
  if (!exists) return;
  const search = document.getElementById("mapFilterMunSearch");
  if (search) search.value = "";
  qfRebuildMunicipioOptions(new Set([codStr]));
  qfRefreshAll();
}

function qfGetSelectedMesKeys() {
  const sel = document.getElementById("mapFilterMes");
  if (!sel) return [];
  return Array.from(sel.selectedOptions)
    .map((o) => String(o.value || ""))
    .filter(Boolean);
}

function qfGetSelectedMunicipioCodes() {
  const sel = document.getElementById("mapFilterMunicipio");
  if (!sel) return [];
  return Array.from(sel.selectedOptions)
    .map((o) => String(o.value || ""))
    .filter(Boolean);
}

function qfGetSelectedRegioes() {
  const sel = document.getElementById("mapFilterRegiao");
  if (!sel) return [];
  return Array.from(sel.selectedOptions)
    .map((o) => String(o.value || ""))
    .filter(Boolean);
}

function qfGetSelectedExecutora() {
  const el = document.getElementById("mapQualificacaoExecutoraStyle");
  const v = (el?.value || QF_EXECUTORA_TODOS).trim();
  return v || QF_EXECUTORA_TODOS;
}

function qfGetSelectedMetricKey() {
  const el = document.getElementById("mapQualificacaoLayerStyle");
  const v = el?.value || "cursos";
  return QF_METRIC_OPTIONS.some((m) => m.key === v) ? v : "cursos";
}

function qfMetricLabel(metricKey) {
  return QF_METRIC_OPTIONS.find((m) => m.key === metricKey)?.label || metricKey;
}

function qfGetMetricField(metricKey) {
  return QF_METRIC_OPTIONS.find((m) => m.key === metricKey)?.field || "cursos";
}

function qfFilterRows(rows) {
  const anos = qfGetSelectedAnos();
  const meses = qfGetSelectedMesKeys();
  const muns = qfGetSelectedMunicipioCodes();
  const regs = qfGetSelectedRegioes();
  const exec = qfGetSelectedExecutora();
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
    if (exec !== QF_EXECUTORA_TODOS && row.executora !== exec) return false;
    return true;
  });
}

function qfEmptyMunAgg(municipio = "", codigo = null) {
  return {
    codigo,
    municipio,
    cursos: 0,
    vagas: 0,
    inscritos: 0,
    desistentes: 0,
    concludentes: 0,
  };
}

function qfAggregateByCodigo(rows) {
  /** @type {Map<number, ReturnType<typeof qfEmptyMunAgg>>} */
  const byCod = new Map();
  for (const row of rows) {
    const cur = byCod.get(row.codigo) || qfEmptyMunAgg(row.municipio, row.codigo);
    byCod.set(row.codigo, {
      codigo: row.codigo,
      municipio: cur.municipio || row.municipio,
      cursos: cur.cursos + 1,
      vagas: cur.vagas + row.vagas,
      inscritos: cur.inscritos + row.inscritos,
      desistentes: cur.desistentes + row.desistentes,
      concludentes: cur.concludentes + row.concludentes,
    });
  }
  return byCod;
}

function qfComputeKpis(rows) {
  let cursos = 0;
  let vagas = 0;
  let inscritos = 0;
  let desistentes = 0;
  let concludentes = 0;
  for (const row of rows) {
    cursos += 1;
    vagas += row.vagas;
    inscritos += row.inscritos;
    desistentes += row.desistentes;
    concludentes += row.concludentes;
  }
  return { cursos, vagas, inscritos, desistentes, concludentes };
}

function qfRenderKpis(kpis) {
  const set = (id, v) => {
    const el = document.getElementById(id);
    if (el) el.textContent = Number.isFinite(v) ? qfFmt.format(v) : "—";
  };
  set("qfKpiCursos", kpis.cursos);
  set("qfKpiVagas", kpis.vagas);
  set("qfKpiInscritos", kpis.inscritos);
  set("qfKpiDesistentes", kpis.desistentes);
  set("qfKpiConcludentes", kpis.concludentes);
}

function qfSetStatus(message) {
  const el = document.getElementById("qfStatus");
  if (el) {
    el.textContent = message || "";
    el.hidden = !message;
  }
  const kpiNote = document.getElementById("qfKpiStatus");
  if (kpiNote && qfIsActivePage()) kpiNote.textContent = message || "";
}

function qfRefreshKpis() {
  if (!qfIsActivePage() || !qfState.loaded) return;
  const filtered = qfFilterRows(qfState.rows);
  qfRenderKpis(qfComputeKpis(filtered));
}

function qfRefreshMap() {
  if (!qfIsActivePage() || !qfState.loaded) return;
  const filtered = qfFilterRows(qfState.rows);
  const aggByCod = qfAggregateByCodigo(filtered);
  const metricKey = qfGetSelectedMetricKey();
  window.ceRegioesMapApi?.applyQualificacaoLayer?.(aggByCod, metricKey);
  window.ceRegioesMapApi?.applyQualificacaoCursosPoints?.(qfBuildCursosPointsGeoJson(filtered));
}

function qfRefreshAll() {
  if (!qfState.loaded) return;
  qfRefreshKpis();
  qfRefreshMap();
  qfRefreshCharts();
}

async function qfEnsureData() {
  if (qfState.loaded || qfState.loading) return;
  qfState.loading = true;
  qfSetStatus("Carregando planilha Qualificação…");
  qfRenderKpis({ cursos: NaN, vagas: NaN, inscritos: NaN, desistentes: NaN, concludentes: NaN });
  try {
    const res = await fetch(QUALIFICACAO_CSV_URL, { cache: "no-store" });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const text = await res.text();
    qfState.rows = qfParseCsvRows(text);
    qfState.loaded = true;
    qfState.error = null;
    qfBuildMunicipiosIndex();
    qfBuildExecutorasIndex();
    qfPopulateExecutoraSelect();
    qfPopulateAnoFilter();
    qfRebuildMesFilter();
    qfSyncMunicipiosFromRegiao();
    qfRefreshAll();
    qfSetStatus(`${qfState.rows.length.toLocaleString("pt-BR")} registros carregados`);
  } catch (err) {
    qfState.error = err;
    qfSetStatus("Não foi possível carregar os dados de Qualificação.");
    console.error("[qualificacao]", err);
  } finally {
    qfState.loading = false;
  }
}

function qfIsActivePage() {
  return document.getElementById("secaoMapaCe")?.classList.contains("section-map-ce--qualificacao") === true;
}

function qfOnPageActivate() {
  if (!qfIsActivePage()) return;
  void qfEnsureData().then(() => {
    if (qfState.loaded) {
      qfPopulateAnoFilter();
      qfRebuildMesFilter();
      qfSyncMunicipiosFromRegiao();
    }
    qfRefreshKpis();
    qfRefreshMap();
    requestAnimationFrame(() => qfRefreshCharts());
  });
}

function qfRestoreFullMunicipioFilter() {
  if (typeof window.ceRegioesMapApi?.rebuildAllMunicipios === "function") {
    window.ceRegioesMapApi.rebuildAllMunicipios();
  }
}

function qfBindFilters() {
  const root = document.getElementById("secaoMapaCe");
  if (!root || root.dataset.qfBound === "1") return;
  root.dataset.qfBound = "1";

  root.addEventListener("change", (e) => {
    if (!qfIsActivePage()) return;
    const id = e.target?.id;
    if (id === "mapFilterAno") {
      qfRebuildMesFilter();
      qfRefreshAll();
    }
    if (id === "mapFilterMes" || id === "mapFilterMunicipio" || id === "mapFilterRegiao") {
      if (id === "mapFilterRegiao") qfSyncMunicipiosFromRegiao();
      qfRefreshAll();
    }
    if (id === "mapQualificacaoExecutoraStyle" || id === "mapQualificacaoLayerStyle") {
      qfRefreshAll();
    }
    if (id === "qfRankOrder") {
      qfRefreshCharts();
    }
  });

  root.addEventListener("click", (e) => {
    if (!qfIsActivePage() || !(e.target instanceof HTMLElement)) return;
    if (e.target.id === "mapFilterAnoClear") {
      const sel = document.getElementById("mapFilterAno");
      if (sel) Array.from(sel.options).forEach((o) => { o.selected = false; });
      qfRebuildMesFilter();
      qfRefreshAll();
    }
    if (e.target.id === "mapFilterMesClear") {
      const sel = document.getElementById("mapFilterMes");
      if (sel) Array.from(sel.options).forEach((o) => { o.selected = false; });
      qfRefreshAll();
    }
    if (e.target.id === "mapFilterRegiaoClear") {
      const sel = document.getElementById("mapFilterRegiao");
      if (sel) Array.from(sel.options).forEach((o) => { o.selected = false; });
      qfSyncMunicipiosFromRegiao();
      qfRefreshAll();
    }
    if (e.target.id === "mapFilterMunClear") {
      qfClearMunicipioSelection();
      qfRefreshAll();
    }
  });
}

function qfInit() {
  qfBindFilters();
}

window.qualificacaoApi = {
  onPageActivate: qfOnPageActivate,
  refresh: qfRefreshAll,
  refreshMap: qfRefreshMap,
  refreshCharts: qfRefreshCharts,
  destroyCharts: qfDestroyCharts,
  syncMunicipiosFromRegiao: qfSyncMunicipiosFromRegiao,
  clearMunicipioSelection: qfClearMunicipioSelection,
  selectSingleMunicipioFromMap: qfSelectSingleMunicipioFromMap,
  rebuildMunicipioOptions: () => qfRebuildMunicipioOptions(),
  restoreFullMunicipioFilter: qfRestoreFullMunicipioFilter,
  getMetricLabel: qfMetricLabel,
  getMetricField: qfGetMetricField,
};

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", qfInit);
} else {
  qfInit();
}
