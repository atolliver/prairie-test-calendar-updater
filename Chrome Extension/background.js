let lastExamState = null;

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.action === "examChanged") {
    chrome.storage.local.get("lastExamState", (data) => {
      const oldState = data.lastExamState || "";

      if (oldState !== message.examData) {
        console.log("Exam data changed. Syncing calendar...");
        chrome.storage.local.set({ lastExamState: message.examData });

        chrome.runtime.sendMessage({
          action: "syncCalendar",
          examData: message.examData,
        });
      } else {
        console.log("No change in exam data, skipping sync.");
      }
    });
    sendResponse({ status: "received" });
  } else if (message.action === "syncCalendar") {
    try {
      const parsed = JSON.parse(message.examData);

      console.log("📅 Sync Calendar Triggered:");
      parsed.forEach((e) => {
        console.log(
          `- ${e.name}\n  Date: ${e.date}\n  Duration: ${e.duration}\n  Location: ${e.location}\n`
        );
      });
    } catch (err) {
      console.error("Failed to parse exam data:", err);
      console.log("Raw examData:", message.examData);
    }

    sendResponse({ status: "sync_started" });
  }
});
