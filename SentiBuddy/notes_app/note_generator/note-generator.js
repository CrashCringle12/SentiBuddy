// Get references to the DOM elements
const incidentNumberInput = document.getElementById('incidentNumber');
const templateSearchInput = document.getElementById('templateSearch');
const loadButton = document.getElementById('loadButton');
const templateContentTextarea = document.getElementById('templateContent');
const populateButton = document.getElementById('populateButton');
const populateLastAlertButton = document.getElementById('populateLastAlertButton');
const updateQueryButton = document.getElementById('updateQueryButton');
const kqlQueriesTextarea = document.getElementById('kqlQueries');
const saveButton = document.getElementById('saveButton');

let templateFiles = [];

// Function to fetch clients from chrome.storage.local
function fetchClients() {
    console.log('Fetching clients...');
    chrome.storage.local.get('clients', (result) => {
        const clients = result.clients || [];
        console.log('Received clients:', clients);
        const clientDropdown = document.getElementById('clientDropdown');
        clientDropdown.innerHTML = ''; // Clear existing options
        clients.forEach(client => {
            const option = document.createElement('option');
            option.value = client.name;
            option.textContent = client.name;
            option.dataset.projectCode = client.projectCode;
            clientDropdown.appendChild(option);
        });
    });
}

// Function to fetch the list of template files from Chrome storage
function fetchTemplateFiles() {
    chrome.storage.local.get('templates', function(data) {
        if (data.templates) {
            templateFiles = data.templates.map(template => template.name);
            autocomplete(templateSearchInput, templateFiles);
        }
    });
}

// Function to load the selected template from Chrome storage
function loadTemplateFile() {
    const selectedTemplateName = templateSearchInput.value;
    chrome.storage.local.get('templates', function(data) {
        if (data.templates) {
            const template = data.templates.find(t => t.name === selectedTemplateName);
            if (template) {
                const { variables, info, kqlQueries, contentWithoutKql } = extractVariables(template.content);
                templateContentTextarea.value = contentWithoutKql;
                document.getElementById('templateInfo').textContent = info;
                generateVariableForm(variables);
                kqlQueriesTextarea.value = kqlQueries.join('\n\n```\n```\n\n');
            } else {
                console.error('Template not found');
            }
        } else {
            console.error('No templates found in storage');
        }
    });
}


