import os
import requests
import platform
import subprocess
import stat
import sys

if platform.system() == "Linux":
    print("installing on Linux")
else:
    print("Please run the installer for your OS")
    sys.exit(1)

DownloadURL = "https://raw.githubusercontent.com/discomal101/System-Monitor/refs/heads/main/MonitoredMachine/serverlinux.js"
DownloadFileName = "server.js"
scriptDirectory = os.path.dirname(os.path.abspath(__file__))
TargetFolder = os.path.join(scriptDirectory, "systemMonitoring")


def download_file(url, dest_folder, filename):
    """Download a file from `url` into `dest_folder` with the given `filename`.

    Creates `dest_folder` if it doesn't exist and streams the download to disk.
    Returns the destination path on success, or None on failure.
    """
    os.makedirs(dest_folder, exist_ok=True)
    dest_path = os.path.join(dest_folder, filename)

    try:
        with requests.get(url, stream=True) as resp:
            resp.raise_for_status()
            with open(dest_path, 'wb') as f:
                for chunk in resp.iter_content(chunk_size=8192):
                    if chunk:
                        f.write(chunk)
        print(f"Downloaded {filename} to {dest_path}")
        return dest_path
    except requests.RequestException as e:
        print(f"Failed to download {url}: {e}")
        return None


def create_shell():
    """Create a small shell script that runs the downloaded server from its folder."""
    content = f"""#!/usr/bin/env bash
set -e
cd "$(dirname "$0")"
# start node in foreground (systemd or cron should handle backgrounding). Logs go to server.log
exec /usr/bin/env node "{DownloadFileName}" >> server.log 2>&1
"""
    shell_path = os.path.join(TargetFolder, "start_server.sh")
    with open(shell_path, "w") as f:
        f.write(content)
    # make executable
    st = os.stat(shell_path)
    os.chmod(shell_path, st.st_mode | stat.S_IXUSR | stat.S_IXGRP | stat.S_IXOTH)
    print(f"Created shell start script: {shell_path}")


def create_systemd_user_service():
    """Create and enable a systemd --user service. Returns True on success, False otherwise."""
    user_systemd_dir = os.path.expanduser("~/.config/systemd/user")
    os.makedirs(user_systemd_dir, exist_ok=True)
    service_name = "system-monitor.service"
    service_path = os.path.join(user_systemd_dir, service_name)
    service_content = f"""[Unit]
Description=System Monitor Node Server

[Service]
Type=simple
WorkingDirectory={TargetFolder}
ExecStart=/usr/bin/env node {os.path.join(TargetFolder, DownloadFileName)}
Restart=on-failure
Environment=NODE_ENV=production

[Install]
WantedBy=default.target
"""
    with open(service_path, "w") as f:
        f.write(service_content)
    print(f"Wrote systemd user service: {service_path}")

    try:
        subprocess.run(["systemctl", "--user", "daemon-reload"], check=True)
        subprocess.run(["systemctl", "--user", "enable", "--now", service_name], check=True)
        print(f"Enabled and started systemd user service: {service_name}")
        return True
    except (subprocess.CalledProcessError, FileNotFoundError) as e:
        print(f"Failed to enable systemd user service: {e}")
        return False


def create_cron_job():
    """Fall back to adding an @reboot cron job for the current user."""
    cron_cmd = f'@reboot cd "{TargetFolder}" && nohup /usr/bin/env node "{os.path.join(TargetFolder, DownloadFileName)}" >/dev/null 2>&1 &'
    try:
        result = subprocess.run(["crontab", "-l"], capture_output=True, text=True)
        existing = result.stdout if result.returncode == 0 else ""
    except FileNotFoundError:
        print("crontab not found on this system; cannot install cron job.")
        return False

    if cron_cmd in existing:
        print("Cron @reboot entry already exists; skipping.")
        return True

    new_cron = existing + "\n" + cron_cmd + "\n"
    try:
        subprocess.run(["crontab", "-"], input=new_cron, text=True, check=True)
        print("Installed @reboot cron job for current user.")
        return True
    except subprocess.CalledProcessError as e:
        print(f"Failed to install cron job: {e}")
        return False


if __name__ == "__main__":
    downloaded = download_file(DownloadURL, TargetFolder, DownloadFileName)
    if not downloaded:
        print("Download failed; aborting installation.")
        sys.exit(1)

    create_shell()

    ok = create_systemd_user_service()
    if not ok:
        print("Falling back to cron @reboot entry.")
        create_cron_job()

    print("Installation complete. If Node.js is not installed, install it and start the service manually with systemctl --user start system-monitor.service (or re-login).")