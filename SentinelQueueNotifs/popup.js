
const ipv4Pattern = /^(25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)(\.(25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)){3}$/;
const ipv6Pattern = /^([0-9a-fA-F]{1,4}:){7}([0-9a-fA-F]{1,4})$/;

document.getElementById('checkIp').addEventListener('click', async () => {
    try {
        const text = await navigator.clipboard.readText();
        if (ipv4Pattern.test(text) || ipv6Pattern.test(text)) {
            chrome.runtime.sendMessage({ ip: text, type: "search-ip" }, function(response) {
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

function displayResults(response) {
    console.log("Display Results")
    if (response.error) {
        document.getElementById('results').textContent = 'Error fetching data: ' + response.error;
    } else {
        console.log("Oh yeah", response)

        // Check if domain exists and use a default value if it doesn't
        const domain = response.data.domain ? response.data.domain.replace('.', '[.]') : 'No domain available';

        // Safely access hostnames array and join, provide default if undefined
        const hostnames = response.data.hostnames?.join(', ') || 'No hostnames available';
        const scoreClass = getScoreClass(response.data.abuseConfidenceScore);
        const progressBarWidth = response.data.abuseConfidenceScore;



        // Build the results HTML
        document.getElementById('results').innerHTML = `
            <h1>OSINT Results</h1>
            <h2><span class="key">IP:</span> ${response.data.ipAddress}</h2>
            <div class="content"><span class="key">Reports:</span> ${response.data.totalReports || 0} reports with a <span class="${scoreClass}">${response.data.abuseConfidenceScore || 0}%</span> Confidence of abuse.</div>
            <div class="progress-container">
                <div class="progress-bar ${scoreClass}" style="width: ${progressBarWidth}%;">${progressBarWidth}%</div>
            </div>
            <div class="content"><span class="key">isTor:</span> ${response.data.isTor ? 'Yes' : 'No'}</div>
            <div class="content"><span class="key">ISP:</span> ${response.data.isp} (${domain})</div>
            <div class="content"><span class="key">GeoLocation:</span> ${response.data.countryName || 'No geo-location available'}</div>
            <div class="content"><span class="key">UsageType:</span> ${response.data.usageType || 'No usage type available'}</div>
            <div class="content"><span class="key">Host:</span> ${hostnames}</div>
            <a href="https://www.abuseipdb.com/check/${response.data.ipAddress}" target="_blank">View on AbuseIPDB</a></br>
            <a href="https://scamalytics.com/ip/${response.data.ipAddress}" target="_blank">View on Scamlytics</a></br>
            <a href="https://spur.us/context/${response.data.ipAddress}" target="_blank">View on Spur</a><br>
            <a href="https://www.virustotal.com/gui/ip-address/${response.data.ipAddress}" target="_blank">View on VirusTotal</a>
        `;
        
    }
}