import initWasm, {
  setup_panic_hook,
  extract_igm_record,
  parse_cgma_inhouse,
  compare_records,
} from "./pkg/rust_wasm.js";

const DB_NAME = "cgma-igm-permissions";
const DB_VERSION = 1;
const STORE_NAME = "handles";
const DEBUG_STORAGE_KEY = "cgma-igm-debug-enabled";
const FIRST_VISIT_KEY = "cgma-igm-first-visit";
const OFFLINE_ROOT_PATH = "\\\\fs61\\driftdata\\Drift\\Arkiv\\CGMES\\OFFLINE\\";
const CGMA_ROOT_PATH = "\\\\fs61\\BizTalkFileShare\\BTS2010\\Common\\Tracking\\CGMA_TSO\\";

const el = {
  settingsButton: document.getElementById("settingsButton"),
  settingsDialog: document.getElementById("settingsDialog"),
  closeSettingsButton: document.getElementById("closeSettingsButton"),
  grantOfflineButton: document.getElementById("grantOfflineButton"),
  grantCgmaButton: document.getElementById("grantCgmaButton"),
  copyOfflinePathButton: document.getElementById("copyOfflinePathButton"),
  copyCgmaPathButton: document.getElementById("copyCgmaPathButton"),
  offlineStatusPill: document.getElementById("offlineStatusPill"),
  cgmaStatusPill: document.getElementById("cgmaStatusPill"),
  offlineStatusPillCompact: document.getElementById("offlineStatusPillCompact"),
  cgmaStatusPillCompact: document.getElementById("cgmaStatusPillCompact"),
  offlineValidation: document.getElementById("offlineValidation"),
  cgmaValidation: document.getElementById("cgmaValidation"),
  debugEnabledCheckbox: document.getElementById("debugEnabledCheckbox"),
  refreshButton: document.getElementById("refreshButton"),
  versionSelect: document.getElementById("versionSelect"),
  selectionInfo: document.getElementById("selectionInfo"),
  filesInfoButton: document.getElementById("filesInfoButton"),
  filesInfoPanel: document.getElementById("filesInfoPanel"),
  filesUsedContent: document.getElementById("filesUsedContent"),
  resultSummary: document.getElementById("resultSummary"),
  tabsContainer: document.getElementById("tabsContainer"),
  diffTab: document.getElementById("diffTab"),
  compareTab: document.getElementById("compareTab"),
  tableTab: document.getElementById("tableTab"),
  diffSection: document.getElementById("diffSection"),
  compareSection: document.getElementById("compareSection"),
  tablesSection: document.getElementById("tablesSection"),
  diffChartDk1: document.getElementById("diffChartDk1"),
  diffChartDk2: document.getElementById("diffChartDk2"),
  compareChartDk1: document.getElementById("compareChartDk1"),
  compareChartDk2: document.getElementById("compareChartDk2"),
  resultBodyDk1: document.getElementById("resultBodyDk1"),
  resultBodyDk2: document.getElementById("resultBodyDk2"),
  loaderCard: document.getElementById("loaderCard"),
  progressFill: document.getElementById("progressFill"),
  progressText: document.getElementById("progressText"),
  infoButton: document.getElementById("infoButton"),
  infoTooltip: document.getElementById("infoTooltip"),
};

const state = {
  offlineRootHandle: null,
  cgmaRootHandle: null,
  hasStoredHandles: false,
  discoveredIgmFiles: [],
  discoveredCgmaCandidates: [],
  latestCgmaFileHandle: null,
  cachedIgmRecords: null,
  cachedCgmaEntries: null,
  versionCreatedMap: {},
  latestIgmDateLabel: "",
  latestCgmaPathLabel: "",
  latestCgmaFullPath: "",
  comparisonData: null,
  sortColumn: "aligned_timestamp",
  sortAscending: true,
  visualizationMode: "diff",
  debugEnabled: false,
  initialized: false,
  busy: false,
  folderValidation: {
    offlineRoot: null,
    cgmaRoot: null,
  },
};

const debugLog = {
  log(message, level = 'info') {
    if (!state.debugEnabled) {
      return;
    }
    const timestamp = new Date().toISOString().split('T')[1].split('.')[0];
    const entry = `[${timestamp}] ${message}`;
    if (level === 'error') {
      console.error(entry);
    } else if (level === 'warn') {
      console.warn(entry);
    } else {
      console.log(entry);
    }
  },
};

function loadDebugSetting() {
  try {
    state.debugEnabled = localStorage.getItem(DEBUG_STORAGE_KEY) === "1";
  } catch (_err) {
    state.debugEnabled = false;
  }

  if (el.debugEnabledCheckbox) {
    el.debugEnabledCheckbox.checked = state.debugEnabled;
  }
}

function saveDebugSetting(enabled) {
  state.debugEnabled = Boolean(enabled);
  try {
    localStorage.setItem(DEBUG_STORAGE_KEY, state.debugEnabled ? "1" : "0");
  } catch (_err) {
    // Ignore storage failures; runtime toggle still works for current session.
  }
}

function toYmd(date, zeroPad) {
  const y = date.getUTCFullYear();
  const m = date.getUTCMonth() + 1;
  const d = date.getUTCDate();
  if (zeroPad) {
    return { y: String(y), m: String(m).padStart(2, "0"), d: String(d).padStart(2, "0") };
  }
  return { y: String(y), m: String(m), d: String(d) };
}

function buildFullPath(rootPath, relativePath) {
  const normalized = String(relativePath || "")
    .replaceAll("/", "\\")
    .replace(/^\\+/, "");
  return normalized ? `${rootPath}${normalized}` : rootPath;
}

async function openDb() {
  return await new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);

    request.onerror = () => reject(request.error);
    request.onsuccess = () => resolve(request.result);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        db.createObjectStore(STORE_NAME);
      }
    };
  });
}

async function saveHandle(key, handle) {
  const db = await openDb();
  await new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, "readwrite");
    tx.objectStore(STORE_NAME).put(handle, key);
    tx.oncomplete = resolve;
    tx.onerror = () => reject(tx.error);
  });
}

async function loadHandle(key) {
  const db = await openDb();
  return await new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, "readonly");
    const req = tx.objectStore(STORE_NAME).get(key);
    req.onsuccess = () => resolve(req.result ?? null);
    req.onerror = () => reject(req.error);
  });
}

async function ensureReadPermission(handle, requestIfNeeded = true) {
  if (!handle) {
    return false;
  }
  const opts = { mode: "read" };
  if ((await handle.queryPermission(opts)) === "granted") {
    return true;
  }
  if (!requestIfNeeded) {
    return false;
  }
  return (await handle.requestPermission(opts)) === "granted";
}

