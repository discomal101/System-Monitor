/**
 * ServerStats Dashboard - Client-side monitoring application
 * Polls and displays server metrics in real-time
 */

// ============================================================================
// CONFIG
// ============================================================================

const CONFIG = {
  STORAGE_KEY: 'serverstats_machines_v1',
  POLL_INTERVAL: 5000, // ms
  HISTORY_MAX: 20,
  FETCH_TIMEOUT: 4000, // ms
};

// ============================================================================
// NOTIFICATIONS - Toast notification system
// ============================================================================

const Notifications = {
  items: [],
  maxItems: 10,

  /**
   * Show notification with type and message
   */
  show(title, message, type = 'info') {
    const id = Date.now() + Math.random();
    const notification = {
      id,
      title,
      message,
      type,
      timestamp: new Date()
    };

    this.items.unshift(notification);
    if (this.items.length > this.maxItems) {
      this.items.pop();
    }

    this.render();
  },

  /**
   * Show error notification
   */
  error(title, message) {
    this.show(title, message, 'error');
  },

  /**
   * Show warning notification
   */
  warning(title, message) {
    this.show(title, message, 'warning');
  },

  /**
   * Show success notification
   */
  success(title, message) {
    this.show(title, message, 'success');
  },

  /**
   * Show info notification
   */
  info(title, message) {
    this.show(title, message, 'info');
  },

  /**
   * Render notifications in the panel
   */
  render() {
    const badge = document.getElementById('notificationBadge');
    const list = document.getElementById('notificationList');

    // Update badge
    const count = this.items.length;
    badge.textContent = count;
    badge.classList.toggle('active', count > 0);

    // Render list
    if (this.items.length === 0) {
      list.innerHTML = '<div class="notification-empty">No notifications</div>';
      return;
    }

    list.innerHTML = this.items.map(notif => `
      <div class="notification-item ${notif.type}">
        <div class="notification-item-icon">
          ${this.getIcon(notif.type)}
        </div>
        <div class="notification-item-content">
          <div class="notification-item-title">${notif.title}</div>
          <div class="notification-item-message">${notif.message}</div>
        </div>
      </div>
    `).join('');
  },

  /**
   * Get icon for notification type
   */
  getIcon(type) {
    const icons = {
      error: '<i class="bi bi-exclamation-circle-fill"></i>',
      warning: '<i class="bi bi-exclamation-triangle-fill"></i>',
      success: '<i class="bi bi-check-circle-fill"></i>',
      info: '<i class="bi bi-info-circle-fill"></i>'
    };
    return icons[type] || icons.info;
  }
};

// ============================================================================
// UTILS - Parsing & URL Building
// ============================================================================

const BindParser = {
  /**
   * Parse input string to {host, port} object
   * Handles: "port", "host:port", "[ipv6]:port"
   */
  parse(input) {
    if (!input) return null;
    const s = String(input).trim();
    
    // bracketed IPv6 like [::1]:3002
    const ipv6Match = s.match(/^\[([^\]]+)\]:(\d+)$/);
    if (ipv6Match) {
      return { 
        host: ipv6Match[1], 
        port: parseInt(ipv6Match[2], 10) 
      };
    }

    const lastColon = s.lastIndexOf(':');
    if (lastColon > 0 && s.indexOf(':') === lastColon) {
      // host:port (IPv4 or hostname)
      const hostPart = s.slice(0, lastColon);
      const portPart = parseInt(s.slice(lastColon + 1), 10);
      if (!portPart || portPart < 1 || portPart > 65535) return null;
      return { host: hostPart || 'localhost', port: portPart };
    }

    const portOnly = parseInt(s.replace(/[^0-9]/g, ''), 10);
    if (!portOnly || portOnly < 1 || portOnly > 65535) return null;
    return { host: 'localhost', port: portOnly };
  },

  /**
   * Convert host:port to full API URL
   */
  toUrl(host, port) {
    const hostPart = (host && host.includes(':') && !host.startsWith('[')) 
      ? `[${host}]` 
      : host;
    return `http://${hostPart}:${port}/api/machine`;
  },

  /**
   * Format host for display (add brackets to IPv6)
   */
  formatDisplay(host) {
    return (host && host.includes(':') && !host.startsWith('[')) 
      ? `[${host}]` 
      : host;
  }
};


// ============================================================================
// STORAGE - Machine persistence
// ============================================================================

