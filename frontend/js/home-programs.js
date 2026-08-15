"use strict";

/**
 * Módulo leve e isolado da página inicial: resume os números de quatro
 * programas hoje só visíveis dentro do mapa interativo (Ceará Credi,
 * Dinheiro na Mão, Vai Vem e Qualificação Profissional), para os blocos
 * "Outros programas em destaque" da home.
 */

const HP_CEARA_CREDI_CSV_URL =
  "https://docs.google.com/spreadsheets/d/e/2PACX-1vRTxX3SN-bCMQyty2wj0A3_uwzfy5kBAh0Cwuc5cYLn1VxdrpU7n4phpN23xPz7zGUzsKp9rgMvbXR_/pub?gid=1454518536&single=true&output=csv";

const HP_VAI_VEM_CSV_URL =
  "https://docs.google.com/spreadsheets/d/e/2PACX-1vTG4lc2hb_XAenjE_ja8uQ5dzaAj9-b80hU_H1N0RvZ0jTQSXdkhEassrmQwUNryAqOeObP4C9ZhPHh/pub?gid=1946422191&single=true&output=csv";

const HP_QUALIFICACAO_CSV_URL =
  "https://docs.google.com/spreadsheets/d/e/2PACX-1vSX4leER0WfjxQAuMkPJR9O3mpi1r8XlBaL9ef0bVW7Pb8muKdyJrYB2RvpE5PqSEbCWIAyVj0Wh-L6/pub?gid=1427271035&single=true&output=csv";

const HP_DINHEIRO_NA_MAO_CSV_URL =
  "https://docs.google.com/spreadsheets/d/e/2PACX-1vR0yUMqqyz-DqEIRgsdueFBAo-mfXDXpsvgSCsE3FwYrpIck2V2khuV0FS2SVnVpTX4EuCLjM1guRjH/pub?gid=122762647&single=true&output=csv";

const HP_MESES_ABREV_PT = ["jan", "fev", "mar", "abr", "mai", "jun", "jul", "ago", "set", "out", "nov", "dez"];

function hpParseCsvLine(line) {
  const out = [];
  let cur = "";
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (c === '"') {
      if (inQuotes && line[i + 1] === '"') {
        cur += '"';
        i++;
        continue;
      }
      inQuotes = !inQuotes;
      continue;
    }
    if (!inQuotes && c === ",") {
      out.push(cur.trim());
      cur = "";
      continue;
    }
    cur += c;
  }
  out.push(cur.trim());
  return out;
}

function hpSplitLines(text) {
  const raw = String(text || "").replace(/^\uFEFF/, "");
  return raw.split(/\r?\n/).filter((l) => l.trim());
}

function hpNormalizeKey(raw) {
  return String(raw || "")
    .trim()
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, "");
}

function hpParseNumberPt(raw) {
  const t = String(raw ?? "").trim();
  if (!t) return NaN;
  const n = Number(t.replace(/\./g, "").replace(",", "."));
  return Number.isFinite(n) ? n : NaN;
}

function hpParseDecimalFlexible(raw) {
  const t = String(raw ?? "").trim();
  if (!t) return NaN;
  if (t.includes(",")) return hpParseNumberPt(t);
  const n = Number(t);
  return Number.isFinite(n) ? n : NaN;
}

function hpGetCellByKeys(record, keys) {
  for (const k of keys) {
    const v = record[k];
    if (v != null && String(v).trim() !== "") return String(v).trim();
  }
  return "";
}

function hpNormalizeCodigoMunicipio(raw) {
  const cod = parseInt(String(raw ?? "").trim(), 10);
  if (!Number.isFinite(cod) || cod <= 0) return null;
  return cod >= 1_000_000 ? Math.floor(cod / 10) : cod;
}

