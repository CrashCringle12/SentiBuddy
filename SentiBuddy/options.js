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

function checkExperiments() {
    chrome.storage.local.get(['toggleExperiments'], function(result) {
        const toggleExperiments = result.toggleExperiments || false;
        
        // Show or hide Note-Taking options based on toggleExperiments
        const noteTakingTabButton = document.getElementById('noteTakingOptionsTab');
        const noteTakingOptionsContent = document.getElementById('NoteTakingOptions');
        
        if (toggleExperiments) {
            noteTakingTabButton.style.display = 'inline-block';
            noteTakingOptionsContent.style.display = 'none'; // Hide by default until tab is clicked
        } else {
            noteTakingTabButton.style.display = 'none'; // Hide the Note-Taking options tab if experiments are off
            const tabcontent = document.getElementsByClassName("tabcontent");
            for (let i = 0; i < tabcontent.length; i++) {
                tabcontent[i].style.display = "none";
            }
            const tablinks = document.getElementsByClassName("tablinks");
            for (let i = 0; i < tablinks.length; i++) {
                tablinks[i].className = tablinks[i].className.replace(" active", "");
            }
            document.getElementById("GeneralOptions").style.display = "block";
        }
    });
}


function clickToggleExperiments() {
    const checked = document.getElementById('toggleExperiments').checked;
    console.log(checked)
    if (checked) {
        document.getElementById('noteTakingOptionsTab').style.display = 'inline-block';
        document.getElementById('NoteTakingOptions').style.display = 'none'; // Hide by default until tab is clicked
    } else {
        document.getElementById('noteTakingOptionsTab').style.display = 'none'; // Hide the Note-Taking options tab if experiments are off
    }
}
// Note-Taking Options Functions
function saveNoteTakingOptions() {
    const incidentPrefix = document.getElementById('incidentPrefix').value.trim();
    const defaultTemplate = document.getElementById('defaultTemplate').value.trim();
    const clientsList = document.getElementById('clientsList');
    const clients = [];
    const inputs = clientsList.getElementsByTagName('input');

    for (let i = 0; i < inputs.length; i += 2) {
        const name = inputs[i].value.trim();
        if (name) {
            clients.push({ name });
        }
    }

    chrome.storage.local.set({
        incidentPrefix: incidentPrefix,
        defaultTemplate: defaultTemplate,
        clients: clients
    }, () => {
        const status = document.getElementById('statusNoteTaking');
        status.textContent = 'Note-Taking options saved.';
        setTimeout(() => {
            status.textContent = '';
        }, 750);
    });
}

// function restoreNoteTakingOptions() {
//     chrome.storage.local.get(['incidentPrefix', 'defaultTemplate', 'clients'], (items) => {
//         document.getElementById('incidentPrefix').value = items.incidentPrefix || '';
//         document.getElementById('defaultTemplate').value = items.defaultTemplate || '';
//         const clients = items.clients || [];
//         clients.forEach(client => addClient(client.name, client.projectCode));
//     });
// }
function restoreNoteTakingOptions() {
        chrome.storage.local.get(['incidentPrefix', 'defaultTemplate', 'clients'], (items) => {
            document.getElementById('incidentPrefix').value = items.incidentPrefix || '';
            document.getElementById('defaultTemplate').value = items.defaultTemplate || '';
            const clients = items.clients || [];
            clients.forEach(client => addClient(client.name));
        });
}

