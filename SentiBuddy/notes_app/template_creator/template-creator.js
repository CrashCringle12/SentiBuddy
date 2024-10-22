// Get references to the DOM elements
const templateSearch = document.getElementById('templateSearch');
const loadTemplateBtn = document.getElementById('loadTemplateBtn');
const defaultTemplateBtn = document.getElementById('defaultTemplateBtn');
const insertVariableBtn = document.getElementById('insertVariableBtn');
const insertQueryBtn = document.getElementById('insertQueryBtn');
const templateContent = document.getElementById('templateContent');
const saveTemplateBtn = document.getElementById('saveTemplateBtn');

let templateFiles = [];
let db;

function initializeDB() {
    return new Promise((resolve, reject) => {
        if (db) {
            return resolve(db); // If db is already initialized, return it
        }

        const request = indexedDB.open('TemplatesDB', 1);

        request.onerror = function(event) {
            console.error('Error opening IndexedDB:', event.target.errorCode);
            reject(event.target.errorCode);
        };

        request.onsuccess = function(event) {
            db = event.target.result;
            console.log('Database initialized');
            resolve(db);
        };

        request.onupgradeneeded = function(event) {
            const db = event.target.result;
            if (!db.objectStoreNames.contains('templates')) {
                const objectStore = db.createObjectStore('templates', { keyPath: 'name' });
                objectStore.createIndex('name', 'name', { unique: true });
            }
        };
    });
}

// Function to fetch the list of template files
// function fetchTemplateFiles() {
//     chrome.storage.local.get('templates', function(data) {
//         if (data.templates) {
//             templateFiles = data.templates.map(template => template.name);
//             autocomplete(templateSearch, templateFiles);
//         } else {
//             console.error('No templates found in storage');
//         }
//     });
// }

// Function to fetch the list of template files from IndexedDB
function fetchTemplateFiles() {
    const transaction = db.transaction(['templates'], 'readonly');
    const templateStore = transaction.objectStore('templates');
    const request = templateStore.getAll();

    request.onsuccess = function(event) {
        const templates = event.target.result;
        if (templates.length) {
            templateFiles = templates.map(template => template.name);
            autocomplete(templateSearch, templateFiles);  // Assuming `autocomplete` is a function for input
        } else {
            console.error('No templates found in IndexedDB');
        }
    };

    request.onerror = function(event) {
        console.error('Error fetching templates:', event.target.errorCode);
    };
}


// Function to load the selected template
// function loadTemplate() {
//     const selectedFile = templateSearch.value;
//     chrome.storage.local.get('templates', function(data) {
//         const template = data.templates.find(t => t.name === selectedFile);
//         if (template) {
//             templateContent.value = template.content;
//         } else {
//             console.error('Template not found');
//         }
//     });
// }
// Function to load the selected template from IndexedDB
function loadTemplate() {
    const selectedFile = templateSearch.value;

    const transaction = db.transaction(['templates'], 'readonly');
    const templateStore = transaction.objectStore('templates');
    const request = templateStore.index('name').get(selectedFile);

    request.onsuccess = function(event) {
        const template = event.target.result;
        if (template) {
            templateContent.value = template.content;
        } else {
            console.error('Template not found in IndexedDB');
        }
    };

    request.onerror = function(event) {
        console.error('Error loading template:', event.target.errorCode);
    };
}


// Function to load the default template
// function loadDefaultTemplate() {
//     chrome.storage.local.get('defaultTemplate', function(data) {
//         if (data.defaultTemplate) {
//             templateContent.value = data.defaultTemplate;
//         } else {
//             console.error('Default template not found');
//         }
//     });
// }
// Function to load the default template from IndexedDB
function loadDefaultTemplate() {
    const transaction = db.transaction(['templates'], 'readonly');
    const templateStore = transaction.objectStore('templates');
    const request = templateStore.index('name').get('defaultTemplate');

    request.onsuccess = function(event) {
        const defaultTemplate = event.target.result;
        if (defaultTemplate) {
            templateContent.value = defaultTemplate.content;
        } else {
            console.error('Default template not found in IndexedDB');
        }
    };

    request.onerror = function(event) {
        console.error('Error loading default template:', event.target.errorCode);
    };
}

// Function to insert a variable into the template
function insertVariable() {
    const variableName = prompt('Enter the variable name:');
    if (variableName) {
        const variable = `[[${variableName}]]`;
        insertText(variable);
    }
}

// Function to insert a query into the template
function insertQuery() {
    const query = prompt('Enter the query:');
    if (query) {
        const formattedQuery = `\`\`\`${query}\`\`\``;
        insertText(formattedQuery);
    }
}

// Function to insert text at the current cursor position
function insertText(text) {
    const startPos = templateContent.selectionStart;
    const endPos = templateContent.selectionEnd;
    const currentContent = templateContent.value;
    const newContent = currentContent.substring(0, startPos) + text + currentContent.substring(endPos);
    templateContent.value = newContent;
    templateContent.selectionStart = templateContent.selectionEnd = startPos + text.length;
    templateContent.focus();
}

