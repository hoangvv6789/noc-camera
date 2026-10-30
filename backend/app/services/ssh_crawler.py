"""
Service SSH Crawler — Định vị Cổng Switch cho Camera qua kết nối SSH Cisco.
Tự động:
  1. Đọc 'show ip arp' -> Tự động tìm & điền Địa Chỉ MAC cho Camera nếu chưa có hoặc có thay đổi.
  2. Đọc 'show cdp neighbors' & 'show interfaces trunk' -> Loại bỏ các cổng nối giữa các Switch (Trunk / Uplink).
  3. Đọc 'show mac address-table' -> Định vị chính xác Cổng Access vật lý (1 MAC duy nhất).
"""

import re
import os
import time
import subprocess
import logging
from collections import defaultdict
from concurrent.futures import ThreadPoolExecutor, as_completed
from datetime import datetime, timezone
from typing import Dict, List, Optional, Tuple
from sqlmodel import Session, select


from app.database import engine
from app.models import Switch, Camera, NetworkMapping

try:
    from netmiko import ConnectHandler
    from netmiko.exceptions import NetmikoTimeoutException, NetmikoAuthenticationException
    NETMIKO_AVAILABLE = True
except ImportError:
    NETMIKO_AVAILABLE = False

logger = logging.getLogger(__name__)


def exec_cisco_command(switch_ip: str, username: str, password: str, secret: Optional[str] = None, command: str = "show version") -> dict:
    """
    Thực thi trực tiếp một lệnh Cisco qua SSH và trả về kết quả chuẩn văn bản.
    Hỗ trợ chẩn đoán cổng, show run, show mac, ping, shut/no shut...
    """
    if not NETMIKO_AVAILABLE:
        return {"success": False, "output": "Thư viện Netmiko chưa được cài đặt trong môi trường chạy."}

    device_params = {
        "device_type": "cisco_ios",
        "host": switch_ip.strip(),
        "username": username.strip(),
        "password": password.strip(),
        "timeout": 10,
        "session_timeout": 15,
        "global_delay_factor": 0.5,
    }
    if secret and secret.strip():
        device_params["secret"] = secret.strip()

    try:
        net_connect = ConnectHandler(**device_params)
        if secret and secret.strip() and not net_connect.check_enable_mode():
            net_connect.enable()

        cmd_str = command.strip()
        lines = [l.strip() for l in cmd_str.splitlines() if l.strip()]

        # Kiểm tra xem có phải lệnh cấu hình (Config mode) hay không
        is_config = len(lines) > 1 or any(
            re.match(r'^(conf|interface|int|vlan|shutdown|no\s+shutdown|switchport|ip\s+route|speed|duplex|description|power)', l, re.IGNORECASE)
            for l in lines
        )

        if is_config:
            # Lọc bỏ các dòng 'conf t', 'configure terminal', 'end', 'exit' vì send_config_set tự động quản lý vào/ra config mode
            config_commands = [
                l for l in lines
                if not re.match(r'^(conf\s*t|configure\s+terminal|end|exit)$', l, re.IGNORECASE)
            ]
            output = net_connect.send_config_set(config_commands, read_timeout=20)
        else:
            output = net_connect.send_command(cmd_str, read_timeout=15)

        net_connect.disconnect()

        return {
            "success": True,
            "command": command,
            "switch_ip": switch_ip,
            "output": output
        }

    except NetmikoAuthenticationException:
        return {"success": False, "output": f"❌ Lỗi xác thực SSH: Sai tài khoản/mật khẩu trên Switch {switch_ip}"}
    except NetmikoTimeoutException:
        return {"success": False, "output": f"❌ Lỗi kết nối SSH: Không thể kết nối tới IP Switch {switch_ip} (Timeout 10s). Kiểm tra lại dây mạng hoặc IP."}
    except Exception as e:
        return {"success": False, "output": f"❌ Lỗi khi thực thi lệnh SSH: {str(e)}"}