function setFolderStatus() {
  const offlineGranted = Boolean(state.offlineRootHandle);
  const cgmaGranted = Boolean(state.cgmaRootHandle);

  // Update header status pills
  if (el.offlineStatusPill) {
    el.offlineStatusPill.className = `status-pill ${offlineGranted ? "status-ok" : "status-missing"}`;
    el.offlineStatusPill.textContent = offlineGranted
      ? `OFFLINE granted (${state.offlineRootHandle.name})`
      : "OFFLINE not granted";
  }

  if (el.cgmaStatusPill) {
    el.cgmaStatusPill.className = `status-pill ${cgmaGranted ? "status-ok" : "status-missing"}`;
    el.cgmaStatusPill.textContent = cgmaGranted
      ? `CGMA granted (${state.cgmaRootHandle.name})`
      : "CGMA not granted";
  }

  // Update compact status pills in comparison output
  if (el.offlineStatusPillCompact) {
    el.offlineStatusPillCompact.className = `status-pill ${offlineGranted ? "status-ok" : "status-missing"}`;
    el.offlineStatusPillCompact.textContent = offlineGranted
      ? `OFFLINE granted (${state.offlineRootHandle.name})`
      : "OFFLINE not granted";
  }

  if (el.cgmaStatusPillCompact) {
    el.cgmaStatusPillCompact.className = `status-pill ${cgmaGranted ? "status-ok" : "status-missing"}`;
    el.cgmaStatusPillCompact.textContent = cgmaGranted
      ? `CGMA granted (${state.cgmaRootHandle.name})`
      : "CGMA not granted";
  }

  // Update validation status in settings
  updateValidationStatus();

  // Auto-run comparison if both folders are granted
  if (offlineGranted && cgmaGranted && !state.busy) {
    debugLog.log("Both folders granted, auto-running comparison");
    triggerComparisonRun("Auto-refreshing comparison...");
  }
}

function validateFolderStructure(handle, folderType) {
  // Check if the folder has expected files
  // For OFFLINE: should contain SSH files
  // For CGMA: should contain XML files
  return true; // Simplified - actual validation happens during file discovery
}

function updateValidationStatus() {
  if (!el.offlineValidation || !el.cgmaValidation) {
    return;
  }

  const offlineGranted = Boolean(state.offlineRootHandle);
  const cgmaGranted = Boolean(state.cgmaRootHandle);

  // Update offline validation status
  if (offlineGranted) {
    el.offlineValidation.className = "validation-status valid";
    el.offlineValidation.textContent = "✓ Granted";
  } else {
    el.offlineValidation.className = "validation-status pending";
    el.offlineValidation.textContent = "Pending";
  }

  // Update CGMA validation status
  if (cgmaGranted) {
    el.cgmaValidation.className = "validation-status valid";
    el.cgmaValidation.textContent = "✓ Granted";
  } else {
    el.cgmaValidation.className = "validation-status pending";
    el.cgmaValidation.textContent = "Pending";
  }
}

function isFirstVisit() {
  try {
    const visited = localStorage.getItem(FIRST_VISIT_KEY);
    return !visited;
  } catch {
    return false;
  }
}

function markFirstVisitDone() {
  try {
    localStorage.setItem(FIRST_VISIT_KEY, "true");
  } catch {
    // Ignore
  }
}

function autoOpenSettingsIfFirstVisit() {
  if (isFirstVisit()) {
    debugLog.log("First visit detected, opening settings dialog");
    el.settingsDialog.showModal();
    markFirstVisitDone();
  }
}

async function refreshStoredHandlePresence() {
  const [offline, cgma] = await Promise.all([
    loadHandle("offlineRoot"),
    loadHandle("cgmaRoot"),
  ]);
  state.hasStoredHandles = Boolean(offline && cgma);
}

function getDiffMagnitude(row) {
  return Math.abs(Number(row.difference_mw) || 0);
}

function setResultSummary(message) {
  el.resultSummary.textContent = message;
}

function clearResults() {
  el.resultBodyDk1.innerHTML = "";
  el.resultBodyDk2.innerHTML = "";
}

function setBusy(active, message = "Working...", fraction = 0) {
  state.busy = active;
  el.loaderCard.classList.toggle("hidden", !active);

  if (el.progressText) {
    el.progressText.textContent = message;
  }
  if (el.progressFill) {
    const clamped = Math.max(0, Math.min(100, Math.round(fraction * 100)));
    el.progressFill.style.width = `${clamped}%`;
  }
}

function setProgress(message, fraction) {
  setBusy(true, message, fraction);
}

function versionRank(version) {
  return String(version || "");
}

function compareVersions(leftVersion, rightVersion) {
  return versionRank(leftVersion).localeCompare(versionRank(rightVersion), undefined, {
    numeric: true,
    sensitivity: "base",
  });
}

function fillVersionSelect(versions) {
  const sorted = [...versions].sort(compareVersions);
  el.versionSelect.innerHTML = "";

  const latestOption = document.createElement("option");
  latestOption.value = "latest";
  latestOption.textContent = "Latest";
  el.versionSelect.appendChild(latestOption);

  for (const v of sorted) {
    const option = document.createElement("option");
    option.value = v;
    option.textContent = v;
    el.versionSelect.appendChild(option);
  }

  el.versionSelect.value = "latest";
}

function parseSshFilename(fileName) {
  const match = fileName.match(
    /^(?<timestamp>\d{8}T\d{4}Z)_2D_(?<area>DKE|DKW)_SSH_(?<version>[A-Za-z0-9-]+)\.zip$/,
  );

  if (!match || !match.groups) {
    return null;
  }

  const { area, version } = match.groups;

  return {
    area,
    version,
  };
}

function buildFilesUsedText(selectedVersion, outputRows) {
  const matchedKeys = new Set(
    (outputRows || []).map(
      (row) => `${row.aligned_timestamp}|${row.area}|${row.ssh_version}|${row.ssh_file}`,
    ),
  );

  const candidateRecords = [];
  const latestByKey = new Map();
  for (const record of state.cachedIgmRecords || []) {
    if (selectedVersion !== "latest" && record.ssh_version !== selectedVersion) {
      continue;
    }

    if (selectedVersion === "latest") {
      const key = `${record.aligned_timestamp}|${record.area}`;
      const existing = latestByKey.get(key);
      if (!existing || compareVersions(record.ssh_version, existing.ssh_version) > 0) {
        latestByKey.set(key, record);
      }
      continue;
    }

    candidateRecords.push(record);
  }

  const fallbackRecords = selectedVersion === "latest"
    ? [...latestByKey.values()]
    : candidateRecords;

  const usedPaths = new Set();
  for (const record of state.cachedIgmRecords || []) {
    const key = `${record.aligned_timestamp}|${record.area}|${record.ssh_version}|${record.ssh_file}`;
    if (matchedKeys.has(key) && record.ssh_full_path) {
      usedPaths.add(record.ssh_full_path);
    }
  }

  if (usedPaths.size === 0) {
    for (const record of fallbackRecords) {
      if (record.ssh_full_path) {
        usedPaths.add(record.ssh_full_path);
      }
    }
  }

  const igmPaths = [...usedPaths].sort((left, right) => left.localeCompare(right, undefined, { numeric: true }));
  const lines = [
    `Selected version: ${selectedVersion}`,
    "",
    "CGMA:",
    state.latestCgmaFullPath || "n/a",
    "",
    `IGM (${igmPaths.length}):`,
  ];

  if (igmPaths.length === 0) {
    lines.push("n/a");
  } else {
    lines.push(...igmPaths);
  }

  return lines.join("\n");
}

