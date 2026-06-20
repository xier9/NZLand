let trip = null;
const STORAGE_KEYS = {
  startDate: "nz-trip-start-date",
  packingChecklist: "nz-trip-packing-checklist"
};
const APP_VERSION = "packing-checklist-v13";

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

const packingChecklistGroups = [
  {
    id: "departure-return",
    title: "出發/回程衣著",
    items: ["短T", "薄上衣", "軟質褲子", "防風羽絨外套"]
  },
  {
    id: "clothes",
    title: "衣物(10天份)",
    items: [
      "上衣：發熱衣*2、帽T*3",
      "褲子：褲子*3、發熱褲*1",
      "長睡衣*1、內褲*11",
      "免洗襪*11",
      "內衣*2、護墊*11、衛生棉*2、夜用*2",
      "毛帽、手套、圍脖、暖暖包*6"
    ]
  },
  {
    id: "outfits",
    title: "穿搭提醒",
    items: [
      "風大時的穿搭：防風外套+上衣+發熱衣+褲子+發熱褲+發熱襪+毛帽（要能遮住耳朵）+手套+圍脖（圍脖真的很好用可以充當頸枕還可以用來擋住副駕窗戶的大太陽）",
      "出太陽時無風的穿搭：「羽絨外套+厚上衣+褲子」或是「厚上衣加發熱衣+褲子不穿外套」"
    ]
  },
  {
    id: "toiletries",
    title: "盥洗用品",
    items: [
      "免洗牙膏+牙刷*20份",
      "(M洗臉巾*9)、毛巾*2、浴巾*1",
      "化妝包：洗臉、化妝棉、護唇膏(藍)、面膜",
      "浴帽*13、止癢乳液",
      "隱形眼鏡*13副、角塑用品(鏡/藥水/濕潤液/食鹽水*2)",
      "沐浴精、洗髮精、護髮素"
    ]
  },
  {
    id: "medicine",
    title: "藥包",
    items: ["常備藥、退燒藥水、頭痛藥、感冒藥、酸痛貼布、OK蹦、優碘、酒精棉片"]
  },
  {
    id: "homestay",
    title: "民宿用品",
    items: [
      "洗衣球、衣架、衣夾",
      "紙拖鞋*4、拖鞋*4(防水)、廁所用*1、中垃圾袋*7",
      "廚房用：平底鍋(能用在IH爐的)、鍋鏟和菜瓜布、小刀和刨刀、筷子*4/鋁箔紙/封口保鮮袋/可折疊的保冷袋/保鮮盒/購物袋",
      "充電器、充電線、小米延長線+萬國插座",
      "咖啡包*26"
    ]
  },
  {
    id: "day-bag",
    title: "隨身包包",
    items: [
      "太陽眼鏡、帽子、行動電源、保溫杯",
      "防曬乳、護唇膏、護手霜(黏)",
      "護照、行程、eSIM",
      "不論哪裡的公廁都有面紙和乾洗手"
    ]
  },
  {
    id: "car",
    title: "車用",
    items: ["車架、充電器、車用面紙*2、國際駕照、車用遮陽片、行李鎖、黑色圾垃袋*5"]
  }
];

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
  packingChecklist: document.querySelector("#packingChecklist"),
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

function getPackingChecks() {
  const raw = safeStorage.get(STORAGE_KEYS.packingChecklist);
  if (!raw) return {};
  try {
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch {
    return {};
  }
}

function setPackingCheck(id, checked) {
  const checks = getPackingChecks();
  if (checked) {
    checks[id] = true;
  } else {
    delete checks[id];
  }
  safeStorage.set(STORAGE_KEYS.packingChecklist, JSON.stringify(checks));
}

function packingItemId(group, index) {
  return `${group.id}-${index}`;
}

function packingItemIds() {
  return packingChecklistGroups.flatMap((group) => group.items.map((_, index) => packingItemId(group, index)));
}

function packingProgress(checks = getPackingChecks()) {
  const ids = packingItemIds();
  const done = ids.filter((id) => checks[id]).length;
  return { done, total: ids.length };
}

function updatePackingProgress() {
  const progress = packingProgress();
  const percent = progress.total ? Math.round((progress.done / progress.total) * 100) : 0;
  const count = elements.packingChecklist?.querySelector("[data-packing-count]");
  const bar = elements.packingChecklist?.querySelector("[data-packing-progress]");
  if (count) count.textContent = `${progress.done}/${progress.total} 已確認`;
  if (bar) bar.style.width = `${percent}%`;
}

function renderPackingChecklist() {
  const checks = getPackingChecks();
  const progress = packingProgress(checks);
  const percent = progress.total ? Math.round((progress.done / progress.total) * 100) : 0;

  elements.packingChecklist.innerHTML = `
    <div class="packing-header">
      <div>
        <p class="eyebrow">Pre-trip Checklist</p>
        <h2>行前物品檢查清單</h2>
      </div>
      <span class="packing-count" data-packing-count>${progress.done}/${progress.total} 已確認</span>
    </div>
    <div class="packing-progress" aria-hidden="true">
      <span data-packing-progress style="width: ${percent}%"></span>
    </div>
    <div class="packing-layout">
      <article class="packing-illustration">
        <img src="./assets/packing-windy-outfit.png" alt="風大時穿著防風外套、毛帽、手套與圍脖的漫畫風旅行插圖" loading="lazy" decoding="async">
        <div>
          <h3>風大時先照這套穿</h3>
          <p>毛帽要蓋住耳朵，圍脖可保暖、可當頸枕，也能擋副駕窗戶的大太陽。</p>
        </div>
      </article>
      <div class="packing-groups">
        ${packingChecklistGroups.map((group) => `
          <article class="packing-group">
            <h3>${escapeHtml(group.title)}</h3>
            <div class="packing-items">
              ${group.items.map((item, index) => {
                const id = packingItemId(group, index);
                return `
                  <label class="packing-item ${checks[id] ? "is-checked" : ""}" for="packing-${escapeHtml(id)}">
                    <input id="packing-${escapeHtml(id)}" type="checkbox" data-packing-id="${escapeHtml(id)}" ${checks[id] ? "checked" : ""}>
                    <span>${escapeHtml(item)}</span>
                  </label>
                `;
              }).join("")}
            </div>
          </article>
        `).join("")}
      </div>
    </div>
  `;
}

function updateTripStatus() {
  const startDay = trip.days[0];
  elements.tripStatus.textContent = `出發日：${displayDateForDay(startDay)}，目前顯示 ${getDefaultDay().day === 0 ? "出發" : `Day ${getDefaultDay().day}`}`;
}

function renderTabs() {
  elements.dayTabs.innerHTML = trip.days
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
  const days = selectedDays();
  renderTabs();
  renderSummaryAlerts(days);
  renderPackingChecklist();
  elements.itineraryView.innerHTML = days.length
    ? days.map(renderDay).join("")
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

  elements.packingChecklist.addEventListener("change", (event) => {
    const checkbox = event.target.closest("[data-packing-id]");
    if (!checkbox) return;
    setPackingCheck(checkbox.dataset.packingId, checkbox.checked);
    checkbox.closest(".packing-item")?.classList.toggle("is-checked", checkbox.checked);
    updatePackingProgress();
  });

  elements.itineraryView.addEventListener("change", (event) => {
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
    elements.packingChecklist.innerHTML = "";
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
