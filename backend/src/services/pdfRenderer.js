/**
 * HTML-to-PDF renderer using puppeteer-core + @sparticuz/chromium (Vercel-compatible).
 * Falls back to returning null if Chrome is unavailable (caller should serve HTML directly).
 */

let chromium;
let puppeteer;

async function loadDeps() {
  if (!puppeteer) {
    puppeteer = (await import('puppeteer-core')).default;
  }
  if (!chromium) {
    try {
      chromium = (await import('@sparticuz/chromium')).default;
    } catch {
      chromium = null;
    }
  }
}

/**
 * Render HTML string to PDF buffer.
 * @param {string} html - Full HTML document
 * @returns {Promise<Buffer|null>} PDF buffer, or null if Chrome unavailable
 */
export async function renderHtmlToPdf(html) {
  await loadDeps();

  let executablePath;
  if (chromium) {
    // Vercel / Lambda environment
    executablePath = await chromium.executablePath();
  } else {
    // Local dev — try common Chrome paths
    const paths = [
      '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
      '/usr/bin/google-chrome-stable',
      '/usr/bin/google-chrome',
      '/usr/bin/chromium-browser',
      '/usr/bin/chromium',
    ];
    const { existsSync } = await import('fs');
    executablePath = paths.find(p => existsSync(p));
  }

  if (!executablePath) {
    console.warn('No Chrome executable found — PDF rendering unavailable, returning null');
    return null;
  }

  const browser = await puppeteer.launch({
    args: chromium ? chromium.args : ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage'],
    defaultViewport: chromium ? chromium.defaultViewport : { width: 800, height: 1200 },
    executablePath,
    headless: chromium ? chromium.headless : 'new',
  });

  try {
    const page = await browser.newPage();
    await page.setContent(html, { waitUntil: 'networkidle0' });

    const pdf = await page.pdf({
      format: 'A4',
      printBackground: true,
      margin: { top: '15mm', bottom: '15mm', left: '12mm', right: '12mm' },
    });

    return Buffer.from(pdf);
  } finally {
    await browser.close();
  }
}