function updateFilesUsedPanel(selectedVersion, outputRows) {
  if (!el.filesUsedContent) {
    return;
  }
  el.filesUsedContent.textContent = buildFilesUsedText(selectedVersion, outputRows);
}

function hideFilesInfoPanel() {
  if (el.filesInfoPanel) {
    el.filesInfoPanel.classList.add("hidden");
  }
}

async function findLatestIgmFolder(offlineRootHandle, lookbackDays = 1) {
  lookbackDays = Math.min(lookbackDays, 1);
  let allMatches = [];
  let latestDateLabel = null;

  debugLog.log(`[IGM Discovery] Searching OFFLINE root for 2D scenarios with lookback=${lookbackDays} days`, 'info');
  // Probe root handle to confirm visibility
  try {
    const rootEntries = [];
    for await (const entry of offlineRootHandle.values()) {
      rootEntries.push(`${entry.kind}:${entry.name}`);
      if (rootEntries.length >= 15) { rootEntries.push('...truncated'); break; }
    }
    debugLog.log(`[IGM Discovery] Root handle children: ${rootEntries.length ? rootEntries.join(' | ') : '(empty or inaccessible)'}`, 'info');
  } catch (probeErr) {
    debugLog.log(`[IGM Discovery] Cannot probe root handle: ${String(probeErr.message || probeErr)}`, 'error');
  }

  // Search across the full lookback window to find latest available 2D SSH set.
  for (let offset = 0; offset <= lookbackDays; offset += 1) {
    const date = new Date();
    date.setUTCDate(date.getUTCDate() - offset);
    const { y, m, d } = toYmd(date, true);  // OFFLINE uses zero-padded: 05/04

    const pathLabel = `${y}/${m}/${d}`;
    debugLog.log(`[IGM Discovery] Checking date path: ${pathLabel}`, 'info');

    let yearDir;
    try {
      yearDir = await offlineRootHandle.getDirectoryHandle(y);
      debugLog.log(`[IGM Discovery] ✓ Year dir exists: ${y}`, 'info');
    } catch (err) {
      debugLog.log(`[IGM Discovery] ✗ Year dir missing: ${y} (${String(err.message || err)})`, 'warn');
      continue;
    }

    let monthDir;
    try {
      monthDir = await yearDir.getDirectoryHandle(m);
      debugLog.log(`[IGM Discovery] ✓ Month dir exists: ${y}/${m}`, 'info');
    } catch (err) {
      debugLog.log(`[IGM Discovery] ✗ Month dir missing: ${y}/${m} (${String(err.message || err)})`, 'warn');
      try {
        const visible = [];
        for await (const entry of yearDir.values()) {
          visible.push(`${entry.kind}:${entry.name}`);
          if (visible.length >= 20) { visible.push('...truncated'); break; }
        }
        debugLog.log(`[IGM Discovery]   Actual children of ${y}: ${visible.length ? visible.join(' | ') : '(empty or inaccessible)'}`, 'warn');
      } catch (listErr) {
        debugLog.log(`[IGM Discovery]   Cannot enumerate ${y}: ${String(listErr.message || listErr)}`, 'error');
      }
      continue;
    }

    let dayDir;
    try {
      dayDir = await monthDir.getDirectoryHandle(d);
      debugLog.log(`[IGM Discovery] ✓ Day dir exists: ${y}/${m}/${d}`, 'info');
    } catch (err) {
      debugLog.log(`[IGM Discovery] ✗ Day dir missing: ${y}/${m}/${d} (${String(err.message || err)})`, 'warn');
      continue;
    }

    try {
      const dateMatches = [];
      const allEntriesInDay = [];
      let nonUsefulCount = 0;
      let usefulLogged = 0;
      let nonUsefulLogged = 0;
      for await (const entry of dayDir.values()) {
        allEntriesInDay.push(entry.name);
        if (entry.kind !== "file") {
          continue;
        }

        const isUseful = Boolean(parseSshFilename(entry.name));
        if (isUseful) {
          dateMatches.push({
            handle: entry,
            pathLabel: `${y}/${m}/${d}/${entry.name}`,
            fullPath: buildFullPath(OFFLINE_ROOT_PATH, `${y}/${m}/${d}/${entry.name}`),
          });
          if (usefulLogged < 30) {
            debugLog.log(`[IGM Discovery] Useful file: ${entry.name}`, 'success');
            usefulLogged += 1;
          }
        } else {
          nonUsefulCount += 1;
          if (nonUsefulLogged < 30) {
            debugLog.log(`[IGM Discovery] Not useful file: ${entry.name}`, 'warn');
            nonUsefulLogged += 1;
          }
        }
      }

      debugLog.log(`[IGM Discovery] Files in ${y}/${m}/${d}: ${allEntriesInDay.length} total`, 'info');
      if (allEntriesInDay.length > 0) {
        debugLog.log(`[IGM Discovery]   Sample files: ${allEntriesInDay.slice(0, 3).join(', ')}${allEntriesInDay.length > 3 ? '...' : ''}`, 'info');
      }
      debugLog.log(`[IGM Discovery] Useful files: ${dateMatches.length} | Not useful files: ${nonUsefulCount}`, 'info');
      if (dateMatches.length > usefulLogged) {
        debugLog.log(`[IGM Discovery] Useful log limit reached, ${dateMatches.length - usefulLogged} additional useful files not shown`, 'info');
      }
      if (nonUsefulCount > nonUsefulLogged) {
        debugLog.log(`[IGM Discovery] Not useful log limit reached, ${nonUsefulCount - nonUsefulLogged} additional files not shown`, 'warn');
      }
      debugLog.log(`[IGM Discovery] 2D DKE/DKW SSH matches found: ${dateMatches.length}`, 'info');

      if (dateMatches.length > 0) {
        allMatches = allMatches.concat(dateMatches);
        if (!latestDateLabel) {
          latestDateLabel = `${y}-${m}-${d}`;
        }
      }
    } catch (err) {
      debugLog.log(`[IGM Discovery] ✗ Failed while listing ${pathLabel}: ${String(err.message || err)}`, 'warn');
    }
  }

  if (allMatches.length === 0) {
    const errorMsg = `No 2D DKE/DKW SSH files found in the OFFLINE root within lookback range.`;
    debugLog.log(errorMsg, 'error');
    throw new Error(errorMsg);
  }

  debugLog.log(`[IGM Discovery] ✓ Total 2D DKE/DKW SSH files found: ${allMatches.length}`, 'info');

  return {
    handle: null,
    dateLabel: latestDateLabel,
    files: allMatches,
  };
}

