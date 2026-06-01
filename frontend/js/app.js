const API_ABAS = "/api/abas";
const MENU_META = {
  indicadores: { label: "Página Inicial", icon: "fa-solid fa-house" },
  series_historicas: { label: "Intermediação", icon: "fa-solid fa-chart-line" },
  programas: { label: "Programas", icon: "fa-solid fa-address-card" },
  projecoes: { label: "Projeções", icon: "fa-solid fa-arrow-trend-up" },
  autonomo_detalhado: { label: "Autônomos", icon: "fa-solid fa-briefcase" },
  autonomo_perfil: { label: "Perfil", icon: "fa-solid fa-user-check" },
  autonomo_indicadores: { label: "Indicadores", icon: "fa-solid fa-gauge-high" },
  capacitacao_detalhada: { label: "Capacitação", icon: "fa-solid fa-graduation-cap" },
  analises: { label: "Análises", icon: "fa-solid fa-magnifying-glass-chart" },
  mapa_regioes: { label: "Dados CAGED", icon: "fa-solid fa-map-location-dot" },
  perfil_municipal: { label: "Perfil Municipal", icon: "fa-solid fa-city" },
  texto_apoio: { label: "Texto de Apoio", icon: "fa-solid fa-file-lines" },
  config: { label: "Configuração", icon: "fa-solid fa-gear" }
};
const HIDDEN_MENU_ITEMS = new Set(["texto_apoio", "config", "perfil_social"]);
/** Abas que aparecem apenas dentro do grupo do pai (ex.: Análises sob Página Inicial). */
const NESTED_MENU_ITEMS = new Set(["analises", "mapa_regioes", "perfil_municipal", "autonomo_perfil", "autonomo_indicadores"]);
/** Pai → filhos aninhados na ordem de exibição (filhos precisam existir em state.abas). */
const MENU_GROUP_CHILDREN = {
  indicadores: ["analises", "mapa_regioes", "perfil_municipal"],
  autonomo_detalhado: ["autonomo_perfil", "autonomo_indicadores"]
};
const GROUP_BY_SHEET = {
  programas: "programa",
  autonomo_detalhado: "ano",
  autonomo_perfil: "categoria",
  autonomo_indicadores: "indicador",
  capacitacao_detalhada: "programa",
  series_historicas: "indicador",
  projecoes: "indicador",
  indicadores: "categoria",
  analises: "categoria",
  mapa_regioes: "categoria",
  perfil_municipal: "categoria",
  texto_apoio: "categoria",
  config: "chave"
};

const VIRTUAL_SHEETS = ["perfil_municipal"];

/** Linhas da aba indicadores ocultadas do ranking geral (mantidas só na base). */
const HOME_KPI_OCULTOS = new Set(["servicos", "industria", "comercio"]);

/** KPIs prioritários da página inicial (texto da planilha sem acentos após normalize). */
const HOME_KPI_DESTAQUE_DEF = [
  {
    fallbackLabel: "Taxa desemprego Ceará",
    test(n) {
      return n.includes("desempreg") && n.includes("ceara") && !n.includes("brasil");
    },
    icon: "fa-solid fa-location-dot",
    cardClass: "card--home-feat-ceara"
  },
  {
    fallbackLabel: "Taxa desemprego Brasil",
    test(n) {
      return n.includes("desempreg") && n.includes("brasil");
    },
    icon: "fa-solid fa-earth-americas",
    cardClass: "card--home-feat-brasil"
  }
];

const state = {
  abas: [],
  abaAtual: "",
  dadosAba: [],
  dadosFiltrados: [],
  /** Linhas da aba perfil_social (carga auxiliar ao visitar Programas para KPIs por tema). */
  dadosPerfilParaProgramas: [],
  programaSelecionado: "",
  /** Página inicial: { ano, mes } ou null para usar o período mais recente da base. */
  homeReferencia: null,
  charts: { grafico1: null, grafico2: null, seriesKpiBar1: null, seriesKpiBar2: null }
};

const els = {
  menuAbas: document.getElementById("menuAbas"),
  tituloPagina: document.getElementById("tituloPagina"),
  descricaoPagina: document.getElementById("descricaoPagina"),
  statusPagina: document.getElementById("statusPagina"),
  labelKpis: document.getElementById("labelKpis"),
  sectionKpisHeader: document.getElementById("sectionKpisHeader"),
  secaoMapaCe: document.getElementById("secaoMapaCe"),
  mapCeRegioes: document.getElementById("mapCeRegioes"),
  mapCeLegend: document.getElementById("mapCeLegend"),
  kpis: document.getElementById("kpis"),
  labelGraficos: document.getElementById("labelGraficos"),
  painelGraficos: document.getElementById("painelGraficos"),
  tituloGrafico1: document.getElementById("tituloGrafico1"),
  tituloGrafico2: document.getElementById("tituloGrafico2"),
  grafico1Nota: document.getElementById("grafico1Nota"),
  grafico2Nota: document.getElementById("grafico2Nota"),
  filtroProgramaTop: document.getElementById("filtroProgramaTop"),
  filtroProgramaWrap: document.getElementById("filtroProgramaWrap"),
  filtroPrograma: document.getElementById("filtroPrograma"),
  homePeriodoFiltroTop: document.getElementById("homePeriodoFiltroTop"),
  homeFiltroAno: document.getElementById("homeFiltroAno"),
  homeFiltroMes: document.getElementById("homeFiltroMes"),
  sidebar: document.getElementById("sidebar"),
  menuToggle: document.getElementById("menuToggle"),
  menuEdgeOpen: document.getElementById("menuEdgeOpen"),
  secaoAgrupamentos: document.getElementById("secaoAgrupamentos"),
  tituloAgrupamentos: document.getElementById("tituloAgrupamentos"),
  agrupamentosGrid: document.getElementById("agrupamentosGrid"),
  menuOverlay: document.getElementById("menuOverlay")
};

/** GeoJSON servido em /static (frontend/geo/). */
const CE_REGIOES_GEO_URL = "/static/geo/ce_regioes.geojson";

function isMunicipalMapPage(sheetName = state.abaAtual) {
  return sheetName === "mapa_regioes" || sheetName === "perfil_municipal";
}

function isMobileSidebarViewport() {
  return typeof window.matchMedia === "function" && window.matchMedia("(max-width: 1024px)").matches;
}

function updateMenuToggleIcon() {
  if (!els.menuToggle || !els.sidebar) return;
  const open = els.sidebar.classList.contains("open");
  document.body.classList.toggle("sidebar-open", open && !isMobileSidebarViewport());
  const icon = els.menuToggle.querySelector("i");
  if (icon) {
    icon.className = open ? "fa-solid fa-xmark" : "fa-solid fa-bars";
  }
  els.menuToggle.setAttribute("aria-label", open ? "Fechar menu lateral" : "Abrir menu lateral");
}

/** Desktop: menu aberto sem véu; mobile: véu ao abrir (comportamento tactil). */
function openMenu() {
  els.sidebar.classList.add("open");
  if (isMobileSidebarViewport()) els.menuOverlay.classList.add("show");
  updateMenuToggleIcon();
  requestAnimationFrame(() => {
    if (isMunicipalMapPage()) window.ceRegioesMapApi?.resize();
  });
}

function closeMenu() {
  els.sidebar.classList.remove("open");
  els.menuOverlay.classList.remove("show");
  updateMenuToggleIcon();
  requestAnimationFrame(() => {
    if (isMunicipalMapPage()) window.ceRegioesMapApi?.resize();
  });
}

/** Desktop = menu visível por defeito; mobile = fechado (ícones). */
function applySidebarModeForViewport() {
  if (!els.sidebar) return;
  if (isMobileSidebarViewport()) {
    els.sidebar.classList.remove("open");
    els.menuOverlay.classList.remove("show");
  } else {
    els.sidebar.classList.add("open");
    els.menuOverlay.classList.remove("show");
  }
  updateMenuToggleIcon();
  if (isMunicipalMapPage() && window.ceRegioesMapApi) {
    window.ceRegioesMapApi.resize();
  }
}

function toggleMenu() {
  const isOpen = els.sidebar.classList.contains("open");
  if (isOpen) {
    closeMenu();
  } else {
    openMenu();
  }
}

/** Inteiros pt-BR só com pontos de milhar (ex.: 5.368, 1.469.712). */
function parseValorMilharPt(rawValue) {
  const text = String(rawValue ?? "").trim().replace(/\s/g, "");
  if (!text) return null;
  const neg = text.startsWith("-");
  const core = neg ? text.slice(1) : text;
  if (/^\d{1,3}(\.\d{3})+$/.test(core)) {
    const n = Number(core.replace(/\./g, ""));
    return neg ? -n : n;
  }
  return null;
}

function toNumber(rawValue) {
  const text = String(rawValue ?? "").trim();
  if (!text) return 0;
  const milhar = parseValorMilharPt(text);
  if (milhar !== null) return milhar;
  const normalized = text.replace(/[^\d,.-]/g, "");
  let clean = normalized;
  if (normalized.includes(",") && normalized.includes(".")) {
    clean = normalized.replace(/\./g, "").replace(",", ".");
  } else if (normalized.includes(",")) {
    clean = normalized.replace(",", ".");
  }
  const num = Number(clean);
  return Number.isFinite(num) ? num : 0;
}

/** Valor numérico da linha: prioriza a string `valor` (fonte da planilha); `valor_numerico` só como fallback. */
function getRowNumericValor(row) {
  if (row == null) return null;
  if (isNumericLike(row.valor)) return toNumber(row.valor);
  const vn = row.valor_numerico;
  if (vn != null && vn !== "") {
    const n = typeof vn === "number" ? vn : Number(String(vn).trim().replace(",", "."));
    if (Number.isFinite(n)) return n;
  }
  return null;
}

function formatNumber(value, unidade = "", options = {}) {
  const numeric = Number(value || 0);
  if (unidade === "%") {
    return `${new Intl.NumberFormat("pt-BR", { maximumFractionDigits: 1, ...options }).format(numeric)}%`;
  }
  if (unidade.toLowerCase().includes("r$") || unidade.toLowerCase().includes("real")) {
    return new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL", maximumFractionDigits: 2 }).format(numeric);
  }
  const integerOptions = Number.isInteger(numeric) ? { maximumFractionDigits: 0 } : { maximumFractionDigits: 2 };
  return new Intl.NumberFormat("pt-BR", { ...integerOptions, ...options }).format(numeric);
}

function formatDateBr(value) {
  if (!value) return "-";
  const text = String(value).trim();
  if (/^\d{2}\/\d{2}\/\d{4}$/.test(text)) return text;
  if (/^\d{4}-\d{2}-\d{2}$/.test(text)) {
    const [y, m, d] = text.split("-");
    return `${d}/${m}/${y}`;
  }
  return text;
}

/** Ano civil sem decimal residual (ex.: 2025 em vez de 2025,0). */
function formatAnoExibicao(raw) {
  if (raw === null || raw === undefined || raw === "") return "";
  if (isNumericLike(raw)) {
    return String(Math.trunc(toNumber(raw)));
  }
  const s = String(raw).trim();
  const m = s.match(/^(\d{4})/);
  if (m) return m[1];
  return s;
}

const MESES_ABREV_PT = ["Jan", "Fev", "Mar", "Abr", "Mai", "Jun", "Jul", "Ago", "Set", "Out", "Nov", "Dez"];
const MESES_NOME_PT = [
  "Janeiro",
  "Fevereiro",
  "Março",
  "Abril",
  "Maio",
  "Junho",
  "Julho",
  "Agosto",
  "Setembro",
  "Outubro",
  "Novembro",
  "Dezembro"
];

const MESES_TEXTO_PARA_NUM = {
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
  dezembro: 12
};

function parseIndicadorMesNumero(raw) {
  if (raw == null || raw === "") return null;
  if (isNumericLike(raw)) {
    const n = Math.trunc(toNumber(raw));
    if (n >= 1 && n <= 12) return n;
  }
  const t = normalizeTextForCompare(String(raw));
  if (!t) return null;
  for (const [nome, num] of Object.entries(MESES_TEXTO_PARA_NUM)) {
    if (t === nome || t.startsWith(nome.slice(0, 3))) return num;
  }
  return null;
}