// Function to extract variables, information, and KQL queries from the template content
function extractVariables(templateContent) {
    // Extract content inside ##
    const infoRegex = /##(.*?)##/s;
    const infoMatch = templateContent.match(infoRegex);
    const info = infoMatch ? infoMatch[1].trim() : '';

    // Remove content inside ## from the template content
    const contentWithoutInfo = templateContent.replace(/##.*?##/s, '').trim();

    // Extract variables from the content without info
    const variableRegex = /\[\[(.*?)\]\]/g;
    const variables = [];
    let match;
    while ((match = variableRegex.exec(contentWithoutInfo)) !== null) {
        const variable = match[1].trim();
        if (!variables.includes(variable)) {
            variables.push(variable);
        }
    }

    // Extract KQL queries marked by ```
    const kqlRegex = /```(.*?)```/gs;
    const kqlQueries = [];
    let kqlMatch;
    while ((kqlMatch = kqlRegex.exec(templateContent)) !== null) {
        kqlQueries.push(kqlMatch[1].trim());
    }

    // Remove KQL queries from the template content
    const contentWithoutKql = contentWithoutInfo.replace(/```.*?```/gs, '').trim();

    return { variables, info, kqlQueries, contentWithoutKql };
}

// Function to generate the variable form
function generateVariableForm(variables) {
    const variableForm = document.getElementById('variableForm');
    variableForm.innerHTML = '';

    variables.forEach(variable => {
        const formGroup = document.createElement('div');
        formGroup.className = 'input-group';

        const label = document.createElement('label');
        label.textContent = variable;
        label.setAttribute('for', variable);

        if (variable.includes('/')) {
            const checkboxGroup = document.createElement('div');
            checkboxGroup.className = 'checkbox-group';

            variable.split('/').forEach(option => {
                const checkbox = document.createElement('input');
                checkbox.setAttribute('type', 'checkbox');
                checkbox.setAttribute('id', option);
                checkbox.setAttribute('name', variable);
                checkbox.setAttribute('value', option);

                const checkboxLabel = document.createElement('label');
                checkboxLabel.textContent = option;
                checkboxLabel.setAttribute('for', option);

                checkboxGroup.appendChild(checkbox);
                checkboxGroup.appendChild(checkboxLabel);
            });

            formGroup.appendChild(label);
            formGroup.appendChild(checkboxGroup);
        } else {
            const input = document.createElement('input');
            input.setAttribute('type', 'text');
            input.setAttribute('id', variable);

            formGroup.appendChild(label);
            formGroup.appendChild(input);
        }

        variableForm.appendChild(formGroup);
    });
}
// Function to populate the template with variables
function populateTemplate() {
    const templateContent = templateContentTextarea.value;
    let populatedTemplate = templateContent;
    let kqlQueriesUpdated = kqlQueriesTextarea.value;

    const variableForm = document.getElementById('variableForm');
    const inputs = variableForm.getElementsByTagName('input');

    for (let i = 0; i < inputs.length; i++) {
        const input = inputs[i];
        const variable = input.name || input.id;
        let value = '';

        if (input.type === 'checkbox') {
            const checkboxes = document.querySelectorAll(`input[name="${variable}"]:checked`);
            const checkedValues = Array.from(checkboxes).map(checkbox => checkbox.value);
            value = checkedValues.join('/');
        } else {
            value = input.value;
        }

        populatedTemplate = populatedTemplate.replace(new RegExp(`\\[\\[${variable}\\]\\]`, 'g'), value);
        kqlQueriesUpdated = kqlQueriesUpdated.replace(new RegExp(`\\[\\[${variable}\\]\\]`, 'g'), value);
    }

    // Remove blank lines from the populated template
    populatedTemplate = populatedTemplate.replace(/^\s*[\r\n]/gm, '');

    // Update the populatedTemplate textarea in the popup
    const popupTextarea = document.getElementById('populatedTemplate');
    popupTextarea.value = populatedTemplate + '\n```\n' + kqlQueriesUpdated + '\n```';

    // Show the popup
    const popup = document.getElementById('savePopup');
    popup.style.display = 'block';

    // Add click event listener to the close button
    const closeButton = document.querySelector('.close-button');
    closeButton.addEventListener('click', function() {
        clearFields();
        popup.style.display = 'none';
    });

    // Add click event listener outside the popup to close it
    window.addEventListener('click', function(event) {
        if (event.target == popup) {
            popup.style.display = 'none';
        }
    });

    kqlQueriesTextarea.value = kqlQueriesUpdated;
}

// Function to update the KQL queries with variables
function updateQuery() {
    let kqlQueriesUpdated = kqlQueriesTextarea.value;

    const variableForm = document.getElementById('variableForm');
    const inputs = variableForm.getElementsByTagName('input');

    for (let i = 0; i < inputs.length; i++) {
        const input = inputs[i];
        const variable = input.name || input.id;
        let value = '';

        if (input.type === 'checkbox') {
            if (input.checked) {
                value = input.value;
            }
        } else {
            value = input.value;
        }

        kqlQueriesUpdated = kqlQueriesUpdated.replace(new RegExp(`\\[\\[${variable}\\]\\]`, 'g'), value);
    }

    kqlQueriesTextarea.value = kqlQueriesUpdated;
}

// Function to apply HTML formatting
function applyHtmlFormatting(content) {
    let formattedContent = content;

    // Apply bold formatting
    formattedContent = formattedContent.replace(/\*\*(.*?)\*\*/g, '<p><strong>$1</strong></p>');

    // Apply code block formatting
    formattedContent = formattedContent.replace(/```([\s\S]*?)```/gs, function(match, code) {
        const codeWithoutEmptyLines = code.replace(/^\s*[\r\n]/gm, '');
        return '<pre><code>' + codeWithoutEmptyLines.replace(/\n/g, '<br>') + '</code></pre>';
    });

    const lines = formattedContent.split('\n');
    let insideCodeBlock = false;
    let insideBulletList = false;
    const formattedLines = [];

    for (const line of lines) {
        if (line.trim() === '') {
            continue;
        }

        if (line.startsWith('<pre><code>')) {
            insideCodeBlock = true;
            insideBulletList = false;
            formattedLines.push(line);
        } else if (line.startsWith('</pre></code>')) {
            insideCodeBlock = false;
            insideBulletList = false;
            formattedLines.push(line);
        } else if (!insideCodeBlock && !line.startsWith('<p><strong>')) {
            if (!insideBulletList) {
                insideBulletList = true;
                formattedLines.push('<ul>');
            }
            formattedLines.push(`<li>${line}</li>`);
        } else {
            if (insideBulletList) {
                formattedLines.push('</ul>');
                insideBulletList = false;
            }
            formattedLines.push(line);
        }
    }

    if (insideBulletList) {
        formattedLines.push('</ul>');
    }

    formattedContent = formattedLines.join('\n');

    return formattedContent;
}

// Function to save the populated template to Chrome storage
function saveNote() {
    const incidentNumber = incidentNumberInput.value;
    const populatedTemplate = document.getElementById('populatedTemplate').value;
    const clientDropdown = document.getElementById('clientDropdown');
    const client = clientDropdown.value;
    const projectCode = clientDropdown.options[clientDropdown.selectedIndex].dataset.projectCode;
    const timerData =   timerDisplay = document.getElementById('timerDisplay').value;
    console.log('Timer data being sent:', timerData); // Add this line
    const name = client +"-"+ incidentNumber

    chrome.storage.local.get(['templates'], function(result) {
        let templates = result.templates || [];

        // Update the existing template or add a new one
        const templateIndex = templates.findIndex(t => t.name === name);
        if (templateIndex > -1) {
            templates[templateIndex].content = populatedTemplate;
        } else {
            templates.push({ 
                name: name,
                template: templateSearchInput.value,
                client: client,
                isTemplate: false,
                number: incidentNumber, 
                content: populatedTemplate,
                timeSpent: timerData
            });
        }

        chrome.storage.local.set({ templates: templates }, function() {
            alert('Template saved successfully.');
            clearFields();
            const savePopup = document.getElementById('savePopup');
            savePopup.style.display = 'none';

            const formattedTemplate = applyHtmlFormatting(populatedTemplate);
            const formattedPopup = document.getElementById('formattedPopup');
            const formattedTemplateDiv = document.getElementById('formattedTemplate');
            formattedTemplateDiv.innerHTML = formattedTemplate;
            formattedPopup.style.display = 'block';

            const copyHtmlButton = document.createElement('button');
            copyHtmlButton.textContent = 'Copy as HTML';
            copyHtmlButton.addEventListener('click', function() {
                copyToClipboard(formattedTemplate);
            });
            formattedTemplateDiv.appendChild(copyHtmlButton);

            const copyPlaintextButton = document.createElement('button');
            copyPlaintextButton.textContent = 'Copy as Template';
            copyPlaintextButton.addEventListener('click', function() {
                copyToClipboard(populatedTemplate);
            });
            formattedTemplateDiv.appendChild(copyPlaintextButton);

            const closeButton = formattedPopup.querySelector('.close-button');
            closeButton.addEventListener('click', function() {
                formattedPopup.style.display = 'none';
            });
        });
    });
}

function copyToClipboard(text) {
    const tempContainer = document.createElement('div');
    tempContainer.innerHTML = text;
    document.body.appendChild(tempContainer);

    const range = document.createRange();
    range.selectNode(tempContainer);
    window.getSelection().removeAllRanges();
    window.getSelection().addRange(range);

    document.execCommand('copy');

    window.getSelection().removeAllRanges();
    document.body.removeChild(tempContainer);

    alert('Formatted template copied!');
}

function clearFields() {
    incidentNumberInput.value = '';
    templateSearchInput.value = '';
    templateContentTextarea.value = '';
    document.getElementById('templateInfo').textContent = '';
    document.getElementById('variableForm').innerHTML = '';
    kqlQueriesTextarea.value = '';
    document.getElementById('populatedTemplate').value = '';
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
window.addEventListener('DOMContentLoaded', fetchClients);
loadButton.addEventListener('click', loadTemplateFile);
populateButton.addEventListener('click', populateTemplate);
updateQueryButton.addEventListener('click', updateQuery);
saveButton.addEventListener('click', saveNote);
populateLastAlertButton.addEventListener('click', async () => {
    try {
        chrome.runtime.sendMessage({ hash: "", type: "getLastAlert" }, function(response) {
            console.log("Response Received")
            console.log(response)
        });
    } catch (error) {
        console.log('Failed to access clipboard.');
    }
});
// Fetch template files on page load
fetchTemplateFiles();


