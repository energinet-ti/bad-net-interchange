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
  grantRootButton: document.getElementById("grantRootButton"),
  remountButton: document.getElementById("remountButton"),
  folderStatus: document.getElementById("folderStatus"),
  versionSelect: document.getElementById("versionSelect"),
  selectionInfo: document.getElementById("selectionInfo"),
  resultSummary: document.getElementById("resultSummary"),
  tabsContainer: document.getElementById("tabsContainer"),
  chartTab: document.getElementById("chartTab"),
  tableTab: document.getElementById("tableTab"),
  chartsSection: document.getElementById("chartsSection"),
  tablesSection: document.getElementById("tablesSection"),
  chartDk1: document.getElementById("chartDk1"),
  chartDk2: document.getElementById("chartDk2"),
  resultBodyDk1: document.getElementById("resultBodyDk1"),
  resultBodyDk2: document.getElementById("resultBodyDk2"),
  debugLog: document.getElementById("debugLog"),
  debugPanel: document.getElementById("debugPanel"),
  debugToggleButton: document.getElementById("debugToggleButton"),
  loaderCard: document.getElementById("loaderCard"),
  progressFill: document.getElementById("progressFill"),
  progressText: document.getElementById("progressText"),
};

const state = {
  rootHandle: null,
  discoveredIgmFiles: [],
  latestCgmaFileHandle: null,
  comparisonData: null,
  sortColumn: "timestamp",
  sortAscending: true,
  visualizationMode: "charts",
  initialized: false,
  busy: false,
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
  if (state.rootHandle) {
    el.folderStatus.textContent = `✓ ${state.rootHandle.name}\n(Single root with auto-discovery)`;
    el.remountButton.style.display = "inline-block";
  } else {
    el.folderStatus.textContent = "✗ No root folder mounted yet";
    el.remountButton.style.display = "none";
  }
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
  el.runButton.disabled = active;
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

async function findLatestIgmFolder(rootHandle, lookbackDays = 1) {
  lookbackDays = Math.min(lookbackDays, 1);
  const pattern = /^\d{8}T\d{4}Z_2D_(DKE|DKW)_SSH_\d{3}\.zip$/;
  let allMatches = [];
  let latestDateLabel = null;

  debugLog.log(`[IGM Discovery] Searching OFFLINE subfolder for 2D scenarios with lookback=${lookbackDays} days`, 'info');
  
  // Navigate to OFFLINE subfolder: driftdata/Drift/Arkiv/CGMES/OFFLINE/
  let offlineRoot;
  try {
    const driftdata = await rootHandle.getDirectoryHandle("driftdata");
    const drift = await driftdata.getDirectoryHandle("Drift");
    const arkiv = await drift.getDirectoryHandle("Arkiv");
    const cgmes = await arkiv.getDirectoryHandle("CGMES");
    offlineRoot = await cgmes.getDirectoryHandle("OFFLINE");
    debugLog.log(`[IGM Discovery] ✓ Navigated to OFFLINE subfolder`, 'info');
  } catch (err) {
    const errorMsg = `Cannot navigate to OFFLINE subfolder: ${String(err.message || err)}`;
    debugLog.log(errorMsg, 'error');
    throw new Error(errorMsg);
  }

  // Probe root handle to confirm visibility
  try {
    const rootEntries = [];
    for await (const entry of offlineRoot.values()) {
      rootEntries.push(`${entry.kind}:${entry.name}`);
      if (rootEntries.length >= 15) { rootEntries.push('...truncated'); break; }
    }
    debugLog.log(`[IGM Discovery] OFFLINE root children: ${rootEntries.length ? rootEntries.join(' | ') : '(empty or inaccessible)'}`, 'info');
  } catch (probeErr) {
    debugLog.log(`[IGM Discovery] Cannot probe OFFLINE root: ${String(probeErr.message || probeErr)}`, 'error');
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
      yearDir = await offlineRoot.getDirectoryHandle(y);
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
    const errorMsg = `No 2D DKE/DKW SSH files found in the OFFLINE subfolder within lookback range.`;
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

async function findLatestCgmaXml(rootHandle, lookbackDays = 1) {
  lookbackDays = Math.min(lookbackDays, 1);
  let best = null;

  debugLog.log(`[CGMA Discovery] Searching CGMA subfolder for Inhouse XML with lookback=${lookbackDays} days`, 'info');

  // Navigate to CGMA subfolder: BizTalkFileShare/BTS2010/Common/Tracking/CGMA_TSO/
  let cgmaRoot;
  try {
    const bizTalk = await rootHandle.getDirectoryHandle("BizTalkFileShare");
    const bts2010 = await bizTalk.getDirectoryHandle("BTS2010");
    const common = await bts2010.getDirectoryHandle("Common");
    const tracking = await common.getDirectoryHandle("Tracking");
    cgmaRoot = await tracking.getDirectoryHandle("CGMA_TSO");
    debugLog.log(`[CGMA Discovery] ✓ Navigated to CGMA_TSO subfolder`, 'info');
  } catch (err) {
    const errorMsg = `Cannot navigate to CGMA_TSO subfolder: ${String(err.message || err)}`;
    debugLog.log(errorMsg, 'error');
    throw new Error(errorMsg);
  }

  for (let offset = 0; offset <= lookbackDays; offset += 1) {
    const date = new Date();
    date.setUTCDate(date.getUTCDate() - offset);
    const { y, m, d } = toYmd(date, false);

    const pathLabel = `${y}/${m}/${d}`;
    debugLog.log(`[CGMA Discovery] Checking date path: ${pathLabel}`, 'info');

    let yearDir;
    try {
      yearDir = await cgmaRoot.getDirectoryHandle(y);
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
    const errorMsg = `No Inhouse XML file found in CGMA subfolder within lookback range. Searched ${lookbackDays} day folders.`;
    debugLog.log(errorMsg, 'error');
    throw new Error(errorMsg);
  }

  debugLog.log(`[CGMA Discovery] ✓ Selected file: ${best.pathLabel}`, 'info');

  return best;
}

async function scanSources() {
  debugLog.log(`Scanning sources...`);
  const igm = await findLatestIgmFolder(state.rootHandle);
  debugLog.log(`Found IGM files: ${igm.files.length} in date ${igm.dateLabel}`);
  state.discoveredIgmFiles = igm.files;

  const cgma = await findLatestCgmaXml(state.rootHandle);
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

function sortRows(rows) {
  const sorted = [...rows];
  sorted.sort((a, b) => {
    let aVal = a[state.sortColumn];
    let bVal = b[state.sortColumn];
    
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
      <td>${Number(row.difference_mw).toFixed(3)}</td>
      <td class="${statusClass}">${row.status}</td>
    `;

    if (row.area === "DK1") {
      el.resultBodyDk1.appendChild(tr);
    } else if (row.area === "DK2") {
      el.resultBodyDk2.appendChild(tr);
    }
  }

  // Add sort handlers after rendering
  if (window.addTableSortHandlers) {
    window.addTableSortHandlers();
  }
}

function renderChartsView(rows) {
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
      maintainAspectRatio: true,
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
    const dk1Ctx = el.chartDk1.getContext('2d');
    if (window.dk1Chart) window.dk1Chart.destroy();
    window.dk1Chart = new Chart(dk1Ctx, {
      ...chartConfig,
      data: {
        labels: dk1Rows.map(r => r.aligned_timestamp),
        datasets: [{
          label: 'Difference (SSH - CGMA)',
          data: dk1Rows.map(r => r.difference_mw),
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
    const dk2Ctx = el.chartDk2.getContext('2d');
    if (window.dk2Chart) window.dk2Chart.destroy();
    window.dk2Chart = new Chart(dk2Ctx, {
      ...chartConfig,
      data: {
        labels: dk2Rows.map(r => r.aligned_timestamp),
        datasets: [{
          label: 'Difference (SSH - CGMA)',
          data: dk2Rows.map(r => r.difference_mw),
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

function renderRows(rows) {
  state.comparisonData = rows;
  state.sortColumn = "aligned_timestamp";
  state.sortAscending = true;
  
  if (state.visualizationMode === "charts") {
    renderChartsView(rows);
  } else {
    renderTablesView(rows);
  }
}

async function runComparison() {
  debugLog.log(`Starting comparison run...`, 'info');
  if (!state.rootHandle) {
    throw new Error("Please mount the root folder in Settings first.");
  }

  setProgress("Scanning source folders...", 0.08);
  await scanSources();

  const igmRecords = [];
  const totalIgm = state.discoveredIgmFiles.length || 1;
  debugLog.log(`Parsing ${state.discoveredIgmFiles.length} IGM files...`, 'info');
  for (let i = 0; i < state.discoveredIgmFiles.length; i += 1) {
    const fileHandle = state.discoveredIgmFiles[i];
    const file = await fileHandle.getFile();
    const bytes = new Uint8Array(await file.arrayBuffer());
    try {
      const record = extract_igm_record(file.name, bytes);
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

  setProgress("Reading CGMA file...", 0.75);
  debugLog.log(`Reading CGMA file...`, 'info');
  const cgmaFile = await state.latestCgmaFileHandle.getFile();
  const cgmaText = await cgmaFile.text();
  debugLog.log(`CGMA file size: ${cgmaText.length} bytes`, 'info');

  setProgress("Parsing CGMA entries...", 0.84);
  const cgmaEntries = parse_cgma_inhouse(cgmaText, false);
  debugLog.log(`Parsed ${cgmaEntries.length} CGMA entries`, 'info');

  const selectedVersion = el.versionSelect.value || "latest";
  setProgress("Comparing records...", 0.93);
  debugLog.log(`Running comparison with version mode: ${selectedVersion}`, 'info');
  const output = compare_records(igmRecords, cgmaEntries, selectedVersion, 50, 200);
  debugLog.log(`Comparison complete: ${output.matched_rows} rows matched`, 'info');

  setProgress("Rendering tables...", 0.98);
  renderRows(output.rows);
  setResultSummary(
    `Matched rows: ${output.matched_rows} | Versions discovered: ${output.discovered_versions.join(", ") || "n/a"
    } | Version mode: ${selectedVersion}`
  );

  setProgress("Done", 1);
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

async function grantRootAccess() {
  debugLog.log(`Requesting root folder access (\\fs61\)...`, 'info');
  const handle = await window.showDirectoryPicker({ mode: "read" });
  debugLog.log(`Root handle obtained`, 'info');
  if (!(await ensureReadPermission(handle))) {
    throw new Error("Read permission denied for root folder.");
  }
  state.rootHandle = handle;
  await saveHandle("rootHandle", handle);
  setFolderStatus();
  await logHandlePreview(handle, "Root folder");
  debugLog.log(`Root folder saved: "${handle.name}" (key: rootHandle)`, 'info');
}

async function remountRoot() {
  if (!state.rootHandle) {
    throw new Error("No root folder to remount. Please grant access first.");
  }
  debugLog.log(`Re-mounting root folder...`, 'info');
  if (!(await ensureReadPermission(state.rootHandle))) {
    throw new Error("Read permission not granted for mounted folder.");
  }
  debugLog.log(`Root folder re-mounted: "${state.rootHandle.name}"`, 'info');
}

async function restoreHandles() {
  const root = await loadHandle("rootHandle");

  if (root && (await ensureReadPermission(root))) {
    state.rootHandle = root;
    debugLog.log(`Restored root folder: "${root.name}"`, 'info');
  } else if (root) {
    debugLog.log(`Root folder "${root.name}" in IndexedDB but permission not granted`, 'warn');
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

  el.grantRootButton.addEventListener("click", async () => {
    try {
      await grantRootAccess();
      setResultSummary("Root folder access granted. Ready to run comparison.");
    } catch (err) {
      const msg = String(err.message || err);
      debugLog.log(`Error granting root access: ${msg}`, 'error');
      setResultSummary(msg);
    }
  });

  el.remountButton.addEventListener("click", async () => {
    try {
      await remountRoot();
      setResultSummary("Root folder re-mounted successfully.");
    } catch (err) {
      const msg = String(err.message || err);
      debugLog.log(`Error re-mounting root: ${msg}`, 'error');
      setResultSummary(msg);
    }
  });

  el.runButton.addEventListener("click", async () => {
    try {
      setBusy(true, "Starting comparison...", 0.02);
      setResultSummary("Scanning folders and running comparison...");
      await runComparison();
    } catch (err) {
      const msg = String(err.message || err);
      clearResults();
      setResultSummary(msg);
      debugLog.log(`Comparison failed: ${msg}`, 'error');
    } finally {
      setBusy(false, "Done", 1);
    }
  });

  el.chartTab.addEventListener("click", () => {
    state.visualizationMode = "charts";
    el.chartTab.classList.add("active");
    el.tableTab.classList.remove("active");
    el.chartsSection.classList.remove("hidden");
    el.tablesSection.classList.add("hidden");
    if (state.comparisonData) {
      renderChartsView(state.comparisonData);
    }
  });

  el.tableTab.addEventListener("click", () => {
    state.visualizationMode = "tables";
    el.tableTab.classList.add("active");
    el.chartTab.classList.remove("active");
    el.tablesSection.classList.remove("hidden");
    el.chartsSection.classList.add("hidden");
    if (state.comparisonData) {
      renderTablesView(state.comparisonData);
    }
  });

  // Add table header click handlers for sorting
  const addSortHandlers = () => {
    const headers = document.querySelectorAll(".table-card th");
    headers.forEach(th => {
      th.style.cursor = "pointer";
      th.style.userSelect = "none";
      th.addEventListener("click", () => {
        const columnMap = {
          "Time (UTC)": "aligned_timestamp",
          "Version": "ssh_version",
          "IGM MW": "ssh_net_interchange_mw",
          "CGMA MW": "cgma_net_position_mw",
          "Diff MW": "difference_mw",
          "Status": "status"
        };
        const newColumn = columnMap[th.textContent.trim()];
        if (newColumn) {
          if (state.sortColumn === newColumn) {
            state.sortAscending = !state.sortAscending;
          } else {
            state.sortColumn = newColumn;
            state.sortAscending = true;
          }
          if (state.comparisonData) {
            renderTablesView(state.comparisonData);
            addSortHandlers();
          }
        }
      });
    });
  };

  // Wrap addSortHandlers to be called after rendering
  window.addTableSortHandlers = addSortHandlers;

  el.debugToggleButton.addEventListener("click", () => {
    const isCollapsed = el.debugPanel.classList.toggle("collapsed");
    el.debugToggleButton.textContent = isCollapsed ? "Show Debug" : "Hide Debug";
  });
}

async function main() {
  setBusy(false, "Ready", 0);
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
