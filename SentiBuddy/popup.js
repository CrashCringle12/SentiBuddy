
const ipv4Pattern = /^(25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)(\.(25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)){3}$/;
const ipv6Pattern = /^([0-9a-fA-F]{1,4}:){7}([0-9a-fA-F]{1,4})$/;
// Function to check the hash type
function checkHashType(hash) {
    const md5Pattern = /^[a-f0-9]{32}$/i;
    const sha1Pattern = /^[a-f0-9]{40}$/i;
    const sha256Pattern = /^[a-f0-9]{64}$/i;

    if (md5Pattern.test(hash)) {
        return 'MD5';
    } else if (sha1Pattern.test(hash)) {
        return 'SHA-1';
    } else if (sha256Pattern.test(hash)) {
        return 'SHA-256';
    } else {
        return 'Unknown';
    }
}
let isNotifToggled;
function setLoading() {
    document.getElementById('results').innerHTML  = `<div class="link-block"><span>🔍 Analyzing IP address...</span></div>`
}

let devData;
let data;
// Client Info Table Functions
function renderTable(filteredData) {
  const tableBody = document.getElementById("tableBody");
  tableBody.innerHTML = "";
  filteredData.forEach(row => {
    const tr = document.createElement("tr");
    tr.innerHTML = `
      <td>${row.code}</td>
      <td>${row.client}</td>
      <td>${row.department}</td>
      <td>${row.description}</td>
      <td>${row.edr}</td>
      <td>${row.contact}</td>
    `;
    tableBody.appendChild(tr);
  });
}

// Development Table Functions
function renderDevTable(filteredData) {
  const tableBody = document.getElementById("devTableBody");
  tableBody.innerHTML = "";
  filteredData.forEach(row => {
    const tr = document.createElement("tr");
    tr.innerHTML = `
      <td>${row.client}</td>
      <td>${row.sentinelInstance}</td>
      <td>${row.resourceGroup}</td>
      <td>${row.subscription}</td>
      <td>${row.location}</td>
    `;
    tableBody.appendChild(tr);
  });
}

var configDataURL = '';
function loadConfigURL() {
  chrome.storage.local.get({
    configDataURL: ''
  }, (items) => {
    configDataURL = items.configDataURL
    fetchClientData();
  });
}

async function fetchClientData() {
    const cacheKey = 'cachedConfig';
    const timestampKey = 'cachedConfigTimestamp';
    const now = Date.now();
    const cacheDuration = 5 * 60 * 1000; // 5 minutes in milliseconds
  
    const cachedData = localStorage.getItem(cacheKey);
    const cachedTimestamp = localStorage.getItem(timestampKey);
  
    if (cachedData && cachedTimestamp && (now - parseInt(cachedTimestamp) < cacheDuration)) {
      // Use cached data
      devData = JSON.parse(cachedData).clientInfoData.devData;
      data = JSON.parse(cachedData).clientInfoData.data
    } else {
        try {        
          const response = await fetch(configDataURL); // Replace with actual URL
          const result = await response.json();
          devData = result.clientInfoData.devData;
          data = result.clientInfoData.data

        // Cache result
        localStorage.setItem(cacheKey, JSON.stringify(result));
        localStorage.setItem(timestampKey, now.toString());
  
      } catch (error) {
        console.error('Failed to fetch client data:', error);
        return;
      }
    } 
    renderTable(data);
    renderDevTable(devData);
  }
  
document.getElementById("searchBox").addEventListener("input", function () {
  const query = this.value.toLowerCase();
  const filtered = data.filter(item => item.code.toLowerCase().includes(query));
  renderTable(filtered);
});

document.getElementById("devSearchBox").addEventListener("input", function () {
  const query = this.value.toLowerCase();
  const filtered = devData.filter(item => item.client.toLowerCase().includes(query));
  renderDevTable(filtered);
});

document.getElementById("revealBtn").addEventListener("click", function () {
  const content = document.getElementById("spoilerContent");
  content.classList.toggle("revealed");

  this.textContent = content.classList.contains("revealed") ? "Hide" : "Reveal";
});

