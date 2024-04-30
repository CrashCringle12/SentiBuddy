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
    const titlePatterns = Array.from(document.querySelectorAll('#titlePatterns input')).map(input => input.value.trim());
    const tagPatterns = Array.from(document.querySelectorAll('#tagPatterns input')).map(input => input.value.trim());
    const alertOnLatest = document.getElementById('alertOnLatest').checked;
    const desktopNotifications = document.getElementById('desktopNotifications').checked;
    const abuseipdbAPIkey = document.getElementById('abuseipdbAPIkey').value.trim();
    console.log(abuseipdbAPIkey)
    const vtkey = document.getElementById('vtkey').value.trim();
    chrome.storage.sync.set({
        doRemoveFromFilteredFromQueue: removeFromQueue,
        filterTitleRegexPatterns: titlePatterns,
        filterTagsRegexPatterns: tagPatterns,
        onlyAlertOnLatest: alertOnLatest,
        desktopNotifications: desktopNotifications,
        abuseipdbAPIkey: abuseipdbAPIkey,
        vtkey: vtkey
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
        onlyAlertOnLatest: false,
        desktopNotifications: true,
        abuseipdbAPIkey: '',
        vtkey: ''
    }, (items) => {
        document.getElementById('removeFromQueue').checked = items.doRemoveFromFilteredFromQueue;
        document.getElementById('alertOnLatest').checked = items.onlyAlertOnLatest;
        document.getElementById('desktopNotifications').checked = items.desktopNotifications;
        items.filterTitleRegexPatterns.forEach(pattern => addPattern('titlePatterns', pattern));
        items.filterTagsRegexPatterns.forEach(pattern => addPattern('tagPatterns', pattern));
        document.getElementById('abuseipdbAPIkey').value = items.abuseipdbAPIkey;
        document.getElementById('vtkey').value = items.vtkey;
    });
}

document.addEventListener('DOMContentLoaded', restoreOptions);
document.getElementById('addTitlePattern').addEventListener('click', () => addPattern('titlePatterns'));
document.getElementById('addTagPattern').addEventListener('click', () => addPattern('tagPatterns'));
document.getElementById('save').addEventListener('click', () => saveOptions());
