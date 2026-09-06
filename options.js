const tokenInput = document.getElementById("notionToken");
const dbInput = document.getElementById("notionDatabaseId");
const saveBtn = document.getElementById("saveNotion");
const statusEl = document.getElementById("notionStatus");

const aiProviderEl = document.getElementById("aiProvider");
const aiApiKeyEl = document.getElementById("aiApiKey");
const saveAiBtn = document.getElementById("saveAi");
const aiStatusEl = document.getElementById("aiStatus");

const newThemeInput = document.getElementById("newTheme");
const addThemeBtn = document.getElementById("addThemeBtn");
const themeListEl = document.getElementById("themeList");

function loadSettings() {
  chrome.storage.local.get(
    {
      notionToken: "",
      notionDatabaseId: "",
      themes: [],
      aiProvider: "anthropic",
      aiApiKey: "",
      ttsVoiceURI: "",
      ttsRate: 0.9,
    },
    (data) => {
      tokenInput.value = data.notionToken;
      dbInput.value = data.notionDatabaseId;
      aiProviderEl.value = data.aiProvider;
      aiApiKeyEl.value = data.aiApiKey;
      renderThemes(data.themes);
      ttsVoiceEl.dataset.savedUri = data.ttsVoiceURI;
      loadVoiceOptions();
      ttsRateEl.value = data.ttsRate;
      ttsRateLabel.textContent = data.ttsRate + "x";
    }
  );
}

saveAiBtn.addEventListener("click", () => {
  chrome.storage.local.set(
    { aiProvider: aiProviderEl.value, aiApiKey: aiApiKeyEl.value.trim() },
    () => {
      aiStatusEl.textContent = "Saved";
      setTimeout(() => (aiStatusEl.textContent = ""), 2000);
    }
  );
});

const ttsVoiceEl = document.getElementById("ttsVoice");
const ttsPreviewBtn = document.getElementById("ttsPreview");
const ttsStatusEl = document.getElementById("ttsStatus");

function loadVoiceOptions() {
  const voices = speechSynthesis.getVoices();
  if (voices.length === 0) return;
  const current = ttsVoiceEl.value;
  const savedUri = ttsVoiceEl.dataset.savedUri || "";
  ttsVoiceEl.innerHTML = '<option value="">System default (auto-picked by content language)</option>';
  voices.forEach((v) => {
    const opt = document.createElement("option");
    opt.value = v.voiceURI;
    opt.textContent = v.name + "(" + v.lang + ")";
    ttsVoiceEl.appendChild(opt);
  });
  ttsVoiceEl.value = savedUri || current;
}

speechSynthesis.addEventListener("voiceschanged", loadVoiceOptions);
loadVoiceOptions();

ttsVoiceEl.addEventListener("change", () => {
  chrome.storage.local.set({ ttsVoiceURI: ttsVoiceEl.value }, () => {
    ttsStatusEl.textContent = "Saved";
    setTimeout(() => (ttsStatusEl.textContent = ""), 2000);
  });
});

const ttsRateEl = document.getElementById("ttsRate");
const ttsRateLabel = document.getElementById("ttsRateLabel");

ttsRateEl.addEventListener("input", () => {
  ttsRateLabel.textContent = ttsRateEl.value + "x";
});

ttsRateEl.addEventListener("change", () => {
  chrome.storage.local.set({ ttsRate: parseFloat(ttsRateEl.value) }, () => {
    ttsStatusEl.textContent = "Saved";
    setTimeout(() => (ttsStatusEl.textContent = ""), 2000);
  });
});

ttsPreviewBtn.addEventListener("click", () => {
  speechSynthesis.cancel();
  const voices = speechSynthesis.getVoices();
  const chosen = voices.find((v) => v.voiceURI === ttsVoiceEl.value);
  const utterance = new SpeechSynthesisUtterance("This is a preview sentence, does this voice sound natural?");
  utterance.rate = parseFloat(ttsRateEl.value);
  if (chosen) {
    utterance.voice = chosen;
    utterance.lang = chosen.lang;
  }
  speechSynthesis.speak(utterance);
});

saveBtn.addEventListener("click", () => {
  const token = tokenInput.value.trim();
  const databaseId = extractDatabaseId(dbInput.value.trim());

  chrome.storage.local.set({ notionToken: token, notionDatabaseId: databaseId }, () => {
    statusEl.textContent = "Saved";
    setTimeout(() => (statusEl.textContent = ""), 2000);
  });
});

// Allow users to paste a full Notion URL and auto-extract the database ID (the 32-char hex segment in the URL)
function extractDatabaseId(input) {
  const match = input.match(/[0-9a-f]{32}/i);
  return match ? match[0] : input;
}

function renderThemes(themes) {
  themeListEl.innerHTML = "";
  themes.forEach((t) => {
    const li = document.createElement("li");
    const span = document.createElement("span");
    span.textContent = t;
    const delBtn = document.createElement("button");
    delBtn.textContent = "×";
    delBtn.addEventListener("click", () => removeTheme(t));
    li.appendChild(span);
    li.appendChild(delBtn);
    themeListEl.appendChild(li);
  });
}

addThemeBtn.addEventListener("click", addTheme);
newThemeInput.addEventListener("keydown", (e) => {
  if (e.key === "Enter") addTheme();
});

function addTheme() {
  const name = newThemeInput.value.trim();
  if (!name) return;
  chrome.storage.local.get({ themes: [] }, (data) => {
    if (!data.themes.includes(name)) {
      const themes = [...data.themes, name];
      chrome.storage.local.set({ themes }, () => renderThemes(themes));
    }
    newThemeInput.value = "";
  });
}

function removeTheme(name) {
  chrome.storage.local.get({ themes: [] }, (data) => {
    const themes = data.themes.filter((t) => t !== name);
    chrome.storage.local.set({ themes }, () => renderThemes(themes));
  });
}

loadSettings();
