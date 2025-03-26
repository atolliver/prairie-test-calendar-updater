let lastExamData = "";
let lastUpdate = 0;
const throttleDelay = 5000; // 5 seconds

function cleanExamName(rawName) {
    return rawName.replace(/\s*\(.*?\)/, "").trim();
  }
  
  function cleanExamLocation(rawLocation) {
    return rawLocation.replace(/^CBTF:\s*/, "").split("\n")[0].trim();
  }
  
  function resolveRelativeDate(dateStr) {
    const now = new Date();
    const local = new Date(now.toLocaleString("en-US", { timeZone: "America/Chicago" }));
  
    if (/^today,/i.test(dateStr)) {
      const formatted = local.toLocaleDateString("en-US", {
        weekday: "short",
        month: "short",
        day: "numeric"
      });
      return dateStr.replace(/^today,/i, formatted);
    }
  
    if (/^tomorrow,/i.test(dateStr)) {
      const tomorrow = new Date(local);
      tomorrow.setDate(tomorrow.getDate() + 1);
      const formatted = tomorrow.toLocaleDateString("en-US", {
        weekday: "short",
        month: "short",
        day: "numeric"
      });
      return dateStr.replace(/^tomorrow,/i, formatted);
    }
  
    return dateStr;
  }  
  
  function cleanDuration(rawDuration) {
    const cleaned = rawDuration.replace(/\u00A0/g, " ").trim(); 
    const parts = cleaned.split(",");
    return parts[0].trim();
  }

  function getExamData() {
    const reservationCard = Array.from(document.querySelectorAll("div.card"))
      .find(card => card.querySelector("h2")?.innerText?.trim() === "Exam reservations");
  
    if (!reservationCard) return [];
  
    const rows = reservationCard.querySelectorAll("li.list-group-item");
    const exams = [];
  
    rows.forEach(row => {
      const nameEl = row.querySelector('[data-testid="exam"] a');
      const dateEl = row.querySelector('[data-testid="date"] span.js-format-date-friendly-live-update');
      const locationEl = row.querySelector('[data-testid="location"]');
      const durationEl = row.querySelector('.col-xxl-4.col-md-6.col-xs-12');
  
      if (!nameEl || !dateEl) return;
  
      const rawDate = dateEl.innerText.trim();
      const exam = {
        name: cleanExamName(nameEl.innerText.trim()),
        date: resolveRelativeDate(rawDate),
        location: cleanExamLocation(locationEl?.innerText || "N/A"),
        duration: cleanDuration(durationEl?.innerText || "N/A"),
    };
  
      exams.push(exam);
    });
  
    console.log("📘 Parsed Exams:");
    exams.forEach(e => {
      console.log(`- ${e.name}\n  Date: ${e.date}\n  Duration: ${e.duration}\n  Location: ${e.location}\n`);
    });
  
    return exams;
  }  

function monitorPrairieTest() {
  const currentTime = Date.now();
  const currentExams = getExamData();
  const currentData = JSON.stringify(currentExams); // serialize for diff check

  if (
    currentData &&
    currentData !== lastExamData &&
    currentTime - lastUpdate > throttleDelay
  ) {
    chrome.runtime.sendMessage({
      action: "examChanged",
      examData: currentData,
    });
    lastExamData = currentData;
    lastUpdate = currentTime;
  }
}

setInterval(monitorPrairieTest, 3000);
