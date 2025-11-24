function openTab(evt, tabName) {
    const tabcontent = document.getElementsByClassName("tabcontent");
    for (let i = 0; i < tabcontent.length; i++) {
        tabcontent[i].style.display = "none";
    }
    const tablinks = document.getElementsByClassName("tablinks");
    for (let i = 0; i < tablinks.length; i++) {
        tablinks[i].className = tablinks[i].className.replace(" active", "");
    }
    document.getElementById(tabName).style.display = "block";
    evt.currentTarget.className += " active";
}

// --- Helpers for URL-based locks -----------------------------------------

// Map config keys -> DOM field IDs
const FIELD_KEY_TO_ID = {
    doRemoveFromFilteredFromQueue: 'removeFromQueue',
    onlyAlertOnLatest: 'alertOnLatest',
    desktopNotifications: 'desktopNotifications',
    toggleExperiments: 'toggleExperiments',
    abuseipdbAPIkey: 'abuseipdbAPIkey',
    vtkey: 'vtkey',
    ipInfoKey: 'ipInfoKey',
    scamalyticsURL: 'scamalyticsURL',
    configDataURL: 'configDataURL'
};

const FIELD_IDS = Object.values(FIELD_KEY_TO_ID);

// Create lock button next to each scalar field (checkbox/text)
function initFieldLocks() {
    FIELD_IDS.forEach(id => {
        const input = document.getElementById(id);
        if (!input) return;

        // Avoid duplicating lock buttons if restoreOptions is called more than once
        if (input.dataset.lockInit === 'true') return;
        input.dataset.lockInit = 'true';

        const lockBtn = document.createElement('button');
        lockBtn.type = 'button';
        lockBtn.className = 'lock-btn';
        lockBtn.dataset.fieldId = id;
        lockBtn.dataset.locked = 'false';
        lockBtn.textContent = '🔓';
        lockBtn.title = 'Local value. Click to lock.';

        lockBtn.addEventListener('click', () => {
            const isLocked = lockBtn.dataset.locked === 'true';
            setFieldLocked(id, !isLocked);
        });

        input.insertAdjacentElement('afterend', lockBtn);
    });
}

function setFieldLocked(fieldId, locked) {
    const input = document.getElementById(fieldId);
    const lockBtn = document.querySelector(`.lock-btn[data-field-id="${fieldId}"]`);
    if (!input || !lockBtn) return;

    if (locked) {
        input.disabled = true;
        lockBtn.dataset.locked = 'true';
        lockBtn.textContent = '🔒';
        lockBtn.title = 'Value from URL config. Click to unlock for editing.';
    } else {
        input.disabled = false;
        lockBtn.dataset.locked = 'false';
        lockBtn.textContent = '🔓';
        lockBtn.title = 'Local value. Click to lock.';
    }
}

function addPattern(containerId, value = '', lockedFromUrl = false) {
    const container = document.getElementById(containerId);
    const div = document.createElement('div');
    div.className = 'pattern-row';
    div.dataset.lockedFromUrl = lockedFromUrl ? 'true' : 'false';

    const input = document.createElement('input');
    input.type = 'text';
    input.value = value;

    if (lockedFromUrl) {
        input.disabled = true;
    }

    div.appendChild(input);

    const lockBtn = document.createElement('button');
    lockBtn.type = 'button';
    lockBtn.className = 'lock-btn';
    lockBtn.dataset.locked = lockedFromUrl ? 'true' : 'false';
    lockBtn.textContent = lockedFromUrl ? '🔒' : '🔓';
    lockBtn.title = lockedFromUrl
        ? 'Pattern from URL config. Click to unlock for editing.'
        : 'Local pattern. Click to lock.';

    lockBtn.addEventListener('click', () => {
        const isLocked = div.dataset.lockedFromUrl === 'true';
        if (isLocked) {
            input.disabled = false;
            div.dataset.lockedFromUrl = 'false';
            lockBtn.dataset.locked = 'false';
            lockBtn.textContent = '🔓';
            lockBtn.title = 'Local pattern. Click to lock.';
        } else {
            input.disabled = true;
            div.dataset.lockedFromUrl = 'true';
            lockBtn.dataset.locked = 'true';
            lockBtn.textContent = '🔒';
            lockBtn.title = 'Pattern from URL config. Click to unlock for editing.';
        }
    });

    div.appendChild(lockBtn);

    const removeBtn = document.createElement('button');
    removeBtn.textContent = 'Remove';
    removeBtn.type = 'button';
    removeBtn.onclick = function () {
        container.removeChild(div);
    };
    div.appendChild(removeBtn);

    container.appendChild(div);
}

