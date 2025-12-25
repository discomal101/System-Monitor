// Dashboard client-side logic with Chart.js
const STORAGE_KEY = 'serverstats_machines_v1';
const POLL_INTERVAL = 5000; // ms
const HISTORY_MAX = 20;

function loadMachines(){
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? JSON.parse(raw) : [];
  } catch(e){
    console.error('Failed to load machines', e);
    return [];
  }
}

function saveMachines(list){
  localStorage.setItem(STORAGE_KEY, JSON.stringify(list));
}

function sanitizePort(input){
  if (!input) return null;
  const trimmed = String(input).trim();
  const port = parseInt(trimmed.replace(/[^0-9]/g,''),10);
  if (!port || port < 1 || port > 65535) return null;
  return port;
}

function createMachineElement(m){
  const card = document.createElement('div');
  card.className = 'card';
  card.dataset.port = m.port;

  const head = document.createElement('div');
  head.className = 'head';
  const title = document.createElement('div');
  title.className = 'title';
  title.textContent = m.name || `localhost:${m.port}`;
  const addr = document.createElement('div');
  addr.className = 'small';
  addr.textContent = `localhost:${m.port}/api/machine`;

  const status = document.createElement('div');
  status.className = 'status small';
  status.textContent = 'waiting...';

  const actions = document.createElement('div');
  actions.className = 'actions';
  const remBtn = document.createElement('button');
  remBtn.title = 'Remove machine';
  remBtn.textContent = 'Remove';
  remBtn.onclick = () => removeMachine(m.port);
  actions.appendChild(remBtn);

  head.appendChild(title);
  head.appendChild(status);

  const sub = document.createElement('div');
  sub.className = 'small';
  sub.appendChild(addr);
  sub.appendChild(actions);

  const charts = document.createElement('div');
  charts.className = 'charts';

  // Progress bars container (CPU / Memory / Disk)
  const bars = document.createElement('div');
  bars.className = 'bars';

  // details rows (in the requested order)
  const details = document.createElement('div');
  details.className = 'details';
  const rows = [
    'hostname','mac','os','hardware','cpuTemp','gpuTemp'
  ].reduce((acc, id) => {
    const r = document.createElement('div');
    r.className = 'detail-row';
    r.innerHTML = `<div class="detail-key">${id === 'hostname' ? 'Hostname' : id === 'mac' ? 'MAC Address' : id === 'os' ? 'Operating System' : id === 'hardware' ? 'Hardware' : id === 'cpuTemp' ? 'CPU Temperature' : 'GPU Temperature'}</div><div class="detail-val small">-</div>`;
    details.appendChild(r);
    acc[id] = r.querySelector('.detail-val');
    return acc;
  }, {});

  // Progress bars container (CPU / Memory / Disk)
  const cpuBar = document.createElement('div');
  cpuBar.className = 'bar-item';
  cpuBar.innerHTML = `<div class="bar-label">CPU Usage</div><div class="bar"><div class="bar-fill" style="width:0%"></div></div><div class="bar-meta small">0%</div>`;

  const memBar = document.createElement('div');
  memBar.className = 'bar-item';
  memBar.innerHTML = `<div class="bar-label">Memory Usage</div><div class="bar"><div class="bar-fill" style="width:0%"></div></div><div class="bar-meta small">0%</div>`;

  const diskBar = document.createElement('div');
  diskBar.className = 'bar-item';
  diskBar.innerHTML = `<div class="bar-label">Disk Usage</div><div class="bar"><div class="bar-fill" style="width:0%"></div></div><div class="bar-meta small">0%</div>`;

  bars.appendChild(details);
  bars.appendChild(cpuBar);
  bars.appendChild(memBar);
  bars.appendChild(diskBar);

  const metrics = document.createElement('div');
  metrics.className = 'metrics small';
  metrics.textContent = '';

  card.appendChild(head);
  card.appendChild(sub);
  card.appendChild(bars);
  card.appendChild(metrics);

  // attach runtime properties
  card._statusNode = status;
  card._metricsNode = metrics;
  card._history = []; // array of {tsLabel,cpu,mem}
  card._cpuBar = cpuBar;
  card._memBar = memBar;
  card._diskBar = diskBar;
  card._detailNodes = rows;
  card._chart = null; // no longer showing Chart.js sparkline by default

  return card;
}

function createChart(canvas){
  const ctx = canvas.getContext('2d');
  return new Chart(ctx, {
    type: 'line',
    data: {
      labels: [],
      datasets: [
        { label: 'CPU %', data: [], borderColor: '#2d8cf0', backgroundColor: 'rgba(45,140,240,0.08)', tension: 0.3, pointRadius: 0 },
        { label: 'Mem %', data: [], borderColor: '#ffaa3c', backgroundColor: 'rgba(255,170,60,0.06)', tension: 0.3, pointRadius: 0 }
      ]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      scales: {
        x: { display: false },
        y: { beginAtZero: true, max: 100 }
      },
      plugins: { legend: { display: true, position: 'bottom' } }
    }
  });
}

// state
let machines = loadMachines();
const gridNode = document.getElementById('machinesGrid');

function renderMachines(){
  // clear and recreate - frees old charts
  gridNode.innerHTML = '';
  machines.forEach(m => {
    const el = createMachineElement(m);
    gridNode.appendChild(el);
  });
}

