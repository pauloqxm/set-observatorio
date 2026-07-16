const CE_REGIOES_GEO_URL = "/static/geo/ce_regioes.geojson";

const MAP_TABS = {
  dados_caged:      { label: "Dados CAGED",      icon: "fa-solid fa-map-location-dot" },
  perfil_municipal: { label: "Perfil Municipal", icon: "fa-solid fa-city" },
  perfil_empresas:  { label: "Perfil Empresas",  icon: "fa-solid fa-building" },
  ceara_credi:      { label: "Ceará Credi",      icon: "fa-solid fa-money-bill-transfer" },
  dinheiro_na_mao:  { label: "Dinheiro na Mão",  icon: "fa-solid fa-hand-holding-dollar" },
  vai_vem:          { label: "Vai Vem",          icon: "fa-solid fa-bus" },
  caged_grupamentos:{ label: "CAGED Grupamentos", icon: "fa-solid fa-industry" },
  seguro_desemprego: { label: "Seguro Desemprego", icon: "fa-solid fa-shield-halved" },
  qualificacao:      { label: "Qualificação",      icon: "fa-solid fa-graduation-cap" },
  series_historicas:{ label: "Intermediação",    icon: "fa-solid fa-chart-line" },
};

/** Pai → subabas exibidas aninhadas abaixo dele no menu de mapas. */
const MAP_MENU_GROUP_CHILDREN = {
  dados_caged: ["caged_grupamentos"],
};
/** Rótulo específico da subaba no menu (sobrescreve o label de MAP_TABS). */
const MAP_MENU_SUB_LABELS = {
  caged_grupamentos: "Por grupamento",
};
/** Abas que só aparecem como subitem (não repetem no nível principal). */
const MAP_MENU_NESTED_ITEMS = new Set(
  Object.values(MAP_MENU_GROUP_CHILDREN).flat()
);

const PROFILE_LAYERS_BY_MODE = {
  perfil_empresas: new Set([
    "pib_per_capta",
    "mun_simples",
    "empresa_grupamento",
    "empresas_vinculos",
    "vinculo_escolaridade",
    "vinculo_sexo",
  ]),
  ceara_credi: new Set(["ceara_cred"]),
  series_historicas: new Set([
    "intermediacao_atendimentos",
    "intermediacao_autonomos",
    "intermediacao_cadastros",
    "intermediacao_colocados",
    "intermediacao_egressos",
    "intermediacao_empresas",
    "intermediacao_encaminhados",
    "intermediacao_pcd",
    "intermediacao_vagas",
    "intermediacao_visitas",
  ]),
};