function parseIndicadorAnoNumero(raw) {
  if (raw == null || raw === "") return null;
  const y = formatAnoExibicao(raw);
  if (y && /^\d{4}$/.test(y)) return Number(y);
  return null;
}

/** Período mensal da linha (aba indicadores): ano + mês ou null se não identificável. */
function parseIndicadorRowPeriod(row) {
  let year = parseIndicadorAnoNumero(row.ano);
  let month = parseIndicadorMesNumero(row.mes);

  if (row.periodo) {
    const text = String(row.periodo).trim();
    const iso = text.match(/^(\d{4})-(\d{2})/);
    if (iso) {
      year = year || Number(iso[1]);
      month = month || Number(iso[2]);
    } else {
      const br = text.match(/^(\d{2})\/(\d{2})\/(\d{4})/);
      if (br) {
        year = year || Number(br[3]);
        month = month || Number(br[2]);
      } else {
        const d = new Date(text);
        if (!Number.isNaN(d.getTime())) {
          year = year || d.getFullYear();
          month = month || d.getMonth() + 1;
        }
      }
    }
  }

  if (year && month >= 1 && month <= 12) {
    return { year, month, sortKey: year * 100 + month };
  }
  if (year && !month) {
    return { year, month: null, sortKey: year * 100 };
  }
  return null;
}

function listIndicadorMonthlyPeriods(rows) {
  const map = new Map();
  for (const row of rows) {
    const p = parseIndicadorRowPeriod(row);
    if (!p || p.month == null) continue;
    const key = `${p.year}-${p.month}`;
    if (!map.has(key)) map.set(key, p);
  }
  return [...map.values()].sort((a, b) => a.sortKey - b.sortKey);
}

function getLatestIndicadorPeriod(rows) {
  const list = listIndicadorMonthlyPeriods(rows);
  return list.length ? list[list.length - 1] : null;
}

function resolveHomeReferencia(rows) {
  const latest = getLatestIndicadorPeriod(rows);
  const ref = state.homeReferencia;
  if (ref && ref.ano != null && ref.mes != null) {
    const periods = listIndicadorMonthlyPeriods(rows);
    const ok = periods.some((p) => p.year === ref.ano && p.month === ref.mes);
    if (ok) return { year: ref.ano, month: ref.mes };
  }
  if (latest) return { year: latest.year, month: latest.month };
  return { year: null, month: null };
}

function filterRowsByIndicadorPeriod(rows, year, month) {
  if (year == null || month == null) return rows;
  return rows.filter((row) => {
    const p = parseIndicadorRowPeriod(row);
    if (!p) return true;
    if (p.month == null) return p.year === year;
    return p.year === year && p.month === month;
  });
}

function formatHomePeriodoLabel(year, month) {
  if (!year || !month) return "";
  return `${MESES_NOME_PT[month - 1]} de ${year}`;
}

function formatIndicadorRowMeta(row) {
  const p = parseIndicadorRowPeriod(row);
  if (p && p.month) return formatHomePeriodoLabel(p.year, p.month);
  const mesFmt = row.mes != null && String(row.mes).trim() !== "" ? String(row.mes).trim() : "";
  const anoFmt = formatAnoExibicao(row.ano);
  if (mesFmt && anoFmt) return `${mesFmt} · ${anoFmt}`;
  return (
    row.periodo ||
    (anoFmt ? formatAnoExibicao(row.ano) : "") ||
    row.fonte ||
    "Valor informado na base"
  );
}

function indicadorRowLabelKey(row, labelCol) {
  return normalizeTextForCompare(
    String(row[labelCol] || row.indicador || row.tema || row.categoria || "")
  );
}

function dedupeIndicadorRowsByLabel(rows, labelCol) {
  const byLabel = new Map();
  for (const row of rows) {
    const key = indicadorRowLabelKey(row, labelCol);
    if (!key) continue;
    const existing = byLabel.get(key);
    const v = getRowNumericValor(row);
    const ev = existing ? getRowNumericValor(existing) : null;
    if (!existing || (v != null && (ev == null || Math.abs(v) > Math.abs(ev)))) {
      byLabel.set(key, row);
    }
  }
  return [...byLabel.values()];
}

/** Ex.: 2026-04-01 → Abr/2026 (para blocos de Análises). */
function formatPeriodoAnalise(raw) {
  if (raw === null || raw === undefined) return "";
  const text = String(raw).trim();
  if (!text) return "";

  const iso = text.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (iso) {
    const month = Number(iso[2]);
    const year = iso[1];
    if (month >= 1 && month <= 12) return `${MESES_ABREV_PT[month - 1]}/${year}`;
  }

  const br = text.match(/^(\d{2})\/(\d{2})\/(\d{4})/);
  if (br) {
    const month = Number(br[2]);
    const year = br[3];
    if (month >= 1 && month <= 12) return `${MESES_ABREV_PT[month - 1]}/${year}`;
  }

  const d = new Date(text);
  if (!Number.isNaN(d.getTime())) {
    return `${MESES_ABREV_PT[d.getMonth()]}/${d.getFullYear()}`;
  }

  return text;
}

function analiseCategoriaIcon(categoria) {
  const k = normalizeTextForCompare(categoria);
  const map = {
    "geracao de emprego - caged": "fa-solid fa-briefcase",
    desemprego: "fa-solid fa-chart-line",
    ocupacao: "fa-solid fa-users",
    rendimento: "fa-solid fa-coins",
    desalento: "fa-solid fa-user-slash",
    "no ano de 2025": "fa-solid fa-calendar-check",
    jovem: "fa-solid fa-children"
  };
  if (map[k]) return map[k];
  if (k.includes("caged") || (k.includes("emprego") && k.includes("geracao"))) return "fa-solid fa-briefcase";
  if (k.includes("desempreg")) return "fa-solid fa-arrow-trend-down";
  if (k.includes("ocup")) return "fa-solid fa-user-check";
  if (k.includes("rend")) return "fa-solid fa-wallet";
  if (k.includes("jovem")) return "fa-solid fa-children";
  if (k.includes("2025") || k.includes("ano")) return "fa-solid fa-calendar-days";
  return "fa-solid fa-chart-pie";
}

function isNumericLike(value) {
  if (value === null || value === undefined) return false;
  const text = String(value).trim();
  if (!text) return false;
  const clean = text.replace(/[^\d,.-]/g, "").replace(/\./g, "").replace(",", ".");
  return clean !== "" && !Number.isNaN(Number(clean));
}

function isCurrencyField(column, unidade = "") {
  const field = String(column || "").toLowerCase();
  const unit = String(unidade || "").toLowerCase();
  return field.includes("financeiro") || field.includes("receita") || field.includes("valor") && (unit.includes("r$") || unit.includes("real") || unit.includes("reais"));
}

function formatCellValue(value, column, row = {}) {
  const col = String(column || "").toLowerCase();
  const unidade = String(row.unidade || "");

  if (!value && value !== 0) return "-";
  if (col.includes("data")) return formatDateBr(value);
  if (col === "mes" && isNumericLike(value)) {
    return new Intl.NumberFormat("pt-BR", { maximumFractionDigits: 0 }).format(toNumber(value));
  }
  if (col === "ano") {
    return formatAnoExibicao(value) || "-";
  }
  if (isCurrencyField(col, unidade) && isNumericLike(value)) {
    return new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL", maximumFractionDigits: 2 }).format(toNumber(value));
  }
  if (col.includes("taxa") && isNumericLike(value)) return `${formatNumber(toNumber(value), "%")}`;
  if (isNumericLike(value) && !["id", "ano"].includes(col)) return formatNumber(toNumber(value), unidade);
  return String(value);
}

function uniqueValues(list, key) {
  return [...new Set(list.map(item => item[key]).filter(Boolean))];
}

function detectLabelColumn(columns) {
  const priority = ["indicador", "programa", "perfil", "descricao", "categoria", "tema", "titulo"];
  return priority.find((k) => columns.includes(k)) || columns[0];
}

function detectMetricColumn(rows, columns) {
  const preferred = ["valor", "participantes", "servicos", "volume_financeiro", "total", "pessoas"];
  const preferredMatch = preferred.find((col) => columns.includes(col));
  if (preferredMatch) return preferredMatch;

  const excluded = new Set([
    "id", "ano", "mes", "periodo", "data_atualizacao", "fonte", "observacao", "descricao",
    "programa", "perfil", "categoria", "tema", "titulo", "texto", "chave", "comparativo", "unidade"
  ]);

  const candidate = columns.find((col) => {
    if (excluded.has(col)) return false;
    return rows.some((row) => isNumericLike(row[col]));
  });
  return candidate || null;
}

function getMetricFields(columns) {
  const skip = new Set([
    "id", "tema", "categoria", "indicador", "programa", "perfil", "descricao", "titulo",
    "texto", "fonte", "observacao", "periodo", "data_atualizacao", "comparativo",
    "chave", "valor_numerico"
  ]);
  return columns.filter((col) => !skip.has(col));
}

function normalizeCardTitle(text) {
  return String(text || "")
    .replace(/_/g, " ")
    .replace(/\b\w/g, (c) => c.toUpperCase());
}