async function findLatestCgmaXml(cgmaRootHandle, lookbackDays = 1) {
  lookbackDays = Math.min(lookbackDays, 1);
  const candidates = [];

  debugLog.log(`[CGMA Discovery] Searching CGMA root for Inhouse XML with lookback=${lookbackDays} days`, 'info');

  for (let offset = 0; offset <= lookbackDays; offset += 1) {
    const date = new Date();
    date.setUTCDate(date.getUTCDate() - offset);
    const { y, m, d } = toYmd(date, false);

    const pathLabel = `${y}/${m}/${d}`;
    debugLog.log(`[CGMA Discovery] Checking date path: ${pathLabel}`, 'info');

    let yearDir;
    try {
      yearDir = await cgmaRootHandle.getDirectoryHandle(y);
      debugLog.log(`[CGMA Discovery] ✓ Year dir exists: ${y}`, 'info');
    } catch (err) {
      debugLog.log(`[CGMA Discovery] ✗ Year dir missing: ${y} (${String(err.message || err)})`, 'warn');
      continue;
    }

    let monthDir;
    try {
      monthDir = await yearDir.getDirectoryHandle(m);
      debugLog.log(`[CGMA Discovery] ✓ Month dir exists: ${y}/${m}`, 'info');
    } catch (err) {
      debugLog.log(`[CGMA Discovery] ✗ Month dir missing: ${y}/${m} (${String(err.message || err)})`, 'warn');
      continue;
    }

    let dayDir;
    try {
      dayDir = await monthDir.getDirectoryHandle(d);
      debugLog.log(`[CGMA Discovery] ✓ Day dir exists: ${pathLabel}`, 'info');
    } catch (err) {
      debugLog.log(`[CGMA Discovery] ✗ Day dir missing: ${pathLabel} (${String(err.message || err)})`, 'warn');
      continue;
    }

    try {
      let guidDirsFound = 0;
      for await (const guidDir of dayDir.values()) {
        if (guidDir.kind !== "directory") {
          continue;
        }
        guidDirsFound++;
        debugLog.log(`[CGMA Discovery]   Scanning GUID dir: ${guidDir.name}`, 'info');
        
        for await (const entry of guidDir.values()) {
          if (entry.kind !== "file") {
            continue;
          }
          if (!/^Inhouse_XML_.*\.xml$/i.test(entry.name)) {
            continue;
          }

          const file = await entry.getFile();
          candidates.push({
            handle: entry,
            pathLabel: `${y}/${m}/${d}/${guidDir.name}/${entry.name}`,
            fullPath: buildFullPath(CGMA_ROOT_PATH, `${y}/${m}/${d}/${guidDir.name}/${entry.name}`),
            modified: file.lastModified,
          });
          debugLog.log(`[CGMA Discovery]     Found: ${entry.name} (modified: ${new Date(file.lastModified).toISOString()})`, 'info');
        }
      }
      debugLog.log(`[CGMA Discovery] Scanned ${guidDirsFound} GUID directories in ${pathLabel}`, 'info');
    } catch (err) {
      debugLog.log(`[CGMA Discovery] ✗ Failed while listing ${pathLabel}: ${String(err.message || err)}`, 'warn');
    }
  }

  if (candidates.length === 0) {
    const errorMsg = `No Inhouse XML file found in CGMA root within lookback range. Searched ${lookbackDays} day folders.`;
    debugLog.log(errorMsg, 'error');
    throw new Error(errorMsg);
  }

  candidates.sort((a, b) => b.modified - a.modified);
  debugLog.log(`[CGMA Discovery] ✓ Candidate files discovered: ${candidates.length}`, 'info');
  debugLog.log(`[CGMA Discovery] Latest by modified time: ${candidates[0].pathLabel}`, 'info');

  return {
    best: candidates[0],
    candidates,
  };
}

async function scanSources() {
  debugLog.log(`Scanning sources...`);
  const igm = await findLatestIgmFolder(state.offlineRootHandle);
  debugLog.log(`Found IGM files: ${igm.files.length} in date ${igm.dateLabel}`);
  state.discoveredIgmFiles = igm.files;
  state.latestIgmDateLabel = igm.dateLabel || "n/a";

  const cgma = await findLatestCgmaXml(state.cgmaRootHandle);
  debugLog.log(`Found CGMA latest file: ${cgma.best.pathLabel}`);
  state.discoveredCgmaCandidates = cgma.candidates;
  state.latestCgmaFileHandle = cgma.best.handle;
  state.latestCgmaPathLabel = cgma.best.pathLabel;

  const versionSet = new Set();
  for (const f of igm.files) {
    const parsed = parseSshFilename(f.name);
    if (parsed) {
      versionSet.add(parsed.version);
    }
  }

  fillVersionSelect([...versionSet]);
}

function computeVersionCreatedMap(igmRecords) {
  const versions = new Map();
  for (const rec of igmRecords) {
    const version = String(rec.ssh_version || "");
    const created = String(rec.ssh_created || "");
    if (!version || !created) {
      continue;
    }
    if (!versions.has(version)) {
      versions.set(version, new Set());
    }
    versions.get(version).add(created);
  }

  const out = {};
  for (const [version, createdSet] of versions.entries()) {
    const values = [...createdSet];
    out[version] = values.length === 1 ? values[0] : `${values[0]} (mixed created timestamps)`;
  }
  return out;
}

function countUniqueTimeslots(rows) {
  const slots = new Set(rows.map((r) => r.aligned_timestamp));
  return slots.size;
}

function updateSelectionInfo(selectedVersion, outputRows) {
  const versionLabel = selectedVersion === "latest" ? "latest" : selectedVersion;
  const createdLabel =
    selectedVersion === "latest"
      ? "n/a (latest mode can mix versions)"
      : (state.versionCreatedMap[selectedVersion] || "n/a");

  const timeslotCount = countUniqueTimeslots(outputRows || []);
  el.selectionInfo.textContent =
    `IGM date folder: ${state.latestIgmDateLabel} | CGMA file: ${state.latestCgmaPathLabel || "n/a"} | ` +
    `Selected version: ${versionLabel} | Version created: ${createdLabel} | Timeslots: ${timeslotCount}`;
}

