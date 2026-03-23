(function () {
  // Panel toggle behaviour for the results split layout.
  //
  // Desktop:
  // - Right profile panel collapses into a slim rail.
  // - Chart expands to fill more space.
  //
  // Mobile:
  // - Results stack vertically.
  // - Panel acts like an accordion; rail is hidden.

  function isMobile() {
    return window.matchMedia("(max-width: 768px)").matches;
  }

  function toggleProfilePanel(forceState) {
    const shell = document.querySelector("[data-results-shell]");
    const panel = document.querySelector("[data-results-panel]");
    const body = document.querySelector("[data-panel-body]");
    const toggle = document.querySelector("[data-panel-toggle]");
    const rail = document.querySelector("[data-rail-toggle]");
    if (!shell || !panel || !toggle || !body) return;

    const currentlyCollapsed = shell.getAttribute("data-panel-collapsed") === "true";
    const nextCollapsed =
      typeof forceState === "boolean" ? forceState : !currentlyCollapsed;

    shell.setAttribute("data-panel-collapsed", String(nextCollapsed));

    if (isMobile()) {
      // Accordion behaviour: just collapse the body.
      if (nextCollapsed) {
        body.style.display = "none";
      } else {
        body.style.display = "";
      }
      toggle.setAttribute("aria-expanded", String(!nextCollapsed));
      if (rail) {
        rail.hidden = true;
      }
    } else {
      // Desktop: panel slides away, rail remains visible.
      toggle.setAttribute("aria-expanded", String(!nextCollapsed));
      if (rail) {
        rail.hidden = !nextCollapsed;
      }
      if (body) {
        body.style.display = "";
      }
    }

    if (window.ScatterplotModule && typeof window.ScatterplotModule.refreshLayout === "function") {
      setTimeout(() => window.ScatterplotModule.refreshLayout(), 80);
    }
  }

  function init() {
    const toggle = document.querySelector("[data-panel-toggle]");
    const rail = document.querySelector("[data-rail-toggle]");
    const body = document.querySelector("[data-panel-body]");
    const shell = document.querySelector("[data-results-shell]");

    if (!toggle || !body || !shell) return;

    shell.setAttribute("data-panel-collapsed", "false");
    toggle.setAttribute("aria-expanded", "true");
    if (rail) rail.hidden = true;

    toggle.addEventListener("click", () => {
      toggleProfilePanel();
    });

    if (rail) {
      rail.addEventListener("click", () => {
        toggleProfilePanel(false);
      });
    }

    window.addEventListener("resize", () => {
      const mobile = isMobile();
      const collapsed = shell.getAttribute("data-panel-collapsed") === "true";
      if (mobile) {
        // In mobile, always show body by default.
        body.style.display = collapsed ? "none" : "";
        if (rail) rail.hidden = true;
      } else {
        if (collapsed) {
          if (rail) rail.hidden = false;
        } else if (rail) {
          rail.hidden = true;
        }
        body.style.display = "";
      }
    });
  }

  window.PanelToggleModule = {
    init,
    toggleProfilePanel
  };
})();

