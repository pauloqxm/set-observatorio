"use strict";

/**
 * Resumo estadual da Intermediação de Mão de Obra para a página inicial.
 * Usa a mesma planilha pública da seção Intermediação do mapa.
 */
const HOME_INTERMEDIACAO_CSV_URL =
  "https://docs.google.com/spreadsheets/d/e/2PACX-1vQyc8fEsbFl47mk9a0w6iN3FXJQgSjkxURmb8R0_RzuhUuRde2NTxK_tbS5ZlWq7w84IAm3tHaRCpKn/pub?gid=0&single=true&output=csv";

const HOME_INTERMEDIACAO_MESES = ["Jan", "Fev", "Mar", "Abr", "Mai", "Jun", "Jul", "Ago", "Set", "Out", "Nov", "Dez"];
const HOME_INTERMEDIACAO_METRICAS = new Set(["vagas", "encaminhados", "colocados"]);

function homeIntermediacaoParseCsvLine(line) {
  const out = [];
  let current = "";
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const char = line[i];
    if (char === '"') {
      if (inQuotes && line[i + 1] === '"') {
        current += '"';
        i++;
      } else {
        inQuotes = !inQuotes;
      }
    } else if (char === "," && !inQuotes) {
      out.push(current.trim());
      current = "";
    } else {
      current += char;
    }
  }
  out.push(current.trim());
  return out;
}

function homeIntermediacaoNormalize(value) {
  return String(value ?? "")
    .trim()
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, "");
}

function homeIntermediacaoParseNumber(value) {
  const text = String(value ?? "").trim();
  if (!text) return 0;
  const number = Number(text.replace(/\./g, "").replace(",", "."));
  return Number.isFinite(number) ? number : 0;
}

function homeIntermediacaoMonthNumber(record) {
  const numeric = parseInt(record.mesn, 10);
  if (numeric >= 1 && numeric <= 12) return numeric;
  const normalized = homeIntermediacaoNormalize(record.mes).slice(0, 3);
  const monthNames = ["jan", "fev", "mar", "abr", "mai", "jun", "jul", "ago", "set", "out", "nov", "dez"];
  const index = monthNames.indexOf(normalized);
  return index >= 0 ? index + 1 : null;
}

function homeIntermediacaoParseRows(text) {
  const lines = String(text || "")
    .replace(/^\uFEFF/, "")
    .split(/\r?\n/)
    .filter((line) => line.trim());
  if (lines.length < 2) return [];

  const headers = homeIntermediacaoParseCsvLine(lines[0]).map(homeIntermediacaoNormalize);
  const rows = [];
  for (let i = 1; i < lines.length; i++) {
    const cells = homeIntermediacaoParseCsvLine(lines[i]);
    const record = {};
    headers.forEach((header, index) => {
      if (header) record[header] = String(cells[index] ?? "").trim();
    });

    const metric = homeIntermediacaoNormalize(record.indicador);
    const year = parseInt(record.ano, 10);
    const month = homeIntermediacaoMonthNumber(record);
    if (!HOME_INTERMEDIACAO_METRICAS.has(metric) || !Number.isFinite(year) || month == null) continue;

    rows.push({
      metric,
      year,
      month,
      value: homeIntermediacaoParseNumber(record.real || record.reali),
    });
  }
  return rows;
}

function homeIntermediacaoSummarize(rows) {
  const latestYear = Math.max(...rows.map((row) => row.year));
  if (!Number.isFinite(latestYear)) throw new Error("Planilha de Intermediação sem ano válido");

  const totals = { vagas: 0, encaminhados: 0, colocados: 0 };
  const colocadosByMonth = new Map();
  for (const row of rows) {
    if (row.year === latestYear) totals[row.metric] += row.value;
    if (row.metric === "colocados") {
      const key = `${row.year}-${String(row.month).padStart(2, "0")}`;
      colocadosByMonth.set(key, (colocadosByMonth.get(key) || 0) + row.value);
    }
  }

  const latestKeys = [...colocadosByMonth.keys()]
    .filter((key) => (colocadosByMonth.get(key) || 0) !== 0)
    .sort()
    .slice(-12);
  return {
    year: latestYear,
    totals,
    monthly: {
      categories: latestKeys.map((key) => {
        const [year, month] = key.split("-").map(Number);
        return `${HOME_INTERMEDIACAO_MESES[month - 1]}/${String(year).slice(-2)}`;
      }),
      values: latestKeys.map((key) => Math.round(colocadosByMonth.get(key) || 0)),
    },
  };
}

let homeIntermediacaoPromise = null;

function homeIntermediacaoLoadData() {
  if (homeIntermediacaoPromise) return homeIntermediacaoPromise;
  homeIntermediacaoPromise = fetch(HOME_INTERMEDIACAO_CSV_URL, { cache: "no-store" })
    .then((response) => {
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      return response.text();
    })
    .then(homeIntermediacaoParseRows)
    .then(homeIntermediacaoSummarize)
    .catch((error) => {
      homeIntermediacaoPromise = null;
      throw error;
    });
  return homeIntermediacaoPromise;
}

window.homeIntermediacao = {
  loadData: homeIntermediacaoLoadData,
};