// --- Save / Restore ------------------------------------------------------
function getTodayString() {
    const d = new Date();
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    return `${y}-${m}-${day}`;
}


// Default config including metadata keys
const DEFAULT_CONFIG = {
    doRemoveFromFilteredFromQueue: true,
    filterTitleRegexPatterns: [],
    filterTagsRegexPatterns: [],
    filterOwnerRegexPatterns: [],
    onlyAlertOnLatest: false,
    desktopNotifications: true,
    toggleExperiments: false,
    abuseipdbAPIkey: '',
    vtkey: '',
    ipInfoKey: '',
    scamalyticsURL: '',
    configDataURL: '',
    // URL-lock metadata
    urlFieldLocks: [],
    urlFilterTitlePatterns: [],
    urlFilterTagsPatterns: [],
    urlFilterOwnerPatterns: [],
    lastUrlSyncDate: '',
    urlFieldValues: {} 
};

const allowedHosts = [
  ".sharepoint.com",
  ".azure.com",
  ".scamalytics.com"
];

function hostMatches(u, allowed) {
    return u.hostname === allowed || u.hostname.endsWith("." + allowed);
}

function sanitizeUrl(url) {
  try {
    const u = new URL(url);
    if (allowedHosts.some(allowed => hostMatches(u, allowed)) &&  u.protocol === "https:") {
        return url;
    } else {
        return '';
    }
  } catch {
    return '';
  }
}


