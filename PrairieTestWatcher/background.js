chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  console.log("Received message in background.js:", message);

  if (message.action === "examChanged") {
      fetch("http://127.0.0.1:5000/run-script", { method: "POST" })
          .then(response => response.text())
          .then(data => {
              console.log("Script executed:", data);
              sendResponse({ status: "success", message: "Script executed successfully" });
          })
          .catch(error => {
              console.error("Error running script:", error);
              sendResponse({ status: "error", message: error.toString() });
          });
      return true;  // Keep message channel open for async response
  }
});