// Global variables
const notificationTab = {};
let queueActive = false;
const maxAgeInDays = 90;
const verbose = true;

// API keys (initialized as empty strings)
let abuseipdbAPIkey = '';
let VTkey = '';
let scamalyticsURL = '';
let ipInfoKey = '';

// Function to load API keys from storage
function loadKeys() {
  return new Promise((resolve) => {
    chrome.storage.local.get({
      abuseipdbAPIkey: '',
      vtkey: '',
      scamalyticsURL: '',
      ipInfoKey: ''
    }, (items) => {
      abuseipdbAPIkey = items.abuseipdbAPIkey;
      VTkey = items.vtkey;
      scamalyticsURL = items.scamalyticsURL;
      ipInfoKey = items.ipInfoKey;
      resolve();
    });
  });
}

// API request handlers
async function handleAPIRequests(request, sendResponse) {
  await loadKeys();
  const relevantResponse = { abuseIPDB: {}, IPInfo: {}, Scamalytics: {}, ip: true };

  // Prepare promises for all API requests
  const abuseIPDBPromise = abuseipdbAPIkey
    ? fetchAbuseIPDB(request.ip, abuseipdbAPIkey)
    : Promise.resolve({ error: "No AbuseIPDB ApiKey provided. Please provide a key in the configuration's menu via ALT+C" });
  const ipInfoPromise = ipInfoKey
    ? fetchIpInfo(request.ip, ipInfoKey)
    : Promise.resolve({ error: "No IpInfo APIKey provided. Please provide a key in the configuration's menu via ALT+C" });
  const ScamalyticsPromise = scamalyticsURL
    ? fetchScamalytics(request.ip, scamalyticsURL)
    : Promise.resolve({ error: "No Scamalytics URL provided. Please provide a URL in the configuration's menu via ALT+C" });

  try {
    // Execute all API requests in parallel
    const [abuseIPDBData, ipInfoData, scamalyticsData] = await Promise.all([abuseIPDBPromise, ipInfoPromise, ScamalyticsPromise]);
    relevantResponse.abuseIPDB = abuseIPDBData.data;
    relevantResponse.IPInfo = ipInfoData;
    relevantResponse.Scamalytics = scamalyticsData;
    sendResponse(relevantResponse);
  } catch (error) {
    sendResponse({ error: error.toString() });
  }
}

async function handleHashAPIRequests(request, sendResponse) {
  await loadKeys();
  const relevantResponse = { VT: {}, ip: false };

  // Prepare promise for VirusTotal API request
  const VirusTotalPromise = VTkey
    ? fetchVirusTotalHash(request.hash, VTkey)
    : Promise.resolve({ error: "No VirusTotal API Key provided. Please provide a URL in the configuration's menu via ALT+C" });

  try {
    const [virusTotalData] = await Promise.all([VirusTotalPromise]);
    relevantResponse.VT = virusTotalData;
    sendResponse(relevantResponse);
  } catch (error) {
    sendResponse({ error: error.toString() });
  }
}

// API fetch functions
function fetchAbuseIPDB(ip, apiKey) {
  const headers = new Headers({
    'Key': apiKey,
    'Accept': 'application/json'
  });
  const queryParams = new URLSearchParams({ ipAddress: ip, maxAgeInDays: maxAgeInDays, verbose: verbose });
  const url = `https://api.abuseipdb.com/api/v2/check?${queryParams}`;
  return fetch(url, { headers: headers })
    .then(response => response.json());
}

function fetchIpInfo(ip, token) {
  const url = `https://ipinfo.io/${ip}?token=${token}`;
  return fetch(url)
    .then(response => response.json());
}

function fetchScamalytics(ip, apiURL) {
  const headers = new Headers({
    'Accept': 'application/json'
  });
  const url = `${apiURL}&ip=${ip}`;
  return fetch(url, { headers: headers })
    .then(response => response.json());
}

function fetchVirusTotalHash(hash, VTkey) {
  const options = {
    method: 'GET',
    headers: {
      accept: 'application/json',
      'x-apikey': VTkey
    }
  };
  return fetch(`https://www.virustotal.com/api/v3/files/${hash}`, options)
    .then(response => response.json());
}

