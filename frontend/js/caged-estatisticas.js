const CE_ESTATS_COLORS = {
  adm: "#15803d",
  dem: "#c2410c",
  saldo: "#2563eb",
  homem: "#2563eb",
  mulher: "#db2777",
  ref: "#94a3b8",
  palette: ["#2563eb", "#ea580c", "#7c3aed", "#0d9488", "#db2777", "#ca8a04", "#0f766e", "#9333ea"],
};

const ceEstatsCharts = {};
const ceEstatsState = {
  loading: false,
  data: null,
  error: null,
};

const ceEstatsFmtInt = new Intl.NumberFormat("pt-BR", { maximumFractionDigits: 0 });
const ceEstatsFmtDec = new Intl.NumberFormat("pt-BR", { maximumFractionDigits: 1 });
const ceEstatsFmtCur = new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL", maximumFractionDigits: 0 });

function ceEstatsIsActive() {
  return document.getElementById("secaoMapaCe")?.classList.contains("section-map-ce--caged-estatisticas") === true;
}

function ceEstatsFmt(val, kind) {
  const n = Number(val);
  if (!Number.isFinite(n)) return "—";
  if (kind === "pct") return `${ceEstatsFmtDec.format(n)}%`;
  if (kind === "cur") return ceEstatsFmtCur.format(n);
  return ceEstatsFmtInt.format(n);
}

function ceEstatsSelectedValues(id) {
  const el = document.getElementById(id);
  return Array.from(el?.selectedOptions || []).map((o) => o.value).filter(Boolean);
}

function ceEstatsMunicipiosFromFilters() {
  const munSel = ceEstatsSelectedValues("mapFilterMunicipio");
  if (munSel.length) return munSel;
  const regSel = ceEstatsSelectedValues("mapFilterRegiao");
  if (!regSel.length) return [];
  const mapReg = window.ceRegioesMapApi?.getRegiaoToCodigos?.();
  if (!mapReg) return [];
  const codes = new Set();
  for (const reg of regSel) {
    const set = mapReg.get?.(reg);
    if (!set) continue;
    for (const c of set) codes.add(String(c));
  }
  return [...codes];
}

function ceEstatsQuery() {
  const anos = ceEstatsSelectedValues("mapFilterAno");
  const meses = ceEstatsSelectedValues("mapFilterMes").map((k) => k.replace("-", ""));
  const municipios = ceEstatsMunicipiosFromFilters();
  const regioes = ceEstatsSelectedValues("mapFilterRegiao");
  const grupamentos = ceEstatsSelectedValues("mapFilterEstatsGrup");
  const q = new URLSearchParams();
  if (anos.length) q.set("anos", anos.join(","));
  if (meses.length) q.set("competencias", meses.join(","));
  if (municipios.length) q.set("municipios", municipios.join(","));
  if (regioes.length) q.set("regioes", regioes.join(","));
  if (grupamentos.length) q.set("grupamentos", grupamentos.join(","));
  return q.toString();
}

function ceEstatsDestroy(key) {
  const chart = ceEstatsCharts[key];
  if (!chart) return;
  try {
    chart.destroy();
  } catch (_) {}
  ceEstatsCharts[key] = null;
}

function ceEstatsBaseChart(el, options) {
  if (!el || typeof ApexCharts === "undefined") return null;
  const key = el.id;
  ceEstatsDestroy(key);
  const chart = new ApexCharts(el, {
    chart: {
      toolbar: { show: false },
      zoom: { enabled: false },
      fontFamily: "system-ui, Segoe UI, sans-serif",
      foreColor: "#1f2d78",
      animations: { speed: 280 },
      ...options.chart,
    },
    colors: options.colors || CE_ESTATS_COLORS.palette,
    grid: {
      borderColor: "#e2e8f0",
      strokeDashArray: 4,
      padding: { left: 8, right: 12, top: 8, bottom: 4 },
    },
    legend: {
      position: "top",
      horizontalAlign: "left",
      fontSize: "12px",
      fontWeight: 600,
    },
    dataLabels: { enabled: false },
    tooltip: { shared: true, intersect: false },
    noData: { text: "Sem dados no filtro" },
    ...options,
  });
  chart.render();
  ceEstatsCharts[key] = chart;
  return chart;
}

