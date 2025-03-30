import { loginWithMicrosoft, authenticateWithGoogle } from "./oauth.js";

document.getElementById("forceSync-btn").addEventListener("click", async () => {
  document.getElementById("status").textContent = "Triggering sync...";

  const provider = await getCalendarProvider();
  const token = await ensureLoggedIn(provider);

  if (!token) {
    document.getElementById("status").textContent =
      "Login required for selected provider.";
    return;
  }

  chrome.storage.local.get("lastExamState", (data) => {
    const examData = data.lastExamState || "";
    chrome.runtime.sendMessage({ action: "syncCalendar", examData });
    document.getElementById("status").textContent = "Sync triggered.";
  });
});

document.getElementById("testPush-btn").addEventListener("click", async () => {
  const provider = await getCalendarProvider();
  const token = await ensureLoggedIn(provider);

  if (!token) {
    console.error("Login required.");
    document.getElementById("status").textContent =
      "Login required to push test event.";
    return;
  }

  // 🔍 DEBUG: Check stored tokens
  chrome.storage.local.get(["google_token", "ms_token"], (data) => {
    console.log("🔑 Stored Google Token:", data.google_token);
    console.log("🔑 Stored Microsoft Token:", data.ms_token);
  });

  if (provider === "outlook") {
    const event = {
      subject: "PrairieTest Demo Event",
      start: {
        dateTime: new Date(Date.now() + 5 * 60 * 1000).toISOString(),
        timeZone: "UTC",
      },
      end: {
        dateTime: new Date(Date.now() + 35 * 60 * 1000).toISOString(),
        timeZone: "UTC",
      },
      location: {
        displayName: "Demo Location",
      },
      body: {
        contentType: "HTML",
        content: "This is a test event from the PrairieTest extension",
      },
    };

    try {
      const response = await fetch(
        "https://graph.microsoft.com/v1.0/me/events",
        {
          method: "POST",
          headers: {
            Authorization: `Bearer ${token}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify(event),
        }
      );

      const result = await response.json();
      if (response.ok) {
        console.log("📅 Outlook event created:", result);
        document.getElementById("status").textContent =
          "Event pushed to Outlook!";
      } else {
        console.error("❌ Outlook push failed:", result);
        document.getElementById("status").textContent =
          "Failed to push event to Outlook.";
      }
    } catch (err) {
      console.error("❗ Outlook push error:", err);
      document.getElementById("status").textContent =
        "Error pushing to Outlook.";
    }
  } else if (provider === "google") {
    chrome.storage.local.get("google_token", async ({ google_token }) => {
      if (!google_token?.access_token) {
        console.error("❌ No Google token available");
        document.getElementById("status").textContent =
          "Login required for Google Calendar.";
        return;
      }

      const event = {
        summary: "PrairieTest Demo Event",
        start: {
          dateTime: new Date(Date.now() + 5 * 60 * 1000).toISOString(),
          timeZone: "America/Chicago",
        },
        end: {
          dateTime: new Date(Date.now() + 35 * 60 * 1000).toISOString(),
          timeZone: "America/Chicago",
        },
        location: "Demo Location",
        description: "This is a test event from the PrairieTest extension",
      };

      try {
        const response = await fetch(
          "https://www.googleapis.com/calendar/v3/calendars/primary/events",
          {
            method: "POST",
            headers: {
              Authorization: `Bearer ${google_token.access_token}`,
              "Content-Type": "application/json",
            },
            body: JSON.stringify(event),
          }
        );

        const result = await response.json();
        if (response.ok) {
          console.log("📅 Google event created:", result);
          document.getElementById("status").textContent =
            "Event pushed to Google Calendar!";
        } else {
          console.error("❌ Google push failed:", result);
          document.getElementById("status").textContent =
            "Failed to push event to Google Calendar.";
        }
      } catch (err) {
        console.error("❗ Google push error:", err);
        document.getElementById("status").textContent =
          "Error pushing to Google Calendar.";
      }
    });
  } else {
    console.error("❌ Unknown provider:", provider);
    document.getElementById("status").textContent =
      "Unknown calendar provider.";
  }
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

async function getCalendarProvider() {
  return new Promise((resolve) => {
    chrome.storage.local.get("preferredCalendar", ({ preferredCalendar }) => {
      resolve(preferredCalendar || "outlook");
    });
  });
}

export async function ensureLoggedIn(provider) {
  return new Promise((resolve) => {
    if (provider === "google") {
      chrome.storage.local.get("google_token", async ({ google_token }) => {
        if (google_token) return resolve(google_token);
        const token = await authenticateWithGoogle();

        return resolve(token);
      });
    } else if (provider === "outlook") {
      chrome.storage.local.get("ms_token", async ({ ms_token }) => {
        if (ms_token?.access_token) return resolve(ms_token.access_token);
        const token = await loginWithMicrosoft();
        return resolve(token?.access_token || null);
      });
    } else {
      console.error("Unknown provider:", provider);
      resolve(null);
    }
  });
}
