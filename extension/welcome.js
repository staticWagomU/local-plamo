(function () {
  var $ = function (id) {
    return document.getElementById(id);
  };
  // モデルの状態ごとに見せる欄
  var SECTION = { absent: "ask", downloading: "progressBox", loading: "progressBox", error: "failed", ready: "done", idle: "done" };

  document.querySelectorAll(".size").forEach(function (el) {
    el.textContent = mb(MODEL.size);
  });

  navigator.storage.estimate().then(function (est) {
    var free = est.quota - est.usage;
    $("space").textContent = "このブラウザで使える空き容量: 約" + mb(free);
    if (free < MODEL.size) {
      $("space").className = "note ng";
      $("space").textContent += " (足りません。ディスクの空きを増やしてください)";
    }
  });

  function download() {
    chrome.runtime.sendMessage({ type: "download-model" });
    render({ state: "downloading", progress: 0 });
  }
  $("download").onclick = download;
  $("retry").onclick = download;
  $("later").onclick = function () {
    window.close();
  };

  function render(s) {
    Object.keys(SECTION).forEach(function (state) {
      $(SECTION[state]).hidden = SECTION[state] !== SECTION[s.state];
    });
    $("bar").value = s.progress || 0;
    $("progressText").textContent = statusText(s);
    $("error").textContent = s.error || "";
  }

  async function poll() {
    try {
      render(await chrome.runtime.sendMessage({ type: "status" }));
    } finally {
      setTimeout(poll, 500);
    }
  }
  poll();
})();