// Client Options Functions
function addClient(name = '') {
    const clientsList = document.getElementById('clientsList');
    const div = document.createElement('div');

    const nameInput = document.createElement('input');
    nameInput.type = 'text';
    nameInput.placeholder = 'Client Name';
    nameInput.value = name;
    div.appendChild(nameInput);

    // const projectCodeInput = document.createElement('input');
    // projectCodeInput.type = 'text';
    // projectCodeInput.placeholder = 'Project Code';
    // projectCodeInput.value = projectCode;
    // div.appendChild(projectCodeInput);

    const removeBtn = document.createElement('button');
    removeBtn.textContent = 'Remove';
    removeBtn.type = 'button';
    removeBtn.onclick = function() {
        clientsList.removeChild(div);
    };
    div.appendChild(removeBtn);

    clientsList.appendChild(div);
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
        scamalyticsURL: ''
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
        abuseipdbAPIkey: '',
        vtkey: '',
        ipInfoKey: '',
        scamalyticsURL: ''
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

// Export and Import Note-Taking Data Functions
function exportNoteTakingData() {
    chrome.storage.local.get(['incidentPrefix', 'defaultTemplate', 'clients', 'templates'], (items) => {
        const jsonData = JSON.stringify(items, null, 4);
        const blob = new Blob([jsonData], { type: "application/json" });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = "note_taking_data.json";
        a.click();
        URL.revokeObjectURL(url);
    });
}

function exportTemplates() {
    initializeDB().then(() => {
        const transaction = db.transaction(['templates'], 'readonly');
        const templateStore = transaction.objectStore('templates');
        const request = templateStore.getAll();

        request.onsuccess = function (event) {
            const templates = event.target.result;
            const jsonData = JSON.stringify(templates, null, 4);
            const blob = new Blob([jsonData], { type: "application/json" });
            const url = URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            a.download = "templates.json";
            a.click();
            URL.revokeObjectURL(url);
        };

        request.onerror = function (event) {
            console.error('Error exporting templates:', event.target.errorCode);
        };
    });
}

function importTemplates(event) {
    const file = event.target.files[0];
    if (!file) {
        return;
    }

    const reader = new FileReader();
    reader.onload = function(event) {
        try {
            const importedTemplates = JSON.parse(event.target.result);
            if (Array.isArray(importedTemplates)) {
                initializeDB().then(() => {
                    const transaction = db.transaction(['templates'], 'readwrite');
                    const templateStore = transaction.objectStore('templates');

                    importedTemplates.forEach(template => {
                        const getRequest = templateStore.get(template.name);

                        getRequest.onsuccess = function(event) {
                            const existingTemplate = event.target.result;
                            if (!existingTemplate) {
                                // Add new template
                                templateStore.add(template);
                            } else {
                                // Update existing template
                                templateStore.put(template);
                            }
                        };

                        getRequest.onerror = function(event) {
                            console.error('Error fetching template for import:', event.target.errorCode);
                        };
                    });

                    transaction.oncomplete = function () {
                        console.log('Templates imported successfully');
                    };

                    transaction.onerror = function (event) {
                        console.error('Error importing templates:', event.target.errorCode);
                    };
                });
            }
        } catch (e) {
            console.error('Failed to parse templates file:', e);
        }
    };
    reader.readAsText(file);
}


function importNoteTakingData(event) {
    const file = event.target.files[0];
    if (!file) {
        return;
    }

    const reader = new FileReader();
    reader.onload = function(event) {
        try {
            const jsonObj = JSON.parse(event.target.result);

            // Save imported data to local storage
            chrome.storage.local.set(jsonObj, () => {
                console.log('Note-taking data imported successfully');
                restoreNoteTakingOptions(); // Refresh the UI to reflect the imported data
            });
        } catch (e) {
            console.error('Failed to parse note-taking data file:', e);
        }
    };
    reader.readAsText(file);
}

function createImportFileInput() {
    const fileInput = document.createElement('input');
    fileInput.type = 'file';
    fileInput.addEventListener('change', importNoteTakingData);
    fileInput.click();
}


// Restore options on DOMContentLoaded
document.addEventListener('DOMContentLoaded', (event) => {
    checkExperiments(); // Check if experimental features are enabled

    document.getElementById("generalOptionsTab").addEventListener('click', (evt) => openTab(evt, 'GeneralOptions'));
    document.getElementById("noteTakingOptionsTab").addEventListener('click', (evt) => openTab(evt, 'NoteTakingOptions'));
    restoreOptions();
    restoreNoteTakingOptions();
});

// Event listeners for general options
document.getElementById('addTitlePattern').addEventListener('click', () => addPattern('titlePatterns'));
document.getElementById('addTagPattern').addEventListener('click', () => addPattern('tagPatterns'));
document.getElementById('addOwnerPattern').addEventListener('click', () => addPattern('ownerPatterns'));
document.getElementById('save').addEventListener('click', saveOptions);
document.getElementById('export').addEventListener('click', exportOptions);
document.getElementById('import').addEventListener('click', createFileInput);

// Event listeners for note-taking options
document.getElementById('saveNoteTaking').addEventListener('click', saveNoteTakingOptions);
document.getElementById('exportNoteTaking').addEventListener('click', exportNoteTakingData);
document.getElementById('importNoteTaking').addEventListener('click', createImportFileInput);

// Event listeners for client options
document.getElementById('addClient').addEventListener('click', () => addClient());

document.getElementById('toggleExperiments').addEventListener('click', clickToggleExperiments);