function ceEstatsLine(el, series, categories, extra = {}) {
  const has = categories.length && series.some((s) => (s.data || []).some((v) => v != null && Number(v) !== 0));
  ceEstatsBaseChart(el, {
    chart: { type: "line", height: extra.height || 340 },
    series: has ? series : [{ name: "Sem dados", data: [0] }],
    colors: extra.colors || series.map((_, i) => CE_ESTATS_COLORS.palette[i % CE_ESTATS_COLORS.palette.length]),
    xaxis: {
      categories: has ? categories : ["Sem dados"],
      labels: { rotate: categories.length > 8 ? -35 : 0, style: { fontSize: "11px" } },
    },
    yaxis: {
      labels: {
        formatter: (v) => extra.yaxisFmt ? extra.yaxisFmt(v) : ceEstatsFmt(v, extra.format),
      },
    },
    stroke: { curve: "smooth", width: extra.dash ? series.map((s) => (s._dash ? 2 : 3)) : 3, dashArray: extra.dash ? series.map((s) => (s._dash ? 6 : 0)) : 0 },
    markers: { size: 3, strokeWidth: 2, hover: { size: 5 } },
    tooltip: {
      y: { formatter: (v) => extra.yaxisFmt ? extra.yaxisFmt(v) : ceEstatsFmt(v, extra.format) },
    },
  });
}

function ceEstatsBarH(el, items, extra = {}) {
  const rows = (items || []).filter((i) => Number.isFinite(Number(i.valor)));
  const cats = rows.map((r) => r.label);
  const data = rows.map((r) => Number(r.valor));
  ceEstatsBaseChart(el, {
    chart: { type: "bar", height: extra.height || Math.max(280, 56 + Math.max(cats.length, 1) * 28) },
    series: [{ name: extra.name || "Valor", data: data.length ? data : [0] }],
    colors: [extra.color || CE_ESTATS_COLORS.saldo],
    plotOptions: { bar: { horizontal: true, barHeight: "72%", borderRadius: 4, borderRadiusApplication: "end" } },
    xaxis: {
      categories: cats.length ? cats : ["Sem dados"],
      labels: { formatter: (v) => ceEstatsFmt(v, extra.format) },
    },
    tooltip: { y: { formatter: (v) => ceEstatsFmt(v, extra.format) } },
  });
}

function ceEstatsDonut(el, items, extra = {}) {
  const rows = (items || []).filter((i) => Number.isFinite(Number(i.valor)) && Number(i.valor) !== 0);
  ceEstatsBaseChart(el, {
    chart: { type: "donut", height: extra.height || 300 },
    series: rows.length ? rows.map((r) => Math.abs(Number(r.valor))) : [1],
    labels: rows.length ? rows.map((r) => r.label) : ["Sem dados"],
    colors: extra.colors || [CE_ESTATS_COLORS.homem, CE_ESTATS_COLORS.mulher, "#64748b"],
    plotOptions: { pie: { donut: { size: "62%" } } },
    legend: { position: "bottom" },
    tooltip: { y: { formatter: (v) => ceEstatsFmt(v) } },
  });
}

function ceEstatsGroupedBar(el, block, extra = {}) {
  const labels = block?.labels || [];
  const series = (block?.series || []).map((s) => ({ name: s.label, data: s.valores.map((v) => (v == null ? 0 : Number(v))) }));
  ceEstatsBaseChart(el, {
    chart: { type: "bar", height: extra.height || 360 },
    series: series.length ? series : [{ name: "Sem dados", data: [0] }],
    colors: extra.colors || [CE_ESTATS_COLORS.homem, CE_ESTATS_COLORS.mulher],
    plotOptions: { bar: { horizontal: extra.horizontal !== false, borderRadius: 3 } },
    xaxis: { categories: labels.length ? labels : ["Sem dados"] },
    tooltip: { y: { formatter: (v) => ceEstatsFmt(v) } },
  });
}

