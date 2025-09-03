
let dummyClients;
let clientData = []; // store all clients after fetch
var configDataURL = '';
function loadConfigURL() {
  chrome.storage.local.get({
    configDataURL: ''
  }, (items) => {
    configDataURL = items.configDataURL
    fetchClientData();
  });
}


function getPercentChange(trend) {
    const start = trend[0];
    const end = trend[trend.length - 1];

    let percentChange = 0;
    if (start !== 0) {
    percentChange = ((end - start) / start) * 100;
    } else if (end > 0) {
    percentChange = 100; // from 0 to non-zero = full growth
    } else {
    percentChange = 0; // no change from 0 to 0
    }

    percentChange = Math.round(percentChange); // or .toFixed(1) for decimal
    return percentChange
}
async function fetchClientData() {
    const cacheKey = 'cachedClientData';
    const timestampKey = 'cachedClientDataTimestamp';
    const now = Date.now();
    const cacheDuration = 5 * 60 * 1000; // 5 minutes in milliseconds
  
    const cachedData = localStorage.getItem(cacheKey);
    const cachedTimestamp = localStorage.getItem(timestampKey);
  
    if (cachedData && cachedTimestamp && (now - parseInt(cachedTimestamp) < cacheDuration)) {
      // Use cached data
      dummyClients = JSON.parse(cachedData);

      renderClients();
      selectClient(dummyClients[0]);
      console.log(dummyClients)
      console.log("Using Cache")
      renderRecentChangesBar(dummyClients);
      return;
    }
  
    try {
        console.log("FETCHING")
        
        const response = await fetch(configDataURL); // Replace with actual URL
        const result = await response.json();

        dummyClients = result.stockData.value.map(item => ({
        name: item.name,
        workspace: item.workspace,
        incidents: item.totalIncidents,
        trend: JSON.parse(item.trend),
        percentChange: getPercentChange(JSON.parse(item.trend)),
        mostCommon: JSON.parse(item.mostCommon),
        leastCommon: JSON.parse(item.leastCommon)
      }));
      console.log(dummyClients)

      // Cache result
      localStorage.setItem(cacheKey, JSON.stringify(dummyClients));
      localStorage.setItem(timestampKey, now.toString());
  
      renderClients();
      selectClient(dummyClients[0]);
      renderRecentChangesBar(dummyClients);
    } catch (error) {
      console.error('Failed to fetch client data:', error);
    }
  }
  
let chartInstance = null;

function renderClients() {
    const sidebar = document.getElementById('sidebar');
    sidebar.innerHTML = '';
    dummyClients.forEach(client => {
        const box = document.createElement('div');
        box.className = 'client-box';
        box.onclick = () => selectClient(client);

        const info = document.createElement('div');
        info.className = 'client-info';
        info.innerHTML = `<h3>${client.name}</h3><p>${client.workspace}</p>`;

        const spark = createSparkline(client.trend, client.percentChange);

        const stats = document.createElement('div');
        stats.className = 'stats';
        stats.innerHTML = `<strong>${client.incidents}</strong><span style="color: ${client.percentChange >= 0 ? 'red' : 'green'};">${client.percentChange > 0 ? '+' : ''}${client.percentChange}%</span>`;

        box.appendChild(info);
        box.appendChild(spark);
        box.appendChild(stats);
        sidebar.appendChild(box);
    });
}

function createSparkline(trend, percentChange) {
    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.setAttribute('class', 'sparkline');
    svg.setAttribute('viewBox', '0 0 100 20');

    const max = Math.max(...trend);
    const min = Math.min(...trend);
    const range = max - min || 1;
    const points = trend.map((v, i) => `${(i / (trend.length - 1)) * 100},${20 - ((v - min) / range) * 20}`).join(' ');

    const polyline = document.createElementNS('http://www.w3.org/2000/svg', 'polyline');
    polyline.setAttribute('fill', 'none');
    polyline.setAttribute('stroke', percentChange >= 0 ? 'red' : 'green');
    polyline.setAttribute('stroke-width', '2');
    polyline.setAttribute('points', points);

    const baselineY = 20 - ((trend[0] - min) / range) * 20;
    const baseline = document.createElementNS('http://www.w3.org/2000/svg', 'line');
    baseline.setAttribute('x1', '0');
    baseline.setAttribute('y1', baselineY);
    baseline.setAttribute('x2', '100');
    baseline.setAttribute('y2', baselineY);
    baseline.setAttribute('stroke', '#aaa');
    baseline.setAttribute('stroke-width', '2');
    baseline.setAttribute('stroke-dasharray', '4 2');

    svg.appendChild(baseline);
    svg.appendChild(polyline);
    return svg;
}

