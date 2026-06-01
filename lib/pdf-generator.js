/**
 * PDF generation — local Puppeteer, serverless Chromium on Render
 * Dependencies are lazy-loaded so the app can boot without loading Puppeteer.
 *
 * puppeteer-core major version must match @sparticuz/chromium (131 → puppeteer 23.x).
 */

const LAUNCH_TIMEOUT_MS = 60000;
const PAGE_TIMEOUT_MS = 30000;
const PDF_TIMEOUT_MS = 45000;

const BASE_CHROMIUM_ARGS = [
  '--no-sandbox',
  '--disable-setuid-sandbox',
  '--disable-dev-shm-usage',
  '--disable-gpu',
];

/** Extra flags for low-memory Linux hosts (Render). Avoid --single-process (hangs page.pdf). */
const SERVERLESS_EXTRA_ARGS = [
  '--disable-software-rasterizer',
  '--disable-extensions',
  '--disable-background-networking',
];

/** Flags known to hang page.pdf() or browser.close() on serverless Chromium. */
const BLOCKED_CHROMIUM_ARG = /--single-process|--use-gl=angle|--use-angle=swiftshader/i;

let sharedBrowser = null;
let browserLaunchPromise = null;
let pdfQueue = Promise.resolve();

function useServerlessChromium() {
  if (
    process.env.USE_SERVERLESS_CHROMIUM === '0' ||
    process.env.USE_SERVERLESS_CHROMIUM === 'false'
  ) {
    return false;
  }

  return (
    process.env.RENDER === 'true' ||
    process.env.USE_SERVERLESS_CHROMIUM === '1' ||
    process.env.USE_SERVERLESS_CHROMIUM === 'true' ||
    (process.env.NODE_ENV === 'production' && process.platform === 'linux')
  );
}

function getPuppeteerCore() {
  return require('puppeteer-core');
}

function logPdfStep(step, startedAt) {
  console.log(`📄 PDF: ${step} (+${Date.now() - startedAt}ms)`);
}

function withTimeout(promise, ms, label) {
  return Promise.race([
    promise,
    new Promise((_, reject) => {
      setTimeout(() => reject(new Error(`${label} timed out after ${ms}ms`)), ms);
    }),
  ]);
}

function buildLaunchArgs(chromiumArgs) {
  const safeChromiumArgs = (chromiumArgs || []).filter(
    (arg) => !BLOCKED_CHROMIUM_ARG.test(arg)
  );
  return [...safeChromiumArgs, ...BASE_CHROMIUM_ARGS, ...SERVERLESS_EXTRA_ARGS];
}

async function closeAllPages(browser) {
  if (!browser) return;
  try {
    const pages = await browser.pages();
    await Promise.all(pages.map((p) => p.close().catch(() => {})));
  } catch {
    // ignore
  }
}

async function closeBrowser(browser, { force = false } = {}) {
  if (!browser) return;
  if (!force && useServerlessChromium() && browser === sharedBrowser) {
    await closeAllPages(browser);
    return;
  }

  try {
    await closeAllPages(browser);
    await withTimeout(browser.close(), 8000, 'Browser close');
  } catch (err) {
    console.warn('PDF browser close:', err.message);
    try {
      const proc = browser.process();
      if (proc && !proc.killed) proc.kill('SIGKILL');
    } catch {
      // ignore
    }
  }

  if (browser === sharedBrowser) {
    sharedBrowser = null;
    browserLaunchPromise = null;
  }
}

async function launchServerlessBrowser(puppeteerCore) {
  const chromium = require('@sparticuz/chromium');
  if (typeof chromium.setGraphicsMode === 'function') {
    chromium.setGraphicsMode(false);
  }

  // @sparticuz/chromium extracts to $HOME; Render should use /tmp
  if (!process.env.HOME) {
    process.env.HOME = '/tmp';
  }

  console.log('📦 Resolving serverless Chromium binary...');
  const executablePath = await withTimeout(
    chromium.executablePath(),
    LAUNCH_TIMEOUT_MS,
    'Chromium binary setup'
  );

  return puppeteerCore.launch({
    args: buildLaunchArgs(chromium.args),
    defaultViewport: chromium.defaultViewport,
    executablePath,
    headless: chromium.headless,
    timeout: LAUNCH_TIMEOUT_MS,
  });
}

async function launchLocalBrowser(puppeteerCore) {
  const launchOptions = {
    headless: true,
    args: BASE_CHROMIUM_ARGS,
    timeout: LAUNCH_TIMEOUT_MS,
  };

  if (process.env.PUPPETEER_EXECUTABLE_PATH) {
    return puppeteerCore.launch({
      ...launchOptions,
      executablePath: process.env.PUPPETEER_EXECUTABLE_PATH,
    });
  }

  const channels = ['chrome', 'msedge'];
  let lastError;

  for (const channel of channels) {
    try {
      return await puppeteerCore.launch({ ...launchOptions, channel });
    } catch (err) {
      lastError = err;
      console.warn(`Could not launch browser channel "${channel}":`, err.message);
    }
  }

  throw new Error(
    `No local Chrome/Edge found for PDF generation. Install Google Chrome or set PUPPETEER_EXECUTABLE_PATH. (${lastError?.message || 'unknown error'})`
  );
}

