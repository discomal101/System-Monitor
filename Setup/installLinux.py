#!/usr/bin/env python3
"""
System Monitor Linux Installer
Downloads and configures the monitoring server to run at startup
"""

import os
import requests
import platform
import subprocess
import stat
import sys
import shutil
import json

def print_header(text):
    """Print a formatted header"""
    print("\n" + "=" * 60)
    print(f"  {text}")
    print("=" * 60 + "\n")

def print_step(step_num, text):
    """Print a numbered step"""
    print(f"\n[Step {step_num}] {text}")

def confirm(prompt):
    """Get user confirmation"""
    while True:
        response = input(f"\n{prompt} (yes/no): ").strip().lower()
        if response in ['yes', 'y']:
            return True
        elif response in ['no', 'n']:
            return False
        else:
            print("Please enter 'yes' or 'no'")

def get_local_ip():
    """Get the local IP address"""
    try:
        import socket
        hostname = socket.gethostname()
        ip = socket.gethostbyname(hostname)
        return ip
    except:
        return None

def validate_port(port_str):
    """Validate if port is valid"""
    try:
        port = int(port_str)
        return 1024 <= port <= 65535
    except:
        return False

def validate_url(url):
    """Validate if URL is accessible"""
    try:
        response = requests.head(url, timeout=5)
        return response.status_code < 400
    except:
        try:
            response = requests.get(url, timeout=5)
            return response.status_code < 400
        except:
            return False

def download_file(url, dest_folder, filename):
    """
    Download a file from `url` into `dest_folder` with the given `filename`.
    Creates `dest_folder` if it doesn't exist and streams the download to disk.
    Returns the destination path on success, or None on failure.
    """
    os.makedirs(dest_folder, exist_ok=True)
    dest_path = os.path.join(dest_folder, filename)

    try:
        print(f"\n  Downloading from: {url}")
        with requests.get(url, stream=True, timeout=30) as resp:
            resp.raise_for_status()
            total_size = int(resp.headers.get('content-length', 0))
            downloaded = 0
            with open(dest_path, 'wb') as f:
                for chunk in resp.iter_content(chunk_size=8192):
                    if chunk:
                        f.write(chunk)
                        downloaded += len(chunk)
                        if total_size:
                            percent = (downloaded / total_size) * 100
                            print(f"  Downloaded: {percent:.1f}%", end='\r')
        print(f"\n  ✓ Downloaded to {dest_path}")
        return dest_path
    except requests.RequestException as e:
        print(f"\n  ✗ Failed to download: {e}")
        return None

def check_nodejs():
    """Check if Node.js is installed"""
    try:
        result = subprocess.run(['node', '--version'], capture_output=True, text=True)
        version = result.stdout.strip()
        print(f"  ✓ Node.js found: {version}")
        return True
    except FileNotFoundError:
        print("  ✗ Node.js is not installed")
        print("    Install with: sudo apt-get install nodejs npm")
        return False

def check_npm_package(package_name):
    """Check if an npm package is installed globally"""
    try:
        result = subprocess.run(['npm', 'list', '-g', package_name], 
                              capture_output=True, text=True)
        return result.returncode == 0
    except:
        return False

def install_npm_packages(target_folder, packages):
    """Install npm packages in the target folder"""
    try:
        print(f"\n  Installing npm packages: {', '.join(packages)}")
        os.chdir(target_folder)
        for package in packages:
            subprocess.run(['npm', 'install', package], 
                         capture_output=True, text=True, check=True)
            print(f"  ✓ Installed {package}")
        return True
    except subprocess.CalledProcessError as e:
        print(f"  ✗ Failed to install packages: {e}")
        return False
    except Exception as e:
        print(f"  ✗ Error: {e}")
        return False

def create_package_json(target_folder):
    """Create a basic package.json"""
    package_path = os.path.join(target_folder, "package.json")
    package_content = {
        "name": "system-monitor",
        "version": "1.0.0",
        "description": "System monitoring server for ServerStats",
        "main": "server.js",
        "scripts": {
            "start": "node server.js"
        },
        "dependencies": {}
    }
    
    try:
        with open(package_path, 'w') as f:
            json.dump(package_content, f, indent=2)
        print(f"  ✓ Created package.json")
        return True
    except Exception as e:
        print(f"  ✗ Failed to create package.json: {e}")
        return False

