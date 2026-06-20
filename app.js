let trip = null;
const STORAGE_KEYS = {
  startDate: "nz-trip-start-date",
  preDepartureChecks: "nz-trip-predeparture-checks-v1"
};
const APP_VERSION = "predeparture-checklist-v13";
const PRE_DEPARTURE_ID = "predeparture";

const safeStorage = {
  get(key) {
    try {
      return window.localStorage.getItem(key);
    } catch {
      return null;
    }
  },
  set(key, value) {
    try {
      window.localStorage.setItem(key, value);
    } catch {
      // Some file:// or privacy modes block localStorage. The app should still work for the current session.
    }
  },
  remove(key) {
    try {
      window.localStorage.removeItem(key);
    } catch {
      // Ignore blocked storage in file:// or privacy mode.
    }
  }
};

const typeLabels = {
  flight: "航班",
  airport: "機場",
  transport: "交通",
  stay: "住宿",
  grocery: "採買",
  shopping: "購物",
  sight: "景點",
  food: "餐飲",
  car: "取車",
  stop: "休息站",
  town: "小鎮",
  activity: "活動",
  parking: "停車",
  walk: "步道",
  scenic: "景觀",
  backup: "備案",
  todo: "待補",
  checklist: "檢查"
};

const state = {
  selectedDayId: null,
  mode: "current",
  search: "",
  tripStartDate: initialStartDate(),
  isUnlocked: false
};

const elements = {
  authGate: document.querySelector("#authGate"),
  authForm: document.querySelector("#authForm"),
  tripPasswordPrimary: document.querySelector("#tripPasswordPrimary"),
  tripPasswordSecondary: document.querySelector("#tripPasswordSecondary"),
  authError: document.querySelector("#authError"),
  tripStatus: document.querySelector("#tripStatus"),
  installHelp: document.querySelector("#installHelp"),
  lockApp: document.querySelector("#lockApp"),
  installDialog: document.querySelector("#installDialog"),
  dayTabs: document.querySelector("#dayTabs"),
  summaryAlerts: document.querySelector("#summaryAlerts"),
  itineraryView: document.querySelector("#itineraryView"),
  searchInput: document.querySelector("#searchInput"),
  modeButtons: [...document.querySelectorAll(".mode-button")]
};

function base64ToBytes(value) {
  return Uint8Array.from(atob(value), (char) => char.charCodeAt(0));
}

function concatBytes(...chunks) {
  const total = chunks.reduce((sum, chunk) => sum + chunk.length, 0);
  const result = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    result.set(chunk, offset);
    offset += chunk.length;
  }
  return result;
}

async function deriveTripKey(primaryValue, secondaryValue, salt, iterations) {
  if (!window.crypto?.subtle) {
    throw new Error("WebCrypto is not available.");
  }
  const material = `${primaryValue}\u0000${secondaryValue}`;
  const keyMaterial = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(material),
    "PBKDF2",
    false,
    ["deriveKey"]
  );
  return crypto.subtle.deriveKey(
    { name: "PBKDF2", salt, iterations, hash: "SHA-256" },
    keyMaterial,
    { name: "AES-GCM", length: 256 },
    false,
    ["decrypt"]
  );
}

async function decryptTripData(primaryValue, secondaryValue) {
  const payload = window.TRIP_DATA_ENCRYPTED;
  if (!payload) throw new Error("Encrypted trip data is missing.");
  const salt = base64ToBytes(payload.salt);
  const iv = base64ToBytes(payload.iv);
  const ciphertext = base64ToBytes(payload.ciphertext);
  const tag = base64ToBytes(payload.tag);
  const key = await deriveTripKey(primaryValue, secondaryValue, salt, payload.iterations);
  const decrypted = await crypto.subtle.decrypt(
    { name: "AES-GCM", iv },
    key,
    concatBytes(ciphertext, tag)
  );
  return JSON.parse(new TextDecoder().decode(decrypted));
}

function isValidDateKey(value) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value || "")) return false;
  const parsed = parseLocalDate(value);
  return Number.isFinite(parsed.getTime()) && toDateKey(parsed) === value;
}

function todayAtMidnight() {
  const now = new Date();
  return new Date(now.getFullYear(), now.getMonth(), now.getDate());
}

