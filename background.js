async function autoFetchToken() {
  try {
    // 增加时间戳防止缓存
    const url = "https://store.steampowered.com/pointssummary/ajaxgetasyncconfig?_t=" + Date.now();
    const resp = await fetch(url, { credentials: "include" });
    const data = await resp.json();
    
    if (data && data.webapi_token) {
      console.log("[BG] 自动获取 Token 成功:", data.webapi_token.substring(0, 5) + "...");
      await chrome.storage.local.set({ steamApiKey: data.webapi_token });
      return data.webapi_token;
    } else {
      console.warn("[BG] 接口未返回 webapi_token，请确认是否已登录 Steam 商店");
    }
  } catch (e) {
    console.error("[BG] 自动获取 Token 异常:", e);
  }
  return null;
}

// 监听标签页更新，尝试静默获取 Token
chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
  if (changeInfo.status === "complete" && tab.url && tab.url.includes("store.steampowered.com")) {
    chrome.storage.local.get(["steamApiKey"], async (res) => {
      // 尝试静默获取一次 Token
      if (!res.steamApiKey) {
        await autoFetchToken();
      }
    });
  }
});

async function steamFetch(url) {
  console.log("[BG] 请求:", url);

  const resp = await fetch(url);
  const text = await resp.text();
  const trimmed = text.trim();

  console.log("[BG] HTTP状态:", resp.status);
  console.log("[BG] 响应前300字符:", trimmed.substring(0, 300));

  if (trimmed.startsWith("<")) {
    throw new Error(
      `API 返回了 HTML (HTTP ${resp.status})\n` +
        `${trimmed.substring(0, 300)}`,
    );
  }

  try {
    return JSON.parse(trimmed);
  } catch (e) {
    throw new Error(`JSON 解析失败: ${trimmed.substring(0, 300)}`);
  }
}

async function fetchFamilyLibrary(apiKey, steamId) {
  const results = {
    steps: [],
    success: false,
    apps: [],
    familyGroupId: null,
    error: null,
    rawResponses: {},
  };

  try {
    // ========== 第1步：验证 API Key 并获取家庭组 ==========
    results.steps.push("获取家庭组 ID...");

    const groupUrl =
      "https://api.steampowered.com/IFamilyGroupsService/GetFamilyGroupForUser/v1/" +
      "?format=json" +
      "&access_token=" +
      apiKey +
      "&steamid=" +
      steamId;

    const groupJson = await steamFetch(groupUrl);
    results.rawResponses.getFamilyGroup = groupJson;

    const groupResp = groupJson.response || groupJson;
    const familyGroupId =
      groupResp.family_groupid ||
      groupResp.family_group_id ||
      groupResp.nFamilyGroupID ||
      null;

    if (!familyGroupId) {
      results.error = "未找到家庭组，请确认您已加入 Steam 家庭。";
      results.debugInfo = JSON.stringify(groupJson, null, 2).substring(0, 2000);
      return results;
    }

    results.familyGroupId = String(familyGroupId);
    results.steps.push("家庭组: " + familyGroupId);

    // ========== 第2步：获取家庭共享库游戏 ==========
    results.steps.push("获取游戏列表...");

    const appsUrl =
      "https://api.steampowered.com/IFamilyGroupsService/GetSharedLibraryApps/v1/" +
      "?format=json" +
      "&access_token=" +
      apiKey +
      "&family_groupid=" +
      familyGroupId +
      "&include_own=true" +
      "&include_free=false" +
      "&include_excluded=false" +
      "&include_non_games=false" +
      "&language=schinese" +
      "&max_apps=5000" +
      "&steamid=" +
      steamId;

    const appsJson = await steamFetch(appsUrl);
    results.rawResponses.getSharedLibraryApps = appsJson;

    // 解析应用列表
    let apps = [];
    const r = appsJson.response || appsJson;

    if (r.apps && Array.isArray(r.apps)) {
      apps = r.apps
        .map((a) => ({
          appid: a.appid || a.app_id || a.id,
          name: a.name || a.app_name || "",
        }))
        .filter((a) => a.appid);
    } else if (r.apps && typeof r.apps === "object") {
      for (const [id, info] of Object.entries(r.apps)) {
        apps.push({
          appid: parseInt(id),
          name: typeof info === "string" ? info : (info && info.name) || "",
        });
      }
    } else if (Array.isArray(r)) {
      apps = r
        .map((a) => ({
          appid: a.appid || a.app_id || a.id,
          name: a.name || "",
        }))
        .filter((a) => a.appid);
    }

    results.apps = apps;
    results.steps.push("获取到 " + apps.length + " 个游戏");

    if (apps.length === 0) {
      results.steps.push("警告: 游戏列表为空");
      results.debugInfo = JSON.stringify(appsJson, null, 2).substring(0, 2000);
    }

    results.success = true;
  } catch (err) {
    results.error = err.message;
    console.error("[BG] 错误:", err);
  }

  return results;
}

// ============ 消息监听 ============

chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.action === "fetchFamilyLibrary") {
    console.log("[BG] 收到获取请求, steamId:", request.steamId);
    fetchFamilyLibrary(request.apiKey, request.steamId).then((result) => {
      if (result.success && result.apps.length > 0) {
        const familyData = {
          ids: result.apps.map((a) => String(a.appid)),
          apps: result.apps,
          familyGroupId: result.familyGroupId,
          fetchTime: Date.now(),
        };
        chrome.storage.local.set({ familyApps: familyData }, () => {
          chrome.tabs.query(
            { url: "https://store.steampowered.com/*" },
            (tabs) => {
              tabs.forEach((tab) => {
                chrome.tabs
                  .sendMessage(tab.id, { action: "refresh" })
                  .catch(() => {});
              });
            },
          );
        });
      }
      sendResponse(result);
    });
    return true;
  }

  if (request.action === "autoToken") {
    autoFetchToken().then((token) => {
      sendResponse({ token });
    });
    return true;
  }

  if (request.action === "refreshAllTabs") {
    chrome.tabs.query({ url: "https://store.steampowered.com/*" }, (tabs) => {
      tabs.forEach((tab) => {
        chrome.tabs.sendMessage(tab.id, { action: "refresh" }).catch(() => {});
      });
    });
    sendResponse({ ok: true });
  }
});
