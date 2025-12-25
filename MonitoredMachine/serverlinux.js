const express = require('express');
const cors = require('cors');
const si = require('systeminformation');
const { exec } = require('child_process');
const util = require('util');
const execAsync = util.promisify(exec);
const os = require('os');
const net = require('net');

const PORT = 3022; // Linux-specific server

// Warn if not running on linux
if (os.platform() !== 'linux') console.warn('Warning: server.linux.js is intended for Linux platforms (platform=' + os.platform() + ')');

const app = express();
app.use(cors());
app.use(express.json());

// Helper: best-effort Nvidia GPU summary (Linux)
async function getNvidiaSummary(){
    try{
        const cmd = 'nvidia-smi --query-gpu=index,name,temperature.gpu,memory.total,memory.used --format=csv,noheader,nounits';
        const { stdout } = await execAsync(cmd, { timeout: 3000 });
        if (!stdout) return null;
        const lines = stdout.trim().split(/\r?\n/).map(l => l.trim()).filter(Boolean);
        const gpus = lines.map(line => {
            const parts = line.split(',').map(p => p.trim());
            return {
                index: Number(parts[0]),
                name: parts[1],
                temperatureC: parts[2] ? Number(parts[2]) : null,
                memoryTotalMB: parts[3] ? Number(parts[3]) : null,
                memoryUsedMB: parts[4] ? Number(parts[4]) : null
            };
        });
        return gpus;
    }catch(e){
        return null;
    }
}

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

        // disks array
        const disks = (fsSize || []).map(d => ({ fs: d.fs, type: d.type, size: d.size, used: d.used, use: d.use }));
        const totalDiskSize = disks.reduce((s, d) => s + (d.size || 0), 0);
        const totalDiskUsed = disks.reduce((s, d) => s + (d.used || 0), 0);
        const aggregatedDiskUse = totalDiskSize ? Math.round((totalDiskUsed / totalDiskSize) * 100) : null;

        // pick primary mac address
        const mac = (netifs || []).find(n => n && !n.internal && n.mac && n.mac !== '00:00:00:00:00:00');
        const macAddress = mac ? mac.mac : ((netifs && netifs[0] && netifs[0].mac) || null);

        const memoryUsedMB = toMB(mem.used);
        const memoryTotalMB = toMB(mem.total);
        const memoryUsedPercent = mem.total ? Math.round((mem.used / mem.total) * 10000) / 100 : null;

        // Linux-specific fields
        const uptimeSeconds = os.uptime();
        const kernel = osInfo.kernel || os.release;
        const nvidia = await getNvidiaSummary();

        const data = {
            timestamp: new Date().toISOString(),
            hostname: osInfo.hostname || null,
            macAddress: macAddress,
            operatingSystem: `${osInfo.distro || osInfo.platform || ''} ${osInfo.release || ''}`.trim(),
            kernel: kernel || null,
            uptimeSeconds,
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
            gpuTemperature: (graphics && graphics.controllers && graphics.controllers.length) ? (graphics.controllers[0].temperatureGpu ?? graphics.controllers[0].temperature ?? null) : null,
            nvidiaSummary: nvidia
        };

        res.json(data);
    } catch (err) {
        console.error('Error fetching machine stats', err);
        res.status(500).json({ error: 'Failed to get machine stats', details: err.message });
    }
});

app.get('/health', (req, res) => res.json({status: 'ok', ts: new Date().toISOString()}));

async function isPortFree(port) {
  return new Promise(resolve => {
    const tester = net.createServer()
      .once('error', err => {
        try { tester.close(); } catch (e) {}
        if (err && (err.code === 'EADDRINUSE' || err.code === 'EACCES')) resolve(false);
        else resolve(false);
      })
      .once('listening', () => {
        tester.close();
        resolve(true);
      })
      .listen(port);
  });
}

async function choosePort(preferred, maxAttempts = 20) {
  if (await isPortFree(preferred)) return preferred;
  for (let i = 0; i < maxAttempts; i++) {
    const candidate = Math.floor(Math.random() * (65535 - 1025)) + 1025;
    if (await isPortFree(candidate)) {
      console.warn(`Port ${preferred} is in use. Selected free port ${candidate}.`);
      return candidate;
    }
  }
  throw new Error('Unable to find free port after multiple attempts');
}

(async () => {
  try {
    const finalPort = await choosePort(PORT);
    app.listen(finalPort, () => console.log(`Linux server listening on port ${finalPort} - GET /api/machine`));
  } catch (err) {
    console.error('Failed to start server:', err);
    process.exit(1);
  }
})();
