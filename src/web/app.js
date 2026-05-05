import initWasm, {
  setup_panic_hook,
  extract_igm_record,
  parse_cgma_inhouse,
  compare_records,
} from "./pkg/rust_wasm.js";

const DB_NAME = "cgma-igm-permissions";
const DB_VERSION = 1;
const STORE_NAME = "handles";

const el = {
  settingsButton: document.getElementById("settingsButton"),
  runButton: document.getElementById("runButton"),
  settingsDialog: document.getElementById("settingsDialog"),
  closeSettingsButton: document.getElementById("closeSettingsButton"),
  grantOfflineButton: document.getElementById("grantOfflineButton"),
  grantCgmaButton: document.getElementById("grantCgmaButton"),
  folderStatus: document.getElementById("folderStatus"),
  versionSelect: document.getElementById("versionSelect"),
  selectionInfo: document.getElementById("selectionInfo"),
  resultSummary: document.getElementById("resultSummary"),
  resultBody: document.getElementById("resultBody"),
  debugLog: document.getElementById("debugLog"),
};

const state = {
  offlineRootHandle: null,
  cgmaRootHandle: null,
  discoveredIgmFiles: [],
  latestCgmaFileHandle: null,
  initialized: false,
};

const debugLog = {
  entries: [],
  log(message, level = 'info') {
    const timestamp = new Date().toISOString().split('T')[1].split('.')[0];
    const entry = `[${timestamp}] ${message}`;
    this.entries.push({ message: entry, level });
    if (this.entries.length > 100) {
      this.entries.shift();
    }
    this.render();
    console.log(`[${level.toUpperCase()}]`, message);
  },
  render() {
    const container = el.debugLog;
    if (!container) return;
    container.innerHTML = this.entries
      .map(e => `<div class="debug-log-entry debug-log-${e.level}">${e.message}</div>`)
      .join('');
    container.scrollTop = container.scrollHeight;
  },
};

function toYmd(date, zeroPad) {
  const y = date.getUTCFullYear();
  const m = date.getUTCMonth() + 1;
  const d = date.getUTCDate();
  if (zeroPad) {
    return { y: String(y), m: String(m).padStart(2, "0"), d: String(d).padStart(2, "0") };
  }
  return { y: String(y), m: String(m), d: String(d) };
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

async function ensureReadPermission(handle) {
  if (!handle) {
    return false;
  }
  const opts = { mode: "read" };
  if ((await handle.queryPermission(opts)) === "granted") {
    return true;
  }
  return (await handle.requestPermission(opts)) === "granted";
}

function setFolderStatus() {
  const offline = state.offlineRootHandle ? `✓ ${state.offlineRootHandle.name}` : "✗ not set";
  const cgma = state.cgmaRootHandle ? `✓ ${state.cgmaRootHandle.name}` : "✗ not set";
  el.folderStatus.textContent = `OFFLINE root: ${offline}\nCGMA root: ${cgma}`;
}

function setResultSummary(message) {
  el.resultSummary.textContent = message;
}

function clearResults() {
  el.resultBody.innerHTML = "";
}

function versionRank(version) {
  const n = Number.parseInt(version, 10);
  return Number.isFinite(n) ? n : 0;
}

function fillVersionSelect(versions) {
  const sorted = [...versions].sort((a, b) => versionRank(a) - versionRank(b));
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

async function findLatestIgmFolder(offlineRootHandle, lookbackDays = 1) {
  lookbackDays = Math.min(lookbackDays, 1);
  const pattern = /^\d{8}T\d{4}Z_2D_(DKE|DKW)_SSH_\d{3}\.zip$/;
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

        const isUseful = pattern.test(entry.name);
        if (isUseful) {
          dateMatches.push(entry);
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
  let best = null;

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
          const candidate = {
            handle: entry,
            pathLabel: `${y}/${m}/${d}/${guidDir.name}/${entry.name}`,
            modified: file.lastModified,
          };
          debugLog.log(`[CGMA Discovery]     Found: ${entry.name} (modified: ${new Date(file.lastModified).toISOString()})`, 'info');

          if (!best || candidate.modified > best.modified) {
            best = candidate;
            debugLog.log(`[CGMA Discovery]     ✓ New best candidate`, 'info');
          }
        }
      }
      debugLog.log(`[CGMA Discovery] Scanned ${guidDirsFound} GUID directories in ${pathLabel}`, 'info');
    } catch (err) {
      debugLog.log(`[CGMA Discovery] ✗ Failed while listing ${pathLabel}: ${String(err.message || err)}`, 'warn');
    }
  }

  if (!best) {
    const errorMsg = `No Inhouse XML file found in CGMA root within lookback range. Searched ${lookbackDays} day folders.`;
    debugLog.log(errorMsg, 'error');
    throw new Error(errorMsg);
  }

  debugLog.log(`[CGMA Discovery] ✓ Selected file: ${best.pathLabel}`, 'info');

  return best;
}

async function scanSources() {
  debugLog.log(`Scanning sources...`);
  const igm = await findLatestIgmFolder(state.offlineRootHandle);
  debugLog.log(`Found IGM files: ${igm.files.length} in date ${igm.dateLabel}`);
  state.discoveredIgmFiles = igm.files;

  const cgma = await findLatestCgmaXml(state.cgmaRootHandle);
  debugLog.log(`Found CGMA file: ${cgma.pathLabel}`);
  state.latestCgmaFileHandle = cgma.handle;

  const versionSet = new Set();
  const versionPattern = /^\d{8}T\d{4}Z_2D_(DKE|DKW)_SSH_(\d{3})\.zip$/;
  for (const f of igm.files) {
    const m = f.name.match(versionPattern);
    if (m) {
      versionSet.add(m[2]);
    }
  }

  fillVersionSelect([...versionSet]);
  el.selectionInfo.textContent = `IGM date folder: ${igm.dateLabel} | CGMA file: ${cgma.pathLabel} | IGM files: ${igm.files.length}`;
}