const saveOptions = () => {
    const removeFromQueue = document.getElementById('removeFromQueue').checked;
    const alertOnLatest = document.getElementById('alertOnLatest').checked;
    const desktopNotifications = document.getElementById('desktopNotifications').checked;
    const toggleExperiments = document.getElementById('toggleExperiments').checked;
    const abuseipdbAPIkey = document.getElementById('abuseipdbAPIkey').value.trim().replace(/[<>]/g, '');
    const ipInfoKey = document.getElementById('ipInfoKey').value.trim().replace(/[<>]/g, '');
    const vtkey = document.getElementById('vtkey').value.trim().replace(/[<>]/g, '');
    const scamalyticsURL = sanitizeUrl(document.getElementById('scamalyticsURL').value.trim()).replace(/[<>]/g, '');
    const configDataURL = sanitizeUrl(document.getElementById('configDataURL').value.trim()).replace(/[<>]/g, '');

    // Pattern rows with locked metadata
    const titleRows = Array.from(document.querySelectorAll('#titlePatterns .pattern-row'));
    const tagRows = Array.from(document.querySelectorAll('#tagPatterns .pattern-row'));
    const ownerRows = Array.from(document.querySelectorAll('#ownerPatterns .pattern-row'));

    const titlePatterns = [...new Set(
        titleRows.map(row => row.querySelector('input').value.trim()).filter(Boolean)
    )];
    const tagPatterns = [...new Set(
        tagRows.map(row => row.querySelector('input').value.trim()).filter(Boolean)
    )];
    const ownerPatterns = [...new Set(
        ownerRows.map(row => row.querySelector('input').value.trim()).filter(Boolean)
    )];

    // Which patterns are still locked from URL?
    const urlFilterTitlePatterns = [...new Set(
        titleRows
            .filter(row => row.dataset.lockedFromUrl === 'true')
            .map(row => row.querySelector('input').value.trim())
            .filter(Boolean)
    )];
    const urlFilterTagsPatterns = [...new Set(
        tagRows
            .filter(row => row.dataset.lockedFromUrl === 'true')
            .map(row => row.querySelector('input').value.trim())
            .filter(Boolean)
    )];
    const urlFilterOwnerPatterns = [...new Set(
        ownerRows
            .filter(row => row.dataset.lockedFromUrl === 'true')
            .map(row => row.querySelector('input').value.trim())
            .filter(Boolean)
    )];

    // Which scalar fields are locked?
    const fieldLockButtons = Array.from(document.querySelectorAll('.lock-btn[data-field-id]'));
    const urlFieldLocks = fieldLockButtons
        .filter(btn => btn.dataset.locked === 'true')
        .map(btn => btn.dataset.fieldId);

    chrome.storage.local.set({
        doRemoveFromFilteredFromQueue: removeFromQueue,
        filterTitleRegexPatterns: titlePatterns,
        filterTagsRegexPatterns: tagPatterns,
        filterOwnerRegexPatterns: ownerPatterns,
        onlyAlertOnLatest: alertOnLatest,
        desktopNotifications: desktopNotifications,
        abuseipdbAPIkey: abuseipdbAPIkey,
        toggleExperiments: toggleExperiments,
        vtkey: vtkey,
        ipInfoKey: ipInfoKey,
        scamalyticsURL: scamalyticsURL,
        configDataURL: configDataURL,
        urlFieldLocks: urlFieldLocks,
        urlFilterTitlePatterns: urlFilterTitlePatterns,
        urlFilterTagsPatterns: urlFilterTagsPatterns,
        urlFilterOwnerPatterns: urlFilterOwnerPatterns
    }, () => {
        const status = document.getElementById('status');
        status.textContent = 'Options saved.';
        setTimeout(() => {
            status.textContent = '';
        }, 750);
    });
};

function restoreOptions() {
    chrome.storage.local.get(DEFAULT_CONFIG, (items) => {
        // Scalar / checkbox fields
        document.getElementById('removeFromQueue').checked = items.doRemoveFromFilteredFromQueue;
        document.getElementById('alertOnLatest').checked = items.onlyAlertOnLatest;
        document.getElementById('desktopNotifications').checked = items.desktopNotifications;
        document.getElementById('toggleExperiments').checked = items.toggleExperiments;
        document.getElementById('abuseipdbAPIkey').value = items.abuseipdbAPIkey;
        document.getElementById('vtkey').value = items.vtkey;
        document.getElementById('ipInfoKey').value = items.ipInfoKey;
        document.getElementById('scamalyticsURL').value = items.scamalyticsURL;
        document.getElementById('configDataURL').value = items.configDataURL;

        // Apply field locks
        const lockedFields = new Set(items.urlFieldLocks || []);
        FIELD_IDS.forEach(id => {
            setFieldLocked(id, lockedFields.has(id));
        });

        // Clear and rebuild pattern lists
        const titleContainer = document.getElementById('titlePatterns');
        const tagContainer = document.getElementById('tagPatterns');
        const ownerContainer = document.getElementById('ownerPatterns');

        titleContainer.innerHTML = '';
        tagContainer.innerHTML = '';
        ownerContainer.innerHTML = '';

        const lockedTitlePatterns = new Set(items.urlFilterTitlePatterns || []);
        const lockedTagPatterns = new Set(items.urlFilterTagsPatterns || []);
        const lockedOwnerPatterns = new Set(items.urlFilterOwnerPatterns || []);

        items.filterTitleRegexPatterns.forEach(pattern =>
            addPattern('titlePatterns', pattern, lockedTitlePatterns.has(pattern))
        );
        items.filterTagsRegexPatterns.forEach(pattern =>
            addPattern('tagPatterns', pattern, lockedTagPatterns.has(pattern))
        );
        items.filterOwnerRegexPatterns.forEach(pattern =>
            addPattern('ownerPatterns', pattern, lockedOwnerPatterns.has(pattern))
        );
    });
}

