
function saturationBrightnessSketch(p) {
  let data;
  let bubbles = [];
  let tooltipEl = null;
  let tooltipImgEl = null;
  let canvasEl = null;

  function getMatchedClimateFromUrl() {
    try {
      const params = new URLSearchParams((window && window.location && window.location.search) || "");
      const c = (params.get("climate") || "tropical").toLowerCase();
      return ["tropical", "arid", "polar"].includes(c) ? c : "tropical";
    } catch (e) {
      return "tropical";
    }
  }

  p.preload = function () {
    const climateId = getMatchedClimateFromUrl();
    const url =
      climateId === "arid"
        ? "data/results_egypt_superflat.json"
        : climateId === "polar"
          ? "data/results_finland_superflat.json"
          : "data/results_brazil_superflat.json";
    data = p.loadJSON(url);
  };

  p.setup = function () {

    canvasEl = p.createCanvas(800, 600).canvas;
    p.noLoop();
    if (canvasEl && canvasEl.parentElement) {
      canvasEl.style.width = "100%";
      canvasEl.style.height = "100%";
      canvasEl.style.objectFit = "contain";
      tooltipEl = document.getElementById("results-bubble-tooltip");
      tooltipImgEl = tooltipEl ? tooltipEl.querySelector("img") : null;
    }
  };

  p.draw = function () {
    p.stroke(180);
    p.strokeWeight(1);

 
    p.line(50, p.height - 50, p.width - 50, p.height - 50);


    p.line(50, 50, 50, p.height - 50);
    bubbles = [];
    let points = Array.isArray(data) ? data : Object.values(data || {});
    for (let i = 0; i < points.length; i++) {
      let c = points[i];

      p.colorMode(p.RGB, 255);
      let col = p.color(c.r, c.g, c.b);

      let s = p.saturation(col);
      let b = p.brightness(col);

      let x = p.map(s, 0, 100, 50, p.width - 50);
      let y = p.map(b, 0, 100, p.height - 50, 50);
      let dotSize = p.map(c.percent, 0, 25, 4, 30);

      p.fill(c.r, c.g, c.b, 180);
      p.noStroke();
      p.circle(x, y, dotSize);
      const imgPath = c.poster_path ? "assets/" + c.poster_path : null;
      bubbles.push({
        x,
        y,
        r: dotSize / 2,
        imgUrl: imgPath
      });
    }

    const userPoint = typeof window !== "undefined" && window.__resultsUserPoint;
    const envPoint = typeof window !== "undefined" && window.__resultsEnvPoint;
    let ux, uy, ex, ey;

    if (userPoint && typeof userPoint.saturation === "number" && typeof userPoint.brightness === "number") {
      ux = p.map(userPoint.saturation * 100, 0, 100, 50, p.width - 50);
      uy = p.map(userPoint.brightness * 100, 0, 100, p.height - 50, 50);
    }

    if (envPoint && typeof envPoint.saturation === "number" && typeof envPoint.brightness === "number") {
      ex = p.map(envPoint.saturation * 100, 0, 100, 50, p.width - 50);
      ey = p.map(envPoint.brightness * 100, 0, 100, p.height - 50, 50);
    }

    // If both points are available, draw a connecting line to make the distance legible.
    if (ux != null && uy != null && ex != null && ey != null) {
      p.stroke(255, 255, 255, 170);
      p.strokeWeight(1);
      p.line(ux, uy, ex, ey);
    }

    // Draw the formative-environment centroid as a hollow marker.
    if (ex != null && ey != null) {
      p.stroke(255, 255, 255, 210);
      p.strokeWeight(1.5);
      p.noFill();
      p.rectMode(p.CENTER);
      p.rect(ex, ey, 14, 14, 3);
      p.fill(255);
      p.noStroke();
      p.textSize(9);
      p.text("Environment", ex + 10, ey - 6);
    }

    // Draw the user's point as a solid dot with label.
    if (ux != null && uy != null) {
      p.stroke(255, 255, 255);
      p.strokeWeight(1.5);
      p.noFill();
      p.circle(ux, uy, 16);
      p.fill(255, 255, 255);
      p.noStroke();
      p.circle(ux, uy, 6);
      p.fill(255);
      p.textSize(10);
      p.text("You", ux + 12, uy + 2);
    }

    p.fill(255);
    p.text("Saturation", p.width / 2, p.height - 10);

    p.push();
    p.translate(10, p.height / 2);
    p.rotate(-p.HALF_PI);
    p.text("Brightness", 0, 0);
    p.pop();
  };

  function updateTooltipAtPoint(mx, my) {
    if (!tooltipEl || !tooltipImgEl || !bubbles.length) return;
    let closest = null;
    let closestDist = Infinity;
    for (let i = 0; i < bubbles.length; i++) {
      const b = bubbles[i];
      const dx = mx - b.x;
      const dy = my - b.y;
      const d = Math.sqrt(dx * dx + dy * dy);
      if (d < b.r * 1.1 && d < closestDist) {
        closest = b;
        closestDist = d;
      }
    }
    if (!closest || !closest.imgUrl) {
      tooltipEl.dataset.visible = "false";
      tooltipEl.hidden = true;
      return;
    }
    const rect = canvasEl.getBoundingClientRect();
    const px = rect.left + window.scrollX + closest.x;
    const py = rect.top + window.scrollY + closest.y;
    tooltipEl.style.left = px + "px";
    tooltipEl.style.top = py + "px";
    tooltipImgEl.src = closest.imgUrl;
    tooltipEl.hidden = false;
    tooltipEl.dataset.visible = "true";
  }

  p.mouseMoved = function () {
    if (!canvasEl) return;
    if (!tooltipEl || !tooltipImgEl || !bubbles.length) {
      canvasEl.style.cursor = "default";
      return;
    }
    // Probe for any bubble under the cursor to set pointer vs default
    let over = false;
    for (let i = 0; i < bubbles.length; i++) {
      const b = bubbles[i];
      const dx = p.mouseX - b.x;
      const dy = p.mouseY - b.y;
      const d = Math.sqrt(dx * dx + dy * dy);
      if (d < b.r * 1.1) {
        over = true;
        break;
      }
    }
    canvasEl.style.cursor = over ? "pointer" : "default";
  };

  p.mousePressed = function () {
    updateTooltipAtPoint(p.mouseX, p.mouseY);
  };
}