def reset_cisco_port(
    switch_ip: str,
    username: str,
    password: str,
    secret: Optional[str] = None,
    port: str = "Gi1/0/1",
    delay_seconds: int = 15
) -> dict:
    """
    Thực hiện chu trình reset an toàn cổng Switch Cisco:
    1. Gửi lệnh: interface <port> -> shutdown
    2. Đợi delay_seconds (từ 15 đến 30 giây) để camera tắt nguồn PoE hoàn toàn
    3. Gửi lệnh: interface <port> -> no shutdown
    4. Trả về toàn bộ log thực thi kèm thời gian chi tiết.
    """
    if not NETMIKO_AVAILABLE:
        return {"success": False, "output": "Thư viện Netmiko chưa được cài đặt trong môi trường chạy."}

    # Giới hạn delay_seconds trong khoảng 10 đến 60 giây (mặc định 15s)
    delay_seconds = max(10, min(60, int(delay_seconds)))

    device_params = {
        "device_type": "cisco_ios",
        "host": switch_ip.strip(),
        "username": username.strip(),
        "password": password.strip(),
        "timeout": 15,
        "session_timeout": 70,
        "global_delay_factor": 0.5,
    }
    if secret and secret.strip():
        device_params["secret"] = secret.strip()

    try:
        net_connect = ConnectHandler(**device_params)
        if secret and secret.strip() and not net_connect.check_enable_mode():
            net_connect.enable()

        log_lines = []
        now_str = datetime.now().strftime('%H:%M:%S')
        log_lines.append(f"[{now_str}] Đã kết nối SSH tới Switch {switch_ip}.")
        
        # Bước 1: Shutdown port
        now_str = datetime.now().strftime('%H:%M:%S')
        log_lines.append(f"[{now_str}] [1/3] Đang gửi lệnh ngắt cổng: interface {port} -> shutdown ...")
        out1 = net_connect.send_config_set([f"interface {port}", "shutdown"], read_timeout=15)
        log_lines.append(out1)
        
        now_str = datetime.now().strftime('%H:%M:%S')
        log_lines.append(f"[{now_str}] 🔌 Đã ngắt cổng {port}. Đang tạm dừng {delay_seconds} giây để xả hết nguồn PoE / ngắt nguồn camera...")

        # Bước 2: Sleep delay_seconds
        time.sleep(delay_seconds)

        # Bước 3: No shutdown port
        now_str = datetime.now().strftime('%H:%M:%S')
        log_lines.append(f"[{now_str}] [2/3] Hết {delay_seconds}s tạm dừng. Đang gửi lệnh mở lại cổng: interface {port} -> no shutdown ...")
        out2 = net_connect.send_config_set([f"interface {port}", "no shutdown"], read_timeout=15)
        log_lines.append(out2)
        
        now_str = datetime.now().strftime('%H:%M:%S')
        log_lines.append(f"[{now_str}] ⚡ [3/3] Đã bật lại cổng {port}. Camera đang khởi động lại thành công!")

        net_connect.disconnect()

        return {
            "success": True,
            "switch_ip": switch_ip,
            "port": port,
            "delay_seconds": delay_seconds,
            "output": "\n".join(log_lines)
        }

    except NetmikoAuthenticationException:
        return {"success": False, "output": f"❌ Lỗi xác thực SSH: Sai tài khoản/mật khẩu trên Switch {switch_ip}"}
    except NetmikoTimeoutException:
        return {"success": False, "output": f"❌ Lỗi kết nối SSH: Không thể kết nối tới IP Switch {switch_ip} (Timeout 15s). Kiểm tra lại dây mạng hoặc IP."}
    except Exception as e:
        return {"success": False, "output": f"❌ Lỗi khi reset cổng Switch: {str(e)}"}


