/**
 * Results page — read URL params, render profile & card, run saturation–brightness chart (with optional user point), print card.
 */

(function () {
  const CLIMATE_COPY = {
    tropical: {
      label: "Tropical Climate (A)",
      description: "Your comfort leans toward a tropical field: dense color, warm air, and proximity. Surfaces glow rather than glare; color feels close to the body, like an evening that stays warm well after sunset."
    },
    arid: {
      label: "Arid Climate (B)",
      description: "You are pulled toward an arid register: high brightness, dry contrast, and distance. Light sits sharply on surfaces, shadows are articulate, and color feels sun-struck rather than submerged."
    },
    polar: {
      label: "Polar Climate (E)",
      description: "You settle into a polar / Nordic band: muted saturation, low light, and quiet gradients. Color is hushed and indirect, more reflection than glare—closer to snowlight than noon."
    }
  };

  /** Sync mesh accent with profile (css/ambient-mesh.css reads data-mesh-climate). */
  function applyMeshClimate(climateId) {
    const c = ["tropical", "arid", "polar"].includes(climateId) ? climateId : "tropical";
    document.documentElement.dataset.meshClimate = c;
  }

  function getParams() {
    const params = new URLSearchParams(window.location.search);
    const climate = (params.get("climate") || "tropical").toLowerCase();
    const validClimate = ["tropical", "arid", "polar"].includes(climate) ? climate : "tropical";
    const s = Math.min(1, Math.max(0, parseFloat(params.get("s")) || 0.5));
    const b = Math.min(1, Math.max(0, parseFloat(params.get("b")) || 0.5));
    const match = Math.min(100, Math.max(0, parseInt(params.get("match"), 10) || 50));
    const warm = Math.min(100, Math.max(0, parseInt(params.get("w"), 10) || 50));
    const neutral = Math.min(100, Math.max(0, parseInt(params.get("n"), 10) || 50));
    const city = params.get("city") ? decodeURIComponent(params.get("city").replace(/\+/g, " ")) : "";
    const envRaw = (params.get("env") || "").toLowerCase();
    const envClimate = ["tropical", "arid", "polar"].includes(envRaw) ? envRaw : validClimate;
    const matchClRaw = (params.get("matchClimate") || "").toLowerCase();
    const matchClimate = ["tropical", "arid", "polar"].includes(matchClRaw) ? matchClRaw : validClimate;
    const paletteRaw = params.get("palette") || "";
    const paletteSeen = new Set();
    const palette = [];
    paletteRaw
      .split(",")
      .map((h) => (h || "").trim().replace(/^#/, "").toLowerCase())
      .filter((h) => /^[0-9a-f]{6}$/.test(h))
      .forEach((h) => {
        if (palette.length >= 6 || paletteSeen.has(h)) return;
        paletteSeen.add(h);
        palette.push("#" + h.toUpperCase());
      });

    const userFieldRaw = params.get("userField") || "";
    const userFieldHexes = userFieldRaw
      .split(",")
      .map((h) => (h || "").trim().replace(/^#/, ""))
      .filter((h) => /^[0-9a-fA-F]{6}$/.test(h))
      // cap for safety (URL size)
      .slice(0, 240)
      .map((h) => "#" + h.toUpperCase());
    return {
      climate: validClimate,
      saturation: s,
      brightness: b,
      match,
      warm,
      neutral,
      city,
      envClimate,
      matchClimate,
      palette,
      userFieldHexes
    };
  }

  /** Normalize to 6-char lowercase key or "". */
  function hexKeyResults(h) {
    const k = String(h || "")
      .trim()
      .replace(/^#/, "")
      .toLowerCase();
    return /^[0-9a-f]{6}$/.test(k) ? k : "";
  }

  /**
   * Up to 6 unique display hexes: URL `palette` order first, then `userField` (extracted colors), deduped.
   */
  function uniquePaletteFromParams(p) {
    const seen = new Set();
    const out = [];
    function take(list) {
      if (!Array.isArray(list)) return;
      for (let i = 0; i < list.length && out.length < 6; i++) {
        const k = hexKeyResults(list[i]);
        if (!k || seen.has(k)) continue;
        seen.add(k);
        out.push("#" + k.toUpperCase());
      }
    }
    take(p.palette);
    take(p.userFieldHexes);
    return out;
  }

  /** Distinct neutral placeholders so we never repeat the same fallback hex in a 6-swatch row. */
  const PALETTE_EMPTY_SLOTS = ["#3A3A3A", "#4A4A4A", "#5A5A5A", "#6A6A6A", "#7A7A7A", "#8A8A8A"];

  /**
   * Build weighted swatch entries for the "Your palette" step.
   * Dominance is derived from how frequently each extracted hex appears in `p.userFieldHexes`.
   *
   * @returns Array<{ hex: string, weightNorm: number }>
   */
  function weightedPaletteFromUserField(p, hexList) {
    const rawHexes = Array.isArray(p.userFieldHexes) ? p.userFieldHexes : [];
    const counts = {};
    rawHexes.forEach((h) => {
      const k = hexKeyResults(h);
      if (!k) return;
      counts[k] = (counts[k] || 0) + 1;
    });

    const fallbackCount = 1; // ensures palette-only hexes still render
    const items = (Array.isArray(hexList) ? hexList : []).map((hex) => {
      const k = hexKeyResults(hex);
      const rawCount = (k && counts[k] ? counts[k] : fallbackCount) || fallbackCount;
      return { hex, rawCount };
    });

    // Sort by dominance so the primary swatch is also the most dominant.
    items.sort((a, b) => (b.rawCount || 0) - (a.rawCount || 0));

    const sumRaw = items.reduce((acc, it) => acc + (it.rawCount || 0), 0) || 1;
    return items.map((it) => ({
      hex: it.hex,
      weightNorm: (it.rawCount || 0) / sumRaw
    }));
  }

  function stripClimateLabelSuffix(label) {
    return String(label || "").replace(/\s*\([A-Z]\)\s*$/, "").trim();
  }

  /** First word of climate label for short print copy, e.g. "Tropical Climate (A)" → "Tropical". */
  function climateShortNameFromLabel(label) {
    const s = stripClimateLabelSuffix(label);
    const first = s.split(/\s+/)[0];
    return first || s || "Climate";
  }

  /** A6 two-page comfort card: gradients, swatches, metrics, QR. */
  function renderPrintComfortCard(p, userHexes) {
    const wrap = document.getElementById("results-print-card");
    if (wrap) {
      const c = ["tropical", "arid", "polar"].includes(p.matchClimate) ? p.matchClimate : "tropical";
      wrap.setAttribute("data-print-climate", c);
    }

    const matchClCopy = CLIMATE_COPY[p.matchClimate] || CLIMATE_COPY.tropical;
    const shortClimate = climateShortNameFromLabel(matchClCopy.label);
    const letter = (String(matchClCopy.label).match(/\(([A-Z])\)/) || [])[1] || "";
    const bracketLabel = "{" + shortClimate + (letter ? " (" + letter + ")" : "") + " Profile}";

    const matchLine = document.getElementById("print-card-match-line");
    if (matchLine) {
      matchLine.innerHTML =
        "<em>You are a " + p.match + "% " + shortClimate + " Match</em>";
    }

    const foot = document.getElementById("print-card-profile-brackets");
    if (foot) foot.textContent = bracketLabel;

    const backH = document.getElementById("print-card-back-header");
    if (backH) backH.textContent = bracketLabel;

    const dataEl = document.getElementById("print-card-data");
    if (dataEl) {
      const sat = Math.round(p.saturation * 100);
      const bri = Math.round(p.brightness * 100);
      const warmR = (p.warm / 100).toFixed(1);
      const neuR = (p.neutral / 100).toFixed(1);
      function row(k, v) {
        return (
          '<div class="comfort-card__data-row">' +
          '<span class="comfort-card__data-k">' +
          k +
          '</span><span class="comfort-card__data-v">' +
          v +
          "</span></div>"
        );
      }
      dataEl.innerHTML =
        row("Saturation %", sat + "%") +
        row("Warmth ratio", warmR) +
        row("Neutral ratio", neuR) +
        row("Brightness", bri + "%");
    }

    const sw = document.getElementById("print-card-swatches");
    if (sw) {
      sw.innerHTML = "";
      const hexes = Array.isArray(userHexes) ? userHexes.slice(0, 6) : [];
      for (let i = 0; i < 6; i++) {
        const d = document.createElement("div");
        d.className = "comfort-card__swatch";
        d.style.backgroundColor = hexes[i] || PALETTE_EMPTY_SLOTS[i];
        sw.appendChild(d);
      }
    }

    const qr = document.getElementById("print-card-qr");
    if (qr) {
      try {
        const url = window.location.href.split("#")[0];
        qr.src =
          "https://api.qrserver.com/v1/create-qr-code/?size=200x200&margin=10&data=" +
          encodeURIComponent(url);
      } catch (e) {
        qr.removeAttribute("src");
      }
    }
  }

  async function loadNatureFlatRows(climateId) {
    const climateToFolder = { tropical: "brazil", arid: "egypt", polar: "finland" };
    const folder = climateToFolder[climateId] || "brazil";
    const candidates = [
      "data/results_" + folder + "_nature_clean_superflat.json",
      "data/results_" + folder + "_nature_superflat.json"
    ];
    for (let i = 0; i < candidates.length; i++) {
      try {
        const res = await fetch(candidates[i]);
        if (res.ok) {
          const data = await res.json();
          if (Array.isArray(data) && data.length) return data;
        }
      } catch (e) {
        /* try next */
      }
    }
    return null;
  }

  function computeNatureMetricsFromRows(data) {
    if (!Array.isArray(data) || !data.length || !window.ColorUtils) return null;
    let sumW = 0;
    let sumS = 0;
    let sumB = 0;
    let sumNeutralW = 0;
    for (let i = 0; i < data.length; i++) {
      const row = data[i];
      const r = row.r;
      const g = row.g;
      const b = row.b;
      if (r == null || g == null || b == null) continue;
      const hsv = window.ColorUtils.rgbToHsv(r, g, b);
      if (!hsv) continue;
      const sat01 = Math.min(1, Math.max(0, hsv.s / 100));
      const val01 = Math.min(1, Math.max(0, hsv.v / 100));
      const w =
        typeof row.percent === "number" ? row.percent : typeof row.weight === "number" ? row.weight : 1;
      sumW += w;
      sumS += sat01 * w;
      sumB += val01 * w;
      if (sat01 <= 0.14) sumNeutralW += w;
    }
    if (!sumW) return null;
    return {
      saturation: sumS / sumW,
      brightness: sumB / sumW,
      neutralRatio: (sumNeutralW / sumW) * 100
    };
  }

  /** Dominant hexes from nature JSON (weighted by row percent), for “expected · nature” swatches. */
  function topNatureHexesFromRows(data, maxLen) {
    if (!Array.isArray(data) || !data.length) return [];
    const max = typeof maxLen === "number" ? maxLen : 6;
    const bucket = new Map();
    data.forEach((row) => {
      const hex = (row.hex || row.color_hex || row.color || "")
        .toString()
        .trim()
        .toLowerCase()
        .replace(/^#/, "");
      if (!/^[0-9a-f]{6}$/.test(hex)) return;
      const w =
        typeof row.percent === "number" ? row.percent : typeof row.weight === "number" ? row.weight : 1;
      bucket.set(hex, (bucket.get(hex) || 0) + w);
    });
    const sorted = Array.from(bucket.entries()).sort((a, b) => b[1] - a[1]);
    const out = sorted.slice(0, max).map(([h]) => "#" + h.toUpperCase());
    while (out.length < 6 && out.length > 0) out.push(out[out.length % out.length]);
    return out;
  }

  /** Weighted HSV saturation/brightness + low-sat “neutral” share from nature JSON (same files as the dot-field). */
  async function loadNatureAggregateMetrics(climateId) {
    const data = await loadNatureFlatRows(climateId);
    return computeNatureMetricsFromRows(data);
  }

  /** Up to `max` unique #RRGGBB strings from weighted palette entries (no duplicate hexes). */
  function uniquePaletteHexesFromWeighted(sortedEntries, max) {
    const cap = typeof max === "number" && max > 0 ? max : 6;
    const out = [];
    const seen = new Set();
    const list = Array.isArray(sortedEntries) ? sortedEntries : [];
    for (let i = 0; i < list.length && out.length < cap; i++) {
      const raw = (list[i] && list[i].hex ? list[i].hex : "").trim();
      if (!raw) continue;
      const k = raw.replace(/^#/, "").toLowerCase();
      if (!/^[0-9a-f]{6}$/.test(k) || seen.has(k)) continue;
      seen.add(k);
      if (window.ColorUtils && typeof window.ColorUtils.formatHexDisplay === "function") {
        const disp = window.ColorUtils.formatHexDisplay("#" + k);
        if (disp) out.push(disp);
      } else {
        out.push("#" + k.toUpperCase());
      }
    }
    return out;
  }

  /**
   * Three-way metrics table: columns Nature · Advertising · You (rows: saturation, brightness, neutral share).
   * @param {object|null} natureAgg - computeNatureMetricsFromRows output
   * @param {object|null} adSummary - env model entry for closest-match climate (saturation/brightness/neutralRatio)
   */
  function renderYouNatureAdsTable(container, p, natureAgg, adSummary) {
    if (!container) return;
    container.innerHTML = "";
    if (!natureAgg && !adSummary) {
      const pEl = document.createElement("p");
      pEl.className = "nature-vs-fallback";
      pEl.textContent = "Nature and advertising baselines could not be loaded for this comparison.";
      container.appendChild(pEl);
      return;
    }

    const uSat = Math.round(p.saturation * 100);
    const uBri = Math.round(p.brightness * 100);
    const uNeu = Math.round(p.neutral);
    const nSat = natureAgg ? Math.round(natureAgg.saturation * 100) : null;
    const nBri = natureAgg ? Math.round(natureAgg.brightness * 100) : null;
    const nNeu = natureAgg ? Math.round(natureAgg.neutralRatio) : null;
    const aSat = adSummary ? Math.round(adSummary.saturation * 100) : null;
    const aBri = adSummary ? Math.round(adSummary.brightness * 100) : null;
    const aNeu = adSummary ? Math.round(adSummary.neutralRatio) : null;

    function cellPct(v) {
      if (v == null || Number.isNaN(v)) return "—";
      return v + "%";
    }

    const isJourneyGraphic = container.id === "journey-nature-vs-grid";

    if (isJourneyGraphic) {
      const metrics = [
        { label: "Saturation", nature: nSat, ad: aSat, user: uSat },
        { label: "Brightness", nature: nBri, ad: aBri, user: uBri },
        { label: "Neutral share", nature: nNeu, ad: aNeu, user: uNeu }
      ];

      const wrap = document.createElement("div");
      wrap.className = "journey-nature-graphic";
      wrap.setAttribute("role", "table");

      function buildCol(title, toneClass, key) {
        const col = document.createElement("section");
        col.className = "journey-nature-graphic__col " + toneClass;
        col.setAttribute("role", "rowgroup");

        const h = document.createElement("p");
        h.className = "journey-nature-graphic__col-title";
        h.textContent = title;
        col.appendChild(h);

        metrics.forEach((m) => {
          const pct = m[key];
          const card = document.createElement("div");
          card.className = "journey-nature-graphic__card";
          card.setAttribute("role", "row");
          const clamped = Math.max(0, Math.min(100, Number(pct || 0)));
          card.style.setProperty("--metric-pct", String(clamped));

          const metric = document.createElement("p");
          metric.className = "journey-nature-graphic__metric";
          metric.textContent = m.label;
          card.appendChild(metric);

          const val = document.createElement("p");
          val.className = "journey-nature-graphic__value";
          val.textContent = cellPct(pct);
          card.appendChild(val);

          col.appendChild(card);
        });

        return col;
      }

      wrap.appendChild(buildCol("Nature", "journey-nature-graphic__col--nature", "nature"));
      wrap.appendChild(buildCol("Advertising", "journey-nature-graphic__col--ad", "ad"));
      wrap.appendChild(buildCol("You", "journey-nature-graphic__col--you", "user"));
      container.appendChild(wrap);
      return;
    }

    const table = document.createElement("div");
    table.className = "nature-vs-table nature-vs-table--triple";
    table.setAttribute("role", "table");

    const head = document.createElement("div");
    head.className = "nature-vs-table__row nature-vs-table__row--head";
    ["", "Nature", "Advertising", "You"].forEach((t) => {
      const c = document.createElement("span");
      c.textContent = t;
      head.appendChild(c);
    });
    table.appendChild(head);

    function addRow(metricLabel, natureVal, adVal, userVal) {
      const row = document.createElement("div");
      row.className = "nature-vs-table__row";
      const label = document.createElement("span");
      label.textContent = metricLabel;
      const natureCell = document.createElement("span");
      natureCell.textContent = cellPct(natureVal);
      const adCell = document.createElement("span");
      adCell.textContent = cellPct(adVal);
      const userCell = document.createElement("span");
      userCell.textContent = cellPct(userVal);
      row.appendChild(label);
      row.appendChild(natureCell);
      row.appendChild(adCell);
      row.appendChild(userCell);
      table.appendChild(row);
    }

    addRow("Saturation", nSat, aSat, uSat);
    addRow("Brightness", nBri, aBri, uBri);
    addRow("Neutral share", nNeu, aNeu, uNeu);

    container.appendChild(table);
  }

  // Aggregate climate dataset once so we can derive an expected environmental palette
  // and simple summary metrics (saturation, brightness, neutral ratio) for comparison.
  let cachedEnvModel = null;

  async function loadEnvironmentalModel() {
    if (cachedEnvModel) return cachedEnvModel;
    if (!window.ClimateData || !window.ColorUtils) return null;

    const resultsByClimate = await window.ClimateData.loadResultsJsonFiles();
    const points = window.ClimateData.extractScatterplotMetrics(resultsByClimate);
    const centroids = window.ClimateData.computeClimateCentroid(points);
    const topColorsByClimate = window.ClimateData.extractTopDominantColors(resultsByClimate, 24);
    const paletteModel = window.ClimateData.buildSwatchPaletteModel(topColorsByClimate);

    const neutralByClimate = { tropical: { sumW: 0, sumNeutral: 0 }, arid: { sumW: 0, sumNeutral: 0 }, polar: { sumW: 0, sumNeutral: 0 } };
    points.forEach((pt) => {
      const bucket = neutralByClimate[pt.climateId];
      if (!bucket) return;
      const w = pt.weight > 0 ? pt.weight : 1;
      const isNeutral = pt.saturation <= 0.14; // low saturation ≈ neutral field
      bucket.sumW += w;
      if (isNeutral) bucket.sumNeutral += w;
    });

    const summary = {};
    ["tropical", "arid", "polar"].forEach((id) => {
      const centroid = centroids[id];
      const neutralBucket = neutralByClimate[id];
      const neutralRatio = neutralBucket.sumW ? (neutralBucket.sumNeutral / neutralBucket.sumW) * 100 : 50;

      const climatePalette = paletteModel[id] || [];
      const sorted = climatePalette.slice().sort((a, b) => (b.weight || 0) - (a.weight || 0));
      const hexes = uniquePaletteHexesFromWeighted(sorted, 6);

      summary[id] = {
        id,
        label: centroid && centroid.label ? centroid.label : (CLIMATE_COPY[id] && CLIMATE_COPY[id].label) || id,
        saturation: centroid ? centroid.saturation : 0.5,
        brightness: centroid ? centroid.brightness : 0.5,
        neutralRatio,
        paletteHexes: hexes
      };
    });

    cachedEnvModel = summary;
    return summary;
  }

  function describeMetricDelta(userVal, envVal, label, baselinePhrase) {
    const phrase = baselinePhrase || "expected baseline";
    const diff = userVal - envVal;
    const abs = Math.abs(diff);
    if (abs < 0.05) return null;
    const direction =
      diff > 0
        ? (label === "neutral" ? "less neutral than" : "higher than")
        : (label === "neutral" ? "more neutral than" : "lower than");
    const qualifier = abs > 0.18 ? "much " : abs > 0.1 ? "" : "slightly ";
    return `${label.charAt(0).toUpperCase() + label.slice(1)} is ${qualifier}${direction} the ${phrase}.`;
  }

  function displayHex(hex) {
    if (window.ColorUtils && typeof window.ColorUtils.formatHexDisplay === "function") {
      return window.ColorUtils.formatHexDisplay(hex) || hex || "#888888";
    }
    const raw = String(hex || "").trim();
    if (!raw) return "#888888";
    const body = raw.replace(/^#/, "").toUpperCase();
    return /^[0-9A-F]{6}$/.test(body) ? "#" + body : raw.toUpperCase();
  }

  function fillStandardSwatches(container, hexList) {
    if (!container) return;
    container.innerHTML = "";
    const hexes = Array.isArray(hexList) ? hexList.slice(0, 6) : [];
    for (let i = 0; i < 6; i++) {
      const hex = i < hexes.length && hexes[i] ? hexes[i] : PALETTE_EMPTY_SLOTS[i];
      const labelHex = displayHex(hex);
      const swatch = document.createElement("div");
      swatch.className = "results-palette__swatch";
      swatch.style.backgroundColor = hex;
      swatch.setAttribute("title", labelHex);
      const hexLabel = document.createElement("span");
      hexLabel.className = "results-palette__swatch-hex";
      hexLabel.textContent = labelHex;
      swatch.appendChild(hexLabel);
      container.appendChild(swatch);
    }
  }

  function fillHeroProfileSwatches(container, hexList) {
    if (!container) return;
    container.innerHTML = "";
    const items = Array.isArray(hexList) ? hexList : [];

    // Support both:
    //  - old format: array of strings (hexes)
    //  - new format: array of {hex, weightNorm}
    const hasWeights = items.length && typeof items[0] === "object" && items[0] !== null && "hex" in items[0];

    const entries = (hasWeights ? items : items.map((h) => ({ hex: h, weightNorm: 1 / Math.max(1, items.length || 1) }))).slice(0, 6);
    for (let i = 0; i < 6; i++) {
      const entry = i < entries.length ? entries[i] : null;
      const hex = entry && entry.hex ? entry.hex : PALETTE_EMPTY_SLOTS[i];
      const weightNorm = entry && typeof entry.weightNorm === "number" ? entry.weightNorm : 1 / 6;
      const labelHex = displayHex(hex);
      const swatch = document.createElement("div");
      swatch.className = "data-profile-hero__swatch" + (i === 0 ? " data-profile-hero__swatch--primary" : "");
      swatch.style.backgroundColor = hex;
      swatch.setAttribute("title", labelHex);

      // Keep dominance available for CSS tuning (editorial layout).
      swatch.style.setProperty("--dominance", String(weightNorm));

      const hexLabel = document.createElement("span");
      hexLabel.className = "data-profile-hero__hex";
      hexLabel.textContent = labelHex;
      swatch.appendChild(hexLabel);

      container.appendChild(swatch);
    }
  }

  /** Pre-dashboard journey only — vertical bars use --metric-pct + height transition when slide is active */
  function setJourneyMetricBars(p, userHexes) {
    const sat = Math.round(p.saturation * 100);
    const bri = Math.round(p.brightness * 100);
    const warm = p.warm;
    const neu = p.neutral;
    const hexList = Array.isArray(userHexes) ? userHexes.filter(Boolean) : [];

    const setBar = (valueId, fillId, pct, valueText, barIndex) => {
      const v = document.getElementById(valueId);
      const f = document.getElementById(fillId);
      const clamped = Math.min(100, Math.max(0, pct));
      if (v) v.textContent = valueText;
      if (f) f.style.setProperty("--metric-pct", String(clamped));

      const barEl = f && f.closest ? f.closest(".journey-metric-bar") : null;
      const bg =
        hexList.length > 0 ? hexList[barIndex % hexList.length] : null;

      if (f) {
        if (bg) {
          f.style.background = bg;
          f.style.backgroundImage = "none";
        } else {
          f.style.removeProperty("background");
          f.style.removeProperty("background-image");
        }
      }
      /* Percent labels: white + shadow from CSS (.journey-metric-bar__value) */
      if (v) v.style.removeProperty("color");
      if (barEl) {
        if (bg) barEl.style.setProperty("--bar-accent", bg);
        else barEl.style.removeProperty("--bar-accent");
      }
    };

    setBar("journey-metric-sat-value", "journey-metric-sat-fill", sat, sat + "%", 0);
    setBar("journey-metric-bri-value", "journey-metric-bri-fill", bri, bri + "%", 1);
    const warmStrength = Math.max(warm, 100 - warm);
    setBar("journey-metric-warm-value", "journey-metric-warm-fill", warmStrength, warmStrength + "%", 2);
    setBar("journey-metric-neutral-value", "journey-metric-neutral-fill", neu, neu + "%", 3);
  }

  function renderDeltaStrip(el, diffSatPct, diffBriPct, diffNeutralPct) {
    if (!el) return;
    el.innerHTML = "";

    const arrowUp =
      '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><path d="M12 19V5M5 12l7-7 7 7"/></svg>';
    const arrowDown =
      '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><path d="M12 5v14M19 12l-7 7-7-7"/></svg>';
    const arrowFlat =
      '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><path d="M5 12h14"/></svg>';

    const mk = (label, d, hint) => {
      const abs = Math.abs(d);
        const chip = document.createElement("div");
      chip.className = "data-delta-chip";
      if (d > 0) chip.classList.add("data-delta-chip--up");
      else if (d < 0) chip.classList.add("data-delta-chip--down");
      else chip.classList.add("data-delta-chip--flat");

      const dir = document.createElement("div");
      dir.className = "data-delta-chip__dir";
      dir.innerHTML = (d > 0 ? arrowUp : d < 0 ? arrowDown : arrowFlat) +
        "<span>" + (d === 0 ? "0" : (d > 0 ? "+" : "−") + abs) + "</span>";

      const lab = document.createElement("span");
      lab.className = "data-delta-chip__label";
      lab.textContent = label;

      const h = document.createElement("span");
      h.className = "data-delta-chip__hint";
      h.textContent = hint;

      chip.appendChild(dir);
      chip.appendChild(lab);
      chip.appendChild(h);
      return chip;
    };

    el.appendChild(
      mk(
        "Saturation",
        diffSatPct,
        diffSatPct === 0 ? "aligned" : diffSatPct > 0 ? "more saturated" : "less saturated"
      )
    );
    el.appendChild(
      mk(
        "Brightness",
        diffBriPct,
        diffBriPct === 0 ? "aligned" : diffBriPct > 0 ? "brighter" : "darker"
      )
    );
    el.appendChild(
      mk(
        "Neutral presence",
        diffNeutralPct,
        diffNeutralPct === 0 ? "aligned" : diffNeutralPct > 0 ? "less neutral space" : "more neutral space"
      )
    );
  }

  function buildInterpretation(alignment, notes, useAdvertisingBaseline) {
    const ref = useAdvertisingBaseline
      ? "the closest advertising palette to your selections"
      : "nature photography from your formative climate zone";
    if (alignment === "close") {
      if (notes.length) {
        return "Your palette closely reflects " + ref + ", with subtle shifts: " + notes.join(" ");
      }
      return "Your palette closely reflects " + ref + ".";
    }
    if (alignment === "partial") {
      return (
        "Your selections partially align with " +
        ref +
        ", while shifting toward " +
        (notes.join(" ").toLowerCase() || "a slightly different balance of saturation, brightness, and neutral space") +
        "."
      );
    }
    return (
      "Your palette diverges from that reference field, suggesting a preference that moves toward a different balance, " +
      (notes.join(" ").toLowerCase() || "rebalancing saturation, brightness, and neutral space in a different way.")
    );
  }

  async function renderFromParams() {
    const p = getParams();
    applyMeshClimate(p.matchClimate);
    const posterCopy = CLIMATE_COPY[p.climate] || CLIMATE_COPY.tropical;
    const matchClCopy = CLIMATE_COPY[p.matchClimate] || CLIMATE_COPY.tropical;
    const matchLabelShort = stripClimateLabelSuffix(matchClCopy.label);
    const posterLabelShort = stripClimateLabelSuffix(posterCopy.label);

    const headingEl = document.getElementById("profile-heading");
    const textEl = document.getElementById("profile-text");
    const narrativeHtml =
      'By <strong>color similarity</strong>, your selections map closest to the ' +
      '<strong>' + matchLabelShort + '</strong> advertising palette ' +
      '(<strong>' + p.match + '% match</strong>). ' +
      matchClCopy.description +
      (p.climate !== p.matchClimate
        ? ' <span class="results-profile-crosswalk">Your image picks leaned toward <strong>' +
          posterLabelShort +
          "</strong> poster imagery.</span>"
        : "");
    if (headingEl) headingEl.textContent = matchClCopy.label;
    if (textEl) {
      textEl.innerHTML = narrativeHtml;
    }
    const journeyNarr = document.getElementById("journey-expected-narrative");

    // Data breakdown blocks
    const satEl = document.getElementById("results-metric-sat");
    const briEl = document.getElementById("results-metric-bri");
    const warmEl = document.getElementById("results-metric-warm");
    const neutralEl = document.getElementById("results-metric-neutral");
    if (satEl) satEl.textContent = Math.round(p.saturation * 100) + "%";
    if (briEl) briEl.textContent = Math.round(p.brightness * 100) + "%";
    if (warmEl) warmEl.textContent = p.warm + "% warm colors";
    if (neutralEl) neutralEl.textContent = p.neutral + "% neutral tones";

    const warmCaption = p.warm >= 50 ? "Warm dominance" : "Cool dominance";
    const warmRail = document.getElementById("results-metric-warm-label");
    const warmJourneyCap = document.getElementById("journey-metric-warm-caption");
    if (warmRail) warmRail.textContent = warmCaption;
    if (warmJourneyCap) {
      warmJourneyCap.innerHTML =
        p.warm >= 50
          ? "<em>Warm</em>-leaning palette — " + p.warm + "% on the warm side of the axis."
          : "<em>Cool</em>-leaning palette — " + (100 - p.warm) + "% on the cool side.";
    }

    const userHexes = uniquePaletteFromParams(p);
    const weightedUserHexes = weightedPaletteFromUserField(p, userHexes);
    renderPrintComfortCard(p, userHexes);
    setJourneyMetricBars(p, userHexes);
    fillHeroProfileSwatches(document.getElementById("journey-profile-hero-swatches"), weightedUserHexes);
    fillStandardSwatches(document.getElementById("palette-swatches"), userHexes);

    // Left: expected swatches from nature (formative climate band). Right: closest-match advertising palette.
    const envModel = await loadEnvironmentalModel();
    const envSummary = envModel ? envModel[p.envClimate] : null;
    const matchSummary = envModel ? envModel[p.matchClimate] : null;

    const natureEnvRows = await loadNatureFlatRows(p.envClimate);
    const natureEnvAgg = computeNatureMetricsFromRows(natureEnvRows);
    const natureExpectedHexes = topNatureHexesFromRows(natureEnvRows, 6);

    const envNoteEl = document.getElementById("env-palette-note");
    const envZoneSwatchesEl = document.getElementById("env-palette-zone-swatches");
    const envMatchSwatchesEl = document.getElementById("env-palette-match-swatches");
    const envZoneSubEl = document.getElementById("env-zone-sublabel");
    const envMatchSubEl = document.getElementById("env-match-sublabel");
    const journeyEnvDerived = document.getElementById("journey-env-derived");
    const journeyEnvZoneSwatches = document.getElementById("journey-env-zone-swatches");
    const journeyMatchClimateSwatches = document.getElementById("journey-match-climate-swatches");
    const journeyMatchCompare = document.getElementById("journey-match-swatches-compare");
    const journeyUserCompare = document.getElementById("journey-user-swatches-compare");
    const paletteSwatchesMatchEl = document.getElementById("palette-swatches-match");
    const dashboardMatchInlineEl = document.getElementById("dashboard-match-sublabel-inline");
    const resultsMatchVsNoteEl = document.getElementById("results-match-vs-note");
    const journeyHeroShell = document.getElementById("journey-profile-hero");
    const journeyExpectedStage = document.getElementById("journey-expected-stage");

    const setEnvNote = (txt) => {
      if (envNoteEl) envNoteEl.textContent = txt;
    };

    let envHexes = [];
    let matchHexes = [];
    if (envModel && envSummary && matchSummary) {
      const envL = stripClimateLabelSuffix(envSummary.label);
      const mcL = stripClimateLabelSuffix(matchSummary.label);
      if (envZoneSubEl) {
        envZoneSubEl.textContent = natureExpectedHexes.length
          ? "Expected · nature (" + envL + ")"
          : "Expected · nature (data unavailable — showing ad fallback)";
      }
      if (envMatchSubEl) envMatchSubEl.textContent = "Closest match · advertising (" + mcL + " · " + p.match + "%)";
      setEnvNote(
        p.city
          ? "Nature reference: dominant colors from environmental photography in " +
              envL +
              " (" +
              envL +
              " is the closest climate-zone match in our database to " +
              p.city +
              "). Advertising reference: closest match is " +
              mcL +
              " (" +
              p.match +
              "% similarity)."
          : "Nature photography palette for " + envL + ". Advertising reference: closest match is " + mcL + "."
      );
      envHexes =
        natureExpectedHexes.length > 0
          ? natureExpectedHexes.slice(0, 6)
          : envSummary.paletteHexes && envSummary.paletteHexes.length
            ? envSummary.paletteHexes.slice(0, 6)
            : [];
      matchHexes =
        matchSummary.paletteHexes && matchSummary.paletteHexes.length ? matchSummary.paletteHexes.slice(0, 6) : [];
      fillStandardSwatches(envZoneSwatchesEl, envHexes);
      fillStandardSwatches(envMatchSwatchesEl, matchHexes);
      fillStandardSwatches(journeyEnvZoneSwatches, envHexes);
      fillStandardSwatches(journeyMatchClimateSwatches, matchHexes);
      fillStandardSwatches(journeyMatchCompare, matchHexes);
      fillStandardSwatches(journeyUserCompare, userHexes);
      fillStandardSwatches(paletteSwatchesMatchEl, matchHexes);
      if (dashboardMatchInlineEl) {
        dashboardMatchInlineEl.textContent = "Advertising match (" + mcL + ")";
      }
      if (resultsMatchVsNoteEl) {
        resultsMatchVsNoteEl.textContent =
          "Dominant colors from the " + mcL + " advertising field (" + p.match + "% color similarity).";
      }

      if (journeyEnvDerived) {
        journeyEnvDerived.textContent =
          (natureExpectedHexes.length ? "Nature expected" : "Expected (fallback)") +
          ": " +
          envL +
          " · Advertising match: " +
          mcL +
          (p.envClimate === p.matchClimate ? "" : " (different band)");
      }
      if (journeyNarr) {
        journeyNarr.innerHTML =
          "<strong>Left</strong> — <em>expected</em> hues aggregated from <strong>environmental photography</strong> in <em>" +
          envL +
          "</em> (where you grew up). " +
          "<strong>Right</strong> — the <strong>advertising</strong> palette your selections’ colors match most closely (<em>" +
          mcL +
          "</em>). " +
          (p.envClimate !== p.matchClimate
            ? "Nature and ad match can point to different bands — personal color pulls toward one commercial climate while your formative region’s landscapes read differently."
            : "Same climate band for both nature reference and color match.");
      }

      const e0 = envHexes[0] || "#4e8268";
      const m0 = matchHexes[0] || e0;
      const u1 = userHexes[1] || userHexes[0] || "#c4a06a";
      if (journeyHeroShell) {
        journeyHeroShell.style.setProperty("--data-atmo-env", e0);
        journeyHeroShell.style.setProperty("--data-atmo-ads", m0);
      }
      if (journeyExpectedStage) {
        journeyExpectedStage.style.setProperty("--data-expected-tint", e0);
      }
        } else {
      if (envZoneSubEl) {
        envZoneSubEl.textContent = natureExpectedHexes.length ? "Expected · nature" : "Expected · nature (unavailable)";
      }
      if (envMatchSubEl) envMatchSubEl.textContent = "Closest match · advertising";
      setEnvNote(
        natureExpectedHexes.length
          ? "Nature photography colors for your climate band. Advertising reference data is unavailable."
          : "Environmental palette data is unavailable."
      );
      envHexes = natureExpectedHexes.length ? natureExpectedHexes.slice(0, 6) : [];
      fillStandardSwatches(envZoneSwatchesEl, envHexes);
      fillStandardSwatches(envMatchSwatchesEl, []);
      fillStandardSwatches(journeyEnvZoneSwatches, envHexes);
      fillStandardSwatches(journeyMatchClimateSwatches, []);
      fillStandardSwatches(journeyMatchCompare, []);
      fillStandardSwatches(journeyUserCompare, userHexes);
      fillStandardSwatches(paletteSwatchesMatchEl, []);
      if (dashboardMatchInlineEl) dashboardMatchInlineEl.textContent = "Advertising match";
      if (resultsMatchVsNoteEl) {
        resultsMatchVsNoteEl.textContent =
          "Advertising reference data unavailable. Re-run the questionnaire for a full match palette.";
      }
      if (journeyEnvDerived) journeyEnvDerived.textContent = "";
      if (journeyNarr) journeyNarr.innerHTML = narrativeHtml;
      if (journeyHeroShell) {
        journeyHeroShell.style.setProperty("--data-atmo-env", "#4e8268");
        journeyHeroShell.style.setProperty("--data-atmo-ads", userHexes[0] || "#a89070");
      }
    }

    const envZoneLabelForTable =
      envSummary != null
        ? stripClimateLabelSuffix(envSummary.label)
        : stripClimateLabelSuffix((CLIMATE_COPY[p.envClimate] || CLIMATE_COPY.tropical).label);
    const matchBandLabelForTable = matchSummary
      ? stripClimateLabelSuffix(matchSummary.label)
      : stripClimateLabelSuffix((CLIMATE_COPY[p.matchClimate] || CLIMATE_COPY.tropical).label);

    let natureForTriple = natureEnvAgg;
    let natureBandShort = envZoneLabelForTable;
    if (!natureForTriple) {
      natureForTriple = await loadNatureAggregateMetrics(p.matchClimate);
      natureBandShort = matchBandLabelForTable;
    }

    const journeyNatureIntro = document.getElementById("journey-nature-vs-intro");
    if (journeyNatureIntro) {
      journeyNatureIntro.textContent =
        natureForTriple || matchSummary
          ? "Your palette sits between environmental photography (" +
            natureBandShort +
            ") and the thesis advertising centroid (" +
            matchBandLabelForTable +
            "). Values are weighted averages; neutral share reflects low-saturation colors in each baseline."
          : "";
    }
    const resultsNatureNote = document.getElementById("results-nature-vs-note");
    if (resultsNatureNote) {
      resultsNatureNote.textContent =
        natureForTriple || matchSummary
          ? "Nature · advertising · you: saturation, brightness, and neutral share. Nature column uses environmental imagery in " +
            natureBandShort +
            (natureEnvAgg ? " (your formative band)." : " (fallback: closest-match band).") +
            " Advertising column is the poster centroid for " +
            matchBandLabelForTable +
            "."
          : "Baseline metrics could not be loaded for this comparison.";
    }

    ["journey-nature-vs-grid", "results-nature-vs-grid"].forEach(function (gridId) {
      renderYouNatureAdsTable(document.getElementById(gridId), p, natureForTriple, matchSummary);
    });

    // Expose both positions for the graph: user point and baseline (nature metrics preferred over ad-derived env model).
    window.__resultsUserPoint = { saturation: p.saturation, brightness: p.brightness };
    if (natureEnvAgg) {
      window.__resultsEnvPoint = {
        saturation: natureEnvAgg.saturation,
        brightness: natureEnvAgg.brightness
      };
    } else if (envSummary) {
      window.__resultsEnvPoint = { saturation: envSummary.saturation, brightness: envSummary.brightness };
        } else {
      window.__resultsEnvPoint = null;
    }

    // Comparison baseline priority: closest advertising palette first, nature imagery second.
    const comparisonSummaryEl = document.getElementById("results-comparison-summary");
    const interpretationEl = document.getElementById("results-interpretation");
    const journeyComparisonEl = document.getElementById("journey-comparison-summary");
    const journeyInterpEl = document.getElementById("journey-interpretation");
    const deltaStripEl = document.getElementById("journey-delta-strip");
    const envZoneLabel =
      envSummary != null
        ? stripClimateLabelSuffix(envSummary.label)
        : stripClimateLabelSuffix((CLIMATE_COPY[p.envClimate] || CLIMATE_COPY.tropical).label);
    const matchZoneLabel =
      matchSummary != null
        ? stripClimateLabelSuffix(matchSummary.label)
        : stripClimateLabelSuffix((CLIMATE_COPY[p.matchClimate] || CLIMATE_COPY.tropical).label);
    const comparisonBaseline = matchSummary || natureEnvAgg || envSummary;

    if (comparisonBaseline && comparisonSummaryEl && interpretationEl) {
      const userSat = p.saturation;
      const userBri = p.brightness;
      const userNeutral = p.neutral / 100;
      const baseSat = comparisonBaseline.saturation;
      const baseBri = comparisonBaseline.brightness;
      const baseNeutral =
        comparisonBaseline === matchSummary && matchSummary
          ? matchSummary.neutralRatio / 100
          : comparisonBaseline === natureEnvAgg && natureEnvAgg
            ? natureEnvAgg.neutralRatio / 100
            : envSummary
              ? envSummary.neutralRatio / 100
              : 0.5;

      const diffSatPct = Math.round((userSat - baseSat) * 100);
      const diffBriPct = Math.round((userBri - baseBri) * 100);
      const diffNeutralPct = Math.round((userNeutral - baseNeutral) * 100);

      const baselineKind =
        comparisonBaseline === matchSummary
          ? "the closest advertising palette"
          : "nature photography baseline";
      const baselineLabel = comparisonBaseline === matchSummary ? matchZoneLabel : envZoneLabel;
      let summaryText =
        `Relative to ${baselineKind} (${baselineLabel}), ` +
        `your selections are ${Math.abs(diffSatPct)} points ${diffSatPct >= 0 ? "more" : "less"} saturated, ` +
        `${Math.abs(diffBriPct)} points ${diffBriPct >= 0 ? "brighter" : "darker"}, ` +
        `and ${Math.abs(diffNeutralPct)} points ${diffNeutralPct >= 0 ? "less neutral" : "more neutral"} on average.`;
      if (comparisonBaseline === matchSummary) {
        summaryText += " Match confidence: " + p.match + "%.";
      }
      if (natureEnvAgg) {
        summaryText +=
          " Secondary reference: the nature photography baseline in " +
          envZoneLabel +
          ".";
      }

      comparisonSummaryEl.textContent = summaryText;
      if (journeyComparisonEl) journeyComparisonEl.textContent = summaryText;

      renderDeltaStrip(deltaStripEl, diffSatPct, diffBriPct, diffNeutralPct);

      const ds = userSat - baseSat;
      const db = userBri - baseBri;
      const distance = Math.sqrt(ds * ds + db * db);
      const alignment = distance < 0.08 && Math.abs(diffNeutralPct) < 12
        ? "close"
        : distance < 0.18
          ? "partial"
          : "divergent";

      const baselinePhrase =
        comparisonBaseline === matchSummary ? "advertising reference baseline" : "nature photography baseline";
      const notes = [];
      const satNote = describeMetricDelta(userSat, baseSat, "saturation", baselinePhrase);
      const briNote = describeMetricDelta(userBri, baseBri, "brightness", baselinePhrase);
      const neuNote = describeMetricDelta(userNeutral, baseNeutral, "neutral", baselinePhrase);
      if (satNote) notes.push(satNote);
      if (briNote) notes.push(briNote);
      if (neuNote) notes.push(neuNote);

      const interpText = buildInterpretation(alignment, notes, comparisonBaseline === matchSummary);
      interpretationEl.textContent = interpText;
      if (journeyInterpEl) journeyInterpEl.textContent = interpText;
    } else if (comparisonSummaryEl && interpretationEl) {
      const miss =
        "Expected baseline (nature or climate palette) could not be loaded, so only your generated palette is shown.";
      const miss2 =
        "This view focuses on your selected palette without a direct comparison to an external baseline.";
      comparisonSummaryEl.textContent = miss;
      interpretationEl.textContent = miss2;
      if (journeyComparisonEl) journeyComparisonEl.textContent = miss;
      if (journeyInterpEl) journeyInterpEl.textContent = miss2;
      if (deltaStripEl) deltaStripEl.innerHTML = "";
    }
  }

  function initChart() {
    // Main chart now rendered by initEditorialDotField().
  }

  const COLOR_FAMILIES = [
    { id: "reds", label: "Reds", color: "#D34A4A" },
    { id: "oranges", label: "Oranges", color: "#D8843E" },
    { id: "yellows", label: "Yellows", color: "#D9C04A" },
    { id: "greens", label: "Greens", color: "#4E9C61" },
    { id: "cyans", label: "Cyans", color: "#4DA8C9" },
    { id: "blues", label: "Blues", color: "#3D6FC5" },
    { id: "purples", label: "Purples", color: "#7C5BC8" },
    { id: "pinks", label: "Pinks", color: "#C96BAE" },
    { id: "browns", label: "Browns", color: "#8A6240" },
    { id: "light_neutrals", label: "Light neutrals", color: "#DCD6C8" },
    { id: "dark_neutrals", label: "Dark neutrals", color: "#54504A" }
  ];

  function normalizePosterCategory(meta) {
    const explicit =
      ((meta && (meta.category || meta.image_category || meta.tag_category)) || "")
        .toLowerCase()
        .trim();
    if (explicit) return explicit;
    const product = ((meta && meta.product_type) || "").toLowerCase().trim();
    if (product) return product;
    const objectAssoc = ((meta && meta.object_association) || "").toLowerCase().trim();
    if (objectAssoc) return objectAssoc;
    return "uncategorized";
  }

  function formatCategoryLabel(raw) {
    if (!raw) return "Uncategorized";
    return raw
      .split("/")
      .map((part) =>
        part
          .trim()
          .split(/[\s_-]+/)
          .filter(Boolean)
          .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
          .join(" ")
      )
      .join(" / ");
  }

  function classifyColorFamily(rgb) {
    if (!window.ColorUtils || !rgb) return "dark_neutrals";
    const hsv = window.ColorUtils.rgbToHsv(rgb.r, rgb.g, rgb.b);
    const h = hsv.h;
    const s = hsv.s;
    const v = hsv.v;

    if (s < 12) return v >= 58 ? "light_neutrals" : "dark_neutrals";
    if (h >= 15 && h < 50 && v < 55) return "browns";
    if (h >= 345 || h < 15) return "reds";
    if (h < 45) return "oranges";
    if (h < 70) return "yellows";
    if (h < 160) return "greens";
    if (h < 200) return "cyans";
    if (h < 255) return "blues";
    if (h < 300) return "purples";
    if (h < 345) return "pinks";
    return "reds";
  }

  function deriveCategoryOrder(imageMap, imageMetaByFile) {
    const order = [];
    const seen = new Set();
    Object.keys(imageMap || {}).forEach((file) => {
      const meta = imageMetaByFile[file] || null;
      const category = normalizePosterCategory(meta);
      if (!seen.has(category)) {
        seen.add(category);
        order.push(category);
      }
    });
    if (!order.length) order.push("uncategorized");
    return order;
  }

  function toImageFamilyShares(colorRows) {
    const totals = {};
    COLOR_FAMILIES.forEach((f) => { totals[f.id] = 0; });
    let sum = 0;

    (colorRows || []).forEach((row) => {
      if (row.r == null || row.g == null || row.b == null) return;
      const rgb = { r: row.r, g: row.g, b: row.b };
      const family = classifyColorFamily(rgb);
      const w = typeof row.percent === "number" ? row.percent : 1;
      totals[family] += w;
      sum += w;
    });

    const denom = sum || 1;
    const shares = {};
    COLOR_FAMILIES.forEach((f) => {
      shares[f.id] = totals[f.id] / denom;
    });
    return shares;
  }

  function aggregateImageSharesByCategory(imageMap, imageMetaByFile, categoryOrder) {
    const byCategory = {};
    (categoryOrder || []).forEach((c) => { byCategory[c] = []; });

    Object.keys(imageMap || {}).forEach((file) => {
      const rows = imageMap[file] || [];
      const meta = imageMetaByFile[file] || null;
      const category = normalizePosterCategory(meta);
      const shares = toImageFamilyShares(rows);
      if (!byCategory[category]) byCategory[category] = [];
      byCategory[category].push(shares);
    });

    const out = {};
    Object.keys(byCategory).forEach((category) => {
      const list = byCategory[category];
      const agg = {};
      COLOR_FAMILIES.forEach((f) => { agg[f.id] = 0; });
      if (!list.length) {
        out[category] = agg;
        return;
      }
      list.forEach((s) => {
        COLOR_FAMILIES.forEach((f) => { agg[f.id] += s[f.id] || 0; });
      });
      COLOR_FAMILIES.forEach((f) => { agg[f.id] = agg[f.id] / list.length; });
      out[category] = agg;
    });
    return out;
  }

  function groupRowsByImage(rows) {
    const m = {};
    (rows || []).forEach((r) => {
      const k = r.poster_file || r.source_file || "";
      if (!k) return;
      if (!m[k]) m[k] = [];
      m[k].push(r);
    });
    return m;
  }

  async function loadImageMetaByFile() {
    try {
      const res = await fetch("data/image_metadata.json");
      if (!res.ok) return {};
      const arr = await res.json();
      const map = {};
      (arr || []).forEach((x) => {
        if (!x || !x.image_file) return;
        map[x.image_file] = x;
      });
      return map;
    } catch (e) {
      return {};
    }
  }

  function computeUserFamilyShares(userDots) {
    const totals = {};
    COLOR_FAMILIES.forEach((f) => { totals[f.id] = 0; });
    let sum = 0;
    (userDots || []).forEach((d) => {
      if (!window.ColorUtils || typeof window.ColorUtils.hexToRgb !== "function") return;
      const rgb = window.ColorUtils.hexToRgb(d.hex);
      if (!rgb) return;
      const fam = classifyColorFamily(rgb);
      const w = typeof d.weight === "number" ? d.weight : 1;
      totals[fam] += w;
      sum += w;
    });
    const denom = sum || 1;
    const shares = {};
    COLOR_FAMILIES.forEach((f) => { shares[f.id] = totals[f.id] / denom; });
    return shares;
  }

  async function renderCategoryDeltaMatrix(natureData, postersData, userDots) {
    const grid = document.getElementById("results-matrix-grid");
    const tooltip = document.getElementById("results-matrix-tooltip");
    if (!grid) return;

    const metaByFile = await loadImageMetaByFile();
    const natureByImage = groupRowsByImage(natureData);
    const postersByImage = groupRowsByImage(postersData);

    // Nature baseline (aggregated across all nature images)
    const natureSharesList = Object.keys(natureByImage).map((k) => toImageFamilyShares(natureByImage[k]));
    const natureBaseline = {};
    COLOR_FAMILIES.forEach((f) => { natureBaseline[f.id] = 0; });
    if (natureSharesList.length) {
      natureSharesList.forEach((s) => {
        COLOR_FAMILIES.forEach((f) => { natureBaseline[f.id] += s[f.id] || 0; });
      });
      COLOR_FAMILIES.forEach((f) => { natureBaseline[f.id] = natureBaseline[f.id] / natureSharesList.length; });
    }

    // Poster categories from image-level tags metadata (match source categories directly).
    const categoryOrder = deriveCategoryOrder(postersByImage, metaByFile);
    const posterByCategory = aggregateImageSharesByCategory(postersByImage, metaByFile, categoryOrder);

    // Optional user column
    const userShares = computeUserFamilyShares(userDots);

    const columns = ["Nature baseline"].concat(categoryOrder).concat(["You"]);
    grid.style.setProperty("--matrix-col-count", String(columns.length));
    grid.innerHTML = "";

    const head0 = document.createElement("p");
    head0.className = "results-matrix__head results-matrix__head--rowlabel";
    head0.textContent = "Color family";
    grid.appendChild(head0);

    columns.forEach((c) => {
      const h = document.createElement("p");
      h.className = "results-matrix__head";
      h.textContent = c === "Nature baseline" || c === "You" ? c : formatCategoryLabel(c);
      grid.appendChild(h);
    });

    const hover = (ev, family, columnLabel, natureShare, targetShare, delta) => {
      if (!tooltip) return;
      tooltip.hidden = false;
      tooltip.innerHTML =
        `<strong>${family.label}</strong><br>` +
        `Column: ${columnLabel === "Nature baseline" || columnLabel === "You" ? columnLabel : formatCategoryLabel(columnLabel)}<br>` +
        `Nature: ${(natureShare * 100).toFixed(1)}%<br>` +
        `${columnLabel}: ${(targetShare * 100).toFixed(1)}%<br>` +
        `Delta: ${(delta * 100).toFixed(1)}%`;
      tooltip.style.left = (ev.clientX + 10) + "px";
      tooltip.style.top = (ev.clientY + 10) + "px";
    };

    const hide = () => {
      if (!tooltip) return;
      tooltip.hidden = true;
    };

    COLOR_FAMILIES.forEach((family) => {
      const rowLabel = document.createElement("p");
      rowLabel.className = "results-matrix__rowlabel";
      rowLabel.innerHTML = `<span class="results-matrix__rowcolor" style="background:${family.color}"></span>${family.label}`;
      grid.appendChild(rowLabel);

      columns.forEach((col) => {
        const natureShare = natureBaseline[family.id] || 0;
        let targetShare = natureShare;
        if (col === "You") {
          targetShare = userShares[family.id] || 0;
        } else if (col !== "Nature baseline") {
          const cat = posterByCategory[col] || {};
          targetShare = cat[family.id] || 0;
        }
        const delta = col === "Nature baseline" ? 0 : targetShare - natureShare;

        const cell = document.createElement("div");
        cell.className = "results-matrix__cell";

        const dot = document.createElement("button");
        dot.type = "button";
        dot.className = "results-matrix__dot";
        if (col === "Nature baseline") dot.classList.add("results-matrix__dot--baseline");
        else if (delta < 0) dot.classList.add("results-matrix__dot--negative");
        dot.style.setProperty("--dot-color", family.color);
        const mag = Math.abs(delta);
        const size = col === "Nature baseline" ? 10 : 8 + Math.round(Math.min(1, mag / 0.2) * 18);
        dot.style.setProperty("--dot-size", `${size}px`);
        dot.addEventListener("mousemove", (ev) => hover(ev, family, col, natureShare, targetShare, delta));
        dot.addEventListener("mouseleave", hide);

        cell.appendChild(dot);
        grid.appendChild(cell);
      });
    });
  }

  let editorialChartInitialized = false;

  async function initEditorialDotField() {
    const placeholder = document.getElementById("results-graph-placeholder");
    if (!placeholder || typeof window.EditorialDotField === "undefined") return;

    const tooltipEl = document.getElementById("results-bubble-tooltip");
    const p = getParams();
    // Nature + Posters layers use the assigned profile (URL `climate`), not Köppen/formative `env`.
    // Expected environmental palette & centroid use `envClimate` in renderFromParams().
    const profileClimate = p.climate || "tropical";
    const userPaletteUnique = uniquePaletteFromParams(p);
    const extractedUserHexes =
      p.userFieldHexes && p.userFieldHexes.length ? p.userFieldHexes : userPaletteUnique;

    // Map thesis climate bands to the data folder naming used in `data/`.
    const climateToFolder = { tropical: "brazil", arid: "egypt", polar: "finland" };
    const folder = climateToFolder[profileClimate] || "brazil";

    const natureCandidates = [
      `data/results_${folder}_nature_clean_superflat.json`,
      `data/results_${folder}_nature_superflat.json`
    ];

    let natureData = null;
    for (let i = 0; i < natureCandidates.length; i++) {
      try {
        const res = await fetch(natureCandidates[i]);
        if (!res.ok) continue;
        natureData = await res.json();
        break;
      } catch (e) {
        // keep trying fallbacks
      }
    }
    if (!Array.isArray(natureData)) natureData = [];

    let postersData = [];
    try {
      const postersUrl = `data/results_${folder}_superflat.json`;
      const res = await fetch(postersUrl);
      if (res.ok) postersData = await res.json();
    } catch (e) {
      postersData = [];
    }

    // User dots should come directly from the extracted dominant hexes
    // from the images you selected (no replication/generation).
    // Dot weight is derived from how frequently that hex appears within
    // the extracted list, so dot size still encodes frequency.
    const counts = {};
    const allHexesRaw = Array.isArray(extractedUserHexes) ? extractedUserHexes : [];
    const allHexes = allHexesRaw
      .map((hex) => (hex || "").toString().toLowerCase().replace(/^#/, ""))
      .filter((h) => /^[0-9a-f]{6}$/.test(h));

    allHexes.forEach((h) => {
      counts[h] = (counts[h] || 0) + 1;
    });

    const extractedTotal = allHexes.length || 1;

    // Fallback if URL missing userField: use deduped palette swatches once each.
    const sourceHexes = allHexes.length
      ? allHexes
      : userPaletteUnique.map((h) => (h || "").replace(/^#/, "").toLowerCase()).filter((h) => /^[0-9a-f]{6}$/.test(h));

    const MAX_USER_DOTS = 240; // guardrail
    const userDots = sourceHexes.slice(0, MAX_USER_DOTS).map((h) => {
      const count = counts[h] || 1;
      const weightPct = (count / extractedTotal) * 100;
      return {
        hex: "#" + h.toUpperCase(),
        weight: weightPct,
        source: "User selection"
      };
    });

    // Render editorial dot-field (Nature / Posters / User).
    window.EditorialDotField.render(placeholder, {
      tooltipEl,
      climateLabel: profileClimate,
      nature: natureData,
      posters: postersData,
      user: userDots
    });

    // Supporting matrix layer: category-wise amplification/suppression vs nature.
    await renderCategoryDeltaMatrix(natureData, postersData, userDots);
    editorialChartInitialized = true;
  }

  async function ensureAnalyticalChart() {
    if (editorialChartInitialized) return;
    try {
      await initEditorialDotField();
    } catch (e) {
      console.warn("Results: editorial dot-field failed to render.", e);
    }
  }

  function initOpenAnalytical() {
    const btn = document.getElementById("results-open-analytical-btn");
    const block = document.getElementById("results-analytical");
    if (!btn || !block) return;
    btn.addEventListener("click", async () => {
      block.hidden = false;
      await ensureAnalyticalChart();
      block.scrollIntoView({ behavior: "smooth", block: "start" });
      btn.setAttribute("aria-expanded", "true");
    });
  }

  const JOURNEY_STEPS = 6;
  let journeyIndex = 0;

  function buildJourneyProgress() {
    const el = document.getElementById("results-journey-progress");
    if (!el) return;
    el.innerHTML = "";
    for (let i = 0; i < JOURNEY_STEPS; i++) {
      const d = document.createElement("span");
      d.className = "results-journey__dot";
      el.appendChild(d);
    }
  }

  function updateJourneyUI() {
    const track = document.getElementById("results-journey-track");
    const dots = document.querySelectorAll(".results-journey__dot");
    const back = document.getElementById("results-journey-back");
    const next = document.getElementById("results-journey-next");
    const stepPct = 100 / JOURNEY_STEPS;
    if (track) track.style.transform = `translateX(-${journeyIndex * stepPct}%)`;
    dots.forEach((dot, i) => {
      dot.classList.toggle("results-journey__dot--active", i === journeyIndex);
      dot.classList.toggle("results-journey__dot--done", i < journeyIndex);
    });
    document.querySelectorAll(".results-journey__slide").forEach((slide) => {
      const idx = parseInt(slide.getAttribute("data-journey-index") || "0", 10);
      slide.classList.toggle("results-journey__slide--active", idx === journeyIndex);
    });
    if (back) back.disabled = journeyIndex === 0;
    if (next) next.hidden = journeyIndex >= JOURNEY_STEPS - 1;
  }

  function finishJourney() {
    const j = document.getElementById("results-journey");
    const shell = document.getElementById("results-main-shell");
    if (j) {
      j.hidden = true;
      j.setAttribute("aria-hidden", "true");
    }
    if (shell) {
      shell.hidden = false;
    }
  }

  function initJourneyNav() {
    const back = document.getElementById("results-journey-back");
    const next = document.getElementById("results-journey-next");
    const skip = document.getElementById("results-journey-skip");
    const enter = document.getElementById("results-journey-enter");
    if (back) {
      back.addEventListener("click", () => {
        journeyIndex = Math.max(0, journeyIndex - 1);
        updateJourneyUI();
      });
    }
    if (next) {
      next.addEventListener("click", () => {
        journeyIndex = Math.min(JOURNEY_STEPS - 1, journeyIndex + 1);
        updateJourneyUI();
      });
    }
    if (skip) skip.addEventListener("click", finishJourney);
    if (enter) enter.addEventListener("click", finishJourney);
  }

  function maybeSkipJourneyFromQuery() {
    try {
      const q = new URLSearchParams(window.location.search).get("skipJourney");
      if (q === "1" || q === "true") return true;
    } catch (e) {
      /* ignore */
    }
    return false;
  }

  async function initJourneyExperience() {
    const journeyEl = document.getElementById("results-journey");
    const shell = document.getElementById("results-main-shell");
    if (!journeyEl || !shell) return;

    if (maybeSkipJourneyFromQuery()) {
      journeyEl.hidden = true;
      journeyEl.setAttribute("aria-hidden", "true");
      shell.hidden = false;
      return;
    }

    buildJourneyProgress();
    journeyIndex = 0;
    journeyEl.style.setProperty("--journey-steps", String(JOURNEY_STEPS));
    updateJourneyUI();
    initJourneyNav();
  }

  function initPrint() {
    const go = () => window.print();
    const btn = document.getElementById("print-card-btn");
    const btn2 = document.getElementById("print-card-btn-analytical");
    if (btn) btn.addEventListener("click", go);
    if (btn2) btn2.addEventListener("click", go);
  }

  function initAboutToggle() {
    const toggle = document.getElementById("results-about-toggle");
    const body = document.getElementById("results-about-body");
    if (!toggle || !body) return;

    let open = false;
    const update = () => {
      body.hidden = !open;
      toggle.setAttribute("aria-expanded", open ? "true" : "false");
    };

    toggle.addEventListener("click", () => {
      open = !open;
      update();
    });

    update();
  }
  function initRailToggle() {
    const panel = document.querySelector(".results-profile");
    const toggle = document.getElementById("results-rail-toggle");
    const layout = document.querySelector(".results-layout");
    if (!panel || !toggle) return;

    let collapsed = false;
    const update = () => {
      panel.setAttribute("data-collapsed", collapsed ? "true" : "false");
      toggle.textContent = collapsed ? "Open profile" : "Close profile";
      if (layout) {
        layout.classList.toggle("results-layout--panel-collapsed", collapsed);
      }
    };

    toggle.addEventListener("click", () => {
      collapsed = !collapsed;
      update();
    });

    update();
  }

  async function init() {
    await renderFromParams();
    await initJourneyExperience();
    initOpenAnalytical();
    initPrint();
    initAboutToggle();
    initRailToggle();
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init);
  else init();
})();
