import { loginWithMicrosoft } from "./oauth.js";

document.getElementById("forceSync").addEventListener("click", () => {
  document.getElementById("status").textContent = "Triggering sync...";
  chrome.storage.local.get("lastExamState", (data) => {
    const examData = data.lastExamState || "";
    chrome.runtime.sendMessage({ action: "syncCalendar", examData });
    document.getElementById("status").textContent = "Sync triggered.";
  });
});

document.getElementById("msLogin").addEventListener("click", async () => {
  document.getElementById("status").textContent = "Logging in to Microsoft...";
  try {
    const token = await loginWithMicrosoft(); // new code flow
    console.log("Microsoft token:", token);
    document.getElementById("status").textContent = "Logged in successfully!";
  } catch (err) {
    console.error("Microsoft login failed:", err);
    document.getElementById("status").textContent = "Login failed!";
  }
});

document.getElementById("testPush").addEventListener("click", () => {
  chrome.storage.local.get("ms_token", async ({ ms_token }) => {
    if (!ms_token?.access_token) {
      console.error("No Microsoft token found");
      return;
    }

    const event = {
      subject: "PrairieTest Demo Event",
      start: {
        dateTime: new Date(Date.now() + 5 * 60 * 1000).toISOString(), // 5 min from now
        timeZone: "Central Standard Time",
      },
      end: {
        dateTime: new Date(Date.now() + 35 * 60 * 1000).toISOString(), // 30 min duration
        timeZone: "Central Standard Time",
      },
      location: {
        displayName: "Demo Location",
      },
      body: {
        contentType: "HTML",
        content: "This is a test event from the PrairieTest extension",
      },
    };

    const response = await fetch("https://graph.microsoft.com/v1.0/me/events", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${ms_token.access_token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(event),
    });

    const result = await response.json();
    if (response.ok) {
      console.log("Event created:", result);
      document.getElementById("status").textContent =
        "Event successfully created!";
    } else {
      console.error("Error creating event:", result);
      document.getElementById("status").textContent = "Failed to create event.";
    }
  });
});