const Storage = {
  /**
   * Load machines from localStorage with backward compatibility
   */
  load() {
    try {
      const raw = localStorage.getItem(CONFIG.STORAGE_KEY);
      const list = raw ? JSON.parse(raw) : [];
      
      // Migrate older formats to {host, port, name}
      return list.map(item => {
        if (!item) return null;
        
        if (typeof item === 'string' || typeof item === 'number') {
          const parsed = BindParser.parse(String(item));
          if (!parsed) return null;
          return { host: parsed.host, port: parsed.port, name: '' };
        }
        
        if (item && typeof item.port === 'number' && !item.host) {
          return { host: 'localhost', port: item.port, name: item.name || '' };
        }
        
        return { 
          host: item.host || 'localhost', 
          port: item.port, 
          name: item.name || '' 
        };
      }).filter(Boolean);
    } catch (e) {
      console.error('Failed to load machines', e);
      return [];
    }
  },

  /**
   * Save machines list to localStorage
   */
  save(list) {
    localStorage.setItem(CONFIG.STORAGE_KEY, JSON.stringify(list));
  }
}; 

// ============================================================================
// RENDER - DOM construction & updates
// ============================================================================

const Render = {
  /**
   * Create detail labels mapping
   */
  detailLabels: {
    hostname: 'Hostname',
    mac: 'MAC Address',
    os: 'Operating System',
    hardware: 'Hardware',
    cpuTemp: 'CPU Temperature',
    gpuTemp: 'GPU Temperature'
  },

  /**
   * Create a detail row for machine card
   */
  createDetailRow(id) {
    const r = document.createElement('div');
    r.className = 'detail-row';
    r.innerHTML = `
      <div class="detail-key">${this.detailLabels[id]}</div>
      <div class="detail-val small">-</div>
    `;
    return r;
  },

  /**
   * Create a progress bar container
   */
  createBarItem(label) {
    const bar = document.createElement('div');
    bar.className = 'bar-item';
    bar.innerHTML = `
      <div class="bar-label">${label}</div>
      <div class="bar"><div class="bar-fill" style="width:0%"></div></div>
      <div class="bar-meta small">0%</div>
    `;
    return bar;
  },

  /**
   * Create machine card element with all sections
   */
  createMachineCard(machine) {
    const card = document.createElement('div');
    card.className = 'card';
    card.dataset.host = machine.host;
    card.dataset.port = machine.port;

    // Header section with title and status
    const head = document.createElement('div');
    head.className = 'head';
    const title = document.createElement('div');
    title.className = 'title';
    title.textContent = machine.name || `${machine.host}:${machine.port}`;
    const status = document.createElement('div');
    status.className = 'status small';
    status.textContent = 'waiting...';
    head.appendChild(title);
    head.appendChild(status);

    // Subheader with address and actions
    const sub = document.createElement('div');
    sub.className = 'small';
    const addr = document.createElement('div');
    const hostDisplay = BindParser.formatDisplay(machine.host);
    addr.textContent = `${hostDisplay}:${machine.port}/api/machine`;
    const actions = document.createElement('div');
    actions.className = 'actions';
    const remBtn = document.createElement('button');
    remBtn.title = 'Remove machine';
    remBtn.textContent = 'Remove';
    remBtn.onclick = () => MachineManager.remove(machine.host, machine.port);
    actions.appendChild(remBtn);
    sub.appendChild(addr);
    sub.appendChild(actions);

    // Details, bars section
    const bars = document.createElement('div');
    bars.className = 'bars';

    // Create detail rows
    const details = document.createElement('div');
    details.className = 'details';
    const detailNodes = {};
    ['hostname', 'mac', 'os', 'hardware', 'cpuTemp', 'gpuTemp'].forEach(id => {
      const row = this.createDetailRow(id);
      details.appendChild(row);
      detailNodes[id] = row.querySelector('.detail-val');
    });

    // Create progress bars
    const cpuBar = this.createBarItem('CPU Usage');
    const memBar = this.createBarItem('Memory Usage');
    const diskBar = this.createBarItem('Disk Usage');

    bars.appendChild(details);
    bars.appendChild(cpuBar);
    bars.appendChild(memBar);
    bars.appendChild(diskBar);

    // Metrics summary
    const metrics = document.createElement('div');
    metrics.className = 'metrics small';
    metrics.textContent = '';

    // Assemble card
    card.appendChild(head);
    card.appendChild(sub);
    card.appendChild(bars);
    card.appendChild(metrics);

    // Attach runtime properties for updates
    card._statusNode = status;
    card._metricsNode = metrics;
    card._history = [];
    card._cpuBar = cpuBar;
    card._memBar = memBar;
    card._diskBar = diskBar;
    card._detailNodes = detailNodes;

    return card;
  }
};


