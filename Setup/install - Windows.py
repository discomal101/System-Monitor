# i want a script that downloads a certain file depending on weather the operating system is linux, windows, or mac. what i want the script to do
# 1. check the operating system of the user
# 2. download a certain file depending on that operating system
# 3. check if the user has node installed
# 4. if the user does it asks the user if they want to add it to startup if they enter y add it if they enter n dont add it
# 5. run the file

try:
    import platform
    import subprocess
    import sys
    import os
    import urllib.request
    import shutil
except ImportError as e:
    print(f"Missing module: {e.name}. Please install it and try again.")
    sys.exit(1)

# ---------------- CONFIG ---------------- #

DOWNLOAD_URLS = {
    "Windows": "https://example.com/windows-file.js",
    "Linux": "https://example.com/linux-file.js",
    "Darwin": "https://example.com/mac-file.js",
}

FILE_NAME = "server.js"
INSTALL_DIR = os.path.join(os.environ.get('LOCALAPPDATA', os.path.expanduser('~')), 'system_stats')
SERVICE_NAME = "system_stats"  # task / startup name for Windows

# --------------------------------------- #

def get_os():
    return platform.system()

def download_file(url, path):
    os.makedirs(os.path.dirname(path), exist_ok=True)
    print(f"Downloading from {url}...")
    try:
        urllib.request.urlretrieve(url, path)
    except Exception as e:
        print(f"urllib failed: {e}. Trying PowerShell/curl/wget...")
        ps = shutil.which("powershell") or shutil.which("pwsh")
        if ps:
            try:
                subprocess.run([ps, "-Command", f"Invoke-WebRequest -Uri '{url}' -OutFile '{path}' -UseBasicParsing"], check=True)
            except Exception as e2:
                print(f"PowerShell download failed: {e2}")
        if not os.path.exists(path):
            if shutil.which("curl"):
                subprocess.run(["curl", "-L", "-o", path, url], check=True)
            elif shutil.which("wget"):
                subprocess.run(["wget", "-O", path, url], check=True)
            else:
                raise
    try:
        os.chmod(path, 0o755)
    except Exception:
        pass
    print("Download complete.")

def has_node():
    try:
        result = subprocess.run(["node", "-v"], stdout=subprocess.PIPE, stderr=subprocess.PIPE)
        return result.returncode == 0
    except FileNotFoundError:
        return False

def add_to_startup(os_name, script_path):
    if os_name == "Windows":
        node_path = shutil.which("node") or "node"
        task_name = SERVICE_NAME
        try:
            # Create a scheduled task to run at user logon
            tr = f'{node_path} "{script_path}"'
            subprocess.run(["schtasks", "/Create", "/SC", "ONLOGON", "/TN", task_name, "/TR", tr, "/F"], check=True)
            print(f"Scheduled task '{task_name}' created to run at logon.")
            return
        except Exception as e:
            print(f"schtasks failed: {e}. Falling back to Startup folder.")

        startup = os.path.join(os.environ["APPDATA"], "Microsoft\\Windows\\Start Menu\\Programs\\Startup")
        os.makedirs(startup, exist_ok=True)
        bat_path = os.path.join(startup, f"{SERVICE_NAME}.bat")
        with open(bat_path, "w") as f:
            f.write(f'@echo off\r\n{node_path} "{script_path}"\r\n')
        print("Added to Startup folder.")

    elif os_name == "Linux":
        autostart = os.path.expanduser("~/.config/autostart")
        os.makedirs(autostart, exist_ok=True)
        desktop_file = os.path.join(autostart, "my_app.desktop")
        with open(desktop_file, "w") as f:
            f.write(f"""
                    [Desktop Entry]
                    Type=Application
                    Exec=node {script_path}
                    Hidden=false
                    NoDisplay=false
                    X-GNOME-Autostart-enabled=true
                    Name=My App
                """)

    elif os_name == "Darwin":
        plist = os.path.expanduser("~/Library/LaunchAgents/com.myapp.startup.plist")
        with open(plist, "w") as f:
            f.write(f"""
                <?xml version="1.0" encoding="UTF-8"?>
                <!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN"
                "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
                <plist version="1.0">
                <dict>
                    <key>Label</key>
                    <string>com.myapp.startup</string>
                    <key>ProgramArguments</key>
                    <array>
                        <string>node</string>
                        <string>{script_path}</string>
                    </array>
                    <key>RunAtLoad</key>
                    <true/>
                </dict>
                </plist>
            """)

    print("Added to startup.")

def run_file(script_path):
    subprocess.Popen(["node", script_path], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)

def main():
    os_name = get_os()
    print("Detected OS:", os_name)

    if os_name not in DOWNLOAD_URLS:
        print("Unsupported OS.")
        sys.exit(1)

    if not has_node():
        print("Node.js is not installed.")
        sys.exit(1)

    script_path = os.path.join(INSTALL_DIR, FILE_NAME)
    download_file(DOWNLOAD_URLS[os_name], script_path)

    choice = input("Add to startup? (y/n): ").lower().strip()
    if choice == "y":
        add_to_startup(os_name, script_path)

    run_file(script_path)
    print("App started.")

if __name__ == "__main__":
    main()