// Function to save the template
// function saveTemplate() {
//     const content = templateContent.value;
//     const fileName = templateSearch.value || prompt('Enter the file name:');
//     if (fileName) {
//         chrome.storage.local.get('templates', function(data) {
//             let templates = data.templates || [];
//             const templateIndex = templates.findIndex(t => t.name === fileName);
//             if (templateIndex > -1) {
//                 templates[templateIndex].content = content;
//             } else {
//                 templates.push({ 
//                     name: fileName,
//                     // This is for the future
//                     isTemplate: true,
//                     template: fileName,
//                     client: "TEMPLATE",
//                     number: null, 
//                     content: content,
//                     timeSpent: null
//                 });
//             }
//             chrome.storage.local.set({ templates: templates }, function() {
//                 alert('Template saved successfully!');
//             });
//         });
//     }
// }

// Function to save the template to IndexedDB
function saveTemplate() {
    initializeDB().then(() => {
        const content = templateContent.value;
        const fileName = templateSearch.value || prompt('Enter the file name:');
        if (fileName) {
            const transaction = db.transaction(['templates'], 'readwrite');
            const templateStore = transaction.objectStore('templates');
            
            // Retrieve the template to check if it exists
            const request = templateStore.index('name').get(fileName);

            request.onsuccess = function(event) {
                let templates = event.target.result || [];

                // const templateIndex = templates.findIndex(t => t.name === fileName);
                // if (templateIndex > -1) {
                //     templates[templateIndex].content = content;
                // } else {
                //     templates.push({ 
                //         name: fileName,
                //         isTemplate: true,
                //         template: fileName,
                //         client: "TEMPLATE",
                //         number: null, 
                //         content: content,
                //         timeSpent: null
                //     });
                // }
                const saveRequest = templateStore.put({ 
                    name: fileName,
                    isTemplate: true,
                    template: fileName,
                    client: "TEMPLATE",
                    number: null, 
                    content: content,
                    timeSpent: null
                });
                saveRequest.onsuccess = function() {
                    alert('Template saved successfully!');
                };

                saveRequest.onerror = function(event) {
                    console.error('Error saving template:', event.target.errorCode);
                };
            };

            request.onerror = function(event) {
                console.error('Error retrieving template:', event.target.errorCode);
            };
        }
    });
}


// Function to create autocomplete functionality
function autocomplete(input, options) {
    let currentFocus;

    input.addEventListener('input', function(e) {
        const val = this.value;
        closeAllLists();
        if (!val) return false;
        currentFocus = -1;

        const list = document.createElement('div');
        list.setAttribute('id', this.id + 'autocomplete-list');
        list.setAttribute('class', 'autocomplete-items');
        this.parentNode.appendChild(list);

        for (let i = 0; i < options.length; i++) {
            if (options[i].toUpperCase().includes(val.toUpperCase())) {
                const item = document.createElement('div');
                const startIndex = options[i].toUpperCase().indexOf(val.toUpperCase());
                const endIndex = startIndex + val.length;
                item.innerHTML = options[i].slice(0, startIndex);
                item.innerHTML += '<strong>' + options[i].slice(startIndex, endIndex) + '</strong>';
                item.innerHTML += options[i].slice(endIndex);
                item.innerHTML += "<input type='hidden' value='" + options[i] + "'>";
                item.addEventListener('click', function(e) {
                    input.value = this.getElementsByTagName('input')[0].value;
                    closeAllLists();
                });
                list.appendChild(item);
            }
        }
    });

    input.addEventListener('keydown', function(e) {
        let x = document.getElementById(this.id + 'autocomplete-list');
        if (x) x = x.getElementsByTagName('div');
        if (e.keyCode === 40) {
            currentFocus++;
            addActive(x);
        } else if (e.keyCode === 38) {
            currentFocus--;
            addActive(x);
        } else if (e.keyCode === 13) {
            e.preventDefault();
            if (currentFocus > -1) {
                if (x) x[currentFocus].click();
            }
        }
    });

    function addActive(x) {
        if (!x) return false;
        removeActive(x);
        if (currentFocus >= x.length) currentFocus = 0;
        if (currentFocus < 0) currentFocus = (x.length - 1);
        x[currentFocus].classList.add('autocomplete-active');
    }

    function removeActive(x) {
        for (let i = 0; i < x.length; i++) {
            x[i].classList.remove('autocomplete-active');
        }
    }

    function closeAllLists(elmnt) {
        const x = document.getElementsByClassName('autocomplete-items');
        for (let i = 0; i < x.length; i++) {
            if (elmnt !== x[i] && elmnt !== input) {
                x[i].parentNode.removeChild(x[i]);
            }
        }
    }

    document.addEventListener('click', function(e) {
        closeAllLists(e.target);
    });
}

// Event listeners
loadTemplateBtn.addEventListener('click', loadTemplate);
defaultTemplateBtn.addEventListener('click', loadDefaultTemplate);
insertVariableBtn.addEventListener('click', insertVariable);
insertQueryBtn.addEventListener('click', insertQuery);
saveTemplateBtn.addEventListener('click', saveTemplate);

// Fetch template files on page load
// Make sure to call this function before any DB operations
initializeDB().then(() => {
    fetchTemplateFiles();
});

