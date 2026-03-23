(function () {
    const SECTION_IDS = ["landing", "questionnaire", "processing", "results"];
  
    function getSection(id) {
      return document.getElementById(id);
    }
  
    function showSection(id) {
      SECTION_IDS.forEach((sectionId) => {
        const el = getSection(sectionId);
        if (!el) return;
        if (sectionId === id) {
          el.classList.remove("section--hidden");
          requestAnimationFrame(() => {
            el.classList.add("section--visible");
          });
        } else {
          el.classList.add("section--hidden");
          el.classList.remove("section--visible");
        }
      });
    }
  
    async function runProcessingAndShowResults(collected) {
      // showSection("processing");
      // setTimeout(() => {
      const profile = window.ResultsModule.deriveProfile(collected.answers);
      await window.ResultsModule.renderResults(profile);
      showSection("results");
      // }, 1600);
    }
  
    function initNav() {
      const beginButton = document.getElementById("begin-button");
      if (beginButton) {
        beginButton.addEventListener("click", () => {
          showSection("questionnaire");
        });
      }
  
      const methodBtn = document.querySelector("[data-nav-target='learn-more']");
      if (methodBtn) {
        methodBtn.addEventListener("click", () => {
          const target = document.getElementById("learn-more");
          if (target) {
            target.scrollIntoView({ behavior: "smooth", block: "start" });
          }
        });
      }
  
    }

    document.addEventListener("DOMContentLoaded", () => {
      initNav();
  
      window.QuestionnaireModule.init((collected) => {
        runProcessingAndShowResults(collected);
      });
  
      showSection("landing");
    });
  })();