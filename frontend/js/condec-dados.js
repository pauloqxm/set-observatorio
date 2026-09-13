/*
 * Aba CONDEC — camada de dados (portado de 3_rais_emprego/js/painel-dados.js).
 * Le os JSON colunares gerados por backend/etl/condec_preparar_dados.py.
 *
 * Gerado por scripts/condec_portar.py.
 */
/**
 * Camada de dados do painel: carrega os JSON gerados pelo ETL, converte as colunas
 * para arrays tipados e resolve filtros e agregações sobre um índice de posições.
 *
 * O arquivo de texto (razão social e CNPJ) é o mais pesado e só é necessário para a
 * tabela e para a busca, então carrega depois que os gráficos já pintaram.
 */
window.CondecDados = (function () {
  const BASE_DADOS = "/static/data/condec/";
  const CAMINHOS = {
    dimensoes: BASE_DADOS + "dimensoes.json",
    num: BASE_DADOS + "estab_num.json",
    empresas: BASE_DADOS + "empresas.json",
    texto: BASE_DADOS + "estab_texto.json",
  };

  const INC_NAO = 0;
  const INC_FILIAL = 1;
  const INC_PROTOCOLO = 2;

  const estado = {
    incentivo: "todos",
    setores: new Set(),
    municipios: new Set(),
    regioes: new Set(),
    programas: new Set(),
    tamanhos: new Set(),
    portesIbge: new Set(),
    celetistas: new Set(),
    calcadista: "todos",
    spe: "todos",
    institucional: "todos",
    iniDe: null,
    iniAte: null,
    fimDe: null,
    fimAte: null,
    busca: "",
    ref: 0,
    refs: new Set(),
  };

  const api = {
    INC_NAO,
    INC_FILIAL,
    INC_PROTOCOLO,
    estado,
    dim: null,
    col: null,
    municipiosTotais: null,
    empresas: null,
    empresaPorRaiz: null,
    texto: null,
    regioes: [],
    regiaoDoMunicipio: null,
    idxCalcadistaSim: -1,
    n: 0,
    carregar,
    carregarTexto,
    filtrar,
    limparEstado,
    temFiltro,
    agregarTotais,
    agregarPorChave,
    agregarPorMunicipio,
    agregarPorPrograma,
    agregarPorAno,
    agregarPorReferencia,
    agregarPorEmpresa,
    agregarPorPorteIbge,
    compararRemuneracao,
    nomeDaEmpresa,
    portesIbge: [],
    porteIbgePorRaiz: null,
    atualizarMunicipiosTotais,
    atualizarPorteIbge,
    sincronizarRefAtiva,
    totalDaReferencia,
    setoresDaEmpresa,
    municipiosDaEmpresa,
    listarSemRais,
    anosDosProtocolos,
    nomeMunicipio,
    nomeSetor,
  };

  async function baixar(url, rotulo, onProgresso) {
    if (onProgresso) onProgresso(rotulo);
    const resp = await fetch(url, { cache: "no-cache" });
    if (!resp.ok) throw new Error(`${url}: HTTP ${resp.status}`);
    return resp.json();
  }

  function tipada(Construtor, origem) {
    const saida = new Construtor(origem.length);
    for (let i = 0; i < origem.length; i += 1) saida[i] = origem[i];
    return saida;
  }

  async function carregar(onProgresso) {
    const [dim, num, empresas] = await Promise.all([
      baixar(CAMINHOS.dimensoes, "dimensões", onProgresso),
      baixar(CAMINHOS.num, "estabelecimentos", onProgresso),
      baixar(CAMINHOS.empresas, "empresas incentivadas", onProgresso),
    ]);

    api.dim = dim;
    api.n = num.n;
    api.col = {
      mun: tipada(Int16Array, num.mun),
      cnae: tipada(Int16Array, num.cnae),
      setor: tipada(Uint8Array, num.setor),
      calc: tipada(Uint8Array, num.calc),
      tam: tipada(Uint8Array, num.tam),
      cele: tipada(Uint8Array, num.cele),
      inc: tipada(Uint8Array, num.inc),
      sr: tipada(Uint8Array, num.sr),
      pp: tipada(Uint8Array, num.pp),
      prog: tipada(Uint8Array, num.prog),
      spe: tipada(Uint8Array, num.spe),
      ini: tipada(Int16Array, num.ini),
      fim: tipada(Int16Array, num.fim),
      pi: tipada(Int32Array, num.pi),
      v: tipada(Int32Array, num.v),
      rem: tipada(Float32Array, num.rem),
      raiz: tipada(Int32Array, num.raiz),
    };
    if (num.ref) api.col.ref = tipada(Int8Array, num.ref);
    if (num.pub) api.col.pub = tipada(Uint8Array, num.pub);

    if (!dim.referencias || !dim.referencias.length) {
      dim.referencias = dim.referencia ? [dim.referencia] : [];
    }
    estado.refs = new Set();
    const nova = dim.referencias.length ? dim.referencias.length - 1 : 0;
    estado.refs.add(nova);
    estado.ref = nova;

    api.empresas = empresas;
    api.empresaPorRaiz = new Map();
    empresas.forEach((e) => api.empresaPorRaiz.set(e.ridx, e));

    // Região administrativa vem do geojson de municípios, já embutida nas dimensões.
    const regioes = [];
    const porNome = new Map();
    api.regiaoDoMunicipio = new Int16Array(dim.municipios.length);
    dim.municipios.forEach((m, i) => {
      const nome = m.regiao || "Não informada";
      let idx = porNome.get(nome);
      if (idx === undefined) {
        idx = regioes.length;
        porNome.set(nome, idx);
        regioes.push(nome);
      }
      api.regiaoDoMunicipio[i] = idx;
    });
    api.regioes = regioes;

    api.idxCalcadistaSim = dim.calcadistas.findIndex((v) => /^s/i.test(v));

    _buffer = new Int32Array(api.n);
    _marcaRaiz = new Uint8Array(dim.totais.raizes);
    _munTotais = [];

    api.municipiosTotais = municipiosTotaisDaRef(estado.ref);
    atualizarPorteIbge();

    return api;
  }

  async function carregarTexto(onProgresso) {
    if (api.texto) return api.texto;
    api.texto = await baixar(CAMINHOS.texto, "razões sociais", onProgresso);
    return api.texto;
  }

  // ------------------------------------------------------------------ filtros

  let _buffer = null;
  let _marcaRaiz = null;
  let _munTotais = [];

  function indiceRefNova() {
    const refs = api.dim && api.dim.referencias;
    return refs && refs.length ? refs.length - 1 : 0;
  }

  function limparEstado() {
    estado.incentivo = "todos";
    estado.calcadista = "todos";
    estado.spe = "todos";
    estado.institucional = "todos";
    estado.busca = "";
    estado.refs.clear();
    estado.refs.add(indiceRefNova());
    estado.ref = indiceRefNova();
    estado.iniDe = estado.iniAte = estado.fimDe = estado.fimAte = null;
    [
      estado.setores,
      estado.municipios,
      estado.regioes,
      estado.programas,
      estado.tamanhos,
      estado.portesIbge,
      estado.celetistas,
    ].forEach((s) => s.clear());
    atualizarMunicipiosTotais();
    atualizarPorteIbge();
  }

  function temFiltro() {
    return (
      estado.incentivo !== "todos" ||
      estado.calcadista !== "todos" ||
      estado.spe !== "todos" ||
      estado.institucional !== "todos" ||
      estado.busca !== "" ||
      estado.iniDe !== null ||
      estado.iniAte !== null ||
      estado.fimDe !== null ||
      estado.fimAte !== null ||
      estado.setores.size > 0 ||
      estado.municipios.size > 0 ||
      estado.regioes.size > 0 ||
      estado.programas.size > 0 ||
      estado.tamanhos.size > 0 ||
      estado.portesIbge.size > 0 ||
      estado.celetistas.size > 0 ||
      (estado.refs && (estado.refs.size !== 1 || !estado.refs.has(indiceRefNova())))
    );
  }

  function mascaraDosProgramas() {
    let m = 0;
    estado.programas.forEach((i) => {
      m |= 1 << i;
    });
    return m;
  }

  /** Retorna um Int32Array (view do buffer interno) com as posições que passam nos filtros. */
  function filtrar(opcoes) {
    const ignorarRef = opcoes && opcoes.ignorarRef;
    const c = api.col;
    const e = estado;
    const usaSetor = e.setores.size > 0;
    const usaMun = e.municipios.size > 0;
    const usaReg = e.regioes.size > 0;
    const usaTam = e.tamanhos.size > 0;
    const usaPorteIbge = e.portesIbge.size > 0;
    const usaCele = e.celetistas.size > 0;
    const maskProg = mascaraDosProgramas();
    const calcSim = api.idxCalcadistaSim;
    const regDe = api.regiaoDoMunicipio;

    const busca = e.busca.trim().toUpperCase();
    const buscaDigitos = busca.replace(/\D/g, "");
    const podeBuscar = busca !== "" && api.texto !== null;
    const razao = podeBuscar ? api.texto.razao : null;
    const cnpj = podeBuscar ? api.texto.cnpj : null;

    let k = 0;
    for (let i = 0; i < api.n; i += 1) {
      const inc = c.inc[i];
      // Incentivadas = estabelecimento com protocolo no CONDEC. Filiais da mesma
      // raiz em outro município (inc = 1) ficam no recorte "Todos", senão o mapa
      // pinta cidades que não constam da base de incentivos (ex.: Crateús).
      if (e.incentivo === "inc" && inc !== INC_PROTOCOLO) continue;
      if (e.incentivo === "nao" && inc !== INC_NAO) continue;

      if (e.institucional !== "todos" && c.pub) {
        const pub = c.pub[i];
        if (e.institucional === "pub" && pub !== 1) continue;
        if (e.institucional === "priv" && pub !== 0) continue;
      }

      if (usaSetor && !e.setores.has(c.setor[i])) continue;

      const mun = c.mun[i];
      if (usaMun && !e.municipios.has(mun)) continue;
      if (usaReg && (mun < 0 || !e.regioes.has(regDe[mun]))) continue;

      if (usaTam && !e.tamanhos.has(c.tam[i])) continue;
      if (usaPorteIbge) {
        const r = c.raiz[i];
        const porte = api.porteIbgePorRaiz && r >= 0 ? api.porteIbgePorRaiz[r] : 4;
        if (!e.portesIbge.has(porte)) continue;
      }
      if (usaCele && !e.celetistas.has(c.cele[i])) continue;

      if (maskProg && (c.prog[i] & maskProg) === 0) continue;

      if (e.calcadista !== "todos") {
        const ehCalc = c.calc[i] === calcSim;
        if (e.calcadista === "sim" ? !ehCalc : ehCalc) continue;
      }

      if (e.spe !== "todos") {
        const bit = e.spe === "sim" ? 1 : 2;
        if ((c.spe[i] & bit) === 0) continue;
      }

      if (e.iniDe !== null && (c.ini[i] === 0 || c.ini[i] < e.iniDe)) continue;
      if (e.iniAte !== null && (c.ini[i] === 0 || c.ini[i] > e.iniAte)) continue;
      if (e.fimDe !== null && (c.fim[i] === 0 || c.fim[i] < e.fimDe)) continue;
      if (e.fimAte !== null && (c.fim[i] === 0 || c.fim[i] > e.fimAte)) continue;

      if (!ignorarRef && c.ref) {
        const r = c.ref[i];
        if (r !== -1 && r !== e.ref) continue;
      }

      if (podeBuscar) {
        const achouNome = razao[i].toUpperCase().indexOf(busca) >= 0;
        const achouCnpj = buscaDigitos.length >= 3 && cnpj[i].indexOf(buscaDigitos) >= 0;
        if (!achouNome && !achouCnpj) continue;
      }

      _buffer[k] = i;
      k += 1;
    }
    return _buffer.subarray(0, k);
  }

  // --------------------------------------------------------------- agregações

  function agregarTotais(idx) {
    const c = api.col;
    const t = {
      registros: idx.length,
      estabInc: 0,
      estabProtocolo: 0,
      estabSemRais: 0,
      empresasInc: 0,
      municipios: 0,
      vinculos: 0,
      massa: 0,
      vinculosInc: 0,
      massaInc: 0,
      pi: 0,
    };
    _marcaRaiz.fill(0);
    const muns = new Set();
    for (let j = 0; j < idx.length; j += 1) {
      const i = idx[j];
      const v = c.v[i];
      const inc = c.inc[i];
      t.vinculos += v;
      t.massa += v * c.rem[i];
      t.pi += c.pi[i];
      if (c.mun[i] >= 0) muns.add(c.mun[i]);
      if (inc !== INC_NAO) {
        t.estabInc += 1;
        t.vinculosInc += v;
        t.massaInc += v * c.rem[i];
        if (c.pp[i] === 1) t.estabProtocolo += 1;
        if (c.sr[i] === 1) t.estabSemRais += 1;
        const r = c.raiz[i];
        if (_marcaRaiz[r] === 0) {
          _marcaRaiz[r] = 1;
          t.empresasInc += 1;
        }
      }
    }
    t.municipios = muns.size;
    t.rem = t.vinculos ? t.massa / t.vinculos : 0;
    t.remInc = t.vinculosInc ? t.massaInc / t.vinculosInc : 0;
    return t;
  }

  /**
   * Agrega por uma coluna categórica, separando incentivadas do total.
   * @param {Int32Array} idx posições filtradas
   * @param {string} coluna nome da coluna em api.col
   * @param {number} tamanho quantidade de categorias
   */
  function agregarPorChave(idx, coluna, tamanho) {
    const c = api.col;
    const chave = c[coluna];
    const linhas = Array.from({ length: tamanho }, () => ({
      estab: 0,
      estabInc: 0,
      vinculos: 0,
      vinculosInc: 0,
      massa: 0,
      massaInc: 0,
      pi: 0,
    }));
    for (let j = 0; j < idx.length; j += 1) {
      const i = idx[j];
      const k = chave[i];
      if (k < 0 || k >= tamanho) continue;
      const alvo = linhas[k];
      const v = c.v[i];
      const m = v * c.rem[i];
      alvo.estab += 1;
      alvo.vinculos += v;
      alvo.massa += m;
      if (c.inc[i] !== INC_NAO) {
        alvo.estabInc += 1;
        alvo.vinculosInc += v;
        alvo.massaInc += m;
        alvo.pi += c.pi[i];
      }
    }
    linhas.forEach((l) => {
      l.rem = l.vinculos ? l.massa / l.vinculos : 0;
      l.remInc = l.vinculosInc ? l.massaInc / l.vinculosInc : 0;
      l.remNao = l.vinculos - l.vinculosInc ? (l.massa - l.massaInc) / (l.vinculos - l.vinculosInc) : 0;
    });
    return linhas;
  }

  function agregarPorMunicipio(idx) {
    const linhas = agregarPorChave(idx, "mun", api.dim.municipios.length);
    linhas.forEach((l, i) => {
      l.idx = i;
      l.nome = api.dim.municipios[i].nome;
      l.cod = api.dim.municipios[i].cod;
      l.participacao = l.vinculos ? (l.vinculosInc / l.vinculos) * 100 : 0;
    });
    return linhas;
  }

  /**
   * Emprego municipal da competência selecionada, sem os outros filtros.
   * É o denominador estável da participação das incentivadas.
   */
  function municipiosTotaisDaRef(iRef) {
    if (_munTotais[iRef]) return _munTotais[iRef];
    const c = api.col;
    const buf = new Int32Array(api.n);
    let k = 0;
    if (c.ref) {
      for (let i = 0; i < api.n; i += 1) {
        const r = c.ref[i];
        if (r !== -1 && r !== iRef) continue;
        buf[k] = i;
        k += 1;
      }
    } else {
      for (let i = 0; i < api.n; i += 1) buf[i] = i;
      k = api.n;
    }
    _munTotais[iRef] = agregarPorMunicipio(buf.subarray(0, k));
    return _munTotais[iRef];
  }

  function atualizarMunicipiosTotais() {
    api.municipiosTotais = municipiosTotaisDaRef(estado.ref);
  }

  /** A competência ativa dos KPIs é a mais nova entre as marcadas na lista. */
  function sincronizarRefAtiva() {
    const nova = indiceRefNova();
    if (!estado.refs || !estado.refs.size) {
      if (!estado.refs) estado.refs = new Set();
      estado.refs.add(nova);
    }
    let max = -1;
    estado.refs.forEach((i) => {
      if (i > max) max = i;
    });
    estado.ref = max >= 0 ? max : nova;
    atualizarMunicipiosTotais();
    atualizarPorteIbge();
  }

  /**
   * Porte da empresa (raiz do CNPJ) pelo total de colaboradores na competência
   * ativa, conforme o IBGE/CEMPRE: micro até 9, pequena 10–49, média 50–249,
   * grande 250 ou mais.
   */
  function classePorteIbge(vinculos) {
    if (vinculos >= 250) return 3;
    if (vinculos >= 50) return 2;
    if (vinculos >= 10) return 1;
    if (vinculos > 0) return 0;
    return 4;
  }

  function atualizarPorteIbge() {
    api.portesIbge = [
      { valor: 0, nome: "Micro", rotulo: "Micro (até 9)", faixa: "até 9 colaboradores" },
      { valor: 1, nome: "Pequena", rotulo: "Pequena (10 a 49)", faixa: "10 a 49 colaboradores" },
      { valor: 2, nome: "Média", rotulo: "Média (50 a 249)", faixa: "50 a 249 colaboradores" },
      { valor: 3, nome: "Grande", rotulo: "Grande (250 ou mais)", faixa: "250 ou mais colaboradores" },
      { valor: 4, nome: "Sem vínculos", rotulo: "Sem vínculos na RAIS", faixa: "sem registro de vínculos" },
    ];
    const nRaiz = (api.dim && api.dim.totais && api.dim.totais.raizes) || 0;
    const vinculos = new Int32Array(nRaiz);
    const c = api.col;
    const iRef = estado.ref;
    if (c && c.raiz) {
      for (let i = 0; i < api.n; i += 1) {
        if (c.ref && c.ref[i] !== -1 && c.ref[i] !== iRef) continue;
        const r = c.raiz[i];
        if (r >= 0 && r < nRaiz) vinculos[r] += c.v[i];
      }
    }
    const porte = new Int8Array(nRaiz);
    for (let r = 0; r < nRaiz; r += 1) porte[r] = classePorteIbge(vinculos[r]);
    api.porteIbgePorRaiz = porte;
  }

  function agregarPorPorteIbge(idx) {
    const linhas = (api.portesIbge || []).map((p) => ({
      valor: p.valor,
      nome: p.nome,
      rotulo: p.rotulo,
      faixa: p.faixa,
      empresas: 0,
      estab: 0,
      vinculos: 0,
      vinculosInc: 0,
    }));
    const vistos = linhas.map(() => new Set());
    const c = api.col;
    const porte = api.porteIbgePorRaiz;
    for (let j = 0; j < idx.length; j += 1) {
      const i = idx[j];
      const r = c.raiz[i];
      const k = porte && r >= 0 ? porte[r] : 4;
      if (k < 0 || k >= linhas.length) continue;
      const alvo = linhas[k];
      alvo.estab += 1;
      alvo.vinculos += c.v[i];
      if (c.inc[i] !== INC_NAO) alvo.vinculosInc += c.v[i];
      vistos[k].add(r);
    }
    linhas.forEach((l, k) => {
      l.empresas = vistos[k].size;
    });
    return linhas;
  }

  function totalDaReferencia() {
    const totais = api.dim && api.dim.totais;
    const lista = totais && totais.por_referencia;
    const extra = (totais && totais.protocolos_sem_rais) || 0;
    if (!lista || lista[estado.ref] == null) return totais ? totais.registros : 0;
    return lista[estado.ref].registros + extra;
  }

  /** Uma linha por competência da RAIS, na ordem cronológica das dimensões. */
  function agregarPorReferencia(idx) {
    const refs = (api.dim && api.dim.referencias) || [];
    const linhas = refs.map((nome) => ({
      nome,
      estab: 0,
      estabInc: 0,
      vinculos: 0,
      vinculosInc: 0,
      massa: 0,
      massaInc: 0,
    }));
    const c = api.col;
    if (!c.ref) return linhas;
    for (let j = 0; j < idx.length; j += 1) {
      const i = idx[j];
      const k = c.ref[i];
      if (k < 0 || k >= linhas.length) continue;
      const alvo = linhas[k];
      const v = c.v[i];
      const m = v * c.rem[i];
      alvo.estab += 1;
      alvo.vinculos += v;
      alvo.massa += m;
      if (c.inc[i] !== INC_NAO) {
        alvo.estabInc += 1;
        alvo.vinculosInc += v;
        alvo.massaInc += m;
      }
    }
    linhas.forEach((l) => {
      l.rem = l.vinculos ? l.massa / l.vinculos : 0;
      l.remInc = l.vinculosInc ? l.massaInc / l.vinculosInc : 0;
    });
    return linhas;
  }

  function agregarPorPrograma(idx) {
    const c = api.col;
    const total = api.dim.programas.length;
    const linhas = api.dim.programas.map((nome) => ({
      nome,
      empresas: 0,
      estab: 0,
      vinculos: 0,
      massa: 0,
      pi: 0,
    }));
    const marcas = linhas.map(() => new Set());
    for (let j = 0; j < idx.length; j += 1) {
      const i = idx[j];
      const mask = c.prog[i];
      if (!mask) continue;
      for (let p = 0; p < total; p += 1) {
        if ((mask & (1 << p)) === 0) continue;
        const alvo = linhas[p];
        alvo.estab += 1;
        alvo.vinculos += c.v[i];
        alvo.massa += c.v[i] * c.rem[i];
        alvo.pi += c.pi[i];
        marcas[p].add(c.raiz[i]);
      }
    }
    linhas.forEach((l, p) => {
      l.empresas = marcas[p].size;
      l.rem = l.vinculos ? l.massa / l.vinculos : 0;
    });
    return linhas;
  }

  /** Séries por ano de início ou de fim de vigência, apenas de estabelecimentos incentivados. */
  function agregarPorAno(idx, coluna) {
    const c = api.col;
    const mapa = new Map();
    const vistos = new Map();
    for (let j = 0; j < idx.length; j += 1) {
      const i = idx[j];
      if (c.inc[i] === INC_NAO) continue;
      const ano = c[coluna][i];
      if (!ano) continue;
      let alvo = mapa.get(ano);
      if (!alvo) {
        alvo = { ano, protocolos: 0, empresas: 0, pi: 0, vinculos: 0 };
        mapa.set(ano, alvo);
        vistos.set(ano, new Set());
      }
      if (c.pp[i] === 1) alvo.protocolos += 1;
      alvo.pi += c.pi[i];
      alvo.vinculos += c.v[i];
      vistos.get(ano).add(c.raiz[i]);
    }
    const linhas = Array.from(mapa.values()).sort((a, b) => a.ano - b.ano);
    linhas.forEach((l) => {
      l.empresas = vistos.get(l.ano).size;
    });
    return linhas;
  }

  /**
   * Consolida por raiz de CNPJ; usado pela tabela e pela dispersão.
   * Guarda apenas as posições de cada raiz: setores e municípios são derivados
   * sob demanda, porque no recorte sem filtro isto percorre quase 100 mil grupos.
   */
  function agregarPorEmpresa(idx) {
    const c = api.col;
    const mapa = new Map();
    for (let j = 0; j < idx.length; j += 1) {
      const i = idx[j];
      const r = c.raiz[i];
      let alvo = mapa.get(r);
      if (!alvo) {
        alvo = { raiz: r, posicoes: [], vinculos: 0, massa: 0, pi: 0, estab: 0, incentivada: false, semRais: 0 };
        mapa.set(r, alvo);
      }
      alvo.posicoes.push(i);
      alvo.estab += 1;
      alvo.vinculos += c.v[i];
      alvo.massa += c.v[i] * c.rem[i];
      alvo.pi += c.pi[i];
      if (c.inc[i] !== INC_NAO) alvo.incentivada = true;
      if (c.sr[i] === 1) alvo.semRais += 1;
    }
    const linhas = Array.from(mapa.values());
    linhas.forEach((l) => {
      l.rem = l.vinculos ? l.massa / l.vinculos : 0;
      l.empresa = api.empresaPorRaiz.get(l.raiz) || null;
      l.aderencia = l.pi ? (l.vinculos / l.pi) * 100 : null;
    });
    return linhas;
  }

  function distintos(linha, coluna) {
    const c = api.col[coluna];
    const saida = [];
    linha.posicoes.forEach((i) => {
      if (c[i] >= 0 && saida.indexOf(c[i]) < 0) saida.push(c[i]);
    });
    return saida;
  }

  function setoresDaEmpresa(linha) {
    return distintos(linha, "setor");
  }

  function municipiosDaEmpresa(linha) {
    return distintos(linha, "mun");
  }

  function nomeMunicipio(i) {
    return i >= 0 ? api.dim.municipios[i].nome : "Não informado";
  }

  function nomeSetor(i) {
    return api.dim.setores[i] || "Não identificado";
  }

  function nomeDaEmpresa(raiz, i) {
    const emp = api.empresaPorRaiz.get(raiz);
    if (emp && emp.nome) return emp.nome;
    if (api.texto && i >= 0) return api.texto.razao[i];
    if (api.texto && api.texto.raizes && api.texto.raizes[raiz]) return api.texto.raizes[raiz];
    return "Empresa";
  }

  /**
   * Remuneração média das raízes pedidas na competência ativa e nas referências
   * marcadas. idxAtual vem do recorte visível; idxSerie ignora a competência.
   */
  function compararRemuneracao(idxAtual, idxSerie, raizes) {
    const refs = (api.dim && api.dim.referencias) || [];
    const sel = api.estado.refs;
    const idxsRef = refs.map((_, i) => i).filter((i) => !sel || !sel.size || sel.has(i));
    const porEmp = new Map();
    (raizes || []).forEach((r) => {
      porEmp.set(r, {
        raiz: r,
        amostra: -1,
        massaAtual: 0,
        vAtual: 0,
        massa: new Float64Array(refs.length),
        v: new Int32Array(refs.length),
      });
    });
    const recAtual = { massa: 0, v: 0 };
    const recMassa = new Float64Array(refs.length);
    const recV = new Int32Array(refs.length);
    const c = api.col;

    for (let j = 0; j < idxAtual.length; j += 1) {
      const i = idxAtual[j];
      const v = c.v[i];
      const m = v * c.rem[i];
      recAtual.massa += m;
      recAtual.v += v;
      const e = porEmp.get(c.raiz[i]);
      if (!e) continue;
      e.massaAtual += m;
      e.vAtual += v;
      if (e.amostra < 0) e.amostra = i;
    }

    for (let j = 0; j < idxSerie.length; j += 1) {
      const i = idxSerie[j];
      const k = c.ref ? c.ref[i] : 0;
      if (k < 0 || k >= refs.length) continue;
      const v = c.v[i];
      const m = v * c.rem[i];
      recMassa[k] += m;
      recV[k] += v;
      const e = porEmp.get(c.raiz[i]);
      if (!e) continue;
      e.massa[k] += m;
      e.v[k] += v;
      if (e.amostra < 0) e.amostra = i;
    }

    return {
      refs: idxsRef.map((k) => refs[k]),
      recorteRem: recAtual.v ? recAtual.massa / recAtual.v : 0,
      recorteSerie: idxsRef.map((k) => (recV[k] ? recMassa[k] / recV[k] : null)),
      empresas: (raizes || []).map((r) => {
        const e = porEmp.get(r);
        return {
          raiz: r,
          nome: nomeDaEmpresa(r, e.amostra),
          rem: e.vAtual ? e.massaAtual / e.vAtual : 0,
          vinculos: e.vAtual,
          serie: idxsRef.map((k) => (e.v[k] ? e.massa[k] / e.v[k] : null)),
        };
      }),
    };
  }

  /** Anos distintos da base CONDEC (DATA INÍCIO e VIGÊNCIA). */
  function anosDosProtocolos() {
    const ini = new Set();
    const fim = new Set();
    (api.empresas || []).forEach((e) => {
      (e.protocolos || []).forEach((p) => {
        if (p.inicio) ini.add(p.inicio);
        if (p.vigencia) fim.add(p.vigencia);
      });
    });
    const ordem = (a, b) => b - a;
    return {
      inicio: Array.from(ini).sort(ordem),
      vigencia: Array.from(fim).sort(ordem),
    };
  }

  function programasDaMascara(mask) {
    const nomes = [];
    (api.dim.programas || []).forEach((nome, p) => {
      if (mask & (1 << p)) nomes.push(nome);
    });
    return nomes.join(", ");
  }

  /** Protocolos do recorte sem estabelecimento correspondente na RAIS. */
  function listarSemRais(idx) {
    const c = api.col;
    const linhas = [];
    const vistos = new Set();
    for (let j = 0; j < idx.length; j += 1) {
      const i = idx[j];
      if (c.sr[i] !== 1) continue;
      const emp = api.empresaPorRaiz.get(c.raiz[i]);
      const cnpj = api.texto ? api.texto.cnpj[i] : "";
      const proto = emp
        ? emp.protocolos.find((p) => !cnpj || p.cnpj === cnpj) || emp.protocolos.find((p) => !p.na_rais) || emp.protocolos[0]
        : null;
      const chave = cnpj || (proto && proto.cnpj) || String(i);
      if (vistos.has(chave)) continue;
      vistos.add(chave);
      linhas.push({
        nome: emp ? emp.nome : api.texto ? api.texto.razao[i] : "Empresa",
        cnpj: cnpj || (proto && proto.cnpj) || "",
        municipio: proto && proto.municipio ? proto.municipio : nomeMunicipio(c.mun[i]),
        programa: proto && proto.programa ? proto.programa : programasDaMascara(c.prog[i]),
        pi: c.pi[i] || (proto ? proto.pi : 0),
      });
    }
    linhas.sort((a, b) => a.nome.localeCompare(b.nome, "pt-BR"));
    return linhas;
  }

  return api;
})();
