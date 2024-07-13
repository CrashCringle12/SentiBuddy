function addClient(name = '', projectCode = '') {
    const clientsList = document.getElementById('clientsList');
    const div = document.createElement('div');

    const nameInput = document.createElement('input');
    nameInput.type = 'text';
    nameInput.placeholder = 'Client Name';
    nameInput.value = name;
    div.appendChild(nameInput);

    const projectCodeInput = document.createElement('input');
    projectCodeInput.type = 'text';
    projectCodeInput.placeholder = 'Project Code';
    projectCodeInput.value = projectCode;
    div.appendChild(projectCodeInput);

    const removeBtn = document.createElement('button');
    removeBtn.textContent = 'Remove';
    removeBtn.type = 'button';
    removeBtn.onclick = function() {
        clientsList.removeChild(div);
    };
    div.appendChild(removeBtn);

    clientsList.appendChild(div);
}

function saveClients() {
    const clientsList = document.getElementById('clientsList');
    const clients = [];
    const inputs = clientsList.getElementsByTagName('input');

    for (let i = 0; i < inputs.length; i += 2) {
        const name = inputs[i].value.trim();
        const projectCode = inputs[i + 1].value.trim();
        if (name && projectCode) {
            clients.push([name, projectCode]);
        }
    }

    chrome.storage.local.set({ clients: clients }, function() {
        const status = document.getElementById('status');
        status.textContent = 'Clients saved.';
        setTimeout(() => {
            status.textContent = '';
        }, 750);
    });
}

function restoreClients() {
    chrome.storage.local.get('clients', function(result) {
        const clients = result.clients || [];
        clients.forEach(client => addClient(client[0], client[1]));
    });
}

document.addEventListener('DOMContentLoaded', restoreClients);
document.getElementById('addClient').addEventListener('click', () => addClient());
document.getElementById('save').addEventListener('click', saveClients);