def create_shell(target_folder):
    """Create a small shell script that runs the downloaded server from its folder."""
    content = """#!/usr/bin/env bash
set -e
cd "$(dirname "$0")"
# start node in foreground (systemd or cron should handle backgrounding). Logs go to server.log
exec /usr/bin/env node "server.js" >> server.log 2>&1
"""
    shell_path = os.path.join(target_folder, "start_server.sh")
    try:
        with open(shell_path, "w") as f:
            f.write(content)
        # make executable
        st = os.stat(shell_path)
        os.chmod(shell_path, st.st_mode | stat.S_IXUSR | stat.S_IXGRP | stat.S_IXOTH)
        print(f"  ✓ Created startup script: {shell_path}")
        return True
    except Exception as e:
        print(f"  ✗ Failed to create startup script: {e}")
        return False

def create_systemd_user_service(target_folder, port, service_name="system-monitor"):
    """Create and enable a systemd --user service. Returns True on success, False otherwise."""
    user_systemd_dir = os.path.expanduser("~/.config/systemd/user")
    os.makedirs(user_systemd_dir, exist_ok=True)
    service_filename = f"{service_name}.service"
    service_path = os.path.join(user_systemd_dir, service_filename)
    
    service_content = f"""[Unit]
Description=System Monitor Node Server
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
WorkingDirectory={target_folder}
ExecStart=/usr/bin/env node {os.path.join(target_folder, 'server.js')}
Restart=on-failure
RestartSec=10
Environment=NODE_ENV=production
Environment=MONITOR_PORT={port}

[Install]
WantedBy=default.target
"""
    try:
        with open(service_path, "w") as f:
            f.write(service_content)
        print(f"  ✓ Created systemd user service: {service_path}")

        subprocess.run(["systemctl", "--user", "daemon-reload"], check=True, 
                      capture_output=True)
        subprocess.run(["systemctl", "--user", "enable", service_filename], check=True,
                      capture_output=True)
        subprocess.run(["systemctl", "--user", "start", service_filename], check=True,
                      capture_output=True)
        print(f"  ✓ Enabled and started systemd user service: {service_filename}")
        return True
    except (subprocess.CalledProcessError, FileNotFoundError) as e:
        print(f"  ✗ Failed to setup systemd user service: {e}")
        return False

def create_cron_job(target_folder):
    """Fall back to adding an @reboot cron job for the current user."""
    cron_cmd = f'@reboot cd "{target_folder}" && /usr/bin/env node "server.js" >> server.log 2>&1'
    try:
        result = subprocess.run(["crontab", "-l"], capture_output=True, text=True)
        existing = result.stdout if result.returncode == 0 else ""
    except FileNotFoundError:
        print("  ✗ crontab not found on this system; cannot install cron job.")
        return False

    if cron_cmd in existing:
        print("  ✓ Cron @reboot entry already exists; skipping.")
        return True

    new_cron = existing + "\n" + cron_cmd + "\n"
    try:
        subprocess.run(["crontab", "-"], input=new_cron, text=True, check=True)
        print("  ✓ Installed @reboot cron job for current user.")
        return True
    except subprocess.CalledProcessError as e:
        print(f"  ✗ Failed to install cron job: {e}")
        return False