/** Aceita "MM/AAAA", "mmm/AAAA" (nome do mês em pt-BR) e "AAAA". */
function hpMesAnoKey(raw) {
  const s0 = String(raw || "").trim();
  if (!s0) return "";
  const numM = s0.match(/^(\d{1,2})\s*\/\s*(\d{4})\s*$/);
  if (numM) {
    const mes = parseInt(numM[1], 10);
    const ano = parseInt(numM[2], 10);
    if (mes >= 1 && mes <= 12 && ano >= 1900 && ano <= 2200) return `${ano}-${String(mes).padStart(2, "0")}`;
    return "";
  }
  const yearOnly = s0.match(/^(\d{4})$/);
  if (yearOnly) return `${yearOnly[1]}-12`;
  const s = s0
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "");
  const parts = s.split("/");
  if (parts.length < 2) return "";
  const ano = parseInt(parts[1].trim(), 10);
  if (!Number.isFinite(ano) || ano < 1900 || ano > 2200) return "";
  const mesToken = parts[0].trim().slice(0, 3);
  const mi = HP_MESES_ABREV_PT.indexOf(mesToken);
  if (mi < 0) return "";
  return `${ano}-${String(mi + 1).padStart(2, "0")}`;
}

function hpMesAnoKeyRank(key) {
  const m = /^(\d{4})-(\d{2})$/.exec(String(key || ""));
  if (!m) return 0;
  return parseInt(m[1], 10) * 12 + parseInt(m[2], 10);
}

function hpFormatMesAnoFromKey(key) {
  const m = /^(\d{4})-(\d{2})$/.exec(String(key || ""));
  if (!m) return "";
  const ano = parseInt(m[1], 10);
  const mi = parseInt(m[2], 10);
  if (mi < 1 || mi > 12) return "";
  return `${HP_MESES_ABREV_PT[mi - 1]}/${ano}`;
}

/** Aceita "DD/MM/AAAA", "MM/AAAA" e nomes de mês. */
function hpParseDataBrToMesAnoKey(raw) {
  const fromMesAno = hpMesAnoKey(raw);
  if (fromMesAno) return fromMesAno;
  const s = String(raw || "").trim();
  if (!s) return "";
  const parts = s.split("/");
  if (parts.length !== 3) return "";
  let day = Number(parts[0]);
  let month = Number(parts[1]);
  const year = Number(parts[2]);
  if (!Number.isFinite(day) || !Number.isFinite(month) || !Number.isFinite(year)) return "";
  if (month > 12 && day >= 1 && day <= 12) {
    const tmp = month;
    month = day;
    day = tmp;
  }
  if (month < 1 || month > 12 || day < 1 || day > 31 || year < 1900 || year > 2200) return "";
  return `${year}-${String(month).padStart(2, "0")}`;
}

function hpLatestReferenciaLabel(keys) {
  let latestKey = "";
  for (const key of keys) {
    if (!key) continue;
    if (hpMesAnoKeyRank(key) > hpMesAnoKeyRank(latestKey)) latestKey = key;
  }
  return hpFormatMesAnoFromKey(latestKey);
}

/** Aceita "DD/MM/AAAA" e "AAAA-MM-DD" (como na aba Dinheiro na Mão). */
function hpParseIsoOrBrDateToMesAnoKey(raw) {
  const s = String(raw || "").trim();
  if (!s) return "";
  const iso = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})(?:[T\s].*)?$/);
  if (iso) {
    const year = Number(iso[1]);
    const month = Number(iso[2]);
    if (month >= 1 && month <= 12 && year >= 1900 && year <= 2200) {
      return `${year}-${String(month).padStart(2, "0")}`;
    }
    return "";
  }
  return hpParseDataBrToMesAnoKey(s);
}

/* ----------------------------- Ceará Credi ----------------------------- */

