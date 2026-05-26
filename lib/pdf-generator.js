/**
 * PDF generation — local Puppeteer, serverless Chromium on Render
 */
const puppeteerCore = require('puppeteer-core');

const BASE_CHROMIUM_ARGS = [
  '--no-sandbox',
  '--disable-setuid-sandbox',
  '--disable-dev-shm-usage',
  '--disable-gpu',
];

/** Extra flags for low-memory Linux hosts (Render); avoid on Windows/local */
const SERVERLESS_EXTRA_ARGS = [
  '--disable-software-rasterizer',
  '--single-process',
];

function useServerlessChromium() {
  return (
    process.env.RENDER === 'true' ||
    process.env.USE_SERVERLESS_CHROMIUM === '1' ||
    process.env.USE_SERVERLESS_CHROMIUM === 'true'
  );
}

async function launchBrowser() {
  if (useServerlessChromium()) {
    const chromium = require('@sparticuz/chromium');
    if (typeof chromium.setGraphicsMode === 'function') {
      chromium.setGraphicsMode(false);
    }

    return puppeteerCore.launch({
      args: [...chromium.args, ...BASE_CHROMIUM_ARGS, ...SERVERLESS_EXTRA_ARGS],
      defaultViewport: chromium.defaultViewport,
      executablePath: await chromium.executablePath(),
      headless: chromium.headless,
      timeout: 60000,
    });
  }

  return launchLocalBrowser();
}

async function launchLocalBrowser() {
  const launchOptions = {
    headless: true,
    args: BASE_CHROMIUM_ARGS,
    timeout: 60000,
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

async function generatePdfFromHtml(html, options = {}) {
  const browser = await launchBrowser();

  try {
    const page = await browser.newPage();
    await page.setContent(html, {
      waitUntil: 'domcontentloaded',
      timeout: 60000,
    });

    const margin = options.margin || {
      top: '20mm',
      right: '20mm',
      bottom: '20mm',
      left: '20mm',
    };

    const pdfBuffer = await page.pdf({
      format: options.format || 'A4',
      margin,
      printBackground: true,
    });

    return Buffer.from(pdfBuffer);
  } finally {
    await browser.close();
  }
}

module.exports = { generatePdfFromHtml, launchBrowser, useServerlessChromium };
