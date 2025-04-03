import { MICROSOFT_CLIENT_ID } from "/Secrets.js";

export const SYNC_TAG = "<!-- prairietest:sync -->";
const REDIRECT_URI = `https://${chrome.runtime.id}.chromiumapp.org/`;
const SCOPE = "https://graph.microsoft.com/Calendars.ReadWrite offline_access";

chrome.runtime.onStartup.addListener(() => {
  refreshTokenIfNeeded();
});

import { refreshWithGoogle } from "/oauth.js";

chrome.runtime.onStartup.addListener(() => {
  refreshTokenIfNeeded(); // existing
  refreshGoogleIfNeeded(); // new
});

async function refreshGoogleIfNeeded() {
  chrome.storage.local.get("google_token", async ({ google_token }) => {
    if (!google_token?.refresh_token) return;

    try {
      const newToken = await refreshWithGoogle(google_token.refresh_token);
      if (newToken.access_token) {
        chrome.storage.local.set({ google_token: newToken });
        console.log("✅ Google token refreshed.");
      }
    } catch (err) {
      console.warn("❌ Google token refresh failed:", err);
    }
  });
}

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.action === "examChanged") {
    chrome.storage.local.get(["lastExamState"], (data) => {
      const oldState = data.lastExamState || "";
      if (oldState !== message.examData) {
        console.log("📅 Exam data changed. Syncing calendar...");
        chrome.storage.local.set({ lastExamState: message.examData });
        chrome.runtime.sendMessage({
          action: "syncCalendar",
          examData: message.examData,
        });
      } else {
        console.log("📅 No change in exam data, skipping sync.");
      }
    });
  }

  if (message.action === "syncCalendar") {
    try {
      const exams = JSON.parse(message.examData);
      chrome.storage.local.get(
        ["preferredCalendar"],
        async ({ preferredCalendar }) => {
          if (preferredCalendar === "google") {
            await syncWithGoogleCalendar(exams);
          } else {
            await syncWithOutlookCalendar(exams);
          }
        }
      );
    } catch (err) {
      console.error("Calendar sync error:", err);
    }
  }

  if (message.action === "deleteAllExams") {
    chrome.storage.local.get(
      ["preferredCalendar"],
      async ({ preferredCalendar }) => {
        if (preferredCalendar === "google") {
          await deleteAllGoogleEvents();
        } else {
          await deleteAllOutlookEvents();
        }
      }
    );
  }
});

