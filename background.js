// Background script: talks to the Notion API and writes highlights into the user's chosen database

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg.type === "sync-to-notion") {
    syncEntryToNotion(msg.entry)
      .then(() => sendResponse({ ok: true }))
      .catch((err) => sendResponse({ ok: false, error: String(err) }));
    return true; // keep the channel open for the async response
  }
  if (msg.type === "generate-knowledge-graph") {
    generateKnowledgeGraph(msg.entries)
      .then((graph) => sendResponse({ ok: true, graph }))
      .catch((err) => sendResponse({ ok: false, error: String(err) }));
    return true;
  }
  if (msg.type === "capture-visible-tab") {
    const windowId = sender.tab ? sender.tab.windowId : undefined;
    chrome.tabs.captureVisibleTab(windowId, { format: "jpeg", quality: 80 }, (dataUrl) => {
      if (chrome.runtime.lastError) {
        sendResponse({ ok: false, error: chrome.runtime.lastError.message });
      } else {
        sendResponse({ ok: true, dataUrl });
      }
    });
    return true;
  }
});

async function syncEntryToNotion(entry) {
  const { notionToken, notionDatabaseId } = await getSettings();
  if (!notionToken || !notionDatabaseId) {
    throw new Error("Notion key or database ID not set yet");
  }

  if (entry.theme) {
    const pageId = await getOrCreateThemePage(notionToken, notionDatabaseId, entry.theme);
    await appendHighlightBlocks(notionToken, pageId, entry);
    await updateThemeSummaryProperties(notionToken, notionDatabaseId, pageId, entry);
  } else {
    // No topic selected: title only holds a short excerpt, full text/notes/source go into the page body instead, to avoid bloating the table
    const schema = await fetchDatabaseSchema(notionToken, notionDatabaseId);
    const properties = buildShortTitleProperties(schema, entry);
    const res = await fetch("https://api.notion.com/v1/pages", {
      method: "POST",
      headers: notionHeaders(notionToken),
      body: JSON.stringify({ parent: { database_id: notionDatabaseId }, properties }),
    });
    if (!res.ok) {
      const body = await res.text();
      throw new Error("Notion API error (" + res.status + "): " + body);
    }
    const page = await res.json();
    await appendHighlightBlocks(notionToken, page.id, entry);
  }

  await markSynced(entry.id);
}

function notionHeaders(token, version) {
  return {
    Authorization: "Bearer " + token,
    "Notion-Version": version || "2022-06-28",
    "Content-Type": "application/json",
  };
}

// Find which Notion page this topic currently maps to, or create a new one if none exists
async function getOrCreateThemePage(token, databaseId, theme) {
  const { themePages } = await new Promise((resolve) => {
    chrome.storage.local.get({ themePages: {} }, resolve);
  });

  if (themePages[theme]) {
    return themePages[theme];
  }

  const schema = await fetchDatabaseSchema(token, databaseId);
  const titleProp = Object.entries(schema).find(([, def]) => def.type === "title");
  const dateProp = Object.entries(schema).find(([, def]) => def.type === "date");
  const selectProp = Object.entries(schema).find(([, def]) => def.type === "select");

  const properties = {};
  if (titleProp) {
    properties[titleProp[0]] = { title: [{ text: { content: theme } }] };
  }
  if (dateProp) {
    properties[dateProp[0]] = { date: { start: new Date().toISOString() } };
  }
  if (selectProp) {
    properties[selectProp[0]] = { select: { name: theme } };
  }

  const res = await fetch("https://api.notion.com/v1/pages", {
    method: "POST",
    headers: notionHeaders(token),
    body: JSON.stringify({ parent: { database_id: databaseId }, properties }),
  });
  if (!res.ok) {
    const body = await res.text();
    throw new Error("Failed to create topic page (" + res.status + "): " + body);
  }
  const page = await res.json();

  const updated = { ...themePages, [theme]: page.id };
  await new Promise((resolve) => chrome.storage.local.set({ themePages: updated }, resolve));
  return page.id;
}

