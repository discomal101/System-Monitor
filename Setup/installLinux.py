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
    "Windows": "https://raw.githubusercontent.com/discomal101/System-Monitor/refs/heads/main/MonitoredMachine/serverwindows.js",
    "Linux": "https://raw.githubusercontent.com/discomal101/System-Monitor/refs/heads/main/MonitoredMachine/serverlinux.js",
    "Darwin": "https://raw.githubusercontent.com/discomal101/System-Monitor/refs/heads/main/MonitoredMachine/servermac.js",
}

FILE_NAME = "server.js"
INSTALL_DIR = os.path.expanduser("~/.system_stats")
SERVICE_NAME = "system_stats"  # service/autostart name for Linux

# --------------------------------------- #

def get_os():
    return platform.system()

def download_file(url, path):
    os.makedirs(os.path.dirname(path), exist_ok=True)
    print(f"Downloading from {url}...")
    try:
        urllib.request.urlretrieve(url, path)
    except Exception as e:
        print(f"urllib failed: {e}. Trying wget/curl...")
        if shutil.which("wget"):
            subprocess.run(["wget", "-O", path, url], check=True)
        elif shutil.which("curl"):
            subprocess.run(["curl", "-L", "-o", path, url], check=True)
        else:
            raise
    # make file executable so it can be run directly if needed
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
        startup = os.path.join(
            os.environ["APPDATA"],
            "Microsoft\\Windows\\Start Menu\\Programs\\Startup"
        )
        bat_path = os.path.join(startup, "my_app.bat")
        with open(bat_path, "w") as f:
            f.write(f'node "{script_path}"\n')

    elif os_name == "Linux":
        # Prefer systemd user service (works well for both headless and desktop setups).
        service_dir = os.path.expanduser("~/.config/systemd/user")
        os.makedirs(service_dir, exist_ok=True)
        service_file = os.path.join(service_dir, f"{SERVICE_NAME}.service")
        service_content = f"""[Unit]
Description=System Stats Service
After=network.target

[Service]
ExecStart=/usr/bin/env node {script_path}
Restart=always
RestartSec=5
Environment=NODE_ENV=production
WorkingDirectory={os.path.dirname(script_path)}

[Install]
WantedBy=default.target
"""
        with open(service_file, "w") as f:
            f.write(service_content)
        # try to enable and start the service (user-level systemd)
        try:
            subprocess.run(["systemctl", "--user", "daemon-reload"], check=True)
            subprocess.run(["systemctl", "--user", "enable", "--now", f"{SERVICE_NAME}.service"], check=True)
            print("Added systemd user service and started it.")
            return
        except Exception as e:
            print(f"systemd user service not available or failed: {e}. Falling back to autostart .desktop.")

        autostart = os.path.expanduser("~/.config/autostart")
        os.makedirs(autostart, exist_ok=True)
        desktop_file = os.path.join(autostart, "my_app.desktop")
        with open(desktop_file, "w") as f:
            f.write(f"""[Desktop Entry]
Type=Application
Exec=node {script_path}
Hidden=false
NoDisplay=false
X-GNOME-Autostart-enabled=true
Name=My App
""")
        print("Added to startup (autostart .desktop).")

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

    # For Linux, use a dedicated folder named `SystemMonitor` and the linux-specific filename
    if os_name == "Linux":
        target_dir = os.path.expanduser("~/SystemMonitor")
        filename = "serverlinux.js"
    else:
        target_dir = INSTALL_DIR
        filename = FILE_NAME

    script_path = os.path.join(target_dir, filename)
    os.makedirs(target_dir, exist_ok=True)
    download_file(DOWNLOAD_URLS[os_name], script_path)

    if os_name == "Linux":
        print(f"Created directory: {target_dir}")
        print(f"Downloaded {filename} to {script_path}")
        print("Adding to startup...")
        add_to_startup(os_name, script_path)
        # Try to start it now (service/autostart handler may have already started it)
        try:
            run_file(script_path)
        except Exception:
            pass
        print("Please restart your machine for the startup changes to take effect.")
    else:
        choice = input("Add to startup? (y/n): ").lower().strip()
        if choice == "y":
            add_to_startup(os_name, script_path)

        run_file(script_path)
        print("App started.")

if __name__ == "__main__":
    main()
