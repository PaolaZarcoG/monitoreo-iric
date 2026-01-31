const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const si = require('systeminformation');
const os = require('os');
const localtunnel = require('localtunnel');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

const PORT = 3000;

app.use(express.static('public'));

async function getDiskInfo() {
    try {
        const diskLayout = await si.fsSize();
        if (diskLayout.length > 0) {
            const mainDisk = diskLayout[0];
            return {
                total: (mainDisk.size / (1024 ** 3)).toFixed(2),
                used: (mainDisk.used / (1024 ** 3)).toFixed(2),
                available: ((mainDisk.size - mainDisk.used) / (1024 ** 3)).toFixed(2),
                usePercent: ((mainDisk.used / mainDisk.size) * 100).toFixed(2)
            };
        }
    } catch (error) {
        console.error('Error obteniendo info de disco:', error);
    }
    return { total: 0, used: 0, available: 0, usePercent: 0 };
}

async function getTopProcesses() {
    try {
        const processes = await si.processes();
        return processes.list
            .sort((a, b) => b.cpu - a.cpu)
            .slice(0, 5)
            .map(p => ({
                pid: p.pid,
                name: p.name.substring(0, 25),
                cpu: p.cpu.toFixed(2),
                mem: p.mem.toFixed(2)
            }));
    } catch (error) {
        return [];
    }
}

async function getNetworkInfo() {
    try {
        const networkStats = await si.networkStats();
        if (networkStats.length > 0) {
            const mainInterface = networkStats[0];
            return {
                rx: (mainInterface.rx_sec / 1024).toFixed(2), // KB/s
                tx: (mainInterface.tx_sec / 1024).toFixed(2)  // KB/s
            };
        }
    } catch (error) {
        return { rx: 0, tx: 0 };
    }
}

io.on('connection', (socket) => {
    console.log('Cliente conectado:', socket.id);

    const systemInfo = {
        hostname: os.hostname(),
        platform: os.platform(),
        arch: os.arch(),
        cpuModel: os.cpus()[0].model,
        cpuCores: os.cpus().length,
        totalMemory: (os.totalmem() / (1024 ** 3)).toFixed(2)
    };
    socket.emit('system-info', systemInfo);

    const interval = setInterval(async () => {
        try {
            const cpu = await si.currentLoad();
            const mem = await si.mem();
            const temp = await si.cpuTemperature();
            const disk = await getDiskInfo();
            const network = await getNetworkInfo();
            const processes = await getTopProcesses();

            const data = {
                timestamp: new Date().toISOString(),
                cpu: parseFloat(cpu.currentLoad.toFixed(2)),
                ram: parseFloat(((mem.active / mem.total) * 100).toFixed(2)),
                temp: temp.main || 0,
                disk: disk,
                network: network,
                processes: processes,
                uptime: os.uptime()
            };

            socket.emit('datos-rendimiento', data);
        } catch (error) {
            console.error('Error obteniendo métricas:', error);
        }
    }, 1000);

    socket.on('disconnect', () => {
        console.log('Cliente desconectado:', socket.id);
        clearInterval(interval);
    });
});

server.listen(PORT, async () => {
    console.log('Monitor de Servidor Iniciado');
    console.log(`Servidor local: http://localhost:${PORT}`);
    console.log('');
    
    try {
        console.log('Creando túnel público con LocalTunnel...');
        const tunnel = await localtunnel({ 
            port: PORT,
            subdomain: 'monitor-' + Math.random().toString(36).substring(2, 8)
        });

        console.log('Túnel creado exitosamente!');
        console.log('URL pública:', tunnel.url);
        console.log('');
        console.log('Comparte esta URL para acceso remoto desde cualquier lugar');

        tunnel.on('close', () => {
            console.log('Túnel cerrado');
        });

        tunnel.on('error', (err) => {
            console.error('Error en túnel:', err);
        });

    } catch (error) {
        console.error('Error creando túnel:', error.message);
        console.log('El servidor sigue funcionando en modo local');
    }
});

process.on('SIGINT', () => {
    console.log('\nCerrando servidor...');
    server.close(() => {
        console.log('Servidor cerrado');
        process.exit(0);
    });
});