function applySelectedVersion(selectedVersion) {
  if (!state.parsedIgmRecords || !state.parsedCgmaEntries) {
    return;
  }

  const output = compare_records(
    state.parsedIgmRecords,
    state.parsedCgmaEntries,
    selectedVersion,
    50,
    200,
  );

  renderRows(output.rows);
  updateSelectionInfo(selectedVersion, output.rows);
  updateFilesUsedPanel(selectedVersion, output.rows);
  setResultSummary(
    `Matched rows: ${output.matched_rows} | Versions discovered: ${output.discovered_versions.join(", ") || "n/a"} | Version mode: ${selectedVersion}`
  );
}

function sortRows(rows) {
  const sorted = [...rows];
  sorted.sort((a, b) => {
    const aSource = state.sortColumn === "difference_mw" ? getDiffMagnitude(a) : a[state.sortColumn];
    const bSource = state.sortColumn === "difference_mw" ? getDiffMagnitude(b) : b[state.sortColumn];
    let aVal = aSource;
    let bVal = bSource;
    
    if (typeof aVal === 'string') {
      aVal = String(aVal).toLowerCase();
      bVal = String(bVal).toLowerCase();
    }
    
    if (aVal < bVal) return state.sortAscending ? -1 : 1;
    if (aVal > bVal) return state.sortAscending ? 1 : -1;
    return 0;
  });
  return sorted;
}

function renderTablesView(rows) {
  clearResults();
  const sorted = sortRows(rows);

  for (const row of sorted) {
    const tr = document.createElement("tr");
    const statusClass = `status-${String(row.status).toLowerCase()}`;

    tr.innerHTML = `
      <td>${row.aligned_timestamp}</td>
      <td>${row.ssh_version}</td>
      <td>${Number(row.ssh_net_interchange_mw).toFixed(3)}</td>
      <td>${Number(row.cgma_net_position_mw).toFixed(3)}</td>
      <td>${getDiffMagnitude(row).toFixed(3)}</td>
      <td class="${statusClass}">${row.status}</td>
    `;

    if (row.area === "DK1") {
      el.resultBodyDk1.appendChild(tr);
    } else if (row.area === "DK2") {
      el.resultBodyDk2.appendChild(tr);
    }
  }

}

function renderDiffChartsView(rows) {
  clearResults();
  
  if (!window.Chart) {
    debugLog.log("Chart.js library not loaded yet", 'warn');
    return;
  }

  const sorted = sortRows(rows);
  
  // Separate by area
  const dk1Rows = sorted.filter(r => r.area === "DK1");
  const dk2Rows = sorted.filter(r => r.area === "DK2");

  // Helper to get color based on status
  const statusColors = {
    "NORMAL": "#62d181",
    "WARNING": "#f0bf52",
    "ERROR": "#f1786d"
  };

  // Chart configuration
  const chartConfig = {
    type: 'line',
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: {
          labels: { color: '#e8f6ff' }
        }
      },
      scales: {
        x: {
          ticks: { color: '#a4bfd0' },
          grid: { color: 'rgba(167, 225, 255, 0.1)' }
        },
        y: {
          ticks: { color: '#a4bfd0' },
          grid: { color: 'rgba(167, 225, 255, 0.1)' },
          title: { display: true, text: 'Difference (MW)', color: '#a4bfd0' }
        }
      }
    }
  };

  // Render DK1 chart
  if (dk1Rows.length > 0) {
    const dk1Ctx = el.diffChartDk1.getContext('2d');
    if (window.diffDk1Chart) window.diffDk1Chart.destroy();
    window.diffDk1Chart = new Chart(dk1Ctx, {
      ...chartConfig,
      data: {
        labels: dk1Rows.map(r => r.aligned_timestamp),
        datasets: [{
          label: 'Difference (SSH - CGMA)',
          data: dk1Rows.map(r => getDiffMagnitude(r)),
          borderColor: '#4ad5c6',
          backgroundColor: 'rgba(74, 213, 198, 0.1)',
          tension: 0.4,
          fill: true,
          borderWidth: 2,
          pointRadius: 4,
          pointBackgroundColor: dk1Rows.map(r => statusColors[r.status] || '#4ad5c6'),
          pointBorderColor: '#e8f6ff',
          pointBorderWidth: 1
        }]
      }
    });
  }

  // Render DK2 chart
  if (dk2Rows.length > 0) {
    const dk2Ctx = el.diffChartDk2.getContext('2d');
    if (window.diffDk2Chart) window.diffDk2Chart.destroy();
    window.diffDk2Chart = new Chart(dk2Ctx, {
      ...chartConfig,
      data: {
        labels: dk2Rows.map(r => r.aligned_timestamp),
        datasets: [{
          label: 'Difference (SSH - CGMA)',
          data: dk2Rows.map(r => getDiffMagnitude(r)),
          borderColor: '#6bb0ff',
          backgroundColor: 'rgba(107, 176, 255, 0.1)',
          tension: 0.4,
          fill: true,
          borderWidth: 2,
          pointRadius: 4,
          pointBackgroundColor: dk2Rows.map(r => statusColors[r.status] || '#6bb0ff'),
          pointBorderColor: '#e8f6ff',
          pointBorderWidth: 1
        }]
      }
    });
  }
}

