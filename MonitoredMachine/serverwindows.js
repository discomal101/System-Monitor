const express = require('express');
const cors = require('cors');
const si = require('systeminformation');
const { exec } = require('child_process');
const util = require('util');
const execAsync = util.promisify(exec);
const os = require('os');

const PORT = 3000;

if (os.platform() !== 'Windows') console.warn('Warning: server.Windows.js is intended for Windows platforms (platform=' + os.platform() + ')');

const app = express();
app.use(cors());
app.use(express.json());

// --- Process monitoring registry & helpers (best-effort GPU per-PID using nvidia-smi) ---
const monitors = new Map();
let monitorCounter = 1;

async function getProcessSnapshot(pid){
    const procs = await si.processes();
    const p = (procs && procs.list) ? procs.list.find(x => x.pid === pid) : null;
    if (!p) return null;
    return {
        pid: p.pid,
        name: p.name,
        cpuPercent: typeof p.pcpu === 'number' ? p.pcpu : null,
        memPercent: typeof p.pmem === 'number' ? p.pmem : null,
        memKb: p.mem_rss || p.mem_vsz || null,
        timestamp: new Date().toISOString()
    };
}

// Best-effort GPU usage per pid using nvidia-smi - returns { gpuMemoryMB } or null
async function getGpuUsageForPid(pid){
    try{
        // query compute processes and used memory; adjust if fields vary by driver version
        const cmd = 'nvidia-smi --query-compute-apps=pid,used_gpu_memory --format=csv,noheader,nounits';
        const { stdout } = await execAsync(cmd, { timeout: 3000 });
        if (!stdout) return null;
        const lines = stdout.trim().split(/\r?\n/).map(l => l.trim()).filter(Boolean);
        for (const line of lines){
            const parts = line.split(',');
            if (parts.length >= 2){
                const pPid = parseInt(parts[0].trim(), 10);
                const usedMemoryMb = parseInt(parts[1].trim(), 10);
                if (pPid === pid){
                    return { gpuMemoryMB: usedMemoryMb };
                }
            }
        }
        return null;
    }catch(e){
        // nvidia-smi missing or failed; treat as unavailable
        return null;
    }
}

function createMonitor({ pid, name, intervalMs = 1000 }){
    const id = String(monitorCounter++);
    const monitor = { id, pid: pid || null, name: name || null, intervalMs, last: null, active: true, timer: null, createdAt: new Date().toISOString(), exited: false };
    monitors.set(id, monitor);

    monitor.timer = setInterval(async () => {
        try{
            let resolvedPid = monitor.pid;
            if (!resolvedPid && monitor.name){
                const procs = await si.processes();
                const match = procs.list.find(p => p.name && p.name.toLowerCase().includes(monitor.name.toLowerCase()));
                if (match) resolvedPid = match.pid;
            }

            if (!resolvedPid){
                monitor.last = { timestamp: new Date().toISOString(), found: false };
                return;
            }

            const snap = await getProcessSnapshot(resolvedPid);
            if (!snap){
                // process not found -> assume exited; stop monitoring
                monitor.last = { timestamp: new Date().toISOString(), found: false, exited: true };
                clearInterval(monitor.timer);
                monitor.active = false;
                monitor.exited = true;
                monitor.pid = resolvedPid;
                return;
            }

            const gpu = await getGpuUsageForPid(resolvedPid);
            const data = { ...snap, gpu, found: true };
            monitor.last = data;
            monitor.pid = resolvedPid;
        }catch(err){
            console.error('Monitor error', err);
        }
    }, monitor.intervalMs);

    return monitor;
}

// API: start monitoring a process by pid or name
app.post('/api/monitor', async (req, res) => {
    try{
        const { pid, name, intervalMs } = req.body || {};
        if (!pid && !name) return res.status(400).json({ error: 'Provide pid or name to monitor' });

        // if pid provided, verify it exists now
        if (pid){
            const snap = await getProcessSnapshot(Number(pid));
            if (!snap) return res.status(404).json({ error: 'Process with given pid not found' });
        }

        const monitor = createMonitor({ pid: pid ? Number(pid) : null, name: name || null, intervalMs: intervalMs || 1000 });
        return res.status(201).json({ monitorId: monitor.id, pid: monitor.pid, name: monitor.name });
    }catch(err){
        console.error('Error creating monitor', err);
        res.status(500).json({ error: 'Failed to create monitor', details: err.message });
    }
});

