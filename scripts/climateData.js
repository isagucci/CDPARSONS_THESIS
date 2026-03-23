(function () {
  // Climate data utilities for both the scatterplot (FULL dataset)
  // and the swatch generation (TOP N dominant colors).
  //
  // FILE INPUTS:
  // - FULL DATASET FOR SCATTERPLOT:
  //     data/results_brazil.json   -> tropical
  //     data/results_egypt.json    -> arid
  //     data/results_finland.json  -> polar
  //
  // - TOP 20 COLORS FOR SWATCHES:
  //     The same results files, but only their top-N aggregated hexes are kept.
  //
  // TODO:
  // - Adjust TOP_N_SWATCH_COLORS in extractTopDominantColors().
  // - Refine weighting logic in extractScatterplotMetrics() and computeClimateCentroid().
  // - Refine distance weighting in getUserClimateWeights().

  const CLIMATE_KEYS = {
    brazil: "tropical",
    egypt: "arid",
    finland: "polar"
  };

  const CLIMATE_LABELS = {
    tropical: "Tropical Climate (A)",
    arid: "Arid Climate (B)",
    polar: "Polar Climate (E)"
  };

  const DATA_URLS = {
    tropical: "data/results_brazil.json",
    arid: "data/results_egypt.json",
    polar: "data/results_finland.json"
  };

  let cachedResults = null;

  async function loadResultsJsonFiles() {
    // FULL DATASET FOR SCATTERPLOT (and for swatch aggregation).
    if (cachedResults) return cachedResults;

    const entries = await Promise.allSettled([
      fetch(DATA_URLS.tropical).then((r) => r.json()),
      fetch(DATA_URLS.arid).then((r) => r.json()),
      fetch(DATA_URLS.polar).then((r) => r.json())
    ]);

    const [brazilRes, egyptRes, finlandRes] = entries;
    const resultsByClimate = {
      tropical: Array.isArray(brazilRes.value) ? brazilRes.value : [],
      arid: Array.isArray(egyptRes.value) ? egyptRes.value : [],
      polar: Array.isArray(finlandRes.value) ? finlandRes.value : []
    };

    cachedResults = resultsByClimate;
    return resultsByClimate;
  }

  function extractScatterplotMetrics(resultsByClimate) {
    // FULL DATASET FOR SCATTERPLOT:
    // consume every detected color in the results.json files,
    // not just the top ranks.
    const points = [];

    Object.keys(resultsByClimate).forEach((climateId) => {
      const dataset = resultsByClimate[climateId];
      if (!Array.isArray(dataset)) return;

      dataset.forEach((entry) => {
        if (!Array.isArray(entry.colors)) return;

        entry.colors.forEach((color) => {
          if (!Array.isArray(color.rgb) || color.rgb.length < 3) return;
          const rgb = color.rgb;
          const hsv = window.ColorUtils.rgbToHsv(rgb[0], rgb[1], rgb[2]);

          points.push({
            climateId,
            hex: color.hex,
            saturation: (hsv.s || 0) / 100,
            brightness: (hsv.v || 0) / 100,
            weight: typeof color.percent === "number" ? color.percent : 0
          });
        });
      });
    });

    return points;
  }

  function computeClimateCentroid(points) {
    // FULL DATASET FOR SCATTERPLOT:
    // centroid is a weighted average over all points.
    const byClimate = {
      tropical: { sumW: 0, sumS: 0, sumB: 0 },
      arid: { sumW: 0, sumS: 0, sumB: 0 },
      polar: { sumW: 0, sumS: 0, sumB: 0 }
    };

    points.forEach((pt) => {
      const bucket = byClimate[pt.climateId];
      if (!bucket) return;
      const w = pt.weight > 0 ? pt.weight : 1;
      bucket.sumW += w;
      bucket.sumS += pt.saturation * w;
      bucket.sumB += pt.brightness * w;
    });

    const centroids = {};
    Object.keys(byClimate).forEach((climateId) => {
      const bucket = byClimate[climateId];
      const sumW = bucket.sumW || 1;
      const s = bucket.sumS / sumW;
      const b = bucket.sumB / sumW;
      centroids[climateId] = {
        id: climateId,
        label: CLIMATE_LABELS[climateId],
        saturation: s,
        brightness: b
      };
    });

    return centroids;
  }

  function extractTopDominantColors(resultsByClimate, topN) {
    // TOP 20 COLORS FOR SWATCHES:
    // aggregate color dominance by hex across the full dataset
    // but keep only the top N per climate.
    const N = typeof topN === "number" ? topN : 20; // TODO: adjust top N if needed.
    const topColorsByClimate = {
      tropical: [],
      arid: [],
      polar: []
    };

    Object.keys(resultsByClimate).forEach((climateId) => {
      const dataset = resultsByClimate[climateId];
      if (!Array.isArray(dataset)) return;

      const bucket = new Map();

      dataset.forEach((entry) => {
        if (!Array.isArray(entry.colors)) return;
        entry.colors.forEach((color) => {
          const hex = (color.hex || "").toLowerCase();
          if (!hex) return;
          const key = hex;
          const w = typeof color.percent === "number" ? color.percent : 0;
          const existing = bucket.get(key) || { hex: color.hex, totalPercent: 0 };
          existing.totalPercent += w;
          bucket.set(key, existing);
        });
      });

      const aggregated = Array.from(bucket.values())
        .sort((a, b) => b.totalPercent - a.totalPercent)
        .slice(0, N);

      const total = aggregated.reduce((sum, c) => sum + (c.totalPercent || 0), 0) || 1;

      topColorsByClimate[climateId] = aggregated.map((c) => ({
        hex: c.hex,
        percent: c.totalPercent,
        weight: (c.totalPercent || 0) / total
      }));
    });

    return topColorsByClimate;
  }

  function buildSwatchPaletteModel(topColorsByClimate) {
    // TOP 20 COLORS FOR SWATCHES:
    // direct pass-through in this version, but left as a seam
    // for richer per-role or per-climate modeling later.
    return {
      tropical: topColorsByClimate.tropical || [],
      arid: topColorsByClimate.arid || [],
      polar: topColorsByClimate.polar || []
    };
  }

  function getUserClimateWeights(userPoint, centroids) {
    // Distance-based weighting in saturation/brightness space.
    // TODO: refine the falloff curve or add other axes (e.g. hue) later.
    const centers = centroids || {};
    const sUser =
      (userPoint && typeof userPoint.saturation === "number")
        ? userPoint.saturation
        : 0.5;
    const bUser =
      (userPoint && typeof userPoint.brightness === "number")
        ? userPoint.brightness
        : 0.5;

    const distances = {};
    let maxDist = 0;

    Object.keys(centers).forEach((key) => {
      const c = centers[key];
      if (!c) return;
      const ds = sUser - c.saturation;
      const db = bUser - c.brightness;
      const dist = Math.sqrt(ds * ds + db * db);
      distances[key] = dist;
      if (dist > maxDist) maxDist = dist;
    });

    const weights = {};
    let sumW = 0;
    Object.keys(distances).forEach((key) => {
      const d = distances[key];
      const w = maxDist === 0 ? 1 : 1 / (d * 1.5 + 0.12);
      weights[key] = w;
      sumW += w;
    });

    Object.keys(weights).forEach((key) => {
      weights[key] = weights[key] / (sumW || 1);
    });

    return weights;
  }

  window.ClimateData = {
    loadResultsJsonFiles,
    extractScatterplotMetrics,
    computeClimateCentroid,
    extractTopDominantColors,
    buildSwatchPaletteModel,
    getUserClimateWeights
  };
})();

