import { ensureLoggedIn, getCalendarProvider } from "/oauth.js";
import { SYNC_TAG } from "/background.js";

let DEBUG_MODE = true;

// Create a long-lived connection to the background script:
const port = chrome.runtime.connect({ name: "popup" });

// Listen for any messages from background
port.onMessage.addListener((message, portSender) => {
  if (message.action === "deletionResults") {
    const { provider, deleted } = message;
    const status = document.getElementById("status");
    const label = provider === "google" ? "Google" : "Outlook";

    if (DEBUG_MODE) {
      if (deleted.length === 0) {
        console.log(`No ${label} events deleted.`);
      } else {
        console.log(`Deleted ${label} events:`, deleted);
      }
    }

    if (deleted.length === 0) {
      status.textContent = `No ${label} events found to delete.`;
    } else {
      status.textContent = `Deleted ${deleted.length} ${label} events.`;
    }
  }
});

// Initialize debug checkbox
document.addEventListener("DOMContentLoaded", () => {
  chrome.storage.local.get(["debug_mode"], ({ debug_mode }) => {
    DEBUG_MODE = !!debug_mode;
    document.getElementById("debugToggle").checked = DEBUG_MODE;
  });

  document.getElementById("debugToggle").addEventListener("change", (e) => {
    DEBUG_MODE = e.target.checked;
    chrome.storage.local.set({ debug_mode: DEBUG_MODE });
  });
});

// Restore user preferences on popup load
document.addEventListener("DOMContentLoaded", () => {
  const calendarToggle = document.getElementById("calendarChoice");
  const calendarNameInput = document.getElementById("calendarName");
  const eventNotesInput = document.getElementById("eventNotes");

  chrome.storage.local.get(
    ["preferredCalendar", "calendar_name", "event_notes"],
    ({ preferredCalendar, calendar_name, event_notes }) => {
      if (preferredCalendar) calendarToggle.value = preferredCalendar;
      if (calendar_name) calendarNameInput.value = calendar_name;
      if (event_notes) eventNotesInput.value = event_notes;
    }
  );

  calendarToggle.addEventListener("change", () => {
    chrome.storage.local.set({ preferredCalendar: calendarToggle.value });
  });
  calendarNameInput.addEventListener("input", () => {
    chrome.storage.local.set({
      calendar_name: calendarNameInput.value.trim(),
    });
  });
  eventNotesInput.addEventListener("input", () => {
    chrome.storage.local.set({
      event_notes: eventNotesInput.value.trim(),
    });
  });
});

// Force sync button
document.getElementById("forceSync").addEventListener("click", () => {
  document.getElementById("status").textContent = "Triggering sync...";
  chrome.storage.local.get("lastExamState", (data) => {
    const examData = data.lastExamState || "";
    chrome.runtime.sendMessage({
      action: "syncCalendar",
      examData,
    });
    document.getElementById("status").textContent = "Sync triggered.";
  });
});

// Delete all button
document.getElementById("deleteAll").addEventListener("click", async () => {
  const provider = await getCalendarProvider();
  const token = await ensureLoggedIn(provider);
  if (!token) {
    console.error("Login required to delete events");
    document.getElementById("status").textContent = "Login required.";
    return;
  }

  // We'll rely on the background script to do the deletion,
  // and then the background script will send us "deletionResults"
  chrome.runtime.sendMessage({ action: "deleteAllExams" });
});

// "Push Test Event" button
document.getElementById("testPush-btn").addEventListener("click", async () => {
  const provider = await getCalendarProvider();
  const token = await ensureLoggedIn(provider);

  if (!token) {
    console.error("Login required.");
    document.getElementById("status").textContent =
      "Login required to push test event.";
    return;
  }

  const { calendar_name, event_notes } = await new Promise((resolve) =>
    chrome.storage.local.get(["calendar_name", "event_notes"], resolve)
  );

  const eventName = "PrairieTest Demo Event";
  const eventDescription = event_notes || "This is a test event";
  const calendarTarget = calendar_name || "primary";

  const start = new Date(Date.now() + 5 * 60 * 1000);
  const end = new Date(Date.now() + 35 * 60 * 1000);

  // Outlook or Google
  if (provider === "outlook") {
    const calendarId = await getOutlookCalendarId(token);

    const event = {
      subject: eventName,
      start: {
        dateTime: start.toISOString(),
        timeZone: "UTC",
      },
      end: {
        dateTime: end.toISOString(),
        timeZone: "UTC",
      },
      location: { displayName: "Demo Location" },
      body: {
        contentType: "HTML",
        content: `${eventDescription} ${SYNC_TAG}`,
      },
    };

    const response = await fetch(
      `https://graph.microsoft.com/v1.0/me/calendars/${calendarId}/events`,
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
      if (DEBUG_MODE) {
        console.log("Outlook event created:", result);
      }
      document.getElementById("status").textContent =
        "Event pushed to Outlook!";
    } else {
      if (DEBUG_MODE) {
        console.error("Outlook push failed:", result);
      }
      document.getElementById("status").textContent =
        "Failed to push event to Outlook.";
    }
  } else if (provider === "google") {
    const event = {
      summary: eventName,
      start: {
        dateTime: start.toISOString(),
        timeZone: "America/Chicago",
      },
      end: {
        dateTime: end.toISOString(),
        timeZone: "America/Chicago",
      },
      location: "Demo Location",
      description: `${eventDescription} ${SYNC_TAG}`,
    };

    const response = await fetch(
      `https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(
        calendarTarget
      )}/events`,
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
      if (DEBUG_MODE) {
        console.log("Google event created:", result);
      }
      document.getElementById("status").textContent =
        "Event pushed to Google Calendar!";
    } else {
      if (DEBUG_MODE) {
        console.error("Google push failed:", result);
      }
      document.getElementById("status").textContent =
        "Failed to push event to Google Calendar.";
    }
  }
});

async function getOutlookCalendarId(token) {
  const { calendar_name, prairieTestCalendarId } = await new Promise(
    (resolve) =>
      chrome.storage.local.get(
        ["calendar_name", "prairieTestCalendarId"],
        resolve
      )
  );

  const name = calendar_name?.trim();
  if (!name) {
    const res = await fetch("https://graph.microsoft.com/v1.0/me/calendar", {
      headers: { Authorization: `Bearer ${token}` },
    });
    const defaultCal = await res.json();
    return defaultCal.id;
  }

  if (prairieTestCalendarId) return prairieTestCalendarId;

  const listRes = await fetch("https://graph.microsoft.com/v1.0/me/calendars", {
    headers: { Authorization: `Bearer ${token}` },
  });
  const data = await listRes.json();
  const calendar = data.value.find((c) => c.name === name);
  if (calendar) {
    chrome.storage.local.set({ prairieTestCalendarId: calendar.id });
    return calendar.id;
  }

  const createRes = await fetch(
    "https://graph.microsoft.com/v1.0/me/calendars",
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ name }),
    }
  );
  const newCal = await createRes.json();
  if (newCal?.id) {
    chrome.storage.local.set({ prairieTestCalendarId: newCal.id });
    return newCal.id;
  }

  throw new Error("Failed to create Outlook calendar");
}

document.getElementById("resetTokens").addEventListener("click", () => {
  chrome.storage.local.remove(["ms_token", "google_token"], () => {
    document.getElementById("status").textContent = "Tokens cleared.";
    if (DEBUG_MODE) {
      console.log("🔄 Tokens cleared.");
    }
  });
});
