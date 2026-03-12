(() => {
  const root = document.documentElement;
  let pending = 0;
  let releaseTimer = 0;

  const markReady = () => {
    root.classList.add("page-ready");
  };

  const setBusy = (delta) => {
    pending = Math.max(0, pending + delta);
    window.clearTimeout(releaseTimer);
    if (pending > 0) {
      root.classList.add("page-progress-active");
      return;
    }
    releaseTimer = window.setTimeout(() => {
      root.classList.remove("page-progress-active");
    }, 160);
  };

  const wrapAsync = (value) => {
    setBusy(1);
    return Promise.resolve(value).finally(() => {
      window.setTimeout(() => {
        setBusy(-1);
        scheduleCourseRepair();
      }, 180);
    });
  };

  const pulseRoute = () => {
    root.classList.remove("page-route-swap");
    window.requestAnimationFrame(() => {
      root.classList.add("page-route-swap");
    });
  };

  let courseRepairTimer = 0;
  const autoExpandedCourses = new Set();

  const getStore = () => {
    const appRoot = document.getElementById("app");
    if (appRoot && appRoot.__vue__ && appRoot.__vue__.$store) {
      return appRoot.__vue__.$store;
    }

    const nodes = document.querySelectorAll("#app, #app *");
    for (const node of nodes) {
      if (node && node.__vue__ && node.__vue__.$store) {
        return node.__vue__.$store;
      }
    }

    return null;
  };

  const collectCollapsedTitleIds = (items) => {
    const titleIndexes = [];
    items.forEach((item, index) => {
      if (item && item.content && item.content.titleLevel === 1) {
        titleIndexes.push(index);
      }
    });

    const hidden = [];
    titleIndexes.forEach((start, index) => {
      const header = (items[start] && items[start].content) || {};
      if (header.titleLevelCaret === 1) {
        return;
      }

      const end = index < titleIndexes.length - 1 ? titleIndexes[index + 1] : items.length;
      items.slice(start + 1, end).forEach((item) => {
        const id = item && item.content && item.content.id;
        if (id != null) {
          hidden.push(id);
        }
      });
    });

    return [...new Set(hidden)];
  };

  const hasSameIds = (left, right) => {
    if (!Array.isArray(left) || !Array.isArray(right) || left.length !== right.length) {
      return false;
    }
    return left.every((id) => right.includes(id));
  };

  const hasVisibleCourseBlocks = () => {
    const selectors = [".textContent", ".quesContent", ".questionContent"];
    return selectors.some((selector) =>
      [...document.querySelectorAll(selector)].some(
        (node) => node && (node.offsetWidth || node.offsetHeight || node.getClientRects().length)
      )
    );
  };

  const shouldForceExpandTitles = (courseState, items) => {
    const titleItems = items.filter((item) => item && item.content && item.content.titleLevel === 1);
    if (!titleItems.length || !items.some((item) => item && item.contentType === 2)) {
      return false;
    }

    if (autoExpandedCourses.has(courseState.courseId)) {
      return false;
    }

    return titleItems.every((item) => item.content.titleLevelCaret !== 1) && !hasVisibleCourseBlocks();
  };

  const syncCourseTitleVisibility = () => {
    if (!window.location.hash.includes("/course")) {
      return;
    }

    const store = getStore();
    const courseState = store && store.state && store.state.c;
    const items = courseState && courseState.courseContentData;
    if (!courseState || !Array.isArray(items) || items.length === 0) {
      return;
    }

    if (shouldForceExpandTitles(courseState, items)) {
      items.forEach((item) => {
        if (item && item.content && item.content.titleLevel === 1) {
          item.content.titleLevelCaret = 1;
        }
      });
      autoExpandedCourses.add(courseState.courseId);
      if (typeof store.commit === "function") {
        store.commit("c/setCourseContent", items);
        store.commit("c/clearTitleIds");
        window.setTimeout(syncCourseTitleVisibility, 120);
        return;
      }
      courseState.titleIds = [];
      return;
    }

    const desiredIds = collectCollapsedTitleIds(items);
    const currentIds = Array.isArray(courseState.titleIds) ? courseState.titleIds : [];
    if (hasSameIds(currentIds, desiredIds)) {
      return;
    }

    if (typeof store.commit === "function") {
      store.commit("c/clearTitleIds");
      if (desiredIds.length) {
        store.commit("c/addTitleIds", desiredIds);
      }
      return;
    }

    courseState.titleIds = desiredIds;
  };

  const uiFlags = {
    focus: "page-focus-mode",
    nav: "page-nav-collapsed"
  };

  const isVisible = (node) => !!node && !!(node.offsetWidth || node.offsetHeight || node.getClientRects().length);

  const removeCourseWorkbench = () => {
    const workbench = document.getElementById("page-course-workbench");
    if (workbench) {
      workbench.remove();
    }
    root.classList.remove("page-course-page", "page-has-workbench");
  };

  const applyStoredUiFlags = () => {
    Object.values(uiFlags).forEach((flag) => {
      const enabled = window.localStorage.getItem(flag) === "1";
      root.classList.toggle(flag, enabled);
    });
  };

  const persistUiFlag = (flag, enabled) => {
    root.classList.toggle(flag, enabled);
    window.localStorage.setItem(flag, enabled ? "1" : "0");
  };

  const getCourseState = () => {
    const store = getStore();
    const courseState = store && store.state && store.state.c;
    return { store, courseState };
  };

  const getCourseName = () => {
    const active = document.querySelector(".swiper-slide-active .courseName");
    const text = active ? active.innerText.replace(/\s+/g, " ").trim() : "";
    return text || "当前课程";
  };

  const collectQuestionNumbers = () => {
    const seen = new Set();
    const values = [];
    document.querySelectorAll(".quesContent").forEach((node) => {
      if (!isVisible(node)) {
        return;
      }
      const match = node.innerText.match(/题号[:：]?\s*([^\s\n]+)/);
      if (!match) {
        return;
      }
      const value = match[1].trim();
      if (!value || seen.has(value)) {
        return;
      }
      seen.add(value);
      values.push(value);
    });
    return values;
  };

  const setAllCourseSections = (expanded) => {
    const { store, courseState } = getCourseState();
    if (!store || !courseState || !Array.isArray(courseState.courseContentData)) {
      return;
    }

    const nextItems = courseState.courseContentData.map((item) => {
      if (!item || !item.content || item.content.titleLevel !== 1) {
        return item;
      }
      return {
        ...item,
        content: {
          ...item.content,
          titleLevelCaret: expanded ? 1 : 0
        }
      };
    });

    store.commit("c/setCourseContent", nextItems);
    store.commit("c/clearTitleIds");
    if (!expanded) {
      const hiddenIds = collectCollapsedTitleIds(nextItems);
      if (hiddenIds.length) {
        store.commit("c/addTitleIds", hiddenIds);
      }
    }
    window.setTimeout(() => scheduleCourseRepair(80), 40);
  };

  const collectSectionEntries = () => {
    const entries = [];
    const seen = new Set();
    document.querySelectorAll(".content .textContent").forEach((node, index) => {
      if (!isVisible(node)) {
        return;
      }
      const rawText = node.innerText.replace(/\s+/g, " ").trim();
      if (!rawText) {
        return;
      }
      const label = rawText.split("\n")[0].trim();
      if (!label || label.length > 34 || seen.has(label)) {
        return;
      }
      seen.add(label);
      const targetId = `page-section-${index}`;
      node.dataset.pageSection = targetId;
      entries.push({
        id: targetId,
        label,
        detail: rawText.length > label.length ? rawText.slice(0, 48) : "",
        element: node
      });
    });
    return entries;
  };

  const updateActiveCourseSection = () => {
    const links = [...document.querySelectorAll(".page-section-link")];
    if (!links.length) {
      return;
    }

    let activeId = links[0].dataset.target || "";
    let bestOffset = Number.POSITIVE_INFINITY;
    links.forEach((link) => {
      const target = document.querySelector(`[data-page-section="${link.dataset.target}"]`);
      if (!target) {
        return;
      }
      const rect = target.getBoundingClientRect();
      const offset = Math.abs(rect.top - 140);
      if (rect.top <= window.innerHeight * 0.65 && offset < bestOffset) {
        bestOffset = offset;
        activeId = link.dataset.target;
      }
    });

    links.forEach((link) => {
      link.classList.toggle("is-active", link.dataset.target === activeId);
    });
  };

  const renderCourseWorkbench = () => {
    applyStoredUiFlags();
    if (!window.location.hash.includes("/course")) {
      removeCourseWorkbench();
      return;
    }
    root.classList.add("page-course-page");
    root.classList.remove("page-has-workbench");
    removeCourseWorkbench();
  };

  const scheduleCourseRepair = (delay = 80) => {
    window.clearTimeout(courseRepairTimer);
    courseRepairTimer = window.setTimeout(() => {
      syncCourseTitleVisibility();
      renderCourseWorkbench();
      renderBulkDownloadButton();
      scheduleMarkdownAnswerRender(40);
      window.setTimeout(updateActiveCourseSection, 180);
    }, delay);
  };

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", markReady, { once: true });
  } else {
    markReady();
  }

  if (typeof window.fetch === "function") {
    const nativeFetch = window.fetch.bind(window);
    window.fetch = (...args) => wrapAsync(nativeFetch(...args));
  }

  const nativeOpen = XMLHttpRequest.prototype.open;
  const nativeSend = XMLHttpRequest.prototype.send;

  XMLHttpRequest.prototype.open = function (...args) {
    this.addEventListener(
      "loadend",
      () => {
        window.setTimeout(() => {
          setBusy(-1);
          scheduleCourseRepair();
        }, 180);
      },
      { once: true }
    );
    return nativeOpen.apply(this, args);
  };

  XMLHttpRequest.prototype.send = function (...args) {
    setBusy(1);
    return nativeSend.apply(this, args);
  };

  const isIOSDevice = () => {
    const ua = navigator.userAgent || "";
    return /iPad|iPhone|iPod/.test(ua) || (ua.includes("Mac") && "ontouchend" in document);
  };

  window.submitAnswerDownload = ({ html, name }) => {
    const form = document.createElement("form");
    form.method = "POST";
    form.action = "/downloadAnswers";
    form.target = isIOSDevice() ? "_self" : "_blank";
    form.style.display = "none";

    [
      ["html", html || ""],
      ["name", name || "answer-export"]
    ].forEach(([fieldName, fieldValue]) => {
      const textarea = document.createElement("textarea");
      textarea.name = fieldName;
      textarea.value = fieldValue;
      textarea.style.display = "none";
      form.appendChild(textarea);
    });

    document.body.appendChild(form);
    form.submit();
    form.remove();
  };

  const submitDownloadForm = (parsedUrl, target) => {
    const html = parsedUrl.searchParams.get("html");
    if (html == null) {
      return false;
    }

    const form = document.createElement("form");
    form.method = "POST";
    form.action = parsedUrl.pathname;
    form.target = isIOSDevice() ? "_self" : (target || "_blank");
    form.style.display = "none";

    [["html", html], ["name", parsedUrl.searchParams.get("name") || "answer-export"]].forEach(
      ([name, value]) => {
        const input = document.createElement("input");
        input.type = "hidden";
        input.name = name;
        input.value = value;
        form.appendChild(input);
      }
    );

    document.body.appendChild(form);
    form.submit();
    form.remove();
    return true;
  };

  if (typeof window.open === "function") {
    const nativeWindowOpen = window.open.bind(window);
    window.open = (...args) => {
      const rawUrl = String(args[0] || "");
      let parsedUrl = null;

      try {
        parsedUrl = new URL(rawUrl, window.location.origin);
      } catch (error) {
        parsedUrl = null;
      }

      if (parsedUrl && parsedUrl.origin === window.location.origin) {
        if (parsedUrl.pathname === "/downloadAnswers") {
          root.classList.add("page-progress-active");
          window.setTimeout(() => root.classList.remove("page-progress-active"), 1200);
          if (submitDownloadForm(parsedUrl, typeof args[1] === "string" ? args[1] : "_blank")) {
            return null;
          }
        }

        if (parsedUrl.pathname === "/getWebFile") {
          root.classList.add("page-progress-active");
          window.setTimeout(() => root.classList.remove("page-progress-active"), 1200);
        }
      }

      return nativeWindowOpen(...args);
    };
  }

  const imageExtensions = new Set([".png", ".jpg", ".jpeg", ".gif", ".bmp", ".svg", ".webp", ".jfif"]);
  const bundleButtonState = {
    busy: false
  };

  const getAttachmentExtension = (value) => {
    const clean = String(value || "").split("?")[0].trim();
    const match = clean.match(/(\.[a-z0-9]+)$/i);
    return match ? match[1].toLowerCase() : "";
  };

  const normalizeBundleUrl = (value) => {
    const raw = String(value || "").trim();
    if (!raw) {
      return "";
    }
    if (/^https?:\/\//i.test(raw)) {
      return raw;
    }
    return raw.startsWith("/") ? raw : `/exam/${raw.replace(/^\/+/, "")}`;
  };

  const shouldBundleAttachment = (attachment, options = {}) => {
    if (!attachment || typeof attachment !== "object") {
      return false;
    }

    const url = normalizeBundleUrl(
      attachment.attachmentLinkAddress || attachment.videoFile || attachment.url || attachment.path
    );
    if (!url) {
      return false;
    }

    if (options.force) {
      return true;
    }

    const attachmentType = Number(attachment.attachmentType);
    if ([2, 3, 4].includes(attachmentType)) {
      return true;
    }

    const extension =
      getAttachmentExtension(attachment.attachmentExtraName) ||
      getAttachmentExtension(attachment.attachmentName) ||
      getAttachmentExtension(attachment.attachmentLinkAddress) ||
      getAttachmentExtension(attachment.videoFile);

    if (extension && imageExtensions.has(extension)) {
      return false;
    }

    return Boolean(attachment.attachmentName || extension || attachment.attachmentSize);
  };

  const buildBundleName = (attachment, fallbackLabel) => {
    const rawName = String(attachment?.attachmentName || attachment?.name || fallbackLabel || "file").trim();
    const extension =
      getAttachmentExtension(rawName) ||
      getAttachmentExtension(attachment?.attachmentExtraName) ||
      getAttachmentExtension(attachment?.attachmentLinkAddress) ||
      getAttachmentExtension(attachment?.videoFile);

    if (!rawName) {
      return `${fallbackLabel || "file"}${extension}`;
    }

    return getAttachmentExtension(rawName) ? rawName : `${rawName}${extension}`;
  };

  const pushBundleItem = (items, seen, attachment, fallbackLabel, options = {}) => {
    if (!shouldBundleAttachment(attachment, options)) {
      return;
    }

    const url = normalizeBundleUrl(
      attachment.attachmentLinkAddress || attachment.videoFile || attachment.url || attachment.path
    );
    if (!url) {
      return;
    }

    const key = url.replace(/\s+/g, "+").toLowerCase();
    if (seen.has(key)) {
      return;
    }

    seen.add(key);
    items.push({
      url,
      name: buildBundleName(attachment, fallbackLabel)
    });
  };

  const collectAttachmentList = (list, items, seen, fallbackPrefix) => {
    if (!Array.isArray(list)) {
      return;
    }

    list.forEach((attachment, index) => {
      pushBundleItem(items, seen, attachment, `${fallbackPrefix}-${index + 1}`);
    });
  };

  const collectCourseStateFiles = (items, seen) => {
    const { courseState } = getCourseState();
    const contentData = courseState && courseState.courseContentData;
    if (!Array.isArray(contentData)) {
      return;
    }

    contentData.forEach((entry, entryIndex) => {
      const content = entry && entry.content;
      if (!content) {
        return;
      }

      if (Number(entry.contentType) === 1) {
        pushBundleItem(items, seen, content, `file-${entryIndex + 1}`, { force: true });
      }

      collectAttachmentList(content.attachmentEntityList, items, seen, `attachment-${entryIndex + 1}`);

      if (Array.isArray(content.childList)) {
        content.childList.forEach((child, childIndex) => {
          collectAttachmentList(
            child && child.attachmentEntityList,
            items,
            seen,
            `attachment-${entryIndex + 1}-${childIndex + 1}`
          );
        });
      }
    });
  };

  const collectVisibleComponentFiles = (items, seen) => {
    document
      .querySelectorAll(".ant-modal, .content-box, .file, .quesContent, .btn.file-btn, .right-box, .left-box")
      .forEach((node, nodeIndex) => {
        if (!isVisible(node) || !node.__vue__) {
          return;
        }

        const vm = node.__vue__;
        [vm.currPreview, vm.data, vm.parentData].forEach((value, valueIndex) => {
          if (!value || typeof value !== "object") {
            return;
          }

          pushBundleItem(items, seen, value, `visible-${nodeIndex + 1}-${valueIndex + 1}`, {
            force: Boolean(value.attachmentName)
          });
          collectAttachmentList(
            value.attachmentEntityList,
            items,
            seen,
            `visible-${nodeIndex + 1}-${valueIndex + 1}`
          );
        });
      });
  };

  const collectCurrentPageFiles = () => {
    const items = [];
    const seen = new Set();
    collectCourseStateFiles(items, seen);
    collectVisibleComponentFiles(items, seen);
    return items;
  };

  const findDownloadPageButton = () =>
    [...document.querySelectorAll(".ant-btn, button")].find(
      (button) => isVisible(button) && button.innerText.replace(/\s+/g, "") === "下载本页"
    );

  const removeBulkDownloadButton = () => {
    const button = document.getElementById("page-bundle-button");
    if (button) {
      button.remove();
    }
  };

  const parseResponseFilename = (headerValue, fallback) => {
    if (!headerValue) {
      return fallback;
    }

    const encodedMatch = headerValue.match(/filename\*=UTF-8''([^;]+)/i);
    if (encodedMatch) {
      try {
        return decodeURIComponent(encodedMatch[1]);
      } catch (error) {
        return fallback;
      }
    }

    const plainMatch = headerValue.match(/filename="?([^";]+)"?/i);
    return plainMatch ? plainMatch[1] : fallback;
  };

  const triggerBlobDownload = (blob, filename) => {
    const blobUrl = window.URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = blobUrl;
    link.download = filename;
    link.style.display = "none";
    document.body.appendChild(link);
    link.click();
    link.remove();
    window.setTimeout(() => window.URL.revokeObjectURL(blobUrl), 1500);
  };

  const downloadCurrentPageFiles = async () => {
    const items = collectCurrentPageFiles();
    if (!items.length) {
      window.alert("当前页没有可打包的文件。");
      return;
    }

    bundleButtonState.busy = true;
    renderBulkDownloadButton();

    try {
      const response = await fetch("/downloadBundle", {
        method: "POST",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          items,
          name: `${getCourseName()}-files`
        })
      });

      if (!response.ok) {
        let message = `打包下载失败 (${response.status})`;
        const errorText = await response.text();
        if (errorText) {
          try {
            const data = JSON.parse(errorText);
            if (data && data.message) {
              message = data.message;
            }
          } catch (error) {
            message = errorText.trim() || message;
          }
        }
        throw new Error(message);
      }

      const blob = await response.blob();
      const filename = parseResponseFilename(
        response.headers.get("content-disposition"),
        `${getCourseName()}-files.zip`
      );
      triggerBlobDownload(blob, filename);
    } catch (error) {
      window.alert(error && error.message ? error.message : "打包下载失败。");
    } finally {
      bundleButtonState.busy = false;
      renderBulkDownloadButton();
    }
  };

  const renderBulkDownloadButton = () => {
    const items = collectCurrentPageFiles();
    const count = items.length;
    const anchorButton = findDownloadPageButton();
    let button = document.getElementById("page-bundle-button");

    if ((!anchorButton || !count) && !bundleButtonState.busy) {
      removeBulkDownloadButton();
      return;
    }

    if (!anchorButton) {
      return;
    }

    if (!button) {
      button = document.createElement("button");
      button.type = "button";
      button.id = "page-bundle-button";
      button.addEventListener("click", () => {
        if (!bundleButtonState.busy) {
          downloadCurrentPageFiles();
        }
      });
    }

    button.className = `${anchorButton.className} page-bundle-button`.trim();
    button.style.marginLeft = "5px";
    button.style.marginRight = "5px";
    button.disabled = bundleButtonState.busy;
    button.classList.toggle("is-busy", bundleButtonState.busy);
    button.textContent = bundleButtonState.busy ? "打包中..." : `打包下载本页 (${count})`;

    if (button.parentElement !== anchorButton.parentElement || button.previousElementSibling !== anchorButton) {
      anchorButton.insertAdjacentElement("afterend", button);
    }
  };

  const markdownDrafts = new Map();
  const markdownUploadedNames = new Map();
  const markdownPlainTextMode = new Map();
  const markdownPlainTextRenders = new Map();
  const markdownRenderCache = new Map();
  const markdownBlobDownloadUrls = new Map();
  const handwritePatchedVms = new WeakSet();
  const PLAIN_TEXT_MAX_DENSITY = 30;
  let markdownRenderTimer = 0;

  const normalizeActionLabel = (value) => String(value || "").replace(/\s+/g, "").trim();

  const hasVisibleActionText = (root, expectedText) =>
    [...root.querySelectorAll(".ant-btn, button")].some(
      (button) => isVisible(button) && normalizeActionLabel(button.innerText).includes(expectedText)
    );

  const isQuestionVm = (vm) =>
    Boolean(
      vm &&
        vm.data &&
        typeof vm.data === "object" &&
        vm.data.id != null &&
        (vm.data.courseId != null || vm.data.paperId != null) &&
        (typeof vm.openWriteModal === "function" || typeof vm.CropperFinish === "function")
    );

  const findQuestionVm = (startNode) => {
    let node = startNode;
    for (let depth = 0; node && depth < 20; depth += 1, node = node.parentElement) {
      if (isQuestionVm(node.__vue__)) {
        return node.__vue__;
      }
    }

    const scope =
      startNode.closest(".quesContent, .question-box, .myAnswer, .content-box, .submitAnswer") || startNode.parentElement;
    if (!scope) {
      return null;
    }

    const candidates = [scope, ...scope.querySelectorAll("*")];
    for (const candidate of candidates) {
      if (isQuestionVm(candidate.__vue__)) {
        return candidate.__vue__;
      }
    }
    return null;
  };

  const getQuestionContext = (vm) => {
    if (!isQuestionVm(vm)) {
      return null;
    }

    const entityType = vm.data.courseId != null ? "course" : vm.data.paperId != null ? "paper" : "";
    const entityId = Number(vm.data.courseId != null ? vm.data.courseId : vm.data.paperId);
    const questionId = Number(vm.data.id);
    if (!entityType || !entityId || !questionId) {
      return null;
    }

    return {
      entityType,
      entityId,
      questionId,
      questionNumber: vm.data.questionNumber || questionId,
      key: `${entityType}:${entityId}:${questionId}`
    };
  };

  const normalizeMarkdownFilename = (value) => String(value || "").trim();

  const getRememberedMarkdownUploads = (questionKey) => {
    const key = String(questionKey || "");
    if (!markdownUploadedNames.has(key)) {
      markdownUploadedNames.set(key, new Set());
    }
    return markdownUploadedNames.get(key);
  };

  const hasRememberedMarkdownUpload = (questionKey, filename) =>
    getRememberedMarkdownUploads(questionKey).has(normalizeMarkdownFilename(filename));

  const rememberMarkdownUpload = (questionKey, filename) => {
    const normalized = normalizeMarkdownFilename(filename);
    if (!normalized) {
      return;
    }
    getRememberedMarkdownUploads(questionKey).add(normalized);
  };

  const getPlainTextMode = (questionKey) => markdownPlainTextMode.get(String(questionKey || "")) === true;

  const setPlainTextMode = (questionKey, enabled) => {
    markdownPlainTextMode.set(String(questionKey || ""), Boolean(enabled));
  };

  const normalizePlainTextSource = (value) => String(value || "").replace(/\r\n?/g, "\n");

  const getPlainTextDensity = (char) => {
    if (char === "\t") {
      return 2;
    }
    if (char === " ") {
      return 0.5;
    }
    return /[\u0000-\u00ff]/.test(char) ? 0.56 : 1;
  };

  const wrapPlainTextLine = (line, maxDensity = PLAIN_TEXT_MAX_DENSITY) => {
    const chunks = [];
    let current = "";
    let currentDensity = 0;

    [...String(line || "")].forEach((char) => {
      const density = getPlainTextDensity(char);
      if (current && currentDensity + density > maxDensity) {
        chunks.push(current);
        current = char;
        currentDensity = density;
        return;
      }
      current += char;
      currentDensity += density;
    });

    if (current || !chunks.length) {
      chunks.push(current);
    }
    return chunks;
  };

  const wrapPlainTextByDensity = (value, maxDensity = PLAIN_TEXT_MAX_DENSITY) => {
    const normalized = normalizePlainTextSource(value).trim();
    if (!normalized) {
      return [];
    }

    const lines = [];
    normalized.split("\n").forEach((rawLine) => {
      const line = rawLine.replace(/\s+$/g, "");
      if (!line.trim()) {
        lines.push("");
        return;
      }
      wrapPlainTextLine(line, maxDensity).forEach((wrappedLine) => {
        lines.push(wrappedLine);
      });
    });
    return lines;
  };

  const rememberPlainTextRender = (questionKey, sourceText) => {
    const key = String(questionKey || "");
    const normalized = normalizePlainTextSource(sourceText).trim();
    if (!normalized) {
      markdownPlainTextRenders.delete(key);
      return null;
    }

    const state = {
      sourceText: normalized,
      lines: wrapPlainTextByDensity(normalized),
      updatedAt: Date.now()
    };
    markdownPlainTextRenders.set(key, state);
    return state;
  };

  const getPlainTextRender = (questionKey) => markdownPlainTextRenders.get(String(questionKey || "")) || null;

  const clearPlainTextRender = (questionKey) => {
    markdownPlainTextRenders.delete(String(questionKey || ""));
  };

  const buildAnswerHash = (value) => {
    const source = String(value || "");
    let hash = 2166136261;
    for (let index = 0; index < source.length; index += 1) {
      hash ^= source.charCodeAt(index);
      hash = Math.imul(hash, 16777619);
    }
    return (hash >>> 0).toString(16).padStart(8, "0");
  };

  const buildPlainTextImageFilename = (value) =>
    `plain-answer-${buildAnswerHash(normalizePlainTextSource(value).trim())}.png`;

  const buildMarkdownImageFilename = (value) =>
    `md-answer-${buildAnswerHash(normalizePlainTextSource(value).trim())}.png`;

  const clearMarkdownBlobDownloadUrl = (questionKey) => {
    const key = String(questionKey || "");
    const objectUrl = markdownBlobDownloadUrls.get(key);
    if (objectUrl) {
      window.URL.revokeObjectURL(objectUrl);
      markdownBlobDownloadUrls.delete(key);
    }
  };

  const rememberMarkdownBlobDownloadUrl = (questionKey, objectUrl) => {
    const key = String(questionKey || "");
    clearMarkdownBlobDownloadUrl(key);
    markdownBlobDownloadUrls.set(key, objectUrl);
    return objectUrl;
  };

  const canvasToBlob = (canvas) =>
    new Promise((resolve, reject) => {
      canvas.toBlob((blob) => {
        if (blob) {
          resolve(blob);
          return;
        }
        reject(new Error("前端纯文本图片生成失败。"));
      }, "image/png");
    });

  const createPlainTextImageBlob = async (renderState) => {
    const lines = renderState && Array.isArray(renderState.lines) && renderState.lines.length
      ? renderState.lines
      : [" "];
    const canvas = document.createElement("canvas");
    const width = 1200;
    const paddingX = 72;
    const paddingY = 56;
    const fontSize = 34;
    const lineHeight = 54;
    const height = paddingY * 2 + Math.max(lines.length, 1) * lineHeight;
    const scale = Math.max(2, Math.ceil(window.devicePixelRatio || 1));
    const context2d = canvas.getContext("2d");
    if (!context2d) {
      throw new Error("浏览器不支持纯文本图片生成。");
    }

    canvas.width = width * scale;
    canvas.height = height * scale;
    canvas.style.width = `${width}px`;
    canvas.style.height = `${height}px`;

    context2d.scale(scale, scale);
    context2d.fillStyle = "#ffffff";
    context2d.fillRect(0, 0, width, height);
    context2d.textBaseline = "top";
    context2d.fillStyle = "#1e293b";
    context2d.font = `600 ${fontSize}px "Noto Serif SC", "Source Han Serif SC", "Songti SC", serif`;

    lines.forEach((line, index) => {
      context2d.fillText(line || " ", paddingX, paddingY + index * lineHeight);
    });

    return canvasToBlob(canvas);
  };

  const wait = (delay) =>
    new Promise((resolve) => {
      window.setTimeout(resolve, delay);
    });

  const loadImageFromBlob = (blob) =>
    new Promise((resolve, reject) => {
      const objectUrl = window.URL.createObjectURL(blob);
      const image = new Image();
      image.onload = () => {
        window.URL.revokeObjectURL(objectUrl);
        resolve(image);
      };
      image.onerror = () => {
        window.URL.revokeObjectURL(objectUrl);
        reject(new Error("图片加载失败。"));
      };
      image.src = objectUrl;
    });

  const cropImageBlobWhitespace = async (blob, options = {}) => {
    if (!blob) {
      throw new Error("没有可裁剪的图片。");
    }

    const image = await loadImageFromBlob(blob);
    const sourceCanvas = document.createElement("canvas");
    sourceCanvas.width = image.naturalWidth || image.width;
    sourceCanvas.height = image.naturalHeight || image.height;
    const sourceContext = sourceCanvas.getContext("2d", { willReadFrequently: true });
    if (!sourceContext) {
      return blob;
    }

    sourceContext.drawImage(image, 0, 0);
    const { data, width, height } = sourceContext.getImageData(0, 0, sourceCanvas.width, sourceCanvas.height);
    const threshold = Number(options.threshold || 248);
    const paddingX = Number(options.paddingX || 28);
    const paddingY = Number(options.paddingY || 24);
    const minWidth = Number(options.minWidth || 320);
    const minHeight = Number(options.minHeight || 120);

    let minX = width;
    let minY = height;
    let maxX = -1;
    let maxY = -1;

    for (let y = 0; y < height; y += 1) {
      for (let x = 0; x < width; x += 1) {
        const offset = (y * width + x) * 4;
        const alpha = data[offset + 3];
        if (alpha < 16) {
          continue;
        }

        const red = data[offset];
        const green = data[offset + 1];
        const blue = data[offset + 2];
        const isNearWhite = red >= threshold && green >= threshold && blue >= threshold;
        if (isNearWhite) {
          continue;
        }

        if (x < minX) {
          minX = x;
        }
        if (y < minY) {
          minY = y;
        }
        if (x > maxX) {
          maxX = x;
        }
        if (y > maxY) {
          maxY = y;
        }
      }
    }

    if (maxX < 0 || maxY < 0) {
      return blob;
    }

    minX = Math.max(0, minX - paddingX);
    minY = Math.max(0, minY - paddingY);
    maxX = Math.min(width - 1, maxX + paddingX);
    maxY = Math.min(height - 1, maxY + paddingY);

    let cropWidth = maxX - minX + 1;
    let cropHeight = maxY - minY + 1;

    if (cropWidth < minWidth) {
      const extra = Math.ceil((minWidth - cropWidth) / 2);
      minX = Math.max(0, minX - extra);
      maxX = Math.min(width - 1, maxX + extra);
      cropWidth = maxX - minX + 1;
    }

    if (cropHeight < minHeight) {
      const extra = Math.ceil((minHeight - cropHeight) / 2);
      minY = Math.max(0, minY - extra);
      maxY = Math.min(height - 1, maxY + extra);
      cropHeight = maxY - minY + 1;
    }

    if (cropWidth >= width && cropHeight >= height) {
      return blob;
    }

    const targetCanvas = document.createElement("canvas");
    targetCanvas.width = cropWidth;
    targetCanvas.height = cropHeight;
    const targetContext = targetCanvas.getContext("2d");
    if (!targetContext) {
      return blob;
    }

    targetContext.fillStyle = "#ffffff";
    targetContext.fillRect(0, 0, cropWidth, cropHeight);
    targetContext.drawImage(
      sourceCanvas,
      minX,
      minY,
      cropWidth,
      cropHeight,
      0,
      0,
      cropWidth,
      cropHeight
    );

    const croppedBlob = await canvasToBlob(targetCanvas);
    return croppedBlob || blob;
  };

  const getMarkdownRenderer = (() => {
    let instance = null;
    return () => {
      if (instance) {
        return instance;
      }
      if (typeof window.markdownit !== "function") {
        throw new Error("Markdown 渲染器未加载。");
      }

      instance = window.markdownit({
        html: false,
        breaks: true,
        linkify: true,
        typographer: false
      });

      const nativeLinkOpen =
        instance.renderer.rules.link_open ||
        ((tokens, idx, options, env, self) => self.renderToken(tokens, idx, options));
      instance.renderer.rules.link_open = (tokens, idx, options, env, self) => {
        tokens[idx].attrSet("target", "_blank");
        tokens[idx].attrSet("rel", "noreferrer noopener");
        return nativeLinkOpen(tokens, idx, options, env, self);
      };
      return instance;
    };
  })();

  const ensureMathTypesetterReady = async () => {
    if (!window.MathJax) {
      throw new Error("公式渲染器未加载。");
    }
    if (window.MathJax.startup && window.MathJax.startup.promise) {
      await window.MathJax.startup.promise;
    }
    if (typeof window.MathJax.typesetPromise !== "function") {
      throw new Error("公式渲染器初始化失败。");
    }
  };

  const waitForImagesReady = async (root) => {
    const images = [...root.querySelectorAll("img")];
    await Promise.all(
      images.map(
        (image) =>
          new Promise((resolve) => {
            let settled = false;
            const finish = () => {
              if (settled) {
                return;
              }
              settled = true;
              resolve();
            };

            const rawSrc = image.getAttribute("src") || "";
            if (rawSrc) {
              try {
                image.src = new URL(rawSrc, window.location.origin).toString();
              } catch (error) {
                // Ignore malformed URLs and let the existing src continue.
              }
            }

            if (image.complete) {
              finish();
              return;
            }

            image.addEventListener("load", finish, { once: true });
            image.addEventListener("error", finish, { once: true });
            window.setTimeout(finish, 2500);
          })
      )
    );
  };

  const rememberMarkdownRenderBlob = (cacheKey, sourceText, blob) => {
    markdownRenderCache.set(cacheKey, {
      sourceText,
      blob
    });
    if (markdownRenderCache.size <= 24) {
      return;
    }
    const oldestKey = markdownRenderCache.keys().next().value;
    if (oldestKey) {
      markdownRenderCache.delete(oldestKey);
    }
  };

  const renderMarkdownToImageBlob = async (markdownText) => {
    const normalized = normalizePlainTextSource(markdownText).trim();
    if (!normalized) {
      throw new Error("Markdown 内容为空。");
    }
    if (!window.htmlToImage || typeof window.htmlToImage.toBlob !== "function") {
      throw new Error("图片渲染器未加载。");
    }

    const cacheKey = buildAnswerHash(normalized);
    const cached = markdownRenderCache.get(cacheKey);
    if (cached && cached.sourceText === normalized && cached.blob) {
      return {
        blob: cached.blob,
        filename: buildMarkdownImageFilename(normalized),
        cacheHit: true
      };
    }

    const renderer = getMarkdownRenderer();
    await ensureMathTypesetterReady();

    const host = document.createElement("div");
    host.className = "page-md-render-capture-host";
    host.innerHTML = `
      <article class="page-md-render-capture">
        <div class="page-md-render-capture__body"></div>
      </article>
    `;

    const article = host.firstElementChild;
    const body = article && article.querySelector(".page-md-render-capture__body");
    if (!article || !body) {
      throw new Error("创建 Markdown 渲染容器失败。");
    }

    body.innerHTML = renderer.render(normalized);
    document.body.appendChild(host);

    try {
      await waitForImagesReady(body);

      if (typeof window.MathJax.typesetClear === "function") {
        window.MathJax.typesetClear([body]);
      }
      await window.MathJax.typesetPromise([body]);

      if (document.fonts && document.fonts.ready) {
        try {
          await document.fonts.ready;
        } catch (error) {
          // Continue even if font readiness cannot be determined.
        }
      }

      await wait(40);

      const blob = await window.htmlToImage.toBlob(article, {
        backgroundColor: "#ffffff",
        pixelRatio: Math.max(2, Math.min(3, Math.ceil(window.devicePixelRatio || 1))),
        cacheBust: true
      });
      if (!blob) {
        throw new Error("前端 Markdown 图片生成失败。");
      }

      const croppedBlob = await cropImageBlobWhitespace(blob, {
        threshold: 250,
        paddingX: 22,
        paddingY: 24,
        minWidth: 320,
        minHeight: 140
      });

      rememberMarkdownRenderBlob(cacheKey, normalized, croppedBlob);
      return {
        blob: croppedBlob,
        filename: buildMarkdownImageFilename(normalized),
        cacheHit: false
      };
    } finally {
      host.remove();
    }
  };

  const getMarkdownAttachments = (vm) => {
    const list = Array.isArray(vm && vm.subjectiveQuesData) ? vm.subjectiveQuesData : [];
    return list.filter((item) => item && Number(item.questionAttachmentType) === 5);
  };

  const getMarkdownAttachmentCount = (vm) => {
    return getMarkdownAttachments(vm).length;
  };

  const findMarkdownAttachmentByFilename = (vm, filename) => {
    const normalized = normalizeMarkdownFilename(filename);
    if (!normalized) {
      return null;
    }
    return (
      getMarkdownAttachments(vm).find((item) => {
        const names = [item && item.attachmentName, item && item.name];
        return names.some((name) => normalizeMarkdownFilename(name) === normalized);
      }) || null
    );
  };

  const readApiResponse = async (response) => {
    const rawText = await response.text();
    let payload = null;
    try {
      payload = rawText ? JSON.parse(rawText) : null;
    } catch (error) {
      payload = null;
    }
    return {
      payload,
      rawText
    };
  };

  const isSuccessfulApiPayload = (payload) =>
    !payload || payload.code == null || payload.code === 0 || payload.code === 33333;

  const uploadMarkdownBlob = async (vm, context, imageBlob, filename) => {
    const normalizedFilename = normalizeMarkdownFilename(filename) || "md-answer.png";
    if (!context || !imageBlob) {
      return {
        attempted: false,
        success: false,
        message: "未生成可上传图片。"
      };
    }

    if (
      hasRememberedMarkdownUpload(context.key, normalizedFilename) ||
      findMarkdownAttachmentByFilename(vm, normalizedFilename)
    ) {
      rememberMarkdownUpload(context.key, normalizedFilename);
      return {
        attempted: false,
        success: true,
        message: "题目里已存在相同图片，未重复上传。"
      };
    }

    if (getMarkdownAttachmentCount(vm) >= 3) {
      return {
        attempted: false,
        success: false,
        message: "已达到 3 张图片上限，未上传。"
      };
    }

    const formData = new FormData();
    formData.append("uploadFile", imageBlob, normalizedFilename);

    const uploadResponse = await fetch("/exam/api/atta/upload", {
      method: "POST",
      body: formData
    });
    const uploadResult = await readApiResponse(uploadResponse);
    const uploadPayload = uploadResult.payload || {};
    const uploadExtra = uploadPayload && uploadPayload.extra ? uploadPayload.extra : {};
    if (
      !uploadResponse.ok ||
      !isSuccessfulApiPayload(uploadPayload) ||
      uploadExtra.id == null
    ) {
      throw new Error(
        uploadPayload.message || uploadResult.rawText || `图片上传失败 (${uploadResponse.status})`
      );
    }

    const attachResponse = await fetch(
      `/exam/api/student/${context.entityType}/entity/${context.entityId}/question/${context.questionId}/attachment/${uploadExtra.id}`,
      {
        method: "POST"
      }
    );
    const attachResult = await readApiResponse(attachResponse);
    if (!attachResponse.ok) {
      throw new Error(
        (attachResult.payload && attachResult.payload.message) ||
          attachResult.rawText ||
          `挂载题目失败 (${attachResponse.status})`
      );
    }
    if (attachResult.payload && !isSuccessfulApiPayload(attachResult.payload)) {
      throw new Error(attachResult.payload.message || "挂载题目失败。");
    }

    rememberMarkdownUpload(context.key, normalizedFilename);
    refreshQuestionAnswer(vm, context);
    scheduleMarkdownAnswerRender(180);
    return {
      attempted: true,
      success: true,
      attachmentId: uploadExtra.id,
      message: "已按图片作答方式上传。"
    };
  };

  const requestServerRenderedMarkdown = async (context, markdownText) => {
    const response = await fetch("/exam/api/markdown-answer", {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        entityType: context.entityType,
        entityId: context.entityId,
        questionId: context.questionId,
        questionNumber: context.questionNumber,
        markdown: markdownText
      })
    });

    const result = await readApiResponse(response);
    const payload = result.payload || {};
    if (!response.ok || !isSuccessfulApiPayload(payload)) {
      throw new Error(payload.message || result.rawText || `生成失败 (${response.status})`);
    }

    const extra = payload && payload.extra ? payload.extra : {};
    const downloadUrl = extra.downloadUrl || "";
    if (!downloadUrl) {
      throw new Error("Markdown 图片已生成，但没有返回下载地址。");
    }

    return {
      downloadUrl,
      filename: extra.filename || buildMarkdownImageFilename(markdownText),
      cacheText: extra.cacheHit ? "命中服务端缓存" : "服务端新生成"
    };
  };

  const uploadGeneratedMarkdownImage = async (vm, context, downloadUrl, filename) => {
    if (!downloadUrl) {
      return {
        attempted: false,
        success: false,
        message: "未生成可下载图片。"
      };
    }

    const imageResponse = await fetch(downloadUrl);
    if (!imageResponse.ok) {
      throw new Error(`读取生成图片失败 (${imageResponse.status})`);
    }

    return uploadMarkdownBlob(vm, context, await imageResponse.blob(), filename);
  };

  const refreshQuestionAnswer = (vm, context) => {
    if (!vm || !context) {
      return;
    }

    const parent = vm.$parent;
    if (context.entityType === "course") {
      if (parent && typeof parent.getAlreadyAnswer === "function") {
        parent.getAlreadyAnswer(context.entityId);
      } else if (typeof vm.$emit === "function") {
        vm.$emit("getAlreadyAnswer", context.entityId);
      }
      return;
    }

    if (parent && typeof parent.getStuAnaswerInfo === "function") {
      parent.getStuAnaswerInfo(context.entityId);
    } else if (typeof vm.$emit === "function") {
      vm.$emit("getStuAnaswerInfo", context.entityId);
    }
  };

  const notifyVm = (vm, tone, message) => {
    if (!message) {
      return;
    }
    try {
      if (tone === "error" && vm && typeof vm.$error === "function") {
        vm.$error({
          title: "错误",
          content: message
        });
        return;
      }

      const api =
        vm && vm.$message && typeof vm.$message === "object"
          ? vm.$message
          : null;
      const method =
        tone === "error"
          ? "error"
          : tone === "success"
            ? "success"
            : "warning";
      if (api && typeof api[method] === "function") {
        api[method](message);
        return;
      }
    } catch (error) {
      // Fall through to alert.
    }

    window.alert(message);
  };

  const getHandwriteOverlay = () => document.getElementById("page-handwrite-overlay");

  const closeHandwriteModal = () => {
    const overlay = getHandwriteOverlay();
    if (!overlay) {
      return;
    }
    if (typeof overlay.__onResize === "function") {
      window.removeEventListener("resize", overlay.__onResize);
    }
    if (typeof overlay.__onKeyDown === "function") {
      window.removeEventListener("keydown", overlay.__onKeyDown, true);
    }
    overlay.remove();
  };

  const setHandwriteModalStatus = (overlay, message, tone = "") => {
    const status = overlay && overlay.querySelector(".page-handwrite-modal__status");
    if (!status) {
      return;
    }
    status.textContent = message || "";
    status.dataset.tone = tone || "";
  };

  const HANDWRITE_BRUSH_PRESETS = {
    fine: {
      minWidth: 0.7,
      maxWidth: 1.7
    },
    medium: {
      minWidth: 1.1,
      maxWidth: 2.7
    },
    bold: {
      minWidth: 1.8,
      maxWidth: 4.1
    }
  };

  const syncHandwriteBrushButtons = (overlay, activeBrush) => {
    overlay.querySelectorAll("[data-handwrite-brush]").forEach((button) => {
      button.classList.toggle("is-active", button.dataset.handwriteBrush === activeBrush);
    });
  };

  const applyHandwriteBrushPreset = (signaturePad, overlay, brushKey) => {
    const preset = HANDWRITE_BRUSH_PRESETS[brushKey] || HANDWRITE_BRUSH_PRESETS.medium;
    signaturePad.minWidth = preset.minWidth;
    signaturePad.maxWidth = preset.maxWidth;
    overlay.dataset.brush = brushKey;
    syncHandwriteBrushButtons(overlay, brushKey);
  };

  const resizeSignatureCanvas = (canvas, signaturePad) => {
    if (!canvas || !signaturePad) {
      return;
    }
    const bounds = canvas.getBoundingClientRect();
    if (!bounds.width || !bounds.height) {
      return;
    }

    const ratio = Math.max(window.devicePixelRatio || 1, 1);
    const data = signaturePad.toData();
    canvas.width = Math.round(bounds.width * ratio);
    canvas.height = Math.round(bounds.height * ratio);

    const context2d = canvas.getContext("2d");
    if (!context2d) {
      return;
    }

    context2d.scale(ratio, ratio);
    signaturePad.clear();
    if (data.length) {
      signaturePad.fromData(data);
    }
  };

  const exportHandwritePaperBlob = async (paperNode) => {
    if (!paperNode) {
      throw new Error("手写纸张不存在。");
    }
    if (!window.htmlToImage || typeof window.htmlToImage.toBlob !== "function") {
      throw new Error("图片渲染器未加载。");
    }

    if (document.fonts && document.fonts.ready) {
      try {
        await document.fonts.ready;
      } catch (error) {
        // Continue even if font readiness cannot be determined.
      }
    }

    await wait(20);

    const blob = await window.htmlToImage.toBlob(paperNode, {
      backgroundColor: "#ffffff",
      pixelRatio: Math.max(2, Math.min(3, Math.ceil(window.devicePixelRatio || 1))),
      cacheBust: true
    });
    if (!blob) {
      throw new Error("手写图片导出失败。");
    }
    return blob;
  };

  const buildHandwriteImageFilename = (context) =>
    `handwrite-${context.questionId}-${Date.now()}.png`;

  const openEnhancedHandwriteModal = (vm, context) => {
    if (!context) {
      throw new Error("无法识别当前题目。");
    }
    if (typeof window.SignaturePad !== "function") {
      throw new Error("手写库未加载。");
    }
    if (getMarkdownAttachmentCount(vm) >= 3) {
      notifyVm(vm, "warning", "只能添加三张图片，请删除后再添加。");
      return;
    }

    closeHandwriteModal();

    const overlay = document.createElement("div");
    overlay.id = "page-handwrite-overlay";
    overlay.className = "page-handwrite-modal";
    overlay.innerHTML = `
      <div class="page-handwrite-modal__card">
        <div class="page-handwrite-modal__head">
          <div>
            <div class="page-handwrite-modal__eyebrow">Signature Pad</div>
            <div class="page-handwrite-modal__title">手写作答</div>
            <div class="page-handwrite-modal__meta">题号 ${context.questionNumber} · 平滑笔迹 · 直接按图片方式上传</div>
          </div>
          <button type="button" class="page-handwrite-modal__close">关闭</button>
        </div>
        <div class="page-handwrite-modal__toolbar">
          <div class="page-handwrite-toolbar__group">
            <button type="button" class="page-handwrite-tool" data-handwrite-brush="fine">细</button>
            <button type="button" class="page-handwrite-tool is-active" data-handwrite-brush="medium">中</button>
            <button type="button" class="page-handwrite-tool" data-handwrite-brush="bold">粗</button>
          </div>
          <div class="page-handwrite-toolbar__group">
            <button type="button" class="page-handwrite-tool" data-handwrite-action="undo">撤销</button>
            <button type="button" class="page-handwrite-tool" data-handwrite-action="clear">清空</button>
          </div>
        </div>
        <div class="page-handwrite-modal__stage">
          <div class="page-handwrite-paper">
            <div class="page-handwrite-paper__head">
              <span>新能源课程手写作答</span>
              <span>Q${context.questionNumber}</span>
            </div>
            <canvas class="page-handwrite-paper__canvas"></canvas>
          </div>
        </div>
        <div class="page-handwrite-modal__footer">
          <div class="page-handwrite-modal__status"></div>
          <div class="page-handwrite-modal__actions">
            <button type="button" class="page-handwrite-secondary" data-handwrite-action="cancel">取消</button>
            <button type="button" class="page-handwrite-primary" data-handwrite-action="save">上传作答</button>
          </div>
        </div>
      </div>
    `;

    document.body.appendChild(overlay);

    const paper = overlay.querySelector(".page-handwrite-paper");
    const canvas = overlay.querySelector(".page-handwrite-paper__canvas");
    const saveButton = overlay.querySelector('[data-handwrite-action="save"]');
    if (!paper || !canvas || !saveButton) {
      overlay.remove();
      throw new Error("手写面板初始化失败。");
    }

    const signaturePad = new window.SignaturePad(canvas, {
      penColor: "#0f172a",
      minDistance: 0.6,
      throttle: 8,
      velocityFilterWeight: 0.72
    });

    const onResize = () => resizeSignatureCanvas(canvas, signaturePad);
    const onKeyDown = (event) => {
      if (event.key === "Escape") {
        event.preventDefault();
        closeHandwriteModal();
      }
    };

    overlay.__onResize = onResize;
    overlay.__onKeyDown = onKeyDown;
    window.addEventListener("resize", onResize);
    window.addEventListener("keydown", onKeyDown, true);

    applyHandwriteBrushPreset(signaturePad, overlay, "medium");
    window.requestAnimationFrame(onResize);

    overlay.addEventListener("click", (event) => {
      if (event.target === overlay) {
        closeHandwriteModal();
      }
    });

    overlay.querySelector(".page-handwrite-modal__close").addEventListener("click", closeHandwriteModal);

    overlay.querySelectorAll("[data-handwrite-brush]").forEach((button) => {
      button.addEventListener("click", () => {
        applyHandwriteBrushPreset(signaturePad, overlay, button.dataset.handwriteBrush || "medium");
      });
    });

    overlay.querySelector('[data-handwrite-action="undo"]').addEventListener("click", () => {
      const data = signaturePad.toData();
      if (!data.length) {
        setHandwriteModalStatus(overlay, "当前没有可撤销的笔迹。");
        return;
      }
      data.pop();
      signaturePad.clear();
      if (data.length) {
        signaturePad.fromData(data);
      }
      if (!data.length) {
        signaturePad.clear();
      }
      setHandwriteModalStatus(overlay, "已撤销上一笔。");
    });

    overlay.querySelector('[data-handwrite-action="clear"]').addEventListener("click", () => {
      signaturePad.clear();
      setHandwriteModalStatus(overlay, "画布已清空。");
    });

    overlay.querySelector('[data-handwrite-action="cancel"]').addEventListener("click", closeHandwriteModal);

    saveButton.addEventListener("click", async () => {
      if (overlay.classList.contains("is-busy")) {
        return;
      }
      if (signaturePad.isEmpty()) {
        setHandwriteModalStatus(overlay, "请先写点内容再上传。", "error");
        return;
      }

      overlay.classList.add("is-busy");
      saveButton.disabled = true;
      setHandwriteModalStatus(overlay, "正在导出并上传手写作答...", "pending");

      try {
        const blob = await exportHandwritePaperBlob(paper);
        const uploadInfo = await uploadMarkdownBlob(vm, context, blob, buildHandwriteImageFilename(context));
        const statusTone = uploadInfo.success ? "success" : "pending";
        setHandwriteModalStatus(overlay, uploadInfo.message, statusTone);
        if (uploadInfo.success) {
          notifyVm(vm, "success", "手写作答已上传。");
          closeHandwriteModal();
        }
      } catch (error) {
        setHandwriteModalStatus(
          overlay,
          error && error.message ? error.message : "手写作答上传失败。",
          "error"
        );
      } finally {
        overlay.classList.remove("is-busy");
        saveButton.disabled = false;
      }
    });
  };

  const patchHandwriteAction = (vm, context) => {
    if (!vm || typeof vm.openWriteModal !== "function" || handwritePatchedVms.has(vm)) {
      return;
    }

    const originalOpenWriteModal = vm.openWriteModal.bind(vm);
    vm.openWriteModal = (...args) => {
      const latestContext = getQuestionContext(vm) || context;
      try {
        openEnhancedHandwriteModal(vm, latestContext);
      } catch (error) {
        console.warn("enhanced handwrite modal fallback", error);
        return originalOpenWriteModal(...args);
      }
      return undefined;
    };

    handwritePatchedVms.add(vm);
  };

  const scheduleMarkdownAnswerRender = (delay = 80) => {
    window.clearTimeout(markdownRenderTimer);
    markdownRenderTimer = window.setTimeout(() => {
      renderMarkdownAnswerTools();
    }, delay);
  };

  const getMarkdownSibling = (host, className, questionKey) => {
    let node = host ? host.nextElementSibling : null;
    while (
      node &&
      (node.classList.contains("page-md-answer-panel") || node.classList.contains("page-md-plain-render"))
    ) {
      if (node.classList.contains(className) && node.dataset.questionKey === questionKey) {
        return node;
      }
      node = node.nextElementSibling;
    }
    return null;
  };

  const getMarkdownPanelNode = (host, questionKey) => getMarkdownSibling(host, "page-md-answer-panel", questionKey);

  const getPlainTextRenderNode = (host, questionKey) => getMarkdownSibling(host, "page-md-plain-render", questionKey);

  const setMarkdownPanelStatus = (panel, message, tone = "") => {
    const status = panel.querySelector(".page-md-answer-status");
    if (!status) {
      return;
    }
    status.textContent = message || "";
    status.dataset.tone = tone || "";
  };

  const setMarkdownPanelBusy = (panel, busy, options = {}) => {
    panel.classList.toggle("is-busy", Boolean(busy));
    const keepDownloadEnabled = Boolean(options.keepDownloadEnabled);
    panel.querySelectorAll("textarea, button").forEach((element) => {
      if (keepDownloadEnabled && element.classList.contains("page-md-answer-download")) {
        element.disabled = false;
        return;
      }
      element.disabled = Boolean(busy);
    });
  };

  const setMarkdownDownloadState = (panel, downloadUrl, filename) => {
    const downloadButton = panel.querySelector(".page-md-answer-download");
    if (!downloadButton) {
      return;
    }
    if (!downloadUrl) {
      downloadButton.classList.add("is-hidden");
      delete downloadButton.dataset.downloadUrl;
      delete downloadButton.dataset.filename;
      return;
    }
    downloadButton.classList.remove("is-hidden");
    downloadButton.dataset.downloadUrl = downloadUrl;
    downloadButton.dataset.filename = filename || "md-answer.png";
  };

  const syncMarkdownPanelMode = (panel, context) => {
    const plainToggle = panel.querySelector(".page-md-answer-plain-toggle");
    const modeHint = panel.querySelector(".page-md-answer-mode-hint");
    const submitButton = panel.querySelector(".page-md-answer-submit");
    const plainModeEnabled = Boolean(plainToggle && plainToggle.checked);

    if (context && context.key) {
      setPlainTextMode(context.key, plainModeEnabled);
    }
    if (submitButton) {
      submitButton.textContent = plainModeEnabled ? "确认并本地渲染" : "确认并生成图片";
    }
    if (modeHint) {
      modeHint.textContent = plainModeEnabled
        ? "纯文本直渲染：仅当前页面显示，每行最多 30 字密度，不上传后端。"
        : "图片模式：前端本地渲染 Markdown / LaTeX 公式，生成后可下载，并继续按图片方式上传。";
    }
    if (plainModeEnabled) {
      setMarkdownDownloadState(panel, "", "");
    }
  };

  const ensurePlainTextRender = (host, context) => {
    if (!host || !context) {
      return;
    }

    const state = getPlainTextRender(context.key);
    let preview = getPlainTextRenderNode(host, context.key);
    if (!state) {
      if (preview) {
        preview.remove();
      }
      return;
    }

    if (!preview) {
      preview = document.createElement("section");
      preview.className = "page-md-plain-render";
      preview.dataset.questionKey = context.key;
      preview.innerHTML = `
        <div class="page-md-plain-render__head">
          <div>
            <div class="page-md-plain-render__eyebrow">Local Text</div>
            <div class="page-md-plain-render__title">按密度纯文本</div>
            <div class="page-md-plain-render__meta"></div>
          </div>
          <button type="button" class="page-md-answer-text-btn page-md-plain-render__clear">清除</button>
        </div>
        <div class="page-md-plain-render__body"></div>
      `;

      const clearButton = preview.querySelector(".page-md-plain-render__clear");
      clearButton.addEventListener("click", () => {
        clearPlainTextRender(context.key);
        clearMarkdownBlobDownloadUrl(context.key);
        const panel = getMarkdownPanelNode(host, context.key);
        if (panel) {
          setMarkdownDownloadState(panel, "", "");
          if (panel.dataset.submitting !== "1") {
            setMarkdownPanelStatus(panel, "已清除本地纯文本渲染。");
          }
        }
        ensurePlainTextRender(host, context);
      });
    }

    const meta = preview.querySelector(".page-md-plain-render__meta");
    const body = preview.querySelector(".page-md-plain-render__body");
    if (meta) {
      meta.textContent = `本地直渲染 · ${state.lines.length} 行 · 每行最多 ${PLAIN_TEXT_MAX_DENSITY} 字密度`;
    }

    if (body) {
      body.innerHTML = "";
      state.lines.forEach((line, index) => {
        const lineNode = document.createElement("div");
        lineNode.className = "page-md-plain-render__line";
        lineNode.dataset.line = String(index + 1).padStart(2, "0");
        lineNode.textContent = line || " ";
        body.appendChild(lineNode);
      });
    }

    const anchor = getMarkdownPanelNode(host, context.key) || host;
    if (preview.parentElement !== anchor.parentElement || preview.previousElementSibling !== anchor) {
      anchor.insertAdjacentElement("afterend", preview);
    }
  };

  const closeMarkdownPanel = (host, triggerButton, keepDraft = true) => {
    const panel = host.nextElementSibling;
    if (panel && panel.classList.contains("page-md-answer-panel")) {
      if (keepDraft) {
        const textarea = panel.querySelector(".page-md-answer-input");
        const key = panel.dataset.questionKey || "";
        if (textarea && key) {
          markdownDrafts.set(key, textarea.value);
        }
      }
      panel.remove();
    }
    if (triggerButton) {
      triggerButton.classList.remove("is-active");
    }
  };

  const createMarkdownPanel = (host, triggerButton, vm, context) => {
    const panel = document.createElement("section");
    panel.className = "page-md-answer-panel";
    panel.dataset.questionKey = context.key;
    panel.innerHTML = `
      <div class="page-md-answer-panel__head">
        <div>
          <strong>Markdown 作答</strong>
          <span>支持列表、表格、代码块、行内公式 <code>$...$</code> 和块公式 <code>$$...$$</code></span>
        </div>
        <button type="button" class="page-md-answer-text-btn page-md-answer-collapse">收起</button>
      </div>
      <textarea class="page-md-answer-input" spellcheck="false" placeholder="例如：&#10;1. 设 $f(x)=x^2+1$&#10;2. 则 $$\\int_0^1 x^2\\,dx=\\frac{1}{3}$$"></textarea>
      <div class="page-md-answer-panel__mode">
        <label class="page-md-answer-switch">
          <input type="checkbox" class="page-md-answer-plain-toggle">
          <span class="page-md-answer-switch__track"></span>
          <span class="page-md-answer-switch__label">按密度纯文本</span>
        </label>
        <div class="page-md-answer-mode-hint"></div>
      </div>
      <div class="page-md-answer-panel__footer">
        <div class="page-md-answer-status"></div>
        <div class="page-md-answer-panel__actions">
          <button type="button" class="page-md-answer-text-btn page-md-answer-download is-hidden">下载图片</button>
          <button type="button" class="page-md-answer-text-btn page-md-answer-cancel">取消</button>
          <button type="button" class="page-md-answer-submit">确认并生成图片</button>
        </div>
      </div>
    `;

    const textarea = panel.querySelector(".page-md-answer-input");
    const collapseButton = panel.querySelector(".page-md-answer-collapse");
    const downloadButton = panel.querySelector(".page-md-answer-download");
    const cancelButton = panel.querySelector(".page-md-answer-cancel");
    const submitButton = panel.querySelector(".page-md-answer-submit");
    const plainToggle = panel.querySelector(".page-md-answer-plain-toggle");

    textarea.value = markdownDrafts.get(context.key) || "";
    if (plainToggle) {
      plainToggle.checked = getPlainTextMode(context.key);
    }
    syncMarkdownPanelMode(panel, context);

    textarea.addEventListener("input", () => {
      markdownDrafts.set(context.key, textarea.value);
      if (panel.dataset.submitting !== "1") {
        setMarkdownPanelStatus(panel, "");
      }
    });

    if (plainToggle) {
      plainToggle.addEventListener("change", () => {
        syncMarkdownPanelMode(panel, context);
        if (panel.dataset.submitting !== "1") {
          setMarkdownPanelStatus(panel, "");
        }
      });
    }

    textarea.addEventListener("keydown", (event) => {
      if (event.key === "Tab") {
        event.preventDefault();
        const { selectionStart, selectionEnd, value } = textarea;
        textarea.value = `${value.slice(0, selectionStart)}  ${value.slice(selectionEnd)}`;
        textarea.selectionStart = textarea.selectionEnd = selectionStart + 2;
        markdownDrafts.set(context.key, textarea.value);
        return;
      }

      if ((event.ctrlKey || event.metaKey) && event.key === "Enter" && !submitButton.disabled) {
        event.preventDefault();
        submitButton.click();
      }
    });

    const collapse = () => {
      closeMarkdownPanel(host, triggerButton);
    };

    collapseButton.addEventListener("click", collapse);
    downloadButton.addEventListener("click", () => {
      const downloadUrl = downloadButton.dataset.downloadUrl;
      if (!downloadUrl) {
        return;
      }
      const link = document.createElement("a");
      link.href = downloadUrl;
      link.download = downloadButton.dataset.filename || "md-answer.png";
      link.style.display = "none";
      document.body.appendChild(link);
      link.click();
      link.remove();
    });
    cancelButton.addEventListener("click", collapse);

    submitButton.addEventListener("click", async () => {
      if (panel.dataset.submitting === "1") {
        return;
      }

      const markdownText = textarea.value.trim();
      if (!markdownText) {
        setMarkdownPanelStatus(panel, "请输入 Markdown 内容。", "error");
        textarea.focus();
        return;
      }

      panel.dataset.submitting = "1";
      setMarkdownPanelBusy(panel, true);
      setMarkdownPanelStatus(panel, "正在生成图片...", "pending");

      let downloadUrl = "";
      let filename = "";
      let cacheText = "已生成";
      try {
        if (plainToggle && plainToggle.checked) {
          const renderState = rememberPlainTextRender(context.key, markdownText);
          const plainFilename = buildPlainTextImageFilename(markdownText);
          const plainBlob = await createPlainTextImageBlob(renderState);
          const objectUrl = rememberMarkdownBlobDownloadUrl(
            context.key,
            window.URL.createObjectURL(plainBlob)
          );
          downloadUrl = objectUrl;
          filename = plainFilename;
          cacheText = "前端生成";
          setMarkdownDownloadState(panel, objectUrl, plainFilename);
          ensurePlainTextRender(host, context);
          setMarkdownPanelBusy(panel, true, { keepDownloadEnabled: true });
          setMarkdownPanelStatus(panel, "前端纯文本图片已生成，可直接下载，正在按图片方式上传...", "pending");
          const uploadInfo = await uploadMarkdownBlob(vm, context, plainBlob, plainFilename);
          const statusTone = uploadInfo.success ? "success" : "pending";
          setMarkdownPanelStatus(panel, `${cacheText}，${uploadInfo.message} 可直接下载图片。`, statusTone);
          return;
        }

        clearPlainTextRender(context.key);
        clearMarkdownBlobDownloadUrl(context.key);
        ensurePlainTextRender(host, context);
        let localRender = null;
        try {
          localRender = await renderMarkdownToImageBlob(markdownText);
        } catch (renderError) {
          const serverRender = await requestServerRenderedMarkdown(context, markdownText);
          downloadUrl = serverRender.downloadUrl;
          filename = serverRender.filename;
          cacheText = serverRender.cacheText;
          setMarkdownDownloadState(panel, downloadUrl, filename);
          setMarkdownPanelBusy(panel, true, { keepDownloadEnabled: true });
          setMarkdownPanelStatus(panel, `${cacheText}，可直接下载图片，正在按图片方式上传...`, "pending");

          const uploadInfo = await uploadGeneratedMarkdownImage(vm, context, downloadUrl, filename);
          const statusTone = uploadInfo.success ? "success" : "pending";
          setMarkdownPanelStatus(panel, `${cacheText}，${uploadInfo.message} 可直接下载图片。`, statusTone);
          return;
        }

        filename = localRender.filename;
        cacheText = localRender.cacheHit ? "命中前端缓存" : "前端新渲染";
        downloadUrl = rememberMarkdownBlobDownloadUrl(
          context.key,
          window.URL.createObjectURL(localRender.blob)
        );

        setMarkdownDownloadState(panel, downloadUrl, filename);
        setMarkdownPanelBusy(panel, true, { keepDownloadEnabled: true });
        setMarkdownPanelStatus(panel, `${cacheText}，可直接下载图片，正在按图片方式上传...`, "pending");

        const uploadInfo = await uploadMarkdownBlob(vm, context, localRender.blob, filename);
        const statusTone = uploadInfo.success ? "success" : "pending";
        setMarkdownPanelStatus(panel, `${cacheText}，${uploadInfo.message} 可直接下载图片。`, statusTone);
      } catch (error) {
        if (!downloadUrl) {
          setMarkdownDownloadState(panel, "", "");
          setMarkdownPanelStatus(
            panel,
            error && error.message ? error.message : "Markdown 图片生成失败。",
            "error"
          );
        } else {
          setMarkdownPanelStatus(
            panel,
            `${cacheText}，${error && error.message ? error.message : "上传失败。"} 可直接下载图片。`,
            "pending"
          );
        }
      } finally {
        panel.dataset.submitting = "0";
        setMarkdownPanelBusy(panel, false);
      }
    });

    return panel;
  };

  const ensureMarkdownButton = (host, vm, context) => {
    const actionButtons = [...host.querySelectorAll(".ant-btn, button")].filter(
      (button) =>
        isVisible(button) &&
        ["拍照作答", "手写作答", "看答案", "放弃补交看答案"].some((text) =>
          normalizeActionLabel(button.innerText).includes(text)
        )
    );
    if (!actionButtons.length) {
      return;
    }

    const templateButton = actionButtons[actionButtons.length - 1];
    const templateSlot = templateButton.closest(".ant-space-item") || templateButton;
    let slot = templateSlot.nextElementSibling;

    if (!slot || !slot.classList.contains("page-md-answer-slot")) {
      slot = document.createElement(templateSlot.classList.contains("ant-space-item") ? "div" : "span");
      slot.className = templateSlot.classList.contains("ant-space-item")
        ? "ant-space-item page-md-answer-slot"
        : "page-md-answer-slot";
      templateSlot.insertAdjacentElement("afterend", slot);
    }

    let triggerButton = slot.querySelector(".page-md-answer-trigger");
    if (!triggerButton) {
      triggerButton = document.createElement("button");
      triggerButton.type = "button";
      triggerButton.className = `${templateButton.className} page-md-answer-trigger`.trim();
      triggerButton.innerHTML = "<span>md</span>";
      slot.appendChild(triggerButton);
    }

    triggerButton.dataset.questionKey = context.key;
    triggerButton.onclick = () => {
      const existing = host.nextElementSibling;
      if (
        existing &&
        existing.classList.contains("page-md-answer-panel") &&
        existing.dataset.questionKey === context.key
      ) {
        closeMarkdownPanel(host, triggerButton);
        return;
      }

      closeMarkdownPanel(host, triggerButton);
      const panel = createMarkdownPanel(host, triggerButton, vm, context);
      host.insertAdjacentElement("afterend", panel);
      triggerButton.classList.add("is-active");
      window.setTimeout(() => {
        const textarea = panel.querySelector(".page-md-answer-input");
        if (textarea) {
          textarea.focus();
          textarea.setSelectionRange(textarea.value.length, textarea.value.length);
        }
      }, 20);
    };
  };

  function renderMarkdownAnswerTools() {
    const seenHosts = new Set();
    [...document.querySelectorAll(".ant-btn, button")].forEach((button) => {
      if (!isVisible(button) || !normalizeActionLabel(button.innerText).includes("拍照作答")) {
        return;
      }

      let host = button;
      for (let depth = 0; host && depth < 8; depth += 1, host = host.parentElement) {
        if (host && hasVisibleActionText(host, "拍照作答") && hasVisibleActionText(host, "手写作答")) {
          break;
        }
      }

      if (!host || seenHosts.has(host)) {
        return;
      }
      seenHosts.add(host);

      const vm = findQuestionVm(host);
      const context = getQuestionContext(vm);
      if (!context) {
        return;
      }

      patchHandwriteAction(vm, context);
      ensureMarkdownButton(host, vm, context);
      ensurePlainTextRender(host, context);
    });
  }

  window.addEventListener("beforeunload", () => {
    closeHandwriteModal();
    markdownBlobDownloadUrls.forEach((objectUrl) => {
      window.URL.revokeObjectURL(objectUrl);
    });
    markdownBlobDownloadUrls.clear();
  });

  window.addEventListener("hashchange", () => {
    closeHandwriteModal();
    pulseRoute();
    scheduleCourseRepair(120);
  });
  window.addEventListener("pageshow", () => {
    closeHandwriteModal();
    pulseRoute();
    scheduleCourseRepair(120);
  });
  window.addEventListener("load", () => {
    scheduleCourseRepair(240);
    window.setTimeout(syncCourseTitleVisibility, 1200);
  });
  pulseRoute();
  scheduleCourseRepair(240);
  scheduleMarkdownAnswerRender(260);
  applyStoredUiFlags();
  window.addEventListener("scroll", updateActiveCourseSection, { passive: true });
  window.addEventListener("resize", () => {
    scheduleCourseRepair(120);
    scheduleMarkdownAnswerRender(120);
  }, { passive: true });

  const markdownObserver = new MutationObserver(() => {
    scheduleMarkdownAnswerRender(90);
  });
  markdownObserver.observe(document.documentElement, {
    childList: true,
    subtree: true
  });

  document.addEventListener(
    "click",
    (event) => {
      const button = event.target.closest(".ant-btn, .btn-area .btn, .btn-box .btn, .th-btn");
      if (!button) {
        return;
      }
      button.style.transform = "translateY(1px) scale(0.99)";
      window.setTimeout(() => {
        button.style.transform = "";
      }, 120);
      scheduleMarkdownAnswerRender(120);
    },
    true
  );
})();
