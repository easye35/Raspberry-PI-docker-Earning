// -----------------------------------------------------------------------------
// EarnBox Backend API
// -----------------------------------------------------------------------------

const express = require("express");
const fetch = require("node-fetch");
const cors = require("cors");
const { exec } = require("child_process");
const Docker = require("dockerode");
const docker = new Docker({ socketPath: "/var/run/docker.sock" });

const app = express();
app.use(cors());
app.use(express.json());

const NETDATA = "http://netdata:19999";

// -----------------------------------------------------------------------------
// Utility: Fetch with retry
// -----------------------------------------------------------------------------
async function fetchWithRetry(url, retries = 3, delay = 500) {
    for (let i = 0; i < retries; i++) {
        try {
            const res = await fetch(url);
            if (res.ok) return await res.json();
        } catch (err) {}
        await new Promise(r => setTimeout(r, delay));
    }
    return null;
}

// -----------------------------------------------------------------------------
// API: System Stats (via Netdata)
// -----------------------------------------------------------------------------
app.get("/api/system", async (req, res) => {
    try {
        // CPU
        const cpuChart = await fetchWithRetry(
            `${NETDATA}/api/v1/data?chart=system.cpu&after=-1&points=1&format=json`
        );
        if (!cpuChart) return res.json({ ok: false });

        const cpuRow = cpuChart?.data?.[0] || [];
        const user = cpuRow[6] || 0;
        const system = cpuRow[7] || 0;
        const nice = cpuRow[8] || 0;
        const iowait = cpuRow[9] || 0;
        const cpuTotal = user + system + nice + iowait;

        // RAM
        const ramChart = await fetchWithRetry(
            `${NETDATA}/api/v1/data?chart=system.ram&after=-1&points=1&format=json`
        );
        const ramRow = ramChart?.data?.[0] || [];
        const ramFree = ramRow[1] || 0;
        const ramUsed = ramRow[2] || 0;
        const ramPercent = Math.round((ramUsed / (ramUsed + ramFree)) * 100);

        // Disk
        const charts = await fetchWithRetry(`${NETDATA}/api/v1/charts`);
        let diskPercent = 0;

        const diskChartName = Object.keys(charts).find(k =>
            k.startsWith("disk_space.") && !k.includes("docker")
        );

        if (diskChartName) {
            const diskChart = await fetchWithRetry(
                `${NETDATA}/api/v1/data?chart=${diskChartName}&after=-1&points=1&format=json`
            );

            const diskRow = diskChart?.data?.[0] || [];
            const diskUsed = diskRow[1] || 0;
            const diskFree = diskRow[2] || 1;
            diskPercent = Math.round((diskUsed / (diskUsed + diskFree)) * 100);
        }

        // Network
        const iface = Object.keys(charts).find(k =>
            k.startsWith("net.") && !k.includes("lo")
        );

        let rx = 0, tx = 0;

        if (iface) {
            const netChart = await fetchWithRetry(
                `${NETDATA}/api/v1/data?chart=${iface}&after=-1&points=1&format=json`
            );

            const netRow = netChart?.data?.[0] || [];
            rx = netRow[1] || 0;
            tx = netRow[2] || 0;
        }

        // Temperature
        let temp = 0;
        try {
            const tempChart = await fetchWithRetry(
                `${NETDATA}/api/v1/data?chart=sensors.temperature_cpu_thermal-virtual-0_temp1_input&after=-1&points=1&format=json`
            );

            if (tempChart && tempChart.data && tempChart.data.length > 0) {
                temp = tempChart.data[0][1];
            }
        } catch (err) {}

        // Uptime
        const uptimeChart = await fetchWithRetry(
            `${NETDATA}/api/v1/data?chart=system.uptime&after=-1&points=1&format=json`
        );

        const uptime = uptimeChart?.data?.[0]?.[1] || 0;

        res.json({
            ok: true,
            cpu: cpuTotal,
            ram: ramPercent,
            disk: diskPercent,
            network: { rx, tx },
            uptime,
            temp
        });

    } catch (err) {
        res.json({ ok: false });
    }
});

// -----------------------------------------------------------------------------
// API: Service Status (systemd)
// -----------------------------------------------------------------------------
app.get("/api/services", async (req, res) => {
    exec("systemctl is-active earnbox-reset.service", (err, stdout) => {
        const status = stdout.trim() || "unknown";
        res.json({ resetService: status });
    });
});

// -----------------------------------------------------------------------------
// API: Containers (Dockerode)
// -----------------------------------------------------------------------------
app.get("/api/containers", async (req, res) => {
    try {
        const containers = await docker.listContainers({ all: true });
        res.json(containers);
    } catch (err) {
        console.error("Dockerode error:", err);
        res.json([]);
    }
});

// -----------------------------------------------------------------------------
// API: Container Actions
// -----------------------------------------------------------------------------
app.post("/api/containers/:id/start", (req, res) => {
    exec(`docker start ${req.params.id}`, () => res.json({ ok: true }));
});

app.post("/api/containers/:id/stop", (req, res) => {
    exec(`docker stop ${req.params.id}`, () => res.json({ ok: true }));
});

app.post("/api/containers/:id/restart", (req, res) => {
    exec(`docker restart ${req.params.id}`, () => res.json({ ok: true }));
});

// -----------------------------------------------------------------------------
// API: Container Logs (Dockerode)
// -----------------------------------------------------------------------------
app.get("/api/containers/:id/logs", async (req, res) => {
    try {
        const c = docker.getContainer(req.params.id);
        const logs = await c.logs({
            stdout: true,
            stderr: true,
            tail: 200
        });

        res.json({
            logs: logs.toString("utf8").split("\n")
        });
    } catch (err) {
        console.error("Log error:", err);
        res.json({ logs: [] });
    }
});

// -----------------------------------------------------------------------------
// API: Reset Now
// -----------------------------------------------------------------------------
app.post("/api/admin/reset", (req, res) => {
    exec("systemctl restart earnbox-reset.service", () => {
        res.json({ ok: true });
    });
});

// -----------------------------------------------------------------------------
// API: Enable Daily Reset
// -----------------------------------------------------------------------------
app.post("/api/admin/enable-daily-reset", (req, res) => {
    exec("systemctl enable --now earnbox-reset.timer", () => {
        res.json({ ok: true });
    });
});

// -----------------------------------------------------------------------------
// Start Server
// -----------------------------------------------------------------------------
app.listen(3001, () => {
    console.log("Backend running on port 3001");
});
