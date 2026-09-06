const listEl = document.getElementById("list");
const emptyEl = document.getElementById("empty");
const countEl = document.getElementById("count");
const searchEl = document.getElementById("search");
const themeFilterEl = document.getElementById("themeFilter");
const settingsBtn = document.getElementById("settingsBtn");

let allHighlights = [];

settingsBtn.addEventListener("click", () => {
  chrome.runtime.openOptionsPage();
});

document.getElementById("openGraph").addEventListener("click", () => {
  chrome.tabs.create({ url: chrome.runtime.getURL("graph.html") });
});

function load() {
  chrome.storage.local.get({ highlights: [] }, (data) => {
    allHighlights = data.highlights;
    populateThemeFilter(allHighlights);
    applyFilters();
  });
}

function populateThemeFilter(items) {
  const themes = [...new Set(items.map((h) => h.theme).filter(Boolean))];
  const current = themeFilterEl.value;
  themeFilterEl.innerHTML = '<option value="">All topics</option>';
  themes.forEach((t) => {
    const opt = document.createElement("option");
    opt.value = t;
    opt.textContent = t;
    themeFilterEl.appendChild(opt);
  });
  themeFilterEl.value = themes.includes(current) ? current : "";
}

function applyFilters() {
  const q = searchEl.value.trim().toLowerCase();
  const theme = themeFilterEl.value;

  let items = allHighlights;
  if (theme) items = items.filter((h) => h.theme === theme);
  if (q) {
    items = items.filter(
      (h) =>
        h.text.toLowerCase().includes(q) ||
        (h.note && h.note.toLowerCase().includes(q)) ||
        (h.pageTitle && h.pageTitle.toLowerCase().includes(q))
    );
  }
  render(items);
}

function render(items) {
  listEl.innerHTML = "";
  countEl.textContent = String(allHighlights.length);

  if (items.length === 0) {
    emptyEl.hidden = false;
    listEl.hidden = true;
    return;
  }
  emptyEl.hidden = true;
  listEl.hidden = false;

  items.forEach((h) => {
    const item = document.createElement("div");
    item.className = "item";
    item.style.borderLeftColor = h.color;

    if (h.theme || h.syncStatus) {
      const badges = document.createElement("div");
      badges.className = "item-badges";
      if (h.theme) {
        const b = document.createElement("span");
        b.className = "badge-theme";
        b.textContent = h.theme;
        badges.appendChild(b);
      }
      const s = document.createElement("span");
      s.className = "badge-sync " + (h.syncStatus || "local");
      s.textContent = h.syncStatus === "synced" ? "Synced to Notion" : "Not synced";
      badges.appendChild(s);
      item.appendChild(badges);
    }

    const text = document.createElement("p");
    text.className = "item-text";
    text.textContent = h.text;
    item.appendChild(text);

    if (h.screenshot) {
      const img = document.createElement("img");
      img.className = "item-shot";
      img.src = h.screenshot;
      img.alt = "Highlight screenshot";
      item.appendChild(img);
    }

    if (h.note) {
      const note = document.createElement("p");
      note.className = "item-note";
      note.textContent = h.note;
      item.appendChild(note);
    }

    const meta = document.createElement("div");
    meta.className = "item-meta";

    const source = document.createElement("div");
    source.className = "item-source";
    const link = document.createElement("a");
    link.href = h.url;
    link.target = "_blank";
    link.textContent = (h.pageTitle || h.url) + " · " + formatTime(h.createdAt);
    source.appendChild(link);
    meta.appendChild(source);

    const actions = document.createElement("div");
    actions.className = "item-actions";

    const speakBtn = document.createElement("button");
    speakBtn.textContent = "🔊";
    speakBtn.title = "Read this text aloud";
    speakBtn.addEventListener("click", () => togglePopupSpeak(h.text, speakBtn));

    const copyBtn = document.createElement("button");
    copyBtn.textContent = "Copy";
    copyBtn.title = "Copy text and link";
    copyBtn.addEventListener("click", () => {
      const payload = `"${h.text}"\n\nSource: ${h.pageTitle}\n${h.url}`;
      navigator.clipboard.writeText(payload);
      copyBtn.textContent = "Copied";
      setTimeout(() => (copyBtn.textContent = "Copy"), 1200);
    });

    const delBtn = document.createElement("button");
    delBtn.textContent = "Delete";
    delBtn.addEventListener("click", () => {
      chrome.storage.local.get({ highlights: [] }, (data) => {
        const highlights = data.highlights.filter((x) => x.id !== h.id);
        chrome.storage.local.set({ highlights }, load);
      });
    });

    actions.appendChild(speakBtn);
    actions.appendChild(copyBtn);
    actions.appendChild(delBtn);
    meta.appendChild(actions);

    item.appendChild(meta);
    listEl.appendChild(item);
  });
}

function detectLang(text) {
  return /[\u4e00-\u9fa5]/.test(text) ? "zh-TW" : "en-US";
}

// Strip citation markers like [13][14] and extra whitespace so speech sounds cleaner
function cleanTextForSpeech(text) {
  return text
    .replace(/\[\d+\]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function togglePopupSpeak(text, buttonEl) {
  if (speechSynthesis.speaking) {
    speechSynthesis.cancel();
    buttonEl.textContent = "🔊";
    return;
  }
  chrome.storage.local.get({ ttsVoiceURI: "", ttsRate: 0.9 }, (data) => {
    const cleanText = cleanTextForSpeech(text);
    const utterance = new SpeechSynthesisUtterance(cleanText);
    utterance.rate = data.ttsRate;
    const voices = speechSynthesis.getVoices();
    const chosen = data.ttsVoiceURI && voices.find((v) => v.voiceURI === data.ttsVoiceURI);
    if (chosen) {
      utterance.voice = chosen;
      utterance.lang = chosen.lang;
    } else {
      utterance.lang = detectLang(cleanText);
    }
    utterance.onend = () => (buttonEl.textContent = "🔊");
    utterance.onerror = () => (buttonEl.textContent = "🔊");
    speechSynthesis.speak(utterance);
    buttonEl.textContent = "⏸";
  });
}

function formatTime(ts) {
  const d = new Date(ts);
  const now = new Date();
  const sameDay = d.toDateString() === now.toDateString();
  if (sameDay) {
    return d.toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit" });
  }
  return d.toLocaleDateString("en-US", { month: "numeric", day: "numeric" });
}

searchEl.addEventListener("input", applyFilters);
themeFilterEl.addEventListener("change", applyFilters);

load();
