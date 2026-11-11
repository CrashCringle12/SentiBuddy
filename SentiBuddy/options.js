// Highlight the side-nav link for the section currently in view.
function initSideNav() {
    const links = Array.from(document.querySelectorAll('.sidenav a'));
    const sections = links.map(a => document.querySelector(a.getAttribute('href'))).filter(Boolean);
    const setActive = (id) => links.forEach(a => a.classList.toggle('active', a.getAttribute('href') === `#${id}`));
    const observer = new IntersectionObserver((entries) => {
        const visible = entries.filter(e => e.isIntersecting).sort((a, b) => a.boundingClientRect.top - b.boundingClientRect.top);
        if (visible.length) setActive(visible[0].target.id);
    }, { rootMargin: '-80px 0px -60% 0px' });
    sections.forEach(s => observer.observe(s));
    if (sections[0]) setActive(sections[0].id);
}

function applyOptionsTheme(theme) {
    const activeTheme = theme === 'dark' ? 'dark' : 'light';
    document.body.setAttribute('data-theme', activeTheme);

    const themeToggle = document.getElementById('optionsThemeToggle');
    if (themeToggle) {
        themeToggle.textContent = activeTheme === 'dark' ? '☀️ Theme' : '🌙 Theme';
        themeToggle.title = activeTheme === 'dark' ? 'Switch to light mode' : 'Switch to dark mode';
    }
}

// --- Helpers for URL-based locks -----------------------------------------

// Map config keys -> DOM field IDs
const FIELD_KEY_TO_ID = {
    doRemoveFromFilteredFromQueue: 'removeFromQueue',
    onlyAlertOnLatest: 'alertOnLatest',
    desktopNotifications: 'desktopNotifications',
    notifyOnMatchesOnly: 'notifyOnMatchesOnly',
    toggleExperiments: 'toggleExperiments',
    abuseipdbAPIkey: 'abuseipdbAPIkey',
    vtkey: 'vtkey',
    ipInfoKey: 'ipInfoKey',
    scamalyticsURL: 'scamalyticsURL',
    configDataURL: 'configDataURL',
    dashboardTitle: 'dashboardTitle',
    dashboardLink: 'dashboardLink',
    timeTrackingEnabled: 'timeTrackingEnabled',
    timeTrackingAutoPause: 'timeTrackingAutoPause',
    timeTrackingIdleMinutes: 'timeTrackingIdleMinutes',
    timeTrackingAutoResetTime: 'timeTrackingAutoResetTime',
    timeEntryTitle: 'timeEntryTitle',
    timeEntryLink: 'timeEntryLink',
    workspaceClientPattern: 'workspaceClientPattern',
    slaSettings: 'slaSettings' // a <fieldset>: one lock covers every SLA input
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

        if (input.tagName === 'FIELDSET') {
            input.closest('.card').querySelector('h2').appendChild(lockBtn);
        } else {
            input.insertAdjacentElement('afterend', lockBtn);
        }
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

// Pass `field` ('title' | 'tags') to get a notification-rule row with a field picker.
function addPattern(containerId, value = '', lockedFromUrl = false, field = null) {
    const container = document.getElementById(containerId);
    const div = document.createElement('div');
    div.className = 'pattern-row';
    div.dataset.lockedFromUrl = lockedFromUrl ? 'true' : 'false';

    const controls = [];
    if (field) {
        const select = document.createElement('select');
        select.className = 'rule-field';
        [['title', 'Title regex'], ['tags', 'Tag regex']].forEach(([v, label]) => {
            const opt = document.createElement('option');
            opt.value = v;
            opt.textContent = label;
            select.appendChild(opt);
        });
        select.value = field;
        div.appendChild(select);
        controls.push(select);
    }

    const input = document.createElement('input');
    input.type = 'text';
    input.value = value;
    input.placeholder = field ? 'Regex, e.g. Ransomware|Wiper' : 'Regex pattern';
    input.spellcheck = false;
    const validate = () => {
        const bad = !isValidRegex(input.value.trim());
        input.classList.toggle('invalid', bad);
        input.title = bad ? 'Invalid regular expression — it will be ignored' : '';
    };
    input.addEventListener('input', validate);
    validate();
    controls.push(input);

    if (lockedFromUrl) {
        controls.forEach(c => { c.disabled = true; });
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
            controls.forEach(c => { c.disabled = false; });
            div.dataset.lockedFromUrl = 'false';
            lockBtn.dataset.locked = 'false';
            lockBtn.textContent = '🔓';
            lockBtn.title = 'Local pattern. Click to lock.';
        } else {
            controls.forEach(c => { c.disabled = true; });
            div.dataset.lockedFromUrl = 'true';
            lockBtn.dataset.locked = 'true';
            lockBtn.textContent = '🔒';
            lockBtn.title = 'Pattern from URL config. Click to unlock for editing.';
        }
    });

    div.appendChild(lockBtn);

    const removeBtn = document.createElement('button');
    removeBtn.textContent = '✕';
    removeBtn.title = 'Remove';
    removeBtn.type = 'button';
    removeBtn.className = 'remove-btn';
    removeBtn.onclick = function () {
        container.removeChild(div);
        updateNotificationRulesUi();
    };
    div.appendChild(removeBtn);

    container.appendChild(div);
    updateNotificationRulesUi();
}