function ceEstatsSetKpi(id, value, kind, subId, subText) {
  const el = document.getElementById(id);
  const neg = Number(value) < 0;
  if (el) {
    el.textContent = ceEstatsFmt(value, kind);
    el.classList.toggle("is-neg", neg);
    el.closest(".map-ce-kpi-card")?.classList.toggle("is-neg", neg);
  }
  const sub = subId ? document.getElementById(subId) : null;
  if (sub) sub.textContent = subText || "";
}

function ceEstatsRenderKpis(d) {
  const p = d?.periodo || {};
  const base = d?.estoque_base || {};
  const oficial = base.oficial !== false;
  ceEstatsSetKpi("estatsKpiAdm", p.admissoes);
  ceEstatsSetKpi("estatsKpiDem", p.desligamentos);
  ceEstatsSetKpi("estatsKpiVarAbs", p.variacao_absoluta);
  ceEstatsSetKpi("estatsKpiVarRel", p.variacao_relativa, "pct");
  const acum = Number.isFinite(Number(p.indice_emprego_encadeado)) ? Number(p.indice_emprego_encadeado) - 100 : NaN;
  ceEstatsSetKpi(
    "estatsKpiIndice",
    acum,
    "pct",
    "estatsKpiIndiceSub",
    oficial ? "desde 12/2025" : "série da base"
  );
  ceEstatsSetKpi("estatsKpiTR", p.taxa_rotatividade, "pct");
  ceEstatsSetKpi(
    "estatsKpiEstoqueFim",
    p.estoque_fim,
    "int",
    "estatsKpiEstoqueFimSub",
    Number.isFinite(Number(p.estoque_inicio)) ? `Início ${ceEstatsFmt(p.estoque_inicio)}` : "—"
  );
  ceEstatsSetKpi(
    "estatsKpiEstoqueBase",
    base.valor,
    "int",
    "estatsKpiEstoqueBaseSub",
    oficial ? "CE · 12/2025" : "série da base"
  );
  ceEstatsSetKpi("estatsKpiSalario", p.salario_medio, "cur");
  const note = document.getElementById("estatsKpiNote");
  if (note) {
    note.hidden = !base.aviso;
    note.textContent = base.aviso || "";
  }
}

function ceEstatsLabelsFromPairs(pairs) {
  return (pairs || []).map((p) => p.label);
}

function ceEstatsValuesFromPairs(pairs) {
  return (pairs || []).map((p) => (p.valor == null ? null : Number(p.valor)));
}

function ceEstatsBuildRegiaoRanking(munItems) {
  const mapReg = window.ceRegioesMapApi?.getRegiaoToCodigos?.();
  if (!mapReg || !munItems?.length) return [];
  const nomeToCod = new Map();
  const list = [];
  try {
    const munEl = document.getElementById("mapFilterMunicipio");
    for (const opt of munEl?.options || []) nomeToCod.set(opt.textContent.trim(), String(opt.value));
  } catch (_) {}
  const byReg = new Map();
  for (const item of munItems) {
    const cod = nomeToCod.get(item.label);
    if (!cod) continue;
    for (const [reg, set] of mapReg.entries()) {
      if (set.has(Number(cod)) || set.has(String(cod))) {
        byReg.set(reg, (byReg.get(reg) || 0) + Number(item.valor || 0));
        break;
      }
    }
  }
  for (const [label, valor] of byReg.entries()) list.push({ label, valor });
  list.sort((a, b) => Math.abs(b.valor) - Math.abs(a.valor));
  return list;
}

function ceEstatsSegMode(name) {
  return document.querySelector(`#${name} button.active`)?.dataset.modo
    || document.getElementById(name)?.value
    || "contratacoes";
}

