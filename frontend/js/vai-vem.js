const VAI_VEM_CSV_URL =
  "https://docs.google.com/spreadsheets/d/e/2PACX-1vTG4lc2hb_XAenjE_ja8uQ5dzaAj9-b80hU_H1N0RvZ0jTQSXdkhEassrmQwUNryAqOeObP4C9ZhPHh/pub?gid=1946422191&single=true&output=csv";

const VV_MESES_SHORT = ["jan", "fev", "mar", "abr", "mai", "jun", "jul", "ago", "set", "out", "nov", "dez"];
const VV_LINE_COLORS = ["#ea580c", "#2563eb", "#059669"];
const VV_LINE_HIDDEN_BY_DEFAULT = new Set(["Desempregados", "Vínculo emprego"]);
const VV_BAR_MUN_COLOR = "#f97316";
const VV_BAR_REG_COLORS = ["#ea580c", "#2563eb"];
const VV_BAR_DETAIL_COLOR = "#2563eb";
const VV_DONUT_PALETTE = ["#2563eb", "#059669", "#38bdf8", "#1e40af", "#f97316", "#9333ea", "#ec4899", "#64748b"];
const VV_GENERO_COLORS = {
  Mulher: "#2563eb",
  Homem: "#059669",
  "Mulher Trans": "#38bdf8",
  "Homem Trans": "#1e40af",
  "Não binário": "#f97316",
  Travesti: "#9333ea",
  Outros: "#ec4899",
  "*": "#64748b",
};
const VV_PAPEL_COLORS = {
  "Arrimo ou Chefe de família": "#2563eb",
  "Compõe renda": "#059669",
  Dependente: "#f97316",
  "*": "#64748b",
};

const vvState = {
  rows: [],
  loading: false,
  loaded: false,
  error: null,
  municipiosList: [],
  regiaoToMunKeys: new Map(),
};

let vvMunSearchTimer = null;

const vvCharts = {
  line: null,
  barMun: null,
  barReg: null,
  barUnidade: null,
  barStatusIdt: null,
  donutGenero: null,
  barRacaCor: null,
  donutPapelFamilia: null,
  barEscolaridade: null,
};

const vvFmt = new Intl.NumberFormat("pt-BR");