def normalize_port_name(port: str) -> str:

    """Rút gọn tên port về chuẩn: GigabitEthernet1/0/1 -> Gi1/0/1."""
    p = port.strip()
    p = re.sub(r'^GigabitEthernet', 'Gi', p, flags=re.IGNORECASE)
    p = re.sub(r'^FastEthernet', 'Fa', p, flags=re.IGNORECASE)
    p = re.sub(r'^TenGigabitEthernet', 'Te', p, flags=re.IGNORECASE)
    p = re.sub(r'^TwentyFiveGigE', 'Twe', p, flags=re.IGNORECASE)
    p = re.sub(r'^FortyGigabitEthernet', 'Fo', p, flags=re.IGNORECASE)
    p = re.sub(r'^HundredGigE', 'Hu', p, flags=re.IGNORECASE)
    p = re.sub(r'^Port-channel', 'Po', p, flags=re.IGNORECASE)
    p = re.sub(r'^Ethernet', 'Eth', p, flags=re.IGNORECASE)
    return p


def cisco_mac_to_standard(cisco_mac: str) -> str:
    """Chuyển MAC dạng Cisco xxxx.xxxx.xxxx hoặc xxxx-xxxx-xxxx về chuẩn XX:XX:XX:XX:XX:XX."""
    clean = re.sub(r'[^a-fA-F0-9]', '', cisco_mac)
    if len(clean) != 12:
        return cisco_mac.upper()
    return ':'.join(clean[i:i+2].upper() for i in range(0, 12, 2))


def get_local_arp_table() -> Dict[str, str]:
    """Lấy bảng ARP từ máy tính hiện tại (IP -> MAC) qua lệnh arp -a."""
    ip_to_mac = {}
    try:
        res = subprocess.run(['arp', '-a'], capture_output=True, text=True, timeout=5)
        for line in res.stdout.splitlines():
            # Format Windows: 172.19.1.96    00-0f-7c-15-4d-36     dynamic
            match = re.search(r'(\d+\.\d+\.\d+\.\d+)\s+([0-9a-fA-F]{2}[-:][0-9a-fA-F]{2}[-:][0-9a-fA-F]{2}[-:][0-9a-fA-F]{2}[-:][0-9a-fA-F]{2}[-:][0-9a-fA-F]{2})', line)
            if match:
                ip = match.group(1).strip()
                mac = match.group(2).upper().replace('-', ':')
                ip_to_mac[ip] = mac
    except Exception as e:
        logger.debug(f"Local ARP note: {e}")
    return ip_to_mac


def get_cdp_neighbor_ports(net_connect) -> set:
    """Tìm tất cả các port đang nối sang Switch khác từ show cdp neighbors."""
    cdp_ports = set()
    try:
        output = net_connect.send_command("show cdp neighbors", read_timeout=10)
        for line in output.splitlines():
            line = line.strip()
            if not line or "Device ID" in line or "Capability" in line or "---" in line:
                continue
            match = re.search(r'\s+(Gig|Fas|Ten|Eth|Gi|Fa|Te)\s*(\d+/\d+(?:/\d+)?)\s+', line)
            if match:
                prefix = match.group(1)
                port_num = match.group(2)
                p_short = f"{prefix[:2].capitalize()}{port_num}"
                cdp_ports.add(normalize_port_name(p_short).lower())
    except Exception as e:
        logger.debug(f"CDP note: {e}")
    return cdp_ports


def get_trunk_ports(net_connect) -> set:
    """Lấy danh sách cổng Trunk 802.1q từ show interfaces trunk."""
    trunk_ports = set()
    try:
        output = net_connect.send_command("show interfaces trunk", read_timeout=10)
        for line in output.splitlines():
            line = line.strip()
            if not line or "Port" in line or "---" in line or "Vlans" in line or ("mode" in line.lower() and "status" in line.lower()):
                continue
            parts = line.split()
            if len(parts) >= 4 and "trunk" in parts[3].lower():
                norm = normalize_port_name(parts[0])
                trunk_ports.add(norm.lower())
                trunk_ports.add(parts[0].lower())
    except Exception as e:
        logger.debug(f"Trunk note: {e}")
    return trunk_ports


