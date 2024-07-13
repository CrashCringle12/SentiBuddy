const notificationTab = {};
let queueActive = false;

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
  if (request.type === 'search-ip') {
    handleAPIRequests(request, sendResponse).then(() => {
      //fetchVirusTotal(request, sendResponse); // Moved VirusTotal logic into a function
    }).catch(error => {
      sendResponse({ error: error.toString() });
    });
    return true;  // Must return true when async response is expected
  } else if (request.type === 'search-hash') {
    handleHashAPIRequests(request, sendResponse).then(() => {
      //fetchVirusTotal(request, sendResponse); // Moved VirusTotal logic into a function
    }).catch(error => {
      sendResponse({ error: error.toString() });
    });
    return true;  // Must return true when async response is expected
  } else  if (request.type === 'get-queue-state') {
    sendResponse({ active: queueActive });
  } else if (request.type === 'toggle-queue-filtering') {
    queueActive = !queueActive;
    if (queueActive) {
        browser.tabs.query({ active: true, currentWindow: true }, (tabs) => {
            browser.tabs.sendMessage(tabs[0].id, { type: 'start-queue-filtering' });
        });
    } else {
        browser.tabs.query({ active: true, currentWindow: true }, (tabs) => {
            browser.tabs.sendMessage(tabs[0].id, { type: 'stop-queue-filtering' });
        });
    }
    sendResponse({ active: queueActive });
  }else {
    console.log(request.type)
  }
});


function faviconURL(u) {
  const url = new URL(chrome.runtime.getURL("/_favicon/"));
  url.searchParams.set("pageUrl", u);
  url.searchParams.set("size", "32");
  return url.toString();
}

chrome.runtime.onMessage.addListener(function (request, sender) {
  console.log(sender)
  if (request.type == 'notification') {
    console.log(request.info)
    const notId = 'notification' + Math.random();
    notificationTab[notId] = sender.tab.id;
    chrome.notifications.create(notId, {
      type: 'basic',
      //title: 'Change in ' + sender.tab.title,
      title: request.info.eventType + ' ' + request.info.severity + ' ' + request.info.client + ' ' + 'Incident w/ ' + request.info.numAlerts + ' Alert(s)',
      message: 'INC: ' + request.info.incID + ' - ' + request.info.title,
      iconUrl: faviconURL(sender.tab.url),
    });
  }
});

chrome.commands.onCommand.addListener(function (command) {
  switch (command) {
    case 'view-config':
      if (chrome.runtime.openOptionsPage) {
        chrome.runtime.openOptionsPage();
      } else {
        window.open(chrome.runtime.getURL('options.html'));
      }
    case 'toggle':
      chrome.tabs.query({ active: true, currentWindow: true }, function (tabs) {
        chrome.tabs.sendMessage(tabs[0].id, { type: 'toggle' });

      });
      break;
  }
});

chrome.notifications.onClicked.addListener(function callback(notificationId) {
  var updateProperties = { 'active': true };
  chrome.tabs.update(notificationTab[notificationId], updateProperties);
  chrome.notifications.clear(notificationId);
  window.focus();
});