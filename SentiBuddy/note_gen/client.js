function fetchClients() {
  console.log('Fetching clients...'); // Add this line
  chrome.storage.local.get('clients', (result) => {
      const clients = result.clients || [];
      console.log('Received clients:', clients); // Add this line
      const clientDropdown = document.getElementById('clientDropdown');
      clients.forEach(client => {
          const option = document.createElement('option');
          option.value = client[0];
          option.textContent = client[0];
          option.dataset.projectCode = client[1];
          clientDropdown.appendChild(option);
      });
  });
}

window.addEventListener('DOMContentLoaded', fetchClients);
