(function () {
  const MATCH_ROWS = [
    {
      id: "water",
      title: "Water",
      takeaway: "Cleaner, brighter blues",
      natureTags: ["water"],
      posterTags: ["water"],
      posterProducts: null
    },
    {
      id: "vegetation",
      title: "Vegetation",
      takeaway: "Greens reduced and neutralized",
      natureTags: ["vegetation"],
      posterTags: ["vegetation"],
      posterProducts: null
    },
    {
      id: "fruit",
      title: "Fruit",
      takeaway: "Warm hues intensified",
      natureTags: ["fruit"],
      posterTags: ["fruits", "fruit"],
      posterProducts: ["drink", "food"]
    },
    {
      id: "earth_stone",
      title: "Earth / Stone",
      takeaway: "Browns reduced, light neutrals increased",
      natureTags: ["earth/soil", "sand"],
      posterTags: ["earth/soil", "sand", "earth"],
      posterProducts: null
    }
  ];

  const METRICS = [
    { id: "saturation", label: "Saturation" },
    { id: "brightness", label: "Brightness" },
    { id: "neutral", label: "Neutral ratio" },
    { id: "warm", label: "Warm share" },
    { id: "cool", label: "Cool share" }
  ];

  const controls = {
    climate: document.getElementById("filter-climate"),
    product: document.getElementById("filter-product")
  };
  const rowsHost = document.getElementById("comparison-rows");
  const tooltip = document.getElementById("poster-tooltip");

  const state = {
    posterData: {},
    natureData: {},
    posterMeta: {},
    natureTagsByFile: {},
    ready: false
  };

  /** Handles commas inside quoted fields (nature CSV filenames). */
  function splitCsvLine(line) {
    const out = [];
    let cur = "";
    let inQuotes = false;
    for (let i = 0; i < line.length; i++) {
      const c = line[i];
      if (c === '"') {
        if (inQuotes && line[i + 1] === '"') {
          cur += '"';
          i++;
        } else {
          inQuotes = !inQuotes;
        }
        continue;
      }
      if (c === "," && !inQuotes) {
        out.push(cur.trim());
        cur = "";
        continue;
      }
      cur += c;
    }
    out.push(cur.trim());
    return out.map((cell) => {
      let s = cell;
      if (s.startsWith('"') && s.endsWith('"')) {
        s = s.slice(1, -1).replace(/""/g, '"');
      }
      return s.trim();
    });
  }

  function parseCsv(text) {
    const lines = String(text || "").trim().split(/\r?\n/);
    if (lines.length < 2) return [];
    const headers = splitCsvLine(lines[0]);
    return lines.slice(1).map((line) => {
      if (!line.trim()) return null;
      const cols = splitCsvLine(line);
      const row = {};
      headers.forEach((h, i) => {
        row[h] = (cols[i] || "").trim();
      });
      return row;
    }).filter(Boolean);
  }

  function normalizeObjectAssociation(rawInput) {
    const raw = String(rawInput || "").toLowerCase().trim();
    if (!raw) return "other";
    if (raw === "fruitss") return "fruits";
    if (raw === "social/human/human") return "social/human";
    if (raw === "stone" || raw === "rock") return "sand";
    return raw;
  }

  function normalizeNatureTag(rawInput) {
    const raw = String(rawInput || "").toLowerCase().trim();
    if (!raw) return "other";
    if (raw === "stone" || raw === "rock") return "sand";
    return raw;
  }

  function fileBase(pathLike) {
    const name = String(pathLike || "").split("/").pop() || "";
    return name.replace(/\.[a-z0-9]+$/i, "").toLowerCase();
  }

  function loadNatureTagMap(rows) {
    const map = {};
    rows.forEach((r) => {
      const rawName = r.image_file || r.filename || r.file_name || "";
      const fileKey = fileBase(rawName);
      if (!fileKey) return;
      const tag = normalizeNatureTag(r.type || r.nature_image_level || r.category || "");
      map[fileKey] = tag;
      map[`${fileKey}.jpg`] = tag;
      map[`${fileKey}.jpeg`] = tag;
      map[`${fileKey}.png`] = tag;
    });
    return map;
  }

  function buildPosterMetaMap(metaRows) {
    const map = {};
    (metaRows || []).forEach((r) => {
      const climate = String(r.climate || "").toLowerCase();
      const rawName = r.image_file || r.filename || "";
      const fileKey = fileBase(rawName);
      if (!climate || !fileKey) return;
      const key = `${climate}:${fileKey}`;
      map[key] = {
        association: normalizeObjectAssociation(r.object_association || r.category || ""),
        product: String(r.product_type || "other").toLowerCase()
      };
    });
    return map;
  }

  function getNatureTag(map, img) {
    const fname = img.file || img.image || img.poster_file || img.path || "";
    const key = fileBase(fname);
    return map[key] || map[`${key}.jpg`] || map[`${key}.jpeg`] || map[`${key}.png`] || "other";
  }

  function getPosterMeta(img) {
    const climate = String(img._climate || "").toLowerCase();
    const fname = img.file || img.image || img.poster_file || "";
    const key = `${climate}:${fileBase(fname)}`;
    return state.posterMeta[key] || { association: "other", product: "other" };
  }

  function hexToRgb(hex) {
    if (window.ColorUtils && typeof window.ColorUtils.hexToRgb === "function") {
      return window.ColorUtils.hexToRgb(hex);
    }
    const n = String(hex || "").replace("#", "");
    if (!/^[0-9a-f]{6}$/i.test(n)) return { r: 0, g: 0, b: 0 };
    return { r: parseInt(n.slice(0, 2), 16), g: parseInt(n.slice(2, 4), 16), b: parseInt(n.slice(4, 6), 16) };
  }

  function rgbToHsv(rgb) {
    if (window.ColorUtils && typeof window.ColorUtils.rgbToHsv === "function") {
      return window.ColorUtils.rgbToHsv(rgb.r, rgb.g, rgb.b);
    }
    const r = rgb.r / 255;
    const g = rgb.g / 255;
    const b = rgb.b / 255;
    const max = Math.max(r, g, b);
    const min = Math.min(r, g, b);
    const d = max - min;
    let h = 0;
    const s = max === 0 ? 0 : d / max;
    const v = max;
    if (d !== 0) {
      if (max === r) h = ((g - b) / d) % 6;
      else if (max === g) h = (b - r) / d + 2;
      else h = (r - g) / d + 4;
      h *= 60;
      if (h < 0) h += 360;
    }
    return { h, s: s * 100, v: v * 100 };
  }

  function climateFilterKeys(selected) {
    if (selected === "all") return Object.keys(state.posterData);
    return [selected];
  }

  function collectImagesByClimate(dataset, selectedClimate) {
    return climateFilterKeys(selectedClimate).flatMap((k) =>
      (dataset[k] || []).map((img) => ({ ...img, _climate: k }))
    );
  }

  /** Nested per-image colors vs superflat color rows (poster_file + hex). */
  function normalizeColorDataset(raw) {
    if (!Array.isArray(raw) || raw.length === 0) return [];
    const first = raw[0];
    if (first.colors && Array.isArray(first.colors)) {
      return raw
        .map((r) => ({
          file: r.file || r.image || r.poster_file,
          colors: r.colors
        }))
        .filter((r) => r.file && r.colors.length);
    }
    if (first.hex && (first.poster_file || first.file)) {
      const byFile = new Map();
      raw.forEach((row) => {
        const fname = row.poster_file || row.file;
        if (!fname || !row.hex) return;
        if (!byFile.has(fname)) byFile.set(fname, []);
        byFile.get(fname).push({
          hex: row.hex,
          percent: typeof row.percent === "number" ? row.percent : 0
        });
      });
      return Array.from(byFile.entries()).map(([file, colors]) => ({ file, colors }));
    }
    return [];
  }

  function aggregatePaletteFull(images) {
    const bucket = {};
    images.forEach((img) => {
      const colors = Array.isArray(img.colors) ? img.colors : [];
      colors.forEach((c) => {
        const h = String(c.hex || "").toLowerCase();
        const w = typeof c.percent === "number" ? c.percent : 0;
        if (!h || w <= 0) return;
        bucket[h] = (bucket[h] || 0) + w;
      });
    });
    const entries = Object.entries(bucket).map(([hex, value]) => ({ hex, value }));
    const total = entries.reduce((s, x) => s + x.value, 0) || 1;
    return entries
      .sort((a, b) => b.value - a.value)
      .map((e) => ({ hex: e.hex, share: e.value / total }));
  }

  /** Slightly boost saturation/value for display — keeps extracted hue, avoids muddy read. */
  function vividifyHex(hex) {
    const rgb = hexToRgb(hex);
    const hsv = rgbToHsv(rgb);
    if (hsv.s < 12) return hex;
    const s = Math.min(100, hsv.s * 1.15);
    const v = Math.min(100, hsv.v * 1.06);
    return hsvToHex(hsv.h, s, v);
  }

  function hsvToHex(h, s, v) {
    const S = s / 100;
    const V = v / 100;
    const C = V * S;
    const X = C * (1 - Math.abs(((h / 60) % 2) - 1));
    const m = V - C;
    let rp = 0;
    let gp = 0;
    let bp = 0;
    if (h >= 0 && h < 60) {
      rp = C;
      gp = X;
    } else if (h < 120) {
      rp = X;
      gp = C;
    } else if (h < 180) {
      gp = C;
      bp = X;
    } else if (h < 240) {
      gp = X;
      bp = C;
    } else if (h < 300) {
      rp = X;
      bp = C;
    } else {
      rp = C;
      bp = X;
    }
    const r = Math.round((rp + m) * 255);
    const g = Math.round((gp + m) * 255);
    const b = Math.round((bp + m) * 255);
    const to2 = (n) => n.toString(16).padStart(2, "0");
    return `#${to2(r)}${to2(g)}${to2(b)}`;
  }

  const DISPLAY_MAX_SWATCHES = 5;
  const DISPLAY_MIN_SWATCHES = 3;
  const DISPLAY_SHARE_FLOOR = 0.045;

  /**
   * Top 3–5 dominant swatches; drop tiny tails; exaggerate dominant widths (gamma) for legibility.
   */
  function paletteForDisplay(fullList) {
    if (!fullList.length) return [];
    const sorted = [...fullList].sort((a, b) => b.share - a.share);
    let picked = sorted.slice(0, DISPLAY_MAX_SWATCHES);
    const t = picked.reduce((s, x) => s + x.share, 0) || 1;
    picked = picked.map((x) => ({ ...x, share: x.share / t }));
    picked = picked.filter((x, i) => x.share >= DISPLAY_SHARE_FLOOR || i < DISPLAY_MIN_SWATCHES);
    const t2 = picked.reduce((s, x) => s + x.share, 0) || 1;
    picked = picked.map((x) => ({ ...x, share: x.share / t2 }));
    const gamma = 0.38;
    const weights = picked.map((x) => Math.pow(x.share, gamma));
    const ws = weights.reduce((a, b) => a + b, 0) || 1;
    return picked.map((x, i) => ({
      hex: vividifyHex(x.hex),
      share: weights[i] / ws,
      rawShare: x.share
    }));
  }

  function computeStats(palette) {
    let sat = 0;
    let bri = 0;
    let neutral = 0;
    let warm = 0;
    let cool = 0;
    palette.forEach((p) => {
      const hsv = rgbToHsv(hexToRgb(p.hex));
      sat += hsv.s * p.share;
      bri += hsv.v * p.share;
      if (hsv.s < 14) neutral += p.share;
      const isWarm = hsv.h <= 90 || hsv.h >= 330;
      if (isWarm) warm += p.share;
      else cool += p.share;
    });
    return { saturation: sat, brightness: bri, neutral, warm, cool };
  }

  /** Renormalize top-N mass for hue-bin readout (full tail is noise). */
  function topSharesForHue(list, n) {
    if (!list.length) return [];
    const t = [...list].sort((a, b) => b.share - a.share).slice(0, n);
    const sum = t.reduce((s, x) => s + x.share, 0) || 1;
    return t.map((x) => ({ hex: x.hex, share: x.share / sum }));
  }

  function hueDistance(a, b) {
    let d = Math.abs(a - b);
    if (d > 180) d = 360 - d;
    return d;
  }

  function renderHueDeltaStrip(parent, naturePal, posterPal) {
    const wrap = el("div", "delta-hue-strip-wrap");
    wrap.appendChild(el("p", "delta-hue-strip__label", "Hue shift (poster vs nature)"));
    const strip = el("div", "delta-hue-strip");
    const nBins = 20;
    const binNature = Array(nBins).fill(0);
    const binPoster = Array(nBins).fill(0);
    const binNatureHex = Array(nBins)
      .fill(null)
      .map(() => ({ w: 0, h: 0, s: 0, v: 0 }));
    const binPosterHex = Array(nBins)
      .fill(null)
      .map(() => ({ w: 0, h: 0, s: 0, v: 0 }));

    function addToBins(pal, arr, hexAcc) {
      pal.forEach((p) => {
        const hsv = rgbToHsv(hexToRgb(p.hex));
        const i = Math.min(nBins - 1, Math.floor((hsv.h / 360) * nBins));
        arr[i] += p.share;
        const acc = hexAcc[i];
        acc.w += p.share;
        acc.h += hsv.h * p.share;
        acc.s += hsv.s * p.share;
        acc.v += hsv.v * p.share;
      });
    }

    addToBins(naturePal.length ? naturePal : [{ hex: "#888888", share: 1 }], binNature, binNatureHex);
    addToBins(posterPal.length ? posterPal : [{ hex: "#888888", share: 1 }], binPoster, binPosterHex);

    for (let i = 0; i < nBins; i++) {
      const dn = binPoster[i] - binNature[i];
      const seg = el("div", "delta-hue-strip__seg");
      const mag = Math.min(1, Math.abs(dn) * 4 + 0.08);
      seg.style.flex = `${0.25 + mag * 2.4} 1 0%`;

      let bgHex;
      let signClass = "delta-hue-strip__seg--flat";
      if (dn > 0.02) {
        signClass = "delta-hue-strip__seg--up";
        const acc = binPosterHex[i];
        bgHex =
          acc.w > 0
            ? hsvToHex(acc.h / acc.w, Math.min(100, (acc.s / acc.w) * 1.08), Math.min(100, (acc.v / acc.w) * 1.05))
            : hsvToHex((i + 0.5) * (360 / nBins), 72, 58);
      } else if (dn < -0.02) {
        signClass = "delta-hue-strip__seg--down";
        const acc = binNatureHex[i];
        bgHex =
          acc.w > 0
            ? hsvToHex(acc.h / acc.w, (acc.s / acc.w) * 0.92, (acc.v / acc.w) * 0.88)
            : hsvToHex((i + 0.5) * (360 / nBins), 45, 42);
      } else {
        bgHex = hsvToHex((i + 0.5) * (360 / nBins), 18, 88);
      }
      seg.className = `delta-hue-strip__seg ${signClass}`;
      seg.style.background = bgHex;
      strip.appendChild(seg);
    }

    const key = el("div", "delta-hue-strip__key");
    key.innerHTML =
      "<span><span class=\"delta-hue-strip__sw delta-hue-strip__sw--up\" aria-hidden=\"true\"></span> More in poster</span>" +
      "<span><span class=\"delta-hue-strip__sw delta-hue-strip__sw--down\" aria-hidden=\"true\"></span> Less / pulled back</span>";
    wrap.appendChild(strip);
    wrap.appendChild(key);
    parent.appendChild(wrap);
  }

  function renderHueBridge(parent, naturePal, posterPal) {
    const wrap = el("div", "hue-bridge");
    wrap.appendChild(el("p", "hue-bridge__label", "Aligned hues"));
    if (!naturePal.length || !posterPal.length) {
      wrap.appendChild(el("p", "hue-bridge__empty", "—"));
      parent.appendChild(wrap);
      return;
    }
    const used = new Set();
    const maxRows = Math.min(3, naturePal.length);
    for (let i = 0; i < maxRows; i++) {
      const nh = rgbToHsv(hexToRgb(naturePal[i].hex)).h;
      let bestj = -1;
      let bestd = 999;
      for (let j = 0; j < posterPal.length; j++) {
        if (used.has(j)) continue;
        const ph = rgbToHsv(hexToRgb(posterPal[j].hex)).h;
        const d = hueDistance(nh, ph);
        if (d < bestd) {
          bestd = d;
          bestj = j;
        }
      }
      if (bestj < 0) break;
      used.add(bestj);
      const row = el("div", "hue-bridge__row");
      const left = el("div", "hue-bridge__swatch");
      left.style.background = naturePal[i].hex;
      left.dataset.role = "nature";
      const line = el("div", "hue-bridge__line");
      const right = el("div", "hue-bridge__swatch hue-bridge__swatch--poster");
      right.style.background = posterPal[bestj].hex;
      if (bestd < 25) row.classList.add("hue-bridge__row--aligned");
      else if (bestd < 55) row.classList.add("hue-bridge__row--shifted");
      else row.classList.add("hue-bridge__row--replaced");
      row.appendChild(left);
      row.appendChild(line);
      row.appendChild(right);
      wrap.appendChild(row);
    }
    parent.appendChild(wrap);
  }

  function el(tag, className, text) {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (typeof text === "string") node.textContent = text;
    return node;
  }

  function showTip(ev, html) {
    if (!tooltip) return;
    tooltip.hidden = false;
    tooltip.innerHTML = html;
    tooltip.style.left = `${ev.clientX + 12}px`;
    tooltip.style.top = `${ev.clientY + 12}px`;
  }

  function hideTip() {
    if (tooltip) tooltip.hidden = true;
  }

  function renderPaletteStrip(parent, palette, label, variant) {
    const strip = el("div", `palette-strip palette-strip--${variant || "default"}`);
    if (!palette.length) {
      const empty = el("div", "palette-strip__block palette-strip__block--empty");
      empty.style.width = "100%";
      empty.style.background = "#e8e4dc";
      strip.appendChild(empty);
      parent.appendChild(strip);
      return;
    }
    palette.forEach((p) => {
      const block = el("div", "palette-strip__block");
      block.style.background = p.hex;
      const grow = Math.max(10, Math.round(p.share * 100));
      block.style.flex = `${grow} 1 0%`;
      const pct = typeof p.rawShare === "number" ? (p.rawShare * 100).toFixed(1) : (p.share * 100).toFixed(1);
      block.addEventListener("mousemove", (ev) => {
        showTip(
          ev,
          `<strong>${label}</strong><br>${
            window.ColorUtils && typeof window.ColorUtils.formatHexDisplay === "function"
              ? window.ColorUtils.formatHexDisplay(p.hex)
              : String(p.hex || "").toUpperCase()
          }<br>~${pct}% of shown palette`
        );
      });
      block.addEventListener("mouseleave", hideTip);
      strip.appendChild(block);
    });
    parent.appendChild(strip);
  }

  function renderDeltaPanel(parent, delta) {
    const panel = el("div", "delta-panel");
    panel.appendChild(el("p", "delta-panel__metrics-title", "Shift cues"));

    METRICS.forEach((m) => {
      const value = delta[m.id] || 0;
      const row = el("div", "delta-metric delta-metric--visual");
      const arrow = el("span", "delta-metric__arrow");
      const strong = Math.min(1, Math.abs(value) / (m.id === "neutral" || m.id === "warm" || m.id === "cool" ? 22 : 18));
      if (Math.abs(value) < 0.35) {
        arrow.textContent = "→";
        arrow.classList.add("delta-metric__arrow--flat");
      } else if (value > 0) {
        arrow.textContent = "↑";
        arrow.classList.add("delta-metric__arrow--up");
      } else {
        arrow.textContent = "↓";
        arrow.classList.add("delta-metric__arrow--down");
      }
      const blob = el("span", "delta-metric__blob");
      const hue =
        m.id === "saturation"
          ? 145
          : m.id === "brightness"
            ? 48
            : m.id === "neutral"
              ? 210
              : m.id === "warm"
                ? 28
                : 210;
      const sat = 55 + strong * 35;
      const bri = 42 + strong * 28;
      blob.style.background = hsvToHex(hue, sat, bri);
      blob.style.opacity = String(0.45 + strong * 0.5);
      const lab = el("span", "delta-metric__name", m.label);
      row.appendChild(arrow);
      row.appendChild(blob);
      row.appendChild(lab);
      row.setAttribute(
        "aria-label",
        `${m.label}: ${value >= 0 ? "plus " : "minus "}${Math.abs(value).toFixed(1)}`
      );
      panel.appendChild(row);
    });
    parent.appendChild(panel);
  }

  function filterByRowRule(images, natureTagMap, rowRule, side, productFilter) {
    return images.filter((img) => {
      if (side === "nature") {
        const tag = getNatureTag(natureTagMap, img);
        return rowRule.natureTags.includes(tag);
      }
      const meta = getPosterMeta(img);
      const tag = meta.association;
      if (!rowRule.posterTags.includes(tag)) return false;
      const product = meta.product;
      if (rowRule.posterProducts && !rowRule.posterProducts.includes(product)) return false;
      if (productFilter !== "all" && product !== productFilter) return false;
      return true;
    });
  }

  function render() {
    if (!state.ready || !rowsHost) return;
    const climate = controls.climate ? controls.climate.value : "all";
    const productFilter = controls.product ? controls.product.value : "all";
    const natureImages = collectImagesByClimate(state.natureData, climate);
    const posterImages = collectImagesByClimate(state.posterData, climate);

    rowsHost.innerHTML = "";

    MATCH_ROWS.forEach((rule) => {
      const natureSet = filterByRowRule(natureImages, state.natureTagsByFile, rule, "nature", productFilter);
      const posterSet = filterByRowRule(posterImages, state.natureTagsByFile, rule, "poster", productFilter);

      const natureFull = aggregatePaletteFull(natureSet);
      const posterFull = aggregatePaletteFull(posterSet);
      const naturePalette = paletteForDisplay(natureFull);
      const posterPalette = paletteForDisplay(posterFull);
      const nStats = computeStats(natureFull);
      const pStats = computeStats(posterFull);
      const delta = {
        saturation: pStats.saturation - nStats.saturation,
        brightness: pStats.brightness - nStats.brightness,
        neutral: (pStats.neutral - nStats.neutral) * 100,
        warm: (pStats.warm - nStats.warm) * 100,
        cool: (pStats.cool - nStats.cool) * 100
      };

      const row = el("article", "comparison-row");
      const titleBlock = el("div", "comparison-row__intro");
      titleBlock.appendChild(el("h2", "comparison-row__title", rule.title));
      titleBlock.appendChild(el("p", "comparison-row__takeaway", rule.takeaway));
      row.appendChild(titleBlock);

      const source = el("section", "panel");
      source.appendChild(el("p", "panel__heading", "Nature source"));
      renderPaletteStrip(source, naturePalette, `${rule.title} source`, "nature");
      row.appendChild(source);

      const mid = el("section", "panel panel--transform");
      mid.appendChild(el("p", "panel__heading", "Transformation"));
      renderHueDeltaStrip(mid, topSharesForHue(natureFull, 28), topSharesForHue(posterFull, 28));
      renderHueBridge(mid, naturePalette, posterPalette);
      renderDeltaPanel(mid, delta);
      row.appendChild(mid);

      const output = el("section", "panel");
      output.appendChild(el("p", "panel__heading", "Poster output"));
      renderPaletteStrip(output, posterPalette, `${rule.title} poster`, "poster");
      row.appendChild(output);

      rowsHost.appendChild(row);
    });
  }

  async function loadJson(path) {
    const r = await fetch(path);
    if (!r.ok) throw new Error(`Failed ${path}`);
    return r.json();
  }

  async function loadJsonAny(paths) {
    let lastErr = null;
    for (const p of paths) {
      try {
        return await loadJson(p);
      } catch (err) {
        lastErr = err;
      }
    }
    throw lastErr || new Error("No JSON path succeeded");
  }

  async function loadCsv(path) {
    const r = await fetch(path);
    if (!r.ok) throw new Error(`Failed ${path}`);
    return parseCsv(await r.text());
  }

  async function init() {
    try {
      const [
        posterBrazil,
        posterEgypt,
        posterFinland,
        natureBrazil,
        natureEgypt,
        natureFinland,
        imageMeta,
        natureTags
      ] = await Promise.all([
        loadJsonAny([
          "data/results_brazil_clean.json",
          "data/results_brazil.json",
          "data/results_brazil_superflat.json"
        ]),
        loadJsonAny([
          "data/results_egypt_clean.json",
          "data/results_egypt.json",
          "data/results_egypt_superflat.json"
        ]),
        loadJsonAny([
          "data/results_finland_clean.json",
          "data/results_finland.json",
          "data/results_finland_superflat.json"
        ]),
        loadJsonAny([
          "data/results_brazil_nature_clean.json",
          "data/results_brazil_nature_superflat.json"
        ]),
        loadJsonAny([
          "data/results_egypt_nature_clean.json",
          "data/results_egypt_nature_clean_superflat.json"
        ]),
        loadJsonAny([
          "data/results_finland_nature_clean.json",
          "data/results_finland_nature_clean_superflat.json"
        ]),
        loadJson("data/image_metadata.json"),
        loadCsv("data/nature_image_level_tags.csv")
      ]);

      state.posterData = {
        brazil: normalizeColorDataset(posterBrazil),
        egypt: normalizeColorDataset(posterEgypt),
        finland: normalizeColorDataset(posterFinland)
      };
      state.natureData = {
        brazil: normalizeColorDataset(natureBrazil),
        egypt: normalizeColorDataset(natureEgypt),
        finland: normalizeColorDataset(natureFinland)
      };
      state.posterMeta = buildPosterMetaMap(imageMeta);
      state.natureTagsByFile = loadNatureTagMap(natureTags);
      state.ready = true;

      if (controls.climate) controls.climate.addEventListener("change", render);
      if (controls.product) controls.product.addEventListener("change", render);
      render();
    } catch (err) {
      if (rowsHost) {
        rowsHost.innerHTML = `<p>Visualization failed to load: ${String(err.message || err)}</p>`;
      }
      console.error(err);
    }
  }

  init();
})();