function getSentiBuddyIconUrl() {
  return chrome.runtime.getURL('icon.png'); // Make sure 'icon.png' is the correct filename for your SentiBuddy icon
}

// Message listener
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  console.log('Received message in background:', request);

  switch (request.type) {
    case 'search-ip':
      handleAPIRequests(request, sendResponse);
      return true;
    case 'search-hash':
      handleHashAPIRequests(request, sendResponse);
      return true;
    case 'get-queue-state':
      sendResponse({ active: queueActive });
      break;
    case 'set-notifications':
      console.log('Handling set-notifications message');
      if (request.enabled) {
        chrome.notifications.create({
          type: 'basic',
          iconUrl: getSentiBuddyIconUrl(),
          title: 'Notifications Enabled',
          message: 'Notifications have been turned on.'
        }, (notificationId) => {
          console.log('Notification created with ID:', notificationId);
          sendResponse({ success: true });
        });
      } else {
        chrome.notifications.create({
          type: 'basic',
          iconUrl: getSentiBuddyIconUrl(),
          title: 'Notifications Disabled',
          message: 'Notifications have been turned off.'
        }, (notificationId) => {
          console.log('Notification created with ID:', notificationId);
          sendResponse({ success: true });
        });
      }
      return true;

    case 'notification':
      console.log(request.info);
      chrome.storage.local.get({ desktopNotifications: false }, (items) => {
        if (items.desktopNotifications) {
          const notId = 'notification' + Math.random();
          notificationTab[notId] = sender.tab.id;
          chrome.notifications.create(notId, {
            type: 'basic',
            iconUrl: getSentiBuddyIconUrl(),
            title: `${request.info.eventType} ${request.info.severity} ${request.info.client} Incident w/ ${request.info.numAlerts} Alert(s)`,
            message: `INC: ${request.info.incID} - ${request.info.title}`,
          });
        }
      });
      break;
    case 'contentScriptReady':
      contentScriptReady = true;
      break;
    default:
      console.log('Unhandled message type:', request.type);
  }
});

// Notification click listener
chrome.notifications.onClicked.addListener(function callback(notificationId) {
  var updateProperties = { 'active': true };
  chrome.tabs.update(notificationTab[notificationId], updateProperties);
  chrome.notifications.clear(notificationId);
  window.focus();
});

// Set desktop notifications to off on install or update
chrome.runtime.onInstalled.addListener((details) => {
  if (details.reason === 'install' || details.reason === 'update') {
    chrome.storage.local.set({ desktopNotifications: false }, () => {
      console.log('Notification settings initialized to off');
    });
  }
});

// Content script ready flag
let contentScriptReady = false;

// Command listeners
chrome.commands.onCommand.addListener((command) => {
  console.log('Command received:', command);
  if (command === "open-config") {
    console.log('Opening config...');
    if (contentScriptReady) {
      chrome.tabs.query({ active: true, currentWindow: true }, function (tabs) {
        if (tabs[0]) {
          chrome.tabs.sendMessage(tabs[0].id, { action: "openConfig" }, function (response) {
            if (chrome.runtime.lastError) {
              console.log("Error sending message:", chrome.runtime.lastError.message);
              chrome.runtime.openOptionsPage();
            }
          });
        } else {
          console.log("No active tab found");
          chrome.runtime.openOptionsPage();
        }
      });
    } else {
      console.log("Content script not ready, opening options page directly");
      chrome.runtime.openOptionsPage();
    }
  } else if (command === "toggle-queue-filtering") {
    console.log('Toggling queue filtering...');
    chrome.tabs.query({ active: true, currentWindow: true }, function (tabs) {
      if (tabs[0]) {
        chrome.tabs.sendMessage(tabs[0].id, { type: "toggle-queue-filtering" }, function (response) {
          if (chrome.runtime.lastError) {
            console.log("Error sending message:", chrome.runtime.lastError.message);
          } else {
            console.log("Toggle message sent successfully");
            queueActive = !queueActive;
          }
        });
      } else {
        console.log("No active tab found");
      }
    });
  }
});

// Debugging
chrome.commands.getAll((commands) => {
  console.log('Registered commands:', commands);
});

console.log('Service worker initialized');