// ============================================================================
// API - Fetch machine data
// ============================================================================

const API = {
  /**
   * Fetch machine metrics from remote API
   */
  async fetchMachine(host, port, timeout = CONFIG.FETCH_TIMEOUT) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeout);
    
    try {
      const url = BindParser.toUrl(host, port);
      const res = await fetch(url, { signal: controller.signal });
      clearTimeout(timer);
      
      if (!res.ok) throw new Error('HTTP ' + res.status);
      return await res.json();
    } catch (err) {
      clearTimeout(timer);
      throw err;
    }
  }
};

// ============================================================================
// MACHINE MANAGER - Add/remove/render machines
// ============================================================================

const MachineManager = {
  machines: [],
  gridNode: document.getElementById('machinesGrid'),
  emptyStateNode: document.getElementById('emptyState'),

  /**
   * Initialize machines from storage
   */
  init() {
    this.machines = Storage.load();
    this.render();
  },

  /**
   * Render all machines or show empty state
   */
  render() {
    this.gridNode.innerHTML = '';
    
    if (this.machines.length === 0) {
      this.emptyStateNode.style.display = 'flex';
      return;
    }
    
    this.emptyStateNode.style.display = 'none';
    this.machines.forEach(machine => {
      const card = Render.createMachineCard(machine);
      this.gridNode.appendChild(card);
    });
  },

  /**
   * Add new machine from input
   */
  add(bindInput, name) {
    const parsed = BindParser.parse(bindInput);
    if (!parsed) {
      Notifications.error('Invalid Input', 'Please enter a valid port or host:port (e.g., 3000 or 192.168.1.5:3000)');
      return false;
    }

    const { host, port } = parsed;
    if (this.machines.find(x => x.host === host && x.port === port)) {
      Notifications.warning('Already Added', `Server at ${host}:${port} is already in your list`);
      return false;
    }

    this.machines.push({ host, port, name: name || '' });
    Storage.save(this.machines);
    this.render();
    Notifications.success('Server Added', `Successfully added ${name || `${host}:${port}`}`);
    return true;
  },

  /**
   * Remove machine by host and port
   */
  remove(host, port) {
    this.machines = this.machines.filter(
      m => !(m.host === host && String(m.port) === String(port))
    );
    Storage.save(this.machines);
    this.render();
  }
};

// ============================================================================
// POLLING - Real-time metrics updates
// ============================================================================

