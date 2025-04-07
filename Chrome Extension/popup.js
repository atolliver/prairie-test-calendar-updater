import { ensureLoggedIn, getCalendarProvider } from "/oauth.js";
import { SYNC_TAG } from "/background.js";

let DEBUG_MODE = true;

// Spinner helpers
function showSpinner() {
  document.getElementById("spinner").style.display = "block";
}
function hideSpinner() {
  document.getElementById("spinner").style.display = "none";
}

// Create a long-lived connection to the background script:
const port = chrome.runtime.connect({ name: "popup" });

// Listen for any messages from background
port.onMessage.addListener((message) => {
  if (message.action === "deletionResults") {
    hideSpinner();
    const { provider, deleted } = message;
    const status = document.getElementById("status");
    const eventLog = document.getElementById("eventLog");
    const label = provider === "google" ? "Google" : "Outlook";

    if (DEBUG_MODE) {
      console.log(`Received deletion results for ${label}:`, deleted);
    }

    if (deleted.length === 0) {
      status.textContent = `No ${label} events found to delete.`;
      eventLog.innerHTML = `<div>No ${label} events to delete.</div>`;
    } else {
      status.textContent = `Deleted ${deleted.length} ${label} events.`;
      eventLog.innerHTML = deleted
        .map((ev) => {
          const name = typeof ev === "object" ? ev.name : ev;
          const calendar = typeof ev === "object" ? ` (${ev.calendar})` : "";
          return `<div>✓ ${name}${calendar}</div>`;
        })
        .join("");
    }
  }
});

// Initialize debug checkbox and restore settings
document.addEventListener("DOMContentLoaded", () => {
  chrome.storage.local.get(["debug_mode"], ({ debug_mode }) => {
    DEBUG_MODE = !!debug_mode;
    document.getElementById("debugToggle").checked = DEBUG_MODE;
  });

  document.getElementById("debugToggle").addEventListener("change", (e) => {
    DEBUG_MODE = e.target.checked;
    chrome.storage.local.set({ debug_mode: DEBUG_MODE });
  });

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

// Force Sync button
document.getElementById("forceSync").addEventListener("click", () => {
  const status = document.getElementById("status");
  const eventLog = document.getElementById("eventLog");

  status.textContent = "Syncing exams... please wait.";
  eventLog.innerHTML = "";
  showSpinner();

  chrome.storage.local.get("lastExamState", (data) => {
    const examData = data.lastExamState || "";
    chrome.runtime.sendMessage({
      action: "syncCalendar",
      examData,
    });
    status.textContent = "Sync triggered.";
    hideSpinner();
  });
});

// Delete All button
document.getElementById("deleteAll").addEventListener("click", async () => {
  const status = document.getElementById("status");
  const eventLog = document.getElementById("eventLog");

  status.textContent = "Deleting events... please wait.";
  eventLog.innerHTML = "";
  showSpinner();

  const provider = await getCalendarProvider();
  const token = await ensureLoggedIn(provider);
  if (!token) {
    if (DEBUG_MODE) {
      console.error("Login required to delete events");
    }
    status.textContent = "Login required.";
    hideSpinner();
    return;
  }

  chrome.runtime.sendMessage({ action: "deleteAllExams" });
});

// Push Test Event button
document.getElementById("testPush-btn").addEventListener("click", async () => {
  const status = document.getElementById("status");
  const eventLog = document.getElementById("eventLog");

  status.textContent = "Pushing test event...";
  eventLog.innerHTML = "";
  showSpinner();

  const provider = await getCalendarProvider();
  const token = await ensureLoggedIn(provider);

  if (!token) {
    if (DEBUG_MODE) {
      console.error("Login required.");
    }
    status.textContent = "Login required to push test event.";
    hideSpinner();
    return;
  }

  const { calendar_name, event_notes } = await new Promise((resolve) =>
    chrome.storage.local.get(["calendar_name", "event_notes"], resolve)
  );

  const eventName = "PrairieTest Demo Event";
  const eventDescription =
    (event_notes || "This is a test event") + ` ${SYNC_TAG}`;
  const calendarTarget = calendar_name || "primary";

  const start = new Date(Date.now() + 5 * 60 * 1000);
  const end = new Date(Date.now() + 35 * 60 * 1000);

  if (provider === "outlook") {
    const calendarId = await getOutlookCalendarId(token);

    const event = {
      subject: eventName,
      start: { dateTime: start.toISOString(), timeZone: "UTC" },
      end: { dateTime: end.toISOString(), timeZone: "UTC" },
      location: { displayName: "Demo Location" },
      body: { contentType: "HTML", content: eventDescription },
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
      status.textContent = "Event pushed to Outlook!";
    } else {
      if (DEBUG_MODE) {
        console.error("Outlook push failed:", result);
      }
      status.textContent = "Failed to push event to Outlook.";
    }
    hideSpinner();
  } else if (provider === "google") {
    const event = {
      summary: eventName,
      start: { dateTime: start.toISOString(), timeZone: "America/Chicago" },
      end: { dateTime: end.toISOString(), timeZone: "America/Chicago" },
      location: "Demo Location",
      description: eventDescription,
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
      status.textContent = "Event pushed to Google Calendar!";
    } else {
      if (DEBUG_MODE) {
        console.error("Google push failed:", result);
      }
      status.textContent = "Failed to push event to Google Calendar.";
    }
    hideSpinner();
  }
});

// Reset Tokens button
document.getElementById("resetTokens").addEventListener("click", () => {
  const status = document.getElementById("status");
  const eventLog = document.getElementById("eventLog");

  status.textContent = "Clearing tokens...";
  eventLog.innerHTML = "";
  showSpinner();

  chrome.storage.local.remove(["ms_token", "google_token"], () => {
    status.textContent = "Tokens cleared.";
    hideSpinner();
  });
});

// Helper for Outlook calendar fetching
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

  return null;
}