def crawl_single_switch(switch: Switch, username: str, password: str, secret: str = None) -> Tuple[List[dict], Dict[str, str]]:
    """
    Kết nối SSH vào 1 switch:
    - Thu thập bảng MAC (MAC -> Port)
    - Thu thập bảng ARP (IP -> MAC)
    """
    if not NETMIKO_AVAILABLE:
        logger.error("Thư viện netmiko chưa được cài đặt.")
        return [], {}

    device_params = {
        "device_type": "cisco_ios",
        "host": switch.ip,
        "username": username,
        "password": password,
        "timeout": 10,
        "session_timeout": 15,
        "global_delay_factor": 0.5,
    }
    if secret:
        device_params["secret"] = secret

    try:
        logger.info(f"[{switch.hostname}] Đang kết nối SSH ({switch.ip})...")
        net_connect = ConnectHandler(**device_params)

        # 1. Thu thập bảng ARP (IP -> MAC) từ switch
        switch_arp = {}
        try:
            arp_out = net_connect.send_command("show ip arp", read_timeout=10)
            for line in arp_out.splitlines():
                # Format: Internet  172.19.1.96   5   000f.7c15.4d36  ARPA  Vlan1
                m = re.search(r'(\d+\.\d+\.\d+\.\d+)\s+\S+\s+([0-9a-fA-F]{4}\.[0-9a-fA-F]{4}\.[0-9a-fA-F]{4})', line)
                if m:
                    ip = m.group(1).strip()
                    mac = cisco_mac_to_standard(m.group(2))
                    switch_arp[ip] = mac
            logger.info(f"[{switch.hostname}] Đã đọc được {len(switch_arp)} mục ARP (IP -> MAC).")
        except Exception as e:
            logger.debug(f"[{switch.hostname}] Không lấy được show ip arp: {e}")

        # 2. Thu thập danh sách cổng liên kết (Trunk & CDP Neighbor)
        cdp_ports = get_cdp_neighbor_ports(net_connect)
        trunk_ports = get_trunk_ports(net_connect)
        uplink_ports = cdp_ports.union(trunk_ports)

        # 3. Lấy toàn bộ bảng MAC
        output = net_connect.send_command("show mac address-table dynamic", read_timeout=10)
        if "Invalid input" in output or "Incomplete command" in output or len(output.strip()) < 30:
            output = net_connect.send_command("show mac address-table", read_timeout=10)

        net_connect.disconnect()

        raw_entries = []
        port_counts = defaultdict(int)

        for line in output.splitlines():
            line = line.strip()
            if not line:
                continue

            match = re.search(r'([0-9a-fA-F]{4}\.[0-9a-fA-F]{4}\.[0-9a-fA-F]{4})\s+(?:DYNAMIC|STATIC|dynamic|static)\s+(\S+)', line)
            if match:
                raw_mac = match.group(1)
                raw_port = match.group(2)
                port_norm = normalize_port_name(raw_port)
                std_mac = cisco_mac_to_standard(raw_mac)

                p_lower = port_norm.lower()
                if p_lower.startswith(('po', 'te', 'vl', 'cpu', 'drop', 'router', 'null')):
                    continue

                raw_entries.append((std_mac, port_norm))
                port_counts[port_norm] += 1

        results = []
        for std_mac, port_norm in raw_entries:
            p_lower = port_norm.lower()
            count = port_counts[port_norm]
            is_uplink = (p_lower in uplink_ports) or (count >= 3)

            results.append({
                "mac": std_mac,
                "port": port_norm,
                "port_mac_count": count,
                "is_uplink": is_uplink,
                "switch_id": switch.id,
                "switch_name": switch.hostname,
                "switch_ip": switch.ip,
            })

        return results, switch_arp

    except NetmikoAuthenticationException:
        logger.error(f"[{switch.hostname}] ❌ Sai tài khoản/mật khẩu SSH")
        return [], {}
    except Exception as e:
        logger.error(f"[{switch.hostname}] ❌ Lỗi kết nối SSH: {e}")
        return [], {}


class SwitchStub:
    def __init__(self, id: int, hostname: str, ip: str):
        self.id = id
        self.hostname = hostname
        self.ip = ip