function renderCompareChartsView(rows) {
  clearResults();
  
  if (!window.Chart) {
    debugLog.log("Chart.js library not loaded yet", 'warn');
    return;
  }

  const sorted = sortRows(rows);
  
  // Separate by area
  const dk1Rows = sorted.filter(r => r.area === "DK1");
  const dk2Rows = sorted.filter(r => r.area === "DK2");

  // Chart configuration
  const chartConfig = {
    type: 'line',
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: {
          labels: { color: '#e8f6ff' }
        }
      },
      scales: {
        x: {
          ticks: { color: '#a4bfd0' },
          grid: { color: 'rgba(167, 225, 255, 0.1)' }
        },
        y: {
          ticks: { color: '#a4bfd0' },
          grid: { color: 'rgba(167, 225, 255, 0.1)' },
          title: { display: true, text: 'MW', color: '#a4bfd0' }
        }
      }
    }
  };

  // Render DK1 chart
  if (dk1Rows.length > 0) {
    const dk1Ctx = el.compareChartDk1.getContext('2d');
    if (window.compareDk1Chart) window.compareDk1Chart.destroy();
    window.compareDk1Chart = new Chart(dk1Ctx, {
      ...chartConfig,
      data: {
        labels: dk1Rows.map(r => r.aligned_timestamp),
        datasets: [
          {
            label: 'IGM (SSH)',
            data: dk1Rows.map(r => r.ssh_net_interchange_mw),
            borderColor: '#4ad5c6',
            backgroundColor: 'rgba(74, 213, 198, 0.08)',
            tension: 0.4,
            fill: true,
            borderWidth: 2,
            pointRadius: 3,
            pointBorderColor: '#e8f6ff',
            pointBorderWidth: 1
          },
          {
            label: 'CGMA',
            data: dk1Rows.map(r => r.cgma_net_position_mw),
            borderColor: '#f0bf52',
            backgroundColor: 'rgba(240, 191, 82, 0.08)',
            tension: 0.4,
            fill: true,
            borderWidth: 2,
            pointRadius: 3,
            pointBorderColor: '#e8f6ff',
            pointBorderWidth: 1
          }
        ]
      }
    });
  }

  // Render DK2 chart
  if (dk2Rows.length > 0) {
    const dk2Ctx = el.compareChartDk2.getContext('2d');
    if (window.compareDk2Chart) window.compareDk2Chart.destroy();
    window.compareDk2Chart = new Chart(dk2Ctx, {
      ...chartConfig,
      data: {
        labels: dk2Rows.map(r => r.aligned_timestamp),
        datasets: [
          {
            label: 'IGM (SSH)',
            data: dk2Rows.map(r => r.ssh_net_interchange_mw),
            borderColor: '#6bb0ff',
            backgroundColor: 'rgba(107, 176, 255, 0.08)',
            tension: 0.4,
            fill: true,
            borderWidth: 2,
            pointRadius: 3,
            pointBorderColor: '#e8f6ff',
            pointBorderWidth: 1
          },
          {
            label: 'CGMA',
            data: dk2Rows.map(r => r.cgma_net_position_mw),
            borderColor: '#f0bf52',
            backgroundColor: 'rgba(240, 191, 82, 0.08)',
            tension: 0.4,
            fill: true,
            borderWidth: 2,
            pointRadius: 3,
            pointBorderColor: '#e8f6ff',
            pointBorderWidth: 1
          }
        ]
      }
    });
  }
}

function renderRows(rows) {
  state.comparisonData = rows;
  state.sortColumn = "aligned_timestamp";
  state.sortAscending = true;
  
  if (state.visualizationMode === "diff") {
    renderDiffChartsView(rows);
  } else if (state.visualizationMode === "compare") {
    renderCompareChartsView(rows);
  } else {
    renderTablesView(rows);
  }
}

async function runComparison() {
  debugLog.log(`Starting comparison run...`, 'info');
  if (!state.offlineRootHandle || !state.cgmaRootHandle) {
    throw new Error("Please configure both folder permissions in Settings first.");
  }

  setProgress("Scanning source folders...", 0.08);
  await scanSources();

  const igmRecords = [];
  const totalIgm = state.discoveredIgmFiles.length || 1;
  debugLog.log(`Parsing ${state.discoveredIgmFiles.length} IGM files...`, 'info');
  for (let i = 0; i < state.discoveredIgmFiles.length; i += 1) {
    const fileItem = state.discoveredIgmFiles[i];
    const file = await fileItem.handle.getFile();
    const bytes = new Uint8Array(await file.arrayBuffer());
    try {
      const record = extract_igm_record(file.name, bytes);
      record.ssh_full_path = fileItem.fullPath;
      igmRecords.push(record);
      debugLog.log(`✓ Parsed IGM: ${file.name}`, 'info');
    } catch (err) {
      debugLog.log(`✗ Failed to parse IGM ${file.name}: ${String(err).substring(0, 100)}`, 'warn');
    }
    const fraction = 0.08 + 0.62 * ((i + 1) / totalIgm);
    setProgress(`Parsing IGM ${i + 1}/${totalIgm}...`, fraction);
  }

  debugLog.log(`Successfully parsed ${igmRecords.length}/${state.discoveredIgmFiles.length} IGM records`, 'info');
  if (igmRecords.length === 0) {
    throw new Error("No parseable IGM records were found in the selected date folder.");
  }

  setProgress("Selecting CGMA file...", 0.75);
  const igmKeySet = new Set(igmRecords.map((r) => `${r.aligned_timestamp}|${r.area}`));
  const cgmaCandidates = (state.discoveredCgmaCandidates || []).slice(0, 12);
  if (cgmaCandidates.length === 0) {
    throw new Error("No CGMA candidate files were discovered.");
  }

  let selectedCandidate = cgmaCandidates[0];
  let selectedEntries = null;
  let bestOverlap = -1;

  for (let i = 0; i < cgmaCandidates.length; i += 1) {
    const candidate = cgmaCandidates[i];
    setProgress(`Evaluating CGMA candidate ${i + 1}/${cgmaCandidates.length}...`, 0.75 + (0.09 * ((i + 1) / cgmaCandidates.length)));

    const cgmaFile = await candidate.handle.getFile();
    const cgmaText = await cgmaFile.text();
    const entries = parse_cgma_inhouse(cgmaText, false);

    const cgmaKeySet = new Set(entries.map((row) => `${row.timestamp}|${row.area}`));
    let overlap = 0;
    for (const key of igmKeySet) {
      if (cgmaKeySet.has(key)) {
        overlap += 1;
      }
    }

    debugLog.log(`[CGMA Selection] Candidate ${i + 1}: ${candidate.pathLabel} | entries=${entries.length} | overlap=${overlap}`, 'info');

    if (overlap > bestOverlap) {
      bestOverlap = overlap;
      selectedCandidate = candidate;
      selectedEntries = entries;
    }
  }

  if (!selectedEntries) {
    throw new Error("Failed to parse any CGMA candidate file.");
  }

  state.latestCgmaFileHandle = selectedCandidate.handle;
  state.latestCgmaPathLabel = selectedCandidate.pathLabel;
  state.latestCgmaFullPath = selectedCandidate.fullPath || buildFullPath(CGMA_ROOT_PATH, selectedCandidate.pathLabel);
  debugLog.log(`[CGMA Selection] Using file: ${selectedCandidate.pathLabel} (overlap=${bestOverlap})`, 'info');
  if (selectedCandidate.pathLabel !== cgmaCandidates[0].pathLabel) {
    debugLog.log(`[CGMA Selection] Newest CGMA had lower overlap. Fell back to an older file for matching.`, 'warn');
  }

  setProgress("Parsing CGMA entries...", 0.84);
  const cgmaEntries = selectedEntries;
  debugLog.log(`Parsed ${cgmaEntries.length} CGMA entries from selected file`, 'info');
  if (cgmaEntries.length === 0) {
    throw new Error(
      "No CGMA net-position rows were parsed from the selected Inhouse XML. Verify the newest CGMA file format and date path."
    );
  }

  state.cachedIgmRecords = igmRecords;
  state.cachedCgmaEntries = cgmaEntries;
  state.versionCreatedMap = computeVersionCreatedMap(igmRecords);

  const selectedVersion = el.versionSelect.value || "latest";
  setProgress("Comparing records...", 0.93);
  debugLog.log(`Running comparison with version mode: ${selectedVersion}`, 'info');
  const output = compare_records(state.cachedIgmRecords, state.cachedCgmaEntries, selectedVersion, 50, 200);
  debugLog.log(`Comparison complete: ${output.matched_rows} rows matched`, 'info');

  setProgress("Rendering tables...", 0.98);
  renderRows(output.rows);
  updateSelectionInfo(selectedVersion, output.rows);
  updateFilesUsedPanel(selectedVersion, output.rows);
  setResultSummary(
    `Matched rows: ${output.matched_rows} | Versions discovered: ${output.discovered_versions.join(", ") || "n/a"
    } | Version mode: ${selectedVersion}`
  );

  setProgress("Done", 1);
}

