"use strict";

/**
 * Módulo leve e isolado da página inicial: agregação mensal de saldo do CAGED
 * (mesma fonte pública usada no mapa interativo) para o gráfico "Como está o
 * mercado de trabalho?" e para os dados por município do "Panorama do Ceará".
 */

const HOME_TREND_CAGED_CSV_URL =
  "https://docs.google.com/spreadsheets/d/e/2PACX-1vS8xs8t6M_BUp6ZfJa501mp3_zD0zhu13bHQxrq2xjfvElfAe_abXC6Pzb0Nubm7aH3aZcFIsAZi41X/pub?output=csv&single=true";

const HOME_TREND_MESES_ABREV_PT = ["Jan", "Fev", "Mar", "Abr", "Mai", "Jun", "Jul", "Ago", "Set", "Out", "Nov", "Dez"];

function homeTrendParseCsvLine(line) {
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

function homeTrendParseNumberPt(raw) {
  const t = String(raw ?? "").trim();
  if (!t) return NaN;
  const n = Number(t.replace(/\./g, "").replace(",", "."));
  return Number.isFinite(n) ? n : NaN;
}

function homeTrendNormalizeCodigo(raw) {
  const cod = parseInt(String(raw ?? "").trim(), 10);
  if (!Number.isFinite(cod) || cod <= 0) return null;
  return cod >= 1_000_000 ? Math.floor(cod / 10) : cod;
}

function homeTrendMesAnoKey(raw) {
  const m = String(raw || "").trim().match(/^(\d{1,2})\s*\/\s*(\d{4})\s*$/);
  if (!m) return "";
  const mes = parseInt(m[1], 10);
  const ano = parseInt(m[2], 10);
  if (mes < 1 || mes > 12) return "";
  return `${ano}-${String(mes).padStart(2, "0")}`;
}

function homeTrendKeyRank(key) {
  const m = /^(\d{4})-(\d{2})$/.exec(String(key || ""));
  if (!m) return 0;
  return parseInt(m[1], 10) * 12 + parseInt(m[2], 10);
}

function homeTrendFormatKey(key) {
  const m = /^(\d{4})-(\d{2})$/.exec(String(key || ""));
  if (!m) return String(key || "");
  const ano = parseInt(m[1], 10);
  const mes = parseInt(m[2], 10);
  return `${HOME_TREND_MESES_ABREV_PT[mes - 1]}/${String(ano).slice(2)}`;
}

/** Nome de município normalizado (sem acento/maiúsculas) para comparação tolerante. */
function homeTrendNormalizeNome(raw) {
  return String(raw || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .trim();
}

function homeTrendParseCagedRows(text) {
  const rows = [];
  const rawText = String(text || "").replace(/^\uFEFF/, "");
  const lines = rawText.split(/\r?\n/);
  for (const line of lines) {
    const t = line.trim();
    if (!/^\d{6,7}\s*,/.test(t)) continue;
    const cells = homeTrendParseCsvLine(t);
    if (cells.length < 7) continue;
    const codigo = homeTrendNormalizeCodigo(cells[0]);
    if (codigo == null) continue;
    const mesAno = cells[2];
    const estoque = homeTrendParseNumberPt(cells[3]);
    const admissoes = homeTrendParseNumberPt(cells[4]);
    const desligamentos = homeTrendParseNumberPt(cells[5]);
    const saldo = homeTrendParseNumberPt(cells[6]);
    rows.push({
      codigo,
      municipio: cells[1],
      mesAno,
      mesAnoKey: homeTrendMesAnoKey(mesAno),
      estoque: Number.isFinite(estoque) ? estoque : 0,
      admissoes: Number.isFinite(admissoes) ? admissoes : 0,
      desligamentos: Number.isFinite(desligamentos) ? desligamentos : 0,
      saldo: Number.isFinite(saldo) ? saldo : 0,
    });
  }
  return rows;
}

/** Soma o saldo de todos os municípios por mês e devolve os últimos N meses (cronológico). */
function homeTrendAggregateMonthlySaldo(rows, monthsLimit = 12) {
  const map = new Map();
  for (const r of rows) {
    if (!r.mesAnoKey) continue;
    map.set(r.mesAnoKey, (map.get(r.mesAnoKey) || 0) + r.saldo);
  }
  const keys = [...map.keys()].sort((a, b) => homeTrendKeyRank(a) - homeTrendKeyRank(b));
  const lastKeys = keys.slice(-monthsLimit);
  return {
    keys: lastKeys,
    categories: lastKeys.map(homeTrendFormatKey),
    values: lastKeys.map((k) => Math.round(map.get(k) || 0)),
  };
}

let _homeTrendPromise = null;

/** Busca (uma vez, com cache em memória) e devolve `{ rows, monthly }` do CAGED. */
function homeTrendLoadData() {
  if (_homeTrendPromise) return _homeTrendPromise;
  _homeTrendPromise = fetch(HOME_TREND_CAGED_CSV_URL, { cache: "no-store" })
    .then((res) => {
      if (!res.ok) throw new Error("Falha ao buscar dados do CAGED");
      return res.text();
    })
    .then((text) => {
      const rows = homeTrendParseCagedRows(text);
      const monthly = homeTrendAggregateMonthlySaldo(rows, 12);
      return { rows, monthly };
    })
    .catch((err) => {
      _homeTrendPromise = null;
      throw err;
    });
  return _homeTrendPromise;
}

window.homeTrend = {
  loadData: homeTrendLoadData,
  normalizeNome: homeTrendNormalizeNome,
};
