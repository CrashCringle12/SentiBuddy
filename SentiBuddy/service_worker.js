const notificationTab = {};
let queueActive = false;
// Holds data from last active incident in Sentinel
let lastAlertData = {};
const maxAgeInDays = 90;
const verbose = true;  // This is a flag, typically set to get detailed responses
// Set the API key
var abuseipdbAPIkey = '';
var VTkey = '';
var scamalyticsURL = '';
var ipInfoKey = '';
function loadKeys() {
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

  });
}
loadKeys();
function getSentiBuddyIconUrl() {
  return chrome.runtime.getURL('icon.png'); // Make sure 'icon.png' is the correct filename for your SentiBuddy icon
}

async function handleAPIRequests(request, sendResponse) {
  // Load API keys (ensure this function is async or handles promises correctly)
  await loadKeys();

  const relevantResponse = { abuseIPDB: {}, IPInfo: {}, Scamalytics: {}, ip: true };

  // Prepare promises for both requests
  const abuseIPDBPromise = abuseipdbAPIkey
    ? fetchAbuseIPDB(request.ip, abuseipdbAPIkey)
    : Promise.resolve({ error: "No AbuseIPDB ApiKey provided. Please provide a key in the configuration's menu via ALT+C" });

  const ipInfoPromise = ipInfoKey
    ? fetchIpInfo(request.ip, ipInfoKey)
    : Promise.resolve({ error: "No IpInfo APIKey provided. Please provide a key in the configuration's menu via ALT+C" });

  const ScamalyticsPromise = scamalyticsURL
    ? fetchScamalytics(request.ip, scamalyticsURL)
    : Promise.resolve({ error: "No Scamalytics URL provided. Please provide a URL in the configuration's menu via ALT+C" });

  // Execute both requests in parallel and wait for both to complete
  try {
    const [abuseIPDBData, ipInfoData, scamalyticsData] = await Promise.all([abuseIPDBPromise, ipInfoPromise, ScamalyticsPromise]);
    relevantResponse.abuseIPDB = abuseIPDBData.data;
    relevantResponse.IPInfo = ipInfoData;
    relevantResponse.Scamalytics = scamalyticsData

    sendResponse(relevantResponse);
  } catch (error) {
    sendResponse({ error: error.toString() });
  }
}

async function handleHashAPIRequests(request, sendResponse) {
  // Load API keys (ensure this function is async or handles promises correctly)
  await loadKeys();

  const relevantResponse = { VT: {}, ip: false };

  // Prepare promises for VT request
  const VirusTotalPromise = VTkey
    ? fetchVirusTotalHash(request.hash, VTkey)
    : Promise.resolve({ error: "No VirusTotal API Key provided. Please provide a URL in the configuration's menu via ALT+C" });

  // Execute both requests in parallel and wait for both to complete
  try {
    const [virusTotalData] = await Promise.all([VirusTotalPromise]);
    relevantResponse.VT = virusTotalData

    sendResponse(relevantResponse);
  } catch (error) {
    sendResponse({ error: error.toString() });
  }
}
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

function fetchVirusTotalIP(ip, VTkey) {
  const options = {
    method: 'GET',
    headers: {
      accept: 'application/json',
      'x-apikey': VTkey
    }
  };

  fetch(`https://www.virustotal.com/api/v3/ip_addresses/${ip}`, options)
    .then(response => response.json())
    .then(data => {
      sendResponse({ VT: data });  // Send VT data as additional response
    })
    .catch(err => {
      console.error("VirusTotal API error:", err);
      sendResponse({ error: err.toString() });
    });
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

chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {

  switch(request.type) {
    case 'search-ip':
      handleAPIRequests(request, sendResponse).then(() => {
        //fetchVirusTotal(request, sendResponse); // Moved VirusTotal logic into a function
      }).catch(error => {
        sendResponse({ error: error.toString() });
      });
      return true;  // Must return true when async response is expected
    case 'search-hash':
      handleHashAPIRequests(request, sendResponse).then(() => {
        //fetchVirusTotal(request, sendResponse); // Moved VirusTotal logic into a function
      }).catch(error => {
        sendResponse({ error: error.toString() });
      });
      return true;  // Must return true when async response is expected
    case 'get-queue-state':
      sendResponse({ active: queueActive });
      return true;
    case 'set-queue-state':
        queueActive = request.active
        return true;
    case 'set-notifications':
      console.log('Handling set-notifications message');
    // Update the configuration in storage
      chrome.storage.local.set({ desktopNotifications: request.enabled }, () => {
        console.log('Notification settings updated: ' + request.enabled);
      });
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
    case 'set-lastAlertData':
      lastAlertData = request.info;
      break;
    case 'lastAlertData':
      sendResponse({data: lastAlertData});
      break;
    case 'toggle-queue-filtering':
      queueActive = !queueActive;
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
      sendResponse({ active: queueActive });
      break; 
    default:
      console.log(request)
      console.log('Unhandled message type:', request.type);
  }
  
});


function faviconURL(u) {
  const url = new URL(chrome.runtime.getURL("/_favicon/"));
  url.searchParams.set("pageUrl", u);
  url.searchParams.set("size", "32");
  return url.toString();
}


chrome.commands.onCommand.addListener(function (command) {
  switch (command) {
    case 'open-config':
        if (chrome.runtime.openOptionsPage) {
          chrome.runtime.openOptionsPage();
        } else {
          window.open(chrome.runtime.getURL('options.html'));
        }
      break;
    case 'toggle-queue-filtering':
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
      break;  
  }
});

// Set desktop notifications to off on install or update
chrome.runtime.onInstalled.addListener((details) => {
  if (details.reason === 'install') {
    chrome.storage.local.set({ desktopNotifications: false }, () => {
      console.log('Notification settings initialized to off');
    });
  }
});

chrome.notifications.onClicked.addListener(function callback(notificationId) {
  var updateProperties = { 'active': true };
  chrome.tabs.update(notificationTab[notificationId], updateProperties);
  chrome.notifications.clear(notificationId);
  window.focus();
});