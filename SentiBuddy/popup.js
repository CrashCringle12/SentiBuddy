
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
document.getElementById('checkIp').addEventListener('click', async () => {
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
document.getElementById('checkHash').addEventListener('click', async () => {
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
        // Otherwise we're dealing with a hash.
        } else {
            // Build the results HTML
            const body = document.querySelector('body');
            body.style.minWidth = '420px'; // Wider for hashes
            // Extract data from the response
            const vtData = response.VT.data.attributes;
            const typeUnsupported = vtData.last_analysis_stats['type-unsupported'];
            document.getElementById('results').innerHTML  = `
                <h1>OSINT Results</h1>
                <p><strong>Name:</strong> ${vtData.meaningful_name}</p>
                <p><strong>Security Vendors:</strong> ${vtData.last_analysis_stats.malicious} out of ${vtData.last_analysis_stats.undetected + vtData.last_analysis_stats.malicious} security vendors and ${typeUnsupported} sandboxes flagged this file as malicious</p>
                
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
                
                <p><strong>FileType:</strong> ${vtData.type_description}</p>
                <p><strong>File Size:</strong> ${vtData.size} bytes</p>
                <p><strong>Signature:</strong> ${vtData.signature_info ? vtData.signature_info.signer : 'File is not signed'}</p>
                <p><strong>First Submitted:</strong> ${new Date(vtData.first_submission_date * 1000).toLocaleDateString('en-US')}</p>
                <p><strong>Popular Threat Label:</strong> ${vtData.popular_threat_classification.suggested_threat_label}</p>
                <p><strong>Popular Threat Category:</strong> ${vtData.type_tag}</p>
                
                <button class="toggle-button" id="toggleVendorLabels">Vendor Labels</button>
                <ul id="vendorLabels" class="collapse">
                    ${Object.entries(vtData.last_analysis_results).map(([vendor, result]) => `<li><strong>${vendor}</strong>: ${result.result}</li>`).join('')}
                </ul>
                
                <p><strong>Description:</strong> ${vtData.description}</p>
                <p><strong>Tags:</strong> ${vtData.tags.join(', ')}</p>
                <a href="virustotal.com" target="_blank">View on VirusTotal</a>
            `;
        
            // Event listeners for toggling visibility
            document.getElementById('toggleOtherNames').addEventListener('click', () => toggleVisibility('otherNames'));
            document.getElementById('toggleHashes').addEventListener('click', () => toggleVisibility('hashes'));
            document.getElementById('toggleVendorLabels').addEventListener('click', () => toggleVisibility('vendorLabels'));
            
            // const resultsHTML = `
            //     <h1>OSINT Results</h1>
            //     <p><strong>Name:</strong> ${vtData.meaningful_name}</p>
            //     <p><strong>Security Vendors:</strong> ${vtData.last_analysis_stats.malicious} out of ${vtData.last_analysis_stats.undetected + vtData.last_analysis_stats.malicious} security vendors and ${typeUnsupported} sandboxes flagged this file as malicious</p>
            //     <button class="toggle-button" data-target="otherNames">Other Names</button>
            //     <ul id="otherNames" class="collapse" style="display: none;">
            //         ${vtData.names.map(name => `<li>${name}</li>`).join('')}
            //     </ul>       
            //     <button class="toggle-button" data-target="hashes">Hashes</button>
            //     <div id="hashes" class="collapse" style="display: none;">
            //         <p>MD5: ${vtData.md5}</p>
            //         <p>SHA1: ${vtData.sha1}</p>
            //         <p>SHA256: ${vtData.sha256}</p>
            //     </div>
            //     <p><strong>FileType:</strong> ${vtData.type_description}</p>
            //     <p><strong>File Size:</strong> ${vtData.size} bytes</p>
            //     <p><strong>Signature:</strong> ${vtData.signature_info ? vtData.signature_info.signer : 'File is not signed'}</p>
            //     <p><strong>First Submitted:</strong> ${new Date(vtData.first_submission_date * 1000).toLocaleDateString('en-US')}</p>
            //     <p><strong>Popular Threat Label:</strong> ${vtData.popular_threat_classification.suggested_threat_label}</p>
            //     <p><strong>Popular Threat Category:</strong> ${vtData.type_tag}</p>
            //     <button class="toggle-button" data-target="vendorLabels">Vendor Labels</button>
            //     <ul id="vendorLabels" class="collapse" style="display: none;">
            //         ${Object.entries(vtData.last_analysis_results).map(([vendor, result]) => `<li>${vendor}: ${result.result}</li>`).join('')}
            //     </ul>
            //     <p><strong>Description:</strong> ${vtData.description}</p>
            //     <p><strong>Tags:</strong> ${vtData.tags.join(', ')}</p>
            //     <a href="virustotal.com" target="_blank">View on VirusTotal</a>
            // `;
            
            // document.getElementById('results').innerHTML = resultsHTML;
            // const buttons = document.querySelectorAll('.toggle-button');
            // buttons.forEach(button => {
            //     button.addEventListener('click', function() {
            //         toggleVisibility(this.getAttribute('data-target'));
            //     });
            // });
        }
    }
}