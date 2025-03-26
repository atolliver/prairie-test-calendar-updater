import subprocess
from flask import Flask, request
import multiprocessing
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timedelta
import re
import pytz
from flask import Flask, redirect, request
import json
import requests
import msal
import time
import os
from selenium import webdriver
from selenium.webdriver.common.by import By
from selenium.webdriver.common.keys import Keys
from selenium.webdriver.chrome.options import Options
from selenium.webdriver.support.ui import WebDriverWait
from selenium.webdriver.support import expected_conditions as EC

script_start_time = time.time()  # Capture start time as float
show_window = False

# Set up WebDriver options
chrome_options = Options()
chrome_options.add_argument("--incognito")
chrome_options.add_argument("--disable-extensions")
chrome_options.add_argument("--disable-gpu")
chrome_options.add_argument("--disable-dev-shm-usage")
chrome_options.add_argument("--no-sandbox")
# Enable option below to hide chrome tab
if not show_window:
    # Run headless if not debugging
    chrome_options.add_argument("--headless=new")

# Launch browser
driver = webdriver.Chrome(options=chrome_options)
if show_window:
    driver.maximize_window()

# Right Quadrant {'height': 438, 'width': 702, 'x': 686, 'y': 432}

# Open the login page directly
driver.get("https://us.prairielearn.com/pl/login?service=PrairieTest")

try:
    # Wait for the UIUC login button and click it
    button = WebDriverWait(driver, 10).until(
        EC.element_to_be_clickable(
            (By.XPATH, "//a[contains(@href, '/pl/auth/institution/3/saml/login')]"))
    )
    button.click()
    # print("UIUC login button clicked!")

except Exception as e:
    print(f"Error clicking UIUC login button: {e}")

try:
    # Wait for the email input field
    email_field = WebDriverWait(driver, 10).until(
        EC.visibility_of_element_located((By.ID, "i0116"))
    )
    email_field.send_keys("alex12@illinois.edu")
    email_field.send_keys(Keys.RETURN)
    print("Email entered and submitted!")

except Exception as e:
    print(f"Error entering email: {e}")

try:
    # Wait for the password field
    password_field = WebDriverWait(driver, 10).until(
        EC.visibility_of_element_located((By.ID, "i0118"))
    )

    # Retrieve password securely
    PASSWORD = os.getenv("PRAIRIETEST_PASSWORD")
    if not PASSWORD:
        raise ValueError(
            "Environment variable 'PRAIRIETEST_PASSWORD' is not set.")

    password_field.send_keys(PASSWORD)
    password_field.send_keys(Keys.RETURN)
    print("Password entered and submitted!")

except Exception as e:
    print(f"Error entering password: {e}")

print("Advancing to PrairieTest")
time.sleep(.2)
driver.get("https://us.prairietest.com/")

try:
    login_buttons = driver.find_elements(
        By.XPATH, "//a[contains(@href, 'https://us.prairielearn.com/pl/prairietest/auth')]")
    if login_buttons:
        driver.execute_script("arguments[0].click();", login_buttons[0])
        # print("Final login button clicked instantly via JavaScript!")
    # else:
        # print("Final login button not found.")
except Exception as e:
    print(f"Error clicking final login button: {e}")

try:
    # Check if the UIUC login button exists
    uiuc_login_buttons = driver.find_elements(
        By.XPATH, "//a[contains(@href, '/pl/auth/institution/3/saml/login')]")
    if uiuc_login_buttons:
        driver.execute_script("arguments[0].click();", uiuc_login_buttons[0])
        # print("UIUC login button clicked instantly via JavaScript!")
    # else:
        # print("UIUC login button not found. Continuing without clicking it.")

except Exception as e:
    print(f"Error clicking UIUC login button: {e}")


# Wait for exams to be visible
try:
    WebDriverWait(driver, 5, poll_frequency=0.5).until(
        EC.presence_of_element_located((By.CSS_SELECTOR, 'div[data-testid="exam"]')))

    print("Exam list successfully loaded!")

except Exception as e:
    print(f"Error loading exam list: {e}")

# Extract exam details
exam_name_elements = driver.find_elements(
    By.XPATH, "//div[@data-testid='exam']//a")
exam_data = []  # List to hold extracted exam details

