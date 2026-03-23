/**
 * Sets html[data-ambient-page] for per-route mesh layout + motion.
 * On results, sets data-mesh-climate from URL for first-paint accuracy.
 */
(function () {
  var seg = location.pathname.split("/").pop() || "";
  if (!seg || seg === "") seg = "index.html";
  var base = seg.replace(/\.html$/i, "");
  var allowed = { index: 1, questionnaire: 1, method: 1, results: 1 };
  var page = allowed[base] ? base : "index";
  document.documentElement.dataset.ambientPage = page;

  if (page === "results") {
    var sp = new URLSearchParams(location.search);
    var qm = sp.get("matchClimate");
    var qc = sp.get("climate");
    var raw = qm && /^(tropical|arid|polar)$/i.test(qm) ? qm : qc;
    var c = raw && /^(tropical|arid|polar)$/i.test(raw) ? String(raw).toLowerCase() : "tropical";
    document.documentElement.dataset.meshClimate = c;
  } else {
    document.documentElement.removeAttribute("data-mesh-climate");
  }
})();
