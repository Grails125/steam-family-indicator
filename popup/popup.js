const $ = (id) => document.getElementById(id);

function showStatus(msg, type) {
  const el = $("status");
  el.textContent = msg;
  el.className = "status show " + type;
}

// ============ 检测 Steam ID ============

async function querySteamId() {
  $("steamId").textContent = "检测中...";
  $("steamId").style.color = "#ffcc80";

  // 初始化时加载已保存的 Token
  chrome.storage.local.get(["steamApiKey"], (res) => {
    if (res.steamApiKey) {
      $("apiKey").value = res.steamApiKey;
    } else {
      // 如果缺失，尝试自动获取
      chrome.runtime.sendMessage({ action: "autoToken" }, (resp) => {
        if (resp && resp.token) {
          $("apiKey").value = resp.token;
          showStatus("已为您静默获取 Access Token", "success");
        } else {
          showStatus("无法自动获取 Token，请手动输入或重新登录 Steam", "error");
        }
      });
    }
  });

  try {
    const [tab] = await chrome.tabs.query({
      active: true,
      currentWindow: true,
    });

    if (!tab || !tab.url || !tab.url.includes("store.steampowered.com")) {
      $("steamId").textContent = "请在 store.steampowered.com 页面打开此扩展";
      $("steamId").style.color = "#ffcc80";
      return null;
    }

    const response = await new Promise((resolve, reject) => {
      chrome.tabs.sendMessage(tab.id, { action: "getSteamId" }, (resp) => {
        if (chrome.runtime.lastError) {
          reject(new Error(chrome.runtime.lastError.message));
        } else {
          resolve(resp);
        }
      });
    });

    if (response && response.steamId) {
      $("steamId").textContent = response.steamId;
      $("steamId").style.color = "#66c0f4";
      chrome.storage.local.set({ detectedSteamId: response.steamId });
      return response.steamId;
    }

    $("steamId").textContent = "未检测到，请刷新 Steam 页面后重试";
    $("steamId").style.color = "#ffcc80";
    return null;
  } catch (err) {
    $("steamId").textContent = "通信失败，请刷新页面后重试";
    $("steamId").style.color = "#ef9a9a";
    return null;
  }
}

// ============ 加载 ============

async function loadSaved() {
  const data = await chrome.storage.local.get(["steamApiKey", "familyApps"]);
  if (data.steamApiKey) $("apiKey").value = data.steamApiKey;
  if (data.familyApps) renderGames(data.familyApps);
}

// ============ 保存 Key ============

$("saveKey").addEventListener("click", () => {
  const key = $("apiKey").value.trim();
  if (!key) {
    showStatus("请输入 Access Token", "err");
    return;
  }
  chrome.storage.local.set({ steamApiKey: key }, () => {
    showStatus("Token 已保存 ✓", "ok");
  });
});

// ============ 获取家庭库 ============

$("fetchBtn").addEventListener("click", async () => {
  const saved = await chrome.storage.local.get(["steamApiKey"]);
  const apiKey = (saved.steamApiKey || "").trim();

  if (!apiKey) {
    showStatus("请先输入并保存 Access Token", "err");
    return;
  }

  const steamId = await querySteamId();
  if (!steamId) {
    showStatus("无法获取 Steam ID，请确认已登录 store.steampowered.com", "err");
    return;
  }

  $("fetchBtn").disabled = true;
  $("fetchBtn").textContent = "⏳ 获取中...";
  showStatus("正在请求 API（Steam ID: " + steamId + "）...", "warn");

  chrome.runtime.sendMessage(
    { action: "fetchFamilyLibrary", apiKey: apiKey, steamId: steamId },
    (result) => {
      $("fetchBtn").disabled = false;
      $("fetchBtn").textContent = "📡 获取家庭库";

      if (chrome.runtime.lastError) {
        showStatus("通信错误: " + chrome.runtime.lastError.message, "err");
        return;
      }
      if (!result) {
        showStatus("未收到响应", "err");
        return;
      }

      $("debugBox").textContent =
        "步骤: " +
        (result.steps || []).join(" → ") +
        "\n" +
        "成功: " +
        result.success +
        "\n" +
        "家庭组ID: " +
        (result.familyGroupId || "无") +
        "\n" +
        "游戏数量: " +
        (result.apps || []).length +
        "\n" +
        "错误: " +
        (result.error || "无") +
        "\n\n" +
        (result.debugInfo ? "API响应:\n" + result.debugInfo + "\n\n" : "") +
        (result.rawResponses
          ? "原始:\n" +
            JSON.stringify(result.rawResponses, null, 2).substring(0, 3000)
          : "");

      if (result.error) {
        showStatus("失败: " + result.error, "err");
        return;
      }
      if (!result.success || result.apps.length === 0) {
        showStatus("API 成功但未获取到游戏，请查看调试信息", "warn");
        return;
      }

      showStatus("成功获取 " + result.apps.length + " 个家庭库游戏 ✓", "ok");
      const familyData = {
        ids: result.apps.map((a) => String(a.appid)),
        apps: result.apps,
        familyGroupId: result.familyGroupId,
        fetchTime: Date.now(),
      };
      chrome.storage.local.set({ familyApps: familyData });
      renderGames(familyData);
    },
  );
});

// ============ 渲染 ============

function renderGames(data) {
  const list = $("gameList");
  list.innerHTML = "";
  if (!data || !data.apps || data.apps.length === 0) {
    list.innerHTML = '<div class="empty">家庭库为空</div>';
    $("count").textContent = "0";
    return;
  }
  $("count").textContent = data.apps.length;
  const sorted = [...data.apps].sort((a, b) =>
    (a.name || "").localeCompare(b.name || "", "zh-CN"),
  );
  sorted.forEach((app) => {
    const div = document.createElement("div");
    div.className = "game-item";
    div.innerHTML =
      '<span class="game-name">' +
      (app.name || "未知") +
      '</span><span class="game-id">#' +
      app.appid +
      "</span>";
    list.appendChild(div);
  });
  if (data.fetchTime)
    $("fetchTime").textContent =
      "上次获取: " + new Date(data.fetchTime).toLocaleString();
}

// ============ 调试 ============

$("debugToggle").addEventListener("click", () => {
  const box = $("debugBox");
  box.classList.toggle("open");
  $("debugToggle").textContent = box.classList.contains("open")
    ? "▾ 隐藏调试信息"
    : "▸ 显示调试信息";
});

// ============ 初始化 ============

loadSaved();
querySteamId();