// API: get a monitor's latest snapshot
app.get('/api/monitor/:id', (req, res) => {
    const id = req.params.id;
    const monitor = monitors.get(id);
    if (!monitor) return res.status(404).json({ error: 'Monitor not found' });
    res.json({ id: monitor.id, pid: monitor.pid, name: monitor.name, active: monitor.active, exited: monitor.exited, last: monitor.last, createdAt: monitor.createdAt });
});

// API: list monitors
app.get('/api/monitors', (req, res) => {
    const list = Array.from(monitors.values()).map(m => ({ id: m.id, pid: m.pid, name: m.name, active: m.active, exited: m.exited, last: m.last }));
    res.json(list);
});

// API: stop and remove monitor
app.delete('/api/monitor/:id', (req, res) => {
    const id = req.params.id;
    const monitor = monitors.get(id);
    if (!monitor) return res.status(404).json({ error: 'Monitor not found' });
    try{
        if (monitor.timer) clearInterval(monitor.timer);
    }catch(e){}
    monitors.delete(id);
    res.json({ deleted: true });
});

// API: get machine stats
app.get('/api/machine', async (req, res) => {
    try {
        const [load, mem, cpuTemp, fsSize, graphics, osInfo, systemInfo, netifs] = await Promise.all([
            si.currentLoad(),
            si.mem(),
            si.cpuTemperature(),
            si.fsSize(),
            si.graphics(),
            si.osInfo(),
            si.system(),
            si.networkInterfaces()
        ]);

        function toMB(bytes){
            return Math.round(bytes / (1024 * 1024));
        }

        function formatMB(bytes){
            if (bytes === undefined || bytes === null) return null;
            return `${toMB(bytes)} MB`;
        }

        // disks array
        const disks = (fsSize || []).map(d => ({ fs: d.fs, type: d.type, size: d.size, used: d.used, use: d.use }));
        const totalDiskSize = disks.reduce((s, d) => s + (d.size || 0), 0);
        const totalDiskUsed = disks.reduce((s, d) => s + (d.used || 0), 0);
        const aggregatedDiskUse = totalDiskSize ? Math.round((totalDiskUsed / totalDiskSize) * 100) : null;

        // pick primary mac address
        const mac = (netifs || []).find(n => n && !n.internal && n.mac && n.mac !== '00:00:00:00:00:00');
        const macAddress = mac ? mac.mac : ((netifs && netifs[0] && netifs[0].mac) || null);

        // GPU temperature (best-effort)
        let gpuTemp = null;
        if (graphics && graphics.controllers && graphics.controllers.length){
            for (const c of graphics.controllers){
                if (c.temperatureGpu != null) { gpuTemp = c.temperatureGpu; break; }
                if (c.temperature != null) { gpuTemp = c.temperature; break; }
            }
        }

        const memoryUsedMB = toMB(mem.used);
        const memoryTotalMB = toMB(mem.total);
        const memoryUsedPercent = mem.total ? Math.round((mem.used / mem.total) * 10000) / 100 : null;

        const data = {
            timestamp: new Date().toISOString(),
            hostname: osInfo.hostname || null,
            macAddress: macAddress,
            operatingSystem: `${osInfo.distro || osInfo.platform || ''} ${osInfo.release || ''}`.trim(),
            hardware: `${systemInfo.manufacturer || ''} ${systemInfo.model || ''}`.trim(),
            memoryUsage: {
                usedMB: memoryUsedMB,
                totalMB: memoryTotalMB,
                usedPercent: memoryUsedPercent,
                display: `${memoryUsedMB} / ${memoryTotalMB} MB`
            },
            diskUsage: {
                usedMB: Math.round(totalDiskUsed / (1024 * 1024)),
                totalMB: Math.round(totalDiskSize / (1024 * 1024)),
                usedPercent: aggregatedDiskUse,
                display: totalDiskSize ? `${Math.round(totalDiskUsed / (1024 * 1024))} / ${Math.round(totalDiskSize / (1024 * 1024))} MB` : null,
                disks: disks
            },
            cpuUsage: {
                currentLoad: load.currentLoad ?? null,
                avgLoad: load.avgload ?? null,
                cores: load.cpus ? load.cpus.map((c, i) => ({ core: i, load: c.load })) : undefined
            },
            cpuTemperature: cpuTemp.main ?? null,
            gpuTemperature: gpuTemp
        };

        res.json(data);
    } catch (err) {
        console.error('Error fetching machine stats', err);
        res.status(500).json({ error: 'Failed to get machine stats', details: err.message });
    }
});

app.get('/health', (req, res) => res.json({status: 'ok', ts: new Date().toISOString()}));

app.listen(PORT, () => console.log(`Server listening on port ${PORT} - GET /api/machine`));