// --- Export / Import -----------------------------------------------------
const SENSITIVE_KEYS = [
    'abuseipdbAPIkey',
    'vtkey',
    'ipInfoKey',
    'scamalyticsURL'
];
function exportOptions() {
    chrome.storage.local.get(DEFAULT_CONFIG, (items) => {
        const lockedFieldIds = new Set(items.urlFieldLocks || []);
        const urlFieldValues = items.urlFieldValues || {};

        const exportObj = {};

        Object.entries(FIELD_KEY_TO_ID).forEach(([configKey, fieldId]) => {
            // Never export secrets / sensitive fields
            if (SENSITIVE_KEYS.includes(configKey)) {
                return;
            }

            const currentValue = items[configKey];

            const isLockedFromUrl = lockedFieldIds.has(fieldId);
            const urlBaselinePresent = Object.prototype.hasOwnProperty.call(urlFieldValues, configKey);
            const urlBaselineValue = urlFieldValues[configKey];

            let shouldExport = false;

            if (!urlBaselinePresent) {
                // This field was never set by URL, so it's purely local
                shouldExport = true;
            } else {
                // URL touched it at some point
                if (!isLockedFromUrl) {
                    // User unlocked / changed it → treat as local override
                    shouldExport = true;
                } else if (currentValue !== urlBaselineValue) {
                    // Value differs from URL baseline → treat as local override
                    shouldExport = true;
                } else {
                    // Still locked and equals baseline → skip (URL-derived)
                    shouldExport = false;
                }
            }

            if (shouldExport) {
                exportObj[configKey] = currentValue;
            }
        });

        // Filters: export only non-URL patterns
        const urlTitleSet = new Set(items.urlFilterTitlePatterns || []);
        const urlTagsSet = new Set(items.urlFilterTagsPatterns || []);
        const urlOwnerSet = new Set(items.urlFilterOwnerPatterns || []);

        exportObj.filterTitleRegexPatterns = (items.filterTitleRegexPatterns || [])
            .filter(p => !urlTitleSet.has(p));

        exportObj.filterTagsRegexPatterns = (items.filterTagsRegexPatterns || [])
            .filter(p => !urlTagsSet.has(p));

        exportObj.filterOwnerRegexPatterns = (items.filterOwnerRegexPatterns || [])
            .filter(p => !urlOwnerSet.has(p));

        const jsonData = JSON.stringify(exportObj, null, 4);
        const blob = new Blob([jsonData], { type: "application/json" });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = "config.json";
        a.click();
        URL.revokeObjectURL(url);
    });
}


function importOptions(event) {
    const file = event.target.files[0];
    if (!file) {
        return;
    }

    const reader = new FileReader();
    reader.onload = function (event) {
        try {
            const jsonObj = JSON.parse(event.target.result);

            // Deduplicate array entries
            if (Array.isArray(jsonObj.filterTitleRegexPatterns)) {
                jsonObj.filterTitleRegexPatterns = [...new Set(jsonObj.filterTitleRegexPatterns)];
            }
            if (Array.isArray(jsonObj.filterTagsRegexPatterns)) {
                jsonObj.filterTagsRegexPatterns = [...new Set(jsonObj.filterTagsRegexPatterns)];
            }
            if (Array.isArray(jsonObj.filterOwnerRegexPatterns)) {
                jsonObj.filterOwnerRegexPatterns = [...new Set(jsonObj.filterOwnerRegexPatterns)];
            }

            // If import doesn't specify URL-lock metadata, reset it
            if (!Array.isArray(jsonObj.urlFieldLocks)) jsonObj.urlFieldLocks = [];
            if (!Array.isArray(jsonObj.urlFilterTitlePatterns)) jsonObj.urlFilterTitlePatterns = [];
            if (!Array.isArray(jsonObj.urlFilterTagsPatterns)) jsonObj.urlFilterTagsPatterns = [];
            if (!Array.isArray(jsonObj.urlFilterOwnerPatterns)) jsonObj.urlFilterOwnerPatterns = [];

            chrome.storage.local.set(jsonObj, () => {
                console.log('Options imported successfully');
                restoreOptions(); // Refresh the UI to reflect the imported data
            });
        } catch (e) {
            console.error('Failed to parse config file:', e);
        }
    };
    reader.readAsText(file);
}

