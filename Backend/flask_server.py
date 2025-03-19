from flask import Flask, request
import logging
import subprocess
import os

BACKEND_DIR = os.path.dirname(os.path.abspath(__file__))

app = Flask(__name__)

logging.basicConfig(level=logging.DEBUG)

@app.route('/run-script', methods=['POST'])
def run_script():
    print("Received request to run script.")
    app.logger.info("Running script...")

    # Run the script asynchronously
    try:
        subprocess.Popen(["python", "Backend/Script.py"],
                         cwd="C:/Users/Alex/StudioProjects/Prairie_Test_Calendar")
        return "Script executed", 200
    except Exception as e:
        app.logger.error(f"Error executing script: {e}")
        return "Script execution failed", 500


if __name__ == '__main__':
    app.run(port=5000, debug=True)
