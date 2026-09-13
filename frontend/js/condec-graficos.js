/*
 * Aba CONDEC — graficos ApexCharts (portado de 3_rais_emprego/js/painel-graficos.js).
 *
 * Gerado por scripts/condec_portar.py.
 */
/**
 * Gráficos do painel (ApexCharts). Cada função monta as opções a partir das
 * agregações de PainelDados; a primeira chamada renderiza e as seguintes atualizam.
 */
window.CondecGraficos = (function () {
  const D = () => window.CondecDados;

  const COR_INC = "#00a859";
  const COR_DEMAIS = "#94a3b8";
  const COR_AZUL = "#1d4ed8";
  const COR_AMBAR = "#d97706";
  const COR_TINTA = "#0d1548";
  const COR_CINZA = "#5c678f";
  const COR_VERM = "#b91c1c";

  const fInt = new Intl.NumberFormat("pt-BR", { maximumFractionDigits: 0 });
  const fDec = new Intl.NumberFormat("pt-BR", { minimumFractionDigits: 1, maximumFractionDigits: 1 });
  const fMoeda = new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL", maximumFractionDigits: 0 });

  const fmt = {
    int: (v) => fInt.format(Math.round(v || 0)),
    dec: (v) => fDec.format(v || 0),
    moeda: (v) => fMoeda.format(v || 0),
    pct: (v) => `${fDec.format(v || 0)}%`,
    /** Rótulo curto para eixos, onde milhares e milhões não cabem por extenso. */
    compacto: (v) => {
      const n = Math.round(v || 0);
      if (Math.abs(n) >= 1e6) return `${fDec.format(n / 1e6)} mi`;
      if (Math.abs(n) >= 1e3) return `${fInt.format(n / 1e3)} mil`;
      return fInt.format(n);
    },
  };

  const EIXO_VALOR = { tickAmount: 4, labels: { formatter: (v) => fmt.compacto(v) } };

  function rotulos(formatar) {
    const fn = formatar || ((v) => (v ? fmt.compacto(v) : ""));
    return {
      enabled: true,
      formatter: fn,
      style: { fontSize: "10px", fontWeight: 600, colors: [COR_TINTA] },
      background: { enabled: false },
      dropShadow: { enabled: false },
    };
  }

  function rotulosRosca() {
    return {
      enabled: true,
      formatter: (pct, opts) => {
        const v = opts.w.config.series[opts.seriesIndex];
        if (!v) return "";
        return `${fmt.compacto(v)} (${fmt.pct(pct)})`;
      },
      style: { fontSize: "11px", fontWeight: 700, colors: [COR_TINTA] },
      background: {
        enabled: true,
        foreColor: COR_TINTA,
        padding: 4,
        borderRadius: 4,
        borderWidth: 0,
        opacity: 0.78,
        dropShadow: { enabled: false },
      },
      dropShadow: { enabled: true, color: "#fff", top: 0, left: 0, blur: 2, opacity: 1 },
    };
  }

  function eventosSeparacao(id) {
    return {
      mounted: () => pedirSeparacaoRotulos(id),
      updated: () => pedirSeparacaoRotulos(id),
      animationEnd: () => pedirSeparacaoRotulos(id),
    };
  }

  const graficos = new Map();
  let escalaDispersao = "log";
  let metricaRegioes = "empresas";

  const BASE = {
    chart: {
      fontFamily: 'system-ui, "Segoe UI", sans-serif',
      foreColor: COR_CINZA,
      toolbar: { show: false },
      animations: { enabled: false },
      width: "100%",
      redrawOnParentResize: true,
      redrawOnWindowResize: true,
    },
    dataLabels: { enabled: false },
    grid: { borderColor: "#edf1f6", strokeDashArray: 3 },
    legend: { position: "top", horizontalAlign: "left", fontSize: "12px", markers: { radius: 3 } },
    noData: { text: "Sem dados no recorte selecionado", style: { color: COR_CINZA, fontSize: "13px" } },
  };

  function mesclar(...objs) {
    const saida = {};
    objs.forEach((o) => {
      Object.entries(o || {}).forEach(([k, v]) => {
        if (v && typeof v === "object" && !Array.isArray(v)) saida[k] = mesclar(saida[k], v);
        else saida[k] = v;
      });
    });
    return saida;
  }

  /**
   * Desenha ou atualiza um gráfico. A falha de um card não pode derrubar o painel,
   * então o erro fica contido e visível apenas no card correspondente.
   */
  function desenhar(id, opcoes) {
    const alvo = document.getElementById(id);
    if (!alvo) return;
    const cfg = mesclar(BASE, opcoes);
    try {
      const existente = graficos.get(id);
      const tipo = (cfg.chart && cfg.chart.type) || "";
      if (existente && (tipo === "donut" || tipo === "pie" || tipo === "radialBar")) {
        existente.destroy();
        graficos.delete(id);
        alvo.innerHTML = "";
      } else if (existente) {
        existente.updateOptions(cfg, false, false, false);
        return;
      }
      const g = new ApexCharts(alvo, cfg);
      graficos.set(id, g);
      g.render();
    } catch (erro) {
      console.error(`[condec] gráfico ${id}:`, erro);
      graficos.delete(id);
      alvo.innerHTML = `<div class="condec-grafico__vazio">Não foi possível desenhar este gráfico.<br /><small>${erro.message}</small></div>`;
    }
  }

  function setEscalaDispersao(valor) {
    escalaDispersao = valor;
  }

  function setMetricaRegioes(valor) {
    metricaRegioes = valor === "vinculos" ? "vinculos" : "empresas";
  }

  // ------------------------------------------------------------- 1. dispersão

  function dispersao(grupos) {
    const empresas = grupos.filter((e) => e.incentivada && e.pi > 0);

    // O ApexCharts não aplica escala logarítmica em eixo x numérico, então a
    // transformação é feita aqui e desfeita na formatação dos rótulos.
    const log = escalaDispersao === "log";
    const t = (v) => (log ? Math.log10(Math.max(v, 1)) : v);
    const inv = (v) => (log ? Math.pow(10, v) : v);

    const pontos = empresas.map((e) => ({ x: t(e.pi), y: t(e.vinculos), meta: e }));

    const maximo = Math.max(10, ...empresas.map((e) => Math.max(e.pi, e.vinculos)));
    const limite = log ? Math.ceil(Math.log10(maximo)) : maximo;
    const paridade = [
      { x: log ? 0 : 1, y: log ? 0 : 1 },
      { x: limite, y: limite },
    ];

    desenhar("condecGraficoDispersao", {
      chart: { type: "line", height: 420, zoom: { enabled: true, type: "xy" } },
      series: [
        { name: "Empresas incentivadas", type: "scatter", data: pontos },
        { name: "Paridade (1 vínculo por emprego comprometido)", type: "line", data: paridade },
      ],
      colors: [COR_INC, COR_AMBAR],
      stroke: { width: [0, 2], dashArray: [0, 6], curve: "straight" },
      markers: { size: [6, 0], strokeWidth: 1, strokeColors: "#fff", hover: { sizeOffset: 3 } },
      xaxis: {
        type: "numeric",
        min: log ? 0 : undefined,
        max: limite,
        tickAmount: log ? limite : 6,
        decimalsInFloat: 0,
        title: { text: "Empregos comprometidos no protocolo", style: { fontSize: "12px", fontWeight: 600 } },
        labels: { formatter: (v) => fmt.int(inv(v)) },
      },
      yaxis: {
        min: log ? 0 : 0,
        max: limite,
        tickAmount: log ? limite : 6,
        decimalsInFloat: 0,
        title: { text: "Vínculos na RAIS", style: { fontSize: "12px", fontWeight: 600 } },
        labels: { formatter: (v) => fmt.int(inv(v)) },
      },
      tooltip: {
        shared: false,
        intersect: true,
        custom: ({ seriesIndex, dataPointIndex }) => {
          if (seriesIndex !== 0) return "";
          const e = pontos[dataPointIndex].meta;
          const nome = e.empresa ? e.empresa.nome : "Empresa incentivada";
          const aderencia = e.pi ? (e.vinculos / e.pi) * 100 : 0;
          const muns = D().municipiosDaEmpresa(e).map((m) => D().nomeMunicipio(m));
          return `<div class="condec-mapa-popup" style="padding:9px 11px">
            <h3>${nome}</h3>
            <dl>
              <dt>Comprometidos</dt><dd>${fmt.int(e.pi)}</dd>
              <dt>Vínculos RAIS</dt><dd>${fmt.int(e.vinculos)}</dd>
              <dt>Aderência</dt><dd>${fmt.pct(aderencia)}</dd>
              <dt>Estabelecimentos</dt><dd>${fmt.int(e.estab)}</dd>
              <dt>Remuneração média</dt><dd>${fmt.moeda(e.rem)}</dd>
              <dt>Município</dt><dd>${muns.slice(0, 2).join(", ") || "—"}</dd>
            </dl></div>`;
        },
      },
    });
  }

  // ------------------------------------------------------ 2. composição setorial

  function setores(idx) {
    const dim = D().dim;
    const linhas = D().agregarPorChave(idx, "setor", dim.setores.length);
    const ordem = linhas
      .map((l, i) => ({ ...l, nome: dim.setores[i] }))
      .sort((a, b) => b.vinculos - a.vinculos);

    desenhar("condecGraficoSetor", {
      chart: { type: "bar", height: 320, stacked: true },
      series: [
        { name: "Incentivadas", data: ordem.map((l) => l.vinculosInc) },
        { name: "Demais estabelecimentos", data: ordem.map((l) => l.vinculos - l.vinculosInc) },
      ],
      colors: [COR_INC, COR_DEMAIS],
      plotOptions: { bar: { horizontal: true, borderRadius: 3, barHeight: "68%" } },
      dataLabels: rotulos((v) => (v >= 1000 ? fmt.compacto(v) : "")),
      xaxis: { categories: ordem.map((l) => l.nome), ...EIXO_VALOR },
      tooltip: { y: { formatter: (v) => `${fmt.int(v)} vínculos` } },
    });
  }

  // ------------------------------------------------- 3. remuneração por setor

  function remuneracaoSetor(idx) {
    const dim = D().dim;
    const linhas = D()
      .agregarPorChave(idx, "setor", dim.setores.length)
      .map((l, i) => ({ ...l, nome: dim.setores[i] }))
      .filter((l) => l.vinculos > 0)
      .sort((a, b) => b.remInc - a.remInc);

    desenhar("condecGraficoRemSetor", {
      chart: { type: "bar", height: 320 },
      series: [
        { name: "Incentivadas", data: linhas.map((l) => Math.round(l.remInc)) },
        { name: "Demais estabelecimentos", data: linhas.map((l) => Math.round(l.remNao)) },
      ],
      colors: [COR_INC, COR_DEMAIS],
      plotOptions: { bar: { borderRadius: 3, columnWidth: "62%" } },
      dataLabels: rotulos((v) => (v ? fmt.moeda(v) : "")),
      xaxis: { categories: linhas.map((l) => l.nome), labels: { rotate: -30, style: { fontSize: "11px" } } },
      yaxis: { labels: { formatter: (v) => fmt.moeda(v) } },
      tooltip: { y: { formatter: (v) => (v ? fmt.moeda(v) : "sem vínculos no recorte") } },
    });
  }

  // ------------------------------------------------------- 4. top municípios

  function municipios(idx) {
    const totais = D().municipiosTotais;
    const linhas = D()
      .agregarPorMunicipio(idx)
      .filter((l) => l.vinculos > 0)
      .sort((a, b) => b.vinculosInc - a.vinculosInc || b.vinculos - a.vinculos)
      .slice(0, 15);
    // Participação sempre sobre o emprego total do município, não sobre o recorte.
    linhas.forEach((l) => {
      const total = totais[l.idx].vinculos;
      l.participacao = total ? (l.vinculosInc / total) * 100 : 0;
    });

    desenhar("condecGraficoMunicipios", {
      chart: { type: "bar", height: 440, stacked: true },
      series: [
        { name: "Incentivadas", data: linhas.map((l) => l.vinculosInc) },
        { name: "Demais estabelecimentos", data: linhas.map((l) => l.vinculos - l.vinculosInc) },
      ],
      colors: [COR_INC, COR_DEMAIS],
      plotOptions: { bar: { horizontal: true, borderRadius: 3, barHeight: "72%" } },
      dataLabels: rotulos((v) => (v >= 500 ? fmt.compacto(v) : "")),
      // Fortaleza concentra tanto emprego que a fatia incentivada fica quase
      // invisível na barra; a participação vai no próprio rótulo da categoria.
      xaxis: {
        categories: linhas.map((l) => `${l.nome} · ${fmt.dec(l.participacao)}%`),
        ...EIXO_VALOR,
        tickAmount: 5,
      },
      tooltip: { y: { formatter: (v) => `${fmt.int(v)} vínculos` } },
    });
  }

  // --------------------------------------------------------- 5. programas

  function programas(idx) {
    const linhas = D().agregarPorPrograma(idx);

    desenhar("condecGraficoProgramas", {
      chart: { type: "line", height: 320 },
      series: [
        { name: "Empregos comprometidos", type: "column", data: linhas.map((l) => l.pi) },
        { name: "Vínculos na RAIS", type: "column", data: linhas.map((l) => l.vinculos) },
        { name: "Empresas", type: "line", data: linhas.map((l) => l.empresas) },
      ],
      colors: [COR_AMBAR, COR_INC, COR_TINTA],
      stroke: { width: [0, 0, 3], curve: "smooth" },
      markers: { size: [0, 0, 5] },
      plotOptions: { bar: { borderRadius: 3, columnWidth: "58%" } },
      dataLabels: { ...rotulos(), enabledOnSeries: [0, 1] },
      xaxis: { categories: linhas.map((l) => l.nome) },
      yaxis: [
        { seriesName: "Empregos comprometidos", labels: { formatter: (v) => fmt.compacto(v) }, title: { text: "Empregos" } },
        { seriesName: "Empregos comprometidos", show: false },
        {
          opposite: true,
          seriesName: "Empresas",
          labels: { formatter: (v) => fmt.int(v) },
          title: { text: "Empresas" },
        },
      ],
      tooltip: { shared: true, y: { formatter: (v) => fmt.int(v) } },
    });
  }

  // ----------------------------------------------------- 6. faixas de tamanho

  function tamanhos(idx) {
    const dim = D().dim;
    const linhas = D()
      .agregarPorChave(idx, "tam", dim.tamanhos.length)
      .map((l, i) => ({ ...l, nome: rotuloCurto(dim.tamanhos[i]) }))
      .filter((l) => l.estab > 0);

    desenhar("condecGraficoTamanho", {
      chart: { type: "bar", height: 320, stacked: true },
      series: [
        { name: "Incentivadas", data: linhas.map((l) => l.vinculosInc) },
        { name: "Demais estabelecimentos", data: linhas.map((l) => l.vinculos - l.vinculosInc) },
      ],
      colors: [COR_INC, COR_DEMAIS],
      plotOptions: { bar: { horizontal: true, borderRadius: 3, barHeight: "70%" } },
      dataLabels: rotulos((v) => (v >= 500 ? fmt.compacto(v) : "")),
      xaxis: { categories: linhas.map((l) => l.nome), ...EIXO_VALOR },
      tooltip: { y: { formatter: (v) => `${fmt.int(v)} vínculos` } },
    });
  }

  function pedirSeparacaoRotulos(id) {
    window.requestAnimationFrame(() => {
      const alvo = document.getElementById(id);
      if (alvo) separarRotulosSobrepostos(alvo);
    });
  }

  function textosDeRotulo(alvo) {
    return Array.from(alvo.querySelectorAll(".apexcharts-data-labels text, text.apexcharts-pie-label")).filter((t) => {
      if (!t.textContent || !t.textContent.trim()) return false;
      if (t.classList.contains("apexcharts-datalabel-value")) return false;
      if (t.classList.contains("apexcharts-datalabel-label") && t.closest(".apexcharts-datalabels-group")) return false;
      return true;
    });
  }

  function aplicarDeslocamentoRotulo(item, dy) {
    const aplicar = (el) => {
      if (!el) return;
      const y = parseFloat(el.getAttribute("y") || "0") - dy;
      el.setAttribute("y", String(y));
    };
    aplicar(item.t);
    aplicar(item.g && item.g.querySelector && item.g.querySelector("rect"));
    item.box.top -= dy;
    item.box.bottom -= dy;
  }

  function separarRotulosSobrepostos(alvo) {
    const textos = textosDeRotulo(alvo);
    textos.forEach((t) => {
      const g = t.parentNode;
      const rect = g && g.querySelector && g.querySelector("rect");
      if (!t.dataset.origY) t.dataset.origY = t.getAttribute("y") || "0";
      t.setAttribute("y", t.dataset.origY);
      if (rect) {
        if (!rect.dataset.origY) rect.dataset.origY = rect.getAttribute("y") || "0";
        rect.setAttribute("y", rect.dataset.origY);
      }
    });
    const itens = textos
      .map((t) => {
        const box = t.getBoundingClientRect();
        return {
          t,
          g: t.parentNode,
          box: { top: box.top, bottom: box.bottom, left: box.left, right: box.right },
        };
      })
      .filter((i) => i.box.right > i.box.left);

    const sobrepoe = (a, b, folga) =>
      a.left < b.right + folga && b.left < a.right + folga && a.top < b.bottom + folga && b.top < a.bottom + folga;

    const colunas = new Map();
    itens.forEach((item) => {
      const chave = Math.round(item.box.left / 12);
      if (!colunas.has(chave)) colunas.set(chave, []);
      colunas.get(chave).push(item);
    });
    colunas.forEach((lista) => {
      if (lista.length < 2) return;
      lista.sort((a, b) => a.box.top - b.box.top);
      for (let i = 1; i < lista.length; i += 1) {
        const cima = lista[i - 1];
        const baixo = lista[i];
        const folga = 10;
        const overlap = cima.box.bottom + folga - baixo.box.top;
        if (overlap <= 0) continue;
        aplicarDeslocamentoRotulo(cima, overlap + 12);
      }
    });

    const lista = itens.slice().sort((a, b) => a.box.top - b.box.top);
    for (let i = 0; i < lista.length; i += 1) {
      for (let j = i + 1; j < lista.length; j += 1) {
        const cima = lista[i];
        const baixo = lista[j];
        const folga = 10;
        if (!sobrepoe(cima.box, baixo.box, folga)) continue;
        const overlap = cima.box.bottom + folga - baixo.box.top;
        if (overlap <= 0) continue;
        aplicarDeslocamentoRotulo(cima, overlap + 12);
      }
    }
  }

  function porteIbge(idx) {
    const linhas = D()
      .agregarPorPorteIbge(idx)
      .filter((l) => l.empresas > 0 || l.vinculos > 0);

    desenhar("condecGraficoPorteIbge", {
      chart: {
        type: "line",
        height: 320,
        events: eventosSeparacao("condecGraficoPorteIbge"),
      },
      series: [
        { name: "Vínculos", type: "column", data: linhas.map((l) => l.vinculos) },
        { name: "Empresas", type: "line", data: linhas.map((l) => l.empresas) },
      ],
      colors: [COR_INC, COR_TINTA],
      stroke: { width: [0, 3], curve: "smooth" },
      markers: { size: [0, 5] },
      plotOptions: { bar: { borderRadius: 3, columnWidth: "52%", dataLabels: { position: "top" } } },
      dataLabels: {
        enabled: true,
        enabledOnSeries: [0, 1],
        formatter: (v, opts) => (opts.seriesIndex === 1 ? fmt.int(v) : v ? fmt.compacto(v) : ""),
        offsetY: -4,
        style: { fontSize: "11px", fontWeight: 700, colors: [COR_TINTA] },
        background: {
          enabled: true,
          foreColor: COR_TINTA,
          padding: 5,
          borderRadius: 4,
          borderWidth: 0,
          opacity: 0.72,
          dropShadow: { enabled: false },
        },
        dropShadow: { enabled: true, color: "#fff", top: 0, left: 0, blur: 2, opacity: 1 },
      },
      xaxis: {
        categories: linhas.map((l) => l.nome),
        title: { text: "Porte IBGE da empresa" },
      },
      yaxis: [
        {
          seriesName: "Vínculos",
          labels: { formatter: (v) => fmt.compacto(v) },
          title: { text: "Vínculos" },
          min: 0,
        },
        {
          opposite: true,
          seriesName: "Empresas",
          labels: { formatter: (v) => fmt.int(v) },
          title: { text: "Empresas" },
          min: 0,
        },
      ],
      tooltip: {
        shared: true,
        y: {
          formatter: (v, opts) => {
            const l = linhas[opts.dataPointIndex];
            if (!l) return fmt.int(v);
            return opts.seriesIndex === 1
              ? `${fmt.int(v)} empresas · ${l.faixa}`
              : `${fmt.int(v)} vínculos`;
          },
        },
      },
    });
    pedirSeparacaoRotulos("condecGraficoPorteIbge");
  }

  function rotuloCurto(texto) {
    return (texto || "").replace(/ vínculos?/i, "").replace("1000 ou mais", "1.000 ou mais");
  }

  // ------------------------------------------------------------- 7. safras

  function safras(idx) {
    const linhas = D().agregarPorAno(idx, "ini");

    desenhar("condecGraficoSafras", {
      chart: { type: "line", height: 320 },
      series: [
        { name: "Protocolos iniciados", type: "column", data: linhas.map((l) => ({ x: String(l.ano), y: l.protocolos })) },
        { name: "Empregos comprometidos", type: "line", data: linhas.map((l) => ({ x: String(l.ano), y: l.pi })) },
      ],
      colors: [COR_AZUL, COR_AMBAR],
      stroke: { width: [0, 3], curve: "smooth" },
      markers: { size: [0, 4] },
      plotOptions: { bar: { borderRadius: 2, columnWidth: "60%" } },
      dataLabels: { ...rotulos((v) => (v ? fmt.int(v) : "")), enabledOnSeries: [0] },
      xaxis: {
        type: "category",
        tickPlacement: "on",
        tickAmount: Math.min(12, linhas.length),
        labels: { rotate: -45, style: { fontSize: "10px" }, hideOverlappingLabels: true },
      },
      yaxis: [
        { labels: { formatter: (v) => fmt.int(v) }, title: { text: "Protocolos" } },
        { opposite: true, labels: { formatter: (v) => fmt.compacto(v) }, title: { text: "Empregos" } },
      ],
      tooltip: { shared: true, y: { formatter: (v) => fmt.int(v) } },
    });
  }

  // ---------------------------------------------------------- 8. vigências

  function vigencias(idx) {
    const anoAtual = new Date().getFullYear();
    const bruto = D().agregarPorAno(idx, "fim");
    const porAno = new Map(bruto.map((l) => [l.ano, l]));
    const anos = [];
    for (let a = 2025; a <= 2032; a += 1) anos.push(a);
    const valor = (ano) => (porAno.get(ano) || { protocolos: 0, pi: 0 });

    desenhar("condecGraficoVigencias", {
      chart: { type: "bar", height: 320, stacked: true },
      series: [
        {
          name: "Já encerrada",
          data: anos.map((a) => (a < anoAtual ? valor(a).protocolos : 0)),
        },
        {
          name: "Vence neste ano",
          data: anos.map((a) => (a === anoAtual ? valor(a).protocolos : 0)),
        },
        {
          name: "Vence depois",
          data: anos.map((a) => (a > anoAtual ? valor(a).protocolos : 0)),
        },
      ],
      colors: [COR_DEMAIS, COR_AMBAR, COR_INC],
      plotOptions: { bar: { borderRadius: 2, columnWidth: "55%" } },
      dataLabels: rotulos((v) => (v ? fmt.int(v) : "")),
      xaxis: { categories: anos.map(String), title: { text: "Ano de término da vigência" } },
      yaxis: { labels: { formatter: (v) => fmt.int(v) }, title: { text: "Protocolos" } },
      tooltip: {
        shared: true,
        intersect: false,
        y: {
          formatter: (v, opts) => {
            const ano = anos[opts.dataPointIndex];
            const l = valor(ano);
            if (!v) return "—";
            return `${fmt.int(v)} protocolos · ${fmt.int(l.pi)} empregos comprometidos`;
          },
        },
      },
    });
  }

  // --------------------------------------------------------- 9. calçadista

  function calcadista(idx) {
    const dim = D().dim;
    const linhas = D()
      .agregarPorChave(idx, "calc", dim.calcadistas.length)
      .map((l, i) => ({ ...l, nome: dim.calcadistas[i] === "Sim" ? "Calçadista" : dim.calcadistas[i] === "Não" ? "Demais atividades" : "Sem informação" }))
      .filter((l) => l.estab > 0);

    desenhar("condecGraficoCalcadista", {
      chart: { type: "bar", height: 300, stacked: true },
      series: [
        { name: "Incentivadas", data: linhas.map((l) => l.vinculosInc) },
        { name: "Demais estabelecimentos", data: linhas.map((l) => l.vinculos - l.vinculosInc) },
      ],
      colors: [COR_INC, COR_DEMAIS],
      plotOptions: { bar: { horizontal: true, borderRadius: 3, barHeight: "52%" } },
      dataLabels: rotulos((v) => (v ? fmt.compacto(v) : "")),
      xaxis: { categories: linhas.map((l) => l.nome), ...EIXO_VALOR },
      tooltip: {
        y: { formatter: (v) => `${fmt.int(v)} vínculos` },
        x: {
          formatter: (nome) => {
            const l = linhas.find((x) => x.nome === nome);
            return l ? `${nome} — remuneração média ${fmt.moeda(l.rem)}` : nome;
          },
        },
      },
    });
  }

  // ------------------------------------------------------------ 10. regime

  function regime(idx) {
    const dim = D().dim;
    const linhas = D()
      .agregarPorChave(idx, "cele", dim.celetistas.length)
      .map((l, i) => ({ ...l, nome: dim.celetistas[i] }))
      .filter((l) => l.vinculos > 0);

    desenhar("condecGraficoRegime", {
      chart: { type: "donut", height: 300, events: eventosSeparacao("condecGraficoRegime") },
      series: linhas.map((l) => l.vinculos),
      labels: linhas.map((l) => l.nome),
      colors: [COR_INC, COR_AZUL, COR_AMBAR, COR_DEMAIS],
      legend: { position: "bottom", horizontalAlign: "center" },
      dataLabels: rotulosRosca(),
      plotOptions: {
        pie: {
          dataLabels: { offset: 10, minAngleToShowLabel: 4 },
          donut: {
            size: "62%",
            labels: {
              show: true,
              value: { formatter: (v) => fmt.int(v), fontSize: "20px", fontWeight: 700, color: COR_TINTA },
              total: { show: true, label: "Vínculos", formatter: () => fmt.int(linhas.reduce((s, l) => s + l.vinculos, 0)) },
            },
          },
        },
      },
      tooltip: { y: { formatter: (v) => `${fmt.int(v)} vínculos` } },
    });
    pedirSeparacaoRotulos("condecGraficoRegime");
  }

  function institucional(idx) {
    const c = D().col;
    const bolsos = [
      { nome: "Privado", vinculos: 0 },
      { nome: "Público", vinculos: 0 },
      { nome: "Não informado", vinculos: 0 },
    ];
    if (c.pub) {
      for (let j = 0; j < idx.length; j += 1) {
        const i = idx[j];
        const k = c.pub[i];
        if (k >= 0 && k < bolsos.length) bolsos[k].vinculos += c.v[i];
      }
    }
    const linhas = bolsos.filter((l) => l.vinculos > 0);
    const total = linhas.reduce((s, l) => s + l.vinculos, 0);
    const cores = { Privado: COR_AZUL, Público: COR_TINTA, "Não informado": COR_DEMAIS };

    desenhar("condecGraficoInstitucional", {
      chart: { type: "donut", height: 300, events: eventosSeparacao("condecGraficoInstitucional") },
      series: linhas.map((l) => l.vinculos),
      labels: linhas.map((l) => l.nome),
      colors: linhas.map((l) => cores[l.nome] || COR_DEMAIS),
      legend: { position: "bottom", horizontalAlign: "center" },
      dataLabels: rotulosRosca(),
      plotOptions: {
        pie: {
          dataLabels: { offset: 10, minAngleToShowLabel: 4 },
          donut: {
            size: "62%",
            labels: {
              show: true,
              value: { formatter: (v) => fmt.int(v), fontSize: "20px", fontWeight: 700, color: COR_TINTA },
              total: { show: true, label: "Vínculos", formatter: () => fmt.int(total) },
            },
          },
        },
      },
      tooltip: {
        y: {
          formatter: (v) => {
            const pct = total ? (v / total) * 100 : 0;
            return `${fmt.int(v)} vínculos · ${fmt.pct(pct)}`;
          },
        },
      },
    });
    pedirSeparacaoRotulos("condecGraficoInstitucional");
  }

  function nomeCurto(texto, max = 28) {
    const t = String(texto || "");
    return t.length > max ? `${t.slice(0, max - 1)}…` : t;
  }

  function quartis(valores) {
    const arr = valores.slice().sort((a, b) => a - b);
    if (!arr.length) return null;
    const q = (p) => {
      const i = (arr.length - 1) * p;
      const lo = Math.floor(i);
      const hi = Math.ceil(i);
      return arr[lo] + (arr[hi] - arr[lo]) * (i - lo);
    };
    return [arr[0], q(0.25), q(0.5), q(0.75), arr[arr.length - 1]];
  }

  function gauge(totais) {
    const pct = totais.pi ? (totais.vinculosInc / totais.pi) * 100 : 0;
    const cor = pct < 80 ? COR_VERM : pct < 100 ? COR_AMBAR : COR_INC;
    const preenchido = Math.min(100, Math.max(0, (pct / 200) * 100));

    desenhar("condecGraficoGauge", {
      chart: { type: "radialBar", height: 300 },
      series: [preenchido],
      labels: ["Aderência"],
      colors: [cor],
      plotOptions: {
        radialBar: {
          startAngle: -90,
          endAngle: 90,
          hollow: { size: "58%" },
          track: { background: "#e8edf4", strokeWidth: "100%" },
          dataLabels: {
            name: { offsetY: 18, fontSize: "13px", color: COR_CINZA },
            value: {
              offsetY: -16,
              fontSize: "28px",
              fontWeight: 700,
              color: COR_TINTA,
              formatter: () => (totais.pi ? fmt.pct(pct) : "—"),
            },
          },
        },
      },
      legend: { show: false },
    });
  }

  function rankingAderencia(grupos) {
    const linhas = grupos
      .filter((e) => e.incentivada && e.pi > 0)
      .sort((a, b) => (a.aderencia || 0) - (b.aderencia || 0))
      .slice(0, 20);
    const nomes = linhas.map((e) => nomeCurto(e.empresa ? e.empresa.nome : "Empresa"));
    const cores = linhas.map((e) => (e.aderencia < 100 ? COR_VERM : COR_INC));

    desenhar("condecGraficoAderencia", {
      chart: { type: "bar", height: 440 },
      series: [{ name: "Aderência", data: linhas.map((e) => Math.round(e.aderencia || 0)) }],
      colors: cores,
      plotOptions: { bar: { horizontal: true, distributed: true, borderRadius: 3, barHeight: "72%" } },
      dataLabels: rotulos((v) => fmt.pct(v)),
      xaxis: { categories: nomes, labels: { formatter: (v) => `${fmt.int(v)}%` } },
      legend: { show: false },
      tooltip: {
        y: {
          formatter: (v, opts) => {
            const e = linhas[opts.dataPointIndex];
            if (!e) return fmt.pct(v);
            return `${fmt.pct(v)} · ${fmt.int(e.vinculos)} vínculos / ${fmt.int(e.pi)} PI`;
          },
        },
      },
    });
  }

  function heatmap(idx) {
    const dim = D().dim;
    const mun = D().agregarPorMunicipio(idx)
      .filter((l) => l.vinculosInc > 0)
      .sort((a, b) => b.vinculosInc - a.vinculosInc)
      .slice(0, 12);
    const setores = dim.setores;
    const c = D().col;
    const cel = mun.map(() => setores.map(() => 0));
    const pos = new Map(mun.map((l, i) => [l.idx, i]));
    for (let j = 0; j < idx.length; j += 1) {
      const i = idx[j];
      if (c.inc[i] === D().INC_NAO) continue;
      const colMun = pos.get(c.mun[i]);
      if (colMun === undefined) continue;
      const s = c.setor[i];
      if (s >= 0 && s < setores.length) cel[colMun][s] += c.v[i];
    }

    desenhar("condecGraficoHeatmap", {
      chart: { type: "heatmap", height: 420 },
      series: setores.map((nome, s) => ({
        name: nome,
        data: mun.map((m, i) => ({ x: m.nome, y: cel[i][s] })),
      })),
      dataLabels: rotulos((v) => (v >= 50 ? fmt.compacto(v) : v ? fmt.int(v) : "")),
      plotOptions: {
        heatmap: {
          shadeIntensity: 0.45,
          radius: 2,
          colorScale: {
            ranges: [
              { from: 0, to: 0, color: "#f1f5f9", name: "zero" },
              { from: 1, to: 99, color: "#cfeeda", name: "baixo" },
              { from: 100, to: 499, color: "#59c08c", name: "médio" },
              { from: 500, to: 1999, color: "#177649", name: "alto" },
              { from: 2000, to: 1e9, color: "#09492e", name: "muito alto" },
            ],
          },
        },
      },
      tooltip: { y: { formatter: (v) => `${fmt.int(v)} vínculos incentivados` } },
    });
  }

  function boxRem(idx) {
    const dim = D().dim;
    const c = D().col;
    const bolsos = dim.setores.map(() => []);
    for (let j = 0; j < idx.length; j += 1) {
      const i = idx[j];
      if (c.inc[i] === D().INC_NAO || c.v[i] <= 0 || c.rem[i] <= 0) continue;
      const s = c.setor[i];
      if (s >= 0 && s < bolsos.length) bolsos[s].push(c.rem[i]);
    }
    const data = dim.setores
      .map((nome, s) => ({ nome, y: quartis(bolsos[s]), n: bolsos[s].length }))
      .filter((l) => l.y && l.n >= 4);

    desenhar("condecGraficoBoxRem", {
      chart: { type: "boxPlot", height: 340 },
      series: [{ type: "boxPlot", data: data.map((l) => ({ x: l.nome, y: l.y.map((v) => Math.round(v)) })) }],
      plotOptions: { boxPlot: { colors: { upper: COR_INC, lower: COR_DEMAIS } } },
      yaxis: { labels: { formatter: (v) => fmt.moeda(v) }, title: { text: "Remuneração média do estabelecimento" } },
      tooltip: {
        custom: ({ dataPointIndex }) => {
          const l = data[dataPointIndex];
          if (!l) return "";
          const [mn, q1, md, q3, mx] = l.y;
          return `<div class="condec-mapa-popup" style="padding:9px 11px"><h3>${l.nome}</h3><dl>
            <dt>Estabelecimentos</dt><dd>${fmt.int(l.n)}</dd>
            <dt>Mínimo</dt><dd>${fmt.moeda(mn)}</dd>
            <dt>1º quartil</dt><dd>${fmt.moeda(q1)}</dd>
            <dt>Mediana</dt><dd>${fmt.moeda(md)}</dd>
            <dt>3º quartil</dt><dd>${fmt.moeda(q3)}</dd>
            <dt>Máximo</dt><dd>${fmt.moeda(mx)}</dd>
          </dl></div>`;
        },
      },
    });
  }

  function treemap(idx) {
    const dim = D().dim;
    const c = D().col;
    const nS = dim.setores.length;
    const nP = dim.programas.length;
    const cel = Array.from({ length: nS }, () => Array(nP).fill(0));
    for (let j = 0; j < idx.length; j += 1) {
      const i = idx[j];
      if (c.inc[i] === D().INC_NAO) continue;
      const s = c.setor[i];
      const mask = c.prog[i];
      if (s < 0 || s >= nS || !mask) continue;
      for (let p = 0; p < nP; p += 1) {
        if (mask & (1 << p)) cel[s][p] += c.v[i];
      }
    }
    const data = [];
    dim.setores.forEach((setor, s) => {
      dim.programas.forEach((prog, p) => {
        if (cel[s][p] > 0) data.push({ x: `${setor} · ${prog}`, y: cel[s][p] });
      });
    });
    data.sort((a, b) => b.y - a.y);

    desenhar("condecGraficoTreemap", {
      chart: { type: "treemap", height: 400 },
      series: [{ data }],
      legend: { show: false },
      dataLabels: {
        enabled: true,
        formatter: (text, op) => {
          const y = op.value;
          return [text, fmt.compacto(y)];
        },
        style: { fontSize: "11px", fontWeight: 600 },
      },
      plotOptions: { treemap: { distributed: true, enableShades: true } },
      colors: [COR_INC, COR_AZUL, COR_AMBAR, "#0f766e", "#7c3aed", COR_TINTA],
      tooltip: { y: { formatter: (v) => `${fmt.int(v)} vínculos` } },
    });
  }

  function regioes(idx) {
    const nomes = D().regioes;
    const linhas = nomes.map((nome) => ({ nome, empresas: new Set(), vinculosInc: 0 }));
    const c = D().col;
    const regDe = D().regiaoDoMunicipio;
    for (let j = 0; j < idx.length; j += 1) {
      const i = idx[j];
      if (c.inc[i] === D().INC_NAO || c.mun[i] < 0) continue;
      const r = regDe[c.mun[i]];
      if (r < 0 || r >= linhas.length) continue;
      linhas[r].empresas.add(c.raiz[i]);
      linhas[r].vinculosInc += c.v[i];
    }
    const porVinculos = metricaRegioes === "vinculos";
    const ordem = linhas
      .map((l) => ({ nome: l.nome, empresas: l.empresas.size, vinculos: l.vinculosInc }))
      .filter((l) => (porVinculos ? l.vinculos > 0 : l.empresas > 0))
      .sort((a, b) => (porVinculos ? b.vinculos - a.vinculos : b.empresas - a.empresas));

    desenhar("condecGraficoRegioes", {
      chart: { type: "bar", height: 400 },
      series: [
        {
          name: porVinculos ? "Vínculos" : "Empresas apoiadas",
          data: ordem.map((l) => (porVinculos ? l.vinculos : l.empresas)),
        },
      ],
      colors: [porVinculos ? COR_AZUL : COR_INC],
      plotOptions: { bar: { horizontal: true, borderRadius: 3, barHeight: "70%" } },
      dataLabels: rotulos((v) => (porVinculos ? fmt.compacto(v) : fmt.int(v))),
      xaxis: {
        categories: ordem.map((l) => l.nome),
        labels: { formatter: (v) => (porVinculos ? fmt.compacto(v) : fmt.int(v)) },
      },
      tooltip: {
        y: {
          formatter: (v, opts) => {
            const l = ordem[opts.dataPointIndex];
            return `${fmt.int(l.empresas)} empresas · ${fmt.int(l.vinculos)} vínculos`;
          },
        },
      },
    });
  }

  function serieReferencia() {
    const idx = D().filtrar({ ignorarRef: true });
    const todas = D().agregarPorReferencia(idx);
    const sel = D().estado.refs;
    const linhas = sel && sel.size ? todas.filter((_, i) => sel.has(i)) : todas;
    const selecionada = D().dim.referencias && D().dim.referencias[D().estado.ref];

    desenhar("condecGraficoReferencia", {
      chart: { type: "line", height: 380 },
      series: [
        { name: "Vínculos totais", data: linhas.map((l) => l.vinculos) },
        { name: "Vínculos incentivados", data: linhas.map((l) => l.vinculosInc) },
        { name: "Remuneração média", data: linhas.map((l) => Math.round(l.rem)) },
        { name: "Rem. média incentivadas", data: linhas.map((l) => Math.round(l.remInc)) },
      ],
      colors: [COR_AZUL, COR_INC, COR_AMBAR, COR_TINTA],
      stroke: { width: [3, 3, 2, 2], curve: "smooth", dashArray: [0, 0, 0, 6] },
      markers: { size: 5, hover: { size: 7 } },
      dataLabels: {
        enabled: true,
        enabledOnSeries: [0, 1],
        formatter: (v) => (v ? fmt.compacto(v) : ""),
        style: { fontSize: "11px", fontWeight: 600, colors: [COR_TINTA] },
        background: { enabled: false },
      },
      xaxis: {
        categories: linhas.map((l) => l.nome),
        title: { text: "Competência da RAIS" },
      },
      yaxis: [
        {
          seriesName: "Vínculos totais",
          labels: { formatter: (v) => fmt.compacto(v) },
          title: { text: "Vínculos" },
          min: 0,
        },
        { seriesName: "Vínculos totais", show: false },
        {
          seriesName: "Remuneração média",
          opposite: true,
          labels: { formatter: (v) => fmt.moeda(v) },
          title: { text: "Remuneração média" },
          min: 0,
        },
        { seriesName: "Remuneração média", show: false },
      ],
      tooltip: {
        shared: true,
        y: {
          formatter: (v, opts) => (opts.seriesIndex >= 2 ? fmt.moeda(v) : `${fmt.int(v)} vínculos`),
        },
      },
      annotations: selecionada
        ? {
            xaxis: [
              {
                x: selecionada,
                borderColor: COR_TINTA,
                strokeDashArray: 4,
                label: {
                  text: "selecionada",
                  style: { color: "#fff", background: COR_TINTA, fontSize: "10px" },
                },
              },
            ],
          }
        : {},
    });
  }

  const CORES_COMP = ["#1d4ed8", "#00a859", "#d97706", "#7c3aed", "#0f766e", "#b91c1c"];

  function nomeCurto(nome, n) {
    const t = nome || "Empresa";
    return t.length > n ? `${t.slice(0, n - 1)}…` : t;
  }

  function redesenhar(id, opcoes) {
    const existente = graficos.get(id);
    if (existente) {
      existente.destroy();
      graficos.delete(id);
    }
    const alvo = document.getElementById(id);
    if (alvo) alvo.innerHTML = "";
    desenhar(id, opcoes);
  }

  function compararSalarios(idx, raizes, ordem) {
    const lista = raizes || [];
    const idxSerie = D().filtrar({ ignorarRef: true });
    const dados = D().compararRemuneracao(idx, idxSerie, lista);
    const ranking = ordem === "menores" ? 1 : -1;

    if (!lista.length) {
      redesenhar("condecGraficoCompBarras", {
        chart: { type: "bar", height: 320 },
        series: [],
        xaxis: { categories: [] },
      });
      redesenhar("condecGraficoCompLinhas", {
        chart: { type: "line", height: 360 },
        series: [],
        xaxis: { categories: [] },
      });
      return;
    }

    const empresas = dados.empresas.slice().sort((a, b) => ranking * (a.rem - b.rem) || b.vinculos - a.vinculos);
    const corPorRaiz = new Map(lista.map((r, i) => [r, CORES_COMP[i % CORES_COMP.length]]));
    const coresBarras = empresas.map((e) => corPorRaiz.get(e.raiz) || CORES_COMP[0]);
    const cats = empresas.map((e) => nomeCurto(e.nome, 28));
    const valores = empresas.map((e) => Math.round(e.rem));
    redesenhar("condecGraficoCompBarras", {
      chart: { type: "bar", height: 320 },
      series: [{ name: "Salário médio", data: valores }],
      colors: coresBarras,
      plotOptions: { bar: { horizontal: true, borderRadius: 3, barHeight: "68%", distributed: true } },
      legend: { show: false },
      dataLabels: rotulos((v) => (v ? fmt.moeda(v) : "")),
      xaxis: { categories: cats, labels: { formatter: (v) => fmt.moeda(v) } },
      tooltip: {
        y: {
          formatter: (v, opts) => {
            const e = empresas[opts.dataPointIndex];
            return `${fmt.moeda(v)} · ${fmt.int(e.vinculos)} vínculos`;
          },
        },
      },
      annotations: dados.recorteRem
        ? {
            xaxis: [
              {
                x: Math.round(dados.recorteRem),
                borderColor: COR_CINZA,
                strokeDashArray: 5,
                label: {
                  text: `recorte ${fmt.moeda(dados.recorteRem)}`,
                  style: { color: "#fff", background: COR_CINZA, fontSize: "10px" },
                },
              },
            ],
          }
        : {},
    });

    redesenhar("condecGraficoCompLinhas", {
      chart: { type: "line", height: 360 },
      series: [
        ...dados.empresas.map((e) => ({
          name: nomeCurto(e.nome, 22),
          data: e.serie.map((v) => (v == null ? null : Math.round(v))),
        })),
        {
          name: "Média do recorte",
          data: dados.recorteSerie.map((v) => (v == null ? null : Math.round(v))),
        },
      ],
      colors: [...CORES_COMP.slice(0, dados.empresas.length), COR_CINZA],
      stroke: {
        width: [...dados.empresas.map(() => 3), 2],
        curve: "smooth",
        dashArray: [...dados.empresas.map(() => 0), 6],
      },
      markers: { size: 5, hover: { size: 7 } },
      dataLabels: { enabled: false },
      xaxis: {
        categories: dados.refs,
        title: { text: "Competência da RAIS" },
      },
      yaxis: {
        min: 0,
        labels: { formatter: (v) => fmt.moeda(v) },
        title: { text: "Salário médio" },
      },
      tooltip: { shared: true, y: { formatter: (v) => (v == null ? "—" : fmt.moeda(v)) } },
      legend: { position: "top", horizontalAlign: "left", fontSize: "12px" },
    });
  }

  function render(idx, grupos) {
    const totais = D().agregarTotais(idx);
    serieReferencia();
    dispersao(grupos);
    gauge(totais);
    rankingAderencia(grupos);
    setores(idx);
    remuneracaoSetor(idx);
    heatmap(idx);
    municipios(idx);
    regioes(idx);
    programas(idx);
    treemap(idx);
    tamanhos(idx);
    porteIbge(idx);
    safras(idx);
    vigencias(idx);
    calcadista(idx);
    regime(idx);
    institucional(idx);
  }

  return {
    render,
    renderDispersao: dispersao,
    renderRegioes: regioes,
    renderComparacao: compararSalarios,
    setEscalaDispersao,
    setMetricaRegioes,
    fmt,
  };
})();
