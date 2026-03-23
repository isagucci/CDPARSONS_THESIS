(function () {
  /**
   * LayeredScatterplot
   * -------------------
   * A standalone 2D layered scatterplot module (canvas-based).
   *
   * Layers supported:
   * - nature: faded background field (small, low opacity)
   * - posters: designed selection field (medium opacity + outline)
   * - user: foregrounded preference (larger + glow + highest opacity)
   *
   * Interaction:
   * - hover tooltip per point
   * - simple show/hide toggles per layer
   *
   * Data assumptions (flexible parsing):
   * - A point may be an object with:
   *   - hex
   *   - sat_pct / val_pct OR saturation / brightness OR sat / val in percent
   *   - r,g,b OR rgb
   *   - percent (used as weight)
   *   - climate / category / poster_file / poster_path (metadata)
   * - User layer may also accept an array of hex strings.
   */

  const STATE = {
    canvas: null,
    ctx: null,
    container: null,
    tooltipEl: null,
    controlsEl: null,
    bounds: null,
    visible: { nature: true, posters: true, user: true },
    layers: [],
    pointsScreen: [],
    rafId: null
  };

  const AXIS = {
    margin: 56
  };

  const LABELS = {
    nature: "Nature",
    posters: "Posters",
    user: "User"
  };

  function clamp(v, min, max) {
    return Math.min(max, Math.max(min, v));
  }

  function hexToRgb(hex) {
    if (!hex) return null;
    let c = String(hex).replace("#", "").trim();
    if (c.length === 3) {
      c = c
        .split("")
        .map((ch) => ch + ch)
        .join("");
    }
    if (c.length !== 6) return null;
    const num = parseInt(c, 16);
    const r = (num >> 16) & 255;
    const g = (num >> 8) & 255;
    const b = num & 255;
    return { r, g, b };
  }

  function rgbToSatValPercent(r, g, b) {
    // Prefer shared ColorUtils for consistency.
    if (window.ColorUtils && typeof window.ColorUtils.rgbToHsv === "function") {
      const hsv = window.ColorUtils.rgbToHsv(r, g, b); // s and v are 0–100
      return { sat_pct: hsv.s, val_pct: hsv.v };
    }
    // Fallback (HSV conversion) could be added later; for now return null.
    return null;
  }

  function normalizePoint(raw, datasetType, fallbackClimate) {
    if (!raw) return null;

    // User layer might provide a hex string.
    if (typeof raw === "string") {
      const hex = raw;
      const rgb = hexToRgb(hex);
      if (!rgb) return null;
      const sv = rgbToSatValPercent(rgb.r, rgb.g, rgb.b);
      if (!sv) return null;
      return {
        datasetType,
        hex,
        saturation01: clamp(sv.sat_pct / 100, 0, 1),
        brightness01: clamp(sv.val_pct / 100, 0, 1),
        weight: 1,
        climate: fallbackClimate || raw.climate,
        category: raw.category,
        source: raw.poster_file || raw.poster_path || "User selection"
      };
    }

    const hex = raw.hex || raw.color_hex || raw.color || "";
    const rgb = raw.r != null && raw.g != null && raw.b != null ? { r: raw.r, g: raw.g, b: raw.b } : null;

    let sat_pct = raw.sat_pct ?? raw.saturation_pct ?? raw.sat;
    let val_pct = raw.val_pct ?? raw.brightness_pct ?? raw.val ?? raw.v;

    // If sat/val missing, derive from RGB.
    if ((sat_pct == null || val_pct == null) && rgb && window.ColorUtils) {
      const sv = rgbToSatValPercent(rgb.r, rgb.g, rgb.b);
      if (sv) {
        sat_pct = sv.sat_pct;
        val_pct = sv.val_pct;
      }
    }

    if (!hex || !rgb && (sat_pct == null || val_pct == null)) return null;
    if (!hexToRgb(hex)) return null;

    // Weight: prefer `percent` (0–100). If missing, default to 1.
    const weight = typeof raw.percent === "number" ? raw.percent : typeof raw.weight === "number" ? raw.weight : 1;

    const climate = raw.climate || fallbackClimate || "";
    const category = raw.category || raw.object_association || "";
    const source = raw.poster_file || raw.poster_path || raw.source || "";

    const saturation01 = clamp((Number(sat_pct) || 0) / 100, 0, 1);
    const brightness01 = clamp((Number(val_pct) || 0) / 100, 0, 1);

    return {
      datasetType,
      hex: String(hex).toLowerCase(),
      saturation01,
      brightness01,
      weight: weight > 0 ? weight : 1,
      climate,
      category,
      source,
      raw
    };
  }

  function computeCentroid(points) {
    const valid = Array.isArray(points) ? points.filter(Boolean) : [];
    if (!valid.length) return null;
    let sumW = 0;
    let sumS = 0;
    let sumB = 0;
    valid.forEach((pt) => {
      const w = pt.weight > 0 ? pt.weight : 1;
      sumW += w;
      sumS += pt.saturation01 * w;
      sumB += pt.brightness01 * w;
    });
    const denom = sumW || 1;
    return { saturation01: sumS / denom, brightness01: sumB / denom };
  }

  function ensureCanvas(container) {
    // Replace previous canvas to avoid duplicate resize listeners.
    if (STATE.canvas && STATE.canvas.parentElement === container) return STATE.canvas;
    if (STATE.canvas && STATE.canvas.parentElement) STATE.canvas.remove();

    const canvas = document.createElement("canvas");
    canvas.setAttribute("aria-label", "Layered color scatterplot");
    canvas.style.display = "block";
    container.innerHTML = "";
    container.appendChild(canvas);
    STATE.canvas = canvas;
    STATE.ctx = canvas.getContext("2d");
    return canvas;
  }

  function setupCanvas() {
    if (!STATE.canvas || !STATE.container) return;
    const rect = STATE.container.getBoundingClientRect();
    const dpr = window.devicePixelRatio || 1;

    STATE.canvas.style.width = rect.width + "px";
    STATE.canvas.style.height = rect.height + "px";

    const width = Math.max(1, rect.width * dpr);
    const height = Math.max(1, rect.height * dpr);
    STATE.canvas.width = width;
    STATE.canvas.height = height;
    STATE.bounds = { rect, dpr, width, height };
  }

  function mapS(s01) {
    const { width } = STATE.bounds;
    const { margin } = AXIS;
    return margin + s01 * (width - margin * 2);
  }

  function mapB(b01) {
    const { height } = STATE.bounds;
    const { margin } = AXIS;
    return height - (margin + b01 * (height - margin * 2));
  }

  function drawGrid(ctx) {
    if (!STATE.bounds) return;
    const { width, height } = STATE.bounds;
    const { margin } = AXIS;

    ctx.save();
    ctx.clearRect(0, 0, width, height);

    // subtle atmosphere
    const grad = ctx.createLinearGradient(0, 0, 0, height);
    grad.addColorStop(0, "rgba(255,255,255,0.06)");
    grad.addColorStop(1, "rgba(0,0,0,0.00)");
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, width, height);

    // borderless grid frame
    ctx.strokeStyle = "rgba(255,255,255,0.18)";
    ctx.lineWidth = 1;
    ctx.strokeRect(margin, margin, width - margin * 2, height - margin * 2);

    // tick lines (3 divisions)
    ctx.globalAlpha = 0.55;
    for (let i = 1; i <= 2; i++) {
      const t = i / 3;
      const x = margin + t * (width - margin * 2);
      const y = height - (margin + t * (height - margin * 2));

      // vertical
      ctx.beginPath();
      ctx.moveTo(x, margin);
      ctx.lineTo(x, height - margin);
      ctx.stroke();

      // horizontal
      ctx.beginPath();
      ctx.moveTo(margin, y);
      ctx.lineTo(width - margin, y);
      ctx.stroke();
    }
    ctx.restore();
  }

  function drawAxesLabels(ctx) {
    const { width, height } = STATE.bounds;
    const { margin } = AXIS;

    ctx.save();
    ctx.font = "12px system-ui, -apple-system, BlinkMacSystemFont, 'SF Pro Text', 'Helvetica Neue', Arial, sans-serif";
    ctx.fillStyle = "rgba(255,255,255,0.78)";
    ctx.textAlign = "right";
    ctx.textBaseline = "bottom";
    ctx.fillText("brightness / value", margin - 12, margin + 6);

    ctx.textAlign = "right";
    ctx.textBaseline = "bottom";
    ctx.fillText("saturation", width - margin + 10, height - margin + 18);
    ctx.restore();
  }

  function rgba(hex, alpha) {
    const rgb = hexToRgb(hex);
    if (!rgb) return `rgba(136,136,136,${alpha})`;
    return `rgba(${rgb.r}, ${rgb.g}, ${rgb.b}, ${alpha})`;
  }

  function layerStyle(datasetType) {
    // returns a styling preset for each layer.
    if (datasetType === "nature") {
      return { alpha: 0.18, radiusBase: 5, radiusScale: 0.035, stroke: "rgba(255,255,255,0.20)" };
    }
    if (datasetType === "posters") {
      return { alpha: 0.55, radiusBase: 6.5, radiusScale: 0.045, stroke: "rgba(255,255,255,0.42)" };
    }
    // user
    return { alpha: 0.95, radiusBase: 10, radiusScale: 0.09, stroke: "rgba(255,255,255,0.75)" };
  }

  function drawCentroid(ctx, centroid, datasetType, label) {
    if (!centroid) return;
    const { saturation01, brightness01 } = centroid;
    const x = mapS(saturation01);
    const y = mapB(brightness01);

    ctx.save();
    const st = layerStyle(datasetType);

    if (datasetType === "nature") {
      ctx.globalAlpha = 0.9;
      ctx.strokeStyle = "rgba(255,255,255,0.55)";
      ctx.lineWidth = 1.2;
      ctx.beginPath();
      ctx.moveTo(x - 10, y);
      ctx.lineTo(x + 10, y);
      ctx.moveTo(x, y - 10);
      ctx.lineTo(x, y + 10);
      ctx.stroke();
    } else if (datasetType === "posters") {
      ctx.globalAlpha = 0.95;
      ctx.strokeStyle = st.stroke;
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.rect(x - 7, y - 7, 14, 14);
      ctx.stroke();
    } else {
      // user: ring
      ctx.globalAlpha = 1;
      ctx.strokeStyle = "rgba(255,255,255,0.92)";
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc(x, y, 12, 0, Math.PI * 2);
      ctx.stroke();
      ctx.globalAlpha = 0.85;
      ctx.fillStyle = "rgba(255,255,255,0.12)";
      ctx.beginPath();
      ctx.arc(x, y, 6, 0, Math.PI * 2);
      ctx.fill();
    }

    if (label) {
      ctx.font =
        datasetType === "user"
          ? "12px system-ui, -apple-system, BlinkMacSystemFont, 'SF Pro Text', 'Helvetica Neue', Arial, sans-serif"
          : "11px system-ui, -apple-system, BlinkMacSystemFont, 'SF Pro Text', 'Helvetica Neue', Arial, sans-serif";
      ctx.fillStyle = "rgba(255,255,255,0.82)";
      ctx.textAlign = "left";
      ctx.textBaseline = "middle";
      ctx.fillText(label, x + 14, y - 6);
    }

    ctx.restore();
  }

  function drawPoints(ctx, points, datasetType) {
    if (!points || !points.length) return;
    const st = layerStyle(datasetType);

    points.forEach((pt) => {
      const x = mapS(pt.saturation01);
      const y = mapB(pt.brightness01);
      const w = pt.weight > 0 ? pt.weight : 1;
      const radius = st.radiusBase + w * st.radiusScale;

      // Track screen position for hover detection.
      STATE.pointsScreen.push({
        pt,
        x,
        y,
        radius
      });

      ctx.save();
      ctx.globalAlpha = 1;

      if (datasetType === "user") {
        // subtle glow
        const rgb = hexToRgb(pt.hex) || { r: 255, g: 255, b: 255 };
        ctx.shadowColor = `rgba(${rgb.r}, ${rgb.g}, ${rgb.b}, 0.45)`;
        ctx.shadowBlur = 10;
      }

      // Fill with actual hex color (alpha controlled by layer).
      ctx.fillStyle = rgba(pt.hex, st.alpha);
      ctx.strokeStyle = st.stroke;
      ctx.lineWidth = datasetType === "user" ? 1.8 : datasetType === "posters" ? 1.2 : 0.9;

      ctx.beginPath();
      ctx.arc(x, y, radius, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();

      if (datasetType === "user") {
        // inner highlight
        ctx.shadowBlur = 0;
        ctx.fillStyle = "rgba(255, 255, 255, 0.14)";
        ctx.beginPath();
        ctx.arc(x, y, Math.max(2.5, radius * 0.35), 0, Math.PI * 2);
        ctx.fill();
      }

      ctx.restore();
    });
  }

  function pickClosestPoint(mouseX, mouseY) {
    let closest = null;
    let closestDist = Infinity;
    for (let i = 0; i < STATE.pointsScreen.length; i++) {
      const p = STATE.pointsScreen[i];
      const dx = mouseX - p.x;
      const dy = mouseY - p.y;
      const d = Math.sqrt(dx * dx + dy * dy);
      const limit = p.radius * 1.25;
      if (d <= limit && d < closestDist) {
        closestDist = d;
        closest = p;
      }
    }
    return closest;
  }

  function tooltipHtmlForPoint(pt) {
    const satPct = Math.round(pt.saturation01 * 100);
    const valPct = Math.round(pt.brightness01 * 100);
    const label = LABELS[pt.datasetType] || pt.datasetType;
    const hexDisplay =
      window.ColorUtils && typeof window.ColorUtils.formatHexDisplay === "function"
        ? window.ColorUtils.formatHexDisplay(pt.hex)
        : String(pt.hex || "").toUpperCase();

    const metaLines = [];
    if (pt.climate) metaLines.push(pt.climate);
    if (pt.category) metaLines.push(pt.category);
    const meta = metaLines.length ? metaLines.join(" • ") : "";

    const source = pt.source ? String(pt.source) : "";

    // Keep it compact; the tooltip container already has editorial styling.
    return `
      <div style="padding: 0.65rem 0.75rem; max-width: 240px;">
        <div style="font-size: 0.72rem; letter-spacing: 0.14em; text-transform: uppercase; opacity: 0.78; margin-bottom: 0.25rem;">
          ${label}
        </div>
        <div style="font-size: 0.86rem; font-weight: 600; margin-bottom: 0.25rem;">
          <span style="font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, 'Liberation Mono', 'Courier New', monospace;">${hexDisplay}</span>
        </div>
        <div style="opacity: 0.88; font-size: 0.78rem; line-height: 1.35;">
          Sat: ${satPct}% • Value: ${valPct}%
        </div>
        ${meta ? `<div style="opacity: 0.75; font-size: 0.78rem; margin-top: 0.25rem;">${meta}</div>` : ""}
        ${source ? `<div style="opacity: 0.68; font-size: 0.78rem; margin-top: 0.25rem;">Source: ${source}</div>` : ""}
      </div>
    `;
  }

  function handleMouseMove(event) {
    if (!STATE.bounds || !STATE.tooltipEl) return;
    const { rect, dpr } = STATE.bounds;

    const mx = (event.clientX - rect.left) * dpr;
    const my = (event.clientY - rect.top) * dpr;

    const closest = pickClosestPoint(mx, my);
    if (!closest) {
      STATE.tooltipEl.dataset.visible = "false";
      STATE.tooltipEl.hidden = true;
      return;
    }

    const pt = closest.pt;
    STATE.tooltipEl.innerHTML = tooltipHtmlForPoint(pt);
    STATE.tooltipEl.dataset.visible = "true";
    STATE.tooltipEl.hidden = false;
    STATE.tooltipEl.style.left = event.clientX + "px";
    STATE.tooltipEl.style.top = event.clientY + "px";
  }

  function handleMouseLeave() {
    if (!STATE.tooltipEl) return;
    STATE.tooltipEl.dataset.visible = "false";
    STATE.tooltipEl.hidden = true;
  }

  function buildControls(controlsContainer) {
    const host = controlsContainer || document.createElement("div");
    host.className = host.className || "layered-scatterplot__controls";

    host.innerHTML = "";
    const mk = (key, label, checked) => {
      const id = `layered-${key}-${Math.random().toString(16).slice(2)}`;
      const wrap = document.createElement("label");
      wrap.style.display = "inline-flex";
      wrap.style.alignItems = "center";
      wrap.style.gap = "0.5rem";
      wrap.style.marginRight = "0.85rem";
      wrap.style.cursor = "pointer";
      wrap.style.fontSize = "0.78rem";
      wrap.style.opacity = checked ? "0.95" : "0.65";
      const cb = document.createElement("input");
      cb.type = "checkbox";
      cb.id = id;
      cb.checked = checked;
      cb.style.margin = "0";
      cb.addEventListener("change", () => {
        STATE.visible[key] = cb.checked;
        wrap.style.opacity = cb.checked ? "0.95" : "0.65";
        render(); // redraw
      });

      const text = document.createElement("span");
      text.textContent = label;
      wrap.appendChild(cb);
      wrap.appendChild(text);
      return wrap;
    };

    host.appendChild(mk("nature", "Nature", STATE.visible.nature));
    host.appendChild(mk("posters", "Posters", STATE.visible.posters));
    host.appendChild(mk("user", "User", STATE.visible.user));

    return host;
  }

  function drawLegend(ctx) {
    if (!STATE.layers || !STATE.layers.length) return;
    // A tiny legend in the top-left (kept subtle).
    ctx.save();
    ctx.font = "11px system-ui, -apple-system, BlinkMacSystemFont, 'SF Pro Text', 'Helvetica Neue', Arial, sans-serif";
    ctx.fillStyle = "rgba(255,255,255,0.78)";
    ctx.textBaseline = "top";
    ctx.textAlign = "left";

    const x0 = AXIS.margin + 8;
    const y0 = AXIS.margin + 6;
    const items = [
      { key: "nature", label: "Nature", alpha: layerStyle("nature").alpha },
      { key: "posters", label: "Posters", alpha: layerStyle("posters").alpha },
      { key: "user", label: "User", alpha: layerStyle("user").alpha }
    ];

    items.forEach((it, idx) => {
      const y = y0 + idx * 16;
      const visible = STATE.visible[it.key];
      ctx.globalAlpha = visible ? 1 : 0.35;
      ctx.fillStyle = `rgba(255,255,255,${it.alpha})`;
      ctx.beginPath();
      ctx.arc(x0, y + 6, it.key === "user" ? 5 : 4, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = "rgba(255,255,255,0.25)";
      ctx.lineWidth = 1;
      ctx.stroke();
      ctx.globalAlpha = visible ? 1 : 0.35;
      ctx.fillText(it.label, x0 + 10, y + 2);
    });

    ctx.restore();
  }

  function render() {
    if (!STATE.ctx || !STATE.bounds) return;
    const ctx = STATE.ctx;

    STATE.pointsScreen = [];
    drawGrid(ctx);

    // Prepare points + centroid per layer (only for visible layers).
    const centroids = {};
    STATE.layers.forEach((layer) => {
      if (!STATE.visible[layer.datasetType]) return;
      const pts = layer.points || [];
      centroids[layer.datasetType] = computeCentroid(pts);
      drawPoints(ctx, pts, layer.datasetType);
    });

    Object.keys(centroids).forEach((k) => {
      const label = k === "nature" ? "Nature avg" : k === "posters" ? "Posters avg" : "Your avg";
      drawCentroid(ctx, centroids[k], k, label);
    });

    drawAxesLabels(ctx);
    drawLegend(ctx);
  }

  async function loadJson(url) {
    const res = await fetch(url);
    if (!res.ok) throw new Error("Failed to fetch " + url);
    return res.json();
  }

  async function buildDefaultLayersFromClimate(climateId, userPaletteHexes) {
    // Used only for a convenience mode in which caller provides climateId and palette hexes.
    // This is optional and can be replaced by passing explicit data arrays.
    const natureCandidates = [
      `data/results_${climateId}_nature_clean_superflat.json`,
      `data/results_${climateId}_nature_superflat.json`
    ];
    const postersUrl = `data/results_${climateId}_superflat.json`;

    let natureData = null;
    for (let i = 0; i < natureCandidates.length; i++) {
      try {
        natureData = await loadJson(natureCandidates[i]);
        break;
      } catch (e) {
        // keep trying fallbacks
      }
    }
    if (!Array.isArray(natureData)) natureData = [];

    let postersData = [];
    try {
      postersData = await loadJson(postersUrl);
    } catch (e) {
      postersData = [];
    }

    const naturePoints = natureData.map((raw) => normalizePoint(raw, "nature", climateId)).filter(Boolean);
    const posterPoints = postersData.map((raw) => normalizePoint(raw, "posters", climateId)).filter(Boolean);

    const userPoints = (userPaletteHexes || []).map((hex) => normalizePoint(hex, "user", climateId)).filter(Boolean);
    return { naturePoints, posterPoints, userPoints };
  }

  function init(containerIdOrEl, options) {
    const container = typeof containerIdOrEl === "string" ? document.getElementById(containerIdOrEl) : containerIdOrEl;
    if (!container) return null;

    const tooltipEl = options && options.tooltipEl ? options.tooltipEl : document.getElementById("results-bubble-tooltip");
    const controlsMount = options && options.controlsEl ? options.controlsEl : null;

    STATE.container = container;
    STATE.tooltipEl = tooltipEl || null;
    ensureCanvas(container);
    setupCanvas();

    STATE.layers = [];
    STATE.visible = { nature: true, posters: true, user: true };

    if (controlsMount) {
      STATE.controlsEl = buildControls(controlsMount);
    } else {
      // Create controls automatically above the graph container.
      const existing = container.parentElement && container.parentElement.querySelector(".layered-scatterplot__controls");
      if (!existing) {
        const host = document.createElement("div");
        host.className = "layered-scatterplot__controls";
        host.style.marginBottom = "0.75rem";
        container.parentElement.insertBefore(host, container);
        STATE.controlsEl = buildControls(host);
      }
    }

    // Parse layers (flexible).
    const climateId = options && options.climateId ? options.climateId : "";
    const natureRaw = (options && options.naturePoints) ? options.naturePoints : (options && options.nature) ? options.nature : [];
    const posterRaw = (options && options.posterPoints) ? options.posterPoints : (options && options.posters) ? options.posters : [];
    const userRaw = options && options.userPoints ? options.userPoints : (options && options.user) ? options.user : (options && options.userHexes) ? options.userHexes : [];

    const naturePoints = (Array.isArray(natureRaw) ? natureRaw : []).map((p) => normalizePoint(p, "nature", climateId)).filter(Boolean);
    const posterPoints = (Array.isArray(posterRaw) ? posterRaw : []).map((p) => normalizePoint(p, "posters", climateId)).filter(Boolean);
    const userPoints = (Array.isArray(userRaw) ? userRaw : []).map((p) => normalizePoint(p, "user", climateId)).filter(Boolean);

    STATE.layers = [
      { datasetType: "nature", points: naturePoints },
      { datasetType: "posters", points: posterPoints },
      { datasetType: "user", points: userPoints }
    ];

    // Mouse interaction.
    STATE.canvas.onmousemove = handleMouseMove;
    STATE.canvas.onmouseleave = handleMouseLeave;

    // Redraw on resize.
    window.addEventListener(
      "resize",
      () => {
        setupCanvas();
        render();
      },
      { passive: true }
    );

    render();
    return STATE;
  }

  async function renderLayeredScatter(containerIdOrEl, options) {
    // Convenience: if explicit layers are not passed, we can build them from climate + palette.
    // Otherwise, init() will parse provided arrays.
    if (options && !options.naturePoints && !options.nature && options.climateId && options.userHexes) {
      const built = await buildDefaultLayersFromClimate(options.climateId, options.userHexes);
      return init(containerIdOrEl, {
        ...options,
        naturePoints: built.naturePoints,
        posterPoints: built.posterPoints,
        userPoints: built.userPoints
      });
    }
    return init(containerIdOrEl, options || {});
  }

  window.LayeredScatterplot = {
    render: renderLayeredScatter,
    init
  };
})();