// Append one highlight as content blocks in the topic page (quote for text, paragraph for notes, image for screenshot, link for source)
async function appendHighlightBlocks(token, pageId, entry) {
  const children = [
    {
      object: "block",
      type: "quote",
      quote: { rich_text: [{ text: { content: truncate(entry.text, 1900) } }] },
    },
  ];

  if (entry.note) {
    children.push({
      object: "block",
      type: "paragraph",
      paragraph: { rich_text: [{ text: { content: truncate(entry.note, 1900) } }] },
    });
  }

  if (entry.screenshot) {
    try {
      const fileUploadId = await uploadScreenshotToNotion(token, entry.screenshot);
      children.push({
        object: "block",
        type: "image",
        image: { type: "file_upload", file_upload: { id: fileUploadId } },
      });
    } catch (err) {
      // A failed screenshot upload shouldn't block the rest of the sync; skip the image and keep writing text
      console.warn("Screenshot upload failed", err);
    }
  }

  children.push({
    object: "block",
    type: "paragraph",
    paragraph: {
      rich_text: [
        {
          text: {
            content: "Source: " + (entry.pageTitle || entry.url) + " (" + formatDate(entry.createdAt) + ")",
            link: { url: entry.url },
          },
          annotations: { color: "gray" },
        },
      ],
    },
  });

  children.push({ object: "block", type: "divider", divider: {} });

  const res = await fetch("https://api.notion.com/v1/blocks/" + pageId + "/children", {
    method: "PATCH",
    headers: notionHeaders(token, "2026-03-11"),
    body: JSON.stringify({ children }),
  });
  if (!res.ok) {
    const body = await res.text();
    throw new Error("Failed to write to topic page (" + res.status + "): " + body);
  }
}

// Screenshot upload, three steps: create upload job -> send file bytes -> return file_upload id for the block to reference
async function uploadScreenshotToNotion(token, dataUrl) {
  const createRes = await fetch("https://api.notion.com/v1/file_uploads", {
    method: "POST",
    headers: notionHeaders(token, "2026-03-11"),
    body: JSON.stringify({ filename: "highlight-screenshot.jpg" }),
  });
  if (!createRes.ok) {
    const body = await createRes.text();
    throw new Error("Failed to create screenshot upload job (" + createRes.status + "): " + body);
  }
  const { id: fileUploadId } = await createRes.json();

  const blob = await (await fetch(dataUrl)).blob();
  const form = new FormData();
  form.append("file", blob, "highlight-screenshot.jpg");

  const sendRes = await fetch("https://api.notion.com/v1/file_uploads/" + fileUploadId + "/send", {
    method: "POST",
    headers: {
      Authorization: "Bearer " + token,
      "Notion-Version": "2026-03-11",
      // Don't set Content-Type manually; let FormData attach the correct multipart boundary
    },
    body: form,
  });
  if (!sendRes.ok) {
    const body = await sendRes.text();
    throw new Error("Failed to send screenshot file (" + sendRes.status + "): " + body);
  }

  return fileUploadId;
}

function formatDate(ts) {
  const d = new Date(ts);
  return d.getFullYear() + "/" + (d.getMonth() + 1) + "/" + d.getDate();
}

// After every sync, update the topic page fields so Name/Thought aren't blank, and explain why URL has no value
async function updateThemeSummaryProperties(token, databaseId, pageId, entry) {
  const schema = await fetchDatabaseSchema(token, databaseId);
  const entries = Object.entries(schema);
  const properties = {};

  const richTextProps = entries.filter(([, def]) => def.type === "rich_text");
  const nameProp = richTextProps.find(([name]) => /name|source|summary/i.test(name)) || richTextProps[0];
  const thoughtProp =
    richTextProps.find(([name]) => /thought|note/i.test(name) && name !== (nameProp && nameProp[0])) ||
    richTextProps.find(([name]) => name !== (nameProp && nameProp[0]));

  if (nameProp) {
    properties[nameProp[0]] = {
      rich_text: [{ text: { content: "See content below" } }],
    };
  }
  if (thoughtProp && entry.note) {
    properties[thoughtProp[0]] = {
      rich_text: [{ text: { content: "Latest thought: " + truncate(entry.note, 400) } }],
    };
  }

  const dateProp = entries.find(([, def]) => def.type === "date");
  if (dateProp) {
    properties[dateProp[0]] = { date: { start: new Date().toISOString() } };
  }

  if (Object.keys(properties).length === 0) return;

  const res = await fetch("https://api.notion.com/v1/pages/" + pageId, {
    method: "PATCH",
    headers: notionHeaders(token),
    body: JSON.stringify({ properties }),
  });
  if (!res.ok) {
    const body = await res.text();
    // A failed summary-field update shouldn't fail the whole sync; just log a warning
    console.warn("Failed to update topic page summary fields (" + res.status + "): " + body);
  }
}

