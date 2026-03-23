(function () {
  // Custom canvas scatterplot for the results view.
  //
  // Responsibilities:
  // - Render three climate clusters as soft bubbles
  // - Render user point as a dark contrasting dot with label
  // - Animate points on load (fade + slight rise)
  // - Provide hover tooltip for nearby cluster points
  //
  // Inputs (provided by climateData.js):
  // - climatePoints: [{ climateId, hex, saturation, brightness, weight }]
  //   (FULL DATASET FOR SCATTERPLOT)
  // - centroids: { tropical: { saturation, brightness, ... }, arid: ..., polar: ... }
  // - userPoint: { saturation, brightness }

  const STATE = {
    canvas: null,
    ctx: null,
    tooltipEl: null,
    points: [],
    userPoint: null,
    animationStart: null,
    rafId: null,
    bounds: null,
    centroids: null
  };

  const CLIMATE_LABELS = {
    tropical: "Tropical cluster",
    arid: "Arid cluster",
    polar: "Polar cluster"
  };

  function setupCanvas() {
    if (!STATE.canvas) return;
    const rect = STATE.canvas.getBoundingClientRect();
    const dpr = window.devicePixelRatio || 1;
    const width = rect.width * dpr;
    const height = rect.height * dpr;
    STATE.canvas.width = width;
    STATE.canvas.height = height;
    STATE.bounds = { width, height, dpr, rect };
  }

  function mapSaturation(s) {
    const { width } = STATE.bounds;
    const margin = 56;
    return margin + s * (width - margin * 2);
  }

  function mapBrightness(b) {
    const { height } = STATE.bounds;
    const margin = 56;
    // higher brightness near the top
    return height - (margin + b * (height - margin * 2));
  }

  function preparePoints(climatePoints, userPoint, centroids) {
    const basePoints = climatePoints && climatePoints.length ? climatePoints : [];

    const points = basePoints.map((pt) => {
      const baseRadius =
        pt.weight != null
          ? 8 + Math.min(24, pt.weight * 0.6)
          : 16;
      return {
        ...pt,
        x: pt.saturation,
        y: pt.brightness,
        radius: baseRadius,
        animOffset: Math.random() * 0.4
      };
    });

    STATE.points = points;
    STATE.userPoint = userPoint || null;
    STATE.centroids = centroids || null;
    STATE.animationStart = null;
  }

  function drawBackground(ctx) {
    const { width, height } = STATE.bounds;
    ctx.clearRect(0, 0, width, height);

    const gradient = ctx.createLinearGradient(0, 0, 0, height);
    gradient.addColorStop(0, "rgba(255, 255, 255, 0.08)");
    gradient.addColorStop(1, "rgba(0, 0, 0, 0)");
    ctx.fillStyle = gradient;
    ctx.fillRect(0, 0, width, height);

    ctx.save();
    ctx.strokeStyle = "rgba(255, 255, 255, 0.32)";
    ctx.lineWidth = 0.8;
    const margin = 56;
    ctx.beginPath();
    ctx.moveTo(margin, height - margin);
    ctx.lineTo(width - margin, height - margin);
    ctx.moveTo(margin, margin);
    ctx.lineTo(margin, height - margin);
    ctx.stroke();
    ctx.restore();
  }

  function drawClimatePoints(ctx, now) {
    const { width, height } = STATE.bounds;
    const margin = 56;
    const elapsed = STATE.animationStart ? (now - STATE.animationStart) / 1000 : 0;

    ctx.save();
    ctx.translate(0, 0);

    STATE.points.forEach((pt) => {
      const progress = Math.min(1, Math.max(0, elapsed - pt.animOffset));
      const eased = 1 - Math.pow(1 - progress, 3);

      const sx = mapSaturation(pt.x);
      const syBase = mapBrightness(pt.y);
      const sy = syBase + (1 - eased) * 14;

      const radius = pt.radius * (0.5 + eased * 0.7);

      ctx.beginPath();
      ctx.fillStyle = "rgba(255, 255, 255, 0.42)";
      ctx.strokeStyle = "rgba(255, 255, 255, 0.55)";
      ctx.lineWidth = 0.5;
      ctx.globalAlpha = 0.35 + eased * 0.6;
      ctx.arc(sx, sy, radius, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
    });

    ctx.restore();

    ctx.save();
    ctx.globalAlpha = 0.85;
    ctx.fillStyle = "rgba(255, 255, 255, 0.82)";
    ctx.font = "10px system-ui, -apple-system, BlinkMacSystemFont, 'SF Pro Text', 'Helvetica Neue', Arial, sans-serif";
    ctx.textAlign = "left";
    ctx.textBaseline = "bottom";
    ctx.fillText("climate fields", margin + 8, height - margin - 8);
    ctx.restore();
  }

  function drawUserPoint(ctx) {
    if (!STATE.userPoint) return;
    const { saturation, brightness } = STATE.userPoint;
    const x = mapSaturation(saturation);
    const y = mapBrightness(brightness);

    ctx.save();
    ctx.globalAlpha = 1;

    ctx.beginPath();
    ctx.strokeStyle = "rgba(0, 0, 0, 0.84)";
    ctx.lineWidth = 1.4;
    ctx.arc(x, y, 13, 0, Math.PI * 2);
    ctx.stroke();

    ctx.beginPath();
    ctx.fillStyle = "rgba(12, 16, 20, 0.95)";
    ctx.arc(x, y, 5, 0, Math.PI * 2);
    ctx.fill();

    ctx.font = "10px system-ui, -apple-system, BlinkMacSystemFont, 'SF Pro Text', 'Helvetica Neue', Arial, sans-serif";
    ctx.fillStyle = "rgba(12, 16, 20, 0.9)";
    ctx.textAlign = "left";
    ctx.textBaseline = "middle";
    ctx.fillText("You are here", x + 10, y);
    ctx.restore();
  }

  function drawAxesLabels(ctx) {
    const { width, height } = STATE.bounds;
    const margin = 56;
    ctx.save();
    ctx.font = "11px system-ui, -apple-system, BlinkMacSystemFont, 'SF Pro Text', 'Helvetica Neue', Arial, sans-serif";
    ctx.fillStyle = "rgba(255, 255, 255, 0.82)";
    ctx.textAlign = "right";
    ctx.textBaseline = "bottom";
    ctx.fillText("brightness", margin - 10, margin + 4);

    ctx.textAlign = "right";
    ctx.textBaseline = "bottom";
    ctx.fillText("saturation", width - margin + 6, height - margin + 18);
    ctx.restore();
  }

  function renderFrame(now) {
    if (!STATE.ctx || !STATE.bounds) return;
    if (!STATE.animationStart) STATE.animationStart = now;

    drawBackground(STATE.ctx);
    drawClimatePoints(STATE.ctx, now);
    drawUserPoint(STATE.ctx);
    drawAxesLabels(STATE.ctx);

    STATE.rafId = window.requestAnimationFrame(renderFrame);
  }

  function handleMouseMove(event) {
    if (!STATE.bounds || !STATE.tooltipEl) return;
    const { rect, dpr } = STATE.bounds;
    const x = (event.clientX - rect.left) * dpr;
    const y = (event.clientY - rect.top) * dpr;

    let closest = null;
    let closestDist = Infinity;
    STATE.points.forEach((pt) => {
      const sx = mapSaturation(pt.x);
      const sy = mapBrightness(pt.y);
      const dx = sx - x;
      const dy = sy - y;
      const dist = Math.sqrt(dx * dx + dy * dy);
      if (dist < closestDist && dist < pt.radius * 2.2 * dpr) {
        closest = pt;
        closestDist = dist;
      }
    });

    if (!closest) {
      STATE.tooltipEl.dataset.visible = "false";
      return;
    }

    const humanClimateLabel =
      closest.label || CLIMATE_LABELS[closest.climateId] || "Climate cluster";

    STATE.tooltipEl.textContent = humanClimateLabel;
    STATE.tooltipEl.style.left = event.clientX + "px";
    STATE.tooltipEl.style.top = event.clientY + "px";
    STATE.tooltipEl.dataset.visible = "true";
  }

  function handleMouseLeave() {
    if (!STATE.tooltipEl) return;
    STATE.tooltipEl.dataset.visible = "false";
  }

  function initScatterplot(canvas, tooltipEl, options) {
    if (!canvas) return;
    STATE.canvas = canvas;
    STATE.ctx = canvas.getContext("2d");
    STATE.tooltipEl = tooltipEl || null;

    preparePoints(
      (options && options.climatePoints) || [],
      (options && options.userPoint) || null,
      (options && options.centroids) || null
    );

    setupCanvas();
    if (STATE.rafId) window.cancelAnimationFrame(STATE.rafId);
    STATE.rafId = window.requestAnimationFrame(renderFrame);

    canvas.addEventListener("mousemove", handleMouseMove);
    canvas.addEventListener("mouseleave", handleMouseLeave);

    window.addEventListener("resize", () => {
      setupCanvas();
    });
  }

  function refreshLayout(userPoint) {
    if (userPoint) {
      STATE.userPoint = userPoint;
    }
    if (!STATE.canvas) return;
    setupCanvas();
  }

  window.ScatterplotModule = {
    initScatterplot,
    refreshLayout
  };
})();