function toDateKey(date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function parseLocalDate(value) {
  const [year, month, day] = String(value || "").split("-").map(Number);
  return new Date(year, month - 1, day);
}

function addDays(date, days) {
  const copy = new Date(date);
  copy.setDate(copy.getDate() + days);
  return copy;
}

function diffDays(from, to) {
  const msPerDay = 24 * 60 * 60 * 1000;
  return Math.round((to.getTime() - from.getTime()) / msPerDay);
}

function initialStartDate() {
  const saved = safeStorage.get(STORAGE_KEYS.startDate);
  if (isValidDateKey(saved)) return saved;
  const today = toDateKey(todayAtMidnight());
  safeStorage.set(STORAGE_KEYS.startDate, today);
  return today;
}

function dateForDay(day) {
  return addDays(parseLocalDate(state.tripStartDate), day.day);
}

function displayDateForDay(day) {
  const date = dateForDay(day);
  const weekdays = ["日", "一", "二", "三", "四", "五", "六"];
  return `${date.getMonth() + 1}/${date.getDate()}（週${weekdays[date.getDay()]}）`;
}

function applyAuthState() {
  document.body.classList.toggle("is-locked", !state.isUnlocked);
  if (!state.isUnlocked) {
    elements.tripPasswordPrimary?.focus();
  }
}

function getDefaultDay() {
  const start = parseLocalDate(state.tripStartDate);
  const index = Math.max(0, Math.min(trip.days.length - 1, diffDays(start, todayAtMidnight())));
  return trip.days.find((day) => day.day === index) || trip.days[0];
}

function mapsSearchUrl(item) {
  if (item.mapUrl) return item.mapUrl;
  const query = encodeURIComponent(item.mapQuery || item.address || item.title);
  return `https://www.google.com/maps/search/?api=1&query=${query}`;
}

function mapsDirectionsUrl(item) {
  if (item.directionsUrl) return item.directionsUrl;
  const query = encodeURIComponent(item.address || item.mapQuery || item.title);
  return `https://www.google.com/maps/dir/?api=1&destination=${query}&travelmode=driving`;
}

function websiteSearchUrl(item) {
  const query = encodeURIComponent(`${item.title} New Zealand official`);
  return `https://www.google.com/search?q=${query}`;
}

function escapeHtml(value) {
  return String(value || "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function formatText(value) {
  return escapeHtml(value).replaceAll("\n", "<br>");
}

function updateTripStatus() {
  const startDay = trip.days[0];
  elements.tripStatus.textContent = `出發日：${displayDateForDay(startDay)}，目前顯示 ${getDefaultDay().day === 0 ? "出發" : `Day ${getDefaultDay().day}`}`;
}

function renderTabs() {
  const preDepartureActive = state.selectedDayId === PRE_DEPARTURE_ID ? " is-active" : "";
  const preDepartureTab = trip.preDepartureChecklist
    ? `
      <button class="day-tab${preDepartureActive}" type="button" data-day-id="${PRE_DEPARTURE_ID}">
        出發前
        <small>物品檢查清單</small>
      </button>
    `
    : "";
  const dayTabs = trip.days
    .map((day) => {
      const active = day.id === state.selectedDayId ? " is-active" : "";
      const label = day.day === 0 ? "出發" : `Day ${day.day}`;
      return `
        <button class="day-tab${active}" type="button" data-day-id="${day.id}">
          ${label}
          <small>${displayDateForDay(day)} · ${escapeHtml(day.title)}</small>
        </button>
      `;
    })
    .join("");
  elements.dayTabs.innerHTML = preDepartureTab + dayTabs;
}

function renderSummaryAlerts(days) {
  const alerts = days.flatMap((day) => dayAlertsForDay(day, true)).slice(0, 8);

  elements.summaryAlerts.innerHTML = alerts
    .map((alert) => `
      <article class="alert-strip">
        <span class="alert-icon">${alert.level === "critical" ? "!" : "i"}</span>
        <p><strong>${escapeHtml(alert.title)}</strong><br>${formatText(alert.text)}</p>
      </article>
    `)
    .join("");
}

function locationTag(status) {
  if (status === "needs-review") return `<span class="tag danger">位置待確認</span>`;
  return `<span class="tag location">NZ 地點</span>`;
}

function reminderTags(item) {
  const tags = [];
  if (item.reminders?.length) tags.push(`<span class="tag warning">醒目提醒</span>`);
  tags.push(locationTag(item.locationStatus));
  return tags.join("");
}

function itemSearchText(item) {
  return [
    item.type,
    item.time,
    item.title,
    item.address,
    item.mapQuery,
    ...(item.links || []).flatMap((link) => [link.label, link.url]),
    ...(item.images || []).flatMap((image) => [image.alt, image.caption]),
    ...(item.notes || []),
    ...(item.reminders || [])
  ].join(" ").toLowerCase();
}

function dayMatchesSearch(day, query) {
  if (!query) return true;
  return [
    day.title,
    day.route.join(" "),
    ...(day.alerts || []).map((alert) => alert.text),
    ...day.items.map(itemSearchText)
  ].join(" ").toLowerCase().includes(query);
}

function filterItems(day) {
  const query = state.search.trim().toLowerCase();
  if (!query) return day.items;
  return day.items.filter((item) => itemSearchText(item).includes(query));
}

function dayAlertsForDay(day, includeTitle = false) {
  const alerts = [
    ...(day.alerts || []).map((alert) => ({
      ...alert,
      title: includeTitle ? `Day ${day.day} ${alert.level === "critical" ? "重要提醒" : "提醒"}` : ""
    }))
  ];

  const seen = new Set(alerts.map((alert) => alert.text));
  for (const item of day.items || []) {
    for (const reminder of item.reminders || []) {
      if (!reminder.includes("加油") || seen.has(reminder)) continue;
      seen.add(reminder);
      alerts.push({
        level: "warning",
        text: `${item.title}：${reminder}`,
        title: includeTitle ? `Day ${day.day} 加油提醒` : ""
      });
    }
  }

  return alerts;
}

function loadPreDepartureChecks() {
  try {
    return JSON.parse(safeStorage.get(STORAGE_KEYS.preDepartureChecks) || "{}");
  } catch {
    return {};
  }
}

function savePreDepartureCheck(id, checked) {
  const checks = loadPreDepartureChecks();
  if (checked) {
    checks[id] = true;
  } else {
    delete checks[id];
  }
  safeStorage.set(STORAGE_KEYS.preDepartureChecks, JSON.stringify(checks));
}

function preDepartureSearchText() {
  const checklist = trip.preDepartureChecklist;
  if (!checklist) return "";
  return [
    checklist.title,
    checklist.subtitle,
    ...(checklist.illustrations || []).flatMap((illustration) => [illustration.title, illustration.text]),
    ...(checklist.sections || []).flatMap((section) => [
      section.title,
      section.lead,
      ...(section.items || []).map((item) => item.text)
    ])
  ].join(" ").toLowerCase();
}

function comicIllustrationSvg(variant) {
  const windy = variant === "wind";
  const sun = variant === "sun";
  const coat = windy ? "#0f5132" : "#155e75";
  const accent = sun ? "#f5b942" : "#86c5da";
  const scarf = windy ? "#d95f43" : "#89a94d";
  const extra = windy
    ? `
      <path d="M18 34c18-12 36-12 54 0" />
      <path d="M12 54c16-9 31-9 45 0" />
      <path d="M136 42c16-9 31-9 45 0" />
    `
    : `
      <circle cx="154" cy="34" r="15" class="fill-accent" />
      <path d="M154 9v10M154 49v10M129 34h10M169 34h10M136 16l7 7M171 16l-7 7M136 52l7-7M171 52l-7-7" />
    `;
  return `
    <svg class="comic-svg" viewBox="0 0 200 150" role="img" aria-hidden="true">
      <defs>
        <filter id="paperShadow" x="-20%" y="-20%" width="140%" height="140%">
          <feDropShadow dx="0" dy="3" stdDeviation="2" flood-color="#1d2521" flood-opacity="0.16" />
        </filter>
      </defs>
      <rect x="8" y="8" width="184" height="134" rx="8" class="comic-bg" />
      <g class="comic-lines">${extra}</g>
      <g filter="url(#paperShadow)">
        <circle cx="96" cy="43" r="18" class="skin" />
        <path d="M80 42c6-19 27-19 34-2" class="hair" />
        <path d="M76 73c5-15 13-23 25-23s20 8 25 23l8 42H68l8-42Z" fill="${coat}" />
        <path d="M78 74c12 8 28 8 43 0" class="stitch" />
        <path d="M84 64c10 9 24 9 35 0" stroke="${scarf}" class="scarf" />
        <path d="M90 117v18M113 117v18" class="limb" />
        <path d="M73 84l-17 20M129 84l17 20" class="limb" />
        ${windy ? `<path d="M75 28c8-13 35-13 44 0v13H75V28Z" fill="${accent}" /><path d="M72 40h50" class="stitch" />` : ""}
      </g>
      <path d="M35 124h130" class="ground" />
    </svg>
  `;
}

function renderPreDepartureChecklist() {
  const checklist = trip.preDepartureChecklist;
  if (!checklist) return `<div class="empty-state">尚未建立出發前清單。</div>`;
  const checks = loadPreDepartureChecks();
  const items = (checklist.sections || []).flatMap((section) => section.items || []);
  const doneCount = items.filter((item) => checks[item.id]).length;
  const totalCount = items.length;

  const illustrations = checklist.illustrations?.length
    ? `
      <div class="comic-grid">
        ${checklist.illustrations.map((illustration) => `
          <article class="comic-panel">
            ${comicIllustrationSvg(illustration.variant)}
            <div>
              <h3>${escapeHtml(illustration.title)}</h3>
              <p>${formatText(illustration.text)}</p>
            </div>
          </article>
        `).join("")}
      </div>
    `
    : "";

  return `
    <section class="day-section predeparture-section" id="${PRE_DEPARTURE_ID}">
      <div class="day-hero">
        <div class="day-title-row">
          <div>
            <p class="eyebrow">Before Departure</p>
            <h2>${escapeHtml(checklist.title)}</h2>
          </div>
          <span class="day-date">${doneCount}/${totalCount}</span>
        </div>
        ${checklist.subtitle ? `<p class="route-line"><span>${escapeHtml(checklist.subtitle)}</span></p>` : ""}
        <div class="check-progress" aria-label="清單完成進度">
          <span style="width: ${totalCount ? Math.round((doneCount / totalCount) * 100) : 0}%"></span>
        </div>
      </div>
      ${illustrations}
      <div class="checklist-board">
        ${(checklist.sections || []).map((section) => `
          <article class="check-section">
            <h3>${escapeHtml(section.title)}</h3>
            ${section.lead ? `<p>${formatText(section.lead)}</p>` : ""}
            <div class="check-items">
              ${(section.items || []).map((item) => {
                const checked = checks[item.id] ? " checked" : "";
                return `
                  <label class="check-item ${checked ? "is-checked" : ""}">
                    <input class="predeparture-check" type="checkbox" data-check-id="${escapeHtml(item.id)}"${checked}>
                    <span>${formatText(item.text)}</span>
                  </label>
                `;
              }).join("")}
            </div>
          </article>
        `).join("")}
      </div>
    </section>
  `;
}

function renderItem(item) {
  const type = typeLabels[item.type] || item.type || "行程";
  const notes = item.notes?.length
    ? `<ul class="note-list">${item.notes.map((note) => `<li>${escapeHtml(note)}</li>`).join("")}</ul>`
    : "";
  const reminders = item.reminders?.length
    ? `<div class="notice critical">${item.reminders.map(formatText).join("<br>")}</div>`
    : "";
  const address = item.address ? `<p class="item-meta">${escapeHtml(item.address)}</p>` : "";
  const images = item.images?.length
    ? `
      <div class="image-gallery">
        ${item.images.map((image) => `
          <figure>
            <img src="${escapeHtml(image.src)}" alt="${escapeHtml(image.alt || item.title)}" loading="eager" decoding="async">
            ${image.caption ? `<figcaption>${escapeHtml(image.caption)}</figcaption>` : ""}
          </figure>
        `).join("")}
      </div>
    `
    : "";
  const mapActions = !item.hideDefaultMapActions && (item.mapQuery || item.address || item.mapUrl)
    ? [
        { label: "開導航", url: mapsDirectionsUrl(item), primary: true },
        { label: item.mapSearchLabel || "看地圖", url: mapsSearchUrl(item) }
      ]
    : [];
  const linkActions = item.linksBeforeMapSearch && mapActions.length > 1
    ? [
        mapActions[0],
        ...(item.links || []),
        mapActions[1],
        ...(item.skipWebsiteSearch || item.links?.some((link) => link.kind === "official") ? [] : [{ label: "查官網", url: websiteSearchUrl(item) }])
      ]
    : [
        ...mapActions,
        ...(item.links || []),
        ...(item.skipWebsiteSearch || item.links?.some((link) => link.kind === "official") ? [] : [{ label: "查官網", url: websiteSearchUrl(item) }])
      ];
  const actions = linkActions.length
    ? `
      <div class="card-actions">
        ${linkActions.map((link) => `
          <a class="action-link ${link.primary ? "primary" : ""}" href="${escapeHtml(link.url)}" target="_blank" rel="noreferrer">
            ${escapeHtml(link.label)}
          </a>
        `).join("")}
      </div>
    `
    : "";

  return `
    <article class="item-card ${item.reminders?.length ? "is-wide" : ""}">
      <div class="item-topline">
        <div class="item-meta">
          <span>${escapeHtml(type)}</span>
          ${item.time ? `<span>${escapeHtml(item.time)}</span>` : ""}
        </div>
        <h3>${escapeHtml(item.title)}</h3>
      </div>
      <div class="tag-row">
        <span class="tag ${item.type === "food" ? "food" : ""}">${escapeHtml(type)}</span>
        ${reminderTags(item)}
      </div>
      ${address}
      ${reminders}
      ${images}
      ${notes}
      ${actions}
    </article>
  `;
}

function renderDay(day) {
  const items = filterItems(day);
  const dayAlerts = dayAlertsForDay(day);
  const startDatePanel = day.day === 0
    ? `
      <div class="start-date-panel">
        <label>
          <span>出發日日期</span>
          <input id="tripStartDate" type="date" value="${escapeHtml(state.tripStartDate)}">
        </label>
        <p>第一次開啟會預設為當天日期；設定後會保留在這台裝置，並自動對應後續 Day。</p>
      </div>
    `
    : "";
  const alerts = dayAlerts.length
    ? `
      <div class="day-alerts">
        ${dayAlerts.map((alert) => `<div class="notice ${alert.level}">${formatText(alert.text)}</div>`).join("")}
      </div>
    `
    : "";

  const timeline = items.length
    ? `<div class="timeline">${items.map(renderItem).join("")}</div>`
    : `<div class="empty-state">這一天沒有符合搜尋條件的項目。</div>`;

  return `
    <section class="day-section" id="${day.id}">
      <div class="day-hero">
        <div class="day-title-row">
          <div>
            <p class="eyebrow">${day.day === 0 ? "Departure" : `Day ${day.day}`}</p>
            <h2>${escapeHtml(day.title)}</h2>
          </div>
          <span class="day-date">${displayDateForDay(day)}</span>
        </div>
        <p class="route-line">${day.route.map((place) => `<span>${escapeHtml(place)}</span>`).join(" → ")}</p>
        ${startDatePanel}
        ${alerts}
      </div>
      ${timeline}
    </section>
  `;
}

function selectedDays() {
  const query = state.search.trim().toLowerCase();
  if (state.mode === "all" || query) return trip.days.filter((day) => dayMatchesSearch(day, query));
  if (state.selectedDayId === PRE_DEPARTURE_ID) return [];
  if (state.mode === "day" || state.mode === "current") {
    const selected = trip.days.find((day) => day.id === state.selectedDayId);
    return [selected || getDefaultDay()];
  }
  if (state.mode === "next") {
    const selected = trip.days.find((day) => day.id === state.selectedDayId) || getDefaultDay();
    return [trip.days.find((day) => day.day === selected.day + 1) || selected];
  }

  const selected = trip.days.find((day) => day.id === state.selectedDayId);
  return [selected || getDefaultDay()];
}

function render() {
  if (!state.isUnlocked) return;
  const query = state.search.trim().toLowerCase();
  const showPreDeparture = state.selectedDayId === PRE_DEPARTURE_ID || ((state.mode === "all" || query) && preDepartureSearchText().includes(query));
  const days = selectedDays();
  renderTabs();
  renderSummaryAlerts(days);
  const sections = [
    ...(showPreDeparture ? [renderPreDepartureChecklist()] : []),
    ...days.map(renderDay)
  ];
  elements.itineraryView.innerHTML = sections.length
    ? sections.join("")
    : `<div class="empty-state">沒有找到符合的行程。</div>`;
}

function setMode(mode) {
  state.mode = mode;
  elements.modeButtons.forEach((button) => {
    button.classList.toggle("is-active", button.dataset.mode === mode);
  });
  render();
}

function bindEvents() {
  elements.authForm?.addEventListener("submit", async (event) => {
    event.preventDefault();
    const primaryValue = elements.tripPasswordPrimary.value.trim();
    const secondaryValue = elements.tripPasswordSecondary.value.trim();
    if (!primaryValue || !secondaryValue) {
      elements.authError.textContent = "名稱或密碼不正確，請再試一次。";
      (primaryValue ? elements.tripPasswordSecondary : elements.tripPasswordPrimary).select();
      return;
    }
    try {
      trip = await decryptTripData(primaryValue, secondaryValue);
      state.selectedDayId = getDefaultDay().id;
      state.isUnlocked = true;
      elements.authError.textContent = "";
      elements.tripPasswordPrimary.value = "";
      elements.tripPasswordSecondary.value = "";
      applyAuthState();
      updateTripStatus();
      render();
    } catch {
      elements.authError.textContent = "名稱或密碼不正確，或目前瀏覽器不支援安全解鎖。";
      elements.tripPasswordPrimary.select();
    }
  });

  elements.dayTabs.addEventListener("click", (event) => {
    const tab = event.target.closest("[data-day-id]");
    if (!tab) return;
    state.selectedDayId = tab.dataset.dayId;
    setMode("day");
  });

  elements.modeButtons.forEach((button) => {
    button.addEventListener("click", () => {
      state.selectedDayId = state.selectedDayId || getDefaultDay().id;
      setMode(button.dataset.mode);
    });
  });

  elements.searchInput.addEventListener("input", (event) => {
    state.search = event.target.value;
    state.mode = state.search ? "all" : "current";
    elements.modeButtons.forEach((button) => {
      button.classList.toggle("is-active", button.dataset.mode === state.mode);
    });
    render();
  });

  elements.itineraryView.addEventListener("change", (event) => {
    const checklistInput = event.target.closest(".predeparture-check");
    if (checklistInput) {
      savePreDepartureCheck(checklistInput.dataset.checkId, checklistInput.checked);
      render();
      return;
    }

    if (event.target.id !== "tripStartDate" || !isValidDateKey(event.target.value)) return;
    state.tripStartDate = event.target.value;
    safeStorage.set(STORAGE_KEYS.startDate, state.tripStartDate);
    if (state.mode === "current") {
      state.selectedDayId = getDefaultDay().id;
    }
    updateTripStatus();
    render();
  });

  elements.installHelp.addEventListener("click", () => {
    if (typeof elements.installDialog.showModal === "function") {
      elements.installDialog.showModal();
    }
  });

  elements.lockApp?.addEventListener("click", () => {
    trip = null;
    state.isUnlocked = false;
    state.selectedDayId = null;
    elements.itineraryView.innerHTML = "";
    elements.summaryAlerts.innerHTML = "";
    elements.dayTabs.innerHTML = "";
    elements.authError.textContent = "";
    elements.tripPasswordPrimary.value = "";
    elements.tripPasswordSecondary.value = "";
    applyAuthState();
  });

}

function registerServiceWorker() {
  if ("serviceWorker" in navigator) {
    navigator.serviceWorker.register(`./sw.js?v=${APP_VERSION}`).catch(() => {
      // The app still works without offline cache, especially when opened from file:// during local review.
    });
  }
}

function installSourceViewGuards() {
  document.addEventListener("contextmenu", (event) => {
    event.preventDefault();
  });

  document.addEventListener("keydown", (event) => {
    const key = event.key.toLowerCase();
    const command = event.ctrlKey || event.metaKey;
    const sourceShortcut = command && key === "u";
    const inspectorShortcut = command && event.shiftKey && ["i", "j", "c"].includes(key);
    const safariSourceShortcut = event.metaKey && event.altKey && key === "u";
    const safariInspectorShortcut = event.metaKey && event.altKey && key === "i";

    if (event.key === "F12" || sourceShortcut || inspectorShortcut || safariSourceShortcut || safariInspectorShortcut) {
      event.preventDefault();
      event.stopPropagation();
    }
  }, true);
}

function init() {
  installSourceViewGuards();
  applyAuthState();
  bindEvents();
  registerServiceWorker();
}

try {
  init();
} catch (error) {
  console.error(error);
  const status = document.querySelector("#tripStatus");
  if (status) {
    status.textContent = "行程載入失敗，請改用 http://localhost:4173/ 開啟，或重新整理頁面。";
  }
}
