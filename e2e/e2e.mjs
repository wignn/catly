// E2E test client VPS Manager vs agent lokal.
import puppeteer from "puppeteer-core";
import { readFile } from "fs/promises";
import { existsSync } from "fs";
import path from "path";

const DIST = "/home/hatch/workspace/vps-manager/client/dist";
const MIME = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".png": "image/png", ".svg": "image/svg+xml", ".ico": "image/x-icon" };

const SHOT = (n) => `/tmp/e2e/shot-${n}.png`;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const results = [];
const check = (name, ok, extra = "") => {
  results.push({ name, ok, extra });
  console.log(`${ok ? "PASS" : "FAIL"} ${name}${extra ? " — " + extra : ""}`);
};

const browser = await puppeteer.launch({
  executablePath: "/opt/meta-chromium/chrome",
  headless: "new",
  args: ["--no-sandbox", "--disable-gpu", "--disable-dev-shm-usage", "--window-size=1280,800", "--no-proxy-server"],
});
const page = await browser.newPage();
await page.setViewport({ width: 1280, height: 800 });
// NOTE: jangan panggil Browser.grantPermissions(localNetworkAccess) — justru merusak;
// enterprise policy LocalNetworkAccessAllowedForUrls di /etc/chromium sudah mengizinkan.
page.on("pageerror", (e) => console.log("PAGEERROR:", e.message));
page.on("console", (m) => { if (m.type() === "error") console.log("CONSOLE:", m.text().slice(0, 160)); });
// Hanya intercept dokumen utama dari disk (bypass LNA check saat navigasi).
// /assets, /api, /ws diteruskan ke reverse proxy same-origin di 127.0.0.1:1420.
await page.setRequestInterception(true);
page.on("request", async (req) => {
  try {
    const u = new URL(req.url());
    if (u.hostname === "127.0.0.1" && u.port === "1420" && u.pathname === "/" && req.resourceType() === "document") {
      const body = await readFile(path.join(DIST, "index.html"));
      await req.respond({ status: 200, contentType: "text/html", body });
      return;
    }
  } catch { /* lanjutkan */ }
  try { await req.continue(); } catch { /* interception sudah mati */ }
});

try {
  await page.goto("http://127.0.0.1:1420/", { waitUntil: "networkidle0", timeout: 20000 });
  check("app dimuat", await page.$(".logo") !== null);
  await page.evaluate(() => localStorage.clear());
  await page.reload({ waitUntil: "networkidle0", timeout: 20000 }); // interception masih nyala
  await page.waitForSelector(".form label:nth-child(1) input", { timeout: 10000 });
  await page.setRequestInterception(false); // matikan agar WS tidak terganggu

  // 1. tambah server (via reverse proxy same-origin di port 1420)
  await page.type('.form label:nth-child(1) input', "test-vps");
  await page.type('.form label:nth-child(2) input', "127.0.0.1");
  await page.click('.form label:nth-child(3) input');
  await page.keyboard.down("Control"); await page.keyboard.press("a"); await page.keyboard.up("Control");
  await page.keyboard.type("1420");
  await page.type('.form label:nth-child(4) input', "testtoken123");
  await page.click(".form .btn.primary");
  await sleep(800);
  const rowText = await page.$eval(".server-rows", (el) => el.innerText).catch(() => "");
  check("tambah server", rowText.includes("test-vps"), rowText.slice(0, 80));

  // 2. uji koneksi
  await page.click(".server-row .row-actions .btn.small");
  await page.waitForFunction(
    () => document.querySelector(".test-msg")?.innerText.length > 0,
    { timeout: 10000 }
  );
  const msg = await page.$eval(".test-msg", (el) => el.innerText);
  check("uji koneksi", msg.startsWith("OK"), msg.slice(0, 100));

  // 3. dashboard
  await page.click(".side nav button:nth-child(2)");
  await sleep(6000);
  const dashText = await page.$eval(".dash", (el) => el.innerText).catch(() => "");
  const hasMetrics = /CPU \d/.test(dashText) && dashText.includes("RAM") && /↓/.test(dashText);
  check("dashboard realtime", hasMetrics, dashText.slice(0, 120).replace(/\n/g, " | "));
  await page.screenshot({ path: SHOT("dashboard") });

  // 4. terminal tab
  await page.click(".side nav button:nth-child(3)");
  await sleep(500);
  await page.click(".tabbar .btn.small"); // + Tab
  await page.waitForFunction(
    () => document.body.innerText.includes("terhubung ke"),
    { timeout: 10000 }
  );
  check("terminal terhubung", true);
  await sleep(1500);
  // ketik perintah (klik helper textarea xterm)
  await page.click(".term-pane .xterm-helper-textarea");
  await page.keyboard.type("echo E2E_OK_123\n");
  await sleep(1500);
  await page.screenshot({ path: SHOT("terminal") });

  // 5. split
  const splitBtns = await page.$x?.("//button[contains(., 'Split')]").catch(() => []) ?? [];
  // fallback: klik tombol kedua di tabbar
  const tabbarBtns = await page.$$(".tabbar .btn.small");
  if (tabbarBtns.length >= 2) await tabbarBtns[1].click();
  await sleep(2000);
  const paneCount = await page.$$eval(".pane", (els) => els.length);
  check("split 2 pane", paneCount === 2, `${paneCount} pane`);
  await page.screenshot({ path: SHOT("split") });
} catch (e) {
  console.log("ERROR:", e.message);
  await page.screenshot({ path: SHOT("error") }).catch(() => {});
}

await browser.close();
const failed = results.filter((r) => !r.ok);
console.log(`\nRINGKASAN: ${results.length - failed.length}/${results.length} lolos`);
process.exit(failed.length ? 1 : 0);