// Navigation Functions
document.getElementById("clientBtn").addEventListener("click", () => {
  document.getElementById("clientSection").style.display = "block";
  document.getElementById("osintSection").style.display = "none";
    document.getElementById("queueSection").style.display = "none";
  document.getElementById("developmentSection").style.display = "none";
  document.getElementById("clientBtn").classList.add("active");
  document.getElementById("osintBtn").classList.remove("active");
  document.getElementById("developmentBtn").classList.remove("active");
    document.getElementById("queueBtn").classList.remove("active");
});

document.getElementById("osintBtn").addEventListener("click", () => {
  document.getElementById("clientSection").style.display = "none";
  document.getElementById("osintSection").style.display = "block";
    document.getElementById("queueSection").style.display = "none";
  document.getElementById("developmentSection").style.display = "none";
  document.getElementById("osintBtn").classList.add("active");
  document.getElementById("clientBtn").classList.remove("active");
  document.getElementById("developmentBtn").classList.remove("active");
    document.getElementById("queueBtn").classList.remove("active");
});

document.getElementById("developmentBtn").addEventListener("click", () => {
  document.getElementById("clientSection").style.display = "none";
  document.getElementById("osintSection").style.display = "none";
  document.getElementById("queueSection").style.display = "none";
  document.getElementById("developmentSection").style.display = "block";
  document.getElementById("developmentBtn").classList.add("active");
  document.getElementById("queueBtn").classList.remove("active");
  document.getElementById("clientBtn").classList.remove("active");
  document.getElementById("osintBtn").classList.remove("active");
});// Updated data with placeholder hyperlinks for EDR and a new Contacts field

document.getElementById("queueBtn").addEventListener("click", () => {
      document.getElementById("queueSection").style.display = "block";
  document.getElementById("clientSection").style.display = "none";
  document.getElementById("osintSection").style.display = "none";
  document.getElementById("developmentSection").style.display = "none";
  document.getElementById("developmentBtn").classList.remove("active");
  document.getElementById("queueBtn").classList.add("active");
  document.getElementById("clientBtn").classList.remove("active");
  document.getElementById("osintBtn").classList.remove("active");
});

// Close modal when clicking outside of it
window.addEventListener("click", (event) => {
  const modal = document.getElementById("settingsModal");
  if (event.target === modal) {
    modal.style.display = "none";
  }
});
loadConfigURL()

// OSINT Analysis Functions
let analysisTimeout;

document.getElementById("osintInput").addEventListener("input", () => {
  const input = document.getElementById("osintInput").value.trim();
  const osintResults = document.getElementById("results");
  const copyAllBtn = document.getElementById("copyAllBtn");

  // Clear previous results and timeout
  clearTimeout(analysisTimeout);
  osintResults.innerHTML = "";
  copyAllBtn.style.display = "none";

  // Validate IP address
  const isIP = /^(?:(?:25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]?)\.){3}(?:25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]?)$/.test(input);
  
  if (!isIP || !input) {
    return;
  }

  // Show loading state
  osintResults.innerHTML = '<div class="link-block"><span>🔍 Analyzing IP address...</span></div>';

  // Debounce API calls
  analysisTimeout = setTimeout(() => {
    performOSINTAnalysis(input);
  }, 500);
});