function createFileInput() {
    const fileInput = document.createElement('input');
    fileInput.type = 'file';
    fileInput.addEventListener('change', importOptions);
    fileInput.click();
}

async function maybeAutoSyncConfigFromUrl() {
    chrome.storage.local.get(DEFAULT_CONFIG, async (items) => {
        const url = (items.configDataURL || '').trim();
        if (!url) return; // nothing to do

        const today = getTodayString();
        if (items.lastUrlSyncDate === today) {
            return; // already synced today
        }

        let remoteConfig;
        try {
            const res = await fetch(url);
            if (!res.ok) throw new Error(`HTTP ${res.status}`);
            remoteConfig = await res.json();
        } catch (e) {
            console.warn('Auto URL sync failed:', e);
            return;
        }

        const currentConfig = items;
        const newConfig = { ...currentConfig };

        // Auto-sync mode: behave like overwrite, but silent
        Object.keys(DEFAULT_CONFIG).forEach((key) => {
            if (remoteConfig.hasOwnProperty(key) && remoteConfig[key] !== undefined) {
                newConfig[key] = remoteConfig[key];
            }
        });

        // Rebuild URL locks + URL baseline values
        const urlFieldLocks = [];
        const urlFieldValues = { ...(currentConfig.urlFieldValues || {}) };

        Object.entries(FIELD_KEY_TO_ID).forEach(([configKey, fieldId]) => {
            if (remoteConfig.hasOwnProperty(configKey)) {
                urlFieldLocks.push(fieldId);
                urlFieldValues[configKey] = remoteConfig[configKey];
            }
        });

        const urlFilterTitlePatterns = Array.isArray(remoteConfig.filterTitleRegexPatterns)
            ? [...new Set(remoteConfig.filterTitleRegexPatterns)]
            : [];
        const urlFilterTagsPatterns = Array.isArray(remoteConfig.filterTagsRegexPatterns)
            ? [...new Set(remoteConfig.filterTagsRegexPatterns)]
            : [];
        const urlFilterOwnerPatterns = Array.isArray(remoteConfig.filterOwnerRegexPatterns)
            ? [...new Set(remoteConfig.filterOwnerRegexPatterns)]
            : [];

        newConfig.urlFieldLocks = urlFieldLocks;
        newConfig.urlFieldValues = urlFieldValues;
        newConfig.urlFilterTitlePatterns = urlFilterTitlePatterns;
        newConfig.urlFilterTagsPatterns = urlFilterTagsPatterns;
        newConfig.urlFilterOwnerPatterns = urlFilterOwnerPatterns;
        newConfig.lastUrlSyncDate = today;

        chrome.storage.local.set(newConfig, () => {
            restoreOptions(); // update UI if options page is open
        });
    });
}


// --- Apply Config from URL ----------------------------------------------