async function launchBrowser() {
  const puppeteerCore = getPuppeteerCore();

  if (useServerlessChromium()) {
    return launchServerlessBrowser(puppeteerCore);
  }

  return launchLocalBrowser(puppeteerCore);
}

/** Reuse one Chromium process on Render to avoid cold launch + OOM from concurrent PDFs. */
async function acquireBrowser() {
  if (!useServerlessChromium()) {
    return launchBrowser();
  }

  if (sharedBrowser && sharedBrowser.isConnected()) {
    return sharedBrowser;
  }

  if (!browserLaunchPromise) {
    browserLaunchPromise = launchBrowser()
      .then((browser) => {
        sharedBrowser = browser;
        browser.on('disconnected', () => {
          if (sharedBrowser === browser) {
            sharedBrowser = null;
            browserLaunchPromise = null;
          }
        });
        return browser;
      })
      .catch((err) => {
        browserLaunchPromise = null;
        throw err;
      });
  }

  return browserLaunchPromise;
}

async function configurePage(page) {
  page.setDefaultNavigationTimeout(PAGE_TIMEOUT_MS);
  page.setDefaultTimeout(PAGE_TIMEOUT_MS);

  await page.setRequestInterception(true);
  page.on('request', (request) => {
    const url = request.url();
    if (url.startsWith('data:') || url === 'about:blank') {
      request.continue();
      return;
    }
    request.abort();
  });
}

/** Pre-extract Chromium on Render so the first user PDF is not stuck for minutes. */
async function warmupChromium() {
  if (!useServerlessChromium()) return;

  const startedAt = Date.now();
  let page;

  try {
    console.log('🔥 Warming up PDF Chromium (first deploy may take ~30s)...');
    const browser = await acquireBrowser();
    logPdfStep('browser ready', startedAt);
    page = await browser.newPage();
    await page.setContent('<html><body>warmup</body></html>', {
      waitUntil: 'domcontentloaded',
      timeout: PAGE_TIMEOUT_MS,
    });
    await withTimeout(
      page.pdf({ format: 'A4', printBackground: false, timeout: PDF_TIMEOUT_MS }),
      PDF_TIMEOUT_MS + 5000,
      'Warmup PDF render'
    );
    console.log(`✅ PDF Chromium ready (${Date.now() - startedAt}ms)`);
  } catch (err) {
    console.warn('⚠️ PDF Chromium warmup failed (PDFs will retry on demand):', err.message);
    await closeBrowser(sharedBrowser, { force: true });
  } finally {
    if (page) {
      await page.close().catch(() => {});
    }
  }
}

async function generatePdfFromHtml(html, options = {}) {
  const run = async () => {
    const startedAt = Date.now();
    let page;
    let browser;
    const ownsBrowser = !useServerlessChromium();

    try {
      browser = await withTimeout(acquireBrowser(), LAUNCH_TIMEOUT_MS, 'Browser launch');
      logPdfStep('browser acquired', startedAt);

      page = await browser.newPage();
      await configurePage(page);
      logPdfStep('page configured', startedAt);

      await withTimeout(
        page.setContent(html, {
          waitUntil: 'domcontentloaded',
          timeout: PAGE_TIMEOUT_MS,
        }),
        PAGE_TIMEOUT_MS + 5000,
        'Page content load'
      );
      logPdfStep('HTML loaded', startedAt);

      const margin = options.margin || {
        top: '20mm',
        right: '20mm',
        bottom: '20mm',
        left: '20mm',
      };

      const pdfBuffer = await withTimeout(
        page.pdf({
          format: options.format || 'A4',
          margin,
          printBackground: true,
          timeout: PDF_TIMEOUT_MS,
        }),
        PDF_TIMEOUT_MS + 5000,
        'PDF render'
      );
      logPdfStep(`PDF done (${pdfBuffer.length} bytes)`, startedAt);

      return Buffer.from(pdfBuffer);
    } catch (err) {
      if (useServerlessChromium()) {
        await closeBrowser(sharedBrowser, { force: true });
      }
      throw err;
    } finally {
      if (page) {
        await page.close().catch(() => {});
      }
      if (ownsBrowser && browser) {
        await closeBrowser(browser, { force: true });
      }
    }
  };

  // Serialize PDF jobs on serverless — 512MB Render instances cannot run two Chromes.
  if (!useServerlessChromium()) {
    return run();
  }

  const job = pdfQueue.then(run, run);
  pdfQueue = job.catch(() => {});
  return job;
}

module.exports = {
  generatePdfFromHtml,
  launchBrowser,
  useServerlessChromium,
  warmupChromium,
};