// OUTLOOK SYNC
async function syncWithOutlookCalendar(exams) {
  return new Promise((resolve) => {
    chrome.storage.local.get(
      ["ms_token", "calendarName", "eventNotes"],
      async ({ ms_token, calendarName, eventNotes }) => {
        if (!ms_token?.access_token) {
          console.warn("Not logged in to Microsoft");
          return resolve("No token");
        }

        const token = ms_token.access_token;
        const calendarId = await getOrCreateOutlookCalendar(
          token,
          calendarName
        );
        if (!calendarId) return resolve("No calendar ID available.");

        const eventsRes = await fetch(
          `https://graph.microsoft.com/v1.0/me/calendars/${calendarId}/events?$top=100`,
          { headers: { Authorization: `Bearer ${token}` } }
        );
        const existing = await eventsRes.json();
        const existingEvents = (existing.value || []).reduce((map, ev) => {
          const key = `${ev.subject}::${getDurationMinutes(ev)}`;
          map[key] = ev;
          return map;
        }, {});

        const created = [];
        const updated = [];
        const skipped = [];

        for (const exam of exams) {
          const key = `${exam.name}::${getDurationMinutes(exam.duration)}`;
          const existingEvent = existingEvents[key];
          const start = parseExamDateTime(exam.date);
          if (!start) continue;
          const end = new Date(
            start.getTime() + getDurationMinutes(exam.duration) * 60000
          );

          const newEvent = {
            subject: exam.name,
            start: { dateTime: start.toISOString(), timeZone: "UTC" },
            end: { dateTime: end.toISOString(), timeZone: "UTC" },
            location: { displayName: exam.location },
            body: {
              contentType: "HTML",
              content: `${eventNotes || "Synced Automatically"} ${SYNC_TAG}`,
            },
          };

          if (existingEvent) {
            const locationChanged =
              (existingEvent.location?.displayName || "").trim() !==
              exam.location.trim();

            if (locationChanged) {
              console.log(`Updating event: ${exam.name}`);
              const updateRes = await fetch(
                `https://graph.microsoft.com/v1.0/me/calendars/${calendarId}/events/${existingEvent.id}`,
                {
                  method: "PATCH",
                  headers: {
                    Authorization: `Bearer ${token}`,
                    "Content-Type": "application/json",
                  },
                  body: JSON.stringify(newEvent),
                }
              );

              if (updateRes.ok) {
                console.log(`Updated event: ${exam.name}`);
                updated.push(key);
              } else {
                const err = await updateRes.json();
                console.warn(`Failed to update event: ${exam.name}`, err);
              }
            } else {
              console.log(`Skipped unchanged event: ${exam.name}`);
              skipped.push(key);
            }
          } else {
            const createRes = await fetch(
              `https://graph.microsoft.com/v1.0/me/calendars/${calendarId}/events`,
              {
                method: "POST",
                headers: {
                  Authorization: `Bearer ${token}`,
                  "Content-Type": "application/json",
                },
                body: JSON.stringify(newEvent),
              }
            );

            if (createRes.ok) {
              console.log(`Created new event: ${exam.name}`);
              created.push(key);
            } else {
              const err = await createRes.json();
              console.warn(`Failed to create event: ${exam.name}`, err);
            }
          }
        }

        console.log(
          `✅ Outlook sync complete. Created: ${created.length}, Updated: ${updated.length}, Skipped: ${skipped.length}`
        );
        resolve("Outlook sync finished");
      }
    );
  });
}