for name_elem in exam_name_elements:
    exam_name = name_elem.text.strip() if name_elem.text else "N/A"
    exam_div = name_elem.find_element(
        By.XPATH, "./ancestor::div[@data-testid='exam']")
    container = exam_div.find_element(By.XPATH, "parent::*")

    # Extract all sub-elements in one call to avoid multiple `find_element` calls
    try:
        date_elem = container.find_element(
            By.CSS_SELECTOR, 'div[data-testid="date"] span.js-format-date-friendly-live-update')
        exam_date = date_elem.text.strip() if date_elem.text else "N/A"
    except:
        exam_date = "N/A"

    try:
        location_elem = container.find_element(
            By.CSS_SELECTOR, 'div[data-testid="location"]')
        exam_location = location_elem.text.strip() if location_elem.text else "N/A"
    except:
        exam_location = "N/A"

    try:
        duration_elem = container.find_element(
            By.XPATH, ".//div[contains(@class, 'col-xxl-4') and contains(@class, 'col-md-6') and contains(@class, 'col-xs-12')]")
        exam_duration = duration_elem.text.strip() if duration_elem.text else "N/A"
    except:
        exam_duration = "N/A"

    # print(f"Extracted Data: Name='{exam_name}', Date='{exam_date}', Location='{exam_location}', Duration='{exam_duration}'") # Debug
    exam_data.append((exam_name, exam_date, exam_location, exam_duration))

# Save to file
with open("Backend\\exam_details.txt", "w", encoding="utf-8") as f:
    f.write("Exam Name, Exam Date, Exam Location, Exam Duration\n")
    f.writelines(f"\"{name}\", \"{date}\", \"{location}\", \"{duration}\"\n" for name,
                 date, location, duration in exam_data)

print("Exam details successfully saved to exam_details.txt")

# # Will keep browser open until user input in terminal
# input("Press Enter to exit and close the browser...")

# Closes all browser windows and ends the WebDriver session
driver.quit()

'''
END PRAIRIETEST CHECK

BEGIN EVENT PARSING AND CALENDAR INTERACTION
'''


# Microsoft API credentials
CLIENT_ID = os.getenv("AZURE_CLIENT_ID")
CLIENT_SECRET = os.getenv("AZURE_CLIENT_SECRET")
TENANT_ID = os.getenv("AZURE_TENANT_ID")
AUTHORITY = f"https://login.microsoftonline.com/{TENANT_ID}"
REDIRECT_URI = "http://localhost:5000/callback"
SCOPES = ["Calendars.ReadWrite"]

# MSAL app setup
app = msal.ConfidentialClientApplication(
    CLIENT_ID, authority=AUTHORITY, client_credential=CLIENT_SECRET
)

flask_app = Flask(__name__)


@flask_app.route("/")
def login():
    auth_url = app.get_authorization_request_url(
        SCOPES, redirect_uri=REDIRECT_URI)
    return redirect(auth_url)


@flask_app.route("/callback")
def callback():
    auth_code = request.args.get("code")
    token_result = app.acquire_token_by_authorization_code(
        auth_code, SCOPES, redirect_uri=REDIRECT_URI)

    if "access_token" in token_result:
        # Store access & refresh token in a JSON file
        with open("token.json", "w") as token_file:
            json.dump(token_result, token_file)

        return "Authentication successful! Token saved."
    else:
        return f"Authentication failed: {token_result.get('error_description')}"


if __name__ == "__main__":

    if not os.path.exists("token.json"):
        flask_app.run(port=5000, debug=True)
    # else:
    #     print("Token already exists, skipping Flask authentication.")


calendar_id = "AAMkADdjZjViYWJjLTRiZTEtNDdlMC1hMzc1LTFjYzU5MzJmYjkwOQBGAAAAAACD9BeA853jQ5PPw2j8j_AfBwC46U3_r-acQJyslCG-OgDZAAAAAAEGAAC46U3_r-acQJyslCG-OgDZAAFLJcMzAAA="
GRAPH_API_BASE_URL = f"https://graph.microsoft.com/v1.0/me/calendars/{calendar_id}/events"


def get_calendar_events_dict(access_token):
    """Retrieve all calendar events and return them in a dictionary for fast lookup."""
    headers = {"Authorization": f"Bearer {access_token}"}
    response = requests.get(GRAPH_API_BASE_URL, headers=headers)

    if response.status_code == 200:
        events = response.json().get("value", [])
        # Store as a dictionary
        return {clean_exam_name(event["subject"]): event for event in events}
    else:
        print("Error retrieving calendar events:", response.text)
        return {}


def find_existing_event(events_dict, exam_name):
    """Quick lookup for existing events using a dictionary."""
    return events_dict.get(clean_exam_name(exam_name))  # O(1) lookup


def normalize_datetime(iso_datetime):
    """Remove extra precision from timestamps and remove 'Z' suffix to match stored format."""
    return iso_datetime.split(".")[0].replace("Z", "")  # Removes milliseconds & 'Z' suffix


