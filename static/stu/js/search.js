(() => {
  const FLAG = '__codexCourseSearchLoaded';
  const BINDER = '__codexBindCourseSearch';
  const COURSES = '__codexCourseSearchCourses';
  const POPUP_ID = 'codex-course-search-popup';

  const ensurePopup = () => {
    let popup = document.getElementById(POPUP_ID);
    let textElement = popup && popup.querySelector('[data-role="search-results"]');
    if (popup && textElement) {
      return { popup, textElement };
    }

    popup = document.createElement('div');
    popup.id = POPUP_ID;
    popup.style.display = 'none';
    popup.style.position = 'fixed';
    popup.style.width = '100%';
    popup.style.height = '100%';
    popup.style.top = '0';
    popup.style.left = '0';
    popup.style.justifyContent = 'center';
    popup.style.alignItems = 'center';
    popup.style.backgroundColor = 'rgba(0, 0, 0, 0.5)';
    popup.style.zIndex = '9999';

    const popupContent = document.createElement('div');
    popupContent.style.backgroundColor = 'white';
    popupContent.style.padding = '20px';
    popupContent.style.borderRadius = '5px';
    popupContent.style.boxShadow = '0 4px 6px rgba(0, 0, 0, 0.1)';
    popupContent.style.position = 'relative';
    popupContent.style.maxWidth = '90%';
    popupContent.style.maxHeight = '90%';
    popupContent.style.overflowY = 'auto';
    popupContent.style.textAlign = 'left';

    const closeButton = document.createElement('span');
    closeButton.textContent = 'x';
    closeButton.style.position = 'absolute';
    closeButton.style.top = '10px';
    closeButton.style.right = '10px';
    closeButton.style.fontSize = '25px';
    closeButton.style.cursor = 'pointer';
    closeButton.addEventListener('click', () => {
      popup.style.display = 'none';
    });

    textElement = document.createElement('div');
    textElement.dataset.role = 'search-results';

    popupContent.appendChild(closeButton);
    popupContent.appendChild(textElement);
    popup.appendChild(popupContent);
    document.body.appendChild(popup);
    return { popup, textElement };
  };

  const navigateToCourse = (catalogId, popup) => {
    popup.style.display = 'none';
    window.location.hash = `#/course?pageid=0&catalogId=${catalogId}`;
    window.location.reload();
  };

  const renderResults = (courses) => {
    const { popup, textElement } = ensurePopup();
    textElement.innerHTML = '';

    const header = document.createElement('div');
    header.style.marginBottom = '12px';
    header.textContent = `搜索到 ${courses.length} 条内容：`;
    textElement.appendChild(header);

    courses.forEach((course) => {
      const item = document.createElement('button');
      item.type = 'button';
      item.textContent = course.name;
      item.dataset.catalogId = course.id;
      item.style.display = 'block';
      item.style.width = '100%';
      item.style.margin = '0 0 8px';
      item.style.padding = '10px 12px';
      item.style.border = '1px solid #d9d9d9';
      item.style.borderRadius = '8px';
      item.style.background = '#fff';
      item.style.cursor = 'pointer';
      item.style.textAlign = 'left';
      item.addEventListener('click', () => navigateToCourse(course.id, popup));
      textElement.appendChild(item);
    });

    popup.style.display = 'flex';
  };

  const fetchCourses = () => {
    if (Array.isArray(window[COURSES]) && window[COURSES].length > 0) {
      return;
    }

    fetch('/getAllCourses')
      .then((response) => response.json())
      .then((data) => {
        window[COURSES] = Array.isArray(data) ? data : [];
      })
      .catch((error) => {
        console.error('Failed to fetch courses:', error);
      });
  };

  window[BINDER] = (button) => {
    if (!button || button.dataset.listenerAdded) {
      return;
    }

    button.dataset.listenerAdded = '1';
    button.addEventListener('click', () => {
      const input = document.querySelector('.search');
      const allCourses = Array.isArray(window[COURSES]) ? window[COURSES] : [];
      const searchWords = (input && input.value ? input.value : '')
        .split(' ')
        .map((word) => word.trim())
        .filter(Boolean);
      const filteredCourses = allCourses.filter((course) =>
        searchWords.every((word) => course.name.includes(word))
      );
      renderResults(filteredCourses);
    });
  };

  const attach = () => {
    window[BINDER](document.querySelector('.submitSearch'));
  };

  if (!window[FLAG]) {
    window[FLAG] = true;
    fetchCourses();
    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', attach, { once: true });
    } else {
      attach();
    }
    const observer = new MutationObserver(() => attach());
    const bootObserver = () => {
      if (document.body) {
        observer.observe(document.body, { childList: true, subtree: true });
      }
    };
    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', bootObserver, { once: true });
    } else {
      bootObserver();
    }
  } else {
    attach();
  }
})();
