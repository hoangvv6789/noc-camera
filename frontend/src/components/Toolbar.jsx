import React, { useState, useEffect, useRef } from 'react';
import { Search, Zap, RefreshCw, Plus, FileSpreadsheet, Camera, Network, Server } from 'lucide-react';

export default function Toolbar({
  onSearchChange,
  onStatusChange,
  onSwitchChange,
  onMappedChange,
  onPingScan,
  onMacScan,
  onOpenAddCamera,
  onOpenAddSwitch,
  onOpenImport,
  onOpenCms2Sync,
  switches = [],
  isScanning
}) {
  const [searchTerm, setSearchTerm] = useState('');
  const onSearchChangeRef = useRef(onSearchChange);
  useEffect(() => {
    onSearchChangeRef.current = onSearchChange;
  }, [onSearchChange]);

  // Debounce search 300ms - chỉ kích hoạt khi người dùng gõ searchTerm
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
      
      {/* Hàng 1: Search, Lọc, và các nút Thao tác */}
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
              className="block w-full pl-9 pr-3 py-1.5 border border-slate-300 dark:border-slate-600 rounded-lg bg-slate-50 dark:bg-slate-900 text-slate-900 dark:text-slate-100 placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-blue-500 sm:text-sm"
              placeholder="Tìm IP, Tên, MAC, Port..."
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
            />
          </div>

          {/* Status Filter */}
          <select
            onChange={(e) => onStatusChange(e.target.value)}
            className="py-1.5 px-3 border border-slate-300 dark:border-slate-600 rounded-lg bg-slate-50 dark:bg-slate-900 text-slate-900 dark:text-slate-100 focus:outline-none focus:ring-2 focus:ring-blue-500 text-sm"
          >
            <option value="">Tất cả trạng thái</option>
            <option value="ONLINE">🟢 Hoạt Động</option>
            <option value="OFFLINE">🔴 Mất Kết Nối</option>
          </select>

          {/* Switch Filter */}
          <select
            onChange={(e) => onSwitchChange(e.target.value)}
            className="py-1.5 px-3 border border-slate-300 dark:border-slate-600 rounded-lg bg-slate-50 dark:bg-slate-900 text-slate-900 dark:text-slate-100 focus:outline-none focus:ring-2 focus:ring-blue-500 text-sm max-w-[220px]"
          >
            <option value="">Tất cả Switch ({switches.length})</option>
            {switches.map((sw) => (
              <option key={sw.id} value={sw.id}>
                {sw.hostname || sw.name} ({sw.camera_count || 0} Cam)
              </option>
            ))}
          </select>

          {/* Mapped Filter */}
          <select
            onChange={(e) => onMappedChange?.(e.target.value)}
            className="py-1.5 px-3 border border-slate-300 dark:border-slate-600 rounded-lg bg-slate-50 dark:bg-slate-900 text-slate-900 dark:text-slate-100 focus:outline-none focus:ring-2 focus:ring-blue-500 text-sm"
          >
            <option value="">Tất cả Port</option>
            <option value="MAPPED">🔗 Đã có Port Switch</option>
            <option value="UNMAPPED">⚠️ Chưa có Port (Tháo về/Chưa cắm)</option>
          </select>
        </div>

        {/* Nút Thao tác & Đồng bộ */}
        <div className="flex flex-wrap gap-2 w-full lg:w-auto justify-end">
          
          {/* Nút Kéo Cam từ CMS 2.0 + Badge Realtime & Auto 5p */}
          <div className="flex items-center gap-1.5">
            <button
              onClick={onOpenCms2Sync}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 border border-indigo-200 dark:border-indigo-800 text-indigo-700 dark:text-indigo-300 bg-indigo-50 dark:bg-indigo-950/50 hover:bg-indigo-100 dark:hover:bg-indigo-900/60 rounded-lg text-xs font-semibold shadow-sm transition-colors"
            >
              <Server size={14} className="text-indigo-600 dark:text-indigo-400" />
              Đồng bộ CMS 2.0
            </button>
            <span 
              className="hidden sm:inline-flex items-center gap-1 px-2 py-1 rounded-md text-[11px] font-medium bg-emerald-50 dark:bg-emerald-950/40 text-emerald-700 dark:text-emerald-400 border border-emerald-200 dark:border-emerald-800/60" 
              title="Hệ thống tự động đồng bộ dữ liệu CMS 2.0 mỗi 5 phút và cập nhật sự kiện mất tín hiệu Real-time qua WebSocket"
            >
              <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse" />
              Auto 5p • Realtime
            </span>
          </div>

          <button
            onClick={onOpenAddSwitch}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 border border-amber-200 dark:border-amber-800 text-amber-700 dark:text-amber-300 bg-amber-50 dark:bg-amber-950/40 hover:bg-amber-100 dark:hover:bg-amber-900/60 rounded-lg text-xs font-semibold shadow-sm transition-colors"
          >
            <Network size={14} />
            + Switch
          </button>

          <button
            onClick={onOpenImport}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 border border-emerald-200 dark:border-emerald-800 text-emerald-700 dark:text-emerald-300 bg-emerald-50 dark:bg-emerald-950/40 hover:bg-emerald-100 dark:hover:bg-emerald-900/60 rounded-lg text-xs font-semibold shadow-sm transition-colors"
          >
            <FileSpreadsheet size={14} />
            Import CSV
          </button>

          <div className="h-6 w-px bg-slate-200 dark:bg-slate-700 mx-0.5 hidden sm:block" />

          {/* Quét Ping & Quét MAC */}
          <button
            onClick={onPingScan}
            disabled={isScanning}
            className="inline-flex items-center gap-1.5 px-3.5 py-1.5 rounded-lg shadow-sm text-xs font-semibold text-white bg-blue-600 hover:bg-blue-700 disabled:opacity-50 transition-colors"
          >
            {isScanning ? <RefreshCw size={14} className="animate-spin" /> : <Zap size={14} />}
            Quét Ping
          </button>

          <button
            onClick={onMacScan}
            disabled={isScanning}
            className="inline-flex items-center gap-1.5 px-3.5 py-1.5 border border-slate-300 dark:border-slate-600 rounded-lg shadow-sm text-xs font-semibold text-slate-700 dark:text-slate-200 bg-white dark:bg-slate-800 hover:bg-slate-50 dark:hover:bg-slate-700 disabled:opacity-50 transition-colors"
          >
            <RefreshCw size={14} className={isScanning ? "animate-spin" : ""} />
            Quét MAC
          </button>
        </div>

      </div>
    </div>
  );
}

