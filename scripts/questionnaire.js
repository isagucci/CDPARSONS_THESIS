/**
 * Questionnaire: dynamic image choice from JSON metadata (converted from CSV).
 * Flow: load JSON → N rounds of 3-image choices (select, then Next to advance) → city → popup → results.
 */

(function () {
  const METADATA_URL = "data/image_metadata.json";
  const NUM_ROUNDS = 7;
  const IMAGES_PER_ROUND = 3;
  const ASSETS_BASE = "assets";
  /** Buffer animation before results (place file in assets/). */
  const BUFFER_GIF_URL = ASSETS_BASE + "/buffer.gif";
  /**
   * Length of one full GIF loop in milliseconds — set to match your buffer.gif.
   * Total wait = this × BUFFER_GIF_LOOPS (default 4 loops).
   */
  const BUFFER_GIF_LOOP_DURATION_MS = 2000;
  const BUFFER_GIF_LOOPS = 4;
  const CLIMATE_FOLDERS = {
    brazil: "images_brazil",
    egypt: "images_egypt",
    finland: "images_finland"
  };
  const CLIMATE_TO_ID = { brazil: "tropical", egypt: "arid", finland: "polar" };
  const PROMPTS = [
    "Which image feels most visually compelling to you?",
    "Which one feels closest to your taste?",
    "Which one feels most desirable to you?",
    "Which image would you return to the most?",
    "Which one has the kind of atmosphere you're drawn to?",
    "Which one stands out to you first?",
    "Which image feels most aligned with your world?"
  ];

  const CLIMATE_API_BASE_HTTPS = "https://climateapi.scottpinkelman.com/api/v1/location";
  const CLIMATE_API_PROXY = "https://api.allorigins.win/raw?url=";
  const GEOCODE_URL = "https://geocoding-api.open-meteo.com/v1/search";

  const CLIMATES = ["brazil", "egypt", "finland"];
  const TOTAL_STEPS = NUM_ROUNDS + 2; // image rounds + refine + city
  const CLIMATE_RESULTS_URLS = {
    tropical: "data/results_brazil.json",
    arid: "data/results_egypt.json",
    polar: "data/results_finland.json"
  };
  let metadata = [];
  let byClimate = null;       // { brazil: [...], egypt: [...], finland: [...] }
  let objectByClimate = null; // { "social": { brazil: [...], egypt: [...], finland: [...] }, ... }
  let state = null;
  let cachedTopColorsByClimate = null; // { tropical: [{hex, weight}], arid:..., polar:... }

  // Metadata compatibility layer:
  // Supports legacy keys (object_association/product_type/atmosphere)
  // and newer image-level tag keys (category/type/mood, etc).
  function getMetaTag(img, key) {
    if (!img) return "";
    const aliases = {
      atmosphere: ["atmosphere", "mood", "tone", "image_atmosphere"],
      object_association: ["object_association", "category", "image_category", "tag_category", "object_tag"],
      product_type: ["product_type", "type", "image_type", "tag_type", "product_category"]
    };
    const keys = aliases[key] || [key];
    for (let i = 0; i < keys.length; i++) {
      const v = img[keys[i]];
      if (v != null && String(v).trim()) {
        const raw = String(v).trim();
        if (key !== "object_association") return raw;
        return normalizeObjectAssociation(raw);
      }
    }
    return "";
  }

  // Normalize object association labels to match `image_level_tags.csv` conventions.
  function normalizeObjectAssociation(val) {
    const s = (val || "").toLowerCase().trim();
    if (!s) return "";
    if (s === "fruit" || s === "fruits" || s === "fruitss") return "fruits";
    if (s === "plants") return "vegetation";
    if (s === "social" || s === "social/human" || s === "social/human/human") return "social/human";
    if (s === "synthetic" || s === "artificial" || s === "synthetic/artificial") return "synthetic/artificial";
    if (s === "stone" || s === "rock") return "sand";
    if (s === "earth" || s === "soil" || s === "earth/soil") return "earth/soil";
    return s;
  }

  function buildIndexes(dataset) {
    const byCl = { brazil: [], egypt: [], finland: [] };
    const byObj = {};
    dataset.forEach((img) => {
      const c = img.climate;
      if (!byCl[c]) return;
      byCl[c].push(img);
      const obj = getMetaTag(img, "object_association") || "other";
      if (!byObj[obj]) byObj[obj] = { brazil: [], egypt: [], finland: [] };
      byObj[obj][c].push(img);
    });
    byClimate = byCl;
    objectByClimate = byObj;
  }

  function clamp(v, min, max) {
    return Math.min(max, Math.max(min, v));
  }

  function rgbQuantKey(r, g, b, levels) {
    const L = levels || 16; // per channel
    const step = 256 / L;
    const rq = Math.floor(clamp(r, 0, 255) / step) * step + step / 2;
    const gq = Math.floor(clamp(g, 0, 255) / step) * step + step / 2;
    const bq = Math.floor(clamp(b, 0, 255) / step) * step + step / 2;
    return window.ColorUtils.rgbToHex(rq, gq, bq);
  }

  async function extractDominantHexesFromImageUrl(url, options) {
    const opts = options || {};
    const size = typeof opts.size === "number" ? opts.size : 40;
    const step = typeof opts.step === "number" ? opts.step : 2; // sample every N pixels
    const topN = typeof opts.topN === "number" ? opts.topN : 3;
    const levels = typeof opts.levels === "number" ? opts.levels : 16;

    return await new Promise((resolve) => {
      const img = new Image();
      img.crossOrigin = "anonymous";
      img.decoding = "async";
      img.onload = function () {
        try {
          const canvas = document.createElement("canvas");
          canvas.width = size;
          canvas.height = size;
          const ctx = canvas.getContext("2d", { willReadFrequently: true });
          if (!ctx) return resolve([]);
          ctx.drawImage(img, 0, 0, size, size);
          const data = ctx.getImageData(0, 0, size, size).data;
          const bucket = new Map(); // hex -> count

          for (let y = 0; y < size; y += step) {
            for (let x = 0; x < size; x += step) {
              const idx = (y * size + x) * 4;
              const r = data[idx];
              const g = data[idx + 1];
              const b = data[idx + 2];
              const a = data[idx + 3];
              if (a == null || a < 32) continue;
              const hex = rgbQuantKey(r, g, b, levels);
              bucket.set(hex, (bucket.get(hex) || 0) + 1);
            }
          }

          const hexes = Array.from(bucket.entries())
            .sort((a, b) => b[1] - a[1])
            .slice(0, topN)
            .map(([hex]) => hex);
          resolve(hexes);
        } catch (e) {
          resolve([]);
        }
      };
      img.onerror = function () { resolve([]); };
      img.src = url;
    });
  }

  async function loadTopClimateHexes() {
    if (cachedTopColorsByClimate) return cachedTopColorsByClimate;

    const out = { tropical: [], arid: [], polar: [] };
    const entries = await Promise.allSettled([
      fetch(CLIMATE_RESULTS_URLS.tropical).then((r) => r.json()),
      fetch(CLIMATE_RESULTS_URLS.arid).then((r) => r.json()),
      fetch(CLIMATE_RESULTS_URLS.polar).then((r) => r.json())
    ]);

    const byClimateRaw = {
      tropical: entries[0].status === "fulfilled" && Array.isArray(entries[0].value) ? entries[0].value : [],
      arid: entries[1].status === "fulfilled" && Array.isArray(entries[1].value) ? entries[1].value : [],
      polar: entries[2].status === "fulfilled" && Array.isArray(entries[2].value) ? entries[2].value : []
    };

    const TOP_N = 25;
    Object.keys(byClimateRaw).forEach((climateId) => {
      const bucket = new Map(); // hex -> totalPercent
      byClimateRaw[climateId].forEach((entry) => {
        if (!Array.isArray(entry.colors)) return;
        entry.colors.forEach((c) => {
          const hex = (c.hex || "").toLowerCase();
          if (!hex) return;
          const w = typeof c.percent === "number" ? c.percent : 0;
          bucket.set(hex, (bucket.get(hex) || 0) + w);
        });
      });
      const aggregated = Array.from(bucket.entries())
        .sort((a, b) => b[1] - a[1])
        .slice(0, TOP_N);
      const total = aggregated.reduce((s, [, w]) => s + w, 0) || 1;
      out[climateId] = aggregated.map(([hex, w]) => ({ hex, weight: w / total }));
    });

    cachedTopColorsByClimate = out;
    return out;
  }

  function labDistance(a, b) {
    if (!a || !b) return 999;
    const dL = a.L - b.L;
    const da = a.a - b.a;
    const db = a.b - b.b;
    return Math.sqrt(dL * dL + da * da + db * db);
  }

  function climateScoreForUserHexes(userHexes, climatePalette) {
    const palette = Array.isArray(climatePalette) ? climatePalette : [];
    if (!userHexes || userHexes.length === 0 || palette.length === 0 || !window.ColorUtils) return 0;

    const paletteLabs = palette
      .map((p) => ({ hex: p.hex, weight: p.weight != null ? p.weight : 1, lab: window.ColorUtils.hexToLab(p.hex) }))
      .filter((p) => p.lab);

    const K = 26; // distance falloff (Lab)
    let sum = 0;
    userHexes.forEach((hex) => {
      const uLab = window.ColorUtils.hexToLab(hex);
      if (!uLab) return;
      let best = Infinity;
      paletteLabs.forEach((p) => {
        const d = labDistance(uLab, p.lab);
        if (d < best) best = d;
      });
      const sim = 1 / (1 + best / K);
      sum += sim;
    });
    return sum / userHexes.length;
  }

  async function computeClosestClimateFromSelections(selections) {
    const picked = Array.isArray(selections) ? selections : [];
    if (picked.length === 0) {
      return {
        climateId: "tropical",
        matchPct: 50,
        weights: { tropical: 1 / 3, arid: 1 / 3, polar: 1 / 3 },
        allUserHexes: []
      };
    }

    const urls = picked.map((img) => imageSrc(img)).filter(Boolean);

    // Extract more colors for the chart/user layer (denser dot-field),
    // but keep the climate-match scoring stable by scoring on the top 3 per image.
    const TOP_N_ALL = 6;
    const TOP_N_SCORE = 3;

    const perImageHexesAll = await Promise.all(
      urls.map((u) => extractDominantHexesFromImageUrl(u, { topN: TOP_N_ALL }))
    );

    const allUserHexes = perImageHexesAll.flat().filter(Boolean);
    const perImageHexesScore = perImageHexesAll.map((hexes) => (Array.isArray(hexes) ? hexes.slice(0, TOP_N_SCORE) : []));
    const userHexesForScore = perImageHexesScore.flat().filter(Boolean);

    if (userHexesForScore.length === 0) {
      return {
        climateId: "tropical",
        matchPct: 50,
        weights: { tropical: 1 / 3, arid: 1 / 3, polar: 1 / 3 },
        allUserHexes: []
      };
    }

    const palettes = await loadTopClimateHexes();
    const sT = climateScoreForUserHexes(userHexesForScore, palettes.tropical);
    const sA = climateScoreForUserHexes(userHexesForScore, palettes.arid);
    const sP = climateScoreForUserHexes(userHexesForScore, palettes.polar);
    const sum = sT + sA + sP || 1;
    const weights = { tropical: sT / sum, arid: sA / sum, polar: sP / sum };
    const bestClimateId = ["tropical", "arid", "polar"].reduce(
      (best, k) => (weights[k] > weights[best] ? k : best),
      "tropical"
    );
    const w = weights[bestClimateId] != null ? weights[bestClimateId] : 1 / 3;
    const top6Hexes = getTop6DominantHexes(allUserHexes);

    return {
      climateId: bestClimateId,
      matchPct: Math.round(clamp(w * 100, 0, 100)),
      weights,
      // Palette swatches = 6 dominant hues (already averaged/clustered)
      userHexes: top6Hexes,
      // Chart dots should reflect *all* extracted dominant hexes from all selected images
      allUserHexes
    };
  }

  function hexKey6(h) {
    const k = (h || "").replace(/^#/, "").toLowerCase();
    return /^[0-9a-f]{6}$/.test(k) ? k : "";
  }

  function hexCanonicalFromKey(k) {
    if (!k) return "";
    if (window.ColorUtils && typeof window.ColorUtils.formatHexDisplay === "function") {
      return window.ColorUtils.formatHexDisplay("#" + k) || "#" + k.toUpperCase();
    }
    return "#" + k.toUpperCase();
  }

  /**
   * Up to 6 unique hex codes (no repeats): pick the strongest actual extracted color per hue bucket,
   * then backfill by global frequency. (Bucket RGB averaging was collapsing to duplicate hexes.)
   */
  function getTop6DominantHexes(hexList) {
    if (!hexList || hexList.length === 0 || !window.ColorUtils) return [];
    const count = {};
    hexList.forEach((h) => {
      const k = hexKey6(h);
      if (k) count[k] = (count[k] || 0) + 1;
    });
    const keys = Object.keys(count);
    if (keys.length === 0) return [];

    const NUM_HUE = 6;
    // 0..5 = hue wedges (saturated); 6 = low-saturation / neutral — separate from red-orange wedge
    const buckets = Array.from({ length: NUM_HUE + 1 }, () => []);

    keys.forEach((k) => {
      const rgb = window.ColorUtils.hexToRgb("#" + k);
      if (!rgb) return;
      const hsv = window.ColorUtils.rgbToHsv(rgb.r, rgb.g, rgb.b);
      const bix =
        hsv.s < 12
          ? NUM_HUE
          : Math.min(NUM_HUE - 1, Math.floor((hsv.h / 360) * NUM_HUE));
      buckets[bix].push({ key: k, n: count[k] });
    });

    const seen = new Set();
    const out = [];

    function tryAddKey(k) {
      if (!k || seen.has(k)) return false;
      seen.add(k);
      out.push(hexCanonicalFromKey(k));
      return true;
    }

    const bucketWinners = buckets
      .map((entries) => {
        if (!entries.length) return null;
        const best = entries.reduce((a, b) => (b.n > a.n ? b : a));
        const bucketWeight = entries.reduce((s, e) => s + e.n, 0);
        return { key: best.key, bucketWeight };
      })
      .filter(Boolean)
      .sort((a, b) => b.bucketWeight - a.bucketWeight);

    bucketWinners.forEach((w) => {
      if (out.length >= 6) return;
      tryAddKey(w.key);
    });

    if (out.length < 6) {
      keys
        .slice()
        .sort((a, b) => count[b] - count[a])
        .forEach((k) => {
          if (out.length >= 6) return;
          tryAddKey(k);
        });
    }

    return out.slice(0, 6);
  }

  /** Object_association values that have at least one image in each of the three climates */
  function getObjectAssociationsWithAllClimates() {
    if (!objectByClimate) return [];
    return Object.keys(objectByClimate).filter((obj) => {
      const g = objectByClimate[obj];
      return CLIMATES.every((c) => g[c] && g[c].length > 0);
    });
  }

  function initState() {
    return {
      shownIds: new Set(),
      selections: [],
      /** image_file[] per round — exact options shown (all 3 each round) for correct Back / shownIds */
      roundDisplayedFiles: [],
      refineChoices: null,
      refineSelectedFiles: new Set(),
      attributeCounts: { atmosphere: {}, object_association: {}, product_type: {} },
      roundIndex: 0,
      /** Image chosen for the current round; committed on Next */
      roundPick: null,
      currentChoices: null,
      _choosing: false
    };
  }

  function recordRoundDisplayedFiles(roundIdx, choices) {
    if (!state || !Array.isArray(choices)) return;
    if (!state.roundDisplayedFiles) state.roundDisplayedFiles = [];
    state.roundDisplayedFiles[roundIdx] = choices.map((c) => c.image_file).filter(Boolean);
  }

  function rebuildShownIdsFromDisplayedRounds(upToRoundInclusive) {
    if (!state) return;
    state.shownIds = new Set();
    const files = state.roundDisplayedFiles || [];
    const lastIdx = Math.min(upToRoundInclusive, Math.max(0, files.length - 1));
    for (let i = 0; i <= lastIdx; i++) {
      (files[i] || []).forEach((f) => state.shownIds.add(f));
    }
  }

  function choicesFromRecordedFiles(files) {
    if (!files || files.length !== IMAGES_PER_ROUND || !metadata.length) return null;
    const out = [];
    for (let i = 0; i < files.length; i++) {
      const img = metadata.find((m) => m.image_file === files[i]);
      if (!img) return null;
      out.push(img);
    }
    return out;
  }

  function imageSrc(img) {
    if (!img || !img.image_file) return "";
    const folder = CLIMATE_FOLDERS[img.climate] || "images_brazil";
    return ASSETS_BASE + "/" + folder + "/" + img.image_file;
  }

  function shuffle(arr) {
    const a = arr.slice();
    for (let i = a.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [a[i], a[j]] = [a[j], a[i]];
    }
    return a;
  }

  function pickOne(arr, state, biasKeys) {
    if (!arr || arr.length === 0) return null;
    const available = arr.filter((img) => !state.shownIds.has(img.image_file));
    if (available.length === 0) return null;
    if (available.length === 1) return available[0];
    if (!biasKeys || !biasKeys.atmosphere) return shuffle(available)[0];
    const scored = available.map((img) => {
      let s = Math.random() * 0.2;
      if (biasKeys.atmosphere && getMetaTag(img, "atmosphere") === biasKeys.atmosphere) s += 1;
      if (biasKeys.object_association && getMetaTag(img, "object_association") === biasKeys.object_association) s += 0.5;
      return { img, score: s };
    });
    scored.sort((a, b) => b.score - a.score);
    return scored[0].img;
  }

  function getNextImageSet(dataset, state) {
    if (!byClimate || !objectByClimate) return [];
    const objectOptions = getObjectAssociationsWithAllClimates();
    if (objectOptions.length === 0) return [];

    const availableByClimate = {
      brazil: (byClimate.brazil || []).filter((img) => !state.shownIds.has(img.image_file)),
      egypt: (byClimate.egypt || []).filter((img) => !state.shownIds.has(img.image_file)),
      finland: (byClimate.finland || []).filter((img) => !state.shownIds.has(img.image_file))
    };

    const objectCandidates = objectOptions.filter((obj) => {
      const g = objectByClimate[obj];
      return CLIMATES.every((c) => g[c].some((img) => !state.shownIds.has(img.image_file)));
    });
    if (objectCandidates.length === 0) return [];

    let chosenObject;
    if (state.roundIndex === 0) {
      chosenObject = objectCandidates[Math.floor(Math.random() * objectCandidates.length)];
    } else {
      const counts = state.attributeCounts.object_association || {};
      const sorted = Object.entries(counts)
        .filter(([, n]) => n > 0)
        .sort((a, b) => b[1] - a[1])
        .map(([k]) => k);
      const preferred = sorted.find((k) => objectCandidates.includes(k));
      chosenObject = preferred || objectCandidates[Math.floor(Math.random() * objectCandidates.length)];
    }

    const biasKeys = state.roundIndex > 0 && state.selections.length
      ? {
          atmosphere: Object.entries(state.attributeCounts.atmosphere || {})
            .sort((a, b) => b[1] - a[1])[0]?.[0],
          object_association: chosenObject
        }
      : null;

    const g = objectByClimate[chosenObject];
    const fromBrazil = (g.brazil || []).filter((img) => !state.shownIds.has(img.image_file));
    const fromEgypt = (g.egypt || []).filter((img) => !state.shownIds.has(img.image_file));
    const fromFinland = (g.finland || []).filter((img) => !state.shownIds.has(img.image_file));

    const b = pickOne(fromBrazil, state, biasKeys);
    const e = pickOne(fromEgypt, state, biasKeys);
    const f = pickOne(fromFinland, state, biasKeys);
    const chosen = [b, e, f].filter(Boolean);
    if (chosen.length < IMAGES_PER_ROUND) return chosen;
    chosen.forEach((img) => state.shownIds.add(img.image_file));
    return shuffle(chosen);
  }

  function updateCounts(counts, img) {
    if (!img) return;
    ["atmosphere", "object_association", "product_type"].forEach((key) => {
      const val = getMetaTag(img, key);
      if (val) counts[key][val] = (counts[key][val] || 0) + 1;
    });
  }

  function deriveProfileFromSelections(selections) {
    if (!selections.length) {
      return {
        climateId: "tropical",
        point: { saturation: 0.5, brightness: 0.5 },
        breakdown: { warm: 50, neutral: 50 }
      };
    }
    let sumSat = 0, sumVal = 0;
    let sumWarm = 0, sumNeutral = 0;
    const climateCounts = { brazil: 0, egypt: 0, finland: 0 };
    selections.forEach((img) => {
      sumSat += (img.avg_sat_pct != null ? img.avg_sat_pct : 50) / 100;
      sumVal += (img.avg_val_pct != null ? img.avg_val_pct : 50) / 100;
      sumWarm += (img.warm_ratio_pct != null ? img.warm_ratio_pct : 50);
      sumNeutral += (img.neutral_ratio_pct != null ? img.neutral_ratio_pct : 50);
      if (img.climate) climateCounts[img.climate] = (climateCounts[img.climate] || 0) + 1;
    });
    const n = selections.length;
    const climate = ["brazil", "egypt", "finland"].reduce(
      (a, b) => (climateCounts[b] || 0) > (climateCounts[a] || 0) ? b : a,
      "brazil"
    );
    const avgWarm = sumWarm / n;
    const avgNeutral = sumNeutral / n;
    return {
      climateId: CLIMATE_TO_ID[climate] || "tropical",
      point: {
        saturation: Math.min(1, Math.max(0, sumSat / n)),
        brightness: Math.min(1, Math.max(0, sumVal / n))
      },
      breakdown: {
        warm: Math.round(avgWarm),
        neutral: Math.round(avgNeutral)
      }
    };
  }

  function buildResultsUrl(profile, matchPct, formativeCity, paletteHexes, allUserHexes, matchClimateId) {
    const params = new URLSearchParams();
    params.set("climate", profile.climateId);
    params.set("s", String(Math.round(profile.point.saturation * 100) / 100));
    params.set("b", String(Math.round(profile.point.brightness * 100) / 100));
    if (profile.breakdown) {
      params.set("w", String(profile.breakdown.warm));
      params.set("n", String(profile.breakdown.neutral));
    }
    params.set("match", String(matchPct));
    params.set("matchClimate", matchClimateId || profile.climateId);
    if (formativeCity && formativeCity.trim()) params.set("city", formativeCity.trim());
    const envClimateId = koppenToAssignedZone(koppenInfo && koppenInfo.code) || profile.climateId;
    params.set("env", envClimateId);
    if (paletteHexes && paletteHexes.length > 0) {
      const seenPal = new Set();
      const parts = [];
      for (let i = 0; i < paletteHexes.length && parts.length < 6; i++) {
        const h = (paletteHexes[i] || "").replace(/^#/, "").toUpperCase();
        if (h.length !== 6 || seenPal.has(h)) continue;
        seenPal.add(h);
        parts.push(h);
      }
      if (parts.length) params.set("palette", parts.join(","));
    }
    if (allUserHexes && allUserHexes.length > 0) {
      const userFieldStr = allUserHexes
        .map((h) => (h || "").replace(/^#/, "").toUpperCase())
        .filter((h) => h.length === 6)
        .slice(0, 240)
        .join(",");
      if (userFieldStr) params.set("userField", userFieldStr);
    }
    return "results.html?" + params.toString();
  }

  function goToResults(profile, matchPct, formativeCity, paletteHexes, allUserHexes, matchClimateId) {
    window.location.href = buildResultsUrl(
      profile,
      matchPct,
      formativeCity,
      paletteHexes,
      allUserHexes,
      matchClimateId
    );
  }

  /**
   * Full-screen buffer: plays buffer.gif, waits for BUFFER_GIF_LOOPS × loop duration, then opens results.
   */
  function showBufferThenGoToResults(profile, matchPct, formativeCity, paletteHexes, allUserHexes, matchClimateId) {
    const url = buildResultsUrl(profile, matchPct, formativeCity, paletteHexes, allUserHexes, matchClimateId);
    const overlay = document.getElementById("results-buffer-overlay");
    const gifEl = document.getElementById("results-buffer-gif");
    if (!overlay || !gifEl) {
      window.location.href = url;
      return;
    }

    const reduced =
      typeof window.matchMedia === "function" &&
      window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const totalMs = reduced ? 450 : BUFFER_GIF_LOOP_DURATION_MS * BUFFER_GIF_LOOPS;

    overlay.hidden = false;
    overlay.removeAttribute("hidden");
    overlay.setAttribute("aria-hidden", "false");
    overlay.setAttribute("aria-busy", "true");
    document.body.style.overflow = "hidden";
    gifEl.style.display = "";
    gifEl.onerror = function () {
      gifEl.style.display = "none";
    };
    gifEl.src = BUFFER_GIF_URL + "?t=" + Date.now();

    window.setTimeout(function () {
      window.location.href = url;
    }, totalMs);
  }

  let questionIndexEl, questionTotalEl, questionTextEl, optionsListEl, progressTextEl, prevBtn, nextBtn, progressBarEl;
  let refineViewEl, refineGridEl;
  let cityViewEl, imageViewEl, cityInputEl, cityErrorEl, popupEl, popupClimateNameEl, popupMetaEl, popupContinueBtn;
  let formativeCity = "";
  let koppenInfo = null;
  const DISPLAY_STEPS = NUM_ROUNDS + 1; // rounds + (refine/city final step)

  function ensureProgressBarDots() {
    if (!progressBarEl) return;
    if (progressBarEl.children.length === DISPLAY_STEPS) return;
    progressBarEl.innerHTML = "";
    for (let i = 0; i < DISPLAY_STEPS; i++) {
      const dot = document.createElement("span");
      dot.className = "question-progress-bar__dot";
      progressBarEl.appendChild(dot);
    }
  }

  function renderProgressBar(stepNumber) {
    if (!progressBarEl) return;
    ensureProgressBarDots();
    const activeIdx = clamp((stepNumber || 1) - 1, 0, DISPLAY_STEPS - 1);
    const dots = progressBarEl.children;
    for (let i = 0; i < dots.length; i++) {
      dots[i].classList.toggle("question-progress-bar__dot--active", i === activeIdx);
      dots[i].classList.toggle("question-progress-bar__dot--done", i < activeIdx);
    }
  }

  function koppenToAssignedZone(code) {
    if (!code || typeof code !== "string") return null;
    const first = code.charAt(0).toUpperCase();
    if (first === "A") return "tropical";
    if (first === "B") return "arid";
    // For temperate (C) climates, distinguish warmer vs. cooler variants:
    // - hot / warm summers (3rd letter a/b) → align with tropical band
    // - cooler summers (3rd letter c/d) → align with polar band
    if (first === "C") {
      const tempLetter = code.charAt(2).toLowerCase();
      if (tempLetter === "a" || tempLetter === "b" || !tempLetter) return "tropical";
      return "polar";
    }
    // Colder continental (D) and polar (E) climates align with the polar band.
    if (first === "D" || first === "E") return "polar";
    return null;
  }

  async function geocodeCity(name) {
    const n = encodeURIComponent((name || "").trim());
    if (!n) return null;
    const res = await fetch(GEOCODE_URL + "?name=" + n + "&count=1");
    if (!res.ok) return null;
    const data = await res.json();
    const r = data.results && data.results[0];
    return r ? { lat: r.latitude, lon: r.longitude } : null;
  }

  async function fetchClimateZone(lat, lon) {
    // HTTPS-hosted pages cannot call an HTTP endpoint (mixed-content block).
    // Try HTTPS first; on HTTPS pages, use a secure proxy fallback for HTTP-only APIs.
    const endpointPath = "/" + lat + "/" + lon;
    const directHttps = CLIMATE_API_BASE_HTTPS + endpointPath;
    const proxyHttp = CLIMATE_API_PROXY + encodeURIComponent("http://climateapi.scottpinkelman.com/api/v1/location" + endpointPath);
    const candidates = [directHttps, proxyHttp];

    for (let i = 0; i < candidates.length; i++) {
      const url = candidates[i];
      try {
        const res = await fetch(url);
        if (!res.ok) continue;
        const data = await res.json();
        const r = data.return_values && data.return_values[0];
        if (r) {
          return { code: r.koppen_geiger_zone, description: r.zone_description || "" };
        }
      } catch (e) {
      }
    }
    return null;
  }
  
    function formatIndex(i) {
      return String(i + 1).padStart(2, "0");
    }
  
  function showCityView() {
    if (cityViewEl) cityViewEl.hidden = false;
    if (imageViewEl) imageViewEl.hidden = true;
    if (refineViewEl) refineViewEl.hidden = true;
    // City is the final step
    if (questionIndexEl) questionIndexEl.textContent = formatIndex(TOTAL_STEPS - 1);
    if (questionTotalEl) questionTotalEl.textContent = " / " + formatIndex(TOTAL_STEPS - 1);
    if (prevBtn) prevBtn.disabled = false;
    if (nextBtn) { nextBtn.disabled = false; nextBtn.textContent = "Continue"; }
    if (progressTextEl) progressTextEl.textContent = "Enter the city where you spent most of your formative years.";
    renderProgressBar(NUM_ROUNDS + 1);
  }

  function pickRefineSet(dataset, state, count) {
    const n = typeof count === "number" ? count : 15;
    const available = (dataset || []).filter((img) => img && img.image_file && !state.shownIds.has(img.image_file));
    return shuffle(available).slice(0, n);
  }

  function showRefineView() {
    if (refineViewEl) refineViewEl.hidden = false;
    if (cityViewEl) cityViewEl.hidden = true;
    if (imageViewEl) imageViewEl.hidden = true;
    if (questionIndexEl) questionIndexEl.textContent = formatIndex(NUM_ROUNDS);
    if (questionTotalEl) questionTotalEl.textContent = " / " + formatIndex(TOTAL_STEPS - 1);
    if (prevBtn) prevBtn.disabled = false;
    if (nextBtn) { nextBtn.disabled = false; nextBtn.textContent = "Continue"; }
    if (progressTextEl) progressTextEl.textContent = "";
    renderProgressBar(NUM_ROUNDS + 1);
  }

  function renderRefineGrid() {
    if (!state) return;
    if (!state.refineChoices) state.refineChoices = pickRefineSet(metadata, state, 15);
    if (!refineGridEl) return;

    refineGridEl.innerHTML = "";
    state.refineChoices.forEach((img) => {
        const btn = document.createElement("button");
        btn.type = "button";
      btn.className = "option-image";
      btn.setAttribute("aria-label", "Toggle this image");
      btn.setAttribute("aria-pressed", "false");

      const imgEl = document.createElement("img");
      imgEl.src = imageSrc(img);
      imgEl.alt = "";
      imgEl.loading = "lazy";
      btn.appendChild(imgEl);

      const isSelected = state.refineSelectedFiles.has(img.image_file);
      if (isSelected) {
        btn.classList.add("option-image--selected");
        btn.setAttribute("aria-pressed", "true");
        }
  
        btn.addEventListener("click", () => {
        if (state.refineSelectedFiles.has(img.image_file)) {
          state.refineSelectedFiles.delete(img.image_file);
          btn.classList.remove("option-image--selected");
          btn.setAttribute("aria-pressed", "false");
        } else {
          state.refineSelectedFiles.add(img.image_file);
          btn.classList.add("option-image--selected");
          btn.setAttribute("aria-pressed", "true");
        }
      });

      refineGridEl.appendChild(btn);
    });
  }

  function getCombinedSelections() {
    const base = Array.isArray(state && state.selections) ? state.selections.slice() : [];
    const refine = [];
    if (state && state.refineChoices && state.refineSelectedFiles) {
      state.refineChoices.forEach((img) => {
        if (img && state.refineSelectedFiles.has(img.image_file)) refine.push(img);
      });
    }
    return base.concat(refine);
  }

  function commitRoundPickAndAdvance() {
    if (!state || !state.roundPick || state._choosing) return false;
    state._choosing = true;
    try {
      state.selections.push(state.roundPick);
      updateCounts(state.attributeCounts, state.roundPick);
      state.roundPick = null;
      state.roundIndex++;
      if (state.roundIndex >= NUM_ROUNDS) {
        showRefineView();
        renderRefineGrid();
        return true;
      }
      state.currentChoices = getNextImageSet(metadata, state);
      recordRoundDisplayedFiles(state.roundIndex, state.currentChoices);
      renderRound();
      return true;
    } finally {
      state._choosing = false;
    }
  }

  function renderRound() {
    if (!state || !state.currentChoices || state.currentChoices.length === 0) {
      if (optionsListEl) {
        optionsListEl.innerHTML = "";
        const msg = document.createElement("p");
        msg.className = "questionnaire-no-data";
        msg.textContent = "Image data did not load. Open this page from a local server (e.g. python3 -m http.server 8000, then http://localhost:8000/questionnaire.html).";
        optionsListEl.appendChild(msg);
      }
      return;
    }
    if (cityViewEl) cityViewEl.hidden = true;
    if (imageViewEl) imageViewEl.hidden = false;
    const round = state.roundIndex;
    const choices = state.currentChoices;
    const prompt = PROMPTS[round % PROMPTS.length];

    questionIndexEl.textContent = formatIndex(round);
    questionTotalEl.textContent = " / " + formatIndex(TOTAL_STEPS - 1);
    questionTextEl.textContent = prompt;
    optionsListEl.innerHTML = "";

    choices.forEach((img) => {
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "option-image";
      btn.setAttribute("aria-label", "Select this image");
      const picked =
        state.roundPick && state.roundPick.image_file && img.image_file === state.roundPick.image_file;
      btn.setAttribute("aria-pressed", picked ? "true" : "false");
      if (picked) btn.classList.add("option-image--selected");
      const imgEl = document.createElement("img");
      imgEl.src = imageSrc(img);
      imgEl.alt = "";
      imgEl.loading = "lazy";
      imgEl.onerror = function () {
        this.style.background = "var(--ink-soft, #4a4a48)";
        this.alt = "Image unavailable";
      };
      btn.appendChild(imgEl);
      btn.addEventListener("click", () => {
        if (!state) return;
        const same = state.roundPick && state.roundPick.image_file === img.image_file;
        state.roundPick = same ? null : img;
        Array.from(optionsListEl.querySelectorAll(".option-image")).forEach((el, i) => {
          const choice = choices[i];
          if (!choice) return;
          const on = state.roundPick && state.roundPick.image_file === choice.image_file;
          el.classList.toggle("option-image--selected", !!on);
          el.setAttribute("aria-pressed", on ? "true" : "false");
        });
        if (nextBtn) nextBtn.disabled = !state.roundPick;
      });
      optionsListEl.appendChild(btn);
    });

    prevBtn.disabled = round === 0;
    nextBtn.disabled = !state.roundPick;
    nextBtn.textContent = "Next";
    if (progressTextEl) progressTextEl.textContent = "";
    renderProgressBar(round + 1);
  }

  function goBackRound() {
    if (!state || state.roundIndex <= 0) return;
    const removedPick = state.selections[state.roundIndex - 1];
    state.roundIndex--;
    state.selections = state.selections.slice(0, state.roundIndex);
    state.roundPick = removedPick || null;
    if (state.roundDisplayedFiles && state.roundDisplayedFiles.length > state.roundIndex + 1) {
      state.roundDisplayedFiles.length = state.roundIndex + 1;
    }
    rebuildShownIdsFromDisplayedRounds(state.roundIndex);
    state.attributeCounts = { atmosphere: {}, object_association: {}, product_type: {} };
    state.selections.forEach((img) => updateCounts(state.attributeCounts, img));
    const recorded = state.roundDisplayedFiles && state.roundDisplayedFiles[state.roundIndex];
    const restored = choicesFromRecordedFiles(recorded);
    state.currentChoices = restored || getNextImageSet(metadata, state);
    if (!restored && state.currentChoices && state.currentChoices.length) {
      recordRoundDisplayedFiles(state.roundIndex, state.currentChoices);
    }
    renderRound();
  }

  function showClimatePopup(info) {
    if (!popupEl || !popupMetaEl) return;
    const code = (info && info.code) ? String(info.code).trim() : "";
    const description = (info && info.description)
      ? String(info.description).trim()
      : "Climate zone data from the Köppen-Geiger system.";
    if (popupClimateNameEl) {
      if (code) {
        popupClimateNameEl.textContent = code;
        popupClimateNameEl.hidden = false;
      } else {
        popupClimateNameEl.textContent = "";
        popupClimateNameEl.hidden = true;
      }
    }
    popupMetaEl.textContent = description;
    popupEl.hidden = false;
  }

  function hideClimatePopup() {
    if (popupEl) popupEl.hidden = true;
  }

  async function doCitySubmit() {
    const city = (cityInputEl && cityInputEl.value) ? cityInputEl.value.trim() : "";
    if (!city) {
      if (cityErrorEl) { cityErrorEl.textContent = "Please enter a city."; cityErrorEl.hidden = false; }
      return;
    }
    if (cityErrorEl) cityErrorEl.hidden = true;

    const loadingEl = document.getElementById("koppen-loading");
    const loadingGif = document.getElementById("koppen-loading-gif");
    if (nextBtn) {
      nextBtn.disabled = true;
      nextBtn.textContent = "Looking up…";
    }
    if (loadingEl) {
      loadingEl.hidden = false;
      loadingEl.setAttribute("aria-hidden", "false");
      loadingEl.setAttribute("aria-busy", "true");
      if (loadingGif && (!loadingGif.getAttribute("src") || loadingGif.getAttribute("src") === "")) {
        loadingGif.src = BUFFER_GIF_URL;
      }
    }

    try {
      const coords = await geocodeCity(city);
      if (!coords) {
        if (cityErrorEl) { cityErrorEl.textContent = "We couldn't find that city. Try another spelling or name."; cityErrorEl.hidden = false; }
        return;
      }
      const zoneInfo = await fetchClimateZone(coords.lat, coords.lon);
      formativeCity = city;
      koppenInfo = zoneInfo || { code: "", description: "Climate data unavailable." };
      showClimatePopup(koppenInfo);
    } catch (e) {
      if (cityErrorEl) { cityErrorEl.textContent = "Something went wrong. Please try again."; cityErrorEl.hidden = false; }
    } finally {
      if (loadingEl) {
        loadingEl.hidden = true;
        loadingEl.setAttribute("aria-hidden", "true");
        loadingEl.setAttribute("aria-busy", "false");
      }
      if (nextBtn) {
        nextBtn.disabled = false;
        nextBtn.textContent = "Continue";
      }
    }
  }

  async function init() {
    if (window.__questionnaireInitialized) {
      console.warn("Questionnaire: init skipped (already initialized).");
      return;
    }

      questionIndexEl = document.getElementById("question-index");
      questionTotalEl = document.getElementById("question-total");
      questionTextEl = document.getElementById("question-text");
      optionsListEl = document.getElementById("options-list");
      progressTextEl = document.getElementById("question-progress");
      prevBtn = document.getElementById("prev-question");
      nextBtn = document.getElementById("next-question");
    refineViewEl = document.getElementById("question-refine-view");
    refineGridEl = document.getElementById("refine-grid");
    progressBarEl = document.getElementById("question-progress-bar");
    cityViewEl = document.getElementById("questionnaire-city-view");
    imageViewEl = document.getElementById("question-image-view");
    cityInputEl = document.getElementById("formative-city");
    cityErrorEl = document.getElementById("city-error");
    popupEl = document.getElementById("climate-zone-popup");
    popupClimateNameEl = document.getElementById("climate-popup-climate-name");
    popupMetaEl = document.getElementById("climate-popup-meta");
    popupContinueBtn = document.getElementById("climate-popup-continue");

    if (!questionIndexEl || !questionTotalEl || !questionTextEl || !optionsListEl || !progressTextEl || !prevBtn || !nextBtn) return;
    ensureProgressBarDots();

    window.__questionnaireInitialized = true;

    if (popupEl) popupEl.hidden = true;
    if (cityErrorEl) { cityErrorEl.hidden = true; cityErrorEl.textContent = ""; }

    try {
      const res = await fetch(METADATA_URL);
      if (!res.ok) throw new Error(res.statusText);
      metadata = await res.json();
      if (!Array.isArray(metadata)) metadata = [];
    } catch (e) {
      console.warn("Questionnaire: could not load image metadata.", e);
      metadata = [];
    }
    buildIndexes(metadata);

    state = initState();
    state.currentChoices = getNextImageSet(metadata, state);
    recordRoundDisplayedFiles(0, state.currentChoices);
    renderRound();

    if (popupContinueBtn) {
      popupContinueBtn.addEventListener("click", async () => {
        hideClimatePopup();
        const combined = getCombinedSelections();
        // Climate association: determined by which posters from each climate
        // the user selected most often (deriveProfileFromSelections).
        const profile = deriveProfileFromSelections(combined);
        // Similarity-based match % and user palette are still computed from color,
        // but they no longer override the climate association.
        const closest = await computeClosestClimateFromSelections(combined);
        showBufferThenGoToResults(
          profile,
          closest.matchPct,
          formativeCity,
          closest.userHexes,
          closest.allUserHexes,
          closest.climateId
        );
      });
    }

    const backdrop = popupEl && popupEl.querySelector(".climate-popup__backdrop");
    if (backdrop) backdrop.addEventListener("click", () => hideClimatePopup());

    prevBtn.addEventListener("click", () => {
      if (cityViewEl && !cityViewEl.hidden) {
        // Back from city -> refine step
        cityViewEl.hidden = true;
        showRefineView();
        renderRefineGrid();
      } else if (refineViewEl && !refineViewEl.hidden) {
        // Back from refine -> last image round (restore same options, do not re-roll)
        refineViewEl.hidden = true;
        imageViewEl.hidden = false;
        const lastCommitted = state.selections[NUM_ROUNDS - 1];
        state.selections = state.selections.slice(0, NUM_ROUNDS - 1);
        state.roundIndex = NUM_ROUNDS - 1;
        state.roundPick = lastCommitted || null;
        rebuildShownIdsFromDisplayedRounds(state.roundIndex);
        state.attributeCounts = { atmosphere: {}, object_association: {}, product_type: {} };
        state.selections.forEach((img) => updateCounts(state.attributeCounts, img));
        const rec = state.roundDisplayedFiles && state.roundDisplayedFiles[state.roundIndex];
        const rest = choicesFromRecordedFiles(rec);
        state.currentChoices = rest || getNextImageSet(metadata, state);
        if (!rest && state.currentChoices && state.currentChoices.length) {
          recordRoundDisplayedFiles(state.roundIndex, state.currentChoices);
        }
        renderRound();
      } else {
        goBackRound();
      }
    });

    nextBtn.addEventListener("click", () => {
      if (cityViewEl && !cityViewEl.hidden) {
        doCitySubmit();
        return;
      }
      if (refineViewEl && !refineViewEl.hidden) {
        showCityView();
        return;
      }
      if (imageViewEl && !imageViewEl.hidden && state && state.currentChoices && state.currentChoices.length) {
        commitRoundPickAndAdvance();
      }
    });
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init);
  else init();
  })();
