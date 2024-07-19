let startTime;
let timerInterval;
let timerDisplay;

function startTimer() {
  startTime = Date.now();
  timerInterval = setInterval(updateTimer, 1000);
  timerDisplay = document.getElementById('timerDisplay');
}

function stopTimer() {
  clearInterval(timerInterval);
  const endTime = Date.now();
  const elapsedTime = (endTime - startTime) / 1000; // Convert to seconds
  saveTimerData(elapsedTime);
}

function updateTimer() {
  const currentTime = Date.now();
  const elapsedTime = Math.floor((currentTime - startTime) / 1000); // Convert to seconds
  const minutes = Math.floor(elapsedTime / 60);
  const seconds = elapsedTime % 60;
  timerDisplay.textContent = `Timer: ${minutes.toString().padStart(2, '0')}:${seconds.toString().padStart(2, '0')}`;
}

function saveTimerData(elapsedTime) {
  const incidentNumber = document.getElementById('incidentNumber').value;
  const clientDropdown = document.getElementById('clientDropdown');
  const client = clientDropdown.value;
  const projectCode = clientDropdown.options[clientDropdown.selectedIndex].dataset.projectCode;
  const timerData = `${incidentNumber},${client},${projectCode},${elapsedTime}\n`;
  
  // Create a Blob with the CSV data
  const blob = new Blob([timerData], { type: 'text/csv' });
  
  // Create a download link and trigger the download
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.style.display = 'none';
  a.href = url;
  a.download = 'timer_data.csv';
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}



document.getElementById('loadButton').addEventListener('click', function() {
  startTimer();
});


document.getElementById('saveButton').addEventListener('click', function() {
  // Stop the timer and save the timer data
  stopTimer();

  // Get the populated template content
  const noteContent = document.getElementById('populatedTemplate').value;

  // Get the incident number
  const incidentNumber = document.getElementById('incidentNumber').value;

  // Create a Blob with the note content
  const blob = new Blob([noteContent], { type: 'text/plain' });

  // Create a download link and trigger the download
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.style.display = 'none';
  a.href = url;
  a.download = `INC-${incidentNumber}.txt`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);

  // Close the popup or perform any other necessary actions
  document.getElementById('savePopup').style.display = 'none';
});