function countOverlapKeys(igmRecords, cgmaEntries) {
  const igmKeys = new Set((igmRecords || []).map((r) => `${r.aligned_timestamp}|${r.area}`));
  const cgmaKeys = new Set((cgmaEntries || []).map((r) => `${r.timestamp}|${r.area}`));

  let overlap = 0;
  for (const key of igmKeys) {
    if (cgmaKeys.has(key)) {
      overlap += 1;
    }
  }
  return overlap;
}

async function triggerComparisonRun(startMessage = "Refreshing comparison...") {
  if (state.busy) {
    return;
  }

  setBusy(true, startMessage, 0.02);
  try {
    await runComparison();

    if ((state.comparisonData || []).length === 0) {
      const igmCount = (state.cachedIgmRecords || []).length;
      const cgmaCount = (state.cachedCgmaEntries || []).length;
      const overlap = countOverlapKeys(state.cachedIgmRecords, state.cachedCgmaEntries);
      setResultSummary(
        `Comparison complete: 0 rows matched. Parsed IGM: ${igmCount}, CGMA: ${cgmaCount}, overlapping timestamp/area keys: ${overlap}.`
      );
    }
  } catch (err) {
    const msg = String(err.message || err);
    debugLog.log(`Comparison failed: ${msg}`, 'error');
    setResultSummary(msg);
  } finally {
    setBusy(false);
  }
}

async function logHandlePreview(handle, label) {
  try {
    const entries = [];
    let fileCount = 0;
    let dirCount = 0;

    for await (const entry of handle.values()) {
      entries.push(`${entry.kind}:${entry.name}`);
      if (entry.kind === "file") {
        fileCount += 1;
      } else if (entry.kind === "directory") {
        dirCount += 1;
      }
      if (entries.length >= 15) {
        break;
      }
    }

    debugLog.log(`[Folder Probe] ${label}: top-level dirs=${dirCount}, files=${fileCount} (sampled first ${entries.length} entries)`, 'info');
    if (entries.length > 0) {
      debugLog.log(`[Folder Probe] ${label}: ${entries.join(' | ')}`, 'info');
    } else {
      debugLog.log(`[Folder Probe] ${label}: folder appears empty or inaccessible`, 'warn');
    }
  } catch (err) {
    debugLog.log(`[Folder Probe] ${label}: unable to enumerate entries (${String(err.message || err)})`, 'warn');
  }
}

async function grantOfflineRoot() {
  debugLog.log(`Requesting OFFLINE root access...`, 'info');
  const handle = await window.showDirectoryPicker({ mode: "read" });
  debugLog.log(`OFFLINE root handle obtained`, 'info');
  if (!(await ensureReadPermission(handle))) {
    throw new Error("Read permission denied for OFFLINE root.");
  }
  state.offlineRootHandle = handle;
  await saveHandle("offlineRoot", handle);
  await refreshStoredHandlePresence();
  setFolderStatus();
  await logHandlePreview(handle, "OFFLINE root");
  debugLog.log(`OFFLINE root saved: "${handle.name}" (key: offlineRoot)`, 'info');
}

async function grantCgmaRoot() {
  debugLog.log(`Requesting CGMA root access...`, 'info');
  const handle = await window.showDirectoryPicker({ mode: "read" });
  debugLog.log(`CGMA root handle obtained`, 'info');
  if (!(await ensureReadPermission(handle))) {
    throw new Error("Read permission denied for CGMA root.");
  }
  state.cgmaRootHandle = handle;
  await saveHandle("cgmaRoot", handle);
  await refreshStoredHandlePresence();
  setFolderStatus();
  await logHandlePreview(handle, "CGMA root");
  debugLog.log(`CGMA root saved: "${handle.name}" (key: cgmaRoot)`, 'info');
}

async function restoreHandles(requestPermissions = false) {
  const offline = await loadHandle("offlineRoot");
  const cgma = await loadHandle("cgmaRoot");
  await refreshStoredHandlePresence();

  if (offline && (await ensureReadPermission(offline, requestPermissions))) {
    state.offlineRootHandle = offline;
    debugLog.log(`Restored OFFLINE root: "${offline.name}"`, 'info');
  } else if (offline) {
    state.offlineRootHandle = null;
    debugLog.log(`OFFLINE root "${offline.name}" in IndexedDB but permission not granted`, 'warn');
  } else {
    state.offlineRootHandle = null;
  }
  if (cgma && (await ensureReadPermission(cgma, requestPermissions))) {
    state.cgmaRootHandle = cgma;
    debugLog.log(`Restored CGMA root: "${cgma.name}"`, 'info');
  } else if (cgma) {
    state.cgmaRootHandle = null;
    debugLog.log(`CGMA root "${cgma.name}" in IndexedDB but permission not granted`, 'warn');
  } else {
    state.cgmaRootHandle = null;
  }

  setFolderStatus();

  return {
    offlineRestored: Boolean(state.offlineRootHandle),
    cgmaRestored: Boolean(state.cgmaRootHandle),
  };
}

async function copyPathFromInput(inputEl, label) {
  if (!inputEl) {
    return;
  }
  const text = inputEl.value;
  try {
    await navigator.clipboard.writeText(text);
    setResultSummary(`${label} path copied to clipboard.`);
  } catch (_err) {
    inputEl.focus();
    inputEl.select();
    setResultSummary(`Clipboard permission denied. ${label} path selected for manual copy.`);
  }
}

async function regrantStoredFolders() {
  if (!state.hasStoredHandles) {
    setResultSummary("No saved folders to re-grant yet. Use Settings to grant both roots once.");
    return;
  }

  setBusy(true, "Re-granting saved folder permissions...");
  try {
    const restored = await restoreHandles(true);
    if (restored.offlineRestored && restored.cgmaRestored) {
      setResultSummary("Folders re-granted successfully.");
    } else {
      setResultSummary("Could not re-grant one or both folders. Use Settings to grant manually.");
    }
  } finally {
    setBusy(false);
  }
}

