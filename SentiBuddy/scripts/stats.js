// Create the rootCount element
const rootCount = document.createElement("div");
rootCount.id = "extension-Count-rootCount";
rootCount.style.position = "fixed";
rootCount.style.bottom = "80px";
rootCount.style.left = "24px";
rootCount.style.zIndex = "999999";
rootCount.style.backgroundColor = "red";
rootCount.style.padding = "10px";
rootCount.style.color = "white";
rootCount.style.opacity = "75%"
rootCount.style.cursor = "pointer";
document.body.appendChild(rootCount);

let startCounting;
let elapsedCount = 0;
let CountingInterval;
let isRunning2 = false;

function updateCountDisplay() {
  const incidentCount = document.querySelectorAll(".fxc-gc-row-content.fxc-gc-row-content_0:not([style*='display: none'])").length;
  rootCount.textContent = `Incident Count (Page): ${incidentCount}`;
}

function startCount() {
  if (!isRunning2) {
    startCounting = Date.now() - elapsedCount;
    CountingInterval = setInterval(() => {
      elapsedCount = Date.now() - startCounting;
      updateCountDisplay();
    }, 1000);
    isRunning2 = true;
    rootCount.style.backgroundColor = "green";
  }
}

function stopCount() {
  if (isRunning2) {
    clearCount();
    clearInterval(CountingInterval)
    isRunning2 = false;
    rootCount.style.backgroundColor = "red";
  }
}

function clearCount() {
  stopCount();
  elapsedCount = 0;
  updateCountDisplay();
}

rootCount.addEventListener("click", () => {
  if (isRunning2) {
    stopCount();
  } else if (elapsedCount > 0) {
    clearCount();
  } else {
    startCount();
  }
});

startCount();


console.log("Count added to the page");