const Poller = {
  pollIntervalId: null,

  /**
   * Update data for single machine card
   */
  async updateMachine(node) {
    const host = node.dataset.host;
    const port = node.dataset.port;
    const statusNode = node._statusNode;
    const metricsNode = node._metricsNode;

    try {
      const data = await API.fetchMachine(host, port);
      const cpu = data.cpuUsage || {};
      const mem = data.memoryUsage || {};
      const disk = data.diskUsage || {};

      // Update status
      statusNode.textContent = 'ok • ' + new Date().toLocaleTimeString();
      statusNode.className = 'status small status-ok';

      // Update detail fields
      if (node._detailNodes) {
        node._detailNodes.hostname.textContent = data.hostname ?? '-';
        node._detailNodes.mac.textContent = data.macAddress ?? '-';
        node._detailNodes.os.textContent = data.operatingSystem ?? '-';
        node._detailNodes.hardware.textContent = data.hardware ?? '-';
        node._detailNodes.cpuTemp.textContent = (data.cpuTemperature != null) 
          ? `${data.cpuTemperature} °C` 
          : '-';
        node._detailNodes.gpuTemp.textContent = (data.gpuTemperature != null) 
          ? `${data.gpuTemperature} °C` 
          : '-';
      }

      // Update metrics text
      const memText = mem.display ? mem.display : (mem.usedPercent ? `${mem.usedPercent}%` : 'N/A');
      metricsNode.textContent = `CPU: ${cpu.currentLoad?.toFixed(1) ?? 'N/A'}% • Mem: ${memText} • Temp: ${data.cpuTemperature ?? 'N/A'}°C`;

      // Update CPU bar
      const cpuPercent = Math.round(cpu.currentLoad ?? 0);
      const cpuFill = node._cpuBar.querySelector('.bar-fill');
      const cpuMeta = node._cpuBar.querySelector('.bar-meta');
      cpuFill.style.width = `${cpuPercent}%`;
      cpuMeta.textContent = `${cpuPercent}%`;

      // Update Memory bar
      const memPercent = Math.round(mem.usedPercent ?? 0);
      const memFill = node._memBar.querySelector('.bar-fill');
      const memMeta = node._memBar.querySelector('.bar-meta');
      memFill.style.width = `${memPercent}%`;
      memMeta.textContent = `${mem.display ?? (memPercent + '%')}`;

      // Update Disk bar
      const diskFill = node._diskBar.querySelector('.bar-fill');
      const diskMeta = node._diskBar.querySelector('.bar-meta');
      
      if (disk && disk.usedPercent != null) {
        const usePercent = Math.round(disk.usedPercent ?? 0);
        diskFill.style.width = `${usePercent}%`;
        diskMeta.textContent = `${disk.display ?? (usePercent + '%')}`;
        node._diskBar.style.display = '';
      } else if (data.disks && data.disks.length) {
        const d = data.disks[0];
        const usePercent = Math.round(d.use ?? (d.size && d.used ? (d.used / d.size) * 100 : 0));
        diskFill.style.width = `${usePercent}%`;
        diskMeta.textContent = `${d.used ? (d.used / (1024 * 1024)).toFixed(0) + ' MB' : ''} ${usePercent}%`;
        node._diskBar.style.display = '';
      } else {
        diskFill.style.width = '0%';
        diskMeta.textContent = 'N/A';
        node._diskBar.style.display = 'none';
      }

      // Push to history
      const label = new Date().toLocaleTimeString();
      node._history.push({ 
        tsLabel: label, 
        cpu: cpu.currentLoad ?? null, 
        mem: mem.usedPercent ?? null 
      });
      if (node._history.length > CONFIG.HISTORY_MAX) {
        node._history.shift();
      }

    } catch (err) {
      const errorType = err.name === 'AbortError' ? 'timeout' : (err.message || 'failed');
      metricsNode.textContent = '';
      
      // Send error to notification bell
      const hostDisplay = BindParser.formatDisplay(node.dataset.host);
      const serverName = node.querySelector('.title').textContent;
      Notifications.error(
        `${serverName} - Connection Error`,
        `${hostDisplay}:${node.dataset.port} - ${errorType}`
      );
    }
  },

  /**
   * Poll all machines once
   */
  async pollOnce() {
    const items = document.querySelectorAll('.card');
    items.forEach(node => this.updateMachine(node));
  },

  /**
   * Start polling interval
   */
  start() {
    if (this.pollIntervalId) return;
    this.pollOnce();
    this.pollIntervalId = setInterval(() => this.pollOnce(), CONFIG.POLL_INTERVAL);
  },

  /**
   * Stop polling interval
   */
  stop() {
    if (!this.pollIntervalId) return;
    clearInterval(this.pollIntervalId);
    this.pollIntervalId = null;
  }
};

// ============================================================================
// UI - Event listeners & initialization
// ============================================================================

const UI = {
  /**
   * Initialize all event listeners
   */
  init() {
    const addBtn = document.getElementById('addBtn');
    const portInput = document.getElementById('portInput');
    const nameInput = document.getElementById('nameInput');
    const darkModeToggle = document.getElementById('darkModeToggle');
    const notificationBell = document.getElementById('notificationBell');
    const notificationPanel = document.getElementById('notificationPanel');

    addBtn.addEventListener('click', () => {
      const success = MachineManager.add(portInput.value, nameInput.value);
      if (success) {
        portInput.value = '';
        nameInput.value = '';
      }
    });

    // Allow Enter key to add machine
    [portInput, nameInput].forEach(input => {
      input.addEventListener('keypress', (e) => {
        if (e.key === 'Enter') {
          const success = MachineManager.add(portInput.value, nameInput.value);
          if (success) {
            portInput.value = '';
            nameInput.value = '';
          }
        }
      });
    });

    // Dark mode toggle
    darkModeToggle.addEventListener('click', () => {
      document.body.classList.toggle('dark-mode');
    });

    // Notification bell toggle
    notificationBell.addEventListener('click', () => {
      notificationPanel.classList.toggle('active');
    });

    // Close notification panel when clicking outside
    document.addEventListener('click', (e) => {
      if (!e.target.closest('.notification-wrapper')) {
        notificationPanel.classList.remove('active');
      }
    });
  }
};

// ============================================================================
// APP - Main initialization
// ============================================================================

const App = {
  /**
   * Initialize the entire application
   */
  init() {
    MachineManager.init();
    UI.init();
    Poller.start();
  }
};

// Start the application when DOM is ready
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', () => App.init());
} else {
  App.init();
}