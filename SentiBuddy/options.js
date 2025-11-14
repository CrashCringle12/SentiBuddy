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

function addPattern(containerId, value = '') {
    const container = document.getElementById(containerId);
    const div = document.createElement('div');
    const input = document.createElement('input');
    input.type = 'text';
    input.value = value;
    div.appendChild(input);
    const removeBtn = document.createElement('button');
    removeBtn.textContent = 'Remove';
    removeBtn.type = 'button';
    removeBtn.onclick = function() {
        container.removeChild(div);
    };
    div.appendChild(removeBtn);
    container.appendChild(div);
}

const saveOptions = () => {
    const removeFromQueue = document.getElementById('removeFromQueue').checked;
    const titlePatterns = [...new Set(Array.from(document.querySelectorAll('#titlePatterns input')).map(input => input.value.trim()))];
    const tagPatterns = [...new Set(Array.from(document.querySelectorAll('#tagPatterns input')).map(input => input.value.trim()))];
    const ownerPatterns = [...new Set(Array.from(document.querySelectorAll('#ownerPatterns input')).map(input => input.value.trim()))];
    const alertOnLatest = document.getElementById('alertOnLatest').checked;
    const desktopNotifications = document.getElementById('desktopNotifications').checked;
    const abuseipdbAPIkey = document.getElementById('abuseipdbAPIkey').value.trim();
    const ipInfoKey = document.getElementById('ipInfoKey').value.trim();
    const vtkey = document.getElementById('vtkey').value.trim();
    const scamalyticsURL = document.getElementById('scamalyticsURL').value.trim();
    const configDataURL = document.getElementById('configDataURL').value.trim();
    const toggleExperiments = document.getElementById('toggleExperiments').checked;

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
        configDataURL: configDataURL
    }, () => {
        const status = document.getElementById('status');
        status.textContent = 'Options saved.';
        setTimeout(() => {
            status.textContent = '';
        }, 750);
    });
};

function restoreOptions() {
    chrome.storage.local.get({
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
        configDataURL: ''
    }, (items) => {
        document.getElementById('removeFromQueue').checked = items.doRemoveFromFilteredFromQueue;
        document.getElementById('alertOnLatest').checked = items.onlyAlertOnLatest;
        document.getElementById('desktopNotifications').checked = items.desktopNotifications;
        document.getElementById('toggleExperiments').checked = items.toggleExperiments;
        items.filterTitleRegexPatterns.forEach(pattern => addPattern('titlePatterns', pattern));
        items.filterTagsRegexPatterns.forEach(pattern => addPattern('tagPatterns', pattern));
        items.filterOwnerRegexPatterns.forEach(pattern => addPattern('ownerPatterns', pattern));
        document.getElementById('abuseipdbAPIkey').value = items.abuseipdbAPIkey;
        document.getElementById('vtkey').value = items.vtkey;
        document.getElementById('ipInfoKey').value = items.ipInfoKey;
        document.getElementById('scamalyticsURL').value = items.scamalyticsURL;
        document.getElementById('configDataURL').value = items.configDataURL;
    });
}

function exportOptions() {
    chrome.storage.local.get({
        doRemoveFromFilteredFromQueue: true,
        filterTitleRegexPatterns: [],
        filterTagsRegexPatterns: [],
        filterOwnerRegexPatterns: [],
        onlyAlertOnLatest: false,
        desktopNotifications: true,
    }, (items) => {
        const jsonData = JSON.stringify(items, null, 4);
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
    reader.onload = function(event) {
        try {
            const jsonObj = JSON.parse(event.target.result);

            // Deduplicate array entries
            jsonObj.filterTitleRegexPatterns = [...new Set(jsonObj.filterTitleRegexPatterns)];
            jsonObj.filterTagsRegexPatterns = [...new Set(jsonObj.filterTagsRegexPatterns)];
            jsonObj.filterOwnerRegexPatterns = [...new Set(jsonObj.filterOwnerRegexPatterns)];

            chrome.storage.local.set(jsonObj, () => {
                console.log('Options imported and duplicates removed successfully');
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

// Restore options on DOMContentLoaded
document.addEventListener('DOMContentLoaded', (event) => {
    checkExperiments(); // Check if experimental features are enabled

    document.getElementById("generalOptionsTab").addEventListener('click', (evt) => openTab(evt, 'GeneralOptions'));
    restoreOptions();
});

// Event listeners for general options
document.getElementById('addTitlePattern').addEventListener('click', () => addPattern('titlePatterns'));
document.getElementById('addTagPattern').addEventListener('click', () => addPattern('tagPatterns'));
document.getElementById('addOwnerPattern').addEventListener('click', () => addPattern('ownerPatterns'));
document.getElementById('save').addEventListener('click', saveOptions);
document.getElementById('export').addEventListener('click', exportOptions);
document.getElementById('import').addEventListener('click', createFileInput);

document.getElementById('toggleExperiments').addEventListener('click', clickToggleExperiments);