"""
SNMP Crawler — quét MAC table từ Cisco Switch để map Camera → Switch Port.

Quy trình:
  1. Walk OID dot1dTpFdbPort (1.3.6.1.2.1.17.4.3.1.2) → {mac_bytes: bridge_port_index}
  2. Walk OID dot1dBasePortIfIndex (1.3.6.1.2.1.17.1.4.1.2) → {bridge_port_index: ifIndex}
  3. Walk OID ifName (1.3.6.1.2.1.31.1.1.1.1) → {ifIndex: "Gi1/0/12"}
  4. Match MAC với Camera.mac_address → cập nhật NetworkMapping

Hỗ trợ pysnmp 7.x (API: pysnmp.hlapi.v3arch.asyncio)
"""

import logging
from typing import Dict, Optional, List
from datetime import datetime, timezone
from sqlmodel import Session, select

from app.models import Switch, Camera, NetworkMapping
from app.database import engine

logger = logging.getLogger(__name__)

PYSNMP_AVAILABLE = False

try:
    # pysnmp >= 7.0 (pysnmp 7.1.x)
    from pysnmp.hlapi.v3arch.asyncio import (
        SnmpEngine, CommunityData, UdpTransportTarget,
        ContextData, ObjectType, ObjectIdentity, walk_cmd,
    )
    PYSNMP_AVAILABLE = True
    logger.info("pysnmp 7.x loaded (v3arch.asyncio)")
except ImportError:
    try:
        from pysnmp.hlapi.asyncio import (
            SnmpEngine, CommunityData, UdpTransportTarget,
            ContextData, ObjectType, ObjectIdentity, nextCmd as walk_cmd,
        )
        PYSNMP_AVAILABLE = True
        logger.info("pysnmp legacy loaded (hlapi.asyncio)")
    except ImportError:
        logger.warning("pysnmp không khả dụng — bỏ qua SNMP scan")


def format_mac(raw) -> Optional[str]:
    """Chuyển MAC bytes/OID tail thành chuỗi AA:BB:CC:DD:EE:FF."""
    try:
        if isinstance(raw, (bytes, bytearray)):
            parts = list(raw)
        else:
            parts = [int(x) for x in str(raw).split('.') if x.isdigit()]
        if len(parts) == 6:
            return ':'.join(f'{b:02X}' for b in parts)
    except Exception:
        pass
    return None


async def snmp_walk(switch_ip: str, community: str, version: str, base_oid: str, timeout: float = 3.0) -> Dict[str, str]:
    """
    Walk một OID trên switch, trả về dict {oid_tail: value_str}.
    """
    if not PYSNMP_AVAILABLE:
        return {}

    result: Dict[str, str] = {}
    snmp_engine = SnmpEngine()
    mp_model = 0 if version == 'v1' else 1
    community_data = CommunityData(community, mpModel=mp_model)

    try:
        transport = await UdpTransportTarget.create((switch_ip, 161), timeout=timeout, retries=1)
    except Exception as e:
        logger.error(f"[{switch_ip}] Lỗi tạo transport UDP 161: {e}")
        return {}

    try:
        async for err_ind, err_status, err_idx, var_binds in walk_cmd(
            snmp_engine,
            community_data,
            transport,
            ContextData(),
            ObjectType(ObjectIdentity(base_oid)),
            lexicographicMode=False,
        ):
            if err_ind:
                logger.warning(f"[{switch_ip}] SNMP error: {err_ind}")
                break
            if err_status:
                logger.warning(f"[{switch_ip}] SNMP status error: {err_status.prettyPrint()}")
                break
            for var_bind in var_binds:
                oid_str = str(var_bind[0])
                val_str = str(var_bind[1])
                prefix = base_oid.rstrip('.')
                tail = oid_str[len(prefix):].lstrip('.')
                result[tail] = val_str
    except Exception as e:
        logger.error(f"[{switch_ip}] Lỗi walk OID {base_oid}: {e}")

    return result