async function performOSINTAnalysis(ip) {
  const osintResults = document.getElementById("results");
  const copyAllBtn = document.getElementById("copyAllBtn");
  
  const vtApiKey = localStorage.getItem("vtApiKey");
  const abuseApiKey = localStorage.getItem("abuseApiKey");

  if (!vtApiKey || !abuseApiKey) {
    osintResults.innerHTML = `
      <div class="link-block">
        <span>⚠️ API keys not configured. Please click Settings to add your VirusTotal and AbuseIPDB API keys.</span>
      </div>
    `;
    return;
  }

  try {
    console.log('Sending message to background script...');
    
    // Check if chrome.runtime is available
    if (!chrome.runtime || !chrome.runtime.sendMessage) {
      throw new Error('Chrome runtime not available');
    }
    
    // Use Chrome extension background script for API calls
    const response = await new Promise((resolve, reject) => {
      chrome.runtime.sendMessage({
        action: 'fetchOSINTData',
        ip: ip,
        vtApiKey: vtApiKey,
        abuseApiKey: abuseApiKey
      }, (response) => {
        if (chrome.runtime.lastError) {
          console.error('Chrome runtime error:', chrome.runtime.lastError);
          reject(new Error(chrome.runtime.lastError.message));
        } else if (!response) {
          console.error('No response received from background script');
          reject(new Error('No response from background script'));
        } else {
          console.log('Response received:', response);
          resolve(response);
        }
      });
    });

    if (!response.success) {
      throw new Error(response.error);
    }

    const { vtData, abuseData } = response.data;

    // Extract information
    const analysisResult = extractAnalysisData(ip, vtData, abuseData);
    
    // Display analysis results
    displayAnalysisResults(analysisResult);
    
    // Show reference links and copy all button
    displayReferenceLinks(ip);
    copyAllBtn.style.display = "block";

  } catch (error) {
    console.error("Error fetching OSINT data:", error);
    osintResults.innerHTML = `
      <div class="link-block">
        <span>❌ Error fetching data: ${error.message}</span>
        <button onclick="location.reload()" style="margin-top: 10px; padding: 5px 10px; background: #ff9a9e; color: white; border: none; border-radius: 8px; cursor: pointer;">Retry</button>
      </div>
    `;
  }
}