function selectClient(client) {
    const clientInfo = document.getElementById('client-info');
    const start = client.trend[0];
    const end = client.trend[client.trend.length - 1];
    const difference = end - start;
    const percentDiff = getPercentChange(client.trend)
    const now = new Date().toLocaleString("en-US", { timeZone: "America/New_York", hour: '2-digit', minute: '2-digit', hour12: true });
    const today = new Date().toLocaleDateString("en-US", { month: 'numeric', day: 'numeric', year: 'numeric' });

    const max = Math.max(...client.trend);
    const min = Math.min(...client.trend);
    const range = max - min || 1;
    const color = difference <= 0 ? 'green' : 'red';
    const fillId = 'gradientFill';
    // Calculate dot position within range bar
    const rangeDot = document.getElementById('range-dot');
    const relativePos = (end - min) / (max - min || 1); // avoid divide by 0
    rangeDot.style.left = `${Math.min(100, Math.max(0, relativePos * 100))}%`;
    updateRangeBar(client.trend)

    clientInfo.innerHTML = `
        <h2>${client.name} (${client.workspace})</h2>
        <div style="display: flex; align-items: flex-end; gap: 20px;">
            <h1 style="font-size: 32px; margin: 0;">${client.incidents}</h1>
            <div>
                <div style="font-size: 12px; font-weight: bold;">MARKET OPEN                 <span style="margin-left: 0px; font-size: 12px; color: #888;">
                • AS OF ${today}, ${now} EST
            </span></div>

                <div style="font-size: 16px; color: ${color};">${difference > 0 ? '+' : ''}${difference} (${percentDiff}%)</div>
            </div>

        </div><br>`;

    drawChart(client);
    document.getElementById('mostCommon').textContent = `${client.mostCommon?.title || 'N/A'} (${client.mostCommon?.amount || 0})`;
    document.getElementById('leastCommon').textContent = `${client.leastCommon?.title || 'N/A'} (${client.leastCommon?.amount || 0})`;

    const avg = (client.trend.reduce((a, b) => a + b, 0) / client.trend.length).toFixed(2);
    const minimum = Math.min(...client.trend);
    const maximum = Math.max(...client.trend);

    document.getElementById('averageTrend').textContent = avg;
    document.getElementById('minTrend').textContent = minimum;
    document.getElementById('maxTrend').textContent = maximum;

}

function generateTimeLabels(length) {
    const now = new Date();
    const labels = [];

    for (let i = 0; i < length; i++) {
        const labelTime = new Date(now.getTime() - (length - 1 - i) * 4 * 60 * 60 * 1000);
        labels.push(labelTime.toLocaleTimeString('en-US', {
            hour: 'numeric',
            hour12: true,
            minute: '2-digit'
        }));
    }
    return labels;
}