def crawl_all_switches_ssh(username: str, password: str, secret: str = None) -> dict:
    """
    Quét toàn bộ switch trong DB qua SSH song song (ThreadPoolExecutor):
    1. Tự động tìm và cập nhật Địa chỉ MAC cho Camera nếu chưa có (qua ARP).
    2. So khớp định vị đúng Switch và Port Access cho từng Camera.
    """
    if not NETMIKO_AVAILABLE:
        return {"total_mapped": 0, "switches_scanned": 0, "message": "Thư viện Netmiko chưa được cài đặt"}

    # 1. Thu thập danh sách Switch dưới dạng Plain Objects (không giữ DB session)
    with Session(engine) as session:
        switches_data = [
            {"id": sw.id, "hostname": sw.hostname, "ip": sw.ip}
            for sw in session.exec(select(Switch)).all()
        ]

    if not switches_data:
        return {"total_mapped": 0, "switches_scanned": 0, "message": "Không có switch nào trong hệ thống"}

    global_arp: Dict[str, str] = get_local_arp_table()
    all_candidates = defaultdict(list)
    scanned_count = 0
    scanned_switch_ids = set()

    def _worker(sw_dict):
        stub = SwitchStub(sw_dict["id"], sw_dict["hostname"], sw_dict["ip"])
        entries, switch_arp = crawl_single_switch(stub, username, password, secret)
        return sw_dict["id"], sw_dict["hostname"], entries, switch_arp

    max_workers = min(8, len(switches_data))
    logger.info(f"Bắt đầu quét song song {len(switches_data)} Switch qua SSH (max_workers={max_workers})...")

    with ThreadPoolExecutor(max_workers=max_workers) as executor:
        future_to_sw = {executor.submit(_worker, sw): sw for sw in switches_data}
        for future in as_completed(future_to_sw):
            sw = future_to_sw[future]
            try:
                sw_id, hostname, entries, switch_arp = future.result()
                if switch_arp:
                    global_arp.update(switch_arp)
                if entries:
                    scanned_count += 1
                    scanned_switch_ids.add(sw_id)
                    for entry in entries:
                        all_candidates[entry["mac"].upper()].append(entry)
            except Exception as e:
                logger.error(f"[{sw['hostname']}] Lỗi worker crawl SSH: {e}")

    # 2. Cập nhật DB trong một session ngắn, độc lập, không N+1 query
    with Session(engine) as session:
        cameras = session.exec(select(Camera)).all()
        mac_discovered_count = 0

        for cam in cameras:
            if not cam.mac_address and cam.ip in global_arp:
                cam.mac_address = global_arp[cam.ip]
                session.add(cam)
                mac_discovered_count += 1
                logger.info(f"Tự động phát hiện MAC cho {cam.name} ({cam.ip}) -> {cam.mac_address}")
            elif cam.mac_address:
                norm = cam.mac_address.upper().replace('-', ':').replace('.', ':')
                if cam.mac_address != norm:
                    cam.mac_address = norm
                    session.add(cam)

        # Pre-fetch toàn bộ NetworkMapping trong 1 truy vấn duy nhất để tránh IndexError & query loop
        existing_mappings = {m.camera_id: m for m in session.exec(select(NetworkMapping)).all()}

        total_mapped = 0
        now = datetime.now(timezone.utc)

        for camera in cameras:
            if not camera.mac_address:
                continue
            norm_mac = camera.mac_address.upper().replace('-', ':').replace('.', ':')
            candidates = all_candidates.get(norm_mac, [])
            if not candidates:
                continue

            access_candidates = [c for c in candidates if not c["is_uplink"]]
            if access_candidates:
                access_candidates.sort(key=lambda x: x["port_mac_count"])
                best_candidate = access_candidates[0]
            else:
                candidates.sort(key=lambda x: x["port_mac_count"])
                best_candidate = candidates[0]

            sw_id = best_candidate["switch_id"]
            port_name = best_candidate["port"]

            mapping = existing_mappings.get(camera.id)
            if mapping:
                mapping.switch_id = sw_id
                mapping.switch_port = port_name
                mapping.last_seen_at = now
                session.add(mapping)
            else:
                mapping = NetworkMapping(
                    camera_id=camera.id,
                    switch_id=sw_id,
                    switch_port=port_name,
                    status="ONLINE",
                    last_seen_at=now,
                )
                session.add(mapping)
                existing_mappings[camera.id] = mapping

            total_mapped += 1

        if scanned_switch_ids:
            switches = session.exec(select(Switch)).all()
            for sw in switches:
                if sw.id in scanned_switch_ids:
                    sw.last_scanned_at = now
                    session.add(sw)

        session.commit()

        msg = f"Đã định vị thành công {total_mapped}/{len(cameras)} Camera"
        if mac_discovered_count > 0:
            msg += f" (Tìm thấy {mac_discovered_count} MAC mới)"
        msg += f" trên {scanned_count} Switch!"

        logger.info(msg)
        return {
            "total_mapped": total_mapped,
            "total_cameras": len(cameras),
            "mac_discovered": mac_discovered_count,
            "switches_scanned": scanned_count,
            "message": msg
        }


