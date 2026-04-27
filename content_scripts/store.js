console.log("🎮 Steam家庭库指示器 v3.1 已加载");

// ============ 检测 Steam ID（多种方式） ============

function detectSteamId() {
  // 方式1: 全局变量
  try {
    if (window.g_steamID && /^\d{17}$/.test(window.g_steamID)) {
      return { id: window.g_steamID, method: "g_steamID" };
    }
  } catch (e) {}

  // 方式2: 页面内嵌 script 中查找
  for (const s of document.querySelectorAll("script")) {
    const text = s.textContent || "";
    const m = text.match(/g_steamID\s*[:=]\s*["']?(\d{17})/);
    if (m) return { id: m[1], method: "script-tag" };
  }

  // 方式3: 个人资料链接
  for (const a of document.querySelectorAll('a[href*="/profiles/"]')) {
    const m = a.href.match(/\/profiles\/(\d{17})/);
    if (m) return { id: m[1], method: "profile-link" };
  }

  // 方式4: data-steamid 属性
  for (const el of document.querySelectorAll("[data-steamid]")) {
    const v = el.getAttribute("data-steamid");
    if (/^\d{17}$/.test(v)) return { id: v, method: "data-steamid" };
  }

  // 方式5: 从页面 HTML 正则搜索
  const html = document.documentElement.innerHTML;
  const patterns = [
    /g_steamID\s*[:=]\s*["'](\d{17})/,
    /steamid["'\s:=]+["']?(\d{17})/,
    /\/profiles\/(\d{17})/,
  ];
  for (const p of patterns) {
    const m = html.match(p);
    if (m) return { id: m[1], method: "html-regex" };
  }

  return null;
}

// 页面加载后检测
function tryDetect() {
  const result = detectSteamId();
  if (result) {
    chrome.storage.local.set({ detectedSteamId: result.id });
    console.log(`🆔 Steam ID: ${result.id} (via ${result.method})`);
    return result.id;
  }
  return null;
}

// 页面加载后尝试多次检测（应对延迟加载）
[0, 1000, 3000, 5000].forEach((delay) => setTimeout(tryDetect, delay));

// ============ 消息监听 ============

chrome.runtime.onMessage.addListener((req, sender, sendResponse) => {
  // Popup 查询 Steam ID
  if (req.action === "getSteamId") {
    const result = detectSteamId();
    if (result) {
      chrome.storage.local.set({ detectedSteamId: result.id });
    }
    sendResponse({
      steamId: result ? result.id : null,
      method: result ? result.method : null,
    });
    return;
  }

  // 刷新标记
  if (req.action === "refresh") {
    markPage();
    sendResponse({ ok: true });
    return;
  }
});

// ============ 提取 App ID ============

function getAppId(row) {
  const ds = row.getAttribute("data-ds-appid");
  if (ds) {
    const first = ds.split(",")[0].trim();
    if (/^\d+$/.test(first)) return first;
  }
  const key = row.getAttribute("data-ds-itemkey");
  if (key) {
    const m = key.match(/app_(\d+)/);
    if (m) return m[1];
  }
  const a = row.querySelector('a[href*="/app/"]');
  if (a) {
    const m = a.href.match(/\/app\/(\d+)/);
    if (m) return m[1];
  }
  return null;
}

// ============ 标记页面 ============

function markPage() {
  chrome.storage.local.get(["familyApps"], (result) => {
    const data = result.familyApps;
    if (!data || !data.ids || data.ids.length === 0) return;
    const familySet = new Set(data.ids.map(String));

    const rows = document.querySelectorAll(".search_result_row");
    let matched = 0;
    rows.forEach((row) => {
      // 清理旧标记
      row.querySelectorAll(".fl-badge, .fl-flag").forEach((el) => el.remove());
      row.classList.remove("has-own-flag");

      const id = getAppId(row);
      if (!id || !familySet.has(id)) return;
      matched++;

      // 在封面左侧添加绿色旗帜
      const capsule = row.querySelector(".search_capsule");
      if (capsule) {
        const flag = document.createElement("div");
        flag.className = "fl-flag";
        flag.innerHTML = `
          <div class="fl-flag-icon">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="white"><path d="M16 11c1.66 0 2.99-1.34 2.99-3S17.66 5 16 5c-1.66 0-3 1.34-3 3s1.34 3 3 3zm-8 0c1.66 0 2.99-1.34 2.99-3S9.66 5 8 5c-1.66 0-3 1.34-3 3s1.34 3 3 3zm0 2c-2.33 0-7 1.17-7 3.5V19h14v-2.5c0-2.33-4.67-3.5-7-3.5zm8 0c-.29 0-.62.02-.97.05 1.16.84 1.97 1.97 1.97 3.45V19h6v-2.5c0-2.33-4.67-3.5-7-3.5z"/></svg>
          </div>
          <span class="fl-flag-text">在家庭库中</span>
        `;

        // 检测是否已有 Steam 官方标记（如“在库中”）
        if (row.querySelector(".ds_flag") || capsule.querySelector(".ds_flag")) {
          row.classList.add("has-own-flag");
        }

        capsule.appendChild(flag);
      }
    });
    if (rows.length > 0) console.log(`📊 ${matched} / ${rows.length}`);

    const appMatch = window.location.pathname.match(/\/app\/(\d+)/);
    if (
      appMatch &&
      familySet.has(appMatch[1]) &&
      !document.querySelector(".fl-page-badge")
    ) {
      const badge = document.createElement("div");
      badge.className = "fl-page-badge";
      badge.innerHTML = `<svg width="20" height="20" viewBox="0 0 24 24" fill="#4CAF50"><path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm-2 15l-5-5 1.41-1.41L10 14.17l7.59-7.59L19 8l-9 9z"/></svg><span>该游戏在您的家庭共享库中</span>`;
      const target =
        document.querySelector(".glance_ctn") ||
        document.querySelector(".game_header_info_ctn");
      if (target) target.parentNode.insertBefore(badge, target);
    }
  });
}

chrome.storage.onChanged.addListener((changes) => {
  if (changes.familyApps) markPage();
});

setTimeout(markPage, 1500);
setTimeout(markPage, 4000);

let debounce;
new MutationObserver(() => {
  clearTimeout(debounce);
  debounce = setTimeout(markPage, 600);
}).observe(document.body, { childList: true, subtree: true });
