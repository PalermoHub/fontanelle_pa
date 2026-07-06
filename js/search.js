export function buildSuggestions(fontanelle) {
  const circs = new Map();
  const quarts = new Map();
  const fontanellaEntries = [];

  for (const feature of fontanelle.features) {
    const { id, indirizzo, circoscrizione, quartiere } = feature.properties;

    if (circoscrizione && !circs.has(circoscrizione)) {
      circs.set(circoscrizione, { type: "circ", label: circoscrizione, value: circoscrizione });
    }

    if (quartiere) {
      const quartKey = `${circoscrizione || ""}::${quartiere}`;
      if (!quarts.has(quartKey)) {
        quarts.set(quartKey, { type: "quart", label: quartiere, value: quartiere, circ: circoscrizione });
      }
    }

    fontanellaEntries.push({
      type: "fontanella",
      label: indirizzo || id,
      value: id,
      circ: circoscrizione,
      quart: quartiere,
    });
  }

  return [...circs.values(), ...quarts.values(), ...fontanellaEntries];
}

export function filterSuggestions(query, suggestions, limit = 12) {
  const normalized = query.trim().toLowerCase();
  if (!normalized) return [];
  return suggestions.filter((s) => s.label.toLowerCase().includes(normalized)).slice(0, limit);
}

const TYPE_LABELS = { circ: "Circoscrizione", quart: "Quartiere", fontanella: "Fontanella" };

function escapeHtml(s) {
  return String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

export function wireSearch({ fontanelle, filterInputs, refreshCascade, onApply }) {
  const { circoscrizioneSelect, quartiereSelect, fontanellaSelect, searchInput: hiddenSearchInput } = filterInputs;

  const suggestions = buildSuggestions(fontanelle);

  const searchInput = document.querySelector("#search-input");
  const searchClear = document.querySelector("#search-clear");
  const searchDD = document.querySelector("#search-dd");
  const chipsEl = document.querySelector("#search-chips");
  const filterBtn = document.querySelector("#filter-btn");
  const filterBadge = document.querySelector("#filter-badge");
  const filterOverlay = document.querySelector("#filter-overlay");
  const filterModal = document.querySelector("#filter-modal");
  const fmClose = document.querySelector("#fm-close");
  const fmReset = document.querySelector("#fm-reset");
  const fmApply = document.querySelector("#fm-apply");

  function renderDropdown(query) {
    const matches = filterSuggestions(query, suggestions);
    if (matches.length === 0) {
      searchDD.innerHTML = query.trim()
        ? `<div class="search-dd-empty">Nessun risultato per "${escapeHtml(query.trim())}"</div>`
        : "";
      searchDD.classList.toggle("open", query.trim().length > 0);
      return;
    }
    let html = "";
    let lastType = null;
    for (const m of matches) {
      if (m.type !== lastType) {
        html += `<div class="search-dd-cat">${TYPE_LABELS[m.type]}</div>`;
        lastType = m.type;
      }
      html += `<div class="search-dd-item" data-type="${escapeHtml(m.type)}" data-value="${escapeHtml(m.value)}" data-circ="${escapeHtml(m.circ || "")}" data-quart="${escapeHtml(m.quart || "")}">
                 <span>${escapeHtml(m.label)}</span>
                 <span class="search-dd-badge">${TYPE_LABELS[m.type]}</span>
               </div>`;
    }
    searchDD.innerHTML = html;
    searchDD.classList.add("open");
    searchDD.querySelectorAll(".search-dd-item").forEach((el) => {
      el.addEventListener("click", () => selectSuggestion(el.dataset));
    });
  }

  function selectSuggestion({ type, value, circ, quart }) {
    if (type === "circ") {
      circoscrizioneSelect.value = value;
    } else if (type === "quart") {
      circoscrizioneSelect.value = circ;
      refreshCascade();
      quartiereSelect.value = value;
    } else if (type === "fontanella") {
      circoscrizioneSelect.value = circ;
      refreshCascade();
      quartiereSelect.value = quart;
      refreshCascade();
      fontanellaSelect.value = value;
    }
    refreshCascade();
    hiddenSearchInput.value = "";
    searchInput.value = "";
    searchClear.hidden = true;
    searchDD.classList.remove("open");
    onApply();
    updateChips();
  }

  function updateChips() {
    const chips = [];
    if (circoscrizioneSelect.value) chips.push({ label: circoscrizioneSelect.value, clear: "circ" });
    if (quartiereSelect.value) chips.push({ label: quartiereSelect.value, clear: "quart" });
    if (fontanellaSelect.value) {
      const option = fontanellaSelect.selectedOptions[0];
      chips.push({ label: option ? option.textContent : fontanellaSelect.value, clear: "fontanella" });
    }
    if (hiddenSearchInput.value.trim()) chips.push({ label: hiddenSearchInput.value.trim(), clear: "query" });

    chipsEl.classList.toggle("visible", chips.length > 0);
    filterBadge.hidden = chips.length === 0;
    filterBadge.textContent = chips.length;

    chipsEl.innerHTML = chips
      .map(
        (c) =>
          `<span class="search-chip">${escapeHtml(c.label)}<button data-clear="${c.clear}">&#x2715;</button></span>`
      )
      .join("");
    chipsEl.querySelectorAll("button[data-clear]").forEach((btn) => {
      btn.addEventListener("click", () => clearChip(btn.dataset.clear));
    });
  }

  function clearChip(which) {
    if (which === "circ") {
      circoscrizioneSelect.value = "";
    } else if (which === "quart") {
      quartiereSelect.value = "";
    } else if (which === "fontanella") {
      fontanellaSelect.value = "";
    } else if (which === "query") {
      hiddenSearchInput.value = "";
      searchInput.value = "";
      searchClear.hidden = true;
    }
    refreshCascade();
    onApply();
    updateChips();
  }

  searchInput.addEventListener("input", () => {
    hiddenSearchInput.value = searchInput.value;
    searchClear.hidden = searchInput.value.length === 0;
    renderDropdown(searchInput.value);
    onApply();
    updateChips();
  });

  searchClear.addEventListener("click", () => {
    searchInput.value = "";
    hiddenSearchInput.value = "";
    searchClear.hidden = true;
    searchDD.classList.remove("open");
    onApply();
    updateChips();
  });

  function openModal() {
    filterOverlay.classList.add("visible");
    filterModal.classList.add("visible");
  }
  function closeModal() {
    filterOverlay.classList.remove("visible");
    filterModal.classList.remove("visible");
  }

  filterBtn.addEventListener("click", openModal);
  fmClose.addEventListener("click", closeModal);
  filterOverlay.addEventListener("click", closeModal);
  fmApply.addEventListener("click", () => {
    updateChips();
    closeModal();
  });
  fmReset.addEventListener("click", () => {
    circoscrizioneSelect.value = "";
    quartiereSelect.value = "";
    fontanellaSelect.value = "";
    refreshCascade();
    onApply();
    updateChips();
    closeModal();
  });

  // I 3 select gia hanno i propri listener "change" (wireFilters in
  // main.js): qui basta riflettere lo stato nei chip ogni volta che
  // cambiano, per tenerli sincronizzati anche quando l'utente usa
  // direttamente le select nel modal invece del dropdown di ricerca.
  [circoscrizioneSelect, quartiereSelect, fontanellaSelect].forEach((el) => {
    el.addEventListener("change", updateChips);
  });

  updateChips();
}
