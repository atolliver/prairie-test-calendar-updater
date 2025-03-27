const CLIENT_ID = "77fe4d41-e7b9-4ef4-9cfe-bec4f55b8ab4";
const REDIRECT_URI = `https://fpkimbehnffaomhmcedgfaagbiojdbbn.chromiumapp.org/`;
const SCOPE = "https://graph.microsoft.com/Calendars.ReadWrite offline_access";

let lastExamState = null;
const calendar_name = "Exams";
const event_notes = "Synced Automatically";

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
  }

  if (message.action === "syncCalendar") {
    try {
      const exams = JSON.parse(message.examData);
      console.log("Sync Calendar Triggered with:", exams);
      exams.forEach((e) => {
        console.log(
          `- ${e.name}\n  Date: ${e.date}\n  Duration: ${e.duration}\n  Location: ${e.location}\n`
        );
      });

      syncWithOutlookCalendar(exams);
    } catch (err) {
      console.error("Error syncing calendar:", err);
    }
  }
});

/**
 * Attempts to find or create the "Exams" calendar in Outlook
 */
async function getOrCreatePrairieTestCalendar(token) {
  const calendarsRes = await fetch(
    "https://graph.microsoft.com/v1.0/me/calendars",
    {
      headers: { Authorization: `Bearer ${token}` },
    }
  );

  const calendarsJson = await calendarsRes.json();
  let calendar = calendarsJson.value.find((c) => c.name === calendar_name);

  if (!calendar) {
    const createRes = await fetch(
      "https://graph.microsoft.com/v1.0/me/calendars",
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ name: calendar_name }),
      }
    );

    if (!createRes.ok) {
      console.error(`Failed to create ${calendar_name} calendar.`);
      return null;
    }

    calendar = await createRes.json();
  }

  return calendar.id;
}

/**
 * Normal logic: compare times/locations, skip unchanged
 */
async function syncWithOutlookCalendar(exams) {
  return new Promise((resolve) => {
    chrome.storage.local.get(
      ["ms_token", "prairieTestCalendarId"],
      async ({ ms_token, prairieTestCalendarId }) => {
        if (!ms_token?.access_token) {
          console.warn("Not logged in to Microsoft");
          return resolve("No token");
        }

        const token = ms_token.access_token;
        const calendarId =
          prairieTestCalendarId ||
          (await getOrCreatePrairieTestCalendar(token));
        if (!calendarId) return resolve("No calendar ID available.");
        if (!prairieTestCalendarId) {
          chrome.storage.local.set({ prairieTestCalendarId: calendarId });
        }

        // Fetch existing events from that calendar
        const eventsRes = await fetch(
          `https://graph.microsoft.com/v1.0/me/calendars/${calendarId}/events?$top=100`,
          {
            headers: { Authorization: `Bearer ${token}` },
          }
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
          if (!start) {
            console.warn(
              `Could not parse date for exam: ${exam.name} → "${exam.date}"`
            );
            continue;
          }
          const end = new Date(
            start.getTime() + getDurationMinutes(exam.duration) * 60000
          );

          const newEvent = {
            subject: exam.name,
            start: {
              dateTime: start.toISOString(),
              timeZone: "UTC",
            },
            end: {
              dateTime: end.toISOString(),
              timeZone: "UTC",
            },
            location: {
              displayName: exam.location,
            },
            body: {
              contentType: "HTML",
              content: event_notes,
            },
          };

          if (existingEvent) {
            // Compare location
            const locationsMatch =
              (existingEvent.location?.displayName || "").trim() ===
              exam.location.trim();

            if (!locationsMatch) { // temp removed !timesMatch || 
              console.log(`Updating event: ${exam.name}`);

              // if (!timesMatch) {
              //   console.log(
              //     `Time changed:\n- Existing: ${new Date(
              //       existingEvent.start.dateTime
              //     )} to ${new Date(
              //       existingEvent.end.dateTime
              //     )}\n- New:      ${start} to ${end}`
              //   );
              // }
              if (!locationsMatch) {
                console.log(
                  `Location changed:\n- Existing: ${existingEvent.location?.displayName}\n- New:      ${exam.location}`
                );
              }

              // Patch the existing event with the new time/location
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
            // If no event found, create a fresh one
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
          `Sync complete. Created: ${created.length}, Updated: ${updated.length}, Skipped: ${skipped.length}`
        );
        resolve("Sync finished");
      }
    );
  });
}

/**
 * parseExamDateTime:
 *
 * If your machine is physically in Chicago,
 *   new Date(...) is correct for PrairieTest’s “(CDT)” times.
 * If not, you may need a library like Luxon or Day.js Timezone.
 */
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

  // If your system is in Chicago, this local date matches PrairieTest's times
  const localDate = new Date(
    new Date().getFullYear(),
    month,
    day,
    hour,
    minute
  );
  return localDate;
}

/**
 * getDurationMinutes:
 *
 * If exam.duration is "1 h 50 min", parse → 110
 * If it's an object, we handle that too.
 */
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


// On extension startup:
chrome.runtime.onStartup.addListener(() => {
  refreshTokenIfNeeded();
});

async function refreshTokenIfNeeded() {
  chrome.storage.local.get("ms_token", async ({ ms_token }) => {
    if (!ms_token) return;
    if (!ms_token.refresh_token) return;

    // If your ms_token has an 'expires_in' or 'expires_on', check if it's near expiry
    // e.g. if Date.now() > ms_token.expires_on - 60s => refresh

    try {
      const newToken = await refreshWithMicrosoft(ms_token.refresh_token);
      if (newToken.access_token) {
        chrome.storage.local.set({ ms_token: newToken });
        console.log("Successfully refreshed token!");
      }
    } catch (err) {
      console.warn("Refresh token failed:", err);
    }
  });
}

async function refreshWithMicrosoft(refresh_token) {
  const tokenUrl = "https://login.microsoftonline.com/common/oauth2/v2.0/token";
  const bodyParams = new URLSearchParams({
    client_id: CLIENT_ID,  
    grant_type: "refresh_token",
    refresh_token,
    redirect_uri: REDIRECT_URI,
    scope: SCOPE
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