function isValidRegex(pattern) {
    if (!pattern) return true;
    try {
        new RegExp(pattern);
        return true;
    } catch {
        return false;
    }
}

// --- Notification rules ----------------------------------------------------
// notificationRules: [{ field: 'title' | 'tags', pattern }]. When notifyOnMatchesOnly is
// true, core.js only raises desktop notifications for incidents matching a rule.
// URL-locked rules are tracked as "field:pattern" keys in urlNotificationRules.
const ruleKey = (r) => `${r.field}:${r.pattern}`;

function normalizeNotificationRules(rules) {
    if (!Array.isArray(rules)) return [];
    const seen = new Set();
    const out = [];
    rules.forEach(r => {
        if (!r || typeof r.pattern !== 'string' || !r.pattern.trim()) return;
        const f = String(r.field || '').toLowerCase();
        const field = f === 'tag' || f === 'tags' ? 'tags' : f === 'title' ? 'title' : null;
        if (!field) return;
        const rule = { field, pattern: r.pattern.trim() };
        if (seen.has(ruleKey(rule))) return;
        seen.add(ruleKey(rule));
        out.push(rule);
    });
    return out;
}

function readNotificationRuleRows() {
    return Array.from(document.querySelectorAll('#notificationRules .pattern-row')).map(row => ({
        rule: { field: row.querySelector('select').value, pattern: row.querySelector('input').value.trim() },
        locked: row.dataset.lockedFromUrl === 'true'
    })).filter(r => r.rule.pattern);
}

function updateNotificationRulesUi() {
    const list = document.getElementById('notificationRules');
    const toggle = document.getElementById('notifyOnMatchesOnly');
    if (!list || !toggle) return;
    const on = toggle.checked;
    document.getElementById('notificationRulesGroup').classList.toggle('inactive', !on);
    document.getElementById('notificationRulesInactive').hidden = on;
    document.getElementById('notificationRulesEmpty').hidden = list.children.length > 0;
}

// --- SLA settings ----------------------------------------------------------
// Stored as one slaSettings object (also accepted from the central config).
// enhanced-queue/content.js validates it again before use.
const SLA_SEVERITIES = ['High', 'Medium', 'Low', 'Informational'];
// Nothing is assumed: no SLAs, no "approaching" stage (warnPercent null) and no row tint (intensity 0)
// unless set here or by the central config. The colors only seed the color pickers.
const SLA_DEFAULTS = {
    enabled: true,
    minutes: {},
    warnPercent: null,
    warnColor: '#ffaa44',
    breachColor: '#e81123',
    warnIntensity: 0,
    breachIntensity: 0
};

