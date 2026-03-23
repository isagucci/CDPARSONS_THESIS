(function () {
  // Color utilities are kept in a small module so that
  // swatch mixing and the scatterplot can share them.
  //
  // NOTE:
  // - User point is defined in `results.js`
  // - Cluster centers live in `swatchMixer.js`
  // - If you change color space behaviour, adjust blendInLab().

  function clamp01(v) {
    return Math.min(1, Math.max(0, v));
  }

  function hexToRgb(hex) {
    if (!hex) return null;
    let c = hex.replace("#", "").trim();
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

  function rgbToHex(r, g, b) {
    const toHex = (v) => {
      const n = Math.max(0, Math.min(255, Math.round(v)));
      const s = n.toString(16);
      return s.length === 1 ? "0" + s : s;
    };
    return ("#" + toHex(r) + toHex(g) + toHex(b)).toUpperCase();
  }

  /** Normalize any hex string for UI labels (always `#RRGGBB`, uppercase). */
  function formatHexDisplay(hex) {
    if (hex == null || hex === "") return "";
    const rgb = hexToRgb(hex);
    if (rgb) return rgbToHex(rgb.r, rgb.g, rgb.b);
    return String(hex).trim().toUpperCase();
  }

  function rgbToHsv(r, g, b) {
    r /= 255;
    g /= 255;
    b /= 255;
    const max = Math.max(r, g, b);
    const min = Math.min(r, g, b);
    const d = max - min;

    let h = 0;
    if (d !== 0) {
      if (max === r) {
        h = ((g - b) / d) % 6;
      } else if (max === g) {
        h = (b - r) / d + 2;
      } else {
        h = (r - g) / d + 4;
      }
      h *= 60;
      if (h < 0) h += 360;
    }

    const s = max === 0 ? 0 : d / max;
    const v = max;

    return {
      h,
      s: s * 100,
      v: v * 100
    };
  }

  function hsvToRgb(h, s, v) {
    s /= 100;
    v /= 100;

    const c = v * s;
    const x = c * (1 - Math.abs(((h / 60) % 2) - 1));
    const m = v - c;

    let r1 = 0;
    let g1 = 0;
    let b1 = 0;

    if (h >= 0 && h < 60) {
      r1 = c;
      g1 = x;
      b1 = 0;
    } else if (h >= 60 && h < 120) {
      r1 = x;
      g1 = c;
      b1 = 0;
    } else if (h >= 120 && h < 180) {
      r1 = 0;
      g1 = c;
      b1 = x;
    } else if (h >= 180 && h < 240) {
      r1 = 0;
      g1 = x;
      b1 = c;
    } else if (h >= 240 && h < 300) {
      r1 = x;
      g1 = 0;
      b1 = c;
    } else {
      r1 = c;
      g1 = 0;
      b1 = x;
    }

    const r = (r1 + m) * 255;
    const g = (g1 + m) * 255;
    const b = (b1 + m) * 255;

    return { r, g, b };
  }

  // sRGB <-> Lab helpers (approximate but good enough for palette mixing)
  function srgbToXyzChannel(c) {
    c /= 255;
    return c <= 0.04045
      ? c / 12.92
      : Math.pow((c + 0.055) / 1.055, 2.4);
  }

  function rgbToXyz(r, g, b) {
    const R = srgbToXyzChannel(r);
    const G = srgbToXyzChannel(g);
    const B = srgbToXyzChannel(b);

    const x = R * 0.4124 + G * 0.3576 + B * 0.1805;
    const y = R * 0.2126 + G * 0.7152 + B * 0.0722;
    const z = R * 0.0193 + G * 0.1192 + B * 0.9505;
    return { x, y, z };
  }

  function xyzToLab(x, y, z) {
    // D65 reference white
    const Xn = 0.95047;
    const Yn = 1.0;
    const Zn = 1.08883;

    const f = (t) => {
      const delta = 6 / 29;
      return t > Math.pow(delta, 3)
        ? Math.cbrt(t)
        : (t / (3 * Math.pow(delta, 2))) + (4 / 29);
    };

    const fx = f(x / Xn);
    const fy = f(y / Yn);
    const fz = f(z / Zn);

    const L = 116 * fy - 16;
    const a = 500 * (fx - fy);
    const b = 200 * (fy - fz);
    return { L, a, b };
  }

  function labToXyz(L, a, b) {
    const Yn = 1.0;
    const Xn = 0.95047;
    const Zn = 1.08883;

    const fy = (L + 16) / 116;
    const fx = a / 500 + fy;
    const fz = fy - b / 200;

    const fInv = (t) => {
      const delta = 6 / 29;
      return t > delta
        ? t * t * t
        : 3 * delta * delta * (t - 4 / 29);
    };

    const xr = fInv(fx);
    const yr = fInv(fy);
    const zr = fInv(fz);

    return {
      x: xr * Xn,
      y: yr * Yn,
      z: zr * Zn
    };
  }

  function xyzToRgb(x, y, z) {
    let R = x * 3.2406 + y * -1.5372 + z * -0.4986;
    let G = x * -0.9689 + y * 1.8758 + z * 0.0415;
    let B = x * 0.0557 + y * -0.2040 + z * 1.0570;

    const comp = (c) => {
      c = Math.max(0, Math.min(1, c));
      return c <= 0.0031308
        ? c * 12.92 * 255
        : (1.055 * Math.pow(c, 1 / 2.4) - 0.055) * 255;
    };

    return {
      r: comp(R),
      g: comp(G),
      b: comp(B)
    };
  }

  function hexToLab(hex) {
    const rgb = hexToRgb(hex);
    if (!rgb) return null;
    const xyz = rgbToXyz(rgb.r, rgb.g, rgb.b);
    return xyzToLab(xyz.x, xyz.y, xyz.z);
  }

  function labToHex(L, a, b) {
    const xyz = labToXyz(L, a, b);
    const rgb = xyzToRgb(xyz.x, xyz.y, xyz.z);
    return rgbToHex(rgb.r, rgb.g, rgb.b);
  }

  function blendInLab(samples) {
    if (!samples || samples.length === 0) return "#888888";
    let sumW = 0;
    let L = 0;
    let A = 0;
    let B = 0;

    samples.forEach(({ hex, weight }) => {
      const lab = hexToLab(hex);
      if (!lab) return;
      const w = weight != null ? weight : 1;
      sumW += w;
      L += lab.L * w;
      A += lab.a * w;
      B += lab.b * w;
    });

    if (sumW === 0) return formatHexDisplay(samples[0].hex);
    const Lm = L / sumW;
    const Am = A / sumW;
    const Bm = B / sumW;

    // soft clamp L to avoid extreme blacks/whites
    const Lc = 10 + clamp01((Lm - 10) / 90) * 80;
    return labToHex(Lc, Am, Bm);
  }

  window.ColorUtils = {
    hexToRgb,
    rgbToHex,
    formatHexDisplay,
    rgbToHsv,
    hsvToRgb,
    hexToLab,
    labToHex,
    blendInLab
  };
})();