function hpParseCearaCrediRows(text) {
  const lines = hpSplitLines(text);
  if (lines.length < 2) return [];
  const headers = hpParseCsvLine(lines[0]).map((h) => hpNormalizeKey(h));
  const rows = [];
  for (let i = 1; i < lines.length; i++) {
    const cells = hpParseCsvLine(lines[i]);
    if (!cells.length) continue;
    const record = {};
    headers.forEach((h, idx) => {
      if (!h) return;
      record[h] = (cells[idx] || "").trim();
    });
    const cod = hpNormalizeCodigoMunicipio(hpGetCellByKeys(record, ["geocodi", "codibge", "cod_ibge"]));
    if (cod == null) continue;
    const mesAno = hpGetCellByKeys(record, ["referencia"]);
    const cadastradas = hpParseDecimalFlexible(hpGetCellByKeys(record, ["cadastradas"]));
    const emAtendimento = hpParseDecimalFlexible(hpGetCellByKeys(record, ["ematendimento"]));
    const aprovadas = hpParseDecimalFlexible(hpGetCellByKeys(record, ["aprovadas"]));
    const valorLiberado = hpParseDecimalFlexible(hpGetCellByKeys(record, ["valorliberado"]));
    rows.push({
      codigo: cod,
      mesAnoKey: hpMesAnoKey(mesAno),
      cadastradas: Number.isFinite(cadastradas) ? cadastradas : 0,
      emAtendimento: Number.isFinite(emAtendimento) ? emAtendimento : 0,
      aprovadas: Number.isFinite(aprovadas) ? aprovadas : 0,
      valorLiberado: Number.isFinite(valorLiberado) ? valorLiberado : 0,
    });
  }
  return rows;
}

/** Para cada município, usa o saldo da competência mais recente (já acumulado até aquele mês). */
function hpSummarizeCearaCredi(rows) {
  const latestByCod = new Map();
  for (const row of rows) {
    const prev = latestByCod.get(row.codigo);
    if (!prev || hpMesAnoKeyRank(row.mesAnoKey) >= hpMesAnoKeyRank(prev.mesAnoKey)) {
      latestByCod.set(row.codigo, row);
    }
  }
  let cadastradas = 0;
  let emAtendimento = 0;
  let aprovadas = 0;
  let valorLiberado = 0;
  let latestKey = "";
  for (const row of latestByCod.values()) {
    cadastradas += row.cadastradas;
    emAtendimento += row.emAtendimento;
    aprovadas += row.aprovadas;
    valorLiberado += row.valorLiberado;
    if (hpMesAnoKeyRank(row.mesAnoKey) > hpMesAnoKeyRank(latestKey)) latestKey = row.mesAnoKey;
  }
  return {
    cadastradas,
    emAtendimento,
    aprovadas,
    valorLiberado,
    municipios: latestByCod.size,
    referenciaLabel: hpFormatMesAnoFromKey(latestKey),
  };
}

/* ------------------------------- Vai Vem -------------------------------- */

function hpParseVaiVemRows(text) {
  const lines = hpSplitLines(text);
  if (!lines.length) return [];
  const header = hpParseCsvLine(lines[0]).map((h) => h.trim());
  const idx = Object.fromEntries(header.map((h, i) => [h, i]));
  const pick = (cells, key) => cells[idx[key]] ?? "";
  const rows = [];
  for (let i = 1; i < lines.length; i++) {
    const cells = hpParseCsvLine(lines[i]);
    if (!cells.length) continue;
    const municipio = pick(cells, "municipio");
    if (!municipio) continue;
    rows.push({
      situacaoPrograma: pick(cells, "situacao_no_programa"),
      situacaoCartao: pick(cells, "situacao_cartao"),
      municipioKey: hpNormalizeKey(municipio),
      mesAnoKey: hpParseDataBrToMesAnoKey(pick(cells, "data_solicitacao")),
    });
  }
  return rows;
}