function readSlaForm() {
    const num = (id, min, max, fallback) => {
        const raw = document.getElementById(id).value.trim();
        const n = raw === '' ? NaN : Number(raw);
        return Number.isFinite(n) ? Math.min(max, Math.max(min, n)) : fallback;
    };
    const minutes = {};
    SLA_SEVERITIES.forEach(sev => {
        const v = num(`sla${sev}`, 0, 525600, 0);
        if (v > 0) minutes[sev] = v;
    });
    return {
        enabled: document.getElementById('slaEnabled').checked,
        minutes,
        warnPercent: num('slaWarnPercent', 0, 100, SLA_DEFAULTS.warnPercent),
        warnColor: document.getElementById('slaWarnColor').value,
        breachColor: document.getElementById('slaBreachColor').value,
        warnIntensity: num('slaWarnIntensity', 0, 100, SLA_DEFAULTS.warnIntensity),
        breachIntensity: num('slaBreachIntensity', 0, 100, SLA_DEFAULTS.breachIntensity)
    };
}

function fillSlaForm(saved) {
    const s = { ...SLA_DEFAULTS, ...(saved && typeof saved === 'object' ? saved : {}) };
    const minutes = s.minutes && typeof s.minutes === 'object' ? s.minutes : {};
    const isHex = (v) => /^#[0-9a-f]{6}$/i.test(v);
    document.getElementById('slaEnabled').checked = s.enabled !== false;
    SLA_SEVERITIES.forEach(sev => {
        const key = Object.keys(minutes).find(k => k.toLowerCase() === sev.toLowerCase());
        const v = key ? Number(minutes[key]) : 0;
        document.getElementById(`sla${sev}`).value = v > 0 ? v : '';
    });
    document.getElementById('slaWarnPercent').value = s.warnPercent ?? '';
    document.getElementById('slaWarnColor').value = isHex(s.warnColor) ? s.warnColor : SLA_DEFAULTS.warnColor;
    document.getElementById('slaBreachColor').value = isHex(s.breachColor) ? s.breachColor : SLA_DEFAULTS.breachColor;
    document.getElementById('slaWarnIntensity').value = s.warnIntensity;
    document.getElementById('slaBreachIntensity').value = s.breachIntensity;
    updateSlaPreview();
}

function updateSlaPreview() {
    [['Warn', 'slaWarn'], ['Breach', 'slaBreach']].forEach(([name, prefix]) => {
        const color = document.getElementById(`${prefix}Color`).value;
        const intensity = document.getElementById(`${prefix}Intensity`).value;
        document.getElementById(`${prefix}IntensityValue`).textContent = `${intensity}%`;
        const preview = document.getElementById(`sla${name}Preview`);
        preview.style.background = `color-mix(in srgb, ${color} ${intensity}%, transparent)`;
        preview.style.boxShadow = `inset 4px 0 0 ${color}`;
    });
}

// --- Unsaved-changes tracking ----------------------------------------------
// A snapshot of every control (and lock) is taken whenever the form matches storage; the banner
// shows while the live form differs from it.
let savedSnapshot = null;

function formSnapshot() {
    const controls = Array.from(document.querySelectorAll('.content input, .content select'))
        .map(c => (c.type === 'checkbox' ? c.checked : c.value));
    const locks = Array.from(document.querySelectorAll('.content .lock-btn')).map(b => b.dataset.locked);
    return JSON.stringify([controls, locks]);
}

function isDirty() {
    return savedSnapshot !== null && formSnapshot() !== savedSnapshot;
}

function updateDirtyBanner() {
    const dirty = isDirty();
    document.getElementById('unsavedBanner').hidden = !dirty;
    document.getElementById('save').classList.toggle('attention', dirty);
}