def parse_exam_date_from_string(date_str):
    """Convert a date string like 'Wed, Mar 26, 8pm (CDT)' into ISO format."""
    try:
        # Extract month, day, hour, and AM/PM using regex
        match = re.search(
            r"(\w{3}),\s*(\w{3})\s*(\d{1,2}),\s*(\d{1,2})(am|pm)", date_str, re.IGNORECASE)
        if not match:
            raise ValueError(f"Date format not recognized: {date_str}")

        weekday, month_abbr, day, hour, am_pm = match.groups()
        hour = int(hour)

        # Convert to 24-hour format
        if am_pm.lower() == "pm" and hour != 12:
            hour += 12  # Convert PM to 24-hour format
        elif am_pm.lower() == "am" and hour == 12:
            hour = 0  # Convert 12 AM to 0-hour

        # Convert month abbreviation to number
        month_mapping = {
            "Jan": 1, "Feb": 2, "Mar": 3, "Apr": 4, "May": 5, "Jun": 6,
            "Jul": 7, "Aug": 8, "Sep": 9, "Oct": 10, "Nov": 11, "Dec": 12
        }
        month = month_mapping.get(month_abbr)
        if not month:
            raise ValueError(f"Invalid month abbreviation: {month_abbr}")

        # Determine year (assuming exams are in the current or next year)
        current_year = datetime.now().year
        exam_date = datetime(current_year, month, int(day), hour)

        # Convert to UTC (assuming the exam is in CDT)
        local_tz = pytz.timezone("America/Chicago")
        local_dt = local_tz.localize(exam_date)
        utc_dt = local_dt.astimezone(pytz.utc)

        return utc_dt.strftime("%Y-%m-%dT%H:%M:%SZ")

    except Exception as e:
        print(f"Error parsing exam date: {e}")
        return None  # Ensure function returns None on failure


def add_duration(start_time_iso, duration_hours=0, duration_minutes=0):
    """Adds hours and minutes to an ISO 8601 datetime string."""
    # Convert ISO 8601 string to datetime object
    start_time_obj = datetime.strptime(start_time_iso, "%Y-%m-%dT%H:%M:%SZ")

    # Add duration
    end_time_obj = start_time_obj + \
        timedelta(hours=duration_hours, minutes=duration_minutes)

    # Convert back to ISO 8601 format
    return end_time_obj.strftime("%Y-%m-%dT%H:%M:%SZ")


def clean_exam_name(raw_name):
    """
    Remove the term in parentheses (e.g., '(Sp25)') and strip extra spaces.
    Example: 'CS 173 (Sp25): Final Exam' → 'CS 173: Final Exam'
    """
    return re.sub(r"\s*\(.*?\)", "", raw_name).strip()


def clean_exam_location(raw_location):
    """
    Remove 'CBTF:' and excessive descriptions (e.g., 'Room 057 in the basement of Grainger Library').
    Example: 'CBTF: Grainger Library 057\nRoom 057 in the basement of Grainger Library' → 'Grainger Library 057'
    """
    return re.sub(r"CBTF:\s*", "", raw_location.split("\n")[0]).strip()


def parse_exam_duration(duration_str):
    """
    Convert exam duration from '1 h 50 min' to timedelta object.
    Example: '1 h 50 min' → timedelta(hours=1, minutes=50)
    """
    hours = 0
    minutes = 0

    match = re.findall(r"(\d+)\s*(h|min)", duration_str)
    hours, minutes = 0, 0
    for value, unit in match:
        if unit == "h":
            hours = int(value)
        else:
            minutes = int(value)

    return timedelta(hours=hours, minutes=minutes)


def calculate_end_time(start_time, duration_str):
    """Directly add parsed duration to start_time and return an ISO string."""
    try:
        parsed_duration = parse_exam_duration(duration_str)
        end_time_obj = datetime.fromisoformat(
            start_time) + parsed_duration  # Directly modify datetime
        return end_time_obj.strftime("%Y-%m-%dT%H:%M:%SZ")
    except Exception as e:
        print(f"Error calculating end_time: {e}")
        return None