const PAGE_META = {
  dados_caged: {
    title: "Dados CAGED",
    desc: "Painel interativo de monitoramento do mercado formal de trabalho cearense, com dados do CAGED desagregados por município — estoque de empregos, admissões, desligamentos e saldo líquido. Permite filtragem por competência (mês/ano), região administrativa e município, com visualização georreferenciada sobre o mapa do Ceará.",
    status: "Mapa + planilha CAGED",
  },
  perfil_municipal: {
    title: "Perfil Municipal",
    desc: "Perfil municipal no mapa do Ceará: camadas temáticas (servidores, Bolsa Família, BPC, MEI, aposentados e emprego), filtros por ano, região e município, KPIs e gráficos comparativos.",
    status: "Mapa + planilha perfil",
  },
  perfil_empresas: {
    title: "Perfil Empresas",
    desc: "Perfil empresarial no mapa do Ceará: PIB per capita, Município Simples, empresas por grupamento e vínculos, vínculo por escolaridade e sexo, com filtros por ano, região e município.",
    status: "Mapa + perfil empresas",
  },
  ceara_credi: {
    title: "Ceará Credi",
    desc: "Mapa do programa Ceará Credi: cadastradas, em atendimento, aprovadas e valor liberado por município, com filtros por ano, região e município, KPIs e gráficos de evolução anual.",
    status: "Mapa + Ceará Credi",
  },
  dinheiro_na_mao: {
    title: "Dinheiro na Mão",
    desc: "Operações do programa Dinheiro na Mão por município: quantidade, valor principal e juros, com filtros por data de desembolso/contrato, região e município.",
    status: "Mapa + planilha Dinheiro na Mão",
  },
  vai_vem: {
    title: "Vai Vem Trabalhador",
    desc: "Indicadores do programa Vai Vem Trabalhador na RMF e RMC: status dos beneficiários, situação dos cartões e solicitações por região, com filtros por município e região metropolitana.",
    status: "Mapa + planilha Vai Vem",
  },
  caged_grupamentos: {
    title: "CAGED por Grande Grupamento",
    desc: "Dados do CAGED desagregados por grande grupamento econômico (Agropecuária, Comércio, Construção, Indústria, Serviços), com filtros por referência, região e município e mapa graduado por setor.",
    status: "Mapa + planilha CAGED grupamentos",
  },
  seguro_desemprego: {
    title: "Seguro Desemprego",
    desc: "Requerimentos de Seguro Desemprego por município e quinzena de competência, com filtros por ano, quinzena, região administrativa e município, e mapa graduado por volume de requerentes.",
    status: "Mapa + planilha Seguro Desemprego",
  },
  qualificacao: {
    title: "Qualificação",
    desc: "Cursos de qualificação profissional no Ceará: vagas ofertadas, inscritos, desistentes e concludentes por município, com filtros por data de término, executora, região e município.",
    status: "Mapa + planilha Qualificação",
  },
  series_historicas: {
    title: "Intermediação",
    desc: "Mapa de intermediação dos serviços do IDT: unidades, servidores municipais e camadas de contexto territorial.",
    status: "Mapa + camadas territoriais",
  },
};

const state = { abaAtual: "dados_caged", abaFiltrosSincronizados: null };

const els = {
  sidebar:         document.getElementById("sidebar"),
  menuToggle:      document.getElementById("menuToggle"),
  menuEdgeOpen:    document.getElementById("menuEdgeOpen"),
  menuOverlay:     document.getElementById("menuOverlay"),
  menuAbas:        document.getElementById("menuAbas"),
  tituloPagina:    document.getElementById("tituloPagina"),
  descricaoPagina: document.getElementById("descricaoPagina"),
  statusPagina:    document.getElementById("statusPagina"),
  pageIdentIcon:   document.getElementById("pageIdentIcon"),
  secaoMapaCe:     document.getElementById("secaoMapaCe"),
  mapCeRegioes:    document.getElementById("mapCeRegioes"),
  mapCeLegend:     document.getElementById("mapCeLegend"),
};

function isMobileSidebarViewport() {
  return typeof window.matchMedia === "function" &&
    window.matchMedia("(max-width: 1024px)").matches;
}

function updateMenuToggleIcon() {
  if (!els.menuToggle || !els.sidebar) return;
  const open = els.sidebar.classList.contains("open");
  document.body.classList.toggle("sidebar-open", open && !isMobileSidebarViewport());
  const icon = els.menuToggle.querySelector("i");
  if (icon) icon.className = open ? "fa-solid fa-xmark" : "fa-solid fa-bars";
  els.menuToggle.setAttribute("aria-label", open ? "Fechar menu lateral" : "Abrir menu lateral");
}

function openMenu() {
  if (!els.sidebar) return;
  els.sidebar.classList.add("open");
  if (isMobileSidebarViewport()) els.menuOverlay?.classList.add("show");
  updateMenuToggleIcon();
  requestAnimationFrame(() => { window.ceRegioesMapApi?.resize(); });
}

function closeMenu() {
  if (!els.sidebar) return;
  els.sidebar.classList.remove("open");
  els.menuOverlay?.classList.remove("show");
  updateMenuToggleIcon();
  requestAnimationFrame(() => { window.ceRegioesMapApi?.resize(); });
}

function toggleMenu() {
  if (els.sidebar?.classList.contains("open")) closeMenu();
  else openMenu();
}

function applySidebarModeForViewport() {
  if (!els.sidebar) return;
  if (isMobileSidebarViewport()) {
    els.sidebar.classList.remove("open");
    els.menuOverlay?.classList.remove("show");
  } else {
    els.sidebar.classList.add("open");
    els.menuOverlay?.classList.remove("show");
  }
  updateMenuToggleIcon();
  window.ceRegioesMapApi?.resize();
}

