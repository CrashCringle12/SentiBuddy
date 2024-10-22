
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
    document.getElementById('results').innerHTML  = `<h1>Loading...</h1>`
}


// button selectors
const notesButton = document.querySelector('senti-button#openNoteTaking');
const queueButton = document.querySelector('senti-button#startQueueFiltering');
const defangUrlButton = document.querySelector('senti-button#defangURL');
const ipCheckButton = document.querySelector('senti-button#checkIp');
const hashCheckButton = document.querySelector('senti-button#checkHash');
const notificationButton = document.querySelector('senti-button#notificationToggle');
const settingsButton = document.querySelector('senti-button#settings')
const startQueueButton = document.getElementById('startQueueFiltering');
document.addEventListener('DOMContentLoaded', () => {
    // Fetch the value of toggleExperiments from Chrome storage
    chrome.storage.local.get('toggleExperiments', function(result) {
        if (result.toggleExperiments) {
            // If toggleExperiments is true, show the Note Taking button
            document.getElementById('openNoteTaking').style.display = 'inline-block';
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
            console.log("GGG")
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
                    <h1>OSINT Results</h1>
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
                    <a href="https://www.abuseipdb.com/check/${response.abuseIPDB.ipAddress}" target="_blank">View on AbuseIPDB</a></br>
                    <a href="https://scamalytics.com/ip/${response.abuseIPDB.ipAddress}" target="_blank">View on Scamalytics</a></br>
                    <a href="https://spur.us/context/${response.abuseIPDB.ipAddress}" target="_blank">View on Spur</a><br>
                    <a href="https://www.virustotal.com/gui/ip-address/${response.abuseIPDB.ipAddress}" target="_blank">View on VirusTotal</a>
                `;
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
            }
            
        }
    }
}