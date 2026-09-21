// Busca os dados direto da planilha do Google Sheets (publicada como CSV) e
// monta a mesma estrutura de data/countries.json, no navegador — sem precisar
// exportar/rodar script nenhum quando a planilha é editada.
//
// Configuração: veja data/sheets-config.json. Se as URLs estiverem vazias,
// o app.js usa automaticamente o data/countries.json local (modo estático).
//
// Como isso fica público: as URLs abaixo só funcionam para abas publicadas
// via "Arquivo → Compartilhar → Publicar na web" no Google Sheets — ou seja,
// a mesma informação que já está pública no dashboard, só que buscada ao vivo.
(function (global) {
  "use strict";

  const NOME_ALIASES = {
    "República Centro-Africana": "Rep. C. Africana",
    "República Democrática do Congo": "Rep. Dem. Congo",
  };

  function parseCSV(text) {
    // Parser CSV simples compatível com o formato exportado pelo Google Sheets
    // (RFC4180: campos entre aspas quando contêm vírgula, quebra de linha ou aspas).
    const rows = [];
    let row = [], field = "", inQuotes = false;
    for (let i = 0; i < text.length; i++) {
      const c = text[i], next = text[i + 1];
      if (inQuotes) {
        if (c === '"' && next === '"') { field += '"'; i++; }
        else if (c === '"') { inQuotes = false; }
        else { field += c; }
      } else {
        if (c === '"') inQuotes = true;
        else if (c === ",") { row.push(field); field = ""; }
        else if (c === "\r") { /* ignore */ }
        else if (c === "\n") { row.push(field); rows.push(row); row = []; field = ""; }
        else { field += c; }
      }
    }
    if (field.length || row.length) { row.push(field); rows.push(row); }
    return rows.filter(r => r.some(cell => cell !== ""));
  }

  async function fetchCSV(url) {
    const res = await fetch(url, { cache: "no-store" });
    if (!res.ok) throw new Error(`Falha ao buscar CSV (${res.status}): ${url}`);
    return parseCSV(await res.text());
  }

  function buildDataset(geralRows, listasRows, isoLookup) {
    const listas = {};
    listasRows.slice(1).forEach(r => {
      const [pais, continente, regiao, ingles] = r;
      if (pais) listas[pais.trim()] = { continente, regiao, ingles };
    });

    const header = geralRows[0];
    const yearCols = [];
    for (let c = 1; c < header.length; c++) {
      const y = parseInt(header[c], 10);
      if (!isNaN(y)) yearCols.push({ year: y, col: c });
    }

    const countries = [];
    geralRows.slice(1).forEach(r => {
      const pais = (r[0] || "").trim();
      if (!pais) return;

      const ranks = {};
      yearCols.forEach(({ year, col }) => {
        const v = parseInt(r[col], 10);
        if (!isNaN(v)) ranks[year] = v;
      });

      const meta = listas[pais] || listas[NOME_ALIASES[pais]] || { continente: null, regiao: null, ingles: pais };
      const iso = isoLookup[meta.ingles || pais] || isoLookup[pais] || {};

      const sortedYears = Object.keys(ranks).map(Number).sort((a, b) => a - b);
      const variacaoAnual = {};
      for (let i = 1; i < sortedYears.length; i++) {
        const y = sortedYears[i], prev = sortedYears[i - 1];
        variacaoAnual[y] = ranks[prev] - ranks[y];
      }

      const vals = Object.values(ranks);
      const stats = {};
      if (vals.length) {
        stats.rank_medio = Math.round((vals.reduce((a, b) => a + b, 0) / vals.length) * 10) / 10;
        stats.melhor_rank = Math.min(...vals);
        stats.pior_rank = Math.max(...vals);
        stats.anos_na_lista = vals.length;
        stats.top10_pct = Math.round((vals.filter(v => v <= 10).length / vals.length) * 1000) / 10;
        stats.var_total = ranks[sortedYears[0]] - ranks[sortedYears[sortedYears.length - 1]];
      }

      countries.push({
        id: iso.iso3 || null,
        numeric: iso.numeric || null,
        nome_pt: pais,
        nome_en: meta.ingles || pais,
        continente: meta.continente,
        regiao: meta.regiao,
        ranks: Object.fromEntries(Object.entries(ranks).map(([y, v]) => [y, v])),
        variacao_anual: Object.fromEntries(Object.entries(variacaoAnual).map(([y, v]) => [y, v])),
        ...stats,
      });
    });

    const years = [...new Set(yearCols.map(y => y.year))].sort((a, b) => a - b);
    const lastYear = String(years[years.length - 1]);
    countries.sort((a, b) => (a.ranks[lastYear] ?? 999) - (b.ranks[lastYear] ?? 999));

    return { years, fonte: "Lista Mundial da Perseguição - Portas Abertas (portasabertas.org.br)", countries };
  }

  async function loadFromGoogleSheets(config, isoLookupUrl) {
    if (!config || !config.geralCsvUrl || !config.listasCsvUrl) {
      throw new Error("Google Sheets não configurado (data/sheets-config.json vazio) — usando dados locais.");
    }
    const [geralRows, listasRows, isoLookup] = await Promise.all([
      fetchCSV(config.geralCsvUrl),
      fetchCSV(config.listasCsvUrl),
      fetch(isoLookupUrl).then(r => r.json()),
    ]);
    return buildDataset(geralRows, listasRows, isoLookup);
  }

  global.SheetsData = { loadFromGoogleSheets, buildDataset, parseCSV };
})(window);