function syncProfileLayerSelectForMode(sheetName) {
  const sel = document.getElementById("mapProfileLayerStyle");
  if (!sel) return;
  const allowed = PROFILE_LAYERS_BY_MODE[sheetName];
  const empresaLayers = PROFILE_LAYERS_BY_MODE.perfil_empresas;
  for (const opt of sel.options) {
    const isIntLayer = opt.value.startsWith("intermediacao_");
    const isCearaCred = opt.value === "ceara_cred";
    const isEmpresaLayer = empresaLayers?.has(opt.value);
    if (sheetName === "vai_vem") {
      opt.hidden = true;
      continue;
    }
    if (sheetName === "caged_grupamentos") {
      opt.hidden = true;
      continue;
    }
    if (sheetName === "seguro_desemprego") {
      opt.hidden = true;
      continue;
    }
    if (sheetName === "qualificacao" || sheetName === "dinheiro_na_mao") {
      opt.hidden = true;
      continue;
    }
    if (allowed) {
      opt.hidden = !allowed.has(opt.value);
    } else if (sheetName === "perfil_municipal") {
      opt.hidden = isIntLayer || isCearaCred || isEmpresaLayer;
    } else {
      opt.hidden = isIntLayer;
    }
  }
  if (allowed && !allowed.has(sel.value)) {
    sel.value = [...allowed][0];
  } else if (!allowed && sel.value.startsWith("intermediacao_")) {
    const first = Array.from(sel.options).find((o) => !o.hidden);
    if (first) sel.value = first.value;
  } else if (sheetName === "perfil_municipal" && (sel.value === "ceara_cred" || empresaLayers?.has(sel.value))) {
    const first = Array.from(sel.options).find((o) => !o.hidden);
    if (first) sel.value = first.value;
  }
}

function syncPageHeader() {
  const meta = PAGE_META[state.abaAtual] || {};
  if (els.tituloPagina)    els.tituloPagina.textContent    = meta.title  || state.abaAtual;
  if (els.descricaoPagina) els.descricaoPagina.textContent = meta.desc   || "";
  if (els.statusPagina)    els.statusPagina.textContent    = meta.status || "Mapa";
  if (els.pageIdentIcon) {
    const tabMeta = MAP_TABS[state.abaAtual] || {};
    els.pageIdentIcon.className = tabMeta.icon || "fa-solid fa-map";
  }
}

function renderMenu() {
  if (!els.menuAbas) return;
  const html = Object.entries(MAP_TABS)
    .filter(([sheetName]) => !MAP_MENU_NESTED_ITEMS.has(sheetName))
    .map(([sheetName, meta]) => {
      const children = (MAP_MENU_GROUP_CHILDREN[sheetName] || []).filter((c) => MAP_TABS[c]);
      if (!children.length) {
        return `
    <button type="button" class="menu-item ${state.abaAtual === sheetName ? "active" : ""}" data-aba="${sheetName}">
      <i class="${meta.icon}"></i>
      <span>${meta.label}</span>
    </button>`;
      }

      const parentActive = state.abaAtual === sheetName;
      const groupHasActiveChild = children.some((c) => state.abaAtual === c);
      const parentClass = [
        "menu-item",
        "menu-item--parent",
        parentActive ? "active" : "",
        groupHasActiveChild ? "menu-item--within-group-active" : "",
      ]
        .filter(Boolean)
        .join(" ");

      const subHtml = children
        .map((child) => {
          const cm = MAP_TABS[child] || {};
          const cl = MAP_MENU_SUB_LABELS[child] || cm.label || child;
          return `
      <button type="button" class="menu-item menu-item--sub ${state.abaAtual === child ? "active" : ""}" data-aba="${child}">
        <i class="${cm.icon || "fa-solid fa-circle"}"></i>
        <span>${cl}</span>
      </button>`;
        })
        .join("");

      return `
    <div class="menu-group">
      <button type="button" class="${parentClass}" data-aba="${sheetName}">
        <i class="${meta.icon}"></i>
        <span>${meta.label}</span>
      </button>
      <div class="menu-sub">${subHtml}</div>
    </div>`;
    })
    .join("");
  els.menuAbas.innerHTML = html;
  els.menuAbas.querySelectorAll(".menu-item").forEach((btn) => {
    btn.addEventListener("click", () => {
      loadTab(btn.dataset.aba);
      if (window.innerWidth <= 1024) closeMenu();
    });
  });
}