async function handleUseConfigFromUrl() {
    const urlInput = document.getElementById('configDataURL');
    const url = urlInput.value.trim();
    if (!url) {
        alert('Please enter a Config Link URL first.');
        return;
    }

    let remoteConfig;
    try {
        const res = await fetch(url);
        if (!res.ok) {
            throw new Error(`HTTP ${res.status}`);
        }
        remoteConfig = await res.json();
    } catch (e) {
        console.error('Failed to fetch or parse config from URL:', e);
        alert('Failed to fetch or parse JSON from the URL.');
        return;
    }

    chrome.storage.local.get(DEFAULT_CONFIG, (currentConfig) => {
        const overwrite = confirm(
            'Use this URL config as base?\n\n' +
            'OK = Overwrite existing config with values from URL (only where provided).\n' +
            'Cancel = Merge filter patterns only.'
        );

        const newConfig = { ...currentConfig };

        if (overwrite) {
            Object.keys(DEFAULT_CONFIG).forEach((key) => {
                if (remoteConfig.hasOwnProperty(key) && remoteConfig[key] !== undefined) {
                    newConfig[key] = remoteConfig[key];
                }
            });
        } else {
            ['filterTitleRegexPatterns', 'filterTagsRegexPatterns', 'filterOwnerRegexPatterns'].forEach(key => {
                const incoming = Array.isArray(remoteConfig[key]) ? remoteConfig[key] : [];
                const existing = Array.isArray(currentConfig[key]) ? currentConfig[key] : [];
                newConfig[key] = [...new Set([...existing, ...incoming])];
            });
        }

        // Build URL-based lock metadata:
        const urlFieldLocks = [];
        const urlFieldValues = { ...(currentConfig.urlFieldValues || {}) };

        Object.entries(FIELD_KEY_TO_ID).forEach(([configKey, fieldId]) => {
            if (remoteConfig.hasOwnProperty(configKey)) {
                urlFieldLocks.push(fieldId);
                urlFieldValues[configKey] = remoteConfig[configKey];
            }
        });

        const urlFilterTitlePatterns = Array.isArray(remoteConfig.filterTitleRegexPatterns)
            ? [...new Set(remoteConfig.filterTitleRegexPatterns)]
            : [];
        const urlFilterTagsPatterns = Array.isArray(remoteConfig.filterTagsRegexPatterns)
            ? [...new Set(remoteConfig.filterTagsRegexPatterns)]
            : [];
        const urlFilterOwnerPatterns = Array.isArray(remoteConfig.filterOwnerRegexPatterns)
            ? [...new Set(remoteConfig.filterOwnerRegexPatterns)]
            : [];

        newConfig.urlFieldLocks = urlFieldLocks;
        newConfig.urlFieldValues = urlFieldValues;
        newConfig.urlFilterTitlePatterns = urlFilterTitlePatterns;
        newConfig.urlFilterTagsPatterns = urlFilterTagsPatterns;
        newConfig.urlFilterOwnerPatterns = urlFilterOwnerPatterns;
        newConfig.lastUrlSyncDate = getTodayString();

        chrome.storage.local.set(newConfig, () => {
            restoreOptions();
            const status = document.getElementById('status');
            status.textContent = 'Config updated from URL.';
            setTimeout(() => {
                status.textContent = '';
            }, 1500);
        });
    });
}

// --- DOMContentLoaded ----------------------------------------------------

document.addEventListener('DOMContentLoaded', (event) => {
    const tablinks = document.getElementsByClassName("tablinks");
    for (let i = 0; i < tablinks.length; i++) {
        tablinks[i].className = tablinks[i].className += " active";
    }
    document.getElementById("GeneralOptions").style.display = "block";

    document.getElementById("generalOptionsTab")
        .addEventListener('click', (evt) => openTab(evt, 'GeneralOptions'));

    initFieldLocks();
    restoreOptions();
    maybeAutoSyncConfigFromUrl();

    // General options buttons
    document.getElementById('addTitlePattern').addEventListener('click', () => addPattern('titlePatterns'));
    document.getElementById('addTagPattern').addEventListener('click', () => addPattern('tagPatterns'));
    document.getElementById('addOwnerPattern').addEventListener('click', () => addPattern('ownerPatterns'));
    document.getElementById('save').addEventListener('click', saveOptions);
    document.getElementById('export').addEventListener('click', exportOptions);
    document.getElementById('import').addEventListener('click', createFileInput);

    // New: apply config from URL button
    const useBtn = document.getElementById('useConfigFromUrl');
    if (useBtn) {
        useBtn.addEventListener('click', handleUseConfigFromUrl);
    }
});