def std_mac_to_cisco(mac: str) -> str:
    """Chuyển XX:XX:XX:XX:XX:XX hoặc XX-XX-XX-XX-XX-XX thành dạng Cisco xxxx.xxxx.xxxx."""
    clean = re.sub(r'[^a-fA-F0-9]', '', mac).lower()
    if len(clean) == 12:
        return f"{clean[0:4]}.{clean[4:8]}.{clean[8:12]}"
    return mac.lower()


def crawl_single_camera_mac(camera_id: int, username: str, password: str, secret: Optional[str] = None) -> dict:
    """
    Quét tìm vị trí Switch & Cổng kết nối cho 1 camera cụ thể song song qua ThreadPoolExecutor:
    1. Kiểm tra / Tự động tìm MAC từ ARP nếu camera chưa có MAC.
    2. Quét nhanh trên các Switch bằng lệnh 'show mac address-table address xxxx.xxxx.xxxx'.
    3. Cập nhật NetworkMapping và lưu vào DB.
    """
    if not NETMIKO_AVAILABLE:
        return {"success": False, "found": False, "message": "Thư viện Netmiko chưa được cài đặt."}

    # 1. Đọc camera và danh sách switch
    with Session(engine) as session:
        camera = session.get(Camera, camera_id)
        if not camera:
            return {"success": False, "found": False, "message": "Không tìm thấy camera"}
        cam_info = {"id": camera.id, "name": camera.name, "ip": camera.ip, "mac_address": camera.mac_address}
        switches_data = [
            {"id": sw.id, "hostname": sw.hostname, "ip": sw.ip}
            for sw in session.exec(select(Switch)).all()
        ]

    if not switches_data:
        return {"success": False, "found": False, "message": "Chưa có Switch nào được cấu hình trong hệ thống"}

    mac = cam_info["mac_address"]
    # Nếu chưa có MAC -> thử ping và đọc local ARP
    if not mac:
        try:
            from app.services.ping_checker import _windows_icmp_ping
            _windows_icmp_ping(cam_info["ip"], timeout_ms=500)
        except Exception:
            pass
        local_arp = get_local_arp_table()
        if cam_info["ip"] in local_arp:
            mac = local_arp[cam_info["ip"]]
            with Session(engine) as session:
                c = session.get(Camera, camera_id)
                if c:
                    c.mac_address = mac
                    session.add(c)
                    session.commit()

    if not mac:
        # Thử đọc ARP từ các switch (quét song song để nhanh)
        def _get_switch_arp(sw):
            device_params = {
                "device_type": "cisco_ios",
                "host": sw["ip"],
                "username": username,
                "password": password,
                "timeout": 6,
                "session_timeout": 8,
                "global_delay_factor": 0.5,
            }
            if secret:
                device_params["secret"] = secret
            try:
                net_connect = ConnectHandler(**device_params)
                arp_out = net_connect.send_command(f"show ip arp {cam_info['ip']}", read_timeout=6)
                net_connect.disconnect()
                m = re.search(r'([0-9a-fA-F]{4}\.[0-9a-fA-F]{4}\.[0-9a-fA-F]{4})', arp_out)
                if m:
                    return cisco_mac_to_standard(m.group(1))
            except Exception:
                pass
            return None

        with ThreadPoolExecutor(max_workers=8) as ex:
            fut_arp = {ex.submit(_get_switch_arp, sw): sw for sw in switches_data}
            for fut in as_completed(fut_arp):
                res_mac = fut.result()
                if res_mac:
                    mac = res_mac
                    with Session(engine) as session:
                        c = session.get(Camera, camera_id)
                        if c:
                            c.mac_address = mac
                            session.add(c)
                            session.commit()
                    break

    if not mac:
        return {
            "success": False,
            "found": False,
            "message": f"Không thể lấy được địa chỉ MAC của Camera '{cam_info['name']}' ({cam_info['ip']}). Hãy kiểm tra xem Camera có đang hoạt động hay không."
        }

    cisco_mac = std_mac_to_cisco(mac)

    # 2. Quét song song trên các switch để tìm MAC
    def _search_switch(sw):
        device_params = {
            "device_type": "cisco_ios",
            "host": sw["ip"],
            "username": username,
            "password": password,
            "timeout": 8,
            "session_timeout": 12,
            "global_delay_factor": 0.5,
        }
        if secret:
            device_params["secret"] = secret

        try:
            net_connect = ConnectHandler(**device_params)
            cmd = f"show mac address-table address {cisco_mac}"
            out = net_connect.send_command(cmd, read_timeout=8)
            if "Invalid input" in out or len(out.strip()) < 10:
                out = net_connect.send_command(f"show mac address-table dynamic | include {cisco_mac}", read_timeout=8)

            match = re.search(r'([0-9a-fA-F]{4}\.[0-9a-fA-F]{4}\.[0-9a-fA-F]{4})\s+(?:DYNAMIC|STATIC|dynamic|static)\s+(\S+)', out)
            if not match:
                net_connect.disconnect()
                return None

            raw_port = match.group(2)
            port_norm = normalize_port_name(raw_port)
            p_lower = port_norm.lower()

            if p_lower.startswith(('po', 'te', 'vl', 'cpu', 'drop', 'router', 'null')):
                net_connect.disconnect()
                return None

            cdp_ports = get_cdp_neighbor_ports(net_connect)
            trunk_ports = get_trunk_ports(net_connect)
            uplink_ports = cdp_ports.union(trunk_ports)
            is_uplink = (p_lower in uplink_ports)

            port_out = net_connect.send_command(f"show mac address-table interface {raw_port}", read_timeout=8)
            mac_lines = [l for l in port_out.splitlines() if re.search(r'[0-9a-fA-F]{4}\.[0-9a-fA-F]{4}\.[0-9a-fA-F]{4}', l)]
            mac_count = len(mac_lines)

            net_connect.disconnect()
            return {
                "switch_id": sw["id"],
                "switch_name": sw["hostname"],
                "switch_ip": sw["ip"],
                "port": port_norm,
                "is_uplink": is_uplink or (mac_count >= 3),
                "mac_count": mac_count,
            }
        except Exception as e:
            logger.debug(f"[{sw['hostname']}] Lỗi khi quét MAC camera {cisco_mac}: {e}")
            return None

    candidates = []
    with ThreadPoolExecutor(max_workers=8) as ex:
        futures = {ex.submit(_search_switch, sw): sw for sw in switches_data}
        for fut in as_completed(futures):
            res = fut.result()
            if res:
                candidates.append(res)

    if not candidates:
        return {
            "success": True,
            "found": False,
            "mac": mac,
            "camera_name": cam_info["name"],
            "camera_ip": cam_info["ip"],
            "message": f"Không tìm thấy địa chỉ MAC {mac} của Camera '{cam_info['name']}' trên bất kỳ Switch nào đã cấu hình."
        }

    access = [c for c in candidates if not c["is_uplink"]]
    if access:
        access.sort(key=lambda x: x["mac_count"])
        best = access[0]
    else:
        candidates.sort(key=lambda x: x["mac_count"])
        best = candidates[0]

    now = datetime.now(timezone.utc)
    with Session(engine) as session:
        mapping = session.exec(select(NetworkMapping).where(NetworkMapping.camera_id == camera_id)).first()
        if mapping:
            mapping.switch_id = best["switch_id"]
            mapping.switch_port = best["port"]
            mapping.last_seen_at = now
            session.add(mapping)
        else:
            mapping = NetworkMapping(
                camera_id=camera_id,
                switch_id=best["switch_id"],
                switch_port=best["port"],
                status="ONLINE",
                last_seen_at=now,
            )
            session.add(mapping)
        session.commit()

    return {
        "success": True,
        "found": True,
        "mac": mac,
        "camera_id": camera_id,
        "camera_name": cam_info["name"],
        "camera_ip": cam_info["ip"],
        "switch_name": best["switch_name"],
        "switch_ip": best["switch_ip"],
        "switch_port": best["port"],
        "message": f"✅ Đã định vị thành công '{cam_info['name']}': Switch {best['switch_name']} ({best['switch_ip']}) - Cổng {best['port']} (MAC: {mac})"
    }