function hpNormText(value) {
  return String(value ?? "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .trim();
}

function hpSummarizeVaiVem(rows) {
  let desempregados = 0;
  let vinculoEmprego = 0;
  let cartaoEntregue = 0;
  const municipios = new Set();
  const mesKeys = [];
  for (const row of rows) {
    if (hpNormText(row.situacaoPrograma).includes("desempregad")) desempregados += 1;
    if (hpNormText(row.situacaoPrograma) === "vinculo de emprego") vinculoEmprego += 1;
    if (hpNormText(row.situacaoCartao).includes("entregue")) cartaoEntregue += 1;
    if (row.municipioKey) municipios.add(row.municipioKey);
    if (row.mesAnoKey) mesKeys.push(row.mesAnoKey);
  }
  return {
    total: rows.length,
    desempregados,
    vinculoEmprego,
    cartaoEntregue,
    municipios: municipios.size,
    referenciaLabel: hpLatestReferenciaLabel(mesKeys),
  };
}

/* ---------------------------- Qualificação ------------------------------ */

function hpQfHeaderIndex(header, candidates) {
  const map = new Map(header.map((h, i) => [hpNormalizeKey(h), i]));
  for (const c of candidates) {
    const idx = map.get(hpNormalizeKey(c));
    if (idx != null) return idx;
  }
  return -1;
}

function hpParseQualificacaoRows(text) {
  const lines = hpSplitLines(text);
  if (!lines.length) return [];
  const header = hpParseCsvLine(lines[0]);
  const idxCod = hpQfHeaderIndex(header, ["COD_IBGE", "Codigo_IBGE", "Código IBGE", "codibge"]);
  const idxVagas = hpQfHeaderIndex(header, ["VAGAS OFERTADAS", "Vagas Ofertadas"]);
  const idxInscritos = hpQfHeaderIndex(header, ["INSCRITOS"]);
  const idxConcludentes = hpQfHeaderIndex(header, ["CONCLUDENTES"]);
  const idxTermino = hpQfHeaderIndex(header, ["DATA TÉRMINO", "DATA TERMINO", "Data Término", "data_termino"]);
  if (idxCod < 0) return [];
  const rows = [];
  for (let i = 1; i < lines.length; i++) {
    const cells = hpParseCsvLine(lines[i]);
    if (!cells.length) continue;
    const codigo = hpNormalizeCodigoMunicipio(cells[idxCod]);
    if (codigo == null) continue;
    rows.push({
      codigo,
      vagas: idxVagas >= 0 ? hpParseNumberPt(cells[idxVagas]) || 0 : 0,
      inscritos: idxInscritos >= 0 ? hpParseNumberPt(cells[idxInscritos]) || 0 : 0,
      concludentes: idxConcludentes >= 0 ? hpParseNumberPt(cells[idxConcludentes]) || 0 : 0,
      mesAnoKey: idxTermino >= 0 ? hpParseDataBrToMesAnoKey(cells[idxTermino]) : "",
    });
  }
  return rows;
}

function hpSummarizeQualificacao(rows) {
  let vagas = 0;
  let inscritos = 0;
  let concludentes = 0;
  const municipios = new Set();
  const mesKeys = [];
  for (const row of rows) {
    vagas += row.vagas;
    inscritos += row.inscritos;
    concludentes += row.concludentes;
    municipios.add(row.codigo);
    if (row.mesAnoKey) mesKeys.push(row.mesAnoKey);
  }
  return {
    cursos: rows.length,
    vagas,
    inscritos,
    concludentes,
    municipios: municipios.size,
    referenciaLabel: hpLatestReferenciaLabel(mesKeys),
  };
}

/* --------------------------- Dinheiro na Mão ---------------------------- */

function hpParseDinheiroNaMaoRows(text) {
  const lines = hpSplitLines(text);
  if (lines.length < 2) return [];
  const header = hpParseCsvLine(lines[0]);
  const idxCodigo = hpQfHeaderIndex(header, ["COD_IBGE", "CODIGO IBGE"]);
  const idxPrincipal = hpQfHeaderIndex(header, ["VR_PCP_OPE"]);
  const idxJuros = hpQfHeaderIndex(header, ["VR_JRS_OPE"]);
  const idxData = hpQfHeaderIndex(header, [
    "DATA DESEMBOLSO / DATA CONTRATO",
    "DATA DESEMBOLSO DATA CONTRATO",
    "DATA CONTRATO",
  ]);
  if (idxCodigo < 0 || idxPrincipal < 0 || idxJuros < 0 || idxData < 0) return [];
  const rows = [];
  for (let i = 1; i < lines.length; i++) {
    const cells = hpParseCsvLine(lines[i]);
    if (!cells.length) continue;
    const codigo = hpNormalizeCodigoMunicipio(cells[idxCodigo]);
    if (codigo == null || codigo < 230000 || codigo > 239999) continue;
    rows.push({
      codigo,
      valorOperacoes: hpParseDecimalFlexible(cells[idxPrincipal]) || 0,
      valorJuros: hpParseDecimalFlexible(cells[idxJuros]) || 0,
      mesAnoKey: hpParseIsoOrBrDateToMesAnoKey(cells[idxData]),
    });
  }
  return rows;
}

function hpSummarizeDinheiroNaMao(rows) {
  let valorOperacoes = 0;
  let valorJuros = 0;
  const municipios = new Set();
  const mesKeys = [];
  for (const row of rows) {
    valorOperacoes += row.valorOperacoes;
    valorJuros += row.valorJuros;
    municipios.add(row.codigo);
    if (row.mesAnoKey) mesKeys.push(row.mesAnoKey);
  }
  return {
    operacoes: rows.length,
    valorOperacoes,
    valorJuros,
    municipios: municipios.size,
    referenciaLabel: hpLatestReferenciaLabel(mesKeys),
  };
}

/* --------------------------------- API ---------------------------------- */

function hpFetchText(url, timeoutMs = 90000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  return fetch(url, { cache: "no-store", signal: controller.signal })
    .then((res) => {
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return res.text();
    })
    .finally(() => clearTimeout(timer));
}

function hpLoadSource(url, parse, summarize) {
  return hpFetchText(url)
    .then((text) => ({ status: "ok", ...summarize(parse(text)) }))
    .catch((err) => {
      console.error("[home-programs]", url, err);
      return { status: "error" };
    });
}

let _homeProgramsPromise = null;

/**
 * Busca os 4 programas em paralelo, mas publica o resultado de cada fonte
 * assim que ela terminar — um CSV lento (ou travado) não segura os outros cards.
 */
function homeProgramsLoadData(onUpdate) {
  if (_homeProgramsPromise) {
    if (typeof onUpdate === "function") _homeProgramsPromise.then(onUpdate);
    return _homeProgramsPromise;
  }

  const data = {
    cearaCredi: { status: "loading" },
    dinheiroNaMao: { status: "loading" },
    vaiVem: { status: "loading" },
    qualificacao: { status: "loading" },
  };
  if (typeof onUpdate === "function") onUpdate(data);

  const publish = (key, value) => {
    data[key] = value;
    if (typeof onUpdate === "function") onUpdate(data);
  };

  const sources = [
    ["cearaCredi", HP_CEARA_CREDI_CSV_URL, hpParseCearaCrediRows, hpSummarizeCearaCredi],
    ["dinheiroNaMao", HP_DINHEIRO_NA_MAO_CSV_URL, hpParseDinheiroNaMaoRows, hpSummarizeDinheiroNaMao],
    ["vaiVem", HP_VAI_VEM_CSV_URL, hpParseVaiVemRows, hpSummarizeVaiVem],
    ["qualificacao", HP_QUALIFICACAO_CSV_URL, hpParseQualificacaoRows, hpSummarizeQualificacao],
  ];

  _homeProgramsPromise = Promise.all(
    sources.map(([key, url, parse, summarize]) => hpLoadSource(url, parse, summarize).then((value) => publish(key, value)))
  ).then(() => data);

  return _homeProgramsPromise;
}

window.homePrograms = {
  loadData: homeProgramsLoadData,
};
