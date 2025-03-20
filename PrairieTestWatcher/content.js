let lastExamState = null;
let lastUpdateTime = 0;
const updateInterval = 5000; // Limit updates to once every 5 seconds

function detectExamChanges() {
  console.log("Detecting exam changes...");

  let exams = document.querySelectorAll('div[data-testid="exam"]');
  if (exams.length === 0) {
    console.log("No exams detected.");
    return;
  }

  let newExamState = Array.from(exams).map((exam) => exam.innerText).join(",");

  let currentTime = Date.now();
  if (newExamState !== lastExamState && currentTime - lastUpdateTime > updateInterval) {
    console.log("Exam changes detected, sending update...");
    chrome.runtime.sendMessage({ action: "examChanged" });

    lastExamState = newExamState;
    lastUpdateTime = currentTime;
  }
}

// Run change detection every 3 seconds (adjust as needed)
setInterval(detectExamChanges, 3000);
