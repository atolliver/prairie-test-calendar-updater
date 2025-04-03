import { ensureLoggedIn, getCalendarProvider } from "/oauth.js";
import { SYNC_TAG } from "/background.js";


let DEBUG_MODE = false;

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

document.addEventListener("DOMContentLoaded", () => {
  const calendarToggle = document.getElementById("calendarChoice");
  const calendarNameInput = document.getElementById("calendarName");
  const eventNotesInput = document.getElementById("eventNotes");

  // Restore stored preferences
  chrome.storage.local.get(
    ["preferredCalendar", "calendar_name", "event_notes"],
    ({ preferredCalendar, calendar_name, event_notes }) => {
      if (preferredCalendar) {
        calendarToggle.value = preferredCalendar;
      }
      if (calendar_name) {
        calendarNameInput.value = calendar_name;
      }
      if (event_notes) {
        eventNotesInput.value = event_notes;
      }
    }
  );

  calendarToggle.addEventListener("change", () => {
    chrome.storage.local.set({ preferredCalendar: calendarToggle.value });
  });

  calendarNameInput.addEventListener("input", () => {
    chrome.storage.local.set({ calendar_name: calendarNameInput.value.trim() });
  });

  eventNotesInput.addEventListener("input", () => {
    chrome.storage.local.set({ event_notes: eventNotesInput.value.trim() });
  });
});

document.getElementById("forceSync").addEventListener("click", () => {
  document.getElementById("status").textContent = "Triggering sync...";
  chrome.storage.local.get("lastExamState", (data) => {
    const examData = data.lastExamState || "";
    chrome.runtime.sendMessage({ action: "syncCalendar", examData });
    document.getElementById("status").textContent = "Sync triggered.";
  });
});

document.getElementById("deleteAll").addEventListener("click", async () => {
  const provider = await getCalendarProvider();
  const token = await ensureLoggedIn(provider);
  if (!token) {
    console.error("Login required to delete events");
    document.getElementById("status").textContent = "Login required.";
    return;
  }

  if (provider === "outlook") {
    const calendarId = await getOutlookCalendarId(token);
    if (!calendarId) return;

    const res = await fetch(
      `https://graph.microsoft.com/v1.0/me/calendars/${calendarId}/events?$top=100`,
      {
        headers: { Authorization: `Bearer ${token}` },
      }
    );

    const data = await res.json();
    for (const ev of data.value || []) {
      await fetch(
        `https://graph.microsoft.com/v1.0/me/calendars/${calendarId}/events/${ev.id}`,
        {
          method: "DELETE",
          headers: { Authorization: `Bearer ${token}` },
        }
      );
    }

    document.getElementById("status").textContent =
      "All Outlook events deleted.";
  } else if (provider === "google") {
    const res = await fetch(
      "https://www.googleapis.com/calendar/v3/calendars/primary/events?maxResults=1000",
      {
        headers: { Authorization: `Bearer ${token}` },
      }
    );
    const data = await res.json();
    for (const ev of data.items || []) {
      await fetch(
        `https://www.googleapis.com/calendar/v3/calendars/primary/events/${ev.id}`,
        {
          method: "DELETE",
          headers: { Authorization: `Bearer ${token}` },
        }
      );
    }
    document.getElementById("status").textContent =
      "All Google events deleted.";
  }
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

  const { calendar_name, event_notes } = await new Promise((resolve) =>
    chrome.storage.local.get(["calendar_name", "event_notes"], resolve)
  );

  const eventName = "PrairieTest Demo Event";
  const eventDescription = event_notes || "This is a test event";
  const calendarTarget = calendar_name || "primary";

  const start = new Date(Date.now() + 5 * 60 * 1000);
  const end = new Date(Date.now() + 35 * 60 * 1000);

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
        content: `${eventDescription || "Synced Automatically"} ${SYNC_TAG}`,
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
      console.log("Outlook event created:", result);
      document.getElementById("status").textContent =
        "Event pushed to Outlook!";
    } else {
      console.error("Outlook push failed:", result);
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
      console.log("Google event created:", result);
      document.getElementById("status").textContent =
        "Event pushed to Google Calendar!";
    } else {
      console.error("Google push failed:", result);
      document.getElementById("status").textContent =
        "Failed to push event to Google Calendar.";
    }
  }
});

// Helper for Outlook
async function getOutlookCalendarId(token) {
  const { calendar_name, prairieTestCalendarId } = await new Promise(
    (resolve) =>
      chrome.storage.local.get(
        ["calendar_name", "prairieTestCalendarId"],
        resolve
      )
  );

  const name = calendar_name?.trim();

  // If calendar name is blank, use the default calendar
  if (!name) {
    const res = await fetch("https://graph.microsoft.com/v1.0/me/calendar", {
      headers: { Authorization: `Bearer ${token}` },
    });
    const defaultCalendar = await res.json();
    return defaultCalendar.id;
  }

  // Use cached calendar ID if present
  if (prairieTestCalendarId) return prairieTestCalendarId;

  // Search for existing calendar by name
  const res = await fetch("https://graph.microsoft.com/v1.0/me/calendars", {
    headers: { Authorization: `Bearer ${token}` },
  });

  const data = await res.json();
  const calendar = data.value.find((c) => c.name === name);

  if (calendar) {
    chrome.storage.local.set({ prairieTestCalendarId: calendar.id });
    return calendar.id;
  }

  // Create a new one
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

  // Final fallback (shouldn't be hit)
  throw new Error("Failed to get or create Outlook calendar");
}

document.getElementById("resetTokens").addEventListener("click", () => {
  chrome.storage.local.remove(["ms_token", "google_token"], () => {
    document.getElementById("status").textContent = "Tokens cleared.";
    console.log("🔄 Tokens cleared.");
  });
});
