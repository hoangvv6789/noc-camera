import React, { useState, useEffect, useRef } from 'react';
import { Search, Zap, RefreshCw, Plus, FileSpreadsheet, HardDrive, AlertTriangle } from 'lucide-react';

export default function NVRToolbar({
  onSearchChange,
  onStatusChange,
  onNvrScan,
  onOpenAddNVR,
  onOpenImport,
  onSyncAll,
  isScanning,
  isSyncing,
}) {
  const [searchTerm, setSearchTerm] = useState('');
  const onSearchChangeRef = useRef(onSearchChange);

  useEffect(() => {
    onSearchChangeRef.current = onSearchChange;
  }, [onSearchChange]);

  const isFirstMount = useRef(true);
  useEffect(() => {
    if (isFirstMount.current) {
      isFirstMount.current = false;
      return;
    }
    const timer = setTimeout(() => {
      onSearchChangeRef.current?.(searchTerm);
    }, 300);
    return () => clearTimeout(timer);
  }, [searchTerm]);

  return (
    <div className="flex flex-col gap-3.5 bg-white dark:bg-slate-800 p-4 rounded-xl shadow-sm border border-slate-200 dark:border-slate-700">
      <div className="flex flex-col lg:flex-row gap-3 items-center justify-between">
        {/* Search và Filters */}
        <div className="flex flex-col sm:flex-row gap-2.5 w-full lg:w-auto flex-1">
          {/* Search Input */}
          <div className="relative flex-1 min-w-[220px] max-w-md">
            <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none">
              <Search className="h-4 w-4 text-slate-400" />
            </div>
            <input
              type="text"
              className="block w-full pl-9 pr-3 py-1.5 border border-slate-300 dark:border-slate-600 rounded-lg bg-slate-50 dark:bg-slate-900 text-slate-900 dark:text-slate-100 placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-purple-500 sm:text-sm"
              placeholder="Tìm tên NVR, IP, model, vị trí..."
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
            />
          </div>

          {/* Status Filter */}
          <select
            onChange={(e) => onStatusChange(e.target.value)}
            className="py-1.5 px-3 border border-slate-300 dark:border-slate-600 rounded-lg bg-slate-50 dark:bg-slate-900 text-slate-900 dark:text-slate-100 focus:outline-none focus:ring-2 focus:ring-purple-500 text-sm font-medium"
          >
            <option value="">Tất cả trạng thái NVR</option>
            <option value="SERVICE_FROZEN">⚠️ Treo Dịch Vụ (Cần xử lý)</option>
            <option value="ONLINE">🟢 Hoạt Động Bình Thường</option>
            <option value="OFFLINE">🔴 Mất Kết Nối Mạng</option>
          </select>
        </div>

        {/* Các nút Hành động */}
        <div className="flex flex-wrap gap-2 w-full lg:w-auto justify-end items-center">
          {/* Nút Đồng Bộ Camera Từ NVR nổi bật */}
          <button
            onClick={onSyncAll}
            disabled={isSyncing}
            className="inline-flex items-center gap-1.5 px-3.5 py-1.5 rounded-lg shadow-sm text-xs font-bold text-white bg-emerald-600 hover:bg-emerald-700 active:bg-emerald-800 disabled:opacity-50 transition-all border border-emerald-500"
          >
            {isSyncing ? <RefreshCw size={14} className="animate-spin" /> : <RefreshCw size={14} />}
            🔄 Đồng Bộ Camera Từ NVR
          </button>

          <div className="h-6 w-px bg-slate-200 dark:bg-slate-700 mx-0.5 hidden sm:block" />

          <button
            onClick={onOpenAddNVR}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 border border-purple-200 dark:border-purple-800 text-purple-600 dark:text-purple-400 bg-purple-50 dark:bg-purple-950/40 hover:bg-purple-100 dark:hover:bg-purple-900/60 rounded-lg text-xs font-semibold shadow-sm transition-colors"
          >
            <HardDrive size={14} />
            + Thêm NVR
          </button>

          <button
            onClick={onOpenImport}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 border border-slate-300 dark:border-slate-600 text-slate-700 dark:text-slate-300 bg-slate-50 dark:bg-slate-900 hover:bg-slate-100 dark:hover:bg-slate-800 rounded-lg text-xs font-semibold shadow-sm transition-colors"
          >
            <FileSpreadsheet size={14} />
            📁 Import CSV
          </button>

          {/* Quét Dịch Vụ NVR */}
          <button
            onClick={onNvrScan}
            disabled={isScanning}
            className="inline-flex items-center gap-1.5 px-3.5 py-1.5 rounded-lg shadow-sm text-xs font-semibold text-white bg-purple-600 hover:bg-purple-700 disabled:opacity-50 transition-colors"
          >
            {isScanning ? <RefreshCw size={14} className="animate-spin" /> : <Zap size={14} />}
            Quét Toàn Bộ NVR
          </button>
        </div>
      </div>
    </div>
  );
}