function copyPathFromElement(buttonElement, pathText) {
  navigator.clipboard
    .writeText(pathText)
    .then(() => {
      const originalText = buttonElement.textContent;
      buttonElement.textContent = "✓";
      buttonElement.style.background = "rgba(98, 209, 129, 0.15)";
      buttonElement.style.color = "var(--good)";
      setTimeout(() => {
        buttonElement.textContent = originalText;
        buttonElement.style.background = "";
        buttonElement.style.color = "";
      }, 1500);
      debugLog.log("Path copied to clipboard");
    })
    .catch((err) => {
      debugLog.log(`Failed to copy path: ${err}`, 'error');
      setResultSummary("Failed to copy path to clipboard");
    });
}

function bindUi() {
  el.settingsButton.addEventListener("click", () => {
    el.settingsDialog.showModal();
  });

  el.closeSettingsButton.addEventListener("click", () => {
    el.settingsDialog.close();
  });

  // Info button tooltip
  if (el.infoButton && el.infoTooltip) {
    el.infoButton.addEventListener("mouseenter", () => {
      el.infoTooltip.classList.remove("hidden");
    });
    el.infoButton.addEventListener("mouseleave", () => {
      el.infoTooltip.classList.add("hidden");
    });
  }

  if (el.filesInfoButton && el.filesInfoPanel) {
    el.filesInfoButton.addEventListener("click", (event) => {
      event.stopPropagation();
      el.filesInfoPanel.classList.toggle("hidden");
    });

    el.filesInfoPanel.addEventListener("click", (event) => {
      event.stopPropagation();
    });

    document.addEventListener("click", (event) => {
      if (!el.filesInfoPanel.classList.contains("hidden") &&
          !el.filesInfoButton.contains(event.target) &&
          !el.filesInfoPanel.contains(event.target)) {
        hideFilesInfoPanel();
      }
    });
  }

  el.debugEnabledCheckbox.addEventListener("change", (event) => {
    saveDebugSetting(event.target.checked);
    setResultSummary(state.debugEnabled ? "Debug logging enabled (browser console)." : "Debug logging disabled.");
  });

  el.settingsDialog.addEventListener("click", (event) => {
    const rect = el.settingsDialog.getBoundingClientRect();
    const inside =
      event.clientX >= rect.left &&
      event.clientX <= rect.right &&
      event.clientY >= rect.top &&
      event.clientY <= rect.bottom;
    if (!inside) {
      el.settingsDialog.close();
    }
  });

  el.grantOfflineButton.addEventListener("click", async () => {
    try {
      await grantOfflineRoot();
      setResultSummary("OFFLINE root granted.");
      updateValidationStatus();
    } catch (err) {
      const msg = String(err.message || err);
      debugLog.log(`Error granting OFFLINE root: ${msg}`, 'error');
      setResultSummary(msg);
    }
  });

  el.grantCgmaButton.addEventListener("click", async () => {
    try {
      await grantCgmaRoot();
      setResultSummary("CGMA root granted.");
      updateValidationStatus();
    } catch (err) {
      const msg = String(err.message || err);
      debugLog.log(`Error granting CGMA root: ${msg}`, 'error');
      setResultSummary(msg);
    }
  });

  el.copyOfflinePathButton.addEventListener("click", () => {
    copyPathFromElement(el.copyOfflinePathButton, "\\\\fs61\\driftdata\\Drift\\Arkiv\\CGMES\\OFFLINE\\");
  });

  el.copyCgmaPathButton.addEventListener("click", () => {
    copyPathFromElement(el.copyCgmaPathButton, "\\\\fs61\\BizTalkFileShare\\BTS2010\\Common\\Tracking\\CGMA_TSO\\");
  });

  if (el.refreshButton) {
    el.refreshButton.addEventListener("click", () => {
      triggerComparisonRun("Refreshing comparison...");
    });
  }

  el.versionSelect.addEventListener("change", () => {
    if (!state.cachedIgmRecords || !state.cachedCgmaEntries) {
      return;
    }
    const selectedVersion = el.versionSelect.value || "latest";
    applySelectedVersion(selectedVersion);
  });

  el.diffTab.addEventListener("click", () => {
    state.visualizationMode = "diff";
    el.diffTab.classList.add("active");
    el.compareTab.classList.remove("active");
    el.tableTab.classList.remove("active");
    el.diffSection.classList.remove("hidden");
    el.compareSection.classList.add("hidden");
    el.tablesSection.classList.add("hidden");
    if (state.comparisonData) {
      renderDiffChartsView(state.comparisonData);
    }
  });

  el.compareTab.addEventListener("click", () => {
    state.visualizationMode = "compare";
    el.compareTab.classList.add("active");
    el.diffTab.classList.remove("active");
    el.tableTab.classList.remove("active");
    el.compareSection.classList.remove("hidden");
    el.diffSection.classList.add("hidden");
    el.tablesSection.classList.add("hidden");
    if (state.comparisonData) {
      renderCompareChartsView(state.comparisonData);
    }
  });

  el.tableTab.addEventListener("click", () => {
    state.visualizationMode = "tables";
    el.tableTab.classList.add("active");
    el.diffTab.classList.remove("active");
    el.compareTab.classList.remove("active");
    el.tablesSection.classList.remove("hidden");
    el.diffSection.classList.add("hidden");
    el.compareSection.classList.add("hidden");
    if (state.comparisonData) {
      renderTablesView(state.comparisonData);
    }
  });

  el.tablesSection.addEventListener("click", (event) => {
    const th = event.target.closest("th[data-sort]");
    if (!th) {
      return;
    }

    const newColumn = th.dataset.sort;
    if (!newColumn) {
      return;
    }

    if (state.sortColumn === newColumn) {
      state.sortAscending = !state.sortAscending;
    } else {
      state.sortColumn = newColumn;
      state.sortAscending = true;
    }

    if (state.comparisonData) {
      renderTablesView(state.comparisonData);
    }
  });

}

async function main() {
  loadDebugSetting();
  setBusy(false, "Ready", 0);
  debugLog.log(`Initializing app...`, 'info');
  await initWasm();
  debugLog.log(`WASM initialized`, 'info');
  setup_panic_hook();
  bindUi();
  await restoreHandles(false);
  state.initialized = true;
  updateValidationStatus();
  debugLog.log(`App ready`, 'info');
  setResultSummary("Waiting for folder access...");
  updateFilesUsedPanel("latest", []);
  autoOpenSettingsIfFirstVisit();
}

main().catch((err) => {
  const msg = `Initialization failed: ${String(err.message || err)}`;
  debugLog.log(msg, 'error');
  setResultSummary(msg);
});
