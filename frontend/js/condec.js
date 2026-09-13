/*
 * Aba CONDEC — orquestracao da UI (portado de 3_rais_emprego/js/painel.js).
 * A carga e sob demanda: `condecApi.onPageActivate()` dispara na primeira
 * ativacao da aba, nao no DOMContentLoaded.
 *
 * Gerado por scripts/condec_portar.py.
 */
/**
 * Orquestração do painel: monta os filtros, dispara o recálculo e desenha
 * indicadores, tabela com drill-down e exportação.
 *
 * A tabela ordena índices e só materializa objetos para a página visível, porque
 * o recorte sem filtro tem quase 100 mil empresas e 112 mil estabelecimentos.
 */
(function () {
  const D = window.CondecDados;
  const G = window.CondecGraficos;
  const M = window.CondecMapa;
  const fmt = G.fmt;

  const POR_PAGINA = 50;

  const vista = {
    idx: new Int32Array(0),
    grupos: [],
    modo: "empresa",
    pagina: 0,
    totalPaginas: 1,
    ordem: { chave: "vinculos", dir: "desc" },
    abertas: new Set(),
  };

  const rankingVista = {
    pagina: 0,
    porPagina: 15,
    linhas: [],
    formatar: (v) => String(v),
  };

  const comparacao = {
    raizes: [],
    automatico: true,
    ordem: "maiores",
    sugestaoAtiva: -1,
  };

  const COMP_MAX = 6;

  const el = (id) => document.getElementById(id);

  // ------------------------------------------------------------- multiselect

  const multis = [];

  function criarMulti(container, opcoes) {
    const { rotulo, itens, conjunto, comBusca, aoMudar, obrigatorios, destaques, padrao, minimo, rotuloLimpar } = opcoes;
    const fixos = obrigatorios || new Set();
    const marca = destaques || new Set();
    const piso = minimo || 0;

    const botao = document.createElement("button");
    botao.type = "button";
    botao.className = "condec-multi__botao";
    botao.innerHTML = `<span class="condec-multi__texto"></span><span class="condec-multi__seta">▾</span>`;

    const painel = document.createElement("div");
    painel.className = "condec-multi__painel";

    let busca = null;
    if (comBusca) {
      busca = document.createElement("input");
      busca.type = "search";
      busca.className = "condec-multi__busca";
      busca.placeholder = "Buscar…";
      painel.appendChild(busca);
    }

    const lista = document.createElement("div");
    lista.className = "condec-multi__lista";
    painel.appendChild(lista);

    const rodape = document.createElement("div");
    rodape.className = "condec-multi__rodape";
    rodape.innerHTML = `<button type="button" class="condec-multi__acao" data-acao="todos">Selecionar todos</button>
      <button type="button" class="condec-multi__acao" data-acao="limpar">${rotuloLimpar || "Limpar"}</button>`;
    painel.appendChild(rodape);

    container.appendChild(botao);
    container.appendChild(painel);

    itens.forEach((item) => {
      const linha = document.createElement("label");
      linha.className = "condec-multi__opcao";
      linha.dataset.texto = item.rotulo.toLowerCase();
      const caixa = document.createElement("input");
      caixa.type = "checkbox";
      caixa.value = String(item.valor);
      const texto = document.createElement("span");
      texto.textContent = item.rotulo;
      texto.title = item.rotulo;
      if (marca.has(item.valor)) {
        linha.classList.add("condec-multi__opcao--destaque");
        texto.title = `${item.rotulo} (mais nova da base)`;
      }
      if (fixos.has(item.valor)) {
        linha.classList.add("multi__opcao--fixa");
        caixa.title = "Sempre selecionada";
        texto.title = `${item.rotulo} (sempre selecionada)`;
      }
      linha.appendChild(caixa);
      linha.appendChild(texto);
      lista.appendChild(linha);
    });

    function igualAoPadrao() {
      const alvo = padrao && padrao.size ? padrao : fixos;
      if (!alvo.size) return conjunto.size === 0;
      if (conjunto.size !== alvo.size) return false;
      let ok = true;
      alvo.forEach((v) => {
        if (!conjunto.has(v)) ok = false;
      });
      return ok;
    }

    function sincronizarRotulo() {
      const alvo = botao.querySelector(".condec-multi__texto");
      if (conjunto.size === 0) {
        alvo.textContent = rotulo;
        botao.classList.remove("condec-is-filtrado");
      } else if (conjunto.size === 1) {
        const unico = itens.find((i) => conjunto.has(i.valor));
        alvo.textContent = unico ? unico.rotulo : "1 selecionado";
        botao.classList.toggle("condec-is-filtrado", !igualAoPadrao());
      } else {
        const nomes = itens.filter((i) => conjunto.has(i.valor)).map((i) => i.rotulo);
        alvo.textContent = nomes.length <= 3 ? nomes.join(", ") : `${conjunto.size} selecionados`;
        botao.classList.add("condec-is-filtrado");
      }
      botao.title = alvo.textContent;
    }

    function sincronizarCaixas() {
      lista.querySelectorAll("input").forEach((caixa) => {
        caixa.checked = conjunto.has(Number(caixa.value));
      });
      sincronizarRotulo();
    }

    botao.addEventListener("click", (ev) => {
      ev.stopPropagation();
      const aberto = container.classList.contains("condec-is-aberto");
      fecharTodos();
      if (!aberto) {
        container.classList.add("condec-is-aberto");
        if (busca) busca.focus();
      }
    });

    painel.addEventListener("click", (ev) => ev.stopPropagation());

    lista.addEventListener("change", (ev) => {
      const caixa = ev.target;
      if (!caixa.matches("input")) return;
      const valor = Number(caixa.value);
      if (caixa.checked) conjunto.add(valor);
      else if (fixos.has(valor) || (piso && conjunto.size <= piso)) caixa.checked = true;
      else conjunto.delete(valor);
      sincronizarRotulo();
      aoMudar();
    });

    rodape.addEventListener("click", (ev) => {
      const acao = ev.target.dataset.acao;
      if (!acao) return;
      Array.from(lista.querySelectorAll(".condec-multi__opcao"))
        .filter((l) => l.style.display !== "none")
        .forEach((l) => {
          const valor = Number(l.querySelector("input").value);
          if (acao === "todos") conjunto.add(valor);
          else if (padrao && padrao.size) {
            /* o reset do recorte de referência volta ao padrão, não esvazia a lista */
          } else if (!fixos.has(valor)) conjunto.delete(valor);
        });
      if (acao === "limpar" && padrao && padrao.size) {
        conjunto.clear();
        padrao.forEach((v) => conjunto.add(v));
      }
      sincronizarCaixas();
      aoMudar();
    });

    if (busca) {
      busca.addEventListener("input", () => {
        const termo = busca.value.trim().toLowerCase();
        lista.querySelectorAll(".condec-multi__opcao").forEach((l) => {
          l.style.display = !termo || l.dataset.texto.indexOf(termo) >= 0 ? "" : "none";
        });
      });
    }

    const controle = { container, sincronizarCaixas };
    multis.push(controle);
    sincronizarRotulo();
    return controle;
  }

  function fecharTodos() {
    multis.forEach((m) => m.container.classList.remove("condec-is-aberto"));
  }

  // ---------------------------------------------------------------- filtros

  function montarFiltros() {
    const dim = D.dim;
    const porNome = (a, b) => a.rotulo.localeCompare(b.rotulo, "pt-BR");
    const mapa = {
      referencia: {
        rotulo: "Referência da RAIS",
        itens: (dim.referencias || (dim.referencia ? [dim.referencia] : []))
          .map((nome, i) => ({ valor: i, rotulo: nome }))
          .slice()
          .reverse(),
        conjunto: D.estado.refs,
        destaques: new Set([D.estado.ref]),
        padrao: new Set([D.estado.ref]),
        minimo: 1,
        rotuloLimpar: "Só a mais nova",
      },
      setor: {
        rotulo: "Todos os setores",
        itens: dim.setores.map((s, i) => ({ valor: i, rotulo: s })),
        conjunto: D.estado.setores,
      },
      municipio: {
        rotulo: "Todos os municípios",
        itens: dim.municipios.map((m, i) => ({ valor: i, rotulo: m.nome })).sort(porNome),
        conjunto: D.estado.municipios,
        comBusca: true,
      },
      regiao: {
        rotulo: "Todas as regiões",
        itens: D.regioes.map((r, i) => ({ valor: i, rotulo: r })).sort(porNome),
        conjunto: D.estado.regioes,
      },
      programa: {
        rotulo: "Todos os programas",
        itens: dim.programas.map((p, i) => ({ valor: i, rotulo: p })),
        conjunto: D.estado.programas,
      },
      tamanho: {
        rotulo: "Todos os tamanhos",
        itens: dim.tamanhos.map((t, i) => ({ valor: i, rotulo: t })),
        conjunto: D.estado.tamanhos,
      },
      porteIbge: {
        rotulo: "Todos os portes IBGE",
        itens: D.portesIbge.map((p) => ({ valor: p.valor, rotulo: p.rotulo })),
        conjunto: D.estado.portesIbge,
      },
      celetista: {
        rotulo: "Todos os regimes",
        itens: dim.celetistas.map((c, i) => ({ valor: i, rotulo: c })),
        conjunto: D.estado.celetistas,
      },
    };

    document.querySelectorAll("[data-campo]").forEach((container) => {
      const cfg = mapa[container.dataset.campo];
      if (cfg) criarMulti(container, { ...cfg, aoMudar: aoAlterarFiltro });
    });

    document.addEventListener("click", fecharTodos);

    ligarSegmentado("condecFiltroIncentivo", (v) => {
      D.estado.incentivo = v;
      aoAlterarFiltro();
    });
    ligarSegmentado("condecFiltroCalcadista", (v) => {
      D.estado.calcadista = v;
      aoAlterarFiltro();
    });
    ligarSegmentado("condecFiltroSpe", (v) => {
      D.estado.spe = v;
      aoAlterarFiltro();
    });
    ligarSegmentado("condecFiltroInstitucional", (v) => {
      D.estado.institucional = v;
      aoAlterarFiltro();
    });
    const seletorMetrica = document.getElementById("mapCondecMetric");
    if (seletorMetrica) seletorMetrica.addEventListener("change", atualizarMapa);
    ligarSegmentado("condecDispersaoEscala", (v) => {
      G.setEscalaDispersao(v);
      atualizarNotaDispersao(v);
      G.renderDispersao(vista.grupos);
    });
    ligarSegmentado("condecRegioesMetrica", (v) => {
      G.setMetricaRegioes(v);
      G.renderRegioes(vista.idx);
    });
    atualizarNotaDispersao("log");
    ligarSegmentado("condecTabelaModo", (v) => {
      vista.modo = v;
      vista.pagina = 0;
      vista.ordem = { chave: "vinculos", dir: "desc" };
      vista.abertas.clear();
      renderTabela();
    });
    ligarComparacao();

    const debounce = (fn, ms) => {
      let t = null;
      return (...args) => {
        clearTimeout(t);
        t = setTimeout(() => fn(...args), ms);
      };
    };

    const buscar = debounce(() => {
      D.estado.busca = el("condecFiltroBusca").value;
      aoAlterarFiltro();
    }, 280);
    el("condecFiltroBusca").addEventListener("input", buscar);

    montarFaixasAno();

    const faixas = ["condecIniDe", "condecIniAte", "condecFimDe", "condecFimAte"];
    const aplicarFaixa = () => {
      faixas.forEach((id) => {
        const valor = parseInt(el(id).value, 10);
        D.estado[id] = Number.isFinite(valor) ? valor : null;
      });
      aoAlterarFiltro();
    };
    faixas.forEach((id) => el(id).addEventListener("change", aplicarFaixa));

    el("condecBtnLimpar").addEventListener("click", () => {
      D.limparEstado();
      el("condecFiltroBusca").value = "";
      faixas.forEach((id) => (el(id).value = ""));
      ["condecFiltroIncentivo", "condecFiltroCalcadista", "condecFiltroSpe", "condecFiltroInstitucional"].forEach((id) => {
        el(id)
          .querySelectorAll(".condec-seg__btn")
          .forEach((b, i) => b.classList.toggle("condec-is-ativo", i === 0));
      });
      atualizarTagReferencia();
      multis.forEach((m) => m.sincronizarCaixas());
      aoAlterarFiltro();
    });

    el("condecBtnFiltros").addEventListener("click", () => alternarFiltros(!recolhido()));
    el("condecFiltrosResumo").addEventListener("click", () => {
      if (recolhido()) alternarFiltros(false);
    });
    alternarFiltros(localStorage.getItem(CHAVE_RECOLHIDO) === "1");

    el("condecBtnExportar").addEventListener("click", exportarCsv);
    el("condecPgPrimeira").addEventListener("click", () => irParaPagina(0));
    el("condecPgAnterior").addEventListener("click", () => irParaPagina(vista.pagina - 1));
    el("condecPgProxima").addEventListener("click", () => irParaPagina(vista.pagina + 1));
    el("condecPgUltima").addEventListener("click", () => irParaPagina(vista.totalPaginas - 1));

    document.addEventListener("click", (ev) => {
      const btn = ev.target.closest("[data-filtrar-mun]");
      if (!btn) return;
      aplicarFiltroMunicipio(btn.dataset.filtrarMun);
    });
    el("condecRankingLista").addEventListener("click", (ev) => {
      const item = ev.target.closest("[data-mun]");
      if (!item) return;
      aplicarFiltroMunicipioIdx(Number(item.dataset.mun));
    });
    el("condecRkAnterior").addEventListener("click", () => irRanking(-1));
    el("condecRkProxima").addEventListener("click", () => irRanking(1));
    const rolagem = el("condecTabelaRolagem");
    if (rolagem) {
      rolagem.addEventListener("scroll", atualizarIndicadorTabela, { passive: true });
      window.addEventListener("resize", () => {
        ajustarJanelaTabela();
        atualizarIndicadorTabela();
      });
    }
  }

  function atualizarNotaDispersao(escala) {
    const p = el("condecDispersaoNota");
    if (!p) return;
    p.textContent =
      escala === "log"
        ? "Escala logarítmica: cada marca do eixo vale dez vezes a anterior (1, 10, 100, 1.000…). Serve para comparar empresas pequenas e grandes no mesmo gráfico. Use Linear para ver os valores em tamanho real."
        : "Escala linear: os eixos mostram os valores reais. Empresas grandes ocupam a maior parte do gráfico; as menores ficam próximas da origem.";
  }

  function aplicarFiltroMunicipio(codigo) {
    const i = D.dim.municipios.findIndex((m) => String(m.cod) === String(codigo));
    aplicarFiltroMunicipioIdx(i);
  }

  function aplicarFiltroMunicipioIdx(i) {
    if (!Number.isFinite(i) || i < 0) return;
    D.estado.municipios.clear();
    D.estado.municipios.add(i);
    multis.forEach((m) => m.sincronizarCaixas());
    aoAlterarFiltro();
  }

  function ligarSegmentado(id, aoEscolher) {
    const grupo = el(id);
    if (!grupo) return;
    grupo.addEventListener("click", (ev) => {
      const btn = ev.target.closest(".condec-seg__btn");
      if (!btn || btn.classList.contains("condec-is-ativo")) return;
      grupo.querySelectorAll(".condec-seg__btn").forEach((b) => b.classList.remove("condec-is-ativo"));
      btn.classList.add("condec-is-ativo");
      aoEscolher(btn.dataset.valor);
    });
  }

  function marcarSegmentado(id, valor) {
    const grupo = el(id);
    if (!grupo) return;
    grupo.querySelectorAll(".condec-seg__btn").forEach((b) => {
      b.classList.toggle("condec-is-ativo", b.dataset.valor === String(valor));
    });
  }

  function atualizarTagReferencia() {
    const refs = D.dim.referencias || [];
    const nome = refs[D.estado.ref] || D.dim.referencia || "—";
    if (el("condecTagReferencia")) el("condecTagReferencia").textContent = nome;
  }

  function preencherSelectAno(id, anos, rotuloVazio) {
    const caixa = el(id);
    if (!caixa) return;
    const atual = caixa.value;
    caixa.innerHTML = `<option value="">${rotuloVazio}</option>${anos
      .map((ano) => `<option value="${ano}">${ano}</option>`)
      .join("")}`;
    if (atual && anos.some((ano) => String(ano) === atual)) caixa.value = atual;
  }

  function montarFaixasAno() {
    const anos = D.anosDosProtocolos();
    preencherSelectAno("condecIniDe", anos.inicio, "de");
    preencherSelectAno("condecIniAte", anos.inicio, "até");
    preencherSelectAno("condecFimDe", anos.vigencia, "de");
    preencherSelectAno("condecFimAte", anos.vigencia, "até");
  }

  /** Indicador graduado do mapa: <select> da toolbar compartilhada. */
  function metricaDoMapa() {
    const sel = document.getElementById("mapCondecMetric");
    const v = sel ? sel.value : "";
    return M.METRICAS[v] ? v : "vinculos";
  }

  function valorSegmentado(id) {
    const ativo = el(id) && el(id).querySelector(".condec-seg__btn.condec-is-ativo");
    return ativo ? ativo.dataset.valor : "";
  }

  // ---------------------------------------------------- recolher / expandir

  const CHAVE_RECOLHIDO = "condec:filtros-recolhidos";

  const recolhido = () => el("condecFiltros").classList.contains("condec-is-recolhido");

  function alternarFiltros(fechar) {
    el("condecFiltros").classList.toggle("condec-is-recolhido", fechar);
    el("condecBtnFiltros").setAttribute("aria-expanded", fechar ? "false" : "true");
    el("condecBtnFiltros").title = fechar ? "Expandir condecFiltros" : "Recolher condecFiltros";
    if (fechar) fecharTodos();
    try {
      localStorage.setItem(CHAVE_RECOLHIDO, fechar ? "1" : "0");
    } catch (e) {
      /* navegação sem armazenamento local: a preferência apenas não persiste */
    }
  }

  /** Rótulos curtos dos filtros ativos, exibidos ao lado do botão quando a barra está recolhida. */
  function resumoDosFiltros() {
    const e = D.estado;
    const chips = [];

    const nomes = (conjunto, rotulo, rotularItem) => {
      if (conjunto.size === 0) return;
      if (conjunto.size === 1) chips.push(rotularItem(conjunto.values().next().value));
      else chips.push(`${conjunto.size} ${rotulo}`);
    };

    if (e.incentivo === "inc") chips.push("Incentivadas");
    if (e.incentivo === "nao") chips.push("Não incentivadas");
    if (e.institucional === "priv") chips.push("Setor privado");
    if (e.institucional === "pub") chips.push("Setor público");
    nomes(e.setores, "setores", (i) => D.dim.setores[i]);
    nomes(e.municipios, "municípios", (i) => D.dim.municipios[i].nome);
    nomes(e.regioes, "regiões", (i) => D.regioes[i]);
    nomes(e.programas, "programas", (i) => D.dim.programas[i]);
    nomes(e.tamanhos, "tamanhos RAIS", (i) => D.dim.tamanhos[i]);
    nomes(e.portesIbge, "portes IBGE", (i) => (D.portesIbge[i] ? D.portesIbge[i].nome : i));
    nomes(e.celetistas, "regimes", (i) => D.dim.celetistas[i]);
    if (e.calcadista !== "todos") chips.push(e.calcadista === "sim" ? "Calçadista" : "Não calçadista");
    if (e.spe !== "todos") chips.push(e.spe === "sim" ? "Parceira SPE" : "Fora da SPE");
    if (e.iniDe !== null || e.iniAte !== null) chips.push(`Início ${e.iniDe || "…"}–${e.iniAte || "…"}`);
    if (e.fimDe !== null || e.fimAte !== null) chips.push(`Vigência até ${e.fimDe || "…"}–${e.fimAte || "…"}`);
    if (e.busca) chips.push(`"${e.busca}"`);

    const refs = D.dim.referencias || [];
    if (e.refs && e.refs.size) {
      const nomes = Array.from(e.refs)
        .sort((a, b) => a - b)
        .map((i) => refs[i])
        .filter(Boolean);
      if (nomes.length) chips.unshift(nomes.join(" · "));
    } else if (refs[e.ref]) chips.unshift(refs[e.ref]);

    return chips;
  }

  function renderResumo() {
    const chips = resumoDosFiltros();
    el("condecFiltrosResumo").innerHTML = chips.length
      ? chips.map((c) => `<span class="condec-chip" title="${escaparHtml(c)}">${escaparHtml(c)}</span>`).join("")
      : '<span class="condec-chip condec-chip--vazio">Nenhum filtro aplicado</span>';
  }

  const escaparHtml = (s) =>
    String(s).replace(/[&<>"]/g, (ch) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[ch]);

  // ------------------------------------------------------------------ cálculo

  function aoAlterarFiltro() {
    D.sincronizarRefAtiva();
    atualizarTagReferencia();
    vista.pagina = 0;
    vista.abertas.clear();
    recalcular();
  }

  function recalcular() {
    vista.idx = Int32Array.from(D.filtrar());
    vista.grupos = D.agregarPorEmpresa(vista.idx);

    const totais = D.agregarTotais(vista.idx);
    renderKpis(totais);
    renderContador(totais);
    renderResumo();
    renderTabela();
    G.render(vista.idx, vista.grupos);
    atualizarComparacao();
    atualizarMapa();
  }

  function atualizarMapa() {
    const porMun = D.agregarPorMunicipio(vista.idx);
    const raizesVisiveis = new Set();
    const municipiosVisiveis = new Set();
    const empresasPorCod = new Map();
    const c = D.col;
    for (let j = 0; j < vista.idx.length; j += 1) {
      const i = vista.idx[j];
      if (c.inc[i] === D.INC_NAO) continue;
      const empresa = D.empresaPorRaiz.get(c.raiz[i]);
      if (empresa) raizesVisiveis.add(empresa.raiz);
      if (c.mun[i] < 0) continue;
      const cod = D.dim.municipios[c.mun[i]].cod;
      municipiosVisiveis.add(cod);
      let porRaiz = empresasPorCod.get(cod);
      if (!porRaiz) {
        porRaiz = new Map();
        empresasPorCod.set(cod, porRaiz);
      }
      const chave = empresa ? empresa.raiz : String(c.raiz[i]);
      let item = porRaiz.get(chave);
      if (!item) {
        item = {
          nome: empresa ? empresa.nome : D.texto ? D.texto.razao[i] : "Empresa",
          vinculos: 0,
          pi: 0,
        };
        porRaiz.set(chave, item);
      }
      item.vinculos += c.v[i];
      item.pi += c.pi[i];
    }
    empresasPorCod.forEach((porRaiz, cod) => {
      empresasPorCod.set(
        cod,
        Array.from(porRaiz.values()).sort((a, b) => b.vinculos - a.vinculos)
      );
    });

    const metrica = metricaDoMapa();
    M.atualizar({ porMun, porMunTotal: D.municipiosTotais, metrica, raizesVisiveis, municipiosVisiveis, empresasPorCod });
    renderRanking(porMun, metrica);
  }

  function rotuloGrupo(g) {
    const nome = D.nomeDaEmpresa(g.raiz, g.posicoes[0]);
    const raizTxt = g.empresa
      ? g.empresa.raiz
      : D.texto && D.texto.raizes
        ? D.texto.raizes[g.raiz]
        : "";
    return { nome, raizTxt };
  }

  function topRaizesComparacao(n) {
    const linhas = vista.grupos.filter((g) => g.vinculos > 0 && g.rem > 0);
    const sinal = comparacao.ordem === "menores" ? 1 : -1;
    linhas.sort((a, b) => sinal * (a.rem - b.rem) || b.vinculos - a.vinculos);
    return linhas.slice(0, n).map((g) => g.raiz);
  }

  function sincronizarRaizesComparacao() {
    const noRecorte = new Set(vista.grupos.map((g) => g.raiz));
    comparacao.raizes = comparacao.raizes.filter((r) => noRecorte.has(r));
    if (comparacao.automatico || !comparacao.raizes.length) {
      comparacao.raizes = topRaizesComparacao(COMP_MAX);
      comparacao.automatico = true;
    }
  }

  function atualizarComparacao() {
    sincronizarRaizesComparacao();
    renderChipsComparacao();
    const nota = el("condecCompNota");
    if (nota) {
      nota.textContent = comparacao.raizes.length
        ? `${comparacao.raizes.length} de ${COMP_MAX} empresas · ${
            comparacao.automatico
              ? comparacao.ordem === "menores"
                ? "menores salários médios no recorte"
                : "maiores salários médios no recorte"
              : "seleção manual"
          }`
        : "Nenhuma empresa no recorte para comparar.";
    }
    G.renderComparacao(vista.idx, comparacao.raizes, comparacao.ordem);
  }

  function renderChipsComparacao() {
    const caixa = el("condecCompChips");
    if (!caixa) return;
    const porRaiz = new Map(vista.grupos.map((g) => [g.raiz, g]));
    caixa.innerHTML = comparacao.raizes
      .map((r, i) => {
        const g = porRaiz.get(r);
        const nome = g ? rotuloGrupo(g).nome : D.nomeDaEmpresa(r, -1);
        return `<span class="condec-comparacao__chip comparacao__chip--${i}" title="${escaparHtml(nome)}">
          <span>${escaparHtml(nome)}</span>
          <button type="button" data-raiz="${r}" aria-label="Remover ${escaparHtml(nome)}">×</button>
        </span>`;
      })
      .join("");
  }

  function buscarEmpresasComparacao(termo) {
    const t = termo.trim().toLowerCase();
    const digitos = termo.replace(/\D/g, "");
    const escolhidas = new Set(comparacao.raizes);
    if (!t) {
      return vista.grupos
        .filter((g) => g.vinculos > 0 && !escolhidas.has(g.raiz))
        .sort((a, b) => b.vinculos - a.vinculos)
        .slice(0, 8);
    }
    const saida = [];
    for (let i = 0; i < vista.grupos.length; i += 1) {
      const g = vista.grupos[i];
      const { nome, raizTxt } = rotuloGrupo(g);
      const nomeOk = nome.toLowerCase().indexOf(t) >= 0;
      const cnpjOk = digitos.length >= 3 && String(raizTxt).indexOf(digitos) >= 0;
      const cnpjTxt =
        D.texto && g.posicoes[0] != null ? String(D.texto.cnpj[g.posicoes[0]] || "") : "";
      const cnpjCheio = digitos.length >= 3 && cnpjTxt.indexOf(digitos) >= 0;
      if (nomeOk || cnpjOk || cnpjCheio) saida.push(g);
    }
    return saida.sort((a, b) => b.vinculos - a.vinculos).slice(0, 12);
  }

  function mostrarSugestoesComparacao() {
    const lista = el("condecCompLista");
    const busca = el("condecCompBusca");
    if (!lista || !busca) return;
    const termo = busca.value;
    if (termo.trim() && termo.trim().length < 2) {
      lista.hidden = true;
      return;
    }
    const itens = buscarEmpresasComparacao(termo);
    const cheio = comparacao.raizes.length >= COMP_MAX;
    comparacao.sugestaoAtiva = itens.length ? 0 : -1;
    lista.innerHTML = itens.length
      ? itens
          .map((g, i) => {
            const { nome, raizTxt } = rotuloGrupo(g);
            const ja = comparacao.raizes.indexOf(g.raiz) >= 0;
            const bloqueado = ja || cheio;
            return `<li>
              <button type="button" class="condec-comparacao__item${i === 0 ? " is-ativo" : ""}" data-raiz="${g.raiz}" ${
                bloqueado ? "disabled" : ""
              }>
                <span class="condec-comparacao__item-nome">${escaparHtml(nome)}</span>
                <span class="condec-comparacao__item-meta">${escaparHtml(raizTxt || "")}${
                  g.vinculos ? ` · ${fmt.int(g.vinculos)} vínculos` : ""
                }${ja ? " · já selecionada" : ""}</span>
              </button>
            </li>`;
          })
          .join("")
      : `<li><button type="button" class="condec-comparacao__item" disabled><span class="condec-comparacao__item-nome">Nenhuma empresa encontrada</span></button></li>`;
    lista.hidden = false;
  }

  function esconderSugestoesComparacao() {
    const lista = el("condecCompLista");
    if (lista) lista.hidden = true;
    comparacao.sugestaoAtiva = -1;
  }

  function adicionarComparacao(raiz) {
    if (comparacao.raizes.indexOf(raiz) >= 0 || comparacao.raizes.length >= COMP_MAX) return;
    comparacao.raizes.push(raiz);
    comparacao.automatico = false;
    const busca = el("condecCompBusca");
    if (busca) busca.value = "";
    esconderSugestoesComparacao();
    atualizarComparacao();
  }

  function ligarComparacao() {
    const busca = el("condecCompBusca");
    const lista = el("condecCompLista");
    const chips = el("condecCompChips");
    const ordem = el("condecCompOrdem");
    if (!busca || !lista || !chips) return;

    let timer = 0;
    busca.addEventListener("input", () => {
      window.clearTimeout(timer);
      timer = window.setTimeout(mostrarSugestoesComparacao, 160);
    });
    busca.addEventListener("focus", mostrarSugestoesComparacao);
    busca.addEventListener("keydown", (ev) => {
      const itens = Array.from(lista.querySelectorAll(".condec-comparacao__item:not([disabled])"));
      if (ev.key === "Escape") {
        esconderSugestoesComparacao();
        return;
      }
      if (ev.key === "ArrowDown" || ev.key === "ArrowUp") {
        ev.preventDefault();
        if (!itens.length) return;
        const dir = ev.key === "ArrowDown" ? 1 : -1;
        comparacao.sugestaoAtiva = (comparacao.sugestaoAtiva + dir + itens.length) % itens.length;
        itens.forEach((b, i) => b.classList.toggle("condec-is-ativo", i === comparacao.sugestaoAtiva));
        return;
      }
      if (ev.key === "Enter") {
        ev.preventDefault();
        const alvo = itens[comparacao.sugestaoAtiva] || itens[0];
        if (alvo) adicionarComparacao(Number(alvo.dataset.raiz));
      }
    });
    lista.addEventListener("mousedown", (ev) => {
      const btn = ev.target.closest("[data-raiz]");
      if (!btn || btn.disabled) return;
      ev.preventDefault();
      adicionarComparacao(Number(btn.dataset.raiz));
    });
    chips.addEventListener("click", (ev) => {
      const btn = ev.target.closest("[data-raiz]");
      if (!btn) return;
      const raiz = Number(btn.dataset.raiz);
      comparacao.raizes = comparacao.raizes.filter((r) => r !== raiz);
      comparacao.automatico = false;
      atualizarComparacao();
    });
    if (ordem) {
      ordem.addEventListener("click", (ev) => {
        const btn = ev.target.closest(".condec-seg__btn");
        if (!btn) return;
        ordem.querySelectorAll(".condec-seg__btn").forEach((b) => b.classList.remove("condec-is-ativo"));
        btn.classList.add("condec-is-ativo");
        comparacao.ordem = btn.dataset.valor === "menores" ? "menores" : "maiores";
        comparacao.automatico = true;
        comparacao.raizes = topRaizesComparacao(COMP_MAX);
        atualizarComparacao();
      });
    }
    document.addEventListener("click", (ev) => {
      if (!ev.target.closest("#condecCompBuscaWrap")) esconderSugestoesComparacao();
    });
  }

  function renderRanking(porMun, metrica) {
    const def = M.METRICAS[metrica] || M.METRICAS.vinculos;
    rankingVista.formatar = def.formatar;
    rankingVista.linhas = porMun
      .map((atual, i) => ({
        nome: atual.nome,
        valor: def.valor({ atual, total: D.municipiosTotais[i] }),
        idx: i,
      }))
      .filter((l) => l.valor > 0)
      .sort((a, b) => b.valor - a.valor);
    rankingVista.pagina = 0;
    el("condecRankingSub").textContent = `${def.rotulo} — clique para filtrar o painel`;
    pintarRanking();
  }

  function irRanking(delta) {
    const total = Math.max(1, Math.ceil(rankingVista.linhas.length / rankingVista.porPagina));
    const proxima = rankingVista.pagina + delta;
    if (proxima < 0 || proxima >= total) return;
    rankingVista.pagina = proxima;
    pintarRanking();
  }

  function pintarRanking() {
    const { linhas, pagina, porPagina, formatar } = rankingVista;
    const totalPag = Math.max(1, Math.ceil(linhas.length / porPagina) || 1);
    const ini = pagina * porPagina;
    const fatia = linhas.slice(ini, ini + porPagina);
    const fim = ini + fatia.length;

    el("condecRankingLista").innerHTML = fatia.length
      ? fatia
          .map(
            (l, i) => `<li class="condec-ranking__item" data-mun="${l.idx}">
              <span class="condec-ranking__pos">${ini + i + 1}</span>
              <span class="condec-ranking__nome" title="${l.nome}">${l.nome}</span>
              <span class="condec-ranking__valor">${formatar(l.valor)}</span>
            </li>`
          )
          .join("")
      : '<li class="condec-ranking__vazio">Nenhum município no recorte selecionado.</li>';

    el("condecRkInfo").textContent = linhas.length
      ? `${ini + 1}–${fim} de ${linhas.length}`
      : "0 de 0";
    el("condecRkAnterior").disabled = pagina <= 0;
    el("condecRkProxima").disabled = pagina >= totalPag - 1 || !linhas.length;
  }

  // --------------------------------------------------------------------- KPIs

  function iconeKpi(nome) {
    const trilho = {
      fill: "none",
      stroke: "currentColor",
      "stroke-width": "1.8",
      "stroke-linecap": "round",
      "stroke-linejoin": "round",
    };
    const attrs = Object.entries(trilho)
      .map(([k, v]) => `${k}="${v}"`)
      .join(" ");
    const formas = {
      empresa: '<path d="M3.5 14.5h13"/><path d="M5 14.5V4.5h6v10"/><path d="M11 8.5h4v6"/><path d="M7 7h2M7 10h2"/>',
      estab: '<rect x="3.5" y="3.5" width="5" height="5" rx="1"/><rect x="11.5" y="3.5" width="5" height="5" rx="1"/><rect x="3.5" y="11.5" width="5" height="5" rx="1"/><rect x="11.5" y="11.5" width="5" height="5" rx="1"/>',
      emprego: '<rect x="3.5" y="6.5" width="13" height="8" rx="1.5"/><path d="M7 6.5V5a3 3 0 0 1 6 0v1.5"/>',
      vinculo: '<path d="M7 10.5 5.8 11.7a2.4 2.4 0 0 1-3.4-3.4L4.6 6"/><path d="M13 9.5l1.2-1.2a2.4 2.4 0 0 0-3.4-3.4L9 6.2"/><path d="M6.8 11.2l4.4-4.4"/>',
      check: '<circle cx="10" cy="10" r="6.5"/><path d="m7.2 10.1 1.9 1.9 3.8-3.9"/>',
      rem: '<circle cx="10" cy="10" r="6.5"/><path d="M10 6.6v6.8M7.8 8.2c.6-.7 1.4-1 2.2-1 1.4 0 2.3.7 2.3 1.8s-.8 1.7-2.4 1.9c-1.5.2-2.4.8-2.4 1.9 0 1.1 1 1.9 2.5 1.9.9 0 1.7-.3 2.3-1"/>',
      recorte: '<path d="M3.5 13.5 7 8.5l3 3.2 3.2-5.2 3.3 7"/><path d="M3.5 15.5h13"/>',
      alerta: '<path d="M10 3.8 2.8 15.2h14.4L10 3.8z"/><path d="M10 8.2v3.4M10 13.4h.01"/>',
    };
    return `<svg viewBox="0 0 20 20" ${attrs} aria-hidden="true">${formas[nome] || ""}</svg>`;
  }

  let kpisAnimar = true;

  function renderKpis(t) {
    const totalEstado = D.dim.totais.vinculos_rais;
    const aderencia = t.pi ? (t.vinculosInc / t.pi) * 100 : null;
    const acimaMeta = aderencia == null ? null : aderencia - 100;

    const cards = [
      {
        rotulo: "Empresas incentivadas",
        valor: fmt.int(t.empresasInc),
        nota: `de ${fmt.int(D.dim.totais.raizes_incentivadas)} no CONDEC`,
        icone: "empresa",
      },
      {
        rotulo: "Estabelecimentos",
        valor: fmt.int(t.registros),
        nota: `${fmt.int(t.estabInc)} de empresas incentivadas`,
        classe: "condec-kpi--tinta",
        icone: "estab",
      },
      {
        rotulo: "Empregos comprometidos",
        valor: fmt.int(t.pi),
        nota: `${fmt.int(t.estabProtocolo)} protocolos no recorte`,
        classe: "condec-kpi--ambar",
        icone: "emprego",
      },
      {
        rotulo: "Vínculos de incentivadas",
        valor: fmt.int(t.vinculosInc),
        nota: `${fmt.pct((t.vinculosInc / (totalEstado || 1)) * 100)} do emprego formal do estado`,
        icone: "vinculo",
      },
      {
        rotulo: "Aderência ao compromisso",
        valor: aderencia == null ? "—" : fmt.pct(aderencia),
        nota: "vínculos observados sobre empregos comprometidos",
        classe: t.pi && t.vinculosInc < t.pi ? "condec-kpi--ambar" : "",
        icone: "check",
        progresso: aderencia,
        delta:
          acimaMeta == null
            ? null
            : {
                texto:
                  acimaMeta >= 0
                    ? `${fmt.pct(acimaMeta)} acima do compromisso`
                    : `${fmt.pct(Math.abs(acimaMeta))} abaixo do compromisso`,
                tipo: acimaMeta >= 0 ? "ok" : "alerta",
              },
      },
      {
        rotulo: "Remuneração média",
        valor: fmt.moeda(t.remInc || t.rem),
        nota: t.remInc ? `${fmt.moeda(t.rem)} no recorte completo` : "média ponderada do recorte",
        classe: "condec-kpi--azul",
        icone: "rem",
      },
      {
        rotulo: "Vínculos no recorte",
        valor: fmt.int(t.vinculos),
        nota: `${fmt.int(t.municipios)} municípios alcançados`,
        classe: "condec-kpi--azul",
        icone: "recorte",
      },
      {
        rotulo: "Protocolos sem RAIS",
        valor: fmt.int(t.estabSemRais),
        nota: "sem estabelecimento correspondente na base",
        classe: t.estabSemRais ? "condec-kpi--ambar" : "",
        icone: "alerta",
        delta: t.estabSemRais
          ? { texto: "Requer atenção", tipo: "alerta" }
          : { texto: "Todos localizados", tipo: "ok" },
        link: t.estabSemRais ? { rotulo: "Ver empresas", acao: "sem-rais" } : null,
      },
    ];

    el("condecKpis").innerHTML = cards
      .map((c) => {
        const barra =
          c.progresso == null
            ? ""
            : `<div class="condec-kpi__progress" role="progressbar" aria-valuemin="0" aria-valuemax="100" aria-valuenow="${Math.round(Math.max(0, c.progresso))}" aria-label="Aderência">
            <span class="condec-kpi__progress-fill${c.progresso <= 0 ? " is-vazio" : c.progresso < 100 ? " is-alerta" : ""}${kpisAnimar ? "" : " is-estatico"}" style="--kpi-pct:${Math.min(100, Math.max(0, c.progresso)).toFixed(1)}%"></span>
          </div>`;
        const chip = c.delta
          ? `<span class="condec-kpi__delta kpi__delta--${c.delta.tipo}">${c.delta.texto}</span>`
          : "";
        const link = c.link
          ? `<button type="button" class="condec-kpi__link" data-acao="${c.link.acao}">${c.link.rotulo}</button>`
          : "";
        const acoes = chip || link ? `<p class="condec-kpi__acoes">${chip}${link}</p>` : "";
        return `<article class="condec-kpi ${c.classe || ""}">
          <span class="condec-kpi__icon" aria-hidden="true">${iconeKpi(c.icone)}</span>
          <p class="condec-kpi__rotulo">${c.rotulo}</p>
          <p class="condec-kpi__valor">${c.valor}</p>
          <p class="condec-kpi__nota">${c.nota}</p>
          ${barra}
          ${acoes}
        </article>`;
      })
      .join("");
    kpisAnimar = false;
  }

  function formatarCnpj(digitos) {
    const s = String(digitos || "").replace(/\D/g, "").padStart(14, "0");
    if (!digitos || s.length !== 14) return digitos || "—";
    return `${s.slice(0, 2)}.${s.slice(2, 5)}.${s.slice(5, 8)}/${s.slice(8, 12)}-${s.slice(12)}`;
  }

  function fecharSemRais() {
    const caixa = el("condecDialogoSemRais");
    if (!caixa) return;
    caixa.hidden = true;
    document.body.style.overflow = "";
  }

  async function abrirSemRais() {
    const caixa = el("condecDialogoSemRais");
    const corpo = el("condecDialogoSemRaisCorpo");
    const sub = el("condecDialogoSemRaisSub");
    if (!caixa || !corpo) return;
    await D.carregarTexto();
    const lista = D.listarSemRais(vista.idx);
    sub.textContent = lista.length
      ? `${fmt.int(lista.length)} protocolo${lista.length > 1 ? "s" : ""} sem estabelecimento correspondente na RAIS, no recorte atual.`
      : "Nenhum protocolo sem RAIS no recorte atual.";
    corpo.innerHTML = lista.length
      ? lista
          .map(
            (l) => `<tr>
              <td class="condec-txt">${escaparHtml(l.nome)}</td>
              <td>${escaparHtml(formatarCnpj(l.cnpj))}</td>
              <td>${escaparHtml(l.municipio || "—")}</td>
              <td>${escaparHtml(l.programa || "—")}</td>
              <td class="condec-num">${fmt.int(l.pi)}</td>
            </tr>`
          )
          .join("")
      : `<tr><td colspan="5" class="condec-dialogo__vazio">Nenhuma empresa neste recorte.</td></tr>`;
    caixa.hidden = false;
    document.body.style.overflow = "hidden";
    const fechar = caixa.querySelector(".condec-dialogo__fechar");
    if (fechar) fechar.focus();
  }

  function ligarDialogoSemRais() {
    const caixa = el("condecDialogoSemRais");
    if (!caixa) return;
    el("condecKpis").addEventListener("click", (ev) => {
      const btn = ev.target.closest("[data-acao='sem-rais']");
      if (btn) abrirSemRais();
    });
    caixa.addEventListener("click", (ev) => {
      if (ev.target.closest("[data-fechar-sem-rais]")) fecharSemRais();
    });
    document.addEventListener("keydown", (ev) => {
      if (ev.key === "Escape" && !caixa.hidden) fecharSemRais();
    });
  }

  function renderContador(t) {
    const total = D.totalDaReferencia();
    el("condecContadorFiltro").textContent = D.temFiltro()
      ? `${fmt.int(t.registros)} de ${fmt.int(total)} estabelecimentos`
      : `${fmt.int(total)} estabelecimentos (base completa)`;
  }

  // ------------------------------------------------------------------- tabela

  const COLUNAS_EMPRESA = [
    { chave: "nome", rotulo: "Empresa", classe: "condec-txt" },
    { chave: "raiz", rotulo: "CNPJ raiz" },
    { chave: "municipio", rotulo: "Município" },
    { chave: "setor", rotulo: "Setor" },
    { chave: "programa", rotulo: "Programa" },
    { chave: "estab", rotulo: "Estab.", classe: "condec-num" },
    { chave: "pi", rotulo: "Empregos PI", classe: "condec-num" },
    { chave: "vinculos", rotulo: "Vínculos", classe: "condec-num" },
    { chave: "aderencia", rotulo: "Aderência", classe: "condec-num" },
    { chave: "rem", rotulo: "Rem. média", classe: "condec-num" },
    { chave: "vigencia", rotulo: "Vigência", classe: "condec-num" },
    { chave: "situacao", rotulo: "Situação" },
  ];

  const COLUNAS_ESTAB = [
    { chave: "razao", rotulo: "Razão social", classe: "condec-txt" },
    { chave: "cnpj", rotulo: "CNPJ" },
    { chave: "municipio", rotulo: "Município" },
    { chave: "setor", rotulo: "Setor" },
    { chave: "cnae", rotulo: "CNAE 95" },
    { chave: "tamanho", rotulo: "Porte" },
    { chave: "regime", rotulo: "Regime" },
    { chave: "pi", rotulo: "Empregos PI", classe: "condec-num" },
    { chave: "vinculos", rotulo: "Vínculos", classe: "condec-num" },
    { chave: "rem", rotulo: "Rem. média", classe: "condec-num" },
    { chave: "situacao", rotulo: "Situação" },
  ];

  const colunas = () => (vista.modo === "empresa" ? COLUNAS_EMPRESA : COLUNAS_ESTAB);

  const cmpTexto = (a, b) => (a < b ? -1 : a > b ? 1 : 0);

  /** Chaves de ordenação lidas direto das colunas, sem criar objetos por linha. */
  function chaveGrupo(g, chave) {
    switch (chave) {
      case "nome":
        return (g.empresa ? g.empresa.nome : D.texto.razao[g.posicoes[0]] || "").toUpperCase();
      case "raiz":
        return g.empresa ? g.empresa.raiz : D.texto.raizes[g.raiz];
      case "municipio":
        return D.nomeMunicipio(D.col.mun[g.posicoes[0]]).toUpperCase();
      case "setor":
        return D.nomeSetor(D.col.setor[g.posicoes[0]]).toUpperCase();
      case "programa":
        return g.empresa ? g.empresa.protocolos[0].programa : "";
      case "vigencia":
        return g.empresa ? Math.max(...g.empresa.protocolos.map((p) => p.vigencia || 0)) : 0;
      case "aderencia":
        return g.aderencia === null ? -1 : g.aderencia;
      case "situacao":
        return g.incentivada ? (g.semRais ? 1 : 2) : 0;
      default:
        return g[chave] || 0;
    }
  }

  function chaveEstab(i, chave) {
    const c = D.col;
    switch (chave) {
      case "razao":
        return D.texto.razao[i].toUpperCase();
      case "cnpj":
        return D.texto.cnpj[i];
      case "municipio":
        return D.nomeMunicipio(c.mun[i]).toUpperCase();
      case "setor":
        return D.nomeSetor(c.setor[i]).toUpperCase();
      case "cnae":
        return (D.dim.cnaes[c.cnae[i]] || { cod: "" }).cod;
      case "tamanho":
        return c.tam[i];
      case "regime":
        return c.cele[i];
      case "situacao":
        return c.sr[i] === 1 ? 1 : c.inc[i] + 2;
      case "vinculos":
        return c.v[i];
      case "rem":
        return c.rem[i];
      case "pi":
        return c.pi[i];
      default:
        return 0;
    }
  }

  function ordenarLinhas() {
    const { chave, dir } = vista.ordem;
    const sinal = dir === "asc" ? 1 : -1;
    if (vista.modo === "empresa") {
      const linhas = vista.grupos.slice();
      linhas.sort((a, b) => {
        const x = chaveGrupo(a, chave);
        const y = chaveGrupo(b, chave);
        return sinal * (typeof x === "string" ? cmpTexto(x, y) : x - y);
      });
      return linhas;
    }
    const linhas = Array.from(vista.idx);
    linhas.sort((a, b) => {
      const x = chaveEstab(a, chave);
      const y = chaveEstab(b, chave);
      return sinal * (typeof x === "string" ? cmpTexto(x, y) : x - y);
    });
    return linhas;
  }

  function dadosGrupo(g) {
    const setores = D.setoresDaEmpresa(g).map(D.nomeSetor);
    const muns = D.municipiosDaEmpresa(g).map(D.nomeMunicipio);
    const emp = g.empresa;
    const programas = emp ? Array.from(new Set(emp.protocolos.map((p) => p.programa))) : [];
    const vigencia = emp ? Math.max(...emp.protocolos.map((p) => p.vigencia || 0)) : 0;
    return {
      nome: emp ? emp.nome : D.texto.razao[g.posicoes[0]],
      raiz: emp ? emp.raiz : D.texto.raizes[g.raiz],
      municipio: muns.length > 1 ? `${muns[0]} +${muns.length - 1}` : muns[0] || "—",
      setor: setores.length > 1 ? `${setores[0]} +${setores.length - 1}` : setores[0] || "—",
      programa: programas.join(", ") || "—",
      estab: g.estab,
      pi: g.pi,
      vinculos: g.vinculos,
      aderencia: g.aderencia,
      rem: g.rem,
      vigencia: vigencia || null,
      situacao: seloGrupo(g),
    };
  }

  function dadosEstab(i) {
    const c = D.col;
    const cnae = D.dim.cnaes[c.cnae[i]] || { cod: "", desc: "" };
    return {
      razao: D.texto.razao[i],
      cnpj: D.texto.cnpj[i],
      municipio: D.nomeMunicipio(c.mun[i]),
      setor: D.nomeSetor(c.setor[i]),
      cnae: cnae.cod || "—",
      cnaeDesc: cnae.desc || "",
      tamanho: D.dim.tamanhos[c.tam[i]],
      regime: D.dim.celetistas[c.cele[i]],
      pi: c.pi[i],
      vinculos: c.v[i],
      rem: c.rem[i],
      situacao: seloEstab(i),
    };
  }

  function seloGrupo(g) {
    if (!g.incentivada) return '<span class="condec-selo condec-selo--nao">não incentivada</span>';
    if (g.semRais === g.estab) return '<span class="condec-selo condec-selo--sem">sem registro na RAIS</span>';
    if (g.semRais) return '<span class="condec-selo condec-selo--sem">parcial na RAIS</span>';
    return '<span class="condec-selo condec-selo--inc">incentivada</span>';
  }

  function seloEstab(i) {
    const c = D.col;
    if (c.sr[i] === 1) return '<span class="condec-selo condec-selo--sem">sem registro na RAIS</span>';
    if (c.inc[i] === D.INC_PROTOCOLO) return '<span class="condec-selo condec-selo--inc">com protocolo</span>';
    if (c.inc[i] === D.INC_FILIAL) return '<span class="condec-selo condec-selo--filial">filial de incentivada</span>';
    return '<span class="condec-selo condec-selo--nao">não incentivada</span>';
  }

  function celula(dados, coluna) {
    const valor = dados[coluna.chave];
    if (valor === null || valor === undefined || valor === "") return "—";
    if (coluna.classe === "condec-num") {
      if (coluna.chave === "rem") return valor ? fmt.moeda(valor) : "—";
      if (coluna.chave === "aderencia") return barraAderencia(valor);
      if (coluna.chave === "vigencia") return String(valor);
      return fmt.int(valor);
    }
    return valor;
  }

  function barraAderencia(valor) {
    if (valor === null || valor === undefined) return "—";
    const cor = valor < 80 ? "#b91c1c" : valor < 100 ? "#d97706" : "#177649";
    const w = Math.max(4, Math.min(100, (valor / 200) * 100));
    return `<span class="condec-aderencia-cel">${fmt.pct(valor)}<span class="condec-aderencia-barra"><i style="width:${w}%;background:${cor}"></i></span></span>`;
  }

  function renderTabela() {
    const cols = colunas();
    el("condecTabelaCabeca").innerHTML = `<tr>${cols
      .map(
        (c) =>
          `<th class="${c.classe || ""}" data-chave="${c.chave}" ${
            vista.ordem.chave === c.chave ? `data-ordem="${vista.ordem.dir}"` : ""
          }>${c.rotulo}</th>`
      )
      .join("")}</tr>`;

    const corpo = el("condecTabelaCorpo");
    if (!D.texto) {
      corpo.innerHTML = `<tr><td colspan="${cols.length}" class="condec-tabela__vazia">Carregando razões sociais…</td></tr>`;
      atualizarPaginacao(0, 1);
      return;
    }

    const linhas = ordenarLinhas();
    const totalPaginas = Math.max(1, Math.ceil(linhas.length / POR_PAGINA));
    vista.pagina = Math.min(vista.pagina, totalPaginas - 1);
    const pagina = linhas.slice(vista.pagina * POR_PAGINA, vista.pagina * POR_PAGINA + POR_PAGINA);

    if (!pagina.length) {
      corpo.innerHTML = `<tr><td colspan="${cols.length}" class="condec-tabela__vazia">Nenhum registro no recorte selecionado.</td></tr>`;
      atualizarPaginacao(0, 1);
      return;
    }

    const html = [];
    if (vista.modo === "empresa") {
      pagina.forEach((g) => {
        const dados = dadosGrupo(g);
        const aberta = vista.abertas.has(g.raiz);
        html.push(
          `<tr class="condec-linha-empresa ${aberta ? "is-aberta" : ""}" data-raiz="${g.raiz}">${cols
            .map((c, k) =>
              k === 0
                ? `<td class="${c.classe || ""}"><span class="condec-seta-drill">▸</span> ${celula(dados, c)}</td>`
                : `<td class="${c.classe || ""}">${celula(dados, c)}</td>`
            )
            .join("")}</tr>`
        );
        if (aberta) {
          g.posicoes.forEach((i) => {
            const f = dadosEstab(i);
            html.push(
              `<tr class="condec-linha-filha">
                <td class="condec-txt" title="${f.cnaeDesc}">${f.razao}</td>
                <td>${f.cnpj}</td>
                <td>${f.municipio}</td>
                <td>${f.setor}</td>
                <td>${f.tamanho}</td>
                <td class="condec-num">${fmt.int(f.pi)}</td>
                <td class="condec-num">${fmt.int(f.vinculos)}</td>
                <td class="condec-num">${f.rem ? fmt.moeda(f.rem) : "—"}</td>
                <td colspan="${cols.length - 8}">${f.situacao} <span class="condec-kpi__nota">${f.regime}</span></td>
              </tr>`
            );
          });
        }
      });
    } else {
      pagina.forEach((i) => {
        const dados = dadosEstab(i);
        html.push(
          `<tr title="${dados.cnaeDesc}">${cols
            .map((c) => `<td class="${c.classe || ""}">${celula(dados, c)}</td>`)
            .join("")}</tr>`
        );
      });
    }

    corpo.innerHTML = html.join("");
    atualizarPaginacao(linhas.length, totalPaginas);
    el("condecTabelaSub").textContent =
      vista.modo === "empresa"
        ? `${fmt.int(linhas.length)} empresas agrupadas pela raiz do CNPJ. Clique na linha para abrir os estabelecimentos.`
        : `${fmt.int(linhas.length)} estabelecimentos no recorte.`;
    ajustarJanelaTabela();
    atualizarIndicadorTabela();
  }

  function ajustarJanelaTabela() {
    const box = el("condecTabelaRolagem");
    if (!box) return;
    const cabeca = box.querySelector("thead tr");
    const linha = box.querySelector("tbody tr.condec-linha-empresa, tbody tr:not(.condec-linha-filha)");
    if (!cabeca || !linha || linha.querySelector(".condec-tabela__vazia")) {
      box.style.maxHeight = "";
      return;
    }
    const altura =
      cabeca.getBoundingClientRect().height + linha.getBoundingClientRect().height * 10;
    box.style.maxHeight = `${Math.ceil(altura + 1)}px`;
  }

  function atualizarIndicadorTabela() {
    const box = el("condecTabelaRolagem");
    const mais = el("condecTabelaMais");
    if (!box || !mais) return;
    const overflow = box.scrollWidth > box.clientWidth + 12;
    const noFim = box.scrollLeft + box.clientWidth >= box.scrollWidth - 8;
    mais.hidden = !overflow || noFim;
  }

  function atualizarPaginacao(total, totalPaginas) {
    vista.totalPaginas = totalPaginas;
    const inicio = total ? vista.pagina * POR_PAGINA + 1 : 0;
    const fim = Math.min(total, (vista.pagina + 1) * POR_PAGINA);
    el("condecPgInfo").textContent = total
      ? `${fmt.int(inicio)}–${fmt.int(fim)} de ${fmt.int(total)} · página ${vista.pagina + 1} de ${fmt.int(totalPaginas)}`
      : "sem registros";
    el("condecPgPrimeira").disabled = vista.pagina === 0;
    el("condecPgAnterior").disabled = vista.pagina === 0;
    el("condecPgProxima").disabled = vista.pagina >= totalPaginas - 1;
    el("condecPgUltima").disabled = vista.pagina >= totalPaginas - 1;
  }

  function irParaPagina(n) {
    if (n < 0 || n > vista.totalPaginas - 1) return;
    vista.pagina = n;
    renderTabela();
  }

  function ligarTabela() {
    el("condecTabelaCabeca").addEventListener("click", (ev) => {
      const th = ev.target.closest("th");
      if (!th) return;
      const chave = th.dataset.chave;
      if (vista.ordem.chave === chave) vista.ordem.dir = vista.ordem.dir === "desc" ? "asc" : "desc";
      else vista.ordem = { chave, dir: "desc" };
      vista.pagina = 0;
      renderTabela();
    });

    el("condecTabelaCorpo").addEventListener("click", (ev) => {
      const tr = ev.target.closest(".condec-linha-empresa");
      if (!tr) return;
      const raiz = Number(tr.dataset.raiz);
      if (vista.abertas.has(raiz)) vista.abertas.delete(raiz);
      else vista.abertas.add(raiz);
      renderTabela();
    });
  }

  // ---------------------------------------------------------------- exportação

  function exportarCsv() {
    if (!D.texto) return;
    const cols = colunas();
    const linhas = ordenarLinhas();
    const semTags = (v) => String(v === null || v === undefined ? "" : v).replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim();
    const escapar = (v) => {
      const t = semTags(v);
      return /[";\n]/.test(t) ? `"${t.replace(/"/g, '""')}"` : t;
    };

    const saida = [cols.map((c) => escapar(c.rotulo)).join(";")];
    linhas.forEach((linha) => {
      const dados = vista.modo === "empresa" ? dadosGrupo(linha) : dadosEstab(linha);
      saida.push(
        cols
          .map((c) => {
            const valor = dados[c.chave];
            if (typeof valor === "number") return String(valor).replace(".", ",");
            return escapar(valor);
          })
          .join(";")
      );
    });

    const blob = new Blob(["\uFEFF" + saida.join("\r\n")], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `painel-rais-condec-${vista.modo}-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }

  // ------------------------------------------------------------------ arranque

  function preencherCabecalho() {
    const t = D.dim.totais;
    const refs = D.dim.referencias || (D.dim.referencia ? [D.dim.referencia] : []);
    const nova = t.por_referencia && t.por_referencia.length
      ? t.por_referencia[t.por_referencia.length - 1]
      : null;
    atualizarTagReferencia();
    el("condecTagEstab").textContent = fmt.int(nova ? nova.registros : t.linhas_rais);
    el("condecTagProtocolos").textContent = fmt.int(t.protocolos);
    el("condecTagEmpresas").textContent = fmt.int(t.raizes_incentivadas);
    el("condecNotaMatch").textContent = fmt.int(t.protocolos_na_rais);
    el("condecNotaReferencia").textContent = refs.join(", ") || D.dim.referencia;
  }

  function esconderCarregamento() {
    const caixa = el("condecCarregando");
    caixa.classList.add("condec-is-oculto");
    setTimeout(() => {
      caixa.style.display = "none";
    }, 300);
  }

  function mostrarErro(erro) {
    const texto = el("condecCarregandoTexto");
    texto.className = "condec-carregando__texto condec-carregando__texto--erro";
    texto.innerHTML =
      window.location.protocol === "file:"
        ? "O painel precisa ser servido por HTTP. Na raiz do projeto, execute <code>py -m http.server 8000</code> e abra <code>http://localhost:8000</code>."
        : `Falha ao carregar os dados: ${erro.message}. Rode <code>py backend/etl/condec_preparar_dados.py</code> para gerar <code>frontend/data/condec/</code>.`;
    const spinner = document.querySelector(".condec-carregando__spinner");
    if (spinner) spinner.style.display = "none";
  }

  async function iniciar() {
    try {
      await D.carregar((rotulo) => {
        el("condecCarregandoTexto").textContent = `Carregando ${rotulo}…`;
      });
      preencherCabecalho();
      montarFiltros();
      ligarTabela();
      ligarDialogoSemRais();
      await M.iniciar().catch((e) => console.warn("[condec] condecMapa:", e));
      recalcular();
      esconderCarregamento();

      // A razão social é o arquivo mais pesado e só a tabela e a busca dependem dela.
      await D.carregarTexto();
      el("condecFiltroBusca").disabled = false;
      el("condecFiltroBusca").placeholder = "ex.: AERIS, 12528708";
      renderTabela();
      atualizarComparacao();
    } catch (erro) {
      console.error(erro);
      mostrarErro(erro);
    }
  }

  // ------------------------------------------------------- ciclo de vida da aba

  let estadoCarga = "vazio";

  function abaAtiva() {
    return document.getElementById("secaoMapaCe")?.classList.contains("section-map-ce--condec") === true;
  }

  /**
   * A aba carrega ~57 MB de JSON colunares; por isso so na primeira ativacao.
   * Nas seguintes, apenas reaplica o recorte sobre o mapa compartilhado.
   */
  function onPageActivate() {
    if (!abaAtiva()) return;
    if (estadoCarga === "vazio") {
      estadoCarga = "emCarga";
      iniciar().then(
        () => {
          estadoCarga = "pronto";
        },
        () => {
          estadoCarga = "erro";
        }
      );
      return;
    }
    if (estadoCarga === "pronto") atualizarMapa();
  }

  function refresh() {
    if (estadoCarga === "pronto" && abaAtiva()) atualizarMapa();
  }

  /** Clique no poligono do mapa: recebe o codigo IBGE de 6 digitos. */
  function filtrarMunicipio(codigo) {
    if (estadoCarga !== "pronto") return;
    aplicarFiltroMunicipio(codigo);
  }

  window.condecApi = {
    onPageActivate,
    refresh,
    filtrarMunicipio,
  };
})();
