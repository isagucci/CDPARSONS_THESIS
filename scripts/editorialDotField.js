(function () {
  /**
   * EditorialDotField
   * -------------------
   * A disciplined, grid-ordered dot-field with three vertical panels:
   * - Nature (diffuse / atmospheric)
   * - Posters (edited selection)
   * - User preference (foregrounded)
   *
   * Canvas rendering (no random placement):
   * - x position is derived from saturation
   * - y position is derived from brightness/value
   * - points are quantized into grid cells; multiple points per cell are laid out
   *   in a deterministic micro-grid.
   *
   * Hover tooltip shows dataset + hex + sat/brightness + weight + metadata.
   */

  const STATE = {
    canvas: null,
    ctx: null,
    tooltipEl: null,
    container: null,
    controlsMount: null,
    bounds: null,
    visible: { nature: true, posters: true, user: true },
    dots: [], // hover index: [{ x,y,r, pt }]
    controlsEl: null,
    rafId: null,
    revealProgress: 1,
    revealDurationMs: 2400
  };

  /** Global visual scale for dots, type, and frame (larger results-page read). */
  const VIS = 1.48;

  const AXIS = { margin: Math.round(32 * VIS) };
  const DATASET_ORDER = ["nature", "posters", "user"];
  const LABELS = { nature: "Nature", posters: "Posters", user: "You" };

  function resolveUiFontFamily() {
    try {
      const root = getComputedStyle(document.documentElement);
      const h3Var = (root.getPropertyValue("--font-h3") || "").trim();
      const bodyVar = (root.getPropertyValue("--font-body") || "").trim();
      const bodyFamily = (getComputedStyle(document.body).fontFamily || "").trim();
      return h3Var || bodyVar || bodyFamily || "system-ui, -apple-system, BlinkMacSystemFont, 'SF Pro Text', 'Helvetica Neue', Arial, sans-serif";
    } catch (e) {
      return "system-ui, -apple-system, BlinkMacSystemFont, 'SF Pro Text', 'Helvetica Neue', Arial, sans-serif";
    }
  }

  function uiFont(sizePx, weight) {
    const family = resolveUiFontFamily();
    return `${weight || 500} ${sizePx}px ${family}`;
  }

  function clamp(v, min, max) {
    return Math.min(max, Math.max(min, v));
  }

  function easeOutCubic(t) {
    const x = clamp(t, 0, 1);
    return 1 - Math.pow(1 - x, 3);
  }

  function hexToRgb(hex) {
    if (!hex) return null;
    let c = String(hex).replace("#", "").trim();
    if (c.length === 3) c = c.split("").map((ch) => ch + ch).join("");
    if (c.length !== 6) return null;
    const num = parseInt(c, 16);
    return { r: (num >> 16) & 255, g: (num >> 8) & 255, b: num & 255 };
  }

  function rgbToSatVal01(r, g, b) {
    if (window.ColorUtils && typeof window.ColorUtils.rgbToHsv === "function") {
      // ColorUtils.rgbToHsv returns s and v in 0–100.
      const hsv = window.ColorUtils.rgbToHsv(r, g, b);
      return { sat01: clamp(hsv.s / 100, 0, 1), val01: clamp(hsv.v / 100, 0, 1) };
    }
    return null;
  }

  function hexToSatVal01(hex) {
    const rgb = hexToRgb(hex);
    if (!rgb) return null;
    return rgbToSatVal01(rgb.r, rgb.g, rgb.b);
  }

  function toFixedPct01(n01) {
    return Math.round(clamp(n01, 0, 1) * 100);
  }

  function rgbaFromHex(hex, alpha) {
    const rgb = hexToRgb(hex);
    if (!rgb) return `rgba(136,136,136,${alpha})`;
    return `rgba(${rgb.r}, ${rgb.g}, ${rgb.b}, ${alpha})`;
  }

  function normalizeRawPoints(datasetType, rawPoints, fallbackClimateLabel) {
    const out = [];
    if (!Array.isArray(rawPoints)) return out;

    rawPoints.forEach((raw, idx) => {
      if (!raw) return;

      // user can be passed as strings or objects
      if (datasetType === "user" && typeof raw === "string") {
        const hex = raw;
        const sv = hexToSatVal01(hex);
        if (!sv) return;
        out.push({
          datasetType,
          hex: String(hex).toLowerCase(),
          saturation01: sv.sat01,
          brightness01: sv.val01,
          weight: 6 - (idx % 6), // dominance rank fallback
          climate: fallbackClimateLabel || "",
          category: "",
          source: "User selection"
        });
        return;
      }

      if (datasetType === "user" && typeof raw === "object" && raw.hex) {
        const hex = raw.hex;

        // Allow callers to provide explicit saturation/brightness (e.g. to create
        // a deterministic cluster around a palette swatch) while keeping the same hex.
        let sat01 =
          typeof raw.saturation01 === "number"
            ? raw.saturation01
            : typeof raw.sat01 === "number"
              ? raw.sat01
              : null;
        let val01 =
          typeof raw.brightness01 === "number"
            ? raw.brightness01
            : typeof raw.val01 === "number"
              ? raw.val01
              : null;

        // If provided as percents, convert to 0–1.
        if (sat01 != null && sat01 > 1) sat01 = sat01 / 100;
        if (val01 != null && val01 > 1) val01 = val01 / 100;

        const sv = sat01 != null && val01 != null ? { sat01, val01 } : hexToSatVal01(hex);
        if (!sv) return;

        out.push({
          datasetType,
          hex: String(hex).toLowerCase(),
          saturation01: clamp(sv.sat01, 0, 1),
          brightness01: clamp(sv.val01, 0, 1),
          weight: typeof raw.weight === "number" ? raw.weight : 1,
          climate: fallbackClimateLabel || raw.climate || "",
          category: raw.category || "",
          source: raw.source || "User selection"
        });
        return;
      }

      // nature/posters: raw has hex + rgb + percent
      const hex = raw.hex || raw.color_hex || raw.color || "";
      if (!hex) return;

      const r = raw.r;
      const g = raw.g;
      const b = raw.b;
      if (r == null || g == null || b == null) return;

      const sv = rgbToSatVal01(r, g, b);
      if (!sv) return;

      const percent = typeof raw.percent === "number" ? raw.percent : typeof raw.weight === "number" ? raw.weight : 1;

      out.push({
        datasetType,
        hex: String(hex).toLowerCase(),
        saturation01: sv.sat01,
        brightness01: sv.val01,
        weight: percent,
        climate: raw.climate || fallbackClimateLabel || "",
        category: raw.category || raw.object_association || "",
        source: raw.poster_file || raw.poster_path || ""
      });
    });

    return out;
  }

  function computeWeightedCentroid(points) {
    const valid = Array.isArray(points) ? points : [];
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
    if (STATE.canvas && STATE.canvas.parentElement === container) return STATE.canvas;
    if (STATE.canvas && STATE.canvas.parentElement) STATE.canvas.remove();

    const canvas = document.createElement("canvas");
    canvas.setAttribute("aria-label", "Editorial dot-field scatterplot");
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

    // Keep the internal canvas crisp.
    STATE.canvas.style.width = rect.width + "px";
    STATE.canvas.style.height = rect.height + "px";
    STATE.canvas.width = Math.max(1, Math.floor(rect.width * dpr));
    STATE.canvas.height = Math.max(1, Math.floor(rect.height * dpr));

    STATE.bounds = {
      rect,
      dpr,
      width: STATE.canvas.width,
      height: STATE.canvas.height
    };
  }

  function panelGeometry() {
    const { width, height } = STATE.bounds;
    const { margin } = AXIS;
    const plotX0 = margin;
    const plotY0 = margin;
    const plotX1 = width - margin;
    const plotY1 = height - margin;

    const plotW = plotX1 - plotX0;
    const plotH = plotY1 - plotY0;
    const panelW = plotW / 3;

    return { plotX0, plotY0, plotX1, plotY1, plotW, plotH, panelW };
  }

  function layerStyle(datasetType) {
    // These control atmospheric vs foreground priorities.
    if (datasetType === "nature") {
      return {
        // Avoid fading points via opacity; hierarchy comes from size + edge.
        alpha: 1,
        strokeAlpha: 0.18,
        baseRadius: 4.2 * VIS,
        radiusScale: 6.8 * VIS,
        glow: false
      };
    }
    if (datasetType === "posters") {
      return {
        alpha: 1,
        strokeAlpha: 0.42,
        baseRadius: 5.4 * VIS,
        radiusScale: 8.6 * VIS,
        glow: false
      };
    }
    // user
    return {
      alpha: 1,
      strokeAlpha: 0.72,
      baseRadius: 7.2 * VIS,
      radiusScale: 11.8 * VIS,
      glow: true
    };
  }

  function drawBackdrop(ctx) {
    const { width, height } = STATE.bounds;
    ctx.clearRect(0, 0, width, height);

    // Soft atmospheric gradient.
    const g = ctx.createLinearGradient(0, 0, 0, height);
    g.addColorStop(0, "rgba(255,255,255,0.06)");
    g.addColorStop(1, "rgba(0,0,0,0.00)");
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, width, height);

    // Frame.
    const { plotX0, plotY0, plotW, plotH } = panelGeometry();
    ctx.strokeStyle = "rgba(255,255,255,0.22)";
    ctx.lineWidth = 1.2 * VIS;
    ctx.strokeRect(plotX0, plotY0, plotW, plotH);

    // Panel separators.
    ctx.strokeStyle = "rgba(255,255,255,0.13)";
    for (let i = 1; i <= 2; i++) {
      const x = plotX0 + i * (plotW / 3);
      ctx.beginPath();
      ctx.moveTo(x, plotY0);
      ctx.lineTo(x, plotY0 + plotH);
      ctx.stroke();
    }
  }

  function drawAxesLabels(ctx) {
    const { plotX0, plotY1, plotW, plotH } = panelGeometry();
    const { margin } = AXIS;

    ctx.save();
    // Match page text hierarchy (body/H3 family and medium weight).
    ctx.font = uiFont(Math.round(15 * VIS), 500);
    ctx.fillStyle = "rgba(255,255,255,0.78)";
    ctx.textAlign = "left";
    ctx.textBaseline = "bottom";
    ctx.fillText("brightness", plotX0 + Math.round(6 * VIS), plotY1 - Math.round(2 * VIS));

    ctx.textAlign = "right";
    ctx.textBaseline = "bottom";
    ctx.fillText("saturation", plotX0 + plotW - Math.round(6 * VIS), plotY1 - margin + Math.round(18 * VIS));

    ctx.restore();
  }

  function drawAxisUnitTicks(ctx) {
    const { plotX0, plotY0, plotY1, plotW, plotH, panelW } = panelGeometry();
    // Include 0 so the full axis scale is labeled (0/50/100).
    const tickVals = [0, 50, 100];
    const tickLen = Math.round(5 * VIS);

    ctx.save();
    ctx.strokeStyle = "rgba(255,255,255,0.35)";
    ctx.fillStyle = "rgba(255,255,255,0.62)";
    ctx.lineWidth = Math.max(1, 1 * VIS);
    ctx.font = uiFont(Math.round(11 * VIS), 500);

    // Y axis (brightness/value): 0 at bottom, 100 at top.
    ctx.textAlign = "left";
    ctx.textBaseline = "middle";
    tickVals.forEach((v) => {
      const t = v / 100;
      const y = plotY1 - t * plotH;
      ctx.beginPath();
      ctx.moveTo(plotX0, y);
      ctx.lineTo(plotX0 + tickLen, y);
      ctx.stroke();
      // Nudge the 0 label up a bit to avoid bottom edge clipping.
      const yLabel = v === 0 ? y - Math.round(3 * VIS) : y;
      ctx.fillText(String(v), plotX0 + Math.round(6 * VIS), yLabel);
    });

    // X axis (saturation): draw per panel so each panel has its own 50/100 scale.
    ctx.textAlign = "center";
    ctx.textBaseline = "top";
    DATASET_ORDER.forEach((_, panelIndex) => {
      const panelX0 = plotX0 + panelIndex * panelW;
      tickVals.forEach((v) => {
        const t = v / 100;
        const x = panelX0 + t * panelW;
        ctx.beginPath();
        ctx.moveTo(x, plotY1);
        ctx.lineTo(x, plotY1 + tickLen);
        ctx.stroke();
        ctx.fillText(String(v), x, plotY1 + tickLen + Math.round(3 * VIS));
      });
    });

    ctx.restore();
  }

  function drawDatasetLabels(ctx) {
    const { plotX0, plotY0, panelW } = panelGeometry();
    ctx.save();
    // Primary in-chart headings: closest to on-page H3 hierarchy.
    ctx.font = uiFont(Math.round(18 * VIS), 600);
    ctx.fillStyle = "rgba(255,255,255,0.80)";
    ctx.textAlign = "left";
    ctx.textBaseline = "top";

    DATASET_ORDER.forEach((datasetType, i) => {
      const x = plotX0 + i * panelW + Math.round(6 * VIS);
      const y = plotY0 - Math.round(28 * VIS);
      const labelAlpha = STATE.visible[datasetType] ? 1 : 0.4;
      ctx.globalAlpha = labelAlpha;
      ctx.fillText(LABELS[datasetType], x, y);
      ctx.globalAlpha = 1;
    });
    ctx.restore();
  }

  function drawCentroid(ctx, centroid, datasetType, extraLabel) {
    if (!centroid) return;
    if (!STATE.visible[datasetType]) return;

    const { plotX0, plotY0, plotH, panelW } = panelGeometry();
    const i = DATASET_ORDER.indexOf(datasetType);
    if (i < 0) return;

    const x = plotX0 + i * panelW + centroid.saturation01 * panelW;
    const y = plotY0 + (1 - centroid.brightness01) * plotH;

    ctx.save();
    const st = layerStyle(datasetType);
    ctx.strokeStyle = st.glow ? "rgba(255,255,255,0.95)" : "rgba(255,255,255,0.62)";
    ctx.lineWidth = datasetType === "user" ? 2.4 * VIS : 1.6 * VIS;

    const arm = Math.round(12 * VIS);
    // crosshair
    ctx.beginPath();
    ctx.moveTo(x - arm, y);
    ctx.lineTo(x + arm, y);
    ctx.moveTo(x, y - arm);
    ctx.lineTo(x, y + arm);
    ctx.stroke();

    if (extraLabel) {
      ctx.font = uiFont(Math.round(14 * VIS), 500);
      ctx.fillStyle = "rgba(255,255,255,0.78)";
      ctx.textAlign = "left";
      ctx.textBaseline = "middle";
      ctx.fillText(extraLabel, x + Math.round(14 * VIS), y);
    }

    ctx.restore();
  }

  function structuredPlacement(points, datasetType, { xBins, yBins }) {
    const { plotX0, plotY0, plotH, panelW } = panelGeometry();
    const panelIndex = DATASET_ORDER.indexOf(datasetType);
    const panelX0 = plotX0 + panelIndex * panelW;

    // Place points into grid cells.
    const cellMap = new Map();
    points.forEach((pt, idx) => {
      const xBin = clamp(Math.round(pt.saturation01 * (xBins - 1)), 0, xBins - 1);
      const yBin = clamp(Math.round(pt.brightness01 * (yBins - 1)), 0, yBins - 1);
      const key = `${xBin},${yBin}`;
      if (!cellMap.has(key)) cellMap.set(key, []);
      cellMap.get(key).push({ pt, idx, xBin, yBin });
    });

    // Deterministic sorting inside each cell.
    cellMap.forEach((arr) => {
      arr.sort((a, b) => {
        const wdiff = (b.pt.weight || 0) - (a.pt.weight || 0);
        if (Math.abs(wdiff) > 1e-6) return wdiff;
        const ad = String(a.pt.hex || "");
        const bd = String(b.pt.hex || "");
        return ad < bd ? -1 : ad > bd ? 1 : a.idx - b.idx;
      });
    });

    const { margin } = AXIS;
    const cellW = panelW / xBins;
    const cellH = plotH / yBins;

    // Weight normalization for dot radius.
    const maxW = points.reduce((m, pt) => Math.max(m, pt.weight || 0), 0) || 1;
    const st = layerStyle(datasetType);

    // More slots per cell to keep larger dots from over-colliding.
    const cols = 5;
    const rows = 5;
    const maxOffsets = cols * rows;
    const offsetAmpX = 0.34 * cellW;
    const offsetAmpY = 0.34 * cellH;

    const dots = [];

    cellMap.forEach((arr, key) => {
      const [xBinStr, yBinStr] = key.split(",");
      const xBin = Number(xBinStr);
      const yBin = Number(yBinStr);

      // Cell center (brightness increases upward, but our y maps downward).
      const cellCX = panelX0 + (xBin + 0.5) * cellW;
      const cellCY = plotY0 + (yBins - (yBin + 0.5)) * cellH;

      arr.forEach((entry, i) => {
        const pt = entry.pt;
        const wNorm = clamp((pt.weight || 0) / maxW, 0, 1);
        const r = st.baseRadius + wNorm * st.radiusScale;

        const slot = i % maxOffsets;
        const ox = (slot % cols) - (cols - 1) / 2;
        const oy = Math.floor(slot / cols) - (rows - 1) / 2;

        const pad = Math.max(4, Math.round(3 * VIS));
        const x = clamp(cellCX + ox * offsetAmpX, panelX0 + pad, panelX0 + panelW - pad);
        const y = clamp(cellCY + oy * offsetAmpY, plotY0 + pad, plotY0 + plotH - pad);

        dots.push({ pt, x, y, r, datasetType });
      });
    });

    return dots;
  }

  function drawDots(ctx, dots, datasetType, revealProgress) {
    if (!dots || !dots.length) return;
    const st = layerStyle(datasetType);
    if (!STATE.visible[datasetType]) return;
    const eased = easeOutCubic(revealProgress == null ? 1 : revealProgress);
    const { panelW } = panelGeometry();
    const panelShift = panelW * 0.3;

    const layerDelay =
      datasetType === "nature" ? 0 :
      datasetType === "posters" ? 0.14 :
      0.3; // user layer enters last

    dots.forEach((d, idx) => {
      const pt = d.pt;
      // Slight per-dot stagger so entry feels organic but still deterministic.
      const stagger = Math.min(0.42, layerDelay + idx * 0.0036);
      const localP = easeOutCubic(clamp((eased - stagger) / (1 - stagger), 0, 1));
      const x = d.x + (1 - localP) * panelShift;
      const y = d.y;
      ctx.save();

      ctx.globalAlpha = st.alpha * localP;
      if (st.glow) {
        const rgb = hexToRgb(pt.hex) || { r: 255, g: 255, b: 255 };
        ctx.shadowColor = `rgba(${rgb.r},${rgb.g},${rgb.b},0.45)`;
        ctx.shadowBlur = Math.round(12 * VIS);
      } else {
        ctx.shadowBlur = 0;
      }

      // fill
      ctx.fillStyle = rgbaFromHex(pt.hex, 1);

      // edge
      if (st.strokeAlpha > 0) {
        ctx.strokeStyle = rgbaFromHex(pt.hex, st.strokeAlpha);
        ctx.lineWidth = datasetType === "user" ? 2.4 * VIS : 1.6 * VIS;
      } else {
        ctx.strokeStyle = "transparent";
        ctx.lineWidth = 0;
      }

      ctx.beginPath();
      ctx.arc(x, y, d.r, 0, Math.PI * 2);
      ctx.fill();
      if (st.strokeAlpha > 0) ctx.stroke();

      // user highlight
      if (datasetType === "user") {
        ctx.shadowBlur = 0;
        ctx.fillStyle = "rgba(255,255,255,1)";
        ctx.beginPath();
        ctx.arc(x, y, Math.max(1.2 * VIS, d.r * 0.32), 0, Math.PI * 2);
        ctx.fill();
      }

      d._ax = x;
      d._ay = y;
      ctx.restore();
    });
  }

  function draw(ctx, datasets) {
    STATE.dots = [];

    drawBackdrop(ctx);
    drawAxisUnitTicks(ctx);
    drawAxesLabels(ctx);
    drawDatasetLabels(ctx);

    // Slightly coarser grid so scaled-up dots keep clearance.
    const xBins = 18;
    const yBins = 13;

    DATASET_ORDER.forEach((datasetType) => {
      if (!STATE.visible[datasetType]) return;
      const pts = datasets[datasetType] || [];
      const centroid = computeWeightedCentroid(pts);

      const dots = structuredPlacement(pts, datasetType, { xBins, yBins });
      drawDots(ctx, dots, datasetType, STATE.revealProgress);
      STATE.dots.push(...dots.map((d) => ({ ...d, x: d._ax || d.x, y: d._ay || d.y })));
      if ((STATE.revealProgress || 1) > 0.55) {
        drawCentroid(ctx, centroid, datasetType, datasetType === "user" ? "Avg user" : undefined);
      }
    });
  }

  function tooltipHtml(pt) {
    const satPct = toFixedPct01(pt.saturation01);
    const valPct = toFixedPct01(pt.brightness01);
    const w = typeof pt.weight === "number" ? pt.weight : 1;
    const hexDisplay =
      window.ColorUtils && typeof window.ColorUtils.formatHexDisplay === "function"
        ? window.ColorUtils.formatHexDisplay(pt.hex)
        : String(pt.hex || "").toUpperCase();

    const meta = [];
    if (pt.climate) meta.push(pt.climate);
    if (pt.category) meta.push(pt.category);
    const metaLine = meta.length ? meta.join(" • ") : "";

    return `
      <div style="padding: 0.85rem 1rem; max-width: 300px;">
        <div style="font-size: 0.82rem; letter-spacing: 0.14em; text-transform: uppercase; opacity: 0.78; margin-bottom: 0.28rem;">
          ${LABELS[pt.datasetType] || pt.datasetType}
        </div>
        <div style="font-size: 1.05rem; font-weight: 650; margin-bottom: 0.22rem;">
          <span style="font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, 'Liberation Mono', 'Courier New', monospace;">${hexDisplay}</span>
        </div>
        <div style="opacity: 0.88; font-size: 0.88rem; line-height: 1.35;">
          Sat: ${satPct}% • Brightness: ${valPct}% • Weight: ${Math.round(w)}%
        </div>
        ${metaLine ? `<div style="opacity: 0.7; font-size: 0.86rem; margin-top: 0.28rem;">${metaLine}</div>` : ""}
        ${pt.source ? `<div style="opacity: 0.66; font-size: 0.84rem; margin-top: 0.28rem;">Source: ${pt.source}</div>` : ""}
      </div>
    `;
  }

  function handleMouseMove(event) {
    if (!STATE.tooltipEl || !STATE.bounds) return;
    const { rect, dpr, width, height } = STATE.bounds;
    const mx = (event.clientX - rect.left) * dpr;
    const my = (event.clientY - rect.top) * dpr;

    let closest = null;
    let closestD = Infinity;

    // linear search: dot count is small enough for top-N datasets.
    for (let i = 0; i < STATE.dots.length; i++) {
      const d = STATE.dots[i];
      const dx = mx - d.x;
      const dy = my - d.y;
      const dist = Math.sqrt(dx * dx + dy * dy);
      const limit = d.r * 1.35;
      if (dist <= limit && dist < closestD) {
        closestD = dist;
        closest = d;
      }
    }

    if (!closest) {
      STATE.tooltipEl.dataset.visible = "false";
      STATE.tooltipEl.hidden = true;
      return;
    }

    STATE.tooltipEl.hidden = false;
    STATE.tooltipEl.dataset.visible = "true";

    // Replace tooltip content (results CSS expects img; we render text instead).
    STATE.tooltipEl.innerHTML = tooltipHtml(closest.pt);
    STATE.tooltipEl.style.left = event.clientX + "px";
    STATE.tooltipEl.style.top = event.clientY + "px";
  }

  function handleMouseLeave() {
    if (!STATE.tooltipEl) return;
    STATE.tooltipEl.dataset.visible = "false";
    STATE.tooltipEl.hidden = true;
  }

  function buildControls(controlsContainer) {
    const mount = controlsContainer;
    if (!mount) return null;

    mount.innerHTML = "";
    mount.className = "layered-scatterplot__controls";
    mount.style.marginBottom = "0.75rem";
    mount.style.userSelect = "none";
    mount.style.display = "flex";
    mount.style.flexWrap = "wrap";
    mount.style.gap = "0.9rem";
    mount.style.alignItems = "center";

    const mk = (key, label) => {
      const id = `dotfield-${key}-${Math.random().toString(16).slice(2)}`;
      const wrap = document.createElement("label");
      wrap.style.display = "inline-flex";
      wrap.style.alignItems = "center";
      wrap.style.gap = "0.55rem";
      wrap.style.cursor = "pointer";
      wrap.style.fontSize = "0.78rem";
      wrap.style.opacity = STATE.visible[key] ? "0.95" : "0.65";

      const cb = document.createElement("input");
      cb.type = "checkbox";
      cb.id = id;
      cb.checked = !!STATE.visible[key];
      cb.style.margin = "0";

      cb.addEventListener("change", () => {
        STATE.visible[key] = cb.checked;
        wrap.style.opacity = cb.checked ? "0.95" : "0.65";
        render();
      });

      const text = document.createElement("span");
      text.textContent = label;
      wrap.appendChild(cb);
      wrap.appendChild(text);
      return wrap;
    };

    const c1 = mk("nature", "Nature");
    const c2 = mk("posters", "Posters");
    const c3 = mk("user", "User");
    mount.appendChild(c1);
    mount.appendChild(c2);
    mount.appendChild(c3);
    return mount;
  }

  let lastDatasets = null;
  function render() {
    if (!STATE.ctx || !STATE.bounds || !lastDatasets) return;
    draw(STATE.ctx, lastDatasets);
  }

  function playRevealAnimation() {
    if (STATE.rafId) {
      cancelAnimationFrame(STATE.rafId);
      STATE.rafId = null;
    }
    const start = performance.now();
    STATE.revealProgress = 0;

    const step = (ts) => {
      const t = (ts - start) / STATE.revealDurationMs;
      STATE.revealProgress = clamp(t, 0, 1);
      render();
      if (t < 1) {
        STATE.rafId = requestAnimationFrame(step);
      } else {
        STATE.revealProgress = 1;
        STATE.rafId = null;
        render();
      }
    };
    STATE.rafId = requestAnimationFrame(step);
  }

  async function renderDotField(containerIdOrEl, options) {
    const container =
      typeof containerIdOrEl === "string" ? document.getElementById(containerIdOrEl) : containerIdOrEl;
    if (!container) return null;

    STATE.container = container;
    STATE.tooltipEl = options && options.tooltipEl ? options.tooltipEl : null;

    ensureCanvas(container);
    setupCanvas();

    STATE.canvas.onmousemove = handleMouseMove;
    STATE.canvas.onmouseleave = handleMouseLeave;

    // No layer toggles: always show all three datasets for direct comparison.
    STATE.visible = { nature: true, posters: true, user: true };

    const climateLabel = options && options.climateLabel ? options.climateLabel : "";

    const natureRaw = options ? options.naturePoints || options.nature || [] : [];
    const postersRaw = options ? options.posterPoints || options.posters || [] : [];
    const userRaw = options ? options.userPoints || options.user || options.userPalette || [] : [];

    const nature = normalizeRawPoints("nature", natureRaw, climateLabel);
    const posters = normalizeRawPoints("posters", postersRaw, climateLabel);

    // user palette weights can be passed as [{hex, weight}] or as hex strings.
    const user = normalizeRawPoints("user", userRaw, climateLabel);

    lastDatasets = { nature, posters, user };
    playRevealAnimation();

    // resize
    window.addEventListener("resize", () => {
      setupCanvas();
      render();
    });

    return STATE;
  }

  window.EditorialDotField = {
    render: renderDotField
  };
})();