def crawl_single_switch_and_update(switch_id: int, username: str, password: str, secret: Optional[str] = None) -> dict:
    """
    Quét riêng 1 switch: lấy toàn bộ bảng MAC & ARP, sau đó cập nhật các Camera gắn trên switch đó.
    """
    if not NETMIKO_AVAILABLE:
        return {"success": False, "mapped_count": 0, "message": "Thư viện Netmiko chưa được cài đặt."}

    with Session(engine) as session:
        sw = session.get(Switch, switch_id)
        if not sw:
            return {"success": False, "mapped_count": 0, "message": "Không tìm thấy Switch"}
        sw_stub = SwitchStub(sw.id, sw.hostname, sw.ip)

    entries, switch_arp = crawl_single_switch(sw_stub, username, password, secret)
    if not entries and not switch_arp:
        return {
            "success": False,
            "mapped_count": 0,
            "message": f"Không đọc được dữ liệu MAC/ARP từ Switch {sw_stub.hostname} ({sw_stub.ip}). Vui lòng kiểm tra SSH."
        }

    now = datetime.now(timezone.utc)
    mapped_count = 0

    with Session(engine) as session:
        cameras = session.exec(select(Camera)).all()
        # 1. Update MAC for cameras matching IP in switch_arp
        for cam in cameras:
            if cam.ip in switch_arp:
                cam.mac_address = switch_arp[cam.ip]
                session.add(cam)

        # 2. Match entries to cameras
        cam_by_mac = {}
        for cam in cameras:
            if cam.mac_address:
                norm_mac = cam.mac_address.upper().replace('-', ':').replace('.', ':')
                cam_by_mac[norm_mac] = cam

        existing_mappings = {m.camera_id: m for m in session.exec(select(NetworkMapping)).all()}

        # Group entries by mac
        entries_by_mac = defaultdict(list)
        for e in entries:
            entries_by_mac[e["mac"].upper()].append(e)

        for norm_mac, cam in cam_by_mac.items():
            candidates = entries_by_mac.get(norm_mac)
            if not candidates:
                continue
            access = [c for c in candidates if not c["is_uplink"]]
            best = access[0] if access else candidates[0]

            mapping = existing_mappings.get(cam.id)
            if mapping:
                mapping.switch_id = sw_stub.id
                mapping.switch_port = best["port"]
                mapping.last_seen_at = now
                session.add(mapping)
            else:
                mapping = NetworkMapping(
                    camera_id=cam.id,
                    switch_id=sw_stub.id,
                    switch_port=best["port"],
                    status="ONLINE",
                    last_seen_at=now,
                )
                session.add(mapping)
                existing_mappings[cam.id] = mapping
            mapped_count += 1

        db_sw = session.get(Switch, switch_id)
        if db_sw:
            db_sw.last_scanned_at = now
            session.add(db_sw)

        session.commit()

    return {
        "success": True,
        "mapped_count": mapped_count,
        "switch_hostname": sw_stub.hostname,
        "switch_ip": sw_stub.ip,
        "message": f"✅ Đã quét xong Switch {sw_stub.hostname}: Định vị {mapped_count} camera trên các cổng!"
    }