function markClean() {
    savedSnapshot = formSnapshot();
    updateDirtyBanner();
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
    notifyOnMatchesOnly: false,
    notificationRules: [],
    toggleExperiments: false,
    abuseipdbAPIkey: '',
    vtkey: '',
    ipInfoKey: '',
    scamalyticsURL: '',
    configDataURL: '',
    dashboardTitle: 'Open Dashboard',
    dashboardLink: '',
    timeTrackingEnabled: true,
    timeTrackingAutoPause: false,
    timeTrackingIdleMinutes: 5,
    timeTrackingAutoResetTime: '',
    timeEntryTitle: 'Time entry',
    timeEntryLink: '',
    workspaceClientPattern: '',
    slaSettings: {},
    // URL-lock metadata
    urlFieldLocks: [],
    urlFilterTitlePatterns: [],
    urlFilterTagsPatterns: [],
    urlFilterOwnerPatterns: [],
    urlNotificationRules: [],
    lastUrlSyncDate: '',
    urlFieldValues: {} 
};

// Keys a pulled / auto-synced config never overwrites or locks: the config link is whatever the
// user pulled from.
const URL_SYNC_SKIP_KEYS = new Set(['configDataURL']);

const allowedHosts = [
  "sharepoint.com",
  "azure.com",
  "scamalytics.com"
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

// A regex the rest of the extension can use, or '' (an invalid one would just never match).
function validPattern(src) {
    const s = String(src || '').slice(0, 300);
    try { new RegExp(s, 'i'); return s; } catch { return ''; }
}

function sanitizeHttpsUrl(url) {
    try {
        const u = new URL(url);
        return u.protocol === 'https:' ? u.href : '';
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
    const dashboardTitle = document.getElementById('dashboardTitle').value.trim().replace(/[<>]/g, '');
    const dashboardLink = sanitizeHttpsUrl(document.getElementById('dashboardLink').value.trim()).replace(/[<>]/g, '');

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

    const ruleRows = readNotificationRuleRows();
    const notificationRules = normalizeNotificationRules(ruleRows.map(r => r.rule));
    const urlNotificationRules = [...new Set(ruleRows.filter(r => r.locked).map(r => ruleKey(r.rule)))];

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
        notifyOnMatchesOnly: document.getElementById('notifyOnMatchesOnly').checked,
        notificationRules: notificationRules,
        abuseipdbAPIkey: abuseipdbAPIkey,
        toggleExperiments: toggleExperiments,
        vtkey: vtkey,
        ipInfoKey: ipInfoKey,
        scamalyticsURL: scamalyticsURL,
        configDataURL: configDataURL,
        dashboardTitle: dashboardTitle || 'Open Dashboard',
        dashboardLink: dashboardLink,
        timeTrackingEnabled: document.getElementById('timeTrackingEnabled').checked,
        timeTrackingAutoPause: document.getElementById('timeTrackingAutoPause').checked,
        // "HH:MM" (24h) or empty; anything else is treated as empty (off).
        timeTrackingAutoResetTime: (() => {
            const m = /^([01]?\d|2[0-3]):([0-5]\d)$/.exec(document.getElementById('timeTrackingAutoResetTime').value.trim());
            return m ? `${m[1].padStart(2, '0')}:${m[2]}` : '';
        })(),
        timeTrackingIdleMinutes: Math.min(120, Math.max(1, Math.round(Number(document.getElementById('timeTrackingIdleMinutes').value) || 5))),
        timeEntryTitle: document.getElementById('timeEntryTitle').value.trim().replace(/[<>]/g, '') || 'Time entry',
        timeEntryLink: sanitizeHttpsUrl(document.getElementById('timeEntryLink').value.trim()).replace(/[<>]/g, ''),
        workspaceClientPattern: validPattern(document.getElementById('workspaceClientPattern').value.trim()),
        slaSettings: readSlaForm(),
        urlFieldLocks: urlFieldLocks,
        urlFilterTitlePatterns: urlFilterTitlePatterns,
        urlFilterTagsPatterns: urlFilterTagsPatterns,
        urlFilterOwnerPatterns: urlFilterOwnerPatterns,
        urlNotificationRules: urlNotificationRules
    }, () => {
        restoreOptions(); // show what was actually stored (sanitized URLs, deduped patterns)
        const status = document.getElementById('status');
        status.textContent = '✓ Saved';
        setTimeout(() => {
            status.textContent = '';
        }, 1500);
    });
};

