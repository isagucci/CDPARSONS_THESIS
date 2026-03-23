// Minimal SwatchMixer: blends climate palette colors by user weights
// and returns swatches for the results view (anchor, support, highlight, balancing).
(function () {
  const ROLES = [
    { roleId: "anchor", roleLabel: "Anchor" },
    { roleId: "support", roleLabel: "Support" },
    { roleId: "highlight", roleLabel: "Highlight" },
    { roleId: "balancing", roleLabel: "Balancing" }
  ];

  // Fallback hexes when no data (theme.css tropical/arid/polar)
  const FALLBACK_BY_CLIMATE = {
    tropical: ["#ff8b5a", "#ffbf3c", "#ff5a7a"],
    arid: ["#f4d59c", "#f2c17a", "#e6a15d"],
    polar: ["#c8d7e8", "#aebcc8", "#8da1b1"]
  };

  function getTopColors(paletteModel, weights) {
    const out = [];
    ["tropical", "arid", "polar"].forEach((climateId) => {
      const list = (paletteModel && paletteModel[climateId]) || [];
      const w = weights && typeof weights[climateId] === "number" ? weights[climateId] : 1 / 3;
      if (list.length) {
        list.slice(0, 3).forEach((c, i) => {
          const weight = (c.weight != null ? c.weight : 1) * w * (1 - i * 0.2);
          out.push({ hex: c.hex || "#888", weight });
        });
      } else {
        const fallback = FALLBACK_BY_CLIMATE[climateId] || ["#888"];
        fallback.forEach((hex, i) => {
          out.push({ hex, weight: w * Math.max(0.05, 0.4 - i * 0.12) });
        });
      }
    });
    return out;
  }

  function blendForRole(samples, roleIndex) {
    if (!samples.length) return "#9a9a9a";
    if (!window.ColorUtils || typeof window.ColorUtils.blendInLab !== "function") {
      return samples[0].hex || "#9a9a9a";
    }
    // Slight variation per role: shift weights so each role gets a different blend
    const shift = roleIndex * 0.15;
    const weighted = samples.map((s, i) => {
      const base = s.weight != null ? s.weight : 1;
      const roleW = base * (1 + (i % 3 - 1) * shift);
      return { hex: s.hex, weight: Math.max(0.01, roleW) };
    });
    return window.ColorUtils.blendInLab(weighted);
  }

  function hexToRgbHsv(hex) {
    const rgb = window.ColorUtils && window.ColorUtils.hexToRgb(hex);
    if (!rgb) return { rgb: null, hsv: null };
    const hsv = window.ColorUtils.rgbToHsv(rgb.r, rgb.g, rgb.b);
    return { rgb, hsv };
  }

  function generateMixedSwatches(weights, swatchPaletteModel) {
    const samples = getTopColors(swatchPaletteModel, weights);
    const swatches = ROLES.map((role, i) => {
      const hex = blendForRole(samples, i);
      const { rgb, hsv } = hexToRgbHsv(hex);
      return {
        roleId: role.roleId,
        roleLabel: role.roleLabel,
        hex: hex.startsWith("#") ? hex : "#" + hex,
        rgb: rgb || undefined,
        hsv: hsv || undefined
      };
    });
    return swatches;
  }

  window.SwatchMixer = {
    generateMixedSwatches
  };
})();