function drawChart(client) {
    const ctx = document.getElementById('chart').getContext('2d');
    if (chartInstance) {
        chartInstance.destroy();
    }
    const gradient = ctx.createLinearGradient(0, 0, 0, 400);
    const isGain = client.trend[client.trend.length - 1] <= client.trend[0];
    gradient.addColorStop(0, isGain ? 'rgba(0,200,0,0.4)' : 'rgba(255,0,0,0.4)');
    gradient.addColorStop(1, 'rgba(255,255,255,0)');

    chartInstance = new Chart(ctx, {
        type: 'line',
        data: {
            labels: generateTimeLabels(client.trend.length),
            datasets: [{
                label: '# of Incidents',
                data: client.trend,
                fill: {
                    target: 'start',
                    below: gradient    // And blue below the origin
                  },
                backgroundColor: gradient,
                borderColor: isGain ? 'green' : 'red',
                tension: 0
            },{
                label: 'Start',
                data: [client.trend[0],client.trend[0],client.trend[0],client.trend[0],client.trend[0],client.trend[0],client.trend[0],client.trend[0],client.trend[0],client.trend[0],client.trend[0]],
                segment: {
                    borderColor: '#A6A6A6',
                    borderDash: [14, 14],
                  },
                spanGaps: true,
                pointStyle: 'circle',
                radius: 0, // Set radius to 0 to hide points
                // fill: {
                //     target: 'start',
                //     below: gradient    // And blue below the origin
                //   },
                // backgroundColor: gradient,
                // borderColor: isGain ? 'green' : 'red',
                tension: 0
            }
        ]
        },
        options: {
            responsive: true,
            scales: {
                x: {
                    title: { display: false, text: 'Time' },
                    grid: {
                        display: false
                    }
                },
                y: {
                    title: { display: false, text: 'Incidents' },
                    beginAtZero: true,
                    border: {
                        dash: [5, 5],
                        display: true
                      } ,
                    grid: {
                        // color: "#348632",
                        display: true,
                        tickLength: 2,
                        lineWidth: 1,
                        drawTicks: false
                    },
                    ticks: {
                        stepSize: 1,
                        callback: function(value) {
                          return Number.isInteger(value) ? value : null;
                        },
                        maxTicksLimit: 5
                      }
                }
            },
            plugins: {
                legend: { display: true }
            }
        }
    });
}
function renderRecentChangesBar(clients) {
    const bar = document.getElementById('recent-bar');
    bar.innerHTML = '';

    const label = document.createElement('div');
    label.className = 'recent-label';
    label.textContent = 'Recent';
    bar.appendChild(label);

    const sorted = [...clients]
        .map(c => ({
            ...c,
            absChange: Math.abs(c.percentChange || 0)
        }))
        .sort((a, b) => b.absChange - a.absChange)
        .slice(0, 10);

    sorted.forEach(client => {
        const item = document.createElement('div');
        item.className = 'recent-item';

        const arrow = document.createElement('span');
        arrow.className = 'recent-arrow';
        arrow.textContent = client.percentChange >= 0 ? '▲' : '▼';
        arrow.style.color = client.percentChange <= 0 ? 'green' : 'red';

        const name = document.createElement('span');
        name.textContent = `${client.name} (${client.percentChange > 0 ? '+' : ''}${client.percentChange}%)`;

        item.appendChild(arrow);
        item.appendChild(name);
        bar.appendChild(item);
    });
}
function updateRangeBar(trend) {
    const min = Math.min(...trend);
    const max = Math.max(...trend);
    const current = trend[trend.length - 1];

    // Update range bar labels
    document.getElementById('range-min-label').textContent = min;
    document.getElementById('range-max-label').textContent = max;
    document.getElementById('range-value-label').textContent = current;

    const dot = document.getElementById('range-dot');
    const label = document.getElementById('range-value-label');
    const percent = (current - min) / (max - min);
    const left = percent * 100;

    dot.style.left = `calc(${left}% - 6px)`;
    label.style.left = `${left}%`;
}

loadConfigURL();
document.addEventListener('DOMContentLoaded', () => {
    const sortLabel = document.getElementById('sort-label');
    const sortOptionsMenu = document.getElementById('sort-options-menu');
  
    sortLabel.addEventListener('click', () => {
      sortOptionsMenu.style.display =
        sortOptionsMenu.style.display === 'block' ? 'none' : 'block';
    });
  
    document.querySelectorAll('.custom-sort-options div').forEach(option => {
      option.addEventListener('click', () => {
        const sortValue = option.getAttribute('data-sort');
        applySort(sortValue);
        sortOptionsMenu.style.display = 'none';
      });
    });
  
    // Optional: hide menu when clicking outside
    document.addEventListener('click', (e) => {
      if (!document.getElementById('sort-dropdown-wrapper').contains(e.target)) {
        sortOptionsMenu.style.display = 'none';
      }
    });
  });
  
  // You can modify this to suit your existing sort function
  function applySort(sortValue) {
    console.log("Apply sorting by:", sortValue);
    let sorted = [...dummyClients];

    switch (sortValue) {
        case 'alpha-asc':
            sorted.sort((a, b) => a.name.localeCompare(b.name));
            break;
        case 'alpha-desc':
            sorted.sort((a, b) => b.name.localeCompare(a.name));
            break;
        case 'inc-high':
            sorted.sort((a, b) => b.incidents - a.incidents);
            break;
        case 'inc-low':
            sorted.sort((a, b) => a.incidents - b.incidents);
            break;
        case 'change-high':
            sorted.sort((a, b) => Math.abs(b.percentChange) - Math.abs(a.percentChange));
            break;
        case 'change-low':
            sorted.sort((a, b) => Math.abs(a.percentChange) - Math.abs(b.percentChange));
            break;
    }
    dummyClients = sorted;
    renderClients();
  }
