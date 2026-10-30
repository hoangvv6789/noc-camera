import React, { useState, useMemo } from 'react';
import {
  Network,
  Plus,
  FileSpreadsheet,
  RefreshCw,
  Search,
  Terminal,
  Radio,
  Sliders,
  Edit2,
  Trash2,
  CheckCircle2,
  AlertCircle,
  HelpCircle,
  Loader2,
  Shield,
  Zap,
  Camera,
  Server,
  ArrowUpDown
} from 'lucide-react';
import StatsCard from './StatsCard';
import AddSwitchModal from './AddSwitchModal';
import SwitchTerminalModal from './SwitchTerminalModal';
import SwitchCamerasModal from './SwitchCamerasModal';
import SshScanModal from './SshScanModal';
import { deleteSwitch, pingSwitch, pingAllSwitches, scanSwitchMac } from '../api/client';

export default function SwitchManagement({
  switches = [],
  onRefresh,
  onOpenImport,
  onInspectPort,
  showToast,
}) {
  const [search, setSearch] = useState('');
  const [filterMode, setFilterMode] = useState('ALL'); // 'ALL' | 'HAS_CAM' | 'NO_CAM'
  const [sortField, setSortField] = useState('hostname');
  const [sortAsc, setSortAsc] = useState(true);

  // Ping states
  const [pingResults, setPingResults] = useState({}); // { [switchId]: { alive: boolean, latency_ms: number } }
  const [isPingingAll, setIsPingingAll] = useState(false);
  const [pingingSwitchId, setPingingSwitchId] = useState(null);

  // Modals state
  const [isAddEditOpen, setIsAddEditOpen] = useState(false);
  const [editTarget, setEditTarget] = useState(null);

  const [isTerminalOpen, setIsTerminalOpen] = useState(false);
  const [terminalSwitch, setTerminalSwitch] = useState(null);

  const [isCamerasOpen, setIsCamerasOpen] = useState(false);
  const [camerasSwitch, setCamerasSwitch] = useState(null);

  const [isSshScanOpen, setIsSshScanOpen] = useState(false);
  const [scanTargetSwitch, setScanTargetSwitch] = useState(null);

  // Computed KPIs
  const totalSwitches = switches.length;
  const totalCamerasMapped = useMemo(() => {
    return switches.reduce((acc, s) => acc + (s.camera_count || 0), 0);
  }, [switches]);

  const totalOnlineCameras = useMemo(() => {
    return switches.reduce((acc, s) => acc + (s.online_camera_count || 0), 0);
  }, [switches]);

  const onlineSwitchesCount = useMemo(() => {
    return Object.values(pingResults).filter((r) => r.alive).length;
  }, [pingResults]);

  // Ping Single Switch
  const handlePingSwitch = async (sw) => {
    setPingingSwitchId(sw.id);
    try {
      const res = await pingSwitch(sw.id);
      setPingResults((prev) => ({
        ...prev,
        [sw.id]: { alive: res.alive, latency_ms: res.latency_ms },
      }));
      if (res.alive) {
        showToast(`🟢 ${sw.hostname} (${sw.ip}) phản hồi tốt trong ${res.latency_ms?.toFixed(1)}ms`);
      } else {
        showToast(`🔴 ${sw.hostname} (${sw.ip}) không phản hồi!`, true);
      }
    } catch {
      showToast(`❌ Lỗi khi ping switch ${sw.hostname}`, true);
    } finally {
      setPingingSwitchId(null);
    }
  };

  // Ping All Switches Concurrently
  const handlePingAll = async () => {
    setIsPingingAll(true);
    showToast('📡 Đang gửi Ping kiểm tra đồng loạt 60 Switch...');
    try {
      const results = await pingAllSwitches();
      setPingResults(results || {});
      const upCount = Object.values(results || {}).filter((r) => r.alive).length;
      showToast(`✅ Đã kiểm tra xong: ${upCount}/${totalSwitches} Switch đang phản hồi tốt!`);
    } catch {
      showToast('❌ Lỗi khi kiểm tra ping toàn bộ switch', true);
    } finally {
      setIsPingingAll(false);
    }
  };

  // Delete Switch
  const handleDeleteSwitch = async (sw) => {
    if (!window.confirm(`Bạn có chắc muốn xóa Switch "${sw.hostname}" (${sw.ip}) khỏi hệ thống?`)) {
      return;
    }
    try {
      await deleteSwitch(sw.id);
      showToast(`Đã xóa Switch "${sw.hostname}"`);
      onRefresh?.();
    } catch (err) {
      showToast(err.response?.data?.detail || 'Lỗi khi xóa Switch', true);
    }
  };

  // Filtered & Sorted switches
  const filteredSwitches = useMemo(() => {
    let list = switches.filter((sw) => {
      const q = search.toLowerCase();
      const matchesSearch =
        (sw.hostname && sw.hostname.toLowerCase().includes(q)) ||
        (sw.ip && sw.ip.includes(q)) ||
        (sw.location && sw.location.toLowerCase().includes(q));

      if (!matchesSearch) return false;

      if (filterMode === 'HAS_CAM') return (sw.camera_count || 0) > 0;
      if (filterMode === 'NO_CAM') return (sw.camera_count || 0) === 0;
      return true;
    });

    list.sort((a, b) => {
      let valA = a[sortField];
      let valB = b[sortField];

      if (typeof valA === 'string') valA = valA.toLowerCase();
      if (typeof valB === 'string') valB = valB.toLowerCase();

      if (valA < valB) return sortAsc ? -1 : 1;
      if (valA > valB) return sortAsc ? 1 : -1;
      return 0;
    });

    return list;
  }, [switches, search, filterMode, sortField, sortAsc]);

  const toggleSort = (field) => {
    if (sortField === field) {
      setSortAsc(!sortAsc);
    } else {
      setSortField(field);
      setSortAsc(true);
    }
  };

  return (
    <div className="flex flex-col gap-5">
      
      {/* 1. KPI Stats Cards */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <StatsCard
          title="Tổng Switch Mạng"
          value={totalSwitches}
          icon={Network}
          color="yellow"
        />
        <StatsCard
          title="Switch Đang Online"
          value={Object.keys(pingResults).length > 0 ? `${onlineSwitchesCount}/${totalSwitches}` : 'Chưa Ping'}
          icon={CheckCircle2}
          color="green"
        />
        <StatsCard
          title="Camera Đã Ánh Xạ Switch"
          value={totalCamerasMapped}
          icon={Camera}
          color="blue"
        />
        <StatsCard
          title="Camera Online Trên Switch"
          value={totalOnlineCameras}
          icon={Zap}
          color="purple"
        />
      </div>

      {/* 2. Toolbar */}
      <div className="bg-white dark:bg-slate-800 p-4 rounded-xl shadow-xs border border-slate-200 dark:border-slate-700 flex flex-col lg:flex-row gap-3 items-center justify-between">
        
        {/* Search & Filter */}
        <div className="flex flex-col sm:flex-row gap-2.5 w-full lg:w-auto flex-1">
          <div className="relative flex-1 min-w-[240px] max-w-md">
            <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none">
              <Search className="h-4 w-4 text-slate-400" />
            </div>
            <input
              type="text"
              placeholder="Tìm Switch theo Hostname, IP, Vị trí..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="block w-full pl-9 pr-3 py-1.5 border border-slate-300 dark:border-slate-600 rounded-lg bg-slate-50 dark:bg-slate-900 text-slate-900 dark:text-slate-100 placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-amber-500 sm:text-sm"
            />
          </div>

          <select
            value={filterMode}
            onChange={(e) => setFilterMode(e.target.value)}
            className="py-1.5 px-3 border border-slate-300 dark:border-slate-600 rounded-lg bg-slate-50 dark:bg-slate-900 text-slate-900 dark:text-slate-100 focus:outline-none focus:ring-2 focus:ring-amber-500 text-sm font-medium"
          >
            <option value="ALL">Tất cả Switch ({totalSwitches})</option>
            <option value="HAS_CAM">Có Camera kết nối</option>
            <option value="NO_CAM">Chưa gắn Camera</option>
          </select>
        </div>

        {/* Action Buttons */}
        <div className="flex flex-wrap gap-2 w-full lg:w-auto justify-end">
          
          {/* Nút Ping Tất Cả Switch */}
          <button
            onClick={handlePingAll}
            disabled={isPingingAll}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 border border-blue-200 dark:border-blue-800 text-blue-700 dark:text-blue-300 bg-blue-50 dark:bg-blue-950/40 hover:bg-blue-100 dark:hover:bg-blue-900/60 rounded-lg text-xs font-semibold shadow-xs transition-colors disabled:opacity-50"
            title="Gửi Ping ICMP đồng loạt kiểm tra trạng thái tất cả các Switch"
          >
            {isPingingAll ? <Loader2 size={14} className="animate-spin text-blue-600" /> : <Radio size={14} />}
            Kiểm Tra Ping Tất Cả
          </button>

          {/* Nút Quét MAC Toàn Bộ Switch */}
          <button
            onClick={() => {
              setScanTargetSwitch(null);
              setIsSshScanOpen(true);
            }}
            className="inline-flex items-center gap-1.5 px-3.5 py-1.5 rounded-lg shadow-xs text-xs font-semibold text-white bg-indigo-600 hover:bg-indigo-700 transition-colors"
            title="Quét bảng MAC song song trên tất cả các switch để định vị camera"
          >
            <RefreshCw size={14} />
            Quét MAC Toàn Bộ Switch
          </button>

          {/* Nút Import CSV */}
          <button
            onClick={onOpenImport}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 border border-emerald-200 dark:border-emerald-800 text-emerald-700 dark:text-emerald-300 bg-emerald-50 dark:bg-emerald-950/40 hover:bg-emerald-100 dark:hover:bg-emerald-900/60 rounded-lg text-xs font-semibold shadow-xs transition-colors"
          >
            <FileSpreadsheet size={14} />
            Import CSV
          </button>

          {/* Nút Thêm Switch */}
          <button
            onClick={() => {
              setEditTarget(null);
              setIsAddEditOpen(true);
            }}
            className="inline-flex items-center gap-1.5 px-3.5 py-1.5 rounded-lg shadow-xs text-xs font-semibold text-white bg-amber-600 hover:bg-amber-700 transition-colors"
          >
            <Plus size={14} />
            + Thêm Switch
          </button>

        </div>
      </div>

      {/* 3. Switch Table */}
      <div className="bg-white dark:bg-slate-800 rounded-xl shadow-xs border border-slate-200 dark:border-slate-700 overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs">
            <thead className="bg-slate-50 dark:bg-slate-800/80 text-slate-600 dark:text-slate-300 font-semibold border-b border-slate-200 dark:border-slate-700 uppercase tracking-wider text-[11px]">
              <tr>
                <th className="py-3 px-4 w-28">Trạng Thái</th>
                <th className="py-3 px-4 cursor-pointer select-none" onClick={() => toggleSort('hostname')}>
                  <div className="flex items-center gap-1.5">
                    <span>Tên Hostname Switch</span>
                    <ArrowUpDown size={12} className="opacity-50" />
                  </div>
                </th>
                <th className="py-3 px-4 cursor-pointer select-none" onClick={() => toggleSort('ip')}>
                  <div className="flex items-center gap-1.5">
                    <span>IP Switch (Bấm Terminal)</span>
                    <ArrowUpDown size={12} className="opacity-50" />
                  </div>
                </th>
                <th className="py-3 px-4 cursor-pointer select-none" onClick={() => toggleSort('location')}>
                  <div className="flex items-center gap-1.5">
                    <span>Vị Trí Đặt</span>
                    <ArrowUpDown size={12} className="opacity-50" />
                  </div>
                </th>
                <th className="py-3 px-4 text-center cursor-pointer select-none" onClick={() => toggleSort('camera_count')}>
                  <div className="flex items-center justify-center gap-1.5">
                    <span>Camera Kết Nối</span>
                    <ArrowUpDown size={12} className="opacity-50" />
                  </div>
                </th>
                <th className="py-3 px-4">Lần Quét MAC Cuối</th>
                <th className="py-3 px-4 text-right">Thao Tác</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 dark:divide-slate-700/60">
              {filteredSwitches.length === 0 ? (
                <tr>
                  <td colSpan={7} className="py-12 text-center text-slate-400">
                    <Network size={36} className="mx-auto mb-2 text-slate-300 dark:text-slate-600" />
                    <p className="text-sm font-semibold text-slate-700 dark:text-slate-300">Không tìm thấy Switch nào</p>
                    <p className="text-xs text-slate-500 mt-0.5">Thử thay đổi bộ lọc hoặc thêm Switch mới.</p>
                  </td>
                </tr>
              ) : (
                filteredSwitches.map((sw) => {
                  const pingInfo = pingResults[sw.id];
                  const isPinging = pingingSwitchId === sw.id;

                  return (
                    <tr
                      key={sw.id}
                      className="hover:bg-slate-50 dark:hover:bg-slate-700/30 transition-colors"
                    >
                      {/* Trạng thái Ping */}
                      <td className="py-3 px-4 whitespace-nowrap">
                        {pingInfo ? (
                          pingInfo.alive ? (
                            <span className="inline-flex items-center gap-1.5 text-emerald-600 dark:text-emerald-400 font-semibold font-mono text-[11px]">
                              <span className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse" />
                              {pingInfo.latency_ms ? `${pingInfo.latency_ms.toFixed(1)}ms` : 'Online'}
                            </span>
                          ) : (
                            <span className="inline-flex items-center gap-1.5 text-red-500 font-semibold text-[11px]">
                              <span className="w-2 h-2 rounded-full bg-red-500" />
                              Timeout
                            </span>
                          )
                        ) : (
                          <span className="inline-flex items-center gap-1.5 text-slate-400 text-[11px]">
                            <span className="w-2 h-2 rounded-full bg-slate-300 dark:bg-slate-600" />
                            Chưa test
                          </span>
                        )}
                      </td>

                      {/* Hostname */}
                      <td className="py-3 px-4">
                        <div className="flex items-center gap-2">
                          <span className="p-1 bg-amber-50 dark:bg-amber-950/40 text-amber-600 dark:text-amber-400 rounded border border-amber-200 dark:border-amber-800/60 font-semibold text-xs">
                            Cisco
                          </span>
                          <span className="font-semibold text-slate-900 dark:text-white text-xs">
                            {sw.hostname}
                          </span>
                        </div>
                      </td>

                      {/* IP Switch */}
                      <td className="py-3 px-4">
                        <button
                          type="button"
                          onClick={() => {
                            setTerminalSwitch(sw);
                            setIsTerminalOpen(true);
                          }}
                          title={`Bấm để mở Terminal SSH chẩn đoán Switch ${sw.ip}`}
                          className="font-mono text-xs font-semibold text-blue-600 dark:text-blue-400 hover:text-blue-700 dark:hover:text-blue-300 hover:underline flex items-center gap-1 group"
                        >
                          <span>{sw.ip}</span>
                          <Terminal size={12} className="opacity-60 group-hover:opacity-100 transition-opacity" />
                        </button>
                      </td>

                      {/* Vị trí */}
                      <td className="py-3 px-4 text-slate-600 dark:text-slate-300 font-medium">
                        {sw.location || '—'}
                      </td>

                      {/* Camera Kết Nối */}
                      <td className="py-3 px-4 text-center">
                        <button
                          type="button"
                          onClick={() => {
                            setCamerasSwitch(sw);
                            setIsCamerasOpen(true);
                          }}
                          className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-xs font-bold transition-colors cursor-pointer border ${
                            (sw.camera_count || 0) > 0
                              ? 'bg-blue-50 text-blue-700 dark:bg-blue-950/40 dark:text-blue-300 border-blue-200 dark:border-blue-800 hover:bg-blue-100 dark:hover:bg-blue-900/60'
                              : 'bg-slate-100 text-slate-400 dark:bg-slate-800 dark:text-slate-500 border-slate-200 dark:border-slate-700 hover:bg-slate-200'
                          }`}
                          title={`Bấm để xem danh sách ${(sw.camera_count || 0)} Camera cắm trên các cổng của Switch này`}
                        >
                          <Camera size={13} />
                          <span>{sw.camera_count || 0} Camera</span>
                          {(sw.online_camera_count || 0) > 0 && (
                            <span className="text-[10px] text-emerald-600 dark:text-emerald-400">
                              ({sw.online_camera_count} 🟢)
                            </span>
                          )}
                        </button>
                      </td>

                      {/* Lần quét MAC cuối */}
                      <td className="py-3 px-4 text-slate-500 dark:text-slate-400 text-xs tabular-nums">
                        {sw.last_scanned_at ? (
                          new Date(sw.last_scanned_at.endsWith('Z') ? sw.last_scanned_at : sw.last_scanned_at + 'Z').toLocaleString('vi-VN')
                        ) : (
                          <span className="text-slate-400 italic">Chưa quét</span>
                        )}
                      </td>

                      {/* Actions */}
                      <td className="py-3 px-4 text-right">
                        <div className="flex items-center justify-end gap-1">
                          
                          {/* Ping Switch Button */}
                          <button
                            type="button"
                            onClick={() => handlePingSwitch(sw)}
                            disabled={isPinging}
                            title="Ping kiểm tra phản hồi mạng tới Switch này"
                            className="p-1.5 text-slate-400 hover:text-emerald-600 dark:hover:text-emerald-400 hover:bg-slate-100 dark:hover:bg-slate-700 rounded-lg transition-colors"
                          >
                            {isPinging ? <Loader2 size={14} className="animate-spin text-emerald-500" /> : <Radio size={14} />}
                          </button>

                          {/* Terminal SSH Console */}
                          <button
                            type="button"
                            onClick={() => {
                              setTerminalSwitch(sw);
                              setIsTerminalOpen(true);
                            }}
                            title="Mở Cisco CLI Terminal Console qua SSH"
                            className="p-1.5 text-slate-400 hover:text-blue-600 dark:hover:text-blue-400 hover:bg-slate-100 dark:hover:bg-slate-700 rounded-lg transition-colors"
                          >
                            <Terminal size={14} />
                          </button>

                          {/* Quét MAC riêng Switch này */}
                          <button
                            type="button"
                            onClick={() => {
                              setScanTargetSwitch(sw);
                              setIsSshScanOpen(true);
                            }}
                            title="Quét bảng MAC & ARP riêng trên Switch này"
                            className="p-1.5 text-slate-400 hover:text-indigo-600 dark:hover:text-indigo-400 hover:bg-slate-100 dark:hover:bg-slate-700 rounded-lg transition-colors"
                          >
                            <RefreshCw size={14} />
                          </button>

                          {/* Edit Switch */}
                          <button
                            type="button"
                            onClick={() => {
                              setEditTarget(sw);
                              setIsAddEditOpen(true);
                            }}
                            title="Sửa thông tin Switch"
                            className="p-1.5 text-slate-400 hover:text-amber-600 dark:hover:text-amber-400 hover:bg-slate-100 dark:hover:bg-slate-700 rounded-lg transition-colors"
                          >
                            <Edit2 size={14} />
                          </button>

                          {/* Delete Switch */}
                          <button
                            type="button"
                            onClick={() => handleDeleteSwitch(sw)}
                            title="Xóa Switch"
                            className="p-1.5 text-slate-400 hover:text-red-500 hover:bg-slate-100 dark:hover:bg-slate-700 rounded-lg transition-colors"
                          >
                            <Trash2 size={14} />
                          </button>

                        </div>
                      </td>

                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>

        {/* Footer info */}
        <div className="py-2.5 px-4 bg-slate-50 dark:bg-slate-800/80 border-t border-slate-200 dark:border-slate-700 flex items-center justify-between text-xs text-slate-500">
          <span>
            Đang hiển thị <strong>{filteredSwitches.length}</strong> / <strong>{totalSwitches}</strong> Switch
          </span>
          <span className="hidden sm:inline">
            Tổng <strong>{totalCamerasMapped}</strong> Camera đã kết nối ({totalOnlineCameras} đang Online)
          </span>
        </div>
      </div>

      {/* Modals */}
      <AddSwitchModal
        isOpen={isAddEditOpen}
        onClose={() => {
          setIsAddEditOpen(false);
          setEditTarget(null);
        }}
        onSuccess={(msg) => {
          showToast(msg);
          onRefresh?.();
        }}
        editTarget={editTarget}
      />

      <SwitchTerminalModal
        isOpen={isTerminalOpen}
        onClose={() => {
          setIsTerminalOpen(false);
          setTerminalSwitch(null);
        }}
        targetSwitch={terminalSwitch}
      />

      <SwitchCamerasModal
        isOpen={isCamerasOpen}
        onClose={() => {
          setIsCamerasOpen(false);
          setCamerasSwitch(null);
        }}
        targetSwitch={camerasSwitch}
        onInspectPort={onInspectPort}
      />

      <SshScanModal
        isOpen={isSshScanOpen}
        onClose={() => {
          setIsSshScanOpen(false);
          setScanTargetSwitch(null);
        }}
        onSuccess={(msg) => {
          showToast(msg);
          onRefresh?.();
        }}
        targetSwitch={scanTargetSwitch}
      />

    </div>
  );
}