def main():
    # Platform check
    if platform.system() != "Linux":
        print_header("System Check Failed")
        print(f"This installer is for Linux only.")
        print(f"Your system: {platform.system()}")
        sys.exit(1)

    print_header("System Monitor - Linux Installer")
    print("This script will download and configure the monitoring server.")

    # Step 1: Get download URL
    print_step(1, "Download Configuration")
    while True:
        download_url = "https://raw.githubusercontent.com/discomal101/System-Monitor/refs/heads/main/MonitoredMachine/serverlinux.js"
        
        print(f"\nValidating URL: {download_url}")
        if validate_url(download_url):
            print("  ✓ URL is valid and accessible")
            break
        else:
            print("  ✗ URL is not accessible. Please try again.")
            if not confirm("Try a different URL?"):
                print("Installation cancelled.")
                sys.exit(0)

    # Step 2: Confirm installation path
    print_step(2, "Installation Path")
    script_directory = os.path.dirname(os.path.abspath(__file__))
    target_folder = os.path.join(script_directory, "systemMonitoring")
    print(f"  Installation path: {target_folder}")
    
    if os.path.exists(target_folder):
        print(f"  ⚠ Directory already exists")
        if not confirm("Overwrite existing installation?"):
            print("Installation cancelled.")
            sys.exit(0)
        try:
            shutil.rmtree(target_folder)
            print("  ✓ Removed existing directory")
        except Exception as e:
            print(f"  ✗ Failed to remove directory: {e}")
            sys.exit(1)

    # Step 3: Configure port
    print_step(3, "Port Configuration")
    default_port = 3022
    while True:
        port_input = input(f"\nEnter the port for monitoring server\n(or press Enter for default {default_port}): ").strip()
        
        if not port_input:
            port = default_port
            print(f"  ✓ Using default port: {port}")
            break
        
        if validate_port(port_input):
            port = int(port_input)
            print(f"  ✓ Port set to: {port}")
            break
        else:
            print(f"  ✗ Invalid port. Please enter a number between 1024-65535")

    # Step 4: Check prerequisites
    print_step(4, "Checking Prerequisites")
    if not check_nodejs():
        if not confirm("Node.js is required. Continue anyway?"):
            print("Installation cancelled.")
            sys.exit(0)

    # Step 5: Download server
    print_step(5, "Downloading Server File")
    downloaded = download_file(download_url, target_folder, "server.js")
    if not downloaded:
        print("\nDownload failed. Installation cancelled.")
        sys.exit(1)

    # Step 6: Setup npm dependencies
    print_step(6, "Setting Up Dependencies")
    create_package_json(target_folder)
    required_packages = ['express', 'cors', 'systeminformation']
    if not install_npm_packages(target_folder, required_packages):
        if not confirm("Failed to install npm packages. Continue anyway?"):
            print("Installation cancelled.")
            sys.exit(0)

    # Step 7: Create startup script
    print_step(7, "Creating Startup Script")
    create_shell(target_folder)

    # Step 8: Configure startup
    print_step(8, "Configuring Startup")
    print("\nChoose how to run the server at startup:")
    print("  1) systemd user service (recommended)")
    print("  2) cron @reboot job")
    print("  3) Manual startup (I'll start it manually)")
    
    choice = input("\nSelect option (1-3): ").strip()
    
    startup_configured = False
    if choice == '1':
        print("\nSetting up systemd user service...")
        startup_configured = create_systemd_user_service(target_folder, port)
    elif choice == '2':
        print("\nSetting up cron @reboot job...")
        startup_configured = create_cron_job(target_folder)
    elif choice == '3':
        print("\nManual startup selected.")
        startup_configured = True
    else:
        print("Invalid selection. Skipping startup configuration.")

    # Final summary
    print_header("Installation Complete")
    
    if startup_configured:
        print("✓ Server is configured to run at startup")
    else:
        print("⚠ Startup configuration was skipped or failed")
    
    print(f"\nServer location: {target_folder}")
    print(f"Log file: {os.path.join(target_folder, 'server.log')}")
    
    # Get local IP for connection info
    local_ip = get_local_ip()
    print(f"\n" + "=" * 60)
    print("CONNECTION INFORMATION")
    print("=" * 60)
    print(f"\nServer Port: {port}")
    print(f"\nConnection Methods:")
    print(f"\n  1. From the SAME device (running dashboard on this machine):")
    print(f"     Address: localhost:{port}")
    print(f"     Example: http://localhost:{port}/api/machine")
    
    if local_ip:
        print(f"\n  2. From a DIFFERENT device (running dashboard on another machine):")
        print(f"     Address: {local_ip}:{port}")
        print(f"     Example: http://{local_ip}:{port}/api/machine")
    else:
        print(f"\n  2. From a DIFFERENT device (running dashboard on another machine):")
        print(f"     Address: <device-ip>:{port}")
        print(f"     (Replace <device-ip> with the IP address of this machine)")
    
    print(f"\nIn the ServerStats Dashboard, enter:")
    print(f"  • Port or host:port: localhost:{port}  (if same device)")
    print(f"  • Port or host:port: {local_ip}:{port}  (if different device)" if local_ip else f"  • Port or host:port: <ip>:{port}  (if different device)")
    print("=" * 60)
    
    print(f"\nTo manually start the server:")
    print(f"  cd {target_folder}")
    print(f"  node server.js")
    
    if choice == '1':
        print("\nTo manage the service:")
        print("  systemctl --user status system-monitor    # Check status")
        print("  systemctl --user restart system-monitor   # Restart")
        print("  systemctl --user stop system-monitor      # Stop")
    
    print("\nView logs:")
    print(f"  tail -f {os.path.join(target_folder, 'server.log')}")
    
    print("\n✓ Installation successful!")

if __name__ == "__main__":
    try:
        main()
    except KeyboardInterrupt:
        print("\n\nInstallation cancelled by user.")
        sys.exit(0)
    except Exception as e:
        print(f"\n✗ Unexpected error: {e}")
        sys.exit(1)