function ceEstatsRenderCharts(d) {
  if (!d) return;
  const labels = ceEstatsLabelsFromPairs(d.flutuacao_admissoes);
  ceEstatsLine(
    document.getElementById("chartEstatsFlut"),
    [
      { name: "Admissões", data: ceEstatsValuesFromPairs(d.flutuacao_admissoes) },
      { name: "Desligamentos", data: ceEstatsValuesFromPairs(d.flutuacao_desligamentos) },
    ],
    labels,
    { colors: [CE_ESTATS_COLORS.adm, CE_ESTATS_COLORS.dem], height: 380 }
  );

  ceEstatsLine(
    document.getElementById("chartEstatsVarAbs"),
    [{ name: "Variação absoluta", data: ceEstatsValuesFromPairs(d.variacao_absoluta_mes) }],
    ceEstatsLabelsFromPairs(d.variacao_absoluta_mes),
    { colors: [CE_ESTATS_COLORS.saldo] }
  );

  const ref = d.referencia_estado;
  const varRelSeries = [{ name: "Variação relativa", data: ceEstatsValuesFromPairs(d.variacao_relativa_mes) }];
  if (ref?.variacao_relativa_mes) {
    varRelSeries.push({ name: "Ceará (ref.)", data: ceEstatsValuesFromPairs(ref.variacao_relativa_mes), _dash: true });
  }
  ceEstatsLine(document.getElementById("chartEstatsVarRel"), varRelSeries, ceEstatsLabelsFromPairs(d.variacao_relativa_mes), {
    format: "pct",
    colors: [CE_ESTATS_COLORS.saldo, CE_ESTATS_COLORS.ref],
    dash: Boolean(ref),
    yaxisFmt: (v) => ceEstatsFmt(v, "pct"),
  });

  const oficial = d.estoque_base?.oficial !== false;
  const indSeries = [{
    name: oficial ? "% acumulada desde 12/2025" : "% acumulada na série da base",
    data: ceEstatsValuesFromPairs(d.indice_emprego_encadeado),
  }];
  if (ref?.indice_emprego_encadeado) {
    indSeries.push({ name: "Ceará (ref.)", data: ceEstatsValuesFromPairs(ref.indice_emprego_encadeado), _dash: true });
  }
  ceEstatsLine(document.getElementById("chartEstatsIndiceEnc"), indSeries, ceEstatsLabelsFromPairs(d.indice_emprego_encadeado), {
    format: "pct",
    colors: [CE_ESTATS_COLORS.adm, CE_ESTATS_COLORS.ref],
    dash: Boolean(ref),
    yaxisFmt: (v) => ceEstatsFmt(v, "pct"),
    height: 360,
  });

  const trSeries = [{ name: "Taxa de rotatividade", data: ceEstatsValuesFromPairs(d.taxa_rotatividade_mes) }];
  if (ref?.taxa_rotatividade_mes) {
    trSeries.push({ name: "Ceará (ref.)", data: ceEstatsValuesFromPairs(ref.taxa_rotatividade_mes), _dash: true });
  }
  ceEstatsLine(document.getElementById("chartEstatsTR"), trSeries, ceEstatsLabelsFromPairs(d.taxa_rotatividade_mes), {
    format: "pct",
    colors: ["#7c3aed", CE_ESTATS_COLORS.ref],
    dash: Boolean(ref),
    yaxisFmt: (v) => ceEstatsFmt(v, "pct"),
    height: 360,
  });

  ceEstatsRenderSalario();
  ceEstatsBarH(document.getElementById("chartEstatsPermanFaixa"), d.permanencia?.faixas_desligados, { color: "#c2410c", height: 360 });
  const perm = d.permanencia?.serie_mensal;
  ceEstatsLine(
    document.getElementById("chartEstatsPermanSerie"),
    (perm?.series || []).map((s) => ({ name: s.label, data: s.valores })),
    perm?.labels || [],
    { height: 340 }
  );
  ceEstatsBarH(document.getElementById("chartEstatsAdmTipo"), d.admissoes_por_tipo, { color: CE_ESTATS_COLORS.adm, height: 400 });
  ceEstatsBarH(document.getElementById("chartEstatsDemTipo"), d.desligamentos_por_tipo, { color: CE_ESTATS_COLORS.dem, height: 400 });
  const top4 = d.desligamentos_top4_mensal;
  ceEstatsLine(
    document.getElementById("chartEstatsDemTop4"),
    (top4?.series || []).map((s) => ({ name: s.label, data: s.valores })),
    top4?.labels || [],
    { height: 380 }
  );

  const demo = d.perfil_demografico || {};
  ceEstatsDonut(document.getElementById("chartEstatsAdmSexo"), demo.admissoes_sexo, { colors: [CE_ESTATS_COLORS.homem, CE_ESTATS_COLORS.mulher] });
  ceEstatsDonut(document.getElementById("chartEstatsDemSexo"), demo.desligamentos_sexo, { colors: [CE_ESTATS_COLORS.homem, CE_ESTATS_COLORS.mulher] });
  ceEstatsBarH(document.getElementById("chartEstatsSaldoSexo"), demo.saldo_sexo, { color: CE_ESTATS_COLORS.saldo, height: 280 });
  ceEstatsBarH(document.getElementById("chartEstatsAdmFaixa"), demo.admissoes_faixa, { color: CE_ESTATS_COLORS.adm, height: 340 });
  ceEstatsBarH(document.getElementById("chartEstatsDemFaixa"), demo.desligamentos_faixa, { color: CE_ESTATS_COLORS.dem, height: 340 });
  ceEstatsGroupedBar(document.getElementById("chartEstatsAdmSexoFaixa"), demo.admissoes_sexo_faixa, { height: 380 });
  ceEstatsGroupedBar(document.getElementById("chartEstatsDemSexoFaixa"), demo.desligamentos_sexo_faixa, { height: 380 });

  ceEstatsRenderCbo();
  ceEstatsRenderMun();
  ceEstatsRenderRegiao();
  ceEstatsRenderTri("chartEstatsSecao", d.setores, "secao", "segEstatsSecao");
  ceEstatsRenderTri("chartEstatsAgreg", d.setores, "agregacao", "segEstatsAgreg");
  ceEstatsRenderTri("chartEstatsEsc", d.escolaridade, "", "segEstatsEsc");
  ceEstatsRenderTri("chartEstatsRaca", d.raca_cor, "", "segEstatsRaca");
}

