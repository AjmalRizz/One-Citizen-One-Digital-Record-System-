const fs = require('fs');
const path = require('path');
const { spawn, exec } = require('child_process');

/**
 * Searches common installation locations for Google Chrome, Avast Secure Browser, and Microsoft Edge.
 */
function findAvailableBrowsers() {
  const localAppData = process.env.LOCALAPPDATA || '';
  const progFiles = process.env.ProgramFiles || 'C:\\Program Files';
  const progFilesX86 = process.env['ProgramFiles(x86)'] || 'C:\\Program Files (x86)';

  const searchMap = {
    chrome: [
      path.join(progFiles, 'Google', 'Chrome', 'Application', 'chrome.exe'),
      path.join(progFilesX86, 'Google', 'Chrome', 'Application', 'chrome.exe'),
      path.join(localAppData, 'Google', 'Chrome', 'Application', 'chrome.exe')
    ],
    avast: [
      path.join(progFiles, 'AVAST Software', 'Browser', 'Application', 'AvastBrowser.exe'),
      path.join(progFilesX86, 'AVAST Software', 'Browser', 'Application', 'AvastBrowser.exe'),
      path.join(progFiles, 'Avast Software', 'Browser', 'Application', 'AvastBrowser.exe'),
      path.join(progFilesX86, 'Avast Software', 'Browser', 'Application', 'AvastBrowser.exe'),
      path.join(localAppData, 'AVAST Software', 'Browser', 'Application', 'AvastBrowser.exe')
    ],
    edge: [
      path.join(progFilesX86, 'Microsoft', 'Edge', 'Application', 'msedge.exe'),
      path.join(progFiles, 'Microsoft', 'Edge', 'Application', 'msedge.exe'),
      path.join(localAppData, 'Microsoft', 'Edge', 'Application', 'msedge.exe')
    ]
  };

  const detected = {};

  for (const [browserKey, paths] of Object.entries(searchMap)) {
    for (const exePath of paths) {
      try {
        if (fs.existsSync(exePath)) {
          detected[browserKey] = exePath;
          break;
        }
      } catch (e) {
        // Continue searching
      }
    }
  }

  return detected;
}

let hasLaunched = false;

/**
 * Launches the given URL in Chrome, Avast Secure Browser, or Microsoft Edge.
 * @param {string} url - The URL to open (e.g. http://localhost:5000)
 * @param {object} options - Optional config
 */
function launchInBrowser(url = 'http://localhost:5000', options = {}) {
  // Prevent duplicate launches within the same process lifetime
  if (hasLaunched && !options.force) {
    return;
  }
  hasLaunched = true;

  if (process.env.NO_BROWSER_OPEN === 'true') {
    return;
  }

  const preference = (process.env.PREFERRED_BROWSER || 'auto').toLowerCase();
  const detected = findAvailableBrowsers();

  let targetExe = null;
  let browserName = '';

  // 1. If a specific browser was requested
  if (preference === 'chrome' && detected.chrome) {
    targetExe = detected.chrome;
    browserName = 'Google Chrome';
  } else if (preference === 'avast' && detected.avast) {
    targetExe = detected.avast;
    browserName = 'Avast Secure Browser';
  } else if (preference === 'edge' && detected.edge) {
    targetExe = detected.edge;
    browserName = 'Microsoft Edge';
  } else {
    // 2. Default Priority: Chrome -> Avast -> Edge
    if (detected.chrome) {
      targetExe = detected.chrome;
      browserName = 'Google Chrome';
    } else if (detected.avast) {
      targetExe = detected.avast;
      browserName = 'Avast Secure Browser';
    } else if (detected.edge) {
      targetExe = detected.edge;
      browserName = 'Microsoft Edge';
    }
  }

  if (targetExe) {
    try {
      console.log(`[Browser Launcher] Launching website in ${browserName}: ${url}`);
      const child = spawn(targetExe, [url], {
        detached: true,
        stdio: 'ignore'
      });
      child.unref();
      return;
    } catch (err) {
      console.warn(`[Browser Launcher] Failed to spawn ${browserName}, falling back to default open:`, err.message);
    }
  }

  // 3. Fallback to Windows default handler
  if (process.platform === 'win32') {
    console.log(`[Browser Launcher] Launching website in default Windows browser: ${url}`);
    exec(`start "" "${url}"`, (err) => {
      if (err) {
        console.warn('[Browser Launcher] Default open notification:', err.message);
      }
    });
  } else {
    exec(`xdg-open "${url}" || open "${url}"`, () => {});
  }
}

module.exports = {
  findAvailableBrowsers,
  launchInBrowser
};
