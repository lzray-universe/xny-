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

  window.addEventListener("hashchange", () => {
    pulseRoute();
    scheduleCourseRepair(120);
  });
  window.addEventListener("pageshow", () => {
    pulseRoute();
    scheduleCourseRepair(120);
  });
  window.addEventListener("load", () => {
    scheduleCourseRepair(240);
    window.setTimeout(syncCourseTitleVisibility, 1200);
  });
  pulseRoute();
  scheduleCourseRepair(240);
  applyStoredUiFlags();
  window.addEventListener("scroll", updateActiveCourseSection, { passive: true });
  window.addEventListener("resize", () => scheduleCourseRepair(120), { passive: true });

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
    },
    true
  );
})();
