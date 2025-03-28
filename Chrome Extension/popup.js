import { authenticateWithGoogle, loginWithMicrosoft } from "./oauth.js";

document.getElementById("forceSync-btn").addEventListener("click", () => {
  document.getElementById("status").textContent = "Triggering sync...";
  chrome.storage.local.get("lastExamState", (data) => {
    const examData = data.lastExamState || "";
    chrome.runtime.sendMessage({ action: "syncCalendar", examData });
    document.getElementById("status").textContent = "Sync triggered.";
  });
});

document.getElementById("ms-login-btn").addEventListener("click", async () => {
  document.getElementById("status").textContent = "Logging in to Microsoft...";
  try {
    const token = await loginWithMicrosoft();
    console.log("Microsoft token:", token);
    document.getElementById("status").textContent = "Logged in successfully!";
  } catch (err) {
    console.error("Microsoft login failed:", err);
    document.getElementById("status").textContent = "Login failed!";
  }
});

document.getElementById("google-login-btn").addEventListener("click", async () => {
  document.getElementById("status").textContent = "Logging in to Google...";
  try {
    const token = await authenticateWithGoogle();
    console.log("Google token:", token);
    document.getElementById("status").textContent = "Logged in successfully!";
  } catch (err) {
    console.error("Google login failed:", err);
    document.getElementById("status").textContent = "Login failed!";
  }
});

document.getElementById("testPush-btn").addEventListener("click", () => {
  chrome.storage.local.get(
    ["preferredCalendar", "ms_token", "google_token"],
    async ({ preferredCalendar, ms_token, google_token }) => {
      const event = {
        summary: "PrairieTest Demo Event",
        subject: "PrairieTest Demo Event",
        start: new Date(Date.now() + 5 * 60 * 1000).toISOString(),
        end: new Date(Date.now() + 35 * 60 * 1000).toISOString(),
        location: "Demo Location",
        description: "This is a test event from the PrairieTest extension",
      };

      if (preferredCalendar === "google") {
        if (!google_token) {
          console.error("No Google token found");
          return;
        }

        const response = await fetch(
          "https://www.googleapis.com/calendar/v3/calendars/primary/events",
          {
            method: "POST",
            headers: {
              Authorization: `Bearer ${google_token}`,
              "Content-Type": "application/json",
            },
            body: JSON.stringify({
              summary: event.summary,
              location: event.location,
              description: event.description,
              start: {
                dateTime: event.start,
                timeZone: "America/Chicago",
              },
              end: {
                dateTime: event.end,
                timeZone: "America/Chicago",
              },
            }),
          }
        );

        const result = await response.json();
        if (response.ok) {
          console.log("Google event created:", result);
          document.getElementById("status").textContent =
            "Google event successfully created!";
        } else {
          console.error("Error creating Google event:", result);
          document.getElementById("status").textContent =
            "Failed to create Google event.";
        }
      } else {
        if (!ms_token?.access_token) {
          console.error("No Microsoft token found");
          return;
        }

        const response = await fetch(
          "https://graph.microsoft.com/v1.0/me/events",
          {
            method: "POST",
            headers: {
              Authorization: `Bearer ${ms_token.access_token}`,
              "Content-Type": "application/json",
            },
            body: JSON.stringify({
              subject: event.subject,
              start: {
                dateTime: event.start,
                timeZone: "Central Standard Time",
              },
              end: {
                dateTime: event.end,
                timeZone: "Central Standard Time",
              },
              location: {
                displayName: event.location,
              },
              body: {
                contentType: "HTML",
                content: event.description,
              },
            }),
          }
        );

        const result = await response.json();
        if (response.ok) {
          console.log("Outlook event created:", result);
          document.getElementById("status").textContent =
            "Outlook event successfully created!";
        } else {
          console.error("Error creating Outlook event:", result);
          document.getElementById("status").textContent =
            "Failed to create Outlook event.";
        }
      }
    }
  );
});

document.addEventListener("DOMContentLoaded", () => {
  const calendarToggle = document.getElementById("calendarChoice");

  chrome.storage.local.get(["preferredCalendar"], ({ preferredCalendar }) => {
    if (preferredCalendar) {
      calendarToggle.value = preferredCalendar;
    }
  });

  calendarToggle.addEventListener("change", () => {
    chrome.storage.local.set({ preferredCalendar: calendarToggle.value });
  });
});
