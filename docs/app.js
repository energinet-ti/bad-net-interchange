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
};

const state = {
  offlineRootHandle: null,
  cgmaRootHandle: null,
  discoveredIgmFiles: [],
  latestCgmaFileHandle: null,
  initialized: false,
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
  const offline = state.offlineRootHandle ? "configured" : "missing";
  const cgma = state.cgmaRootHandle ? "configured" : "missing";
  el.folderStatus.textContent = `OFFLINE root: ${offline}\nCGMA root: ${cgma}`;
}

function setResultSummary(message) {
  el.resultSummary.textContent = message;
}

function clearResults() {
  el.resultBody.innerHTML = "";
}

function versionRank(version) {
  if (String(version).toUpperCase() === "2D") {
    return 999;
  }
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

async function findLatestIgmFolder(offlineRootHandle, lookbackDays = 7) {
  const pattern = /\d{8}T\d{4}Z_\w+_(DKE|DKW)_SSH_\d+\.zip$/;
  let allMatches = [];
  let latestDateLabel = null;

  // Search current and previous date for full 24-hour coverage
  for (let offset = 0; offset <= 1 && offset <= lookbackDays; offset += 1) {
    const date = new Date();
    date.setUTCDate(date.getUTCDate() - offset);
    const { y, m, d } = toYmd(date, true);

    try {
      const yearDir = await offlineRootHandle.getDirectoryHandle(y);
      const monthDir = await yearDir.getDirectoryHandle(m);
      const dayDir = await monthDir.getDirectoryHandle(d);

      const dateMatches = [];
      for await (const entry of dayDir.values()) {
        if (entry.kind === "file" && pattern.test(entry.name) && entry.name.includes("_2D_")) {
          dateMatches.push(entry);
        }
      }

      if (dateMatches.length > 0) {
        allMatches = allMatches.concat(dateMatches);
        if (!latestDateLabel) {
          latestDateLabel = `${y}-${m}-${d}`;
        }
      }
    } catch {
      // Missing date directory is normal during lookback.
    }
  }

  if (allMatches.length === 0) {
    throw new Error("No 2D IGM files found in the OFFLINE root within lookback range.");
  }

  return {
    handle: null,
    dateLabel: latestDateLabel,
    files: allMatches,
  };
}

async function findLatestCgmaXml(cgmaRootHandle, lookbackDays = 7) {
  let best = null;

  for (let offset = 0; offset <= lookbackDays; offset += 1) {
    const date = new Date();
    date.setUTCDate(date.getUTCDate() - offset);
    const { y, m, d } = toYmd(date, false);

    try {
      const yearDir = await cgmaRootHandle.getDirectoryHandle(y);
      const monthDir = await yearDir.getDirectoryHandle(m);
      const dayDir = await monthDir.getDirectoryHandle(d);

      for await (const guidDir of dayDir.values()) {
        if (guidDir.kind !== "directory") {
          continue;
        }
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

          if (!best || candidate.modified > best.modified) {
            best = candidate;
          }
        }
      }
    } catch {
      // Missing date directory is normal during lookback.
    }
  }

  if (!best) {
    throw new Error("No Inhouse XML file found in CGMA root within lookback range.");
  }

  return best;
}

async function scanSources() {
  const igm = await findLatestIgmFolder(state.offlineRootHandle);
  state.discoveredIgmFiles = igm.files;

  const cgma = await findLatestCgmaXml(state.cgmaRootHandle);
  state.latestCgmaFileHandle = cgma.handle;

  const versionSet = new Set();
  const versionPattern = /\d{8}T\d{4}Z_(\w+)_(DKE|DKW)_SSH_\d+\.zip$/;
  for (const f of igm.files) {
    const m = f.name.match(versionPattern);
    if (m) {
      versionSet.add(m[1]);
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
  if (!state.offlineRootHandle || !state.cgmaRootHandle) {
    throw new Error("Please configure both folder permissions in Settings first.");
  }

  await scanSources();

  const igmRecords = [];
  for (const fileHandle of state.discoveredIgmFiles) {
    const file = await fileHandle.getFile();
    const bytes = new Uint8Array(await file.arrayBuffer());
    try {
      const record = extract_igm_record(file.name, bytes);
      igmRecords.push(record);
    } catch {
      // Non-parseable files are skipped.
    }
  }

  if (igmRecords.length === 0) {
    throw new Error("No parseable IGM records were found in the selected date folder.");
  }

  const cgmaFile = await state.latestCgmaFileHandle.getFile();
  const cgmaText = await cgmaFile.text();
  const cgmaEntries = parse_cgma_inhouse(cgmaText, false);

  const selectedVersion = el.versionSelect.value || "latest";
  const output = compare_records(igmRecords, cgmaEntries, selectedVersion, 50, 200);

  renderRows(output.rows);
  setResultSummary(
    `Matched rows: ${output.matched_rows} | Versions discovered: ${output.discovered_versions.join(", ") || "n/a"
    } | Version mode: ${selectedVersion}`
  );
}

async function grantOfflineRoot() {
  const handle = await window.showDirectoryPicker({ mode: "read" });
  if (!(await ensureReadPermission(handle))) {
    throw new Error("Read permission denied for OFFLINE root.");
  }
  state.offlineRootHandle = handle;
  await saveHandle("offlineRoot", handle);
  setFolderStatus();
}

async function grantCgmaRoot() {
  const handle = await window.showDirectoryPicker({ mode: "read" });
  if (!(await ensureReadPermission(handle))) {
    throw new Error("Read permission denied for CGMA root.");
  }
  state.cgmaRootHandle = handle;
  await saveHandle("cgmaRoot", handle);
  setFolderStatus();
}

async function restoreHandles() {
  const offline = await loadHandle("offlineRoot");
  const cgma = await loadHandle("cgmaRoot");

  if (offline && (await ensureReadPermission(offline))) {
    state.offlineRootHandle = offline;
  }
  if (cgma && (await ensureReadPermission(cgma))) {
    state.cgmaRootHandle = cgma;
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
      setResultSummary(String(err.message || err));
    }
  });

  el.grantCgmaButton.addEventListener("click", async () => {
    try {
      await grantCgmaRoot();
      setResultSummary("CGMA root granted.");
    } catch (err) {
      setResultSummary(String(err.message || err));
    }
  });

  el.runButton.addEventListener("click", async () => {
    try {
      setResultSummary("Scanning folders and running comparison...");
      await runComparison();
    } catch (err) {
      clearResults();
      setResultSummary(String(err.message || err));
    }
  });
}

async function main() {
  await initWasm();
  setup_panic_hook();
  bindUi();
  await restoreHandles();
  state.initialized = true;
  setResultSummary("Ready. Open Settings and grant folder access to run comparison.");
}

main().catch((err) => {
  setResultSummary(`Initialization failed: ${String(err.message || err)}`);
});