function ceEstatsKeyForModo(prefix, modo) {
  if (prefix === "secao") {
    if (modo === "desligamentos") return "desligamentos_secao";
    if (modo === "saldo") return "saldo_secao";
    return "contratacoes_secao";
  }
  if (prefix === "agregacao") {
    if (modo === "desligamentos") return "desligamentos_agregacao";
    if (modo === "saldo") return "saldo_agregacao";
    return "contratacoes_agregacao";
  }
  if (modo === "desligamentos") return "desligamentos";
  if (modo === "saldo") return "saldo";
  return "contratacoes";
}

function ceEstatsRenderTri(chartId, bag, prefix, segId) {
  const modo = ceEstatsSegMode(segId);
  const key = ceEstatsKeyForModo(prefix, modo);
  const color = modo === "desligamentos" ? CE_ESTATS_COLORS.dem : modo === "saldo" ? CE_ESTATS_COLORS.saldo : CE_ESTATS_COLORS.adm;
  ceEstatsBarH(document.getElementById(chartId), bag?.[key] || [], { color, height: 420 });
}

function ceEstatsRenderSalario() {
  const d = ceEstatsState.data;
  if (!d) return;
  const modo = ceEstatsSegMode("segEstatsSalario");
  const block = d.salario_medio || {};
  const seriesSrc = modo === "agregacao" ? block.agregacao?.series : block.series;
  const labels = modo === "agregacao" ? block.agregacao?.labels || block.labels : block.labels;
  const title = document.getElementById("titleEstatsSalario");
  if (title) title.textContent = modo === "agregacao" ? "Salário médio de admissão por grupamento" : "Salário médio de admissão";
  ceEstatsLine(
    document.getElementById("chartEstatsSalario"),
    (seriesSrc || []).map((s) => ({ name: s.label, data: s.valores })),
    labels || [],
    { format: "cur", yaxisFmt: (v) => ceEstatsFmt(v, "cur"), height: 380 }
  );
}

