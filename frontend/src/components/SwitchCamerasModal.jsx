import React, { useState, useEffect } from 'react';
import {
  X,
  Camera,
  Network,
  Radio,
  Loader2,
  RefreshCw,
  Sliders,
  CheckCircle2,
  XCircle,
  ExternalLink
} from 'lucide-react';
import { fetchSwitchCameras, pingSingleCamera } from '../api/client';

export default function SwitchCamerasModal({
  isOpen,
  onClose,
  targetSwitch,
  onInspectPort,
}) {
  const [cameras, setCameras] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [pingingId, setPingingId] = useState(null);
  const [search, setSearch] = useState('');

  const loadCameras = async () => {
    if (!targetSwitch) return;
    setLoading(true);
    setError(null);
    try {
      const data = await fetchSwitchCameras(targetSwitch.id);
      setCameras(data || []);
    } catch (err) {
      setError(err.response?.data?.detail || 'Lỗi khi tải danh sách camera của Switch.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (isOpen && targetSwitch) {
      loadCameras();
      setSearch('');
    }
  }, [isOpen, targetSwitch]);

  if (!isOpen || !targetSwitch) return null;

  const handlePing = async (cam) => {
    setPingingId(cam.camera_id);
    try {
      const res = await pingSingleCamera(cam.camera_id);
      setCameras((prev) =>
        prev.map((c) =>
          c.camera_id === cam.camera_id
            ? { ...c, status: res.alive ? 'ONLINE' : 'OFFLINE', latency_ms: res.latency_ms }
            : c
        )
      );
    } catch {
      // ignore
    } finally {
      setPingingId(null);
    }
  };

  const filteredCameras = cameras.filter((c) => {
    const q = search.toLowerCase();
    return (
      (c.name && c.name.toLowerCase().includes(q)) ||
      (c.ip && c.ip.includes(q)) ||
      (c.switch_port && c.switch_port.toLowerCase().includes(q)) ||
      (c.mac_address && c.mac_address.toLowerCase().includes(q))
    );
  });

  const onlineCount = cameras.filter((c) => c.status === 'ONLINE').length;
  const offlineCount = cameras.filter((c) => c.status === 'OFFLINE').length;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-4 bg-slate-900/70 backdrop-blur-sm animate-fadeIn">
      <div className="bg-white dark:bg-slate-900 rounded-2xl shadow-2xl border border-slate-200 dark:border-slate-800 w-full max-w-5xl max-h-[90vh] flex flex-col overflow-hidden">
        
        {/* Header */}
        <div className="px-6 py-4 border-b border-slate-200 dark:border-slate-800 flex items-center justify-between bg-slate-50 dark:bg-slate-800/80">
          <div className="flex items-center gap-3">
            <div className="p-2.5 bg-blue-100 dark:bg-blue-900/40 text-blue-600 dark:text-blue-400 rounded-xl shadow-xs">
              <Network size={22} />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h2 className="text-base font-bold text-slate-900 dark:text-white">
                  Danh Sách Camera Kết Nối Switch: <span className="text-blue-600 dark:text-blue-400">{targetSwitch.hostname}</span>
                </h2>
                <span className="font-mono text-xs bg-slate-200 dark:bg-slate-700 text-slate-700 dark:text-slate-300 px-2 py-0.5 rounded font-semibold">
                  {targetSwitch.ip}
                </span>
              </div>
              <div className="flex items-center gap-3 text-xs text-slate-500 dark:text-slate-400 mt-1">
                <span>Vị trí: <strong>{targetSwitch.location || 'N/A'}</strong></span>
                <span>•</span>
                <span>Tổng cộng: <strong className="text-slate-800 dark:text-slate-200">{cameras.length} Camera</strong></span>
                <span>•</span>
                <span className="text-emerald-600 dark:text-emerald-400 font-semibold">🟢 {onlineCount} Hoạt động</span>
                {offlineCount > 0 && (
                  <>
                    <span>•</span>
                    <span className="text-red-500 dark:text-red-400 font-semibold">🔴 {offlineCount} Mất kết nối</span>
                  </>
                )}
              </div>
            </div>
          </div>

          <button
            onClick={onClose}
            className="text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 p-1.5 rounded-lg hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors"
          >
            <X size={20} />
          </button>
        </div>

        {/* Search & Actions Bar */}
        <div className="px-6 py-3 bg-slate-50/60 dark:bg-slate-800/50 border-b border-slate-200 dark:border-slate-800 flex items-center justify-between gap-3">
          <div className="flex items-center gap-2 flex-1 max-w-sm">
            <input
              type="text"
              placeholder="Lọc theo cổng, tên camera, IP, MAC..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="w-full px-3 py-1.5 text-xs bg-white dark:bg-slate-900 border border-slate-300 dark:border-slate-700 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 dark:text-white"
            />
          </div>

          <button
            onClick={loadCameras}
            disabled={loading}
            className="px-3 py-1.5 text-xs font-semibold text-slate-700 dark:text-slate-200 bg-white dark:bg-slate-800 border border-slate-300 dark:border-slate-700 hover:bg-slate-100 dark:hover:bg-slate-700 rounded-lg flex items-center gap-1.5 transition-colors"
          >
            <RefreshCw size={13} className={loading ? 'animate-spin' : ''} />
            Làm mới
          </button>
        </div>

        {/* Table Content */}
        <div className="flex-1 overflow-auto p-4 custom-scrollbar">
          {loading ? (
            <div className="flex flex-col items-center justify-center py-16 text-slate-400 gap-2">
              <Loader2 size={32} className="animate-spin text-blue-500" />
              <span className="text-xs">Đang tải danh sách camera trên cổng Switch...</span>
            </div>
          ) : error ? (
            <div className="p-4 bg-red-50 dark:bg-red-950/30 text-red-600 dark:text-red-400 border border-red-200 dark:border-red-800 rounded-xl text-center text-xs">
              {error}
            </div>
          ) : filteredCameras.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-16 text-slate-400 gap-2 text-center">
              <Camera size={36} className="text-slate-300 dark:text-slate-600" />
              <div className="text-sm font-semibold text-slate-700 dark:text-slate-300">
                {cameras.length === 0 ? 'Chưa có camera nào được định vị trên Switch này' : 'Không tìm thấy kết quả phù hợp'}
              </div>
              <p className="text-xs text-slate-500 max-w-md">
                {cameras.length === 0
                  ? 'Hãy sử dụng tính năng "Quét MAC Switch" để hệ thống tự động tìm các camera đang cắm vào Switch này.'
                  : 'Thử kiểm tra lại từ khóa tìm kiếm.'}
              </p>
            </div>
          ) : (
            <div className="overflow-x-auto border border-slate-200 dark:border-slate-800 rounded-xl">
              <table className="w-full text-left text-xs">
                <thead className="bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300 font-semibold border-b border-slate-200 dark:border-slate-700 uppercase tracking-wider text-[11px]">
                  <tr>
                    <th className="py-2.5 px-3">Cổng (Port)</th>
                    <th className="py-2.5 px-3">Trạng Thái</th>
                    <th className="py-2.5 px-3">Tên Camera</th>
                    <th className="py-2.5 px-3">Địa Chỉ IP</th>
                    <th className="py-2.5 px-3">Địa Chỉ MAC</th>
                    <th className="py-2.5 px-3">Độ Trễ</th>
                    <th className="py-2.5 px-3 text-right">Thao Tác Cổng</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 dark:divide-slate-800/80">
                  {filteredCameras.map((cam) => {
                    const isOnline = cam.status === 'ONLINE';
                    const isPinging = pingingId === cam.camera_id;

                    return (
                      <tr
                        key={cam.camera_id}
                        className="hover:bg-slate-50 dark:hover:bg-slate-800/50 transition-colors"
                      >
                        {/* Port */}
                        <td className="py-2.5 px-3">
                          <span className="font-mono font-bold text-xs bg-indigo-50 dark:bg-indigo-950/50 text-indigo-700 dark:text-indigo-300 px-2 py-0.5 rounded border border-indigo-200 dark:border-indigo-800/60">
                            {cam.switch_port}
                          </span>
                        </td>

                        {/* Status */}
                        <td className="py-2.5 px-3">
                          <span
                            className={`inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full text-[11px] font-semibold ${
                              isOnline
                                ? 'bg-emerald-50 text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-400 border border-emerald-200 dark:border-emerald-800/60'
                                : 'bg-red-50 text-red-600 dark:bg-red-950/40 dark:text-red-400 border border-red-200 dark:border-red-800/60'
                            }`}
                          >
                            <span className={`w-1.5 h-1.5 rounded-full ${isOnline ? 'bg-emerald-500 animate-pulse' : 'bg-red-500'}`} />
                            {isOnline ? 'Online' : 'Offline'}
                          </span>
                        </td>

                        {/* Camera Name */}
                        <td className="py-2.5 px-3 font-medium text-slate-800 dark:text-slate-200">
                          {cam.name}
                        </td>

                        {/* IP */}
                        <td className="py-2.5 px-3 font-mono text-slate-600 dark:text-slate-300">
                          {cam.ip}
                        </td>

                        {/* MAC */}
                        <td className="py-2.5 px-3 font-mono text-slate-500 dark:text-slate-400">
                          {cam.mac_address || '—'}
                        </td>

                        {/* Latency */}
                        <td className="py-2.5 px-3 font-mono text-slate-600 dark:text-slate-400">
                          {cam.latency_ms !== null && cam.latency_ms !== undefined ? `${cam.latency_ms.toFixed(1)} ms` : '—'}
                        </td>

                        {/* Actions */}
                        <td className="py-2.5 px-3 text-right">
                          <div className="flex items-center justify-end gap-1.5">
                            {/* Ping Button */}
                            <button
                              onClick={() => handlePing(cam)}
                              disabled={isPinging}
                              title="Ping kiểm tra Camera"
                              className="p-1.5 text-slate-500 hover:text-emerald-600 dark:hover:text-emerald-400 hover:bg-slate-100 dark:hover:bg-slate-800 rounded-lg transition-colors"
                            >
                              {isPinging ? <Loader2 size={14} className="animate-spin text-emerald-500" /> : <Radio size={14} />}
                            </button>

                            {/* Inspect / Reset Port Button */}
                            <button
                              onClick={() => {
                                onInspectPort?.({
                                  switch_name: targetSwitch.hostname,
                                  switch_ip: targetSwitch.ip,
                                  switch_port: cam.switch_port,
                                  name: cam.name,
                                  ip: cam.ip,
                                  camera_id: cam.camera_id,
                                });
                              }}
                              title="Chẩn đoán & Reset Cổng Switch (PoE Reboot)"
                              className="px-2 py-1 text-[11px] font-semibold text-blue-700 dark:text-blue-300 bg-blue-50 dark:bg-blue-950/40 hover:bg-blue-100 dark:hover:bg-blue-900/60 border border-blue-200 dark:border-blue-800 rounded-lg flex items-center gap-1 transition-colors"
                            >
                              <Sliders size={12} />
                              Chẩn Đoán / Reset Port
                            </button>
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="px-6 py-3 border-t border-slate-200 dark:border-slate-800 flex items-center justify-between bg-slate-50 dark:bg-slate-900 text-xs text-slate-500">
          <span>
            Hiển thị <strong>{filteredCameras.length}</strong> / <strong>{cameras.length}</strong> Camera cắm trên Switch
          </span>
          <button
            onClick={onClose}
            className="px-4 py-1.5 font-medium text-slate-700 dark:text-slate-300 hover:bg-slate-200 dark:hover:bg-slate-800 rounded-lg transition-colors"
          >
            Đóng
          </button>
        </div>

      </div>
    </div>
  );
}
