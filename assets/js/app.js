// Mapa Mundial da Perseguição — dashboard interativo
// Dados: Portas Abertas (portasabertas.org.br)
(function () {
  "use strict";

  const WORLD_ATLAS_URL = "data/world-110m.json";
  const DATA_URL = "data/countries.json";
  const SHEETS_CONFIG_URL = "data/sheets-config.json";
  const ISO_LOOKUP_URL = "data/iso-lookup.json";
  const CONTINENTS_URL = "data/continents.json";
  const DETAILS_URL = "data/country-details.json";
  const TYPES_URL = "data/persecution-types.json";
  let detailsPromise = null;

  const state = {
    years: [],
    year: null,
    countries: [],
    byId: new Map(),
    world: null,
    continent: "",
    search: "",
    continentOf: {},
  };

  // Caixas (lon/lat) usadas para enquadrar cada continente no mapa.
  const CONTINENT_BOX = {
    "África": [-20, -36, 52, 38],
    "Ásia": [20, -11, 150, 78],
    "Europa": [-25, 34, 62, 72],
    "América": [-170, -57, -30, 75],
    "Oceania": [110, -50, 180, 0],
  };

  const colorScale = d3.scaleLinear()
    .domain([1, 12.5, 25, 37.5, 50])
    .range(["#c0392b", "#e0703a", "#f0b429", "#9fc35e", "#2f8f4e"])
    .clamp(true);

  // Bandeiras: SVG em assets/flags/<ISO3>.svg (não emoji — muitos sistemas, sobretudo
  // Windows, não compõem emoji de bandeira e mostram só as duas letras do país).
  const flagUrl = (iso3) => iso3 ? `assets/flags/${iso3}.svg` : null;

  const $ = (sel) => document.querySelector(sel);

  const yearSlider = $("#year-slider");
  const yearLabel = $("#year-label");
  const continentFilter = $("#continent-filter");
  const searchInput = $("#country-search");
  const countryList = $("#country-list");
  const listYear = $("#list-year");
  const listCount = $("#list-count");
  const svg = d3.select("#world-map");
  let mapLayer = null, mapProjection = null, mapPath = null;
  const mapTooltip = $("#map-tooltip");
  const mapLoading = $("#map-loading");

  const viewMap = $("#view-map");
  const viewCountry = $("#view-country");

  function rankColor(rank) {
    if (rank == null) return null;
    return colorScale(Math.max(1, Math.min(50, rank)));
  }

  function fmtVar(v) {
    if (v === undefined || v === null) return "—";
    if (v === 0) return "＝ estável";
    const arrow = v > 0 ? "▲" : "▼";
    // v > 0 means rank number went down (worse persecution -> higher on the list)
    const label = v > 0 ? "subiu" : "caiu";
    return `${arrow} ${Math.abs(v)} posições (${label} no ranking)`;
  }

  function init(worldData, appData, continentLookup) {
    state.world = worldData;
    state.continentOf = continentLookup || {};
    state.years = appData.years;
    state.countries = appData.countries;
    state.countries.forEach(c => state.byId.set(c.id, c));

    yearSlider.min = 0;
    yearSlider.max = state.years.length - 1;
    yearSlider.value = state.years.length - 1;
    state.year = state.years[state.years.length - 1];

    const continents = [...new Set(state.countries.map(c => c.continente).filter(Boolean))].sort();
    continents.forEach(c => {
      const opt = document.createElement("option");
      opt.value = c; opt.textContent = c;
      continentFilter.appendChild(opt);
    });

    drawMap();
    updateYearUI();
    renderList();

    yearSlider.addEventListener("input", () => {
      state.year = state.years[+yearSlider.value];
      updateYearUI();
      updateMapColors();
      renderList();
    });
    $("#year-prev").addEventListener("click", () => stepYear(-1));
    $("#year-next").addEventListener("click", () => stepYear(1));
    continentFilter.addEventListener("change", () => {
      state.continent = continentFilter.value;
      renderList();
      applyContinentView(true);
    });
    searchInput.addEventListener("input", () => {
      state.search = searchInput.value.trim().toLowerCase();
      renderList();
    });
    $("#back-to-map").addEventListener("click", () => { location.hash = ""; });

    window.addEventListener("hashchange", route);
    route();

    syncListPanelHeight();
  }

  // Mantém a lista lateral com a mesma altura do painel do mapa (a altura do
  // mapa varia com a largura da tela, então isso é recalculado ao vivo).
  function syncListPanelHeight() {
    const mapPanel = document.querySelector(".map-panel");
    if (!mapPanel || !window.ResizeObserver) return;
    const apply = () => {
      document.documentElement.style.setProperty("--map-panel-height", mapPanel.offsetHeight + "px");
    };
    new ResizeObserver(apply).observe(mapPanel);
    apply();
  }

  function stepYear(delta) {
    const idx = Math.max(0, Math.min(state.years.length - 1, +yearSlider.value + delta));
    yearSlider.value = idx;
    yearSlider.dispatchEvent(new Event("input"));
  }

  function updateYearUI() {
    yearLabel.textContent = state.year;
    listYear.textContent = state.year;
  }

  function drawMap() {
    const width = 960, height = 500;
    const projection = d3.geoNaturalEarth1().fitSize([width - 10, height - 10], topojson.feature(state.world, state.world.objects.countries));
    const path = d3.geoPath(projection);

    const countries = topojson.feature(state.world, state.world.objects.countries).features
      .filter(f => f.id !== "010"); // drop Antarctica for a tighter, more legible map

    mapProjection = projection;
    mapPath = path;
    mapLayer = svg.append("g").attr("class", "map-layer");

    mapLayer.selectAll("path.country-shape")
      .data(countries, d => d.id)
      .join("path")
      .attr("class", "country-shape is-nodata")
      .attr("d", path)
      .attr("data-numeric", d => d.id)
      .on("mousemove", onMapHover)
      .on("mouseleave", onMapLeave)
      .on("click", onMapClick);

    mapLoading.style.display = "none";
    updateMapColors();
    applyContinentView(false);
  }

  function featureContinents(d) {
    const key = d.id || (d.properties && d.properties.name);
    const out = new Set();
    // A classificação da planilha (ex.: Sudão em Ásia) vale para os países da lista;
    // o lookup geográfico completa os demais países do atlas.
    const c = d.id ? countryForNumeric(d.id) : null;
    if (c && c.continente) out.add(c.continente);
    else if (state.continentOf[key]) out.add(state.continentOf[key]);
    if (d.id === "643") { out.add("Europa"); out.add("Ásia"); } // Rússia: nos dois recortes
    return out;
  }

  // Mostra só o continente escolhido (cores mantidas) e enquadra o mapa nele.
  function applyContinentView(animate) {
    if (!mapLayer) return;
    const sel = state.continent;
    mapLayer.selectAll("path.country-shape")
      .style("display", d => (!sel || featureContinents(d).has(sel)) ? null : "none");

    let t = d3.zoomIdentity;
    const box = CONTINENT_BOX[sel];
    if (box) {
      const [x0, y0, x1, y1] = box;
      const pts = [];
      for (let i = 0; i <= 4; i++) {
        const lon = x0 + (x1 - x0) * i / 4, lat = y0 + (y1 - y0) * i / 4;
        pts.push([lon, y0], [lon, y1], [x0, lat], [x1, lat]);
      }
      const [[bx0, by0], [bx1, by1]] = mapPath.bounds({ type: "MultiPoint", coordinates: pts });
      const W = 960, H = 500;
      const k = Math.min(W / (bx1 - bx0), H / (by1 - by0)) * 0.94;
      t = d3.zoomIdentity
        .translate(W / 2 - k * (bx0 + bx1) / 2, H / 2 - k * (by0 + by1) / 2)
        .scale(k);
    }
    const tr = `translate(${t.x},${t.y}) scale(${t.k})`;
    if (animate) mapLayer.transition().duration(600).attr("transform", tr);
    else mapLayer.attr("transform", tr);
  }

  function countryForNumeric(numericId) {
    return state.countries.find(c => c.numeric === numericId);
  }

  function updateMapColors() {
    mapLayer.selectAll("path.country-shape")
      .attr("fill", d => {
        const c = countryForNumeric(d.id);
        const rank = c ? c.ranks[state.year] : undefined;
        if (!c || rank === undefined) return "var(--nodata)";
        return rankColor(rank);
      })
      .classed("is-nodata", d => {
        const c = countryForNumeric(d.id);
        return !c || c.ranks[state.year] === undefined;
      });
  }

  function onMapHover(event, d) {
    const c = countryForNumeric(d.id);
    const wrap = $("#map-wrap");
    const rect = wrap.getBoundingClientRect();
    const x = event.clientX - rect.left;
    const y = event.clientY - rect.top;
    mapTooltip.style.left = x + "px";
    mapTooltip.style.top = y + "px";
    if (!c) { mapTooltip.hidden = true; return; }
    const rank = c.ranks[state.year];
    mapTooltip.innerHTML = `<strong>${c.nome_pt}</strong>` +
      (rank !== undefined ? `<span class="tt-rank">#${rank}</span>` : `<span class="tt-rank">fora da lista</span>`);
    mapTooltip.hidden = false;
  }
  function onMapLeave() { mapTooltip.hidden = true; }

  function onMapClick(event, d) {
    const c = countryForNumeric(d.id);
    if (!c) return;
    location.hash = "#/pais/" + c.id;
  }

  function renderList() {
    const items = state.countries
      .filter(c => c.ranks[state.year] !== undefined)
      .filter(c => !state.continent || c.continente === state.continent)
      .filter(c => !state.search || c.nome_pt.toLowerCase().includes(state.search) || c.nome_en.toLowerCase().includes(state.search))
      .sort((a, b) => a.ranks[state.year] - b.ranks[state.year]);

    listCount.textContent = `${items.length} país${items.length === 1 ? "" : "es"}`;
    countryList.innerHTML = "";
    items.forEach(c => {
      const rank = c.ranks[state.year];
      const variation = c.variacao_anual[state.year];
      const li = document.createElement("li");
      li.className = "country-row";
      li.innerHTML = `
        <span class="rank-chip" style="background:${rankColor(rank)}">${rank}</span>
        <img class="row-flag" src="${flagUrl(c.id)}" alt="" loading="lazy">
        <span class="country-row-name">${c.nome_pt}</span>
        <span class="country-row-var ${variation > 0 ? "up" : variation < 0 ? "down" : ""}">
          ${variation === undefined ? "" : variation === 0 ? "＝" : (variation > 0 ? "▲" + variation : "▼" + Math.abs(variation))}
        </span>`;
      li.addEventListener("click", () => { location.hash = "#/pais/" + c.id; });
      countryList.appendChild(li);
    });
  }

  // ---------------- routing ----------------
  function route() {
    const hash = location.hash;
    const m = hash.match(/^#\/pais\/([A-Z]{3})$/);
    if (m) {
      const c = state.byId.get(m[1]);
      if (c) { showCountry(c); return; }
    }
    showMap();
  }

  function showMap() {
    viewCountry.hidden = true;
    viewMap.hidden = false;
    window.scrollTo({ top: 0, behavior: "instant" in window ? "instant" : "auto" });
  }

  function showCountry(c) {
    viewMap.hidden = true;
    viewCountry.hidden = false;
    window.scrollTo({ top: 0, behavior: "instant" in window ? "instant" : "auto" });

    const flagEl = $("#country-flag");
    const url = flagUrl(c.id);
    flagEl.innerHTML = url ? `<img src="${url}" alt="Bandeira: ${c.nome_pt}" loading="lazy">` : "";
    $("#country-name").textContent = c.nome_pt;
    $("#country-name-en").textContent = c.nome_en !== c.nome_pt ? c.nome_en : "";
    $("#country-continent").textContent = c.continente || "—";
    $("#country-region").textContent = c.regiao || "—";

    const years = state.years.filter(y => c.ranks[y] !== undefined);
    const latestYear = years[years.length - 1];
    const rank = latestYear !== undefined ? c.ranks[latestYear] : undefined;

    $("#country-rank-number").textContent = rank !== undefined ? "#" + rank : "—";
    $("#country-rank-number").style.color = rank !== undefined ? rankColor(rank) : "";
    $("#country-rank-year").textContent = latestYear || "";

    const variation = latestYear !== undefined ? c.variacao_anual[latestYear] : undefined;
    $("#country-variation").textContent = fmtVar(variation);

    if (c.posicao_mais_alta !== undefined) {
      $("#country-highlow").textContent = `#${c.posicao_mais_alta} (mais alta) · #${c.posicao_mais_baixa} (mais baixa)`;
    } else {
      $("#country-highlow").textContent = "—";
    }

    drawCountryChart(c);
    renderHistoryTable(c);
    renderAbout(c);
  }

  // ---------------- Sobre o país ----------------
  function loadDetails() {
    if (!detailsPromise) {
      const get = (url) => fetch(url).then(r => (r.ok ? r.json() : {})).catch(() => ({}));
      detailsPromise = Promise.all([get(DETAILS_URL), get(TYPES_URL)])
        .then(([details, types]) => ({ details, types }));
    }
    return detailsPromise;
  }

  function esc(v) {
    const d = document.createElement("div");
    d.textContent = v;
    return d.innerHTML;
  }

  function fmtDateBR(iso) {
    const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso || "");
    return m ? `${m[3]}/${m[2]}/${m[1]}` : iso;
  }

  function aboutHtml(d, types) {
    const out = [];
    const st = d.stats || {};
    const cards = [
      ["Religião oficial", st.religiao_oficial], ["Capital", st.capital],
      ["População", st.populacao], ["População cristã", st.populacao_crista],
    ].filter(x => x[1]);
    if (cards.length) {
      out.push('<div class="about-stats">' + cards.map(x =>
        `<div class="about-stat"><span class="about-stat-label">${x[0]}</span><span class="about-stat-value">${esc(x[1])}</span></div>`
      ).join("") + "</div>");
    }
    [["Visão geral", d.resumo], ["Mulheres", d.mulheres], ["Homens", d.homens]].forEach(([t, v]) => {
      if (v) out.push(`<div class="about-block"><h4>${t}</h4><p>${esc(v)}</p></div>`);
    });
    if (d.motores && d.motores.length) {
      const gloss = (types && types.tipos) || {};
      const items = d.motores.map((m, i) => {
        const desc = m.descricao || gloss[m.nome];
        if (!desc) return `<li><b>${esc(m.nome || "")}</b></li>`;
        return `<li><button type="button" class="tipo-btn" aria-expanded="false" data-tipo="${i}"><b>${esc(m.nome || "")}</b></button>` +
          `<p class="tipo-desc" hidden>${esc(desc)}</p></li>`;
      }).join("");
      const src = types && types.fonte_url
        ? `<p class="about-note">Toque em um tipo para ver a definição. Definições: <a href="${esc(types.fonte_url)}" target="_blank" rel="noopener">Portas Abertas ↗</a></p>` : "";
      out.push(`<div class="about-block"><h4>Tipos de perseguição</h4><ul class="about-list about-tipos">${items}</ul>${src}</div>`);
    }
    if (d.oracao && d.oracao.length) {
      out.push('<div class="about-block"><h4>Pedidos de oração</h4><ul class="about-list">' +
        d.oracao.map(o => `<li>${esc(o)}</li>`).join("") + "</ul></div>");
    }
    const more = [["História", d.historia], ["Contexto", d.contexto], ["História da igreja", d.historia_igreja]].filter(x => x[1]);
    if (more.length) {
      out.push('<details class="about-more"><summary>Mais informações</summary>' +
        more.map(x => `<div class="about-block"><h4>${x[0]}</h4><p>${esc(x[1])}</p></div>`).join("") + "</details>");
    }
    if (d.fonte_url) {
      out.push(`<p class="about-source">Resumo baseado em conteúdo da Portas Abertas · coletado em ${esc(fmtDateBR(d.coletado_em))} · <a href="${esc(d.fonte_url)}" target="_blank" rel="noopener"><b>Ver página original ↗</b></a></p>`);
    }
    return out.join("");
  }

  document.addEventListener("click", (e) => {
    const btn = e.target.closest && e.target.closest(".tipo-btn");
    if (!btn) return;
    const desc = btn.parentElement.querySelector(".tipo-desc");
    const open = btn.getAttribute("aria-expanded") === "true";
    btn.setAttribute("aria-expanded", String(!open));
    if (desc) desc.hidden = open;
  });

  function renderAbout(c) {
    const el = $("#country-about");
    el.innerHTML = '<p class="about-placeholder">Carregando…</p>';
    loadDetails().then(({ details, types }) => {
      if (!location.hash.endsWith("/" + c.id)) return;
      const d = details && details[c.id];
      el.innerHTML = d ? aboutHtml(d, types) : '<p class="about-placeholder">Informações em breve.</p>';
    });
  }

  function renderHistoryTable(c) {
    const el = $("#country-history-table");
    el.innerHTML = "";
    state.years.forEach(y => {
      const rank = c.ranks[y];
      const chip = document.createElement("div");
      chip.className = "history-chip";
      if (rank !== undefined) {
        chip.innerHTML = `<b style="color:${rankColor(rank)}">#${rank}</b>${y}`;
      } else {
        chip.innerHTML = `<b style="color:var(--ink-muted)">—</b>${y}`;
        chip.style.opacity = .55;
      }
      el.appendChild(chip);
    });
  }

  function drawCountryChart(c) {
    const el = $("#country-chart");
    el.innerHTML = "";
    const data = state.years
      .filter(y => c.ranks[y] !== undefined)
      .map(y => ({ year: y, rank: c.ranks[y] }));
    if (data.length === 0) {
      el.innerHTML = `<p style="color:var(--ink-muted);font-size:13px;margin:0">Sem histórico suficiente para este país.</p>`;
      return;
    }

    const width = 860, height = 260, margin = { top: 16, right: 20, bottom: 26, left: 34 };
    const innerW = width - margin.left - margin.right;
    const innerH = height - margin.top - margin.bottom;

    const x = d3.scalePoint().domain(data.map(d => d.year)).range([0, innerW]).padding(0.5);
    const y = d3.scaleLinear().domain([1, 50]).range([0, innerH]); // rank 1 at top (worse)

    const svgChart = d3.select(el).append("svg")
      .attr("viewBox", `0 0 ${width} ${height}`);
    const g = svgChart.append("g").attr("transform", `translate(${margin.left},${margin.top})`);

    [1, 10, 25, 50].forEach(v => {
      g.append("line").attr("class", "chart-gridline")
        .attr("x1", 0).attr("x2", innerW).attr("y1", y(v)).attr("y2", y(v));
      g.append("text").attr("class", "chart-axis-label")
        .attr("x", -8).attr("y", y(v) + 3).attr("text-anchor", "end").text(v);
    });

    data.forEach((d, i) => {
      if (i % Math.ceil(data.length / 8) === 0 || i === data.length - 1) {
        g.append("text").attr("class", "chart-axis-label")
          .attr("x", x(d.year)).attr("y", innerH + 18).attr("text-anchor", "middle").text(d.year);
      }
    });

    const line = d3.line().x(d => x(d.year)).y(d => y(d.rank)).curve(d3.curveMonotoneX);
    g.append("path").datum(data).attr("class", "line-path").attr("d", line);

    const dots = g.selectAll("circle.line-dot").data(data).join("circle")
      .attr("class", "line-dot")
      .attr("cx", d => x(d.year)).attr("cy", d => y(d.rank)).attr("r", 4);

    const hoverLine = g.append("line").attr("class", "chart-hover-line").attr("y1", 0).attr("y2", innerH).style("opacity", 0);
    const tooltip = document.createElement("div");
    tooltip.className = "chart-tooltip";
    tooltip.style.position = "absolute";
    tooltip.hidden = true;
    el.style.position = "relative";
    el.appendChild(tooltip);

    const bisect = d3.bisector(d => x(d.year)).center;

    svgChart.append("rect")
      .attr("x", margin.left).attr("y", margin.top).attr("width", innerW).attr("height", innerH)
      .attr("fill", "transparent")
      .on("mousemove", function (event) {
        const [mx] = d3.pointer(event, g.node());
        const idx = d3.least(data, (d) => Math.abs(x(d.year) - mx));
        const point = idx;
        hoverLine.attr("x1", x(point.year)).attr("x2", x(point.year)).style("opacity", 1);
        dots.classed("active", d => d.year === point.year);
        const scaleX = width / el.getBoundingClientRect().width;
        tooltip.style.left = ((margin.left + x(point.year)) / scaleX) + "px";
        tooltip.style.top = ((margin.top + y(point.rank)) / scaleX) + "px";
        const prevIdx = data.findIndex(d => d.year === point.year) - 1;
        let varTxt = "";
        if (prevIdx >= 0) {
          const diff = data[prevIdx].rank - point.rank;
          varTxt = diff === 0 ? " · estável" : diff > 0 ? ` · ▲${diff}` : ` · ▼${Math.abs(diff)}`;
        }
        tooltip.innerHTML = `<strong>${point.year}</strong> — #${point.rank}${varTxt}`;
        tooltip.hidden = false;
      })
      .on("mouseleave", function () {
        hoverLine.style("opacity", 0);
        dots.classed("active", false);
        tooltip.hidden = true;
      });
  }

  // ---------------- boot ----------------
  async function loadAppData() {
    try {
      const config = await d3.json(SHEETS_CONFIG_URL);
      const data = await SheetsData.loadFromGoogleSheets(config, ISO_LOOKUP_URL);
      markDataSource("live");
      return data;
    } catch (err) {
      console.warn("Usando data/countries.json local:", err.message);
      markDataSource("local");
      return d3.json(DATA_URL);
    }
  }

  function markDataSource(kind) {
    const badge = document.getElementById("data-source-badge");
    if (!badge) return;
    if (kind === "live") {
      badge.textContent = "● dados ao vivo (Google Sheets)";
      badge.title = "Carregado direto da planilha publicada.";
    } else {
      badge.textContent = "";
      badge.title = "";
    }
  }

  Promise.all([
    d3.json(WORLD_ATLAS_URL),
    loadAppData(),
    d3.json(CONTINENTS_URL).catch(() => ({})),
  ]).then(([world, appData, continents]) => {
    init(world, appData, continents);
  }).catch(err => {
    mapLoading.textContent = "Não foi possível carregar o mapa. Verifique a conexão e recarregue a página.";
    console.error(err);
  });
})();