/** IDs dos selects multi-valor de filtro que existem no wrapper de filtros do mapa. */
const MAP_FILTER_SELECT_IDS = [
  "mapFilterAno",
  "mapFilterMes",
  "mapFilterRegiao",
  "mapFilterMunicipio",
  "vvFilterAno",
  "vvFilterMes",
  "mapFilterVaiVemRegiao",
  "sdFilterAno",
  "sdFilterQuinzena",
];
/** IDs dos seletores de ordenação (15 maiores/menores) usados nos rankings. */
const MAP_RANK_ORDER_SELECT_IDS = ["mapRankOrder", "cgRankOrder", "sdRankOrder", "qfRankOrder", "dnmRankOrder"];

/** Mostra/esconde cada grupo de filtro conforme sua relação com a aba ativa (data-filter-tabs). */
function syncFilterVisibilityForTab(sheetName) {
  const wrap = els.secaoMapaCe;
  if (!wrap) return;
  wrap.querySelectorAll(".map-ce-filter-group[data-filter-tabs]").forEach((group) => {
    const tabs = (group.dataset.filterTabs || "").split(/\s+/).filter(Boolean);
    group.hidden = !tabs.includes(sheetName);
  });
}

/** Reinicia a seleção de todos os filtros (multi-selects, busca de município e ordenação) ao trocar de aba. */
function resetMapFilterSelections() {
  MAP_FILTER_SELECT_IDS.forEach((id) => {
    const sel = document.getElementById(id);
    if (!sel) return;
    Array.from(sel.options).forEach((opt) => { opt.selected = false; });
  });
  const search = document.getElementById("mapFilterMunSearch");
  if (search) search.value = "";
  MAP_RANK_ORDER_SELECT_IDS.forEach((id) => {
    const sel = document.getElementById(id);
    if (sel && sel.options.length) sel.selectedIndex = 0;
  });
}

