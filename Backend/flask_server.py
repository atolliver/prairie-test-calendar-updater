from flask import Flask, redirect, request
import msal
import os
import json
import logging
import subprocess

BACKEND_DIR = os.path.dirname(os.path.abspath(__file__))

app = Flask(__name__)
logging.basicConfig(level=logging.DEBUG)

CLIENT_ID = os.getenv("AZURE_CLIENT_ID")
CLIENT_SECRET = os.getenv("AZURE_CLIENT_SECRET")
TENANT_ID = os.getenv("AZURE_TENANT_ID")
AUTHORITY = f"https://login.microsoftonline.com/{TENANT_ID}"
REDIRECT_URI = "http://localhost:5000/callback"
SCOPES = ["Calendars.ReadWrite"]

# MSAL App Instance
msal_app = msal.ConfidentialClientApplication(
    CLIENT_ID, authority=AUTHORITY, client_credential=CLIENT_SECRET
)

# Store tokens in this file
TOKEN_FILE = os.path.join(os.path.dirname(__file__), "token.json")


@app.route("/")
def home():
    return "Flask server is running! Visit /login to authenticate."


@app.route("/login")
def login():
    """Redirect user to Microsoft OAuth login"""
    auth_url = msal_app.get_authorization_request_url(
        SCOPES, redirect_uri=REDIRECT_URI)
    return redirect(auth_url)


@app.route("/callback")
def callback():
    """Handle the authentication response and save tokens."""
    auth_code = request.args.get("code")
    if not auth_code:
        return "Authorization failed. Please try again.", 400

    token_result = msal_app.acquire_token_by_authorization_code(
        auth_code, SCOPES, redirect_uri=REDIRECT_URI)

    if "access_token" in token_result:
        token_result["expires_at"] = token_result["expires_in"] + \
            int(os.path.getmtime(TOKEN_FILE))

        with open(TOKEN_FILE, "w") as token_file:
            json.dump(token_result, token_file)

        return "Authentication successful! You can now close this tab."
    else:
        return f"Authentication failed: {token_result.get('error_description')}", 400


@app.route('/run-script', methods=['POST'])
def run_script():
    print("Received request to run script.")
    app.logger.info("Running script...")

    try:
        # Use absolute Python path if needed
        subprocess.Popen(
            ["C:/Users/Alex/anaconda3/python.exe", "Script.py"], cwd=BACKEND_DIR)
        return "Script executed", 200
    except Exception as e:
        app.logger.error(f"Error executing script: {e}", exc_info=True)
        return f"Script execution failed: {e}", 500


if __name__ == "__main__":
    app.run(port=5000, debug=True)
