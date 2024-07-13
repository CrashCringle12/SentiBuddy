let startTime;
let timerInterval;

function startTimer() {
  startTime = Date.now();
  timerInterval = setInterval(updateTimer, 1000);
}

function stopTimer() {
  clearInterval(timerInterval);
  const endTime = Date.now();
  const elapsedTime = (endTime - startTime) / 1000; // Convert to seconds
  saveTimerData(elapsedTime);
}

function updateTimer() {
  const currentTime = Date.now();
  const elapsedTime = (currentTime - startTime) / 1000; // Convert to seconds
  console.log(`Elapsed time: ${elapsedTime} seconds`);
}

function saveTimerData(elapsedTime) {
  const incidentNumber = document.getElementById('incidentNumber').value;
  const clientDropdown = document.getElementById('clientDropdown');
  const client = clientDropdown.value;
  const projectCode = clientDropdown.options[clientDropdown.selectedIndex].dataset.projectCode;
  const timerData = `${incidentNumber},${client},${projectCode},${elapsedTime}`;
  console.log('Timer data being sent:', timerData); // Add this line
  fetch('/save-timer-data', {
    method: 'POST',
    headers: {
      'Content-Type': 'text/plain'
    },
    body: timerData
  })
    .then(response => response.text())
    .then(message => {
      console.log(message);
    })
    .catch(error => {
      console.error('Error saving timer data:', error);
    });
}