// GOOGLE SYNC
async function syncWithGoogleCalendar(exams) { 
  return new Promise((resolve) => {
    chrome.storage.local.get(
      ["google_token", "calendarName", "eventNotes"],
      async (data) => {
        if (!data.google_token?.access_token) {
          console.warn("Not logged in to Google");
          return resolve("No token");
        }

        const token = data.google_token.access_token;
        const calendarId = data.calendarName || "primary";
        const notes = data.eventNotes || "Synced Automatically";
        const created = [];
        const updated = [];
        const skipped = [];

        const eventsRes = await fetch(
          `https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(
            calendarId
          )}/events?maxResults=2500`,
          {
            headers: { Authorization: `Bearer ${token}` },
          }
        );
        const existingData = await eventsRes.json();
        const existing = existingData.items || [];

        const existingMap = {};
        for (const ev of existing) {
          const key = `${ev.summary}::${getDurationMinutes(ev)}`;
          existingMap[key] = ev;
        }

        for (const exam of exams) {
          const key = `${exam.name}::${getDurationMinutes(exam.duration)}`;
          const existingEvent = existingMap[key];

          const start = parseExamDateTime(exam.date);
          if (!start) continue;
          const end = new Date(
            start.getTime() + getDurationMinutes(exam.duration) * 60000
          );

          const event = {
            summary: exam.name,
            location: exam.location,
            description: `${notes} ${SYNC_TAG}`,
            start: {
              dateTime: start.toISOString(),
              timeZone: "America/Chicago",
            },
            end: { dateTime: end.toISOString(), timeZone: "America/Chicago" },
          };

          if (existingEvent) {
            const locationChanged =
              (existingEvent.location || "").trim() !== exam.location.trim();

            if (locationChanged) {
              console.log(`Updating Google event: ${exam.name}`);
              const updateRes = await fetch(
                `https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(
                  calendarId
                )}/events/${existingEvent.id}`,
                {
                  method: "PATCH",
                  headers: {
                    Authorization: `Bearer ${token}`,
                    "Content-Type": "application/json",
                  },
                  body: JSON.stringify(event),
                }
              );

              if (updateRes.ok) {
                updated.push(exam.name);
              } else {
                const err = await updateRes.json();
                console.warn(`❌ Failed to update event: ${exam.name}`, err);
              }
            } else {
              skipped.push(exam.name);
            }
          } else {
            const res = await fetch(
              `https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(
                calendarId
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

            if (res.ok) {
              created.push(exam.name);
            } else {
              const err = await res.json();
              console.warn(
                `❌ Failed to create Google event: ${exam.name}`,
                err
              );
            }
          }
        }

        console.log(
          `🔁 Google sync complete. Created: ${created.length}, Updated: ${updated.length}, Skipped: ${skipped.length}`
        );
        resolve("Google sync finished");
      }
    );
  });
}

// DELETE OUTLOOK
async function deleteAllOutlookEvents() {
  chrome.storage.local.get(
    ["ms_token", "calendar_name", "event_tag", "debug_mode"],
    async ({ ms_token, calendar_name, event_tag, debug_mode }) => {
      if (!ms_token?.access_token) return;
      const token = ms_token.access_token;
      const calendarId = await getOrCreateOutlookCalendar(token, calendar_name);
      const tag = event_tag || "PT_EXAM";
      const deleted = [];

      const eventsRes = await fetch(
        `https://graph.microsoft.com/v1.0/me/calendars/${calendarId}/events?$top=100`,
        {
          headers: { Authorization: `Bearer ${token}` },
        }
      );

      const events = (await eventsRes.json()).value || [];
      for (const ev of events) {
        if (ev.body?.content?.includes(tag)) {
          await fetch(
            `https://graph.microsoft.com/v1.0/me/calendars/${calendarId}/events/${ev.id}`,
            {
              method: "DELETE",
              headers: { Authorization: `Bearer ${token}` },
            }
          );
          deleted.push(ev.subject);
        }
      }

      if (debug_mode) {
        console.log("🔍 Deleted Outlook events:", deleted);
      }
      console.log(
        `🧹 Outlook cleanup complete. Deleted: ${deleted.length} events.`
      );
    }
  );
}

// DELETE GOOGLE
async function deleteAllGoogleEvents() {
  chrome.storage.local.get(
    ["google_token", "calendar_name", "event_tag", "debug_mode"],
    async ({ google_token, calendar_name, event_tag, debug_mode }) => {
      if (!google_token?.access_token) return;
      const token = google_token.access_token;
      const calendarId = calendar_name || "primary";
      const tag = event_tag || "PT_EXAM";
      const deleted = [];

      const res = await fetch(
        `https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(
          calendarId
        )}/events?maxResults=2500`,
        {
          headers: { Authorization: `Bearer ${token}` },
        }
      );

      const data = await res.json();
      const events = data.items || [];

      for (const ev of events) {
        if (ev.description?.includes(tag)) {
          await fetch(
            `https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(
              calendarId
            )}/events/${ev.id}`,
            {
              method: "DELETE",
              headers: { Authorization: `Bearer ${token}` },
            }
          );
          deleted.push(ev.summary);
        }
      }

      if (debug_mode) {
        console.log("🔍 Deleted Google events:", deleted);
      }
      console.log(
        `🧹 Google cleanup complete. Deleted: ${deleted.length} events.`
      );
    }
  );
}

// UTILS

function parseExamDateTime(dateStr) {
  const normalized = dateStr.replace(/\u00A0/g, " ").trim();
  const noZone = normalized.replace(/\(.*?\)/, "").trim();
  const regex =
    /^([A-Za-z]{3}),\s*([A-Za-z]{3})\s+(\d{1,2}),?\s+(\d{1,2})(?::(\d{2}))?\s*(am|pm)$/i;
  const match = noZone.match(regex);
  if (!match) return null;

  const [, , monthStr, dayStr, hourStr, minuteStr = "0", meridian] = match;
  const months = {
    Jan: 0,
    Feb: 1,
    Mar: 2,
    Apr: 3,
    May: 4,
    Jun: 5,
    Jul: 6,
    Aug: 7,
    Sep: 8,
    Oct: 9,
    Nov: 10,
    Dec: 11,
  };
  const month = months[monthStr];
  const day = parseInt(dayStr, 10);
  let hour = parseInt(hourStr, 10);
  const minute = parseInt(minuteStr, 10);
  if (meridian.toLowerCase() === "pm" && hour !== 12) hour += 12;
  if (meridian.toLowerCase() === "am" && hour === 12) hour = 0;

  return new Date(new Date().getFullYear(), month, day, hour, minute);
}

function getDurationMinutes(duration) {
  if (typeof duration === "object" && duration.start && duration.end) {
    const start = new Date(duration.start.dateTime);
    const end = new Date(duration.end.dateTime);
    return Math.round((end - start) / 60000);
  }

  const match = duration.match(/(\d+)\s*h\s*(\d+)?\s*min?/i);
  if (match) {
    const hours = parseInt(match[1], 10);
    const minutes = parseInt(match[2] || "0", 10);
    return hours * 60 + minutes;
  }

  const short = duration.match(/(\d+)\s*min/i);
  return short ? parseInt(short[1], 10) : 60;
}

async function getOrCreateOutlookCalendar(token, calendarName) {
  // Use default calendar if no custom name is given
  if (!calendarName) {
    const res = await fetch("https://graph.microsoft.com/v1.0/me/calendar", {
      headers: { Authorization: `Bearer ${token}` },
    });

    const data = await res.json();
    if (!res.ok || !data.id) {
      console.warn("Failed to get default Outlook calendar:", data);
      return null;
    }
    return data.id;
  }

  // Check if the named calendar already exists
  const list = await fetch("https://graph.microsoft.com/v1.0/me/calendars", {
    headers: { Authorization: `Bearer ${token}` },
  });

  const data = await list.json();
  if (!list.ok || !Array.isArray(data.value)) {
    console.warn("Failed to list Outlook calendars:", data);
    return null;
  }

  const found = data.value.find((c) => c.name === calendarName);
  if (found) return found.id;

  // Create new calendar
  const create = await fetch("https://graph.microsoft.com/v1.0/me/calendars", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ name: calendarName }),
  });

  const result = await create.json();
  if (!create.ok || !result.id) {
    console.warn("Failed to create Outlook calendar:", result);
    return null;
  }

  return result.id;
}

async function refreshTokenIfNeeded() {
  chrome.storage.local.get("ms_token", async ({ ms_token }) => {
    if (!ms_token?.refresh_token) return;

    try {
      const newToken = await refreshWithMicrosoft(ms_token.refresh_token);
      if (newToken.access_token) {
        chrome.storage.local.set({ ms_token: newToken });
        console.log("Successfully refreshed Microsoft token.");
      }
    } catch (err) {
      console.warn("Microsoft token refresh failed:", err);
    }
  });
}

async function refreshWithMicrosoft(refresh_token) {
  const tokenUrl = "https://login.microsoftonline.com/common/oauth2/v2.0/token";
  const bodyParams = new URLSearchParams({
    client_id: MICROSOFT_CLIENT_ID,
    grant_type: "refresh_token",
    refresh_token,
    redirect_uri: REDIRECT_URI,
    scope: SCOPE,
  });

  const resp = await fetch(tokenUrl, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: bodyParams.toString(),
  });
  if (!resp.ok) {
    const err = await resp.json().catch(() => ({}));
    throw new Error("Refresh failed: " + JSON.stringify(err));
  }
  return resp.json();
}