function syncMapSection() {
  const wrap = els.secaoMapaCe;
  const mount = els.mapCeRegioes;
  if (!wrap || !mount) return;

  if (state.abaAtual !== state.abaFiltrosSincronizados) {
    resetMapFilterSelections();
    state.abaFiltrosSincronizados = state.abaAtual;
  }
  syncFilterVisibilityForTab(state.abaAtual);

  const isPerfil        = state.abaAtual === "perfil_municipal";
  const isPerfilEmpresas = state.abaAtual === "perfil_empresas";
  const isCearaCredi    = state.abaAtual === "ceara_credi";
  const isDinheiroNaMao = state.abaAtual === "dinheiro_na_mao";
  const isVaiVem        = state.abaAtual === "vai_vem";
  const isCagedGrup     = state.abaAtual === "caged_grupamentos";
  const isSeguroDesemp  = state.abaAtual === "seguro_desemprego";
  const isQualificacao  = state.abaAtual === "qualificacao";
  const isIntermediacao = state.abaAtual === "series_historicas";
  const isPerfilMode    = isPerfil || isPerfilEmpresas || isCearaCredi || isVaiVem || isIntermediacao;

  wrap.querySelectorAll(".map-ce-layer-row__toggle-wrap--qualificacao-cursos").forEach((control) => {
    control.hidden = !isQualificacao;
    control.setAttribute("aria-hidden", isQualificacao ? "false" : "true");
    const button = control.querySelector("button");
    if (button) {
      button.disabled = !isQualificacao;
      if (!isQualificacao) button.setAttribute("aria-pressed", "false");
    }
  });

  wrap.classList.toggle("section-map-ce--perfil",         isPerfilMode);
  wrap.classList.toggle("section-map-ce--perfil-empresas", isPerfilEmpresas);
  wrap.classList.toggle("section-map-ce--ceara-credi",    isCearaCredi);
  wrap.classList.toggle("section-map-ce--dinheiro-na-mao", isDinheiroNaMao);
  wrap.classList.toggle("section-map-ce--vai-vem",        isVaiVem);
  wrap.classList.toggle("section-map-ce--caged-grupamentos", isCagedGrup);
  wrap.classList.toggle("section-map-ce--seguro-desemprego", isSeguroDesemp);
  wrap.classList.toggle("section-map-ce--qualificacao",   isQualificacao);
  wrap.classList.toggle("section-map-ce--intermediacao",  isIntermediacao);

  const filtersTitle = wrap.querySelector(".map-ce-filters-wrap__title");
  if (filtersTitle) {
    filtersTitle.textContent = isPerfil
      ? "Filtros do perfil municipal"
      : isPerfilEmpresas
        ? "Filtros do perfil empresas"
        : isCearaCredi
          ? "Filtros do Ceará Credi"
          : isDinheiroNaMao
            ? "Filtros do Dinheiro na Mão (data de desembolso/contrato)"
          : isVaiVem
            ? "Filtros do Vai Vem (data da solicitação)"
            : isCagedGrup
              ? "Filtros do CAGED por grupamento (referência)"
            : isSeguroDesemp
              ? "Filtros do Seguro Desemprego (competência quinzenal)"
            : isQualificacao
              ? "Filtros da Qualificação (data de término)"
            : isIntermediacao
            ? "Filtros da intermediação"
            : "Filtros dos dados (CAGED)";
  }

  syncProfileLayerSelectForMode(state.abaAtual);

  if (typeof window.ceRegioesMapApi?.setPageMode === "function") {
    window.ceRegioesMapApi.setPageMode(state.abaAtual);
  }

  window.vaiVemApi?.onPageActivate?.();
  window.cagedGrupamentosApi?.onPageActivate?.();
  window.seguroDesempregoApi?.onPageActivate?.();
  window.qualificacaoApi?.onPageActivate?.();
  window.dinheiroNaMaoApi?.onPageActivate?.();

  if (!isVaiVem) {
    window.vaiVemApi?.restoreFullMunicipioFilter?.();
  }
  if (!isCagedGrup) {
    window.cagedGrupamentosApi?.restoreFullMunicipioFilter?.();
  }
  if (!isSeguroDesemp) {
    window.seguroDesempregoApi?.restoreFullMunicipioFilter?.();
  }
  if (!isQualificacao) {
    window.qualificacaoApi?.restoreFullMunicipioFilter?.();
  }
  if (!isDinheiroNaMao) {
    window.dinheiroNaMaoApi?.restoreFullMunicipioFilter?.();
  }

  if (typeof maplibregl === "undefined" || !window.ceRegioesMapApi) return;

  void window.ceRegioesMapApi
    .ensure(mount, CE_REGIOES_GEO_URL, els.mapCeLegend || null)
    .then(() => {
      window.ceRegioesMapApi.setPageMode?.(state.abaAtual);
      window.ceRegioesMapApi.resize();
    });
}

function loadTab(sheetName) {
  if (!MAP_TABS[sheetName]) return;
  state.abaAtual = sheetName;
  const url = new URL(location.href);
  url.searchParams.set("aba", sheetName);
  history.replaceState(null, "", url);
  renderMenu();
  syncPageHeader();
  syncMapSection();
}

function init() {
  const params   = new URLSearchParams(location.search);
  const abaParam = params.get("aba");
  if (abaParam && MAP_TABS[abaParam]) state.abaAtual = abaParam;

  if (els.menuToggle)  els.menuToggle.addEventListener("click", toggleMenu);
  if (els.menuEdgeOpen) els.menuEdgeOpen.addEventListener("click", openMenu);
  if (els.menuOverlay) els.menuOverlay.addEventListener("click", closeMenu);
  document.addEventListener("keydown", (e) => { if (e.key === "Escape") closeMenu(); });

  applySidebarModeForViewport();
  window.addEventListener("resize", () => {
    applySidebarModeForViewport();
    window.ceRegioesMapApi?.resize();
  });

  renderMenu();
  syncPageHeader();
  syncMapSection();
}

init();