function normalizeTextForCompare(text) {
  return String(text || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .trim();
}

function escapeHtml(text) {
  return String(text ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/** Slug ASCII (fallback) em /static/assets/programas/{slug}.png */
const PROGRAM_IMAGE_SLUGS = {
  "vai vem trabalhador": "vai_vem_trabalhador",
  "vaivem trabalhador": "vai_vem_trabalhador",
  "ceara credi": "ceara_credi",
  "dinheiro na mao": "dinheiro_na_mao",
  "fomento rural": "fomento_rural"
};

/** Nome do ficheiro (sem .png) quando difere do texto da coluna programa na planilha */
const PROGRAM_IMAGE_FILE_STEM_ALIASES = {
  "vai vem trabalhador": "VaiVem Trabalhador",
  "vaivem trabalhador": "VaiVem Trabalhador",
  "ceara credi": "Ceará Credi",
  "dinheiro na mao": "Dinheiro na Mão",
  "fomento rural": "Fomento Rural"
};

function programImageSlug(programa) {
  const key = normalizeTextForCompare(programa);
  if (PROGRAM_IMAGE_SLUGS[key]) return PROGRAM_IMAGE_SLUGS[key];
  return key.replace(/\s+/g, "_").replace(/[^a-z0-9_]/g, "");
}

/** Vários URLs possíveis: primeiro o mesmo nome que na planilha (como nos seus PNG), depois aliases e slug. */
function programImageCandidates(programa) {
  const base = "/static/assets/programas/";
  const trimmed = String(programa || "").trim();
  const urls = [];
  const seen = new Set();

  function add(url) {
    if (!url || seen.has(url)) return;
    seen.add(url);
    urls.push(url);
  }

  if (trimmed) {
    add(base + encodeURIComponent(trimmed) + ".png");
    const aliasStem = PROGRAM_IMAGE_FILE_STEM_ALIASES[normalizeTextForCompare(trimmed)];
    if (aliasStem && normalizeTextForCompare(aliasStem) !== normalizeTextForCompare(trimmed)) {
      add(base + encodeURIComponent(aliasStem) + ".png");
    }
  }

  const slug = programImageSlug(programa);
  add(base + slug + ".png");

  return urls;
}

function tryProgramLogo(img) {
  let list = [];
  try {
    list = JSON.parse(img.getAttribute("data-candidates") || "[]");
  } catch {
    list = [];
  }
  const next = Number(img.dataset.idx || 0) + 1;
  if (next < list.length) {
    img.dataset.idx = String(next);
    img.src = list[next];
    return;
  }
  img.style.display = "none";
  const fb = img.nextElementSibling;
  if (fb && fb.classList.contains("card-programa__logo-fallback")) {
    fb.style.display = "flex";
  }
}

function rowLooksCurrency(row) {
  const ind = String(row.indicador || "");
  const u = String(row.unidade || "");
  if (isCurrencyField(ind, u)) return true;
  const ul = u.toLowerCase();
  return ul.includes("r$") || ul.includes("real") || ul.includes("reais");
}

function pickProgramLayout(rows) {
  const sorted = [...rows].sort((a, b) => toNumber(a.id || 0) - toNumber(b.id || 0));
  if (sorted.length === 0) return { top: null, bottom: null };
  if (sorted.length === 1) return { top: null, bottom: sorted[0] };

  let bottomIdx = sorted.findIndex((r) => rowLooksCurrency(r));
  if (bottomIdx < 0) bottomIdx = sorted.length - 1;

  const bottom = sorted[bottomIdx];
  const top = sorted.find((_, i) => i !== bottomIdx) || sorted[0];
  return { top, bottom };
}

function formatProgramIndicatorLine(row) {
  const label = row.indicador || normalizeCardTitle(row.programa) || "Indicador";
  const value = formatCellValue(row.valor, "valor", row);
  const period = row.periodo ? String(row.periodo).trim() : "";
  return { label, value, period };
}

/** Linha detalhada no card KPI (filtro com programa + dados perfil_social). */
function formatProgramaKpiRowHtml(row) {
  const keys = Object.keys(row);
  const metricCol = detectMetricColumn([row], keys);
  const label = row.indicador || row.programa || row.descricao || row.titulo || "Indicador";
  let valStr = "-";
  if (metricCol && row[metricCol] !== undefined && row[metricCol] !== null && String(row[metricCol]).trim() !== "") {
    valStr = isNumericLike(row[metricCol])
      ? formatCellValue(row[metricCol], metricCol, row)
      : String(row[metricCol]);
  }
  const unitParen = row.unidade ? ` (${row.unidade})` : "";
  const periodo = row.periodo != null && String(row.periodo).trim() !== "" ? String(row.periodo).trim() : "—";
  const fonte = row.fonte != null && String(row.fonte).trim() !== "" ? String(row.fonte).trim() : "—";
  const obsRaw = row.observacao != null ? String(row.observacao).trim() : "";
  const obsBlock = obsRaw
    ? `<div class="card-programa__kpi-obs"><span class="card-programa__kpi-obs-lbl">Observação:</span> <span class="card-programa__kpi-obs-txt">${escapeHtml(obsRaw)}</span></div>`
    : "";
  return `
        <div class="card-programa__kpi-row">
          <strong class="card-programa__kpi-label">${escapeHtml(label)}</strong>
          <span class="card-programa__kpi-value">${escapeHtml(valStr)}${escapeHtml(unitParen)}</span>
          <span class="card-programa__kpi-meta"><span class="card-programa__kpi-meta-bit"><span class="card-programa__kpi-meta-lbl">Período:</span> ${escapeHtml(periodo)}</span><span class="card-programa__kpi-meta-sep"> · </span><span class="card-programa__kpi-meta-bit"><span class="card-programa__kpi-meta-lbl">Fonte:</span> ${escapeHtml(fonte)}</span></span>
          ${obsBlock}
        </div>`;
}

/** Chave de agrupamento na aba Programas: `tema` quando preenchido (equivale ao eixo programa), senão `programa`. */
function programasGroupKey(row) {
  const temaStr = row.tema != null ? String(row.tema).trim() : "";
  if (temaStr) return temaStr;
  return row.programa || "Sem programa";
}

function programasCardPresentation(rows) {
  const rowComTema = rows.find((r) => r.tema != null && String(r.tema).trim());
  if (rowComTema) {
    return { title: String(rowComTema.tema).trim(), eyebrow: "TEMA" };
  }
  const first = rows[0];
  return { title: first.programa || "Sem programa", eyebrow: "PROGRAMA" };
}

/** Coluna usada para blocos inferiores conforme a aba. */
function resolveGroupKeyColumn(sheetName, columns) {
  const configured = GROUP_BY_SHEET[sheetName];
  if (configured && columns.includes(configured)) return configured;
  return detectLabelColumn(columns);
}

/** Card compacto: apenas valores globais (duas métricas), só dados da aba programas. */
function renderProgramCardHtmlCompact(groupKey, rows) {
  const { top, bottom } = pickProgramLayout(rows);
  if (!bottom) return "";

  const pres = programasCardPresentation(rows);
  const logoRef =
    rows.map((r) => (r.programa != null ? String(r.programa).trim() : "")).find(Boolean) || groupKey;
  const candidates = programImageCandidates(logoRef);
  const candidatesJson = escapeHtml(JSON.stringify(candidates));
  const imgSrc = candidates[0] || "";
  const bottomFmt = formatProgramIndicatorLine(bottom);
  const topFmt = top ? formatProgramIndicatorLine(top) : null;

  const topBlock = topFmt
    ? `
        <div class="card-programa__metric-top">
          <div class="card-programa__value-md">${escapeHtml(topFmt.value)}</div>
          <div class="card-programa__label-md">${escapeHtml(topFmt.label)}</div>
          ${topFmt.period ? `<div class="card-programa__period">${escapeHtml(topFmt.period)}</div>` : ""}
        </div>`
    : "";

  return `
    <article class="card card-programa">
      <div class="card-programa__top">
        <div class="card-programa__brand">
          <div class="card-programa__logo-wrap">
            <img class="card-programa__logo" src="${escapeHtml(imgSrc)}" alt="" loading="lazy"
              data-candidates="${candidatesJson}"
              onerror="tryProgramLogo(this)" />
            <span class="card-programa__logo-fallback" style="display:none" aria-hidden="true"><i class="fa-solid fa-chart-pie"></i></span>
          </div>
          <div class="card-programa__titles">
            <span class="card-programa__eyebrow">${escapeHtml(pres.eyebrow)}</span>
            <strong class="card-programa__name">${escapeHtml(pres.title)}</strong>
            ${
              pres.eyebrow === "TEMA"
                ? (() => {
                    const plist = [...new Set(rows.map((r) => r.programa).filter(Boolean))];
                    return plist.length
                      ? `<span class="card-programa__linked-programs">${escapeHtml(plist.join(" · "))}</span>`
                      : "";
                  })()
                : ""
            }
          </div>
        </div>
        ${topBlock}
      </div>
      <div class="card-programa__bottom">
        <div class="card-programa__value-xl">${escapeHtml(bottomFmt.value)}</div>
        <div class="card-programa__label-xl">${escapeHtml(bottomFmt.label)}</div>
        ${
          bottomFmt.period
            ? `<div class="card-programa__period card-programa__period--dark">${escapeHtml(bottomFmt.period)}</div>`
            : ""
        }
      </div>
    </article>`;
}

/** Card expandido: lista todos os indicadores (programas + perfil_social). */
function renderProgramCardHtmlFull(groupKey, rows) {
  if (!rows.length) return "";

  const sorted = [...rows].sort((a, b) => toNumber(a.id || 0) - toNumber(b.id || 0));
  const pres = programasCardPresentation(rows);
  const logoRef =
    rows.map((r) => (r.programa != null ? String(r.programa).trim() : "")).find(Boolean) || groupKey;
  const candidates = programImageCandidates(logoRef);
  const candidatesJson = escapeHtml(JSON.stringify(candidates));
  const imgSrc = candidates[0] || "";
  const metricsHtml = sorted.map((row) => formatProgramaKpiRowHtml(row)).join("");

  return `
    <article class="card card-programa card-programa--kpi-full">
      <div class="card-programa__top card-programa__top--kpi-full">
        <div class="card-programa__brand">
          <div class="card-programa__logo-wrap">
            <img class="card-programa__logo" src="${escapeHtml(imgSrc)}" alt="" loading="lazy"
              data-candidates="${candidatesJson}"
              onerror="tryProgramLogo(this)" />
            <span class="card-programa__logo-fallback" style="display:none" aria-hidden="true"><i class="fa-solid fa-chart-pie"></i></span>
          </div>
          <div class="card-programa__titles">
            <span class="card-programa__eyebrow">${escapeHtml(pres.eyebrow)}</span>
            <strong class="card-programa__name">${escapeHtml(pres.title)}</strong>
            ${
              pres.eyebrow === "TEMA"
                ? (() => {
                    const plist = [...new Set(rows.map((r) => r.programa).filter(Boolean))];
                    return plist.length
                      ? `<span class="card-programa__linked-programs">${escapeHtml(plist.join(" · "))}</span>`
                      : "";
                  })()
                : ""
            }
          </div>
        </div>
      </div>
      <div class="card-programa__kpi-list">${metricsHtml}</div>
    </article>`;
}

function buildProgramasKpiHtmlCompact(rowsProgramas) {
  const grouped = {};
  rowsProgramas.forEach((row) => {
    const key = programasGroupKey(row);
    if (!grouped[key]) grouped[key] = [];
    grouped[key].push(row);
  });
  const entries = Object.entries(grouped).sort((a, b) => a[0].localeCompare(b[0], "pt-BR"));
  return entries.map(([key, list]) => renderProgramCardHtmlCompact(key, list)).join("");
}

function buildProgramasKpiHtmlFull(rowsProgramas, rowsPerfilSocial = []) {
  const grouped = {};
  rowsProgramas.forEach((row) => {
    const key = programasGroupKey(row);
    if (!grouped[key]) grouped[key] = [];
    grouped[key].push(row);
  });
  rowsPerfilSocial.forEach((row) => {
    const key = programasGroupKey(row);
    if (!grouped[key]) grouped[key] = [];
    grouped[key].push(row);
  });
  const entries = Object.entries(grouped).sort((a, b) => a[0].localeCompare(b[0], "pt-BR"));
  return entries.map(([key, list]) => renderProgramCardHtmlFull(key, list)).join("");
}

function pluralizePt(label) {
  const text = String(label || "").toLowerCase();
  if (text.endsWith("s")) return text;
  if (text.endsWith("l")) return `${text.slice(0, -1)}is`;
  return `${text}s`;
}

function prettifyName(sheetName) {
  return sheetName
    .replace(/_/g, " ")
    .replace(/\b\w/g, (c) => c.toUpperCase());
}

function renderMenu() {
  const visibleAbas = state.abas.filter(
    (sheetName) => !HIDDEN_MENU_ITEMS.has(sheetName) && !NESTED_MENU_ITEMS.has(sheetName)
  );

  const blocks = visibleAbas.map((sheetName) => {
    const meta = MENU_META[sheetName] || {};
    const icon = meta.icon || "fa-solid fa-circle";
    const label = meta.label || prettifyName(sheetName);

    const children = (MENU_GROUP_CHILDREN[sheetName] || []).filter((child) => state.abas.includes(child));
    if (!children.length) {
      return `
    <button type="button" class="menu-item ${state.abaAtual === sheetName ? "active" : ""}" data-aba="${sheetName}">
      <i class="${icon}"></i>
      <span>${label}</span>
    </button>`;
    }

    const parentActive = state.abaAtual === sheetName;
    const groupHasOtherActive = children.some((c) => state.abaAtual === c);
    const parentClass = [
      "menu-item",
      "menu-item--parent",
      parentActive ? "active" : "",
      groupHasOtherActive ? "menu-item--within-group-active" : ""
    ]
      .filter(Boolean)
      .join(" ");

    const subHtml = children
      .map((child) => {
        const cm = MENU_META[child] || {};
        const ci = cm.icon || "fa-solid fa-circle";
        const cl = cm.label || prettifyName(child);
        return `
    <button type="button" class="menu-item menu-item--sub ${state.abaAtual === child ? "active" : ""}" data-aba="${child}">
      <i class="${ci}"></i>
      <span>${cl}</span>
    </button>`;
      })
      .join("");

    return `
  <div class="menu-group">
    <button type="button" class="${parentClass}" data-aba="${sheetName}">
      <i class="${icon}"></i>
      <span>${label}</span>
    </button>
    <div class="menu-sub">${subHtml}</div>
  </div>`;
  });

  els.menuAbas.innerHTML = blocks.join("");

  els.menuAbas.querySelectorAll(".menu-item").forEach((btn) => {
    btn.addEventListener("click", () => {
      loadAba(btn.dataset.aba);
      if (window.innerWidth <= 1024) {
        closeMenu();
      }
    });
  });
}

function buildKpiCards(rows) {
  if (!rows.length) return [];
  const columns = Object.keys(rows[0]);
  const labelColumn = detectLabelColumn(columns);
  const metricFields = getMetricFields(columns);
  const cards = [];

  if (columns.includes("valor")) {
    const ranked = [...rows]
      .filter((row) => isNumericLike(row.valor))
      .sort((a, b) => toNumber(b.valor) - toNumber(a.valor))
      .slice(0, 6);

    ranked.forEach((row) => {
      cards.push({
        label: row[labelColumn] || normalizeCardTitle(row.categoria || "Indicador"),
        value: formatCellValue(row.valor, "valor", row),
        meta:
          row.periodo ||
          (row.ano != null && row.ano !== "" ? formatAnoExibicao(row.ano) : "") ||
          row.fonte ||
          "Valor informado na base"
      });
    });
  }

  if (!cards.length) {
    metricFields.forEach((field) => {
      const numericValues = rows.map((row) => row[field]).filter((value) => isNumericLike(value));
      if (!numericValues.length) return;

      const sum = numericValues.reduce((acc, value) => acc + toNumber(value), 0);
      const unidade = rows.find((row) => row.unidade)?.unidade || "";
      cards.push({
        label: normalizeCardTitle(field),
        value: formatCellValue(sum, field, { unidade }),
        meta: `Agregado de ${numericValues.length} registro(s)`
      });
    });
  }

  if (!cards.length) {
    const grouped = {};
    rows.forEach((row) => {
      const key = row[labelColumn] || "Sem classificação";
      grouped[key] = (grouped[key] || 0) + 1;
    });
    Object.entries(grouped)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 6)
      .forEach(([key, count]) => {
        cards.push({
          label: key,
          value: formatNumber(count),
          meta: "Ocorrências na aba"
        });
      });
  }

  return cards.slice(0, 6);
}

function observacaoSugereParcial(obs) {
  const raw = String(obs ?? "").trim();
  if (!raw) return false;
  const t = normalizeTextForCompare(raw);
  if (t.includes("parcial")) return true;
  if (t.includes("trimestre")) return true;
  if (/jan(eiro)?/.test(t) && /mar[cç]|marco/.test(t)) return true;
  if (/refer[eê]ncia/i.test(raw)) {
    if (
      /jan|fev|mar[cç]|abr|mai|jun|jul|ago|set|out|nov|dez|trimestre|parcial/i.test(t)
    ) {
      return true;
    }
  }
  return false;
}

function seriesHistoricasSeriesKey(row) {
  const tema = row.tema != null ? String(row.tema).trim() : "";
  const ind = row.indicador != null ? String(row.indicador).trim() : "";
  const base = ind || "Sem indicador";
  return tema ? `${tema} · ${base}` : base;
}

/** KPI = ano mais recente com leitura estável; evita priorizar ano parcial (observação técnica). */
function pickSeriesHistoricasKpiRow(seriesRows) {
  const valid = seriesRows.filter((r) => r.ano != null && isNumericLike(r.valor));
  if (!valid.length) return null;
  const desc = [...valid].sort((a, b) => toNumber(b.ano) - toNumber(a.ano));
  const top = desc[0];
  if (!observacaoSugereParcial(top.observacao)) return top;
  const fallback = desc.find((r, idx) => idx > 0 && !observacaoSugereParcial(r.observacao));
  return fallback || top;
}

/** Linhas cuja coluna indicador corresponde a cada métrica dos blocos comparativos. */
function rowsMatchingMetric(rows, kind) {
  return rows.filter((r) => {
    const ind = normalizeTextForCompare(String(r.indicador || ""));
    if (!ind) return false;
    switch (kind) {
      case "atendidos":
        return (ind.includes("atendid") || ind.includes("atendiment")) && !ind.includes("encamin");
      case "encaminhados":
        return ind.includes("encamin");
      case "vagas":
        return ind.includes("vaga") && !ind.includes("colocad");
      case "colocados":
        return ind.includes("colocad") || (ind.includes("coloca") && !ind.includes("vaga"));
      default:
        return false;
    }
  });
}

function rowMatchesMetricKind(row, kind) {
  return rowsMatchingMetric([row], kind).length > 0;
}

function latestNumericYearInRows(rows) {
  const ys = rows
    .map((r) => r.ano)
    .filter((a) => a != null && String(a).trim() !== "")
    .map((a) => toNumber(a))
    .filter((n) => Number.isFinite(n));
  return ys.length ? Math.max(...ys) : null;
}

function pickMetricRow(rows, kind) {
  return pickSeriesHistoricasKpiRow(rowsMatchingMetric(rows, kind));
}

function destroySeriesHistoricasKpiCharts() {
  ["seriesKpiBar1", "seriesKpiBar2"].forEach((key) => {
    if (state.charts[key]) {
      state.charts[key].destroy();
      state.charts[key] = null;
    }
  });
}

function mountSeriesHistoricasKpiStack(chartKey, selector, names, values) {
  const el = document.querySelector(selector);
  if (!el) return;
  if (state.charts[chartKey]) state.charts[chartKey].destroy();
  const v0 = Number.isFinite(values[0]) && values[0] >= 0 ? values[0] : 0;
  const v1 = Number.isFinite(values[1]) && values[1] >= 0 ? values[1] : 0;
  const total = v0 + v1;

  state.charts[chartKey] = new ApexCharts(el, {
    chart: {
      type: "bar",
      stacked: true,
      foreColor: "#1f2d78",
      toolbar: { show: false },
      zoom: { enabled: false },
      height: 148,
      animations: { speed: 280 }
    },
    plotOptions: {
      bar: {
        horizontal: true,
        barHeight: "48%",
        borderRadius: 4,
        borderRadiusApplication: "end"
      }
    },
    series: [
      { name: names[0], data: [v0] },
      { name: names[1], data: [v1] }
    ],
    xaxis: {
      categories: [" "],
      labels: { show: false },
      axisBorder: { show: true, color: "#cbd5e1" },
      axisTicks: { show: false }
    },
    yaxis: {
      labels: { show: false },
      axisBorder: { show: false }
    },
    grid: {
      borderColor: "#e8ecf5",
      padding: { left: 2, right: 14, top: 6, bottom: 4 },
      xaxis: { lines: { show: false } },
      yaxis: { lines: { show: false } }
    },
    legend: {
      position: "bottom",
      horizontalAlign: "center",
      fontSize: "12px",
      itemMargin: { horizontal: 14 },
      labels: { colors: "#1f2d78" },
      markers: { width: 10, height: 10, radius: 2 }
    },
    tooltip: {
      shared: true,
      intersect: false,
      y: { formatter: (val) => formatNumber(val) }
    },
    dataLabels: {
      enabled: total > 0,
      formatter: (val) => formatNumber(val),
      style: {
        fontSize: "11px",
        fontWeight: 600,
        colors: ["#fff", "#122252"]
      },
      dropShadow: { enabled: false }
    },
    colors: ["#ec7087", "#7fd0ff"]
  });
  state.charts[chartKey].render();
}

function metaAnoMaisRecente(yLatest) {
  if (yLatest == null) return "Sem ano numérico na base";
  return `Ano de referência: ${formatAnoExibicao(yLatest)} (mais recente na base)`;
}

/** Percentual de `part` sobre `base100` (ex.: encaminhados / atendidos × 100, com Atendidos = referência 100%). */
function formatPctShare(part, base100) {
  const base = Number(base100);
  const p = Number(part);
  if (!Number.isFinite(base) || base <= 0 || !Number.isFinite(p)) return "—";
  return formatNumber((p / base) * 100, "%");
}

function renderSeriesHistoricasKpiBars(rows) {
  destroySeriesHistoricasKpiCharts();

  const yLatest = latestNumericYearInRows(rows);
  const scoped = yLatest != null ? rows.filter((r) => toNumber(r.ano) === yLatest) : rows;

  const ra = pickMetricRow(scoped, "atendidos");
  const re = pickMetricRow(scoped, "encaminhados");
  const rv = pickMetricRow(scoped, "vagas");
  const rc = pickMetricRow(scoped, "colocados");

  const va = ra && isNumericLike(ra.valor) ? toNumber(ra.valor) : 0;
  const ve = re && isNumericLike(re.valor) ? toNumber(re.valor) : 0;
  const vv = rv && isNumericLike(rv.valor) ? toNumber(rv.valor) : 0;
  const vc = rc && isNumericLike(rc.valor) ? toNumber(rc.valor) : 0;

  const metaLinha = metaAnoMaisRecente(yLatest);
  const pctEncamin = formatPctShare(ve, va);
  const pctColocado = formatPctShare(vc, vv);

  els.kpis.className = "kpis sec sec-blue kpis--series-bars";
  els.kpis.innerHTML = `
    <div class="series-kpi-bars">
      <article class="series-kpi-bars__panel panel-soft">
        <div class="series-kpi-bars__head">
          <h4 class="series-kpi-bars__title">Atendidos x Encaminhados</h4>
          <aside class="series-kpi-bars__pct series-kpi-bars__pct--encamin" aria-label="Encaminhados como percentual sobre Atendidos (Atendidos = 100%)">
            <span class="series-kpi-bars__pct-label">Encaminhados</span>
            <span class="series-kpi-bars__pct-value">${escapeHtml(pctEncamin)}</span>
            <span class="series-kpi-bars__pct-hint">sobre Atendidos (referência 100%)</span>
          </aside>
        </div>
        <div id="seriesKpiBarAtendEnc" class="series-kpi-bars__chart" role="img" aria-label="Barras comparativas Atendidos e Encaminhados"></div>
        <p class="series-kpi-bars__meta">${escapeHtml(metaLinha)}</p>
      </article>
      <article class="series-kpi-bars__panel panel-soft">
        <div class="series-kpi-bars__head">
          <h4 class="series-kpi-bars__title">Vagas x Colocados</h4>
          <aside class="series-kpi-bars__pct series-kpi-bars__pct--colocado" aria-label="Colocados como percentual sobre Vagas (Vagas = 100%)">
            <span class="series-kpi-bars__pct-label">Colocados</span>
            <span class="series-kpi-bars__pct-value">${escapeHtml(pctColocado)}</span>
            <span class="series-kpi-bars__pct-hint">sobre Vagas (referência 100%)</span>
          </aside>
        </div>
        <div id="seriesKpiBarVagasCol" class="series-kpi-bars__chart" role="img" aria-label="Barras comparativas Vagas e Colocados"></div>
        <p class="series-kpi-bars__meta">${escapeHtml(metaLinha)}</p>
      </article>
    </div>`;

  mountSeriesHistoricasKpiStack("seriesKpiBar1", "#seriesKpiBarAtendEnc", ["Atendidos", "Encaminhados"], [va, ve]);
  mountSeriesHistoricasKpiStack("seriesKpiBar2", "#seriesKpiBarVagasCol", ["Vagas", "Colocados"], [vv, vc]);
}

function labelMatchesHomeDestaque(normalizedLabel) {
  return HOME_KPI_DESTAQUE_DEF.some((def) => def.test(normalizedLabel));
}

function buildIndicadoresDestaqueCards(rows) {
  if (!rows.length) return [];
  const cols = Object.keys(rows[0]);
  const labelCol = detectLabelColumn(cols);
  const hasValor = cols.includes("valor");
  const used = new Set();

  return HOME_KPI_DESTAQUE_DEF.map((def) => {
    const idx = rows.findIndex((row, i) => {
      if (used.has(i)) return false;
      const lab = normalizeTextForCompare(String(row[labelCol] || row.indicador || row.tema || row.categoria || ""));
      return def.test(lab);
    });
    if (idx >= 0) {
      used.add(idx);
      const row = rows[idx];
      const label = String(row[labelCol] || row.indicador || def.fallbackLabel);
      const value =
        hasValor && isNumericLike(row.valor) ? formatCellValue(row.valor, "valor", row) : "—";
      const meta = formatIndicadorRowMeta(row) || row.fonte || "Valor na base";
      return {
        label,
        value,
        meta,
        icon: def.icon,
        cardClass: def.cardClass,
        missing: false
      };
    }
    return {
      label: def.fallbackLabel,
      value: "—",
      meta: "Indicador nao encontrado na base",
      icon: def.icon,
      cardClass: def.cardClass,
      missing: true
    };
  });
}

function buildIndicadoresDemaisCards(rows) {
  if (!rows.length) return [];
  const cols = Object.keys(rows[0]);
  const labelCol = detectLabelColumn(cols);
  if (!cols.includes("valor")) return [];

  const candidates = rows.filter((row) => isNumericLike(row.valor));
  const deduped = dedupeIndicadorRowsByLabel(candidates, labelCol);

  let cards = deduped
    .map((row) => ({
      label: row[labelCol] || normalizeCardTitle(row.categoria || "Indicador"),
      value: formatCellValue(row.valor, "valor", row),
      meta: formatIndicadorRowMeta(row),
      sortVal: Math.abs(toNumber(row.valor))
    }))
    .filter((card) => !HOME_KPI_OCULTOS.has(normalizeTextForCompare(card.label)))
    .filter((card) => !labelMatchesHomeDestaque(normalizeTextForCompare(card.label)))
    .filter((card) => {
      const n = normalizeTextForCompare(String(card.label || ""));
      if (n.includes("populacao") && (n.includes("ocupad") || n.includes("ocup")) && !n.includes("desempreg")) {
        return false;
      }
      return true;
    })
    .sort((a, b) => b.sortVal - a.sortVal)
    .slice(0, 6);

  return cards.map(({ sortVal, ...card }) => card);
}

/** Séries para o gráfico horizontal estilo «saldo por atividade» (página inicial). */
function buildSaldoPorAtividadeSeries(rows) {
  if (!rows.length) return null;
  const cols = Object.keys(rows[0]);
  if (!cols.includes("valor") && !cols.includes("valor_numerico")) return null;
  const labelCol = detectLabelColumn(cols);

  const saldoMatchLabel = (row) => {
    const parts = [row[labelCol], row.indicador, row.tema, row.categoria].filter((x) => x != null && String(x).trim() !== "");
    return normalizeTextForCompare(parts.join(" "));
  };

  const defs = [
    {
      label: "Serviços",
      test(n) {
        return n.includes("servico");
      },
      stripeClass: "saldo-atividade__stripes--servicos"
    },
    {
      label: "Comércio",
      test(n) {
        return n.includes("comercio");
      },
      stripeClass: "saldo-atividade__stripes--comercio"
    },
    {
      label: "Construção",
      test(n) {
        return n.includes("construc");
      },
      stripeClass: "saldo-atividade__stripes--construcao"
    },
    {
      label: "Indústria",
      test(n) {
        return n.includes("industria");
      },
      stripeClass: "saldo-atividade__stripes--industria"
    },
    {
      label: "Agropecuária",
      test(n) {
        return n.includes("agropec") || (n.includes("agro") && !n.includes("industria"));
      },
      stripeClass: "saldo-atividade__stripes--agro"
    }
  ];

  const used = new Set();
  const items = defs.map((def) => {
    const idx = rows.findIndex((row, i) => {
      if (used.has(i)) return false;
      const lab = saldoMatchLabel(row);
      return def.test(lab);
    });
    if (idx < 0) {
      return { ...def, raw: null, display: "—", widthPctNeg: 0, widthPctPos: 0 };
    }
    used.add(idx);
    const row = rows[idx];
    const raw = getRowNumericValor(row);
    return {
      ...def,
      raw,
      display: raw === null ? "—" : formatSaldoAtividadeValor(raw),
      widthPctNeg: 0,
      widthPctPos: 0
    };
  });

  const nums = items.map((it) => (it.raw !== null ? Math.abs(it.raw) : 0));
  const maxAbs = Math.max(...nums, 1);
  items.forEach((it) => {
    if (it.raw === null || it.raw === 0) {
      it.widthPctNeg = 0;
      it.widthPctPos = 0;
    } else {
      const pct = (Math.abs(it.raw) / maxAbs) * 100;
      if (it.raw < 0) {
        it.widthPctNeg = pct;
        it.widthPctPos = 0;
      } else {
        it.widthPctNeg = 0;
        it.widthPctPos = pct;
      }
    }
  });

  return items;
}

function formatSaldoAtividadeValor(n) {
  const v = toNumber(n);
  const fmt = new Intl.NumberFormat("pt-BR", { maximumFractionDigits: 0 }).format(Math.abs(v));
  if (v > 0) return `+${fmt}`;
  if (v < 0) return `−${fmt}`;
  return fmt;
}

function renderSaldoPorAtividadeHtml(rows) {
  const series = buildSaldoPorAtividadeSeries(rows);
  if (!series) return "";

  const clampPct = (x) => Math.min(100, Math.max(0, Number(x) || 0));

  const rowsHtml = series
    .map((item) => {
      const neg = item.raw !== null && item.raw < 0;
      const valCls = neg ? " saldo-atividade__value--neg" : "";
      const wn = clampPct(item.widthPctNeg);
      const wp = clampPct(item.widthPctPos);
      const minNeg = item.raw !== null && wn > 0 ? "3px" : "0";
      const minPos = item.raw !== null && wp > 0 ? "3px" : "0";
      return `
    <div class="saldo-atividade__row">
      <span class="saldo-atividade__name">${escapeHtml(item.label)}</span>
      <div class="saldo-atividade__tracks">
        <div class="saldo-atividade__half saldo-atividade__half--neg">
          <div class="saldo-atividade__bar saldo-atividade__bar--neg saldo-atividade__stripes--negativo" style="width: ${wn}%; min-width: ${minNeg}" aria-hidden="true"></div>
        </div>
        <span class="saldo-atividade__axis" aria-hidden="true"></span>
        <div class="saldo-atividade__half saldo-atividade__half--pos">
          <div class="saldo-atividade__bar saldo-atividade__bar--pos ${item.stripeClass}" style="width: ${wp}%; min-width: ${minPos}" aria-hidden="true"></div>
        </div>
      </div>
      <span class="saldo-atividade__value${valCls}">${escapeHtml(item.display)}</span>
    </div>`;
    })
    .join("");

  return `
    <div class="saldo-atividade">
      <h4 class="saldo-atividade__title">Saldo por atividade econômica</h4>
      <div class="saldo-atividade__chart">${rowsHtml}</div>
    </div>`;
}

/** Ícone do cabeçalho = mesmo do item no menu lateral (MENU_META). */
function syncPageIdentIcon(sheetName) {
  const iconEl = document.getElementById("pageIdentIcon");
  if (!iconEl) return;
  const meta = MENU_META[sheetName] || {};
  const cls = meta.icon || "fa-solid fa-table-columns";
  iconEl.className = cls;
}

/** Textos curtos de identificação da página, alinhados ao conteúdo real da aba. */
function applyPageSubtitle() {
  const cols = state.dadosAba.length ? Object.keys(state.dadosAba[0]) : [];
  const hasAno = cols.includes("ano");

  syncPageIdentIcon(state.abaAtual);

  if (state.abaAtual === "analises") {
    els.descricaoPagina.textContent =
      "Sínteses por tema com textos de apoio à política de emprego e rendimento.";
    return;
  }

  if (state.abaAtual === "mapa_regioes") {
    els.descricaoPagina.textContent =
      "Mapa do Ceará com CAGED (estoque, admissões, desligamentos, saldos) e limite por município; filtros por mês/ano, região administrativa e município; pode sobrepor a Região no GeoJSON.";
    if (els.statusPagina) els.statusPagina.textContent = "Mapa + planilha CAGED";
    return;
  }

  if (state.abaAtual === "perfil_municipal") {
    els.descricaoPagina.textContent =
      "Perfil municipal no mapa do Ceará: camadas temáticas (servidores, Bolsa Família, BPC, MEI, aposentados, emprego, PIB per capita e Ceará Crédito), filtros por ano, região e município, KPIs e gráfico de evolução do PIB.";
    if (els.statusPagina) els.statusPagina.textContent = "Mapa + planilha perfil";
    return;
  }

  if (state.abaAtual === "autonomo_detalhado") {
    els.tituloPagina.textContent = "Intermediação dos serviços autônomos";
    els.descricaoPagina.textContent =
      "Últimos valores de serviços intermediados e volume financeiro, com série temporal nos gráficos.";
    return;
  }

  if (state.abaAtual === "series_historicas") {
    els.tituloPagina.textContent = "Intermediação";
    els.descricaoPagina.textContent =
      "Séries por indicador e ano: comparativos no topo e evolução abaixo.";
    return;
  }

  if (state.abaAtual === "programas") {
    els.descricaoPagina.textContent =
      "Cartões por programa, indicadores consolidados e participação nos programas.";
    return;
  }

  if (state.abaAtual === "projecoes") {
    els.descricaoPagina.textContent =
      "Indicadores e leituras de projeção a partir dos dados publicados.";
    return;
  }

  if (state.abaAtual === "capacitacao_detalhada") {
    els.descricaoPagina.textContent =
      "Participantes e totais por programa e eixo temático da capacitação.";
    return;
  }

  if (state.abaAtual === "autonomo_perfil") {
    els.descricaoPagina.textContent =
      "Distribuição do perfil dos autônomos atendidos por categoria.";
    return;
  }

  if (state.abaAtual === "autonomo_indicadores") {
    els.descricaoPagina.textContent =
      "Indicadores quantitativos da intermediação autônomo na base.";
    return;
  }

  if (state.abaAtual === "texto_apoio") {
    els.descricaoPagina.textContent =
      "Referências e textos de apoio institucional.";
    return;
  }

  if (state.abaAtual === "config") {
    els.descricaoPagina.textContent =
      "Parâmetros e chaves de configuração da base.";
    return;
  }

  if (state.abaAtual === "indicadores") {
    const ref = resolveHomeReferencia(state.dadosAba);
    const periodoTxt = formatHomePeriodoLabel(ref.year, ref.month);
    els.descricaoPagina.textContent = periodoTxt
      ? `Destaques do mercado de trabalho, demais indicadores e saldo por setor (CAGED) — referência ${periodoTxt}.`
      : "Destaques do mercado de trabalho, demais indicadores e saldo por setor (CAGED).";
    return;
  }

  els.descricaoPagina.textContent = hasAno
    ? "Indicadores ao longo do tempo: tendências, distribuições e rankings na base."
    : "Distribuições, rankings e leitura executiva dos registros desta aba.";
}

function renderKpis() {
  destroySeriesHistoricasKpiCharts();

  if (state.abaAtual === "analises" || isMunicipalMapPage()) {
    els.kpis.innerHTML = "";
    return;
  }

  const rows = state.dadosFiltrados || [];

  if (state.abaAtual === "programas") {
    let perfilRows = state.dadosPerfilParaProgramas || [];
    if (state.programaSelecionado) {
      const sel = state.programaSelecionado;
      perfilRows = perfilRows.filter((r) => {
        const prog = r.programa != null ? String(r.programa).trim() : "";
        const tema = r.tema != null ? String(r.tema).trim() : "";
        return prog === sel || tema === sel;
      });
    }

    const todosProgramas = !state.programaSelecionado;

    if (todosProgramas) {
      if (!rows.length) {
        els.kpis.className = "kpis sec sec-blue";
        els.kpis.innerHTML =
          "<div class='card'><span class='label'>Sem dados</span><span class='value'>-</span><span class='meta'>Nenhum indicador disponível nesta aba.</span></div>";
        return;
      }
      els.kpis.className = "kpis sec sec-blue kpis--programas";
      els.kpis.innerHTML = buildProgramasKpiHtmlCompact(rows);
      return;
    }

    if (!rows.length && !perfilRows.length) {
      els.kpis.className = "kpis sec sec-blue";
      els.kpis.innerHTML =
        "<div class='card'><span class='label'>Sem dados</span><span class='value'>-</span><span class='meta'>Nenhum indicador disponível nesta aba.</span></div>";
      return;
    }
    els.kpis.className = "kpis sec sec-blue kpis--programas";
    els.kpis.innerHTML = buildProgramasKpiHtmlFull(rows, perfilRows);
    return;
  }

  if (state.abaAtual === "autonomo_detalhado" && rows.length) {
    const cols = Object.keys(rows[0]);
    if (cols.includes("ano") && cols.includes("servicos") && cols.includes("volume_financeiro")) {
      const latest = pickLatestAutonomoRow(rows);
      if (latest) {
        const anoLabel = formatAnoExibicao(latest.ano);
        const servFmt = escapeHtml(
          isNumericLike(latest.servicos)
            ? formatNumber(toNumber(latest.servicos))
            : String(latest.servicos ?? "—")
        );
        const volFmt = escapeHtml(formatCellValue(latest.volume_financeiro, "volume_financeiro", latest));
        const metaObs = latest.observacao ? String(latest.observacao).trim() : "";
        const metaFonte = latest.fonte ? String(latest.fonte).trim() : "";
        const metaLine = [metaObs, metaFonte].filter(Boolean).join(" · ") || `Ano ${anoLabel}`;
        els.kpis.className = "kpis sec sec-blue";
        els.kpis.innerHTML = `
    <div class="card">
      <span class="label">Serviços intermediados (${anoLabel})</span>
      <span class="value">${servFmt}</span>
      <span class="meta">Último ano disponível na base</span>
    </div>
    <div class="card">
      <span class="label">Volume financeiro (${anoLabel})</span>
      <span class="value">${volFmt}</span>
      <span class="meta">${escapeHtml(metaLine)}</span>
    </div>`;
        return;
      }
    }
  }

  if (state.abaAtual === "series_historicas" && rows.length) {
    const cols = Object.keys(rows[0]);
    if (cols.includes("ano") && cols.includes("valor") && cols.includes("indicador")) {
      renderSeriesHistoricasKpiBars(rows);
      return;
    }
  }

  if (state.abaAtual === "capacitacao_detalhada" && rows.length) {
    const cols = Object.keys(rows[0]);
    if (cols.includes("participantes")) {
      const gc =
        GROUP_BY_SHEET.capacitacao_detalhada && cols.includes(GROUP_BY_SHEET.capacitacao_detalhada)
          ? GROUP_BY_SHEET.capacitacao_detalhada
          : ["programa", "categoria", "tema"].find((k) => cols.includes(k)) || "programa";
      const sum = sumParticipantesCapacitacao(rows, gc);
      els.kpis.className = "kpis sec sec-blue";
      els.kpis.innerHTML = `
    <div class="card">
      <span class="label">Total de participantes</span>
      <span class="value">${escapeHtml(formatNumber(sum))}</span>
      <span class="meta">Soma da coluna participantes (sem a linha Total)</span>
    </div>`;
      return;
    }
  }

  if (!rows.length) {
    els.kpis.className = "kpis sec sec-blue";
    els.kpis.innerHTML = "<div class='card'><span class='label'>Sem dados</span><span class='value'>-</span><span class='meta'>Nenhum indicador disponível nesta aba.</span></div>";
    return;
  }

  if (state.abaAtual === "indicadores") {
    const ref = resolveHomeReferencia(state.dadosAba);
    const periodoLabel = formatHomePeriodoLabel(ref.year, ref.month);
    const destaque = buildIndicadoresDestaqueCards(rows);
    const demais = buildIndicadoresDemaisCards(rows);
    const saldoAtividadeHtml = renderSaldoPorAtividadeHtml(rows);
    const demaisSubtitle = periodoLabel
      ? `Principais valores em destaque — ${periodoLabel}`
      : "Principais valores em destaque na base";
    els.kpis.className = "kpi-home sec sec-blue";
    els.kpis.innerHTML = `
      <div class="kpi-home__block kpi-home__block--destaque">
        <div class="kpi-home__heading">
          <span class="kpi-home__heading-icon" aria-hidden="true"><i class="fa-solid fa-bullseye"></i></span>
          <div>
            <h3 class="kpi-home__title">Mercado de trabalho em foco</h3>
            <p class="kpi-home__subtitle">Taxas de desemprego no Ceará e no Brasil${periodoLabel ? ` · ${escapeHtml(periodoLabel)}` : ""}</p>
          </div>
        </div>
        <div class="kpis kpis--home-destaque">
          ${destaque
            .map(
              (c) => `
            <div class="card card--home-featured ${c.cardClass}${c.missing ? " card--home-missing" : ""}">
              <div class="card__ico" aria-hidden="true"><i class="${c.icon}"></i></div>
              <span class="label">${escapeHtml(c.label)}</span>
              <span class="value">${escapeHtml(String(c.value))}</span>
              <span class="meta">${escapeHtml(c.meta)}</span>
            </div>`
            )
            .join("")}
        </div>
      </div>
      <div class="kpi-home__block kpi-home__block--demais">
        <div class="kpi-home__heading">
          <span class="kpi-home__heading-icon kpi-home__heading-icon--sec" aria-hidden="true"><i class="fa-solid fa-layer-group"></i></span>
          <div>
            <h3 class="kpi-home__title">Demais indicadores</h3>
            <p class="kpi-home__subtitle">${escapeHtml(demaisSubtitle)}</p>
          </div>
        </div>
        <div class="kpis kpis--home-demais">
          ${
            demais.length
              ? demais
                  .map(
                    (card) => `
            <div class="card card--home-demais">
              <div class="card__ico card__ico--sm" aria-hidden="true"><i class="fa-solid fa-chart-column"></i></div>
              <span class="label">${escapeHtml(card.label)}</span>
              <span class="value">${escapeHtml(String(card.value))}</span>
              <span class="meta">${escapeHtml(card.meta)}</span>
            </div>`
                  )
                  .join("")
              : `<div class="card card--home-demais card--home-empty"><span class="meta">Sem outros indicadores no ranking atual.</span></div>`
          }
        </div>
        ${saldoAtividadeHtml}
      </div>`;
    return;
  }

  els.kpis.className = "kpis sec sec-blue";
  let cards = buildKpiCards(rows);
  els.kpis.innerHTML = cards.map((card) => `
    <div class="card">
      <span class="label">${escapeHtml(String(card.label))}</span>
      <span class="value">${escapeHtml(String(card.value))}</span>
      <span class="meta">${escapeHtml(String(card.meta))}</span>
    </div>
  `).join("");
}

function aggregateByKey(rows, key, valueKey = "valor") {
  const map = {};
  rows.forEach((row) => {
    const label = row[key] || "Sem classificacao";
    map[label] = (map[label] || 0) + toNumber(row[valueKey] || 0);
  });
  return map;
}

function aggregateCountByKey(rows, key) {
  const map = {};
  rows.forEach((row) => {
    const label = row[key] || "Sem classificacao";
    map[label] = (map[label] || 0) + 1;
  });
  return map;
}

/** Linha agregada «Total» na coluna de grupo (ex.: programa = TOTAL). */
function isTotalGroupLabel(groupKey) {
  return normalizeTextForCompare(String(groupKey ?? "")) === "total";
}

function isTotalProgramRow(row, groupColumn) {
  const key = groupColumn && row[groupColumn] != null ? row[groupColumn] : row.programa;
  return isTotalGroupLabel(key);
}

/** Soma participantes excluindo linha TOTAL; se só existir TOTAL, usa essa linha. */
function sumParticipantesCapacitacao(rows, groupColumn) {
  const detail = rows.filter((r) => !isTotalProgramRow(r, groupColumn));
  const source = detail.length ? detail : rows;
  return source.reduce((acc, r) => {
    if (!isNumericLike(r.participantes)) return acc;
    return acc + toNumber(r.participantes);
  }, 0);
}

function mountChart(chartKey, selector, options) {
  if (state.charts[chartKey]) state.charts[chartKey].destroy();
  const themeOptions = {
    chart: {
      foreColor: "#1f2d78",
      toolbar: { show: false }
    },
    legend: {
      labels: { colors: "#1f2d78" }
    },
    dataLabels: {
      style: { colors: ["#1f2d78"] }
    },
    xaxis: {
      labels: { style: { colors: "#4a578f" } }
    },
    yaxis: {
      labels: { style: { colors: "#4a578f" } }
    }
  };
  state.charts[chartKey] = new ApexCharts(document.querySelector(selector), {
    ...themeOptions,
    ...options
  });
  state.charts[chartKey].render();
}

function pickLatestAutonomoRow(rows) {
  const sorted = [...rows]
    .filter((r) => r.ano != null && String(r.ano).trim() !== "")
    .sort((a, b) => toNumber(b.ano) - toNumber(a.ano));
  return sorted.length ? sorted[0] : null;
}

function sortAutonomoRowsByAno(rows) {
  return [...rows]
    .filter((r) => r.ano != null && String(r.ano).trim() !== "")
    .sort((a, b) => toNumber(a.ano) - toNumber(b.ano));
}

function textoObservacoesLinha(row) {
  if (!row || typeof row !== "object") return "";
  const obsPlural =
    row.observacoes != null && String(row.observacoes).trim() !== ""
      ? String(row.observacoes).trim()
      : "";
  if (obsPlural) return obsPlural;
  return row.observacao != null && String(row.observacao).trim() !== ""
    ? String(row.observacao).trim()
    : "";
}

/** Textos distintos da coluna observação(es), na ordem de aparição. */
function buildObservacoesNota(rows) {
  const vistos = new Set();
  const lista = [];
  (rows || []).forEach((r) => {
    const t = textoObservacoesLinha(r);
    if (!t || vistos.has(t)) return;
    vistos.add(t);
    lista.push(t);
  });
  return lista.join(" · ");
}

function clearChartFootnotes() {
  if (!els.grafico1Nota || !els.grafico2Nota) return;
  els.grafico1Nota.textContent = "";
  els.grafico1Nota.hidden = true;
  els.grafico2Nota.textContent = "";
  els.grafico2Nota.hidden = true;
}

function applyChartFootnotesIfApplicable(rows) {
  if (!rows.length || !els.grafico1Nota || !els.grafico2Nota) {
    clearChartFootnotes();
    return;
  }
  const keysLower = Object.keys(rows[0]).map((k) => k.toLowerCase());
  const temColunaObs =
    keysLower.includes("observacao") || keysLower.includes("observacoes");
  if (!temColunaObs) {
    clearChartFootnotes();
    return;
  }
  const corpo = buildObservacoesNota(rows);
  if (!corpo) {
    clearChartFootnotes();
    return;
  }
  const texto = `Observações: ${corpo}`;
  els.grafico1Nota.textContent = texto;
  els.grafico2Nota.textContent = texto;
  els.grafico1Nota.hidden = false;
  els.grafico2Nota.hidden = false;
}

function renderAutonomoDetalhadoCharts(rows) {
  const sorted = sortAutonomoRowsByAno(rows);
  const anos = sorted.map((r) => formatAnoExibicao(r.ano));
  const servicosData = sorted.map((r) => (isNumericLike(r.servicos) ? toNumber(r.servicos) : 0));
  const volData = sorted.map((r) =>
    isNumericLike(r.volume_financeiro) ? toNumber(r.volume_financeiro) : 0
  );

  els.tituloGrafico1.textContent = "Serviços intermediados por ano";
  mountChart("grafico1", "#grafico1", {
    chart: { type: "bar", background: "transparent", toolbar: { show: false } },
    series: [{ name: "Serviços", data: servicosData.length ? servicosData : [0] }],
    xaxis: { categories: anos.length ? anos : ["—"], labels: { style: { colors: "#4a578f" } } },
    yaxis: {
      labels: {
        formatter: (val) => formatNumber(val)
      }
    },
    tooltip: {
      y: {
        formatter: (val) => formatNumber(val)
      }
    },
    plotOptions: { bar: { horizontal: false, borderRadius: 6, columnWidth: "55%" } },
    colors: ["#2563eb"],
    dataLabels: { enabled: true }
  });

  els.tituloGrafico2.textContent = "Evolução do volume financeiro por ano";
  mountChart("grafico2", "#grafico2", {
    chart: { type: "line", background: "transparent", toolbar: { show: false }, zoom: { enabled: false } },
    series: [{ name: "Volume financeiro", data: volData.length ? volData : [0] }],
    xaxis: { categories: anos.length ? anos : ["—"], labels: { style: { colors: "#4a578f" } } },
    yaxis: {
      labels: {
        formatter: (val) => formatNumber(val, "R$")
      }
    },
    tooltip: {
      y: {
        formatter: (val) => formatNumber(val, "R$")
      }
    },
    stroke: { curve: "smooth", width: 3 },
    markers: { size: 5 },
    colors: ["#059669"]
  });

  applyChartFootnotesIfApplicable(rows);
}

function buildSeriesHistoricasSeriesData(filteredSubset) {
  if (!filteredSubset.length) {
    return { keys: [], anos: [], anoLabels: [], seriesData: [] };
  }
  const keys = [...new Set(filteredSubset.map(seriesHistoricasSeriesKey))].sort((a, b) =>
    a.localeCompare(b, "pt-BR")
  );
  const anos = [...new Set(filteredSubset.map((r) => toNumber(r.ano)))].sort((a, b) => a - b);
  const anoLabels = anos.map((a) => formatAnoExibicao(a));
  const seriesData = keys.map((key) => {
    const grp = filteredSubset.filter((r) => seriesHistoricasSeriesKey(r) === key);
    const byAno = {};
    grp.forEach((r) => {
      byAno[toNumber(r.ano)] = r;
    });
    return {
      name: key,
      data: anos.map((y) => {
        const cell = byAno[y];
        return cell && isNumericLike(cell.valor) ? toNumber(cell.valor) : null;
      })
    };
  });
  return { keys, anos, anoLabels, seriesData };
}

function renderSeriesHistoricasCharts(rows) {
  const filtered = rows.filter(
    (r) => r.ano != null && String(r.ano).trim() !== "" && isNumericLike(r.valor)
  );

  const filteredLine = filtered.filter(
    (r) => rowMatchesMetricKind(r, "vagas") || rowMatchesMetricKind(r, "colocados")
  );
  const filteredBar = filtered.filter(
    (r) => rowMatchesMetricKind(r, "atendidos") || rowMatchesMetricKind(r, "encaminhados")
  );

  const linePack = buildSeriesHistoricasSeriesData(filteredLine);
  const barPack = buildSeriesHistoricasSeriesData(filteredBar);

  if (!filtered.length) {
    els.tituloGrafico1.textContent = "Evolução temporal — Vagas e Colocados";
    els.tituloGrafico2.textContent = "Atendidos x Encaminhados por ano";
    mountChart("grafico1", "#grafico1", {
      chart: { type: "line", background: "transparent", toolbar: { show: false }, zoom: { enabled: false } },
      series: [{ name: "—", data: [0] }],
      xaxis: { categories: ["—"] },
      stroke: { curve: "smooth", width: 2 },
      colors: ["#94a3b8"]
    });
    mountChart("grafico2", "#grafico2", {
      chart: { type: "bar", background: "transparent", toolbar: { show: false } },
      series: [{ name: "—", data: [0] }],
      xaxis: { categories: ["—"] },
      plotOptions: { bar: { borderRadius: 6 } },
      colors: ["#94a3b8"]
    });
    applyChartFootnotesIfApplicable(rows);
    return;
  }

  const palette = ["#2563eb", "#059669", "#d97706", "#7c3aed", "#db2777", "#0d9488"];
  const fmtAxis = (val) => formatNumber(val);

  els.tituloGrafico1.textContent = "Evolução temporal — Vagas e Colocados";

  const { keys: keysL, anoLabels: anoLabelsL, seriesData: seriesLine } = linePack;

  if (!seriesLine.length || !keysL.length) {
    mountChart("grafico1", "#grafico1", {
      chart: { type: "line", background: "transparent", toolbar: { show: false }, zoom: { enabled: false } },
      series: [{ name: "Sem dados Vagas/Colocados", data: [0] }],
      xaxis: { categories: ["—"], labels: { style: { colors: "#4a578f" } } },
      stroke: { curve: "smooth", width: 2 },
      colors: ["#94a3b8"],
      yaxis: { labels: { formatter: fmtAxis, style: { colors: "#4a578f" } } },
      tooltip: { y: { formatter: () => "—" } }
    });
  } else {
    const numsDual =
      seriesLine.length === 2
        ? seriesLine.map((s) => {
            const nums = s.data.filter((v) => v != null && !Number.isNaN(v));
            return nums.length ? Math.max(...nums) : 0;
          })
        : [0, 0];
    const dual =
      seriesLine.length === 2 &&
      numsDual[0] > 0 &&
      numsDual[1] > 0 &&
      Math.max(numsDual[0], numsDual[1]) / Math.min(numsDual[0], numsDual[1]) > 25;

    const lineOpts = {
      chart: { type: "line", background: "transparent", toolbar: { show: false }, zoom: { enabled: false } },
      series: seriesLine,
      xaxis: {
        categories: anoLabelsL.length ? anoLabelsL : ["—"],
        labels: { style: { colors: "#4a578f" } }
      },
      stroke: { curve: "smooth", width: keysL.length > 3 ? 2 : 3 },
      markers: { size: keysL.length > 4 ? 3 : 5 },
      legend: { position: "bottom", horizontalAlign: "center", labels: { colors: "#1f2d78" } },
      colors: keysL.map((_, i) => palette[i % palette.length]),
      tooltip: {
        shared: true,
        intersect: false,
        y: {
          formatter: (val) => (val == null || Number.isNaN(val) ? "—" : formatNumber(val))
        }
      },
      dataLabels: { enabled: false }
    };

    if (dual) {
      lineOpts.yaxis = [
        {
          seriesName: seriesLine[0].name,
          labels: { formatter: fmtAxis, style: { colors: "#4a578f" } }
        },
        {
          opposite: true,
          seriesName: seriesLine[1].name,
          labels: { formatter: fmtAxis, style: { colors: "#4a578f" } }
        }
      ];
    } else {
      lineOpts.yaxis = {
        labels: { formatter: fmtAxis, style: { colors: "#4a578f" } }
      };
    }

    mountChart("grafico1", "#grafico1", lineOpts);
  }

  els.tituloGrafico2.textContent = "Atendidos x Encaminhados por ano";
  const { keys: keysB, anoLabels: anoLabelsB, seriesData: seriesBar } = barPack;
  const barrasMostrarRotulo =
    keysB.length > 0 && keysB.length <= 3 && barPack.anos.length <= 8;

  if (!seriesBar.length || !keysB.length) {
    mountChart("grafico2", "#grafico2", {
      chart: { type: "bar", background: "transparent", toolbar: { show: false } },
      series: [{ name: "Sem dados Atendidos/Encaminhados", data: [0] }],
      xaxis: { categories: ["—"], labels: { style: { colors: "#4a578f" } } },
      yaxis: { labels: { formatter: fmtAxis, style: { colors: "#4a578f" } } },
      plotOptions: { bar: { borderRadius: 6 } },
      colors: ["#94a3b8"]
    });
  } else {
    mountChart("grafico2", "#grafico2", {
      chart: { type: "bar", background: "transparent", toolbar: { show: false } },
      series: seriesBar,
      xaxis: {
        categories: anoLabelsB.length ? anoLabelsB : ["—"],
        labels: { style: { colors: "#4a578f" }, rotate: (barPack.anos || []).length > 8 ? -35 : 0 }
      },
      yaxis: {
        labels: { formatter: fmtAxis, style: { colors: "#4a578f" } }
      },
      plotOptions: {
        bar: {
          horizontal: false,
          columnWidth: keysB.length > 3 ? "72%" : "58%",
          borderRadius: 4
        }
      },
      legend: { position: "bottom", horizontalAlign: "center", labels: { colors: "#1f2d78" } },
      colors: keysB.map((_, i) => palette[i % palette.length]),
      tooltip: {
        y: { formatter: (val) => (val == null ? "—" : formatNumber(val)) }
      },
      dataLabels: { enabled: barrasMostrarRotulo }
    });
  }

  applyChartFootnotesIfApplicable(rows);
}

function renderCharts() {
  if (state.abaAtual === "indicadores" || state.abaAtual === "analises" || isMunicipalMapPage()) {
    if (els.labelGraficos) els.labelGraficos.style.display = "none";
    if (els.painelGraficos) els.painelGraficos.style.display = "none";
    ["grafico1", "grafico2"].forEach((key) => {
      if (state.charts[key]) {
        state.charts[key].destroy();
        state.charts[key] = null;
      }
    });
    clearChartFootnotes();
    return;
  }

  if (els.labelGraficos) els.labelGraficos.style.display = "";
  if (els.painelGraficos) els.painelGraficos.style.display = "";

  const rows = state.dadosFiltrados || [];
  const columns = rows.length ? Object.keys(rows[0]) : [];

  if (
    state.abaAtual === "autonomo_detalhado" &&
    rows.length &&
    columns.includes("ano") &&
    columns.includes("servicos") &&
    columns.includes("volume_financeiro")
  ) {
    renderAutonomoDetalhadoCharts(rows);
    return;
  }

  if (
    state.abaAtual === "series_historicas" &&
    rows.length &&
    columns.includes("ano") &&
    columns.includes("valor") &&
    columns.includes("indicador")
  ) {
    renderSeriesHistoricasCharts(rows);
    return;
  }

  clearChartFootnotes();

  const metricColumn = detectMetricColumn(rows, columns);
  const hasMetric = Boolean(metricColumn);
  const hasValor = metricColumn === "valor";
  const groupColumn =
    ["categoria", "perfil", "programa", "tema"].find((k) => columns.includes(k)) ||
    detectLabelColumn(columns);
  const labelColumn = detectLabelColumn(columns);
  const metricLabel = hasMetric ? normalizeCardTitle(metricColumn).toLowerCase() : "registros";
  const groupLabel = normalizeCardTitle(groupColumn).toLowerCase();
  const labelEntity = normalizeCardTitle(labelColumn).toLowerCase();

  const groupMap = hasMetric ? aggregateByKey(rows, groupColumn, metricColumn) : aggregateCountByKey(rows, groupColumn);
  let groupEntries = Object.entries(groupMap).sort((a, b) => b[1] - a[1]).slice(0, 8);
  if (state.abaAtual === "capacitacao_detalhada") {
    groupEntries = groupEntries.filter(([k]) => !isTotalGroupLabel(k));
  }
  const groupLabels = groupEntries.map((item) => item[0]);
  const groupValues = groupEntries.map((item) => item[1]);

  els.tituloGrafico1.textContent = hasMetric
    ? `Distribuição de ${metricLabel} por ${groupLabel}`
    : `Distribuição de registros por ${groupLabel}`;
  mountChart("grafico1", "#grafico1", {
    chart: { type: "donut", background: "transparent" },
    series: groupValues.length ? groupValues : [1],
    labels: groupLabels.length ? groupLabels : ["Sem dados"],
    legend: { position: "bottom" },
    dataLabels: { enabled: true },
    colors: ["#4f8bff", "#18c985", "#ffb020", "#ff5d5d", "#a57bff", "#4dd0e1", "#f06292", "#cddc39"]
  });

  let topRows = hasMetric
    ? [...rows].sort((a, b) => toNumber(b[metricColumn]) - toNumber(a[metricColumn])).slice(0, 8)
    : rows.slice(0, 8);
  if (state.abaAtual === "capacitacao_detalhada") {
    topRows = topRows.filter((r) => !isTotalProgramRow(r, groupColumn));
  }

  els.tituloGrafico2.textContent = hasMetric
    ? `Top ${pluralizePt(labelEntity)} por ${metricLabel}`
    : `Top ${pluralizePt(labelEntity)} por ocorrências`;
  mountChart("grafico2", "#grafico2", {
    chart: { type: "bar", background: "transparent", toolbar: { show: false } },
    series: [{
      name: hasMetric ? normalizeCardTitle(metricColumn) : "Indice",
      data: topRows.map((item, idx) => hasMetric ? toNumber(item[metricColumn]) : idx + 1)
    }],
    xaxis: {
      categories: topRows.map((item, idx) => item[labelColumn] || `Item ${idx + 1}`),
      labels: { rotate: -35, trim: true }
    },
    yaxis: {
      labels: {
        formatter: (val) => hasValor ? formatNumber(val, "R$") : formatNumber(val)
      }
    },
    tooltip: {
      y: {
        formatter: (val) => hasValor ? formatNumber(val, "R$") : formatNumber(val)
      }
    },
    plotOptions: { bar: { horizontal: false, borderRadius: 6 } },
    colors: ["#4f8bff"]
  });

  applyChartFootnotesIfApplicable(rows);
}

function renderGroupedSection() {
  const rows = state.dadosFiltrados || [];
  const columns = rows.length ? Object.keys(rows[0]) : [];

  if (state.abaAtual === "indicadores" || isMunicipalMapPage()) {
    els.secaoAgrupamentos.style.display = "none";
    els.agrupamentosGrid.className = "programas-grid";
    return;
  }

  if (state.abaAtual === "series_historicas") {
    els.secaoAgrupamentos.style.display = "none";
    els.agrupamentosGrid.className = "programas-grid";
    return;
  }

  const groupBy = resolveGroupKeyColumn(state.abaAtual, columns);
  const canRender = rows.length > 0 && columns.includes(groupBy);
  els.secaoAgrupamentos.style.display = canRender ? "block" : "none";
  if (!canRender) {
    els.agrupamentosGrid.className = "programas-grid";
    return;
  }

  if (state.abaAtual === "analises") {
    els.agrupamentosGrid.className = "programas-grid programas-grid--analises-dois";
    els.tituloAgrupamentos.textContent = "Analises por categoria";
    const grouped = {};
    rows.forEach((row) => {
      const key = row[groupBy] || `Sem ${groupBy}`;
      if (!grouped[key]) grouped[key] = [];
      grouped[key].push(row);
    });
    const sortedCat = Object.entries(grouped).sort((a, b) => a[0].localeCompare(b[0], "pt-BR"));
    els.agrupamentosGrid.innerHTML = sortedCat
      .map(([groupName, itens], catIdx) => {
        const sorted = [...itens].sort((a, b) => toNumber(a.id) - toNumber(b.id));
        const iconClass = analiseCategoriaIcon(groupName);
        const tone = catIdx % 6;
        return `
    <article class="programa-card programa-card--analise programa-card--analise-tone-${tone}">
      <h4 class="programa-card__heading-analise">
        <span class="programa-card__icon-wrap" aria-hidden="true"><i class="${iconClass}"></i></span>
        <span>${escapeHtml(groupName)}</span>
      </h4>
      ${sorted
        .map((item) => {
          const periodoFmt = formatPeriodoAnalise(item.periodo);
          const fonteTxt = String(item.fonte ?? "").trim();
          const desc = escapeHtml(item.descricao || "Sem descricao");
          const linhaPeriodo = periodoFmt
            ? `<p class="analise-meta"><span class="analise-meta-label">Período:</span> ${escapeHtml(periodoFmt)}</p>`
            : "";
          const linhaFonte = fonteTxt
            ? `<p class="analise-meta"><span class="analise-meta-label">Fonte:</span> ${escapeHtml(fonteTxt)}</p>`
            : "";
          return `
        <div class="analise-item">
          <p class="analise-desc">${desc}</p>
          ${linhaPeriodo}${linhaFonte}
        </div>`;
        })
        .join("")}
    </article>`;
      })
      .join("");
    return;
  }

  els.agrupamentosGrid.className = "programas-grid";

  els.tituloAgrupamentos.textContent = `${normalizeCardTitle(groupBy)} organizado por bloco`;
  const grouped = {};
  rows.forEach((row) => {
    const key = row[groupBy] || `Sem ${groupBy}`;
    if (!grouped[key]) grouped[key] = [];
    grouped[key].push(row);
  });

  els.agrupamentosGrid.innerHTML = Object.entries(grouped).map(([groupName, itens]) => `
    <article class="programa-card">
      <h4>${escapeHtml(groupName)}</h4>
      ${itens.map((item) => `
        <div class="programa-item">
          <strong>${item.indicador || item.programa || item.descricao || item.titulo || "Registro"}</strong>
          <span>${(() => {
            const itemCols = Object.keys(item);
            const metric = detectMetricColumn([item], itemCols);
            if (!metric || !isNumericLike(item[metric])) return "-";
            return formatCellValue(item[metric], metric, item);
          })()} ${item.unidade ? `(${item.unidade})` : ""}</span><br>
          <span>${item.periodo || formatAnoExibicao(item.ano) || "-"} | ${item.fonte || "-"}</span>
        </div>
      `).join("")}
    </article>
  `).join("");
}

function syncHomePeriodoFiltroUi() {
  const isHome = state.abaAtual === "indicadores";
  if (els.homePeriodoFiltroTop) {
    els.homePeriodoFiltroTop.classList.toggle("hidden", !isHome);
  }
  if (!isHome || !els.homeFiltroAno || !els.homeFiltroMes) return;

  const periods = listIndicadorMonthlyPeriods(state.dadosAba);
  if (!periods.length) {
    els.homeFiltroAno.innerHTML = "";
    els.homeFiltroMes.innerHTML = "";
    return;
  }

  const ref = resolveHomeReferencia(state.dadosAba);
  const years = [...new Set(periods.map((p) => p.year))].sort((a, b) => a - b);
  els.homeFiltroAno.innerHTML = years
    .map((y) => `<option value="${y}">${y}</option>`)
    .join("");
  if (ref.year != null) els.homeFiltroAno.value = String(ref.year);

  const yearSel = Number(els.homeFiltroAno.value) || ref.year;
  const monthsInYear = periods.filter((p) => p.year === yearSel);
  els.homeFiltroMes.innerHTML = monthsInYear
    .map((p) => `<option value="${p.month}">${MESES_NOME_PT[p.month - 1]}</option>`)
    .join("");
  const mesOk = monthsInYear.some((p) => p.month === ref.month);
  const mesVal = mesOk ? ref.month : monthsInYear[monthsInYear.length - 1]?.month;
  if (mesVal != null) els.homeFiltroMes.value = String(mesVal);

  if (
    ref.year != null &&
    ref.month != null &&
    (state.homeReferencia == null ||
      state.homeReferencia.ano !== ref.year ||
      state.homeReferencia.mes !== ref.month)
  ) {
    state.homeReferencia = { ano: ref.year, mes: ref.month };
  }
}

function applyViewFilters() {
  let rows = [...state.dadosAba];

  if (state.abaAtual === "programas") {
    const programas = [...new Set(state.dadosAba.map((row) => row.programa).filter(Boolean))];
    els.filtroProgramaTop.classList.remove("hidden");
    els.filtroProgramaWrap.classList.remove("hidden");
    const currentValue = els.filtroPrograma.value;
    els.filtroPrograma.innerHTML = `<option value="">Todos os programas</option>${programas
      .map((programa) => `<option value="${programa}">${programa}</option>`)
      .join("")}`;
    if (programas.includes(currentValue)) {
      els.filtroPrograma.value = currentValue;
      state.programaSelecionado = currentValue;
    } else {
      state.programaSelecionado = "";
    }
  } else {
    els.filtroProgramaTop.classList.add("hidden");
    els.filtroProgramaWrap.classList.add("hidden");
    els.filtroPrograma.value = "";
    state.programaSelecionado = "";
  }

  if (state.programaSelecionado) {
    rows = rows.filter((item) => item.programa === state.programaSelecionado);
  }

  if (state.abaAtual === "indicadores") {
    syncHomePeriodoFiltroUi();
    const ref = resolveHomeReferencia(state.dadosAba);
    rows = filterRowsByIndicadorPeriod(rows, ref.year, ref.month);
  }

  state.dadosFiltrados = rows;
}

function setDestaqueSectionsVisibility() {
  const hide = state.abaAtual === "analises" || isMunicipalMapPage();
  if (els.sectionKpisHeader) els.sectionKpisHeader.style.display = hide ? "none" : "";
  if (els.kpis) els.kpis.style.display = hide ? "none" : "";
}

/** Páginas municipais: subpáginas sob Página Inicial. */
function syncCeRegioesMapSection() {
  const wrap = els.secaoMapaCe;
  const mount = els.mapCeRegioes;
  if (!wrap || !mount) return;

  const show = isMunicipalMapPage();
  const isPerfil = state.abaAtual === "perfil_municipal";
  wrap.style.display = show ? "" : "none";
  wrap.hidden = !show;
  wrap.setAttribute("aria-hidden", show ? "false" : "true");
  wrap.classList.toggle("section-map-ce--perfil", isPerfil);
  const filtersTitle = wrap.querySelector(".map-ce-filters-wrap__title");
  if (filtersTitle) {
    filtersTitle.textContent = isPerfil ? "Filtros do perfil municipal" : "Filtros dos dados (CAGED)";
  }

  if (!show) return;
  if (typeof maplibregl === "undefined" || !window.ceRegioesMapApi) return;

  void window.ceRegioesMapApi.ensure(mount, CE_REGIOES_GEO_URL, els.mapCeLegend || null).then(() => {
    window.ceRegioesMapApi.setPageMode?.(state.abaAtual);
    window.ceRegioesMapApi.resize();
  });
}

function renderAll() {
  applyPageSubtitle();
  setDestaqueSectionsVisibility();
  applyViewFilters();
  renderKpis();
  renderCharts();
  renderGroupedSection();
  syncCeRegioesMapSection();
}

async function loadAba(sheetName) {
  if (sheetName === "perfil_social") {
    const fallback = state.abas.includes("programas")
      ? "programas"
      : state.abas.find((a) => a !== "perfil_social");
    if (fallback) return loadAba(fallback);
  }
  if (VIRTUAL_SHEETS.includes(sheetName)) {
    state.abaAtual = sheetName;
    state.dadosAba = [];
    state.dadosFiltrados = [];
    state.dadosPerfilParaProgramas = [];
    state.programaSelecionado = "";
    document.body.classList.remove("pagina-inicial");
    els.tituloPagina.textContent = (MENU_META[sheetName] && MENU_META[sheetName].label) || prettifyName(sheetName);
    els.descricaoPagina.textContent = "Página municipal preparada para camadas temáticas adicionais.";
    els.statusPagina.textContent = "Mapa base";
    renderMenu();
    renderAll();
    return;
  }
  try {
    const response = await fetch(`/api/abas/${sheetName}`);
    if (!response.ok) throw new Error("Falha ao carregar aba");
    const payload = await response.json();
    state.abaAtual = sheetName;
    state.dadosAba = payload.dados || [];
    state.dadosFiltrados = [];
    state.dadosPerfilParaProgramas = [];
    state.programaSelecionado = "";
    if (sheetName === "indicadores") {
      state.homeReferencia = null;
    }

    if (sheetName === "programas" && state.abas.includes("perfil_social")) {
      try {
        const pr = await fetch("/api/abas/perfil_social");
        if (pr.ok) {
          const pj = await pr.json();
          state.dadosPerfilParaProgramas = pj.dados || [];
        }
      } catch {
        state.dadosPerfilParaProgramas = [];
      }
    }

    document.body.classList.toggle("pagina-inicial", sheetName === "indicadores");

    els.tituloPagina.textContent = (MENU_META[sheetName] && MENU_META[sheetName].label) || prettifyName(sheetName);
    els.descricaoPagina.textContent = `Visualizacao completa da aba "${sheetName}" da planilha base.`;
    els.statusPagina.textContent = `${payload.total || 0} registros`;

    renderMenu();
    renderAll();
  } catch (error) {
    document.body.classList.remove("pagina-inicial");
    els.statusPagina.textContent = "Erro de carga";
    els.tituloPagina.textContent = "Falha ao carregar dados";
    els.descricaoPagina.textContent = "Verifique se o backend esta em execucao.";
    els.kpis.innerHTML = "<div class='card'><span class='label'>Erro</span><span class='value'>Falha de carga</span><span class='meta'>Verifique se o backend esta em execucao.</span></div>";
  }
}

async function init() {
  try {
    const response = await fetch(API_ABAS);
    if (!response.ok) throw new Error("Falha ao carregar abas");
    const payload = await response.json();
    state.abas = [...new Set([...(payload.abas || []), ...VIRTUAL_SHEETS])];
    if (!state.abas.length) throw new Error("Nenhuma aba disponivel");
    const initialSheet = state.abas.includes("indicadores") ? "indicadores" : state.abas[0];
    els.filtroPrograma.addEventListener("change", () => {
      state.programaSelecionado = els.filtroPrograma.value;
      renderAll();
    });
    if (els.homeFiltroAno) {
      els.homeFiltroAno.addEventListener("change", () => {
        const ano = Number(els.homeFiltroAno.value);
        const periods = listIndicadorMonthlyPeriods(state.dadosAba).filter((p) => p.year === ano);
        const latestMes = periods.length ? periods[periods.length - 1].month : null;
        state.homeReferencia = { ano, mes: latestMes };
        renderAll();
      });
    }
    if (els.homeFiltroMes) {
      els.homeFiltroMes.addEventListener("change", () => {
        state.homeReferencia = {
          ano: Number(els.homeFiltroAno?.value),
          mes: Number(els.homeFiltroMes.value)
        };
        renderAll();
      });
    }
    els.menuToggle.addEventListener("click", toggleMenu);
    if (els.menuEdgeOpen) {
      els.menuEdgeOpen.addEventListener("click", () => openMenu());
    }
    els.menuOverlay.addEventListener("click", closeMenu);
    document.addEventListener("keydown", (event) => {
      if (event.key === "Escape") closeMenu();
    });
    applySidebarModeForViewport();
    window.addEventListener("resize", () => {
      applySidebarModeForViewport();
      if (isMunicipalMapPage()) window.ceRegioesMapApi?.resize();
    });
    await loadAba(initialSheet);
  } catch (error) {
    els.statusPagina.textContent = "Erro de carga";
    els.tituloPagina.textContent = "Nao foi possivel iniciar";
    els.descricaoPagina.textContent = "A API nao retornou as abas da planilha.";
  }
}

init();