function restoreOptions() {
    chrome.storage.local.get(DEFAULT_CONFIG, (items) => {
        // Scalar / checkbox fields
        document.getElementById('removeFromQueue').checked = items.doRemoveFromFilteredFromQueue;
        document.getElementById('alertOnLatest').checked = items.onlyAlertOnLatest;
        document.getElementById('desktopNotifications').checked = items.desktopNotifications;
        document.getElementById('notifyOnMatchesOnly').checked = !!items.notifyOnMatchesOnly;
        document.getElementById('toggleExperiments').checked = items.toggleExperiments;
        document.getElementById('abuseipdbAPIkey').value = items.abuseipdbAPIkey;
        document.getElementById('vtkey').value = items.vtkey;
        document.getElementById('ipInfoKey').value = items.ipInfoKey;
        document.getElementById('scamalyticsURL').value = items.scamalyticsURL;
        document.getElementById('configDataURL').value = items.configDataURL;
        document.getElementById('dashboardTitle').value = items.dashboardTitle;
        document.getElementById('dashboardLink').value = items.dashboardLink;
        document.getElementById('timeTrackingEnabled').checked = !!items.timeTrackingEnabled;
        document.getElementById('timeTrackingAutoPause').checked = !!items.timeTrackingAutoPause;
        document.getElementById('timeTrackingAutoResetTime').value = items.timeTrackingAutoResetTime || '';
        document.getElementById('timeTrackingIdleMinutes').value = items.timeTrackingIdleMinutes;
        document.getElementById('timeEntryTitle').value = items.timeEntryTitle;
        document.getElementById('timeEntryLink').value = items.timeEntryLink;
        document.getElementById('workspaceClientPattern').value = items.workspaceClientPattern || '';
        fillSlaForm(items.slaSettings);

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

        document.getElementById('notificationRules').innerHTML = '';
        const lockedRules = new Set(items.urlNotificationRules || []);
        normalizeNotificationRules(items.notificationRules).forEach(rule =>
            addPattern('notificationRules', rule.pattern, lockedRules.has(ruleKey(rule)), rule.field)
        );
        updateNotificationRulesUi();
        markClean();
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
                } else if (JSON.stringify(currentValue) !== JSON.stringify(urlBaselineValue)) {
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

        const urlRuleSet = new Set(items.urlNotificationRules || []);
        exportObj.notificationRules = normalizeNotificationRules(items.notificationRules)
            .filter(r => !urlRuleSet.has(ruleKey(r)));

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
            if (!Array.isArray(jsonObj.urlNotificationRules)) jsonObj.urlNotificationRules = [];
            if ('notificationRules' in jsonObj) {
                jsonObj.notificationRules = normalizeNotificationRules(jsonObj.notificationRules);
            }

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
            if (URL_SYNC_SKIP_KEYS.has(key)) return;
            if (remoteConfig.hasOwnProperty(key) && remoteConfig[key] !== undefined) {
                newConfig[key] = remoteConfig[key];
            }
        });

        // Rebuild URL locks + URL baseline values
        const urlFieldLocks = [];
        const urlFieldValues = { ...(currentConfig.urlFieldValues || {}) };

        Object.entries(FIELD_KEY_TO_ID).forEach(([configKey, fieldId]) => {
            if (URL_SYNC_SKIP_KEYS.has(configKey)) return;
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
        newConfig.notificationRules = normalizeNotificationRules(newConfig.notificationRules);
        newConfig.urlNotificationRules = normalizeNotificationRules(remoteConfig.notificationRules).map(ruleKey);
        newConfig.lastUrlSyncDate = today;

        chrome.storage.local.set(newConfig, () => {
            restoreOptions(); // update UI if options page is open
        });
    });
}


// --- Apply Config from URL ----------------------------------------------

