# Local Redis Setup (WSL)

The backend uses Redis (via BullMQ/ioredis) for the campaign and email queues. In development
you can run Redis locally instead of relying on a hosted provider (e.g. Upstash), which avoids
hitting free-tier request quotas.

On Windows, the simplest way to run Redis is inside WSL (Windows Subsystem for Linux), since
there's no official native Windows build.

## 1. Install WSL (skip if already installed)

```powershell
wsl --install
```

Restart if prompted, then set up an Ubuntu user on first launch.

## 2. Install Redis inside WSL

Open a WSL shell:

```powershell
wsl -d Ubuntu
```

Then install Redis:

```bash
sudo apt-get update
sudo apt-get install -y redis-server
```

## 3. Start Redis

```bash
sudo service redis-server start
```

Verify it's running:

```bash
redis-cli ping
# -> PONG
```

`sudo service redis-server start` needs to be re-run any time you restart WSL or reboot Windows —
the service does not start automatically. To avoid running it manually every time, enable it to
start on WSL boot:

```bash
sudo systemctl enable redis-server
```

(Requires systemd support in WSL, which is on by default for Ubuntu on recent WSL versions. Check
with `cat /proc/1/comm` — it should print `systemd`, not `init`.)

## 4. Point the backend at local Redis

In `backend/.env`, set:

```bash
REDIS_URL=redis://localhost:6379
```

WSL2 shares `localhost` with Windows, so the backend (running natively on Windows) can reach
Redis inside WSL via `localhost:6379` with no extra networking config.

If you were previously using a hosted Redis (e.g. Upstash), comment that line out rather than
deleting it, so you can switch back easily:

```bash
# REDIS_URL=rediss://default:<password>@<host>.upstash.io:6379
REDIS_URL=redis://localhost:6379
```

## 5. Restart the backend

```bash
npm start
```

You should see:

```
[DB] Connected to PostgreSQL
[Redis] Connected
[Worker] Campaign worker started
[Worker] Email worker started
```

## Notes

- Data in local Redis is not persistent across `sudo service redis-server start` restarts unless
  RDB/AOF persistence is configured — fine for dev, since queues are transient job data.
- Switching between local and hosted Redis does not migrate queued jobs; anything queued in one
  will not appear in the other.
- To stop Redis: `sudo service redis-server stop`.
