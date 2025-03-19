function detectExamChanges() {
  let exams = document.querySelectorAll('div[data-testid="exam"]');

  if (exams.length > 0) {
    let examData = Array.from(exams).map((exam) => exam.innerText.trim());
    let newExamState = JSON.stringify(examData);

    chrome.storage.local.get(["lastExamState"], (result) => {
      if (result.lastExamState !== newExamState) {
        console.log("Exam updates detected!");
        chrome.storage.local.set({ lastExamState: newExamState });

        chrome.runtime.sendMessage({ action: "exam_updated" });
      }
    });
  }
}

// Run exam detection every 10 seconds
setInterval(detectExamChanges, 10000);