function ceEstatsRenderCbo() {
  const d = ceEstatsState.data;
  if (!d) return;
  const modo = ceEstatsSegMode("segEstatsCbo");
  const title = document.getElementById("titleEstatsCbo");
  const labels = { contratacoes: "Contratações", desligamentos: "Desligamentos", saldo: "Saldo" };
  if (title) title.textContent = `Ocupações (CBO) com mais ${labels[modo] || modo}`;
  const color = modo === "desligamentos" ? CE_ESTATS_COLORS.dem : modo === "saldo" ? CE_ESTATS_COLORS.saldo : CE_ESTATS_COLORS.adm;
  ceEstatsBarH(document.getElementById("chartEstatsCbo"), d.rankings?.[modo] || [], { color, height: 480 });
}

function ceEstatsRankMetric() {
  return document.getElementById("selEstatsRankMetric")?.value || "admissoes";
}

function ceEstatsRankOrder() {
  return document.querySelector("#segEstatsRankOrder button.active")?.dataset.ordem || "desc";
}

function ceEstatsTakeRank(items, { top = 15, order = "desc" } = {}) {
  const rows = (items || [])
    .filter((i) => Number.isFinite(Number(i.valor)))
    .map((i) => ({ label: i.label, valor: Number(i.valor) }));
  rows.sort((a, b) => (order === "asc" ? a.valor - b.valor : b.valor - a.valor));
  return rows.slice(0, top).reverse();
}

function ceEstatsRankMeta() {
  const map = {
    admissoes: ["admissoes_municipio", "Admissões", CE_ESTATS_COLORS.adm],
    demissoes: ["demissoes_municipio", "Desligamentos", CE_ESTATS_COLORS.dem],
    saldo: ["saldo_municipio", "Saldo", CE_ESTATS_COLORS.saldo],
  };
  return map[ceEstatsRankMetric()] || map.admissoes;
}

function ceEstatsRenderMun() {
  const d = ceEstatsState.data;
  if (!d) return;
  const [key, label, color] = ceEstatsRankMeta();
  const order = ceEstatsRankOrder();
  const title = document.getElementById("titleEstatsMunSaldo");
  if (title) title.textContent = `15 municípios · ${label}`;
  ceEstatsBarH(
    document.getElementById("chartEstatsMunSaldo"),
    ceEstatsTakeRank(d.rankings?.[key] || [], { top: 15, order }),
    { color, height: 480 }
  );
}

function ceEstatsRenderRegiao() {
  const d = ceEstatsState.data;
  if (!d) return;
  const [key, label, color] = ceEstatsRankMeta();
  const order = ceEstatsRankOrder();
  const title = document.getElementById("titleEstatsRegiao");
  if (title) title.textContent = `Regiões · ${label}`;
  const all = ceEstatsBuildRegiaoRanking(d.rankings?.[key] || []);
  ceEstatsBarH(
    document.getElementById("chartEstatsRegiao"),
    ceEstatsTakeRank(all, { top: all.length || 15, order }),
    { color, height: 480 }
  );
}

function ceEstatsSetStatus(text, isError) {
  const el = document.getElementById("dashEstatsStatus");
  if (!el) return;
  el.textContent = text || "";
  el.classList.toggle("is-error", Boolean(isError));
}

