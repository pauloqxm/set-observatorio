/*
 * Aba CONDEC — ponte entre o recorte do painel e o mapa compartilhado do
 * observatorio. Substitui o painel-mapa.js do projeto original, que instanciava
 * um segundo MapLibre em `#mapCanvas` e pintava por feature-state.
 *
 * Aqui o mapa e um so (`#mapCeRegioes`, via `window.ceRegioesMapApi`) e a
 * coropleta e aplicada no padrao do observatorio: a metrica entra como
 * propriedade do GeoJSON e o paint sai de `setPaintProperty`.
 */
window.CondecMapa = (function () {
  const UNIDADES_URL = "/static/data/condec/unidades.geojson";
  const ENDERECOS_URL = "/static/data/condec/empresas_enderecos.csv";

  const fmt = () => window.CondecGraficos.fmt;

  /** Indicadores do `<select id="mapCondecMetric">`; a chave casa com CE_CONDEC_LAYER_CONFIG. */
  const METRICAS = {
    vinculos: {
      rotulo: "Vínculos no recorte",
      valor: (m) => m.atual.vinculos,
      formatar: (v) => fmt().int(v),
    },
    participacao: {
      rotulo: "% do emprego municipal em incentivadas",
      valor: (m) => (m.total.vinculos ? (m.atual.vinculosInc / m.total.vinculos) * 100 : 0),
      formatar: (v) => fmt().pct(v),
    },
    rem: {
      rotulo: "Remuneração média no recorte",
      valor: (m) => m.atual.rem,
      formatar: (v) => fmt().moeda(v),
    },
    pi: {
      rotulo: "Empregos comprometidos",
      valor: (m) => m.atual.pi,
      formatar: (v) => fmt().int(v),
    },
  };

  let baseUnidades = null;
  let ultimoCtx = null;

  // ------------------------------------------------------------------ CSV

  function cnpj14(valor) {
    const d = String(valor || "").replace(/\D/g, "");
    return d ? d.padStart(14, "0") : "";
  }

  function raizCnpj(cnpj) {
    return cnpj14(cnpj).slice(0, 8);
  }

  function parseCoord(valor) {
    let s = String(valor || "").trim().replace(/\s/g, "");
    if (!s) return null;
    if (s.includes(",") && s.includes(".")) {
      s =
        s.lastIndexOf(",") > s.lastIndexOf(".")
          ? s.replace(/\./g, "").replace(",", ".")
          : s.replace(/,/g, "");
    } else if (s.includes(",")) {
      s = s.replace(",", ".");
    }
    const n = Number(s);
    return Number.isFinite(n) ? n : null;
  }

  function coordNoCeara(lat, lon) {
    return lat >= -9 && lat <= -2 && lon >= -42 && lon <= -37;
  }

  function codIbge6(valor) {
    const d = String(valor || "").replace(/\D/g, "");
    return d.length >= 7 ? d.slice(0, 6) : d;
  }

  function parseCsv(texto, sep = ";") {
    const s = String(texto || "").replace(/^\uFEFF/, "");
    if (!s.trim()) return [];
    const linhas = [];
    let i = 0;
    let campo = "";
    let row = [];
    let aspas = false;
    while (i < s.length) {
      const ch = s[i];
      if (aspas) {
        if (ch === '"') {
          if (s[i + 1] === '"') {
            campo += '"';
            i += 2;
            continue;
          }
          aspas = false;
          i += 1;
          continue;
        }
        campo += ch;
        i += 1;
        continue;
      }
      if (ch === '"') {
        aspas = true;
        i += 1;
        continue;
      }
      if (ch === sep) {
        row.push(campo);
        campo = "";
        i += 1;
        continue;
      }
      if (ch === "\n" || ch === "\r") {
        if (ch === "\r" && s[i + 1] === "\n") i += 1;
        row.push(campo);
        linhas.push(row);
        campo = "";
        row = [];
        i += 1;
        continue;
      }
      campo += ch;
      i += 1;
    }
    if (campo.length || row.length) {
      row.push(campo);
      linhas.push(row);
    }
    if (!linhas.length) return [];
    const head = linhas[0].map((h) => String(h || "").trim());
    return linhas
      .slice(1)
      .filter((r) => r.some((c) => String(c || "").trim()))
      .map((r) => {
        const obj = {};
        head.forEach((h, k) => {
          obj[h] = r[k] == null ? "" : r[k];
        });
        return obj;
      });
  }

  /**
   * As coordenadas vem do CSV a cada carga da aba, para uma empresa nova entrar
   * no mapa sem rerodar o ETL — mesmo comportamento do painel original.
   */
  function mesclarEnderecos(unidades, textoCsv) {
    const feats = (unidades.features || []).map((f) => ({
      type: "Feature",
      geometry: f.geometry,
      properties: { ...(f.properties || {}) },
    }));
    const porCnpj = new Map();
    feats.forEach((f) => {
      const c = cnpj14(f.properties.cnpj);
      if (c) porCnpj.set(c, f);
    });
    parseCsv(textoCsv).forEach((row) => {
      const cnpj = cnpj14(row.cnpj || row.cruz_cnpj);
      if (!cnpj) return;
      const lat = parseCoord(row.Latitude || row.latitude);
      const lon = parseCoord(row.Longitude || row.longitude);
      const noCe = lat != null && lon != null && coordNoCeara(lat, lon);
      const existente = porCnpj.get(cnpj);
      if (existente) {
        if (noCe) {
          existente.geometry = { type: "Point", coordinates: [lon, lat] };
          existente.properties.geo = "endereco";
        }
        return;
      }
      if (!noCe) return;
      const nova = {
        type: "Feature",
        geometry: { type: "Point", coordinates: [lon, lat] },
        properties: {
          cnpj,
          unidade: String(row.razao_social || row.empresa_condec || "").trim(),
          municipio: String(row.municipio || "").trim(),
          cod_ibge: codIbge6(row.cod_ibge),
          programa: String(row.programa_condec || "").trim(),
          setor: "",
          pi: 0,
          vinculos: Number(String(row.vinculos_rais || "0").replace(",", ".")) || 0,
          rem: 0,
          inicio: 0,
          vigencia: 0,
          spe: "",
          na_rais: String(row.na_rais || "").toLowerCase() === "sim",
          geo: "endereco",
          csvNovo: true,
        },
      };
      feats.push(nova);
      porCnpj.set(cnpj, nova);
    });
    return { type: "FeatureCollection", features: feats };
  }

  // ------------------------------------------------------------- pinos

  function chaveCoord(f) {
    const xy = (f.geometry && f.geometry.coordinates) || [];
    const lon = Number(xy[0]);
    const lat = Number(xy[1]);
    if (!Number.isFinite(lon) || !Number.isFinite(lat)) return "";
    return `${lon.toFixed(5)},${lat.toFixed(5)}`;
  }

  function pinoLimpo(topo, n) {
    const p = topo.properties || {};
    return {
      type: "Feature",
      geometry: topo.geometry,
      properties: {
        cnpj: String(p.cnpj || ""),
        unidade: p.unidade || "",
        municipio: p.municipio || "",
        cod_ibge: String(p.cod_ibge || ""),
        programa: p.programa || "",
        setor: p.setor || "",
        pi: p.pi || 0,
        vinculos: p.vinculos || 0,
        rem: p.rem || 0,
        inicio: p.inicio || 0,
        vigencia: p.vigencia || 0,
        spe: p.spe || "",
        na_rais: p.na_rais,
        geo: p.geo || "",
        n,
      },
    };
  }

  /** Protocolos no mesmo endereco viram um pino, com `n` no popup. */
  function umPinoPorCoordenada(features) {
    const por = new Map();
    features.forEach((f) => {
      const chave = chaveCoord(f);
      const lista = por.get(chave);
      if (lista) lista.push(f);
      else por.set(chave, [f]);
    });
    const pinos = [];
    por.forEach((lista) => {
      lista.sort((a, b) => (b.properties.vinculos || 0) - (a.properties.vinculos || 0));
      pinos.push(pinoLimpo(lista[0], lista.length));
    });
    return pinos;
  }

  function unidadeNoRecorte(f, ctx, exigirMun) {
    const p = f.properties || {};
    const raiz = raizCnpj(p.cnpj);
    const raizOk = ctx.raizesVisiveis.has(raiz) || (p.csvNovo && ctx.raizesVisiveis.size);
    if (!raizOk) return false;
    if (!exigirMun) return true;
    return ctx.municipiosVisiveis.has(String(p.cod_ibge));
  }

  function aplicarPinos(ctx) {
    if (!baseUnidades) return;
    let features = baseUnidades.features.filter((f) => unidadeNoRecorte(f, ctx, true));
    if (!features.length) {
      features = baseUnidades.features.filter((f) => unidadeNoRecorte(f, ctx, false));
    }
    const pinos = umPinoPorCoordenada(features);
    window.ceRegioesMapApi?.applyCondecPoints?.({ type: "FeatureCollection", features: pinos });

    const sub = document.getElementById("condecMapaSub");
    if (sub) {
      sub.textContent =
        pinos.length === features.length
          ? `${fmt().int(features.length)} protocolos no recorte. Clique no pino para ver o detalhe.`
          : `${fmt().int(pinos.length)} pontos com ${fmt().int(features.length)} protocolos. Clique no pino para o detalhe.`;
    }
  }

  // ---------------------------------------------------------- coropleta

  /**
   * Agregado municipal no formato que `ceApplyCondecLayer` espera: chave numerica
   * de 6 digitos, igual a `GEO_CODI / 10` do ce_regioes.geojson.
   */
  function montarAggByCod(ctx) {
    const agg = new Map();
    ctx.porMun.forEach((atual, i) => {
      const cod = Number(atual.cod);
      if (!Number.isFinite(cod)) return;
      const total = ctx.porMunTotal[i] || { vinculos: 0 };
      /* Os quatro campos de CE_CONDEC_LAYER_CONFIG vao juntos: o merge no GeoJSON
         escolhe qual virar `condec_metric` conforme o indicador ativo. */
      agg.set(cod, {
        vinculos: atual.vinculos,
        vinculosInc: atual.vinculosInc,
        vinculosTotal: total.vinculos,
        estabInc: atual.estabInc,
        pi: atual.pi,
        rem: atual.rem,
        participacao: total.vinculos ? (atual.vinculosInc / total.vinculos) * 100 : 0,
        empresas: ctx.empresasPorCod.get(atual.cod) || [],
      });
    });
    return agg;
  }

  function atualizar(ctx) {
    ultimoCtx = ctx;
    const api = window.ceRegioesMapApi;
    if (!api?.applyCondecLayer) return;
    api.applyCondecLayer(montarAggByCod(ctx), ctx.metrica);
    aplicarPinos(ctx);
  }

  // ------------------------------------------------------------ arranque

  /** O mapa e criado por mapa-app.js; aqui so esperamos a fonte de municipios. */
  function aguardarMapa(tentativas = 60) {
    return new Promise((resolve) => {
      const tenta = (restantes) => {
        if (window.ceRegioesMapApi?.applyCondecLayer) return resolve(true);
        if (restantes <= 0) return resolve(false);
        setTimeout(() => tenta(restantes - 1), 150);
      };
      tenta(tentativas);
    });
  }

  async function iniciar() {
    await aguardarMapa();

    const [unidades, enderecosTxt] = await Promise.all([
      fetch(UNIDADES_URL, { cache: "no-cache" }).then((r) => (r.ok ? r.json() : { features: [] })),
      fetch(ENDERECOS_URL, { cache: "no-store" })
        .then((r) => (r.ok ? r.text() : ""))
        .catch(() => ""),
    ]);
    baseUnidades = mesclarEnderecos(unidades, enderecosTxt);

    if (ultimoCtx) atualizar(ultimoCtx);
    return true;
  }

  return { iniciar, atualizar, METRICAS };
})();
