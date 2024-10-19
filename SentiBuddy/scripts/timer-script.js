console.log("Timer content script is running");

// Create the root element
const root = document.createElement("div");
root.id = "extension-timer-root";
root.style.position = "fixed";
root.style.bottom = "24px";
root.style.left = "24px";
root.style.zIndex = "999999";
root.style.backgroundColor = "red";
root.style.padding = "10px";
root.style.color = "white";
root.style.cursor = "pointer";
document.body.appendChild(root);

let startTiming;
let elapsedTime = 0;
let timingInterval;
let isRunning = false;

function updateDisplay() {
  const seconds = Math.floor(elapsedTime / 1000);
  const minutes = Math.floor(seconds / 60);
  const hours = Math.floor(minutes / 60);
  const displayTime = `${hours.toString().padStart(2, '0')}:${(minutes % 60).toString().padStart(2, '0')}:${(seconds % 60).toString().padStart(2, '0')}`;
  root.textContent = displayTime;
}

function startTimer() {
  if (!isRunning) {
    startTiming = Date.now() - elapsedTime;
    timingInterval = setInterval(() => {
      elapsedTime = Date.now() - startTiming;
      updateDisplay();
    }, 1000);
    isRunning = true;
    root.style.backgroundColor = "green";
  }
}

function stopTimer() {
  if (isRunning) {
    clearTimer();
    isRunning = false;
    root.style.backgroundColor = "red";
  }
}

function clearTimer() {
  stopTimer();
  elapsedTime = 0;
  updateDisplay();
}

root.addEventListener("click", () => {
  if (isRunning) {
    stopTimer();
  } else if (elapsedTime > 0) {
    clearTimer();
  } else {
    startTimer();
  }
});

updateDisplay();
console.log("Timer added to the page");