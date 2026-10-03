function log(message) {
  const el = document.getElementById("log");
  el.textContent = `${new Date().toLocaleTimeString()}  ${message}\n` + el.textContent;
}

document.getElementById("btn-404").addEventListener("click", async () => {
  try {
    await fetch("https://httpstat.us/404");
  } catch (e) {
    /* expected */
  }
  log("Requested https://httpstat.us/404");
});

document.getElementById("btn-500").addEventListener("click", async () => {
  try {
    await fetch("https://httpstat.us/500");
  } catch (e) {
    /* expected */
  }
  log("Requested https://httpstat.us/500");
});

document.getElementById("btn-repeat").addEventListener("click", async () => {
  for (let i = 0; i < 6; i++) {
    fetch(`https://jsonplaceholder.typicode.com/users/${(i % 3) + 1}`).catch(() => {});
  }
  log("Fired 6 calls to jsonplaceholder /users/{id}");
});

document.getElementById("btn-duplicate").addEventListener("click", async () => {
  for (let i = 0; i < 4; i++) {
    fetch("https://jsonplaceholder.typicode.com/posts/1").catch(() => {});
  }
  log("Fired 4 rapid duplicate calls to /posts/1");
});

document.getElementById("btn-slow").addEventListener("click", async () => {
  try {
    await fetch("https://httpstat.us/200?sleep=4000");
  } catch (e) {
    /* expected */
  }
  log("Requested a 4s-delayed response from httpstat.us");
});

document.getElementById("btn-throw").addEventListener("click", () => {
  log("Throwing an uncaught TypeError...");
  // Intentional: demonstrates the extension's uncaught-error detector.
  null.triggerIntentionalError();
});

document.getElementById("btn-reject").addEventListener("click", () => {
  log("Triggering an unhandled promise rejection...");
  Promise.reject(new Error("Intentional unhandled rejection for testing"));
});

document.getElementById("btn-console-error").addEventListener("click", () => {
  console.error("Intentional console.error for testing the detector");
  log("Logged a console.error");
});

document.getElementById("btn-large-image").addEventListener("click", () => {
  const img = new Image();
  img.src = `https://picsum.photos/3000/2000?random=${Date.now()}`;
  log("Requested a ~2MB image from picsum.photos");
});

function busyLoop(ms) {
  const end = performance.now() + ms;
  let x = 0;
  while (performance.now() < end) {
    x += Math.sqrt(x + 1);
  }
  return x;
}

document.getElementById("btn-long-task").addEventListener("click", () => {
  log("Running a ~200ms synchronous busy loop...");
  const x = busyLoop(200);
  log(`Busy loop finished (x=${x.toFixed(2)})`);
});

document.getElementById("btn-repeated-failures").addEventListener("click", async () => {
  for (let i = 0; i < 3; i++) {
    fetch("https://httpstat.us/503").catch(() => {});
  }
  log("Fired 3 calls to a failing endpoint (httpstat.us/503)");
});

let pollingTimer = null;
document.getElementById("btn-polling").addEventListener("click", (e) => {
  if (pollingTimer) {
    clearInterval(pollingTimer);
    pollingTimer = null;
    e.target.textContent = "Start/stop regular polling every 2s (excessive polling)";
    log("Stopped polling");
    return;
  }
  pollingTimer = setInterval(() => {
    fetch("https://jsonplaceholder.typicode.com/todos/1").catch(() => {});
  }, 2000);
  e.target.textContent = "Stop polling";
  log("Started polling every 2s — wait ~12-14s for the finding to fire");
});

document.getElementById("btn-dom-burst").addEventListener("click", () => {
  const container = document.createElement("div");
  container.id = "dom-burst-container";
  for (let i = 0; i < 200; i++) {
    const el = document.createElement("div");
    el.textContent = `item ${i}`;
    container.appendChild(el);
  }
  document.body.appendChild(container);
  log("Inserted 200 DOM nodes in one burst");
  setTimeout(() => container.remove(), 3000);
});

document.getElementById("btn-large-script").addEventListener("click", () => {
  const script = document.createElement("script");
  script.src = `https://cdn.jsdelivr.net/npm/three@0.160.0/build/three.js?t=${Date.now()}`;
  document.body.appendChild(script);
  log("Injected an unminified three.js bundle (~1.2MB) to trigger large-JS-bundle detection");
});

document.getElementById("btn-slow-resource").addEventListener("click", () => {
  const img = new Image();
  img.src = `https://httpstat.us/200?sleep=2500&r=${Date.now()}`;
  log("Requested a resource delayed ~2.5s (non-API, so this hits the performance slow-resource detector, not network)");
});

document.getElementById("btn-repeated-updates").addEventListener("click", () => {
  const container = document.createElement("div");
  container.id = "repeated-updates-container";
  document.body.appendChild(container);
  let i = 0;
  const interval = setInterval(() => {
    const el = document.createElement("div");
    el.textContent = `batch ${i}`;
    container.appendChild(el);
    i++;
    if (i >= 10) {
      clearInterval(interval);
      setTimeout(() => container.remove(), 2000);
    }
  }, 150);
  log("Inserting nodes in 10 separate batches ~150ms apart (distinct from a single bulk burst)");
});

document.getElementById("btn-layout-shift").addEventListener("click", () => {
  const target = document.getElementById("shift-target");
  let count = 0;
  const interval = setInterval(() => {
    target.style.height = target.style.height === "300px" ? "1px" : "300px";
    count++;
    if (count >= 6) {
      clearInterval(interval);
      target.style.height = "1px";
    }
  }, 300);
  log("Triggering repeated layout shifts over ~1.8s");
});

document.getElementById("btn-state-change").addEventListener("click", () => {
  const url = `${location.pathname}?t=${Date.now()}`;
  history.pushState({}, "", url);
  log(`Called history.pushState(${url}) — a SPA-style navigation`);
});

document.getElementById("btn-correlated-chain").addEventListener("click", async () => {
  log("Firing a slow request, then immediately blocking the main thread...");
  fetch("https://httpstat.us/200?sleep=3500").catch(() => {});
  setTimeout(() => {
    busyLoop(250);
    log("Busy loop ran right after the slow request — check Findings for a correlated insight");
  }, 3600);
});
