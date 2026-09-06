(() => {
  const COLORS = [
    { name: "yellow", hex: "#fff28a" },
    { name: "green", hex: "#b7f0a8" },
    { name: "pink", hex: "#ffc2d9" },
    { name: "blue", hex: "#a9d6ff" },
  ];

  let toolbarEl = null;
  let composerEl = null;
  let currentRange = null;

  document.addEventListener("mouseup", onMouseUp);
  document.addEventListener("mousedown", (e) => {
    if (toolbarEl && !toolbarEl.contains(e.target)) removeToolbar();
    if (composerEl && !composerEl.contains(e.target)) removeComposer();
  });

  document.addEventListener("click", (e) => {
    const mark = e.target.closest(".hltr-mark");
    if (mark) openComposerForExisting(mark);
  });

  function onMouseUp(e) {
    if (toolbarEl && toolbarEl.contains(e.target)) return;
    if (composerEl && composerEl.contains(e.target)) return;
    const selection = window.getSelection();
    const text = selection.toString().trim();

    if (!text || selection.isCollapsed) {
      removeToolbar();
      return;
    }

    currentRange = selection.getRangeAt(0).cloneRange();
    showToolbar(selection);
  }

  function showToolbar(selection) {
    removeToolbar();
    const rect = selection.getRangeAt(0).getBoundingClientRect();

    toolbarEl = document.createElement("div");
    toolbarEl.className = "hltr-toolbar";

    COLORS.forEach((c) => {
      const btn = document.createElement("button");
      btn.className = "hltr-swatch";
      btn.style.background = c.hex;
      btn.title = "Highlight " + c.name;
      btn.addEventListener("click", () => applyHighlight(c.hex));
      toolbarEl.appendChild(btn);
    });

    const divider = document.createElement("div");
    divider.className = "hltr-divider";
    toolbarEl.appendChild(divider);

    const copyBtn = document.createElement("button");
    copyBtn.className = "hltr-copy-btn";
    copyBtn.title = "Copy text and link";
    copyBtn.textContent = "🔗";
    copyBtn.addEventListener("click", copySelectionWithSource);
    toolbarEl.appendChild(copyBtn);

    document.body.appendChild(toolbarEl);
    toolbarEl.style.left = rect.left + rect.width / 2 + window.scrollX + "px";
    toolbarEl.style.top = rect.top + window.scrollY + "px";
  }

  function removeToolbar() {
    if (toolbarEl) {
      toolbarEl.remove();
      toolbarEl = null;
    }
  }

  async function applyHighlight(colorHex) {
    if (!currentRange) return;
    const text = currentRange.toString().trim();
    if (!text) return;

    const id = "hltr-" + Date.now() + "-" + Math.random().toString(36).slice(2, 8);

    try {
      wrapRangeWithMark(currentRange, colorHex, id);
    } catch (err) {
      console.warn("Highlight failed", err);
    }

    removeToolbar();
    window.getSelection().removeAllRanges();

    const entry = {
      id,
      text,
      color: colorHex,
      note: "",
      theme: "",
      syncStatus: "local",
      url: location.href,
      pageTitle: document.title,
      createdAt: Date.now(),
      screenshot: null,
    };
    saveHighlight(entry);

    const markEl = document.querySelector('.hltr-mark[data-hltr-id="' + id + '"]');
    if (markEl) openComposer(markEl, entry, true);
  }

  // ---- Screenshot annotation editor: marker strokes + sticky notes ----

  function openScreenshotEditor(dataUrl, onDone) {
    const overlay = document.createElement("div");
    overlay.className = "hltr-editor-overlay";
    // Stop clicks from bubbling to document to avoid triggering the "click outside closes popup" logic
    overlay.addEventListener("mousedown", (e) => e.stopPropagation());

    const card = document.createElement("div");
    card.className = "hltr-editor-card";

    const hint = document.createElement("div");
    hint.className = "hltr-editor-hint";
    hint.textContent = "Drag to mark, or click to add a note";
    card.appendChild(hint);

    const toolbar = document.createElement("div");
    toolbar.className = "hltr-editor-toolbar";

    const imgWrap = document.createElement("div");
    imgWrap.className = "hltr-editor-imgwrap";
    const img = document.createElement("img");
    img.className = "hltr-editor-img";
    img.src = dataUrl;
    imgWrap.appendChild(img);

    let mode = "mark";
    let markColor = COLORS[0].hex;
    const annotations = [];

    function setActive(btn) {
      toolbar.querySelectorAll(".hltr-editor-swatch, .hltr-editor-tool-btn").forEach((b) => {
        b.classList.remove("hltr-editor-active");
      });
      btn.classList.add("hltr-editor-active");
    }

    COLORS.forEach((c, i) => {
      const btn = document.createElement("button");
      btn.className = "hltr-editor-swatch";
      btn.style.background = c.hex;
      btn.title = "Highlight: " + c.name;
      if (i === 0) btn.classList.add("hltr-editor-active");
      btn.addEventListener("click", () => {
        mode = "mark";
        markColor = c.hex;
        setActive(btn);
      });
      toolbar.appendChild(btn);
    });

    const noteBtn = document.createElement("button");
    noteBtn.className = "hltr-editor-tool-btn";
    noteBtn.textContent = "📝";
    noteBtn.title = "Sticky note";
    noteBtn.addEventListener("click", () => {
      mode = "note";
      setActive(noteBtn);
    });
    toolbar.appendChild(noteBtn);

    const spacer = document.createElement("div");
    spacer.className = "hltr-editor-spacer";
    toolbar.appendChild(spacer);

    const skipBtn = document.createElement("button");
    skipBtn.className = "hltr-editor-skip";
    skipBtn.textContent = "⏭";
    skipBtn.title = "Skip";
    skipBtn.addEventListener("click", () => finish(false));
    toolbar.appendChild(skipBtn);

    const doneBtn = document.createElement("button");
    doneBtn.className = "hltr-editor-done";
    doneBtn.textContent = "✓";
    doneBtn.title = "Done";
    doneBtn.addEventListener("click", () => finish(true));
    toolbar.appendChild(doneBtn);

    let dragStart = null;
    let previewEl = null;

    imgWrap.addEventListener("mousedown", (e) => {
      const rect = img.getBoundingClientRect();
      if (mode === "mark") {
        dragStart = { x: e.clientX - rect.left, y: e.clientY - rect.top, rect };
        previewEl = document.createElement("div");
        previewEl.className = "hltr-editor-mark-preview";
        previewEl.style.background = markColor;
        imgWrap.appendChild(previewEl);
      } else if (mode === "note") {
        const relX = (e.clientX - rect.left) / rect.width;
        const relY = (e.clientY - rect.top) / rect.height;
        addNoteElement(relX, relY);
      }
    });

    imgWrap.addEventListener("mousemove", (e) => {
      if (!dragStart || !previewEl) return;
      const rect = dragStart.rect;
      const curX = Math.max(0, Math.min(rect.width, e.clientX - rect.left));
      const curY = Math.max(0, Math.min(rect.height, e.clientY - rect.top));
      const x = Math.min(dragStart.x, curX);
      const y = Math.min(dragStart.y, curY);
      previewEl.style.left = x + "px";
      previewEl.style.top = y + "px";
      previewEl.style.width = Math.abs(curX - dragStart.x) + "px";
      previewEl.style.height = Math.abs(curY - dragStart.y) + "px";
    });

    function onGlobalMouseUp(e) {
      if (!dragStart || !previewEl) return;
      const rect = dragStart.rect;
      const curX = Math.max(0, Math.min(rect.width, e.clientX - rect.left));
      const curY = Math.max(0, Math.min(rect.height, e.clientY - rect.top));
      const x = Math.min(dragStart.x, curX);
      const y = Math.min(dragStart.y, curY);
      const w = Math.abs(curX - dragStart.x);
      const h = Math.abs(curY - dragStart.y);
      if (w > 6 && h > 6) {
        annotations.push({
          type: "mark",
          x: x / rect.width,
          y: y / rect.height,
          w: w / rect.width,
          h: h / rect.height,
          color: markColor,
        });
      } else {
        previewEl.remove();
      }
      dragStart = null;
      previewEl = null;
    }
    window.addEventListener("mouseup", onGlobalMouseUp);

    function addNoteElement(relX, relY) {
      const noteData = { type: "note", x: relX, y: relY, text: "" };
      annotations.push(noteData);

      const noteEl = document.createElement("div");
      noteEl.className = "hltr-editor-note";
      noteEl.style.left = relX * 100 + "%";
      noteEl.style.top = relY * 100 + "%";

      const textarea = document.createElement("textarea");
      textarea.placeholder = "Type a note";
      textarea.addEventListener("input", () => {
        noteData.text = textarea.value;
      });
      textarea.addEventListener("mousedown", (e) => e.stopPropagation());
      noteEl.appendChild(textarea);

      const delBtn = document.createElement("button");
      delBtn.className = "hltr-editor-note-del";
      delBtn.textContent = "×";
      delBtn.addEventListener("mousedown", (e) => e.stopPropagation());
      delBtn.addEventListener("click", () => {
        const idx = annotations.indexOf(noteData);
        if (idx > -1) annotations.splice(idx, 1);
        noteEl.remove();
      });
      noteEl.appendChild(delBtn);

      imgWrap.appendChild(noteEl);
      textarea.focus();
    }

    function finish(shouldFlatten) {
      window.removeEventListener("mouseup", onGlobalMouseUp);
      overlay.remove();
      const realAnnotations = annotations.filter((a) => a.type === "mark" || (a.type === "note" && a.text.trim()));
      if (!shouldFlatten || realAnnotations.length === 0) {
        onDone(dataUrl);
        return;
      }
      flattenAnnotations(dataUrl, realAnnotations, onDone);
    }

    card.appendChild(toolbar);
    card.appendChild(imgWrap);
    overlay.appendChild(card);
    document.body.appendChild(overlay);
  }

  function flattenAnnotations(dataUrl, annotations, onDone) {
    const img = new Image();
    img.onload = () => {
      const canvas = document.createElement("canvas");
      canvas.width = img.naturalWidth;
      canvas.height = img.naturalHeight;
      const ctx = canvas.getContext("2d");
      ctx.drawImage(img, 0, 0);

      annotations.forEach((a) => {
        if (a.type === "mark") {
          ctx.globalAlpha = 0.45;
          ctx.fillStyle = a.color;
          ctx.fillRect(a.x * canvas.width, a.y * canvas.height, a.w * canvas.width, a.h * canvas.height);
          ctx.globalAlpha = 1;
        } else if (a.type === "note") {
          const x = a.x * canvas.width;
          const y = a.y * canvas.height;
          const noteW = 170;
          const noteH = 96;
          ctx.fillStyle = "#fff28a";
          ctx.fillRect(x, y, noteW, noteH);
          ctx.strokeStyle = "rgba(0,0,0,0.15)";
          ctx.strokeRect(x, y, noteW, noteH);
          ctx.fillStyle = "#262624";
          ctx.font = "16px sans-serif";
          wrapCanvasText(ctx, a.text, x + 10, y + 24, noteW - 20, 20);
        }
      });

      onDone(canvas.toDataURL("image/jpeg", 0.85));
    };
    img.onerror = () => onDone(dataUrl);
    img.src = dataUrl;
  }

  function wrapCanvasText(ctx, text, x, y, maxWidth, lineHeight) {
    const chars = Array.from(text);
    let line = "";
    let curY = y;
    for (let i = 0; i < chars.length; i++) {
      const testLine = line + chars[i];
      if (ctx.measureText(testLine).width > maxWidth && line) {
        ctx.fillText(line, x, curY);
        line = chars[i];
        curY += lineHeight;
      } else {
        line = testLine;
      }
    }
    ctx.fillText(line, x, curY);
  }

  // Make sure the CSS change (e.g. hiding the composer) is actually painted before capturing,
  // otherwise the screenshot may still include the popup before it gets hidden
  function waitForRepaint() {
    return new Promise((resolve) => {
      requestAnimationFrame(() => requestAnimationFrame(resolve));
    });
  }

  // Capture the current full visible viewport (uncropped)
  function captureFullScreenshot() {
    return new Promise((resolve) => {
      chrome.runtime.sendMessage({ type: "capture-visible-tab" }, (res) => {
        resolve(res && res.ok ? res.dataUrl : null);
      });
    });
  }

  // Estimate a suggested selection rect from the highlight position (relative 0-1), user can still adjust it
  function getHighlightRelRect(id) {
    const marks = document.querySelectorAll('.hltr-mark[data-hltr-id="' + id + '"]');
    if (marks.length === 0) return null;

    let u = null;
    marks.forEach((m) => {
      const r = m.getBoundingClientRect();
      if (!u) {
        u = { left: r.left, top: r.top, right: r.right, bottom: r.bottom };
      } else {
        u.left = Math.min(u.left, r.left);
        u.top = Math.min(u.top, r.top);
        u.right = Math.max(u.right, r.right);
        u.bottom = Math.max(u.bottom, r.bottom);
      }
    });
    if (u.bottom < 0 || u.top > window.innerHeight) return null;

    const padding = 24;
    const left = Math.max(0, u.left - padding);
    const top = Math.max(0, u.top - padding);
    const right = Math.min(window.innerWidth, u.right + padding);
    const bottom = Math.min(window.innerHeight, u.bottom + padding);

    return {
      x: left / window.innerWidth,
      y: top / window.innerHeight,
      w: (right - left) / window.innerWidth,
      h: (bottom - top) / window.innerHeight,
    };
  }

  // Crop the image by a relative rect (0-1), return the cropped dataURL
  function cropImageByRelRect(dataUrl, rect) {
    return new Promise((resolve) => {
      const img = new Image();
      img.onload = () => {
        const sx = Math.round(rect.x * img.naturalWidth);
        const sy = Math.round(rect.y * img.naturalHeight);
        const sw = Math.max(1, Math.round(rect.w * img.naturalWidth));
        const sh = Math.max(1, Math.round(rect.h * img.naturalHeight));
        const canvas = document.createElement("canvas");
        canvas.width = sw;
        canvas.height = sh;
        const ctx = canvas.getContext("2d");
        ctx.drawImage(img, sx, sy, sw, sh, 0, 0, sw, sh);
        resolve(canvas.toDataURL("image/jpeg", 0.85));
      };
      img.onerror = () => resolve(null);
      img.src = dataUrl;
    });
  }

  // Let the user drag to select the capture area, like a native screenshot tool
  function openScreenshotSelector(fullDataUrl, suggestedRect, onConfirm, onCancel) {
    const overlay = document.createElement("div");
    overlay.className = "hltr-editor-overlay";
    // Stop clicks from bubbling to document to avoid triggering the "click outside closes popup" logic
    overlay.addEventListener("mousedown", (e) => e.stopPropagation());

    const card = document.createElement("div");
    card.className = "hltr-editor-card";

    const hint = document.createElement("div");
    hint.className = "hltr-editor-hint";
    hint.textContent = "Drag to adjust the selection area";
    card.appendChild(hint);

    const toolbar = document.createElement("div");
    toolbar.className = "hltr-editor-toolbar";
    const spacer = document.createElement("div");
    spacer.className = "hltr-editor-spacer";
    toolbar.appendChild(spacer);

    const cancelBtn = document.createElement("button");
    cancelBtn.className = "hltr-editor-skip";
    cancelBtn.textContent = "✕";
    cancelBtn.title = "Cancel";
    toolbar.appendChild(cancelBtn);

    const confirmBtn = document.createElement("button");
    confirmBtn.className = "hltr-editor-done";
    confirmBtn.textContent = "✓";
    confirmBtn.title = "Confirm selection";
    toolbar.appendChild(confirmBtn);

    const imgWrap = document.createElement("div");
    imgWrap.className = "hltr-editor-imgwrap hltr-selector-imgwrap";
    const img = document.createElement("img");
    img.className = "hltr-editor-img";
    img.src = fullDataUrl;
    imgWrap.appendChild(img);

    const selBox = document.createElement("div");
    selBox.className = "hltr-selector-box";
    imgWrap.appendChild(selBox);

    let currentRect = suggestedRect || { x: 0.1, y: 0.1, w: 0.8, h: 0.5 };

    function renderSelBox() {
      selBox.style.left = currentRect.x * 100 + "%";
      selBox.style.top = currentRect.y * 100 + "%";
      selBox.style.width = currentRect.w * 100 + "%";
      selBox.style.height = currentRect.h * 100 + "%";
    }
    renderSelBox();

    let dragStart = null;
    imgWrap.addEventListener("mousedown", (e) => {
      const rect = img.getBoundingClientRect();
      dragStart = { x: e.clientX - rect.left, y: e.clientY - rect.top, rect };
    });
    function onMove(e) {
      if (!dragStart) return;
      const rect = dragStart.rect;
      const curX = Math.max(0, Math.min(rect.width, e.clientX - rect.left));
      const curY = Math.max(0, Math.min(rect.height, e.clientY - rect.top));
      const x = Math.min(dragStart.x, curX);
      const y = Math.min(dragStart.y, curY);
      const w = Math.abs(curX - dragStart.x);
      const h = Math.abs(curY - dragStart.y);
      if (w < 4 || h < 4) return;
      currentRect = { x: x / rect.width, y: y / rect.height, w: w / rect.width, h: h / rect.height };
      renderSelBox();
    }
    function onUp() {
      dragStart = null;
    }
    imgWrap.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);

    function cleanup() {
      window.removeEventListener("mouseup", onUp);
      overlay.remove();
    }

    cancelBtn.addEventListener("click", () => {
      cleanup();
      onCancel();
    });
    confirmBtn.addEventListener("click", () => {
      cleanup();
      onConfirm(currentRect);
    });

    card.appendChild(toolbar);
    card.appendChild(imgWrap);
    overlay.appendChild(card);
    document.body.appendChild(overlay);
  }

  function wrapRangeWithMark(range, colorHex, id) {
    const textNodes = getTextNodesInRange(range);
    textNodes.forEach((node) => {
      const nodeRange = document.createRange();
      nodeRange.selectNodeContents(node);
      if (node === range.startContainer) nodeRange.setStart(node, range.startOffset);
      if (node === range.endContainer) nodeRange.setEnd(node, range.endOffset);
      if (nodeRange.collapsed) return;

      const mark = document.createElement("mark");
      mark.className = "hltr-mark";
      mark.dataset.hltrId = id;
      mark.style.backgroundColor = colorHex;
      try {
        nodeRange.surroundContents(mark);
      } catch (err) {
        // Skip nodes that can't be wrapped instead of interrupting the whole process
      }
    });
  }

  function getTextNodesInRange(range) {
    const nodes = [];
    const walker = document.createTreeWalker(
      range.commonAncestorContainer,
      NodeFilter.SHOW_TEXT,
      {
        acceptNode(node) {
          if (!node.nodeValue || !node.nodeValue.trim()) return NodeFilter.FILTER_REJECT;
          return range.intersectsNode(node) ? NodeFilter.FILTER_ACCEPT : NodeFilter.FILTER_REJECT;
        },
      }
    );
    let n;
    while ((n = walker.nextNode())) nodes.push(n);
    return nodes;
  }

  function saveHighlight(entry) {
    chrome.storage.local.get({ highlights: [] }, (data) => {
      const highlights = data.highlights;
      highlights.unshift(entry);
      chrome.storage.local.set({ highlights });
    });
  }

  function copySelectionWithSource() {
    if (!currentRange) return;
    const text = currentRange.toString().trim();
    const payload = `"${text}"\n\nSource: ${document.title}\n${location.href}`;
    navigator.clipboard.writeText(payload).then(() => {
      showToast("Copied text and source link");
      removeToolbar();
    });
  }

  function showToast(message) {
    const toast = document.createElement("div");
    toast.className = "hltr-toast";
    toast.textContent = message;
    document.body.appendChild(toast);
    requestAnimationFrame(() => toast.classList.add("hltr-toast-visible"));
    setTimeout(() => {
      toast.classList.remove("hltr-toast-visible");
      setTimeout(() => toast.remove(), 250);
    }, 2200);
  }

  // ---- Note + theme editor popup ----

  function openComposerForExisting(markEl) {
    const id = markEl.dataset.hltrId;
    chrome.storage.local.get({ highlights: [] }, (data) => {
      const entry = data.highlights.find((h) => h.id === id);
      if (entry) openComposer(markEl, entry, false);
    });
  }

  function openComposer(markEl, entry, isNew) {
    removeComposer();
    const rect = markEl.getBoundingClientRect();

    chrome.storage.local.get({ themes: [] }, (data) => {
      composerEl = document.createElement("div");
      composerEl.className = "hltr-note-popup";

      if (isNew) {
        const label = document.createElement("div");
        label.className = "hltr-composer-label";
        label.textContent = "Add your thoughts (optional)";
        composerEl.appendChild(label);
      }

      const textarea = document.createElement("textarea");
      textarea.placeholder = "What does this make you think of?";
      textarea.value = entry.note || "";
      composerEl.appendChild(textarea);

      const themeRow = document.createElement("div");
      themeRow.className = "hltr-theme-row";

      const select = document.createElement("select");
      select.className = "hltr-theme-select";

      const noneOpt = document.createElement("option");
      noneOpt.value = "";
      noneOpt.textContent = "No category";
      select.appendChild(noneOpt);

      data.themes.forEach((t) => {
        const opt = document.createElement("option");
        opt.value = t;
        opt.textContent = t;
        if (t === entry.theme) opt.selected = true;
        select.appendChild(opt);
      });

      const newOpt = document.createElement("option");
      newOpt.value = "__new__";
      newOpt.textContent = "+ New topic";
      select.appendChild(newOpt);

      const newThemeInput = document.createElement("input");
      newThemeInput.type = "text";
      newThemeInput.placeholder = "Enter new topic name";
      newThemeInput.className = "hltr-theme-new-input";
      newThemeInput.hidden = true;

      select.addEventListener("change", () => {
        newThemeInput.hidden = select.value !== "__new__";
        if (!newThemeInput.hidden) newThemeInput.focus();
      });

      themeRow.appendChild(select);
      composerEl.appendChild(themeRow);
      composerEl.appendChild(newThemeInput);

      let pendingScreenshot = entry.screenshot || null;

      const shotRow = document.createElement("div");
      shotRow.className = "hltr-shot-row";

      const shotBtn = document.createElement("button");
      shotBtn.className = "hltr-shot-btn";
      shotBtn.title = "Screenshot";
      shotBtn.textContent = "📷";
      shotBtn.addEventListener("click", async () => {
        shotBtn.disabled = true;
        shotBtn.textContent = "⏳";
        composerEl.classList.add("hltr-composer-hidden");
        await waitForRepaint();
        const full = await captureFullScreenshot();
        if (!full) {
          composerEl.classList.remove("hltr-composer-hidden");
          shotBtn.disabled = false;
          shotBtn.textContent = "📷";
          showToast("Screenshot failed, please try again");
          return;
        }
        const suggested = getHighlightRelRect(entry.id);
        openScreenshotSelector(
          full,
          suggested,
          async (rect) => {
            const cropped = await cropImageByRelRect(full, rect);
            composerEl.classList.remove("hltr-composer-hidden");
            shotBtn.disabled = false;
            shotBtn.textContent = "📷";
            if (cropped) {
              pendingScreenshot = cropped;
              updateShotPreview();
            }
          },
          () => {
            composerEl.classList.remove("hltr-composer-hidden");
            shotBtn.disabled = false;
            shotBtn.textContent = "📷";
          }
        );
      });

      const annotateBtn = document.createElement("button");
      annotateBtn.className = "hltr-shot-btn";
      annotateBtn.title = "Annotate screenshot";
      annotateBtn.textContent = "🖊";
      annotateBtn.addEventListener("click", async () => {
        annotateBtn.disabled = true;
        annotateBtn.textContent = "⏳";
        composerEl.classList.add("hltr-composer-hidden");
        await waitForRepaint();
        const full = await captureFullScreenshot();
        if (!full) {
          composerEl.classList.remove("hltr-composer-hidden");
          annotateBtn.disabled = false;
          annotateBtn.textContent = "🖊";
          showToast("Screenshot failed, please try again");
          return;
        }
        const suggested = getHighlightRelRect(entry.id);
        openScreenshotSelector(
          full,
          suggested,
          async (rect) => {
            const cropped = await cropImageByRelRect(full, rect);
            annotateBtn.disabled = false;
            annotateBtn.textContent = "🖊";
            if (!cropped) {
              composerEl.classList.remove("hltr-composer-hidden");
              return;
            }
            openScreenshotEditor(cropped, (finalUrl) => {
              composerEl.classList.remove("hltr-composer-hidden");
              pendingScreenshot = finalUrl;
              updateShotPreview();
            });
          },
          () => {
            composerEl.classList.remove("hltr-composer-hidden");
            annotateBtn.disabled = false;
            annotateBtn.textContent = "🖊";
          }
        );
      });

      shotRow.appendChild(shotBtn);
      shotRow.appendChild(annotateBtn);
      composerEl.appendChild(shotRow);

      const shotPreviewWrap = document.createElement("div");
      shotPreviewWrap.className = "hltr-shot-preview-wrap";
      composerEl.appendChild(shotPreviewWrap);

      function updateShotPreview() {
        shotPreviewWrap.innerHTML = "";
        if (!pendingScreenshot) return;
        const img = document.createElement("img");
        img.className = "hltr-shot-preview";
        img.src = pendingScreenshot;
        const rm = document.createElement("button");
        rm.className = "hltr-shot-remove";
        rm.textContent = "Remove screenshot";
        rm.addEventListener("click", () => {
          pendingScreenshot = null;
          updateShotPreview();
        });
        shotPreviewWrap.appendChild(img);
        shotPreviewWrap.appendChild(rm);
      }
      updateShotPreview();

      const actions = document.createElement("div");
      actions.className = "hltr-note-actions";

      const speakBtn = document.createElement("button");
      speakBtn.className = "hltr-note-cancel hltr-speak-btn";
      speakBtn.textContent = "🔊";
      speakBtn.title = "Read this text aloud";
      speakBtn.addEventListener("click", () => toggleSpeak(entry.text, speakBtn));

      const deleteBtn = document.createElement("button");
      deleteBtn.className = "hltr-note-cancel";
      deleteBtn.textContent = "Delete highlight";
      deleteBtn.addEventListener("click", () => {
        removeHighlight(entry.id, markEl);
        removeComposer();
      });

      const saveBtn = document.createElement("button");
      saveBtn.className = "hltr-note-save";
      saveBtn.textContent = "Save";
      saveBtn.addEventListener("click", () => {
        let theme = select.value;
        if (theme === "__new__") {
          theme = newThemeInput.value.trim();
          if (theme) addThemeIfNew(theme);
        }
        finalizeComposer(entry.id, textarea.value.trim(), theme, pendingScreenshot);
        removeComposer();
      });

      actions.appendChild(speakBtn);
      actions.appendChild(deleteBtn);
      actions.appendChild(saveBtn);
      composerEl.appendChild(actions);

      document.body.appendChild(composerEl);
      composerEl.style.left = rect.left + window.scrollX + "px";
      composerEl.style.top = rect.bottom + window.scrollY + 8 + "px";
      textarea.focus();
    });
  }

  function removeComposer() {
    if (composerEl) {
      composerEl.remove();
      composerEl = null;
    }
    speechSynthesis.cancel();
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

  function toggleSpeak(text, buttonEl) {
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

  function addThemeIfNew(theme) {
    chrome.storage.local.get({ themes: [] }, (data) => {
      if (!data.themes.includes(theme)) {
        chrome.storage.local.set({ themes: [...data.themes, theme] });
      }
    });
  }

  function finalizeComposer(id, note, theme, screenshot) {
    chrome.storage.local.get({ highlights: [] }, (data) => {
      let updatedEntry = null;
      const highlights = data.highlights.map((h) => {
        if (h.id === id) {
          updatedEntry = { ...h, note, theme, screenshot: screenshot || null, syncStatus: "pending" };
          return updatedEntry;
        }
        return h;
      });
      chrome.storage.local.set({ highlights }, () => {
        if (!updatedEntry) return;
        if (theme) {
          updatedEntry.themeCount = highlights.filter((h) => h.theme === theme).length;
        }
        chrome.runtime.sendMessage({ type: "sync-to-notion", entry: updatedEntry }, (res) => {
          if (res && res.ok) {
            showToast("Saved and synced to Notion");
            chrome.storage.local.get({ highlights: [] }, (d2) => {
              const hl = d2.highlights.map((h) => (h.id === id ? { ...h, syncStatus: "synced" } : h));
              chrome.storage.local.set({ highlights: hl });
            });
          } else if (res && res.error && res.error.includes("not set yet")) {
            showToast("Saved locally (Notion not connected yet — set it up in Options)");
          } else {
            showToast("Saved, but Notion sync failed — you can retry from the list later");
          }
        });
      });
    });
  }

  function removeHighlight(id, markEl) {
    const parent = markEl.parentNode;
    while (markEl.firstChild) parent.insertBefore(markEl.firstChild, markEl);
    parent.removeChild(markEl);

    chrome.storage.local.get({ highlights: [] }, (data) => {
      const highlights = data.highlights.filter((h) => h.id !== id);
      chrome.storage.local.set({ highlights });
    });
  }
})();