function ceEstatsSetProgress(show, pct, etapa) {
  const box = document.getElementById("progressEstats");
  if (!box) return;
  box.classList.toggle("show", Boolean(show));
  const fill = document.getElementById("progressEstatsFill");
  const pctEl = document.getElementById("progressEstatsPct");
  const etapaEl = document.getElementById("progressEstatsEtapa");
  if (fill) fill.style.width = `${Math.max(0, Math.min(100, pct || 0))}%`;
  if (pctEl) pctEl.textContent = `${Math.round(pct || 0)}%`;
  if (etapaEl) etapaEl.textContent = etapa || "";
}

async function ceEstatsLoad() {
  if (!ceEstatsIsActive()) return;
  ceEstatsState.loading = true;
  ceEstatsSetProgress(true, 18, "Consultando microdados CAGED…");
  ceEstatsSetStatus("Atualizando estatísticas…");
  try {
    const qs = ceEstatsQuery();
    const res = await fetch(`/api/caged/estatisticas${qs ? `?${qs}` : ""}`, { cache: "no-store" });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    ceEstatsSetProgress(true, 72, "Montando indicadores…");
    const data = await res.json();
    ceEstatsState.data = data;
    ceEstatsState.error = null;
    window.__estatsSalario = data.salario_medio;
    window.__estatsRefEstado = data.referencia_estado;
    window.__estatsRankingsCbo = data.rankings;
    window.__estatsSetores = data.setores;
    window.__estatsEsc = data.escolaridade;
    window.__estatsRaca = data.raca_cor;
    ceEstatsRenderKpis(data);
    ceEstatsRenderCharts(data);
    const per = data.periodo?.label || "—";
    ceEstatsSetStatus(`${ceEstatsFmt(data.total_linhas)} registros · ${data.unidade} · ${per}`);
    ceEstatsSetProgress(true, 100, "Concluído");
  } catch (err) {
    ceEstatsState.error = err;
    ceEstatsSetStatus("Não foi possível carregar as estatísticas CAGED.", true);
    console.error("[caged-estatisticas]", err);
  } finally {
    ceEstatsState.loading = false;
    setTimeout(() => ceEstatsSetProgress(false, 0, ""), 400);
  }
}

function ceEstatsOnPageActivate() {
  if (!ceEstatsIsActive()) return;
  void ceEstatsLoad();
}

function ceEstatsBind() {
  const root = document.getElementById("secaoMapaCe");
  if (!root || root.dataset.estatsBound === "1") return;
  root.dataset.estatsBound = "1";

  root.addEventListener("click", (e) => {
    const btn = e.target.closest?.(".map-ce-estats-seg button");
    if (!btn || !ceEstatsIsActive()) return;
    const wrap = btn.parentElement;
    wrap.querySelectorAll("button").forEach((b) => b.classList.toggle("active", b === btn));
    const id = wrap.id;
    if (id === "segEstatsSalario") ceEstatsRenderSalario();
    else if (id === "segEstatsCbo") ceEstatsRenderCbo();
    else if (id === "segEstatsSecao") ceEstatsRenderTri("chartEstatsSecao", ceEstatsState.data?.setores, "secao", "segEstatsSecao");
    else if (id === "segEstatsAgreg") ceEstatsRenderTri("chartEstatsAgreg", ceEstatsState.data?.setores, "agregacao", "segEstatsAgreg");
    else if (id === "segEstatsEsc") ceEstatsRenderTri("chartEstatsEsc", ceEstatsState.data?.escolaridade, "", "segEstatsEsc");
    else if (id === "segEstatsRaca") ceEstatsRenderTri("chartEstatsRaca", ceEstatsState.data?.raca_cor, "", "segEstatsRaca");
    else if (id === "segEstatsRankOrder") {
      ceEstatsRenderMun();
      ceEstatsRenderRegiao();
    }
  });

  root.addEventListener("change", (e) => {
    if (!ceEstatsIsActive()) return;
    const id = e.target?.id;
    if (id === "selEstatsRankMetric") {
      ceEstatsRenderMun();
      ceEstatsRenderRegiao();
    }
  });
}

ceEstatsBind();

window.cagedEstatisticasApi = {
  onPageActivate: ceEstatsOnPageActivate,
  refresh: ceEstatsLoad,
};
