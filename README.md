# 📹 Camera NOC Dashboard

Hệ thống Web Dashboard giám sát 1.000+ Camera ACTi và tự động định vị Port trên Switch Cisco thông qua SNMP.

---

## 🏗️ Kiến trúc hệ thống

```
┌──────────────────────────────────────────────────────────┐
│                   NGINX (Port 3000/80)                    │
│    /api/*  →  FastAPI Backend                            │
│    /*      →  React SPA                                  │
└──────────────┬───────────────────────────────────────────┘
               │
   ┌───────────▼──────────────┐
   │   FastAPI Backend :8000   │
   │  ┌─────────────────────┐ │
   │  │   APScheduler       │ │
   │  │  Ping  (30s)        │ │   ←── asyncio kiểm tra 1000 IP
   │  │  SNMP  (60 phút)    │ │   ←── SNMP walk Cisco Switch
   │  └─────────────────────┘ │
   │  REST API + WebSocket     │
   └───────────┬───────────────┘
               │
   ┌───────────▼───────────────┐
   │   SQLite (camera_monitor.db) │
   │  cameras, switches           │
   │  network_mappings, alerts    │
   └───────────────────────────┘
```

---

## 🚀 Cài đặt nhanh (Docker)

### Yêu cầu
- Docker Desktop đã được cài đặt
- Docker Compose v2+

### Khởi chạy

```bash
# 1. Clone / download project
cd logcam

# 2. Tạo file .env cho backend
cp backend/.env.example backend/.env

# 3. Build và chạy
docker-compose up --build

# 4. Truy cập dashboard
# http://localhost:3000
```

### Tạo dữ liệu mẫu (1000 camera)

```bash
# Sau khi backend đang chạy:
docker-compose exec backend python seed_data.py
```

---

## 🖥️ Cài đặt thủ công (Development)

### Backend

```bash
cd backend

# Tạo virtual environment
python -m venv venv

# Kích hoạt (Windows)
venv\Scripts\activate

# Kích hoạt (Linux/Mac)
source venv/bin/activate

# Cài dependencies
pip install -r requirements.txt

# Tạo file .env
cp .env.example .env

# Chạy backend
uvicorn app.main:app --reload --port 8000

# Seed dữ liệu mẫu (terminal khác)
python seed_data.py
```

### Frontend

```bash
cd frontend

# Cài Node packages
npm install

# Chạy dev server (có proxy /api → localhost:8000)
npm run dev

# Truy cập: http://localhost:5173
```

---

## 📡 SNMP Configuration

### Thêm Switch Cisco qua API

```bash
curl -X POST http://localhost:8000/api/switches \
  -H "Content-Type: application/json" \
  -d '{
    "ip": "192.168.1.1",
    "hostname": "SW-CORE-01",
    "community_string": "public",
    "snmp_version": "v2c",
    "location": "Server Room A"
  }'
```

### Thêm Camera

```bash
curl -X POST http://localhost:8000/api/cameras \
  -H "Content-Type: application/json" \
  -d '{
    "name": "CAM-01-Lobby",
    "ip": "192.168.10.101",
    "mac_address": "00:1A:2B:3C:4D:5E",
    "model": "ACTi E71",
    "location": "Sảnh tầng 1"
  }'
```

---

## 🔌 API Endpoints

| Method | Endpoint | Mô tả |
|--------|----------|-------|
| GET | `/api/dashboard/summary` | Tổng quan KPI |
| GET | `/api/cameras` | Danh sách camera (filter, search, paginate) |
| POST | `/api/cameras` | Thêm camera mới |
| GET | `/api/switches` | Danh sách switch |
| POST | `/api/switches` | Thêm switch mới |
| POST | `/api/scan/ping` | Kích hoạt quét ping ngay |
| POST | `/api/scan/mac-table` | Kích hoạt quét SNMP ngay |
| GET | `/api/scan/status` | Trạng thái job đang chạy |
| WS | `/api/events/ws` | WebSocket real-time events |
| GET | `/health` | Health check |

### Query params cho `/api/cameras`

| Param | Mô tả | Ví dụ |
|-------|-------|-------|
| `page` | Trang hiện tại (default: 1) | `?page=2` |
| `page_size` | Số dòng/trang (default: 50) | `?page_size=100` |
| `status` | Lọc trạng thái | `?status=OFFLINE` |
| `search` | Tìm kiếm IP/Tên/Port | `?search=192.168.1` |
| `switch_id` | Lọc theo switch | `?switch_id=3` |

---

## 🗄️ Database Schema

