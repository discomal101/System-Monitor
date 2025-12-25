import os
import requests
import platform
import shutil

if platform.system() == "Windows":
    print("installing on Windows")
else:
    print("Please run the installer for your OS")

DownloadURL = "https://raw.githubusercontent.com/discomal101/System-Monitor/refs/heads/main/MonitoredMachine/serverwindows.js"
DownloadFileName = "serverwindows.js"
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

def create_batch():
    Content = """
    @echo off
    node serverwindows.js
    """

    batch_file_path = os.path.join(TargetFolder, "start_server.bat")
    with open(batch_file_path, "w") as f:
        f.write(Content)
    print(f"Created batch file: {batch_file_path}")

def add_to_startup():
    startup_folder = os.path.join(os.environ["APPDATA"], "Microsoft\\Windows\\Start Menu\\Programs\\Startup")
    batch_file_path = os.path.join(TargetFolder, "start_server.bat")
    shortcut_path = os.path.join(startup_folder, "start_server.bat")

    shutil.copy(batch_file_path, shortcut_path)
    print(f"Added to startup: {shortcut_path}")

if __name__ == "__main__":
    download_file(DownloadURL, TargetFolder, DownloadFileName)
    create_batch()
    add_to_startup()