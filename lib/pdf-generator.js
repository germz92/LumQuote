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

  try {
    const puppeteer = require('puppeteer');
    return puppeteer.launch({
      headless: true,
      args: BASE_CHROMIUM_ARGS,
      timeout: 60000,
    });
  } catch (err) {
    console.warn('puppeteer not installed, falling back to serverless chromium:', err.message);
    process.env.USE_SERVERLESS_CHROMIUM = '1';
    return launchBrowser();
  }
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