function getSettings() {
  return new Promise((resolve) => {
    chrome.storage.local.get({ notionToken: "", notionDatabaseId: "" }, resolve);
  });
}

async function fetchDatabaseSchema(token, databaseId) {
  const res = await fetch("https://api.notion.com/v1/databases/" + databaseId, {
    headers: {
      Authorization: "Bearer " + token,
      "Notion-Version": "2022-06-28",
    },
  });
  if (!res.ok) {
    const body = await res.text();
    throw new Error("Failed to read Notion database schema (" + res.status + "): " + body);
  }
  const data = await res.json();
  return data.properties;
}

// Map highlight data based on the database's actual property types (not property names)
// so syncing works regardless of what the user named their fields, as long as the type matches
// Used when there's no topic: title only holds a short excerpt, URL/date are filled as usual, notes/text move into the page body instead of table fields
function buildShortTitleProperties(schema, entry) {
  const properties = {};
  const entries = Object.entries(schema);
  const TITLE_MAX_LEN = 20;

  const titleProp = entries.find(([, def]) => def.type === "title");
  if (titleProp) {
    properties[titleProp[0]] = {
      title: [{ text: { content: truncate(entry.text, TITLE_MAX_LEN) } }],
    };
  }

  const urlProp = entries.find(([, def]) => def.type === "url");
  if (urlProp) {
    properties[urlProp[0]] = { url: entry.url };
  }

  const dateProp = entries.find(([, def]) => def.type === "date");
  if (dateProp) {
    properties[dateProp[0]] = { date: { start: new Date(entry.createdAt).toISOString() } };
  }

  // Keep Name/Thought/Category from being blank, using the same logic as the topic page summary fields
  const richTextProps = entries.filter(([, def]) => def.type === "rich_text");
  const nameProp = richTextProps.find(([name]) => /name|summary/i.test(name)) || richTextProps[0];
  const thoughtProp =
    richTextProps.find(([name]) => /thought|note/i.test(name) && name !== (nameProp && nameProp[0])) ||
    richTextProps.find(([name]) => name !== (nameProp && nameProp[0]));

  if (nameProp) {
    properties[nameProp[0]] = { rich_text: [{ text: { content: "See content below" } }] };
  }
  if (thoughtProp) {
    properties[thoughtProp[0]] = {
      rich_text: [{ text: { content: entry.note ? truncate(entry.note, 400) : "(No thought written)" } }],
    };
  }

  const selectProp = entries.find(([, def]) => def.type === "select");
  if (selectProp) {
    properties[selectProp[0]] = { select: { name: "Uncategorized" } };
  }

  return properties;
}

function truncate(str, max) {
  if (!str) return "";
  return str.length > max ? str.slice(0, max - 1) + "…" : str;
}

function markSynced(id) {
  return new Promise((resolve) => {
    chrome.storage.local.get({ highlights: [] }, (data) => {
      const highlights = data.highlights.map((h) =>
        h.id === id ? { ...h, syncStatus: "synced" } : h
      );
      chrome.storage.local.set({ highlights }, resolve);
    });
  });
}

// ---- Knowledge graph: use AI to sort highlights into prerequisite / core / use cases / extensions ----