// Helper function to make API requests through Chrome extension
async function makeApiRequest(url, headers) {
  return new Promise((resolve, reject) => {
    fetch(url, {
      method: 'GET',
      headers: headers,
      mode: 'cors'
    })
    .then(response => {
      if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`);
      }
      return response.json();
    })
    .then(data => resolve(data))
    .catch(error => reject(error));
  });
}

function extractAnalysisData(ip, vtData, abuseData) {
  // Extract VirusTotal data
  const vtAttributes = vtData?.data?.attributes || {};
  const vtStats = vtAttributes.last_analysis_stats || {};
  const vtScore = `${vtStats.malicious || 0}/${Object.values(vtStats).reduce((a, b) => a + b, 0)}`;
  
  // Enhanced VPN detection from multiple sources
  let isVPN = false;
  
  // Check categories
  const vtCategories = vtAttributes.categories || {};
  if (Object.values(vtCategories).some(category => 
    category.toLowerCase().includes('vpn') || 
    category.toLowerCase().includes('proxy') ||
    category.toLowerCase().includes('anonymizer')
  )) {
    isVPN = true;
  }
  
  // Check last_analysis_results for VPN indicators
  const analysisResults = vtAttributes.last_analysis_results || {};
  for (const [engine, result] of Object.entries(analysisResults)) {
    if (result.result && typeof result.result === 'string') {
      const resultText = result.result.toLowerCase();
      if (resultText.includes('vpn') || resultText.includes('proxy') || 
          resultText.includes('anonymizer') || resultText.includes('tor')) {
        isVPN = true;
        break;
      }
    }
  }
  
  // Check ASN and network info for hosting/VPN providers
  const asn = vtAttributes.asn || 0;
  const asOwner = vtAttributes.as_owner || '';
  const network = vtAttributes.network || '';
  
  const vpnProviders = ['nordvpn', 'expressvpn', 'surfshark', 'protonvpn', 'cyberghost', 
                       'privateinternetaccess', 'tunnelbear', 'windscribe', 'hotspot shield',
                       'purevpn', 'ipvanish', 'vyprvpn', 'torguard', 'perfect privacy',
                       'mullvad', 'ovpn', 'azire', 'ivpn', 'hide.me', 'vpn.ac'];
  
  const hostingProviders = ['digital ocean', 'amazon', 'google cloud', 'microsoft azure',
                           'ovh', 'hetzner', 'linode', 'vultr', 'scaleway', 'contabo'];
  
  if (asOwner.toLowerCase().includes('vpn') || 
      asOwner.toLowerCase().includes('proxy') ||
      vpnProviders.some(provider => asOwner.toLowerCase().includes(provider)) ||
      hostingProviders.some(provider => asOwner.toLowerCase().includes(provider))) {
    isVPN = true;
  }

  // Extract AbuseIPDB data
  const abuseResult = abuseData?.data || {};
  const abuseScore = `${abuseResult.abuseConfidencePercentage || 0}%`;
  const isp = abuseResult.isp || "Unknown";
  const countryCode = abuseResult.countryName || "Unknown";

  return {
    ip,
    isp,
    location: countryCode,
    vtScore,
    abuseScore,
    isVPN,
    vtData, // Include raw VT data for debugging
    abuseData, // Include raw AbuseIPDB data for debugging
    debugInfo: {
      categories: vtCategories,
      asn: asn,
      asOwner: asOwner,
      network: network
    }
  };
}
let analysisText = '';

// Global function to toggle AbuseIPDB debug info
window.toggleAbuseDebug = function(button) {
  const debugDiv = button.closest('.link-block').querySelector('.abuse-debug-content');
  if (debugDiv.style.display === 'none') {
    debugDiv.style.display = 'block';
    button.textContent = 'Hide';
  } else {
    debugDiv.style.display = 'none';
    button.textContent = 'Show';
  }
};

// Global function to copy analysis results
window.copyAnalysisResults = function(text, button) {
  navigator.clipboard.writeText(text).then(() => {
    const originalText = button.textContent;
    button.textContent = "Copied!";
    setTimeout(() => button.textContent = originalText, 1000);
  }).catch(err => {
    console.error('Failed to copy text: ', err);
  });
};



function displayReferenceLinks(ip) {
  const osintResults = document.getElementById("results");
  
  const urls = [
    `https://www.virustotal.com/gui/ip-address/${ip}`,
    `https://www.abuseipdb.com/check/${ip}`,
    `https://spur.us/context/${ip}`,
    `https://scamalytics.com/ip/${ip}`
  ];

  const labels = ["VirusTotal", "AbuseIPDB", "Spur.us", "Scamalytics"];

  urls.forEach((url, index) => {
    const div = document.createElement("div");
    div.className = "link-block";
    div.innerHTML = `
      <a href="${url}" target="_blank" style="text-decoration: none; color: inherit;">
        🔗 ${labels[index]}
      </a>
      <button class="copy-btn" data-url="${url}">Copy</button>
    `;
    osintResults.appendChild(div);
  });

  // Add copy functionality to individual buttons
  document.querySelectorAll(".copy-btn").forEach(btn => {
    btn.addEventListener("click", () => {
      navigator.clipboard.writeText(btn.dataset.url).then(() => {
        const originalText = btn.textContent;
        btn.textContent = "Copied!";
        setTimeout(() => btn.textContent = originalText, 1000);
      });
    });
  });

  // Setup Copy All functionality
  const copyAllBtn = document.getElementById("copyAllBtn");
  copyAllBtn.onclick = () => {
    const fullText = urls.join('\n');
    navigator.clipboard.writeText(fullText).then(() => {
      const originalText = copyAllBtn.textContent;
      copyAllBtn.textContent = "Copied!";
      setTimeout(() => copyAllBtn.textContent = originalText, 1000);
    });
  };
}

// button selectors
const notesButton = document.getElementById("openNoteTakingBtn");
const queueButton = document.querySelector('senti-button#startQueueFiltering');
const defangUrlButton = document.querySelector('senti-button#defangURL');
const ipCheckButton = document.querySelector('senti-button#checkIp');
const hashCheckButton = document.querySelector('senti-button#checkHash');
const notificationButton = document.querySelector('senti-button#notificationToggle');
const settingsButton = document.getElementById("settingsBtn");
const startQueueButton = document.getElementById('startQueueFiltering');
document.addEventListener('DOMContentLoaded', () => {
    // Fetch the value of toggleExperiments from Chrome storage
    chrome.storage.local.get('toggleExperiments', function(result) {
        if (result.toggleExperiments) {
            // If toggleExperiments is true, show the Note Taking button
            document.getElementById('openNoteTakingBtn').style.display = 'flex';
        }
    });
    

    // Check the current state of the queue filtering
    chrome.runtime.sendMessage({ type: 'get-queue-state' }, (response) => {
        if (response.active) {
            startQueueButton.setText('Queue Filtering: On');
            startQueueButton.setColor('#107C10');
        } else {
            startQueueButton.setText('Queue Filtering: Off');
            startQueueButton.setColor('#D83B01');
        } 
    });

    chrome.storage.local.get(["desktopNotifications"]).then((result) => {
        if (result.desktopNotifications) {
            notificationButton.setText('Notifications: On');
            notificationButton.setColor('#107C10');
        } else {
            notificationButton.setText('Notifications: Off');
            notificationButton.setColor('#D83B01');
        }
    });

    // Add event listener for the new button
    notesButton.addEventListener('click', () => {
        chrome.windows.create({
            url: chrome.runtime.getURL("notes_app/index.html"),
            type: "popup",
            width: 800,
            height: 600
        });
    });

});

document.getElementById('openDashboard').addEventListener('click', () => {
    console.log("TEST")
    chrome.tabs.create({
      url: chrome.runtime.getURL('dashboard.html') // adjust if the filename is different
    });
  });
  

notificationButton.addEventListener('click', () => {
    chrome.storage.local.get(["desktopNotifications"]).then((result) => {
        isNotifToggled = !result.desktopNotifications
        if (isNotifToggled) {
            notificationButton.setText('Notifications: On');
            notificationButton.setColor('#107C10');
            chrome.runtime.sendMessage({ type: 'set-notifications', enabled: true }, response => {
                console.log('Notification enable response:', response);
            });
        } else {
            notificationButton.setText('Notifications: Off');
            notificationButton.setColor('#D83B01');
            chrome.runtime.sendMessage({ type: 'set-notifications', enabled: false }, response => {
                console.log('Notification disable response:', response);
            });
        }
      });
    // Update the configuration in storage
    chrome.storage.local.set({ desktopNotifications: !isNotifToggled }, () => {
    console.log('Notification settings updated');
        });
});

settingsButton.addEventListener('click', async () => {
    try {
        if (chrome.runtime.openOptionsPage) {
            chrome.runtime.openOptionsPage();
        } else {
            window.open(chrome.runtime.getURL('options.html'));
        }
    } catch (error) {
        document.getElementById('results').textContent = 'Failed to open settings';
    }
});

ipCheckButton.addEventListener('click', async () => {
    setLoading();
    try {
        const text = await navigator.clipboard.readText();
        if (ipv4Pattern.test(text.trim()) || ipv6Pattern.test(text.trim())) {
            chrome.runtime.sendMessage({ ip: text.trim(), type: "search-ip" }, function(response) {
                console.log("Response Received")
                displayResults(response);
            });
        } else {
            document.getElementById('results').textContent = 'No valid IP address found in clipboard.';
        }
    } catch (error) {
        document.getElementById('results').textContent = 'Failed to access clipboard.';
    }
});
hashCheckButton.addEventListener('click', async () => {
    setLoading();
    try {
        const text = await navigator.clipboard.readText();
        var hashType = checkHashType(text.trim())
        if (hashType != 'Unknown') {
            chrome.runtime.sendMessage({ hash: text.trim(), type: "search-hash" }, function(response) {
                console.log("Response Received")
                displayResults(response);
            });
        } else {
            document.getElementById('results').textContent = 'No valid Hash address found in clipboard.';
        }
    } catch (error) {
        document.getElementById('results').textContent = 'Failed to access clipboard.';
    }
});

defangUrlButton.addEventListener('click', async () => {
    setLoading();
    try {
        const text = await navigator.clipboard.readText();
        const defangedText = text.replace(/(https?):\/\/(?!.*(virustotal\.com|scamalytics\.com|abuseipdb\.com|spur\.us|urlscan\.io|portal\.azure\.com|exchange\.xforce\.ibmcloud\.com))([\w-]+(\.[\w-]+)+)/gi, (match, p1, p2, p3) => {
            return p1.replace(/^https?/, 'hxxps') + '[:]//' + p3.replace(/\./g, '[.]');
        });
        navigator.clipboard.writeText(defangedText);
        document.getElementById('results').textContent = 'Clipboard defanged!';
    } catch (error) {
        document.getElementById('results').textContent = 'Failed to access clipboard.';
    }
});

startQueueButton.addEventListener('click', () => {
    setLoading();
    chrome.runtime.sendMessage({ type: 'toggle-queue-filtering' }, function(response) {
        if (response) {
            if (response.active == true) {
                startQueueButton.setText('Queue Filtering: On');
                startQueueButton.setColor('#107C10');
                document.getElementById('results').textContent = 'Queue filtering started.';
            } else {
                startQueueButton.setText('Queue Filtering: Off');
                startQueueButton.setColor('#D83B01');
                document.getElementById('results').textContent = 'Queue filtering stopped.';
            }
        } else {
            document.getElementById('results').textContent = 'Failed to start queue filtering.';
        }
    });
});


function getScoreClass(score) {
    if (score > 75) {
        return 'score-red';
    } else if (score > 25) {
        return 'score-orange';
    } else if (score > 0) {
        return 'score-yellow';
    } else {
        return 'score-green';
    }
}

function toggleVisibility(elementId) {
    var element = document.getElementById(elementId);
    element.classList.toggle('visible');
}

function updateProgress(malicious, total) {
    const circle = document.querySelector('.progress-circle');
    const text = document.querySelector('.progress-text');
    const radius = circle.r.baseVal.value;
    const circumference = 2 * Math.PI * radius;
    const percent = malicious / total;

    circle.style.strokeDasharray = `${circumference} ${circumference}`;
    circle.style.strokeDashoffset = `${(1 - percent) * circumference}`;

    text.textContent = `${malicious} / ${total}`;

    // Determine color based on the number of reports
    if (malicious === 0) {
        circle.style.strokeDashoffset = `${0}`;
        circle.style.stroke = '#008000'; // Green for no reports
    } else if (malicious <= 14) {
        circle.style.stroke = '#FFD700'; // Yellow for 2-14 reports
    } else {
        circle.style.stroke = '#FF0000'; // Red for more than 14 reports
    }
}

function displayResults(response) {
    console.log("Display Results")
    if (response.error) {
        console.log(response)
        document.getElementById('results').textContent = 'Error fetching data: ' + response.error;
    } else if(response.errors) {
        var text = ""
        console.log(response)
        for (error of response.errors) {
            text = text + error.status + ": " + error.detail + "\n"
        }
        document.getElementById('results').textContent = 'Error fetching data: ' + text;
    } else { 
        console.log("Oh yeah", response)
        // Check if we're doing OSINT on an IP
        if (response.ip) {
            if (response.abuseIPDB) {
                // Check if domain exists and use a default value if it doesn't
                const domain = response.abuseIPDB.domain ? response.abuseIPDB.domain.replace('.', '[.]') : 'No domain available';

                // Safely access hostnames array and join, provide default if undefined
                const hostnames = response.abuseIPDB.hostnames?.join(', ') || 'No hostnames available';
                const scoreClass = getScoreClass(response.abuseIPDB.abuseConfidenceScore);
                const progressBarWidth = response.abuseIPDB.abuseConfidenceScore == 0 ? 100 : response.abuseIPDB.abuseConfidenceScore;
                const geoLocation = (response.IPInfo && response.IPInfo.city && response.IPInfo.region) ?
                `${response.IPInfo.city}, ${response.IPInfo.region}, ${response.IPInfo.country}` :
                (response.abuseIPDB && response.abuseIPDB.countryName) ?
                response.abuseIPDB.countryName :
                "No GeoLocation data available";

                const riskData = (response.Scamalytics.risk) ?
                ` ${response.Scamalytics.risk.toUpperCase()} - ${response.Scamalytics.score}` : 'No Risk Data Available';
                // Build the results HTML
                const body = document.querySelector('body');
                body.style.minWidth = '320px'; // Slimmer for IPs
                document.getElementById('results').innerHTML = `
                    <div style="width: 100%; font-weight: bold; margin-bottom: 4px; color: #2d3748; display: flex; justify-content: space-between; align-items: center;">
                    <h1>📊 OSINT Results</h1>
                    <button id="copyAnalysisBtn" style="padding: 4px 8px; background: #ff9a9e; color: white; border: none; border-radius: 6px; cursor: pointer; font-size: 12px;">Copy</button>
                  </div>
                    <h2><span class="key">IP:</span> ${response.abuseIPDB.ipAddress}</h2>
                    <div class="content"><span class="key">Reports:</span> ${response.abuseIPDB.totalReports || 0} reports with a <span class="${scoreClass}">${response.abuseIPDB.abuseConfidenceScore || 0}%</span> Confidence of abuse.</div>
                    <div class="progress-container">
                        <div class="progress-bar ${scoreClass}" style="width: ${progressBarWidth}%;">${response.abuseIPDB.abuseConfidenceScore}%</div>
                    </div>
                    <div class="content"><span class="key">Scamalytics Risk:</span> ${riskData}</div>
                    <div class="content"><span class="key">isTor:</span> ${response.abuseIPDB.isTor ? 'Yes' : 'No'}</div>
                    <div class="content"><span class="key">ISP:</span> ${response.abuseIPDB.isp} (${domain})</div>
                    <div class="content"><span class="key">GeoLocation:</span> ${geoLocation}</div>
                    <div class="content"><span class="key">UsageType:</span> ${response.abuseIPDB.usageType || 'No usage type available'}</div>
                    <div class="content"><span class="key">Host:</span> ${hostnames}</div>
                `;
                analysisText = document.getElementById('results').textContent
                displayReferenceLinks(response.abuseIPDB.ipAddress)
                
            } else {
                document.getElementById('results').innerHTML = `Error fetching data from AbuseIPDB`;        
            }
        // Otherwise we're dealing with a hash.
        } else {
            if (response.VT.error) {
                if (response.VT.error.code == "NotFoundError") {
                    document.getElementById('results').textContent = response.VT.error.message        
                } else {
                    document.getElementById('results').textContent = 'Error fetching data: ' + response.VT.error;        
                }
            } else {
                // Build the results HTML
                const body = document.querySelector('body');
                body.style.minWidth = '420px'; // Wider for hashes
                // Extract data from the response
                const vtData = response.VT.data.attributes;
                const typeUnsupported = vtData.last_analysis_stats['type-unsupported'];
                const threatLabel = (vtData.popular_threat_classification && vtData.popular_threat_classification.suggested_threat_label) ? vtData.popular_threat_classification.suggested_threat_label : "No Threat Label Available";
                const signature = (vtData.signature_info && vtData.signature_info.verified) || "Not Signed"
                const description = vtData.description || (vtData.signature_info && vtData.signature_info.description) || "No Description Available"
                const signDate =  (vtData.signature_info && vtData.signature_info["signing date"]) || "N/A"
                const product =  (vtData.signature_info && vtData.signature_info.product) || "N/A"
                const copyright = (vtData.signature_info && vtData.signature_info.copyright) || "N/A"
                const comments =  (vtData.signature_info && vtData.signature_info.comments) || "No Comments"
                const signers =  (vtData.signature_info && vtData.signature_info.signers) ? vtData.signature_info.signers.split(';') : ["N/A"]
                document.getElementById('results').innerHTML  = `
                    <div style="width: 100%; font-weight: bold; margin-bottom: 4px; color: #2d3748; display: flex; justify-content: space-between; align-items: center;">
                    <h1>📊 OSINT Results</h1>
                    <button id="copyAnalysisBtn" style="padding: 4px 8px; background: #ff9a9e; color: white; border: none; border-radius: 6px; cursor: pointer; font-size: 12px;">Copy</button>
                  </div>
                    <h1>OSINT Results</h1>
                    <p><strong>Security Vendors:</strong> ${vtData.last_analysis_stats.malicious} out of ${vtData.last_analysis_stats.undetected + vtData.last_analysis_stats.malicious} security vendors and ${typeUnsupported} sandboxes flagged this file as malicious</p>
                    <div class="circle-container">
                    <svg width="120" height="120" viewBox="0 0 120 120">
                        <circle cx="60" cy="60" r="54" fill="none" stroke="#ccc" stroke-width="12"/>
                        <circle cx="60" cy="60" r="54" fill="none" stroke="#f00" stroke-width="12" stroke-dasharray="339.292" stroke-dashoffset="339.292" class="progress-circle"/>
                        <text x="60" y="65" text-anchor="middle" fill="#333" font-size="20" class="progress-text"></text>
                    </svg>
                    </div>
                    <p><strong>Name:</strong> ${vtData.meaningful_name}</p>
                    
                    <button class="toggle-button" id="toggleOtherNames">Other Names</button>
                    <ul id="otherNames" class="collapse">
                        ${vtData.names.map(name => `<li>${name}</li>`).join('')}
                    </ul>
                    
                    <button class="toggle-button" id="toggleHashes">Hashes</button>
                    <div id="hashes" class="collapse">
                        <p><strong>MD5</strong>: ${vtData.md5}</p>
                        <p><strong>SHA1</strong>: ${vtData.sha1}</p>
                        <p><strong>SHA256</strong>: ${vtData.sha256}</p>
                    </div>
                    <button class="toggle-button" id="toggleSignatureInfo">Signature Info</button>
                    <ul id="signatures" class="collapse">
                        <p><strong>Comments:</strong> ${comments}</p>
                        <p><strong>Signed:</strong> ${signature}</p>
                        <p><strong>Signing Date:</strong> ${signDate}</p>
                        <p><strong>Product:</strong> ${product}</p>
                        <p><strong>Copyright:</strong> ${copyright}</p>
                        <strong>Signers: </strong>${Object.entries(signers).map(([index, sig]) => `<li><strong>${(parseInt(index)+1)}:</strong> ${sig}</li>`).join('')}
                    </ul>
                    <p><strong>Description:</strong> ${description}</p>
                    <p><strong>FileType:</strong> ${vtData.type_description}</p>
                    <p><strong>File Size:</strong> ${vtData.size} bytes</p>
                    <p><strong>First Submitted:</strong> ${new Date(vtData.first_submission_date * 1000).toLocaleDateString('en-US')}</p>
                    <p><strong>Popular Threat Label:</strong> ${threatLabel}</p>
                    <p><strong>Popular Threat Category:</strong> ${vtData.type_tag || "No Threat Category Available"}</p>
                    
                    <button class="toggle-button" id="toggleVendorLabels">Vendor Labels</button>
                    <ul id="vendorLabels" class="collapse">
                        ${Object.entries(vtData.last_analysis_results).map(([vendor, result]) => `<li><strong>${vendor}</strong>: ${result.result}</li>`).join('')}
                    </ul>
                    <p><strong>Tags:</strong> ${vtData.tags.join(', ')}</p>
                    <a href="${response.VT.data.links.self}" target="_blank">View on VirusTotal</a>
                `;
                
                // Example usage:
                updateProgress(vtData.last_analysis_stats.malicious, vtData.last_analysis_stats.undetected + vtData.last_analysis_stats.malicious); // You would replace these numbers with your actual data
                

                // Event listeners for toggling visibility
                document.getElementById('toggleOtherNames').addEventListener('click', () => toggleVisibility('otherNames'));
                document.getElementById('toggleHashes').addEventListener('click', () => toggleVisibility('hashes'));
                document.getElementById('toggleSignatureInfo').addEventListener('click', () => toggleVisibility('signatures'));
                document.getElementById('toggleVendorLabels').addEventListener('click', () => toggleVisibility('vendorLabels'));
                analysisText = document.getElementById('results').textContent
                  
            }       
        }
                 // Add click event listener to the copy button
        document.getElementById('copyAnalysisBtn').addEventListener('click', function() {
          navigator.clipboard.writeText(analysisText).then(() => {
            const originalText = this.textContent;
            this.textContent = "Copied!";
            setTimeout(() => this.textContent = originalText, 1000);
          }).catch(err => {
            console.error('Failed to copy text: ', err);
            // Fallback for older browsers
            const textArea = document.createElement('textarea');
            textArea.value = analysisText;
            document.body.appendChild(textArea);
            textArea.select();
            document.execCommand('copy');
            document.body.removeChild(textArea);
            
            const originalText = this.textContent;
            this.textContent = "Copied!";
            setTimeout(() => this.textContent = originalText, 1000);
          });
        });
    }
}