def update_or_create_event(access_token, subject, start_time, exam_duration, location, events_cache):
    """Create or update an exam event in Outlook Calendar."""
    if not start_time:
        print(f"Skipping event '{subject}' due to missing start_time.")
        return

    subject = clean_exam_name(subject)  # Normalize subject
    location = clean_exam_location(location)  # Normalize location

    if "events_cache" not in locals():
        events_cache = get_calendar_events_dict(access_token)
    existing_event = find_existing_event(events_cache, subject)

    parsed_duration = parse_exam_duration(exam_duration)
    if not parsed_duration:
        print(
            f"Skipping '{subject}' due to invalid duration: '{exam_duration}'")
        return

    end_time = calculate_end_time(start_time, exam_duration)

    headers = {"Authorization": f"Bearer {access_token}",
               "Content-Type": "application/json"}

    if existing_event:
        existing_id = existing_event["id"]
        existing_start = normalize_datetime(
            existing_event["start"]["dateTime"])
        existing_end = normalize_datetime(existing_event["end"]["dateTime"])
        existing_location = clean_exam_location(
            existing_event["location"]["displayName"])  # Normalize

        new_start = normalize_datetime(start_time)
        new_end = normalize_datetime(end_time)

        # # Debugging prints
        # print(f"Checking updates for '{subject}':")
        # print(f"- Start Time: Existing='{existing_start}' vs. New='{new_start}'")
        # print(f"- End Time: Existing='{existing_end}' vs. New='{new_end}'")
        # print(f"- Location: Existing='{existing_location}' vs. New='{location}'")

        if existing_start != new_start or existing_end != new_end or existing_location != location:
            update_url = f"{GRAPH_API_BASE_URL}/{existing_id}"
            updated_event_data = {
                "start": {"dateTime": new_start, "timeZone": "UTC"},
                "end": {"dateTime": new_end, "timeZone": "UTC"},
                "location": {"displayName": location}
            }
            update_response = requests.patch(
                update_url, headers=headers, json=updated_event_data)

            if update_response.status_code == 200:
                print(f"Updated exam '{subject}' with new date or location.")
            else:
                print(f"Error updating event: {update_response.text}")
        else:
            print(f"No updates needed for '{subject}'.")
    else:
        event_data = {
            "subject": subject,
            "start": {"dateTime": start_time, "timeZone": "UTC"},
            "end": {"dateTime": end_time, "timeZone": "UTC"},
            "location": {"displayName": location},
        }

        response = requests.post(
            GRAPH_API_BASE_URL, headers=headers, json=event_data)
        if response.status_code == 201:
            print(f"New exam '{subject}' added successfully!")
        else:
            print(f"Error adding event: {response.text}")


# Microsoft API credentials
AUTHORITY = f"https://login.microsoftonline.com/{TENANT_ID}"
SCOPES = ["Calendars.ReadWrite"]

# MSAL App Instance
app = msal.ConfidentialClientApplication(
    CLIENT_ID, authority=AUTHORITY, client_credential=CLIENT_SECRET
)

# Retrieve a valid access token, refreshing it if necessary
BASE_DIR = os.path.dirname(os.path.abspath(
    __file__))  # Get the script's directory
TOKEN_FILE_PATH = os.path.join(BASE_DIR, "token.json")


def get_access_token():
    """Retrieve an access token from token.json or refresh it if possible."""
    if not os.path.exists(TOKEN_FILE_PATH):
        print(
            f"Token file not found at {TOKEN_FILE_PATH}. Please log in first.")
        return None

    try:
        with open(TOKEN_FILE_PATH, "r") as token_file:
            token_data = json.load(token_file)
    except json.JSONDecodeError:
        print("Error: token.json is corrupted or empty.")
        return None

    if "access_token" in token_data:
        print("Using stored access token.")
        return token_data["access_token"]

    # Check if refresh token is available
    if "refresh_token" in token_data:
        print("Refreshing access token using stored refresh token...")
        new_token = app.acquire_token_by_refresh_token(
            token_data["refresh_token"], SCOPES)

        if "access_token" in new_token:
            print("Access token refreshed successfully! Saving to token.json.")
            with open(TOKEN_FILE_PATH, "w") as token_file:
                json.dump(new_token, token_file)
            return new_token["access_token"]
        else:
            print("Failed to refresh token. Re-authentication required.")
            return None
    else:
        print("No refresh token found in token.json. Please log in again.")
        return None


# Fetch access token
access_token = get_access_token()

if not access_token:
    print("No valid access token available. Please run Flask authentication.")
    exit(1)

# Fetch calendar events once before parallel execution
events_cache = get_calendar_events_dict(access_token)


def process_event(event_data):
    """Process a single event update in parallel."""
    exam_name, exam_date, exam_location, exam_duration = event_data

    if exam_date is None:
        print(f"Skipping event due to missing date for {exam_name}")
        return

    start_time = parse_exam_date_from_string(exam_date)

    update_or_create_event(access_token, exam_name, start_time,
                           exam_duration, exam_location, events_cache)


max_workers = min(10, multiprocessing.cpu_count() * 2)  # Scale based on CPU

with ThreadPoolExecutor(max_workers=max_workers) as executor:
    executor.map(process_event, exam_data)


script_end_time = time.time()  # Capture end time as float
script_elapsed_time = script_end_time - script_start_time  # Compute total time

# Convert seconds to HH:MM:SS format
formatted_time = time.strftime("%H:%M:%S", time.gmtime(script_elapsed_time))

print(f"Total script runtime: {formatted_time}")
