const themeFilterEl = document.getElementById("themeFilter");
const generateBtn = document.getElementById("generateBtn");
const statusEl = document.getElementById("status");
const columnsEl = document.getElementById("columns");
const emptyEl = document.getElementById("empty");
const metaEl = document.getElementById("meta");

const MAX_ITEMS = 60;
const CATEGORY_KEYS = ["prerequisite", "core", "useCases", "extensions"];

let allHighlights = [];
let entryMap = {};

function init() {
  chrome.storage.local.get({ highlights: [], themes: [], knowledgeGraph: null }, (data) => {
    allHighlights = data.highlights;
    entryMap = Object.fromEntries(allHighlights.map((h) => [h.id, h]));
    populateThemeFilter(data.themes);
    if (data.knowledgeGraph) renderGraph(data.knowledgeGraph);
  });
}

function populateThemeFilter(themes) {
  themeFilterEl.innerHTML = '<option value="">All topics (latest ' + MAX_ITEMS + ')</option>';
  themes.forEach((t) => {
    const opt = document.createElement("option");
    opt.value = t;
    opt.textContent = t;
    themeFilterEl.appendChild(opt);
  });
}

generateBtn.addEventListener("click", () => {
  const theme = themeFilterEl.value;
  let entries = allHighlights;
  if (theme) entries = entries.filter((h) => h.theme === theme);
  entries = entries.slice(0, MAX_ITEMS);

  if (entries.length === 0) {
    showStatus("No highlights under this topic yet — go highlight a few on a web page first.", true);
    return;
  }

  setLoading(true);
  chrome.runtime.sendMessage(
    { type: "generate-knowledge-graph", entries },
    (res) => {
      setLoading(false);
      if (res && res.ok) {
        renderGraph(res.graph);
      } else {
        showStatus((res && res.error) || "Generation failed, please try again later", true);
      }
    }
  );
});

function setLoading(isLoading) {
  generateBtn.disabled = isLoading;
  generateBtn.textContent = isLoading ? "Analyzing…" : "Generate Knowledge Graph";
  if (isLoading) showStatus("AI is analyzing your highlights, please wait (usually a few seconds to about ten)…", false);
  else statusEl.hidden = true;
}

function showStatus(message, isError) {
  statusEl.hidden = false;
  statusEl.textContent = message;
  statusEl.className = "status-box" + (isError ? " error" : "");
}

function renderGraph(graph) {
  emptyEl.hidden = true;
  columnsEl.hidden = false;
  statusEl.hidden = true;

  const d = new Date(graph.generatedAt);
  metaEl.textContent =
    "Last generated " + d.toLocaleDateString("en-US") + " " + d.toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit" }) +
    " (" + graph.entryIds.length + " highlights)";

  CATEGORY_KEYS.forEach((key) => {
    const listEl = document.getElementById("col-" + key);
    listEl.innerHTML = "";
    const items = graph.categories[key] || [];

    if (items.length === 0) {
      const p = document.createElement("p");
      p.className = "col-empty";
      p.textContent = "Nothing in this batch clearly fits this category";
      listEl.appendChild(p);
      return;
    }

    items.forEach((item) => {
      const entry = entryMap[item.id];
      if (!entry) return;

      const node = document.createElement("div");
      node.className = "node";

      const text = document.createElement("p");
      text.className = "node-text";
      text.textContent = entry.text;
      node.appendChild(text);

      if (item.reason) {
        const reason = document.createElement("p");
        reason.className = "node-reason";
        reason.textContent = item.reason;
        node.appendChild(reason);
      }

      const source = document.createElement("p");
      source.className = "node-source";
      const link = document.createElement("a");
      link.href = entry.url;
      link.target = "_blank";
      link.textContent = entry.pageTitle || entry.url;
      source.appendChild(link);
      node.appendChild(source);

      listEl.appendChild(node);
    });
  });
}

init();
