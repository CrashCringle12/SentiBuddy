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
    
    chrome.storage.sync.set({
        doRemoveFromFilteredFromQueue: removeFromQueue,
        filterTitleRegexPatterns: titlePatterns,
        filterTagsRegexPatterns: tagPatterns,
        filterOwnerRegexPatterns: ownerPatterns,
        onlyAlertOnLatest: alertOnLatest,
        desktopNotifications: desktopNotifications,
        abuseipdbAPIkey: abuseipdbAPIkey,
        vtkey: vtkey,
        ipInfoKey: ipInfoKey,
        scamalyticsURL: scamalyticsURL
    }, () => {
        const status = document.getElementById('status');
        status.textContent = 'Options saved.';
        setTimeout(() => {
            status.textContent = '';
        }, 750);
    });
};

function restoreOptions() {
    chrome.storage.sync.get({
        doRemoveFromFilteredFromQueue: true,
        filterTitleRegexPatterns: [],
        filterTagsRegexPatterns: [],
        filterOwnerRegexPatterns: [],
        onlyAlertOnLatest: false,
        desktopNotifications: true,
        abuseipdbAPIkey: '',
        vtkey: '',
        ipInfoKey: '',
        scamalyticsURL: ''
    }, (items) => {
        
        document.getElementById('removeFromQueue').checked = items.doRemoveFromFilteredFromQueue;
        document.getElementById('alertOnLatest').checked = items.onlyAlertOnLatest;
        document.getElementById('desktopNotifications').checked = items.desktopNotifications;
        items.filterTitleRegexPatterns.forEach(pattern => addPattern('titlePatterns', pattern));
        items.filterTagsRegexPatterns.forEach(pattern => addPattern('tagPatterns', pattern));
        items.filterOwnerRegexPatterns.forEach(pattern => addPattern('ownerPatterns', pattern));
        document.getElementById('abuseipdbAPIkey').value = items.abuseipdbAPIkey;
        document.getElementById('vtkey').value = items.vtkey;
        document.getElementById('ipInfoKey').value = items.ipInfoKey;
        document.getElementById('scamalyticsURL').value = items.scamalyticsURL
    });
}
function exportOptions() {
    chrome.storage.sync.get({
        doRemoveFromFilteredFromQueue: true,
        filterTitleRegexPatterns: [],
        filterTagsRegexPatterns: [],
        filterOwnerRegexPatterns: [],
        onlyAlertOnLatest: false,
        desktopNotifications: true,
        abuseipdbAPIkey: '',
        vtkey: '',
        ipInfoKey: '',
        scamalyticsURL: ''
    }, (items) => {
        const jsonData = JSON.stringify(items, null, 4);
        const blob = new Blob([jsonData], {type: "application/json"});
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

            chrome.storage.sync.set(jsonObj, () => {
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

document.addEventListener('DOMContentLoaded', restoreOptions);
document.getElementById('addTitlePattern').addEventListener('click', () => addPattern('titlePatterns'));
document.getElementById('addTagPattern').addEventListener('click', () => addPattern('tagPatterns'));
document.getElementById('addOwnerPattern').addEventListener('click', () => addPattern('ownerPatterns'));
document.getElementById('save').addEventListener('click', () => saveOptions());
document.getElementById('export').addEventListener('click', exportOptions);
document.getElementById('import').addEventListener('click', createFileInput);