function renderRows(rows) {
  clearResults();
  for (const row of rows) {
    const tr = document.createElement("tr");
    const statusClass = `status-${String(row.status).toLowerCase()}`;

    tr.innerHTML = `
      <td>${row.aligned_timestamp}</td>
      <td>${row.area}</td>
      <td>${row.ssh_version}</td>
      <td>${Number(row.ssh_net_interchange_mw).toFixed(3)}</td>
      <td>${Number(row.cgma_net_position_mw).toFixed(3)}</td>
      <td>${Number(row.difference_mw).toFixed(3)}</td>
      <td class="${statusClass}">${row.status}</td>
    `;
    el.resultBody.appendChild(tr);
  }
}

async function runComparison() {
  debugLog.log(`Starting comparison run...`, 'info');
  if (!state.offlineRootHandle || !state.cgmaRootHandle) {
    throw new Error("Please configure both folder permissions in Settings first.");
  }

  await scanSources();

  const igmRecords = [];
  debugLog.log(`Parsing ${state.discoveredIgmFiles.length} IGM files...`, 'info');
  for (const fileHandle of state.discoveredIgmFiles) {
    const file = await fileHandle.getFile();
    const bytes = new Uint8Array(await file.arrayBuffer());
    try {
      const record = extract_igm_record(file.name, bytes);
      igmRecords.push(record);
      debugLog.log(`✓ Parsed IGM: ${file.name}`, 'info');
    } catch (err) {
      debugLog.log(`✗ Failed to parse IGM ${file.name}: ${String(err).substring(0, 100)}`, 'warn');
    }
  }

  debugLog.log(`Successfully parsed ${igmRecords.length}/${state.discoveredIgmFiles.length} IGM records`, 'info');
  if (igmRecords.length === 0) {
    throw new Error("No parseable IGM records were found in the selected date folder.");
  }

  debugLog.log(`Reading CGMA file...`, 'info');
  const cgmaFile = await state.latestCgmaFileHandle.getFile();
  const cgmaText = await cgmaFile.text();
  debugLog.log(`CGMA file size: ${cgmaText.length} bytes`, 'info');
  const cgmaEntries = parse_cgma_inhouse(cgmaText, false);
  debugLog.log(`Parsed ${cgmaEntries.length} CGMA entries`, 'info');

  const selectedVersion = el.versionSelect.value || "latest";
  debugLog.log(`Running comparison with version mode: ${selectedVersion}`, 'info');
  const output = compare_records(igmRecords, cgmaEntries, selectedVersion, 50, 200);
  debugLog.log(`Comparison complete: ${output.matched_rows} rows matched`, 'info');

  renderRows(output.rows);
  setResultSummary(
    `Matched rows: ${output.matched_rows} | Versions discovered: ${output.discovered_versions.join(", ") || "n/a"
    } | Version mode: ${selectedVersion}`
  );
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
  setFolderStatus();
  await logHandlePreview(handle, "CGMA root");
  debugLog.log(`CGMA root saved: "${handle.name}" (key: cgmaRoot)`, 'info');
}

async function restoreHandles() {
  const offline = await loadHandle("offlineRoot");
  const cgma = await loadHandle("cgmaRoot");

  if (offline && (await ensureReadPermission(offline))) {
    state.offlineRootHandle = offline;
    debugLog.log(`Restored OFFLINE root: "${offline.name}"`, 'info');
  } else if (offline) {
    debugLog.log(`OFFLINE root "${offline.name}" in IndexedDB but permission not granted`, 'warn');
  }
  if (cgma && (await ensureReadPermission(cgma))) {
    state.cgmaRootHandle = cgma;
    debugLog.log(`Restored CGMA root: "${cgma.name}"`, 'info');
  } else if (cgma) {
    debugLog.log(`CGMA root "${cgma.name}" in IndexedDB but permission not granted`, 'warn');
  }
  setFolderStatus();
}

function bindUi() {
  el.settingsButton.addEventListener("click", () => {
    el.settingsDialog.showModal();
  });

  el.closeSettingsButton.addEventListener("click", () => {
    el.settingsDialog.close();
  });

  el.grantOfflineButton.addEventListener("click", async () => {
    try {
      await grantOfflineRoot();
      setResultSummary("OFFLINE root granted.");
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
    } catch (err) {
      const msg = String(err.message || err);
      debugLog.log(`Error granting CGMA root: ${msg}`, 'error');
      setResultSummary(msg);
    }
  });

  el.runButton.addEventListener("click", async () => {
    try {
      setResultSummary("Scanning folders and running comparison...");
      await runComparison();
    } catch (err) {
      const msg = String(err.message || err);
      clearResults();
      setResultSummary(msg);
      debugLog.log(`Comparison failed: ${msg}`, 'error');
    }
  });
}

async function main() {
  debugLog.log(`Initializing app...`, 'info');
  await initWasm();
  debugLog.log(`WASM initialized`, 'info');
  setup_panic_hook();
  bindUi();
  await restoreHandles();
  state.initialized = true;
  debugLog.log(`App ready`, 'info');
  setResultSummary("Ready. Open Settings and grant folder access to run comparison.");
}

main().catch((err) => {
  const msg = `Initialization failed: ${String(err.message || err)}`;
  debugLog.log(msg, 'error');
  setResultSummary(msg);
});
