chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.action === "triggerScript") {
    fetch("http://localhost:5000/run-script", {
      method: "POST",
    })
      .then((response) => {
        if (response.ok) {
          console.log("Script successfully triggered!");
        } else {
          console.error("Failed to trigger script.");
        }
      })
      .catch((error) => console.error("Error:", error));
  }
});