function addMachine(port, name){
  const p = sanitizePort(port);
  if (!p){ alert('Invalid port'); return; }
  if (machines.find(x => x.port === p)) { alert('Port already added'); return; }
  machines.push({port: p, name: name || ''});
  saveMachines(machines);
  renderMachines();
}

function removeMachine(port){
  // destroy chart if present
  const node = document.querySelector(`[data-port="${port}"]`);
  if (node && node._chart) node._chart.destroy();

  machines = machines.filter(m => m.port !== port);
  saveMachines(machines);
  renderMachines();
}

// polling
async function fetchMachine(port, timeout = 3000){
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeout);
  try {
    const res = await fetch(`http://localhost:${port}/api/machine`, { signal: controller.signal });
    clearTimeout(timer);
    if (!res.ok) throw new Error('HTTP ' + res.status);
    return await res.json();
  } catch(err){
    clearTimeout(timer);
    throw err;
  }
}

async function pollOnce(){
  const items = document.querySelectorAll('.card');
  items.forEach(async node => {
    const port = node.dataset.port;
    const statusNode = node._statusNode;
    const metricsNode = node._metricsNode;

    try {
      const data = await fetchMachine(port, 4000);
      const cpu = data.cpuUsage || {};
      const mem = data.memoryUsage || {};
      const disk = data.diskUsage || {};

      // update status
      statusNode.textContent = 'ok • ' + new Date().toLocaleTimeString();
      statusNode.className = 'status small status-ok';

      // update details (ordered)
      if (node._detailNodes){
        node._detailNodes.hostname.textContent = data.hostname ?? '-';
        node._detailNodes.mac.textContent = data.macAddress ?? '-';
        node._detailNodes.os.textContent = data.operatingSystem ?? '-';
        node._detailNodes.hardware.textContent = data.hardware ?? '-';
        node._detailNodes.cpuTemp.textContent = (data.cpuTemperature != null) ? `${data.cpuTemperature} °C` : '-';
        node._detailNodes.gpuTemp.textContent = (data.gpuTemperature != null) ? `${data.gpuTemperature} °C` : '-';
      }

      // update metrics text (kept for accessibility)
      const memText = mem.display ? mem.display : (mem.usedPercent ? `${mem.usedPercent}%` : 'N/A');
      metricsNode.textContent = `CPU: ${cpu.currentLoad?.toFixed(1) ?? 'N/A'}% • Mem: ${memText} • Temp: ${data.cpuTemperature ?? 'N/A'}°C`;

      // update CPU bar
      const cpuPercent = Math.round(cpu.currentLoad ?? 0);
      const cpuFill = node._cpuBar.querySelector('.bar-fill');
      const cpuMeta = node._cpuBar.querySelector('.bar-meta');
      cpuFill.style.width = `${cpuPercent}%`;
      cpuMeta.textContent = `${cpuPercent}%`;

      // update Memory bar
      const memPercent = Math.round(mem.usedPercent ?? 0);
      const memFill = node._memBar.querySelector('.bar-fill');
      const memMeta = node._memBar.querySelector('.bar-meta');
      memFill.style.width = `${memPercent}%`;
      memMeta.textContent = `${mem.display ?? (memPercent + '%')}`;

      // update Disk bar (show aggregated disk usage if present)
      const diskFill = node._diskBar.querySelector('.bar-fill');
      const diskMeta = node._diskBar.querySelector('.bar-meta');
      if (disk && (disk.usedPercent != null)){
        const usePercent = Math.round(disk.usedPercent ?? 0);
        diskFill.style.width = `${usePercent}%`;
        diskMeta.textContent = `${disk.display ?? (usePercent + '%')}`;
        node._diskBar.style.display = '';
      } else if (data.disks && data.disks.length){
        const d = data.disks[0];
        const usePercent = Math.round(d.use ?? (d.size && d.used ? (d.used / d.size) * 100 : 0));
        diskFill.style.width = `${usePercent}%`;
        diskMeta.textContent = `${d.used ? (d.used / (1024*1024)).toFixed(0) + ' MB' : ''} ${usePercent}%`;
        node._diskBar.style.display = '';
      } else {
        // hide if no disk info
        diskFill.style.width = `0%`;
        diskMeta.textContent = 'N/A';
        node._diskBar.style.display = 'none';
      }

      // push history (kept for future use)
      const label = new Date().toLocaleTimeString();
      node._history.push({ tsLabel: label, cpu: cpu.currentLoad ?? null, mem: mem.usedPercent ?? null });
      if (node._history.length > HISTORY_MAX) node._history.shift();

    } catch(err){
      statusNode.textContent = 'error • ' + (err.name === 'AbortError' ? 'timeout' : (err.message || 'failed'));
      statusNode.className = 'status small status-err';
      metricsNode.textContent = '';
    }
  });
}

// start interval
let pollIntervalId = null;
function startPolling(){
  if (pollIntervalId) return;
  pollOnce();
  pollIntervalId = setInterval(pollOnce, POLL_INTERVAL);
}

function stopPolling(){
  if (!pollIntervalId) return;
  clearInterval(pollIntervalId);
  pollIntervalId = null;
}

// UI wiring
document.getElementById('addBtn').addEventListener('click', () => {
  const portInput = document.getElementById('portInput');
  const nameInput = document.getElementById('nameInput');
  addMachine(portInput.value, nameInput.value);
  portInput.value = '';
  nameInput.value = '';
});

// initial render and start
renderMachines();
startPolling();