// Pull always uses (and then saves) the link currently in the Config Link field. The pulled config
// can't replace or lock the link itself, so a remote "configDataURL" never overwrites yours.
async function handleUseConfigFromUrl() {
    const urlInput = document.getElementById('configDataURL');
    const typed = urlInput.value.trim();
    if (!typed) {
        alert('Please enter a Config Link URL first.');
        return;
    }
    const url = sanitizeUrl(typed);
    if (!url) {
        alert(`The Config Link must be an https:// URL on one of: ${allowedHosts.join(', ')}.`);
        return;
    }
    if (isDirty() && !confirm('You have unsaved changes on this page. Pulling reloads the settings from the pulled config and discards them.\n\nContinue?')) {
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
                if (URL_SYNC_SKIP_KEYS.has(key)) return;
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
            newConfig.notificationRules = [
                ...normalizeNotificationRules(currentConfig.notificationRules),
                ...normalizeNotificationRules(remoteConfig.notificationRules)
            ];
        }
        newConfig.notificationRules = normalizeNotificationRules(newConfig.notificationRules);
        newConfig.configDataURL = url;

        // Build URL-based lock metadata:
        const urlFieldLocks = [];
        const urlFieldValues = { ...(currentConfig.urlFieldValues || {}) };

        Object.entries(FIELD_KEY_TO_ID).forEach(([configKey, fieldId]) => {
            if (URL_SYNC_SKIP_KEYS.has(configKey)) return;
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
        newConfig.urlNotificationRules = normalizeNotificationRules(remoteConfig.notificationRules).map(ruleKey);
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

document.addEventListener('DOMContentLoaded', () => {
    initSideNav();
    initFieldLocks();
    restoreOptions();
    maybeAutoSyncConfigFromUrl();

    // General options buttons
    document.getElementById('addTitlePattern').addEventListener('click', () => addPattern('titlePatterns'));
    document.getElementById('addTagPattern').addEventListener('click', () => addPattern('tagPatterns'));
    document.getElementById('addOwnerPattern').addEventListener('click', () => addPattern('ownerPatterns'));
    document.getElementById('addNotificationRule').addEventListener('click', () => {
        addPattern('notificationRules', '', false, 'title');
        document.querySelector('#notificationRules .pattern-row:last-child input').focus();
    });
    document.getElementById('notifyOnMatchesOnly').addEventListener('change', updateNotificationRulesUi);
    document.getElementById('save').addEventListener('click', saveOptions);
    document.getElementById('export').addEventListener('click', exportOptions);
    document.getElementById('import').addEventListener('click', createFileInput);
    ['slaWarnColor', 'slaBreachColor', 'slaWarnIntensity', 'slaBreachIntensity'].forEach(id =>
        document.getElementById(id).addEventListener('input', updateSlaPreview));

    // New: apply config from URL button
    const useBtn = document.getElementById('useConfigFromUrl');
    if (useBtn) {
        useBtn.addEventListener('click', handleUseConfigFromUrl);
    }

    // Unsaved changes: typing/toggling fires input/change; add, remove and lock buttons change the
    // DOM on click, so re-check after the click handlers have run.
    document.addEventListener('input', updateDirtyBanner);
    document.addEventListener('change', updateDirtyBanner);
    document.addEventListener('click', () => setTimeout(updateDirtyBanner, 0));
    document.getElementById('bannerSave').addEventListener('click', saveOptions);
    document.getElementById('bannerDiscard').addEventListener('click', () => {
        if (confirm('Discard your unsaved changes?')) restoreOptions();
    });
    window.addEventListener('beforeunload', (e) => {
        if (!isDirty()) return;
        e.preventDefault();
    });

    chrome.storage.local.get({ popupTheme: 'light' }, (result) => {
        applyOptionsTheme(result.popupTheme);
    });

    const themeToggle = document.getElementById('optionsThemeToggle');
    if (themeToggle) {
        themeToggle.addEventListener('click', () => {
            const currentTheme = document.body.getAttribute('data-theme') === 'dark' ? 'dark' : 'light';
            const nextTheme = currentTheme === 'dark' ? 'light' : 'dark';
            applyOptionsTheme(nextTheme);
            chrome.storage.local.set({ popupTheme: nextTheme });
        });
    }
});
