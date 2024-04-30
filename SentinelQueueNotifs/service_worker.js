const notificationTab = {};

const maxAgeInDays = 90;
const verbose = true;  // This is a flag, typically set to get detailed responses
// Set the API key
var abuseipdbAPIkey = '';
var VTkey = '';
function loadKey() {
  chrome.storage.sync.get({
    abuseipdbAPIkey: '',
    vtkey: ''
  }, (items) => {
      abuseipdbAPIkey = items.abuseipdbAPIkey;
      VTkey = items.vtkey;
    });
}
loadKey();


chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.type == 'search-ip') {
      loadKey();
      // Configure the request headers
      var headers = new Headers({
        'Key': abuseipdbAPIkey,
        'Accept': 'application/json'
      });
      // Construct the query string
      var queryParams = new URLSearchParams({
        ipAddress: request.ip,
        maxAgeInDays: maxAgeInDays,
        verbose: verbose  // Include this only if needed for detailed responses
      });

      // Define the API endpoint with the query string
      const url = `https://api.abuseipdb.com/api/v2/check?${queryParams}`;
      //var relevantResponse = {abuseIPDB: {}, VT: {}}
      fetch(url, { headers: headers })
      .then(response => response.json())
      .then(data => {
          //relevantResponse.abuseIPDB = data
          sendResponse(data)
      })
      .catch(error => {
          sendResponse({ error: error.toString() });
      });
           
    // const options = {method: 'GET', headers: {accept: 'application/json', 'x-apikey': VTkey}};

    // fetch('https://www.virustotal.com/api/v3/ip_addresses/51.75.142.157', options)
    //   .then(response => response.json())
    //   .then(response =>{
    //     relevantResponse.VT = response
    //     sendResponse(relevantResponse)
    //   })
    //   .catch(err => {sendResponse({error: err.toString()})});
    return true; // Indicates that the response is asynchronous
  } else {
    console.log(request.type)
  }
});


function faviconURL(u) {
    const url = new URL(chrome.runtime.getURL("/_favicon/"));
    url.searchParams.set("pageUrl", u);
    url.searchParams.set("size", "32");
    return url.toString();
  }

chrome.runtime.onMessage.addListener(function(request, sender) {
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
      chrome.tabs.query({active: true, currentWindow: true}, function(tabs){
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