async def get_mac_to_port_name(switch_ip: str, community: str, version: str) -> Dict[str, str]:
    """
    Trả về dict {mac_str: interface_name}, ví dụ {"00:0F:7C:15:4D:36": "Gi1/0/1"}.
    """
    logger.info(f"[{switch_ip}] Bắt đầu walk SNMP MAC table...")

    # Bước 1: dot1dTpFdbPort (1.3.6.1.2.1.17.4.3.1.2) -> {mac_tail: bridge_port_index}
    fdb_port = await snmp_walk(switch_ip, community, version, '1.3.6.1.2.1.17.4.3.1.2')
    
    # Nếu không có response với community thường, thử với Cisco community indexing nếu có VLANs
    if not fdb_port:
        logger.warning(f"[{switch_ip}] Không nhận được phản hồi SNMP. Kiểm tra IP switch ({switch_ip}), SNMP community ({community}) và ACL.")
        return {}

    # Bước 2: dot1dBasePortIfIndex (1.3.6.1.2.1.17.1.4.1.2) -> {bridge_port_index: ifIndex}
    bp_to_if = await snmp_walk(switch_ip, community, version, '1.3.6.1.2.1.17.1.4.1.2')

    # Bước 3: ifName (1.3.6.1.2.1.31.1.1.1.1) -> {ifIndex: "Gi1/0/12"}
    if_names = await snmp_walk(switch_ip, community, version, '1.3.6.1.2.1.31.1.1.1.1')
    if not if_names:
        # Fallback sang ifDescr (1.3.6.1.2.1.2.2.1.2) nếu switch cũ không có ifName
        if_names = await snmp_walk(switch_ip, community, version, '1.3.6.1.2.1.2.2.1.2')

    mac_to_port: Dict[str, str] = {}
    found = 0

    for mac_tail, bridge_port_idx in fdb_port.items():
        mac_str = format_mac(mac_tail)
        if not mac_str:
            continue

        if_index = bp_to_if.get(bridge_port_idx, bridge_port_idx)
        port_name = if_names.get(if_index, f"Port-{bridge_port_idx}")

        # Bỏ qua cổng uplink (TenGigabit / Port-Channel / Vlan / Null / Management)
        p_lower = port_name.lower()
        if p_lower.startswith(('te', 'po', 'vl', 'mg', 'nu')):
            continue

        mac_to_port[mac_str] = port_name
        found += 1

    logger.info(f"[{switch_ip}] Tìm thấy {found} MAC entries phù hợp")
    return mac_to_port


async def crawl_switch(switch: Switch, session: Session) -> int:
    """Quét 1 switch, so khớp MAC với Camera trong DB và cập nhật NetworkMapping."""
    mac_to_port = await get_mac_to_port_name(switch.ip, switch.community_string, switch.snmp_version)
    if not mac_to_port:
        return 0

    updated = 0
    now = datetime.now(timezone.utc)

    # Lấy toàn bộ cameras có MAC để so khớp
    cameras = session.exec(select(Camera)).all()
    cam_mac_map = {}
    for c in cameras:
        if c.mac_address:
            clean_mac = c.mac_address.upper().replace('-', ':').replace('.', ':')
            cam_mac_map[clean_mac] = c

    for mac_str, port_name in mac_to_port.items():
        camera = cam_mac_map.get(mac_str.upper())
        if not camera:
            continue

        # Tìm mapping hiện tại của camera
        mapping = session.exec(
            select(NetworkMapping).where(NetworkMapping.camera_id == camera.id)
        ).first()

        if mapping:
            mapping.switch_id = switch.id
            mapping.switch_port = port_name
            mapping.last_seen_at = now
        else:
            mapping = NetworkMapping(
                camera_id=camera.id,
                switch_id=switch.id,
                switch_port=port_name,
                status='ONLINE',
                last_seen_at=now,
            )

        session.add(mapping)
        updated += 1
        logger.info(f"  [{switch.hostname}] Map thành công: {camera.name} ({camera.ip}) -> Switch {switch.hostname} Port {port_name}")

    switch.last_scanned_at = now
    session.add(switch)
    return updated


async def crawl_all_switches(session: Session = None):
    """Quét SNMP toàn bộ switch trong DB."""
    close_session = False
    if session is None:
        session = Session(engine)
        close_session = True

    try:
        switches = session.exec(select(Switch)).all()
        if not switches:
            logger.info("Không có switch nào trong DB.")
            return

        logger.info(f"Bắt đầu quét SNMP {len(switches)} switches...")
        total_updated = 0

        for switch in switches:
            try:
                count = await crawl_switch(switch, session)
                session.commit()
                total_updated += count
                logger.info(f"[{switch.hostname}] Đã cập nhật {count} camera mappings")
            except Exception as e:
                logger.error(f"Lỗi khi quét switch {switch.hostname} ({switch.ip}): {e}", exc_info=True)
                session.rollback()

        logger.info(f"Hoàn thành quét SNMP. Tổng camera được định vị: {total_updated}")

    finally:
        if close_session:
            session.close()