```sql
-- Switch Cisco
CREATE TABLE switch (
    id INTEGER PRIMARY KEY,
    ip TEXT UNIQUE NOT NULL,
    hostname TEXT,
    community_string TEXT DEFAULT 'public',
    snmp_version TEXT DEFAULT 'v2c',
    location TEXT,
    last_scanned_at DATETIME
);

-- Camera ACTi
CREATE TABLE camera (
    id INTEGER PRIMARY KEY,
    name TEXT NOT NULL,
    ip TEXT UNIQUE NOT NULL,
    mac_address TEXT,
    model TEXT,
    location TEXT,
    created_at DATETIME
);

-- Ánh xạ Camera ↔ Switch Port
CREATE TABLE networkmapping (
    id INTEGER PRIMARY KEY,
    camera_id INTEGER REFERENCES camera(id),
    switch_id INTEGER REFERENCES switch(id),
    switch_port TEXT,          -- Gi1/0/12
    vlan INTEGER,
    status TEXT,               -- ONLINE / OFFLINE
    last_seen_at DATETIME,
    latency_ms REAL
);

-- Log cảnh báo
CREATE TABLE alertlog (
    id INTEGER PRIMARY KEY,
    camera_id INTEGER REFERENCES camera(id),
    event_type TEXT,           -- OFFLINE / RECOVERED
    timestamp DATETIME,
    acknowledged BOOLEAN DEFAULT 0
);
```

---

## ⚙️ Cấu hình (.env)

```ini
DATABASE_URL=sqlite:///./data/camera_monitor.db
SECRET_KEY=your-secret-key-here
PING_INTERVAL_SECONDS=30        # Chu kỳ ping (giây)
SNMP_INTERVAL_SECONDS=3600      # Chu kỳ SNMP (giây, mặc định 1 tiếng)
PING_CONCURRENCY=500            # Số IP ping đồng thời
PING_TIMEOUT=1.0                # Timeout mỗi lần ping (giây)
CORS_ORIGINS=["http://localhost:3000","http://localhost:5173"]
```

---

## 🔧 Giao thức SNMP — OID Reference

| OID | MIB | Mô tả |
|-----|-----|-------|
| `1.3.6.1.2.1.17.4.3.1.1` | BRIDGE-MIB `dot1dTpFdbAddress` | MAC addresses học được |
| `1.3.6.1.2.1.17.4.3.1.2` | BRIDGE-MIB `dot1dTpFdbPort` | Port index của MAC |
| `1.3.6.1.2.1.17.1.4.1.2` | BRIDGE-MIB `dot1dBasePortIfIndex` | Map port index → ifIndex |
| `1.3.6.1.2.1.31.1.1.1.1` | IF-MIB `ifName` | Tên interface vật lý |
| `1.3.6.1.2.1.4.22.1.2` | IP-MIB `ipNetToMediaPhysAddress` | Bảng ARP (IP → MAC) |

---

## 📊 Yêu cầu hệ thống

| Thành phần | Tối thiểu | Khuyến nghị |
|------------|-----------|-------------|
| CPU | 2 cores | 4 cores |
| RAM | 2 GB | 4 GB |
| Disk | 10 GB | 20 GB |
| Network | 100 Mbps | 1 Gbps |
| OS | Ubuntu 20.04 / Windows 10 | Ubuntu 22.04 LTS |

---

## 📁 Cấu trúc dự án

```
logcam/
├── backend/
│   ├── app/
│   │   ├── main.py           # FastAPI app entry point
│   │   ├── config.py         # Settings từ .env
│   │   ├── database.py       # SQLite engine & session
│   │   ├── models.py         # ORM models
│   │   ├── schemas.py        # Pydantic schemas
│   │   ├── api/
│   │   │   ├── dashboard.py  # Summary endpoint
│   │   │   ├── cameras.py    # Camera CRUD + filter
│   │   │   ├── switches.py   # Switch CRUD
│   │   │   ├── scan.py       # Manual scan trigger
│   │   │   └── websocket.py  # Real-time WebSocket
│   │   └── services/
│   │       ├── ping_checker.py   # Async ping 1000 IPs
│   │       ├── snmp_crawler.py   # SNMP MAC table walk
│   │       ├── scheduler.py      # APScheduler jobs
│   │       └── alert_manager.py  # WebSocket broadcast
│   ├── seed_data.py          # Script tạo 1000 camera mẫu
│   ├── requirements.txt
│   ├── Dockerfile
│   └── .env.example
├── frontend/
│   ├── src/
│   │   ├── App.jsx           # Layout chính
│   │   ├── api/client.js     # Axios client
│   │   ├── hooks/            # TanStack Query hooks
│   │   └── components/       # UI components
│   ├── package.json
│   ├── vite.config.js
│   └── Dockerfile
├── docker-compose.yml        # Orchestration
├── nginx.conf                # Reverse proxy config
└── README.md
```

---

## 🐛 Troubleshooting

### Backend không khởi động
```bash
# Kiểm tra log
docker-compose logs backend

# Chạy tay để xem lỗi rõ hơn
cd backend
python -m uvicorn app.main:app --reload
```

### SNMP không lấy được data
1. Kiểm tra community string đúng chưa
2. Đảm bảo Switch cho phép SNMP từ IP server
3. Thử test thủ công: `snmpwalk -v2c -c public <switch_ip> 1.3.6.1.2.1.17.4.3.1.1`

### Ping không hoạt động trong Docker
- Trên Linux: Container cần `--cap-add NET_RAW` để dùng ICMP raw socket
- Fallback TCP mode sẽ tự động được dùng nếu ICMP không khả dụng

---

*Phát triển bởi NOC Team | Version 1.0.0*