function vvNormText(value) {
  if (typeof window.ceRegioesMapApi?.normMunKey === "function") {
    return window.ceRegioesMapApi.normMunKey(value);
  }
  return String(value ?? "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .trim();
}

function vvParseCsvLine(line) {
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

function vvParseDataSolicitacao(raw) {
  const s = String(raw || "").trim();
  if (!s) return null;
  const parts = s.split("/");
  if (parts.length !== 3) return null;
  // Planilha usa DD/MM/AAAA (ex.: 30/01/2026, 05/02/2026).
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
  const mesAnoKey = `${year}-${String(month).padStart(2, "0")}`;
  return { year, month, day, mesAnoKey };
}

function vvMesAnoLabel(key) {
  const [year, month] = String(key || "").split("-");
  const m = Number(month);
  if (!year || !Number.isFinite(m) || m < 1 || m > 12) return String(key || "—");
  return `${VV_MESES_SHORT[m - 1]}/${year}`;
}

function vvMesAnoKeyRank(key) {
  const [y, m] = String(key || "").split("-").map(Number);
  if (!Number.isFinite(y) || !Number.isFinite(m)) return 0;
  return y * 100 + m;
}

function vvParseCsvRows(text) {
  const raw = String(text || "").replace(/^\uFEFF/, "");
  const lines = raw.split(/\r?\n/).filter((l) => l.trim());
  if (!lines.length) return [];

  const header = vvParseCsvLine(lines[0]).map((h) => h.trim());
  const idx = Object.fromEntries(header.map((h, i) => [h, i]));
  const pick = (cells, key) => cells[idx[key]] ?? "";

  const rows = [];
  for (let i = 1; i < lines.length; i++) {
    const cells = vvParseCsvLine(lines[i]);
    if (!cells.length) continue;
    const municipio = pick(cells, "municipio");
    if (!municipio) continue;
    const dateParts = vvParseDataSolicitacao(pick(cells, "data_solicitacao"));
    rows.push({
      municipio,
      municipioKey: vvNormText(municipio),
      dataSolicitacao: pick(cells, "data_solicitacao"),
      ano: dateParts?.year ?? null,
      mes: dateParts?.month ?? null,
      mesAnoKey: dateParts?.mesAnoKey ?? "",
      situacaoPrograma: pick(cells, "situacao_no_programa"),
      situacaoCartao: pick(cells, "situacao_cartao"),
      dataImpressao: pick(cells, "data_impressao"),
      regiaoSigla: pick(cells, "regiao_sigla").toUpperCase(),
      regiaoDesc: pick(cells, "regiao_desc"),
      unidadeDesc: pick(cells, "unidade_desc"),
      situacaoIdt: pick(cells, "situacao_idt"),
      genero: pick(cells, "id_genero"),
      racaCor: pick(cells, "raca_cor"),
      papelFamilia: pick(cells, "papel_familia"),
      escolaridade: pick(cells, "escolaridade"),
    });
  }
  return rows;
}

function vvIsDesempregado(situacaoPrograma) {
  return vvNormText(situacaoPrograma).includes("desempregad");
}

function vvIsVinculoEmprego(situacaoPrograma) {
  return vvNormText(situacaoPrograma) === "vinculo de emprego";
}

function vvIsCartaoEntregue(situacaoCartao) {
  return vvNormText(situacaoCartao).includes("entregue");
}

function vvIsAguardandoImpressao(situacaoCartao) {
  const sc = vvNormText(situacaoCartao);
  return sc === "aguardando impressao" || sc === "esperando";
}

function vvIsCartaoImpresso(row) {
  if (!String(row.dataImpressao || "").trim()) return false;
  const sc = vvNormText(row.situacaoCartao);
  if (vvIsCartaoEntregue(row.situacaoCartao)) return false;
  if (vvIsAguardandoImpressao(row.situacaoCartao)) return false;
  return true;
}

function vvEmptyMunAgg(municipio = "", municipioKey = "") {
  return {
    municipio,
    municipioKey,
    total: 0,
    desempregados: 0,
    vinculoEmprego: 0,
    aguardandoImpressao: 0,
    cartoesImpressos: 0,
    cartaoEntregue: 0,
    solicitacoesRmf: 0,
    solicitacoesRmc: 0,
  };
}

function vvAccumulateRow(agg, row) {
  agg.total += 1;
  if (vvIsDesempregado(row.situacaoPrograma)) agg.desempregados += 1;
  if (vvIsVinculoEmprego(row.situacaoPrograma)) agg.vinculoEmprego += 1;
  if (vvIsAguardandoImpressao(row.situacaoCartao)) agg.aguardandoImpressao += 1;
  else if (vvIsCartaoImpresso(row)) agg.cartoesImpressos += 1;
  if (vvIsCartaoEntregue(row.situacaoCartao)) agg.cartaoEntregue += 1;
  if (row.regiaoSigla === "RMF") agg.solicitacoesRmf += 1;
  if (row.regiaoSigla === "RMC") agg.solicitacoesRmc += 1;
}

function vvComputeKpis(rows) {
  const kpis = vvEmptyMunAgg();
  for (const row of rows) vvAccumulateRow(kpis, row);
  return kpis;
}

function vvAggregateByMunicipio(rows) {
  /** @type {Map<string, ReturnType<typeof vvEmptyMunAgg>>} */
  const byMun = new Map();
  for (const row of rows) {
    const key = row.municipioKey || vvNormText(row.municipio);
    if (!key) continue;
    const cur = byMun.get(key) || vvEmptyMunAgg(row.municipio, key);
    vvAccumulateRow(cur, row);
    byMun.set(key, cur);
  }
  return byMun;
}

function vvGetSelectedMunicipioKeys() {
  const sel = document.getElementById("mapFilterMunicipio");
  if (!sel) return [];
  return Array.from(sel.selectedOptions)
    .map((o) => String(o.value || "").trim())
    .filter(Boolean);
}

function vvGetSelectedRegioes() {
  const sel = document.getElementById("mapFilterVaiVemRegiao");
  if (!sel) return [];
  return Array.from(sel.selectedOptions)
    .map((o) => String(o.value || "").toUpperCase())
    .filter(Boolean);
}

function vvBuildMunicipiosIndex() {
  const byRegiao = new Map([
    ["RMF", new Set()],
    ["RMC", new Set()],
  ]);
  /** @type {Map<string, { municipio: string, municipioKey: string, regiaoSigla: string }>} */
  const byKey = new Map();
  for (const row of vvState.rows) {
    const key = row.municipioKey || vvNormText(row.municipio);
    if (!key) continue;
    if (!byKey.has(key)) {
      byKey.set(key, {
        municipio: row.municipio,
        municipioKey: key,
        regiaoSigla: row.regiaoSigla,
      });
    }
    if (row.regiaoSigla && byRegiao.has(row.regiaoSigla)) {
      byRegiao.get(row.regiaoSigla).add(key);
    }
  }
  vvState.municipiosList = [...byKey.values()].sort((a, b) =>
    a.municipio.localeCompare(b.municipio, "pt-BR")
  );
  vvState.regiaoToMunKeys = byRegiao;
}

/**
 * Reconstrói o select de municípios do Vai Vem (apenas municípios da planilha).
 * @param {Set<string>|undefined} preferredSelection
 */
function vvRebuildMunicipioOptions(preferredSelection) {
  const sel = document.getElementById("mapFilterMunicipio");
  const searchEl = document.getElementById("mapFilterMunSearch");
  if (!sel || !vvState.municipiosList.length) return;

  const regSel = vvGetSelectedRegioes();
  let pool = vvState.municipiosList;
  if (regSel.length) {
    const allowed = new Set();
    for (const reg of regSel) {
      const set = vvState.regiaoToMunKeys.get(reg);
      if (!set) continue;
      for (const key of set) allowed.add(key);
    }
    pool = pool.filter((item) => allowed.has(item.municipioKey));
  }

  const q = (searchEl?.value || "").trim().toLowerCase();
  const selected =
    preferredSelection !== undefined
      ? preferredSelection
      : new Set(Array.from(sel.selectedOptions).map((o) => o.value));

  sel.innerHTML = "";
  for (const item of pool) {
    const match = !q || item.municipio.toLowerCase().includes(q);
    const isSel = selected.has(item.municipioKey);
    if (!match && !isSel) continue;
    const opt = document.createElement("option");
    opt.value = item.municipioKey;
    opt.textContent = item.municipio;
    if (isSel) opt.selected = true;
    sel.appendChild(opt);
  }
}

/** Ao escolher RMF/RMC, lista e seleciona os municípios da região. Sem região → todos os municípios do Vai Vem. */
function vvSyncMunicipiosFromRegiao() {
  if (!vvState.municipiosList.length) return;
  const regSel = vvGetSelectedRegioes();
  /** @type {Set<string>} */
  const keys = new Set();
  if (regSel.length > 0) {
    const valid = new Set(vvState.municipiosList.map((m) => m.municipioKey));
    for (const reg of regSel) {
      const set = vvState.regiaoToMunKeys.get(reg);
      if (!set) continue;
      for (const key of set) {
        if (valid.has(key)) keys.add(key);
      }
    }
  }
  vvRebuildMunicipioOptions(keys);
}

function vvClearMunicipioSelection() {
  const search = document.getElementById("mapFilterMunSearch");
  if (search) search.value = "";
  vvRebuildMunicipioOptions(new Set());
}

/** Seleciona um município ao clicar no mapa (chave normalizada do nome na planilha). */
function vvSelectSingleMunicipioFromMap(municipioKey) {
  const key = vvNormText(municipioKey);
  if (!key) return;
  const exists = vvState.municipiosList.some((m) => m.municipioKey === key);
  if (!exists) return;
  const search = document.getElementById("mapFilterMunSearch");
  if (search) search.value = "";
  vvRebuildMunicipioOptions(new Set([key]));
  vvRefreshKpis();
}

function vvGetSelectedAnos() {
  const sel = document.getElementById("vvFilterAno");
  if (!sel) return [];
  return Array.from(sel.selectedOptions)
    .map((o) => String(o.value || ""))
    .filter(Boolean);
}

function vvGetSelectedMesKeys() {
  const sel = document.getElementById("vvFilterMes");
  if (!sel) return [];
  return Array.from(sel.selectedOptions)
    .map((o) => String(o.value || ""))
    .filter(Boolean);
}

function vvFilterRows(rows, options = {}) {
  const skipTemporal = options.skipTemporal === true;
  const muns = vvGetSelectedMunicipioKeys();
  const regs = vvGetSelectedRegioes();
  const anos = skipTemporal ? [] : vvGetSelectedAnos();
  const mesKeys = skipTemporal ? [] : vvGetSelectedMesKeys();
  return rows.filter((row) => {
    if (muns.length && !muns.includes(row.municipioKey)) return false;
    if (regs.length && !regs.includes(row.regiaoSigla)) return false;
    if (anos.length && !anos.includes(String(row.ano))) return false;
    if (mesKeys.length && !mesKeys.includes(row.mesAnoKey)) return false;
    return true;
  });
}

function vvPopulateAnoFilter() {
  const sel = document.getElementById("vvFilterAno");
  if (!sel) return;
  const prev = new Set(Array.from(sel.selectedOptions).map((o) => o.value));
  const years = [...new Set(vvState.rows.map((r) => r.ano).filter((y) => Number.isFinite(y)))].sort((a, b) => a - b);
  sel.innerHTML = years.map((y) => `<option value="${y}">${y}</option>`).join("");
  for (const opt of sel.options) opt.selected = prev.has(opt.value);
}

function vvRebuildMesFilter() {
  const sel = document.getElementById("vvFilterMes");
  if (!sel) return;
  const prev = new Set(Array.from(sel.selectedOptions).map((o) => o.value));
  const anos = vvGetSelectedAnos();
  const mesSet = new Set();
  for (const row of vvState.rows) {
    if (!row.mesAnoKey) continue;
    if (anos.length && !anos.includes(String(row.ano))) continue;
    mesSet.add(row.mesAnoKey);
  }
  const sorted = [...mesSet].sort((a, b) => vvMesAnoKeyRank(a) - vvMesAnoKeyRank(b));
  sel.innerHTML = sorted.map((k) => `<option value="${k}">${vvMesAnoLabel(k)}</option>`).join("");
  for (const opt of sel.options) opt.selected = prev.has(opt.value);
}

function vvPct(value, total) {
  if (!Number.isFinite(value) || !Number.isFinite(total) || total <= 0) return "—";
  return `${((value / total) * 100).toFixed(1).replace(".", ",")}%`;
}

function vvSetKpiValue(id, value) {
  const el = document.getElementById(id);
  if (!el) return;
  el.textContent = Number.isFinite(value) ? vvFmt.format(value) : "—";
}

function vvSetKpiPct(id, value) {
  const el = document.getElementById(id);
  if (!el) return;
  el.textContent = value || "—";
}

function vvRenderKpis(kpis) {
  const total = kpis.total;
  vvSetKpiValue("vvKpiTotal", kpis.total);
  vvSetKpiPct("vvKpiTotalPct", total > 0 ? "100%" : "—");
  vvSetKpiValue("vvKpiDesempregados", kpis.desempregados);
  vvSetKpiPct("vvKpiDesempregadosPct", vvPct(kpis.desempregados, total));
  vvSetKpiValue("vvKpiVinculoEmprego", kpis.vinculoEmprego);
  vvSetKpiPct("vvKpiVinculoEmpregoPct", vvPct(kpis.vinculoEmprego, total));
  vvSetKpiValue("vvKpiAguardandoImpressao", kpis.aguardandoImpressao);
  vvSetKpiPct("vvKpiAguardandoImpressaoPct", vvPct(kpis.aguardandoImpressao, total));
  vvSetKpiValue("vvKpiCartoesImpressos", kpis.cartoesImpressos);
  vvSetKpiPct("vvKpiCartoesImpressosPct", vvPct(kpis.cartoesImpressos, total));
  vvSetKpiValue("vvKpiCartaoEntregue", kpis.cartaoEntregue);
  vvSetKpiPct("vvKpiCartaoEntreguePct", vvPct(kpis.cartaoEntregue, total));
  vvSetKpiValue("vvKpiSolicitacoesRmf", kpis.solicitacoesRmf);
  vvSetKpiPct("vvKpiSolicitacoesRmfPct", vvPct(kpis.solicitacoesRmf, total));
  vvSetKpiValue("vvKpiSolicitacoesRmc", kpis.solicitacoesRmc);
  vvSetKpiPct("vvKpiSolicitacoesRmcPct", vvPct(kpis.solicitacoesRmc, total));
}

function vvSetStatus(message) {
  const el = document.getElementById("vvKpiStatus");
  if (el) el.textContent = message || "";
}

function vvDestroyChart(key) {
  const chart = vvCharts[key];
  if (!chart) return;
  try {
    chart.destroy();
  } catch (_) {}
  vvCharts[key] = null;
}

function vvDestroyCharts() {
  for (const key of Object.keys(vvCharts)) vvDestroyChart(key);
}

function vvLabelOrStar(raw) {
  const s = String(raw ?? "").trim();
  return s || "*";
}

function vvAggregateCountBy(rows, pickLabel) {
  /** @type {Map<string, number>} */
  const counts = new Map();
  for (const row of rows) {
    const label = vvLabelOrStar(pickLabel(row));
    counts.set(label, (counts.get(label) || 0) + 1);
  }
  return [...counts.entries()]
    .map(([label, value]) => ({ label, value }))
    .sort((a, b) => b.value - a.value || a.label.localeCompare(b.label, "pt-BR"));
}

function vvFormatChartPct(val) {
  return new Intl.NumberFormat("pt-BR", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(Number(val) || 0);
}

function vvPickDonutColors(items, colorMap) {
  return items.map((item, i) => colorMap[item.label] || VV_DONUT_PALETTE[i % VV_DONUT_PALETTE.length]);
}

function vvBaseBarChartConfig(categories, data, color, height) {
  return {
    chart: {
      type: "bar",
      height,
      toolbar: { show: false },
      fontFamily: "system-ui, Segoe UI, sans-serif",
      foreColor: "#1f2d78",
    },
    series: [{ name: "Solicitações", data }],
    colors: [color],
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
      labels: { formatter: (v) => vvFormatChartInt(v), style: { fontSize: "11px" } },
    },
    yaxis: {
      labels: {
        maxWidth: 180,
        style: { fontSize: "11px", colors: "#1f2d78" },
      },
    },
    grid: { borderColor: "#e2e8f0", padding: { left: 8, right: 14, top: 4, bottom: 4 } },
    dataLabels: {
      enabled: true,
      formatter: (v) => vvFormatChartInt(v),
      style: { fontSize: "10px", fontWeight: 600 },
      offsetX: 6,
    },
    tooltip: { y: { formatter: (v) => vvFormatChartInt(v) } },
  };
}

function vvUpdateHorizontalCountChart(key, elId, rows, pickLabel, color = VV_BAR_DETAIL_COLOR) {
  if (typeof ApexCharts === "undefined") return;
  const el = document.getElementById(elId);
  if (!el) return;
  vvDestroyChart(key);
  const items = vvAggregateCountBy(rows, pickLabel);
  const hasData = items.length > 0;
  const categories = hasData ? items.map((i) => i.label) : ["Sem dados no filtro"];
  const data = hasData ? items.map((i) => i.value) : [0];
  const height = Math.max(280, 48 + categories.length * 30);
  const chart = new ApexCharts(el, vvBaseBarChartConfig(categories, data, color, height));
  chart.render();
  vvCharts[key] = chart;
}

function vvUpdateDonutChart(key, elId, rows, pickLabel, colorMap) {
  if (typeof ApexCharts === "undefined") return;
  const el = document.getElementById(elId);
  if (!el) return;
  vvDestroyChart(key);
  const items = vvAggregateCountBy(rows, pickLabel).filter((i) => i.value > 0);
  const hasData = items.length > 0;
  const series = hasData ? items.map((i) => i.value) : [1];
  const labels = hasData ? items.map((i) => i.label) : ["Sem dados no filtro"];
  const total = series.reduce((a, b) => a + b, 0);
  const colors = hasData ? vvPickDonutColors(items, colorMap) : ["#cbd5e1"];
  const chart = new ApexCharts(el, {
    chart: {
      type: "donut",
      height: 380,
      toolbar: { show: false },
      fontFamily: "system-ui, Segoe UI, sans-serif",
      foreColor: "#1f2d78",
    },
    series,
    labels,
    colors,
    legend: {
      position: "top",
      horizontalAlign: "left",
      fontSize: "11px",
      itemMargin: { horizontal: 8, vertical: 2 },
    },
    plotOptions: {
      pie: {
        donut: { size: "58%" },
        dataLabels: { offset: -4 },
      },
    },
    dataLabels: {
      enabled: hasData,
      formatter: (val, opts) => {
        const raw = Number(opts.w.globals.series[opts.seriesIndex]) || 0;
        const pct = total > 0 ? (raw / total) * 100 : 0;
        if (pct < 0.4) return "";
        return `${vvFormatChartInt(raw)} (${vvFormatChartPct(pct)}%)`;
      },
      style: { fontSize: "10px", fontWeight: 600 },
    },
    stroke: { width: 1, colors: ["#fff"] },
    tooltip: {
      y: {
        formatter: (v) => {
          const n = Number(v) || 0;
          const pct = total > 0 ? (n / total) * 100 : 0;
          return `${vvFormatChartInt(n)} (${vvFormatChartPct(pct)}%)`;
        },
      },
    },
  });
  chart.render();
  vvCharts[key] = chart;
}

function vvBuildPeriodLineSeries(rows) {
  /** @type {Map<string, { total: number, desempregados: number, vinculoEmprego: number }>} */
  const byMonth = new Map();
  for (const row of rows) {
    const key = row.mesAnoKey;
    if (!key) continue;
    const cur = byMonth.get(key) || { total: 0, desempregados: 0, vinculoEmprego: 0 };
    cur.total += 1;
    if (vvIsDesempregado(row.situacaoPrograma)) cur.desempregados += 1;
    if (vvIsVinculoEmprego(row.situacaoPrograma)) cur.vinculoEmprego += 1;
    byMonth.set(key, cur);
  }
  const keys = [...byMonth.keys()].sort((a, b) => vvMesAnoKeyRank(a) - vvMesAnoKeyRank(b));
  return {
    categories: keys.map(vvMesAnoLabel),
    series: [
      { name: "Total", data: keys.map((k) => byMonth.get(k).total) },
      { name: "Desempregados", data: keys.map((k) => byMonth.get(k).desempregados) },
      { name: "Vínculo emprego", data: keys.map((k) => byMonth.get(k).vinculoEmprego) },
    ],
    hasData: keys.length > 0,
  };
}

function vvBuildMunicipioBarSeries(rows) {
  const byMun = vvAggregateByMunicipio(rows);
  const items = [...byMun.values()].sort((a, b) => b.total - a.total || a.municipio.localeCompare(b.municipio, "pt-BR"));
  return {
    categories: items.map((i) => i.municipio),
    data: items.map((i) => i.total),
    hasData: items.length > 0,
  };
}

function vvBuildRegiaoBarSeries(rows) {
  const agg = vvComputeKpis(rows);
  const items = [
    { label: "RMF", value: agg.solicitacoesRmf },
    { label: "RMC", value: agg.solicitacoesRmc },
  ];
  return {
    categories: items.map((i) => i.label),
    data: items.map((i) => i.value),
    hasData: items.some((i) => i.value > 0),
  };
}

function vvFormatChartInt(val) {
  return vvFmt.format(Number(val) || 0);
}

function vvUpdateLineChart(rows) {
  if (typeof ApexCharts === "undefined") return;
  const el = document.getElementById("vvChartLinePeriodo");
  if (!el) return;
  vvDestroyChart("line");
  const { categories, series, hasData } = vvBuildPeriodLineSeries(rows);
  const cats = hasData ? categories : ["Sem dados no filtro"];
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
      : [
          { name: "Total", data: [0] },
          { name: "Desempregados", data: [0] },
          { name: "Vínculo emprego", data: [0] },
        ],
    xaxis: {
      categories: cats,
      labels: {
        rotate: hasData && cats.length > 8 ? -35 : 0,
        style: { fontSize: "11px", colors: "#475569" },
      },
      axisBorder: { color: "#cbd5e1" },
      axisTicks: { show: false },
    },
    yaxis: {
      labels: { formatter: (v) => vvFormatChartInt(v), style: { fontSize: "11px", colors: "#475569" } },
      min: 0,
    },
    stroke: { curve: "smooth", width: 3 },
    colors: VV_LINE_COLORS,
    markers: { size: hasData ? 4 : 0, strokeWidth: 2, hover: { size: 6 } },
    legend: { position: "top", horizontalAlign: "right", fontSize: "12px", fontWeight: 600 },
    grid: {
      borderColor: "#e2e8f0",
      strokeDashArray: 4,
      padding: { left: 8, right: 12, top: 10, bottom: 4 },
    },
    tooltip: {
      shared: true,
      intersect: false,
      y: { formatter: (v) => vvFormatChartInt(v) },
    },
    dataLabels: {
      enabled: hasData,
      formatter: (val) => vvFormatChartInt(val),
      style: { fontSize: "10px", fontWeight: 700, colors: ["#1f2d78"] },
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
  chart.render().then(() => {
    for (const name of VV_LINE_HIDDEN_BY_DEFAULT) {
      try {
        chart.hideSeries(name);
      } catch (_) {}
    }
  });
  vvCharts.line = chart;
}

function vvUpdateBarMunicipioChart(rows) {
  if (typeof ApexCharts === "undefined") return;
  const el = document.getElementById("vvChartBarMunicipio");
  if (!el) return;
  vvDestroyChart("barMun");
  const { categories, data, hasData } = vvBuildMunicipioBarSeries(rows);
  const cats = hasData ? categories : ["Sem dados no filtro"];
  const vals = hasData ? data : [0];
  const height = Math.max(360, 56 + cats.length * 28);
  const chart = new ApexCharts(el, {
    chart: {
      type: "bar",
      height,
      toolbar: { show: false },
      fontFamily: "system-ui, Segoe UI, sans-serif",
      foreColor: "#1f2d78",
    },
    series: [{ name: "Solicitações", data: vals }],
    colors: [VV_BAR_MUN_COLOR],
    plotOptions: {
      bar: {
        horizontal: true,
        barHeight: "72%",
        borderRadius: 4,
        borderRadiusApplication: "end",
      },
    },
    xaxis: {
      categories: cats,
      labels: { formatter: (v) => vvFormatChartInt(v), style: { fontSize: "11px" } },
    },
    yaxis: {
      labels: { style: { fontSize: "11px", colors: "#1f2d78" } },
    },
    grid: { borderColor: "#e2e8f0", padding: { left: 8, right: 14 } },
    dataLabels: { enabled: false },
    tooltip: { y: { formatter: (v) => vvFormatChartInt(v) } },
  });
  chart.render();
  vvCharts.barMun = chart;
}

function vvUpdateBarRegiaoChart(rows) {
  if (typeof ApexCharts === "undefined") return;
  const el = document.getElementById("vvChartBarRegiao");
  if (!el) return;
  vvDestroyChart("barReg");
  const { categories, data, hasData } = vvBuildRegiaoBarSeries(rows);
  const cats = hasData ? categories : ["Sem dados"];
  const vals = hasData ? data : [0, 0];
  const chart = new ApexCharts(el, {
    chart: {
      type: "bar",
      height: 320,
      toolbar: { show: false },
      fontFamily: "system-ui, Segoe UI, sans-serif",
      foreColor: "#1f2d78",
    },
    series: [{ name: "Solicitações", data: vals }],
    colors: VV_BAR_REG_COLORS,
    plotOptions: {
      bar: {
        columnWidth: "48%",
        borderRadius: 6,
        borderRadiusApplication: "end",
        distributed: true,
      },
    },
    xaxis: {
      categories: cats,
      labels: { style: { fontSize: "12px", fontWeight: 600 } },
    },
    yaxis: {
      labels: { formatter: (v) => vvFormatChartInt(v), style: { fontSize: "11px" } },
      min: 0,
    },
    legend: { show: false },
    grid: { borderColor: "#e2e8f0", padding: { left: 8, right: 14 } },
    dataLabels: {
      enabled: hasData,
      formatter: (v) => vvFormatChartInt(v),
      style: { fontSize: "11px", fontWeight: 700 },
    },
    tooltip: { y: { formatter: (v) => vvFormatChartInt(v) } },
  });
  chart.render();
  vvCharts.barReg = chart;
}

function vvRefreshCharts() {
  if (!vvIsActivePage() || !vvState.loaded) return;
  const filtered = vvFilterRows(vvState.rows);
  vvUpdateLineChart(filtered);
  vvUpdateBarMunicipioChart(filtered);
  vvUpdateBarRegiaoChart(filtered);
  vvUpdateHorizontalCountChart("barUnidade", "vvChartBarUnidade", filtered, (r) => r.unidadeDesc);
  vvUpdateHorizontalCountChart("barStatusIdt", "vvChartBarStatusIdt", filtered, (r) => r.situacaoIdt);
  vvUpdateDonutChart("donutGenero", "vvChartDonutGenero", filtered, (r) => r.genero, VV_GENERO_COLORS);
  vvUpdateHorizontalCountChart("barRacaCor", "vvChartBarRacaCor", filtered, (r) => r.racaCor);
  vvUpdateDonutChart(
    "donutPapelFamilia",
    "vvChartDonutPapelFamilia",
    filtered,
    (r) => r.papelFamilia,
    VV_PAPEL_COLORS
  );
  vvUpdateHorizontalCountChart("barEscolaridade", "vvChartBarEscolaridade", filtered, (r) => r.escolaridade);
  requestAnimationFrame(() => {
    for (const key of Object.keys(vvCharts)) {
      try {
        vvCharts[key]?.resize?.();
      } catch (_) {}
    }
  });
}

function vvRefreshMap() {
  if (!vvIsActivePage() || !vvState.loaded) return;
  const filtered = vvFilterRows(vvState.rows);
  const aggByMun = vvAggregateByMunicipio(filtered);
  window.ceRegioesMapApi?.applyVaiVemLayer?.(aggByMun);
}

function vvRefreshKpis() {
  if (!vvState.loaded) return;
  const filtered = vvFilterRows(vvState.rows);
  vvRenderKpis(vvComputeKpis(filtered));
  vvRefreshMap();
  vvRefreshCharts();
  const parts = [];
  const anos = vvGetSelectedAnos();
  const meses = vvGetSelectedMesKeys();
  const muns = vvGetSelectedMunicipioKeys();
  const regs = vvGetSelectedRegioes();
  if (anos.length) parts.push(`${anos.length} ano(s)`);
  if (meses.length) parts.push(`${meses.length} mês(es)`);
  if (muns.length) parts.push(`${muns.length} município(s)`);
  if (regs.length) parts.push(`${regs.length} região(ões)`);
  const filterTxt = parts.length ? ` · filtros: ${parts.join(", ")}` : "";
  vvSetStatus(
    `${vvFmt.format(filtered.length)} solicitações no recorte${filterTxt} · percentuais em relação ao total`
  );
}

async function vvEnsureData() {
  if (vvState.loaded || vvState.loading) return;
  vvState.loading = true;
  vvSetStatus("Carregando planilha Vai Vem…");
  vvRenderKpis({
    total: NaN,
    desempregados: NaN,
    vinculoEmprego: NaN,
    aguardandoImpressao: NaN,
    cartoesImpressos: NaN,
    cartaoEntregue: NaN,
    solicitacoesRmf: NaN,
    solicitacoesRmc: NaN,
  });
  [
    "vvKpiTotalPct",
    "vvKpiDesempregadosPct",
    "vvKpiVinculoEmpregoPct",
    "vvKpiAguardandoImpressaoPct",
    "vvKpiCartoesImpressosPct",
    "vvKpiCartaoEntreguePct",
    "vvKpiSolicitacoesRmfPct",
    "vvKpiSolicitacoesRmcPct",
  ].forEach((id) => vvSetKpiPct(id, "—"));

  try {
    const res = await fetch(VAI_VEM_CSV_URL, { cache: "no-store" });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const text = await res.text();
    vvState.rows = vvParseCsvRows(text);
    vvState.loaded = true;
    vvState.error = null;
    vvBuildMunicipiosIndex();
    vvPopulateAnoFilter();
    vvRebuildMesFilter();
    vvSyncMunicipiosFromRegiao();
    vvRefreshKpis();
  } catch (err) {
    vvState.error = err;
    vvSetStatus("Não foi possível carregar os dados do Vai Vem.");
    console.error("[vai-vem]", err);
  } finally {
    vvState.loading = false;
  }
}

function vvIsActivePage() {
  return document.getElementById("secaoMapaCe")?.classList.contains("section-map-ce--vai-vem") === true;
}

function vvOnPageActivate() {
  if (!vvIsActivePage()) return;
  void vvEnsureData().then(() => {
    if (vvState.loaded) vvSyncMunicipiosFromRegiao();
    vvRefreshKpis();
    requestAnimationFrame(() => vvRefreshCharts());
  });
}

function vvRestoreFullMunicipioFilter() {
  if (typeof window.ceRegioesMapApi?.rebuildAllMunicipios === "function") {
    window.ceRegioesMapApi.rebuildAllMunicipios();
  }
}

function vvBindFilters() {
  const root = document.getElementById("secaoMapaCe");
  if (!root || root.dataset.vvBound === "1") return;
  root.dataset.vvBound = "1";

  root.addEventListener("change", (e) => {
    if (!vvIsActivePage()) return;
    const id = e.target?.id;
    if (id === "vvFilterAno") {
      vvRebuildMesFilter();
      vvRefreshKpis();
    }
    if (id === "vvFilterMes") vvRefreshKpis();
  });

  root.addEventListener("click", (e) => {
    if (!vvIsActivePage() || !(e.target instanceof HTMLElement)) return;
    if (e.target.id === "vvFilterAnoClear") {
      const sel = document.getElementById("vvFilterAno");
      if (sel) Array.from(sel.options).forEach((o) => { o.selected = false; });
      vvRebuildMesFilter();
      vvRefreshKpis();
    }
    if (e.target.id === "vvFilterMesClear") {
      const sel = document.getElementById("vvFilterMes");
      if (sel) Array.from(sel.options).forEach((o) => { o.selected = false; });
      vvRefreshKpis();
    }
  });

  root.addEventListener("input", (e) => {
    if (!vvIsActivePage() || e.target.id !== "mapFilterMunSearch") return;
    clearTimeout(vvMunSearchTimer);
    vvMunSearchTimer = setTimeout(() => vvRebuildMunicipioOptions(), 160);
  });
}

function vvInit() {
  vvBindFilters();
  if (vvIsActivePage()) vvOnPageActivate();
}

window.vaiVemApi = {
  onPageActivate: vvOnPageActivate,
  refresh: vvRefreshKpis,
  refreshMap: vvRefreshMap,
  refreshCharts: vvRefreshCharts,
  syncMunicipiosFromRegiao: vvSyncMunicipiosFromRegiao,
  clearMunicipioSelection: vvClearMunicipioSelection,
  selectSingleMunicipioFromMap: vvSelectSingleMunicipioFromMap,
  rebuildMunicipioOptions: vvRebuildMunicipioOptions,
  restoreFullMunicipioFilter: vvRestoreFullMunicipioFilter,
};

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", vvInit);
} else {
  vvInit();
}