async function generateKnowledgeGraph(entries) {
  const { aiProvider, aiApiKey } = await new Promise((resolve) => {
    chrome.storage.local.get({ aiProvider: "anthropic", aiApiKey: "" }, resolve);
  });
  if (!aiApiKey) {
    throw new Error("AI API key not set yet, please fill it in on the Options page");
  }

  const prompt = buildGraphPrompt(entries);
  const raw =
    aiProvider === "openai" ? await callOpenAI(aiApiKey, prompt) : await callAnthropic(aiApiKey, prompt);

  const parsed = parseGraphJson(raw);
  const graph = { generatedAt: Date.now(), categories: parsed, entryIds: entries.map((e) => e.id) };
  await new Promise((resolve) => chrome.storage.local.set({ knowledgeGraph: graph }, resolve));
  return graph;
}

function buildGraphPrompt(entries) {
  const items = entries.map((e) => ({
    id: e.id,
    text: truncate(e.text, 300),
    note: truncate(e.note || "", 200),
    page: e.pageTitle || "",
  }));

  return [
    "You are a knowledge-organizing assistant. Below is a list of highlights the user saved from web pages (a JSON array). Each item has id, text (the original passage), note (the user's own thought, may be empty), and page (source page title).",
    "Sort these items into a four-category knowledge map:",
    "1. prerequisite (background knowledge or terms the reader should ideally know before understanding these highlights)",
    "2. core (the most central, key concepts among these highlights)",
    "3. useCases (concrete applications, examples, or implementations)",
    "4. extensions (related topics or directions worth exploring further after reading these highlights)",
    "Assign each input item to the single best-fitting category, with a one-sentence reason (under 15 words) explaining why it belongs there. Write each reason in the SAME language as that item's own text field (e.g. Chinese text gets a Chinese reason, English text gets an English reason) — do not default to one fixed language. If a category has no suitable items, return an empty array — do not force-fit items.",
    "Output ONLY JSON, no other text, no markdown code block. Format:",
    '{"prerequisite":[{"id":"...","reason":"..."}],"core":[...],"useCases":[...],"extensions":[...]}',
    "Input data:",
    JSON.stringify(items),
  ].join("\n");
}

function parseGraphJson(raw) {
  let text = raw.trim();
  // Some models accidentally wrap output in ```json, strip that first
  text = text.replace(/^```json\s*/i, "").replace(/^```\s*/i, "").replace(/```\s*$/i, "");
  try {
    const obj = JSON.parse(text);
    return {
      prerequisite: obj.prerequisite || [],
      core: obj.core || [],
      useCases: obj.useCases || [],
      extensions: obj.extensions || [],
    };
  } catch (err) {
    throw new Error("Could not parse the AI's response format, please try again");
  }
}

async function callAnthropic(apiKey, prompt) {
  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "x-api-key": apiKey,
      "anthropic-version": "2023-06-01",
      "anthropic-dangerous-direct-browser-access": "true",
      "content-type": "application/json",
    },
    body: JSON.stringify({
      model: "claude-sonnet-4-6",
      max_tokens: 3000,
      messages: [{ role: "user", content: prompt }],
    }),
  });
  if (!res.ok) {
    const body = await res.text();
    throw new Error("Anthropic API error (" + res.status + "): " + body);
  }
  const data = await res.json();
  const block = (data.content || []).find((b) => b.type === "text");
  if (!block) throw new Error("AI did not return any text content");
  return block.text;
}

async function callOpenAI(apiKey, prompt) {
  const res = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: {
      Authorization: "Bearer " + apiKey,
      "content-type": "application/json",
    },
    body: JSON.stringify({
      model: "gpt-4o-mini",
      messages: [{ role: "user", content: prompt }],
      response_format: { type: "json_object" },
    }),
  });
  if (!res.ok) {
    const body = await res.text();
    throw new Error("OpenAI API error (" + res.status + "): " + body);
  }
  const data = await res.json();
  const content = data.choices && data.choices[0] && data.choices[0].message.content;
  if (!content) throw new Error("AI did not return any text content");
  return content;
}
